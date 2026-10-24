"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const BASE = ".pm/dev-sessions/pdf-review/design-critique/runs/dc_pdf/round-1/round-1/document-r1";
function hash(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function pdfFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pdf-capture-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-b", "main");
  git("config", "user.name", "PDF fixture");
  git("config", "user.email", "pdf-fixture@example.test");
  fs.writeFileSync(path.join(root, ".gitignore"), ".pm/\n");
  git("add", ".gitignore");
  git("commit", "-m", "Fixture baseline");
  const commit = git("rev-parse", "HEAD");
  const pdf = submittedPdf(["First submitted page", "Second submitted page"]);
  fs.mkdirSync(path.join(root, ".pm/input"), { recursive: true });
  fs.writeFileSync(path.join(root, ".pm/input/report.pdf"), pdf);
  const route = {
    schema_version: 2,
    run_id: "dc_pdf",
    created_at: new Date().toISOString(),
    mode: "pm-artifact",
    source: {
      commit,
      base_ref: "origin/main",
      base_commit: commit,
      diff_sha256: hash(Buffer.alloc(0)),
    },
    subjects: [
      {
        id: "submitted-report",
        title: "Submitted report",
        surface: ".pm/input/report.pdf",
        platform: "document",
        artifact: {
          path: ".pm/input/report.pdf",
          sha256: hash(pdf),
          kind: "report",
          format: "pdf",
        },
      },
    ],
    coverage: [
      {
        id: "report-print",
        subject_id: "submitted-report",
        state: "print",
        viewport: "print",
        required: true,
        reason: "Complete submitted report at its fixed paper size.",
      },
    ],
  };
  const routePath = ".pm/dev-sessions/pdf-review/design-critique/runs/dc_pdf/round-1/route.json";
  fs.mkdirSync(path.dirname(path.join(root, routePath)), { recursive: true });
  fs.writeFileSync(path.join(root, routePath), JSON.stringify(route));
  const args = [
    "--root",
    root,
    "--route",
    routePath,
    "--subject",
    "submitted-report",
    "--coverage",
    "report-print",
    "--capture",
    "document-r1",
    "--pdf",
    ".pm/input/report.pdf",
    "--out-dir",
    BASE,
    "--json",
  ];
  return { root, route, routePath, args, pdf };
}

function submittedPdf(texts, catalog = "", graphics = "") {
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${catalog} >>`,
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pages = [];
  for (const text of texts) {
    const page = objects.length + 1;
    const stream = `${graphics}BT /F1 24 Tf 72 720 Td (${text}) Tj ET\n`;
    pages.push(`${page} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages.join(" ")}] >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  pdf += `%${"fixture padding ".repeat(90)}\n`;
  const start = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

module.exports = { pdfFixture, submittedPdf };
