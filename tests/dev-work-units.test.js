"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  analyzeWorkUnits,
  narrowAuthority,
  ownershipOverlaps,
  validateWorkUnitResult,
  validateWorkUnits,
} = require("../scripts/lib/dev-work-units");

function unit(id, overrides = {}) {
  return {
    id,
    title: `Unit ${id}`,
    depends_on: [],
    owns: [`src/${id}/**`],
    status: "pending",
    ...overrides,
  };
}

test("validateWorkUnits: rejects duplicate IDs, missing dependencies, and cycles", () => {
  assert.throws(() => validateWorkUnits([unit("a"), unit("a")]), /duplicate work unit id: a/);
  assert.throws(
    () => validateWorkUnits([unit("a", { depends_on: ["missing"] })]),
    /unknown dependency missing/
  );
  assert.throws(
    () => validateWorkUnits([unit("escape", { owns: ["../shared/**"] })]),
    /repo-relative/
  );
  assert.throws(
    () => validateWorkUnits([unit("absolute", { owns: ["/tmp/file"] })]),
    /repo-relative/
  );
  assert.throws(
    () => validateWorkUnits([unit("a", { depends_on: ["b"] }), unit("b", { depends_on: ["a"] })]),
    /dependency cycle/
  );
});

test("analyzeWorkUnits: a pending unit is ready only after every dependency completes", () => {
  const analysis = analyzeWorkUnits([
    unit("schema", { status: "completed" }),
    unit("runtime", { depends_on: ["schema"] }),
    unit("docs", { depends_on: ["runtime"] }),
  ]);

  assert.deepEqual(
    analysis.ready.map((item) => item.id),
    ["runtime"]
  );
  assert.deepEqual(
    analysis.runnable.map((item) => item.id),
    ["runtime"]
  );
  assert.deepEqual(
    analysis.waiting.map((item) => item.id),
    ["docs"]
  );
});

test("analyzeWorkUnits: independent ownership can run together", () => {
  const analysis = analyzeWorkUnits([
    unit("api", { owns: ["apps/api/**"] }),
    unit("web", { owns: ["apps/web/**"] }),
  ]);

  assert.deepEqual(
    analysis.runnable.map((item) => item.id),
    ["api", "web"]
  );
  assert.deepEqual(analysis.serialized, []);
});

test("analyzeWorkUnits: overlapping ready units serialize deterministically", () => {
  const analysis = analyzeWorkUnits([
    unit("first", { owns: ["scripts/dev-runtime/**"] }),
    unit("second", { owns: ["scripts/dev-runtime/codex.js"] }),
    unit("third", { owns: ["tests/**"] }),
  ]);

  assert.deepEqual(
    analysis.runnable.map((item) => item.id),
    ["first", "third"]
  );
  assert.deepEqual(analysis.serialized, [
    { id: "second", conflicts_with: ["first"], reason: "ownership overlap" },
  ]);
});

test("analyzeWorkUnits: running ownership serializes a newly ready unit", () => {
  const analysis = analyzeWorkUnits([
    unit("active", { owns: ["src/shared/**"], status: "running" }),
    unit("next", { owns: ["src/shared/config.js"] }),
  ]);

  assert.deepEqual(analysis.runnable, []);
  assert.deepEqual(analysis.serialized[0].conflicts_with, ["active"]);
});

test("ownershipOverlaps: compares exact paths, directory globs, and unknown glob roots conservatively", () => {
  assert.equal(ownershipOverlaps(["src/a.js"], ["src/a.js"]), true);
  assert.equal(ownershipOverlaps(["src"], ["src/a.js"]), true);
  assert.equal(ownershipOverlaps(["src/**"], ["src/a.js"]), true);
  assert.equal(ownershipOverlaps(["src/a/**"], ["src/b/**"]), false);
  assert.equal(ownershipOverlaps(["src/*/config.js"], ["src/api/config.js"]), true);
});

test("narrowAuthority: omitted actions become denied and granted actions may be narrowed", () => {
  const parent = {
    local_writes: true,
    commit: true,
    push_feature_branch: true,
    create_pr: false,
    merge: false,
    tracker_updates: false,
  };

  assert.deepEqual(narrowAuthority(parent, { local_writes: true, commit: false }), {
    local_writes: true,
    commit: false,
    push_feature_branch: false,
    create_pr: false,
    merge: false,
    tracker_updates: false,
  });
});

test("narrowAuthority: a worker cannot grant itself authority or invent an action", () => {
  const parent = { local_writes: true, commit: true, merge: false };

  assert.throws(() => narrowAuthority(parent, { merge: true }), /cannot expand authority: merge/);
  assert.throws(
    () => narrowAuthority(parent, { deploy: true }),
    /unknown authority action: deploy/
  );
});

test("validateWorkUnitResult: accepts the same completed envelope for any provider", () => {
  for (const provider of ["codex", "claude", "inline"]) {
    const result = validateWorkUnitResult(
      {
        schema_version: 1,
        work_unit_id: "runtime",
        status: "completed",
        summary: "Implemented and tested.",
        commit: "abc123",
        files_changed: 2,
        evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
        blocker: null,
        runtime: { provider, model: "configured-workhorse" },
      },
      { expectedWorkUnitId: "runtime" }
    );
    assert.equal(result.runtime.provider, provider);
  }
});

test("validateWorkUnitResult: rejects merged, mismatched, and evidence-free completion", () => {
  const base = {
    schema_version: 1,
    work_unit_id: "runtime",
    status: "completed",
    summary: "Done.",
    commit: "abc123",
    files_changed: 1,
    evidence: [{ kind: "test", command: "node --test", exit_code: 0 }],
    blocker: null,
    runtime: { provider: "codex", model: "configured" },
  };

  assert.throws(() => validateWorkUnitResult({ ...base, status: "merged" }), /invalid status/);
  assert.throws(
    () => validateWorkUnitResult(base, { expectedWorkUnitId: "other" }),
    /work unit id mismatch/
  );
  assert.throws(
    () => validateWorkUnitResult({ ...base, evidence: [] }),
    /completed result requires evidence/
  );
  assert.throws(
    () => validateWorkUnitResult({ ...base, commit: null }),
    /completed result requires commit/
  );
  assert.throws(
    () => validateWorkUnitResult({ ...base, evidence: [{ kind: "test", exit_code: 1 }] }),
    /passing evidence/
  );
});

test("validateWorkUnitResult: blocked and failed results require a structured blocker", () => {
  const blocked = {
    schema_version: 1,
    work_unit_id: "runtime",
    status: "blocked",
    summary: "Could not continue.",
    reason: "Missing product decision",
    commit: null,
    files_changed: 0,
    evidence: [],
    blocker: { reason: "Missing product decision", remediation: "Choose API behavior" },
    runtime: { provider: "inline", model: "inherit" },
  };

  assert.doesNotThrow(() => validateWorkUnitResult(blocked));
  assert.throws(
    () => validateWorkUnitResult({ ...blocked, reason: undefined, blocker: null }),
    /blocked result requires reason/
  );
});

test("validateWorkUnitResult: verifies completed commit HEAD, file count, and ownership", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-"));
  try {
    execFileSync("git", ["init", "-q", worktree]);
    execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
    fs.mkdirSync(path.join(worktree, "src"));
    fs.writeFileSync(path.join(worktree, "src", "owned.js"), "export default true;\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "worker result"]);
    const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = {
      schema_version: 1,
      work_unit_id: "owned",
      status: "completed",
      summary: "Done.",
      commit,
      files_changed: 1,
      evidence: [{ kind: "test", exit_code: 0 }],
      blocker: null,
      runtime: { provider: "codex" },
    };

    assert.doesNotThrow(() =>
      validateWorkUnitResult(result, {
        expectedWorkUnitId: "owned",
        expectedOwnership: ["src/**"],
        worktree,
      })
    );
    assert.throws(
      () =>
        validateWorkUnitResult(result, {
          expectedOwnership: ["tests/**"],
          worktree,
        }),
      /outside assigned ownership: src\/owned\.js/
    );
    assert.throws(
      () =>
        validateWorkUnitResult(
          { ...result, commit: "deadbeef" },
          { expectedOwnership: ["src/**"], worktree }
        ),
      /could not verify worker commit/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("validateWorkUnitResult checks the full assigned commit range and a clean worktree", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-range-"));
  try {
    execFileSync("git", ["init", "-q", worktree]);
    execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
    fs.writeFileSync(path.join(worktree, "base.txt"), "base\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "base"]);
    const baseCommit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    fs.mkdirSync(path.join(worktree, "src"));
    fs.writeFileSync(path.join(worktree, "src", "a.js"), "a\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "owned"]);
    fs.writeFileSync(path.join(worktree, "escape.txt"), "escape\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "escape"]);
    const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = {
      schema_version: 1,
      work_unit_id: "range",
      status: "completed",
      summary: "Done",
      commit,
      files_changed: 2,
      evidence: [{ kind: "test", exit_code: 0 }],
      blocker: null,
      runtime: { provider: "inline" },
    };
    assert.throws(
      () =>
        validateWorkUnitResult(result, {
          expectedOwnership: ["src/**/*.js"],
          worktree,
          baseCommit,
        }),
      /outside assigned ownership: escape\.txt/
    );
    fs.writeFileSync(path.join(worktree, "dirty.txt"), "dirty\n");
    assert.throws(
      () =>
        validateWorkUnitResult(result, {
          expectedOwnership: ["**"],
          worktree,
          baseCommit,
        }),
      /worktree is dirty/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership globstar matches both zero-depth and nested paths", () => {
  assert.equal(ownershipOverlaps(["src/**/*.js"], ["src/a.js"]), true);
  assert.equal(ownershipOverlaps(["src/**/*.js"], ["src/nested/a.js"]), true);
});
