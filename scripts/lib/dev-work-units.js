"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runGit: sharedRunGit } = require("../loop-git");
const { isRfc3339DateTime } = require("./iso-time");

const VALID_STATUSES = new Set(["pending", "running", "completed", "blocked", "failed"]);
const WORK_UNIT_FIELDS = new Set([
  "id",
  "title",
  "depends_on",
  "owns",
  "contract",
  "status",
  "result",
  "base_commit",
  "assigned_worktree",
  "assigned_branch",
  "transitions",
  "updated_at",
]);
const RESULT_STATUSES = new Set(["completed", "blocked", "failed"]);
const RESULT_FIELDS = new Set([
  "schema_version",
  "work_unit_id",
  "status",
  "summary",
  "reason",
  "commit",
  "files_changed",
  "evidence",
  "blocker",
  "runtime",
]);
const TRANSITION_FIELDS = new Set(["from", "to", "reason", "commit", "recorded_at"]);
const DESIGN_CONTEXT_FIELDS = new Set([
  "design_requirements",
  "prototype",
  "critical_states",
  "visual_invariants",
]);
const PROTOTYPE_FIELDS = new Set(["path", "sha256"]);
const MAX_PROTOTYPE_BYTES = 10 * 1024 * 1024;

function validateWorkUnits(units, options = {}) {
  if (!Array.isArray(units)) throw new TypeError("work units must be an array");
  const byId = new Map();

  for (const item of units) {
    if (!isObject(item)) throw new TypeError("each work unit must be an object");
    for (const field of Object.keys(item)) {
      if (!WORK_UNIT_FIELDS.has(field)) {
        throw new Error(`work unit ${item.id || "(unknown)"} has unknown field: ${field}`);
      }
    }
    if (!nonEmpty(item.id)) throw new TypeError("work unit id is required");
    if (byId.has(item.id)) throw new Error(`duplicate work unit id: ${item.id}`);
    if (!nonEmpty(item.title)) throw new TypeError(`work unit ${item.id} title is required`);
    if (!Array.isArray(item.depends_on)) {
      throw new TypeError(`work unit ${item.id} depends_on must be an array`);
    }
    if (!Array.isArray(item.owns) || item.owns.length === 0) {
      throw new TypeError(`work unit ${item.id} owns must be a non-empty array`);
    }
    if (!VALID_STATUSES.has(item.status)) {
      throw new Error(`work unit ${item.id} has invalid status: ${String(item.status)}`);
    }
    if (item.contract !== undefined) validateWorkUnitContract(item.contract, item.id, options);
    if (item.result !== undefined && item.result !== null && !isObject(item.result)) {
      throw new TypeError(`work unit ${item.id} result must be null or an object`);
    }
    for (const field of ["assigned_worktree", "assigned_branch", "base_commit"]) {
      if (item[field] !== undefined && item[field] !== null && !nonEmpty(item[field])) {
        throw new TypeError(`work unit ${item.id} ${field} must be null or a non-empty string`);
      }
    }
    if (item.assigned_worktree !== undefined && item.assigned_worktree !== null) {
      if (!path.isAbsolute(item.assigned_worktree)) {
        throw new TypeError(`work unit ${item.id} assigned_worktree must be absolute`);
      }
    }
    if (item.transitions !== undefined && !Array.isArray(item.transitions)) {
      throw new TypeError(`work unit ${item.id} transitions must be an array`);
    }
    if (item.updated_at !== undefined && item.updated_at !== null && !nonEmpty(item.updated_at)) {
      throw new TypeError(`work unit ${item.id} updated_at must be null or a non-empty string`);
    }
    if (item.updated_at && !isRfc3339DateTime(item.updated_at)) {
      throw new TypeError(`work unit ${item.id} updated_at must be an RFC 3339 date-time`);
    }
    if (options.persisted && ["running", "completed", "blocked", "failed"].includes(item.status)) {
      for (const field of ["base_commit", "assigned_worktree", "assigned_branch"]) {
        if (!nonEmpty(item[field]))
          throw new TypeError(`work unit ${item.id} ${field} is required`);
      }
    }
    if (options.persisted && ["completed", "blocked", "failed"].includes(item.status)) {
      const persistedResult = validateWorkUnitResult(item.result, {
        expectedWorkUnitId: item.id,
      });
      if (persistedResult.status !== item.status) {
        throw new Error(
          `work unit ${item.id} result status ${persistedResult.status} does not match ${item.status}`
        );
      }
    } else if (options.persisted && item.result !== undefined && item.result !== null) {
      throw new Error(`work unit ${item.id} cannot have a result while ${item.status}`);
    }
    for (const [index, transition] of (item.transitions || []).entries()) {
      validateTransition(item.id, transition, index);
    }
    for (const ownership of item.owns) {
      if (!nonEmpty(ownership)) throw new TypeError(`work unit ${item.id} has empty ownership`);
      validateRepoRelativePattern(ownership, `work unit ${item.id} ownership`);
    }
    byId.set(item.id, item);
  }

  for (const item of units) {
    const uniqueDependencies = new Set();
    for (const dependency of item.depends_on) {
      if (!nonEmpty(dependency)) {
        throw new TypeError(`work unit ${item.id} has an empty dependency`);
      }
      if (dependency === item.id) throw new Error(`work unit ${item.id} depends on itself`);
      if (!byId.has(dependency)) {
        throw new Error(`work unit ${item.id} has unknown dependency ${dependency}`);
      }
      if (uniqueDependencies.has(dependency)) {
        throw new Error(`work unit ${item.id} repeats dependency ${dependency}`);
      }
      uniqueDependencies.add(dependency);
    }
  }

  detectCycle(units, byId);
  return units;
}

function validateTransition(unitId, transition, index) {
  if (!isObject(transition)) {
    throw new TypeError(`work unit ${unitId} transition ${index} must be an object`);
  }
  for (const field of Object.keys(transition)) {
    if (!TRANSITION_FIELDS.has(field)) {
      throw new Error(`work unit ${unitId} transition ${index} has unknown field ${field}`);
    }
  }
  for (const field of TRANSITION_FIELDS) {
    if (!Object.hasOwn(transition, field)) {
      throw new Error(`work unit ${unitId} transition ${index} requires ${field}`);
    }
  }
  if (!VALID_STATUSES.has(transition.from) || !VALID_STATUSES.has(transition.to)) {
    throw new Error(`work unit ${unitId} transition ${index} has invalid status`);
  }
  if (!nonEmpty(transition.reason)) {
    throw new TypeError(`work unit ${unitId} transition ${index} reason is required`);
  }
  if (transition.commit !== null && !nonEmpty(transition.commit)) {
    throw new TypeError(`work unit ${unitId} transition ${index} commit must be null or a string`);
  }
  if (!isRfc3339DateTime(transition.recorded_at)) {
    throw new TypeError(`work unit ${unitId} transition ${index} recorded_at must be RFC 3339`);
  }
}

function validateWorkUnitContract(contract, unitId, options = {}) {
  if (!isObject(contract)) throw new TypeError(`work unit ${unitId} contract must be an object`);
  const fields = [
    "acceptance_criteria",
    "approach",
    "verification_commands",
    "test_hooks",
    "design_context",
  ];
  for (const field of Object.keys(contract)) {
    if (!fields.includes(field))
      throw new Error(`work unit ${unitId} contract has unknown field ${field}`);
  }
  for (const field of fields.filter((name) => name !== "design_context")) {
    if (!Object.hasOwn(contract, field)) {
      throw new Error(`work unit ${unitId} contract requires ${field}`);
    }
  }
  for (const field of ["acceptance_criteria", "verification_commands", "test_hooks"]) {
    if (!Array.isArray(contract[field]) || contract[field].some((item) => !nonEmpty(item))) {
      throw new TypeError(`work unit ${unitId} contract ${field} must contain non-empty strings`);
    }
  }
  if (contract.acceptance_criteria.length === 0 || contract.verification_commands.length === 0) {
    throw new TypeError(`work unit ${unitId} contract requires acceptance and verification`);
  }
  if (!nonEmpty(contract.approach)) {
    throw new TypeError(`work unit ${unitId} contract approach is required`);
  }
  if (contract.design_context !== undefined) {
    validateDesignContext(contract.design_context, `work unit ${unitId} contract design_context`, {
      repoRoot: options.repoRoot,
    });
  }
}

function validateDesignContext(context, label = "design_context", options = {}) {
  if (!isObject(context)) throw new TypeError(`${label} must be an object`);
  for (const field of Object.keys(context)) {
    if (!DESIGN_CONTEXT_FIELDS.has(field)) {
      throw new Error(`${label} has unknown field ${field}`);
    }
  }
  for (const field of DESIGN_CONTEXT_FIELDS) {
    if (!Object.hasOwn(context, field)) throw new Error(`${label} requires ${field}`);
  }
  for (const field of ["design_requirements", "critical_states", "visual_invariants"]) {
    const values = context[field];
    if (!Array.isArray(values) || values.length === 0) {
      throw new TypeError(`${label}.${field} must be a non-empty array`);
    }
    if (values.some((item) => !nonEmpty(item))) {
      throw new TypeError(`${label}.${field} must contain non-empty strings`);
    }
    if (new Set(values).size !== values.length) {
      throw new Error(`${label}.${field} must not contain duplicates`);
    }
  }
  const prototype = context.prototype;
  if (prototype === null) return context;
  if (!isObject(prototype)) throw new TypeError(`${label}.prototype must be null or an object`);
  for (const field of Object.keys(prototype)) {
    if (!PROTOTYPE_FIELDS.has(field)) {
      throw new Error(`${label}.prototype has unknown field ${field}`);
    }
  }
  for (const field of PROTOTYPE_FIELDS) {
    if (!Object.hasOwn(prototype, field)) throw new Error(`${label}.prototype requires ${field}`);
  }
  if (!nonEmpty(prototype.path)) throw new TypeError(`${label}.prototype.path is required`);
  validateRepoRelativePattern(prototype.path, `${label}.prototype.path`);
  if (
    prototype.path !== normalizePattern(prototype.path) ||
    prototype.path.includes("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(prototype.path) ||
    prototype.path.split("/").some((part) => part === "." || part === "") ||
    hasGlob(prototype.path)
  ) {
    throw new Error(`${label}.prototype.path must identify one normalized repo-relative file`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(prototype.sha256 || "")) {
    throw new Error(`${label}.prototype.sha256 must be a sha256:<64 lowercase hex> binding`);
  }
  if (options.repoRoot) {
    verifyPrototypeBinding(prototype, `${label}.prototype`, options.repoRoot);
  }
  return context;
}

function verifyPrototypeBinding(prototype, label, repoRoot) {
  let root;
  try {
    root = fs.realpathSync(path.resolve(repoRoot));
  } catch (error) {
    throw new Error(`${label}.path repository root cannot be resolved: ${error.message}`);
  }
  const candidate = path.resolve(root, prototype.path);
  if (!isWithin(root, candidate)) {
    throw new Error(`${label}.path must stay inside the repository root`);
  }
  let current = root;
  try {
    for (const part of path.relative(root, candidate).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error("contains a symbolic link");
      }
    }
  } catch (error) {
    throw new Error(`${label}.path cannot be read as a repository file: ${error.message}`);
  }
  let bytes;
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let fd;
  try {
    fd = fs.openSync(candidate, flags);
    const before = fs.fstatSync(fd);
    if (!before.isFile()) throw new Error("must identify a regular file");
    if (before.size > MAX_PROTOTYPE_BYTES) {
      throw new Error("exceeds the 10 MiB read limit");
    }
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("changed during bounded read");
      offset += count;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("changed during bounded read");
    }
  } catch (error) {
    throw new Error(`${label}.path cannot be read as a repository file: ${error.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const observed = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (observed !== prototype.sha256) {
    throw new Error(`${label}.sha256 does not match repository bytes at ${prototype.path}`);
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function analyzeWorkUnits(units) {
  validateWorkUnits(units);
  const completed = new Set(
    units.filter((item) => item.status === "completed").map((item) => item.id)
  );
  const running = units.filter((item) => item.status === "running");
  const ready = units.filter(
    (item) =>
      item.status === "pending" && item.depends_on.every((dependency) => completed.has(dependency))
  );
  const waiting = units.filter(
    (item) => item.status === "pending" && !ready.some((readyItem) => readyItem.id === item.id)
  );
  const blocked = units.filter((item) => item.status === "blocked" || item.status === "failed");
  const runnable = [];
  const serialized = [];

  for (const item of ready) {
    const conflicts = [...running, ...runnable]
      .filter((active) => ownershipOverlaps(item.owns, active.owns))
      .map((active) => active.id);
    if (conflicts.length > 0) {
      serialized.push({ id: item.id, conflicts_with: conflicts, reason: "ownership overlap" });
    } else {
      runnable.push(item);
    }
  }

  return { ready, runnable, serialized, waiting, running, blocked };
}

function ownershipOverlaps(left, right) {
  validateOwnershipList(left, "left ownership");
  validateOwnershipList(right, "right ownership");
  return left.some((leftPattern) =>
    right.some((rightPattern) => patternsOverlap(leftPattern, rightPattern))
  );
}

function patternsOverlap(leftValue, rightValue) {
  const left = normalizePattern(leftValue);
  const right = normalizePattern(rightValue);
  if (left === right) return true;

  const leftGlob = hasGlob(left);
  const rightGlob = hasGlob(right);
  if (leftGlob && !rightGlob && globMatches(left, right)) return true;
  if (rightGlob && !leftGlob && globMatches(right, left)) return true;
  if (!leftGlob && !rightGlob) return rootsIntersect(left, right);

  const leftRoot = literalRoot(left);
  const rightRoot = literalRoot(right);
  return rootsIntersect(leftRoot, rightRoot);
}

function narrowAuthority(parent, requested = {}) {
  if (!isObject(parent)) throw new TypeError("parent authority must be an object");
  if (!isObject(requested)) throw new TypeError("requested authority must be an object");
  const parentKeys = Object.keys(parent);

  for (const [action, value] of Object.entries(parent)) {
    if (typeof value !== "boolean")
      throw new TypeError(`parent authority ${action} must be boolean`);
  }
  for (const [action, value] of Object.entries(requested)) {
    if (!Object.prototype.hasOwnProperty.call(parent, action)) {
      throw new Error(`unknown authority action: ${action}`);
    }
    if (typeof value !== "boolean") {
      throw new TypeError(`requested authority ${action} must be boolean`);
    }
    if (value && !parent[action]) throw new Error(`cannot expand authority: ${action}`);
  }

  return Object.fromEntries(parentKeys.map((action) => [action, requested[action] === true]));
}

function validateWorkUnitResult(input, options = {}) {
  const result = parseResult(input);
  for (const field of Object.keys(result)) {
    if (!RESULT_FIELDS.has(field)) throw new Error(`unknown worker result field: ${field}`);
  }
  for (const field of [...RESULT_FIELDS].filter((name) => name !== "reason")) {
    if (!Object.prototype.hasOwnProperty.call(result, field)) {
      throw new Error(`worker result requires ${field}`);
    }
  }
  if (result.schema_version !== 1) throw new Error("worker result schema_version must equal 1");
  if (!nonEmpty(result.work_unit_id)) throw new Error("worker result requires work_unit_id");
  if (
    options.expectedWorkUnitId !== undefined &&
    result.work_unit_id !== options.expectedWorkUnitId
  ) {
    throw new Error(
      `work unit id mismatch: expected ${options.expectedWorkUnitId}, received ${result.work_unit_id}`
    );
  }
  if (!RESULT_STATUSES.has(result.status)) {
    throw new Error(`worker result has invalid status: ${String(result.status)}`);
  }
  if (!nonEmpty(result.summary)) throw new Error("worker result requires summary");
  if (result.commit !== null && !nonEmpty(result.commit)) {
    throw new Error("worker result commit must be null or a non-empty string");
  }
  if (!Number.isInteger(result.files_changed) || result.files_changed < 0) {
    throw new Error("worker result files_changed must be a non-negative integer");
  }
  if (!Array.isArray(result.evidence)) throw new Error("worker result evidence must be an array");
  if (result.status === "completed" && result.evidence.length === 0) {
    throw new Error("completed result requires evidence");
  }
  if (result.status === "completed" && !nonEmpty(result.commit)) {
    throw new Error("completed result requires commit");
  }
  for (const evidence of result.evidence) {
    if (!isObject(evidence) || !nonEmpty(evidence.kind)) {
      throw new Error("worker result evidence entries require kind");
    }
  }
  if (
    result.status === "completed" &&
    !result.evidence.some((entry) => Number.isInteger(entry.exit_code) && entry.exit_code === 0)
  ) {
    throw new Error("completed result requires passing evidence");
  }
  if (result.status === "completed" && result.blocker !== null) {
    throw new Error("completed result blocker must be null");
  }
  if (["blocked", "failed"].includes(result.status)) {
    if (!nonEmpty(result.reason)) throw new Error(`${result.status} result requires reason`);
    if (!isObject(result.blocker) || !nonEmpty(result.blocker.reason)) {
      throw new Error(`${result.status} result requires blocker.reason`);
    }
    if (result.reason.trim() !== result.blocker.reason.trim()) {
      throw new Error(`${result.status} result reason must match blocker.reason`);
    }
  }
  if (!isObject(result.runtime) || !nonEmpty(result.runtime.provider)) {
    throw new Error("worker result runtime.provider is required");
  }
  if (result.status === "completed" && options.worktree) {
    validateCompletedCommit(result, options);
  }
  return result;
}

function validateCompletedCommit(result, options) {
  const worktree = options.worktree;
  const ownership = options.expectedOwnership;
  validateOwnershipList(ownership, "expected ownership");

  let head;
  let changedPaths;
  try {
    head = runGit(worktree, ["rev-parse", "HEAD"]);
    const dirty = runGit(worktree, [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude).pm/**",
    ]);
    if (dirty) throw new Error(`assigned worktree is dirty: ${dirty.split("\n")[0]}`);
    if (options.baseCommit) {
      runGit(worktree, ["merge-base", "--is-ancestor", options.baseCommit, result.commit]);
    }
    const diffArgs = options.baseCommit
      ? ["diff", "--name-only", `${options.baseCommit}..${result.commit}`]
      : ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", result.commit];
    changedPaths = runGit(worktree, diffArgs).split("\n").filter(Boolean);
  } catch (error) {
    throw new Error(`could not verify worker commit in assigned worktree: ${error.message}`);
  }

  if (result.commit !== head) {
    throw new Error(`worker commit is stale or outside assigned worktree HEAD: expected ${head}`);
  }
  const escaped = changedPaths.filter(
    (file) => !ownership.some((pattern) => pathIsOwned(file, pattern))
  );
  if (escaped.length > 0) {
    throw new Error(
      `worker commit changed paths outside assigned ownership: ${escaped.join(", ")}`
    );
  }
  if (result.files_changed !== changedPaths.length) {
    throw new Error(
      `worker result files_changed mismatch: reported ${result.files_changed}, observed ${changedPaths.length}`
    );
  }
}

function pathIsOwned(fileValue, patternValue) {
  const file = normalizePattern(fileValue);
  const pattern = normalizePattern(patternValue);
  if (hasGlob(pattern)) return globMatches(pattern, file);
  return file === pattern || file.startsWith(`${pattern}/`);
}

function runGit(worktree, args) {
  return sharedRunGit(args, worktree);
}

function detectCycle(units, byId) {
  const visited = new Set();
  const visiting = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) throw new Error(`dependency cycle: ${[...trail, id].join(" -> ")}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) visit(dependency, [...trail, id]);
    visiting.delete(id);
    visited.add(id);
  }

  for (const item of units) visit(item.id, []);
}

function validateOwnershipList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  if (value.some((item) => !nonEmpty(item))) throw new TypeError(`${label} contains an empty path`);
  for (const item of value) validateRepoRelativePattern(item, label);
}

function validateRepoRelativePattern(value, label) {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a repo-relative path pattern`);
  }
}

function normalizePattern(value) {
  return value
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
}

function hasGlob(value) {
  return /[*?[\]{}]/.test(value);
}

function literalRoot(value) {
  const wildcard = value.search(/[*?[\]{}]/);
  const literal = wildcard === -1 ? value : value.slice(0, wildcard);
  return literal.replace(/\/$/, "");
}

function rootsIntersect(left, right) {
  if (!left || !right) return true;
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function globMatches(pattern, value) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (char === "*") expression += "[^/]*";
    else if (char === "?") expression += "[^/]";
    else expression += char.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  expression += "$";
  return new RegExp(expression).test(value);
}

function parseResult(input) {
  if (isObject(input)) return input;
  if (!nonEmpty(input)) throw new Error("missing worker result");
  try {
    const parsed = JSON.parse(input);
    if (!isObject(parsed)) throw new Error("must be an object");
    return parsed;
  } catch (error) {
    throw new Error(`malformed worker result: ${error.message}`);
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  analyzeWorkUnits,
  narrowAuthority,
  ownershipOverlaps,
  validateOwnershipList,
  validateDesignContext,
  validateRepoRelativePattern,
  validateWorkUnitResult,
  validateWorkUnits,
};
