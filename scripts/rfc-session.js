#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  applyContext,
  approveSession,
  assertValidSession,
  createSession,
  grantAuthority,
  hashResult,
  migrateLegacyMarkdown,
  nextDecision,
  recordResult,
  validateSession,
} = require("./lib/rfc-session-schema");

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
    if (command === "authorize") return authorizeCommand(options);
    if (command === "migrate") return migrateCommand(options);
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
  let session;
  try {
    session = createSession({
      slug: options.slug,
      sourceDir: path.resolve(options.sourceDir),
      profile: options.profile,
      runtime: options.runtime,
      model: options.model,
      reasoning: options.reasoning,
    });
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
  if (fs.existsSync(sessionPath)) {
    throw cliError(`RFC session already exists: ${sessionPath}`, EXIT.PRECONDITION);
  }
  writeSession(sessionPath, session);
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
  return mutateSession(options, (session) => {
    const resultHash = hashResult(result);
    if (session.attempts.some((attempt) => attempt.result_hash === resultHash)) {
      return { session, idempotent: true };
    }
    return recordResult(session, result);
  });
}

function approveCommand(options) {
  requireOptions(options, ["session", "approvedBy"]);
  return mutateSession(options, (session) =>
    approveSession(session, { approvedBy: options.approvedBy })
  );
}

function authorizeCommand(options) {
  requireOptions(options, ["session", "action", "reason"]);
  return mutateSession(options, (session) =>
    grantAuthority(session, { action: options.action, reason: options.reason })
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
  if (fs.existsSync(sessionPath)) {
    throw cliError(`RFC session already exists: ${sessionPath}`, EXIT.PRECONDITION);
  }
  writeSession(sessionPath, session);
  emit(options, { session_path: sessionPath, session, next: nextDecision(session, sessionPath) });
  return EXIT.OK;
}

function mutateSession(options, mutation) {
  const sessionPath = path.resolve(options.session);
  return withLock(sessionPath, () => {
    const session = readSession(sessionPath);
    let outcome;
    try {
      outcome = mutation(session);
    } catch (error) {
      throw cliError(error.message, EXIT.VALIDATION);
    }
    const next = outcome?.session && outcome.idempotent ? outcome.session : outcome;
    writeSession(sessionPath, next);
    emit(options, {
      session_path: sessionPath,
      session: next,
      idempotent: outcome?.idempotent === true,
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
  return { session, sessionPath };
}

function readSession(sessionPath) {
  if (!fs.existsSync(sessionPath)) {
    throw cliError(`RFC session not found: ${sessionPath}`, EXIT.PRECONDITION);
  }
  try {
    return JSON.parse(fs.readFileSync(sessionPath, "utf8"));
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
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  const temporary = `${sessionPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, sessionPath);
  fs.chmodSync(sessionPath, 0o600);
}

function withLock(sessionPath, callback) {
  const lockPath = `${sessionPath}.lock`;
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  try {
    const descriptor = fs.openSync(lockPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${process.pid}\n`);
    fs.closeSync(descriptor);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    if (age < 30_000) throw cliError(`RFC session is locked: ${lockPath}`, EXIT.PRECONDITION);
    fs.rmSync(lockPath, { force: true });
    return withLock(sessionPath, callback);
  }
  try {
    return callback();
  } finally {
    fs.rmSync(lockPath, { force: true });
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
