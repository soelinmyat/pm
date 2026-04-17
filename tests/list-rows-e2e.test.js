"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const START_STATUS = path.join(__dirname, "..", "scripts", "start-status.js");

// -----------------------------------------------------------------------------
// Goal: spawn the real `node scripts/start-status.js --format list-rows` as a
// child process and verify its stdout against the fixture set. This is the
// only layer that catches silent breakage of the CLI wiring (Issue 2b) that
// the downstream skill (Issue 3) depends on.
//
// Time-dependent fields (meta.generatedAt, row.updatedEpoch, row.ageRelative,
// row.staleness) can't be pinned without a --now hatch on the CLI — so this
// test compares the structural shape (section counts + shortIds + kinds)
// rather than re-deep-equalling the entire fixture. The fixture-level deep
// equality lives in tests/list-rows.test.js (emitListRows unit level).
// -----------------------------------------------------------------------------

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-list-rows-e2e-"));
  return {
    root,
    write(relPath, content, mtimeDate) {
      const full = path.join(root, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
      if (mtimeDate) fs.utimesSync(full, mtimeDate, mtimeDate);
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function fm(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) lines.push(`${k}: ${v}`);
  lines.push("---", "");
  return lines.join("\n");
}

function runCli(projectDir) {
  const stdout = execFileSync(
    "node",
    [START_STATUS, "--project-dir", projectDir, "--format", "list-rows"],
    { encoding: "utf8" }
  );
  return JSON.parse(stdout);
}

function loadFixture(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "list-rows", `${name}.json`), "utf8")
  );
}

function shape(payload) {
  const pick = (rows) => rows.map((r) => ({ shortId: r.shortId, kind: r.kind, topic: r.topic }));
  return {
    active: pick(payload.active),
    proposals: pick(payload.proposals),
    rfcs: pick(payload.rfcs),
    shipped: pick(payload.shipped),
  };
}

// -----------------------------------------------------------------------------
// Scenarios — mirror the fixture-driven synth from tests/list-rows.test.js.
// -----------------------------------------------------------------------------

test("e2e — empty-repo: CLI emits valid ListRowsPayload with all arrays empty", () => {
  const project = createProject();
  try {
    project.mkdir("pm/backlog");
    project.mkdir(".pm");
    const actual = runCli(project.root);
    assert.deepEqual(shape(actual), shape(loadFixture("empty-repo")));
    assert.equal(typeof actual.meta.generatedAt, "string");
    assert.ok(actual.meta.pmDir.length > 0);
    assert.ok(actual.meta.sourceDir.length > 0);
  } finally {
    project.cleanup();
  }
});

test("e2e — single-section: one groom session via CLI yields one active row", () => {
  const project = createProject();
  try {
    project.mkdir("pm/backlog");
    project.write(
      ".pm/groom-sessions/list-active-work.md",
      fm({ topic: "list-active-work", phase: "scope", linear_id: "PM-45" }) + "body"
    );
    const actual = runCli(project.root);
    assert.deepEqual(shape(actual), shape(loadFixture("single-section")));
  } finally {
    project.cleanup();
  }
});

test("e2e — all-sections: one row per kind via CLI", () => {
  const project = createProject();
  try {
    project.write(
      ".pm/groom-sessions/add-auth.md",
      fm({ topic: "add-auth", phase: "active" }) + "body"
    );
    project.write(
      ".pm/rfc-sessions/search-v2.md",
      "| Slug | search-v2 |\n| Stage | rfc-generation |\n"
    );
    project.write(
      ".pm/dev-sessions/epic-ship-widget.md",
      "| Ticket | ENG-99 |\n| Stage | implement |\n- Next action: continue impl\n"
    );
    project.write(".pm/think-sessions/taxonomy.md", fm({ topic: "taxonomy" }) + "body");
    project.write(
      "pm/backlog/new-feature.md",
      fm({ title: "New feature", status: "planned" }) + "body"
    );
    project.write(
      "pm/backlog/rewrite-api.md",
      fm({
        title: "Rewrite API",
        status: "planned",
        rfc: "rfcs/rewrite-api.html",
        linear_id: "PM-30",
      }) + "body"
    );
    project.write(
      "pm/backlog/older-win.md",
      fm({ title: "Older win", status: "shipped" }) + "body"
    );
    const actual = runCli(project.root);
    const actualShape = shape(actual);
    const expectedShape = shape(loadFixture("all-sections"));
    // CLI ordering is by updatedEpoch desc — mtime-based at runtime — so row
    // order within `active` may differ from the frozen fixture. Compare as sets.
    for (const section of ["active", "proposals", "rfcs", "shipped"]) {
      const toSet = (rows) => new Set(rows.map((r) => `${r.shortId}|${r.kind}|${r.topic}`));
      assert.deepEqual(
        toSet(actualShape[section]),
        toSet(expectedShape[section]),
        `section mismatch: ${section}`
      );
    }
  } finally {
    project.cleanup();
  }
});

test("e2e — over-cap: CLI caps shipped at 3 most recent", () => {
  const project = createProject();
  try {
    const items = [
      { name: "ship-a", mtime: "2026-04-16" },
      { name: "ship-b", mtime: "2026-04-15" },
      { name: "ship-c", mtime: "2026-04-14" },
      { name: "ship-d", mtime: "2026-04-13" },
      { name: "ship-e", mtime: "2026-04-12" },
      { name: "ship-f", mtime: "2026-04-11" },
    ];
    for (const it of items) {
      project.write(
        `pm/backlog/${it.name}.md`,
        fm({ title: it.name, status: "shipped", updated: it.mtime }) + "body",
        new Date(`${it.mtime}T00:00:00Z`)
      );
    }
    project.mkdir(".pm");
    const actual = runCli(project.root);
    assert.equal(actual.shipped.length, 3, "shipped section must be capped at 3");
    assert.deepEqual(
      actual.shipped.map((r) => r.shortId),
      ["s/ship-a", "s/ship-b", "s/ship-c"],
      "shipped must be the 3 most recent by updatedEpoch"
    );
  } finally {
    project.cleanup();
  }
});

test("e2e — separate-repo: CLI resolves pm_repo, reads sessions source-side", () => {
  const project = createProject();
  const pmRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-list-rows-e2e-kb-"));
  try {
    fs.mkdirSync(path.join(pmRepoDir, "pm", "backlog"), { recursive: true });
    fs.writeFileSync(
      path.join(pmRepoDir, "pm", "backlog", "shared-thing.md"),
      fm({ title: "Shared thing", status: "planned" }) + "body"
    );
    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 1, pm_repo: { type: "local", path: pmRepoDir } })
    );
    project.write(".pm/groom-sessions/active.md", fm({ topic: "active", phase: "scope" }) + "body");

    const actual = runCli(project.root);
    assert.equal(actual.active.length, 1, "active session should be found source-side");
    assert.equal(actual.active[0].shortId, "g/active");
    assert.equal(actual.proposals.length, 1, "proposal from pm-kb should be found");
    assert.equal(actual.proposals[0].shortId, "p/shared-thing");
    // The resolved pmDir must live inside the pmRepoDir tree, not the project dir.
    assert.ok(
      actual.meta.pmDir.startsWith(pmRepoDir),
      `expected pmDir under ${pmRepoDir}, got ${actual.meta.pmDir}`
    );
    assert.ok(actual.meta.sourceDir.startsWith(project.root));
  } finally {
    project.cleanup();
    fs.rmSync(pmRepoDir, { recursive: true, force: true });
  }
});

test("e2e — missing-frontmatter: CLI emits rows with graceful defaults", () => {
  const project = createProject();
  try {
    project.write(".pm/groom-sessions/no-fm.md", "just body text\n");
    project.write("pm/backlog/bare.md", fm({ title: "Bare item" }) + "body");
    const actual = runCli(project.root);
    assert.equal(actual.active.length, 1);
    assert.equal(actual.active[0].shortId, "g/no-fm");
    assert.equal(actual.active[0].phase, "active", "phase defaults to 'active'");
    assert.equal(actual.proposals.length, 1);
    assert.equal(actual.proposals[0].shortId, "p/bare");
    assert.ok(
      actual.proposals[0].updatedEpoch > 0,
      "updatedEpoch must fall back to mtime when frontmatter omits 'updated'"
    );
  } finally {
    project.cleanup();
  }
});

test("e2e — CLI writes valid JSON (no color, no extra output)", () => {
  const project = createProject();
  try {
    project.mkdir("pm/backlog");
    project.mkdir(".pm");
    const stdout = execFileSync(
      "node",
      [START_STATUS, "--project-dir", project.root, "--format", "list-rows"],
      { encoding: "utf8" }
    );
    // Should be a single JSON object followed by one newline — no ANSI, no banner.
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(stdout, /\u001b\[/, "stdout must not contain ANSI escapes");
    assert.equal(stdout.trim().startsWith("{"), true);
    assert.equal(stdout.trim().endsWith("}"), true);
    // Must round-trip through JSON.parse without lossy whitespace.
    JSON.parse(stdout);
  } finally {
    project.cleanup();
  }
});
