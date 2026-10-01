"use strict";

// Offline planning only. No credentials, network calls, writes to source, or API assumptions.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseFrontmatter } = require("./kb-frontmatter.js");

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const credentialPattern =
  /gh[pousr]_[A-Za-z0-9]{20,}|pmem_[a-f0-9]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[A-Z0-9]{16}/;
const credentialName = /^(?:\.env(?:\..*)?|credentials.*)$|private.?key|\.(?:pem|p12)$/i;

function classify(relative, fm) {
  if (relative.startsWith(".pm/")) return "local-runtime";
  if (/\.approval\.json$/.test(relative)) return "historical-approval";
  if (/\.html$/.test(relative)) return "document-artifact";
  if (/\.(?:json|sha256|snapshot)$/.test(relative)) return "document-sidecar";
  if (/\.(?:png|jpg|jpeg|webp|gif|css|js)$/.test(relative)) return "artifact-asset";
  if (["evidence", "research", "insight", "backlog", "notes"].includes(fm.type)) {
    return "record";
  }
  if (/\.md$/.test(relative)) return "context-document";
  return "unmapped";
}

function references(text, extension, fm) {
  const refs = [];
  if (extension === ".md") {
    for (const match of text.matchAll(/!?\[[^\]]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+[^)]*)?\)/g)) {
      refs.push({ target: match[1].replace(/^<|>$/g, ""), basis: "markdown-link" });
    }
    for (const field of ["research_refs", "sources", "evidence_refs"]) {
      const value = fm[field];
      for (const ref of Array.isArray(value) ? value : value ? [value] : []) {
        if (typeof ref === "string") refs.push({ target: ref, basis: "frontmatter" });
        else if (ref && typeof ref.path === "string")
          refs.push({ target: ref.path, basis: "frontmatter" });
      }
    }
  }
  if (extension === ".html" || extension === ".css") {
    for (const match of text.matchAll(
      /(?:href|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'";]+)["']?\s*\)/g
    )) {
      refs.push({ target: match[1] || match[2], basis: "artifact-link" });
    }
  }
  return refs;
}

function resolveReference(from, reference, files) {
  const target = reference.target;
  if (/^(?:https?:|mailto:|tel:|data:|javascript:|#)/i.test(target))
    return { ...reference, state: "external-or-inline" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return { ...reference, state: "unsupported-scheme" };
  let decoded;
  try {
    decoded = decodeURIComponent(target.split(/[?#]/)[0]);
  } catch {
    return { ...reference, state: "invalid-encoding" };
  }
  if (path.isAbsolute(decoded)) return { ...reference, state: "absolute-local", resolved: decoded };
  const candidates = [path.posix.normalize(path.posix.join(path.posix.dirname(from), decoded))];
  if (reference.basis === "frontmatter")
    candidates.unshift(path.posix.normalize(decoded.startsWith("pm/") ? decoded : `pm/${decoded}`));
  const resolved = candidates.find((candidate) => files.has(candidate));
  return {
    ...reference,
    state: resolved ? "resolved" : "missing",
    resolved: resolved || candidates[0],
  };
}

function plan(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Source root must not be a symlink");
  const files = [];
  const excluded = [];
  function walk(relative) {
    const absolute = path.join(root, relative);
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      excluded.push({ path: relative, reason: "symlink" });
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) walk(`${relative}/${name}`);
      return;
    }
    if (!stat.isFile()) {
      excluded.push({ path: relative, reason: "special-file" });
      return;
    }
    if (credentialName.test(path.basename(relative))) {
      excluded.push({ path: relative, reason: "credential-filename" });
      return;
    }
    const bytes = fs.readFileSync(absolute);
    const text = bytes.toString("utf8");
    if (credentialPattern.test(text)) {
      excluded.push({ path: relative, reason: "credential-pattern" });
      return;
    }
    const extension = path.extname(relative);
    const fm = extension === ".md" ? parseFrontmatter(text).data : {};
    const category = classify(relative, fm);
    const file = {
      path: relative,
      bytes: bytes.length,
      sha256: hash(bytes),
      category,
      source_type: fm.type || null,
      source_status: fm.status || null,
      source_id: fm.id || null,
      migration_id: `file:${relative}`,
      references: references(text, extension, fm),
    };
    if (
      category === "historical-approval" ||
      (relative.startsWith(".pm/") && extension === ".json")
    ) {
      try {
        const state = JSON.parse(text);
        const approval = category === "historical-approval" ? state : state.approval;
        if (approval && (approval.status === "approved" || approval.approved_at)) {
          file.approval = {
            provenance: "historical-only",
            status: approval.status || null,
            approved_by: approval.approved_by || null,
            approved_at: approval.approved_at || null,
            declared_hashes: Object.fromEntries(
              Object.entries(approval).filter(
                ([key, value]) => /hash|sha256/.test(key) && typeof value === "string"
              )
            ),
            verification: "not-verified",
          };
        }
      } catch {
        file.parse_error = "invalid-json";
      }
    }
    files.push(file);
  }
  for (const scope of ["pm", ".pm"]) walk(scope);
  const paths = new Set(files.map((file) => file.path));
  const hashes = new Set(files.map((file) => `sha256:${file.sha256}`));
  const counts = {};
  for (const file of files) {
    file.references = file.references.map((ref) => resolveReference(file.path, ref, paths));
    if (file.approval)
      file.approval.hash_matches = Object.fromEntries(
        Object.entries(file.approval.declared_hashes).map(([key, value]) => [
          key,
          hashes.has(value),
        ])
      );
    counts[file.category] = (counts[file.category] || 0) + 1;
  }
  const result = {
    schema_version: 1,
    mode: "offline-dry-run",
    source_root: root,
    files,
    excluded,
    counts,
    unmapped: files.filter((file) => file.category === "unmapped").map((file) => file.path),
    required_capabilities: [
      "lossless-file-export",
      "artifact-bundles",
      "historical-approval-provenance",
      "exact-status-preservation",
      "conditional-writes",
    ],
    production_ready: false,
  };
  result.validation = validate(result);
  return result;
}

function validate(manifest) {
  const errors = [];
  const warnings = [];
  if (!manifest || !Array.isArray(manifest.files) || !Array.isArray(manifest.excluded)) {
    return {
      errors: [{ code: "invalid-manifest" }],
      warnings,
      inventory_valid: false,
      cutover_allowed: false,
    };
  }
  if (manifest.schema_version !== undefined && manifest.schema_version !== 1)
    errors.push({ code: "unsupported-schema" });
  const paths = new Set();
  const ids = new Map();
  for (const file of manifest.files) {
    if (paths.has(file.path)) errors.push({ code: "duplicate-path", path: file.path });
    paths.add(file.path);
    if (
      !/^(?:pm|\.pm)\//.test(file.path) ||
      file.path.split("/").includes("..") ||
      path.isAbsolute(file.path)
    )
      errors.push({ code: "unsafe-path", path: file.path });
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) errors.push({ code: "invalid-hash", path: file.path });
    if (file.source_id) {
      if (ids.has(file.source_id))
        warnings.push({
          code: "duplicate-source-id",
          path: file.path,
          other: ids.get(file.source_id),
        });
      ids.set(file.source_id, file.path);
    }
    if (file.parse_error) errors.push({ code: file.parse_error, path: file.path });
    for (const ref of file.references) {
      if (!["resolved", "external-or-inline"].includes(ref.state))
        warnings.push({ code: `reference-${ref.state}`, path: file.path, target: ref.target });
    }
    if (file.approval)
      warnings.push({ code: "approval-needs-contract-verification", path: file.path });
    if (file.category === "unmapped") warnings.push({ code: "unmapped-content", path: file.path });
  }
  for (const item of manifest.excluded)
    warnings.push({ code: `excluded-${item.reason}`, path: item.path });
  return { errors, warnings, inventory_valid: errors.length === 0, cutover_allowed: false };
}

function verify(manifest, root = manifest.source_root) {
  const failures = [];
  const validation = validate(manifest);
  if (!validation.inventory_valid)
    return { verified: false, failures: validation.errors, checked: 0 };
  if (fs.lstatSync(path.resolve(root)).isSymbolicLink())
    return { verified: false, failures: [{ reason: "symlink-root" }], checked: 0 };
  for (const file of manifest.files) {
    if (validate({ files: [file], excluded: [] }).errors.length) {
      failures.push({ path: file.path, reason: "unsafe-manifest" });
      continue;
    }
    let absolute = path.resolve(root);
    let unsafe = false;
    for (const part of file.path.split("/")) {
      absolute = path.join(absolute, part);
      if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink()) {
        unsafe = true;
        break;
      }
    }
    if (unsafe || !fs.statSync(absolute).isFile())
      failures.push({ path: file.path, reason: "missing-or-symlink" });
    else if (hash(fs.readFileSync(absolute)) !== file.sha256)
      failures.push({ path: file.path, reason: "hash-mismatch" });
  }
  const fresh = plan(root);
  const expected = new Set(manifest.files.map((file) => file.path));
  for (const file of fresh.files)
    if (!expected.has(file.path)) failures.push({ path: file.path, reason: "new-file" });
  for (const file of fresh.excluded)
    if (expected.has(file.path)) failures.push({ path: file.path, reason: "now-excluded" });
  const priorExcluded = new Set(manifest.excluded.map((file) => `${file.path}:${file.reason}`));
  for (const file of fresh.excluded) {
    if (!priorExcluded.has(`${file.path}:${file.reason}`))
      failures.push({ path: file.path, reason: "new-exclusion" });
  }
  const currentExcluded = new Set(fresh.excluded.map((file) => `${file.path}:${file.reason}`));
  for (const file of manifest.excluded) {
    if (!currentExcluded.has(`${file.path}:${file.reason}`))
      failures.push({ path: file.path, reason: "missing-exclusion" });
  }
  return { verified: failures.length === 0, failures, checked: manifest.files.length };
}

if (require.main === module) {
  try {
    const [command, input, root] = process.argv.slice(2);
    if (!input || !["plan", "validate", "verify"].includes(command))
      throw new Error(
        "Usage: kb-migration-plan.js plan <repo> | validate <manifest> | verify <manifest> [restore-root]"
      );
    const result =
      command === "plan"
        ? plan(input)
        : command === "validate"
          ? validate(JSON.parse(fs.readFileSync(input, "utf8")))
          : verify(JSON.parse(fs.readFileSync(input, "utf8")), root);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.verified === false || result.inventory_valid === false) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { plan, validate, verify, classify, resolveReference };
