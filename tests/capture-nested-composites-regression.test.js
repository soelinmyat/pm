"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const file = path.resolve(__dirname, "../scripts/design-critique-capture-probe.js");
const m = new Module(file, module);
m.filename = file;
m.paths = Module._nodeModulePaths(path.dirname(file));
m._compile(
  fs.readFileSync(process.env.PM_TEST_PROBE || file, "utf8") +
    "\nmodule.exports.candidates=compositeKeyboardCandidates;module.exports.probe=probeCompositeKeyboardAccess;",
  file
);
function candidates() {
  const node = (index, backendNodeId, parentIndex, role, tabindex) => ({
    index,
    backendNodeId,
    parentIndex,
    nodeName: role === "tab" ? "button" : "div",
    attributes: { role, ...(tabindex === undefined ? {} : { tabindex: String(tabindex) }) },
  });
  const model = [
    node(0, 1, -1, "main"),
    node(1, 10, 0, "tablist"),
    node(2, 11, 1, "tab", 0),
    node(3, 12, 1, "tab", -1),
    node(4, 20, 0, "tabpanel"),
    node(5, 21, 4, "group"),
    node(6, 30, 5, "tablist"),
    node(7, 31, 6, "tab", 0),
    node(8, 32, 6, "tab", -1),
  ];
  const ax = {
    nodes: model.map((n) => ({
      nodeId: String(n.backendNodeId),
      parentId: n.parentIndex < 0 ? undefined : String(model[n.parentIndex].backendNodeId),
      backendDOMNodeId: n.backendNodeId,
      role: { value: n.attributes.role },
      properties: [
        { name: "focusable", value: { value: n.attributes.role === "tab" } },
        { name: "selected", value: { value: [11, 31].includes(n.backendNodeId) } },
      ],
    })),
  };
  return m.exports.candidates(ax, model);
}
function client(restoreWorks = true, nestedQuery = false) {
  let focus = 1,
    innerDetached = false,
    innerStatus = "original",
    url = `http://localhost/?tab=original${nestedQuery ? "&inner=original" : ""}`;
  const route = (tab) =>
    `http://localhost/?tab=${tab}${nestedQuery ? `&inner=${innerStatus}` : ""}`;
  return {
    get url() {
      return url;
    },
    async send(method, args) {
      if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "frame", url } } };
      if (method === "Page.createIsolatedWorld") return { executionContextId: 1 };
      if (method === "DOM.focus") {
        if (innerDetached && [30, 31, 32].includes(args.backendNodeId))
          throw new Error("frozen inner node detached");
        focus = args.backendNodeId;
        return {};
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        if (args.key === "Tab") focus = args.modifiers === 8 ? 11 : 31;
        else if (args.key.startsWith("Arrow")) {
          if ([31, 32].includes(focus)) {
            focus = focus === 31 ? 32 : 31;
            if (nestedQuery) {
              innerStatus = "other";
              url = route("original");
            }
          } else {
            focus = focus === 11 ? 12 : 11;
            innerDetached = true;
            url = route("other");
          }
        } else if (args.key === "Enter" && restoreWorks) {
          if (focus === 31) innerStatus = "original";
          if ([11, 31].includes(focus)) url = route("original");
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
test("nested frozen composites are probed before outer navigation detaches them", async () => {
  const browser = client();
  const observed = await m.exports.probe(browser, candidates());
  assert.deepEqual(
    [...observed].sort((a, b) => a - b),
    [11, 12, 31, 32]
  );
  assert.equal(browser.url, "http://localhost/?tab=original");
});
test("broken outer restoration cannot claim the original URL after nested probing", async () => {
  const browser = client(false);
  await m.exports.probe(browser, candidates());
  assert.equal(browser.url, "http://localhost/?tab=other");
});

test("each nested selection restores its own URL before outer navigation remounts it", async () => {
  const browser = client(true, true);
  const observed = await m.exports.probe(browser, candidates());
  assert.deepEqual(
    [...observed].sort((a, b) => a - b),
    [11, 12, 31, 32]
  );
  assert.equal(browser.url, "http://localhost/?tab=original&inner=original");
});
