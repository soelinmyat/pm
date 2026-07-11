#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:design-critique\nCase: repeated-run-variance\nState: The source snapshot and inputs are frozen for three independent repeats.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"design-critique-repeated-run-variance\",\n  \"frozen\": true\n}\n",
  "ui/report.html": "<!doctype html><meta name=viewport content='width=device-width'><style>.report{width:900px}.actions{position:fixed;right:0}</style><main class=report><h1>Workflow report</h1><button class=actions>Export</button></main>",
  "renders/desktop.txt": "Viewport 1440x900: report visible; fixed export action overlaps heading.\n",
  "renders/mobile.txt": "Viewport 375x812: 900px report causes horizontal overflow; action is off-screen.\n",
  "renders/print.txt": "Print: fixed action obscures first heading and navigation remains visible.\n",
  ".pm/quality/repeat-control.json": "{\n  \"repeats\": 3,\n  \"source\": \"frozen\",\n  \"reset_between_runs\": true\n}\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"design-critique\",\n  \"case_id\": \"design-critique-repeated-run-variance\",\n  \"case_type\": \"repeated-run-variance\",\n  \"state\": \"The source snapshot and inputs are frozen for three independent repeats.\"\n}\n"
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
printf '%s\n' 'design-critique repeated-run-variance change' >> ui/report.html
git add ui/report.html
git commit -qm "fixture feature change"


