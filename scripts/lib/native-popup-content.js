"use strict";

const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const OPEN_STATES = new Set(["modal", "empty", "keyboard"]);
const same = (a, b) => isDeepStrictEqual(a, b);
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replace(/\s+/g, " ").trim();

// Select geometry only after the caller authenticates the complete trusted
// capture and assertion. This is not pixel acceptance: the existing regional
// inspector must still require meaningful images and material pixel support.
function nativePopupStateRegion(left, right, observations) {
  if (
    !left?.capture ||
    !right?.capture ||
    !left.coverage ||
    !right.coverage ||
    !(observations instanceof Map) ||
    typeof left.coverage.subject_id !== "string" ||
    !left.coverage.subject_id ||
    left.coverage.state === right.coverage.state ||
    left.coverage.subject_id !== right.coverage.subject_id ||
    left.capture.full_page !== false ||
    right.capture.full_page !== false ||
    left.capture.width !== right.capture.width ||
    left.capture.height !== right.capture.height
  )
    return null;
  const a = context(left, observations?.get(left.capture.id));
  const b = context(right, observations?.get(right.capture.id));
  if (!a || !b || !same(a.viewport, b.viewport)) return null;
  const openA = popup(a),
    openB = popup(b);
  if (openA && openB) {
    if (
      openA.name !== openB.name ||
      !same(openA.owner.bounds, openB.owner.bounds) ||
      openA.bounds.x !== openB.bounds.x ||
      openA.bounds.y !== openB.bounds.y ||
      openA.bounds.width !== openB.bounds.width ||
      !hasContentTransition(a, openA, b, openB)
    )
      return null;
    return { ...openA.bounds, height: Math.max(openA.bounds.height, openB.bounds.height) };
  }
  if (openA && collapsed(b, openA)) return { ...openA.bounds };
  if (openB && collapsed(a, openB)) return { ...openB.bounds };
  return null;
}

function context(side, observation) {
  const viewport = observation?.manifest?.page?.css_viewport;
  const assertion = observation?.assertion;
  const visibility = observation?.manifest?.page?.state_assertion;
  if (
    !viewport ||
    assertion?.schema_version !== 2 ||
    assertion.state !== side.coverage.state ||
    visibility?.passed !== true ||
    !Array.isArray(assertion.all) ||
    assertion.all.length < 1 ||
    assertion.all.length > 20 ||
    !Array.isArray(visibility.visibility?.checks) ||
    visibility.visibility.checks.length > 21 ||
    !Number.isInteger(side.capture.width) ||
    !Number.isInteger(side.capture.height) ||
    viewport.inner_width !== side.capture.width ||
    viewport.inner_height !== side.capture.height
  )
    return null;
  return { assertion, checks: visibility.visibility.checks, viewport, state: side.coverage.state };
}

function named(locator) {
  if (locator?.by !== "role-name" || typeof locator.value !== "string") return null;
  const at = locator.value.indexOf(":");
  const role = locator.value.slice(0, at).trim().toLowerCase();
  const name = locator.value.slice(at + 1).trim();
  return at > 0 && name && locator.value.length <= 500 ? { role, name } : null;
}

function validBounds(bounds, viewport) {
  return (
    bounds &&
    ["x", "y", "width", "height"].every((k) => Number.isInteger(bounds[k])) &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.width >= 32 &&
    bounds.height >= 8 &&
    bounds.x + bounds.width <= viewport.inner_width &&
    bounds.y + bounds.height <= viewport.inner_height
  );
}

function contains(parent, child) {
  return (
    child.x >= parent.x &&
    child.y >= parent.y &&
    child.x + child.width <= parent.x + parent.width &&
    child.y + child.height <= parent.y + parent.height
  );
}

function visible(ctx, locator, role) {
  const clauses = ctx.assertion.all.flatMap((guard, index) =>
    guard?.expect?.kind === "visible" && same(guard.locator, locator) ? [index] : []
  );
  if (clauses.length !== 1) return null;
  const rows = ctx.checks.filter(
    (check) => check?.label === `state assertion clause ${clauses[0] + 1}`
  );
  if (rows.length !== 1) return null;
  const check = rows[0];
  if (
    String(check.native_role).toLowerCase() !== role ||
    check.native_name_present !== true ||
    !Number.isInteger(check.asserted_backend_node_id) ||
    check.asserted_backend_node_id <= 0 ||
    !Number.isInteger(check.hit_backend_node_id) ||
    check.hit_backend_node_id <= 0 ||
    !validBounds(check.visual_bounds, ctx.viewport)
  )
    return null;
  const text = named(locator);
  if (role === "statictext" && (!text || check.native_name_sha256 !== hash(text.name))) return null;
  return { bounds: check.visual_bounds, backend: check.asserted_backend_node_id };
}

function attribute(ctx, locator, name) {
  const guards = ctx.assertion.all.filter(
    (guard) =>
      same(guard?.locator, locator) &&
      guard?.expect?.kind === "attribute-equals" &&
      guard.expect.name === name
  );
  return guards.length === 1 ? guards[0].expect.value : null;
}

function owner(ctx, name, expanded) {
  const locator = { by: "role-name", value: `combobox:${name}` };
  const proof = visible(ctx, locator, "combobox");
  return proof && proof.bounds.height >= 20 && attribute(ctx, locator, "aria-expanded") === expanded
    ? { ...proof, locator }
    : null;
}

function popup(ctx) {
  if (!OPEN_STATES.has(ctx.state)) return null;
  const dialogs = ctx.assertion.all.filter(
    (guard) => guard?.expect?.kind === "visible" && named(guard.locator)?.role === "dialog"
  );
  if (dialogs.length !== 1) return null;
  const declaration = dialogs[0];
  const name = named(declaration.locator).name;
  const region = visible(ctx, declaration.locator, "dialog");
  const control = owner(ctx, name, "true");
  if (!region || region.bounds.height < 32 || !control || region.backend === control.backend)
    return null;
  const id = attribute(ctx, control.locator, "aria-controls");
  if (typeof id !== "string" || !/^\S{1,500}$/.test(id)) return null;
  const byId = visible(ctx, { by: "id", value: id }, "dialog");
  if (!byId || byId.backend !== region.backend || !same(byId.bounds, region.bounds)) return null;
  if (ctx.state === "keyboard" && !focusedSearch(ctx, region.bounds)) return null;
  const content = [];
  for (const guard of ctx.assertion.all) {
    const text = named(guard?.locator);
    if (guard?.expect?.kind !== "visible" || !["option", "statictext"].includes(text?.role))
      continue;
    const child = visible(ctx, guard.locator, text.role);
    if (child && child.backend !== region.backend && contains(region.bounds, child.bounds))
      content.push({ name: normalize(text.name), locator: guard.locator });
  }
  return content.length ? { name, bounds: region.bounds, owner: control, content } : null;
}

function hasContentTransition(a, openA, b, openB) {
  const names = (popup) => [...new Set(popup.content.map((x) => x.name))].sort();
  if (same(names(openA), names(openB))) return false;
  // Different positive assertion subsets are not an inventory. At least one
  // exact visible semantic node must be proved absent in the other capture.
  const disappears = (popup, counterpart) =>
    popup.content.some(({ locator }) =>
      counterpart.assertion.all.some(
        (guard) => guard?.expect?.kind === "absent" && same(guard.locator, locator)
      )
    );
  return disappears(openA, b) || disappears(openB, a);
}

function focusedSearch(ctx, bounds) {
  return ctx.assertion.all.some((guard) => {
    if (guard?.expect?.kind !== "focused") return false;
    const input =
      visible(ctx, guard.locator, "textbox") || visible(ctx, guard.locator, "searchbox");
    if (!input || !contains(bounds, input.bounds)) return false;
    return (
      Array.isArray(ctx.assertion.before_capture) &&
      ctx.assertion.before_capture.some(
        (action) =>
          (action.kind === "caret-left" && same(action.locator, guard.locator)) ||
          (action.kind === "tab" && Number.isInteger(action.count) && action.count > 0)
      )
    );
  });
}

function collapsed(ctx, open) {
  if (ctx.state !== "primary") return false;
  const control = owner(ctx, open.name, "false");
  return (
    control &&
    same(control.bounds, open.owner.bounds) &&
    ctx.assertion.all.some(
      (guard) =>
        guard?.expect?.kind === "absent" &&
        same(guard.locator, { by: "role-name", value: `dialog:${open.name}` })
    )
  );
}

module.exports = { nativePopupStateRegion };
