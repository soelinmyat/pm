#!/usr/bin/env node
// pm validate — checks pm/ artifact integrity
// Usage: node validate.js --dir <pm-directory>

const fs = require("fs");
const path = require("path");

// ========== Config ==========

const VALID_STATUSES = ["idea", "drafted", "approved", "in-progress", "done"];
const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const VALID_EVIDENCE = ["strong", "moderate", "weak"];
const VALID_SCOPE = ["small", "medium", "large"];
const VALID_GAP = ["unique", "partial", "parity", "behind"];

const REQUIRED_BACKLOG_FIELDS = [
  "type",
  "id",
  "title",
  "outcome",
  "status",
  "priority",
  "created",
  "updated",
];
const REQUIRED_STRATEGY_FIELDS = ["type"];

// ========== Frontmatter Parser ==========

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const lines = match[1].split("\n");
  const data = {};
  let currentKey = null;
  let currentArray = null;

  for (const line of lines) {
    // Array item
    if (/^\s+-\s+/.test(line) && currentKey) {
      const val = line.replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, "");
      if (!currentArray) currentArray = [];
      currentArray.push(val);
      data[currentKey] = currentArray;
      continue;
    }
    // Key-value
    const kv = line.match(/^(\w[\w_-]*):\s*(.*)/);
    if (kv) {
      // Save previous array
      currentKey = kv[1];
      currentArray = null;
      let val = kv[2].trim().replace(/^["']|["']$/g, "");
      if (val === "" || val === "null") {
        data[currentKey] = null;
      } else if (val === "true") {
        data[currentKey] = true;
      } else if (val === "false") {
        data[currentKey] = false;
      } else {
        data[currentKey] = val;
      }
    }
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
  if (data.type && data.type !== "backlog-issue") {
    errors.push({ file: rel, field: "type", msg: `expected "backlog-issue", got "${data.type}"` });
  }

  // ID format
  if (data.id && !/^PM-\d{3,}$/.test(data.id)) {
    errors.push({
      file: rel,
      field: "id",
      msg: `invalid ID format "${data.id}" — expected PM-NNN`,
    });
  }

  // Status enum
  if (data.status && !VALID_STATUSES.includes(data.status)) {
    errors.push({
      file: rel,
      field: "status",
      msg: `invalid status "${data.status}" — valid: ${VALID_STATUSES.join(", ")}`,
    });
  }

  // Priority enum
  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    errors.push({
      file: rel,
      field: "priority",
      msg: `invalid priority "${data.priority}" — valid: ${VALID_PRIORITIES.join(", ")}`,
    });
  }

  // Optional enum fields
  if (data.evidence_strength && !VALID_EVIDENCE.includes(data.evidence_strength)) {
    errors.push({
      file: rel,
      field: "evidence_strength",
      msg: `invalid value "${data.evidence_strength}" — valid: ${VALID_EVIDENCE.join(", ")}`,
    });
  }

  if (data.scope_signal && !VALID_SCOPE.includes(data.scope_signal)) {
    errors.push({
      file: rel,
      field: "scope_signal",
      msg: `invalid value "${data.scope_signal}" — valid: ${VALID_SCOPE.join(", ")}`,
    });
  }

  if (data.competitor_gap && !VALID_GAP.includes(data.competitor_gap)) {
    errors.push({
      file: rel,
      field: "competitor_gap",
      msg: `invalid value "${data.competitor_gap}" — valid: ${VALID_GAP.join(", ")}`,
    });
  }

  // Date format
  for (const field of ["created", "updated"]) {
    if (data[field] && !/^\d{4}-\d{2}-\d{2}$/.test(data[field])) {
      errors.push({
        file: rel,
        field,
        msg: `invalid date format "${data[field]}" — expected YYYY-MM-DD`,
      });
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

  if (data.type && data.type !== "strategy") {
    errors.push({ file: rel, field: "type", msg: `expected "strategy", got "${data.type}"` });
  }
}

// ========== Main ==========

function validate(pmDir) {
  const errors = [];
  const warnings = [];
  const backlogIds = new Map(); // id -> file

  // --- Backlog validation ---
  const backlogDir = path.join(pmDir, "backlog");
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(backlogDir, file);
      const content = fs.readFileSync(filePath, "utf8");
      const data = parseFrontmatter(content);

      if (!data) {
        errors.push({ file, field: "-", msg: "no YAML frontmatter found" });
        continue;
      }

      validateBacklogItem(filePath, data, errors);

      // ID collision detection
      if (data.id) {
        if (backlogIds.has(data.id)) {
          errors.push({
            file,
            field: "id",
            msg: `duplicate ID "${data.id}" — also used by ${backlogIds.get(data.id)}`,
          });
        } else {
          backlogIds.set(data.id, file);
        }
      }

      // Parent reference check
      if (data.parent && data.parent !== "null") {
        // parent is a slug — check the file exists
        const parentFile = data.parent + ".md";
        if (!fs.existsSync(path.join(backlogDir, parentFile))) {
          warnings.push({
            file,
            field: "parent",
            msg: `parent "${data.parent}" not found in backlog/`,
          });
        }
      }

      // Children reference check
      if (Array.isArray(data.children)) {
        for (const child of data.children) {
          const childFile = child + ".md";
          if (!fs.existsSync(path.join(backlogDir, childFile))) {
            warnings.push({
              file,
              field: "children",
              msg: `child "${child}" not found in backlog/`,
            });
          }
        }
      }
    }

    // ID gap detection
    const ids = Array.from(backlogIds.keys())
      .map((id) => parseInt(id.replace("PM-", ""), 10))
      .filter((n) => !isNaN(n))
      .sort((a, b) => a - b);

    if (ids.length > 0) {
      const maxId = ids[ids.length - 1];
      const minId = ids[0];
      const gaps = [];
      for (let i = minId; i <= maxId; i++) {
        if (!ids.includes(i)) {
          gaps.push(`PM-${String(i).padStart(3, "0")}`);
        }
      }
      if (gaps.length > 0) {
        warnings.push({ file: "backlog/", field: "id", msg: `ID gaps: ${gaps.join(", ")}` });
      }
    }
  }

  // --- Strategy validation ---
  const strategyPath = path.join(pmDir, "strategy.md");
  if (fs.existsSync(strategyPath)) {
    const content = fs.readFileSync(strategyPath, "utf8");
    const data = parseFrontmatter(content);
    if (!data) {
      errors.push({ file: "strategy.md", field: "-", msg: "no YAML frontmatter found" });
    } else {
      validateStrategy(strategyPath, data, errors);
    }
  }

  return { errors, warnings, backlogCount: backlogIds.size };
}

// ========== CLI ==========

function main() {
  const args = process.argv.slice(2);
  let pmDir = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      pmDir = args[i + 1];
      i++;
    }
  }

  if (!pmDir) {
    // Default: look for pm/ in cwd
    pmDir = path.join(process.cwd(), "pm");
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
    details: [],
  };

  for (const e of errors) {
    result.details.push({ level: "error", file: e.file, field: e.field, message: e.msg });
  }
  for (const w of warnings) {
    result.details.push({ level: "warning", file: w.file, field: w.field, message: w.msg });
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

main();
