"use strict";

const { stableStringify } = require("./workflow-runtime/records.js");

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
    for (const owned of priorOwns) {
      if (!nextOwns.includes(owned)) {
        throw new Error(`issue ${before.num} owns are append-only; ${owned} was removed`);
      }
    }
    const added = nextOwns.filter((owned) => !priorOwns.includes(owned));
    if (added.length === 0) {
      throw new Error(`issue ${before.num} adds no owned paths; drop it from --issues`);
    }
    changes.push({ num: before.num, added_owns: added });
  });
  return changes;
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

module.exports = { assertOwnsOnlyAmendment, parseAmendedIssueNums };
