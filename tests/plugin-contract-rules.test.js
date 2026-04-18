"use strict";

// Per-rule pass/fail cases for the plugin-contract rule pack.
// Each rule is exercised on a minimal synthetic context — this keeps tests
// independent of fixture trees and gives fast feedback on rule logic.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildContext, loadRules, runPack } = require("../scripts/rules/plugin/index.js");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Load rules by ID once.
const rules = loadRules();
const byId = new Map(rules.map((r) => [r.id, r]));

function makeCtx(overrides = {}) {
  return Object.assign(
    {
      rootDir: "/tmp/none",
      skills: [],
      personas: [],
      commands: [],
      manifests: {
        ".claude-plugin/plugin.json": { exists: false },
        "plugin.config.json": { exists: false },
        ".claude-plugin/marketplace.json": { exists: false },
        ".codex-plugin/plugin.json": { exists: false },
      },
    },
    overrides
  );
}

function mkSkill(name, skillFm, steps, opts = {}) {
  return {
    name,
    absPath: `/tmp/${name}`,
    skillFilePath: `/tmp/${name}/SKILL.md`,
    skillFmExists: opts.skillFmExists !== false,
    skillFm: skillFm || {},
    skillBody: opts.skillBody || "",
    steps: steps || [],
  };
}

function mkStep(fileName, frontmatter, opts = {}) {
  return {
    fileName,
    absPath: `/tmp/${fileName}`,
    relPath: opts.relPath || `skills/sample/steps/${fileName}`,
    frontmatter: frontmatter || {},
    hasFrontmatter: opts.hasFrontmatter !== false,
    body: opts.body || "",
  };
}

// ---------------------------------------------------------------------------
// Registry / loader
// ---------------------------------------------------------------------------

test("loadRules: loads >= 10 rules, IDs are unique, all sorted", () => {
  const ids = rules.map((r) => r.id);
  assert.ok(rules.length >= 10, `expected >=10 rules, got ${rules.length}`);
  assert.equal(new Set(ids).size, ids.length, "rule IDs must be unique");
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted, "rules must be returned in sorted-ID order");
});

// ---------------------------------------------------------------------------
// D1-FM-001 skill name required
// ---------------------------------------------------------------------------

test("D1-FM-001 pass: skill with name reports no issues", () => {
  const ctx = makeCtx({ skills: [mkSkill("s", { name: "s", description: "x" })] });
  assert.equal(byId.get("D1-FM-001").check(ctx).length, 0);
});

test("D1-FM-001 fail: skill missing name reports one issue", () => {
  const ctx = makeCtx({ skills: [mkSkill("s", { description: "x" })] });
  const out = byId.get("D1-FM-001").check(ctx);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /missing required frontmatter key `name:`/);
});

// ---------------------------------------------------------------------------
// D1-FM-002 description required
// ---------------------------------------------------------------------------

test("D1-FM-002 pass: skill with description reports no issues", () => {
  const ctx = makeCtx({ skills: [mkSkill("s", { name: "s", description: "x" })] });
  assert.equal(byId.get("D1-FM-002").check(ctx).length, 0);
});

test("D1-FM-002 fail: skill without description reports one issue", () => {
  const ctx = makeCtx({ skills: [mkSkill("s", { name: "s" })] });
  assert.equal(byId.get("D1-FM-002").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-FM-003 step order required
// ---------------------------------------------------------------------------

test("D1-FM-003 pass: step with order", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-a.md", { order: 1, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-FM-003").check(ctx).length, 0);
});

test("D1-FM-003 fail: step missing order", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [mkStep("01-a.md", { description: "d" })]),
    ],
  });
  assert.equal(byId.get("D1-FM-003").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-FM-004 step order must be positive integer
// ---------------------------------------------------------------------------

test("D1-FM-004 pass: order = 1 accepted", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-a.md", { order: 1, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-FM-004").check(ctx).length, 0);
});

test("D1-FM-004 fail: order = abc rejected", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-a.md", { order: "abc", description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-FM-004").check(ctx).length, 1);
});

test("D1-FM-004 fail: order = 0 rejected", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-a.md", { order: 0, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-FM-004").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-TOOLS-001 allowed-tools whitelist
// ---------------------------------------------------------------------------

test("D1-TOOLS-001 pass: known tools accepted", () => {
  const ctx = makeCtx({
    skills: [mkSkill("s", { name: "s", description: "x", "allowed-tools": ["Bash", "Read"] })],
  });
  assert.equal(byId.get("D1-TOOLS-001").check(ctx).length, 0);
});

test("D1-TOOLS-001 fail: unknown tool rejected", () => {
  const ctx = makeCtx({
    skills: [mkSkill("s", { name: "s", description: "x", "allowed-tools": ["Bash", "Nuke"] })],
  });
  const out = byId.get("D1-TOOLS-001").check(ctx);
  assert.equal(out.length, 1);
  assert.match(out[0].message, /Nuke/);
});

// ---------------------------------------------------------------------------
// D1-CMD-001 command resolves to skill
// ---------------------------------------------------------------------------

test("D1-CMD-001 pass: command references existing skill", () => {
  const ctx = makeCtx({
    skills: [mkSkill("dev", { name: "dev", description: "x" })],
    commands: [
      {
        name: "dev",
        absPath: "/tmp/dev.md",
        body: "Read the skill at ${CLAUDE_PLUGIN_ROOT}/skills/dev/SKILL.md.",
      },
    ],
  });
  assert.equal(byId.get("D1-CMD-001").check(ctx).length, 0);
});

test("D1-CMD-001 fail: command references missing skill", () => {
  const ctx = makeCtx({
    skills: [],
    commands: [
      {
        name: "ghost",
        absPath: "/tmp/ghost.md",
        body: "Read ${CLAUDE_PLUGIN_ROOT}/skills/ghost/SKILL.md.",
      },
    ],
  });
  assert.equal(byId.get("D1-CMD-001").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-PERSONA-001
// ---------------------------------------------------------------------------

test("D1-PERSONA-001 pass: persona ref resolves", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [], { skillBody: "Use @personas/tester.md." }),
    ],
    personas: ["tester"],
  });
  assert.equal(byId.get("D1-PERSONA-001").check(ctx).length, 0);
});

test("D1-PERSONA-001 fail: persona ref missing", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [], { skillBody: "Use @personas/ghost.md." }),
    ],
    personas: ["tester"],
  });
  assert.equal(byId.get("D1-PERSONA-001").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-STEP-001 filename ordering
// ---------------------------------------------------------------------------

test("D1-STEP-001 pass: NN-slug.md filename", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("02-intake.md", { order: 2, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-STEP-001").check(ctx).length, 0);
});

test("D1-STEP-001 fail: missing NN prefix", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("intake.md", { order: 1, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-STEP-001").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-STEP-002 order matches filename
// ---------------------------------------------------------------------------

test("D1-STEP-002 pass: 01-intake.md + order 1", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-intake.md", { order: 1, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-STEP-002").check(ctx).length, 0);
});

test("D1-STEP-002 fail: 01-intake.md + order 9", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-intake.md", { order: 9, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-STEP-002").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-STEP-003 description required
// ---------------------------------------------------------------------------

test("D1-STEP-003 pass: description present", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("s", { name: "s", description: "x" }, [
        mkStep("01-a.md", { order: 1, description: "d" }),
      ]),
    ],
  });
  assert.equal(byId.get("D1-STEP-003").check(ctx).length, 0);
});

test("D1-STEP-003 fail: description missing", () => {
  const ctx = makeCtx({
    skills: [mkSkill("s", { name: "s", description: "x" }, [mkStep("01-a.md", { order: 1 })])],
  });
  assert.equal(byId.get("D1-STEP-003").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-MANIFEST-001 version parity
// ---------------------------------------------------------------------------

test("D1-MANIFEST-001 pass: matching versions", () => {
  const ctx = makeCtx({
    manifests: {
      ".claude-plugin/plugin.json": { exists: true, json: { version: "1.0.0" } },
      "plugin.config.json": { exists: true, json: { version: "1.0.0" } },
      ".claude-plugin/marketplace.json": {
        exists: true,
        json: { plugins: [{ version: "1.0.0" }] },
      },
      ".codex-plugin/plugin.json": { exists: true, json: { version: "1.0.0" } },
    },
  });
  assert.equal(byId.get("D1-MANIFEST-001").check(ctx).length, 0);
});

test("D1-MANIFEST-001 fail: mismatched versions", () => {
  const ctx = makeCtx({
    manifests: {
      ".claude-plugin/plugin.json": { exists: true, json: { version: "1.0.0" } },
      "plugin.config.json": { exists: true, json: { version: "1.0.1" } },
      ".claude-plugin/marketplace.json": {
        exists: true,
        json: { plugins: [{ version: "1.0.0" }] },
      },
      ".codex-plugin/plugin.json": { exists: true, json: { version: "1.0.0" } },
    },
  });
  assert.equal(byId.get("D1-MANIFEST-001").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-MANIFEST-002 JSON valid
// ---------------------------------------------------------------------------

test("D1-MANIFEST-002 pass: valid JSON", () => {
  const ctx = makeCtx({
    manifests: {
      ".claude-plugin/plugin.json": { exists: true, json: { version: "1.0.0" } },
    },
  });
  assert.equal(byId.get("D1-MANIFEST-002").check(ctx).length, 0);
});

test("D1-MANIFEST-002 fail: parse error reported", () => {
  const ctx = makeCtx({
    manifests: {
      ".claude-plugin/plugin.json": {
        exists: true,
        json: null,
        parseError: "Unexpected token",
      },
    },
  });
  assert.equal(byId.get("D1-MANIFEST-002").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// D1-SKILL-001 has step dir
// ---------------------------------------------------------------------------

test("D1-SKILL-001 pass: skill with body ref + steps", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill(
        "sample",
        { name: "sample", description: "x" },
        [mkStep("01-a.md", { order: 1, description: "d" })],
        { skillBody: "Steps live in skills/sample/steps/." }
      ),
    ],
  });
  assert.equal(byId.get("D1-SKILL-001").check(ctx).length, 0);
});

test("D1-SKILL-001 fail: body refs steps/ but no step files", () => {
  const ctx = makeCtx({
    skills: [
      mkSkill("sample", { name: "sample", description: "x" }, [], {
        skillBody: "Steps live in skills/sample/steps/.",
      }),
    ],
  });
  assert.equal(byId.get("D1-SKILL-001").check(ctx).length, 1);
});

// ---------------------------------------------------------------------------
// Integration: buildContext + runPack on real filesystem fixtures
// ---------------------------------------------------------------------------

test("buildContext reads the valid fixture tree correctly", () => {
  const root = path.join(__dirname, "fixtures", "plugin-contract", "valid");
  const ctx = buildContext(root);
  assert.equal(ctx.skills.length, 1);
  assert.equal(ctx.skills[0].name, "sample");
  assert.equal(ctx.skills[0].steps.length, 2);
  assert.ok(ctx.personas.includes("tester"));
  assert.equal(ctx.manifests[".claude-plugin/plugin.json"].json.version, "0.0.1");
});

test("runPack on valid fixture yields zero errors", () => {
  const root = path.join(__dirname, "fixtures", "plugin-contract", "valid");
  const report = runPack(root);
  assert.equal(report.issues.length, 0, JSON.stringify(report.issues, null, 2));
  assert.equal(report.packVersion, "1.0.0");
});

test("runPack on violating/multiple fixture surfaces every rule ID at least once", () => {
  const root = path.join(__dirname, "fixtures", "plugin-contract", "violating", "multiple");
  const report = runPack(root);
  const firedIds = new Set(report.issues.map((i) => i.ruleId));
  const expected = [
    "D1-FM-001",
    "D1-FM-002",
    "D1-FM-003",
    "D1-FM-004",
    "D1-TOOLS-001",
    "D1-CMD-001",
    "D1-PERSONA-001",
    "D1-STEP-001",
    "D1-STEP-002",
    "D1-STEP-003",
    "D1-MANIFEST-001",
    "D1-MANIFEST-002",
    "D1-SKILL-001",
  ];
  for (const id of expected) {
    assert.ok(firedIds.has(id), `expected rule ${id} to fire in violating fixture`);
  }
});

// ---------------------------------------------------------------------------
// Pack stability (AC2.5) — any rename/removal must fail this test.
// ---------------------------------------------------------------------------

test("pack stability: exact rule-ID set + severity is stable across runs (AC2.5)", () => {
  const expected = {
    "D1-CMD-001": "error",
    "D1-FM-001": "error",
    "D1-FM-002": "error",
    "D1-FM-003": "error",
    "D1-FM-004": "error",
    "D1-MANIFEST-001": "error",
    "D1-MANIFEST-002": "error",
    "D1-PERSONA-001": "error",
    "D1-SKILL-001": "error",
    "D1-STEP-001": "error",
    "D1-STEP-002": "error",
    "D1-STEP-003": "error",
    "D1-TOOLS-001": "error",
  };
  const actual = {};
  for (const r of rules) actual[r.id] = r.severity;
  assert.deepEqual(actual, expected);
});

// ---------------------------------------------------------------------------
// Smoke: runPack doesn't crash on a missing plugin root (returns error shape)
// ---------------------------------------------------------------------------

test("runPack survives on an empty tmp dir", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pc-empty-"));
  const report = runPack(tmp);
  assert.equal(report.packVersion, "1.0.0");
  // All rules run; on an empty dir they produce zero issues (no skills).
  assert.equal(report.issues.length, 0);
});
