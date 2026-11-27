"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { execFileSync, spawnSync } = require("node:child_process");

const { pathPatternMatcher } = require("../scripts/lib/dev-work-units");
const { decodePngRgba } = require("../scripts/lib/media-inspect");
const {
  ALLOWED_RAW_VALUES,
  CHECKS_PATH,
  checkNeighbours,
  checkScope,
  compareImages,
  isUiFile,
  parseAddedLines,
  readChecks,
  scanTokens,
  sessionSurfaces,
  runMechanicalChecks,
} = require("../scripts/lib/design-director-mechanical");

const CLI = path.join(__dirname, "..", "scripts", "design-director-mechanical.js");
const SURFACES = [
  { name: "Invoice list", paths: ["apps/web/src/invoices/list/**"] },
  { name: "Invoice filter bar", paths: ["apps/web/src/invoices/filter-bar.tsx"] },
];

function crcTable() {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table.push(c >>> 0);
  }
  return table;
}
const CRC = crcTable();
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// An RGBA PNG whose pixels come from pixelAt(x, y). The noise keeps it above the
// decoder's minimum size; the level changes the bytes without changing pixels.
function rgbaPng(width, height, pixelAt, level = 6) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const offset = y * (width * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = pixelAt(x, y);
      rows[offset] = r;
      rows[offset + 1] = g;
      rows[offset + 2] = b;
      rows[offset + 3] = a;
    }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows, { level })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const noise = (x, y) => [(x * 37 + y * 101) & 0xff, (x * 11 + y * 7) & 0xff, (x ^ y) & 0xff, 255];

test("surface patterns reuse the work-unit ownership matcher", () => {
  const list = pathPatternMatcher("apps/web/src/invoices/list/**");
  assert.equal(list("apps/web/src/invoices/list/table.tsx"), true);
  assert.equal(list("apps/web/src/invoices/detail.tsx"), false);
  const plain = pathPatternMatcher("./apps/web/src/invoices/");
  assert.equal(plain("apps/web/src/invoices/list/table.tsx"), true);
  assert.equal(plain("apps/web/src/invoicesx/a.tsx"), false);
});

test("UI files are markup, styles and code under UI directories, minus tests, data and docs", () => {
  for (const file of [
    "apps/web/src/invoices/list/table.tsx",
    "src/styles/app.css",
    "app/views/orders/index.html.erb",
    "src/components/button.ts",
    "ios/App/Screens/OrderScreen.swift",
    "ios/App/Base.lproj/Main.storyboard",
  ])
    assert.equal(isUiFile(file), true, file);
  for (const file of [
    "apps/api/src/orders.ts",
    "src/lib/format.js",
    "src/components/button.test.tsx",
    "src/components/__tests__/button.tsx",
    "src/components/button.stories.tsx",
    "test/fixtures/orders.tsx",
    "db/seeds/orders.rb",
    "docs/ui.md",
    "src/components/README.md",
    ".pm/dev-sessions/x/session.json",
    "public/icons/check.svg",
    "dist/app.css",
    "src/pages/api/orders.ts",
  ])
    assert.equal(isUiFile(file), false, file);
  const config = { include: ["app/models/presenters/**"], exclude: ["**/*.email.erb"] };
  assert.equal(isUiFile("app/models/presenters/card.rb", config), true);
  assert.equal(isUiFile("app/views/mailer/welcome.email.erb", config), false);
});

test("the scope check reports UI files outside every declared surface", () => {
  const changed = [
    "apps/web/src/invoices/list/table.tsx",
    "apps/web/src/invoices/filter-bar.tsx",
    "apps/web/src/settings/page.tsx",
    "apps/api/src/invoices.ts",
    "apps/web/src/invoices/list/table.test.tsx",
  ];
  const failed = checkScope({ changedFiles: changed, surfaces: SURFACES });
  assert.equal(failed.status, "fail");
  assert.deepEqual(
    failed.outside.map((entry) => entry.file),
    ["apps/web/src/settings/page.tsx"]
  );
  assert.equal(failed.ui_files, 4 - 1);

  const explained = checkScope({
    changedFiles: changed,
    surfaces: SURFACES,
    dispositions: [
      {
        check: "scope",
        file: "apps/web/src/settings/**",
        kind: "decision",
        ref: "visual_invariants[2]: the settings link moves beside the filter",
      },
    ],
  });
  assert.equal(explained.status, "pass");
  assert.equal(explained.outside[0].disposition.kind, "decision");

  const none = checkScope({ changedFiles: changed, surfaces: [] });
  assert.equal(none.status, "no-surfaces");
  assert.deepEqual(none.outside, []);
});

test("the token detector flags raw colours and pixels on added lines only", () => {
  const diff = [
    "@@ -1,2 +1,12 @@",
    " .card { color: #123456; }",
    "-.old { margin: 13px; }",
    "+.card { color: #1a2b3c; padding: 12px; }",
    "+.row { background: rgba(0, 0, 0, 0.5); border: 1px solid var(--border); }",
    "+.chip { color: hsl(210 40% 50%); margin: 0px; width: 100%; }",
    "+.ok { color: rgb(var(--brand)); }",
    "+  --space-3: 12px;",
    "+  --brand: #0055ff;",
    "+@media (min-width: 768px) { .card { display: grid; } }",
    "+/* was #ffffff and 14px */",
    '+<a href="#top">it&#039;s</a>',
    '+<div className="p-[13px] bg-[#fafafa]" />',
    "+const fading = this.#fade;",
  ].join("\n");
  const lines = parseAddedLines(diff);
  assert.equal(lines[0].line, 2);
  const result = scanTokens({ addedLines: { "src/components/card.tsx": lines } });
  assert.equal(result.status, "fail");
  assert.deepEqual(
    result.hits.map((hit) => [hit.line, hit.value]),
    [
      [2, "#1a2b3c"],
      [2, "12px"],
      [3, "rgba(0, 0, 0, 0.5)"],
      [4, "hsl(210 40% 50%)"],
      [11, "13px"],
      [11, "#fafafa"],
    ]
  );
  assert.ok(ALLOWED_RAW_VALUES.includes("1px"));
  assert.ok(ALLOWED_RAW_VALUES.includes("0px"));
});

test("the token detector skips tests, fixtures, SVG, generated and token files", () => {
  const added = [{ line: 1, text: "color: #ff0000; padding: 12px;" }];
  const result = scanTokens({
    addedLines: {
      "src/components/card.test.tsx": added,
      "test/fixtures/card.tsx": added,
      "public/logo.svg": added,
      "dist/app.css": added,
      "src/styles/tokens.css": added,
      "src/theme/colors.ts": added,
      "apps/api/src/colors.ts": added,
    },
  });
  assert.equal(result.status, "pass");
  assert.equal(result.scanned_files, 0);
});

test("token hits clear with a disposition citing a token, component or decision", () => {
  const added = [
    { line: 4, text: "box-shadow: 0 0 0 3px #1a2b3c;" },
    { line: 9, text: "height: 44px;" },
  ];
  const result = scanTokens({
    addedLines: { "src/components/card.css": added },
    dispositions: [
      {
        check: "tokens",
        file: "src/components/card.css",
        value: "#1A2B3C",
        kind: "token",
        ref: "--focus-ring, which has no CSS variable yet",
      },
      { check: "tokens", file: "src/components/**", value: "3px", kind: "component", ref: "Ring" },
    ],
  });
  assert.equal(result.status, "fail");
  assert.deepEqual(
    result.hits.filter((hit) => !hit.disposition).map((hit) => hit.value),
    ["44px"]
  );
  const all = scanTokens({
    addedLines: { "src/components/card.css": added },
    dispositions: [
      { check: "tokens", file: "src/components/**", kind: "decision", ref: "no token system" },
    ],
  });
  assert.equal(all.status, "pass");
});

test("image comparison reads pixels, so recompressed screenshots are unchanged", () => {
  const before = rgbaPng(24, 24, noise, 9);
  assert.equal(compareImages(before, Buffer.from(before)).result, "identical");
  const recompressed = rgbaPng(24, 24, noise, 0);
  assert.notDeepEqual(recompressed, before);
  const same = compareImages(before, recompressed);
  assert.equal(same.result, "identical");
  assert.equal(same.method, "pixels");

  const changed = rgbaPng(24, 24, (x, y) => (x < 4 && y < 2 ? [255, 0, 0, 255] : noise(x, y)));
  const differs = compareImages(before, changed);
  assert.equal(differs.result, "differs");
  assert.equal(differs.method, "pixels");
  assert.equal(differs.changed_pixels, 8);
  assert.equal(differs.total_pixels, 24 * 24);
  assert.deepEqual(differs.bounds, { x: 0, y: 0, width: 4, height: 2 });

  const resized = compareImages(before, rgbaPng(24, 25, noise));
  assert.equal(resized.result, "differs");
  assert.match(resized.reason, /24x24.*24x25/);

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000, 1)]);
  const other = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2000, 2)]);
  const bytes = compareImages(jpeg, other);
  assert.equal(bytes.result, "differs");
  assert.equal(bytes.method, "bytes");
  assert.equal(decodePngRgba(before).width, 24);
});

function neighbourDir(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-mechanical-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = ".pm/dev-sessions/unit/design-critique/mechanical";
  fs.mkdirSync(path.join(root, dir, "neighbours"), { recursive: true });
  const put = (name, bytes) => fs.writeFileSync(path.join(root, dir, "neighbours", name), bytes);
  return { root, dir, put };
}

test("a changed neighbour inside a declared surface is input; outside it fails until explained", (t) => {
  const { root, dir, put } = neighbourDir(t);
  const before = rgbaPng(16, 16, noise);
  const after = rgbaPng(16, 16, (x, y) => (x === 0 && y === 0 ? [9, 9, 9, 255] : noise(x, y)));
  put("list-before.png", before);
  put("list-after.png", after);
  put("settings-before.png", before);
  put("settings-after.png", after);
  put("billing-before.png", before);
  put("billing-after.png", before);
  const neighbours = [
    {
      screen: "Invoice list, many rows",
      surface: "Invoice list",
      before: "neighbours/list-before.png",
      after: "neighbours/list-after.png",
    },
    {
      screen: "Settings",
      before: "neighbours/settings-before.png",
      after: "neighbours/settings-after.png",
    },
    {
      screen: "Billing",
      before: "neighbours/billing-before.png",
      after: "neighbours/billing-after.png",
    },
  ];
  const surfaceNames = SURFACES.map((surface) => surface.name);
  const failed = checkNeighbours({ root, dir, neighbours, surfaceNames });
  assert.equal(failed.status, "fail");
  const [list, settings, billing] = failed.screens;
  assert.equal(list.comparison.result, "differs");
  assert.equal(list.blocking, false);
  assert.equal(settings.blocking, true);
  assert.equal(billing.comparison.result, "identical");

  const explained = checkNeighbours({
    root,
    dir,
    neighbours,
    surfaceNames,
    dispositions: [
      { check: "neighbours", screen: "Settings", kind: "component", ref: "Shared Toolbar" },
    ],
  });
  assert.equal(explained.status, "pass");

  fs.rmSync(path.join(root, dir, "neighbours", "billing-after.png"));
  const missing = checkNeighbours({ root, dir, neighbours: [neighbours[2]], surfaceNames });
  assert.equal(missing.status, "fail");
  assert.match(missing.screens[0].error, /cannot be read/);
  assert.equal(checkNeighbours({ root, dir, neighbours: [], surfaceNames }).status, "none");
});

test("the checks file is validated: dispositions cite a kind and paths stay in the folder", (t) => {
  const { root } = neighbourDir(t);
  assert.deepEqual(readChecks(root, "unit").config.dispositions, []);
  const file = path.join(root, ".pm/dev-sessions/unit", CHECKS_PATH);
  for (const [config, pattern] of [
    [{ dispositions: [{ check: "tokens", file: "a.css", kind: "looks fine", ref: "x" }] }, /kind/],
    [{ dispositions: [{ check: "tokens", file: "a.css", kind: "token", ref: " " }] }, /ref/],
    [{ dispositions: [{ check: "scope", file: "/etc/passwd", kind: "token", ref: "x" }] }, /repo/],
    [{ neighbours: [{ screen: "A", before: "../x.png", after: "a.png" }] }, /inside/],
    [{ ui_files: { include: ["../x"] } }, /repo/],
    [{ surprise: true }, /unknown field/],
  ]) {
    fs.writeFileSync(
      file,
      JSON.stringify({ schema: "design-director-mechanical", schema_version: 1, ...config })
    );
    assert.match(readChecks(root, "unit").issues.join("; "), pattern);
  }
});

test("surfaces are collected from the task and every work unit", () => {
  const session = {
    task: {
      design_context: { ui_impact: true, surfaces: [SURFACES[0]] },
      work_units: [
        { contract: { design_context: { ui_impact: true, surfaces: SURFACES } } },
        { contract: {} },
      ],
    },
  };
  assert.deepEqual(
    sessionSurfaces(session).map((surface) => surface.name),
    ["Invoice list", "Invoice filter bar"]
  );
  assert.deepEqual(sessionSurfaces({ task: { design_context: null, work_units: [] } }), []);
});

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function sessionRepo(t, { surfaces = SURFACES } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-mechanical-repo-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "Test User"]);
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  fs.mkdirSync(path.join(root, "apps/web/src/invoices/list"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/web/src/invoices/list/table.tsx"), "export {};\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "base"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-qb", "feat/unit"]);
  fs.writeFileSync(
    path.join(root, "apps/web/src/invoices/list/table.tsx"),
    'export const Table = () => <div style={{ color: "#ff0000" }} />;\n'
  );
  fs.mkdirSync(path.join(root, "apps/web/src/settings"), { recursive: true });
  fs.writeFileSync(path.join(root, "apps/web/src/settings/page.tsx"), "export {};\n");
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "feature"]);
  const session = {
    slug: "unit",
    source: {
      repo_root: root,
      worktree: root,
      branch: "feat/unit",
      default_branch: "main",
      base_commit: base,
      delivery_remote: "origin",
    },
    task: {
      design_context: surfaces ? { ui_impact: true, surfaces } : null,
      work_units: [],
    },
  };
  const sessionDir = path.join(root, ".pm/dev-sessions/unit");
  fs.mkdirSync(path.join(sessionDir, "design-critique/mechanical"), { recursive: true });
  const sessionPath = path.join(sessionDir, "session.json");
  fs.writeFileSync(sessionPath, JSON.stringify(session));
  return {
    root,
    base,
    session,
    sessionPath,
    head: () => git(root, ["rev-parse", "HEAD"]),
    writeChecks(config) {
      fs.writeFileSync(
        path.join(sessionDir, CHECKS_PATH),
        JSON.stringify({ schema: "design-director-mechanical", schema_version: 1, ...config })
      );
    },
    run: (args) => spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8" }),
  };
}

test("the full run diffs the session against its base and fails until every item is explained", (t) => {
  const repo = sessionRepo(t);
  const failed = runMechanicalChecks({
    root: repo.root,
    session: repo.session,
    commit: repo.head(),
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.enforced, true);
  assert.equal(failed.base, repo.base);
  assert.deepEqual(
    failed.scope.outside.map((entry) => entry.file),
    ["apps/web/src/settings/page.tsx"]
  );
  assert.deepEqual(
    failed.tokens.hits.map((hit) => hit.value),
    ["#ff0000"]
  );

  const cli = repo.run(["--session", repo.sessionPath, "--json"]);
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).ok, false);

  repo.writeChecks({
    dispositions: [
      { check: "scope", file: "apps/web/src/settings/page.tsx", kind: "decision", ref: "d-2" },
      { check: "tokens", file: "apps/web/src/invoices/**", kind: "token", ref: "--danger" },
    ],
  });
  const passed = repo.run(["--session", repo.sessionPath]);
  assert.equal(passed.status, 0, passed.stdout + passed.stderr);
  assert.match(passed.stdout, /Mechanical checks pass/);
});

test("without declared surfaces the run reports and never fails", (t) => {
  const repo = sessionRepo(t, { surfaces: null });
  const result = runMechanicalChecks({
    root: repo.root,
    session: repo.session,
    commit: repo.head(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.enforced, false);
  assert.equal(result.scope.status, "no-surfaces");
  assert.equal(result.tokens.status, "advisory");
  const cli = repo.run(["--session", repo.sessionPath]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, /no declared surfaces/);
});

test("the CLI exits 2 on bad arguments", (t) => {
  const repo = sessionRepo(t);
  assert.equal(repo.run([]).status, 2);
  assert.equal(repo.run(["--session", path.join(repo.root, "missing.json")]).status, 2);
  assert.equal(repo.run(["--session", repo.sessionPath, "--bogus"]).status, 2);
});

test("an invalid checks file only reports when the session declares no surfaces", (t) => {
  const reportOnly = sessionRepo(t, { surfaces: null });
  fs.writeFileSync(path.join(reportOnly.root, ".pm/dev-sessions/unit", CHECKS_PATH), "{ not json");
  const result = runMechanicalChecks({
    root: reportOnly.root,
    session: reportOnly.session,
    commit: reportOnly.head(),
  });
  assert.equal(result.enforced, false);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.equal(result.advisories.length, 1);
  assert.equal(result.advisories[0].check, "checks");
  const cli = reportOnly.run(["--session", reportOnly.sessionPath]);
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  assert.match(cli.stdout, /checks:/);

  // With declared surfaces the same file still fails the run.
  const enforced = sessionRepo(t);
  fs.writeFileSync(path.join(enforced.root, ".pm/dev-sessions/unit", CHECKS_PATH), "{ not json");
  const failed = runMechanicalChecks({
    root: enforced.root,
    session: enforced.session,
    commit: enforced.head(),
  });
  assert.equal(failed.ok, false);
  assert.ok(failed.issues.some((item) => item.check === "checks"));
});

test("added lines for every UI file come from one diff, split by file", () => {
  const { splitAddedLines } = require("../scripts/lib/design-director-mechanical");
  const diff = [
    "diff --git a/apps/web/a.tsx b/apps/web/a.tsx",
    "--- a/apps/web/a.tsx",
    "+++ b/apps/web/a.tsx",
    "@@ -1,0 +2,2 @@",
    "+one",
    "+two",
    "diff --git a/apps/web/b c.tsx b/apps/web/b c.tsx",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/apps/web/b c.tsx\t",
    "@@ -0,0 +1 @@",
    "+three",
    'diff --git "a/apps/web/caf\\303\\251.tsx" "b/apps/web/caf\\303\\251.tsx"',
    '--- "a/apps/web/caf\\303\\251.tsx"',
    '+++ "b/apps/web/caf\\303\\251.tsx"',
    "@@ -3 +3 @@",
    "-old",
    "+new",
    "diff --git a/apps/web/gone.tsx b/apps/web/gone.tsx",
    "deleted file mode 100644",
    "--- a/apps/web/gone.tsx",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-bye",
  ].join("\n");
  const files = ["apps/web/a.tsx", "apps/web/b c.tsx", "apps/web/café.tsx", "apps/web/gone.tsx"];
  const split = splitAddedLines(diff, files);
  assert.deepEqual(split.added, {
    "apps/web/a.tsx": [
      { line: 2, text: "one" },
      { line: 3, text: "two" },
    ],
    "apps/web/b c.tsx": [{ line: 1, text: "three" }],
    "apps/web/café.tsx": [{ line: 3, text: "new" }],
    "apps/web/gone.tsx": [],
  });
  assert.deepEqual(split.unmatched, []);
  // A header the parser cannot place is reported, so the caller can diff it alone.
  const odd = splitAddedLines("--- /dev/null\n+++ b/other.tsx\n@@ -0,0 +1 @@\n+x\n", [
    "apps/web/a.tsx",
  ]);
  assert.deepEqual(odd.unmatched, ["other.tsx"]);
});

test("an added line that starts with ++ is content, not a file header", () => {
  const { splitAddedLines } = require("../scripts/lib/design-director-mechanical");
  const diff = [
    "diff --git a/apps/web/a.tsx b/apps/web/a.tsx",
    "--- a/apps/web/a.tsx",
    "+++ b/apps/web/a.tsx",
    "@@ -0,0 +1,2 @@",
    "+++ counter",
    "+done",
  ].join("\n");
  const split = splitAddedLines(diff, ["apps/web/a.tsx"]);
  assert.deepEqual(split.unmatched, []);
  assert.equal(split.added["apps/web/a.tsx"].at(-1).text, "done");
});
