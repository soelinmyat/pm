#!/usr/bin/env bash
set -euo pipefail

node - <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const files = {
  "case-state.md": "# Quality case state\n\nWorkflow: pm:groom\nCase: resume\nState: A partial session exists with accepted decisions; source identity must be revalidated before continuing.\nResume revalidation command: node \"$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js\" revalidate groom \"$(pwd)\"\n",
  ".pm/quality/input-lock.json": "{\n  \"case_id\": \"groom-resume\",\n  \"frozen\": true\n}\n",
  "pm/backlog/csv-export.md": "---\nid: csv-export\nstatus: captured\n---\n# CSV export\n\nEvidence: ACME and Northstar require scheduled CSV delivery.\n",
  "pm/evidence/export-signals.md": "# Evidence\n\nACME: scheduled finance export.\nNorthstar: permission-scoped delivery.\n",
  ".pm/quality/resume-session.json": "{\n  \"workflow\": \"groom\",\n  \"completed\": [\n    \"intake\",\n    \"research\"\n  ],\n  \"accepted_decisions\": [\n    \"preserve source identity\"\n  ],\n  \"source_hash\": \"frozen-source\"\n}\n",
  "user-owned-dirt.txt": "local notes — do not overwrite\n",
  ".pm/groom-sessions/quality-resume.md": "---\ntopic: \"CSV export\"\nruntime: codex\ngroom_tier: quick\nphase: research\nstarted: 2026-07-12\nupdated: 2026-07-12\nrun_id: groom_quality_resume\nstarted_at: 2026-07-12T00:00:00Z\nphase_started_at: 2026-07-12T00:01:00Z\ncompleted_at: null\nlinear_id: null\ncodebase_available: true\ncodebase_context: \"export fixture\"\nproduct_features_available: false\nproduct_feature_count: 0\nkb_maturity: developing\nkb_maturity_tier: quick\nkb_signals: { strategy: false, insights: true, competitors: false }\nresearch_location: pm/evidence/export-signals.md\nresearch_note: \"Two customer signals confirmed\"\nstale_research: []\nretro_failed: null\n---\n\nAccepted decision: preserve permission-scoped CSV delivery.\n",
  ".pm/quality/case-state.json": "{\n  \"workflow\": \"groom\",\n  \"case_id\": \"groom-resume\",\n  \"case_type\": \"resume\",\n  \"state\": \"A partial session exists with accepted decisions; source identity must be revalidated before continuing.\"\n}\n"
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
printf '%s\n' 'groom resume change' >> pm/backlog/csv-export.md
git add pm/backlog/csv-export.md
git commit -qm "fixture feature change"
printf '%s\n' 'user continuation' >> user-owned-dirt.txt
node "$PM_PLUGIN_ROOT/scripts/evals/quality-resume.js" seed groom "$(pwd)"
