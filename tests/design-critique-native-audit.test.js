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
  assert.throws(() => normalize(input), /unknown field|is required/);
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

function noninteractiveRaw() {
  const input = raw();
  input.observations.controls = [];
  input.observations.native_scope = {
    kind: "noninteractive-change",
    reason:
      "The changed submission loading body contains skeleton rows only; the shared navigation control is unchanged.",
  };
  return input;
}

test("native noninteractive scope measures screen geometry without interaction certificates", () => {
  const input = noninteractiveRaw();
  const audit = normalize(input);
  assert.deepEqual(audit.controls, []);
  assert.deepEqual(audit.native_scope, input.observations.native_scope);
  assert.deepEqual(audit.checks, { native_screen: true });
  assert.equal(audit.checks.names, undefined);
  assert.equal(audit.checks.touch_targets, undefined);
  assert.match(
    audit.limitations.join(" "),
    /No interaction, accessible-name or touch-target certificate/
  );
  input.observations.hierarchy.attributes.bounds = "[0,0][401,874]";
  assert.deepEqual(normalize(input).checks, { native_screen: false });
});

test("native noninteractive scope must be explicit, bounded and exclusive of controls", () => {
  for (const mutate of [
    (input) => {
      delete input.observations.native_scope;
    },
    (input) => {
      input.observations.native_scope = null;
    },
    (input) => {
      input.observations.native_scope.reason = "Not applicable";
    },
    (input) => {
      input.observations.native_scope.reason = " ".repeat(80);
    },
    (input) => {
      input.observations.native_scope.reason = "x".repeat(2001);
    },
    (input) => {
      input.observations.native_scope.kind = "skip-accessibility";
    },
    (input) => {
      input.observations.native_scope.approved = true;
    },
    (input) => {
      input.observations.controls = [{ by: "id", value: "category" }];
    },
    (input) => {
      input.observations.platform = "maestro-android";
    },
  ]) {
    const input = noninteractiveRaw();
    mutate(input);
    assert.throws(() => normalize(input));
  }
});

function repeatedControlsRaw() {
  const input = raw();
  const second = JSON.parse(JSON.stringify(input.observations.hierarchy.children[0]));
  second.attributes.bounds = "[200,120][340,164]";
  input.observations.hierarchy.children.push(second);
  return input;
}

test("native occurrence selectors select actual ordered repeated controls", () => {
  const input = repeatedControlsRaw();
  input.observations.controls = [
    { by: "id", value: "category", occurrence: 0 },
    { by: "id", value: "category", occurrence: 1 },
  ];
  assert.deepEqual(normalize(input).checks, {
    native_screen: true,
    names: true,
    touch_targets: true,
  });
  input.observations.hierarchy.children[1].attributes.bounds = "[200,120][240,160]";
  const audit = normalize(input);
  assert.ok(
    audit.findings.some(
      (finding) => finding.code === "small-touch-target" && finding.locator === "id:category#1"
    )
  );
  input.observations.controls = [{ by: "id", value: "category", occurrence: 0 }];
  assert.deepEqual(normalize(input).findings, []);
});

test("native occurrence selectors cannot hide ambiguity, missing nodes or duplicate scope", () => {
  const input = repeatedControlsRaw();
  assert.ok(
    normalize(input).findings.some((finding) => finding.code === "ambiguous-native-control")
  );
  input.observations.controls = [{ by: "id", value: "category", occurrence: 2 }];
  assert.ok(
    normalize(input).findings.some(
      (finding) => finding.code === "native-control-occurrence-out-of-range"
    )
  );
  input.observations.hierarchy.children.pop();
  input.observations.controls[0].occurrence = 0;
  assert.ok(
    normalize(input).findings.some((finding) => finding.code === "unnecessary-native-occurrence")
  );
  input.observations.controls[0].value = "missing";
  assert.ok(normalize(input).findings.some((finding) => finding.code === "missing-native-control"));
  for (const controls of [
    [{ by: "id", value: "category", occurrence: -1 }],
    [{ by: "id", value: "category", occurrence: 0.5 }],
    [{ by: "id", value: "category", occurrence: 100 }],
    [{ by: "id", value: "category", occurrence: "0" }],
    [
      { by: "id", value: "category", occurrence: 0 },
      { occurrence: 0, value: "category", by: "id" },
    ],
    [
      { by: "id", value: "category" },
      { by: "id", value: "category", occurrence: 0 },
    ],
    [
      { by: "id", value: "category", occurrence: 0 },
      { by: "id", value: "category" },
    ],
  ]) {
    const fixture = repeatedControlsRaw();
    fixture.observations.controls = controls;
    assert.throws(() => normalize(fixture));
  }
});

test("native default and occurrence aliases cannot certify the same actual node twice", () => {
  const input = repeatedControlsRaw();
  input.observations.hierarchy.children[1].attributes.accessibilityText = "Second category";
  input.observations.controls = [
    { by: "label", value: "Category, All" },
    { by: "id", value: "category", occurrence: 0 },
  ];
  assert.ok(
    normalize(input).findings.some((finding) => finding.code === "duplicate-native-control")
  );
});

test("disabled declared controls still fail when outside the captured viewport", () => {
  const input = raw();
  Object.assign(input.observations.hierarchy.children[0].attributes, {
    enabled: "false",
    bounds: "[0,900][100,1000]",
  });
  const audit = normalize(input);
  assert.equal(audit.checks.touch_targets, false);
  assert.deepEqual(
    audit.findings.map((finding) => finding.code),
    ["clipped-touch-target"]
  );
  input.observations.hierarchy.children[0].attributes.bounds = "[16,120][40,140]";
  assert.equal(normalize(input).checks.touch_targets, true);
});

test("native adapter names unknown observation fields", () => {
  const input = raw();
  input.observations.focus_order = [];
  assert.throws(() => normalize(input), /native observations\.focus_order is an unknown field/);
});
