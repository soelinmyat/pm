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
    "\nmodule.exports.probe=probeCompositeKeyboardAccess;",
  file
);
function client(asynchronous = true, works = true) {
  let focus = 1;
  return {
    async send(method, args) {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame" } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "DOM.focus") {
        focus = args.backendNodeId;
        return {};
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        if (args.key === "Tab") focus = 11;
        else if (args.key.startsWith("Arrow") && works) {
          const next = focus === 11 ? 12 : 11;
          if (asynchronous) setTimeout(() => (focus = next), 30);
          else focus = next;
        }
        return {};
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      if (method === "Accessibility.getPartialAXTree") return { nodes: [] };
      return {};
    },
  };
}
const candidate = {
  owner_backend_node_id: 10,
  owner_role: "tablist",
  member_backend_node_ids: [11, 12],
  entry_backend_node_ids: [11],
  entry_probes: { 11: { from_backend_node_id: 1, modifiers: 0 } },
};
test("waits for actual asynchronously handled arrow focus", async () =>
  assert.deepEqual([...(await m.exports.probe(client(), [candidate]))].sort(), [11, 12]));
test("static arrow markup still fails within a bounded interval", async () =>
  assert.deepEqual([...(await m.exports.probe(client(false, false), [candidate]))], []));
test("synchronous navigation remains accepted", async () =>
  assert.deepEqual(
    [...(await m.exports.probe(client(false, true), [candidate]))].sort(),
    [11, 12]
  ));
