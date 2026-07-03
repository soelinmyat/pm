"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const HOOK = path.join(ROOT, "hooks", "push-gate");
const { deriveSessionSlug } = require("../scripts/dev-gate-check.js");

// ---------------------------------------------------------------------------
// hooks/push-gate is a PreToolUse (Bash matcher, async:false) hook that makes
// the PM dev push gate unskippable at runtime — it fires before every Bash tool
// call, INCLUDING loop workers running `claude -p`, without installing git hooks
// into user repos. It is a no-op everywhere except a PM dev session pushing with
// a failing/missing gate, where it emits a PreToolUse deny decision.
// ---------------------------------------------------------------------------

function git(dir, ...args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function makeRepo({ branch = "feat/x" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-"));
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "checkout", "-q", "-b", branch);
  return dir;
}

function headSha(dir) {
  return git(dir, "rev-parse", "HEAD");
}

function writeGates(dir, slug, gatesManifest) {
  const dsDir = path.join(dir, ".pm", "dev-sessions");
  fs.mkdirSync(dsDir, { recursive: true });
  fs.writeFileSync(path.join(dsDir, `${slug}.gates.json`), JSON.stringify(gatesManifest, null, 2));
}

const REQUIRED = ["tdd", "design-critique", "qa", "review", "verification"];

function passingManifest(dir, slug, sha) {
  const dsDir = path.join(dir, ".pm", "dev-sessions");
  fs.mkdirSync(dsDir, { recursive: true });
  const artifact = `.pm/dev-sessions/${slug}.md`;
  fs.writeFileSync(path.join(dir, artifact), "state\n");
  return {
    schema_version: 1,
    gates: REQUIRED.map((name) => ({
      name,
      status: "passed",
      commit: sha,
      artifact: `${artifact}#${name}`,
      reason: "",
      checked_at: "2026-07-01T00:00:00Z",
    })),
  };
}

function runHook(command, payloadOverrides = {}) {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    ...payloadOverrides,
  });
  return spawnSync(HOOK, {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, PM_PLUGIN_ROOT: ROOT },
  });
}

function decisionOf(result) {
  const out = (result.stdout || "").trim();
  if (out === "") return null;
  return JSON.parse(out).hookSpecificOutput;
}

function assertAllow(result) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  assert.equal((result.stdout || "").trim(), "", `expected no decision, got: ${result.stdout}`);
}

function assertBlock(result, reasonPattern) {
  assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
  const decision = decisionOf(result);
  assert.ok(decision, `expected a deny decision on stdout, got: ${result.stdout}`);
  assert.equal(decision.hookEventName, "PreToolUse");
  assert.equal(decision.permissionDecision, "deny");
  if (reasonPattern) {
    assert.match(decision.permissionDecisionReason, reasonPattern);
  }
}

// ---------------------------------------------------------------------------
// Non-push commands are always allowed — even in a PM dev session with a
// failing gate. The hook must be a cheap no-op for the overwhelming majority of
// Bash calls.
// ---------------------------------------------------------------------------

test("non-push commands are allowed even with a failing gate manifest", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    const m = passingManifest(dir, "x", sha);
    m.gates.find((g) => g.name === "verification").status = "failed";
    m.gates.find((g) => g.name === "verification").reason = "tests failed";
    writeGates(dir, "x", m);

    for (const command of [
      "npm test",
      "git status",
      "git log --oneline",
      'git commit -m "push the button"',
      "git log --grep=push",
    ]) {
      assertAllow(runHook(command, { cwd: dir }));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed hook stdin is a silent no-op", () => {
  const r = spawnSync(HOOK, {
    input: "not json at all",
    encoding: "utf8",
    env: { ...process.env, PM_PLUGIN_ROOT: ROOT },
  });
  assert.equal(r.status, 0);
  assert.equal((r.stdout || "").trim(), "");
});

// ---------------------------------------------------------------------------
// A push with no PM dev session gate manifest is allowed — this is every
// non-PM repo and every PM repo without an active dev session.
// ---------------------------------------------------------------------------

test("push with no gate manifest is allowed", () => {
  const dir = makeRepo();
  try {
    // .pm/dev-sessions exists but has no manifest for this branch
    fs.mkdirSync(path.join(dir, ".pm", "dev-sessions"), { recursive: true });
    assertAllow(runHook("git push origin HEAD", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push in a repo with no .pm/ directory is allowed", () => {
  const dir = makeRepo();
  try {
    assertAllow(runHook("git push", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A push with a PASSING manifest for HEAD is allowed.
// ---------------------------------------------------------------------------

test("push with a passing gate manifest is allowed", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    writeGates(dir, "x", passingManifest(dir, "x", sha));
    assertAllow(runHook("git push origin HEAD", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// A push with a FAILING or STALE manifest is blocked, surfacing the checker
// output as the deny reason.
// ---------------------------------------------------------------------------

test("push with a failing gate manifest is blocked with the checker output", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    const m = passingManifest(dir, "x", sha);
    const v = m.gates.find((g) => g.name === "verification");
    v.status = "failed";
    v.reason = "tests failed";
    writeGates(dir, "x", m);

    const result = runHook("git push", { cwd: dir });
    assertBlock(result, /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push with a stale manifest (gates tied to an old commit) is blocked", () => {
  const dir = makeRepo();
  try {
    // Gates recorded against a commit that is no longer HEAD.
    writeGates(dir, "x", passingManifest(dir, "x", "0000000000000000000000000000000000000000"));
    const result = runHook("git push origin HEAD", { cwd: dir });
    assertBlock(result, /stale for current commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `git -C <dir> push` form: the repo is the -C directory, not the process cwd.
// ---------------------------------------------------------------------------

test("git -C <dir> push form is detected and gated against that repo", () => {
  const repo = makeRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-cwd-"));
  try {
    const sha = headSha(repo);
    const m = passingManifest(repo, "x", sha);
    m.gates.find((g) => g.name === "review").status = "failed";
    m.gates.find((g) => g.name === "review").reason = "review not run";
    writeGates(repo, "x", m);

    // cwd is an unrelated dir; only the -C target carries the failing manifest.
    const result = runHook(`git -C ${repo} push origin HEAD`, { cwd: elsewhere });
    assertBlock(result, /review is failed/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("cd <dir> && git push form is detected and gated against that repo", () => {
  const repo = makeRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-cwd2-"));
  try {
    const sha = headSha(repo);
    const m = passingManifest(repo, "x", sha);
    m.gates.find((g) => g.name === "qa").status = "failed";
    m.gates.find((g) => g.name === "qa").reason = "qa not run";
    writeGates(repo, "x", m);

    const result = runHook(`cd ${repo} && git push`, { cwd: elsewhere });
    assertBlock(result, /qa is failed/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// current.gates.json fallback (parity with .githooks/pre-push): when no
// {slug}.gates.json exists but current.gates.json does, gate against it.
// ---------------------------------------------------------------------------

test("current.gates.json is used when no {slug}.gates.json exists", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    const m = passingManifest(dir, "x", sha);
    m.gates.find((g) => g.name === "verification").status = "failed";
    m.gates.find((g) => g.name === "verification").reason = "tests failed";
    writeGates(dir, "current", m);

    assertBlock(runHook("git push", { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// slug derivation stays consistent with deriveSessionSlug — a branch outside
// the known prefixes still maps to its normalized manifest name.
// ---------------------------------------------------------------------------

test("branch slug matches deriveSessionSlug for gate manifest lookup", () => {
  const dir = makeRepo({ branch: "chore/cleanup" });
  try {
    const slug = deriveSessionSlug("chore/cleanup");
    assert.equal(slug, "cleanup");
    const sha = headSha(dir);
    const m = passingManifest(dir, slug, sha);
    m.gates.find((g) => g.name === "review").status = "failed";
    m.gates.find((g) => g.name === "review").reason = "review not run";
    writeGates(dir, slug, m);

    assertBlock(runHook("git push", { cwd: dir }), /review is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// hooks.json registers push-gate as a synchronous PreToolUse Bash hook.
// ---------------------------------------------------------------------------

test("hooks.json registers push-gate as a synchronous PreToolUse Bash hook", () => {
  const hooksJson = JSON.parse(fs.readFileSync(path.join(ROOT, "hooks", "hooks.json"), "utf8"));
  const preToolUse = hooksJson.hooks.PreToolUse || [];
  const bashEntry = preToolUse.find((entry) => entry.matcher === "Bash");
  assert.ok(bashEntry, "expected a PreToolUse entry with a Bash matcher");
  const pushGate = bashEntry.hooks.find((h) => /push-gate/.test(h.command));
  assert.ok(pushGate, "expected the Bash matcher to run hooks/push-gate");
  assert.equal(pushGate.async, false, "push-gate must be synchronous to block the push");
});

test("push-gate hook file is executable", () => {
  const stat = fs.statSync(HOOK);
  assert.ok(stat.mode & 0o111, "hooks/push-gate must be executable");
});
