#!/usr/bin/env node
"use strict";

// Measurement tools for the Design Director. They report what is on the page
// and never pass or fail anything: the director reads the numbers beside the
// pixels and decides.
//
// createMeasure is self-contained so its source can be injected into a live
// page through any browser tool. The analyses also run in Node over a model
// supplied as JSON, which is how native hierarchies without style values are
// measured.

function createMeasure(env) {
  const win = env && env.window;
  const doc = env && env.document;
  const MAX_ELEMENTS = 6000;
  const MAX_ROWS = 60;
  const STYLE_NAMES = [
    "display",
    "position",
    "visibility",
    "opacity",
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "text-transform",
    "color",
    "background-color",
    "background-image",
    "box-shadow",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "border-top-width",
    "border-right-width",
    "border-bottom-width",
    "border-left-width",
    "border-top-style",
    "border-right-style",
    "border-bottom-style",
    "border-left-style",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-top-left-radius",
    "row-gap",
    "column-gap",
    "flex-direction",
  ];
  const SIDES = ["top", "right", "bottom", "left"];
  const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"]);
  const INTERACTIVE_ROLES = new Set([
    "button",
    "link",
    "tab",
    "menuitem",
    "checkbox",
    "radio",
    "switch",
    "option",
    "combobox",
    "textbox",
  ]);
  const CONTENT_TAGS = new Set(["img", "svg", "input", "select", "textarea", "button", "video"]);

  const px = (value) => {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const round = (value) => Math.round(value * 10) / 10;

  function parseColor(value) {
    const text = String(value || "").trim();
    let match = /^rgba?\(([^)]+)\)$/.exec(text);
    if (match) {
      const parts = match[1].split(/[\s,/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      const channel = (part) => (part.endsWith("%") ? (px(part) * 255) / 100 : px(part));
      const alpha =
        parts.length > 3 ? (parts[3].endsWith("%") ? px(parts[3]) / 100 : px(parts[3])) : 1;
      return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
    }
    match = /^color\(srgb\s+([^)]+)\)$/.exec(text);
    if (match) {
      const parts = match[1].split(/[\s/]+/).filter(Boolean);
      if (parts.length < 3) return null;
      return {
        r: px(parts[0]) * 255,
        g: px(parts[1]) * 255,
        b: px(parts[2]) * 255,
        a: parts.length > 3 ? px(parts[3]) : 1,
      };
    }
    if (text === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    return null;
  }

  function luminance(color) {
    const linear = (channel) => {
      const scaled = channel / 255;
      return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
  }

  function blend(top, under) {
    const alpha = top.a + under.a * (1 - top.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (a, b) => (a * top.a + b * under.a * (1 - top.a)) / alpha;
    return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a: alpha };
  }

  function contrastRatio(foreground, background) {
    const solid = blend(foreground, background);
    const a = luminance(solid);
    const b = luminance(background);
    return round((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  }

  function hasStyles(node) {
    return Boolean(node.style) && Object.keys(node.style).length > 0;
  }

  function visibleBorder(node, side) {
    if (!hasStyles(node)) return 0;
    const width = px(node.style[`border-${side}-width`]);
    const style = node.style[`border-${side}-style`];
    const color = parseColor(node.style[`border-${side}-color`]);
    if (width <= 0 || style === "none" || style === "hidden") return 0;
    if (color && color.a === 0) return 0;
    return width;
  }

  function paintsBackground(node) {
    if (!hasStyles(node)) return false;
    const color = parseColor(node.style["background-color"]);
    const image = node.style["background-image"];
    return Boolean((color && color.a > 0.02) || (image && image !== "none"));
  }

  // A surface is something drawn as its own block: a fill, an outline or a
  // shadow. Native models carry no styles, so they may declare it directly.
  function isSurface(node) {
    if (node.surface === true) return true;
    if (!hasStyles(node)) return false;
    const shadow = node.style["box-shadow"];
    const borders = SIDES.filter((side) => visibleBorder(node, side) > 0).length;
    return paintsBackground(node) || borders >= 3 || Boolean(shadow && shadow !== "none");
  }

  function locator(node) {
    let text = node.tag || "node";
    if (node.id) text += `#${node.id}`;
    else if (node.component) text += `[${node.component}${node.variant ? `:${node.variant}` : ""}]`;
    else if (node.cls && node.cls.length) text += `.${node.cls.slice(0, 3).join(".")}`;
    const label = String(node.text || (isInteractive(node) ? node.name : "") || "")
      .replace(/\s+/g, " ")
      .trim();
    if (label) text += ` "${label.slice(0, 40)}"`;
    return `${text} @${Math.round(node.rect.x)},${Math.round(node.rect.y)} ${Math.round(node.rect.w)}x${Math.round(node.rect.h)}`;
  }

  function capped(rows) {
    return rows.length > MAX_ROWS
      ? { rows: rows.slice(0, MAX_ROWS), omitted: rows.length - MAX_ROWS }
      : { rows, omitted: 0 };
  }

  function indexModel(model) {
    const byIndex = new Map(model.map((node) => [node.i, node]));
    const children = new Map();
    for (const node of model) {
      if (!children.has(node.parent)) children.set(node.parent, []);
      children.get(node.parent).push(node);
    }
    const flow = (node) =>
      (children.get(node.i) || []).filter(
        (child) =>
          !["absolute", "fixed"].includes(child.style && child.style.position) &&
          child.rect.w >= 4 &&
          child.rect.h >= 4
      );
    const ancestors = (node) => {
      const chain = [];
      const seen = new Set([node.i]);
      let current = byIndex.get(node.parent);
      while (current && !seen.has(current.i)) {
        seen.add(current.i);
        chain.push(current);
        current = byIndex.get(current.parent);
      }
      return chain;
    };
    return { byIndex, children, flow, ancestors };
  }

  function majorityOf(values) {
    const counts = new Map();
    for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
    return [...counts.entries()].sort(
      (left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]))
    );
  }

  // ---- Style sweep: like elements grouped, outliers listed ----

  function kindOf(node) {
    const tag = node.tag;
    const role = node.role || "";
    if (/^h[1-6]$/.test(tag)) return tag;
    if (role === "heading") return "heading";
    if (
      tag === "button" ||
      role === "button" ||
      (tag === "input" && ["button", "submit", "reset"].includes(node.type))
    )
      return "button";
    if (tag === "input" && ["checkbox", "radio", "range", "file", "hidden"].includes(node.type))
      return null;
    if (["input", "select", "textarea"].includes(tag)) return "field";
    if (role === "tab") return "tab";
    if (tag === "a" || role === "link") return "link";
    if (tag === "label") return "label";
    if (tag === "th") return "table-header";
    if (tag === "td") return "table-cell";
    if (tag === "li") return "list-item";
    if (tag === "svg") return "icon";
    if (tag === "hr") return "divider";
    if (tag === "p") return "paragraph";
    if (isSurface(node) && !["body", "html"].includes(tag)) return "surface";
    return null;
  }

  const TYPE_PROPS = ["font-size", "font-weight", "line-height", "color", "letter-spacing"];
  const BOX_PROPS = [
    "height",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "border-top-left-radius",
    "border-top-width",
    "border-top-color",
    "background-color",
  ];
  const KIND_PROPS = {
    button: [...BOX_PROPS, "font-size", "font-weight", "color"],
    field: [...BOX_PROPS, "font-size", "color"],
    tab: [...BOX_PROPS, "font-size", "font-weight", "color"],
    link: ["font-size", "font-weight", "color"],
    label: TYPE_PROPS,
    paragraph: TYPE_PROPS,
    heading: TYPE_PROPS,
    "table-header": [...TYPE_PROPS, "padding-top", "padding-left", "border-bottom-color"],
    "table-cell": [...TYPE_PROPS, "padding-top", "padding-left", "border-bottom-color"],
    "list-item": ["padding-top", "padding-left", "margin-bottom", "font-size"],
    icon: ["width", "height", "color"],
    divider: ["height", "border-top-color", "border-top-width", "background-color"],
    surface: [
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "border-top-left-radius",
      "border-top-width",
      "border-top-color",
      "background-color",
      "box-shadow",
    ],
  };

  function sweepModel(model) {
    const groups = new Map();
    for (const node of model) {
      if (!hasStyles(node)) continue;
      const kind = kindOf(node);
      if (!kind) continue;
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind).push(node);
    }
    const read = (node, property) =>
      property === "height"
        ? `${round(node.rect.h)}px`
        : property === "width"
          ? `${round(node.rect.w)}px`
          : String(node.style[property] ?? "");
    const result = [];
    const outliers = new Map();
    for (const [kind, nodes] of [...groups.entries()].sort()) {
      const properties = KIND_PROPS[kind] || KIND_PROPS.heading;
      const values = {};
      for (const property of properties) {
        const ranked = majorityOf(nodes.map((node) => read(node, property)));
        if (ranked.length < 2) continue;
        values[property] = ranked.map(([value, count]) => ({ value, count }));
        const [majorityValue, majorityCount] = ranked[0];
        // A value is an outlier only against a clear baseline. Two equal camps
        // are two variants, which the distribution above already shows.
        if (nodes.length < 3 || majorityCount * 2 < nodes.length) continue;
        const rare = Math.max(1, Math.floor(nodes.length / 4));
        for (const [value, count] of ranked.slice(1)) {
          if (count > rare) continue;
          for (const node of nodes.filter((candidate) => read(candidate, property) === value)) {
            // One row per element, so each element gets one disposition.
            if (!outliers.has(node.i))
              outliers.set(node.i, {
                kind,
                element: locator(node),
                peers: nodes.length,
                differs: [],
              });
            outliers.get(node.i).differs.push({ property, value, baseline: majorityValue });
          }
        }
      }
      result.push({ kind, count: nodes.length, differing: values });
    }
    const list = capped([...outliers.values()]);
    return { tool: "sweep", groups: result, outliers: list.rows, outliers_omitted: list.omitted };
  }

  // ---- Insets and edges ----

  function contentBounds(node, index) {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    const stack = [...(index.children.get(node.i) || [])];
    const seen = new Set();
    while (stack.length) {
      const child = stack.pop();
      if (seen.has(child.i)) continue;
      seen.add(child.i);
      const leaf = child.has_text || CONTENT_TAGS.has(child.tag) || child.content === true;
      if (leaf && child.rect.w > 0 && child.rect.h > 0) {
        left = Math.min(left, child.rect.x);
        top = Math.min(top, child.rect.y);
        right = Math.max(right, child.rect.x + child.rect.w);
        bottom = Math.max(bottom, child.rect.y + child.rect.h);
      }
      if (!CONTENT_TAGS.has(child.tag)) stack.push(...(index.children.get(child.i) || []));
    }
    return Number.isFinite(left) ? { left, top, right, bottom } : null;
  }

  function insetsModel(model) {
    const index = indexModel(model);
    const containers = [];
    const edges = [];
    const gaps = [];
    const rows = [];
    for (const node of model) {
      const flow = index.flow(node);
      if (isSurface(node) && !["html", "body"].includes(node.tag)) {
        const bounds = contentBounds(node, index);
        if (bounds) {
          const inset = {
            top: round(bounds.top - node.rect.y),
            right: round(node.rect.x + node.rect.w - bounds.right),
            bottom: round(node.rect.y + node.rect.h - bounds.bottom),
            left: round(bounds.left - node.rect.x),
          };
          const padding = hasStyles(node)
            ? Object.fromEntries(SIDES.map((side) => [side, px(node.style[`padding-${side}`])]))
            : null;
          const notes = [];
          if (padding && Math.abs(padding.left - padding.right) > 1)
            notes.push(`padding left ${padding.left}px, right ${padding.right}px`);
          if (padding && Math.abs(padding.top - padding.bottom) > 1)
            notes.push(`padding top ${padding.top}px, bottom ${padding.bottom}px`);
          if (inset.left < 0 || inset.top < 0 || inset.right < 0 || inset.bottom < 0)
            notes.push("content extends past the container edge");
          containers.push({ element: locator(node), inset, padding, notes });
        }
      }
      if (flow.length >= 3) {
        for (const edge of ["left", "right"]) {
          const read = (child) =>
            Math.round(edge === "left" ? child.rect.x : child.rect.x + child.rect.w);
          const ranked = majorityOf(flow.map(read));
          if (ranked.length < 2 || ranked[0][1] < 2 || ranked[0][1] * 2 < flow.length) continue;
          for (const child of flow) {
            const delta = read(child) - ranked[0][0];
            if (Math.abs(delta) >= 1 && (edge === "left" || Math.abs(delta) <= 24))
              edges.push({
                container: locator(node),
                element: locator(child),
                edge,
                delta_px: delta,
                siblings_sharing_baseline: ranked[0][1],
              });
          }
        }
        const ordered = [...flow].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
        const stacked = ordered.every(
          (child, position) =>
            position === 0 ||
            child.rect.y >= ordered[position - 1].rect.y + ordered[position - 1].rect.h - 1
        );
        if (stacked) {
          const spaces = ordered
            .slice(1)
            .map((child, position) =>
              Math.round(child.rect.y - (ordered[position].rect.y + ordered[position].rect.h))
            );
          const ranked = majorityOf(spaces);
          if (ranked.length > 1 && ranked[0][1] >= 2)
            spaces.forEach((space, position) => {
              if (space !== ranked[0][0])
                gaps.push({
                  container: locator(node),
                  after: locator(ordered[position]),
                  gap_px: space,
                  baseline_px: ranked[0][0],
                });
            });
        }
      }
      const controls = flow.filter((child) => ["button", "field"].includes(kindOf(child)));
      if (controls.length >= 2) {
        const first = controls[0];
        const sameRow = controls.filter(
          (child) =>
            child.rect.y < first.rect.y + first.rect.h && first.rect.y < child.rect.y + child.rect.h
        );
        const heights = new Set(sameRow.map((child) => Math.round(child.rect.h)));
        if (sameRow.length >= 2 && heights.size > 1)
          rows.push({
            container: locator(node),
            controls: sameRow.map((child) => ({
              element: locator(child),
              height_px: round(child.rect.h),
            })),
          });
      }
    }
    const noted = capped(containers.filter((entry) => entry.notes.length > 0));
    const edgeList = capped(edges);
    const gapList = capped(gaps);
    return {
      tool: "insets",
      containers_measured: containers.length,
      containers_with_notes: noted.rows,
      edge_deviations: edgeList.rows,
      gap_deviations: gapList.rows,
      rows_with_mixed_control_heights: capped(rows).rows,
      omitted: noted.omitted + edgeList.omitted + gapList.omitted,
    };
  }

  // ---- Nesting ----

  function nestingModel(model) {
    const index = indexModel(model);
    const doubledPadding = [];
    const nestedSurfaces = [];
    const adjacentBorders = [];
    const dividerColors = [];
    for (const node of model) {
      if (["html", "body"].includes(node.tag)) continue;
      const parent = index.byIndex.get(node.parent);
      const styled = hasStyles(node);
      if (parent && styled && hasStyles(parent) && !isSurface(node)) {
        const sides = SIDES.filter((side) => {
          const outer = px(parent.style[`padding-${side}`]);
          const inner = px(node.style[`padding-${side}`]);
          if (outer < 4 || inner < 4) return false;
          const flush =
            side === "left"
              ? Math.abs(node.rect.x - (parent.rect.x + outer)) <= 1
              : side === "top"
                ? Math.abs(node.rect.y - (parent.rect.y + outer)) <= 1
                : side === "right"
                  ? Math.abs(parent.rect.x + parent.rect.w - outer - (node.rect.x + node.rect.w)) <=
                    1
                  : Math.abs(parent.rect.y + parent.rect.h - outer - (node.rect.y + node.rect.h)) <=
                    1;
          return flush;
        });
        if (sides.length)
          doubledPadding.push({
            outer: locator(parent),
            inner: locator(node),
            sides: sides.map((side) => ({
              side,
              outer_px: px(parent.style[`padding-${side}`]),
              inner_px: px(node.style[`padding-${side}`]),
            })),
          });
      }
      if (isSurface(node)) {
        const outer = index
          .ancestors(node)
          .find((ancestor) => isSurface(ancestor) && !["html", "body"].includes(ancestor.tag));
        const bordered = (candidate) =>
          SIDES.some((side) => visibleBorder(candidate, side) > 0) ||
          Boolean(
            hasStyles(candidate) &&
            candidate.style["box-shadow"] &&
            candidate.style["box-shadow"] !== "none"
          ) ||
          candidate.surface === true;
        // A filled control inside a card is ordinary. Two outlined or raised
        // blocks, one inside the other, is the card-in-card pattern.
        if (outer && bordered(node) && bordered(outer) && !kindOf(node)?.match(/button|field|tab/))
          nestedSurfaces.push({ outer: locator(outer), inner: locator(node) });
      }
      if (parent && styled && hasStyles(parent)) {
        for (const side of SIDES) {
          if (visibleBorder(node, side) <= 0 || visibleBorder(parent, side) <= 0) continue;
          const distance =
            side === "left"
              ? node.rect.x - parent.rect.x
              : side === "top"
                ? node.rect.y - parent.rect.y
                : side === "right"
                  ? parent.rect.x + parent.rect.w - (node.rect.x + node.rect.w)
                  : parent.rect.y + parent.rect.h - (node.rect.y + node.rect.h);
          if (distance <= visibleBorder(parent, side) + 1)
            adjacentBorders.push({
              kind: "child border on parent border",
              side,
              first: locator(parent),
              second: locator(node),
            });
        }
      }
      const flow = index.flow(node).sort((a, b) => a.rect.y - b.rect.y);
      const colors = new Map();
      flow.forEach((child, position) => {
        if (!hasStyles(child)) return;
        for (const side of ["top", "bottom"])
          if (visibleBorder(child, side) > 0) {
            // Only like rows are compared: a card and a field may differ.
            const key = `${child.tag} ${child.style[`border-${side}-color`]}`;
            if (!colors.has(key)) colors.set(key, child);
          }
        const next = flow[position + 1];
        if (
          next &&
          hasStyles(next) &&
          visibleBorder(child, "bottom") > 0 &&
          visibleBorder(next, "top") > 0 &&
          Math.abs(next.rect.y - (child.rect.y + child.rect.h)) <= 1 &&
          next.rect.x < child.rect.x + child.rect.w &&
          child.rect.x < next.rect.x + next.rect.w
        )
          adjacentBorders.push({
            kind: "bottom border meets the next top border",
            side: "bottom",
            first: locator(child),
            second: locator(next),
          });
      });
      const byTag = new Map();
      for (const [key, example] of colors) {
        const [tag, ...color] = key.split(" ");
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push({ color: color.join(" "), example: locator(example) });
      }
      for (const entries of byTag.values())
        if (entries.length > 1) dividerColors.push({ container: locator(node), colors: entries });
    }
    const doubled = capped(doubledPadding);
    const nested = capped(nestedSurfaces);
    const adjacent = capped(adjacentBorders);
    const mixed = capped(dividerColors);
    return {
      tool: "nesting",
      doubled_padding: doubled.rows,
      surface_inside_surface: nested.rows,
      adjacent_borders: adjacent.rows,
      mixed_divider_colors: mixed.rows,
      omitted: doubled.omitted + nested.omitted + adjacent.omitted + mixed.omitted,
    };
  }

  // ---- Thresholds: facts for the accessibility dimension ----

  function effectiveBackground(node, index) {
    let color = { r: 255, g: 255, b: 255, a: 0 };
    const chain = [node, ...index.ancestors(node)];
    for (const candidate of chain) {
      if (!hasStyles(candidate)) continue;
      const image = candidate.style["background-image"];
      if (image && image !== "none") return null;
      const fill = parseColor(candidate.style["background-color"]);
      if (!fill) return null;
      color = blend(color, fill);
      if (color.a >= 0.99) return color;
    }
    return blend(color, { r: 255, g: 255, b: 255, a: 1 });
  }

  function isInteractive(node) {
    return (
      node.interactive === true ||
      (INTERACTIVE_TAGS.has(node.tag) && node.type !== "hidden") ||
      INTERACTIVE_ROLES.has(node.role || "")
    );
  }

  function thresholdsModel(model, options) {
    const minimumTarget = (options && options.minTarget) || 24;
    const index = indexModel(model);
    const contrast = [];
    const targets = [];
    const unnamed = [];
    let unmeasuredContrast = 0;
    for (const node of model) {
      if (node.has_text && hasStyles(node)) {
        const foreground = parseColor(node.style.color);
        const background = effectiveBackground(node, index);
        if (!foreground || !background) unmeasuredContrast += 1;
        else {
          const size = px(node.style["font-size"]);
          const weight = px(node.style["font-weight"]) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const ratio = contrastRatio(foreground, background);
          const required = large ? 3 : 4.5;
          if (ratio < required)
            contrast.push({
              element: locator(node),
              ratio,
              required,
              color: node.style.color,
              size_px: size,
            });
        }
      }
      if (isInteractive(node) && !node.disabled) {
        if (node.rect.w < minimumTarget || node.rect.h < minimumTarget)
          targets.push({
            element: locator(node),
            width: round(node.rect.w),
            height: round(node.rect.h),
            minimum: minimumTarget,
          });
        if (!String(node.name || "").trim()) unnamed.push({ element: locator(node) });
      }
    }
    return {
      tool: "thresholds",
      low_contrast_text: capped(contrast).rows,
      small_targets: capped(targets).rows,
      unnamed_controls: capped(unnamed).rows,
      text_with_unmeasured_contrast: unmeasuredContrast,
    };
  }

  // ---- Live page: collection and point query ----

  function accessibleName(element) {
    const labelled = element.getAttribute("aria-labelledby");
    if (labelled) {
      const text = labelled
        .split(/\s+/)
        .map((id) => (doc.getElementById(id) || {}).textContent || "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    const direct =
      element.getAttribute("aria-label") ||
      element.getAttribute("alt") ||
      element.getAttribute("title") ||
      element.getAttribute("placeholder");
    if (direct && direct.trim()) return direct.trim();
    if (element.labels && element.labels.length)
      return [...element.labels]
        .map((label) => label.textContent || "")
        .join(" ")
        .trim();
    const text = (element.textContent || "").trim();
    if (text) return text;
    const inner = element.querySelector && element.querySelector("[aria-label],[alt],title");
    if (inner)
      return (
        inner.getAttribute("aria-label") ||
        inner.getAttribute("alt") ||
        inner.textContent ||
        ""
      ).trim();
    return element.value && element.tagName.toLowerCase() === "input" ? String(element.value) : "";
  }

  function describe(element, i, parent) {
    const box = element.getBoundingClientRect();
    const computed = win.getComputedStyle(element);
    const style = {};
    for (const name of STYLE_NAMES) style[name] = computed.getPropertyValue(name);
    const tag = element.tagName.toLowerCase();
    let ownText = "";
    for (const child of element.childNodes)
      if (child.nodeType === 3 && child.textContent.trim()) ownText += `${child.textContent} `;
    const className =
      typeof element.className === "string"
        ? element.className
        : element.getAttribute("class") || "";
    return {
      i,
      parent,
      tag,
      role: element.getAttribute("role") || "",
      type: tag === "input" ? (element.getAttribute("type") || "text").toLowerCase() : "",
      id: element.id || "",
      cls: className.split(/\s+/).filter(Boolean),
      component: element.getAttribute("data-component") || "",
      variant: element.getAttribute("data-variant") || "",
      text: ownText.replace(/\s+/g, " ").trim().slice(0, 80),
      has_text: ownText.trim().length > 0,
      name: accessibleName(element).slice(0, 80),
      disabled:
        element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true",
      rect: {
        x: box.left + (win.scrollX || 0),
        y: box.top + (win.scrollY || 0),
        w: box.width,
        h: box.height,
      },
      style,
    };
  }

  function collect(rootSelector) {
    const root = rootSelector ? doc.querySelector(rootSelector) : doc.body;
    if (!root) throw new Error(`No element matches ${rootSelector}`);
    const model = [];
    let truncated = false;
    const walk = (element, parent) => {
      if (model.length >= MAX_ELEMENTS) {
        truncated = true;
        return;
      }
      const tag = element.tagName.toLowerCase();
      if (["script", "style", "noscript", "template", "head", "meta", "link"].includes(tag)) return;
      const node = describe(element, model.length, parent);
      const hidden =
        node.style.display === "none" ||
        node.style.visibility === "hidden" ||
        (node.style.opacity !== "" && px(node.style.opacity) < 0.01);
      if (hidden) return;
      // display: contents has no box of its own; its children still render.
      const boxless = node.rect.w <= 0 || node.rect.h <= 0;
      if (!boxless) model.push(node);
      if (tag === "svg") return;
      for (const child of element.children) walk(child, boxless ? parent : node.i);
    };
    walk(root, -1);
    return { model, truncated };
  }

  function resolve(target) {
    if (typeof target === "string") return doc.querySelector(target);
    if (target && typeof target.x === "number")
      return doc.elementFromPoint(target.x - (win.scrollX || 0), target.y - (win.scrollY || 0));
    return null;
  }

  function point(target) {
    const element = resolve(target);
    if (!element) return { tool: "point", error: "No element at that target" };
    const chain = [];
    let current = element;
    while (current && current.nodeType === 1 && chain.length < 40) {
      chain.push(describe(current, chain.length, chain.length + 1));
      current = current.parentElement;
    }
    chain[chain.length - 1].parent = -1;
    const node = chain[0];
    const index = indexModel(chain);
    const foreground = parseColor(node.style.color);
    const background = effectiveBackground(node, index);
    const sides = (prefix, suffix) =>
      Object.fromEntries(
        SIDES.map((side) => [side, node.style[`${prefix}-${side}${suffix || ""}`]])
      );
    return {
      tool: "point",
      element: locator(node),
      name: node.name,
      rect: {
        x: round(node.rect.x),
        y: round(node.rect.y),
        w: round(node.rect.w),
        h: round(node.rect.h),
      },
      type: {
        family: node.style["font-family"],
        size: node.style["font-size"],
        weight: node.style["font-weight"],
        line_height: node.style["line-height"],
        letter_spacing: node.style["letter-spacing"],
      },
      color: node.style.color,
      background: node.style["background-color"],
      effective_background: background
        ? `rgb(${Math.round(background.r)}, ${Math.round(background.g)}, ${Math.round(background.b)})`
        : null,
      contrast: foreground && background ? contrastRatio(foreground, background) : null,
      padding: sides("padding"),
      margin: sides("margin"),
      border_width: sides("border", "-width"),
      border_color: sides("border", "-color"),
      radius: node.style["border-top-left-radius"],
      shadow: node.style["box-shadow"],
      gap: { row: node.style["row-gap"], column: node.style["column-gap"] },
      ancestors: chain.slice(1, 5).map((ancestor) => ({
        element: locator(ancestor),
        padding: SIDES.map((side) => ancestor.style[`padding-${side}`]).join(" "),
        gap: `${ancestor.style["row-gap"]} ${ancestor.style["column-gap"]}`,
        surface: isSurface(ancestor),
      })),
    };
  }

  function live(analysis) {
    return (rootSelector, options) => {
      const collected = collect(rootSelector);
      const output = analysis(collected.model, options);
      output.elements = collected.model.length;
      if (collected.truncated) output.truncated_at_elements = MAX_ELEMENTS;
      output.viewport = {
        width: win.innerWidth,
        height: win.innerHeight,
        scroll_width: doc.documentElement.scrollWidth,
        device_pixel_ratio: win.devicePixelRatio,
      };
      // A hidden or collapsed browser pane lays the page out at no width, and
      // every number measured there describes that squeeze, not the product.
      if (!(win.innerWidth >= 200))
        output.warning = `The viewport is ${win.innerWidth}px wide. Show or resize the browser before trusting these values.`;
      return output;
    };
  }

  const api = {
    sweepModel,
    insetsModel,
    nestingModel,
    thresholdsModel,
    parseColor,
    contrastRatio,
    locator,
  };
  if (win && doc) {
    api.collect = collect;
    api.sweep = live(sweepModel);
    api.insets = live(insetsModel);
    api.nesting = live(nestingModel);
    api.thresholds = live(thresholdsModel);
    api.point = point;
    api.standard = (rootSelector) => ({
      sweep: api.sweep(rootSelector),
      insets: api.insets(rootSelector),
      nesting: api.nesting(rootSelector),
      thresholds: api.thresholds(rootSelector),
    });
  }
  return api;
}

// Source to evaluate in the page. It installs window.__pmMeasure and returns
// the standard sweep as a JSON string unless another call is named.
function snippet(call = "standard()") {
  if (!/^(standard|sweep|insets|nesting|thresholds|point)\([^;]*\)$/.test(call))
    throw new Error(
      "call must be one of standard(), sweep(), insets(), nesting(), thresholds(), point(...)"
    );
  return `(() => { window.__pmMeasure = (${createMeasure.toString()})({ window, document }); return JSON.stringify(window.__pmMeasure.${call}); })()`;
}

function analyzeModel(model, options = {}) {
  if (!Array.isArray(model)) throw new Error("model must be an array of elements");
  const normalized = model.map((node, position) => {
    if (!node || typeof node !== "object") throw new Error(`model[${position}] must be an object`);
    const rect = node.rect;
    if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite))
      throw new Error(`model[${position}].rect needs numeric x, y, w and h`);
    return {
      ...node,
      i: Number.isInteger(node.i) ? node.i : position,
      parent: Number.isInteger(node.parent) ? node.parent : -1,
      tag: String(node.tag || "node").toLowerCase(),
    };
  });
  const measure = createMeasure();
  const styled = normalized.some((node) => node.style && Object.keys(node.style).length > 0);
  return {
    ...(styled ? { sweep: measure.sweepModel(normalized) } : {}),
    insets: measure.insetsModel(normalized),
    nesting: measure.nestingModel(normalized),
    thresholds: measure.thresholdsModel(normalized, options),
    limits: styled
      ? []
      : ["The model has no style values: colour, padding and type were not measured."],
  };
}

function usage() {
  return [
    "Usage:",
    "  design-director-measure.js snippet [call]     Print JavaScript to evaluate in the page.",
    "                                                call: standard() | sweep() | insets() | nesting()",
    "                                                      | thresholds() | point('<selector>') | point({x,y})",
    "  design-director-measure.js analyze --model <file.json> [--min-target <px>]",
    "                                                Measure a supplied element model, such as a",
    "                                                native view hierarchy with rectangles only.",
  ].join("\n");
}

function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (command === "snippet") {
    process.stdout.write(`${snippet(rest[0] || "standard()")}\n`);
    return 0;
  }
  if (command === "analyze") {
    const fs = require("node:fs");
    const modelAt = rest.indexOf("--model");
    const targetAt = rest.indexOf("--min-target");
    if (modelAt < 0 || !rest[modelAt + 1]) {
      process.stderr.write(`${usage()}\n`);
      return 2;
    }
    const model = JSON.parse(fs.readFileSync(rest[modelAt + 1], "utf8"));
    const minTarget = targetAt >= 0 ? Number(rest[targetAt + 1]) : undefined;
    process.stdout.write(
      `${JSON.stringify(analyzeModel(model, minTarget ? { minTarget } : {}), null, 2)}\n`
    );
    return 0;
  }
  process.stderr.write(`${usage()}\n`);
  return 2;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { analyzeModel, createMeasure, snippet };
