"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { loadWorkflow, selectWorkflowStep } = require("../step-loader");
const { routeDevWork } = require("./dev-risk");
const { extractSidecarHash, sha256Hex, validateRfcSidecar } = require("../rfc-sidecar-check");
const { analyzeWorkUnits, validateWorkUnitResult, validateWorkUnits } = require("./dev-work-units");

const RUNNER_VERSION = "2.0.0";
const MAX_PHASE_ATTEMPTS = 3;
const PHASES = Object.freeze([
  "intake",
  "workspace",
  "readiness",
  "implementation",
  "design-critique",
  "qa",
  "review",
  "ship",
  "retro",
]);
const SESSION_STATUSES = new Set(["active", "blocked", "complete"]);
const RESULT_STATUSES = new Set(["passed", "failed", "blocked", "noop"]);
const RESULT_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "run_id",
  "phase",
  "attempt",
  "status",
  "summary",
  "commit",
  "files_changed",
  "evidence",
  "blocker",
  "runtime",
]);
const SESSION_TOP_LEVEL_FIELDS = new Set([
  "schema_version",
  "run_id",
  "slug",
  "status",
  "phase",
  "phase_attempt",
  "created_at",
  "updated_at",
  "source",
  "task",
  "execution",
  "authority",
  "authority_log",
  "routing",
  "evidence",
  "attempts",
  "blockers",
  "history",
  "migration",
]);

function resolvePhaseContract(session, options = {}) {
  const pluginRoot = path.resolve(options.pluginRoot || path.join(__dirname, "..", ".."));
  const steps = loadWorkflow("dev", path.join(session.source.repo_root, "pm"), pluginRoot);
  const step = selectWorkflowStep(steps, { phase: session.phase });
  if (!step) throw new Error(`no enabled Dev workflow step for phase ${session.phase}`);
  const bundledRoot = path.join(pluginRoot, "skills", "dev", "steps") + path.sep;
  const instructionPath = step.filePath.startsWith(bundledRoot)
    ? path.relative(pluginRoot, step.filePath)
    : step.filePath;
  return {
    instruction_path: instructionPath,
    required_capabilities: [...step.requiredCapabilities],
    gates: [...step.gates],
    requires_commit: step.requiresCommit,
    required_evidence_kinds: [...step.requiredEvidence],
    allowed_modes:
      step.allowedModes.length > 0 ? [...step.allowedModes] : ["inline", "delegated", "headless"],
    requires: [...step.requires],
    result_schema: step.resultSchema,
  };
}

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isIsoDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isAbsolutePath(value) {
  return typeof value === "string" && path.isAbsolute(value);
}

function validateExactFields(value, allowed, objectPath, errors) {
  if (!isObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(issue(`${objectPath}.${field}`, "unknown field"));
  }
}

function requireField(value, field, objectPath, errors) {
  if (!Object.prototype.hasOwnProperty.call(value, field)) {
    errors.push(issue(`${objectPath}.${field}`, "required field is missing"));
  }
}

function validateSession(session) {
  const errors = [];
  if (!isObject(session)) return [issue("$", "session must be an object")];
  validateExactFields(session, SESSION_TOP_LEVEL_FIELDS, "$", errors);
  for (const field of SESSION_TOP_LEVEL_FIELDS) {
    if (field !== "migration") requireField(session, field, "$", errors);
  }
  if (session.schema_version !== 2) errors.push(issue("$.schema_version", "must equal 2"));
  if (typeof session.run_id !== "string" || !session.run_id.startsWith("dev_")) {
    errors.push(issue("$.run_id", "must be a dev_ run identifier"));
  }
  if (typeof session.slug !== "string" || !/^[a-z0-9][a-z0-9._-]*$/.test(session.slug)) {
    errors.push(issue("$.slug", "must be a normalized lowercase slug"));
  }
  if (!SESSION_STATUSES.has(session.status)) errors.push(issue("$.status", "invalid status"));
  if (!PHASES.includes(session.phase)) errors.push(issue("$.phase", "invalid phase"));
  if (!Number.isInteger(session.phase_attempt) || session.phase_attempt < 1) {
    errors.push(issue("$.phase_attempt", "must be a positive integer"));
  }
  if (!isIsoDate(session.created_at)) errors.push(issue("$.created_at", "must be an ISO date"));
  if (!isIsoDate(session.updated_at)) errors.push(issue("$.updated_at", "must be an ISO date"));
  validateSource(session.source, errors);
  validateTask(session.task, errors);
  validateExecution(session.execution, errors);
  validateAuthority(session.authority, errors);
  validateAuthorityLog(session.authority_log, errors);
  validateRouting(session.routing, errors);
  validateStateEvidence(session.evidence, errors);
  validateAttempts(session.attempts, errors);
  validateBlockers(session.blockers, errors);
  if (Array.isArray(session.history)) validateHistory(session.history, errors);
  if (session.migration !== null && session.migration !== undefined) {
    if (!isObject(session.migration)) {
      errors.push(issue("$.migration", "must be null or an object"));
    } else {
      if (!isAbsolutePath(session.migration.legacy_path)) {
        errors.push(issue("$.migration.legacy_path", "must be an absolute path"));
      }
      if (!isIsoDate(session.migration.migrated_at)) {
        errors.push(issue("$.migration.migrated_at", "must be an ISO date"));
      }
    }
  }
  return errors;
}

function validateSource(source, errors) {
  if (!isObject(source)) {
    errors.push(issue("$.source", "must be an object"));
    return;
  }
  const fields = new Set(["repo_root", "worktree", "branch", "default_branch", "base_commit"]);
  validateExactFields(source, fields, "$.source", errors);
  for (const field of fields) requireField(source, field, "$.source", errors);
  for (const field of ["repo_root", "worktree"]) {
    if (!isAbsolutePath(source[field])) errors.push(issue(`$.source.${field}`, "must be absolute"));
  }
  for (const field of ["branch", "default_branch", "base_commit"]) {
    if (typeof source[field] !== "string" || !source[field]) {
      errors.push(issue(`$.source.${field}`, "must be a non-empty string"));
    }
  }
}

function validateTask(task, errors) {
  if (!isObject(task)) {
    errors.push(issue("$.task", "must be an object"));
    return;
  }
  const fields = new Set([
    "reference",
    "kind",
    "size",
    "risk",
    "risk_tier",
    "acceptance_criteria",
    "work_units",
  ]);
  validateExactFields(task, fields, "$.task", errors);
  for (const field of fields) requireField(task, field, "$.task", errors);
  if (task.reference !== null && typeof task.reference !== "string") {
    errors.push(issue("$.task.reference", "must be null or a string"));
  }
  if (typeof task.kind !== "string" || !task.kind) errors.push(issue("$.task.kind", "required"));
  if (!new Set(["XS", "S", "M", "L", "XL", "unknown"]).has(task.size)) {
    errors.push(issue("$.task.size", "invalid size"));
  }
  validateRisk(task.risk, errors);
  if (typeof task.risk_tier !== "string" || !task.risk_tier) {
    errors.push(issue("$.task.risk_tier", "must be a non-empty string"));
  }
  if (!Array.isArray(task.acceptance_criteria)) {
    errors.push(issue("$.task.acceptance_criteria", "must be an array"));
  } else if (task.acceptance_criteria.some((item) => typeof item !== "string")) {
    errors.push(issue("$.task.acceptance_criteria", "entries must be strings"));
  }
  if (!Array.isArray(task.work_units)) {
    errors.push(issue("$.task.work_units", "must be an array"));
  } else if (task.work_units.some((item) => !isObject(item))) {
    errors.push(issue("$.task.work_units", "entries must be objects"));
  }
}

function validateRisk(risk, errors) {
  const fields = new Set([
    "behavioral",
    "security",
    "auth",
    "data",
    "destructive_data",
    "external_contract",
    "operational",
    "ui",
    "reversibility",
    "cross_module",
  ]);
  if (!isObject(risk)) {
    errors.push(issue("$.task.risk", "must be an object"));
    return;
  }
  validateExactFields(risk, fields, "$.task.risk", errors);
  for (const field of fields) {
    requireField(risk, field, "$.task.risk", errors);
    if (field === "destructive_data") {
      if (typeof risk[field] !== "boolean") {
        errors.push(issue(`$.task.risk.${field}`, "must be boolean"));
      }
    } else if (!Number.isInteger(risk[field]) || risk[field] < 0 || risk[field] > 3) {
      errors.push(issue(`$.task.risk.${field}`, "must be an integer from 0 to 3"));
    }
  }
}

function validateExecution(execution, errors) {
  if (!isObject(execution)) {
    errors.push(issue("$.execution", "must be an object"));
    return;
  }
  const fields = new Set([
    "profile",
    "runtime",
    "model",
    "reasoning",
    "mode",
    "runtime_session_id",
  ]);
  validateExactFields(execution, fields, "$.execution", errors);
  for (const field of fields) requireField(execution, field, "$.execution", errors);
  for (const field of ["profile", "runtime", "model", "reasoning"]) {
    if (typeof execution[field] !== "string" || !execution[field]) {
      errors.push(issue(`$.execution.${field}`, "must be a non-empty string"));
    }
  }
  if (!new Set(["inline", "delegated", "headless"]).has(execution.mode)) {
    errors.push(issue("$.execution.mode", "invalid execution mode"));
  }
  if (execution.runtime_session_id !== null && typeof execution.runtime_session_id !== "string") {
    errors.push(issue("$.execution.runtime_session_id", "must be null or a string"));
  }
}

function validateAuthority(authority, errors) {
  const fields = new Set([
    "local_writes",
    "commit",
    "push_feature_branch",
    "create_pr",
    "merge",
    "tracker_updates",
  ]);
  if (!isObject(authority)) {
    errors.push(issue("$.authority", "must be an object"));
    return;
  }
  validateExactFields(authority, fields, "$.authority", errors);
  for (const field of fields) {
    requireField(authority, field, "$.authority", errors);
    if (typeof authority[field] !== "boolean") {
      errors.push(issue(`$.authority.${field}`, "must be boolean"));
    }
  }
}

function validateAuthorityLog(log, errors) {
  if (!Array.isArray(log)) {
    errors.push(issue("$.authority_log", "must be an array"));
    return;
  }
  log.forEach((entry, index) => {
    const entryPath = `$.authority_log[${index}]`;
    if (!isObject(entry)) {
      errors.push(issue(entryPath, "must be an object"));
      return;
    }
    const fields = new Set(["actions", "reason", "granted_at"]);
    validateExactFields(entry, fields, entryPath, errors);
    for (const field of fields) requireField(entry, field, entryPath, errors);
    if (!Array.isArray(entry.actions) || entry.actions.length === 0) {
      errors.push(issue(`${entryPath}.actions`, "must be a non-empty array"));
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      errors.push(issue(`${entryPath}.reason`, "must be a non-empty string"));
    }
    if (!isIsoDate(entry.granted_at)) {
      errors.push(issue(`${entryPath}.granted_at`, "must be an ISO date"));
    }
  });
}

function validateRouting(routing, errors) {
  const fields = new Set([
    "required_phases",
    "required_gates",
    "review_mode",
    "decision_version",
    "reasons",
  ]);
  if (!isObject(routing)) {
    errors.push(issue("$.routing", "must be an object"));
    return;
  }
  validateExactFields(routing, fields, "$.routing", errors);
  for (const field of fields) requireField(routing, field, "$.routing", errors);
  if (!Array.isArray(routing.required_phases) || routing.required_phases.length === 0) {
    errors.push(issue("$.routing.required_phases", "must be a non-empty array"));
  } else {
    for (const phase of routing.required_phases) {
      if (!PHASES.includes(phase))
        errors.push(issue("$.routing.required_phases", `invalid phase ${phase}`));
    }
  }
  if (!Array.isArray(routing.required_gates)) {
    errors.push(issue("$.routing.required_gates", "must be an array"));
  }
  if (!new Set(["code-scan", "full"]).has(routing.review_mode)) {
    errors.push(issue("$.routing.review_mode", "must be code-scan or full"));
  }
  if (!Number.isInteger(routing.decision_version) || routing.decision_version < 1) {
    errors.push(issue("$.routing.decision_version", "must be a positive integer"));
  }
  if (!Array.isArray(routing.reasons)) errors.push(issue("$.routing.reasons", "must be an array"));
}

function validateHistory(history, errors) {
  history.forEach((entry, index) => {
    const entryPath = `$.history[${index}]`;
    if (!isObject(entry)) {
      errors.push(issue(entryPath, "must be an object"));
      return;
    }
    const fields = new Set([
      "prior_phase",
      "next_phase",
      "reason",
      "result_hash",
      "timestamp",
      "runner_version",
    ]);
    validateExactFields(entry, fields, entryPath, errors);
    for (const field of fields) {
      requireField(entry, field, entryPath, errors);
    }
    if (!PHASES.includes(entry.prior_phase))
      errors.push(issue(`${entryPath}.prior_phase`, "invalid phase"));
    if (!PHASES.includes(entry.next_phase))
      errors.push(issue(`${entryPath}.next_phase`, "invalid phase"));
    if (typeof entry.reason !== "string" || !entry.reason)
      errors.push(issue(`${entryPath}.reason`, "required"));
    if (typeof entry.result_hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.result_hash)) {
      errors.push(issue(`${entryPath}.result_hash`, "must be a SHA-256 result hash"));
    }
    if (!isIsoDate(entry.timestamp))
      errors.push(issue(`${entryPath}.timestamp`, "must be an ISO date"));
  });
}

function validateStateEvidence(evidence, errors) {
  if (!isObject(evidence)) {
    errors.push(issue("$.evidence", "must be an object"));
    return;
  }
  for (const [phase, evidenceSet] of Object.entries(evidence)) {
    const evidencePath = `$.evidence.${phase}`;
    if (!PHASES.includes(phase)) errors.push(issue(evidencePath, "unknown evidence phase"));
    if (!isObject(evidenceSet)) {
      errors.push(issue(evidencePath, "must be an object"));
      continue;
    }
    const fields = new Set([
      "commit",
      "records",
      "recorded_at",
      "verified_commit",
      "verified_at",
      "verification_records",
    ]);
    validateExactFields(evidenceSet, fields, evidencePath, errors);
    for (const field of ["commit", "records", "recorded_at"]) {
      requireField(evidenceSet, field, evidencePath, errors);
    }
    if (
      evidenceSet.commit !== null &&
      (typeof evidenceSet.commit !== "string" || !evidenceSet.commit)
    ) {
      errors.push(issue(`${evidencePath}.commit`, "must be null or a commit string"));
    }
    if (!Array.isArray(evidenceSet.records)) {
      errors.push(issue(`${evidencePath}.records`, "must be an array"));
    } else {
      evidenceSet.records.forEach((record, index) =>
        validateEvidenceRecord(record, index, errors, `${evidencePath}.records`)
      );
    }
    if (!isIsoDate(evidenceSet.recorded_at)) {
      errors.push(issue(`${evidencePath}.recorded_at`, "must be an ISO date"));
    }
    const hasVerifiedCommit = Object.prototype.hasOwnProperty.call(evidenceSet, "verified_commit");
    const hasVerifiedAt = Object.prototype.hasOwnProperty.call(evidenceSet, "verified_at");
    if (hasVerifiedCommit !== hasVerifiedAt) {
      errors.push(issue(evidencePath, "verified_commit and verified_at must be written together"));
    } else if (hasVerifiedCommit) {
      if (typeof evidenceSet.verified_commit !== "string" || !evidenceSet.verified_commit) {
        errors.push(issue(`${evidencePath}.verified_commit`, "must be a commit string"));
      }
      if (!isIsoDate(evidenceSet.verified_at)) {
        errors.push(issue(`${evidencePath}.verified_at`, "must be an ISO date"));
      }
      if (
        !Array.isArray(evidenceSet.verification_records) ||
        evidenceSet.verification_records.length === 0
      ) {
        errors.push(
          issue(`${evidencePath}.verification_records`, "must contain fresh passing evidence")
        );
      } else {
        evidenceSet.verification_records.forEach((record, index) =>
          validateEvidenceRecord(record, index, errors, `${evidencePath}.verification_records`)
        );
      }
    }
  }
}

function validateAttempts(attempts, errors) {
  if (!Array.isArray(attempts)) {
    errors.push(issue("$.attempts", "must be an array"));
    return;
  }
  attempts.forEach((attempt, index) => {
    const attemptPath = `$.attempts[${index}]`;
    if (!isObject(attempt)) {
      errors.push(issue(attemptPath, "must be an object"));
      return;
    }
    const fields = new Set([
      "phase",
      "attempt",
      "status",
      "summary",
      "commit",
      "recorded_at",
      "runtime",
    ]);
    validateExactFields(attempt, fields, attemptPath, errors);
    for (const field of fields) requireField(attempt, field, attemptPath, errors);
    if (!PHASES.includes(attempt.phase))
      errors.push(issue(`${attemptPath}.phase`, "invalid phase"));
    if (!Number.isInteger(attempt.attempt) || attempt.attempt < 1) {
      errors.push(issue(`${attemptPath}.attempt`, "must be a positive integer"));
    }
    if (!RESULT_STATUSES.has(attempt.status))
      errors.push(issue(`${attemptPath}.status`, "invalid status"));
    if (typeof attempt.summary !== "string" || !attempt.summary)
      errors.push(issue(`${attemptPath}.summary`, "required"));
    if (!isIsoDate(attempt.recorded_at))
      errors.push(issue(`${attemptPath}.recorded_at`, "must be an ISO date"));
    validateResultRuntime(attempt.runtime, errors, `${attemptPath}.runtime`);
  });
}

function validateBlockers(blockers, errors) {
  if (!Array.isArray(blockers)) {
    errors.push(issue("$.blockers", "must be an array"));
    return;
  }
  blockers.forEach((blocker, index) => {
    const blockerPath = `$.blockers[${index}]`;
    if (!isObject(blocker)) {
      errors.push(issue(blockerPath, "must be an object"));
      return;
    }
    for (const field of ["code", "reason", "phase", "recorded_at"]) {
      requireField(blocker, field, blockerPath, errors);
    }
    if (typeof blocker.code !== "string" || !blocker.code)
      errors.push(issue(`${blockerPath}.code`, "required"));
    if (typeof blocker.reason !== "string" || !blocker.reason)
      errors.push(issue(`${blockerPath}.reason`, "required"));
    if (!PHASES.includes(blocker.phase))
      errors.push(issue(`${blockerPath}.phase`, "invalid phase"));
    if (!isIsoDate(blocker.recorded_at))
      errors.push(issue(`${blockerPath}.recorded_at`, "must be an ISO date"));
    const hasResolvedAt = Object.prototype.hasOwnProperty.call(blocker, "resolved_at");
    const hasResolution = Object.prototype.hasOwnProperty.call(blocker, "resolution");
    if (hasResolvedAt !== hasResolution) {
      errors.push(issue(blockerPath, "resolved_at and resolution must be written together"));
    } else if (hasResolvedAt) {
      if (!isIsoDate(blocker.resolved_at)) {
        errors.push(issue(`${blockerPath}.resolved_at`, "must be an ISO date"));
      }
      if (typeof blocker.resolution !== "string" || !blocker.resolution.trim()) {
        errors.push(issue(`${blockerPath}.resolution`, "must be a non-empty string"));
      }
    }
  });
}

function validateResultEnvelope(result) {
  const errors = [];
  if (!isObject(result)) return [issue("$", "result must be an object")];
  validateExactFields(result, RESULT_TOP_LEVEL_FIELDS, "$", errors);
  for (const field of RESULT_TOP_LEVEL_FIELDS) requireField(result, field, "$", errors);
  if (result.schema_version !== 1) errors.push(issue("$.schema_version", "must equal 1"));
  if (typeof result.run_id !== "string" || !result.run_id)
    errors.push(issue("$.run_id", "required"));
  if (!PHASES.includes(result.phase)) errors.push(issue("$.phase", "invalid phase"));
  if (!Number.isInteger(result.attempt) || result.attempt < 1) {
    errors.push(issue("$.attempt", "must be a positive integer"));
  }
  if (!RESULT_STATUSES.has(result.status)) errors.push(issue("$.status", "invalid status"));
  if (typeof result.summary !== "string" || !result.summary.trim()) {
    errors.push(issue("$.summary", "must be a non-empty string"));
  }
  if (result.commit !== null && (typeof result.commit !== "string" || !result.commit)) {
    errors.push(issue("$.commit", "must be null or a commit string"));
  }
  if (!Array.isArray(result.files_changed)) {
    errors.push(issue("$.files_changed", "must be an array"));
  } else if (result.files_changed.some((file) => typeof file !== "string" || !file)) {
    errors.push(issue("$.files_changed", "entries must be non-empty strings"));
  }
  if (!Array.isArray(result.evidence)) {
    errors.push(issue("$.evidence", "must be an array"));
  } else {
    result.evidence.forEach((record, index) => validateEvidenceRecord(record, index, errors));
  }
  if (result.status === "blocked") {
    if (!isObject(result.blocker) || !result.blocker.code || !result.blocker.reason) {
      errors.push(issue("$.blocker", "blocked results require code and reason"));
    }
  } else if (result.blocker !== null) {
    errors.push(issue("$.blocker", "must be null unless status is blocked"));
  }
  validateResultRuntime(result.runtime, errors);
  return errors;
}

function validateEvidenceRecord(record, index, errors, basePath = "$.evidence") {
  const recordPath = `${basePath}[${index}]`;
  if (!isObject(record)) {
    errors.push(issue(recordPath, "must be an object"));
    return;
  }
  const fields = new Set(["kind", "command", "exit_code", "artifact"]);
  validateExactFields(record, fields, recordPath, errors);
  for (const field of fields) {
    requireField(record, field, recordPath, errors);
  }
  if (typeof record.kind !== "string" || !record.kind)
    errors.push(issue(`${recordPath}.kind`, "required"));
  if (record.command !== null && typeof record.command !== "string") {
    errors.push(issue(`${recordPath}.command`, "must be null or a string"));
  }
  if (!Number.isInteger(record.exit_code))
    errors.push(issue(`${recordPath}.exit_code`, "must be integer"));
  if (record.artifact !== null && typeof record.artifact !== "string") {
    errors.push(issue(`${recordPath}.artifact`, "must be null or a string"));
  }
}

function validateResultRuntime(runtime, errors, runtimePath = "$.runtime") {
  if (!isObject(runtime)) {
    errors.push(issue(runtimePath, "must be an object"));
    return;
  }
  const fields = new Set(["provider", "model", "reasoning", "session_id"]);
  validateExactFields(runtime, fields, runtimePath, errors);
  for (const field of ["provider", "model", "reasoning"]) {
    requireField(runtime, field, runtimePath, errors);
  }
  for (const field of ["provider", "model", "reasoning"]) {
    if (typeof runtime[field] !== "string" || !runtime[field]) {
      errors.push(issue(`${runtimePath}.${field}`, "must be a non-empty string"));
    }
  }
  if (
    runtime.session_id !== undefined &&
    runtime.session_id !== null &&
    typeof runtime.session_id !== "string"
  ) {
    errors.push(issue(`${runtimePath}.session_id`, "must be null or a string"));
  }
}

function validateResult(session, result, options = {}) {
  const errors = [...validateResultEnvelope(result)];
  if (!isObject(session) || !isObject(result)) return errors;
  if (result.run_id !== session.run_id)
    errors.push(issue("$.run_id", "does not match session run_id"));
  if (result.phase !== session.phase) errors.push(issue("$.phase", "does not match session phase"));
  if (result.attempt !== session.phase_attempt) {
    errors.push(issue("$.attempt", "does not match session phase_attempt"));
  }
  if (session.status !== "active")
    errors.push(issue("$.status", `session is ${session.status}, not active`));

  const metadata = resolvePhaseContract(session, options);
  if (result.status === "noop") {
    errors.push(
      issue("$.status", `${session.phase} cannot use noop; omit optional phases in routing`)
    );
  }
  if (result.status === "passed") {
    if (metadata?.requires_commit && !result.commit) {
      errors.push(issue("$.commit", `${session.phase} requires a commit`));
    }
    const requiredEvidenceKinds = metadata.required_evidence_kinds;
    if (requiredEvidenceKinds.length > 0) {
      const records = Array.isArray(result.evidence) ? result.evidence : [];
      const missingKinds = requiredEvidenceKinds.filter(
        (kind) => !records.some((record) => record?.kind === kind && record.exit_code === 0)
      );
      if (missingKinds.length > 0) {
        errors.push(
          issue(
            "$.evidence",
            `${session.phase} requires passing evidence: ${missingKinds.join(", ")}`
          )
        );
      }
      if (records.some((record) => Number.isInteger(record?.exit_code) && record.exit_code !== 0)) {
        errors.push(issue("$.evidence", "passed results cannot contain failing evidence"));
      }
    }
    validatePhaseEvidence(session, result, options, errors);
  }

  if (result.commit) validateCommit(session, result.commit, options, errors);
  return errors;
}

function validatePhaseEvidence(session, result, options, errors) {
  if (session.phase === "readiness") validateReadinessEvidence(session, result, errors);
  if (session.phase === "ship") validateDeliveryEvidence(session, result, options, errors);
}

function evidenceArtifact(result, kind, errors) {
  const record = result.evidence.find(
    (candidate) => candidate?.kind === kind && candidate.exit_code === 0
  );
  if (!record || typeof record.artifact !== "string" || !path.isAbsolute(record.artifact)) {
    errors.push(issue("$.evidence", `${kind} evidence requires an absolute artifact path`));
    return null;
  }
  return record.artifact;
}

function validateReadinessEvidence(session, result, errors) {
  const sidecarPath = evidenceArtifact(result, "rfc-readiness", errors);
  if (!sidecarPath) return;
  const htmlPath = sidecarPath.replace(/\.json$/i, ".html");
  if (htmlPath === sidecarPath) {
    errors.push(issue("$.evidence", "rfc-readiness artifact must be an RFC JSON sidecar"));
    return;
  }
  try {
    const sidecarBytes = fs.readFileSync(sidecarPath);
    const sidecar = JSON.parse(sidecarBytes.toString("utf8"));
    const html = fs.readFileSync(htmlPath, "utf8");
    const validation = validateRfcSidecar(sidecar, sidecarPath, {
      expectedSlug: session.slug,
      htmlPath,
      storedHash: extractSidecarHash(html),
      sidecarHash: `sha256:${sha256Hex(sidecarBytes)}`,
    });
    if (!validation.ok) {
      errors.push(
        issue(
          "$.evidence",
          `RFC readiness artifact is invalid: ${validation.issues.map((entry) => entry.message).join("; ")}`
        )
      );
    }
    const metadata = html.match(/<script[^>]+id=["']rfc-meta["'][^>]*>([\s\S]*?)<\/script>/i);
    const status = metadata ? JSON.parse(metadata[1]).status : null;
    if (String(status).toLowerCase() !== "approved") {
      errors.push(issue("$.evidence", "RFC readiness requires approved lifecycle metadata"));
    }
  } catch (error) {
    errors.push(issue("$.evidence", `could not verify RFC readiness artifact: ${error.message}`));
  }
}

function validateDeliveryEvidence(session, result, options, errors) {
  for (const action of ["push_feature_branch", "create_pr", "merge"]) {
    if (session.authority[action] !== true) {
      errors.push(issue("$.evidence", `ship requires explicit ${action} authority`));
    }
  }
  const receiptPath = evidenceArtifact(result, "delivery", errors);
  if (!receiptPath) return;
  let receipt;
  try {
    receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
  } catch (error) {
    errors.push(issue("$.evidence", `could not read delivery receipt: ${error.message}`));
    return;
  }
  const required = [
    "schema_version",
    "pr_number",
    "pr_url",
    "state",
    "merge_sha",
    "head_branch",
    "feature_commit",
  ];
  if (
    !isObject(receipt) ||
    required.some((field) => !Object.hasOwn(receipt, field)) ||
    Object.keys(receipt).some((field) => !required.includes(field))
  ) {
    errors.push(issue("$.evidence", "delivery receipt is missing required fields"));
    return;
  }
  if (
    receipt.schema_version !== 1 ||
    !Number.isInteger(receipt.pr_number) ||
    receipt.pr_number < 1 ||
    typeof receipt.pr_url !== "string" ||
    !receipt.pr_url.startsWith("https://") ||
    receipt.state !== "MERGED" ||
    receipt.head_branch !== session.source.branch ||
    receipt.feature_commit !== result.commit ||
    typeof receipt.merge_sha !== "string" ||
    !receipt.merge_sha
  ) {
    errors.push(
      issue("$.evidence", "delivery receipt does not match the session and merged state")
    );
    return;
  }
  try {
    const observed = (options.verifyDelivery || defaultVerifyDelivery)(receipt, session);
    if (
      observed.number !== receipt.pr_number ||
      observed.url !== receipt.pr_url ||
      observed.state !== "MERGED" ||
      observed.headRefName !== session.source.branch ||
      observed.mergeCommit?.oid !== receipt.merge_sha
    ) {
      errors.push(
        issue("$.evidence", "delivery receipt does not match observed pull-request state")
      );
    }
  } catch (error) {
    errors.push(
      issue("$.evidence", `could not verify pull-request delivery state: ${error.message}`)
    );
  }
}

function defaultVerifyDelivery(receipt, session) {
  const output = execFileSync(
    "gh",
    ["pr", "view", String(receipt.pr_number), "--json", "number,url,state,mergeCommit,headRefName"],
    {
      cwd: session.source.worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  return JSON.parse(output);
}

function validateCommit(session, commit, options, errors) {
  const isReachable = options.isCommitReachable || defaultCommitReachable;
  const branchHead = options.branchHead || defaultBranchHead;
  try {
    if (!isReachable(session, commit)) {
      errors.push(issue("$.commit", "is not reachable from the session branch"));
      return;
    }
    const current = branchHead(session);
    if (current && current !== commit) {
      errors.push(issue("$.commit", `is stale; current branch head is ${current}`));
    }
  } catch (error) {
    errors.push(issue("$.commit", `could not validate commit: ${error.message}`));
  }
}

function defaultCommitReachable(session, commit) {
  try {
    const currentBranch = runGit(session.source.worktree, ["branch", "--show-current"]);
    if (currentBranch !== session.source.branch) return false;
    runGit(session.source.worktree, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function defaultBranchHead(session) {
  const currentBranch = runGit(session.source.worktree, ["branch", "--show-current"]);
  if (currentBranch !== session.source.branch) {
    throw new Error(
      `worktree branch drift: expected ${session.source.branch}, observed ${currentBranch || "detached"}`
    );
  }
  return runGit(session.source.worktree, ["rev-parse", "HEAD"]);
}

function createSession(options) {
  if (!options || !options.slug || !options.sourceDir) {
    throw new Error("createSession requires slug and sourceDir");
  }
  const sourceDir = path.resolve(options.sourceDir);
  let repoRoot;
  try {
    repoRoot = path.resolve(runGit(sourceDir, ["rev-parse", "--show-toplevel"]));
  } catch {
    throw new Error(`source directory is not a Git worktree: ${sourceDir}`);
  }
  const slug = normalizeSlug(options.slug);
  const now = options.now || new Date().toISOString();
  const branch = gitValue(sourceDir, ["branch", "--show-current"], "detached");
  const head = gitValue(sourceDir, ["rev-parse", "HEAD"], "unknown");
  const defaultBranch = detectDefaultBranch(sourceDir);
  const session = {
    schema_version: 2,
    run_id: options.runId || generateRunId(),
    slug,
    status: "active",
    phase: "intake",
    phase_attempt: 1,
    created_at: now,
    updated_at: now,
    source: {
      repo_root: repoRoot,
      worktree: repoRoot,
      branch,
      default_branch: defaultBranch,
      base_commit: head,
    },
    task: {
      reference: options.task || null,
      kind: options.kind || "unknown",
      size: options.size || "unknown",
      risk: defaultRisk(),
      risk_tier: "unassessed",
      acceptance_criteria: [],
      work_units: [],
    },
    execution: {
      profile: options.profile || "inherit",
      runtime: options.runtime || "inline",
      model: options.model || "inherit",
      reasoning: options.reasoning || "inherit",
      mode: options.mode || "inline",
      runtime_session_id: null,
    },
    authority: {
      local_writes: true,
      commit: true,
      push_feature_branch: false,
      create_pr: false,
      merge: false,
      tracker_updates: false,
    },
    authority_log: [],
    routing: {
      required_phases: [...PHASES],
      required_gates: ["tdd", "review", "verification"],
      review_mode: "full",
      decision_version: 1,
      reasons: ["Compatibility route until intake records observed risk"],
    },
    evidence: {},
    attempts: [],
    blockers: [],
    history: [],
    migration: null,
  };
  assertValidSession(session);
  return session;
}

function applyRouting(session, facts, options = {}) {
  assertValidSession(session);
  if (session.status !== "active" || session.phase !== "intake") {
    throw new Error("routing can only be recorded during an active intake phase");
  }
  const route = routeDevWork(facts);
  const next = structuredClone(session);
  next.task.reference = facts.reference ?? next.task.reference;
  next.task.kind = route.kind;
  next.task.size = route.size;
  next.task.risk = {
    ...route.risk.dimensions,
    destructive_data: route.risk.destructive_data,
  };
  next.task.risk_tier = route.risk_tier;
  if (facts.acceptance_criteria !== undefined) {
    if (!Array.isArray(facts.acceptance_criteria)) {
      throw new TypeError("acceptance_criteria must be an array");
    }
    next.task.acceptance_criteria = structuredClone(facts.acceptance_criteria);
  }
  if (facts.work_units !== undefined) {
    if (!Array.isArray(facts.work_units)) throw new TypeError("work_units must be an array");
    validateWorkUnits(facts.work_units);
    next.task.work_units = structuredClone(facts.work_units);
  }
  next.routing = {
    required_phases: [...route.required_phases],
    required_gates: [...route.required_gates],
    review_mode: route.review_mode,
    decision_version: route.decision_version,
    reasons: [...route.reasons],
  };
  next.updated_at = options.now || new Date().toISOString();
  assertValidSession(next);
  return next;
}

function transitionWorkUnit(session, input, options = {}) {
  assertValidSession(session);
  if (session.status !== "active" || session.phase !== "implementation") {
    throw new Error("work units can only transition during active implementation");
  }
  if (!isObject(input) || typeof input.id !== "string" || !input.id.trim()) {
    throw new TypeError("work-unit transition requires an id");
  }
  const targetStatus = input.status;
  if (!["pending", "running", "completed", "blocked", "failed"].includes(targetStatus)) {
    throw new Error(`invalid work-unit target status: ${String(targetStatus)}`);
  }
  const next = structuredClone(session);
  const unit = next.task.work_units.find((candidate) => candidate.id === input.id);
  if (!unit) throw new Error(`unknown work unit: ${input.id}`);
  const priorStatus = unit.status;
  const allowed = {
    pending: ["running"],
    running: ["completed", "blocked", "failed"],
    blocked: ["pending"],
    failed: ["pending"],
    completed: [],
  };
  if (!allowed[priorStatus].includes(targetStatus)) {
    throw new Error(`invalid work-unit transition: ${priorStatus} -> ${targetStatus}`);
  }

  let result = null;
  if (targetStatus === "running") {
    const analysis = analyzeWorkUnits(next.task.work_units);
    if (!analysis.runnable.some((candidate) => candidate.id === unit.id)) {
      throw new Error(`work unit ${unit.id} is not dependency-ready and ownership-safe`);
    }
    unit.base_commit = runGit(session.source.worktree, ["rev-parse", "HEAD"]);
  } else if (["completed", "blocked", "failed"].includes(targetStatus)) {
    result = validateWorkUnitResult(input.result, {
      expectedWorkUnitId: unit.id,
      expectedOwnership: unit.owns,
      worktree: session.source.worktree,
      baseCommit: input.base_commit || unit.base_commit,
    });
    if (result.status !== targetStatus) {
      throw new Error(
        `work-unit result status mismatch: expected ${targetStatus}, received ${result.status}`
      );
    }
  } else if (typeof input.reason !== "string" || !input.reason.trim()) {
    throw new Error("retrying a blocked or failed work unit requires a reason");
  }

  const timestamp = options.now || new Date().toISOString();
  unit.status = targetStatus;
  unit.result = result ? structuredClone(result) : null;
  unit.updated_at = timestamp;
  unit.transitions = Array.isArray(unit.transitions) ? unit.transitions : [];
  unit.transitions.push({
    from: priorStatus,
    to: targetStatus,
    reason: input.reason?.trim() || result?.summary || "runner transition",
    commit: result?.commit || null,
    recorded_at: timestamp,
  });
  next.updated_at = timestamp;
  assertValidSession(next);
  return next;
}

function recertifyEvidence(session, phases, commit, verificationByPhase, options = {}) {
  assertValidSession(session);
  if (!Array.isArray(phases) || phases.length === 0) {
    throw new TypeError("recertification requires at least one evidence phase");
  }
  if (!isObject(verificationByPhase)) {
    throw new TypeError("recertification requires fresh evidence grouped by phase");
  }
  const commitErrors = [];
  validateCommit(session, commit, options, commitErrors);
  if (commitErrors.length > 0)
    throw validationError("recertification commit is invalid", commitErrors);
  const next = structuredClone(session);
  const timestamp = options.now || new Date().toISOString();
  for (const phase of [...new Set(phases)]) {
    if (!PHASES.includes(phase)) throw new Error(`unknown evidence phase: ${phase}`);
    const evidence = next.evidence[phase];
    if (!evidence?.commit) throw new Error(`cannot recertify missing evidence for ${phase}`);
    const records = verificationByPhase[phase];
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`recertification requires fresh evidence for ${phase}`);
    }
    const recordErrors = [];
    records.forEach((record, index) =>
      validateEvidenceRecord(record, index, recordErrors, `$.verification.${phase}`)
    );
    if (recordErrors.length > 0) {
      throw validationError(`recertification evidence for ${phase} is invalid`, recordErrors);
    }
    if (records.some((record) => record.exit_code !== 0)) {
      throw new Error(`recertification evidence for ${phase} must be passing`);
    }
    const originalKinds = new Set(evidence.records.map((record) => record.kind));
    if (!records.some((record) => originalKinds.has(record.kind))) {
      throw new Error(
        `recertification evidence for ${phase} must recheck an original evidence kind`
      );
    }
    evidence.verified_commit = commit;
    evidence.verified_at = timestamp;
    evidence.verification_records = structuredClone(records);
  }
  next.updated_at = timestamp;
  assertValidSession(next);
  return next;
}

function defaultRisk() {
  return {
    behavioral: 0,
    security: 0,
    auth: 0,
    data: 0,
    destructive_data: false,
    external_contract: 0,
    operational: 0,
    ui: 0,
    reversibility: 0,
    cross_module: 0,
  };
}

function generateRunId() {
  return `dev_${Date.now().toString(36)}${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeSlug(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("slug must contain a letter or number");
  if (slug === "completed") throw new Error('slug "completed" is reserved for archived sessions');
  return slug;
}

function detectDefaultBranch(repoDir) {
  const remoteHead = gitValue(repoDir, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], "");
  if (remoteHead.startsWith("origin/")) return remoteHead.slice("origin/".length);
  for (const candidate of ["main", "master"]) {
    try {
      runGit(repoDir, ["show-ref", "--verify", `refs/heads/${candidate}`]);
      return candidate;
    } catch {
      // Continue to the current branch fallback.
    }
  }
  return gitValue(repoDir, ["branch", "--show-current"], "main");
}

function gitValue(repoDir, args, fallback) {
  try {
    return runGit(repoDir, args);
  } catch {
    return fallback;
  }
}

function runGit(repoDir, args) {
  return execFileSync("git", args, {
    cwd: repoDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertValidSession(session) {
  const errors = validateSession(session);
  if (errors.length > 0) throw validationError("session is invalid", errors);
}

function validationError(message, errors) {
  const error = new Error(
    `${message}: ${errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`
  );
  error.validationErrors = errors;
  return error;
}

function readSession(sessionPath) {
  let session;
  try {
    session = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read session ${sessionPath}: ${error.message}`);
  }
  assertValidSession(session);
  return session;
}

function writeSession(sessionPath, session) {
  assertValidSession(session);
  writeJsonAtomic(sessionPath, session);
}

function writeJsonAtomic(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`
  );
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}

function nextDecision(session, sessionPath = null, options = {}) {
  assertValidSession(session);
  const metadata = resolvePhaseContract(session, options);
  return {
    schema_version: 1,
    run_id: session.run_id,
    session_path: sessionPath ? path.resolve(sessionPath) : null,
    status: session.status,
    phase: session.phase,
    instruction_path: metadata.instruction_path,
    attempt: session.phase_attempt,
    required_capabilities: [...metadata.required_capabilities],
    applicable_gates: metadata.gates.filter((gate) =>
      session.routing.required_gates.includes(gate)
    ),
    required_evidence_kinds: [...metadata.required_evidence_kinds],
    requires_commit: metadata.requires_commit,
    input_paths: [session.task.reference, session.source.worktree].filter(Boolean),
    allowed_modes: session.status === "active" ? [...metadata.allowed_modes] : [],
    requires: [...metadata.requires],
    result_schema: metadata.result_schema,
  };
}

function promptMetadata(session, sessionPath) {
  const decision = nextDecision(session, sessionPath);
  return {
    schema_version: 1,
    run_id: session.run_id,
    phase: session.phase,
    attempt: session.phase_attempt,
    session_path: path.resolve(sessionPath),
    decision,
    context_hooks: {
      phase_instructions: decision.instruction_path,
      project_instructions: ["AGENTS.md", "CLAUDE.md"],
      result_schema: "skills/dev/references/dev-session.schema.json#/$defs/phase_result",
    },
  };
}

function recordResult(session, result, options = {}) {
  const errors = validateResult(session, result, options);
  if (errors.length > 0) throw validationError("result is invalid", errors);
  const next = structuredClone(session);
  const timestamp = options.now || new Date().toISOString();
  const priorPhase = session.phase;
  let nextPhase = priorPhase;
  let reason = `phase ${result.status}`;

  next.attempts.push({
    phase: priorPhase,
    attempt: result.attempt,
    status: result.status,
    summary: result.summary,
    commit: result.commit,
    recorded_at: timestamp,
    runtime: result.runtime,
  });

  if (result.runtime.session_id) {
    next.execution.runtime_session_id = result.runtime.session_id;
    next.execution.runtime = result.runtime.provider;
    next.execution.model = result.runtime.model;
    next.execution.reasoning = result.runtime.reasoning;
  }

  if (result.status === "passed" && result.evidence.length > 0) {
    next.evidence[priorPhase] = {
      commit: result.commit,
      records: structuredClone(result.evidence),
      recorded_at: timestamp,
    };
  }

  if (result.status === "passed" || result.status === "noop") {
    const phases = next.routing.required_phases;
    const currentIndex = phases.indexOf(priorPhase);
    if (currentIndex < 0) throw new Error(`current phase ${priorPhase} is not routed`);
    if (currentIndex === phases.length - 1) {
      assertFinalGates(next, result.commit, options);
      next.status = "complete";
      reason = "all routed phases and final gates completed";
    } else {
      nextPhase = phases[currentIndex + 1];
      next.phase = nextPhase;
      next.phase_attempt = 1;
      reason = `validated ${result.status} result`;
    }
  } else if (result.status === "blocked") {
    next.status = "blocked";
    next.blockers.push({
      ...structuredClone(result.blocker),
      phase: priorPhase,
      recorded_at: timestamp,
    });
    reason = `blocked: ${result.blocker.code}`;
  } else {
    if (next.phase_attempt >= MAX_PHASE_ATTEMPTS) {
      next.status = "blocked";
      next.blockers.push({
        code: "retry-exhausted",
        reason: `${priorPhase} failed ${MAX_PHASE_ATTEMPTS} times`,
        remediation: "Reconcile the repeated root cause before resuming",
        phase: priorPhase,
        recorded_at: timestamp,
      });
      reason = "retry budget exhausted";
    } else {
      next.phase_attempt += 1;
      reason = "validated retry of the same phase";
    }
  }

  next.updated_at = timestamp;
  next.history.push({
    prior_phase: priorPhase,
    next_phase: nextPhase,
    reason,
    result_hash: hashResult(result),
    timestamp,
    runner_version: RUNNER_VERSION,
  });
  assertValidSession(next);
  return next;
}

function assertFinalGates(session, resultCommit, options) {
  const latestRecordedCommit = [...session.attempts]
    .reverse()
    .find((attempt) => attempt.commit)?.commit;
  const head =
    resultCommit || latestRecordedCommit || (options.branchHead || defaultBranchHead)(session);
  const gateToPhase = { tdd: "implementation", review: "review", verification: "ship" };
  const missing = [];
  for (const gate of session.routing.required_gates) {
    const phase = gateToPhase[gate] || gate;
    const record = session.evidence[phase];
    if (!record || !record.commit || (record.commit !== head && record.verified_commit !== head)) {
      missing.push(gate);
    }
  }
  if (missing.length > 0) {
    throw validationError("final gate evidence is missing or stale", [
      issue("$.evidence", `required gates: ${missing.join(", ")}`),
    ]);
  }
}

function hashResult(result) {
  return `sha256:${crypto.createHash("sha256").update(stableStringify(result)).digest("hex")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function resumeBlocked(session, resolution, options = {}) {
  assertValidSession(session);
  if (session.status !== "blocked") throw new Error("only a blocked session can be resumed");
  if (typeof resolution !== "string" || !resolution.trim()) {
    throw new TypeError("resume resolution must be a non-empty string");
  }
  const next = structuredClone(session);
  const blocker = [...next.blockers].reverse().find((entry) => !entry.resolved_at);
  if (!blocker) throw new Error("blocked session has no unresolved blocker");
  const timestamp = options.now || new Date().toISOString();
  blocker.resolved_at = timestamp;
  blocker.resolution = resolution.trim();
  next.status = "active";
  next.phase_attempt = 1;
  next.updated_at = timestamp;
  assertValidSession(next);
  return next;
}

function grantAuthority(session, actions, reason, options = {}) {
  assertValidSession(session);
  if (!Array.isArray(actions) || actions.length === 0) {
    throw new TypeError("authority grant requires at least one action");
  }
  if (typeof reason !== "string" || !reason.trim()) {
    throw new TypeError("authority grant requires a non-empty reason");
  }
  const grantable = new Set(["push_feature_branch", "create_pr", "merge", "tracker_updates"]);
  const next = structuredClone(session);
  for (const action of [...new Set(actions)]) {
    if (!grantable.has(action))
      throw new Error(`authority action is not externally grantable: ${action}`);
    next.authority[action] = true;
  }
  const grantedAt = options.now || new Date().toISOString();
  next.authority_log.push({
    actions: [...new Set(actions)],
    reason: reason.trim(),
    granted_at: grantedAt,
  });
  next.updated_at = grantedAt;
  assertValidSession(next);
  return next;
}

function updateWorkspace(session, worktree, options = {}) {
  assertValidSession(session);
  const requested = path.resolve(worktree);
  const resolved = path.resolve(runGit(requested, ["rev-parse", "--show-toplevel"]));
  const sourceCommon = resolveGitCommonDir(session.source.repo_root);
  const worktreeCommon = resolveGitCommonDir(resolved);
  if (sourceCommon !== worktreeCommon) {
    throw new Error(`worktree does not belong to the session repository: ${resolved}`);
  }
  const branch = runGit(resolved, ["branch", "--show-current"]);
  if (!branch) throw new Error(`worktree is detached: ${resolved}`);
  const next = structuredClone(session);
  next.source.worktree = resolved;
  next.source.branch = branch;
  next.updated_at = options.now || new Date().toISOString();
  assertValidSession(next);
  return next;
}

function resolveGitCommonDir(worktree) {
  const value = runGit(worktree, ["rev-parse", "--git-common-dir"]);
  return fs.realpathSync(path.resolve(worktree, value));
}

function migrateLegacyMarkdown(legacyPath, options = {}) {
  const absoluteLegacyPath = path.resolve(legacyPath);
  const text = fs.readFileSync(absoluteLegacyPath, "utf8");
  const values = parseMarkdownState(text);
  const slug = normalizeSlug(options.slug || legacySlug(absoluteLegacyPath));
  const inferredRoot = inferLegacyRepoRoot(absoluteLegacyPath);
  const sourceDir = path.resolve(values["Repo root"] || inferredRoot);
  const now = options.now || new Date().toISOString();
  const session = createSession({
    slug,
    sourceDir,
    task: values.Ticket || null,
    size: normalizeSize(values.Size),
    runId: normalizeLegacyRunId(values["Run ID"]),
    now: isIsoDate(values["Started at"]) ? new Date(values["Started at"]).toISOString() : now,
  });
  const legacyPhase = normalizeLegacyPhase(values.Stage);
  session.phase = ["review", "ship", "retro"].includes(legacyPhase)
    ? "implementation"
    : legacyPhase;
  if (session.phase === "implementation" && legacyPhase !== "implementation") {
    session.routing.reasons = [
      `Legacy ${legacyPhase} session routed through implementation to rebuild current gate evidence`,
    ];
  }
  const legacyWorktree = values.Worktree || values["Active cwd"];
  session.source.worktree = legacyWorktree ? path.resolve(sourceDir, legacyWorktree) : sourceDir;
  session.source.branch = values.Branch || session.source.branch;
  session.updated_at = now;
  session.migration = { legacy_path: absoluteLegacyPath, migrated_at: now };
  const outputPath = path.resolve(
    options.output || path.join(sourceDir, ".pm", "dev-sessions", slug, "session.json")
  );
  assertValidSession(session);
  return { session, outputPath };
}

function parseMarkdownState(text) {
  const values = {};
  for (const match of text.matchAll(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/gm)) {
    const key = match[1].trim();
    const value = match[2].trim();
    if (key !== "Field" && !/^-+$/.test(key)) values[key] = value;
  }
  return values;
}

function legacySlug(legacyPath) {
  return path
    .basename(legacyPath, path.extname(legacyPath))
    .replace(/^\.dev-(?:epic-)?state-/, "")
    .replace(/^epic-/, "");
}

function inferLegacyRepoRoot(legacyPath) {
  const directory = path.dirname(legacyPath);
  if (
    path.basename(directory) === "dev-sessions" &&
    path.basename(path.dirname(directory)) === ".pm"
  ) {
    return path.dirname(path.dirname(directory));
  }
  return directory;
}

function normalizeLegacyPhase(value) {
  const normalized = String(value || "intake")
    .trim()
    .toLowerCase();
  const aliases = {
    implement: "implementation",
    "rfc-check": "readiness",
    simplify: "review",
  };
  const phase = aliases[normalized] || normalized;
  return PHASES.includes(phase) ? phase : "intake";
}

function normalizeLegacyRunId(value) {
  if (typeof value === "string" && value.startsWith("dev_")) return value;
  return generateRunId();
}

function normalizeSize(value) {
  const size = String(value || "unknown").toUpperCase();
  return new Set(["XS", "S", "M", "L", "XL"]).has(size) ? size : "unknown";
}

function projectMarkdown(session) {
  assertValidSession(session);
  const next = nextDecision(session);
  return [
    "# Dev Session State",
    "",
    "| Field | Value |",
    "|---|---|",
    `| Run ID | ${session.run_id} |`,
    `| Stage | ${session.phase} |`,
    `| Status | ${session.status} |`,
    `| Size | ${session.task.size} |`,
    `| Repo root | ${session.source.repo_root} |`,
    `| Active cwd | ${session.source.worktree} |`,
    `| Branch | ${session.source.branch} |`,
    `| Started at | ${session.created_at} |`,
    `| Updated at | ${session.updated_at} |`,
    "",
    "## Resume Instructions",
    `- Stage: ${session.phase}`,
    `- Next action: execute ${next.phase} attempt ${next.attempt}`,
    `- Required gates: ${next.applicable_gates.join(", ") || "none"}`,
    `- Blockers: ${session.blockers.length ? session.blockers.map((item) => item.reason).join("; ") : "none"}`,
    "",
  ].join("\n");
}

module.exports = {
  MAX_PHASE_ATTEMPTS,
  PHASES,
  resolvePhaseContract,
  RUNNER_VERSION,
  applyRouting,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  projectMarkdown,
  promptMetadata,
  readSession,
  recertifyEvidence,
  recordResult,
  resumeBlocked,
  validateResult,
  validateResultEnvelope,
  validateSession,
  validationError,
  updateWorkspace,
  transitionWorkUnit,
  writeJsonAtomic,
  writeSession,
};
