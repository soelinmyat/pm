"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  recentMergedBranches,
  scanSessionDirectory,
  tsv,
} = require("../scripts/dev-reconcile-scan");

test("reconcile scan parses each canonical session once and excludes completed archives", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reconcile-scan-"));
  try {
    write(root, "active/session.json", {
      schema_version: 2,
      status: "active",
      task: { reference: "PM-42" },
      source: { branch: "codex/active" },
    });
    write(root, "complete/session.json", {
      schema_version: 2,
      status: "complete",
      task: { reference: "PM-41" },
      source: { branch: "codex/complete" },
    });
    write(root, "completed/old/session.json", {
      schema_version: 2,
      status: "complete",
      task: { reference: "PM-40" },
      source: { branch: "codex/old" },
    });
    const records = scanSessionDirectory(root);
    assert.deepEqual(
      records.map((record) => record.issue),
      ["PM-42"]
    );
    assert.match(tsv(records), /^PM-42\tcodex\/active\t/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconcile scan preserves legacy plain branch fields", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-reconcile-scan-"));
  try {
    fs.writeFileSync(path.join(root, "legacy.md"), "# CLE-1380\n\nbranch: feat/x\n");
    assert.deepEqual(
      scanSessionDirectory(root).map(({ issue, branch }) => ({ issue, branch })),
      [{ issue: "CLE-1380", branch: "feat/x" }]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconcile scan resolves recent merged branches with one retried list query", () => {
  let calls = 0;
  const branches = recentMergedBranches(48, {
    now: Date.parse("2026-07-12T12:00:00Z"),
    backoffMs: 0,
    sleep: () => {},
    runGh: () => {
      calls += 1;
      if (calls === 1) return { code: 1, stdout: "", stderr: "HTTP 502" };
      return {
        code: 0,
        stderr: "",
        stdout: JSON.stringify([
          {
            state: "MERGED",
            headRefName: "feat/recent",
            mergedAt: "2026-07-12T11:00:00Z",
          },
          {
            state: "MERGED",
            headRefName: "feat/old",
            mergedAt: "2026-07-01T11:00:00Z",
          },
        ]),
      };
    },
  });
  assert.deepEqual([...branches], ["feat/recent"]);
  assert.equal(calls, 2);
});

function write(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
}
