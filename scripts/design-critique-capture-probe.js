#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const MAX_CDP_MESSAGE_CHARS = 96 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const MAX_LANDMARKS = 100;
const MAX_CONTROLS = 1000;
const MAX_DOM_ISSUES = 200;
const MAX_NETWORK_REQUESTS = 2000;
const MIN_EFFECTIVE_OPACITY = 0.01;
const INTERNAL_SCHEMES = new Set(["about:", "data:"]);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function digest(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function redactedUrlIdentity(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.username || parsed.password) throw new Error("page URL cannot contain credentials");
  const internal = INTERNAL_SCHEMES.has(parsed.protocol);
  return {
    origin: internal ? parsed.protocol : parsed.origin,
    pathname: internal ? "" : parsed.pathname,
    has_query: parsed.search.length > 0,
    has_fragment: parsed.hash.length > 0,
    full_url_sha256: digest(Buffer.from(parsed.href)),
  };
}

function appendBoundedEvidence(collection, value, limit, label) {
  if (collection.length >= limit) throw new Error(`${label} exceed the ${limit}-item budget`);
  collection.push(value);
}

function writeExclusiveFile(outputPath, encoded, label) {
  if (typeof encoded !== "string" || encoded.length > Math.ceil((MAX_CAPTURE_BYTES * 4) / 3) + 4)
    throw new Error(`${label} exceeds the ${MAX_CAPTURE_BYTES}-byte capture budget`);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > MAX_CAPTURE_BYTES)
    throw new Error(`${label} exceeds the ${MAX_CAPTURE_BYTES}-byte capture budget`);
  let descriptor;
  try {
    descriptor = fs.openSync(
      outputPath,
      fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    const stat = fs.fstatSync(descriptor, { bigint: true });
    return {
      dev: String(stat.dev),
      ino: String(stat.ino),
      size: String(stat.size),
      mtime_ns: String(stat.mtimeNs),
      ctime_ns: String(stat.ctimeNs),
      sha256: digest(bytes),
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function requestJson(url, method = "GET", timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const request = http
      .request(url, { method }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 1024 * 1024)
            request.destroy(new Error("CDP HTTP response exceeds limit"));
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject);
    request.setTimeout?.(timeoutMs, () => request.destroy(new Error("CDP HTTP request timed out")));
    request.end();
  });
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("CDP WebSocket connection timed out")),
      5_000
    );
    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("CDP WebSocket connection failed"));
      },
      { once: true }
    );
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const raw = String(event.data);
    if (raw.length > MAX_CDP_MESSAGE_CHARS) {
      for (const waiter of pending.values()) waiter.reject(new Error("CDP response exceeds limit"));
      pending.clear();
      socket.close();
      return;
    }
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.id && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result || {});
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    close() {
      socket.close();
    },
  };
}

function originForPolicy(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "invalid:";
  }
  if (INTERNAL_SCHEMES.has(parsed.protocol)) return parsed.protocol;
  if (parsed.protocol === "blob:") {
    try {
      return new URL(rawUrl.slice("blob:".length)).origin;
    } catch {
      return "blob:";
    }
  }
  return parsed.origin === "null" ? parsed.protocol : parsed.origin;
}

function sanitizeRequest(request, sequence) {
  const method = String(request.method || "GET");
  const resourceType = String(request.resourceType || "Other");
  const origin = originForPolicy(request.url);
  if (!method || method.length > 20) throw new Error("network method exceeds 20 characters");
  if (!resourceType || resourceType.length > 40)
    throw new Error("network resource type exceeds 40 characters");
  if (!origin || origin.length > 4096) throw new Error("network origin exceeds 4096 characters");
  return {
    sequence,
    method,
    resource_type: resourceType,
    origin,
    url_sha256: digest(Buffer.from(String(request.url || ""))),
  };
}

function requestAllowed(rawUrl, allowedOrigins) {
  const origin = originForPolicy(rawUrl);
  return INTERNAL_SCHEMES.has(origin) || allowedOrigins.has(origin);
}

function valueOf(property) {
  if (property?.value && typeof property.value === "object") return property.value.value;
  return property?.value;
}

function snapshotNodeModel(snapshot) {
  const strings = snapshot.strings || [];
  if (snapshot.documents?.length !== 1)
    throw new Error("trusted capture does not support iframe documents");
  const document = snapshot.documents?.[0];
  if (!document?.nodes || !document?.layout) throw new Error("DOM snapshot omitted its document");
  const nodes = document.nodes;
  const count = nodes.nodeName?.length || 0;
  if (count < 1 || count > 50_000) throw new Error("DOM snapshot node count is outside bounds");
  const layoutByNode = new Map();
  for (let index = 0; index < document.layout.nodeIndex.length; index += 1) {
    const nodeIndex = document.layout.nodeIndex[index];
    layoutByNode.set(nodeIndex, {
      bounds: document.layout.bounds[index],
      styles: (document.layout.styles[index] || []).map((value) => strings[value] || ""),
    });
  }
  const model = [];
  for (let index = 0; index < count; index += 1) {
    const attributes = {};
    const rawAttributes = nodes.attributes?.[index] || [];
    for (let offset = 0; offset + 1 < rawAttributes.length; offset += 2)
      attributes[strings[rawAttributes[offset]] || ""] = strings[rawAttributes[offset + 1]] || "";
    model.push({
      index,
      backendNodeId: nodes.backendNodeId?.[index],
      parentIndex: nodes.parentIndex?.[index] ?? -1,
      nodeName: (strings[nodes.nodeName[index]] || "").toLowerCase(),
      attributes,
      layout: layoutByNode.get(index) || null,
    });
  }
  return model;
}

function nodeLocator(node) {
  let locator;
  if (node.attributes.id) locator = `${node.nodeName}#${node.attributes.id}`;
  else if (node.attributes["data-testid"])
    locator = `[data-testid="${node.attributes["data-testid"]}"]`;
  const classes = (node.attributes.class || "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
  locator ||= `${node.nodeName || "node"}${classes ? `.${classes}` : ""}[backend=${node.backendNodeId}]`;
  if (locator.length > 500) throw new Error("accessibility locator exceeds 500 characters");
  return locator;
}

function tabIndexForNode(node, role) {
  if (Object.prototype.hasOwnProperty.call(node.attributes, "tabindex")) {
    const value = Number(node.attributes.tabindex);
    return Number.isInteger(value) && value >= -1 && value <= 32767 ? value : -1;
  }
  if (
    ["a", "area", "button", "input", "select", "textarea", "summary"].includes(node.nodeName) ||
    node.attributes.contenteditable === "" ||
    node.attributes.contenteditable === "true"
  )
    return 0;
  return [
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "option",
    "slider",
    "spinbutton",
    "textbox",
    "combobox",
    "searchbox",
  ].includes(role)
    ? -1
    : 0;
}

function accessibilityObservations(axTree, model) {
  const byBackendId = new Map(
    model
      .filter((node) => Number.isInteger(node.backendNodeId))
      .map((node) => [node.backendNodeId, node])
  );
  const landmarks = [];
  const controls = [];
  const landmarkRoles = new Set([
    "banner",
    "navigation",
    "main",
    "complementary",
    "contentinfo",
    "form",
    "region",
    "search",
  ]);
  const controlRoles = new Set([
    "button",
    "link",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "option",
    "slider",
    "spinbutton",
    "textbox",
    "combobox",
    "searchbox",
  ]);
  for (const axNode of axTree.nodes || []) {
    if (axNode.ignored === true || !Number.isInteger(axNode.backendDOMNodeId)) continue;
    const role = String(valueOf(axNode.role) || "").toLowerCase();
    if (!role) continue;
    const node = byBackendId.get(axNode.backendDOMNodeId);
    if (!node) continue;
    const name = String(valueOf(axNode.name) || "")
      .replace(/\s+/g, " ")
      .trim();
    if (name.length > 1000) throw new Error("accessible name exceeds 1000 characters");
    const locator = nodeLocator(node);
    if (landmarkRoles.has(role)) {
      appendBoundedEvidence(
        landmarks,
        { role, name, locator },
        MAX_LANDMARKS,
        "accessibility landmarks"
      );
    }
    if (controlRoles.has(role)) {
      const properties = new Map(
        (axNode.properties || []).map((item) => [item.name, valueOf(item)])
      );
      appendBoundedEvidence(
        controls,
        {
          role,
          name,
          locator,
          disabled:
            properties.get("disabled") === true ||
            Object.prototype.hasOwnProperty.call(node.attributes, "disabled") ||
            node.attributes["aria-disabled"] === "true",
          tab_index: tabIndexForNode(node, role),
          document_index: node.index,
        },
        MAX_CONTROLS,
        "accessibility controls"
      );
    }
  }
  return { landmarks, controls };
}

function visibleIntersection(node, model, style, metrics) {
  const bounds = node?.layout?.bounds;
  if (!Array.isArray(bounds) || bounds[2] <= 0 || bounds[3] <= 0) return null;
  const viewport = metrics.cssVisualViewport;
  let left = Math.max(bounds[0], viewport.pageX);
  let top = Math.max(bounds[1], viewport.pageY);
  let right = Math.min(bounds[0] + bounds[2], viewport.pageX + viewport.clientWidth);
  let bottom = Math.min(bounds[1] + bounds[3], viewport.pageY + viewport.clientHeight);
  if (right <= left || bottom <= top) return null;
  let effectiveOpacity = 1;
  let current = node;
  const seen = new Set();
  while (current && !seen.has(current.index)) {
    seen.add(current.index);
    if (
      Object.prototype.hasOwnProperty.call(current.attributes, "hidden") ||
      style(current, "display") === "none" ||
      new Set(["hidden", "collapse"]).has(style(current, "visibility")) ||
      style(current, "content-visibility") === "hidden"
    )
      return null;
    const opacity = Number.parseFloat(style(current, "opacity") || "1");
    effectiveOpacity *= Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1;
    if (effectiveOpacity < MIN_EFFECTIVE_OPACITY) return null;
    if (current !== node && current.layout?.bounds) {
      const ancestor = current.layout.bounds;
      const overflowX = style(current, "overflow-x") || style(current, "overflow");
      const overflowY = style(current, "overflow-y") || style(current, "overflow");
      if (overflowX && overflowX !== "visible") {
        left = Math.max(left, ancestor[0]);
        right = Math.min(right, ancestor[0] + ancestor[2]);
      }
      if (overflowY && overflowY !== "visible") {
        top = Math.max(top, ancestor[1]);
        bottom = Math.min(bottom, ancestor[1] + ancestor[3]);
      }
      if (right <= left || bottom <= top) return null;
    }
    current = current.parentIndex >= 0 ? model[current.parentIndex] : null;
  }
  return { left, top, right, bottom, effectiveOpacity };
}

function nodeVisibleInViewport(node, model, style, metrics) {
  return visibleIntersection(node, model, style, metrics) !== null;
}

function isNodeOrDescendant(hitBackendNodeId, assertedNode, model) {
  const hit = model.find((node) => node.backendNodeId === hitBackendNodeId);
  if (!hit) return false;
  let current = hit;
  const seen = new Set();
  while (current && !seen.has(current.index)) {
    if (current.index === assertedNode.index) return true;
    seen.add(current.index);
    current = current.parentIndex >= 0 ? model[current.parentIndex] : null;
  }
  return false;
}

function descendantChain(hitBackendNodeId, assertedNode, model) {
  let current = model.find((node) => node.backendNodeId === hitBackendNodeId);
  if (!current) return [];
  const seen = new Set();
  const chain = [];
  while (current && !seen.has(current.index)) {
    if (current.index === assertedNode.index) return chain;
    seen.add(current.index);
    chain.push(current);
    current = current.parentIndex >= 0 ? model[current.parentIndex] : null;
  }
  return [];
}

function positionedDescendantCovers(node, assertedIntersection, model, style, metrics) {
  if (!node || !new Set(["absolute", "fixed", "sticky"]).has(style(node, "position"))) return false;
  const descendantIntersection = visibleIntersection(node, model, style, metrics);
  if (!descendantIntersection) return false;
  const left = Math.max(assertedIntersection.left, descendantIntersection.left);
  const top = Math.max(assertedIntersection.top, descendantIntersection.top);
  const right = Math.min(assertedIntersection.right, descendantIntersection.right);
  const bottom = Math.min(assertedIntersection.bottom, descendantIntersection.bottom);
  const assertedArea =
    (assertedIntersection.right - assertedIntersection.left) *
    (assertedIntersection.bottom - assertedIntersection.top);
  const overlapArea = Math.max(0, right - left) * Math.max(0, bottom - top);
  return assertedArea > 0 && overlapArea / assertedArea >= 0.9;
}

async function verifyAssertionHitTargets(client, requirements, model, style, metrics) {
  const checks = [];
  for (const requirement of requirements) {
    const intersection = visibleIntersection(requirement.node, model, style, metrics);
    if (!intersection) throw new Error(`${requirement.label} is not visibly rendered`);
    const width = intersection.right - intersection.left;
    const height = intersection.bottom - intersection.top;
    const pageX = metrics.cssVisualViewport.pageX;
    const pageY = metrics.cssVisualViewport.pageY;
    const points = [
      [0.5, 0.5],
      [0.1, 0.1],
      [0.9, 0.1],
      [0.1, 0.9],
      [0.9, 0.9],
    ].map(([xRatio, yRatio]) => ({
      x: Math.floor(intersection.left + width * xRatio - pageX),
      y: Math.floor(intersection.top + height * yRatio - pageY),
    }));
    const accepted = [];
    for (const point of points) {
      const hit = await client.send("DOM.getNodeForLocation", {
        x: point.x,
        y: point.y,
        includeUserAgentShadowDOM: true,
        ignorePointerEventsNone: true,
      });
      if (isNodeOrDescendant(hit.backendNodeId, requirement.node, model))
        accepted.push({ ...point, backend_node_id: hit.backendNodeId });
    }
    if (accepted.length === 0) throw new Error(`${requirement.label} is fully occluded`);
    if (requirement.label === "state marker" && accepted.length === points.length) {
      const chains = accepted.map((hit) =>
        descendantChain(hit.backend_node_id, requirement.node, model)
      );
      const commonCoveringDescendant = (chains[0] || []).find(
        (node) =>
          chains.every((chain) => chain.some((candidate) => candidate.index === node.index)) &&
          positionedDescendantCovers(node, intersection, model, style, metrics)
      );
      if (commonCoveringDescendant)
        throw new Error(`${requirement.label} is covered by a positioned descendant`);
    }
    const acceptedPoint = accepted[0];
    checks.push({
      label: requirement.label,
      asserted_backend_node_id: requirement.node.backendNodeId,
      hit_backend_node_id: acceptedPoint.backend_node_id,
      x: acceptedPoint.x,
      y: acceptedPoint.y,
    });
  }
  return {
    method: "cdp-dom-get-node-for-location-v1",
    effective_opacity_floor: MIN_EFFECTIVE_OPACITY,
    verified_nodes: checks.length,
    checks,
  };
}

function evaluateStateAssertion(assertion, model, axTree, computedStyles, metrics) {
  const styleIndex = new Map(computedStyles.map((name, index) => [name, index]));
  const style = (node, name) => node.layout?.styles?.[styleIndex.get(name)] || "";
  const visible = (node) => nodeVisibleInViewport(node, model, style, metrics);
  const byBackendId = new Map(
    model
      .filter((node) => Number.isInteger(node.backendNodeId))
      .map((node) => [node.backendNodeId, node])
  );
  const axByBackendId = new Map(
    (axTree.nodes || [])
      .filter((node) => node.ignored !== true && Number.isInteger(node.backendDOMNodeId))
      .map((node) => [node.backendDOMNodeId, node])
  );
  const locate = (locator) => {
    let matches;
    if (locator.by === "id") matches = model.filter((node) => node.attributes.id === locator.value);
    else if (locator.by === "test-id")
      matches = model.filter((node) => node.attributes["data-testid"] === locator.value);
    else {
      const separator = locator.value.indexOf(":");
      const role = locator.value.slice(0, separator).trim().toLowerCase();
      const name = locator.value
        .slice(separator + 1)
        .trim()
        .replace(/\s+/g, " ");
      matches = (axTree.nodes || [])
        .filter(
          (node) =>
            node.ignored !== true &&
            Number.isInteger(node.backendDOMNodeId) &&
            String(valueOf(node.role) || "").toLowerCase() === role &&
            String(valueOf(node.name) || "")
              .trim()
              .replace(/\s+/g, " ") === name
        )
        .map((node) => byBackendId.get(node.backendDOMNodeId))
        .filter(Boolean);
    }
    return matches;
  };
  const stateMatches = locate(assertion.state_marker.locator);
  if (stateMatches.length !== 1)
    throw new Error(`state marker expected exactly one match; observed ${stateMatches.length}`);
  const stateNode = stateMatches[0];
  if (!visible(stateNode)) throw new Error("state marker must be visibly rendered in the viewport");
  if (stateNode.attributes[assertion.state_marker.attribute] !== assertion.state_marker.value)
    throw new Error("state marker does not establish the routed state");

  const hitRequirements = [{ label: "state marker", node: stateNode }];

  for (const [index, clause] of assertion.all.entries()) {
    const matches = locate(clause.locator);
    if (clause.expect.kind === "absent") {
      if (matches.length !== 0)
        throw new Error(`state assertion clause ${index + 1} expected absence`);
      continue;
    }
    if (matches.length !== 1)
      throw new Error(
        `state assertion clause ${index + 1} expected exactly one match; observed ${matches.length}`
      );
    const node = matches[0];
    const axNode = axByBackendId.get(node.backendNodeId);
    if (clause.expect.kind === "visible" && !visible(node))
      throw new Error(`state assertion clause ${index + 1} expected a visible node`);
    if (clause.expect.kind === "visible")
      hitRequirements.push({ label: `state assertion clause ${index + 1}`, node });
    if (
      clause.expect.kind === "attribute-equals" &&
      node.attributes[clause.expect.name] !== clause.expect.value
    )
      throw new Error(`state assertion clause ${index + 1} attribute did not match`);
    if (
      clause.expect.kind === "accessible-name-equals" &&
      String(valueOf(axNode?.name) || "")
        .trim()
        .replace(/\s+/g, " ") !== clause.expect.value
    )
      throw new Error(`state assertion clause ${index + 1} accessible name did not match`);
    if (clause.expect.kind === "focused") {
      const focused = (axNode?.properties || []).find((property) => property.name === "focused");
      if (valueOf(focused) !== true)
        throw new Error(`state assertion clause ${index + 1} expected focus`);
    }
  }
  return hitRequirements;
}

function parsePixels(value) {
  const parsed = Number.parseFloat(String(value || "0"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function domObservations(model, metrics, computedStyles) {
  const styleIndex = new Map(computedStyles.map((name, index) => [name, index]));
  const style = (node, name) => node.layout?.styles?.[styleIndex.get(name)] || "";
  const visible = (node) => {
    const bounds = node.layout?.bounds;
    return (
      Array.isArray(bounds) &&
      bounds[2] > 0 &&
      bounds[3] > 0 &&
      style(node, "display") !== "none" &&
      style(node, "visibility") !== "hidden"
    );
  };
  const issue = (code, node, detail) => {
    const locator = typeof node === "string" ? node : nodeLocator(node);
    const description = String(detail);
    if (locator.length > 500) throw new Error("DOM issue locator exceeds 500 characters");
    if (description.length > 1000) throw new Error("DOM issue detail exceeds 1000 characters");
    return { code, locator, detail: description };
  };
  const hierarchy = [];
  const edgeAlignment = [];
  const consistency = [];
  const asymmetry = [];
  const addIssue = (collection, value, kind) => {
    appendBoundedEvidence(collection, value, MAX_DOM_ISSUES, `${kind} observations`);
  };
  const visibleNodes = model.filter(visible);
  const headings = new Map();
  for (const node of visibleNodes.filter((candidate) => /^h[1-6]$/.test(candidate.nodeName))) {
    if (!headings.has(node.nodeName)) headings.set(node.nodeName, []);
    headings.get(node.nodeName).push(node);
  }
  const levels = [...headings.keys()].sort();
  const majorityNumber = (nodes, property) => {
    const counts = new Map();
    for (const node of nodes) {
      const value = parsePixels(style(node, property));
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return (
      [...counts.entries()].sort(
        (left, right) => right[1] - left[1] || left[0] - right[0]
      )[0]?.[0] || 0
    );
  };
  for (let index = 0; index + 1 < levels.length; index += 1) {
    const upper = levels[index];
    const lower = levels[index + 1];
    const upperSize = majorityNumber(headings.get(upper), "font-size");
    const lowerSize = majorityNumber(headings.get(lower), "font-size");
    if (lowerSize >= upperSize)
      addIssue(
        hierarchy,
        issue(
          lowerSize > upperSize ? "inverted-heading-size" : "collapsed-heading-size",
          `${upper}>${lower}`,
          `${lower} (${lowerSize}px) is not smaller than ${upper} (${upperSize}px).`
        ),
        "hierarchy"
      );
    const upperWeight = majorityNumber(headings.get(upper), "font-weight");
    const lowerWeight = majorityNumber(headings.get(lower), "font-weight");
    if (lowerWeight - upperWeight >= 200)
      addIssue(
        hierarchy,
        issue(
          "inverted-heading-weight",
          `${upper}>${lower}`,
          `${lower} (${lowerWeight}) is substantially bolder than ${upper} (${upperWeight}).`
        ),
        "hierarchy"
      );
  }
  const paragraphs = visibleNodes.filter((node) => node.nodeName === "p");
  if (paragraphs.length && levels.length) {
    const bodySize = majorityNumber(paragraphs, "font-size");
    const smallest = levels.at(-1);
    const headingSize = majorityNumber(headings.get(smallest), "font-size");
    if (bodySize >= headingSize)
      addIssue(
        hierarchy,
        issue(
          "body-exceeds-heading",
          smallest,
          `Body text (${bodySize}px) is not smaller than ${smallest} (${headingSize}px).`
        ),
        "hierarchy"
      );
  }

  const signatures = [
    {
      name: "heading",
      match: (node) => /^h[1-6]$/.test(node.nodeName),
      properties: [
        "font-size",
        "font-weight",
        "line-height",
        "color",
        "letter-spacing",
        "text-transform",
        "text-decoration-line",
        "opacity",
      ],
    },
    {
      name: "button",
      match: (node) => node.nodeName === "button",
      properties: [
        "height",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "font-size",
        "font-weight",
        "border-radius",
        "border-top-width",
        "border-top-style",
        "border-top-color",
        "background-color",
        "opacity",
      ],
    },
    {
      name: "input",
      match: (node) => ["input", "select", "textarea"].includes(node.nodeName),
      properties: [
        "height",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "font-size",
        "border-radius",
        "border-top-width",
        "background-color",
        "opacity",
      ],
    },
  ];
  for (const group of signatures) {
    const byTag = new Map();
    for (const node of visibleNodes.filter(group.match)) {
      const key = group.name === "heading" ? node.nodeName : group.name;
      if (!byTag.has(key)) byTag.set(key, []);
      byTag.get(key).push(node);
    }
    for (const [key, nodes] of byTag) {
      if (nodes.length < 2) continue;
      for (const property of group.properties) {
        const counts = new Map();
        for (const node of nodes) {
          const value = style(node, property);
          counts.set(value, (counts.get(value) || 0) + 1);
        }
        if (counts.size < 2) continue;
        const majority = [...counts.entries()].sort(
          (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
        )[0][0];
        for (const node of nodes.filter((candidate) => style(candidate, property) !== majority)) {
          addIssue(
            consistency,
            issue(
              "visual-variance",
              node,
              `${key} ${property}: ${style(node, property)} differs from ${majority}.`
            ),
            "consistency"
          );
        }
      }
    }
  }

  const containerNames = new Set([
    "div",
    "section",
    "article",
    "aside",
    "main",
    "header",
    "footer",
  ]);
  for (const node of visibleNodes.filter((candidate) => containerNames.has(candidate.nodeName))) {
    const top = parsePixels(style(node, "padding-top"));
    const right = parsePixels(style(node, "padding-right"));
    const bottom = parsePixels(style(node, "padding-bottom"));
    const left = parsePixels(style(node, "padding-left"));
    if (top > 4 && bottom > 4 && Math.abs(top - bottom) > 4)
      addIssue(
        asymmetry,
        issue("asymmetric-padding", node, `vertical: top=${top}px bottom=${bottom}px`),
        "asymmetry"
      );
    if (left > 4 && right > 4 && Math.abs(left - right) > 4)
      addIssue(
        asymmetry,
        issue("asymmetric-padding", node, `horizontal: left=${left}px right=${right}px`),
        "asymmetry"
      );
  }

  const byParent = new Map();
  for (const node of visibleNodes) {
    if (!byParent.has(node.parentIndex)) byParent.set(node.parentIndex, []);
    byParent.get(node.parentIndex).push(node);
  }
  const alignmentParent = (node) => {
    const classes = node.attributes.class || "";
    return (
      ["main", "section", "article"].includes(node.nodeName) ||
      /(panel|drawer|sheet|column|body|content|list)/i.test(classes)
    );
  };
  for (const parent of visibleNodes.filter(alignmentParent)) {
    const children = (byParent.get(parent.index) || []).filter(
      (node) => node.layout.bounds[2] >= 8 && node.layout.bounds[3] >= 8
    );
    if (children.length < 3) continue;
    for (const [edge, offset] of [
      ["left", 0],
      ["right", 0],
    ]) {
      const values = children.map((node) => {
        const bounds = node.layout.bounds;
        return {
          node,
          value: Math.round(edge === "left" ? bounds[0] : bounds[0] + bounds[2] + offset),
        };
      });
      const buckets = new Map();
      for (const item of values) buckets.set(item.value, (buckets.get(item.value) || 0) + 1);
      const majority = [...buckets.entries()].sort(
        (left, right) => right[1] - left[1] || left[0] - right[0]
      )[0];
      if (!majority || majority[1] < 2) continue;
      for (const item of values) {
        const delta = Math.abs(item.value - majority[0]);
        if (delta >= 2)
          addIssue(
            edgeAlignment,
            issue(
              "stacked-sibling-edge",
              item.node,
              `${edge} edge differs from sibling majority by ${delta}px.`
            ),
            "edge-alignment"
          );
      }
    }
  }

  return {
    viewport: {
      inner_width: Math.round(metrics.cssLayoutViewport.clientWidth),
      client_width: Math.round(metrics.cssLayoutViewport.clientWidth),
      scroll_width: Math.max(
        Math.round(metrics.cssLayoutViewport.clientWidth),
        Math.ceil(metrics.cssContentSize.width)
      ),
    },
    hierarchy,
    edge_alignment: edgeAlignment,
    consistency,
    asymmetry,
  };
}

function pageIdentity(frameTree, metrics) {
  const frame = frameTree.frameTree?.frame;
  if (!frame?.id || !frame.loaderId || typeof frame.url !== "string")
    throw new Error("browser omitted main-frame identity");
  return {
    target_id: null,
    main_frame_id: frame.id,
    loader_id: frame.loaderId,
    final_url: frame.url,
    css_viewport: {
      inner_width: Math.round(metrics.cssLayoutViewport.clientWidth),
      inner_height: Math.round(metrics.cssLayoutViewport.clientHeight),
      client_width: Math.round(metrics.cssLayoutViewport.clientWidth),
      client_height: Math.round(metrics.cssLayoutViewport.clientHeight),
      scroll_width: Math.max(
        Math.round(metrics.cssLayoutViewport.clientWidth),
        Math.ceil(metrics.cssContentSize.width)
      ),
      scroll_height: Math.max(
        Math.round(metrics.cssLayoutViewport.clientHeight),
        Math.ceil(metrics.cssContentSize.height)
      ),
      device_scale_factor: 1,
      scroll_x: Math.round(metrics.cssVisualViewport.pageX),
      scroll_y: Math.round(metrics.cssVisualViewport.pageY),
      visual_scale: metrics.cssVisualViewport.scale,
      page_zoom: metrics.cssVisualViewport.zoom || 1,
    },
  };
}

async function nativeSample(client, targetId, computedStyles, stateAssertion) {
  const [frameTree, metrics, snapshot, axTree] = await Promise.all([
    client.send("Page.getFrameTree"),
    client.send("Page.getLayoutMetrics"),
    client.send("DOMSnapshot.captureSnapshot", {
      computedStyles,
      includePaintOrder: false,
      includeDOMRects: true,
      includeBlendedBackgroundColors: false,
      includeTextColorOpacities: false,
    }),
    client.send("Accessibility.getFullAXTree", { depth: -1 }),
  ]);
  const model = snapshotNodeModel(snapshot);
  const identity = pageIdentity(frameTree, metrics);
  identity.target_id = targetId;
  const styleIndex = new Map(computedStyles.map((name, index) => [name, index]));
  const style = (node, name) => node.layout?.styles?.[styleIndex.get(name)] || "";
  const hitRequirements = evaluateStateAssertion(
    stateAssertion,
    model,
    axTree,
    computedStyles,
    metrics
  );
  const assertionVisibility = await verifyAssertionHitTargets(
    client,
    hitRequirements,
    model,
    style,
    metrics
  );
  return {
    identity,
    assertionVisibility,
    accessibility: accessibilityObservations(axTree, model),
    dom: domObservations(model, metrics, computedStyles),
  };
}

function canonicalSample(sample) {
  return JSON.stringify(sample);
}

async function main() {
  const config = JSON.parse(fs.readFileSync(0, "utf8"));
  const allowedOrigins = new Set(config.allowedOrigins || []);
  const readinessTimeoutMs = config.readinessTimeoutMs;
  const settleMs = config.settleMs;
  const startedAt = new Date().toISOString();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-design-capture-cdp-"));
  const browser = spawn(
    config.browserPath,
    [
      `--user-data-dir=${profileDir}`,
      "--headless=new",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore", detached: process.platform !== "win32" }
  );
  let client = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (client) client.close();
    try {
      if (browser.exitCode === null) {
        if (process.platform === "win32") browser.kill("SIGKILL");
        else process.kill(-browser.pid, "SIGKILL");
      }
    } catch {
      // Browser may have exited between observation and cleanup.
    }
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    } catch {
      // The parent also reclaims the profile through the private control channel.
    }
  };
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.once(signal, () => {
      cleanup();
      process.exit(128 + (os.constants.signals[signal] || 0));
    });

  try {
    if (config.controlToken)
      fs.writeSync(
        3,
        `${JSON.stringify({
          type: "browser-control",
          token: config.controlToken,
          pid: browser.pid,
          profileDir,
        })}\n`
      );
    const portFile = path.join(profileDir, "DevToolsActivePort");
    const endpointDeadline = Date.now() + 10_000;
    while (!fs.existsSync(portFile)) {
      if (browser.exitCode !== null || Date.now() >= endpointDeadline)
        throw new Error("Chromium did not expose a debugging endpoint");
      await sleep(25);
    }
    const port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]);
    let target = await requestJson(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
      "PUT",
      1_000
    ).catch(() => null);
    if (!target?.webSocketDebuggerUrl) target = null;
    const targetDeadline = Date.now() + 10_000;
    while (!target && Date.now() < targetDeadline) {
      const targets = await requestJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (!target) await sleep(25);
    }
    if (!target) throw new Error("Chromium did not expose a page target");
    client = await connect(target.webSocketDebuggerUrl);

    const requests = [];
    const pendingRequests = new Set();
    const violations = [];
    const activeFetchHandlers = new Set();
    let sequence = 0;
    let networkEpoch = 0;
    let networkOverflow = null;
    let handlerError = null;
    let lastNetworkActivity = Date.now();
    let loadFired = false;
    let criticalWindow = false;
    let criticalDrift = null;
    const noteNetworkActivity = () => {
      networkEpoch += 1;
      lastNetworkActivity = Date.now();
      if (criticalWindow) criticalDrift ||= "network";
    };
    const retainRequest = (request) => {
      try {
        appendBoundedEvidence(requests, request, MAX_NETWORK_REQUESTS, "network requests");
      } catch (error) {
        networkOverflow ||= error.message;
      }
    };
    const assertNetworkHealthy = () => {
      if (handlerError) throw new Error(`network policy handler failed: ${handlerError}`);
      if (networkOverflow) throw new Error(networkOverflow);
      if (violations.length) throw new Error(`network policy violation: ${violations[0].origin}`);
      if (criticalDrift) throw new Error(`page changed during atomic capture: ${criticalDrift}`);
    };
    client.on("Page.loadEventFired", () => {
      loadFired = true;
    });
    for (const eventName of ["Page.frameNavigated", "Page.navigatedWithinDocument"])
      client.on(eventName, () => {
        if (criticalWindow) criticalDrift ||= "navigation";
      });
    for (const eventName of [
      "DOM.documentUpdated",
      "DOM.attributeModified",
      "DOM.attributeRemoved",
      "DOM.characterDataModified",
      "DOM.childNodeInserted",
      "DOM.childNodeRemoved",
      "DOM.shadowRootPushed",
      "DOM.shadowRootPopped",
      "CSS.styleSheetChanged",
    ])
      client.on(eventName, () => {
        if (criticalWindow) criticalDrift ||= "document";
      });
    client.on("Fetch.requestPaused", (event) => {
      noteNetworkActivity();
      const handler = Promise.resolve()
        .then(async () => {
          if (!requestAllowed(event.request?.url, allowedOrigins)) {
            if (violations.length === 0)
              violations.push(
                sanitizeRequest({ ...event.request, resourceType: event.resourceType }, ++sequence)
              );
            await client.send("Fetch.failRequest", {
              requestId: event.requestId,
              errorReason: "BlockedByClient",
            });
            return;
          }
          await client.send("Fetch.continueRequest", { requestId: event.requestId });
        })
        .catch((error) => {
          handlerError ||= error.message;
        })
        .finally(() => activeFetchHandlers.delete(handler));
      activeFetchHandlers.add(handler);
    });
    client.on("Network.requestWillBeSent", (event) => {
      noteNetworkActivity();
      try {
        retainRequest(sanitizeRequest({ ...event.request, resourceType: event.type }, ++sequence));
      } catch (error) {
        handlerError ||= error.message;
      }
      pendingRequests.add(event.requestId);
    });
    const completeRequest = (event) => {
      noteNetworkActivity();
      pendingRequests.delete(event.requestId);
    };
    client.on("Network.loadingFinished", completeRequest);
    client.on("Network.loadingFailed", completeRequest);
    client.on("Network.webSocketCreated", (event) => {
      noteNetworkActivity();
      try {
        const record = sanitizeRequest(
          { url: event.url, method: "GET", resourceType: "WebSocket" },
          ++sequence
        );
        retainRequest(record);
        if (!requestAllowed(event.url, allowedOrigins) && violations.length === 0)
          violations.push(record);
      } catch (error) {
        handlerError ||= error.message;
      }
    });

    await client.send("Page.enable");
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    await client.send("Accessibility.enable");
    await client.send("Network.enable", { maxTotalBufferSize: 1024 * 1024 });
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Network.setBypassServiceWorker", { bypass: true });
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: config.viewport.width,
      height: config.viewport.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send("Emulation.setEmulatedMedia", {
      media: "screen",
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });

    loadFired = false;
    const navigation = await client.send("Page.navigate", { url: config.url });
    if (navigation.errorText) throw new Error(`navigation failed: ${navigation.errorText}`);
    const readyDeadline = Date.now() + readinessTimeoutMs;
    let readyAt = null;
    while (Date.now() < readyDeadline) {
      assertNetworkHealthy();
      if (
        loadFired &&
        pendingRequests.size === 0 &&
        activeFetchHandlers.size === 0 &&
        Date.now() - lastNetworkActivity >= settleMs
      ) {
        readyAt = new Date().toISOString();
        break;
      }
      await sleep(25);
    }
    if (!readyAt) throw new Error("page did not reach complete, network-idle readiness");

    const computedStyles = [
      "display",
      "visibility",
      "opacity",
      "font-size",
      "font-weight",
      "line-height",
      "color",
      "letter-spacing",
      "text-transform",
      "text-decoration-line",
      "height",
      "padding-top",
      "padding-right",
      "padding-bottom",
      "padding-left",
      "border-radius",
      "border-top-width",
      "border-top-style",
      "border-top-color",
      "background-color",
      "gap",
      "overflow",
      "overflow-x",
      "overflow-y",
      "content-visibility",
      "position",
      "margin-bottom",
    ];
    criticalWindow = true;
    const before = await nativeSample(client, target.id, computedStyles, config.stateAssertion);
    const first = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!first.data) throw new Error("browser did not return screenshot bytes");
    const firstAttestation = writeExclusiveFile(config.outputPath, first.data, "screenshot");
    const capturedAt = new Date().toISOString();
    const middle = await nativeSample(client, target.id, computedStyles, config.stateAssertion);
    const second = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!second.data) throw new Error("browser did not return verification screenshot bytes");
    const secondAttestation = writeExclusiveFile(
      config.verificationPath,
      second.data,
      "verification screenshot"
    );
    const after = await nativeSample(client, target.id, computedStyles, config.stateAssertion);
    if (
      canonicalSample(before) !== canonicalSample(middle) ||
      canonicalSample(middle) !== canonicalSample(after)
    )
      throw new Error("page observations changed during atomic capture");
    assertNetworkHealthy();

    const finalSettleStartedAt = Date.now();
    const finalSettleDeadline = finalSettleStartedAt + Math.max(1_000, settleMs * 4);
    while (Date.now() < finalSettleDeadline) {
      assertNetworkHealthy();
      if (
        pendingRequests.size === 0 &&
        activeFetchHandlers.size === 0 &&
        Date.now() - finalSettleStartedAt >= settleMs
      )
        break;
      await sleep(25);
    }
    assertNetworkHealthy();
    if (pendingRequests.size > 0 || activeFetchHandlers.size > 0)
      throw new Error("network did not settle after atomic capture");

    const barrierEpoch = networkEpoch;
    await client.send("Page.getFrameTree");
    assertNetworkHealthy();
    if (networkEpoch !== barrierEpoch)
      throw new Error("network activity crossed the final protocol barrier");

    await client.send("Fetch.disable");
    while (activeFetchHandlers.size > 0) await Promise.all([...activeFetchHandlers]);
    assertNetworkHealthy();
    if (pendingRequests.size > 0)
      throw new Error("network requests remained pending after interception shutdown");
    await client.send("Network.disable");
    await client.send("Page.getFrameTree");
    assertNetworkHealthy();
    if (pendingRequests.size > 0 || activeFetchHandlers.size > 0)
      throw new Error("network tracking did not close cleanly");

    const observedFinalUrl = redactedUrlIdentity(middle.identity.final_url);
    const expectedFinalUrl = redactedUrlIdentity(config.expectedUrl || config.url);
    if (JSON.stringify(observedFinalUrl) !== JSON.stringify(expectedFinalUrl))
      throw new Error("navigation drift: observed final URL does not match expected URL identity");
    const publicPageIdentity = { ...middle.identity, final_url: observedFinalUrl };
    criticalWindow = false;

    const observedOrigins = [...new Set(requests.map((item) => item.origin))].sort();
    const result = {
      schema_version: 2,
      page: publicPageIdentity,
      assertion_visibility: middle.assertionVisibility,
      assertion_passed: true,
      accessibility_observations: middle.accessibility,
      dom_observations: middle.dom,
      screenshot: firstAttestation,
      verification_screenshot: secondAttestation,
      network: {
        policy: "explicit-origin-allowlist",
        allowed_origins: [...allowedOrigins].sort(),
        observed_origins: observedOrigins,
        requests,
        violations: [],
      },
      timestamps: {
        started_at: startedAt,
        page_ready_at: readyAt,
        captured_at: capturedAt,
        completed_at: new Date().toISOString(),
      },
    };
    const encoded = `${JSON.stringify(result)}\n`;
    if (Buffer.byteLength(encoded) > MAX_RESULT_BYTES)
      throw new Error(`capture result exceeds the ${MAX_RESULT_BYTES}-byte budget`);
    process.stdout.write(encoded);
  } finally {
    cleanup();
  }
}

if (require.main === module)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });

module.exports = {
  appendBoundedEvidence,
  accessibilityObservations,
  domObservations,
  evaluateStateAssertion,
  nodeVisibleInViewport,
  originForPolicy,
  redactedUrlIdentity,
  requestAllowed,
  sanitizeRequest,
  snapshotNodeModel,
  verifyAssertionHitTargets,
  visibleIntersection,
};
