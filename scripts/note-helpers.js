"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");
const { writeAtomic, todayIso } = require("./kb-utils.js");

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
 * @returns {{ filePath: string, timestamp: string }}
 */
function writeNote(pmDir, text, source, tags) {
  const now = new Date();
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
  fs.mkdirSync(notesDir, { recursive: true });

  const filePath = path.join(notesDir, `${monthStr}.md`);
  const tagsLine = tags && tags.trim() ? `Tags: ${tags.trim()}` : "";

  let entry = `\n### ${timestamp} — ${sourceType}\n${text}\n`;
  if (tagsLine) {
    entry += `${tagsLine}\n`;
  }

  if (fs.existsSync(filePath)) {
    // Read existing file, update frontmatter, append entry
    const existing = fs.readFileSync(filePath, "utf8");
    const parsed = parseFrontmatter(existing);
    const currentCount = parseInt(parsed.data.note_count, 10) || 0;
    const digestedThrough = parsed.data.digested_through || "null";

    const newFrontmatter = buildFrontmatter(monthStr, dateStr, currentCount + 1, digestedThrough);
    const body = parsed.body || "";

    fs.writeFileSync(filePath, newFrontmatter + body + entry);
  } else {
    // Create new file
    const frontmatter = buildFrontmatter(monthStr, dateStr, 1, "null");
    fs.writeFileSync(filePath, frontmatter + entry);
  }

  return { filePath, timestamp };
}

function buildFrontmatter(month, updated, noteCount, digestedThrough) {
  return `---
type: notes
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
    const enrichment = [];

    for (const line of lines) {
      if (line.startsWith("Tags:")) {
        tagsStr = line.replace("Tags:", "").trim();
      } else if (line.startsWith("Promoted-to:")) {
        promotedTo = line.replace("Promoted-to:", "").trim();
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
      enrichment,
    });
  }

  return {
    frontmatter: parsed.data,
    entries,
  };
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
  const backlogDir = path.join(pmDir, "backlog");

  let names;
  try {
    names = fs.readdirSync(backlogDir);
  } catch {
    return "PM-001";
  }

  let max = 0;
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(backlogDir, name), "utf8");
    const match = content.match(/^id:\s*"?PM-(\d+)"?\s*$/m);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }

  return `PM-${String(max + 1).padStart(3, "0")}`;
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
    throw new Error(
      `Note entry "${entryTimestamp}" is already promoted to "${entry.promoted_to}"`
    );
  }

  const slug = slugify(entry.body, 4);
  if (!slug) {
    throw new Error("Cannot derive slug from empty note body");
  }

  const id = nextBacklogId(pmDir);
  const today = todayIso();

  const backlogDir = path.join(pmDir, "backlog");
  fs.mkdirSync(backlogDir, { recursive: true });
  const backlogPath = path.join(backlogDir, `${slug}.md`);

  if (fs.existsSync(backlogPath)) {
    throw new Error(`Backlog item already exists at ${backlogPath} — slug collision`);
  }

  const tags = entry.tags
    ? entry.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const labelsYaml = tags.length > 0
    ? tags.map((t) => `  - ${t}`).join("\n")
    : "  - uncategorized";

  const backlogContent = `---
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

  writeAtomic(backlogPath, backlogContent);

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
  parseNotesFile,
  promoteNoteToIdea,
};
