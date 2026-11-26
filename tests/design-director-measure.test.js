"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const { analyzeModel, createMeasure, snippet } = require("../scripts/design-director-measure");

const SCRIPT = path.join(__dirname, "..", "scripts", "design-director-measure.js");

const BASE_STYLE = {
  display: "block",
  position: "static",
  color: "rgb(17, 24, 39)",
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "box-shadow": "none",
  "font-size": "14px",
  "font-weight": "400",
  "line-height": "20px",
  "letter-spacing": "normal",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-style": "none",
  "border-right-style": "none",
  "border-bottom-style": "none",
  "border-left-style": "none",
  "border-top-color": "rgb(0, 0, 0)",
  "border-right-color": "rgb(0, 0, 0)",
  "border-bottom-color": "rgb(0, 0, 0)",
  "border-left-color": "rgb(0, 0, 0)",
  "border-top-left-radius": "0px",
};

function el(i, parent, tag, rect, style = {}, extra = {}) {
  const [x, y, w, h] = rect;
  return { i, parent, tag, rect: { x, y, w, h }, style: { ...BASE_STYLE, ...style }, ...extra };
}

function padding(value) {
  return {
    "padding-top": value,
    "padding-right": value,
    "padding-bottom": value,
    "padding-left": value,
  };
}

function border(color = "rgb(229, 231, 235)") {
  const style = {};
  for (const side of ["top", "right", "bottom", "left"]) {
    style[`border-${side}-width`] = "1px";
    style[`border-${side}-style`] = "solid";
    style[`border-${side}-color`] = color;
  }
  return style;
}

const WHITE = { "background-color": "rgb(255, 255, 255)" };

test("sweep lists the one button whose padding differs from its peers", () => {
  const model = [
    el(0, -1, "body", [0, 0, 800, 600], WHITE),
    el(1, 0, "button", [16, 16, 80, 36], padding("8px"), { name: "Save" }),
    el(2, 0, "button", [112, 16, 80, 36], padding("8px"), { name: "Cancel" }),
    el(3, 0, "button", [208, 16, 80, 36], padding("8px"), { name: "Share" }),
    el(4, 0, "button", [304, 16, 88, 40], padding("10px"), { name: "Export" }),
  ];
  const result = createMeasure().sweepModel(model);
  const buttons = result.groups.find((group) => group.kind === "button");
  assert.equal(buttons.count, 4);
  assert.deepEqual(buttons.differing["padding-top"], [
    { value: "8px", count: 3 },
    { value: "10px", count: 1 },
  ]);
  assert.equal(result.outliers.length, 1, "one row per element");
  const outlier = result.outliers[0];
  assert.match(outlier.element, /Export/);
  assert.equal(outlier.peers, 4);
  assert.deepEqual(
    outlier.differs.find((row) => row.property === "padding-top"),
    { property: "padding-top", value: "10px", baseline: "8px" }
  );
  assert.ok(outlier.differs.some((row) => row.property === "height"));
  assert.ok(!("ok" in result) && !("passed" in result), "the sweep reports and never judges");
});

test("sweep shows two even variants as a distribution without calling either an outlier", () => {
  const primary = { "background-color": "rgb(37, 99, 235)" };
  const model = [
    el(0, -1, "body", [0, 0, 800, 600], WHITE),
    el(1, 0, "button", [16, 16, 80, 36], primary),
    el(2, 0, "button", [112, 16, 80, 36], primary),
    el(3, 0, "button", [208, 16, 80, 36], WHITE),
    el(4, 0, "button", [304, 16, 80, 36], WHITE),
  ];
  const result = createMeasure().sweepModel(model);
  const buttons = result.groups.find((group) => group.kind === "button");
  assert.equal(buttons.differing["background-color"].length, 2);
  assert.deepEqual(result.outliers, []);
});

test("insets report asymmetric padding, a stray left edge, an odd gap and mixed control heights", () => {
  const card = { ...WHITE, ...border(), ...padding("16px"), "padding-right": "24px" };
  const model = [
    el(0, -1, "body", [0, 0, 800, 600], WHITE),
    el(1, 0, "section", [20, 20, 400, 300], card),
    el(2, 1, "p", [36, 36, 300, 20], {}, { has_text: true, text: "First" }),
    el(3, 1, "p", [36, 64, 300, 20], {}, { has_text: true, text: "Second" }),
    el(4, 1, "p", [40, 92, 300, 20], {}, { has_text: true, text: "Third" }),
    el(5, 1, "p", [36, 132, 300, 20], {}, { has_text: true, text: "Fourth" }),
    el(6, 1, "div", [36, 160, 300, 40]),
    el(7, 6, "input", [36, 160, 200, 40], {}, { type: "text", name: "Message" }),
    el(8, 6, "button", [244, 164, 60, 32], {}, { name: "Send" }),
  ];
  const result = createMeasure().insetsModel(model);
  const container = result.containers_with_notes.find((row) => /^section/.test(row.element));
  assert.ok(container.notes.some((note) => /padding left 16px, right 24px/.test(note)));
  const edge = result.edge_deviations.find((row) => /Third/.test(row.element));
  assert.equal(edge.edge, "left");
  assert.equal(edge.delta_px, 4);
  const gap = result.gap_deviations.find((row) => /Third/.test(row.after));
  assert.equal(gap.gap_px, 20);
  assert.equal(gap.baseline_px, 8);
  assert.deepEqual(
    result.rows_with_mixed_control_heights[0].controls.map((control) => control.height_px),
    [40, 32]
  );
});

test("nesting reports doubled padding, a card inside a card and touching borders", () => {
  const card = { ...WHITE, ...border(), ...padding("16px") };
  const model = [
    el(0, -1, "body", [0, 0, 800, 600], WHITE),
    el(1, 0, "section", [20, 20, 400, 300], card),
    el(2, 1, "div", [37, 37, 366, 100], padding("16px")),
    el(3, 2, "article", [53, 53, 334, 60], { ...card }),
    el(4, 0, "ul", [20, 340, 400, 80]),
    el(5, 4, "li", [20, 340, 400, 40], {
      "border-bottom-width": "1px",
      "border-bottom-style": "solid",
      "border-bottom-color": "rgb(229, 231, 235)",
    }),
    el(6, 4, "li", [20, 380, 400, 40], {
      "border-top-width": "1px",
      "border-top-style": "solid",
      "border-top-color": "rgb(209, 213, 219)",
    }),
  ];
  const result = createMeasure().nestingModel(model);
  assert.equal(result.doubled_padding.length, 1);
  assert.deepEqual(result.doubled_padding[0].sides[0], {
    side: "top",
    outer_px: 16,
    inner_px: 16,
  });
  assert.equal(result.surface_inside_surface.length, 1);
  assert.match(result.surface_inside_surface[0].outer, /^section/);
  assert.match(result.surface_inside_surface[0].inner, /^article/);
  assert.ok(
    result.adjacent_borders.some((row) => row.kind === "bottom border meets the next top border")
  );
  const mixed = result.mixed_divider_colors.find((row) => /^ul/.test(row.container));
  assert.equal(mixed.colors.length, 2);
});

test("thresholds list low contrast, small targets and unnamed controls with their values", () => {
  const model = [
    el(0, -1, "body", [0, 0, 800, 600], WHITE),
    el(1, 0, "p", [16, 16, 300, 20], { color: "rgb(170, 170, 170)" }, { has_text: true }),
    el(2, 0, "p", [16, 48, 300, 20], {}, { has_text: true }),
    el(3, 0, "button", [16, 80, 16, 16], {}, { name: "" }),
    el(4, 0, "button", [48, 80, 44, 44], {}, { name: "Close" }),
  ];
  const result = createMeasure().thresholdsModel(model);
  assert.equal(result.low_contrast_text.length, 1);
  assert.equal(result.low_contrast_text[0].required, 4.5);
  assert.ok(result.low_contrast_text[0].ratio < 3);
  assert.equal(result.small_targets.length, 1);
  assert.equal(result.small_targets[0].minimum, 24);
  assert.equal(result.unnamed_controls.length, 1);
  assert.equal(createMeasure().thresholdsModel(model, { minTarget: 48 }).small_targets.length, 2);
});

test("contrast follows the WCAG formula", () => {
  const measure = createMeasure();
  const black = measure.parseColor("rgb(0, 0, 0)");
  const white = measure.parseColor("rgb(255, 255, 255)");
  assert.equal(measure.contrastRatio(black, white), 21);
  assert.equal(measure.parseColor("color(srgb 1 1 1 / 0.5)").a, 0.5);
  assert.equal(measure.parseColor("oklch(0.5 0.1 200)"), null);
});

test("a model without styles is measured for geometry and states the limit", () => {
  const model = [
    { tag: "Screen", rect: { x: 0, y: 0, w: 390, h: 844 } },
    { parent: 0, tag: "Card", surface: true, rect: { x: 16, y: 100, w: 358, h: 200 } },
    { parent: 1, tag: "Card", surface: true, rect: { x: 32, y: 116, w: 326, h: 80 } },
    { parent: 2, tag: "Text", content: true, rect: { x: 48, y: 132, w: 100, h: 20 } },
    {
      parent: 0,
      tag: "Button",
      interactive: true,
      name: "Back",
      rect: { x: 8, y: 50, w: 30, h: 30 },
    },
  ];
  const result = analyzeModel(model, { minTarget: 44 });
  assert.ok(!("sweep" in result));
  assert.equal(result.nesting.surface_inside_surface.length, 1);
  assert.equal(result.thresholds.small_targets.length, 1);
  assert.match(result.limits[0], /no style values/);
});

test("analyze rejects a model whose rectangles are missing", () => {
  assert.throws(() => analyzeModel([{ tag: "div" }]), /rect needs numeric/);
  assert.throws(() => analyzeModel({}), /must be an array/);
});

function fakePage() {
  const make = (tag, rect, style = {}, attributes = {}, text = "") => ({
    nodeType: 1,
    tagName: tag.toUpperCase(),
    id: attributes.id || "",
    className: attributes.class || "",
    children: [],
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    parentElement: null,
    textContent: text,
    style: { ...BASE_STYLE, ...style },
    getAttribute: (name) => (name in attributes ? attributes[name] : null),
    hasAttribute: (name) => name in attributes,
    getBoundingClientRect: () => ({
      left: rect[0],
      top: rect[1],
      width: rect[2],
      height: rect[3],
    }),
    querySelector: () => null,
  });
  const add = (parent, child) => {
    child.parentElement = parent;
    parent.children.push(child);
    parent.childNodes.push(child);
    return child;
  };
  const body = make("body", [0, 0, 800, 600], WHITE);
  const hidden = add(body, make("div", [0, 0, 100, 100], { display: "none" }));
  add(hidden, make("button", [0, 0, 10, 10], {}, {}, "Hidden"));
  add(body, make("button", [16, 16, 80, 36], padding("8px"), { id: "save" }, "Save"));
  add(body, make("button", [112, 16, 80, 36], padding("8px"), {}, "Cancel"));
  add(body, make("button", [208, 16, 80, 36], padding("8px"), {}, "Share"));
  add(body, make("button", [304, 16, 88, 40], padding("10px"), {}, "Export"));
  const elements = [];
  const visit = (element) => {
    elements.push(element);
    element.children.forEach(visit);
  };
  visit(body);
  const document = {
    body,
    documentElement: { scrollWidth: 800 },
    querySelector: (selector) =>
      selector.startsWith("#") ? elements.find((item) => item.id === selector.slice(1)) : null,
    elementFromPoint: () => null,
    getElementById: () => null,
  };
  const window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 2,
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: (element) => ({
      getPropertyValue: (name) => element.style[name] || "",
    }),
  };
  return { window, document };
}

test("the page snippet is self-contained, skips hidden elements and returns JSON", () => {
  const page = fakePage();
  const output = JSON.parse(vm.runInNewContext(snippet(), page));
  assert.deepEqual(Object.keys(output), ["sweep", "insets", "nesting", "thresholds"]);
  assert.equal(output.sweep.elements, 5);
  assert.equal(output.sweep.viewport.device_pixel_ratio, 2);
  assert.ok(output.sweep.outliers.some((row) => /Export/.test(row.element)));
  assert.equal(typeof page.window.__pmMeasure.point, "function");
});

test("the point query returns computed values and contrast for one element", () => {
  const page = fakePage();
  const output = JSON.parse(vm.runInNewContext(snippet("point('#save')"), page));
  assert.match(output.element, /^button#save/);
  assert.equal(output.padding.top, "8px");
  assert.equal(output.rect.h, 36);
  assert.equal(output.effective_background, "rgb(255, 255, 255)");
  assert.ok(output.contrast > 15);
  assert.match(output.ancestors[0].element, /^body/);
});

test("snippet refuses anything other than a measurement call", () => {
  assert.throws(() => snippet("standard(); fetch('https://example.test')"), /call must be one of/);
  assert.throws(() => snippet("alert(1)"), /call must be one of/);
});

test("the CLI prints the snippet and analyzes a model file", () => {
  const printed = spawnSync(process.execPath, [SCRIPT, "snippet", "nesting()"], {
    encoding: "utf8",
  });
  assert.equal(printed.status, 0);
  assert.match(printed.stdout, /window\.__pmMeasure\.nesting\(\)/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-measure-"));
  try {
    const file = path.join(dir, "model.json");
    fs.writeFileSync(file, JSON.stringify([{ tag: "Screen", rect: { x: 0, y: 0, w: 10, h: 10 } }]));
    const analyzed = spawnSync(process.execPath, [SCRIPT, "analyze", "--model", file], {
      encoding: "utf8",
    });
    assert.equal(analyzed.status, 0);
    assert.equal(JSON.parse(analyzed.stdout).insets.tool, "insets");
    assert.equal(spawnSync(process.execPath, [SCRIPT]).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
