#!/usr/bin/env node
// pm validate — checks pm/ artifact integrity
// Usage: node validate.js --dir <pm-directory>

const fs = require('fs');
const path = require('path');

// ========== Config ==========

const VALID_STATUSES = ['idea', 'drafted', 'approved', 'in-progress', 'done'];
const VALID_PRIORITIES = ['critical', 'high', 'medium', 'low'];
const VALID_EVIDENCE = ['strong', 'moderate', 'weak'];
const VALID_SCOPE = ['small', 'medium', 'large'];
const VALID_GAP = ['unique', 'partial', 'parity', 'behind'];

const VALID_MEMORY_CATEGORIES = ['scope', 'research', 'review', 'process', 'quality'];
const REQUIRED_MEMORY_ENTRY_FIELDS = ['date', 'source', 'category', 'learning'];

const REQUIRED_BACKLOG_FIELDS = ['type', 'id', 'title', 'outcome', 'status', 'priority', 'created', 'updated'];
const REQUIRED_STRATEGY_FIELDS = ['type'];

// ========== Frontmatter Parser ==========

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const lines = match[1].split('\n');
  const data = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') { i++; continue; }

    // Top-level key-value
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (!kv) { i++; continue; }

    const key = kv[1];
    const inlineVal = kv[2].trim();

    // Inline empty array
    if (inlineVal === '[]') {
      data[key] = [];
      i++;
      continue;
    }

    // Flat scalar value
    if (inlineVal !== '') {
      const val = inlineVal.replace(/^["'](.*)["']$/, '$1');
      if (val === 'null') {
        data[key] = null;
      } else if (val === 'true') {
        data[key] = true;
      } else if (val === 'false') {
        data[key] = false;
      } else {
        data[key] = val;
      }
      i++;
      continue;
    }

    // No inline value — collect array items (scalar or object)
    const items = [];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      const objItemMatch = next.match(/^[ \t]+-\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
      const scalarItemMatch = next.match(/^[ \t]+-\s+([^:\n]+)$/);

      if (objItemMatch) {
        // Start of an object item
        const obj = {};
        obj[objItemMatch[1]] = objItemMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
        i++;
        // Collect continuation lines for this object
        while (i < lines.length) {
          const cont = lines[i];
          const contMatch = cont.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
          if (contMatch && !cont.match(/^[ \t]+-\s/)) {
            contMatch[2] = contMatch[2].trim();
            obj[contMatch[1]] = contMatch[2].replace(/^["'](.*)["']$/, '$1');
            i++;
          } else {
            break;
          }
        }
        items.push(obj);
      } else if (scalarItemMatch) {
        items.push(scalarItemMatch[1].trim().replace(/^["'](.*)["']$/, '$1'));
        i++;
      } else {
        break;
      }
    }

    if (items.length > 0) {
      data[key] = items;
    }
    // If no items and no inline value, key stays unset (null)
  }
  return data;
}

// ========== Validators ==========

function validateBacklogItem(filePath, data, errors) {
  const rel = path.basename(filePath);

  // Required fields
  for (const field of REQUIRED_BACKLOG_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      errors.push({ file: rel, field, msg: `missing required field "${field}"` });
    }
  }

  // Type check
  if (data.type && data.type !== 'backlog-issue') {
    errors.push({ file: rel, field: 'type', msg: `expected "backlog-issue", got "${data.type}"` });
  }

  // ID format
  if (data.id && !/^PM-\d{3,}$/.test(data.id)) {
    errors.push({ file: rel, field: 'id', msg: `invalid ID format "${data.id}" — expected PM-NNN` });
  }

  // Status enum
  if (data.status && !VALID_STATUSES.includes(data.status)) {
    errors.push({ file: rel, field: 'status', msg: `invalid status "${data.status}" — valid: ${VALID_STATUSES.join(', ')}` });
  }

  // Priority enum
  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    errors.push({ file: rel, field: 'priority', msg: `invalid priority "${data.priority}" — valid: ${VALID_PRIORITIES.join(', ')}` });
  }

  // Optional enum fields
  if (data.evidence_strength && !VALID_EVIDENCE.includes(data.evidence_strength)) {
    errors.push({ file: rel, field: 'evidence_strength', msg: `invalid value "${data.evidence_strength}" — valid: ${VALID_EVIDENCE.join(', ')}` });
  }

  if (data.scope_signal && !VALID_SCOPE.includes(data.scope_signal)) {
    errors.push({ file: rel, field: 'scope_signal', msg: `invalid value "${data.scope_signal}" — valid: ${VALID_SCOPE.join(', ')}` });
  }

  if (data.competitor_gap && !VALID_GAP.includes(data.competitor_gap)) {
    errors.push({ file: rel, field: 'competitor_gap', msg: `invalid value "${data.competitor_gap}" — valid: ${VALID_GAP.join(', ')}` });
  }

  // Date format
  for (const field of ['created', 'updated']) {
    if (data[field] && !/^\d{4}-\d{2}-\d{2}$/.test(data[field])) {
      errors.push({ file: rel, field, msg: `invalid date format "${data[field]}" — expected YYYY-MM-DD` });
    }
  }

  return data;
}

function validateStrategy(filePath, data, errors) {
  const rel = path.basename(filePath);

  for (const field of REQUIRED_STRATEGY_FIELDS) {
    if (data[field] === undefined || data[field] === null) {
      errors.push({ file: rel, field, msg: `missing required field "${field}"` });
    }
  }

  if (data.type && data.type !== 'strategy') {
    errors.push({ file: rel, field: 'type', msg: `expected "strategy", got "${data.type}"` });
  }
}

function validateMemory(filePath, data, errors, warnings) {
  const rel = path.basename(filePath);

  // Type check
  if (data.type !== 'project-memory') {
    errors.push({ file: rel, field: 'type', msg: `expected "project-memory", got "${data.type}"` });
  }

  // Required top-level date fields
  for (const field of ['created', 'updated']) {
    if (!data[field]) {
      errors.push({ file: rel, field, msg: `missing required field "${field}"` });
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(data[field])) {
      errors.push({ file: rel, field, msg: `invalid date format "${data[field]}" — expected YYYY-MM-DD` });
    }
  }

  // Entries must be an array
  if (!Array.isArray(data.entries)) {
    errors.push({ file: rel, field: 'entries', msg: 'missing or invalid "entries" — expected an array' });
    return;
  }

  // Validate each entry
  for (let idx = 0; idx < data.entries.length; idx++) {
    const entry = data.entries[idx];
    const label = `entry[${idx}]`;

    if (typeof entry !== 'object' || entry === null) {
      errors.push({ file: rel, field: label, msg: 'entry is not an object' });
      continue;
    }

    // Required fields
    for (const field of REQUIRED_MEMORY_ENTRY_FIELDS) {
      if (!entry[field]) {
        errors.push({ file: rel, field: `${label}.${field}`, msg: `missing required field "${field}"` });
      }
    }

    // Date format
    if (entry.date && !/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
      errors.push({ file: rel, field: `${label}.date`, msg: `invalid date format "${entry.date}" — expected YYYY-MM-DD` });
    }

    // Category enum
    if (entry.category && !VALID_MEMORY_CATEGORIES.includes(entry.category)) {
      errors.push({ file: rel, field: `${label}.category`, msg: `invalid category "${entry.category}" — valid: ${VALID_MEMORY_CATEGORIES.join(', ')}` });
    }
  }

  // Warn if too many entries
  if (data.entries.length > 50) {
    warnings.push({ file: rel, field: 'entries', msg: `memory.md has ${data.entries.length} entries — consider archiving older entries` });
  }
}

// ========== Main ==========

function validate(pmDir) {
  const errors = [];
  const warnings = [];
  const backlogIds = new Map(); // id -> file

  // --- Backlog validation ---
  const backlogDir = path.join(pmDir, 'backlog');
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const filePath = path.join(backlogDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      const data = parseFrontmatter(content);

      if (!data) {
        errors.push({ file, field: '-', msg: 'no YAML frontmatter found' });
        continue;
      }

      validateBacklogItem(filePath, data, errors);

      // ID collision detection
      if (data.id) {
        if (backlogIds.has(data.id)) {
          errors.push({ file, field: 'id', msg: `duplicate ID "${data.id}" — also used by ${backlogIds.get(data.id)}` });
        } else {
          backlogIds.set(data.id, file);
        }
      }

      // Parent reference check
      if (data.parent && data.parent !== 'null') {
        // parent is a slug — check the file exists
        const parentFile = data.parent + '.md';
        if (!fs.existsSync(path.join(backlogDir, parentFile))) {
          warnings.push({ file, field: 'parent', msg: `parent "${data.parent}" not found in backlog/` });
        }
      }

      // Children reference check
      if (Array.isArray(data.children)) {
        for (const child of data.children) {
          const childFile = child + '.md';
          if (!fs.existsSync(path.join(backlogDir, childFile))) {
            warnings.push({ file, field: 'children', msg: `child "${child}" not found in backlog/` });
          }
        }
      }
    }

    // ID gap detection
    const ids = Array.from(backlogIds.keys())
      .map(id => parseInt(id.replace('PM-', ''), 10))
      .filter(n => !isNaN(n))
      .sort((a, b) => a - b);

    if (ids.length > 0) {
      const maxId = ids[ids.length - 1];
      const minId = ids[0];
      const gaps = [];
      for (let i = minId; i <= maxId; i++) {
        if (!ids.includes(i)) {
          gaps.push(`PM-${String(i).padStart(3, '0')}`);
        }
      }
      if (gaps.length > 0) {
        warnings.push({ file: 'backlog/', field: 'id', msg: `ID gaps: ${gaps.join(', ')}` });
      }
    }
  }

  // --- Strategy validation ---
  const strategyPath = path.join(pmDir, 'strategy.md');
  if (fs.existsSync(strategyPath)) {
    const content = fs.readFileSync(strategyPath, 'utf8');
    const data = parseFrontmatter(content);
    if (!data) {
      errors.push({ file: 'strategy.md', field: '-', msg: 'no YAML frontmatter found' });
    } else {
      validateStrategy(strategyPath, data, errors);
    }
  }

  // --- Memory validation ---
  const memoryPath = path.join(pmDir, 'memory.md');
  if (fs.existsSync(memoryPath)) {
    const content = fs.readFileSync(memoryPath, 'utf8');
    const data = parseFrontmatter(content);
    if (!data) {
      errors.push({ file: 'memory.md', field: '-', msg: 'no YAML frontmatter found' });
    } else {
      validateMemory(memoryPath, data, errors, warnings);
    }
  }

  return { errors, warnings, backlogCount: backlogIds.size };
}

// ========== CLI ==========

function main() {
  const args = process.argv.slice(2);
  let pmDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      pmDir = args[i + 1];
      i++;
    }
  }

  if (!pmDir) {
    // Default: look for pm/ in cwd
    pmDir = path.join(process.cwd(), 'pm');
  }

  if (!fs.existsSync(pmDir)) {
    console.log(JSON.stringify({ ok: false, error: `pm directory not found: ${pmDir}` }));
    process.exit(1);
  }

  const { errors, warnings, backlogCount } = validate(pmDir);

  const result = {
    ok: errors.length === 0,
    backlog_items: backlogCount,
    errors: errors.length,
    warnings: warnings.length,
    details: []
  };

  for (const e of errors) {
    result.details.push({ level: 'error', file: e.file, field: e.field, message: e.msg });
  }
  for (const w of warnings) {
    result.details.push({ level: 'warning', file: w.file, field: w.field, message: w.msg });
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
