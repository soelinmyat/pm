"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("PM-native design critique is in the plugin inventory", () => {
  const config = JSON.parse(read("plugin.config.json"));
  assert.ok(config.commands.includes("design-critique"));
  assert.ok(config.codex.fallbackSkillAliases.pm.includes("design-critique"));
  assert.ok(fs.existsSync(path.join(repoRoot, "commands", "design-critique.md")));
  assert.ok(fs.existsSync(path.join(repoRoot, "skills", "design-critique", "SKILL.md")));
});

test("phase-local design critique requires the PM-native skill", () => {
  const text = read("skills/dev/steps/06-design-critique.md");
  assert.match(text, /pm:design-critique/);
  assert.match(text, /skill invocation is the gate/i);
  assert.doesNotMatch(text, /skipped \(skill not available\)/i);
});

test("separate quality phases record gate evidence and run the checker", () => {
  const text = [
    read("skills/dev/steps/06-design-critique.md"),
    read("skills/dev/steps/07-qa.md"),
    read("skills/dev/steps/08-review.md"),
  ].join("\n");
  assert.match(text, /gate manifest/);
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /design-critique: passed/);
  assert.match(text, /qa: passed/);
  assert.match(text, /review` and `verification` rows/);
});

test("review absorbed the simplify lenses (v1.9)", () => {
  const skill = read("skills/review/SKILL.md");
  const briefs = read("skills/review/references/reviewer-briefs.md");
  const contract = read("scripts/lib/review-contract.js");
  assert.match(skill, /six logical lenses/);
  assert.match(briefs, /`bug`/);
  assert.match(briefs, /`design`/);
  assert.match(briefs, /`edge`/);
  assert.match(briefs, /`reuse`/);
  assert.match(briefs, /`quality`/);
  assert.match(briefs, /`efficiency`/);
  assert.match(contract, /"bug", "design", "edge", "reuse", "quality", "efficiency"/);
  // the dev step is gone; the skill file survives only as a deprecation stub
  // (the pre-push hook requires a SKILL.md for every configured command)
  const stub = read("skills/simplify/SKILL.md");
  assert.match(stub, /absorbed into `pm:review`/);
  assert.match(stub, /skills\/review\/SKILL\.md/);
  assert.ok(stub.length < 1000, "simplify stub must stay a pointer, not a workflow");
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "skills/dev/steps/06-simplify.md")),
    "06-simplify step must be deleted"
  );
  // the command shim survives for muscle memory and routes to review
  const shim = read("commands/simplify.md");
  assert.match(shim, /absorbed into `pm:review`/);
  assert.match(shim, /skills\/review\/SKILL\.md/);
});

test("design critique uses the bound two-mode evidence contract", () => {
  const skill = read("skills/design-critique/SKILL.md");
  const scope = read("skills/design-critique/steps/01-scope.md");
  const capture = read("skills/design-critique/steps/02-capture.md");
  const evaluate = read("skills/design-critique/steps/03-critique.md");
  const resolve = read("skills/design-critique/steps/04-resolve.md");
  const publish = read("skills/design-critique/steps/05-publish.md");
  const contract = read("skills/design-critique/references/evidence-contract.md");
  assert.match(skill, /`product-ui`/);
  assert.match(skill, /`pm-artifact`/);
  assert.match(skill, /NEVER PASS WITHOUT COMPLETE, CURRENT, HASH-BOUND RENDERED EVIDENCE/);
  assert.match(scope, /diff --binary/);
  assert.match(scope, /primary, empty, error, and boundary/);
  assert.match(capture, /artifact-render-check\.js/);
  assert.match(capture, /passing evidence cannot live only in `\/tmp`/);
  assert.match(evaluate, /Fresh Eyes/);
  assert.match(evaluate, /`design-critique`, `qa`, or `review`/);
  assert.match(resolve, /distinct `before_capture_id` and `after_capture_id`/);
  assert.match(resolve, /two total review rounds/);
  assert.match(publish, /scripts\/design-critique-check\.js/);
  assert.match(publish, /map `deferred` to `blocked`/);
  assert.match(publish, /\.pm\/dev-sessions\/\{slug\}\/gates\.json/);
  assert.doesNotMatch(publish, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(contract, /deterministic identity/);
  const devDesign = read("skills/dev/steps/06-design-critique.md");
  assert.match(devDesign, /design-critique-capture-guide\.md/);
  assert.match(devDesign, /viewport/);
  assert.match(
    publish,
    /Preserve `tdd`, legacy `simplify`, `qa`, `review`, and `verification` rows/
  );
});

test("review skip requires a current checked report and gate row", () => {
  const skill = read("skills/review/SKILL.md");
  const ship = read("skills/ship/steps/03-review.md");
  const publish = read("skills/review/steps/05-publish.md");
  assert.match(skill, /checked `report\.json` and gate row already pass current validation/);
  assert.match(ship, /review\/report\.html/);
  assert.match(ship, /review\/report\.json/);
  assert.match(ship, /review-check\.js/);
  assert.match(publish, /\.pm\/dev-sessions\/\{slug\}\/gates\.json/);
  assert.doesNotMatch(publish, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(ship, /--from-report/);
  assert.match(ship, /do NOT skip/);
  assert.match(publish, /Preserve all other rows/);
  assert.match(publish, /evidence_kind/);
});

test("review preserves immutable fix rounds and publishes only the passing projection canonically", () => {
  const contract = read("skills/review/references/evidence-contract.md");
  const target = read("skills/review/steps/01-target.md");
  const synthesize = read("skills/review/steps/03-synthesize.md");
  const resolve = read("skills/review/steps/04-resolve.md");
  const publish = read("skills/review/steps/05-publish.md");
  assert.match(contract, /round-1\//);
  assert.match(contract, /Never overwrite a finalized prior run or round/);
  assert.match(contract, /kind:ref:digest/);
  assert.match(contract, /literal `unbound` sentinel/);
  assert.match(target, /runs\/\{RUN_ID\}\/round-\{N\}\/target\.json/);
  assert.match(synthesize, /review-report\.js.*draft-report\.json.*draft-report\.html/);
  assert.match(resolve, /round-\{N-1\}\/report\.json/);
  assert.match(resolve, /Check `review_round` against `iteration_cap` before any edit/);
  assert.ok(
    resolve.indexOf("finalize, render, and validate") < resolve.indexOf("Apply one coherent")
  );
  assert.match(publish, /For `failed` or `blocked`/);
  assert.match(publish, /canonical .*review\/report\.json/);
});

test("review treats PM plugin Markdown runtime files as reviewable source", () => {
  const target = read("scripts/review-target.js");
  const briefs = read("skills/review/references/reviewer-briefs.md");
  assert.match(target, /changed_files: changedFiles/);
  assert.match(target, /sha256: digest\(bytes\), bytes: bytes\.length/);
  assert.doesNotMatch(target, /docs-only|config-only/);
  assert.match(briefs, /PM plugin runtime Markdown is source/);
});

test("review report navigation wraps without narrow horizontal overflow", () => {
  const template = read("references/templates/review-report.html");
  assert.match(template, /@media\(max-width:720px\).*nav ul\{flex-wrap:wrap/);
  assert.match(template, /\.lede\{[^}]*overflow-wrap:anywhere/);
  assert.match(template, /\.summary p\{[^}]*min-width:0[^}]*overflow-wrap:anywhere/);
  assert.match(template, /\.finding h3,\.finding p\{overflow-wrap:anywhere/);
});

test("low-risk S work receives a code scan instead of silently skipping review", () => {
  const risk = read("skills/dev/references/risk-routing.md");
  const review = read("skills/dev/steps/08-review.md");
  assert.match(risk, /low-risk XS\/S work uses the code-scan review mode/);
  assert.match(review, /session\.routing\.review_mode/);
  assert.match(review, /`code-scan` targets bug, edge, reuse, quality, and efficiency/);
  assert.doesNotMatch(review, /S tasks skip both code scan and full review/);
});

test("XS work uses the same durable runner and cannot bypass final gates", () => {
  const text = read("skills/dev/SKILL.md");
  assert.doesNotMatch(text, /XS Express/);
  assert.match(text, /create canonical state for fresh work/i);
  assert.match(text, /Complete routed gates/);
  assert.match(text, /scripts\/dev-gate-check\.js/);
});

test("implementation records red-green and post-integration evidence", () => {
  const text = read("skills/dev/steps/05-implementation.md");
  assert.match(text, /observe the targeted test fail before behavioral implementation/);
  assert.match(text, /run targeted tests and the project-appropriate suite/);
  assert.match(text, /Accepted commits are reachable from the current worktree HEAD/);
});

test("multi-work-unit dispatch keeps integration and delivery authority at root", () => {
  const text = read("skills/dev/references/multi-task-dispatch.md");
  assert.match(text, /validateWorkUnits/);
  assert.match(text, /analyzeWorkUnits/);
  assert.match(
    text,
    /Push, PR, merge, tracker updates, and aggregate gate changes are always false/
  );
  assert.match(text, /root integrates commits in deterministic DAG order/);
});

test("runtime policy lives in data and adapters rather than provider-specific worker prose", () => {
  const runtime = read("skills/dev/references/agent-runtime.md");
  const profiles = JSON.parse(read("skills/dev/references/model-profiles.json"));
  assert.match(runtime, /scripts\/dev-runtime\/dispatch\.js/);
  assert.equal(profiles.profiles["codex-workhorse"].model, "gpt-5.6-sol");
  assert.equal(profiles.profiles["claude-workhorse"].model, "claude-opus-4-8");
  assert.doesNotMatch(runtime, /dangerously-skip-permissions/);
  assert.match(runtime, /Broad modes .* require `PM_DEV_ALLOW_BROAD_PERMISSIONS=1`/);
});

test("phase-local QA blocks environment failures instead of skipping them", () => {
  const text = read("skills/dev/steps/07-qa.md");
  assert.match(text, /unavailable app, auth flow, database, seed, or required service/i);
  assert.match(text, /`blocked`, never `passed` or `skipped`/);
});

test("state schema treats simplify as tolerated legacy, not a required gate", () => {
  const schema = read("skills/dev/references/state-schema.md");
  assert.match(schema, /"size": "M"/);
  assert.match(schema, /"kind": "proposal"/);
  assert.match(schema, /tolerated legacy name/);
  assert.match(schema, /never required, never validated for freshness/);
  assert.doesNotMatch(schema, /Required before push:.*simplify/);
});

test("dev QA gate dispatch points workers at the QA reference, not a missing skill", () => {
  const reviewStep = read("skills/dev/steps/07-qa.md");
  const qaReference = read("skills/dev/references/qa.md");
  assert.match(reviewStep, /- qa\.md/);
  assert.doesNotMatch(reviewStep, /Follow the pm:qa skill/);
  assert.match(qaReference, /does not install a standalone `pm:qa` command or skill/);
  assert.match(qaReference, /Manual reference mode/);
  assert.doesNotMatch(qaReference, /pm:qa --page/);
  assert.doesNotMatch(qaReference, /Invoked as pm:qa skill/);
});

test("phase-local review requires evidenced recertification before the full checker", () => {
  const text = read("skills/dev/steps/08-review.md");
  const recertIndex = text.indexOf("dev-session recertify --evidence");
  const checkerIndex = text.indexOf("scripts/dev-gate-check.js");
  assert.ok(recertIndex > -1, "recertification section must exist");
  assert.ok(checkerIndex > recertIndex, "full checker must run after recertification");
  assert.match(text, /bare commit or timestamp is never sufficient/);
  assert.match(text, /rerun the gate instead of recertifying/);
});

test("implementation flow runs the gate checker before push and PR creation", () => {
  const text = read("skills/dev/references/implementation-flow.md");
  const block = text.match(/### Push and create PR[\s\S]*?```bash\n([\s\S]*?)```/);
  assert.ok(block, "implementation flow must include a push/create command block");
  assert.match(text, /08-review\.md/);
  assert.match(text, /fresh phase-keyed evidence/);
  const checkerIndex = block[1].indexOf("scripts/dev-gate-check.js");
  const pushIndex = block[1].indexOf("git push origin {BRANCH}");
  const prIndex = block[1].indexOf("gh pr create");
  assert.ok(checkerIndex > -1, "push block must run dev-gate-check");
  assert.match(block[1], /--base origin\/\{DEFAULT_BRANCH\}/);
  assert.match(block[1], /--review-evidence-mode enforce/);
  assert.match(block[1], /\.pm\/dev-sessions\/\{slug\}\/gates\.json/);
  assert.ok(pushIndex > checkerIndex, "checker must appear before git push");
  assert.ok(prIndex > checkerIndex, "checker must appear before gh pr create");
});

test("ship push step requires the full default gate contract before git push", () => {
  const text = read("skills/ship/steps/04-push.md");
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /--base origin\/\{DEFAULT_BRANCH\}/);
  assert.match(text, /--review-evidence-mode enforce/);
  assert.match(text, /\.pm\/dev-sessions\/\{slug\}\/gates\.json/);
  assert.doesNotMatch(text, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.doesNotMatch(text, /--require review,verification/);
  assert.match(text, /any required gate row is stale/);
  assert.match(text, /any required gate is missing/);
  assert.match(text, /verified_commit/);
});

test("ship merge loop rechecks the full sidecar against the remote branch tip", () => {
  const text = read("skills/ship/steps/07-merge-loop.md");
  assert.match(text, /\.pm\/dev-sessions\/\{slug\}\/gates\.json/);
  assert.doesNotMatch(text, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(text, /git rev-parse origin\/\{branch\}/);
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /effective attestation is `commit` when it equals `remote_tip`/);
  assert.match(text, /otherwise `verified_commit` when it equals `remote_tip`/);
  assert.match(text, /do not require every raw `commit` field to equal the remote tip/);
  assert.match(text, /--changed-files "\$changed_files"/);
  assert.match(text, /--review-evidence-mode enforce/);
  assert.match(text, /final recertification pass/);
  assert.doesNotMatch(text, /--require review,verification/);
});

test("state schema documents verified_commit recertification semantics", () => {
  const text = read("skills/dev/references/state-schema.md");
  assert.match(text, /"verified_commit": "def456"/);
  assert.match(text, /"verified_at": "2026-04-04T05:10:00Z"/);
  assert.match(
    text,
    /Final push\/ship checks accept a row only when either `commit` or `verified_commit` equals/
  );
  assert.match(text, /`passed` rows need an existing artifact path/);
  assert.match(
    text,
    /Environment failures, auth failures, missing DBs, or servers that cannot start are `blocked`, not `skipped`/
  );
});

test("source repo pre-push hook uses the shared gate checker for PM runtime changes", () => {
  const text = read(".githooks/pre-push");
  assert.match(text, /derive_gate_slug/);
  assert.match(text, /verify_pm_commit_inventory/);
  assert.match(text, /run_commit_tests/);
  assert.match(text, /git worktree add --detach --quiet "\$test_tmp" "\$commit"/);
  assert.match(text, /git worktree remove --force "\$test_tmp"/);
  assert.match(
    text,
    /env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE -u GIT_PREFIX node --test tests\/\*\.test\.js/
  );
  assert.match(text, /git cat-file -e "\$commit:\$required_path"/);
  assert.match(text, /git show "\$commit:plugin\.config\.json"/);
  assert.match(text, /commands\/\$\{name\}\.md/);
  assert.match(text, /skills\/\$\{name\}\/SKILL\.md/);
  assert.match(text, /git archive --format=tar --output="\$checker_archive" "\$local_oid" scripts/);
  assert.match(text, /tar -xf "\$checker_archive" -C "\$checker_tmp"/);
  assert.match(text, /if ! node "\$checker_tmp\/scripts\/dev-gate-check\.js"/);
  assert.doesNotMatch(text, /if ! node scripts\/dev-gate-check\.js/);
  assert.doesNotMatch(text, /if ! node --test tests\/\*\.test\.js/);
  assert.match(text, /--base origin\/main/);
  assert.match(text, /--review-evidence-mode enforce/);
  assert.match(text, /unable to verify origin\/main/);
  assert.match(text, /unable to diff origin\/main\.\.\.\$local_oid/);
  assert.match(text, /push_ref_lines/);
  assert.match(text, /--commit "\$local_oid"/);
  assert.match(text, /canonical_session_dir="\.pm\/dev-sessions\/\$\{gate_slug\}"/);
  assert.match(text, /canonical_gate_manifest="\$\{canonical_session_dir\}\/gates\.json"/);
  assert.match(text, /elif \[\[ -f "\$legacy_gate_manifest" \]\]/);
  assert.match(text, /origin\/main\.\.\.\$local_oid/);
  assert.match(text, /changed_pm_runtime_files/);
  assert.match(text, /plugin\.config\.json/);
  assert.match(text, /\.claude-plugin/);
  assert.match(text, /\.codex-plugin/);
  assert.match(text, /\.codex\/INSTALL\.md/);
  assert.match(text, /README\.md/);
  assert.match(text, /references agents/);
  assert.doesNotMatch(text, /--require review,verification/);
  assert.match(text, /then\n\s+exit 1/);
});

test("pre-push runs tests from the pushed commit, not the dirty worktree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pre-push-tests-"));
  try {
    const hook = path.join(dir, "pre-push");
    fs.copyFileSync(path.join(repoRoot, ".githooks", "pre-push"), hook);
    fs.chmodSync(hook, 0o755);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tests", "fail.test.js"), 'throw new Error("boom");\n');
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "failing test").status, 0);
    const base = git("rev-parse", "HEAD").stdout.trim();
    assert.equal(git("update-ref", "refs/remotes/origin/main", base).status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(dir, "tests", "fail.test.js"), 'console.log("dirty pass");\n');

    const zeroOid = "0000000000000000000000000000000000000000";
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync("bash", [hook, "origin"], {
      cwd: dir,
      env,
      encoding: "utf8",
      input: `refs/heads/codex/harden ${localOid} refs/heads/codex/harden ${zeroOid}\n`,
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /ERROR: tests failed for pushed commit/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-push committed-test worktree preserves git repository context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pre-push-git-tests-"));
  try {
    const hook = path.join(dir, "pre-push");
    fs.copyFileSync(path.join(repoRoot, ".githooks", "pre-push"), hook);
    fs.chmodSync(hook, 0o755);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "tests", "git-context.test.js"),
      [
        'const test = require("node:test");',
        'const assert = require("node:assert/strict");',
        'const { spawnSync } = require("node:child_process");',
        'test("has git context", () => {',
        '  const result = spawnSync("git", ["rev-parse", "--git-dir"], { encoding: "utf8" });',
        "  assert.equal(result.status, 0, result.stderr);",
        "});",
        "",
      ].join("\n")
    );
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "git context test").status, 0);
    const base = git("rev-parse", "HEAD").stdout.trim();
    assert.equal(git("update-ref", "refs/remotes/origin/main", base).status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();

    const zeroOid = "0000000000000000000000000000000000000000";
    const result = spawnSync("bash", [hook, "origin"], {
      cwd: dir,
      encoding: "utf8",
      input: `refs/heads/codex/harden ${localOid} refs/heads/codex/harden ${zeroOid}\n`,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-push runs the dev gate checker from the pushed commit, not the dirty worktree", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pre-push-"));
  try {
    const hook = path.join(dir, "pre-push");
    fs.copyFileSync(path.join(repoRoot, ".githooks", "pre-push"), hook);
    fs.chmodSync(hook, 0o755);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills", "dev"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.config.json"),
      JSON.stringify({ commands: ["dev"] }, null, 2)
    );
    fs.writeFileSync(path.join(dir, "commands", "dev.md"), "dev command\n");
    fs.writeFileSync(
      path.join(dir, "skills", "dev", "SKILL.md"),
      "---\nname: dev\ndescription: dev skill\n---\n"
    );
    fs.writeFileSync(
      path.join(dir, "scripts", "dev-gate-check.js"),
      'require("./lib/checker-helper");\n'
    );
    fs.writeFileSync(path.join(dir, "scripts", "lib", "checker-helper.js"), "process.exit(0);\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "base").status, 0);
    assert.equal(git("branch", "-M", "main").status, 0);
    const base = git("rev-parse", "HEAD").stdout.trim();
    assert.equal(git("update-ref", "refs/remotes/origin/main", base).status, 0);
    assert.equal(git("checkout", "-q", "-b", "codex/harden").status, 0);
    fs.writeFileSync(path.join(dir, "commands", "dev.md"), "changed runtime\n");
    fs.writeFileSync(path.join(dir, "scripts", "lib", "checker-helper.js"), "process.exit(42);\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime change").status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();

    fs.writeFileSync(path.join(dir, "scripts", "dev-gate-check.js"), "process.exit(0);\n");
    fs.mkdirSync(path.join(dir, ".pm", "dev-sessions", "harden"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pm", "dev-sessions", "harden", "gates.json"), "{}\n");

    const zeroOid = "0000000000000000000000000000000000000000";
    const result = spawnSync("bash", [hook, "origin"], {
      cwd: dir,
      encoding: "utf8",
      input: `refs/heads/codex/harden ${localOid} refs/heads/codex/harden ${zeroOid}\n`,
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /missing 'description'/);
    assert.match(result.stdout + result.stderr, /Checking PM dev gates for codex\/harden/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-push never lets a flat legacy manifest shadow a canonical session", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pre-push-canonical-gate-"));
  try {
    const hook = path.join(dir, "pre-push");
    fs.copyFileSync(path.join(repoRoot, ".githooks", "pre-push"), hook);
    fs.chmodSync(hook, 0o755);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills", "dev"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.config.json"),
      JSON.stringify({ commands: ["dev"] }, null, 2)
    );
    fs.writeFileSync(path.join(dir, "commands", "dev.md"), "dev command\n");
    fs.writeFileSync(
      path.join(dir, "skills", "dev", "SKILL.md"),
      "---\nname: dev\ndescription: dev skill\n---\n"
    );
    fs.writeFileSync(path.join(dir, "scripts", "dev-gate-check.js"), "process.exit(0);\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "base").status, 0);
    assert.equal(git("branch", "-M", "main").status, 0);
    const base = git("rev-parse", "HEAD").stdout.trim();
    assert.equal(git("update-ref", "refs/remotes/origin/main", base).status, 0);
    assert.equal(git("checkout", "-q", "-b", "codex/harden").status, 0);
    fs.writeFileSync(path.join(dir, "commands", "dev.md"), "changed runtime\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime change").status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();

    fs.mkdirSync(path.join(dir, ".pm", "dev-sessions", "harden"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pm", "dev-sessions", "harden.gates.json"), "{}\n");

    const zeroOid = "0000000000000000000000000000000000000000";
    const result = spawnSync("bash", [hook, "origin"], {
      cwd: dir,
      encoding: "utf8",
      input: `refs/heads/codex/harden ${localOid} refs/heads/codex/harden ${zeroOid}\n`,
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /Expected \.pm\/dev-sessions\/harden\/gates\.json/);
    assert.doesNotMatch(result.stdout + result.stderr, /Checking PM dev gates/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("pre-push fails closed when origin/main is unavailable for PM runtime changes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pre-push-no-base-"));
  try {
    const hook = path.join(dir, "pre-push");
    fs.copyFileSync(path.join(repoRoot, ".githooks", "pre-push"), hook);
    fs.chmodSync(hook, 0o755);
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
    fs.mkdirSync(path.join(dir, "skills", "dev"), { recursive: true });
    fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plugin.config.json"),
      JSON.stringify({ commands: ["dev"] }, null, 2)
    );
    fs.writeFileSync(path.join(dir, "commands", "dev.md"), "dev command\n");
    fs.writeFileSync(
      path.join(dir, "skills", "dev", "SKILL.md"),
      "---\nname: dev\ndescription: dev skill\n---\n"
    );
    fs.writeFileSync(path.join(dir, "scripts", "dev-gate-check.js"), "process.exit(0);\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime").status, 0);
    assert.equal(git("checkout", "-q", "-b", "codex/harden").status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();

    const zeroOid = "0000000000000000000000000000000000000000";
    const result = spawnSync("bash", [hook, "origin"], {
      cwd: dir,
      encoding: "utf8",
      input: `refs/heads/codex/harden ${localOid} refs/heads/codex/harden ${zeroOid}\n`,
    });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /unable to verify origin\/main/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("slug normalization docs cover codex branches and shared helper", () => {
  const schema = read("skills/dev/references/state-schema.md");
  const review = read("skills/review/SKILL.md");
  const ship = read("skills/ship/SKILL.md");
  for (const text of [schema, review, ship]) {
    assert.match(text, /deriveSessionSlug/);
    assert.match(text, /codex\/pm-dev-workflow-proposal/);
    assert.match(text, /pm-dev-workflow-proposal/);
  }
});

test("UI sentinel checks the PM-native design critique gate", () => {
  const checks = read("evals/scenarios/dev-ui-design-critique-required/checks.sh");
  // Gate evidence = pm:design-critique invocation OR designer-agent dispatch;
  // the sentinel must name the PM-native skill either way.
  assert.match(checks, /gate-evidence pm:design-critique/);
  assert.doesNotMatch(checks, /skill-called critique\b/);
});
