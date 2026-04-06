"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildStatus, renderTextStatus } = require("../scripts/start-status.js");

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
    assert.equal(status.focus, "all fresh");
    assert.equal(status.backlog, "0 ideas, 0 in progress, 0 shipped");
    assert.equal(status.next, "/pm:start (choose your first workflow)");
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
    assert.equal(status.focus, "all fresh");
    assert.equal(status.next, "/pm:strategy");
    assert.equal(status.counts.insights, 1);
    assert.equal(status.counts.evidence, 1);
  } finally {
    project.cleanup();
  }
});

test("buildStatus prioritizes active bug-fix sessions over generic lifecycle suggestions", () => {
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
    const bugfixPath = project.write(
      ".pm/dev-sessions/bugfix-checkout-flow.md",
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
    fs.utimesSync(bugfixPath, now, now);

    const status = buildStatus(project.root);
    assert.equal(status.active.kind, "bugfix");
    assert.equal(status.focus, "bug-fix in progress: bug-fix batch: checkout-flow");
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
    assert.match(rendered, /Focus: all fresh/);
    assert.match(rendered, /Next: \/pm:start \(choose your first workflow\)/);
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
