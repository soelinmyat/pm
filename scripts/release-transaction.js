#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");
const { isGitObjectId } = require("./lib/git-object-id");
const { beginSegment, finishSegment, recoverInterruptedSegments } = require("./delivery-telemetry");
const {
  verifyDeliveryAttestation,
  finalizeCanonicalFiles,
  attestCanonicalCandidateFiles,
} = require("./delivery-attestation");
const { transitionCandidate, validateSession } = require("./lib/dev-session-schema");
const {
  bindReleaseEvidence,
  beginEffect,
  createReleaseTransaction,
  attestPrBody,
  migrateLegacyPrBody,
  normalizeReleaseTransaction,
  advancePreparedCommit,
  planEffect,
  reconcileEffect,
  releaseReadiness,
  transactionIssues,
} = require("./lib/release-transaction-schema");

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command.startsWith("--"))
    throw new Error("release transaction command is required");
  const values = {};
  const booleans = new Set(["--json"]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    if (booleans.has(flag)) {
      values[flag.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values[flag.slice(2).replaceAll("-", "_")] = value;
  }
  return { command, ...values };
}

function withDeliveryTelemetry(transactionPath, input, operation, telemetry = {}) {
  const ledgerPath = path.join(path.dirname(transactionPath), "delivery-timing.json");
  const recover = telemetry.recoverInterruptedSegments || recoverInterruptedSegments;
  const begin = telemetry.beginSegment || beginSegment;
  const finish = telemetry.finishSegment || finishSegment;
  recover(ledgerPath);
  const handle = begin(ledgerPath, input);
  let result;
  try {
    result = operation();
  } catch (error) {
    try {
      finish(ledgerPath, handle, { outcome: "failed", certification_count: 0 });
    } catch (telemetryError) {
      error.telemetry_error = telemetryError.message;
    }
    throw error;
  }
  try {
    finish(ledgerPath, handle, {
      outcome: "passed",
      certification_count: result?.decision === "certified" ? 1 : 0,
    });
    return result;
  } catch {
    return {
      ...result,
      telemetry_warning:
        "delivery completed; telemetry recording failed; do not retry delivery effect",
    };
  }
}

function runCommand(args, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const transactionPath = resolvePrivateFile(args.transaction, cwd, "transaction");
  if (args.command === "initialize") {
    return initializeDeliveryTransaction(args, cwd, transactionPath);
  }
  if (["validate", "status"].includes(args.command)) {
    const transaction = readCanonicalTransaction(transactionPath);
    if (args.command === "validate") requireNoPendingMigration(transaction);
    return args.command === "validate"
      ? { ok: true, transaction_path: relative(cwd, transactionPath) }
      : statusView(transaction, relative(cwd, transactionPath));
  }
  if (args.command === "verify-attestation") {
    const transaction = readCanonicalTransaction(transactionPath);
    requireNoPendingMigration(transaction);
    const attestationPath = resolvePrivateFile(args.attestation_file, cwd, "attestation file");
    const attestation = readJson(attestationPath, "delivery attestation");
    const protectedPolicyCommit = (
      options.resolveProtectedPolicyCommit || resolveProtectedPolicyCommit
    )(cwd, transaction);
    const verdict = verifyDeliveryAttestation(
      attestation,
      {
        canonical_path: relative(cwd, attestationPath),
        purpose: args.purpose,
        purposes: [args.purpose],
        commit: transaction.release.prepared_commit,
        protected_policy_commit: protectedPolicyCommit,
        now: new Date(),
      },
      {
        publicKey: crypto.createPublicKey(
          fs.readFileSync(path.join(os.homedir(), ".pm", "delivery-attestation-public.pem"))
        ),
        root: cwd,
      }
    );
    if (!verdict.reusable)
      throw new Error(`delivery attestation is not reusable: ${verdict.reason}`);
    return {
      ok: true,
      decision: "attestation-verified",
      generation: transaction.generation,
      prepared_commit: transaction.release.prepared_commit,
      authorization_id: verdict.authorization_id,
    };
  }
  if (args.command === "attest-candidate") {
    return withDeliveryTelemetry(
      transactionPath,
      {
        kind: "active-command",
        route: "optimized",
        delivery_id: validatedTransactionRunId(transactionPath),
      },
      () => {
        const request = {
          schema_version: 1,
          kind: "canonical-candidate-attestation-v1",
          repository_root: cwd,
          session: args.session,
          transaction: args.transaction,
          gates: args.gates,
          plan: args.plan,
          attestation: args.attestation,
        };
        const signer = machineSigner(request);
        const attestation = attestCanonicalCandidateFiles(
          { root: cwd, ...request },
          { signer: signer.sign, signerId: signer.identity }
        );
        return { ok: true, decision: "candidate-attested", attestation };
      }
    );
  }
  if (args.command === "finalize-candidate") {
    return withDeliveryTelemetry(
      transactionPath,
      {
        kind: "final-certification",
        route: "optimized",
        delivery_id: validatedTransactionRunId(transactionPath),
      },
      () => {
        const canonicalInput = {
          session: args.session,
          transaction: args.transaction,
          gates: args.gates,
          plan: args.plan,
          certification: args.certification,
          attestation: args.attestation,
        };
        const canonicalRequest = {
          schema_version: 1,
          kind: "canonical-delivery-finalization-v1",
          repository_root: cwd,
          ...canonicalInput,
        };
        const signer = machineSigner(canonicalRequest);
        const runner = path.join(__dirname, "repository-gate-runner.js");
        const result = finalizeCanonicalFiles(
          {
            root: cwd,
            ...canonicalInput,
          },
          {
            signer: signer.sign,
            signerId: signer.identity,
            publicKey: signer.publicKey,
            transitionSession: (session) => {
              const issues = validateSession(session);
              if (issues.length) throw new Error("canonical Dev session is invalid");
              if (session.candidate.state === "certifying") return session;
              return transitionCandidate(session, {
                state: "certifying",
                reason: "Complete final candidate certification passed",
              });
            },
            runComplete: (_commands, canonicalPlan) => {
              const childEnv = { ...process.env };
              for (const name of Object.keys(childEnv))
                if (/PM_DELIVERY_(?:ATTESTATION|SIGN|PRIVATE)/.test(name)) delete childEnv[name];
              const executed = spawnSync(
                process.execPath,
                [
                  runner,
                  "--plan",
                  path.resolve(cwd, args.plan),
                  "--mode",
                  "complete",
                  "--expected-plan-digest",
                  canonicalPlan.plan_digest,
                  "--expected-capability-identity",
                  canonicalPlan.capability_identity,
                  "--discovery-receipt",
                  path.resolve(cwd, args.discovery_receipt),
                  "--discovery-receipt-sha256",
                  args.discovery_receipt_sha256,
                ],
                {
                  cwd,
                  encoding: "utf8",
                  shell: false,
                  env: childEnv,
                  timeout: 60 * 60 * 1000,
                  maxBuffer: 1024 * 1024,
                }
              );
              if (executed.status !== 0)
                throw new Error(`complete repository plan failed: ${executed.stderr}`);
              const output = JSON.parse(executed.stdout);
              return {
                outcome: output.status === "passed" ? "passed" : "failed",
                evidence: [{ kind: "complete-plan", identity: output.preflight_identity }],
              };
            },
          }
        );
        return { ok: true, ...result };
      }
    );
  }
  return mutateTransaction(transactionPath, (transaction) => {
    if (args.command === "plan") {
      const target = readJson(resolveInputFile(args.target_file, cwd, "target"), "effect target");
      if (["create-pr", "merge"].includes(args.effect)) {
        requireCanonicalPrBodyBinding(transactionPath, target);
      }
      return {
        transaction: planEffect(transaction, { effect: args.effect, target }),
        decision: "planned",
      };
    }
    if (args.command === "migrate-pr-body") {
      const binding = readCanonicalPrBodyBinding(transactionPath);
      return {
        transaction: migrateLegacyPrBody(transaction, { bodySha256: binding.sha256 }),
        decision: "pr-body-migration-bound",
      };
    }
    if (args.command === "attest-pr-body") {
      const binding = readCanonicalPrBodyBinding(transactionPath);
      const createPrTarget = transaction.effects?.["create-pr"]?.target;
      if (createPrTarget?.body_sha256 !== binding.sha256) {
        throw new Error("canonical pr-body.md no longer matches the create-pr target");
      }
      const observation = readJson(
        resolvePrivateFile(args.observation_file, cwd, "PR body observation"),
        "live PR body observation"
      );
      return {
        transaction: attestPrBody(transaction, { observation }),
        decision: "pr-body-attested",
      };
    }
    if (args.command === "begin") {
      const session = readJson(resolvePrivateFile(args.session, cwd, "session"), "Dev session");
      if (session.run_id !== transaction.run_id) {
        throw new Error("Dev session run_id does not match the release transaction");
      }
      return beginEffect(transaction, {
        effect: args.effect,
        authority: session.authority,
        actor: args.actor,
        candidateState: session.candidate?.state,
      });
    }
    if (args.command === "reconcile") {
      const observation = readJson(
        resolveInputFile(args.observation_file, cwd, "observation"),
        "effect observation"
      );
      const receipt = args.receipt_file
        ? readJson(resolveInputFile(args.receipt_file, cwd, "receipt"), "effect receipt")
        : undefined;
      if (
        args.outcome === "matched" &&
        ["create-pr", "merge"].includes(args.effect) &&
        transaction.effects?.[args.effect]?.target?.body_sha256 !== undefined
      ) {
        requireCanonicalPrBodyBinding(transactionPath, transaction.effects[args.effect].target);
      }
      return reconcileEffect(transaction, {
        effect: args.effect,
        outcome: args.outcome,
        observation,
        receipt,
        reason: args.reason,
        classification: args.classification,
      });
    }
    if (args.command === "bind-evidence") {
      return {
        transaction: bindReleaseEvidence(transaction, {
          kind: args.kind,
          commit: args.commit,
          artifact: args.artifact,
          sha256: args.sha256,
        }),
        decision: "evidence-bound",
      };
    }
    if (args.command === "advance") {
      return {
        transaction: advancePreparedCommit(transaction, {
          commit: resolveAdvanceCommit(cwd, args.commit),
          reason: args.reason,
        }),
        decision: "advanced",
      };
    }
    throw new Error(`unknown release transaction command: ${args.command}`);
  });
}

function resolveAdvanceCommit(cwd, requested) {
  const head = git(cwd, ["rev-parse", "HEAD"]);
  if (requested && requested !== head)
    throw new Error("release advancement commit must equal the exact current HEAD");
  return head;
}

function initializeDeliveryTransaction(args, cwd, transactionPath) {
  if (fs.existsSync(transactionPath)) {
    const existing = readCanonicalTransaction(transactionPath);
    return {
      ok: true,
      decision: "already-initialized",
      status: statusView(existing, relative(cwd, transactionPath)),
    };
  }
  const session = readJson(resolvePrivateFile(args.session, cwd, "session"), "Dev session");
  const branch = git(cwd, ["branch", "--show-current"]);
  const commit = git(cwd, ["rev-parse", "HEAD"]);
  if (branch !== session.source?.branch)
    throw new Error("Dev session branch does not match current branch");
  const remote = session.source?.delivery_remote;
  const urls = git(cwd, ["remote", "get-url", "--push", "--all", "--", remote])
    .split(/\r?\n/)
    .filter(Boolean);
  if (urls.length !== 1) throw new Error("delivery remote must have exactly one push URL");
  const transaction = createReleaseTransaction({
    releaseMode: "delivery-only",
    runId: session.run_id,
    slug: session.slug,
    repository: githubRepository(urls[0]),
    deliveryRemote: remote,
    headBranch: branch,
    baseBranch: session.source.default_branch,
    pushUrlSha256: digestText(urls[0]),
    preparedCommit: commit,
    manifestHashes: [],
  });
  writeJsonAtomic(transactionPath, transaction, { directoryMode: 0o700, fileMode: 0o600 });
  return {
    ok: true,
    decision: "initialized",
    status: statusView(transaction, relative(cwd, transactionPath)),
  };
}

function mutateTransaction(transactionPath, mutation) {
  const release = acquireOwnedLock(`${transactionPath}.lock`, {
    attempts: 200,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: `timed out waiting for release transaction lock: ${transactionPath}`,
  });
  try {
    const normalized = normalizeReleaseTransaction(
      readJson(transactionPath, "release transaction")
    );
    if (normalized.migrated) {
      writeJsonAtomic(transactionPath, normalized.transaction, {
        directoryMode: 0o700,
        fileMode: 0o600,
      });
    }
    const result = mutation(normalized.transaction);
    const issues = transactionIssues(result.transaction);
    if (issues.length > 0) throw new Error(`invalid release transaction: ${issues.join("; ")}`);
    writeJsonAtomic(transactionPath, result.transaction, {
      directoryMode: 0o700,
      fileMode: 0o600,
    });
    return {
      ok: true,
      decision: result.decision,
      effect: result.transaction.effects?.[result.effect]?.name || undefined,
      status: statusView(result.transaction, transactionPath),
    };
  } finally {
    release();
  }
}

function readCanonicalTransaction(transactionPath) {
  const release = acquireOwnedLock(`${transactionPath}.lock`, {
    attempts: 200,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: `timed out waiting for release transaction lock: ${transactionPath}`,
  });
  try {
    const normalized = normalizeReleaseTransaction(
      readJson(transactionPath, "release transaction")
    );
    if (normalized.migrated) {
      writeJsonAtomic(transactionPath, normalized.transaction, {
        directoryMode: 0o700,
        fileMode: 0o600,
      });
    }
    return normalized.transaction;
  } finally {
    release();
  }
}

function statusView(transaction, transactionPath) {
  const readiness = releaseReadiness(transaction);
  const migrationIssues = legacyMigrationIssues(transaction);
  const migrationPending = migrationIssues.length > 0;
  return {
    schema_version: 1,
    transaction_path: transactionPath,
    run_id: transaction.run_id,
    generation: transaction.generation,
    release: {
      mode: transaction.release.mode,
      version: transaction.release.next_version,
      tag: transaction.release.tag,
      prepared_commit: transaction.release.prepared_commit,
      tag_created: transaction.release.tag_created,
    },
    ready: readiness.ok && !migrationPending,
    readiness_issues: [...readiness.issues, ...migrationIssues],
    migration_pending: migrationPending,
    pr_body_attestation: transaction.pr_body_attestation
      ? {
          body_sha256: transaction.pr_body_attestation.body_sha256,
          observed_at: transaction.pr_body_attestation.observed_at,
          consumed_by_attempt: transaction.pr_body_attestation.consumed_by_attempt,
        }
      : null,
    effects: Object.fromEntries(
      Object.entries(transaction.effects).map(([name, effect]) => [
        name,
        {
          status: effect.status,
          attempts: effect.attempts.length,
          required_authority: effect.required_authority,
        },
      ])
    ),
  };
}

function validatedTransactionRunId(transactionPath) {
  const transaction = readCanonicalTransaction(transactionPath);
  requireNoPendingMigration(transaction);
  return transaction.run_id;
}

function requireNoPendingMigration(transaction) {
  const issues = legacyMigrationIssues(transaction);
  if (issues.length > 0) {
    throw new Error(issues.join("; "));
  }
}

function legacyMigrationIssues(transaction) {
  const createPr = transaction.effects?.["create-pr"];
  const merge = transaction.effects?.merge;
  const terminalDelivery =
    merge?.status === "verified" &&
    (transaction.release?.mode === "delivery-only" ||
      transaction.effects?.["place-main-tag"]?.status === "verified");
  if (terminalDelivery || createPr === undefined || merge?.status === "verified") return [];
  const issues = [];
  if (!transaction.evidence?.candidate && createPr.target?.draft === undefined) {
    issues.push("legacy create-pr draft migration requires Merge reconciliation");
  }
  if (createPr.target?.body_sha256 === undefined) {
    issues.push(
      merge?.status === "attempting"
        ? "legacy create-pr body migration requires Merge reconciliation first"
        : "legacy create-pr body migration requires migrate-pr-body and fresh PR observation"
    );
  }
  if (
    merge &&
    !new Set(["attempting", "verified"]).has(merge.status) &&
    merge.target?.body_sha256 === undefined
  ) {
    issues.push("legacy Merge plan must be replaced with a body-bound plan");
  }
  return issues;
}

function githubRepository(url) {
  for (const pattern of [
    /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/,
  ]) {
    const match = url.match(pattern);
    if (match) return `${match[1]}/${match[2]}`;
  }
  throw new Error("delivery remote is not a supported GitHub repository URL");
}

function digestText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function readCanonicalPrBodyBinding(transactionPath) {
  const filePath = path.join(path.dirname(transactionPath), "pr-body.md");
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    throw new Error(`canonical pr-body.md is unavailable: ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("canonical pr-body.md must be a regular non-symlink file");
  }
  if (stat.size < 1 || stat.size > 128 * 1024) {
    throw new Error("canonical pr-body.md must contain 1 byte to 128 KiB");
  }
  const bytes = fs.readFileSync(filePath);
  return { filePath, sha256: digestText(bytes) };
}

function requireCanonicalPrBodyBinding(transactionPath, target) {
  const binding = readCanonicalPrBodyBinding(transactionPath);
  if (target?.body_sha256 !== binding.sha256) {
    throw new Error("effect target body_sha256 does not match canonical pr-body.md bytes");
  }
  return binding;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function resolvePrivateFile(value, cwd, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${label} is required`);
  const resolved = path.resolve(cwd, value);
  const privateRoot = path.join(cwd, ".pm");
  if (resolved !== privateRoot && !resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(`${label} must be beneath .pm/`);
  }
  return resolved;
}

function resolveProtectedPolicyCommit(root, transaction, run = spawnSync) {
  const remote = transaction?.source?.delivery_remote;
  const branch = transaction?.source?.base_branch;
  if (typeof remote !== "string" || !remote || typeof branch !== "string" || !branch)
    throw new Error("release transaction protected branch is unavailable");
  const ref = `refs/heads/${branch}`;
  const result = run("git", ["ls-remote", "--refs", "--exit-code", remote, ref], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    timeout: 30_000,
    maxBuffer: 8192,
  });
  const lines = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (result.status !== 0 || lines.length !== 1)
    throw new Error("live protected branch commit is unavailable");
  const fields = lines[0].split("\t");
  if (fields.length !== 2 || !isGitObjectId(fields[0]) || fields[1] !== ref)
    throw new Error("live protected branch commit is malformed");
  return fields[0];
}

function resolveInputFile(value, cwd, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${label.replaceAll(" ", "-")}-file is required`);
  }
  const resolved = path.resolve(cwd, value);
  const relativePath = path.relative(cwd, resolved);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} file must stay inside the project root`);
  }
  return resolved;
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
  return value;
}

function machineSigner(canonicalRequest) {
  const directory = path.join(os.homedir(), ".pm");
  const helper = path.join(directory, "delivery-attestation-signer");
  const publicKeyPath = path.join(directory, "delivery-attestation-public.pem");
  for (const filePath of [helper, publicKeyPath]) {
    const stat = fs.lstatSync(filePath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 64 * 1024 ||
      (stat.mode & 0o022) !== 0
    )
      throw new Error("trusted external delivery signer is unavailable");
  }
  const publicKey = crypto.createPublicKey(fs.readFileSync(publicKeyPath));
  return {
    identity: digestText(publicKey.export({ type: "spki", format: "der" })),
    publicKey,
    sign(bytes) {
      const request = {
        ...canonicalRequest,
        requested_material_sha256: digestText(bytes),
      };
      const action =
        canonicalRequest.kind === "canonical-candidate-attestation-v1"
          ? "sign-canonical-candidate"
          : "sign-canonical-finalization";
      const result = spawnSync(helper, [action], {
        input: `${JSON.stringify(request)}\n`,
        encoding: "utf8",
        shell: false,
        env: { PATH: "/usr/bin:/bin" },
        timeout: 5000,
        maxBuffer: 8192,
      });
      if (result.status !== 0 || !result.stdout?.length)
        throw new Error("trusted external delivery signer failed");
      const signature = Buffer.from(result.stdout.trim(), "base64");
      if (!crypto.verify(null, bytes, publicKey, signature))
        throw new Error("trusted external delivery signer returned an invalid signature");
      return signature;
    },
  };
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const result = runCommand(args);
    process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`release-transaction: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  legacyMigrationIssues,
  main,
  parseArgs,
  readCanonicalPrBodyBinding,
  resolveAdvanceCommit,
  resolveProtectedPolicyCommit,
  runCommand,
  statusView,
  withDeliveryTelemetry,
};
