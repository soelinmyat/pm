"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadPhaseStep } = require("../scripts/step-loader");
const { buildGroomPrompt } = require("../scripts/groom-prompt");
const { decisionId, validateDecisionBrief } = require("../scripts/lib/product-reasoning-schema");

// Exercise the same phase loader and packet boundary used by Groom's runner.
test("Groom's active phase respects an override without carrying future instructions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-astra-workflow-"));
  try {
    const override = path.join(root, ".pm/workflows/groom");
    fs.mkdirSync(override, { recursive: true });
    fs.writeFileSync(
      path.join(override, "06-draft.md"),
      "---\nname: Draft\norder: 6\nphase: draft\nrequires: [references/local-draft.md]\n---\nACTIVE_DRAFT_MARKER\n"
    );
    fs.writeFileSync(
      path.join(override, "09-approval.md"),
      "---\nname: Approval\norder: 9\nphase: approval\n---\nFUTURE_APPROVAL_MARKER\n"
    );
    const step = loadPhaseStep("groom", "draft", root, path.resolve(__dirname, ".."));
    assert.equal(step.source, "user");
    assert.deepEqual(step.requires, ["references/local-draft.md"]);
    const prompt = buildGroomPrompt({
      objective: "Draft a proposal",
      decision_context: "Adoption pending",
      phase: step.body,
      repository: root,
      inputs: step.requires,
      proposal_contract: "proposal-v1",
      questions: ["Is the acceptance observable?"],
      constraints: ["Do not claim approval"],
      authority: { local_writes: true, approval: false },
      required_evidence: ["proposal"],
      result_contract: "groom-phase-result-v1",
    });
    assert.match(prompt, /ACTIVE_DRAFT_MARKER/);
    assert.match(prompt, /references\/local-draft.md/);
    assert.doesNotMatch(prompt, /FUTURE_APPROVAL_MARKER/);
    assert.match(prompt, /approval: false/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an unadopted Think recommendation remains schema-valid without inventing confirmation", () => {
  const brief = {
    schema_version: 1,
    document_type: "decision-brief",
    decision_id: decisionId("think", "import-draft"),
    kind: "think",
    slug: "import-draft",
    title: "Import recommendation",
    problem: "Teams repeatedly copy customer records between systems.",
    evidence_refs: [],
    alternatives: [
      { id: "csv", title: "CSV reminder", tradeoff: "Low maintenance but import remains manual." },
      {
        id: "api",
        title: "API integration",
        tradeoff: "Automatic transfer requires provider maintenance.",
      },
    ],
    decision: {
      status: "exploring",
      choice: null,
      rationale: "Recommend CSV pending user adoption and evidence about import frequency.",
    },
    confidence: {
      level: "low",
      basis: ["No observed import frequency yet", "Provider maintenance cost remains unknown"],
    },
    non_goals: ["Automatic sync"],
    next_trigger: {
      lane: "research",
      condition: "Measure manual import frequency before committing scope",
      target: null,
    },
    promotion: { status: "not-offered", target_kind: null, target_ref: null, confirmed_at: null },
    source_artifacts: [{ path: "thinking/import-draft.md", sha256: `sha256:${"a".repeat(64)}` }],
    created_at: "2026-09-06T00:00:00Z",
    updated_at: "2026-09-06T00:00:00Z",
  };
  assert.deepEqual(validateDecisionBrief(brief), []);
  assert.match(
    validateDecisionBrief({ ...brief, decision: { ...brief.decision, status: "confirmed" } }).join(
      "\n"
    ),
    /requires a choice/
  );
  assert.match(
    validateDecisionBrief({ ...brief, promotion: { ...brief.promotion, status: "promoted" } }).join(
      "\n"
    ),
    /promotion|promoted/
  );
});
