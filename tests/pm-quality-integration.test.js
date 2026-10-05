"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { applyRoutes } = require("../scripts/insight-routing");
const { writeMarkdown, loadMarkdown } = require("../scripts/kb-utils");

test("linking a source retains the relevant later claim and prior analyst counterevidence", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-quality-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evidencePath = "evidence/research/navigation.md";
  const insightPath = "insights/product/navigation.md";
  const relevant = "Supervisors cannot find requests from Team.";
  writeMarkdown(
    path.join(root, evidencePath),
    {
      type: "evidence",
      evidence_type: "research",
      topic: "Team",
      source_origin: "internal",
      created: "2026-10-05",
      updated: "2026-10-05",
      sources: [],
      cited_by: [],
    },
    `# Team\n\n## Findings\n\n1. Weekly CSV imports already work.\n2. ${relevant}\n3. Administrators find the destination easily; broader prevalence is unknown.\n`
  );
  const prior =
    "The prior study found no problem for administrators. Test supervisors before generalizing.";
  writeMarkdown(
    path.join(root, insightPath),
    {
      type: "insight",
      domain: "product",
      topic: "Navigation",
      last_updated: "2026-10-05",
      status: "active",
      confidence: "medium",
      sources: [],
    },
    `# Navigation\n\n## Synthesis\n\n${prior}\n`
  );
  applyRoutes(
    root,
    {
      routes: [
        {
          mode: "existing",
          evidencePath,
          insightPath,
          description: "Request discoverability",
          selected_findings: [relevant],
        },
      ],
    },
    { now: "2026-10-05" }
  );
  const after = loadMarkdown(path.join(root, insightPath));
  assert.ok(after.body.includes(relevant), "later relevant source finding must remain visible");
  assert.ok(
    after.body.includes(prior),
    "earlier analyst judgment must not be replaced by a file summary"
  );
  assert.match(after.body, /broader prevalence is unknown/);
  assert.doesNotMatch(after.body, /support this topic from multiple angles/);
});
