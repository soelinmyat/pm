"use strict";

// Resource ledger for a Dev session: what a run creates outside committed
// source, and how close and the orphan sweep remove it.
//
// Removal is chosen by kind, never by a stored command. Directories,
// worktrees and processes are removed by this module from their typed entry.
// Databases, accounts and simulators are removed only through a teardown the
// project declares in its PM config. Every check that allows a removal at
// registration runs again at removal.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { cleanGitEnv } = require("./git-env");
const { isRfc3339DateTime } = require("./iso-time");
const { measureBytes } = require("./dev-session-storage");
const { readBoundedJsonFile } = require("./safe-json-file");

const REMOVAL_BY_KIND = Object.freeze({
  directory: "remove-directory",
  worktree: "git-worktree-remove",
  process: "terminate-process",
  database: "declared-teardown",
  account: "declared-teardown",
  simulator: "declared-teardown",
});
const PROJECT_KINDS = new Set(["database", "account", "simulator"]);
const COMMON_FIELDS = Object.freeze([
  "id",
  "kind",
  "removal",
  "created_by",
  "created_at",
  "label",
  "status",
  "removed_at",
  "last_close",
]);
const KIND_FIELDS = Object.freeze({
  directory: ["path"],
  worktree: ["path", "branch"],
  process: ["pid", "started_at", "command"],
  database: ["identifier", "teardown"],
  account: ["identifier", "teardown"],
  simulator: ["identifier", "teardown"],
});
const ENTRY_STATUSES = new Set(["registered", "removed", "gone"]);
const CLOSE_OUTCOMES = new Set([
  "removed",
  "gone",
  "preserved",
  "refused",
  "failed",
  "no-teardown",
]);
const LAST_CLOSE_FIELDS = new Set(["at", "outcome", "reason", "bytes_freed"]);
const ID_PATTERN = /^res_[a-f0-9]{16}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@+/=-]{0,199}$/;
const TEARDOWN_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
// Shared caches are never a run's own resource.
const SHARED_CACHE_NAMES = new Set([
  "node_modules",
  ".npm",
  ".pnpm-store",
  ".yarn",
  ".cache",
  "Caches",
  "CoreSimulator",
  ".docker",
  "docker",
]);
const ABANDONED_AFTER_MS = 72 * 60 * 60 * 1000;
const DEFAULT_GRACE_MS = 5000;
const MAX_SESSION_BYTES = 32 * 1024 * 1024;

function issue(pathValue, message) {
  return { path: pathValue, message };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, max) {
  return typeof value === "string" && value.trim() !== "" && value.length <= max;
}

function isNormalizedAbsolute(value) {
  return typeof value === "string" && path.isAbsolute(value) && path.resolve(value) === value;
}

function validateResources(resources, errors, base = "$.resources") {
  if (resources === undefined) return;
  if (!Array.isArray(resources)) {
    errors.push(issue(base, "must be an array"));
    return;
  }
  const ids = new Set();
  resources.forEach((entry, index) => {
    const at = `${base}[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(issue(at, "must be an object"));
      return;
    }
    const kindFields = Object.hasOwn(KIND_FIELDS, entry.kind) ? KIND_FIELDS[entry.kind] : null;
    if (!kindFields) {
      errors.push(issue(`${at}.kind`, "must be a known resource kind"));
      return;
    }
    const allowed = new Set([...COMMON_FIELDS, ...kindFields]);
    for (const field of Object.keys(entry)) {
      if (!allowed.has(field)) errors.push(issue(`${at}.${field}`, "unknown field"));
    }
    for (const field of allowed) {
      if (!Object.hasOwn(entry, field)) errors.push(issue(`${at}.${field}`, "required"));
    }
    if (typeof entry.id !== "string" || !ID_PATTERN.test(entry.id)) {
      errors.push(issue(`${at}.id`, "must be a res_ identifier"));
    } else if (ids.has(entry.id)) {
      errors.push(issue(`${at}.id`, "must be unique"));
    } else {
      ids.add(entry.id);
    }
    if (entry.removal !== REMOVAL_BY_KIND[entry.kind]) {
      errors.push(issue(`${at}.removal`, `must be ${REMOVAL_BY_KIND[entry.kind]}`));
    }
    if (!boundedString(entry.created_by, 200))
      errors.push(issue(`${at}.created_by`, "must be a non-empty string"));
    if (!isRfc3339DateTime(entry.created_at))
      errors.push(issue(`${at}.created_at`, "must be an ISO date"));
    if (entry.label !== null && !boundedString(entry.label, 200))
      errors.push(issue(`${at}.label`, "must be null or a non-empty string"));
    if (!ENTRY_STATUSES.has(entry.status)) errors.push(issue(`${at}.status`, "invalid status"));
    if (entry.status === "registered" && entry.removed_at !== null)
      errors.push(issue(`${at}.removed_at`, "must be null while registered"));
    if (entry.status !== "registered" && !isRfc3339DateTime(entry.removed_at))
      errors.push(issue(`${at}.removed_at`, "must be an ISO date once removed or gone"));
    if (entry.last_close !== null) validateLastClose(entry.last_close, `${at}.last_close`, errors);
    if (entry.kind === "directory" || entry.kind === "worktree") {
      if (!isNormalizedAbsolute(entry.path))
        errors.push(issue(`${at}.path`, "must be a normalized absolute path"));
    }
    if (entry.kind === "worktree" && entry.branch !== null && !boundedString(entry.branch, 500))
      errors.push(issue(`${at}.branch`, "must be null or a branch name"));
    if (entry.kind === "process") {
      if (!Number.isSafeInteger(entry.pid) || entry.pid <= 1)
        errors.push(issue(`${at}.pid`, "must be an integer greater than 1"));
      if (!boundedString(entry.started_at, 100))
        errors.push(issue(`${at}.started_at`, "must be the recorded process start time"));
      if (!boundedString(entry.command, 4096))
        errors.push(issue(`${at}.command`, "must be the recorded command line"));
    }
    if (PROJECT_KINDS.has(entry.kind)) {
      if (typeof entry.identifier !== "string" || !IDENTIFIER_PATTERN.test(entry.identifier))
        errors.push(issue(`${at}.identifier`, "must be a plain identifier"));
      if (typeof entry.teardown !== "string" || !TEARDOWN_NAME_PATTERN.test(entry.teardown))
        errors.push(issue(`${at}.teardown`, "must name a declared teardown"));
    }
  });
}

function validateLastClose(value, at, errors) {
  if (!isPlainObject(value)) {
    errors.push(issue(at, "must be null or an object"));
    return;
  }
  for (const field of Object.keys(value)) {
    if (!LAST_CLOSE_FIELDS.has(field)) errors.push(issue(`${at}.${field}`, "unknown field"));
  }
  if (!isRfc3339DateTime(value.at)) errors.push(issue(`${at}.at`, "must be an ISO date"));
  if (!CLOSE_OUTCOMES.has(value.outcome)) errors.push(issue(`${at}.outcome`, "invalid outcome"));
  if (typeof value.reason !== "string" || value.reason.length > 2000)
    errors.push(issue(`${at}.reason`, "must be a string"));
  if (!Number.isSafeInteger(value.bytes_freed) || value.bytes_freed < 0)
    errors.push(issue(`${at}.bytes_freed`, "must be a non-negative integer"));
}

// ---------------------------------------------------------------------------
// Paths and context

function realOrNull(candidate) {
  if (!candidate) return null;
  try {
    return fs.realpathSync(candidate);
  } catch {
    return null;
  }
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function strictlyWithin(parent, candidate) {
  return parent !== candidate && within(parent, candidate);
}

function overlaps(a, b) {
  return within(a, b) || within(b, a);
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: cleanGitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || "",
    stderr: (result.stderr || result.error?.message || "").trim(),
  };
}

function listWorktrees(repoRoot) {
  if (!repoRoot) return [];
  const listed = git(repoRoot, ["worktree", "list", "--porcelain", "-z"]);
  if (!listed.ok) return [];
  const worktrees = [];
  let current = null;
  for (const field of listed.stdout.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: realOrNull(field.slice(9)) || field.slice(9), branch: null, locked: false };
      current.main = worktrees.length === 0;
      worktrees.push(current);
    } else if (current && field.startsWith("branch ")) {
      current.branch = field.slice(7).replace(/^refs\/heads\//, "");
    } else if (current && (field === "locked" || field.startsWith("locked "))) {
      current.locked = true;
    }
  }
  return worktrees;
}

function tempRoots(home) {
  const candidates = [os.tmpdir()];
  if (process.platform !== "win32") candidates.push("/tmp");
  const roots = [];
  for (const candidate of candidates) {
    const real = realOrNull(candidate);
    if (!real || roots.includes(real)) continue;
    // A temporary root at the filesystem root, home or above home would make
    // the user's own files removable; such a root is not used.
    if (path.parse(real).root === real) continue;
    if (home && within(real, home)) continue;
    roots.push(real);
  }
  return roots;
}

function buildContext({ session, sessionPath, cwd = process.cwd(), protectedTargets = [] }) {
  const home = realOrNull(os.homedir());
  const repoRoot = realOrNull(session.source?.repo_root);
  const worktrees = listWorktrees(repoRoot);
  const mainWorktree = worktrees.find((item) => item.main)?.path || repoRoot;
  // Teardowns are read from, and run in, the repository's main worktree only.
  // The session's own worktree may have any branch checked out, and a branch
  // can commit a teardown declaration or replace the script one names.
  const configRoot = worktrees.find((item) => item.main)?.path || null;
  const sessionDir = realOrNull(path.dirname(sessionPath)) || path.dirname(sessionPath);
  const roots = tempRoots(home);
  const worktreeRoots = [
    ...new Set(
      [repoRoot, mainWorktree]
        .filter(Boolean)
        .map((root) => realOrNull(path.join(root, ".worktrees")))
        .filter(Boolean)
    ),
  ];
  return {
    home,
    repoRoot,
    configRoot,
    worktrees,
    sessionDir,
    stateDir: repoRoot
      ? realOrNull(path.join(repoRoot, ".pm")) || path.join(repoRoot, ".pm")
      : null,
    cwd: realOrNull(cwd) || cwd,
    tempRoots: roots,
    worktreeRoots: [...worktreeRoots, ...roots],
    protectedTargets,
    graceMs: graceFromEnv(),
  };
}

function graceFromEnv() {
  const value = Number(process.env.PM_DEV_CLOSE_GRACE_MS);
  return Number.isInteger(value) && value >= 0 && value <= 60000 ? value : DEFAULT_GRACE_MS;
}

// Rules shared by directories and worktrees. P is a resolved real path.
function commonRefusal(real, ctx) {
  // Without the repository the worktree and repository checks cannot run.
  if (!ctx.repoRoot) return "cannot be checked because the session's repository is missing";
  if (path.parse(real).root === real) return "is the filesystem root";
  if (ctx.home && within(real, ctx.home)) return "is your home directory or one of its parents";
  if (ctx.repoRoot && within(real, ctx.repoRoot))
    return "is the repository root or one of its parents";
  if (ctx.sessionDir && overlaps(real, ctx.sessionDir))
    return "overlaps this session's evidence folder";
  if (ctx.stateDir && overlaps(real, ctx.stateDir)) return "overlaps the PM state folder";
  if (ctx.cwd && within(real, ctx.cwd))
    return "contains the directory this command is running from";
  if (SHARED_CACHE_NAMES.has(path.basename(real))) return "is a shared cache";
  return null;
}

// A path that overlaps anything a session still in use depends on is kept.
function protectedBy(real, ctx) {
  const target = ctx.protectedTargets.find((item) => item.path && overlaps(real, item.path));
  return target ? `is in use by active session ${target.slug}` : null;
}

function directoryRefusal(real, ctx) {
  const common = commonRefusal(real, ctx);
  if (common) return common;
  if (ctx.worktrees.some((worktree) => within(worktree.path, real)))
    return "is inside a git worktree of this repository";
  if (!ctx.tempRoots.some((root) => strictlyWithin(root, real)))
    return "is outside the allowed temporary roots";
  return null;
}

function worktreeRefusal(real, ctx) {
  const common = commonRefusal(real, ctx);
  if (common) return common;
  if (!ctx.worktreeRoots.some((root) => strictlyWithin(root, real)))
    return "is outside the worktree area";
  const listed = ctx.worktrees.find((worktree) => worktree.path === real);
  if (!listed || listed.main) return "is not a linked worktree of this repository";
  return null;
}

// Resolve a path argument without following a final symlink. Returns the
// real path or a refusal.
function resolveRegisteredPath(candidate) {
  const absolute = path.resolve(candidate);
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch {
    return { refusal: "does not exist" };
  }
  if (stat.isSymbolicLink()) return { refusal: "is a symlink" };
  if (!stat.isDirectory()) return { refusal: "is not a directory" };
  const real = realOrNull(absolute);
  if (!real) return { refusal: "cannot be resolved" };
  return { real };
}

// Re-resolve a recorded path at removal. A path that is now a symlink or
// resolves somewhere else is refused, never followed.
function recheckRecordedPath(recorded) {
  let stat;
  try {
    stat = fs.lstatSync(recorded);
  } catch (error) {
    if (error.code === "ENOENT") return { gone: true };
    return { refusal: `cannot be inspected: ${error.code || error.message}` };
  }
  if (stat.isSymbolicLink()) return { refusal: "is now a symlink" };
  if (!stat.isDirectory()) return { refusal: "is no longer a directory" };
  if (realOrNull(recorded) !== recorded) return { refusal: "now resolves to a different place" };
  return { real: recorded };
}

// ---------------------------------------------------------------------------
// Processes

function processIdentity(pid) {
  if (process.platform === "win32") return { unsupported: true };
  const env = { ...process.env, LC_ALL: "C", LANG: "C" };
  const stat = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8", env });
  const state = (stat.stdout || "").trim();
  if (!state || state.startsWith("Z")) return null;
  const started = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", env });
  const command = spawnSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
    encoding: "utf8",
    env,
  });
  const startedAt = (started.stdout || "").trim();
  const commandLine = (command.stdout || "").trim().slice(0, 4096);
  if (!startedAt || !commandLine) return null;
  return { started_at: startedAt, command: commandLine };
}

function sameProcess(entry, identity) {
  return identity && identity.started_at === entry.started_at && identity.command === entry.command;
}

function forbiddenPid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return "is not a removable process id";
  if (pid === process.pid) return "is this command's own process";
  if (pid === process.ppid) return "is the process that started this command";
  return null;
}

function sleepMs(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForExit(entry, ms) {
  const deadline = Date.now() + ms;
  do {
    if (!sameProcess(entry, processIdentity(entry.pid))) return true;
    sleepMs(50);
  } while (Date.now() < deadline);
  return !sameProcess(entry, processIdentity(entry.pid));
}

// ---------------------------------------------------------------------------
// Declared teardowns

function readProjectConfig(repoRoot) {
  if (!repoRoot) return { config: null, source: null };
  for (const candidate of [
    path.join(repoRoot, ".pm", "config.json"),
    path.join(repoRoot, "pm.config.json"),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return { config: JSON.parse(fs.readFileSync(candidate, "utf8")), source: candidate };
    } catch (error) {
      return {
        config: null,
        source: candidate,
        error: `cannot read ${candidate}: ${error.message}`,
      };
    }
  }
  return { config: null, source: null };
}

function declaredTeardown(repoRoot, entry) {
  const { config, source, error } = readProjectConfig(repoRoot);
  if (error) return { refusal: error };
  const declarations = config?.dev?.teardown;
  if (!isPlainObject(declarations) || !Object.hasOwn(declarations, entry.teardown))
    return { missing: true };
  const declaration = declarations[entry.teardown];
  if (
    !isPlainObject(declaration) ||
    !PROJECT_KINDS.has(declaration.kind) ||
    !Array.isArray(declaration.command) ||
    declaration.command.length < 1 ||
    declaration.command.length > 64 ||
    !declaration.command.every((part) => boundedString(part, 4096)) ||
    (declaration.timeout_ms !== undefined &&
      !(
        Number.isInteger(declaration.timeout_ms) &&
        declaration.timeout_ms >= 1000 &&
        declaration.timeout_ms <= 600000
      ))
  ) {
    return {
      refusal: `teardown ${entry.teardown} in ${source} needs kind, a command array and an optional timeout_ms`,
    };
  }
  if (declaration.kind !== entry.kind)
    return {
      refusal: `teardown ${entry.teardown} is declared for ${declaration.kind}, not ${entry.kind}`,
    };
  return {
    argv: declaration.command.map((part) => part.split("{id}").join(entry.identifier)),
    timeout: declaration.timeout_ms || 120000,
    source,
  };
}

// ---------------------------------------------------------------------------
// Registration

function prepareEntry(input, ctx, now = new Date().toISOString()) {
  const kind = input.kind;
  if (!Object.hasOwn(REMOVAL_BY_KIND, kind))
    throw refusal(`unknown resource kind: ${kind}`, "invalid");
  const base = {
    id: `res_${crypto.randomBytes(8).toString("hex")}`,
    kind,
    removal: REMOVAL_BY_KIND[kind],
    created_by: input.createdBy,
    created_at: now,
    label: input.label || null,
    status: "registered",
    removed_at: null,
    last_close: null,
  };
  if (kind === "directory" || kind === "worktree") {
    const resolved = resolveRegisteredPath(input.path);
    if (resolved.refusal) throw refusal(`${input.path} ${resolved.refusal}`);
    const reason =
      kind === "directory"
        ? directoryRefusal(resolved.real, ctx)
        : worktreeRefusal(resolved.real, ctx);
    if (reason) throw refusal(`${resolved.real} ${reason}`);
    if (kind === "directory") return { ...base, path: resolved.real };
    const listed = ctx.worktrees.find((worktree) => worktree.path === resolved.real);
    return { ...base, path: resolved.real, branch: listed?.branch || null };
  }
  if (kind === "process") {
    const pid = Number(input.pid);
    const forbidden = forbiddenPid(pid);
    if (forbidden) throw refusal(`pid ${input.pid} ${forbidden}`);
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "EPERM") throw refusal(`pid ${pid} belongs to another user`);
      throw refusal(`pid ${pid} is not running`);
    }
    const identity = processIdentity(pid);
    if (identity?.unsupported)
      throw refusal("process resources are not supported on this platform");
    if (!identity) throw refusal(`pid ${pid} is not running`);
    return { ...base, pid, ...identity };
  }
  if (!IDENTIFIER_PATTERN.test(input.identifier || ""))
    throw refusal(
      "--identifier must start with a letter or digit and use only A-Z a-z 0-9 . _ : @ + / = -",
      "invalid"
    );
  if (!TEARDOWN_NAME_PATTERN.test(input.teardown || ""))
    throw refusal("--teardown must name a teardown declared in the project's PM config", "invalid");
  return { ...base, identifier: input.identifier, teardown: input.teardown };
}

function sameTarget(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "directory" || a.kind === "worktree") return a.path === b.path;
  if (a.kind === "process") return a.pid === b.pid && a.started_at === b.started_at;
  return a.identifier === b.identifier && a.teardown === b.teardown;
}

function refusal(message, type = "refused") {
  const error = new Error(message);
  error.resourceRefusal = type;
  return error;
}

function targetOf(entry) {
  if (entry.kind === "directory" || entry.kind === "worktree") return entry.path;
  if (entry.kind === "process") return `pid ${entry.pid}`;
  return entry.identifier;
}

// ---------------------------------------------------------------------------
// Removal

function closeEntry(entry, ctx, dryRun) {
  if (entry.status !== "registered") {
    return { outcome: "already-closed", reason: `already ${entry.status}`, bytes: 0 };
  }
  try {
    if (entry.kind === "directory") return closeDirectory(entry, ctx, dryRun);
    if (entry.kind === "worktree") return closeWorktree(entry, ctx, dryRun);
    if (entry.kind === "process") return closeProcess(entry, ctx, dryRun);
    return closeProjectResource(entry, ctx, dryRun);
  } catch (error) {
    return { outcome: "failed", reason: error.message.slice(0, 2000), bytes: 0 };
  }
}

function closeDirectory(entry, ctx, dryRun) {
  const checked = recheckRecordedPath(entry.path);
  if (checked.gone) return { outcome: "gone", reason: "no longer exists", bytes: 0 };
  if (checked.refusal) return { outcome: "refused", reason: checked.refusal, bytes: 0 };
  const reason = directoryRefusal(checked.real, ctx);
  if (reason) return { outcome: "refused", reason, bytes: 0 };
  const inUse = protectedBy(checked.real, ctx);
  if (inUse) return { outcome: "preserved", reason: inUse, bytes: 0 };
  const bytes = measureBytes(checked.real);
  if (dryRun) return { outcome: "would-remove", reason: "directory", bytes };
  return removeTree(checked.real, bytes);
}

// fs.rmSync unlinks symlinks inside the tree; it never follows them.
function removeTree(real, bytes) {
  try {
    fs.rmSync(real, { recursive: true, maxRetries: 2 });
    return { outcome: "removed", reason: "removed", bytes };
  } catch (error) {
    const left = fs.existsSync(real) ? measureBytes(real) : 0;
    return {
      outcome: "failed",
      reason: `could not remove everything: ${error.code || error.message}`,
      bytes: Math.max(0, bytes - left),
    };
  }
}

function closeWorktree(entry, ctx, dryRun) {
  const checked = recheckRecordedPath(entry.path);
  if (checked.gone) return { outcome: "gone", reason: "no longer exists", bytes: 0 };
  if (checked.refusal) return { outcome: "refused", reason: checked.refusal, bytes: 0 };
  const reason = worktreeRefusal(checked.real, ctx);
  if (reason) return { outcome: "refused", reason, bytes: 0 };
  const inUse = protectedBy(checked.real, ctx);
  if (inUse) return { outcome: "preserved", reason: inUse, bytes: 0 };
  const unsaved = unsavedWork(checked.real, ctx);
  if (unsaved) return { outcome: "preserved", reason: unsaved, bytes: 0 };
  const bytes = measureBytes(checked.real);
  if (dryRun) return { outcome: "would-remove", reason: "clean worktree", bytes };
  // Never --force: git refuses anything it considers unclean, and no branch
  // is deleted.
  const removed = git(ctx.repoRoot, ["worktree", "remove", "--", checked.real]);
  if (!removed.ok)
    return { outcome: "failed", reason: `git worktree remove: ${removed.stderr}`, bytes: 0 };
  return { outcome: "removed", reason: "removed clean worktree", bytes };
}

function unsavedWork(real, ctx) {
  const listed = ctx.worktrees.find((worktree) => worktree.path === real);
  if (listed?.locked) return "is locked";
  const status = git(real, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (!status.ok) return `cannot read git status: ${status.stderr}`;
  const changes = status.stdout.split("\n").filter(Boolean);
  if (changes.length) {
    const shown = changes.slice(0, 5).map((line) => line.trim());
    return `has uncommitted or untracked changes (${changes.length}): ${shown.join(", ")}`;
  }
  const branch = git(real, ["symbolic-ref", "-q", "--short", "HEAD"]);
  const name = branch.ok ? branch.stdout.trim() : null;
  const args = ["rev-list", "--count", "HEAD", "--not"];
  if (name) args.push(`--exclude=${name}`);
  args.push("--branches", "--remotes");
  const ahead = git(real, args);
  if (!ahead.ok) return `cannot check for unsaved commits: ${ahead.stderr}`;
  const count = Number(ahead.stdout.trim());
  if (count > 0)
    return `${count} commit(s) on ${name || "a detached HEAD"} are not on any remote or other branch`;
  // git worktree remove deletes ignored files without asking. PM evidence is
  // usually ignored, so a worktree holding it is kept.
  if (holdsFiles(path.join(real, ".pm")))
    return "holds PM state in .pm; keep the evidence you need, then remove it";
  return null;
}

function holdsFiles(directory) {
  const pending = [directory];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of entries) {
      if (item.isDirectory()) pending.push(path.join(current, item.name));
      else return true;
    }
  }
  return false;
}

function closeProcess(entry, ctx, dryRun) {
  const forbidden = forbiddenPid(entry.pid);
  if (forbidden) return { outcome: "refused", reason: `pid ${entry.pid} ${forbidden}`, bytes: 0 };
  const identity = processIdentity(entry.pid);
  if (identity?.unsupported)
    return { outcome: "refused", reason: "processes are not supported on this platform", bytes: 0 };
  if (!identity) return { outcome: "gone", reason: "has exited", bytes: 0 };
  if (!sameProcess(entry, identity))
    return { outcome: "gone", reason: "pid now belongs to a different process", bytes: 0 };
  for (const target of ctx.protectedTargets) {
    if (target.pid === entry.pid)
      return {
        outcome: "preserved",
        reason: `is in use by active session ${target.slug}`,
        bytes: 0,
      };
  }
  if (dryRun) return { outcome: "would-remove", reason: "running process", bytes: 0 };
  // Signal the pid itself, never a process group.
  if (!signal(entry.pid, "SIGTERM")) return { outcome: "gone", reason: "has exited", bytes: 0 };
  if (waitForExit(entry, ctx.graceMs))
    return { outcome: "removed", reason: "stopped with SIGTERM", bytes: 0 };
  if (!sameProcess(entry, processIdentity(entry.pid)))
    return { outcome: "removed", reason: "stopped with SIGTERM", bytes: 0 };
  signal(entry.pid, "SIGKILL");
  if (waitForExit(entry, 2000))
    return { outcome: "removed", reason: "stopped with SIGKILL after SIGTERM", bytes: 0 };
  return { outcome: "failed", reason: "still running after SIGTERM and SIGKILL", bytes: 0 };
}

function signal(pid, name) {
  try {
    process.kill(pid, name);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    throw new Error(`cannot signal pid ${pid}: ${error.code || error.message}`);
  }
}

function closeProjectResource(entry, ctx, dryRun) {
  if (!ctx.repoRoot)
    return {
      outcome: "refused",
      reason: "the session's repository is missing, so no teardown can be read",
      bytes: 0,
    };
  // The same database, account or simulator registered by a session still in
  // use is kept, as paths and processes are.
  const inUse = ctx.protectedTargets.find(
    (target) => target.kind === entry.kind && target.identifier === entry.identifier
  );
  if (inUse)
    return { outcome: "preserved", reason: `is in use by active session ${inUse.slug}`, bytes: 0 };
  if (!ctx.configRoot)
    return {
      outcome: "refused",
      reason: "the repository's main worktree cannot be found, so no teardown can be read",
      bytes: 0,
    };
  const teardown = declaredTeardown(ctx.configRoot, entry);
  if (teardown.missing)
    return {
      outcome: "no-teardown",
      reason: `not removed: no declared teardown named ${entry.teardown}`,
      bytes: 0,
    };
  if (teardown.refusal) return { outcome: "refused", reason: teardown.refusal, bytes: 0 };
  if (dryRun)
    return { outcome: "would-remove", reason: `would run ${teardown.argv.join(" ")}`, bytes: 0 };
  const run = spawnSync(teardown.argv[0], teardown.argv.slice(1), {
    cwd: ctx.configRoot,
    encoding: "utf8",
    timeout: teardown.timeout,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PM_RESOURCE_KIND: entry.kind, PM_RESOURCE_ID: entry.identifier },
  });
  if (run.error)
    return {
      outcome: "failed",
      reason: `teardown ${entry.teardown}: ${run.error.message}`,
      bytes: 0,
    };
  if (run.status !== 0) {
    const tail = (run.stderr || run.stdout || "").trim().slice(-500);
    return {
      outcome: "failed",
      reason: `teardown ${entry.teardown} exited with ${run.status ?? run.signal}${tail ? `: ${tail}` : ""}`,
      bytes: 0,
    };
  }
  return { outcome: "removed", reason: `teardown ${entry.teardown} succeeded`, bytes: 0 };
}

const REMAINING_OUTCOMES = new Set(["preserved", "refused", "failed", "no-teardown"]);

// Close every registered entry. One failure never stops the others. Returns
// the updated ledger and a report; persisting is the caller's job.
function closeLedger(resources, ctx, { dryRun = false, now = new Date().toISOString() } = {}) {
  const updated = [];
  const entries = [];
  for (const entry of resources || []) {
    const result = closeEntry(entry, ctx, dryRun);
    entries.push({
      id: entry.id,
      kind: entry.kind,
      target: targetOf(entry),
      created_by: entry.created_by,
      outcome: result.outcome,
      reason: result.reason,
      bytes: result.bytes,
    });
    if (dryRun || result.outcome === "already-closed") {
      updated.push(entry);
      continue;
    }
    const last = {
      at: now,
      outcome: result.outcome,
      reason: result.reason,
      bytes_freed: result.bytes,
    };
    if (result.outcome === "removed" || result.outcome === "gone") {
      updated.push({ ...entry, status: result.outcome, removed_at: now, last_close: last });
    } else {
      updated.push({ ...entry, last_close: last });
    }
  }
  const remaining = entries.filter((item) => REMAINING_OUTCOMES.has(item.outcome));
  return {
    resources: updated,
    report: {
      dry_run: dryRun,
      entries,
      bytes_freed: dryRun
        ? 0
        : entries
            .filter((item) => item.outcome === "removed")
            .reduce((sum, item) => sum + item.bytes, 0),
      bytes_to_free: dryRun
        ? entries
            .filter((item) => item.outcome === "would-remove")
            .reduce((sum, item) => sum + item.bytes, 0)
        : 0,
      remaining,
    },
    changed: !dryRun && entries.some((item) => item.outcome !== "already-closed"),
  };
}

// ---------------------------------------------------------------------------
// Session discovery for the sweep and for active-session protection

// Real session state is untracked local state. A session file Git tracks came
// from a branch, which anyone can write, so it is left out of discovery and,
// when the caller passes `ignored`, reported there. When Git cannot say, the
// session is kept as unreadable, which counts as active: nothing it lists is
// removed and everything it lists is protected.
function discoverSessions(repoRoot, { ignored } = {}) {
  const roots = new Set([repoRoot, ...listWorktrees(repoRoot).map((item) => item.path)]);
  const found = [];
  for (const root of roots) {
    const sessionsDir = path.join(root, ".pm", "dev-sessions");
    for (const slug of safeList(sessionsDir)) {
      if (slug === "completed") continue;
      found.push({ root, sessionPath: path.join(sessionsDir, slug, "session.json") });
    }
    const completed = path.join(sessionsDir, "completed");
    for (const slug of safeList(completed)) {
      for (const run of safeList(path.join(completed, slug))) {
        found.push({ root, sessionPath: path.join(completed, slug, run, "session.json") });
      }
    }
  }
  const sessions = [];
  const seen = new Set();
  for (const { root, sessionPath } of found) {
    let stat;
    try {
      stat = fs.lstatSync(sessionPath);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const key = realOrNull(sessionPath) || sessionPath;
    if (seen.has(key)) continue;
    seen.add(key);
    const tracked = trackedByGit(root, sessionPath);
    if (tracked.tracked) {
      if (Array.isArray(ignored))
        ignored.push({
          session_path: sessionPath,
          reason:
            "the session file is tracked by Git, so it came from a branch rather than a local Dev run; its resources are not touched",
        });
      continue;
    }
    let raw = null;
    let error = tracked.error;
    if (!error) {
      try {
        raw = readBoundedJsonFile(sessionPath, MAX_SESSION_BYTES);
        if (!isPlainObject(raw)) throw new Error("session is not an object");
      } catch (readError) {
        error = readError.message;
      }
    }
    sessions.push({ sessionPath, key, raw, error });
  }
  return sessions;
}

function trackedByGit(root, sessionPath) {
  const listed = git(root, [
    "ls-files",
    "--error-unmatch",
    "--",
    path.relative(root, sessionPath).split(path.sep).join("/"),
  ]);
  if (listed.ok) return { tracked: true, error: null };
  if (/did not match any file/i.test(listed.stderr)) return { tracked: false, error: null };
  return {
    tracked: false,
    error: `cannot tell whether Git tracks the session file: ${listed.stderr || "git failed"}`,
  };
}

function safeList(directory) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((item) => item.isDirectory())
      .map((item) => item.name)
      .sort();
  } catch {
    return [];
  }
}

function lockOwnerAlive(sessionPath) {
  const lockPath = `${sessionPath}.lock`;
  if (!fs.existsSync(lockPath)) return false;
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(lockPath, "owner.json"), "utf8"));
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) return true;
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    // A lock without readable owner metadata is treated as live.
    return error.code !== "ESRCH";
  }
}

// finished: complete, or parked by the Design Director.
// abandoned: active or blocked, unlocked, and untouched for ABANDONED_AFTER_MS.
// active: everything else, including anything unreadable. When unsure, leave it.
// A handed-off session is active however long it has been idle: the headless
// loop worker still owns it and runs merge-check against its resources.
function classifySession(found, now = Date.now()) {
  const { raw, error, sessionPath } = found;
  if (error || !raw) return { state: "active", reason: `unreadable: ${error || "empty"}` };
  if (lockOwnerAlive(sessionPath)) return { state: "active", reason: "a process holds its lock" };
  if (raw.status === "complete") return { state: "finished", reason: raw.status };
  if (raw.status === "handoff")
    return { state: "active", reason: "handed off to the loop worker, which still owns it" };
  const blocker = Array.isArray(raw.blockers)
    ? raw.blockers.filter((item) => item && !item.resolved_at).at(-1)
    : null;
  if (raw.status === "blocked" && blocker?.code === "design-director-parked")
    return { state: "finished", reason: "parked" };
  if (raw.status !== "active" && raw.status !== "blocked")
    return { state: "active", reason: `unknown status ${raw.status}` };
  const times = [
    raw.updated_at,
    ...(Array.isArray(raw.resources) ? raw.resources.map((item) => item?.created_at) : []),
  ]
    .map((value) => (isRfc3339DateTime(value) ? Date.parse(value) : NaN))
    .filter(Number.isFinite);
  if (!times.length) return { state: "active", reason: "no readable activity time" };
  const idle = now - Math.max(...times);
  if (idle >= ABANDONED_AFTER_MS)
    return {
      state: "abandoned",
      reason: `${raw.status} and idle for ${Math.floor(idle / 3600000)}h`,
    };
  return { state: "active", reason: `${raw.status} and recently updated` };
}

// Paths, pids and project resources that sessions still in use depend on.
// Close and the sweep never remove anything overlapping them.
function activeTargets(sessions, excludeKey) {
  const targets = [];
  for (const found of sessions) {
    if (found.key === excludeKey) continue;
    const { state } = classifySession(found);
    if (state !== "active") continue;
    const slug = found.raw?.slug || path.basename(path.dirname(found.sessionPath));
    const add = (candidate) => {
      if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return;
      targets.push({ slug, path: realOrNull(candidate) || candidate });
    };
    add(path.dirname(found.sessionPath));
    const source = found.raw?.source;
    if (source && source.worktree && source.worktree !== source.repo_root) add(source.worktree);
    for (const unit of found.raw?.task?.work_units || []) add(unit?.worktree);
    for (const item of Array.isArray(found.raw?.resources) ? found.raw.resources : []) {
      if (!item || item.status !== "registered") continue;
      if (item.kind === "directory" || item.kind === "worktree") add(item.path);
      if (item.kind === "process" && Number.isSafeInteger(item.pid))
        targets.push({ slug, pid: item.pid });
      if (PROJECT_KINDS.has(item.kind) && typeof item.identifier === "string")
        targets.push({ slug, kind: item.kind, identifier: item.identifier });
    }
  }
  return targets;
}

module.exports = {
  ABANDONED_AFTER_MS,
  PROJECT_KINDS,
  REMOVAL_BY_KIND,
  activeTargets,
  buildContext,
  classifySession,
  closeLedger,
  discoverSessions,
  prepareEntry,
  realOrNull,
  sameTarget,
  validateResources,
};
