"use strict";
const fs = require("fs");
const { validate } = require("./kb-migration-plan.js");

// Selection is explicit. Other worktrees provide recoverable variants, never automatic winners.
function reconcile(manifests, canonicalSource) {
  const identities = new Set();
  for (const manifest of manifests) {
    if (!manifest || typeof manifest.source_root !== "string")
      throw new Error("Source identity is required");
    if (identities.has(manifest.source_root))
      throw new Error("Duplicate source identity; supply one frozen snapshot per source");
    identities.add(manifest.source_root);
  }
  if (!manifests.some((m) => m.source_root === canonicalSource))
    throw new Error("Canonical source must match an inventoried source_root");
  const groups = new Map();
  for (const manifest of manifests) {
    if (!validate(manifest).inventory_valid) throw new Error("Invalid source inventory");
    for (const file of manifest.files) {
      if (!groups.has(file.path)) groups.set(file.path, new Map());
      const versions = groups.get(file.path);
      if (!versions.has(file.sha256))
        versions.set(file.sha256, {
          sha256: file.sha256,
          blob_id: `sha256:${file.sha256}`,
          category: file.category,
          sources: [],
        });
      versions.get(file.sha256).sources.push(manifest.source_root);
    }
  }
  const canonical = manifests.find((m) => m.source_root === canonicalSource);
  const current = new Map(canonical.files.map((f) => [f.path, f]));
  const files = [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([logicalPath, variants]) => {
      const selected = current.get(logicalPath);
      return {
        logical_path: logicalPath,
        migration_id: `file:${logicalPath}`,
        canonical_sha256: selected ? selected.sha256 : null,
        disposition: !selected
          ? "archive-only-unless-reviewed"
          : variants.size > 1
            ? "canonical-with-preserved-variants"
            : "canonical-identical",
        requires_review: !selected || variants.size > 1,
        variants: [...variants.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
      };
    });
  return {
    schema_version: 1,
    mode: "offline-reconciliation",
    canonical_source: canonicalSource,
    production_ready: false,
    files,
    logical_files: files.length,
    unique_versions: files.reduce((n, f) => n + f.variants.length, 0),
    conflicts: files.filter((f) => f.variants.length > 1).length,
    archive_only: files.filter((f) => !f.canonical_sha256).length,
  };
}

if (require.main === module) {
  try {
    const [canonicalSource, ...inputs] = process.argv.slice(2);
    if (!canonicalSource || !inputs.length)
      throw new Error("Usage: kb-migration-reconcile.js <canonical-source-root> <manifest>...");
    process.stdout.write(
      `${JSON.stringify(
        reconcile(
          inputs.map((p) => JSON.parse(fs.readFileSync(p, "utf8"))),
          canonicalSource
        ),
        null,
        2
      )}\n`
    );
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
module.exports = { reconcile };
