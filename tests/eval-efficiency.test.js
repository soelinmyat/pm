"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { collectEfficiency, summarizeEfficiency } = require("../scripts/evals/efficiency.js");
const { compareQualityScorecards } = require("../scripts/evals/quality.js");
const jsonl = (events) => events.map((event) => JSON.stringify(event)).join("\n");
test("usage is measured from terminal records once, with missing categories left unknown", () => {
  const rawTranscript = jsonl([
    { type: "item.started", item: { id: "x", type: "command_execution", command: "npm test" } },
    {
      type: "item.completed",
      item: { id: "x", type: "command_execution", command: "npm test", exit_code: 0 },
    },
    {
      type: "item.completed",
      item: { id: "y", type: "command_execution", command: "npm test", exit_code: 0 },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 200, output_tokens: 20, cached_input_tokens: 100 },
    },
    {
      type: "turn.completed",
      usage: { input_tokens: 300, output_tokens: 30, cached_input_tokens: 150 },
    },
  ]);
  const result = collectEfficiency({ rawTranscript, adapter: "codex", durationMs: 10 });
  assert.equal(result.tokens.input_tokens.value, 500);
  assert.equal(result.tokens.cached_input_tokens.value, 250);
  assert.equal(result.tokens.reasoning_tokens.value, null);
  assert.equal(result.observed_tool_calls.value, 2);
  assert.equal(result.exact_repeated_reads_or_checks.value, 1);
  assert.equal(result.unnecessary_questions.value, null);
  assert.equal(result.billed_cost_usd.value, null);
});
test("Claude cumulative result does not double count message usage or invent cost", () => {
  const result = collectEfficiency({
    adapter: "claude",
    rawTranscript: jsonl([
      { type: "assistant", message: { usage: { input_tokens: 999 } } },
      {
        type: "result",
        usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 8 },
        total_cost_usd: 0.04,
      },
    ]),
    durationMs: 8,
  });
  assert.equal(result.tokens.input_tokens.value, 10);
  assert.equal(result.tokens.cached_input_tokens.value, 8);
  assert.equal(result.billed_cost_usd.value, 0.04);
});
test("malformed, missing, or incomplete traces produce null metrics and explanations", () => {
  for (const rawTranscript of [null, "{broken"]) {
    const result = collectEfficiency({ rawTranscript, adapter: "codex", durationMs: 4 });
    assert.equal(result.tokens.input_tokens.value, null);
    assert.match(result.tokens.input_tokens.reason, /transcript/);
    assert.equal(result.observed_tool_calls.value, null);
  }
  const result = collectEfficiency({
    rawTranscript: jsonl([{ type: "turn.completed", usage: { input_tokens: 500 } }]),
    adapter: "codex",
    captureComplete: false,
  });
  assert.equal(result.tokens.input_tokens.value, null);
});
test("cost per behavioral success includes unsuccessful attempts and refuses partial dollar coverage", () => {
  const candidate = (status, duration, cost) => ({
    behavioral: { status },
    runtime: { duration_ms: duration, efficiency: { billed_cost_usd: { value: cost } } },
  });
  const rows = [
    candidate("pass", 10, 0.1),
    candidate("fail", 20, 0.2),
    candidate("indeterminate", 30, 0.3),
  ];
  let result = summarizeEfficiency(rows);
  assert.equal(result.elapsed_ms_per_behavioral_success.value, 60);
  assert.ok(Math.abs(result.billed_usd_per_behavioral_success.value - 0.6) < 1e-9);
  assert.equal(result.cost_per_human_accepted_outcome.value, null);
  rows[1].runtime.efficiency.billed_cost_usd.value = null;
  result = summarizeEfficiency(rows);
  assert.equal(result.billed_usd_per_behavioral_success.value, null);
  assert.equal(summarizeEfficiency([rows[1]]).elapsed_ms_per_behavioral_success.value, null);
});
test("revision comparison requires explicit frozen source variants and all non-treatment identities", () => {
  const h = (c) => "sha256:" + c.repeat(64);
  const identity = {
    source_hash: h("a"),
    scenario_hash: h("b"),
    quality_case_hash: h("c"),
    rubric_hash: h("d"),
    evaluation_design_hash: h("e"),
    environment_hash: h("f"),
    profile_hash: h("1"),
  };
  const baseline = {
    workflow: "research",
    case_id: "research-happy-path",
    evaluation_identity: identity,
    profiles: {},
    judges: [],
  };
  const current = { ...baseline, evaluation_identity: { ...identity, source_hash: h("2") } };
  assert.equal(compareQualityScorecards(baseline, current).comparable, false);
  assert.equal(compareQualityScorecards(baseline, baseline).comparable, true);
  const { source_hash, ...frozen } = identity;
  const design = {
    schema_version: 1,
    id: "astra-instructions",
    ...frozen,
    variants: [
      { id: "baseline", source_hash },
      { id: "revised", source_hash: h("2") },
    ],
  };
  const result = compareQualityScorecards(baseline, current, design);
  assert.equal(result.comparable, true);
  assert.match(result.comparison_design_hash, /^sha256:/);
  for (const field of [
    "environment_hash",
    "profile_hash",
    "quality_case_hash",
    "scenario_hash",
    "rubric_hash",
    "evaluation_design_hash",
  ]) {
    assert.equal(
      compareQualityScorecards(
        baseline,
        { ...current, evaluation_identity: { ...current.evaluation_identity, [field]: h("9") } },
        design
      ).comparable,
      false,
      field
    );
  }
});
test("paired blind revision packets bind two aliases of the same model to deliberate source treatments", () => {
  const crypto = require("node:crypto");
  const { buildBlindPacket, validatePrivateKey } = require("../scripts/evals/quality.js");
  const digest = (value) => "sha256:" + crypto.createHash("sha256").update(value).digest("hex");
  const h = (c) => "sha256:" + c.repeat(64);
  const rubric = require("../evals/quality/rubric.json");
  const prompt = "Recommend a reversible experiment from the frozen sources.";
  const scenario = { workflow: "research", case_id: "research-happy-path", prompt };
  const model = { adapter: "codex", model: "gpt-6-astra", effort: "high" };
  const make = (id, source) => ({
    schema_version: 1,
    workflow: "research",
    case_id: scenario.case_id,
    case_type: "happy-path",
    release: "1.0.0",
    quality_case_hash: digest(prompt),
    source_hash: source,
    environment_hash: h("f"),
    behavioral: { status: "pass", artifact_ref: "runs/test-" + id, scenario_hash: h("b") },
    profile: { id, ...model },
    runtime: { duration_ms: 2, status: "complete" },
    repeat: 1,
    artifacts: [
      {
        name: "result.md",
        media_type: "text/markdown",
        content: "Pilot with A; evidence is mixed.",
        sha256: digest("Pilot with A; evidence is mixed."),
      },
    ],
  });
  const candidates = [make("baseline-high", h("a")), make("revised-high", h("c"))];
  const design = {
    schema_version: 1,
    id: "astra-prompts",
    model,
    scenario_hash: h("b"),
    quality_case_hash: digest(prompt),
    rubric_hash: digest(JSON.stringify(rubric)),
    environment_hash: h("f"),
    variants: [
      { profile_id: "baseline-high", source_hash: h("a"), release: "1.0.0" },
      { profile_id: "revised-high", source_hash: h("c"), release: "1.0.0" },
    ],
  };
  assert.throws(
    () => buildBlindPacket({ candidates, scenario, rubric, salt: "secret" }),
    /share release/
  );
  const result = buildBlindPacket({
    candidates,
    scenario,
    rubric,
    salt: "secret",
    comparisonDesign: design,
  });
  assert.equal(result.packet.pairwise_plan.length, 1);
  assert.equal(result.judgePackets.length, 2);
  assert.equal(validatePrivateKey(result.key, result.packet, candidates).ok, true);
  const altered = structuredClone(candidates);
  altered[1].profile.effort = "medium";
  assert.throws(
    () =>
      buildBlindPacket({
        candidates: altered,
        scenario,
        rubric,
        salt: "secret",
        comparisonDesign: design,
      }),
    /model-mismatch/
  );
  const tampered = structuredClone(result.key);
  tampered.comparison_design.variants[1].source_hash = h("d");
  assert.equal(validatePrivateKey(tampered, result.packet, candidates).ok, false);
});
test("Claude tools are counted from its actual stream format", () => {
  const result = collectEfficiency({
    adapter: "claude",
    durationMs: 10,
    rawTranscript: jsonl([
      {
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "one", name: "Read", input: { file_path: "a.md" } },
            { type: "tool_use", id: "two", name: "Read", input: { file_path: "b.md" } },
            { type: "tool_use", id: "three", name: "AskUserQuestion", input: {} },
          ],
        },
      },
      { type: "result", usage: {} },
    ]),
  });
  assert.equal(result.observed_tool_calls.value, 3);
  assert.equal(result.observed_input_requests.value, 1);
  assert.equal(result.exact_repeated_reads_or_checks.value, 0);
});
