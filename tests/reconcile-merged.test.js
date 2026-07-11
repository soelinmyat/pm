"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const RECONCILE = path.join(ROOT, "hooks", "reconcile-merged");

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-merged-"));
  const project = path.join(tmp, "project");
  fs.mkdirSync(path.join(project, ".pm", "dev-sessions"), { recursive: true });
  // reconcile-merged only runs when Linear is configured.
  fs.writeFileSync(
    path.join(project, ".pm", "config.json"),
    JSON.stringify({ linear: true }, null, 2)
  );
  const binDir = path.join(tmp, "bin");
  fs.mkdirSync(binDir);
  return {
    tmp,
    project,
    binDir,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

function writeSession(project, name, body) {
  fs.writeFileSync(path.join(project, ".pm", "dev-sessions", name), body);
}

function installGhStub(binDir, lines) {
  const stub = ["#!/usr/bin/env bash", ...lines].join("\n");
  const p = path.join(binDir, "gh");
  fs.writeFileSync(p, `${stub}\n`);
  fs.chmodSync(p, 0o755);
}

const LIST_BRANCH = [
  'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
  '  echo \'[{"number":1,"title":"Fix","headRefName":"feat/x","mergedAt":"2999-01-01T00:00:00Z","state":"MERGED"}]\'',
  "  exit 0",
  "fi",
];

function run(project, binDir, extraEnv = {}) {
  return childProcess.execFileSync(RECONCILE, {
    env: {
      ...process.env,
      CLAUDE_PROJECT_DIR: project,
      CLAUDE_PLUGIN_ROOT: ROOT,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

test("reconcile-merged flags a stale issue when its branch PR is merged", () => {
  const { project, binDir, cleanup } = setup();
  try {
    installGhStub(binDir, [...LIST_BRANCH, "exit 0"]);
    writeSession(project, "feat-x.md", "# CLE-1380\n\nbranch: feat/x\n");

    const out = run(project, binDir);
    assert.match(out, /Post-merge reconciliation needed/);
    assert.match(out, /CLE-1380/);
    assert.match(out, /feat\/x/);
  } finally {
    cleanup();
  }
});

test("reconcile-merged stays silent when the branch PR is still open", () => {
  const { project, binDir, cleanup } = setup();
  try {
    installGhStub(binDir, [
      'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then echo "[]"; exit 0; fi',
      "exit 0",
    ]);
    writeSession(project, "feat-x.md", "# CLE-1380\n\nbranch: feat/x\n");

    const out = run(project, binDir);
    assert.equal(out.trim(), "", "no advice when the PR is not merged");
  } finally {
    cleanup();
  }
});

test("reconcile-merged survives a transient 5xx on the state check (retry via pr-state.js)", () => {
  const { project, binDir, tmp, cleanup } = setup();
  try {
    const counter = path.join(tmp, "gh-list-count");
    // Fail the consolidated merged-PR query with HTTP 502 twice, then return
    // the branch. The shared retry wrapper must recover without N+1 requests.
    installGhStub(binDir, [
      'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
      '  n=0; [ -f "$GH_VIEW_COUNTER" ] && n=$(cat "$GH_VIEW_COUNTER")',
      '  n=$((n + 1)); echo "$n" > "$GH_VIEW_COUNTER"',
      '  if [ "$n" -le 2 ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi',
      `  echo '${JSON.stringify([
        {
          number: 1,
          title: "Fix",
          headRefName: "feat/x",
          mergedAt: "2999-01-01T00:00:00Z",
          state: "MERGED",
        },
      ])}'; exit 0`,
      "fi",
      "exit 0",
    ]);
    writeSession(project, "feat-x.md", "# CLE-1380\n\nbranch: feat/x\n");

    const out = run(project, binDir, {
      GH_VIEW_COUNTER: counter,
      PM_PR_STATE_BACKOFF_MS: "5",
    });
    assert.match(out, /CLE-1380/, "merged PR must be reconciled despite transient 5xx");
    assert.equal(fs.readFileSync(counter, "utf8").trim(), "3", "gh pr list retried to attempt 3");
  } finally {
    cleanup();
  }
});
