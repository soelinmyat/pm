"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const { flattenSuggestions, selectRoutes } = require("../scripts/route-selection.js");

const ROUTE_SELECTION_SCRIPT = path.join(__dirname, "..", "scripts", "route-selection.js");

test("flattenSuggestions produces stable numbered options from routeSuggestions payloads", () => {
  const flattened = flattenSuggestions({
    items: [
      {
        evidencePath: "evidence/research/one.md",
        topic: "One",
        suggestions: [
          {
            mode: "existing",
            evidencePath: "evidence/research/one.md",
            insightPath: "insights/product/alpha.md",
            description: "Alpha",
            reason: "Matched alpha",
          },
        ],
        suggestedNewRoute: {
          mode: "new",
          evidencePath: "evidence/research/one.md",
          insightPath: "insights/product/one.md",
          domain: "product",
          topic: "One",
          description: "Seed one",
          reason: "No match",
        },
      },
    ],
  });

  assert.equal(flattened.length, 2);
  assert.equal(flattened[0].number, 1);
  assert.equal(flattened[0].route.insightPath, "insights/product/alpha.md");
  assert.equal(flattened[1].number, 2);
  assert.equal(flattened[1].route.mode, "new");
});

test('selectRoutes supports "all", numeric arrays, and skip', () => {
  const routeSuggestions = {
    items: [
      {
        evidencePath: "evidence/research/one.md",
        suggestions: [
          {
            mode: "existing",
            evidencePath: "evidence/research/one.md",
            insightPath: "insights/product/alpha.md",
            description: "Alpha",
            reason: "Matched alpha",
          },
          {
            mode: "existing",
            evidencePath: "evidence/research/one.md",
            insightPath: "insights/product/beta.md",
            description: "Beta",
            reason: "Matched beta",
          },
        ],
      },
    ],
  };

  assert.deepEqual(
    selectRoutes({ routeSuggestions, selection: "all" }).routes.map((route) => route.insightPath),
    ["insights/product/alpha.md", "insights/product/beta.md"]
  );
  assert.deepEqual(
    selectRoutes({ routeSuggestions, selection: [2] }).routes.map((route) => route.insightPath),
    ["insights/product/beta.md"]
  );
  assert.deepEqual(selectRoutes({ routeSuggestions, selection: "skip" }).routes, []);
});

test("route-selection CLI emits insight-routing payloads from numbered selections", () => {
  const stdout = execFileSync("node", [ROUTE_SELECTION_SCRIPT], {
    input: JSON.stringify({
      selection: [2],
      routeSuggestions: {
        items: [
          {
            evidencePath: "evidence/research/dashboard.md",
            topic: "Dashboard",
            suggestions: [
              {
                mode: "existing",
                evidencePath: "evidence/research/dashboard.md",
                insightPath: "insights/product/shared-dashboard-alignment.md",
                description: "Shared dashboard alignment",
                reason: "Matched dashboard",
              },
            ],
            suggestedNewRoute: {
              mode: "new",
              evidencePath: "evidence/research/dashboard.md",
              insightPath: "insights/product/dashboard-signals.md",
              domain: "product",
              topic: "Dashboard Signals",
              description: "Seed dashboard signals",
              reason: "No exact existing match",
            },
          },
        ],
      },
    }),
    encoding: "utf8",
  });

  const result = JSON.parse(stdout);
  assert.equal(result.routes.length, 1);
  assert.equal(result.routes[0].mode, "new");
  assert.equal(result.routes[0].insightPath, "insights/product/dashboard-signals.md");
  assert.equal(result.selected[0].number, 2);
});

test("route-selection piped into insight-routing creates a new insight end-to-end", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-integration-"));
  const pmDir = path.join(root, "pm");
  try {
    fs.mkdirSync(path.join(pmDir, "evidence", "research"), { recursive: true });
    fs.mkdirSync(path.join(pmDir, "insights", "product"), { recursive: true });
    fs.writeFileSync(
      path.join(pmDir, "evidence", "research", "pipe-test.md"),
      [
        "---",
        'type: "evidence"',
        'evidence_type: "research"',
        'topic: "Pipe Test Evidence"',
        'source_origin: "internal"',
        'created: "2026-04-13"',
        'updated: "2026-04-13"',
        "sources: []",
        "cited_by: []",
        "---",
        "",
        "# Pipe Test Evidence",
        "",
        "## Summary",
        "",
        "Evidence for the pipe integration test.",
        "",
        "## Findings",
        "",
        "1. The pipe contract should be verified end-to-end.",
        "",
      ].join("\n")
    );

    const selectionPayload = {
      selection: "all",
      routeSuggestions: {
        items: [
          {
            evidencePath: "evidence/research/pipe-test.md",
            topic: "Pipe Test Evidence",
            suggestions: [],
            suggestedNewRoute: {
              mode: "new",
              evidencePath: "evidence/research/pipe-test.md",
              insightPath: "insights/product/pipe-test-topic.md",
              domain: "product",
              topic: "Pipe Test Topic",
              description: "Seeded from pipe integration test",
              reason: "No existing insight matched",
            },
          },
        ],
      },
    };

    const selectionStdout = execFileSync("node", [ROUTE_SELECTION_SCRIPT], {
      input: JSON.stringify(selectionPayload),
      encoding: "utf8",
    });
    const selectionResult = JSON.parse(selectionStdout);

    assert.equal(selectionResult.routes.length, 1);
    assert.equal(selectionResult.routes[0].mode, "new");

    const routingScript = path.join(__dirname, "..", "scripts", "insight-routing.js");
    const routingStdout = execFileSync(
      "node",
      [routingScript, "--pm-dir", pmDir, "--skip-hot-index"],
      {
        input: JSON.stringify({ routes: selectionResult.routes }),
        encoding: "utf8",
      }
    );
    const routingResult = JSON.parse(routingStdout);

    assert.equal(routingResult.routes[0].action, "created");
    assert.equal(routingResult.routes[0].insightPath, "insights/product/pipe-test-topic.md");
    assert.equal(routingResult.routes[0].addedCitation, true);

    const insightContent = fs.readFileSync(
      path.join(pmDir, "insights", "product", "pipe-test-topic.md"),
      "utf8"
    );
    assert.match(insightContent, /topic: "Pipe Test Topic"/);
    assert.match(insightContent, /sources:/);
    assert.match(insightContent, /evidence\/research\/pipe-test\.md/);

    const evidenceContent = fs.readFileSync(
      path.join(pmDir, "evidence", "research", "pipe-test.md"),
      "utf8"
    );
    assert.match(evidenceContent, /cited_by:/);
    assert.match(evidenceContent, /insights\/product\/pipe-test-topic\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
