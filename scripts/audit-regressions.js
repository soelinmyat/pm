#!/usr/bin/env node
// audit-regressions — D0 baseline audit for plugin routing/gating regressions.
//
// For each priority surface (6 step files), scan git log within the audit window
// and classify commits under Decision #1 of the plugin-test-strategy RFC:
//
//   Routing/gating regression: a commit touches a priority surface AND either
//     (a) is reverted within 14 days by `git revert` (message starts "Revert "),
//         OR
//     (b) a later commit within 30 days touches the same priority surface with
//         regression|fix|restore|correct (case-insensitive, word-boundary) in
//         its message.
//
//   Schema-drift regression: same windowing as (b), but the fix commit's patch
//     touches SKILL.md frontmatter, step `order` field, `allowed-tools`,
//     persona refs, or manifest parity.
//
// Usage: node scripts/audit-regressions.js --since YYYY-MM-DD [--until <sha>]
//
// Emits a deterministic markdown artifact to stdout suitable for committing into
// pm-kb as evidence.

"use strict";

const { execFileSync } = require("child_process");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PRIORITY_SURFACES = [
  "skills/groom/steps/01-intake.md",
  "skills/dev/steps/02-intake.md",
  "skills/dev/steps/04-groom-readiness.md",
  "skills/ship/steps/07-merge-loop.md",
  "skills/review/SKILL.md",
  "skills/simplify/SKILL.md",
];

const MANIFEST_FILES = [
  ".claude-plugin/plugin.json",
  "plugin.config.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
];

const REVERT_WINDOW_DAYS = 14;
const KEYWORD_WINDOW_DAYS = 30;
const KEYWORD_REGEX = /\b(regression|fix|restore|correct)\b/i;

const CLASSIFICATION_RULE_TEXT =
  "Decision #1: A commit counts as a routing/gating regression when within the " +
  "audit window it touches a priority surface AND either (a) is reverted within " +
  "14 days by `git revert` (message starts 'Revert '), or (b) a later commit " +
  "within 30 days touches the same priority surface with " +
  "regression|fix|restore|correct (case-insensitive, word-boundary) in its message.";

const MULTI_SURFACE_TIEBREAK_TEXT =
  "Multi-surface commit tie-breaking: a commit touching N priority surfaces " +
  "counts once per surface, max N contributions.";

const SCHEMA_DRIFT_FIELDS_DESCRIPTION =
  "Schema drift: fix commit's patch touches SKILL.md frontmatter, step `order` " +
  "field, `allowed-tools`, persona refs, or manifest parity.";

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { since: null, until: "HEAD" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since" && argv[i + 1]) {
      out.since = argv[i + 1];
      i++;
    } else if (a === "--until" && argv[i + 1]) {
      out.until = argv[i + 1];
      i++;
    }
  }
  return out;
}

function defaultRunGit(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// Log parsing
// ---------------------------------------------------------------------------

/**
 * Parse `git log` output formatted with %H|%an|%aI|%s into entries.
 * Each entry: { sha, author, dateIso, subject }.
 */
function parseLogOutput(raw) {
  if (!raw) return [];
  const entries = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // %s may contain pipes; split with a limit.
    const parts = line.split("|");
    if (parts.length < 4) continue;
    const sha = parts[0];
    const author = parts[1];
    const dateIso = parts[2];
    const subject = parts.slice(3).join("|");
    entries.push({ sha, author, dateIso, subject });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function daysBetween(aIso, bIso) {
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return Infinity;
  return (b - a) / (1000 * 60 * 60 * 24);
}

function toUtcDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Schema-drift detection
// ---------------------------------------------------------------------------

/**
 * Inspect a commit's patch text (as produced by `git show <sha> -- <surface>`)
 * for schema-drift signals. Returns the field label if detected, else null.
 */
function detectSchemaDriftField(patch) {
  if (!patch) return null;
  // Look at added/removed lines only (lines starting with +/- and not +++/---).
  const lines = patch.split("\n");
  const diffLines = lines.filter(
    (l) => (l.startsWith("+") || l.startsWith("-")) && !l.startsWith("+++") && !l.startsWith("---")
  );
  const joined = diffLines.join("\n");

  // Heuristic signals (ordered — first match wins).
  if (/^[+-]\s*order\s*:/m.test(joined)) return "order";
  if (/^[+-]\s*allowed-tools\s*:/m.test(joined)) return "allowed-tools";
  if (/personas\//.test(joined)) return "personas-ref";
  // Frontmatter keys on SKILL.md (name/description/persona/etc.) — detect any
  // change inside a frontmatter region. Conservative heuristic: a bare
  // `name:` / `description:` change on a SKILL.md patch.
  if (/^[+-]\s*(name|description|persona|personas)\s*:/m.test(joined)) return "skill-frontmatter";
  return null;
}

function isManifestPath(filePath) {
  return MANIFEST_FILES.includes(filePath);
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Classify commits against Decision #1.
 *
 * @param {Map<string, Array>} logsBySurface  surface -> entries (newest first).
 * @param {Map<string, string>} patchBySha  sha -> patch text (for schema-drift).
 * @returns {Object} classification report.
 */
function classifyCommits(logsBySurface, patchBySha, options = {}) {
  void options;
  const perSurface = new Map();

  for (const surface of PRIORITY_SURFACES) {
    const entries = (logsBySurface.get(surface) || []).slice();
    // Sort ascending by date so (a)/(b) windows look forward in time.
    entries.sort((x, y) => x.dateIso.localeCompare(y.dateIso));

    const routing = [];
    const schemaDrift = [];

    for (let i = 0; i < entries.length; i++) {
      const candidate = entries[i];
      // (a) revert within 14 days — any later commit on any surface with
      // subject starting "Revert " mentioning the SHA (short or long).
      let triggeredBy = null;
      let triggerHalf = null;
      // Short sha (first 7 chars) typically referenced in revert messages.
      const shortSha = candidate.sha.slice(0, 7);

      // Scan all surfaces' later commits for a revert referencing candidate.
      outerA: for (const [, otherEntries] of logsBySurface) {
        for (const other of otherEntries) {
          if (other.sha === candidate.sha) continue;
          if (other.dateIso <= candidate.dateIso) continue;
          const delta = daysBetween(candidate.dateIso, other.dateIso);
          if (delta > REVERT_WINDOW_DAYS) continue;
          if (!other.subject.startsWith("Revert ")) continue;
          if (other.subject.includes(shortSha) || other.subject.includes(candidate.sha)) {
            triggeredBy = other;
            triggerHalf = "a-revert-14d";
            break outerA;
          }
          // Also accept revert messages that quote the original subject.
          const quotedSubject = candidate.subject.replace(/^"+|"+$/g, "");
          if (quotedSubject && other.subject.includes(quotedSubject)) {
            triggeredBy = other;
            triggerHalf = "a-revert-14d";
            break outerA;
          }
        }
      }

      // (b) later commit within 30d touching the SAME surface with keyword.
      if (!triggeredBy) {
        for (let j = i + 1; j < entries.length; j++) {
          const later = entries[j];
          const delta = daysBetween(candidate.dateIso, later.dateIso);
          if (delta > KEYWORD_WINDOW_DAYS) break;
          if (KEYWORD_REGEX.test(later.subject)) {
            triggeredBy = later;
            triggerHalf = "b-keyword-30d";
            break;
          }
        }
      }

      if (triggeredBy) {
        routing.push({
          sha: candidate.sha,
          subject: candidate.subject,
          date: toUtcDate(candidate.dateIso),
          triggered_by_sha: triggeredBy.sha,
          triggered_by_subject: triggeredBy.subject,
          trigger_half: triggerHalf,
        });

        // Schema-drift: only applies when (b) triggered — check the fix's
        // patch for schema-relevant fields.
        if (triggerHalf === "b-keyword-30d") {
          const patch = patchBySha.get(`${triggeredBy.sha}:${surface}`) || "";
          const field = detectSchemaDriftField(patch);
          if (field) {
            schemaDrift.push({
              regression_sha: candidate.sha,
              fix_sha: triggeredBy.sha,
              fix_subject: triggeredBy.subject,
              field,
            });
          } else if (isManifestPath(surface)) {
            // Manifests are included as a schema-drift signal directly.
            schemaDrift.push({
              regression_sha: candidate.sha,
              fix_sha: triggeredBy.sha,
              fix_subject: triggeredBy.subject,
              field: "manifest-parity",
            });
          }
        }
      }
    }

    perSurface.set(surface, {
      surface,
      total_commits: entries.length,
      routing,
      schema_drift: schemaDrift,
    });
  }

  // Totals. Multi-surface commit is counted once per surface (tie-break rule).
  let totalCommits = 0;
  let totalRouting = 0;
  let totalSchemaDrift = 0;
  for (const s of perSurface.values()) {
    totalCommits += s.total_commits;
    totalRouting += s.routing.length;
    totalSchemaDrift += s.schema_drift.length;
  }

  return {
    per_surface: perSurface,
    total_commits: totalCommits,
    total_routing: totalRouting,
    total_schema_drift: totalSchemaDrift,
    total_combined: totalRouting + totalSchemaDrift,
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

function renderFrontmatter(meta) {
  const lines = [];
  lines.push("---");
  lines.push("type: evidence");
  lines.push("evidence_type: research");
  lines.push("source_origin: internal");
  lines.push(`created: ${meta.created_date}`);
  lines.push("sources:");
  for (const src of meta.sources) {
    // Quote to prevent the tolerant YAML parser from splitting URLs on the `:`.
    lines.push(`  - "${src}"`);
  }
  if (meta.cited_by.length === 0) {
    lines.push("cited_by: []");
  } else {
    lines.push("cited_by:");
    for (const c of meta.cited_by) {
      lines.push(`  - ${c}`);
    }
  }
  lines.push(`audit_window_end_sha: ${meta.audit_window_end_sha}`);
  lines.push(`audit_since: ${meta.audit_since}`);
  lines.push(`audit_until_iso: ${meta.audit_until_iso}`);
  lines.push(`classification_rule: >`);
  for (const line of wrapLines(meta.classification_rule, 80)) {
    lines.push(`  ${line}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function wrapLines(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width && cur.length > 0) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur.trim());
  return lines;
}

function renderReport(report, meta) {
  const lines = [];

  lines.push(renderFrontmatter(meta));
  lines.push("");
  lines.push("# Plugin Test Strategy — D0 Baseline Audit");
  lines.push("");
  lines.push(
    `**Audit window:** since \`${meta.audit_since}\` until \`${meta.audit_until_iso}\` (SHA \`${meta.audit_window_end_sha}\`)`
  );
  lines.push("");

  lines.push("## Methodology");
  lines.push("");
  lines.push(CLASSIFICATION_RULE_TEXT);
  lines.push("");
  lines.push(MULTI_SURFACE_TIEBREAK_TEXT);
  lines.push("");
  lines.push(SCHEMA_DRIFT_FIELDS_DESCRIPTION);
  lines.push("");
  lines.push(
    `Revert window: ${REVERT_WINDOW_DAYS} days. Keyword window: ${KEYWORD_WINDOW_DAYS} days.`
  );
  lines.push(`Keyword regex: ${KEYWORD_REGEX.toString()} (applied to later-commit subjects).`);
  lines.push("");

  lines.push("## Priority surfaces");
  lines.push("");
  for (const s of PRIORITY_SURFACES) {
    lines.push(`- \`${s}\``);
  }
  lines.push("");

  // Routing/gating regressions
  lines.push("## Class A — Routing / Gating Regressions");
  lines.push("");
  lines.push("| Surface | Commits | Regressions |");
  lines.push("| --- | --- | --- |");
  const sortedSurfaces = Array.from(report.per_surface.keys()).sort();
  for (const surface of sortedSurfaces) {
    const s = report.per_surface.get(surface);
    lines.push(`| \`${surface}\` | ${s.total_commits} | ${s.routing.length} |`);
  }
  lines.push("");

  const allRouting = [];
  for (const surface of sortedSurfaces) {
    const s = report.per_surface.get(surface);
    for (const r of s.routing) {
      allRouting.push({ surface, ...r });
    }
  }
  // Sort by SHA lexically for determinism.
  allRouting.sort((a, b) => a.sha.localeCompare(b.sha));
  if (allRouting.length === 0) {
    lines.push("_No routing/gating regressions detected in the audit window._");
  } else {
    lines.push("| Surface | Regression SHA | Date | Trigger half | Fix SHA | Fix subject |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const r of allRouting) {
      const safeSubject = r.triggered_by_subject.replace(/\|/g, "\\|");
      lines.push(
        `| \`${r.surface}\` | \`${r.sha.slice(0, 12)}\` | ${r.date} | ${r.trigger_half} | \`${r.triggered_by_sha.slice(0, 12)}\` | ${safeSubject} |`
      );
    }
  }
  lines.push("");

  // Schema-drift
  lines.push("## Class B — Schema-Drift Regressions");
  lines.push("");
  lines.push("| Surface | Regressions |");
  lines.push("| --- | --- |");
  for (const surface of sortedSurfaces) {
    const s = report.per_surface.get(surface);
    lines.push(`| \`${surface}\` | ${s.schema_drift.length} |`);
  }
  lines.push("");

  const allDrift = [];
  for (const surface of sortedSurfaces) {
    const s = report.per_surface.get(surface);
    for (const d of s.schema_drift) {
      allDrift.push({ surface, ...d });
    }
  }
  allDrift.sort((a, b) => a.regression_sha.localeCompare(b.regression_sha));
  if (allDrift.length === 0) {
    lines.push("_No schema-drift regressions detected in the audit window._");
  } else {
    lines.push("| Surface | Regression SHA | Fix SHA | Field | Fix subject |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const d of allDrift) {
      const safeSubject = d.fix_subject.replace(/\|/g, "\\|");
      lines.push(
        `| \`${d.surface}\` | \`${d.regression_sha.slice(0, 12)}\` | \`${d.fix_sha.slice(0, 12)}\` | ${d.field} | ${safeSubject} |`
      );
    }
  }
  lines.push("");

  // Overall rate
  lines.push("## Overall");
  lines.push("");
  const rate =
    report.total_commits > 0
      ? ((report.total_combined / report.total_commits) * 100).toFixed(2)
      : "0.00";
  lines.push(
    `- Total commits on priority surfaces (with multi-surface per-surface counting): **${report.total_commits}**`
  );
  lines.push(`- Class A routing/gating regressions: **${report.total_routing}**`);
  lines.push(`- Class B schema-drift regressions: **${report.total_schema_drift}**`);
  lines.push(`- Combined regressions: **${report.total_combined}**`);
  lines.push(`- Combined regression rate: **${rate}%**`);
  lines.push("");

  // JSON summary (T-adv-3)
  const jsonSummary = {
    audit_window_end_sha: meta.audit_window_end_sha,
    audit_since: meta.audit_since,
    audit_until_iso: meta.audit_until_iso,
    total_commits: report.total_commits,
    total_routing: report.total_routing,
    total_schema_drift: report.total_schema_drift,
    total_combined: report.total_combined,
    combined_rate_percent: Number(rate),
    per_surface: sortedSurfaces.map((surface) => {
      const s = report.per_surface.get(surface);
      return {
        surface,
        total_commits: s.total_commits,
        routing_count: s.routing.length,
        schema_drift_count: s.schema_drift.length,
        routing_shas: s.routing.map((r) => r.sha).sort(),
        schema_drift_shas: s.schema_drift.map((d) => d.regression_sha).sort(),
      };
    }),
  };
  lines.push("## JSON summary");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(jsonSummary, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function runAudit(opts) {
  const { since, until, runGit = defaultRunGit } = opts;
  if (!since) {
    throw new Error("--since is required (YYYY-MM-DD)");
  }

  // Resolve `until` to a full SHA for determinism.
  let untilSha = until;
  try {
    untilSha = runGit(["rev-parse", until]).trim();
  } catch {
    // leave as-is
  }

  const logsBySurface = new Map();
  const patchBySha = new Map();

  for (const surface of PRIORITY_SURFACES) {
    const raw = runGit([
      "log",
      "--follow",
      `--since=${since}`,
      untilSha,
      "--pretty=format:%H|%an|%aI|%s",
      "--",
      surface,
    ]);
    const entries = parseLogOutput(raw);
    logsBySurface.set(surface, entries);
  }

  // Preload patches for all commits (used for schema-drift detection on the
  // fix commit when class B triggers). We fetch patches per (sha, surface).
  const seen = new Set();
  for (const [surface, entries] of logsBySurface) {
    for (const e of entries) {
      const key = `${e.sha}:${surface}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let patch = "";
      try {
        patch = runGit(["show", e.sha, "--", surface]);
      } catch {
        patch = "";
      }
      patchBySha.set(key, patch);
    }
  }

  const report = classifyCommits(logsBySurface, patchBySha, {});

  // Determine audit_until_iso from the until sha.
  let auditUntilIso = "";
  try {
    auditUntilIso = runGit(["show", "-s", "--format=%aI", untilSha]).trim();
  } catch {
    auditUntilIso = "";
  }

  const meta = {
    created_date: toUtcDate(new Date().toISOString()),
    sources: PRIORITY_SURFACES.map((p) => `https://github.com/soelinmyat/pm/blob/${untilSha}/${p}`),
    cited_by: [],
    audit_window_end_sha: untilSha,
    audit_since: since,
    audit_until_iso: toUtcDate(auditUntilIso),
    classification_rule: CLASSIFICATION_RULE_TEXT,
  };

  return renderReport(report, meta);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.since) {
    process.stderr.write("Usage: audit-regressions.js --since YYYY-MM-DD [--until <sha>]\n");
    process.exit(2);
  }
  const out = runAudit(args);
  process.stdout.write(out);
}

if (require.main === module) {
  main();
}

module.exports = {
  PRIORITY_SURFACES,
  MANIFEST_FILES,
  REVERT_WINDOW_DAYS,
  KEYWORD_WINDOW_DAYS,
  KEYWORD_REGEX,
  classifyCommits,
  detectSchemaDriftField,
  parseLogOutput,
  toUtcDate,
  daysBetween,
  runAudit,
};
