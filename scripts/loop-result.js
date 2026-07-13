#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const {
  checkGateManifest,
  deriveSessionSlug,
  loadChangedFilesFromGit,
} = require("./dev-gate-check.js");
const { RUN_ID_PATTERN } = require("./loop-pm-transaction.js");
const { runGit } = require("./loop-git.js");
const { readBoundedRegularFile } = require("./loop-safe-file.js");
const { pathChainHasSymlink } = require("./worktree-bootstrap.js");
const { protectedSourcePaths } = require("./loop-protection.js");

const MAX_RESULT_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
const MAX_SUMMARY_LENGTH = 2000;
const MAX_GATE_COUNT = 16;
const MAX_GATE_LENGTH = 64;
const MAX_BLOCKER_CODE_LENGTH = 80;
const MAX_BLOCKER_REASON_LENGTH = 2000;
const MAX_REMEDIATION_LENGTH = 4000;
const MAX_PATH_LENGTH = 512;
const RESULT_FIELDS = new Set([
  "version",
  "run_id",
  "card_id",
  "stage",
  "status",
  "summary",
  "blocker",
  "artifacts",
  "gates",
  "usage",
  "retry_after",
]);
const STAGE_STATUSES = Object.freeze({
  dev: new Set(["shipped", "blocked", "failed", "noop"]),
  ship: new Set(["merged", "ready-for-human", "waiting", "blocked", "failed", "noop"]),
  review: new Set(["merged", "ready-for-human", "waiting", "blocked", "failed", "noop"]),
  rfc: new Set(["artifact-ready", "needs-approval", "blocked", "failed", "noop"]),
  research: new Set(["artifact-ready", "blocked", "failed", "noop"]),
});
const PR_REQUIRED = new Set(["shipped", "merged", "ready-for-human", "waiting"]);
const DOCUMENT_REQUIRED = new Set(["artifact-ready", "needs-approval"]);
const NO_ARTIFACT = new Set(["failed", "noop"]);
const MEDIA_TYPES = new Set(["text/markdown", "text/html", "application/json", "text/plain"]);
const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const SHA = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/i;

function failed(code, reason) {
  return { ok: false, status: "failed-contract", code, reason };
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, max, { allowEmpty = false } = {}) {
  return (
    typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0)
  );
}

function isIso(value) {
  if (typeof value !== "string" || value.length > 40) return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone, offsetHour, offsetMinute] = match;
  const numeric = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, min, sec] = numeric;
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) return false;
  if (h > 23 || min > 59 || sec > 59) return false;
  if (zone !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

function isSafeRelativePath(value) {
  if (!isBoundedString(value, MAX_PATH_LENGTH)) return false;
  const normalized = value.replace(/\\/g, "/");
  return (
    !path.posix.isAbsolute(normalized) &&
    normalized !== "." &&
    !normalized.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

function validateUsage(usage) {
  if (!isObject(usage)) return "usage must be an object";
  const keys = ["input_tokens", "output_tokens", "total_tokens"];
  if (Object.keys(usage).some((key) => !keys.includes(key))) {
    return "usage contains an unexpected field";
  }
  for (const key of keys) {
    if (!(key in usage)) return `usage.${key} is required`;
    if (usage[key] !== null && (!Number.isSafeInteger(usage[key]) || usage[key] < 0)) {
      return `usage.${key} must be null or a non-negative integer`;
    }
  }
  return "";
}

function validateBlocker(blocker) {
  if (!isObject(blocker)) return "blocked results require a blocker object";
  const allowed = new Set(["code", "reason", "remediation"]);
  if (Object.keys(blocker).some((key) => !allowed.has(key))) {
    return "blocker contains an unexpected field";
  }
  if (!isBoundedString(blocker.code, MAX_BLOCKER_CODE_LENGTH)) {
    return "blocker.code exceeds its string bound or is empty";
  }
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(blocker.code)) {
    return "blocker.code must be a lowercase kebab-case code";
  }
  if (!isBoundedString(blocker.reason, MAX_BLOCKER_REASON_LENGTH)) {
    return "blocker.reason exceeds its string bound or is empty";
  }
  if (!isBoundedString(blocker.remediation, MAX_REMEDIATION_LENGTH)) {
    return "blocker.remediation exceeds its string bound or is empty";
  }
  return "";
}

function validatePrArtifact(artifact, status) {
  if (!isObject(artifact) || artifact.type !== "pull-request") {
    return `${status} requires a pull-request artifact`;
  }
  const allowed = new Set([
    "type",
    "repo",
    "number",
    "url",
    "base",
    "head",
    "head_oid",
    "created_at",
    "merge_sha",
    "merged_at",
  ]);
  if (Object.keys(artifact).some((key) => !allowed.has(key))) {
    return "pull-request artifact contains an unexpected field";
  }
  if (!isBoundedString(artifact.repo, 201) || !REPOSITORY.test(artifact.repo)) {
    return "pull-request repo must be owner/name";
  }
  if (!Number.isSafeInteger(artifact.number) || artifact.number < 1) {
    return "pull-request number must be a positive integer";
  }
  if (!isBoundedString(artifact.url, 500)) return "pull-request url is required";
  let parsedUrl;
  try {
    parsedUrl = new URL(artifact.url);
  } catch {
    return "pull-request url must be an absolute HTTPS URL";
  }
  const urlSuffix = `/${artifact.repo}/pull/${artifact.number}`.toLowerCase();
  if (parsedUrl.protocol !== "https:" || !parsedUrl.pathname.toLowerCase().endsWith(urlSuffix)) {
    return "pull-request url does not match repo and number";
  }
  if (!isBoundedString(artifact.base, 201) || !SAFE_REF.test(artifact.base)) {
    return "pull-request base is invalid";
  }
  if (!isBoundedString(artifact.head, 201) || !SAFE_REF.test(artifact.head)) {
    return "pull-request head is invalid";
  }
  if (!isBoundedString(artifact.head_oid, 64) || !SHA.test(artifact.head_oid)) {
    return "pull-request head_oid is invalid";
  }
  if (!isIso(artifact.created_at)) return "pull-request created_at must be an ISO timestamp";
  if (status === "merged") {
    if (!isBoundedString(artifact.merge_sha, 64) || !SHA.test(artifact.merge_sha)) {
      return "merged pull-request artifact requires merge_sha";
    }
    if (!isIso(artifact.merged_at)) {
      return "merged pull-request artifact requires merged_at";
    }
  } else if (artifact.merge_sha !== undefined || artifact.merged_at !== undefined) {
    return `${status} must not include merge-only fields`;
  }
  return "";
}

function validateDocumentArtifact(artifact, stage) {
  if (!isObject(artifact) || artifact.type !== "document") {
    return `${stage} artifact result requires a document artifact`;
  }
  if (stage !== "rfc" && stage !== "research") return "document artifact kind is unsupported";
  const allowed = new Set(["type", "kind", "relative_path", "sha256", "media_type"]);
  if (Object.keys(artifact).some((key) => !allowed.has(key))) {
    return "document artifact contains an unexpected field";
  }
  if (artifact.kind !== stage) return `document artifact kind must match ${stage}`;
  if (!isSafeRelativePath(artifact.relative_path)) {
    return "document artifact relative_path is invalid";
  }
  if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))) {
    return "document artifact sha256 is invalid";
  }
  if (!MEDIA_TYPES.has(artifact.media_type)) return "document artifact media_type is invalid";
  const expectedMediaType = stage === "rfc" ? "text/html" : "text/markdown";
  const expectedExtension = stage === "rfc" ? ".html" : ".md";
  if (
    artifact.media_type !== expectedMediaType ||
    path.posix.extname(artifact.relative_path.toLowerCase()) !== expectedExtension
  ) {
    return `document artifact media_type and extension do not match ${stage}`;
  }
  return "";
}

function validateStageResult(candidate, context = {}) {
  if (!isObject(candidate)) return failed("result-invalid", "result must be an object");
  const unexpected = Object.keys(candidate).find((key) => !RESULT_FIELDS.has(key));
  if (unexpected) return failed("result-invalid", `unexpected field: ${unexpected}`);
  if (candidate.version !== 1) return failed("result-version", "version must equal 1");
  if (!RUN_ID_PATTERN.test(String(candidate.run_id || ""))) {
    return failed("result-run-id", "run_id is invalid");
  }
  if (candidate.run_id !== context.runId) return failed("result-mismatch", "run_id mismatch");
  if (!isBoundedString(candidate.card_id, 160)) {
    return failed("result-card-id", "card_id is missing or exceeds its string bound");
  }
  if (candidate.card_id !== context.cardId) return failed("result-mismatch", "card_id mismatch");
  if (!Object.hasOwn(STAGE_STATUSES, candidate.stage)) {
    return failed("result-stage", "stage is not supported");
  }
  if (candidate.stage !== context.stage) return failed("result-mismatch", "stage mismatch");
  if (!STAGE_STATUSES[candidate.stage].has(candidate.status)) {
    return failed(
      "result-status",
      `status ${JSON.stringify(candidate.status)} is not allowed for stage ${candidate.stage}`
    );
  }
  if (!isBoundedString(candidate.summary, MAX_SUMMARY_LENGTH)) {
    return failed("result-summary", "summary exceeds its string bound or is empty");
  }
  if (!Array.isArray(candidate.gates) || candidate.gates.length > MAX_GATE_COUNT) {
    return failed("result-gates", "gates exceeds its array bound or is not an array");
  }
  if (
    candidate.gates.some((gate) => !isBoundedString(gate, MAX_GATE_LENGTH)) ||
    new Set(candidate.gates).size !== candidate.gates.length
  ) {
    return failed("result-gates", "gates contains a duplicate or exceeds its string bound");
  }
  const usageError = validateUsage(candidate.usage);
  if (usageError) return failed("result-usage", usageError);

  if (candidate.status === "blocked") {
    const blockerError = validateBlocker(candidate.blocker);
    if (blockerError) return failed("result-blocker", blockerError);
  } else if (candidate.blocker !== undefined) {
    return failed("result-blocker", `blocker is not allowed for status ${candidate.status}`);
  }

  if (candidate.status === "blocked") {
    if (!["ship", "review"].includes(candidate.stage) && candidate.artifacts !== undefined) {
      return failed(
        "result-artifact",
        `artifacts are not allowed for ${candidate.stage} blocked results`
      );
    }
    if (candidate.artifacts !== undefined) {
      const artifactError = validatePrArtifact(candidate.artifacts, candidate.status);
      if (artifactError) return failed("result-artifact", artifactError);
    }
  } else if (PR_REQUIRED.has(candidate.status)) {
    const artifactError = validatePrArtifact(candidate.artifacts, candidate.status);
    if (artifactError) return failed("result-artifact", artifactError);
  } else if (DOCUMENT_REQUIRED.has(candidate.status)) {
    const artifactError = validateDocumentArtifact(candidate.artifacts, candidate.stage);
    if (artifactError) return failed("result-artifact", artifactError);
  } else if (NO_ARTIFACT.has(candidate.status) && candidate.artifacts !== undefined) {
    return failed("result-artifact", `artifacts are not allowed for status ${candidate.status}`);
  } else if (candidate.artifacts !== undefined) {
    return failed("result-artifact", `artifacts are not allowed for status ${candidate.status}`);
  }

  if (candidate.status === "waiting") {
    if (!isIso(candidate.retry_after)) {
      return failed("result-retry-after", "waiting requires an ISO retry_after");
    }
  } else if (candidate.retry_after !== undefined) {
    return failed("result-retry-after", `retry_after is not allowed for ${candidate.status}`);
  }

  return { ok: true, status: candidate.status, result: candidate };
}

function assertPrivateDirectory(dirPath) {
  const stat = fs.lstatSync(dirPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`private result path is not a real directory: ${dirPath}`);
  }
  fs.chmodSync(dirPath, 0o700);
}

function createRunResultCapability(pmStateDir, runId) {
  if (!RUN_ID_PATTERN.test(String(runId || ""))) throw new Error("invalid loop run id");
  if (fs.existsSync(pmStateDir)) {
    const stateStat = fs.lstatSync(pmStateDir);
    if (!stateStat.isDirectory() || stateStat.isSymbolicLink()) {
      throw new Error(
        `private result state root is a symlink or not a real directory: ${pmStateDir}`
      );
    }
  }
  fs.mkdirSync(pmStateDir, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(pmStateDir);
  const namespace = path.join(pmStateDir, "loop-results");
  fs.mkdirSync(namespace, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(namespace);
  const runDir = path.join(namespace, runId);
  fs.mkdirSync(runDir, { mode: 0o700 });
  assertPrivateDirectory(runDir);
  const resultFile = path.join(runDir, "result.json");
  const fd = fs.openSync(
    resultFile,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600
  );
  fs.closeSync(fd);
  return { runDir, resultFile };
}

function readStageResult(filePath, context) {
  const read = readBoundedRegularFile(filePath, MAX_RESULT_BYTES, "result");
  if (!read.ok) return read;
  if (read.content.length === 0) return failed("result-missing", "result file is empty");
  let parsed;
  try {
    parsed = JSON.parse(read.content.toString("utf8"));
  } catch (err) {
    return failed("result-malformed", `result JSON is malformed: ${err.message}`);
  }
  const checked = validateStageResult(parsed, context);
  if (!checked.ok) return checked;
  return {
    ...checked,
    sha256: crypto.createHash("sha256").update(read.content).digest("hex"),
    bytes: read.content.length,
  };
}

function writeStageResult(filePath, value, context) {
  const checked = validateStageResult(value, context);
  if (!checked.ok) return checked;
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (body.length > MAX_RESULT_BYTES) {
    return failed("result-too-large", `result exceeds ${MAX_RESULT_BYTES} bytes`);
  }
  let existing;
  try {
    existing = fs.lstatSync(filePath);
  } catch (err) {
    return failed("result-missing", `reserved result file is missing: ${err.message}`);
  }
  if (!existing.isFile() || existing.isSymbolicLink()) {
    return failed("result-unsafe-path", "reserved result path is not a regular file");
  }
  const tempPath = path.join(
    path.dirname(filePath),
    `.result.${process.pid}.${crypto.randomBytes(12).toString("hex")}.tmp`
  );
  let fd;
  try {
    fd = fs.openSync(
      tempPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600
    );
    fs.writeFileSync(fd, body);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, filePath);
    const dirFd = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY);
    fs.fsyncSync(dirFd);
    fs.closeSync(dirFd);
    return { ok: true, sha256: crypto.createHash("sha256").update(body).digest("hex") };
  } catch (err) {
    return failed("result-write-failed", `result atomic write failed: ${err.message}`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(tempPath, { force: true });
  }
}

function verifyDocumentArtifact(runDir, artifact) {
  const shapeError = validateDocumentArtifact(artifact, artifact && artifact.kind);
  if (shapeError) return failed("artifact-invalid", shapeError);
  const filePath = path.resolve(runDir, artifact.relative_path);
  const relative = path.relative(path.resolve(runDir), filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return failed("artifact-unsafe-path", "artifact path escapes the result directory");
  }
  if (pathChainHasSymlink(runDir, filePath)) {
    return failed("artifact-unsafe-path", "artifact path contains a symlink component");
  }
  const read = readBoundedRegularFile(filePath, MAX_DOCUMENT_BYTES, "artifact");
  if (!read.ok) return read;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(read.content);
    if (!Buffer.from(decoded, "utf8").equals(read.content)) {
      return failed("artifact-type-mismatch", "artifact is not canonical UTF-8 text");
    }
  } catch {
    return failed("artifact-type-mismatch", "artifact is not valid UTF-8 text");
  }
  const sha256 = crypto.createHash("sha256").update(read.content).digest("hex");
  if (sha256 !== artifact.sha256.toLowerCase()) {
    return failed("artifact-hash-mismatch", "artifact sha256 does not match its payload");
  }
  return { ok: true, filePath, content: read.content, sha256, bytes: read.content.length };
}

function verifyCommittedGateSidecar(workspace, options = {}) {
  return verifyCommittedGateSidecarWithChecker(workspace, options, checkGateManifest);
}

function verifyCommittedGateSidecarWithChecker(workspace, options, gateChecker) {
  let actualHead;
  try {
    actualHead = runGit(["rev-parse", "HEAD"], workspace, { timeout: 30_000 });
  } catch (err) {
    return failed("source-head-unreadable", `source HEAD could not be read: ${err.message}`);
  }
  if (!options.expectedHeadOid || actualHead !== options.expectedHeadOid) {
    return failed("source-head-mismatch", "workspace HEAD does not match the result head OID");
  }
  try {
    const branchHead = runGit(["rev-parse", "--verify", options.expectedHead], workspace, {
      timeout: 30_000,
    });
    if (branchHead !== options.expectedHeadOid) {
      return failed(
        "source-head-mismatch",
        "source branch does not resolve to the result head OID"
      );
    }
  } catch (err) {
    return failed("source-head-mismatch", `source branch could not be verified: ${err.message}`);
  }

  let trustedBase;
  try {
    trustedBase = /^[a-f0-9]{40,64}$/.test(options.baseRef || "")
      ? { ref: options.baseRef, commit: options.baseRef }
      : require("./review-target").resolveTrustedBase(workspace, options.remote || "origin");
    if (options.baseRef && options.baseRef !== trustedBase.ref)
      return failed(
        "source-base-mismatch",
        `source base ${options.baseRef} does not equal remote default ${trustedBase.ref}`
      );
  } catch (err) {
    return failed("source-base-unreadable", `authoritative remote base failed: ${err.message}`);
  }
  let changedFiles;
  try {
    changedFiles = loadChangedFilesFromGit(trustedBase.commit, workspace, options.expectedHeadOid);
  } catch (err) {
    return failed("source-diff-unreadable", `source diff could not be verified: ${err.message}`);
  }
  const protectedPaths = protectedSourcePaths(changedFiles);
  if (protectedPaths.length > 0) {
    return {
      ...failed(
        "protected-source-path-changed",
        `source change touches worker-owned paths: ${protectedPaths.join(", ")}`
      ),
      protectedPaths,
    };
  }

  const slug = deriveSessionSlug(options.expectedHead);
  const sessionRoot = path.join(workspace, ".pm", "dev-sessions");
  const canonicalSessionDir = path.join(sessionRoot, slug);
  const canonicalManifest = path.join(canonicalSessionDir, "gates.json");
  const manifestPath = options.manifestPath || canonicalManifest;
  if (path.resolve(manifestPath) !== path.resolve(canonicalManifest))
    return failed(
      "gate-sidecar-non-authoritative",
      "legacy gate sidecars are inspection-only; canonical gates.json is required"
    );
  if (!fs.existsSync(path.join(canonicalSessionDir, "session.json")))
    return failed("gate-session-missing", "canonical sibling session.json is required");
  const sessionRead = readBoundedRegularFile(
    path.join(canonicalSessionDir, "session.json"),
    MAX_RESULT_BYTES * 2,
    "gate-session",
    { requirePrivate: false }
  );
  if (!sessionRead.ok) return sessionRead;
  let canonicalSession;
  try {
    canonicalSession = JSON.parse(sessionRead.content.toString("utf8"));
  } catch (err) {
    return failed("gate-session-malformed", `canonical session is malformed: ${err.message}`);
  }
  const sessionIssues = require("./lib/dev-session-schema").validateSession(canonicalSession);
  if (sessionIssues.length > 0)
    return failed(
      "gate-session-invalid",
      sessionIssues
        .slice(0, 3)
        .map((item) => `${item.path}: ${item.message}`)
        .join("; ")
    );
  if (
    canonicalSession.source.delivery_remote &&
    canonicalSession.source.delivery_remote !== (options.remote || "origin")
  ) {
    return failed(
      "delivery-remote-mismatch",
      "delivery remote does not match the destination persisted before Review"
    );
  }
  if (pathChainHasSymlink(workspace, manifestPath)) {
    return failed("gate-sidecar-unsafe", "gate sidecar must be a bounded regular file");
  }
  const manifestRead = readBoundedRegularFile(manifestPath, MAX_RESULT_BYTES * 2, "gate-sidecar", {
    requirePrivate: false,
  });
  if (!manifestRead.ok) return manifestRead;
  let manifest;
  try {
    manifest = JSON.parse(manifestRead.content.toString("utf8"));
  } catch (err) {
    return failed("gate-sidecar-malformed", `gate sidecar is malformed: ${err.message}`);
  }
  if (!Array.isArray(manifest.gates) || manifest.gates.length > MAX_GATE_COUNT) {
    return failed(
      "gate-sidecar-invalid",
      `gate sidecar must contain at most ${MAX_GATE_COUNT} gate rows`
    );
  }
  const inspectedArtifacts = new Set();
  for (const gate of Array.isArray(manifest.gates) ? manifest.gates : []) {
    const raw = String(gate && gate.artifact ? gate.artifact : "")
      .split("#")[0]
      .trim();
    const artifactPath = raw && !path.isAbsolute(raw) ? path.resolve(workspace, raw) : "";
    const relativeArtifact = artifactPath ? path.relative(sessionRoot, artifactPath) : "";
    if (
      !raw ||
      raw.length > MAX_PATH_LENGTH ||
      !artifactPath ||
      !relativeArtifact ||
      relativeArtifact.startsWith("..") ||
      path.isAbsolute(relativeArtifact) ||
      pathChainHasSymlink(workspace, artifactPath)
    ) {
      return failed(
        "gate-artifact-unsafe",
        "gate artifacts must be relative regular files under .pm/dev-sessions"
      );
    }
    if (!inspectedArtifacts.has(artifactPath)) {
      inspectedArtifacts.add(artifactPath);
      const artifactRead = readBoundedRegularFile(
        artifactPath,
        MAX_DOCUMENT_BYTES,
        "gate-artifact",
        { requirePrivate: false, readContent: false }
      );
      if (!artifactRead.ok) return artifactRead;
    }
  }
  const checked = gateChecker(manifest, {
    currentCommit: options.expectedHeadOid,
    currentBranch: options.expectedHead,
    manifestPath,
    artifactRoot: workspace,
    changedFiles,
    reviewEvidenceMode: "enforce",
    canonicalSession,
    requireSessionBinding: true,
    authoritativeBaseRef: trustedBase.ref,
    authoritativeBaseCommit: trustedBase.commit,
    authoritativePushUrlSha256: trustedBase.remote_push_url_sha256 || null,
  });
  if (!checked.ok) {
    return {
      ...failed(
        "gate-verification-failed",
        checked.issues
          .map((entry) => entry.message)
          .join("; ")
          .slice(0, 4000)
      ),
      issues: checked.issues,
    };
  }
  return { ok: true, manifestPath, changedFiles, headOid: actualHead };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  MAX_RESULT_BYTES,
  STAGE_STATUSES,
  createRunResultCapability,
  readStageResult,
  validatePrArtifact,
  validateStageResult,
  verifyCommittedGateSidecar,
  verifyDocumentArtifact,
  writeStageResult,
  __test: { verifyCommittedGateSidecarWithChecker },
};
