"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "scripts", "worktree-bootstrap.js");
const { bootstrapWorktree } = require("../scripts/worktree-bootstrap.js");

function makeDirs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wt-bootstrap-"));
  const gitRoot = path.join(tmp, "main");
  const worktree = path.join(tmp, "wt");
  fs.mkdirSync(gitRoot, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  return {
    tmp,
    gitRoot,
    worktree,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

test("copies bootstrap_files from the main checkout into the worktree (nested paths)", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    fs.writeFileSync(path.join(gitRoot, "local.env"), "SECRET=1\n");
    fs.mkdirSync(path.join(gitRoot, "config"), { recursive: true });
    fs.writeFileSync(path.join(gitRoot, "config", "gen.json"), "{}\n");

    const res = bootstrapWorktree(gitRoot, worktree, {
      bootstrap_files: ["local.env", "config/gen.json"],
    });

    assert.equal(res.ok, true);
    assert.deepEqual(res.copied, ["local.env", "config/gen.json"]);
    assert.equal(fs.readFileSync(path.join(worktree, "local.env"), "utf8"), "SECRET=1\n");
    assert.ok(fs.existsSync(path.join(worktree, "config", "gen.json")));
  } finally {
    cleanup();
  }
});

test("silently skips bootstrap_files missing from the main checkout", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    fs.writeFileSync(path.join(gitRoot, "present.env"), "x\n");
    const res = bootstrapWorktree(gitRoot, worktree, {
      bootstrap_files: ["present.env", "absent.env"],
    });
    assert.equal(res.ok, true);
    assert.deepEqual(res.copied, ["present.env"], "only existing files are copied");
    assert.ok(!fs.existsSync(path.join(worktree, "absent.env")));
  } finally {
    cleanup();
  }
});

test("runs bootstrap_command in the worktree cwd", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    const res = bootstrapWorktree(gitRoot, worktree, {
      bootstrap_command: "pwd > where.txt && echo done > marker.txt",
    });
    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(path.join(worktree, "marker.txt")), "command ran in the worktree");
    assert.match(fs.readFileSync(path.join(worktree, "where.txt"), "utf8"), /wt\b/);
  } finally {
    cleanup();
  }
});

test("returns bootstrap-command-failed with error text on non-zero exit", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    const res = bootstrapWorktree(gitRoot, worktree, {
      bootstrap_command: "echo boom >&2; exit 7",
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "bootstrap-command-failed");
    assert.match(res.error, /boom/);
  } finally {
    cleanup();
  }
});

test("rejects a bootstrap_files entry whose dest escapes the worktree", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    fs.writeFileSync(path.join(gitRoot, "local.env"), "x\n");
    const res = bootstrapWorktree(gitRoot, worktree, {
      bootstrap_files: ["../evil"],
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "bootstrap-file-outside-worktree");
    assert.ok(
      !fs.existsSync(path.join(worktree, "..", "evil")),
      "nothing written outside worktree"
    );
  } finally {
    cleanup();
  }
});

test("wraps a cpSync throw (same src/dest) as bootstrap-copy-failed, not an uncaught crash", () => {
  const { gitRoot, cleanup } = makeDirs();
  try {
    fs.writeFileSync(path.join(gitRoot, "self.env"), "x\n");
    // worktree === gitRoot makes src and dest the same path → fs.cpSync throws.
    const res = bootstrapWorktree(gitRoot, gitRoot, { bootstrap_files: ["self.env"] });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "bootstrap-copy-failed");
    assert.ok(res.error, "carries the underlying error text");
  } finally {
    cleanup();
  }
});

test("no-ops cleanly when worker defines no bootstrap files or command", () => {
  const { gitRoot, worktree, cleanup } = makeDirs();
  try {
    assert.deepEqual(bootstrapWorktree(gitRoot, worktree, {}), { ok: true, copied: [] });
    assert.deepEqual(bootstrapWorktree(gitRoot, worktree, { bootstrap_files: [] }), {
      ok: true,
      copied: [],
    });
  } finally {
    cleanup();
  }
});

test("CLI loads worker.* from pm/loop/config.json and applies it", () => {
  const { tmp, gitRoot, worktree, cleanup } = makeDirs();
  try {
    fs.writeFileSync(path.join(gitRoot, "local.env"), "K=V\n");
    const pmDir = path.join(tmp, "pm");
    fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
    fs.writeFileSync(
      path.join(pmDir, "loop", "config.json"),
      JSON.stringify({ worker: { bootstrap_files: ["local.env"] } })
    );

    const out = childProcess.execFileSync(
      "node",
      [CLI, "--git-root", gitRoot, "--worktree", worktree, "--pm-dir", pmDir],
      { encoding: "utf8" }
    );
    assert.match(out, /local\.env/);
    assert.equal(fs.readFileSync(path.join(worktree, "local.env"), "utf8"), "K=V\n");
  } finally {
    cleanup();
  }
});

test("CLI is a silent no-op when the repo has no loop config", () => {
  const { tmp, gitRoot, worktree, cleanup } = makeDirs();
  try {
    const pmDir = path.join(tmp, "pm"); // no loop/config.json
    fs.mkdirSync(pmDir, { recursive: true });
    const out = childProcess.execFileSync(
      "node",
      [CLI, "--git-root", gitRoot, "--worktree", worktree, "--pm-dir", pmDir],
      { encoding: "utf8" }
    );
    // Exits 0, copies nothing.
    assert.doesNotThrow(() => out);
    assert.deepEqual(fs.readdirSync(worktree), []);
  } finally {
    cleanup();
  }
});
