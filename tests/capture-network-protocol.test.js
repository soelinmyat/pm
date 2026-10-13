"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  requiresNetworkCompletion,
  requestAllowed,
} = require("../scripts/design-critique-capture-probe");

test("in-memory script observations do not require physical network completion", () => {
  for (const url of [
    "blob:https://allowed.test/local-script",
    "data:text/javascript,void%200",
    "about:blank",
  ]) {
    assert.equal(requiresNetworkCompletion(url), false, url);
  }
});

test("physical transports still require completion", () => {
  for (const url of [
    "http://allowed.test/request",
    "https://allowed.test/request",
    "ws://allowed.test/socket",
    "wss://allowed.test/socket",
  ]) {
    assert.equal(requiresNetworkCompletion(url), true, url);
  }
});

test("a blob script still needs its origin to be allowed", () => {
  const origins = new Set(["https://allowed.test"]);
  assert.equal(requestAllowed("blob:https://allowed.test/local-script", origins), true);
  assert.equal(requestAllowed("blob:https://denied.test/local-script", origins), false);
});
