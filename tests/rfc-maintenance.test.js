"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const {
  amendArtifact,
  completeApprovedRun,
  completeAmendment,
  makeRfcRepo,
  passingVerdicts,
  phaseResult,
  recordFile,
  resultEvidence,
  twoIssues,
} = require("./helpers/rfc-run-fixture");

test("the maintenance renderer mirrors real corrected sidecar details and protects unrelated HTML edits", () => {
  const repo = makeRfcRepo();
  try {
    const original = completeApprovedRun(repo, "render-maintenance", { issues: twoIssues() });
    const prior = JSON.parse(fs.readFileSync(original.archivePath));
    const opened = repo.run([
      "amend",
      "--completed",
      original.archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "2",
      "--reason",
      "Correct the actual implementation boundary",
      "--json",
    ]);
    assert.equal(opened.status, 0, opened.stderr);
    const { session_path: sessionPath, session } = JSON.parse(opened.stdout);
    const originalHtml = fs.readFileSync(prior.artifact.html_path, "utf8");
    const sidecar = JSON.parse(fs.readFileSync(prior.artifact.json_path));
    sidecar.issues[1].approach =
      "Keep the existing outcomes; extract <helper> & preserve access checks.";
    fs.writeFileSync(prior.artifact.json_path, JSON.stringify(sidecar));
    const render = () => repo.run(["render-maintenance", "--session", sessionPath, "--json"]);
    fs.writeFileSync(
      prior.artifact.html_path,
      originalHtml.replace("Immutable RFC", "Changed product intent")
    );
    const refused = render();
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /unrelated edits/);
    fs.writeFileSync(prior.artifact.html_path, originalHtml);
    const rendered = render();
    assert.equal(rendered.status, 0, rendered.stderr);
    const html = fs.readFileSync(prior.artifact.html_path, "utf8");
    assert.match(html, /extract &lt;helper&gt; &amp; preserve access checks/);
    assert.equal(render().status, 0);
    assert.equal(fs.readFileSync(prior.artifact.html_path, "utf8"), html);
    execFileSync("git", ["add", "."], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "current maintained pair"], { cwd: repo.root });
    // Review corrections must re-render from the previous committed pair.
    sidecar.issues[1].verification_commands = ["node --test tests/two.test.js"];
    fs.writeFileSync(prior.artifact.json_path, JSON.stringify(sidecar));
    const corrected = render();
    assert.equal(corrected.status, 0, corrected.stderr);
    assert.match(fs.readFileSync(prior.artifact.html_path, "utf8"), /tests\/two\.test\.js/);
    execFileSync("git", ["add", "."], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "review correction"], { cwd: repo.root });
    const crypto = require("node:crypto");
    const hash = (p) =>
      `sha256:${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}`;
    const artifact = {
      ...prior.artifact,
      commit: repo.head(),
      html_hash: hash(prior.artifact.html_path),
      sidecar_hash: hash(prior.artifact.json_path),
    };
    const reviewed = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: passingVerdicts(artifact, true),
      })
    );
    assert.equal(reviewed.status, 0, reviewed.stderr);
    assert.equal(JSON.parse(reviewed.stdout).session.phase, "handoff");
  } finally {
    repo.cleanup();
  }
});

test("routine RFC ownership maintenance carries prior approval through review without a new human decision", () => {
  const repo = makeRfcRepo();
  try {
    const original = completeApprovedRun(repo, "maintenance", { issues: twoIssues() });
    const priorBytes = fs.readFileSync(original.archivePath);
    const prior = JSON.parse(priorBytes);
    const opened = repo.run([
      "amend",
      "--completed",
      original.archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "2",
      "--reason",
      "The same issue also updates its existing README contract",
      "--json",
    ]);
    assert.equal(opened.status, 0, opened.stderr);
    const { session } = JSON.parse(opened.stdout);
    const artifact = amendArtifact(repo, "maintenance", prior.artifact, (s) =>
      s.issues[1].owns.push("README.md")
    );
    const reviewed = recordFile(
      repo,
      session,
      phaseResult(session, {
        artifact,
        evidence: [resultEvidence("review")],
        reviewer_verdicts: passingVerdicts(artifact, true),
      })
    );
    assert.equal(reviewed.status, 0, reviewed.stderr);
    const next = JSON.parse(reviewed.stdout).session;
    assert.equal(next.phase, "handoff");
    assert.equal(next.approval.status, "maintained");
    assert.equal(next.approval.approved_by, prior.approval.approved_by);
    assert.equal(next.approval.approved_at, prior.approval.approved_at);
    assert.deepEqual(fs.readFileSync(original.archivePath), priorBytes);
  } finally {
    repo.cleanup();
  }
});

test("technical maintenance completes a real handoff and exact audit lineage without approve", async (t) => {
  const repo = makeRfcRepo();
  try {
    const original = completeApprovedRun(repo, "technical-maintenance", { issues: twoIssues() });
    const priorBytes = fs.readFileSync(original.archivePath);
    const loopRepo = {
      ...repo,
      run: (args, env = {}) => repo.run(args, { ...env, PM_LOOP_WORKER: "1" }),
    };
    const amended = completeAmendment(loopRepo, original.archivePath, {
      kind: "maintenance",
      issues: "2",
      reason: "Correct the actual test command and extraction boundary",
      mutate: (s) => {
        s.issues[1].approach =
          "Extract the existing rule into src/two.js; preserve the same outcomes.";
        s.issues[1].verification_commands = ["node --test tests/two.test.js"];
      },
    });
    const session = JSON.parse(fs.readFileSync(amended.archivePath));
    const { verifyRfcApproval } = require("../scripts/lib/rfc-approval-audit");
    const verified = verifyRfcApproval({
      sidecarPath: session.artifact.json_path,
      slug: session.slug,
      archiveRepoRoot: repo.root,
      lineageTo: JSON.parse(priorBytes).artifact.sidecar_hash,
    });
    assert.equal(verified.approval.schema_version, 3);
    assert.equal(verified.approval.status, "maintained");
    await t.test(
      "current maintained run and audit match the published schemas",
      { skip: !Ajv2020 },
      () => {
        const ajv = new Ajv2020({ strict: true });
        addFormats(ajv);
        for (const [file, data] of [
          ["rfc-session.schema.json", session],
          ["rfc-approval.schema.json", verified.approval],
        ]) {
          const validate = ajv.compile(require(`../skills/rfc/references/${file}`));
          assert.equal(validate(data), true, JSON.stringify(validate.errors));
          if (file.startsWith("rfc-session")) {
            const forged = structuredClone(data);
            delete forged.amendment;
            assert.equal(validate(forged), false);
          }
        }
      }
    );
    assert.equal(verified.lineage.length, 2);
    assert.deepEqual(fs.readFileSync(original.archivePath), priorBytes);
    assert.match(
      fs.readFileSync(session.artifact.html_path, "utf8"),
      /Updated implementation approach \(supersedes prior technical approach\)/
    );
    assert.equal(session.authority.start_implementation, false);
    assert.ok(!session.history.some((h) => h.reason === "explicit human approval recorded"));
  } finally {
    repo.cleanup();
  }
});

test("maintenance refuses acceptance/scope changes and requires every lens to assess preserved behavior and risk", () => {
  const repo = makeRfcRepo();
  try {
    const original = completeApprovedRun(repo, "material-change", { issues: twoIssues() });
    const prior = JSON.parse(fs.readFileSync(original.archivePath));
    const opened = repo.run([
      "amend",
      "--completed",
      original.archivePath,
      "--source-dir",
      repo.root,
      "--issues",
      "2",
      "--reason",
      "Claimed mechanical update",
      "--json",
    ]);
    assert.equal(opened.status, 0, opened.stderr);
    const { session } = JSON.parse(opened.stdout);
    const review = (artifact, verdicts) =>
      recordFile(
        repo,
        session,
        phaseResult(session, {
          artifact,
          evidence: [resultEvidence("review")],
          reviewer_verdicts: verdicts,
        })
      );
    const material = amendArtifact(
      repo,
      prior.slug,
      prior.artifact,
      (s) => {
        s.issues[1].owns.push("README.md");
        s.issues[1].acceptance_criteria = ["Now silently skip failed approvals"];
      },
      { maintenance: true }
    );
    const refused = review(material, passingVerdicts(material, true));
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /acceptance_criteria/);
    const valid = amendArtifact(repo, prior.slug, prior.artifact, (s) =>
      s.issues[1].owns.push("README.md")
    );
    const missing = review(valid, passingVerdicts(valid));
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /preserved product behavior, scope and significant risk/);
    const risk = passingVerdicts(valid, true);
    risk[0].maintenance_scope = {
      preserved: false,
      rationale: "New trust boundary changes significant risk",
    };
    const blocked = review(valid, risk);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /significant risk/);
  } finally {
    repo.cleanup();
  }
});
