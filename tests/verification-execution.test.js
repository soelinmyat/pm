"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runVerification } = require("../scripts/verification-execution");
const { stableObjectHmac } = require("../scripts/lib/stable-authentication");

const nativeReport = process.report.getReport.bind(process.report);
function fixture(t) {
  // Controlled observer for cross-platform contract/invalidation unit tests.
  // The Linux CLI integration below uses the actual, unmodified runtime report.
  process.report.getReport = () => ({ ...nativeReport(), sharedObjects: [] });
  t.after(() => {
    process.report.getReport = nativeReport;
  });
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pm-execution-"));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "workspace"),
    store = path.join(base, "evidence");
  fs.mkdirSync(root);
  fs.mkdirSync(store);
  fs.writeFileSync(
    path.join(root, "suite.js"),
    'require("node:assert/strict").equal(process.env.FACT, "expected"); console.log("observed successful suite");'
  );
  const key = "private-receipt-key-".repeat(4);
  const contract = {
    schema_version: 1,
    kind: "verification-execution-contract",
    root,
    executable: process.execPath,
    args: ["suite.js"],
    environment: { FACT: "expected" },
    input_contract: "deterministic-workspace-only-v1",
    timeout_ms: 10000,
    max_age_ms: 60000,
  };
  const sign = () => (contract.authentication = stableObjectHmac(contract, key));
  sign();
  const run = (options = {}) => runVerification(contract, { key, store, ...options });
  const receipt = (result) => JSON.parse(fs.readFileSync(path.join(store, result.receipt)));
  return { root, store, contract, key, sign, run, receipt };
}

test("owning execution captures real output and authenticates reuse; final checks execute", (t) => {
  const f = fixture(t),
    first = f.run();
  assert.equal(first.status, "passed");
  assert.equal(first.reused, false);
  assert.equal(first.reusable, true);
  assert.match(f.receipt(first).stdout, /observed successful suite/);
  const second = f.run();
  assert.equal(second.reused, true);
  assert.equal(f.run({ stage: "final" }).reused, false);
});

for (const mutation of [
  "source",
  "ignored",
  "dependencies",
  "environment",
  "command",
  "missing output",
  "forged receipt",
  "wrong key",
  "expired",
]) {
  test(`successful receipt invalidates on ${mutation}`, (t) => {
    const f = fixture(t);
    f.run();
    const hit = f.run();
    assert.equal(hit.reused, true);
    const cached = path.join(f.store, hit.receipt);
    if (mutation === "source")
      fs.appendFileSync(path.join(f.root, "suite.js"), '\nconsole.log("new source");');
    if (mutation === "ignored") {
      fs.writeFileSync(path.join(f.root, ".gitignore"), "generated\n");
      fs.writeFileSync(path.join(f.root, "generated"), "new ignored input");
    }
    if (mutation === "dependencies") {
      fs.mkdirSync(path.join(f.root, "node_modules"));
      fs.writeFileSync(
        path.join(f.root, "node_modules", "installed.js"),
        "actual dependency bytes"
      );
    }
    if (mutation === "environment") {
      f.contract.environment.EXTRA = "changed";
      f.sign();
    }
    if (mutation === "command") {
      f.contract.args.push("changed");
      f.sign();
    }
    if (mutation === "missing output") fs.unlinkSync(cached);
    if (mutation === "forged receipt") {
      const receipt = f.receipt(hit);
      receipt.stdout = "forged passing output";
      fs.writeFileSync(cached, JSON.stringify(receipt));
    }
    if (mutation === "wrong key") {
      const receipt = f.receipt(hit);
      receipt.authentication = stableObjectHmac(receipt, "another-secret-".repeat(4));
      fs.writeFileSync(cached, JSON.stringify(receipt));
    }
    if (mutation === "expired") {
      const receipt = f.receipt(hit);
      receipt.finished_at = "2000-01-01T00:00:00.000Z";
      receipt.authentication = stableObjectHmac(receipt, f.key);
      fs.writeFileSync(cached, JSON.stringify(receipt));
    }
    const next = f.run();
    assert.equal(next.status, "passed");
    assert.equal(next.reused, false);
  });
}

test("changed installed dependency bytes invalidate an existing dependency inventory", (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "node_modules"));
  const dep = path.join(f.root, "node_modules", "dependency.js");
  fs.writeFileSync(dep, "version one");
  f.run();
  assert.equal(f.run().reused, true);
  fs.writeFileSync(dep, "version two");
  assert.equal(f.run().reused, false);
});

test("failed, timeout and truncated executions never mint reusable success", (t) => {
  for (const body of [
    "process.exit(1)",
    "while (true) {}",
    'console.log("x".repeat(2*1024*1024))',
  ]) {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, "suite.js"), body);
    f.contract.timeout_ms = 100;
    f.sign();
    for (let i = 0; i < 2; i++) {
      const result = f.run();
      assert.equal(result.status, "failed");
      assert.equal(result.reused, false);
      assert.equal(result.reusable, false);
    }
  }
});

test("before/after drift and unknown external symlinks execute without reusable certification", (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.root, "suite.js"),
    'require("node:fs").writeFileSync("generated", String(Date.now()));'
  );
  assert.equal(f.run().reusable, false);
  fs.writeFileSync(path.join(f.root, "suite.js"), 'console.log("pass")');
  fs.symlinkSync(
    f.store,
    path.join(f.root, "external"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const result = f.run();
  assert.equal(result.status, "passed");
  assert.equal(result.reusable, false);
  assert.equal(result.diagnostic, "unknown-inputs");
});

test("invalid or unknown contracts and nested stores fail before command execution", (t) => {
  const f = fixture(t);
  assert.throws(() => f.run({ key: "short" }), /authenticated/);
  f.contract.external_service = "unbound database";
  f.sign();
  assert.throws(() => f.run(), /authenticated/);
  delete f.contract.external_service;
  f.sign();
  assert.throws(() => f.run({ store: f.root }), /separate/);
  f.contract.environment.PM_VERIFICATION_RECEIPT_KEY = f.key;
  f.sign();
  assert.throws(() => f.run(), /invalid/);
});

test(
  "real Linux CLI executions authenticate and reuse actual retained output",
  { skip: process.platform !== "linux" },
  (t) => {
    const f = fixture(t);
    process.report.getReport = nativeReport;
    const contractPath = path.join(f.store, "contract.json");
    fs.writeFileSync(contractPath, JSON.stringify(f.contract));
    const cli = path.resolve(__dirname, "../scripts/verification-execution.js");
    const run = () =>
      JSON.parse(
        require("node:child_process").execFileSync(
          process.execPath,
          [cli, "--contract", contractPath, "--store", f.store],
          { env: { PM_VERIFICATION_RECEIPT_KEY: f.key }, encoding: "utf8" }
        )
      );
    assert.equal(run().reused, false);
    assert.equal(run().reused, true);
  }
);
