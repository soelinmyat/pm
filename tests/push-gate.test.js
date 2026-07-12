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
  fs.writeFileSync(path.join(dir, "README.md"), "hi\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
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
