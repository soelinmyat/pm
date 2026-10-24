"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const { createProjectInputVerificationContext, readProjectInput } = require("./project-file");
const { writeProjectDirectoryAtomic } = require("./project-atomic-write");
const { isManagedCaptureMemberPath } = require("./design-critique-capture-path");
const {
  inspectPdfBytes,
  inspectPngHeaderBytes,
  inspectPngVisualBytes,
} = require("./media-inspect");
const { cleanSourceIdentity } = require("./git-source-identity");
const { renderPdf } = require("./pdf-render");
const { MAX_RECOVERY_ROUNDS } = require("./scoped-recovery");
const { isRfc3339DateTime, compareRfc3339DateTimes } = require("./iso-time");
const { version: PLUGIN_VERSION } = require("../../plugin.config.json");
const {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_PAGE_PIXELS,
  MAX_PDF_TOTAL_PIXELS,
  MAX_PDF_BUNDLE_BYTES,
  MAX_PDF_TEXT_BYTES,
  PDF_RENDER_SCALE,
} = require("./pdf-evidence-limits");

const ACQUISITION = "poppler-static-pdf-v1";
const ASSURANCE = "workflow-attested-non-cryptographic";
const HISTORICAL_PDF_PRODUCERS = new Set(["1.14.42"]);
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const binding = (file) => ({ path: file.relative, sha256: hash(file.bytes) });
const slug = (value) => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function read(root, relative, maxBytes = MAX_PDF_TEXT_BYTES, verificationContext) {
  return readProjectInput(root, relative, maxBytes, {
    allowManagedDirectoryPointers: isManagedCaptureMemberPath(relative),
    managedDirectoryVerificationContext: verificationContext,
  });
}

function exact(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label} has missing or unknown fields`);
}

function same(left, right, label) {
  if (!isDeepStrictEqual(left, right)) throw new Error(`${label} does not match retained evidence`);
}

function preparePdfPlan(options) {
  const root = fs.realpathSync(path.resolve(options.root || "."));
  const routeFile = read(root, options.routePath, undefined, options.verificationContext);
  const route = JSON.parse(routeFile.bytes);
  const canonical =
    /^(\.pm\/dev-sessions\/[a-z0-9._-]+\/design-critique\/runs\/([a-z0-9][a-z0-9._-]*)\/round-([1-9][0-9]*))\/route\.json$/.exec(
      routeFile.relative
    );
  if (!canonical || Number(canonical[3]) > MAX_RECOVERY_ROUNDS || canonical[2] !== route.run_id)
    throw new Error("PDF capture requires a canonical immutable run/round route");
  if (
    route.schema_version !== 2 ||
    route.mode !== "pm-artifact" ||
    !isRfc3339DateTime(route.created_at)
  )
    throw new Error("PDF capture requires a current schema-v2 artifact route");
  const sourceFields = ["commit", "base_ref", "base_commit", "diff_sha256"];
  if (route.source && Object.hasOwn(route.source, "remote_push_url_sha256"))
    sourceFields.push("remote_push_url_sha256");
  exact(route.source, sourceFields, "PDF route source identity");
  for (const field of ["commit", "base_commit"])
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(route.source[field] || ""))
      throw new Error(`PDF route source.${field} requires a full Git object ID`);
  for (const field of [
    "diff_sha256",
    ...(sourceFields.includes("remote_push_url_sha256") ? ["remote_push_url_sha256"] : []),
  ])
    if (!/^[a-f0-9]{64}$/.test(route.source[field] || ""))
      throw new Error(`PDF route source.${field} requires a SHA-256 identity`);
  if (
    typeof route.source.base_ref !== "string" ||
    !route.source.base_ref.trim() ||
    route.source.base_ref.length > 500 ||
    [...route.source.base_ref].some(
      (char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127
    )
  )
    throw new Error("PDF route source.base_ref requires bounded non-empty text");
  const subjects = (route.subjects || []).filter((row) => row.id === options.subjectId);
  const rows = (route.coverage || []).filter((row) => row.id === options.coverageId);
  if (subjects.length !== 1 || rows.length !== 1)
    throw new Error("PDF subject and coverage must resolve exactly once");
  const subject = subjects[0],
    coverage = rows[0],
    round = Number(canonical[3]);
  exact(subject.artifact, ["path", "sha256", "kind", "format"], "PDF artifact");
  if (
    subject.platform !== "document" ||
    subject.artifact.kind !== "report" ||
    subject.artifact.format !== "pdf" ||
    subject.artifact.path !== options.pdfPath ||
    subject.surface !== options.pdfPath
  )
    throw new Error("PDF capture requires the exact direct report artifact and surface");
  if (
    coverage.subject_id !== subject.id ||
    coverage.state !== "print" ||
    coverage.viewport !== "print" ||
    coverage.required !== true
  )
    throw new Error("PDF capture requires the document's complete fixed-page print coverage");
  if (
    !slug(options.captureId) ||
    !options.captureId.endsWith(`-r${round}`) ||
    options.outputDir !== `${canonical[1]}/round-${round}/${options.captureId}`
  )
    throw new Error("PDF capture output must match its immutable route, round, and capture ID");
  if (
    typeof options.pdfPath !== "string" ||
    !options.pdfPath ||
    options.pdfPath.includes("\\") ||
    options.pdfPath.includes("\0") ||
    /^[a-z]:/i.test(options.pdfPath) ||
    options.pdfPath.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("PDF document path must be a canonical project-relative path");
  // Frozen history reads its authenticated original from capture.pdf. Its old
  // input may have been replaced or removed after a corrected export.
  const document =
    options.frozenDocumentBytes === undefined
      ? read(root, options.pdfPath, MAX_PDF_BYTES, options.verificationContext)
      : { relative: options.pdfPath, bytes: options.frozenDocumentBytes };
  if (!Buffer.isBuffer(document.bytes) || document.bytes.length > MAX_PDF_BYTES)
    throw new Error("PDF document exceeds its retained byte budget");
  if (hash(document.bytes) !== subject.artifact.sha256)
    throw new Error("PDF artifact bytes do not match the frozen route");
  return {
    root,
    route,
    routeFile,
    subject,
    coverage,
    round,
    document,
    outputDir: options.outputDir,
    captureId: options.captureId,
  };
}

function assertSource(root, route, { frozen = false } = {}) {
  const source = frozen
    ? {
        head: route.source.commit,
        tree: execFileSync("git", ["rev-parse", "--verify", `${route.source.commit}^{tree}`], {
          cwd: root,
          timeout: 10_000,
          maxBuffer: 4096,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        }).trim(),
        tracked_status_sha256: hash(Buffer.alloc(0)),
        clean: true,
      }
    : cleanSourceIdentity(root, "trusted PDF capture");
  if (source.head !== route.source?.commit) throw new Error("PDF route commit is stale");
  const diff = execFileSync(
    "git",
    ["diff", "--binary", `${route.source.base_commit}...${source.head}`],
    {
      cwd: root,
      timeout: 10_000,
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (hash(diff) !== route.source.diff_sha256) throw new Error("PDF route diff identity is stale");
  return source;
}

function captureDocumentPdf(options) {
  const startedAt = new Date().toISOString();
  const plan = preparePdfPlan(options);
  if (compareRfc3339DateTimes(plan.route.created_at, startedAt) > 0)
    throw new Error("PDF route creation time is in the future");
  const before = assertSource(plan.root, plan.route);
  const rendered = renderPdf(plan.document.bytes);
  const capturedAt = new Date().toISOString();
  const base = `${plan.outputDir}/`;
  const pages = rendered.pages.map((page) => ({
    number: page.number,
    path: `${base}page-${String(page.number).padStart(3, "0")}.png`,
    sha256: page.sha256,
    pixel_sha256: page.pixel_sha256,
    width: page.width,
    height: page.height,
  }));
  const rawBytes = json(rendered.observation);
  if (rawBytes.length > MAX_PDF_TEXT_BYTES)
    throw new Error("PDF raw observations exceed the byte budget");
  const after = assertSource(plan.root, plan.route);
  same(before, after, "PDF source identity");
  same(read(plan.root, options.routePath).bytes, plan.routeFile.bytes, "PDF route bytes");
  same(
    read(plan.root, options.pdfPath, MAX_PDF_BYTES).bytes,
    plan.document.bytes,
    "PDF input bytes"
  );
  const manifest = {
    schema_version: 1,
    acquisition: ACQUISITION,
    assurance: ASSURANCE,
    producer: { name: "design-critique-capture", plugin_version: PLUGIN_VERSION },
    run_id: plan.route.run_id,
    subject_id: plan.subject.id,
    coverage_id: plan.coverage.id,
    route: binding(plan.routeFile),
    document: { ...binding(plan.document), bytes: plan.document.bytes.length },
    capture: {
      id: plan.captureId,
      path: `${base}capture.pdf`,
      sha256: hash(plan.document.bytes),
      pages: pages.length,
      round: plan.round,
      captured_at: capturedAt,
    },
    pages,
    observation: { path: `${base}pdf-observation.json`, sha256: hash(rawBytes) },
    source: { before, after },
    tools: { before: rendered.toolsBefore, after: rendered.toolsAfter },
    configuration: { scale: PDF_RENDER_SCALE, samples: 2, page_box: "crop" },
    stability: { samples: 2, page_pixels_sha256: pagePixelsHash(pages) },
    timestamps: {
      started_at: startedAt,
      captured_at: capturedAt,
      finished_at: new Date().toISOString(),
    },
  };
  const manifestBytes = json(manifest);
  writeProjectDirectoryAtomic(
    plan.root,
    plan.outputDir,
    [
      ["capture.pdf", plan.document.bytes],
      ["pdf-observation.json", rawBytes],
      ...rendered.pages.map((page) => [
        `page-${String(page.number).padStart(3, "0")}.png`,
        page.bytes,
      ]),
      ["capture.json", manifestBytes],
    ],
    {
      commitFile: "capture.json",
      fileMode: 0o600,
      directoryMode: 0o700,
      maxBytes: MAX_PDF_BUNDLE_BYTES,
    }
  );
  const retained = read(plan.root, `${base}capture.json`);
  same(retained.bytes, manifestBytes, "Published PDF manifest");
  return {
    ok: true,
    assurance_level: ASSURANCE,
    manifest: binding(retained),
    capture: manifest.capture,
    raw_evidence: { pdf_document: manifest.observation },
  };
}

function pagePixelsHash(pages) {
  return hash(Buffer.from(JSON.stringify(pages.map((page) => [page.number, page.pixel_sha256]))));
}

function loadPdfCapture(root, manifestPath, options = {}) {
  const verificationContext = createProjectInputVerificationContext();
  const file = read(root, manifestPath, undefined, verificationContext);
  const manifest = JSON.parse(file.bytes);
  exact(
    manifest,
    [
      "schema_version",
      "acquisition",
      "assurance",
      "producer",
      "run_id",
      "subject_id",
      "coverage_id",
      "route",
      "document",
      "capture",
      "pages",
      "observation",
      "source",
      "tools",
      "configuration",
      "stability",
      "timestamps",
    ],
    "PDF capture manifest"
  );
  if (
    manifest.schema_version !== 1 ||
    manifest.acquisition !== ACQUISITION ||
    manifest.assurance !== ASSURANCE
  )
    throw new Error("PDF capture is not a supported trusted producer observation");
  exact(manifest.producer, ["name", "plugin_version"], "PDF producer");
  if (
    manifest.producer.name !== "design-critique-capture" ||
    (manifest.producer.plugin_version !== PLUGIN_VERSION &&
      (options.active !== false || !HISTORICAL_PDF_PRODUCERS.has(manifest.producer.plugin_version)))
  )
    throw new Error("PDF capture producer version is not current");
  exact(manifest.route, ["path", "sha256"], "PDF route binding");
  exact(manifest.document, ["path", "sha256", "bytes"], "PDF document binding");
  exact(manifest.capture, ["id", "path", "sha256", "pages", "round", "captured_at"], "PDF capture");
  exact(manifest.observation, ["path", "sha256"], "PDF observation binding");
  const base = path.posix.dirname(file.relative);
  if (manifest.capture.path !== `${base}/capture.pdf`)
    throw new Error("PDF capture path does not match its canonical bundle");
  const retainedPdf = read(root, manifest.capture.path, MAX_PDF_BYTES, verificationContext);
  const plan = preparePdfPlan({
    root,
    routePath: manifest.route.path,
    subjectId: manifest.subject_id,
    coverageId: manifest.coverage_id,
    captureId: manifest.capture.id,
    pdfPath: manifest.document.path,
    outputDir: base,
    frozenDocumentBytes: options.active === false ? retainedPdf.bytes : undefined,
    verificationContext,
  });
  same(binding(plan.routeFile), manifest.route, "PDF route binding");
  same(
    { ...binding(plan.document), bytes: plan.document.bytes.length },
    manifest.document,
    "PDF document binding"
  );
  if (
    manifest.run_id !== plan.route.run_id ||
    manifest.capture.round !== plan.round ||
    manifest.capture.path !== `${base}/capture.pdf` ||
    manifest.capture.sha256 !== manifest.document.sha256
  )
    throw new Error("PDF capture identity does not match its document and route");
  if (hash(retainedPdf.bytes) !== manifest.capture.sha256)
    throw new Error("PDF capture bytes changed");
  const count = inspectPdfBytes(retainedPdf.bytes, { staticDocument: true }).pages;
  if (
    count !== manifest.capture.pages ||
    count > MAX_PDF_PAGES ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length !== count
  )
    throw new Error("PDF page inventory is incomplete");
  let totalPixels = 0;
  let totalBytes = retainedPdf.bytes.length;
  for (const [index, page] of manifest.pages.entries()) {
    exact(page, ["number", "path", "sha256", "pixel_sha256", "width", "height"], "PDF page");
    if (
      page.number !== index + 1 ||
      page.path !== `${base}/page-${String(index + 1).padStart(3, "0")}.png`
    )
      throw new Error("PDF page ordering or canonical path is invalid");
    const png = read(root, page.path, MAX_PDF_BUNDLE_BYTES, verificationContext);
    const header = inspectPngHeaderBytes(png.bytes);
    if (header.width * header.height > MAX_PDF_PAGE_PIXELS)
      throw new Error("PDF page exceeds the pixel budget");
    const inspected = inspectPngVisualBytes(png.bytes);
    if (
      hash(png.bytes) !== page.sha256 ||
      inspected.pixelSha256 !== page.pixel_sha256 ||
      header.width !== page.width ||
      header.height !== page.height
    )
      throw new Error("PDF page bytes, pixels or dimensions changed");
    totalPixels += header.width * header.height;
    totalBytes += png.bytes.length;
    if (totalPixels > MAX_PDF_TOTAL_PIXELS || totalBytes > MAX_PDF_BUNDLE_BYTES)
      throw new Error("PDF evidence exceeds the aggregate budget");
  }
  exact(manifest.source, ["before", "after"], "PDF source observations");
  for (const source of [manifest.source.before, manifest.source.after]) {
    exact(source, ["head", "tree", "tracked_status_sha256", "clean"], "PDF source identity");
    if (
      source.clean !== true ||
      source.head !== plan.route.source.commit ||
      !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(source.tree || "") ||
      source.tracked_status_sha256 !== hash(Buffer.alloc(0))
    )
      throw new Error("PDF source was not captured cleanly at the routed commit");
  }
  same(manifest.source.before, manifest.source.after, "PDF source observations");
  same(
    manifest.configuration,
    { scale: PDF_RENDER_SCALE, samples: 2, page_box: "crop" },
    "PDF renderer configuration"
  );
  same(
    manifest.stability,
    { samples: 2, page_pixels_sha256: pagePixelsHash(manifest.pages) },
    "PDF render stability"
  );
  exact(manifest.tools, ["before", "after"], "PDF tool observations");
  if (!Array.isArray(manifest.tools.before) || manifest.tools.before.length !== 4)
    throw new Error("PDF toolchain inventory is incomplete");
  for (const [index, tool] of manifest.tools.before.entries()) {
    exact(tool, ["name", "path", "sha256", "bytes", "version"], "PDF renderer identity");
    if (
      tool.name !== ["pdfinfo", "pdftotext", "pdffonts", "pdftoppm"][index] ||
      !path.isAbsolute(tool.path) ||
      !/^[a-f0-9]{64}$/.test(tool.sha256 || "") ||
      !Number.isSafeInteger(tool.bytes) ||
      tool.bytes < 1 ||
      typeof tool.version !== "string" ||
      !tool.version.startsWith(`${tool.name} version `) ||
      tool.version.length > 4096
    )
      throw new Error("PDF renderer identity is invalid");
  }
  same(manifest.tools.before, manifest.tools.after, "PDF tool observations");
  exact(manifest.timestamps, ["started_at", "captured_at", "finished_at"], "PDF timestamps");
  const times = [
    plan.route.created_at,
    manifest.timestamps.started_at,
    manifest.timestamps.captured_at,
    manifest.timestamps.finished_at,
  ];
  if (
    !times.every(isRfc3339DateTime) ||
    times.some((time, index) => index > 0 && compareRfc3339DateTimes(times[index - 1], time) > 0) ||
    manifest.capture.captured_at !== manifest.timestamps.captured_at
  )
    throw new Error("PDF capture chronology is invalid");
  const rawFile = read(root, manifest.observation.path, undefined, verificationContext);
  if (totalBytes + file.bytes.length + rawFile.bytes.length > MAX_PDF_BUNDLE_BYTES)
    throw new Error("PDF observation bundle exceeds the aggregate byte budget");
  if (
    manifest.observation.path !== `${base}/pdf-observation.json` ||
    hash(rawFile.bytes) !== manifest.observation.sha256
  )
    throw new Error("PDF raw observation binding changed");
  const raw = JSON.parse(rawFile.bytes);
  validatePdfObservation(manifest, raw);
  if (options.active === false)
    same(
      assertSource(plan.root, plan.route, { frozen: true }),
      manifest.source.after,
      "Frozen PDF source identity"
    );
  if (options.active !== false) {
    same(assertSource(plan.root, plan.route), manifest.source.after, "Current PDF source identity");
    const current = renderPdf(retainedPdf.bytes);
    same(current.toolsBefore, manifest.tools.before, "Current installed PDF renderer");
    same(current.observation, raw, "Independently re-derived PDF observations");
    same(
      current.pages.map(({ number, pixel_sha256, width, height }) => ({
        number,
        pixel_sha256,
        width,
        height,
      })),
      manifest.pages.map(({ number, pixel_sha256, width, height }) => ({
        number,
        pixel_sha256,
        width,
        height,
      })),
      "Independently re-rendered PDF pages"
    );
  }
  if (options.routeBinding) same(options.routeBinding, manifest.route, "Owning Design route");
  if (options.capture) {
    for (const key of ["id", "path", "sha256", "pages", "round", "captured_at"])
      same(options.capture[key], manifest.capture[key], `Owning PDF capture ${key}`);
    if (options.capture.coverage_id !== manifest.coverage_id || options.capture.kind !== "pdf")
      throw new Error("PDF capture row does not match its observation");
  }
  return { manifest, raw, plan, manifestBinding: binding(file), verified: true };
}

function validatePdfObservation(manifest, raw) {
  exact(raw, ["schema_version", "document", "metadata", "fonts", "pages"], "PDF raw observations");
  same(
    raw.document,
    {
      sha256: manifest.document.sha256,
      bytes: manifest.document.bytes,
      pages: manifest.capture.pages,
    },
    "PDF observed document"
  );
  exact(raw.metadata, ["tagged", "encrypted", "javascript", "pdf_version"], "PDF metadata");
  if (
    raw.schema_version !== 1 ||
    typeof raw.metadata.tagged !== "boolean" ||
    raw.metadata.encrypted !== false ||
    raw.metadata.javascript !== false ||
    !/^1\.[0-7]$/.test(raw.metadata.pdf_version || "")
  )
    throw new Error("PDF metadata is incomplete or not a static document");
  if (
    !Number.isInteger(manifest.capture.pages) ||
    manifest.capture.pages < 1 ||
    manifest.capture.pages > MAX_PDF_PAGES ||
    !Array.isArray(raw.pages) ||
    raw.pages.length !== manifest.capture.pages ||
    !Array.isArray(raw.fonts)
  )
    throw new Error("PDF raw page inventory is incomplete");
  for (const font of raw.fonts) {
    exact(font, ["name", "embedded", "subset", "unicode"], "PDF font observation");
    if (
      typeof font.name !== "string" ||
      !font.name ||
      ![font.embedded, font.subset, font.unicode].every((value) => typeof value === "boolean")
    )
      throw new Error("PDF font observation is invalid");
  }
  for (const [index, page] of raw.pages.entries()) {
    exact(page, ["number", "width_pts", "height_pts", "rotation", "text"], "PDF page observation");
    if (
      page.number !== index + 1 ||
      ![page.width_pts, page.height_pts].every(
        (value) => typeof value === "number" && Number.isFinite(value) && value > 0
      ) ||
      ![0, 90, 180, 270].includes(page.rotation) ||
      typeof page.text !== "string"
    )
      throw new Error("PDF page text or geometry is invalid");
  }
}

function normalizePdfAudit(manifest, raw) {
  validatePdfObservation(manifest, raw);
  return {
    schema_version: 1,
    kind: "pdf-document",
    subject_id: manifest.subject_id,
    capture_ids: [manifest.capture.id],
    source: manifest.observation,
    checks: {
      complete_page_inventory: true,
      exact_document_bytes: true,
      stable_page_pixels: true,
      static_document: true,
    },
    observations: {
      pages: manifest.capture.pages,
      tagged: raw.metadata.tagged,
      fonts: raw.fonts,
      page_text: raw.pages.map((page) => ({
        number: page.number,
        characters: [...page.text].length,
        sha256: hash(Buffer.from(page.text)),
      })),
    },
    limitations: [
      "Text extraction and tagging observations do not verify native reading order or spoken assistive technology.",
      ...(raw.metadata.tagged ? [] : ["The PDF has no explicit document-structure tags."]),
    ],
    checked_at: manifest.timestamps.finished_at,
  };
}

module.exports = {
  ACQUISITION,
  ASSURANCE,
  captureDocumentPdf,
  loadPdfCapture,
  normalizePdfAudit,
  preparePdfPlan,
};
