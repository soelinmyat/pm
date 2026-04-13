"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
