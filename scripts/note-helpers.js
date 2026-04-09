"use strict";

const fs = require("fs");
const path = require("path");
const { parseFrontmatter } = require("./kb-frontmatter.js");

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
    const enrichment = [];

    for (const line of lines) {
      if (line.startsWith("Tags:")) {
        tagsStr = line.replace("Tags:", "").trim();
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
      enrichment,
    });
  }

  return {
    frontmatter: parsed.data,
    entries,
  };
}

module.exports = {
  writeNote,
  parseNotesFile,
};
