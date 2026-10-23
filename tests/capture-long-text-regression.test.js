"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { capture, skip } = require("./fixtures/native-capture-fixture");
const { accessibilityObservations } = require("../scripts/design-critique-capture-probe");

test("native capture accepts long response text beside named controls", { skip }, (t) => {
  const response = "The team completed the handover and recorded follow-up observations. ".repeat(
    24
  );
  assert.ok(response.length > 1000);
  const html = `<!doctype html><html lang="en"><body><main id="fixture" data-pm-state="primary"><h1>Review the site handover</h1><p>${response}</p><button>Inspect the signature</button></main></body></html>`;
  const result = capture(t, html, [
    {
      locator: { by: "role-name", value: "heading:Review the site handover" },
      expect: { kind: "visible" },
    },
  ]);
  assert.deepEqual(
    result.accessibility_observations.controls.map(({ role, name }) => ({ role, name })),
    [{ role: "button", name: "Inspect the signature" }]
  );
  assert.equal(result.accessibility_observations.landmarks[0].role, "main");
});

for (const role of ["button", "navigation", "dialog", "menu", "listbox"]) {
  test(`exported ${role} names retain the 1000-character bound`, () => {
    const model = [
      { index: 0, backendNodeId: 1, parentIndex: -1, nodeName: "div", attributes: { id: "node" } },
    ];
    const tree = {
      nodes: [
        {
          nodeId: "node",
          backendDOMNodeId: 1,
          role: { value: role },
          name: { value: "x".repeat(1001) },
          properties: [],
        },
      ],
    };
    tree.nodes[0].name.value = "x".repeat(1000);
    assert.doesNotThrow(() => accessibilityObservations(tree, model));
    tree.nodes[0].name.value += "x";
    assert.throws(() => accessibilityObservations(tree, model), /accessible name exceeds 1000/);
  });
}

test("native capture still rejects an oversized accessible button name", { skip }, (t) => {
  const html = `<!doctype html><html lang="en"><body><main id="fixture" data-pm-state="primary"><h1>Review the site handover</h1><button aria-label="${"x".repeat(1001)}">Inspect the signature</button></main></body></html>`;
  assert.throws(() => capture(t, html, []), /accessible name exceeds 1000/);
});
