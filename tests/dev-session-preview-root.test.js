"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const preview = require("../scripts/lib/app-preview");

const CLI = path.resolve(__dirname, "..", "scripts", "dev-session.js");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function initRepo(root) {
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Preview root test");
  git(root, "config", "user.email", "preview-root@example.invalid");
}

// A consumer app with a separate preview worktree, an artifact repository holding
// the RFC sidecar and its preview evidence, and an RFC whose design context binds
// that app preview.
function fixture(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-preview-root-")));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, "app");
  const sourceRoot = path.join(dir, "preview");
  const repoRoot = path.join(dir, "artifacts");
  initRepo(app);
  fs.writeFileSync(path.join(app, ".gitignore"), ".pm/\n");
  fs.writeFileSync(path.join(app, "app.js"), "console.log('incumbent');\n");
  git(app, "add", ".gitignore", "app.js");
  git(app, "commit", "-qm", "existing app");
  const base = git(app, "rev-parse", "HEAD");
  git(app, "worktree", "add", "-q", "--detach", sourceRoot, base);
  git(app, "checkout", "-q", "-b", "feat/preview-root");
  fs.writeFileSync(path.join(sourceRoot, "app.js"), "console.log('reviewed preview');\n");
  git(sourceRoot, "add", "app.js");
  git(sourceRoot, "commit", "-qm", "reviewed preview");
  fs.mkdirSync(path.join(sourceRoot, ".pm/fixtures"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, ".pm/fixtures/rows.json"), JSON.stringify({ rows: 1 }));

  initRepo(repoRoot);
  fs.mkdirSync(path.join(repoRoot, "evidence"));
  fs.writeFileSync(path.join(repoRoot, "evidence/journey.json"), JSON.stringify({ ok: true }));
  const config = {
    repository: "example-app",
    base_commit: base,
    reviewed_paths: ["app.js"],
    fixture_directory: ".pm/fixtures",
    launch: {
      executable: "node",
      args: ["app.js"],
      cwd: ".",
      url: "http://127.0.0.1:4312",
      env: { PM_PREVIEW_FIXTURES: ".pm/fixtures" },
    },
    journeys: [{ id: "main", purpose: "Main flow", required_states: ["entry", "done"] }],
  };
  const roots = { sourceRoot, repoRoot };
  const candidate = preview.prepareAppPreview(config, roots);
  const observation = {
    capture_id: candidate.capture.id,
    input_sha256: candidate.capture.input_sha256,
    recorded_at: new Date().toISOString(),
    observer: "test",
    backend_certified: false,
    journeys: [
      {
        id: "main",
        steps: ["Open", "Finish"],
        states: ["entry", "done"].map((id) => ({ id, evidence: "evidence/journey.json" })),
      },
    ],
  };
  fs.writeFileSync(path.join(repoRoot, "evidence/receipt.json"), JSON.stringify(observation));
  const identity = preview.completeAppPreview(
    candidate,
    { receipt: "evidence/receipt.json", ...observation },
    roots
  );
  const designContext = {
    ui_impact: true,
    design_requirements: ["Keep the reviewed flow"],
    prototype: null,
    app_preview: identity,
    critical_states: ["entry", "done"],
    experience_invariants: ["The flow finishes"],
    visual_invariants: ["Navigation stays visible"],
  };
  const issue = (num, depends_on, owns) => ({
    num,
    title: `Issue ${num}`,
    size: "M",
    depends_on,
    owns,
    acceptance_criteria: [`AC-${num}`],
    approach: `Implement issue ${num}`,
    verification_commands: ["node --test"],
    test_hooks: [`AC-${num}`],
  });
  const sidecarPath = path.join(repoRoot, "rfc.json");
  fs.writeFileSync(
    sidecarPath,
    JSON.stringify({
      schema_version: 3,
      slug: "preview-root",
      title: "Approved RFC with an app preview",
      size: "L",
      design_context: designContext,
      issues: [issue(1, [], ["app.js"])],
      test_strategy: {
        test_levels: "Unit",
        new_infrastructure: "None",
        regression_surface: "Dev record",
        verification_commands: "node --test",
        open_questions: "None",
      },
    })
  );
  git(repoRoot, "add", ".");
  git(repoRoot, "commit", "-qm", "artifacts");
  return { app, sourceRoot, sidecarPath };
}

function run(cwd, args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(cwd, ".test-config"),
      PM_EXECUTION_POLICY_FILE: "",
    },
  });
}

test("an RFC session bound to an app preview records phases and runs mutating commands", (t) => {
  const f = fixture(t);
  const init = run(f.app, ["init", "--slug", "preview-root", "--source-dir", f.app, "--json"]);
  assert.equal(init.status, 0, init.stderr);
  const sessionPath = JSON.parse(init.stdout).session_path;
  const factsPath = path.join(f.app, ".pm", "facts.json");
  fs.writeFileSync(
    factsPath,
    JSON.stringify({
      reference: "PM-PREVIEW",
      kind: "proposal",
      size: "L",
      risk: {},
      acceptance_criteria: ["AC-1"],
      preview_source_root: f.sourceRoot,
    })
  );
  const routed = run(f.app, [
    "route",
    "--session",
    sessionPath,
    "--facts",
    factsPath,
    "--rfc-sidecar",
    f.sidecarPath,
    "--json",
  ]);
  assert.equal(routed.status, 0, routed.stderr);
  assert.equal(run(f.app, ["next", "--session", sessionPath]).status, 0);

  const session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  const resultPath = path.join(f.app, ".pm", "intake-result.json");
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      schema_version: 1,
      run_id: session.run_id,
      phase: "intake",
      attempt: 1,
      status: "passed",
      summary: "Preview-bound intake",
      commit: null,
      files_changed: [],
      evidence: [{ kind: "intake", command: "fixture", exit_code: 0, artifact: null }],
      blocker: null,
      runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    })
  );
  const recorded = run(f.app, ["record", "--session", sessionPath, "--result", resultPath]);
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(JSON.parse(fs.readFileSync(sessionPath, "utf8")).phase, "workspace");

  const workspace = run(f.app, ["workspace", "--session", sessionPath, "--worktree", f.app]);
  assert.equal(workspace.status, 0, workspace.stderr);

  // Preview drift still fails closed on the same paths.
  fs.appendFileSync(path.join(f.sourceRoot, ".pm/fixtures/rows.json"), "drift");
  const drifted = run(f.app, ["workspace", "--session", sessionPath, "--worktree", f.app]);
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.stderr, /fixture/);
});
