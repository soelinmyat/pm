#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

function usage(message) {
  if (message) {
    console.error(message);
  }
  console.error(`Usage:
  pm-log.sh <skill> <event> [detail]
  pm-log.sh activity --skill <skill> --event <event> [--detail <detail>] [--run-id <id>] [--status <status>] [--meta-json <json>]
  pm-log.sh run-start --skill <skill> [--args <args>] [--detail <detail>] [--run-id <id>]
  pm-log.sh run-end --skill <skill> --run-id <id> [--status <status>] [--detail <detail>] [--meta-json <json>]
  pm-log.sh step --skill <skill> --run-id <id> --step <step> [--phase <phase>] [--status <status>] [--started-at <iso>] [--ended-at <iso>] [--duration-ms <n>] [--attempt <n>] [--actor <actor>] [--input-chars <n>] [--output-chars <n>] [--input-tokens <n>] [--output-tokens <n>] [--token-source <source>] [--tool-calls <n>] [--files-read <n>] [--files-written <n>] [--input-file <path>] [--output-file <path>] [--meta-json <json>]`);
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

function baseContext(projectRoot) {
  return {
    project: path.basename(projectRoot),
    branch: detectBranch(projectRoot),
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
  };
  if (options.detail) {
    record.detail = options.detail;
  }
  if (options.runId) {
    record.run_id = options.runId;
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

  const inputChars =
    parseNumber(options.inputChars) ?? readFileSize(options.inputFile, projectRoot);
  const outputChars =
    parseNumber(options.outputChars) ?? readFileSize(options.outputFile, projectRoot);
  const inputTokens = parseNumber(options.inputTokens);
  const outputTokens = parseNumber(options.outputTokens);

  let tokenSource = options.tokenSource || null;
  if (!tokenSource) {
    if (inputTokens !== null || outputTokens !== null) {
      tokenSource = "exact";
    } else if (inputChars !== null || outputChars !== null) {
      tokenSource = "estimated";
    } else {
      tokenSource = "unknown";
    }
  }

  const record = {
    run_id: options.runId,
    skill: options.skill,
    phase: options.phase || null,
    step: options.step,
    attempt: parseNumber(options.attempt) || 1,
    actor: options.actor || "orchestrator",
    status: options.status || "completed",
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    input_chars: inputChars,
    output_chars: outputChars,
    est_input_tokens: inputTokens ?? estimateTokens(inputChars),
    est_output_tokens: outputTokens ?? estimateTokens(outputChars),
    token_source: tokenSource,
    tool_calls: parseNumber(options.toolCalls),
    files_read: parseNumber(options.filesRead),
    files_written: parseNumber(options.filesWritten),
    project: context.project,
    branch: context.branch,
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
  const logPath = path.join(projectRoot, ".pm", "analytics", "activity.jsonl");
  const record = buildActivityRecord(options, projectRoot);
  writeJsonLine(logPath, record);
  return record;
}

function writeStep(options, projectRoot) {
  const logPath = path.join(projectRoot, ".pm", "analytics", "steps.jsonl");
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
    !argv[0].startsWith("--") && !["activity", "run-start", "run-end", "step"].includes(argv[0]);

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
          inputTokens: options["input-tokens"],
          outputTokens: options["output-tokens"],
          tokenSource: options["token-source"],
          toolCalls: options["tool-calls"],
          filesRead: options["files-read"],
          filesWritten: options["files-written"],
          inputFile: options["input-file"],
          outputFile: options["output-file"],
          stateFile: options["state-file"],
          metaJson: options["meta-json"],
        },
        projectRoot
      );
      return;
    }
    default:
      usage(`Unknown command: ${command}`);
  }
}

main();
