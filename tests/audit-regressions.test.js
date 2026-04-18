"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyCommits,
  detectSchemaDriftField,
  parseLogOutput,
  toUtcDate,
  daysBetween,
  runAudit,
  PRIORITY_SURFACES,
  REVERT_WINDOW_DAYS,
  KEYWORD_WINDOW_DAYS,
} = require("../scripts/audit-regressions");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entriesFor(surface, entries) {
  const map = new Map();
  for (const s of PRIORITY_SURFACES) {
    map.set(s, s === surface ? entries : []);
  }
  return map;
}

function emptyPatches() {
  return new Map();
}

// ---------------------------------------------------------------------------
// parseLogOutput
// ---------------------------------------------------------------------------

test("parseLogOutput: parses %H|%an|%aI|%s format", () => {
  const raw =
    "aaa1111|Alice|2025-06-01T10:00:00+00:00|Initial change\n" +
    "bbb2222|Bob|2025-06-02T11:00:00+00:00|Fix regression in routing\n";
  const out = parseLogOutput(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].sha, "aaa1111");
  assert.equal(out[0].author, "Alice");
  assert.equal(out[0].subject, "Initial change");
  assert.equal(out[1].subject, "Fix regression in routing");
});

test("parseLogOutput: preserves subjects containing pipes", () => {
  const raw = "ccc3333|Cat|2025-06-03T12:00:00+00:00|Refactor a|b|c\n";
  const out = parseLogOutput(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].subject, "Refactor a|b|c");
});

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

test("toUtcDate: emits YYYY-MM-DD from ISO timestamp", () => {
  assert.equal(toUtcDate("2025-06-01T23:30:00+10:00"), "2025-06-01");
});

test("daysBetween: computes day delta from two ISO strings", () => {
  const delta = daysBetween("2025-06-01T00:00:00Z", "2025-06-06T00:00:00Z");
  assert.equal(delta, 5);
});

// ---------------------------------------------------------------------------
// Schema-drift detection
// ---------------------------------------------------------------------------

test("detectSchemaDriftField: detects `order:` change in step frontmatter", () => {
  const patch = [
    "diff --git a/skills/dev/steps/02-intake.md b/skills/dev/steps/02-intake.md",
    "--- a/skills/dev/steps/02-intake.md",
    "+++ b/skills/dev/steps/02-intake.md",
    "@@ -1,4 +1,4 @@",
    " ---",
    " name: Intake",
    "-order: 2",
    "+order: 3",
    " description: foo",
  ].join("\n");
  assert.equal(detectSchemaDriftField(patch), "order");
});

test("detectSchemaDriftField: detects allowed-tools change", () => {
  const patch = [
    "--- a/skills/foo/SKILL.md",
    "+++ b/skills/foo/SKILL.md",
    "-allowed-tools: [Bash]",
    "+allowed-tools: [Bash, Read]",
  ].join("\n");
  assert.equal(detectSchemaDriftField(patch), "allowed-tools");
});

test("detectSchemaDriftField: detects persona ref changes", () => {
  const patch = [
    "--- a/skills/foo/SKILL.md",
    "+++ b/skills/foo/SKILL.md",
    "-Agent: @personas/developer.md",
    "+Agent: @personas/tester.md",
  ].join("\n");
  assert.equal(detectSchemaDriftField(patch), "personas-ref");
});

test("detectSchemaDriftField: returns null on unrelated body changes", () => {
  const patch = [
    "--- a/skills/foo/SKILL.md",
    "+++ b/skills/foo/SKILL.md",
    "-Old sentence in body.",
    "+New sentence in body.",
  ].join("\n");
  assert.equal(detectSchemaDriftField(patch), null);
});

// ---------------------------------------------------------------------------
// classifyCommits — mechanical cases
// ---------------------------------------------------------------------------

test("classifyCommits: revert within 14 days matches (trigger half = a-revert-14d)", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "Change routing",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-06-10T00:00:00Z",
      subject: 'Revert "Change routing"',
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  const s = report.per_surface.get(surface);
  assert.equal(s.routing.length, 1);
  assert.equal(s.routing[0].trigger_half, "a-revert-14d");
});

test("classifyCommits: revert after 14 days does NOT match", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "Change routing",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      // 20 days later — beyond 14d window.
      dateIso: "2025-06-21T00:00:00Z",
      subject: 'Revert "Change routing"',
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  const s = report.per_surface.get(surface);
  // Without a revert match, (b) also fails (no keyword).
  assert.equal(s.routing.length, 0);
  void REVERT_WINDOW_DAYS;
});

test("classifyCommits: keyword within 30 days matches (trigger half = b-keyword-30d)", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "Broaden intake routing",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-06-15T00:00:00Z",
      subject: "Fix routing regression on intake",
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  const s = report.per_surface.get(surface);
  assert.equal(s.routing.length, 1);
  assert.equal(s.routing[0].trigger_half, "b-keyword-30d");
});

test("classifyCommits: keyword beyond 30 days does NOT match", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "Broaden intake routing",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-08-01T00:00:00Z",
      subject: "Fix routing regression on intake",
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  const s = report.per_surface.get(surface);
  assert.equal(s.routing.length, 0);
  void KEYWORD_WINDOW_DAYS;
});

test("classifyCommits: schema-drift field detected when fix patch touches order:", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "Rewire intake routing",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-06-15T00:00:00Z",
      subject: "Fix step order regression",
    },
  ];
  const logs = entriesFor(surface, entries);
  const patches = new Map();
  patches.set(
    "bbbbbbb2222222222222222222222222222bbbbb:" + surface,
    [
      "--- a/skills/dev/steps/02-intake.md",
      "+++ b/skills/dev/steps/02-intake.md",
      "-order: 2",
      "+order: 3",
    ].join("\n")
  );
  const report = classifyCommits(logs, patches);
  const s = report.per_surface.get(surface);
  assert.equal(s.routing.length, 1);
  assert.equal(s.schema_drift.length, 1);
  assert.equal(s.schema_drift[0].field, "order");
});

test("classifyCommits: multi-surface commit counts once per surface (tie-break rule)", () => {
  const shaA = "aaaaaaa1111111111111111111111111111aaaaa";
  const shaB = "bbbbbbb2222222222222222222222222222bbbbb";
  const logs = new Map();
  for (const s of PRIORITY_SURFACES) {
    logs.set(s, []);
  }
  // Single commit that touches TWO surfaces.
  const surfaceA = "skills/dev/steps/02-intake.md";
  const surfaceB = "skills/groom/steps/01-intake.md";
  const touch = {
    sha: shaA,
    author: "Alice",
    dateIso: "2025-06-01T00:00:00Z",
    subject: "Touch both intakes",
  };
  const fix = {
    sha: shaB,
    author: "Bob",
    dateIso: "2025-06-10T00:00:00Z",
    subject: "Fix regression on intakes",
  };
  logs.set(surfaceA, [touch, fix]);
  logs.set(surfaceB, [touch, fix]);

  const report = classifyCommits(logs, emptyPatches());
  assert.equal(report.per_surface.get(surfaceA).routing.length, 1);
  assert.equal(report.per_surface.get(surfaceB).routing.length, 1);
  // Total counts each surface (tie-break rule).
  assert.equal(report.total_routing, 2);
});

test("classifyCommits: deterministic output for per-surface SHA ordering", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "ccccccc3333333333333333333333333333ccccc",
      author: "Cat",
      dateIso: "2025-06-02T00:00:00Z",
      subject: "Third change",
    },
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      dateIso: "2025-06-01T00:00:00Z",
      subject: "First change",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-06-03T00:00:00Z",
      subject: "Fix regression second",
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  assert.equal(report.per_surface.get(surface).routing.length, 2);
  const shas = report.per_surface.get(surface).routing.map((r) => r.sha);
  // Alice first (earliest), then Cat. Chronological sort inside classifier.
  assert.deepEqual(shas, [
    "aaaaaaa1111111111111111111111111111aaaaa",
    "ccccccc3333333333333333333333333333ccccc",
  ]);
});

test("classifyCommits: UTC date formatting in output", () => {
  const surface = "skills/dev/steps/02-intake.md";
  const entries = [
    {
      sha: "aaaaaaa1111111111111111111111111111aaaaa",
      author: "Alice",
      // Non-UTC timezone — classifier should emit UTC YYYY-MM-DD.
      dateIso: "2025-06-01T22:00:00-05:00",
      subject: "Late-evening tweak",
    },
    {
      sha: "bbbbbbb2222222222222222222222222222bbbbb",
      author: "Bob",
      dateIso: "2025-06-05T00:00:00Z",
      subject: "Fix regression fallout",
    },
  ];
  const logs = entriesFor(surface, entries);
  const report = classifyCommits(logs, emptyPatches());
  const routing = report.per_surface.get(surface).routing;
  assert.equal(routing.length, 1);
  assert.equal(routing[0].date, "2025-06-02"); // 22:00 -05:00 -> 03:00 UTC next day
});

// ---------------------------------------------------------------------------
// runAudit with injected runGit (deterministic integration)
// ---------------------------------------------------------------------------

test("runAudit: AC1.3 — byte-identical output for same --since + --until", () => {
  const fakeLog = new Map();
  fakeLog.set(
    "log-skills/dev/steps/02-intake.md",
    "aaaaaaa1111111111111111111111111111aaaaa|Alice|2025-06-01T00:00:00+00:00|Broaden intake routing\n" +
      "bbbbbbb2222222222222222222222222222bbbbb|Bob|2025-06-15T00:00:00+00:00|Fix routing regression on intake\n"
  );

  function runGit(args) {
    if (args[0] === "rev-parse") {
      return "27756b8928a194f36430b9b3c6d763f044800d8a\n";
    }
    if (args[0] === "log") {
      // args[-2] is "--", args[-1] is the path
      const path = args[args.length - 1];
      return fakeLog.get("log-" + path) || "";
    }
    if (args[0] === "show") {
      if (args.includes("-s")) {
        return "2025-06-20T00:00:00+00:00\n";
      }
      return "";
    }
    return "";
  }

  const out1 = runAudit({ since: "2025-05-01", until: "HEAD", runGit });
  const out2 = runAudit({ since: "2025-05-01", until: "HEAD", runGit });
  assert.equal(out1, out2, "Audit output must be byte-identical for same inputs");
});
