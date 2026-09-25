"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { normalizeAuditBytes } = require("../scripts/design-critique-audit-normalize");

function raw() {
  return {
    schema_version: 2,
    kind: "accessibility-tree",
    subject_id: "actions",
    commit: "a".repeat(40),
    capture_ids: ["actions-primary"],
    observations: {
      platform: "maestro-ios",
      viewport: { width: 402, height: 874, scale: 3 },
      controls: [{ by: "id", value: "category" }],
      hierarchy: {
        attributes: { bounds: "[0,0][402,874]" },
        children: [
          {
            attributes: {
              "resource-id": "category",
              accessibilityText: "Category, All",
              bounds: "[16,120][142,164]",
              enabled: "true",
              selected: "false",
              focused: "false",
              checked: "false",
            },
            children: [],
          },
        ],
      },
    },
  };
}

function normalize(input) {
  const bytes = Buffer.from(JSON.stringify(input));
  return normalizeAuditBytes(bytes, {
    path: "evidence/native-raw.json",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}

test("native hierarchy certifies only measured scoped names and touch targets", () => {
  const audit = normalize(raw());
  assert.deepEqual(audit.checks, { native_screen: true, names: true, touch_targets: true });
  assert.equal(audit.platform, "maestro-ios");
  assert.equal(audit.checks.focus_order, undefined);
  assert.match(audit.limitations.join(" "), /VoiceOver/);
  assert.deepEqual(audit.controls, [{ by: "id", value: "category" }]);
});

test("native audit fails missing labels, small or clipped targets and missing controls", () => {
  for (const [field, value, code] of [
    ["accessibilityText", "", "missing-accessible-name"],
    ["bounds", "[16,120][142,150]", "small-touch-target"],
    ["bounds", "[390,120][450,164]", "clipped-touch-target"],
    ["resource-id", "different", "missing-native-control"],
  ]) {
    const input = raw();
    input.observations.hierarchy.children[0].attributes[field] = value;
    const audit = normalize(input);
    assert.ok(
      audit.findings.some((finding) => finding.code === code),
      code
    );
  }
});

test("native adapter rejects ambiguous, empty and fabricated web-shaped evidence", () => {
  const input = raw();
  input.observations.controls = [];
  assert.throws(() => normalize(input), /controls/);
  input.observations.controls = [{ by: "id", value: "category" }];
  input.observations.hierarchy.children.push(input.observations.hierarchy.children[0]);
  assert.ok(
    normalize(input).findings.some((finding) => finding.code === "ambiguous-native-control")
  );
  input.observations.tab_index = 0;
  assert.throws(() => normalize(input), /unexpected|fields/);
});

test("native selector identity does not depend on JSON property order", () => {
  const input = raw();
  input.observations.controls.push({ value: "category", by: "id" });
  assert.throws(() => normalize(input), /must be unique/);
});

test("native adapter validates finite viewport, bounds, booleans and payload depth", () => {
  for (const mutate of [
    (input) => {
      input.observations.viewport.scale = 0;
    },
    (input) => {
      input.observations.hierarchy.children[0].attributes.bounds = "garbage";
    },
    (input) => {
      input.observations.hierarchy.children[0].attributes.enabled = "maybe";
    },
    (input) => {
      let node = input.observations.hierarchy;
      for (let index = 0; index < 102; index++) {
        node.children = [{ attributes: {}, children: [] }];
        node = node.children[0];
      }
    },
  ]) {
    const input = raw();
    mutate(input);
    assert.throws(() => normalize(input));
  }
});

test("accepts Maestro node state flags but rejects contradictory duplicates", () => {
  const input = raw();
  const node = input.observations.hierarchy.children[0];
  Object.assign(node, { enabled: true, focused: false, selected: false, checked: false });
  assert.equal(normalize(input).checks.native_screen, true);
  node.enabled = false;
  assert.throws(() => normalize(input), /agree with attributes/);
});

test("uses node-only enabled state when no duplicate attribute is present", () => {
  for (const enabled of [true, false]) {
    const input = raw();
    const node = input.observations.hierarchy.children[0];
    delete node.attributes.enabled;
    node.enabled = enabled;
    if (!enabled) node.attributes.bounds = "[16,120][36,140]";
    const audit = normalize(input);
    assert.deepEqual(audit.findings, []);
  }
});

test("native audits require measured screen, control state, and enabled bounds", () => {
  for (const [mutate, code] of [
    [
      (input) => {
        input.observations.hierarchy.attributes.bounds = "[0,0][401,874]";
      },
      "missing-native-screen",
    ],
    [
      (input) => {
        delete input.observations.hierarchy.children[0].attributes.enabled;
      },
      "missing-native-state",
    ],
    [
      (input) => {
        delete input.observations.hierarchy.children[0].attributes.bounds;
      },
      "missing-native-bounds",
    ],
  ]) {
    const input = raw();
    mutate(input);
    assert.ok(
      normalize(input).findings.some((finding) => finding.code === code),
      code
    );
  }
});

test("native envelopes reject unsupported platforms and web audit substitution", () => {
  const platform = raw();
  platform.observations.platform = "maestro-android";
  assert.throws(() => normalize(platform), /unsupported native platform/);
  const dom = raw();
  dom.kind = "dom-audit";
  assert.throws(() => normalize(dom), /requires native accessibility-tree/);
  const legacy = raw();
  legacy.schema_version = 1;
  assert.throws(() => normalize(legacy), /unknown field/);
});
