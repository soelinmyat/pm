"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { capture, skip } = require("./fixtures/native-capture-fixture");
function html(extra = "", attributes = "") {
  return `<!doctype html><html lang="en"><head><style>body{font:16px Arial;padding:24px}h1{font-size:24px}.action{box-sizing:border-box;width:170px;font:14px/20px Arial;padding:8px;border:0;border-radius:8px;background:navy;color:white}${extra}</style></head><body><main id="fixture" data-pm-state="primary"><h1>Review your notification settings</h1><p>Choose which updates your team receives.</p><button id="short" class="action" ${attributes}>Review updates</button><button id="long" class="action" ${attributes}>Review the available notification preferences for your team</button></main></body></html>`;
}
const guards = [
  { locator: { by: "id", value: "short" }, expect: { kind: "visible" } },
  { locator: { by: "id", value: "long" }, expect: { kind: "visible" } },
];
test("native intrinsic button heights permit legitimate content wrapping", { skip }, async (t) => {
  const result = capture(t, html(), guards);
  assert.deepEqual(result.dom_observations.consistency, []);
});
for (const variant of ["fixed", "min-height", "max-height", "forged-attribute"]) {
  test(`native intrinsic height treatment preserves ${variant} defects`, { skip }, async (t) => {
    const extra =
      variant === "fixed" || variant === "forged-attribute"
        ? "#short{height:36px}#long{height:76px}"
        : variant === "min-height"
          ? "#short{min-height:36px}#long{min-height:76px}"
          : "#short{max-height:76px}#long{max-height:96px}";
    const result = capture(
      t,
      html(extra, variant === "forged-attribute" ? 'data-pm-intrinsic-height="true"' : ""),
      guards
    );
    const findings = result.dom_observations.consistency;
    const expected = variant === "min-height" || variant === "max-height" ? variant : "height";
    assert.ok(
      findings.some((row) => row.detail.includes(`${expected}:`)),
      JSON.stringify(findings)
    );
  });
}

const { observeIntrinsicButtonHeights } = require("../scripts/design-critique-capture-probe");

function textareaHtml(extra = "", attributes = "") {
  return `<!doctype html><html lang="en"><head><style>body{font:16px Arial;padding:24px}h1{font-size:24px}textarea{display:block;box-sizing:border-box;width:320px;font:14px/20px Arial;padding:8px;border:1px solid gray;border-radius:8px;field-sizing:content;min-height:80px;max-height:240px}${extra}</style></head><body><main id="fixture" data-pm-state="primary"><h1>Record handover observations</h1><label for="short">Inspector</label><textarea id="short" ${attributes}>Maya</textarea><label for="long">Observations</label><textarea id="long" ${attributes}>The lobby inspection is complete.\nThe loading bay door needs a second check.\nThe next shift will verify the repair.\nAn updated report will follow.\nThe supervisor recorded the handover.</textarea></main></body></html>`;
}

test("native content-sized textarea heights permit legitimate draft growth", { skip }, (t) => {
  const result = capture(t, textareaHtml(), guards);
  assert.deepEqual(result.dom_observations.consistency, []);
});

for (const variant of ["fixed", "min-height", "max-height", "padding", "forged-attribute"]) {
  test(`native content-sized textarea treatment preserves ${variant} defects`, { skip }, (t) => {
    const extra =
      variant === "fixed" || variant === "forged-attribute"
        ? "#short{height:80px}#long{height:160px}"
        : variant === "min-height"
          ? "#short{min-height:80px}#long{min-height:160px}"
          : variant === "max-height"
            ? "#short{max-height:100px}#long{max-height:240px}"
            : "#long{padding-top:20px}";
    const result = capture(
      t,
      textareaHtml(extra, variant === "forged-attribute" ? 'data-pm-intrinsic-height="true"' : ""),
      guards
    );
    const property = variant === "padding" ? "padding-top" : "height";
    assert.ok(
      result.dom_observations.consistency.some((row) => row.detail.includes(`${property}:`)),
      JSON.stringify(result.dom_observations.consistency)
    );
  });
}

test("native fixed-field-sizing textareas retain differing used-height failures", { skip }, (t) => {
  const result = capture(
    t,
    textareaHtml("textarea{field-sizing:fixed}#short{height:80px}#long{height:160px}"),
    guards
  );
  assert.ok(result.dom_observations.consistency.some((row) => row.detail.includes("height:")));
});

test(
  "native ordinary rows-based textareas retain differing used-height failures",
  { skip },
  (t) => {
    const markup = textareaHtml("textarea{field-sizing:fixed}")
      .replace('id="short"', 'id="short" rows="3"')
      .replace('id="long"', 'id="long" rows="6"');
    const result = capture(t, markup, guards);
    assert.ok(result.dom_observations.consistency.some((row) => row.detail.includes("height:")));
  }
);

function protocol(response = { result: { value: false } }) {
  const calls = [];
  return {
    calls,
    async send(method) {
      calls.push(method);
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "DOM.resolveNode") return { object: { objectId: "node" } };
      if (method === "Runtime.callFunctionOn") return response;
      return {};
    },
  };
}
test("intrinsic sizing conservatively retains used height when Typed OM is unsupported", async () => {
  const nodes = [{ backendNodeId: 1 }],
    client = protocol();
  await observeIntrinsicButtonHeights(client, nodes, "frame");
  assert.equal(nodes[0].intrinsicHeight, false);
  assert.equal(client.calls.at(-1), "Runtime.releaseObjectGroup");
});
for (const response of [{ result: { value: "auto" } }, { exceptionDetails: {} }, { result: {} }]) {
  test(`intrinsic sizing rejects unmeasured protocol value ${JSON.stringify(response)}`, async () => {
    const client = protocol(response);
    await assert.rejects(
      () => observeIntrinsicButtonHeights(client, [{ backendNodeId: 1 }], "frame"),
      /observation failed/
    );
    assert.equal(client.calls.at(-1), "Runtime.releaseObjectGroup");
  });
}
test("intrinsic sizing requires a native frame/context and obeys the control budget", async () => {
  await assert.rejects(
    () => observeIntrinsicButtonHeights(protocol(), [{ backendNodeId: 1 }], ""),
    /frame/
  );
  await assert.rejects(
    () =>
      observeIntrinsicButtonHeights(
        protocol(),
        Array.from({ length: 1001 }, () => ({ backendNodeId: 1 })),
        "frame"
      ),
    /budget/
  );
  const client = protocol();
  client.send = async () => ({});
  await assert.rejects(
    () => observeIntrinsicButtonHeights(client, [{ backendNodeId: 1 }], "frame"),
    /context/
  );
});
