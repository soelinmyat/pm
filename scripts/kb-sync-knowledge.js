"use strict";

// Transport is injected from an already authorized session. This module never
// discovers credentials, changes PM configuration, or grants execution authority.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { plan, verify } = require("./kb-migration-plan.js");
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const shared = new Set([
  "record",
  "context-document",
  "document-artifact",
  "document-sidecar",
  "historical-approval",
  "artifact-asset",
  "document-attachment",
]);

function safePath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("pm/") ||
    value.includes("\\") ||
    Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
    ) ||
    value.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Unsafe remote knowledge path");
  return value;
}

function validated(data, expectedPath, expectedRevision) {
  if (
    !data ||
    data.path !== expectedPath ||
    !Number.isInteger(data.revision) ||
    data.revision < 1 ||
    (expectedRevision !== undefined && data.revision !== expectedRevision)
  )
    throw new Error("Knowledge identity/revision mismatch");
  safePath(data.path);
  if (
    !shared.has(data.category) ||
    !data.source_metadata ||
    typeof data.source_metadata !== "object" ||
    Array.isArray(data.source_metadata)
  )
    throw new Error("Invalid knowledge metadata");
  if (typeof data.content_base64 !== "string") throw new Error("Missing exact content");
  const bytes = Buffer.from(data.content_base64, "base64");
  if (
    bytes.toString("base64") !== data.content_base64 ||
    hash(bytes) !== data.content_hash ||
    bytes.length !== data.byte_size
  )
    throw new Error("Knowledge byte/hash mismatch");
  return bytes;
}

function same(left, right) {
  const canonical = (value) => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])])
      );
    return value;
  };
  return (
    left.content_hash === right.content_hash &&
    left.category === right.category &&
    JSON.stringify(canonical(left.source_metadata)) ===
      JSON.stringify(canonical(right.source_metadata))
  );
}

function identityFor(transport) {
  const identity = transport.identity;
  if (!identity || typeof identity.project !== "string" || !identity.project)
    throw new Error("Explicit project binding required");
  const url = new URL(identity.service);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Safe HTTPS service origin required");
  return { service: url.origin, project: identity.project };
}

async function push({ manifest, transport, cache }) {
  const identity = identityFor(transport);
  if (cache && JSON.stringify(cache.identity) !== JSON.stringify(identity))
    throw new Error("Cache project/service binding mismatch");
  const previous = cache ? cache.files : {};
  if (!previous || typeof previous !== "object" || Array.isArray(previous))
    throw new Error("Invalid cache");
  if (!verify(manifest).verified) throw new Error("Source drift; approve a new snapshot");
  const fresh = plan(manifest.source_root, manifest.source_aliases || []);
  if (JSON.stringify(fresh.files) !== JSON.stringify(manifest.files))
    throw new Error("Source metadata drift");
  const result = {
    uploaded: [],
    unchanged: [],
    conflicts: [],
    local_only: [],
    cache: { identity, files: { ...previous } },
    execution_authority: false,
  };
  for (const file of manifest.files) {
    if (!shared.has(file.category)) {
      result.local_only.push(file.path);
      continue;
    }
    safePath(file.path);
    const bytes = fs.readFileSync(path.join(manifest.source_root, file.path));
    if (hash(bytes) !== file.sha256) throw new Error("Source drift during read");
    const input = {
      path: file.path,
      category: file.category,
      content_hash: file.sha256,
      content_base64: bytes.toString("base64"),
      source_metadata: { source_file: file, authority: "historical-source-only" },
    };
    const remote = await transport.get(file.path);
    if (remote) validated(remote, file.path);
    if (remote && same(remote, input)) {
      result.unchanged.push(file.path);
      result.cache.files[file.path] = {
        revision: remote.revision,
        content_hash: remote.content_hash,
      };
      continue;
    }
    const base = previous[file.path];
    if (
      remote &&
      (!base || base.revision !== remote.revision || base.content_hash !== remote.content_hash)
    ) {
      result.conflicts.push({
        path: file.path,
        reason: "remote_changed_or_unbound",
        remote_revision: remote.revision,
      });
      continue;
    }
    if (!remote && base) {
      result.conflicts.push({ path: file.path, reason: "remote_missing" });
      continue;
    }
    let response;
    try {
      response = await transport.put({ ...input, if_revision: remote ? remote.revision : 0 });
    } catch (error) {
      if (error.status !== 409 && error.status !== 428) throw error;
      result.conflicts.push({ path: file.path, reason: "conditional_write_failed" });
      continue;
    }
    const exported = await transport.get(file.path, response.revision);
    validated(exported, file.path, response.revision);
    if (!same(exported, input)) throw new Error("Export reconciliation failed");
    result.uploaded.push(file.path);
    result.cache.files[file.path] = {
      revision: exported.revision,
      content_hash: exported.content_hash,
    };
  }
  return result;
}

// All historical revisions, returned in memory for a caller-owned private export.
// Never hydrate legacy approval files into an active execution workspace.
async function inventory(transport) {
  const rows = [],
    seen = new Set(),
    cursors = new Set();
  let cursor;
  do {
    const page = await transport.list(cursor);
    if (!Array.isArray(page.files)) throw new Error("Invalid knowledge listing");
    for (const row of page.files) {
      safePath(row.path);
      if (seen.has(row.path)) throw new Error("Duplicate knowledge path");
      if (!Number.isInteger(row.revision) || row.revision < 1)
        throw new Error("Invalid revision count");
      seen.add(row.path);
      rows.push({ path: row.path, revision: row.revision, content_hash: row.content_hash });
    }
    cursor = page.next_cursor;
    if (cursor && cursors.has(cursor)) throw new Error("Repeated listing cursor");
    cursors.add(cursor);
  } while (cursor);
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

async function exportHistory(transport) {
  const identity = identityFor(transport),
    before = await inventory(transport),
    files = [];
  for (const row of before) {
    const revisions = [];
    for (let revision = 1; revision <= row.revision; revision++) {
      const data = await transport.get(row.path, revision);
      validated(data, row.path, revision);
      revisions.push(data);
    }
    if (row.content_hash !== revisions.at(-1).content_hash)
      throw new Error("Listing changed during export");
    files.push({ path: row.path, revisions });
  }
  if (JSON.stringify(before) !== JSON.stringify(await inventory(transport)))
    throw new Error("Inventory changed during export; freeze writers and retry");
  return { schema_version: 1, identity, files, execution_authority: false };
}

module.exports = { push, exportHistory, validated };
