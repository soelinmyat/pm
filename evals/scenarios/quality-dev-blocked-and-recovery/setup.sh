#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:dev\nCase: blocked-and-recovery\nState: A required dependency is unavailable; verified facts, assumptions, and a recovery test must remain distinct.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"dev-blocked-and-recovery\",\n  \"frozen\": true\n}\n",
  "change-request.md": "# Approved change\n\nValidate source identity before resuming and surface a recovery error.\n",
  "docs/workflow.md": "# Workflow\n\nResume a saved session and continue.\n",
  "src/resume.js": "exports.resume = (session) => session;\n",
  "tests/resume.test.js": "const assert = require('node:assert'); const {resume}=require('../src/resume'); assert.equal(resume('ok'),'ok');\n",
  "package.json": "{\n  \"scripts\": {\n    \"test\": \"node tests/resume.test.js\"\n  }\n}\n",
  "dependency-contract.md": "# Dependency\n\nStatus: unavailable\nRequired validation: obtain the signed contract and rerun contract-check.js.\n",
  "contract-check.js": "process.exitCode = 2; console.error('dependency unavailable');\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"dev\",\n  \"case_id\": \"dev-blocked-and-recovery\",\n  \"case_type\": \"blocked-and-recovery\",\n  \"state\": \"A required dependency is unavailable; verified facts, assumptions, and a recovery test must remain distinct.\"\n}\n"
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
printf '%s\n' 'dev blocked-and-recovery change' >> docs/workflow.md
git add docs/workflow.md
git commit -qm "fixture feature change"

node "$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js" snapshot "$(pwd)"
