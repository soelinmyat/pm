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

test("dev review step requires PM-native design critique rather than external skill availability", () => {
  const text = read("skills/dev/steps/07-review.md");
  assert.match(text, /pm:design-critique/);
  assert.match(text, /do not depend on an external/);
  assert.match(text, /Skill not available\. PM owns `pm:design-critique`/);
  assert.doesNotMatch(text, /Design critique: skipped \(skill not available\)/);
});

test("dev review step records gate sidecar rows and runs the checker", () => {
  const text = read("skills/dev/steps/07-review.md");
  assert.match(text, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /--require design-critique/);
  assert.match(text, /--require review/);
  assert.match(text, /verification: passed/);
});

test("review absorbed the simplify lenses (v1.9)", () => {
  const skill = read("skills/review/SKILL.md");
  assert.match(skill, /category: bug \| design \| edge \| reuse \| quality \| efficiency/);
  assert.match(skill, /Lens 4: Code reuse/);
  assert.match(skill, /Lens 5: Code quality/);
  assert.match(skill, /Lens 6: Efficiency/);
  assert.match(skill, /category: reuse/);
  assert.match(skill, /category: quality/);
  assert.match(skill, /category: efficiency/);
  // the standalone skill and its dev step are gone
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "skills/simplify/SKILL.md")),
    "skills/simplify must be deleted"
  );
  assert.ok(
    !fs.existsSync(path.join(repoRoot, "skills/dev/steps/06-simplify.md")),
    "06-simplify step must be deleted"
  );
  // the command shim survives for muscle memory and routes to review
  const shim = read("commands/simplify.md");
  assert.match(shim, /absorbed into `pm:review`/);
  assert.match(shim, /skills\/review\/SKILL\.md/);
});

test("design critique step examples use the full sidecar schema", () => {
  const scope = read("skills/design-critique/steps/01-scope.md");
  const critique = read("skills/design-critique/steps/03-critique.md");
  for (const text of [scope, critique]) {
    assert.match(text, /"schema_version": 1/);
    assert.match(text, /"gates": \[/);
    assert.match(text, /"name": "design-critique"/);
  }
  assert.match(scope, /do not delete any existing gate rows/);
  assert.match(scope, /static HTML such as `public\/index\.html`/);
  assert.match(scope, /server-rendered templates such as `templates\/base\.html`/);
  assert.match(scope, /UI config files such as `tailwind\.config\.\*`/);
  assert.match(scope, /design-token\/theme data such as `tokens\/\*\.json`/);
  assert.match(scope, /non-UI config-only/);
  const devReview = read("skills/dev/steps/07-review.md");
  assert.match(devReview, /static HTML such as `public\/index\.html`/);
  assert.match(devReview, /server-rendered templates such as `templates\/base\.html`/);
  assert.match(devReview, /UI config such as `tailwind\.config\.\*`/);
  assert.match(devReview, /design-token\/theme data/);
  assert.match(
    critique,
    /preserve any existing `tdd`, `simplify`, `qa`, `review`, or `verification` rows/
  );
});

test("review skip requires or repairs the review sidecar", () => {
  const text = read("skills/review/SKILL.md");
  assert.match(text, /do not skip yet/);
  assert.match(text, /confirm it has `review: passed`/);
  assert.match(text, /repair the sidecar `review` row/);
  assert.match(text, /Review path: no reviewable source changes/);
  assert.match(text, /This is a pass attestation from inspecting the diff, not a skipped gate/);
  assert.match(text, /without deleting any existing gate rows/);
  assert.match(text, /"schema_version": 1/);
  assert.match(text, /"gates": \[/);
  assert.match(text, /--require review/);
});

test("review treats PM plugin Markdown runtime files as reviewable source", () => {
  const text = read("skills/review/SKILL.md");
  assert.match(text, /PM plugin exception/);
  assert.match(
    text,
    /`commands\/`, `skills\/`, `templates\/`, `hooks\/`, `scripts\/`, `tests\/`, `references\/`, `agents\/`, `\.githooks\/`, `\.claude-plugin\/`, `\.codex-plugin\/`, and `plugin\.config\.json`/
  );
  assert.match(text, /do not treat them as docs-only\/config-only/);
});

test("S-sized dev work receives a code scan instead of silently skipping review", () => {
  const intake = read("skills/dev/steps/02-intake.md");
  const review = read("skills/dev/steps/07-review.md");
  assert.match(intake, /\| Code scan \| Code scan \| Code scan \|/);
  assert.match(review, /Code scan \(XS\/S/);
  assert.doesNotMatch(review, /S tasks skip both code scan and full review/);
});

test("XS Express records every default gate before push", () => {
  const text = read("skills/dev/SKILL.md");
  const block = text.match(/## XS Express Path[\s\S]*?---/);
  assert.ok(block, "XS Express section must exist");
  assert.match(block[0], /size: "XS"/);
  assert.match(block[0], /Commit implementation/);
  assert.match(block[0], /do not push an empty branch/);
  assert.doesNotMatch(block[0], /Simplify skip row/);
  assert.match(block[0], /commit any fixes/);
  assert.match(block[0], /record `qa` as `passed`/);
  assert.match(block[0], /record `qa` as `skipped` with a concrete reason/);
  assert.match(block[0], /recertify earlier gate rows/);
  assert.match(block[0], /PM_PLUGIN_ROOT/);
  assert.match(block[0], /scripts\/dev-gate-check\.js/);
  assert.match(block[0], /--manifest .pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(block[0], /--commit "\$\(git rev-parse HEAD\)"/);
  assert.match(block[0], /--base origin\/\{DEFAULT_BRANCH\}/);
  assert.doesNotMatch(block[0], /--require tdd,design-critique,review,verification/);
});

test("single-task implementation brief records TDD after committing implementation", () => {
  const text = read("skills/dev/steps/05-implementation.md");
  const lifecycle = text.match(/Lifecycle:[\s\S]*?If blocked/);
  assert.ok(lifecycle, "single-task implementation lifecycle must exist");
  const suiteIndex = lifecycle[0].indexOf("Run the project test suite");
  const commitIndex = lifecycle[0].indexOf("Commit implementation and test changes");
  const tddIndex = lifecycle[0].indexOf("Record TDD evidence");
  assert.ok(suiteIndex > -1, "lifecycle must run tests");
  assert.ok(commitIndex > suiteIndex, "implementation commit must happen after tests");
  assert.ok(tddIndex > commitIndex, "TDD evidence must be tied to the committed HEAD");
  assert.match(lifecycle[0], /committed HEAD/);
});

test("multi-task implementation prompt uses branch slug for gate sidecar", () => {
  const text = read("skills/dev/steps/05-implementation.md");
  const prompt = text.match(/Build the per-issue prompt[\s\S]*?4\. \*\*Dispatch as subprocess/);
  assert.ok(prompt, "multi-task per-issue prompt must exist");
  assert.match(prompt[0], /\*\*Branch:\*\* feat\/\{task-slug\}/);
  assert.match(prompt[0], /\*\*RFC:\*\* \{pm_dir\}\/backlog\/rfcs\/\{parent_slug\}\.html/);
  assert.match(prompt[0], /\*\*Parent RFC slug:\*\* \{parent_slug\}/);
  assert.match(prompt[0], /\*\*Task\/session slug:\*\* \{task-slug\}/);
  assert.match(prompt[0], /\.pm\/dev-sessions\/\{task-slug\}\.gates\.json/);
  assert.match(prompt[0], /PM_PLUGIN_ROOT/);
  assert.match(prompt[0], /pre-push hook derives the required manifest from `feat\/\{task-slug\}`/);
  assert.doesNotMatch(prompt[0], /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
});

test("runtime shell snippets use PM_PLUGIN_ROOT with CLAUDE fallback", () => {
  const files = [
    "references/skill-runtime.md",
    "skills/dev/SKILL.md",
    "skills/dev/steps/05-implementation.md",
    "skills/dev/steps/07-review.md",
    "skills/dev/references/implementation-flow.md",
    "skills/dev/references/state-schema.md",
    "skills/design-critique/steps/03-critique.md",
    "skills/review/SKILL.md",
    "skills/ship/steps/04-push.md",
    "skills/ship/steps/07-merge-loop.md",
  ];
  for (const file of files) {
    const text = read(file);
    assert.match(text, /PM_PLUGIN_ROOT/, `${file} must mention PM_PLUGIN_ROOT`);
  }
  assert.match(read("references/skill-runtime.md"), /legacy alias/);
  assert.match(read("scripts/dispatch-issue.sh"), /export PM_PLUGIN_ROOT CLAUDE_PLUGIN_ROOT/);
});

test("dev review step blocks QA environment failures instead of skipping them", () => {
  const text = read("skills/dev/steps/07-review.md");
  assert.match(text, /Dev servers can't start, auth is unavailable/);
  assert.match(text, /record `qa: blocked`/);
  assert.match(text, /A broken QA environment is not a passing ship gate/);
  assert.match(text, /no `skipped` row for environment, server, DB, auth, or seed failures/);
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
  const reviewStep = read("skills/dev/steps/07-review.md");
  const qaReference = read("skills/dev/references/qa.md");
  assert.match(reviewStep, /skills\/dev\/references\/qa\.md/);
  assert.doesNotMatch(reviewStep, /Follow the pm:qa skill/);
  assert.match(qaReference, /does not install a standalone `pm:qa` command or skill/);
  assert.match(qaReference, /Manual reference mode/);
  assert.doesNotMatch(qaReference, /pm:qa --page/);
  assert.doesNotMatch(qaReference, /Invoked as pm:qa skill/);
});

test("dev review step defines final gate recertification before the full checker", () => {
  const text = read("skills/dev/steps/07-review.md");
  const recertIndex = text.indexOf("### Final gate recertification");
  const checkerIndex = text.indexOf("Before handing off to ship, run the shared checker");
  assert.ok(recertIndex > -1, "recertification section must exist");
  assert.ok(checkerIndex > recertIndex, "full checker must run after recertification");
  assert.match(text, /verified_commit/);
  assert.match(text, /verified_at/);
  assert.match(text, /rerun the gate instead of recertifying/);
});

test("implementation flow runs the gate checker before push and PR creation", () => {
  const text = read("skills/dev/references/implementation-flow.md");
  const block = text.match(/### Push and create PR[\s\S]*?```bash\n([\s\S]*?)```/);
  assert.ok(block, "implementation flow must include a push/create command block");
  assert.match(text, /final recertification pass/);
  const checkerIndex = block[1].indexOf("scripts/dev-gate-check.js");
  const pushIndex = block[1].indexOf("git push origin {BRANCH}");
  const prIndex = block[1].indexOf("gh pr create");
  assert.ok(checkerIndex > -1, "push block must run dev-gate-check");
  assert.match(block[1], /--base origin\/\{DEFAULT_BRANCH\}/);
  assert.ok(pushIndex > checkerIndex, "checker must appear before git push");
  assert.ok(prIndex > checkerIndex, "checker must appear before gh pr create");
});

test("ship push step requires the full default gate contract before git push", () => {
  const text = read("skills/ship/steps/04-push.md");
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /--base origin\/\{DEFAULT_BRANCH\}/);
  assert.doesNotMatch(text, /--require review,verification/);
  assert.match(text, /any required gate row is stale/);
  assert.match(text, /any required gate is missing/);
  assert.match(text, /verified_commit/);
});

test("ship merge loop rechecks the full sidecar against the remote branch tip", () => {
  const text = read("skills/ship/steps/07-merge-loop.md");
  assert.match(text, /\.pm\/dev-sessions\/\{slug\}\.gates\.json/);
  assert.match(text, /git rev-parse origin\/\{branch\}/);
  assert.match(text, /scripts\/dev-gate-check\.js/);
  assert.match(text, /effective attestation is `commit` when it equals `remote_tip`/);
  assert.match(text, /otherwise `verified_commit` when it equals `remote_tip`/);
  assert.match(text, /do not require every raw `commit` field to equal the remote tip/);
  assert.match(text, /--changed-files "\$changed_files"/);
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
  assert.match(text, /git show "\$local_oid:scripts\/dev-gate-check\.js" > "\$checker_tmp"/);
  assert.match(text, /if ! node "\$checker_tmp"/);
  assert.doesNotMatch(text, /if ! node scripts\/dev-gate-check\.js/);
  assert.doesNotMatch(text, /if ! node --test tests\/\*\.test\.js/);
  assert.match(text, /--base origin\/main/);
  assert.match(text, /unable to verify origin\/main/);
  assert.match(text, /unable to diff origin\/main\.\.\.\$local_oid/);
  assert.match(text, /push_ref_lines/);
  assert.match(text, /--commit "\$local_oid"/);
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
    fs.writeFileSync(path.join(dir, "scripts", "dev-gate-check.js"), "process.exit(42);\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime change").status, 0);
    const localOid = git("rev-parse", "HEAD").stdout.trim();

    fs.writeFileSync(path.join(dir, "scripts", "dev-gate-check.js"), "process.exit(0);\n");
    fs.mkdirSync(path.join(dir, ".pm", "dev-sessions"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".pm", "dev-sessions", "harden.gates.json"), "{}\n");

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
