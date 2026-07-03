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
const { bootstrapWorktree } = require("./worktree-bootstrap.js");
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

function readLedgers(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const ledgers = [];
  for (const entry of fs.readdirSync(runsDir)) {
    if (!entry.endsWith(".json")) continue;
    try {
      ledgers.push(JSON.parse(fs.readFileSync(path.join(runsDir, entry), "utf8")));
    } catch {
      // unreadable ledger entries still count toward budgets: fail closed
      ledgers.push({ status: "unreadable", started_at: "9999-12-31T00:00:00Z" });
    }
  }
  return ledgers;
}

function isShipLedger(record) {
  return record.stage === "ship" || record.stage === "review";
}

// Ship cycles poll external state and get their own budget so a slow PR
// cannot starve dev dispatch (and vice versa). Stage-less legacy ledgers
// count toward the main budget: fail closed.
function countRunsInLedgers(ledgers, now = new Date(), opts = {}) {
  const today = now.toISOString().slice(0, 10);
  return ledgers.filter((record) => {
    const sameDay =
      String(record.started_at || "").slice(0, 10) === today || record.status === "unreadable";
    if (!sameDay) return false;
    if (opts.stage === "ship") return isShipLedger(record);
    return !isShipLedger(record);
  }).length;
}

function countRunsToday(runsDir, now = new Date(), opts = {}) {
  return countRunsInLedgers(readLedgers(runsDir), now, opts);
}

// Attempts per card+stage: every non-completed ledger counts. Backstop for
// cards that fail or get rejected every wake (budgets.max_attempts_per_stage).
function countCardAttempts(runsDir, cardId, stage) {
  return readLedgers(runsDir).filter(
    (record) =>
      record.card &&
      record.card.id === cardId &&
      (record.stage || "dev") === stage &&
      record.status !== "completed"
  ).length;
}

// Card `command` values are git-synced frontmatter — an injection surface for
// unattended runs. Only dispatch commands the loop itself generates.
const DISPATCHABLE_COMMAND = /^\/pm:(dev|ship|rfc|research) [A-Za-z0-9 ._-]{1,120}$/;

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
  const stage = plan.selected.stage || "dev";

  // Ship is event-driven (CI runs, remote review rounds) and cannot finish in
  // one engine run. Each wake runs ONE bounded ship cycle against the durable
  // PR; the wake cadence is the iteration loop.
  if (stage === "ship" || stage === "review") {
    const mergeRule = mergeAutonomy
      ? "- Merge only when every review gate and CI check is green; never bypass a failing check. After a verified merge, update the backlog card status to done."
      : "- Do NOT merge. When the PR is green and review threads are resolved, update the backlog card status to needs-human and report it is ready for human merge.";
    return [
      "You are an autonomous PM loop worker running ONE bounded ship cycle for an existing pull request.",
      `Execute: ${card.command}`,
      `Backlog card: ${card.id} — ${card.title} (branch: ${card.branch || "see card"})`,
      "Rules:",
      "- Work only inside this worktree, on the existing branch.",
      "- One cycle only: assess CI status and new review comments, fix what is actionable now, push, then stop.",
      "- If CI is still running or you are waiting on external state, stop and report — the next wake continues.",
      mergeRule,
      "- If a gate requires human approval or input, stop and state exactly what is needed.",
    ].join("\n");
  }

  if (stage === "rfc" || stage === "research") {
    return [
      "You are an autonomous PM loop worker running unattended in an isolated git worktree.",
      `Execute: ${card.command}`,
      `Backlog card: ${card.id} — ${card.title} (kind: ${card.kind || "unknown"})`,
      "Rules:",
      "- Work only inside this worktree.",
      "- Produce the artifact the workflow defines (RFC draft or research findings); do NOT open pull requests or merge anything.",
      "- Update the backlog card status per the workflow, and stop at any gate that requires human approval — RFC approval is always human.",
      "- If input is needed, stop and state exactly what is required.",
    ].join("\n");
  }

  const terminalRules = [
    "- Open a pull request for the work; do NOT merge it in this run.",
    "- Before finishing, update the backlog card frontmatter: status: shipping, branch, and prs — subsequent wakes run the ship cycles (CI, review rounds" +
      (mergeAutonomy ? ", merge)." : ") and a human merges."),
  ];
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

function isSafeBranchRef(branch) {
  if (branch.includes("..") || branch.endsWith(".lock") || branch.endsWith("/")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/.test(branch);
}

function branchRefExists(gitRoot, branch) {
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    try {
      runGit(["rev-parse", "--verify", "--quiet", ref], gitRoot);
      return true;
    } catch {
      // try the next ref namespace
    }
  }
  return false;
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
  const shipStage = plan.selected.stage === "ship" || plan.selected.stage === "review";
  const existingBranch = String(plan.selected.branch || "");
  if (shipStage) {
    // branch comes from git-synced card frontmatter — same injection surface
    // as the command field. Validate shape, then verify the ref exists.
    if (!existingBranch) return { ok: false, reason: "ship-branch-missing" };
    if (!isSafeBranchRef(existingBranch)) {
      return { ok: false, reason: "ship-branch-invalid" };
    }
    if (!branchRefExists(gitRoot, existingBranch)) {
      return { ok: false, reason: "ship-branch-not-found" };
    }
  }
  const branch = shipStage ? existingBranch : `loop/${slug}-${stamp}`;
  const workspacePath = path.join(gitRoot, ".worktrees", `loop-${slug}-${stamp}`);

  if (fs.existsSync(workspacePath)) {
    return { ok: false, reason: "workspace-exists", workspacePath };
  }

  try {
    runGit(["fetch", "origin"], gitRoot);
    if (shipStage) {
      runGit(["worktree", "add", workspacePath, branch], gitRoot);
      // Each cycle starts from the remote tip so pushes from humans or other
      // machines are never ignored or clobbered by a stale local branch.
      runGit(["reset", "--hard", `origin/${branch}`], workspacePath);
    } else {
      const base = options.baseBranch || defaultBranch(gitRoot);
      runGit(["worktree", "add", workspacePath, "-b", branch, `origin/${base}`], gitRoot);
    }
  } catch (err) {
    return { ok: false, reason: "worktree-add-failed", error: err.message };
  }

  // Fresh worktrees miss gitignored-but-required files (env files, generated
  // specs) — the top recurring field failure. Copy them from the main checkout
  // and run the bootstrap command. Shared with the dev worktree path via
  // scripts/worktree-bootstrap.js so both honor the same worker.bootstrap_*
  // config keys.
  const boot = bootstrapWorktree(gitRoot, workspacePath, worker);
  if (!boot.ok) {
    return { ok: false, reason: boot.reason, workspacePath, branch, error: boot.error };
  }

  return { ok: true, workspacePath, branch, bootstrapFiles: boot.copied };
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
  const mode = options.mode || "default";

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
  const shipCyclesToday = countRunsToday(runsDir, now, { stage: "ship" });
  const maxShipCycles = Number(config.budgets && config.budgets.max_ship_cycles_per_day) || 24;

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

  const stage = plan.selected.stage || "dev";
  const shipStage = stage === "ship" || stage === "review";
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
    stage,
    started_at: now.toISOString(),
    log_dir: logDir,
  };

  // Every claimed dispatch gets a ledger — including early rejections — so
  // budgets and the attempts backstop always advance and nothing can livelock
  // the wake cycle for free.
  const bail = (status, reason) => {
    const release = releaseLease(paths.pmDir, plan.lease, options);
    writeJsonAtomic(ledgerPath, {
      ...ledger,
      status,
      reason,
      ended_at: new Date().toISOString(),
      lease_release: release,
    });
    return { ...plan, status, reason, run_id: runId, ledger: ledgerPath };
  };

  if (shipStage && shipCyclesToday >= maxShipCycles) {
    return bail(
      "budget-exhausted",
      `ship cycles today (${shipCyclesToday}) reached max_ship_cycles_per_day (${maxShipCycles})`
    );
  }

  const maxAttempts = Number(config.budgets && config.budgets.max_attempts_per_stage) || 3;
  const attempts = countCardAttempts(runsDir, plan.selected.id, stage);
  if (attempts >= maxAttempts) {
    return bail(
      "attempts-exhausted",
      `card ${plan.selected.id} failed ${attempts}x at stage ${stage} (max_attempts_per_stage ${maxAttempts}); needs a human look`
    );
  }

  if (!isDispatchableCommand(plan.selected.command)) {
    return bail(
      "rejected",
      `card command is not a dispatchable /pm:* shape: ${JSON.stringify(plan.selected.command)}`
    );
  }

  const projectGitRoot = findGitRoot(projectDir);
  if (!projectGitRoot) {
    return bail("failed", "project is not a git repository");
  }
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
      const timeoutSeconds = shipStage
        ? Number(config.budgets.max_runtime_seconds_per_ship_cycle) || 1800
        : Number(config.budgets.max_runtime_seconds_per_run) || 5400;
      const timeoutMs = timeoutSeconds * 1000;
      ledger.engine = { bin: command.bin, args: command.args };
      ledger.workspace = { path: workspace.workspacePath, branch: workspace.branch };
      writeJsonAtomic(ledgerPath, ledger);

      const result = spawnSync(command.bin, command.args, {
        cwd: workspace.workspacePath,
        input: command.input,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: ENGINE_MAX_BUFFER,
        env: {
          ...process.env,
          // Deterministic mode detection for skills (dev/ship read these to
          // switch into headless loop-worker behavior).
          PM_LOOP_WORKER: "1",
          PM_LOOP_STAGE: plan.selected.stage || "dev",
          PM_LOOP_CARD_ID: plan.selected.id,
        },
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
    if (!keepWorkspace && workspace && workspace.ok) {
      // Ship worktrees must ALWAYS go: card.branch stays checked out otherwise
      // and every subsequent cycle fails worktree-add. Dev worktrees go too
      // (logs are already captured); failed dev run branches are deleted so
      // retries don't accumulate refs — never the ship branch itself.
      ledger.workspace_removed = removeWorkspace(projectGitRoot, workspace.workspacePath);
      if (!shipStage && status !== "completed" && ledger.workspace_removed) {
        try {
          runGit(["branch", "-D", workspace.branch], projectGitRoot);
        } catch {
          // branch may be gone already
        }
      }
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
    mode: "default",
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
  isSafeBranchRef,
  countCardAttempts,
  countRunsInLedgers,
  countRunsToday,
  engineCommand,
  isDispatchableCommand,
  isStopped,
  killSwitchPath,
  prepareWorkspace,
  readLedgers,
  releaseLease,
  runsDirFor,
  runWorker,
};

if (require.main === module) {
  main();
}
