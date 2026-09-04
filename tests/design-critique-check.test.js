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
const { normalizeAuditBytes } = require("../scripts/design-critique-audit-normalize");
const { checkDesignCritique, findingId } = require("../scripts/design-critique-check");
const { inspectPngVisualBytes } = require("../scripts/lib/media-inspect");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const COMMIT = "a".repeat(40);
const PNG_CACHE = new Map();

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
  const routeSchemaVersion = options.routeSchemaVersion ?? 2;
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
      : routeSchemaVersion === 1
        ? [
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
          ]
        : [
            coverageRow("ui-primary", "primary", "desktop", true),
            coverageRow("ui-primary-narrow", "primary", "narrow", true),
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
            ...["loading", "success", "focus", "disabled", "keyboard", "modal"].map((state) =>
              coverageRow(
                `ui-${state}`,
                state,
                "desktop",
                false,
                `The ${state} state is not present on this static detail surface.`
              )
            ),
          ];
  const route = {
    schema_version: routeSchemaVersion,
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
    const captureBytes = isPrint ? validPdf() : validPng(viewport.width, captureHeight);
    const file = write(root, `evidence/files/${row.id}.${isPrint ? "pdf" : "png"}`, captureBytes);
    const pixels = isPrint ? null : inspectPngVisualBytes(captureBytes);
    captures.push({
      id: `capture-${row.id}`,
      coverage_id: row.id,
      kind: isPrint ? "pdf" : "screenshot",
      ...file,
      active: true,
      round: 1,
      ...(isPrint
        ? { pages: 1 }
        : {
            width: viewport.width,
            height: captureHeight,
            full_page: mode === "pm-artifact",
            ...(mode === "product-ui" ? { pixel_sha256: pixels.pixelSha256 } : {}),
          }),
      captured_at: "2026-07-12T00:01:00Z",
    });
  }
  const evidence = [];
  if (mode === "product-ui" && routeSchemaVersion === 2) {
    for (const capture of captures) {
      evidence.push(
        auditEvidenceFile(
          root,
          `a11y-${capture.id}`,
          "accessibility-tree",
          [capture],
          routeSchemaVersion
        ),
        auditEvidenceFile(root, `dom-${capture.id}`, "dom-audit", [capture], routeSchemaVersion)
      );
    }
  } else {
    evidence.push(
      auditEvidenceFile(root, "a11y", "accessibility-tree", captures, routeSchemaVersion)
    );
  }
  if (mode === "product-ui" && routeSchemaVersion === 1)
    evidence.push(auditEvidenceFile(root, "dom", "dom-audit", captures, routeSchemaVersion));
  if (mode === "pm-artifact") {
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
          path: screen.path,
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
            path: item.path,
            sha256: `sha256:${item.sha256}`,
            bytes: fs.statSync(path.join(root, item.path)).size,
            width: item.width,
            height: item.height,
          },
        };
      });
    const print = captures.find((item) => item.kind === "pdf");
    const render = {
      source: { path: artifact.path, sha256: `sha256:${artifact.sha256}` },
      captures: renderCaptures,
      print: {
        path: print.path,
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
          evidence_ids: scoreEvidenceIds(key, mode, coverage, captures, evidence),
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

function scoreEvidenceIds(key, mode, coverage, captures, evidence) {
  const active = captures.filter((item) => item.active === true);
  const coverageById = new Map(coverage.map((item) => [item.id, item]));
  const idsOfKind = (...kinds) =>
    evidence.filter((item) => kinds.includes(item.kind)).map((item) => item.id);
  if (key === "accessibility") return idsOfKind("accessibility-tree");
  if (key === "consistency")
    return mode === "product-ui"
      ? idsOfKind("dom-audit")
      : idsOfKind("artifact-structural", "artifact-render");
  if (key === "responsive")
    return [
      ...active
        .filter((item) =>
          ["desktop", "tablet", "narrow", "device"].includes(
            coverageById.get(item.coverage_id)?.viewport
          )
        )
        .map((item) => item.id),
      ...(mode === "product-ui" ? idsOfKind("dom-audit") : idsOfKind("artifact-render")),
    ];
  if (key === "state-clarity") return active.map((item) => item.id);
  if (key === "print-navigation")
    return [
      ...active
        .filter((item) => coverageById.get(item.coverage_id)?.viewport === "print")
        .map((item) => item.id),
      ...idsOfKind("artifact-structural", "artifact-render"),
    ];
  return active.map((item) => item.id);
}

function addRequiredStateCapture(fixture, state, bytes) {
  const coverage = fixture.route.coverage.find((item) => item.id === `ui-${state}`);
  coverage.required = true;
  coverage.reason = "";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  const decoded = inspectPngVisualBytes(bytes);
  const file = write(fixture.root, `evidence/files/ui-${state}.png`, bytes);
  const capture = {
    id: `capture-ui-${state}`,
    coverage_id: coverage.id,
    kind: "screenshot",
    ...file,
    active: true,
    round: 1,
    width: decoded.width,
    height: decoded.height,
    full_page: false,
    pixel_sha256: decoded.pixelSha256,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(capture);
  fixture.captures.evidence.push(
    auditEvidenceFile(fixture.root, `a11y-capture-ui-${state}`, "accessibility-tree", [capture], 2),
    auditEvidenceFile(fixture.root, `dom-capture-ui-${state}`, "dom-audit", [capture], 2)
  );
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  const required = fixture.route.coverage.filter((item) => item.required).length;
  fixture.report.coverage = { required, captured: required, percent: 100 };
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
}

function addProductUiSubject(fixture, subjectId) {
  fixture.route.subjects.push({
    id: subjectId,
    title: "Billing detail",
    surface: "/billing/1",
    platform: "web",
  });
  const addedCoverage = fixture.route.coverage.map((item) => ({
    ...item,
    id: item.id.replace(/^ui-/, `${subjectId}-`),
    subject_id: subjectId,
  }));
  fixture.route.coverage.push(...addedCoverage);
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);

  let marker = 10;
  for (const row of addedCoverage.filter((item) => item.required)) {
    const viewport =
      row.viewport === "narrow" ? { width: 500, height: 812 } : { width: 1440, height: 1000 };
    const bytes = validPng(viewport.width, viewport.height, marker++);
    const file = write(fixture.root, `evidence/files/${row.id}.png`, bytes);
    const capture = {
      id: `capture-${row.id}`,
      coverage_id: row.id,
      kind: "screenshot",
      ...file,
      active: true,
      round: 1,
      ...viewport,
      full_page: false,
      pixel_sha256: inspectPngVisualBytes(bytes).pixelSha256,
      captured_at: "2026-07-12T00:01:00Z",
    };
    fixture.captures.captures.push(capture);
    fixture.captures.evidence.push(
      auditEvidenceFile(
        fixture.root,
        `a11y-${capture.id}`,
        "accessibility-tree",
        [capture],
        2,
        subjectId
      ),
      auditEvidenceFile(fixture.root, `dom-${capture.id}`, "dom-audit", [capture], 2, subjectId)
    );
  }
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  const required = fixture.route.coverage.filter((item) => item.required).length;
  fixture.report.coverage = { required, captured: required, percent: 100 };
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
}

function coverageRow(id, state, viewport, required, reason = "") {
  return { id, subject_id: "account-detail", state, viewport, required, reason };
}

function auditEvidenceFile(
  root,
  id,
  kind,
  captures,
  routeSchemaVersion,
  subjectId = "account-detail"
) {
  const checks =
    kind === "accessibility-tree"
      ? { landmarks: true, names: true, focus_order: true }
      : routeSchemaVersion === 1
        ? { overflow: true, edge_alignment: true, hierarchy: true }
        : {
            overflow: true,
            edge_alignment: true,
            hierarchy: true,
            consistency: true,
            asymmetry: true,
          };
  const captureIds = captures.map((item) => item.id);
  let audit;
  if (routeSchemaVersion === 1) {
    audit = {
      schema_version: 1,
      subject_id: subjectId,
      commit: COMMIT,
      capture_ids: captureIds,
      checks,
      findings: [],
    };
  } else {
    const raw =
      kind === "accessibility-tree"
        ? {
            schema_version: 1,
            kind,
            subject_id: subjectId,
            commit: COMMIT,
            capture_ids: captureIds,
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
          }
        : {
            schema_version: 1,
            kind,
            subject_id: subjectId,
            commit: COMMIT,
            capture_ids: captureIds,
            observations: {
              viewport: {
                inner_width: captures[0].width,
                client_width: captures[0].width,
                scroll_width: captures[0].width,
              },
              hierarchy: [],
              edge_alignment: [],
              consistency: [],
              asymmetry: [],
            },
          };
    const rawFile = write(root, `evidence/files/${id}-raw.json`, `${JSON.stringify(raw)}\n`);
    audit = normalizeAuditBytes(fs.readFileSync(path.join(root, rawFile.path)), rawFile);
  }
  return {
    id: `evidence-${id}`,
    subject_id: subjectId,
    kind,
    ...write(root, `evidence/files/${id}.json`, `${JSON.stringify(audit)}\n`),
  };
}

function rewriteNormalizedAudit(fixture, evidence, mutate) {
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  if (audit.schema_version === 1) {
    mutate(audit);
  } else {
    const raw = JSON.parse(fs.readFileSync(path.join(fixture.root, audit.raw.path), "utf8"));
    mutate(raw);
    const rawFile = write(fixture.root, audit.raw.path, `${JSON.stringify(raw)}\n`);
    Object.assign(
      audit,
      normalizeAuditBytes(fs.readFileSync(path.join(fixture.root, rawFile.path)), rawFile)
    );
  }
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
  evidence.sha256 = rebound.sha256;
}

function validPng(width, height, marker = 0, ancillaryBytes = 0) {
  const cacheKey = `${width}:${height}:${marker}:${ancillaryBytes}`;
  if (PNG_CACHE.has(cacheKey)) return PNG_CACHE.get(cacheKey);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * (width * 4 + 1);
    rows[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      rows[pixel] = 245;
      rows[pixel + 1] = 245;
      rows[pixel + 2] = 245;
      rows[pixel + 3] = 255;
    }
  }
  const lastPixel = rows.length - 4;
  rows[lastPixel] = marker;
  rows[lastPixel + 1] = 30;
  rows[lastPixel + 2] = 60;
  rows[lastPixel + 3] = 255;
  const chunks = [Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header)];
  if (ancillaryBytes > 0) chunks.push(pngChunk("tEXt", Buffer.alloc(ancillaryBytes, 65)));
  chunks.push(pngChunk("IDAT", zlib.deflateSync(rows)), pngChunk("IEND", Buffer.alloc(0)));
  const png = Buffer.concat(chunks);
  PNG_CACHE.set(cacheKey, png);
  return png;
}

function transparentPng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
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
    generator: { name: "pm:design-critique", version: PLUGIN_VERSION },
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
    firstScreenText: text,
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

test("rejects non-portable absolute paths in retained artifact renders", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const renderEvidence = fixture.captures.evidence.find((item) => item.kind === "artifact-render");
  const render = JSON.parse(fs.readFileSync(path.join(fixture.root, renderEvidence.path), "utf8"));
  render.captures[0].path = path.join(fixture.root, render.captures[0].path);
  const rebound = write(fixture.root, renderEvidence.path, `${JSON.stringify(render, null, 2)}\n`);
  renderEvidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must be a relative path/);
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

test("rejects one canonical capture path reused for distinct required states", () => {
  const fixture = makeFixture();
  const [desktop, narrow] = fixture.captures.captures;
  narrow.path = desktop.path;
  narrow.sha256 = desktop.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*canonical capture path/);
});

test("rejects identical capture bytes stored under distinct required-state paths", () => {
  const fixture = makeFixture();
  const [desktop, narrow] = fixture.captures.captures;
  const desktopBytes = fs.readFileSync(path.join(fixture.root, desktop.path));
  const rebound = write(fixture.root, narrow.path, desktopBytes);
  narrow.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*capture content hash/);
});

test("rejects re-encoded identical pixels for distinct required states", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const reencoded = validPng(desktop.width, desktop.height, 0, 64);
  addRequiredStateCapture(fixture, "success", reencoded);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /distinct required coverage.*decoded-pixel hash/);
});

test("rejects a transparent product UI screenshot", () => {
  const fixture = makeFixture();
  const capture = fixture.captures.captures[0];
  const bytes = transparentPng(capture.width, capture.height);
  const rebound = write(fixture.root, capture.path, bytes);
  capture.sha256 = rebound.sha256;
  capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /visible pixels must cover at least/);
});

for (const [coverageId, width] of [
  ["ui-primary", 1440],
  ["ui-primary-narrow", 500],
]) {
  test(`rejects a one-pixel-tall ${coverageId} capture`, () => {
    const fixture = makeFixture();
    const capture = fixture.captures.captures.find((item) => item.coverage_id === coverageId);
    const bytes = validPng(width, 1, 0, 1024);
    const rebound = write(fixture.root, capture.path, bytes);
    capture.sha256 = rebound.sha256;
    capture.pixel_sha256 = inspectPngVisualBytes(bytes).pixelSha256;
    capture.width = width;
    capture.height = 1;
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), /capture height must be at least/);
  });
}

test("rejects a PDF substituted for a mobile product UI capture", () => {
  const fixture = makeFixture();
  fixture.route.subjects[0].platform = "mobile";
  fixture.route.coverage.find((item) => item.id === "ui-primary").viewport = "device";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  const capture = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  const rebound = write(fixture.root, "evidence/files/ui-primary.pdf", validPdf());
  capture.kind = "pdf";
  capture.path = rebound.path;
  capture.sha256 = rebound.sha256;
  capture.pages = 1;
  delete capture.width;
  delete capture.height;
  delete capture.full_page;
  delete capture.pixel_sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.route = fixture.captures.route;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /product UI coverage requires a screenshot/);
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
  const target = fs.realpathSync(path.join(fixture.root, capture.path));
  const original = fs.openSync;
  let reads = 0;
  fs.openSync = function counted(file, ...args) {
    try {
      if (fs.realpathSync(String(file)) === target) reads += 1;
    } catch {
      // A missing/non-path open cannot be the retained capture under observation.
    }
    return original.call(this, file, ...args);
  };
  try {
    assert.deepEqual(check(fixture), { ok: true, issues: [] });
  } finally {
    fs.openSync = original;
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

test("requires primary narrow viewport evidence for web UI", () => {
  const fixture = makeFixture();
  fixture.route.coverage = fixture.route.coverage.filter((item) => item.viewport !== "narrow");
  rewrite(fixture.root, fixture.routePath, fixture.route);
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /web primary narrow capture is required/);
});

test("does not let a responsive narrow state replace the primary narrow capture", () => {
  const fixture = makeFixture();
  const narrow = fixture.route.coverage.find((item) => item.viewport === "narrow");
  narrow.state = "responsive";
  rewrite(fixture.root, fixture.routePath, fixture.route);
  fixture.captures.route = binding(fixture.root, fixture.routePath);
  fixture.report.route = fixture.captures.route;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /web primary narrow capture is required/);
});

test("rejects a wide product UI screenshot labeled narrow", () => {
  const fixture = makeFixture();
  const narrowCoverage = fixture.route.coverage.find((item) => item.viewport === "narrow");
  const capture = fixture.captures.captures.find((item) => item.coverage_id === narrowCoverage.id);
  const rebound = write(fixture.root, capture.path, validPng(1440, 1000));
  capture.sha256 = rebound.sha256;
  capture.width = 1440;
  capture.height = 1000;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(
    JSON.stringify(result.issues),
    /narrow web capture width must be at most 600 pixels/
  );
});

test("legacy route v1 is readable for migration but cannot certify a current pass", () => {
  const fixture = makeFixture({ routeSchemaVersion: 1 });
  const enforced = check(fixture);
  assert.equal(enforced.ok, false);
  assert.match(JSON.stringify(enforced.issues), /schema version 1 is migration-only/);

  assert.deepEqual(check(fixture, COMMIT, { legacyRouteMode: "inspect" }), {
    ok: false,
    authoritative: false,
    inspection_ok: true,
    issues: [],
  });
});

test("documents route v2 as the only schema for newly authored critique routes", () => {
  const contract = fs.readFileSync(
    path.join(__dirname, "../skills/design-critique/references/evidence-contract.md"),
    "utf8"
  );
  const scope = fs.readFileSync(
    path.join(__dirname, "../skills/design-critique/steps/01-scope.md"),
    "utf8"
  );
  assert.match(contract, /"schema_version": 2/);
  assert.match(`${contract}\n${scope}`, /never create a new route with schema version 1/i);
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

test("rejects a normalized audit when its raw probe bytes are tampered", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  fs.appendFileSync(path.join(fixture.root, audit.raw.path), "\n");

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /does not match raw probe bytes/);
});

test("rejects a claimed passing boolean contradicted by the raw probe", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  const raw = JSON.parse(fs.readFileSync(path.join(fixture.root, audit.raw.path), "utf8"));
  raw.observations.viewport.scroll_width = raw.observations.viewport.client_width + 20;
  const rawFile = write(fixture.root, audit.raw.path, `${JSON.stringify(raw)}\n`);
  const contradicted = normalizeAuditBytes(
    fs.readFileSync(path.join(fixture.root, rawFile.path)),
    rawFile
  );
  contradicted.checks.overflow = true;
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(contradicted)}\n`);
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /deterministic normalization of the bound raw probe/);
});

for (const issueKind of ["consistency", "asymmetry"]) {
  test(`rejects a normalized DOM audit with a measured ${issueKind} defect`, () => {
    const fixture = makeFixture();
    const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
    rewriteNormalizedAudit(fixture, evidence, (raw) => {
      raw.observations[issueKind].push({
        code: `${issueKind}-defect`,
        locator: "main > section",
        detail: `Measured ${issueKind} defect in the rendered interface.`,
      });
    });
    rewrite(fixture.root, fixture.capturesPath, fixture.captures);
    fixture.report.captures = binding(fixture.root, fixture.capturesPath);
    rewriteReportAndHtml(fixture);

    const result = check(fixture);
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result.issues), new RegExp(`requires passing.*${issueKind}`));
  });
}

test("rejects one desktop DOM probe claiming both desktop and narrow captures", () => {
  const fixture = makeFixture();
  const desktop = fixture.captures.captures.find((item) => item.width === 1440);
  const narrow = fixture.captures.captures.find((item) => item.width === 500);
  const desktopEvidence = fixture.captures.evidence.find((item) => {
    if (item.kind !== "dom-audit") return false;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return audit.capture_ids.includes(desktop.id);
  });
  fixture.captures.evidence = fixture.captures.evidence.filter((item) => {
    if (item.kind !== "dom-audit" || item === desktopEvidence) return true;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return !audit.capture_ids.includes(narrow.id);
  });
  rewriteNormalizedAudit(fixture, desktopEvidence, (raw) => {
    raw.capture_ids = [desktop.id, narrow.id];
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must cite exactly one capture/);
});

test("rejects a narrow DOM probe measured at the desktop viewport", () => {
  const fixture = makeFixture();
  const narrow = fixture.captures.captures.find((item) => item.width === 500);
  const evidence = fixture.captures.evidence.find((item) => {
    if (item.kind !== "dom-audit") return false;
    const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, item.path), "utf8"));
    return audit.capture_ids.includes(narrow.id);
  });
  rewriteNormalizedAudit(fixture, evidence, (raw) => {
    raw.observations.viewport = { inner_width: 1440, client_width: 1440, scroll_width: 1440 };
  });
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /must equal cited capture width 500/);
});

test("rejects normalized audit evidence when the retained raw probe is missing", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "dom-audit");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  fs.unlinkSync(path.join(fixture.root, audit.raw.path));

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /ENOENT|input must be an existing regular file/);
});

test("rejects a self-attested schema-v1 audit on a route-v2 run", () => {
  const fixture = makeFixture();
  const evidence = fixture.captures.evidence.find((item) => item.kind === "accessibility-tree");
  const audit = JSON.parse(fs.readFileSync(path.join(fixture.root, evidence.path), "utf8"));
  audit.schema_version = 1;
  delete audit.raw;
  const rebound = write(fixture.root, evidence.path, `${JSON.stringify(audit)}\n`);
  evidence.sha256 = rebound.sha256;
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /requires a raw probe path and SHA-256/);
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

test("rejects a passed report with an unevidenced dismissed Design Critique P1", () => {
  const fixture = makeFixture();
  const finding = {
    subject_id: "account-detail",
    region: "header",
    rule: "hierarchy",
    evidence_ids: [fixture.captures.captures[0].id],
    priority: "P1",
    status: "dismissed",
    owner: "design-critique",
    summary: "Primary action is visually subordinate.",
    remediation: "Increase action prominence.",
  };
  finding.id = findingId(finding);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /dismissed Design Critique P0\/P1/);
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

test("rejects an unresolved or stale report generator version", () => {
  const fixture = makeFixture();
  const htmlPath = path.join(fixture.root, fixture.report.human_report.path);
  fs.writeFileSync(
    htmlPath,
    fs
      .readFileSync(htmlPath, "utf8")
      .replace(`"version":"${PLUGIN_VERSION}"`, '"version":"{{PLUGIN_VERSION}}"')
  );
  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /metadata generator must be pm:design-critique/);
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
  const nextAction = markers.find((item) => item.attributes["data-dc-next-action-sha256"]);
  nextAction.text = "Proceed";
  nextAction.firstScreenText = "Proceed";
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

test("rejects a passed report whose noncompensatory scores fall below three", () => {
  const fixture = makeFixture();
  for (const score of Object.values(fixture.report.scores)) score.value = 1;
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /passed requires every score to be at least 3/);
});

test("rejects score evidence from the wrong modality", () => {
  const fixture = makeFixture();
  fixture.report.scores.accessibility.evidence_ids = [fixture.captures.captures[0].id];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required accessibility evidence/);
});

test("score evidence must cover every active subject", () => {
  const fixture = makeFixture();
  addProductUiSubject(fixture, "billing-detail");
  fixture.report.scores.accessibility.evidence_ids =
    fixture.report.scores.accessibility.evidence_ids.filter((id) => !id.includes("billing-detail"));
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required accessibility evidence:.*billing-detail/);
});

test("state-clarity scores must cite every active required state capture", () => {
  const fixture = makeFixture();
  fixture.report.scores["state-clarity"].evidence_ids = [fixture.captures.captures[0].id];
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /required state-clarity evidence/);
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
  ))
    rewriteNormalizedAudit(fixture, evidence, (audit) => {
      audit.commit = commit;
    });
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
    verifyBrowser: false,
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
        verifyBrowser: false,
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
        verifyBrowser: false,
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
        verifyBrowser: false,
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

test("rejects re-encoded identical pixels as resolved product UI evidence", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures.find((item) => item.coverage_id === "ui-primary");
  before.active = false;
  const afterBytes = validPng(before.width, before.height, 0, 64);
  const afterFile = write(fixture.root, "evidence/files/ui-primary-reencoded.png", afterBytes);
  const after = {
    ...before,
    id: "capture-ui-primary-reencoded",
    ...afterFile,
    pixel_sha256: inspectPngVisualBytes(afterBytes).pixelSha256,
    active: true,
    round: 2,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(after);
  fixture.captures.evidence.push(
    auditEvidenceFile(
      fixture.root,
      "a11y-capture-ui-primary-reencoded",
      "accessibility-tree",
      [after],
      2
    ),
    auditEvidenceFile(fixture.root, "dom-capture-ui-primary-reencoded", "dom-audit", [after], 2)
  );
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
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);

  const result = check(fixture);
  assert.equal(result.ok, false);
  assert.match(JSON.stringify(result.issues), /including decoded pixels for product UI/);
});

test("resolved PM artifact evidence does not require product UI pixel fields", () => {
  const fixture = makeFixture({ mode: "pm-artifact" });
  const after = fixture.captures.captures.find((item) => item.coverage_id === "artifact-desktop");
  after.round = 2;
  after.captured_at = "2026-07-12T00:04:00Z";
  const beforeFile = write(
    fixture.root,
    "evidence/files/artifact-desktop-before.png",
    validPng(after.width, after.height, 4)
  );
  const before = {
    ...after,
    id: "capture-artifact-desktop-before",
    ...beforeFile,
    active: false,
    round: 1,
    captured_at: "2026-07-12T00:01:00Z",
  };
  fixture.captures.captures.push(before);
  rewrite(fixture.root, fixture.capturesPath, fixture.captures);
  const finding = {
    subject_id: "account-detail",
    region: "summary",
    rule: "hierarchy",
    evidence_ids: [before.id, after.id],
    priority: "P1",
    status: "resolved",
    owner: "design-critique",
    summary: "The artifact summary hierarchy was repaired.",
    remediation: "Keep the corrected summary hierarchy.",
    before_capture_id: before.id,
    after_capture_id: after.id,
  };
  finding.id = findingId(finding);
  fixture.report.rounds = 2;
  fixture.report.captures = binding(fixture.root, fixture.capturesPath);
  fixture.report.findings = [finding];
  rewriteReportAndHtml(fixture);

  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("accepts a resolved P1 with inactive before and active after captures", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures[0];
  before.active = false;
  const afterBytes = validPng(1440, 1000, 1);
  const afterFile = write(fixture.root, "evidence/files/ui-primary-after.png", afterBytes);
  const after = {
    ...before,
    id: "capture-ui-primary-after",
    ...afterFile,
    pixel_sha256: inspectPngVisualBytes(afterBytes).pixelSha256,
    active: true,
    round: 2,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(after);
  fixture.captures.evidence.push(
    auditEvidenceFile(
      fixture.root,
      "a11y-capture-ui-primary-after",
      "accessibility-tree",
      [after],
      2
    ),
    auditEvidenceFile(fixture.root, "dom-capture-ui-primary-after", "dom-audit", [after], 2)
  );
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
  for (const [key, score] of Object.entries(fixture.report.scores))
    score.evidence_ids = scoreEvidenceIds(
      key,
      fixture.route.mode,
      fixture.route.coverage,
      fixture.captures.captures,
      fixture.captures.evidence
    );
  rewriteReportAndHtml(fixture);
  assert.deepEqual(check(fixture), { ok: true, issues: [] });
});

test("rejects an active capture older than an inactive later round", () => {
  const fixture = makeFixture();
  const before = fixture.captures.captures[0];
  const laterBytes = validPng(1440, 1000, 3);
  const laterFile = write(fixture.root, "evidence/files/ui-primary-later.png", laterBytes);
  const later = {
    ...before,
    id: "capture-ui-primary-later",
    ...laterFile,
    pixel_sha256: inspectPngVisualBytes(laterBytes).pixelSha256,
    active: false,
    round: 2,
    captured_at: "2026-07-12T00:04:00Z",
  };
  fixture.captures.captures.push(later);
  for (const evidence of fixture.captures.evidence.filter((item) =>
    ["accessibility-tree", "dom-audit"].includes(item.kind)
  ))
    rewriteNormalizedAudit(fixture, evidence, (audit) => {
      audit.capture_ids.push(later.id);
    });
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
