const fs = require('fs');
const path = require('path');

const STALE_DAYS = 30;
const AGING_DAYS = 14;

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: content };
  const data = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (m) data[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { data, body: match[2] || '' };
}

function fmValue(filePath, key) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseFrontmatter(content).data[key] || null;
  } catch { return null; }
}

function dateToEpoch(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  return isNaN(t) ? 0 : t / 1000;
}

function buildStatus(projectDir) {
  const pmDir = path.join(projectDir, 'pm');
  const now = Date.now() / 1000;
  const staleThreshold = now - STALE_DAYS * 86400;
  const agingThreshold = now - AGING_DAYS * 86400;

  let staleCount = 0;
  let agingCount = 0;

  // Scan research findings for staleness
  const researchDir = path.join(pmDir, 'research');
  if (fs.existsSync(researchDir)) {
    try {
      for (const entry of fs.readdirSync(researchDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const findings = path.join(researchDir, entry.name, 'findings.md');
        if (!fs.existsSync(findings)) continue;
        const epoch = dateToEpoch(fmValue(findings, 'updated'));
        if (epoch > 0 && epoch < staleThreshold) staleCount++;
      }
    } catch {}
  }

  // Scan competitor profiles for staleness
  const compDir = path.join(pmDir, 'competitors');
  if (fs.existsSync(compDir)) {
    try {
      for (const entry of fs.readdirSync(compDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const profile = path.join(compDir, entry.name, 'profile.md');
        if (!fs.existsSync(profile)) continue;
        const epoch = dateToEpoch(fmValue(profile, 'updated'));
        if (epoch > 0 && epoch < staleThreshold) staleCount++;
      }
    } catch {}
  }

  // Scan backlog for aging ideas and counts
  const backlogDir = path.join(pmDir, 'backlog');
  let ideas = 0, inProgress = 0, shipped = 0;

  if (fs.existsSync(backlogDir)) {
    try {
      for (const f of fs.readdirSync(backlogDir).filter(n => n.endsWith('.md'))) {
        const fp = path.join(backlogDir, f);
        const status = fmValue(fp, 'status');
        switch (status) {
          case 'idea':
          case 'drafted':
            ideas++;
            if (status === 'idea') {
              const epoch = dateToEpoch(fmValue(fp, 'updated'));
              if (epoch > 0 && epoch < agingThreshold) agingCount++;
            }
            break;
          case 'approved':
          case 'in-progress':
            inProgress++;
            break;
          case 'done':
            shipped++;
            break;
        }
      }
    } catch {}
  }

  // Focus line (attention)
  let focus;
  if (staleCount === 0 && agingCount === 0) {
    focus = 'All fresh';
  } else {
    const parts = [];
    if (staleCount > 0) parts.push(`${staleCount} stale`);
    if (agingCount > 0) parts.push(`${agingCount} aging ideas`);
    focus = parts.join(', ');
  }

  // Backlog line
  const backlog = `${ideas} ideas, ${inProgress} in progress, ${shipped} shipped`;

  // Next action
  let next;
  if (!fs.existsSync(path.join(pmDir, 'strategy.md'))) {
    next = '/pm:strategy';
  } else if (ideas === 0 && inProgress === 0 && shipped === 0) {
    next = '/pm:start (choose your first workflow)';
  } else if (staleCount > 0) {
    next = `/pm:refresh (${staleCount} stale items)`;
  } else if (agingCount > 3) {
    next = '/pm:groom (promote oldest ideas)';
  } else if (inProgress > 0) {
    // Find oldest in-progress issue
    let oldestTitle = null;
    let oldestEpoch = Infinity;
    try {
      for (const f of fs.readdirSync(backlogDir).filter(n => n.endsWith('.md'))) {
        const fp = path.join(backlogDir, f);
        const s = fmValue(fp, 'status');
        if (s !== 'in-progress' && s !== 'approved') continue;
        const epoch = dateToEpoch(fmValue(fp, 'updated'));
        if (epoch > 0 && epoch < oldestEpoch) {
          oldestEpoch = epoch;
          oldestTitle = fmValue(fp, 'title');
        }
      }
    } catch {}
    next = oldestTitle ? `/pm:dev (continue ${oldestTitle})` : '/pm:dev';
  } else {
    next = '/pm:groom ideate';
  }

  // Update check (no-op for now — local installs don't auto-update)
  const update = { available: false, message: '' };

  return { update, focus, backlog, next };
}

module.exports = { buildStatus };
