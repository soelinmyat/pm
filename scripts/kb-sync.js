"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SERVER_URL = "https://hub.pm.dev";
const CREDENTIALS_PATH = process.env.HOME
  ? path.join(process.env.HOME, ".pm", "credentials")
  : path.join(require("os").homedir(), ".pm", "credentials");

// ---------------------------------------------------------------------------
// resolveConfig — read project config + credentials, resolve server URL
// Returns null if either config.json or credentials are missing.
// ---------------------------------------------------------------------------

function resolveConfig(projectDir, credsPath) {
  const configPath = path.join(projectDir, ".pm", "config.json");

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }

  if (!config.projectId) return null;

  let creds;
  try {
    creds = JSON.parse(fs.readFileSync(credsPath || CREDENTIALS_PATH, "utf8"));
  } catch {
    return null;
  }

  if (!creds.token) return null;

  // Server URL priority: PM_HUB_URL env > config.json serverUrl > default
  const serverUrl = process.env.PM_HUB_URL || config.serverUrl || DEFAULT_SERVER_URL;

  return {
    projectId: config.projectId,
    token: creds.token,
    serverUrl,
  };
}

// ---------------------------------------------------------------------------
// buildManifest — recursively list files in pm/, compute SHA-256 hashes
// Excludes *.local-conflict files.
// ---------------------------------------------------------------------------

function buildManifest(pmDir) {
  const manifest = [];

  function walk(dir, prefix) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile() && !entry.name.endsWith(".local-conflict")) {
        const buffer = fs.readFileSync(full);
        const hash = crypto.createHash("sha256").update(buffer).digest("hex");
        manifest.push({ path: rel, hash });
      }
    }
  }

  walk(pmDir, "");
  return manifest;
}

// ---------------------------------------------------------------------------
// preparePushPayload — build the push request body
// If cachedManifest is provided, only include files whose hash differs.
// ---------------------------------------------------------------------------

function preparePushPayload(pmDir, manifest, cachedManifest) {
  const cachedMap = new Map();
  if (cachedManifest) {
    for (const entry of cachedManifest) {
      cachedMap.set(entry.path, entry.hash);
    }
  }

  const files = [];
  for (const entry of manifest) {
    const cachedHash = cachedMap.get(entry.path);
    if (!cachedHash || cachedHash !== entry.hash) {
      const content = fs.readFileSync(path.join(pmDir, entry.path), "utf8");
      files.push({ path: entry.path, content });
    }
  }

  return { manifest, files };
}

// ---------------------------------------------------------------------------
// applyPullResponse — write downloaded files, create conflicts, delete files
// ---------------------------------------------------------------------------

function applyPullResponse(pmDir, response) {
  let downloaded = 0;
  let deleted = 0;
  const resolvedPmDir = path.resolve(pmDir);

  // Write downloaded files
  for (const file of response.download || []) {
    const filePath = path.resolve(pmDir, file.path);
    if (!filePath.startsWith(resolvedPmDir + path.sep)) continue;
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Check for conflict: local file exists with different content
    if (fs.existsSync(filePath)) {
      const localContent = fs.readFileSync(filePath, "utf8");
      if (localContent !== file.content) {
        // Save local version as .local-conflict
        fs.writeFileSync(filePath + ".local-conflict", localContent);
      }
    }

    // Write server version
    fs.writeFileSync(filePath, file.content);
    downloaded++;
  }

  // Delete files (with safeguard)
  const serverEmpty = response._serverEmpty === true;
  if (!serverEmpty) {
    for (const relPath of response.delete || []) {
      const filePath = path.resolve(pmDir, relPath);
      if (!filePath.startsWith(resolvedPmDir + path.sep)) continue;
      try {
        fs.unlinkSync(filePath);
        deleted++;
      } catch {
        // File may already be gone
      }
    }
  }

  return { downloaded, deleted };
}

// ---------------------------------------------------------------------------
// writeSyncStatus — persist sync result to .pm/sync-status.json
// ---------------------------------------------------------------------------

function writeSyncStatus(dotPmDir, result) {
  const status = {
    lastSync: new Date().toISOString(),
    mode: result.mode,
    uploaded: result.uploaded || 0,
    downloaded: result.downloaded || 0,
    deleted: result.deleted || 0,
    errors: result.errors || [],
    ok: result.ok,
  };

  fs.mkdirSync(dotPmDir, { recursive: true });
  fs.writeFileSync(path.join(dotPmDir, "sync-status.json"), JSON.stringify(status, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// runSync — main entry point: push or pull
// ---------------------------------------------------------------------------

async function runSync(mode, projectDir, credsPath) {
  projectDir = projectDir || process.env.CLAUDE_PROJECT_DIR || ".";
  const config = resolveConfig(projectDir, credsPath);
  if (!config) {
    // No auth — exit silently
    return;
  }

  const pmDir = path.join(projectDir, "pm");
  const dotPmDir = path.join(projectDir, ".pm");

  if (mode === "push") {
    await doPush(pmDir, dotPmDir, config);
  } else if (mode === "pull") {
    await doPull(pmDir, dotPmDir, config);
  }
}

async function doPush(pmDir, dotPmDir, config) {
  const manifest = buildManifest(pmDir);

  // Load cached server manifest from last sync
  let cachedManifest = null;
  const cachePath = path.join(dotPmDir, "sync-cache.json");
  try {
    cachedManifest = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch {
    // No cache — send all files
  }

  const payload = preparePushPayload(pmDir, manifest, cachedManifest);
  const url = `${config.serverUrl}/sync/push`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "X-Project-Id": config.projectId,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      writeSyncStatus(dotPmDir, {
        mode: "push",
        uploaded: 0,
        deleted: 0,
        errors: [`HTTP ${response.status}: ${body}`],
        ok: false,
      });
      return;
    }

    const result = await response.json();

    // Cache current manifest for next diff
    fs.writeFileSync(cachePath, JSON.stringify(manifest, null, 2) + "\n");

    writeSyncStatus(dotPmDir, {
      mode: "push",
      uploaded: result.uploaded || 0,
      deleted: result.deleted || 0,
      errors: [],
      ok: true,
    });
  } catch (err) {
    writeSyncStatus(dotPmDir, {
      mode: "push",
      uploaded: 0,
      deleted: 0,
      errors: [err.message || String(err)],
      ok: false,
    });
  }
}

async function doPull(pmDir, dotPmDir, config) {
  const manifest = buildManifest(pmDir);
  const url = `${config.serverUrl}/sync/pull`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
        "X-Project-Id": config.projectId,
      },
      body: JSON.stringify({ manifest }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text();
      writeSyncStatus(dotPmDir, {
        mode: "pull",
        downloaded: 0,
        deleted: 0,
        errors: [`HTTP ${response.status}: ${body}`],
        ok: false,
      });
      return;
    }

    const result = await response.json();

    // Apply delete safeguard client-side:
    // If server has no files but client does, skip deletes
    const serverEmpty =
      (result.download || []).length === 0 &&
      manifest.length > 0 &&
      (result.delete || []).length > 0;

    const pullResult = applyPullResponse(pmDir, {
      ...result,
      _serverEmpty: serverEmpty,
    });

    // Cache the new manifest (server state after pull)
    const newManifest = buildManifest(pmDir);
    const cachePath = path.join(dotPmDir, "sync-cache.json");
    fs.writeFileSync(cachePath, JSON.stringify(newManifest, null, 2) + "\n");

    writeSyncStatus(dotPmDir, {
      mode: "pull",
      downloaded: pullResult.downloaded,
      deleted: pullResult.deleted,
      errors: [],
      ok: true,
    });
  } catch (err) {
    writeSyncStatus(dotPmDir, {
      mode: "pull",
      downloaded: 0,
      deleted: 0,
      errors: [err.message || String(err)],
      ok: false,
    });
  }
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const mode = process.argv[2];
  if (mode !== "push" && mode !== "pull") {
    process.stderr.write("Usage: kb-sync.js <push|pull>\n");
    process.exit(1);
  }
  runSync(mode).catch(() => process.exit(0));
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  resolveConfig,
  buildManifest,
  preparePushPayload,
  applyPullResponse,
  writeSyncStatus,
  runSync,
};
