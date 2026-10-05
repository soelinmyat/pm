"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { productFixture, PRODUCT_WORKFLOWS } = require("../scripts/evals/product-quality.js");
const {
  buildBlindPacket,
  loadQualityCase,
  compareQualityScorecards,
  qualityCaseScenarioHash,
} = require("../scripts/evals/quality.js");
const { summarizeRequiredChecks } = require("../scripts/lib/ci-check-summary.js");
const { runEval } = require("../scripts/evals/run.js");
const root = path.resolve(__dirname, "..");
const sha = (value) => `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const suite = JSON.parse(read("evals/quality/suite.json"));
const rubric = JSON.parse(read(suite.rubric_ref));
const oracle = JSON.parse(read("evals/quality/product-judge-guidance.json"));

function candidates(workflow) {
  const prompt = loadQualityCase(root, `${workflow}-happy-path`).prompt;
  return suite.profiles.slice(0, 2).map((profile) => {
    const content = "A source-bound draft with limitations and a testable recommendation.";
    return {
      schema_version: 1,
      workflow,
      case_id: `${workflow}-happy-path`,
      case_type: "happy-path",
      release: "1.13.81",
      quality_case_hash: sha(prompt),
      source_hash: sha("same-source"),
      behavioral: {
        status: "pass",
        artifact_ref: "runs/product-test",
        scenario_hash: oracle.cases[`${workflow}-happy-path`].scenario_hash,
      },
      profile,
      runtime: { duration_ms: 1, status: "complete" },
      repeat: 1,
      artifacts: [
        { name: "report.md", media_type: "text/markdown", sha256: sha(content), content },
      ],
    };
  });
}

test("all product candidate cases exclude answers while authenticated judge packets retain concise controls", () => {
  for (const workflow of PRODUCT_WORKFLOWS) {
    for (const item of suite.workflows.find((entry) => entry.id === workflow).cases) {
      const fixture = productFixture(workflow, item.type, item.id, "ready");
      const candidateInput = JSON.stringify(fixture.files) + loadQualityCase(root, item.id).prompt;
      assert.equal(fixture.files["concise-control.md"], undefined);
      assert.doesNotMatch(
        candidateInput,
        /independent_demand_origins:\s*2|Concise acceptable control|Judge-only reference/
      );
      assert.equal(candidateInput.includes(oracle.shared), false);
      assert.equal(candidateInput.includes(oracle.workflows[workflow]), false);
      const generated = read(`evals/scenarios/${item.scenario_ref}/setup.sh`);
      assert.doesNotMatch(generated, /concise-control\.md|independent_demand_origins: 2/);
      assert.equal(item.judge_guidance_ref, "evals/quality/product-judge-guidance.json");
      assert.deepEqual(oracle.cases[item.id], {
        workflow,
        quality_case_hash: sha(loadQualityCase(root, item.id).prompt),
        scenario_contract_hash: item.scenario_contract_hash,
        scenario_hash: qualityCaseScenarioHash(
          path.join(root, "evals/scenarios", item.scenario_ref),
          loadQualityCase(root, item.id).prompt
        ),
      });
    }
    const result = buildBlindPacket({
      candidates: candidates(workflow),
      rubric,
      scenario: {
        workflow,
        case_id: `${workflow}-happy-path`,
        prompt: loadQualityCase(root, `${workflow}-happy-path`).prompt,
        scenario_contract_hash: suite.workflows.find((entry) => entry.id === workflow).cases[0]
          .scenario_contract_hash,
      },
      salt: "product-oracle-boundary-test",
      judgeGuidance: oracle,
    });
    assert.ok(result.packet.instructions.includes(oracle.shared));
    assert.ok(result.packet.instructions.includes(oracle.workflows[workflow]));
    assert.equal(result.packet.scenario.prompt.includes(oracle.shared), false);
  }
});

test("actual candidate runtime staging excludes the judge-only oracle", () => {
  const runId = "20261005T000001Z--quality-research-happy-path--stub";
  const runDir = path.join(root, "eval-results/runs", runId);
  fs.rmSync(runDir, { recursive: true, force: true });
  try {
    // This is a harness/staging check; the stub cannot establish product quality.
    runEval({
      rootDir: root,
      scenarioArg: "evals/scenarios/quality-research-happy-path",
      agent: "stub",
      qualityCase: "research-happy-path",
      runId,
    });
    assert.ok(fs.existsSync(path.join(runDir, "runtime/pm/scripts/evals/product-quality.js")));
    assert.ok(fs.existsSync(path.join(runDir, "workdir/product-evidence.json")));
    assert.equal(
      fs.existsSync(path.join(runDir, "runtime/pm/evals/quality/product-judge-guidance.json")),
      false
    );
    assert.equal(fs.existsSync(path.join(runDir, "workdir/concise-control.md")), false);
    const inspect = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) inspect(target);
        else if (entry.isFile()) {
          const bytes = fs.readFileSync(target, "utf8");
          for (const reference of [oracle.shared, ...Object.values(oracle.workflows)])
            assert.equal(bytes.includes(reference), false, `staged answer in ${target}`);
          assert.doesNotMatch(bytes, /independent_demand_origins["']?\s*[:=]\s*2\b/, target);
        }
      }
    };
    inspect(path.join(runDir, "runtime/pm"));
    inspect(path.join(runDir, "workdir"));
    inspect(path.join(runDir, "scenario"));
    assert.doesNotMatch(
      read("scripts/evals/product-quality.js"),
      /customerOrigins|customerOrigins\.size/
    );
    assert.doesNotMatch(
      fs.readFileSync(path.join(runDir, "scenario/story.md"), "utf8"),
      /Concise acceptable control|Judge-only reference/
    );
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
});

test("actual quality staging and CLI capture produce oracle-compatible candidate identities", () => {
  for (const workflow of ["research", "design-critique"]) {
    const caseId = `${workflow}-${workflow === "research" ? "happy-path" : "low-quality-schema-valid"}`;
    const item = suite.workflows
      .find((entry) => entry.id === workflow)
      .cases.find((entry) => entry.id === caseId);
    const guidance = JSON.parse(read(item.judge_guidance_ref));
    const runId = `20261005T000002Z--${item.scenario_ref}--stub`;
    const runDir = path.join(root, "eval-results/runs", runId);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-staged-product-capture-"));
    fs.rmSync(runDir, { recursive: true, force: true });
    try {
      runEval({
        rootDir: root,
        scenarioArg: `evals/scenarios/${item.scenario_ref}`,
        agent: "stub",
        qualityCase: item.id,
        runId,
      });
      const observed = JSON.parse(
        fs.readFileSync(path.join(runDir, "metadata/scenario_identity.json"), "utf8")
      );
      assert.notEqual(
        observed.scenario_hash,
        item.scenario_contract_hash,
        "quality prompt substitution changes the staged tree"
      );
      const writeMetadata = (reference, value) =>
        fs.writeFileSync(path.join(runDir, reference), JSON.stringify(value));
      const ledgerPath = path.join(tmp, "candidates.json");
      // Adapter observations are test doubles; staging, its hashes, capture and
      // packet construction use the real producer paths. This is no quality claim.
      fs.writeFileSync(
        path.join(runDir, "artifacts/quality-output.md"),
        "A needs recipient-safe sharing; B needs saved-view scheduling. Evidence is limited."
      );
      for (const profile of suite.profiles.slice(0, 2)) {
        writeMetadata("verdict.json", {
          scenario: item.scenario_ref,
          agent: profile.adapter,
          status: "pass",
          artifact_ref: "runs/test-double",
        });
        writeMetadata("metadata/quality_profile_identity.json", { schema_version: 1, ...profile });
        writeMetadata(`metadata/${profile.adapter}_progress.json`, {
          status: "complete",
          duration_ms: 1,
        });
        writeMetadata(`metadata/${profile.adapter}_command.json`, {
          command: "fixture-codex",
          timeout_ms: 1000,
          argv: [
            "exec",
            "-m",
            profile.model,
            "-c",
            `model_reasoning_effort=${JSON.stringify(profile.effort)}`,
          ],
        });
        const captured = spawnSync(
          process.execPath,
          [
            path.join(root, "scripts/evals/quality-cli.js"),
            "capture",
            "--run",
            runDir,
            "--case",
            item.id,
            "--profile",
            profile.id,
            "--repeat",
            "1",
            "--artifact",
            "artifacts/quality-output.md",
            "--out",
            ledgerPath,
          ],
          { cwd: root, encoding: "utf8" }
        );
        assert.equal(captured.status, 0, captured.stdout + captured.stderr);
      }
      const rows = JSON.parse(fs.readFileSync(ledgerPath, "utf8")).candidates;
      assert.equal(rows[0].behavioral.scenario_hash, observed.scenario_hash);
      assert.equal(observed.scenario_hash, guidance.cases[item.id].scenario_hash);
      const result = buildBlindPacket({
        candidates: rows,
        rubric,
        scenario: {
          workflow,
          case_id: item.id,
          prompt: loadQualityCase(root, item.id).prompt,
          scenario_contract_hash: item.scenario_contract_hash,
        },
        salt: "real-staged-capture-test",
        judgeGuidance: guidance,
      });
      assert.ok(result.packet.instructions.includes(guidance.shared));
      const packetRun = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/evals/quality-cli.js"),
          "packet",
          "--candidates",
          ledgerPath,
          "--case",
          item.id,
          "--packet",
          path.join(tmp, "packet.json"),
          "--key",
          path.join(tmp, "key.json"),
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, PM_EVAL_BLIND_SALT: "actual-staged-packet-test" },
        }
      );
      assert.equal(packetRun.status, 0, packetRun.stdout + packetRun.stderr);
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true });
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
});

test("semantic judge instructions affect CLI evaluation identity; old scorecards cannot masquerade as comparable", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-product-judge-identity-"));
  try {
    const rows = candidates("research");
    const result = buildBlindPacket({
      candidates: rows,
      rubric,
      scenario: {
        workflow: "research",
        case_id: "research-happy-path",
        prompt: loadQualityCase(root, "research-happy-path").prompt,
        scenario_contract_hash: suite.workflows.find((entry) => entry.id === "research").cases[0]
          .scenario_contract_hash,
      },
      salt: "product-identity",
      judgeGuidance: oracle,
    });
    const write = (name, value) => {
      const target = path.join(tmp, name);
      fs.writeFileSync(target, JSON.stringify(value));
      return target;
    };
    const args = [
      path.join(root, "scripts/evals/quality-cli.js"),
      "score",
      "--candidates",
      write("candidates.json", { schema_version: 1, candidates: rows }),
      "--key",
      write("key.json", result.key),
    ];
    result.judgePackets.forEach((packet, index) => {
      args.push(
        "--packet",
        write(`packet-${index}.json`, packet),
        "--judgment",
        write(`judge-${index}.json`, {
          $schema: "https://pm-plugin.local/evals/quality-judgment.schema.json",
          schema_version: 1,
          packet_id: packet.packet_id,
          view_id: packet.view_id,
          view_sha256: packet.view_sha256,
          judge: `judge-${index}`,
          candidates: packet.candidates.map((candidate) => ({
            id: candidate.id,
            dimensions: rubric.dimensions.map((dimension) => ({
              dimension: dimension.id,
              score: 3,
              evidence: "The supplied draft exposes its limitations.",
            })),
            summary: "Usable draft.",
          })),
          pairwise: packet.pairwise_plan.map((pair) => ({
            ...pair,
            preference: "tie",
            reason: "Equivalent decision usefulness.",
          })),
        })
      );
    });
    const scorePath = path.join(tmp, "score.json");
    args.push("--json", scorePath);
    const scored = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
    assert.equal(scored.status, 0, scored.stdout + scored.stderr);
    const score = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    const item = suite.workflows.find((entry) => entry.id === "research").cases[0];
    const priorDesign = {
      minimum_repeats: suite.minimum_repeats,
      profiles: suite.profiles,
      case: item,
      rubric,
    };
    assert.equal(
      score.evaluation_identity.evaluation_design_hash,
      sha(JSON.stringify({ ...priorDesign, judge_instructions: result.packet.instructions }))
    );
    const legacy = {
      ...score,
      evaluation_identity: {
        ...score.evaluation_identity,
        evaluation_design_hash: sha(JSON.stringify(priorDesign)),
      },
    };
    const comparison = compareQualityScorecards(legacy, score);
    assert.equal(comparison.comparable, false);
    assert.equal(comparison.reason, "evaluation_design-mismatch");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("a custom healthcare corpus never inherits the default finance answer and uses only its selected bound resource", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pm-healthcare-judge-boundary-"));
  try {
    const prompt =
      "Investigate appointment reminders using these local interviews. Clinic North: patients miss appointments because our confirmation texts omit the time. Clinic East: our receptionist calls patients who cannot read our English reminders. Clinic South: we reschedule visits manually after patients reply to reminder texts. Explain the evidence limits and useful next research. Save a draft; adoption remains pending.";
    const scenarioHash = sha("frozen-clinic-interviews-and-research-contract");
    const rows = candidates("research").map((candidate) => ({
      ...candidate,
      quality_case_hash: sha(prompt),
      behavioral: { ...candidate.behavioral, scenario_hash: scenarioHash },
    }));
    const scenario = {
      workflow: "research",
      case_id: "research-happy-path",
      prompt,
      scenario_contract_hash: scenarioHash,
    };
    const generic = buildBlindPacket({
      candidates: rows,
      rubric,
      scenario,
      salt: "clinic-api-test",
    });
    assert.equal(generic.packet.instructions.includes(oracle.shared), false);
    assert.throws(
      () =>
        buildBlindPacket({
          candidates: rows,
          rubric,
          scenario,
          salt: "clinic-api-test",
          judgeGuidance: oracle,
        }),
      /exact case\/corpus identity/
    );
    // Even the original prompt must not borrow an oracle for a different staged corpus.
    assert.throws(
      () =>
        buildBlindPacket({
          candidates: candidates("research").map((candidate) => ({
            ...candidate,
            behavioral: { ...candidate.behavioral, scenario_hash: scenarioHash },
          })),
          rubric,
          scenario: { ...scenario, prompt: loadQualityCase(root, "research-happy-path").prompt },
          salt: "clinic-corpus-test",
          judgeGuidance: oracle,
        }),
      /exact case\/corpus identity/
    );

    const write = (reference, value) => {
      const target = path.join(tmp, reference);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
      return target;
    };
    const selectedSuite = structuredClone(suite);
    selectedSuite.workflows = selectedSuite.workflows.filter(
      (workflow) => workflow.id === "research"
    );
    for (const item of selectedSuite.workflows[0].cases) {
      item.prompt_ref = "evals/quality/cases/clinics.md";
      item.scenario_contract_hash = scenarioHash;
      delete item.judge_guidance_ref;
    }
    write(
      "evals/quality/cases/clinics.md",
      selectedSuite.workflows[0].cases.map((item) => `## ${item.type}\n\n${prompt}\n`).join("\n")
    );
    write(selectedSuite.rubric_ref, rubric);
    write("candidates.json", { schema_version: 1, candidates: rows });
    const create = (suiteRef, packetRef) => {
      write(suiteRef, selectedSuite);
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, "scripts/evals/quality-cli.js"),
          "packet",
          "--root",
          tmp,
          "--suite",
          suiteRef,
          "--case",
          scenario.case_id,
          "--candidates",
          "candidates.json",
          "--key",
          `${packetRef}.key`,
          "--packet",
          packetRef,
        ],
        {
          cwd: root,
          encoding: "utf8",
          env: { ...process.env, PM_EVAL_BLIND_SALT: "selected-clinic-suite-test" },
        }
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return JSON.parse(fs.readFileSync(path.join(tmp, packetRef), "utf8"));
    };
    const unbound = create("evals/quality/clinic-unbound-suite.json", "clinic-unbound.packet.json");
    assert.equal(unbound.instructions.includes(oracle.shared), false);
    const clinicGuidance = {
      schema_version: 1,
      shared:
        "Judge-only clinic reference: three independent clinic observations describe different communication and rescheduling problems. They do not establish prevalence or efficacy of a reminder intervention.",
      workflows: {
        research:
          "Reward accurate clinic-level claims, language-access uncertainty, and research that distinguishes reminder content from rescheduling support.",
      },
      cases: {
        [scenario.case_id]: {
          workflow: "research",
          quality_case_hash: sha(prompt),
          scenario_contract_hash: scenarioHash,
          scenario_hash: scenarioHash,
        },
      },
    };
    write("evals/quality/clinic-judge-guidance.json", clinicGuidance);
    selectedSuite.workflows[0].cases[0].judge_guidance_ref =
      "evals/quality/clinic-judge-guidance.json";
    const bound = create("evals/quality/clinic-bound-suite.json", "clinic-bound.packet.json");
    assert.ok(bound.instructions.includes(clinicGuidance.shared));
    assert.equal(bound.instructions.includes(oracle.shared), false);
    assert.equal(bound.scenario.prompt, prompt);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

const head = "a".repeat(40);
function ci(overrides = {}) {
  return {
    expectedHead: head,
    observedHead: head,
    requirementsKnown: true,
    observationComplete: true,
    requiredChecks: [
      { name: "unit", appId: 1 },
      { name: "security", appId: 2 },
    ],
    checks: [
      { name: "unit", appId: 1, headSha: head, status: "completed", conclusion: "success" },
      { name: "security", appId: 2, headSha: head, status: "completed", conclusion: "success" },
    ],
    ...overrides,
  };
}
test("one passing workflow cannot hide a failed, pending, missing, stale or unavailable required check", () => {
  assert.equal(summarizeRequiredChecks(ci()).status, "passed");
  for (const [status, conclusion, expected] of [
    ["completed", "failure", "failed"],
    ["in_progress", "", "pending"],
    ["completed", "cancelled", "failed"],
    ["completed", "", "unavailable"],
  ]) {
    const snapshot = ci();
    snapshot.checks[1] = { ...snapshot.checks[1], status, conclusion };
    const result = summarizeRequiredChecks(snapshot);
    assert.equal(result.status, expected);
    assert.equal(result.all_required_passed, false);
  }
  for (const override of [
    { checks: ci().checks.slice(0, 1) },
    { checks: ci().checks.map((row) => ({ ...row, headSha: "b".repeat(40) })) },
    { requirementsKnown: false },
    { observationComplete: false },
    { observedHead: "b".repeat(40) },
  ]) {
    assert.equal(summarizeRequiredChecks(ci(override)).all_required_passed, false);
  }
  assert.equal(summarizeRequiredChecks(ci({ requiredChecks: [] })).status, "not-required");
  assert.equal(summarizeRequiredChecks(ci({ checks: [] })).status, "missing");
});
test("required check identity and allowed terminal outcomes cannot be guessed", () => {
  const wrongApp = ci();
  wrongApp.checks[1].appId = 99;
  assert.equal(summarizeRequiredChecks(wrongApp).status, "missing");
  const duplicates = ci();
  duplicates.checks.push({ ...duplicates.checks[1] });
  assert.equal(summarizeRequiredChecks(duplicates).status, "ambiguous");
  const skipped = ci();
  skipped.checks[1].conclusion = "skipped";
  assert.equal(summarizeRequiredChecks(skipped).status, "unavailable");
  skipped.requiredChecks[1].acceptedConclusions = ["success", "skipped"];
  assert.equal(summarizeRequiredChecks(skipped).status, "passed");
  skipped.requiredChecks[1].acceptedConclusions = ["failure"];
  assert.equal(summarizeRequiredChecks(skipped).all_required_passed, false);
});

test("present malformed accepted-conclusion policy is unavailable rather than the omitted success default", () => {
  assert.equal(summarizeRequiredChecks(ci()).status, "passed");
  for (const invalid of [false, 0, "", null, undefined, [], {}, ["failure"]]) {
    const snapshot = ci();
    snapshot.requiredChecks[1].acceptedConclusions = invalid;
    assert.equal(summarizeRequiredChecks(snapshot).status, "unavailable");
    assert.equal(summarizeRequiredChecks(snapshot).all_required_passed, false);
    snapshot.checks = [];
    assert.equal(summarizeRequiredChecks(snapshot).status, "unavailable");
  }
});

test("merge-loop state and final handoff preserve actual required-CI outcomes including verified absence", () => {
  const ship = read("skills/ship/steps/07-merge-loop.md");
  const shared = read("references/merge-loop.md");
  for (const source of [ship, shared]) {
    for (const status of [
      "passed",
      "not-required",
      "pending",
      "failed",
      "missing",
      "ambiguous",
      "unavailable",
    ])
      assert.ok(source.includes(status), `missing CI status ${status}`);
    assert.match(source, /summarizeRequiredChecks/);
    assert.match(source, /No required CI checks configured/);
    assert.match(source, /exact.*head/i);
  }
  const emptyPolicy = summarizeRequiredChecks(ci({ requiredChecks: [] }));
  assert.equal(emptyPolicy.status, "not-required");
  assert.equal(emptyPolicy.all_required_passed, false);
  assert.equal(emptyPolicy.head, head);
  assert.match(
    ship,
    /\*\*CI:\*\* \[exact-head required-check summary: passed with check names, or not-required/
  );
  assert.doesNotMatch(ship, /\*\*CI:\*\* \[passed after N rounds\]/);
  assert.match(shared, /zero exit status alone cannot satisfy missing or unavailable evidence/);
});
