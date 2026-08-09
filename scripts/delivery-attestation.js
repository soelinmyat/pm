#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SHA = /^[0-9a-f]{40,64}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PURPOSES = new Set(["review-bypass", "candidate-hook-bypass", "final-hook-bypass"]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable(value[key])])
  );
}

function authentication(value, key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""));
  if (bytes.length < 32)
    throw new Error("a machine-local attestation key of at least 32 bytes is required");
  const material = { ...value };
  delete material.authentication;
  return `hmac-sha256:${crypto
    .createHmac("sha256", bytes)
    .update(JSON.stringify(stable(material)))
    .digest("hex")}`;
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function secureEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validateMaterial(value) {
  const issues = [];
  if (value?.schema_version !== 1) issues.push("unsupported schema");
  if (value?.kind !== "delivery-attestation-v1") issues.push("unsupported kind");
  for (const field of ["commit", "base", "merge_base"])
    if (!SHA.test(value?.[field] || "")) issues.push(`${field} is invalid`);
  for (const field of [
    "plan_identity",
    "config_identity",
    "tool_identity",
    "preflight_identity",
    "command_identity",
  ])
    if (!DIGEST.test(value?.[field] || "")) issues.push(`${field} is invalid`);
  if (
    !Array.isArray(value?.commands) ||
    value.commands.length === 0 ||
    value.commands.some((x) => typeof x !== "string" || !x)
  )
    issues.push("commands are invalid");
  if (
    !Array.isArray(value?.evidence) ||
    value.evidence.length === 0 ||
    value.evidence.some(
      (row) =>
        !row ||
        typeof row.kind !== "string" ||
        typeof row.path !== "string" ||
        !DIGEST.test(row.sha256 || "")
    )
  )
    issues.push("evidence is invalid");
  if (
    !value?.producer ||
    typeof value.producer.name !== "string" ||
    typeof value.producer.version !== "string"
  )
    issues.push("producer is invalid");
  if (value?.outcome !== "passed") issues.push("outcome is not passed");
  if (
    !value?.invalidation ||
    !Number.isSafeInteger(value.invalidation.generation) ||
    !Number.isSafeInteger(value.invalidation.findings) ||
    value.invalidation.findings < 0 ||
    typeof value.invalidation.mutated_after_review !== "boolean"
  )
    issues.push("invalidation state is invalid");
  if (
    !value?.push ||
    typeof value.push.remote !== "string" ||
    typeof value.push.remote_url !== "string" ||
    !Array.isArray(value.push.ref_updates)
  )
    issues.push("push identity is invalid");
  if (!value?.repository_policy || !Array.isArray(value.repository_policy.permitted_purposes))
    issues.push("repository policy is invalid");
  if (!Number.isFinite(Date.parse(value?.observed_at || "")))
    issues.push("observation time is invalid");
  if (
    typeof value?.canonical_path !== "string" ||
    !value.canonical_path.startsWith(".pm/dev-sessions/") ||
    path.isAbsolute(value.canonical_path) ||
    value.canonical_path.includes("..")
  )
    issues.push("canonical path is invalid");
  return issues;
}

function createDeliveryAttestation(input, options = {}) {
  const value = {
    schema_version: 1,
    kind: "delivery-attestation-v1",
    ...input,
    commands: [...(input.commands || [])].sort(),
    evidence: [...(input.evidence || [])].sort((a, b) =>
      `${a.kind}:${a.path}`.localeCompare(`${b.kind}:${b.path}`)
    ),
  };
  const issues = validateMaterial(value);
  if (issues.length) throw new Error(issues.join("; "));
  return { ...value, authentication: authentication(value, options.key) };
}

function denied(reason) {
  return { reusable: false, reason, environment: {} };
}

function verifyCanonicalEvidence(value, root) {
  if (!root) return null;
  const rootReal = fs.realpathSync(path.resolve(root));
  for (const row of value.evidence) {
    const absolute = path.resolve(rootReal, row.path);
    const relative = path.relative(rootReal, absolute);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      !relative.startsWith(`.pm${path.sep}dev-sessions${path.sep}`)
    )
      return "evidence path is outside the canonical Dev session";
    try {
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
        return "evidence is not a bounded regular file";
      if (fs.realpathSync(absolute) !== absolute) return "evidence path is relocated";
      const actual = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`;
      if (actual !== row.sha256) return "canonical evidence hash mismatch";
    } catch {
      return "canonical evidence is unavailable";
    }
  }
  return null;
}

function verifyDeliveryAttestation(value, expected = {}, options = {}) {
  const issues = validateMaterial(value);
  if (issues.length) return denied(issues[0]);
  if (value.invalidation.findings !== 0 || value.invalidation.mutated_after_review !== false)
    return denied("attestation is invalidated");
  const evidenceIssue = verifyCanonicalEvidence(value, options.root);
  if (evidenceIssue) return denied(evidenceIssue);
  let signature;
  try {
    signature = authentication(value, options.key);
  } catch (error) {
    return denied(error.message);
  }
  if (!secureEqual(signature, value.authentication))
    return denied("attestation authentication mismatch");
  const canonical = path.normalize(expected.expectedCanonicalPath || expected.canonical_path || "");
  if (!canonical || path.normalize(value.canonical_path) !== canonical)
    return denied("attestation is not at its canonical path");
  for (const field of [
    "run_id",
    "commit",
    "base",
    "merge_base",
    "plan_identity",
    "config_identity",
    "tool_identity",
    "preflight_identity",
    "command_identity",
  ])
    if (expected[field] !== undefined && value[field] !== expected[field])
      return denied(`${field} mismatch`);
  for (const field of ["commands", "evidence", "push"])
    if (expected[field] !== undefined && !same(value[field], expected[field]))
      return denied(`${field} mismatch`);
  const purpose = expected.purpose;
  if (!PURPOSES.has(purpose) || !value.repository_policy.permitted_purposes.includes(purpose))
    return denied("repository policy does not permit this bypass purpose");
  const now = expected.now instanceof Date ? expected.now.getTime() : Date.now();
  const observed = Date.parse(value.observed_at);
  const maxAgeMs = Number.isSafeInteger(options.maxAgeMs) ? options.maxAgeMs : 5 * 60 * 1000;
  if (observed > now + 30_000 || now - observed > maxAgeMs) return denied("attestation is stale");
  const environment = {};
  if (
    purpose === "review-bypass" &&
    value.repository_policy.review_bypass === "SKIP_CODEX_REVIEW=1"
  )
    environment.SKIP_CODEX_REVIEW = "1";
  if (
    ["candidate-hook-bypass", "final-hook-bypass"].includes(purpose) &&
    value.repository_policy.hook_bypass === "LEFTHOOK=0"
  )
    environment.LEFTHOOK = "0";
  if (Object.keys(environment).length !== 1)
    return denied("declared bypass semantics are unsupported");
  return {
    reusable: true,
    reason: null,
    purpose,
    environment,
    authorization_id: value.authentication,
  };
}

function verifyPushBypass(value, expected = {}, options = {}) {
  if (
    value?.push?.remote !== expected.remote ||
    value?.push?.remote_url !== expected.remote_url ||
    !Array.isArray(value?.push?.ref_updates) ||
    value.push.ref_updates.length !== 1
  )
    return denied("attestation destination does not match this push");
  const fields = value.push.ref_updates[0].split(" ");
  if (
    fields.length !== 4 ||
    fields.some((field) => !field) ||
    fields[0] !== `refs/heads/${expected.branch}` ||
    fields[1] !== expected.commit ||
    fields[2] !== `refs/heads/${expected.branch}` ||
    !SHA.test(fields[3])
  )
    return denied("attestation ref update does not match this push");
  return verifyDeliveryAttestation(value, expected, options);
}

function certifyFinalCandidate(state, options = {}) {
  if (state.route !== "optimized")
    return { ready: false, next: "comprehensive", reason: "optimized route was not selected" };
  if (
    state.review?.outcome !== "passed" ||
    state.review.findings !== 0 ||
    state.review.commit !== state.head
  )
    return {
      ready: false,
      next: "review",
      reason: "final head is not the converged reviewed head",
    };
  if (
    state.certification &&
    state.certification.head === state.head &&
    state.certification.generation === state.generation &&
    state.certification.outcome === "passed"
  )
    return { ready: true, next: "push", certification: state.certification, reused: true };
  if (
    !Array.isArray(state.complete_commands) ||
    state.complete_commands.length === 0 ||
    typeof options.runComplete !== "function"
  )
    return {
      ready: false,
      next: "comprehensive",
      reason: "complete repository-native plan is unavailable",
    };
  const result = options.runComplete([...state.complete_commands]);
  if (result?.outcome !== "passed")
    return { ready: false, next: "review", reason: "complete final certification failed" };
  return {
    ready: true,
    next: "push",
    reused: false,
    certification: {
      head: state.head,
      generation: state.generation,
      commands: [...state.complete_commands],
      evidence: result.evidence || [],
      outcome: "passed",
    },
  };
}

function selectDeliveryRoute(capabilities = {}) {
  const missing = [];
  if (
    capabilities.candidate_policy?.authenticated !== true ||
    capabilities.candidate_policy?.permitted !== true
  )
    missing.push("authenticated candidate-push policy");
  if (capabilities.adapter?.supported !== true || capabilities.adapter?.exact_coverage !== true)
    missing.push("exact repository adapter coverage");
  if (capabilities.evidence_equivalence !== true) missing.push("evidence equivalence");
  if (
    capabilities.latest_base_capability?.authenticated !== true ||
    capabilities.latest_base_capability?.available !== true
  )
    missing.push("authenticated latest-base capability");
  if (missing.length)
    return {
      route: "comprehensive",
      reason: `Missing ${missing.join(", ")}; using existing comprehensive Ship`,
      publish_draft_before_complete: false,
      complete_certification_limit: 1,
      consumer_writes: [],
    };
  return {
    route: "optimized",
    reason: "repository-declared optimization is fully proven",
    publish_draft_before_complete: true,
    complete_certification_limit: 1,
    consumer_writes: [],
  };
}

function parseArgs(argv) {
  const out = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 2)
    out[argv[i].replace(/^--/, "").replaceAll("-", "_")] = argv[i + 1];
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const key = process.env.PM_DELIVERY_ATTESTATION_KEY;
  if (args.command !== "verify") throw new Error("delivery-attestation command must be verify");
  const sessionPath = path.resolve(args.session || "");
  const canonicalPath = path.join(path.dirname(sessionPath), "ship", "delivery-attestation.json");
  const value = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
  const result = verifyDeliveryAttestation(
    value,
    {
      canonical_path: path.relative(process.cwd(), canonicalPath),
      purpose: args.purpose,
      commit: args.commit,
      now: new Date(),
    },
    { key, root: process.cwd() }
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.reusable) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${String(error.message).slice(0, 1000)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  authentication,
  createDeliveryAttestation,
  verifyDeliveryAttestation,
  verifyPushBypass,
  certifyFinalCandidate,
  selectDeliveryRoute,
};
