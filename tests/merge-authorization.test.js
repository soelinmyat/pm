"use strict";

// Standing merge authorization: the record, the project setting, the session
// ledger and the merge decision. Every PR and CI state is injected; nothing
// here touches the network.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const auth = require("../scripts/lib/merge-authorization");
const githubReader = require("../scripts/lib/github-merge-observation");

const COMMIT = "a".repeat(40);
const OTHER = "b".repeat(40);
const NOW = "2026-11-27T10:00:00.000Z";
const CONTENT = `sha256:${"c".repeat(64)}`;

function record(overrides = {}) {
  return auth.buildMergeAuthorization({
    status: "granted",
    basis: "default",
    groomRunId: "groom_abc123",
    proposalId: "proposal-1",
    revision: 2,
    contentSha256: CONTENT,
    approvedBy: "user:owner",
    approvedAt: "2026-11-27T09:00:00.000Z",
    ...overrides,
  });
}

function proposalIdentity() {
  return {
    path: "/repo/pm/backlog/proposals/unit.json",
    kind: "approved-canonical-json",
    trusted_approval: true,
    proposal_id: "proposal-1",
    slug: "unit",
    revision: 2,
    lifecycle: "planned",
    content_sha256: CONTENT,
    approved_proposal_sha256: `sha256:${"d".repeat(64)}`,
    decision_id: "groom-approval:groom_abc123",
    decision_sha256: `sha256:${"e".repeat(64)}`,
  };
}

function session(overrides = {}) {
  const proposal = proposalIdentity();
  const rec = overrides.record || record();
  return {
    run_id: "dev_run_1",
    slug: "unit",
    status: "active",
    phase: "ship",
    source: { branch: "feature/unit", default_branch: "main", delivery_remote: "origin" },
    task: { proposal, rfc_sidecar: null },
    execution: { mode: "inline" },
    routing: { required_gates: ["tdd", "design-critique", "qa", "review", "verification"] },
    blockers: [],
    merge_authorization: auth.buildSessionLedger(rec, proposal),
    ...overrides.session,
  };
}

function approvalFor(s) {
  if (!s.merge_authorization) return null;
  return {
    proposal_id: s.merge_authorization.proposal.proposal_id,
    revision: s.merge_authorization.proposal.revision,
    decision_id: s.merge_authorization.proposal.decision_id,
    merge_authorization: structuredClone(s.merge_authorization.record),
  };
}

function gates(overrides = {}) {
  const names = ["tdd", "design-critique", "qa", "review", "verification"];
  return {
    schema_version: 1,
    run_id: "dev_run_1",
    gates: names.map((name) => ({
      name,
      status: "passed",
      commit: COMMIT,
      artifact:
        name === "design-critique"
          ? ".pm/dev-sessions/unit/design-critique/director/run-1/review-1/report.json"
          : `.pm/dev-sessions/unit/${name}.json`,
      ...(overrides[name] || {}),
    })),
  };
}

function observation(overrides = {}) {
  return {
    repository: "acme/widget",
    pr_number: 42,
    state: "OPEN",
    draft: false,
    base: "main",
    default_branch: "main",
    head_oid: COMMIT,
    mergeable: "MERGEABLE",
    observed_at: "2026-11-27T09:59:00.000Z",
    protection: { protected: true, required_checks_enforcement: "everyone" },
    checks: {
      requirements_known: true,
      observation_complete: true,
      required: [{ name: "test" }],
      runs: [{ name: "test", head_sha: COMMIT, status: "completed", conclusion: "success" }],
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  const s = overrides.session || session();
  return {
    session: s,
    commit: COMMIT,
    now: NOW,
    projectSetting: { mode: "auto", source: null },
    approval: approvalFor(s),
    gates: gates(),
    gateCheck: { ok: true, issues: [] },
    directorCheck: { ok: true, verdict: "approve", review: 2, round: 2 },
    directorReport: ".pm/dev-sessions/unit/design-critique/director/run-1/review-1/report.json",
    mechanical: { ok: true, issues: [] },
    observation: observation(),
    observationSource: "github",
    deliveryContract: {
      github_name_with_owner: "acme/widget",
      head_branch: "feature/unit",
      base_branch: "main",
    },
    releaseTransaction: { release: { prepared_commit: COMMIT } },
    ...overrides,
  };
}

function codes(result) {
  return result.reasons.map((item) => item.code);
}

test("the record binds who approved which proposal and when, with a checked digest", () => {
  const rec = record();
  assert.equal(rec.kind, "standing-merge-authorization");
  assert.equal(rec.status, "granted");
  assert.equal(rec.approved_by, "user:owner");
  assert.match(rec.record_sha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(auth.mergeAuthorizationIssues(rec), []);
  const tampered = { ...rec, approved_by: "someone-else" };
  assert.match(auth.mergeAuthorizationIssues(tampered).join(";"), /record_sha256 does not match/);
  assert.throws(() => record({ status: "granted", basis: "user-declined" }), /basis/);
  assert.equal(record({ status: "declined", basis: "user-declined" }).status, "declined");
  assert.throws(() => record({ approvedBy: " " }), /approved_by/);
});

test("Merge: manual in either PM instructions file turns standing authorization off", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-merge-setting-"));
  try {
    assert.deepEqual(auth.readProjectMergeSetting(dir), { mode: "auto", source: null });
    fs.writeFileSync(path.join(dir, "instructions.md"), "# Team\n\nMerge: automatic please\n");
    assert.equal(auth.readProjectMergeSetting(dir).mode, "auto");
    fs.writeFileSync(path.join(dir, "instructions.local.md"), "Notes\n- Merge: manual\n");
    const local = auth.readProjectMergeSetting(dir);
    assert.equal(local.mode, "manual");
    assert.equal(local.source, path.join(dir, "instructions.local.md"));
    fs.rmSync(path.join(dir, "instructions.local.md"));
    fs.writeFileSync(path.join(dir, "instructions.md"), "Design review: capture\nMerge: manual\n");
    assert.equal(auth.readProjectMergeSetting(dir).mode, "manual");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(auth.pmDirForProposal("/repo/pm/backlog/proposals/unit.json"), "/repo/pm");
});

test("Merge: manual is recognised however the instructions line is formatted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-merge-setting-format-"));
  const file = path.join(dir, "instructions.md");
  try {
    for (const line of [
      "**Merge:** manual",
      "- **Merge:** `manual`",
      "* __Merge__: manual",
      "Merge: manual (always ask me)",
      "Merge: Manual.",
      "  merge : manual",
      "## Merge: manual",
      "> Merge: manual",
      "| Merge | manual |",
      "Merge: manually",
      "Merge: manually, after I review the PR",
      "Merge: manual",
      "Merge : manual",
    ]) {
      fs.writeFileSync(file, `# Team\n\n${line}\n`);
      assert.equal(auth.readProjectMergeSetting(dir).mode, "manual", line);
    }
    for (const line of [
      "Merge: automatic",
      "Merge strategy: squash; never manual rebases",
      "We merge manually only on Fridays.",
      "Mergeable: manual",
    ]) {
      fs.writeFileSync(file, `# Team\n\n${line}\n`);
      assert.equal(auth.readProjectMergeSetting(dir).mode, "auto", line);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(auth.pmDirForProposal("/repo/elsewhere/unit.json"), null);
});

test("every condition holding at the merge commit allows the merge", () => {
  const result = auth.evaluateAutoMerge(input());
  assert.equal(result.decision, "merge", JSON.stringify(result.reasons));
  assert.equal(result.may_merge, true);
  assert.deepEqual(result.reasons, []);
  assert.equal(result.evidence.ci.status, "passed");
  assert.equal(result.evidence.authorization.approved_by, "user:owner");
  assert.equal(result.evidence.design_director.verdict, "approve");
  assert.equal(result.evidence.gates.length, 5);
});

test("a policy-allowed QA skip still allows the merge; a skipped Review does not", () => {
  assert.equal(
    auth.evaluateAutoMerge(input({ gates: gates({ qa: { status: "skipped" } }) })).decision,
    "merge"
  );
  const result = auth.evaluateAutoMerge(input({ gates: gates({ review: { status: "skipped" } }) }));
  assert.equal(result.decision, "refuse");
  assert.deepEqual(codes(result), ["gate-not-passed"]);
});

test("sessions without a standing authorization fall back to today's confirmation", () => {
  const direct = session();
  delete direct.merge_authorization;
  direct.task.proposal = null;
  let result = auth.evaluateAutoMerge(input({ session: direct }));
  assert.equal(result.decision, "manual");
  assert.ok(codes(result).includes("no-approved-proposal"));

  const older = session();
  delete older.merge_authorization;
  result = auth.evaluateAutoMerge(input({ session: older }));
  assert.equal(result.decision, "manual");
  assert.ok(codes(result).includes("no-standing-authorization"));
});

test("a declined, revoked or project-disabled authorization does not merge", () => {
  const declined = session({ record: record({ status: "declined", basis: "user-declined" }) });
  let result = auth.evaluateAutoMerge(input({ session: declined }));
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["authorization-declined"]);

  const revoked = auth.revokeMergeAuthorization(session(), "owner wants to review this one", NOW);
  result = auth.evaluateAutoMerge(input({ session: revoked }));
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["authorization-revoked"]);

  result = auth.evaluateAutoMerge(
    input({ projectSetting: { mode: "manual", source: "/repo/pm/instructions.md" } })
  );
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["project-merge-manual"]);
});

test("an authorization that does not match the session's proposal or approval audit refuses", () => {
  const s = session();
  const moved = structuredClone(s);
  moved.task.proposal.revision = 3;
  let result = auth.evaluateAutoMerge(input({ session: moved, approval: approvalFor(s) }));
  assert.equal(result.decision, "refuse");
  assert.ok(codes(result).includes("authorization-proposal-mismatch"));

  const approval = approvalFor(s);
  delete approval.merge_authorization;
  result = auth.evaluateAutoMerge(input({ session: s, approval }));
  assert.deepEqual(codes(result), ["authorization-approval-mismatch"]);

  result = auth.evaluateAutoMerge(input({ session: s, approval: null, approvalError: "ENOENT" }));
  assert.deepEqual(codes(result), ["authorization-approval-mismatch"]);
});

test("parked, mechanically blocked and blocked sessions never merge", () => {
  const blocker = (code, extra = {}) => ({
    code,
    reason: code,
    remediation: "x",
    phase: "design-critique",
    recorded_at: NOW,
    ...extra,
  });
  let s = session({
    session: { status: "blocked", blockers: [blocker("design-director-parked")] },
  });
  const result = auth.evaluateAutoMerge(input({ session: s }));
  assert.equal(result.decision, "refuse");
  assert.ok(codes(result).includes("session-parked"));

  s = session({ session: { blockers: [blocker("design-director-mechanical")] } });
  assert.ok(codes(auth.evaluateAutoMerge(input({ session: s }))).includes("mechanically-blocked"));

  s = session({ session: { blockers: [blocker("needs-decision")] } });
  assert.ok(codes(auth.evaluateAutoMerge(input({ session: s }))).includes("open-blocker"));

  s = session({
    session: { blockers: [blocker("needs-decision", { resolved_at: NOW, resolution: "done" })] },
  });
  assert.equal(auth.evaluateAutoMerge(input({ session: s })).decision, "merge");

  s = session({ session: { status: "blocked" } });
  assert.deepEqual(codes(auth.evaluateAutoMerge(input({ session: s }))), ["session-blocked"]);

  s = session({ session: { phase: "review" } });
  assert.deepEqual(codes(auth.evaluateAutoMerge(input({ session: s }))), ["session-not-at-ship"]);

  s = session({ session: { status: "handoff", execution: { mode: "headless" } } });
  assert.equal(auth.evaluateAutoMerge(input({ session: s })).decision, "merge");
});

test("every routed gate must be passed and current at the merge commit", () => {
  let result = auth.evaluateAutoMerge(input({ gates: gates({ qa: { status: "failed" } }) }));
  assert.deepEqual(codes(result), ["gate-not-passed"]);
  result = auth.evaluateAutoMerge(input({ gates: gates({ review: { status: "blocked" } }) }));
  assert.deepEqual(codes(result), ["gate-not-passed"]);
  result = auth.evaluateAutoMerge(input({ gates: gates({ review: { commit: OTHER } }) }));
  assert.deepEqual(codes(result), ["gate-stale"]);
  result = auth.evaluateAutoMerge(
    input({ gates: gates({ review: { commit: OTHER, verified_commit: COMMIT } }) })
  );
  assert.equal(result.decision, "merge");
  const missing = gates();
  missing.gates = missing.gates.filter((row) => row.name !== "verification");
  assert.deepEqual(codes(auth.evaluateAutoMerge(input({ gates: missing }))), ["gate-missing"]);
  assert.deepEqual(codes(auth.evaluateAutoMerge(input({ gates: null }))), ["gates-missing"]);
  assert.deepEqual(
    codes(auth.evaluateAutoMerge(input({ gates: { ...gates(), run_id: "other" } }))),
    ["gates-session-mismatch"]
  );
  result = auth.evaluateAutoMerge(
    input({ gateCheck: { ok: false, issues: [{ message: "review report is stale" }] } })
  );
  assert.deepEqual(codes(result), ["gate-check-failed"]);
  assert.match(result.reasons[0].message, /review report is stale/);
});

test("Design Critique needs an approved director report and passing mechanical checks", () => {
  let result = auth.evaluateAutoMerge(
    input({ directorCheck: { ok: true, verdict: "reject", review: 3, round: 3 } })
  );
  assert.deepEqual(codes(result), ["design-director-not-approved"]);
  result = auth.evaluateAutoMerge(
    input({ directorCheck: { ok: false, issues: [{ path: "report.commit", message: "old" }] } })
  );
  assert.deepEqual(codes(result), ["design-director-not-approved"]);
  result = auth.evaluateAutoMerge(
    input({ mechanical: { ok: false, issues: [{ check: "tokens", message: "a.css:3 #fff" }] } })
  );
  assert.deepEqual(codes(result), ["design-director-mechanical-failed"]);
  // The capture path carries no director report; its gate row and the full
  // gate check decide.
  result = auth.evaluateAutoMerge(input({ directorCheck: null, mechanical: null }));
  assert.equal(result.decision, "merge");
});

test("CI must be green on the PR head that equals the checked commit", () => {
  const ci = (runs, extra = {}) =>
    observation({
      checks: {
        requirements_known: true,
        observation_complete: true,
        required: [{ name: "test" }],
        runs,
        ...extra,
      },
    });
  const run = (status, conclusion, head = COMMIT) => [
    { name: "test", head_sha: head, status, conclusion },
  ];
  for (const [label, obs] of [
    ["pending", ci(run("in_progress", null))],
    ["failed", ci(run("completed", "failure"))],
    ["missing", ci([])],
    ["old head", ci(run("completed", "success", OTHER))],
    ["no policy", ci(run("completed", "success"), { requirements_known: false })],
  ]) {
    const result = auth.evaluateAutoMerge(input({ observation: obs }));
    assert.equal(result.decision, "refuse", label);
    assert.deepEqual(codes(result), ["ci-not-green"], label);
  }
  const none = auth.evaluateAutoMerge(
    input({ observation: ci(run("completed", "success"), { required: [] }) })
  );
  assert.equal(none.decision, "refuse");
  assert.deepEqual(codes(none), ["required-checks-not-enforced", "ci-not-green"]);
});

test("the PR must be open, ready, mergeable and target the default branch at the checked head", () => {
  const cases = [
    [{ state: "MERGED" }, "pr-not-open"],
    [{ draft: true }, "pr-draft"],
    [{ mergeable: "CONFLICTING" }, "pr-not-mergeable"],
    [{ mergeable: "UNKNOWN" }, "pr-not-mergeable"],
    [{ observed_at: "2026-11-27T09:50:00.000Z" }, "observation-stale"],
  ];
  for (const [change, code] of cases) {
    const result = auth.evaluateAutoMerge(input({ observation: observation(change) }));
    assert.equal(result.decision, "refuse", code);
    assert.deepEqual(codes(result), [code]);
  }
  let result = auth.evaluateAutoMerge(input({ observation: observation({ base: "release" }) }));
  assert.ok(codes(result).includes("pr-base-not-default"));
  result = auth.evaluateAutoMerge(input({ observation: observation({ head_oid: OTHER }) }));
  assert.ok(codes(result).includes("pr-head-moved"));
  assert.ok(codes(result).includes("ci-not-green"));
  result = auth.evaluateAutoMerge(
    input({ observation: observation({ repository: "fork/widget" }) })
  );
  assert.deepEqual(codes(result), ["pr-repository-mismatch"]);
  result = auth.evaluateAutoMerge(input({ observation: null }));
  assert.deepEqual(codes(result), ["observation-missing"]);
  result = auth.evaluateAutoMerge(input({ deliveryContract: null }));
  assert.deepEqual(codes(result), ["delivery-contract-missing"]);
  result = auth.evaluateAutoMerge(input({ releaseTransaction: null }));
  assert.deepEqual(codes(result), ["release-transaction-missing"]);
  result = auth.evaluateAutoMerge(
    input({ releaseTransaction: { release: { prepared_commit: OTHER } } })
  );
  assert.deepEqual(codes(result), ["prepared-commit-mismatch"]);
  result = auth.evaluateAutoMerge(input({ commit: "abc" }));
  assert.ok(codes(result).includes("commit-invalid"));
});

test("recording a merge grants merge authority with an auditable reason; a refusal grants nothing", () => {
  const grants = [];
  const grantAuthority = (s, actions, why, options) => {
    grants.push({ actions, why, options });
    const next = structuredClone(s);
    next.authority = { merge: true };
    return next;
  };
  const s = session();
  const merged = auth.recordMergeDecision(s, auth.evaluateAutoMerge(input()), grantAuthority);
  assert.equal(merged.merge_authorization.decisions.length, 1);
  assert.equal(merged.merge_authorization.decisions[0].decision, "merge");
  assert.equal(merged.merge_authorization.decisions[0].commit, COMMIT);
  assert.equal(grants.length, 1);
  assert.deepEqual(grants[0].actions, ["merge"]);
  assert.ok(grants[0].why.startsWith(auth.GRANT_REASON_PREFIX));
  assert.match(grants[0].why, new RegExp(COMMIT));
  assert.deepEqual(auth.ledgerIssues(merged.merge_authorization), []);

  const refused = auth.recordMergeDecision(
    s,
    auth.evaluateAutoMerge(input({ observation: observation({ mergeable: "CONFLICTING" }) })),
    grantAuthority
  );
  assert.equal(grants.length, 1);
  assert.equal(refused.merge_authorization.decisions[0].decision, "refuse");
  assert.equal(refused.merge_authorization.decisions[0].reasons[0].code, "pr-not-mergeable");
  assert.equal(auth.latestDecision(refused).decision, "refuse");
  assert.deepEqual(auth.ledgerIssues(refused.merge_authorization), []);
});

test("revocation is recorded once with a reason", () => {
  const s = session();
  assert.throws(() => auth.revokeMergeAuthorization(s, " "), /reason/);
  const revoked = auth.revokeMergeAuthorization(s, "owner asked", NOW);
  assert.deepEqual(revoked.merge_authorization.revoked, { revoked_at: NOW, reason: "owner asked" });
  const again = auth.revokeMergeAuthorization(revoked, "again", "2026-11-28T00:00:00.000Z");
  assert.equal(again.merge_authorization.revoked.reason, "owner asked");
  const bare = structuredClone(s);
  delete bare.merge_authorization;
  assert.throws(() => auth.revokeMergeAuthorization(bare, "x"), /no standing merge authorization/);
});

test("the session ledger must bind the session's own approved proposal", () => {
  const errors = [];
  const issue = (p, m) => ({ path: p, message: m });
  auth.validateSessionMergeAuthorization(session(), errors, issue);
  assert.deepEqual(errors, []);
  const moved = session();
  moved.task.proposal.decision_id = "groom-approval:other";
  auth.validateSessionMergeAuthorization(moved, errors, issue);
  assert.ok(errors.some((item) => item.path === "$.merge_authorization.proposal.decision_id"));
  const orphan = session();
  orphan.task.proposal = null;
  const orphanErrors = [];
  auth.validateSessionMergeAuthorization(orphan, orphanErrors, issue);
  assert.ok(orphanErrors.some((item) => /approved proposal/.test(item.message)));
  const none = session();
  delete none.merge_authorization;
  const noneErrors = [];
  auth.validateSessionMergeAuthorization(none, noneErrors, issue);
  assert.deepEqual(noneErrors, []);
});

test("revocation clears a merge authority the standing authorization granted, and says so", () => {
  const grantAuthority = (s, actions, why, options) => {
    const next = structuredClone(s);
    next.authority = { ...(next.authority || {}), merge: true };
    next.authority_log = [
      ...(next.authority_log || []),
      { actions, reason: why, granted_at: options.now },
    ];
    return next;
  };
  const base = session({ session: { authority: { merge: false }, authority_log: [] } });
  const merged = auth.recordMergeDecision(base, auth.evaluateAutoMerge(input()), grantAuthority);
  assert.equal(merged.authority.merge, true);
  const revoked = auth.revokeMergeAuthorization(merged, "owner asked", NOW);
  assert.equal(revoked.authority.merge, false, "the standing merge grant is withdrawn");
  assert.deepEqual(revoked.merge_authorization.revoked, {
    revoked_at: NOW,
    reason: "owner asked",
    cleared_authority: ["merge"],
  });
  assert.deepEqual(auth.ledgerIssues(revoked.merge_authorization), []);

  // A merge grant a human gave is theirs; revoking the standing one keeps it.
  const human = structuredClone(merged);
  human.authority_log.push({
    actions: ["merge"],
    reason: "User requested: merge it",
    granted_at: NOW,
  });
  const kept = auth.revokeMergeAuthorization(human, "owner asked", NOW);
  assert.equal(kept.authority.merge, true);
  assert.deepEqual(kept.merge_authorization.revoked, { revoked_at: NOW, reason: "owner asked" });

  const bad = structuredClone(revoked.merge_authorization);
  bad.revoked.cleared_authority = ["push_feature_branch"];
  assert.ok(auth.ledgerIssues(bad).some((item) => /cleared_authority/.test(item)));
});

test("Merge: manual is recognised inside quotes, brackets, parentheses and task lists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-merge-setting-wrapped-"));
  const file = path.join(dir, "instructions.md");
  try {
    for (const line of [
      'Merge: "manual"',
      "Merge: 'manual'",
      "Merge: “manual”",
      "Merge: [manual]",
      "Merge: (manual)",
      "- [x] Merge: manual",
      "- [ ] Merge: manual",
      "* [X] **Merge:** `manual`",
      "[x] Merge: manual",
      '| Merge | "manual" |',
      'Merge: `"manual"`',
    ]) {
      fs.writeFileSync(file, `# Team\n\n${line}\n`);
      assert.equal(auth.readProjectMergeSetting(dir).mode, "manual", line);
    }
    for (const line of [
      "Merge: automatic",
      'Merge: "automatic"',
      "Merge strategy: squash; never manual rebases",
      "We merge manually only on Fridays.",
      "Mergeable: manual",
      "Merge: not manual",
      "Merge: [not manual]",
      "Auto-merge: manual review first",
      "Merge conflicts: resolve manually",
      "Merge requests: manual review",
      "- [x] Merge strategy: manual",
    ]) {
      fs.writeFileSync(file, `# Team\n\n${line}\n`);
      assert.equal(auth.readProjectMergeSetting(dir).mode, "auto", line);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a PM directory that cannot be determined reads as Merge: manual", () => {
  for (const missing of [null, undefined, "", "  "]) {
    const setting = auth.readProjectMergeSetting(missing);
    assert.equal(setting.mode, "manual", String(missing));
    assert.equal(setting.source, null);
    assert.match(setting.reason, /PM directory/);
  }
  const reasons = auth.authorizationReasons({
    session: session(),
    projectSetting: auth.readProjectMergeSetting(auth.pmDirForProposal("/repo/elsewhere/u.json")),
    approval: approvalFor(session()),
  });
  const manual = reasons.find((item) => item.code === "project-merge-manual");
  assert.ok(manual, JSON.stringify(reasons));
  assert.match(manual.message, /PM directory/);
});

test("a durable revocation record revokes the same approved revision in any session", () => {
  const s = session();
  const ledger = s.merge_authorization;
  assert.equal(
    auth.revocationPathForProposal("/repo/pm/backlog/proposals/unit.json"),
    "/repo/pm/backlog/proposals/unit.merge-revocation.json"
  );
  const added = auth.addRevocation(null, ledger, "owner wants to read it", NOW, "dev_run_1");
  assert.equal(added.changed, true);
  assert.deepEqual(auth.revocationDocumentIssues(added.document), []);
  assert.deepEqual(added.document.revocations[0], {
    proposal_id: "proposal-1",
    revision: 2,
    content_sha256: CONTENT,
    decision_id: "groom-approval:groom_abc123",
    record_sha256: ledger.record.record_sha256,
    revoked_at: NOW,
    reason: "owner wants to read it",
    revoked_in_run: "dev_run_1",
  });
  // Adding the same revocation again changes nothing.
  assert.equal(
    auth.addRevocation(added.document, ledger, "again", NOW, "dev_run_2").changed,
    false
  );

  // A session whose own ledger is not revoked is revoked by the record.
  let result = auth.evaluateAutoMerge(input({ revocations: added.document }));
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["authorization-revoked"]);

  // A record for another revision, content or decision does not apply.
  for (const change of [
    { revision: 3 },
    { content_sha256: `sha256:${"f".repeat(64)}` },
    { decision_id: "groom-approval:groom_other" },
    { proposal_id: "proposal-2" },
  ]) {
    const other = structuredClone(added.document);
    Object.assign(other.revocations[0], change);
    result = auth.evaluateAutoMerge(input({ revocations: other }));
    assert.equal(result.decision, "merge", JSON.stringify(change));
  }

  // An unreadable or malformed record never allows a merge.
  result = auth.evaluateAutoMerge(input({ revocationError: "EACCES" }));
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["authorization-revocation-unreadable"]);
  result = auth.evaluateAutoMerge(input({ revocations: { schema_version: 1 } }));
  assert.equal(result.decision, "manual");
  assert.deepEqual(codes(result), ["authorization-revocation-unreadable"]);

  // Routing copies a matching record into the new session's ledger.
  const routed = auth.applyRevocationRecord(structuredClone(ledger), {
    value: added.document,
    error: null,
  });
  assert.equal(routed.revoked.revoked_at, NOW);
  assert.match(routed.revoked.reason, /owner wants to read it/);
  assert.deepEqual(auth.ledgerIssues(routed), []);
  const untouched = auth.applyRevocationRecord(structuredClone(ledger), {
    value: null,
    error: null,
  });
  assert.equal(untouched.revoked, null);
  const unreadable = auth.applyRevocationRecord(structuredClone(ledger), {
    value: null,
    error: "EACCES",
  });
  assert.notEqual(unreadable.revoked, null, "an unreadable record revokes, failing closed");
});

// ---------------------------------------------------------------------------
// The PR and CI state come from GitHub through an injected `gh` runner. No
// test reaches the network.

const APP = 15368;

function githubState(head = COMMIT) {
  return {
    "repos/acme/widget": { full_name: "acme/widget", default_branch: "main" },
    "repos/acme/widget/pulls/42": {
      number: 42,
      state: "open",
      merged: false,
      draft: false,
      base: { ref: "main", repo: { full_name: "acme/widget" } },
      head: { sha: head, ref: "feature/unit", repo: { full_name: "acme/widget" } },
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
          checks: [{ context: "test", app_id: APP }],
        },
      },
    },
    [`repos/acme/widget/commits/${head}/check-runs?per_page=100`]: {
      total_count: 1,
      check_runs: [
        {
          name: "test",
          app: { id: APP },
          head_sha: head,
          status: "completed",
          conclusion: "success",
        },
      ],
    },
    [`repos/acme/widget/commits/${head}/status?per_page=100`]: {
      total_count: 0,
      statuses: [],
    },
  };
}

function fakeGh(state, failure) {
  const calls = [];
  const runGh = (args) => {
    calls.push(args);
    if (failure) return failure;
    if (args[0] !== "api") return { status: 1, stdout: "", stderr: "only gh api is stubbed" };
    const body = state[args[1]];
    if (body === undefined) return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
    return { status: 0, stdout: JSON.stringify(body), stderr: "" };
  };
  return { runGh, calls };
}

function decideFromGithub(state, { failure, extra = {} } = {}) {
  const gh = fakeGh(state, failure);
  const read = githubReader.readGithubMergeObservation({
    repository: "acme/widget",
    prNumber: 42,
    runGh: gh.runGh,
    now: () => "2026-11-27T09:59:30.000Z",
    sleep: () => {},
  });
  const result = auth.evaluateAutoMerge(
    input({
      observation: read.observation,
      observationError: read.error,
      observationSource: read.source,
      ...extra,
    })
  );
  return { result, read, calls: gh.calls };
}

test("merge-check reads the PR, protection and checks from GitHub and merges on green", () => {
  const { result, read, calls } = decideFromGithub(githubState());
  assert.equal(read.source, "github");
  assert.equal(result.decision, "merge", JSON.stringify(result.reasons));
  assert.equal(result.evidence.observation_source, "github");
  assert.equal(result.evidence.ci.status, "passed");
  assert.deepEqual(
    calls.map((args) => args.join(" ")),
    [
      "api repos/acme/widget",
      "api repos/acme/widget/pulls/42",
      "api repos/acme/widget/branches/main",
      `api repos/acme/widget/commits/${COMMIT}/check-runs?per_page=100`,
      `api repos/acme/widget/commits/${COMMIT}/status?per_page=100`,
    ]
  );
  // A required status context reported as a commit status also counts.
  const state = githubState();
  state["repos/acme/widget/branches/main"].protection.required_status_checks.checks = [
    { context: "lint", app_id: null },
  ];
  state[`repos/acme/widget/commits/${COMMIT}/status?per_page=100`] = {
    total_count: 1,
    statuses: [{ context: "lint", state: "success" }],
  };
  assert.equal(decideFromGithub(state).result.decision, "merge");
});

test("GitHub-read pending, failed or missing required checks refuse the merge", () => {
  const runs = (status, conclusion) => {
    const state = githubState();
    state[`repos/acme/widget/commits/${COMMIT}/check-runs?per_page=100`].check_runs[0] = {
      name: "test",
      app: { id: APP },
      head_sha: COMMIT,
      status,
      conclusion,
    };
    return state;
  };
  for (const [label, state, ci] of [
    ["pending", runs("in_progress", null), "pending"],
    ["failed", runs("completed", "failure"), "failed"],
  ]) {
    const { result } = decideFromGithub(state);
    assert.equal(result.decision, "refuse", label);
    assert.deepEqual(codes(result), ["ci-not-green"], label);
    assert.equal(result.evidence.ci.status, ci, label);
  }
  // A check run from another app does not satisfy a required check bound to one.
  const spoofed = runs("completed", "success");
  spoofed[`repos/acme/widget/commits/${COMMIT}/check-runs?per_page=100`].check_runs[0].app.id = 1;
  assert.deepEqual(codes(decideFromGithub(spoofed).result), ["ci-not-green"]);
  // More check runs than one page returned is an incomplete observation.
  const paged = githubState();
  paged[`repos/acme/widget/commits/${COMMIT}/check-runs?per_page=100`].total_count = 101;
  assert.deepEqual(codes(decideFromGithub(paged).result), ["ci-not-green"]);
});

test("a base branch without enforced required checks refuses the merge", () => {
  const unprotected = githubState();
  unprotected["repos/acme/widget/branches/main"] = { name: "main", protected: false };
  const none = githubState();
  none["repos/acme/widget/branches/main"].protection.required_status_checks = {
    enforcement_level: "everyone",
    contexts: [],
    checks: [],
  };
  const off = githubState();
  off["repos/acme/widget/branches/main"].protection.required_status_checks.enforcement_level =
    "off";
  for (const [label, state] of [
    ["unprotected", unprotected],
    ["none required", none],
    ["enforcement off", off],
  ]) {
    const { result } = decideFromGithub(state);
    assert.equal(result.decision, "refuse", label);
    assert.ok(codes(result).includes("required-checks-not-enforced"), `${label}: ${codes(result)}`);
  }
  const admins = githubState();
  admins["repos/acme/widget/branches/main"].protection.required_status_checks.enforcement_level =
    "non_admins";
  const { result } = decideFromGithub(admins);
  assert.equal(result.decision, "refuse");
  assert.deepEqual(codes(result), ["required-checks-admins-exempt"]);
});

test("a GitHub-read PR that moved, is a draft or is not mergeable refuses the merge", () => {
  const moved = githubState(OTHER);
  moved["repos/acme/widget/pulls/42"].head.sha = OTHER;
  let { result } = decideFromGithub(moved);
  assert.equal(result.decision, "refuse");
  assert.ok(codes(result).includes("pr-head-moved"));
  assert.ok(codes(result).includes("ci-not-green"));

  const draft = githubState();
  draft["repos/acme/widget/pulls/42"].draft = true;
  draft["repos/acme/widget/pulls/42"].mergeable_state = "draft";
  ({ result } = decideFromGithub(draft));
  assert.equal(result.decision, "refuse");
  assert.ok(codes(result).includes("pr-draft"));

  for (const [mergeable, mergeableState] of [
    [false, "dirty"],
    [null, "unknown"],
    [true, "blocked"],
    [true, "behind"],
  ]) {
    const state = githubState();
    state["repos/acme/widget/pulls/42"].mergeable = mergeable;
    state["repos/acme/widget/pulls/42"].mergeable_state = mergeableState;
    ({ result } = decideFromGithub(state));
    assert.equal(result.decision, "refuse", mergeableState);
    assert.deepEqual(codes(result), ["pr-not-mergeable"], mergeableState);
  }

  const closed = githubState();
  closed["repos/acme/widget/pulls/42"].state = "closed";
  ({ result } = decideFromGithub(closed));
  assert.ok(codes(result).includes("pr-not-open"));

  const fork = githubState();
  fork["repos/acme/widget/pulls/42"].head.repo.full_name = "fork/widget";
  ({ result } = decideFromGithub(fork));
  assert.deepEqual(codes(result), ["pr-repository-mismatch"]);
});

test("gh missing, signed out, rate-limited or failing refuses with its own reason", () => {
  for (const [label, failure, code] of [
    [
      "missing",
      {
        status: null,
        stdout: "",
        stderr: "",
        error: Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" }),
      },
      "gh-unavailable",
    ],
    [
      "signed out",
      {
        status: 4,
        stdout: "",
        stderr: "To get started with GitHub CLI, please run:  gh auth login",
      },
      "gh-unauthenticated",
    ],
    [
      "bad token",
      { status: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)" },
      "gh-unauthenticated",
    ],
    [
      "rate limited",
      { status: 1, stdout: "", stderr: "gh: API rate limit exceeded for user ID 1. (HTTP 403)" },
      "gh-rate-limited",
    ],
    [
      "server error",
      { status: 1, stdout: "", stderr: "gh: Server Error (HTTP 502)" },
      "github-read-failed",
    ],
    ["not json", { status: 0, stdout: "<html>", stderr: "" }, "github-read-failed"],
  ]) {
    const { result, read } = decideFromGithub(githubState(), { failure });
    assert.equal(read.observation, null, label);
    assert.equal(result.decision, "refuse", label);
    assert.deepEqual(codes(result), [code], label);
  }
  // The reader refuses to build a request from an unchecked repository or PR.
  const bad = githubReader.readGithubMergeObservation({
    repository: "acme/widget/../x",
    prNumber: 42,
    runGh: () => assert.fail("must not call gh"),
  });
  assert.equal(bad.error.code, "pr-unknown");
});

test("an observation file never grants a merge, whatever it claims", () => {
  const claimed = observation({ source: "github" });
  const result = auth.evaluateAutoMerge(input({ observation: claimed, observationSource: "file" }));
  assert.equal(result.decision, "refuse");
  assert.deepEqual(codes(result), ["observation-not-from-github"]);
  assert.equal(result.evidence.observation_source, "file");
  // A caller that names no source is treated the same way.
  const unnamed = auth.evaluateAutoMerge(input({ observationSource: undefined }));
  assert.deepEqual(codes(unnamed), ["observation-not-from-github"]);
  assert.equal(unnamed.evidence.observation_source, null);
});

test("the reader asks GitHub again while it is still computing mergeable", () => {
  const state = githubState();
  state["repos/acme/widget/pulls/42"].mergeable = null;
  state["repos/acme/widget/pulls/42"].mergeable_state = "unknown";
  const pulls = "repos/acme/widget/pulls/42";
  let reads = 0;
  const waits = [];
  const runGh = (args) => {
    if (args[1] === pulls && ++reads === 2) {
      state[pulls].mergeable = true;
      state[pulls].mergeable_state = "clean";
    }
    return { status: 0, stdout: JSON.stringify(state[args[1]]), stderr: "" };
  };
  const read = githubReader.readGithubMergeObservation({
    repository: "acme/widget",
    prNumber: 42,
    runGh,
    now: () => "2026-11-27T09:59:30.000Z",
    sleep: (ms) => waits.push(ms),
  });
  assert.equal(reads, 2);
  assert.deepEqual(waits, [2000]);
  assert.equal(read.observation.mergeable, "MERGEABLE");
  assert.equal(
    auth.evaluateAutoMerge(input({ observation: read.observation, observationSource: "github" }))
      .decision,
    "merge"
  );
});
