"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { normalizeAuditBytes } = require("../scripts/design-critique-audit-normalize");

function raw() {
  return {
    schema_version: 1,
    kind: "accessibility-tree",
    subject_id: "account-menu",
    commit: "a".repeat(40),
    capture_ids: ["capture-account-menu"],
    observations: {
      landmarks: [],
      controls: ["Profile", "Settings", "Sign out"].map((name, index) => ({
        role: "menuitem",
        name,
        locator: `#item-${index}`,
        disabled: false,
        tab_index: -1,
        document_index: index,
        focus_context: "composite",
      })),
      popups: [
        {
          role: "menu",
          name: "Review owner",
          locator: "#menu",
          contains_focus: true,
          background_main_hidden: true,
          keyboard_navigation_verified: true,
          member_locators: ["#item-0", "#item-1", "#item-2"],
        },
      ],
    },
  };
}
function normalize(value) {
  const bytes = Buffer.from(JSON.stringify(value));
  return normalizeAuditBytes(bytes, {
    path: "evidence/menu-raw.json",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}
test("a fully verified isolated named menu has valid popup landmark scope", () => {
  assert.deepEqual(normalize(raw()).checks, { landmarks: true, names: true, focus_order: true });
});
for (const field of ["contains_focus", "background_main_hidden", "keyboard_navigation_verified"]) {
  test(`popup scope requires ${field}`, () => {
    const value = raw();
    value.observations.popups[0][field] = false;
    assert.equal(normalize(value).checks.landmarks, false);
  });
}
test("a declared popup boolean cannot excuse document-only negative tab indexes", () => {
  const value = raw();
  value.observations.controls.forEach((control) => {
    control.focus_context = "document";
  });
  assert.equal(normalize(value).checks.landmarks, false);
  assert.equal(normalize(value).checks.focus_order, false);
});
test("popup scope rejects missing members or interactive controls outside the menu", () => {
  const value = raw();
  value.observations.popups[0].member_locators.pop();
  assert.equal(normalize(value).checks.landmarks, false);
  const other = raw();
  other.observations.controls.push({
    role: "button",
    name: "Other",
    locator: "#other",
    disabled: false,
    tab_index: 0,
    document_index: 3,
  });
  assert.equal(normalize(other).checks.landmarks, false);
});
test("popup scope retains ambiguous popup and multiple-main failures", () => {
  const value = raw();
  value.observations.popups.push({ ...value.observations.popups[0], locator: "#other-menu" });
  assert.equal(normalize(value).checks.landmarks, false);
  const other = raw();
  other.observations.landmarks = [
    { role: "main", name: "First", locator: "#first" },
    { role: "main", name: "Second", locator: "#second" },
  ];
  assert.equal(normalize(other).checks.landmarks, false);
});
test("unnamed and malformed popup evidence remains invalid", () => {
  const value = raw();
  value.observations.popups[0].name = "";
  assert.equal(normalize(value).checks.names, false);
  const malformed = raw();
  malformed.observations.popups = null;
  assert.throws(() => normalize(malformed), /raw accessibility popups must contain/);
  const duplicate = raw();
  duplicate.observations.popups[0].member_locators.push("#item-0");
  assert.throws(() => normalize(duplicate), /unique/);
});
test("legacy document observations retain their existing checks without popup evidence", () => {
  const value = raw();
  delete value.observations.popups;
  value.observations.landmarks = [{ role: "main", name: "", locator: "main" }];
  assert.deepEqual(normalize(value).checks, { landmarks: true, names: true, focus_order: true });
});

function listboxRaw() {
  const value = raw();
  value.observations.popups[0].role = "listbox";
  value.observations.popups[0].owner = { role: "combobox", name: "Language", locator: "#trigger" };
  value.observations.controls.forEach((control) => {
    control.role = "option";
  });
  return value;
}
test("verified isolated listbox options have valid popup landmark scope", () => {
  assert.deepEqual(normalize(listboxRaw()).checks, {
    landmarks: true,
    names: true,
    focus_order: true,
  });
});
for (const field of ["contains_focus", "background_main_hidden", "keyboard_navigation_verified"]) {
  test(`listbox scope requires ${field}`, () => {
    const value = listboxRaw();
    value.observations.popups[0][field] = false;
    assert.equal(normalize(value).checks.landmarks, false);
  });
}
test("listbox proof rejects document-only options, foreign members and unsupported popup roles", () => {
  const value = listboxRaw();
  value.observations.controls[1].focus_context = "document";
  assert.equal(normalize(value).checks.landmarks, false);
  assert.equal(normalize(value).checks.focus_order, false);
  const foreign = listboxRaw();
  foreign.observations.controls[1].role = "menuitem";
  assert.equal(normalize(foreign).checks.landmarks, false);
  const unsupported = listboxRaw();
  unsupported.observations.popups[0].role = "tree";
  delete unsupported.observations.popups[0].owner;
  assert.throws(() => normalize(unsupported), /role must be menu or listbox/);
});
test("listbox proof rejects unknown schema fields and mismatched member locators", () => {
  const extra = listboxRaw();
  extra.observations.popups[0].synthetic_label = "Language";
  assert.throws(() => normalize(extra), /unexpected|unknown|only|unsupported/);
  const mismatched = listboxRaw();
  mismatched.observations.popups[0].member_locators[0] = "#foreign";
  assert.equal(normalize(mismatched).checks.landmarks, false);
});

test("unnamed native listbox keeps its raw name while measured named combobox proves context", () => {
  const value = listboxRaw();
  value.observations.popups[0].name = "";
  assert.deepEqual(normalize(value).checks, { landmarks: true, names: true, focus_order: true });
  assert.equal(value.observations.popups[0].name, "");
  const missing = listboxRaw();
  delete missing.observations.popups[0].owner;
  assert.equal(normalize(missing).checks.landmarks, false);
  missing.observations.popups[0].name = "";
  assert.equal(normalize(missing).checks.names, false);
  const unnamed = listboxRaw();
  unnamed.observations.popups[0].owner.name = "";
  unnamed.observations.popups[0].name = "";
  assert.equal(normalize(unnamed).checks.landmarks, false);
  assert.equal(normalize(unnamed).checks.names, false);
});
test("owner observations have a closed combobox-only schema", () => {
  const extra = listboxRaw();
  extra.observations.popups[0].owner.synthetic_label = "Language";
  assert.throws(() => normalize(extra));
  const wrong = listboxRaw();
  wrong.observations.popups[0].owner.role = "button";
  assert.throws(() => normalize(wrong), /role must be combobox/);
  const menu = raw();
  menu.observations.popups[0].owner = { role: "combobox", name: "Language", locator: "#trigger" };
  assert.throws(() => normalize(menu), /supported only for listbox/);
});
