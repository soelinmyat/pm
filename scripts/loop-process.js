#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;

function isoNow() {
  return new Date().toISOString();
}

function serializableError(error) {
  if (!error) return null;
  return {
    code: error.code || "ECHILD",
    message: String(error.message || error).slice(0, 2000),
    signal: error.signal || null,
  };
}

function signalProcessGroup(child, signal) {
  if (!child || !Number.isInteger(child.pid)) return false;
  try {
    if (process.platform !== "win32") process.kill(-child.pid, signal);
    else child.kill(signal);
    return true;
  } catch (error) {
    if (error && error.code === "ESRCH") return false;
    try {
      child.kill(signal);
      return true;
    } catch {
      return false;
    }
  }
}

function processGroupExists(child) {
  if (!child || !Number.isInteger(child.pid)) return false;
  if (process.platform === "win32") return child.exitCode === null;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function runQuiet(bin, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: "ignore",
      });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The bounded command already exited.
        }
      },
      Math.max(100, Number(options.timeoutMs || 5000))
    );
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

function runCapture(bin, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    let output = "";
    try {
      child = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve("");
      return;
    }
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {
          // The bounded command already exited.
        }
      },
      Math.max(100, Number(options.timeoutMs || 5000))
    );
    child.stdout.on("data", (chunk) => {
      if (output.length < 4096) output += String(chunk).slice(0, 4096 - output.length);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output.trim() : "");
    });
  });
}

async function remoteStopExists(remoteStop) {
  if (
    !remoteStop ||
    !remoteStop.gitDir ||
    !remoteStop.remote ||
    !remoteStop.ref ||
    !remoteStop.path
  ) {
    return false;
  }
  const remoteLine = await runCapture("git", ["ls-remote", remoteStop.remote, remoteStop.ref], {
    timeoutMs: remoteStop.timeoutMs,
  });
  const remoteOid = remoteLine.split(/\s+/)[0] || "";
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i.test(remoteOid)) return false;
  if (remoteStop.last_oid === remoteOid) return false;
  const common = ["--git-dir", remoteStop.gitDir];
  const fetched = await runQuiet(
    "git",
    [...common, "fetch", "--quiet", "--depth=1", remoteStop.remote, remoteStop.ref],
    { timeoutMs: remoteStop.timeoutMs }
  );
  if (!fetched) return false;
  remoteStop.last_oid = remoteOid;
  return runQuiet("git", [...common, "cat-file", "-e", `FETCH_HEAD:${remoteStop.path}`], {
    timeoutMs: remoteStop.timeoutMs,
  });
}

function createOutputSink(filePath, maxBuffer) {
  let fd = null;
  const chunks = [];
  let bytes = 0;
  let truncated = false;
  if (filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fd = fs.openSync(filePath, "w", 0o600);
    fs.chmodSync(filePath, 0o600);
  }
  return {
    write(chunk) {
      const buffer = Buffer.from(chunk);
      const remaining = Math.max(0, maxBuffer - bytes);
      const accepted = buffer.subarray(0, remaining);
      if (fd !== null && accepted.length > 0) fs.writeSync(fd, accepted);
      if (fd === null && accepted.length > 0) chunks.push(accepted);
      bytes += accepted.length;
      if (accepted.length < buffer.length) truncated = true;
      return truncated;
    },
    close() {
      if (fd !== null) fs.closeSync(fd);
      fd = null;
    },
    value() {
      return Buffer.concat(chunks).toString("utf8");
    },
    truncated() {
      return truncated;
    },
  };
}

function runEngineInterruptible(bin, args, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs || 1));
  const graceMs = Math.max(1, Number(options.graceMs || 1));
  const pollMs = Math.max(10, Number(options.pollMs || 250));
  const maxBuffer = Math.max(1024, Number(options.maxBuffer || DEFAULT_MAX_BUFFER));
  const stdout = createOutputSink(options.stdoutPath, maxBuffer);
  const stderr = createOutputSink(options.stderrPath, maxBuffer);
  const startedAt = isoNow();

  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timedOut = false;
    let stopped = false;
    let termReason = "";
    let termTimer = null;
    let timeoutTimer = null;
    let pollTimer = null;
    let spawnError = null;
    let closeResult = null;
    let escalationComplete = false;
    let remoteProbeInFlight = false;
    let lastRemoteProbeAt = 0;
    const stop = {
      path: options.stopPath || "",
      source: null,
      requested_at: null,
      term_sent_at: null,
      term_signal: null,
      kill_sent_at: null,
      kill_signal: null,
    };

    const clearTimers = () => {
      if (termTimer) clearTimeout(termTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (pollTimer) clearInterval(pollTimer);
    };

    const requestTermination = (reason) => {
      if (termReason || settled) return;
      termReason = reason;
      const at = isoNow();
      if (reason === "stop-local" || reason === "stop-remote") {
        stopped = true;
        stop.source = reason === "stop-remote" ? "remote" : "local";
        stop.requested_at = at;
      } else if (reason === "timeout") {
        timedOut = true;
      }
      if (signalProcessGroup(child, "SIGTERM")) {
        stop.term_sent_at = at;
        stop.term_signal = "SIGTERM";
      }
      termTimer = setTimeout(() => {
        if (!settled && signalProcessGroup(child, "SIGKILL")) {
          stop.kill_sent_at = isoNow();
          stop.kill_signal = "SIGKILL";
        }
        escalationComplete = true;
        if (closeResult) finish(closeResult.code, closeResult.signal);
      }, graceMs);
    };

    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      stdout.close();
      stderr.close();
      const error =
        spawnError ||
        (stdout.truncated() || stderr.truncated()
          ? { code: "ENOBUFS", message: `engine output exceeded ${maxBuffer} bytes` }
          : timedOut
            ? { code: "ETIMEDOUT", message: `engine exceeded ${timeoutMs}ms`, signal }
            : null);
      resolve({
        status: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout: options.stdoutPath ? "" : stdout.value(),
        stderr: options.stderrPath ? "" : stderr.value(),
        error: serializableError(error),
        started_at: startedAt,
        ended_at: isoNow(),
        timed_out: timedOut,
        stopped,
        stop: stopped ? stop : undefined,
        logs_written: Boolean(options.stdoutPath || options.stderrPath),
      });
    };

    try {
      child = spawn(bin, args, {
        cwd: options.cwd,
        env: options.env,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      spawnError = error;
      finish(null, null);
      return;
    }

    child.stdout.on("data", (chunk) => {
      if (stdout.write(chunk)) requestTermination("buffer");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.write(chunk)) requestTermination("buffer");
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code, signal) => {
      closeResult = { code, signal };
      if (!termReason || escalationComplete || !processGroupExists(child)) finish(code, signal);
    });
    try {
      if (options.stopPath && fs.existsSync(options.stopPath)) requestTermination("stop-local");
    } catch {
      // Interval polling and the bounded runtime remain as fallbacks.
    }
    if (child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input || "");
    }

    timeoutTimer = setTimeout(() => requestTermination("timeout"), timeoutMs);
    if (options.stopPath || options.remoteStop) {
      pollTimer = setInterval(() => {
        try {
          if (options.stopPath && fs.existsSync(options.stopPath)) {
            requestTermination("stop-local");
            return;
          }
        } catch {
          // A transient read error must not crash the worker. The bounded
          // runtime remains the fallback control.
        }
        const remotePollMs = Math.max(
          pollMs,
          Number(options.remoteStop && options.remoteStop.pollMs) || 5000
        );
        if (
          options.remoteStop &&
          !remoteProbeInFlight &&
          Date.now() - lastRemoteProbeAt >= remotePollMs
        ) {
          remoteProbeInFlight = true;
          lastRemoteProbeAt = Date.now();
          remoteStopExists(options.remoteStop)
            .then((present) => {
              if (present) requestTermination("stop-remote");
            })
            .finally(() => {
              remoteProbeInFlight = false;
            });
        }
      }, pollMs);
    }
  });
}

function runEngineInterruptibleSync(bin, args, options = {}) {
  const invoke = options.supervisorSpawnSync || spawnSync;
  const envelope = {
    bin,
    args,
    options: {
      cwd: options.cwd,
      env: options.env,
      input: options.input || "",
      stopPath: options.stopPath || "",
      remoteStop: options.remoteStop || null,
      timeoutMs: options.timeoutMs,
      graceMs: options.graceMs,
      pollMs: options.pollMs,
      maxBuffer: options.maxBuffer,
      stdoutPath: options.stdoutPath,
      stderrPath: options.stderrPath,
    },
  };
  const supervisorTimeout =
    Math.max(1, Number(options.timeoutMs || 1)) + Math.max(1, Number(options.graceMs || 1)) + 5000;
  const supervised = invoke(process.execPath, [__filename, "--supervise"], {
    input: JSON.stringify(envelope),
    encoding: "utf8",
    timeout: supervisorTimeout,
    maxBuffer: 1024 * 1024,
    env: process.env,
  });
  if (supervised.status !== 0 || supervised.error) {
    return {
      status: null,
      signal: supervised.signal || null,
      stdout: "",
      stderr: supervised.stderr || "",
      error: serializableError(
        supervised.error || {
          code: "ESUPERVISOR",
          message: supervised.stderr || `engine supervisor exited ${supervised.status}`,
          signal: supervised.signal,
        }
      ),
    };
  }
  try {
    return JSON.parse(supervised.stdout);
  } catch (error) {
    return {
      status: null,
      signal: null,
      stdout: "",
      stderr: supervised.stderr || "",
      error: serializableError({ code: "ESUPERVISOR", message: error.message }),
    };
  }
}

async function main() {
  if (process.argv[2] !== "--supervise") throw new Error("expected --supervise");
  const input = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!input || typeof input.bin !== "string" || !Array.isArray(input.args)) {
    throw new Error("invalid supervisor input");
  }
  const result = await runEngineInterruptible(input.bin, input.args, input.options || {});
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

module.exports = {
  runEngineInterruptible,
  runEngineInterruptibleSync,
  signalProcessGroup,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`loop-process: ${error.message}\n`);
    process.exit(1);
  });
}
