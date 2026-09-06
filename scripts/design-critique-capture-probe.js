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
const NETWORK_POLICY_OBSERVATION_MS = 500;
const INTERNAL_SCHEMES = new Set(["about:", "data:"]);
const NETWORK_CHILD_TARGET_TYPES = new Set([
  "iframe",
  "page",
  "service_worker",
  "shared_worker",
  "worker",
]);
const WORKER_TARGET_TYPES = new Set(["service_worker", "shared_worker", "worker"]);
const NETWORK_TARGET_FILTER = [
  ...[...NETWORK_CHILD_TARGET_TYPES].sort().map((type) => ({ type, exclude: false })),
  { exclude: true },
];
const ALLOWED_NETWORK_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);
const BROWSER_INTERNAL_TARGET_PROTOCOLS = new Set([
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "chrome:",
  "devtools:",
]);
const COVERING_MASK_REPEATS = new Set(["repeat", "repeat repeat"]);
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
    for (const listener of listeners.get(message.method) || [])
      listener(message.params || {}, message.sessionId || null);
  });
  return {
    send(method, params = {}, sessionId = null) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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

function browserInternalTarget(rawUrl) {
  try {
    return BROWSER_INTERNAL_TARGET_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function normalizeAllowedOrigins(rawOrigins) {
  if (!Array.isArray(rawOrigins) || rawOrigins.length > 100)
    throw new Error("network allowed origins must be an array of at most 100 origins");
  const normalized = new Set();
  for (const raw of rawOrigins) {
    if (typeof raw !== "string" || raw.length < 1 || raw.length > 4096)
      throw new Error("network allowed origin is invalid");
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("network allowed origin must be an absolute origin");
    }
    if (!ALLOWED_NETWORK_PROTOCOLS.has(parsed.protocol))
      throw new Error("network allowed origin has an unsupported scheme");
    if (
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes("*") ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.origin !== raw
    )
      throw new Error("network allowed origin must be canonical and wildcard-free");
    if (normalized.has(raw)) throw new Error("network allowed origins must be unique");
    normalized.add(raw);
  }
  return normalized;
}

function webSocketPolicyOrigins(allowedOrigins) {
  return new Set(allowedOrigins);
}

function webSocketBlockPatterns(allowedOrigins) {
  const allowPatterns = [...webSocketPolicyOrigins(allowedOrigins)]
    .filter((origin) => origin.startsWith("ws://") || origin.startsWith("wss://"))
    .sort()
    .map((origin) => ({ urlPattern: `${origin}/*`, block: false }));
  return [
    ...allowPatterns,
    { urlPattern: "ws://*:*/*", block: true },
    { urlPattern: "wss://*:*/*", block: true },
  ];
}

function childTargetBlockPatterns(allowedOrigins) {
  const allowPatterns = [...allowedOrigins]
    .filter((origin) => /^(?:http|https|ws|wss):\/\//.test(origin))
    .sort()
    .map((origin) => ({ urlPattern: `${origin}/*`, block: false }));
  return [
    ...allowPatterns,
    { urlPattern: "http://*:*/*", block: true },
    { urlPattern: "https://*:*/*", block: true },
    { urlPattern: "ws://*:*/*", block: true },
    { urlPattern: "wss://*:*/*", block: true },
  ];
}

function targetNetworkConditions(allowedOrigins) {
  const conditions = (urlPattern, offline) => ({
    urlPattern,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
    offline,
  });
  const allowConditions = [...allowedOrigins]
    .filter((origin) => /^(?:http|https|ws|wss):\/\//.test(origin))
    .sort()
    .map((origin) => conditions(`${origin}/*`, false));
  return [
    ...allowConditions,
    conditions("http://*:*/*", true),
    conditions("https://*:*/*", true),
    conditions("ws://*:*/*", true),
    conditions("wss://*:*/*", true),
  ];
}

async function installTargetNetworkIsolation(client, allowedOrigins, sessionId) {
  const blockMode = await installWebSocketPolicy(client, allowedOrigins, sessionId, true);
  try {
    await client.send(
      "Network.emulateNetworkConditionsByRule",
      { matchedNetworkConditions: targetNetworkConditions(allowedOrigins) },
      sessionId
    );
  } catch (error) {
    throw new Error(`browser cannot install target pre-connect isolation: ${error.message}`);
  }
  return blockMode;
}

async function installWebSocketPolicy(
  client,
  allowedOrigins,
  sessionId = null,
  includeHttp = false
) {
  try {
    await client.send(
      "Network.setBlockedURLs",
      {
        urlPatterns: includeHttp
          ? childTargetBlockPatterns(allowedOrigins)
          : webSocketBlockPatterns(allowedOrigins),
      },
      sessionId
    );
    return "ordered-patterns";
  } catch (patternError) {
    // Older Chromium releases only expose the deprecated wildcard form. It
    // cannot express allow-before-deny, so block every socket and fail a
    // capture if the page attempts even an otherwise-allowed WebSocket.
    try {
      await client.send(
        "Network.setBlockedURLs",
        {
          urls: includeHttp
            ? ["http://*", "https://*", "ws://*", "wss://*"]
            : ["ws://*", "wss://*"],
        },
        sessionId
      );
      return "block-all-fallback";
    } catch (fallbackError) {
      throw new Error(
        `browser cannot install the pre-connect WebSocket policy: ${
          fallbackError.message || patternError.message
        }`
      );
    }
  }
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

function tabIndexForNode(node, properties) {
  if (Object.prototype.hasOwnProperty.call(node.attributes, "tabindex")) {
    const value = Number(node.attributes.tabindex);
    return Number.isInteger(value) && value >= -1 && value <= 32767 ? value : -1;
  }
  return properties.get("focusable") === true ? 0 : -1;
}

const COMPOSITE_OWNER_ROLES = Object.freeze({
  menuitem: new Set(["menu", "menubar"]),
  option: new Set(["combobox", "listbox"]),
  radio: new Set(["radiogroup"]),
  tab: new Set(["tablist"]),
});
const COMPOSITE_ARROW_KEYS = Object.freeze({
  combobox: Object.freeze(["ArrowDown", "ArrowUp"]),
  listbox: Object.freeze(["ArrowDown", "ArrowUp"]),
  menu: Object.freeze(["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"]),
  menubar: Object.freeze(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]),
  radiogroup: Object.freeze(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]),
  tablist: Object.freeze(["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"]),
});

function hasDomAncestor(node, model, predicate) {
  const visited = new Set();
  let parentIndex = node.parentIndex;
  while (Number.isInteger(parentIndex) && parentIndex >= 0 && !visited.has(parentIndex)) {
    visited.add(parentIndex);
    const parent = model[parentIndex];
    if (!parent) return false;
    if (predicate(parent)) return true;
    parentIndex = parent.parentIndex;
  }
  return false;
}

function compositeOwnerForNode(axNode, role, byAxId) {
  const ownerRoles = COMPOSITE_OWNER_ROLES[role];
  if (!ownerRoles) return null;
  const visited = new Set();
  let parentId = axNode.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byAxId.get(parentId);
    if (!parent) return null;
    if (ownerRoles.has(String(valueOf(parent.role) || "").toLowerCase())) return parent;
    parentId = parent.parentId;
  }
  return null;
}

function axProperties(axNode) {
  return new Map((axNode.properties || []).map((item) => [item.name, valueOf(item)]));
}

function disabledControl(node, properties) {
  return (
    properties.get("disabled") === true ||
    Object.prototype.hasOwnProperty.call(node.attributes, "disabled") ||
    node.attributes["aria-disabled"] === "true"
  );
}

function documentTabStopIndex(node, properties) {
  if (Object.prototype.hasOwnProperty.call(node.attributes, "tabindex")) {
    return tabIndexForNode(node, properties);
  }
  const nativeTabStop =
    ["button", "input", "select", "summary", "textarea"].includes(node.nodeName) ||
    (["a", "area"].includes(node.nodeName) &&
      Object.prototype.hasOwnProperty.call(node.attributes, "href")) ||
    node.attributes.contenteditable === "" ||
    node.attributes.contenteditable === "true";
  return nativeTabStop && properties.get("focusable") === true ? 0 : -1;
}

function documentKeyboardEntryProbes(axTree, byBackendId, model) {
  const entries = [];
  for (const axNode of axTree.nodes || []) {
    if (axNode.ignored === true) continue;
    const node = byBackendId.get(axNode.backendDOMNodeId);
    if (!node) continue;
    const role = String(valueOf(axNode.role) || "").toLowerCase();
    if (role === "option" && hasDomAncestor(node, model, (parent) => parent.nodeName === "select"))
      continue;
    const properties = axProperties(axNode);
    const tabIndex = documentTabStopIndex(node, properties);
    if (properties.get("focusable") === true && tabIndex >= 0 && !disabledControl(node, properties))
      entries.push({ backendNodeId: node.backendNodeId, documentIndex: node.index, tabIndex });
  }
  entries.sort((left, right) => {
    const leftOrder = left.tabIndex > 0 ? 0 : 1;
    const rightOrder = right.tabIndex > 0 ? 0 : 1;
    return (
      leftOrder - rightOrder ||
      left.tabIndex - right.tabIndex ||
      left.documentIndex - right.documentIndex
    );
  });
  const probes = new Map();
  for (const [index, entry] of entries.entries()) {
    if (index > 0) {
      probes.set(entry.backendNodeId, {
        from_backend_node_id: entries[index - 1].backendNodeId,
        modifiers: 0,
      });
    } else if (entries.length > 1) {
      probes.set(entry.backendNodeId, {
        from_backend_node_id: entries[1].backendNodeId,
        modifiers: 8,
      });
    }
  }
  return probes;
}

function compositeKeyboardCandidates(axTree, model) {
  const byBackendId = new Map(
    model
      .filter((node) => Number.isInteger(node.backendNodeId))
      .map((node) => [node.backendNodeId, node])
  );
  const entryProbes = documentKeyboardEntryProbes(axTree, byBackendId, model);
  const byAxId = new Map(
    (axTree.nodes || [])
      .filter((node) => typeof node.nodeId === "string" && node.nodeId)
      .map((node) => [node.nodeId, node])
  );
  const groups = new Map();
  for (const axNode of axTree.nodes || []) {
    const role = String(valueOf(axNode.role) || "").toLowerCase();
    const owner = compositeOwnerForNode(axNode, role, byAxId);
    if (!owner) continue;
    const node = byBackendId.get(axNode.backendDOMNodeId);
    if (
      !node ||
      (role === "option" && hasDomAncestor(node, model, (parent) => parent.nodeName === "select"))
    )
      continue;
    if (!groups.has(owner.nodeId)) {
      groups.set(owner.nodeId, {
        owner_backend_node_id: owner.backendDOMNodeId,
        owner_role: String(valueOf(owner.role) || "").toLowerCase(),
        member_backend_node_ids: [],
        entry_backend_node_ids: [],
        entry_probes: {},
      });
    }
    const group = groups.get(owner.nodeId);
    group.member_backend_node_ids.push(node.backendNodeId);
    const properties = axProperties(axNode);
    if (
      properties.get("focusable") === true &&
      documentTabStopIndex(node, properties) >= 0 &&
      !disabledControl(node, properties)
    )
      group.entry_backend_node_ids.push(node.backendNodeId);
  }
  for (const [ownerId, group] of groups) {
    const owner = byAxId.get(ownerId);
    const node = byBackendId.get(owner.backendDOMNodeId);
    if (!node) continue;
    const properties = axProperties(owner);
    if (
      properties.get("focusable") === true &&
      documentTabStopIndex(node, properties) >= 0 &&
      !disabledControl(node, properties)
    )
      group.entry_backend_node_ids.push(node.backendNodeId);
  }
  const candidates = [];
  for (const group of groups.values()) {
    group.member_backend_node_ids = [...new Set(group.member_backend_node_ids)];
    group.entry_backend_node_ids = [...new Set(group.entry_backend_node_ids)];
    for (const backendNodeId of group.entry_backend_node_ids) {
      const probe = entryProbes.get(backendNodeId);
      if (probe) group.entry_probes[backendNodeId] = probe;
    }
    if (
      group.member_backend_node_ids.length > 1 &&
      group.entry_backend_node_ids.length > 0 &&
      COMPOSITE_ARROW_KEYS[group.owner_role]
    )
      appendBoundedEvidence(candidates, group, MAX_CONTROLS, "composite keyboard candidates");
  }
  return candidates;
}

function accessibilityEvidence(axTree, model, compositeBackendNodeIds = new Set()) {
  const byBackendId = new Map(
    model
      .filter((node) => Number.isInteger(node.backendNodeId))
      .map((node) => [node.backendNodeId, node])
  );
  const landmarks = [];
  const controls = [];
  const controlBackendNodeIds = [];
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
      const properties = axProperties(axNode);
      const tabIndex = documentTabStopIndex(node, properties);
      const compositeDescendant =
        compositeBackendNodeIds.has(node.backendNodeId) ||
        (role === "option" &&
          hasDomAncestor(node, model, (parent) => parent.nodeName === "select"));
      const focusContext =
        compositeDescendant && (tabIndex < 0 || node.nodeName === "option")
          ? "composite"
          : "document";
      appendBoundedEvidence(
        controls,
        {
          role,
          name,
          locator,
          disabled: disabledControl(node, properties),
          tab_index: tabIndex,
          focus_context: focusContext,
          document_index: node.index,
        },
        MAX_CONTROLS,
        "accessibility controls"
      );
      controlBackendNodeIds.push(node.backendNodeId);
    }
  }
  return { observations: { landmarks, controls }, controlBackendNodeIds };
}

function accessibilityObservations(axTree, model, compositeBackendNodeIds = new Set()) {
  return accessibilityEvidence(axTree, model, compositeBackendNodeIds).observations;
}

function cssLengthPixels(value, reference) {
  const match = String(value || "")
    .trim()
    .match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%)?$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  if (match[2] === "%") return (amount / 100) * reference;
  if (!match[2] && amount !== 0) return null;
  return amount;
}

function expandedBoxValues(values) {
  if (values.length === 1) return [values[0], values[0], values[0], values[0]];
  if (values.length === 2) return [values[0], values[1], values[0], values[1]];
  if (values.length === 3) return [values[0], values[1], values[2], values[1]];
  return values.length === 4 ? values : null;
}

function insetClipRectangle(value, bounds) {
  const match = String(value || "")
    .trim()
    .match(/^inset\((.*)\)$/i);
  if (!match || !Array.isArray(bounds)) return null;
  const insetValues = match[1]
    .split(/\s+round\s+/i, 1)[0]
    .trim()
    .split(/\s+/);
  const expanded = expandedBoxValues(insetValues);
  if (!expanded) return null;
  const [top, right, bottom, left] = expanded.map((item, index) =>
    cssLengthPixels(item, index % 2 === 0 ? bounds[3] : bounds[2])
  );
  if ([top, right, bottom, left].some((item) => item === null)) return null;
  return {
    left: bounds[0] + left,
    top: bounds[1] + top,
    right: bounds[0] + bounds[2] - right,
    bottom: bounds[1] + bounds[3] - bottom,
  };
}

function zeroRadiusClip(value, bounds) {
  const match = String(value || "")
    .trim()
    .match(/^(circle|ellipse)\((.*?)\)$/i);
  if (!match || !Array.isArray(bounds)) return false;
  const radii = match[2]
    .split(/\s+at\s+/i, 1)[0]
    .trim()
    .split(/\s+/);
  const expected = match[1].toLowerCase() === "circle" ? 1 : 2;
  if (radii.length < expected) return false;
  const resolved = radii
    .slice(0, expected)
    .map((item, index) => cssLengthPixels(item, index === 0 ? bounds[2] : bounds[3]));
  return resolved.every((item) => item !== null) && resolved.some((item) => item <= 0);
}

function filterOpacity(value) {
  let opacity = 1;
  for (const match of String(value || "").matchAll(
    /opacity\(\s*(-?(?:\d+(?:\.\d+)?|\.\d+))(%)?\s*\)/gi
  )) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    opacity *= match[2] ? amount / 100 : amount;
  }
  return Math.max(0, Math.min(1, opacity));
}

function topLevelParts(value, delimiter) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth = Math.max(0, depth - 1);
    else if (value[index] === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function numericAlpha(value) {
  const match = String(value || "").match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(%)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  return Math.max(0, Math.min(1, match[2] ? amount / 100 : amount));
}

function colorFunctionAlpha(name, body) {
  if (
    !new Set(["rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color"]).has(
      name
    )
  )
    return null;
  const slashParts = topLevelParts(body, "/");
  if (slashParts.length === 2) return numericAlpha(slashParts[1]);
  if (slashParts.length > 2) return null;
  const commaParts = topLevelParts(body, ",");
  if (["rgba", "hsla"].includes(name))
    return commaParts.length === 4 ? numericAlpha(commaParts[3]) : null;
  return 1;
}

function maskColorStop(value) {
  const normalized = value.trim().toLowerCase();
  const transparent = normalized.match(/^transparent(?=\s|$)/);
  if (transparent)
    return { alpha: 0, positioned: normalized.slice(transparent[0].length).trim().length > 0 };

  const hex = normalized.match(/^#([0-9a-f]{3,8})(?=\s|$)/);
  if (hex) {
    let alpha;
    if ([3, 6].includes(hex[1].length)) alpha = 1;
    else if (hex[1].length === 4) alpha = Number.parseInt(hex[1][3], 16) / 15;
    else if (hex[1].length === 8) alpha = Number.parseInt(hex[1].slice(6), 16) / 255;
    else return null;
    return { alpha, positioned: normalized.slice(hex[0].length).trim().length > 0 };
  }

  const functionStart = normalized.match(/^([a-z][a-z0-9-]*)\(/);
  if (functionStart) {
    let depth = 0;
    let end = -1;
    for (let index = functionStart[1].length; index < normalized.length; index += 1) {
      if (normalized[index] === "(") depth += 1;
      else if (normalized[index] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end === -1) return null;
    const alpha = colorFunctionAlpha(
      functionStart[1],
      normalized.slice(functionStart[1].length + 1, end)
    );
    return alpha === null
      ? null
      : { alpha, positioned: normalized.slice(end + 1).trim().length > 0 };
  }

  const identifier = normalized.match(/^([a-z][a-z0-9-]*)(?=\s|$)/);
  if (!identifier) return null;
  if (new Set(["at", "circle", "ellipse", "from", "in", "to"]).has(identifier[1])) return null;
  return { alpha: 1, positioned: normalized.slice(identifier[0].length).trim().length > 0 };
}

function colorHint(value) {
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|deg|grad|rad|turn)$/.test(value.trim());
}

function gradientPreludeSupported(kind, value) {
  const normalized = value.trim();
  const number = "-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)";
  const angle = `${number}(?:deg|grad|rad|turn)`;
  const direction = "(?:top|bottom|left|right)";
  return (
    kind === "linear" &&
    new RegExp(`^(?:to\\s+${direction}(?:\\s+${direction})?|${angle})$`).test(normalized)
  );
}

function gradientMaskPaintState(value) {
  const gradient = value.match(/^(?:repeating-)?(linear)-gradient\((.*)\)$/);
  if (!gradient) return "unknown";
  const parts = topLevelParts(gradient[2], ",");
  const stops = [];
  let positioned = false;
  for (const [index, part] of parts.entries()) {
    const stop = maskColorStop(part);
    if (stop !== null) {
      stops.push(stop);
      continue;
    }
    if (colorHint(part)) {
      positioned = true;
      continue;
    }
    if (index === 0 && parts.length > 2 && gradientPreludeSupported(gradient[1], part)) continue;
    return "unknown";
  }
  if (stops.length < 2) return "unknown";
  if (stops.every((stop) => stop.alpha === 0)) return "transparent";
  if (positioned || stops.some((stop) => stop.positioned)) return "unknown";
  return stops.some((stop) => stop.alpha === 1) ? "visible" : "unknown";
}

function maskSourceModeIsProvablyAlpha(image, mode) {
  if (mode === "alpha") return true;
  if (!["match-source", "auto"].includes(mode)) return false;
  return /^(?:repeating-)?linear-gradient\(/.test(image);
}

function coordinatedMaskValue(value, index) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return null;
  const values = topLevelParts(normalized, ",");
  if (values.length === 0 || values.some((item) => !item)) return null;
  return values[index % values.length];
}

function maskGeometryIsProvablyCovering(geometry) {
  const size = coordinatedMaskValue(geometry.size, 0);
  const position = coordinatedMaskValue(geometry.position, 0);
  const repeat = coordinatedMaskValue(geometry.repeat, 0);
  const origin = coordinatedMaskValue(geometry.origin, 0);
  const clip = coordinatedMaskValue(geometry.clip, 0);
  const composite = coordinatedMaskValue(geometry.composite, 0);
  return (
    size === "auto" &&
    position === "0% 0%" &&
    COVERING_MASK_REPEATS.has(repeat) &&
    origin === "border-box" &&
    clip === "border-box" &&
    composite === "add"
  );
}

function maskBlocksVisibility(imageValue, modeValue, geometry) {
  const normalizedImages = String(imageValue || "")
    .trim()
    .toLowerCase();
  if (!normalizedImages || normalizedImages === "none") return false;
  const images = topLevelParts(normalizedImages, ",");
  if (images.length !== 1 || !images[0]) return true;

  const [image] = images;
  const mode = coordinatedMaskValue(modeValue, 0);
  if (!maskSourceModeIsProvablyAlpha(image, mode)) return true;
  if (!maskGeometryIsProvablyCovering(geometry)) return true;
  return gradientMaskPaintState(image) !== "visible";
}

function maskConfigurationBlocksVisibility(style, node) {
  const webkitMaskBoxImageSource = String(style(node, "-webkit-mask-box-image-source") || "")
    .trim()
    .toLowerCase();
  if (webkitMaskBoxImageSource && webkitMaskBoxImageSource !== "none") return true;

  const standardImage = style(node, "mask-image");
  const webkitImage = style(node, "-webkit-mask-image");
  const normalizedStandardImage = String(standardImage || "")
    .trim()
    .toLowerCase();
  const normalizedWebkitImage = String(webkitImage || "")
    .trim()
    .toLowerCase();
  const standardActive = normalizedStandardImage && normalizedStandardImage !== "none";
  const webkitActive = normalizedWebkitImage && normalizedWebkitImage !== "none";
  if (!standardActive && !webkitActive) return false;
  if (standardActive && webkitActive && normalizedStandardImage !== normalizedWebkitImage)
    return true;

  if (standardActive)
    return maskBlocksVisibility(standardImage, style(node, "mask-mode"), {
      size: style(node, "mask-size"),
      position: style(node, "mask-position"),
      repeat: style(node, "mask-repeat"),
      origin: style(node, "mask-origin"),
      clip: style(node, "mask-clip"),
      composite: style(node, "mask-composite"),
    });
  return true;
}

function createVisibilityEvaluator(model, style, metrics) {
  const viewport = metrics.cssVisualViewport;
  const rootState = Object.freeze({
    blocked: false,
    effectiveOpacity: 1,
    left: viewport.pageX,
    top: viewport.pageY,
    right: viewport.pageX + viewport.clientWidth,
    bottom: viewport.pageY + viewport.clientHeight,
  });
  const states = new Array(model.length);
  const positions = new Map(model.map((candidate, index) => [candidate, index]));
  const visitGeneration = new Uint32Array(model.length);
  let generation = 0;

  const extend = (parentState, current) => {
    const rawOpacity = Number.parseFloat(style(current, "opacity") || "1");
    const opacity = Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 1;
    let left = parentState.left;
    let top = parentState.top;
    let right = parentState.right;
    let bottom = parentState.bottom;
    const bounds = current?.layout?.bounds;
    let paintClipped = false;
    if (Array.isArray(bounds)) {
      const overflowX = style(current, "overflow-x") || style(current, "overflow");
      const overflowY = style(current, "overflow-y") || style(current, "overflow");
      if (overflowX && overflowX !== "visible") {
        left = Math.max(left, bounds[0]);
        right = Math.min(right, bounds[0] + bounds[2]);
      }
      if (overflowY && overflowY !== "visible") {
        top = Math.max(top, bounds[1]);
        bottom = Math.min(bottom, bounds[1] + bounds[3]);
      }
      const clipPath = style(current, "clip-path");
      const insetClip = insetClipRectangle(clipPath, bounds);
      if (insetClip) {
        left = Math.max(left, insetClip.left);
        top = Math.max(top, insetClip.top);
        right = Math.min(right, insetClip.right);
        bottom = Math.min(bottom, insetClip.bottom);
      } else if (zeroRadiusClip(clipPath, bounds)) paintClipped = true;
    }
    const blockedMask = maskConfigurationBlocksVisibility(style, current);
    return {
      blocked:
        parentState.blocked ||
        style(current, "display") === "none" ||
        style(current, "content-visibility") === "hidden" ||
        paintClipped ||
        blockedMask ||
        right <= left ||
        bottom <= top,
      effectiveOpacity:
        parentState.effectiveOpacity * opacity * filterOpacity(style(current, "filter")),
      left,
      top,
      right,
      bottom,
    };
  };

  const ensureState = (startIndex) => {
    if (states[startIndex]) return;
    generation += 1;
    const path = [];
    let currentIndex = startIndex;
    while (
      currentIndex >= 0 &&
      currentIndex < model.length &&
      !states[currentIndex] &&
      visitGeneration[currentIndex] !== generation
    ) {
      visitGeneration[currentIndex] = generation;
      path.push(currentIndex);
      const parentIndex = model[currentIndex]?.parentIndex;
      currentIndex = Number.isInteger(parentIndex) ? parentIndex : -1;
    }
    let inherited =
      currentIndex >= 0 && currentIndex < model.length && states[currentIndex]
        ? states[currentIndex]
        : rootState;
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const position = path[index];
      states[position] = extend(inherited, model[position]);
      inherited = states[position];
    }
  };

  for (let index = 0; index < model.length; index += 1) ensureState(index);

  return (node) => {
    const bounds = node?.layout?.bounds;
    if (!Array.isArray(bounds) || bounds[2] <= 0 || bounds[3] <= 0) return null;
    const index = positions.get(node);
    if (index === undefined) return null;
    const state = states[index];
    if (
      state.blocked ||
      state.effectiveOpacity < MIN_EFFECTIVE_OPACITY ||
      ["hidden", "collapse"].includes(style(node, "visibility"))
    )
      return null;
    const left = Math.max(bounds[0], state.left);
    const top = Math.max(bounds[1], state.top);
    const right = Math.min(bounds[0] + bounds[2], state.right);
    const bottom = Math.min(bounds[1] + bounds[3], state.bottom);
    if (right <= left || bottom <= top) return null;
    return { left, top, right, bottom, effectiveOpacity: state.effectiveOpacity };
  };
}

function visibleIntersection(node, model, style, metrics, visibilityEvaluator = null) {
  const evaluate = visibilityEvaluator || createVisibilityEvaluator(model, style, metrics);
  return evaluate(node);
}

function nodeVisibleInViewport(node, model, style, metrics, visibilityEvaluator = null) {
  return visibleIntersection(node, model, style, metrics, visibilityEvaluator) !== null;
}

function visibilityEvaluatorFor(model, style, metrics, candidate) {
  if (typeof candidate === "function") return candidate;
  return createVisibilityEvaluator(model, style, metrics);
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

function positionedDescendantCovers(
  node,
  assertedIntersection,
  model,
  style,
  metrics,
  visibilityEvaluator
) {
  if (!node || !new Set(["absolute", "fixed", "sticky"]).has(style(node, "position"))) return false;
  const descendantIntersection = visibleIntersection(
    node,
    model,
    style,
    metrics,
    visibilityEvaluator
  );
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

async function verifyAssertionHitTargets(
  client,
  requirements,
  model,
  style,
  metrics,
  visibilityEvaluator = null
) {
  const evaluateVisibility = visibilityEvaluatorFor(model, style, metrics, visibilityEvaluator);
  const checks = [];
  for (const requirement of requirements) {
    const intersection = visibleIntersection(
      requirement.node,
      model,
      style,
      metrics,
      evaluateVisibility
    );
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
          positionedDescendantCovers(node, intersection, model, style, metrics, evaluateVisibility)
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

function evaluateStateAssertion(
  assertion,
  model,
  axTree,
  computedStyles,
  metrics,
  visibilityEvaluator = null
) {
  const styleIndex = new Map(computedStyles.map((name, index) => [name, index]));
  const style = (node, name) => node.layout?.styles?.[styleIndex.get(name)] || "";
  const evaluateVisibility = visibilityEvaluatorFor(model, style, metrics, visibilityEvaluator);
  const visible = (node) => nodeVisibleInViewport(node, model, style, metrics, evaluateVisibility);
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

function normalizedClassTokens(node) {
  return [
    ...new Set(
      String(node.attributes.class || "")
        .split(/\s+/)
        .filter(Boolean)
    ),
  ].sort();
}

function declaredComponentVariantIdentity(node, groupName) {
  const component = String(node.attributes["data-component"] || "").trim() || null;
  const variant = String(node.attributes["data-variant"] || "").trim() || null;
  const inputType =
    node.nodeName === "input"
      ? String(node.attributes.type || "text")
          .trim()
          .toLowerCase() || "text"
      : null;
  const disabled =
    Object.prototype.hasOwnProperty.call(node.attributes, "disabled") ||
    String(node.attributes["aria-disabled"] || "")
      .trim()
      .toLowerCase() === "true";
  const nativeState = { input_type: inputType, disabled };
  const declaration = variant
    ? { group: groupName, element: node.nodeName, component, variant, ...nativeState }
    : {
        group: groupName,
        element: node.nodeName,
        component,
        ...nativeState,
        classes: normalizedClassTokens(node),
      };
  return digest(Buffer.from(JSON.stringify(declaration)));
}

function repeatedContainerIdentity(node) {
  const component = String(node.attributes["data-component"] || "").trim();
  const variant = String(node.attributes["data-variant"] || "").trim();
  const classes = normalizedClassTokens(node);
  if (!component && !variant && classes.length === 0) return null;
  return declaredComponentVariantIdentity(node, "container");
}

function domObservations(model, metrics, computedStyles, visibilityEvaluator = null) {
  const styleIndex = new Map(computedStyles.map((name, index) => [name, index]));
  const style = (node, name) => node.layout?.styles?.[styleIndex.get(name)] || "";
  const evaluateVisibility = visibilityEvaluatorFor(model, style, metrics, visibilityEvaluator);
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
  const visibleIntersections = new Map();
  const visibleNodes = model.filter((node) => {
    const intersection = evaluateVisibility(node);
    if (!intersection) return false;
    visibleIntersections.set(node, intersection);
    return true;
  });
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
    const byIdentity = new Map();
    for (const node of visibleNodes.filter(group.match)) {
      const key =
        group.name === "heading"
          ? node.nodeName
          : declaredComponentVariantIdentity(node, group.name);
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(node);
    }
    for (const [key, nodes] of byIdentity) {
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
              `${group.name === "heading" ? key : group.name} ${property}: ${style(
                node,
                property
              )} differs from ${majority}.`
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
  const repeatedContainers = new Map();
  for (const node of visibleNodes.filter((candidate) => containerNames.has(candidate.nodeName))) {
    const identity = repeatedContainerIdentity(node);
    if (!identity) continue;
    if (!repeatedContainers.has(identity)) repeatedContainers.set(identity, []);
    repeatedContainers.get(identity).push({
      node,
      top: parsePixels(style(node, "padding-top")),
      right: parsePixels(style(node, "padding-right")),
      bottom: parsePixels(style(node, "padding-bottom")),
      left: parsePixels(style(node, "padding-left")),
    });
  }
  for (const rows of repeatedContainers.values()) {
    for (const [axis, start, end] of [
      ["vertical", "top", "bottom"],
      ["horizontal", "left", "right"],
    ]) {
      const counts = new Map();
      for (const row of rows) {
        const key = JSON.stringify([row[start], row[end]]);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      const majority = [...counts.entries()].sort(
        (leftEntry, rightEntry) =>
          rightEntry[1] - leftEntry[1] || leftEntry[0].localeCompare(rightEntry[0])
      )[0];
      if (!majority || majority[1] < 2 || majority[1] <= rows.length / 2) continue;
      const [baselineStart, baselineEnd] = JSON.parse(majority[0]);
      if (Math.abs(baselineStart - baselineEnd) > 4) continue;
      for (const row of rows) {
        if (
          JSON.stringify([row[start], row[end]]) === majority[0] ||
          row[start] <= 4 ||
          row[end] <= 4 ||
          Math.abs(row[start] - row[end]) <= 4
        )
          continue;
        addIssue(
          asymmetry,
          issue(
            "asymmetric-padding",
            row.node,
            `${axis}: ${start}=${row[start]}px ${end}=${row[end]}px differs from repeated component baseline ${baselineStart}px/${baselineEnd}px`
          ),
          "asymmetry"
        );
      }
    }
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
    const children = (byParent.get(parent.index) || []).filter((node) => {
      const intersection = visibleIntersections.get(node);
      return (
        intersection.right - intersection.left >= 8 && intersection.bottom - intersection.top >= 8
      );
    });
    if (children.length < 3) continue;
    for (const [edge, offset] of [
      ["left", 0],
      ["right", 0],
    ]) {
      const values = children.map((node) => {
        const intersection = visibleIntersections.get(node);
        return {
          node,
          value: Math.round(edge === "left" ? intersection.left : intersection.right + offset),
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

const KEYBOARD_EVENT_BUDGET = 8192;
const KEY_DEFINITIONS = Object.freeze({
  ArrowDown: Object.freeze({ code: "ArrowDown", windowsVirtualKeyCode: 40 }),
  ArrowLeft: Object.freeze({ code: "ArrowLeft", windowsVirtualKeyCode: 37 }),
  ArrowRight: Object.freeze({ code: "ArrowRight", windowsVirtualKeyCode: 39 }),
  ArrowUp: Object.freeze({ code: "ArrowUp", windowsVirtualKeyCode: 38 }),
  Tab: Object.freeze({ code: "Tab", windowsVirtualKeyCode: 9 }),
});

async function dispatchKeyboardKey(client, key, budget, modifiers = 0) {
  if (budget.remaining < 1) return false;
  budget.remaining -= 1;
  const definition = KEY_DEFINITIONS[key];
  if (!definition) throw new Error(`unsupported composite keyboard probe key: ${key}`);
  const event = {
    key,
    code: definition.code,
    windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
    nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
    modifiers,
  };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...event });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...event });
  await client.send("Runtime.evaluate", { expression: "void 0", returnByValue: true });
  return true;
}

async function focusedBackendNodeId(client, executionContextId) {
  const focused = await client.send("Runtime.evaluate", {
    expression: "document.activeElement",
    contextId: executionContextId,
    objectGroup: "pm-composite-keyboard-probe",
    returnByValue: false,
    silent: true,
  });
  if (!focused.result?.objectId || focused.exceptionDetails) return null;
  try {
    const described = await client.send("DOM.describeNode", {
      objectId: focused.result.objectId,
      depth: 0,
    });
    return Number.isInteger(described.node?.backendNodeId) ? described.node.backendNodeId : null;
  } finally {
    await client.send("Runtime.releaseObject", { objectId: focused.result.objectId });
  }
}

function activeDescendantBackendNodeId(axNode) {
  const property = (axNode?.properties || []).find((item) => item.name === "activedescendant");
  const related = property?.value?.relatedNodes;
  const backendNodeId = Array.isArray(related) ? related[0]?.backendDOMNodeId : null;
  return Number.isInteger(backendNodeId) ? backendNodeId : null;
}

async function compositeFocusState(client, executionContextId, candidate) {
  const [focusedBackendNodeIdValue, partialTree] = await Promise.all([
    focusedBackendNodeId(client, executionContextId),
    client.send("Accessibility.getPartialAXTree", {
      backendNodeId: candidate.owner_backend_node_id,
      fetchRelatives: false,
    }),
  ]);
  const owner = (partialTree.nodes || []).find(
    (node) => node.backendDOMNodeId === candidate.owner_backend_node_id
  );
  return {
    activeDescendantBackendNodeId: activeDescendantBackendNodeId(owner),
    focusedBackendNodeId: focusedBackendNodeIdValue,
  };
}

function focusedCompositeMember(state, candidate, members) {
  if (members.has(state.focusedBackendNodeId)) return state.focusedBackendNodeId;
  if (
    state.focusedBackendNodeId === candidate.owner_backend_node_id &&
    members.has(state.activeDescendantBackendNodeId)
  )
    return state.activeDescendantBackendNodeId;
  return null;
}

async function entryHasDocumentKeyboardReach(
  client,
  executionContextId,
  entryBackendNodeId,
  entryProbe,
  budget
) {
  if (entryProbe) {
    await client.send("DOM.focus", { backendNodeId: entryProbe.from_backend_node_id });
    const focusedFrom = await focusedBackendNodeId(client, executionContextId);
    if (
      focusedFrom !== entryProbe.from_backend_node_id ||
      !(await dispatchKeyboardKey(client, "Tab", budget, entryProbe.modifiers))
    )
      return false;
    const focusedAfterTab = await focusedBackendNodeId(client, executionContextId);
    return focusedAfterTab === entryBackendNodeId;
  }
  for (const [leaveModifiers, returnModifiers] of [
    [0, 8],
    [8, 0],
  ]) {
    await client.send("DOM.focus", { backendNodeId: entryBackendNodeId });
    if ((await focusedBackendNodeId(client, executionContextId)) !== entryBackendNodeId) continue;
    if (!(await dispatchKeyboardKey(client, "Tab", budget, leaveModifiers))) return false;
    const departed = await focusedBackendNodeId(client, executionContextId);
    if (departed === entryBackendNodeId) continue;
    if (!(await dispatchKeyboardKey(client, "Tab", budget, returnModifiers))) return false;
    if ((await focusedBackendNodeId(client, executionContextId)) === entryBackendNodeId)
      return true;
  }
  return false;
}

async function probeCompositeKeyboardAccess(client, candidates) {
  if (candidates.length === 0) return new Set();
  const frameTree = await client.send("Page.getFrameTree");
  const frameId = frameTree.frameTree?.frame?.id;
  if (typeof frameId !== "string" || !frameId)
    throw new Error("browser omitted the frame for composite keyboard probing");
  const isolatedWorld = await client.send("Page.createIsolatedWorld", {
    frameId,
    worldName: "pm-composite-keyboard-probe",
    grantUniveralAccess: false,
  });
  if (!Number.isInteger(isolatedWorld.executionContextId))
    throw new Error("browser omitted the isolated composite keyboard context");
  const executionContextId = isolatedWorld.executionContextId;
  const budget = { remaining: KEYBOARD_EVENT_BUDGET };
  const observedMembers = new Set();
  try {
    for (const candidate of candidates) {
      const members = new Set(candidate.member_backend_node_ids);
      for (const entryBackendNodeId of candidate.entry_backend_node_ids) {
        let documentReachable = false;
        try {
          documentReachable = await entryHasDocumentKeyboardReach(
            client,
            executionContextId,
            entryBackendNodeId,
            candidate.entry_probes[entryBackendNodeId],
            budget
          );
        } catch {
          continue;
        }
        if (!documentReachable) continue;
        for (const key of COMPOSITE_ARROW_KEYS[candidate.owner_role]) {
          try {
            await client.send("DOM.focus", { backendNodeId: entryBackendNodeId });
            let state = await compositeFocusState(client, executionContextId, candidate);
            let previous = focusedCompositeMember(state, candidate, members);
            for (let step = 0; step < members.size; step += 1) {
              if (!(await dispatchKeyboardKey(client, key, budget))) return observedMembers;
              state = await compositeFocusState(client, executionContextId, candidate);
              const current = focusedCompositeMember(state, candidate, members);
              if (current === null || current === previous) break;
              observedMembers.add(current);
              previous = current;
            }
          } catch {
            // A detached or replaced widget cannot certify the frozen control rows.
          }
          if ([...members].every((member) => observedMembers.has(member))) break;
        }
      }
    }
    return observedMembers;
  } finally {
    await client.send("Runtime.releaseObjectGroup", { objectGroup: "pm-composite-keyboard-probe" });
  }
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
  const visibilityEvaluator = createVisibilityEvaluator(model, style, metrics);
  const hitRequirements = evaluateStateAssertion(
    stateAssertion,
    model,
    axTree,
    computedStyles,
    metrics,
    visibilityEvaluator
  );
  const assertionVisibility = await verifyAssertionHitTargets(
    client,
    hitRequirements,
    model,
    style,
    metrics,
    visibilityEvaluator
  );
  const accessibility = accessibilityEvidence(axTree, model);
  return {
    identity,
    assertionVisibility,
    accessibility: accessibility.observations,
    accessibilityControlBackendNodeIds: accessibility.controlBackendNodeIds,
    compositeKeyboardCandidates: compositeKeyboardCandidates(axTree, model),
    dom: domObservations(model, metrics, computedStyles, visibilityEvaluator),
  };
}

function canonicalSample(sample) {
  return JSON.stringify(sample);
}

async function main() {
  const config = JSON.parse(fs.readFileSync(0, "utf8"));
  const allowedOrigins = normalizeAllowedOrigins(config.allowedOrigins || []);
  const allowedNetworkOrigins = webSocketPolicyOrigins(allowedOrigins);
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
  let browserClient = null;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      if (browser.exitCode === null) {
        if (process.platform === "win32") browser.kill("SIGKILL");
        else process.kill(-browser.pid, "SIGKILL");
      }
    } catch {
      // Browser may have exited between observation and cleanup.
    }
    // Keep both protocol policies installed until after the browser has been
    // synchronously signalled for teardown. Closing either socket first would
    // leave a short fail-open execution window.
    if (client) client.close();
    if (browserClient) browserClient.close();
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
    let browserEndpoint = null;
    while (!browserEndpoint?.webSocketDebuggerUrl && Date.now() < endpointDeadline) {
      browserEndpoint = await requestJson(
        `http://127.0.0.1:${port}/json/version`,
        "GET",
        1_000
      ).catch(() => null);
      if (!browserEndpoint?.webSocketDebuggerUrl) await sleep(25);
    }
    if (!browserEndpoint?.webSocketDebuggerUrl)
      throw new Error("Chromium did not expose a debugging endpoint");
    let target = null;
    const targetDeadline = Date.now() + 10_000;
    while (!target && Date.now() < targetDeadline) {
      const targets = await requestJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
      target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (!target) await sleep(25);
    }
    if (!target) throw new Error("Chromium did not expose a page target");
    browserClient = await connect(browserEndpoint.webSocketDebuggerUrl);
    client = await connect(target.webSocketDebuggerUrl);

    const requests = [];
    const pendingRequests = new Set();
    const pendingWebSockets = new Set();
    const webSocketOrigins = new Map();
    const violations = [];
    const activeFetchHandlers = new Set();
    const activeTargetHandlers = new Set();
    const activeTargetStages = new Map();
    const attachedTargetSessions = new Set();
    const childWebSocketPolicyModes = new Map();
    const childTargetInfo = new Map();
    const childParentSession = new Map();
    const childBootstrapRequestObserved = new Set();
    let sequence = 0;
    let networkEpoch = 0;
    let networkOverflow = null;
    let handlerError = null;
    let firstViolationAt = null;
    let lastNetworkActivity = Date.now();
    let loadFired = false;
    let criticalWindow = false;
    let criticalDrift = null;
    let webSocketPolicyMode = "unconfigured";
    let mainTargetPolicyReady = false;
    const scopedRequestId = (connectionScope, sessionId, requestId) =>
      `${connectionScope}\0${sessionId || "root"}\0${requestId}`;
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
    const retainViolation = (request) => {
      if (violations.length > 0) return;
      violations.push(request);
      firstViolationAt = Date.now();
    };
    const assertNetworkHealthy = () => {
      if (handlerError) throw new Error(`network policy handler failed: ${handlerError}`);
      if (networkOverflow) throw new Error(networkOverflow);
      if (violations.length && Date.now() - firstViolationAt >= NETWORK_POLICY_OBSERVATION_MS)
        throw new Error(`network policy violation: ${violations[0].origin}`);
      if (criticalDrift) throw new Error(`page changed during atomic capture: ${criticalDrift}`);
    };
    client.on("Page.loadEventFired", (_event, sessionId) => {
      if (!sessionId) loadFired = true;
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
    const registerNetworkListeners = (eventClient, connectionScope) => {
      eventClient.on("Fetch.requestPaused", (event, sessionId) => {
        noteNetworkActivity();
        const handler = Promise.resolve()
          .then(async () => {
            if (!requestAllowed(event.request?.url, allowedNetworkOrigins)) {
              retainViolation(
                sanitizeRequest({ ...event.request, resourceType: event.resourceType }, ++sequence)
              );
              await eventClient.send(
                "Fetch.failRequest",
                {
                  requestId: event.requestId,
                  errorReason: "BlockedByClient",
                },
                sessionId
              );
              return;
            }
            await eventClient.send(
              "Fetch.continueRequest",
              { requestId: event.requestId },
              sessionId
            );
          })
          .catch((error) => {
            handlerError ||= error.message;
          })
          .finally(() => activeFetchHandlers.delete(handler));
        activeFetchHandlers.add(handler);
      });
      eventClient.on("Network.requestWillBeSent", (event, sessionId) => {
        noteNetworkActivity();
        try {
          const record = sanitizeRequest(
            { ...event.request, resourceType: event.type },
            ++sequence
          );
          retainRequest(record);
          const policyMode =
            connectionScope === "browser"
              ? childWebSocketPolicyModes.get(sessionId)
              : webSocketPolicyMode;
          if (
            (policyMode === "block-all-fallback" &&
              /^(?:http|https|ws|wss):\/\//.test(record.origin)) ||
            !requestAllowed(event.request?.url, allowedNetworkOrigins)
          )
            retainViolation(record);
        } catch (error) {
          handlerError ||= error.message;
        }

        // Chromium can replay the already-completed bootstrap request when
        // Network is enabled on a paused worker. That replay has no matching
        // loadingFinished event and must not masquerade as live network work.
        // Ignore only the first exact target-URL request for worker targets;
        // all fetches started by worker code remain tracked normally.
        const targetInfo = sessionId ? childTargetInfo.get(sessionId) : null;
        const isWorkerBootstrap =
          connectionScope === "browser" &&
          sessionId &&
          targetInfo &&
          WORKER_TARGET_TYPES.has(targetInfo.type) &&
          !childBootstrapRequestObserved.has(sessionId) &&
          event.request?.url === targetInfo.url;
        if (isWorkerBootstrap) {
          childBootstrapRequestObserved.add(sessionId);
          pendingRequests.delete(scopedRequestId("page", null, event.requestId));
          const parentSessionId = childParentSession.get(sessionId);
          if (parentSessionId)
            pendingRequests.delete(scopedRequestId("browser", parentSessionId, event.requestId));
        } else pendingRequests.add(scopedRequestId(connectionScope, sessionId, event.requestId));
      });
      const completeRequest = (event, sessionId) => {
        noteNetworkActivity();
        pendingRequests.delete(scopedRequestId(connectionScope, sessionId, event.requestId));
        if (
          connectionScope === "browser" &&
          sessionId &&
          WORKER_TARGET_TYPES.has(childTargetInfo.get(sessionId)?.type)
        ) {
          pendingRequests.delete(scopedRequestId("page", null, event.requestId));
          const parentSessionId = childParentSession.get(sessionId);
          if (parentSessionId)
            pendingRequests.delete(scopedRequestId("browser", parentSessionId, event.requestId));
        }
      };
      eventClient.on("Network.loadingFinished", completeRequest);
      eventClient.on("Network.loadingFailed", completeRequest);
      eventClient.on("Network.webSocketCreated", (event, sessionId) => {
        noteNetworkActivity();
        try {
          const requestId = scopedRequestId(connectionScope, sessionId, event.requestId);
          const record = sanitizeRequest(
            { url: event.url, method: "GET", resourceType: "WebSocket" },
            ++sequence
          );
          retainRequest(record);
          const policyMode =
            connectionScope === "browser"
              ? childWebSocketPolicyModes.get(sessionId)
              : webSocketPolicyMode;
          const allowed =
            policyMode !== "block-all-fallback" && requestAllowed(event.url, allowedNetworkOrigins);
          webSocketOrigins.set(requestId, record.origin);
          if (!allowed) retainViolation(record);
          else pendingWebSockets.add(requestId);
        } catch (error) {
          handlerError ||= error.message;
        }
      });
      eventClient.on("Network.webSocketWillSendHandshakeRequest", (event, sessionId) => {
        noteNetworkActivity();
        const requestId = scopedRequestId(connectionScope, sessionId, event.requestId);
        if (webSocketOrigins.has(requestId)) pendingWebSockets.add(requestId);
      });
      eventClient.on("Network.webSocketHandshakeResponseReceived", (event, sessionId) => {
        noteNetworkActivity();
        pendingWebSockets.delete(scopedRequestId(connectionScope, sessionId, event.requestId));
      });
      for (const eventName of ["Network.webSocketFrameSent", "Network.webSocketFrameReceived"])
        eventClient.on(eventName, () => noteNetworkActivity());
      eventClient.on("Network.webSocketFrameError", (event, sessionId) => {
        noteNetworkActivity();
        pendingWebSockets.delete(scopedRequestId(connectionScope, sessionId, event.requestId));
      });
      eventClient.on("Network.webSocketClosed", (event, sessionId) => {
        noteNetworkActivity();
        const requestId = scopedRequestId(connectionScope, sessionId, event.requestId);
        pendingWebSockets.delete(requestId);
        webSocketOrigins.delete(requestId);
      });
    };
    registerNetworkListeners(client, "page");
    registerNetworkListeners(browserClient, "browser");

    browserClient.on("Target.attachedToTarget", (event, parentSessionId) => {
      const sessionId = event.sessionId;
      const targetType = event.targetInfo?.type;
      if (
        typeof sessionId !== "string" ||
        !sessionId ||
        !NETWORK_CHILD_TARGET_TYPES.has(targetType)
      ) {
        handlerError ||= `unsupported paused browser target: ${targetType || "unknown"}`;
        return;
      }
      if (
        event.targetInfo.targetId !== target.id &&
        browserInternalTarget(event.targetInfo.url || "")
      ) {
        activeTargetStages.set(sessionId, `${targetType}:resume-internal`);
        const handler = browserClient
          .send("Runtime.runIfWaitingForDebugger", {}, sessionId)
          .catch((error) => {
            handlerError ||= `browser-internal target resume failed: ${error.message}`;
          })
          .finally(() => {
            activeTargetStages.delete(sessionId);
            activeTargetHandlers.delete(handler);
          });
        activeTargetHandlers.add(handler);
        return;
      }
      noteNetworkActivity();
      childTargetInfo.set(sessionId, event.targetInfo);
      childParentSession.set(sessionId, parentSessionId);
      activeTargetStages.set(sessionId, `${targetType}:auto-attach`);
      const handler = Promise.resolve()
        .then(async () => {
          // The Network domain does not become usable while a ServiceWorker is
          // paused at startup. The main page already bypasses service workers,
          // so terminate this background target before any of its code runs.
          if (targetType === "service_worker") {
            activeTargetStages.set(sessionId, `${targetType}:terminate`);
            await browserClient.send("Target.closeTarget", {
              targetId: event.targetInfo.targetId,
            });
            return;
          }
          await browserClient.send(
            "Target.setAutoAttach",
            {
              autoAttach: true,
              waitForDebuggerOnStart: true,
              flatten: true,
              filter: NETWORK_TARGET_FILTER,
            },
            sessionId
          );
          // The main page is controlled through its dedicated endpoint. Its
          // browser-level session exists only to install recursive auto-attach
          // before any page script can create a child target.
          if (event.targetInfo.targetId === target.id) {
            activeTargetStages.set(sessionId, `${targetType}:resume-main`);
            await browserClient.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
            mainTargetPolicyReady = true;
            return;
          }
          attachedTargetSessions.add(sessionId);
          activeTargetStages.set(sessionId, `${targetType}:network-enable`);
          await browserClient.send(
            "Network.enable",
            { maxTotalBufferSize: 1024 * 1024 },
            sessionId
          );
          activeTargetStages.set(sessionId, `${targetType}:network-policy`);
          const mode = await installTargetNetworkIsolation(
            browserClient,
            allowedOrigins,
            sessionId
          );
          childWebSocketPolicyModes.set(sessionId, mode);
          if (targetType === "page" || targetType === "iframe") {
            activeTargetStages.set(sessionId, `${targetType}:fetch-enable`);
            await browserClient.send(
              "Fetch.enable",
              { patterns: [{ urlPattern: "*", requestStage: "Request" }] },
              sessionId
            );
          }
          activeTargetStages.set(sessionId, `${targetType}:resume`);
          await browserClient.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
        })
        .catch((error) => {
          handlerError ||= `child target policy failed: ${error.message}`;
        })
        .finally(() => {
          activeTargetStages.delete(sessionId);
          activeTargetHandlers.delete(handler);
        });
      activeTargetHandlers.add(handler);
    });
    browserClient.on("Target.detachedFromTarget", (event) => {
      noteNetworkActivity();
      const detachedTarget = childTargetInfo.get(event.sessionId);
      const prefix = `browser\0${event.sessionId}\0`;
      for (const requestId of pendingRequests)
        if (requestId.startsWith(prefix)) pendingRequests.delete(requestId);
      for (const requestId of pendingWebSockets)
        if (requestId.startsWith(prefix)) pendingWebSockets.delete(requestId);
      for (const requestId of webSocketOrigins.keys())
        if (requestId.startsWith(prefix)) webSocketOrigins.delete(requestId);
      if (WORKER_TARGET_TYPES.has(detachedTarget?.type)) {
        pendingRequests.delete(scopedRequestId("page", null, detachedTarget.targetId));
        const parentSessionId = childParentSession.get(event.sessionId);
        if (parentSessionId)
          pendingRequests.delete(
            scopedRequestId("browser", parentSessionId, detachedTarget.targetId)
          );
      }
      attachedTargetSessions.delete(event.sessionId);
      childWebSocketPolicyModes.delete(event.sessionId);
      childTargetInfo.delete(event.sessionId);
      childParentSession.delete(event.sessionId);
      childBootstrapRequestObserved.delete(event.sessionId);
    });

    await browserClient.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: NETWORK_TARGET_FILTER,
    });
    const initialPolicyDeadline = Date.now() + 5_000;
    while (
      (!mainTargetPolicyReady || activeTargetHandlers.size > 0) &&
      Date.now() < initialPolicyDeadline
    ) {
      assertNetworkHealthy();
      await sleep(10);
    }
    assertNetworkHealthy();
    if (!mainTargetPolicyReady || activeTargetHandlers.size > 0)
      throw new Error("browser target auto-attach policy did not become ready");

    await client.send("Page.enable");
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    await client.send("Accessibility.enable");
    await client.send("Network.enable", { maxTotalBufferSize: 1024 * 1024 });
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Network.setBypassServiceWorker", { bypass: true });
    webSocketPolicyMode = await installTargetNetworkIsolation(client, allowedOrigins);
    await client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    const crossTargetBarrier = async () => {
      await client.send("Page.getFrameTree");
      for (const sessionId of [...attachedTargetSessions])
        await browserClient.send(
          "Runtime.evaluate",
          { expression: "void 0", returnByValue: true },
          sessionId
        );
    };
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
        violations.length === 0 &&
        pendingRequests.size === 0 &&
        pendingWebSockets.size === 0 &&
        activeFetchHandlers.size === 0 &&
        activeTargetHandlers.size === 0 &&
        Date.now() - lastNetworkActivity >= settleMs
      ) {
        readyAt = new Date().toISOString();
        break;
      }
      await sleep(25);
    }
    if (!readyAt) {
      throw new Error(
        "page did not reach complete, network-idle readiness " +
          `(requests=${pendingRequests.size}, sockets=${pendingWebSockets.size}, ` +
          `fetch=${activeFetchHandlers.size}, targets=${activeTargetHandlers.size}, ` +
          `target_stages=${[...activeTargetStages.values()].join(",") || "none"}, ` +
          `request_scopes=${
            [...pendingRequests].map((requestId) => requestId.split("\0", 2).join(":")).join(",") ||
            "none"
          })`
      );
    }

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
      "clip-path",
      "filter",
      "mask-image",
      "mask-mode",
      "mask-size",
      "mask-position",
      "mask-repeat",
      "mask-origin",
      "mask-clip",
      "mask-composite",
      "-webkit-mask-image",
      "position",
      "margin-bottom",
      "-webkit-mask-box-image-source",
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
        violations.length === 0 &&
        pendingRequests.size === 0 &&
        pendingWebSockets.size === 0 &&
        activeFetchHandlers.size === 0 &&
        activeTargetHandlers.size === 0 &&
        Date.now() - finalSettleStartedAt >= settleMs &&
        Date.now() - lastNetworkActivity >= settleMs
      )
        break;
      await sleep(25);
    }
    assertNetworkHealthy();
    if (
      pendingRequests.size > 0 ||
      pendingWebSockets.size > 0 ||
      activeFetchHandlers.size > 0 ||
      activeTargetHandlers.size > 0
    )
      throw new Error("network did not settle after atomic capture");

    const barrierEpoch = networkEpoch;
    await crossTargetBarrier();
    assertNetworkHealthy();
    if (networkEpoch !== barrierEpoch)
      throw new Error("network activity crossed the final protocol barrier");

    const observedFinalUrl = redactedUrlIdentity(middle.identity.final_url);
    const expectedFinalUrl = redactedUrlIdentity(config.expectedUrl || config.url);
    if (JSON.stringify(observedFinalUrl) !== JSON.stringify(expectedFinalUrl))
      throw new Error("navigation drift: observed final URL does not match expected URL identity");
    const publicPageIdentity = { ...middle.identity, final_url: observedFinalUrl };
    criticalWindow = false;

    // Exercise widget handlers only after the retained screenshot and DOM/AX samples are frozen.
    const compositeBackendNodeIds = await probeCompositeKeyboardAccess(
      client,
      middle.compositeKeyboardCandidates
    );
    for (const [index, backendNodeId] of middle.accessibilityControlBackendNodeIds.entries()) {
      const control = middle.accessibility.controls[index];
      if (compositeBackendNodeIds.has(backendNodeId) && control?.tab_index < 0) {
        control.focus_context = "composite";
      }
    }
    const probeSettleStartedAt = Date.now();
    const probeSettleDeadline = probeSettleStartedAt + Math.max(1_000, settleMs * 4);
    while (Date.now() < probeSettleDeadline) {
      assertNetworkHealthy();
      if (
        violations.length === 0 &&
        pendingRequests.size === 0 &&
        pendingWebSockets.size === 0 &&
        activeFetchHandlers.size === 0 &&
        activeTargetHandlers.size === 0 &&
        Date.now() - lastNetworkActivity >= settleMs
      )
        break;
      await sleep(25);
    }
    assertNetworkHealthy();
    if (
      pendingRequests.size > 0 ||
      pendingWebSockets.size > 0 ||
      activeFetchHandlers.size > 0 ||
      activeTargetHandlers.size > 0
    )
      throw new Error("network did not settle after composite keyboard probing");
    const probeBarrierEpoch = networkEpoch;
    await crossTargetBarrier();
    assertNetworkHealthy();
    if (networkEpoch !== probeBarrierEpoch)
      throw new Error("network activity crossed the composite keyboard protocol barrier");
    const postProbeFrameTree = await client.send("Page.getFrameTree");
    const postProbeUrl = postProbeFrameTree.frameTree?.frame?.url;
    if (
      typeof postProbeUrl !== "string" ||
      JSON.stringify(redactedUrlIdentity(postProbeUrl)) !== JSON.stringify(expectedFinalUrl)
    )
      throw new Error("navigation drift during composite keyboard probing");

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
  createVisibilityEvaluator,
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
  installWebSocketPolicy,
  normalizeAllowedOrigins,
  webSocketBlockPatterns,
  webSocketPolicyOrigins,
};
