const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const original = require("node:path").resolve(
  __dirname,
  "../scripts/design-critique-capture-probe.js"
);
const moduleUnderTest = new Module(original, module);
moduleUnderTest.filename = original;
moduleUnderTest.paths = Module._nodeModulePaths(require("node:path").dirname(original));
moduleUnderTest._compile(fs.readFileSync(process.env.PM_TEST_PROBE || original, "utf8"), original);
const { domObservations } = moduleUnderTest.exports;
const names = [
  "display",
  "visibility",
  "opacity",
  "font-weight",
  "border-top-color",
  "overflow",
  "overflow-x",
  "overflow-y",
  "content-visibility",
];
const styles = (active = false) =>
  names.map(
    (n) =>
      ({
        display: "block",
        visibility: "visible",
        opacity: "1",
        "font-weight": active ? "600" : "500",
        "border-top-color": active ? "rgb(4, 72, 67)" : "rgba(0, 0, 0, 0)",
        overflow: "visible",
        "overflow-x": "visible",
        "overflow-y": "visible",
        "content-visibility": "visible",
      })[n]
  );
const root = {
  index: 0,
  backendNodeId: 1,
  parentIndex: -1,
  nodeName: "main",
  attributes: {},
  layout: { bounds: [0, 0, 400, 300], styles: styles() },
};
function tab(i, selected, activeStyle, attributes = {}) {
  return {
    index: i + 1,
    backendNodeId: i + 2,
    parentIndex: 0,
    nodeName: "button",
    attributes: {
      id: `tab-${i}`,
      role: "tab",
      class: "data-[state=active]:font-semibold data-[state=active]:border-primary",
      "data-state": selected ? "active" : "inactive",
      "aria-selected": String(selected),
      ...attributes,
    },
    layout: { bounds: [10 + i * 130, 10, 120, 30], styles: styles(activeStyle) },
  };
}
const metrics = {
  cssLayoutViewport: { clientWidth: 400, clientHeight: 300 },
  cssVisualViewport: { pageX: 0, pageY: 0, clientWidth: 400, clientHeight: 300 },
  cssContentSize: { width: 400, height: 300 },
};
const inspect = (nodes) => domObservations([root, ...nodes], metrics, names).consistency;
test("selected and inactive tabs remain intentional visual states", () =>
  assert.deepEqual(inspect([tab(0, true, true), tab(1, false, false)]), []));
test("two selected tabs with style drift remain flagged", () =>
  assert.equal(inspect([tab(0, true, true), tab(1, true, false)]).length, 2));
test("two inactive tabs with style drift remain flagged", () =>
  assert.equal(inspect([tab(0, false, true), tab(1, false, false)]).length, 2));
test("arbitrary data-state cannot hide drift", () =>
  assert.equal(
    inspect([
      tab(0, true, true, { "aria-selected": "", "data-state": "one" }),
      tab(1, false, false, { "aria-selected": "", "data-state": "two" }),
    ]).length,
    2
  ));
test("aria-selected on ordinary action buttons cannot hide drift", () =>
  assert.equal(
    inspect([tab(0, true, true, { role: "button" }), tab(1, false, false, { role: "button" })])
      .length,
    2
  ));

test("checked radio state is intentional but same-state drift remains flagged", () => {
  assert.deepEqual(
    inspect([
      tab(0, false, true, { role: "radio", "aria-checked": "true" }),
      tab(1, false, false, { role: "radio", "aria-checked": "false" }),
    ]),
    []
  );
  assert.equal(
    inspect([
      tab(0, false, true, { role: "radio", "aria-checked": "true" }),
      tab(1, false, false, { role: "radio", "aria-checked": "true" }),
    ]).length,
    2
  );
  assert.equal(
    inspect([
      tab(0, false, true, { role: "button", "aria-checked": "true" }),
      tab(1, false, false, { role: "button", "aria-checked": "false" }),
    ]).length,
    2
  );
});

function pressedButton(i, pressed, activeStyle, role = "button") {
  return tab(i, false, activeStyle, {
    role,
    "data-component": "PaneListItem",
    "data-variant": "default",
    "aria-pressed": pressed,
  });
}
for (const role of ["button", ""]) {
  test(`pressed state separates declared ${role || "native button"} variants`, () => {
    assert.deepEqual(
      inspect([pressedButton(0, "true", true, role), pressedButton(1, "false", false, role)]),
      []
    );
    assert.deepEqual(
      inspect([pressedButton(0, "mixed", true, role), pressedButton(1, "false", false, role)]),
      []
    );
    assert.equal(
      inspect([pressedButton(0, "true", true, role), pressedButton(1, "true", false, role)]).length,
      2
    );
  });
}
test("invalid pressed values and non-button roles cannot hide drift", () => {
  assert.equal(inspect([pressedButton(0, "yes", true), pressedButton(1, "no", false)]).length, 2);
  assert.equal(
    inspect([pressedButton(0, "true", true, "radio"), pressedButton(1, "false", false, "radio")])
      .length,
    2
  );
});
