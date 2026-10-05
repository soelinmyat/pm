"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runEval } = require("../scripts/evals/run.js");
const { loadQualityCase } = require("../scripts/evals/quality.js");
const { hashTree } = require("../scripts/evals/stage.js");
const root = path.resolve(__dirname, "..");

test("functional composition comparison is staged without its judge-only visual answer", () => {
  const caseId = "design-critique-low-quality-schema-valid";
  const runId = "20261005T000004Z--quality-design-critique-low-quality-schema-valid--stub";
  const runDir = path.join(root, "eval-results/runs", runId);
  const guidance = JSON.parse(
    fs.readFileSync(path.join(root, "evals/quality/design-composition-judge-guidance.json"))
  );
  try {
    // Exercise staging only. A stub and source checks cannot establish visual judgment.
    runEval({
      rootDir: root,
      scenarioArg: "evals/scenarios/quality-design-critique-low-quality-schema-valid",
      agent: "stub",
      qualityCase: caseId,
      runId,
    });
    for (const variant of ["a", "b"]) {
      const name = `leave-composition-${variant}.html`;
      const staged = fs.readFileSync(path.join(runDir, "workdir/ui/design-critique", name), "utf8");
      assert.equal(
        staged,
        fs.readFileSync(path.join(root, "evals/quality/fixtures/design-critique", name), "utf8")
      );
      assert.match(staged, /type="submit"/);
      assert.match(staged, /Request recorded for/);
      assert.match(staged, /no backend or production coverage/);
    }
    assert.equal(
      fs.existsSync(
        path.join(runDir, "runtime/pm/evals/quality/design-composition-judge-guidance.json")
      ),
      false
    );
    const scan = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) scan(file);
        else if (entry.isFile()) {
          const content = fs.readFileSync(file, "utf8");
          assert.equal(content.includes(guidance.shared), false, file);
          assert.equal(content.includes(guidance.workflows["design-critique"]), false, file);
        }
      }
    };
    for (const folder of ["runtime/pm", "scenario", "workdir"]) scan(path.join(runDir, folder));
    const loaded = loadQualityCase(root, caseId);
    assert.equal(loaded.prompt.includes("Judge-only fixture reference"), false);
    assert.equal(
      guidance.cases[caseId].scenario_contract_hash,
      hashTree(path.join(root, "evals/scenarios/quality-design-critique-low-quality-schema-valid"))
        .hash
    );
    const stagedIdentity = JSON.parse(
      fs.readFileSync(path.join(runDir, "metadata/scenario_identity.json"), "utf8")
    );
    assert.equal(guidance.cases[caseId].scenario_hash, stagedIdentity.scenario_hash);
    assert.notEqual(stagedIdentity.scenario_hash, guidance.cases[caseId].scenario_contract_hash);
    assert.equal(guidance.cases[caseId].quality_case_hash, loaded.prompt_hash);
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});
