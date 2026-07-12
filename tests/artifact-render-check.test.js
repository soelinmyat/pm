"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  VIEWPORTS,
  browserCandidates,
  findClosingBodyIndex,
  probeDataMarkerVisibility,
  renderArtifact,
  resolveBrowser,
} = require("../scripts/artifact-render-check");
const { MAX_HTML_BYTES } = require("../scripts/lib/review-limits");

let installedBrowser = null;
try {
  installedBrowser = resolveBrowser();
} catch {
  installedBrowser = null;
}

function fakeBrowser(root) {
  const browserPath = path.join(root, "fake-chromium.js");
  fs.writeFileSync(
    browserPath,
    `#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const zlib = require("node:zlib");
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1}return(crc^0xffffffff)>>>0}
function chunk(type,data){const name=Buffer.from(type,"ascii");const out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length,0);name.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([name,data])),8+data.length);return out}
function makePng(width,height){const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc((width*4+1)*height);return Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),chunk("IHDR",header),chunk("IDAT",zlib.deflateSync(rows)),chunk("IEND",Buffer.alloc(0))])}
function makePdf(){const objects=["1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n","2 0 obj\\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\\nendobj\\n","3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\\nendobj\\n"];let body="%PDF-1.7\\n";const offsets=[0];for(const object of objects){offsets.push(Buffer.byteLength(body,"latin1"));body+=object}body+="%"+"padding".repeat(150)+"\\n";const xref=Buffer.byteLength(body,"latin1");body+="xref\\n0 4\\n0000000000 65535 f \\n";for(const offset of offsets.slice(1))body+=String(offset).padStart(10,"0")+" 00000 n \\n";body+="trailer\\n<< /Size 4 /Root 1 0 R >>\\nstartxref\\n"+xref+"\\n%%EOF\\n";return Buffer.from(body,"latin1")}
const screenshot = process.argv.find((arg) => arg.startsWith("--screenshot="));
const pdf = process.argv.find((arg) => arg.startsWith("--print-to-pdf="));
const dump = process.argv.includes("--dump-dom");
if (process.argv.includes("--version")) {
  process.stdout.write("Chromium 123.0.0 test\\n");
  process.exit(0);
}
if (dump) {
  const probePath = new URL(process.argv[process.argv.length - 1]);
  const probe = fs.readFileSync(probePath, "utf8");
  const markerId = probe.match(/marker[.]id="([^"]+)"/)[1];
  const width = Number(process.argv.find((arg) => arg.startsWith("--window-size=")).split("=")[1].split(",")[0]);
  const metrics = probe.includes("pm-data-marker-visibility")
    ? [{attributes:{"data-dc-outcome":"passed"},text:"passed",firstScreenText:"",visible:false,inViewport:false}]
    : {innerWidth:width,clientWidth:width-15,scrollWidth:width-15,documentHeight:2400,bodyText:500,mainVisible:true,h1Visible:true,anchorCount:4,horizontalOverflow:false};
  process.stdout.write('<html><head><meta id="' + markerId + '" data-json="' + encodeURIComponent(JSON.stringify(metrics)) + '"></head></html>');
}
if (screenshot) {
  const size = process.argv.find((arg) => arg.startsWith("--window-size=")).split("=")[1].split(",").map(Number);
  fs.writeFileSync(screenshot.slice("--screenshot=".length), makePng(size[0], size[1]));
}
if (pdf) {
  fs.writeFileSync(pdf.slice("--print-to-pdf=".length), makePdf());
}
`
  );
  fs.chmodSync(browserPath, 0o755);
  return browserPath;
}

test("render checker captures the canonical viewport matrix and print PDF", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><title>Example</title><meta id="pm-render-metrics" data-json="spoofed">'
    );
    const result = renderArtifact({
      htmlPath,
      outputDir: path.join(root, "renders"),
      browserPath: fakeBrowser(root),
      projectRoot: root,
      markerPrefix: "data-dc-",
    });
    assert.deepEqual(
      result.captures.map(({ name, width, height }) => ({ name, width, height })),
      VIEWPORTS
    );
    assert.ok(result.captures.every((capture) => fs.existsSync(path.join(root, capture.path))));
    assert.ok(
      result.captures.every((capture) => fs.existsSync(path.join(root, capture.full_page.path)))
    );
    assert.equal(result.source.path, "example.html");
    assert.ok(result.captures.every((capture) => !path.isAbsolute(capture.path)));
    assert.equal(path.isAbsolute(result.print.path), false);
    assert.ok(result.captures.every((capture) => capture.full_page.height === 2400));
    assert.ok(result.captures.every((capture) => capture.metrics.horizontalOverflow === false));
    assert.equal(result.print.pages, 1);
    assert.match(result.print.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.source.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.markers.length, 1);
    assert.equal(result.observation.assurance_level, "local-observation");
    assert.equal(result.observation.producer.name, "pm:artifact-render-check");
    assert.equal(
      result.observation.browser.path,
      fs.realpathSync(path.join(root, "fake-chromium.js"))
    );
    assert.equal(result.observation.browser.engine, "chromium");
    assert.equal(result.observation.browser.version, "Chromium 123.0.0 test");
    assert.match(result.observation.browser.executable_sha256_before, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      result.observation.browser.executable_sha256_after,
      result.observation.browser.executable_sha256_before
    );
    assert.match(result.observation.invocation_configuration_sha256, /^sha256:[0-9a-f]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects browser executable drift during capture", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, "<!doctype html><title>Example</title>");
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace(
          "if (screenshot) {",
          'if (screenshot) { fs.appendFileSync(__filename, "\\n// executable drift\\n");'
        )
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath,
          outputDir: path.join(root, "renders"),
          browserPath,
          projectRoot: root,
        }),
      /browser executable changed during artifact capture/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects HTML source drift during capture", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, "<!doctype html><title>Example</title>");
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace(
          "if (screenshot) {",
          `if (screenshot) { fs.appendFileSync(${JSON.stringify(htmlPath)}, "\\n<!-- source drift -->\\n");`
        )
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath,
          outputDir: path.join(root, "renders"),
          browserPath,
          projectRoot: root,
        }),
      /HTML source changed during artifact capture/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker preserves the source directory as the relative-resource base", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, '<!doctype html><link rel="stylesheet" href="theme.css">');
    fs.writeFileSync(path.join(root, "theme.css"), "main { display: block; }\n");
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace(
          "if (screenshot) {",
          'if (screenshot) { const source = new URL(process.argv[process.argv.length - 1]); if (!fs.existsSync(new URL("theme.css", source))) process.exit(9);'
        )
    );
    assert.doesNotThrow(() =>
      renderArtifact({
        htmlPath,
        outputDir: path.join(root, "renders"),
        browserPath,
        projectRoot: root,
      })
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker bounds immutable HTML reads at the shared byte ceiling", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, Buffer.alloc(MAX_HTML_BYTES, 0x20));
    assert.doesNotThrow(() =>
      renderArtifact({
        htmlPath,
        outputDir: path.join(root, "renders"),
        browserPath,
        projectRoot: root,
      })
    );
    fs.writeFileSync(htmlPath, Buffer.alloc(MAX_HTML_BYTES + 1, 0x20));
    assert.throws(
      () =>
        renderArtifact({
          htmlPath,
          outputDir: path.join(root, "renders-over"),
          browserPath,
          projectRoot: root,
        }),
      /HTML exceeds (?:the )?\d+-byte input budget/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects stale captures when the browser produces no new image", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const outputDir = path.join(root, "renders");
    const browserPath = fakeBrowser(root);
    fs.mkdirSync(outputDir);
    fs.writeFileSync(htmlPath, "<!doctype html><title>Example</title>");
    for (const viewport of VIEWPORTS) {
      fs.writeFileSync(path.join(outputDir, `example-${viewport.name}.png`), Buffer.alloc(2048));
    }
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace("if (screenshot) {", "if (false && screenshot) {")
    );
    assert.throws(
      () => renderArtifact({ htmlPath, outputDir, browserPath, projectRoot: root }),
      /did not create a fresh PNG/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects horizontal document overflow from DOM metrics", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, "<!doctype html><title>Example</title>");
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace("horizontalOverflow:false", "horizontalOverflow:true")
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath,
          outputDir: path.join(root, "renders"),
          browserPath,
          projectRoot: root,
        }),
      /horizontal document overflow/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects captures with the wrong dimensions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "example.html");
    const browserPath = fakeBrowser(root);
    fs.writeFileSync(htmlPath, "<!doctype html><title>Example</title>");
    fs.writeFileSync(
      browserPath,
      fs
        .readFileSync(browserPath, "utf8")
        .replace("makePng(size[0], size[1])", "makePng(1400, size[1])")
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath,
          outputDir: path.join(root, "renders"),
          browserPath,
          projectRoot: root,
        }),
      /expected 1440x1000/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("render checker rejects source and output paths outside the project root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-root-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-outside-"));
  try {
    const insideHtml = path.join(root, "inside.html");
    const outsideHtml = path.join(outside, "outside.html");
    fs.writeFileSync(insideHtml, "<!doctype html><title>Inside</title>");
    fs.writeFileSync(outsideHtml, "<!doctype html><title>Outside</title>");
    assert.throws(
      () =>
        renderArtifact({
          htmlPath: outsideHtml,
          outputDir: path.join(root, "renders"),
          browserPath: fakeBrowser(root),
          projectRoot: root,
        }),
      /HTML must be inside the project root/
    );
    assert.throws(
      () =>
        renderArtifact({
          htmlPath: insideHtml,
          outputDir: path.join(outside, "renders"),
          browserPath: fakeBrowser(root),
          projectRoot: root,
        }),
      /render output directory must be inside the project root/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test("browser resolution fails closed when no configured candidate exists", () => {
  assert.throws(() => resolveBrowser("/definitely/missing/chromium"), /does not exist/);
});

test("browser marker probe reports computed visibility instead of trusting markup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
  try {
    const htmlPath = path.join(root, "report.html");
    fs.writeFileSync(
      htmlPath,
      '<!doctype html><style>[data-dc-outcome]{display:none}</style><details><p data-dc-outcome="passed">passed</p></details>'
    );
    assert.deepEqual(probeDataMarkerVisibility(fakeBrowser(root), htmlPath, root), [
      {
        attributes: { "data-dc-outcome": "passed" },
        text: "passed",
        firstScreenText: "",
        visible: false,
        inViewport: false,
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(
  "real browser marker probe excludes offscreen and clipped descendant text",
  {
    skip:
      (process.env.PM_SKIP_BROWSER_TESTS && "browser tests explicitly disabled") ||
      (!installedBrowser && "Chromium is not installed"),
  },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-render-"));
    try {
      const htmlPath = path.join(root, "report.html");
      fs.writeFileSync(
        htmlPath,
        '<!doctype html><html><body><p data-dc-next-action-sha256="test"><span style="position:absolute;left:-10000px">Fix navigation</span><span>Proceed</span><span style="clip-path:inset(50%)">Clipped</span></p></body></html>'
      );
      const [marker] = probeDataMarkerVisibility(installedBrowser, htmlPath, root);
      assert.equal(marker.visible, true);
      assert.equal(marker.inViewport, true);
      assert.equal(marker.text, "Proceed");
      assert.equal(marker.firstScreenText, "Proceed");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
);

test("browser candidates include standard Windows Chrome, Chromium, and Edge installs", () => {
  const candidates = browserCandidates("win32", {
    LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local",
    PROGRAMFILES: "C:\\Program Files",
    "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  });
  assert.ok(
    candidates.some((candidate) => candidate.endsWith("Google/Chrome/Application/chrome.exe"))
  );
  assert.ok(candidates.some((candidate) => candidate.endsWith("Chromium/Application/chrome.exe")));
  assert.ok(
    candidates.some((candidate) => candidate.endsWith("Microsoft/Edge/Application/msedge.exe"))
  );
});

test("render probe finds the body close outside JSON raw text and trailing comments", () => {
  const html =
    '<html><head><script type="application/json">{"title":"Explain </body>"}</script></head><body><main>x</main></body><!-- </body> --></html>';
  assert.equal(findClosingBodyIndex(html), html.indexOf("</body><!--"));
});
