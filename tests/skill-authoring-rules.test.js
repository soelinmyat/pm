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
const { sections } = require("../scripts/lib/skill-authoring/markdown.js");

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

test("fenced heading examples cannot satisfy operative section contracts", () => {
  const parsed = sections("Before\n\n```markdown\n## Goal\nOnly an example body.\n```\n");
  assert.equal(parsed.has("goal"), false);
});

test("shorter nested fences do not close a longer outer fence", () => {
  const parsed = sections(
    [
      "````markdown",
      "```markdown",
      "## Goal",
      "Still inside the outer example.",
      "```",
      "## How",
      "Also still inside the outer example.",
      "````",
      "## Done-when",
      "This heading is operative.",
    ].join("\n")
  );
  assert.equal(parsed.has("goal"), false);
  assert.equal(parsed.has("how"), false);
  assert.equal(parsed.has("done-when"), true);
});

test("workflow without telemetry steps fails the entry-point contract", () => {
  const ctx = {
    skills: [
      {
        name: "fixture",
        skillFmExists: true,
        skillFm: {
          description: "Use when a fixture needs a complete workflow declaration.",
        },
        skillBody: [
          "## Purpose\nA substantive purpose for validation.",
          "## Iron Law\n**NEVER OMIT THE REQUIRED DECLARATION.**",
          "## When NOT to use\nRoute unrelated work elsewhere.",
          "```markdown\n**Workflow:** `fixture` | **Telemetry steps:** `intake`\n```",
          "## Red Flags\nA substantive self-check section.",
          "## Escalation Paths\nStop and ask the user.",
          "## Common Rationalizations\nA substantive rationale table.",
          "## Before Marking Done\nA substantive completion list.",
        ].join("\n\n"),
        steps: [],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-SKILL-001-contract-sections");
  assert.match(
    rule
      .check(ctx)
      .map((issue) => issue.message)
      .join("\n"),
    /Workflow\/telemetry/
  );
});

test("capture completion rejects three unrelated checklist rows", () => {
  const ctx = {
    skills: [
      {
        name: "fixture",
        skillFm: { "skill-class": "capture" },
        skillBody: [
          "## Red Flags — Self-Check",
          '- **"One."** Stop and check.',
          '- **"Two."** Instead validate.',
          '- **"Three."** Route correctly.',
          '- **"Four."** Ask first.',
          "## Escalation Paths",
          "Stop and ask the user before continuing.",
          "## Common Rationalizations",
          "| Excuse | Reality |",
          "|---|---|",
          "| One | Reality one |",
          "| Two | Reality two |",
          "## Before Marking Done",
          "- [ ] The colors are pleasant.",
          "- [ ] The prose is concise.",
          "- [ ] The headings are short.",
        ].join("\n"),
        steps: [],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-SKILL-004-self-checks");
  assert.match(
    rule
      .check(ctx)
      .map((issue) => issue.message)
      .join("\n"),
    /completion signals/
  );
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

test("fenced directives and dispatch examples do not satisfy live contracts", () => {
  const skill = {
    name: "fixture",
    skillFmExists: true,
    skillFm: {},
    skillBody: [
      "```markdown",
      "Read `${CLAUDE_PLUGIN_ROOT}/references/skill-runtime.md`.",
      "Read `${CLAUDE_PLUGIN_ROOT}/references/writing.md`.",
      "Dispatch to `skills/fixture/SKILL.md`.",
      "```",
    ].join("\n"),
    steps: [],
  };
  const byId = new Map(d2Rules().map((rule) => [rule.id, rule]));
  assert.equal(byId.get("D2-SKILL-002-reference-directives").check({ skills: [skill] }).length, 2);
  assert.match(
    byId.get("D2-CMD-001-surface-parity").check({
      skills: [skill],
      commands: [{ name: "fixture", frontmatter: {}, body: skill.skillBody }],
    })[0].message,
    /must dispatch/
  );
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

test("fenced class signals do not satisfy boundaries but fenced mutations remain unsafe", () => {
  const ctx = {
    skills: [
      {
        name: "list",
        skillFm: {},
        skillBody: [
          "This is a read-only view.",
          "```text",
          "Handle an empty or missing source as an error.",
          "const fs = require('node:fs'); fs.mkdirSync('.pm/cache');",
          "```",
        ].join("\n"),
        steps: [],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-SKILL-005-class-contract");
  const messages = rule.check(ctx).map((issue) => issue.message);
  assert.ok(messages.some((message) => /class boundary/.test(message)));
  assert.ok(messages.some((message) => /mutation command/.test(message)));
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

test("linear workflows reject backward and terminal numbered advances", () => {
  const ctx = {
    skills: [
      {
        name: "fixture",
        steps: [
          {
            frontmatter: { order: 1 },
            relPath: "steps/01-start.md",
            body: "**Advance:** proceed to Step 2.",
          },
          {
            frontmatter: { order: 2 },
            relPath: "steps/02-work.md",
            body: "**Advance:** proceed to Step 3, or Step 1 if retrying.",
          },
          {
            frontmatter: { order: 3 },
            relPath: "steps/03-done.md",
            body: "Summarize the result. **Advance:** proceed to Step 1.",
          },
        ],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-STEP-002-transition");
  const messages = rule.check(ctx).map((issue) => issue.message);
  assert.ok(messages.some((message) => /backward or circular/.test(message)));
  assert.ok(messages.some((message) => /final step cannot advance/.test(message)));
});

test("fenced transition examples cannot satisfy live step transitions", () => {
  const ctx = {
    skills: [
      {
        name: "fixture",
        steps: [
          {
            frontmatter: { order: 1 },
            relPath: "steps/01-start.md",
            body: "```markdown\n**Advance:** proceed to Step 2.\n```",
          },
          {
            frontmatter: { order: 2 },
            relPath: "steps/02-done.md",
            body: "```markdown\nOffer the next action.\n```",
          },
        ],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-STEP-002-transition");
  const messages = rule.check(ctx).map((issue) => issue.message);
  assert.ok(messages.some((message) => /non-final step must advance/.test(message)));
  assert.ok(messages.some((message) => /final step must summarize/.test(message)));
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
            body: "**Advance:** proceed to Step 2, Step 3, Step 4, Step 5, Step 6, or Step 7 according to the selected branch.",
          },
          {
            frontmatter: { order: 2 },
            relPath: "steps/02-status.md",
            body: "Summarize status and offer the next action.",
          },
          ...[3, 4, 5, 6, 7].map((order) => ({
            frontmatter: { order },
            relPath: `steps/0${order}-mode.md`,
            body: "Summarize the routed result and offer the next action.",
          })),
        ],
      },
    ],
  };
  const rule = d2Rules().find((entry) => entry.id === "D2-STEP-002-transition");
  assert.deepEqual(rule.check(ctx), []);
});

test("skill audit JSON is deterministic and reports the enforced clean baseline", () => {
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
  assert.equal(parsed.enforcement, "enforced");
  assert.equal(parsed.skills.length, Object.keys(SKILL_CLASSIFICATION).length);
  assert.equal(parsed.summary.issue_count, 0);
  assert.equal(parsed.summary.clean_skill_count, parsed.summary.skill_count);
});
