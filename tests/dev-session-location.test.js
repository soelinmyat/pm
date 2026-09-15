"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { spawnSync } = require("node:child_process");
const { createSession, updateWorkspace } = require("../scripts/lib/dev-session-schema");
const { loadDevSession } = require("../scripts/lib/dev-session-location");

function fixture(t) {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-session-location-")));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, "origin");
  const worktree = path.join(parent, "source");
  fs.mkdirSync(root);
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.com");
  git(root, "commit", "--allow-empty", "-qm", "baseline");
  git(root, "worktree", "add", "-b", "fix/location-test", worktree);
  const session = updateWorkspace(
    createSession({ sourceDir: root, slug: "location-test" }),
    worktree
  );
  const relative = ".pm/dev-sessions/location-test/session.json";
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const save = () => fs.writeFileSync(file, JSON.stringify(session));
  save();
  return { parent, root, worktree, session, relative, file, save, git };
}

test("explicit and discovered worktree sessions resolve the same untouched canonical bytes", (t) => {
  const f = fixture(t);
  const before = fs.readFileSync(f.file);
  for (const options of [
    { slug: "location-test" },
    { sessionPath: f.file },
    { sessionPath: f.relative },
  ]) {
    const loaded = loadDevSession(f.worktree, options);
    assert.equal(loaded.path, f.file);
    assert.equal(loaded.value.run_id, f.session.run_id);
  }
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(fs.existsSync(path.join(f.worktree, f.relative)), false);
});

test("outside repositories, wrong namespaces and unregistered paths are rejected", (t) => {
  const f = fixture(t);
  assert.throws(
    () => loadDevSession(f.worktree, { sessionPath: f.file, slug: "other" }),
    /slug must equal target namespace/
  );
  const outside = path.join(f.parent, "unregistered");
  fs.mkdirSync(path.join(outside, path.dirname(f.relative)), { recursive: true });
  fs.copyFileSync(f.file, path.join(outside, f.relative));
  assert.throws(
    () => loadDevSession(f.worktree, { sessionPath: path.join(outside, f.relative) }),
    /Expected one canonical/
  );
});

test("cross-worktree sessions must bind the origin, assigned worktree, branch and schema", (t) => {
  const f = fixture(t);
  const original = structuredClone(f.session);
  for (const mutate of [
    (s) => {
      s.source.branch = "fix/other";
    },
    (s) => {
      s.source.repo_root = f.worktree;
    },
    (s) => {
      s.source.worktree = f.root;
    },
    (s) => {
      s.slug = "other";
    },
    (s) => {
      s.schema_version = 999;
    },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    fs.writeFileSync(f.file, JSON.stringify(changed));
    assert.throws(
      () => loadDevSession(f.worktree, { sessionPath: f.file }),
      /invalid|does not match/
    );
  }
});

test("symlinked and oversized sessions cannot cross the boundary", (t) => {
  const f = fixture(t);
  const saved = f.file + ".saved";
  fs.renameSync(f.file, saved);
  fs.symlinkSync(saved, f.file);
  assert.throws(() => loadDevSession(f.worktree, { sessionPath: f.file }), /symlink|symbolic/i);
  fs.unlinkSync(f.file);
  const { MAX_JSON_BYTES } = require("../scripts/lib/review-limits");
  fs.writeFileSync(f.file, " ".repeat(MAX_JSON_BYTES + 1));
  assert.throws(() => loadDevSession(f.worktree, { sessionPath: f.file }), /budget|exceed/);
});

test("discovery ignores another worktree's symlinked state but explicit traversal fails", (t) => {
  const f = fixture(t);
  const other = path.join(f.parent, "unrelated");
  f.git(f.root, "worktree", "add", "-b", "fix/unrelated", other);
  fs.mkdirSync(path.join(other, ".pm"));
  fs.symlinkSync(path.join(f.root, ".pm/dev-sessions"), path.join(other, ".pm/dev-sessions"));
  assert.equal(loadDevSession(f.worktree, { slug: "location-test" }).path, f.file);
  assert.throws(
    () => loadDevSession(f.worktree, { sessionPath: path.join(other, f.relative) }),
    /symlink|symbolic/i
  );
});

test("a stale worktree copy is rejected instead of becoming a second authority", (t) => {
  const f = fixture(t);
  const duplicate = path.join(f.worktree, f.relative);
  fs.mkdirSync(path.dirname(duplicate), { recursive: true });
  fs.copyFileSync(f.file, duplicate);
  assert.throws(
    () => loadDevSession(f.worktree, { slug: "location-test" }),
    /Noncanonical session copy/
  );
});

test("delivery gate resolves the origin but still denies absent push authority and missing gates", (t) => {
  const f = fixture(t);
  const remote = path.join(f.parent, "remote.git");
  f.git(f.root, "init", "--bare", "-b", "main", remote);
  f.git(f.root, "remote", "add", "origin", remote);
  f.git(f.root, "push", "origin", "main");
  const manifest = path.join(f.worktree, path.dirname(f.relative), "gates.json");
  fs.mkdirSync(path.dirname(manifest), { recursive: true });
  fs.writeFileSync(
    manifest,
    JSON.stringify({
      schema_version: 1,
      run_id: f.session.run_id,
      size: "M",
      kind: "proposal",
      gates: [],
    })
  );
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, "../scripts/dev-gate-check.js"),
      "--manifest",
      manifest,
      "--require",
      "tdd",
      "--review-evidence-mode",
      "enforce",
      "--require-authority",
      "push_feature_branch",
      "--json",
    ],
    { cwd: f.worktree, encoding: "utf8" }
  );
  assert.equal(result.status, 1);
  const issues = JSON.parse(result.stdout)
    .issues.map((issue) => issue.message)
    .join("\n");
  assert.match(issues, /does not grant authority push_feature_branch/);
  assert.doesNotMatch(issues, /cannot validate sibling|needs canonical session/);
});
