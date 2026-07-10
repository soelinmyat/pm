#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { parseFrontmatter } = require("./kb-frontmatter.js");
const { normalizeLoopConfig } = require("./loop-config.js");
const { engineCommand } = require("./loop-engine.js");
const { findGitRoot, gitRelativePath, runGit, sanitizeId } = require("./loop-git.js");
const { bootstrapWorktree } = require("./worktree-bootstrap.js");

const MAX_BUFFER = 8 * 1024 * 1024;

function privateDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`private result path is not a real directory: ${dirPath}`);
  }
  fs.chmodSync(dirPath, 0o700);
  return dirPath;
}

function createPrivateResultDir(pmStateDir, runId, namespace = "loop-results") {
  const safeRunId = sanitizeId(runId) || `run-${process.pid}`;
  return privateDir(path.join(pmStateDir, namespace, safeRunId));
}

function quarantinePath(pmStateDir, fingerprint) {
  const key = String(fingerprint || "").replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("quarantine requires a sha256 fingerprint");
  return path.join(pmStateDir, "loop-quarantine", `${key}.json`);
}

function writePrivateJson(filePath, value) {
  privateDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.tmp`
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  fs.renameSync(tempPath, filePath);
}

function recordQuarantine(pmStateDir, plan, failure, config, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const ttlSeconds = Math.max(
    1,
    Number(config.preflight && config.preflight.quarantine_ttl_seconds) || 3600
  );
  const record = {
    schema_version: 1,
    fingerprint: plan.fingerprint,
    selected_id: plan.selected && plan.selected.id,
    stage: plan.selected && plan.selected.stage,
    blocker_code: failure.blocker_code,
    remediation: failure.remediation,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
  };
  const filePath = quarantinePath(pmStateDir, plan.fingerprint);
  writePrivateJson(filePath, record);
  return { ...record, file_path: filePath };
}

function readQuarantine(pmStateDir, fingerprint, now = new Date()) {
  let filePath;
  try {
    filePath = quarantinePath(pmStateDir, fingerprint);
  } catch {
    return null;
  }
  if (!fs.existsSync(filePath)) return null;
  try {
    const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (record.fingerprint !== fingerprint) return null;
    const expiresAt = Date.parse(record.expires_at || "");
    if (Number.isNaN(expiresAt) || expiresAt <= now.getTime()) return null;
    return { ...record, quarantined: true, file_path: filePath };
  } catch {
    return null;
  }
}

function activeQuarantineForPlan(pmStateDir, planOrMeta, now = new Date()) {
  const fingerprint = planOrMeta && (planOrMeta.fingerprint || planOrMeta.plan_fingerprint);
  return readQuarantine(pmStateDir, fingerprint, now);
}

function clearQuarantine(pmStateDir, fingerprint = "all") {
  const dir = path.join(pmStateDir, "loop-quarantine");
  if (!fs.existsSync(dir)) return 0;
  if (fingerprint !== "all") {
    const filePath = quarantinePath(pmStateDir, fingerprint);
    if (!fs.existsSync(filePath)) return 0;
    fs.rmSync(filePath);
    return 1;
  }
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    fs.rmSync(path.join(dir, entry.name));
    removed += 1;
  }
  return removed;
}

function safeCopy(source, destination) {
  if (!source || !fs.existsSync(source)) return false;
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
  return true;
}

function copyReadContext(pmDir, workspacePath, plan) {
  const contextDir = path.join(workspacePath, ".pm", "loop-context");
  privateDir(contextDir);
  const copied = [];
  const sourcePath = plan.selected && plan.selected.sourcePath;
  const cardPath = path.join(contextDir, "card.md");
  if (safeCopy(sourcePath, cardPath)) {
    copied.push(cardPath);
    try {
      const parsed = parseFrontmatter(fs.readFileSync(sourcePath, "utf8"));
      if (typeof parsed.data.rfc === "string" && parsed.data.rfc.trim()) {
        const rfcPath = path.resolve(path.join(pmDir, "backlog"), parsed.data.rfc);
        const backlogRoot = path.resolve(path.join(pmDir, "backlog"));
        if (rfcPath.startsWith(`${backlogRoot}${path.sep}`)) {
          const destination = path.join(contextDir, `rfc${path.extname(rfcPath) || ".html"}`);
          if (safeCopy(rfcPath, destination)) copied.push(destination);
        }
      }
    } catch {
      // The exact card copy is still useful; malformed optional context is ignored.
    }
  }
  for (const name of ["instructions.md", "instructions.local.md", "memory.md", "strategy.md"]) {
    const destination = path.join(contextDir, name);
    if (safeCopy(path.join(pmDir, name), destination)) copied.push(destination);
  }
  return { contextDir, copied };
}

function hashDirectory(root) {
  if (!fs.existsSync(root)) return "missing";
  const hash = crypto.createHash("sha256");
  const visit = (current, relative = "") => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.join(relative, entry.name);
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        hash.update(`link:${rel}:${fs.readlinkSync(fullPath)}\n`);
      } else if (entry.isDirectory()) {
        visit(fullPath, rel);
      } else if (entry.isFile()) {
        hash.update(`file:${rel}:`);
        hash.update(fs.readFileSync(fullPath));
      }
    }
  };
  visit(root);
  return hash.digest("hex");
}

function snapshotProtectedPmState(pmDir) {
  const gitRoot = findGitRoot(pmDir);
  if (!gitRoot) return { git_root: "", tree_hash: hashDirectory(pmDir) };
  const rel = gitRelativePath(gitRoot, pmDir);
  return {
    git_root: gitRoot,
    head: runGit(["rev-parse", "HEAD"], gitRoot),
    refs: runGit(
      ["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads", "refs/remotes"],
      gitRoot
    ),
    protected_status: runGit(
      ["status", "--porcelain=v1", "--untracked-files=all", "--", rel],
      gitRoot
    ),
  };
}

function failure(blockerCode, remediation, extra = {}) {
  return { ok: false, blocker_code: blockerCode, remediation, ...extra };
}

function normalizedCheck(check, index, defaultTimeout) {
  if (typeof check === "string") {
    return { name: `service-check-${index + 1}`, command: check, timeout_seconds: defaultTimeout };
  }
  return {
    name: check.name || `service-check-${index + 1}`,
    command: check.command,
    timeout_seconds: Number(check.timeout_seconds) || defaultTimeout,
  };
}

function runPreflight(projectDir, plan, rawConfig, options = {}) {
  const config = normalizeLoopConfig(rawConfig);
  const pmDir = options.pmDir || plan.pmDir;
  const pmStateDir = options.pmStateDir || path.join(path.dirname(pmDir), ".pm");
  const now = options.now instanceof Date ? options.now : new Date();
  const gitRoot = findGitRoot(projectDir);
  if (!gitRoot || !plan.source_base_oid || !plan.fingerprint || !plan.selected) {
    const result = failure(
      "preflight-plan-invalid",
      "Refresh the read-only plan from a Git-backed source checkout and retry."
    );
    result.quarantine = recordQuarantine(pmStateDir, plan, result, config, { now });
    return result;
  }

  const preflightId = `${plan.selected.id}-${plan.fingerprint.slice(-12)}-${process.pid}`;
  const workspacePath = path.join(gitRoot, ".worktrees", `preflight-${sanitizeId(preflightId)}`);
  const resultDir = createPrivateResultDir(pmStateDir, preflightId, "loop-preflight-results");
  const finishFailure = (result) => ({
    ...result,
    fingerprint: plan.fingerprint,
    quarantine: recordQuarantine(pmStateDir, plan, result, config, { now }),
  });

  let worktreeCreated = false;
  try {
    fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
    runGit(["worktree", "add", "--detach", workspacePath, plan.source_base_oid], gitRoot);
    worktreeCreated = true;

    const boot = bootstrapWorktree(gitRoot, workspacePath, config.worker);
    if (!boot.ok) {
      const detail = boot.missing && boot.missing.length ? `: ${boot.missing.join(", ")}` : "";
      return finishFailure(
        failure(boot.reason, `Fix the bootstrap prerequisite${detail} and retry.`, {
          error: boot.error,
        })
      );
    }
    const context = copyReadContext(pmDir, workspacePath, plan);

    const probeTimeoutSeconds = Math.max(1, Number(config.preflight.probe_timeout_seconds) || 60);
    const spawn = options.spawnSync || spawnSync;
    for (const [index, rawCheck] of config.preflight.service_checks.entries()) {
      const check = normalizedCheck(rawCheck, index, probeTimeoutSeconds);
      const checked = spawn("bash", ["-lc", check.command], {
        cwd: workspacePath,
        encoding: "utf8",
        timeout: Math.max(1, check.timeout_seconds) * 1000,
        maxBuffer: MAX_BUFFER,
      });
      if (checked.error || checked.status !== 0) {
        return finishFailure(
          failure(
            "service-check-failed",
            `Repair configured service check ${JSON.stringify(check.name)} and retry.`,
            {
              check: check.name,
              error: checked.error?.message || checked.stderr || "non-zero exit",
            }
          )
        );
      }
    }

    const protectedBefore = snapshotProtectedPmState(pmDir);
    const command = engineCommand(
      config,
      [
        "PM loop preflight probe.",
        "Confirm this exact engine is authenticated and can read the disposable workspace.",
        "Do not modify project or PM state. Exit successfully without doing implementation work.",
      ].join("\n"),
      { workspacePath, resultDir }
    );
    const probeContext = { command, workspacePath, resultDir, contextDir: context.contextDir };
    const probed = options.runProbe
      ? options.runProbe(probeContext)
      : spawn(command.bin, command.args, {
          cwd: workspacePath,
          input: command.input,
          encoding: "utf8",
          timeout: probeTimeoutSeconds * 1000,
          maxBuffer: MAX_BUFFER,
          env: {
            ...process.env,
            PM_LOOP_PREFLIGHT: "1",
            PM_LOOP_CARD_ID: plan.selected.id,
            PM_LOOP_RESULT_DIR: resultDir,
          },
        });
    const protectedAfter = snapshotProtectedPmState(pmDir);
    if (JSON.stringify(protectedAfter) !== JSON.stringify(protectedBefore)) {
      return finishFailure(
        failure(
          "protected-pm-state-changed",
          "Restore PM refs and protected paths, inspect the engine probe, and retry."
        )
      );
    }
    if (probed.error || probed.status !== 0) {
      return finishFailure(
        failure(
          "engine-probe-failed",
          "Authenticate the configured engine and verify its local permissions, then retry.",
          { error: probed.error?.message || probed.stderr || `engine exited ${probed.status}` }
        )
      );
    }

    return {
      ok: true,
      fingerprint: plan.fingerprint,
      source_base_oid: plan.source_base_oid,
      engine: { bin: command.bin, args: command.args },
      bootstrap_files: boot.copied,
      service_checks: config.preflight.service_checks.length,
      result_dir: resultDir,
    };
  } catch (err) {
    return finishFailure(
      failure("preflight-internal-failed", "Inspect the preflight error and retry.", {
        error: String(err.message || err).slice(0, 2000),
      })
    );
  } finally {
    if (worktreeCreated) {
      try {
        runGit(["worktree", "remove", "--force", workspacePath], gitRoot);
      } catch {
        // Caller gets the original preflight result; cleanup is best effort.
      }
    }
  }
}

function main() {
  const [action, pmStateDir, fingerprint] = process.argv.slice(2);
  if (action !== "clear" || !pmStateDir) {
    process.stderr.write("usage: loop-preflight.js clear <pm-state-dir> [fingerprint|all]\n");
    process.exit(2);
  }
  process.stdout.write(
    `${JSON.stringify({ cleared: clearQuarantine(pmStateDir, fingerprint || "all") })}\n`
  );
}

module.exports = {
  activeQuarantineForPlan,
  clearQuarantine,
  copyReadContext,
  createPrivateResultDir,
  quarantinePath,
  readQuarantine,
  recordQuarantine,
  runPreflight,
  snapshotProtectedPmState,
};

if (require.main === module) main();
