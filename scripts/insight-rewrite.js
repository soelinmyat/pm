#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const {
  ensureInsightPath,
  ensureEvidencePath,
  getSection,
  loadMarkdown,
  normalizeWhitespace,
  readStdin,
  todayIso,
  writeMarkdown,
} = require("./kb-utils.js");

const { parseFindingItems } = require("./lib/finding-items");

const DIGEST_START = "<!-- pm-source-digest:start -->";
const DIGEST_END = "<!-- pm-source-digest:end -->";
const REVIEW_START = "<!-- pm-reviewed-synthesis:start -->";
const REVIEW_END = "<!-- pm-reviewed-synthesis:end -->";
const STATE_START = "<!-- pm-insight-state:start -->";
const STATE_END = "<!-- pm-insight-state:end -->";

function ensureSourcePath(rawPath) {
  if (rawPath === "insights/business/landscape.md") return rawPath;
  return ensureEvidencePath(rawPath);
}

function loadSourceDocument(pmDir, relativePath) {
  const absolutePath = path.join(pmDir, ensureSourcePath(relativePath));
  if (!fs.existsSync(absolutePath)) throw new Error(`missing evidence file "${relativePath}"`);
  const doc = loadMarkdown(absolutePath);
  const type = doc.frontmatter.type;
  const valid =
    type === "evidence" ||
    String(type || "").startsWith("competitor-") ||
    (type === "insight" && relativePath === "insights/business/landscape.md") ||
    (path.basename(relativePath) === "index.md" && (!type || type === "index"));
  if (!valid) throw new Error(`expected evidence source at "${relativePath}"`);
  return { ...doc, relativePath };
}

// Citation backlinks do not change the source's meaning. Normalize scalar YAML
// representations so helper formatting does not masquerade as new evidence.
function canonicalMetadata(value) {
  if (Array.isArray(value)) return value.map(canonicalMetadata);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => key !== "cited_by")
        .map((key) => [key, canonicalMetadata(value[key])])
    );
  return value === null || value === undefined ? null : String(value);
}

function sourceFingerprint(doc) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        metadata: canonicalMetadata(doc.frontmatter),
        body: doc.body.trim(),
      })
    )
    .digest("hex")}`;
}

function extractFindings(body) {
  const section = getSection(body, "Findings");
  if (!section)
    return String(body || "")
      .split(/\r?\n\s*\r?\n/)
      .filter((paragraph) => paragraph.trim() && !/^#/.test(paragraph.trim()))
      .map((paragraph) => normalizeWhitespace(paragraph.replace(/^\s*(?:\d+\.|[-*])\s+/, "")));
  return parseFindingItems(section).map(normalizeWhitespace);
}

function validateSelections(doc, selections) {
  if (
    !Array.isArray(selections) ||
    selections.some((text) => typeof text !== "string" || !text.trim())
  )
    throw new Error("selected_findings must contain complete finding text");
  const findings = extractFindings(doc.body);
  return [...new Set(selections.map(normalizeWhitespace))].map((text) => {
    if (!findings.includes(text))
      throw new Error(`selected finding no longer exists in "${doc.relativePath}": ${text}`);
    return text;
  });
}

function replaceManagedBlock(body, start, end, block) {
  const startAt = body.indexOf(start);
  const endAt = body.indexOf(end);
  if (startAt < 0 !== endAt < 0 || (startAt >= 0 && endAt < startAt))
    throw new Error("incomplete managed insight block; preserve it for explicit repair");
  if (startAt >= 0) return `${body.slice(0, startAt)}${block}${body.slice(endAt + end.length)}`;
  return `${body.trimEnd()}\n\n${block}\n`;
}

function escapeManagedMarkers(text) {
  return [DIGEST_START, DIGEST_END, REVIEW_START, REVIEW_END, STATE_START, STATE_END].reduce(
    (body, marker) => body.split(marker).join(marker.replace("<", "&lt;")),
    String(text)
  );
}

function buildSourceDigest(evidenceDocs, sourceClaims = []) {
  const parts = [
    DIGEST_START,
    "## Source Digest",
    "",
    "These are source excerpts, not a synthesized conclusion. Relevance, independent support, segment differences, and conflicting claims require analyst judgment.",
  ];
  for (const doc of evidenceDocs) {
    parts.push("", `### ${doc.relativePath}`, "", `Source snapshot: ${sourceFingerprint(doc)}`);
    const selected = sourceClaims
      .filter((claim) => claim.path === doc.relativePath)
      .map((claim) => claim.finding);
    const currentFindings = extractFindings(doc.body);
    const retained = selected.filter((text) => currentFindings.includes(normalizeWhitespace(text)));
    const missing = selected.filter((text) => !currentFindings.includes(normalizeWhitespace(text)));
    if (retained.length)
      parts.push(
        "",
        "**Selected findings for this topic (selection supplied by caller):**",
        ...retained.map((text) => `- ${escapeManagedMarkers(text)}`)
      );
    if (missing.length)
      parts.push(
        "",
        "**Previously selected findings no longer present in this source:**",
        ...missing.map((text) => `- ${escapeManagedMarkers(text)}`),
        "Reconcile these against the current evidence; they are historical claims, not current support."
      );
    // Keep later findings, source citations, superseded claims, and custom
    // counterevidence sections. Their position must not decide relevance.
    const sourceBody = escapeManagedMarkers(doc.body.trim())
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    parts.push(
      "",
      "**Complete source context — not all claims necessarily concern this topic:**",
      "",
      sourceBody
    );
  }
  parts.push(
    "",
    "### Confidence Rationale",
    "",
    "No confidence upgrade is inferred from linked-file count. Until current claim-level support is reviewed for authority, independence, recency, and claim fit, confidence is low and the prior analyst conclusion remains unverified against these sources.",
    DIGEST_END
  );
  return parts.join("\n");
}

function validateSynthesis(synthesis, evidenceDocs) {
  if (
    !synthesis ||
    typeof synthesis !== "object" ||
    typeof synthesis.summary !== "string" ||
    !synthesis.summary.trim()
  )
    throw new Error("supplied synthesis requires an analyst summary");
  if (!Array.isArray(synthesis.claims) || !synthesis.claims.length)
    throw new Error("supplied synthesis requires claims with exact source findings");
  const docs = new Map(evidenceDocs.map((doc) => [doc.relativePath, doc]));
  for (const claim of synthesis.claims) {
    if (
      !claim ||
      typeof claim.text !== "string" ||
      !claim.text.trim() ||
      !Array.isArray(claim.evidence_refs) ||
      !claim.evidence_refs.length
    )
      throw new Error("each synthesis claim requires text and evidence_refs");
    for (const ref of claim.evidence_refs) {
      const doc = docs.get(ref.path);
      if (!doc) throw new Error("synthesis claim refers to an unlinked source");
      validateSelections(doc, [ref.finding]);
    }
  }
  const confidence = synthesis.confidence;
  if (
    !confidence ||
    !["low", "medium", "high"].includes(confidence.level) ||
    typeof confidence.basis !== "string" ||
    !confidence.basis.trim() ||
    typeof confidence.limitations !== "string" ||
    !confidence.limitations.trim()
  )
    throw new Error("supplied synthesis requires confidence basis and explicit limitations");
  if (
    !Array.isArray(synthesis.open_questions) ||
    synthesis.open_questions.some((text) => typeof text !== "string" || !text.trim())
  )
    throw new Error("supplied synthesis requires open_questions (an empty array is explicit)");
  return synthesis;
}

function buildReviewedSynthesis(synthesis) {
  const claims = synthesis.claims.map(
    (claim, index) =>
      `${index + 1}. ${claim.text}\n${claim.evidence_refs.map((ref) => `   - ${ref.path}: ${ref.finding}`).join("\n")}`
  );
  return [
    REVIEW_START,
    "## Reviewed Synthesis",
    "",
    "The following assessment was supplied by the analyst. Source bindings validate excerpts, not whether the interpretation is correct. Earlier analyst text is retained above as historical context.",
    "",
    synthesis.summary,
    "",
    "### Key Findings",
    "",
    ...claims,
    "",
    "### Confidence Rationale",
    "",
    `${synthesis.confidence.level}: ${synthesis.confidence.basis}`,
    `Limitations: ${synthesis.confidence.limitations}`,
    "",
    "### Open Questions",
    "",
    ...(synthesis.open_questions.length
      ? synthesis.open_questions.map((text) => `- ${text}`)
      : ["No additional open questions were supplied by the analyst."]),
    REVIEW_END,
  ].join("\n");
}

function normalizePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const insights = Array.isArray(payload.insights)
    ? payload.insights
    : payload.insightPath
      ? [payload.insightPath]
      : [];
  if (!insights.length) throw new Error("insights must contain at least one path");
  const seen = new Set();
  return insights
    .map((item) => (typeof item === "string" ? { insightPath: item } : item))
    .map((item) => {
      const insightPath = ensureInsightPath(item.insightPath);
      if (seen.has(insightPath)) throw new Error("duplicate insight target");
      seen.add(insightPath);
      return { insightPath, synthesis: item.synthesis };
    });
}

function rewriteSingleInsight(pmDir, target, now, options) {
  const { insightPath, synthesis } = target;
  const absolutePath = path.join(pmDir, insightPath);
  const insightDoc = loadMarkdown(absolutePath);
  if (insightDoc.frontmatter.type !== "insight")
    throw new Error(`expected insight file at "${insightPath}"`);
  const sources = Array.isArray(insightDoc.frontmatter.sources)
    ? insightDoc.frontmatter.sources
    : [];
  if (sources.includes(insightPath))
    throw new Error("an insight cannot contain itself as source evidence");
  if (!sources.length) return { insightPath, action: "skipped", reason: "no-sources" };
  const evidenceDocs = sources.map((source) => loadSourceDocument(pmDir, source));
  const snapshots = evidenceDocs.map((doc) => ({
    path: doc.relativePath,
    sha256: sourceFingerprint(doc),
  }));
  const changed =
    JSON.stringify(insightDoc.frontmatter.source_snapshots || []) !== JSON.stringify(snapshots);
  const digestPending =
    insightDoc.frontmatter.digest_pending === true ||
    insightDoc.frontmatter.digest_pending === "true";
  if (!changed && !synthesis && !options.forceDigest && !digestPending)
    return {
      insightPath,
      action: "skipped",
      reason: "up-to-date",
      synthesis_state: insightDoc.frontmatter.synthesis_state,
    };
  let nextBody = replaceManagedBlock(
    insightDoc.body,
    DIGEST_START,
    DIGEST_END,
    buildSourceDigest(evidenceDocs, insightDoc.frontmatter.source_claims || [])
  );
  if (
    !synthesis &&
    nextBody.includes(REVIEW_START) &&
    !nextBody.includes("**Historical assessment: linked evidence or claim selection changed.")
  ) {
    nextBody = nextBody.replace(
      "## Reviewed Synthesis\n",
      "## Reviewed Synthesis\n\n**Historical assessment: linked evidence or claim selection changed. Reconsider this conclusion before using it.**\n"
    );
  }
  if (synthesis) {
    const reviewed = buildReviewedSynthesis(validateSynthesis(synthesis, evidenceDocs));
    const startAt = nextBody.indexOf(REVIEW_START);
    const endAt = nextBody.indexOf(REVIEW_END);
    if (startAt >= 0 && endAt >= startAt) {
      const prior = nextBody.slice(startAt, endAt + REVIEW_END.length);
      // Earlier analyst assessments can contain dissent and qualifications.
      // Keep them outside the managed block when replacing the current view.
      if (prior !== reviewed) {
        const historical = prior
          .replace(REVIEW_START, "")
          .replace(REVIEW_END, "")
          .replace("## Reviewed Synthesis", "## Historical Analyst Assessment")
          .trim();
        nextBody = `${nextBody.slice(0, startAt)}${historical}\n\n${nextBody.slice(startAt)}`;
      }
    }
    nextBody = replaceManagedBlock(nextBody, REVIEW_START, REVIEW_END, reviewed);
  }
  const confidence = synthesis ? synthesis.confidence.level : "low";
  const status = synthesis
    ? "active"
    : insightDoc.frontmatter.status === "draft"
      ? "draft"
      : "stale";
  const notice = [
    STATE_START,
    synthesis
      ? "**Current assessment:** see Reviewed Synthesis below. Earlier analyst text is retained as historical context."
      : "**Needs synthesis:** current source evidence has not been interpreted for this topic. Prior analyst conclusions below are historical; confidence is low pending reconsideration.",
    STATE_END,
  ].join("\n");
  nextBody = nextBody.includes(STATE_START)
    ? replaceManagedBlock(nextBody, STATE_START, STATE_END, notice)
    : `${notice}\n\n${nextBody}`;
  const nextFrontmatter = {
    ...insightDoc.frontmatter,
    last_updated: now,
    status,
    confidence,
    synthesis_state: synthesis ? "reviewed" : "needs-synthesis",
    source_snapshots: snapshots,
  };
  // Selection changes may have been saved before an unavailable dependency
  // prevented digesting. Clear pending work only in this successful write.
  delete nextFrontmatter.digest_pending;
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
    action: synthesis ? "synthesis-updated" : "digest-updated",
    confidence,
    status,
    synthesis_state: nextFrontmatter.synthesis_state,
    semantic_quality_verified: false,
  };
}

function rewriteInsights(pmDir, rawPayload, options = {}) {
  const targets = normalizePayload(rawPayload);
  const now = options.now || todayIso();
  return {
    insights: targets.map((target) => {
      try {
        return rewriteSingleInsight(pmDir, target, now, options);
      } catch (error) {
        return { insightPath: target.insightPath, action: "error", reason: error.message };
      }
    }),
  };
}

function projectInsightUpdates(pmDir, results) {
  const updated = results.insights.filter((result) =>
    ["digest-updated", "synthesis-updated"].includes(result.action)
  );
  if (!updated.length) return;
  // Load lazily: the writeback helper also depends on routing suggestions.
  const { upsertIndex } = require("./knowledge-writeback.js");
  for (const result of updated) {
    const doc = loadMarkdown(path.join(pmDir, result.insightPath));
    const indexPath = path.join(pmDir, path.dirname(result.insightPath), "index.md");
    const fileName = path.basename(result.insightPath);
    const priorRow = fs.existsSync(indexPath)
      ? fs
          .readFileSync(indexPath, "utf8")
          .split(/\r?\n/)
          .find((line) => line.includes(`](${fileName})`))
      : "";
    const description = priorRow
      ? priorRow.split("|")[2].trim()
      : doc.frontmatter.topic || fileName;
    upsertIndex(
      indexPath,
      fileName,
      description,
      doc.frontmatter.last_updated,
      doc.frontmatter.status
    );
  }
  const { execFileSync } = require("node:child_process");
  execFileSync(
    process.execPath,
    [path.join(__dirname, "hot-index.js"), "--dir", pmDir, "--generate"],
    { encoding: "utf8" }
  );
}

function main() {
  const index = process.argv.indexOf("--pm-dir");
  if (index < 0 || !process.argv[index + 1]) throw new Error("--pm-dir is required");
  const pmDir = path.resolve(process.argv[index + 1]);
  const results = rewriteInsights(pmDir, JSON.parse(readStdin()));
  projectInsightUpdates(pmDir, results);
  process.stdout.write(`${JSON.stringify(results)}\n`);
}
module.exports = {
  buildSourceDigest,
  extractFindings,
  ensureSourcePath,
  loadSourceDocument,
  sourceFingerprint,
  validateSelections,
  rewriteInsights,
};
if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
