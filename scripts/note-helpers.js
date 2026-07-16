"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("node:crypto");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { writeAtomic, todayIso } = require("./kb-utils.js");
const {
  createBacklogRecordAtomic,
  nextBacklogId: nextAtomicBacklogId,
} = require("./capture-backlog.js");
const { writeJsonAtomic, writeTextAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");
const {
  createEvidenceRecord,
  emptyEvidenceLedger,
  registerEvidence,
} = require("./lib/evidence-schema");

// ---------------------------------------------------------------------------
// writeNote — append a note to the monthly log file
// ---------------------------------------------------------------------------

/**
 * Write a note entry to the monthly log file.
 * Creates the notes directory and file if they don't exist.
 *
 * @param {string} pmDir — path to the pm/ directory
 * @param {string} text — note content (one sentence)
 * @param {string} [source] — source type (e.g. "sales call", "support thread"). Defaults to "observation".
 * @param {string} [tags] — comma-separated tags (e.g. "competitor, integration")
 * @param {object} [options] — deterministic clock/locator and privacy overrides for tests and imports
 * @returns {{ filePath: string, timestamp: string, evidence_id: string }}
 */
function writeNote(pmDir, text, source, tags, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("note capture time is invalid");
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  const monthStr = `${year}-${month}`;
  const dateStr = `${year}-${month}-${day}`;
  const timeStr = `${hours}:${minutes}`;
  const timestamp = `${dateStr} ${timeStr}`;
  const sourceType = source && source.trim() ? source.trim() : "observation";

  const notesDir = path.join(pmDir, "evidence", "notes");
  const filePath = path.join(notesDir, `${monthStr}.md`);
  const locator =
    options.locator ||
    `entry:${now.toISOString()}:${process.pid}:${crypto.randomBytes(6).toString("hex")}`;
  const privacy = options.privacy || privacyForSource(sourceType);
  const pendingSensitive = isPendingSensitive(privacy);
  if (pendingSensitive && !options.pmStateDir) {
    throw new Error("pmStateDir is required for pending sensitive note capture");
  }
  const artifactPath = pendingSensitive
    ? undefined
    : path.relative(pmDir, filePath).split(path.sep).join("/");
  const record = createEvidenceRecord(
    {
      source_type: "note",
      source_label: `notes/${monthStr}.md`,
      source_format: "md",
      locator,
      captured_at: now.toISOString(),
      content: text,
      privacy,
      transformation: { stage: "captured", parents: [], method: "pm:note" },
      artifact_path: artifactPath,
    },
    { now: now.toISOString() }
  );

  const ledgerPath = path.join(pmDir, "evidence", "provenance.json");
  const release = acquireOwnedLock(path.join(pmDir, "evidence", ".write.lock"), {
    attempts: 400,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: "timed out waiting for evidence capture lock",
  });
  try {
    const ledger = fs.existsSync(ledgerPath)
      ? JSON.parse(fs.readFileSync(ledgerPath, "utf8"))
      : emptyEvidenceLedger(now.toISOString());
    const registered = registerEvidence(ledger, record, { now: now.toISOString() });
    if (pendingSensitive) {
      const privatePath = privateNotePath(options.pmStateDir, record.evidence_id);
      writeJsonAtomic(
        privatePath,
        {
          schema_version: 2,
          kind: "pending-note",
          evidence_id: record.evidence_id,
          content: text,
          source: sourceType,
          tags: tags && tags.trim() ? tags.trim() : "",
          display_timestamp: timestamp,
          portable_record: record,
        },
        { directoryMode: 0o700, fileMode: 0o600 }
      );
    } else {
      const noteContent = appendNoteContent(filePath, {
        month: monthStr,
        updated: dateStr,
        timestamp,
        source: sourceType,
        text,
        tags,
        evidenceId: record.evidence_id,
      });
      writeTextAtomic(filePath, noteContent, { fileMode: 0o644 });
    }
    writeJsonAtomic(ledgerPath, registered.ledger, { fileMode: 0o644 });
  } finally {
    release();
  }

  return pendingSensitive
    ? {
        filePath: null,
        privatePath: privateNotePath(options.pmStateDir, record.evidence_id),
        timestamp,
        evidence_id: record.evidence_id,
        pending_review: true,
      }
    : { filePath, timestamp, evidence_id: record.evidence_id, pending_review: false };
}

/**
 * Publish a sanitized rendering of a privately captured note after PII review.
 * The original remains private; only the reviewed content is written and bound.
 */
function publishReviewedNote(pmDir, pmStateDir, evidenceId, sanitizedText, options = {}) {
  if (typeof sanitizedText !== "string" || !sanitizedText.trim()) {
    throw new Error("sanitized note text is required");
  }
  const privatePath = privateNotePath(pmStateDir, evidenceId);
  const privateRecord = readPrivateNote(privatePath);
  if (privateRecord.evidence_id !== evidenceId || privateRecord.kind !== "pending-note") {
    throw new Error("private pending note does not match the requested evidence ID");
  }
  const pending = privateRecord.portable_record;
  if (!isPendingSensitive(pending?.privacy)) {
    throw new Error("private note is not awaiting sensitive-content review");
  }
  if (!/^notes\/\d{4}-\d{2}\.md$/.test(pending.source_label || "")) {
    throw new Error("private note has an invalid portable note label");
  }
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("note publication time is invalid");
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(privateRecord.display_timestamp || "")) {
    throw new Error("private note has an invalid display timestamp");
  }
  const timestamp = privateRecord.display_timestamp;
  const monthStr = pending.source_label.slice("notes/".length, -".md".length);
  const filePath = path.join(pmDir, "evidence", "notes", `${monthStr}.md`);
  const artifactPath = path.relative(pmDir, filePath).split(path.sep).join("/");
  const sourceType =
    typeof options.source === "string" && options.source.trim()
      ? options.source.trim()
      : "reviewed customer signal";
  const reviewed = createEvidenceRecord(
    {
      evidence_id: evidenceId,
      source_type: pending.source_type,
      source_label: pending.source_label,
      source_format: pending.source_format,
      freshness_kind: pending.freshness_kind,
      locator: pending.locator,
      captured_at: pending.captured_at,
      content: sanitizedText,
      privacy: { classification: pending.privacy.classification, pii_review: "reviewed" },
      transformation: pending.transformation,
      artifact_path: artifactPath,
    },
    { now: now.toISOString() }
  );
  const ledgerPath = path.join(pmDir, "evidence", "provenance.json");
  const release = acquireOwnedLock(path.join(pmDir, "evidence", ".write.lock"), {
    attempts: 400,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: "timed out waiting for evidence publication lock",
  });
  try {
    if (!fs.existsSync(ledgerPath)) throw new Error("evidence ledger does not exist");
    const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const current = ledger.records.find((item) => item.evidence_id === evidenceId);
    if (
      current?.content_sha256 === reviewed.content_sha256 &&
      current.privacy?.pii_review === "reviewed" &&
      current.artifact_paths?.includes(artifactPath)
    ) {
      return { filePath, privatePath, timestamp, evidence_id: evidenceId, pending_review: false };
    }
    if (!current || current.content_sha256 !== pending.content_sha256) {
      throw new Error("pending note changed after private capture; review must be repeated");
    }
    const registered = registerEvidence(ledger, reviewed, { now: now.toISOString() });
    const existing = findPublishedNoteEntry(filePath, evidenceId);
    if (existing) {
      const expectedTags = options.tags?.trim() || "";
      if (
        existing.timestamp !== timestamp ||
        existing.source !== sourceType ||
        existing.body !== sanitizedText.trim() ||
        existing.tags !== expectedTags
      ) {
        throw new Error("published note artifact does not match reviewed content");
      }
    } else {
      const noteContent = appendNoteContent(filePath, {
        month: monthStr,
        updated: now.toISOString().slice(0, 10),
        timestamp,
        source: sourceType,
        text: sanitizedText,
        tags: options.tags,
        evidenceId,
      });
      writeTextAtomic(filePath, noteContent, { fileMode: 0o644 });
    }
    writeJsonAtomic(ledgerPath, registered.ledger, { fileMode: 0o644 });
  } finally {
    release();
  }
  return { filePath, privatePath, timestamp, evidence_id: evidenceId, pending_review: false };
}

function findPublishedNoteEntry(filePath, evidenceId) {
  if (!fs.existsSync(filePath)) return null;
  const matches = parseNotesFile(filePath).entries.filter(
    (entry) => entry.evidence_id === evidenceId
  );
  if (matches.length > 1)
    throw new Error("published note artifact contains duplicate evidence IDs");
  return matches[0] || null;
}

function appendNoteContent(filePath, note) {
  const tagsLine = note.tags && note.tags.trim() ? `Tags: ${note.tags.trim()}` : "";
  let entry = `\n### ${note.timestamp} — ${note.source}\n${note.text}\nEvidence-ID: ${note.evidenceId}\n`;
  if (tagsLine) entry += `${tagsLine}\n`;
  if (!fs.existsSync(filePath)) {
    return buildFrontmatter(note.month, note.updated, 1, "null") + entry;
  }
  const parsed = parseFrontmatter(fs.readFileSync(filePath, "utf8"));
  const currentCount = parseInt(parsed.data.note_count, 10) || 0;
  const digestedThrough = parsed.data.digested_through || "null";
  return (
    buildFrontmatter(note.month, note.updated, currentCount + 1, digestedThrough) +
    (parsed.body || "") +
    entry
  );
}

function privateNotePath(pmStateDir, evidenceId) {
  if (typeof pmStateDir !== "string" || !pmStateDir.trim()) {
    throw new Error("pmStateDir is required");
  }
  if (!/^ev_[a-f0-9]{24}$/.test(evidenceId || "")) throw new Error("evidence ID is invalid");
  return path.join(path.resolve(pmStateDir), "evidence", "records", `${evidenceId}.json`);
}

function readPrivateNote(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("private note must be a regular file");
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isPendingSensitive(privacy) {
  return (
    ["customer-sensitive", "restricted"].includes(privacy?.classification) &&
    privacy?.pii_review === "pending"
  );
}

function buildFrontmatter(month, updated, noteCount, digestedThrough) {
  return `---
type: notes
provenance_version: 2
month: ${month}
updated: ${updated}
note_count: ${noteCount}
digested_through: ${digestedThrough}
---
`;
}

// ---------------------------------------------------------------------------
// parseNotesFile — parse a monthly notes file into frontmatter + entries
// ---------------------------------------------------------------------------

/**
 * Parse a monthly notes file.
 *
 * @param {string} filePath — absolute path to the notes file
 * @returns {{ frontmatter: object, entries: Array<{ timestamp: string, source: string, body: string, tags: string }> }}
 */
function parseNotesFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(content);

  const entries = [];
  const body = parsed.body || "";

  // Split on h3 headings: ### YYYY-MM-DD HH:MM — source
  const sections = body.split(/(?=^### )/m).filter((s) => s.trim());

  for (const section of sections) {
    const headingMatch = section.match(/^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) — (.+)\n([\s\S]*)/);
    if (!headingMatch) continue;

    const [, timestamp, source, rest] = headingMatch;
    const lines = rest.trim().split("\n");

    let bodyText = "";
    let tagsStr = "";
    let promotedTo;
    let evidenceId;
    const enrichment = [];

    for (const line of lines) {
      if (line.startsWith("Tags:")) {
        tagsStr = line.replace("Tags:", "").trim();
      } else if (line.startsWith("Promoted-to:")) {
        promotedTo = line.replace("Promoted-to:", "").trim();
      } else if (line.startsWith("Evidence-ID:")) {
        evidenceId = line.replace("Evidence-ID:", "").trim();
      } else if (line.startsWith("- **")) {
        enrichment.push(line);
      } else {
        bodyText += (bodyText ? "\n" : "") + line;
      }
    }

    entries.push({
      timestamp,
      source: source.trim(),
      body: bodyText.trim(),
      tags: tagsStr,
      promoted_to: promotedTo,
      evidence_id: evidenceId,
      enrichment,
    });
  }

  return {
    frontmatter: parsed.data,
    entries,
  };
}

function privacyForSource(source) {
  const normalized = source.toLowerCase();
  if (/customer|support|interview|sales|prospect/.test(normalized)) {
    return { classification: "customer-sensitive", pii_review: "pending" };
  }
  return { classification: "internal", pii_review: "not-required" };
}

// ---------------------------------------------------------------------------
// promoteNoteToIdea — create a backlog idea from a note entry
// ---------------------------------------------------------------------------

function slugify(text, maxWords) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join("-");
}

function nextBacklogId(pmDir) {
  return nextAtomicBacklogId(pmDir);
}

/**
 * Promote a note entry to a backlog idea.
 *
 * @param {string} pmDir — path to the pm/ directory
 * @param {string} noteFilePath — absolute path to the monthly notes file
 * @param {string} entryTimestamp — timestamp of the entry to promote (e.g. "2026-04-09 14:32")
 * @returns {{ slug: string, backlogPath: string, id: string }}
 */
function promoteNoteToIdea(pmDir, noteFilePath, entryTimestamp) {
  const parsed = parseNotesFile(noteFilePath);
  const entry = parsed.entries.find((e) => e.timestamp === entryTimestamp);

  if (!entry) {
    throw new Error(`Note entry with timestamp "${entryTimestamp}" not found in ${noteFilePath}`);
  }

  if (entry.promoted_to) {
    throw new Error(`Note entry "${entryTimestamp}" is already promoted to "${entry.promoted_to}"`);
  }

  const slug = slugify(entry.body, 4);
  if (!slug) {
    throw new Error("Cannot derive slug from empty note body");
  }

  const today = todayIso();

  const tags = entry.tags
    ? entry.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];
  const labelsYaml = tags.length > 0 ? tags.map((t) => `  - ${t}`).join("\n") : "  - uncategorized";

  let captured;
  try {
    captured = createBacklogRecordAtomic(pmDir, {
      slug,
      render(id) {
        return `---
type: backlog
id: ${id}
title: ${entry.body.split(/[.!?]/)[0].trim()}
outcome: null
status: idea
priority: medium
labels:
${labelsYaml}
source_note: ${path.relative(pmDir, noteFilePath)}#${entryTimestamp}
created: ${today}
updated: ${today}
---

## Origin

Promoted from note: ${entryTimestamp} — ${entry.source}

${entry.body}
`;
      },
      validate(parsed) {
        if (
          !parsed.hasFrontmatter ||
          parsed.data.type !== "backlog" ||
          parsed.data.status !== "idea" ||
          parsed.data.id === undefined
        ) {
          throw new Error("promoted note did not publish a valid backlog idea");
        }
      },
    });
  } catch (error) {
    if (error.code === "BACKLOG_SLUG_COLLISION") {
      throw new Error(`Backlog item already exists for ${slug} — slug collision`);
    }
    throw error;
  }
  const { id, filePath: backlogPath } = captured;

  // Rewrite the note file to add Promoted-to line to the matching entry
  const raw = fs.readFileSync(noteFilePath, "utf8");
  const heading = `### ${entryTimestamp} — ${entry.source}`;
  const headingIdx = raw.indexOf(heading);

  if (headingIdx === -1) {
    throw new Error(`Could not find heading "${heading}" in ${noteFilePath}`);
  }

  // Find the end of this entry (next ### or end of file)
  const afterHeading = raw.indexOf("\n", headingIdx);
  const nextHeading = raw.indexOf("\n### ", afterHeading);
  const insertPos = nextHeading === -1 ? raw.length : nextHeading;

  // Insert Promoted-to line before the next entry
  const before = raw.slice(0, insertPos);
  const after = raw.slice(insertPos);
  const promotedLine = `Promoted-to: ${slug}\n`;

  const updated = before.endsWith("\n")
    ? before + promotedLine + after
    : before + "\n" + promotedLine + after;

  writeAtomic(noteFilePath, updated);

  return { slug, backlogPath, id };
}

module.exports = {
  writeNote,
  publishReviewedNote,
  parseNotesFile,
  promoteNoteToIdea,
  nextBacklogId,
};
