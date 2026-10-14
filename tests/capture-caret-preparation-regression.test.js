"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { capture, skip } = require("./fixtures/native-capture-fixture");
const { validateCaptureActions } = require("../scripts/design-critique-capture");
const action = { kind: "caret-left", locator: { by: "id", value: "entry" } };
function html(scenario = "text") {
  const type = ["search", "password", "email", "number"].includes(scenario) ? scenario : "text";
  const readonly =
      scenario === "readonly"
        ? "readonly"
        : scenario === "aria-readonly"
          ? 'aria-readonly="true"'
          : "",
    disabled =
      scenario === "disabled"
        ? "disabled"
        : scenario === "aria-disabled"
          ? 'aria-disabled="true"'
          : "";
  const element =
    scenario === "textarea"
      ? '<textarea id="entry" aria-label="Name">Stable value</textarea>'
      : `<input id="entry" aria-label="Name" type="${type}" value="Stable value" ${readonly} ${disabled}>`;
  const duplicate = scenario === "duplicate" ? '<input id="entry" hidden value="Other">' : "";
  const effect =
    scenario === "delayed-value-drift"
      ? "setTimeout(()=>{entry.value='Changed value';},100);"
      : scenario === "delayed-identity-drift"
        ? "setTimeout(()=>entry.setAttribute('aria-label','Changed label'),100);"
        : scenario === "delayed-readonly-drift"
          ? "setTimeout(()=>{entry.readOnly=true;},100);"
          : scenario === "delayed-foreign-focus"
            ? "setTimeout(()=>other.focus(),100);"
            : scenario === "value-drift"
              ? "entry.value='Changed value';"
              : scenario === "foreign-focus"
                ? "other.focus();"
                : scenario === "identity-drift"
                  ? "entry.setAttribute('aria-label','Different field');"
                  : scenario === "type-drift"
                    ? "entry.type='password';"
                    : scenario === "readonly-drift"
                      ? "entry.readOnly=true;"
                      : scenario === "replacement"
                        ? "const replacement=entry.cloneNode(true);entry.replaceWith(replacement);replacement.focus();"
                        : "";
  return `<!doctype html><html lang="en"><head><style>body{font:16px Arial;padding:24px}h1{font-size:24px}input,textarea{font:16px Arial;padding:8px}</style></head><body><main id="fixture" data-pm-state="primary"><h1>Edit your profile details</h1><p>Your saved name appears in team conversations.</p>${element}${duplicate}<input id="other" aria-label="Other field" value="Other"><script>const entry=document.querySelector('#entry'),other=document.querySelector('#other');${scenario === "unfocused" ? "other.focus();" : "entry.focus();"}if(entry.setSelectionRange&&['text','search','password'].includes(entry.type))entry.setSelectionRange(entry.value.length,entry.value.length);entry.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'&&event.isTrusted){${effect}entry.setAttribute('data-native-left','true');other.setAttribute('aria-label','Trusted ArrowLeft');}});</script></main></body></html>`;
}
const visible = [{ locator: { by: "id", value: "entry" }, expect: { kind: "visible" } }];
for (const scenario of ["text", "search"]) {
  test(
    `caret preparation uses a genuine native ArrowLeft in focused ${scenario}`,
    { skip },
    async (t) => {
      const result = capture(t, html(scenario), visible, [action]);
      assert.equal(result.assertion_passed, true);
      assert.ok(
        result.accessibility_observations.controls.some(
          (node) => node.locator === "input#other" && node.name === "Trusted ArrowLeft"
        )
      );
    }
  );
}
for (const scenario of [
  "unfocused",
  "duplicate",
  "disabled",
  "readonly",
  "password",
  "email",
  "number",
  "textarea",
  "value-drift",
  "foreign-focus",
  "identity-drift",
  "type-drift",
  "readonly-drift",
  "replacement",
  "delayed-value-drift",
  "delayed-identity-drift",
  "delayed-readonly-drift",
  "delayed-foreign-focus",
  "aria-readonly",
  "aria-disabled",
]) {
  test(`caret preparation rejects ${scenario}`, { skip }, async (t) => {
    assert.throws(() => capture(t, html(scenario), visible, [action]), /caret preparation/);
  });
}
test("caret preparation actions have a closed non-executable schema", () => {
  assert.doesNotThrow(() => validateCaptureActions([action]));
  for (const malformed of [
    { ...action, expression: "entry.focus()" },
    { ...action, count: 2 },
    { kind: "caret-left", locator: { by: "css", value: "input" } },
    { kind: "caret-left", locator: { by: "id", value: "" } },
  ])
    assert.throws(() => validateCaptureActions([malformed]));
});

test(
  "a declared later Tab may move focus while preserving the caret field value",
  { skip },
  async (t) => {
    const result = capture(t, html("text"), visible, [
      action,
      { kind: "tab", count: 1, reverse: false },
    ]);
    assert.equal(result.assertion_passed, true);
  }
);
