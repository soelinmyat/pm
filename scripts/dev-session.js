#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  applyRouting,
  createSession,
  migrateLegacyMarkdown,
  nextDecision,
  projectMarkdown,
  promptMetadata,
  readSession,
  recordResult,
  validateResultEnvelope,
  validateSession,
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
    options[key] = argv[index + 1];
    index += 1;
  }
  return { command, options };
}

function initCommand(options) {
  requireOptions(options, ["slug", "sourceDir"]);
  const sourceDir = path.resolve(options.sourceDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw cliError(`source directory does not exist: ${sourceDir}`, EXIT.PRECONDITION);
  }
  const session = createSession({
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
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "dev-sessions",
    session.slug,
    "session.json"
  );
  if (fs.existsSync(sessionPath)) {
    throw cliError(`session already exists: ${sessionPath}`, EXIT.PRECONDITION);
  }
  writeSession(sessionPath, session);
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
  const session = readSession(sessionPath);
  let facts;
  try {
    facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  } catch (error) {
    throw cliError(`cannot read routing facts ${factsPath}: ${error.message}`, EXIT.INVALID);
  }
  let updated;
  try {
    updated = applyRouting(session, facts);
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  writeSession(sessionPath, updated);
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
  const session = readSession(sessionPath);
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
  let updated;
  try {
    updated = recordResult(session, result);
  } catch (error) {
    throw cliError(error.message, EXIT.RESULT_INVALID);
  }
  writeSession(sessionPath, updated);
  const decision = nextDecision(updated, sessionPath);
  emit(
    options,
    { session_path: sessionPath, session: updated, next: decision },
    `${decision.phase}\n`
  );
  if (updated.status === "blocked") {
    return updated.blockers.at(-1)?.code === "retry-exhausted"
      ? EXIT.RETRY_EXHAUSTED
      : EXIT.BLOCKED;
  }
  return EXIT.OK;
}

function validateCommand(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
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
  if (fs.existsSync(migrated.outputPath)) {
    throw cliError(`session already exists: ${migrated.outputPath}`, EXIT.PRECONDITION);
  }
  writeSession(migrated.outputPath, migrated.session);
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
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `.${path.basename(filePath)}.tmp-${process.pid}`);
  try {
    fs.writeFileSync(temporary, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
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
