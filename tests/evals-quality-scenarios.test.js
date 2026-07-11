"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const suite = JSON.parse(
  fs.readFileSync(path.join(root, "evals", "quality", "suite.json"), "utf8")
);

const workflowMarker = {
  groom: "pm/backlog/csv-export.md",
  rfc: "docs/architecture.md",
  dev: "change-request.md",
  review: "review-intent.md",
  "design-critique": "ui/report.html",
  ship: ".pm/quality/hosted-state.json",
};

const typeMarker = {
  "happy-path": ".pm/quality/input-lock.json",
  "ambiguous-input": "decision-options.md",
  resume: ".pm/quality/resume-session.json",
  "blocked-and-recovery": "contract-check.js",
  "authority-boundary": "unrelated-user-code.txt",
  "low-quality-schema-valid": "weak-but-valid-artifact.json",
  "repeated-run-variance": "repeat-control.json",
};

test("every quality case has concrete workflow/type state and a semantic output gate", () => {
  const refs = new Set();
  for (const workflow of suite.workflows) {
    for (const item of workflow.cases) {
      assert.equal(refs.has(item.scenario_ref), false, `duplicate ${item.scenario_ref}`);
      refs.add(item.scenario_ref);
      const dir = path.join(root, "evals", "scenarios", item.scenario_ref);
      const setup = fs.readFileSync(path.join(dir, "setup.sh"), "utf8");
      const checks = fs.readFileSync(path.join(dir, "checks.sh"), "utf8");
      const story = fs.readFileSync(path.join(dir, "story.md"), "utf8");
      assert.match(setup, new RegExp(escapeRegExp(workflowMarker[workflow.id])));
      assert.match(setup, new RegExp(escapeRegExp(typeMarker[item.type])));
      assert.match(checks, /artifact-exists quality-output\.md/);
      assert.match(checks, /artifact-exists quality-outcome\.json/);
      assert.ok(story.includes(`  - ${workflow.id}\n`));
      assert.ok(story.includes(`  - ${item.type}\n`));
      if (item.type === "authority-boundary") {
        assert.match(checks, /USER-OWNED-DO-NOT-EDIT/);
      }
      if (item.type === "blocked-and-recovery") {
        assert.match(checks, /command-fails "node contract-check\.js"/);
        assert.match(checks, /recovery_test/);
      }
      if (item.type === "resume") {
        assert.match(setup, /quality-resume\.js|phase: research/);
        assert.match(checks, /resume_validated/);
      }
    }
  }
  assert.equal(refs.size, 41);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
