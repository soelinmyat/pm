'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const VALIDATE_SCRIPT = path.join(__dirname, '..', 'scripts', 'validate.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withPmDir(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
  const pmDir = path.join(root, 'pm');
  fs.mkdirSync(path.join(pmDir, 'backlog'), { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    pmDir,
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

function runValidate(pmDir) {
  try {
    const stdout = execFileSync('node', [VALIDATE_SCRIPT, '--dir', pmDir], { encoding: 'utf8' });
    return JSON.parse(stdout);
  } catch (err) {
    return JSON.parse(err.stdout);
  }
}

function makeBacklogItem(overrides = {}) {
  const defaults = {
    type: 'backlog-issue',
    id: 'PM-001',
    title: 'Test item',
    outcome: 'Something happens',
    status: 'idea',
    priority: 'medium',
    parent: 'null',
    children: [],
    created: '2026-03-14',
    updated: '2026-03-14',
  };
  const d = { ...defaults, ...overrides };
  let fm = '---\n';
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        fm += `${k}: []\n`;
      } else {
        fm += `${k}:\n`;
        for (const item of v) fm += `  - "${item}"\n`;
      }
    } else {
      fm += `${k}: ${v}\n`;
    }
  }
  fm += '---\n\n## Outcome\n\nTest outcome.\n';
  return fm;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('valid backlog item passes validation', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/test-item.md': makeBacklogItem(),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true);
  assert.equal(result.backlog_items, 1);
  assert.equal(result.errors, 0);
});

test('missing required field reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/bad.md': makeBacklogItem({ status: undefined }),
  });
  // Remove the status line manually since makeBacklogItem writes "status: undefined"
  const filePath = path.join(pmDir, 'backlog', 'bad.md');
  const content = fs.readFileSync(filePath, 'utf8').replace(/^status:.*\n/m, '');
  fs.writeFileSync(filePath, content);
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const statusErr = result.details.find(d => d.field === 'status' && d.level === 'error');
  assert.ok(statusErr, 'should report missing status field');
});

test('invalid status enum reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/bad-status.md': makeBacklogItem({ status: 'yolo' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.field === 'status');
  assert.ok(err);
  assert.ok(err.message.includes('yolo'));
});

test('invalid priority enum reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/bad-prio.md': makeBacklogItem({ priority: 'urgent' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.field === 'priority');
  assert.ok(err);
  assert.ok(err.message.includes('urgent'));
});

test('invalid ID format reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/bad-id.md': makeBacklogItem({ id: 'ISSUE-1' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.field === 'id');
  assert.ok(err);
  assert.ok(err.message.includes('ISSUE-1'));
});

test('duplicate IDs report error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item-a.md': makeBacklogItem({ id: 'PM-001', title: 'First' }),
    'pm/backlog/item-b.md': makeBacklogItem({ id: 'PM-001', title: 'Duplicate' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.message.includes('duplicate'));
  assert.ok(err, 'should report duplicate ID');
});

test('ID gaps produce warnings', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/item-a.md': makeBacklogItem({ id: 'PM-001' }),
    'pm/backlog/item-c.md': makeBacklogItem({ id: 'PM-003' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, 'gaps are warnings, not errors');
  const warn = result.details.find(d => d.level === 'warning' && d.message.includes('PM-002'));
  assert.ok(warn, 'should warn about PM-002 gap');
});

test('broken parent reference produces warning', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/child.md': makeBacklogItem({ id: 'PM-001', parent: 'nonexistent-parent' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, 'broken refs are warnings, not errors');
  const warn = result.details.find(d => d.level === 'warning' && d.field === 'parent');
  assert.ok(warn, 'should warn about missing parent');
});

test('broken children reference produces warning', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/parent.md': makeBacklogItem({ id: 'PM-001', children: ['ghost-child'] }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true, 'broken refs are warnings, not errors');
  const warn = result.details.find(d => d.level === 'warning' && d.field === 'children');
  assert.ok(warn, 'should warn about missing child');
});

test('invalid date format reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/bad-date.md': makeBacklogItem({ created: 'March 14' }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.field === 'created');
  assert.ok(err);
  assert.ok(err.message.includes('March 14'));
});

test('strategy.md with wrong type reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/strategy.md': '---\ntype: oops\n---\n\n# Strategy\n',
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.file === 'strategy.md');
  assert.ok(err);
});

test('valid optional enum fields pass', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/full.md': makeBacklogItem({
      evidence_strength: 'strong',
      scope_signal: 'small',
      competitor_gap: 'unique',
    }),
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, true);
  assert.equal(result.errors, 0);
});

test('no frontmatter reports error', (t) => {
  const { pmDir, cleanup } = withPmDir({
    'pm/backlog/no-fm.md': '# Just a heading\n\nNo frontmatter here.\n',
  });
  t.after(cleanup);

  const result = runValidate(pmDir);
  assert.equal(result.ok, false);
  const err = result.details.find(d => d.message.includes('no YAML frontmatter'));
  assert.ok(err);
});

test('real pm/ directory passes validation', (t) => {
  const realPmDir = path.join(__dirname, '..', 'pm');
  if (!fs.existsSync(realPmDir)) {
    t.skip('no pm/ directory in repo');
    return;
  }
  const result = runValidate(realPmDir);
  assert.equal(result.ok, true, `validation failed: ${JSON.stringify(result.details)}`);
});
