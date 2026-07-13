#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:dev\nCase: resume\nState: A partial session exists with accepted decisions; source identity must be revalidated before continuing.\nResume revalidation command: node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" revalidate dev \"$(pwd)\"\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"dev-resume\",\n  \"frozen\": true\n}\n",
  "change-request.md": "# Approved change\n\nValidate source identity before resuming and surface a recovery error.\n",
  "docs/workflow.md": "# Workflow\n\nResume a saved session and continue.\n",
  "src/resume.js": "exports.resume = (session) => session;\n",
  "tests/resume.test.js": "const assert = require('node:assert'); const {resume}=require('../src/resume'); assert.equal(resume('ok'),'ok');\n",
  "package.json": "{\n  \"scripts\": {\n    \"test\": \"node tests/resume.test.js\"\n  }\n}\n",
  ".pm/quality/resume-session.json": "{\n  \"workflow\": \"dev\",\n  \"completed\": [\n    \"intake\",\n    \"research\"\n  ],\n  \"accepted_decisions\": [\n    \"preserve source identity\"\n  ],\n  \"source_hash\": \"frozen-source\"\n}\n",
  "user-owned-dirt.txt": "local notes — do not overwrite\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"dev\",\n  \"case_id\": \"dev-resume\",\n  \"case_type\": \"resume\",\n  \"state\": \"A partial session exists with accepted decisions; source identity must be revalidated before continuing.\"\n}\n"
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
printf '%s\n' 'dev resume change' >> docs/workflow.md
git add docs/workflow.md
git commit -qm "fixture feature change"
printf '%s\n' 'user continuation' >> user-owned-dirt.txt
node "$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js" seed dev "$(pwd)"
