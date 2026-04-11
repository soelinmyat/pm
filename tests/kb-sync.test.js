"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTempProject(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kb-sync-test-"));
  const pmDir = path.join(root, "pm");
  const dotPm = path.join(root, ".pm");
  fs.mkdirSync(pmDir, { recursive: true });
  fs.mkdirSync(dotPm, { recursive: true });

  if (files) {
    for (const [relPath, content] of Object.entries(files)) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
  }

  return {
    root,
    pmDir,
    dotPm,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function sha256(content) {
  return crypto.createHash("sha256").update(Buffer.from(content)).digest("hex");
}

// We need to load the sync script as a module. The script is designed to run
// standalone, so we import only the internal functions we export for testing.
const KB_SYNC_PATH = path.join(__dirname, "..", "scripts", "kb-sync.js");

// ---------------------------------------------------------------------------
// Test: Manifest computation from a directory
// ---------------------------------------------------------------------------

test("buildManifest lists files recursively and computes SHA-256 hashes", (t) => {
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
    "pm/backlog/item-a.md": "---\nid: PM-001\n---\n",
    "pm/evidence/notes/2026-04.md": "some notes\n",
  });
  t.after(cleanup);

  const { buildManifest } = require(KB_SYNC_PATH);
  const manifest = buildManifest(path.join(root, "pm"));

  assert.equal(manifest.length, 3, "should find 3 files");

  const paths = manifest.map((m) => m.path).sort();
  assert.deepEqual(paths, ["backlog/item-a.md", "evidence/notes/2026-04.md", "strategy.md"]);

  // Verify hashes match
  for (const entry of manifest) {
    const filePath = path.join(root, "pm", entry.path);
    const expected = sha256(fs.readFileSync(filePath));
    assert.equal(entry.hash, expected, `hash should match for ${entry.path}`);
  }
});

test("buildManifest excludes .local-conflict files", (t) => {
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
    "pm/strategy.md.local-conflict": "# Conflict version\n",
    "pm/backlog/item-a.md": "content\n",
    "pm/backlog/item-a.md.local-conflict": "conflicted\n",
  });
  t.after(cleanup);

  const { buildManifest } = require(KB_SYNC_PATH);
  const manifest = buildManifest(path.join(root, "pm"));

  const paths = manifest.map((m) => m.path).sort();
  assert.deepEqual(paths, ["backlog/item-a.md", "strategy.md"]);
  assert.ok(
    !paths.some((p) => p.includes("local-conflict")),
    "must not include .local-conflict files"
  );
});

test("buildManifest returns empty array for empty directory", (t) => {
  const { root, cleanup } = withTempProject({});
  t.after(cleanup);

  const { buildManifest } = require(KB_SYNC_PATH);
  const manifest = buildManifest(path.join(root, "pm"));

  assert.deepEqual(manifest, []);
});

// ---------------------------------------------------------------------------
// Test: Graceful exit when credentials missing
// ---------------------------------------------------------------------------

test("resolveConfig returns null when config.json is missing", (t) => {
  const { root, cleanup } = withTempProject({});
  t.after(cleanup);

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, path.join(root, "nonexistent-creds"));

  assert.equal(config, null, "should return null when config.json is missing");
});

test("resolveConfig returns null when credentials file is missing", (t) => {
  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "test-123" }),
  });
  t.after(cleanup);

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, path.join(root, "nonexistent-creds"));

  assert.equal(config, null, "should return null when credentials missing");
});

test("resolveConfig returns config when both files exist", (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "test-token-abc" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "proj-456" }),
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
  });

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, credsFile);

  assert.ok(config, "should return config object");
  assert.equal(config.projectId, "proj-456");
  assert.equal(config.token, "test-token-abc");
});

test("resolveConfig uses PM_HUB_URL env var for server URL", (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "tok" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "proj-1" }),
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
    delete process.env.PM_HUB_URL;
  });

  process.env.PM_HUB_URL = "https://custom.example.com";

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, credsFile);

  assert.equal(config.serverUrl, "https://custom.example.com");
});

test("resolveConfig uses config.json serverUrl as second priority", (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "tok" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({
      projectId: "proj-1",
      serverUrl: "https://config.example.com",
    }),
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
    delete process.env.PM_HUB_URL;
  });

  // Ensure no env var
  delete process.env.PM_HUB_URL;

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, credsFile);

  assert.equal(config.serverUrl, "https://config.example.com");
});

test("resolveConfig falls back to https://hub.pm.dev", (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "tok" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "proj-1" }),
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
    delete process.env.PM_HUB_URL;
  });

  delete process.env.PM_HUB_URL;

  const { resolveConfig } = require(KB_SYNC_PATH);
  const config = resolveConfig(root, credsFile);

  assert.equal(config.serverUrl, "https://hub.pm.dev");
});

// ---------------------------------------------------------------------------
// Test: Graceful exit when server unreachable (mock fetch)
// ---------------------------------------------------------------------------

test("push writes error to sync-status.json when server unreachable", async (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "tok" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "proj-1" }),
    "pm/strategy.md": "# Strategy\n",
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
    delete process.env.PM_HUB_URL;
  });

  // Point to a server that will definitely fail
  process.env.PM_HUB_URL = "http://127.0.0.1:1";

  const { runSync } = require(KB_SYNC_PATH);
  await runSync("push", root, credsFile);

  const statusPath = path.join(root, ".pm", "sync-status.json");
  assert.ok(fs.existsSync(statusPath), "sync-status.json should be written");

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(status.ok, false);
  assert.equal(status.mode, "push");
  assert.ok(status.errors.length > 0, "should have at least one error");
  assert.ok(status.lastSync, "should have lastSync timestamp");
});

test("pull writes error to sync-status.json when server unreachable", async (t) => {
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "creds-test-"));
  const credsFile = path.join(credsDir, "credentials");
  fs.writeFileSync(credsFile, JSON.stringify({ token: "tok" }));

  const { root, cleanup } = withTempProject({
    ".pm/config.json": JSON.stringify({ projectId: "proj-1" }),
    "pm/strategy.md": "# Strategy\n",
  });
  t.after(() => {
    cleanup();
    fs.rmSync(credsDir, { recursive: true, force: true });
    delete process.env.PM_HUB_URL;
  });

  process.env.PM_HUB_URL = "http://127.0.0.1:1";

  const { runSync } = require(KB_SYNC_PATH);
  await runSync("pull", root, credsFile);

  const statusPath = path.join(root, ".pm", "sync-status.json");
  assert.ok(fs.existsSync(statusPath), "sync-status.json should be written");

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(status.ok, false);
  assert.equal(status.mode, "pull");
  assert.ok(status.errors.length > 0);
});

// ---------------------------------------------------------------------------
// Test: .local-conflict file creation on pull conflicts
// ---------------------------------------------------------------------------

test("pull creates .local-conflict when local file has different content", async (t) => {
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": "# Local version\n",
  });
  t.after(cleanup);

  const { applyPullResponse } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");

  const response = {
    download: [
      {
        path: "strategy.md",
        content: "# Server version\n",
        hash: sha256("# Server version\n"),
      },
    ],
    delete: [],
    unchanged: 0,
  };

  const result = applyPullResponse(pmDir, response);

  // The server version should be written
  const written = fs.readFileSync(path.join(pmDir, "strategy.md"), "utf8");
  assert.equal(written, "# Server version\n");

  // The local version should be saved as .local-conflict
  const conflictPath = path.join(pmDir, "strategy.md.local-conflict");
  assert.ok(fs.existsSync(conflictPath), "should create .local-conflict file");

  const conflictContent = fs.readFileSync(conflictPath, "utf8");
  assert.equal(conflictContent, "# Local version\n");

  assert.equal(result.downloaded, 1);
});

test("pull does not create .local-conflict when file is new (no local version)", async (t) => {
  const { root, cleanup } = withTempProject({});
  t.after(cleanup);

  const { applyPullResponse } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");

  const response = {
    download: [
      {
        path: "backlog/new-item.md",
        content: "# New item\n",
        hash: sha256("# New item\n"),
      },
    ],
    delete: [],
    unchanged: 0,
  };

  const result = applyPullResponse(pmDir, response);

  assert.ok(fs.existsSync(path.join(pmDir, "backlog", "new-item.md")));
  assert.ok(!fs.existsSync(path.join(pmDir, "backlog", "new-item.md.local-conflict")));
  assert.equal(result.downloaded, 1);
});

test("pull does not create .local-conflict when local matches server", async (t) => {
  const content = "# Same content\n";
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": content,
  });
  t.after(cleanup);

  const { applyPullResponse } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");

  const response = {
    download: [
      {
        path: "strategy.md",
        content: content,
        hash: sha256(content),
      },
    ],
    delete: [],
    unchanged: 0,
  };

  const result = applyPullResponse(pmDir, response);

  assert.ok(!fs.existsSync(path.join(pmDir, "strategy.md.local-conflict")));
  assert.equal(result.downloaded, 1);
});

test("pull applies delete safeguard: skips deletes when server manifest was empty", async (t) => {
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": "# Keep me\n",
    "pm/backlog/item.md": "# Keep me too\n",
  });
  t.after(cleanup);

  const { applyPullResponse } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");

  // Simulate server returning deletes but with empty download (empty server)
  const response = {
    download: [],
    delete: ["strategy.md", "backlog/item.md"],
    unchanged: 0,
    _serverEmpty: true,
  };

  const result = applyPullResponse(pmDir, response);

  // Files should NOT be deleted
  assert.ok(fs.existsSync(path.join(pmDir, "strategy.md")));
  assert.ok(fs.existsSync(path.join(pmDir, "backlog", "item.md")));
  assert.equal(result.deleted, 0);
});

test("pull deletes files normally when server is not empty", async (t) => {
  const { root, cleanup } = withTempProject({
    "pm/old-file.md": "# Delete me\n",
    "pm/strategy.md": "# Keep me\n",
  });
  t.after(cleanup);

  const { applyPullResponse } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");

  const response = {
    download: [],
    delete: ["old-file.md"],
    unchanged: 1,
    _serverEmpty: false,
  };

  const result = applyPullResponse(pmDir, response);

  assert.ok(!fs.existsSync(path.join(pmDir, "old-file.md")));
  assert.ok(fs.existsSync(path.join(pmDir, "strategy.md")));
  assert.equal(result.deleted, 1);
});

// ---------------------------------------------------------------------------
// Test: sync-status.json schema
// ---------------------------------------------------------------------------

test("writeSyncStatus writes correctly shaped JSON", (t) => {
  const { root, cleanup } = withTempProject({});
  t.after(cleanup);

  const { writeSyncStatus } = require(KB_SYNC_PATH);
  writeSyncStatus(path.join(root, ".pm"), {
    mode: "push",
    uploaded: 3,
    downloaded: 0,
    deleted: 1,
    errors: [],
    ok: true,
  });

  const statusPath = path.join(root, ".pm", "sync-status.json");
  assert.ok(fs.existsSync(statusPath));

  const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
  assert.equal(status.mode, "push");
  assert.equal(status.uploaded, 3);
  assert.equal(status.downloaded, 0);
  assert.equal(status.deleted, 1);
  assert.deepEqual(status.errors, []);
  assert.equal(status.ok, true);
  assert.ok(status.lastSync, "must include lastSync");
  // Verify lastSync is valid ISO 8601
  assert.ok(!isNaN(Date.parse(status.lastSync)), "lastSync must be valid ISO date");
});

// ---------------------------------------------------------------------------
// Test: Push manifest preparation
// ---------------------------------------------------------------------------

test("preparePushPayload includes all files when no cached manifest", (t) => {
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": "# Strategy\n",
    "pm/backlog/item.md": "# Item\n",
  });
  t.after(cleanup);

  const { buildManifest, preparePushPayload } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");
  const manifest = buildManifest(pmDir);
  const payload = preparePushPayload(pmDir, manifest, null);

  assert.equal(payload.manifest.length, 2);
  assert.equal(payload.files.length, 2, "all files should be included when no cached manifest");

  for (const file of payload.files) {
    assert.ok(file.path, "file must have path");
    assert.ok(file.content, "file must have content");
  }
});

test("preparePushPayload only includes changed files when cached manifest exists", (t) => {
  const strategyContent = "# Strategy\n";
  const { root, cleanup } = withTempProject({
    "pm/strategy.md": strategyContent,
    "pm/backlog/item.md": "# Changed Item\n",
  });
  t.after(cleanup);

  const { buildManifest, preparePushPayload } = require(KB_SYNC_PATH);
  const pmDir = path.join(root, "pm");
  const manifest = buildManifest(pmDir);

  // Simulate cached manifest where strategy.md has matching hash
  const cachedManifest = [{ path: "strategy.md", hash: sha256(strategyContent) }];

  const payload = preparePushPayload(pmDir, manifest, cachedManifest);

  assert.equal(payload.manifest.length, 2, "manifest should include all files");
  assert.equal(payload.files.length, 1, "only changed file should be included");
  assert.equal(payload.files[0].path, "backlog/item.md");
});
