"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

const SCHEMA_VERSION = 2;
const HASH = /^sha256:[a-f0-9]{64}$/;
const EVIDENCE_ID = /^ev_[a-f0-9]{24}$/;
const SOURCE_TYPES = new Set([
  "note",
  "interview",
  "support",
  "sales",
  "feedback",
  "web",
  "competitor",
  "research",
  "unknown",
]);
const SOURCE_FORMATS = new Set([
  "md",
  "txt",
  "csv",
  "json",
  "audio",
  "html",
  "api",
  "observation",
  "unknown",
]);
const PRIVACY = new Set(["public", "internal", "customer-sensitive", "restricted"]);
const PII_REVIEW = new Set(["not-required", "pending", "reviewed"]);
const STAGES = new Set(["captured", "normalized", "synthesized"]);
const STALENESS_DAYS = Object.freeze({
  seo: 30,
  profile: 60,
  sentiment: 60,
  landscape: 90,
  features: 90,
  api: 90,
  topic: 90,
  "customer-evidence": 180,
  note: 365,
  unknown: 90,
});
const FRESHNESS_KINDS = new Set(Object.keys(STALENESS_DAYS));
const LEDGER_FIELDS = new Set(["schema_version", "updated_at", "records"]);
const RECORD_FIELDS = new Set([
  "evidence_id",
  "source_type",
  "source_label",
  "source_format",
  "freshness_kind",
  "locator",
  "captured_at",
  "content_sha256",
  "privacy",
  "transformation",
  "artifact_paths",
  "revisions",
  "created_at",
  "updated_at",
]);
const PRIVACY_FIELDS = new Set(["classification", "pii_review"]);
const TRANSFORMATION_FIELDS = new Set(["stage", "parents", "method"]);
const REVISION_FIELDS = new Set(["content_sha256", "captured_at", "replaced_at"]);

function normalizeIdentityPart(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function deriveEvidenceId(input) {
  const identity = [
    normalizeIdentityPart(input.source_type, "source_type"),
    normalizeIdentityPart(input.source_label, "source_label"),
    normalizeIdentityPart(input.locator, "locator"),
  ].join("\u001f");
  return `ev_${crypto.createHash("sha256").update(identity).digest("hex").slice(0, 24)}`;
}

function contentHash(input) {
  if (typeof input.content_sha256 === "string") {
    if (!HASH.test(input.content_sha256)) throw new Error("content_sha256 is invalid");
    return input.content_sha256;
  }
  if (typeof input.content !== "string") {
    throw new Error("content or content_sha256 is required");
  }
  return `sha256:${crypto.createHash("sha256").update(input.content).digest("hex")}`;
}

function createEvidenceRecord(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("evidence input must be an object");
  }
  const now = options.now || new Date().toISOString();
  const record = {
    evidence_id: input.evidence_id || deriveEvidenceId(input),
    source_type: normalizeIdentityPart(input.source_type, "source_type"),
    source_label: input.source_label?.trim(),
    source_format: normalizeIdentityPart(input.source_format || "unknown", "source_format"),
    freshness_kind: input.freshness_kind || defaultFreshnessKind(input.source_type),
    locator: input.locator?.trim(),
    captured_at: input.captured_at,
    content_sha256: contentHash(input),
    privacy: structuredClone(input.privacy || {}),
    transformation: structuredClone(input.transformation || {}),
    artifact_paths: normalizeArtifactPaths(input),
    revisions: [],
    created_at: now,
    updated_at: now,
  };
  const issues = validateEvidenceRecord(record, new Set());
  const nonParentIssues = issues.filter((issue) => !issue.includes("unknown parent"));
  if (nonParentIssues.length > 0)
    throw new Error(`invalid evidence record: ${nonParentIssues.join("; ")}`);
  return record;
}

function emptyEvidenceLedger(now = new Date().toISOString()) {
  return { schema_version: SCHEMA_VERSION, updated_at: now, records: [] };
}

function registerEvidence(ledger, record, options = {}) {
  assertLedger(ledger);
  const now = options.now || new Date().toISOString();
  const candidate = structuredClone(record);
  const candidateIssues = validateEvidenceRecord(
    candidate,
    new Set(ledger.records.map((item) => item.evidence_id))
  );
  const relevantIssues = candidateIssues.filter((issue) => !issue.includes("unknown parent"));
  if (relevantIssues.length > 0)
    throw new Error(`invalid evidence record: ${relevantIssues.join("; ")}`);
  const next = structuredClone(ledger);
  const index = next.records.findIndex((item) => item.evidence_id === candidate.evidence_id);
  let decision;
  if (index === -1) {
    next.records.push(candidate);
    decision = "created";
  } else if (next.records[index].content_sha256 === candidate.content_sha256) {
    const current = next.records[index];
    const artifactPaths = unionArtifactPaths(current.artifact_paths, candidate.artifact_paths);
    if (artifactPaths.length === current.artifact_paths.length) {
      decision = "unchanged";
    } else {
      current.artifact_paths = artifactPaths;
      current.updated_at = now;
      decision = "bound";
    }
  } else {
    const current = next.records[index];
    candidate.created_at = current.created_at;
    candidate.artifact_paths = unionArtifactPaths(current.artifact_paths, candidate.artifact_paths);
    candidate.revisions = [
      ...current.revisions,
      revisionFrom(current, now),
      ...candidate.revisions,
    ];
    candidate.updated_at = now;
    next.records[index] = candidate;
    decision = "revised";
  }
  next.records.sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  next.updated_at = now;
  const issues = validateEvidenceLedger(next);
  if (issues.length > 0) throw new Error(`invalid evidence ledger: ${issues.join("; ")}`);
  return { ledger: next, decision, evidence_id: candidate.evidence_id };
}

function refreshEvidence(ledger, request, options = {}) {
  assertLedger(ledger);
  const next = structuredClone(ledger);
  const index = next.records.findIndex((item) => item.evidence_id === request.evidence_id);
  if (index === -1) throw evidenceError("EVIDENCE_NOT_FOUND", "evidence record was not found");
  const current = next.records[index];
  if (request.observed_content_sha256 !== current.content_sha256) {
    throw evidenceError(
      "EVIDENCE_CONFLICT",
      `observed content hash ${request.observed_content_sha256} does not match current ${current.content_sha256}`
    );
  }
  const nextHash = contentHash(request);
  if (nextHash === current.content_sha256) {
    return { ledger: next, decision: "unchanged", evidence_id: current.evidence_id };
  }
  const now = options.now || new Date().toISOString();
  current.revisions.push(revisionFrom(current, now));
  current.content_sha256 = nextHash;
  current.captured_at = request.captured_at || now;
  current.updated_at = now;
  if (request.artifact_path !== undefined || request.artifact_paths !== undefined) {
    current.artifact_paths = unionArtifactPaths(
      current.artifact_paths,
      normalizeArtifactPaths(request)
    );
  }
  next.updated_at = now;
  const issues = validateEvidenceLedger(next);
  if (issues.length > 0) throw new Error(`invalid evidence ledger: ${issues.join("; ")}`);
  return { ledger: next, decision: "refreshed", evidence_id: current.evidence_id };
}

function revisionFrom(record, replacedAt) {
  return {
    content_sha256: record.content_sha256,
    captured_at: record.captured_at,
    replaced_at: replacedAt,
  };
}

function validateEvidenceLedger(ledger) {
  const issues = [];
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) {
    return ["ledger must be an object"];
  }
  issues.push(...unknownFieldIssues(ledger, LEDGER_FIELDS, "ledger"));
  if (ledger.schema_version !== SCHEMA_VERSION)
    issues.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (!isIso(ledger.updated_at)) issues.push("updated_at must be an ISO timestamp");
  if (!Array.isArray(ledger.records)) return [...issues, "records must be an array"];
  const ids = new Set();
  ledger.records.forEach((record, index) => {
    if (ids.has(record.evidence_id)) issues.push(`records[${index}] duplicates evidence_id`);
    ids.add(record.evidence_id);
  });
  ledger.records.forEach((record, index) => {
    for (const issue of validateEvidenceRecord(record, ids))
      issues.push(`records[${index}] ${issue}`);
  });
  return issues;
}

function validateEvidenceRecord(record, knownIds) {
  const issues = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["must be an object"];
  issues.push(...unknownFieldIssues(record, RECORD_FIELDS, "record"));
  if (!EVIDENCE_ID.test(record.evidence_id || "")) issues.push("evidence_id is invalid");
  if (!SOURCE_TYPES.has(record.source_type)) issues.push("source_type is invalid");
  if (!SOURCE_FORMATS.has(record.source_format)) issues.push("source_format is invalid");
  if (!FRESHNESS_KINDS.has(record.freshness_kind)) issues.push("freshness_kind is invalid");
  if (!isPortableLabel(record.source_label))
    issues.push("source_label must be portable and relative");
  if (!isPortableLocator(record.locator))
    issues.push("locator must be portable and must not contain a local absolute path");
  if (
    typeof record.source_type === "string" &&
    typeof record.source_label === "string" &&
    typeof record.locator === "string"
  ) {
    try {
      if (record.evidence_id !== deriveEvidenceId(record))
        issues.push("evidence_id has derived identity drift");
    } catch {
      // The required-field issues above are more actionable.
    }
  }
  if (!isIso(record.captured_at)) issues.push("captured_at must be an ISO timestamp");
  if (!HASH.test(record.content_sha256 || "")) issues.push("content_sha256 is invalid");
  if (!PRIVACY.has(record.privacy?.classification))
    issues.push("privacy classification is invalid");
  if (!PII_REVIEW.has(record.privacy?.pii_review)) issues.push("PII review state is invalid");
  if (record.privacy && typeof record.privacy === "object" && !Array.isArray(record.privacy)) {
    issues.push(...unknownFieldIssues(record.privacy, PRIVACY_FIELDS, "privacy"));
  }
  if (
    ["customer-sensitive", "restricted"].includes(record.privacy?.classification) &&
    record.privacy?.pii_review === "not-required"
  ) {
    issues.push("customer-sensitive or restricted evidence requires PII review");
  }
  if (!STAGES.has(record.transformation?.stage)) issues.push("transformation stage is invalid");
  if (
    record.transformation &&
    typeof record.transformation === "object" &&
    !Array.isArray(record.transformation)
  ) {
    issues.push(
      ...unknownFieldIssues(record.transformation, TRANSFORMATION_FIELDS, "transformation")
    );
  }
  if (!Array.isArray(record.transformation?.parents)) {
    issues.push("transformation parents must be an array");
  } else {
    const parents = new Set();
    for (const parent of record.transformation.parents) {
      if (!EVIDENCE_ID.test(parent)) issues.push("transformation parent is invalid");
      else if (!knownIds.has(parent)) issues.push(`transformation has unknown parent ${parent}`);
      if (parent === record.evidence_id) issues.push("transformation cannot parent itself");
      if (parents.has(parent)) issues.push("transformation parents must be unique");
      parents.add(parent);
    }
  }
  if (typeof record.transformation?.method !== "string" || !record.transformation.method.trim()) {
    issues.push("transformation method is required");
  }
  if (!Array.isArray(record.artifact_paths)) {
    issues.push("artifact_paths must be an array");
  } else {
    const paths = new Set();
    for (const artifactPath of record.artifact_paths) {
      if (!isEvidenceArtifactPath(artifactPath)) {
        issues.push("artifact_paths entries must be relative evidence/ paths");
      }
      if (paths.has(artifactPath)) issues.push("artifact_paths must be unique");
      paths.add(artifactPath);
    }
  }
  if (!Array.isArray(record.revisions)) issues.push("revisions must be an array");
  else {
    const hashes = new Set();
    record.revisions.forEach((revision, index) => {
      if (revision && typeof revision === "object" && !Array.isArray(revision)) {
        issues.push(...unknownFieldIssues(revision, REVISION_FIELDS, `revision[${index}]`));
      }
      if (!HASH.test(revision?.content_sha256 || ""))
        issues.push(`revision[${index}] hash is invalid`);
      if (!isIso(revision?.captured_at)) issues.push(`revision[${index}] captured_at is invalid`);
      if (!isIso(revision?.replaced_at)) issues.push(`revision[${index}] replaced_at is invalid`);
      if (hashes.has(revision?.content_sha256))
        issues.push(`revision[${index}] duplicates a revision hash`);
      if (revision?.content_sha256 === record.content_sha256)
        issues.push(`revision[${index}] duplicates the current content hash`);
      hashes.add(revision?.content_sha256);
    });
  }
  if (!isIso(record.created_at)) issues.push("created_at must be an ISO timestamp");
  if (!isIso(record.updated_at)) issues.push("updated_at must be an ISO timestamp");
  return issues;
}

function validateCitationBindings({ markdown, ledger, artifactPath }) {
  const issues = validateEvidenceLedger(ledger);
  if (issues.length > 0) return issues.map((issue) => `ledger ${issue}`);
  if (typeof markdown !== "string") return ["markdown is required"];
  if (!/\bprovenance_version:\s*2\b/.test(markdown)) return [];
  const records = new Map(ledger.records.map((record) => [record.evidence_id, record]));
  const citations = [...markdown.matchAll(/\[evidence:(ev_[a-f0-9]{24})\]/g)].map(
    (match) => match[1]
  );
  const isNotesArtifact = /(?:^|\n)type:\s*notes\s*(?:\n|$)/.test(markdown);
  if (isNotesArtifact) {
    citations.push(
      ...[...markdown.matchAll(/^Evidence-ID:\s*(ev_[a-f0-9]{24})\s*$/gm)].map((match) => match[1])
    );
    for (const section of markdown.split(/(?=^### )/m).filter((value) => /^### /.test(value))) {
      if (!/^Evidence-ID:\s*ev_[a-f0-9]{24}\s*$/m.test(section)) {
        issues.push("note entry is missing an Evidence-ID");
      }
    }
  }
  for (const id of citations) {
    const record = records.get(id);
    if (!record) issues.push(`unknown evidence ID ${id}`);
    else if (artifactPath && !record.artifact_paths.includes(artifactPath)) {
      issues.push(`evidence ID ${id} is not bound to artifact ${artifactPath}`);
    }
  }
  const findingSection =
    markdown.match(/(?:^|\n)## Findings\s*\n([\s\S]*?)(?=\n## |$)/i)?.[1] || "";
  for (const line of findingSection.split(/\r?\n/)) {
    if (/^\s*(?:[-*]|\d+[.)])\s+\S/.test(line) && !/\[evidence:ev_[a-f0-9]{24}\]/.test(line)) {
      issues.push("finding is missing an evidence citation");
    }
  }
  return issues;
}

function auditEvidence(ledger, options = {}) {
  const issues = validateEvidenceLedger(ledger);
  if (issues.length > 0) throw new Error(`invalid evidence ledger: ${issues.join("; ")}`);
  const now = Date.parse(options.now || new Date().toISOString());
  const thresholds = { ...STALENESS_DAYS, ...(options.thresholds || {}) };
  return {
    schema_version: 1,
    audited_at: new Date(now).toISOString(),
    records: ledger.records.map((record) => {
      const ageDays = Math.max(0, Math.floor((now - Date.parse(record.captured_at)) / 86400000));
      const thresholdDays = thresholds[record.freshness_kind] ?? thresholds.unknown;
      return {
        evidence_id: record.evidence_id,
        freshness_kind: record.freshness_kind,
        content_sha256: record.content_sha256,
        artifact_paths: [...record.artifact_paths],
        observed_at: record.captured_at,
        threshold_days: thresholdDays,
        age_days: ageDays,
        state:
          ageDays > thresholdDays
            ? "stale"
            : ageDays > Math.floor(thresholdDays * 0.75)
              ? "aging"
              : "fresh",
      };
    }),
  };
}

function migrateLegacyEvidenceRecord(legacy, options = {}) {
  if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
    throw new TypeError("legacy evidence record must be an object");
  }
  const sourcePath = legacy.source_path || legacy.raw_ref?.file;
  if (typeof sourcePath !== "string" || !sourcePath.trim()) {
    throw new Error("legacy source_path or raw_ref.file is required");
  }
  const sourceType = legacy.source_type === "notes" ? "feedback" : legacy.source_type || "unknown";
  const locatorParts = [];
  if (legacy.raw_ref?.row !== undefined) locatorParts.push(`row:${legacy.raw_ref.row}`);
  if (legacy.raw_ref?.section) locatorParts.push(`section:${legacy.raw_ref.section}`);
  if (legacy.timestamp) locatorParts.push(`timestamp:${legacy.timestamp}`);
  const locator = locatorParts.join("|") || `legacy:${legacy.id || "record"}`;
  const content = [legacy.topic, legacy.pain_point, legacy.summary, legacy.quote]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
  if (!content) throw new Error("legacy record has no normalized content");
  const captured =
    legacy.imported_at || legacy.event_date || options.now || new Date().toISOString();
  const capturedAt = new Date(captured).toISOString();
  const sourceFormat = normalizeLegacyFormat(legacy.source_format, sourcePath);
  const request = {
    source_type: SOURCE_TYPES.has(sourceType) ? sourceType : "unknown",
    source_label: path.basename(sourcePath),
    source_format: sourceFormat,
    locator,
    captured_at: capturedAt,
    content,
    privacy: options.privacy || {
      classification: "customer-sensitive",
      pii_review: "pending",
    },
    transformation: {
      stage: "normalized",
      parents: [],
      method: "pm:ingest legacy-v1 migration",
    },
    artifact_paths:
      options.artifact_paths || (options.artifact_path ? [options.artifact_path] : []),
  };
  return {
    request,
    private_record: {
      schema_version: SCHEMA_VERSION,
      migrated_from: "ingest-normalized-v1",
      legacy_id: legacy.id || null,
      local_source_path: sourcePath,
      raw_ref: structuredClone(legacy.raw_ref || null),
      normalized: structuredClone(legacy),
    },
  };
}

function normalizeLegacyFormat(value, sourcePath) {
  if (SOURCE_FORMATS.has(value)) return value;
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  return SOURCE_FORMATS.has(extension) ? extension : "unknown";
}

function normalizeArtifactPaths(input) {
  const values =
    input.artifact_paths !== undefined
      ? input.artifact_paths
      : input.artifact_path !== undefined && input.artifact_path !== null
        ? [input.artifact_path]
        : [];
  if (!Array.isArray(values)) throw new Error("artifact_paths must be an array");
  return unionArtifactPaths([], values);
}

function unionArtifactPaths(left, right) {
  return [...new Set([...(left || []), ...(right || [])])].sort();
}

function defaultFreshnessKind(sourceType) {
  if (sourceType === "note") return "note";
  if (["interview", "support", "sales", "feedback"].includes(sourceType)) {
    return "customer-evidence";
  }
  return "topic";
}

function isPortableLabel(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 240) return false;
  const label = value.trim();
  if (hasControlCharacter(label)) return false;
  if (path.posix.isAbsolute(label) || path.win32.isAbsolute(label) || label.startsWith("~"))
    return false;
  return !label.split(/[\\/]/).includes("..");
}

function isPortableLocator(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 500) return false;
  const locator = value.trim();
  if (hasControlCharacter(locator)) return false;
  if (
    path.posix.isAbsolute(locator) ||
    path.win32.isAbsolute(locator) ||
    locator.startsWith("~") ||
    /^file:/i.test(locator)
  ) {
    return false;
  }
  return !locator.split(/[\\/]/).includes("..");
}

function isEvidenceArtifactPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  ) {
    return false;
  }
  const normalized = value.replaceAll("\\", "/");
  return (
    !hasControlCharacter(normalized) &&
    normalized.startsWith("evidence/") &&
    !normalized.split("/").includes("..")
  );
}

function unknownFieldIssues(value, allowed, label) {
  return Object.keys(value)
    .filter((key) => !allowed.has(key))
    .map((key) => `${label} contains unknown field ${key}`);
}

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isIso(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function assertLedger(ledger) {
  const issues = validateEvidenceLedger(ledger);
  if (issues.length > 0) throw new Error(`invalid evidence ledger: ${issues.join("; ")}`);
}

function evidenceError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  SCHEMA_VERSION,
  STALENESS_DAYS,
  auditEvidence,
  createEvidenceRecord,
  deriveEvidenceId,
  emptyEvidenceLedger,
  migrateLegacyEvidenceRecord,
  refreshEvidence,
  registerEvidence,
  validateCitationBindings,
  validateEvidenceLedger,
};
