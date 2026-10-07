"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { validateDesignContext } = require("../scripts/lib/dev-work-units");
const { buildWorkerPrompt } = require("../scripts/dev-prompt");
let preview = {};
try {
  preview = require("../scripts/lib/app-preview");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-preview-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const main = path.join(dir, "app");
  const sourceRoot = path.join(dir, "preview");
  const repoRoot = path.join(dir, "artifacts");
  fs.mkdirSync(main);
  fs.mkdirSync(repoRoot);
  git(main, "init", "-q");
  git(main, "config", "user.name", "Preview test");
  git(main, "config", "user.email", "preview@example.invalid");
  fs.writeFileSync(path.join(main, ".gitignore"), ".pm/\n");
  fs.writeFileSync(path.join(main, "app.js"), "console.log('incumbent navigation');\n");
  git(main, "add", ".gitignore", "app.js");
  git(main, "commit", "-qm", "existing app");
  const base = git(main, "rev-parse", "HEAD");
  git(main, "worktree", "add", "--detach", sourceRoot, base);
  fs.writeFileSync(
    path.join(sourceRoot, "app.js"),
    "console.log('save, leave, resume with shared UI');\n"
  );
  git(sourceRoot, "add", "app.js");
  git(sourceRoot, "commit", "-qm", "reviewable UI");
  fs.mkdirSync(path.join(sourceRoot, ".pm/fixtures"), { recursive: true });
  fs.writeFileSync(
    path.join(sourceRoot, ".pm/fixtures/jobs.json"),
    JSON.stringify({ jobs: ["long realistic job"] })
  );
  fs.mkdirSync(path.join(repoRoot, "evidence"));
  fs.writeFileSync(
    path.join(repoRoot, "evidence/journey.json"),
    JSON.stringify({ saved: true, returned: true })
  );
  const config = {
    repository: "example-app",
    base_commit: base,
    reviewed_paths: ["app.js"],
    fixture_directory: ".pm/fixtures",
    launch: {
      executable: "node",
      args: ["app.js"],
      cwd: ".",
      url: "http://127.0.0.1:4311",
      env: { PM_PREVIEW_FIXTURES: ".pm/fixtures" },
    },
    journeys: [
      {
        id: "save-return",
        purpose: "Normal entry, save, leave/return and long content",
        required_states: ["entry", "saved", "returned", "long-content"],
      },
    ],
  };
  return { main, sourceRoot, repoRoot, config };
}

function capture(candidate, f) {
  const observation = {
    capture_id: candidate.capture.id,
    input_sha256: candidate.capture.input_sha256,
    recorded_at: new Date().toISOString(),
    observer: "browser pilot",
    backend_certified: false,
    journeys: [
      {
        id: "save-return",
        steps: [
          "Enter through incumbent navigation",
          "Save changes",
          "Leave and return",
          "Open long content",
        ],
        states: ["entry", "saved", "returned", "long-content"].map((id) => ({
          id,
          evidence: "evidence/journey.json",
        })),
      },
    ],
  };
  fs.writeFileSync(path.join(f.repoRoot, "evidence/receipt.json"), JSON.stringify(observation));
  return { receipt: "evidence/receipt.json", ...observation };
}

test("producer binds real isolated app source, separate fixtures and fresh executable journey handoff", (t) => {
  const f = fixture(t);
  assert.equal(
    typeof preview.prepareAppPreview,
    "function",
    "runnable in-app preview producer is missing"
  );
  const candidate = preview.prepareAppPreview(f.config, f);
  const identity = preview.completeAppPreview(candidate, capture(candidate, f), f);
  assert.equal(identity.mode, "in-app");
  assert.equal(identity.source.base_commit, f.config.base_commit);
  assert.equal(identity.source.head_commit, git(f.sourceRoot, "rev-parse", "HEAD"));
  assert.deepEqual(
    identity.reviewed_starting_code.map((entry) => entry.path),
    ["app.js"]
  );
  assert.equal(identity.observations.backend_certified, false);
  assert.equal(preview.verifyAppPreviewIdentity(JSON.parse(JSON.stringify(identity)), f), true);
  const context = {
    ui_impact: true,
    design_requirements: ["Resume saved work"],
    prototype: null,
    app_preview: identity,
    critical_states: ["entry", "saved"],
    experience_invariants: ["Manual save persists before leaving"],
    visual_invariants: ["Incumbent navigation remains visible"],
  };
  assert.equal(
    validateDesignContext(context, "design_context", { ...f, previewSourceRoot: f.sourceRoot }),
    context
  );
  assert.throws(
    () => validateDesignContext(context, "design_context", { repoRoot: f.repoRoot }),
    /source root|source repository/
  );
  const prompt = buildWorkerPrompt({
    phase: "implementation",
    outcome: "Integrate the accepted UI",
    scope: ["Use accepted starting code"],
    exclusions: ["No fixture promotion"],
    inputs: ["Explicit source root supplied in execution context"],
    context: "Isolated Dev worktree at exact source base",
    phaseContract: "Implement accepted behavior",
    acceptanceCriteria: ["Preserve manual save and navigation"],
    repositoryRules: ["Keep mocks separate"],
    authority: { localWrites: true, commit: true, merge: false },
    evidence: ["Production integration tests"],
    stopConditions: ["Material behavior change"],
    resultSchema: { status: "completed|blocked|failed" },
    design_context: context,
  });
  const encoded = prompt.prompt.match(/Approved design context:\n```json\n([\s\S]*?)\n```/);
  assert.deepEqual(JSON.parse(encoded[1]).app_preview, identity);
  assert.match(prompt.prompt, /app-preview\.js adopt/);
  assert.match(prompt.prompt, /excludes the separate fixtures\.directory/);
  assert.match(prompt.prompt, /do not certify backend correctness or product judgment/);
});

test("handoff rejects drift of tracked source, fixtures, evidence or launch recipe", (t) => {
  const f = fixture(t);
  const candidate = preview.prepareAppPreview(f.config, f);
  const identity = preview.completeAppPreview(candidate, capture(candidate, f), f);
  for (const [root, relative, message] of [
    [f.sourceRoot, "app.js", /clean|source/],
    [f.sourceRoot, ".pm/fixtures/jobs.json", /fixture/],
    [f.repoRoot, "evidence/journey.json", /evidence/],
  ]) {
    const file = path.join(root, relative);
    const original = fs.readFileSync(file);
    fs.appendFileSync(file, "drift");
    assert.throws(() => preview.verifyAppPreviewIdentity(identity, f), message);
    fs.writeFileSync(file, original);
  }
  const changed = structuredClone(identity);
  changed.launch.args.push("--different");
  assert.throws(() => preview.verifyAppPreviewIdentity(changed, f), /identity|hash/);
});

test("new captures reject replay, stale observations, missing states and backend overclaims", (t) => {
  const f = fixture(t);
  const candidate = preview.prepareAppPreview(f.config, f);
  const another = preview.prepareAppPreview(f.config, f);
  assert.throws(() => preview.completeAppPreview(another, capture(candidate, f), f), /capture/);
  const stale = capture(candidate, f);
  stale.recorded_at = "2020-01-01T00:00:00Z";
  assert.throws(() => preview.completeAppPreview(candidate, stale, f), /stale|predate/);
  const missing = capture(candidate, f);
  missing.journeys[0].states.pop();
  assert.throws(() => preview.completeAppPreview(candidate, missing, f), /state/);
  const overclaim = capture(candidate, f);
  overclaim.backend_certified = true;
  assert.throws(() => preview.completeAppPreview(candidate, overclaim, f), /backend/);
});

test("producer denies main checkout, missing reviewed change coverage, unsafe paths and shell launch", (t) => {
  const f = fixture(t);
  assert.throws(
    () => preview.prepareAppPreview(f.config, { ...f, sourceRoot: f.main }),
    /isolated/
  );
  for (const config of [
    { ...f.config, reviewed_paths: ["missing.js"] },
    { ...f.config, reviewed_paths: ["../app.js"] },
    { ...f.config, fixture_directory: "/tmp/fixtures" },
    { ...f.config, launch: { ...f.config.launch, executable: "sh", args: ["-c", "echo unsafe"] } },
    { ...f.config, launch: { ...f.config.launch, url: "https://example.com" } },
  ])
    assert.throws(
      () => preview.prepareAppPreview(config, f),
      /path|reviewed|fixture|launch|loopback/
    );
  fs.symlinkSync(
    path.join(f.sourceRoot, "app.js"),
    path.join(f.sourceRoot, ".pm/fixtures/link.js")
  );
  assert.throws(() => preview.prepareAppPreview(f.config, f), /symbolic/);
});

test("inert legacy design context remains supported and cannot masquerade as app preview", () => {
  const legacy = {
    design_requirements: ["Read it"],
    prototype: null,
    critical_states: ["ready"],
    visual_invariants: ["clear hierarchy"],
  };
  assert.equal(validateDesignContext(legacy), legacy);
  assert.throws(
    () => validateDesignContext({ ...legacy, app_preview: { mode: "in-app" } }),
    /app_preview/
  );
});

test("CLI produces and verifies exact identity and adopts only reviewed UI code into a clean Dev worktree", (t) => {
  const f = fixture(t);
  const configPath = path.join(f.repoRoot, "config.json");
  const candidatePath = path.join(f.repoRoot, "candidate.json");
  const identityPath = path.join(f.repoRoot, "identity.json");
  const cli = path.join(__dirname, "../scripts/app-preview.js");
  fs.writeFileSync(configPath, JSON.stringify(f.config));
  const invoke = (...args) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [cli, ...args, "--repo-root", f.repoRoot, "--source-root", f.sourceRoot],
        { encoding: "utf8", stdio: "pipe" }
      )
    );
  const candidate = invoke("prepare", "--config", configPath);
  fs.writeFileSync(candidatePath, JSON.stringify(candidate));
  const observations = capture(candidate, f);
  const observationsPath = path.join(f.repoRoot, "observations.json");
  fs.writeFileSync(observationsPath, JSON.stringify(observations));
  const identity = invoke(
    "complete",
    "--candidate",
    candidatePath,
    "--observations",
    observationsPath
  );
  fs.writeFileSync(identityPath, JSON.stringify(identity));
  assert.deepEqual(invoke("verify", "--identity", identityPath), {
    valid: true,
    sha256: identity.sha256,
    backend_certified: false,
  });
  const targetRoot = path.join(path.dirname(f.main), "dev");
  git(f.main, "worktree", "add", "--detach", targetRoot, f.config.base_commit);
  const adopted = invoke("adopt", "--identity", identityPath, "--target-root", targetRoot);
  assert.deepEqual(adopted.reviewed_paths, ["app.js"]);
  assert.equal(
    fs.readFileSync(path.join(targetRoot, "app.js"), "utf8"),
    fs.readFileSync(path.join(f.sourceRoot, "app.js"), "utf8")
  );
  assert.equal(fs.existsSync(path.join(targetRoot, ".pm/fixtures")), false);
  assert.equal(git(targetRoot, "diff", "--cached", "--name-only"), "app.js");
  assert.throws(() => preview.adoptAppPreview(identity, { ...f, targetRoot }), /clean/);
});

test("source drift cannot be hidden by index flags or substituted committed source", (t) => {
  const f = fixture(t);
  const candidate = preview.prepareAppPreview(f.config, f);
  const identity = preview.completeAppPreview(candidate, capture(candidate, f), f);
  git(f.sourceRoot, "update-index", "--assume-unchanged", "app.js");
  assert.throws(() => preview.verifyAppPreviewIdentity(identity, f), /index|hide/);
  git(f.sourceRoot, "update-index", "--no-assume-unchanged", "app.js");
  fs.appendFileSync(path.join(f.sourceRoot, "app.js"), "// another decision\n");
  git(f.sourceRoot, "add", "app.js");
  git(f.sourceRoot, "commit", "-qm", "source drift");
  assert.throws(() => preview.verifyAppPreviewIdentity(identity, f), /source.*drift/);
});

test("semantic receipt mismatch and linked fixture/evidence paths cannot satisfy the handoff", (t) => {
  const f = fixture(t);
  const candidate = preview.prepareAppPreview(f.config, f);
  const observations = capture(candidate, f);
  observations.journeys[0].steps = ["Claim different behavior"];
  assert.throws(() => preview.completeAppPreview(candidate, observations, f), /receipt/);
  const valid = capture(candidate, f);
  fs.unlinkSync(path.join(f.repoRoot, "evidence/journey.json"));
  fs.symlinkSync(path.join(f.sourceRoot, "app.js"), path.join(f.repoRoot, "evidence/journey.json"));
  assert.throws(() => preview.completeAppPreview(candidate, valid, f), /safely|symbolic/);
});
