#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const { parseCliArgs } = require("./loop-args");
const { writeJsonAtomic } = require("./lib/atomic-file");
const projectWriter = require("./lib/project-atomic-write");
const { inspectPdf, inspectPng } = require("./lib/media-inspect");
const { MAX_HTML_BYTES } = require("./lib/review-limits");
const { version: PLUGIN_VERSION } = require("../plugin.config.json");

const VIEWPORTS = Object.freeze([
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 768, height: 1024 },
  // Chrome's headless CLI clamps top-level windows below 500 CSS px. This is
  // the narrow render canary; the structural gate separately requires a
  // max-width responsive rule.
  { name: "narrow", width: 500, height: 812 },
]);
const MAX_RENDER_HEIGHT = 16_000;
const OBSERVATION_ASSURANCE_LEVEL = "local-observation";
const OBSERVATION_PRODUCER = "pm:artifact-render-check";
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;
const SOURCE_WATCHER = path.join(__dirname, "artifact-source-watch.js");
const BROWSER_PROBE = path.join(__dirname, "artifact-browser-probe.js");

function renderArtifact(options) {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const realProjectRoot = fs.realpathSync(projectRoot);
  const htmlPath = path.resolve(options.htmlPath);
  const outputDir = path.resolve(options.outputDir);
  const relativeHtml = projectRelative(projectRoot, htmlPath, "HTML");
  projectRelative(projectRoot, outputDir, "render output directory");
  const requestedBrowserPath = resolveBrowser(options.browserPath);
  const browserPath = fs.realpathSync(requestedBrowserPath);
  const executableSha256Before = digestFile(browserPath);
  const browserVersion = probeBrowserVersion(browserPath);
  if (!fs.statSync(htmlPath).isFile()) throw new Error(`HTML is not a file: ${htmlPath}`);
  assertRealContained(realProjectRoot, fs.realpathSync(htmlPath), "HTML");
  const sourceBefore = readRenderSourceIdentity(htmlPath);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  assertRealContained(realProjectRoot, fs.realpathSync(outputDir), "render output directory");
  const sourceWatcher = startSourceWatcher(htmlPath, outputDir);
  try {
    const url = pathToFileURL(htmlPath).href;
    const captures = [];

    for (const viewport of VIEWPORTS) {
      const output = path.join(
        outputDir,
        `${path.basename(htmlPath, ".html")}-${viewport.name}.png`
      );
      const metrics = captureMetrics(browserPath, htmlPath, outputDir, viewport, {
        legacyProbe: options.legacyProbe === true,
      });
      assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);
      validateMetrics(metrics, viewport);
      fs.rmSync(output, { force: true });
      runBrowser(
        browserPath,
        [
          ...baseArgs(),
          `--window-size=${viewport.width},${viewport.height}`,
          `--screenshot=${output}`,
          url,
        ],
        { canonical: options.legacyProbe !== true, projectRoot }
      );
      assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);
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
      runBrowser(
        browserPath,
        [
          ...baseArgs(),
          `--window-size=${viewport.width},${fullHeight}`,
          `--screenshot=${fullOutput}`,
          url,
        ],
        { canonical: options.legacyProbe !== true, projectRoot }
      );
      assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);
      const fullDimensions = inspectPng(fullOutput);
      if (fullDimensions.width !== viewport.width || fullDimensions.height !== fullHeight) {
        throw new Error(
          `${viewport.name} full capture has ${fullDimensions.width}x${fullDimensions.height}; expected ${viewport.width}x${fullHeight}`
        );
      }
      captures.push({
        ...viewport,
        path: projectRelative(projectRoot, output, "render capture"),
        sha256: digestFile(output),
        bytes: fs.statSync(output).size,
        metrics,
        full_page: {
          path: projectRelative(projectRoot, fullOutput, "full-page render capture"),
          width: viewport.width,
          height: fullHeight,
          sha256: digestFile(fullOutput),
          bytes: fs.statSync(fullOutput).size,
        },
      });
    }

    const pdfPath = path.join(outputDir, `${path.basename(htmlPath, ".html")}-print.pdf`);
    fs.rmSync(pdfPath, { force: true });
    runBrowser(
      browserPath,
      [...baseArgs(), `--print-to-pdf=${pdfPath}`, "--no-pdf-header-footer", url],
      { canonical: options.legacyProbe !== true, projectRoot }
    );
    assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);
    const printInspection = inspectPdf(pdfPath);
    const markers = options.markerPrefix
      ? probeDataMarkerVisibility(browserPath, htmlPath, outputDir, options.markerPrefix, {
          legacyProbe: options.legacyProbe === true,
        })
      : null;
    assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);
    const canonicalBrowserPathAfter = fs.realpathSync(requestedBrowserPath);
    const executableSha256After = digestFile(canonicalBrowserPathAfter);
    if (
      canonicalBrowserPathAfter !== browserPath ||
      executableSha256After !== executableSha256Before
    )
      throw new Error("browser executable changed during artifact capture");
    assertRenderSourceIdentity(htmlPath, sourceBefore, sourceWatcher);

    return {
      schema_version: 1,
      source: { path: relativeHtml, sha256: sourceBefore.sha256 },
      observation: {
        assurance_level: OBSERVATION_ASSURANCE_LEVEL,
        producer: { name: OBSERVATION_PRODUCER, version: PLUGIN_VERSION },
        browser: {
          path: browserPath,
          executable_sha256_before: executableSha256Before,
          executable_sha256_after: executableSha256After,
          engine: "chromium",
          version: browserVersion,
        },
        invocation_configuration_sha256: invocationConfigurationDigest(options.markerPrefix),
      },
      captures,
      print: {
        path: projectRelative(projectRoot, pdfPath, "print render"),
        sha256: digestFile(pdfPath),
        bytes: fs.statSync(pdfPath).size,
        pages: printInspection.pages,
      },
      ...(markers ? { markers } : {}),
      checked_at: new Date().toISOString(),
    };
  } finally {
    stopSourceWatcher(sourceWatcher);
  }
}

function assertRenderSourceIdentity(htmlPath, expected, watcher = null) {
  if (watcher) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  if (watcher && fs.existsSync(watcher.driftPath))
    throw new Error("HTML source changed during artifact capture");
  if (watcher && !processAlive(watcher.child.pid))
    throw new Error("HTML source watcher stopped during artifact capture");
  const actual = readRenderSourceIdentity(htmlPath);
  if (
    actual.realpath !== expected.realpath ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.mtimeNs !== expected.mtimeNs ||
    actual.ctimeNs !== expected.ctimeNs ||
    actual.sha256 !== expected.sha256
  )
    throw new Error("HTML source changed during artifact capture");
}

function startSourceWatcher(htmlPath, outputDir) {
  const stateDir = fs.mkdtempSync(path.join(outputDir, ".pm-source-watch-"));
  const readyPath = path.join(stateDir, "ready");
  const driftPath = path.join(stateDir, "drift");
  const child = spawn(process.execPath, [SOURCE_WATCHER, htmlPath, readyPath, driftPath], {
    stdio: "ignore",
  });
  const deadline = Date.now() + 5_000;
  while (!fs.existsSync(readyPath)) {
    if (!processAlive(child.pid) || Date.now() >= deadline) {
      child.kill("SIGKILL");
      fs.rmSync(stateDir, { recursive: true, force: true });
      throw new Error("cannot start HTML source watcher");
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return { child, stateDir, driftPath };
}

function stopSourceWatcher(watcher) {
  if (!watcher) return;
  watcher.child.kill("SIGTERM");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  fs.rmSync(watcher.stateDir, { recursive: true, force: true });
}

function processAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readRenderSourceIdentity(htmlPath) {
  const noFollow = fs.constants.O_NOFOLLOW || 0;
  const descriptor = fs.openSync(htmlPath, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile()) throw new Error(`HTML is not a regular file: ${htmlPath}`);
    if (stat.size > BigInt(MAX_HTML_BYTES))
      throw new Error(`HTML exceeds the ${MAX_HTML_BYTES}-byte input budget`);
    const chunks = [];
    let total = 0;
    while (total <= MAX_HTML_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_HTML_BYTES + 1 - total));
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      total += count;
      if (total > MAX_HTML_BYTES)
        throw new Error(`HTML exceeds the ${MAX_HTML_BYTES}-byte input budget`);
      chunks.push(buffer.subarray(0, count));
    }
    const bytes = Buffer.concat(chunks, total);
    return {
      realpath: fs.realpathSync(htmlPath),
      dev: String(stat.dev),
      ino: String(stat.ino),
      mtimeNs: String(stat.mtimeNs),
      ctimeNs: String(stat.ctimeNs),
      sha256: `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`,
      bytes,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function probeBrowserVersion(browserPath) {
  const result = spawnSync(browserPath, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  });
  if (result.error) throw new Error(`cannot identify browser executable: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `cannot identify browser executable: ${(result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 500)}`
    );
  const version = (result.stdout || result.stderr || "").trim().replace(/\s+/g, " ");
  if (!version || version.length > 500 || !/(chromium|chrome|edge)/i.test(version))
    throw new Error("browser executable emitted an invalid Chromium-family version identity");
  return version;
}

function invocationConfigurationDigest(markerPrefix) {
  const configuration = {
    viewports: VIEWPORTS,
    max_render_height: MAX_RENDER_HEIGHT,
    browser_args: baseArgs(),
    marker_prefix: markerPrefix || null,
    capture_modes: ["viewport-png", "full-page-png", "print-pdf", "dom-metrics"],
    probe_mode: "canonical-url-browser-evaluation",
    source_guard: "immutable-page-content-or-event-watch",
  };
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(configuration)).digest("hex")}`;
}

function projectRelative(root, absolute, label) {
  const relative = path.relative(root, path.resolve(absolute));
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`${label} must be inside the project root`);
  return relative.split(path.sep).join("/");
}

function assertRealContained(root, candidate, label) {
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`))
    throw new Error(`${label} resolves outside the project root`);
}

function baseArgs() {
  return [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-gpu",
    "--disable-sync",
    "--metrics-recording-only",
    "--no-first-run",
  ];
}

function runBrowser(browserPath, args, options = {}) {
  if (options.canonical === true) {
    const screenshot = args.find((arg) => arg.startsWith("--screenshot="));
    const pdf = args.find((arg) => arg.startsWith("--print-to-pdf="));
    const windowSize = args.find((arg) => arg.startsWith("--window-size="));
    const url = args.at(-1);
    if (screenshot || pdf) {
      const [width, height] = (windowSize?.slice("--window-size=".length) || "1440,1000")
        .split(",")
        .map(Number);
      const outputPath = (screenshot || pdf).split("=").slice(1).join("=");
      const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-capture-"));
      const stagingPath = path.join(stagingDir, screenshot ? "capture.png" : "capture.pdf");
      const browserPidPath = path.join(stagingDir, "browser.pid");
      try {
        const result = runBrowserProbe(
          {
            browserPath,
            htmlPath: fileURLToPath(url),
            viewport: { width, height },
            action: screenshot ? "screenshot" : "pdf",
            outputPath: stagingPath,
            browserPidPath,
          },
          "browser capture"
        );
        const attestation = JSON.parse(result.stdout);
        const bytes = readCaptureFilePinned(stagingPath, attestation);
        projectWriter.writeProjectFileAtomic(
          options.projectRoot,
          projectRelative(options.projectRoot, outputPath, "browser capture"),
          bytes,
          {
            replace: false,
            fileMode: 0o600,
            directoryMode: 0o700,
            maxBytes: MAX_CAPTURE_BYTES,
          }
        );
        return result;
      } finally {
        terminateRecordedBrowser(browserPidPath);
        fs.rmSync(stagingDir, { recursive: true, force: true });
      }
    }
  }
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-browser-"));
  try {
    const result = spawnSync(browserPath, [`--user-data-dir=${profileDir}`, ...args], {
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
  } finally {
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

function readCaptureFilePinned(capturePath, expected = null) {
  const descriptor = fs.openSync(
    capturePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()) throw new Error("staged browser capture is not a regular file");
    if (before.size > BigInt(MAX_CAPTURE_BYTES))
      throw new Error(`staged browser capture exceeds ${MAX_CAPTURE_BYTES}-byte budget`);
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("staged browser capture ended before its attested size");
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw new Error("staged browser capture changed during bounded read");
    const actual = {
      dev: String(after.dev),
      ino: String(after.ino),
      size: String(after.size),
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
    if (
      expected &&
      (actual.dev !== expected.dev ||
        actual.ino !== expected.ino ||
        actual.size !== expected.size ||
        actual.sha256 !== expected.sha256)
    )
      throw new Error("staged browser capture does not match producer attestation");
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function terminateRecordedBrowser(pidPath) {
  let pid;
  try {
    pid = Number(fs.readFileSync(pidPath, "utf8").trim());
  } catch {
    return;
  }
  if (!Number.isSafeInteger(pid) || pid < 2) return;
  try {
    if (process.platform === "win32") process.kill(pid, "SIGKILL");
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Normal helper cleanup already terminated the browser.
  }
}

function captureMetrics(browserPath, htmlPath, outputDir, viewport, options = {}) {
  const expression = metricsExpression();
  if (options.legacyProbe !== true)
    return runCanonicalProbe(browserPath, htmlPath, viewport, expression);
  const source = fs.readFileSync(htmlPath, "utf8");
  const markerId = `pm-render-metrics-${crypto.randomBytes(12).toString("hex")}`;
  const probe = `<script>(()=>{const metrics=${expression};const marker=document.createElement("meta");marker.id="${markerId}";marker.setAttribute("data-json",encodeURIComponent(JSON.stringify(metrics)));document.head.append(marker)})();</script>`;
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

function probeDataMarkerVisibility(
  browserPath,
  htmlPath,
  outputDir = path.dirname(htmlPath),
  attributePrefix = "data-dc-",
  options = {}
) {
  if (!/^data-[a-z0-9-]+-$/.test(attributePrefix))
    throw new Error("marker attribute prefix must be a safe data-* prefix ending in '-'");
  const expression = markerVisibilityExpression(attributePrefix);
  if (options.legacyProbe !== true)
    return runCanonicalProbe(
      browserPath,
      htmlPath,
      { name: "marker", width: 1440, height: 1000 },
      expression
    );
  const source = fs.readFileSync(htmlPath, "utf8");
  const markerId = `pm-data-marker-visibility-${crypto.randomBytes(12).toString("hex")}`;
  const probe = `<script>(()=>{const markers=${expression};const marker=document.createElement("meta");marker.id="${markerId}";marker.setAttribute("data-json",encodeURIComponent(JSON.stringify(markers)));document.head.append(marker)})();</script>`;
  const bodyClose = findClosingBodyIndex(source);
  const instrumented =
    bodyClose >= 0
      ? `${source.slice(0, bodyClose)}${probe}${source.slice(bodyClose)}`
      : `${source}${probe}`;
  const probePath = path.join(
    outputDir,
    `.pm-marker-probe-${process.pid}-${crypto.randomBytes(5).toString("hex")}.html`
  );
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(probePath, instrumented, { mode: 0o600 });
  try {
    const result = runBrowser(browserPath, [
      ...baseArgs(),
      "--window-size=1440,1000",
      "--virtual-time-budget=1000",
      "--dump-dom",
      pathToFileURL(probePath).href,
    ]);
    const markerPattern = new RegExp(
      `<meta\\b(?=[^>]*\\bid=["']${markerId}["'])(?=[^>]*\\bdata-json=["']([^"']+)["'])[^>]*>`,
      "i"
    );
    const match = result.stdout.match(markerPattern);
    if (!match) throw new Error("report render did not emit marker visibility evidence");
    const markers = JSON.parse(decodeURIComponent(match[1]));
    if (!Array.isArray(markers)) throw new Error("report marker visibility evidence is invalid");
    return markers;
  } finally {
    fs.rmSync(probePath, { force: true });
  }
}

function runCanonicalProbe(browserPath, htmlPath, viewport, expression) {
  const result = runBrowserProbe({ browserPath, htmlPath, viewport, expression }, "browser probe");
  return JSON.parse(result.stdout);
}

function runBrowserProbe(configuration, label) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync(process.execPath, ["--max-old-space-size=512", BROWSER_PROBE], {
      input: JSON.stringify(configuration),
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!result.error && result.status === 0) return result;
    const detail = `${result.stderr || ""}${result.stdout || ""}`;
    if (!detail.includes("Chromium did not expose a page target") || attempt === 3) break;
  }
  if (result?.error) throw new Error(`${label} failed: ${result.error.message}`);
  throw new Error(
    `${label} exited ${result?.status}: ${(result?.stderr || result?.stdout || "unknown error").trim().slice(0, 500)}`
  );
}

function metricsExpression() {
  return `(${collectMetrics.toString()})()`;
}

function markerVisibilityExpression(attributePrefix) {
  return `(${collectMarkerVisibility.toString()})(${JSON.stringify(attributePrefix)})`;
}

/* global document, window, NodeFilter, getComputedStyle */
// These two functions are serialized and evaluated inside Chromium. Keeping
// them as ordinary formatted functions makes the shared probe program auditable.
function collectMetrics() {
  const visible = (element) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
    );
  };
  const root = document.documentElement;
  return {
    innerWidth: window.innerWidth,
    clientWidth: root.clientWidth,
    scrollWidth: root.scrollWidth,
    documentHeight: root.scrollHeight,
    bodyText: (document.body?.innerText || "").trim().length,
    mainVisible: visible(document.querySelector("main")),
    h1Visible: visible(document.querySelector("h1")),
    anchorCount: document.querySelectorAll('a[href^="#"]').length,
    horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
  };
}

function collectMarkerVisibility(attributePrefix) {
  const intersects = (left, right) =>
    left.right > right.left &&
    left.left < right.right &&
    left.bottom > right.top &&
    left.top < right.bottom;
  const geometry = (rawRects, element) => {
    if (!element) return { visible: false, inViewport: false };
    let rects = Array.from(rawRects).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) return { visible: false, inViewport: false };
    let node = element;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.getAttribute("aria-hidden") === "true" ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        Number(style.opacity) === 0 ||
        (style.clipPath && style.clipPath !== "none")
      )
        return { visible: false, inViewport: false };
      if (node !== element) {
        const clipsX = /(hidden|clip|auto|scroll)/.test(style.overflowX);
        const clipsY = /(hidden|clip|auto|scroll)/.test(style.overflowY);
        if (clipsX || clipsY) {
          const clip = node.getBoundingClientRect();
          rects = rects
            .map((rect) => ({
              left: clipsX ? Math.max(rect.left, clip.left) : rect.left,
              right: clipsX ? Math.min(rect.right, clip.right) : rect.right,
              top: clipsY ? Math.max(rect.top, clip.top) : rect.top,
              bottom: clipsY ? Math.min(rect.bottom, clip.bottom) : rect.bottom,
            }))
            .filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
          if (rects.length === 0) return { visible: false, inViewport: false };
        }
      }
      node = node.parentElement;
    }
    const documentBounds = {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: document.documentElement.scrollHeight,
    };
    rects = rects.filter((rect) => intersects(rect, documentBounds));
    if (rects.length === 0) return { visible: false, inViewport: false };
    const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
    return {
      visible: true,
      inViewport: rects.some((rect) => intersects(rect, viewport)),
    };
  };
  const textVisibility = (element) => {
    const visible = [];
    const firstScreen = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let textNode;
    while ((textNode = walker.nextNode())) {
      const value = (textNode.nodeValue || "").replace(/\s+/g, " ").trim();
      if (!value) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const state = geometry(range.getClientRects(), textNode.parentElement);
      if (state.visible) visible.push(value);
      if (state.inViewport) firstScreen.push(value);
    }
    return { text: visible.join(" "), firstScreenText: firstScreen.join(" ") };
  };
  return Array.from(document.querySelectorAll("*"))
    .filter((element) =>
      Array.from(element.attributes).some((attribute) => attribute.name.startsWith(attributePrefix))
    )
    .map((element) => ({
      attributes: Object.fromEntries(
        Array.from(element.attributes)
          .filter((attribute) => attribute.name.startsWith(attributePrefix))
          .map((attribute) => [attribute.name, attribute.value])
      ),
      ...textVisibility(element),
      ...geometry(element.getClientRects(), element),
    }));
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
    throw new Error(
      `${viewport.name} render is ${metrics.documentHeight}px and exceeds the ${MAX_RENDER_HEIGHT}px height budget`
    );
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
  const candidates = browserCandidates(process.platform, process.env);
  const found = candidates.find(
    (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()
  );
  if (!found) {
    throw new Error("no Chromium browser found; pass --browser or set PM_ARTIFACT_BROWSER");
  }
  return found;
}

function browserCandidates(platform = process.platform, env = process.env) {
  const candidates = [env.PM_ARTIFACT_BROWSER];
  if (platform === "win32") {
    for (const root of [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]].filter(
      Boolean
    )) {
      candidates.push(
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(root, "Chromium", "Application", "chrome.exe"),
        path.join(root, "Microsoft", "Edge", "Application", "msedge.exe")
      );
    }
  } else {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/usr/bin/google-chrome",
      "/usr/bin/microsoft-edge",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser"
    );
  }
  return [...new Set(candidates.filter(Boolean))];
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
      "--root": { type: "string" },
      "--marker-prefix": { type: "string" },
      "--json": { type: "boolean" },
    }).args;
    if (!parsed.html || !parsed.outDir) throw new Error("--html and --out-dir are required");
    const result = renderArtifact({
      htmlPath: parsed.html,
      outputDir: parsed.outDir,
      browserPath: parsed.browser,
      projectRoot: parsed.root || process.cwd(),
      markerPrefix: parsed.markerPrefix,
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
  OBSERVATION_ASSURANCE_LEVEL,
  OBSERVATION_PRODUCER,
  VIEWPORTS,
  browserCandidates,
  captureMetrics,
  findClosingBodyIndex,
  inspectPdf,
  inspectPng,
  invocationConfigurationDigest,
  probeDataMarkerVisibility,
  readCaptureFilePinned,
  renderArtifact,
  resolveBrowser,
  validateMetrics,
};
