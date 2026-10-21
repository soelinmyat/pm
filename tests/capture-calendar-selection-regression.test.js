"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { capture, skip } = require("./fixtures/native-capture-fixture");

function calendar(variant) {
  const cells = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10);
    const selected = index === 15 || (variant === "selected-peer-drift" && index === 16);
    const role = variant === "missing-cell" ? "group" : "gridcell";
    const day = variant === "duplicate-date" && index === 16 ? "2026-10-16" : date;
    const selection =
      variant === "data-only"
        ? selected
          ? ' data-selected="true"'
          : ""
        : variant === "mixed"
          ? selected
            ? ' aria-selected="mixed"'
            : ""
          : ' aria-selected="' + selected + '"';
    const color = selected
      ? index === 16
        ? "maroon"
        : "navy"
      : variant === "ordinary-drift" && index === 18
        ? "maroon"
        : "transparent";
    const buttonSelection = variant === "button-only" && selected ? ' aria-selected="true"' : "";
    return (
      '<td role="' +
      role +
      '" data-day="' +
      day +
      '"' +
      (variant === "button-only" ? "" : selection) +
      '><button class="day" id="day-' +
      index +
      '" tabindex="' +
      (index === 15 ? 0 : -1) +
      '" aria-label="Choose ' +
      date +
      '"' +
      buttonSelection +
      ' style="background:' +
      color +
      ";color:" +
      (selected ? "white" : "black") +
      '">' +
      (index + 1) +
      "</button></td>"
    );
  });
  const rows = Array.from(
    { length: 5 },
    (_, i) => '<tr role="row">' + cells.slice(i * 7, i * 7 + 7).join("") + "</tr>"
  ).join("");
  return (
    '<!doctype html><html lang="en"><head><style>body{font:16px Arial;padding:24px}h1{font-size:24px}table{border-collapse:collapse}td{padding:0}.day{box-sizing:border-box;width:44px;height:44px;font:14px Arial;border:0;border-radius:8px}</style></head><body><main id="fixture" data-pm-state="primary"><h1>Choose the reporting day</h1><button>Before calendar</button><table id="calendar" role="' +
    (variant === "missing-grid" ? "group" : "grid") +
    '" aria-label="Reporting dates"><tbody role="rowgroup">' +
    rows +
    '</tbody></table><button>Save date</button></main><script>{const grid=document.querySelector("#calendar"),days=[...grid.querySelectorAll("button")];grid.addEventListener("keydown",e=>{const delta=({ArrowRight:1,ArrowLeft:-1,ArrowDown:7,ArrowUp:-7})[e.key];if(!delta)return;e.preventDefault();const next=days[days.indexOf(document.activeElement)+delta];if(next){days.forEach(d=>d.tabIndex=d===next?0:-1);next.focus()}})}</script></body></html>'
  );
}

for (const variant of [
  "selected-cell",
  "data-only",
  "button-only",
  "mixed",
  "missing-grid",
  "missing-cell",
  "duplicate-date",
  "ordinary-drift",
  "selected-peer-drift",
]) {
  test(
    "native calendar selected styling requires semantic cell ownership: " + variant,
    { skip },
    (t) => {
      const result = capture(t, calendar(variant), [
        {
          locator: { by: "role-name", value: "heading:Choose the reporting day" },
          expect: { kind: "visible" },
        },
      ]);
      const issues = result.dom_observations.consistency;
      if (variant === "selected-cell") assert.deepEqual(issues, []);
      else
        assert.ok(
          issues.some((row) => row.code === "visual-variance"),
          JSON.stringify(issues)
        );
    }
  );
}
