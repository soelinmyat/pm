"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const {
  approvalTransitionDigest,
  approveSession,
  validateSession,
} = require("../scripts/lib/rfc-session-schema");
const {
  amendArtifact,
  completeAmendment,
  completeApprovedRun,
  makeRfcRepo,
  passingVerdicts,
  phaseResult,
  prepareApprovedHandoff,
  recordFile,
  relabelArtifact,
  resultEvidence,
  twoIssues,
} = require("./helpers/rfc-run-fixture");

const SLUG = "amendment-schema";
const REFERENCES = path.join(__dirname, "..", "skills", "rfc", "references");

function amendedRepo() {
  const repo = makeRfcRepo();
  const approved = completeApprovedRun(repo, SLUG, { issues: twoIssues() });
  const approvalRel = `${SLUG}.approval.json`;
  const v1Audit = JSON.parse(
    execFileSync("git", ["show", `HEAD:${approvalRel}`], { cwd: repo.root, encoding: "utf8" })
  );
  const amendment = completeAmendment(repo, approved.archivePath, {
    issues: "2",
    reason: "Issue 2 must also update the README",
    mutate: (sidecar) => sidecar.issues[1].owns.push("README.md"),
  });
  return {
    repo,
    approved,
    amendment,
    v1Audit,
    v2Audit: JSON.parse(fs.readFileSync(path.join(repo.root, approvalRel), "utf8")),
    original: JSON.parse(fs.readFileSync(approved.archivePath, "utf8")),
    amended: JSON.parse(fs.readFileSync(amendment.archivePath, "utf8")),
  };
}

function compile(name) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(JSON.parse(fs.readFileSync(path.join(REFERENCES, name), "utf8")));
}

test("legacy archives without an amendment field keep validating and keep their v1 digest", () => {
  const fixture = amendedRepo();
  try {
    const legacy = structuredClone(fixture.original);
    delete legacy.amendment;
    assert.deepEqual(validateSession(legacy), []);
    assert.equal(fixture.original.amendment, null);
    assert.equal(approvalTransitionDigest(legacy), approvalTransitionDigest(fixture.original));
    assert.equal(
      approvalTransitionDigest(fixture.original),
      fixture.v1Audit.approval_transition_sha256
    );
    assert.deepEqual(validateSession(fixture.amended), []);
    assert.equal(fixture.amended.amendment.of_run_id, fixture.approved.runId);
  } finally {
    fixture.repo.cleanup();
  }
});

test(
  "published RFC schemas accept v1 and v2 approvals and amendment sessions exactly as runtime does",
  { skip: !Ajv2020 && "Ajv 2020 dev dependency is not installed in this snapshot" },
  () => {
    const fixture = amendedRepo();
    try {
      const approval = compile("rfc-approval.schema.json");
      assert.equal(approval(fixture.v1Audit), true, JSON.stringify(approval.errors));
      assert.equal(approval(fixture.v2Audit), true, JSON.stringify(approval.errors));
      assert.equal(fixture.v2Audit.schema_version, 2);
      assert.equal(fixture.v2Audit.amends.run_id, fixture.approved.runId);
      assert.equal(approval({ ...fixture.v1Audit, amends: fixture.v2Audit.amends }), false);
      const { amends: _amends, ...v2WithoutLineage } = fixture.v2Audit;
      assert.equal(approval(v2WithoutLineage), false);
      assert.equal(approval({ ...fixture.v2Audit, amended_issue_nums: [] }), false);

      const session = compile("rfc-session.schema.json");
      const legacy = structuredClone(fixture.original);
      delete legacy.amendment;
      for (const [label, value] of [
        ["original", fixture.original],
        ["legacy", legacy],
        ["amended", fixture.amended],
      ]) {
        assert.equal(session(value), true, `${label}: ${JSON.stringify(session.errors)}`);
      }
      const extraField = structuredClone(fixture.amended);
      extraField.amendment.approved_by = "someone";
      assert.equal(session(extraField), false);
      assert.ok(validateSession(extraField).some((entry) => entry.path.startsWith("$.amendment")));
      const unsorted = structuredClone(fixture.amended);
      unsorted.amendment.amended_issue_nums = [];
      assert.equal(session(unsorted), false);
      assert.ok(validateSession(unsorted).some((entry) => entry.path.startsWith("$.amendment")));
    } finally {
      fixture.repo.cleanup();
    }
  }
);

test("a supplied --approved-sidecar-sha256 must match on an original run too", () => {
  const repo = makeRfcRepo();
  try {
    let checked = false;
    prepareApprovedHandoff(repo, "confirmed-original", {
      beforeApprove: (session, artifact) => {
        assert.throws(
          () =>
            approveSession(session, {
              approvedBy: "Test Owner",
              approvedSidecarSha256: `sha256:${"0".repeat(64)}`,
            }),
          /does not match the reviewed sidecar/
        );
        const approved = approveSession(session, {
          approvedBy: "Test Owner",
          approvedSidecarSha256: artifact.sidecar_hash,
        });
        assert.equal(approved.status, "approved");
        checked = true;
      },
    });
    assert.equal(checked, true);
  } finally {
    repo.cleanup();
  }
});

test("an approval retry still checks a supplied sidecar hash", () => {
  const repo = makeRfcRepo();
  try {
    let checked = false;
    prepareApprovedHandoff(repo, "retry-confirmation", {
      beforeApprove: (session, artifact) => {
        const approved = approveSession(session, {
          approvedBy: "Test Owner",
          approvedSidecarSha256: artifact.sidecar_hash,
        });
        assert.throws(
          () =>
            approveSession(approved, {
              approvedBy: "Test Owner",
              approvedSidecarSha256: `sha256:${"0".repeat(64)}`,
            }),
          /does not match the reviewed sidecar/
        );
        const retried = approveSession(approved, {
          approvedBy: "Test Owner",
          approvedSidecarSha256: artifact.sidecar_hash,
        });
        assert.deepEqual(retried, approved);
        assert.deepEqual(approveSession(approved, { approvedBy: "Test Owner" }), approved);
        checked = true;
      },
    });
    assert.equal(checked, true);
  } finally {
    repo.cleanup();
  }
});

test("amend refuses a run that a newer run of the same RFC superseded", () => {
  const repo = makeRfcRepo();
  const slug = "superseded-run";
  try {
    const first = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const second = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const amendArgs = (completed) => [
      "amend",
      "--completed",
      completed,
      "--source-dir",
      repo.root,
      "--issues",
      "2",
      "--reason",
      "Issue 2 must also update the README",
      "--json",
    ];
    const stale = repo.run(amendArgs(first.archivePath));
    assert.equal(stale.status, 3, stale.stderr);
    assert.match(
      stale.stderr,
      new RegExp(`superseded by ${second.runId}; amend the latest run instead`)
    );
    const latest = repo.run(amendArgs(second.archivePath));
    assert.equal(latest.status, 0, latest.stderr);
  } finally {
    repo.cleanup();
  }
});

test("RFC docs say amend writes no artifact files and who edits them", () => {
  const skill = fs.readFileSync(path.join(REFERENCES, "..", "SKILL.md"), "utf8");
  const review = fs.readFileSync(path.join(REFERENCES, "..", "steps", "03-rfc-review.md"), "utf8");
  for (const doc of [skill, review]) {
    assert.match(doc, /amend[^.]*writes no artifact files/i);
    assert.match(
      doc,
      /appends? the `owns` entries[^.]*, sets the RFC lifecycle to `draft`, and commits/
    );
  }
});

function openAmendment(repo, completedPath, env = {}) {
  return repo.run(
    [
      "amend",
      "--completed",
      completedPath,
      "--source-dir",
      repo.root,
      "--issues",
      "2",
      "--reason",
      "Issue 2 must also update the README",
      "--json",
    ],
    env
  );
}

// Runs the withdraw recovery that SKILL.md documents, committing only the restore paths.
function runWithdrawRecovery(repo, restore) {
  const relative = restore.paths.map((file) => path.relative(repo.root, file));
  execFileSync(
    "sh",
    [
      "-c",
      'commit="$1"; shift; git checkout "$commit" -- "$@" && ' +
        '{ git diff --cached --quiet -- "$@" || git commit -qm "withdraw amendment" -- "$@"; }',
      "sh",
      restore.commit,
      ...relative,
    ],
    { cwd: repo.root }
  );
  return relative;
}

// Rewrites the committed RFC HTML and returns the artifact identity of the new commit.
function editCommittedHtml(repo, artifact, edit) {
  fs.writeFileSync(artifact.html_path, edit(fs.readFileSync(artifact.html_path, "utf8")));
  execFileSync("git", ["add", path.relative(repo.root, artifact.html_path)], { cwd: repo.root });
  execFileSync("git", ["commit", "-qm", "edit RFC HTML"], { cwd: repo.root });
  const html = fs.readFileSync(artifact.html_path);
  return {
    ...artifact,
    html_hash: `sha256:${crypto.createHash("sha256").update(html).digest("hex")}`,
    commit: repo.head(),
  };
}

test("an amendment may change RFC HTML only to list the paths it adds in their issue", () => {
  const repo = makeRfcRepo();
  const slug = "amendment-prose";
  try {
    const approved = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const archived = JSON.parse(fs.readFileSync(approved.archivePath, "utf8"));
    const amended = openAmendment(repo, approved.archivePath);
    assert.equal(amended.status, 0, amended.stderr);
    const { session } = JSON.parse(amended.stdout);
    const artifact = amendArtifact(repo, slug, archived.artifact, (sidecar) =>
      sidecar.issues[1].owns.push("README.md")
    );
    const review = (candidate) =>
      recordFile(
        repo,
        session,
        phaseResult(session, {
          artifact: candidate,
          evidence: [resultEvidence("review")],
          reviewer_verdicts: passingVerdicts(candidate),
        })
      );
    const rewritten = editCommittedHtml(repo, artifact, (html) =>
      html.replace(
        "<h1>Immutable RFC</h1>",
        "<h1>Immutable RFC</h1>\n  <p>Also rewrite the scheduler.</p>"
      )
    );
    const refused = review(rewritten);
    assert.notEqual(refused.status, 0);
    assert.match(
      refused.stderr,
      /amendment changed RFC HTML beyond the lifecycle and added owned paths/
    );

    const listed = editCommittedHtml(repo, rewritten, (html) =>
      html.replace("\n  <p>Also rewrite the scheduler.</p>", "")
    );
    const accepted = review(listed);
    assert.equal(accepted.status, 0, accepted.stderr);
  } finally {
    repo.cleanup();
  }
});

test("amend refuses a run whose prior lineage archive is missing", () => {
  const { repo, approved, amendment } = amendedRepo();
  try {
    fs.rmSync(path.dirname(approved.archivePath), { recursive: true });
    const refused = openAmendment(repo, amendment.archivePath);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /cannot amend: .*has no matching completed RFC run/);
  } finally {
    repo.cleanup();
  }
});

test("withdraw closes an open amendment run and frees the RFC for another amend", () => {
  const repo = makeRfcRepo();
  const slug = "amendment-withdraw";
  try {
    const approved = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const amended = openAmendment(repo, approved.archivePath);
    assert.equal(amended.status, 0, amended.stderr);
    const { session_path: sessionPath, session } = JSON.parse(amended.stdout);
    const before = fs.readFileSync(sessionPath, "utf8");

    const noReason = repo.run(["withdraw", "--session", sessionPath, "--json"]);
    assert.notEqual(noReason.status, 0);
    assert.match(noReason.stderr, /--reason/);
    const loopWorker = repo.run(
      ["withdraw", "--session", sessionPath, "--reason", "Wrong issue", "--json"],
      { PM_LOOP_WORKER: "1" }
    );
    assert.equal(loopWorker.status, 3, loopWorker.stderr);
    assert.match(loopWorker.stderr, /loop workers cannot withdraw/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);

    const withdrawn = repo.run([
      "withdraw",
      "--session",
      sessionPath,
      "--reason",
      "Declared the wrong issue",
      "--json",
    ]);
    assert.equal(withdrawn.status, 0, withdrawn.stderr);
    const archiveDir = path.join(
      path.dirname(path.dirname(approved.archivePath)),
      "withdrawn",
      session.run_id
    );
    assert.equal(JSON.parse(withdrawn.stdout).session_path, path.join(archiveDir, "session.json"));
    assert.equal(fs.existsSync(sessionPath), false);
    assert.equal(fs.readFileSync(path.join(archiveDir, "session.json"), "utf8"), before);
    const record = JSON.parse(fs.readFileSync(path.join(archiveDir, "withdrawal.json"), "utf8"));
    assert.equal(record.run_id, session.run_id);
    assert.equal(record.slug, slug);
    assert.equal(record.amends_run_id, approved.runId);
    assert.equal(record.reason, "Declared the wrong issue");

    // No amendment commit exists yet, so the documented recovery restores nothing and
    // must still succeed without an empty commit.
    const { restore } = JSON.parse(withdrawn.stdout);
    const head = repo.head();
    runWithdrawRecovery(repo, restore);
    assert.equal(repo.head(), head);

    const again = openAmendment(repo, approved.archivePath);
    assert.equal(again.status, 0, again.stderr);
  } finally {
    repo.cleanup();
  }
});

test("withdraw refuses an approved amendment and restores the prior audit after revise", () => {
  const repo = makeRfcRepo();
  const slug = "amendment-withdraw-approved";
  try {
    const approved = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const archived = JSON.parse(fs.readFileSync(approved.archivePath, "utf8"));
    const amended = openAmendment(repo, approved.archivePath);
    assert.equal(amended.status, 0, amended.stderr);
    const { session_path: sessionPath, session } = JSON.parse(amended.stdout);
    const artifact = amendArtifact(repo, slug, archived.artifact, (sidecar) =>
      sidecar.issues[1].owns.push("README.md")
    );
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
    const approval = repo.run([
      "approve",
      "--session",
      sessionPath,
      "--approved-by",
      "Test Owner",
      "--approved-sidecar-sha256",
      artifact.sidecar_hash,
      "--json",
    ]);
    assert.equal(approval.status, 0, approval.stderr);
    const withdraw = () =>
      repo.run(["withdraw", "--session", sessionPath, "--reason", "Too late", "--json"]);

    const before = fs.readFileSync(sessionPath, "utf8");
    const afterApprove = withdraw();
    assert.equal(afterApprove.status, 3, afterApprove.stderr);
    assert.match(afterApprove.stderr, /approved amendment cannot be withdrawn/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);

    // approval-audit rewrites the slug's approval.json to name this run, so a
    // withdraw here would leave the audit pointing at a run that never completes.
    const auditPath = archived.artifact.json_path.replace(/\.json$/i, ".approval.json");
    const priorAudit = fs.readFileSync(auditPath);
    const identityPath = path.join(repo.root, `${session.run_id}-artifact.json`);
    fs.writeFileSync(
      identityPath,
      JSON.stringify(relabelArtifact(repo, slug, artifact, "approved"))
    );
    const audited = repo.run([
      "approval-audit",
      "--session",
      sessionPath,
      "--artifact",
      identityPath,
      "--json",
    ]);
    assert.equal(audited.status, 0, audited.stderr);
    // Handoff commits the audit before it records the run.
    execFileSync("git", ["add", path.relative(repo.root, auditPath)], { cwd: repo.root });
    execFileSync("git", ["commit", "-qm", "approve amendment"], { cwd: repo.root });
    const afterAudit = withdraw();
    assert.equal(afterAudit.status, 3, afterAudit.stderr);
    assert.match(afterAudit.stderr, /approved amendment cannot be withdrawn/);
    assert.equal(fs.existsSync(sessionPath), true);

    assert.notDeepEqual(fs.readFileSync(auditPath), priorAudit);

    // revise resets the approval to pending while the audit still names this run,
    // so withdraw puts back the audit of the approval it would have amended.
    const revised = repo.run(["revise", "--session", sessionPath, "--reason", "Rethink", "--json"]);
    assert.equal(revised.status, 0, revised.stderr);
    assert.equal(JSON.parse(fs.readFileSync(sessionPath, "utf8")).approval.status, "pending");
    const afterRevise = withdraw();
    assert.equal(afterRevise.status, 0, afterRevise.stderr);
    assert.deepEqual(fs.readFileSync(auditPath), priorAudit);
    assert.equal(fs.existsSync(sessionPath), false);

    // The emitted recovery puts every amended file back at the prior commit.
    const { restore } = JSON.parse(afterRevise.stdout);
    assert.equal(restore.commit, archived.artifact.commit);
    assert.deepEqual(restore.paths, [
      archived.artifact.html_path,
      archived.artifact.json_path,
      auditPath,
    ]);
    // Unrelated staged work in the artifact repository must stay out of the recovery commit.
    fs.writeFileSync(path.join(repo.root, "unrelated.txt"), "not part of the RFC\n");
    execFileSync("git", ["add", "unrelated.txt"], { cwd: repo.root });
    const relative = runWithdrawRecovery(repo, restore);
    const committed = execFileSync("git", ["show", "--name-only", "--format=", "HEAD"], {
      cwd: repo.root,
      encoding: "utf8",
    });
    assert.doesNotMatch(committed, /unrelated\.txt/);
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: repo.root,
      encoding: "utf8",
    });
    assert.equal(staged.trim(), "unrelated.txt");
    const status = execFileSync("git", ["status", "--porcelain", "--", ...relative], {
      cwd: repo.root,
      encoding: "utf8",
    });
    assert.equal(status, "");
    const committedAudit = execFileSync("git", ["show", `HEAD:${relative[2]}`], {
      cwd: repo.root,
    });
    assert.deepEqual(committedAudit, priorAudit);
    const again = openAmendment(repo, approved.archivePath);
    assert.equal(again.status, 0, again.stderr);
  } finally {
    repo.cleanup();
  }
});

test("withdraw refuses when the approval audit cannot be read", () => {
  const repo = makeRfcRepo();
  const slug = "amendment-withdraw-unreadable";
  try {
    const approved = completeApprovedRun(repo, slug, { issues: twoIssues() });
    const archived = JSON.parse(fs.readFileSync(approved.archivePath, "utf8"));
    const amended = openAmendment(repo, approved.archivePath);
    assert.equal(amended.status, 0, amended.stderr);
    const { session_path: sessionPath } = JSON.parse(amended.stdout);
    fs.writeFileSync(archived.artifact.json_path.replace(/\.json$/i, ".approval.json"), "{");
    const refused = repo.run([
      "withdraw",
      "--session",
      sessionPath,
      "--reason",
      "Wrong issue",
      "--json",
    ]);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /cannot read approval audit/);
    assert.equal(fs.existsSync(sessionPath), true);
  } finally {
    repo.cleanup();
  }
});

test("withdraw refuses a run that is not an amendment", () => {
  const repo = makeRfcRepo();
  try {
    const initialized = repo.run([
      "init",
      "--slug",
      "original-run",
      "--source-dir",
      repo.root,
      "--json",
    ]);
    assert.equal(initialized.status, 0, initialized.stderr);
    const sessionPath = JSON.parse(initialized.stdout).session_path;
    const refused = repo.run([
      "withdraw",
      "--session",
      sessionPath,
      "--reason",
      "Changed mind",
      "--json",
    ]);
    assert.equal(refused.status, 3, refused.stderr);
    assert.match(refused.stderr, /only an open amendment run can be withdrawn/);
    assert.equal(fs.existsSync(sessionPath), true);
  } finally {
    repo.cleanup();
  }
});

test("RFC handoff docs say an amendment leaves the proposal lifecycle alone", () => {
  const handoff = fs.readFileSync(path.join(REFERENCES, "..", "steps", "05-handoff.md"), "utf8");
  assert.doesNotMatch(handoff, /exactly as for an original run/);
  assert.match(handoff, /amendment[^.]*leaves? the proposal lifecycle unchanged/i);
  const skill = fs.readFileSync(path.join(REFERENCES, "..", "SKILL.md"), "utf8");
  assert.match(skill, /rfc-session\.js withdraw --session/);
  assert.match(skill, /Once approved, an amendment cannot be withdrawn/);
  assert.match(skill, /git checkout <restore\.commit> -- <restore\.paths>/);
  // A withdraw before any amendment commit restores nothing, so the commit is conditional,
  // and it names the restore paths so unrelated staged work stays out of it.
  assert.match(
    skill,
    /git diff --cached --quiet -- <restore\.paths> \|\| git commit -- <restore\.paths>/
  );
  const schema = fs.readFileSync(path.join(REFERENCES, "state-schema.md"), "utf8");
  assert.match(schema, /committing only those paths, and only if that staged a change/);
  assert.doesNotMatch(skill, /revert its artifact commit/);
});
