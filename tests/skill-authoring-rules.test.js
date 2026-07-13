"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures", "skill-authoring");
const { buildContext, loadRules } = require("../scripts/rules/plugin/index.js");
const { SKILL_CLASSIFICATION } = require("../scripts/lib/skill-authoring/classification.js");

function d2Rules() {
  return loadRules().filter((rule) => rule.id.startsWith("D2-"));
}

test("every runtime skill is classified exactly once", () => {
  const runtimeSkills = fs
    .readdirSync(path.join(root, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(Object.keys(SKILL_CLASSIFICATION).sort(), runtimeSkills);
  for (const value of Object.values(SKILL_CLASSIFICATION)) assert.equal(typeof value, "string");
});

test("concise capture fixture passes the entry-point contract rules", () => {
  const ctx = buildContext(path.join(fixtures, "valid-capture"));
  const issues = d2Rules()
    .filter((rule) => rule.id.startsWith("D2-SKILL-"))
    .flatMap((rule) => rule.check(ctx));
  assert.deepEqual(issues, []);
});

test("thin boilerplate fails skill and step substance checks", () => {
  const ctx = buildContext(path.join(fixtures, "invalid-boilerplate"));
  const byId = new Map(d2Rules().map((rule) => [rule.id, rule]));
  assert.ok(byId.get("D2-SKILL-003-iron-law").check(ctx).length > 0);
  assert.ok(byId.get("D2-SKILL-004-self-checks").check(ctx).length > 0);
  assert.ok(byId.get("D2-STEP-001-execution-contract").check(ctx).length > 0);
  assert.ok(byId.get("D2-STEP-002-transition").check(ctx).length > 0);
});

test("command parity catches a redirect whose destination drifted", () => {
  const ctx = {
    skills: [
      {
        name: "simplify",
        skillFm: { description: "Deprecated redirect" },
        skillBody: "Read ${CLAUDE_PLUGIN_ROOT}/skills/review/SKILL.md and redirect.",
        steps: [],
      },
    ],
    commands: [
      {
        name: "simplify",
        frontmatter: { description: "Deprecated redirect" },
        body: "Read ${CLAUDE_PLUGIN_ROOT}/skills/dev/SKILL.md.",
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-CMD-001-surface-parity");
  assert.match(rule.check(ctx)[0].message, /same exact destination/);
});

test("read-only class rejects executable mutation commands", () => {
  const ctx = {
    skills: [
      {
        name: "list",
        skillFm: {},
        skillBody: "Read-only view with an empty-state error. Run `mkdir -p .pm/cache`.",
        steps: [],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-SKILL-005-class-contract");
  assert.match(rule.check(ctx)[0].message, /mutation command/);
});

test("branched Advance may name later existing steps when the branch is explicit", () => {
  const ctx = {
    skills: [
      {
        name: "fixture",
        steps: [
          {
            frontmatter: { order: 1 },
            relPath: "steps/01-route.md",
            body: "**Advance:** proceed to Step 2 or Step 3 according to the selected branch.",
          },
          {
            frontmatter: { order: 2 },
            relPath: "steps/02-work.md",
            body: "**Advance:** proceed to Step 3.",
          },
          {
            frontmatter: { order: 3 },
            relPath: "steps/03-done.md",
            body: "Summarize the result and offer the next action.",
          },
        ],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-STEP-002-transition");
  assert.deepEqual(rule.check(ctx), []);
});

test("routed workflows do not invent linear transitions between subcommands", () => {
  const ctx = {
    skills: [
      {
        name: "loop",
        steps: [
          {
            frontmatter: { order: 1 },
            relPath: "steps/01-route.md",
            body: "Offer Step 2 according to the selected branch as the next action.",
          },
          {
            frontmatter: { order: 2 },
            relPath: "steps/02-status.md",
            body: "Summarize status and offer the next action.",
          },
        ],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-STEP-002-transition");
  assert.deepEqual(rule.check(ctx), []);
});

test("skill audit JSON is deterministic and remains non-blocking during remediation", () => {
  const command = path.join(root, "scripts", "skill-audit.js");
  const first = execFileSync(process.execPath, [command, "--root", root, "--json"], {
    encoding: "utf8",
  });
  const second = execFileSync(process.execPath, [command, "--root", root, "--json"], {
    encoding: "utf8",
  });
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.enforcement, "advisory");
  assert.equal(parsed.skills.length, Object.keys(SKILL_CLASSIFICATION).length);
  assert.ok(parsed.summary.issue_count > 0);
});
