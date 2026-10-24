#!/usr/bin/env node
"use strict";

const { loadPdfCapture, normalizePdfAudit } = require("./lib/design-critique-pdf");
const { writeProjectJsonAtomic } = require("./lib/project-file");

function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = { "--root": "root", "--capture": "capture", "--out": "out" }[argv[index]];
    if (!key || !argv[index + 1] || argv[index + 1].startsWith("--"))
      throw new Error("PDF audit requires --root, --capture and --out values");
    if (Object.hasOwn(options, key)) throw new Error(`duplicate PDF audit argument ${argv[index]}`);
    options[key] = argv[++index];
  }
  if (!options.capture || !options.out) throw new Error("PDF audit requires --capture and --out");
  const root = options.root || ".";
  const loaded = loadPdfCapture(root, options.capture);
  const audit = normalizePdfAudit(loaded.manifest, loaded.raw);
  writeProjectJsonAtomic(root, options.out, audit, { replace: false, fileMode: 0o600 });
  process.stdout.write(
    `${JSON.stringify({ ok: true, output: options.out, capture_ids: audit.capture_ids })}\n`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
