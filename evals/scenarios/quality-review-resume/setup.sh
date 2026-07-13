#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:review\nCase: resume\nState: A partial session exists with accepted decisions; source identity must be revalidated before continuing.\nResume revalidation command: node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" revalidate review \"$(pwd)\"\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"review-resume\",\n  \"frozen\": true\n}\n",
  "src/items.js": "exports.clear = (items) => { items.length = 0; return items; };\n",
  "tests/items.test.js": "const assert=require('node:assert'); const {clear}=require('../src/items'); assert.deepEqual(clear([1]),[]);\n",
  "review-intent.md": "# Intended behavior\n\nClear mutates the supplied list and returns it.\n",
  "package.json": "{\n  \"scripts\": {\n    \"test\": \"node tests/items.test.js\"\n  }\n}\n",
  ".pm/quality/resume-session.json": "{\n  \"workflow\": \"review\",\n  \"completed\": [\n    \"intake\",\n    \"research\"\n  ],\n  \"accepted_decisions\": [\n    \"preserve source identity\"\n  ],\n  \"source_hash\": \"frozen-source\"\n}\n",
  "user-owned-dirt.txt": "local notes — do not overwrite\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"review\",\n  \"case_id\": \"review-resume\",\n  \"case_type\": \"resume\",\n  \"state\": \"A partial session exists with accepted decisions; source identity must be revalidated before continuing.\"\n}\n"
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
node -e "const fs=require('fs');const p='src/items.js';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace('items.length = 0','items.length = 1'))"
git add src/items.js
git commit -qm "fixture feature change"
printf '%s\n' 'user continuation' >> user-owned-dirt.txt
node "$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js" seed review "$(pwd)"
