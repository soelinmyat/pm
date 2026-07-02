"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Fixture transcripts model realistic flows so the pipeline self-test
// exercises the evidence checks (command content, exit codes, ordering),
// not just event presence. dev-ui-design-critique-required deliberately
// emits the wrong skill name to keep one engineered fail in the suite.
const TRANSCRIPTS = {
  "dev-ui-design-critique-required": [
    { type: "skill", name: "pm:dev" },
    { type: "skill", name: "critique" },
  ],
  "dev-review-before-push": [
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 0 },
    { type: "skill", name: "pm:review" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "git push origin feature-branch",
      exit_code: 0,
    },
  ],
  "dev-tdd-before-implementation": [
    { type: "skill", name: "pm:dev" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "npm test -- --filter desired-behavior",
      exit_code: 1,
    },
    { type: "tool", name: "functions.apply_patch", command: "apply_patch src/behavior.js" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "npm test -- --filter desired-behavior",
      exit_code: 0,
    },
  ],
  "skill-description-body-read": [
    { type: "skill", name: "pm:groom" },
    { type: "tool", name: "functions.exec_command", command: "git log --oneline", exit_code: 0 },
  ],
  "review-catches-planted-bug": [{ type: "skill", name: "pm:review" }],
  "no-leak-into-public-repo": [
    { type: "skill", name: "pm:dev" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "git -C public-plugin commit -m fix",
      exit_code: 0,
    },
  ],
  "kb-sync-no-lost-writes": [
    { type: "skill", name: "pm:note" },
    { type: "tool", name: "functions.exec_command", command: "git -C kb commit", exit_code: 0 },
  ],
  "dev-halts-on-m-size-without-rfc": [
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "cat task.md", exit_code: 0 },
  ],
  "loop-worker-respects-gates": [
    { type: "skill", name: "pm:dev" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 1 },
    { type: "tool", name: "functions.apply_patch", command: "apply_patch app/src/slugify.js" },
    { type: "tool", name: "functions.exec_command", command: "npm test", exit_code: 0 },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "git -C app push -u origin loop/loop-1",
      exit_code: 0,
    },
  ],
  "loop-ship-respects-merge-grant": [
    { type: "skill", name: "pm:ship" },
    {
      type: "tool",
      name: "functions.exec_command",
      command: "git -C app push origin loop/loop-1",
      exit_code: 0,
    },
  ],
};

function run({ scenarioId, paths }) {
  fs.mkdirSync(paths.artifactsDir, { recursive: true });
  fs.mkdirSync(path.join(paths.artifactsDir, "raw-output"), { recursive: true });

  const events = TRANSCRIPTS[scenarioId] || [];
  const transcript = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  fs.writeFileSync(paths.transcriptRaw, transcript);
  fs.writeFileSync(paths.transcriptNormalized, transcript);

  writeScenarioArtifacts(scenarioId, paths);
  fs.writeFileSync(
    path.join(paths.artifactsDir, "raw-output", "stub.log"),
    `stub adapter completed ${scenarioId}\n`
  );

  return { status: "pass", events: events.length };
}

function writeScenarioArtifacts(scenarioId, paths) {
  switch (scenarioId) {
    case "dev-ui-design-critique-required":
      writeJson(path.join(paths.artifactsDir, "ui-critique.json"), {
        outcome: "reviewed",
        signal: "ui critique present",
      });
      break;
    case "dev-review-before-push":
      writeJson(path.join(paths.artifactsDir, "review-report.json"), {
        outcome: "reviewed-before-push",
      });
      break;
    case "skill-description-body-read":
      fs.writeFileSync(
        path.join(paths.artifactsDir, "proposal.md"),
        "# Proposal\n\nSkill body read.\n"
      );
      break;
    case "review-catches-planted-bug": {
      const finding = "P1: planted assignment bug `items.length = 0` changes behavior.\n";
      fs.writeFileSync(path.join(paths.workdir, "review-findings.md"), finding);
      fs.writeFileSync(path.join(paths.artifactsDir, "review-findings.md"), finding);
      break;
    }
    case "loop-worker-respects-gates": {
      const cardPath = path.join(paths.workdir, "app", "pm", "backlog", "loop-1.md");
      const card = fs.readFileSync(cardPath, "utf8");
      fs.writeFileSync(
        cardPath,
        card
          .replace("status: planned", "status: shipping")
          .replace("created: 2026-07-01", 'branch: "loop/loop-1"\ncreated: 2026-07-01')
      );
      break;
    }
    case "kb-sync-no-lost-writes": {
      const insightDir = path.join(paths.workdir, "kb", "pm", "insights");
      fs.mkdirSync(insightDir, { recursive: true });
      fs.writeFileSync(
        path.join(insightDir, "mobile-onboarding-friction.md"),
        "---\ntitle: Mobile onboarding friction\norigin: agent\n---\n\nNew insight.\n"
      );
      break;
    }
    default:
      break;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

module.exports = { name: "stub", run };
