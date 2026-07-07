#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { parseFrontmatter } = require("./kb-frontmatter.js");
const { parseCliArgs } = require("./loop-args.js");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { parseBooleanFlag, resolveKind } = require("./validate.js");
const { listDevSessions, listMarkdownFiles, safeRead, safeStat } = require("./lib/session-scan.js");
const { listLeases } = require("./loop-git.js");

const COLUMN_ORDER = [
  "shipping",
  "reviewing",
  "implementing",
  "ready_for_dev",
  "needs_rfc",
  "needs_research",
  "needs_human",
  "inbox",
  "blocked",
  "done",
];

function emptyColumns() {
  return Object.fromEntries(COLUMN_ORDER.map((name) => [name, []]));
}

function asBool(value) {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value !== "string") return false;
  return ["true", "yes", "y", "1", "approved"].includes(value.trim().toLowerCase());
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/_/g, "-");
}

function cardIdFor(filePath, data) {
  return data.id || data.linear_id || path.basename(filePath, ".md");
}

// Display-only fields carried on the card so surfaces (e.g. the board) need not
// re-read and re-parse the same frontmatter. Never affects column mapping.
function normalizeSize(value) {
  if (typeof value === "string") return value;
  return value === undefined || value === null ? "" : String(value);
}

function normalizePrs(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function hasImplementationApproval(data) {
  return (
    parseBooleanFlag(data.implementation_approved) === true &&
    typeof data.approved_by === "string" &&
    data.approved_by.trim() !== "" &&
    isIsoDate(data.approved_at)
  );
}

function relPath(baseDir, filePath) {
  const rel = path.relative(baseDir, filePath);
  return rel && !rel.startsWith("..") ? rel : filePath;
}

function updatedEpoch(filePath, data) {
  const parsed = Date.parse(data.updated || data.created || "");
  if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  const stat = safeStat(filePath);
  return stat ? Math.floor(stat.mtimeMs / 1000) : 0;
}

function stageToColumn(stage) {
  const normalized = normalizeStatus(stage);
  if (["ship", "shipping", "pr", "merge", "ci"].includes(normalized)) return "shipping";
  if (["review", "reviewing", "simplify", "code-review"].includes(normalized)) return "reviewing";
  if (
    ["dev", "develop", "implementation", "implementing", "in-progress", "active"].includes(
      normalized
    )
  ) {
    return "implementing";
  }
  if (normalized === "rfc") return "needs_rfc";
  if (["research", "groom", "grooming"].includes(normalized)) return "needs_research";
  return "implementing";
}

function classifyBacklogCard(card) {
  const status = normalizeStatus(card.status);

  if (["shipped", "done", "closed", "complete", "completed"].includes(status)) {
    return { column: "done" };
  }

  if (["blocked", "paused", "waiting"].includes(status)) {
    return { column: "blocked" };
  }

  if (["shipping", "ship", "ci", "merge"].includes(status)) {
    return { column: "shipping" };
  }

  if (["review", "reviewing", "simplify"].includes(status)) {
    return { column: "reviewing" };
  }

  if (["in-progress", "implementing", "implementation", "dev"].includes(status)) {
    return { column: "implementing" };
  }

  if (["idea", "captured", "draft", "drafted", "new"].includes(status)) {
    return { column: "inbox" };
  }

  if (card.kind === "proposal" && !card.rfc) {
    return {
      column: "needs_rfc",
      blocker: "proposal requires an RFC before implementation",
    };
  }

  if (!card.implementationApproved) {
    return {
      column: "needs_human",
      blocker: "implementation_approved: true required before loop can start dev",
    };
  }

  return { column: "ready_for_dev" };
}

function readBacklogCards(pmDir, sourceDir) {
  const backlogDir = path.join(pmDir, "backlog");
  return listMarkdownFiles(backlogDir)
    .filter((filePath) => path.basename(filePath) !== "index.md")
    .map((filePath) => {
      const text = safeRead(filePath);
      const { data, hasFrontmatter } = parseFrontmatter(text);
      const id = cardIdFor(filePath, data);
      const kind = resolveKind(data);
      const implementationApproved = hasImplementationApproval(data);
      const card = {
        id,
        slug: path.basename(filePath, ".md"),
        title: data.title || path.basename(filePath, ".md"),
        kind,
        status: data.status || "",
        priority: data.priority || "",
        rfc: data.rfc || "",
        branch: data.branch || "",
        size: normalizeSize(data.size),
        prs: normalizePrs(data.prs),
        parent: typeof data.parent === "string" ? data.parent : null,
        childrenSlugs: Array.isArray(data.children) ? data.children.map(String) : [],
        implementationApproved,
        updatedEpoch: updatedEpoch(filePath, data),
        sourcePath: filePath,
        relativePath: relPath(sourceDir, filePath),
        hasFrontmatter,
        origin: "backlog",
      };
      const invalidReasons = [];
      if (!hasFrontmatter) invalidReasons.push("missing backlog frontmatter");
      if (!data.id) invalidReasons.push("missing id");
      if (!data.title) invalidReasons.push("missing title");
      if (!data.status) invalidReasons.push("missing status");
      const classification =
        invalidReasons.length > 0
          ? {
              column: "needs_human",
              blocker: invalidReasons.join("; "),
            }
          : classifyBacklogCard(card);
      return {
        ...card,
        ...classification,
        command: commandFor(card, classification.column),
      };
    });
}

// Epic rules derived from the existing groom/RFC card relations: `parent`
// (child → epic) and the parent's ordered `children` list (= implementation
// order). Umbrella cards are never dispatchable; a child is dispatchable only
// when every earlier sibling is done. A referenced sibling with no card file
// counts as done — completed cards are deleted at retro close-out.
function applyFamilyRules(cards) {
  const DISPATCHABLE = new Set(["ready_for_dev", "needs_rfc", "needs_research", "inbox"]);
  const bySlug = new Map(
    cards.filter((card) => card.origin === "backlog").map((card) => [card.slug, card])
  );
  const isDone = (slug) => {
    const card = bySlug.get(slug);
    return !card || card.column === "done";
  };

  for (const card of cards) {
    if (card.lease || card.column === "done") continue;

    if (Array.isArray(card.childrenSlugs) && card.childrenSlugs.length > 0) {
      const doneCount = card.childrenSlugs.filter(isDone).length;
      if (doneCount < card.childrenSlugs.length) {
        card.column = "blocked";
        card.blocker = `epic umbrella: waiting on children (${doneCount}/${card.childrenSlugs.length} done)`;
      } else {
        card.column = "needs_human";
        card.blocker = "all children done — close out the epic parent";
      }
      card.command = "";
      continue;
    }

    if (card.parent && DISPATCHABLE.has(card.column)) {
      const parent = bySlug.get(card.parent);
      const siblings = parent && Array.isArray(parent.childrenSlugs) ? parent.childrenSlugs : [];
      const index = siblings.indexOf(card.slug);
      if (index > 0) {
        const pending = siblings.slice(0, index).filter((slug) => !isDone(slug));
        if (pending.length > 0) {
          card.column = "blocked";
          card.blocker = `waiting on earlier sibling(s): ${pending.join(", ")}`;
          card.command = "";
        }
      }
    }
  }
}

function blockDuplicateIds(cards) {
  const counts = new Map();
  for (const card of cards) {
    counts.set(card.id, (counts.get(card.id) || 0) + 1);
  }

  for (const card of cards) {
    if (counts.get(card.id) > 1) {
      card.column = "blocked";
      card.blocker = `duplicate card id "${card.id}"`;
      card.command = "";
    }
  }
}

function blockAmbiguousInProgress(cards) {
  for (const card of cards) {
    if (card.lease || card.origin !== "backlog") continue;
    const status = normalizeStatus(card.status);
    if (!["in-progress", "implementing", "implementation", "dev"].includes(status)) continue;
    if (card.branch && card.prs.length > 0) continue;

    card.column = "blocked";
    card.blocker = "in-progress without active lease or PR metadata";
    card.command = "";
  }
}

function commandFor(card, column) {
  if (column === "ready_for_dev" || column === "implementing") return `/pm:dev ${card.id}`;
  if (column === "shipping" || column === "reviewing") return `/pm:ship ${card.id}`;
  if (column === "needs_rfc") return `/pm:rfc ${card.id}`;
  if (column === "needs_research") return `/pm:research ${card.id}`;
  if (column === "inbox") return `/pm:groom ${card.id}`;
  return "";
}

function readSnapshotCards(pmDir, existingById, sourceDir) {
  const dir = path.join(pmDir, "loop", "session-snapshots");
  if (!fs.existsSync(dir)) return [];
  const cards = [];
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(dir, entry.name))
    .sort();

  for (const filePath of files) {
    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    const id = snapshot.card_id || snapshot.cardId || snapshot.id;
    if (!id) continue;
    const existing = existingById.get(id);
    if (existing) {
      existing.snapshot = snapshot;
      if (snapshot.stage) {
        existing.column = stageToColumn(snapshot.stage);
        existing.command = commandFor(existing, existing.column);
      }
      continue;
    }
    const card = {
      id,
      slug: path.basename(filePath, ".json"),
      title: snapshot.title || id,
      kind: snapshot.kind || "task",
      status: snapshot.status || snapshot.stage || "",
      priority: snapshot.priority || "",
      rfc: snapshot.rfc || "",
      branch: snapshot.branch || "",
      size: normalizeSize(snapshot.size),
      prs: normalizePrs(snapshot.prs),
      implementationApproved: hasImplementationApproval(snapshot),
      updatedEpoch:
        Math.floor(Date.parse(snapshot.updated_at || snapshot.updatedAt || "") / 1000) || 0,
      sourcePath: filePath,
      relativePath: relPath(sourceDir, filePath),
      origin: "loop-snapshot",
      snapshot,
      column: stageToColumn(snapshot.stage || snapshot.status || "active"),
    };
    card.command = commandFor(card, card.column);
    cards.push(card);
  }
  return cards;
}

function attachLeases(cards, pmDir, now) {
  const leases = listLeases(pmDir, { now });
  const byCard = new Map(cards.map((card) => [card.id, card]));
  for (const lease of leases) {
    if (!lease.valid_json || lease.expired) continue;
    const card = byCard.get(lease.card_id);
    if (!card) continue;
    card.lease = {
      stage: lease.stage,
      holder: lease.holder,
      runtime: lease.runtime,
      claimed_at: lease.claimed_at,
      expires_at: lease.expires_at,
      filePath: lease.filePath,
    };
    card.column = stageToColumn(lease.stage);
    card.command = commandFor(card, card.column);
  }
  return leases;
}

function collectLocalOnly(sourceDir) {
  return listDevSessions({ sourceDir }).map((session) => ({
    kind: session.kind,
    topic: session.topic,
    stage: session.stage,
    updatedEpoch: session.updatedEpoch,
    sourcePath: session.filePath,
  }));
}

function sortCards(cards) {
  return cards.sort((a, b) => {
    const priority = { critical: 4, high: 3, medium: 2, low: 1 };
    const ap = priority[String(a.priority || "").toLowerCase()] || 0;
    const bp = priority[String(b.priority || "").toLowerCase()] || 0;
    if (bp !== ap) return bp - ap;
    return b.updatedEpoch - a.updatedEpoch;
  });
}

function buildLoopBoard(projectDir, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const { pmDir, pmStateDir } = options.pmDir
    ? { pmDir: options.pmDir, pmStateDir: path.join(path.dirname(options.pmDir), ".pm") }
    : resolvePmPaths(projectDir);
  const sourceDir = options.sourceDir || projectDir;
  const cards = readBacklogCards(pmDir, sourceDir);
  const byId = new Map(cards.map((card) => [card.id, card]));
  cards.push(...readSnapshotCards(pmDir, byId, sourceDir));
  const leases = attachLeases(cards, pmDir, now);
  blockAmbiguousInProgress(cards);
  blockDuplicateIds(cards);
  applyFamilyRules(cards);

  const columns = emptyColumns();
  for (const card of sortCards(cards)) {
    const column = columns[card.column] ? card.column : "inbox";
    columns[column].push(card);
  }

  return {
    meta: {
      pmDir,
      pmStateDir,
      sourceDir,
      generatedAt: now.toISOString(),
      durableSource: "git",
    },
    columns,
    cards,
    leases: {
      active: leases.filter((lease) => lease.valid_json && !lease.expired),
      expired: leases.filter((lease) => lease.valid_json && lease.expired),
      invalid: leases.filter((lease) => !lease.valid_json),
    },
    localOnly: options.includeLocal ? collectLocalOnly(sourceDir) : [],
  };
}

function formatSummary(board) {
  const lines = [
    `Loop board (${board.meta.generatedAt})`,
    `pm: ${board.meta.pmDir}`,
    `source: ${board.meta.sourceDir}`,
  ];
  for (const column of COLUMN_ORDER) {
    const cards = board.columns[column] || [];
    lines.push("");
    lines.push(`${column} (${cards.length})`);
    for (const card of cards.slice(0, 7)) {
      const parts = [`- ${card.id}`, card.title, `[${card.kind}]`];
      if (card.blocker) parts.push(`blocked: ${card.blocker}`);
      if (card.command) parts.push(card.command);
      if (card.lease) parts.push(`lease: ${card.lease.holder}/${card.lease.stage}`);
      lines.push(parts.join("  "));
    }
    if (cards.length > 7) lines.push(`- ... and ${cards.length - 7} more`);
  }
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const defaults = {
    projectDir: process.cwd(),
    pmDir: "",
    format: "summary",
    includeLocal: false,
  };
  const { args } = parseCliArgs(
    argv,
    {
      "--project-dir": { key: "projectDir", type: "string" },
      "--pm-dir": { key: "pmDir", type: "string" },
      "--format": { key: "format", type: "string" },
      "--include-local": { key: "includeLocal", type: "boolean" },
    },
    defaults
  );
  args.projectDir = path.resolve(args.projectDir);
  if (args.pmDir) args.pmDir = path.resolve(args.pmDir);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const board = buildLoopBoard(args.projectDir, {
      pmDir: args.pmDir || undefined,
      includeLocal: args.includeLocal,
    });
    if (args.format === "json") {
      process.stdout.write(`${JSON.stringify(board, null, 2)}\n`);
    } else {
      process.stdout.write(formatSummary(board));
    }
  } catch (err) {
    process.stderr.write(`loop-board: ${err.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  COLUMN_ORDER,
  applyFamilyRules,
  asBool,
  buildLoopBoard,
  blockAmbiguousInProgress,
  hasImplementationApproval,
  classifyBacklogCard,
  formatSummary,
  normalizeStatus,
  stageToColumn,
};

if (require.main === module) {
  main();
}
