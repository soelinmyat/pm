"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { validateDesignContext } = require("../scripts/lib/dev-work-units");
const { validateProposal } = require("../scripts/lib/proposal-schema");
const { renderProposal } = require("../scripts/proposal-render");
const { buildWorkerPrompt } = require("../scripts/dev-prompt");

let Ajv2020 = null;
let addFormats = null;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  Ajv2020 = null;
}

const SURFACES = [
  { name: "Invoice list", paths: ["apps/web/src/invoices/list/**"] },
  {
    name: "Invoice filter bar",
    paths: ["apps/web/src/invoices/filter-bar.tsx", "apps/web/src/invoices/filter-bar.test.tsx"],
  },
];

function visualContext(extra = {}) {
  return {
    design_requirements: ["Filter invoices by status without leaving the list."],
    ui_impact: true,
    prototype: null,
    critical_states: ["empty", "many rows", "filter error"],
    experience_invariants: ["The active filter survives leaving and returning to the list."],
    visual_invariants: ["Status filter sits above the table, left-aligned with its first column."],
    ...extra,
  };
}

function nonvisualContext(extra = {}) {
  return {
    design_requirements: ["Return actionable validation errors to CLI callers."],
    ui_impact: false,
    prototype: null,
    critical_states: ["success", "invalid input"],
    experience_invariants: ["Failures keep a stable nonzero exit code and name the next action."],
    visual_invariants: [],
    ...extra,
  };
}

test("design contexts without surfaces keep validating", () => {
  assert.doesNotThrow(() =>
    validateDesignContext(visualContext(), "design_context", {
      requireExperienceClassification: true,
    })
  );
  assert.doesNotThrow(() => validateDesignContext(nonvisualContext()));
});

test("visual design contexts carry the declared surfaces in scope", () => {
  const context = visualContext({ surfaces: structuredClone(SURFACES) });
  assert.equal(
    validateDesignContext(context, "design_context", { requireExperienceClassification: true }),
    context
  );
  assert.deepEqual(context.surfaces, SURFACES, "validation must not rewrite the declared list");
});

test("declared surfaces belong only to classified visual work", () => {
  assert.throws(
    () => validateDesignContext(nonvisualContext({ surfaces: SURFACES })),
    /surfaces requires ui_impact true/
  );
  const unclassified = visualContext({ surfaces: SURFACES });
  delete unclassified.ui_impact;
  delete unclassified.experience_invariants;
  assert.throws(() => validateDesignContext(unclassified), /surfaces requires ui_impact true/);
});

test("declared surfaces reject malformed entries", () => {
  const cases = [
    [[], /surfaces must be a non-empty array/],
    ["apps/web/**", /surfaces must be a non-empty array/],
    [[{ name: "Invoice list" }], /surfaces\[0\] requires paths/],
    [[{ paths: ["apps/web/**"] }], /surfaces\[0\] requires name/],
    [[{ name: "List", paths: ["a/**"], owner: "x" }], /surfaces\[0\] has unknown field owner/],
    [[{ name: " ", paths: ["a/**"] }], /surfaces\[0\]\.name must be a non-empty string/],
    [[{ name: "List", paths: [] }], /surfaces\[0\]\.paths must be a non-empty array/],
    [[{ name: "List", paths: ["a/**", "a/**"] }], /surfaces\[0\]\.paths must not contain dup/],
    [[{ name: "List", paths: ["/abs/list.tsx"] }], /repo-relative path pattern/],
    [[{ name: "List", paths: ["../other/list.tsx"] }], /repo-relative path pattern/],
    [
      [
        { name: "List", paths: ["a/**"] },
        { name: "List", paths: ["b/**"] },
      ],
      /surfaces names must not contain duplicates/,
    ],
  ];
  for (const [surfaces, expected] of cases) {
    assert.throws(
      () => validateDesignContext(visualContext({ surfaces })),
      expected,
      JSON.stringify(surfaces)
    );
  }
});

test(
  "published Dev and RFC session schemas accept surfaces exactly as runtime does",
  {
    skip: !(Ajv2020 && addFormats) && "Ajv 2020 is not installed",
  },
  () => {
    for (const schemaPath of [
      ["skills", "dev", "references", "dev-session.schema.json"],
      ["skills", "rfc", "references", "rfc-session.schema.json"],
    ]) {
      const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", ...schemaPath), "utf8"));
      const ajv = new Ajv2020({ allErrors: true, strict: false });
      addFormats(ajv);
      const validate = ajv.compile({
        $schema: schema.$schema,
        $defs: schema.$defs,
        $ref: "#/$defs/design_context",
      });
      const label = schemaPath.at(-1);
      assert.equal(validate(visualContext()), true, `${label}: ${JSON.stringify(validate.errors)}`);
      assert.equal(
        validate(visualContext({ surfaces: SURFACES })),
        true,
        `${label}: ${JSON.stringify(validate.errors)}`
      );
      assert.equal(validate(visualContext({ surfaces: [] })), false, label);
      assert.equal(validate(visualContext({ surfaces: [{ name: "List", paths: [] }] })), false);
      assert.equal(validate(visualContext({ surfaces: [{ name: "List" }] })), false, label);
      assert.equal(validate(nonvisualContext({ surfaces: SURFACES })), false, label);
    }
  }
);

function strongProposal() {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "fixtures", "proposals", "strong-v1.json"), "utf8")
  );
}

test("canonical proposals accept declared surfaces and show them to the approver", () => {
  const proposal = strongProposal();
  proposal.design_context.surfaces = structuredClone(SURFACES);
  const result = validateProposal(proposal);
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  const rendered = renderProposal(proposal, { version: "test" });
  assert.match(rendered.html, /<strong>Surfaces in scope<\/strong>/);
  assert.match(rendered.html, /Invoice filter bar/);
  assert.ok(
    renderedPaths(rendered.html).includes("apps/web/src/invoices/filter-bar.tsx"),
    "the path's text is intact"
  );
  assert.match(rendered.markdown, /### Surfaces in scope/);
  assert.match(rendered.markdown, /Invoice list/);
  assert.match(rendered.markdown, /apps\/web\/src\/invoices\/list\/\*\*/);
});

// The text a reader copies from each rendered surface path.
function renderedPaths(html) {
  return [...html.matchAll(/<code class="surface-path">([\s\S]*?)<\/code>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "")
  );
}

test("surface paths break only after a slash or before a hyphen, never mid-word", () => {
  const proposal = strongProposal();
  const longSegment =
    "organisation-level-payment-preferences-recurring-invoice-export-schedule-editor-components";
  const long = `apps/web/src/${longSegment}/index.ts`;
  proposal.design_context.surfaces = [{ name: "Payment preferences", paths: [long] }];
  const rendered = renderProposal(proposal, { version: "test" });

  assert.deepEqual(renderedPaths(rendered.html), [long]);
  const code = rendered.html.match(/<code class="surface-path">([\s\S]*?)<\/code>/)[1];
  // One box per segment; inside it, one piece per hyphen part. A slash ends
  // its segment's last piece, so no line ever starts with a slash, and a
  // hyphen starts its piece, so no line ever ends with one.
  const segments = [
    ...code.matchAll(/<span class="surface-path-segment">([\s\S]*?)<\/span><\/span>/g),
  ];
  assert.equal(segments.length, long.split("/").length);
  const pieces = [...code.matchAll(/<span class="surface-path-piece">([^<]*)<\/span>/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(pieces.slice(0, 3), ["apps/", "web/", "src/"]);
  assert.equal(pieces.at(-1), "index.ts");
  assert.equal(pieces.at(-2), "-components/");
  assert.ok(
    pieces.every((piece) => !piece.endsWith("-")),
    "no piece ends with a hyphen"
  );
  assert.ok(
    pieces.slice(1).every((piece) => !piece.startsWith("/")),
    "no piece starts with a slash"
  );
  assert.equal(pieces.join(""), long);
  // A segment that fits moves to the next line whole; one wider than the line
  // breaks between its pieces; only a piece wider than the line breaks inside.
  const segmentRule = rendered.html.match(/\.surface-path-segment\s*\{([^}]*)\}/)[1];
  assert.match(segmentRule, /display:\s*inline-block/);
  assert.match(segmentRule, /max-width:\s*100%/);
  const pieceRule = rendered.html.match(/\.surface-path-piece\s*\{([^}]*)\}/)[1];
  assert.match(pieceRule, /display:\s*inline-block/);
  assert.match(pieceRule, /max-width:\s*100%/);
  assert.match(pieceRule, /overflow-wrap:\s*anywhere/);
  const pathRule = rendered.html.match(/code\.surface-path\s*\{([^}]*)\}/)[1];
  assert.match(pathRule, /display:\s*block/);
  assert.match(pathRule, /background:\s*(?:none|transparent)/);
  assert.doesNotMatch(rendered.html, /<\/code>, <code class="surface-path">/);
});

test("short surface paths render as single pieces per segment", () => {
  const proposal = strongProposal();
  proposal.design_context.surfaces = [{ name: "Invoice list", paths: ["apps/web/list/**"] }];
  const code = renderProposal(proposal, { version: "test" }).html.match(
    /<code class="surface-path">([\s\S]*?)<\/code>/
  )[1];
  const pieces = [...code.matchAll(/<span class="surface-path-piece">([^<]*)<\/span>/g)].map(
    (match) => match[1]
  );
  assert.deepEqual(pieces, ["apps/", "web/", "list/", "**"]);
});

test("proposals without surfaces render no surfaces section", () => {
  const rendered = renderProposal(strongProposal(), { version: "test" });
  assert.doesNotMatch(rendered.html, /Surfaces in scope/);
  assert.doesNotMatch(rendered.markdown, /Surfaces in scope/);
});

test("implementation packets carry declared surfaces inside the exact approved context", () => {
  const context = visualContext({ surfaces: structuredClone(SURFACES) });
  const result = buildWorkerPrompt({
    outcome: "Add the invoice status filter.",
    scope: ["Edit the invoice list."],
    exclusions: ["Do not ship."],
    inputs: ["Approved proposal invoice-filter"],
    context: "Web client.",
    phaseContract: "Implement only the active phase.",
    acceptanceCriteria: ["The list filters by status."],
    repositoryRules: ["Run the tests."],
    authority: { localWrites: true, commit: false, merge: false },
    evidence: ["Targeted tests pass."],
    stopConditions: ["A product decision is missing."],
    resultSchema: { schema_version: 1, status: "passed|blocked|failed|noop" },
    phase: "implementation",
    design_context: context,
  });
  const encoded = result.prompt.match(/Approved design context:\n```json\n([\s\S]*?)\n```/);
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(encoded[1]).surfaces, SURFACES);
});
