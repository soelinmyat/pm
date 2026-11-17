"use strict";

const { findingId, reconciliationId } = require("../design-critique-check");
const { findingEnums } = require("./design-review-schema");

// Start with every observed finding. Give the owning workflow an inventory to
// decide across; don't silently group disagreements or choose a disposition.
function seedDesignReconciliation(reviews) {
  const inventory = [];
  const seen = new Set();
  for (const round of reviews.rounds) {
    for (const review of round.reviews) {
      const enums = findingEnums(review.perspective);
      for (const finding of review.result.findings) {
        const key = `${review.review_id}:${finding.id}`;
        if (
          !finding.id ||
          seen.has(key) ||
          Object.entries(enums).some(([field, values]) => !values.includes(finding[field]))
        )
          throw new Error("reconciliation requires unique validated reviewer findings");
        seen.add(key);
        const finalFinding = {
          subject_id: finding.subject_id,
          region: finding.region,
          rule: finding.rule,
          evidence_ids: [...finding.evidence_ids],
          priority: finding.priority,
          owner: finding.owner,
          status: "open",
          summary: finding.summary,
          remediation: finding.remediation,
        };
        finalFinding.id = findingId(finalFinding);
        const reconciliation = {
          subject_id: finding.subject_id,
          region: finding.region,
          rule: finding.rule,
          coverage_ids: [...finding.coverage_ids],
          source_finding_refs: [{ review_id: review.review_id, finding_id: finding.id }],
          agreement: "single-source",
          disposition: "accepted",
          final_finding_id: finalFinding.id,
          decision_evidence_ids: [],
          rationale: "Retain the reviewer finding and its evidence for disposition.",
        };
        reconciliation.id = reconciliationId(reconciliation);
        inventory.push({ finding: finalFinding, reconciliation });
      }
    }
  }
  return inventory;
}

module.exports = { seedDesignReconciliation };
