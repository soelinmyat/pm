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
