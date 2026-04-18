"use strict";

/**
 * Stub for the filesystem boundary. Backed by an in-memory file map so that
 * assertions can seed exact file contents without touching the real disk.
 *
 * @param {Record<string, string>} files  path -> string contents. Keys use
 *   forward-slash-separated paths; prefix matching drives readdir().
 *
 * @returns {{
 *   readFile(p: string): string,
 *   readdir(p: string): string[],
 *   exists(p: string): boolean,
 * }}
 */
function createFsStub(files) {
  const map = Object.assign({}, files || {});
  return {
    readFile(p) {
      if (!(p in map)) {
        throw new Error(`fs stub: no such file ${p}`);
      }
      return map[p];
    },
    readdir(p) {
      const prefix = p.endsWith("/") ? p : p + "/";
      const out = new Set();
      for (const key of Object.keys(map)) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        if (!remainder) continue;
        const firstSegment = remainder.split("/")[0];
        out.add(firstSegment);
      }
      return Array.from(out).sort();
    },
    exists(p) {
      return p in map;
    },
  };
}

module.exports = { createFsStub };
