#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { classifyEpoch } = require("./kb-health-thresholds.js");
const { parseFrontmatter } = require("./kb-frontmatter.js");

function parseArgs(argv) {
  const options = {
    projectDir: process.cwd(),
    format: "json",
    includeUpdate: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--project-dir") {
      options.projectDir = argv[i + 1];
      i += 1;
    } else if (arg === "--format") {
      options.format = argv[i + 1];
      i += 1;
    } else if (arg === "--include-update") {
      options.includeUpdate = true;
    }
  }

  return options;
}

function resolvePmDir(projectDir) {
  const fallback = path.join(projectDir, "pm");
  const configPath = path.join(projectDir, ".pm", "config.json");

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return fallback;
  }

  if (!config || typeof config !== "object" || !config.pm_repo) {
    return fallback;
  }

  const pmRepo = config.pm_repo;

  if (pmRepo.type && pmRepo.type !== "local") {
    throw new Error(`Remote repos not yet supported (pm_repo.type: "${pmRepo.type}")`);
  }

  if (!pmRepo.path) {
    return fallback;
  }

  const configDir = path.dirname(configPath);
  const resolvedRoot = path.resolve(configDir, pmRepo.path);

  // Self-referential config: resolved path equals project dir — use same-repo mode
  if (resolvedRoot === path.resolve(projectDir)) {
    return fallback;
  }

  const resolvedPmDir = path.join(resolvedRoot, "pm");

  try {
    fs.accessSync(resolvedRoot, fs.constants.F_OK);
  } catch {
    return fallback;
  }

  return resolvedPmDir;
}

function safeRead(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function extractFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  return match ? match[1] : "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function frontmatterValue(text, key) {
  const frontmatter = extractFrontmatter(text);
  if (!frontmatter) {
    return "";
  }

  const match = frontmatter.match(new RegExp(`^${escapeRegExp(key)}:\\s*"?([^"\\n]+)"?$`, "m"));
  return match ? match[1].trim() : "";
}

function markdownTableValue(text, field) {
  const match = text.match(
    new RegExp(`^\\|\\s*${escapeRegExp(field)}\\s*\\|\\s*(.*?)\\s*\\|$`, "m")
  );
  return match ? match[1].trim() : "";
}

function bulletValue(text, label) {
  const match = text.match(new RegExp(`^-\\s*${escapeRegExp(label)}:\\s*(.+)$`, "m"));
  return match ? match[1].trim() : "";
}

function dateToEpoch(dateStr) {
  if (!dateStr) {
    return 0;
  }

  const parsed = Date.parse(dateStr);
  return Number.isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

function listMarkdownFiles(dirPath) {
  if (!fileExists(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(dirPath, entry.name));
}

function listMarkdownFilesRecursive(dirPath) {
  if (!fileExists(dirPath)) {
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

function listDirectories(dirPath) {
  if (!fileExists(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dirPath, entry.name));
}

function isKnowledgeBaseDocument(filePath) {
  const baseName = path.basename(filePath);
  return baseName.endsWith(".md") && baseName !== "index.md" && baseName !== "log.md";
}

function parseFrontmatterData(text) {
  try {
    const parsed = parseFrontmatter(text);
    return parsed.hasFrontmatter ? parsed.data : {};
  } catch {
    return {};
  }
}

function formatCount(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function relativeKbPath(pmDir, filePath) {
  return path.relative(pmDir, filePath).split(path.sep).join("/");
}

function listInsightDomains(pmDir) {
  const insightsDir = path.join(pmDir, "insights");
  return listDirectories(insightsDir).filter((dirPath) =>
    fileExists(path.join(dirPath, "index.md"))
  );
}

function hasLegacyKnowledgeBaseContent(pmDir) {
  if (!fileExists(pmDir)) {
    return false;
  }

  if (fileExists(path.join(pmDir, "landscape.md")) || fileExists(path.join(pmDir, "strategy.md"))) {
    return true;
  }

  const checkDir = (dirPath, predicate) => {
    if (!fileExists(dirPath)) {
      return false;
    }
    return fs.readdirSync(dirPath, { withFileTypes: true }).some(predicate);
  };

  if (
    checkDir(path.join(pmDir, "backlog"), (entry) => entry.isFile() && entry.name.endsWith(".md"))
  ) {
    return true;
  }

  if (checkDir(path.join(pmDir, "research"), (entry) => entry.isDirectory())) {
    return true;
  }

  return checkDir(path.join(pmDir, "competitors"), (entry) => entry.isDirectory());
}

function hasLayeredKnowledgeBaseContent(pmDir) {
  if (!fileExists(pmDir)) {
    return false;
  }

  if (fileExists(path.join(pmDir, "strategy.md"))) {
    return true;
  }

  if (listInsightDomains(pmDir).length > 0) {
    return true;
  }

  const evidenceDir = path.join(pmDir, "evidence");
  return (
    fileExists(path.join(evidenceDir, "index.md")) ||
    listMarkdownFilesRecursive(evidenceDir).some((filePath) => isKnowledgeBaseDocument(filePath))
  );
}

function detectKnowledgeBaseLayout(pmDir) {
  if (hasLayeredKnowledgeBaseContent(pmDir)) {
    return "layered";
  }
  if (hasLegacyKnowledgeBaseContent(pmDir)) {
    return "legacy";
  }
  return "none";
}

function summarizeSignalTargets(pmDir, kbHealth) {
  const signals = kbHealth?.signals || {};
  const hungryInsights = Array.isArray(signals.hungryInsights?.items)
    ? signals.hungryInsights.items
        .slice()
        .sort((left, right) => {
          const leftDraft = left.status === "draft" ? 0 : 1;
          const rightDraft = right.status === "draft" ? 0 : 1;
          if (leftDraft !== rightDraft) return leftDraft - rightDraft;
          const leftLow = left.confidence === "low" ? 0 : 1;
          const rightLow = right.confidence === "low" ? 0 : 1;
          if (leftLow !== rightLow) return leftLow - rightLow;
          if ((left.sourceCount || 0) !== (right.sourceCount || 0)) {
            return (left.sourceCount || 0) - (right.sourceCount || 0);
          }
          return String(left.topic || "").localeCompare(String(right.topic || ""));
        })
        .slice(0, 3)
        .map((item) => ({
          topic: item.topic || path.basename(item.path, ".md"),
          path: relativeKbPath(pmDir, item.path),
          sourceCount: item.sourceCount || 0,
          status: item.status || "",
          confidence: item.confidence || "",
        }))
    : [];

  const uncitedEvidence = Array.isArray(signals.uncitedEvidence?.items)
    ? signals.uncitedEvidence.items
        .slice()
        .sort((left, right) => {
          if ((right.age_days || 0) !== (left.age_days || 0)) {
            return (right.age_days || 0) - (left.age_days || 0);
          }
          return String(left.path || "").localeCompare(String(right.path || ""));
        })
        .slice(0, 3)
        .map((item) => ({
          path: relativeKbPath(pmDir, item.path),
          ageDays: item.age_days || 0,
          level: item.level || "",
        }))
    : [];

  return { hungryInsights, uncitedEvidence };
}

function formatSignalSuggestion(command, verb, primary, total) {
  if (!primary) {
    return command;
  }
  if (total <= 1) {
    return `${command} (${verb} ${primary})`;
  }
  return `${command} (${verb} ${primary} + ${total - 1} more)`;
}

function analyzeLayeredKnowledgeBase(pmDir) {
  let insightCount = 0;
  let evidenceCount = 0;
  let competitorProfiles = 0;
  let researchEvidence = 0;

  const insightsHealth = { total: 0, fresh: 0, aging: 0, stale: 0, items: [] };
  const researchHealth = { total: 0, fresh: 0, aging: 0, stale: 0, items: [] };
  const compoundingSignals = {
    hungryInsights: { total: 0, items: [] },
    uncitedEvidence: { total: 0, items: [] },
  };

  const nowSecs = Math.floor(Date.now() / 1000);

  for (const domainDir of listInsightDomains(pmDir)) {
    const domainName = path.basename(domainDir);
    const insightFiles = listMarkdownFilesRecursive(domainDir).filter((filePath) =>
      isKnowledgeBaseDocument(filePath)
    );

    insightCount += insightFiles.length;

    if (domainName === "competitors") {
      for (const childDir of listDirectories(domainDir)) {
        const hasDocs = listMarkdownFilesRecursive(childDir).some((filePath) =>
          isKnowledgeBaseDocument(filePath)
        );
        if (hasDocs) {
          competitorProfiles += 1;
        }
      }

      if (competitorProfiles === 0) {
        competitorProfiles = insightFiles.length;
      }
    }

    for (const filePath of insightFiles) {
      const text = safeRead(filePath);
      const data = parseFrontmatterData(text);
      const updatedEpoch = dateToEpoch(data.last_updated || data.updated || "");
      let level = "fresh";
      let ageDays = 0;
      if (updatedEpoch > 0) {
        level = classifyEpoch(updatedEpoch);
        ageDays = Math.floor((nowSecs - updatedEpoch) / 86400);
      }
      insightsHealth.total += 1;
      insightsHealth[level] += 1;
      insightsHealth.items.push({ path: filePath, domain: domainName, age_days: ageDays, level });

      const sourceCount = Array.isArray(data.sources) ? data.sources.length : 0;
      const status = typeof data.status === "string" ? data.status : "";
      const confidence = typeof data.confidence === "string" ? data.confidence : "";
      const isHungry = status === "draft" || confidence === "low" || sourceCount < 2;
      if (isHungry) {
        compoundingSignals.hungryInsights.total += 1;
        compoundingSignals.hungryInsights.items.push({
          path: filePath,
          domain: domainName,
          topic: data.topic || path.basename(filePath, ".md"),
          status,
          confidence,
          sourceCount,
        });
      }
    }
  }

  // Scan evidence/competitors/ — competitor profiles count as insights for health
  const evidenceCompetitorsDir = path.join(pmDir, "evidence", "competitors");
  if (fileExists(evidenceCompetitorsDir)) {
    const competitorFiles = listMarkdownFilesRecursive(evidenceCompetitorsDir).filter((filePath) =>
      isKnowledgeBaseDocument(filePath)
    );

    insightCount += competitorFiles.length;

    for (const childDir of listDirectories(evidenceCompetitorsDir)) {
      const hasDocs = listMarkdownFilesRecursive(childDir).some((filePath) =>
        isKnowledgeBaseDocument(filePath)
      );
      if (hasDocs) {
        competitorProfiles += 1;
      }
    }

    if (competitorProfiles === 0 && competitorFiles.length > 0) {
      competitorProfiles = competitorFiles.length;
    }

    for (const filePath of competitorFiles) {
      const text = safeRead(filePath);
      const data = parseFrontmatterData(text);
      const updatedEpoch = dateToEpoch(data.last_updated || data.updated || "");
      let level = "fresh";
      let ageDays = 0;
      if (updatedEpoch > 0) {
        level = classifyEpoch(updatedEpoch);
        ageDays = Math.floor((nowSecs - updatedEpoch) / 86400);
      }
      insightsHealth.total += 1;
      insightsHealth[level] += 1;
      insightsHealth.items.push({
        path: filePath,
        domain: "competitors",
        age_days: ageDays,
        level,
      });
    }
  }

  const evidenceDir = path.join(pmDir, "evidence");
  const evidenceFiles = listMarkdownFilesRecursive(evidenceDir).filter(
    (filePath) =>
      isKnowledgeBaseDocument(filePath) && !filePath.startsWith(evidenceCompetitorsDir + path.sep)
  );

  evidenceCount = evidenceFiles.length;

  const researchDir = path.join(evidenceDir, "research");
  researchEvidence = listMarkdownFilesRecursive(researchDir).filter((filePath) =>
    isKnowledgeBaseDocument(filePath)
  ).length;

  for (const filePath of evidenceFiles) {
    const text = safeRead(filePath);
    const data = parseFrontmatterData(text);
    const updatedEpoch = dateToEpoch(data.updated || data.last_updated || data.created || "");
    let level = "fresh";
    let ageDays = 0;
    if (updatedEpoch > 0) {
      level = classifyEpoch(updatedEpoch);
      ageDays = Math.floor((nowSecs - updatedEpoch) / 86400);
    }
    researchHealth.total += 1;
    researchHealth[level] += 1;
    researchHealth.items.push({ path: filePath, age_days: ageDays, level });

    if (filePath.startsWith(researchDir + path.sep)) {
      const citedBy = Array.isArray(data.cited_by) ? data.cited_by : [];
      if (citedBy.length === 0) {
        compoundingSignals.uncitedEvidence.total += 1;
        compoundingSignals.uncitedEvidence.items.push({
          path: filePath,
          age_days: ageDays,
          level,
        });
      }
    }
  }

  const staleCount = insightsHealth.stale + researchHealth.stale;

  return {
    staleCount,
    insightCount,
    evidenceCount,
    competitorProfiles,
    researchEvidence,
    kbHealth: {
      insights: insightsHealth,
      research: researchHealth,
      signals: compoundingSignals,
    },
  };
}

function analyzeLegacyKnowledgeBase(pmDir, staleThreshold) {
  let staleCount = 0;
  let researchTopics = 0;
  let competitorProfiles = 0;

  const researchDir = path.join(pmDir, "research");
  if (fileExists(researchDir)) {
    for (const entry of fs.readdirSync(researchDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const findingsPath = path.join(researchDir, entry.name, "findings.md");
      if (!fileExists(findingsPath)) {
        continue;
      }
      researchTopics += 1;
      const text = safeRead(findingsPath);
      const updatedEpoch = dateToEpoch(frontmatterValue(text, "updated"));
      if (updatedEpoch > 0 && updatedEpoch < staleThreshold) {
        staleCount += 1;
      }
    }
  }

  const competitorsDir = path.join(pmDir, "competitors");
  if (fileExists(competitorsDir)) {
    for (const entry of fs.readdirSync(competitorsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const profilePath = path.join(competitorsDir, entry.name, "profile.md");
      if (!fileExists(profilePath)) {
        continue;
      }
      competitorProfiles += 1;
      const text = safeRead(profilePath);
      const updatedEpoch = dateToEpoch(frontmatterValue(text, "updated"));
      if (updatedEpoch > 0 && updatedEpoch < staleThreshold) {
        staleCount += 1;
      }
    }
  }

  return {
    staleCount,
    insightCount: researchTopics + competitorProfiles,
    evidenceCount: researchTopics,
    competitorProfiles,
    researchTopics,
  };
}

function backlogEntries(pmDir) {
  const backlogDir = path.join(pmDir, "backlog");
  return listMarkdownFiles(backlogDir).map((filePath) => {
    const text = safeRead(filePath);
    return {
      filePath,
      status: frontmatterValue(text, "status"),
      updated: frontmatterValue(text, "updated"),
      title: frontmatterValue(text, "title"),
    };
  });
}

function attentionSummary(staleCount, agingCount) {
  if (staleCount === 0 && agingCount === 0) {
    return "no attention needed";
  }
  if (staleCount > 0 && agingCount > 0) {
    return `${staleCount} stale, ${agingCount} aging ideas`;
  }
  if (staleCount > 0) {
    return `${staleCount} stale`;
  }
  return `${agingCount} aging ideas`;
}

function readUpdateStatus(runtimeDir, installedVersion) {
  const statusPath = path.join(runtimeDir, ".update_status");
  const text = safeRead(statusPath);
  if (!text) {
    return {
      available: false,
      installed: installedVersion || "",
      latest: "",
      message: "",
    };
  }

  const installed = (text.match(/^installed=(.+)$/m) || [])[1] || "";
  const latest = (text.match(/^latest=(.+)$/m) || [])[1] || "";
  if (!installed || !latest) {
    return {
      available: false,
      installed: installedVersion || "",
      latest: "",
      message: "",
    };
  }

  if (installedVersion && installed !== installedVersion) {
    return {
      available: false,
      installed: installedVersion,
      latest: "",
      message: "",
    };
  }

  const available = installed !== latest;
  return {
    available,
    installed,
    latest,
    message: available
      ? `v${installed} → v${latest} available. Update PM in your client. On Claude Code, run /plugin.`
      : "",
  };
}

function readSyncStatus(runtimeDir) {
  const empty = { lastSync: null, ok: null, mode: null };
  const text = safeRead(path.join(runtimeDir, "sync-status.json"));
  if (!text) {
    return empty;
  }

  try {
    const data = JSON.parse(text);
    return {
      lastSync: data.lastSync || null,
      ok: typeof data.ok === "boolean" ? data.ok : null,
      mode: data.mode || null,
    };
  } catch {
    return empty;
  }
}

function resolveSyncConfigured(projectDir, credentialsPath) {
  const configPath = path.join(projectDir, ".pm", "config.json");

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return false;
  }

  if (!config || !config.projectId) {
    return false;
  }

  if (config.sync && config.sync.enabled === false) {
    return false;
  }

  const credsPath = credentialsPath || path.join(os.homedir(), ".pm", "credentials");
  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));
  } catch {
    return false;
  }

  if (!creds || !creds.token) {
    return false;
  }

  return true;
}

function timeAgo(isoString) {
  if (!isoString) {
    return null;
  }

  const now = Date.now();
  const then = Date.parse(isoString);
  if (Number.isNaN(then)) {
    return null;
  }

  const diffSecs = Math.floor((now - then) / 1000);

  if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  }

  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function detectGroomSession(runtimeDir) {
  const sessionsDir = path.join(runtimeDir, "groom-sessions");
  const candidates = [];

  if (fileExists(sessionsDir)) {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        candidates.push(path.join(sessionsDir, entry.name));
      }
    }
  }

  const legacyPath = path.join(runtimeDir, ".groom-state.md");
  if (fileExists(legacyPath)) {
    candidates.push(legacyPath);
  }

  let best = null;
  for (const filePath of candidates) {
    const stat = safeStat(filePath);
    if (!stat) {
      continue;
    }
    const text = safeRead(filePath);
    const topic = frontmatterValue(text, "topic") || path.basename(filePath, ".md");
    const phase = frontmatterValue(text, "phase") || "active";
    const updated = frontmatterValue(text, "updated");
    const updatedEpoch = dateToEpoch(updated) || Math.floor(stat.mtimeMs / 1000);
    const session = {
      kind: "groom",
      filePath,
      topic,
      stage: phase,
      updated,
      updatedEpoch,
      summary: `groom in progress: ${topic} (${phase})`,
      next: `resume grooming (${topic})`,
    };
    if (!best || session.updatedEpoch > best.updatedEpoch) {
      best = session;
    }
  }

  return best;
}

function describeDevSession(filePath, text, stat) {
  const baseName = path.basename(filePath, ".md");
  const stage = markdownTableValue(text, "Stage") || bulletValue(text, "Stage") || "active";
  const nextAction = bulletValue(text, "Next action");
  const ticket = markdownTableValue(text, "Ticket") || markdownTableValue(text, "Parent Issue");
  const parentTitle = markdownTableValue(text, "Parent Title");
  const currentSubIssue = bulletValue(text, "Current sub-issue");

  const cleanName = baseName.replace(/^(epic|bugfix)-/, "");
  let label = ticket || cleanName;
  if (parentTitle) {
    label = `${ticket || cleanName}: ${parentTitle}`;
  }

  let summary = `delivery in progress: ${label} (${stage})`;
  if (currentSubIssue) {
    summary = `delivery in progress: ${label} — ${currentSubIssue} (${stage})`;
  }

  return {
    kind: "dev",
    filePath,
    stage,
    updated: "",
    updatedEpoch: Math.floor(stat.mtimeMs / 1000),
    summary,
    next: nextAction || "resume active delivery work",
  };
}

function detectDevSession(projectDir, runtimeDir) {
  const sessionsDir = path.join(runtimeDir, "dev-sessions");
  const candidates = [];

  if (fileExists(sessionsDir)) {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) {
        continue;
      }
      candidates.push(path.join(sessionsDir, entry.name));
    }
  }

  const legacyFiles = listMarkdownFiles(projectDir).filter((filePath) => {
    const name = path.basename(filePath);
    return name.startsWith(".dev-state-") || name.startsWith(".dev-epic-state-");
  });
  candidates.push(...legacyFiles);

  let best = null;

  for (const filePath of candidates) {
    const stat = safeStat(filePath);
    if (!stat) {
      continue;
    }

    const text = safeRead(filePath);

    const session = describeDevSession(filePath, text, stat);
    if (!best || session.updatedEpoch > best.updatedEpoch) {
      best = session;
    }
  }

  return best;
}

function buildStatus(projectDir, options) {
  const opts = options || {};
  const runtimeDir = path.join(projectDir, ".pm");
  const pmDir = resolvePmDir(projectDir);
  // In separate-repo mode, groom sessions live in the PM repo's .pm/
  const pmStateDir = path.join(path.dirname(pmDir), ".pm");
  const kbLayout = detectKnowledgeBaseLayout(pmDir);
  const initialized =
    fileExists(pmDir) && (fileExists(path.join(runtimeDir, "config.json")) || kbLayout !== "none");

  const installedPluginVersion = (() => {
    const pluginJsonPath = path.join(__dirname, "..", ".claude-plugin", "plugin.json");
    try {
      const plugin = JSON.parse(fs.readFileSync(pluginJsonPath, "utf8"));
      return plugin.version || "";
    } catch {
      return "";
    }
  })();

  const update = readUpdateStatus(runtimeDir, installedPluginVersion);

  const configured = resolveSyncConfigured(projectDir, opts.credentialsPath);
  const syncRaw = readSyncStatus(runtimeDir);
  const syncStatus = {
    configured,
    lastSync: syncRaw.lastSync,
    ok: syncRaw.ok,
    mode: syncRaw.mode,
    timeAgo: timeAgo(syncRaw.lastSync),
  };

  if (!initialized) {
    return {
      initialized: false,
      update,
      syncStatus,
      focus: "PM is not initialized yet",
      backlog: "",
      next: "/pm:start to initialize PM",
      alternatives: [],
      active: null,
      counts: {
        stale: 0,
        agingIdeas: 0,
        ideas: 0,
        planned: 0,
        inProgress: 0,
        shipped: 0,
        insights: 0,
        evidence: 0,
        researchTopics: 0,
        competitorProfiles: 0,
        hungryInsights: 0,
        uncitedEvidence: 0,
      },
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const staleThreshold = now - 30 * 86400;
  const agingThreshold = now - 14 * 86400;

  const knowledgeBase =
    kbLayout === "layered"
      ? analyzeLayeredKnowledgeBase(pmDir)
      : analyzeLegacyKnowledgeBase(pmDir, staleThreshold);
  const staleCount = knowledgeBase.staleCount;
  const insightCount = knowledgeBase.insightCount;
  const evidenceCount = knowledgeBase.evidenceCount;
  const researchTopics =
    kbLayout === "layered" ? knowledgeBase.researchEvidence : knowledgeBase.researchTopics;
  const competitorProfiles = knowledgeBase.competitorProfiles;
  const hungryInsights = knowledgeBase.kbHealth?.signals?.hungryInsights?.total || 0;
  const uncitedEvidence = knowledgeBase.kbHealth?.signals?.uncitedEvidence?.total || 0;
  const signalTargets = summarizeSignalTargets(pmDir, knowledgeBase.kbHealth);

  let agingIdeas = 0;
  let ideas = 0;
  let planned = 0;
  let inProgress = 0;
  let shipped = 0;
  let oldestInProgress = null;
  let oldestIdea = null;
  let oldestPlanned = null;

  for (const entry of backlogEntries(pmDir)) {
    const status = entry.status;
    if (status === "idea" || status === "drafted" || status === "proposed") {
      ideas += 1;
      const updatedEpoch = dateToEpoch(entry.updated);
      if (status === "idea" && updatedEpoch > 0 && updatedEpoch < agingThreshold) {
        agingIdeas += 1;
      }
      const candidateEpoch = updatedEpoch > 0 ? updatedEpoch : Number.MAX_SAFE_INTEGER;
      if (!oldestIdea || candidateEpoch < oldestIdea.updatedEpoch) {
        oldestIdea = {
          slug: path.basename(entry.filePath, ".md"),
          title: entry.title || path.basename(entry.filePath, ".md"),
          updatedEpoch: candidateEpoch,
        };
      }
    } else if (status === "planned") {
      planned += 1;
      const updatedEpoch = dateToEpoch(entry.updated);
      const candidateEpoch = updatedEpoch > 0 ? updatedEpoch : Number.MAX_SAFE_INTEGER;
      if (!oldestPlanned || candidateEpoch < oldestPlanned.updatedEpoch) {
        oldestPlanned = {
          slug: path.basename(entry.filePath, ".md"),
          title: entry.title || path.basename(entry.filePath, ".md"),
          updatedEpoch: candidateEpoch,
        };
      }
    } else if (status === "approved" || status === "in-progress") {
      inProgress += 1;
      const updatedEpoch = dateToEpoch(entry.updated);
      if (!oldestInProgress || (updatedEpoch > 0 && updatedEpoch < oldestInProgress.updatedEpoch)) {
        oldestInProgress = {
          title: entry.title || path.basename(entry.filePath, ".md"),
          updatedEpoch,
        };
      }
    } else if (status === "done") {
      shipped += 1;
    }
  }

  const hasLandscape =
    kbLayout === "layered"
      ? fileExists(path.join(pmDir, "insights", "business", "landscape.md"))
      : fileExists(path.join(pmDir, "landscape.md"));
  const hasStrategy = fileExists(path.join(pmDir, "strategy.md"));
  const emptyWorkspace =
    !hasLandscape &&
    !hasStrategy &&
    insightCount === 0 &&
    evidenceCount === 0 &&
    ideas === 0 &&
    inProgress === 0 &&
    shipped === 0;

  const groomSession = detectGroomSession(pmStateDir);
  const devSession = detectDevSession(projectDir, runtimeDir);
  const active = (() => {
    if (devSession && groomSession) {
      return devSession.updatedEpoch >= groomSession.updatedEpoch ? devSession : groomSession;
    }
    return devSession || groomSession;
  })();

  const suggestions = [];
  const pushSuggestion = (action) => {
    if (!action || suggestions.includes(action)) {
      return;
    }
    suggestions.push(action);
  };

  if (active) {
    pushSuggestion(active.next);
  }

  if (emptyWorkspace) {
    pushSuggestion("/pm:think (explore a product idea)");
  } else {
    if (!hasStrategy && (hasLandscape || insightCount > 0 || evidenceCount > 0)) {
      pushSuggestion("/pm:strategy");
    }

    if (staleCount > 0) {
      pushSuggestion(`/pm:refresh (${staleCount} stale items)`);
    }

    if (uncitedEvidence > 0) {
      const primaryUncited = signalTargets.uncitedEvidence[0]?.path || "";
      pushSuggestion(
        formatSignalSuggestion("/pm:refresh", "route", primaryUncited, uncitedEvidence)
      );
    }

    if (hungryInsights > 0) {
      const primaryHungry = signalTargets.hungryInsights[0]?.topic || "";
      pushSuggestion(formatSignalSuggestion("/pm:research", "feed", primaryHungry, hungryInsights));
    }

    if (agingIdeas > 3) {
      pushSuggestion("/pm:groom (promote oldest ideas)");
    }

    if (!active && inProgress > 0) {
      pushSuggestion(
        oldestInProgress
          ? `resume in-progress work (${oldestInProgress.title})`
          : "resume in-progress work"
      );
    }

    if (planned > 0 && oldestPlanned) {
      pushSuggestion(`/pm:dev ${oldestPlanned.slug} (RFC ready, ${planned} planned)`);
    }

    if (oldestIdea) {
      pushSuggestion(`/pm:groom ${oldestIdea.slug}`);
    } else if (!active && staleCount === 0 && inProgress === 0) {
      pushSuggestion("/pm:groom ideate");
    }
  }

  const [next = "/pm:think (explore a product idea)", ...alternatives] = suggestions;
  const focus = active ? active.summary : attentionSummary(staleCount, agingIdeas);

  return {
    initialized: true,
    update,
    syncStatus,
    focus,
    backlog: `${ideas} ideas, ${planned} planned, ${inProgress} in progress, ${shipped} shipped`,
    next,
    alternatives: alternatives.slice(0, 2),
    active,
    counts: {
      stale: staleCount,
      agingIdeas,
      ideas,
      planned,
      inProgress,
      shipped,
      insights: insightCount,
      evidence: evidenceCount,
      researchTopics,
      competitorProfiles,
      hungryInsights,
      uncitedEvidence,
    },
    signalTargets,
    ...(knowledgeBase.kbHealth ? { kbHealth: knowledgeBase.kbHealth } : {}),
  };
}

function renderKbHealthLine(kbHealth) {
  if (!kbHealth) {
    return "";
  }
  const { insights, research } = kbHealth;
  const signals = kbHealth.signals || {
    hungryInsights: { total: 0 },
    uncitedEvidence: { total: 0 },
  };
  const hasIssues =
    insights.aging > 0 || insights.stale > 0 || research.aging > 0 || research.stale > 0;

  const parts = [];
  if (hasIssues) {
    const insightParts = [];
    if (insights.stale > 0) insightParts.push(`${insights.stale} stale`);
    if (insights.aging > 0) insightParts.push(`${insights.aging} aging`);
    if (insightParts.length > 0) {
      parts.push(`Insights: ${insightParts.join(", ")}`);
    }

    const researchParts = [];
    if (research.stale > 0) researchParts.push(`${research.stale} stale`);
    if (research.aging > 0) researchParts.push(`${research.aging} aging`);
    if (researchParts.length > 0) {
      parts.push(`Research: ${researchParts.join(", ")}`);
    }
  } else if (insights.total === 0 && research.total === 0) {
    return "";
  } else {
    parts.push("All fresh");
  }

  const signalParts = [];
  if (signals.hungryInsights.total > 0) {
    signalParts.push(
      formatCount(signals.hungryInsights.total, "hungry insight", "hungry insights")
    );
  }
  if (signals.uncitedEvidence.total > 0) {
    signalParts.push(
      formatCount(signals.uncitedEvidence.total, "uncited evidence file", "uncited evidence files")
    );
  }
  if (signalParts.length > 0) {
    parts.push(`Signals: ${signalParts.join(", ")}`);
  }

  return parts.length > 0 ? `KB: ${parts.join(" | ")}` : "";
}

function renderDashboardLine(syncStatus) {
  if (!syncStatus || !syncStatus.configured) {
    return "Dashboard: not configured \u2014 set up at productmemory.io";
  }

  if (syncStatus.lastSync === null && syncStatus.ok === null) {
    return "Dashboard: syncing...";
  }

  if (syncStatus.ok === false) {
    return "Dashboard: last sync failed";
  }

  return `Dashboard: synced ${syncStatus.timeAgo || "just now"}`;
}

function renderTextStatus(status, options = {}) {
  const lines = [];

  if (options.includeUpdate && status.update.available) {
    lines.push(`Update: ${status.update.message}`);
  }

  lines.push(renderDashboardLine(status.syncStatus));

  if (status.focus) {
    lines.push(`Focus: ${status.focus}`);
  }

  if (status.backlog) {
    lines.push(`Backlog: ${status.backlog}`);
  }

  const kbLine = renderKbHealthLine(status.kbHealth);
  if (kbLine) {
    lines.push(kbLine);
  }

  const hungryTargets = Array.isArray(status.signalTargets?.hungryInsights)
    ? status.signalTargets.hungryInsights
    : [];
  const uncitedTargets = Array.isArray(status.signalTargets?.uncitedEvidence)
    ? status.signalTargets.uncitedEvidence
    : [];
  if (hungryTargets.length > 0) {
    const label = hungryTargets.map((item) => item.topic).join(", ");
    lines.push(`Research targets: ${label}`);
  }
  if (uncitedTargets.length > 0) {
    const label = uncitedTargets.map((item) => item.path).join(", ");
    lines.push(`Refresh targets: ${label}`);
  }

  if (status.next) {
    lines.push(`Next: ${status.next}`);
  }

  if (Array.isArray(status.alternatives)) {
    for (const alternative of status.alternatives) {
      lines.push(`Also: ${alternative}`);
    }
  }

  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const projectDir = path.resolve(options.projectDir);
  const status = buildStatus(projectDir);

  if (options.format === "text") {
    process.stdout.write(`${renderTextStatus(status, { includeUpdate: options.includeUpdate })}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(status)}\n`);
}

if (require.main === module) {
  main();
}

module.exports = {
  buildStatus,
  renderTextStatus,
  resolvePmDir,
  readSyncStatus,
  resolveSyncConfigured,
  timeAgo,
};
