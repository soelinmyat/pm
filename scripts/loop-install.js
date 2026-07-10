#!/usr/bin/env node
"use strict";

// First-time loop scheduler setup for a project. Generates a launchd plist
// (macOS) or cron line (Linux) that wakes loop-worker.js on an interval,
// entirely on infrastructure the user owns — no vendor scheduling service.
//
// Default is generate-and-print; --install writes the LaunchAgent and loads it.
// The kill switch (pm/loop/STOP) is the always-available off button; commit and
// push it to stop workers on every machine.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { parseCliArgs } = require("./loop-args.js");
const { configExposure, loadLoopConfig, loadTrustedLoopConfig } = require("./loop-config.js");
const { currentCanaryIdentity, evaluateCanaryReleaseGate } = require("./loop-canary.js");
const { runGit, findGitRoot, gitRelativePath } = require("./loop-git.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

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

function buildCronLine(opts) {
  const interval = Number(opts.intervalMinutes) || 30;
  const nodeBin = opts.nodeBin || process.execPath;
  const logPath =
    opts.logPath || path.join(os.homedir(), ".pm-loop", `${projectSlug(opts.projectDir)}.log`);
  const schedule =
    interval >= 60 ? `0 */${Math.round(interval / 60)} * * *` : `*/${interval} * * * *`;
  const pathEnv = opts.pathEnv || process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  return (
    `${schedule} PATH=${pathEnv} ${nodeBin} ${opts.workerScript} ` +
    `--project-dir ${opts.projectDir} --mode ${opts.mode || "default"} >> ${logPath} 2>&1`
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
    fs.writeFileSync(
      stopPath,
      "Loop workers halt while this file exists. Commit and push to stop every machine.\n"
    );
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
    runGit(["commit", "-m", stopped ? "pm loop stop" : "pm loop resume", "--", rel], gitRoot, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout,
    });
    committed = true;
    runGit(["push"], gitRoot, { stdio: ["ignore", "pipe", "pipe"], timeout });
    return { committed: true, pushed: true };
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

function buildInstallExposure(config) {
  return configExposure(config);
}

function releaseGateFor(projectDir, paths, config, options = {}) {
  const identity = currentCanaryIdentity(projectDir, config, options);
  return evaluateCanaryReleaseGate(paths.pmStateDir, identity, {
    now: options.now,
    maxAgeSeconds: config.canary.evidence_ttl_seconds,
  });
}

function generate(opts) {
  const workerScript = path.join(__dirname, "loop-worker.js");
  const platform = opts.format === "auto" ? process.platform : opts.format;
  const shared = {
    projectDir: opts.projectDir,
    workerScript,
    mode: opts.mode,
    intervalMinutes: opts.intervalMinutes,
  };
  const exposure = opts.config ? buildInstallExposure(opts.config) : null;
  const exposureText = exposure
    ? [
        `Maximum daily claim envelope: ${exposure.maximum_daily_claim_envelope_seconds}s.`,
        `Lease TTL: ${exposure.lease_ttl_seconds}s (minimum ${exposure.minimum_ttl_seconds}s; margin ${exposure.ttl_margin_seconds}s).`,
        ...exposure.warnings.map((warning) => `WARNING: ${warning}`),
      ].join("\n")
    : "";
  if (platform === "darwin" || platform === "launchd") {
    const label = launchdLabel(opts.projectDir);
    return {
      kind: "launchd",
      label,
      installPath: plistInstallPath(label),
      content: buildLaunchdPlist({ ...shared, label }),
      exposure,
      instructions: [
        `Write the plist to ${plistInstallPath(label)} and run:`,
        `  launchctl load ${plistInstallPath(label)}`,
        "or rerun this command with --install to do both.",
        exposureText,
      ].join("\n"),
    };
  }
  return {
    kind: "cron",
    content: buildCronLine(shared),
    exposure,
    instructions: ["Add the line above via `crontab -e`.", exposureText].filter(Boolean).join("\n"),
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    mode: "default",
    intervalMinutes: 0,
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
  args.intervalMinutes = Number(args.intervalMinutes) || 0;
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const paths = args.pmDir
      ? { pmDir: args.pmDir, pmStateDir: path.join(path.dirname(args.pmDir), ".pm") }
      : resolvePmPaths(args.projectDir);

    if (args.stop) {
      const result = setKillSwitch(paths.pmDir, args.stop);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    let config = loadLoopConfig(paths.pmDir);
    if (args.resume || args.install) {
      config = loadTrustedLoopConfig(paths.pmDir, paths.pmStateDir);
      const releaseGate = releaseGateFor(args.projectDir, paths, config);
      if (!releaseGate.passed) {
        throw new Error(
          `scheduler remains ${args.resume ? "paused" : "uninstalled"} until canary evidence passes: ${releaseGate.reason}`
        );
      }
      if (args.resume) {
        const result = setKillSwitch(paths.pmDir, false);
        process.stdout.write(
          `${JSON.stringify({ ...result, release_gate: releaseGate }, null, 2)}\n`
        );
        return;
      }
    }
    const intervalMinutes = args.intervalMinutes || Number(config.scheduler_interval_minutes) || 30;
    const generated = generate({ ...args, intervalMinutes, config });

    if (args.install && generated.kind === "launchd") {
      const installed = installLaunchd(generated.content, generated.label);
      process.stdout.write(
        `${JSON.stringify({ installed: true, plist: installed, label: generated.label, interval_minutes: intervalMinutes }, null, 2)}\n`
      );
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
  generate,
  evaluateCanaryReleaseGate,
  launchdLabel,
  plistInstallPath,
  projectSlug,
  pushKillSwitch,
  setKillSwitch,
  writeKillSwitchFile,
};

if (require.main === module) {
  main();
}
