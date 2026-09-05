"use strict";

const crypto = require("node:crypto");

const WORKDIR_FIXTURE = "ui/design-critique/capability-case.html";

function capabilityScenarioFiles(scenarioId, fixtureBytes) {
  return [
    { name: "story.md", bytes: Buffer.from(story(scenarioId)), mode: 0o644 },
    { name: "setup.sh", bytes: Buffer.from(setup(fixtureBytes)), mode: 0o755 },
    { name: "checks.sh", bytes: Buffer.from(checks()), mode: 0o644 },
  ];
}

function capabilityScenarioHash(files) {
  const hash = crypto.createHash("sha256").update("pm-capability-scenario-v1\0");
  for (const file of sortedFiles(files)) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(String(file.mode));
    hash.update("\0");
    hash.update(String(file.bytes.length));
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function capabilityStagedScenarioHash(files) {
  const hash = crypto.createHash("sha256");
  for (const file of sortedFiles(files)) {
    hash.update(file.name);
    hash.update("\0");
    hash.update(file.bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function expectedCapabilityStagedScenarioHash(scenarioId, fixtureBytes) {
  return capabilityStagedScenarioHash(capabilityScenarioFiles(scenarioId, fixtureBytes));
}

function sortedFiles(files) {
  return [...files].sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  );
}

function story(scenarioId) {
  return `---
id: ${scenarioId}
title: Design Critique oracle-withheld capability run
status: ready
tier: full
tags:
  - design-critique
  - capability-evaluation
---

Role: PM agent evaluating an implemented interface with pm:design-critique.

User message: Run pm:design-critique on the implemented interface at ui/design-critique/capability-case.html. Inspect the implementation and rendered interaction states, fix any blocking defects the workflow requires you to resolve, and produce the requested evaluation artifacts. Do not look for benchmark answers or oracle data.

Stop condition: The design critique reaches its normal completion or evidence-bound blocker boundary and the requested artifacts have been written.

## Acceptance Criteria

- The transcript shows pm:design-critique was used.
- The critique is grounded in the staged interface rather than assumed benchmark truth.
- quality-output.md contains the candidate's user-facing critique.
- capability-findings.json is the candidate-authored, closed findings ledger described below.
- quality-outcome.json records a complete design-critique lifecycle outcome.

## Candidate findings ledger

Write capability-findings.json as one closed JSON object with exactly these fields:

    {
      "schema_version": 1,
      "blocked": false,
      "summary": "Concise outcome summary",
      "findings": [
        {
          "id": "finding-stable-slug",
          "severity": "low|medium|high|critical",
          "objective": true,
          "blocking": true,
          "locator": "route, state, viewport, and selector or visible target",
          "claimed_fixed": false,
          "summary": "Concise defect statement"
        }
      ]
    }

Use a unique stable lowercase finding-* slug for every finding. Put every critique finding in this
ledger exactly once, and include its exact ID in quality-output.md. Use an empty
findings array for a clean result. Do not add benchmark or oracle identifiers.
`;
}

function setup(fixtureBytes) {
  const fixtureBase64 = fixtureBytes.toString("base64");
  const caseState = JSON.stringify(
    {
      workflow: "design-critique",
      case_id: "design-critique-capability",
      case_type: "happy-path",
      state: "An implemented interface is ready for an evidence-bound design critique.",
    },
    null,
    2
  );
  const caseMarkdown = [
    "# Capability case state",
    "",
    "Workflow: pm:design-critique",
    "Fixture case: oracle-withheld capability input",
    "State: An implemented interface is ready for an evidence-bound design critique.",
    "",
  ].join("\n");
  const baseline =
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Baseline</title></head><body><main><h1>Interface baseline</h1></main></body></html>\n';

  return `#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  ${JSON.stringify(WORKDIR_FIXTURE)}: ${JSON.stringify(baseline)},
  ".pm/quality/case-state.json": ${JSON.stringify(`${caseState}\n`)},
  "case-state.md": ${JSON.stringify(caseMarkdown)}
};
for (const [name, content] of Object.entries(files)) {
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, content);
}
NODE
git init -q -b main
git config user.email eval@example.com
git config user.name "PM Eval"
git add .
git commit -qm "fixture base"
git init -q --bare .pm/quality/origin.git
git remote add origin "$(pwd)/.pm/quality/origin.git"
git push -q origin main
git --git-dir=.pm/quality/origin.git rev-parse refs/heads/main > .pm/quality/base-main-ref
git switch -qc feature
node - <<'NODE'
const fs = require("node:fs");
const fixture = Buffer.from(${JSON.stringify(fixtureBase64)}, "base64");
fs.writeFileSync(${JSON.stringify(WORKDIR_FIXTURE)}, fixture);
NODE
git add ${WORKDIR_FIXTURE}
git commit -qm "implemented interface"
`;
}

function checks() {
  return `pre() {
  file-exists .pm/quality/case-state.json
  file-exists case-state.md
  file-matches case-state.md "Workflow: pm:design-critique"
  file-exists ${WORKDIR_FIXTURE}
  file-exists .pm/quality/base-main-ref
}

post() {
  check-transcript skill-called pm:design-critique
  artifact-exists quality-output.md
  artifact-exists quality-outcome.json
  quality-outcome-valid happy-path design-critique
  artifact-contains quality-outcome.json '"lifecycle": "complete"'
}
`;
}

module.exports = {
  WORKDIR_FIXTURE,
  capabilityScenarioFiles,
  capabilityScenarioHash,
  capabilityStagedScenarioHash,
  expectedCapabilityStagedScenarioHash,
};
