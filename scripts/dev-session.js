#!/usr/bin/env node
"use strict";

const os = require("node:os");
const { cleanGeneratedSessionData, inspectSessionStorage } = require("./lib/dev-session-storage");
const resources = require("./lib/dev-session-resources");
const followUpLedger = require("./lib/design-director-follow-ups");
const mergeAuthorization = require("./lib/merge-authorization");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  writeJsonAtomic: writeJsonFileAtomic,
  writeTextAtomic: writeAtomicText,
} = require("./lib/atomic-file");
const { readBoundedJsonFile } = require("./lib/safe-json-file");
const { parseCliArgs } = require("./loop-args");
const { recordSessionTelemetry } = require("./lib/telemetry");
const { validateRfcSidecar } = require("./rfc-sidecar-check");
const { rfcIssuesToDevWorkUnits } = require("./lib/rfc-work-units");
const { verifyRfcApproval } = require("./lib/rfc-approval-audit");
const { findGitRoot } = require("./loop-git");
const { resolveProfile } = require("./dev-runtime");

const {
  RUNNER_VERSION,
  advanceDecisionVersion,
  anchorQaHistory,
  applyRouting,
  createSession,
  grantAuthority,
  hashResult,
  markCandidateExternalEffectStarted,
  migrateLegacyMarkdown,
  nextDecision,
  projectMarkdown,
  promptMetadata,
  refreshCandidateIdentities,
  readSession,
  rebindRfcContract,
  recertifyEvidence,
  recordNonPassingQaCandidate,
  recordResult,
  resumeBlocked,
  transitionWorkUnit,
  transitionCandidate,
  validateResultEnvelope,
  validateSession,
  verifyRfcSidecarIdentity,
  updateWorkspace,
  writeJsonAtomic,
  writeSession,
} = require("./lib/dev-session-schema");

const EXIT = Object.freeze({
  OK: 0,
  INVALID: 2,
  PRECONDITION: 3,
  RESULT_INVALID: 4,
  BLOCKED: 5,
  RETRY_EXHAUSTED: 6,
  RESOURCES_REMAIN: 7,
  RECORD_FAILED: 8,
});
const MAX_EVIDENCE_INPUT_BYTES = 4 * 1024 * 1024;

function main(argv) {
  const { command, options } = parseArguments(argv);
  switch (command) {
    case "init":
      return initCommand(options);
    case "storage": {
      const { sessionPath } = loadRequiredSession(options);
      const report = inspectSessionStorage(path.dirname(sessionPath));
      emit(options, report, JSON.stringify(report, null, 2) + "\n");
      return EXIT.OK;
    }
    case "scratch": {
      const { session, sessionPath } = loadRequiredSession(options);
      if (session.status !== "active")
        throw cliError("scratch requires an active session", EXIT.PRECONDITION);
      const tempRoot = fs.realpathSync(os.tmpdir());
      const stateRoot = fs.realpathSync(path.dirname(path.dirname(path.dirname(sessionPath))));
      if (tempRoot === stateRoot || tempRoot.startsWith(stateRoot + path.sep)) {
        throw cliError("choose a TMPDIR outside the PM state directory", EXIT.PRECONDITION);
      }
      const { directory, ...registration } = allocateScratch(sessionPath, tempRoot);
      if (registration.refused) {
        process.stderr.write(
          `dev-session: scratch directory is not in the resource ledger: ${registration.refused}\n`
        );
      }
      emit(
        options,
        {
          directory,
          resource: registration.resource || null,
          ...(registration.refused ? { registration_refused: registration.refused } : {}),
        },
        directory + "\n"
      );
      return EXIT.OK;
    }
    case "resource-add":
      return resourceAddCommand(options);
    case "resources":
      return resourcesCommand(options);
    case "close":
      return closeCommand(options);
    case "follow-ups":
      return followUpsCommand(options);
    case "follow-up-record":
      return followUpRecordCommand(options);
    case "merge-authorization":
      return mergeAuthorizationCommand(options);
    case "merge-authorization-revoke":
      return mergeAuthorizationRevokeCommand(options);
    case "merge-check":
      return mergeCheckCommand(options);
    case "sweep":
      return sweepCommand(options);
    case "status":
      return statusCommand(options);
    case "next":
      return nextCommand(options);
    case "prompt":
      return promptCommand(options);
    case "route":
      return routeCommand(options);
    case "record":
      return recordCommand(options);
    case "rebind-rfc":
      return rebindRfcCommand(options);
    case "recertify":
      return recertifyCommand(options);
    case "gate":
      return gateCommand(options);
    case "anchor-qa-history":
      return anchorQaHistoryCommand(options);
    case "record-qa-nonpassing":
      return recordQaNonPassingCommand(options);
    case "require-qa":
      return requireQaCommand(options);
    case "unblock":
      return unblockCommand(options);
    case "authorize":
      return authorizeCommand(options);
    case "advance-decision":
      return advanceDecisionCommand(options);
    case "workspace":
      return workspaceCommand(options);
    case "work-unit":
      return workUnitCommand(options);
    case "candidate":
      return candidateCommand(options);
    case "candidate-refresh":
      return candidateRefreshCommand(options);
    case "candidate-effect":
      return candidateEffectCommand(options);
    case "validate":
      return validateCommand(options);
    case "migrate":
      return migrateCommand(options);
    case "project":
      return projectCommand(options);
    case "help":
      process.stdout.write(helpText());
      return EXIT.OK;
    default:
      throw cliError(`unknown command: ${command || "(missing)"}`, EXIT.INVALID);
  }
}

function parseArguments(argv) {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    return { command: "help", options: {} };
  }
  const command = argv[0];
  const valueFlags = [
    "slug",
    "source-dir",
    "task",
    "kind",
    "size",
    "profile",
    "runtime",
    "model",
    "reasoning",
    "mode",
    "session",
    "output",
    "facts",
    "rfc-sidecar",
    "expected-sidecar-sha256",
    "expected-session-sha256",
    "result",
    "phases",
    "commit",
    "evidence",
    "reason",
    "grant",
    "worktree",
    "id",
    "status",
    "legacy",
    "base-commit",
    "expected-version",
    "retain-large-evidence",
    "state",
    "external-effect-started-at",
    "affected-identity",
    "repository-capability-identity",
    "gate-plan-identity",
    "at",
    "name",
    "artifact",
    "path",
    "pid",
    "identifier",
    "teardown",
    "created-by",
    "label",
    "key",
    "tracker",
    "ref",
    "action",
    "into",
    "scope",
    "observation",
    "gates",
    "root",
  ];
  const spec = Object.fromEntries(valueFlags.map((name) => [`--${name}`, { type: "string" }]));
  spec["--json"] = { key: "json", type: "boolean" };
  spec["--dry-run"] = { key: "dryRun", type: "boolean" };
  spec["--remove"] = { key: "remove", type: "boolean" };
  spec["--apply"] = { key: "apply", type: "boolean" };
  spec["--record"] = { key: "record", type: "boolean" };
  try {
    const parsed = parseCliArgs(argv.slice(1), spec);
    if (parsed.positionals.length > 0) {
      throw new Error(`unexpected argument: ${parsed.positionals[0]}`);
    }
    return { command, options: parsed.args };
  } catch (error) {
    const message = error.message
      .replace(/^Unknown option:/, "unknown option:")
      .replace(/^Missing value for (.+)$/, "$1 requires a value");
    throw cliError(message, EXIT.INVALID);
  }
}

function initCommand(options) {
  requireOptions(options, ["slug", "sourceDir"]);
  const sourceDir = path.resolve(options.sourceDir);
  if (!fs.existsSync(sourceDir) || !fs.statSync(sourceDir).isDirectory()) {
    throw cliError(`source directory does not exist: ${sourceDir}`, EXIT.PRECONDITION);
  }
  let session;
  try {
    const runtime = options.runtime || "inline";
    const profile = resolveProfile({
      provider: runtime,
      sourceDir,
      profileName: options.profile,
      overrides: {
        ...(options.model ? { model: options.model } : {}),
        ...(options.reasoning ? { effort: options.reasoning } : {}),
      },
    });
    session = createSession({
      slug: options.slug,
      sourceDir,
      task: options.task,
      kind: options.kind,
      size: options.size,
      profile: profile.name,
      runtime,
      model: profile.model,
      reasoning: profile.effort,
      mode: options.mode,
    });
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const sessionPath = path.join(
    session.source.repo_root,
    ".pm",
    "dev-sessions",
    session.slug,
    "session.json"
  );
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    if (fs.existsSync(sessionPath)) {
      throw cliError(`session already exists: ${sessionPath}`, EXIT.PRECONDITION);
    }
    clearActiveRunDirectory(sessionPath);
    writeSession(sessionPath, session);
  } finally {
    releaseLock();
  }
  recordSessionTelemetry({
    workflow: "dev",
    sessionPath,
    prevSession: null,
    session,
    result: null,
  });
  emit(
    options,
    { session_path: sessionPath, session, next: nextDecision(session, sessionPath) },
    `Initialized ${session.run_id} at ${sessionPath}\n`
  );
  return EXIT.OK;
}

function statusCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  const payload = {
    schema_version: session.schema_version,
    run_id: session.run_id,
    slug: session.slug,
    status: session.status,
    phase: session.phase,
    phase_attempt: session.phase_attempt,
    updated_at: session.updated_at,
    session_path: sessionPath,
  };
  emit(
    options,
    payload,
    `${session.run_id}: ${session.status}, ${session.phase} attempt ${session.phase_attempt}\n`
  );
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function nextCommand(options) {
  const { session, sessionPath } = loadRequiredSession(options);
  const decision = nextDecision(session, sessionPath);
  emit(options, decision, `${decision.phase} attempt ${decision.attempt}\n`);
  return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
}

function promptCommand(options) {
  requireOptions(options, ["session", "output"]);
  const sessionPath = path.resolve(options.session);
  const session = readSession(sessionPath);
  const outputPath = path.resolve(options.output);
  writeJsonAtomic(outputPath, promptMetadata(session, sessionPath));
  emit(options, { output_path: outputPath }, `${outputPath}\n`);
  return EXIT.OK;
}

function routeCommand(options) {
  requireOptions(options, ["session", "facts"]);
  const sessionPath = path.resolve(options.session);
  const factsPath = path.resolve(options.facts);
  let facts;
  let rfcSidecar = null;
  let rfcSidecarPath = null;
  let rfcSidecarIdentity = null;
  let rfcRepoRoot = null;
  try {
    facts = JSON.parse(fs.readFileSync(factsPath, "utf8"));
  } catch (error) {
    throw cliError(`cannot read routing facts ${factsPath}: ${error.message}`, EXIT.INVALID);
  }
  if (options.rfcSidecar) {
    if (facts.work_units !== undefined) {
      throw cliError("routing facts and --rfc-sidecar cannot both define work_units", EXIT.INVALID);
    }
    rfcSidecarPath = path.resolve(options.rfcSidecar);
    try {
      const bytes = fs.readFileSync(rfcSidecarPath);
      rfcSidecar = JSON.parse(bytes.toString("utf8"));
      rfcSidecarIdentity = {
        path: rfcSidecarPath,
        sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
        schema_version: rfcSidecar.schema_version,
        slug: rfcSidecar.slug,
      };
    } catch (error) {
      throw cliError(`cannot read RFC sidecar ${rfcSidecarPath}: ${error.message}`, EXIT.INVALID);
    }
    rfcRepoRoot = findGitRoot(path.dirname(rfcSidecarPath));
    const validation = validateRfcSidecar(rfcSidecar, rfcSidecarPath, {
      repoRoot: rfcRepoRoot,
      previewSourceRoot: facts.preview_source_root,
      requireCurrentDesignContext: true,
    });
    if (!validation.ok) {
      throw cliError(
        `invalid RFC sidecar: ${validation.issues.map((entry) => entry.message).join("; ")}`,
        EXIT.PRECONDITION
      );
    }
    try {
      facts = {
        ...facts,
        reference: facts.reference ?? rfcSidecarPath,
        design_context: structuredClone(rfcSidecar.design_context),
        work_units: rfcIssuesToDevWorkUnits(rfcSidecar, {
          repoRoot: rfcRepoRoot,
          previewSourceRoot: facts.preview_source_root,
        }),
      };
    } catch (error) {
      throw cliError(error.message, EXIT.PRECONDITION);
    }
  }
  let updated;
  try {
    updated = mutateSession(
      sessionPath,
      (session) => {
        if (rfcSidecar) {
          const binding = validateRfcSidecar(rfcSidecar, rfcSidecarPath, {
            expectedSlug: session.slug,
            repoRoot: rfcRepoRoot,
            previewSourceRoot: facts.preview_source_root,
            requireCurrentDesignContext: true,
          });
          if (!binding.ok) {
            throw new Error(
              `RFC sidecar does not match Dev session: ${binding.issues
                .map((entry) => entry.message)
                .join("; ")}`
            );
          }
        }
        return applyRouting(session, facts, { rfcSidecar: rfcSidecarIdentity });
      },
      { allowSidecarRebind: Boolean(rfcSidecarIdentity) }
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, routing: updated.routing, task: updated.task },
    `${updated.task.risk_tier}: ${updated.routing.review_mode}\n`
  );
  return EXIT.OK;
}

function recordCommand(options) {
  requireOptions(options, ["session", "result"]);
  const sessionPath = path.resolve(options.session);
  const resultPath = path.resolve(options.result);
  let result;
  try {
    result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  } catch (error) {
    throw cliError(`cannot read result ${resultPath}: ${error.message}`, EXIT.RESULT_INVALID);
  }
  const envelopeErrors = validateResultEnvelope(result);
  if (envelopeErrors.length > 0) {
    throw cliError(formatValidation("result is invalid", envelopeErrors), EXIT.RESULT_INVALID);
  }
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    if (!fs.existsSync(sessionPath)) {
      try {
        const recovered = recoverTerminalRetry(sessionPath, result);
        const session = readSession(recovered.session_path);
        emit(
          options,
          {
            session_path: recovered.session_path,
            session,
            next: nextDecision(session, recovered.session_path),
            idempotent: true,
          },
          `${session.phase}\n`
        );
        return EXIT.OK;
      } catch (error) {
        throw cliError(`cannot resolve completed session retry: ${error.message}`, EXIT.INVALID);
      }
    }
    const session = readSession(sessionPath);
    verifyRfcSidecarIdentity(
      session.task.rfc_sidecar,
      session.task.design_context,
      session.task.work_units,
      { previewSourceRoot: session.task.preview_source_root }
    );
    const resultHash = hashResult(result);
    if (session.history.at(-1)?.result_hash === resultHash) {
      let idempotentSession = session;
      let idempotentPath = sessionPath;
      let cleaned = [];
      if (["complete", "handoff"].includes(session.status)) {
        ({ persistedPath: idempotentPath, cleaned } = archiveTerminalRun(
          sessionPath,
          session,
          result,
          resultPath,
          options.retainLargeEvidence
        ));
        idempotentSession = readSession(idempotentPath);
      }
      const decision = nextDecision(idempotentSession, idempotentPath);
      emit(
        options,
        {
          session_path: idempotentPath,
          session: idempotentSession,
          next: decision,
          idempotent: true,
          ...(cleaned.length ? { storage_cleanup: cleaned } : {}),
        },
        `${decision.phase}\n`
      );
      return session.status === "blocked" ? EXIT.BLOCKED : EXIT.OK;
    }
    let updated;
    try {
      updated = recordResult(session, result);
    } catch (error) {
      throw cliError(error.message, EXIT.RESULT_INVALID);
    }
    if (result.phase === "design-critique" && result.status === "passed") {
      try {
        const plan = require("./lib/dev-gate-writer").planGateWrite({
          sessionPath,
          session: updated,
          name: "design-critique",
        });
        // Persist the gate first under the session lock. Until the state
        // write, delivery still requires current passing session evidence.
        // A crash here can safely revalidate and replay the same result.
        writeJsonAtomic(plan.manifestPath, plan.manifest);
      } catch (error) {
        throw cliError(`Design Critique was not recorded: ${error.message}`, EXIT.PRECONDITION);
      }
    }
    let persistedPath = sessionPath;
    let cleaned = [];
    if (["complete", "handoff"].includes(updated.status)) {
      ({ persistedPath, cleaned } = archiveTerminalRun(
        sessionPath,
        updated,
        result,
        resultPath,
        options.retainLargeEvidence
      ));
      updated = readSession(persistedPath);
    } else {
      writeSession(sessionPath, updated);
    }
    recordSessionTelemetry({
      workflow: "dev",
      sessionPath: persistedPath,
      prevSession: session,
      session: updated,
      result,
    });
    const decision = nextDecision(updated, persistedPath);
    emit(
      options,
      {
        session_path: persistedPath,
        session: updated,
        next: decision,
        idempotent: false,
        ...(cleaned.length ? { storage_cleanup: cleaned } : {}),
      },
      `${decision.phase}\n`
    );
    if (updated.status === "blocked") {
      return updated.blockers.at(-1)?.code === "retry-exhausted"
        ? EXIT.RETRY_EXHAUSTED
        : EXIT.BLOCKED;
    }
    return EXIT.OK;
  } finally {
    releaseLock();
  }
}

function clearActiveRunDirectory(sessionPath) {
  const activeDir = path.dirname(sessionPath);
  const lockName = path.basename(`${sessionPath}.lock`);
  for (const entry of fs.readdirSync(activeDir)) {
    if (entry === lockName) continue;
    fs.rmSync(path.join(activeDir, entry), { recursive: true, force: true });
  }
}

function archiveTerminalRun(sessionPath, session, result, resultPath, retentionReason) {
  const activeDir = path.dirname(sessionPath);
  const sessionsDir = path.dirname(activeDir);
  const archiveDir = path.join(sessionsDir, "completed", session.slug, session.run_id);
  const persistedPath = path.join(archiveDir, "session.json");
  if (fs.existsSync(archiveDir)) throw new Error(`terminal archive already exists: ${archiveDir}`);
  const cleanup = cleanGeneratedSessionData(activeDir, {
    referenced: referencedRunPaths(activeDir, session, result, resultPath),
  });
  const storage = inspectSessionStorage(activeDir);
  if (storage.generated.length) {
    const reasons = new Map(cleanup.kept.map((item) => [item.path, item.reason]));
    throw cliError(
      "Move generated runtime data outside the session before retrying: " +
        storage.generated
          .map((item) => (reasons.has(item) ? `${item} (${reasons.get(item)})` : item))
          .join(", "),
      EXIT.PRECONDITION
    );
  }
  if (storage.oversized && !retentionReason?.trim()) {
    throw cliError(
      "Review the session with dev-session storage. Move disposable data outside the session or retry with --retain-large-evidence <reason> for required artifacts. Largest files: " +
        storage.largest.map((file) => file.path).join(", "),
      EXIT.PRECONDITION
    );
  }
  const archivedSession = rebaseContractPaths(
    session,
    activeDir,
    archiveDir,
    session.source.repo_root
  );
  require("./lib/dev-qa-recovery").relocateQaRecovery(archivedSession, activeDir, archiveDir);
  writeSession(sessionPath, archivedSession);
  rebaseKnownRunJsonArtifacts(
    activeDir,
    archiveDir,
    session.source.repo_root,
    sessionPath,
    session,
    resultPath
  );
  fs.mkdirSync(path.dirname(archiveDir), { recursive: true, mode: 0o700 });
  fs.renameSync(activeDir, archiveDir);
  fs.rmSync(path.join(archiveDir, path.basename(`${sessionPath}.lock`)), {
    recursive: true,
    force: true,
  });
  writeJsonAtomic(path.join(activeDir, "completion.json"), {
    schema_version: 1,
    run_id: session.run_id,
    result_hash: hashResult(result),
    session_path: persistedPath,
    ...(storage.oversized
      ? { retained_bytes: storage.bytes, retention_reason: retentionReason.trim() }
      : {}),
    ...(cleanup.removed.length ? { cleaned_generated: cleanup.removed } : {}),
  });
  return { persistedPath, cleaned: cleanup.removed };
}

// Paths the run's records point at. Completion never removes a generated
// folder that holds one of them.
function referencedRunPaths(activeDir, session, result, resultPath) {
  const repoRoot = session.source.repo_root;
  const found = new Set();
  collectContractArtifactPaths(session, activeDir, repoRoot, found);
  collectContractArtifactPaths(result, activeDir, repoRoot, found);
  if (resultPath) found.add(path.resolve(resultPath));
  for (const name of ["gates.json", "runtime.json"]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(activeDir, name), "utf8"));
      collectContractArtifactPaths(parsed, activeDir, repoRoot, found);
    } catch {
      // Absent or unreadable records reference nothing.
    }
  }
  return [...found];
}

function recoverTerminalRetry(sessionPath, result) {
  const resultHash = hashResult(result);
  const activeDir = path.dirname(sessionPath);
  const completionPath = path.join(activeDir, "completion.json");
  try {
    const completion = JSON.parse(fs.readFileSync(completionPath, "utf8"));
    if (completion.run_id === result.run_id && completion.result_hash === resultHash) {
      return completion;
    }
  } catch {
    // Fall through to immutable archive discovery.
  }
  const sessionsDir = path.dirname(activeDir);
  const archivePath = path.join(
    sessionsDir,
    "completed",
    path.basename(activeDir),
    result.run_id,
    "session.json"
  );
  const archived = readSession(archivePath);
  if (archived.history.at(-1)?.result_hash !== resultHash) {
    throw new Error("completion result hash does not match this retry");
  }
  fs.rmSync(path.join(path.dirname(archivePath), "session.json.lock"), {
    recursive: true,
    force: true,
  });
  return { session_path: archivePath, run_id: result.run_id, result_hash: resultHash };
}

const RUN_PATH_FIELDS = new Set([
  "artifact",
  "events_file",
  "log_file",
  "output_path",
  "result_file",
  "session_path",
  "stderr_file",
]);

function rebaseKnownRunJsonArtifacts(
  activeDir,
  archiveDir,
  repoRoot,
  sessionPath,
  session,
  resultPath
) {
  const candidates = new Set([
    path.join(activeDir, "gates.json"),
    path.join(activeDir, "runtime.json"),
  ]);
  collectContractArtifactPaths(session, activeDir, repoRoot, candidates);
  if (resultPath && isWithin(activeDir, resultPath)) candidates.add(path.resolve(resultPath));

  for (const artifactPath of candidates) {
    if (artifactPath === sessionPath || path.extname(artifactPath) !== ".json") continue;
    let source;
    let parsed;
    try {
      source = fs.readFileSync(artifactPath, "utf8");
      parsed = JSON.parse(source);
    } catch {
      continue;
    }
    const rebased = rebaseContractPaths(parsed, activeDir, archiveDir, repoRoot);
    if (JSON.stringify(rebased) !== JSON.stringify(parsed)) writeJsonAtomic(artifactPath, rebased);
  }
}

function collectContractArtifactPaths(value, activeDir, repoRoot, candidates, key = null) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectContractArtifactPaths(item, activeDir, repoRoot, candidates, key);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, item] of Object.entries(value)) {
      collectContractArtifactPaths(item, activeDir, repoRoot, candidates, childKey);
    }
    return;
  }
  if (RUN_PATH_FIELDS.has(key) && typeof value === "string") {
    const absolute = path.isAbsolute(value) ? value : path.resolve(repoRoot || activeDir, value);
    if (isWithin(activeDir, absolute)) candidates.add(absolute);
  }
}

function rebaseContractPaths(value, fromDir, toDir, repoRoot, key = null) {
  if (Array.isArray(value)) {
    return value.map((item) => rebaseContractPaths(item, fromDir, toDir, repoRoot, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        rebaseContractPaths(item, fromDir, toDir, repoRoot, key),
      ])
    );
  }
  if (
    RUN_PATH_FIELDS.has(key) &&
    typeof value === "string" &&
    (value === fromDir || value.startsWith(`${fromDir}${path.sep}`))
  ) {
    return path.join(toDir, path.relative(fromDir, value));
  }
  if (RUN_PATH_FIELDS.has(key) && typeof value === "string" && repoRoot) {
    const normalized = value.replace(/\\/g, "/");
    const fromRelative = path.relative(repoRoot, fromDir).replace(/\\/g, "/");
    const toRelative = path.relative(repoRoot, toDir).replace(/\\/g, "/");
    if (normalized === fromRelative || normalized.startsWith(`${fromRelative}/`)) {
      return `${toRelative}${normalized.slice(fromRelative.length)}`;
    }
  }
  return value;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function acquireSessionLock(sessionPath) {
  const lockPath = `${sessionPath}.lock`;
  const ownerPath = path.join(lockPath, "owner.json");
  function attempt() {
    try {
      fs.mkdirSync(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
      fs.mkdirSync(lockPath, { mode: 0o700 });
      fs.writeFileSync(
        ownerPath,
        `${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`,
        { mode: 0o600, flag: "wx" }
      );
    } catch (error) {
      if (error.code !== "EEXIST") {
        fs.rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      let owner;
      try {
        owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      } catch {
        throw cliError("session is locked by an initializing process", EXIT.PRECONDITION);
      }
      if (!Number.isInteger(owner.pid) || owner.pid < 1) {
        throw cliError("session lock has invalid owner metadata", EXIT.PRECONDITION);
      }
      try {
        process.kill(owner.pid, 0);
      } catch (probeError) {
        if (probeError.code === "ESRCH") {
          fs.rmSync(lockPath, { recursive: true, force: true });
          return attempt();
        }
        throw probeError;
      }
      throw cliError(`session is locked by process ${owner.pid}`, EXIT.PRECONDITION);
    }
    return () => fs.rmSync(lockPath, { recursive: true, force: true });
  }
  return attempt();
}

function rebindRfcCommand(options) {
  requireOptions(options, ["session", "rfcSidecar", "expectedSidecarSha256", "reason"]);
  const sessionPath = path.resolve(options.session);
  let outcome;
  try {
    mutateSession(
      sessionPath,
      (session) => {
        outcome = rebindRfcContract(session, {
          sidecarPath: path.resolve(options.rfcSidecar),
          expectedSha256: options.expectedSidecarSha256,
          reason: options.reason,
        });
        return outcome.session;
      },
      { allowSidecarRebind: true }
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    {
      session_path: sessionPath,
      task: outcome.session.task,
      idempotent: outcome.idempotent,
      entry: outcome.entry,
    },
    outcome.idempotent
      ? "RFC sidecar already bound\n"
      : `rebound RFC sidecar to ${outcome.entry.to_sidecar_sha256}\n`
  );
  return EXIT.OK;
}

function mutateSession(sessionPath, mutation, options = {}) {
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    const session = readSession(sessionPath);
    if (options.allowRfcRelease && session.task.rfc_sidecar) {
      const bound = session.task.rfc_sidecar;
      const observed = `sha256:${crypto
        .createHash("sha256")
        .update(fs.readFileSync(bound.path))
        .digest("hex")}`;
      verifyRfcSidecarIdentity(
        { ...bound, sha256: observed },
        session.task.design_context,
        session.task.work_units,
        { previewSourceRoot: session.task.preview_source_root }
      );
      if (observed !== bound.sha256) {
        const verified = verifyRfcApproval({
          sidecarPath: bound.path,
          slug: session.slug,
          archiveRepoRoot: session.source.repo_root,
          lineageTo: bound.sha256,
        });
        if (verified.sidecar_sha256 !== observed)
          throw new Error("RFC changed during release validation; retry with stable artifacts");
      }
    } else if (!options.allowSidecarRebind) {
      verifyRfcSidecarIdentity(
        session.task.rfc_sidecar,
        session.task.design_context,
        session.task.work_units,
        { previewSourceRoot: session.task.preview_source_root }
      );
    }
    const updated = mutation(session);
    writeSession(sessionPath, updated);
    return updated;
  } finally {
    releaseLock();
  }
}

function recertifyCommand(options) {
  requireOptions(options, ["session", "phases", "commit", "evidence"]);
  const sessionPath = path.resolve(options.session);
  let verification;
  try {
    verification = readBoundedJsonFile(path.resolve(options.evidence), MAX_EVIDENCE_INPUT_BYTES);
  } catch (error) {
    throw cliError(
      `cannot read recertification evidence ${options.evidence}: ${error.message}`,
      EXIT.INVALID
    );
  }
  const phases = options.phases
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  try {
    mutateSession(sessionPath, (session) =>
      recertifyEvidence(session, phases, options.commit, verification)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, phases, commit: options.commit },
    `Recertified ${phases.join(", ")} at ${options.commit}\n`
  );
  return EXIT.OK;
}

function gateCommand(options) {
  requireOnlyOptions(options, ["session", "name", "status", "reason", "artifact", "json"]);
  requireOptions(options, ["session", "name"]);
  const sessionPath = path.resolve(options.session);
  const { planGateWrite } = require("./lib/dev-gate-writer");
  const releaseLock = acquireSessionLock(sessionPath);
  let plan;
  try {
    plan = planGateWrite({
      sessionPath,
      session: readSession(sessionPath),
      name: options.name,
      status: options.status || "passed",
      reason: options.reason,
      artifact: options.artifact,
    });
    writeJsonAtomic(plan.manifestPath, plan.manifest);
    // Persist the checked row first. If session writing fails, replaying the
    // same gate revalidates current source and safely completes the transition.
    const session = readSession(sessionPath);
    if (
      plan.row.status === "skipped" &&
      ["design-critique", "qa"].includes(plan.row.name) &&
      session.status === "active" &&
      session.phase === plan.row.name
    ) {
      const index = session.routing.required_phases.indexOf(session.phase);
      const nextPhase = session.routing.required_phases[index + 1];
      if (index < 0 || !nextPhase) throw new Error("skipped phase has no routed successor");
      require("./lib/workflow-runtime/records").appendTransition(session.history, {
        priorPhase: session.phase,
        nextPhase,
        reason: `policy-approved ${session.phase} skip: ${plan.row.reason}`,
        result: plan.row,
        timestamp: plan.row.checked_at,
        runnerVersion: RUNNER_VERSION,
      });
      session.phase = nextPhase;
      session.phase_attempt = 1;
      session.updated_at = plan.row.checked_at;
      writeSession(sessionPath, session);
    }
  } catch (error) {
    throw cliError(error.message, error.invalidInput ? EXIT.INVALID : EXIT.PRECONDITION);
  } finally {
    releaseLock();
  }
  emit(
    options,
    { manifest_path: plan.manifestPath, row: plan.row, retired: plan.retired },
    `Recorded ${plan.row.name} ${plan.row.status} at ${plan.row.commit}\n` +
      (plan.retired.length ? `Retired legacy gate ${plan.retired.join(", ")}\n` : "")
  );
  return EXIT.OK;
}

function recordQaNonPassingCommand(options) {
  requireOnlyOptions(options, ["session", "status", "commit", "evidence", "json"]);
  requireOptions(options, ["session", "status", "commit", "evidence"]);
  const sessionPath = path.resolve(options.session);
  let verification;
  try {
    verification = readBoundedJsonFile(path.resolve(options.evidence), MAX_EVIDENCE_INPUT_BYTES);
  } catch (error) {
    throw cliError(
      `cannot read non-passing QA candidate evidence ${options.evidence}: ${error.message}`,
      EXIT.INVALID
    );
  }
  if (
    !verification ||
    typeof verification !== "object" ||
    Array.isArray(verification) ||
    Object.keys(verification).length !== 1 ||
    !Array.isArray(verification.qa)
  ) {
    throw cliError(
      "non-passing QA candidate evidence must contain exactly one qa array",
      EXIT.INVALID
    );
  }
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      recordNonPassingQaCandidate(session, options.status, options.commit, verification.qa)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    {
      session_path: sessionPath,
      status: options.status,
      commit: options.commit,
      qa_run_count: updated.evidence.qa.qa_run_count,
    },
    `Recorded ${options.status} QA candidate run ${updated.evidence.qa.qa_run_count}\n`
  );
  return EXIT.OK;
}

function anchorQaHistoryCommand(options) {
  requireOnlyOptions(options, ["session", "commit", "evidence", "json"]);
  requireOptions(options, ["session", "commit", "evidence"]);
  const sessionPath = path.resolve(options.session);
  let verification;
  try {
    verification = readBoundedJsonFile(path.resolve(options.evidence), MAX_EVIDENCE_INPUT_BYTES);
  } catch (error) {
    throw cliError(
      `cannot read QA history anchoring evidence ${options.evidence}: ${error.message}`,
      EXIT.INVALID
    );
  }
  if (
    !verification ||
    typeof verification !== "object" ||
    Array.isArray(verification) ||
    Object.keys(verification).length !== 1 ||
    !Array.isArray(verification.qa)
  ) {
    throw cliError("QA history anchoring evidence must contain exactly one qa array", EXIT.INVALID);
  }
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      anchorQaHistory(session, options.commit, verification.qa)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    {
      session_path: sessionPath,
      commit: options.commit,
      qa_run_count: updated.evidence.qa.qa_run_count,
      anchored_runs: updated.evidence.qa.qa_run_anchors.length,
    },
    `Anchored ${updated.evidence.qa.qa_run_anchors.length} QA runs at ${options.commit}\n`
  );
  return EXIT.OK;
}

function requireQaCommand(options) {
  requireOptions(options, ["session", "expectedSessionSha256", "commit", "reason"]);
  const sessionPath = path.resolve(options.session);
  const unlock = acquireSessionLock(sessionPath);
  try {
    const result = require("./lib/dev-qa-recovery").requireQa({ ...options, sessionPath });
    emit(
      options,
      { session_path: sessionPath, ...result },
      result.idempotent
        ? "QA recovery already recorded\n"
        : "Required first QA; fresh downstream certification required\n"
    );
    return EXIT.OK;
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  } finally {
    unlock();
  }
}

function unblockCommand(options) {
  requireOptions(options, ["session", "reason"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) => resumeBlocked(session, options.reason));
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(options, { session_path: sessionPath, session: updated }, `Resumed ${updated.phase}\n`);
  return EXIT.OK;
}

function authorizeCommand(options) {
  requireOptions(options, ["session", "grant", "reason"]);
  const sessionPath = path.resolve(options.session);
  const actions = options.grant
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      grantAuthority(session, actions, options.reason)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, authority: updated.authority },
    `Granted ${actions.join(", ")}\n`
  );
  return EXIT.OK;
}

function advanceDecisionCommand(options) {
  requireOptions(options, ["session", "expectedVersion", "reason"]);
  const expectedVersion = Number(options.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw cliError("--expected-version must be a positive integer", EXIT.INVALID);
  }
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      advanceDecisionVersion(session, expectedVersion, options.reason)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    {
      session_path: sessionPath,
      decision_version: updated.routing.decision_version,
      decision: updated.routing.decision_log.at(-1),
    },
    `Advanced decision version to ${updated.routing.decision_version}\n`
  );
  return EXIT.OK;
}

function workspaceCommand(options) {
  requireOptions(options, ["session", "worktree"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) => updateWorkspace(session, options.worktree));
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, source: updated.source },
    `${updated.source.worktree}\n`
  );
  return EXIT.OK;
}

function workUnitCommand(options) {
  requireOptions(options, ["session", "id", "status"]);
  const sessionPath = path.resolve(options.session);
  let result;
  if (options.result) {
    try {
      result = JSON.parse(fs.readFileSync(path.resolve(options.result), "utf8"));
    } catch (error) {
      throw cliError(
        `cannot read work-unit result ${options.result}: ${error.message}`,
        EXIT.INVALID
      );
    }
  }
  let updated;
  try {
    updated = mutateSession(
      sessionPath,
      (session) =>
        transitionWorkUnit(session, {
          id: options.id,
          status: options.status,
          result,
          reason: options.reason,
          worktree: options.worktree,
        }),
      // A non-passing stop retains the old contract and proves the current
      // amendment lineage. Completion and retries still require exact binding.
      { allowRfcRelease: ["blocked", "failed"].includes(options.status) }
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  const unit = updated.task.work_units.find((candidate) => candidate.id === options.id);
  emit(options, { session_path: sessionPath, work_unit: unit }, `${unit.id}: ${unit.status}\n`);
  return EXIT.OK;
}

function validateCommand(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  let parsed;
  try {
    parsed = readSession(sessionPath);
  } catch (error) {
    throw cliError(`cannot read session ${sessionPath}: ${error.message}`, EXIT.INVALID);
  }
  const errors = validateSession(parsed);
  if (errors.length > 0)
    throw cliError(formatValidation("session is invalid", errors), EXIT.INVALID);
  emit(options, { valid: true, session_path: sessionPath }, `Valid: ${sessionPath}\n`);
  return EXIT.OK;
}

function candidateCommand(options) {
  requireOptions(options, ["session", "state", "reason"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      transitionCandidate(session, {
        state: options.state,
        reason: options.reason,
        external_effect_started_at: options.externalEffectStartedAt,
      })
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, candidate: updated.candidate },
    `${updated.candidate.state}: ${updated.candidate.route}\n`
  );
  return EXIT.OK;
}

function candidateRefreshCommand(options) {
  requireOptions(options, [
    "session",
    "commit",
    "affectedIdentity",
    "repositoryCapabilityIdentity",
    "gatePlanIdentity",
  ]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      refreshCandidateIdentities(session, {
        commit: options.commit,
        affectedIdentity: options.affectedIdentity,
        repositoryCapabilityIdentity: options.repositoryCapabilityIdentity,
        gatePlanIdentity: options.gatePlanIdentity,
      })
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, candidate: updated.candidate },
    `candidate identities refreshed for ${options.commit}\n`
  );
  return EXIT.OK;
}

function candidateEffectCommand(options) {
  requireOptions(options, ["session", "at"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      markCandidateExternalEffectStarted(session, { now: options.at })
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  emit(
    options,
    { session_path: sessionPath, candidate: updated.candidate },
    `external effect started: ${updated.candidate.external_effect_started_at}\n`
  );
  return EXIT.OK;
}

function migrateCommand(options) {
  requireOptions(options, ["legacy"]);
  const legacyPath = path.resolve(options.legacy);
  if (!fs.existsSync(legacyPath)) {
    throw cliError(`legacy session does not exist: ${legacyPath}`, EXIT.PRECONDITION);
  }
  const migrated = migrateLegacyMarkdown(legacyPath, { output: options.output });
  const releaseLock = acquireSessionLock(migrated.outputPath);
  try {
    if (fs.existsSync(migrated.outputPath)) {
      throw cliError(`session already exists: ${migrated.outputPath}`, EXIT.PRECONDITION);
    }
    writeSession(migrated.outputPath, migrated.session);
  } finally {
    releaseLock();
  }
  emit(
    options,
    { session_path: migrated.outputPath, legacy_path: legacyPath, session: migrated.session },
    `Migrated ${legacyPath} to ${migrated.outputPath}\n`
  );
  return EXIT.OK;
}

function projectCommand(options) {
  const { session } = loadRequiredSession(options);
  const markdown = projectMarkdown(session);
  if (options.output) {
    writeTextAtomic(path.resolve(options.output), markdown);
    emit(
      options,
      { output_path: path.resolve(options.output) },
      `${path.resolve(options.output)}\n`
    );
  } else {
    emit(options, { markdown }, markdown);
  }
  return EXIT.OK;
}

// ---------------------------------------------------------------------------
// Resource ledger: resource-add, resources, close, sweep

const TARGET_FLAGS = Object.freeze({
  directory: ["path"],
  worktree: ["path"],
  process: ["pid"],
  database: ["identifier", "teardown"],
  account: ["identifier", "teardown"],
  simulator: ["identifier", "teardown"],
});

// A completed run's active path holds only completion.json, which points at
// the archive. Follow it so close works with the path Dev started with.
function resolveLedgerSessionPath(value) {
  const sessionPath = path.resolve(value);
  if (fs.existsSync(sessionPath)) return sessionPath;
  const completionPath = path.join(path.dirname(sessionPath), "completion.json");
  let completion;
  try {
    completion = JSON.parse(fs.readFileSync(completionPath, "utf8"));
  } catch {
    throw cliError(`session does not exist: ${sessionPath}`, EXIT.PRECONDITION);
  }
  const archived =
    typeof completion?.session_path === "string" ? path.resolve(completion.session_path) : null;
  const archiveRoot = path.join(
    path.dirname(path.dirname(sessionPath)),
    "completed",
    path.basename(path.dirname(sessionPath))
  );
  if (!archived || !isWithin(archiveRoot, archived) || !fs.existsSync(archived)) {
    throw cliError(`completion pointer does not name this session's archive`, EXIT.PRECONDITION);
  }
  return archived;
}

function readRawSession(sessionPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("not an object");
    return raw;
  } catch (error) {
    throw cliError(`cannot read session ${sessionPath}: ${error.message}`, EXIT.INVALID);
  }
}

function sessionKey(sessionPath) {
  return resources.realOrNull(sessionPath) || sessionPath;
}

// `sessions` lets a caller that already discovered the repository's sessions,
// such as the sweep, reuse them instead of reading every session again.
function ledgerContext(session, sessionPath, { protect = true, sessions: known } = {}) {
  const repoRoot = resources.realOrNull(session.source?.repo_root);
  const sessions = !protect || !repoRoot ? [] : known || resources.discoverSessions(repoRoot);
  return resources.buildContext({
    session,
    sessionPath,
    protectedTargets: protect ? resources.activeTargets(sessions, sessionKey(sessionPath)) : [],
  });
}

// Lock first so the directory is never created for a session another
// process holds.
function allocateScratch(sessionPath, tempRoot) {
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    const session = readSession(sessionPath);
    const directory = fs.mkdtempSync(path.join(tempRoot, "pm-dev-"));
    const registration = registerScratch(session, sessionPath, directory);
    return { directory, ...registration };
  } finally {
    releaseLock();
  }
}

function registerScratch(session, sessionPath, directory) {
  try {
    const entry = resources.prepareEntry(
      { kind: "directory", path: directory, createdBy: "dev-session scratch" },
      ledgerContext(session, sessionPath, { protect: false })
    );
    writeSession(sessionPath, { ...session, resources: [...(session.resources || []), entry] });
    return { resource: entry };
  } catch (error) {
    if (error.resourceRefusal) return { refused: error.message };
    throw error;
  }
}

function resourceAddCommand(options) {
  requireOnlyOptions(options, [
    "session",
    "kind",
    "createdBy",
    "path",
    "pid",
    "identifier",
    "teardown",
    "label",
    "json",
  ]);
  requireOptions(options, ["session", "kind", "createdBy"]);
  const kind = options.kind;
  if (!Object.hasOwn(TARGET_FLAGS, kind)) {
    throw cliError(`--kind must be one of ${Object.keys(TARGET_FLAGS).join(", ")}`, EXIT.INVALID);
  }
  const unexpected = ["path", "pid", "identifier", "teardown"].find(
    (flag) => options[flag] !== undefined && !TARGET_FLAGS[kind].includes(flag)
  );
  if (unexpected) throw cliError(`--kind ${kind} does not take --${unexpected}`, EXIT.INVALID);
  requireOptions(options, TARGET_FLAGS[kind]);
  if (kind === "process" && !/^\d+$/.test(options.pid)) {
    throw cliError("--pid must be a positive integer", EXIT.INVALID);
  }
  for (const name of ["createdBy", "label"]) {
    const value = options[name];
    if (value !== undefined && (!value.trim() || value.length > 200)) {
      throw cliError(`--${toKebab(name)} must be 1 to 200 characters`, EXIT.INVALID);
    }
  }
  const sessionPath = path.resolve(options.session);
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    const session = readSession(sessionPath);
    if (!["active", "blocked"].includes(session.status)) {
      throw cliError("resource-add requires an active or blocked session", EXIT.PRECONDITION);
    }
    let entry;
    try {
      entry = resources.prepareEntry(
        {
          kind,
          path: options.path,
          pid: options.pid,
          identifier: options.identifier,
          teardown: options.teardown,
          createdBy: options.createdBy.trim(),
          label: options.label?.trim(),
        },
        ledgerContext(session, sessionPath, { protect: false })
      );
    } catch (error) {
      if (!error.resourceRefusal) throw error;
      throw cliError(
        `refused: ${error.message}`,
        error.resourceRefusal === "invalid" ? EXIT.INVALID : EXIT.PRECONDITION
      );
    }
    const ledger = session.resources || [];
    const existing = ledger.find(
      (item) => item.status === "registered" && resources.sameTarget(item, entry)
    );
    if (!existing) writeSession(sessionPath, { ...session, resources: [...ledger, entry] });
    const resource = existing || entry;
    emit(
      options,
      { session_path: sessionPath, resource, idempotent: Boolean(existing) },
      `${resource.id}: ${resource.kind} ${describeTarget(resource)}\n`
    );
    return EXIT.OK;
  } finally {
    releaseLock();
  }
}

function resourcesCommand(options) {
  requireOnlyOptions(options, ["session", "json"]);
  requireOptions(options, ["session"]);
  const sessionPath = resolveLedgerSessionPath(options.session);
  const raw = readRawSession(sessionPath);
  const ledger = Array.isArray(raw.resources) ? raw.resources : [];
  emit(
    options,
    { session_path: sessionPath, resources: ledger },
    ledger
      .map((item) => `${item.id} ${item.status} ${item.kind} ${describeTarget(item)}\n`)
      .join("")
  );
  return EXIT.OK;
}

function closeCommand(options) {
  requireOnlyOptions(options, ["session", "dryRun", "json"]);
  requireOptions(options, ["session"]);
  const dryRun = Boolean(options.dryRun);
  const sessionPath = resolveLedgerSessionPath(options.session);
  const raw = readRawSession(sessionPath);
  if (!Array.isArray(raw.resources) || raw.resources.length === 0) {
    // No ledger: nothing to remove and nothing is written.
    const report = {
      session_path: sessionPath,
      session_status: raw.status,
      dry_run: dryRun,
      entries: [],
      bytes_freed: 0,
      bytes_to_free: 0,
      remaining: [],
    };
    emit(options, report, formatCloseReport(report));
    return EXIT.OK;
  }
  const releaseLock = acquireSessionLock(sessionPath);
  let report;
  try {
    report = closeSessionLedger(readSession(sessionPath), sessionPath, dryRun);
  } finally {
    releaseLock();
  }
  emit(options, report, formatCloseReport(report));
  if (report.write_error) return EXIT.PRECONDITION;
  return !dryRun && report.remaining.length ? EXIT.RESOURCES_REMAIN : EXIT.OK;
}

// Caller holds the session lock.
function closeSessionLedger(session, sessionPath, dryRun, { sessions } = {}) {
  const outcome = resources.closeLedger(
    session.resources || [],
    ledgerContext(session, sessionPath, { sessions }),
    {
      dryRun,
    }
  );
  const report = { session_path: sessionPath, session_status: session.status, ...outcome.report };
  if (outcome.changed) {
    try {
      writeSession(sessionPath, { ...session, resources: outcome.resources });
    } catch (error) {
      report.write_error = error.message;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Follow-up items from Design Director reports: follow-ups, follow-up-record

function followUpsCommand(options) {
  requireOnlyOptions(options, ["session", "json"]);
  requireOptions(options, ["session"]);
  const sessionPath = resolveLedgerSessionPath(options.session);
  const sessionDir = path.dirname(sessionPath);
  const session = readSession(sessionPath);
  const collected = followUpLedger.collectFollowUps({
    sessionDir,
    designContext: session.task?.design_context,
  });
  const base = {
    session_path: sessionPath,
    reports: collected.reports,
    skipped: collected.skipped,
  };
  if (collected.reports.length === 0) {
    // No director report: nothing to file and nothing is written.
    const report = {
      ...base,
      fileable: false,
      reason: "no director reports",
      merge_sha: null,
      items: [],
      counts: followUpLedger.countStates([]),
    };
    emit(options, report, "No Design Director reports.\n");
    return EXIT.OK;
  }
  const delivery = followUpLedger.deliveryState(session);
  let ledger = session.follow_ups;
  if (delivery.merged && collected.items.length > 0) {
    const releaseLock = acquireSessionLock(sessionPath);
    try {
      const current = readSession(sessionPath);
      const synced = followUpLedger.syncLedger(
        current.follow_ups,
        collected.items,
        delivery.merge_sha,
        new Date().toISOString()
      );
      ledger = synced.ledger;
      if (synced.changed) writeSession(sessionPath, { ...current, follow_ups: ledger });
    } finally {
      releaseLock();
    }
  }
  const items = followUpLedger.withState(collected.items, ledger, delivery.merged);
  const report = {
    ...base,
    fileable: delivery.merged,
    reason: delivery.reason,
    merge_sha: delivery.merge_sha,
    items,
    counts: followUpLedger.countStates(items),
  };
  emit(options, report, formatFollowUps(report));
  return EXIT.OK;
}

function formatFollowUps(report) {
  const header = report.fileable
    ? `Follow-ups after merge ${report.merge_sha}:\n`
    : `Follow-ups held in the reports (${report.reason}); nothing is filed:\n`;
  const lines = report.items.map(
    (item) =>
      `${item.key} ${item.state} ${item.scope} ${item.class} ${item.dimension}: ${item.change}` +
      (item.ref ? ` [${item.ref}]` : "") +
      "\n"
  );
  return header + (lines.length ? lines.join("") : "None.\n");
}

function followUpRecordCommand(options) {
  requireOnlyOptions(options, [
    "session",
    "key",
    "state",
    "tracker",
    "ref",
    "action",
    "into",
    "scope",
    "json",
  ]);
  requireOptions(options, ["session", "key", "state"]);
  const sessionPath = resolveLedgerSessionPath(options.session);
  const releaseLock = acquireSessionLock(sessionPath);
  try {
    const session = readSession(sessionPath);
    const delivery = followUpLedger.deliveryState(session);
    if (!delivery.merged) {
      throw cliError(
        `follow-ups are filed only after a merge; this run is ${delivery.reason}`,
        EXIT.PRECONDITION
      );
    }
    let outcome;
    try {
      outcome = followUpLedger.applyRecord(
        session.follow_ups,
        {
          key: options.key,
          state: options.state,
          tracker: options.tracker,
          ref: options.ref,
          action: options.action,
          into: options.into,
          scope: options.scope,
        },
        new Date().toISOString()
      );
    } catch (error) {
      if (!error.followUpRefusal) throw error;
      throw cliError(
        error.message,
        error.followUpRefusal === "invalid" ? EXIT.INVALID : EXIT.PRECONDITION
      );
    }
    if (!outcome.idempotent) writeSession(sessionPath, { ...session, follow_ups: outcome.ledger });
    emit(
      options,
      { session_path: sessionPath, item: outcome.item, idempotent: outcome.idempotent },
      `${outcome.item.key} ${outcome.item.state}${outcome.item.ref ? ` ${outcome.item.ref}` : ""}\n`
    );
    return EXIT.OK;
  } finally {
    releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Standing merge authorization: merge-authorization, merge-check, revoke

const MERGE_CHECK_EXIT = Object.freeze({ merge: 0, refuse: 1, manual: EXIT.PRECONDITION });
const MAX_MERGE_INPUT_BYTES = 1024 * 1024;

function readOptionalJson(file) {
  try {
    return { value: readBoundedJsonFile(file, MAX_MERGE_INPUT_BYTES), error: null };
  } catch (error) {
    return { value: null, error: error.code === "ENOENT" ? "missing" : error.message };
  }
}

function readProposalApproval(ledger) {
  if (!ledger?.proposal?.path) return { value: null, error: "no proposal path" };
  return readOptionalJson(ledger.proposal.path.replace(/\.json$/, ".approval.json"));
}

function mergeAuthorizationState(session) {
  const ledger = session.merge_authorization;
  const projectSetting = mergeAuthorization.readProjectMergeSetting(
    mergeAuthorization.pmDirForProposal(ledger?.proposal?.path || session.task?.proposal?.path)
  );
  const approval = readProposalApproval(ledger);
  const revocations = ledger?.proposal?.path
    ? mergeAuthorization.readMergeRevocations(ledger.proposal.path)
    : { value: null, error: null };
  const reasons = mergeAuthorization.authorizationReasons({
    session,
    projectSetting,
    approval: approval.value,
    approvalError: approval.error,
    revocations: revocations.value,
    revocationError: revocations.error,
  });
  return {
    ledger,
    projectSetting,
    approval,
    revocations,
    reasons,
    applies: reasons.length === 0,
  };
}

function mergeAuthorizationCommand(options) {
  requireOnlyOptions(options, ["session", "apply", "json"]);
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  let session = readSession(sessionPath);
  const state = mergeAuthorizationState(session);
  if (options.apply && state.applies) {
    // Pushing the branch and opening the PR are the steps toward the merge the
    // approver authorized; the merge itself waits for merge-check.
    const reason = mergeAuthorization.standingDeliveryReason(state.ledger);
    session = mutateSession(sessionPath, (current) =>
      grantAuthority(current, ["push_feature_branch", "create_pr"], reason)
    );
  }
  const report = {
    session_path: sessionPath,
    applies: state.applies,
    reasons: state.reasons.map(({ code, message, class: kind }) => ({
      code,
      message,
      class: kind,
    })),
    record: state.ledger?.record ?? null,
    revoked: state.ledger?.revoked ?? null,
    project_setting: state.projectSetting,
    decisions: state.ledger?.decisions?.length ?? 0,
    authority: session.authority,
  };
  emit(
    options,
    report,
    state.applies
      ? `Standing merge authorization applies (approved by ${state.ledger.record.approved_by} at ${state.ledger.record.approved_at}).\n`
      : `Standing merge authorization does not apply: ${state.reasons
          .map((item) => item.code)
          .join(", ")}\n`
  );
  return state.applies ? EXIT.OK : EXIT.PRECONDITION;
}

function mergeAuthorizationRevokeCommand(options) {
  requireOnlyOptions(options, ["session", "reason", "json"]);
  requireOptions(options, ["session", "reason"]);
  const sessionPath = path.resolve(options.session);
  let updated;
  try {
    updated = mutateSession(sessionPath, (session) =>
      mergeAuthorization.revokeMergeAuthorization(session, options.reason)
    );
  } catch (error) {
    throw cliError(error.message, EXIT.PRECONDITION);
  }
  // The session is revoked first, so a failure below still leaves it revoked.
  // The record beside the approval audit makes the revocation outlive the
  // session: routing and merge-check read it for every later Dev session.
  const ledger = updated.merge_authorization;
  const current = mergeAuthorization.readMergeRevocations(ledger.proposal.path);
  try {
    if (current.error) throw new Error(`cannot read ${current.file}: ${current.error}`);
    const next = mergeAuthorization.addRevocation(
      current.value,
      ledger,
      ledger.revoked.reason,
      ledger.revoked.revoked_at,
      updated.run_id
    );
    if (next.changed) writeJsonFileAtomic(current.file, next.document, { fileMode: 0o600 });
  } catch (error) {
    throw cliError(
      `this session is revoked, but the durable revocation record was not written, so a new session from the same approval would not be: ${error.message}`,
      EXIT.RECORD_FAILED
    );
  }
  emit(
    options,
    {
      session_path: sessionPath,
      revoked: updated.merge_authorization.revoked,
      revocation_record: current.file,
    },
    `Standing merge authorization revoked: ${updated.merge_authorization.revoked.reason}\n${
      updated.merge_authorization.revoked.cleared_authority
        ? "The merge authority it granted is withdrawn; merging needs the user's own confirmation.\n"
        : ""
    }`
  );
  return EXIT.OK;
}

// Decides whether the merge may proceed automatically and, with --record,
// writes the decision to the session. Only a merge decision grants the merge
// authority Ship's transaction requires. The PR, its protection and its
// required checks are read from GitHub through `gh api`; the repository comes
// from the delivery contract, which must name the repository the session's
// delivery remote pushes to, and the PR number from the release transaction's
// verified Create PR receipt. `--observation <file>` replaces that read for
// diagnosis only: a decision made from a file is recorded with observation
// source `file` and never allows a merge.
function mergeCheckCommand(options) {
  requireOnlyOptions(options, [
    "session",
    "observation",
    "commit",
    "gates",
    "root",
    "record",
    "json",
  ]);
  requireOptions(options, ["session", "commit"]);
  const sessionPath = path.resolve(options.session);
  const session = readSession(sessionPath);
  const root = path.resolve(options.root || session.source.worktree || session.source.repo_root);
  const gatesPath = path.resolve(
    options.gates || path.join(root, ".pm", "dev-sessions", session.slug, "gates.json")
  );
  const shipDir = path.join(path.dirname(gatesPath), "ship");
  let fileObservation = null;
  if (options.observation !== undefined) {
    fileObservation = readOptionalJson(path.resolve(options.observation));
    if (fileObservation.error)
      throw cliError(`cannot read observation: ${fileObservation.error}`, EXIT.INVALID);
  }
  const gates = readOptionalJson(gatesPath).value;
  const state = mergeAuthorizationState(session);
  const commit = options.commit;
  const deliveryContract = readOptionalJson(path.join(shipDir, "delivery-contract.json")).value;
  const releaseTransaction = readOptionalJson(path.join(shipDir, "release-transaction.json")).value;
  const observed = observePullRequest({
    fileObservation,
    state,
    deliveryContract,
    releaseTransaction,
    root,
    session,
  });
  const gateCheck = gates ? fullGateCheck({ root, session, gates, gatesPath, commit }) : null;
  const director = directorEvidence({ root, session, gates, commit });
  const result = mergeAuthorization.evaluateAutoMerge({
    session,
    commit,
    projectSetting: state.projectSetting,
    approval: state.approval.value,
    approvalError: state.approval.error,
    revocations: state.revocations.value,
    revocationError: state.revocations.error,
    gates,
    gateCheck,
    directorCheck: director.check,
    directorReport: director.report,
    mechanical: director.mechanical,
    observation: observed.observation,
    observationSource: observed.source,
    observationError: observed.error,
    deliveryContract,
    releaseTransaction,
  });
  let recorded = false;
  if (options.record && session.merge_authorization) {
    try {
      mutateSession(sessionPath, (current) => {
        if (current.updated_at !== session.updated_at)
          throw new Error("the session changed during merge-check; run it again");
        return mergeAuthorization.recordMergeDecision(current, result, grantAuthority);
      });
      recorded = true;
    } catch (error) {
      // Not "manual": a loop must never park a passing merge as needing a
      // human because the write failed, nor merge on an unrecorded decision.
      throw cliError(
        `merge-check decided ${result.decision} but could not record it, so nothing was granted: ${error.message}`,
        EXIT.RECORD_FAILED
      );
    }
  }
  emit(
    options,
    { ...result, session_path: sessionPath, recorded },
    result.decision === "merge"
      ? `Merge may proceed automatically at ${commit}.\n`
      : `${result.decision === "manual" ? "No standing authorization applies" : "Merge refused"}: ${result.reasons
          .map((item) => `${item.code} (${item.message})`)
          .join("; ")}\n`
  );
  return MERGE_CHECK_EXIT[result.decision];
}

function verifiedPrNumber(releaseTransaction) {
  const receipt = releaseTransaction?.effects?.["create-pr"]?.verified_receipt?.receipt;
  const number = receipt?.pr_number ?? receipt?.number;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

// The OWNER/REPO the session's delivery remote pushes to. merge-check reads
// GitHub for this repository, so a stale or wrong delivery contract is caught
// as a mismatch rather than silently read for another repository.
function deliveryRemoteRepository(root, session) {
  const remote = session.source?.delivery_remote || "origin";
  const listed = require("node:child_process").spawnSync(
    "git",
    ["remote", "get-url", "--push", "--all", "--", remote],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const urls = listed.status === 0 ? String(listed.stdout).split(/\r?\n/).filter(Boolean) : [];
  const unknown = (message) => ({
    repository: null,
    error: { code: "delivery-remote-unknown", message },
  });
  if (urls.length !== 1)
    return unknown(
      `delivery remote ${remote} must have exactly one push URL, found ${urls.length}`
    );
  try {
    return { repository: require("./prepare-release").githubRepository(urls[0]), error: null };
  } catch (error) {
    return unknown(`delivery remote ${remote}: ${error.message}`);
  }
}

// GitHub is read only when a standing authorization applies; otherwise the
// decision is manual whatever the PR shows.
function observePullRequest({
  fileObservation,
  state,
  deliveryContract,
  releaseTransaction,
  root,
  session,
}) {
  if (fileObservation) return { observation: fileObservation.value, source: "file", error: null };
  if (!state.applies)
    return {
      observation: null,
      source: null,
      error: {
        code: "observation-not-read",
        message: "GitHub was not read because the standing authorization does not apply",
      },
    };
  const remote = deliveryRemoteRepository(root, session);
  if (remote.error) return { observation: null, source: "github", error: remote.error };
  const contracted = deliveryContract?.github_name_with_owner;
  if (typeof contracted === "string" && contracted && contracted !== remote.repository)
    return {
      observation: null,
      source: "github",
      error: {
        code: "delivery-remote-mismatch",
        message: `the delivery contract names ${contracted}, but delivery remote ${session.source?.delivery_remote || "origin"} pushes to ${remote.repository}`,
      },
    };
  return require("./lib/github-merge-observation").readGithubMergeObservation({
    repository: contracted,
    prNumber: verifiedPrNumber(releaseTransaction),
  });
}

function fullGateCheck({ root, session, gates, gatesPath, commit }) {
  try {
    const checker = require("./dev-gate-check");
    const context = checker.resolveEnforcementContext({
      cwd: root,
      session,
      enforce: true,
      currentCommit: commit,
      currentBranch: session.source.branch,
      remote: session.source.delivery_remote || "origin",
    });
    return checker.checkGateManifest(gates, {
      currentCommit: commit,
      currentBranch: context.currentBranch,
      manifestPath: gatesPath,
      changedFiles: context.changedFiles,
      runId: session.run_id,
      canonicalSession: session,
      requireSessionBinding: true,
      authoritativeBaseRef: context.authoritativeBaseRef,
      authoritativeBaseCommit: context.authoritativeBaseCommit,
      authoritativePushUrlSha256: context.authoritativePushUrlSha256,
      reviewEvidenceMode: "enforce",
      artifactRoot: root,
      requiredAuthorities: [],
    });
  } catch (error) {
    return { ok: false, issues: [{ message: error.message }] };
  }
}

function directorEvidence({ root, session, gates, commit }) {
  const row = Array.isArray(gates?.gates)
    ? gates.gates.find((item) => item?.name === "design-critique")
    : null;
  const { checkDesignDirector, isDirectorReportPath } = require("./lib/design-director-report");
  if (row?.status !== "passed" || !isDirectorReportPath(row.artifact))
    return { check: null, report: null, mechanical: null };
  const check = checkDesignDirector({
    root,
    reportPath: row.artifact,
    commit: row.commit,
    runId: session.run_id,
  });
  let mechanical;
  try {
    mechanical = require("./lib/design-director-mechanical").runMechanicalChecks({
      root,
      session,
      commit,
    });
  } catch (error) {
    mechanical = { ok: false, issues: [{ check: "mechanical", message: error.message }] };
  }
  return { check, report: row.artifact, mechanical };
}

function sweepCommand(options) {
  requireOnlyOptions(options, ["session", "sourceDir", "remove", "json"]);
  if (Boolean(options.session) === Boolean(options.sourceDir)) {
    throw cliError("sweep takes exactly one of --session or --source-dir", EXIT.INVALID);
  }
  const remove = Boolean(options.remove);
  let repoRoot;
  let currentKey = null;
  if (options.session) {
    const sessionPath = resolveLedgerSessionPath(options.session);
    repoRoot = readRawSession(sessionPath).source?.repo_root;
    currentKey = sessionKey(sessionPath);
  } else {
    repoRoot = findGitRoot(path.resolve(options.sourceDir));
  }
  repoRoot = resources.realOrNull(repoRoot);
  if (!repoRoot) throw cliError("cannot find the repository to sweep", EXIT.PRECONDITION);
  const ignored = [];
  const sessions = resources.discoverSessions(repoRoot, { ignored });
  const report = {
    repo_root: repoRoot,
    dry_run: !remove,
    ignored,
    sessions: [],
    bytes_freed: 0,
    bytes_to_free: 0,
    remaining: [],
  };
  let dryRunTargets = null;
  const dryRunWorktrees = new Map();
  for (const found of sessions) {
    if (found.key === currentKey) continue;
    const ledger = Array.isArray(found.raw?.resources)
      ? found.raw.resources.filter((item) => item?.status === "registered")
      : [];
    if (found.raw && !ledger.length) continue;
    const ledgerErrors = [];
    resources.validateResources(found.raw?.resources, ledgerErrors);
    // An unreadable session or ledger is left alone and reported.
    const classified = ledgerErrors.length
      ? {
          state: "active",
          reason: `ledger is invalid: ${ledgerErrors[0].path} ${ledgerErrors[0].message}`,
        }
      : resources.classifySession(found);
    const item = {
      session_path: found.sessionPath,
      slug: found.raw?.slug || path.basename(path.dirname(found.sessionPath)),
      run_id: found.raw?.run_id || null,
      status: found.raw?.status || null,
      state: classified.state,
      reason: classified.reason,
      entries: [],
    };
    if (classified.state === "active") {
      item.entries = ledger.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        target: describeTarget(entry),
        created_by: entry.created_by,
        outcome: "skipped",
        reason: `session is still active (${classified.reason})`,
        bytes: 0,
      }));
    } else if (!remove) {
      // A dry run changes nothing, so the worktree lists and the active
      // sessions' targets are built once for the whole sweep. This session is
      // not active, so none of those targets is its own.
      dryRunTargets ||= resources.activeTargets(sessions);
      const outcome = resources.closeLedger(
        ledger,
        resources.buildContext({
          session: found.raw,
          sessionPath: found.sessionPath,
          protectedTargets: dryRunTargets,
          worktreeCache: dryRunWorktrees,
        }),
        { dryRun: true }
      );
      // Report only what still exists.
      item.entries = outcome.report.entries.filter((entry) => entry.outcome !== "gone");
      report.bytes_to_free += outcome.report.bytes_to_free;
      report.remaining.push(...outcome.report.remaining);
    } else {
      try {
        const releaseLock = acquireSessionLock(found.sessionPath);
        try {
          const closed = closeSessionLedger(
            readSession(found.sessionPath),
            found.sessionPath,
            false,
            {
              sessions,
            }
          );
          item.entries = closed.entries.filter((entry) => entry.outcome !== "already-closed");
          report.bytes_freed += closed.bytes_freed;
          report.remaining.push(...closed.remaining);
          if (closed.write_error) item.write_error = closed.write_error;
        } finally {
          releaseLock();
        }
      } catch (error) {
        item.error = error.message;
        item.entries = ledger.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          target: describeTarget(entry),
          created_by: entry.created_by,
          outcome: "skipped",
          reason: error.message,
          bytes: 0,
        }));
        report.remaining.push(...item.entries);
      }
    }
    if (item.entries.length || item.error) report.sessions.push(item);
  }
  emit(options, report, formatSweepReport(report));
  return remove && report.remaining.length ? EXIT.RESOURCES_REMAIN : EXIT.OK;
}

function describeTarget(entry) {
  if (entry.kind === "directory" || entry.kind === "worktree") return entry.path;
  if (entry.kind === "process") return `pid ${entry.pid}`;
  return entry.identifier;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatEntryLines(entries) {
  return entries
    .map(
      (entry) =>
        `${entry.outcome} ${entry.kind} ${entry.target}: ${entry.reason}` +
        (entry.bytes ? ` (${formatBytes(entry.bytes)})` : "") +
        "\n"
    )
    .join("");
}

function formatCloseReport(report) {
  const summary = report.dry_run
    ? `Would free ${formatBytes(report.bytes_to_free)}; ${report.remaining.length} resource(s) would remain.\n`
    : `Freed ${formatBytes(report.bytes_freed)}; ${report.remaining.length} resource(s) remain.\n`;
  return (
    formatEntryLines(report.entries) +
    summary +
    (report.write_error ? `Session not updated: ${report.write_error}\n` : "")
  );
}

function formatSweepReport(report) {
  const ignored = (report.ignored || [])
    .map((item) => `Ignored ${item.session_path}: ${item.reason}\n`)
    .join("");
  if (!report.sessions.length) return `${ignored}No orphaned resources.\n`;
  const body = report.sessions
    .map(
      (item) => `${item.slug} (${item.state}: ${item.reason})\n${formatEntryLines(item.entries)}`
    )
    .join("");
  const summary = report.dry_run
    ? `Would free ${formatBytes(report.bytes_to_free)}. Rerun with --remove to remove orphans.\n`
    : `Freed ${formatBytes(report.bytes_freed)}; ${report.remaining.length} resource(s) remain.\n`;
  return ignored + body + summary;
}

function writeTextAtomic(filePath, text) {
  writeAtomicText(filePath, text, { directoryMode: 0o700, fileMode: 0o600 });
}

function loadRequiredSession(options) {
  requireOptions(options, ["session"]);
  const sessionPath = path.resolve(options.session);
  return { session: readSession(sessionPath), sessionPath };
}

function requireOptions(options, names) {
  const missing = names.filter((name) => !options[name]);
  if (missing.length > 0) {
    throw cliError(
      `missing required option(s): ${missing.map((name) => `--${toKebab(name)}`).join(", ")}`,
      EXIT.INVALID
    );
  }
}

function requireOnlyOptions(options, names) {
  const allowed = new Set(names);
  const unexpected = Object.keys(options).find((name) => !allowed.has(name));
  if (unexpected) {
    throw cliError(`unexpected option for this command: --${toKebab(unexpected)}`, EXIT.INVALID);
  }
}

function toKebab(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function emit(options, payload, text) {
  process.stdout.write(options.json ? `${JSON.stringify(payload, null, 2)}\n` : text);
}

function formatValidation(prefix, errors) {
  return `${prefix}: ${errors.map((entry) => `${entry.path} ${entry.message}`).join("; ")}`;
}

function cliError(message, exitCode) {
  const error = new Error(message);
  error.exitCode = exitCode;
  return error;
}

function helpText() {
  return [
    "Usage: dev-session <command> [options]",
    "",
    "Commands:",
    "  init --slug <slug> --source-dir <path> [--task <path-or-id>] [--json]",
    "  status --session <path> [--json]",
    "  storage --session <path> [--json]",
    "  scratch --session <path> [--json]",
    "  resource-add --session <path> --kind <directory|worktree|process|database|account|simulator> --created-by <who> [--path <dir> | --pid <n> | --identifier <id> --teardown <name>] [--label <text>] [--json]",
    "  resources --session <path> [--json]",
    "  close --session <path> [--dry-run] [--json]",
    "  follow-ups --session <path> [--json]",
    "  follow-up-record --session <path> --key <fu_key> --state <pending|filed|merged|declined> [--tracker <linear|backlog> --ref <id> --action <created|occurrence-added>] [--into <fu_key>] [--scope <system|local>] [--json]",
    "  sweep (--session <path> | --source-dir <path>) [--remove] [--json]",
    "  merge-authorization --session <path> [--apply] [--json]",
    "  merge-authorization-revoke --session <path> --reason <text> [--json]",
    "  merge-check --session <path> --commit <sha> [--gates <gates.json>] [--root <worktree>] [--record] [--json]",
    "      reads the PR, branch protection and required checks from GitHub with gh api;",
    "      [--observation <pr-ci.json>] replaces that read for diagnosis and never allows a merge",
    "      exit 0 merge, 1 refuse, 3 manual (no standing authorization applies), 2 bad input,",
    "      8 the decision could not be recorded (nothing granted; treat as blocked)",
    "  next --session <path> [--json]",
    "  prompt --session <path> --output <path> [--json]",
    "  route --session <path> --facts <json-path> [--rfc-sidecar <json-path>] [--json]",
    "  record --session <path> --result <path> [--retain-large-evidence <reason>] [--json]",
    "  rebind-rfc --session <path> --rfc-sidecar <json-path> --expected-sidecar-sha256 <sha256:hex> --reason <text> [--json]",
    "  recertify --session <path> --phases <csv> --commit <sha> --evidence <json-path> [--json]",
    "  gate --session <path> --name <gate> [--status <passed|failed|blocked|skipped>] [--reason <text>] [--artifact <path>] [--json]",
    "  anchor-qa-history --session <path> --commit <sha> --evidence <json-path> [--json]",
    "  record-qa-nonpassing --session <path> --status <failed|blocked> --commit <sha> --evidence <json-path> [--json]",
    "  require-qa --session <path> --expected-session-sha256 <sha256:hex> --commit <sha> --reason <text> [--json]",
    "  unblock --session <path> --reason <resolution> [--json]",
    "  authorize --session <path> --grant <csv> --reason <consent> [--json]",
    "  advance-decision --session <path> --expected-version <n> --reason <direction> [--json]",
    "  workspace --session <path> --worktree <path> [--json]",
    "  work-unit --session <path> --id <id> --status <status> [--worktree <path>] [--result <path>] [--reason <text>] [--json]",
    "  candidate --session <path> --state <state> --reason <text> [--external-effect-started-at <time>] [--json]",
    "  candidate-refresh --session <path> --commit <sha> --affected-identity <sha256:id> --repository-capability-identity <sha256:id> --gate-plan-identity <sha256:id> [--json]",
    "  candidate-effect --session <path> --at <time> [--json]",
    "  validate --session <path> [--json]",
    "  migrate --legacy <path> [--output <path>] [--json]",
    "  project --session <path> [--output <path>] [--json]",
    "",
  ].join("\n");
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`dev-session: ${error.message}\n`);
    process.exitCode = error.exitCode || EXIT.INVALID;
  }
}

module.exports = { EXIT, main, parseArguments, acquireSessionLock };
