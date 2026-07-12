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
if (dump) {
  const probePath = new URL(process.argv[process.argv.length - 1]);
  const probe = fs.readFileSync(probePath, "utf8");
  const markerId = probe.match(/marker[.]id="([^"]+)"/)[1];
  const width = Number(process.argv.find((arg) => arg.startsWith("--window-size=")).split("=")[1].split(",")[0]);
  const metrics = probe.includes("pm-data-marker-visibility")
    ? [{attributes:{"data-dc-outcome":"passed"},text:"passed",visible:false,inViewport:false}]
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
    });
    assert.deepEqual(
      result.captures.map(({ name, width, height }) => ({ name, width, height })),
      VIEWPORTS
    );
    assert.ok(result.captures.every((capture) => fs.existsSync(capture.path)));
    assert.ok(result.captures.every((capture) => fs.existsSync(capture.full_page.path)));
    assert.ok(result.captures.every((capture) => capture.full_page.height === 2400));
    assert.ok(result.captures.every((capture) => capture.metrics.horizontalOverflow === false));
    assert.equal(result.print.pages, 1);
    assert.match(result.print.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.source.sha256, /^sha256:[0-9a-f]{64}$/);
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
      () => renderArtifact({ htmlPath, outputDir, browserPath }),
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
      () => renderArtifact({ htmlPath, outputDir: path.join(root, "renders"), browserPath }),
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
      () => renderArtifact({ htmlPath, outputDir: path.join(root, "renders"), browserPath }),
      /expected 1440x1000/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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
        visible: false,
        inViewport: false,
      },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

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
