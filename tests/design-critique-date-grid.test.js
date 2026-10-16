"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dateGridButtons } = require("../scripts/lib/design-critique-date-grid");

function model() {
  const node = (index, parentIndex, nodeName, attributes = {}) => ({
    index,
    parentIndex,
    nodeName,
    attributes,
    backendNodeId: index + 1,
  });
  return [
    node(0, -1, "html"),
    node(1, 0, "table", { role: "grid" }),
    node(2, 1, "tr", { role: "row" }),
    node(3, 2, "td", { role: "gridcell", "data-day": "2026-10-15" }),
    node(4, 3, "button"),
    node(5, 2, "td", { role: "gridcell", "data-day": "2026-10-16" }),
    node(6, 5, "button"),
  ];
}

test("date grids bind buttons to their unique dated cell, row and grid", () => {
  const rows = model();
  const dates = dateGridButtons(rows);
  assert.equal(dates.size, 2);
  const next = dates.get(7);
  assert.equal(next.isoDate, "2026-10-16");
  assert.equal(next.day - dates.get(5).day, 1);
  assert.equal(next.cell, rows[5]);
  assert.equal(next.row, rows[2]);
  assert.equal(next.grid, rows[1]);
});

for (const day of ["2026-02-30", "2026-13-01", "10/16/2026", "", null]) {
  test(`date grids reject invalid or ambiguous date identity: ${day}`, () => {
    const rows = model();
    rows[5].attributes["data-day"] = day;
    assert.equal(dateGridButtons(rows).size, 0);
  });
}

test("duplicate dates or multiple buttons in one date cell cannot establish grid membership", () => {
  const duplicate = model();
  duplicate[5].attributes["data-day"] = "2026-10-15";
  assert.equal(dateGridButtons(duplicate).size, 0);
  const repeatedButton = model();
  repeatedButton.push({
    index: 7,
    parentIndex: 3,
    nodeName: "button",
    attributes: {},
    backendNodeId: 8,
  });
  assert.equal(dateGridButtons(repeatedButton).size, 0);
});

for (const damage of ["missing-row", "nested-grid", "cycle", "date-only-optout"]) {
  test(`date attributes cannot replace semantic ownership: ${damage}`, () => {
    const rows = model();
    if (damage === "missing-row") rows[2].attributes.role = "group";
    if (damage === "nested-grid") rows[2].attributes.role = "grid";
    if (damage === "cycle") rows[2].parentIndex = 3;
    if (damage === "date-only-optout") rows[1].attributes.role = "group";
    assert.equal(dateGridButtons(rows).size, 0);
  });
}

test("independent month grids may share outside dates without sharing ownership", () => {
  const rows = model();
  rows.push(
    ...rows.slice(1).map((node) => ({
      ...node,
      index: node.index + 6,
      backendNodeId: node.backendNodeId + 6,
      parentIndex: node.parentIndex === 0 ? 0 : node.parentIndex + 6,
    }))
  );
  const dates = dateGridButtons(rows);
  assert.equal(dates.size, 4);
  assert.deepEqual(
    new Set([...dates.values()].map((entry) => entry.grid.backendNodeId)),
    new Set([2, 8])
  );
});
