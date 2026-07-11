"use strict";

const { execFileSync } = require("node:child_process");

const VALID_STATUSES = new Set(["pending", "running", "completed", "blocked", "failed"]);
const WORK_UNIT_FIELDS = new Set([
  "id",
  "title",
  "depends_on",
  "owns",
  "status",
  "result",
  "base_commit",
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

function validateWorkUnits(units) {
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
    if (item.result !== undefined && item.result !== null && !isObject(item.result)) {
      throw new TypeError(`work unit ${item.id} result must be null or an object`);
    }
    if (item.transitions !== undefined && !Array.isArray(item.transitions)) {
      throw new TypeError(`work unit ${item.id} transitions must be an array`);
    }
    if (item.updated_at !== undefined && item.updated_at !== null && !nonEmpty(item.updated_at)) {
      throw new TypeError(`work unit ${item.id} updated_at must be null or a non-empty string`);
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
  return execFileSync("git", ["-C", worktree, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
  validateWorkUnitResult,
  validateWorkUnits,
};
