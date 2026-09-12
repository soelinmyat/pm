const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const file = require("node:path").resolve(__dirname, "../scripts/design-critique-capture-probe.js");
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(require("node:path").dirname(file));
m._compile(
  fs.readFileSync(process.env.PM_TEST_PROBE || file, "utf8") +
    "\nmodule.exports.testEntry=entryHasDocumentKeyboardReach;",
  file
);
const entry = m.exports.testEntry;
function client(tabDestination) {
  let focus = 1;
  return {
    async send(method, args) {
      if (method === "DOM.focus") {
        focus = args.backendNodeId;
        return {};
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        focus = tabDestination;
        return {};
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      return {};
    },
  };
}
test("native Tab may land on an owner-handled active child in the same roving group", async () =>
  assert.equal(
    await entry(
      client(11),
      1,
      10,
      { from_backend_node_id: 1, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12, 13])
    ),
    true
  ));
test("native Tab to another group cannot certify the candidate", async () =>
  assert.equal(
    await entry(
      client(20),
      1,
      10,
      { from_backend_node_id: 1, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12, 13])
    ),
    false
  ));
test("owner itself remains a valid native Tab destination", async () =>
  assert.equal(
    await entry(
      client(10),
      1,
      10,
      { from_backend_node_id: 1, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12, 13])
    ),
    true
  ));
test("a child trapping Tab without document movement is not accepted by fallback", async () => {
  let focus = 1;
  const trapped = {
    async send(method, args) {
      if (method === "DOM.focus") {
        focus = 11;
        return {};
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      return {};
    },
  };
  assert.equal(await entry(trapped, 1, 10, null, { remaining: 10 }, new Set([11, 12, 13])), false);
});
test("internal Tab cycling never proves document entry in fallback", async () => {
  let focus = 1;
  const trapped = {
    async send(method, args) {
      if (method === "DOM.focus") {
        focus = 11;
        return {};
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        focus = focus === 11 ? 12 : 11;
        return {};
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      return {};
    },
  };
  assert.equal(await entry(trapped, 1, 10, null, { remaining: 10 }, new Set([11, 12, 13])), false);
});
test("fallback accepts leaving the group and native Tab returning to its active member", async () => {
  let focus = 1;
  const client = {
    async send(method, args) {
      if (method === "DOM.focus") {
        focus = 11;
        return {};
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        focus = focus === 11 ? 20 : 11;
        return {};
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      return {};
    },
  };
  assert.equal(await entry(client, 1, 10, null, { remaining: 10 }, new Set([11, 12, 13])), true);
});

test("an explicit probe starting inside the group cannot prove document entry", async () => {
  assert.equal(
    await entry(
      client(11),
      1,
      10,
      { from_backend_node_id: 11, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12])
    ),
    false
  );
  assert.equal(
    await entry(
      client(12),
      1,
      10,
      { from_backend_node_id: 11, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12])
    ),
    false
  );
});

test("the group owner is internal when proving a child entry", async () => {
  assert.equal(
    await entry(
      client(11),
      1,
      11,
      { from_backend_node_id: 10, modifiers: 0 },
      { remaining: 10 },
      new Set([11, 12]),
      10
    ),
    false
  );
});

for (const externalReturn of [true, false]) {
  test(`an external predecessor retaining Tab uses verified group fallback: ${externalReturn}`, async () => {
    let focus = 1;
    const protocol = {
      async send(method, args) {
        if (method === "DOM.focus") {
          focus = args.backendNodeId === 10 ? 11 : args.backendNodeId;
          return {};
        }
        if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
          if (focus !== 1 && externalReturn) focus = focus === 20 ? 11 : 20;
          return {};
        }
        if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
          return { result: { objectId: String(focus) } };
        if (method === "DOM.describeNode")
          return { node: { backendNodeId: Number(args.objectId) } };
        return {};
      },
    };
    assert.equal(
      await entry(
        protocol,
        1,
        10,
        { from_backend_node_id: 1, modifiers: 0 },
        { remaining: 10 },
        new Set([11, 12]),
        10
      ),
      externalReturn
    );
  });
}
