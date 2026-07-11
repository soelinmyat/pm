#!/usr/bin/env node
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildLaunch,
  defaultSchemaPath,
  extractResult,
  resolveProfile,
  validateWorkerResult,
} = require(".");
const { writeJsonAtomic } = require("./result");
const { probeCapabilities } = require("./capabilities");

const USAGE_LIMIT =
  /agent sdk credit|out of credit|insufficient.*credit|credit.*(exhaust|deplet|remaining)|usage credit|usage limit|plan.*limit|limit.*reached|quota|rate.?limit/i;
const AUTHORITY = `<worker-authority>
Root-owned external effects: this worker may inspect, edit, test, and commit only inside its assigned worktree. Do not push, open or update a pull request, merge, or update external trackers. Report completion to the root through the structured result contract.
</worker-authority>\n\n`;

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  for (const [name, value] of Object.entries({
    "prompt file": options.promptFile,
    worktree: options.worktree,
  })) {
    if (!fs.existsSync(value)) {
      process.stderr.write(`${name} not found: ${value}\n`);
      return 2;
    }
  }

  const schemaPath = options.schemaPath ?? defaultSchemaPath();
  const resultDir = path.dirname(options.resultFile);
  const baseLog = options.logFile.replace(/\.log$/, "");
  const eventsPath = `${baseLog}.events.jsonl`;
  const stderrPath = `${baseLog}.stderr.log`;
  const lastMessagePath = `${baseLog}.last-message.json`;
  const runtimePath = path.join(resultDir, "runtime.json");
  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(path.dirname(options.logFile), { recursive: true });

  const sessionId = options.resumeId || (options.runtime === "claude" ? randomUUID() : null);
  const allowBroadPermissions = process.env.PM_DEV_ALLOW_BROAD_PERMISSIONS === "1";
  let profile;
  let launch;
  try {
    const capabilities = probeCapabilities(options.runtime);
    profile = resolveProfile({
      provider: options.runtime,
      profileName: options.profileName,
      overrides: { allowBroadPermissions },
    });
    launch = buildLaunch({
      provider: options.runtime,
      profileName: options.profileName,
      profileOverrides: { allowBroadPermissions },
      worktree: options.worktree,
      resumeId: options.resumeId,
      sessionId,
      schemaPath,
      lastMessagePath,
      capabilities,
    });
  } catch (error) {
    process.stderr.write(`runtime configuration error: ${error.message}\n`);
    return 1;
  }

  const startedAt = new Date().toISOString();
  writeJsonAtomic(runtimePath, {
    schema_version: 1,
    provider: options.runtime,
    profile: profile.name,
    model: profile.model,
    effort: profile.effort,
    sandbox: profile.sandbox,
    permission_mode: profile.permissionMode,
    external_effects: false,
    resume_id: sessionId,
    worktree: options.worktree,
    started_at: startedAt,
    status: "running",
  });

  const prompt = `${AUTHORITY}${fs.readFileSync(options.promptFile, "utf8")}`;
  const execution = spawnSync(launch.command, launch.args, {
    cwd: options.worktree,
    env: process.env,
    input: prompt,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (execution.error?.code === "ENOENT") {
    finishRuntime(runtimePath, {
      status: "blocked",
      exit_status: 3,
      error: execution.error.message,
    });
    process.stderr.write(`${launch.command} CLI not in PATH\n`);
    return 3;
  }

  const stdout = execution.stdout || "";
  const stderr = execution.stderr || "";
  fs.writeFileSync(eventsPath, stdout);
  fs.writeFileSync(stderrPath, stderr);
  fs.writeFileSync(options.logFile, `${stdout}${stderr}`);

  let result;
  let resumeId = sessionId;
  try {
    if (fs.existsSync(options.resultFile)) {
      result = validateWorkerResult(fs.readFileSync(options.resultFile, "utf8"));
    } else {
      const extracted = extractResult({
        provider: options.runtime,
        events: stdout,
        lastMessagePath,
      });
      result = extracted.result;
      resumeId = extracted.resumeId ?? resumeId;
      writeJsonAtomic(options.resultFile, result);
    }
  } catch (error) {
    if (USAGE_LIMIT.test(`${stdout}\n${stderr}`)) {
      result = {
        status: "blocked",
        reason:
          options.runtime === "claude"
            ? "subprocess stopped on a Claude usage, quota, or rate limit. 'claude -p' currently draws from normal subscription usage limits; enable usage credits, wait for reset, or run on an API key. See log."
            : "subprocess stopped on a Codex usage, quota, or rate limit. Wait for reset or select another authorized profile. See log.",
        log_file: options.logFile,
      };
      writeJsonAtomic(options.resultFile, result);
    } else if (fs.existsSync(options.resultFile)) {
      result = {
        status: "blocked",
        reason: `runtime produced an invalid result: ${error.message}`,
        log_file: options.logFile,
      };
      writeJsonAtomic(options.resultFile, result);
    } else {
      finishRuntime(runtimePath, {
        status: "blocked",
        exit_status: execution.status,
        signal: execution.signal,
        error: error.message,
      });
      process.stderr.write(`Agent exited without a valid structured result: ${error.message}\n`);
      return 4;
    }
  }

  finishRuntime(runtimePath, {
    status: result.status,
    exit_status: execution.status,
    signal: execution.signal,
    resume_id: resumeId,
    events_file: eventsPath,
    stderr_file: stderrPath,
    result_file: options.resultFile,
  });
  return 0;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined)
      throw new Error(`invalid argument: ${flag}`);
    const key = {
      "--runtime": "runtime",
      "--worktree": "worktree",
      "--prompt-file": "promptFile",
      "--result-file": "resultFile",
      "--log-file": "logFile",
      "--profile": "profileName",
      "--resume-id": "resumeId",
      "--schema": "schemaPath",
    }[flag];
    if (!key) throw new Error(`unknown argument: ${flag}`);
    options[key] = value;
  }
  for (const required of ["runtime", "worktree", "promptFile", "resultFile", "logFile"]) {
    if (!options[required]) throw new Error(`--${toKebab(required)} is required`);
  }
  if (!/^(codex|claude)$/.test(options.runtime)) throw new Error("runtime must be codex or claude");
  return options;
}

function finishRuntime(filePath, patch) {
  const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
  writeJsonAtomic(filePath, { ...current, ...patch, completed_at: new Date().toISOString() });
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

if (require.main === module) process.exitCode = main();

module.exports = { AUTHORITY, main, parseArgs };
