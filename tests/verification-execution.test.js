"use strict";
const test = process.platform === "win32" ? require("node:test").skip : require("node:test");
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

test("owning execution captures real output and authenticates reuse; final checks execute", async (t) => {
  const f = fixture(t),
    first = await f.run();
  assert.equal(first.status, "passed");
  assert.equal(first.reused, false);
  assert.equal(first.reusable, true);
  assert.match(f.receipt(first).stdout, /observed successful suite/);
  const second = await f.run();
  assert.equal(second.reused, true);
  assert.equal((await f.run({ stage: "final" })).reused, false);
});

test("parent coverage cannot mutate the authenticated contract or enter the child environment", async (t) => {
  const f = fixture(t);
  const priorCoverage = process.env.NODE_V8_COVERAGE;
  t.after(() => {
    if (priorCoverage === undefined) delete process.env.NODE_V8_COVERAGE;
    else process.env.NODE_V8_COVERAGE = priorCoverage;
  });
  process.env.NODE_V8_COVERAGE = path.join(f.store, "undeclared-parent-coverage");
  fs.appendFileSync(
    path.join(f.root, "suite.js"),
    '\nrequire("node:assert/strict").equal(process.env.NODE_V8_COVERAGE, undefined);'
  );
  const original = structuredClone(f.contract);
  const first = await f.run();
  assert.equal(first.status, "passed");
  assert.deepEqual(f.contract, original);
  assert.equal((await f.run()).reused, true);
  process.env.NODE_V8_COVERAGE = path.join(f.store, "changed-parent-coverage");
  assert.equal((await f.run()).reused, false);
  assert.deepEqual(f.contract, original);
});

for (const mutation of [
  "source",
  "ignored",
  "dependencies",
  "environment",
  "command",
  "directory metadata",
  "missing output",
  "forged receipt",
  "wrong key",
  "expired",
]) {
  test(`successful receipt invalidates on ${mutation}`, async (t) => {
    const f = fixture(t);
    await f.run();
    const hit = await f.run();
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
    if (mutation === "directory metadata") {
      const stat = fs.statSync(f.root);
      fs.utimesSync(f.root, stat.atime, new Date(stat.mtimeMs + 2000));
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
    const next = await f.run();
    assert.equal(next.status, "passed");
    assert.equal(next.reused, false);
  });
}

test("changed installed dependency bytes invalidate an existing dependency inventory", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, "node_modules"));
  const dep = path.join(f.root, "node_modules", "dependency.js");
  fs.writeFileSync(dep, "version one");
  await f.run();
  assert.equal((await f.run()).reused, true);
  fs.writeFileSync(dep, "version two");
  assert.equal((await f.run()).reused, false);
});

test("failed, timeout and truncated executions never mint reusable success", async (t) => {
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
      const result = await f.run();
      assert.equal(result.status, "failed");
      assert.equal(result.reused, false);
      assert.equal(result.reusable, false);
    }
  }
});

test("before/after drift and unknown external symlinks execute without reusable certification", async (t) => {
  const f = fixture(t);
  fs.writeFileSync(
    path.join(f.root, "suite.js"),
    'require("node:fs").writeFileSync("generated", String(Date.now()));'
  );
  assert.equal((await f.run()).reusable, false);
  fs.writeFileSync(path.join(f.root, "suite.js"), 'console.log("pass")');
  fs.symlinkSync(
    f.store,
    path.join(f.root, "external"),
    process.platform === "win32" ? "junction" : "dir"
  );
  const result = await f.run();
  assert.equal(result.status, "passed");
  assert.equal(result.reusable, false);
  assert.equal(result.diagnostic, "unknown-inputs");
});

test("invalid or unknown contracts and nested stores fail before command execution", async (t) => {
  const f = fixture(t);
  await assert.rejects(() => f.run({ key: "short" }), /authenticated/);
  f.contract.external_service = "unbound database";
  f.sign();
  await assert.rejects(() => f.run(), /authenticated/);
  delete f.contract.external_service;
  f.sign();
  await assert.rejects(() => f.run({ store: f.root }), /separate/);
  f.contract.environment.PM_VERIFICATION_RECEIPT_KEY = f.key;
  f.sign();
  await assert.rejects(() => f.run(), /invalid/);
});

test(
  "real Linux CLI executions authenticate and reuse actual retained output",
  { skip: process.platform !== "linux" },
  async (t) => {
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
    const first = run();
    assert.equal(first.status, "passed", JSON.stringify(first));
    assert.equal(first.reused, false, JSON.stringify(first));
    assert.equal(first.reusable, true, JSON.stringify(first));
    const second = run();
    assert.equal(second.reused, true, JSON.stringify(second));
  }
);

for (const descendants of [false, true]) {
  test(`timeout kills ${descendants ? "inherited-pipe descendants" : "a SIGTERM-ignoring suite"} and releases the store`, async (t) => {
    const f = fixture(t);
    const body = descendants
      ? `require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], {stdio:'inherit'}); process.exit(0);`
      : `process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000);`;
    fs.writeFileSync(path.join(f.root, "suite.js"), body);
    f.contract.timeout_ms = 500;
    f.sign();
    const start = Date.now();
    const result = await f.run();
    assert.ok(
      Date.now() - start < 5000,
      "timeout must be bounded even with ignored graceful signals"
    );
    assert.equal(result.status, "failed");
    assert.equal(result.reusable, false);
    assert.equal(result.diagnostic, "ETIMEDOUT");
    assert.match(f.receipt(result).stdout, /ready/);
    fs.writeFileSync(path.join(f.root, "suite.js"), 'console.log("next execution acquired store")');
    assert.equal((await f.run()).status, "passed");
  });
}

test("escaped detached descendants cannot keep failure settlement or the store locked", async (t) => {
  const f = fixture(t),
    pidFile = path.join(f.root, "escaped.pid");
  const cleanupProbe = () => {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8"));
      if (Number.isInteger(pid) && pid > 1)
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* Owned probe already exited. */
        }
    }
  };
  t.after(cleanupProbe);
  fs.writeFileSync(
    path.join(f.root, "suite.js"),
    `const cp=require('node:child_process');const child=cp.spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{detached:true,stdio:'inherit'});require('node:fs').writeFileSync('escaped.pid',String(child.pid));process.exit(0);`
  );
  f.contract.timeout_ms = 500;
  f.sign();
  const start = Date.now();
  let result;
  try {
    result = await f.run();
  } finally {
    cleanupProbe();
  }
  assert.ok(Date.now() - start < 5000);
  assert.equal(result.status, "failed");
  assert.equal(result.diagnostic, "ETIMEDOUT");
  assert.equal(result.reusable, false);
  fs.writeFileSync(
    path.join(f.root, "suite.js"),
    'console.log("store unlocked after escaped probe cleanup")'
  );
  assert.equal((await f.run()).status, "passed");
});

test("receipt identities include the process permission context", async (t) => {
  const f = fixture(t);
  await f.run();
  assert.equal((await f.run()).reused, true);
  const original = process.getuid;
  try {
    process.getuid = () => original() + 1;
    assert.equal((await f.run()).reused, false);
  } finally {
    process.getuid = original;
  }
});
