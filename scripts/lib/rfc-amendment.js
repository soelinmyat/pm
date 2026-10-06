"use strict";

const { stableStringify } = require("./workflow-runtime/records.js");

// All amendments chain through exact prior audits. Bound lineage traversal
// without treating elapsed maintenance depth as a new product decision.
const MAX_LINEAGE_HOPS = 16;

// A post-handoff amendment may only append owned paths to explicitly declared
// issues. Everything else in the approved sidecar must stay byte-for-byte equal
// in meaning, so the re-approval covers exactly the ownership change.
function assertOwnsOnlyAmendment(prior, next, amendedIssueNums) {
  if (!isObject(prior) || !isObject(next)) throw new Error("amendment sidecars must be objects");
  const declared = new Set(amendedIssueNums);
  const keys = new Set([...Object.keys(prior), ...Object.keys(next)]);
  for (const key of [...keys].sort()) {
    if (key === "issues") continue;
    if (fieldChanged(prior, next, key)) {
      throw new Error(`amendment changed top-level field ${key}; only issue owns may change`);
    }
  }
  const priorIssues = Array.isArray(prior.issues) ? prior.issues : [];
  const nextIssues = Array.isArray(next.issues) ? next.issues : [];
  const priorNums = priorIssues.map((item) => item?.num);
  for (const num of declared) {
    if (!priorNums.includes(num)) {
      throw new Error(`amended issue ${num} does not exist in the approved RFC`);
    }
  }
  if (
    !sameValue(
      priorNums,
      nextIssues.map((item) => item?.num)
    )
  ) {
    throw new Error("amendment changed the issue list; only issue owns may change");
  }
  const changes = [];
  priorIssues.forEach((before, index) => {
    const after = nextIssues[index];
    const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const field of [...fields].sort()) {
      if (field === "owns") continue;
      if (fieldChanged(before, after, field)) {
        throw new Error(
          `amendment changed issue ${before.num} field ${field}; only owns may change`
        );
      }
    }
    const priorOwns = Array.isArray(before.owns) ? before.owns : [];
    const nextOwns = Array.isArray(after.owns) ? after.owns : [];
    if (!declared.has(before.num)) {
      if (!sameValue(priorOwns, nextOwns)) {
        throw new Error(
          `issue ${before.num} was not declared in --issues; its owns must stay identical`
        );
      }
      return;
    }
    if (new Set(nextOwns).size !== nextOwns.length) {
      throw new Error(`issue ${before.num} owns contain a duplicate path`);
    }
    priorOwns.forEach((owned, position) => {
      if (nextOwns[position] !== owned) {
        throw new Error(
          `issue ${before.num} owns are append-only; ${owned} was removed, moved, or preceded by a new path`
        );
      }
    });
    // A declared issue may add nothing, so an amendment can still be approved
    // after its review drops one of the paths it first proposed.
    const added = nextOwns.slice(priorOwns.length);
    if (added.length > 0) changes.push({ num: before.num, added_owns: added });
  });
  if (changes.length === 0) {
    throw new Error("amendment adds no owned paths; append at least one path to a declared issue");
  }
  return changes;
}

// Refuses to open another amendment once the chain would exceed what approval
// verification walks. loadRun(runId) returns a completed run or null.
function assertAmendmentDepth(archived, loadRun) {
  const visited = new Set([archived.run_id]);
  let depth = 0;
  let current = archived;
  while (current?.amendment) {
    depth += 1;
    if (depth >= MAX_LINEAGE_HOPS) {
      throw new Error(
        `RFC run ${archived.run_id} already has ${MAX_LINEAGE_HOPS} amendments in its lineage; write a new RFC`
      );
    }
    const priorRunId = current.amendment.of_run_id;
    if (visited.has(priorRunId)) throw new Error(`RFC amendment lineage repeats run ${priorRunId}`);
    visited.add(priorRunId);
    current = loadRun(priorRunId);
  }
  return depth;
}

function parseAmendedIssueNums(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error("amendment requires at least one issue number");
  const nums = parts.map((item) => {
    if (!/^[1-9][0-9]*$/.test(item)) {
      throw new Error(`amended issue number must be a positive integer: ${item}`);
    }
    return Number(item);
  });
  if (new Set(nums).size !== nums.length) throw new Error("amended issue numbers must be unique");
  return nums.sort((left, right) => left - right);
}

function fieldChanged(left, right, key) {
  if (Object.hasOwn(left, key) !== Object.hasOwn(right, key)) return true;
  return !sameValue(left[key], right[key]);
}

function sameValue(left, right) {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

module.exports = {
  MAX_LINEAGE_HOPS,
  assertAmendmentDepth,
  assertOwnsOnlyAmendment,
  parseAmendedIssueNums,
  assertMaintenanceAmendment,
};

// These are execution details, not product requirements. The technical lenses
// must still establish that a changed approach preserves behavior and risk.
const MAINTENANCE_FIELDS = ["approach", "verification_commands", "test_hooks"];

function assertMaintenanceAmendment(prior, next, issueNums) {
  const protectedNext = structuredClone(next);
  const changes = [];
  for (const [index, before] of (prior.issues || []).entries()) {
    const after = next.issues?.[index];
    if (!after) continue; // The owns-only check below diagnoses list changes.
    const updated = {};
    for (const field of MAINTENANCE_FIELDS) {
      if (!fieldChanged(before, after, field)) continue;
      if (!issueNums.includes(before.num)) {
        throw new Error(`issue ${before.num} was not declared in --issues`);
      }
      updated[field] = after[field];
      if (Object.hasOwn(before, field)) protectedNext.issues[index][field] = before[field];
      else delete protectedNext.issues[index][field];
    }
    if (Object.keys(updated).length) changes.push({ num: before.num, updated });
  }
  // Reuse the strict protected-field and append-only ownership comparison. A
  // technical-only update legitimately has no added owned paths.
  let owned;
  try {
    owned = assertOwnsOnlyAmendment(prior, protectedNext, issueNums);
  } catch (error) {
    if (changes.length && error.message.startsWith("amendment adds no owned paths;")) owned = [];
    else throw error;
  }
  const byNum = new Map(changes.map((item) => [item.num, { ...item, added_owns: [] }]));
  for (const item of owned) {
    const change = byNum.get(item.num) || { num: item.num, updated: {} };
    byNum.set(item.num, { ...change, added_owns: item.added_owns });
  }
  return [...byNum.values()].sort((a, b) => a.num - b.num);
}
