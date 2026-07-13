#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:groom\nCase: low-quality-schema-valid\nState: The staged artifact passes schema checks but lacks evidence, decision depth, and executable detail.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"groom-low-quality-schema-valid\",\n  \"frozen\": true\n}\n",
  "pm/backlog/csv-export.md": "---\nid: csv-export\nstatus: captured\n---\n# CSV export\n\nEvidence: ACME and Northstar require scheduled CSV delivery.\n",
  "pm/evidence/export-signals.md": "# Evidence\n\nACME: scheduled finance export.\nNorthstar: permission-scoped delivery.\n",
  "weak-but-valid-artifact.json": "{\n  \"schema_version\": 1,\n  \"status\": \"proposed\",\n  \"summary\": \"Improve it\",\n  \"evidence\": [],\n  \"risks\": [\n    \"Things may fail\"\n  ],\n  \"next_steps\": [\n    \"Do the work\"\n  ]\n}\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"groom\",\n  \"case_id\": \"groom-low-quality-schema-valid\",\n  \"case_type\": \"low-quality-schema-valid\",\n  \"state\": \"The staged artifact passes schema checks but lacks evidence, decision depth, and executable detail.\"\n}\n"
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
printf '%s\n' 'groom low-quality-schema-valid change' >> pm/backlog/csv-export.md
git add pm/backlog/csv-export.md
git commit -qm "fixture feature change"

node "$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js" snapshot "$(pwd)"
