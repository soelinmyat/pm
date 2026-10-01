"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { plan, verify, validate } = require("./kb-migration-plan.js");
const { reconcile } = require("./kb-migration-reconcile.js");
const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");

function safeDestination(root) {
  root = path.resolve(root);
  let current = path.parse(root).root;
  for (const part of root.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        const alias = { "/tmp": "/private/tmp", "/var": "/private/var" }[current];
        if (!alias || fs.realpathSync(current) !== alias)
          throw new Error("Destination contains a symlink");
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  let existing = root;
  const tail = [];
  while (!fs.existsSync(existing)) {
    tail.unshift(path.basename(existing));
    existing = path.dirname(existing);
  }
  return path.join(fs.realpathSync(existing), ...tail);
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

function blockers(file, files) {
  const found = [];
  const visited = new Set();
  function visit(current) {
    if (visited.has(current.path)) return;
    visited.add(current.path);
    for (const ref of current.references) {
      if (
        [
          "missing",
          "absolute-local",
          "invalid-encoding",
          "unsupported-scheme",
          "sensitive-reference",
          "dynamic-reference",
          "code-repository-reference",
          "application-route",
        ].includes(ref.state)
      )
        found.push({
          from: current.path,
          target: ref.target,
          state: ref.state,
          disposition: "unresolved-retained; active-handoff-blocked",
        });
      else if (["resolved", "resolved-source-alias"].includes(ref.state) && files.has(ref.resolved))
        visit(files.get(ref.resolved));
    }
  }
  visit(file);
  return found;
}

function describe(project, manifests, canonicalSource) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project)) throw new Error("Invalid project namespace");
  const merged = reconcile(manifests, canonicalSource);
  const canonical = manifests.find((m) => m.source_root === canonicalSource);
  const canonicalFiles = new Map(canonical.files.map((f) => [f.path, f]));
  const allFiles = new Map(
    manifests.map((m) => [m.source_root, new Map(m.files.map((f) => [f.path, f]))])
  );
  const records = merged.files.map((entry) => {
    const file = canonicalFiles.get(entry.logical_path);
    const active =
      !!file &&
      file.source_type === "backlog" &&
      !["done", "canceled", "archived"].includes(file.source_status);
    const unresolved = file ? blockers(file, canonicalFiles) : [];
    const identity =
      file && file.category === "record" && file.source_id
        ? `record:${file.source_id}`
        : `file:${entry.logical_path}`;
    return {
      ...entry,
      stable_id: `pmig_${digest(`${project}\0${identity}`)}`,
      active_backlog: active,
      unresolved_dependencies: unresolved,
      active_handoff_blocked: active && unresolved.length > 0,
      transfer_scope: !file
        ? "archive-review"
        : ["local-runtime", "local-metadata", "local-control"].includes(file.category)
          ? "local-only"
          : "shared-candidate",
      versions: entry.variants.map((variant) => ({
        ...variant,
        sources: [...variant.sources].sort(),
        metadata: variant.sources
          .map((source) => ({ source, file: allFiles.get(source).get(entry.logical_path) }))
          .sort((a, b) => a.source.localeCompare(b.source)),
      })),
    };
  });
  const identities = new Set();
  for (const record of records) {
    if (identities.has(record.stable_id))
      throw new Error("Duplicate stable identity; resolve source IDs before bundling");
    identities.add(record.stable_id);
  }
  return records;
}

function build(project, manifests, canonicalSource, destination, supplements = []) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(project))
    throw new Error("Project namespace must be a lowercase slug");
  manifests = [...manifests].sort((a, b) => a.source_root.localeCompare(b.source_root));
  const merged = reconcile(manifests, canonicalSource);
  destination = safeDestination(destination);
  const roots = new Set();
  for (const manifest of manifests) {
    const source = safeDestination(manifest.source_root);
    if (roots.has(source)) throw new Error("Duplicate canonical source location");
    roots.add(source);
    if (within(source, destination) || within(destination, source))
      throw new Error("Bundle and source directories must be disjoint");
    if (!verify(manifest).verified)
      throw new Error("Source inventory drift; take a new approved snapshot");
    const fresh = plan(manifest.source_root, manifest.source_aliases || []);
    if (JSON.stringify(fresh.files) !== JSON.stringify(manifest.files))
      throw new Error("Source metadata differs from freshly parsed bytes");
  }
  const records = describe(project, manifests, canonicalSource);
  const supplementaryBytes = new Map();
  const supplementaryLabels = new Set();
  const supplementalIndex = [...supplements]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((entry) => {
      if (
        typeof entry.label !== "string" ||
        supplementaryLabels.has(entry.label) ||
        !/^[a-f0-9]{64}$/.test(entry.expected_sha256)
      )
        throw new Error("Invalid or duplicate supplementary metadata");
      supplementaryLabels.add(entry.label);
      safeDestination(entry.path);
      if (!fs.lstatSync(entry.path).isFile()) throw new Error("Supplement must be a regular file");
      const bytes = fs.readFileSync(entry.path);
      if (digest(bytes) !== entry.expected_sha256)
        throw new Error("Supplement changed since snapshot");
      supplementaryBytes.set(entry.expected_sha256, bytes);
      return {
        label: entry.label,
        sha256: entry.expected_sha256,
        bytes: bytes.length,
        transfer_scope: "local-only",
      };
    });
  const index = {
    schema_version: 1,
    mode: "local-migration-bundle",
    project,
    canonical_source: canonicalSource,
    production_upload_allowed: false,
    source_manifests: manifests,
    records,
    supplements: supplementalIndex,
    excluded_content_preserved: false,
    counts: {
      logical_files: records.length,
      distinct_path_versions: merged.unique_versions,
      unique_objects: new Set([
        ...records.flatMap((r) => r.versions.map((v) => v.sha256)),
        ...supplementaryBytes.keys(),
      ]).size,
      active_items_blocked: records.filter((r) => r.active_handoff_blocked).length,
    },
  };
  const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
  const indexPath = path.join(destination, "bundle.json");
  if (fs.existsSync(indexPath)) {
    if (fs.lstatSync(indexPath).isSymbolicLink() || !fs.readFileSync(indexPath).equals(indexBytes))
      throw new Error("Existing bundle differs; use a new snapshot directory");
    if (!check(destination).verified) throw new Error("Existing bundle failed verification");
    return { idempotent: true, bundle_sha256: digest(indexBytes), ...index.counts };
  }
  fs.mkdirSync(path.join(destination, "objects"), { recursive: true, mode: 0o700 });
  safeDestination(path.join(destination, "objects"));
  const copied = new Set();
  for (const record of records)
    for (const version of record.versions) {
      if (copied.has(version.sha256)) continue;
      const source = path.join(version.sources[0], record.logical_path);
      const bytes = fs.readFileSync(source);
      if (digest(bytes) !== version.sha256) throw new Error("Source changed while bundling");
      const target = path.join(destination, "objects", version.sha256);
      if (fs.existsSync(target)) {
        if (
          fs.lstatSync(target).isSymbolicLink() ||
          digest(fs.readFileSync(target)) !== version.sha256
        )
          throw new Error("Unsafe or corrupt existing object");
      } else fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
      copied.add(version.sha256);
    }
  for (const [sha256, bytes] of supplementaryBytes) {
    const target = path.join(destination, "objects", sha256);
    if (fs.existsSync(target)) {
      if (fs.lstatSync(target).isSymbolicLink() || digest(fs.readFileSync(target)) !== sha256)
        throw new Error("Unsafe or corrupt supplement object");
    } else fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
  }
  fs.writeFileSync(indexPath, indexBytes, { flag: "wx", mode: 0o600 });
  fs.writeFileSync(path.join(destination, "bundle.sha256"), digest(indexBytes), {
    flag: "wx",
    mode: 0o600,
  });
  return { idempotent: false, bundle_sha256: digest(indexBytes), ...index.counts };
}

function check(directory, expectedDigest) {
  directory = safeDestination(directory);
  const indexPath = path.join(directory, "bundle.json");
  if (fs.lstatSync(indexPath).isSymbolicLink())
    throw new Error("Bundle index must not be a symlink");
  const indexBytes = fs.readFileSync(indexPath);
  if (expectedDigest && digest(indexBytes) !== expectedDigest)
    return { verified: false, failures: [{ reason: "trusted-index-hash-mismatch" }], index: null };
  const receipt = path.join(directory, "bundle.sha256");
  if (fs.lstatSync(receipt).isSymbolicLink())
    throw new Error("Bundle receipt must not be a symlink");
  if (fs.readFileSync(receipt, "utf8") !== digest(indexBytes))
    return { verified: false, failures: [{ reason: "bundle-index-hash-mismatch" }], index: null };
  const index = JSON.parse(indexBytes);
  if (
    index.schema_version !== 1 ||
    index.production_upload_allowed !== false ||
    !Array.isArray(index.records)
  )
    throw new Error("Unsupported bundle");
  const failures = [];
  if (
    !Array.isArray(index.source_manifests) ||
    index.source_manifests.some((m) => !validate(m).inventory_valid)
  )
    throw new Error("Invalid source manifests");
  if (
    JSON.stringify(describe(index.project, index.source_manifests, index.canonical_source)) !==
    JSON.stringify(index.records)
  )
    throw new Error("Derived metadata differs from source manifests");
  safeDestination(path.join(directory, "objects"));
  for (const record of index.records) {
    if (
      typeof record.logical_path !== "string" ||
      !/^(?:pm|\.pm)\//.test(record.logical_path) ||
      record.logical_path.split("/").includes("..")
    )
      throw new Error("Unsafe restore path");
    for (const version of record.versions) {
      if (!/^[a-f0-9]{64}$/.test(version.sha256)) throw new Error("Invalid object hash");
      const object = path.join(directory, "objects", version.sha256);
      if (
        !fs.existsSync(object) ||
        fs.lstatSync(object).isSymbolicLink() ||
        digest(fs.readFileSync(object)) !== version.sha256
      )
        failures.push({ path: record.logical_path, sha256: version.sha256 });
    }
  }
  for (const supplement of index.supplements || []) {
    if (!/^[a-f0-9]{64}$/.test(supplement.sha256)) throw new Error("Invalid supplement hash");
    const object = path.join(directory, "objects", supplement.sha256);
    if (
      !fs.existsSync(object) ||
      fs.lstatSync(object).isSymbolicLink() ||
      digest(fs.readFileSync(object)) !== supplement.sha256
    )
      failures.push({ label: supplement.label, sha256: supplement.sha256 });
  }
  return { verified: failures.length === 0, failures, index };
}

function restore(directory, destination) {
  directory = safeDestination(directory);
  const result = check(directory);
  if (!result.verified) throw new Error("Bundle object verification failed");
  destination = safeDestination(destination);
  if (within(path.resolve(directory), destination) || within(destination, path.resolve(directory)))
    throw new Error("Restore must be disjoint from bundle");
  if (fs.existsSync(destination) && fs.readdirSync(destination).length)
    throw new Error("Restore destination must be empty");
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  let restored = 0;
  for (const manifest of result.index.source_manifests) {
    const sourceId = digest(manifest.source_root);
    const root = path.join(destination, "sources", sourceId);
    for (const file of manifest.files) {
      // Paths were checked by check() against records; require matching object membership too.
      const record = result.index.records.find(
        (r) => r.logical_path === file.path && r.versions.some((v) => v.sha256 === file.sha256)
      );
      if (!record) throw new Error("Source manifest is not represented in bundle");
      const output = path.join(root, file.path);
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      const bytes = fs.readFileSync(path.join(directory, "objects", file.sha256));
      fs.writeFileSync(output, bytes, { flag: "wx", mode: 0o600 });
      if (digest(fs.readFileSync(output)) !== file.sha256) throw new Error("Restore hash mismatch");
      restored++;
    }
  }
  for (const supplement of result.index.supplements || []) {
    const folder = path.join(destination, "supplements");
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      path.join(folder, supplement.sha256),
      fs.readFileSync(path.join(directory, "objects", supplement.sha256)),
      { flag: "w", mode: 0o600 }
    );
  }
  return {
    verified: true,
    restored_file_instances: restored,
    sources: result.index.source_manifests.length,
  };
}

if (require.main === module) {
  try {
    const [command, ...args] = process.argv.slice(2);
    let result;
    if (command === "build") {
      const [project, canonical, destination, ...inputs] = args;
      const flag = inputs.indexOf("--supplements");
      let supplements = [];
      if (flag >= 0) {
        supplements = JSON.parse(fs.readFileSync(inputs[flag + 1], "utf8"));
        inputs.splice(flag, 2);
      }
      result = build(
        project,
        inputs.map((p) => JSON.parse(fs.readFileSync(p, "utf8"))),
        canonical,
        destination,
        supplements
      );
    } else if (command === "verify") {
      const verified = check(args[0], args[1]);
      result = { verified: verified.verified, failures: verified.failures };
    } else if (command === "restore") result = restore(args[0], args[1]);
    else
      throw new Error(
        "Usage: build <project> <canonical-source> <destination> <manifest>... | verify <bundle> | restore <bundle> <empty-destination>"
      );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.verified === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { build, check, restore };
