#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const os = require("node:os");
const { writeProjectJsonAtomic } = require("./lib/project-atomic-write");
const { hashResult, stableStringify } = require("./lib/workflow-runtime/records");
const { readProjectInput } = require("./lib/safe-project-output");

const SHA = /^[0-9a-f]{40,64}$/i;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const PURPOSES = new Set(["review-bypass", "candidate-hook-bypass", "final-hook-bypass"]);

function authentication(value, key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""));
  if (bytes.length < 32)
    throw new Error("a machine-local attestation key of at least 32 bytes is required");
  const material = { ...value };
  delete material.authentication;
  return `hmac-sha256:${crypto
    .createHmac("sha256", bytes)
    .update(stableStringify(material))
    .digest("hex")}`;
}

function materialBytes(value) {
  const material = { ...value };
  delete material.authentication;
  return Buffer.from(stableStringify(material));
}

function digest(value) {
  return hashResult(value);
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
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
  if (typeof options.signer === "function") value.signer_id = options.signer_id;
  const issues = validateMaterial(value);
  if (issues.length) throw new Error(issues.join("; "));
  const signature =
    typeof options.signer === "function"
      ? `ed25519:${Buffer.from(options.signer(materialBytes(value))).toString("base64")}`
      : authentication(value, options.key);
  return { ...value, authentication: signature };
}

function createCandidateDeliveryAttestation(input, options = {}) {
  if (
    typeof options.signer !== "function" ||
    !Array.isArray(input.commands) ||
    input.commands.length === 0 ||
    !Array.isArray(input.evidence) ||
    input.evidence.length !== 1 ||
    input.evidence[0]?.kind !== "candidate" ||
    !same(input.repository_policy?.permitted_purposes, ["candidate-hook-bypass"])
  )
    throw new Error(
      "candidate attestation requires signed targeted-gate evidence and candidate-only policy"
    );
  return createDeliveryAttestation(input, options);
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

function sha256File(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function verifyProtectedPolicy(value, expected, options) {
  if (!options.publicKey) return "trusted attestation public key is unavailable";
  if (!options.root || !expected.protected_policy_commit)
    return "protected policy authority is unavailable";
  const source = value.repository_policy?.source;
  if (
    !source ||
    source.commit !== expected.protected_policy_commit ||
    source.path !== ".pm/repository-delivery-policy.json" ||
    !DIGEST.test(source.sha256 || "")
  )
    return "protected policy source mismatch";
  const shown = childProcess.spawnSync("git", ["show", `${source.commit}:${source.path}`], {
    cwd: options.root,
    encoding: "utf8",
    shell: false,
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  if (shown.status !== 0 || digestText(shown.stdout) !== source.sha256)
    return "protected policy bytes are unavailable or changed";
  let policy;
  try {
    policy = JSON.parse(shown.stdout);
  } catch {
    return "protected policy is malformed";
  }
  const declared = policy.delivery_bypass?.permitted_purposes;
  if (!Array.isArray(declared) || !expected.purposes.every((purpose) => declared.includes(purpose)))
    return "protected policy does not permit the complete bypass set";
  if (
    policy.delivery_bypass.signer_identity !== value.signer_id ||
    value.signer_id !== publicKeyIdentity(options.publicKey)
  )
    return "protected policy signer identity mismatch";
  return null;
}

function loadProtectedPolicy(root, source) {
  if (
    !source ||
    source.path !== ".pm/repository-delivery-policy.json" ||
    !SHA.test(source.commit || "") ||
    !DIGEST.test(source.sha256 || "")
  )
    throw new Error("authenticated protected-policy source is unavailable");
  const shown = childProcess.spawnSync("git", ["show", `${source.commit}:${source.path}`], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 3000,
    maxBuffer: 1024 * 1024,
  });
  if (shown.status !== 0 || digestText(shown.stdout) !== source.sha256)
    throw new Error("protected-policy commit/path/hash mismatch");
  const parsed = JSON.parse(shown.stdout);
  const declaration = parsed.delivery_bypass;
  if (!declaration || !Array.isArray(declaration.permitted_purposes))
    throw new Error("protected policy has no supported delivery bypass declaration");
  return declaration;
}

function digestText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function publicKeyIdentity(key) {
  const object = key?.type === "public" ? key : crypto.createPublicKey(key);
  return digestText(object.export({ type: "spki", format: "der" }));
}

function verifyDeliveryAttestation(value, expected = {}, options = {}) {
  const issues = validateMaterial(value);
  if (issues.length) return denied(issues[0]);
  if (value.invalidation.findings !== 0 || value.invalidation.mutated_after_review !== false)
    return denied("attestation is invalidated");
  const evidenceIssue = verifyCanonicalEvidence(value, options.root);
  if (evidenceIssue) return denied(evidenceIssue);
  if (Array.isArray(expected.purposes)) {
    const policyIssue = verifyProtectedPolicy(value, expected, options);
    if (policyIssue) return denied(policyIssue);
  }
  if (String(value.authentication || "").startsWith("ed25519:")) {
    if (!options.publicKey) return denied("trusted attestation public key is unavailable");
    if (value.signer_id !== publicKeyIdentity(options.publicKey))
      return denied("attestation signer identity mismatch");
    const signature = Buffer.from(value.authentication.slice("ed25519:".length), "base64");
    if (!crypto.verify(null, materialBytes(value), options.publicKey, signature))
      return denied("attestation signature mismatch");
  } else {
    let signature;
    try {
      signature = authentication(value, options.key);
    } catch (error) {
      return denied(error.message);
    }
    if (!secureEqual(signature, value.authentication))
      return denied("attestation authentication mismatch");
  }
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

function consumePushAuthorization(value, expected = {}, options = {}) {
  if (value.generation !== expected.generation || value.push?.attempt !== expected.push_attempt)
    return denied("release generation or push attempt mismatch");
  const fields = Array.isArray(value.push?.ref_updates)
    ? value.push.ref_updates[0]?.split(" ")
    : [];
  if (fields?.[3] !== expected.old_oid) return denied("live remote old OID mismatch");
  const verdict = verifyPushBypass(value, expected, options);
  if (!verdict.reusable) return verdict;
  if (typeof options.consume !== "function" || options.consume(verdict.authorization_id) !== true)
    return denied("push authorization was already consumed or cannot be consumed atomically");
  return verdict;
}

function deriveBypassPurposes(candidate, requested = {}) {
  const flags = [requested.lefthook, requested.skipReview].filter(Boolean).length;
  if (flags > 1) throw new Error("combined bypass variables are not supported");
  if (flags === 0) return [];
  if (requested.skipReview) {
    if (!["review-converged", "certifying", "merge-ready"].includes(candidate?.state))
      throw new Error("review bypass is unavailable in the current candidate phase");
    return ["review-bypass"];
  }
  if (candidate?.state === "review-candidate") return ["candidate-hook-bypass"];
  if (["certifying", "merge-ready"].includes(candidate?.state)) return ["final-hook-bypass"];
  throw new Error("hook bypass is unavailable in the current candidate phase");
}

function effectiveGateCommit(row) {
  return row?.verified_commit || row?.commit;
}

function verifyCanonicalDeliveryAttestation(context) {
  const { session, transaction, plan, gates } = context;
  const commit = transaction?.release?.prepared_commit;
  if (
    !SHA.test(commit || "") ||
    (session?.run_id !== transaction?.run_id && transaction?.run_id !== undefined)
  )
    throw new Error("canonical session and transaction do not bind one prepared commit");
  if (
    !["review-converged", "certifying", "merge-ready"].includes(session?.candidate?.state) ||
    session.candidate.invalidation
  )
    throw new Error("candidate Review has not converged or was invalidated");
  if (
    plan?.head_commit !== commit ||
    plan?.plan_digest !== session.candidate.gate_plan_identity ||
    plan?.capability_identity !== session.candidate.repository_capability_identity
  )
    throw new Error("canonical repository plan identity mismatch");
  for (const field of ["base_commit", "merge_base_commit", "command_identity"])
    if (!SHA.test(plan?.[field] || "") && !DIGEST.test(plan?.[field] || ""))
      throw new Error(`${field} is missing or invalid`);
  if (!DIGEST.test(plan?.adapter?.manager?.sha256 || ""))
    throw new Error("tool identity is missing");
  if (!plan.environment_identity || typeof plan.environment_identity !== "object")
    throw new Error("preflight identity is missing");
  if (!Array.isArray(plan.complete_commands) || plan.complete_commands.length === 0)
    throw new Error("complete command plan is missing");
  const evidence = [];
  for (const kind of ["review", "qa", "verification"]) {
    const bound = transaction.evidence?.[kind];
    const row = gates?.gates?.find((item) => item.name === kind);
    if (
      !bound ||
      bound.commit !== commit ||
      row?.status !== "passed" ||
      effectiveGateCommit(row) !== commit ||
      row.artifact !== bound.artifact ||
      !DIGEST.test(bound.sha256 || "")
    )
      throw new Error(`canonical ${kind} evidence is missing or stale`);
    evidence.push({ kind, path: bound.artifact, sha256: bound.sha256 });
  }
  return {
    canonical_path: `.pm/dev-sessions/${transaction.slug || "change"}/ship/delivery-attestation.json`,
    run_id: session.run_id,
    commit,
    base: plan.base_commit,
    merge_base: plan.merge_base_commit,
    plan_identity: plan.plan_digest,
    config_identity: plan.capability_identity,
    tool_identity: plan.adapter.manager.sha256,
    preflight_identity: digest(plan.environment_identity),
    command_identity: plan.command_identity,
    commands: [...plan.complete_commands].sort(),
    evidence: evidence.sort((a, b) => a.kind.localeCompare(b.kind)),
    producer: { name: "pm", version: "delivery-attestation-v1" },
    outcome: "passed",
    invalidation: { generation: transaction.generation, findings: 0, mutated_after_review: false },
  };
}

function verifyCanonicalCandidateAttestation(context) {
  const { session, transaction, plan, gates } = context;
  const commit = transaction?.release?.prepared_commit;
  if (session?.candidate?.state !== "review-candidate" || session.candidate.invalidation)
    throw new Error("candidate attestation requires the review-candidate phase");
  if (session.run_id !== transaction?.run_id)
    throw new Error("candidate attestation run does not match the release transaction");
  if (
    plan?.head_commit !== commit ||
    session.candidate.gate_plan_identity !== plan.plan_digest ||
    session.candidate.repository_capability_identity !== plan.capability_identity ||
    plan.candidate_push?.permitted !== true ||
    plan.adapter?.supported !== true ||
    !Array.isArray(plan.targeted_commands) ||
    !plan.targeted_commands.length
  )
    throw new Error("targeted candidate plan is unavailable");
  const targeted = [...new Set(plan.targeted_commands)].sort();
  const executed = [...new Set(plan.candidate_push.executed_commands || [])].sort();
  const skipped = [...new Set(plan.candidate_push.skipped_commands || [])].sort();
  const complete = [...new Set(plan.complete_commands || [])].sort();
  if (
    !same(targeted, executed) ||
    !same([...targeted, ...skipped].sort(), complete) ||
    !same(skipped, [...new Set(plan.candidate_push.declared_skipped_commands || [])].sort())
  )
    throw new Error("candidate adapter coverage is not exact");
  const bound = transaction.evidence?.candidate;
  const row = gates?.gates?.find((item) => item.name === "candidate");
  if (
    !bound ||
    bound.commit !== commit ||
    row?.status !== "passed" ||
    effectiveGateCommit(row) !== commit ||
    row.artifact !== bound.artifact ||
    !DIGEST.test(bound.sha256 || "")
  )
    throw new Error("signed targeted candidate gate evidence is missing or stale");
  return {
    canonical_path: `.pm/dev-sessions/${transaction.slug}/ship/candidate-attestation.json`,
    run_id: session.run_id,
    commit,
    base: plan.base_commit,
    merge_base: plan.merge_base_commit,
    plan_identity: plan.plan_digest,
    config_identity: plan.capability_identity,
    tool_identity: plan.adapter.manager.sha256,
    preflight_identity: digest(plan.environment_identity),
    command_identity: plan.command_identity,
    commands: [...plan.targeted_commands].sort(),
    evidence: [{ kind: "candidate", path: bound.artifact, sha256: bound.sha256 }],
    producer: { name: "pm", version: "delivery-attestation-v1" },
    outcome: "passed",
    invalidation: { generation: transaction.generation, findings: 0, mutated_after_review: false },
  };
}

function attestCanonicalCandidateFiles(input, options = {}) {
  const root = fs.realpathSync(path.resolve(input.root));
  const session = readBoundJson(root, input.session);
  const transaction = readBoundJson(root, input.transaction);
  const plan = readBoundJson(root, input.plan);
  const gates = readBoundJson(root, input.gates);
  const paths = canonicalDeliveryPaths(root, input, session, transaction);
  if (path.resolve(root, input.attestation) !== paths.candidateAttestation)
    throw new Error("candidate attestation must use its canonical session ship path");
  verifyLiveRepository(root, plan, transaction);
  const expected = verifyCanonicalCandidateAttestation({ session, transaction, plan, gates });
  const bound = transaction.evidence.candidate;
  if (sha256File(path.resolve(root, bound.artifact)) !== bound.sha256)
    throw new Error("targeted candidate gate evidence hash mismatch");
  const source = plan.repository_policy?.source;
  const policy = loadProtectedPolicy(root, source);
  if (
    policy.signer_identity !== options.signerId ||
    !policy.permitted_purposes.includes("candidate-hook-bypass")
  )
    throw new Error("protected policy does not grant candidate-only hook bypass");
  const attempt = transaction.effects?.push?.attempts?.at(-1);
  if (transaction.effects?.push?.status !== "attempting" || attempt?.status !== "attempting")
    throw new Error("candidate push requires one active transaction attempt");
  const attestation = createCandidateDeliveryAttestation(
    {
      ...expected,
      generation: transaction.generation,
      repository_policy: {
        source,
        ...policy,
        permitted_purposes: ["candidate-hook-bypass"],
      },
      push: {
        remote: plan.remote.name,
        remote_url: plan.remote.url,
        ref_updates: plan.remote.stdin.trimEnd().split("\n"),
        attempt: attempt.number,
      },
      observed_at: new Date().toISOString(),
    },
    { signer: options.signer, signer_id: options.signerId }
  );
  writePrivateJson(root, paths.candidateAttestation, attestation);
  return attestation;
}

function finalizeDeliveryCandidate(context, options = {}) {
  const expected = verifyCanonicalDeliveryAttestation(context);
  const certificationDigest = digest(expected);
  if (context.existingCertification) {
    const certification = context.existingCertification;
    const signature = String(certification.authentication || "");
    const material = { ...certification };
    delete material.authentication;
    if (
      certification.schema_version !== 1 ||
      certification.generation !== context.transaction.generation ||
      certification.commit !== expected.commit ||
      certification.digest !== certificationDigest ||
      certification.outcome !== "passed" ||
      !same(certification.commands, expected.commands) ||
      !Array.isArray(certification.evidence) ||
      !options.publicKey ||
      !signature.startsWith("ed25519:") ||
      !crypto.verify(
        null,
        materialBytes(material),
        options.publicKey,
        Buffer.from(signature.slice("ed25519:".length), "base64")
      )
    )
      throw new Error("existing certification identity drift requires Review");
    return { decision: "already-certified", certification };
  }
  if (typeof options.runComplete !== "function")
    throw new Error("complete plan executor is unavailable");
  const result = options.runComplete(expected.commands);
  if (result?.outcome !== "passed")
    throw new Error("complete repository plan failed; return to Review");
  const certification = {
    schema_version: 1,
    generation: context.transaction.generation,
    commit: expected.commit,
    digest: certificationDigest,
    outcome: "passed",
    commands: expected.commands,
    evidence: result.evidence || [],
  };
  if (typeof options.signer !== "function")
    throw new Error("trusted certification signer is unavailable");
  certification.authentication = `ed25519:${Buffer.from(
    options.signer(materialBytes(certification))
  ).toString("base64")}`;
  return { decision: "certified", certification, expected };
}

function readBoundJson(root, relative, max = 1024 * 1024) {
  return JSON.parse(readProjectInput(root, relative, max).bytes.toString("utf8"));
}

function canonicalDeliveryPaths(root, input, session, transaction) {
  const slug = transaction?.slug;
  if (
    typeof slug !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(slug) ||
    slug === "." ||
    slug === ".."
  )
    throw new Error("release transaction slug must be one safe path segment");
  if (!session?.run_id || session.run_id !== transaction.run_id)
    throw new Error("canonical session and release transaction identity do not match");
  const sessionRoot = path.join(root, ".pm", "dev-sessions", slug);
  const shipRoot = path.join(sessionRoot, "ship");
  const expectedInputs = {
    session: path.join(sessionRoot, "session.json"),
    transaction: path.join(shipRoot, "release-transaction.json"),
    gates: path.join(sessionRoot, "gates.json"),
    plan: path.join(shipRoot, "repository-delivery-plan.json"),
  };
  for (const [name, expected] of Object.entries(expectedInputs)) {
    if (path.resolve(root, input[name]) !== expected)
      throw new Error(`${name} must use the canonical session path`);
  }
  return {
    ...expectedInputs,
    shipRoot,
    candidateAttestation: path.join(shipRoot, "candidate-attestation.json"),
    certification: path.join(shipRoot, "final-certification.json"),
    attestation: path.join(shipRoot, "delivery-attestation.json"),
  };
}

function writePrivateJson(root, filePath, value) {
  const relative = path.relative(fs.realpathSync(root), filePath);
  writeProjectJsonAtomic(root, relative, value, { directoryMode: 0o700, fileMode: 0o600 });
}

function gitIdentity(root, args) {
  const result = childProcess.spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("live Git identity is unavailable");
  return result.stdout.trim();
}

function verifyLiveRepository(root, plan, transaction) {
  if (
    gitIdentity(root, ["rev-parse", "--verify", "HEAD^{commit}"]) !==
    transaction.release.prepared_commit
  )
    throw new Error("live HEAD no longer matches the prepared release commit");
  if (
    gitIdentity(root, ["merge-base", plan.base_commit, plan.head_commit]) !== plan.merge_base_commit
  )
    throw new Error("live merge-base identity no longer matches the repository plan");
  const prefix = `refs/remotes/${plan.remote?.name}/`;
  if (
    typeof plan.expected_default_ref !== "string" ||
    !plan.expected_default_ref.startsWith(prefix)
  )
    throw new Error("authenticated current default-branch ref is unavailable");
  const remoteRef = `refs/heads/${plan.expected_default_ref.slice(prefix.length)}`;
  const remote = childProcess.spawnSync(
    "git",
    ["ls-remote", "--refs", "--", plan.remote.url, remoteRef],
    {
      cwd: root,
      encoding: "utf8",
      shell: false,
      timeout: 10000,
      maxBuffer: 64 * 1024,
    }
  );
  const fields = remote.stdout.trim().split(/\s+/);
  if (
    remote.status !== 0 ||
    fields.length !== 2 ||
    fields[0] !== plan.base_commit ||
    fields[1] !== remoteRef
  )
    throw new Error("protected policy is not from the current remote default-branch commit");
}

function finalizeCanonicalFiles(input, options = {}) {
  const root = fs.realpathSync(path.resolve(input.root));
  const session = readBoundJson(root, input.session);
  const transaction = readBoundJson(root, input.transaction);
  const gates = readBoundJson(root, input.gates);
  const plan = readBoundJson(root, input.plan);
  const context = { root, session, transaction, gates, plan };
  const paths = canonicalDeliveryPaths(root, input, session, transaction);
  if (
    path.resolve(root, input.certification) !== paths.certification ||
    path.resolve(root, input.attestation) !== paths.attestation
  )
    throw new Error("certification and attestation must use their canonical session ship paths");
  verifyLiveRepository(root, plan, transaction);
  const transitionedSession =
    typeof options.transitionSession === "function" ? options.transitionSession(session) : null;
  for (const bound of Object.values(transaction.evidence || {})) {
    if (!bound || sha256File(path.resolve(root, bound.artifact)) !== bound.sha256)
      throw new Error("canonical evidence hash mismatch");
  }
  const report = readBoundJson(root, transaction.evidence.review.artifact);
  if (report.outcome !== "passed" || (Array.isArray(report.findings) && report.findings.length > 0))
    throw new Error("canonical Review has not converged");
  const certificationPath = paths.certification;
  if (fs.existsSync(certificationPath))
    context.existingCertification = readBoundJson(root, input.certification);
  const result = finalizeDeliveryCandidate(context, {
    signer: options.signer,
    publicKey: options.publicKey,
    runComplete: (commands) => {
      if (typeof options.runComplete === "function") return options.runComplete(commands, plan);
      throw new Error("production complete-plan executor was not provided by release transaction");
    },
  });
  if (result.decision === "certified")
    writePrivateJson(root, certificationPath, result.certification);
  const effect = transaction.effects?.push;
  const attempt = effect?.attempts?.at(-1);
  if (effect?.status !== "attempting" || attempt?.status !== "attempting")
    throw new Error("push bypass requires one active release-transaction attempt");
  const policySource = plan.repository_policy?.source;
  if (!policySource) throw new Error("authenticated protected-policy source is unavailable");
  if (policySource.commit !== plan.base_commit)
    throw new Error("protected policy is not from the planned current default-branch commit");
  const policyDeclaration = loadProtectedPolicy(root, policySource);
  if (policyDeclaration.signer_identity !== options.signerId)
    throw new Error("protected policy does not trust the configured signer identity");
  const expected = result.expected || verifyCanonicalDeliveryAttestation(context);
  const attestationInput = {
    ...expected,
    generation: transaction.generation,
    repository_policy: { source: policySource, ...policyDeclaration },
    push: {
      remote: plan.remote?.name,
      remote_url: plan.remote?.url,
      ref_updates: String(plan.remote?.stdin || "")
        .trimEnd()
        .split("\n"),
      attempt: attempt.number,
    },
    observed_at: new Date().toISOString(),
  };
  const attestation = createDeliveryAttestation(attestationInput, {
    signer: options.signer,
    signer_id: options.signerId,
  });
  writePrivateJson(root, paths.attestation, attestation);
  if (transitionedSession) writePrivateJson(root, paths.session, transitionedSession);
  return { decision: result.decision, certification: result.certification, attestation };
}

function parseArgs(argv) {
  const out = { command: argv[0] };
  for (let i = 1; i < argv.length; i += 2)
    out[argv[i].replace(/^--/, "").replaceAll("-", "_")] = argv[i + 1];
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command !== "verify") throw new Error("delivery-attestation command must be verify");
  const sessionPath = path.resolve(args.session || "");
  const canonicalPath = path.join(path.dirname(sessionPath), "ship", "delivery-attestation.json");
  const value = JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
  const publicKey = crypto.createPublicKey(
    fs.readFileSync(path.join(os.homedir(), ".pm", "delivery-attestation-public.pem"))
  );
  const result = verifyDeliveryAttestation(
    value,
    {
      canonical_path: path.relative(process.cwd(), canonicalPath),
      purpose: args.purpose,
      purposes: [args.purpose],
      commit: args.commit,
      protected_policy_commit: args.protected_policy_commit,
      now: new Date(),
    },
    { publicKey, root: process.cwd() }
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
  createCandidateDeliveryAttestation,
  verifyDeliveryAttestation,
  verifyPushBypass,
  consumePushAuthorization,
  deriveBypassPurposes,
  verifyCanonicalDeliveryAttestation,
  verifyCanonicalCandidateAttestation,
  attestCanonicalCandidateFiles,
  finalizeDeliveryCandidate,
  finalizeCanonicalFiles,
  publicKeyIdentity,
};
