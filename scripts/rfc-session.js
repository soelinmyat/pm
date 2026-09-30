#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  applyContext,
  approveSession,
  assertValidSession,
  buildApprovalAudit,
  createAmendmentSession,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  recertifyContext,
  recordResult,
  resumeBlocked,
  reviseSession,
  validateSession,
  upgradeCompatibleSession,
} = require("./lib/rfc-session-schema");
const { writeJsonAtomic } = require("./loop-git.js");
const { resolveRfcProfile } = require("./lib/rfc-runtime-profile.js");
const { assertAmendmentDepth, parseAmendedIssueNums } = require("./lib/rfc-amendment.js");
const { readCompletedRun } = require("./lib/rfc-approval-audit.js");
const { acquireOwnedLock } = require("./lib/owned-lock.js");
const { recordSessionTelemetry } = require("./lib/telemetry");

const EXIT = { OK: 0, INVALID: 2, PRECONDITION: 3, VALIDATION: 4, BLOCKED: 5 };

function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    if (command === "init") return initCommand(options);
    if (command === "amend") return amendCommand(options);
    if (command === "withdraw") return withdrawCommand(options);
    if (command === "status") return statusCommand(options);
    if (command === "next") return nextCommand(options);
    if (command === "validate") return validateCommand(options);
    if (command === "context") return contextCommand(options);
    if (command === "record") return recordCommand(options);
    if (command === "approve") return approveCommand(options);
    if (command === "approval-audit") return approvalAuditCommand(options);
    if (command === "authorize") return authorizeCommand(options);
    if (command === "migrate") return migrateCommand(options);
    if (command === "recertify") return recertifyCommand(options);
    if (command === "revise") return reviseCommand(options);
    if (command === "unblock") return unblockCommand(options);
    throw cliError(`unknown command: ${command}`, EXIT.INVALID);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode || EXIT.INVALID;
  }
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command) throw cliError("RFC session command is required", EXIT.INVALID);
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw cliError(`unexpected argument: ${token}`, EXIT.INVALID);
    const key = token.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (key === "json") {
      options.json = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      throw cliError(`${token} requires a value`, EXIT.INVALID);
    }
    options[key] = argv[++index];
  }
  return { command, options };
}

function initCommand(options) {
  requireOptions(options, ["slug", "sourceDir"]);
  return createRun(options, {
    existsLabel: "RFC session",
    build: (execution) =>
      createSession({
        slug: options.slug,
        sourceDir: path.resolve(options.sourceDir),
        ...execution,
      }),
  });
}

// Opens an owns-only amendment run against a completed, approved RFC run. The
// prior archive stays byte-identical; the new run re-enters review and needs a
// fresh approval of the amended sidecar hash before its own handoff.
function amendCommand(options) {
  requireOptions(options, ["completed", "sourceDir", "issues", "reason"]);
  if (process.env.PM_LOOP_WORKER === "1") {
    throw cliError("loop workers cannot amend RFCs", EXIT.PRECONDITION);
  }
  const completedPath = path.resolve(options.completed);
  const archived = readSession(completedPath);
  try {
    assertValidSession(archived);
  } catch (error) {
    throw cliError(`completed RFC run is invalid: ${error.message}`, EXIT.PRECONDITION);
  }
  if (archived.status !== "complete") {
    throw cliError("--completed must name a completed RFC run archive", EXIT.PRECONDITION);
  }
  assertCanonicalSessionPath(completedPath, archived);
  let issueNums;
  try {
    issueNums = parseAmendedIssueNums(options.issues);
  } catch (error) {
    throw cliError(error.message, EXIT.INVALID);
  }
  return createRun(options, {
    existsLabel: "active RFC session",
    build: (execution) => {
      try {
        return createAmendmentSession(archived, {
          sourceDir: path.resolve(options.sourceDir),
          issueNums,
          reason: options.reason,
          ...execution,
        });
      } catch (error) {
        throw new Error(`cannot amend: ${error.message}`);
      }
    },
    // Lineage checks run under the slug lock so concurrent amends cannot fork.
    underLock: () => {
      const successor = findAmendingRun(archived);
      if (successor) {
        throw cliError(
          `RFC run ${archived.run_id} was already amended by ${successor}; amend the latest run instead`,
          EXIT.PRECONDITION
        );
      }
      const superseding = findSupersedingRun(archived);
      if (superseding) {
        throw cliError(
          `RFC run ${archived.run_id} was superseded by ${superseding}; amend the latest run instead`,
          EXIT.PRECONDITION
        );
      }
      try {
        assertAmendmentDepth(archived, (runId) =>
          readCompletedRun(archived.source.repo_root, archived.slug, runId)
        );
      } catch (error) {
        throw cliError(`cannot amend: ${error.message}`, EXIT.PRECONDITION);
      }
    },
  });
}

// Closes an open amendment run without approving it, so a wrong --issues
// choice or a dropped path cannot hold the slug. The session bytes move beside
// the completed runs under withdrawn/, which no lineage or successor check reads;
// the approval it would have amended is untouched.
function withdrawCommand(options) {
  requireOptions(options, ["session", "reason"]);
  if (process.env.PM_LOOP_WORKER === "1") {
    throw cliError("loop workers cannot withdraw RFC amendments", EXIT.PRECONDITION);
  }
  const { session, sessionPath } = loadRequiredSession(options);
  assertWithdrawable(session);
  const archiveDir = path.join(
    path.dirname(path.dirname(completedSessionPath(session))),
    "withdrawn",
    session.run_id
  );
  const archivePath = path.join(archiveDir, "session.json");
  const withdrawal = {
    schema_version: 1,
    run_id: session.run_id,
    slug: session.slug,
    amends_run_id: session.amendment.of_run_id,
    reason: options.reason,
    withdrawn_at: new Date().toISOString(),
  };
  withLock(sessionPath, () => {
    const bytes = fs.readFileSync(sessionPath);
    const current = JSON.parse(bytes.toString("utf8"));
    if (current.run_id !== session.run_id) {
      throw cliError("RFC session changed before it could be withdrawn", EXIT.PRECONDITION);
    }
    assertWithdrawable(current);
    if (fs.existsSync(archiveDir)) {
      throw cliError(`withdrawn RFC run already exists: ${archiveDir}`, EXIT.PRECONDITION);
    }
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.writeFileSync(archivePath, bytes, { mode: 0o600 });
    writeJsonAtomic(path.join(archiveDir, "withdrawal.json"), withdrawal, { fileMode: 0o600 });
    clearActiveRunDirectory(sessionPath);
  });
  emit(options, { session_path: archivePath, run_id: session.run_id, withdrawal });
  return EXIT.OK;
}

// Handoff's approval-audit rewrites the slug's approval.json to name the run,
// so once an approval is recorded, or its audit names this run (revise resets
// the approval but leaves the audit), the amendment must finish handoff.
function assertWithdrawable(session) {
  if (!session.amendment || session.status === "complete") {
    throw cliError(
      "only an open amendment run can be withdrawn; revise an original RFC run instead",
      EXIT.PRECONDITION
    );
  }
  if (session.approval?.status === "approved") {
    throw cliError(
      "an approved amendment cannot be withdrawn; finish its handoff",
      EXIT.PRECONDITION
    );
  }
  const sidecars = new Set(
    [session.artifact?.json_path, session.amendment.prior_artifact?.json_path].filter(Boolean)
  );
  for (const jsonPath of sidecars) {
    const auditPath = jsonPath.replace(/\.json$/i, ".approval.json");
    let audit;
    try {
      audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw cliError(
        `cannot read approval audit ${auditPath}: ${error.message}`,
        EXIT.PRECONDITION
      );
    }
    if (audit?.run_id === session.run_id) {
      throw cliError(
        "approval audit already names this amendment; approve it again and finish handoff",
        EXIT.PRECONDITION
      );
    }
  }
}

function createRun(options, { existsLabel, build, underLock = () => {} }) {
  let session;
  try {
    const execution = resolveRfcProfile({
      sourceDir: path.resolve(options.sourceDir),
      runtime: options.runtime,
      profile: options.profile,
      model: options.model,
      reasoning: options.reasoning,
    });
    session = build(execution);
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "rfc-sessions",
    session.slug,
    "session.json"
  );
  withLock(sessionPath, () => {
    underLock();
    if (fs.existsSync(sessionPath)) {
      throw cliError(`${existsLabel} already exists: ${sessionPath}`, EXIT.PRECONDITION);
    }
    clearActiveRunDirectory(sessionPath);
    writeSession(sessionPath, session);
  });
  recordSessionTelemetry({
    workflow: "rfc",
    sessionPath,
    prevSession: null,
    session,
    result: null,
  });
  emit(options, { session_path: sessionPath, session, next: nextDecision(session, sessionPath) });
  return EXIT.OK;
}

function completedSiblingRuns(archived) {
  const slugDir = path.dirname(path.dirname(completedSessionPath(archived)));
  const runs = [];
  if (!fs.existsSync(slugDir)) return runs;
  for (const entry of fs.readdirSync(slugDir).sort()) {
    const candidate = path.join(slugDir, entry, "session.json");
    if (!fs.existsSync(candidate)) continue;
    try {
      const session = JSON.parse(fs.readFileSync(candidate, "utf8"));
      if (session?.run_id !== archived.run_id) runs.push(session);
    } catch {
      continue;
    }
  }
  return runs;
}

// An in-flight amendment is refused later by the active-session check.
function findAmendingRun(archived) {
  const successor = completedSiblingRuns(archived).find(
    (session) => session?.amendment?.of_run_id === archived.run_id
  );
  return successor ? successor.run_id : null;
}

// Only the latest approved run of a slug may be amended; a later fresh run
// replaced the design an older run approved.
function findSupersedingRun(archived) {
  const approvedAt = (session) => Date.parse(session?.approval?.approved_at);
  let latest = null;
  for (const session of completedSiblingRuns(archived)) {
    if (session?.status !== "complete" || !(approvedAt(session) > approvedAt(archived))) continue;
    if (!latest || approvedAt(session) > approvedAt(latest)) latest = session;
  }
  return latest ? latest.run_id : null;
}

function statusCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  emit(options, {
    schema_version: session.schema_version,
    run_id: session.run_id,
    slug: session.slug,
    status: session.status,
    phase: session.phase,
    phase_attempt: session.phase_attempt,
    updated_at: session.updated_at,
    session_path: sessionPath,
  });
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function nextCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  emit(options, nextDecision(session, sessionPath));
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function validateCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options, false);
  const issues = validateSession(session);
  emit(options, { ok: issues.length === 0, session_path: sessionPath, issues });
  return issues.length === 0 ? EXIT.OK : EXIT.VALIDATION;
}

function contextCommand(options) {
  requireOptions(options, ["session", "facts"]);
  return mutateSession(options, (session) => applyContext(session, readJson(options.facts)));
}

function recordCommand(options) {
  requireOptions(options, ["session", "result"]);
  const result = readJson(options.result);
  return mutateSession(
    options,
    (session) => {
      const resultHash = hashResult(result);
      const lastAttempt = session.attempts.at(-1);
      if (
        lastAttempt?.result_hash === resultHash &&
        (session.status === "blocked" ||
          !(session.phase === result.phase && session.phase_attempt === result.attempt))
      ) {
        return { session, idempotent: true };
      }
      return recordResult(session, result);
    },
    { terminalResult: result }
  );
}

function approveCommand(options) {
  requireOptions(options, ["session", "approvedBy"]);
  if (process.env.PM_LOOP_WORKER === "1") {
    throw cliError("loop workers cannot approve RFCs", EXIT.PRECONDITION);
  }
  return mutateSession(options, (session) =>
    approveSession(session, {
      approvedBy: options.approvedBy,
      approvedSidecarSha256: options.approvedSidecarSha256,
    })
  );
}

function approvalAuditCommand(options) {
  requireOptions(options, ["session", "artifact"]);
  const sessionPath = path.resolve(options.session);
  const artifact = readJson(options.artifact);
  return withLock(sessionPath, () => {
    const session = readSession(sessionPath);
    assertValidSession(session);
    assertCanonicalSessionPath(sessionPath, session);
    const audit = buildApprovalAudit(session, artifact);
    const approvalPath = artifact.json_path.replace(/\.json$/i, ".approval.json");
    if (approvalPath === artifact.json_path) {
      throw cliError("RFC sidecar path must end in .json", EXIT.VALIDATION);
    }
    writeJsonAtomic(approvalPath, audit, { fileMode: 0o600 });
    emit(options, { approval_path: approvalPath, approval: audit });
    return EXIT.OK;
  });
}

function authorizeCommand(options) {
  requireOptions(options, ["session", "action", "reason"]);
  return mutateSession(options, (session) =>
    grantAuthority(session, { action: options.action, reason: options.reason })
  );
}

function reviseCommand(options) {
  requireOptions(options, ["session", "reason"]);
  return mutateSession(options, (session) => reviseSession(session, { reason: options.reason }));
}

function recertifyCommand(options) {
  requireOptions(options, ["session", "facts"]);
  return mutateSession(options, (session) => recertifyContext(session, readJson(options.facts)));
}

function unblockCommand(options) {
  requireOptions(options, ["session", "resolution"]);
  return mutateSession(options, (session) =>
    resumeBlocked(session, { resolution: options.resolution })
  );
}

function migrateCommand(options) {
  requireOptions(options, ["legacy"]);
  let session;
  try {
    session = migrateLegacyMarkdown(options.legacy);
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "rfc-sessions",
    session.slug,
    "session.json"
  );
  withLock(sessionPath, () => {
    if (fs.existsSync(sessionPath)) {
      throw cliError(`RFC session already exists: ${sessionPath}`, EXIT.PRECONDITION);
    }
    writeSession(sessionPath, session);
  });
  emit(options, { session_path: sessionPath, session, next: nextDecision(session, sessionPath) });
  return EXIT.OK;
}

function mutateSession(options, mutation, mutationOptions = {}) {
  const sessionPath = path.resolve(options.session);
  const exitCode = withLock(sessionPath, () => {
    if (!fs.existsSync(sessionPath) && mutationOptions.terminalResult) {
      const recovered = recoverTerminalRetry(sessionPath, mutationOptions.terminalResult);
      const session = readSession(recovered.session_path);
      emit(options, {
        session_path: recovered.session_path,
        session,
        idempotent: true,
        next: null,
      });
      return EXIT.OK;
    }
    const session = readSession(sessionPath);
    assertCanonicalSessionPath(sessionPath, session);
    let outcome;
    try {
      outcome = mutation(session);
    } catch (error) {
      throw cliError(error.message, EXIT.VALIDATION);
    }
    const next = outcome?.session && outcome.idempotent ? outcome.session : outcome;
    const idempotent =
      outcome?.idempotent === true || JSON.stringify(next) === JSON.stringify(session);
    let outputPath = sessionPath;
    if (!idempotent && next.status === "complete") {
      outputPath = archiveTerminalRun(sessionPath, next, mutationOptions.terminalResult);
    } else if (!idempotent) {
      writeSession(sessionPath, next);
    }
    if (!idempotent) {
      recordSessionTelemetry({
        workflow: "rfc",
        sessionPath: outputPath,
        prevSession: session,
        session: next,
        result: mutationOptions.terminalResult,
      });
    }
    emit(options, {
      session_path: outputPath,
      session: next,
      idempotent,
      next: next.status === "complete" ? null : nextDecision(next, sessionPath),
    });
    return next.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
  });
  return exitCode;
}

function loadRequiredSession(options, validate = true) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  const session = readSession(sessionPath);
  if (validate) assertValidSession(session);
  assertCanonicalSessionPath(sessionPath, session);
  return { session, sessionPath };
}

function assertCanonicalSessionPath(sessionPath, session) {
  const canonicalPath =
    session.status === "complete"
      ? completedSessionPath(session)
      : path.join(session.source.repo_root, ".pm", "rfc-sessions", session.slug, "session.json");
  if (path.resolve(sessionPath) !== path.resolve(canonicalPath)) {
    throw cliError(`noncanonical RFC session path: expected ${canonicalPath}`, EXIT.PRECONDITION);
  }
}

function completedSessionPath(session) {
  return path.join(
    session.source.repo_root,
    ".pm",
    "rfc-sessions",
    "completed",
    session.slug,
    session.run_id,
    "session.json"
  );
}

function clearActiveRunDirectory(sessionPath) {
  const activeDir = path.dirname(sessionPath);
  const lockName = path.basename(`${sessionPath}.lock`);
  for (const entry of fs.readdirSync(activeDir)) {
    if (entry === lockName) continue;
    fs.rmSync(path.join(activeDir, entry), { recursive: true, force: true });
  }
}

function archiveTerminalRun(sessionPath, session, result) {
  if (!result) throw new Error("terminal RFC archive requires the handoff result");
  const activeDir = path.dirname(sessionPath);
  const archivePath = completedSessionPath(session);
  const archiveDir = path.dirname(archivePath);
  if (fs.existsSync(archiveDir)) {
    throw new Error(`terminal RFC archive already exists: ${archiveDir}`);
  }
  writeSession(sessionPath, session);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true, mode: 0o700 });
  fs.renameSync(activeDir, archiveDir);
  fs.rmSync(path.join(archiveDir, path.basename(`${sessionPath}.lock`)), { force: true });
  writeJsonAtomic(path.join(activeDir, "completion.json"), {
    schema_version: 1,
    run_id: session.run_id,
    result_hash: hashResult(result),
    session_path: archivePath,
  });
  return archivePath;
}

function recoverTerminalRetry(sessionPath, result) {
  if (!/^rfc_[A-Za-z0-9_-]+$/.test(result.run_id || "")) {
    throw cliError("terminal retry run_id is invalid", EXIT.VALIDATION);
  }
  const activeDir = path.dirname(sessionPath);
  const resultHash = hashResult(result);
  try {
    const completion = readJson(path.join(activeDir, "completion.json"));
    if (completion.run_id === result.run_id && completion.result_hash === resultHash) {
      return completion;
    }
  } catch {
    // Fall through to immutable archive discovery.
  }
  const archivePath = path.join(
    path.dirname(activeDir),
    "completed",
    path.basename(activeDir),
    result.run_id,
    "session.json"
  );
  const archived = readSession(archivePath);
  if (archived.attempts.at(-1)?.result_hash !== resultHash) {
    throw new Error("completion result hash does not match this retry");
  }
  return { run_id: result.run_id, result_hash: resultHash, session_path: archivePath };
}

function readSession(sessionPath) {
  if (!fs.existsSync(sessionPath)) {
    throw cliError(`RFC session not found: ${sessionPath}`, EXIT.PRECONDITION);
  }
  try {
    return upgradeCompatibleSession(JSON.parse(fs.readFileSync(sessionPath, "utf8")));
  } catch (error) {
    throw cliError(`could not read RFC session: ${error.message}`, EXIT.VALIDATION);
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  } catch (error) {
    throw cliError(`could not read JSON input: ${error.message}`, EXIT.INVALID);
  }
}

function writeSession(sessionPath, session) {
  assertValidSession(session);
  writeJsonAtomic(sessionPath, session, { fileMode: 0o600 });
}

function withLock(sessionPath, callback) {
  const lockPath = `${sessionPath}.lock`;
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  let release;
  try {
    release = acquireOwnedLock(lockPath, {
      attempts: 2,
      waitMs: 0,
      invalidGraceMs: 1000,
      timeoutMessage: `RFC session is locked: ${lockPath}`,
    });
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  try {
    return callback();
  } finally {
    release();
  }
}

function emit(options, payload) {
  if (options.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else
    process.stdout.write(`${payload.session?.run_id || payload.run_id || "RFC session updated"}\n`);
}

function requireOptions(options, names) {
  for (const name of names) {
    if (!options[name]) throw cliError(`--${toKebab(name)} is required`, EXIT.INVALID);
  }
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function cliError(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

if (require.main === module) process.exitCode = main();

module.exports = { EXIT, main, parseArgs, readSession, writeSession };
