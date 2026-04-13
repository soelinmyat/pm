#!/usr/bin/env node
// pm validate — checks pm/ artifact integrity
// Usage: node validate.js --dir <pm-directory>

"use strict";

const fs = require("fs");
const path = require("path");
const {
  inspectKbPath,
  isIsoDate,
  normalizeKbPath,
  parseFrontmatter,
} = require("./kb-frontmatter.js");

// ========== Config ==========

const VALID_STATUSES = ["idea", "drafted", "proposed", "planned", "in-progress", "done"];
const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const VALID_EVIDENCE = ["strong", "moderate", "weak"];
const VALID_SCOPE = ["small", "medium", "large"];
const VALID_GAP = ["unique", "partial", "parity", "behind"];

const LEGACY_BACKLOG_TYPES = ["backlog-issue", "proposal", "idea", "notes"];
const VALID_COMPETITOR_TYPES = [
  "competitor-profile",
  "competitor-features",
  "competitor-sentiment",
  "competitor-api",
  "competitor-seo",
];
const REQUIRED_COMPETITOR_FIELDS = ["type", "company", "slug", "profiled", "sources"];

const VALID_MEMORY_CATEGORIES = ["scope", "research", "review", "process", "quality"];
const VALID_INSIGHT_STATUSES = ["active", "stale", "draft"];
const VALID_CONFIDENCE = ["high", "medium", "low"];
const VALID_SOURCE_ORIGINS = ["internal", "external", "mixed"];
const VALID_LOG_ACTIONS = new Set(["create", "update", "move", "delete", "cite", "uncite", "skip"]);

const REQUIRED_BACKLOG_FIELDS = [
  "type",
  "id",
  "title",
  "outcome",
  "status",
  "priority",
  "created",
  "updated",
];
const REQUIRED_STRATEGY_FIELDS = ["type", "created", "updated"];
const REQUIRED_INSIGHT_FIELDS = [
  "type",
  "domain",
  "topic",
  "last_updated",
  "status",
  "confidence",
  "sources",
];
const REQUIRED_EVIDENCE_FIELDS = [
  "type",
  "evidence_type",
  "source_origin",
  "created",
  "sources",
  "cited_by",
];
const REQUIRED_NOTES_FIELDS = ["type", "month", "updated", "note_count", "digested_through"];
const REQUIRED_THINKING_FIELDS = ["type", "topic", "slug", "created", "updated", "status"];
const VALID_THINKING_STATUSES = ["active", "parked", "promoted"];

// ========== Forbidden-syntax pattern ==========
// Rejects enum values with trailing parenthetical free text, e.g. "high (needs review)"
const FORBIDDEN_ENUM_PATTERN = /\(.*\)/;

function validateEnum(relativeFile, field, value, validValues, errors) {
  if (!value) return;
  if (FORBIDDEN_ENUM_PATTERN.test(value)) {
    pushIssue(
      errors,
      relativeFile,
      field,
      `forbidden syntax in "${value}" — enum values must not contain parenthetical content`
    );
    return;
  }
  if (!validValues.includes(value)) {
    pushIssue(
      errors,
      relativeFile,
      field,
      `invalid ${field} "${value}" — valid: ${validValues.join(", ")}`
    );
  }
}

// ========== Helpers ==========

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function walkMarkdownFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(entryPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

function pushIssue(list, file, field, msg) {
  list.push({ file, field, msg });
}

function relativeToPm(pmDir, filePath) {
  return toPosix(path.relative(pmDir, filePath));
}

function readParsedFrontmatter(filePath, relativeFile, errors) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) {
    pushIssue(errors, relativeFile, "-", "no YAML frontmatter found");
    return null;
  }
  return parsed;
}

function folderEvidenceType(folderName) {
  if (folderName === "transcripts") {
    return "transcript";
  }
  return folderName;
}

function extractFirstSegment(relativeFile, rootSegment) {
  const parts = relativeFile.split("/");
  const rootIndex = parts.indexOf(rootSegment);
  if (rootIndex === -1 || parts.length <= rootIndex + 1) {
    return "";
  }
  return parts[rootIndex + 1];
}

function validateRequiredFields(relativeFile, data, requiredFields, errors) {
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null) {
      pushIssue(errors, relativeFile, field, `missing required field "${field}"`);
    }
  }
}

function validateArrayField(relativeFile, field, value, errors) {
  if (!Array.isArray(value)) {
    pushIssue(errors, relativeFile, field, `expected "${field}" to be an array`);
    return false;
  }
  return true;
}

function validateBacklogItem(filePath, data, errors, warnings) {
  const rel = path.basename(filePath);

  validateRequiredFields(rel, data, REQUIRED_BACKLOG_FIELDS, errors);

  // Type validation: "backlog" is canonical, legacy values produce warnings
  if (data.type) {
    if (data.type === "backlog") {
      // canonical — no action
    } else if (LEGACY_BACKLOG_TYPES.includes(data.type)) {
      pushIssue(warnings, rel, "type", `type "${data.type}" is deprecated, use "backlog"`);
    } else {
      pushIssue(
        errors,
        rel,
        "type",
        `invalid backlog type "${data.type}" — expected "backlog" (or legacy: ${LEGACY_BACKLOG_TYPES.join(", ")})`
      );
    }
  }

  // Labels validation: must be a non-empty array when present
  if (data.labels !== undefined && data.labels !== null) {
    if (!Array.isArray(data.labels) || data.labels.length === 0) {
      pushIssue(errors, rel, "labels", "labels must be a non-empty array");
    }
  }

  if (data.id && !/^[A-Z]+-\d+$/.test(data.id)) {
    pushIssue(
      errors,
      rel,
      "id",
      `invalid ID format "${data.id}" — expected TEAM-NNN (e.g., PM-036, CLE-123)`
    );
  }

  validateEnum(rel, "status", data.status, VALID_STATUSES, errors);
  validateEnum(rel, "priority", data.priority, VALID_PRIORITIES, errors);
  validateEnum(rel, "evidence_strength", data.evidence_strength, VALID_EVIDENCE, errors);
  validateEnum(rel, "scope_signal", data.scope_signal, VALID_SCOPE, errors);
  validateEnum(rel, "competitor_gap", data.competitor_gap, VALID_GAP, errors);

  for (const field of ["created", "updated"]) {
    if (data[field] && !isIsoDate(data[field])) {
      pushIssue(errors, rel, field, `invalid date format "${data[field]}" — expected YYYY-MM-DD`);
    }
  }
}

function validateStrategy(filePath, data, errors) {
  const rel = path.basename(filePath);
  validateRequiredFields(rel, data, REQUIRED_STRATEGY_FIELDS, errors);

  if (data.type && data.type !== "strategy") {
    pushIssue(errors, rel, "type", `expected "strategy", got "${data.type}"`);
  }

  for (const field of ["created", "updated"]) {
    if (data[field] && !isIsoDate(data[field])) {
      pushIssue(errors, rel, field, `invalid date format "${data[field]}" — expected YYYY-MM-DD`);
    }
  }
}

function validateInsightFile(pmDir, filePath, data, errors, kbState) {
  const relativeFile = relativeToPm(pmDir, filePath);
  if (data.type !== "insight") {
    return;
  }

  validateRequiredFields(relativeFile, data, REQUIRED_INSIGHT_FIELDS, errors);

  if (data.type && data.type !== "insight") {
    pushIssue(errors, relativeFile, "type", `expected "insight", got "${data.type}"`);
  }

  if (data.domain && !/^[a-z0-9-]+$/.test(data.domain)) {
    pushIssue(errors, relativeFile, "domain", `invalid domain "${data.domain}"`);
  }

  const expectedDomain = extractFirstSegment(relativeFile, "insights");
  if (data.domain && expectedDomain && data.domain !== expectedDomain) {
    pushIssue(
      errors,
      relativeFile,
      "domain",
      `expected domain "${expectedDomain}" from folder, got "${data.domain}"`
    );
  }

  validateEnum(relativeFile, "status", data.status, VALID_INSIGHT_STATUSES, errors);
  validateEnum(relativeFile, "confidence", data.confidence, VALID_CONFIDENCE, errors);

  if (data.last_updated && !isIsoDate(data.last_updated)) {
    pushIssue(
      errors,
      relativeFile,
      "last_updated",
      `invalid date format "${data.last_updated}" — expected YYYY-MM-DD`
    );
  }

  if (validateArrayField(relativeFile, "sources", data.sources, errors)) {
    for (const source of data.sources) {
      const inspected = inspectKbPath(source);
      if (!inspected.ok) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `invalid path "${source}" (${inspected.reason})`
        );
        continue;
      }
      if (inspected.legacyPrefix) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `canonical KB paths must not include "pm/" prefix: "${source}"`
        );
        continue;
      }
      if (!inspected.value.startsWith("evidence/")) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `insight sources must target evidence paths, got "${source}"`
        );
      }
    }
  }

  kbState.insights.set(relativeFile, data);
}

function validateEvidenceFile(pmDir, filePath, data, errors, kbState) {
  const relativeFile = relativeToPm(pmDir, filePath);

  validateRequiredFields(relativeFile, data, REQUIRED_EVIDENCE_FIELDS, errors);

  if (data.type && data.type !== "evidence") {
    pushIssue(errors, relativeFile, "type", `expected "evidence", got "${data.type}"`);
  }

  const expectedType = folderEvidenceType(extractFirstSegment(relativeFile, "evidence"));
  if (data.evidence_type && expectedType && data.evidence_type !== expectedType) {
    pushIssue(
      errors,
      relativeFile,
      "evidence_type",
      `expected evidence_type "${expectedType}" from folder, got "${data.evidence_type}"`
    );
  }

  validateEnum(relativeFile, "source_origin", data.source_origin, VALID_SOURCE_ORIGINS, errors);

  if (data.created && !isIsoDate(data.created)) {
    pushIssue(
      errors,
      relativeFile,
      "created",
      `invalid date format "${data.created}" — expected YYYY-MM-DD`
    );
  }

  if (validateArrayField(relativeFile, "sources", data.sources, errors)) {
    for (const source of data.sources) {
      // Accept both string URLs and {url, accessed} objects
      let urlValue;
      if (typeof source === "string") {
        urlValue = source;
      } else if (source && typeof source === "object" && typeof source.url === "string") {
        urlValue = source.url;
      } else {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          "evidence sources entries must be strings or {url, accessed} objects"
        );
        continue;
      }
      if (/^https?:\/\//.test(urlValue)) {
        continue;
      }

      const inspected = inspectKbPath(urlValue);
      if (!inspected.ok) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `invalid path "${urlValue}" (${inspected.reason})`
        );
        continue;
      }
      if (inspected.legacyPrefix) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `canonical KB paths must not include "pm/" prefix: "${urlValue}"`
        );
        continue;
      }
      if (!inspected.value.startsWith("evidence/")) {
        pushIssue(
          errors,
          relativeFile,
          "sources",
          `internal evidence sources must target evidence paths, got "${urlValue}"`
        );
      }
    }
  }

  if (validateArrayField(relativeFile, "cited_by", data.cited_by, errors)) {
    for (const citedBy of data.cited_by) {
      const inspected = inspectKbPath(citedBy);
      if (!inspected.ok) {
        pushIssue(
          errors,
          relativeFile,
          "cited_by",
          `invalid path "${citedBy}" (${inspected.reason})`
        );
        continue;
      }
      if (inspected.legacyPrefix) {
        pushIssue(
          errors,
          relativeFile,
          "cited_by",
          `canonical KB paths must not include "pm/" prefix: "${citedBy}"`
        );
        continue;
      }
      if (!inspected.value.startsWith("insights/")) {
        pushIssue(
          errors,
          relativeFile,
          "cited_by",
          `evidence cited_by entries must target insight paths, got "${citedBy}"`
        );
      }
    }
  }

  kbState.evidence.set(relativeFile, data);
}

function validateCompetitorFile(pmDir, filePath, data, errors) {
  const relativeFile = relativeToPm(pmDir, filePath);

  validateRequiredFields(relativeFile, data, REQUIRED_COMPETITOR_FIELDS, errors);

  if (data.type && !VALID_COMPETITOR_TYPES.includes(data.type)) {
    pushIssue(
      errors,
      relativeFile,
      "type",
      `invalid competitor type "${data.type}" — valid: ${VALID_COMPETITOR_TYPES.join(", ")}`
    );
  }

  // Validate slug matches parent directory name
  if (data.slug) {
    const parentDir = path.basename(path.dirname(filePath));
    if (data.slug !== parentDir) {
      pushIssue(
        errors,
        relativeFile,
        "slug",
        `slug "${data.slug}" does not match parent directory "${parentDir}"`
      );
    }
  }

  // Validate profiled as YYYY-MM-DD
  if (data.profiled && !isIsoDate(data.profiled)) {
    pushIssue(
      errors,
      relativeFile,
      "profiled",
      `invalid date format "${data.profiled}" — expected YYYY-MM-DD`
    );
  }

  // Validate sources as array
  if (data.sources !== undefined && data.sources !== null) {
    validateArrayField(relativeFile, "sources", data.sources, errors);
  }
}

function validateNotesFile(pmDir, filePath, data, errors) {
  const relativeFile = relativeToPm(pmDir, filePath);

  validateRequiredFields(relativeFile, data, REQUIRED_NOTES_FIELDS, errors);

  if (data.type && data.type !== "notes") {
    pushIssue(errors, relativeFile, "type", `expected "notes", got "${data.type}"`);
  }

  if (data.month && !/^\d{4}-\d{2}$/.test(data.month)) {
    pushIssue(
      errors,
      relativeFile,
      "month",
      `invalid month format "${data.month}" — expected YYYY-MM`
    );
  }

  if (data.updated && !isIsoDate(data.updated)) {
    pushIssue(
      errors,
      relativeFile,
      "updated",
      `invalid date format "${data.updated}" — expected YYYY-MM-DD`
    );
  }

  const parsedCount = parseInt(data.note_count, 10);
  if (
    data.note_count !== undefined &&
    data.note_count !== null &&
    (isNaN(parsedCount) || parsedCount < 0)
  ) {
    pushIssue(
      errors,
      relativeFile,
      "note_count",
      `invalid note_count "${data.note_count}" — expected non-negative integer`
    );
  }

  if (
    data.digested_through !== undefined &&
    data.digested_through !== null &&
    data.digested_through !== "null" &&
    !/^\d{4}-\d{2}-\d{2}/.test(data.digested_through)
  ) {
    pushIssue(
      errors,
      relativeFile,
      "digested_through",
      `invalid digested_through "${data.digested_through}" — expected null or ISO timestamp`
    );
  }
}

function validateThinkingFile(pmDir, filePath, data, errors, warnings) {
  const relativeFile = relativeToPm(pmDir, filePath);

  validateRequiredFields(relativeFile, data, REQUIRED_THINKING_FIELDS, errors);

  if (data.type && data.type !== "thinking") {
    pushIssue(errors, relativeFile, "type", `expected "thinking", got "${data.type}"`);
  }

  if (data.status) {
    validateEnum(relativeFile, "status", data.status, VALID_THINKING_STATUSES, errors);
  }

  if (data.created && !isIsoDate(data.created)) {
    pushIssue(
      errors,
      relativeFile,
      "created",
      `invalid date format "${data.created}" — expected YYYY-MM-DD`
    );
  }

  if (data.updated && !isIsoDate(data.updated)) {
    pushIssue(
      errors,
      relativeFile,
      "updated",
      `invalid date format "${data.updated}" — expected YYYY-MM-DD`
    );
  }

  // slug must match filename
  if (data.slug) {
    const expectedSlug = path.basename(filePath, ".md");
    if (data.slug !== expectedSlug) {
      pushIssue(
        errors,
        relativeFile,
        "slug",
        `slug "${data.slug}" does not match filename "${expectedSlug}"`
      );
    }
  }

  // promoted_to constraints
  if (data.status === "promoted") {
    if (!data.promoted_to || data.promoted_to === "null") {
      pushIssue(
        errors,
        relativeFile,
        "promoted_to",
        "promoted_to must be set when status is promoted"
      );
    }
  } else if (data.promoted_to && data.promoted_to !== "null" && data.promoted_to !== null) {
    pushIssue(
      warnings,
      relativeFile,
      "promoted_to",
      `promoted_to is set but status is "${data.status}", not "promoted"`
    );
  }
}

function parseIndexRows(content) {
  const tableLines = content
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("|") && line.trim().endsWith("|"));

  if (tableLines.length < 2) {
    return { header: "", divider: "", rows: [] };
  }

  const rows = tableLines.slice(2).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
  );

  return {
    header: tableLines[0].trim(),
    divider: tableLines[1].trim(),
    rows,
  };
}

function extractLinkedTarget(cell) {
  const linkMatch = cell.match(/\[[^\]]+\]\(([^)]+)\)/);
  return linkMatch ? linkMatch[1].trim() : cell.trim();
}

function validateIndexFile(pmDir, filePath, errors) {
  const relativeFile = relativeToPm(pmDir, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const { header, divider, rows } = parseIndexRows(content);

  if (header !== "| Topic/Source | Description | Updated | Status |") {
    pushIssue(errors, relativeFile, "header", "index.md must use the canonical KB table header");
  }

  if (!/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/.test(divider)) {
    pushIssue(
      errors,
      relativeFile,
      "divider",
      "index.md must include a markdown table divider row"
    );
  }

  const directory = path.dirname(filePath);
  const expectedFiles = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        !entry.name.startsWith(".") &&
        entry.name !== "index.md" &&
        entry.name !== "log.md"
    )
    .map((entry) => entry.name)
    .sort();

  const foundTargets = rows
    .map((row) => (row.length > 0 ? extractLinkedTarget(row[0]) : ""))
    .filter(Boolean)
    .sort();

  for (const target of foundTargets) {
    if (target.includes("/") || target.startsWith("..")) {
      pushIssue(
        errors,
        relativeFile,
        "rows",
        `index row target must stay in-folder, got "${target}"`
      );
    }
  }

  for (const expected of expectedFiles) {
    if (!foundTargets.includes(expected)) {
      pushIssue(errors, relativeFile, "rows", `missing index row for "${expected}"`);
    }
  }

  for (const target of foundTargets) {
    if (!expectedFiles.includes(target)) {
      pushIssue(errors, relativeFile, "rows", `index row points to non-existent file "${target}"`);
    }
  }
}

function validateLogFile(pmDir, filePath, errors) {
  const relativeFile = relativeToPm(pmDir, filePath);
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== "");

  for (const line of lines) {
    const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+([a-z-]+)\s+(.+)$/);
    if (!match) {
      pushIssue(errors, relativeFile, "line", `invalid log line "${line}"`);
      continue;
    }

    const [, date, action, payload] = match;
    if (!isIsoDate(date)) {
      pushIssue(errors, relativeFile, "date", `invalid log date "${date}"`);
    }

    if (!VALID_LOG_ACTIONS.has(action)) {
      pushIssue(errors, relativeFile, "action", `invalid log action "${action}"`);
    }

    if ((action === "cite" || action === "uncite") && !payload.includes(" -> ")) {
      pushIssue(errors, relativeFile, "line", `log action "${action}" must use "A -> B" format`);
    }
  }
}

function validateBidirectionalCitations(errors, kbState) {
  for (const [insightPath, data] of kbState.insights) {
    if (!Array.isArray(data.sources)) {
      continue;
    }

    for (const source of data.sources) {
      const normalized = normalizeKbPath(source);
      if (!normalized || source.startsWith("pm/")) {
        continue;
      }

      const evidence = kbState.evidence.get(normalized);
      if (!evidence) {
        pushIssue(errors, insightPath, "sources", `missing evidence file "${normalized}"`);
        continue;
      }

      const citedBy = Array.isArray(evidence.cited_by) ? evidence.cited_by : [];
      const evidenceLinksBack = citedBy.some((entry) => normalizeKbPath(entry) === insightPath);
      if (!evidenceLinksBack) {
        pushIssue(
          errors,
          insightPath,
          "sources",
          `evidence "${normalized}" does not cite "${insightPath}" back in cited_by`
        );
      }
    }
  }

  for (const [evidencePath, data] of kbState.evidence) {
    if (!Array.isArray(data.cited_by)) {
      continue;
    }

    for (const citedBy of data.cited_by) {
      const normalized = normalizeKbPath(citedBy);
      if (!normalized || citedBy.startsWith("pm/")) {
        continue;
      }

      const insight = kbState.insights.get(normalized);
      if (!insight) {
        pushIssue(errors, evidencePath, "cited_by", `missing insight file "${normalized}"`);
        continue;
      }

      const sources = Array.isArray(insight.sources) ? insight.sources : [];
      const insightLinksBack = sources.some((entry) => normalizeKbPath(entry) === evidencePath);
      if (!insightLinksBack) {
        pushIssue(
          errors,
          evidencePath,
          "cited_by",
          `insight "${normalized}" does not cite "${evidencePath}" back in sources`
        );
      }
    }
  }
}

const REQUIRED_FEATURES_FIELDS = [
  "generated",
  "source_project",
  "files_scanned",
  "feature_count",
  "area_count",
  "areas",
];

function validateFeaturesFile(pmDir, filePath, content, errors) {
  const relativeFile = relativeToPm(pmDir, filePath);
  const parsed = parseFrontmatter(content);
  if (!parsed.hasFrontmatter) {
    pushIssue(errors, relativeFile, "-", "no YAML frontmatter found");
    return;
  }
  const data = parsed.data;

  validateRequiredFields(relativeFile, data, REQUIRED_FEATURES_FIELDS, errors);

  if (!Array.isArray(data.areas) || data.areas.length === 0) {
    pushIssue(errors, relativeFile, "areas", "areas must be a non-empty array");
  }

  // Count h3 headings in the markdown body to verify feature_count
  if (data.feature_count !== undefined && data.feature_count !== null) {
    const body = parsed.body || "";
    const h3Count = (body.match(/^### /gm) || []).length;
    if (Number(data.feature_count) !== h3Count) {
      pushIssue(
        errors,
        relativeFile,
        "feature_count",
        `feature_count is ${data.feature_count} but found ${h3Count} h3 headings in body`
      );
    }
  }
}

function validateMemoryEntry(relativeFile, entry, index, errors, requireArchivedAt) {
  const prefix = `entries[${index}]`;
  const requiredFields = ["date", "source", "category", "learning"];
  for (const field of requiredFields) {
    if (entry[field] === undefined || entry[field] === null) {
      pushIssue(errors, relativeFile, prefix, `missing required field "${field}"`);
    }
  }

  if (entry.date && !isIsoDate(entry.date)) {
    pushIssue(
      errors,
      relativeFile,
      prefix,
      `invalid date format "${entry.date}" — expected YYYY-MM-DD`
    );
  }

  if (entry.category) {
    if (FORBIDDEN_ENUM_PATTERN.test(entry.category)) {
      pushIssue(
        errors,
        relativeFile,
        prefix,
        `forbidden syntax in "${entry.category}" — enum values must not contain parenthetical content`
      );
    } else if (!VALID_MEMORY_CATEGORIES.includes(entry.category)) {
      pushIssue(
        errors,
        relativeFile,
        prefix,
        `invalid category "${entry.category}" — valid: ${VALID_MEMORY_CATEGORIES.join(", ")}`
      );
    }
  }

  if (entry.pinned !== undefined && entry.pinned !== "true" && entry.pinned !== "false") {
    pushIssue(errors, relativeFile, prefix, `pinned must be a boolean, got "${entry.pinned}"`);
  }

  if (requireArchivedAt) {
    if (entry.archived_at === undefined || entry.archived_at === null) {
      pushIssue(errors, relativeFile, prefix, `missing required field "archived_at"`);
    } else if (!isIsoDate(entry.archived_at)) {
      pushIssue(
        errors,
        relativeFile,
        prefix,
        `invalid archived_at format "${entry.archived_at}" — expected YYYY-MM-DD`
      );
    }
  }
}

function validateMemoryDocument(pmDir, fileName, expectedType, requireArchivedAt, errors) {
  const filePath = path.join(pmDir, fileName);
  if (!fs.existsSync(filePath)) {
    return;
  }

  const parsed = readParsedFrontmatter(filePath, fileName, errors);
  if (!parsed) {
    return;
  }

  const data = parsed.data;

  if (data.type !== expectedType) {
    pushIssue(errors, fileName, "type", `expected "${expectedType}", got "${data.type}"`);
  }

  if (!Array.isArray(data.entries)) {
    pushIssue(errors, fileName, "entries", "entries must be a list");
    return;
  }

  for (let i = 0; i < data.entries.length; i++) {
    validateMemoryEntry(fileName, data.entries[i], i, errors, requireArchivedAt);
  }
}

function validateConfig(configPath) {
  const errors = [];
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return { errors: [{ file: configPath, field: "-", msg: "invalid or missing config.json" }] };
  }

  if (config.sync !== undefined && config.sync !== null) {
    if (typeof config.sync !== "object" || Array.isArray(config.sync)) {
      pushIssue(errors, "config.json", "sync", "sync must be an object");
    } else {
      for (const field of ["enabled", "auto_pull", "auto_push"]) {
        if (config.sync[field] !== undefined && typeof config.sync[field] !== "boolean") {
          pushIssue(
            errors,
            "config.json",
            `sync.${field}`,
            `sync.${field} must be a boolean, got ${typeof config.sync[field]}`
          );
        }
      }
    }
  }

  return { errors };
}

function validate(pmDir) {
  const errors = [];
  const warnings = [];
  const backlogIds = new Map();
  const kbState = {
    insights: new Map(),
    evidence: new Map(),
  };

  const backlogDir = path.join(pmDir, "backlog");
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((file) => file.endsWith(".md"));
    for (const file of files) {
      const filePath = path.join(backlogDir, file);
      if (file === "index.md") {
        validateIndexFile(pmDir, filePath, errors);
        continue;
      }

      const parsed = readParsedFrontmatter(filePath, file, errors);
      if (!parsed) {
        continue;
      }

      validateBacklogItem(filePath, parsed.data, errors, warnings);

      if (parsed.data.id) {
        if (backlogIds.has(parsed.data.id)) {
          pushIssue(
            errors,
            file,
            "id",
            `duplicate ID "${parsed.data.id}" — also used by ${backlogIds.get(parsed.data.id)}`
          );
        } else {
          backlogIds.set(parsed.data.id, file);
        }
      }

      if (parsed.data.parent && parsed.data.parent !== "null") {
        const parentFile = `${parsed.data.parent}.md`;
        if (!fs.existsSync(path.join(backlogDir, parentFile))) {
          pushIssue(
            warnings,
            file,
            "parent",
            `parent "${parsed.data.parent}" not found in backlog/`
          );
        }
      }

      if (Array.isArray(parsed.data.children)) {
        for (const child of parsed.data.children) {
          const childFile = `${child}.md`;
          if (!fs.existsSync(path.join(backlogDir, childFile))) {
            pushIssue(warnings, file, "children", `child "${child}" not found in backlog/`);
          }
        }
      }
    }

    const ids = Array.from(backlogIds.keys())
      .map((id) => parseInt(id.replace("PM-", ""), 10))
      .filter((value) => !Number.isNaN(value))
      .sort((a, b) => a - b);

    if (ids.length > 0) {
      const minId = ids[0];
      const maxId = ids[ids.length - 1];
      const gaps = [];
      for (let value = minId; value <= maxId; value++) {
        if (!ids.includes(value)) {
          gaps.push(`PM-${String(value).padStart(3, "0")}`);
        }
      }
      if (gaps.length > 0) {
        pushIssue(warnings, "backlog/", "id", `ID gaps: ${gaps.join(", ")}`);
      }
    }
  }

  const strategyPath = path.join(pmDir, "strategy.md");
  if (fs.existsSync(strategyPath)) {
    const parsed = readParsedFrontmatter(strategyPath, "strategy.md", errors);
    if (parsed) {
      validateStrategy(strategyPath, parsed.data, errors);
    }
  }

  const thinkingDir = path.join(pmDir, "thinking");
  for (const filePath of walkMarkdownFiles(thinkingDir)) {
    const base = path.basename(filePath);
    if (base === "index.md") {
      validateIndexFile(pmDir, filePath, errors);
      continue;
    }

    const relativeFile = relativeToPm(pmDir, filePath);
    const parsed = readParsedFrontmatter(filePath, relativeFile, errors);
    if (!parsed) {
      continue;
    }

    validateThinkingFile(pmDir, filePath, parsed.data, errors, warnings);
  }

  const insightsDir = path.join(pmDir, "insights");
  for (const filePath of walkMarkdownFiles(insightsDir)) {
    const base = path.basename(filePath);
    if (base === "index.md") {
      validateIndexFile(pmDir, filePath, errors);
      continue;
    }
    if (base === "log.md") {
      validateLogFile(pmDir, filePath, errors);
      continue;
    }

    const relativeFile = relativeToPm(pmDir, filePath);
    const parsed = readParsedFrontmatter(filePath, relativeFile, errors);
    if (!parsed) {
      continue;
    }

    if (parsed.data.type === "landscape") {
      pushIssue(warnings, relativeFile, "type", "type 'landscape' is deprecated, use 'insight'");
      parsed.data.type = "insight";
    }

    validateInsightFile(pmDir, filePath, parsed.data, errors, kbState);
  }

  const evidenceDir = path.join(pmDir, "evidence");
  for (const filePath of walkMarkdownFiles(evidenceDir)) {
    const base = path.basename(filePath);
    if (base === "index.md") {
      validateIndexFile(pmDir, filePath, errors);
      continue;
    }
    if (base === "log.md") {
      validateLogFile(pmDir, filePath, errors);
      continue;
    }

    const relativeFile = relativeToPm(pmDir, filePath);
    const parsed = readParsedFrontmatter(filePath, relativeFile, errors);
    if (!parsed) {
      continue;
    }

    if (parsed.data.type === "notes") {
      validateNotesFile(pmDir, filePath, parsed.data, errors);
    } else if (parsed.data.type && parsed.data.type.startsWith("competitor-")) {
      validateCompetitorFile(pmDir, filePath, parsed.data, errors);
    } else {
      validateEvidenceFile(pmDir, filePath, parsed.data, errors, kbState);
    }
  }

  validateBidirectionalCitations(errors, kbState);

  const featuresPath = path.join(pmDir, "product", "features.md");
  if (fs.existsSync(featuresPath)) {
    const content = fs.readFileSync(featuresPath, "utf8");
    validateFeaturesFile(pmDir, featuresPath, content, errors);
  }

  validateMemoryDocument(pmDir, "memory.md", "project-memory", false, errors);
  validateMemoryDocument(pmDir, "memory-archive.md", "project-memory-archive", true, errors);

  return { errors, warnings, backlogCount: backlogIds.size };
}

function main() {
  const args = process.argv.slice(2);
  let pmDir = null;

  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--dir" && args[index + 1]) {
      pmDir = args[index + 1];
      index++;
    }
  }

  if (!pmDir) {
    pmDir = path.join(process.cwd(), "pm");
  }

  if (!fs.existsSync(pmDir)) {
    console.log(JSON.stringify({ ok: false, error: `pm directory not found: ${pmDir}` }));
    process.exit(1);
  }

  const { errors, warnings, backlogCount } = validate(pmDir);
  const result = {
    ok: errors.length === 0,
    backlog_items: backlogCount,
    errors: errors.length,
    warnings: warnings.length,
    details: [],
  };

  for (const error of errors) {
    result.details.push({
      level: "error",
      file: error.file,
      field: error.field,
      message: error.msg,
    });
  }

  for (const warning of warnings) {
    result.details.push({
      level: "warning",
      file: warning.file,
      field: warning.field,
      message: warning.msg,
    });
  }

  console.log(JSON.stringify(result, null, 2));
  process.exit(errors.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = {
  validate,
  validateConfig,
  // Exported for drift-detection tests
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_EVIDENCE,
  VALID_SCOPE,
  VALID_GAP,
  VALID_INSIGHT_STATUSES,
  VALID_CONFIDENCE,
  VALID_SOURCE_ORIGINS,
  VALID_MEMORY_CATEGORIES,
  VALID_COMPETITOR_TYPES,
  VALID_THINKING_STATUSES,
  REQUIRED_BACKLOG_FIELDS,
  REQUIRED_STRATEGY_FIELDS,
  REQUIRED_INSIGHT_FIELDS,
  REQUIRED_EVIDENCE_FIELDS,
  REQUIRED_NOTES_FIELDS,
  REQUIRED_COMPETITOR_FIELDS,
};
