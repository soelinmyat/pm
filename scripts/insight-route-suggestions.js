#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "around",
  "because",
  "before",
  "being",
  "between",
  "from",
  "into",
  "only",
  "over",
  "should",
  "that",
  "their",
  "there",
  "these",
  "this",
  "those",
  "through",
  "under",
  "using",
  "what",
  "when",
  "where",
  "with",
]);

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

function ensureRelativePath(rawPath, prefix) {
  if (typeof rawPath !== "string" || rawPath.trim() === "") {
    throw new Error(`${prefix} path is required`);
  }

  const normalized = rawPath.replace(/\\/g, "/").replace(/^pm\//, "");
  if (!normalized.startsWith(prefix)) {
    throw new Error(`path must stay under ${prefix}, got "${rawPath}"`);
  }
  if (normalized.includes("..") || normalized.startsWith("/")) {
    throw new Error(`path must be a safe relative KB path, got "${rawPath}"`);
  }
  return normalized;
}

function ensureEvidencePath(rawPath) {
  return ensureRelativePath(rawPath, "evidence/");
}

function listMarkdownFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listMarkdownFilesRecursive(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(fullPath);
    }
  }
  return results;
}

function loadMarkdown(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);
  return {
    content,
    frontmatter: parsed.hasFrontmatter ? parsed.data : {},
    body: parsed.body || "",
    hasFrontmatter: parsed.hasFrontmatter,
  };
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMarkdown(text) {
  return normalizeWhitespace(
    String(text || "")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/^#+\s+/gm, "")
  );
}

function getSection(body, heading) {
  const lines = String(body || "").split(/\r?\n/);
  let active = false;
  const collected = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      if (active) {
        break;
      }
      active = headingMatch[1].trim() === heading;
      continue;
    }

    if (active) {
      collected.push(line);
    }
  }

  return collected.join("\n").trim();
}

function firstSentence(text) {
  const plain = stripMarkdown(text);
  if (!plain) {
    return "";
  }

  const match = plain.match(/^(.+?[.!?])(?:\s|$)/);
  const sentence = match ? match[1] : plain;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function extractFindings(body) {
  const section = getSection(body, "Findings");
  if (!section) {
    return [];
  }

  const lines = section.split(/\r?\n/);
  const findings = [];
  let active = "";

  for (const line of lines) {
    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (orderedMatch || bulletMatch) {
      if (active) {
        findings.push(active);
      }
      active = orderedMatch ? orderedMatch[1] : bulletMatch[1];
      continue;
    }
    if (active && /^\s{2,}\S/.test(line)) {
      active += ` ${line.trim()}`;
    }
  }
  if (active) {
    findings.push(active);
  }

  return findings.map((item) => normalizeWhitespace(item)).filter(Boolean);
}

function tokenize(text) {
  return Array.from(
    new Set(
      normalizeWhitespace(text)
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    )
  );
}

function relativeKbPath(pmDir, absolutePath) {
  return path.relative(pmDir, absolutePath).split(path.sep).join("/");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferredTopicForNewRoute(topic) {
  return normalizeWhitespace(
    String(topic || "").replace(/\s+[—-]\s+(Implementation Learnings|Groom Decisions)$/i, "")
  );
}

function inferDomain(artifactMode) {
  if (artifactMode === "decision-record") {
    return "product";
  }
  return "product";
}

function buildDescription(evidenceDoc) {
  return firstSentence(
    getSection(evidenceDoc.body, "Summary") || evidenceDoc.frontmatter.topic || "New insight"
  );
}

function loadEvidenceDoc(pmDir, evidencePath) {
  const absolutePath = path.join(pmDir, evidencePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`missing evidence file "${evidencePath}"`);
  }

  const doc = loadMarkdown(absolutePath);
  if (doc.frontmatter.type !== "evidence") {
    throw new Error(`expected evidence file at "${evidencePath}"`);
  }

  const summary = getSection(doc.body, "Summary");
  const findings = extractFindings(doc.body);
  const text = [doc.frontmatter.topic || "", summary, findings.join(" ")].join(" ");
  return {
    ...doc,
    evidencePath,
    absolutePath,
    summary,
    findings,
    tokens: tokenize(text),
  };
}

function loadInsightDocs(pmDir) {
  const insightsDir = path.join(pmDir, "insights");
  return listMarkdownFilesRecursive(insightsDir)
    .filter((filePath) => {
      const name = path.basename(filePath);
      return name !== "index.md" && name !== "log.md" && !name.startsWith(".");
    })
    .map((absolutePath) => {
      const doc = loadMarkdown(absolutePath);
      if (doc.frontmatter.type !== "insight") {
        return null;
      }

      const relativePath = relativeKbPath(pmDir, absolutePath);
      const topic =
        doc.frontmatter.topic || path.basename(relativePath, ".md").replace(/[-_]/g, " ");
      const domain = doc.frontmatter.domain || relativePath.split("/")[1] || "";
      return {
        ...doc,
        absolutePath,
        relativePath,
        topic,
        domain,
        topicTokens: tokenize(topic),
        bodyTokens: tokenize(doc.body),
        sources: Array.isArray(doc.frontmatter.sources) ? doc.frontmatter.sources : [],
      };
    })
    .filter(Boolean);
}

function scoreInsightCandidate(evidenceDoc, insightDoc, artifactMode) {
  if (insightDoc.sources.includes(evidenceDoc.evidencePath)) {
    return null;
  }

  const evidenceTokenSet = new Set(evidenceDoc.tokens);
  const topicMatches = insightDoc.topicTokens.filter((token) => evidenceTokenSet.has(token));
  const bodyMatches = insightDoc.bodyTokens.filter((token) => evidenceTokenSet.has(token));
  const overlapTokens = Array.from(new Set([...topicMatches, ...bodyMatches]));

  let score = topicMatches.length * 5 + bodyMatches.length * 2;
  if (
    normalizeWhitespace(evidenceDoc.frontmatter.topic)
      .toLowerCase()
      .includes(normalizeWhitespace(insightDoc.topic).toLowerCase()) ||
    normalizeWhitespace(insightDoc.topic)
      .toLowerCase()
      .includes(normalizeWhitespace(evidenceDoc.frontmatter.topic).toLowerCase())
  ) {
    score += 4;
  }
  if (artifactMode === "implementation-learnings" && insightDoc.domain === "product") {
    score += 1;
  }
  if (
    artifactMode === "decision-record" &&
    (insightDoc.domain === "product" || insightDoc.domain === "business")
  ) {
    score += 1;
  }

  if (score <= 0) {
    return null;
  }

  const matchedTerms = overlapTokens.slice(0, 4);
  const reason =
    matchedTerms.length > 0
      ? `Matched terms: ${matchedTerms.join(", ")}`
      : `Related to ${insightDoc.topic}`;

  return {
    mode: "existing",
    evidencePath: evidenceDoc.evidencePath,
    insightPath: insightDoc.relativePath,
    domain: insightDoc.domain,
    topic: insightDoc.topic,
    description: buildDescription(evidenceDoc),
    reason,
    score,
  };
}

function normalizePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const evidencePaths = Array.isArray(payload.evidencePaths)
    ? payload.evidencePaths
    : [payload.evidencePath || payload.artifactPath].filter(Boolean);

  if (evidencePaths.length === 0) {
    throw new Error("evidencePath is required");
  }

  return {
    evidencePaths: evidencePaths.map((item) => ensureEvidencePath(item)),
    artifactMode:
      typeof payload.artifactMode === "string" && payload.artifactMode.trim()
        ? payload.artifactMode.trim()
        : "general",
    maxSuggestions:
      Number.isInteger(payload.maxSuggestions) && payload.maxSuggestions > 0
        ? payload.maxSuggestions
        : 3,
  };
}

function generateRouteSuggestions(pmDir, rawPayload) {
  const payload = normalizePayload(rawPayload);
  const insightDocs = loadInsightDocs(pmDir);

  const items = payload.evidencePaths.map((evidencePath) => {
    const evidenceDoc = loadEvidenceDoc(pmDir, evidencePath);
    const suggestions = insightDocs
      .map((insightDoc) => scoreInsightCandidate(evidenceDoc, insightDoc, payload.artifactMode))
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.topic.localeCompare(right.topic);
      })
      .slice(0, payload.maxSuggestions);

    const existingCitations = Array.isArray(evidenceDoc.frontmatter.cited_by)
      ? evidenceDoc.frontmatter.cited_by.length
      : 0;
    let suggestedNewRoute = null;
    if (suggestions.length === 0 && existingCitations === 0) {
      const topic = inferredTopicForNewRoute(evidenceDoc.frontmatter.topic || "New Insight");
      const domain = inferDomain(payload.artifactMode);
      const slug = slugify(topic);
      suggestedNewRoute = {
        mode: "new",
        evidencePath,
        insightPath: `insights/${domain}/${slug}.md`,
        domain,
        topic,
        description: buildDescription(evidenceDoc),
        reason: "No existing insight shares strong keywords; seed a new topic from this evidence.",
      };
    }

    return {
      evidencePath,
      topic: evidenceDoc.frontmatter.topic || path.basename(evidencePath, ".md"),
      suggestions,
      suggestedNewRoute,
    };
  });

  return {
    items,
    suggestions: items.length === 1 ? items[0].suggestions : undefined,
    suggestedNewRoute: items.length === 1 ? items[0].suggestedNewRoute : undefined,
  };
}

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.pmDir) {
    process.stderr.write("error: --pm-dir is required\n");
    process.exit(1);
  }

  try {
    const payload = JSON.parse(readStdin());
    const result = generateRouteSuggestions(path.resolve(opts.pmDir), payload);
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
  generateRouteSuggestions,
  normalizePayload,
};
