#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { parseCliArgs } = require("./loop-args.js");
const {
  approveExecutionConfig,
  executionConfigHash,
  loadTrustedLoopConfig,
  normalizeLoopConfig,
  sha256,
  stableValue,
} = require("./loop-config.js");
const { canonicalEngineCommand } = require("./loop-engine.js");
const { findGitRoot, gitRelativePath, runGit, writeJsonAtomic } = require("./loop-git.js");
const { withRemoteSnapshot } = require("./loop-pm-transaction.js");
const { readBoundedRegularFile } = require("./loop-safe-file.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { parseFrontmatter } = require("./kb-frontmatter.js");

const CANARY_CASES = Object.freeze(["preflight-failure", "blocked-result", "verified-pr"]);
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_CANARY_EVIDENCE_BYTES = 512 * 1024;
const MAX_LEDGER_BYTES = 512 * 1024;
const RUNTIME_SOURCE_ENTRIES = Object.freeze([
  "plugin.config.json",
  "package.json",
  "package-lock.json",
  ".claude-plugin",
  ".codex-plugin",
  "agents",
  "commands",
  "hooks",
  "references",
  "scripts",
  "skills",
]);
const OPTIONAL_RUNTIME_SOURCE_ENTRIES = Object.freeze(["templates"]);
const REQUIRED_ASSERTIONS = Object.freeze({
  "preflight-failure": Object.freeze([
    "exact_plan_preserved",
    "exact_card_preserved",
    "engine_argv_pinned",
    "identity_unchanged",
    "worker_preflight_failed",
    "pm_head_unchanged",
    "card_unchanged",
    "leases_unchanged",
  ]),
  "blocked-result": Object.freeze([
    "exact_plan_preserved",
    "exact_card_preserved",
    "engine_argv_pinned",
    "identity_unchanged",
    "worker_blocked",
    "card_needs_human",
    "remediation_present",
    "no_lease",
    "durable_blocked_event",
    "blocked_ledger",
  ]),
  "verified-pr": Object.freeze([
    "exact_plan_preserved",
    "exact_card_preserved",
    "engine_argv_pinned",
    "identity_unchanged",
    "worker_completed",
    "card_shipping",
    "no_lease",
    "no_recovery",
    "durable_completed_event",
    "completed_ledger",
    "verified_open_pr",
    "merge_disabled",
  ]),
});

function canaryRoot(pmStateDir) {
  return path.join(pmStateDir, "loop-canary");
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function* directoryEntries(dirPath) {
  const directory = fs.opendirSync(dirPath);
  try {
    let entry;
    while ((entry = directory.readSync()) !== null) yield entry;
  } finally {
    directory.closeSync();
  }
}

function stableEqual(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function boundedJson(value, maxBytes = 64 * 1024) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) <= maxBytes) return value;
  return { truncated: true, sha256: sha256(text), bytes: Buffer.byteLength(text) };
}

function canonicalEngineArgv(config) {
  return canonicalEngineCommand(config);
}

function runtimeSourceHash(pluginRoot) {
  const records = [];
  const visit = (relativePath) => {
    const absolutePath = path.join(pluginRoot, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`runtime source contains a symbolic link: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolutePath).sort()) {
        visit(path.join(relativePath, entry));
      }
      return;
    }
    if (!stat.isFile()) throw new Error(`runtime source entry is not a file: ${relativePath}`);
    records.push([relativePath.replace(/\\/g, "/"), hashFile(absolutePath)]);
  };
  for (const entry of RUNTIME_SOURCE_ENTRIES) {
    if (!fs.existsSync(path.join(pluginRoot, entry))) {
      throw new Error(`runtime source entry is missing: ${entry}`);
    }
    visit(entry);
  }
  for (const entry of OPTIONAL_RUNTIME_SOURCE_ENTRIES) {
    if (fs.existsSync(path.join(pluginRoot, entry))) visit(entry);
  }
  return sha256(JSON.stringify(records));
}

function currentCanaryIdentity(config, options = {}) {
  const pluginRoot = options.pluginRoot || path.resolve(__dirname, "..");
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.config.json"), "utf8"));
  const sourceCommit = resolvePluginSourceCommit(pluginRoot, manifest, options);
  if (!COMMIT.test(sourceCommit)) throw new Error("plugin source commit is invalid");

  const identityCommand = canonicalEngineArgv(config);
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
    runtime_source_hash: options.runtimeSourceHash || runtimeSourceHash(pluginRoot),
    execution_config_hash: config.execution_config_hash || executionConfigHash(config),
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
    runtime_source_hash: record.runtime_source_hash,
    execution_config_hash: record.execution_config_hash,
    engine: record.engine,
  };
}

function validInventory(value, kind) {
  const records = value?.records;
  const paths = Array.isArray(records) ? records.map((entry) => entry?.path) : [];
  const prefix = `pm/loop/${kind}/`;
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isSafeInteger(value.count) &&
    value.count >= 0 &&
    Array.isArray(records) &&
    records.length <= value.count &&
    SHA256.test(String(value.sha256 || "")) &&
    new Set(paths).size === paths.length &&
    records.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof entry.path === "string" &&
        entry.path.startsWith(prefix) &&
        entry.path.slice(prefix.length).length > 0 &&
        !entry.path.slice(prefix.length).includes("/") &&
        path.posix.normalize(entry.path) === entry.path &&
        SHA256.test(String(entry.sha256 || ""))
    )
  );
}

function validState(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    COMMIT.test(String(value.pm_head || "")) &&
    value.card &&
    typeof value.card.relative_path === "string" &&
    value.card.relative_path.length > 0 &&
    SHA256.test(String(value.card.sha256 || "")) &&
    typeof value.card.status === "string" &&
    validInventory(value.leases, "leases") &&
    validInventory(value.recovery, "recovery") &&
    validInventory(value.events, "events")
  );
}

function eventStatus(record, status) {
  const runId = record.worker_result?.run_id;
  return record.after.events.records.some(
    (entry) => entry.value?.run_id === runId && entry.value?.status === status
  );
}

function validateEvidenceRecord(record, caseName, options = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record))
    return "record is not an object";
  if (record.schema_version !== 1) return "schema_version must equal 1";
  if (record.case !== caseName || !CANARY_CASES.includes(record.case)) return "case mismatch";
  const startedAt = Date.parse(record.started_at || "");
  const endedAt = Date.parse(record.ended_at || "");
  if (!Number.isFinite(startedAt)) return "started_at is invalid";
  if (!Number.isFinite(endedAt)) return "ended_at is invalid";
  if (startedAt > endedAt) return "evidence timestamps are not chronological";
  const now = options.now instanceof Date ? options.now : new Date();
  if (endedAt > now.getTime() + CLOCK_SKEW_MS) return "ended_at is in the future";
  if (typeof record.plugin_version !== "string" || !record.plugin_version)
    return "plugin_version is missing";
  if (!COMMIT.test(String(record.source_commit || ""))) return "source_commit is invalid";
  if (!SHA256.test(String(record.runtime_source_hash || "")))
    return "runtime source identity is invalid";
  if (!SHA256.test(String(record.execution_config_hash || "")))
    return "execution_config_hash is invalid";
  if (!SHA256.test(String(record.exact_plan_fingerprint || "")))
    return "exact_plan_fingerprint is invalid";
  if (
    !SHA256.test(String(record.exact_plan_config_hash || "")) ||
    record.exact_plan_config_hash !== record.execution_config_hash
  ) {
    return "exact plan configuration identity is invalid";
  }
  if (
    !record.engine ||
    typeof record.engine.kind !== "string" ||
    typeof record.engine.binary_version !== "string" ||
    !SHA256.test(String(record.engine.argv_hash || ""))
  ) {
    return "engine identity is invalid";
  }
  for (const key of ["before", "after"]) {
    if (!validState(record[key])) return `${key} state is incomplete`;
  }
  if (
    !record.worker_result ||
    typeof record.worker_result !== "object" ||
    Array.isArray(record.worker_result) ||
    !SHA256.test(String(record.worker_result.fingerprint || "")) ||
    record.worker_result.fingerprint !== record.exact_plan_fingerprint ||
    typeof (record.worker_result.card?.id || record.worker_result.selected?.id) !== "string" ||
    !(record.worker_result.card?.id || record.worker_result.selected?.id)
  ) {
    return "worker_result is incomplete";
  }
  if (!record.ledger || typeof record.ledger !== "object" || Array.isArray(record.ledger)) {
    return "ledger is missing";
  }
  if (
    caseName !== "preflight-failure" &&
    (typeof record.ledger.path !== "string" ||
      !record.ledger.path ||
      !SHA256.test(String(record.ledger.sha256 || "")))
  ) {
    return "ledger identity is incomplete";
  }
  if (
    !record.assertions ||
    typeof record.assertions !== "object" ||
    Array.isArray(record.assertions)
  ) {
    return "assertions are missing";
  }
  const allowFailed = options.allowFailed === true && record.passed === false;
  for (const key of REQUIRED_ASSERTIONS[caseName]) {
    if (allowFailed) {
      if (typeof record.assertions[key] !== "boolean") {
        return `required assertion ${key} is missing`;
      }
    } else if (record.assertions[key] !== true) {
      return `required assertion ${key} did not pass`;
    }
  }
  if (allowFailed) return "";
  if (caseName === "preflight-failure") {
    if (record.worker_result.status !== "preflight-failed")
      return "worker preflight state is invalid";
    if (
      record.before.pm_head !== record.after.pm_head ||
      !stableEqual(record.before.card, record.after.card) ||
      !stableEqual(record.before.leases, record.after.leases)
    ) {
      return "preflight evidence mutated protected PM state";
    }
  } else if (caseName === "blocked-result") {
    if (
      record.worker_result.status !== "blocked" ||
      record.after.card.status !== "needs-human" ||
      !record.after.card.blocker_remediation ||
      record.after.leases.count !== 0 ||
      !eventStatus(record, "blocked")
    ) {
      return "blocked-result state transition is invalid";
    }
  } else if (
    record.worker_result.status !== "completed" ||
    record.after.card.status !== "shipping" ||
    record.after.leases.count !== 0 ||
    record.after.recovery.count !== 0 ||
    !eventStatus(record, "completed")
  ) {
    return "verified-pr state transition is invalid";
  }
  if (record.passed !== true) return "case did not pass";
  return "";
}

function readCanaryEvidence(pmStateDir, options = {}) {
  const root = canaryRoot(pmStateDir);
  const records = [];
  const invalid = [];
  const maxEntries = Number.isSafeInteger(options.maxEntries) ? options.maxEntries : 1000;
  let scannedEntries = 0;
  let invalidCount = 0;
  const recordInvalid = (value) => {
    invalidCount += 1;
    if (invalid.length < 10) invalid.push(value);
  };
  if (!fs.existsSync(root)) return { records, invalid, invalid_count: invalidCount };
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    recordInvalid({ file: root, reason: "canary evidence root is not a real directory" });
    return { records, invalid, invalid_count: invalidCount };
  }
  evidence: for (const runEntry of directoryEntries(root)) {
    scannedEntries += 1;
    if (scannedEntries > maxEntries) {
      recordInvalid({ file: root, reason: `canary evidence scan limit exceeded (${maxEntries})` });
      break;
    }
    if (!runEntry.isDirectory() || runEntry.isSymbolicLink()) {
      recordInvalid({ file: path.join(root, runEntry.name), reason: "invalid canary run entry" });
      continue;
    }
    const runDir = path.join(root, runEntry.name);
    for (const caseEntry of directoryEntries(runDir)) {
      scannedEntries += 1;
      if (scannedEntries > maxEntries) {
        recordInvalid({
          file: root,
          reason: `canary evidence scan limit exceeded (${maxEntries})`,
        });
        break evidence;
      }
      if (!caseEntry.isFile() || caseEntry.isSymbolicLink() || !caseEntry.name.endsWith(".json")) {
        recordInvalid({
          file: path.join(runDir, caseEntry.name),
          reason: "invalid canary case entry",
        });
        continue;
      }
      const filePath = path.join(runDir, caseEntry.name);
      const caseName = caseEntry.name.slice(0, -5);
      try {
        const read = readBoundedRegularFile(filePath, MAX_CANARY_EVIDENCE_BYTES, "canary evidence");
        if (!read.ok) throw new Error(read.reason);
        const record = JSON.parse(read.content.toString("utf8"));
        const error = validateEvidenceRecord(record, caseName, { ...options, allowFailed: true });
        if (error) recordInvalid({ file: filePath, reason: error });
        else records.push({ ...record, evidence_path: filePath });
      } catch (error) {
        recordInvalid({ file: filePath, reason: error.message });
      }
    }
  }
  return {
    records,
    invalid,
    invalid_count: invalidCount,
  };
}

function evaluateCanaryReleaseGate(pmStateDir, expectedIdentity, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const maxAgeSeconds = Math.max(1, Number(options.maxAgeSeconds || 86400));
  const {
    records,
    invalid,
    invalid_count: invalidCount,
  } = readCanaryEvidence(pmStateDir, {
    now,
    latestOnly: true,
    maxEntries: options.maxEvidenceEntries,
  });
  if (invalidCount > 0) {
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
    const latestTime = Date.parse(candidates[0].ended_at);
    const latestCandidates = candidates.filter(
      (candidate) => Date.parse(candidate.ended_at) === latestTime
    );
    const canonical = latestCandidates.map((candidate) => {
      const copy = { ...candidate };
      delete copy.evidence_path;
      return copy;
    });
    if (canonical.some((candidate) => !stableEqual(candidate, canonical[0]))) {
      return {
        passed: false,
        reason: `conflicting latest canary evidence timestamp for ${caseName}`,
        cases: selected,
      };
    }
    const record = latestCandidates.sort((left, right) =>
      String(left.evidence_path).localeCompare(String(right.evidence_path))
    )[0];
    if (record.passed !== true) {
      return { passed: false, reason: `failed canary evidence for ${caseName}`, cases: selected };
    }
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

function evaluateCurrentCanaryReleaseGate(pmStateDir, config, options = {}) {
  const identity = currentCanaryIdentity(config, options);
  return evaluateCanaryReleaseGate(pmStateDir, identity, {
    now: options.now,
    maxAgeSeconds: config.canary.evidence_ttl_seconds,
  });
}

function directoryInventory(pmDir, child, options = {}) {
  const root = path.join(pmDir, "loop", child);
  const entries = [];
  const budget = options.budget || { scanned: 0, maxEntries: 10_000 };
  if (fs.existsSync(root)) {
    for (const entry of directoryEntries(root)) {
      budget.scanned += 1;
      if (budget.scanned > budget.maxEntries) {
        throw new Error(`canary state inventory scan limit exceeded (${budget.maxEntries})`);
      }
      if (entry.isFile() && !entry.isSymbolicLink()) entries.push(entry);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
  }
  let treeIdentity = entries.map((entry) => entry.name).join("\n");
  const gitRoot = findGitRoot(pmDir);
  if (gitRoot && fs.existsSync(root)) {
    try {
      const relative = gitRelativePath(gitRoot, root).replace(/\\/g, "/");
      treeIdentity = runGit(["rev-parse", `HEAD:${relative}`], gitRoot);
    } catch {
      // Filename identity still gives deterministic fail-closed comparison.
    }
  }
  const records = [];
  if (options.runId) {
    const entry = entries.find((candidate) => candidate.name === `${options.runId}.json`);
    if (entry) {
      const filePath = path.join(root, entry.name);
      let value = null;
      try {
        value = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        value = null;
      }
      records.push({
        path: path.posix.join("pm", "loop", child, entry.name),
        sha256: hashFile(filePath),
        value,
      });
    }
  }
  return { count: entries.length, sha256: sha256(treeIdentity), records };
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
  const inventoryBudget = {
    scanned: 0,
    maxEntries: Number.isSafeInteger(options.maxInventoryEntries)
      ? options.maxInventoryEntries
      : 10_000,
  };
  return withRemoteSnapshot(
    pmDir,
    (snapshot) => ({
      pm_head:
        snapshot.upstreamOid ||
        (snapshot.gitRoot ? runGit(["rev-parse", "HEAD"], snapshot.workspace) : ""),
      card: findCard(snapshot.pmDir, cardId, relativePath),
      leases: directoryInventory(snapshot.pmDir, "leases", { budget: inventoryBudget }),
      recovery: directoryInventory(snapshot.pmDir, "recovery", { budget: inventoryBudget }),
      events: directoryInventory(snapshot.pmDir, "events", {
        runId: options.runId || "",
        budget: inventoryBudget,
      }),
    }),
    options
  );
}

function readLedger(workerResult) {
  const filePath = workerResult && workerResult.ledger;
  if (!filePath) {
    return { path: filePath || "", sha256: "", value: null };
  }
  const read = readBoundedRegularFile(filePath, MAX_LEDGER_BYTES, "canary ledger", {
    requirePrivate: false,
  });
  if (!read.ok) return { path: filePath, sha256: "", value: null };
  const content = read.content;
  return {
    path: filePath,
    sha256: sha256(content),
    value: JSON.parse(content.toString("utf8")),
  };
}

function eventFor(after, runId) {
  return after.events.records.find((entry) => entry.path.endsWith(`/${runId}.json`)) || null;
}

function executedEngineIdentity(config, workerResult, ledger) {
  const recorded = ledger.value?.engine;
  if (!recorded || typeof recorded.bin !== "string" || !Array.isArray(recorded.args)) {
    return canonicalEngineArgv(config);
  }
  return canonicalEngineCommand(config, recorded, { resultDir: workerResult.result_dir || "" });
}

function assertionsFor(caseName, context) {
  const { before, after, workerResult, ledger, config, preview, identity, identityUnchanged } =
    context;
  const invocation = executedEngineIdentity(config, workerResult, ledger);
  const common = {
    exact_plan_preserved: workerResult.fingerprint === preview.fingerprint,
    exact_card_preserved:
      (workerResult.card?.id || workerResult.selected?.id) === preview.selected.id,
    engine_argv_pinned:
      sha256(JSON.stringify(invocation)) === String(identity.engine?.argv_hash || ""),
    identity_unchanged: identityUnchanged,
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
      no_lease: after.leases.count === 0,
      durable_blocked_event: eventFor(after, workerResult.run_id)?.value?.status === "blocked",
      blocked_ledger: ledger.value?.status === "blocked",
    };
  }
  return {
    ...common,
    worker_completed: workerResult.status === "completed",
    card_shipping: after.card?.status === "shipping",
    no_lease: after.leases.count === 0,
    no_recovery: after.recovery.count === 0,
    durable_completed_event: eventFor(after, workerResult.run_id)?.value?.status === "completed",
    completed_ledger: ledger.value?.status === "completed",
    verified_open_pr:
      ledger.value?.artifact_verification?.pr?.ok === true &&
      ledger.value?.artifact_verification?.pr?.state === "OPEN",
    merge_disabled: config.autonomy?.merge_pr === false,
  };
}

function fixtureCard(caseName) {
  const id = caseName === "preflight-failure" ? "PM-CANARY-PREFLIGHT" : "PM-CANARY-BLOCKED";
  return {
    id,
    body: [
      "---",
      `id: ${id}`,
      `title: ${caseName} supervised canary fixture`,
      "kind: task",
      "status: ready",
      "implementation_approved: true",
      "approved_by: supervised-canary",
      "approved_at: 2026-07-10",
      "---",
      "",
      caseName === "blocked-result"
        ? "This supervised fixture has an intentional external blocker. Do not modify source or open a pull request. Return a structured blocked result with clear remediation."
        : "Exercise the loop preflight failure contract in this disposable fixture only.",
      "",
    ].join("\n"),
  };
}

function createFixtureCanary(projectDir, caseName, config) {
  const sourceGitRoot = findGitRoot(projectDir);
  if (!sourceGitRoot) throw new Error("fixture canary requires a Git-backed source project");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pm-loop-canary-${caseName}-`));
  const sourceOrigin = path.join(root, "source-origin.git");
  const project = path.join(root, "source");
  const pmOrigin = path.join(root, "pm-origin.git");
  const pmProject = path.join(root, "pm-project");
  try {
    const sourceCommit = runGit(["rev-parse", "HEAD"], sourceGitRoot);
    runGit(["init", "--bare", "--initial-branch=main", sourceOrigin], root);
    runGit(["fetch", sourceGitRoot, `${sourceCommit}:refs/heads/main`], sourceOrigin);
    runGit(["symbolic-ref", "HEAD", "refs/heads/main"], sourceOrigin);
    runGit(["clone", "--no-hardlinks", sourceOrigin, project], root);
    runGit(["remote", "set-url", "origin", sourceOrigin], project);
    // GitHub Actions checks out a shallow synthetic merge ref. Pin the
    // disposable clone's remote-tracking base explicitly instead of relying
    // on clone's remote-HEAD inference from that source topology.
    runGit(["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"], project);
    runGit(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], project);
    runGit(["config", "user.email", "pm-canary@example.invalid"], project);
    runGit(["config", "user.name", "PM Supervised Canary"], project);
    runGit(["init", "--bare", "--initial-branch=main", pmOrigin], root);
    runGit(["clone", pmOrigin, pmProject], root);
    runGit(["config", "user.email", "pm-canary@example.invalid"], pmProject);
    runGit(["config", "user.name", "PM Supervised Canary"], pmProject);
    const pmDir = path.join(pmProject, "pm");
    const pmStateDir = path.join(root, ".pm");
    fs.mkdirSync(path.join(pmDir, "backlog"), { recursive: true });
    fs.mkdirSync(path.join(pmDir, "loop"), { recursive: true });
    const card = fixtureCard(caseName);
    fs.writeFileSync(path.join(pmDir, "backlog", `${card.id.toLowerCase()}.md`), card.body);
    const rawConfig = { ...config };
    delete rawConfig.execution_config_hash;
    const fixtureConfig = normalizeLoopConfig(rawConfig);
    fs.writeFileSync(
      path.join(pmDir, "loop", "config.json"),
      `${JSON.stringify(fixtureConfig, null, 2)}\n`
    );
    runGit(["add", "-A"], pmProject);
    runGit(["commit", "-m", `${caseName} supervised canary fixture`], pmProject);
    runGit(["push", "origin", "main"], pmProject);
    runGit(["symbolic-ref", "HEAD", "refs/heads/main"], pmOrigin);
    approveExecutionConfig(pmStateDir, fixtureConfig);
    return {
      projectDir: project,
      paths: { pmDir, pmStateDir },
      cardId: card.id,
      cleanup() {
        fs.rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function fixtureWorkerOptions(caseName) {
  if (caseName === "preflight-failure") {
    return {
      runProbe() {
        return { status: 2, stderr: "supervised fixture engine-probe failure" };
      },
    };
  }
  return {};
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
  const execute = options.runWorker || require("./loop-worker.js").runWorker;
  const identity = options.identity || currentCanaryIdentity(config, options);
  const fixture =
    caseName === "verified-pr"
      ? null
      : (options.fixtureFactory || createFixtureCanary)(projectDir, caseName, config);
  const executionProject = fixture?.projectDir || projectDir;
  const executionPaths = fixture?.paths || paths;
  const requestedCard = caseName === "verified-pr" ? options.card : fixture?.cardId || "";
  try {
    const commonWorkerOptions = {
      pmDir: executionPaths.pmDir,
      pmStateDir: executionPaths.pmStateDir,
      cardId: requestedCard,
      ...fixtureWorkerOptions(caseName),
    };
    const preview = execute(executionProject, { ...commonWorkerOptions, dryRun: true });
    if (!preview.selected || !SHA256.test(String(preview.fingerprint || ""))) {
      throw new Error("canary requires an exact eligible plan");
    }
    if (requestedCard && preview.selected.id !== requestedCard) {
      throw new Error(`canary selected ${preview.selected.id}; expected --card ${requestedCard}`);
    }
    const cardId = preview.selected.id;
    const sourcePath = preview.selected.sourcePath || preview.selected.source_path || "";
    const relativePath = sourcePath
      ? path.relative(path.dirname(executionPaths.pmDir), sourcePath).replace(/\\/g, "/")
      : preview.selected.relative_path || "";
    const startedAt = new Date().toISOString();
    const snapshot = options.snapshot || snapshotCanaryState;
    const before = snapshot(executionPaths.pmDir, cardId, relativePath);
    const workerResult = execute(executionProject, {
      ...commonWorkerOptions,
      mode: preview.selected.stage || "default",
    });
    const after = snapshot(executionPaths.pmDir, cardId, relativePath, {
      runId: workerResult.run_id || "",
    });
    const ledger = readLedger(workerResult);
    const identityAfter = options.identity || currentCanaryIdentity(config, options);
    const identityUnchanged = stableEqual(identity, identityAfter);
    const assertions = assertionsFor(caseName, {
      before,
      after,
      workerResult,
      ledger,
      config,
      preview,
      identity,
      identityUnchanged,
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
      exact_plan_config_hash:
        preview.fingerprint_input?.execution_config_hash || identity.execution_config_hash,
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
  } finally {
    fixture?.cleanup();
  }
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
  canonicalEngineArgv,
  createFixtureCanary,
  currentCanaryIdentity,
  directoryInventory,
  evaluateCurrentCanaryReleaseGate,
  evaluateCanaryReleaseGate,
  parseArgs,
  readCanaryEvidence,
  resolvePluginSourceCommit,
  runtimeSourceHash,
  runCanary,
  snapshotCanaryState,
  validateEvidenceRecord,
};

if (require.main === module) main();
