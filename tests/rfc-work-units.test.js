"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateRfcSidecar } = require("../scripts/rfc-sidecar-check");
const { rfcIssuesToDevWorkUnits } = require("../scripts/lib/rfc-work-units");

function executableSidecar() {
  return {
    schema_version: 3,
    slug: "multi-issue",
    title: "Multi-issue RFC",
    size: "L",
    design_context: {
      design_requirements: ["Keep the primary action visually dominant."],
      prototype: {
        path: "backlog/wireframes/multi-issue.html",
        sha256: `sha256:${"b".repeat(64)}`,
      },
      critical_states: ["loading", "empty", "error", "success"],
      visual_invariants: ["Navigation remains visible at narrow widths."],
    },
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
        design_context: sidecar.design_context,
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
        design_context: sidecar.design_context,
      },
      status: "pending",
    },
  ]);
});

test("RFC design context is closed, source-bound, and required to remain useful", () => {
  const source = executableSidecar();
  const malformed = structuredClone(source);
  malformed.design_context.prototype.sha256 = "unbound";
  assert.match(
    validateRfcSidecar(malformed)
      .issues.map((item) => item.message)
      .join("\n"),
    /prototype.*sha256/i
  );

  const empty = structuredClone(source);
  empty.design_context.visual_invariants = [];
  assert.match(
    validateRfcSidecar(empty)
      .issues.map((item) => item.message)
      .join("\n"),
    /visual_invariants.*non-empty/i
  );

  for (const unsafePath of [
    "https://example.com/prototype",
    "./prototype.html",
    "ui\\prototype.html",
  ]) {
    const unsafe = structuredClone(source);
    unsafe.design_context.prototype.path = unsafePath;
    assert.match(
      validateRfcSidecar(unsafe)
        .issues.map((item) => item.message)
        .join("\n"),
      /normalized repo-relative file/i
    );
  }
});

test("RFC validation binds design context to intake and prototype repository bytes", () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pm-rfc-design-context-"));
  try {
    const prototypePath = "backlog/wireframes/multi-issue.html";
    const absolutePrototype = path.join(repoRoot, prototypePath);
    fs.mkdirSync(path.dirname(absolutePrototype), { recursive: true });
    fs.writeFileSync(absolutePrototype, "<main>approved prototype</main>\n");
    const sidecar = executableSidecar();
    sidecar.design_context.prototype.sha256 = `sha256:${crypto
      .createHash("sha256")
      .update(fs.readFileSync(absolutePrototype))
      .digest("hex")}`;
    const expectedDesignContext = structuredClone(sidecar.design_context);

    assert.equal(
      validateRfcSidecar(sidecar, "rfc.json", { repoRoot, expectedDesignContext }).ok,
      true
    );

    const substituted = structuredClone(sidecar);
    substituted.design_context.visual_invariants = ["A weaker reconstructed invariant."];
    assert.match(
      validateRfcSidecar(substituted, "rfc.json", { repoRoot, expectedDesignContext })
        .issues.map((item) => item.message)
        .join("\n"),
      /design_context.*approved proposal/i
    );

    fs.writeFileSync(absolutePrototype, "<main>drifted prototype</main>\n");
    assert.match(
      validateRfcSidecar(sidecar, "rfc.json", { repoRoot, expectedDesignContext })
        .issues.map((item) => item.message)
        .join("\n"),
      /prototype.*sha256.*does not match repository bytes/i
    );
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("legacy RFC schema-v2 sidecars remain readable but are not auto-routed", () => {
  const legacy = {
    ...executableSidecar(),
    schema_version: 2,
    issues: [{ num: 1, title: "Legacy", size: "M", test_hooks: [] }],
  };
  delete legacy.design_context;
  assert.equal(validateRfcSidecar(legacy).ok, true);
  assert.throws(() => rfcIssuesToDevWorkUnits(legacy), /schema-v3/);
});
