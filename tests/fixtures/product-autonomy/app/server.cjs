"use strict";
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path");
const root = __dirname,
  port = Number(process.env.PM_PREVIEW_PORT || process.env.PORT || 4175);
const types = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
};
http
  .createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    const fixtureRoot = process.env.PM_PREVIEW_FIXTURES
      ? path.resolve(root, process.env.PM_PREVIEW_FIXTURES)
      : null;
    const file =
      pathname === "/preview-data/jobs.json" && fixtureRoot
        ? path.resolve(fixtureRoot, "jobs.json")
        : path.resolve(root, "." + (pathname === "/" ? "/index.html" : pathname));
    if (!file.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(file, (e, b) => {
      if (e) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": types[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(b);
    });
  })
  .listen(port, "127.0.0.1", () =>
    process.stdout.write(`Pilot listening http://127.0.0.1:${port}\n`)
  );
