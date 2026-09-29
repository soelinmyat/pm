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

test("validateWorkUnitResult matches owns entries that carry a trailing annotation", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-annotated-"));
  try {
    execFileSync("git", ["init", "-q", worktree]);
    execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
    fs.mkdirSync(path.join(worktree, "config"));
    fs.writeFileSync(path.join(worktree, "config", "application.rb"), "app\n");
    fs.writeFileSync(path.join(worktree, "config", "new_file.rb"), "new\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "annotated"]);
    const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const result = {
      schema_version: 1,
      work_unit_id: "annotated",
      status: "completed",
      summary: "Done.",
      commit,
      files_changed: 2,
      evidence: [{ kind: "test", exit_code: 0 }],
      blocker: null,
      runtime: { provider: "claude" },
    };

    assert.doesNotThrow(() =>
      validateWorkUnitResult(result, {
        expectedOwnership: [
          "config/application.rb (insert_after ActionDispatch::Executor only)",
          "config/new_file.rb (new; executor to_complete registration)",
        ],
        worktree,
      })
    );
    assert.throws(
      () =>
        validateWorkUnitResult(result, {
          expectedOwnership: ["config/application.rb (new)", "config/new_file.rb(new)"],
          worktree,
        }),
      /outside assigned ownership: config\/new_file\.rb/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownershipOverlaps: ignores trailing owns annotations", () => {
  assert.equal(ownershipOverlaps(["src/a.js (new)"], ["src/a.js"]), true);
  assert.equal(ownershipOverlaps(["src (helpers only)"], ["src/a.js (new)"]), true);
  assert.equal(ownershipOverlaps(["src/a.js (new)"], ["src/b.js (new)"]), false);
});

test("ownership: a real path ending in parentheses still owns itself", () => {
  assert.equal(ownershipOverlaps(["assets/Icons (old)"], ["assets/Icons (old)/a.png"]), true);

  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-paren-dir-"));
  try {
    execFileSync("git", ["init", "-q", worktree]);
    execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
    fs.mkdirSync(path.join(worktree, "assets", "Icons (old)"), { recursive: true });
    fs.writeFileSync(path.join(worktree, "assets", "Icons (old)", "a.png"), "png\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "paren dir"]);
    const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.doesNotThrow(() =>
      validateWorkUnitResult(
        {
          schema_version: 1,
          work_unit_id: "paren-dir",
          status: "completed",
          summary: "Done.",
          commit,
          files_changed: 1,
          evidence: [{ kind: "test", exit_code: 0 }],
          blocker: null,
          runtime: { provider: "claude" },
        },
        { expectedOwnership: ["assets/Icons (old)"], worktree }
      )
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: a real path ending in parentheses does not also own the stripped path", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-paren-widen-"));
  try {
    execFileSync("git", ["init", "-q", worktree]);
    execFileSync("git", ["-C", worktree, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", worktree, "config", "user.name", "Test"]);
    fs.mkdirSync(path.join(worktree, "src (copy)"));
    fs.mkdirSync(path.join(worktree, "src"));
    fs.writeFileSync(path.join(worktree, "src (copy)", "a.js"), "a\n");
    fs.writeFileSync(path.join(worktree, "src", "b.js"), "b\n");
    execFileSync("git", ["-C", worktree, "add", "."]);
    execFileSync("git", ["-C", worktree, "commit", "-qm", "both"]);
    const commit = execFileSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();

    assert.throws(
      () =>
        validateWorkUnitResult(
          {
            schema_version: 1,
            work_unit_id: "paren-widen",
            status: "completed",
            summary: "Done.",
            commit,
            files_changed: 2,
            evidence: [{ kind: "test", exit_code: 0 }],
            blocker: null,
            runtime: { provider: "claude" },
          },
          { expectedOwnership: ["src (copy)"], worktree }
        ),
      /outside assigned ownership: src\/b\.js/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: literal meaning holds for globs and survives moves out of the literal path", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-paren-glob-"));
  const git = (...args) =>
    execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
  const completed = (commit, filesChanged) => ({
    schema_version: 1,
    work_unit_id: "paren-glob",
    status: "completed",
    summary: "Done.",
    commit,
    files_changed: filesChanged,
    evidence: [{ kind: "test", exit_code: 0 }],
    blocker: null,
    runtime: { provider: "claude" },
  });
  try {
    execFileSync("git", ["init", "-q", worktree]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.mkdirSync(path.join(worktree, "src (copy)"));
    fs.writeFileSync(path.join(worktree, "src (copy)", "a.txt"), "moved content\n");
    fs.writeFileSync(path.join(worktree, "keep.txt"), "keep\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");

    fs.mkdirSync(path.join(worktree, "a"));
    fs.writeFileSync(path.join(worktree, "a", "Untitled (1)"), "u\n");
    git("add", ".");
    git("commit", "-qm", "glob literal");
    const globCommit = git("rev-parse", "HEAD");
    assert.doesNotThrow(() =>
      validateWorkUnitResult(completed(globCommit, 1), {
        expectedOwnership: ["**/Untitled (1)"],
        worktree,
        baseCommit: base,
      })
    );

    fs.mkdirSync(path.join(worktree, "src"));
    git("mv", "src (copy)/a.txt", "src/a.txt");
    fs.writeFileSync(path.join(worktree, "src", "new.txt"), "new\n");
    git("add", ".");
    git("commit", "-qm", "move out of literal path");
    const moveCommit = git("rev-parse", "HEAD");
    assert.throws(
      () =>
        validateWorkUnitResult(completed(moveCommit, 2), {
          expectedOwnership: ["src (copy)"],
          worktree,
          baseCommit: globCommit,
        }),
      /outside assigned ownership: src\/a\.txt, src\/new\.txt/
    );
    assert.throws(
      () =>
        validateWorkUnitResult(completed(moveCommit, 2), {
          expectedOwnership: ["src/**"],
          worktree,
          baseCommit: globCommit,
        }),
      /outside assigned ownership: src \(copy\)\/a\.txt/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: annotated entries resolve in repositories with over 1 MiB of path names", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-big-tree-"));
  const git = (...args) =>
    execFileSync("git", ["-C", worktree, ...args], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  try {
    execFileSync("git", ["init", "-q", worktree]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    const bulk = path.join(worktree, "d".repeat(200));
    fs.mkdirSync(bulk);
    for (let index = 0; index < 5500; index += 1) {
      fs.writeFileSync(path.join(bulk, `f${index}`), "");
    }
    fs.mkdirSync(path.join(worktree, "config"));
    fs.writeFileSync(path.join(worktree, "config", "application.rb"), "old\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    assert.ok(git("ls-tree", "-r", "--name-only", base).length > 1024 * 1024);

    fs.writeFileSync(path.join(worktree, "config", "application.rb"), "new\n");
    git("commit", "-qam", "edit");
    const commit = git("rev-parse", "HEAD");
    for (const owns of [
      ["config/application.rb (insert_after only)"],
      ["**/application.rb (insert_after only)"],
    ]) {
      assert.doesNotThrow(
        () =>
          validateWorkUnitResult(
            {
              schema_version: 1,
              work_unit_id: "big-tree",
              status: "completed",
              summary: "Done.",
              commit,
              files_changed: 1,
              evidence: [{ kind: "test", exit_code: 0 }],
              blocker: null,
              runtime: { provider: "claude" },
            },
            { expectedOwnership: owns, worktree, baseCommit: base }
          ),
        owns[0]
      );
    }
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: annotated entries are validated after the note is stripped", () => {
  assert.throws(() => ownershipOverlaps(["foo/.. (x)"], ["bar"]), /repo-relative/);
  assert.throws(() => ownershipOverlaps(["bar"], ["/abs/path (new)"]), /repo-relative/);
  assert.throws(
    () => validateWorkUnits([unit("annotated-escape", { owns: ["apps/.. (x)"] })]),
    /repo-relative/
  );
  assert.throws(() => ownershipOverlaps(["foo/.. (only f() call)"], ["bar"]), /repo-relative/);
  assert.throws(
    () => validateWorkUnits([unit("stacked-escape", { owns: ["apps/.. (a) (b)"] })]),
    /repo-relative/
  );
});

test("ownership: an annotated glob keeps its literal meaning when it names an untouched file", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-glob-untouched-"));
  const git = (...args) =>
    execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["init", "-q", worktree]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.mkdirSync(path.join(worktree, "src"));
    fs.writeFileSync(path.join(worktree, "src", "a (keep)"), "a\n");
    fs.writeFileSync(path.join(worktree, "src", "b"), "old\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(worktree, "src", "b"), "new\n");
    git("commit", "-qam", "edit b");
    const commit = git("rev-parse", "HEAD");
    assert.throws(
      () =>
        validateWorkUnitResult(
          {
            schema_version: 1,
            work_unit_id: "glob-untouched",
            status: "completed",
            summary: "Done.",
            commit,
            files_changed: 1,
            evidence: [{ kind: "test", exit_code: 0 }],
            blocker: null,
            runtime: { provider: "claude" },
          },
          { expectedOwnership: ["src/* (keep)"], worktree, baseCommit: base }
        ),
      /outside assigned ownership: src\/b/
    );
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: glob characters inside a note on a plain path are prose", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-glob-note-"));
  const git = (...args) =>
    execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
  try {
    execFileSync("git", ["init", "-q", worktree]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.writeFileSync(path.join(worktree, "docs"), "old\n");
    fs.writeFileSync(path.join(worktree, "docs (v1)"), "v1\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(worktree, "docs"), "new\n");
    git("commit", "-qam", "edit docs");
    const commit = git("rev-parse", "HEAD");
    for (const owns of ["docs (v?)", "docs (fix [typo] *now*)"]) {
      assert.doesNotThrow(
        () =>
          validateWorkUnitResult(
            {
              schema_version: 1,
              work_unit_id: "glob-note",
              status: "completed",
              summary: "Done.",
              commit,
              files_changed: 1,
              evidence: [{ kind: "test", exit_code: 0 }],
              blocker: null,
              runtime: { provider: "claude" },
            },
            { expectedOwnership: [owns], worktree, baseCommit: base }
          ),
        owns
      );
    }
  } finally {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test("ownership: notes with nested parentheses and stacked notes are stripped", () => {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "dev-work-unit-nested-note-"));
  const git = (...args) =>
    execFileSync("git", ["-C", worktree, ...args], { encoding: "utf8" }).trim();
  const completed = (commit) => ({
    schema_version: 1,
    work_unit_id: "nested-note",
    status: "completed",
    summary: "Done.",
    commit,
    files_changed: 1,
    evidence: [{ kind: "test", exit_code: 0 }],
    blocker: null,
    runtime: { provider: "claude" },
  });
  try {
    execFileSync("git", ["init", "-q", worktree]);
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    fs.mkdirSync(path.join(worktree, "config"));
    fs.writeFileSync(path.join(worktree, "config", "app.rb"), "old\n");
    fs.mkdirSync(path.join(worktree, "Icons (old)"));
    fs.writeFileSync(path.join(worktree, "Icons (old)", "a.png"), "png\n");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");

    fs.writeFileSync(path.join(worktree, "config", "app.rb"), "new\n");
    git("commit", "-qam", "edit app");
    const appCommit = git("rev-parse", "HEAD");
    for (const owns of [
      "config/app.rb (only the foo() call)",
      "config/app.rb (insert only) (keep order)",
      "config/** (only (a) and (b))",
    ]) {
      assert.doesNotThrow(
        () =>
          validateWorkUnitResult(completed(appCommit), {
            expectedOwnership: [owns],
            worktree,
            baseCommit: base,
          }),
        owns
      );
    }
    assert.throws(
      () =>
        validateWorkUnitResult(completed(appCommit), {
          expectedOwnership: ["config/app.rb(x) (note)"],
          worktree,
          baseCommit: base,
        }),
      /outside assigned ownership: config\/app\.rb/
    );

    fs.mkdirSync(path.join(worktree, "Icons"));
    fs.writeFileSync(path.join(worktree, "Icons", "b.png"), "png\n");
    git("add", ".");
    git("commit", "-qm", "sibling");
    const siblingCommit = git("rev-parse", "HEAD");
    assert.throws(
      () =>
        validateWorkUnitResult(completed(siblingCommit), {
          expectedOwnership: ["Icons (old) (rename only)"],
          worktree,
          baseCommit: appCommit,
        }),
      /outside assigned ownership: Icons\/b\.png/
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
