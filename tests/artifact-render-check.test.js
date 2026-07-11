"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  VIEWPORTS,
  findClosingBodyIndex,
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
const screenshot = process.argv.find((arg) => arg.startsWith("--screenshot="));
const pdf = process.argv.find((arg) => arg.startsWith("--print-to-pdf="));
const dump = process.argv.includes("--dump-dom");
if (dump) {
  const probePath = new URL(process.argv[process.argv.length - 1]);
  const probe = fs.readFileSync(probePath, "utf8");
  const markerId = probe.match(/marker[.]id="([^"]+)"/)[1];
  const width = Number(process.argv.find((arg) => arg.startsWith("--window-size=")).split("=")[1].split(",")[0]);
  const metrics = {innerWidth:width,clientWidth:width-15,scrollWidth:width-15,documentHeight:2400,bodyText:500,mainVisible:true,h1Visible:true,anchorCount:4,horizontalOverflow:false};
  process.stdout.write('<html><head><meta id="' + markerId + '" data-json="' + encodeURIComponent(JSON.stringify(metrics)) + '"></head></html>');
}
if (screenshot) {
  const size = process.argv.find((arg) => arg.startsWith("--window-size=")).split("=")[1].split(",").map(Number);
  const bytes = Buffer.alloc(2048);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  Buffer.from("IHDR").copy(bytes, 12);
  bytes.writeUInt32BE(size[0], 16);
  bytes.writeUInt32BE(size[1], 20);
  fs.writeFileSync(screenshot.slice("--screenshot=".length), bytes);
}
if (pdf) {
  const bytes = Buffer.alloc(2048, 32);
  Buffer.from("%PDF-1.4\\n1 0 obj <</Type /Page>>\\n%%EOF\\n").copy(bytes);
  fs.writeFileSync(pdf.slice("--print-to-pdf=".length), bytes);
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
        .replace("bytes.writeUInt32BE(size[0], 16)", "bytes.writeUInt32BE(1, 16)")
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

test("render probe finds the body close outside JSON raw text and trailing comments", () => {
  const html =
    '<html><head><script type="application/json">{"title":"Explain </body>"}</script></head><body><main>x</main></body><!-- </body> --></html>';
  assert.equal(findClosingBodyIndex(html), html.indexOf("</body><!--"));
});
