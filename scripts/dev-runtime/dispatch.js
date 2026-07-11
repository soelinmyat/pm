#!/usr/bin/env node
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
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
const { probeCapabilitiesCached } = require("./capabilities");
const { validateOwnershipList } = require("../lib/dev-work-units");
const { parseCliArgs } = require("../loop-args");
const { runGit } = require("../loop-git");

const USAGE_LIMIT =
  /agent sdk credit|out of credit|insufficient.*credit|credit.*(exhaust|deplet|remaining)|usage credit|usage limit|plan.*limit|limit.*reached|quota|rate.?limit/i;
const AUTHORITY = `<worker-authority>
Root-owned external effects: this worker may inspect, edit, test, and commit only inside its assigned worktree. Do not push, open or update a pull request, merge, or update external trackers. Report completion to the root through the structured result contract.
</worker-authority>\n\n`;

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }

  if (!fs.existsSync(options.promptFile) || !fs.statSync(options.promptFile).isFile()) {
    process.stderr.write(`prompt file is not a regular file: ${options.promptFile}\n`);
    return 2;
  }
  if (!fs.existsSync(options.worktree) || !fs.statSync(options.worktree).isDirectory()) {
    process.stderr.write(`worktree is not a directory: ${options.worktree}\n`);
    return 2;
  }
  try {
    runGit(["rev-parse", "--show-toplevel"], options.worktree, { timeout: 10_000 });
    validateOwnershipList(options.owns, "assigned ownership");
  } catch (error) {
    process.stderr.write(`invalid dispatch scope: ${error.message}\n`);
    return 2;
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
  fs.rmSync(options.resultFile, { force: true });

  const sessionId = options.resumeId || (options.runtime === "claude" ? randomUUID() : null);
  const allowBroadPermissions = process.env.PM_DEV_ALLOW_BROAD_PERMISSIONS === "1";
  let profile;
  let launch;
  try {
    const capabilities = probeCapabilitiesCached(options.runtime);
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
    return error.code === "ENOENT" || error.cause?.code === "ENOENT" ? 3 : 1;
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
  const execution = await runStreaming(launch.command, launch.args, {
    cwd: options.worktree,
    env: process.env,
    input: prompt,
    eventsPath,
    stderrPath,
    logFile: options.logFile,
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

  const stdout = execution.extractionEvents || "";
  const stderr = execution.stderrTail || "";

  let result;
  let resumeId = sessionId;
  try {
    if (fs.existsSync(options.resultFile)) {
      result = validateWorkerResult(fs.readFileSync(options.resultFile, "utf8"), {
        expectedWorkUnitId: options.workUnitId,
        expectedOwnership: options.owns,
        worktree: options.worktree,
        allowLegacyMerged: process.env.PM_DEV_LEGACY_DISPATCH === "1",
      });
    } else {
      const extracted = extractResult({
        provider: options.runtime,
        events: stdout,
        lastMessagePath,
      });
      result = extracted.result;
      validateWorkerResult(result, {
        expectedWorkUnitId: options.workUnitId,
        expectedOwnership: options.owns,
        worktree: options.worktree,
      });
      resumeId = extracted.resumeId ?? resumeId;
      writeJsonAtomic(options.resultFile, result);
    }
  } catch (error) {
    if (USAGE_LIMIT.test(`${stdout}\n${stderr}`)) {
      result = blockedResult(
        options,
        profile,
        options.runtime === "claude"
          ? "subprocess stopped on a Claude usage, quota, or rate limit. 'claude -p' currently draws from normal subscription usage limits; enable usage credits, wait for reset, or run on an API key. See log."
          : "subprocess stopped on a Codex usage, quota, or rate limit. Wait for reset or select another authorized profile. See log."
      );
      writeJsonAtomic(options.resultFile, result);
    } else if (fs.existsSync(options.resultFile)) {
      result = blockedResult(
        options,
        profile,
        `runtime produced an invalid result: ${error.message}`
      );
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

  if (execution.status !== 0 && result.status === "completed") {
    result = blockedResult(
      options,
      profile,
      `runtime exited ${execution.status} after writing a completed result`
    );
    writeJsonAtomic(options.resultFile, result);
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
  const spec = Object.fromEntries(
    Object.entries({
      "--runtime": "runtime",
      "--worktree": "worktree",
      "--prompt-file": "promptFile",
      "--result-file": "resultFile",
      "--log-file": "logFile",
      "--profile": "profileName",
      "--resume-id": "resumeId",
      "--schema": "schemaPath",
      "--work-unit-id": "workUnitId",
      "--owns-json": "ownsJson",
    }).map(([flag, key]) => [flag, { key, type: "string" }])
  );
  const { args: options, positionals } = parseCliArgs(argv, spec);
  if (positionals.length > 0) throw new Error(`unexpected argument: ${positionals[0]}`);
  for (const required of [
    "runtime",
    "worktree",
    "promptFile",
    "resultFile",
    "logFile",
    "workUnitId",
    "ownsJson",
  ]) {
    if (!options[required]) throw new Error(`--${toKebab(required)} is required`);
  }
  if (!/^(codex|claude)$/.test(options.runtime)) throw new Error("runtime must be codex or claude");
  try {
    options.owns = JSON.parse(options.ownsJson);
  } catch (error) {
    throw new Error(`--owns-json must be a JSON array: ${error.message}`);
  }
  if (!Array.isArray(options.owns) || options.owns.length === 0) {
    throw new Error("--owns-json must be a non-empty JSON array");
  }
  return options;
}

function blockedResult(options, profile, reason) {
  return {
    schema_version: 1,
    work_unit_id: options.workUnitId,
    status: "blocked",
    summary: "Runtime could not complete the assigned work unit.",
    reason,
    commit: null,
    files_changed: 0,
    evidence: [],
    blocker: { reason, remediation: `Inspect ${options.logFile}` },
    runtime: { provider: options.runtime, model: profile.model, log_file: options.logFile },
  };
}

function finishRuntime(filePath, patch) {
  const current = JSON.parse(fs.readFileSync(filePath, "utf8"));
  writeJsonAtomic(filePath, { ...current, ...patch, completed_at: new Date().toISOString() });
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function runStreaming(command, args, options) {
  const limit = 4 * 1024 * 1024;
  const lineLimit = 1024 * 1024;
  const important = new BoundedBuffer(lineLimit);
  const stdoutTail = new BoundedBuffer(limit);
  const stderrTail = new BoundedBuffer(limit);
  let pending = "";
  const eventsFd = secureOpen(options.eventsPath);
  const stderrFd = secureOpen(options.stderrPath);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let spawnError = null;
    child.on("error", (error) => {
      spawnError = error;
    });
    child.stdout.on("data", (chunk) => {
      fs.writeSync(eventsFd, chunk);
      const text = chunk.toString("utf8");
      stdoutTail.append(chunk);
      pending = boundedTail(pending, text, lineLimit);
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          if (["thread.started", "system", "result"].includes(event.type)) {
            important.append(`${line}\n`);
          }
        } catch {
          // Non-JSON output remains in the bounded tail and full events file.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      fs.writeSync(stderrFd, chunk);
      stderrTail.append(chunk);
    });
    child.on("close", (status, signal) => {
      fs.closeSync(eventsFd);
      fs.closeSync(stderrFd);
      const stdoutText = stdoutTail.toString();
      const stderrText = stderrTail.toString();
      const extractionEvents = `${important.toString()}\n${stdoutText}`;
      const log = [
        `events_file=${options.eventsPath}`,
        `stderr_file=${options.stderrPath}`,
        "",
        "--- bounded stdout tail ---",
        stdoutText,
        "--- bounded stderr tail ---",
        stderrText,
      ].join("\n");
      secureWrite(options.logFile, log);
      resolve({
        status,
        signal,
        error: spawnError,
        extractionEvents,
        stderrTail: stderrText,
      });
    });
    child.stdin.end(options.input);
  });
}

function secureOpen(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const descriptor = fs.openSync(filePath, "w", 0o600);
  fs.fchmodSync(descriptor, 0o600);
  return descriptor;
}

function secureWrite(filePath, content) {
  const descriptor = secureOpen(filePath);
  try {
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function boundedTail(current, addition, limit) {
  const tail = new BoundedBuffer(limit);
  tail.append(current);
  tail.append(addition);
  return tail.toString();
}

class BoundedBuffer {
  constructor(limit) {
    this.limit = limit;
    this.chunks = [];
    this.bytes = 0;
  }

  append(value) {
    let chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
    if (chunk.length >= this.limit) {
      this.chunks = [chunk.subarray(chunk.length - this.limit)];
      this.bytes = this.limit;
      return;
    }
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.limit) {
      const excess = this.bytes - this.limit;
      const first = this.chunks[0];
      if (first.length <= excess) {
        this.chunks.shift();
        this.bytes -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.bytes -= excess;
      }
    }
  }

  toString() {
    return Buffer.concat(this.chunks, this.bytes).toString("utf8");
  }
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`dev runtime dispatch failed: ${error.message}\n`);
      process.exitCode = 1;
    }
  );
}

module.exports = { AUTHORITY, BoundedBuffer, boundedTail, main, parseArgs, runStreaming };
