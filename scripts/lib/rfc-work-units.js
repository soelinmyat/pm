"use strict";

const { validateWorkUnits } = require("./dev-work-units");

function rfcIssueId(num) {
  if (!Number.isInteger(num) || num <= 0) {
    throw new TypeError("RFC issue num must be a positive integer");
  }
  return `rfc-${num}`;
}

function rfcIssuesToDevWorkUnits(sidecar) {
  if (sidecar?.schema_version !== 3) {
    throw new Error("executable Dev work units require an RFC schema-v3 sidecar");
  }
  const designContext = sidecar.design_context
    ? {
        design_requirements: [...sidecar.design_context.design_requirements],
        prototype: sidecar.design_context.prototype
          ? { ...sidecar.design_context.prototype }
          : null,
        critical_states: [...sidecar.design_context.critical_states],
        visual_invariants: [...sidecar.design_context.visual_invariants],
      }
    : null;
  const units = sidecar.issues.map((item) => ({
    id: rfcIssueId(item.num),
    title: item.title,
    depends_on: item.depends_on.map(rfcIssueId),
    owns: [...item.owns],
    contract: {
      acceptance_criteria: [...item.acceptance_criteria],
      approach: item.approach,
      verification_commands: [...item.verification_commands],
      test_hooks: [...item.test_hooks],
      ...(designContext ? { design_context: structuredClone(designContext) } : {}),
    },
    status: "pending",
  }));
  return validateWorkUnits(units);
}

module.exports = { rfcIssueId, rfcIssuesToDevWorkUnits };
