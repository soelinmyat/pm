#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:ship\nCase: repeated-run-variance\nState: The source snapshot and inputs are frozen for three independent repeats.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"ship-repeated-run-variance\",\n  \"frozen\": true\n}\n",
  ".pm/quality/hosted-state.json": "{\n  \"pr\": 42,\n  \"head\": \"release\",\n  \"checks\": \"green\",\n  \"merge_authorized\": true,\n  \"tag\": \"v9.9.9\"\n}\n",
  "release.txt": "release candidate\n",
  ".pm/quality/repeat-control.json": "{\n  \"repeats\": 3,\n  \"source\": \"frozen\",\n  \"reset_between_runs\": true,\n  \"expectation\": \"defect-present\"\n}\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"ship\",\n  \"case_id\": \"ship-repeated-run-variance\",\n  \"case_type\": \"repeated-run-variance\",\n  \"state\": \"The source snapshot and inputs are frozen for three independent repeats.\"\n}\n"
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
printf '%s\n' 'ship repeated-run-variance change' >> release.txt
git add release.txt
git commit -qm "fixture release change"


