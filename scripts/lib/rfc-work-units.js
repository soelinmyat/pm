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
    },
    status: "pending",
  }));
  return validateWorkUnits(units);
}

module.exports = { rfcIssueId, rfcIssuesToDevWorkUnits };
