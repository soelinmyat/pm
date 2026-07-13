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
const { createSession } = require("../scripts/lib/dev-session-schema");

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
  makeRepoAt(dir, branch);
  return dir;
}

function makeRepoAt(dir, branch = "feat/x") {
  git(dir, "init", "-q");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "user.name", "Test User");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "push.default", "current");
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  git(dir, "remote", "add", "origin", ".");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "checkout", "-q", "-b", branch);
}

function headSha(dir) {
  return git(dir, "rev-parse", "HEAD");
}

function writeGates(dir, slug, gatesManifest) {
  const sessionDir = path.join(dir, ".pm", "dev-sessions", slug);
  fs.mkdirSync(sessionDir, { recursive: true });
  const session = createSession({ slug, sourceDir: dir });
  session.routing.review_mode = "code-scan";
  gatesManifest.run_id = session.run_id;
  fs.writeFileSync(path.join(sessionDir, "gates.json"), JSON.stringify(gatesManifest, null, 2));
  fs.writeFileSync(path.join(sessionDir, "session.json"), JSON.stringify(session, null, 2));
}

function writeLegacyGates(dir, slug, gatesManifest) {
  const sessionsDir = path.join(dir, ".pm", "dev-sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, `${slug}.gates.json`),
    JSON.stringify(gatesManifest, null, 2)
  );
}

function writeCurrentGates(dir, gatesManifest) {
  const sessionsDir = path.join(dir, ".pm", "dev-sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(
    path.join(sessionsDir, "current.gates.json"),
    JSON.stringify(gatesManifest, null, 2)
  );
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

function runHook(command, payloadOverrides = {}, envOverrides = {}) {
  const payload = JSON.stringify({
    tool_name: "Bash",
    tool_input: { command },
    ...payloadOverrides,
  });
  return spawnSync(HOOK, {
    input: payload,
    encoding: "utf8",
    env: { ...process.env, PM_PLUGIN_ROOT: ROOT, ...envOverrides },
  });
}

// A failing manifest for `slug` tied to HEAD, with `gateName` marked failed.
function writeFailingGates(dir, slug, gateName = "verification") {
  const sha = headSha(dir);
  const m = passingManifest(dir, slug, sha);
  const g = m.gates.find((row) => row.name === gateName);
  g.status = "failed";
  g.reason = `${gateName} not run`;
  writeGates(dir, slug, m);
  return m;
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
// A legacy-shaped row cannot self-assert that Review passed. The checker remains
// independently testable, so a separate stub proves the hook allows a clean
// checker verdict without weakening production evidence enforcement.
// ---------------------------------------------------------------------------

test("push with a legacy-shaped passed Review row is blocked", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    writeGates(dir, "x", passingManifest(dir, "x", sha));
    assertBlock(
      runHook("git push origin HEAD", { cwd: dir }),
      /requires evidence_kind review-report-v1 in enforcement mode/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flat legacy manifest is inspection-only and cannot authorize a push", () => {
  const dir = makeRepo();
  try {
    const m = passingManifest(dir, "x", headSha(dir));
    m.gates.find((g) => g.name === "qa").status = "failed";
    m.gates.find((g) => g.name === "qa").reason = "legacy qa failed";
    writeLegacyGates(dir, "x", m);
    assertBlock(runHook("git push", { cwd: dir }), /legacy gate manifests are inspection-only/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical manifest wins when a conflicting flat legacy manifest also exists", () => {
  const dir = makeRepo();
  try {
    const canonical = passingManifest(dir, "x", headSha(dir));
    canonical.gates.find((g) => g.name === "verification").status = "failed";
    canonical.gates.find((g) => g.name === "verification").reason = "canonical failure";
    writeGates(dir, "x", canonical);

    const legacy = passingManifest(dir, "x", headSha(dir));
    legacy.gates.find((g) => g.name === "qa").status = "failed";
    legacy.gates.find((g) => g.name === "qa").reason = "legacy failure";
    writeLegacyGates(dir, "x", legacy);

    const result = runHook("git push", { cwd: dir });
    assertBlock(result, /verification is failed/);
    assert.doesNotMatch(decisionOf(result).permissionDecisionReason, /qa is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("flat legacy manifest cannot shadow a canonical session missing gates.json", () => {
  const dir = makeRepo();
  try {
    fs.mkdirSync(path.join(dir, ".pm", "dev-sessions", "x"), { recursive: true });
    writeLegacyGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    assertBlock(runHook("git push", { cwd: dir }), /canonical gate manifest is missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push is allowed when the enforcement checker returns a clean verdict", () => {
  const dir = makeRepo();
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-cleanroot-"));
  try {
    fs.mkdirSync(path.join(fakeRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(path.join(ROOT, "scripts", "dev-gate-check.js"))});\n` +
        `if (require.main === module) process.exitCode = 0;\n`
    );
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    assertAllow(runHook("git push origin HEAD", { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("push gate passes the exact named destination remote to enforcement", () => {
  const dir = makeRepo();
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-remote-checker-"));
  try {
    git(dir, "remote", "add", "upstream", ".");
    git(dir, "remote", "add", "foo+bar", ".");
    git(dir, "remote", "add", "--", "-foo", ".");
    fs.mkdirSync(path.join(fakeRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(path.join(ROOT, "scripts", "dev-gate-check.js"))});\n` +
        `if (require.main === module) {\n` +
        `  const i = process.argv.indexOf("--remote");\n` +
        `  process.exitCode = i >= 0 && process.argv[i + 1] === "upstream" ? 0 : 7;\n` +
        `}\n`
    );
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    for (const command of [
      "git push upstream HEAD",
      "git push --repo upstream HEAD",
      "git push --repo=upstream HEAD",
    ])
      assertAllow(runHook(command, { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot }));
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(path.join(ROOT, "scripts", "dev-gate-check.js"))});\n` +
        `if (require.main === module) {\n` +
        `  const i = process.argv.indexOf("--remote");\n` +
        `  process.exitCode = i >= 0 && process.argv[i + 1] === "foo+bar" ? 0 : 7;\n` +
        `}\n`
    );
    assertAllow(runHook("git push foo+bar HEAD", { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot }));
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(path.join(ROOT, "scripts", "dev-gate-check.js"))});\n` +
        `if (require.main === module) {\n` +
        `  const i = process.argv.indexOf("--remote");\n` +
        `  process.exitCode = i >= 0 && process.argv[i + 1] === "-foo" ? 0 : 7;\n` +
        `}\n`
    );
    assertAllow(runHook("git push -- -foo HEAD", { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

test("push gate accepts a named remote configured only with pushurl", () => {
  const dir = makeRepo();
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-pushurl-only-"));
  try {
    git(dir, "remote", "remove", "origin");
    git(dir, "config", "remote.delivery.pushurl", dir);
    fs.mkdirSync(path.join(fakeRoot, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(path.join(ROOT, "scripts", "dev-gate-check.js"))});\n` +
        `if (require.main === module) {\n` +
        `  const i = process.argv.indexOf("--remote");\n` +
        `  process.exitCode = i >= 0 && process.argv[i + 1] === "delivery" ? 0 : 7;\n` +
        `}\n`
    );
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    const result = runHook("git push delivery HEAD", { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot });
    assertAllow(result);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
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

test("quoted git -C paths remain one shell word", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-quoted-git-c-"));
  const repo = path.join(parent, "gated repo");
  try {
    fs.mkdirSync(repo);
    makeRepoAt(repo);
    writeFailingGates(repo, "x");
    assertBlock(
      runHook('git -C "gated repo" push origin HEAD', { cwd: parent }),
      /verification is failed/
    );
    assertBlock(runHook('git -C "" push origin HEAD', { cwd: repo }), /verification is failed/);
    assertBlock(
      runHook('git -C "$PWD/gated repo" push origin HEAD', { cwd: parent }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("git -C $(pwd)/gated push origin HEAD", { cwd: parent }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("git -C $(git rev-parse --show-toplevel)/gated push origin HEAD", {
        cwd: parent,
      }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("git -C `pwd`/gated push origin HEAD", { cwd: parent }),
      /could not determine the repository/
    );
    const literal = path.join(parent, "repo$archive");
    fs.mkdirSync(literal);
    makeRepoAt(literal);
    writeFailingGates(literal, "x");
    assertBlock(
      runHook("git -C 'repo$archive' push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
    const parenthesized = path.join(parent, "(gated)");
    fs.mkdirSync(parenthesized);
    makeRepoAt(parenthesized);
    writeFailingGates(parenthesized, "x");
    assertBlock(
      runHook("git -C '(gated)' push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
    assertBlock(
      runHook(">/dev/null git push origin HEAD", { cwd: repo }),
      /verification is failed/
    );
    assertBlock(
      runHook("&>/dev/null git push origin HEAD", { cwd: repo }),
      /verification is failed/
    );
    assertBlock(
      runHook("git push origin HEAD &>/dev/null", { cwd: repo }),
      /verification is failed/
    );
    assertBlock(
      runHook("git push origin HEAD&>/dev/null", { cwd: repo }),
      /verification is failed/
    );
    assertBlock(runHook("git push origin HEAD <<< input", { cwd: repo }), /verification is failed/);
    assertBlock(
      runHook("TRACE=$RUN_ID git push origin HEAD", { cwd: repo }),
      /verification is failed/
    );
    assertBlock(
      runHook("git -c helper=$HELPER push origin HEAD", { cwd: repo }),
      /could not determine the repository/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("repeated git -C options compose relative to the preceding directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-repeated-git-c-"));
  const first = path.join(parent, "first");
  const gated = path.join(parent, "gated");
  try {
    fs.mkdirSync(first);
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    assertBlock(
      runHook("git -C first -C ../gated push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
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
// current.gates.json is a migration-only compatibility artifact.
// ---------------------------------------------------------------------------

test("current.gates.json is inspection-only and cannot authorize a push", () => {
  const dir = makeRepo();
  try {
    const sha = headSha(dir);
    const m = passingManifest(dir, "x", sha);
    m.gates.find((g) => g.name === "verification").status = "failed";
    m.gates.find((g) => g.name === "verification").reason = "tests failed";
    writeCurrentGates(dir, m);

    assertBlock(runHook("git push", { cwd: dir }), /legacy gate manifests are inspection-only/);
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

test("branch slug normalization cannot bypass gates with case or punctuation", () => {
  const dir = makeRepo({ branch: "chore/Review++Gate" });
  try {
    const slug = deriveSessionSlug("chore/Review++Gate");
    assert.equal(slug, "review-gate");
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
  assert.match(fs.readFileSync(HOOK, "utf8"), /"--review-evidence-mode",\s*"enforce"/);
  assert.match(fs.readFileSync(HOOK, "utf8"), /"--branch",\s*branch/);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED (BLOCKING #1). In user repos no git pre-push hook is installed —
// this PreToolUse hook is the ONLY gate downstream. So when a push IS detected
// and a gate manifest IS present, but the checker cannot be run to a clean
// verdict (spawn error / signal / non-numeric exit / ENOBUFS), we BLOCK. A
// checker you couldn't run is not evidence the gate passed. Fail-OPEN survives
// only for genuinely out-of-scope cases (not a push / no manifest / non-PM).
// ---------------------------------------------------------------------------

test("checker that cannot produce a clean verdict blocks (fail-closed), even with a passing manifest", () => {
  const dir = makeRepo();
  const fakeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-failroot-"));
  try {
    // A stand-in dev-gate-check.js: re-exports the REAL deriveSessionSlug (so the
    // manifest is still located correctly) but self-terminates by signal when run
    // as a subprocess — spawnSync then returns a null status (no clean verdict).
    fs.mkdirSync(path.join(fakeRoot, "scripts"), { recursive: true });
    const realChecker = path.join(ROOT, "scripts", "dev-gate-check.js");
    fs.writeFileSync(
      path.join(fakeRoot, "scripts", "dev-gate-check.js"),
      `"use strict";\n` +
        `module.exports = require(${JSON.stringify(realChecker)});\n` +
        `if (require.main === module) { process.kill(process.pid, "SIGKILL"); }\n`
    );
    // A PASSING manifest — proves an unverifiable checker still blocks.
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));

    const result = runHook("git push origin HEAD", { cwd: dir }, { PM_PLUGIN_ROOT: fakeRoot });
    assertBlock(result, /could not verify|couldn'?t verify/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(fakeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// REFSPEC SCOPING (BLOCKING #3). Only pushes that UPDATE THE SESSION BRANCH's
// ref are gated. Tag pushes, deletions, and cross-branch pushes are legit
// mid-session ops and must not be blocked with a nonsense "incomplete gate".
// ---------------------------------------------------------------------------

test("--tags push is out of scope → allow (even with a failing session manifest)", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertAllow(runHook("git push origin --tags", { cwd: dir }));
    assertAllow(runHook("git push --tags", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit tag refspec is out of scope → allow", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertAllow(runHook("git push origin refs/tags/v1.0.0", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("branch deletion (--delete and :ref) is out of scope → allow", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertAllow(runHook("git push origin --delete feat/old", { cwd: dir }));
    assertAllow(runHook("git push origin :feat/old", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cross-branch push (dst is not the session branch) is out of scope → allow", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertAllow(runHook("git push origin main", { cwd: dir }));
    assertAllow(runHook("git push origin feat/x:feat/y", { cwd: dir }));
    assertAllow(runHook("git push origin HEAD:refs/heads/other", { cwd: dir }));
    assertAllow(runHook("git push origin @:refs/heads/other", { cwd: dir }));
    assertAllow(
      runHook("git push origin 'refs/heads/release/*:refs/heads/release/*'", { cwd: dir })
    );
    assertAllow(runHook("git push --repo origin HEAD:refs/heads/other", { cwd: dir }));
    assertAllow(runHook("git push --repo=origin HEAD:refs/heads/other", { cwd: dir }));
    assertAllow(runHook("git push --repo origin refs/tags/v1.0.0", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit push of the session branch is still gated → block", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertBlock(runHook("git push origin feat/x", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }), /verification/);
    assertBlock(runHook("git push origin @", { cwd: dir }), /verification/);
    assertBlock(runHook("git push origin +@", { cwd: dir }), /verification/);
    assertBlock(runHook("git push origin @:feat/x", { cwd: dir }), /verification/);
    assertBlock(runHook("git push origin @:refs/heads/feat/x", { cwd: dir }), /verification/);
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: dir }),
      /command line wildcard refspec can expand the session-branch push/
    );
    assertBlock(runHook("git push origin :", { cwd: dir }), /matching multi-ref/);
    assertBlock(runHook("git push origin +:", { cwd: dir }), /matching multi-ref/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every push in a compound command is evaluated", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    for (const command of [
      "git push origin HEAD:refs/heads/other && git push origin HEAD",
      "git push origin refs/tags/v1.0.0\ngit push origin HEAD",
      "git push origin HEAD && git push origin HEAD:refs/heads/other",
    ])
      assertBlock(runHook(command, { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("leading shell control constructs cannot hide a session-branch push", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    for (const command of [
      "if git push origin HEAD; then true; fi",
      "if ! git push origin HEAD; then true; fi",
      "while git push origin HEAD; do break; done",
      "until git push origin HEAD; do break; done",
    ])
      assertBlock(runHook(command, { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pushes inside command substitutions fail closed", () => {
  const dir = makeRepo();
  try {
    for (const command of [
      "result=$(git push origin HEAD 2>&1)",
      "if output=$(git push origin HEAD); then true; fi",
      "result=`git push origin HEAD`",
      "result=$(echo $(git push origin HEAD))",
      'result="$(git push origin HEAD)"',
      'result="customer\'s $(git push origin HEAD)"',
      "result=$(bash -c 'git push origin HEAD')",
      "result=$(bash -lc 'git push origin HEAD')",
      "result=$(sh -c 'git -C . push origin HEAD')",
      "result=$(env FOO=bar bash -c 'git push origin HEAD')",
      "result=$(env -i sh -c 'git push origin HEAD')",
      "result=$(eval 'git push origin HEAD')",
    ])
      assertBlock(runHook(command, { cwd: dir }), /command substitution/);
    assertAllow(runHook("printf '%s' '$(git push origin HEAD)'", { cwd: dir }));
    assertAllow(runHook("message=$(printf '%s' 'git push is disabled')", { cwd: dir }));
    assertAllow(runHook("value=$(echo git; echo push)", { cwd: dir }));
    assertAllow(runHook("message=$(printf '%s' 'bash git push is disabled')", { cwd: dir }));
    assertAllow(runHook("message=$(printf '%s' 'eval git push is disabled')", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("indirect shell pushes preserve nested and wrapper working directories", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-indirect-cwd-"));
  const outer = path.join(parent, "outer");
  const gated = path.join(outer, "gated");
  fs.mkdirSync(outer);
  fs.mkdirSync(gated);
  makeRepoAt(outer);
  makeRepoAt(gated);
  writeFailingGates(gated, "x");
  try {
    for (const command of [
      "bash -c 'cd gated && git push origin HEAD'",
      "eval 'cd gated && git push origin HEAD'",
      "env -C gated bash -c 'git push origin HEAD'",
    ])
      assertBlock(runHook(command, { cwd: outer }), /verification is failed/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("indirect shell scripts fail closed for multiple pushes and preserve parent traversal", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-indirect-parent-"));
  const outer = path.join(parent, "outer");
  const child = path.join(outer, "child");
  const gated = path.join(outer, "gated");
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(gated);
  makeRepoAt(gated);
  writeFailingGates(gated, "x");
  try {
    assertBlock(
      runHook("bash -c 'cd ../gated && git push origin HEAD'", { cwd: child }),
      /verification is failed/
    );
    assertBlock(
      runHook("bash -c 'git push origin main; git push origin HEAD'", { cwd: gated }),
      /could not determine the repository/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("compound pushes resolve each relative cd from the current shell directory", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-cumulative-cd-"));
  const first = path.join(parent, "first");
  const second = path.join(parent, "second");
  try {
    fs.mkdirSync(first);
    fs.mkdirSync(second);
    makeRepoAt(first);
    makeRepoAt(second);
    writeFailingGates(second, "x");
    assertBlock(
      runHook(
        "cd first && git push origin HEAD:refs/heads/other && cd ../second && git push origin HEAD",
        { cwd: parent }
      ),
      /verification is failed/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("pipeline and background directory changes do not leak into the following push", () => {
  const outer = makeRepo();
  const gated = path.join(outer, "gated");
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(outer, "x");
    for (const command of ["cd gated | git push origin HEAD", "cd gated & git push origin HEAD"])
      assertBlock(runHook(command, { cwd: outer }), /verification is failed/);
    assertBlock(
      runHook("true | cd gated && git push origin HEAD", { cwd: outer }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(outer, { recursive: true, force: true });
  }
});

test("conditional cd branches cannot redirect gate inspection away from the pushed repo", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-conditional-cd-"));
  const gated = path.join(parent, "gated");
  const elsewhere = path.join(parent, "elsewhere");
  try {
    fs.mkdirSync(gated);
    fs.mkdirSync(elsewhere);
    makeRepoAt(gated);
    makeRepoAt(elsewhere);
    writeFailingGates(gated, "x");
    assertBlock(
      runHook("cd gated || cd ../elsewhere; git push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
    assertBlock(
      runHook("cd missing || cd gated; git push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("subshell and brace-group cd state gates pushes in the effective repository", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-group-cd-"));
  const gated = path.join(parent, "gated");
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    assertBlock(
      runHook("(cd gated && git push origin HEAD)", { cwd: parent }),
      /verification is failed/
    );
    assertBlock(
      runHook("{ cd gated && git push origin HEAD; }", { cwd: parent }),
      /verification is failed/
    );
    assertAllow(runHook("(cd gated); git push origin HEAD", { cwd: parent }));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("group delimiters inside quoted repository paths remain ordinary path characters", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-quoted-group-"));
  const name = "gated(parent){repo}>report";
  const gated = path.join(parent, name);
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    for (const command of [
      `cd '${name}' && git push origin HEAD`,
      `cd "${name}" && git push origin HEAD`,
      `(cd '${name}' && git push origin HEAD)`,
    ])
      assertBlock(runHook(command, { cwd: parent }), /verification is failed/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("escaped path characters are decoded and dynamic cd targets fail closed", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-escaped-cd-"));
  const name = "gated(parent) repo";
  const gated = path.join(parent, name);
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    assertBlock(
      runHook("cd gated\\(parent\\)\\ repo && git push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
    assertBlock(
      runHook('cd "$PM_REPO" && git push origin HEAD', { cwd: parent }),
      /could not determine the repository/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("tilde, glob, and brace expansion cd targets fail closed", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-expanded-cd-"));
  const home = path.join(parent, "home");
  try {
    fs.mkdirSync(home);
    for (const command of [
      "cd ~/gated && git push origin HEAD",
      "cd gated-* && git push origin HEAD",
      "cd gated-{one,two} && git push origin HEAD",
    ])
      assertBlock(
        runHook(command, { cwd: parent }, { HOME: home }),
        /could not determine the repository/
      );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("cwd-mutating shell builtins cannot move push inspection away from the repository", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-cwd-builtins-"));
  const gated = path.join(parent, "gated");
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    for (const command of [
      "pushd gated >/dev/null && git push origin HEAD",
      "pushd gated>/dev/null && git push origin HEAD",
      "cd gated>/dev/null && git push origin HEAD",
      "cd gated 2>&1 && git push origin HEAD",
      ">/dev/null cd gated && git push origin HEAD",
      ">/dev/null pushd gated && git push origin HEAD",
      "builtin cd gated && git push origin HEAD",
      "command cd gated && git push origin HEAD",
    ])
      assertBlock(runHook(command, { cwd: parent }), /verification is failed/);
    assertBlock(
      runHook("cd >/dev/null gated && git push origin HEAD", { cwd: parent }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("popd && git push origin HEAD", { cwd: parent }),
      /could not determine the repository/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("explicit alternate source commit is checked instead of current HEAD", () => {
  const dir = makeRepo();
  try {
    const reviewedHead = headSha(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "unreviewed alternate commit\n");
    git(dir, "add", "README.md");
    git(dir, "commit", "-q", "-m", "alternate");
    const alternate = headSha(dir);
    git(dir, "reset", "--hard", reviewedHead);
    writeGates(dir, "x", passingManifest(dir, "x", reviewedHead));

    for (const command of [
      `git push origin ${alternate}:refs/heads/feat/x`,
      `git push --repo origin ${alternate}:refs/heads/feat/x`,
      `git push --repo=origin ${alternate}:refs/heads/feat/x`,
    ])
      assertBlock(runHook(command, { cwd: dir }), /commit mismatch|stale|does not match/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured remote push refspecs determine whether the session branch is gated", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    git(dir, "config", "push.default", "matching");

    git(dir, "config", "--replace-all", "remote.origin.push", "HEAD:refs/heads/main");
    assertAllow(runHook("git push origin", { cwd: dir }));

    git(dir, "config", "--replace-all", "remote.origin.push", "HEAD:refs/heads/feat/x");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    // An explicit command-line refspec overrides remote.<name>.push.
    assertAllow(runHook("git push origin HEAD:refs/heads/main", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("implicit current and simple policies bind the effective destination", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");

    git(dir, "config", "push.default", "current");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "config", "push.default", "simple");
    assertBlock(runHook("git push origin", { cwd: dir }), /requires an upstream remote/);

    git(dir, "config", "branch.feat/x.remote", "origin");
    git(dir, "config", "branch.feat/x.merge", "refs/heads/feat/x");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "config", "--unset-all", "push.default");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "config", "push.default", "simple");
    git(dir, "config", "branch.feat/x.merge", "refs/heads/renamed");
    assertBlock(runHook("git push origin", { cwd: dir }), /refuses renamed upstream/);

    git(dir, "remote", "add", "other", ".");
    assertBlock(runHook("git push other", { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("implicit upstream and tracking policies use the configured upstream destination", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    git(dir, "config", "branch.feat/x.remote", "origin");
    git(dir, "config", "branch.feat/x.merge", "refs/heads/renamed");
    git(dir, "config", "push.default", "upstream");

    assertAllow(runHook("git push origin", { cwd: dir }));

    git(dir, "config", "branch.feat/x.merge", "refs/heads/feat/x");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "config", "push.default", "tracking");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "remote", "add", "other", ".");
    assertBlock(runHook("git push other", { cwd: dir }), /targets upstream remote origin/);

    git(dir, "config", "--add", "branch.feat/x.merge", "refs/heads/second");
    assertBlock(runHook("git push origin", { cwd: dir }), /requires exactly one upstream branch/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ambiguous or non-updating implicit push policies fail closed", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    for (const [policy, reason] of [
      ["matching", /ambiguous multi-ref push/],
      ["nothing", /has no implicit refspec/],
      ["bogus", /cannot resolve.*implicit push/],
    ]) {
      git(dir, "config", "push.default", policy);
      assertBlock(runHook("git push origin", { cwd: dir }), reason);
    }
    git(dir, "config", "push.default", "");
    assertBlock(runHook("git push origin", { cwd: dir }), /cannot resolve.*implicit push/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("detached implicit pushes fail closed while explicit refspecs preserve precedence", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    git(dir, "checkout", "-q", "--detach");

    assertBlock(runHook("git push origin", { cwd: dir }), /implicit push from detached HEAD/);
    assertAllow(runHook("git push origin HEAD:refs/heads/main", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit protected destinations are gated from detached HEAD and other branches", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");

    git(dir, "checkout", "-q", "main");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /verification is failed/
    );
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: dir }));
    assertAllow(runHook("git push origin refs/tags/release-candidate", { cwd: dir }));
    assertAllow(runHook("git push origin :refs/heads/feat/x", { cwd: dir }));

    git(dir, "checkout", "-q", "--detach");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /verification is failed/
    );
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: dir }));
    assertAllow(runHook("git push origin --tags", { cwd: dir }));
    assertAllow(runHook("git push origin :refs/heads/feat/x", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured protected destinations are gated independently of checkout identity", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    git(dir, "config", "remote.origin.push", "HEAD:refs/heads/feat/x");

    git(dir, "checkout", "-q", "main");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);
    git(dir, "checkout", "-q", "--detach");
    assertBlock(runHook("git push origin", { cwd: dir }), /verification is failed/);

    git(dir, "config", "--unset-all", "remote.origin.push");
    git(dir, "checkout", "-q", "main");
    assertAllow(runHook("git push origin", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("wildcard, mirror, and multi-ref pushes bind protected destinations, not checkout", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    git(dir, "checkout", "-q", "main");

    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: dir }),
      /command line wildcard refspec/
    );
    assertBlock(
      runHook("git push origin HEAD:refs/heads/backup HEAD:refs/heads/feat/x", { cwd: dir }),
      /command line multi-ref push/
    );

    git(dir, "config", "remote.origin.mirror", "true");
    assertBlock(runHook("git push origin", { cwd: dir }), /remote\.origin\.mirror expands/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("multiple protected destinations fail before any single session can authorize them", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    git(dir, "checkout", "-q", "-b", "backup");
    writeGates(dir, "backup", passingManifest(dir, "backup", headSha(dir)));
    git(dir, "checkout", "-q", "main");

    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x HEAD:refs/heads/backup", { cwd: dir }),
      /multiple canonical PM session branches: feat\/x, backup|multiple canonical PM session branches: backup, feat\/x/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical session selection rejects slug collisions and malformed candidates", () => {
  const collision = makeRepo({ branch: "chore/Review++Gate" });
  const malformed = makeRepo();
  const invalidDirectory = makeRepo();
  try {
    writeGates(
      collision,
      "review-gate",
      passingManifest(collision, "review-gate", headSha(collision))
    );
    git(collision, "checkout", "-q", "main");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/chore/review-gate", { cwd: collision }),
      /canonical session slug collision/
    );

    writeGates(malformed, "x", passingManifest(malformed, "x", headSha(malformed)));
    fs.writeFileSync(
      path.join(malformed, ".pm", "dev-sessions", "x", "session.json"),
      '{"schema_version":2}'
    );
    git(malformed, "checkout", "-q", "main");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: malformed }),
      /cannot validate canonical session x/
    );

    fs.mkdirSync(path.join(malformed, ".pm", "dev-sessions", "unrelated"));
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: malformed }));
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: malformed }),
      /cannot classify wildcard push against canonical session/
    );

    const invalidRoot = path.join(invalidDirectory, ".pm", "dev-sessions");
    fs.mkdirSync(invalidRoot, { recursive: true });
    fs.writeFileSync(path.join(invalidRoot, "x"), "not a directory\n");
    git(invalidDirectory, "checkout", "-q", "main");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: invalidDirectory }),
      /cannot validate canonical session x: canonical session candidate is not a directory/
    );
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: invalidDirectory }),
      /cannot classify wildcard push against canonical session x: canonical session candidate is not a directory/
    );
  } finally {
    fs.rmSync(collision, { recursive: true, force: true });
    fs.rmSync(malformed, { recursive: true, force: true });
    fs.rmSync(invalidDirectory, { recursive: true, force: true });
  }
});

test("completed canonical sessions still protect their delivery branch", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    const sessionPath = path.join(dir, ".pm", "dev-sessions", "x", "session.json");
    const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    session.status = "complete";
    session.phase = "retro";
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

    git(dir, "checkout", "-q", "main");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical session inventory rejects symlinked candidates and entry floods", () => {
  const symlinked = makeRepo();
  const flooded = makeRepo();
  const excludedFlood = makeRepo();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-session-outside-"));
  try {
    const sessions = path.join(symlinked, ".pm", "dev-sessions");
    fs.mkdirSync(sessions, { recursive: true });
    fs.symlinkSync(outside, path.join(sessions, "x"));
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: symlinked }),
      /canonical session directory is a symlink/
    );

    const floodRoot = path.join(flooded, ".pm", "dev-sessions");
    fs.mkdirSync(floodRoot, { recursive: true });
    for (let index = 0; index < 513; index += 1)
      fs.mkdirSync(path.join(floodRoot, `session-${index}`));
    assertAllow(runHook("git push origin --tags", { cwd: flooded }));
    assertAllow(runHook("git push origin :refs/heads/feat/x", { cwd: flooded }));
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: flooded }));
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: flooded }),
      /canonical session inventory exceeds 512 entries/
    );

    const excludedRoot = path.join(excludedFlood, ".pm", "dev-sessions");
    fs.mkdirSync(excludedRoot, { recursive: true });
    for (let index = 0; index < 513; index += 1)
      fs.writeFileSync(path.join(excludedRoot, `note-${index}.md`), "historical session\n");
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: excludedFlood }));
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: excludedFlood }),
      /canonical session inventory exceeds 512 entries/
    );
  } finally {
    fs.rmSync(symlinked, { recursive: true, force: true });
    fs.rmSync(flooded, { recursive: true, force: true });
    fs.rmSync(excludedFlood, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("broad session inventory iterates incrementally and closes its directory", () => {
  const source = fs.readFileSync(HOOK, "utf8");
  const start = source.indexOf("function loadCanonicalSessionIndex");
  const end = source.indexOf("function destinationMatchesShape", start);
  const inventory = source.slice(start, end);
  assert.match(inventory, /fs\.opendirSync\(located\.directory\)/);
  assert.doesNotMatch(inventory, /readdirSync/);
  assert.match(inventory, /finally\s*\{\s*directory\.closeSync\(\);\s*\}/s);
});

test("broad pushes fail closed when inspection-only legacy gate markers exist", () => {
  const dir = makeRepo();
  try {
    writeLegacyGates(dir, "x", {});
    git(dir, "checkout", "-q", "main");

    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: dir }));
    assertAllow(runHook("git push origin --tags", { cwd: dir }));
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: dir }),
      /inspection-only legacy gate markers exist: x\.gates\.json/
    );

    git(dir, "config", "remote.origin.mirror", "true");
    assertBlock(
      runHook("git push origin", { cwd: dir }),
      /inspection-only legacy gate markers exist: x\.gates\.json/
    );
    git(dir, "config", "remote.origin.mirror", "false");

    writeCurrentGates(dir, {});
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: dir }),
      /inspection-only legacy gate markers exist/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured push refspecs preserve source commit binding", () => {
  const dir = makeRepo();
  try {
    const reviewedHead = headSha(dir);
    fs.writeFileSync(path.join(dir, "README.md"), "unreviewed configured source\n");
    git(dir, "add", "README.md");
    git(dir, "commit", "-q", "-m", "configured source");
    const configuredSource = headSha(dir);
    git(dir, "reset", "--hard", reviewedHead);
    writeGates(dir, "x", passingManifest(dir, "x", reviewedHead));
    git(
      dir,
      "config",
      "--replace-all",
      "remote.origin.push",
      `${configuredSource}:refs/heads/feat/x`
    );

    assertBlock(runHook("git push origin", { cwd: dir }), /commit mismatch|stale|does not match/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Git dry-run fixtures prove wildcard, tag-following, and mirror expansion", () => {
  const dir = makeRepo();
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-remote-"));
  try {
    git(remote, "init", "--bare", "-q");
    git(dir, "branch", "backup");
    git(dir, "tag", "-a", "release-candidate", "-m", "release candidate");
    git(dir, "remote", "add", "delivery", remote);

    const wildcard = git(
      dir,
      "push",
      "--dry-run",
      "--porcelain",
      "delivery",
      "refs/heads/*:refs/heads/*"
    );
    assert.match(wildcard, /refs\/heads\/backup:refs\/heads\/backup/);
    assert.match(wildcard, /refs\/heads\/feat\/x:refs\/heads\/feat\/x/);

    git(dir, "config", "push.followTags", "true");
    const followed = git(
      dir,
      "push",
      "--dry-run",
      "--porcelain",
      "delivery",
      "HEAD:refs/heads/feat/x"
    );
    assert.match(followed, /refs\/tags\/release-candidate:refs\/tags\/release-candidate/);
    const disabled = git(
      dir,
      "push",
      "--dry-run",
      "--porcelain",
      "--no-follow-tags",
      "delivery",
      "HEAD:refs/heads/feat/x"
    );
    assert.doesNotMatch(disabled, /refs\/tags\/release-candidate/);

    git(dir, "config", "push.followTags", "false");
    git(dir, "config", "remote.delivery.mirror", "true");
    const mirrored = git(dir, "push", "--dry-run", "--porcelain", "delivery");
    assert.match(mirrored, /refs\/heads\/backup:refs\/heads\/backup/);
    assert.match(mirrored, /refs\/heads\/feat\/x:refs\/heads\/feat\/x/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(remote, { recursive: true, force: true });
  }
});

test("in-scope wildcard refspecs fail closed while out-of-scope wildcards remain allowed", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    assertBlock(
      runHook("git push origin 'refs/heads/*:refs/heads/*'", { cwd: dir }),
      /command line wildcard refspec can expand the session-branch push/
    );
    assertBlock(
      runHook("git push origin 'refs/heads/feat/*:refs/heads/feat/*'", { cwd: dir }),
      /command line wildcard refspec can expand the session-branch push/
    );

    git(dir, "config", "remote.origin.push", "refs/heads/*:refs/heads/*");
    assertBlock(
      runHook("git push origin", { cwd: dir }),
      /configured wildcard refspec can expand the session-branch push/
    );

    writeFailingGates(dir, "x");
    git(
      dir,
      "config",
      "--replace-all",
      "remote.origin.push",
      "refs/heads/release/*:refs/heads/release/*"
    );
    assertAllow(runHook("git push origin", { cwd: dir }));
    assertAllow(
      runHook("git push origin 'refs/heads/release/*:refs/heads/release/*'", { cwd: dir })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("tag expansion fails closed only when the same push updates the session branch", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    for (const command of [
      "git push --tags origin HEAD:refs/heads/feat/x",
      "git push origin HEAD:refs/heads/feat/x --tags",
      "git push --follow-tags origin HEAD:refs/heads/feat/x",
    ])
      assertBlock(runHook(command, { cwd: dir }), /additional tag updates/);

    writeFailingGates(dir, "x");
    assertAllow(runHook("git push origin --tags", { cwd: dir }));
    assertAllow(runHook("git push --tags origin HEAD:refs/heads/backup", { cwd: dir }));
    assertAllow(runHook("git push --follow-tags origin HEAD:refs/heads/backup", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("push.followTags honors CLI precedence and malformed configuration fails closed", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    git(dir, "config", "push.followTags", "true");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /configured push\.followTags expands/
    );
    assertBlock(
      runHook("git push --no-follow-tags origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /verification is failed/
    );
    assertAllow(runHook("git push origin HEAD:refs/heads/backup", { cwd: dir }));

    git(dir, "config", "push.followTags", "not-a-boolean");
    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /cannot read Git boolean configuration push\.followTags/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured mirror and --branches fail closed for session-branch expansion", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    git(dir, "config", "remote.origin.mirror", "true");
    assertBlock(
      runHook("git push origin", { cwd: dir }),
      /configured remote\.origin\.mirror expands/
    );

    git(dir, "config", "push.default", "upstream");
    git(dir, "config", "branch.feat/x.remote", "origin");
    git(dir, "config", "branch.feat/x.merge", "refs/heads/renamed");
    assertBlock(
      runHook("git push origin", { cwd: dir }),
      /configured remote\.origin\.mirror expands/
    );

    writeFailingGates(dir, "x");
    git(dir, "config", "remote.origin.push", "HEAD:refs/heads/backup");
    assertAllow(runHook("git push origin", { cwd: dir }));

    git(dir, "config", "--unset-all", "remote.origin.push");
    git(dir, "config", "remote.origin.mirror", "false");
    assertBlock(runHook("git push origin --branches", { cwd: dir }), /multi-ref --all\/--mirror/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit multi-ref pushes that include the session branch fail closed", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    for (const command of [
      "git push origin HEAD:refs/heads/feat/x HEAD:refs/heads/backup",
      "git push origin HEAD:refs/heads/backup HEAD:refs/heads/feat/x",
      "git push origin HEAD:refs/heads/feat/x HEAD:refs/heads/feat/x",
      "git push origin HEAD:refs/heads/feat/x feat/x:refs/heads/feat/x",
      "git push --repo origin HEAD:refs/heads/feat/x HEAD:refs/heads/backup",
    ])
      assertBlock(
        runHook(command, { cwd: dir }),
        /command line multi-ref push cannot be bound to one source commit/
      );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit multi-ref pushes excluding the session branch remain out of scope", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    for (const command of [
      "git push origin HEAD:refs/heads/main HEAD:refs/heads/backup",
      "git push origin HEAD:refs/heads/main HEAD:refs/tags/release-candidate",
    ])
      assertAllow(runHook(command, { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("single explicit session source keeps command-line precedence and source binding", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    git(dir, "config", "push.default", "matching");
    git(dir, "config", "remote.origin.push", "HEAD:refs/heads/backup");

    assertBlock(
      runHook("git push origin HEAD:refs/heads/feat/x", { cwd: dir }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("configured multi-ref pushes that include the session branch fail closed", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    git(dir, "config", "--add", "remote.origin.push", "HEAD:refs/heads/feat/x");
    git(dir, "config", "--add", "remote.origin.push", "HEAD:refs/heads/backup");

    assertBlock(
      runHook("git push origin", { cwd: dir }),
      /configured multi-ref push cannot be bound to one source commit/
    );

    git(dir, "config", "--replace-all", "remote.origin.push", ":");
    assertBlock(runHook("git push origin", { cwd: dir }), /matching multi-ref push/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// PARSER ROBUSTNESS FOR NATURAL FORMS (BLOCKING #4). Quotes/parens stripped,
// backslash-newline treated as a continuation (joined), wrappers honored.
// ---------------------------------------------------------------------------

test("subshell and quoted push forms are detected → block", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertBlock(runHook("(git push)", { cwd: dir }), /verification is failed/);
    assertBlock(runHook('git "push"', { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backslash-newline continuation is joined, not split, so refspec scoping sees the whole command", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    // Continuation → one command `git push origin HEAD` → gated → block.
    assertBlock(runHook("git push \\\norigin HEAD", { cwd: dir }), /verification is failed/);
    // Continuation of a cross-branch push → still one command → out of scope → allow.
    assertAllow(runHook("git push \\\norigin main", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("wrapper-prefixed pushes (sudo / VAR=1 / env) are detected → block", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertBlock(runHook("sudo git push", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("VAR=1 git push", { cwd: dir }), /verification is failed/);
    assertBlock(
      runHook("env FOO=bar git push origin HEAD", { cwd: dir }),
      /verification is failed/
    );
    assertBlock(runHook("command -- git push origin HEAD", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("env -- git push origin HEAD", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("env -i git push origin HEAD", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("command -p git push origin HEAD", { cwd: dir }), /verification is failed/);
    assertBlock(
      runHook("sudo -u user git push origin HEAD", { cwd: dir }),
      /verification is failed/
    );
    assertBlock(runHook("nice -n 5 git push origin HEAD", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("env -S 'git push origin HEAD'", { cwd: dir }), /verification is failed/);
    assertBlock(runHook("env -S 'git' push origin HEAD", { cwd: dir }), /verification is failed/);
    const spaced = path.join(dir, "gated repo");
    fs.mkdirSync(spaced);
    makeRepoAt(spaced);
    writeFailingGates(spaced, "x");
    assertBlock(
      runHook("env -S 'git -C' 'gated repo' push origin HEAD", { cwd: dir }),
      /verification is failed/
    );
    assertBlock(
      runHook("CMD=git env -S '${CMD}' push origin HEAD", { cwd: dir }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("env -S 'git push -o' '$TRACE' origin HEAD", { cwd: dir }),
      /verification is failed/
    );
    assertBlock(
      runHook("env -S 'git\\_push\\_origin\\_HEAD'", { cwd: dir }),
      /could not determine the repository/
    );
    assertBlock(
      runHook("env -S 'env -S env -S env -S env -S git push origin HEAD'", { cwd: dir }),
      /could not determine the repository/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("repository-selecting environment assignments fail closed across wrappers", () => {
  const dir = makeRepo();
  const alternate = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    const alternateGitDir = path.join(alternate, ".git");
    for (const command of [
      `GIT_DIR=${alternateGitDir} git push origin HEAD`,
      `GIT_WORK_TREE=${alternate} git push origin HEAD`,
      `GIT_COMMON_DIR=${alternateGitDir} git push origin HEAD`,
      `env GIT_DIR=${alternateGitDir} git push origin HEAD`,
      `sh -c 'GIT_WORK_TREE=${alternate} git push origin HEAD'`,
      `env -S 'GIT_COMMON_DIR=${alternateGitDir} git push origin HEAD'`,
    ])
      assertBlock(runHook(command, { cwd: dir }), /could not determine the repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(alternate, { recursive: true, force: true });
  }
});

test("common execution wrappers cannot bypass a failed push gate", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    for (const command of [
      "timeout 600 git push origin HEAD",
      "timeout -k 5 600 git push origin HEAD",
      "timeout 600 -- git push origin HEAD",
      "nohup git push origin HEAD",
      "noglob git push origin HEAD",
      "xcrun git push origin HEAD",
      "/usr/bin/xcrun --sdk macosx git push origin HEAD",
      "arch -arm64 git push origin HEAD",
      "arch -arch arm64 git push origin HEAD",
      "arch -d FLAG git push origin HEAD",
      "arch -e FLAG=value git push origin HEAD",
      "env -a git git push origin HEAD",
      "env --argv0 git git push origin HEAD",
    ])
      assertBlock(runHook(command, { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("cwd-changing wrapper options gate the effective repository", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "pm-push-gate-wrapper-cwd-"));
  const gated = path.join(parent, "gated");
  try {
    fs.mkdirSync(gated);
    makeRepoAt(gated);
    writeFailingGates(gated, "x");
    for (const command of [
      "env -C gated git push origin HEAD",
      "env -Cgated git push origin HEAD",
      "env -iCgated git push origin HEAD",
      "env --chdir=gated git push origin HEAD",
      "sudo -D gated git push origin HEAD",
      "sudo -Dgated git push origin HEAD",
      "sudo -nDgated git push origin HEAD",
    ])
      assertBlock(runHook(command, { cwd: parent }), /verification is failed/);
    const literal = path.join(parent, "repo$archive");
    fs.mkdirSync(literal);
    makeRepoAt(literal);
    writeFailingGates(literal, "x");
    assertBlock(
      runHook("env -C 'repo$archive' git push origin HEAD", { cwd: parent }),
      /verification is failed/
    );
    assertBlock(
      runHook("env -P /usr/bin git push origin HEAD", { cwd: gated }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("push commands containing here-documents fail closed before payload lines are parsed", () => {
  const dir = makeRepo();
  try {
    const command = "cat <<EOF\ncd ../ungated\nEOF\ngit push origin HEAD";
    assertBlock(runHook(command, { cwd: dir }), /cannot safely inspect.*here-document/);
    assertAllow(runHook("cat <<EOF\npush notification text\nEOF", { cwd: dir }));
    assertAllow(
      runHook("cat <<ONE <<TWO\nfirst payload\nONE\npush notification text\nTWO", { cwd: dir })
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dynamic push-option payloads do not obscure a static push identity", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    for (const command of [
      "git push -o trace=$TRACE origin HEAD",
      "git push --push-option=$TRACE origin HEAD",
      "git push --receive-pack $RECEIVE origin HEAD",
    ])
      assertBlock(runHook(command, { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("invocation-local Git configuration cannot override reviewed push authority", () => {
  const dir = makeRepo();
  try {
    writeGates(dir, "x", passingManifest(dir, "x", headSha(dir)));
    for (const command of [
      "git -c remote.origin.pushurl=/tmp/other push origin HEAD",
      "git -cremote.origin.pushurl=/tmp/other push origin HEAD",
      "git --config-env remote.origin.pushurl=OVERRIDE push origin HEAD",
      "git --config-env=remote.origin.pushurl=OVERRIDE push origin HEAD",
      "GIT_CONFIG_COUNT=1 git push origin HEAD",
    ])
      assertBlock(runHook(command, { cwd: dir }), /could not determine the repository/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a non-push subcommand whose name merely contains 'push' is allowed (substring guard)", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertAllow(runHook("git pushx origin HEAD", { cwd: dir }));
    assertAllow(runHook("git push-mirror origin", { cwd: dir }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// --git-dir / --work-tree targeting (BLOCKING #4/#6): honor the value when
// resolving which repo to gate (today --git-dir= drops the target).
// ---------------------------------------------------------------------------

test("--git-dir= value resolves the target repo for gating", () => {
  const repo = makeRepo();
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-gitdir-"));
  try {
    writeFailingGates(repo, "x", "review");
    const result = runHook(`git --git-dir=${repo}/.git --work-tree=${repo} push origin HEAD`, {
      cwd: elsewhere,
    });
    assertBlock(result, /review is failed/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test("standalone --work-tree does not replace the pushed repository identity", () => {
  const repo = makeRepo();
  const other = makeRepo();
  try {
    writeFailingGates(repo, "x");
    assertBlock(
      runHook(`git --work-tree=${other} push origin HEAD`, { cwd: repo }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test("--git-dir remains authoritative when --work-tree names another repository", () => {
  const source = makeRepo();
  const presentation = makeRepo();
  try {
    writeFailingGates(source, "x");
    writeGates(presentation, "x", passingManifest(presentation, "x", headSha(presentation)));
    assertBlock(
      runHook(`git --git-dir=${source}/.git --work-tree=${presentation} push origin HEAD`, {
        cwd: presentation,
      }),
      /verification is failed/
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(presentation, { recursive: true, force: true });
  }
});

test("linked-worktree git metadata resolves its authoritative checkout", () => {
  const source = makeRepo();
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-linked-"));
  fs.rmSync(linked, { recursive: true, force: true });
  try {
    git(source, "worktree", "add", "-q", "-b", "feat/linked", linked);
    writeFailingGates(linked, "linked");
    const gitDir = git(linked, "rev-parse", "--absolute-git-dir");
    assertBlock(
      runHook(`git --git-dir=${gitDir} push origin HEAD`, { cwd: source }),
      /verification is failed/
    );
  } finally {
    spawnSync("git", ["-C", source, "worktree", "remove", "--force", linked]);
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(linked, { recursive: true, force: true });
  }
});

test("linked-worktree metadata requires a reciprocal checkout pointer", () => {
  const source = makeRepo();
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-linked-source-"));
  const redirect = makeRepo({ branch: "feat/linked" });
  fs.rmSync(linked, { recursive: true, force: true });
  try {
    git(source, "worktree", "add", "-q", "-b", "feat/linked", linked);
    writeFailingGates(linked, "linked");
    writeGates(redirect, "linked", passingManifest(redirect, "linked", headSha(redirect)));
    const gitDir = git(linked, "rev-parse", "--absolute-git-dir");
    fs.writeFileSync(path.join(gitDir, "gitdir"), `${path.join(redirect, ".git")}\n`);
    assertBlock(
      runHook(`git --git-dir=${gitDir} push origin HEAD`, { cwd: redirect }),
      /could not bind this Git directory/
    );
  } finally {
    spawnSync("git", ["-C", source, "worktree", "remove", "--force", linked]);
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(linked, { recursive: true, force: true });
    fs.rmSync(redirect, { recursive: true, force: true });
  }
});

test("unmapped separate Git directories fail closed", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "push-gate-separate-"));
  const checkout = path.join(parent, "checkout");
  const metadata = path.join(parent, "metadata");
  const redirect = makeRepo();
  try {
    git(parent, "init", "-q", `--separate-git-dir=${metadata}`, checkout);
    git(checkout, "config", "user.email", "test@example.com");
    git(checkout, "config", "user.name", "Test User");
    fs.writeFileSync(path.join(checkout, "README.md"), "hi\n");
    git(checkout, "add", ".");
    git(checkout, "commit", "-q", "-m", "init");
    git(checkout, "remote", "add", "origin", ".");
    git(checkout, "checkout", "-q", "-b", "feat/x");
    writeFailingGates(checkout, "x");
    assertBlock(
      runHook(`git --git-dir=${metadata} push origin HEAD`, { cwd: parent }),
      /could not bind this Git directory/
    );
    git(checkout, "config", "core.worktree", checkout);
    assertBlock(
      runHook(`git --git-dir=${metadata} push origin HEAD`, { cwd: parent }),
      /verification is failed/
    );
    git(checkout, "config", "core.worktree", redirect);
    assertBlock(
      runHook(`git --git-dir=${metadata} push origin HEAD`, { cwd: parent }),
      /could not bind this Git directory/
    );
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
    fs.rmSync(redirect, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// DEGRADE PATH (BLOCKING #1 partner): a failing manifest with no origin/DEFAULT
// fetched still blocks — the checker runs without --base and the core gate
// checks catch the failure. (makeRepo has no origin remote.)
// ---------------------------------------------------------------------------

test("failing manifest blocks even when origin/DEFAULT_BRANCH is not present", () => {
  const dir = makeRepo();
  try {
    writeFailingGates(dir, "x");
    assertBlock(runHook("git push", { cwd: dir }), /verification is failed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Migration diagnostics name the canonical destination that must be recertified.
// ---------------------------------------------------------------------------

test("current.gates.json denial names the required canonical manifest", () => {
  const dir = makeRepo();
  try {
    const m = passingManifest(dir, "x", headSha(dir));
    m.gates.find((g) => g.name === "verification").status = "failed";
    m.gates.find((g) => g.name === "verification").reason = "tests failed";
    writeCurrentGates(dir, m);

    const result = runHook("git push", { cwd: dir });
    assertBlock(result, /\.pm\/dev-sessions\/x\/gates\.json/);
    assert.match(decisionOf(result).permissionDecisionReason, /inspection-only/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
