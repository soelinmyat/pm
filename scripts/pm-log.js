#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const {
  activityFilePath,
  stepsFilePath,
  currentStepFilePath,
  getHostId,
} = require("./lib/analytics-paths.js");

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  pm-log.sh <skill> <event> [detail]
  pm-log.sh activity --skill <skill> --event <event> [--detail <detail>] [--run-id <id>] [--status <status>] [--meta-json <json>]
  pm-log.sh run-start --skill <skill> [--args <args>] [--detail <detail>] [--run-id <id>] [--parent-run-id <id>]
  pm-log.sh run-end --skill <skill> --run-id <id> [--status <status>] [--detail <detail>] [--meta-json <json>]
  pm-log.sh step --skill <skill> --run-id <id> --step <step> [--phase <phase>] [--status <status>] [--started-at <iso>] [--ended-at <iso>] [--duration-ms <n>] [--attempt <n>] [--actor <actor>] [--input-chars <n>] [--output-chars <n>] [--token-source <source>] [--input-file <path>] [--output-file <path>] [--state-file <path>] [--meta-json <json>]
  pm-log.sh active-step-set --skill <skill> --run-id <id> --step <step> [--phase <phase>] [--started-at <iso>] [--state-file <path>]
  pm-log.sh active-step-clear [--state-file <path>]
  pm-log.sh active-step-close [--ended-at <iso>] [--status <status>]`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      usage(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      options[key] = true;
      continue;
    }
    options[key] = next;
    index += 1;
  }
  return options;
}

function runGit(args, cwd) {
  try {
    return childProcess
      .execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
  } catch {
    return "";
  }
}

function detectProjectRoot(projectDir) {
  const cwd = projectDir || process.cwd();
  const gitRoot = runGit(["rev-parse", "--show-toplevel"], cwd);
  return gitRoot || cwd;
}

function detectBranch(projectRoot) {
  return runGit(["branch", "--show-current"], projectRoot) || "unknown";
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readFileSize(filePath, projectRoot) {
  if (!filePath) {
    return null;
  }
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath);
  try {
    return fs.statSync(resolved).size;
  } catch {
    return null;
  }
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateTokens(charCount) {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(charCount / 4));
}

function parseIso(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nowIso() {
  return new Date().toISOString();
}

function readAnalyticsFlag(projectRoot) {
  if (process.env.PM_ANALYTICS === "1" || process.env.PM_ANALYTICS === "true") {
    return true;
  }
  const localConfig = path.join(projectRoot, ".claude", "pm.local.md");
  try {
    const content = fs.readFileSync(localConfig, "utf8");
    return /^analytics:\s*true\s*$/m.test(content);
  } catch {
    return false;
  }
}

const STEP_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function normalizeStepName(rawStep) {
  if (typeof rawStep !== "string" || rawStep.length === 0) {
    return { step: "unknown", warning: "missing step name" };
  }
  if (STEP_NAME_PATTERN.test(rawStep)) {
    return { step: rawStep, warning: null };
  }
  const head = rawStep.split(/[\s(]/, 1)[0].toLowerCase();
  const normalized = head.replace(/[^a-z0-9-]/g, "");
  if (STEP_NAME_PATTERN.test(normalized)) {
    return {
      step: normalized,
      warning: `step name "${rawStep}" is not kebab-case; normalized to "${normalized}". Step names must match ${STEP_NAME_PATTERN}.`,
    };
  }
  return {
    step: "unknown",
    warning: `step name "${rawStep}" could not be normalized to a kebab-case token; logged as "unknown".`,
  };
}

function parseMeta(jsonText) {
  if (!jsonText) {
    return {};
  }
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    usage(`Invalid JSON for --meta-json: ${jsonText}`);
  }
}

function writeJsonLine(filePath, record) {
  ensureDirectory(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
}

function currentStepFile(projectRoot) {
  return currentStepFilePath(projectRoot);
}

function readActiveStep(projectRoot) {
  try {
    const payload = JSON.parse(fs.readFileSync(currentStepFile(projectRoot), "utf8"));
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
}

function writeActiveStep(projectRoot, record) {
  const filePath = currentStepFile(projectRoot);
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

function clearActiveStep(projectRoot, stateFile) {
  const filePath = currentStepFile(projectRoot);
  if (!fs.existsSync(filePath)) {
    return;
  }
  if (!stateFile) {
    fs.unlinkSync(filePath);
    return;
  }
  const current = readActiveStep(projectRoot);
  if (!current || current.state_file === stateFile) {
    fs.unlinkSync(filePath);
  }
}

function closeActiveStep(projectRoot, options) {
  const current = readActiveStep(projectRoot);
  if (!current || !current.skill || !current.run_id || !current.step) {
    clearActiveStep(projectRoot);
    return null;
  }
  const record = writeStep(
    {
      skill: current.skill,
      runId: current.run_id,
      phase: current.phase,
      step: current.step,
      startedAt: current.started_at,
      endedAt: options.endedAt || nowIso(),
      status: options.status || "completed",
      stateFile: current.state_file,
      metaJson: current.meta ? JSON.stringify(current.meta) : undefined,
    },
    projectRoot
  );
  clearActiveStep(projectRoot);
  return record;
}

function baseContext(projectRoot) {
  return {
    project: path.basename(projectRoot),
    branch: detectBranch(projectRoot),
    host_id: getHostId(projectRoot),
  };
}

function buildActivityRecord(options, projectRoot) {
  const context = baseContext(projectRoot);
  const record = {
    skill: options.skill || "unknown",
    event: options.event || "unknown",
    ts: nowIso(),
    project: context.project,
    branch: context.branch,
    host_id: context.host_id,
  };
  if (options.detail) {
    record.detail = options.detail;
  }
  if (options.runId) {
    record.run_id = options.runId;
  }
  if (options.parentRunId) {
    record.parent_run_id = options.parentRunId;
  }
  if (options.status) {
    record.status = options.status;
  }
  const meta = parseMeta(options.metaJson);
  if (Object.keys(meta).length > 0) {
    record.meta = meta;
  }
  return record;
}

function generateRunId(skill, branch) {
  const safeSkill = String(skill || "unknown").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeBranch = String(branch || "unknown").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const entropy = crypto.randomBytes(4).toString("hex");
  return `${safeSkill}-${safeBranch}-${stamp}-${entropy}`;
}

function buildStepRecord(options, projectRoot) {
  const context = baseContext(projectRoot);
  const endedAt = options.endedAt || nowIso();
  const startedAt = options.startedAt || endedAt;
  const startedMs = parseIso(startedAt);
  const endedMs = parseIso(endedAt);
  const durationMs =
    parseNumber(options.durationMs) ??
    (startedMs !== null && endedMs !== null ? Math.max(0, endedMs - startedMs) : null);

  const { step: normalizedStep, warning: stepWarning } = normalizeStepName(options.step);
  if (stepWarning) {
    process.stderr.write(`[pm-log] ${stepWarning}\n`);
  }

  const inputChars =
    parseNumber(options.inputChars) ?? readFileSize(options.inputFile, projectRoot);
  const outputChars =
    parseNumber(options.outputChars) ?? readFileSize(options.outputFile, projectRoot);

  // tokenSource is always "estimated" or "unknown" now — we never received
  // exact provider tokens in practice (input_tokens/output_tokens were 0%
  // populated across 1848 production rows), so the column has been removed.
  const tokenSource =
    options.tokenSource || (inputChars !== null || outputChars !== null ? "estimated" : "unknown");

  const record = {
    run_id: options.runId,
    skill: options.skill,
    phase: options.phase || null,
    step: normalizedStep,
    attempt: parseNumber(options.attempt) || 1,
    actor: options.actor || "orchestrator",
    status: options.status || "completed",
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    input_chars: inputChars,
    output_chars: outputChars,
    est_input_tokens: estimateTokens(inputChars),
    est_output_tokens: estimateTokens(outputChars),
    token_source: tokenSource,
    project: context.project,
    branch: context.branch,
    host_id: context.host_id,
  };

  const meta = parseMeta(options.metaJson);
  if (options.stateFile) {
    meta.state_file = options.stateFile;
  }
  if (Object.keys(meta).length > 0) {
    record.meta = meta;
  }
  return record;
}

function writeActivity(options, projectRoot) {
  const logPath = activityFilePath(projectRoot);
  const record = buildActivityRecord(options, projectRoot);
  writeJsonLine(logPath, record);
  return record;
}

function writeStep(options, projectRoot) {
  const logPath = stepsFilePath(projectRoot);
  const record = buildStepRecord(options, projectRoot);
  writeJsonLine(logPath, record);
  return record;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    usage();
  }

  const legacyMode =
    !argv[0].startsWith("--") &&
    ![
      "activity",
      "run-start",
      "run-end",
      "step",
      "active-step-set",
      "active-step-clear",
      "active-step-close",
    ].includes(argv[0]);

  if (legacyMode) {
    const [skill, event, detail = ""] = argv;
    const projectRoot = detectProjectRoot();
    if (!readAnalyticsFlag(projectRoot)) {
      return;
    }
    writeActivity({ skill, event, detail }, projectRoot);
    return;
  }

  const [command, ...rest] = argv;
  const options = parseArgs(rest);
  const projectRoot = detectProjectRoot(options.projectDir);

  if (!readAnalyticsFlag(projectRoot)) {
    if (command === "run-start") {
      process.stdout.write("");
    }
    return;
  }

  switch (command) {
    case "activity": {
      if (!options.skill || !options.event) {
        usage("activity requires --skill and --event");
      }
      writeActivity(
        {
          skill: options.skill,
          event: options.event,
          detail: options.detail,
          runId: options["run-id"],
          status: options.status,
          metaJson: options["meta-json"],
        },
        projectRoot
      );
      return;
    }
    case "run-start": {
      if (!options.skill) {
        usage("run-start requires --skill");
      }
      const branch = detectBranch(projectRoot);
      const runId = options["run-id"] || generateRunId(options.skill, branch);
      writeActivity(
        {
          skill: options.skill,
          event: "started",
          detail: options.detail || options.args,
          runId,
          parentRunId: options["parent-run-id"],
          status: "running",
        },
        projectRoot
      );
      process.stdout.write(runId);
      return;
    }
    case "run-end": {
      if (!options.skill || !options["run-id"]) {
        usage("run-end requires --skill and --run-id");
      }
      writeActivity(
        {
          skill: options.skill,
          event: "completed",
          detail: options.detail,
          runId: options["run-id"],
          status: options.status || "completed",
          metaJson: options["meta-json"],
        },
        projectRoot
      );
      return;
    }
    case "step": {
      if (!options.skill || !options["run-id"] || !options.step) {
        usage("step requires --skill, --run-id, and --step");
      }
      writeStep(
        {
          skill: options.skill,
          runId: options["run-id"],
          phase: options.phase,
          step: options.step,
          status: options.status,
          startedAt: options["started-at"],
          endedAt: options["ended-at"],
          durationMs: options["duration-ms"],
          attempt: options.attempt,
          actor: options.actor,
          inputChars: options["input-chars"],
          outputChars: options["output-chars"],
          tokenSource: options["token-source"],
          inputFile: options["input-file"],
          outputFile: options["output-file"],
          stateFile: options["state-file"],
          metaJson: options["meta-json"],
        },
        projectRoot
      );
      return;
    }
    case "active-step-set": {
      if (!options.skill || !options["run-id"] || !options.step) {
        usage("active-step-set requires --skill, --run-id, and --step");
      }
      const { step: activeStep, warning: activeStepWarning } = normalizeStepName(options.step);
      if (activeStepWarning) {
        process.stderr.write(`[pm-log] ${activeStepWarning}\n`);
      }
      writeActiveStep(projectRoot, {
        skill: options.skill,
        run_id: options["run-id"],
        phase: options.phase || null,
        step: activeStep,
        started_at: options["started-at"] || nowIso(),
        state_file: options["state-file"] || null,
      });
      return;
    }
    case "active-step-clear": {
      clearActiveStep(projectRoot, options["state-file"]);
      return;
    }
    case "active-step-close": {
      closeActiveStep(projectRoot, {
        endedAt: options["ended-at"],
        status: options.status,
      });
      return;
    }
    default:
      usage(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main();
}

module.exports = { normalizeStepName, STEP_NAME_PATTERN };
