#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  applyContext,
  approveSession,
  assertValidSession,
  buildApprovalAudit,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  resumeBlocked,
  reviseSession,
  validateSession,
} = require("./lib/groom-session-schema");
const { resolveGroomProfile } = require("./lib/groom-runtime-profile");
const { writeJsonAtomic } = require("./loop-git.js");
const { acquireOwnedLock } = require("./lib/owned-lock.js");

const EXIT = { OK: 0, INVALID: 2, PRECONDITION: 3, VALIDATION: 4, BLOCKED: 5 };

function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parseArgs(argv);
    if (command === "init") return initCommand(options);
    if (command === "status") return statusCommand(options);
    if (command === "next") return nextCommand(options);
    if (command === "validate") return validateCommand(options);
    if (command === "context") return contextCommand(options);
    if (command === "record") return recordCommand(options);
    if (command === "approve") return approveCommand(options);
    if (command === "approval-audit") return approvalAuditCommand(options);
    if (command === "authorize") return authorizeCommand(options);
    if (command === "migrate") return migrateCommand(options);
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
  if (!command) throw cliError("Groom session command is required", EXIT.INVALID);
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw cliError(`unexpected argument: ${token}`, EXIT.INVALID);
    const key = token.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
    if (key === "json") {
      options.json = true;
      continue;
    }
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--"))
      throw cliError(`${token} requires a value`, EXIT.INVALID);
    options[key] = argv[++index];
  }
  return { command, options };
}

function initCommand(options) {
  requireOptions(options, ["slug", "sourceDir"]);
  let session;
  try {
    session = createSession({
      slug: options.slug,
      sourceDir: path.resolve(options.sourceDir),
      tier: options.tier,
      ...resolveGroomProfile(options),
    });
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = canonicalActivePath(session);
  withLock(sessionPath, () => {
    if (fs.existsSync(sessionPath))
      throw cliError(`Groom session already exists: ${sessionPath}`, EXIT.PRECONDITION);
    clearActiveRunDirectory(sessionPath);
    writeSession(sessionPath, session);
  });
  emit(options, { session_path: sessionPath, session, next: nextDecision(session, sessionPath) });
  return EXIT.OK;
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
    tier: session.context.tier,
    proposal: session.proposal,
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
  return issues.length ? EXIT.VALIDATION : EXIT.OK;
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
      const last = session.attempts.at(-1);
      if (
        last?.result_hash === resultHash &&
        (session.status === "blocked" ||
          !(session.phase === result.phase && session.phase_attempt === result.attempt))
      )
        return { session, idempotent: true };
      return recordResult(session, result);
    },
    { terminalResult: result }
  );
}

function approveCommand(options) {
  requireOptions(options, ["session", "approvedBy"]);
  if (process.env.PM_LOOP_WORKER === "1")
    throw cliError("loop workers cannot approve Groom proposals", EXIT.PRECONDITION);
  return mutateSession(options, (session) =>
    approveSession(session, { approvedBy: options.approvedBy })
  );
}

function approvalAuditCommand(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  return withLock(sessionPath, () => {
    const session = readSession(sessionPath);
    assertValidSession(session);
    assertCanonicalSessionPath(sessionPath, session);
    const approval = buildApprovalAudit(session);
    const approvalPath = session.proposal.json_path.replace(/\.json$/i, ".approval.json");
    writeJsonAtomic(approvalPath, approval, { fileMode: 0o600 });
    emit(options, { approval_path: approvalPath, approval });
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
  return mutateSession(options, (session) =>
    reviseSession(session, {
      reason: options.reason,
      phase: options.phase,
      proposal: options.proposal ? readJson(options.proposal) : undefined,
    })
  );
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
    session = migrateLegacyMarkdown(options.legacy, { sourceDir: options.sourceDir });
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = canonicalActivePath(session);
  withLock(sessionPath, () => {
    if (fs.existsSync(sessionPath))
      throw cliError(`Groom session already exists: ${sessionPath}`, EXIT.PRECONDITION);
    writeSession(sessionPath, session);
  });
  emit(options, { session_path: sessionPath, session, next: nextDecision(session, sessionPath) });
  return EXIT.OK;
}

function mutateSession(options, mutation, mutationOptions = {}) {
  const sessionPath = path.resolve(options.session);
  return withLock(sessionPath, () => {
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
    if (!idempotent && next.status === "complete")
      outputPath = archiveTerminalRun(sessionPath, next, mutationOptions.terminalResult);
    else if (!idempotent) writeSession(sessionPath, next);
    emit(options, {
      session_path: outputPath,
      session: next,
      idempotent,
      next: next.status === "complete" ? null : nextDecision(next, sessionPath),
    });
    return next.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
  });
}

function loadRequiredSession(options, validate = true) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  const session = readSession(sessionPath);
  if (validate) assertValidSession(session);
  assertCanonicalSessionPath(sessionPath, session);
  return { session, sessionPath };
}
function canonicalActivePath(session) {
  return path.join(session.source.repo_root, ".pm", "groom-sessions", session.slug, "session.json");
}
function completedSessionPath(session) {
  return path.join(
    session.source.repo_root,
    ".pm",
    "groom-sessions",
    "completed",
    session.slug,
    session.run_id,
    "session.json"
  );
}
function assertCanonicalSessionPath(sessionPath, session) {
  const expected =
    session.status === "complete" ? completedSessionPath(session) : canonicalActivePath(session);
  if (path.resolve(sessionPath) !== path.resolve(expected))
    throw cliError(`noncanonical Groom session path: expected ${expected}`, EXIT.PRECONDITION);
}
function clearActiveRunDirectory(sessionPath) {
  const activeDir = path.dirname(sessionPath);
  if (!fs.existsSync(activeDir)) return;
  const lockName = path.basename(`${sessionPath}.lock`);
  for (const entry of fs.readdirSync(activeDir))
    if (entry !== lockName)
      fs.rmSync(path.join(activeDir, entry), { recursive: true, force: true });
}

function archiveTerminalRun(sessionPath, session, result) {
  if (!result) throw new Error("terminal Groom archive requires the retro result");
  const activeDir = path.dirname(sessionPath);
  const archivePath = completedSessionPath(session);
  const archiveDir = path.dirname(archivePath);
  if (fs.existsSync(archiveDir))
    throw new Error(`terminal Groom archive already exists: ${archiveDir}`);
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
  if (!/^groom_[A-Za-z0-9_-]+$/.test(result.run_id || ""))
    throw cliError("terminal retry run_id is invalid", EXIT.VALIDATION);
  const activeDir = path.dirname(sessionPath);
  const resultHash = hashResult(result);
  try {
    const completion = readJson(path.join(activeDir, "completion.json"));
    if (completion.run_id === result.run_id && completion.result_hash === resultHash)
      return completion;
  } catch {
    // Completion lookup is best-effort before immutable archive discovery.
  }
  const archivePath = path.join(
    path.dirname(activeDir),
    "completed",
    path.basename(activeDir),
    result.run_id,
    "session.json"
  );
  const archived = readSession(archivePath);
  if (archived.attempts.at(-1)?.result_hash !== resultHash)
    throw new Error("completion result hash does not match this retry");
  return { run_id: result.run_id, result_hash: resultHash, session_path: archivePath };
}

function readSession(sessionPath) {
  if (!fs.existsSync(sessionPath))
    throw cliError(`Groom session not found: ${sessionPath}`, EXIT.PRECONDITION);
  try {
    return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  } catch (error) {
    throw cliError(`could not read Groom session: ${error.message}`, EXIT.VALIDATION);
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
      timeoutMessage: `Groom session is locked: ${lockPath}`,
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
    process.stdout.write(
      `${payload.session?.run_id || payload.run_id || "Groom session updated"}\n`
    );
}
function requireOptions(options, names) {
  for (const name of names)
    if (!options[name])
      throw cliError(
        `--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`,
        EXIT.INVALID
      );
}
function cliError(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

if (require.main === module) process.exitCode = main();
module.exports = { EXIT, main, parseArgs, readSession, writeSession };
