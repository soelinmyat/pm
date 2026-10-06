"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const { buildWorkerPrompt, countWords } = require("../scripts/dev-prompt");

function validInput(overrides = {}) {
  return {
    outcome: "Implement phase-local prompt assembly.",
    scope: ["Edit the prompt builder."],
    exclusions: ["Do not ship."],
    inputs: ["RFC issue 3"],
    context: "Node.js plugin repository.",
    phaseContract: "Implement only the active phase. FUTURE_SHIP_TOKEN must not be present.",
    acceptanceCriteria: ["The prompt contains nine sections."],
    repositoryRules: ["Use apply_patch for edits."],
    authority: { localWrites: true, commit: false, merge: false },
    evidence: ["Targeted tests pass."],
    stopConditions: ["A product decision is missing."],
    resultSchema: { schema_version: 1, status: "passed|blocked|failed|noop" },
    ...overrides,
  };
}

function designContext(visual = true) {
  return {
    ui_impact: visual,
    design_requirements: ["Preserve manual Save and the existing drawer."],
    prototype: null,
    critical_states: ["Saved evidence with a long contributor name and twenty checkpoints"],
    experience_invariants: ["Save, leave and resume without losing evidence."],
    visual_invariants: visual ? ["Job description and status remain easy to scan."] : [],
  };
}

test("first visual implementation packet carries the exact approved context and early composition method", () => {
  const context = designContext();
  const result = buildWorkerPrompt(
    validInput({
      phase: "implementation",
      design_context: context,
      inputs: [
        "docs/design-system/product-design-guidance.md",
        "src/jobs/detail.tsx — comparable job and gallery",
      ],
    })
  );
  const encoded = result.prompt.match(/Approved design context:\n```json\n([\s\S]*?)\n```/);
  assert.ok(encoded, "the worker must receive the complete context, not a summary");
  assert.deepEqual(JSON.parse(encoded[1]), context);
  assert.deepEqual(context, designContext(), "builder must not mutate approved requirements");
  assert.match(result.prompt, /product-ui-judgment\.md/);
  assert.match(result.prompt, /Before accepting the first visible slice/);
  assert.match(result.prompt, /whole-page before\/after/);
  assert.match(result.prompt, /docs\/design-system\/product-design-guidance\.md/);
  assert.match(result.prompt, /src\/jobs\/detail\.tsx/);
  assert.doesNotMatch(result.prompt, /additional review round|required alternative prototype/);
  assert.equal((result.prompt.match(/^## /gm) || []).length, 9);
});

test("UI tasks without an approved design context receive composition guidance without inventing approval", () => {
  const result = buildWorkerPrompt(validInput({ phase: "implementation", ui_impact: true }));
  assert.match(result.prompt, /product-ui-judgment\.md/);
  assert.doesNotMatch(result.prompt, /Approved design context:/);
});

test("nonvisual and later-phase packets preserve experience context without first-slice visual instructions", () => {
  for (const overrides of [
    { phase: "implementation", design_context: designContext(false) },
    { phase: "review", design_context: designContext() },
    { phase: "implementation", ui_impact: false },
  ]) {
    const result = buildWorkerPrompt(validInput(overrides));
    assert.doesNotMatch(
      result.prompt,
      /Before accepting the first visible slice|product-ui-judgment\.md/
    );
    if (overrides.design_context) assert.match(result.prompt, /Save, leave and resume/);
  }
});

test("packet metadata cannot erase approved visual impact or silently omit the active phase", () => {
  assert.throws(
    () =>
      buildWorkerPrompt(
        validInput({ phase: "implementation", ui_impact: false, design_context: designContext() })
      ),
    /ui_impact.*conflict/
  );
  assert.throws(() => buildWorkerPrompt(validInput({ ui_impact: true })), /phase.*required/);
  assert.throws(
    () => buildWorkerPrompt(validInput({ phase: "implemntation", ui_impact: true })),
    /phase.*invalid/
  );
  assert.throws(
    () => buildWorkerPrompt(validInput({ phase: "implementation", ui_impact: "true" })),
    /ui_impact.*boolean/
  );
  assert.throws(
    () =>
      buildWorkerPrompt(
        validInput({
          phase: "implementation",
          design_context: { ...designContext(), prototype: { path: "mock.html" } },
        })
      ),
    /prototype.*sha256/
  );
});

test("complete visual context consumes normal packet budget and is never silently truncated", () => {
  const context = designContext();
  context.design_requirements = ["é".repeat(9000)];
  assert.throws(
    () => buildWorkerPrompt(validInput({ phase: "implementation", design_context: context })),
    /Inputs and context.*limit/
  );
});

test("approved Unicode line separators cannot trigger heading demotion inside JSON values", () => {
  const context = designContext();
  context.design_requirements = ["Keep labels:\u2028## Evidence\u2029# Status"];
  context.visual_invariants = ["Preserve:\u2029## Saved progress\u2028# Description"];
  const { prompt } = buildWorkerPrompt(
    validInput({ phase: "implementation", design_context: context })
  );
  const encoded = prompt.match(/Approved design context:\n```json\n([\s\S]*?)\n```/);
  assert.deepEqual(JSON.parse(encoded[1]), context);
  assert.equal((prompt.match(/^## /gm) || []).length, 9);
});

test("CLI detail and drawer briefs preserve scoped interaction decisions and bound prototype identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ui-implementation-"));
  try {
    for (const surface of ["detail", "drawer"]) {
      const context = designContext();
      context.prototype = {
        path: "pm/prototypes/job.html",
        sha256: `sha256:${"a".repeat(64)}`,
      };
      context.design_requirements.push(
        surface === "detail"
          ? "Keep saved evidence inside the content/sidebar composition; contributor details remain previewable."
          : "Save progress is primary; Complete work order is secondary. Preserve the production drawer."
      );
      const inputPath = path.join(directory, `${surface}.json`);
      const outputPath = path.join(directory, `${surface}.md`);
      fs.writeFileSync(
        inputPath,
        JSON.stringify(
          validInput({
            phase: "implementation",
            design_context: context,
            outcome: `Refine the ${surface} while preserving approved save semantics.`,
            inputs: ["DESIGN.md", `src/jobs/${surface}.tsx — incumbent composition`],
          })
        )
      );
      const result = spawnSync(
        process.execPath,
        [
          path.resolve(__dirname, "../scripts/dev-prompt.js"),
          "--input",
          inputPath,
          "--output",
          outputPath,
        ],
        { encoding: "utf8" }
      );
      assert.equal(result.status, 0, result.stderr);
      const prompt = fs.readFileSync(outputPath, "utf8");
      const encoded = prompt.match(/Approved design context:\n```json\n([\s\S]*?)\n```/);
      assert.deepEqual(JSON.parse(encoded[1]), context);
      assert.match(prompt, /whole-page before\/after/);
      assert.match(prompt, /Preserve approved behavior and navigation/);
      assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const HEADINGS = [
  "Outcome",
  "Scope and exclusions",
  "Inputs and context",
  "Acceptance criteria",
  "Applicable repository rules",
  "Authorized actions",
  "Required evidence",
  "Stop conditions",
  "Result schema",
];

test("buildWorkerPrompt: renders the nine canonical sections exactly once", () => {
  const result = buildWorkerPrompt(
    validInput({ phaseContract: "# Phase\n\n## Nested worker guidance\n\nImplement it." })
  );

  for (const heading of HEADINGS) {
    const matches = result.prompt.match(new RegExp(`^## ${heading}$`, "gm")) || [];
    assert.equal(matches.length, 1, heading);
  }
  assert.equal((result.prompt.match(/^## /gm) || []).length, 9);
  assert.match(result.prompt, /^### Nested worker guidance$/m);
  assert.deepEqual(result.sections, HEADINGS);
});

test("buildWorkerPrompt: reports exact UTF-8 byte and word counts", () => {
  const result = buildWorkerPrompt(validInput({ outcome: "Ship café safely." }));

  assert.equal(result.metrics.bytes, Buffer.byteLength(result.prompt, "utf8"));
  assert.equal(result.metrics.words, countWords(result.prompt));
  assert.ok(result.metrics.words > 0);
});

test("buildWorkerPrompt: canonical packet bytes remain stable across runtime refactors", () => {
  const prompt = buildWorkerPrompt(validInput()).prompt;
  assert.equal(Buffer.byteLength(prompt, "utf8"), 748);
  assert.equal(
    crypto.createHash("sha256").update(prompt).digest("hex"),
    "99e9ce86c2b123e7ad016a07dca8f6624a88aa253e83524227fba9050c7802a3"
  );
});

test("buildWorkerPrompt: formats authority explicitly, including denied actions", () => {
  const result = buildWorkerPrompt(validInput());

  assert.match(result.prompt, /localWrites: allowed/);
  assert.match(result.prompt, /commit: denied/);
  assert.match(result.prompt, /merge: denied/);
});

test("buildWorkerPrompt: includes only the supplied active phase contract", () => {
  const result = buildWorkerPrompt(
    validInput({
      phaseContract: "ACTIVE_IMPLEMENT_TOKEN",
      futurePhaseContracts: ["FUTURE_SHIP_TOKEN", "FUTURE_RETRO_TOKEN"],
    })
  );

  assert.match(result.prompt, /ACTIVE_IMPLEMENT_TOKEN/);
  assert.doesNotMatch(result.prompt, /FUTURE_SHIP_TOKEN|FUTURE_RETRO_TOKEN/);
});

test("buildWorkerPrompt: validates required fields instead of emitting vague placeholders", () => {
  assert.throws(() => buildWorkerPrompt(validInput({ outcome: " " })), /outcome is required/);
  assert.throws(
    () => buildWorkerPrompt(validInput({ acceptanceCriteria: [] })),
    /acceptanceCriteria must contain at least one item/
  );
});

test("countWords: handles empty and repeated whitespace", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("  one\n\ttwo   three "), 3);
});

test("CLI writes the bounded prompt atomically with private permissions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-prompt-"));
  try {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "prompt.md");
    fs.writeFileSync(inputPath, JSON.stringify(validInput()));
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "..", "scripts", "dev-prompt.js"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(fs.readFileSync(outputPath, "utf8"), /^## Outcome/m);
    assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
    assert.ok(JSON.parse(result.stdout).words > 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Dev budget rejects oversized authority without truncating or publishing a partial packet", () => {
  const input = validInput({ authority: { ["dangerous-action-".repeat(20)]: false } });
  assert.throws(
    () => buildWorkerPrompt(input, { maxSectionBytes: 200 }),
    /Authorized actions.*limit/
  );
  const result = buildWorkerPrompt(input, { maxSectionBytes: 4096 });
  assert.ok(result.prompt.includes(Object.keys(input.authority)[0] + ": denied"));
  assert.throws(() => buildWorkerPrompt(input, { maxPromptBytes: 200 }), /Dev prompt.*limit/);
});

test("Dev configurable byte budgets and component counts preserve every contract", () => {
  const input = validInput({ context: "é".repeat(9000) });
  assert.throws(() => buildWorkerPrompt(input), /Inputs and context.*limit/);
  const result = buildWorkerPrompt({ ...input, prompt_budget: { maxSectionBytes: 20000 } });
  assert.match(result.prompt, /Acceptance criteria/);
  assert.match(result.prompt, /merge: denied/);
  assert.match(result.prompt, /Result schema/);
  assert.equal(
    result.metrics.sections.reduce((n, section) => n + section.bytes, 0) + 16,
    result.metrics.bytes
  );
  assert.equal(
    result.metrics.sections.reduce((n, section) => n + section.words, 0),
    result.metrics.words
  );
  for (const budget of [
    { maxPromptBytes: 0 },
    { maxSectionBytes: Infinity },
    { maxPromptBytes: "100" },
    { typo: 10 },
  ]) {
    assert.throws(() => buildWorkerPrompt(validInput({ prompt_budget: budget })), /prompt budget/);
  }
});

test("Dev CLI preserves an existing output when the packet exceeds its budget", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-budget-"));
  try {
    const inputPath = path.join(directory, "input.json");
    const outputPath = path.join(directory, "prompt.md");
    fs.writeFileSync(
      inputPath,
      JSON.stringify(validInput({ prompt_budget: { maxPromptBytes: 1 } }))
    );
    fs.writeFileSync(outputPath, "previous valid packet");
    const result = spawnSync(
      process.execPath,
      [
        path.resolve(__dirname, "../scripts/dev-prompt.js"),
        "--input",
        inputPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /limit/);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "previous valid packet");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
