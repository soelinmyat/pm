"use strict";

// Standing merge authorization.
//
// Approving a groomed proposal also authorizes the merge of the resulting
// work to the remote default branch, provided every merge condition holds at
// the merge commit. The record is written with the approval decision, copied
// into the Dev session when Dev routes from that proposal, and consulted at
// merge time by `dev-session.js merge-check`. This module decides; it never
// calls the network. Ship performs the merge itself.
//
// Keep this file free of proposal, Groom and Dev schema imports: those modules
// require it, and the decision must stay testable with injected state.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { summarizeRequiredChecks } = require("./ci-check-summary");

const RECORD_KIND = "standing-merge-authorization";
const RECORD_SCOPE = "merge-to-remote-default-branch-when-all-gates-pass";
const RECORD_FIELDS = [
  "schema_version",
  "kind",
  "status",
  "basis",
  "scope",
  "groom_run_id",
  "proposal_id",
  "revision",
  "content_sha256",
  "approved_by",
  "approved_at",
  "record_sha256",
];
const BASES = Object.freeze({
  granted: ["default"],
  declined: ["user-declined", "project-merge-manual"],
});
const LEDGER_FIELDS = ["schema_version", "proposal", "record", "revoked", "decisions"];
const LEDGER_PROPOSAL_FIELDS = [
  "path",
  "proposal_id",
  "slug",
  "revision",
  "content_sha256",
  "decision_id",
];
const DECISION_FIELDS = ["decided_at", "commit", "decision", "reasons", "evidence"];
const DECISIONS = ["merge", "refuse", "manual"];
const MAX_DECISIONS = 50;
// Every merge grant written from a standing authorization starts with this.
// dev-gate-check keeps its own copy of the prefix; keep the two equal.
const GRANT_REASON_PREFIX = "standing-merge-authorization:";
const OBSERVATION_MAX_AGE_MS = 5 * 60 * 1000;
const OBSERVATION_MAX_FUTURE_MS = 30 * 1000;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
// Read after Markdown formatting is stripped from the line: a key of exactly
// "Merge" whose value starts with "manual". Anything after the value, such as
// a note in brackets, still turns standing authorization off. The value may
// sit inside quotes, brackets or parentheses.
// "manual", "manually" and "manual-only" all qualify; \s also covers a
// non-breaking space pasted from rich text.
const MERGE_MANUAL_SETTING = /^merge\s*[:|]\s*(?:["'\u2018\u2019\u201c\u201d([{<]\s*)*manual/i;
const INSTRUCTION_FILES = ["instructions.md", "instructions.local.md"];
const MAX_INSTRUCTIONS_BYTES = 1024 * 1024;
const SKIPPABLE_GATES = new Set(["tdd", "design-critique", "qa"]);

// Reasons that mean the standing authorization does not apply. Ship then
// behaves exactly as it did before standing authorization existed.
const MANUAL_REASONS = new Set([
  "no-approved-proposal",
  "no-standing-authorization",
  "authorization-declined",
  "authorization-revoked",
  "project-merge-manual",
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isIso(value) {
  return typeof value === "string" && ISO.test(value) && !Number.isNaN(Date.parse(value));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function closedIssues(value, fields, at) {
  const issues = [];
  const allowed = new Set(fields);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) issues.push(`${at}.${key} is not allowed`);
  for (const key of fields) if (!Object.hasOwn(value, key)) issues.push(`${at}.${key} is required`);
  return issues;
}

// ---------------------------------------------------------------------------
// The record written at grooming approval.

function buildMergeAuthorization(input = {}) {
  const record = {
    schema_version: 1,
    kind: RECORD_KIND,
    status: input.status,
    basis: input.basis,
    scope: RECORD_SCOPE,
    groom_run_id: input.groomRunId,
    proposal_id: input.proposalId,
    revision: input.revision,
    content_sha256: input.contentSha256,
    approved_by: typeof input.approvedBy === "string" ? input.approvedBy.trim() : input.approvedBy,
    approved_at: input.approvedAt,
  };
  const complete = Object.freeze({ ...record, record_sha256: sha256(canonical(record)) });
  const issues = mergeAuthorizationIssues(complete);
  if (issues.length) throw new Error(`invalid merge authorization: ${issues.join("; ")}`);
  return complete;
}

function mergeAuthorizationIssues(record, at = "merge_authorization") {
  if (!isObject(record)) return [`${at} must be an object`];
  const issues = closedIssues(record, RECORD_FIELDS, at);
  if (record.schema_version !== 1) issues.push(`${at}.schema_version must equal 1`);
  if (record.kind !== RECORD_KIND) issues.push(`${at}.kind must equal ${RECORD_KIND}`);
  if (!Object.hasOwn(BASES, record.status)) issues.push(`${at}.status must be granted or declined`);
  else if (!BASES[record.status].includes(record.basis))
    issues.push(`${at}.basis must be one of ${BASES[record.status].join(", ")}`);
  if (record.scope !== RECORD_SCOPE) issues.push(`${at}.scope must equal ${RECORD_SCOPE}`);
  if (!/^groom_[A-Za-z0-9_-]+$/.test(record.groom_run_id || ""))
    issues.push(`${at}.groom_run_id must name the Groom run`);
  if (!text(record.proposal_id)) issues.push(`${at}.proposal_id is required`);
  if (!Number.isInteger(record.revision) || record.revision < 1)
    issues.push(`${at}.revision must be a positive integer`);
  if (!SHA256.test(record.content_sha256 || "")) issues.push(`${at}.content_sha256 must be sha256`);
  if (!text(record.approved_by)) issues.push(`${at}.approved_by must name the approver`);
  if (!isIso(record.approved_at)) issues.push(`${at}.approved_at must be an ISO-8601 UTC time`);
  if (issues.length === 0) {
    const { record_sha256: digest, ...body } = record;
    if (digest !== sha256(canonical(body))) issues.push(`${at}.record_sha256 does not match`);
  }
  return issues;
}

function assertMergeAuthorization(record) {
  const issues = mergeAuthorizationIssues(record);
  if (issues.length) throw new Error(issues.join("; "));
  return record;
}

// ---------------------------------------------------------------------------
// The project setting. `Merge: manual` on its own line in the project's PM
// instructions turns standing authorization off. Either file can turn it off.
// Without a PM directory the instructions cannot be read, so the setting is
// manual: an unknown setting never grants anything.

const UNKNOWN_PM_DIR_REASON =
  "the PM directory cannot be determined from the proposal path (expected {pm_dir}/backlog/proposals/{slug}.json), so the project's PM instructions cannot be read";

function readProjectMergeSetting(pmDir) {
  if (!text(pmDir)) return { mode: "manual", source: null, reason: UNKNOWN_PM_DIR_REASON };
  for (const name of INSTRUCTION_FILES) {
    const file = path.join(pmDir, name);
    let bytes;
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_INSTRUCTIONS_BYTES)
        // An unreadable setting must not grant anything.
        return { mode: "manual", source: file, reason: "instructions file is too large to read" };
      bytes = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") continue;
      return { mode: "manual", source: file, reason: `cannot read: ${error.message}` };
    }
    if (bytes.split(/\r?\n/).some(isMergeManualLine)) return { mode: "manual", source: file };
  }
  return { mode: "auto", source: null };
}

// Strip what Markdown wraps a setting in: quote and heading marks, list
// bullets, task-list checkboxes, table pipes, emphasis and code spans.
function isMergeManualLine(line) {
  const plain = line
    .replace(/^[\s>#]*/, "")
    .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\[[ xX]\]\s+/, "")
    .replace(/^\|\s*/, "")
    .replace(/[*_`]/g, "")
    .trim();
  return MERGE_MANUAL_SETTING.test(plain);
}

// A canonical proposal lives at {pm_dir}/backlog/proposals/{slug}.json.
function pmDirForProposal(proposalPath) {
  if (!text(proposalPath)) return null;
  const proposals = path.dirname(proposalPath);
  const backlog = path.dirname(proposals);
  if (path.basename(proposals) !== "proposals" || path.basename(backlog) !== "backlog") return null;
  return path.dirname(backlog);
}

// ---------------------------------------------------------------------------
// The Dev session ledger.

function buildSessionLedger(record, proposal) {
  assertMergeAuthorization(record);
  const ledger = {
    schema_version: 1,
    proposal: {
      path: proposal.path,
      proposal_id: proposal.proposal_id,
      slug: proposal.slug,
      revision: proposal.revision,
      content_sha256: proposal.content_sha256,
      decision_id: proposal.decision_id,
    },
    record: structuredClone(record),
    revoked: null,
    decisions: [],
  };
  const issues = ledgerIssues(ledger);
  if (issues.length) throw new Error(`invalid merge authorization ledger: ${issues.join("; ")}`);
  return ledger;
}

function ledgerIssues(ledger, at = "$.merge_authorization") {
  if (!isObject(ledger)) return [`${at} must be an object`];
  const issues = closedIssues(ledger, LEDGER_FIELDS, at);
  if (ledger.schema_version !== 1) issues.push(`${at}.schema_version must equal 1`);
  const proposal = ledger.proposal;
  if (!isObject(proposal)) issues.push(`${at}.proposal must be an object`);
  else {
    issues.push(...closedIssues(proposal, LEDGER_PROPOSAL_FIELDS, `${at}.proposal`));
    if (!text(proposal.path) || !path.isAbsolute(proposal.path))
      issues.push(`${at}.proposal.path must be absolute`);
    for (const field of ["proposal_id", "slug", "decision_id"])
      if (!text(proposal[field])) issues.push(`${at}.proposal.${field} is required`);
    if (!Number.isInteger(proposal.revision) || proposal.revision < 1)
      issues.push(`${at}.proposal.revision must be a positive integer`);
    if (!SHA256.test(proposal.content_sha256 || ""))
      issues.push(`${at}.proposal.content_sha256 must be sha256`);
  }
  issues.push(...mergeAuthorizationIssues(ledger.record, `${at}.record`));
  if (isObject(proposal) && isObject(ledger.record)) {
    if (
      ledger.record.proposal_id !== proposal.proposal_id ||
      ledger.record.revision !== proposal.revision ||
      ledger.record.content_sha256 !== proposal.content_sha256
    )
      issues.push(`${at}.record must bind the same proposal identity`);
  }
  if (ledger.revoked !== null) {
    if (!isObject(ledger.revoked)) issues.push(`${at}.revoked must be null or an object`);
    else {
      const { cleared_authority: cleared, ...revoked } = ledger.revoked;
      issues.push(...closedIssues(revoked, ["revoked_at", "reason"], `${at}.revoked`));
      if (
        cleared !== undefined &&
        (!Array.isArray(cleared) || cleared.length !== 1 || cleared[0] !== "merge")
      )
        issues.push(`${at}.revoked.cleared_authority must list only merge`);
      if (!isIso(ledger.revoked.revoked_at))
        issues.push(`${at}.revoked.revoked_at must be an ISO-8601 time`);
      if (!text(ledger.revoked.reason)) issues.push(`${at}.revoked.reason is required`);
    }
  }
  if (!Array.isArray(ledger.decisions)) issues.push(`${at}.decisions must be an array`);
  else {
    if (ledger.decisions.length > MAX_DECISIONS)
      issues.push(`${at}.decisions keeps at most ${MAX_DECISIONS} entries`);
    ledger.decisions.forEach((entry, index) => {
      const where = `${at}.decisions[${index}]`;
      if (!isObject(entry)) {
        issues.push(`${where} must be an object`);
        return;
      }
      issues.push(...closedIssues(entry, DECISION_FIELDS, where));
      if (!isIso(entry.decided_at)) issues.push(`${where}.decided_at must be an ISO-8601 time`);
      if (!COMMIT.test(entry.commit || "")) issues.push(`${where}.commit must be a full commit`);
      if (!DECISIONS.includes(entry.decision))
        issues.push(`${where}.decision must be merge, refuse or manual`);
      if (
        !Array.isArray(entry.reasons) ||
        entry.reasons.some(
          (reason) => !isObject(reason) || !text(reason.code) || !text(reason.message)
        )
      )
        issues.push(`${where}.reasons must list {code, message}`);
      else if ((entry.decision === "merge") !== (entry.reasons.length === 0))
        issues.push(`${where}: a merge has no reasons and every refusal has one`);
      if (!isObject(entry.evidence)) issues.push(`${where}.evidence must be an object`);
    });
  }
  return issues;
}

// Called from the Dev session validator. Sessions without a ledger stay valid.
function validateSessionMergeAuthorization(session, errors, issue) {
  if (!isObject(session) || session.merge_authorization === undefined) return;
  const ledger = session.merge_authorization;
  for (const message of ledgerIssues(ledger)) {
    const split = message.indexOf(" ");
    errors.push(issue(message.slice(0, split), message.slice(split + 1)));
  }
  if (!isObject(ledger) || !isObject(ledger.proposal)) return;
  const bound = session.task?.proposal;
  if (isObject(bound)) {
    for (const field of [
      "path",
      "proposal_id",
      "slug",
      "revision",
      "content_sha256",
      "decision_id",
    ])
      if (bound[field] !== ledger.proposal[field])
        errors.push(
          issue(`$.merge_authorization.proposal.${field}`, "must equal the bound task.proposal")
        );
  } else if (!isObject(session.task?.rfc_sidecar)) {
    errors.push(
      issue(
        "$.merge_authorization",
        "needs a bound approved proposal or an RFC sidecar derived from one"
      )
    );
  }
}

function standingGrantReason(ledger, commit) {
  return `${GRANT_REASON_PREFIX} ${ledger.record.record_sha256} approved by ${ledger.record.approved_by} at ${ledger.record.approved_at} for proposal ${ledger.proposal.proposal_id} r${ledger.proposal.revision}; merge-check passed at ${commit}`;
}

function standingDeliveryReason(ledger) {
  return `${GRANT_REASON_PREFIX} ${ledger.record.record_sha256} approved by ${ledger.record.approved_by} at ${ledger.record.approved_at} for proposal ${ledger.proposal.proposal_id} r${ledger.proposal.revision}; push and PR toward a checked merge`;
}

// ---------------------------------------------------------------------------
// The merge decision.

function reason(code, message) {
  return { code, message, class: MANUAL_REASONS.has(code) ? "manual" : "refuse" };
}

// Whether a standing authorization applies at all, before any merge condition.
function authorizationReasons({ session, projectSetting, approval, approvalError }) {
  const reasons = [];
  const ledger = session?.merge_authorization;
  if (!isObject(ledger)) {
    if (!isObject(session?.task?.proposal) && !isObject(session?.task?.rfc_sidecar))
      reasons.push(
        reason(
          "no-approved-proposal",
          "this session has no approved groomed proposal; merging needs today's confirmation"
        )
      );
    else
      reasons.push(
        reason(
          "no-standing-authorization",
          "the approved proposal carries no standing merge authorization"
        )
      );
    return reasons;
  }
  const issues = ledgerIssues(ledger);
  if (issues.length) {
    reasons.push(reason("authorization-invalid", issues.slice(0, 3).join("; ")));
    return reasons;
  }
  if (ledger.record.status === "declined")
    reasons.push(
      reason(
        "authorization-declined",
        ledger.record.basis === "project-merge-manual"
          ? "the project had Merge: manual when the proposal was approved"
          : "the approver declined standing merge authorization for this proposal"
      )
    );
  if (ledger.revoked)
    reasons.push(
      reason(
        "authorization-revoked",
        `revoked at ${ledger.revoked.revoked_at}: ${ledger.revoked.reason}`
      )
    );
  if (projectSetting?.mode === "manual")
    reasons.push(
      reason(
        "project-merge-manual",
        projectSetting.source
          ? `the project's PM instructions turn standing merge authorization off (${projectSetting.source}${
              projectSetting.reason ? `: ${projectSetting.reason}` : ""
            })`
          : `standing merge authorization is off: ${projectSetting.reason || "the project setting cannot be read"}`
      )
    );
  const bound = session.task?.proposal;
  if (
    isObject(bound) &&
    ["path", "proposal_id", "slug", "revision", "content_sha256", "decision_id"].some(
      (field) => bound[field] !== ledger.proposal[field]
    )
  )
    reasons.push(
      reason(
        "authorization-proposal-mismatch",
        "the authorization is bound to a different proposal than this session"
      )
    );
  if (approvalError || !isObject(approval))
    reasons.push(
      reason(
        "authorization-approval-mismatch",
        `the proposal's approval audit cannot be read: ${approvalError || "missing"}`
      )
    );
  else if (
    approval.decision_id !== ledger.proposal.decision_id ||
    approval.proposal_id !== ledger.proposal.proposal_id ||
    approval.revision !== ledger.proposal.revision ||
    canonical(approval.merge_authorization ?? null) !== canonical(ledger.record)
  )
    reasons.push(
      reason(
        "authorization-approval-mismatch",
        "the proposal's approval audit does not carry this authorization"
      )
    );
  return reasons;
}

function sessionReasons(session) {
  const reasons = [];
  const blockers = Array.isArray(session?.blockers) ? session.blockers : [];
  if (blockers.some((blocker) => blocker?.code === "design-director-parked"))
    reasons.push(reason("session-parked", "the Design Director parked this work"));
  const open = blockers.filter((blocker) => isObject(blocker) && !blocker.resolved_at);
  if (open.some((blocker) => blocker.code === "design-director-mechanical"))
    reasons.push(
      reason("mechanically-blocked", "the director path's mechanical checks blocked this work")
    );
  const other = open.filter(
    (blocker) => !["design-director-parked", "design-director-mechanical"].includes(blocker.code)
  );
  if (other.length)
    reasons.push(
      reason(
        "open-blocker",
        `open blocker: ${other.map((blocker) => blocker.code || blocker.reason).join(", ")}`
      )
    );
  if (session?.status === "blocked" && reasons.length === 0)
    reasons.push(reason("session-blocked", "the session is blocked"));
  const atShip =
    session?.phase === "ship" &&
    (session.status === "active" ||
      (session.status === "handoff" && session.execution?.mode === "headless"));
  if (!atShip && session?.status !== "blocked")
    reasons.push(
      reason(
        "session-not-at-ship",
        `the session is ${session?.status || "unknown"} at ${session?.phase || "unknown"}, not at Ship`
      )
    );
  return reasons;
}

function gateRows(manifest) {
  const rows = new Map();
  if (isObject(manifest) && Array.isArray(manifest.gates))
    for (const row of manifest.gates) if (isObject(row) && text(row.name)) rows.set(row.name, row);
  return rows;
}

function gateReasons({ session, commit, gates, gateCheck, directorCheck, mechanical }) {
  const reasons = [];
  const required = Array.isArray(session?.routing?.required_gates)
    ? session.routing.required_gates
    : [];
  if (!isObject(gates)) {
    reasons.push(reason("gates-missing", "the session's gates.json cannot be read"));
    return reasons;
  }
  if (gates.run_id !== session?.run_id)
    reasons.push(reason("gates-session-mismatch", "gates.json belongs to another run"));
  const rows = gateRows(gates);
  for (const name of required) {
    const row = rows.get(name);
    if (!row) {
      reasons.push(reason("gate-missing", `${name} has no recorded result`));
      continue;
    }
    if (row.status === "skipped" && !SKIPPABLE_GATES.has(name)) {
      reasons.push(reason("gate-not-passed", `${name} was skipped and cannot be`));
      continue;
    }
    if (!["passed", "skipped"].includes(row.status)) {
      reasons.push(reason("gate-not-passed", `${name} is ${row.status || "unrecorded"}`));
      continue;
    }
    if (row.commit !== commit && row.verified_commit !== commit)
      reasons.push(
        reason(
          "gate-stale",
          `${name} ran at ${row.verified_commit || row.commit}, not at ${commit}`
        )
      );
  }
  if (!isObject(gateCheck) || gateCheck.ok !== true) {
    const found = Array.isArray(gateCheck?.issues) ? gateCheck.issues : [];
    reasons.push(
      reason(
        "gate-check-failed",
        found.length
          ? `dev-gate-check: ${found
              .slice(0, 3)
              .map((item) => item.message || String(item))
              .join("; ")}`
          : "dev-gate-check did not pass at this commit"
      )
    );
  }
  const critique = rows.get("design-critique");
  if (required.includes("design-critique") && critique?.status === "passed" && directorCheck) {
    if (directorCheck.ok !== true || directorCheck.verdict !== "approve")
      reasons.push(
        reason(
          "design-director-not-approved",
          directorCheck.ok !== true
            ? `the director report does not check: ${(directorCheck.issues || [])
                .slice(0, 3)
                .map((item) => `${item.path} ${item.message}`)
                .join("; ")}`
            : `the director's verdict is ${directorCheck.verdict}`
        )
      );
    if (!isObject(mechanical) || mechanical.ok !== true)
      reasons.push(
        reason(
          "design-director-mechanical-failed",
          `mechanical checks fail: ${
            (mechanical?.issues || [])
              .slice(0, 3)
              .map((item) => `${item.check}: ${item.message}`)
              .join("; ") || "no result"
          }`
        )
      );
  }
  return reasons;
}

function prReasons({ session, commit, observation, deliveryContract, releaseTransaction, now }) {
  const reasons = [];
  if (!isObject(observation)) {
    reasons.push(reason("observation-missing", "no PR and CI observation was supplied"));
    return { reasons, ci: null };
  }
  const observedAt = Date.parse(observation.observed_at);
  const at = Date.parse(now);
  if (
    !isIso(observation.observed_at) ||
    at - observedAt > OBSERVATION_MAX_AGE_MS ||
    observedAt - at > OBSERVATION_MAX_FUTURE_MS
  )
    reasons.push(
      reason("observation-stale", "the PR and CI observation must be read within five minutes")
    );
  const defaultBranch = session?.source?.default_branch;
  if (observation.state !== "OPEN")
    reasons.push(reason("pr-not-open", `the PR is ${observation.state || "unknown"}`));
  if (observation.draft !== false) reasons.push(reason("pr-draft", "the PR is a draft"));
  if (
    !text(observation.base) ||
    observation.base !== observation.default_branch ||
    observation.base !== defaultBranch
  )
    reasons.push(
      reason(
        "pr-base-not-default",
        `the PR targets ${observation.base || "unknown"}; the remote default branch is ${
          observation.default_branch || defaultBranch || "unknown"
        }`
      )
    );
  if (observation.mergeable !== "MERGEABLE")
    reasons.push(
      reason("pr-not-mergeable", `GitHub reports mergeable ${observation.mergeable || "unknown"}`)
    );
  if (observation.head_oid !== commit)
    reasons.push(
      reason(
        "pr-head-moved",
        `the PR head is ${observation.head_oid || "unknown"}, not the checked commit ${commit}`
      )
    );
  if (!isObject(deliveryContract))
    reasons.push(reason("delivery-contract-missing", "ship/delivery-contract.json is missing"));
  else {
    if (
      deliveryContract.github_name_with_owner !== observation.repository ||
      deliveryContract.head_branch !== session?.source?.branch
    )
      reasons.push(
        reason("pr-repository-mismatch", "the PR is not the contracted repository and branch")
      );
    if (deliveryContract.base_branch !== observation.base)
      reasons.push(reason("pr-base-not-default", "the PR base differs from the delivery contract"));
  }
  const prepared = releaseTransaction?.release?.prepared_commit;
  if (!COMMIT.test(prepared || ""))
    reasons.push(reason("release-transaction-missing", "ship/release-transaction.json is missing"));
  else if (prepared !== commit)
    reasons.push(
      reason("prepared-commit-mismatch", `the prepared commit is ${prepared}, not ${commit}`)
    );
  const checks = isObject(observation.checks) ? observation.checks : {};
  const ci = summarizeRequiredChecks({
    expectedHead: commit,
    observedHead: observation.head_oid,
    requirementsKnown: checks.requirements_known === true,
    observationComplete: checks.observation_complete === true,
    requiredChecks: Array.isArray(checks.required)
      ? checks.required.map((item) => ({
          name: item?.name,
          appId: item?.app_id ?? null,
          ...(Array.isArray(item?.accepted_conclusions)
            ? { acceptedConclusions: item.accepted_conclusions }
            : {}),
        }))
      : null,
    checks: Array.isArray(checks.runs)
      ? checks.runs.map((item) => ({
          name: item?.name,
          appId: item?.app_id ?? null,
          headSha: item?.head_sha,
          status: item?.status,
          conclusion: item?.conclusion,
        }))
      : null,
  });
  if (ci.status !== "passed")
    reasons.push(
      reason(
        "ci-not-green",
        ci.status === "not-required"
          ? "no required CI checks are configured; an automatic merge needs green required checks"
          : `required CI is ${ci.status}${ci.reason ? `: ${ci.reason}` : ""}`
      )
    );
  return { reasons, ci };
}

function evaluateAutoMerge(input = {}) {
  const now = input.now || new Date().toISOString();
  const session = input.session;
  const commit = input.commit;
  const reasons = [];
  if (!COMMIT.test(commit || ""))
    reasons.push(reason("commit-invalid", "the commit to merge must be a full object ID"));
  reasons.push(...authorizationReasons(input));
  reasons.push(...sessionReasons(session));
  reasons.push(...gateReasons({ ...input, session, commit }));
  const pr = prReasons({ ...input, session, commit, now });
  reasons.push(...pr.reasons);
  const decision = reasons.some((item) => item.class === "manual")
    ? "manual"
    : reasons.length
      ? "refuse"
      : "merge";
  const rows = gateRows(input.gates);
  const ledger = isObject(session?.merge_authorization) ? session.merge_authorization : null;
  return {
    schema: "pm-merge-check",
    schema_version: 1,
    decision,
    may_merge: decision === "merge",
    commit: commit || null,
    decided_at: now,
    reasons,
    evidence: {
      authorization: ledger
        ? {
            record_sha256: ledger.record?.record_sha256 ?? null,
            status: ledger.record?.status ?? null,
            approved_by: ledger.record?.approved_by ?? null,
            approved_at: ledger.record?.approved_at ?? null,
            proposal_id: ledger.proposal?.proposal_id ?? null,
            revision: ledger.proposal?.revision ?? null,
            decision_id: ledger.proposal?.decision_id ?? null,
          }
        : null,
      project_setting: input.projectSetting || null,
      gates: (session?.routing?.required_gates || []).map((name) => {
        const row = rows.get(name);
        return {
          name,
          status: row?.status ?? null,
          commit: row?.commit ?? null,
          verified_commit: row?.verified_commit ?? null,
          artifact: row?.artifact ?? null,
        };
      }),
      design_director: input.directorCheck
        ? {
            report: input.directorReport || null,
            verdict: input.directorCheck.verdict ?? null,
            review: input.directorCheck.review ?? null,
            round: input.directorCheck.round ?? null,
            mechanical: input.mechanical?.ok === true ? "pass" : "fail",
          }
        : null,
      pr: isObject(input.observation)
        ? {
            repository: input.observation.repository ?? null,
            number: input.observation.pr_number ?? null,
            base: input.observation.base ?? null,
            head_oid: input.observation.head_oid ?? null,
            mergeable: input.observation.mergeable ?? null,
            observed_at: input.observation.observed_at ?? null,
          }
        : null,
      ci: pr.ci,
    },
  };
}

// Appends a decision to the session ledger and, only for a merge, grants the
// merge authority Ship's transaction requires. Returns the next session.
function recordMergeDecision(session, result, grantAuthority) {
  const ledger = session.merge_authorization;
  if (!isObject(ledger))
    throw new Error("this session has no standing merge authorization to record against");
  const next = structuredClone(session);
  const entry = {
    decided_at: result.decided_at,
    commit: result.commit,
    decision: result.decision,
    reasons: result.reasons.map(({ code, message }) => ({ code, message })),
    evidence: structuredClone(result.evidence),
  };
  next.merge_authorization.decisions = [...ledger.decisions, entry].slice(-MAX_DECISIONS);
  next.updated_at = result.decided_at;
  if (result.decision !== "merge") return next;
  return grantAuthority(next, ["merge"], standingGrantReason(ledger, result.commit), {
    now: result.decided_at,
  });
}

// Whether every merge grant in the session came from a standing authorization.
// dev-gate-check keeps its own copy of this rule.
function standingMergeOnly(session) {
  const grants = (Array.isArray(session?.authority_log) ? session.authority_log : []).filter(
    (entry) => Array.isArray(entry?.actions) && entry.actions.includes("merge")
  );
  return (
    grants.length > 0 &&
    grants.every(
      (entry) => typeof entry.reason === "string" && entry.reason.startsWith(GRANT_REASON_PREFIX)
    )
  );
}

// Records the revocation once. A merge authority that only the standing
// authorization granted is withdrawn with it, and the revocation lists it in
// `cleared_authority`; a merge grant the user gave themselves is kept.
function revokeMergeAuthorization(session, reasonText, now = new Date().toISOString()) {
  if (!isObject(session.merge_authorization))
    throw new Error("this session has no standing merge authorization");
  if (!text(reasonText)) throw new Error("revocation requires a reason");
  if (session.merge_authorization.revoked) return structuredClone(session);
  const next = structuredClone(session);
  next.merge_authorization.revoked = { revoked_at: now, reason: reasonText.trim() };
  if (next.authority?.merge === true && standingMergeOnly(next)) {
    next.authority.merge = false;
    next.merge_authorization.revoked.cleared_authority = ["merge"];
  }
  next.updated_at = now;
  return next;
}

// The merge decision dev-gate-check requires when a session's only merge
// grant came from a standing authorization.
function latestDecision(session) {
  const decisions = session?.merge_authorization?.decisions;
  return Array.isArray(decisions) && decisions.length ? decisions.at(-1) : null;
}

module.exports = {
  GRANT_REASON_PREFIX,
  MANUAL_REASONS,
  RECORD_KIND,
  RECORD_SCOPE,
  assertMergeAuthorization,
  authorizationReasons,
  buildMergeAuthorization,
  buildSessionLedger,
  canonical,
  evaluateAutoMerge,
  latestDecision,
  ledgerIssues,
  mergeAuthorizationIssues,
  pmDirForProposal,
  readProjectMergeSetting,
  recordMergeDecision,
  revokeMergeAuthorization,
  standingDeliveryReason,
  standingGrantReason,
  standingMergeOnly,
  validateSessionMergeAuthorization,
};
