"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PLUGIN_ROOT = path.resolve(__dirname, "..");
const CAPTURE_GUIDE = path.join(
  PLUGIN_ROOT,
  "skills/dev/references/design-critique-capture-guide.md"
);
const REVIEWER_BRIEF = path.join(PLUGIN_ROOT, "skills/dev/references/design-critique-reviewer.md");

function extractConsistencyAuditScript() {
  const guide = fs.readFileSync(CAPTURE_GUIDE, "utf8");
  const marker = "For each page, run this via `browser_evaluate`:";
  const markerIndex = guide.indexOf(marker);
  assert.notEqual(markerIndex, -1, "capture guide must document the browser_evaluate audit");

  const fencedStart = guide.indexOf("```javascript", markerIndex);
  assert.notEqual(fencedStart, -1, "capture guide must include a javascript audit block");

  const codeStart = guide.indexOf("\n", fencedStart) + 1;
  const fencedEnd = guide.indexOf("```", codeStart);
  assert.notEqual(fencedEnd, -1, "capture guide audit block must close");

  return guide.slice(codeStart, fencedEnd).trim();
}

const DEFAULT_STYLE = {
  display: "block",
  opacity: "1",
  borderTopWidth: "0px",
  borderTopStyle: "none",
  borderTopColor: "rgba(0, 0, 0, 0)",
  paddingTop: "0px",
  paddingRight: "0px",
  paddingBottom: "0px",
  paddingLeft: "0px",
  fontSize: "16px",
  fontWeight: "400",
  lineHeight: "20px",
  color: "rgb(0, 0, 0)",
  letterSpacing: "0px",
  textTransform: "none",
  textDecorationLine: "none",
  borderRadius: "0px",
  backgroundColor: "rgba(0, 0, 0, 0)",
  gap: "0px",
  overflow: "visible",
  boxShadow: "none",
  marginBottom: "0px",
};

class FakeElement {
  constructor(tagName, options = {}) {
    this.tagName = tagName.toUpperCase();
    this.className = options.className || "";
    this.textContent = options.text || "";
    this.attributes = options.attributes || {};
    this.children = options.children || [];
    this._rect = options.rect || { left: 0, top: 0, width: 100, height: 40 };
    this._style = { ...DEFAULT_STYLE, ...(options.style || {}) };
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this._rect;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  getAttribute(name) {
    return this.attributes[name] || null;
  }

  querySelectorAll(selector) {
    const descendants = collectElements(this.children);
    return descendants.filter((el) => matchesSelectorList(el, selector));
  }
}

class FakeDocument {
  constructor(roots) {
    this.elements = collectElements(roots);
  }

  querySelectorAll(selector) {
    return this.elements.filter((el) => matchesSelectorList(el, selector));
  }
}

function collectElements(elements) {
  return elements.flatMap((el) => [el, ...collectElements(el.children)]);
}

function matchesSelectorList(el, selectorList) {
  return selectorList.split(",").some((selector) => matchesSelector(el, selector.trim()));
}

function matchesSelector(el, selector) {
  if (!selector || selector.includes(":")) return false;
  if (selector === "*") return true;
  if (/^[a-z][a-z0-9-]*$/i.test(selector)) return el.tagName.toLowerCase() === selector;

  const classContains = selector.match(/^\[class\*="([^"]+)"\]$/);
  if (classContains) return el.className.includes(classContains[1]);

  const exactAttr = selector.match(/^\[([^=\]]+)="([^"]+)"\]$/);
  if (exactAttr) return el.getAttribute(exactAttr[1]) === exactAttr[2];

  return false;
}

function runAudit(document) {
  const result = vm.runInNewContext(extractConsistencyAuditScript(), {
    document,
    getComputedStyle: (el) => el._style,
  });
  return JSON.parse(result);
}

test("design critique audit flags cross-component and popover edge drift numerically", () => {
  const banner = new FakeElement("section", {
    className: "getting-started-banner",
    text: "Get started",
    rect: { left: 0, top: 0, width: 400, height: 64 },
  });
  const filterRow = new FakeElement("div", {
    className: "inbox-filter-row",
    text: "Filters",
    rect: { left: 16, top: 76, width: 372, height: 44 },
  });
  const listRow = new FakeElement("div", {
    className: "inbox-list-row",
    text: "Inbox item",
    rect: { left: 16, top: 132, width: 368, height: 48 },
  });
  const secondListRow = new FakeElement("div", {
    className: "inbox-list-row",
    text: "Inbox item 2",
    rect: { left: 16, top: 184, width: 368, height: 48 },
  });
  const main = new FakeElement("main", {
    rect: { left: 0, top: 0, width: 400, height: 260 },
    children: [banner, filterRow, listRow, secondListRow],
  });

  const rowOneControl = new FakeElement("button", {
    className: "chevron",
    text: ">",
    rect: { left: 252, top: 8, width: 20, height: 20 },
  });
  const rowTwoControl = new FakeElement("button", {
    className: "switch",
    text: "on",
    rect: { left: 224, top: 48, width: 32, height: 20 },
  });
  const rowThreeControl = new FakeElement("button", {
    className: "chevron",
    text: ">",
    rect: { left: 252, top: 88, width: 20, height: 20 },
  });
  const popover = new FakeElement("div", {
    className: "display-popover",
    rect: { left: 40, top: 280, width: 240, height: 140 },
    children: [
      new FakeElement("div", {
        className: "menu-row",
        text: "Density",
        rect: { left: 48, top: 288, width: 224, height: 36 },
        children: [rowOneControl],
      }),
      new FakeElement("div", {
        className: "menu-row",
        text: "Preview",
        rect: { left: 48, top: 328, width: 224, height: 36 },
        children: [rowTwoControl],
      }),
      new FakeElement("div", {
        className: "menu-row",
        text: "Sort",
        rect: { left: 48, top: 368, width: 224, height: 36 },
        children: [rowThreeControl],
      }),
    ],
  });

  const audit = runAudit(new FakeDocument([main, popover]));

  assert.ok(Array.isArray(audit.edgeAlignment), "audit must include edgeAlignment findings");
  assert.ok(
    audit.edgeAlignment.some(
      (finding) =>
        finding.type === "stacked-sibling-edge" &&
        finding.element.includes("getting-started-banner") &&
        finding.edge === "right"
    ),
    "full-width banner should be flagged against inset siblings"
  );
  assert.ok(
    audit.edgeAlignment.some(
      (finding) =>
        finding.type === "stacked-sibling-edge" &&
        finding.element.includes("inbox-filter-row") &&
        finding.edge === "right"
    ),
    "filter row right edge should be flagged against list row majority"
  );
  assert.ok(
    audit.edgeAlignment.some(
      (finding) =>
        finding.type === "inner-row-control-edge" &&
        finding.element.includes("switch") &&
        finding.edge === "right"
    ),
    "popover switch control should be flagged against sibling row controls"
  );
  assert.equal(audit._meta.edge_alignment_issues, audit.edgeAlignment.length);
});

test("design critique docs route edge-alignment data to reviewer as high-confidence input", () => {
  const guide = fs.readFileSync(CAPTURE_GUIDE, "utf8");
  const reviewer = fs.readFileSync(REVIEWER_BRIEF, "utf8");

  assert.match(guide, /## Edge Alignment/);
  assert.match(guide, /edgeAlignment/);
  assert.match(guide, /2px/);
  assert.match(reviewer, /edge-alignment/i);
  assert.match(reviewer, /\[HIGH\] confidence/);
  assert.match(reviewer, /data-backed/i);
});
