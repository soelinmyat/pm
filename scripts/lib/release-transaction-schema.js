"use strict";

const crypto = require("node:crypto");
const { bindEffectReceipt } = require("./workflow-runtime/effect-receipt");
const { isObject, stableStringify } = require("./workflow-runtime/records");

const SHA = /^[a-f0-9]{40,64}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const EFFECT_DEFINITIONS = Object.freeze({
  push: { authority: "push_feature_branch", dependsOn: [] },
  "create-pr": { authority: "create_pr", dependsOn: ["push"] },
  merge: { authority: "merge", dependsOn: ["create-pr"] },
  "place-main-tag": { authority: "merge", dependsOn: ["merge"] },
  "tracker-update": { authority: "tracker_updates", dependsOn: ["merge"] },
});
const EFFECT_STATUSES = new Set([
  "planned",
  "attempting",
  "verified",
  "denied",
  "blocked",
  "failed",
]);
const EVIDENCE_KINDS = new Set(["review", "qa", "verification"]);

function createReleaseTransaction(input) {
  requireObject(input, "release transaction input");
  const timestamp = input.timestamp || new Date().toISOString();
  for (const [name, value] of [
    ["runId", input.runId],
    ["slug", input.slug],
    ["repository", input.repository],
    ["deliveryRemote", input.deliveryRemote],
    ["headBranch", input.headBranch],
    ["baseBranch", input.baseBranch],
  ]) {
    requireString(value, name);
  }
  const releaseMode = input.releaseMode || "versioned";
  if (!new Set(["versioned", "delivery-only"]).has(releaseMode)) {
    throw new Error(`invalid release mode: ${releaseMode}`);
  }
  if (releaseMode === "versioned") {
    if (!VERSION.test(input.currentVersion || "")) throw new Error("invalid current version");
    if (!VERSION.test(input.nextVersion || "")) throw new Error("invalid next version");
    if (compareVersions(input.nextVersion, input.currentVersion) <= 0) {
      throw new Error("next version must be greater than current version");
    }
  } else if (input.currentVersion !== undefined || input.nextVersion !== undefined) {
    throw new Error("delivery-only transaction cannot declare versions");
  }
  if (!SHA.test(input.preparedCommit || "")) throw new Error("invalid prepared commit");
  if (!SHA256.test(input.pushUrlSha256 || "")) throw new Error("invalid push URL SHA-256");
  if (!Array.isArray(input.manifestHashes)) throw new Error("manifest hashes must be an array");
  if (releaseMode === "versioned" && input.manifestHashes.length === 0) {
    throw new Error("versioned release requires manifest hashes");
  }
  const manifestHashes = input.manifestHashes.map((item, index) => {
    requireObject(item, `manifest hash ${index}`);
    requireString(item.path, `manifest hash ${index} path`);
    if (!SHA256.test(item.sha256 || "")) throw new Error(`invalid manifest hash ${index}`);
    return { path: item.path, sha256: item.sha256 };
  });
  const transaction = {
    schema_version: 1,
    run_id: input.runId,
    slug: input.slug,
    owner: { role: "root" },
    source: {
      repository: input.repository,
      delivery_remote: input.deliveryRemote,
      push_url_sha256: input.pushUrlSha256,
      head_branch: input.headBranch,
      base_branch: input.baseBranch,
    },
    release: {
      mode: releaseMode,
      current_version: releaseMode === "versioned" ? input.currentVersion : null,
      next_version: releaseMode === "versioned" ? input.nextVersion : null,
      tag: releaseMode === "versioned" ? `v${input.nextVersion}` : null,
      prepared_commit: input.preparedCommit,
      tag_created: false,
      manifests: manifestHashes,
      prepared_at: timestamp,
    },
    evidence: { review: null, qa: null, verification: null },
    effects: {},
    generation: 1,
    history: [],
    created_at: timestamp,
    updated_at: timestamp,
  };
  assertValid(transaction);
  return transaction;
}

function advancePreparedCommit(transaction, input) {
  const next = cloneAndValidate(transaction);
  requireObject(input, "prepared commit advance");
  if (!SHA.test(input.commit || "")) throw new Error("invalid advanced prepared commit");
  if (input.commit === next.release.prepared_commit) return next;
  requireString(input.reason, "prepared commit advance reason");
  if (["merge", "place-main-tag"].some((name) => next.effects[name]?.status === "verified")) {
    throw new Error("cannot advance the prepared commit after merge verification");
  }
  const timestamp = input.timestamp || new Date().toISOString();
  next.history.push({
    generation: next.generation,
    prepared_commit: next.release.prepared_commit,
    evidence: structuredClone(next.evidence),
    effects: structuredClone(next.effects),
    superseded_at: timestamp,
    reason: input.reason.trim(),
  });
  next.generation += 1;
  next.release.prepared_commit = input.commit;
  if (input.manifestHashes !== undefined) {
    if (!Array.isArray(input.manifestHashes)) throw new Error("manifest hashes must be an array");
    next.release.manifests = input.manifestHashes.map((item, index) => {
      if (!isObject(item) || !nonEmpty(item.path) || !SHA256.test(item.sha256 || "")) {
        throw new Error(`invalid manifest hash ${index}`);
      }
      return structuredClone(item);
    });
  }
  next.release.prepared_at = timestamp;
  next.evidence = { review: null, qa: null, verification: null };
  next.effects = {};
  next.updated_at = timestamp;
  assertValid(next);
  return next;
}

function bindReleaseEvidence(transaction, input) {
  const next = cloneAndValidate(transaction);
  requireObject(input, "release evidence");
  if (!EVIDENCE_KINDS.has(input.kind)) throw new Error(`unknown release evidence: ${input.kind}`);
  if (input.commit !== next.release.prepared_commit) {
    throw new Error(`${input.kind} evidence must bind the prepared commit`);
  }
  requireString(input.artifact, `${input.kind} artifact`);
  if (!SHA256.test(input.sha256 || "")) throw new Error(`invalid ${input.kind} evidence hash`);
  next.evidence[input.kind] = {
    commit: input.commit,
    artifact: input.artifact,
    sha256: input.sha256,
    checked_at: input.checkedAt || new Date().toISOString(),
  };
  next.updated_at = next.evidence[input.kind].checked_at;
  assertValid(next);
  return next;
}

function releaseReadiness(transaction) {
  const issues = transactionIssues(transaction);
  if (issues.length > 0) return { ok: false, issues };
  for (const kind of EVIDENCE_KINDS) {
    const evidence = transaction.evidence[kind];
    if (!evidence) issues.push(`missing ${kind} evidence`);
    else if (evidence.commit !== transaction.release.prepared_commit) {
      issues.push(`${kind} evidence is stale`);
    }
  }
  return { ok: issues.length === 0, issues };
}

function planEffect(transaction, input) {
  const next = cloneAndValidate(transaction);
  requireObject(input, "effect plan");
  const definition = effectDefinition(input.effect);
  requireObject(input.target, `${input.effect} target`);
  if (next.effects[input.effect]) {
    const current = next.effects[input.effect];
    if (stableStringify(current.target) !== stableStringify(input.target)) {
      throw new Error(`${input.effect} target is already frozen`);
    }
    return next;
  }
  validateEffectTarget(input.effect, input.target, next);
  const timestamp = input.timestamp || new Date().toISOString();
  next.effects[input.effect] = {
    name: input.effect,
    required_authority: definition.authority,
    depends_on: [...definition.dependsOn],
    target: structuredClone(input.target),
    idempotency_key: effectKey(next, input.effect, input.target),
    status: "planned",
    attempts: [],
    verified_receipt: null,
    planned_at: timestamp,
    updated_at: timestamp,
  };
  next.updated_at = timestamp;
  assertValid(next);
  return next;
}

function beginEffect(transaction, input) {
  const next = cloneAndValidate(transaction);
  requireObject(input, "effect attempt");
  const effect = requirePlannedEffect(next, input.effect);
  if (input.actor !== "root") throw new Error("release effects are root-owned");
  if (effect.status === "verified") return { transaction: next, decision: "already-verified" };
  if (effect.status === "attempting") return { transaction: next, decision: "observe-first" };
  if (effect.status === "blocked") throw new Error(`${input.effect} is blocked and cannot replay`);
  for (const dependency of effect.depends_on) {
    if (next.effects[dependency]?.status !== "verified") {
      throw new Error(`${input.effect} requires verified effect ${dependency}`);
    }
  }
  requireObject(input.authority, "authority envelope");
  const timestamp = input.timestamp || new Date().toISOString();
  const attempt = emptyAttempt(effect.attempts.length + 1, timestamp);
  if (input.authority[effect.required_authority] !== true) {
    attempt.status = "denied";
    attempt.classification = "authority";
    attempt.finished_at = timestamp;
    attempt.error = `missing authority ${effect.required_authority}`;
    effect.attempts.push(attempt);
    effect.status = "denied";
    effect.updated_at = timestamp;
    next.updated_at = timestamp;
    assertValid(next);
    return { transaction: next, decision: "denied" };
  }
  attempt.status = "attempting";
  attempt.classification = "external-effect";
  effect.attempts.push(attempt);
  effect.status = "attempting";
  effect.updated_at = timestamp;
  next.updated_at = timestamp;
  assertValid(next);
  return { transaction: next, decision: "execute" };
}

function reconcileEffect(transaction, input) {
  const next = cloneAndValidate(transaction);
  requireObject(input, "effect observation");
  const effect = requirePlannedEffect(next, input.effect);
  if (effect.status === "verified") return { transaction: next, decision: "already-verified" };
  if (effect.status !== "attempting") {
    throw new Error(`${input.effect} has no ambiguous attempt to reconcile`);
  }
  const attempt = effect.attempts.at(-1);
  const timestamp = input.timestamp || new Date().toISOString();
  requireObject(input.observation, "effect observation");
  attempt.observation = structuredClone(input.observation);
  attempt.finished_at = timestamp;
  if (input.outcome === "matched") {
    requireObject(input.receipt, "effect receipt");
    validateMatchedReceipt(input.effect, effect.target, input.receipt);
    const receipt = bindEffectReceipt({
      effect: input.effect,
      target: effect.target,
      authorityActions: [effect.required_authority],
      attempt: attempt.number,
      receipt: input.receipt,
      observation: input.observation,
      observedAt: timestamp,
    });
    attempt.status = "verified";
    attempt.receipt = structuredClone(input.receipt);
    effect.status = "verified";
    effect.verified_receipt = receipt;
    effect.updated_at = timestamp;
    next.updated_at = timestamp;
    assertValid(next);
    return { transaction: next, decision: "verified" };
  }
  if (input.outcome === "absent") {
    attempt.status = "not-observed";
    attempt.classification = "observation";
    attempt.error = input.reason || "planned effect was not observed";
    effect.status = "planned";
    effect.updated_at = timestamp;
    next.updated_at = timestamp;
    assertValid(next);
    return { transaction: next, decision: "retry-safe" };
  }
  if (input.outcome === "conflict") {
    attempt.status = "blocked";
    attempt.classification = "identity";
    attempt.error = input.reason || "observed identity conflicts with planned target";
    effect.status = "blocked";
    effect.updated_at = timestamp;
    next.updated_at = timestamp;
    assertValid(next);
    return { transaction: next, decision: "blocked" };
  }
  if (input.outcome === "failed") {
    attempt.status = "failed";
    attempt.classification = input.classification || "environment";
    attempt.error = input.reason || "external effect failed definitively";
    effect.status = "failed";
    effect.updated_at = timestamp;
    next.updated_at = timestamp;
    assertValid(next);
    return { transaction: next, decision: "failed" };
  }
  throw new Error(`unknown effect observation outcome: ${input.outcome}`);
}

function transactionIssues(value) {
  const issues = [];
  if (!isObject(value)) return ["transaction must be an object"];
  exactKeys(
    value,
    [
      "schema_version",
      "run_id",
      "slug",
      "owner",
      "source",
      "release",
      "evidence",
      "effects",
      "generation",
      "history",
      "created_at",
      "updated_at",
    ],
    "$",
    issues
  );
  if (value.schema_version !== 1) issues.push("schema_version must equal 1");
  for (const field of ["run_id", "slug", "created_at", "updated_at"]) {
    if (!nonEmpty(value[field])) issues.push(`${field} is required`);
  }
  if (!isObject(value.owner) || value.owner.role !== "root") issues.push("owner.role must be root");
  validateSource(value.source, issues);
  validateRelease(value.release, issues);
  if (!isObject(value.evidence)) issues.push("evidence must be an object");
  else {
    exactKeys(value.evidence, [...EVIDENCE_KINDS], "$.evidence", issues);
    for (const kind of EVIDENCE_KINDS) validateEvidence(value.evidence[kind], kind, issues);
  }
  if (!isObject(value.effects)) issues.push("effects must be an object");
  else {
    for (const [name, effect] of Object.entries(value.effects)) {
      if (!EFFECT_DEFINITIONS[name]) issues.push(`unknown effect ${name}`);
      else validateEffect(effect, name, issues);
    }
  }
  if (!Number.isInteger(value.generation) || value.generation < 1) {
    issues.push("generation must be a positive integer");
  }
  if (!Array.isArray(value.history)) issues.push("history must be an array");
  else value.history.forEach((entry, index) => validateHistory(entry, index, issues));
  return issues;
}

function validateHistory(entry, index, issues) {
  if (!isObject(entry)) return issues.push(`history ${index} must be an object`);
  exactKeys(
    entry,
    ["generation", "prepared_commit", "evidence", "effects", "superseded_at", "reason"],
    `$.history[${index}]`,
    issues
  );
  if (entry.generation !== index + 1) issues.push(`history ${index} generation is invalid`);
  if (!SHA.test(entry.prepared_commit || "")) issues.push(`history ${index} commit is invalid`);
  if (!isObject(entry.evidence) || !isObject(entry.effects)) {
    issues.push(`history ${index} evidence/effects are invalid`);
  }
  if (!nonEmpty(entry.superseded_at) || !nonEmpty(entry.reason)) {
    issues.push(`history ${index} transition metadata is required`);
  }
}

function validateSource(source, issues) {
  if (!isObject(source)) return issues.push("source must be an object");
  exactKeys(
    source,
    ["repository", "delivery_remote", "push_url_sha256", "head_branch", "base_branch"],
    "$.source",
    issues
  );
  for (const field of ["repository", "delivery_remote", "head_branch", "base_branch"]) {
    if (!nonEmpty(source[field])) issues.push(`source.${field} is required`);
  }
  if (!SHA256.test(source.push_url_sha256 || "")) issues.push("source push URL hash is invalid");
}

function validateRelease(release, issues) {
  if (!isObject(release)) return issues.push("release must be an object");
  exactKeys(
    release,
    [
      "current_version",
      "next_version",
      "tag",
      "mode",
      "prepared_commit",
      "tag_created",
      "manifests",
      "prepared_at",
    ],
    "$.release",
    issues
  );
  if (!new Set(["versioned", "delivery-only"]).has(release.mode)) {
    issues.push("release mode is invalid");
  } else if (release.mode === "versioned") {
    if (!VERSION.test(release.current_version || "")) issues.push("current version is invalid");
    if (!VERSION.test(release.next_version || "")) issues.push("next version is invalid");
    if (release.tag !== `v${release.next_version}`)
      issues.push("release tag does not match version");
  } else if (
    release.current_version !== null ||
    release.next_version !== null ||
    release.tag !== null
  ) {
    issues.push("delivery-only release cannot declare version or tag");
  }
  if (!SHA.test(release.prepared_commit || "")) issues.push("prepared commit is invalid");
  if (release.tag_created !== false) issues.push("prepared release must not create a tag");
  if (!Array.isArray(release.manifests)) {
    issues.push("release manifests must be an array");
  } else if (release.mode === "versioned" && release.manifests.length === 0) {
    issues.push("versioned release manifests are required");
  } else {
    for (const item of release.manifests) {
      if (!isObject(item) || !nonEmpty(item.path) || !SHA256.test(item.sha256 || "")) {
        issues.push("release manifest binding is invalid");
      }
    }
  }
}

function validateEvidence(evidence, kind, issues) {
  if (evidence === null) return;
  if (!isObject(evidence)) return issues.push(`${kind} evidence must be null or object`);
  exactKeys(evidence, ["commit", "artifact", "sha256", "checked_at"], `$.evidence.${kind}`, issues);
  if (!SHA.test(evidence.commit || "")) issues.push(`${kind} evidence commit is invalid`);
  if (!nonEmpty(evidence.artifact)) issues.push(`${kind} evidence artifact is required`);
  if (!SHA256.test(evidence.sha256 || "")) issues.push(`${kind} evidence hash is invalid`);
  if (!nonEmpty(evidence.checked_at)) issues.push(`${kind} evidence timestamp is required`);
}

function validateEffect(effect, name, issues) {
  if (!isObject(effect)) return issues.push(`${name} effect must be an object`);
  exactKeys(
    effect,
    [
      "name",
      "required_authority",
      "depends_on",
      "target",
      "idempotency_key",
      "status",
      "attempts",
      "verified_receipt",
      "planned_at",
      "updated_at",
    ],
    `$.effects.${name}`,
    issues
  );
  const definition = EFFECT_DEFINITIONS[name];
  if (effect.name !== name) issues.push(`${name} effect name mismatch`);
  if (effect.required_authority !== definition.authority) issues.push(`${name} authority mismatch`);
  if (stableStringify(effect.depends_on) !== stableStringify(definition.dependsOn)) {
    issues.push(`${name} dependency mismatch`);
  }
  if (!isObject(effect.target)) issues.push(`${name} target must be an object`);
  if (!SHA256.test(effect.idempotency_key || "")) issues.push(`${name} idempotency key is invalid`);
  if (!EFFECT_STATUSES.has(effect.status)) issues.push(`${name} effect status is invalid`);
  if (!Array.isArray(effect.attempts)) issues.push(`${name} attempts must be an array`);
  else effect.attempts.forEach((attempt, index) => validateAttempt(attempt, name, index, issues));
  if (effect.status === "verified" && !isObject(effect.verified_receipt)) {
    issues.push(`${name} verified effect requires a receipt`);
  }
  if (effect.status !== "verified" && effect.verified_receipt !== null) {
    issues.push(`${name} non-verified effect cannot retain a verified receipt`);
  }
}

function validateAttempt(attempt, name, index, issues) {
  if (!isObject(attempt)) return issues.push(`${name} attempt ${index} must be an object`);
  exactKeys(
    attempt,
    [
      "number",
      "status",
      "classification",
      "started_at",
      "finished_at",
      "error",
      "receipt",
      "observation",
    ],
    `$.effects.${name}.attempts[${index}]`,
    issues
  );
  if (attempt.number !== index + 1) issues.push(`${name} attempt numbering is invalid`);
  if (!nonEmpty(attempt.status)) issues.push(`${name} attempt status is required`);
  if (!nonEmpty(attempt.started_at)) issues.push(`${name} attempt started_at is required`);
}

function validateEffectTarget(name, target, transaction) {
  if (name === "push") {
    requireTargetMatch(target, "remote", transaction.source.delivery_remote, "delivery remote");
    requireTargetMatch(target, "repository", transaction.source.repository, "repository");
    requireTargetMatch(target, "branch", transaction.source.head_branch, "head branch");
    requireTargetMatch(target, "commit", transaction.release.prepared_commit, "prepared commit");
  }
  if (name === "create-pr") {
    requireTargetMatch(target, "repository", transaction.source.repository, "repository");
    requireTargetMatch(target, "head", transaction.source.head_branch, "head branch");
    requireTargetMatch(target, "base", transaction.source.base_branch, "base branch");
    requireTargetMatch(target, "commit", transaction.release.prepared_commit, "prepared commit");
  }
  if (name === "merge") {
    const prReceipt = transaction.effects["create-pr"]?.verified_receipt?.receipt;
    if (!prReceipt) throw new Error("merge target requires a verified create-pr receipt");
    requireTargetMatch(target, "repository", transaction.source.repository, "repository");
    requireTargetMatch(target, "pr_number", receiptPrNumber(prReceipt), "verified PR number");
    requireTargetMatch(
      target,
      "head_commit",
      transaction.release.prepared_commit,
      "prepared commit"
    );
    requireTargetMatch(target, "base", transaction.source.base_branch, "base branch");
    requireString(target.method, "merge target method");
  }
  if (name === "place-main-tag") {
    if (transaction.release.mode !== "versioned") {
      throw new Error("delivery-only transaction cannot place a release tag");
    }
    if (target.tag !== transaction.release.tag)
      throw new Error("tag target must equal release tag");
    if (!SHA.test(target.merge_sha || "")) throw new Error("tag target requires merge SHA");
    const mergeReceipt = transaction.effects.merge?.verified_receipt?.receipt;
    if (!mergeReceipt || target.merge_sha !== mergeReceipt.merge_sha) {
      throw new Error("tag target must equal the verified merge SHA");
    }
    if (target.remote !== transaction.source.delivery_remote) {
      throw new Error("tag target must use the delivery remote");
    }
    if (target.base !== transaction.source.base_branch) {
      throw new Error("tag target must use the authoritative base branch");
    }
  }
  if (name === "tracker-update") {
    for (const field of ["provider", "issue_id", "terminal_state", "comment_identity"]) {
      requireString(target[field], `tracker target ${field}`);
    }
  }
}

function validateMatchedReceipt(name, target, receipt) {
  if (name === "push") {
    requireReceiptMatch(receipt, "remote_tip", target.commit, "prepared commit");
    return;
  }
  if (name === "create-pr") {
    const number = receiptPrNumber(receipt);
    if (!Number.isInteger(number) || number < 1) {
      throw new Error("create-pr receipt requires a positive PR number");
    }
    requireReceiptMatch(receipt, "state", "OPEN", "OPEN PR state");
    requireReceiptMatch(receipt, "head_oid", target.commit, "prepared commit");
    return;
  }
  if (name === "merge") {
    requireReceiptMatch(receipt, "state", "MERGED", "MERGED PR state");
    requireReceiptMatch(receipt, "head_oid", target.head_commit, "prepared commit");
    requireReceiptMatch(receipt, "pr_number", target.pr_number, "planned PR number");
    if (!SHA.test(receipt.merge_sha || "")) {
      throw new Error("merge receipt requires a valid merge SHA");
    }
    return;
  }
  if (name === "place-main-tag") {
    requireReceiptMatch(receipt, "tag", target.tag, "release tag");
    requireReceiptMatch(receipt, "peeled_sha", target.merge_sha, "verified merge SHA");
    return;
  }
  if (name === "tracker-update") {
    requireReceiptMatch(receipt, "provider", target.provider, "tracker provider");
    requireReceiptMatch(receipt, "issue_id", target.issue_id, "tracker issue");
    requireReceiptMatch(receipt, "state", target.terminal_state, "terminal tracker state");
    requireReceiptMatch(
      receipt,
      "comment_identity",
      target.comment_identity,
      "stable tracker comment"
    );
  }
}

function requireTargetMatch(target, field, expected, label) {
  if (target[field] !== expected) throw new Error(`${field} target must equal ${label}`);
}

function requireReceiptMatch(receipt, field, expected, label) {
  if (receipt[field] !== expected) throw new Error(`${field} receipt must equal ${label}`);
}

function receiptPrNumber(receipt) {
  return receipt.pr_number ?? receipt.number;
}

function emptyAttempt(number, timestamp) {
  return {
    number,
    status: "planned",
    classification: null,
    started_at: timestamp,
    finished_at: null,
    error: null,
    receipt: null,
    observation: null,
  };
}

function effectKey(transaction, effect, target) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      stableStringify({
        run_id: transaction.run_id,
        prepared_commit: transaction.release.prepared_commit,
        effect,
        target,
      })
    )
    .digest("hex")}`;
}

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function effectDefinition(name) {
  const definition = EFFECT_DEFINITIONS[name];
  if (!definition) throw new Error(`unknown release effect: ${name}`);
  return definition;
}

function requirePlannedEffect(transaction, name) {
  effectDefinition(name);
  const effect = transaction.effects[name];
  if (!effect) throw new Error(`effect is not planned: ${name}`);
  return effect;
}

function cloneAndValidate(value) {
  assertValid(value);
  return structuredClone(value);
}

function assertValid(value) {
  const issues = transactionIssues(value);
  if (issues.length > 0) throw new Error(`invalid release transaction: ${issues.join("; ")}`);
}

function exactKeys(value, allowed, label, issues) {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${label}.${key} is not allowed`);
  }
}

function requireObject(value, label) {
  if (!isObject(value)) throw new TypeError(`${label} must be an object`);
}

function requireString(value, label) {
  if (!nonEmpty(value)) throw new TypeError(`${label} must be a non-empty string`);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

module.exports = {
  EFFECT_DEFINITIONS,
  advancePreparedCommit,
  bindReleaseEvidence,
  beginEffect,
  createReleaseTransaction,
  planEffect,
  reconcileEffect,
  releaseReadiness,
  transactionIssues,
};
