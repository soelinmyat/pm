"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  validateSemanticContracts,
} = require("../scripts/lib/skill-authoring/semantic-contracts.js");

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-semantic-contract-"));
  for (const [relative, body] of Object.entries(files)) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body);
  }
  return {
    root,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test("semantic contracts reject unresolved PM lanes without rejecting personas or internal QA", (t) => {
  const project = fixture({
    "skills/groom/SKILL.md": "Use pm:shape, pm:designer, and pm:qa.\n",
    "agents/designer.md": "---\nname: designer\n---\n",
  });
  t.after(project.cleanup);

  const issues = validateSemanticContracts(project.root);
  assert.ok(
    issues.some((issue) => issue.ruleId === "D3-REF-001" && /pm:shape/.test(issue.message))
  );
  assert.ok(!issues.some((issue) => /pm:designer|pm:qa/.test(issue.message)));
});

test("semantic contracts reject obsolete canonical session and override paths", (t) => {
  const project = fixture({
    "ARCHITECTURE.md": [
      ".pm/groom-sessions/{slug}.md",
      ".pm/groom-sessions/*.md",
      ".pm/{skill}-sessions/{session}/steps/",
    ].join("\n"),
  });
  t.after(project.cleanup);

  const issues = validateSemanticContracts(project.root);
  assert.equal(issues.filter((issue) => issue.ruleId === "D3-PATH-001").length, 3);
});

test("semantic contracts scan every runtime Markdown file and exempt explicit legacy migration examples", (t) => {
  const project = fixture({
    "skills/list/steps/01-discover.md": ".pm/dev-sessions/*.md\n",
    "skills/dev/SKILL.md":
      "If only legacy .pm/dev-sessions/{slug}.md exists, migrate it to session.json.\n",
  });
  t.after(project.cleanup);

  const issues = validateSemanticContracts(project.root);
  assert.equal(issues.filter((issue) => issue.ruleId === "D3-PATH-001").length, 1);
  assert.equal(issues[0].file, "skills/list/steps/01-discover.md");
});

test("semantic contracts reject host-precedence claims and mutation hidden behind read-only wording", (t) => {
  const project = fixture({
    "skills/using-pm/SKILL.md":
      "User instructions always take precedence over plugin and system instructions.\n",
    "skills/board/SKILL.md": "This is a read-only board. POST /api/loop/toggle pauses the loop.\n",
  });
  t.after(project.cleanup);

  const issues = validateSemanticContracts(project.root);
  assert.ok(issues.some((issue) => issue.ruleId === "D3-AUTH-001"));
  assert.ok(issues.some((issue) => issue.ruleId === "D3-AUTH-002"));
});

test("semantic contracts enforce ambiguous routing sentinels and current public prompt wording", (t) => {
  const project = fixture({
    "skills/using-pm/SKILL.md": [
      '| "Should we add X?" | `pm:research` | investigate |',
      '| "Enable Linear" | `pm:start` | initialize |',
    ].join("\n"),
    "plugin.config.json": JSON.stringify({
      codex: { interface: { defaultPrompt: ["Turn this feature idea into sprint-ready issues."] } },
    }),
  });
  t.after(project.cleanup);

  const issues = validateSemanticContracts(project.root);
  assert.ok(
    issues.some((issue) => issue.ruleId === "D3-ROUTE-001" && /Should we/.test(issue.message))
  );
  assert.ok(
    issues.some((issue) => issue.ruleId === "D3-ROUTE-001" && /Enable Linear/.test(issue.message))
  );
  assert.ok(issues.some((issue) => issue.ruleId === "D3-DOC-001"));
});
