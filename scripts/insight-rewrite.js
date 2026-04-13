#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  ensureInsightPath,
  firstSentence,
  getSection,
  loadMarkdown,
  readStdin,
  todayIso,
  writeMarkdown,
} = require("./kb-utils.js");

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

function getFirstParagraph(body) {
  const lines = String(body || "").split(/\r?\n/);
  const paragraph = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    if (/^#/.test(trimmed)) {
      continue;
    }
    paragraph.push(trimmed);
  }

  return paragraph.join(" ");
}

function getSummarySentence(doc) {
  const summarySection = getSection(doc.body, "Summary");
  const summarySource = summarySection || getFirstParagraph(doc.body);
  const sentence = firstSentence(summarySource);
  if (sentence) {
    return sentence;
  }
  return `${doc.frontmatter.topic || path.basename(doc.relativePath, ".md")} contributes additional evidence.`;
}

function getFirstFindingSentence(doc) {
  const findingsSection = getSection(doc.body, "Findings");
  if (!findingsSection) {
    return getSummarySentence(doc);
  }

  const lines = findingsSection.split(/\r?\n/);
  let active = "";
  const items = [];

  for (const line of lines) {
    const orderedMatch = line.match(/^\s*\d+\.\s+(.*)$/);
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (orderedMatch || bulletMatch) {
      if (active) {
        items.push(active);
      }
      active = orderedMatch ? orderedMatch[1] : bulletMatch[1];
      continue;
    }
    if (active && /^\s{2,}\S/.test(line)) {
      active += ` ${line.trim()}`;
    }
  }
  if (active) {
    items.push(active);
  }

  if (items.length > 0) {
    return firstSentence(items[0]);
  }
  return getSummarySentence(doc);
}

function confidenceForSourceCount(count) {
  if (count >= 4) {
    return "high";
  }
  if (count >= 2) {
    return "medium";
  }
  return "low";
}

function buildSynthesis(topic, evidenceDocs) {
  const intro =
    evidenceDocs.length === 1
      ? `The current linked evidence for ${topic} is anchored in one source.`
      : `The current linked evidence for ${topic} spans ${evidenceDocs.length} sources.`;

  const chunks = [];
  const groupSize = evidenceDocs.length > 3 ? 2 : evidenceDocs.length;
  for (let i = 0; i < evidenceDocs.length; i += groupSize) {
    chunks.push(evidenceDocs.slice(i, i + groupSize));
  }

  return chunks
    .map((docs, index) => {
      const sentences = docs.map(
        (doc) => `${doc.label} says ${doc.summarySentence} (${doc.relativePath}).`
      );
      if (index === 0) {
        return `${intro} ${sentences.join(" ")}`.trim();
      }
      return sentences.join(" ");
    })
    .join("\n\n");
}

function buildKeyFindings(evidenceDocs) {
  return evidenceDocs
    .map((doc, index) => `${index + 1}. ${doc.findingSentence} (${doc.relativePath})`)
    .join("\n");
}

function buildConfidenceRationale(confidence, sourceCount) {
  if (confidence === "low") {
    return "";
  }
  const rationale =
    confidence === "high"
      ? `Confidence is high because ${sourceCount} linked sources now support this topic from multiple angles.`
      : `Confidence is medium because ${sourceCount} linked sources support this topic, but the evidence base is still limited.`;
  return `${rationale}\n`;
}

function buildInsightBody(topic, evidenceDocs, confidence) {
  let body = `# ${topic}\n\n`;
  body += "## Synthesis\n\n";
  body += `${buildSynthesis(topic, evidenceDocs)}\n\n`;
  body += "## Key Findings\n\n";
  body += `${buildKeyFindings(evidenceDocs)}\n`;

  if (confidence !== "low") {
    body += "\n## Confidence Rationale\n\n";
    body += buildConfidenceRationale(confidence, evidenceDocs.length);
  }

  return body;
}

function loadEvidenceDocs(pmDir, sources) {
  return sources.map((relativePath) => {
    const absolutePath = path.join(pmDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`missing evidence file "${relativePath}"`);
    }

    const doc = loadMarkdown(absolutePath);
    if (doc.frontmatter.type !== "evidence") {
      throw new Error(`expected evidence file at "${relativePath}"`);
    }

    return {
      ...doc,
      relativePath,
      label: doc.frontmatter.topic || path.basename(relativePath, ".md").replace(/[-_]/g, " "),
      summarySentence: getSummarySentence(doc),
      findingSentence: getFirstFindingSentence(doc),
    };
  });
}

function normalizePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const insights = Array.isArray(payload.insights)
    ? payload.insights
    : payload.insightPath
      ? [payload.insightPath]
      : [];

  if (insights.length === 0) {
    throw new Error("insights must contain at least one path");
  }

  return Array.from(new Set(insights.map((item) => ensureInsightPath(item))));
}

function rewriteSingleInsight(pmDir, insightPath, now) {
  const absolutePath = path.join(pmDir, insightPath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`missing insight file "${insightPath}"`);
  }

  const insightDoc = loadMarkdown(absolutePath);
  if (insightDoc.frontmatter.type !== "insight") {
    throw new Error(`expected insight file at "${insightPath}"`);
  }

  const sources = Array.isArray(insightDoc.frontmatter.sources)
    ? insightDoc.frontmatter.sources
    : [];
  if (sources.length === 0) {
    return {
      insightPath,
      action: "skipped",
      reason: "no-sources",
    };
  }

  const evidenceDocs = loadEvidenceDocs(pmDir, sources);
  const confidence = confidenceForSourceCount(sources.length);
  const status =
    insightDoc.frontmatter.status === "draft" && sources.length > 0
      ? "active"
      : insightDoc.frontmatter.status || "draft";
  const nextBody = buildInsightBody(insightDoc.frontmatter.topic, evidenceDocs, confidence);
  const nextFrontmatter = {
    ...insightDoc.frontmatter,
    last_updated: now,
    status,
    confidence,
    sources,
  };

  const currentLastUpdated = String(insightDoc.frontmatter.last_updated || "");
  const bodyChanged = insightDoc.body.trim() !== nextBody.trim();
  const metadataChanged =
    currentLastUpdated !== now ||
    String(insightDoc.frontmatter.status || "draft") !== status ||
    String(insightDoc.frontmatter.confidence || "low") !== confidence;

  if (!bodyChanged && !metadataChanged) {
    return {
      insightPath,
      action: "skipped",
      reason: "up-to-date",
      confidence,
      status,
      sourceCount: sources.length,
    };
  }

  writeMarkdown(absolutePath, nextFrontmatter, nextBody, [
    "type",
    "domain",
    "topic",
    "last_updated",
    "status",
    "confidence",
    "sources",
  ]);

  return {
    insightPath,
    action: "rewritten",
    confidence,
    status,
    sourceCount: sources.length,
  };
}

function rewriteInsights(pmDir, rawPayload, options = {}) {
  const insights = normalizePayload(rawPayload);
  const now = options.now || todayIso();
  return {
    insights: insights.map((insightPath) => {
      try {
        return rewriteSingleInsight(pmDir, insightPath, now);
      } catch (error) {
        return {
          insightPath,
          action: "error",
          reason: error.message,
        };
      }
    }),
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
    const result = rewriteInsights(path.resolve(opts.pmDir), payload);
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
  buildInsightBody,
  confidenceForSourceCount,
  rewriteInsights,
};
