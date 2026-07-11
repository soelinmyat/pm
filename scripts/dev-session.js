#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeTextAtomic: writeAtomicText } = require("./lib/atomic-file");
const { parseCliArgs } = require("./loop-args");

const {
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
  transitionWorkUnit,
  validateResultEnvelope,
  validateSession,
  updateWorkspace,
  upgradeCompatibleSession,
  writeJsonAtomic,
  writeSession,
} = require("./lib/dev-session-schema");

const EXIT = Object.freeze({
  OK: 0,
  INVALID: 2,
  PRECONDITION: 3,
  RESULT_INVALID: 4,
  BLOCKED: 5,
  RETRY_EXHAUSTED: 6,
});

function main(argv) {
  const { command, options } = parseArguments(argv);
  switch (command) {
    case "init":
      return initCommand(options);
    case "status":
      return statusCommand(options);
    case "next":
      return nextCommand(options);
    case "prompt":
      return promptCommand(options);
    case "route":
      return routeCommand(options);
    case "record":
      return recordCommand(options);
    case "recertify":
      return recertifyCommand(options);
    case "unblock":
      return unblockCommand(options);
    case "authorize":
      return authorizeCommand(options);
    case "workspace":
      return workspaceCommand(options);
    case "work-unit":
      return workUnitCommand(options);
    case "validate":
      return validateCommand(options);
    case "migrate":
      return migrateCommand(options);
    case "project":
      return projectCommand(options);
    case "help":
      process.stdout.write(helpText());
      return EXIT.OK;
    default:
      throw cliError(`unknown command: ${command || "(missing)"}`, EXIT.INVALID);
  }
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", options: {} };
  }
  const command = argv[0];
  const valueFlags = [
    "slug",
    "source-dir",
    "task",
    "kind",
    "size",
    "profile",
    "runtime",
    "model",
    "reasoning",
    "mode",
    "session",
    "output",
    "facts",
    "result",
    "phases",
    "commit",
    "evidence",
    "reason",
    "grant",
    "worktree",
    "id",
    "status",
    "legacy",
    "base-commit",
  ];
  const spec = Object.fromEntries(valueFlags.map((name) => [`--${name}`, { type: "string" }]));
  spec["--json"] = { key: "json", type: "boolean" };
  try {
    const parsed = parseCliArgs(argv.slice(1), spec);
    if (parsed.positionals.length > 0) {
      throw new Error(`unexpected argument: ${parsed.positionals[0]}`);
    }
    return { command, options: parsed.args };
  } catch (error) {
    const message = error.message
      .replace(/^Unknown option:/, "unknown option:")
      .replace(/^Missing value for (.+)$/, "$1 requires a value");
    throw cliError(message, EXIT.INVALID);
  }
}

function initCommand(options) {
  requireOptions(options, ["slug", "sourceDir"]);
  const sourceDir = path.resolve(options.sourceDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw cliError(`source directory does not exist: ${sourceDir}`, EXIT.PRECONDITION);
  }
  let session;
  try {
    session = createSession({
      slug: options.slug,
      sourceDir,
      task: options.task,
      kind: options.kind,
      size: options.size,
      profile: options.profile,
      runtime: options.runtime,
      model: options.model,
      reasoning: options.reasoning,
      mode: options.mode,
    });
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "dev-sessions",
    session.slug,
    "session.json"
  );
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    if (fs.existsSync(sessionPath)) {
      throw cliError(`session already exists: ${sessionPath}`, EXIT.PRECONDITION);
    }
    clearActiveRunDirectory(sessionPath);
    writeSession(sessionPath, session);
  } finally {
    releaseLock();
  }
  emit(
    options,
    { session_path: sessionPath, session, next: nextDecision(session, sessionPath) },
    `Initialized ${session.run_id} at ${sessionPath}\n`
  );
  return EXIT.OK;
}

function statusCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  const payload = {
    schema_version: session.schema_version,
    run_id: session.run_id,
    slug: session.slug,
    status: session.status,
    phase: session.phase,
    phase_attempt: session.phase_attempt,
    updated_at: session.updated_at,
    session_path: sessionPath,
  };
  emit(
    options,
    payload,
    `${session.run_id}: ${session.status}, ${session.phase} attempt ${session.phase_attempt}\n`
  );
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function nextCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  const decision = nextDecision(session, sessionPath);
  emit(options, decision, `${decision.phase} attempt ${decision.attempt}\n`);
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function promptCommand(options) {
  requireOptions(options, ["session", "output"]);
  const sessionPath = path.resolve(options.session);
  const session = readSession(sessionPath);
  const outputPath = path.resolve(options.output);
  writeJsonAtomic(outputPath, promptMetadata(session, sessionPath));
  emit(options, { output_path: outputPath }, `${outputPath}\n`);
  return EXIT.OK;
}

function routeCommand(options) {
  requireOptions(options, ["session", "facts"]);
  const sessionPath = path.resolve(options.session);
  const factsPath = path.resolve(options.facts);
  let facts;
  try {
    facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  } catch (error) {
    throw cliError(`cannot read routing facts ${factsPath}: ${error.message}`, EXIT.INVALID);
  }
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) => applyRouting(session, facts));
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, routing: updated.routing, task: updated.task },
    `${updated.task.risk_tier}: ${updated.routing.review_mode}\n`
  );
  return EXIT.OK;
}

function recordCommand(options) {
  requireOptions(options, ["session", "result"]);
  const sessionPath = path.resolve(options.session);
  const resultPath = path.resolve(options.result);
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    throw cliError(`cannot read result ${resultPath}: ${error.message}`, EXIT.RESULT_INVALID);
  }
  const envelopeErrors = validateResultEnvelope(result);
  if (envelopeErrors.length > 0) {
    throw cliError(formatValidation("result is invalid", envelopeErrors), EXIT.RESULT_INVALID);
  }
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    if (!fs.existsSync(sessionPath)) {
      try {
        const recovered = recoverTerminalRetry(sessionPath, result);
        const session = readSession(recovered.session_path);
        emit(
          options,
          {
            session_path: recovered.session_path,
            session,
            next: nextDecision(session, recovered.session_path),
            idempotent: true,
          },
          `${session.phase}\n`
        );
        return EXIT.OK;
      } catch (error) {
        throw cliError(`cannot resolve completed session retry: ${error.message}`, EXIT.INVALID);
      }
    }
    const session = readSession(sessionPath);
    const resultHash = hashResult(result);
    if (session.history.at(-1)?.result_hash === resultHash) {
      let idempotentSession = session;
      let idempotentPath = sessionPath;
      if (["complete", "handoff"].includes(session.status)) {
        idempotentPath = archiveTerminalRun(sessionPath, session, result);
        idempotentSession = readSession(idempotentPath);
      }
      const decision = nextDecision(idempotentSession, idempotentPath);
      emit(
        options,
        {
          session_path: idempotentPath,
          session: idempotentSession,
          next: decision,
          idempotent: true,
        },
        `${decision.phase}\n`
      );
      return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
    }
    let updated;
    try {
      updated = recordResult(session, result);
    } catch (error) {
      throw cliError(error.message, EXIT.RESULT_INVALID);
    }
    let persistedPath = sessionPath;
    if (["complete", "handoff"].includes(updated.status)) {
      persistedPath = archiveTerminalRun(sessionPath, updated, result);
      updated = readSession(persistedPath);
    } else {
      writeSession(sessionPath, updated);
    }
    const decision = nextDecision(updated, persistedPath);
    emit(
      options,
      { session_path: persistedPath, session: updated, next: decision, idempotent: false },
      `${decision.phase}\n`
    );
    if (updated.status === "blocked") {
      return updated.blockers.at(-1)?.code === "retry-exhausted"
        ? EXIT.RETRY_EXHAUSTED
        : EXIT.BLOCKED;
    }
    return EXIT.OK;
  } finally {
    releaseLock();
  }
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
  const activeDir = path.dirname(sessionPath);
  const sessionsDir = path.dirname(activeDir);
  const archiveDir = path.join(sessionsDir, "completed", session.slug, session.run_id);
  const persistedPath = path.join(archiveDir, "session.json");
  if (fs.existsSync(archiveDir)) throw new Error(`terminal archive already exists: ${archiveDir}`);
  const archivedSession = rebaseRunPaths(session, activeDir, archiveDir, session.source.repo_root);
  writeSession(sessionPath, archivedSession);
  rebaseRunJsonArtifacts(activeDir, archiveDir, session.source.repo_root, sessionPath);
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true, mode: 0o700 });
  fs.renameSync(activeDir, archiveDir);
  fs.rmSync(path.join(archiveDir, path.basename(`${sessionPath}.lock`)), {
    recursive: true,
    force: true,
  });
  writeJsonAtomic(path.join(activeDir, "completion.json"), {
    schema_version: 1,
    run_id: session.run_id,
    result_hash: hashResult(result),
    session_path: persistedPath,
  });
  return persistedPath;
}

function recoverTerminalRetry(sessionPath, result) {
  const resultHash = hashResult(result);
  const activeDir = path.dirname(sessionPath);
  const completionPath = path.join(activeDir, "completion.json");
  try {
    const completion = JSON.parse(fs.readFileSync(completionPath, "utf8"));
    if (completion.run_id === result.run_id && completion.result_hash === resultHash) {
      return completion;
    }
  } catch {
    // Fall through to immutable archive discovery.
  }
  const sessionsDir = path.dirname(activeDir);
  const archivePath = path.join(
    sessionsDir,
    "completed",
    path.basename(activeDir),
    result.run_id,
    "session.json"
  );
  const archived = readSession(archivePath);
  if (archived.history.at(-1)?.result_hash !== resultHash) {
    throw new Error("completion result hash does not match this retry");
  }
  fs.rmSync(path.join(path.dirname(archivePath), "session.json.lock"), {
    recursive: true,
    force: true,
  });
  return { session_path: archivePath, run_id: result.run_id, result_hash: resultHash };
}

function rebaseRunJsonArtifacts(activeDir, archiveDir, repoRoot, sessionPath) {
  const lockPath = `${sessionPath}.lock`;
  const pending = [activeDir];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entryPath === lockPath || entryPath.startsWith(`${lockPath}${path.sep}`)) continue;
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entryPath !== sessionPath && entry.name.endsWith(".json")) {
        let parsed;
        try {
          parsed = JSON.parse(fs.readFileSync(entryPath, "utf8"));
        } catch {
          // Non-contract scratch JSON remains byte-for-byte archived.
          continue;
        }
        writeJsonAtomic(entryPath, rebaseRunPaths(parsed, activeDir, archiveDir, repoRoot));
      }
    }
  }
}

function rebaseRunPaths(value, fromDir, toDir, repoRoot) {
  if (Array.isArray(value))
    return value.map((item) => rebaseRunPaths(item, fromDir, toDir, repoRoot));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rebaseRunPaths(item, fromDir, toDir, repoRoot),
      ])
    );
  }
  if (
    typeof value === "string" &&
    (value === fromDir || value.startsWith(`${fromDir}${path.sep}`))
  ) {
    return path.join(toDir, path.relative(fromDir, value));
  }
  if (typeof value === "string" && repoRoot) {
    const normalized = value.replace(/\\/g, "/");
    const fromRelative = path.relative(repoRoot, fromDir).replace(/\\/g, "/");
    const toRelative = path.relative(repoRoot, toDir).replace(/\\/g, "/");
    if (normalized === fromRelative || normalized.startsWith(`${fromRelative}/`)) {
      return `${toRelative}${normalized.slice(fromRelative.length)}`;
    }
  }
  return value;
}

function acquireSessionLock(sessionPath) {
  const lockPath = `${sessionPath}.lock`;
  const ownerPath = path.join(lockPath, "owner.json");
  function attempt() {
    try {
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`,
        { mode: 0o600, flag: "wx" }
      );
    } catch (error) {
      if (error.code !== "EEXIST") {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      let owner;
      try {
        owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      } catch {
        throw cliError("session is locked by an initializing process", EXIT.PRECONDITION);
      }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) {
        throw cliError("session lock has invalid owner metadata", EXIT.PRECONDITION);
      }
      try {
        process.kill(owner.pid, 0);
      } catch (probeError) {
        if (probeError.code === "ESRCH") {
          fs.rmSync(lockPath, { recursive: true, force: true });
          return attempt();
        }
        throw probeError;
      }
      throw cliError(`session is locked by process ${owner.pid}`, EXIT.PRECONDITION);
    }
    return () => fs.rmSync(lockPath, { recursive: true, force: true });
  }
  return attempt();
}

function mutateSession(sessionPath, mutation) {
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    const updated = mutation(readSession(sessionPath));
    writeSession(sessionPath, updated);
    return updated;
  } finally {
    releaseLock();
  }
}

function recertifyCommand(options) {
  requireOptions(options, ["session", "phases", "commit", "evidence"]);
  const sessionPath = path.resolve(options.session);
  let verification;
  try {
    verification = JSON.parse(fs.readFileSync(path.resolve(options.evidence), "utf8"));
  } catch (error) {
    throw cliError(
      `cannot read recertification evidence ${options.evidence}: ${error.message}`,
      EXIT.INVALID
    );
  }
  const phases = options.phases
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    mutateSession(sessionPath, (session) =>
      recertifyEvidence(session, phases, options.commit, verification)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, phases, commit: options.commit },
    `Recertified ${phases.join(", ")} at ${options.commit}\n`
  );
  return EXIT.OK;
}

function unblockCommand(options) {
  requireOptions(options, ["session", "reason"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) => resumeBlocked(session, options.reason));
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(options, { session_path: sessionPath, session: updated }, `Resumed ${updated.phase}\n`);
  return EXIT.OK;
}

function authorizeCommand(options) {
  requireOptions(options, ["session", "grant", "reason"]);
  const sessionPath = path.resolve(options.session);
  const actions = options.grant
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      grantAuthority(session, actions, options.reason)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, authority: updated.authority },
    `Granted ${actions.join(", ")}\n`
  );
  return EXIT.OK;
}

function workspaceCommand(options) {
  requireOptions(options, ["session", "worktree"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) => updateWorkspace(session, options.worktree));
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, source: updated.source },
    `${updated.source.worktree}\n`
  );
  return EXIT.OK;
}

function workUnitCommand(options) {
  requireOptions(options, ["session", "id", "status"]);
  const sessionPath = path.resolve(options.session);
  let result;
  if (options.result) {
    try {
      result = JSON.parse(fs.readFileSync(path.resolve(options.result), "utf8"));
    } catch (error) {
      throw cliError(
        `cannot read work-unit result ${options.result}: ${error.message}`,
        EXIT.INVALID
      );
    }
  }
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      transitionWorkUnit(session, {
        id: options.id,
        status: options.status,
        result,
        reason: options.reason,
        worktree: options.worktree,
      })
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const unit = updated.task.work_units.find((candidate) => candidate.id === options.id);
  emit(options, { session_path: sessionPath, work_unit: unit }, `${unit.id}: ${unit.status}\n`);
  return EXIT.OK;
}

function validateCommand(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  let parsed;
  try {
    parsed = upgradeCompatibleSession(JSON.parse(fs.readFileSync(sessionPath, "utf8")));
  } catch (error) {
    throw cliError(`cannot read session ${sessionPath}: ${error.message}`, EXIT.INVALID);
  }
  const errors = validateSession(parsed);
  if (errors.length > 0)
    throw cliError(formatValidation("session is invalid", errors), EXIT.INVALID);
  emit(options, { valid: true, session_path: sessionPath }, `Valid: ${sessionPath}\n`);
  return EXIT.OK;
}

function migrateCommand(options) {
  requireOptions(options, ["legacy"]);
  const legacyPath = path.resolve(options.legacy);
  if (!fs.existsSync(legacyPath)) {
    throw cliError(`legacy session does not exist: ${legacyPath}`, EXIT.PRECONDITION);
  }
  const migrated = migrateLegacyMarkdown(legacyPath, { output: options.output });
  const releaseLock = acquireSessionLock(migrated.outputPath);
  try {
    if (fs.existsSync(migrated.outputPath)) {
      throw cliError(`session already exists: ${migrated.outputPath}`, EXIT.PRECONDITION);
    }
    writeSession(migrated.outputPath, migrated.session);
  } finally {
    releaseLock();
  }
  emit(
    options,
    { session_path: migrated.outputPath, legacy_path: legacyPath, session: migrated.session },
    `Migrated ${legacyPath} to ${migrated.outputPath}\n`
  );
  return EXIT.OK;
}

function projectCommand(options) {
  const { session } = loadRequiredSession(options);
  const markdown = projectMarkdown(session);
  if (options.output) {
    writeTextAtomic(path.resolve(options.output), markdown);
    emit(
      options,
      { output_path: path.resolve(options.output) },
      `${path.resolve(options.output)}\n`
    );
  } else {
    emit(options, { markdown }, markdown);
  }
  return EXIT.OK;
}

function writeTextAtomic(filePath, text) {
  writeAtomicText(filePath, text, { directoryMode: 0o700, fileMode: 0o600 });
}

function loadRequiredSession(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  return { session: readSession(sessionPath), sessionPath };
}

function requireOptions(options, names) {
  const missing = names.filter((name) => !options[name]);
  if (missing.length > 0) {
    throw cliError(
      `missing required option(s): ${missing.map((name) => `--${toKebab(name)}`).join(", ")}`,
      EXIT.INVALID
    );
  }
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function emit(options, payload, text) {
  process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : text);
}

function formatValidation(prefix, errors) {
  return `${prefix}: ${errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`;
}

function cliError(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function helpText() {
  return [
    "Usage: dev-session <command> [options]",
    "",
    "Commands:",
    "  init --slug <slug> --source-dir <path> [--task <path-or-id>] [--json]",
    "  status --session <path> [--json]",
    "  next --session <path> [--json]",
    "  prompt --session <path> --output <path> [--json]",
    "  route --session <path> --facts <json-path> [--json]",
    "  record --session <path> --result <path> [--json]",
    "  recertify --session <path> --phases <csv> --commit <sha> --evidence <json-path> [--json]",
    "  unblock --session <path> --reason <resolution> [--json]",
    "  authorize --session <path> --grant <csv> --reason <consent> [--json]",
    "  workspace --session <path> --worktree <path> [--json]",
    "  work-unit --session <path> --id <id> --status <status> [--worktree <path>] [--result <path>] [--reason <text>] [--json]",
    "  validate --session <path> [--json]",
    "  migrate --legacy <path> [--output <path>] [--json]",
    "  project --session <path> [--output <path>] [--json]",
    "",
  ].join("\n");
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`dev-session: ${error.message}\n`);
    process.exitCode = error.exitCode || EXIT.INVALID;
  }
}

module.exports = { EXIT, main, parseArguments };
