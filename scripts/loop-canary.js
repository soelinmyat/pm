#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseCliArgs } = require("./loop-args.js");
const {
  executionConfigHash,
  loadTrustedLoopConfig,
  sha256,
  stableValue,
} = require("./loop-config.js");
const { engineCommand } = require("./loop-engine.js");
const { findGitRoot, runGit, writeJsonAtomic } = require("./loop-git.js");
const { withRemoteSnapshot } = require("./loop-pm-transaction.js");
const { runWorker } = require("./loop-worker.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { parseFrontmatter } = require("./kb-frontmatter.js");

const CANARY_CASES = Object.freeze(["preflight-failure", "blocked-result", "verified-pr"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

function canaryRoot(pmStateDir) {
  return path.join(pmStateDir, "loop-canary");
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function stableEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function boundedJson(value, maxBytes = 64 * 1024) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) <= maxBytes) return value;
  return { truncated: true, sha256: sha256(text), bytes: Buffer.byteLength(text) };
}

function currentCanaryIdentity(projectDir, config, options = {}) {
  const pluginRoot = options.pluginRoot || path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.config.json"), "utf8"));
  const sourceCommit = resolvePluginSourceCommit(pluginRoot, manifest, options);
  if (!COMMIT.test(sourceCommit)) throw new Error("plugin source commit is invalid");

  const identityCommand = engineCommand(config, "PM loop canary identity probe", {
    workspacePath: projectDir,
  });
  const versionRunner = options.versionRunner || execFileSync;
  let binaryVersion;
  try {
    binaryVersion = String(
      versionRunner(identityCommand.bin, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "pipe"],
      })
    )
      .trim()
      .slice(0, 500);
  } catch (error) {
    throw new Error(`engine binary version is unavailable: ${error.message}`);
  }
  if (!binaryVersion) throw new Error("engine binary version is empty");
  const worker = config.worker || {};
  return {
    plugin_version: String(manifest.version || ""),
    source_commit: sourceCommit,
    execution_config_hash: executionConfigHash(config),
    engine: {
      kind: worker.engine_bin ? "custom" : worker.engine || config.default_runtime || "codex",
      binary_version: binaryVersion,
      argv_hash: sha256(
        JSON.stringify({ bin: identityCommand.bin, args: identityCommand.args || [] })
      ),
    },
  };
}

function resolvePluginSourceCommit(pluginRoot, manifest, options = {}) {
  const explicit = options.sourceCommit || process.env.PM_PLUGIN_SOURCE_COMMIT || "";
  if (COMMIT.test(explicit)) return explicit;
  const sourceGitRoot = findGitRoot(pluginRoot);
  if (sourceGitRoot) return runGit(["rev-parse", "HEAD"], sourceGitRoot);
  const candidates = options.marketplaceRoots || [
    path.join(os.homedir(), ".claude", "plugins", "marketplaces", String(manifest.name || "pm")),
    path.join(os.homedir(), ".agents", "vendor", String(manifest.name || "pm")),
  ];
  for (const candidate of candidates) {
    const gitRoot = findGitRoot(candidate);
    if (!gitRoot) continue;
    for (const revision of [`v${manifest.version}^{commit}`, "HEAD"]) {
      try {
        const commit = runGit(["rev-parse", revision], gitRoot);
        if (COMMIT.test(commit)) return commit;
      } catch {
        // Try the next canonical source location/revision.
      }
    }
  }
  throw new Error(
    "plugin source commit is unavailable; set PM_PLUGIN_SOURCE_COMMIT to the installed source commit"
  );
}

function evidenceIdentity(record) {
  return {
    plugin_version: record.plugin_version,
    source_commit: record.source_commit,
    execution_config_hash: record.execution_config_hash,
    engine: record.engine,
  };
}

function validateEvidenceRecord(record, caseName) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return "record is not an object";
  if (record.schema_version !== 1) return "schema_version must equal 1";
  if (record.case !== caseName || !CANARY_CASES.includes(record.case)) return "case mismatch";
  if (!record.started_at || !Number.isFinite(Date.parse(record.started_at)))
    return "started_at is invalid";
  if (!record.ended_at || !Number.isFinite(Date.parse(record.ended_at)))
    return "ended_at is invalid";
  if (typeof record.plugin_version !== "string" || !record.plugin_version)
    return "plugin_version is missing";
  if (!COMMIT.test(String(record.source_commit || ""))) return "source_commit is invalid";
  if (!SHA256.test(String(record.execution_config_hash || "")))
    return "execution_config_hash is invalid";
  if (!SHA256.test(String(record.exact_plan_fingerprint || "")))
    return "exact_plan_fingerprint is invalid";
  if (
    !record.engine ||
    typeof record.engine.kind !== "string" ||
    typeof record.engine.binary_version !== "string" ||
    !SHA256.test(String(record.engine.argv_hash || ""))
  ) {
    return "engine identity is invalid";
  }
  for (const key of ["before", "after", "worker_result", "ledger", "assertions"]) {
    if (!record[key] || typeof record[key] !== "object" || Array.isArray(record[key])) {
      return `${key} is missing`;
    }
  }
  if (record.passed !== true) return "case did not pass";
  return "";
}

function readCanaryEvidence(pmStateDir) {
  const root = canaryRoot(pmStateDir);
  const records = [];
  const invalid = [];
  if (!fs.existsSync(root)) return { records, invalid };
  for (const runEntry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) continue;
    const runDir = path.join(root, runEntry.name);
    for (const caseEntry of fs.readdirSync(runDir, { withFileTypes: true })) {
      if (!caseEntry.isFile() || caseEntry.isSymbolicLink() || !caseEntry.name.endsWith(".json")) {
        continue;
      }
      const filePath = path.join(runDir, caseEntry.name);
      const caseName = caseEntry.name.slice(0, -5);
      try {
        const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
        const error = validateEvidenceRecord(record, caseName);
        if (error) invalid.push({ file: filePath, reason: error });
        else records.push({ ...record, evidence_path: filePath });
      } catch (error) {
        invalid.push({ file: filePath, reason: error.message });
      }
    }
  }
  return { records, invalid };
}

function evaluateCanaryReleaseGate(pmStateDir, expectedIdentity, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeSeconds = Math.max(1, Number(options.maxAgeSeconds || 86400));
  const { records, invalid } = readCanaryEvidence(pmStateDir);
  if (invalid.length > 0) {
    return { passed: false, reason: `invalid canary evidence: ${invalid[0].reason}`, invalid };
  }
  const selected = [];
  for (const caseName of CANARY_CASES) {
    const candidates = records
      .filter((record) => record.case === caseName)
      .sort((a, b) => Date.parse(b.ended_at) - Date.parse(a.ended_at));
    if (candidates.length === 0) {
      return { passed: false, reason: `missing canary evidence for ${caseName}`, cases: selected };
    }
    const record = candidates[0];
    if (now.getTime() - Date.parse(record.ended_at) > maxAgeSeconds * 1000) {
      return { passed: false, reason: `stale canary evidence for ${caseName}`, cases: selected };
    }
    selected.push(record);
  }
  const firstIdentity = evidenceIdentity(selected[0]);
  if (selected.some((record) => !stableEqual(evidenceIdentity(record), firstIdentity))) {
    return { passed: false, reason: "mixed canary evidence identity", records: selected };
  }
  if (expectedIdentity && !stableEqual(firstIdentity, expectedIdentity)) {
    return {
      passed: false,
      reason: "canary evidence identity does not match current runtime",
      records: selected,
    };
  }
  return {
    passed: true,
    reason: "",
    identity: firstIdentity,
    cases: selected.map((record) => record.case),
    records: selected.map((record) => record.evidence_path),
  };
}

function directoryInventory(pmDir, child) {
  const root = path.join(pmDir, "loop", child);
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => {
      const filePath = path.join(root, entry.name);
      let value = null;
      try {
        value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        value = null;
      }
      return {
        path: path.posix.join("pm", "loop", child, entry.name),
        sha256: hashFile(filePath),
        value,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function findCard(pmDir, cardId, relativePath = "") {
  const candidates = [];
  if (relativePath) candidates.push(path.join(path.dirname(pmDir), ...relativePath.split("/")));
  const backlog = path.join(pmDir, "backlog");
  if (fs.existsSync(backlog)) {
    for (const entry of fs.readdirSync(backlog, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md"))
        candidates.push(path.join(backlog, entry.name));
    }
  }
  for (const filePath of [...new Set(candidates)]) {
    if (!fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) continue;
    const content = fs.readFileSync(filePath, "utf8");
    const data = parseFrontmatter(content).data || {};
    if (String(data.id || "") === String(cardId || "")) {
      return {
        relative_path: path.relative(path.dirname(pmDir), filePath).replace(/\\/g, "/"),
        sha256: sha256(content),
        status: String(data.status || ""),
        blocker_code: String(data.blocker_code || ""),
        blocker_remediation: String(data.blocker_remediation || ""),
      };
    }
  }
  return null;
}

function snapshotCanaryState(pmDir, cardId, relativePath = "", options = {}) {
  return withRemoteSnapshot(
    pmDir,
    (snapshot) => ({
      pm_head:
        snapshot.upstreamOid ||
        (snapshot.gitRoot ? runGit(["rev-parse", "HEAD"], snapshot.workspace) : ""),
      card: findCard(snapshot.pmDir, cardId, relativePath),
      leases: directoryInventory(snapshot.pmDir, "leases"),
      recovery: directoryInventory(snapshot.pmDir, "recovery"),
      events: directoryInventory(snapshot.pmDir, "events"),
    }),
    options
  );
}

function readLedger(workerResult) {
  const filePath = workerResult && workerResult.ledger;
  if (!filePath || !fs.existsSync(filePath) || fs.lstatSync(filePath).isSymbolicLink()) {
    return { path: filePath || "", sha256: "", value: null };
  }
  return {
    path: filePath,
    sha256: hashFile(filePath),
    value: JSON.parse(fs.readFileSync(filePath, "utf8")),
  };
}

function eventFor(after, runId) {
  return after.events.find((entry) => entry.path.endsWith(`/${runId}.json`)) || null;
}

function assertionsFor(caseName, context) {
  const { before, after, workerResult, ledger, config, preview } = context;
  const common = {
    exact_plan_preserved: workerResult.fingerprint === preview.fingerprint,
    exact_card_preserved:
      (workerResult.card?.id || workerResult.selected?.id) === preview.selected.id,
  };
  if (caseName === "preflight-failure") {
    return {
      ...common,
      worker_preflight_failed: workerResult.status === "preflight-failed",
      pm_head_unchanged: before.pm_head === after.pm_head,
      card_unchanged: stableEqual(before.card, after.card),
      leases_unchanged: stableEqual(before.leases, after.leases),
    };
  }
  if (caseName === "blocked-result") {
    return {
      ...common,
      worker_blocked: workerResult.status === "blocked",
      card_needs_human: after.card?.status === "needs-human",
      remediation_present: Boolean(after.card?.blocker_remediation),
      no_lease: after.leases.length === 0,
      durable_blocked_event: eventFor(after, workerResult.run_id)?.value?.status === "blocked",
      blocked_ledger: ledger.value?.status === "blocked",
    };
  }
  return {
    ...common,
    worker_completed: workerResult.status === "completed",
    card_shipping: after.card?.status === "shipping",
    no_lease: after.leases.length === 0,
    no_recovery: after.recovery.length === 0,
    durable_completed_event: eventFor(after, workerResult.run_id)?.value?.status === "completed",
    completed_ledger: ledger.value?.status === "completed",
    verified_open_pr:
      ledger.value?.artifact_verification?.pr?.ok === true &&
      ledger.value?.artifact_verification?.pr?.state === "OPEN",
    merge_disabled: config.autonomy?.merge_pr === false,
  };
}

function runCanary(projectDir, caseName, options = {}) {
  if (!CANARY_CASES.includes(caseName)) {
    throw new Error(`case must be exactly one of ${CANARY_CASES.join(", ")}`);
  }
  const paths = options.paths || resolvePmPaths(projectDir);
  const config = options.config || loadTrustedLoopConfig(paths.pmDir, paths.pmStateDir);
  if (caseName === "verified-pr" && config.autonomy?.merge_pr !== false) {
    throw new Error("verified-pr requires autonomy.merge_pr=false");
  }
  const execute = options.runWorker || runWorker;
  const preview = execute(projectDir, {
    pmDir: paths.pmDir,
    pmStateDir: paths.pmStateDir,
    dryRun: true,
  });
  if (!preview.selected || !SHA256.test(String(preview.fingerprint || ""))) {
    throw new Error("canary requires an exact eligible plan");
  }
  if (caseName === "verified-pr" && preview.selected.id !== options.card) {
    throw new Error(`verified-pr selected ${preview.selected.id}; expected --card ${options.card}`);
  }
  const cardId = preview.selected.id;
  const sourcePath = preview.selected.sourcePath || preview.selected.source_path || "";
  const relativePath = sourcePath
    ? path.relative(path.dirname(paths.pmDir), sourcePath).replace(/\\/g, "/")
    : preview.selected.relative_path || "";
  const startedAt = new Date().toISOString();
  const before = (options.snapshot || snapshotCanaryState)(paths.pmDir, cardId, relativePath);
  const workerResult = execute(projectDir, {
    pmDir: paths.pmDir,
    pmStateDir: paths.pmStateDir,
    mode: preview.selected.stage || "default",
  });
  const after = (options.snapshot || snapshotCanaryState)(paths.pmDir, cardId, relativePath);
  const ledger = readLedger(workerResult);
  const identity = options.identity || currentCanaryIdentity(projectDir, config, options);
  const assertions = assertionsFor(caseName, {
    before,
    after,
    workerResult,
    ledger,
    config,
    preview,
  });
  const passed = Object.values(assertions).every(Boolean);
  const evidenceRunId = workerResult.run_id || `loop-canary-${crypto.randomUUID()}`;
  const record = {
    schema_version: 1,
    case: caseName,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    ...identity,
    exact_plan_fingerprint: preview.fingerprint,
    before,
    after,
    worker_result: boundedJson(workerResult),
    ledger: { path: ledger.path, sha256: ledger.sha256 },
    assertions,
    passed,
  };
  const outputDir = path.join(canaryRoot(paths.pmStateDir), evidenceRunId);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);
  const outputPath = path.join(outputDir, `${caseName}.json`);
  writeJsonAtomic(outputPath, record);
  fs.chmodSync(outputPath, 0o600);
  return { ...record, evidence_path: outputPath };
}

function parseArgs(argv) {
  const { args, positionals } = parseCliArgs(argv, {
    "--project-dir": { key: "projectDir", type: "string" },
    "--case": { key: "caseName", type: "string" },
    "--card": { key: "card", type: "string" },
    "--no-merge": { key: "noMerge", type: "boolean" },
  });
  if (positionals.length > 0) throw new Error(`Unexpected argument: ${positionals[0]}`);
  if (!args.caseName) throw new Error("--case is required");
  if (!CANARY_CASES.includes(args.caseName)) {
    throw new Error(`case must be exactly one of ${CANARY_CASES.join(", ")}`);
  }
  if (args.caseName === "verified-pr" && !args.card) throw new Error("--card is required");
  if (args.caseName === "verified-pr" && !args.noMerge) throw new Error("--no-merge is required");
  if (args.caseName !== "verified-pr" && (args.card || args.noMerge)) {
    throw new Error("--card and --no-merge are only valid for verified-pr");
  }
  return {
    projectDir: path.resolve(args.projectDir || process.cwd()),
    caseName: args.caseName,
    card: args.card || "",
    noMerge: Boolean(args.noMerge),
  };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const record = runCanary(args.projectDir, args.caseName, args);
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    process.exit(record.passed ? 0 : 2);
  } catch (error) {
    process.stderr.write(`loop-canary: ${error.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  CANARY_CASES,
  currentCanaryIdentity,
  evaluateCanaryReleaseGate,
  parseArgs,
  readCanaryEvidence,
  resolvePluginSourceCommit,
  runCanary,
  snapshotCanaryState,
  validateEvidenceRecord,
};

if (require.main === module) main();
