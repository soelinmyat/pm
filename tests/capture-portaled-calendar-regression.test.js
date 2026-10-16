"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { capture, skip } = require("./fixtures/native-capture-fixture");
const { normalizeRawAudit } = require("../scripts/design-critique-audit-normalize");

function portaledCalendar(mode) {
  const cells = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    const entry = mode !== "no-entry" && index === 15;
    return `<td role="gridcell" data-day="${date}" style="padding:0"><button id="date-${index}" tabindex="${entry ? 0 : -1}" ${entry && mode !== "unfocused" ? "autofocus" : ""} aria-label="Choose ${date}" style="width:28px;height:28px;padding:0">${Number(date.slice(-2))}</button></td>`;
  });
  const rows = Array.from(
    { length: 5 },
    (_, index) => `<tr role="row">${cells.slice(index * 7, index * 7 + 7).join("")}</tr>`
  ).join("");
  const tabs = `<div role="tablist" aria-label="Inspection status"><button id="completed" role="tab" aria-selected="true" tabindex="0">Completed</button><button id="pending" role="tab" aria-selected="false" tabindex="-1">Pending</button></div>`;
  // The popup is a body sibling, so DOM depth alone puts these background tabs first.
  const background = "<div>".repeat(10) + tabs + "</div>".repeat(10);
  return `<!doctype html><html><head><link rel="icon" href="data:,"></head><body>
<main id="fixture" data-pm-state="primary"><h1>Inspection evidence</h1><p>Review completed inspections by date.</p>${background}<button>Export inspections</button></main>
<section id="calendar-popup" role="dialog" aria-label="Date filter" style="position:fixed;left:520px;top:130px;padding:16px;background:white;border:1px solid gray">
<button>Before calendar</button><table id="calendar" role="grid" aria-label="Choose review date"><tbody role="rowgroup">${rows}</tbody></table><button>After calendar</button></section>
<script>
const mode=${JSON.stringify(mode)};
const popup=document.getElementById('calendar-popup'),grid=document.getElementById('calendar');
const days=[...grid.querySelectorAll('button')],tabs=[...document.querySelectorAll('[role=tab]')];let moved=false;
grid.addEventListener('keydown',event=>{
 if(event.key==='Tab'&&mode==='trap-after-arrow'&&moved){event.preventDefault();return;}
 const delta=({ArrowRight:1,ArrowLeft:-1,ArrowDown:7,ArrowUp:-7})[event.key];if(!delta)return;
 event.preventDefault();if(mode==='static')return;
 const next=days.indexOf(document.activeElement)+delta;if(next<0||next>=days.length)return;
 days.forEach((day,index)=>day.tabIndex=index===next?0:-1);days[next].focus();moved=true;
});
document.querySelector('[role=tablist]').addEventListener('keydown',event=>{
 let index=tabs.indexOf(document.activeElement);
 if(event.key==='ArrowRight'||event.key==='ArrowLeft'){event.preventDefault();index=1-index;}
 else if(event.key==='Enter'){event.preventDefault();}else return;
 tabs.forEach((tab,n)=>{tab.tabIndex=n===index?0:-1;tab.setAttribute('aria-selected',String(n===index));});
 popup.remove();tabs[index].focus();
});
</script></body></html>`;
}

for (const mode of ["working", "unfocused", "static", "no-entry", "trap-after-arrow"]) {
  test(`portaled calendar is checked before background tab activation: ${mode}`, { skip }, (t) => {
    const result = capture(t, portaledCalendar(mode), [
      { locator: { by: "id", value: "date-15" }, expect: { kind: "visible" } },
    ]);
    const audit = normalizeRawAudit(
      {
        schema_version: 1,
        kind: "accessibility-tree",
        subject_id: "compatibility",
        commit: "a".repeat(40),
        capture_ids: ["capture-calendar-primary-desktop-r1"],
        observations: result.accessibility_observations,
      },
      { path: ".pm/test/portaled-calendar-raw.json", sha256: "b".repeat(64) }
    );
    assert.equal(audit.checks.landmarks, true);
    assert.equal(audit.checks.names, true);
    assert.equal(
      audit.checks.focus_order,
      ["working", "unfocused"].includes(mode),
      JSON.stringify(audit.findings)
    );
    assert.equal(
      result.accessibility_observations.controls.filter((c) => c.locator.startsWith("button#date-"))
        .length,
      35
    );
  });
}
