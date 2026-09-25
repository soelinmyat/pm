"use strict";

// Maestro exposes native labels and geometry, not web roles or keyboard tab order.
function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} has missing or unexpected fields`);
}

function validateNativeControls(controls, nativeScope) {
  if (nativeScope !== undefined) {
    exact(nativeScope, ["kind", "reason"], "native scope");
    if (
      nativeScope.kind !== "noninteractive-change" ||
      typeof nativeScope.reason !== "string" ||
      nativeScope.reason.trim().length < 40 ||
      nativeScope.reason.length > 2000
    )
      throw new Error(
        "native scope requires noninteractive-change and a concrete 40-through-2000-character reason"
      );
    if (!Array.isArray(controls) || controls.length !== 0)
      throw new Error("noninteractive native scope requires an explicit empty controls array");
    return;
  }
  if (!Array.isArray(controls) || controls.length < 1 || controls.length > 100)
    throw new Error("native controls must contain 1 through 100 selectors");
  const seen = new Set();
  const selectors = new Map();
  for (const control of controls) {
    exact(
      control,
      ["by", "value", ...(Object.hasOwn(control || {}, "occurrence") ? ["occurrence"] : [])],
      "native control"
    );
    if (
      !["id", "label"].includes(control.by) ||
      typeof control.value !== "string" ||
      !control.value.trim() ||
      control.value.length > 500
    )
      throw new Error("native controls require an exact id or label selector");
    const hasOccurrence = Object.hasOwn(control, "occurrence");
    if (
      hasOccurrence &&
      (!Number.isInteger(control.occurrence) || control.occurrence < 0 || control.occurrence > 99)
    )
      throw new Error("native control occurrence must be an integer from 0 through 99");
    const selector = JSON.stringify([control.by, control.value]);
    const key = JSON.stringify([
      control.by,
      control.value,
      hasOccurrence ? control.occurrence : null,
    ]);
    if (seen.has(key)) throw new Error("native controls must be unique");
    if (selectors.has(selector) && selectors.get(selector) !== hasOccurrence)
      throw new Error("native controls cannot overlap default and occurrence selectors");
    seen.add(key);
    selectors.set(selector, hasOccurrence);
  }
}

function bounds(value) {
  const match = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(value);
  if (!match) throw new Error("native bounds must use Maestro [x,y][x,y] format");
  const result = match.slice(1).map(Number);
  if (
    result.some((n) => !Number.isSafeInteger(n) || Math.abs(n) > 1000000) ||
    result[2] < result[0] ||
    result[3] < result[1]
  )
    throw new Error("native bounds must be finite ordered coordinates");
  return result;
}

function normalizeNativeAccessibility(observations) {
  exact(
    observations,
    [
      "platform",
      "viewport",
      "controls",
      "hierarchy",
      ...(Object.hasOwn(observations || {}, "native_scope") ? ["native_scope"] : []),
    ],
    "native observations"
  );
  if (observations.platform !== "maestro-ios") throw new Error("unsupported native platform");
  exact(observations.viewport, ["width", "height", "scale"], "native viewport");
  const { width, height, scale } = observations.viewport;
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 10000) ||
    !Number.isFinite(scale) ||
    scale < 1 ||
    scale > 4
  )
    throw new Error("native viewport requires positive dimensions and scale from 1 through 4");
  validateNativeControls(observations.controls, observations.native_scope);
  const noninteractive = observations.native_scope !== undefined;
  const nodes = [];
  function walk(node, depth = 0) {
    if (depth > 100 || nodes.length >= 10000)
      throw new Error("native hierarchy exceeds node/depth budget");
    const flags = ["enabled", "focused", "checked", "selected"];
    exact(
      node,
      ["attributes", "children", ...flags.filter((key) => Object.hasOwn(node || {}, key))],
      "native hierarchy node"
    );
    if (
      !node.attributes ||
      typeof node.attributes !== "object" ||
      Array.isArray(node.attributes) ||
      !Array.isArray(node.children)
    )
      throw new Error("invalid native hierarchy node");
    for (const [key, value] of Object.entries(node.attributes)) {
      if (typeof value !== "string" || value.length > 10000)
        throw new Error("native attributes must be bounded strings");
      if (
        ["enabled", "focused", "selected", "checked"].includes(key) &&
        !["true", "false"].includes(value)
      )
        throw new Error(`native ${key} must be true or false`);
    }
    for (const key of flags) {
      if (
        Object.hasOwn(node, key) &&
        (typeof node[key] !== "boolean" ||
          (node.attributes[key] !== undefined && String(node[key]) !== node.attributes[key]))
      )
        throw new Error(`native ${key} state must be boolean and agree with attributes`);
    }
    const rectangle = node.attributes.bounds === undefined ? null : bounds(node.attributes.bounds);
    const enabled =
      node.attributes.enabled ??
      (Object.hasOwn(node, "enabled") ? String(node.enabled) : undefined);
    nodes.push({ attributes: node.attributes, rectangle, enabled });
    node.children.forEach((child) => walk(child, depth + 1));
  }
  walk(observations.hierarchy);
  const findings = [];
  const issue = (check, code, locator, detail) => findings.push({ check, code, locator, detail });
  if (
    !nodes.some(
      ({ rectangle: r }) => r && r[0] === 0 && r[1] === 0 && r[2] === width && r[3] === height
    )
  )
    issue(
      "native_screen",
      "missing-native-screen",
      "screen",
      "No hierarchy bounds match the declared logical viewport."
    );
  const label = (attributes) =>
    attributes.accessibilityText || attributes.text || attributes.title || "";
  const selectedNodes = new Set();
  for (const control of observations.controls) {
    const hasOccurrence = Object.hasOwn(control, "occurrence");
    const locator = `${control.by}:${control.value}${hasOccurrence ? `#${control.occurrence}` : ""}`;
    const matches = nodes.filter(
      ({ attributes }) =>
        (control.by === "id" ? attributes["resource-id"] : label(attributes)) === control.value
    );
    if (!matches.length || (!hasOccurrence && matches.length !== 1)) {
      issue(
        "native_screen",
        matches.length ? "ambiguous-native-control" : "missing-native-control",
        locator,
        `Expected one declared control; observed ${matches.length}.`
      );
      continue;
    }
    if (hasOccurrence && (matches.length === 1 || control.occurrence >= matches.length)) {
      issue(
        "native_screen",
        matches.length === 1
          ? "unnecessary-native-occurrence"
          : "native-control-occurrence-out-of-range",
        locator,
        `Occurrence selectors require repeated matches and an in-range index; observed ${matches.length}.`
      );
      continue;
    }
    const selected = matches[hasOccurrence ? control.occurrence : 0];
    if (selectedNodes.has(selected)) {
      issue(
        "native_screen",
        "duplicate-native-control",
        locator,
        "Another declared selector already selected this hierarchy node."
      );
      continue;
    }
    selectedNodes.add(selected);
    const { attributes, rectangle: r, enabled } = selected;
    if (!label(attributes).trim())
      issue(
        "names",
        "missing-accessible-name",
        locator,
        "Declared control has no accessible label."
      );
    if (enabled === undefined)
      issue(
        "native_screen",
        "missing-native-state",
        locator,
        "Declared control has no enabled state."
      );
    if (enabled !== "false") {
      if (!r)
        issue(
          "touch_targets",
          "missing-native-bounds",
          locator,
          "Declared control has no measured bounds."
        );
      else {
        if (r[2] - r[0] < 44 || r[3] - r[1] < 44)
          issue(
            "touch_targets",
            "small-touch-target",
            locator,
            "Enabled control is smaller than 44 by 44 logical points."
          );
        if (r[0] < 0 || r[1] < 0 || r[2] > width || r[3] > height)
          issue(
            "touch_targets",
            "clipped-touch-target",
            locator,
            "Enabled control extends outside the captured viewport."
          );
      }
    }
  }
  return {
    platform: "maestro-ios",
    controls: observations.controls.map((control) => ({ ...control })),
    ...(noninteractive ? { native_scope: { ...observations.native_scope } } : {}),
    limitations: [
      ...(noninteractive
        ? [
            "Noninteractive changed content only. No interaction, accessible-name or touch-target certificate is emitted; source-bound Primary review must verify the declared scope and reason.",
          ]
        : []),
      noninteractive
        ? "Only measured screen geometry is checked; VoiceOver traversal, semantics, occlusion and focus order require separate manual review."
        : "Scoped Maestro labels, enabled state and viewport geometry only; VoiceOver traversal, semantics, occlusion and focus order require separate manual review.",
    ],
    checks: Object.fromEntries(
      (noninteractive ? ["native_screen"] : ["native_screen", "names", "touch_targets"]).map(
        (check) => [check, !findings.some((finding) => finding.check === check)]
      )
    ),
    findings,
  };
}

module.exports = { normalizeNativeAccessibility, validateNativeControls };
