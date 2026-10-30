"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { nativePopupStateRegion } = require("../scripts/lib/native-popup-content");

// The fields and dimensions follow the retained native Location picker
// observations. These are selector-contract fixtures, not capture attestations.
const ownerBounds = { x: 265, y: 105, width: 176, height: 32 };
const popupBounds = { x: 260, y: 136, width: 298, height: 253 };
const viewport = { inner_width: 1440, inner_height: 900, scroll_x: 0, scroll_y: 0 };
const role = (value) => ({ by: "role-name", value });
const owner = role("combobox:Location");
const dialog = role("dialog:Location");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fixture(leftState = "modal", rightState = "empty") {
  const observations = new Map();
  const make = (id, state) => {
    const all = [];
    const checks = [];
    const visible = (locator, nativeRole, bounds, backend, literal) => {
      all.push({ locator, expect: { kind: "visible" } });
      checks.push({
        label: `state assertion clause ${all.length}`,
        asserted_backend_node_id: backend,
        hit_backend_node_id: backend + 100,
        native_role: nativeRole,
        native_name_present: true,
        visual_bounds: { ...bounds },
        ...(nativeRole === "statictext" ? { native_name_sha256: hash(literal) } : {}),
      });
    };
    const attribute = (name, value) =>
      all.push({ locator: owner, expect: { kind: "attribute-equals", name, value } });
    visible(owner, "combobox", ownerBounds, 10);
    attribute("aria-expanded", state === "primary" ? "false" : "true");
    if (state === "primary") {
      all.push({ locator: dialog, expect: { kind: "absent" } });
    } else {
      const popupId = `popup-${id}`;
      attribute("aria-controls", popupId);
      const bounds = { ...popupBounds, height: state === "modal" ? 253 : 103 };
      visible(dialog, "dialog", bounds, 20);
      visible({ by: "id", value: popupId }, "dialog", bounds, 20);
      const literal = state === "empty" ? "No results found" : "All locations";
      const childRole = state === "empty" ? "statictext" : "option";
      visible(
        role(`${childRole}:${literal}`),
        childRole,
        { x: 278, y: 200, width: 140, height: 20 },
        30,
        literal
      );
      if (state === "keyboard") {
        const input = { by: "test-id", value: "query" };
        visible(input, "textbox", { x: 300, y: 150, width: 230, height: 28 }, 40);
        all.push({ locator: input, expect: { kind: "focused" } });
      }
    }
    if (state !== "primary")
      all.push({
        locator: role(state === "empty" ? "option:All locations" : "statictext:No results found"),
        expect: { kind: "absent" },
      });
    const assertion = { schema_version: 2, state, all };
    if (state === "keyboard")
      assertion.before_capture = [
        { kind: "caret-left", locator: { by: "test-id", value: "query" } },
      ];
    observations.set(id, {
      assertion,
      manifest: {
        page: {
          css_viewport: { ...viewport },
          state_assertion: { passed: true, visibility: { checks } },
        },
      },
    });
    return {
      capture: { id, width: 1440, height: 900, full_page: false },
      coverage: { state, subject_id: "records" },
    };
  };
  const left = make("left", leftState);
  const right = make("right", rightState);
  return { left, right, observations };
}

const before = (f) => f.observations.get("left");
const after = (f) => f.observations.get("right");
const result = (f) => nativePopupStateRegion(f.left, f.right, f.observations);
const check = (o, name) =>
  o.manifest.page.state_assertion.visibility.checks.find((x) => x.native_role === name);
const remove = (o, predicate) => {
  const old = o.assertion.all;
  const checks = o.manifest.page.state_assertion.visibility.checks;
  const kept = old.flatMap((guard, i) =>
    predicate(guard)
      ? []
      : [{ guard, check: checks.find((x) => x.label === `state assertion clause ${i + 1}`) }]
  );
  o.assertion.all = kept.map((x) => x.guard);
  o.manifest.page.state_assertion.visibility.checks = kept.flatMap((x, i) =>
    x.check ? [{ ...x.check, label: `state assertion clause ${i + 1}` }] : []
  );
};

for (const [a, b] of [
  ["primary", "modal"],
  ["modal", "primary"],
  ["modal", "empty"],
  ["empty", "keyboard"],
  ["keyboard", "empty"],
]) {
  test(`selects only native controlled-popup geometry for ${a}/${b}`, () => {
    assert.deepEqual(
      result(fixture(a, b)),
      popupBounds.height === 253 && (a === "modal" || b === "modal")
        ? popupBounds
        : { ...popupBounds, height: 103 }
    );
  });
}

test("independent generated popup IDs may differ when each native owner binding is exact", () => {
  const f = fixture();
  assert.notEqual(before(f).assertion.all[2].expect.value, after(f).assertion.all[2].expect.value);
  assert.deepEqual(result(f), popupBounds);
});

for (const [name, mutate] of [
  ["missing dialog guard", (f) => remove(after(f), (x) => x.locator.value === "dialog:Location")],
  ["unbound popup id", (f) => remove(after(f), (x) => x.locator.by === "id")],
  [
    "wrong controlled id",
    (f) => {
      after(f).assertion.all[2].expect.value = "foreign";
    },
  ],
  [
    "multiple controlled ids",
    (f) => {
      after(f).assertion.all[2].expect.value = "popup-right foreign";
    },
  ],
  [
    "id resolves to a different node",
    (f) => {
      after(f).manifest.page.state_assertion.visibility.checks[2].asserted_backend_node_id = 99;
    },
  ],
  [
    "wrong native dialog role",
    (f) => {
      check(after(f), "dialog").native_role = "generic";
    },
  ],
  [
    "unnamed native dialog",
    (f) => {
      check(after(f), "dialog").native_name_present = false;
    },
  ],
  ["missing expanded claim", (f) => remove(after(f), (x) => x.expect.name === "aria-expanded")],
  [
    "collapsed open owner",
    (f) => {
      after(f).assertion.all[1].expect.value = "false";
    },
  ],
  [
    "owner moved",
    (f) => {
      check(after(f), "combobox").visual_bounds.x++;
    },
  ],
  [
    "popup moved",
    (f) => {
      for (const c of after(f).manifest.page.state_assertion.visibility.checks.filter(
        (x) => x.native_role === "dialog"
      ))
        c.visual_bounds.y++;
    },
  ],
  [
    "child outside popup",
    (f) => {
      check(after(f), "statictext").visual_bounds.x = 800;
    },
  ],
  [
    "foreign text role",
    (f) => {
      check(after(f), "statictext").native_role = "generic";
    },
  ],
  [
    "wrong text hash",
    (f) => {
      check(after(f), "statictext").native_name_sha256 = hash("Other content");
    },
  ],
  [
    "missing text hash",
    (f) => {
      delete check(after(f), "statictext").native_name_sha256;
    },
  ],
  [
    "noninteger geometry",
    (f) => {
      check(after(f), "dialog").visual_bounds.x += 0.1;
    },
  ],
  [
    "offscreen popup",
    (f) => {
      check(after(f), "dialog").visual_bounds.x = 1430;
    },
  ],
  [
    "different CSS viewport",
    (f) => {
      after(f).manifest.page.css_viewport.scroll_y = 1;
    },
  ],
  [
    "different image dimensions",
    (f) => {
      f.right.capture.width = 1024;
    },
  ],
  [
    "full document image",
    (f) => {
      f.left.capture.full_page = true;
    },
  ],
  [
    "unproved state",
    (f) => {
      after(f).manifest.page.state_assertion.passed = false;
    },
  ],
  [
    "unexpected state",
    (f) => {
      f.right.coverage.state = "boundary";
    },
  ],
  [
    "different subject",
    (f) => {
      f.right.coverage.subject_id = "another-task";
    },
  ],
  [
    "duplicate visible check",
    (f) => {
      after(f).manifest.page.state_assertion.visibility.checks.push({
        ...check(after(f), "dialog"),
      });
    },
  ],
]) {
  test(`rejects popup proof with ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.equal(result(f), null);
  });
}

test("collapsed counterpart must explicitly prove absence of the same named popup", () => {
  const f = fixture("primary", "modal");
  remove(before(f), (x) => x.expect.kind === "absent");
  assert.equal(result(f), null);
});

test("keyboard popup must retain a visible native search input and native preparation", () => {
  for (const change of [
    (o) => remove(o, (x) => x.expect.kind === "focused"),
    (o) => {
      o.assertion.before_capture = [];
    },
    (o) => {
      check(o, "textbox").visual_bounds.x = 900;
    },
    (o) => {
      check(o, "textbox").native_role = "button";
    },
  ]) {
    const f = fixture("empty", "keyboard");
    change(after(f));
    assert.equal(result(f), null);
  }
});

test("the same semantic content cannot borrow popup chrome as changed-state proof", () => {
  const f = fixture();
  after(f).assertion.all[5].locator.value = "statictext:All locations";
  check(after(f), "statictext").native_name_sha256 = hash("All locations");
  assert.equal(result(f), null);
});

test("malformed or missing observations do not select a pixel region", () => {
  const f = fixture();
  for (const value of [null, {}, { assertion: {} }]) {
    f.observations.set("right", value);
    assert.equal(result(f), null);
  }
});

for (const reverse of [false, true]) {
  test(`identical multi-option content cannot supply state difference (${reverse})`, () => {
    const f = fixture("modal", "keyboard");
    for (const [id, o] of f.observations) {
      const index = o.assertion.all.length;
      o.assertion.all.push({
        locator: role("option:Another location"),
        expect: { kind: "visible" },
      });
      o.manifest.page.state_assertion.visibility.checks.push({
        label: `state assertion clause ${index + 1}`,
        asserted_backend_node_id: 50,
        hit_backend_node_id: 150,
        native_role: "option",
        native_name_present: true,
        visual_bounds: { x: 278, y: 220, width: 140, height: 18 },
      });
      if (reverse && id === "right") {
        // Native collection order does not change the semantic content set.
        o.assertion.all[index].locator = role("option:All locations");
        o.assertion.all[5].locator = role("option:Another location");
      }
    }
    assert.equal(result(f), null);
  });
}

test("different asserted subsets cannot prove a popup content transition", () => {
  const f = fixture("modal", "keyboard");
  // Both actual popups may contain both options. Positive guards do not claim
  // either is absent, even though each capture chooses a different guard.
  after(f).assertion.all[5].locator = role("option:Another location");
  assert.equal(result(f), null);
});

test("changed positive names still require an exact counterpart absence guard", () => {
  const f = fixture();
  remove(before(f), (x) => x.expect.kind === "absent");
  remove(after(f), (x) => x.expect.kind === "absent");
  assert.equal(result(f), null);
});

test("an unrelated absence cannot prove the visible semantic content changed", () => {
  const f = fixture();
  for (const o of f.observations.values())
    for (const guard of o.assertion.all)
      if (guard.expect.kind === "absent") guard.locator = role("option:Unrelated location");
  assert.equal(result(f), null);
});
