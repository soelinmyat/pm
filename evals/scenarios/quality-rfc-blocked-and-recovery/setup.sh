#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:rfc\nCase: blocked-and-recovery\nState: A required dependency is unavailable; verified facts, assumptions, and a recovery test must remain distinct.\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"rfc-blocked-and-recovery\",\n  \"frozen\": true\n}\n",
  "pm/backlog/export-v2.md": "---\nid: export-v2\nstatus: proposed\n---\n# Multi-surface export\n\nCustomers need CSV delivery across web and API surfaces.\n",
  "src/export-service.js": "exports.runExport = async function runExport() { return []; };\n",
  "docs/architecture.md": "# Architecture\n\nExports run in the API worker and persist jobs in SQLite.\n",
  "dependency-contract.md": "# Dependency\n\nStatus: unavailable\nRequired validation: obtain the signed contract and rerun contract-check.js.\n",
  "contract-check.js": "process.exitCode = 2; console.error('dependency unavailable');\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"rfc\",\n  \"case_id\": \"rfc-blocked-and-recovery\",\n  \"case_type\": \"blocked-and-recovery\",\n  \"state\": \"A required dependency is unavailable; verified facts, assumptions, and a recovery test must remain distinct.\"\n}\n"
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
printf '%s\n' 'rfc blocked-and-recovery change' >> docs/architecture.md
git add docs/architecture.md
git commit -qm "fixture feature change"

node "$PM_PLUGIN_ROOT/scripts/evals/quality-repo-state.js" snapshot "$(pwd)"

