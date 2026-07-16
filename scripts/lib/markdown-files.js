"use strict";

const fs = require("node:fs");
const path = require("node:path");

function walkMarkdownFiles(dirPath, files = []) {
  if (!fs.existsSync(dirPath)) return files;

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) walkMarkdownFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(entryPath);
  }

  return files;
}

module.exports = { walkMarkdownFiles };
