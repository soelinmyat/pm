#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { parseCliArgs } = require("./loop-args");
const { writeJsonAtomic } = require("./lib/atomic-file");

const VIEWPORTS = Object.freeze([
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  // Chrome's headless CLI clamps top-level windows below 500 CSS px. This is
  // the narrow render canary; the structural gate separately requires a
  // max-width responsive rule.
  { name: "narrow", width: 500, height: 812 },
]);
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MIN_RENDER_BYTES = 1024;
const MAX_RENDER_HEIGHT = 16_000;

function renderArtifact(options) {
  const htmlPath = path.resolve(options.htmlPath);
  const outputDir = path.resolve(options.outputDir);
  const browserPath = resolveBrowser(options.browserPath);
  if (!fs.statSync(htmlPath).isFile()) throw new Error(`HTML is not a file: ${htmlPath}`);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const url = pathToFileURL(htmlPath).href;
  const captures = [];

  for (const viewport of VIEWPORTS) {
    const output = path.join(outputDir, `${path.basename(htmlPath, ".html")}-${viewport.name}.png`);
    const metrics = captureMetrics(browserPath, htmlPath, outputDir, viewport);
    validateMetrics(metrics, viewport);
    fs.rmSync(output, { force: true });
    runBrowser(browserPath, [
      ...baseArgs(),
      `--window-size=${viewport.width},${viewport.height}`,
      `--screenshot=${output}`,
      url,
    ]);
    const dimensions = inspectPng(output);
    if (dimensions.width !== viewport.width || dimensions.height !== viewport.height) {
      throw new Error(
        `${viewport.name} capture has ${dimensions.width}x${dimensions.height}; expected ${viewport.width}x${viewport.height}`
      );
    }
    const fullHeight = Math.max(viewport.height, Math.ceil(metrics.documentHeight));
    const fullOutput = path.join(
      outputDir,
      `${path.basename(htmlPath, ".html")}-${viewport.name}-full.png`
    );
    fs.rmSync(fullOutput, { force: true });
    runBrowser(browserPath, [
      ...baseArgs(),
      `--window-size=${viewport.width},${fullHeight}`,
      `--screenshot=${fullOutput}`,
      url,
    ]);
    const fullDimensions = inspectPng(fullOutput);
    if (fullDimensions.width !== viewport.width || fullDimensions.height !== fullHeight) {
      throw new Error(
        `${viewport.name} full capture has ${fullDimensions.width}x${fullDimensions.height}; expected ${viewport.width}x${fullHeight}`
      );
    }
    captures.push({
      ...viewport,
      path: output,
      sha256: digestFile(output),
      bytes: fs.statSync(output).size,
      metrics,
      full_page: {
        path: fullOutput,
        width: viewport.width,
        height: fullHeight,
        sha256: digestFile(fullOutput),
        bytes: fs.statSync(fullOutput).size,
      },
    });
  }

  const pdfPath = path.join(outputDir, `${path.basename(htmlPath, ".html")}-print.pdf`);
  fs.rmSync(pdfPath, { force: true });
  runBrowser(browserPath, [
    ...baseArgs(),
    `--print-to-pdf=${pdfPath}`,
    "--no-pdf-header-footer",
    url,
  ]);
  const printInspection = inspectPdf(pdfPath);

  return {
    schema_version: 1,
    source: { path: htmlPath, sha256: digestFile(htmlPath) },
    browser: path.resolve(browserPath),
    captures,
    print: {
      path: pdfPath,
      sha256: digestFile(pdfPath),
      bytes: fs.statSync(pdfPath).size,
      pages: printInspection.pages,
    },
    checked_at: new Date().toISOString(),
  };
}

function baseArgs() {
  return [
    "--headless=new",
    "--disable-background-networking",
    "--disable-extensions",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
  ];
}

function runBrowser(browserPath, args) {
  const result = spawnSync(browserPath, args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw new Error(`browser launch failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "unknown error").trim().slice(0, 500);
    throw new Error(`browser exited ${result.status}: ${detail}`);
  }
  return result;
}

function captureMetrics(browserPath, htmlPath, outputDir, viewport) {
  const source = fs.readFileSync(htmlPath, "utf8");
  const markerId = `pm-render-metrics-${crypto.randomBytes(12).toString("hex")}`;
  const probe = `<script>(()=>{const visible=(element)=>{if(!element)return false;const rect=element.getBoundingClientRect();const style=getComputedStyle(element);return rect.width>0&&rect.height>0&&style.display!=="none"&&style.visibility!=="hidden"};const root=document.documentElement;const metrics={innerWidth:window.innerWidth,clientWidth:root.clientWidth,scrollWidth:root.scrollWidth,documentHeight:root.scrollHeight,bodyText:(document.body?.innerText||"").trim().length,mainVisible:visible(document.querySelector("main")),h1Visible:visible(document.querySelector("h1")),anchorCount:document.querySelectorAll('a[href^="#"]').length,horizontalOverflow:root.scrollWidth>root.clientWidth+1};const marker=document.createElement("meta");marker.id="${markerId}";marker.setAttribute("data-json",encodeURIComponent(JSON.stringify(metrics)));document.head.append(marker)})();</script>`;
  const bodyClose = findClosingBodyIndex(source);
  const instrumented =
    bodyClose >= 0
      ? `${source.slice(0, bodyClose)}${probe}${source.slice(bodyClose)}`
      : `${source}${probe}`;
  const probePath = path.join(
    outputDir,
    `.pm-render-probe-${process.pid}-${crypto.randomBytes(5).toString("hex")}.html`
  );
  fs.writeFileSync(probePath, instrumented, { mode: 0o600 });
  try {
    const result = runBrowser(browserPath, [
      ...baseArgs(),
      `--window-size=${viewport.width},${viewport.height}`,
      "--virtual-time-budget=1000",
      "--dump-dom",
      pathToFileURL(probePath).href,
    ]);
    const markerPattern = new RegExp(
      `<meta\\b(?=[^>]*\\bid=["']${markerId}["'])(?=[^>]*\\bdata-json=["']([^"']+)["'])[^>]*>`,
      "i"
    );
    const match = result.stdout.match(markerPattern);
    if (!match) throw new Error(`${viewport.name} render did not emit DOM metrics`);
    return JSON.parse(decodeURIComponent(match[1]));
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

function findClosingBodyIndex(html) {
  const lower = String(html).toLowerCase();
  let index = 0;
  let lastBodyClose = -1;
  while (index < lower.length) {
    if (lower.startsWith("<!--", index)) {
      const end = lower.indexOf("-->", index + 4);
      index = end < 0 ? lower.length : end + 3;
      continue;
    }
    const rawTag = ["script", "style", "template"].find(
      (tag) =>
        lower.startsWith(`<${tag}`, index) && /[\s>]/.test(lower[index + tag.length + 1] || "")
    );
    if (rawTag) {
      const openEnd = lower.indexOf(">", index + rawTag.length + 1);
      const close = openEnd < 0 ? null : findClosingTag(String(html), lower, rawTag, openEnd + 1);
      index = close ? close.end : lower.length;
      continue;
    }
    const endTag = readEndTagAt(String(html), index);
    if (endTag?.name === "body") lastBodyClose = index;
    index += 1;
  }
  return lastBodyClose;
}

function findClosingTag(html, lowerHtml, name, fromIndex) {
  const needle = `</${name}`;
  let start = lowerHtml.indexOf(needle, fromIndex);
  while (start >= 0) {
    const tag = readEndTagAt(html, start);
    if (tag?.name === name) return tag;
    start = lowerHtml.indexOf(needle, start + needle.length);
  }
  return null;
}

function readEndTagAt(html, index) {
  if (!html.startsWith("</", index) || !/[A-Za-z]/.test(html[index + 2] || "")) return null;
  let cursor = index + 2;
  while (/[A-Za-z0-9:-]/.test(html[cursor] || "")) cursor += 1;
  const name = html.slice(index + 2, cursor).toLowerCase();
  if (!name || !/[\s>]/.test(html[cursor] || "")) return null;
  let quote = null;
  for (let end = cursor; end < html.length; end += 1) {
    const character = html[end];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return { name, start: index, end: end + 1 };
    }
  }
  return null;
}

function validateMetrics(metrics, viewport) {
  const numericFields = [
    "innerWidth",
    "clientWidth",
    "scrollWidth",
    "documentHeight",
    "bodyText",
    "anchorCount",
  ];
  const booleanFields = ["mainVisible", "h1Visible", "horizontalOverflow"];
  if (
    !metrics ||
    numericFields.some((field) => !Number.isFinite(metrics[field]) || metrics[field] < 0) ||
    booleanFields.some((field) => typeof metrics[field] !== "boolean")
  ) {
    throw new Error(`${viewport.name} render emitted invalid DOM metrics`);
  }
  if (metrics.innerWidth !== viewport.width) {
    throw new Error(
      `${viewport.name} browser width is ${metrics.innerWidth}; expected ${viewport.width}`
    );
  }
  if (metrics.clientWidth > metrics.innerWidth || metrics.clientWidth < metrics.innerWidth - 40) {
    throw new Error(`${viewport.name} layout width has an unexpected browser-chrome delta`);
  }
  if (metrics.horizontalOverflow || metrics.scrollWidth > metrics.clientWidth + 1) {
    throw new Error(`${viewport.name} render has horizontal document overflow`);
  }
  if (!Number.isFinite(metrics.documentHeight) || metrics.documentHeight > MAX_RENDER_HEIGHT) {
    throw new Error(`${viewport.name} render exceeds the ${MAX_RENDER_HEIGHT}px height budget`);
  }
  if (
    !metrics.mainVisible ||
    !metrics.h1Visible ||
    metrics.bodyText < 100 ||
    metrics.anchorCount < 1
  ) {
    throw new Error(`${viewport.name} render is blank or missing visible document landmarks`);
  }
}

function resolveBrowser(explicit) {
  if (explicit) {
    if (fs.existsSync(explicit) && fs.statSync(explicit).isFile()) return explicit;
    throw new Error(`configured Chromium browser does not exist: ${explicit}`);
  }
  const candidates = [
    process.env.PM_ARTIFACT_BROWSER,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!found) {
    throw new Error("no Chromium browser found; pass --browser or set PM_ARTIFACT_BROWSER");
  }
  return found;
}

function inspectPng(filePath) {
  requireFreshRegularFile(filePath, "PNG");
  const bytes = fs.readFileSync(filePath);
  if (bytes.length < MIN_RENDER_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`invalid PNG capture: ${filePath}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function inspectPdf(filePath) {
  requireFreshRegularFile(filePath, "PDF");
  const bytes = fs.readFileSync(filePath);
  const pages = (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length;
  if (
    bytes.length < MIN_RENDER_BYTES ||
    bytes.subarray(0, 5).toString("ascii") !== "%PDF-" ||
    pages < 1
  ) {
    throw new Error(`invalid PDF capture: ${filePath}`);
  }
  return { pages };
}

function requireFreshRegularFile(filePath, kind) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`browser did not create a fresh ${kind} capture: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${kind} capture is not a regular file: ${filePath}`);
  }
}

function digestFile(filePath) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`;
}

function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseCliArgs(argv, {
      "--html": { type: "string" },
      "--out-dir": { type: "string" },
      "--browser": { type: "string" },
      "--manifest": { type: "string" },
      "--json": { type: "boolean" },
    }).args;
    if (!parsed.html || !parsed.outDir) throw new Error("--html and --out-dir are required");
    const result = renderArtifact({
      htmlPath: parsed.html,
      outputDir: parsed.outDir,
      browserPath: parsed.browser,
    });
    if (parsed.manifest)
      writeJsonAtomic(path.resolve(parsed.manifest), result, { fileMode: 0o600 });
    process.stdout.write(
      parsed.json ? `${JSON.stringify(result, null, 2)}\n` : "Artifact render check passed\n"
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  VIEWPORTS,
  captureMetrics,
  findClosingBodyIndex,
  inspectPdf,
  inspectPng,
  renderArtifact,
  resolveBrowser,
  validateMetrics,
};
