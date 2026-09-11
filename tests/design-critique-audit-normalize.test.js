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
const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");

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

test("keeps composite controls in name checks but out of global focus order", () => {
  const raw = accessibilityRaw();
  raw.observations.controls.push({
    role: "tab",
    name: "",
    locator: "button#inactive-tab",
    disabled: false,
    tab_index: -1,
    focus_context: "composite",
    document_index: 1,
  });
  const audit = normalize(raw);

  assert.deepEqual(audit.checks, { landmarks: true, names: false, focus_order: true });
  assert.deepEqual(
    audit.findings.map((item) => [item.code, item.locator]),
    [["missing-accessible-name", "button#inactive-tab"]]
  );
});

test("defaults legacy controls to document focus and rejects unknown focus contexts", () => {
  const legacy = accessibilityRaw();
  legacy.observations.controls[0].tab_index = -1;
  assert.equal(normalize(legacy).checks.focus_order, false);

  const invalid = accessibilityRaw();
  invalid.observations.controls[0].focus_context = "widget";
  assert.throws(() => normalize(invalid), /focus_context must be document or composite/);
});

test("repeated landmark roles require distinct accessible names", () => {
  const raw = accessibilityRaw();
  raw.observations.landmarks.push(
    { role: "navigation", name: "Primary", locator: "nav#primary" },
    { role: "navigation", name: " primary ", locator: "nav#secondary" }
  );
  const audit = normalize(raw);

  assert.equal(audit.checks.landmarks, false);
  assert.equal(
    audit.findings.filter((finding) => finding.code === "duplicate-landmark-name").length,
    2
  );
});

test("canonically equivalent landmark names are duplicates", () => {
  const raw = accessibilityRaw();
  raw.observations.landmarks.push(
    { role: "navigation", name: "Café", locator: "nav#primary" },
    { role: "navigation", name: "Cafe\u0301", locator: "nav#secondary" }
  );
  const audit = normalize(raw);

  assert.equal(audit.checks.landmarks, false);
  assert.deepEqual(
    audit.findings
      .filter((finding) => finding.code === "duplicate-landmark-name")
      .map((finding) => finding.locator),
    ["nav#primary", "nav#secondary"]
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
    consistency: true,
    asymmetry: true,
  });
  assert.deepEqual(
    audit.findings.map((item) => item.check),
    ["hierarchy", "overflow"]
  );
});

test("derives failing checks for measured consistency and asymmetry defects", () => {
  const raw = domRaw();
  raw.observations.consistency.push({
    code: "inconsistent-control-height",
    locator: "button.primary, button.secondary",
    detail: "Peer actions render at different heights.",
  });
  raw.observations.asymmetry.push({
    code: "unbalanced-panel-gutters",
    locator: "main > section",
    detail: "The right gutter is 24px wider than the left gutter.",
  });
  const audit = normalize(raw, "evidence/raw-dom.json");

  assert.deepEqual(audit.checks, {
    overflow: true,
    edge_alignment: true,
    hierarchy: true,
    consistency: false,
    asymmetry: false,
  });
  assert.deepEqual(
    audit.findings.map((item) => item.check),
    ["consistency", "asymmetry"]
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
  assert.deepEqual(audit.checks, {
    overflow: true,
    edge_alignment: true,
    hierarchy: true,
    consistency: true,
    asymmetry: true,
  });
  assert.deepEqual(audit.raw, { path: rawPath, sha256: sha256(rawBytes) });
});

test("CLI opts into managed pointers only for canonical capture raw paths", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-design-audit-managed-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rawBytes = Buffer.from(`${JSON.stringify(domRaw(), null, 2)}\n`);
  const canonicalDirectory =
    ".pm/dev-sessions/example.ui_v2/design-critique/round-1/capture-primary-desktop";
  writeProjectDirectoryAtomic(
    root,
    canonicalDirectory,
    [
      ["dom-audit-raw.json", rawBytes],
      ["capture.json", "{}\n"],
    ],
    { commitFile: "capture.json" }
  );

  const script = path.resolve(__dirname, "../scripts/design-critique-audit-normalize.js");
  const rawPath = `${canonicalDirectory}/dom-audit-raw.json`;
  const outputPath = ".pm/dev-sessions/example.ui_v2/design-critique/round-1/dom-audit.json";
  const output = JSON.parse(
    execFileSync(
      process.execPath,
      [script, "--root", root, "--raw", rawPath, "--output", outputPath],
      { encoding: "utf8" }
    )
  );
  assert.equal(output.ok, true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, outputPath), "utf8")).raw, {
    path: rawPath,
    sha256: sha256(rawBytes),
  });

  writeProjectDirectoryAtomic(
    root,
    "evidence/capture-primary-desktop",
    [
      ["dom-audit-raw.json", rawBytes],
      ["capture.json", "{}\n"],
    ],
    { commitFile: "capture.json" }
  );
  assert.throws(
    () =>
      execFileSync(
        process.execPath,
        [
          script,
          "--root",
          root,
          "--raw",
          "evidence/capture-primary-desktop/dom-audit-raw.json",
          "--output",
          "evidence/dom-audit.json",
        ],
        { encoding: "utf8", stdio: "pipe" }
      ),
    /project path contains symlink/
  );
});

test("active named modal permits a hidden background main but preserves accessibility failures", () => {
  const raw = accessibilityRaw();
  raw.observations.landmarks = [];
  raw.observations.dialogs = [
    {
      role: "dialog",
      name: "Administration",
      locator: "dialog#settings",
      modal: true,
      contains_focus: true,
    },
  ];
  assert.equal(normalize(raw).checks.landmarks, true);
  raw.observations.dialogs[0].contains_focus = false;
  assert.equal(normalize(raw).checks.landmarks, false);
  raw.observations.dialogs[0].contains_focus = true;
  raw.observations.dialogs[0].modal = false;
  assert.equal(normalize(raw).checks.landmarks, false);
  raw.observations.dialogs[0].modal = true;
  raw.observations.dialogs[0].name = "";
  assert.equal(normalize(raw).checks.names, false);
  assert.equal(normalize(raw).checks.landmarks, false);
  raw.observations.dialogs[0].name = "Administration";
  raw.observations.controls[0].name = "";
  raw.observations.controls[0].tab_index = -1;
  assert.deepEqual(normalize(raw).checks, { landmarks: true, names: false, focus_order: false });
  raw.observations.landmarks = [
    { role: "main", name: "", locator: "main#a" },
    { role: "main", name: "", locator: "main#b" },
  ];
  assert.equal(normalize(raw).checks.landmarks, false);
});
