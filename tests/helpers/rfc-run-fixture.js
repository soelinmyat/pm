"use strict";

// Real RFC runs for tests: every approval, audit, and archive here is produced
// by the rfc-session CLI and schema, never hand-written.
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  applyContext,
  approveSession,
  artifactFingerprint,
  recordResult,
} = require("../../scripts/lib/rfc-session-schema");
const { writeSession } = require("../../scripts/rfc-session");

const CLI = path.resolve(__dirname, "..", "..", "scripts", "rfc-session.js");

function currentDesignContext() {
  return {
    design_requirements: ["Keep approval and archive states explicit."],
    ui_impact: false,
    prototype: null,
    critical_states: ["draft", "approved", "archived", "error"],
    experience_invariants: ["Every state exposes its next action."],
    visual_invariants: [],
  };
}

function amendArtifact(repo, slug, prior, mutate) {
  const sidecar = JSON.parse(fs.readFileSync(prior.json_path, "utf8"));
  mutate(sidecar);
  fs.writeFileSync(prior.json_path, `${JSON.stringify(sidecar)}\n`);
  return writeArtifact(repo, slug, "draft", prior);
}

function passingVerdicts(artifact) {
  return ["architecture-risk", "test-strategy", "maintainability"].map((lens) => ({
    lens,
    artifact_hash: artifactFingerprint(artifact),
    verdict: "pass",
    blocking: [],
    advisory: [],
  }));
}

function recordFile(repo, session, result) {
  const resultPath = path.join(
    repo.root,
    `${session.run_id}-${result.phase}-${crypto.randomBytes(4).toString("hex")}.json`
  );
  fs.writeFileSync(resultPath, JSON.stringify(result));
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "rfc-sessions",
    session.slug,
    "session.json"
  );
  return repo.run(["record", "--session", sessionPath, "--result", resultPath, "--json"]);
}

function snapshotDir(dir) {
  const snapshot = {};
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, entry);
    if (fs.statSync(file).isFile()) snapshot[entry] = fs.readFileSync(file, "utf8");
  }
  return snapshot;
}

function prepareApprovedHandoff(repo, slug, options = {}) {
  repo.own(slug);
  const initialized = repo.run(["init", "--slug", slug, "--source-dir", repo.root, "--json"]);
  assert.equal(initialized.status, 0, initialized.stderr);
  const payload = JSON.parse(initialized.stdout);
  let session = applyContext(payload.session, {
    source_kind: "proposal",
    proposal_path: path.join(repo.root, "proposal.md"),
    size: "M",
    acceptance_criteria: ["Archive exact approval"],
    design_context: currentDesignContext(),
    artifact_repo_root: repo.root,
  });
  session = recordResult(session, phaseResult(session));
  let artifact = writeArtifact(repo, slug, "draft", null, options);
  session = recordResult(
    session,
    phaseResult(session, { artifact, evidence: [resultEvidence("artifact")] })
  );
  session = recordResult(
    session,
    phaseResult(session, {
      artifact,
      evidence: [resultEvidence("review")],
      reviewer_verdicts: ["architecture-risk", "test-strategy", "maintainability"].map((lens) => ({
        lens,
        artifact_hash: artifactFingerprint(artifact),
        verdict: "pass",
        blocking: [],
        advisory: [],
      })),
    })
  );
  if (options.beforeApprove) options.beforeApprove(session, artifact);
  session = approveSession(session, { approvedBy: "Test Owner" });
  artifact = writeArtifact(repo, slug, "approved", artifact);
  writeSession(payload.session_path, session);
  const artifactIdentityPath = path.join(repo.root, `${session.run_id}-artifact.json`);
  fs.writeFileSync(artifactIdentityPath, JSON.stringify(artifact));
  const audited = repo.run([
    "approval-audit",
    "--session",
    payload.session_path,
    "--artifact",
    artifactIdentityPath,
    "--json",
  ]);
  assert.equal(audited.status, 0, audited.stderr);
  const approvalPath = artifact.json_path.replace(/\.json$/i, ".approval.json");
  assert.equal(JSON.parse(audited.stdout).approval_path, approvalPath);
  assert.equal(fs.statSync(approvalPath).mode & 0o777, 0o600);
  execFileSync("git", ["add", path.relative(repo.root, approvalPath)], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", `approve ${slug}`], { cwd: repo.root });
  artifact = { ...artifact, commit: repo.head() };
  const result = phaseResult(session, {
    artifact,
    evidence: [
      resultEvidence("handoff"),
      resultEvidence("lifecycle"),
      resultEvidence("approval-audit", approvalPath),
    ],
  });
  const resultPath = path.join(repo.root, `${session.run_id}-handoff.json`);
  fs.writeFileSync(resultPath, JSON.stringify(result));
  return { runId: session.run_id, sessionPath: payload.session_path, resultPath };
}

function phaseResult(session, overrides = {}) {
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    status: "passed",
    summary: `Completed ${session.phase}`,
    artifact: null,
    evidence: [],
    reviewer_verdicts: [],
    blocker: null,
    runtime: { provider: "inline", model: "test", reasoning: "high", session_id: null },
    ...overrides,
  };
}

function resultEvidence(kind, artifact = null) {
  return { kind, command: "node --test", exit_code: 0, artifact };
}

function defaultIssues() {
  return [
    {
      num: 1,
      title: "Archive approval",
      size: "M",
      depends_on: [],
      owns: ["README.md"],
      acceptance_criteria: ["Approval history is immutable"],
      approach: "Archive every run by run ID.",
      verification_commands: ["node --test"],
      test_hooks: ["Approval history"],
    },
  ];
}

function writeArtifact(repo, slug, status, prior = null, options = {}) {
  const jsonPath = prior?.json_path || path.join(repo.root, `${slug}.json`);
  const htmlPath = prior?.html_path || path.join(repo.root, `${slug}.html`);
  if (!prior) {
    const sidecar = {
      schema_version: 3,
      slug,
      title: "Immutable RFC",
      size: "M",
      design_context: currentDesignContext(),
      issues: options.issues || defaultIssues(),
      test_strategy: {
        test_levels: "CLI integration",
        new_infrastructure: "None",
        regression_surface: "RFC sessions",
        verification_commands: "node --test",
        open_questions: "None",
      },
    };
    fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar)}\n`);
  }
  const sidecarHash = `sha256:${crypto
    .createHash("sha256")
    .update(fs.readFileSync(jsonPath))
    .digest("hex")}`;
  fs.writeFileSync(
    htmlPath,
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '  <meta charset="utf-8">',
      '  <meta name="viewport" content="width=device-width, initial-scale=1">',
      "  <title>Immutable RFC</title>",
      `  <script id="pm-artifact" type="application/json">{"schema_version":1,"id":"rfc:${slug}","kind":"rfc","slug":"${slug}","lifecycle":"${status}","title":"Immutable RFC","generated_at":"2026-07-12T00:00:00Z","generator":{"name":"pm:rfc","version":"test"},"source":{"path":"proposal.md","sha256":null},"evidence":[]}</script>`,
      "  <style>:focus-visible{outline:2px solid currentColor}@media(max-width:700px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{*{overflow:visible!important}}</style>",
      "</head>",
      "<body>",
      `  <script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      '  <a class="skip-link" href="#content">Skip to content</a>',
      '  <nav aria-label="RFC sections"><a href="#brief">Brief</a></nav>',
      `  <main id="content" data-sidecar-hash="${sidecarHash}">`,
      "  <h1>Immutable RFC</h1>",
      `  <p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      '  <section id="brief"></section>',
      '  <section id="execution-contract"></section>',
      '  <section id="appendix"></section>',
      '  <section id="test-strategy" class="test-strategy"><div class="test-strategy-block"></div></section>',
      ...JSON.parse(fs.readFileSync(jsonPath, "utf8")).issues.map(
        (item) =>
          `  <article class="issue-detail"><span class="issue-detail-num">${item.num}</span><span class="issue-detail-title">${item.title}</span><span class="issue-detail-size">${item.size}</span><p><strong>Owns:</strong> ${item.owns.map((owned) => `<code>${owned}</code>`).join(", ")}</p>${item.test_hooks.map((hook) => `<span class="hooks-badge">${hook}</span>`).join("")}</article>`
      ),
      "  </main>",
      "</body>",
      "</html>",
      "",
    ].join("\n")
  );
  execFileSync(
    "git",
    ["add", path.relative(repo.root, jsonPath), path.relative(repo.root, htmlPath)],
    {
      cwd: repo.root,
    }
  );
  execFileSync("git", ["commit", "-qm", `${status} ${slug}`], { cwd: repo.root });
  return {
    html_path: htmlPath,
    json_path: jsonPath,
    html_hash: `sha256:${crypto.createHash("sha256").update(fs.readFileSync(htmlPath)).digest("hex")}`,
    sidecar_hash: sidecarHash,
    repo_root: repo.root,
    commit: repo.head(),
  };
}

// Runs an approved RFC through handoff and returns its completed archive path.
function completeApprovedRun(repo, slug, options = {}) {
  const handoff = prepareApprovedHandoff(repo, slug, options);
  const recorded = repo.run([
    "record",
    "--session",
    handoff.sessionPath,
    "--result",
    handoff.resultPath,
    "--json",
  ]);
  assert.equal(recorded.status, 0, recorded.stderr);
  return { ...handoff, archivePath: JSON.parse(recorded.stdout).session_path };
}

// Amends a completed run end to end: amend, owns-only edit, review, hash-confirmed
// approval, v2 audit, commit, and handoff. Returns the new archive path.
function completeAmendment(repo, completedPath, { issues, reason, mutate }) {
  const archived = JSON.parse(fs.readFileSync(completedPath, "utf8"));
  const amended = repo.run([
    "amend",
    "--completed",
    completedPath,
    "--source-dir",
    repo.root,
    "--issues",
    issues,
    "--reason",
    reason,
    "--json",
  ]);
  assert.equal(amended.status, 0, amended.stderr);
  const { session_path: sessionPath, session } = JSON.parse(amended.stdout);
  const artifact = amendArtifact(repo, archived.slug, archived.artifact, mutate);
  const reviewed = recordFile(
    repo,
    session,
    phaseResult(session, {
      artifact,
      evidence: [resultEvidence("review")],
      reviewer_verdicts: passingVerdicts(artifact),
    })
  );
  assert.equal(reviewed.status, 0, reviewed.stderr);
  const approved = repo.run([
    "approve",
    "--session",
    sessionPath,
    "--approved-by",
    "Test Owner",
    "--approved-sidecar-sha256",
    artifact.sidecar_hash,
    "--json",
  ]);
  assert.equal(approved.status, 0, approved.stderr);
  const handoffSession = JSON.parse(approved.stdout).session;
  let approvedArtifact = writeArtifact(repo, archived.slug, "approved", artifact);
  const identityPath = path.join(repo.root, `${session.run_id}-artifact.json`);
  fs.writeFileSync(identityPath, JSON.stringify(approvedArtifact));
  const audited = repo.run([
    "approval-audit",
    "--session",
    sessionPath,
    "--artifact",
    identityPath,
    "--json",
  ]);
  assert.equal(audited.status, 0, audited.stderr);
  const approvalPath = JSON.parse(audited.stdout).approval_path;
  execFileSync("git", ["add", path.relative(repo.root, approvalPath)], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", `approve amendment ${session.run_id}`], {
    cwd: repo.root,
  });
  approvedArtifact = { ...approvedArtifact, commit: repo.head() };
  const handoff = recordFile(
    repo,
    handoffSession,
    phaseResult(handoffSession, {
      artifact: approvedArtifact,
      evidence: [
        resultEvidence("handoff"),
        resultEvidence("lifecycle"),
        resultEvidence("approval-audit", approvalPath),
      ],
    })
  );
  assert.equal(handoff.status, 0, handoff.stderr);
  return {
    runId: session.run_id,
    archivePath: JSON.parse(handoff.stdout).session_path,
    sidecarHash: approvedArtifact.sidecar_hash,
  };
}

function makeRfcRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-cli-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  fs.writeFileSync(path.join(root, "proposal.md"), "proposal\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "fixture"], { cwd: root });
  return {
    root,
    own(slug) {
      markOwnedRfcRoot(root, slug);
    },
    head() {
      return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    },
    run(args, env = {}) {
      return spawnSync(process.execPath, [CLI, ...args], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, ...env },
      });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function markOwnedRfcRoot(root, slug) {
  const branch = `codex/${slug}-rfc`;
  if (
    execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim() !==
    branch
  )
    execFileSync("git", ["branch", "-M", branch], { cwd: root });
  const remotes = execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  if (!remotes.includes("origin")) {
    execFileSync("git", ["remote", "add", "origin", root], { cwd: root });
  } else {
    execFileSync("git", ["remote", "set-url", "origin", root], { cwd: root });
  }
  const base = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const urlHash = crypto.createHash("sha256").update(root).digest("hex");
  for (const [key, value] of [
    [`branch.${branch}.pmArtifactBase`, base],
    [`branch.${branch}.pmArtifactKind`, "rfc"],
    [`branch.${branch}.pmArtifactRemote`, "origin"],
    [`branch.${branch}.pmArtifactDefaultBranch`, "main"],
    [`branch.${branch}.pmArtifactRemoteUrlSha256`, urlHash],
  ])
    execFileSync("git", ["config", key, value], { cwd: root });
}

module.exports = {
  amendArtifact,
  completeAmendment,
  completeApprovedRun,
  currentDesignContext,
  makeRfcRepo,
  markOwnedRfcRoot,
  passingVerdicts,
  phaseResult,
  prepareApprovedHandoff,
  recordFile,
  resultEvidence,
  snapshotDir,
  writeArtifact,
};
