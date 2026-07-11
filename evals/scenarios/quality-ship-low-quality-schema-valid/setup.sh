#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:ship\nCase: low-quality-schema-valid\nState: The staged artifact passes schema checks but lacks evidence, decision depth, and executable detail.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"ship-low-quality-schema-valid\",\n  \"frozen\": true\n}\n",
  ".pm/quality/hosted-state.json": "{\n  \"pr\": 42,\n  \"head\": \"release\",\n  \"checks\": \"green\",\n  \"merge_authorized\": true,\n  \"tag\": \"v9.9.9\"\n}\n",
  "release.txt": "release candidate\n",
  "weak-but-valid-artifact.json": "{\n  \"schema_version\": 1,\n  \"status\": \"proposed\",\n  \"summary\": \"Improve it\",\n  \"evidence\": [],\n  \"risks\": [\n    \"Things may fail\"\n  ],\n  \"next_steps\": [\n    \"Do the work\"\n  ]\n}\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"ship\",\n  \"case_id\": \"ship-low-quality-schema-valid\",\n  \"case_type\": \"low-quality-schema-valid\",\n  \"state\": \"The staged artifact passes schema checks but lacks evidence, decision depth, and executable detail.\"\n}\n"
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
git switch -qc release
printf '%s\n' 'ship low-quality-schema-valid change' >> release.txt
git add release.txt
git commit -qm "fixture release change"

node "$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js" snapshot "$(pwd)"

