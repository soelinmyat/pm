#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:design-critique\nCase: resume\nState: A partial session exists with accepted decisions; source identity must be revalidated before continuing.\nResume revalidation command: node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" revalidate design-critique \"$(pwd)\"\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"design-critique-resume\",\n  \"frozen\": true\n}\n",
  "ui/report.html": "<!doctype html><meta name=viewport content='width=device-width'><style>.report{width:900px}.actions{position:fixed;right:0}</style><main class=report><h1>Workflow report</h1><button class=actions>Export</button></main>",
  "renders/desktop.txt": "Viewport 1440x900: report visible; fixed export action overlaps heading.\n",
  "renders/mobile.txt": "Viewport 375x812: 900px report causes horizontal overflow; action is off-screen.\n",
  "renders/print.txt": "Print: fixed action obscures first heading and navigation remains visible.\n",
  ".pm/quality/resume-session.json": "{\n  \"workflow\": \"design-critique\",\n  \"completed\": [\n    \"intake\",\n    \"research\"\n  ],\n  \"accepted_decisions\": [\n    \"preserve source identity\"\n  ],\n  \"source_hash\": \"frozen-source\"\n}\n",
  "user-owned-dirt.txt": "local notes — do not overwrite\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"design-critique\",\n  \"case_id\": \"design-critique-resume\",\n  \"case_type\": \"resume\",\n  \"state\": \"A partial session exists with accepted decisions; source identity must be revalidated before continuing.\"\n}\n"
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
printf '%s\n' 'design-critique resume change' >> ui/report.html
git add ui/report.html
git commit -qm "fixture feature change"
printf '%s\n' 'user continuation' >> user-owned-dirt.txt
node "$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js" seed design-critique "$(pwd)"
