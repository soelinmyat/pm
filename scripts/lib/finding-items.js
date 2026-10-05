"use strict";

// Return complete top-level list items. Nested lists and continuation lines
// belong to their parent claim, including the limitations that qualify it.
function parseFindingItems(section) {
  const items = [];
  let active = [];
  let listIndent = null;
  let lazyContinuation = false;
  const finish = () => {
    if (active.length) items.push(active.join("\n").trimEnd());
    active = [];
  };
  for (const line of String(section || "").split(/\r?\n/)) {
    const match = line.match(/^(\s*)(?:\d+[.)]|[-*])\s+(.*)$/);
    if (match && (listIndent === null || match[1].length <= listIndent)) {
      finish();
      active = [match[2]];
      listIndent = match[1].length;
      lazyContinuation = true;
    } else if (active.length && !line.trim()) {
      active.push("");
      lazyContinuation = false;
    } else if (
      active.length &&
      !/^\s*#/.test(line) &&
      (lazyContinuation || /^\s{2,}\S/.test(line))
    ) {
      active.push(line);
    }
  }
  finish();
  return items;
}

module.exports = { parseFindingItems };
