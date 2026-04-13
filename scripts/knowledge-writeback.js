#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  loadMarkdown,
  readStdin,
  serializeFrontmatter,
  todayIso,
  writeAtomic,
} = require("./kb-utils.js");
const { generateRouteSuggestions } = require("./insight-route-suggestions.js");

const INDEX_HEADER = "| Topic/Source | Description | Updated | Status |";
const INDEX_DIVIDER = "|---|---|---|---|";

const EVIDENCE_PREFERRED_KEYS = [
  "type",
  "evidence_type",
  "topic",
  "source_origin",
  "created",
  "updated",
  "sources",
  "cited_by",
];

function parseArgs(argv) {
  const opts = {
    pmDir: null,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pm-dir") {
      opts.pmDir = argv[++i];
    }
  }

  return opts;
}

function ensureSafeResearchPath(artifactPath) {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    throw new Error("artifactPath is required");
  }

  const normalized = artifactPath.replace(/\\/g, "/").replace(/^pm\//, "");
  if (!normalized.startsWith("evidence/research/")) {
    throw new Error(`artifactPath must stay under evidence/research/, got "${artifactPath}"`);
  }
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`artifactPath must be a safe relative KB path, got "${artifactPath}"`);
  }

  return normalized;
}

function renderList(items, ordered) {
  if (!Array.isArray(items) || items.length === 0) {
    return ordered ? "1. None.\n" : "- None.\n";
  }

  return items
    .map((item, index) => `${ordered ? `${index + 1}.` : "-"} ${String(item).trim()}`)
    .join("\n")
    .concat("\n");
}

function renderParagraph(value) {
  if (!value) {
    return "None.\n";
  }
  if (Array.isArray(value)) {
    return renderList(value, false);
  }
  return `${String(value).trim()}\n`;
}

function buildBody(payload) {
  let body = `# ${payload.topic}\n\n`;
  body += "## Summary\n";
  body += `${String(payload.summary).trim()}\n\n`;
  body += "## Findings\n";
  body += `${renderList(payload.findings, true)}\n`;
  body += "## Strategic Relevance\n";
  body += `${renderParagraph(payload.strategicRelevance)}\n`;
  body += "## Implications\n";
  body += `${renderParagraph(payload.implications)}\n`;
  body += "## Open Questions\n";
  body += renderParagraph(payload.openQuestions);

  if (Array.isArray(payload.sourceArtifacts) && payload.sourceArtifacts.length > 0) {
    body += "\n## Source Artifacts\n";
    body += renderList(payload.sourceArtifacts, false);
  }

  return body;
}

function normalizePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const artifactPath = ensureSafeResearchPath(payload.artifactPath || payload.path || "");
  const topic =
    typeof payload.topic === "string" && payload.topic.trim() ? payload.topic.trim() : "";
  const summary =
    typeof payload.summary === "string" && payload.summary.trim() ? payload.summary.trim() : "";
  const findings = Array.isArray(payload.findings)
    ? payload.findings.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const description =
    typeof payload.description === "string" && payload.description.trim()
      ? payload.description.trim()
      : summary || topic;

  if (!topic) {
    throw new Error("topic is required");
  }
  if (!summary) {
    throw new Error("summary is required");
  }
  if (findings.length === 0) {
    throw new Error("findings must contain at least one item");
  }

  return {
    artifactPath,
    topic,
    summary,
    findings,
    artifactMode:
      typeof payload.artifactMode === "string" && payload.artifactMode.trim()
        ? payload.artifactMode.trim()
        : "general",
    description,
    sourceOrigin: payload.sourceOrigin || "internal",
    status: payload.status || "internal",
    implications: payload.implications || "None.",
    openQuestions: payload.openQuestions || "None.",
    strategicRelevance: payload.strategicRelevance || "None.",
    sourceArtifacts: Array.isArray(payload.sourceArtifacts) ? payload.sourceArtifacts : [],
  };
}

function loadExistingArtifact(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const doc = loadMarkdown(filePath);
  return {
    content: doc.content,
    frontmatter: doc.frontmatter,
  };
}

function resolveSourceOrigin(existingSourceOrigin, incomingSourceOrigin) {
  const existing =
    typeof existingSourceOrigin === "string" && existingSourceOrigin.trim()
      ? existingSourceOrigin.trim()
      : "";
  const incoming =
    typeof incomingSourceOrigin === "string" && incomingSourceOrigin.trim()
      ? incomingSourceOrigin.trim()
      : "";

  if (existing === "mixed" || incoming === "mixed") {
    return "mixed";
  }
  if (existing && incoming && existing !== incoming) {
    return "mixed";
  }
  return existing || incoming || "internal";
}

function upsertIndex(indexPath, fileName, description, updated, status) {
  const row = `| [${fileName}](${fileName}) | ${description} | ${updated} | ${status} |`;

  if (!fs.existsSync(indexPath)) {
    const content = ["# Index", "", INDEX_HEADER, INDEX_DIVIDER, row, ""].join("\n");
    writeAtomic(indexPath, content);
    return;
  }

  const original = fs.readFileSync(indexPath, "utf8");
  const lines = original.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === INDEX_HEADER);

  if (headerIndex === -1) {
    const fallback = [original.trimEnd(), "", INDEX_HEADER, INDEX_DIVIDER, row, ""]
      .filter(Boolean)
      .join("\n");
    writeAtomic(indexPath, `${fallback}\n`);
    return;
  }

  let tableEnd = headerIndex + 2;
  while (tableEnd < lines.length && lines[tableEnd].trim().startsWith("|")) {
    tableEnd++;
  }

  const prefix = lines.slice(0, headerIndex);
  const suffix = lines.slice(tableEnd);
  const existingRows = lines.slice(headerIndex + 2, tableEnd).filter((line) => line.trim() !== "");
  const filteredRows = existingRows.filter((line) => !line.includes(`](${fileName})`));
  filteredRows.push(row);
  filteredRows.sort((a, b) => a.localeCompare(b));

  const rebuilt = [...prefix, INDEX_HEADER, INDEX_DIVIDER, ...filteredRows, ...suffix].join("\n");

  writeAtomic(indexPath, rebuilt.endsWith("\n") ? rebuilt : `${rebuilt}\n`);
}

function appendLog(logPath, action, artifactPath, date) {
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const line = `${date} ${action} ${artifactPath}`;
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  writeAtomic(logPath, content);
}

function writeKnowledgeArtifact(pmDir, rawPayload) {
  const payload = normalizePayload(rawPayload);
  const absolutePath = path.join(pmDir, payload.artifactPath);
  const fileName = path.basename(payload.artifactPath);
  const indexPath = path.join(pmDir, "evidence", "research", "index.md");
  const logPath = path.join(pmDir, "evidence", "research", "log.md");
  const now = todayIso();
  const existing = loadExistingArtifact(absolutePath);
  const created = existing ? existing.frontmatter.created || now : now;
  const updated = now;
  const sources = Array.isArray(existing?.frontmatter.sources) ? existing.frontmatter.sources : [];
  const citedBy = Array.isArray(existing?.frontmatter.cited_by)
    ? existing.frontmatter.cited_by
    : [];
  const sourceOrigin = resolveSourceOrigin(
    existing?.frontmatter.source_origin,
    payload.sourceOrigin
  );

  const frontmatter = {
    type: "evidence",
    evidence_type: "research",
    topic: payload.topic,
    source_origin: sourceOrigin,
    created,
    updated,
    sources,
    cited_by: citedBy,
  };
  const body = buildBody(payload);
  const content = `${serializeFrontmatter(frontmatter, EVIDENCE_PREFERRED_KEYS)}\n${body}`;
  writeAtomic(absolutePath, content);

  upsertIndex(indexPath, fileName, payload.description, updated, payload.status);
  appendLog(logPath, existing ? "update" : "create", payload.artifactPath, now);

  const routeSuggestions = generateRouteSuggestions(pmDir, {
    evidencePath: payload.artifactPath,
    artifactMode: payload.artifactMode,
  });

  return {
    artifactPath: payload.artifactPath,
    created: !existing,
    createdDate: created,
    updatedDate: updated,
    routeSuggestions,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.pmDir) {
    process.stderr.write("error: --pm-dir is required\n");
    process.exit(1);
  }

  try {
    const input = readStdin();
    const payload = JSON.parse(input);
    const result = writeKnowledgeArtifact(path.resolve(opts.pmDir), payload);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildBody,
  normalizePayload,
  resolveSourceOrigin,
  upsertIndex,
  writeKnowledgeArtifact,
};
