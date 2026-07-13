"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  MAX_HTML_BYTES,
  inspectHtmlArtifact,
  parseArtifactMetadata,
  validateMetadata,
} = require("../scripts/artifact-check");
const CLI = path.join(__dirname, "..", "scripts", "artifact-check.js");
const PLUGIN_ROOT = path.join(__dirname, "..");
const SCHEMA = path.join(PLUGIN_ROOT, "references", "artifacts", "html-artifact.schema.json");

let Ajv2020;
let addFormats;
try {
  Ajv2020 = require("ajv/dist/2020");
  addFormats = require("ajv-formats");
} catch {
  // Source-only checkouts can run the deterministic validator without npm install.
}

function metadata(overrides = {}) {
  return {
    schema_version: 1,
    id: "proposal:example",
    kind: "proposal",
    slug: "example",
    lifecycle: "draft",
    title: "Example proposal",
    generated_at: "2026-07-12T03:00:00Z",
    generator: { name: "pm:groom", version: "1.13.11" },
    source: { path: "pm/backlog/example.md", sha256: null },
    evidence: [],
    ...overrides,
  };
}

function html(overrides = {}) {
  const meta = JSON.stringify(overrides.metadata || metadata());
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Example proposal</title>
<script id="pm-artifact" type="application/json">${meta}</script>
<style>
.skip-link:focus{position:fixed;top:0} :focus-visible{outline:2px solid currentColor} @media (max-width: 700px){main{padding:1rem}} @media (prefers-reduced-motion: reduce){*{scroll-behavior:auto}} @media print{nav{display:none}*{overflow:visible!important}}
</style></head><body><a class="skip-link" href="#content">Skip to content</a><nav aria-label="Document"><a href="#section">Section</a></nav><main id="content"><h1>Example proposal</h1><section id="section"><h2>Section</h2><p>Status: Draft</p></section></main></body></html>`;
}

test("artifact checker accepts a safe, accessible, offline document", () => {
  const result = inspectHtmlArtifact(Buffer.from(html()), { expectedKind: "proposal" });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.metadata.slug, "example");
  assert.match(result.sha256, /^sha256:[0-9a-f]{64}$/);
});

test("artifact checker treats script-like text inside JSON metadata as raw text", () => {
  const result = inspectHtmlArtifact(
    Buffer.from(html({ metadata: metadata({ title: "Document <script> behavior" }) })),
    { expectedKind: "proposal" }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("artifact checker rejects active/network content and inline handlers", () => {
  for (const unsafe of [
    '<script src="https://cdn.example/x.js"></script>',
    '<link rel="stylesheet" href="https://cdn.example/x.css">',
    '<img src="https://cdn.example/x.png" alt="x">',
    '<div onclick="alert(1)">x</div>',
    "<script>alert(1)</script>",
    "<style>.x{background:url(https://cdn.example/x.png)}</style>",
    '<link rel="icon" href="https://cdn.example/favicon.png">',
    '<img srcset="https://cdn.example/x.png 2x" alt="x">',
    '<iframe src="data:text/html,hello"></iframe>',
    '<object data="https://cdn.example/file.pdf"></object>',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<a href="javascript:alert(1)">Run</a>',
    '<form action="https://example.com"><input name="secret"></form>',
    '<div style="background:url(../local.png)">Local dependency</div>',
    '<div style="background:url(file:///tmp/private.png)">File dependency</div>',
    '<svg aria-label="Unsafe"><image href="../secret.png"></image></svg>',
    '<svg aria-label="Unsafe"><feImage xlink:href="https://example.com/x.png"></feImage></svg>',
    '<svg aria-label="Unsafe"><use href="../icons.svg#x"></use></svg>',
    "<img src=https://cdn.example/x.png alt=x>",
    "<video poster=../poster.png></video>",
    "<svg aria-label=x><image href=../secret.png></image></svg>",
    "<svg aria-label=x><use href=../icons.svg#x></use></svg>",
    '<img alt=x title=">" src=https://cdn.example/x.png>',
    '<video title=">" poster=../poster.png></video>',
    '<div title=">" style=background:url(../local.png)>Hidden attribute</div>',
    '<svg aria-label=x><image title=">" href=../secret.png></image></svg>',
    '<svg aria-label=x><use title=">" href=../icons.svg#x></use></svg>',
  ]) {
    const result = inspectHtmlArtifact(Buffer.from(html().replace("</body>", `${unsafe}</body>`)), {
      expectedKind: "proposal",
    });
    assert.equal(result.ok, false, unsafe);
    assert.match(
      result.issues.map((entry) => entry.message).join("\n"),
      /offline|script|handler|refresh|link scheme|form controls|CSS URL|SVG resource|media source|poster|source sets|linked assets/i
    );
  }
});

test("artifact checker rejects malformed scripts and schema-divergent evidence", () => {
  const malformed = inspectHtmlArtifact(
    Buffer.from(html().replace("</body>", "<script>alert(1)</body>")),
    { expectedKind: "proposal" }
  );
  assert.equal(malformed.ok, false);
  assert.match(malformed.issues.map((entry) => entry.message).join("\n"), /well-formed closed/);

  const badEvidence = metadata({
    evidence: [{ path: "evidence.md", sha256: `sha256:${"a".repeat(64)}`, extra: true }],
  });
  const divergent = inspectHtmlArtifact(Buffer.from(html({ metadata: badEvidence })), {
    expectedKind: "proposal",
  });
  assert.equal(divergent.ok, false);
  assert.match(divergent.issues.map((entry) => entry.path).join("\n"), /evidence\[0\]/);
});

test("artifact checker rejects duplicate IDs and broken internal anchors", () => {
  const changed = html()
    .replace('<section id="section">', '<section id="content">')
    .replace('href="#section"', 'href="#missing"');
  const result = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /duplicate id content/);
  assert.match(result.issues.map((entry) => entry.message).join("\n"), /missing anchor target/);
});

test("artifact checker ignores fake landmarks and anchors inside comments", () => {
  const changed = html()
    .replace('<main id="content"><h1>Example proposal</h1>', "<div><p>Example proposal</p>")
    .replace("</main>", "</div>")
    .replace("</body>", '<!-- <main id="content"><h1>Fake</h1></main> --></body>');
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /exactly one h1/);
  assert.match(messages, /exactly one main landmark/);
  assert.match(messages, /missing anchor target content/);
});

test("artifact checker ignores fake landmarks inside title RCDATA", () => {
  const changed = html()
    .replace("<title>Example proposal</title>", "<title>Example <main><h1>Fake</h1></main></title>")
    .replace(
      '<main id="content"><h1>Example proposal</h1>',
      '<div id="content"><p>Example proposal</p>'
    )
    .replace("</main>", "</div>");
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /exactly one h1/);
  assert.match(messages, /exactly one main landmark/);
});

test("artifact checker does not treat raw-text closing-tag prefixes as real closes", () => {
  const changed = html()
    .replace(
      "<title>Example proposal</title>",
      "<title>Example </titlecase><main><h1>Fake</h1></main></title>"
    )
    .replace(
      '<main id="content"><h1>Example proposal</h1>',
      '<div id="content"><p>Example proposal</p>'
    )
    .replace("</main>", "</div>");
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /exactly one h1/);
  assert.match(messages, /exactly one main landmark/);
});

test("artifact checker consumes tolerated closing-tag attributes quote-aware", () => {
  const changed = html()
    .replace(
      "<title>Example proposal</title>",
      '<title>Example </title data-x="><main><h1>Fake</h1></main>">'
    )
    .replace(
      '<main id="content"><h1>Example proposal</h1>',
      '<div id="content"><p>Example proposal</p>'
    )
    .replace("</main>", "</div>");
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /exactly one h1/);
  assert.match(messages, /exactly one main landmark/);
});

test("artifact checker rejects empty anchors and unrendered Mermaid source", () => {
  const changed = html().replace(
    "</main>",
    '<a href="#">Nowhere</a><pre class="mermaid">graph LR; A--&gt;B</pre></main>'
  );
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  assert.match(messages, /empty internal anchor/);
  assert.match(messages, /unrendered Mermaid/);
});

test("artifact checker requires accessibility, responsive, reduced-motion, and print primitives", () => {
  const changed = html()
    .replace('lang="en"', "")
    .replace('<a class="skip-link" href="#content">Skip to content</a>', "")
    .replace(' aria-label="Document"', "")
    .replace("@media (max-width: 700px){main{padding:1rem}}", "")
    .replace("@media (prefers-reduced-motion: reduce){*{scroll-behavior:auto}}", "")
    .replace("@media print{nav{display:none}*{overflow:visible!important}}", "")
    .replace(":focus-visible{outline:2px solid currentColor}", "");
  const messages = inspectHtmlArtifact(Buffer.from(changed), { expectedKind: "proposal" })
    .issues.map((entry) => entry.message)
    .join("\n");
  for (const expected of [
    "language",
    "skip link",
    "labeled navigation",
    "narrow-screen",
    "reduced-motion",
    "print rules",
    "focus-visible",
  ]) {
    assert.match(messages, new RegExp(expected));
  }
});

test("artifact checker enforces metadata count, schema, kind, and size budget", () => {
  assert.throws(() => parseArtifactMetadata("<html></html>"), /exactly one/);
  const bad = inspectHtmlArtifact(Buffer.from(html({ metadata: metadata({ kind: "rfc" }) })), {
    expectedKind: "proposal",
  });
  assert.equal(bad.ok, false);
  assert.match(bad.issues.map((entry) => entry.message).join("\n"), /kind must equal proposal/);
  const oversized = inspectHtmlArtifact(Buffer.alloc(MAX_HTML_BYTES + 1, 32));
  assert.equal(oversized.ok, false);
  assert.match(oversized.issues[0].message, /size budget/);
});

test("artifact checker CLI writes a hash-bound manifest atomically", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-artifact-check-"));
  try {
    const htmlPath = path.join(dir, "example.html");
    const manifestPath = path.join(dir, "example.manifest.json");
    fs.writeFileSync(htmlPath, html());
    const result = spawnSync(
      process.execPath,
      [CLI, "--html", htmlPath, "--kind", "proposal", "--manifest", manifestPath, "--json"],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.artifact.kind, "proposal");
    assert.match(manifest.artifact.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(manifest.checks.offline, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const [label, kind, relativePath] of [
  ["proposal", "proposal", "references/templates/proposal-reference.html"],
  ["rfc", "rfc", "references/templates/rfc-reference.html"],
  ["design critique report", "report", "references/templates/design-critique-report.html"],
  ["review report", "report", "references/templates/review-report.html"],
]) {
  test(`reference ${label} template satisfies the shared artifact contract`, () => {
    const result = spawnSync(
      process.execPath,
      [CLI, "--html", path.join(PLUGIN_ROOT, relativePath), "--kind", kind, "--template", "--json"],
      { encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ok, true);
  });
}

test(
  "published metadata schema accepts canonical metadata",
  { skip: !Ajv2020 && "Ajv is not installed" },
  () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, "utf8")));
    assert.equal(validate(metadata()), true, JSON.stringify(validate.errors, null, 2));
  }
);

test(
  "published metadata schema and runtime reject the same malformed metadata",
  { skip: !Ajv2020 && "Ajv is not installed" },
  () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, "utf8")));
    const cases = [
      metadata({ generated_at: "2026-02-30T00:00:00Z" }),
      metadata({ generator: { name: "pm:groom", version: "1", extra: true } }),
      metadata({ source: { path: "proposal.md" } }),
      metadata({
        evidence: [{ path: "evidence.md", sha256: `sha256:${"a".repeat(64)}`, extra: true }],
      }),
    ];
    for (const candidate of cases) {
      assert.equal(validate(candidate), false, JSON.stringify(candidate));
      const issues = [];
      validateMetadata(candidate, "proposal", issues);
      assert.ok(issues.length > 0, JSON.stringify(candidate));
    }
  }
);
