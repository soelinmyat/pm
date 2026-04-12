"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  buildStatus,
  renderTextStatus,
  resolvePmDir,
  readSyncStatus,
  resolveSyncConfigured,
  timeAgo,
} = require("../scripts/start-status.js");

const pluginVersion = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", ".claude-plugin", "plugin.json"), "utf8")
).version;

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-start-status-"));

  return {
    root,
    write(relPath, content) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      return fullPath;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("buildStatus reports an uninitialized repo", () => {
  const project = createProject();
  try {
    const status = buildStatus(project.root);
    assert.equal(status.initialized, false);
    assert.equal(status.focus, "PM is not initialized yet");
    assert.equal(status.next, "/pm:start to initialize PM");
    assert.equal(status.backlog, "");
  } finally {
    project.cleanup();
  }
});

test("buildStatus treats an initialized empty workspace as first-workflow ready", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');

    const status = buildStatus(project.root);
    assert.equal(status.initialized, true);
    assert.equal(status.focus, "no attention needed");
    assert.equal(status.backlog, "0 ideas, 0 planned, 0 in progress, 0 shipped");
    assert.equal(status.next, "/pm:think (explore a product idea)");
  } finally {
    project.cleanup();
  }
});

test("buildStatus recognizes a layered KB workspace without config", () => {
  const project = createProject();
  try {
    project.write("pm/insights/custom/index.md", "");
    project.write("pm/insights/custom/log.md", "");
    project.write(
      "pm/insights/custom/voice-of-customer.md",
      [
        "---",
        "type: insight",
        "domain: custom",
        "topic: Voice of Customer",
        "last_updated: 2026-04-01",
        "status: active",
        "confidence: medium",
        "sources:",
        "  - evidence/research/voice-of-customer.md",
        "---",
        "# Voice of Customer",
        "",
      ].join("\n")
    );
    project.write("pm/evidence/index.md", "");
    project.write("pm/evidence/log.md", "");
    project.write("pm/evidence/research/index.md", "");
    project.write("pm/evidence/research/log.md", "");
    project.write(
      "pm/evidence/research/voice-of-customer.md",
      [
        "---",
        "type: evidence",
        "evidence_type: research",
        "source_origin: external",
        "created: 2026-04-01",
        "sources: []",
        "cited_by:",
        "  - insights/custom/voice-of-customer.md",
        "---",
        "# Voice of Customer",
        "",
      ].join("\n")
    );

    const status = buildStatus(project.root);
    assert.equal(status.initialized, true);
    assert.equal(status.focus, "no attention needed");
    assert.equal(status.next, "/pm:strategy");
    assert.equal(status.counts.insights, 1);
    assert.equal(status.counts.evidence, 1);
  } finally {
    project.cleanup();
  }
});

test("buildStatus prioritizes active dev sessions over generic lifecycle suggestions", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');
    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/log.md", "");
    project.write(
      "pm/insights/product/checkout.md",
      [
        "---",
        "type: insight",
        "domain: product",
        "topic: Checkout",
        "last_updated: 2026-02-01",
        "status: active",
        "confidence: medium",
        "sources: []",
        "---",
        "# Checkout",
        "",
      ].join("\n")
    );
    project.write(
      "pm/backlog/idea-item.md",
      "---\nstatus: idea\ntitle: Idea Item\nupdated: 2026-03-15\n---\n# Idea\n"
    );
    project.write(
      ".pm/.groom-state.md",
      ["---", "topic: Checkout redesign", "phase: scope", "updated: 2026-03-01", "---", ""].join(
        "\n"
      )
    );
    const devPath = project.write(
      ".pm/dev-sessions/checkout-flow.md",
      [
        "| Field | Value |",
        "| --- | --- |",
        "| Stage | verify |",
        "",
        "## Resume Instructions",
        "- Next action: rerun checkout regression tests",
        "",
      ].join("\n")
    );

    const now = new Date("2026-04-04T12:00:00Z");
    fs.utimesSync(devPath, now, now);

    const status = buildStatus(project.root);
    assert.equal(status.active.kind, "dev");
    assert.equal(status.focus, "delivery in progress: checkout-flow (verify)");
    assert.equal(status.next, "rerun checkout regression tests");
    assert.deepEqual(status.alternatives, ["/pm:strategy", "/pm:refresh (1 stale items)"]);
  } finally {
    project.cleanup();
  }
});

test("buildStatus detects latest groom session from .pm/groom-sessions", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');
    project.write(
      ".pm/groom-sessions/older.md",
      ["---", "topic: Older session", "phase: scope", "updated: 2026-04-01", "---", ""].join("\n")
    );
    project.write(
      ".pm/groom-sessions/newer.md",
      ["---", "topic: Newer session", "phase: team-review", "updated: 2026-04-03", "---", ""].join(
        "\n"
      )
    );

    const status = buildStatus(project.root);
    assert.equal(status.active.kind, "groom");
    assert.equal(status.focus, "groom in progress: Newer session (team-review)");
    assert.equal(status.next, "resume grooming (Newer session)");
  } finally {
    project.cleanup();
  }
});

test("renderTextStatus includes cached update guidance when requested", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');
    project.write(".pm/.update_status", `installed=${pluginVersion}\nlatest=9.9.9\n`);

    const status = buildStatus(project.root);
    const rendered = renderTextStatus(status, { includeUpdate: true });

    assert.equal(status.update.available, true);
    assert.match(rendered, /Update: v/);
    assert.match(rendered, /Focus: no attention needed/);
    assert.match(rendered, /Next: \/pm:think \(explore a product idea\)/);
  } finally {
    project.cleanup();
  }
});

test("renderTextStatus includes alternative actions when available", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');
    project.write("pm/insights/product/index.md", "");
    project.write("pm/insights/product/log.md", "");
    project.write(
      "pm/insights/product/checkout.md",
      [
        "---",
        "type: insight",
        "domain: product",
        "topic: Checkout",
        "last_updated: 2026-03-25",
        "status: active",
        "confidence: medium",
        "sources: []",
        "---",
        "# Checkout",
        "",
      ].join("\n")
    );

    const status = buildStatus(project.root);
    const rendered = renderTextStatus(status);

    assert.equal(status.next, "/pm:strategy");
    assert.deepEqual(status.alternatives, ["/pm:groom ideate"]);
    assert.match(rendered, /Next: \/pm:strategy/);
    assert.match(rendered, /Also: \/pm:groom ideate/);
  } finally {
    project.cleanup();
  }
});

test("buildStatus prefers layered KB counts when legacy directories still exist", () => {
  const project = createProject();
  try {
    project.write("pm/insights/business/index.md", "");
    project.write("pm/insights/business/log.md", "");
    project.write(
      "pm/insights/business/landscape.md",
      [
        "---",
        "type: insight",
        "domain: business",
        "topic: Landscape",
        "last_updated: 2026-04-02",
        "status: active",
        "confidence: high",
        "sources: []",
        "---",
        "# Landscape",
        "",
      ].join("\n")
    );
    project.write(
      "pm/research/legacy-topic/findings.md",
      "---\nupdated: 2026-02-01\n---\n# Legacy Topic\n"
    );
    project.write("pm/competitors/legacy/profile.md", "---\nupdated: 2026-02-01\n---\n# Legacy\n");

    const status = buildStatus(project.root);
    assert.equal(status.counts.insights, 1);
    assert.equal(status.counts.evidence, 0);
    assert.equal(status.counts.stale, 0);
  } finally {
    project.cleanup();
  }
});

test("buildStatus counts planned items, shows in summary, and adds suggestion", () => {
  const project = createProject();
  try {
    project.write("pm/strategy.md", "---\ntype: strategy\n---\n");
    project.write(
      "pm/backlog/ready-item.md",
      [
        "---",
        "type: backlog-issue",
        "id: PM-200",
        "title: Ready to Build",
        "outcome: Test planned",
        "status: planned",
        "priority: high",
        "created: 2026-04-01",
        "updated: 2026-04-09",
        "---",
      ].join("\n")
    );
    const status = buildStatus(project.root);
    assert.equal(status.counts.planned, 1);
    assert.ok(status.backlog.includes("1 planned"));
    const allSuggestions = [status.next, ...(status.alternatives || [])];
    assert.ok(allSuggestions.some((s) => s.includes("ready-item")));
  } finally {
    project.cleanup();
  }
});

test("buildStatus surfaces oldest planned item when multiple exist", () => {
  const project = createProject();
  try {
    project.write("pm/strategy.md", "---\ntype: strategy\n---\n");
    project.write(
      "pm/backlog/older-item.md",
      [
        "---",
        "type: backlog-issue",
        "id: PM-201",
        "title: Older Planned",
        "outcome: Older",
        "status: planned",
        "priority: high",
        "created: 2026-04-01",
        "updated: 2026-04-05",
        "---",
      ].join("\n")
    );
    project.write(
      "pm/backlog/newer-item.md",
      [
        "---",
        "type: backlog-issue",
        "id: PM-202",
        "title: Newer Planned",
        "outcome: Newer",
        "status: planned",
        "priority: high",
        "created: 2026-04-01",
        "updated: 2026-04-09",
        "---",
      ].join("\n")
    );
    const status = buildStatus(project.root);
    assert.equal(status.counts.planned, 2);
    // Oldest planned item should be surfaced in the suggestion
    const allSuggestions = [status.next, ...(status.alternatives || [])];
    assert.ok(allSuggestions.some((s) => s.includes("older-item")));
  } finally {
    project.cleanup();
  }
});

test("buildStatus handles workspace with pm/product/ directory", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');
    project.write("pm/product/index.md", "# Product\n");

    const status = buildStatus(project.root);
    assert.equal(status.initialized, true);
    // pm/product/ presence should not break status
    assert.ok(status.focus);
  } finally {
    project.cleanup();
  }
});

// --- resolvePmDir tests ---

test("resolvePmDir (a) no config — falls back to projectDir/pm", () => {
  const project = createProject();
  try {
    const result = resolvePmDir(project.root);
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir (b) config with pm_repo.path relative path", () => {
  const project = createProject();
  try {
    // Create a separate PM repo directory adjacent to the project
    const pmRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-"));
    fs.mkdirSync(path.join(pmRepoDir, "pm"), { recursive: true });

    // Compute relative path from .pm/ directory to the PM repo
    const configDir = path.join(project.root, ".pm");
    const relPath = path.relative(configDir, pmRepoDir);

    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: relPath } })
    );

    const result = resolvePmDir(project.root);
    assert.equal(result, path.join(pmRepoDir, "pm"));

    fs.rmSync(pmRepoDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir (c) config with missing pm_repo field", () => {
  const project = createProject();
  try {
    project.write(".pm/config.json", JSON.stringify({ config_schema: 2 }));

    const result = resolvePmDir(project.root);
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir (d) config with malformed JSON", () => {
  const project = createProject();
  try {
    project.write(".pm/config.json", "{ not valid json }}}");

    const result = resolvePmDir(project.root);
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir (e) config pointing to nonexistent directory — falls back gracefully", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "local", path: "../nonexistent-pm-repo" },
      })
    );

    const result = resolvePmDir(project.root);
    assert.equal(result, path.join(project.root, "pm"));
  } finally {
    project.cleanup();
  }
});

test("resolvePmDir validates pm_repo.type === 'local' and throws on 'remote'", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({
        config_schema: 2,
        pm_repo: { type: "remote", path: "../some-repo" },
      })
    );

    assert.throws(() => resolvePmDir(project.root), /[Rr]emote.*not.*supported/);
  } finally {
    project.cleanup();
  }
});

test("buildStatus works with pm_repo config pointing to separate PM repo", () => {
  const project = createProject();
  const pmRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-repo-"));
  try {
    // Set up PM content in the separate repo
    fs.mkdirSync(path.join(pmRepoDir, "pm", "backlog"), { recursive: true });
    fs.mkdirSync(path.join(pmRepoDir, ".pm"), { recursive: true });
    fs.writeFileSync(
      path.join(pmRepoDir, ".pm", "config.json"),
      JSON.stringify({ config_schema: 2 })
    );
    fs.writeFileSync(
      path.join(pmRepoDir, "pm", "strategy.md"),
      "---\ntype: strategy\n---\n# Strategy\n"
    );

    // Source repo config pointing to PM repo
    const configDir = path.join(project.root, ".pm");
    const relPath = path.relative(configDir, pmRepoDir);
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 2, pm_repo: { type: "local", path: relPath } })
    );

    const status = buildStatus(project.root);
    assert.equal(status.initialized, true);
    assert.ok(status.focus);
  } finally {
    fs.rmSync(pmRepoDir, { recursive: true, force: true });
    project.cleanup();
  }
});

// --- readSyncStatus tests ---

test("readSyncStatus returns null lastSync and null ok when file is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sync-"));
  try {
    const result = readSyncStatus(tmpDir);
    assert.equal(result.lastSync, null);
    assert.equal(result.ok, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("readSyncStatus returns null lastSync and null ok when file is zero bytes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sync-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "sync-status.json"), "");
    const result = readSyncStatus(tmpDir);
    assert.equal(result.lastSync, null);
    assert.equal(result.ok, null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("readSyncStatus returns parsed status from valid JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-sync-"));
  try {
    const statusData = {
      lastSync: "2026-04-13T10:30:00.000Z",
      mode: "push",
      uploaded: 3,
      downloaded: 0,
      deleted: 0,
      errors: [],
      ok: true,
    };
    fs.writeFileSync(path.join(tmpDir, "sync-status.json"), JSON.stringify(statusData));
    const result = readSyncStatus(tmpDir);
    assert.equal(result.lastSync, "2026-04-13T10:30:00.000Z");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "push");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// --- resolveSyncConfigured tests ---

test("resolveSyncConfigured returns true with projectId + token + sync.enabled=true", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({ projectId: "proj_123", sync: { enabled: true } })
    );
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "tok_abc" }));

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, true);

    fs.rmSync(credsDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

test("resolveSyncConfigured returns true when sync key is absent (default enabled)", () => {
  const project = createProject();
  try {
    project.write(".pm/config.json", JSON.stringify({ projectId: "proj_123" }));
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "tok_abc" }));

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, true);

    fs.rmSync(credsDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

test("resolveSyncConfigured returns false with sync.enabled=false", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({ projectId: "proj_123", sync: { enabled: false } })
    );
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "tok_abc" }));

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, false);

    fs.rmSync(credsDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

test("resolveSyncConfigured returns false with empty token", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({ projectId: "proj_123", sync: { enabled: true } })
    );
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "" }));

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, false);

    fs.rmSync(credsDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

test("resolveSyncConfigured returns false with missing credentials file", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/config.json",
      JSON.stringify({ projectId: "proj_123", sync: { enabled: true } })
    );
    const credsPath = path.join(os.tmpdir(), "nonexistent-pm-creds", "credentials");

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, false);
  } finally {
    project.cleanup();
  }
});

test("resolveSyncConfigured returns false with missing projectId", () => {
  const project = createProject();
  try {
    project.write(".pm/config.json", JSON.stringify({ sync: { enabled: true } }));
    const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "tok_abc" }));

    const result = resolveSyncConfigured(project.root, credsPath);
    assert.equal(result, false);

    fs.rmSync(credsDir, { recursive: true, force: true });
  } finally {
    project.cleanup();
  }
});

// --- timeAgo tests ---

test("timeAgo formats seconds correctly", () => {
  const now = new Date();
  const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000).toISOString();
  assert.equal(timeAgo(thirtySecondsAgo), "30s ago");
});

test("timeAgo formats minutes correctly", () => {
  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  assert.equal(timeAgo(fiveMinutesAgo), "5m ago");
});

test("timeAgo formats hours correctly", () => {
  const now = new Date();
  const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
  assert.equal(timeAgo(threeHoursAgo), "3h ago");
});

test("timeAgo formats days correctly", () => {
  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(timeAgo(twoDaysAgo), "2d ago");
});

test("timeAgo boundary: 59s stays as seconds", () => {
  const now = new Date();
  const fiftyNineSecondsAgo = new Date(now.getTime() - 59 * 1000).toISOString();
  assert.equal(timeAgo(fiftyNineSecondsAgo), "59s ago");
});

test("timeAgo boundary: 60s becomes 1m", () => {
  const now = new Date();
  const sixtySecondsAgo = new Date(now.getTime() - 60 * 1000).toISOString();
  assert.equal(timeAgo(sixtySecondsAgo), "1m ago");
});

test("timeAgo boundary: 59m stays as minutes", () => {
  const now = new Date();
  const fiftyNineMinutesAgo = new Date(now.getTime() - 59 * 60 * 1000).toISOString();
  assert.equal(timeAgo(fiftyNineMinutesAgo), "59m ago");
});

test("timeAgo boundary: 60m becomes 1h", () => {
  const now = new Date();
  const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  assert.equal(timeAgo(sixtyMinutesAgo), "1h ago");
});

test("timeAgo boundary: 23h stays as hours", () => {
  const now = new Date();
  const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
  assert.equal(timeAgo(twentyThreeHoursAgo), "23h ago");
});

test("timeAgo boundary: 24h becomes 1d", () => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  assert.equal(timeAgo(twentyFourHoursAgo), "1d ago");
});

test("timeAgo returns null for null input", () => {
  assert.equal(timeAgo(null), null);
});

// --- buildStatus syncStatus integration ---

test("buildStatus includes syncStatus in JSON output", () => {
  const project = createProject();
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", '{"config_schema":1}');

    const status = buildStatus(project.root);
    assert.ok("syncStatus" in status, "syncStatus should be present in buildStatus output");
    assert.equal(status.syncStatus.configured, false);
    assert.equal(status.syncStatus.lastSync, null);
    assert.equal(status.syncStatus.ok, null);
  } finally {
    project.cleanup();
  }
});

test("buildStatus syncStatus reflects configured sync with valid status file", () => {
  const project = createProject();
  const credsDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-creds-"));
  try {
    project.mkdir("pm");
    project.write(".pm/config.json", JSON.stringify({ config_schema: 1, projectId: "proj_test" }));
    const credsPath = path.join(credsDir, "credentials");
    fs.writeFileSync(credsPath, JSON.stringify({ token: "tok_test" }));

    const syncData = {
      lastSync: "2026-04-13T08:00:00.000Z",
      mode: "pull",
      uploaded: 0,
      downloaded: 5,
      deleted: 0,
      errors: [],
      ok: true,
    };
    project.write(".pm/sync-status.json", JSON.stringify(syncData));

    const status = buildStatus(project.root, { credentialsPath: credsPath });
    assert.equal(status.syncStatus.configured, true);
    assert.equal(status.syncStatus.lastSync, "2026-04-13T08:00:00.000Z");
    assert.equal(status.syncStatus.ok, true);
    assert.equal(status.syncStatus.mode, "pull");
    assert.equal(typeof status.syncStatus.timeAgo, "string");
    assert.ok(status.syncStatus.timeAgo.endsWith("ago"));
  } finally {
    fs.rmSync(credsDir, { recursive: true, force: true });
    project.cleanup();
  }
});

test("buildStatus syncStatus for uninitialized project has syncStatus", () => {
  const project = createProject();
  try {
    const status = buildStatus(project.root);
    assert.equal(status.initialized, false);
    assert.ok("syncStatus" in status);
    assert.equal(status.syncStatus.configured, false);
  } finally {
    project.cleanup();
  }
});

// --- renderTextStatus Dashboard line tests ---

test("renderTextStatus shows Dashboard nudge when sync not configured", () => {
  const status = {
    update: { available: false },
    syncStatus: { configured: false, lastSync: null, ok: null, mode: null, timeAgo: null },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status);
  assert.match(rendered, /Dashboard: not configured/);
  assert.match(rendered, /productmemory\.io/);
});

test("renderTextStatus shows Dashboard synced with time-ago when configured + ok", () => {
  const status = {
    update: { available: false },
    syncStatus: {
      configured: true,
      lastSync: "2026-04-13T10:00:00.000Z",
      ok: true,
      mode: "push",
      timeAgo: "5m ago",
    },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status);
  assert.match(rendered, /Dashboard: synced 5m ago/);
});

test("renderTextStatus shows Dashboard last sync failed when configured + failed", () => {
  const status = {
    update: { available: false },
    syncStatus: {
      configured: true,
      lastSync: "2026-04-13T10:00:00.000Z",
      ok: false,
      mode: "push",
      timeAgo: "5m ago",
    },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status);
  assert.match(rendered, /Dashboard: last sync failed/);
});

test("renderTextStatus shows Dashboard syncing when configured + missing status file", () => {
  const status = {
    update: { available: false },
    syncStatus: { configured: true, lastSync: null, ok: null, mode: null, timeAgo: null },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status);
  assert.match(rendered, /Dashboard: syncing\.\.\./);
});

test("renderTextStatus Dashboard line appears between Update and Focus", () => {
  const status = {
    update: {
      available: true,
      message: "v1.0.0 → v2.0.0 available. Update PM in your client. On Claude Code, run /plugin.",
    },
    syncStatus: {
      configured: true,
      lastSync: "2026-04-13T10:00:00.000Z",
      ok: true,
      mode: "push",
      timeAgo: "3m ago",
    },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status, { includeUpdate: true });
  const lines = rendered.split("\n");
  const updateIdx = lines.findIndex((l) => l.startsWith("Update:"));
  const dashboardIdx = lines.findIndex((l) => l.startsWith("Dashboard:"));
  const focusIdx = lines.findIndex((l) => l.startsWith("Focus:"));

  assert.ok(updateIdx >= 0, "Update line should exist");
  assert.ok(dashboardIdx >= 0, "Dashboard line should exist");
  assert.ok(focusIdx >= 0, "Focus line should exist");
  assert.ok(dashboardIdx > updateIdx, "Dashboard should come after Update");
  assert.ok(dashboardIdx < focusIdx, "Dashboard should come before Focus");
});

test("renderTextStatus Dashboard line appears before Focus when no Update line", () => {
  const status = {
    update: { available: false },
    syncStatus: { configured: false, lastSync: null, ok: null, mode: null, timeAgo: null },
    focus: "no attention needed",
    backlog: "0 ideas, 0 planned, 0 in progress, 0 shipped",
    next: "/pm:think (explore a product idea)",
    alternatives: [],
  };
  const rendered = renderTextStatus(status);
  const lines = rendered.split("\n");
  const dashboardIdx = lines.findIndex((l) => l.startsWith("Dashboard:"));
  const focusIdx = lines.findIndex((l) => l.startsWith("Focus:"));

  assert.ok(dashboardIdx >= 0, "Dashboard line should exist");
  assert.ok(focusIdx >= 0, "Focus line should exist");
  assert.equal(dashboardIdx, 0, "Dashboard should be first line when no Update");
  assert.ok(dashboardIdx < focusIdx, "Dashboard should come before Focus");
});
