"use strict";

const crypto = require("node:crypto");
const { stableStringify } = require("./workflow-runtime/records");

function withoutAuthentication(value) {
  const material = { ...value };
  delete material.authentication;
  return material;
}

function stableObjectHmac(value, key) {
  const bytes = Buffer.isBuffer(key) ? key : Buffer.from(String(key || ""));
  if (bytes.length < 32) return null;
  return `hmac-sha256:${crypto
    .createHmac("sha256", bytes)
    .update(stableStringify(withoutAuthentication(value)))
    .digest("hex")}`;
}

module.exports = { stableObjectHmac, withoutAuthentication };
