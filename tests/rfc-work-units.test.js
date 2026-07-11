"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRfcSidecar } = require("../scripts/rfc-sidecar-check");
const { rfcIssuesToDevWorkUnits } = require("../scripts/lib/rfc-work-units");

function executableSidecar() {
  return {
    schema_version: 3,
    slug: "multi-issue",
    title: "Multi-issue RFC",
    size: "L",
    issues: [
      {
        num: 1,
        title: "Shared contract",
        size: "M",
        depends_on: [],
        owns: ["scripts/lib/shared.js"],
        acceptance_criteria: ["Shared contract is stable"],
        approach: "Add the shared contract first.",
        verification_commands: ["node --test tests/shared.test.js"],
        test_hooks: ["Unit -> shared contract"],
      },
      {
        num: 2,
        title: "Consumer",
        size: "M",
        depends_on: [1],
        owns: ["scripts/consumer.js"],
        acceptance_criteria: ["Consumer uses the contract"],
        approach: "Wire the consumer after the contract lands.",
        verification_commands: ["node --test tests/consumer.test.js"],
        test_hooks: ["Integration -> dependency ordering"],
      },
    ],
    test_strategy: {
      test_levels: "Unit and integration",
      new_infrastructure: "None",
      regression_surface: "Shared contract consumers",
      verification_commands: "node --test",
      open_questions: "None",
    },
  };
}

test("RFC schema-v3 issues convert to a valid Dev DAG with canonical IDs", () => {
  const sidecar = executableSidecar();
  assert.equal(validateRfcSidecar(sidecar).ok, true);
  assert.deepEqual(rfcIssuesToDevWorkUnits(sidecar), [
    {
      id: "rfc-1",
      title: "Shared contract",
      depends_on: [],
      owns: ["scripts/lib/shared.js"],
      contract: {
        acceptance_criteria: ["Shared contract is stable"],
        approach: "Add the shared contract first.",
        verification_commands: ["node --test tests/shared.test.js"],
        test_hooks: ["Unit -> shared contract"],
      },
      status: "pending",
    },
    {
      id: "rfc-2",
      title: "Consumer",
      depends_on: ["rfc-1"],
      owns: ["scripts/consumer.js"],
      contract: {
        acceptance_criteria: ["Consumer uses the contract"],
        approach: "Wire the consumer after the contract lands.",
        verification_commands: ["node --test tests/consumer.test.js"],
        test_hooks: ["Integration -> dependency ordering"],
      },
      status: "pending",
    },
  ]);
});

test("legacy RFC schema-v2 sidecars remain readable but are not auto-routed", () => {
  const legacy = {
    ...executableSidecar(),
    schema_version: 2,
    issues: [{ num: 1, title: "Legacy", size: "M", test_hooks: [] }],
  };
  assert.equal(validateRfcSidecar(legacy).ok, true);
  assert.throws(() => rfcIssuesToDevWorkUnits(legacy), /schema-v3/);
});
