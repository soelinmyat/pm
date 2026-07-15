#!/usr/bin/env node
"use strict";

// First-time loop scheduler setup for a project. Generates a launchd plist
// (macOS) or cron line (Linux) that wakes loop-worker.js on an interval,
// entirely on infrastructure the user owns — no vendor scheduling service.
//
// Default is a preview only; --install performs the gate-checked scheduler mutation.
// The kill switch (pm/loop/STOP) is the always-available off button; commit and
// push it to stop workers on every machine.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { parseCliArgs } = require("./loop-args.js");
const {
  configExposure,
  exactCronIntervalMinutes,
  formatConfigExposure,
  loadLoopConfig,
  loadTrustedLoopConfig,
  sha256,
} = require("./loop-config.js");
const { evaluateCurrentCanaryReleaseGate } = require("./loop-canary.js");
const { runGit, findGitRoot, gitRelativePath } = require("./loop-git.js");
const { withRemoteSnapshot } = require("./loop-pm-transaction.js");
const { resolvePmPaths, resolvePmStateDir } = require("./resolve-pm-dir.js");
const {
  runOperationalEffect,
  sharedResourceSerialization,
} = require("./lib/operational-effect-journal.js");

function projectSlug(projectDir) {
  return path
    .basename(path.resolve(projectDir))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function launchdLabel(projectDir) {
  return `com.pm.loop.${projectSlug(projectDir)}`;
}

function xmlEscape(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// launchd runs with a minimal environment: absolute binaries + explicit PATH
// captured from the installing shell, or the engine CLI won't resolve.
function buildLaunchdPlist(opts) {
  const label = opts.label || launchdLabel(opts.projectDir);
  const argv = [
    opts.nodeBin || process.execPath,
    opts.workerScript,
    "--project-dir",
    opts.projectDir,
    "--mode",
    opts.mode || "default",
    "--scheduled",
  ];
  const intervalSeconds = (Number(opts.intervalMinutes) || 30) * 60;
  const logPath = opts.logPath || path.join(os.homedir(), "Library", "Logs", `${label}.log`);
  const pathEnv = opts.pathEnv || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...argv.map((arg) => `    <string>${xmlEscape(arg)}</string>`),
    "  </array>",
    "  <key>StartInterval</key>",
    `  <integer>${intervalSeconds}</integer>`,
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>PATH</key>",
    `    <string>${xmlEscape(pathEnv)}</string>`,
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(logPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(logPath)}</string>`,
    "  <key>ProcessType</key>",
    "  <string>Background</string>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function cronShellQuote(value) {
  // cron parses percent signs before handing the command to the shell, even
  // inside shell quotes. Escape them for cron, then quote the entire value for
  // the POSIX shell used to execute the resulting command.
  const cronSafe = String(value).replace(/%/g, "\\%");
  return `'${cronSafe.split("'").join("'\"'\"'")}'`;
}

function buildCronLine(opts) {
  const interval = exactCronIntervalMinutes(
    opts.intervalMinutes === undefined ? 30 : Number(opts.intervalMinutes)
  );
  const nodeBin = opts.nodeBin || process.execPath;
  const logPath =
    opts.logPath || path.join(os.homedir(), ".pm-loop", `${projectSlug(opts.projectDir)}.log`);
  const schedule =
    interval === 1440
      ? "0 0 * * *"
      : interval >= 60
        ? `0 */${interval / 60} * * *`
        : `*/${interval} * * * *`;
  const pathEnv = opts.pathEnv || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  return (
    `${schedule} PATH=${cronShellQuote(pathEnv)} ${cronShellQuote(nodeBin)} ` +
    `${cronShellQuote(opts.workerScript)} --project-dir ${cronShellQuote(opts.projectDir)} ` +
    `--mode ${cronShellQuote(opts.mode || "default")} --scheduled >> ${cronShellQuote(logPath)} 2>&1`
  );
}

function plistInstallPath(label) {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

function installLaunchd(plist, label) {
  const target = plistInstallPath(label);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, plist);
  try {
    execFileSync("launchctl", ["unload", target], { stdio: "ignore" });
  } catch {
    // not loaded yet — fine
  }
  execFileSync("launchctl", ["load", target], { stdio: "pipe" });
  return target;
}

function installCron(line, options = {}) {
  const run = options.run || execFileSync;
  let existing = "";
  try {
    existing = String(run("crontab", ["-l"], { encoding: "utf8" }) || "");
  } catch (error) {
    if (error && Number(error.status) !== 1) throw error;
  }
  if (existing.split(/\r?\n/).includes(line)) return "crontab";
  const input = `${existing.trimEnd()}${existing.trim() ? "\n" : ""}${line}\n`;
  run("crontab", ["-"], { input, encoding: "utf8" });
  return "crontab";
}

// The kill switch has two halves so callers on a request path can flip the
// local state instantly and push in the background:
//   writeKillSwitchFile — synchronous fs write/remove (fast, local truth)
//   pushKillSwitch      — the git commit+push that halts every machine (slow,
//                         networked; bounded by options.timeout so a hung push
//                         cannot freeze the caller).
function killSwitchFilePath(pmDir) {
  return path.join(pmDir, "loop", "STOP");
}

function writeKillSwitchFile(pmDir, stopped) {
  const stopPath = killSwitchFilePath(pmDir);
  if (stopped) {
    fs.mkdirSync(path.dirname(stopPath), { recursive: true });
    const tempPath = `${stopPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(
        tempPath,
        "Loop workers halt while this file exists. Commit and push to stop every machine.\n",
        { mode: 0o600 }
      );
      fs.renameSync(tempPath, stopPath);
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  } else if (fs.existsSync(stopPath)) {
    fs.rmSync(stopPath);
  }
  return { stopPath, stopped };
}

function pushKillSwitch(pmDir, stopped, options = {}) {
  const stopPath = killSwitchFilePath(pmDir);
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return { committed: false, pushed: false, reason: "no-git-root" };

  const timeout = options.timeout;
  let committed = false;
  try {
    const rel = gitRelativePath(gitRoot, stopPath);
    runGit(["add", "-A", "--", rel], gitRoot, { timeout });
    const changed = Boolean(runGit(["status", "--porcelain", "--", rel], gitRoot, { timeout }));
    if (changed) {
      runGit(["commit", "-m", stopped ? "pm loop stop" : "pm loop resume", "--", rel], gitRoot, {
        stdio: ["ignore", "pipe", "pipe"],
        timeout,
      });
      committed = true;
    }
    runGit(["push"], gitRoot, { stdio: ["ignore", "pipe", "pipe"], timeout });
    return { committed, pushed: true, no_change: !changed };
  } catch (err) {
    // Surface the failure — the "halt every machine" guarantee must fail loudly.
    return {
      committed,
      pushed: false,
      error: String((err && (err.stderr || err.message)) || err).slice(0, 500),
    };
  }
}

function setKillSwitch(pmDir, stopped, options = {}) {
  const file = writeKillSwitchFile(pmDir, stopped);
  const push = pushKillSwitch(pmDir, stopped, options);
  return { stopPath: file.stopPath, stopped, ...push, committed: push.committed };
}

function probeAuthoritativeStop(pmDir, options = {}) {
  if (typeof options.remoteStopProbe === "function") {
    return options.remoteStopProbe(pmDir);
  }
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) throw new Error("authoritative STOP state requires a Git root");
  runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], gitRoot);
  return withRemoteSnapshot(pmDir, (snapshot) =>
    fs.existsSync(path.join(snapshot.pmDir, "loop", "STOP"))
  );
}

function stopScheduler(pmDir, options = {}) {
  const setStop = options.setStop || setKillSwitch;
  const result = setStop(pmDir, true, options);
  if (result.pushed === true) return result;
  let confirmed = false;
  try {
    confirmed = probeAuthoritativeStop(pmDir, options) === true;
  } catch {
    confirmed = false;
  }
  if (confirmed) return { ...result, pushed: true, verified_remote: true };
  throw new Error(
    `STOP is local but was not durably pushed${result.error ? `: ${result.error}` : ""}`
  );
}

function buildInstallExposure(config) {
  return configExposure(config);
}

function releaseGateFor(paths, config, options = {}) {
  return evaluateCurrentCanaryReleaseGate(paths.pmStateDir, config, options);
}

function loadReleaseGateState(paths, options = {}) {
  const snapshot = options.snapshot || withRemoteSnapshot;
  return snapshot(paths.pmDir, (remote) => {
    const config = (options.loadTrustedConfig || loadTrustedLoopConfig)(
      remote.pmDir,
      paths.pmStateDir
    );
    const releaseGate = (options.releaseGate || releaseGateFor)(paths, config, options);
    return { config, releaseGate };
  });
}

function installPaths(projectDir, pmDir = "") {
  return pmDir ? { pmDir, pmStateDir: resolvePmStateDir(pmDir) } : resolvePmPaths(projectDir);
}

function generate(opts) {
  const workerScript = path.join(__dirname, "loop-worker.js");
  const platform = opts.format === "auto" ? process.platform : opts.format;
  const shared = {
    projectDir: opts.projectDir,
    workerScript,
    mode: opts.mode,
    intervalMinutes: opts.intervalMinutes,
    logPath: opts.logPath,
    nodeBin: opts.nodeBin,
    pathEnv: opts.pathEnv,
  };
  const exposure = opts.config ? buildInstallExposure(opts.config) : null;
  const exposureText = formatConfigExposure(exposure);
  if (platform === "darwin" || platform === "launchd") {
    const label = launchdLabel(opts.projectDir);
    return {
      kind: "launchd",
      label,
      installPath: plistInstallPath(label),
      content: buildLaunchdPlist({ ...shared, label }),
      exposure,
      instructions: [
        "Preview only — do not load this plist manually.",
        "After the same-identity canary gate passes, rerun with --install.",
        exposureText,
      ].join("\n"),
    };
  }
  const logPath =
    shared.logPath || path.join(os.homedir(), ".pm-loop", `${projectSlug(opts.projectDir)}.log`);
  return {
    kind: "cron",
    content: buildCronLine({ ...shared, logPath }),
    logPath,
    exposure,
    instructions: [
      "Preview only — do not add this line to crontab manually.",
      "After the same-identity canary gate passes, rerun with --install.",
      exposureText,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    mode: "default",
    intervalMinutes: "",
    format: "auto",
    install: false,
    stop: false,
    resume: false,
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--mode": { key: "mode", type: "string" },
      "--interval": { key: "intervalMinutes", type: "string" },
      "--format": { key: "format", type: "string" },
      "--install": { key: "install", type: "boolean" },
      "--stop": { key: "stop", type: "boolean" },
      "--resume": { key: "resume", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  args.intervalMinutes =
    args.intervalMinutes === ""
      ? 0
      : exactCronIntervalMinutes(Number(args.intervalMinutes), "--interval");
  return args;
}

function installGenerated(generated, intervalMinutes, options = {}) {
  const writeError = options.writeError || ((text) => process.stderr.write(text));
  const install = options.install || (generated.kind === "launchd" ? installLaunchd : installCron);
  writeError(
    [
      `Activating the gate-approved ${generated.kind} scheduler.`,
      formatConfigExposure(generated.exposure),
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
  if (generated.kind === "cron") {
    if (!generated.logPath) throw new Error("cron activation requires a log path");
    fs.mkdirSync(path.dirname(generated.logPath), { recursive: true, mode: 0o700 });
  }
  const installed = install(generated.content, generated.label);
  const result = {
    installed: true,
    label: generated.label,
    interval_minutes: intervalMinutes,
    exposure: generated.exposure,
  };
  if (generated.kind === "launchd") result.plist = installed;
  else {
    result.crontab = installed;
    result.log_path = generated.logPath;
  }
  return result;
}

function resumeScheduler(pmDir, config, options = {}) {
  const exposure = configExposure(config);
  const writeError = options.writeError || ((text) => process.stderr.write(text));
  const setStop = options.setStop || setKillSwitch;
  writeError(`${formatConfigExposure(exposure)}\n`);
  const result = setStop(pmDir, false, options);
  if (result.pushed !== true) {
    let remoteStopped = null;
    try {
      remoteStopped = probeAuthoritativeStop(pmDir, options);
    } catch {
      remoteStopped = null;
    }
    if (result.committed !== true && remoteStopped === false) {
      return { ...result, pushed: true, verified_remote: true, exposure };
    }

    const restored = setStop(pmDir, true, options);
    let stopConfirmed = restored.pushed === true;
    if (!stopConfirmed) {
      try {
        stopConfirmed = probeAuthoritativeStop(pmDir, options) === true;
      } catch {
        stopConfirmed = false;
      }
    }
    if (!stopConfirmed) writeKillSwitchFile(pmDir, true);
    throw new Error(
      `resume was not durably confirmed; STOP ${stopConfirmed ? "republished" : "restored locally but remote state is unknown"}${result.error ? `: ${result.error}` : ""}`
    );
  }
  return { ...result, exposure };
}

function observeLoopControl(pmDir, stopped, options = {}) {
  if (typeof options.observeControl === "function") {
    return options.observeControl(pmDir, stopped);
  }
  const localStopped = fs.existsSync(killSwitchFilePath(pmDir));
  if (localStopped !== stopped) {
    return {
      state: "absent",
      safe_to_retry: true,
      reason: stopped ? "local STOP is absent" : "local STOP is still present",
    };
  }
  let remoteStopped;
  try {
    remoteStopped = probeAuthoritativeStop(pmDir, options);
  } catch (error) {
    return { state: "ambiguous", reason: `authoritative STOP is unreadable: ${error.message}` };
  }
  if (remoteStopped !== stopped) {
    return {
      state: "absent",
      safe_to_retry: true,
      reason: "authoritative STOP does not match the requested state",
    };
  }
  const gitRoot = findGitRoot(pmDir);
  let head = null;
  try {
    head = gitRoot ? runGit(["rev-parse", "HEAD"], gitRoot) : null;
  } catch {
    head = null;
  }
  return {
    state: "verified",
    receipt: { stopped, authoritative_remote: true, head },
  };
}

function runLoopControlEffect(pmDir, stopped, options = {}) {
  const resolvedPmDir = path.resolve(pmDir);
  const pmStateDir = path.resolve(options.pmStateDir || resolvePmStateDir(resolvedPmDir));
  const serialization = sharedResourceSerialization("knowledge-base-git", resolvedPmDir);
  let resumeState = null;
  const observe = () => observeLoopControl(resolvedPmDir, stopped, options);
  const result = runOperationalEffect({
    pmStateDir,
    workflow: "loop",
    effect: stopped ? "stop-loop" : "resume-loop",
    authorityAction: "control_loop",
    authorityActions: options.authorityActions,
    serializationRoot: serialization.root,
    serializationScope: serialization.scope,
    target: { control: "pm/loop/STOP", authoritative: "git-upstream" },
    intent: { stopped, request_key: options.requestKey || null },
    precondition: () => {
      if (!stopped) {
        const loadResumeState = options.loadReleaseGateState || loadReleaseGateState;
        resumeState = loadResumeState({ pmDir: resolvedPmDir, pmStateDir }, options);
        if (!resumeState.releaseGate?.passed) {
          throw new Error(
            `loop remains paused until canary evidence passes: ${resumeState.releaseGate?.reason || "release gate did not pass"}`
          );
        }
      }
      return {
        local_stopped: fs.existsSync(killSwitchFilePath(resolvedPmDir)),
        execution_config_hash: resumeState?.config?.execution_config_hash || null,
      };
    },
    recovery: { code: "inspect-loop-control-effect", command: "/pm:loop status" },
    lockTimeoutMs: options.lockTimeoutMs,
    observe,
    mutate() {
      if (stopped) stopScheduler(resolvedPmDir, options);
      else {
        if (!resumeState?.config) throw new Error("resume effect requires trusted loop config");
        resumeScheduler(resolvedPmDir, resumeState.config, options);
      }
    },
  });
  return resumeState ? { ...result, release_gate: resumeState.releaseGate } : result;
}

function observeScheduler(generated, options = {}) {
  if (typeof options.observeScheduler === "function") {
    return options.observeScheduler(generated);
  }
  const contentHash = sha256(generated.content);
  if (generated.kind === "launchd") {
    const target = plistInstallPath(generated.label);
    if (!fs.existsSync(target) || sha256(fs.readFileSync(target)) !== contentHash) {
      return { state: "absent", safe_to_retry: true, reason: "launchd plist is absent or stale" };
    }
    try {
      execFileSync("launchctl", ["print", `gui/${process.getuid()}/${generated.label}`], {
        stdio: "ignore",
      });
    } catch {
      return { state: "absent", safe_to_retry: true, reason: "launchd job is not loaded" };
    }
    return { state: "verified", receipt: { kind: "launchd", content_sha256: contentHash } };
  }
  let existing;
  try {
    existing = String(execFileSync("crontab", ["-l"], { encoding: "utf8" }) || "");
  } catch (error) {
    if (Number(error?.status) === 1) existing = "";
    else return { state: "ambiguous", reason: `crontab is unreadable: ${error.message}` };
  }
  if (!existing.split(/\r?\n/).includes(generated.content)) {
    return { state: "absent", safe_to_retry: true, reason: "cron entry is absent" };
  }
  return { state: "verified", receipt: { kind: "cron", content_sha256: contentHash } };
}

function runSchedulerInstallEffect(generated, intervalMinutes, options = {}) {
  const pmStateDir = path.resolve(options.pmStateDir);
  const observe = () => observeScheduler(generated, options);
  const serialization =
    generated.kind === "cron"
      ? sharedResourceSerialization("machine-user-crontab", os.homedir())
      : sharedResourceSerialization("loop-scheduler-launchd", plistInstallPath(generated.label));
  return runOperationalEffect({
    pmStateDir,
    workflow: "loop",
    effect: "install-loop-scheduler",
    authorityAction: "install_loop_scheduler",
    authorityActions: options.authorityActions,
    serializationRoot: serialization.root,
    serializationScope: serialization.scope,
    target: { scheduler: generated.kind, identity: generated.label || "pm-loop-cron" },
    intent: {
      interval_minutes: intervalMinutes,
      content_sha256: sha256(generated.content),
    },
    precondition: () => ({ observed_state: observe().state }),
    recovery: { code: "inspect-loop-scheduler-effect", command: "/pm:loop status" },
    lockTimeoutMs: options.lockTimeoutMs,
    observe,
    mutate() {
      installGenerated(generated, intervalMinutes, options);
    },
  });
}

function effectExitCode(result) {
  return result?.state === "verified" ? 0 : 2;
}

function writeEffectResult(result, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ...result, ...extra }, null, 2)}\n`);
  process.exitCode = effectExitCode(result);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const paths = installPaths(args.projectDir, args.pmDir);

    if (args.stop) {
      const result = runLoopControlEffect(paths.pmDir, true, {
        pmStateDir: paths.pmStateDir,
        authorityActions: ["control_loop"],
      });
      writeEffectResult(result);
      return;
    }

    let config = loadLoopConfig(paths.pmDir);
    if (args.resume) {
      const result = runLoopControlEffect(paths.pmDir, false, {
        pmStateDir: paths.pmStateDir,
        authorityActions: ["control_loop"],
      });
      writeEffectResult(result, { release_gate: result.release_gate });
      return;
    }
    if (args.install) {
      const trusted = loadReleaseGateState(paths);
      config = trusted.config;
      const releaseGate = trusted.releaseGate;
      if (!releaseGate.passed) {
        throw new Error(
          `scheduler remains uninstalled until canary evidence passes: ${releaseGate.reason}`
        );
      }
    }
    const intervalMinutes = args.intervalMinutes || Number(config.scheduler_interval_minutes) || 30;
    const generated = generate({ ...args, intervalMinutes, config });

    if (args.install) {
      const installed = runSchedulerInstallEffect(generated, intervalMinutes, {
        pmStateDir: paths.pmStateDir,
        authorityActions: ["install_loop_scheduler"],
      });
      writeEffectResult(installed);
      return;
    }

    process.stdout.write(`${generated.content}\n`);
    process.stderr.write(`${generated.instructions}\n`);
  } catch (err) {
    process.stderr.write(`loop-install: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildInstallExposure,
  buildCronLine,
  buildLaunchdPlist,
  effectExitCode,
  generate,
  installGenerated,
  installPaths,
  installCron,
  launchdLabel,
  loadReleaseGateState,
  parseArgs,
  plistInstallPath,
  projectSlug,
  probeAuthoritativeStop,
  pushKillSwitch,
  resumeScheduler,
  runLoopControlEffect,
  runSchedulerInstallEffect,
  setKillSwitch,
  stopScheduler,
  writeKillSwitchFile,
};

if (require.main === module) {
  main();
}
