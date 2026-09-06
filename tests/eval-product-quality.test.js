"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  PRODUCT_WORKFLOWS,
  productFixture,
  validateProductReceipt,
  checkProduct,
} = require("../scripts/evals/product-quality.js");
const { buildScorecard } = require("../scripts/evals/quality.js");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function fixture(type = "happy-path") {
  const value = productFixture("research", type, `research-${type}`, "frozen");
  const bytes = value.files["product-evidence.json"];
  const packet = JSON.parse(bytes);
  return {
    value,
    bytes,
    packet,
    receipt: {
      schema_version: 1,
      evidence_sha256: hash(bytes),
      independent_demand_origins: 2,
      approval: "pending",
      claims: [
        {
          claim: "A needs permission-scoped CSV.",
          source_id: "interview-a",
          excerpt: "Finance team A needs permission-scoped CSV exports before scheduling.",
        },
      ],
    },
  };
}
test("product cases cover all lifecycle states and calibrated concise controls", () => {
  const suite = require("../evals/quality/suite.json");
  for (const workflow of PRODUCT_WORKFLOWS) {
    assert.equal(suite.workflows.find((item) => item.id === workflow).cases.length, 7);
    const generated = productFixture(workflow, "happy-path", `${workflow}-happy-path`, "ready");
    assert.match(
      generated.files["concise-control.md"],
      /two interviews cannot establish market demand/
    );
    assert.match(generated.files["product-output-contract.md"], /judges assess entailment/i);
  }
});
test("source receipts accept concise correct evidence and reject derivative-count inflation, invented excerpts and approval", () => {
  const { receipt, packet, bytes } = fixture();
  assert.equal(validateProductReceipt(receipt, packet, bytes).ok, true);
  for (const mutation of [
    { independent_demand_origins: 4 },
    { evidence_sha256: "forged" },
    { approval: "adopted" },
    { claims: [{ claim: "73.2% want CSV", source_id: "interview-a", excerpt: "73.2% of buyers" }] },
    { claims: [] },
    { claims: {} },
    { claims: [null] },
  ])
    assert.equal(validateProductReceipt({ ...receipt, ...mutation }, packet, bytes).ok, false);
});
test("resume gate detects changed evidence and overwritten user state", () => {
  const { value, receipt } = fixture("resume");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-product-eval-"));
  try {
    for (const [name, bytes] of Object.entries(value.files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(root, "product-evidence-receipt.json"), JSON.stringify(receipt));
    fs.writeFileSync(path.join(root, "quality-output.md"), "Pilot with A; evidence is mixed.");
    assert.equal(checkProduct(root, root, "resume").ok, true);
    fs.writeFileSync(path.join(root, "user-owned-dirt.txt"), "overwritten");
    assert.throws(() => checkProduct(root, root, "resume"), /user notes changed/);
    fs.writeFileSync(path.join(root, "product-evidence.json"), "{}");
    assert.throws(() => checkProduct(root, root, "resume"), /frozen evidence/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("a fluent product artifact cannot turn a behavioral failure into a quality winner", () => {
  const candidates = [
    { behavioral: { status: "fail" }, runtime: { duration_ms: 12 } },
    { behavioral: { status: "pass" }, runtime: { duration_ms: 10 } },
  ];
  const score = buildScorecard({
    candidates,
    aggregate: { profiles: { astra: { mean: 5, variance: { claimable: true } } } },
  });
  assert.equal(score.overall_status, "behavioral-failure");
  assert.equal(score.quality_winner, null);
  assert.equal(score.efficiency.elapsed_ms_per_behavioral_success.value, 22);
});
test("generated product helper executes actual artifact checks and emits a failure for a forged receipt", () => {
  const { execFileSync } = require("node:child_process");
  const { value, receipt } = fixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-product-helper-"));
  const pluginRoot = path.resolve(__dirname, "..");
  try {
    for (const [name, bytes] of Object.entries(value.files)) {
      const target = path.join(root, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    }
    fs.writeFileSync(path.join(root, "quality-output.md"), "Pilot with A; evidence is mixed.");
    fs.writeFileSync(path.join(root, "product-evidence-receipt.json"), JSON.stringify(receipt));
    const run = () =>
      execFileSync(
        "bash",
        [
          "-c",
          'source "$PM_PLUGIN_ROOT/scripts/evals/prelude.sh"; product-evidence-valid happy-path',
        ],
        {
          cwd: root,
          env: { ...process.env, PM_PLUGIN_ROOT: pluginRoot, PM_EVAL_ARTIFACTS_DIR: root },
          encoding: "utf8",
        }
      );
    const status = () =>
      JSON.parse(Buffer.from(run().trim().split("::").at(-1), "base64url").toString("utf8")).status;
    assert.equal(status(), "pass");
    fs.writeFileSync(
      path.join(root, "product-evidence-receipt.json"),
      JSON.stringify({ ...receipt, independent_demand_origins: 3 })
    );
    assert.equal(status(), "fail");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
