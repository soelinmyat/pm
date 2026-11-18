#!/usr/bin/env node
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
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
const { writeFileAtomic } = require("../lib/atomic-file");
const { probeCapabilities, probeCapabilitiesCached } = require("./capabilities");
const { validateOwnershipList } = require("../lib/dev-work-units");
const { parseCliArgs } = require("../loop-args");
const { runGit } = require("../loop-git");

const {
  CODEX_RESULT_ENCODING,
  loadCanonicalSchema,
  buildCodexOutputSchema,
} = require("./output-schema");
const { classifyProviderFailure } = require("./failure");
const AUTHORITY = `<worker-authority>
Root-owned external effects: this worker may inspect, edit, test, and commit only inside its assigned worktree. Do not push, open or update a pull request, merge, or update external trackers. Report completion to the root through the structured result contract.
</worker-authority>\n\n`;

async function main(argv = process.argv.slice(2), observer) {
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
  const baseLog = path.resolve(options.logFile).replace(/\.log$/, "");
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
  let canonical;
  const canonicalSnapshot = `${baseLog}.canonical-schema.json`;
  const providerSchema = `${baseLog}.output-schema.json`;
  const resultEncoding = options.runtime === "codex" ? CODEX_RESULT_ENCODING : undefined;
  try {
    const retained = options.resumeId
      ? retainedResumeProfile(
          runtimePath,
          options,
          allowBroadPermissions,
          observer?.executionDirectory
        )
      : null;
    const capabilities = probeCapabilitiesCached(options.runtime);
    profile =
      retained ||
      resolveProfile({
        provider: options.runtime,
        profileName: options.profileName,
        sourceDir: options.worktree,
        overrides: { allowBroadPermissions, ...(observer ? { sandbox: "read-only" } : {}) },
      });
    if (observer && (profile.sandbox !== "read-only" || profile.approvalPolicy !== "never"))
      throw new Error(
        "observed design review requires read-only runtime and unchanged approval policy"
      );
    if (
      observer?.images?.length &&
      !capabilities.imageInput &&
      !probeCapabilities("codex").imageInput
    )
      throw new Error("Codex does not support verified image input");
    canonical = loadCanonicalSchema(schemaPath);
    writeFileAtomic(canonicalSnapshot, canonical.bytes, { directoryMode: 0o700, fileMode: 0o600 });
    if (options.runtime === "codex")
      writeJsonAtomic(providerSchema, buildCodexOutputSchema(canonical.schema));
    launch = buildLaunch({
      provider: options.runtime,
      // Freeze the same resolved selection for launch and runtime.json. Do not
      // reread policy between selecting the receipt identity and dispatching.
      profileName: profile.name,
      profileOverrides: { ...profile, allowBroadPermissions },
      worktree: observer?.executionDirectory ?? options.worktree,
      resumeId: options.resumeId,
      sessionId,
      schemaPath: options.runtime === "codex" ? providerSchema : canonicalSnapshot,
      lastMessagePath,
      images: observer?.images,
      capabilities,
    });
  } catch (error) {
    process.stderr.write(`runtime configuration error: ${error.message}\n`);
    return error.code === "ENOENT" || error.cause?.code === "ENOENT" ? 3 : 1;
  }

  fs.rmSync(options.resultFile, { force: true });
  const startedAt = new Date().toISOString();
  const runtime = {
    schema_version: 1,
    provider: options.runtime,
    profile: profile.name,
    model: profile.model,
    effort: profile.effort,
    sandbox: profile.sandbox,
    permission_mode: profile.permissionMode,
    ...(observer
      ? {
          approval_policy: profile.approvalPolicy,
          execution_directory: observer.executionDirectory,
        }
      : {}),
    external_effects: false,
    resume_id: sessionId,
    work_unit_id: options.workUnitId,
    worktree: options.worktree,
    started_at: startedAt,
    status: "running",
    canonical_schema_sha256: canonical.sha256,
    canonical_schema_file: canonicalSnapshot,
    output_schema_file: options.runtime === "codex" ? providerSchema : canonicalSnapshot,
    result_encoding: resultEncoding ?? "canonical-object",
  };
  writeJsonAtomic(runtimePath, runtime);

  const transport =
    options.runtime === "codex"
      ? "Final response uses the generated result_json transport string: serialize the complete canonical worker result inside it. Any directly written result file must contain the canonical object, not the transport envelope.\n\n"
      : "";
  const prompt = `${AUTHORITY}${transport}${fs.readFileSync(options.promptFile, "utf8")}`;
  const execution = await runStreaming(launch.command, launch.args, {
    cwd: observer?.executionDirectory ?? options.worktree,
    env: process.env,
    input: prompt,
    eventsPath,
    stderrPath,
    logFile: options.logFile,
    onEvent: observer?.onEvent,
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
  let resumeId = execution.resumeId ?? sessionId;
  const failure = classifyProviderFailure(execution.failureEvents || stdout, stderr);
  try {
    // A failed provider turn cannot be certified by an older message artifact.
    if (execution.status !== 0 && failure) throw new Error(`provider failure: ${failure}`);
    if (observer && (execution.status !== 0 || failure || execution.failureEvents))
      throw new Error("the observed provider turn did not finish successfully");
    if (observer && fs.existsSync(options.resultFile))
      throw new Error("an observed worker must return its result through the provider");

    if (fs.existsSync(options.resultFile)) {
      result = validateWorkerResult(fs.readFileSync(options.resultFile, "utf8"), {
        expectedWorkUnitId: options.workUnitId,
        expectedOwnership: options.owns,
        worktree: options.worktree,
        allowLegacyMerged: process.env.PM_DEV_LEGACY_DISPATCH === "1",
      });
      if (result.status !== "merged") canonical.validate(result);
    } else {
      const extracted = extractResult({
        provider: options.runtime,
        events: stdout,
        lastMessagePath,
        resultEncoding,
      });
      result = extracted.result;
      if (observer) observer.verifyResult(result, { resultEncoding, resumeId: execution.resumeId });
      validateWorkerResult(result, {
        expectedWorkUnitId: options.workUnitId,
        expectedOwnership: options.owns,
        worktree: options.worktree,
        baseCommit: observer?.baseCommit,
      });
      canonical.validate(result);
      resumeId = extracted.resumeId ?? resumeId;
      writeJsonAtomic(options.resultFile, result);
    }
  } catch (error) {
    if (failure === "invalid-output-schema" || failure === "provider-request-rejected") {
      result = blockedResult(
        options,
        profile,
        failure === "invalid-output-schema"
          ? "Provider output schema was rejected. Inspect the retained canonical and transport schemas and provider error; this is a deterministic request failure. See log."
          : "Provider request was rejected (HTTP 400). Inspect the retained provider error and request configuration. See log."
      );
      writeJsonAtomic(options.resultFile, result);
    } else if (failure === "usage-limit") {
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
        resume_id: resumeId,
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

  const completion = {
    status: result.status,
    exit_status: execution.status,
    signal: execution.signal,
    resume_id: resumeId,
    events_file: eventsPath,
    stderr_file: stderrPath,
    result_file: options.resultFile,
  };
  const completedAt = new Date().toISOString();
  if (observer) {
    const record = { ...runtime, ...completion, completed_at: completedAt };
    writeJsonAtomic(runtimePath, record);
    observer.complete(result, record);
  } else finishRuntime(runtimePath, completion);
  return 0;
}

function retainedResumeProfile(runtimePath, options, allowBroadPermissions, executionDirectory) {
  let fd;
  try {
    fd = fs.openSync(runtimePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    const limit = 64 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error("invalid receipt file");
    const buffer = Buffer.alloc(limit + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > limit) throw new Error("receipt exceeds limit");
    const recorded = JSON.parse(buffer.subarray(0, length));
    if (
      recorded.schema_version !== 1 ||
      recorded.provider !== options.runtime ||
      recorded.resume_id !== options.resumeId ||
      recorded.external_effects !== false ||
      (executionDirectory && recorded.execution_directory !== executionDirectory) ||
      typeof recorded.worktree !== "string" ||
      fs.realpathSync(recorded.worktree) !== fs.realpathSync(options.worktree) ||
      (recorded.work_unit_id !== undefined && recorded.work_unit_id !== options.workUnitId) ||
      ![recorded.profile, recorded.model, recorded.effort].every(
        (v) => typeof v === "string" && v.length > 0
      ) ||
      (options.profileName && options.profileName !== recorded.profile)
    )
      throw new Error("resume identity does not match receipt");
    const permissionKey = options.runtime === "codex" ? "sandbox" : "permissionMode";
    const permission = options.runtime === "codex" ? recorded.sandbox : recorded.permission_mode;
    if (typeof permission !== "string" || !permission) throw new Error("missing permissions");
    return resolveProfile({
      provider: options.runtime,
      profileName: recorded.profile,
      env: {},
      overrides: {
        model: recorded.model,
        effort: recorded.effort,
        [permissionKey]: permission,
        allowBroadPermissions,
      },
    });
  } catch (error) {
    throw new Error(`resume requires matching recorded runtime: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
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
  const systemEvents = new BoundedBuffer(lineLimit);
  let identityEvent = "";
  let resultEvent = "";
  let failureEvent = "";
  const stdoutTail = new BoundedBuffer(limit);
  const stderrTail = new BoundedBuffer(limit);
  let pending = "";
  const decoder = new StringDecoder("utf8");
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
    const observeEventText = (text) => {
      pending = boundedTail(pending, text, lineLimit);
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          options.onEvent?.(event);
          if (["thread.started", "system"].includes(event.type) && !identityEvent) {
            identityEvent = line;
          }
          if (event.type === "system") systemEvents.append(`${line}\n`);
          if (event.type === "result") resultEvent = boundedTail("", line, lineLimit);
          if (
            ["error", "turn.failed"].includes(event.type) ||
            (event.type === "result" && event.is_error === true)
          )
            failureEvent = boundedTail("", line, lineLimit);
        } catch {
          if (line.trim()) options.onEvent?.(null);
          // Non-JSON output remains in the bounded tail and full events file.
        }
      }
    };
    child.stdout.on("data", (chunk) => {
      // Keep the exact bytes on disk while decoding event text across chunks.
      fs.writeSync(eventsFd, chunk);
      stdoutTail.append(chunk);
      observeEventText(decoder.write(chunk));
    });
    child.stderr.on("data", (chunk) => {
      fs.writeSync(stderrFd, chunk);
      stderrTail.append(chunk);
    });
    child.on("close", (status, signal) => {
      observeEventText(`${decoder.end()}\n`);
      fs.closeSync(eventsFd);
      fs.closeSync(stderrFd);
      const identity = identityEvent ? JSON.parse(identityEvent) : null;
      const resumeId = identity?.thread_id ?? identity?.threadId ?? identity?.session_id ?? null;
      const stdoutText = stdoutTail.toString();
      const stderrText = stderrTail.toString();
      const extractionEvents = [identityEvent, systemEvents.toString(), resultEvent, stdoutText]
        .filter(Boolean)
        .join("\n");
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
        resumeId,
        stderrTail: stderrText,
        failureEvents: failureEvent,
      });
    });
    // A runtime that exits before reading its prompt closes the pipe. Its
    // exit status, recorded on close, is the outcome; EPIPE is not a crash.
    child.stdin.on("error", (error) => {
      if (error.code !== "EPIPE") spawnError ??= error;
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
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
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
