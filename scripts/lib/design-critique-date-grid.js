"use strict";

function role(node) {
  return String(node?.attributes?.role || "")
    .trim()
    .toLowerCase();
}

function dateGridContext(node, byIndex) {
  const visited = new Set([node.index]);
  let cell = null;
  let row = null;
  let parent = byIndex.get(node.parentIndex);
  while (parent && !visited.has(parent.index)) {
    visited.add(parent.index);
    const semanticRole = role(parent);
    if (semanticRole === "gridcell") {
      if (cell || row) return null;
      cell = parent;
    } else if (semanticRole === "row" || (!semanticRole && parent.nodeName === "tr")) {
      if (!cell || row) return null;
      row = parent;
    } else if (semanticRole === "grid") {
      return cell && row ? { cell, row, grid: parent } : null;
    } else if (["button", "link", "table", "treegrid"].includes(semanticRole)) {
      return null;
    }
    parent = byIndex.get(parent.parentIndex);
  }
  return null;
}

// Date attributes alone never establish a widget. Require one native button
// per uniquely dated semantic cell, beneath a row and its own grid.
function dateGridButtons(model) {
  const byIndex = new Map(model.map((node) => [node.index, node]));
  const grids = new Map();
  for (const button of model) {
    if (button.nodeName !== "button" || (role(button) && role(button) !== "button")) continue;
    const context = dateGridContext(button, byIndex);
    if (!context) continue;
    const id = context.grid.backendNodeId;
    if (!grids.has(id))
      grids.set(id, { entries: [], cells: new Set(), dates: new Set(), invalid: false });
    const group = grids.get(id);
    const isoDate = context.cell.attributes["data-day"];
    const date =
      typeof isoDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(isoDate)
        ? Date.parse(isoDate + "T00:00:00.000Z")
        : NaN;
    if (
      !Number.isFinite(date) ||
      new Date(date).toISOString().slice(0, 10) !== isoDate ||
      group.cells.has(context.cell.backendNodeId) ||
      group.dates.has(isoDate)
    ) {
      group.invalid = true;
      continue;
    }
    group.cells.add(context.cell.backendNodeId);
    group.dates.add(isoDate);
    group.entries.push({ button, ...context, isoDate, day: date / 86400000 });
  }
  const buttons = new Map();
  for (const group of grids.values()) {
    if (group.invalid || group.entries.length < 2) continue;
    for (const entry of group.entries) buttons.set(entry.button.backendNodeId, entry);
  }
  return buttons;
}

module.exports = { dateGridButtons };
