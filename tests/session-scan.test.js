"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  listGroomSessions,
  listDevSessions,
  listRfcSessions,
  listThinkSessions,
} = require("../scripts/lib/session-scan");

function mktmp() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-session-scan-"));
  return {
    root,
    write(rel, content) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      return full;
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("listGroomSessions returns every groom session (not just the most recent)", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/groom-sessions/alpha.md",
      ["---", "topic: Alpha topic", "phase: scope", "updated: 2026-04-10", "---", ""].join("\n")
    );
    project.write(
      ".pm/groom-sessions/beta.md",
      ["---", "topic: Beta topic", "phase: research", "updated: 2026-04-12", "---", ""].join("\n")
    );

    const sessions = listGroomSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 2, "should return both groom sessions");

    const byTopic = new Map(sessions.map((s) => [s.topic, s]));
    assert.ok(byTopic.has("Alpha topic"));
    assert.ok(byTopic.has("Beta topic"));
    assert.equal(byTopic.get("Alpha topic").stage, "scope");
    assert.equal(byTopic.get("Beta topic").stage, "research");

    for (const s of sessions) {
      assert.equal(s.kind, "groom");
      assert.ok(s.filePath.endsWith(".md"));
      assert.ok(s.updatedEpoch > 0);
    }
  } finally {
    project.cleanup();
  }
});

test("listGroomSessions includes legacy .groom-state.md", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/.groom-state.md",
      ["---", "topic: Legacy topic", "phase: design", "updated: 2026-04-05", "---", ""].join("\n")
    );

    const sessions = listGroomSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].topic, "Legacy topic");
    assert.equal(sessions[0].stage, "design");
  } finally {
    project.cleanup();
  }
});

test("listGroomSessions returns [] when groom-sessions dir is absent", () => {
  const project = mktmp();
  try {
    const sessions = listGroomSessions({ sourceDir: project.root });
    assert.deepEqual(sessions, []);
  } finally {
    project.cleanup();
  }
});

test("listDevSessions returns every dev session including legacy root-level state files", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/dev-sessions/add-auth.md",
      [
        "# Dev Session State",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| Stage | implement |",
        "| Ticket | PROJ-1 |",
        "",
      ].join("\n")
    );
    project.write(
      ".dev-state-old.md",
      [
        "# Legacy Dev State",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| Stage | review |",
        "",
      ].join("\n")
    );

    const sessions = listDevSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 2);

    const stages = sessions.map((s) => s.stage).sort();
    assert.deepEqual(stages, ["implement", "review"]);

    for (const s of sessions) {
      assert.equal(s.kind, "dev");
    }
  } finally {
    project.cleanup();
  }
});

test("listDevSessions returns [] when no dev sessions exist anywhere", () => {
  const project = mktmp();
  try {
    const sessions = listDevSessions({ sourceDir: project.root });
    assert.deepEqual(sessions, []);
  } finally {
    project.cleanup();
  }
});

test("listDevSessions reads canonical v2 JSON and suppresses a same-slug projection", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/dev-sessions/add-auth/session.json",
      JSON.stringify({
        schema_version: 2,
        run_id: "dev_json",
        slug: "add-auth",
        status: "active",
        phase: "review",
        updated_at: "2026-07-11T00:00:00.000Z",
        task: { reference: "PROJ-9" },
      })
    );
    project.write(
      ".pm/dev-sessions/add-auth.md",
      "# Projection\n\n| Field | Value |\n|---|---|\n| Stage | implementation |\n"
    );
    const sessions = listDevSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].stage, "review");
    assert.equal(sessions[0].linearId, "PROJ-9");
    assert.match(sessions[0].filePath, /add-auth\/session\.json$/);
  } finally {
    project.cleanup();
  }
});

test("listDevSessions omits completed canonical sessions and deduplicates retained root legacy state", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/dev-sessions/done/session.json",
      JSON.stringify({ schema_version: 2, slug: "done", status: "complete", phase: "retro" })
    );
    project.write(
      ".pm/dev-sessions/old/session.json",
      JSON.stringify({ schema_version: 2, slug: "old", status: "active", phase: "review" })
    );
    project.write(
      ".dev-state-old.md",
      "# Legacy\n\n| Field | Value |\n|---|---|\n| Stage | review |\n"
    );
    const sessions = listDevSessions({ sourceDir: project.root });
    assert.deepEqual(
      sessions.map((session) => session.topic),
      ["old"]
    );
  } finally {
    project.cleanup();
  }
});

test("listDevSessions ignores completed archives and surfaces malformed canonical state", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/dev-sessions/completed/done/session.json",
      JSON.stringify({ schema_version: 2, slug: "done", status: "complete", phase: "retro" })
    );
    project.write(".pm/dev-sessions/broken/session.json", "{not-json");
    const sessions = listDevSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].topic, "broken");
    assert.equal(sessions[0].stage, "invalid");
    assert.match(sessions[0].summary, /invalid canonical dev session/);
  } finally {
    project.cleanup();
  }
});

test("listRfcSessions reads source-side .pm/rfc-sessions/ via the documented markdown-table schema", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/rfc-sessions/add-auth.md",
      [
        "# RFC Session State",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| Stage | rfc-generation |",
        "| Ticket | PROJ-99 |",
        "| Slug | add-auth |",
        "",
      ].join("\n")
    );

    const sessions = listRfcSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].kind, "rfc");
    assert.equal(sessions[0].stage, "rfc-generation");
    assert.equal(sessions[0].topic, "add-auth");
  } finally {
    project.cleanup();
  }
});

test("listRfcSessions returns [] when the directory does not exist", () => {
  const project = mktmp();
  try {
    const sessions = listRfcSessions({ sourceDir: project.root });
    assert.deepEqual(sessions, []);
  } finally {
    project.cleanup();
  }
});

test("listRfcSessions reads canonical JSON and omits completed approval audits", () => {
  const project = mktmp();
  try {
    const base = {
      schema_version: 2,
      slug: "approval-safe",
      status: "awaiting_approval",
      phase: "approval",
      updated_at: "2026-07-11T10:00:00.000Z",
      context: { linear_id: "PM-42" },
    };
    project.write(".pm/rfc-sessions/approval-safe/session.json", JSON.stringify(base));
    project.write(
      ".pm/rfc-sessions/done/session.json",
      JSON.stringify({ ...base, slug: "done", status: "complete", phase: "handoff" })
    );

    const sessions = listRfcSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].topic, "approval-safe");
    assert.equal(sessions[0].stage, "approval");
    assert.equal(sessions[0].status, "awaiting_approval");
    assert.equal(sessions[0].linearId, "PM-42");
  } finally {
    project.cleanup();
  }
});

test("listRfcSessions prefers canonical JSON over retained legacy state", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/rfc-sessions/same.md",
      [
        "# RFC",
        "",
        "| Field | Value |",
        "|---|---|",
        "| Slug | same |",
        "| Stage | approved |",
      ].join("\n")
    );
    project.write(
      ".pm/rfc-sessions/same/session.json",
      JSON.stringify({
        schema_version: 2,
        slug: "same",
        status: "awaiting_approval",
        phase: "approval",
        updated_at: "2026-07-11T10:00:00.000Z",
        context: { linear_id: null },
      })
    );
    const sessions = listRfcSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].stage, "approval");
    assert.match(sessions[0].filePath, /session\.json$/);
  } finally {
    project.cleanup();
  }
});

test("listRfcSessions surfaces malformed canonical JSON instead of parsing it as Markdown", () => {
  const project = mktmp();
  try {
    project.write(".pm/rfc-sessions/broken/session.json", "{not json");
    const sessions = listRfcSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "invalid");
    assert.equal(sessions[0].topic, "broken");
  } finally {
    project.cleanup();
  }
});

test("listThinkSessions reads source-side .pm/think-sessions/ when present and empty otherwise", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/think-sessions/pricing-model.md",
      ["---", "topic: Pricing model exploration", "updated: 2026-04-15", "---", ""].join("\n")
    );

    const sessions = listThinkSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].kind, "think");
    assert.equal(sessions[0].topic, "Pricing model exploration");

    // Think sessions are phaseless — stage defaults to "active" per phase-labels contract.
    assert.equal(sessions[0].stage, "active");
  } finally {
    project.cleanup();
  }
});

test("listThinkSessions returns [] when the directory does not exist", () => {
  const project = mktmp();
  try {
    const sessions = listThinkSessions({ sourceDir: project.root });
    assert.deepEqual(sessions, []);
  } finally {
    project.cleanup();
  }
});

test("session-scan helpers fall back to mtime when frontmatter updated is missing", () => {
  const project = mktmp();
  try {
    project.write(
      ".pm/groom-sessions/no-date.md",
      ["---", "topic: Undated topic", "phase: intake", "---", ""].join("\n")
    );

    const sessions = listGroomSessions({ sourceDir: project.root });
    assert.equal(sessions.length, 1);
    assert.ok(
      sessions[0].updatedEpoch > 0,
      "updatedEpoch should fall back to mtime when frontmatter updated is absent"
    );
  } finally {
    project.cleanup();
  }
});
