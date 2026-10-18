"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { capture, captureArtifacts, skip } = require("./fixtures/native-capture-fixture");
const { validateCaptureActions } = require("../scripts/design-critique-capture");
const { inspectPngVisualBytes } = require("../scripts/lib/media-inspect");
const action = { kind: "focus-modality", locator: { by: "id", value: "entry" } };
const visible = [{ locator: { by: "id", value: "entry" }, expect: { kind: "focused" } }];
function html(scenario = "region") {
  const effect =
    {
      replacement: "const next=entry.cloneNode(true);entry.replaceWith(next);next.focus();",
      focus: "other.focus();",
      label: "entry.setAttribute('aria-label','Changed context');",
      text: "entry.textContent='Changed content';",
      value: "other.value='Changed value';",
      structure: "other.remove();",
      attribute: "entry.setAttribute('data-mutated','true');",
      editable: "entry.contentEditable='true';",
      delayed: "setTimeout(()=>entry.setAttribute('aria-label','Changed later'),100);",
      "delayed-focus": "setTimeout(()=>other.focus(),100);",
      "hidden-value": "document.querySelector('#hidden').value='Changed hidden value';",
      "delayed-text": "setTimeout(()=>entry.textContent='Changed later',100);",
    }[scenario] || "";
  const target = ["input", "input-region"].includes(scenario)
    ? `<input id="entry" aria-label="Condition" value="Private value" ${scenario === "input-region" ? 'role="region" tabindex="-1"' : ""}>`
    : `<section id="entry" role="${scenario === "heading" ? "heading" : "region"}" ${scenario === "unnamed" ? "" : 'aria-label="Condition"'} tabindex="${scenario === "tabstop" ? "0" : "-1"}" ${scenario === "contenteditable" ? 'contenteditable="true"' : ""}>Room condition is awaiting telemetry.</section>`;
  return `<!doctype html><html lang="en"><head><style>body{font:16px Arial;padding:24px}#entry{padding:16px;outline:none}#entry:focus-visible{outline:3px solid blue}</style></head><body><main id="fixture" data-pm-state="primary"><h1>Room details</h1>${target}${scenario === "duplicate" ? '<div id="entry" hidden></div>' : ""}<input id="other" aria-label="Other" value="Saved value"><input id="hidden" type="hidden" value="Saved hidden value"><script>const entry=document.querySelector('#entry'),other=document.querySelector('#other');${scenario === "unfocused" ? "other.focus();" : "entry.focus();"}entry.addEventListener('keydown',event=>{if(event.key==='Shift'&&event.isTrusted){${effect}}});</script></main></body></html>`;
}
for (const scenario of ["region", "heading"]) {
  test(
    `native Shift retains focused non-tabstop ${scenario} and observes its ring`,
    { skip },
    (t) => {
      const { result, screenshot } = captureArtifacts(t, html(scenario), visible, [action]);
      assert.equal(result.assertion_passed, true);
      const withoutRing = captureArtifacts(
        t,
        html(scenario).replace("outline:3px solid blue", "outline:none"),
        visible,
        [action]
      );
      assert.notEqual(
        inspectPngVisualBytes(screenshot).pixelSha256,
        inspectPngVisualBytes(withoutRing.screenshot).pixelSha256
      );
    }
  );
}
for (const scenario of [
  "unfocused",
  "unnamed",
  "tabstop",
  "input",
  "input-region",
  "contenteditable",
  "duplicate",
  "replacement",
  "focus",
  "label",
  "text",
  "value",
  "structure",
  "attribute",
  "editable",
  "delayed",
  "delayed-focus",
  "hidden-value",
  "delayed-text",
]) {
  test(`focus modality rejects ${scenario}`, { skip }, (t) => {
    assert.throws(() => capture(t, html(scenario), visible, [action]), /focus modality/);
  });
}
test("focus modality has a closed locator-only schema and must be the final action", () => {
  assert.doesNotThrow(() => validateCaptureActions([action]));
  for (const malformed of [
    { ...action, key: "Enter" },
    { ...action, expression: "entry.focus()" },
    { ...action, count: 2 },
    { ...action, locator: { by: "css", value: "section" } },
    { ...action, locator: { by: "id", value: "" } },
  ])
    assert.throws(() => validateCaptureActions([malformed]));
  assert.throws(() => validateCaptureActions([action, { kind: "tab", count: 1, reverse: false }]));
});
