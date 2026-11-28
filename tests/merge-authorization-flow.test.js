"use strict";

// Standing merge authorization from the grooming approval to the Dev session:
// Groom records it with the approval decision, the approval audit carries it,
// Dev routing copies it into the session, and dev-session merge-check and
// merge-authorization-revoke read and write it. No network calls.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync, execFileSync } = require("node:child_process");

const groom = require("../scripts/lib/groom-session-schema");
const proposalSchema = require("../scripts/lib/proposal-schema");
const dev = require("../scripts/lib/dev-session-schema");
const auth = require("../scripts/lib/merge-authorization");
const {
  materializeProposalSources,
  reviewOutcome,
  reviewRow,
} = require("./helpers/groom-review-fixture");
const { makeRfcRepo } = require("./helpers/rfc-run-fixture");

const GROOM_CLI = path.resolve(__dirname, "../scripts/groom-session.js");
const DEV_CLI = path.resolve(__dirname, "../scripts/dev-session.js");
let Ajv2020 = null;
let addFormats = null;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  // Optional dev dependency.
}

function groomForApproval(repo, proposalDir = "pm/backlog/proposals") {
  repo.root = fs.realpathSync(repo.root);
  repo.own("structured-groom");
  const session = groom.createSession({
    slug: "structured-groom",
    sourceDir: repo.root,
    tier: "quick",
  });
  const proposal = JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures/proposals/strong-v1.json"))
  );
  proposal.source.session_id = session.run_id;
  proposal.review_contract = {
    session_id: session.run_id,
    tier: "quick",
    required_question_ids: session.routing.review_questions.map((question) => question.id),
  };
  proposal.question_reviews = session.routing.review_questions.map((question, index) =>
    reviewRow(question, index)
  );
  proposal.lifecycle = "reviewed";
  proposal.design_context = {
    design_requirements: proposal.design_requirements.map((item) => item.requirement),
    ui_impact: false,
    prototype: null,
    critical_states: ["draft", "approved", "archived", "error"],
    experience_invariants: ["Every state exposes its next action."],
    visual_invariants: [],
  };
  proposal.review = {
    status: "passed",
    revision: proposal.revision,
    content_sha256: proposalSchema.proposalContentHash(proposal),
    completed_at: "2026-07-14T00:00:00.000Z",
  };
  materializeProposalSources(repo.root, proposal);
  proposal.review.content_sha256 = proposalSchema.proposalContentHash(proposal);
  const proposalPath = path.join(repo.root, proposalDir, "structured-groom.json");
  fs.mkdirSync(path.dirname(proposalPath), { recursive: true });
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  const { approval_snapshot_sha256: _snapshot, ...identity } = groom.proposalIdentityFromPath(
    proposalPath,
    repo.root
  );
  session.phase = "approval";
  session.status = "awaiting_approval";
  session.proposal = identity;
  session.context.artifact_repo_root = repo.root;
  session.review = {
    status: "passed",
    proposal_hash: identity.content_hash,
    rounds: 1,
    outcomes: session.routing.review_questions.map((question, index) =>
      reviewOutcome(question, identity.content_hash, index)
    ),
    reviewed_at: "2026-07-14T00:30:00.000Z",
  };
  const sessionPath = path.join(repo.root, ".pm/groom-sessions", session.slug, "session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  return { proposal, proposalPath, sessionPath };
}

function approve(repo, prepared, extra = []) {
  const result = spawnSync(
    process.execPath,
    [
      GROOM_CLI,
      "approve",
      "--session",
      prepared.sessionPath,
      "--approved-by",
      "product-owner",
      ...extra,
      "--json",
    ],
    { encoding: "utf8" }
  );
  return result;
}

function finishApproval(prepared, session) {
  prepared.proposal.lifecycle = "approved";
  fs.writeFileSync(prepared.proposalPath, JSON.stringify(prepared.proposal));
  const audit = groom.buildApprovalAudit(session);
  const approvalPath = prepared.proposalPath.replace(/\.json$/, ".approval.json");
  fs.writeFileSync(approvalPath, JSON.stringify(audit));
  return { audit, approvalPath };
}

function devSessionFrom(repo, proposalPath) {
  execFileSync("git", ["checkout", "-q", "-b", "structured-groom"], { cwd: repo.root });
  return dev.applyRouting(dev.createSession({ slug: "structured-groom", sourceDir: repo.root }), {
    kind: "proposal",
    risk: {},
    proposal_path: proposalPath,
  });
}

test("grooming approval records a standing merge authorization by default and Dev carries it", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = approve(repo, prepared);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    const record = session.approval.merge_authorization;
    assert.equal(record.status, "granted");
    assert.equal(record.basis, "default");
    assert.equal(record.approved_by, "product-owner");
    assert.equal(record.approved_at, session.approval.approved_at);
    assert.equal(record.groom_run_id, session.run_id);
    assert.equal(record.content_sha256, session.approval.proposal_hash);
    assert.match(JSON.parse(approved.stdout).merge_authorization_notice, /merge/i);

    const { audit, approvalPath } = finishApproval(prepared, session);
    assert.deepEqual(audit.merge_authorization, record);
    const read = proposalSchema.readApprovedProposal(prepared.proposalPath, {
      projectRoot: repo.root,
    });
    assert.deepEqual(read.approval.merge_authorization, record);

    // The approval decision hash binds the record: a swapped record fails.
    const forged = structuredClone(audit);
    forged.merge_authorization = auth.buildMergeAuthorization({
      status: "granted",
      basis: "default",
      groomRunId: record.groom_run_id,
      proposalId: record.proposal_id,
      revision: record.revision,
      contentSha256: record.content_sha256,
      approvedBy: record.approved_by,
      approvedAt: "2026-07-15T00:00:00.000Z",
    });
    fs.writeFileSync(approvalPath, JSON.stringify(forged));
    assert.throws(
      () => proposalSchema.readApprovedProposal(prepared.proposalPath, { projectRoot: repo.root }),
      /merge_authorization|decision/
    );
    fs.writeFileSync(approvalPath, JSON.stringify(audit));

    const devSession = devSessionFrom(repo, prepared.proposalPath);
    const ledger = devSession.merge_authorization;
    assert.deepEqual(ledger.record, record);
    assert.equal(ledger.proposal.decision_id, devSession.task.proposal.decision_id);
    assert.equal(ledger.proposal.path, devSession.task.proposal.path);
    assert.equal(ledger.revoked, null);
    assert.deepEqual(ledger.decisions, []);
    assert.deepEqual(dev.validateSession(devSession), []);
    if (Ajv2020) {
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const schema = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../skills/dev/references/dev-session.schema.json"))
      );
      const valid = ajv.compile(schema);
      assert.equal(valid(devSession), true, JSON.stringify(valid.errors));
    }
  } finally {
    repo.cleanup();
  }
});

test("the approver can decline standing merge authorization for one proposal", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = approve(repo, prepared, ["--merge", "manual"]);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    assert.equal(session.approval.merge_authorization.status, "declined");
    assert.equal(session.approval.merge_authorization.basis, "user-declined");
    finishApproval(prepared, session);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    assert.equal(devSession.merge_authorization.record.status, "declined");
    const bad = approve(repo, groomForApproval(makeRfcRepo()), ["--merge", "sometimes"]);
    assert.notEqual(bad.status, 0);
  } finally {
    repo.cleanup();
  }
});

test("Merge: manual in the project's PM instructions records a declined authorization", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    fs.writeFileSync(path.join(repo.root, "pm", "instructions.md"), "Merge: manual\n");
    const approved = approve(repo, prepared, ["--merge", "auto"]);
    assert.equal(approved.status, 0, approved.stderr);
    const session = JSON.parse(approved.stdout).session;
    assert.equal(session.approval.merge_authorization.status, "declined");
    assert.equal(session.approval.merge_authorization.basis, "project-merge-manual");
  } finally {
    repo.cleanup();
  }
});

test("an approval made before standing authorization still reads and routes without one", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const session = groom.approveSession(
      JSON.parse(fs.readFileSync(prepared.sessionPath, "utf8")),
      { approvedBy: "product-owner" }
    );
    assert.equal(session.approval.merge_authorization, undefined);
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(session));
    const { audit } = finishApproval(prepared, session);
    assert.equal(audit.merge_authorization, undefined);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    assert.equal(devSession.merge_authorization, undefined);
    assert.deepEqual(dev.validateSession(devSession), []);
  } finally {
    repo.cleanup();
  }
});

function writeDevSession(repo, devSession) {
  const sessionPath = path.join(repo.root, ".pm/dev-sessions", devSession.slug, "session.json");
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(devSession, null, 2));
  return sessionPath;
}

function runDev(args, cwd) {
  return spawnSync(process.execPath, [DEV_CLI, ...args], { cwd, encoding: "utf8" });
}

test("merge-check refuses, records why and grants nothing when conditions fail", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    const sessionPath = writeDevSession(repo, devSession);
    const head = repo.head();
    const observationPath = path.join(path.dirname(sessionPath), "ship", "observations", "pr.json");
    fs.mkdirSync(path.dirname(observationPath), { recursive: true });
    fs.writeFileSync(
      observationPath,
      JSON.stringify({
        repository: "acme/widget",
        pr_number: 7,
        state: "OPEN",
        draft: false,
        base: "main",
        default_branch: "main",
        head_oid: head,
        mergeable: "MERGEABLE",
        observed_at: new Date().toISOString(),
        checks: {
          requirements_known: true,
          observation_complete: true,
          required: [{ name: "test" }],
          runs: [{ name: "test", head_sha: head, status: "in_progress", conclusion: null }],
        },
      })
    );
    const checked = runDev(
      [
        "merge-check",
        "--session",
        sessionPath,
        "--observation",
        observationPath,
        "--commit",
        head,
        "--record",
        "--json",
      ],
      repo.root
    );
    assert.equal(checked.status, 1, checked.stderr);
    const result = JSON.parse(checked.stdout);
    assert.equal(result.decision, "refuse");
    const reasonCodes = result.reasons.map((item) => item.code);
    for (const code of ["session-not-at-ship", "gates-missing", "ci-not-green"])
      assert.ok(reasonCodes.includes(code), `${code} in ${reasonCodes}`);
    const stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.merge_authorization.decisions.length, 1);
    assert.equal(stored.merge_authorization.decisions[0].decision, "refuse");
    assert.equal(stored.authority.merge, false);
    assert.deepEqual(dev.validateSession(stored), []);

    const revoked = runDev(
      [
        "merge-authorization-revoke",
        "--session",
        sessionPath,
        "--reason",
        "Owner wants to read this one",
        "--json",
      ],
      repo.root
    );
    assert.equal(revoked.status, 0, revoked.stderr);
    const again = runDev(
      [
        "merge-check",
        "--session",
        sessionPath,
        "--observation",
        observationPath,
        "--commit",
        head,
        "--json",
      ],
      repo.root
    );
    assert.equal(again.status, 3, again.stderr);
    const manual = JSON.parse(again.stdout);
    assert.equal(manual.decision, "manual");
    assert.ok(manual.reasons.some((item) => item.code === "authorization-revoked"));
    const status = runDev(["merge-authorization", "--session", sessionPath, "--json"], repo.root);
    assert.equal(status.status, 3, status.stderr);
    assert.equal(JSON.parse(status.stdout).applies, false);
    assert.deepEqual(
      JSON.parse(status.stdout).reasons.map((item) => item.code),
      ["authorization-revoked"]
    );
  } finally {
    repo.cleanup();
  }
});

test("merge-authorization grants push and PR creation only while the authorization applies", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const sessionPath = writeDevSession(repo, devSessionFrom(repo, prepared.proposalPath));
    const shown = runDev(
      ["merge-authorization", "--session", sessionPath, "--apply", "--json"],
      repo.root
    );
    assert.equal(shown.status, 0, shown.stderr);
    const report = JSON.parse(shown.stdout);
    assert.equal(report.applies, true);
    const stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.authority.push_feature_branch, true);
    assert.equal(stored.authority.create_pr, true);
    assert.equal(stored.authority.merge, false);
    assert.ok(stored.authority_log.at(-1).reason.startsWith(auth.GRANT_REASON_PREFIX));

    fs.writeFileSync(path.join(repo.root, "pm", "instructions.md"), "Merge: manual\n");
    const off = runDev(
      ["merge-authorization", "--session", sessionPath, "--apply", "--json"],
      repo.root
    );
    assert.equal(off.status, 3, off.stderr);
    assert.equal(JSON.parse(off.stdout).applies, false);
  } finally {
    repo.cleanup();
  }
});

test("a proposal outside {pm_dir}/backlog/proposals is read as Merge: manual at approval", () => {
  // Without the PM directory the project setting cannot be read, so the
  // approval must not grant a standing authorization.
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo, "pm/drafts");
    const approved = approve(repo, prepared);
    assert.equal(approved.status, 0, approved.stderr);
    const payload = JSON.parse(approved.stdout);
    assert.equal(payload.session.approval.merge_authorization.status, "declined");
    assert.equal(payload.session.approval.merge_authorization.basis, "project-merge-manual");
    assert.match(payload.merge_authorization_notice, /PM directory/);
  } finally {
    repo.cleanup();
  }
});

test("merge-check reads Merge: manual when the session's proposal has no PM directory", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    // Move the proposal and its audit out of backlog/proposals.
    const moved = path.join(repo.root, "pm", "drafts", "structured-groom.json");
    fs.mkdirSync(path.dirname(moved), { recursive: true });
    fs.copyFileSync(prepared.proposalPath, moved);
    fs.copyFileSync(
      prepared.proposalPath.replace(/\.json$/, ".approval.json"),
      moved.replace(/\.json$/, ".approval.json")
    );
    devSession.task.proposal.path = moved;
    devSession.merge_authorization.proposal.path = moved;
    const sessionPath = writeDevSession(repo, devSession);
    const status = runDev(["merge-authorization", "--session", sessionPath, "--json"], repo.root);
    assert.equal(status.status, 3, status.stderr);
    const report = JSON.parse(status.stdout);
    assert.equal(report.applies, false);
    assert.equal(report.project_setting.mode, "manual");
    assert.match(report.project_setting.reason, /PM directory/);
    assert.ok(report.reasons.some((item) => item.code === "project-merge-manual"));
  } finally {
    repo.cleanup();
  }
});

test("a merge-check whose decision cannot be recorded exits 8, never as manual or merge", () => {
  const repo = makeRfcRepo();
  const sessionDir = () => path.join(repo.root, ".pm/dev-sessions/structured-groom");
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const sessionPath = writeDevSession(repo, devSessionFrom(repo, prepared.proposalPath));
    const observationPath = path.join(repo.root, "pr.json");
    fs.writeFileSync(observationPath, JSON.stringify({ state: "OPEN" }));
    const before = fs.readFileSync(sessionPath, "utf8");
    // The session folder cannot be written, so neither the lock nor the
    // decision can be.
    fs.chmodSync(sessionDir(), 0o555);
    const checked = runDev(
      [
        "merge-check",
        "--session",
        sessionPath,
        "--observation",
        observationPath,
        "--commit",
        repo.head(),
        "--record",
        "--json",
      ],
      repo.root
    );
    fs.chmodSync(sessionDir(), 0o755);
    assert.equal(checked.status, 8, checked.stdout + checked.stderr);
    assert.match(checked.stderr, /could not record/);
    assert.equal(fs.readFileSync(sessionPath, "utf8"), before);
  } finally {
    if (fs.existsSync(sessionDir())) fs.chmodSync(sessionDir(), 0o755);
    repo.cleanup();
  }
});

test("a revocation outlives its session: later Dev sessions from the same approval stay revoked", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const first = devSessionFrom(repo, prepared.proposalPath);
    const firstPath = writeDevSession(repo, first);
    const revoked = runDev(
      [
        "merge-authorization-revoke",
        "--session",
        firstPath,
        "--reason",
        "Owner wants to read this one",
        "--json",
      ],
      repo.root
    );
    assert.equal(revoked.status, 0, revoked.stderr);
    const recordPath = prepared.proposalPath.replace(/\.json$/, ".merge-revocation.json");
    assert.equal(JSON.parse(revoked.stdout).revocation_record, recordPath);
    assert.equal(fs.statSync(recordPath).mode & 0o777, 0o600);
    const stored = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    assert.equal(stored.kind, "standing-merge-authorization-revocations");
    assert.equal(stored.revocations.length, 1);
    assert.equal(stored.revocations[0].proposal_id, first.merge_authorization.proposal.proposal_id);
    assert.equal(stored.revocations[0].revision, first.merge_authorization.proposal.revision);
    assert.equal(stored.revocations[0].decision_id, first.merge_authorization.proposal.decision_id);

    // A new Dev session routed from the same approval starts revoked.
    fs.rmSync(path.dirname(firstPath), { recursive: true, force: true });
    execFileSync("git", ["checkout", "-q", "-"], { cwd: repo.root });
    execFileSync("git", ["branch", "-q", "-D", "structured-groom"], { cwd: repo.root });
    const second = devSessionFrom(repo, prepared.proposalPath);
    assert.notEqual(second.merge_authorization.revoked, null);
    assert.match(second.merge_authorization.revoked.reason, /Owner wants to read this one/);
    assert.deepEqual(dev.validateSession(second), []);

    // A session that never saw the revocation is revoked at merge time too.
    const unrevoked = structuredClone(second);
    unrevoked.merge_authorization.revoked = null;
    const secondPath = writeDevSession(repo, unrevoked);
    const status = runDev(["merge-authorization", "--session", secondPath, "--json"], repo.root);
    assert.equal(status.status, 3, status.stderr);
    assert.deepEqual(
      JSON.parse(status.stdout).reasons.map((item) => item.code),
      ["authorization-revoked"]
    );
    const observationPath = path.join(repo.root, "pr.json");
    fs.writeFileSync(observationPath, JSON.stringify({ state: "OPEN" }));
    const checked = runDev(
      [
        "merge-check",
        "--session",
        secondPath,
        "--observation",
        observationPath,
        "--commit",
        repo.head(),
        "--json",
      ],
      repo.root
    );
    assert.equal(checked.status, 3, checked.stderr);
    assert.ok(JSON.parse(checked.stdout).reasons.some((r) => r.code === "authorization-revoked"));

    // A revocation recorded for another revision does not apply.
    stored.revocations[0].revision += 1;
    fs.writeFileSync(recordPath, JSON.stringify(stored));
    const other = runDev(["merge-authorization", "--session", secondPath, "--json"], repo.root);
    assert.equal(other.status, 0, other.stdout + other.stderr);
  } finally {
    repo.cleanup();
  }
});

// A stand-in for the GitHub CLI: answers `gh api <path>` from a JSON map and
// logs every call. Nothing reaches the network.
function stubGh(repo, state) {
  const bin = path.join(repo.root, ".stub-bin");
  fs.mkdirSync(bin, { recursive: true });
  const statePath = path.join(bin, "state.json");
  const logPath = path.join(bin, "calls.log");
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeFileSync(
    path.join(bin, "gh"),
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs');",
      `fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      `const state = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));`,
      "const [verb, endpoint] = process.argv.slice(2);",
      "if (verb !== 'api' || !(endpoint in state)) { process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1); }",
      "process.stdout.write(JSON.stringify(state[endpoint]));",
    ].join("\n"),
    { mode: 0o755 }
  );
  return {
    env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
    calls: () =>
      fs.existsSync(logPath)
        ? fs
            .readFileSync(logPath, "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line))
        : [],
  };
}

function githubFor(head) {
  return {
    "repos/acme/widget": { full_name: "acme/widget", default_branch: "main" },
    "repos/acme/widget/pulls/7": {
      number: 7,
      state: "open",
      merged: false,
      draft: false,
      base: { ref: "main" },
      head: { sha: head, ref: "structured-groom", repo: { full_name: "acme/widget" } },
      mergeable: true,
      mergeable_state: "clean",
    },
    "repos/acme/widget/branches/main": {
      name: "main",
      protected: true,
      protection: {
        enabled: true,
        required_status_checks: {
          enforcement_level: "everyone",
          contexts: ["test"],
          checks: [{ context: "test", app_id: 15368 }],
        },
      },
    },
    [`repos/acme/widget/commits/${head}/check-runs?per_page=100`]: {
      total_count: 1,
      check_runs: [
        {
          name: "test",
          app: { id: 15368 },
          head_sha: head,
          status: "completed",
          conclusion: "success",
        },
      ],
    },
    [`repos/acme/widget/commits/${head}/status?per_page=100`]: { total_count: 0, statuses: [] },
  };
}

function runDevWith(args, cwd, env) {
  return spawnSync(process.execPath, [DEV_CLI, ...args], { cwd, encoding: "utf8", env });
}

test("merge-check reads PR and CI state from GitHub; an observation file never merges", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const devSession = devSessionFrom(repo, prepared.proposalPath);
    const sessionPath = writeDevSession(repo, devSession);
    const head = repo.head();
    execFileSync("git", ["remote", "set-url", "origin", "git@github.com:acme/widget.git"], {
      cwd: repo.root,
    });
    const gh = stubGh(repo, githubFor(head));
    const check = (extra = []) =>
      runDevWith(
        ["merge-check", "--session", sessionPath, "--commit", head, ...extra, "--json"],
        repo.root,
        gh.env
      );

    // Without the delivery contract and release transaction the PR is
    // unknown, and GitHub is not called.
    let result = check();
    assert.equal(result.status, 1, result.stderr);
    let decided = JSON.parse(result.stdout);
    assert.ok(decided.reasons.some((item) => item.code === "pr-unknown"));
    assert.deepEqual(gh.calls(), []);

    const shipDir = path.join(path.dirname(sessionPath), "ship");
    fs.mkdirSync(shipDir, { recursive: true });
    fs.writeFileSync(
      path.join(shipDir, "delivery-contract.json"),
      JSON.stringify({
        github_name_with_owner: "acme/widget",
        head_branch: "structured-groom",
        base_branch: "main",
      })
    );
    fs.writeFileSync(
      path.join(shipDir, "release-transaction.json"),
      JSON.stringify({
        release: { prepared_commit: head },
        effects: { "create-pr": { verified_receipt: { receipt: { pr_number: 7 } } } },
      })
    );
    result = check(["--record"]);
    assert.equal(result.status, 1, result.stderr);
    decided = JSON.parse(result.stdout);
    const reasonCodes = decided.reasons.map((item) => item.code);
    // The session is not at Ship and has no gates, so it still refuses, but
    // nothing about the PR or CI read from GitHub does.
    assert.ok(reasonCodes.includes("session-not-at-ship"), reasonCodes.join());
    for (const code of [
      "observation-not-from-github",
      "pr-unknown",
      "ci-not-green",
      "pr-not-mergeable",
      "pr-head-moved",
      "required-checks-not-enforced",
    ])
      assert.ok(!reasonCodes.includes(code), `${code} in ${reasonCodes}`);
    assert.equal(decided.evidence.observation_source, "github");
    assert.equal(decided.evidence.pr.number, 7);
    assert.equal(decided.evidence.ci.status, "passed");
    assert.deepEqual(
      gh.calls().map((args) => args.join(" ")),
      [
        "api repos/acme/widget",
        "api repos/acme/widget/pulls/7",
        "api repos/acme/widget/branches/main",
        `api repos/acme/widget/commits/${head}/check-runs?per_page=100`,
        `api repos/acme/widget/commits/${head}/status?per_page=100`,
      ]
    );
    let stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.merge_authorization.decisions.at(-1).evidence.observation_source, "github");

    // An observation file claiming everything is green is diagnosis only.
    const observationPath = path.join(shipDir, "observations", "pr.json");
    fs.mkdirSync(path.dirname(observationPath), { recursive: true });
    fs.writeFileSync(
      observationPath,
      JSON.stringify({
        source: "github",
        repository: "acme/widget",
        pr_number: 7,
        state: "OPEN",
        draft: false,
        base: "main",
        default_branch: "main",
        head_oid: head,
        mergeable: "MERGEABLE",
        observed_at: new Date().toISOString(),
        protection: { protected: true, required_checks_enforcement: "everyone" },
        checks: {
          requirements_known: true,
          observation_complete: true,
          required: [{ name: "test" }],
          runs: [{ name: "test", head_sha: head, status: "completed", conclusion: "success" }],
        },
      })
    );
    const before = gh.calls().length;
    result = check(["--observation", observationPath, "--record"]);
    assert.equal(result.status, 1, result.stderr);
    decided = JSON.parse(result.stdout);
    assert.ok(decided.reasons.some((item) => item.code === "observation-not-from-github"));
    assert.equal(decided.evidence.observation_source, "file");
    assert.equal(gh.calls().length, before, "an observation file replaces the GitHub read");
    stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    assert.equal(stored.merge_authorization.decisions.at(-1).evidence.observation_source, "file");
    assert.equal(stored.authority.merge, false);
  } finally {
    repo.cleanup();
  }
});

// Writes the ship records merge-check reads the repository and PR number from.
function writeShipRecords(sessionPath, head, repository = "acme/widget") {
  const shipDir = path.join(path.dirname(sessionPath), "ship");
  fs.mkdirSync(shipDir, { recursive: true });
  fs.writeFileSync(
    path.join(shipDir, "delivery-contract.json"),
    JSON.stringify({
      github_name_with_owner: repository,
      head_branch: "structured-groom",
      base_branch: "main",
    })
  );
  fs.writeFileSync(
    path.join(shipDir, "release-transaction.json"),
    JSON.stringify({
      release: { prepared_commit: head },
      effects: { "create-pr": { verified_receipt: { receipt: { pr_number: 7 } } } },
    })
  );
}

test("merge-check reads the repository the delivery remote pushes to and refuses a different contract", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const sessionPath = writeDevSession(repo, devSessionFrom(repo, prepared.proposalPath));
    const head = repo.head();
    const gh = stubGh(repo, githubFor(head));
    const check = () => {
      const result = runDevWith(
        ["merge-check", "--session", sessionPath, "--commit", head, "--json"],
        repo.root,
        gh.env
      );
      assert.equal(result.status, 1, result.stderr);
      return JSON.parse(result.stdout).reasons.map((item) => item.code);
    };
    writeShipRecords(sessionPath, head);

    // The delivery remote pushes to no GitHub repository: the repository is unknown.
    let codes = check();
    assert.ok(codes.includes("delivery-remote-unknown"), codes.join());
    assert.deepEqual(gh.calls(), []);

    // A stale contract naming another repository is refused before GitHub is read.
    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/acme/widget-old.git"], {
      cwd: repo.root,
    });
    codes = check();
    assert.ok(codes.includes("delivery-remote-mismatch"), codes.join());
    assert.deepEqual(gh.calls(), []);

    // The contract and the remote agree: GitHub is read for that repository.
    execFileSync("git", ["remote", "set-url", "origin", "https://github.com/acme/widget.git"], {
      cwd: repo.root,
    });
    codes = check();
    assert.ok(!codes.some((code) => code.startsWith("delivery-remote")), codes.join());
    assert.equal(gh.calls()[0].join(" "), "api repos/acme/widget");
  } finally {
    repo.cleanup();
  }
});

test("a refused short or uppercase commit is recorded with its reasons, not exit 8", () => {
  const repo = makeRfcRepo();
  try {
    const prepared = groomForApproval(repo);
    const approved = JSON.parse(approve(repo, prepared).stdout).session;
    fs.writeFileSync(prepared.sessionPath, JSON.stringify(approved));
    finishApproval(prepared, approved);
    const sessionPath = writeDevSession(repo, devSessionFrom(repo, prepared.proposalPath));
    const observationPath = path.join(repo.root, "pr.json");
    fs.writeFileSync(observationPath, JSON.stringify({ state: "OPEN" }));
    for (const commit of [repo.head().slice(0, 7), repo.head().toUpperCase()]) {
      const checked = runDev(
        [
          "merge-check",
          "--session",
          sessionPath,
          "--observation",
          observationPath,
          "--commit",
          commit,
          "--record",
          "--json",
        ],
        repo.root
      );
      assert.equal(checked.status, 1, checked.stdout + checked.stderr);
      const decided = JSON.parse(checked.stdout);
      assert.ok(decided.reasons.some((item) => item.code === "commit-invalid"));
      const stored = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
      const entry = stored.merge_authorization.decisions.at(-1);
      assert.equal(entry.decision, "refuse");
      assert.equal(entry.commit, null);
      assert.equal(entry.evidence.requested_commit, commit);
      assert.ok(entry.reasons.some((item) => item.code === "commit-invalid"));
    }
  } finally {
    repo.cleanup();
  }
});
