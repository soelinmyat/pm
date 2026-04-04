#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

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

function hasKnowledgeBaseContent(pmDir) {
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

function attentionSummary(staleCount, agingCount) {
  if (staleCount === 0 && agingCount === 0) {
    return "all fresh";
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

function describeDevSession(kind, filePath, text, stat) {
  const baseName = path.basename(filePath, ".md");
  const stage = markdownTableValue(text, "Stage") || bulletValue(text, "Stage") || "active";
  const nextAction = bulletValue(text, "Next action");
  const ticket = markdownTableValue(text, "Ticket") || markdownTableValue(text, "Parent Issue");
  const parentTitle = markdownTableValue(text, "Parent Title");
  const currentSubIssue = bulletValue(text, "Current sub-issue");

  let label = ticket || baseName;
  if (kind === "epic" && parentTitle) {
    label = `${ticket || "epic"}: ${parentTitle}`;
  } else if (kind === "bugfix") {
    label = `bug-fix batch: ${baseName.replace(/^bugfix-/, "")}`;
  }

  let summary = `delivery in progress: ${label} (${stage})`;
  if (kind === "epic" && currentSubIssue) {
    summary = `epic in progress: ${label} — ${currentSubIssue}`;
  }
  if (kind === "bugfix") {
    summary = `bug-fix in progress: ${label}`;
  }

  return {
    kind: kind === "single" ? "dev" : kind,
    filePath,
    stage,
    updated: "",
    updatedEpoch: Math.floor(stat.mtimeMs / 1000),
    summary,
    next: nextAction || `resume active ${kind === "single" ? "delivery" : kind} work`,
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
    const baseName = path.basename(filePath);
    const kind =
      baseName.startsWith("epic-") || baseName.startsWith(".dev-epic-state-")
        ? "epic"
        : baseName.startsWith("bugfix-")
          ? "bugfix"
          : "single";

    const session = describeDevSession(kind, filePath, text, stat);
    if (!best || session.updatedEpoch > best.updatedEpoch) {
      best = session;
    }
  }

  return best;
}

function buildStatus(projectDir) {
  const runtimeDir = path.join(projectDir, ".pm");
  const pmDir = path.join(projectDir, "pm");
  const initialized =
    fileExists(pmDir) &&
    (fileExists(path.join(runtimeDir, "config.json")) || hasKnowledgeBaseContent(pmDir));

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

  if (!initialized) {
    return {
      initialized: false,
      update,
      focus: "PM is not initialized yet",
      backlog: "",
      next: "/pm:start to initialize PM",
      alternatives: [],
      active: null,
      counts: {
        stale: 0,
        agingIdeas: 0,
        ideas: 0,
        inProgress: 0,
        shipped: 0,
        researchTopics: 0,
        competitorProfiles: 0,
      },
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const staleThreshold = now - 30 * 86400;
  const agingThreshold = now - 14 * 86400;

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

  let agingIdeas = 0;
  let ideas = 0;
  let inProgress = 0;
  let shipped = 0;
  let oldestInProgress = null;
  let oldestIdea = null;

  for (const entry of backlogEntries(pmDir)) {
    const status = entry.status;
    if (status === "idea" || status === "drafted") {
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

  const hasLandscape = fileExists(path.join(pmDir, "landscape.md"));
  const hasStrategy = fileExists(path.join(pmDir, "strategy.md"));
  const emptyWorkspace =
    !hasLandscape &&
    !hasStrategy &&
    researchTopics === 0 &&
    competitorProfiles === 0 &&
    ideas === 0 &&
    inProgress === 0 &&
    shipped === 0;

  const groomSession = detectGroomSession(runtimeDir);
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
    pushSuggestion("/pm:start (choose your first workflow)");
  } else {
    if (!hasStrategy && (hasLandscape || researchTopics > 0 || competitorProfiles > 0)) {
      pushSuggestion("/pm:strategy");
    }

    if (staleCount > 0) {
      pushSuggestion(`/pm:refresh (${staleCount} stale items)`);
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

    if (oldestIdea) {
      pushSuggestion(`/pm:groom ${oldestIdea.slug}`);
    } else if (!active && staleCount === 0 && inProgress === 0) {
      pushSuggestion("/pm:groom ideate");
    }
  }

  const [next = "/pm:start (choose your first workflow)", ...alternatives] = suggestions;
  const focus = active ? active.summary : attentionSummary(staleCount, agingIdeas);

  return {
    initialized: true,
    update,
    focus,
    backlog: `${ideas} ideas, ${inProgress} in progress, ${shipped} shipped`,
    next,
    alternatives: alternatives.slice(0, 2),
    active,
    counts: {
      stale: staleCount,
      agingIdeas,
      ideas,
      inProgress,
      shipped,
      researchTopics,
      competitorProfiles,
    },
  };
}

function renderTextStatus(status, options = {}) {
  const lines = [];

  if (options.includeUpdate && status.update.available) {
    lines.push(`Update: ${status.update.message}`);
  }

  if (status.focus) {
    lines.push(`Focus: ${status.focus}`);
  }

  if (status.backlog) {
    lines.push(`Backlog: ${status.backlog}`);
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
};
