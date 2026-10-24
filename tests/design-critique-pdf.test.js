"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseArgs } = require("../scripts/design-critique-capture");
const { isManagedCaptureMemberPath } = require("../scripts/lib/design-critique-capture-path");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pdfFixture, submittedPdf } = require("./helpers/pdf-document-fixture");
const { inspectPngVisualBytes, inspectPdfBytes } = require("../scripts/lib/media-inspect");

const BASE = ".pm/dev-sessions/pdf-review/design-critique/runs/dc_pdf/round-1/round-1/document-r1";
const PDF_ARGS = [
  "--route",
  "route.json",
  "--subject",
  "submitted-report",
  "--coverage",
  "report-print",
  "--capture",
  "document-r1",
  "--pdf",
  "exports/report.pdf",
  "--out-dir",
  BASE,
];

test("capture CLI accepts a direct PDF document without inventing a web URL or viewport", () => {
  const options = parseArgs(PDF_ARGS);
  assert.equal(options.pdfPath, "exports/report.pdf");
  assert.equal(options.captureId, "document-r1");
  assert.equal(options.url, undefined);
  assert.equal(options.width, undefined);
  assert.equal(options.assertionPath, undefined);
});

test("managed document bundles admit only bounded PDF pages and their observation", () => {
  for (const member of ["capture.pdf", "pdf-observation.json", "page-001.png", "page-050.png"])
    assert.equal(isManagedCaptureMemberPath(`${BASE}/${member}`), true, member);
  for (const member of ["page-000.png", "page-051.png", "page-1.png", "file.pdf", "page-001.svg"])
    assert.equal(isManagedCaptureMemberPath(`${BASE}/${member}`), false, member);
});

test("native PDF capture binds every rendered page to the actual document", (t) => {
  if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
    t.skip("Poppler is unavailable; native PDF rendering cannot be verified");
    return;
  }
  const fixture = pdfFixture(t);
  const cli =
    process.env.PM_PDF_TEST_CLI || path.join(__dirname, "../scripts/design-critique-capture.js");
  const result = spawnSync(process.execPath, [cli, ...fixture.args], {
    cwd: fixture.root,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(fixture.root, output.manifest.path), "utf8")
  );
  assert.equal(
    output.manifest.sha256,
    hash(fs.readFileSync(path.join(fixture.root, output.manifest.path)))
  );
  assert.equal(manifest.capture.pages, 2);
  assert.equal(manifest.document.sha256, hash(fixture.pdf));
  assert.deepEqual(
    manifest.pages.map((page) => page.number),
    [1, 2]
  );
  for (const page of manifest.pages) {
    const bytes = fs.readFileSync(path.join(fixture.root, page.path));
    assert.equal(hash(bytes), page.sha256);
    assert.equal(inspectPngVisualBytes(bytes).pixelSha256, page.pixel_sha256);
  }
  const raw = JSON.parse(
    fs.readFileSync(path.join(fixture.root, manifest.observation.path), "utf8")
  );
  assert.match(raw.pages[0].text, /First submitted page/);
  assert.match(raw.pages[1].text, /Second submitted page/);
  assert.equal(manifest.source.before.clean, true);
  assert.deepEqual(manifest.source.before, manifest.source.after);
  const { loadPdfCapture, normalizePdfAudit } = require("../scripts/lib/design-critique-pdf");
  const loaded = loadPdfCapture(fixture.root, output.manifest.path);
  const audit = normalizePdfAudit(loaded.manifest, loaded.raw);
  assert.equal(audit.observations.pages, 2);
  assert.equal(audit.observations.tagged, false);
  assert.match(audit.limitations.join(" "), /do not verify native reading order/);
  assert.deepEqual(audit.capture_ids, ["document-r1"]);
  // A modified page cannot be excused by a still-valid original PDF.
  fs.writeFileSync(path.join(fixture.root, manifest.pages[1].path), "not the second page");
  assert.throws(
    () => loadPdfCapture(fixture.root, output.manifest.path),
    /changed|inventory|PNG|file|bundle/
  );
});

function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

for (const rotation of [0, 90, 180, 270]) {
  test(`native PDF raster matches the visible offset CropBox at rotation ${rotation}`, (t) => {
    if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
      t.skip("Poppler is unavailable; native PDF cropping cannot be verified");
      return;
    }
    const { renderPdf } = require("../scripts/lib/pdf-render");
    const rendered = renderPdf(
      submittedPdf(
        ["This text is outside the visible page"],
        "",
        "0 g 100 200 150 200 re f\n0 g 500 500 100 100 re f\n",
        ` /CropBox [100 200 400 400] /Rotate ${rotation}`
      )
    );
    const page = rendered.pages[0];
    assert.deepEqual([page.width, page.height], rotation % 180 ? [1067, 1600] : [1600, 1067]);
    assert.deepEqual(rendered.observation.pages[0], {
      number: 1,
      width_pts: 300,
      height_pts: 200,
      rotation,
      text: rendered.observation.pages[0].text,
    });
    const reference = renderPdf(
      submittedPdf(
        ["Different text also outside the visible page"],
        "",
        "0 g 0 0 150 200 re f\n",
        ` /CropBox [0 0 300 200] /Rotate ${rotation}`
      )
    );
    assert.equal(page.pixel_sha256, reference.pages[0].pixel_sha256);
  });
}

for (const name of ["OpenAction", "Ope#6eAction", "AcroForm", "RichMedia", "Launch", "JS"]) {
  test(`static PDF evidence rejects active object names: ${name}`, () => {
    const pdf = submittedPdf(["Static report"], ` /${name} << >>`);
    assert.throws(() => inspectPdfBytes(pdf, { staticDocument: true }), /active|static/i);
  });
}

test("static PDF checks preserve ordinary text mentioning action-like names", () => {
  assert.equal(
    inspectPdfBytes(submittedPdf(["Documentation /Launch /JS"]), { staticDocument: true }).pages,
    1
  );
});

for (const name of ["OpenAction", "Ope#6eAction"]) {
  test(`static PDF rejects NUL-delimited actions before native capture: ${name}`, (t) => {
    const { captureDocumentPdf } = require("../scripts/lib/design-critique-pdf");
    const fixture = pdfFixture(t);
    const pdf = submittedPdf(
      ["Static report"],
      ` /${name}${String.fromCharCode(0)} << /S /Launch${String.fromCharCode(0)} /F (untrusted-command) >>`
    );
    assert.throws(() => inspectPdfBytes(pdf, { staticDocument: true }), /active|static/i);
    fs.writeFileSync(path.join(fixture.root, ".pm/input/report.pdf"), pdf);
    fixture.route.subjects[0].artifact.sha256 = hash(pdf);
    fs.writeFileSync(path.join(fixture.root, fixture.routePath), JSON.stringify(fixture.route));
    assert.throws(() => captureDocumentPdf(parseArgs(fixture.args)), /active|static/i);
    assert.equal(fs.existsSync(path.join(fixture.root, BASE)), false);
  });
}

test("static PDF action names end at every PDF whitespace character", () => {
  for (const code of [0, 9, 10, 12, 13, 32])
    assert.throws(
      () =>
        inspectPdfBytes(submittedPdf(["Report"], ` /Launch${String.fromCharCode(code)} << >>`), {
          staticDocument: true,
        }),
      /active|static/i,
      `PDF whitespace ${code}`
    );
});

test("PDF capture rejects web flags and network configuration", () => {
  for (const pair of [
    ["--url", "https://example.test"],
    ["--width", "1200"],
    ["--state-assertion", "state.json"],
    ["--browser", "/browser"],
    ["--allow-origin", "https://example.test"],
  ])
    assert.throws(() => parseArgs([...PDF_ARGS, ...pair]), /PDF|offline/);
});

test("static PDF rendering rejects encryption and excess pages before rendering", () => {
  const { renderPdf } = require("../scripts/lib/pdf-render");
  const encrypted = Buffer.from(
    submittedPdf(["Private report"])
      .toString("latin1")
      .replace("/Root 1 0 R", "/Encrypt 3 0 R /Root 1 0 R"),
    "latin1"
  );
  assert.throws(() => renderPdf(encrypted), /encrypt/i);
  assert.throws(() => renderPdf(submittedPdf(Array(51).fill("Page"))), /page budget/i);
});

test("independent PDF validation rejects internally rebound false observations", (t) => {
  if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
    t.skip("Poppler is unavailable; native PDF boundary tests cannot be verified");
    return;
  }
  const { captureDocumentPdf, loadPdfCapture } = require("../scripts/lib/design-critique-pdf");
  const { writeProjectDirectoryAtomic } = require("../scripts/lib/project-atomic-write");
  const fixture = pdfFixture(t);
  const output = captureDocumentPdf(parseArgs(["--root", fixture.root, ...fixture.args.slice(2)]));
  const directory = path.dirname(output.manifest.path);
  const absolute = path.join(fixture.root, directory);
  const original = new Map(
    fs
      .readdirSync(absolute)
      .filter(
        (name) =>
          ["capture.json", "capture.pdf", "pdf-observation.json"].includes(name) ||
          /^page-\d{3}\.png$/.test(name)
      )
      .map((name) => [name, fs.readFileSync(path.join(absolute, name))])
  );
  const cases = [
    ["missing page", (manifest) => manifest.pages.pop(), /inventory/],
    [
      "duplicate page",
      (manifest) => {
        manifest.pages[1].number = 1;
      },
      /ordering/,
    ],
    [
      "old producer",
      (manifest) => {
        manifest.producer.plugin_version = "0.0.0";
      },
      /version/,
    ],
    [
      "single sample",
      (manifest) => {
        manifest.configuration.samples = 1;
      },
      /configuration/,
    ],
    [
      "false source",
      (manifest) => {
        manifest.source.before.tree = manifest.source.after.tree = "a".repeat(40);
      },
      /source identity/,
    ],
    [
      "false text",
      (_, raw) => {
        raw.pages[1].text = "Invented report text";
      },
      /re-derived/,
    ],
    [
      "false tagging",
      (_, raw) => {
        raw.metadata.tagged = true;
      },
      /re-derived/,
    ],
    [
      "manifest-selected executable",
      (manifest) => {
        manifest.tools.before[0].path = manifest.tools.after[0].path =
          "/must-not-run-pdf-manifest-tool";
      },
      /installed PDF renderer/,
    ],
    [
      "backward time",
      (manifest) => {
        manifest.timestamps.finished_at = "2000-01-01T00:00:00Z";
      },
      /chronology/,
    ],
  ];
  for (const [name, mutate, pattern] of cases) {
    const manifest = JSON.parse(original.get("capture.json"));
    const raw = JSON.parse(original.get("pdf-observation.json"));
    mutate(manifest, raw);
    const rawBytes = Buffer.from(JSON.stringify(raw));
    manifest.observation.sha256 = hash(rawBytes);
    const files = new Map(original);
    files.set("pdf-observation.json", rawBytes);
    files.set("capture.json", Buffer.from(JSON.stringify(manifest)));
    // Re-publish a fully valid managed inventory so the semantic trust boundary,
    // rather than an unrelated inventory hash mismatch, rejects the forgery.
    fs.unlinkSync(absolute);
    writeProjectDirectoryAtomic(fixture.root, directory, [...files], {
      commitFile: "capture.json",
      fileMode: 0o600,
      directoryMode: 0o700,
    });
    assert.throws(() => loadPdfCapture(fixture.root, output.manifest.path), pattern, name);
  }
  fs.unlinkSync(absolute);
  writeProjectDirectoryAtomic(fixture.root, directory, [...original], {
    commitFile: "capture.json",
    fileMode: 0o600,
    directoryMode: 0o700,
  });
  fs.appendFileSync(path.join(fixture.root, ".gitignore"), "# changed source\n");
  assert.throws(() => loadPdfCapture(fixture.root, output.manifest.path), /clean|dirty/);
});

test("static PDF names cannot hide after a carriage-return comment", () => {
  const { assertStaticPdfObjects } = require("../scripts/lib/pdf-static-content");
  assert.throws(
    () => assertStaticPdfObjects(["1 0 obj << /Type /Action % comment\r /S /Launch >> endobj"]),
    /active/
  );
});

for (const name of ["ObjStm", "XRef", "Encr#79pt"]) {
  test(`static PDF rejects unsupported container names: ${name}`, () => {
    assert.throws(
      () => inspectPdfBytes(submittedPdf(["Report"], ` /${name} << >>`), { staticDocument: true }),
      /active|static/
    );
  });
}

test("PDF source binding rejects option-shaped and malformed identities before Git execution", (t) => {
  const { preparePdfPlan } = require("../scripts/lib/design-critique-pdf");
  const fixture = pdfFixture(t);
  const original = structuredClone(fixture.route.source);
  for (const [field, value] of [
    ["base_commit", "--output=/must-not-write-outside-project"],
    ["commit", "HEAD"],
    ["base_commit", "a".repeat(39)],
    ["diff_sha256", "not-a-hash"],
    ["base_ref", "main\n--option"],
    ["remote_push_url_sha256", "bad"],
  ]) {
    fixture.route.source = { ...original, [field]: value };
    fs.writeFileSync(path.join(fixture.root, fixture.routePath), JSON.stringify(fixture.route));
    assert.throws(() => preparePdfPlan(parseArgs(fixture.args)), /source\.|source identity/);
  }
});

test("PDF bundle validation reuses one verified inventory without losing member checks", (t) => {
  if (spawnSync("pdftoppm", ["-v"]).status !== 0) {
    t.skip("Poppler is unavailable; PDF bundle I/O cannot be verified");
    return;
  }
  const { captureDocumentPdf, loadPdfCapture } = require("../scripts/lib/design-critique-pdf");
  const fixture = pdfFixture(t);
  const result = captureDocumentPdf(parseArgs(fixture.args));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.root, result.manifest.path)));
  const sizes = new Map(
    manifest.pages.map((page) => [
      path.basename(page.path),
      fs.statSync(path.join(fixture.root, page.path)).size,
    ])
  );
  const descriptors = new Map(),
    readBytes = new Map();
  const original = { open: fs.openSync, read: fs.readSync, close: fs.closeSync };
  try {
    fs.openSync = function (file, ...args) {
      const fd = original.open.call(fs, file, ...args);
      const name = path.basename(String(file));
      if (sizes.has(name)) descriptors.set(fd, name);
      return fd;
    };
    fs.readSync = function (fd, ...args) {
      const count = original.read.call(fs, fd, ...args);
      const name = descriptors.get(fd);
      if (name) readBytes.set(name, (readBytes.get(name) || 0) + count);
      return count;
    };
    fs.closeSync = function (fd) {
      descriptors.delete(fd);
      return original.close.call(fs, fd);
    };
    loadPdfCapture(fixture.root, result.manifest.path);
  } finally {
    fs.openSync = original.open;
    fs.readSync = original.read;
    fs.closeSync = original.close;
  }
  for (const [name, size] of sizes) {
    assert.ok(readBytes.get(name) > 0, `${name} must actually be observed`);
    assert.ok(
      readBytes.get(name) <= size * 2,
      `${name} should be hashed once plus its requested-file read`
    );
  }
  fs.writeFileSync(path.join(fixture.root, manifest.pages[0].path), "tampered page");
  assert.throws(
    () => loadPdfCapture(fixture.root, result.manifest.path),
    /changed|inventory|bundle/
  );
});
