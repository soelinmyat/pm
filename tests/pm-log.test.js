'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PM_LOG = path.join(ROOT, 'scripts', 'pm-log.sh');
const PM_BASELINE = path.join(ROOT, 'scripts', 'pm-baseline.js');

function setupRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-log-test-'));
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'pm.local.md'), '---\nanalytics: true\n---\n');
  childProcess.execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.email', 'pm@example.com'], { cwd: root, stdio: 'ignore' });
  childProcess.execFileSync('git', ['config', 'user.name', 'PM Test'], { cwd: root, stdio: 'ignore' });
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function readJsonLines(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

test('legacy activity logging still writes activity.jsonl', () => {
  const { root, cleanup } = setupRepo();
  try {
    childProcess.execFileSync(PM_LOG, ['dev', 'invoked', 'args=demo'], { cwd: root, stdio: 'ignore' });
    const records = readJsonLines(path.join(root, '.pm', 'analytics', 'activity.jsonl'));
    assert.equal(records.length, 1);
    assert.equal(records[0].skill, 'dev');
    assert.equal(records[0].event, 'invoked');
    assert.equal(records[0].detail, 'args=demo');
  } finally {
    cleanup();
  }
});

test('run-start, step, and run-end write structured telemetry', () => {
  const { root, cleanup } = setupRepo();
  try {
    const runId = childProcess.execFileSync(
      PM_LOG,
      ['run-start', '--skill', 'groom', '--args', 'tracking'],
      { cwd: root, encoding: 'utf8' }
    ).trim();
    assert.ok(runId.length > 10);

    childProcess.execFileSync(
      PM_LOG,
      [
        'step',
        '--skill', 'groom',
        '--run-id', runId,
        '--phase', 'scope',
        '--step', 'scope-definition',
        '--status', 'completed',
        '--started-at', '2026-04-04T01:00:00.000Z',
        '--ended-at', '2026-04-04T01:00:05.000Z',
        '--input-chars', '80',
        '--output-chars', '40',
        '--files-read', '2',
        '--files-written', '1',
        '--meta-json', '{"state":"ok"}',
      ],
      { cwd: root, stdio: 'ignore' }
    );

    childProcess.execFileSync(
      PM_LOG,
      ['run-end', '--skill', 'groom', '--run-id', runId, '--status', 'completed'],
      { cwd: root, stdio: 'ignore' }
    );

    const activity = readJsonLines(path.join(root, '.pm', 'analytics', 'activity.jsonl'));
    const steps = readJsonLines(path.join(root, '.pm', 'analytics', 'steps.jsonl'));

    assert.equal(activity.length, 2);
    assert.equal(activity[0].event, 'started');
    assert.equal(activity[0].run_id, runId);
    assert.equal(activity[1].event, 'completed');
    assert.equal(activity[1].status, 'completed');

    assert.equal(steps.length, 1);
    assert.equal(steps[0].run_id, runId);
    assert.equal(steps[0].phase, 'scope');
    assert.equal(steps[0].step, 'scope-definition');
    assert.equal(steps[0].duration_ms, 5000);
    assert.equal(steps[0].est_input_tokens, 20);
    assert.equal(steps[0].est_output_tokens, 10);
    assert.equal(steps[0].token_source, 'estimated');
    assert.equal(steps[0].files_read, 2);
    assert.equal(steps[0].files_written, 1);
    assert.deepEqual(steps[0].meta, { state: 'ok' });
  } finally {
    cleanup();
  }
});

test('baseline generator reports empty corpus and populated corpus', () => {
  const { root, cleanup } = setupRepo();
  try {
    const emptyOutput = childProcess.execFileSync(
      'node',
      [PM_BASELINE, '--project-dir', root],
      { encoding: 'utf8' }
    );
    assert.match(emptyOutput, /No telemetry runs have been captured yet/);

    const runId = childProcess.execFileSync(
      PM_LOG,
      ['run-start', '--skill', 'review'],
      { cwd: root, encoding: 'utf8' }
    ).trim();
    childProcess.execFileSync(
      PM_LOG,
      [
        'step',
        '--skill', 'review',
        '--run-id', runId,
        '--phase', 'review',
        '--step', 'parallel-review',
        '--status', 'completed',
        '--duration-ms', '120000',
        '--input-chars', '400',
        '--output-chars', '100',
      ],
      { cwd: root, stdio: 'ignore' }
    );

    const outputPath = path.join(root, 'baseline.md');
    childProcess.execFileSync(
      'node',
      [PM_BASELINE, '--project-dir', root, '--output', outputPath],
      { stdio: 'ignore' }
    );
    const baseline = fs.readFileSync(outputPath, 'utf8');
    assert.match(baseline, /Runs captured: 1/);
    assert.match(baseline, /review — review \/ parallel-review/);
  } finally {
    cleanup();
  }
});
