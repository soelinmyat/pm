#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  ensureEvidencePath,
  ensureInsightPath,
  loadMarkdown,
  readStdin,
  todayIso,
  writeAtomic,
  writeMarkdown,
} = require("./kb-utils.js");
const { upsertIndex } = require("./knowledge-writeback.js");
const { rewriteInsights } = require("./insight-rewrite.js");

const HOT_INDEX_SCRIPT = path.join(__dirname, "hot-index.js");

function parseArgs(argv) {
  const opts = {
    pmDir: null,
    skipHotIndex: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--pm-dir") {
      opts.pmDir = argv[++i];
      continue;
    }
    if (arg === "--skip-hot-index") {
      opts.skipHotIndex = true;
    }
  }

  return opts;
}

function ensureUnique(list, value) {
  return Array.isArray(list) && list.includes(value)
    ? list.slice()
    : [...(Array.isArray(list) ? list : []), value];
}

function titleCaseDomain(domain) {
  return domain
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function ensureInsightArtifacts(pmDir, domain) {
  const domainDir = path.join(pmDir, "insights", domain);
  const indexPath = path.join(domainDir, "index.md");
  const logPath = path.join(domainDir, "log.md");
  fs.mkdirSync(domainDir, { recursive: true });

  if (!fs.existsSync(indexPath)) {
    writeAtomic(
      indexPath,
      `# ${titleCaseDomain(domain)} Insights\n\n| Topic/Source | Description | Updated | Status |\n|---|---|---|---|\n`
    );
  }
  if (!fs.existsSync(logPath)) {
    writeAtomic(logPath, "");
  }

  return { domainDir, indexPath, logPath };
}

function appendLog(logPath, line) {
  const existing = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
  const content = existing ? `${existing.trimEnd()}\n${line}\n` : `${line}\n`;
  writeAtomic(logPath, content);
}

function buildSeedBody(topic) {
  return `# ${topic}\n\nSeeded from routed evidence. Synthesis refresh pending.\n`;
}

function normalizePayload(rawPayload) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const routes = Array.isArray(payload.routes)
    ? payload.routes
    : payload.route
      ? [payload.route]
      : [];

  if (routes.length === 0) {
    throw new Error("routes must contain at least one routing decision");
  }

  return routes.map((rawRoute) => {
    const route = rawRoute && typeof rawRoute === "object" ? rawRoute : {};
    const evidencePath = ensureEvidencePath(route.evidencePath || route.evidence || "");
    const insightPath = ensureInsightPath(route.insightPath || route.insight || "");
    const segments = insightPath.split("/");
    const domain = route.domain || segments[1];
    const topic =
      typeof route.topic === "string" && route.topic.trim()
        ? route.topic.trim()
        : path.basename(insightPath, ".md").replace(/[-_]/g, " ");
    const mode = route.mode || (route.create === true ? "new" : "existing");
    const description =
      typeof route.description === "string" && route.description.trim()
        ? route.description.trim()
        : topic;

    if (!domain) {
      throw new Error(`could not infer insight domain for "${insightPath}"`);
    }
    if (!["existing", "new"].includes(mode)) {
      throw new Error(`unsupported route mode "${mode}"`);
    }
    if (mode === "new" && (!topic || !description)) {
      throw new Error("new routes require topic and description");
    }

    return {
      mode,
      evidencePath,
      insightPath,
      domain,
      topic,
      description,
    };
  });
}

function applySingleRoute(pmDir, route, now) {
  const evidenceAbsolute = path.join(pmDir, route.evidencePath);
  if (!fs.existsSync(evidenceAbsolute)) {
    throw new Error(`missing evidence file "${route.evidencePath}"`);
  }

  const evidenceDoc = loadMarkdown(evidenceAbsolute);
  if (evidenceDoc.frontmatter.type !== "evidence") {
    throw new Error(`expected evidence file at "${route.evidencePath}"`);
  }

  const insightAbsolute = path.join(pmDir, route.insightPath);
  const insightExists = fs.existsSync(insightAbsolute);
  if (route.mode === "existing" && !insightExists) {
    throw new Error(`missing insight file "${route.insightPath}"`);
  }

  const { indexPath, logPath } = ensureInsightArtifacts(pmDir, route.domain);
  const evidenceLogPath = path.join(pmDir, "evidence", "log.md");
  const researchLogPath = path.join(pmDir, "evidence", "research", "log.md");

  let action = "skipped";
  let insightStatus = "draft";
  let citeChanged = false;
  let createLogged = false;
  let addedSource = false;

  if (route.mode === "new" && !insightExists) {
    const frontmatter = {
      type: "insight",
      domain: route.domain,
      topic: route.topic,
      last_updated: now,
      status: "draft",
      confidence: "low",
      sources: [route.evidencePath],
    };
    writeMarkdown(insightAbsolute, frontmatter, buildSeedBody(route.topic), [
      "type",
      "domain",
      "topic",
      "last_updated",
      "status",
      "confidence",
      "sources",
    ]);
    action = "created";
    insightStatus = "draft";
    citeChanged = true;
    addedSource = true;
    appendLog(logPath, `${now} create ${route.insightPath}`);
    createLogged = true;
  } else {
    const insightDoc = loadMarkdown(insightAbsolute);
    if (insightDoc.frontmatter.type !== "insight") {
      throw new Error(`expected insight file at "${route.insightPath}"`);
    }

    const nextSources = ensureUnique(insightDoc.frontmatter.sources, route.evidencePath);
    addedSource =
      nextSources.length !==
      (Array.isArray(insightDoc.frontmatter.sources) ? insightDoc.frontmatter.sources.length : 0);

    if (addedSource) {
      const nextFrontmatter = {
        ...insightDoc.frontmatter,
        last_updated: now,
        sources: nextSources,
      };
      writeMarkdown(insightAbsolute, nextFrontmatter, insightDoc.body, [
        "type",
        "domain",
        "topic",
        "last_updated",
        "status",
        "confidence",
        "sources",
      ]);
      action = "updated";
      citeChanged = true;
    }

    insightStatus = insightDoc.frontmatter.status || "draft";
  }

  const nextCitedBy = ensureUnique(evidenceDoc.frontmatter.cited_by, route.insightPath);
  const addedCitation =
    nextCitedBy.length !==
    (Array.isArray(evidenceDoc.frontmatter.cited_by) ? evidenceDoc.frontmatter.cited_by.length : 0);

  if (addedCitation) {
    const nextEvidenceFrontmatter = {
      ...evidenceDoc.frontmatter,
      cited_by: nextCitedBy,
    };
    writeMarkdown(evidenceAbsolute, nextEvidenceFrontmatter, evidenceDoc.body, [
      "type",
      "evidence_type",
      "topic",
      "source_origin",
      "created",
      "updated",
      "sources",
      "cited_by",
    ]);
    citeChanged = true;
    if (action === "skipped") {
      action = "updated";
    }
  }

  upsertIndex(indexPath, path.basename(route.insightPath), route.description, now, insightStatus);

  if (citeChanged) {
    if (!createLogged) {
      appendLog(logPath, `${now} cite ${route.insightPath} -> ${route.evidencePath}`);
    }
    appendLog(evidenceLogPath, `${now} cite ${route.insightPath} -> ${route.evidencePath}`);
    appendLog(researchLogPath, `${now} cite ${route.insightPath} -> ${route.evidencePath}`);
  }

  return {
    evidencePath: route.evidencePath,
    insightPath: route.insightPath,
    action,
    addedSource,
    addedCitation,
    rewriteCandidate: route.mode === "existing" && addedSource,
  };
}

function applyRoutes(pmDir, rawPayload, options = {}) {
  const routes = normalizePayload(rawPayload);
  const now = todayIso();
  const results = routes.map((route) => applySingleRoute(pmDir, route, now));
  const rewriteTargets = Array.from(
    new Set(results.filter((result) => result.rewriteCandidate).map((result) => result.insightPath))
  );
  const rewriteResult =
    rewriteTargets.length > 0
      ? rewriteInsights(pmDir, { insights: rewriteTargets }, { now })
      : { insights: [] };
  const didGenerateHotIndex =
    !options.skipHotIndex && results.some((result) => result.action !== "skipped");

  if (didGenerateHotIndex) {
    execFileSync("node", [HOT_INDEX_SCRIPT, "--dir", pmDir, "--generate"], { encoding: "utf8" });
  }

  return {
    routes: results,
    rewrites: rewriteResult.insights,
    hotIndexGenerated: didGenerateHotIndex,
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
    const result = applyRoutes(path.resolve(opts.pmDir), payload, {
      skipHotIndex: opts.skipHotIndex,
    });
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
  applyRoutes,
  normalizePayload,
};
