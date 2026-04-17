"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { emitListRows } = require("../scripts/lib/list-rows.js");

const FIXED_NOW = new Date("2026-04-17T00:00:00Z");

function loadFixture(name) {
  const fixturePath = path.join(__dirname, "fixtures", "list-rows", `${name}.json`);
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-list-rows-"));
  const writers = {
    root,
    write(relPath, content, mtimeDate) {
      const fullPath = path.join(root, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
      if (mtimeDate) fs.utimesSync(fullPath, mtimeDate, mtimeDate);
      return fullPath;
    },
    mkdir(relPath) {
      fs.mkdirSync(path.join(root, relPath), { recursive: true });
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  return writers;
}

// Normalize real emitter output to match fixture placeholders.
// Replaces absolute tmpdir paths with `<sourceDir>` / `<pmDir>` / `<pmStateDir>`.
function normalizeForFixture(payload, { sourceDir, pmDir, pmStateDir }) {
  const replace = (value) => {
    if (typeof value !== "string") return value;
    return value
      .replace(pmStateDir, "<pmStateDir>")
      .replace(pmDir, "<pmDir>")
      .replace(sourceDir, "<sourceDir>");
  };
  const normRow = (row) => ({
    ...row,
    sourcePath: replace(row.sourcePath),
  });
  return {
    active: payload.active.map(normRow),
    proposals: payload.proposals.map(normRow),
    rfcs: payload.rfcs.map(normRow),
    shipped: payload.shipped.map(normRow),
    meta: {
      pmDir: replace(payload.meta.pmDir),
      pmStateDir: replace(payload.meta.pmStateDir),
      sourceDir: replace(payload.meta.sourceDir),
      generatedAt: payload.meta.generatedAt,
    },
  };
}

function runAndCompare(t, project, fixtureName, { sourceDir, pmDir, pmStateDir } = {}) {
  const src = sourceDir || project.root;
  const actual = emitListRows(src, { now: FIXED_NOW });
  const normalized = normalizeForFixture(actual, {
    sourceDir: src,
    pmDir: pmDir || actual.meta.pmDir,
    pmStateDir: pmStateDir || actual.meta.pmStateDir,
  });
  const expected = loadFixture(fixtureName);
  assert.deepEqual(normalized, expected);
}

function ago(hours) {
  return new Date(FIXED_NOW.getTime() - hours * 3600 * 1000);
}

function fm(obj) {
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    lines.push(`${k}: ${v === null ? "null" : v}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Scenario: empty-repo
// -----------------------------------------------------------------------------
test("emitListRows — empty-repo: all arrays empty, meta still populated", () => {
  const project = createProject();
  try {
    project.mkdir("pm/backlog");
    project.mkdir(".pm");
    runAndCompare(null, project, "empty-repo");
  } finally {
    project.cleanup();
  }
});

// -----------------------------------------------------------------------------
// Scenario: single-section (one groom session only)
// -----------------------------------------------------------------------------
test("emitListRows — single-section: one groom session produces one active row", () => {
  const project = createProject();
  try {
    project.mkdir("pm/backlog");
    project.write(
      ".pm/groom-sessions/list-active-work.md",
      fm({
        topic: "list-active-work",
        phase: "scope",
        updated: "2026-04-16T12:00:00Z",
        linear_id: "PM-45",
      }) + "body",
      ago(12)
    );
    runAndCompare(null, project, "single-section");
  } finally {
    project.cleanup();
  }
});

// -----------------------------------------------------------------------------
// Scenario: all-sections (one of each)
// -----------------------------------------------------------------------------
test("emitListRows — all-sections: one row per kind populated", () => {
  const project = createProject();
  try {
    // Active sessions (one each)
    project.write(
      ".pm/groom-sessions/add-auth.md",
      fm({ topic: "add-auth", phase: "active", updated: "2026-04-16T22:00:00Z" }) + "body",
      ago(2)
    );
    project.write(
      ".pm/rfc-sessions/search-v2.md",
      "| Slug | search-v2 |\n| Stage | rfc-generation |\n",
      ago(6)
    );
    project.write(
      ".pm/dev-sessions/epic-ship-widget.md",
      "| Ticket | ENG-99 |\n| Stage | implement |\n- Next action: continue impl\n",
      ago(1)
    );
    project.write(
      ".pm/think-sessions/taxonomy.md",
      fm({ topic: "taxonomy", updated: "2026-04-16T00:00:00Z" }) + "body",
      ago(24)
    );

    // Backlog: one proposal, one rfc-awaiting, one shipped
    project.write(
      "pm/backlog/new-feature.md",
      fm({ title: "New feature", status: "planned", updated: "2026-04-10" }) + "body",
      new Date("2026-04-10T00:00:00Z")
    );
    project.write(
      "pm/backlog/rewrite-api.md",
      fm({
        title: "Rewrite API",
        status: "planned",
        rfc: "rfcs/rewrite-api.html",
        linear_id: "PM-30",
        updated: "2026-04-14",
      }) + "body",
      new Date("2026-04-14T00:00:00Z")
    );
    project.write(
      "pm/backlog/older-win.md",
      fm({ title: "Older win", status: "shipped", updated: "2026-04-01" }) + "body",
      new Date("2026-04-01T00:00:00Z")
    );

    runAndCompare(null, project, "all-sections");
  } finally {
    project.cleanup();
  }
});

// -----------------------------------------------------------------------------
// Scenario: over-cap (6 shipped → cap at 3 most recent)
// -----------------------------------------------------------------------------
test("emitListRows — over-cap: shipped section capped at 3 most recent", () => {
  const project = createProject();
  try {
    const shippedItems = [
      { name: "ship-a", updated: "2026-04-16" },
      { name: "ship-b", updated: "2026-04-15" },
      { name: "ship-c", updated: "2026-04-14" },
      { name: "ship-d", updated: "2026-04-13" },
      { name: "ship-e", updated: "2026-04-12" },
      { name: "ship-f", updated: "2026-04-11" },
    ];
    for (const s of shippedItems) {
      project.write(
        `pm/backlog/${s.name}.md`,
        fm({ title: s.name, status: "shipped", updated: s.updated }) + "body",
        new Date(`${s.updated}T00:00:00Z`)
      );
    }
    project.mkdir(".pm");
    runAndCompare(null, project, "over-cap");
  } finally {
    project.cleanup();
  }
});

// -----------------------------------------------------------------------------
// Scenario: separate-repo (config points pm_repo elsewhere)
// -----------------------------------------------------------------------------
test("emitListRows — separate-repo: resolves pm_repo, reads sessions source-side", () => {
  const project = createProject();
  const pmRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-list-rows-kb-"));
  try {
    fs.mkdirSync(path.join(pmRepoDir, "pm", "backlog"), { recursive: true });
    fs.writeFileSync(
      path.join(pmRepoDir, "pm", "backlog", "shared-thing.md"),
      fm({ title: "Shared thing", status: "planned", updated: "2026-04-15" }) + "body"
    );
    fs.utimesSync(
      path.join(pmRepoDir, "pm", "backlog", "shared-thing.md"),
      new Date("2026-04-15T00:00:00Z"),
      new Date("2026-04-15T00:00:00Z")
    );

    project.write(
      ".pm/config.json",
      JSON.stringify({ config_schema: 1, pm_repo: { type: "local", path: pmRepoDir } })
    );
    project.write(
      ".pm/groom-sessions/active.md",
      fm({ topic: "active", phase: "scope", updated: "2026-04-16T18:00:00Z" }) + "body",
      ago(6)
    );

    runAndCompare(null, project, "separate-repo");
  } finally {
    project.cleanup();
    fs.rmSync(pmRepoDir, { recursive: true, force: true });
  }
});

// -----------------------------------------------------------------------------
// Scenario: missing-frontmatter (graceful defaults)
// -----------------------------------------------------------------------------
test("emitListRows — missing-frontmatter: rows emitted with graceful defaults", () => {
  const project = createProject();
  try {
    // Groom session with no frontmatter at all
    project.write(".pm/groom-sessions/no-fm.md", "just body text\n", ago(3));
    // Backlog item with minimal frontmatter (no updated, no status)
    project.write(
      "pm/backlog/bare.md",
      fm({ title: "Bare item" }) + "body",
      new Date("2026-04-10T00:00:00Z")
    );
    runAndCompare(null, project, "missing-frontmatter");
  } finally {
    project.cleanup();
  }
});
