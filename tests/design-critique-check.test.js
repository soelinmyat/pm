"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { buildManifest, inspectHtmlArtifact } = require("../scripts/artifact-check");
const { checkDesignCritique, findingId } = require("../scripts/design-critique-check");

const COMMIT = "a".repeat(40);

function digest(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function write(root, rel, bytes) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  return { path: rel, sha256: digest(fs.readFileSync(file)) };
}

function makeFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-design-critique-"));
  const routePath = "evidence/route.json";
  const capturesPath = "evidence/captures.json";
  const reportPath = "evidence/report.json";
  const mode = options.mode || "product-ui";
  const platform = mode === "pm-artifact" ? "document" : "web";
  const artifact =
    mode === "pm-artifact"
      ? { ...write(root, "evidence/files/subject.html", artifactSubjectHtml()), kind: "report" }
      : null;
  const coverage =
    mode === "pm-artifact"
      ? [
          coverageRow("artifact-desktop", "primary", "desktop", true),
          coverageRow("artifact-tablet", "responsive", "tablet", true),
          coverageRow("artifact-narrow", "responsive", "narrow", true),
          coverageRow("artifact-print", "print", "print", true),
        ]
      : [
          coverageRow("ui-primary", "primary", "desktop", true),
          coverageRow(
            "ui-empty",
            "empty",
            "desktop",
            false,
            "The changed detail route has no empty collection state."
          ),
          coverageRow(
            "ui-error",
            "error",
            "desktop",
            false,
            "Error rendering is unchanged and outside this surface."
          ),
          coverageRow(
            "ui-boundary",
            "boundary",
            "desktop",
            false,
            "The fixed label has a validated maximum length."
          ),
        ];
  const route = {
    schema_version: 1,
    run_id: "dc-test-run",
    created_at: "2026-07-12T00:00:00Z",
    mode,
    source: {
      commit: COMMIT,
      base_ref: "origin/main",
      base_commit: "c".repeat(40),
      diff_sha256: "b".repeat(64),
    },
    subjects: [
      {
        id: "account-detail",
        title: "Account detail",
        surface: "/accounts/1",
        platform,
        ...(artifact ? { artifact } : {}),
      },
    ],
    coverage,
  };
  write(root, routePath, `${JSON.stringify(route, null, 2)}\n`);
  const routeBinding = binding(root, routePath);

  const captures = [];
  const artifactDimensions = {
    desktop: { width: 1440, height: 1000 },
    tablet: { width: 768, height: 1024 },
    narrow: { width: 500, height: 812 },
  };
  for (const row of coverage.filter((item) => item.required)) {
    const isPrint = row.state === "print";
    const viewport = artifactDimensions[row.viewport] || { width: 1440, height: 1000 };
    const captureHeight =
      mode === "pm-artifact" && !isPrint ? viewport.height + 200 : viewport.height;
    const file = write(
      root,
      `evidence/files/${row.id}.${isPrint ? "pdf" : "png"}`,
      isPrint ? validPdf() : validPng(viewport.width, captureHeight)
    );
    captures.push({
      id: `capture-${row.id}`,
      coverage_id: row.id,
      kind: isPrint ? "pdf" : "screenshot",
      ...file,
      active: true,
      round: 1,
      ...(isPrint
        ? { pages: 1 }
        : { width: viewport.width, height: captureHeight, full_page: mode === "pm-artifact" }),
      captured_at: "2026-07-12T00:01:00Z",
    });
  }
  const evidence = [auditEvidenceFile(root, "a11y", "accessibility-tree", captures)];
  if (mode === "product-ui") evidence.push(auditEvidenceFile(root, "dom", "dom-audit", captures));
  else {
    const artifactPath = path.join(root, artifact.path);
    const structural = buildManifest(
      artifactPath,
      inspectHtmlArtifact(fs.readFileSync(artifactPath), { expectedKind: "report" })
    );
    const renderCaptures = captures
      .filter((item) => item.kind === "screenshot")
      .map((item) => {
        const name = coverage.find((row) => row.id === item.coverage_id).viewport;
        const viewport = artifactDimensions[name];
        const screen = write(
          root,
          `evidence/files/artifact-${name}-screen.png`,
          validPng(viewport.width, viewport.height, 2)
        );
        return {
          name,
          ...viewport,
          path: path.join(root, screen.path),
          sha256: `sha256:${screen.sha256}`,
          bytes: fs.statSync(path.join(root, screen.path)).size,
          metrics: {
            innerWidth: viewport.width,
            clientWidth: viewport.width - 15,
            scrollWidth: viewport.width - 15,
            documentHeight: item.height,
            horizontalOverflow: false,
            mainVisible: true,
            h1Visible: true,
            bodyText: 500,
            anchorCount: 4,
          },
          full_page: {
            path: path.join(root, item.path),
            sha256: `sha256:${item.sha256}`,
            bytes: fs.statSync(path.join(root, item.path)).size,
            width: item.width,
            height: item.height,
          },
        };
      });
    const print = captures.find((item) => item.kind === "pdf");
    const render = {
      source: { path: artifactPath, sha256: `sha256:${artifact.sha256}` },
      captures: renderCaptures,
      print: {
        path: path.join(root, print.path),
        sha256: `sha256:${print.sha256}`,
        bytes: fs.statSync(path.join(root, print.path)).size,
        pages: 1,
      },
      checked_at: "2026-07-12T00:02:00Z",
    };
    evidence.push({
      id: "evidence-structural",
      subject_id: "account-detail",
      kind: "artifact-structural",
      ...write(root, "evidence/files/structural.json", `${JSON.stringify(structural)}\n`),
    });
    evidence.push({
      id: "evidence-render",
      subject_id: "account-detail",
      kind: "artifact-render",
      ...write(root, "evidence/files/render.json", `${JSON.stringify(render)}\n`),
    });
  }
  const captureDoc = {
    schema_version: 1,
    run_id: route.run_id,
    mode,
    commit: COMMIT,
    route: routeBinding,
    captures,
    evidence,
    checked_at: "2026-07-12T00:02:00Z",
  };
  write(root, capturesPath, `${JSON.stringify(captureDoc, null, 2)}\n`);

  const report = {
    schema_version: 1,
    run_id: route.run_id,
    mode,
    commit: COMMIT,
    route: routeBinding,
    captures: binding(root, capturesPath),
    outcome: "passed",
    rounds: 1,
    coverage: { required: captures.length, captured: captures.length, percent: 100 },
    scores: Object.fromEntries(
      (mode === "product-ui"
        ? ["hierarchy", "density", "consistency", "accessibility", "responsive", "state-clarity"]
        : ["hierarchy", "density", "consistency", "accessibility", "responsive", "print-navigation"]
      ).map((key) => [
        key,
        {
          value: 4,
          rationale: `${key} is supported by the cited current capture.`,
          evidence_ids: [captures[0].id],
        },
      ])
    ),
    findings: [],
    top_issue: "No unresolved design issue.",
    next_action: "Proceed to QA.",
    human_report: { path: "evidence/report.html" },
    checked_at: "2026-07-12T00:03:00Z",
  };
  write(root, reportPath, `${JSON.stringify(report, null, 2)}\n`);
  write(
    root,
    "evidence/report.html",
    htmlReport(binding(root, reportPath), binding(root, capturesPath), report)
  );
  return { root, routePath, capturesPath, reportPath, route, captures: captureDoc, report };
}

function coverageRow(id, state, viewport, required, reason = "") {
  return { id, subject_id: "account-detail", state, viewport, required, reason };
}

function auditEvidenceFile(root, id, kind, captures) {
  const checks =
    kind === "accessibility-tree"
      ? { landmarks: true, names: true, focus_order: true }
      : { overflow: true, edge_alignment: true, hierarchy: true };
  const audit = {
    schema_version: 1,
    subject_id: "account-detail",
    commit: COMMIT,
    capture_ids: captures.map((item) => item.id),
    checks,
    findings: [],
  };
  return {
    id: `evidence-${id}`,
    subject_id: "account-detail",
    kind,
    ...write(root, `evidence/files/${id}.json`, `${JSON.stringify(audit)}\n`),
  };
}

function validPng(width, height, marker = 0, ancillaryBytes = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) rows[row * (width * 4 + 1)] = 0;
  rows[rows.length - 1] = marker;
  const chunks = [Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header)];
  if (ancillaryBytes > 0) chunks.push(pngChunk("tEXt", Buffer.alloc(ancillaryBytes, 65)));
  chunks.push(pngChunk("IDAT", zlib.deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function validPdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(testCrc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function testCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function binding(root, rel) {
  return { path: rel, sha256: digest(fs.readFileSync(path.join(root, rel))) };
}

function htmlReport(source, captures, report) {
  source = { path: source.path, sha256: `sha256:${source.sha256}` };
  captures = { path: captures.path, sha256: `sha256:${captures.sha256}` };
  const meta = {
    schema_version: 1,
    id: "report:design-critique-test",
    kind: "report",
    slug: "design-critique-test",
    lifecycle: "reviewed",
    title: "Design critique test",
    generated_at: "2026-07-12T00:00:00Z",
    generator: { name: "pm:design-critique", version: "test" },
    source,
    evidence: [captures],
  };
  const findingMarkers = (report.findings || [])
    .map((finding) => {
      const projection = {
        id: finding.id,
        priority: finding.priority,
        status: finding.status,
        owner: finding.owner,
        summary: finding.summary,
        remediation: finding.remediation,
        evidence_ids: finding.evidence_ids,
        before_capture_id: finding.before_capture_id || null,
        after_capture_id: finding.after_capture_id || null,
      };
      const projectionHash = digest(Buffer.from(JSON.stringify(projection)));
      return `<article data-dc-finding-id="${finding.id}" data-dc-finding-priority="${finding.priority}" data-dc-finding-status="${finding.status}" data-dc-finding-sha256="${projectionHash}">${finding.priority} ${finding.status} ${finding.owner} ${finding.summary} ${finding.remediation} ${finding.evidence_ids.join(" ")}</article>`;
    })
    .join("");
  const scoreMarkers = Object.entries(report.scores)
    .map(
      ([key, score]) =>
        `<span data-dc-score-key="${key}" data-dc-score-value="${score.value}">${key} ${score.value} ${score.rationale}</span>`
    )
    .join("");
  const nextHash = digest(Buffer.from(report.next_action));
  const topIssueHash = digest(Buffer.from(report.top_issue));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Design critique test</title><script id="pm-artifact" type="application/json">${JSON.stringify(meta)}</script><style>.skip-link{position:absolute}.skip-link:focus{position:static}:focus-visible{outline:3px solid #05f}@media(max-width:600px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{nav{display:none}}</style></head><body><a class="skip-link" href="#main">Skip</a><nav aria-label="Report"><a href="#findings">Findings</a></nav><main id="main"><h1>Design critique test</h1><p>Reviewed</p><p data-dc-outcome="${report.outcome}">${report.outcome}</p><p data-dc-coverage="${report.coverage.percent}">${report.coverage.percent}%</p><p data-dc-top-issue-sha256="${topIssueHash}">${report.top_issue}</p><p data-dc-next-action-sha256="${nextHash}">${report.next_action}</p>${scoreMarkers}<section id="findings"><h2>Findings</h2><p>No blocking findings.</p>${findingMarkers}</section></main></body></html>`;
}

function artifactSubjectHtml() {
  const meta = {
    schema_version: 1,
    id: "report:artifact-subject",
    kind: "report",
    slug: "artifact-subject",
    lifecycle: "reviewed",
    title: "Artifact subject",
    generated_at: "2026-07-12T00:00:00Z",
    generator: { name: "pm:test", version: "1" },
    source: { path: "source.md", sha256: null },
    evidence: [],
  };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Artifact subject</title><script id="pm-artifact" type="application/json">${JSON.stringify(meta)}</script><style>.skip-link{position:absolute}.skip-link:focus{position:static}:focus-visible{outline:3px solid #05f}@media(max-width:600px){main{padding:1rem}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}@media print{nav{display:none}}</style></head><body><a class="skip-link" href="#main">Skip</a><nav aria-label="Report"><a href="#content">Content</a></nav><main id="main"><h1>Artifact subject</h1><p data-pm-lifecycle>reviewed</p><section id="content"><h2>Content</h2><p>Evidence subject.</p></section></main></body></html>`;
}

function check(fixture, commit = COMMIT, options = {}) {
  return checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    verifyGit: false,
    verifyBrowser: false,
    ...options,
  });
}

function renderedMarkers(report, hidden = () => false) {
  const rows = [
    [{ "data-dc-outcome": report.outcome }, report.outcome],
    [{ "data-dc-coverage": String(report.coverage.percent) }, `${report.coverage.percent}%`],
    [{ "data-dc-top-issue-sha256": digest(Buffer.from(report.top_issue)) }, report.top_issue],
    [{ "data-dc-next-action-sha256": digest(Buffer.from(report.next_action)) }, report.next_action],
    ...Object.entries(report.scores).map(([key, score]) => [
      { "data-dc-score-key": key, "data-dc-score-value": String(score.value) },
      score.rationale,
    ]),
  ];
  return rows.map(([attributes, text]) => ({
    attributes,
    text,
    visible: !hidden(attributes),
    inViewport: true,
  }));
}

function rewrite(root, rel, value) {
  write(root, rel, `${JSON.stringify(value, null, 2)}\n`);
}

function rewriteReportAndHtml(fixture) {
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  write(
    fixture.root,
    "evidence/report.html",
    htmlReport(
      binding(fixture.root, fixture.reportPath),
      binding(fixture.root, fixture.capturesPath),
      fixture.report
    )
  );
}

test("accepts a complete product UI evidence chain", () => {
  const fixture = makeFixture();
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("accepts a complete PM artifact evidence chain", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("rejects a PM artifact whose reviewed HTML bytes changed", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  fs.appendFileSync(
    path.join(fixture.root, fixture.route.subjects[0].artifact.path),
    "<!-- drift -->"
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match file bytes/);
});

test("rejects artifact captures not bound by the render manifest", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  render.captures[0].sha256 = `sha256:${"f".repeat(64)}`;
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /render hash and byte count must match the file/);
});

test("rejects artifact captures swapped between viewport labels", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  const desktop = { path: render.captures[0].path, sha256: render.captures[0].sha256 };
  render.captures[0].path = render.captures[2].path;
  render.captures[0].sha256 = render.captures[2].sha256;
  render.captures[2].path = desktop.path;
  render.captures[2].sha256 = desktop.sha256;
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /render dimensions must equal/);
});

test("rejects stale source identity", () => {
  const fixture = makeFixture();
  const result = check(fixture, "c".repeat(40));
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must equal current commit/);
});

test("rejects changed capture bytes", () => {
  const fixture = makeFixture();
  fs.appendFileSync(path.join(fixture.root, fixture.captures.captures[0].path), "changed");
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match file bytes/);
});

test("rejects screenshot bindings whose bytes are not an image", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const rebound = write(fixture.root, capture.path, "not an image");
  capture.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /invalid PNG capture/);
});

test("rejects decoded dimensions that differ from the capture manifest", () => {
  const fixture = makeFixture();
  fixture.captures.captures[0].width = 1;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /declared dimensions must equal 1440x1000/);
});

test("rejects PNG headers without a decodable pixel stream", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const fake = Buffer.alloc(1024);
  Buffer.from("89504e470d0a1a0a", "hex").copy(fake);
  fake.write("IHDR", 12, "ascii");
  fake.writeUInt32BE(1440, 16);
  fake.writeUInt32BE(1000, 20);
  const rebound = write(fixture.root, capture.path, fake);
  capture.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /PNG/);
});

test("rejects oversized evidence before reading it", () => {
  const fixture = makeFixture();
  const file = path.join(fixture.root, fixture.captures.captures[0].path);
  fs.truncateSync(file, 64 * 1024 * 1024 + 1);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /evidence budget/);
});

test("reads a large bound capture only once per validation run", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const large = write(fixture.root, capture.path, validPng(1440, 1000, 0, 4 * 1024 * 1024 + 1));
  capture.sha256 = large.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function counted(file, ...args) {
    try {
      if (fs.statSync(file).size > 4 * 1024 * 1024) reads += 1;
    } catch {}
    return original.call(this, file, ...args);
  };
  try {
    assert.deepEqual(check(fixture), { ok: true, issues: [] });
  } finally {
    fs.readFileSync = original;
  }
  assert.equal(reads, 1);
});

test("rejects missing required coverage", () => {
  const fixture = makeFixture();
  fixture.captures.captures = [];
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must have exactly one active capture/);
});

test("requires a primary device capture for mobile UI", () => {
  const fixture = makeFixture();
  fixture.route.subjects[0].platform = "mobile";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /mobile primary device capture is required/);
});

test("rejects empty accessibility audit evidence", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const rebound = write(fixture.root, evidence.path, "{}\n");
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /requires passing landmarks, names, focus_order/);
});

test("rejects a passed report with an open P1", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "design-critique",
    summary: "Primary action is visually subordinate.",
    remediation: "Increase action prominence.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /passed cannot contain open or deferred P0\/P1/);
});

test("allows a passed design gate to hand a P1 to QA without owning its verdict", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "save-flow",
    rule: "functional-navigation",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "open",
    owner: "qa",
    summary: "The post-save destination needs functional verification.",
    remediation: "Exercise the save flow in QA.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("rejects a human report whose visible outcome diverges from JSON", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace('data-dc-outcome="passed"', 'data-dc-outcome="failed"')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("rejects correct outcome attributes with contradictory visible text", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace('data-dc-outcome="passed">passed', 'data-dc-outcome="passed">failed')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers hidden in HTML comments", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(htmlPath, html.replace(marker, `<!-- ${marker} -->`));
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers inside hidden ancestors", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(htmlPath, html.replace(marker, `<div hidden>${marker}</div>`));
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

test("ignores semantic markers hidden by a stylesheet class", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = '<p data-dc-outcome="passed">passed</p>';
  fs.writeFileSync(
    htmlPath,
    html
      .replace("</style>", ".concealed{display:none}</style>")
      .replace(marker, `<div class="concealed">${marker}</div>`)
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible outcome marker must match report JSON/);
});

for (const [name, wrapper] of [
  ["an attribute selector", (marker) => `<style>[data-dc-outcome]{display:none}</style>${marker}`],
  ["a closed details element", (marker) => `<details>${marker}</details>`],
  ["a closed dialog element", (marker) => `<dialog>${marker}</dialog>`],
]) {
  test(`rejects an outcome marker hidden by ${name} in the rendered DOM`, () => {
    const fixture = makeFixture();
    const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
    const html = fs.readFileSync(htmlPath, "utf8");
    const marker = '<p data-dc-outcome="passed">passed</p>';
    fs.writeFileSync(htmlPath, html.replace(marker, wrapper(marker)));
    const result = check(fixture, COMMIT, {
      verifyBrowser: true,
      markerProbe: () =>
        renderedMarkers(fixture.report, (attributes) => attributes["data-dc-outcome"] === "passed"),
    });
    assert.equal(result.ok, false);
    assert.match(
      JSON.stringify(result.issues),
      /must exist exactly once with matching visible text/
    );
  });
}

test("rejects a marker whose JSON-bound text is hidden behind visible filler", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  const html = fs.readFileSync(htmlPath, "utf8");
  const marker = `<p data-dc-next-action-sha256="${digest(Buffer.from(fixture.report.next_action))}">${fixture.report.next_action}</p>`;
  fs.writeFileSync(
    htmlPath,
    html
      .replace("</style>", "[data-hide]{display:none}</style>")
      .replace(
        marker,
        marker.replace(
          fixture.report.next_action,
          `<span data-hide>${fixture.report.next_action}</span><span>Proceed</span>`
        )
      )
  );
  const markers = renderedMarkers(fixture.report);
  markers.find((item) => item.attributes["data-dc-next-action-sha256"]).text = "Proceed";
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text in the first screenful/);
});

test("rejects a summary marker outside the first screenful", () => {
  const fixture = makeFixture();
  const markers = renderedMarkers(fixture.report);
  markers.find((item) => item.attributes["data-dc-top-issue-sha256"]).inViewport = false;
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text in the first screenful/);
});

test("rejects a marker clipped by an overflow ancestor", () => {
  const fixture = makeFixture();
  const markers = renderedMarkers(fixture.report);
  markers.find((item) => item.attributes["data-dc-score-key"] === "hierarchy").visible = false;
  const result = check(fixture, COMMIT, {
    verifyBrowser: true,
    markerProbe: () => markers,
  });
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /matching visible text/);
});

test("rejects failed outcome without a blocking design finding or reason", () => {
  const fixture = makeFixture();
  fixture.report.outcome = "failed";
  fixture.report.top_issue = "No unresolved design issue.";
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /failed requires an unresolved Design Critique P0\/P1/
  );
});

test("rejects unknown durable schema fields", () => {
  const fixture = makeFixture();
  fixture.route.source.base_sha = "typo";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /route\.source\.base_sha.*unknown field/);
});

test("rejects a human report whose visible score diverges from JSON", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace(
        'data-dc-score-key="hierarchy" data-dc-score-value="4"',
        'data-dc-score-key="hierarchy" data-dc-score-value="1"'
      )
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible score hierarchy must match report JSON/);
});

test("verifies the frozen git diff hash when enabled", () => {
  const fixture = makeFixture();
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: fixture.root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: fixture.root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: fixture.root });
  write(fixture.root, "source.txt", "base\n");
  execFileSync("git", ["add", "."], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: fixture.root });
  const base = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture.root,
    encoding: "utf8",
  }).trim();
  write(fixture.root, "source.txt", "changed\n");
  execFileSync("git", ["add", "source.txt"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "change"], { cwd: fixture.root });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: fixture.root,
    encoding: "utf8",
  }).trim();
  const origin = path.join(path.dirname(fixture.root), `${path.basename(fixture.root)}-origin.git`);
  execFileSync("git", ["init", "-q", "--bare", origin]);
  execFileSync("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
  execFileSync("git", ["remote", "add", "origin", origin], { cwd: fixture.root });
  execFileSync("git", ["push", "-q", "origin", `${base}:refs/heads/main`], {
    cwd: fixture.root,
  });
  const diff = execFileSync("git", ["diff", "--binary", `${base}...${commit}`], {
    cwd: fixture.root,
  });
  fixture.route.source = {
    commit,
    base_ref: "origin/main",
    base_commit: base,
    diff_sha256: digest(diff),
  };
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.commit = commit;
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  )) {
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
    audit.commit = commit;
    const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
    evidence.sha256 = rebound.sha256;
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.commit = commit;
  fixture.report.route = binding(fixture.root, fixture.routePath);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = checkDesignCritique({
    root: fixture.root,
    routePath: fixture.routePath,
    capturesPath: fixture.capturesPath,
    reportPath: fixture.reportPath,
    commit,
    baseRef: "origin/main",
    baseCommit: base,
  });
  assert.deepEqual(result, { ok: true, issues: [] });
  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit: base,
        baseRef: "origin/main",
        baseCommit: base,
      }).issues
    ),
    /supplied commit must equal current HEAD/
  );
  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit,
        baseRef: commit,
        baseCommit: commit,
      }).issues
    ),
    /supplied base must equal remote default origin\/main/
  );
  fixture.route.source.diff_sha256 = "0".repeat(64);
  rewrite(fixture.root, fixture.routePath, fixture.route);
  assert.match(
    JSON.stringify(
      checkDesignCritique({
        root: fixture.root,
        routePath: fixture.routePath,
        capturesPath: fixture.capturesPath,
        reportPath: fixture.reportPath,
        commit,
        baseRef: "origin/main",
        baseCommit: base,
      }).issues
    ),
    /does not match the frozen git diff bytes/
  );
});

test("rejects resolved P1 without distinct before and after evidence", () => {
  const fixture = makeFixture();
  const captureId = fixture.captures.captures[0].id;
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [captureId],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "Primary action was visually subordinate.",
    remediation: "Increased action prominence.",
    before_capture_id: captureId,
    after_capture_id: captureId,
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewrite(fixture.root, fixture.reportPath, fixture.report);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct before and after capture hashes/);
});

test("accepts a resolved P1 with inactive before and active after captures", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures[0];
  before.active = false;
  const afterFile = write(
    fixture.root,
    "evidence/files/ui-primary-after.png",
    validPng(1440, 1000, 1)
  );
  const after = {
    ...before,
    id: "capture-ui-primary-after",
    ...afterFile,
    active: true,
    round: 2,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(after);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  )) {
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
    audit.capture_ids.push(after.id);
    const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
    evidence.sha256 = rebound.sha256;
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [before.id, after.id],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "Primary action hierarchy was repaired.",
    remediation: "Keep the corrected hierarchy.",
    before_capture_id: before.id,
    after_capture_id: after.id,
  };
  finding.id = findingId(finding);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.findings = [finding];
  for (const score of Object.values(fixture.report.scores)) score.evidence_ids = [after.id];
  rewriteReportAndHtml(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("rejects an active capture older than an inactive later round", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures[0];
  const laterFile = write(
    fixture.root,
    "evidence/files/ui-primary-later.png",
    validPng(1440, 1000, 3)
  );
  const later = {
    ...before,
    id: "capture-ui-primary-later",
    ...laterFile,
    active: false,
    round: 2,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(later);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  )) {
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
    audit.capture_ids.push(later.id);
    const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
    evidence.sha256 = rebound.sha256;
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must use the latest round/);
});

test("rejects evidence paths that escape the project root", () => {
  const fixture = makeFixture();
  fixture.captures.captures[0].path = "../outside.png";
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /escapes the project root/);
});
