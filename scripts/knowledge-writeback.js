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
const { validateCitationBindings } = require("./lib/evidence-schema");

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
  if (!["internal", "external", "mixed"].includes(payload.sourceOrigin || "internal")) {
    throw new Error("sourceOrigin must be internal, external, or mixed");
  }
  const supersedes = payload.supersedes || [];
  if (
    !Array.isArray(supersedes) ||
    supersedes.some(
      (item) =>
        !item ||
        ["finding", "replacement", "reason"].some(
          (key) => typeof item[key] !== "string" || !item[key].trim()
        )
    )
  ) {
    throw new Error("supersedes requires exact finding, replacement, and reason strings");
  }

  return {
    artifactPath,
    topic,
    summary,
    findings,
    supersedes,
    artifactMode:
      typeof payload.artifactMode === "string" && payload.artifactMode.trim()
        ? payload.artifactMode.trim()
        : "general",
    description,
    sourceOrigin: payload.sourceOrigin || "internal",
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    status: payload.status || null,
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
    body: doc.body,
    frontmatter: doc.frontmatter,
  };
}

function normalizedFinding(value) {
  return String(value).replace(/\s+/g, " ").trim();
}

function findingItems(section) {
  return section
    .split(/\r?\n(?=\s*(?:\d+\.|[-*])\s+)/)
    .map((item) => item.replace(/^\s*(?:\d+\.|[-*])\s+/, "").trim())
    .filter(Boolean);
}

function mergeBody(existing, payload) {
  const sections = existing.body.split(/(?=^## )/m);
  const updates = new Map([
    ["Summary", payload.summary],
    ["Strategic Relevance", renderParagraph(payload.strategicRelevance).trim()],
    ["Implications", renderParagraph(payload.implications).trim()],
    ["Open Questions", renderParagraph(payload.openQuestions).trim()],
    [
      "Source Artifacts",
      payload.sourceArtifacts.length ? renderList(payload.sourceArtifacts, false).trim() : "",
    ],
  ]);
  const findingSection = sections.find((section) => /^## Findings\s*\n/.test(section));
  let findings = findingItems((findingSection || "").replace(/^## Findings\s*\n/, ""));
  const history = [];
  for (const correction of payload.supersedes) {
    const index = findings.findIndex(
      (item) => normalizedFinding(item) === normalizedFinding(correction.finding)
    );
    if (index === -1) throw new Error("superseded finding must match an existing finding exactly");
    const origin =
      findings[index].match(/^\[(internal|external)\]/)?.[1] || existing.frontmatter.source_origin;
    if (origin !== payload.sourceOrigin)
      throw new Error("cannot supersede another origin's or ambiguous finding");
    history.push(
      `- Superseded: ${findings[index]}\n  Replacement: ${correction.replacement.trim()}\n  Reason: ${correction.reason.trim()}`
    );
    findings.splice(index, 1);
  }
  // Label ownership when origins become mixed, so later partial updates can
  // distinguish an internal observation from an external claim.
  if (resolveSourceOrigin(existing.frontmatter.source_origin, payload.sourceOrigin) === "mixed") {
    const label = (item, origin) =>
      /^(?:\[(?:internal|external)\])/.test(item) || !["internal", "external"].includes(origin)
        ? item
        : `[${origin}] ${item}`;
    findings = findings.map((item) => label(item, existing.frontmatter.source_origin));
    payload = {
      ...payload,
      findings: payload.findings.map((item) => label(item, payload.sourceOrigin)),
      supersedes: payload.supersedes.map((item) => ({
        ...item,
        replacement: label(item.replacement.trim(), payload.sourceOrigin),
      })),
    };
  }
  const incoming = [
    ...payload.findings,
    ...payload.supersedes.map((item) => item.replacement.trim()),
  ];
  for (const item of incoming) {
    if (!findings.some((prior) => normalizedFinding(prior) === normalizedFinding(item)))
      findings.push(item);
  }
  updates.set("Findings", renderList(findings, true).trim());
  if (history.length) updates.set("Superseded Findings", history.join("\n"));
  const rendered = sections.map((section) => {
    const heading = section.match(/^## (.+)\r?\n/);
    if (!heading || !updates.has(heading[1].trim())) return section.trimEnd();
    const name = heading[1].trim();
    const addition = updates.get(name);
    updates.delete(name);
    if (name === "Findings") return `## Findings\n\n${addition}`;
    const previous = section.slice(heading[0].length).trim();
    if (!addition || ["None.", "- None."].includes(addition) || previous.includes(addition))
      return section.trimEnd();
    return `## ${name}\n\n${previous}${previous ? "\n\n" : ""}${addition}`;
  });
  for (const [name, value] of updates) {
    if (value && !["None.", "- None."].includes(value)) rendered.push(`## ${name}\n\n${value}`);
  }
  return `${rendered.join("\n\n").trim()}\n`;
}

// Retain unknown fields, numeric provenance markers, source ownership and comments
// byte-for-byte; only the explicitly owned scalar metadata changes.
function updateFrontmatter(existing, changes) {
  const match = existing.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("existing writeback must have frontmatter");
  let yaml = match[1];
  for (const [key, value] of Object.entries(changes)) {
    const pattern = new RegExp(`^${key}:.*(?:\\r?\\n[ \\t]+.*)*`, "m");
    const line = Array.isArray(value)
      ? serializeFrontmatter({ [key]: value })
          .replace(/^---\n/, "")
          .replace(/\n---\n$/, "")
      : `${key}: ${JSON.stringify(value)}`;
    yaml = pattern.test(yaml) ? yaml.replace(pattern, () => line) : `${yaml}\n${line}`;
  }
  return `---\n${yaml}\n---\n`;
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
  if (
    existing &&
    (existing.frontmatter.type !== "evidence" || existing.frontmatter.evidence_type !== "research")
  ) {
    throw new Error("existing writeback must be research evidence");
  }
  if (!existing && payload.supersedes.length)
    throw new Error("cannot supersede findings in a new artifact");
  const created = existing ? existing.frontmatter.created || now : now;
  const updated = now;
  const sources = Array.isArray(existing?.frontmatter.sources)
    ? [...existing.frontmatter.sources]
    : [];
  for (const source of payload.sources) {
    if (!sources.some((prior) => JSON.stringify(prior) === JSON.stringify(source)))
      sources.push(source);
  }
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
  const body = existing ? mergeBody(existing, payload) : buildBody(payload);
  const header = existing
    ? updateFrontmatter(existing, {
        topic: payload.topic,
        source_origin: sourceOrigin,
        updated,
        ...(payload.sources.length ? { sources } : {}),
      })
    : serializeFrontmatter(frontmatter, EVIDENCE_PREFERRED_KEYS);
  const content = `${header}\n${body}`;
  if (Number(existing?.frontmatter.provenance_version) === 2) {
    const ledgerPath = path.join(pmDir, "evidence", "provenance.json");
    if (!fs.existsSync(ledgerPath)) throw new Error("v2 writeback requires its provenance ledger");
    const issues = validateCitationBindings({
      markdown: content,
      ledger: JSON.parse(fs.readFileSync(ledgerPath, "utf8")),
      artifactPath: payload.artifactPath,
    });
    if (issues.length) throw new Error(`v2 writeback citations invalid: ${issues.join("; ")}`);
  }
  writeAtomic(absolutePath, content);

  upsertIndex(indexPath, fileName, payload.description, updated, payload.status || sourceOrigin);
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
