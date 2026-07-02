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
const { loadLoopConfig } = require("./loop-config.js");
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
    opts.mode || "dev",
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
    `--project-dir ${opts.projectDir} --mode ${opts.mode || "dev"} >> ${logPath} 2>&1`
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

function setKillSwitch(pmDir, stopped) {
  const stopPath = path.join(pmDir, "loop", "STOP");
  if (stopped) {
    fs.mkdirSync(path.dirname(stopPath), { recursive: true });
    fs.writeFileSync(
      stopPath,
      "Loop workers halt while this file exists. Commit and push to stop every machine.\n"
    );
  } else if (fs.existsSync(stopPath)) {
    fs.rmSync(stopPath);
  }

  const gitRoot = findGitRoot(pmDir);
  let committed = false;
  if (gitRoot) {
    try {
      const rel = gitRelativePath(gitRoot, stopPath);
      runGit(["add", "-A", "--", rel], gitRoot);
      runGit(["commit", "-m", stopped ? "pm loop stop" : "pm loop resume", "--", rel], gitRoot, {
        stdio: ["ignore", "pipe", "pipe"],
      });
      runGit(["push"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
      committed = true;
    } catch {
      committed = false;
    }
  }
  return { stopPath, stopped, committed };
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
  if (platform === "darwin" || platform === "launchd") {
    const label = launchdLabel(opts.projectDir);
    return {
      kind: "launchd",
      label,
      installPath: plistInstallPath(label),
      content: buildLaunchdPlist({ ...shared, label }),
      instructions: [
        `Write the plist to ${plistInstallPath(label)} and run:`,
        `  launchctl load ${plistInstallPath(label)}`,
        "or rerun this command with --install to do both.",
      ].join("\n"),
    };
  }
  return {
    kind: "cron",
    content: buildCronLine(shared),
    instructions: "Add the line above via `crontab -e`.",
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    mode: "dev",
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
    const paths = args.pmDir ? { pmDir: args.pmDir } : resolvePmPaths(args.projectDir);

    if (args.stop || args.resume) {
      const result = setKillSwitch(paths.pmDir, args.stop);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }

    const config = loadLoopConfig(paths.pmDir);
    const intervalMinutes = args.intervalMinutes || Number(config.scheduler_interval_minutes) || 30;
    const generated = generate({ ...args, intervalMinutes });

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
  buildCronLine,
  buildLaunchdPlist,
  generate,
  launchdLabel,
  projectSlug,
  setKillSwitch,
};

if (require.main === module) {
  main();
}
