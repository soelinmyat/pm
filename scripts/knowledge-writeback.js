#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { generateRouteSuggestions } = require("./insight-route-suggestions.js");

const INDEX_HEADER = "| Topic/Source | Description | Updated | Status |";
const INDEX_DIVIDER = "|---|---|---|---|";

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

function readStdin() {
  return fs.readFileSync(0, "utf8");
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

function quoteYaml(value) {
  return JSON.stringify(String(value));
}

function serializeArrayField(key, values) {
  if (!Array.isArray(values) || values.length === 0) {
    return `${key}: []\n`;
  }

  let output = `${key}:\n`;
  for (const value of values) {
    if (typeof value === "string") {
      output += `  - ${quoteYaml(value)}\n`;
      continue;
    }
    if (value && typeof value === "object" && typeof value.url === "string") {
      output += `  - url: ${quoteYaml(value.url)}\n`;
      if (value.accessed) {
        output += `    accessed: ${value.accessed}\n`;
      }
      continue;
    }
    throw new Error(`unsupported ${key} entry: ${JSON.stringify(value)}`);
  }
  return output;
}

function serializeFrontmatter(data) {
  let output = "---\n";
  output += "type: evidence\n";
  output += "evidence_type: research\n";
  output += `topic: ${quoteYaml(data.topic)}\n`;
  output += `source_origin: ${data.sourceOrigin}\n`;
  output += `created: ${data.created}\n`;
  output += `updated: ${data.updated}\n`;
  output += serializeArrayField("sources", data.sources);
  output += serializeArrayField("cited_by", data.citedBy);
  output += "---\n";
  return output;
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

function writeAtomic(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
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
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  return {
    content,
    frontmatter: parsed.hasFrontmatter ? parsed.data : {},
  };
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
  const sourceOrigin = existing?.frontmatter.source_origin || payload.sourceOrigin;

  const frontmatter = serializeFrontmatter({
    topic: payload.topic,
    sourceOrigin,
    created,
    updated,
    sources,
    citedBy,
  });
  const body = buildBody(payload);
  writeAtomic(absolutePath, `${frontmatter}\n${body}`);

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
  serializeFrontmatter,
  upsertIndex,
  writeKnowledgeArtifact,
};
