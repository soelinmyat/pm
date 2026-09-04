"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const {
  MAX_RAW_AUDIT_BYTES,
  normalizeAuditBytes,
} = require("../scripts/design-critique-audit-normalize");

const COMMIT = "a".repeat(40);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function accessibilityRaw(overrides = {}) {
  return {
    schema_version: 1,
    kind: "accessibility-tree",
    subject_id: "account-detail",
    commit: COMMIT,
    capture_ids: ["capture-account-primary"],
    observations: {
      landmarks: [{ role: "main", name: "", locator: "main#content" }],
      controls: [
        {
          role: "button",
          name: "Save account",
          locator: "button#save",
          disabled: false,
          tab_index: 0,
          document_index: 0,
        },
      ],
    },
    ...overrides,
  };
}

function domRaw(overrides = {}) {
  return {
    schema_version: 1,
    kind: "dom-audit",
    subject_id: "account-detail",
    commit: COMMIT,
    capture_ids: ["capture-account-primary"],
    observations: {
      viewport: { inner_width: 1440, client_width: 1425, scroll_width: 1425 },
      hierarchy: [],
      edge_alignment: [],
      consistency: [],
      asymmetry: [],
    },
    ...overrides,
  };
}

function normalize(raw, rawPath = "evidence/raw-a11y.json") {
  const bytes = Buffer.from(`${JSON.stringify(raw)}\n`);
  return normalizeAuditBytes(bytes, { path: rawPath, sha256: sha256(bytes) });
}

test("derives accessibility checks from raw roles, names, and focus measurements", () => {
  const raw = accessibilityRaw();
  raw.observations.controls.push({
    role: "link",
    name: "",
    locator: "a#unnamed",
    disabled: false,
    tab_index: -1,
    document_index: 1,
  });
  const audit = normalize(raw);

  assert.deepEqual(audit.checks, { landmarks: true, names: false, focus_order: false });
  assert.deepEqual(audit.raw, {
    path: "evidence/raw-a11y.json",
    sha256: sha256(Buffer.from(`${JSON.stringify(raw)}\n`)),
  });
  assert.deepEqual(
    audit.findings.map((item) => item.code),
    ["missing-accessible-name", "not-keyboard-reachable"]
  );
});

test("derives DOM checks from measured overflow and probe issue rows", () => {
  const raw = domRaw();
  raw.observations.viewport.scroll_width = 1450;
  raw.observations.hierarchy.push({
    code: "collapsed-heading-levels",
    locator: "h2.settings, h3.profile",
    detail: "h2 and h3 both render at 20px",
  });
  const audit = normalize(raw, "evidence/raw-dom.json");

  assert.deepEqual(audit.checks, {
    overflow: false,
    edge_alignment: true,
    hierarchy: false,
  });
  assert.deepEqual(
    audit.findings.map((item) => item.check),
    ["hierarchy", "overflow"]
  );
});

test("rejects raw probe input over the byte budget", () => {
  const bytes = Buffer.alloc(MAX_RAW_AUDIT_BYTES + 1, 0x20);
  assert.throws(
    () => normalizeAuditBytes(bytes, { path: "evidence/raw.json", sha256: sha256(bytes) }),
    /raw audit exceeds/
  );
});

test("CLI atomically writes an audit bound to the raw probe", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-design-audit-normalize-"));
  const rawPath = "evidence/raw.json";
  const outputPath = "evidence/audit.json";
  fs.mkdirSync(path.join(root, "evidence"), { recursive: true });
  fs.writeFileSync(path.join(root, rawPath), `${JSON.stringify(domRaw(), null, 2)}\n`);

  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [
        path.resolve(__dirname, "../scripts/design-critique-audit-normalize.js"),
        "--root",
        root,
        "--raw",
        rawPath,
        "--output",
        outputPath,
      ],
      { encoding: "utf8" }
    )
  );
  const audit = JSON.parse(fs.readFileSync(path.join(root, outputPath), "utf8"));
  const rawBytes = fs.readFileSync(path.join(root, rawPath));

  assert.equal(output.ok, true);
  assert.equal(audit.schema_version, 2);
  assert.deepEqual(audit.checks, { overflow: true, edge_alignment: true, hierarchy: true });
  assert.deepEqual(audit.raw, { path: rawPath, sha256: sha256(rawBytes) });
});
