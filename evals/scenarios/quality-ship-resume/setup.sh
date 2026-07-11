#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:ship\nCase: resume\nState: A partial session exists with accepted decisions; source identity must be revalidated before continuing.\nResume revalidation command: node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" revalidate ship \"$(pwd)\"\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"ship-resume\",\n  \"frozen\": true\n}\n",
  ".pm/quality/hosted-state.json": "{\n  \"pr\": 42,\n  \"head\": \"release\",\n  \"checks\": \"green\",\n  \"merge_authorized\": true,\n  \"tag\": \"v9.9.9\"\n}\n",
  "release.txt": "release candidate\n",
  ".pm/quality/resume-session.json": "{\n  \"workflow\": \"ship\",\n  \"completed\": [\n    \"intake\",\n    \"research\"\n  ],\n  \"accepted_decisions\": [\n    \"preserve source identity\"\n  ],\n  \"source_hash\": \"frozen-source\"\n}\n",
  "user-owned-dirt.txt": "local notes — do not overwrite\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"ship\",\n  \"case_id\": \"ship-resume\",\n  \"case_type\": \"resume\",\n  \"state\": \"A partial session exists with accepted decisions; source identity must be revalidated before continuing.\"\n}\n"
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
printf '%s\n' 'ship resume change' >> release.txt
git add release.txt
git commit -qm "fixture release change"
printf '%s\n' 'user continuation' >> user-owned-dirt.txt
node "$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js" seed ship "$(pwd)"

