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

const VALID_STATUSES = ["idea", "drafted", "planned", "proposed", "in-progress", "done"];
const VALID_PRIORITIES = ["critical", "high", "medium", "low"];
const VALID_EVIDENCE = ["strong", "moderate", "weak"];
const VALID_SCOPE = ["small", "medium", "large"];
const VALID_GAP = ["unique", "partial", "parity", "behind"];

const VALID_INSIGHT_STATUSES = ["active", "stale", "draft"];
const VALID_CONFIDENCE = ["high", "medium", "low"];
const VALID_SOURCE_ORIGINS = ["internal", "external"];
const VALID_LOG_ACTIONS = new Set(["create", "update", "move", "delete", "cite", "uncite"]);

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
const REQUIRED_STRATEGY_FIELDS = ["type"];
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

// ========== Helpers ==========

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function walkMarkdownFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
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

function validateBacklogItem(filePath, data, errors) {
  const rel = path.basename(filePath);

  validateRequiredFields(rel, data, REQUIRED_BACKLOG_FIELDS, errors);

  if (data.type && !["backlog-issue", "proposal"].includes(data.type)) {
    pushIssue(errors, rel, "type", `expected "backlog-issue" or "proposal", got "${data.type}"`);
  }

  if (data.id && !/^PM-\d{3,}$/.test(data.id)) {
    pushIssue(errors, rel, "id", `invalid ID format "${data.id}" — expected PM-NNN`);
  }

  if (data.status && !VALID_STATUSES.includes(data.status)) {
    pushIssue(
      errors,
      rel,
      "status",
      `invalid status "${data.status}" — valid: ${VALID_STATUSES.join(", ")}`
    );
  }

  if (data.priority && !VALID_PRIORITIES.includes(data.priority)) {
    pushIssue(
      errors,
      rel,
      "priority",
      `invalid priority "${data.priority}" — valid: ${VALID_PRIORITIES.join(", ")}`
    );
  }

  if (data.evidence_strength && !VALID_EVIDENCE.includes(data.evidence_strength)) {
    pushIssue(
      errors,
      rel,
      "evidence_strength",
      `invalid value "${data.evidence_strength}" — valid: ${VALID_EVIDENCE.join(", ")}`
    );
  }

  if (data.scope_signal && !VALID_SCOPE.includes(data.scope_signal)) {
    pushIssue(
      errors,
      rel,
      "scope_signal",
      `invalid value "${data.scope_signal}" — valid: ${VALID_SCOPE.join(", ")}`
    );
  }

  if (data.competitor_gap && !VALID_GAP.includes(data.competitor_gap)) {
    pushIssue(
      errors,
      rel,
      "competitor_gap",
      `invalid value "${data.competitor_gap}" — valid: ${VALID_GAP.join(", ")}`
    );
  }

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

  if (data.status && !VALID_INSIGHT_STATUSES.includes(data.status)) {
    pushIssue(
      errors,
      relativeFile,
      "status",
      `invalid status "${data.status}" — valid: ${VALID_INSIGHT_STATUSES.join(", ")}`
    );
  }

  if (data.confidence && !VALID_CONFIDENCE.includes(data.confidence)) {
    pushIssue(
      errors,
      relativeFile,
      "confidence",
      `invalid confidence "${data.confidence}" — valid: ${VALID_CONFIDENCE.join(", ")}`
    );
  }

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

  if (data.source_origin && !VALID_SOURCE_ORIGINS.includes(data.source_origin)) {
    pushIssue(
      errors,
      relativeFile,
      "source_origin",
      `invalid source_origin "${data.source_origin}" — valid: ${VALID_SOURCE_ORIGINS.join(", ")}`
    );
  }

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
      if (typeof source !== "string") {
        pushIssue(errors, relativeFile, "sources", "evidence sources entries must be strings");
        continue;
      }
      if (/^https?:\/\//.test(source)) {
        continue;
      }

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
          `internal evidence sources must target evidence paths, got "${source}"`
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
      const parsed = readParsedFrontmatter(filePath, file, errors);
      if (!parsed) {
        continue;
      }

      validateBacklogItem(filePath, parsed.data, errors);

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

    validateEvidenceFile(pmDir, filePath, parsed.data, errors, kbState);
  }

  validateBidirectionalCitations(errors, kbState);

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

main();
