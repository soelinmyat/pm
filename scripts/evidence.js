#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseCliArgs } = require("./loop-args");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");
const {
  auditEvidence,
  createEvidenceRecord,
  emptyEvidenceLedger,
  migrateLegacyEvidenceRecord,
  refreshEvidence,
  registerEvidence,
  validateCitationBindings,
  validateEvidenceLedger,
} = require("./lib/evidence-schema");

const EXIT = Object.freeze({ OK: 0, INVALID: 2, CONFLICT: 3 });
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

function main(argv = process.argv.slice(2)) {
  try {
    const { command, options } = parse(argv);
    const result = run(command, options);
    emit(options, result);
    return EXIT.OK;
  } catch (error) {
    if (error.code === "EVIDENCE_CONFLICT") {
      const options = error.options || {};
      const artifact = preserveConflict(options, error.request);
      emit(options, {
        ok: false,
        code: error.code,
        reason: error.message,
        conflict_artifact: artifact,
      });
      return EXIT.CONFLICT;
    }
    process.stderr.write(`evidence: ${error.message}\n`);
    return EXIT.INVALID;
  }
}

function parse(argv) {
  const command = argv[0];
  if (!command || command.startsWith("--")) throw new Error("command is required");
  const parsed = parseCliArgs(argv.slice(1), {
    "--pm-dir": { type: "string" },
    "--private-dir": { type: "string" },
    "--request": { type: "string" },
    "--artifact": { type: "string" },
    "--now": { type: "string" },
    "--json": { type: "boolean" },
  });
  if (parsed.positionals.length > 0)
    throw new Error(`unexpected argument: ${parsed.positionals[0]}`);
  return { command, options: parsed.args };
}

function run(command, options) {
  if (!options.pmDir) throw new Error("--pm-dir is required");
  const pmDir = path.resolve(options.pmDir);
  const ledgerPath = path.join(pmDir, "evidence", "provenance.json");
  if (command === "register" || command === "migrate" || command === "refresh") {
    if (!options.request) throw new Error("--request is required");
    const request = readJson(path.resolve(options.request), "request");
    const release = acquireOwnedLock(`${ledgerPath}.lock`, {
      attempts: 200,
      waitMs: 25,
      invalidGraceMs: 1000,
      timeoutMessage: "timed out waiting for evidence ledger lock",
    });
    try {
      const ledger = readLedger(ledgerPath, options.now);
      let result;
      if (command === "register" || command === "migrate") {
        const migrated =
          command === "migrate"
            ? migrateLegacyEvidenceRecord(request, { now: options.now })
            : { request, private_record: null };
        const evidenceRecord = createEvidenceRecord(migrated.request, { now: options.now });
        result = registerEvidence(ledger, evidenceRecord, {
          now: options.now,
        });
        if (options.privateDir) {
          writePrivateRecord(
            options.privateDir,
            evidenceRecord,
            migrated.request,
            migrated.private_record
          );
        } else if (command === "migrate") {
          throw new Error("--private-dir is required for legacy migration");
        }
      } else {
        try {
          if (options.artifact)
            assertObservedArtifact(resolveEvidenceArtifact(pmDir, options.artifact), request);
          result = refreshEvidence(ledger, request, { now: options.now });
        } catch (error) {
          error.options = options;
          error.request = request;
          throw error;
        }
      }
      writeJsonAtomic(ledgerPath, result.ledger, { fileMode: 0o644 });
      return {
        ok: true,
        decision: result.decision,
        evidence_id: result.evidence_id,
        ledger: relative(pmDir, ledgerPath),
      };
    } finally {
      release();
    }
  }
  const ledger = readLedger(ledgerPath, options.now, { requireExisting: true });
  if (command === "validate") {
    const issues = validateEvidenceLedger(ledger);
    if (options.artifact) {
      const artifactPath = resolveEvidenceArtifact(pmDir, options.artifact);
      const relativeArtifact = relative(pmDir, artifactPath);
      issues.push(
        ...validateCitationBindings({
          markdown: readBoundedRegularFile(artifactPath, "artifact", MAX_ARTIFACT_BYTES),
          ledger,
          artifactPath: relativeArtifact,
        })
      );
    }
    if (issues.length > 0) throw new Error(`validation failed: ${issues.join("; ")}`);
    return { ok: true, issues: [] };
  }
  if (command === "audit") return { ok: true, audit: auditEvidence(ledger, { now: options.now }) };
  throw new Error(`unknown command: ${command}`);
}

function assertObservedArtifact(artifactPath, request) {
  if (!fs.existsSync(artifactPath)) {
    const error = new Error(`artifact was not found: ${artifactPath}`);
    error.code = "EVIDENCE_CONFLICT";
    throw error;
  }
  if (typeof request.observed_artifact_sha256 !== "string") {
    throw new Error("observed_artifact_sha256 is required when --artifact is provided");
  }
  const bytes = readBoundedRegularFile(artifactPath, "artifact", MAX_ARTIFACT_BYTES, null);
  const actual = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
  if (actual !== request.observed_artifact_sha256) {
    const error = new Error(
      `observed artifact hash ${request.observed_artifact_sha256} does not match current ${actual}`
    );
    error.code = "EVIDENCE_CONFLICT";
    throw error;
  }
}

function writePrivateRecord(privateDir, record, request, migration) {
  const body = {
    schema_version: 2,
    evidence_id: record.evidence_id,
    local_source_path: request.local_source_path || null,
    raw_locator: request.raw_locator || null,
    content: request.content || null,
    portable_record: record,
    migration: migration || null,
  };
  writeJsonAtomic(
    path.join(path.resolve(privateDir), "evidence", "records", `${record.evidence_id}.json`),
    body,
    { directoryMode: 0o700, fileMode: 0o600 }
  );
}

function readLedger(ledgerPath, now, options = {}) {
  if (!fs.existsSync(ledgerPath)) {
    if (options.requireExisting) throw new Error(`evidence ledger does not exist: ${ledgerPath}`);
    return emptyEvidenceLedger(now);
  }
  return readJson(ledgerPath, "evidence ledger");
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readBoundedRegularFile(filePath, label, MAX_JSON_BYTES));
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
}

function preserveConflict(options, request) {
  if (!options.privateDir)
    throw new Error("--private-dir is required to preserve refresh conflicts");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nonce = crypto.randomBytes(6).toString("hex");
  const relativePath = path.join(
    "evidence",
    "conflicts",
    `${request.evidence_id}-${timestamp}-${nonce}.json`
  );
  writeJsonAtomic(path.join(path.resolve(options.privateDir), relativePath), request, {
    directoryMode: 0o700,
    fileMode: 0o600,
  });
  return relativePath.split(path.sep).join("/");
}

function resolveEvidenceArtifact(pmDir, value) {
  const artifactPath = path.resolve(value);
  const relativePath = relative(pmDir, artifactPath);
  if (!relativePath.startsWith("evidence/") || relativePath.split("/").includes("..")) {
    throw new Error("--artifact must resolve inside the PM evidence directory");
  }
  return artifactPath;
}

function readBoundedRegularFile(filePath, label, maxBytes, encoding = "utf8") {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (stat.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} bytes`);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== stat.size)
      throw new Error(`${label} changed while reading`);
    return fs.readFileSync(descriptor, encoding === null ? undefined : { encoding });
  } finally {
    fs.closeSync(descriptor);
  }
}

function relative(pmDir, filePath) {
  return path.relative(pmDir, filePath).split(path.sep).join("/");
}

function emit(options, value) {
  process.stdout.write(
    options.json ? `${JSON.stringify(value, null, 2)}\n` : `${value.ok ? "OK" : value.code}\n`
  );
}

if (require.main === module) process.exitCode = main();

module.exports = { main, run };
