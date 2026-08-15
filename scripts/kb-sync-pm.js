"use strict";

// productmemory.io sync backend — the record-level alternative to kb-sync-git.js.
// Maps KB markdown files (evidence/, insights/, backlog/) onto productmemory
// records via the REST API, using sync_id for idempotent upserts. Non-record
// files (strategy.md, memory.md, product/, thinking/, HTML artifacts) are not
// synced — use the git backend when full-file fidelity matters.
//
// ponytail: deletes are not propagated in either direction; report-only.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { resolvePmPaths } = require("./resolve-pm-dir.js");
const { writeJsonAtomic } = require("./lib/atomic-file.js");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { parseNotesFile } = require("./note-helpers.js");

const DEFAULT_URL = "https://productmemory.io";
const CREDENTIALS_PATH = path.join(process.env.HOME || os.homedir(), ".pm", "credentials");
const CACHE_FILE = "sync-pm-cache.json";
const KB_TYPES = ["evidence", "research", "insight", "backlog_item"];

// Local KB status vocabulary → server BacklogItem::STATUSES. Covers every
// CANONICAL_CARD_STATUSES value (loop-card-state.js) plus the two server-only
// values for tolerance of hand-edited files.
const BACKLOG_STATUS = {
  idea: "idea",
  proposed: "planned",
  drafted: "planned",
  planned: "planned",
  "in-progress": "in-progress",
  shipping: "in-progress",
  "needs-human": "blocked",
  blocked: "blocked",
  done: "done",
  canceled: "canceled",
};
// Server status → local vocabulary, so pulled frontmatter always passes the
// validate.js status enum. Lossy mappings are safe: push skips files whose
// hash matches the pull cache, so a pull→push cycle never rewrites the server.
// ponytail: server "canceled" surfaces as needs-human; add a local canceled
// status to CANONICAL_CARD_STATUSES if cancellation becomes a local workflow.
const LOCAL_STATUS = {
  idea: "idea",
  planned: "planned",
  "in-progress": "in-progress",
  blocked: "needs-human",
  done: "done",
  canceled: "needs-human",
};
const PRIORITIES = ["critical", "high", "medium", "low"];
const SOURCE_ORIGINS = ["internal", "external", "mixed"];
const INSIGHT_STATUS = { draft: "draft", active: "active", stale: "stale" };
// evidence/ subdirectory → server Evidence::SOURCE_TYPES
const EVIDENCE_SOURCE_TYPES = {
  notes: "note",
  "user-feedback": "feedback",
  transcripts: "interview",
  competitors: "competitor",
};
const SERVER_SOURCE_TYPES = [
  "note",
  "interview",
  "support",
  "sales",
  "feedback",
  "web",
  "competitor",
  "observation",
  "other",
];

// ---------------------------------------------------------------------------
// Config + credentials
// ---------------------------------------------------------------------------

function resolveConfig(pmStateDir) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(pmStateDir, "config.json"), "utf8"));
  } catch {
    return { error: "no .pm/config.json found. Run /pm:sync setup." };
  }
  const sync = config.sync || {};
  if (sync.backend !== "productmemory") {
    return { error: "sync backend is not productmemory. Run /pm:sync setup." };
  }
  if (!sync.project) {
    return { error: "sync.project (productmemory project slug) missing. Run /pm:sync setup." };
  }
  const token = process.env.PRODUCTMEMORY_TOKEN || readCredentialToken();
  if (!token) {
    return {
      error: `no productmemory token. Add productmemory_token to ${CREDENTIALS_PATH} or run /pm:sync setup.`,
    };
  }
  return { url: (sync.url || DEFAULT_URL).replace(/\/+$/, ""), project: sync.project, token };
}

function readCredentialToken() {
  try {
    return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8")).productmemory_token || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Local scan — find record-shaped KB files and map them to record payloads
// ---------------------------------------------------------------------------

function scanKbFiles(pmDir) {
  const entries = [];
  walk(pmDir, "", (relPath) => {
    if (!relPath.toLowerCase().endsWith(".md")) return;
    const base = path.basename(relPath);
    if (base === "index.md" || base === "log.md") return;
    const content = fs.readFileSync(path.join(pmDir, relPath), "utf8");
    const { data: fm, body, hasFrontmatter } = parseFrontmatter(content);
    if (!hasFrontmatter) return;
    if (fm.type === "notes") {
      entries.push(...noteEntries(pmDir, relPath));
      return;
    }
    const mapped = toRecord(relPath, fm, body);
    if (mapped) entries.push({ relPath, content, hash: sha256(content), ...mapped });
  });
  return entries;
}

// Monthly note rollups (type: notes) expand into one evidence record per dated
// entry, keyed relPath#timestamp so appending a note re-pushes only new entries.
// These are push-only — pull skips them (see the ".md#" guard there).
// ponytail: minute-precision timestamps are the entry identity (same convention
// as promoteNote) — two notes in the same minute collapse into one server
// record; the rollup file stays the source of truth. Suffix-dedup if it bites.
function noteEntries(pmDir, relPath) {
  const { entries } = parseNotesFile(path.join(pmDir, relPath));
  return entries.map((entry) => {
    const title = `Note ${entry.timestamp} — ${entry.source}`;
    const tags = entry.tags
      ? entry.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const payload = {
      sync_id: `kb:${relPath}#${entry.timestamp}`,
      meta: { kb_path: relPath },
      title,
      body: entry.body || title,
      source_type: "note",
      captured_at: entry.timestamp.slice(0, 10),
      tags: tags.length ? tags : null,
    };
    return {
      relPath: `${relPath}#${entry.timestamp}`,
      hash: sha256(JSON.stringify(payload)),
      type: "evidence",
      refs: [],
      payload,
    };
  });
}

function walk(dir, prefix, visit) {
  let items;
  try {
    items = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of items) {
    if (item.isSymbolicLink() || item.name.startsWith(".")) continue;
    const rel = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.isDirectory()) walk(path.join(dir, item.name), rel, visit);
    else if (item.isFile()) visit(rel);
  }
}

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// sync_id: stable frontmatter id when present (survives file renames),
// else the KB-relative path. Prefixed so server-born records are told apart.
function syncIdFor(relPath, fm) {
  return `kb:${fm.id || relPath}`;
}

function toRecord(relPath, fm, body) {
  const trimmedBody = (body || "").trim();
  let meta = { kb_path: relPath, fm };
  // ponytail: server caps meta at 8KB. Oversized frontmatter drops fm — the
  // record still syncs but pull regenerates default frontmatter for it.
  if (Buffer.byteLength(JSON.stringify(meta)) > 7900) meta = { kb_path: relPath };
  const base = {
    sync_id: syncIdFor(relPath, fm),
    meta,
  };

  if (fm.type === "backlog") {
    const labels = asArray(fm.labels);
    const refs = asArray(fm.research_refs).map(String);
    return {
      type: "backlog_item",
      refs: refs.map((p) => ({ path: p, kind: "source" })),
      payload: {
        ...base,
        title: fm.title || path.basename(relPath, ".md"),
        outcome: fm.outcome || fm.title || path.basename(relPath, ".md"),
        status: BACKLOG_STATUS[fm.status] || "idea",
        priority: PRIORITIES.includes(fm.priority) ? fm.priority : null,
        // ponytail: kind heuristic — bug label wins; evidence-backed items are
        // proposals (source links satisfy the server gate); the rest are tasks.
        kind: labels.includes("bug") ? "bug" : refs.length > 0 ? "proposal" : "task",
        tags: labels.length ? labels : null,
        body: trimmedBody || null,
      },
    };
  }

  if (fm.type === "insight") {
    return {
      type: "insight",
      refs: asArray(fm.sources).map((p) => ({ path: String(p), kind: "evidence" })),
      payload: {
        ...base,
        title: fm.topic || fm.title || path.basename(relPath, ".md"),
        status: INSIGHT_STATUS[fm.status] || "draft",
        confidence: ["low", "medium", "high"].includes(fm.confidence) ? fm.confidence : null,
        body: trimmedBody || null,
      },
    };
  }

  if (fm.type === "evidence") {
    const title = fm.topic || fm.title || path.basename(relPath, ".md");
    const urls = asArray(fm.sources)
      .map((s) => (typeof s === "string" ? s : s && s.url))
      .filter((u) => typeof u === "string" && /^https?:/.test(u));

    if (fm.evidence_type === "research" || relPath.startsWith("evidence/research/")) {
      return {
        type: "research",
        refs: [],
        payload: {
          ...base,
          title,
          question: fm.question || title,
          source_origin: SOURCE_ORIGINS.includes(fm.source_origin) ? fm.source_origin : "external",
          source_urls: urls.length ? urls : null,
          confidence: ["low", "medium", "high"].includes(fm.confidence) ? fm.confidence : null,
          body: trimmedBody || null,
        },
      };
    }

    const subdir = relPath.split("/")[1];
    return {
      type: "evidence",
      refs: [],
      payload: {
        ...base,
        title,
        body: trimmedBody || title,
        source_type: SERVER_SOURCE_TYPES.includes(fm.evidence_type)
          ? fm.evidence_type
          : EVIDENCE_SOURCE_TYPES[subdir] || "note",
        captured_at: fm.created || null,
        source_url: urls[0] || null,
      },
    };
  }

  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Record → markdown (pull side)
// ---------------------------------------------------------------------------

const PULL_DIRS = {
  evidence: "evidence/notes",
  research: "evidence/research",
  insight: "insights/product",
  backlog_item: "backlog",
};

// Server-owned fields written back over the preserved local frontmatter.
const SERVER_FIELDS = {
  backlog_item: (r) => ({
    title: r.title,
    outcome: r.outcome,
    status: LOCAL_STATUS[r.status] || "idea",
    priority: r.priority,
    labels: r.tags,
  }),
  insight: (r) => ({ topic: r.title, status: r.status, confidence: r.confidence }),
  research: (r) => ({
    topic: r.title,
    question: r.question,
    source_origin: r.source_origin,
    confidence: r.confidence,
  }),
  evidence: (r) => ({ topic: r.title, source_url: r.source_url }),
};

function recordToMarkdown(record) {
  const preserved = (record.meta && record.meta.fm) || defaultFrontmatter(record);
  const fm = { ...preserved };
  const overrides = SERVER_FIELDS[record.type](record);
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null && value !== undefined) fm[key] = value;
  }
  fm.updated = (record.updated_at || "").slice(0, 10) || fm.updated;
  return `---\n${emitYaml(fm)}---\n\n${(record.body || "").trim()}\n`;
}

function defaultFrontmatter(record) {
  if (record.type === "backlog_item")
    return { type: "backlog", id: record.display_id || undefined };
  if (record.type === "insight") return { type: "insight" };
  return {
    type: "evidence",
    evidence_type: record.type === "research" ? "research" : "note",
    created: (record.created_at || "").slice(0, 10),
  };
}

function recordPath(record) {
  if (record.meta && record.meta.kb_path) return record.meta.kb_path;
  const slug =
    (record.title || record.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || record.id;
  return `${PULL_DIRS[record.type]}/${slug}.md`;
}

// Minimal YAML emitter for the frontmatter subset kb-frontmatter.js parses:
// scalars, string arrays, and arrays of flat objects. Strings are JSON-quoted.
function emitYaml(obj, indent = "") {
  let out = "";
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out += `${indent}${key}: []\n`;
        continue;
      }
      out += `${indent}${key}:\n`;
      for (const item of value) {
        if (item && typeof item === "object") {
          const entries = Object.entries(item).filter(([, v]) => v !== null && v !== undefined);
          entries.forEach(([k, v], i) => {
            out +=
              i === 0
                ? `${indent}  - ${k}: ${yamlScalar(v)}\n`
                : `${indent}    ${k}: ${yamlScalar(v)}\n`;
          });
        } else {
          out += `${indent}  - ${yamlScalar(item)}\n`;
        }
      }
    } else if (value && typeof value === "object") {
      out += `${indent}${key}:\n${emitYaml(value, indent + "  ")}`;
    } else {
      out += `${indent}${key}: ${yamlScalar(value)}\n`;
    }
  }
  return out;
}

function yamlScalar(value) {
  if (typeof value !== "string") return String(value);
  return /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/.test(value) ? value : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Cache — last-sync hashes and sync_id → server id map
// ---------------------------------------------------------------------------

function loadCache(pmStateDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pmStateDir, CACHE_FILE), "utf8"));
  } catch {
    return { lastPull: null, files: {}, ids: {} };
  }
}

function saveCache(pmStateDir, cache) {
  writeJsonAtomic(path.join(pmStateDir, CACHE_FILE), cache, {
    fileMode: 0o600,
    directoryMode: 0o700,
  });
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function api(config, method, apiPath, { body, query } = {}) {
  const qs = query
    ? "?" +
      new URLSearchParams(Object.entries(query).filter(([, v]) => v !== null && v !== undefined))
    : "";
  const response = await fetch(`${config.url}/api/v1${apiPath}${qs}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
      "X-Agent-Name": "pm-plugin",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (!response.ok) {
    const message = (data.error && data.error.message) || `HTTP ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.code = data.error && data.error.code;
    throw err;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Push — upsert changed record files, dependency order so link gates pass
// ---------------------------------------------------------------------------

async function push(pmDir, pmStateDir, config) {
  const cache = loadCache(pmStateDir);
  const entries = scanKbFiles(pmDir);
  const syncIdByPath = new Map(entries.map((e) => [e.relPath, e.payload.sync_id]));

  let uploaded = 0;
  const errors = [];
  // Link matrix flows insight→evidence, research→evidence, backlog→insight/research,
  // so pushing in this order lets gated records carry their links at create time.
  const order = { evidence: 0, research: 1, insight: 2, backlog_item: 3 };
  entries.sort((a, b) => order[a.type] - order[b.type]);

  for (const entry of entries) {
    const cached = cache.files[entry.relPath];
    if (cached && cached.hash === entry.hash && cached.serverId) continue;

    const links = entry.refs
      .map((ref) => {
        const targetSyncId = syncIdByPath.get(normalizeRef(ref.path));
        const toId = targetSyncId && cache.ids[targetSyncId];
        return toId ? { to_id: toId, kind: ref.kind } : null;
      })
      .filter(Boolean);

    try {
      const body = { project: config.project, type: entry.type, links, ...compact(entry.payload) };
      // Compare-and-set: only overwrite the server version this client last saw.
      // New records (no cached serverId) create unconditionally.
      if (cached && cached.serverId && cached.updatedAt) body.if_updated_at = cached.updatedAt;
      const record = await api(config, "POST", "/records", { body });
      cache.ids[record.sync_id] = record.id;
      cache.files[entry.relPath] = {
        hash: entry.hash,
        serverId: record.id,
        syncId: record.sync_id,
        updatedAt: record.updated_at,
      };
      uploaded++;
    } catch (err) {
      // 401 or a network-level failure (no HTTP status: dead server, timeout):
      // abort — every remaining record would fail the same way. Cache is saved
      // so already-uploaded records don't re-push next run.
      if (err.status === 401 || !err.status) {
        saveCache(pmStateDir, cache);
        return { ok: false, uploaded, errors: [err.message] };
      }
      errors.push(
        err.code === "stale"
          ? `${entry.relPath}: changed on server since last pull — run /pm:sync`
          : `${entry.relPath}: ${err.message}`
      );
    }
  }

  saveCache(pmStateDir, cache);
  return { ok: errors.length === 0, uploaded, errors };
}

// Local refs may carry a legacy "pm/" prefix.
function normalizeRef(refPath) {
  return refPath.startsWith("pm/") ? refPath.slice(3) : refPath;
}

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined));
}

// ---------------------------------------------------------------------------
// Pull — fetch records updated since last pull, write them back as markdown
// ---------------------------------------------------------------------------

async function pull(pmDir, pmStateDir, config) {
  const cache = loadCache(pmStateDir);
  const records = [];
  let cursor = null;
  try {
    do {
      const page = await api(config, "GET", "/records", {
        query: { project: config.project, updated_since: cache.lastPull, cursor, limit: 200 },
      });
      records.push(...(page.records || []));
      cursor = page.next_cursor || null;
    } while (cursor);
  } catch (err) {
    return { ok: false, downloaded: 0, errors: [err.message] };
  }

  let downloaded = 0;
  let maxUpdatedAt = cache.lastPull;
  for (const record of records) {
    if (record.updated_at > (maxUpdatedAt || "")) maxUpdatedAt = record.updated_at;
    if (!KB_TYPES.includes(record.type)) continue;
    if (record.sync_id) cache.ids[record.sync_id] = record.id;
    // ponytail: note-rollup entries (sync_id kb:<file>.md#<timestamp>) are
    // push-only — one entry can't rebuild the whole rollup file, so server-side
    // edits to them don't round-trip.
    if (record.sync_id && record.sync_id.includes(".md#")) continue;

    let relPath = recordPath(record);
    // Slug collision: a different server record already owns this path (two
    // same-type records with identically-normalized titles and no kb_path).
    // Suffix with the record id so neither silently overwrites the other.
    // ponytail: if the cache is deleted, re-pull order decides who keeps the
    // unsuffixed path; stale duplicates are visible files, not data loss.
    const owner = cache.files[relPath];
    if (owner && owner.serverId && owner.serverId !== record.id) {
      const idSuffix =
        String(record.id)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "")
          .slice(0, 8) || "dup";
      relPath = relPath.replace(/\.md$/, `-${idSuffix}.md`);
    }
    const filePath = path.resolve(pmDir, relPath);
    if (!filePath.startsWith(path.resolve(pmDir) + path.sep)) continue;
    const content = recordToMarkdown(record);

    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    if (existing === content) {
      cache.files[relPath] = {
        hash: sha256(content),
        serverId: record.id,
        syncId: record.sync_id,
        updatedAt: record.updated_at,
      };
      continue;
    }
    // Server wins, but any differing local version is preserved next to it
    // (same policy as the git backend's conflict artifacts). Uncached counts
    // too: a never-synced local file at this path is still local work.
    const cached = cache.files[relPath];
    if (existing !== null && (!cached || cached.hash !== sha256(existing))) {
      fs.writeFileSync(filePath + ".local-conflict", existing);
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    cache.files[relPath] = {
      hash: sha256(content),
      serverId: record.id,
      syncId: record.sync_id,
      updatedAt: record.updated_at,
    };
    downloaded++;
  }

  cache.lastPull = maxUpdatedAt || cache.lastPull || new Date().toISOString();
  saveCache(pmStateDir, cache);
  return { ok: true, downloaded, errors: [] };
}

// ---------------------------------------------------------------------------
// Sync (pull then push) and status
// ---------------------------------------------------------------------------

async function sync(pmDir, pmStateDir, config) {
  const pullResult = await pull(pmDir, pmStateDir, config);
  if (!pullResult.ok) {
    return { ok: false, downloaded: 0, uploaded: 0, errors: pullResult.errors };
  }
  const pushResult = await push(pmDir, pmStateDir, config);
  return {
    ok: pushResult.ok,
    downloaded: pullResult.downloaded,
    uploaded: pushResult.uploaded,
    errors: pushResult.errors,
  };
}

function status(pmDir, pmStateDir, config) {
  const cache = loadCache(pmStateDir);
  const entries = scanKbFiles(pmDir);
  const pending = entries.filter((e) => {
    const cached = cache.files[e.relPath];
    return !cached || cached.hash !== e.hash || !cached.serverId;
  }).length;
  return {
    ok: true,
    backend: "productmemory",
    url: config.url,
    project: config.project,
    tracked: entries.length,
    pending,
    lastPull: cache.lastPull,
  };
}

// ---------------------------------------------------------------------------
// Status file + CLI (same contract as kb-sync-git.js)
// ---------------------------------------------------------------------------

function writeSyncStatus(pmStateDir, result) {
  writeJsonAtomic(
    path.join(pmStateDir, "sync-status.json"),
    {
      lastSync: new Date().toISOString(),
      mode: result.mode,
      backend: "productmemory",
      uploaded: result.uploaded || 0,
      downloaded: result.downloaded || 0,
      errors: result.errors || [],
      ok: result.ok,
    },
    { fileMode: 0o600, directoryMode: 0o700 }
  );
}

async function main() {
  const mode = process.argv[2] || "sync";
  const projectDir = path.resolve(process.env.CLAUDE_PROJECT_DIR || ".");
  const { pmDir, pmStateDir } = resolvePmPaths(projectDir);

  const config = resolveConfig(pmStateDir);
  if (config.error) {
    if (mode === "status") {
      process.stdout.write(JSON.stringify({ ok: false, error: config.error }, null, 2) + "\n");
      return;
    }
    writeSyncStatus(pmStateDir, { mode, ok: false, errors: [config.error] });
    process.stderr.write(config.error + "\n");
    process.exitCode = 1;
    return;
  }

  if (mode === "status") {
    process.stdout.write(JSON.stringify(status(pmDir, pmStateDir, config), null, 2) + "\n");
    return;
  }

  const runners = { sync, push, pull };
  const runner = runners[mode];
  if (!runner) {
    process.stderr.write("Usage: kb-sync-pm.js [sync|push|pull|status]\n");
    process.exitCode = 1;
    return;
  }

  const result = await runner(pmDir, pmStateDir, config);
  writeSyncStatus(pmStateDir, { mode, ...result });
  if (!result.ok) {
    process.stderr.write(result.errors.join("; ") + "\n");
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write((err.message || String(err)) + "\n");
    process.exitCode = 1;
  });
}

module.exports = {
  BACKLOG_STATUS,
  LOCAL_STATUS,
  resolveConfig,
  scanKbFiles,
  toRecord,
  syncIdFor,
  recordToMarkdown,
  recordPath,
  emitYaml,
  push,
  pull,
  sync,
  status,
  loadCache,
  saveCache,
  writeSyncStatus,
};
