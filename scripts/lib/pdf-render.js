"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");
const { readDescriptorBounded } = require("./bounded-descriptor-read");
const {
  inspectPdfBytes,
  inspectPngHeaderBytes,
  inspectPngVisualBytes,
} = require("./media-inspect");
const {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  MAX_PDF_PAGE_PIXELS,
  MAX_PDF_TOTAL_PIXELS,
  MAX_PDF_BUNDLE_BYTES,
  MAX_PDF_TEXT_BYTES,
  PDF_RENDER_SCALE,
  PDF_RENDER_TIMEOUT_MS,
} = require("./pdf-evidence-limits");

const TOOL_NAMES = Object.freeze(["pdfinfo", "pdftotext", "pdffonts", "pdftoppm"]);
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function toolIdentity(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  let file;
  for (const directory of (process.env.PATH || "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, executable);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      file = fs.realpathSync(candidate);
      break;
    } catch {
      /* next PATH entry */
    }
  }
  if (!file) throw new Error(`PDF evidence requires the installed Poppler tool ${name}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let bytes;
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error(`PDF tool ${name} is not a regular executable`);
    bytes = readDescriptorBounded(descriptor, 128 * 1024 * 1024);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw new Error(`PDF tool ${name} changed while hashing`);
  } finally {
    fs.closeSync(descriptor);
  }
  const version = spawnSync(file, ["-v"], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 64 * 1024,
    env: { ...process.env, LC_ALL: "C" },
  });
  const text = `${version.stdout || ""}${version.stderr || ""}`.trim();
  if (
    version.error ||
    version.status !== 0 ||
    !text.startsWith(`${name} version `) ||
    text.length > 4096
  )
    throw new Error(`cannot identify Poppler tool ${name}`);
  return { name, path: file, sha256: digest(bytes), bytes: bytes.length, version: text };
}

function toolchainIdentity() {
  return TOOL_NAMES.map(toolIdentity);
}

function readBoundedFile(file, maxBytes) {
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    if (!fs.fstatSync(descriptor).isFile())
      throw new Error("PDF render output is not a regular file");
    return readDescriptorBounded(descriptor, maxBytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

function parseInfo(text, pages) {
  const value = (key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))?.[1].trim();
  if (Number(value("Pages")) !== pages)
    throw new Error("PDF page counts disagree between parser and renderer");
  if (value("Encrypted") !== "no" || value("JavaScript") !== "no")
    throw new Error("PDF evidence rejects encrypted or JavaScript-bearing documents");
  if (!["yes", "no"].includes(value("Tagged")))
    throw new Error("PDF tagging observation is missing");
  const geometry = Array.from({ length: pages }, (_, index) => {
    const number = index + 1;
    const size = text.match(
      new RegExp(`^Page\\s+${number} size:\\s+([\\d.]+) x ([\\d.]+) pts`, "m")
    );
    const rotation = text.match(new RegExp(`^Page\\s+${number} rot:\\s+(-?\\d+)`, "m"));
    if (
      !size ||
      !rotation ||
      ![size[1], size[2]].every((item) => Number(item) > 0 && Number.isFinite(Number(item)))
    )
      throw new Error(`PDF geometry is missing for page ${number}`);
    const degrees = Number(rotation[1]);
    if (![0, 90, 180, 270].includes(degrees))
      throw new Error(`PDF page ${number} has unsupported rotation`);
    return { number, width_pts: Number(size[1]), height_pts: Number(size[2]), rotation: degrees };
  });
  return {
    metadata: {
      tagged: value("Tagged") === "yes",
      encrypted: false,
      javascript: false,
      pdf_version: value("PDF version"),
    },
    geometry,
  };
}

function parseFonts(text) {
  const rows = text
    .trimEnd()
    .split(/\r?\n/)
    .slice(2)
    .filter((line) => line.trim());
  return rows.map((line) => {
    const match = /\s+(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/.exec(line);
    if (!match) throw new Error("PDF font observation is malformed");
    return {
      name: line.trim().split(/\s+/)[0],
      embedded: match[1] === "yes",
      subset: match[2] === "yes",
      unicode: match[3] === "yes",
    };
  });
}

function renderPdf(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PDF_BYTES)
    throw new Error("PDF exceeds the input byte budget");
  const count = inspectPdfBytes(bytes, { staticDocument: true }).pages;
  if (count > MAX_PDF_PAGES) throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page budget`);
  const toolsBefore = toolchainIdentity();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pdf-render-"));
  fs.chmodSync(scratch, 0o700);
  const deadline = Date.now() + PDF_RENDER_TIMEOUT_MS;
  const run = (name, args, maxBuffer = MAX_PDF_TEXT_BYTES) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("PDF rendering exceeded its time budget");
    const tool = toolsBefore.find((item) => item.name === name);
    const result = spawnSync(tool.path, args, {
      cwd: scratch,
      timeout: Math.min(remaining, 15_000),
      maxBuffer,
      env: { ...process.env, LC_ALL: "C" },
    });
    if (result.error || result.status !== 0 || result.stderr?.length)
      throw new Error(`Poppler ${name} failed or reported a rendering warning`);
    return result.stdout;
  };
  try {
    const input = path.join(scratch, "input.pdf");
    fs.writeFileSync(input, bytes, { mode: 0o600, flag: "wx" });
    const info = parseInfo(
      run("pdfinfo", ["-f", "1", "-l", String(count), "-box", input]).toString("utf8"),
      count
    );
    const text = run("pdftotext", ["-enc", "UTF-8", "-layout", input, "-"]).toString("utf8");
    const texts = text.split("\f");
    if (texts.pop() !== "" || texts.length !== count)
      throw new Error("PDF text extraction did not account for every page");
    const fonts = parseFonts(run("pdffonts", [input]).toString("utf8"));
    let totalPixels = 0;
    let totalBytes = bytes.length;
    const pages = info.geometry.map((geometry, index) => {
      let first;
      for (const sample of [1, 2]) {
        const prefix = path.join(scratch, `page-${geometry.number}-sample-${sample}`);
        run("pdftoppm", [
          "-f",
          String(geometry.number),
          "-l",
          String(geometry.number),
          "-singlefile",
          "-scale-to",
          String(PDF_RENDER_SCALE),
          "-png",
          input,
          prefix,
        ]);
        const png = readBoundedFile(`${prefix}.png`, MAX_PDF_BUNDLE_BYTES);
        const header = inspectPngHeaderBytes(png);
        if (header.width * header.height > MAX_PDF_PAGE_PIXELS)
          throw new Error("PDF page exceeds the pixel budget");
        const inspected = inspectPngVisualBytes(png);
        if (
          first &&
          (first.pixel_sha256 !== inspected.pixelSha256 ||
            first.width !== header.width ||
            first.height !== header.height)
        )
          throw new Error(`PDF page ${geometry.number} changed between render samples`);
        if (!first)
          first = {
            number: geometry.number,
            bytes: png,
            sha256: digest(png),
            pixel_sha256: inspected.pixelSha256,
            width: header.width,
            height: header.height,
          };
      }
      totalPixels += first.width * first.height;
      totalBytes += first.bytes.length;
      if (totalPixels > MAX_PDF_TOTAL_PIXELS || totalBytes > MAX_PDF_BUNDLE_BYTES)
        throw new Error("PDF rendering exceeds the aggregate evidence budget");
      return { ...first, text: texts[index] };
    });
    const toolsAfter = toolchainIdentity();
    if (!isDeepStrictEqual(toolsBefore, toolsAfter))
      throw new Error("PDF renderer executable changed during capture");
    return {
      pages,
      toolsBefore,
      toolsAfter,
      observation: {
        schema_version: 1,
        document: { sha256: digest(bytes), bytes: bytes.length, pages: count },
        metadata: info.metadata,
        fonts,
        pages: info.geometry.map((geometry, index) => ({ ...geometry, text: texts[index] })),
      },
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = { renderPdf, toolchainIdentity };
