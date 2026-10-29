const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const file = path.resolve(__dirname, "../scripts/design-critique-capture-probe.js");
const probe = new Module(file, module);
probe.filename = file;
probe.paths = Module._nodeModulePaths(path.dirname(file));
probe._compile(
  fs.readFileSync(process.env.PM_TEST_PROBE || file, "utf8") +
    "\nmodule.exports.candidates=compositeKeyboardCandidates;module.exports.entry=entryHasDocumentKeyboardReach;",
  file
);

function searchableListbox(searchInsideDialog = true) {
  const node = (index, backendNodeId, parentIndex, nodeName, role, tabindex) => ({
    index,
    backendNodeId,
    parentIndex,
    nodeName,
    attributes: { role, ...(tabindex === undefined ? {} : { tabindex: String(tabindex) }) },
  });
  const model = [
    node(0, 1, -1, "main", "main"),
    node(1, 2, 0, "button", "button", 0),
    node(2, 3, 0, "div", "dialog"),
    node(3, 5, searchInsideDialog ? 2 : 0, "input", "textbox", 0),
    node(4, 10, 2, "div", "listbox"),
    node(5, 11, 4, "button", "option", 0),
    node(6, 12, 4, "button", "option", -1),
  ];
  const ax = {
    nodes: model.map((n) => ({
      nodeId: String(n.backendNodeId),
      parentId: n.parentIndex < 0 ? undefined : String(model[n.parentIndex].backendNodeId),
      backendDOMNodeId: n.backendNodeId,
      role: { value: n.attributes.role },
      name: { value: n.attributes.role === "dialog" ? "Choose category" : "" },
      properties: [
        {
          name: "focusable",
          value: { value: ["button", "input"].includes(n.nodeName) },
        },
      ],
    })),
  };
  return probe.exports.candidates(ax, model)[0];
}

function dismissingPopup(returnsToOption = true) {
  let focus = 11;
  let open = true;
  return {
    async send(method, args) {
      if (method === "DOM.focus") {
        if (!open && [5, 11, 12].includes(args.backendNodeId))
          throw new Error("popup was dismissed");
        focus = args.backendNodeId;
      }
      if (method === "Input.dispatchKeyEvent" && args.type === "rawKeyDown") {
        if (focus === 11 && args.modifiers === 8) focus = 5;
        else if (focus === 5 && args.modifiers === 0 && returnsToOption) focus = 11;
        else {
          focus = 2;
          open = false;
        }
      }
      if (method === "Runtime.evaluate" && args.expression === "document.activeElement")
        return { result: { objectId: String(focus) } };
      if (method === "DOM.describeNode") return { node: { backendNodeId: Number(args.objectId) } };
      return {};
    },
  };
}

test("search before the listbox permits native reverse-Tab exit and forward return", async () => {
  const candidate = searchableListbox();
  assert.equal(candidate.owner_role, "listbox");
  assert.equal(
    await probe.exports.entry(
      dismissingPopup(),
      1,
      11,
      candidate.entry_probes[11],
      { remaining: 10 },
      new Set(candidate.member_backend_node_ids),
      candidate.owner_backend_node_id
    ),
    true
  );
});

test("a search field outside the popup does not change its exit preference", () => {
  assert.equal(searchableListbox(false).entry_probes[11].preferred_exit_modifiers, 0);
});

test("a shared popup ancestor cannot certify a failed native return", async () => {
  const candidate = searchableListbox();
  let reached = false;
  try {
    reached = await probe.exports.entry(
      dismissingPopup(false),
      1,
      11,
      candidate.entry_probes[11],
      { remaining: 10 },
      new Set(candidate.member_backend_node_ids),
      candidate.owner_backend_node_id
    );
  } catch {
    // A dismissed node is unavailable, never successful keyboard reach.
  }
  assert.equal(reached, false);
});
