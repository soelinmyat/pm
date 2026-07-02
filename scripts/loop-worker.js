#!/usr/bin/env node
"use strict";

// Loop worker — the execution slice of pm:loop.
//
// One invocation = at most one unit of work: guard (kill switch, budget),
// select + durably claim one card (loop-runner), bootstrap an isolated
// worktree, run the engine CLI headless, record a crash-safe run ledger,
// release the lease, clean up.
//
// Vendor exposure is confined to engineCommand(): the engine is a swappable
// headless CLI (codex exec / claude -p / custom). Everything else — scheduling,
// queue, leases, state — is git + node.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { parseCliArgs } = require("./loop-args.js");
const { loadLoopConfig } = require("./loop-config.js");
const {
  findGitRoot,
  gitRelativePath,
  leasePath,
  runGit,
  sanitizeId,
  writeJsonAtomic,
} = require("./loop-git.js");
const { runLoop } = require("./loop-runner.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");

const ENGINE_MAX_BUFFER = 32 * 1024 * 1024;
const BOOTSTRAP_TIMEOUT_MS = 10 * 60 * 1000;

function killSwitchPath(pmDir) {
  return path.join(pmDir, "loop", "STOP");
}

function isStopped(pmDir) {
  return fs.existsSync(killSwitchPath(pmDir));
}

function runsDirFor(paths) {
  // ponytail: run ledger + logs live in the local state dir (.pm), not the
  // committed pm/ tree — budgets are per-machine in this slice.
  return path.join(paths.pmStateDir, "loop-runs");
}

function countRunsToday(runsDir, now = new Date()) {
  if (!fs.existsSync(runsDir)) return 0;
  const today = now.toISOString().slice(0, 10);
  let count = 0;
  for (const entry of fs.readdirSync(runsDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const record = JSON.parse(fs.readFileSync(path.join(runsDir, entry), "utf8"));
      if (String(record.started_at || "").slice(0, 10) === today) count += 1;
    } catch {
      // unreadable ledger entries still count toward budget: fail closed
      count += 1;
    }
  }
  return count;
}

// Card `command` values are git-synced frontmatter — an injection surface for
// unattended runs. Only dispatch commands the loop itself generates.
const DISPATCHABLE_COMMAND = /^\/pm:(dev|rfc|research) [A-Za-z0-9 ._-]{1,120}$/;

function isDispatchableCommand(command) {
  return DISPATCHABLE_COMMAND.test(String(command || ""));
}

function engineCommand(config, prompt) {
  const worker = config.worker || {};
  const extraArgs = Array.isArray(worker.engine_args) ? worker.engine_args : [];
  if (worker.engine_bin) {
    return { bin: worker.engine_bin, args: extraArgs, input: prompt };
  }
  const kind = worker.engine || config.default_runtime || "codex";
  if (kind === "claude") {
    // Default is acceptEdits: unattended Bash will be denied and the run will
    // fail loudly. Granting the engine full permissions is an explicit operator
    // opt-in (worker.claude_permission_mode: "bypassPermissions"), same as the
    // autonomy gates — never a built-in default.
    const permissionMode = worker.claude_permission_mode || "acceptEdits";
    return {
      bin: "claude",
      args: ["-p", "--permission-mode", permissionMode, "--no-session-persistence", ...extraArgs],
      input: prompt,
    };
  }
  // codex --full-auto keeps its OS-level workspace-write sandbox.
  return {
    bin: "codex",
    args: ["exec", "--full-auto", "--skip-git-repo-check", ...extraArgs, "-"],
    input: prompt,
  };
}

function buildPrompt(plan, config = {}) {
  const card = plan.selected;
  const mergeAutonomy = Boolean(config.autonomy && config.autonomy.merge_pr === true);
  const terminalRules = mergeAutonomy
    ? [
        "- Run the workflow through ship: merge the PR via the workflow's merge loop, and only when every review gate and CI check is green.",
        "- Never bypass, skip, or self-approve a failing gate or check to reach a merge.",
        "- After the merge is verified as MERGED, update the backlog card status to done so dependent work can proceed.",
      ]
    : ["- Open a pull request for the work; do NOT merge it."];
  return [
    "You are an autonomous PM loop worker running unattended in an isolated git worktree.",
    `Execute: ${card.command}`,
    `Backlog card: ${card.id} — ${card.title} (kind: ${card.kind || "unknown"})`,
    "Rules:",
    "- Work only inside this worktree.",
    "- Follow the workflow's gates; never skip or self-approve a gate.",
    ...terminalRules,
    "- If a gate requires human approval or input, stop and state exactly what is needed.",
  ].join("\n");
}

function defaultBranch(gitRoot) {
  try {
    const ref = runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], gitRoot);
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

function prepareWorkspace(gitRoot, plan, config, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const worker = config.worker || {};
  const slug = sanitizeId(plan.selected.id);
  const stamp = now
    .toISOString()
    .replace(/[^0-9]/g, "")
    .slice(0, 12);
  const branch = `loop/${slug}-${stamp}`;
  const workspacePath = path.join(gitRoot, ".worktrees", `loop-${slug}-${stamp}`);

  if (fs.existsSync(workspacePath)) {
    return { ok: false, reason: "workspace-exists", workspacePath };
  }

  try {
    runGit(["fetch", "origin"], gitRoot);
    const base = options.baseBranch || defaultBranch(gitRoot);
    runGit(["worktree", "add", workspacePath, "-b", branch, `origin/${base}`], gitRoot);
  } catch (err) {
    return { ok: false, reason: "worktree-add-failed", error: err.message };
  }

  // Fresh worktrees miss gitignored-but-required files (env files, generated
  // specs) — the top recurring field failure. Copy them from the main checkout.
  const copied = [];
  for (const rel of worker.bootstrap_files || []) {
    const source = path.join(gitRoot, rel);
    if (!fs.existsSync(source)) continue;
    const dest = path.join(workspacePath, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(source, dest, { recursive: true });
    copied.push(rel);
  }

  if (worker.bootstrap_command) {
    const result = spawnSync("bash", ["-c", worker.bootstrap_command], {
      cwd: workspacePath,
      encoding: "utf8",
      timeout: BOOTSTRAP_TIMEOUT_MS,
      maxBuffer: ENGINE_MAX_BUFFER,
    });
    if (result.status !== 0) {
      return {
        ok: false,
        reason: "bootstrap-command-failed",
        workspacePath,
        branch,
        error: (result.stderr || result.error?.message || "").slice(0, 2000),
      };
    }
  }

  return { ok: true, workspacePath, branch, bootstrapFiles: copied };
}

function removeWorkspace(gitRoot, workspacePath) {
  try {
    runGit(["worktree", "remove", "--force", workspacePath], gitRoot);
    return true;
  } catch {
    return false;
  }
}

function releaseLease(pmDir, lease, options = {}) {
  const filePath = leasePath(pmDir, lease.card_id, lease.stage);
  if (!fs.existsSync(filePath)) return { released: false, reason: "lease-file-missing" };

  const gitRoot = findGitRoot(pmDir);
  fs.rmSync(filePath);
  if (!gitRoot) return { released: true, pushed: false, reason: "no-git-root" };

  try {
    const rel = gitRelativePath(gitRoot, filePath);
    runGit(["add", "-A", "--", rel], gitRoot);
    runGit(
      ["commit", "-m", `pm loop release ${lease.card_id} ${lease.stage}`, "--", rel],
      gitRoot,
      {
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    if (!options.skipPush) {
      runGit(["push"], gitRoot, { stdio: ["ignore", "pipe", "pipe"] });
    }
    return { released: true, pushed: !options.skipPush };
  } catch (err) {
    // Release commit/push failure is non-fatal: the lease TTL guarantees expiry.
    return { released: true, pushed: false, error: err.message };
  }
}

function runWorker(projectDir, options = {}) {
  const paths = options.pmDir
    ? { pmDir: options.pmDir, pmStateDir: path.join(path.dirname(options.pmDir), ".pm") }
    : resolvePmPaths(projectDir);
  const now = options.now instanceof Date ? options.now : new Date();
  const config = options.config || loadLoopConfig(paths.pmDir);
  const mode = options.mode || "dev";

  if (config.enabled === false) {
    return { status: "disabled", reason: "loop disabled in config" };
  }
  if (isStopped(paths.pmDir)) {
    return { status: "stopped", reason: `kill switch present: ${killSwitchPath(paths.pmDir)}` };
  }

  const runsDir = runsDirFor(paths);
  const runsToday = countRunsToday(runsDir, now);
  const maxRuns = Number(config.budgets && config.budgets.max_runs_per_day) || 12;
  if (runsToday >= maxRuns) {
    return { status: "budget-exhausted", runs_today: runsToday, max_runs_per_day: maxRuns };
  }

  if (options.dryRun) {
    const preview = runLoop(projectDir, {
      pmDir: paths.pmDir,
      config,
      now,
      mode,
      dryRun: true,
    });
    if (!preview.selected) return preview;
    const command = engineCommand(config, buildPrompt(preview, config));
    return {
      ...preview,
      status: "dry-run",
      engine: { bin: command.bin, args: command.args },
    };
  }

  const plan = runLoop(projectDir, {
    pmDir: paths.pmDir,
    config,
    now,
    mode,
    dryRun: false,
    claimOnly: true,
    holder: options.holder || os.hostname(),
    skipPull: options.skipPull,
    skipPush: options.skipPush,
    allowUnsynced: options.allowUnsynced,
  });
  if (plan.status !== "claimed") return plan;

  if (!isDispatchableCommand(plan.selected.command)) {
    releaseLease(paths.pmDir, plan.lease, options);
    return {
      ...plan,
      status: "rejected",
      reason: `card command is not a dispatchable /pm:* shape: ${JSON.stringify(
        plan.selected.command
      )}`,
    };
  }

  const projectGitRoot = findGitRoot(projectDir);
  if (!projectGitRoot) {
    releaseLease(paths.pmDir, plan.lease, options);
    return { ...plan, status: "failed", reason: "project is not a git repository" };
  }

  const runId = plan.run_id;
  const ledgerPath = path.join(runsDir, `${runId}.json`);
  const logDir = path.join(runsDir, runId);
  fs.mkdirSync(logDir, { recursive: true });

  const ledger = {
    version: 1,
    run_id: runId,
    status: "running",
    pid: process.pid,
    card: plan.selected,
    lease: plan.lease,
    mode,
    started_at: now.toISOString(),
    log_dir: logDir,
  };
  // Crash-safe: written before the engine starts. If this process dies, the
  // "running" record + lease TTL tell the next scout what happened; merged-PR
  // recovery is handled by the reconcile-merged session hook.
  writeJsonAtomic(ledgerPath, ledger);

  let workspace = null;
  let status = "failed";
  let reason = "";
  let exitCode = null;

  try {
    workspace = prepareWorkspace(projectGitRoot, plan, config, { now, ...options });
    if (!workspace.ok) {
      status = "bootstrap-failed";
      reason = workspace.reason;
    } else {
      const command = engineCommand(config, buildPrompt(plan, config));
      const timeoutMs = (Number(config.budgets.max_runtime_seconds_per_run) || 2400) * 1000;
      ledger.engine = { bin: command.bin, args: command.args };
      ledger.workspace = { path: workspace.workspacePath, branch: workspace.branch };
      writeJsonAtomic(ledgerPath, ledger);

      const result = spawnSync(command.bin, command.args, {
        cwd: workspace.workspacePath,
        input: command.input,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: ENGINE_MAX_BUFFER,
        env: process.env,
      });
      fs.writeFileSync(path.join(logDir, "stdout.log"), result.stdout || "");
      fs.writeFileSync(path.join(logDir, "stderr.log"), result.stderr || "");

      if (result.error && result.error.code === "ETIMEDOUT") {
        status = "timeout";
        reason = `engine exceeded ${timeoutMs / 1000}s budget`;
      } else if (result.error) {
        status = "failed";
        reason = result.error.message;
      } else {
        exitCode = result.status;
        status = result.status === 0 ? "completed" : "failed";
        if (status === "failed") reason = `engine exited ${result.status}`;
      }
    }
  } finally {
    const release = releaseLease(paths.pmDir, plan.lease, options);
    ledger.status = status;
    ledger.reason = reason || undefined;
    ledger.exit_code = exitCode;
    ledger.ended_at = new Date().toISOString();
    ledger.lease_release = release;
    writeJsonAtomic(ledgerPath, ledger);

    const keepWorkspace = Boolean(config.worker && config.worker.keep_workspace);
    if (status === "completed" && !keepWorkspace && workspace && workspace.ok) {
      ledger.workspace_removed = removeWorkspace(projectGitRoot, workspace.workspacePath);
      writeJsonAtomic(ledgerPath, ledger);
    }
  }

  return {
    status,
    reason: reason || undefined,
    run_id: runId,
    card: plan.selected,
    exit_code: exitCode,
    workspace: workspace && workspace.ok ? workspace.workspacePath : null,
    branch: workspace && workspace.ok ? workspace.branch : null,
    ledger: ledgerPath,
    log_dir: logDir,
  };
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    mode: "dev",
    dryRun: false,
    holder: os.hostname(),
    skipPull: false,
    skipPush: false,
    allowUnsynced: false,
  };
  const { args, positionals } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--mode": { key: "mode", type: "string" },
      "--dry-run": { key: "dryRun", type: "boolean" },
      "--holder": { key: "holder", type: "string" },
      "--skip-pull": { key: "skipPull", type: "boolean" },
      "--skip-push": { key: "skipPush", type: "boolean" },
      "--allow-unsynced": { key: "allowUnsynced", type: "boolean" },
    },
    defaults
  );
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = runWorker(args.projectDir, args);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    const ok = ["completed", "dry-run", "idle", "stopped", "disabled"].includes(result.status);
    process.exit(ok ? 0 : 2);
  } catch (err) {
    process.stderr.write(`loop-worker: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  buildPrompt,
  countRunsToday,
  engineCommand,
  isDispatchableCommand,
  isStopped,
  killSwitchPath,
  prepareWorkspace,
  releaseLease,
  runWorker,
};

if (require.main === module) {
  main();
}
