#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const childProcess = require("node:child_process");
const os = require("node:os");

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

function materialBytes(value) {
  const material = { ...value };
  delete material.authentication;
  return Buffer.from(JSON.stringify(stable(material)));
}

function digest(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(stable(value)))
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
  if (typeof options.signer === "function") value.signer_id = options.signer_id;
  const issues = validateMaterial(value);
  if (issues.length) throw new Error(issues.join("; "));
  const signature =
    typeof options.signer === "function"
      ? `ed25519:${Buffer.from(options.signer(materialBytes(value))).toString("base64")}`
      : authentication(value, options.key);
  return { ...value, authentication: signature };
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

function finalizeDeliveryCandidate(context, options = {}) {
  const expected = verifyCanonicalDeliveryAttestation(context);
  const certificationDigest = digest(expected);
  if (context.existingCertification) {
    if (context.existingCertification.digest !== certificationDigest)
      throw new Error("existing certification identity drift requires Review");
    return { decision: "already-certified", certification: context.existingCertification };
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
    evidence: result.evidence || [],
  };
  return { decision: "certified", certification, expected };
}

function readBoundJson(root, relative, max = 1024 * 1024) {
  const absolute = path.resolve(root, relative);
  const rootReal = fs.realpathSync(root);
  const rel = path.relative(rootReal, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel))
    throw new Error("canonical input escapes project root");
  const stat = fs.lstatSync(absolute);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > max ||
    fs.realpathSync(absolute) !== absolute
  )
    throw new Error("canonical input is not a bounded regular file");
  return JSON.parse(fs.readFileSync(absolute, "utf8"));
}

function writePrivateJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, filePath);
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
  const certificationPath = path.resolve(root, input.certification);
  if (fs.existsSync(certificationPath))
    context.existingCertification = readBoundJson(root, input.certification);
  const result = finalizeDeliveryCandidate(context, {
    runComplete: (commands) => {
      if (typeof options.runComplete === "function") return options.runComplete(commands, plan);
      throw new Error("production complete-plan executor was not provided by release transaction");
    },
  });
  if (result.decision === "certified") writePrivateJson(certificationPath, result.certification);
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
  writePrivateJson(path.resolve(root, input.attestation), attestation);
  if (transitionedSession) writePrivateJson(path.resolve(root, input.session), transitionedSession);
  return { decision: result.decision, certification: result.certification, attestation };
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
  verifyDeliveryAttestation,
  verifyPushBypass,
  consumePushAuthorization,
  deriveBypassPurposes,
  verifyCanonicalDeliveryAttestation,
  finalizeDeliveryCandidate,
  finalizeCanonicalFiles,
  publicKeyIdentity,
  certifyFinalCandidate,
  selectDeliveryRoute,
};
