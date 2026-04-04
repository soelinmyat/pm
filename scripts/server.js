const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildStatus } = require('./start-status.js');

// ========== WebSocket Protocol (RFC 6455) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0A };
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function computeAcceptKey(clientKey) {
  return crypto.createHash('sha1').update(clientKey + WS_MAGIC).digest('base64');
}

function encodeFrame(opcode, payload) {
  const fin = 0x80;
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = fin | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = fin | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = fin | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null;

  const secondByte = buffer[1];
  const opcode = buffer[0] & 0x0F;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7F;
  let offset = 2;

  if (!masked) throw new Error('Client frames must be masked');

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }

  const maskOffset = offset;
  const dataOffset = offset + 4;
  const totalLen = dataOffset + payloadLen;
  if (buffer.length < totalLen) return null;

  const mask = buffer.slice(maskOffset, dataOffset);
  const data = Buffer.alloc(payloadLen);
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[dataOffset + i] ^ mask[i % 4];
  }

  return { opcode, payload: data, bytesConsumed: totalLen };
}

// ========== Configuration ==========

const PORT = process.env.PM_PORT || (49152 + Math.floor(Math.random() * 16383));
const HOST = process.env.PM_HOST || '127.0.0.1';
const URL_HOST = process.env.PM_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);

const OWNER_PID = process.env.PM_OWNER_PID ? Number(process.env.PM_OWNER_PID) : null;

function requireDashboardMode(value) {
  const mode = value || 'dashboard';
  if (mode !== 'dashboard') {
    throw new Error(`Unsupported PM server mode "${mode}". Use --mode dashboard.`);
  }
  return mode;
}

// --dir flag: directory for dashboard mode (default: 'pm/' relative to cwd)
const DIR_FLAG = (() => {
  const idx = process.argv.indexOf('--dir');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
})();

// ========== Mode Parsing (exported for testing) ==========

function parseMode(argv) {
  const idx = argv.indexOf('--mode');
  if (idx !== -1 && argv[idx + 1]) return requireDashboardMode(argv[idx + 1]);
  return requireDashboardMode(process.env.PM_MODE || 'dashboard');
}

// ========== YAML Frontmatter Parser ==========

/**
 * Parse YAML frontmatter from a markdown file content string.
 * Handles three shapes:
 *   1. Flat key-value:  key: value
 *   2. Scalar arrays:   key:\n  - item
 *   3. Array of objects: key:\n  - field: val\n    field2: val2
 *
 * Returns { data: {}, body: '...' }
 */
function parseFrontmatter(content) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = content.match(FM_RE);
  if (!match) return { data: {}, body: content };

  const rawYaml = match[1];
  const body = match[2] || '';
  const data = {};

  const lines = rawYaml.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Skip empty lines
    if (line.trim() === '') { i++; continue; }

    // Top-level key (not indented, not a list item)
    const keyMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
    if (!keyMatch) { i++; continue; }

    const key = keyMatch[1];
    const inlineVal = keyMatch[2].trim();

    if (inlineVal !== '') {
      // Flat key-value — strip surrounding quotes
      data[key] = inlineVal.replace(/^["'](.*)["']$/, '$1');
      i++;
      continue;
    }

    // No inline value — check if next lines are array items
    const items = [];
    i++;
    while (i < lines.length) {
      const next = lines[i];
      // Check if this is an indented list item (scalar or object start)
      const scalarItemMatch = next.match(/^[ \t]+-\s+([^:\n]+)$/);
      const objItemMatch = next.match(/^[ \t]+-\s+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
      const contObjMatch = next.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);

      if (objItemMatch) {
        // Start of an object item
        const obj = {};
        obj[objItemMatch[1]] = objItemMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
        i++;
        // Collect continuation lines for this object
        while (i < lines.length) {
          const cont = lines[i];
          const contMatch = cont.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
          if (contMatch && !cont.match(/^[ \t]+-\s/)) {
            obj[contMatch[1]] = contMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
            i++;
          } else {
            break;
          }
        }
        items.push(obj);
      } else if (scalarItemMatch) {
        items.push(scalarItemMatch[1].trim().replace(/^["'](.*)["']$/, '$1'));
        i++;
      } else if (contObjMatch && items.length > 0 && typeof items[items.length - 1] === 'object') {
        // Continuation of last object (shouldn't normally reach here but be safe)
        items[items.length - 1][contObjMatch[1]] = contObjMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
        i++;
      } else {
        // No more items for this key
        break;
      }
    }

    if (items.length > 0) {
      data[key] = items;
    }
    // (if items.length === 0 and no inline val, key is null/undefined — skip)
  }

  return { data, body };
}

// ========== Simple Markdown-to-HTML Renderer ==========

function renderMarkdown(md) {
  const lines = md.split('\n');
  const out = [];
  let inCodeBlock = false;
  let inMermaid = false;
  let inList = false;
  let inTable = false;
  let tableHeaderDone = false;

  function closeList() {
    if (inList) { out.push('</ul>'); inList = false; }
  }
  function closeTable() {
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeaderDone = false; }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('```')) {
      closeList(); closeTable();
      if (inCodeBlock) { out.push('</code></pre>'); inCodeBlock = false; }
      else if (inMermaid) { out.push('</pre>'); inMermaid = false; }
      else if (line.trim() === '```mermaid') { out.push('<pre class="mermaid">'); inMermaid = true; }
      else { out.push('<pre><code>'); inCodeBlock = true; }
      continue;
    }

    if (inMermaid) {
      out.push(escHtml(line));
      continue;
    }

    if (inCodeBlock) {
      out.push(escHtml(line));
      continue;
    }

    // Table detection: line contains |
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      closeList();
      const cells = line.trim().slice(1, -1).split('|').map(c => c.trim());
      // Separator row?
      if (cells.every(c => /^[-: ]+$/.test(c))) {
        if (!tableHeaderDone) {
          out.push('</thead><tbody>');
          tableHeaderDone = true;
        }
        continue;
      }
      if (!inTable) {
        out.push('<table><thead>');
        inTable = true;
        tableHeaderDone = false;
        const row = cells.map(c => '<th>' + inlineMarkdown(c) + '</th>').join('');
        out.push('<tr>' + row + '</tr>');
        continue;
      }
      const tag = tableHeaderDone ? 'td' : 'th';
      const row = cells.map(c => '<' + tag + '>' + inlineMarkdown(c) + '</' + tag + '>').join('');
      out.push('<tr>' + row + '</tr>');
      continue;
    } else {
      closeTable();
    }

    // Headings
    const h6 = line.match(/^######\s+(.*)/);
    const h5 = line.match(/^#####\s+(.*)/);
    const h4 = line.match(/^####\s+(.*)/);
    const h3 = line.match(/^###\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    const h1 = line.match(/^#\s+(.*)/);
    if (h6) { closeList(); out.push('<h6>' + inlineMarkdown(h6[1]) + '</h6>'); continue; }
    if (h5) { closeList(); out.push('<h5>' + inlineMarkdown(h5[1]) + '</h5>'); continue; }
    if (h4) { closeList(); out.push('<h4>' + inlineMarkdown(h4[1]) + '</h4>'); continue; }
    if (h3) { closeList(); out.push('<h3>' + inlineMarkdown(h3[1]) + '</h3>'); continue; }
    if (h2) { closeList(); out.push('<h2>' + inlineMarkdown(h2[1]) + '</h2>'); continue; }
    if (h1) { closeList(); out.push('<h1>' + inlineMarkdown(h1[1]) + '</h1>'); continue; }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList(); out.push('<hr>'); continue;
    }

    // List items
    const liMatch = line.match(/^[ \t]*[-*+]\s+(.*)/);
    if (liMatch) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inlineMarkdown(liMatch[1]) + '</li>');
      continue;
    } else {
      closeList();
    }

    // HTML comments (pass through for VIZ_PLACEHOLDER injection)
    if (/^\s*<!--.*-->\s*$/.test(line)) {
      closeList();
      out.push(line.trim());
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      continue;
    }

    // Paragraph
    out.push('<p>' + inlineMarkdown(line) + '</p>');
  }

  closeList();
  closeTable();
  if (inCodeBlock) out.push('</code></pre>');

  return out.join('\n');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inlineMarkdown(str) {
  // Escape HTML entities first to prevent XSS
  str = escHtml(str);
  // Bold+italic
  str = str.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  str = str.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links — sanitize href to block javascript:/data:/vbscript: schemes
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const scheme = url.trim().toLowerCase();
    if (/^(javascript|data|vbscript):/i.test(scheme)) return text;
    return '<a href="' + url + '">' + text + '</a>';
  });
  return str;
}

// ========== Dashboard CSS ==========

const DASHBOARD_CSS = `
/* ===== LIGHT THEME (default) ===== */
:root {
  color-scheme: light;
  --bg: #f7f8fb;
  --surface: #ffffff;
  --surface-raised: #eef0f4;
  --surface-hover: #f0f2f5;
  --border: rgba(0,0,0,0.06);
  --border-strong: rgba(0,0,0,0.12);
  --text: #1e2128;
  --text-secondary: #555;
  --text-muted: #6b7280;
  --text-faint: #9ca3af;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #4f5bc4;
  --accent-subtle: #eef0ff;
  --dark: #1a1a2e;
  --success: #16a34a;
  --warning: #ea580c;
  --info: #0891b2;
  --error: #dc2626;
  --error-text: #f87171;
  --teal: #044842;
  --radius: 10px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.07);
  --transition: 180ms ease-out;
  --badge-success-bg: #dcfce7;
  --badge-success-text: #166534;
  --badge-warning-bg: #fef3c7;
  --badge-warning-text: #92400e;
  --badge-error-bg: #fee2e2;
  --badge-error-text: #991b1b;
  --badge-info-bg: #dbeafe;
  --badge-info-text: #1d4ed8;
  --badge-neutral-bg: #f3f4f6;
  --badge-neutral-text: #6b7280;
  --selection-bg: rgba(94,106,210,0.2);
  --scrollbar-thumb: #d1d5db;
  --scrollbar-thumb-hover: #9ca3af;

  /* Spacing scale (4px base) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;

  /* Text scale */
  --text-xs: 0.6875rem;   /* 11px */
  --text-sm: 0.8125rem;   /* 13px */
  --text-base: 0.875rem;  /* 14px */
  --text-md: 1rem;         /* 16px */
  --text-lg: 1.5rem;       /* 24px */
}

/* ===== LIGHT THEME (explicit, mirrors :root) ===== */
[data-theme="light"] {
  color-scheme: light;
  --bg: #f7f8fb;
  --surface: #ffffff;
  --surface-raised: #eef0f4;
  --surface-hover: #f0f2f5;
  --border: rgba(0,0,0,0.06);
  --border-strong: rgba(0,0,0,0.12);
  --text: #1e2128;
  --text-secondary: #555;
  --text-muted: #6b7280;
  --text-faint: #9ca3af;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #4f5bc4;
  --accent-subtle: #eef0ff;
  --dark: #1a1a2e;
  --success: #16a34a;
  --warning: #ea580c;
  --info: #0891b2;
  --error: #dc2626;
  --error-text: #f87171;
  --teal: #044842;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.07);
  --badge-success-bg: #dcfce7;
  --badge-success-text: #166534;
  --badge-warning-bg: #fef3c7;
  --badge-warning-text: #92400e;
  --badge-error-bg: #fee2e2;
  --badge-error-text: #991b1b;
  --badge-info-bg: #dbeafe;
  --badge-info-text: #1d4ed8;
  --badge-neutral-bg: #f3f4f6;
  --badge-neutral-text: #6b7280;
  --selection-bg: rgba(94,106,210,0.2);
  --scrollbar-thumb: #d1d5db;
  --scrollbar-thumb-hover: #9ca3af;
}

/* ===== DARK THEME ===== */
[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0d0f12;
  --surface: #1a1d23;
  --surface-raised: #222630;
  --surface-hover: #262a33;
  --border: rgba(255,255,255,0.08);
  --border-strong: rgba(255,255,255,0.14);
  --text: #e8eaed;
  --text-secondary: #a0a4ab;
  --text-muted: #8b8f96;
  --text-faint: #4a4f57;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #7c85e0;
  --accent-subtle: #1e1f35;
  --dark: #111318;
  --success: #4ade80;
  --warning: #fbbf24;
  --info: #38bdf8;
  --error: #f87171;
  --error-text: #f87171;
  --teal: #2dd4bf;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.4);
  --badge-success-bg: #132b1a;
  --badge-success-text: #4ade80;
  --badge-warning-bg: #2e2810;
  --badge-warning-text: #fbbf24;
  --badge-error-bg: #2e1a1a;
  --badge-error-text: #f87171;
  --badge-info-bg: #1a2040;
  --badge-info-text: #818cf8;
  --badge-neutral-bg: #222630;
  --badge-neutral-text: #8b8f96;
  --selection-bg: rgba(94,106,210,0.3);
  --scrollbar-thumb: rgba(255,255,255,0.1);
  --scrollbar-thumb-hover: rgba(255,255,255,0.18);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
a:hover { color: var(--accent-hover); text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
button:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible,
input:focus-visible, select:focus-visible, textarea:focus-visible {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  outline: none;
  border-radius: 4px;
}

/* Nav */
nav { background: var(--dark); padding: 0 1.5rem; display: flex; gap: 0; align-items: stretch; min-height: 48px; }
nav .brand { color: var(--text-on-accent); font-weight: 700; font-size: 0.9375rem; display: flex; align-items: center;
  margin-right: 1.5rem; letter-spacing: -0.01em; }
nav a { color: rgba(255,255,255,0.6); font-size: 0.8125rem; padding: 0 0.875rem;
  display: flex; align-items: center; border-bottom: 2px solid transparent;
  transition: color var(--transition), border-color var(--transition); text-decoration: none; }
nav a:hover { color: rgba(255,255,255,0.9); text-decoration: none; }
nav a.active { color: var(--text-on-accent); border-bottom-color: var(--accent); }
nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Layout */
main.main-content { display: block; }
.container { max-width: 1120px; margin: 0 auto; padding: 2rem 1.5rem; }

/* Typography */
h1 { font-size: 1.625rem; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: -0.02em; }
h2 { font-size: 1.1875rem; font-weight: 600; margin: 1.75rem 0 0.75rem; letter-spacing: -0.01em; }
h3 { font-size: 0.9375rem; font-weight: 600; margin: 1rem 0 0.5rem; }
p { margin-bottom: 0.75rem; }
ul { margin: 0.5rem 0 0.75rem 1.5rem; }
li { margin-bottom: 0.25rem; }
pre { background: var(--dark); color: var(--text-muted); padding: 1rem; border-radius: var(--radius-sm);
  overflow-x: auto; margin: 0.75rem 0; font-size: 0.8125rem; line-height: 1.5; }
code { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.85em; }
p code, li code { background: var(--surface-raised); padding: 0.15em 0.35em; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
th { background: var(--surface-raised); font-weight: 600; font-size: 0.8125rem; text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.stat-card { background: var(--surface); border-radius: var(--radius);
  padding: 1.25rem; text-align: center; box-shadow: var(--shadow-sm); }
.stat-card .value { font-size: 2rem; font-weight: 700; color: var(--accent); line-height: 1; }
.stat-card .label { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;
  text-transform: uppercase; letter-spacing: 0.05em; }

/* Card grid */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.card { background: var(--surface); border-radius: var(--radius);
  padding: 1.25rem; display: flex; flex-direction: column; box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition), transform var(--transition); }
.card:hover { box-shadow: var(--shadow-md); transform: translateY(-1px); }
.card h3 { margin: 0 0 0.25rem; }
.card .meta { font-size: 0.8125rem; color: var(--text-muted); margin: 0; }
.card .card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 0.75rem; }
.card .card-footer .view-link { font-size: 0.8125rem; font-weight: 500; }

/* Kanban */
.kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: 1.5rem 0; align-items: start; }
.kanban-col { background: transparent; border: none; border-radius: 0;
  overflow: hidden; box-shadow: none; border-right: 1px solid var(--border-strong); }
.kanban-col:last-child { border-right: none; }
.kanban-col .col-header { background: transparent; padding: 0.5rem 1rem 0.75rem; font-weight: 600;
  font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.kanban-col .col-body { padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.kanban-col.col-empty { opacity: 0.45; }
.kanban-col.col-empty .col-body { min-height: 3rem; }
.kanban-col.shipped .kanban-item { opacity: 0.7; }
.kanban-col.shipped .kanban-item:hover { opacity: 1; }
.status-badge { font-size: 0.6875rem; padding: 0.125rem 0.5rem; border-radius: 9999px; font-weight: 500; margin-left: 0.5rem; }
.badge-in-progress { background: var(--badge-info-bg); color: var(--accent); }
.badge-approved { background: var(--badge-success-bg); color: var(--badge-success-text); }
.kanban-item { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem;
  font-size: 0.875rem; transition: box-shadow var(--transition); border-left: 3px solid var(--border); }
.kanban-item.priority-critical { border-left-color: var(--error); }
.kanban-item.priority-high { border-left-color: var(--warning); }
.kanban-item.priority-medium { border-left-color: var(--info); }
.kanban-item.priority-low { border-left-color: var(--text-faint); }
.kanban-item:hover { box-shadow: var(--shadow-sm); }
a.kanban-item { color: var(--text); text-decoration: none; display: block; cursor: pointer; }
.kanban-id { font-size: 0.6875rem; font-weight: 600; color: var(--accent); white-space: nowrap; }
.kanban-parent { font-size: 0.6875rem; color: var(--text-muted); white-space: nowrap; }
.backlog-item-id { font-size: 0.75em; font-weight: 600; color: var(--accent); }
.issue-relations { margin-top: 0.75rem; padding: 0.75rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; }
.issue-relation { font-size: 0.875rem; margin-bottom: 0.375rem; }
.issue-relation:last-child { margin-bottom: 0; }
.relation-label { font-weight: 600; color: var(--text-muted); }
.issue-relation a { color: var(--accent); text-decoration: none; }
.issue-relation a:hover { text-decoration: underline; }
.issue-children { margin: 0.25rem 0 0 1.25rem; padding: 0; }
.issue-children li { margin-bottom: 0.125rem; }
.wireframe-embed { margin: 1.5rem 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.wireframe-header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; background: var(--surface); border-bottom: 1px solid var(--border); }
.wireframe-label { font-size: 0.8125rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.wireframe-open { font-size: 0.75rem; color: var(--accent); text-decoration: none; }
.wireframe-open:hover { text-decoration: underline; }
.wireframe-iframe { width: 100%; height: 500px; border: none; background: var(--surface); }
.kanban-item-ids { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.kanban-item-title { font-weight: 500; }
.kanban-item-meta { display: flex; align-items: center; gap: 0.375rem; margin-top: 0.375rem; flex-wrap: wrap; }
.kanban-label { font-size: 0.6875rem; padding: 0.0625rem 0.4rem; border-radius: 9999px; background: var(--surface-raised); color: var(--text-muted); }
.kanban-scope { font-size: 0.6875rem; padding: 0.0625rem 0.4rem; border-radius: 9999px; font-weight: 500; }
.scope-small { background: var(--badge-success-bg); color: var(--badge-success-text); }
.scope-medium { background: var(--badge-info-bg); color: var(--accent); }
.scope-large { background: var(--badge-warning-bg); color: var(--badge-warning-text); }
.backlog-legend { display: flex; gap: 1rem; margin-top: 0.5rem; }
.legend-item { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--text-muted); }
.legend-bar { width: 3px; height: 14px; border-radius: 2px; }
.legend-bar.priority-critical { background: var(--error); }
.legend-bar.priority-high { background: var(--warning); }
.legend-bar.priority-medium { background: var(--info); }
.legend-bar.priority-low { background: var(--text-faint); }
.kanban-item a:hover { color: var(--accent); text-decoration: none; }
.kanban-view-all { display: block; text-align: center; padding: 0.5rem; font-size: 0.8125rem; color: var(--accent); text-decoration: none; border-top: 1px solid var(--border); margin-top: 0.25rem; }
.kanban-view-all:hover { text-decoration: underline; }
.col-count { font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }
/* ===== SHIPPED PAGE ===== */
.shipped-items { display: flex; flex-direction: column; gap: var(--space-3); }
.shipped-item-card {
  padding: var(--space-5) var(--space-6); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
  display: block;
}
.shipped-item-card:hover { background: var(--surface-raised, var(--surface)); }

.shipped-item-header {
  display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2);
}
.shipped-item-id {
  font-size: var(--text-xs); font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums;
}
.shipped-item-title {
  font-size: var(--text-base); font-weight: 600; letter-spacing: -0.01em; flex: 1;
}
.shipped-item-date {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

.shipped-item-outcome {
  font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5;
  margin-bottom: var(--space-3);
}

.shipped-item-tags {
  display: flex; flex-wrap: wrap; gap: var(--space-2);
}
.shipped-tag {
  display: inline-flex; align-items: center; gap: var(--space-1);
  padding: var(--space-1) var(--space-2); border-radius: var(--space-1);
  font-size: var(--text-xs); font-weight: 500;
}
.shipped-tag-label { padding: var(--space-1) var(--space-2); border-radius: var(--space-1); font-size: var(--text-xs); font-weight: 500; }
.shipped-tag-research {
  background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent);
}
.shipped-tag-strategy {
  background: color-mix(in srgb, var(--success) 10%, transparent); color: var(--success);
}
.shipped-tag-competitor {
  background: color-mix(in srgb, var(--warning) 10%, transparent); color: var(--warning);
}
.shipped-item-sub {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
}
.shipped-item-research { display: contents; }

/* Tabs */
.tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; }
.tab { padding: 0.625rem 1rem; cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -2px; font-size: 0.8125rem; font-weight: 500; color: var(--text-muted);
  transition: color var(--transition), border-color var(--transition); user-select: none; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; animation: fadeIn 150ms ease-out; }

/* Badges */
.badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 4px; font-size: 0.6875rem;
  font-weight: 600; background: var(--surface-raised); color: var(--text-muted); vertical-align: middle;
  letter-spacing: 0.02em; }
.badge-ready { background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-empty { background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
.badge-fresh { background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-aging { background: var(--badge-warning-bg); color: var(--badge-warning-text); }
.badge-stale { background: var(--badge-error-bg); color: var(--badge-error-text); }
.badge-origin-internal { background: var(--badge-info-bg); color: var(--badge-info-text); }
.badge-origin-external { background: var(--badge-neutral-bg); color: var(--text-muted); }
.badge-origin-mixed { background: var(--badge-warning-bg); color: var(--badge-warning-text); }
.badge-evidence { background: var(--badge-info-bg); color: var(--badge-info-text); }

/* Content sections */
.content-section { margin-top: 2rem; }
.content-section h2 { margin-top: 0; }

/* Action hints */
.action-hint { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem; }
.action-hint code { background: var(--accent-subtle); padding: 0.125em 0.375em; border-radius: 3px; font-size: 0.75rem; color: var(--accent); }
.col-hint { font-size: 0.6875rem; color: var(--text-muted); padding: 0 1rem 0.25rem; }
.col-hint code { background: var(--accent-subtle); padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.6875rem; color: var(--accent); }
.kanban-item-hint { font-size: 0.625rem; color: var(--text-muted); margin-top: 0.25rem; }
.suggested-next { margin-top: 1.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.suggested-next-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.375rem; }
.suggested-next code { background: var(--accent-subtle); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.8125rem; color: var(--accent); }
.session-brief-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 0.75rem; padding-top: 0.5rem; }
.session-brief-row:first-of-type { padding-top: 0; }
.session-brief-key { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.session-brief-value { min-width: 0; }
.session-brief-actions { margin-top: 0.875rem; padding-top: 0.875rem; border-top: 1px solid var(--border); }
.session-brief-actions-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.375rem; }
.session-brief-actions ul { margin: 0.375rem 0 0; padding-left: 1.125rem; color: var(--text-muted); }
.session-brief-actions li { margin-top: 0.25rem; }

/* Empty states */
.empty-state { text-align: center; padding: var(--space-12) var(--space-6); color: var(--text-muted);
  border: 2px dashed var(--border); border-radius: var(--radius); margin: var(--space-4) 0; }
.empty-state h2 { color: var(--text); margin-bottom: var(--space-2); font-size: var(--text-xl); }
.empty-state h3 { color: var(--text); margin-bottom: var(--space-2); font-size: var(--text-lg); }
.empty-state p { max-width: 480px; margin-left: auto; margin-right: auto; font-size: var(--text-base);
  line-height: 1.6; margin-bottom: var(--space-3); }
.empty-state p:last-of-type { margin-bottom: var(--space-4); }
.empty-state code { background: var(--accent-subtle); padding: 0.2em 0.5em; border-radius: 4px;
  font-size: var(--text-sm); color: var(--accent); }
.empty-state .click-to-copy { margin-top: var(--space-4); }
.empty-state-cta-label { font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-1); }

/* Page header */
.page-header { margin-bottom: 2rem; }
.page-header .subtitle { color: var(--text-muted); margin-top: 0.125rem; font-size: 0.9375rem; }
.page-header .breadcrumb { font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 0.375rem; }
.page-header .breadcrumb a { color: var(--text-muted); }
.page-header .breadcrumb a:hover { color: var(--accent); }
.topic-badges { display: flex; gap: 0.375rem; flex-wrap: wrap; margin-top: 0.5rem; }

/* Markdown body — content pages */
.markdown-body { max-width: 820px; }
.markdown-body h1 { font-size: 1.5rem; margin: 2rem 0 0.75rem; }
.markdown-body h2 { font-size: 1.25rem; margin: 1.75rem 0 0.625rem; }
.markdown-body h3 { font-size: 1rem; margin: 1.25rem 0 0.5rem; }
.markdown-body p { line-height: 1.7; }
.markdown-body ul, .markdown-body ol { margin-left: 1.25rem; }
.markdown-body li { margin-bottom: 0.375rem; line-height: 1.6; }
.markdown-body table { font-size: 0.8125rem; }
.markdown-body table th { white-space: nowrap; }
.markdown-body strong { font-weight: 600; }

/* SWOT grid */
.swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.5rem 0; }
.swot-box { border-radius: var(--radius); padding: 1.25rem; border: 1px solid var(--border); }
.swot-box h4 { font-size: 0.8125rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.75rem; }
.swot-box ul { margin: 0; padding-left: 1.25rem; font-size: 0.875rem; }
.swot-box li { margin-bottom: 0.375rem; line-height: 1.5; }
.swot-strengths { background: var(--badge-success-bg); border-color: var(--border); }
.swot-strengths h4 { color: var(--badge-success-text); }
.swot-weaknesses { background: var(--badge-error-bg); border-color: var(--border); }
.swot-weaknesses h4 { color: var(--badge-error-text); }
.swot-opportunities { background: var(--badge-info-bg); border-color: var(--border); }
.swot-opportunities h4 { color: var(--badge-info-text); }
.swot-threats { background: var(--badge-warning-bg); border-color: var(--border); }
.swot-threats h4 { color: var(--badge-warning-text); }
@media (max-width: 700px) { .swot-grid { grid-template-columns: 1fr; } }

/* Scatter plot */
.scatter-container { position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 2.5rem 2.5rem 2.5rem 3rem; margin: 1.5rem 0 3rem 0; aspect-ratio: 16/10; }
.scatter-area { position: relative; width: 100%; height: 100%; }
.scatter-dot { position: absolute; border-radius: 50%; background: var(--accent); opacity: 0.85;
  transform: translate(-50%, -50%); transition: opacity var(--transition), transform var(--transition); cursor: default; }
.scatter-dot:hover { opacity: 1; transform: translate(-50%, -50%) scale(1.15); z-index: 2; }
.scatter-dot.highlight { background: var(--teal); opacity: 1; }
.scatter-label { position: absolute; transform: translate(-50%, 0); font-size: 0.6875rem; font-weight: 600;
  white-space: nowrap; color: var(--text); text-align: center; pointer-events: none; }
.scatter-axis-x, .scatter-axis-y { position: absolute; font-size: 0.6875rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.scatter-axis-x { bottom: -1.75rem; left: 50%; transform: translateX(-50%); }
.scatter-axis-y { top: 50%; left: -2.5rem; transform: translateY(-50%) rotate(-90deg); }
.scatter-axis-label { position: absolute; font-size: 0.625rem; color: var(--text-muted); }
.scatter-axis-label-left { left: 0; }
.scatter-axis-label-right { right: 0; }
.scatter-axis-label-top { top: 0; }
.scatter-axis-label-bottom { bottom: 0; }
.scatter-gridline { position: absolute; background: var(--border); }
.scatter-gridline-h { left: 0; right: 0; height: 1px; }
.scatter-gridline-v { top: 0; bottom: 0; width: 1px; }
.scatter-legend { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.75rem; font-size: 0.75rem; color: var(--text-muted); }
.scatter-legend-item { display: flex; align-items: center; gap: 0.375rem; }
.scatter-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

/* Quadrant chart */
.quadrant-container { position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 2rem; margin: 1.5rem 0; }
.quadrant-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 2px; background: var(--border); aspect-ratio: 1.6/1; }
.quadrant-cell { background: var(--surface); padding: 1rem; position: relative; }
.quadrant-cell-label { position: absolute; top: 0.5rem; left: 0.75rem; font-size: 0.6875rem;
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); opacity: 0.7; }
.quadrant-item { display: inline-block; padding: 0.25em 0.625em; border-radius: 4px; font-size: 0.75rem;
  font-weight: 500; margin: 0.25rem; cursor: default; }
.quadrant-items { display: flex; flex-wrap: wrap; gap: 0.25rem; margin-top: 1.5rem; }
.quadrant-q1 { background: var(--badge-success-bg); color: var(--badge-success-text); }
.quadrant-q2 { background: var(--badge-warning-bg); color: var(--badge-warning-text); }
.quadrant-q3 { background: var(--badge-info-bg); color: var(--accent); }
.quadrant-q4 { background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
.quadrant-axis-x { text-align: center; font-size: 0.6875rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-top: 0.75rem; }
.quadrant-axis-y { position: absolute; top: 50%; left: -2rem; transform: translateY(-50%) rotate(-90deg);
  font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

/* Heatmap */
.heatmap-table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.8125rem; }
.heatmap-table th, .heatmap-table td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: center; }
.heatmap-table th { background: var(--surface-raised); font-weight: 600; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
.heatmap-table th:first-child, .heatmap-table td:first-child { text-align: left; font-weight: 500; }
.heatmap-pillar { background: var(--dark); color: var(--text-on-accent); font-weight: 700; font-size: 0.6875rem;
  text-transform: uppercase; letter-spacing: 0.05em; }
.heatmap-full { background: var(--badge-success-bg); color: var(--badge-success-text); font-weight: 600; }
.heatmap-partial { background: var(--badge-warning-bg); color: var(--badge-warning-text); font-weight: 600; }
.heatmap-missing { background: var(--badge-error-bg); color: var(--badge-error-text); font-weight: 600; }
.heatmap-diff { background: var(--badge-success-bg); color: var(--teal); font-weight: 700; }

/* Horizontal bar chart */
.bar-chart { margin: 1.5rem 0; }
.bar-group { margin-bottom: 1.25rem; }
.bar-group-label { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; }
.bar-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; }
.bar-row-label { font-size: 0.75rem; color: var(--text-muted); width: 100px; flex-shrink: 0; text-align: right; }
.bar-track { flex: 1; height: 20px; background: var(--surface-raised); border-radius: 4px; position: relative; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 0.5rem;
  font-size: 0.6875rem; font-weight: 600; color: var(--text-on-accent); min-width: fit-content; }
.bar-fill-green { background: var(--success); }
.bar-fill-yellow { background: var(--warning); }
.bar-fill-red { background: var(--error); }
.bar-fill-blue { background: var(--accent); }
.bar-fill-teal { background: var(--teal); }
.bar-value { font-size: 0.75rem; font-weight: 600; color: var(--text); min-width: 36px; }

/* Timeline */
.timeline-container { margin: 1.5rem 0; padding: 1.5rem; background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius); }
.timeline-track { display: flex; gap: 0; position: relative; }
.timeline-phase { flex: 1; padding: 1rem; border: 1px solid var(--border); position: relative; }
.timeline-phase:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.timeline-phase:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.timeline-phase:not(:first-child) { border-left: none; }
.timeline-phase-name { font-size: 0.8125rem; font-weight: 700; margin-bottom: 0.5rem; }
.timeline-phase-focus { font-size: 0.75rem; color: var(--text-muted); }
.timeline-phase-focus li { margin-bottom: 0.125rem; }
.timeline-phase.active { background: var(--accent-subtle); border-color: var(--accent); }
.timeline-phase.active .timeline-phase-name { color: var(--accent); }
.timeline-arrow { position: absolute; right: -0.5rem; top: 50%; transform: translateY(-50%);
  width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-left: 8px solid var(--border); z-index: 1; }
.timeline-labels { display: flex; gap: 0; margin-top: 0.5rem; }
.timeline-label { flex: 1; text-align: center; font-size: 0.6875rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }

/* Coverage matrix */
.coverage-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.coverage-group { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  overflow: hidden; }
.coverage-group-header { padding: 0.75rem 1rem; font-weight: 600; font-size: 0.8125rem;
  text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
.coverage-group-body { padding: 0.5rem; }
.coverage-topic { display: flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.5rem;
  font-size: 0.8125rem; border-radius: var(--radius-sm); }
.coverage-topic:hover { background: var(--bg); }
.coverage-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.coverage-dot-fresh { background: var(--success); }
.coverage-dot-aging { background: var(--warning); }
.coverage-dot-stale { background: var(--error); }
.coverage-topic-name { flex: 1; }
.coverage-topic-subtitle { font-size: 0.6875rem; color: var(--text-muted); white-space: nowrap; }
.coverage-topic-badges { display: flex; gap: 0.25rem; }

/* Positioning map */
.positioning-map { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.5rem; margin: 1.5rem 0; box-shadow: var(--shadow-sm); }
.positioning-map h3 { margin: 0 0 1rem; font-size: 0.9375rem; }
.positioning-map svg { display: block; margin: 0 auto; }
.positioning-map .map-legend { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 1rem;
  justify-content: center; font-size: 0.75rem; color: var(--text-muted); }
.positioning-map .map-legend .legend-item { display: flex; align-items: center; gap: 0.35rem; }
.positioning-map .map-legend .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.positioning-map .map-axes { display: flex; justify-content: space-between; margin-top: 0.5rem;
  font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.positioning-map .map-y-label { position: absolute; font-size: 0.6875rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; }
.positioning-map .map-container { position: relative; }

/* KB sub-tabs */
.kb-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; }
.kb-tab { padding: 0.625rem 1rem; font-size: 0.8125rem; font-weight: 500; color: var(--text-muted);
  text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -2px;
  transition: color var(--transition), border-color var(--transition); }
.kb-tab:hover { color: var(--text); }
.kb-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* PM-129: Audit classes — inline style replacements */
.scatter-legend-note { margin-left: 1rem; font-style: italic; }
.scatter-axis-label-top { top: -1.25rem; left: 0; }
.scatter-axis-label-bottom { bottom: -2.75rem; left: 0; }
.scatter-gridline-h { top: 50%; }
.scatter-gridline-v { left: 50%; }
.scatter-axis-label-bl { bottom: -1.25rem; left: 0; }
.scatter-axis-label-br { bottom: -1.25rem; right: 0; }
.timeline-phase-gate { margin-top: 0.5rem; font-size: 0.6875rem; color: var(--text-muted); font-style: italic; }
.chart-description { font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem; }
.bar-group-meta { font-size: 0.6875rem; color: var(--text-muted); margin-top: 0.25rem; }
.heatmap-legend { font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.75rem; }
.heatmap-legend-badge { padding: 0.15em 0.5em; border-radius: 4px; margin-right: 0.5rem; }
.heatmap-legend-badge:last-child { margin-right: 0; }
.swot-empty { color: var(--text-muted); }
.page-count { font-size: 1rem; margin-left: 0.5rem; }
.coverage-legend { display: flex; gap: 1rem; font-size: 0.75rem; color: var(--text-muted); margin-bottom: 1rem; }
.coverage-legend-item { display: flex; align-items: center; gap: 0.25rem; }
.coverage-heading { margin-top: 0; }
.comparison-badge { font-size: 0.5625rem; }
.coverage-group-header--operational { background: var(--badge-success-bg); }
.coverage-group-header--payroll { background: var(--badge-info-bg); }
.coverage-group-header--exception { background: var(--badge-warning-bg); }
.coverage-group-header--ai { background: var(--accent-subtle); }
.coverage-group-header--ux { background: var(--badge-error-bg); }
.coverage-group-header--infrastructure { background: var(--badge-neutral-bg); }
.coverage-group-header--other { background: var(--badge-neutral-bg); }
.coverage-group-header--default { background: var(--surface-raised); }

/* ===== HOME SECTIONS ===== */
.home-section { margin-bottom: var(--space-12); }
.home-section-header {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: var(--space-4);
}
.home-section-title {
  font-size: var(--text-sm); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted);
}
.home-section-link {
  font-size: var(--text-sm); color: var(--accent); text-decoration: none; font-weight: 500;
}
.home-section-link:hover { color: var(--accent-hover, var(--accent)); }
.home-section-count {
  font-size: var(--text-xs); color: var(--text-muted); margin-left: var(--space-2);
}

/* Strategy snapshot */
.strategy-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--space-2); padding: var(--space-5) var(--space-6);
}
.strategy-focus {
  font-size: var(--text-md); font-weight: 600; letter-spacing: -0.01em;
  margin-bottom: var(--space-3); line-height: 1.4;
}
.strategy-priorities { display: flex; flex-direction: column; gap: var(--space-2); }
.priority-item {
  display: flex; align-items: baseline; gap: 10px;
  font-size: var(--text-base); color: var(--text-muted);
}
.priority-num {
  font-size: var(--text-xs); font-weight: 700; color: var(--accent);
  width: var(--space-5); flex-shrink: 0;
}
.staleness {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: var(--text-xs); color: var(--text-faint, var(--text-muted)); margin-top: var(--space-3);
}
.staleness-dot { width: 6px; height: 6px; border-radius: 50%; }
.staleness-dot.fresh { background: var(--success); }
.staleness-dot.aging { background: var(--warning); }
.staleness-dot.stale { background: var(--error); }

/* Proposal rows (home) */
.home-proposal-list { display: flex; flex-direction: column; gap: var(--space-2); }
.home-proposal-row {
  display: flex; align-items: center; gap: var(--space-4);
  padding: var(--space-3) var(--space-4); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.home-proposal-row:hover { background: var(--surface-raised, var(--surface)); }
.home-proposal-row .proposal-id {
  font-size: var(--text-xs); font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums; width: 36px; flex-shrink: 0;
}
.home-proposal-row .proposal-title { font-size: var(--text-base); font-weight: 500; flex: 1; }
.home-proposal-row .proposal-meta {
  font-size: var(--text-xs); color: var(--text-faint, var(--text-muted));
  display: flex; align-items: center; gap: var(--space-3);
}

/* Shipped items (home) */
.home-shipped-list { display: flex; flex-direction: column; gap: var(--space-2); }
.home-shipped-item {
  display: flex; align-items: baseline; gap: var(--space-3);
  padding: var(--space-3) var(--space-4); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.home-shipped-item:hover { background: var(--surface-raised, var(--surface)); }
.home-shipped-title { font-size: var(--text-base); font-weight: 500; flex: 1; }
.home-shipped-context { font-size: var(--text-xs); color: var(--text-faint, var(--text-muted)); }
.home-shipped-date {
  font-size: var(--text-xs); color: var(--text-faint, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* KB health grid */
.kb-health-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3); }
.kb-health-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--space-2); padding: var(--space-4) var(--space-5);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.kb-health-card:hover { background: var(--surface-raised, var(--surface)); }
.kb-health-value {
  font-size: var(--text-lg); font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.kb-health-label { font-size: var(--text-xs); color: var(--text-muted); margin-top: 2px; }
.kb-health-freshness {
  display: flex; align-items: center; gap: 6px;
  font-size: var(--text-xs); color: var(--text-faint, var(--text-muted)); margin-top: var(--space-2);
}

/* ===== PROPOSALS PAGE ===== */
.proposal-grid { display: flex; flex-direction: column; gap: var(--space-2); }

.proposal-card-row {
  display: flex; align-items: center;
  padding: var(--space-4) var(--space-5); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--space-2);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
  gap: var(--space-4);
}
.proposal-card-row:hover { background: var(--surface-raised, var(--surface)); }
.proposal-card-body { flex: 1; min-width: 0; }
.proposal-card-title {
  font-size: 15px; font-weight: 600; letter-spacing: -0.01em;
  margin-bottom: var(--space-1);
}
.proposal-card-outcome {
  font-size: var(--text-sm); color: var(--text-muted); line-height: 1.4;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.proposal-card-meta {
  display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0;
}
.badge-groomed { background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent); }
.badge-paused { background: var(--badge-error-bg); color: var(--badge-error-text); }
.proposal-id { margin-right: var(--space-2); }
.issue-count {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.updated {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Ideas rows */
.idea-list { display: flex; flex-direction: column; gap: var(--space-1); }
.idea-row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: 10px var(--space-4); border-radius: 6px;
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.idea-row:hover { background: var(--surface); }
.idea-id {
  font-size: var(--text-xs); font-weight: 600; color: var(--accent);
  font-variant-numeric: tabular-nums; width: 52px; flex-shrink: 0;
}
.idea-title { font-size: var(--text-base); color: var(--text-muted); flex: 1; }

.section { margin-bottom: var(--space-8); }
.section-header {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: var(--space-4);
}
.section-title {
  font-size: var(--text-sm); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted);
}
.section-count {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums;
}

/* ===== KB HUB PAGE ===== */

/* Strategy banner */
.strategy-banner {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--space-2); padding: var(--space-6);
  display: flex; align-items: flex-start; gap: var(--space-6);
  margin-bottom: var(--space-12);
}
.strategy-banner-content { flex: 1; }
.strategy-banner-label {
  font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--accent); margin-bottom: var(--space-2);
}
.strategy-banner-headline {
  font-size: var(--text-md); font-weight: 600; letter-spacing: -0.01em;
  line-height: 1.4; margin-bottom: var(--space-3);
}
.strategy-banner-priorities {
  display: flex; gap: var(--space-6); font-size: var(--text-sm); color: var(--text-muted);
}
.strategy-banner-priority { display: flex; align-items: baseline; gap: var(--space-2); }
.strategy-banner-actions {
  display: flex; flex-direction: column; gap: var(--space-2);
  flex-shrink: 0; align-items: flex-end;
}
.strategy-banner-meta {
  display: flex; align-items: center; gap: var(--space-2);
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
}
.btn-sm {
  padding: var(--space-1) var(--space-3); font-size: var(--text-xs); font-weight: 500;
  border-radius: var(--space-1); text-decoration: none;
  background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent);
  border: none; cursor: pointer; font-family: inherit;
  transition: background 150ms;
}
.btn-sm:hover { background: var(--accent); color: white; }

/* Landscape card */
.landscape-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--space-2); padding: var(--space-5) var(--space-6);
  text-decoration: none; color: var(--text); display: block;
  transition: background 150ms;
}
.landscape-card:hover { background: var(--surface-raised, var(--surface)); }
.landscape-title { font-size: var(--text-base); font-weight: 600; margin-bottom: var(--space-2); }
.landscape-summary {
  font-size: var(--text-sm); color: var(--text-muted); line-height: 1.5; margin-bottom: var(--space-3);
}
.landscape-stats { display: flex; gap: var(--space-6); }
.landscape-stat {
  font-size: var(--text-lg); font-weight: 700; letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.landscape-stat-label { font-size: var(--text-xs); color: var(--text-dim, var(--text-muted)); margin-top: var(--space-1); }

/* Competitor grid */
.competitor-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-3);
}
.competitor-card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--space-2); padding: var(--space-4) var(--space-5);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.competitor-card:hover { background: var(--surface-raised, var(--surface)); }
.competitor-name { font-size: var(--text-base); font-weight: 600; margin-bottom: var(--space-1); }
.competitor-category { font-size: var(--text-xs); color: var(--text-muted); }

/* Research topic rows */
.topic-list { display: flex; flex-direction: column; gap: var(--space-1); }
.topic-row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.topic-row:hover { background: var(--surface); }
.topic-name { font-size: var(--text-base); font-weight: 500; flex: 1; }
.topic-badges { display: flex; align-items: center; gap: var(--space-2); }
.topic-date {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Origin badges */
.badge-external { background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent); }
.badge-customer { background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-mixed { background: var(--badge-info-bg); color: var(--badge-info-text); }

/* Section link */
.section-link {
  font-size: var(--text-sm); color: var(--accent); text-decoration: none; font-weight: 500;
}
.section-link:hover { color: var(--accent-hover, var(--accent)); }
.view-all-wrap { text-align: center; margin-top: var(--space-3); }

/* Empty state for KB hub sections */
.empty-state-hub {
  border: 1px dashed var(--border); border-radius: var(--space-2);
  padding: var(--space-6); text-align: center;
}
.empty-state-hub-title { font-size: var(--text-base); font-weight: 600; margin-bottom: var(--space-1); }
.empty-state-hub-text { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-3); }

/* Detail page layout */
.detail-page { max-width: 720px; margin: 0 auto; }
.detail-breadcrumb { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-3); display: flex; align-items: center; gap: var(--space-1); }
.detail-breadcrumb a { color: var(--text-muted); text-decoration: none; }
.detail-breadcrumb a:hover { color: var(--accent); }
.breadcrumb-sep { color: var(--text-muted); opacity: 0.5; }
.breadcrumb-current { color: var(--text); }
.detail-title { font-size: var(--text-2xl); font-weight: 700; letter-spacing: -0.02em; margin-bottom: var(--space-3); }
.detail-id-badge { font-size: var(--text-sm); font-weight: 600; color: var(--accent); background: var(--accent-subtle); padding: 0.15em 0.5em; border-radius: 4px; margin-right: var(--space-2); vertical-align: middle; }
.detail-meta-bar { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-8); padding-bottom: var(--space-4); border-bottom: 1px solid var(--border); }
.detail-meta-bar .meta-item a { color: var(--accent); text-decoration: none; }
.detail-meta-bar .meta-item a:hover { text-decoration: underline; }
.meta-sep { color: var(--text-muted); opacity: 0.4; }
.detail-section { margin-top: var(--space-12); }
.detail-section-title { font-size: var(--text-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: var(--space-3); }
.detail-action-hint { margin-top: var(--space-12); padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); text-align: center; }
.click-to-copy { cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); background: var(--accent-subtle); border-radius: var(--radius-sm); transition: background var(--transition); border: none; font-family: inherit; }
.click-to-copy:hover { background: var(--accent); color: var(--text-on-accent); }
.click-to-copy:hover code { color: var(--text-on-accent); background: transparent; }
.click-to-copy code { font-size: var(--text-base); color: var(--accent); background: transparent; }
.copy-icon { font-size: var(--text-xs); opacity: 0.6; }
.detail-ac-list { list-style: none; padding: 0; margin: 0; }
.detail-ac-list li { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); font-size: var(--text-base); display: flex; align-items: flex-start; gap: var(--space-2); }
.detail-ac-list li:last-child { border-bottom: none; }
.detail-ac-list li::before { content: '\\2610'; color: var(--text-muted); flex-shrink: 0; }
.detail-strategy-card { padding: var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
.detail-research-tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.detail-research-tag { display: inline-block; padding: var(--space-1) var(--space-2); border-radius: var(--space-1); font-size: var(--text-xs); font-weight: 500; background: var(--accent-subtle); color: var(--accent); text-decoration: none; }
.detail-research-tag:hover { background: var(--accent); color: var(--text-on-accent); }
.detail-issue-list { list-style: none; padding: 0; margin: 0; }
.detail-issue-list li { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); }
.detail-issue-list li:last-child { border-bottom: none; }
.detail-issue-list a { color: var(--text); text-decoration: none; font-size: var(--text-base); }
.detail-issue-list a:hover { color: var(--accent); }
.detail-issue-id { font-size: var(--text-xs); font-weight: 600; color: var(--accent); margin-right: var(--space-1); }
.detail-proposal-iframe { height: 600px; }

/* Toast notifications */
.toast-container { position: fixed; bottom: var(--space-6); left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: var(--space-2); align-items: center; pointer-events: none; }
.toast { background: var(--dark); color: var(--text-on-accent); padding: var(--space-2) var(--space-4); border-radius: var(--radius-sm); font-size: var(--text-sm); font-weight: 500; animation: fadeIn 150ms ease-out; pointer-events: auto; }
.toast-out { opacity: 0; transition: opacity 200ms ease-out; }

/* Selection & scrollbar */
::selection { background: var(--selection-bg); }
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }

/* Theme toggle */
.theme-toggle { margin-left: auto; background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.6);
  font-size: var(--text-md); padding: 0 var(--space-2); display: flex; align-items: center; transition: color var(--transition); }
.theme-toggle:hover { color: rgba(255,255,255,0.9); }
.theme-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Animations */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

// ========== Dashboard HTML Shell ==========

function dashboardPage(title, activeNav, bodyContent, projectName) {
  projectName = projectName || _cachedProjectName || 'PM';
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/proposals', label: 'Proposals' },
    { href: '/roadmap', label: 'Roadmap' },
    { href: '/kb', label: 'Knowledge Base' },
  ];
  const navHtml = navLinks.map(l =>
    `<a href="${l.href}"${activeNav === l.href ? ' class="active"' : ''}>${l.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f8fb">
<title>${escHtml(title)} - ${escHtml(projectName)}</title>
<script>
(function(){var t=localStorage.getItem('pm-theme');if(!t){t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);document.querySelector('meta[name=theme-color]')&&document.querySelector('meta[name=theme-color]').setAttribute('content',t==='dark'?'#0d0f12':'#f7f8fb');})();
</script>
<style>${DASHBOARD_CSS}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose'});</script>
</head>
<body>
<nav aria-label="Main navigation">
  <span class="brand">${escHtml(projectName)}</span>
  ${navHtml}
  <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark/light mode" title="Toggle theme">&#9681;</button>
</nav>
<main class="main-content" role="main" id="main-content">
<div class="container">
${bodyContent}
</div>
</main>
<div id="toast-container" class="toast-container"></div>
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onmessage = function(e) {
    try { var d = JSON.parse(e.data); if (d.type === 'reload') location.reload(); } catch(err) {}
  };
})();
// Click-to-copy
document.addEventListener('click', function(e) {
  var el = e.target.closest('.click-to-copy');
  if (!el) return;
  var text = el.getAttribute('data-copy');
  if (!text) return;
  navigator.clipboard.writeText(text).then(function() {
    showCopyToast('Copied!');
  });
});
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var el = e.target.closest('.click-to-copy');
  if (!el) return;
  el.click();
});
function showCopyToast(msg) {
  var container = document.getElementById('toast-container');
  if (!container) return;
  var el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(function() {
    el.classList.add('toast-out');
    setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
  }, 1500);
}
// Theme toggle
(function() {
  var btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function getTheme() { return document.documentElement.getAttribute('data-theme') || 'light'; }
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('pm-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0d0f12' : '#f7f8fb');
  }
  btn.addEventListener('click', function() { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); });
})();
// "/" keyboard shortcut to focus search/filter input
document.addEventListener('keydown', function(e) {
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    var input = document.getElementById('backlog-search') || document.getElementById('roadmap-filter');
    if (input) { e.preventDefault(); input.focus(); }
  }
});
</script>
</body>
</html>`;
}

// ========== Positioning Map Renderer ==========

const SEGMENT_COLORS = {
  'enterprise':  '#5e6ad2',
  'mid-market':  '#5e6ad2',
  'smb':         '#16a34a',
  'horizontal':  '#ea580c',
  'self':        '#044842',
  'default':     '#6b7280',
};

// ========== Reusable HTML Helpers ==========

function renderClickToCopy(command) {
  if (typeof command !== 'string' || !command) return '';
  return `<span class="click-to-copy" data-copy="${escHtml(command)}" tabindex="0" role="button"><code>${escHtml(command)}</code><span class="copy-icon" aria-hidden="true">&#x2398;</span></span>`;
}

function renderEmptyState(title, desc, command, ctaLabel) {
  // NOTE: desc is raw HTML — callers must escape user-supplied values with escHtml()
  // class="empty-state"><h2> pattern kept inline for PM-126 static source scan
  return '<div class="empty-state"><h2>' + escHtml(title) + '</h2><p>' + desc + '</p>' +
    (command ? renderClickToCopy(command) : '') +
    (ctaLabel ? '<p class="empty-state-cta-label">' + escHtml(ctaLabel) + '</p>' : '') +
    '</div>';
}

function parseStatsData(mdBody) {
  var regex = /<!--\s*stat:\s*([^,]+),\s*(.+?)\s*-->/g;
  var stats = [];
  var match;
  while ((match = regex.exec(mdBody)) !== null) {
    stats.push({ value: match[1].trim(), label: match[2].trim() });
  }
  return stats.length > 0 ? stats : null;
}

function renderStatsCards(stats) {
  if (!stats) return '';
  var cards = stats.map(function(s) {
    return '<div class="stat-card"><div class="value">' + escHtml(s.value) + '</div><div class="label">' + escHtml(s.label) + '</div></div>';
  }).join('');
  return '<div class="stat-grid">' + cards + '</div>';
}

function parsePositioningData(mdBody) {
  const headerMatch = mdBody.match(/<!--\s*positioning:\s*company,\s*x\s*\(0-100,?\s*([^)]*)\),\s*y\s*\(0-100,?\s*([^)]*)\),\s*traffic,\s*segment-color\s*-->/i);
  if (!headerMatch) return null;

  const xDesc = headerMatch[1].trim();
  const yDesc = headerMatch[2].trim();

  const xParts = xDesc.split(/\s+to\s+/i);
  const xLabelLeft = xParts[0] || '';
  const xLabelRight = xParts[1] || '';
  const yParts = yDesc.split(/\s+to\s+/i);
  const yLabelBottom = yParts[0] || '';
  const yLabelTop = yParts[1] || '';

  const dataRegex = /<!--\s*([^,]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\w[\w-]*)\s*-->/g;
  const points = [];
  let match;
  while ((match = dataRegex.exec(mdBody)) !== null) {
    if (match[1].trim().toLowerCase() === 'positioning') continue;
    points.push({
      name: match[1].trim(),
      x: parseInt(match[2]),
      y: parseInt(match[3]),
      traffic: parseInt(match[4]),
      segment: match[5].trim().toLowerCase(),
    });
  }

  if (points.length === 0) return null;

  return { points, xLabelLeft, xLabelRight, yLabelBottom, yLabelTop };
}

function renderPositioningMap(data) {
  if (!data) return '';

  const W = 600, H = 400;
  const PAD = { top: 20, right: 30, bottom: 40, left: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxTraffic = Math.max(...data.points.map(function(p) { return p.traffic; }), 1);
  function bubbleRadius(traffic) {
    if (traffic <= 0) return 4;
    var minR = 4, maxR = 16;
    var logVal = Math.log10(traffic + 1);
    var logMax = Math.log10(maxTraffic + 1);
    return minR + (maxR - minR) * (logVal / logMax);
  }

  var bubbles = data.points.map(function(p) {
    var cx = PAD.left + (p.x / 100) * plotW;
    var cy = PAD.top + (1 - p.y / 100) * plotH;
    var r = bubbleRadius(p.traffic);
    var color = SEGMENT_COLORS[p.segment] || SEGMENT_COLORS['default'];
    var labelY = cy - r - 6 > PAD.top ? cy - r - 6 : cy + r + 14;
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="' + color + '" fill-opacity="0.7" stroke="' + color + '" stroke-width="1.5"/>' +
      '<text x="' + cx + '" y="' + labelY + '" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text)">' + escHtml(p.name) + '</text>';
  }).join('\n    ');

  var gridLines = [];
  for (var i = 0; i <= 4; i++) {
    var gx = PAD.left + (i / 4) * plotW;
    var gy = PAD.top + (i / 4) * plotH;
    gridLines.push('<line x1="' + gx + '" y1="' + PAD.top + '" x2="' + gx + '" y2="' + (PAD.top + plotH) + '" stroke="var(--border)" stroke-dasharray="4,4"/>');
    gridLines.push('<line x1="' + PAD.left + '" y1="' + gy + '" x2="' + (PAD.left + plotW) + '" y2="' + gy + '" stroke="var(--border)" stroke-dasharray="4,4"/>');
  }

  var segments = [];
  data.points.forEach(function(p) { if (segments.indexOf(p.segment) === -1) segments.push(p.segment); });
  var legendItems = segments.map(function(s) {
    var color = SEGMENT_COLORS[s] || SEGMENT_COLORS['default'];
    return '<span class="legend-item"><span class="legend-dot" style="background:' + color + '"></span>' + escHtml(s) + '</span>';
  }).join('');

  return '<div class="positioning-map">' +
    '<h3>Market Positioning Map</h3>' +
    '<div class="map-container">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' +
    gridLines.join('\n') +
    '<rect x="' + PAD.left + '" y="' + PAD.top + '" width="' + plotW + '" height="' + plotH + '" fill="none" stroke="var(--border)" stroke-width="1"/>' +
    bubbles +
    '<text x="' + PAD.left + '" y="' + (H - 4) + '" font-size="10" fill="var(--text-muted)">' + escHtml(data.xLabelLeft) + '</text>' +
    '<text x="' + (W - PAD.right) + '" y="' + (H - 4) + '" font-size="10" fill="var(--text-muted)" text-anchor="end">' + escHtml(data.xLabelRight) + '</text>' +
    '<text x="' + (PAD.left - 4) + '" y="' + (PAD.top + 4) + '" font-size="10" fill="var(--text-muted)" text-anchor="end" transform="rotate(-90, ' + (PAD.left - 4) + ', ' + (PAD.top + 4) + ')">' + escHtml(data.yLabelTop) + '</text>' +
    '<text x="' + (PAD.left - 4) + '" y="' + (PAD.top + plotH) + '" font-size="10" fill="var(--text-muted)" text-anchor="end" transform="rotate(-90, ' + (PAD.left - 4) + ', ' + (PAD.top + plotH) + ')">' + escHtml(data.yLabelBottom) + '</text>' +
    '</svg>' +
    '</div>' +
    '<div class="map-legend">' + legendItems + '<span class="legend-item scatter-legend-note">Bubble size = organic traffic</span></div>' +
    '</div>';
}

// ========== Project Name ==========

let _cachedProjectName = null;
let _cachedProjectPmDir = null;

function getProjectName(pmDir) {
  if (_cachedProjectPmDir === pmDir && _cachedProjectName) return _cachedProjectName;
  const configPath = path.join(path.dirname(pmDir), '.pm', 'config.json');
  let name = path.basename(path.dirname(pmDir)) || 'PM';
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (config.project_name) name = config.project_name;
  } catch { /* no config or invalid JSON */ }
  _cachedProjectPmDir = pmDir;
  _cachedProjectName = name;
  return name;
}

// ========== Dashboard Route Handlers ==========

function routeDashboard(req, res, pmDir) {
  touchActivity();
  const rawUrl = req.url;
  const url = rawUrl.split('?')[0];
  const pmExists = fs.existsSync(pmDir);
  const projectName = pmExists ? getProjectName(pmDir) : 'PM';

  if (!pmExists) {
    const html = dashboardPage('PM Dashboard', '/', renderEmptyState(
      'Welcome to PM',
      'PM is your team\'s shared product brain — strategy, research, proposals, and roadmap in one place. To get started, an engineer needs to initialize the knowledge base.',
      '/pm:setup',
      'Initialize knowledge base'
    ));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Parse query params from the full URL (before ? stripping)
  const urlObj = new URL(rawUrl, 'http://localhost');
  const urlPath = urlObj.pathname;
  const tab = urlObj.searchParams.get('tab');

  if (urlPath === '/') {
    handleDashboardHome(res, pmDir);
  } else if (urlPath.startsWith('/groom/')) {
    const slug = decodeURIComponent(urlPath.slice('/groom/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleSessionPage(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/session/')) {
    const slug = decodeURIComponent(urlPath.slice('/session/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleSessionPage(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath === '/proposals') {
    handleProposalsPage(res, pmDir);
  } else if (urlPath.startsWith('/proposals/') && urlPath.endsWith('/raw')) {
    const slug = decodeURIComponent(urlPath.slice('/proposals/'.length, -'/raw'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      const htmlPath = path.resolve(pmDir, 'backlog', 'proposals', slug + '.html');
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
      } else {
        res.writeHead(404); res.end('Not found');
      }
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/proposals/')) {
    const slug = decodeURIComponent(urlPath.slice('/proposals/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleProposalDetail(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath === '/kb') {
    handleKnowledgeBasePage(res, pmDir, tab || null);
  } else if (urlPath === '/research') {
    // Redirect old route to KB
    res.writeHead(302, { 'Location': '/kb?tab=research' }); res.end();
  } else if (urlPath === '/landscape') {
    // Redirect old route
    res.writeHead(302, { 'Location': '/kb?tab=research' }); res.end();
  } else if (urlPath === '/competitors') {
    // Redirect old route to KB
    res.writeHead(302, { 'Location': '/kb?tab=competitors' }); res.end();
  } else if (urlPath === '/strategy') {
    // Redirect old route to KB
    res.writeHead(302, { 'Location': '/kb?tab=strategy' }); res.end();
  } else if (urlPath.startsWith('/competitors/')) {
    const slug = urlPath.slice('/competitors/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleCompetitorDetail(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/research/')) {
    const topic = urlPath.slice('/research/'.length).replace(/\/$/, '');
    if (topic && !topic.includes('/') && !topic.includes('..')) {
      handleResearchTopic(res, pmDir, topic);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath === '/roadmap') {
    handleBacklog(res, pmDir);
  } else if (urlPath === '/roadmap/shipped') {
    handleShipped(res, pmDir);
  } else if (urlPath.startsWith('/roadmap/wireframes/')) {
    const slug = decodeURIComponent(urlPath.slice('/roadmap/wireframes/'.length)).replace(/\/$/, '').replace(/\.html$/, '');
    handleWireframe(res, pmDir, slug);
  } else if (urlPath.startsWith('/roadmap/')) {
    const slug = urlPath.slice('/roadmap/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleBacklogItem(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  // Legacy /backlog redirects
  } else if (urlPath === '/backlog') {
    res.writeHead(302, { 'Location': '/roadmap' }); res.end();
  } else if (urlPath === '/backlog/shipped') {
    res.writeHead(302, { 'Location': '/roadmap/shipped' }); res.end();
  } else if (urlPath.startsWith('/backlog/wireframes/')) {
    const rest = urlPath.slice('/backlog/wireframes'.length);
    res.writeHead(302, { 'Location': '/roadmap/wireframes' + rest }); res.end();
  } else if (urlPath.startsWith('/backlog/')) {
    const rest = urlPath.slice('/backlog'.length);
    res.writeHead(302, { 'Location': '/roadmap' + rest }); res.end();
  } else {
    res.writeHead(404); res.end('Not found');
  }
}

function getUpdatedDate(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data } = parseFrontmatter(content);
    return data.updated || data.created || null;
  } catch { return null; }
}

function getNewestUpdated(dir) {
  if (!fs.existsSync(dir)) return null;
  let newest = null;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      let d = null;
      if (e.isDirectory()) {
        const idx = path.join(fp, 'profile.md');
        if (fs.existsSync(idx)) d = getUpdatedDate(idx);
        if (!d) d = getNewestUpdated(fp);
      } else if (e.name.endsWith('.md')) {
        d = getUpdatedDate(fp);
      }
      if (d && (!newest || d > newest)) newest = d;
    }
  } catch {}
  return newest;
}

function stalenessInfo(dateStr) {
  if (!dateStr) return null;
  const updated = new Date(dateStr);
  const now = new Date();
  const diffMs = now - updated;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  let label, level;
  if (days === 0) label = 'Updated today';
  else if (days === 1) label = 'Updated yesterday';
  else if (days < 7) label = `Updated ${days}d ago`;
  else if (days < 30) { const w = Math.floor(days / 7); label = `Updated ${w}w ago`; }
  else { const m = Math.floor(days / 30); label = `Updated ${m}mo ago`; }

  if (days < 7) level = 'fresh';
  else if (days < 30) level = 'aging';
  else level = 'stale';

  return { label, level };
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return dateStr;
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function humanizeSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ========== Shipped Enrichment Helpers ==========

/**
 * Resolve research_refs to topic labels.
 * research_refs can be paths like "pm/research/dashboard-linear-quality/findings.md"
 * or shorthand topic slugs.
 */
function resolveResearchRefs(refs, pmDir) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const researchDir = path.join(pmDir, 'research');
  return refs.map(ref => {
    // Extract topic slug from path
    const match = String(ref).match(/research\/([^/]+)/);
    const slug = match ? match[1] : String(ref);
    const findingsPath = path.join(researchDir, slug, 'findings.md');
    if (fs.existsSync(findingsPath)) {
      const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
      const topic = parsed.data.topic || humanizeSlug(slug);
      return { slug, label: topic };
    }
    return { slug, label: humanizeSlug(slug) };
  });
}

/**
 * Determine strategy alignment for a shipped item.
 * Check the item's parent proposal for strategy_check field,
 * or look at the item's own labels/scope for priority references.
 */
function resolveStrategyAlignment(item, allItems, pmDir) {
  if (item.parent) {
    const metaPath = path.join(pmDir, 'backlog', 'proposals', item.parent + '.meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (meta.strategy_check) return meta.strategy_check;
      } catch { /* ignore malformed JSON */ }
    }
  }
  return null;
}

/**
 * Find competitive context for a shipped item.
 * If the item or parent proposal references competitor research,
 * extract the competitor name.
 */
function resolveCompetitiveContext(item, allItems, pmDir) {
  const refs = [...(item.research_refs || [])];
  if (item.parent && allItems[item.parent]) {
    const parentRefs = allItems[item.parent].research_refs || [];
    refs.push(...parentRefs);
  }
  const competitors = [];
  const compDir = path.join(pmDir, 'competitors');
  if (fs.existsSync(compDir)) {
    const compSlugs = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);
    for (const ref of refs) {
      for (const comp of compSlugs) {
        if (String(ref).toLowerCase().includes(comp.toLowerCase())) {
          const profilePath = path.join(compDir, comp, 'profile.md');
          let name = humanizeSlug(comp);
          if (fs.existsSync(profilePath)) {
            const parsed = parseFrontmatter(fs.readFileSync(profilePath, 'utf-8'));
            if (parsed.data.company) name = parsed.data.company;
          }
          if (!competitors.includes(name)) competitors.push(name);
        }
      }
    }
  }
  return competitors;
}

// ========== Proposal Metadata Helpers ==========

const PROPOSAL_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
];

function proposalGradient(slug) {
  if (!slug) return PROPOSAL_GRADIENTS[0];
  let hash = 5381;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) + hash + slug.charCodeAt(i)) >>> 0;
  }
  return PROPOSAL_GRADIENTS[hash % PROPOSAL_GRADIENTS.length];
}

function readProposalMeta(slug, pmDir) {
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) return null;
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const metaPath = path.resolve(proposalsDir, slug + '.meta.json');
  if (!metaPath.startsWith(proposalsDir + path.sep)) return null;
  try {
    const raw = fs.readFileSync(metaPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function buildProposalRows(pmDir) {
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const proposals = [];
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of files) {
      const slug = file.replace('.meta.json', '');
      const meta = readProposalMeta(slug, pmDir);
      if (!meta) continue;
      const verdict = (meta.verdict || '').toLowerCase();
      if (verdict === 'shipped') continue;
      proposals.push({
        slug,
        id: meta.id || '',
        title: typeof meta.title === 'string' && meta.title.trim() ? meta.title : humanizeSlug(slug),
        outcome: meta.outcome || '',
        verdict: meta.verdict || '',
        verdictLabel: meta.verdictLabel || '',
        issueCount: meta.issueCount || 0,
        date: meta.date || '',
      });
    }
  }
  proposals.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return proposals;
}

function readGroomState(pmDir) {
  const runtimeRoot = path.resolve(pmDir, '..', '.pm');
  const candidates = [];
  const sessionsDir = path.join(runtimeRoot, 'groom-sessions');
  if (fs.existsSync(sessionsDir)) {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        candidates.push(path.join(sessionsDir, entry.name));
      }
    }
  }
  const legacyPath = path.join(runtimeRoot, '.groom-state.md');
  if (fs.existsSync(legacyPath)) {
    candidates.push(legacyPath);
  }

  let best = null;
  for (const statePath of candidates) {
    try {
      const raw = fs.readFileSync(statePath, 'utf-8');
      const { data } = parseFrontmatter(raw);
      if (typeof data.topic !== 'string' || data.topic.trim() === '') {
        continue;
      }
      const updatedAt = Date.parse(data.updated || data.started_at || '') || 0;
      if (!best || updatedAt > best.updatedAt) {
        best = { data, updatedAt };
      }
    } catch {
      // Ignore unreadable or invalid state files and continue scanning.
    }
  }
  return best ? best.data : null;
}

function normalizeSourceOrigin(value) {
  const origin = String(value || 'external').toLowerCase();
  return origin === 'internal' || origin === 'mixed' || origin === 'external'
    ? origin
    : 'external';
}

function parseCount(value) {
  const count = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(count) ? count : null;
}

function buildTopicMeta(slug, data, findingsPath) {
  const origin = normalizeSourceOrigin(data.source_origin);
  const evidenceCount = parseCount(data.evidence_count);
  const label = typeof data.topic === 'string' && data.topic.trim() !== ''
    ? data.topic.trim()
    : humanizeSlug(slug);
  const originLabel = origin.charAt(0).toUpperCase() + origin.slice(1);
  const subtitleParts = [
    origin === 'internal'
      ? 'Customer evidence'
      : origin === 'mixed'
        ? 'Customer + market evidence'
        : 'External research'
  ];

  const badges = [
    `<span class="badge badge-origin-${origin}">${escHtml(originLabel)}</span>`
  ];

  if ((origin === 'internal' || origin === 'mixed') && evidenceCount) {
    const evidenceLabel = `${evidenceCount} evidence record${evidenceCount === 1 ? '' : 's'}`;
    subtitleParts.push(evidenceLabel);
    badges.push(`<span class="badge badge-evidence">${escHtml(evidenceLabel)}</span>`);
  }

  const stale = stalenessInfo(getUpdatedDate(findingsPath));
  if (stale) badges.push(`<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`);

  return {
    label,
    subtitle: subtitleParts.join(' · '),
    badgesHtml: badges.join(' ')
  };
}

function parseStrategySnapshot(pmDir) {
  const strategyPath = path.join(pmDir, 'strategy.md');
  if (!fs.existsSync(strategyPath)) return null;
  const raw = fs.readFileSync(strategyPath, 'utf-8');
  const { body } = parseFrontmatter(raw);

  // Extract focus: first non-empty paragraph or ## Focus section
  let focus = '';
  const focusMatch = body.match(/## (?:Focus|Vision)\s*\n+(.*?)(?:\n\n|\n##)/s);
  if (focusMatch) focus = focusMatch[1].replace(/\n/g, ' ').trim();
  if (!focus) {
    const firstPara = body.split(/\n\n/)[0];
    focus = firstPara.replace(/^#.*\n/, '').trim();
  }

  // Extract priorities from ## Priorities section
  const priorities = [];
  const priMatch = body.match(/## Priorities\s*\n([\s\S]*?)(?:\n##|$)/);
  if (priMatch) {
    const lines = priMatch[1].split('\n').filter(l => /^\s*[-*\d]/.test(l));
    for (const line of lines.slice(0, 3)) {
      priorities.push(line.replace(/^\s*[-*\d.]+\s*/, '').trim());
    }
  }

  const stale = stalenessInfo(getUpdatedDate(strategyPath));
  return { focus, priorities, staleness: stale || { level: 'fresh', label: 'Current' } };
}

function handleProposalsPage(res, pmDir) {
  const proposals = buildProposalRows(pmDir);

  // Collect ideas (ungroomed backlog items)
  const backlogDir = path.join(pmDir, 'backlog');
  const ideas = [];
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'))) {
      const slug = file.replace('.md', '');
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      if ((data.status || 'idea') === 'idea') {
        ideas.push({ slug, title: data.title || humanizeSlug(slug), id: data.id || null });
      }
    }
  }

  let body;
  if (proposals.length === 0 && ideas.length === 0) {
    body = `<div class="page-header"><h1>Proposals</h1></div>
${renderEmptyState('No proposals yet', 'Proposals are structured feature plans with research, strategy alignment, and scoped issues.', '/pm:groom', 'Create your first proposal')}`;
  } else {
    const subtitle = [
      proposals.length > 0 ? `${proposals.length} groomed` : null,
      ideas.length > 0 ? `${ideas.length} idea${ideas.length !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ');

    // Groomed section
    let groomedHtml = '';
    if (proposals.length > 0) {
      const rows = proposals.map(p => {
        const badgeClass = p.verdict === 'in-progress' ? 'badge-in-progress'
          : p.verdict === 'paused' ? 'badge-paused'
          : p.verdict === 'ready' ? 'badge-ready'
          : 'badge-groomed';
        const statusLabel = p.verdictLabel || 'Groomed';
        return `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="proposal-card-row">
  <div class="proposal-card-body">
    <div class="proposal-card-title">${p.id ? `<span class="proposal-id">${escHtml(p.id)}</span>` : ''}${escHtml(p.title)}</div>
    ${p.outcome ? `<div class="proposal-card-outcome">${escHtml(p.outcome)}</div>` : ''}
  </div>
  <div class="proposal-card-meta">
    <span class="badge ${badgeClass}">${escHtml(statusLabel)}</span>
    ${p.issueCount > 0 ? `<span class="issue-count">${p.issueCount} issue${p.issueCount !== 1 ? 's' : ''}</span>` : ''}
    ${p.date ? `<span class="updated">${escHtml(formatRelativeDate(p.date))}</span>` : ''}
  </div>
</a>`;
      }).join('\n');

      groomedHtml = `
<section class="section">
  <div class="section-header">
    <span class="section-title">Groomed</span>
    <span class="section-count">${proposals.length} proposal${proposals.length !== 1 ? 's' : ''}</span>
  </div>
  <div class="proposal-grid">${rows}</div>
</section>`;
    }

    // Ideas section
    let ideasHtml = '';
    if (ideas.length > 0) {
      const ideaRows = ideas.map(i => {
        const idHtml = i.id ? `<span class="idea-id">${escHtml(i.id)}</span>` : '<span class="idea-id"></span>';
        return `<a class="idea-row" href="/roadmap/${escHtml(encodeURIComponent(i.slug))}">${idHtml}<span class="idea-title">${escHtml(i.title)}</span></a>`;
      }).join('\n');

      ideasHtml = `
<section class="section">
  <div class="section-header">
    <span class="section-title">Ideas</span>
    <span class="section-count">${ideas.length} ungroomed</span>
  </div>
  <div class="idea-list">${ideaRows}</div>
</section>`;
    }

    body = `<div class="page-header"><h1>Proposals</h1>
  <p class="subtitle">${subtitle}</p>
</div>
${groomedHtml}${ideasHtml}`;
  }

  const html = dashboardPage('Proposals', '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderBriefValue(label, value) {
  if (!value) {
    return '';
  }

  let renderedValue = escHtml(value);
  if (label === 'Next' && value.startsWith('/')) {
    renderedValue = `Run <code>${escHtml(value)}</code>`;
  }

  return `<div class="session-brief-row">
      <div class="session-brief-key">${escHtml(label)}</div>
      <div class="session-brief-value">${renderedValue}</div>
    </div>`;
}

function handleDashboardHome(res, pmDir) {
  const projectDir = path.dirname(pmDir);
  const status = buildStatus(projectDir);

  function renderActionValue(value) {
    if (!value) {
      return '';
    }

    if (value.startsWith('/')) {
      return `Run <code>${escHtml(value)}</code>`;
    }

    return escHtml(value);
  }

  // Derive counts from buildStatus instead of re-scanning directories
  const stats = {
    backlog: status.counts.ideas + status.counts.inProgress + status.counts.shipped,
    competitors: status.counts.competitorProfiles,
    research: status.counts.researchTopics,
  };

  const backlogDir = path.join(pmDir, 'backlog');
  const compDir = path.join(pmDir, 'competitors');
  const researchDir = path.join(pmDir, 'research');

  // Collect updated dates for staleness
  const updatedDates = {
    strategy: getUpdatedDate(path.join(pmDir, 'strategy.md')),
    backlog: getNewestUpdated(path.join(pmDir, 'backlog')),
  };
  const researchDates = [
    getUpdatedDate(path.join(pmDir, 'landscape.md')),
    getNewestUpdated(path.join(pmDir, 'competitors')),
    getNewestUpdated(path.join(pmDir, 'research')),
  ].filter(Boolean);
  updatedDates.research = researchDates.length > 0 ? researchDates.sort().pop() : null;

  const projectName = getProjectName(pmDir);

  // ===== 1. Strategy snapshot =====
  const strategyData = parseStrategySnapshot(pmDir);
  const strategySection = strategyData ? `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">Strategy</span>
    <a href="/kb?tab=strategy" class="home-section-link">View full strategy</a>
  </div>
  <div class="strategy-card">
    ${strategyData.focus ? `<div class="strategy-focus">${escHtml(strategyData.focus)}</div>` : ''}
    <div class="strategy-priorities">
      ${strategyData.priorities.map((p, i) => `<div class="priority-item"><span class="priority-num">${i + 1}</span> ${escHtml(p)}</div>`).join('')}
    </div>
    <div class="staleness">
      <span class="staleness-dot ${strategyData.staleness.level}"></span>
      Updated ${escHtml(strategyData.staleness.label)}
    </div>
  </div>
</section>` : '';

  // ===== 2. What's coming (active proposals) =====
  const proposalsDir = path.join(pmDir, 'backlog', 'proposals');
  const activeProposals = [];
  if (fs.existsSync(proposalsDir)) {
    const metaFiles = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of metaFiles) {
      try {
        const raw = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');
        const meta = JSON.parse(raw);
        if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
          const slug = file.replace('.meta.json', '');
          // Include non-shipped, non-draft proposals
          const verdict = (meta.verdict || '').toLowerCase();
          if (verdict !== 'shipped' && verdict !== 'draft') {
            activeProposals.push({
              slug,
              id: meta.id || '',
              title: meta.title || humanizeSlug(slug),
              statusLabel: meta.verdictLabel || meta.verdict || 'Active',
              badgeClass: verdict === 'ready' ? 'ready' : verdict === 'in-progress' ? 'in-progress' : 'neutral',
              issueCount: meta.issueCount || 0,
              updated: meta.date || '',
            });
          }
        }
      } catch { /* skip invalid JSON */ }
    }
    activeProposals.sort((a, b) => (b.updated > a.updated ? 1 : -1));
    activeProposals.splice(5);
  }

  const proposalsSection = activeProposals.length > 0 ? `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">What's coming</span>
    <a href="/proposals" class="home-section-link">All proposals</a>
  </div>
  <div class="home-proposal-list">
    ${activeProposals.map(p => `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="home-proposal-row">
      <span class="proposal-id">${escHtml(p.id)}</span>
      <span class="proposal-title">${escHtml(p.title)}</span>
      <span class="proposal-meta">
        <span class="badge badge-${escHtml(p.badgeClass)}">${escHtml(p.statusLabel)}</span>
        <span>${p.issueCount} issue${p.issueCount !== 1 ? 's' : ''}</span>
        <span>${escHtml(formatRelativeDate(p.updated))}</span>
      </span>
    </a>`).join('')}
  </div>
</section>` : '';

  // ===== 3. Recently shipped =====
  const recentShipped = [];
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    const allItems = {};
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      const slug = file.replace('.md', '');
      allItems[slug] = { slug, ...data };
    }
    const childSlugs = new Set();
    for (const item of Object.values(allItems)) {
      if (item.parent && item.parent !== 'null' && allItems[item.parent]) childSlugs.add(item.slug);
    }
    const shipped = Object.values(allItems)
      .filter(i => i.status === 'done' && !childSlugs.has(i.slug))
      .sort((a, b) => ((b.updated || b.created || '') > (a.updated || a.created || '') ? 1 : -1))
      .slice(0, 5);
    for (const s of shipped) {
      const dateStr = s.updated || s.created || '';
      recentShipped.push({
        slug: s.slug,
        title: s.title || s.slug,
        outcome: s.outcome || '',
        dateLabel: formatRelativeDate(dateStr),
      });
    }
  }

  const shippedSection = recentShipped.length > 0 ? `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">Recently shipped</span>
    <a href="/roadmap/shipped" class="home-section-link">All shipped</a>
  </div>
  <div class="home-shipped-list">
    ${recentShipped.map(s => `<a href="/roadmap/${escHtml(encodeURIComponent(s.slug))}" class="home-shipped-item">
      <span class="home-shipped-title">${escHtml(s.title)}</span>
      <span class="home-shipped-context">${escHtml(s.outcome)}</span>
      <span class="home-shipped-date">${escHtml(s.dateLabel)}</span>
    </a>`).join('')}
  </div>
</section>` : '';

  // ===== 4. KB health =====
  const researchFreshness = stalenessInfo(updatedDates.research) || { level: 'stale', label: 'No data' };
  const competitorFreshness = stalenessInfo(getNewestUpdated(compDir)) || { level: 'stale', label: 'No data' };

  // Customer evidence count from research topics with source_origin internal/mixed
  let evidenceCount = 0;
  if (fs.existsSync(researchDir)) {
    const topics = fs.readdirSync(researchDir, { withFileTypes: true }).filter(e => e.isDirectory());
    for (const t of topics) {
      const findingsPath = path.join(researchDir, t.name, 'findings.md');
      if (fs.existsSync(findingsPath)) {
        const { data } = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
        const origin = (data.source_origin || '').toLowerCase();
        if ((origin === 'internal' || origin === 'mixed') && data.evidence_count) {
          evidenceCount += parseInt(data.evidence_count, 10) || 0;
        }
      }
    }
  }
  const evidenceFreshness = evidenceCount > 0
    ? { level: 'fresh', label: `${evidenceCount} records` }
    : { level: 'stale', label: 'No evidence' };

  const kbSection = `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">Knowledge base</span>
    <a href="/kb" class="home-section-link">Browse</a>
  </div>
  <div class="kb-health-grid">
    <a href="/kb?tab=research" class="kb-health-card">
      <div class="kb-health-value">${stats.research}</div>
      <div class="kb-health-label">Research topics</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${researchFreshness.level}"></span>
        ${escHtml(researchFreshness.label)}
      </div>
    </a>
    <a href="/kb?tab=competitors" class="kb-health-card">
      <div class="kb-health-value">${stats.competitors}</div>
      <div class="kb-health-label">Competitors profiled</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${competitorFreshness.level}"></span>
        ${escHtml(competitorFreshness.label)}
      </div>
    </a>
    <a href="/kb?tab=research" class="kb-health-card">
      <div class="kb-health-value">${evidenceCount}</div>
      <div class="kb-health-label">Customer evidence</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${evidenceFreshness.level}"></span>
        ${escHtml(evidenceFreshness.label)}
      </div>
    </a>
  </div>
</section>`;

  const firstWorkflowActions = status.next === '/pm:start (choose your first workflow)' ? `
  <div class="session-brief-actions">
    <div class="session-brief-actions-label">Good first moves</div>
    <ul>
      <li><code>/pm:ingest &lt;path&gt;</code> if you already have customer evidence</li>
      <li><code>/pm:research landscape</code> to understand the market</li>
      <li><code>/pm:research competitors</code> to profile alternatives</li>
      <li><code>/pm:groom &lt;idea&gt;</code> if you already know what feature to scope</li>
    </ul>
  </div>` : '';

  const alternativeActions = Array.isArray(status.alternatives) && status.alternatives.length > 0 ? `
  <div class="session-brief-actions">
    <div class="session-brief-actions-label">Also consider</div>
    <ul>
      ${status.alternatives.map((action) => `<li>${renderActionValue(action)}</li>`).join('')}
    </ul>
  </div>` : '';

  const suggestedHtml = `<div class="suggested-next">
  <div class="suggested-next-label">Session brief</div>
  ${status.update.available ? renderBriefValue('Update', status.update.message) : ''}
  ${renderBriefValue('Focus', status.focus)}
  ${renderBriefValue('Backlog', status.backlog)}
  ${renderBriefValue('Next', status.next)}
  ${alternativeActions}
  ${firstWorkflowActions}
</div>`;

  const proposalCount = activeProposals.length;
  const isFullyEmpty = !strategyData && proposalCount === 0 && recentShipped.length === 0 &&
    stats.backlog === 0 && stats.competitors === 0 && stats.research === 0;

  let body;
  if (isFullyEmpty) {
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Product knowledge base</p>
</div>
${renderEmptyState('Your team\'s shared product brain', 'Strategy, research, proposals, and roadmap in one place. Once content is added, you\'ll see project health, active sessions, and recent proposals here.', '/pm:groom', 'Start your first feature')}
${suggestedHtml}`;
  } else if (proposalCount === 0 && !shippedSection) {
    // Partial state: strategy/KB exists but no proposals yet
    const partialProposals = `
<section class="home-section">
  <div class="home-section-header"><span class="home-section-title">What's coming</span></div>
  ${renderEmptyState('Ready for your first feature', 'Your knowledge base has content. Start grooming to create a structured proposal with research and scoped issues.', '/pm:groom')}
</section>`;
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Product knowledge base</p>
</div>
${strategySection}
${partialProposals}
${kbSection}
${suggestedHtml}`;
  } else {
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Product knowledge base</p>
</div>
${strategySection}
${proposalsSection}
${shippedSection}
${kbSection}
${suggestedHtml}`;
  }

  const html = dashboardPage('Home', '/', body, projectName);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function buildKbSubTabs(activeTab) {
  const tabs = [
    { id: 'research', label: 'Research', href: '/kb?tab=research' },
    { id: 'competitors', label: 'Competitors', href: '/kb?tab=competitors' },
    { id: 'strategy', label: 'Strategy', href: '/kb?tab=strategy' },
  ];
  return '<div class="kb-tabs">' + tabs.map(t =>
    `<a href="${t.href}" class="kb-tab${t.id === activeTab ? ' active' : ''}">${t.label}</a>`
  ).join('') + '</div>';
}

function handleResearchPage(res, pmDir) {
  // --- Landscape tab ---
  let landscapeHtml = '';
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (fs.existsSync(landscapePath)) {
    const raw = fs.readFileSync(landscapePath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    const statsData = parseStatsData(body);
    const statsHtml = renderStatsCards(statsData);
    var rendered = renderLandscapeWithViz(body);
    // Inject stats right after the first h1
    if (statsHtml) rendered = rendered.replace(/(<\/h1>)/, '$1' + statsHtml);
    landscapeHtml = '<div class="action-hint">Run <code>/pm:refresh</code> to update or <code>/pm:research landscape</code> to regenerate</div>' +
      '<div class="markdown-body">' + rendered + '</div>';
  } else {
    landscapeHtml = renderEmptyState('No landscape research', 'The landscape maps your market \u2014 TAM/SAM/SOM, market trends, and positioning opportunities.', '/pm:research landscape', 'Map your market');
  }

  // --- Competitors tab ---
  let competitorsHtml = '';
  const compDir = path.join(pmDir, 'competitors');
  if (fs.existsSync(compDir)) {
    const slugs = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);

    if (slugs.length > 0) {
      const cards = slugs.map(slug => {
        const profilePath = path.join(compDir, slug, 'profile.md');
        let name = slug;
        let cat = '';
        let badge = '';

        if (fs.existsSync(profilePath)) {
          const profRaw = fs.readFileSync(profilePath, 'utf-8');
          const profParsed = parseFrontmatter(profRaw);
          if (profParsed.data.company) name = profParsed.data.company;
          const summary = extractProfileSummary(profParsed.body);
          if (summary.company) name = summary.company;
          if (summary.category) cat = '<p class="meta">' + escHtml(summary.category) + '</p>';
          const files = ['profile.md', 'features.md', 'api.md', 'seo.md', 'sentiment.md'];
          const present = files.filter(f => fs.existsSync(path.join(compDir, slug, f))).length;
          badge = '<span class="badge">' + present + '/5</span>';
        }

        return '<article class="card">' +
          '<h3><a href="/competitors/' + escHtml(slug) + '">' + escHtml(name) + '</a></h3>' +
          cat +
          '<div class="card-footer">' + badge +
          '<a href="/competitors/' + escHtml(slug) + '" class="view-link">View &rarr;</a></div>' +
          '</article>';
      }).join('');
      competitorsHtml = '<div class="action-hint">Run <code>/pm:research competitors</code> to re-profile or <code>/pm:refresh</code> to update</div>' +
        '<div class="card-grid">' + cards + '</div>';

      // Feature matrix (heatmap)
      const matrixPath = path.join(compDir, 'matrix.md');
      if (fs.existsSync(matrixPath)) {
        const matrixRaw = fs.readFileSync(matrixPath, 'utf-8');
        const matrixParsed = parseFrontmatter(matrixRaw);
        competitorsHtml += '<section class="content-section">' + renderFeatureHeatmap(matrixParsed.body) + '</section>';
      }

      // Sentiment gap analysis
      competitorsHtml += renderSentimentGap(compDir, slugs);

      // SEO competitive position
      competitorsHtml += renderSeoComparison(compDir, slugs);

      // Market gaps
      const indexPath = path.join(compDir, 'index.md');
      if (fs.existsSync(indexPath)) {
        const raw = fs.readFileSync(indexPath, 'utf-8');
        const parsed = parseFrontmatter(raw);
        const gapsMatch = parsed.body.match(/## Market Gaps\n([\s\S]*?)(?=\n## |$)/);
        if (gapsMatch) {
          competitorsHtml += '<div class="content-section markdown-body"><h2>Market Gaps</h2>' + renderMarkdown(gapsMatch[1].trim()) + '</div>';
        }
      }
    }
  }
  if (!competitorsHtml) {
    competitorsHtml = renderEmptyState('No competitor profiles', 'Competitor profiles cover features, pricing, API, SEO, and user sentiment for each rival.', '/pm:research competitors', 'Profile your competitors');
  }

  // --- Topics tab ---
  let topicsHtml = '';
  const researchDir = path.join(pmDir, 'research');
  if (fs.existsSync(researchDir)) {
    const topics = fs.readdirSync(researchDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).map(e => e.name);

    if (topics.length > 0) {
      // Try to parse pillar groupings from index.md
      const indexMdPath = path.join(researchDir, 'index.md');
      let pillarGroups = null;
      if (fs.existsSync(indexMdPath)) {
        const indexRaw = fs.readFileSync(indexMdPath, 'utf-8');
        const pillarRe = /<!-- pillar: ([^,]+), ([^>]+) -->/g;
        let pm;
        const groups = [];
        const grouped = new Set();
        while ((pm = pillarRe.exec(indexRaw)) !== null) {
          const pillarName = pm[1].trim();
          const pillarTopics = pm[2].trim().split('|').map(function(s) { return s.trim(); });
          groups.push({ name: pillarName, topics: pillarTopics });
          pillarTopics.forEach(function(t) { grouped.add(t); });
        }
        // Add ungrouped topics
        const ungrouped = topics.filter(function(t) { return !grouped.has(t); });
        if (ungrouped.length > 0) groups.push({ name: 'Other', topics: ungrouped });
        if (groups.length > 0) pillarGroups = groups;
      }

      if (pillarGroups) {
        // Render coverage grid grouped by pillar
        const pillarClassMap = {
          'Operational Replacement': 'coverage-group-header--operational',
          'Payroll-Readiness': 'coverage-group-header--payroll',
          'Exception-First Ops': 'coverage-group-header--exception',
          'AI & Platform': 'coverage-group-header--ai',
          'UX & Design': 'coverage-group-header--ux',
          'Infrastructure': 'coverage-group-header--infrastructure',
          'Other': 'coverage-group-header--other'
        };

        const groupsHtml = pillarGroups.map(function(g) {
          const headerCls = pillarClassMap[g.name] || 'coverage-group-header--default';
          const topicItems = g.topics.map(function(t) {
            const findingsPath = path.join(researchDir, t, 'findings.md');
            const compPath = path.join(researchDir, t, 'comparison.md');
            const hasFindings = fs.existsSync(findingsPath);
            const hasComparison = fs.existsSync(compPath);
            if (!hasFindings && !fs.existsSync(path.join(researchDir, t))) return '';

            let dotClass = 'coverage-dot-stale';
            if (hasFindings) {
              const stale = stalenessInfo(getUpdatedDate(findingsPath));
              if (stale) dotClass = 'coverage-dot-' + stale.level;
            }

            const badges = [];
            if (hasComparison) badges.push('<span class="badge comparison-badge">+comparison</span>');

            let meta = null;
            if (hasFindings) {
              const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
              meta = buildTopicMeta(t, parsed.data, findingsPath);
            }

            const topicLabel = meta ? meta.label : humanizeSlug(t);
            const subtitleHtml = meta && meta.subtitle ? '<span class="coverage-topic-subtitle">' + escHtml(meta.subtitle) + '</span>' : '';

            return '<a href="/research/' + escHtml(t) + '" class="coverage-topic">' +
              '<span class="coverage-dot ' + dotClass + '"></span>' +
              '<span class="coverage-topic-name">' + escHtml(topicLabel) + '</span>' +
              subtitleHtml +
              '<span class="coverage-topic-badges">' + (meta ? meta.badgesHtml : '') + badges.join('') + '</span>' +
              '</a>';
          }).filter(Boolean).join('');

          return '<div class="coverage-group">' +
            '<div class="coverage-group-header ' + headerCls + '">' + escHtml(g.name) + ' <span class="badge">' + g.topics.length + '</span></div>' +
            '<div class="coverage-group-body">' + topicItems + '</div>' +
            '</div>';
        }).join('');

        const legendHtml = '<div class="coverage-legend">' +
          '<span class="coverage-legend-item"><span class="coverage-dot coverage-dot-fresh"></span> Fresh (&lt;7d)</span>' +
          '<span class="coverage-legend-item"><span class="coverage-dot coverage-dot-aging"></span> Aging (7-30d)</span>' +
          '<span class="coverage-legend-item"><span class="coverage-dot coverage-dot-stale"></span> Stale (&gt;30d)</span>' +
          '</div>';

        topicsHtml = '<h2 class="coverage-heading">Research Coverage Matrix</h2>' + legendHtml +
          '<div class="coverage-grid">' + groupsHtml + '</div>';
      } else {
        // Fallback: flat card grid
        const topicCards = topics.map(t => {
          const findingsPath = path.join(researchDir, t, 'findings.md');
          let meta = { label: humanizeSlug(t), subtitle: 'External research', badgesHtml: '' };
          if (fs.existsSync(findingsPath)) {
            const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
            meta = buildTopicMeta(t, parsed.data, findingsPath);
          }
          return '<article class="card">' +
            '<h3><a href="/research/' + escHtml(t) + '">' + escHtml(meta.label) + '</a></h3>' +
            '<p class="meta">' + escHtml(meta.subtitle) + '</p>' +
            '<div class="card-footer"><span>' + meta.badgesHtml + '</span><a href="/research/' + escHtml(t) + '" class="view-link">View &rarr;</a></div>' +
            '</article>';
        }).join('');
        topicsHtml = '<div class="card-grid">' + topicCards + '</div>';
      }
    }
  }
  if (!topicsHtml) {
    topicsHtml = '<div class="empty-state"><h2>No topic research</h2><p>Topic research covers external market research and customer evidence on specific subjects.</p>' +
      renderClickToCopy('/pm:research {topic}') + '<p class="empty-state-cta-label">Research a topic</p>' +
      renderClickToCopy('/pm:ingest path/to/evidence') + '<p class="empty-state-cta-label">Import customer evidence</p></div>';
  }

  const tabs = [
    { id: 'landscape', label: 'Landscape', content: landscapeHtml },
    { id: 'competitors', label: 'Competitors', content: competitorsHtml },
    { id: 'topics', label: 'Topics', content: topicsHtml },
  ];

  const tabHeaders = tabs.map((t, i) =>
    `<div class="tab${i === 0 ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${i === 0}" data-tab="${t.id}" onclick="switchTab(this,'tab-${t.id}')" onkeydown="tabKey(event,this,'tab-${t.id}')">${t.label}</div>`
  ).join('');

  const tabPanels = tabs.map((t, i) =>
    `<div id="tab-${t.id}" class="tab-panel${i === 0 ? ' active' : ''}" role="tabpanel">${t.content}</div>`
  ).join('');

  const body = `
<div class="page-header">
  <h1>Research</h1>
  <p class="subtitle">Landscape, competitive intelligence, and shared topic research</p>
</div>
<div class="tabs" role="tablist">${tabHeaders}</div>
${tabPanels}
<script>
function switchTab(el, panelId) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  el.setAttribute('aria-selected','true');
  document.getElementById(panelId).classList.add('active');
  history.replaceState(null, '', '#' + el.getAttribute('data-tab'));
}
function tabKey(e, el, panelId) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(el, panelId); }
  if (e.key === 'ArrowRight') { var next = el.nextElementSibling; if (next) { next.focus(); next.click(); } }
  if (e.key === 'ArrowLeft') { var prev = el.previousElementSibling; if (prev) { prev.focus(); prev.click(); } }
}
(function() {
  var hash = location.hash.slice(1);
  if (hash) {
    var tab = document.querySelector('.tab[data-tab="' + hash + '"]');
    if (tab) switchTab(tab, 'tab-' + hash);
  }
})();
</script>`;

  const html = dashboardPage('Research', '/kb', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleMarkdownPage(res, pmDir, filename, title, navPath) {
  const filePath = path.join(pmDir, filename);
  if (!fs.existsSync(filePath)) {
    const html = dashboardPage(title, navPath, `
<div class="page-header"><h1>${escHtml(title)}</h1></div>
${renderEmptyState('File not found', 'No <code>' + escHtml(filename) + '</code> found in this knowledge base.', '/pm:setup', 'Initialize knowledge base')}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const { body } = parseFrontmatter(raw);
  const rendered = renderMarkdown(body);

  const html = dashboardPage(title, navPath, `
<div class="page-header"><h1>${escHtml(title)}</h1></div>
<div class="markdown-body">${rendered}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderSwotGrid(body) {
  const swotRe = /### (Strengths|Weaknesses|Opportunities|Threats)\s*\n([\s\S]*?)(?=\n### |\n## |$)/g;
  const sections = {};
  let match;
  while ((match = swotRe.exec(body)) !== null) {
    sections[match[1].toLowerCase()] = match[2].trim();
  }
  if (!sections.strengths && !sections.weaknesses) return null;

  const keys = ['strengths', 'weaknesses', 'opportunities', 'threats'];
  const labels = { strengths: 'Strengths', weaknesses: 'Weaknesses', opportunities: 'Opportunities', threats: 'Threats' };
  const boxes = keys.map(k => {
    const items = (sections[k] || '').split('\n').filter(l => l.match(/^[-*]\s/)).map(l => {
      return '<li>' + inlineMarkdown(l.replace(/^[-*]\s+/, '')) + '</li>';
    }).join('');
    return '<div class="swot-box swot-' + k + '"><h4>' + labels[k] + '</h4><ul>' + (items || '<li class="swot-empty">Not yet analyzed</li>') + '</ul></div>';
  }).join('');

  return '<div class="swot-grid">' + boxes + '</div>';
}

function renderProfileWithSwot(body) {
  if (body.indexOf('## SWOT Analysis') === -1) return renderMarkdown(body);

  var swotStart = body.indexOf('## SWOT Analysis');
  var beforeSwot = body.substring(0, swotStart);
  var rest = body.substring(swotStart);
  var afterSwotMatch = rest.match(/\n## (?!SWOT)[^\n]+/);
  var swotSection, afterSwot;
  if (afterSwotMatch) {
    swotSection = rest.substring(0, afterSwotMatch.index);
    afterSwot = rest.substring(afterSwotMatch.index);
  } else {
    swotSection = rest;
    afterSwot = '';
  }

  var swotGrid = renderSwotGrid(swotSection);
  return renderMarkdown(beforeSwot) +
    '<h2>SWOT Analysis</h2>' +
    (swotGrid || renderMarkdown(swotSection)) +
    renderMarkdown(afterSwot);
}

function renderPositioningScatter(body) {
  var posRe = /<!-- ([\w\s]+), (\d+), (\d+), (\d+), ([\w-]+) -->/g;
  var dots = [];
  var m;
  while ((m = posRe.exec(body)) !== null) {
    dots.push({ name: m[1].trim(), x: parseInt(m[2]), y: parseInt(m[3]), traffic: parseInt(m[4]), segment: m[5] });
  }
  if (dots.length === 0) return null;

  var maxTraffic = Math.max.apply(null, dots.map(function(d) { return d.traffic || 1; }));

  var dotsHtml = dots.map(function(d) {
    var size = d.segment === 'self' ? 16 : Math.max(10, Math.min(40, Math.sqrt(d.traffic / maxTraffic) * 40));
    var color = SEGMENT_COLORS[d.segment] || SEGMENT_COLORS['default'];
    var cls = d.segment === 'self' ? ' highlight' : '';
    var yFlipped = 100 - d.y;
    return '<div class="scatter-dot' + cls + '" style="left:' + d.x + '%;top:' + yFlipped + '%;width:' + size + 'px;height:' + size + 'px;background:' + color + ';" title="' + escHtml(d.name) + '"></div>' +
      '<div class="scatter-label" style="left:' + d.x + '%;top:calc(' + yFlipped + '% + ' + (size / 2 + 4) + 'px);">' + escHtml(d.name) + '</div>';
  }).join('');

  var legendItems = Object.keys(SEGMENT_COLORS).filter(function(seg) { return seg !== 'default'; }).map(function(seg) {
    return '<span class="scatter-legend-item"><span class="scatter-legend-dot" style="background:' + SEGMENT_COLORS[seg] + '"></span>' +
      seg.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) + '</span>';
  }).join('');

  return '<div class="scatter-container">' +
    '<div class="scatter-axis-y">Target Segment</div>' +
    '<div class="scatter-axis-label scatter-axis-label-top">Enterprise</div>' +
    '<div class="scatter-axis-label scatter-axis-label-bottom">SMB</div>' +
    '<div class="scatter-gridline scatter-gridline-h"></div>' +
    '<div class="scatter-gridline scatter-gridline-v"></div>' +
    '<div class="scatter-area">' + dotsHtml + '</div>' +
    '<div class="scatter-axis-x">Feature Specificity</div>' +
    '<div class="scatter-axis-label scatter-axis-label-bl">Vertical-specific</div>' +
    '<div class="scatter-axis-label scatter-axis-label-br">Horizontal</div>' +
    '</div>' +
    '<div class="scatter-legend">' + legendItems + '</div>';
}

function renderKeywordQuadrant(body) {
  var kwSection = body.match(/### Core category keywords \(US\)\s*\n([\s\S]*?)(?=\n### |\n## |$)/);
  if (!kwSection) return null;

  var rows = kwSection[1].match(/^\|(?!\s*[-:]).+\|$/gm);
  if (!rows || rows.length < 2) return null;

  var keywords = [];
  for (var i = 1; i < rows.length; i++) {
    var cells = rows[i].split('|').map(function(c) { return c.trim(); }).filter(Boolean);
    if (cells.length >= 4) {
      keywords.push({
        name: cells[0],
        volume: parseInt(cells[1]) || 0,
        difficulty: parseInt(cells[2]) || 0,
        cpc: parseFloat(cells[3].replace('$', '')) || 0
      });
    }
  }
  if (keywords.length === 0) return null;

  var maxVol = Math.max.apply(null, keywords.map(function(k) { return k.volume; }));
  var maxDiff = Math.max.apply(null, keywords.map(function(k) { return k.difficulty; }));
  var diffMid = maxDiff / 2;
  var volMid = maxVol / 2;

  var q1 = [], q2 = [], q3 = [], q4 = [];
  keywords.forEach(function(kw) {
    if (kw.volume >= volMid && kw.difficulty <= diffMid) q1.push(kw);
    else if (kw.volume >= volMid && kw.difficulty > diffMid) q2.push(kw);
    else if (kw.volume < volMid && kw.difficulty <= diffMid) q3.push(kw);
    else q4.push(kw);
  });

  function renderItems(arr, cls) {
    return arr.map(function(kw) {
      return '<span class="quadrant-item ' + cls + '" title="Vol: ' + kw.volume + ' | KD: ' + kw.difficulty + ' | CPC: $' + kw.cpc.toFixed(2) + '">' + escHtml(kw.name) + '</span>';
    }).join('');
  }

  return '<div class="quadrant-container">' +
    '<div class="quadrant-grid">' +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Quick Wins</div><div class="quadrant-items">' + renderItems(q1, 'quadrant-q1') + '</div></div>' +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Long-term Bets</div><div class="quadrant-items">' + renderItems(q2, 'quadrant-q2') + '</div></div>' +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Niche Plays</div><div class="quadrant-items">' + renderItems(q3, 'quadrant-q3') + '</div></div>' +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Avoid</div><div class="quadrant-items">' + renderItems(q4, 'quadrant-q4') + '</div></div>' +
    '</div>' +
    '<div class="quadrant-axis-x">Difficulty &rarr;</div>' +
    '</div>';
}

function renderTimeline(body) {
  var phaseRe = /<!-- phase: ([^,]+), ([^,]+), ([^,]+), ([^>]+) -->/g;
  var phases = [];
  var m;
  while ((m = phaseRe.exec(body)) !== null) {
    phases.push({
      name: m[1].trim(),
      status: m[2].trim(),
      focus: m[3].trim().split('|').map(function(s) { return s.trim(); }),
      gate: m[4].trim()
    });
  }
  if (phases.length === 0) return null;

  var phasesHtml = phases.map(function(p, i) {
    var cls = p.status === 'active' ? ' active' : '';
    var focusHtml = '<ul class="timeline-phase-focus">' +
      p.focus.map(function(f) { return '<li>' + escHtml(f) + '</li>'; }).join('') +
      '</ul>';
    var arrow = i < phases.length - 1 ? '<div class="timeline-arrow"></div>' : '';
    return '<div class="timeline-phase' + cls + '">' +
      '<div class="timeline-phase-name">Phase ' + (i + 1) + ': ' + escHtml(p.name) + '</div>' +
      focusHtml +
      '<div class="timeline-phase-gate">' + escHtml(p.gate) + '</div>' +
      arrow +
      '</div>';
  }).join('');

  var labelsHtml = phases.map(function(p) {
    var badge = p.status === 'active'
      ? '<span class="badge badge-fresh">Active</span>'
      : '<span class="badge">Planned</span>';
    return '<div class="timeline-label">' + badge + '</div>';
  }).join('');

  return '<div class="timeline-container">' +
    '<div class="timeline-track">' + phasesHtml + '</div>' +
    '<div class="timeline-labels">' + labelsHtml + '</div>' +
    '</div>';
}

function renderStrategyWithViz(body) {
  var roadmapRe = /## 10\. Execution Roadmap\s*\n([\s\S]*?)(?=\n## \d|$)/;
  var roadmapMatch = body.match(roadmapRe);
  if (roadmapMatch) {
    var timeline = renderTimeline(roadmapMatch[1]);
    if (timeline) {
      var before = body.substring(0, roadmapMatch.index);
      var after = body.substring(roadmapMatch.index + roadmapMatch[0].length);
      body = before + '## 10. Execution Roadmap\n\n<!-- VIZ_PLACEHOLDER_TIMELINE -->\n' +
        roadmapMatch[1].replace(/<!-- phase:[^>]+-->\n?/g, '') + after;
      var html = renderMarkdown(body);
      html = html.replace('<!-- VIZ_PLACEHOLDER_TIMELINE -->', timeline);
      return html;
    }
  }
  return renderMarkdown(body);
}

function handleStrategyPage(res, pmDir) {
  var filePath = path.join(pmDir, 'strategy.md');
  if (!fs.existsSync(filePath)) {
    var html = dashboardPage('Strategy', '/kb', '<div class="page-header"><h1>Strategy</h1></div>' +
      renderEmptyState('No strategy defined', 'Your product strategy defines ICP, value proposition, competitive positioning, and priorities.', '/pm:strategy', 'Define your strategy'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  var raw = fs.readFileSync(filePath, 'utf-8');
  var parsed = parseFrontmatter(raw);
  var rendered = renderStrategyWithViz(parsed.body);

  var html = dashboardPage('Strategy', '/kb', '<div class="page-header"><h1>Strategy</h1></div>' +
    '<div class="markdown-body">' + rendered + '</div>');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function renderSentimentGap(compDir, slugs) {
  var competitors = [];
  slugs.forEach(function(slug) {
    var sentimentPath = path.join(compDir, slug, 'sentiment.md');
    if (!fs.existsSync(sentimentPath)) return;
    var raw = fs.readFileSync(sentimentPath, 'utf-8');
    var parsed = parseFrontmatter(raw);
    var name = parsed.data.company || humanizeSlug(slug);

    // Extract ratings from the ratings table
    var b2bRating = null;
    var iosRating = null;
    var androidRating = null;

    var tableRows = parsed.body.match(/^\|[^|]+\|[^|]+\|[^|]+\|.*\|$/gm);
    if (tableRows) {
      tableRows.forEach(function(row) {
        var cells = row.split('|').map(function(c) { return c.trim(); }).filter(Boolean);
        if (cells.length < 2) return;
        var platform = cells[0].toLowerCase();
        var ratingMatch = cells[1].match(/([\d.]+)\s*\/\s*5/);
        if (!ratingMatch) return;
        var rating = parseFloat(ratingMatch[1]);
        if (platform.indexOf('capterra') !== -1 || platform.indexOf('g2') !== -1 || platform.indexOf('getapp') !== -1) {
          if (!b2bRating || rating > b2bRating) b2bRating = rating;
        }
        if (platform.indexOf('apple') !== -1 || platform.indexOf('ios') !== -1) {
          if (platform.indexOf('legacy') === -1) {
            if (!iosRating || rating < iosRating) iosRating = rating;
          }
        }
        if (platform.indexOf('google') !== -1 || platform.indexOf('android') !== -1) {
          androidRating = rating;
        }
      });
    }

    if (b2bRating || iosRating || androidRating) {
      competitors.push({ name: name, b2b: b2bRating, ios: iosRating, android: androidRating });
    }
  });

  if (competitors.length === 0) return '';

  var groups = competitors.map(function(comp) {
    var rows = '';
    function barRow(label, value, colorCls) {
      if (!value) return '';
      var pct = (value / 5) * 100;
      return '<div class="bar-row">' +
        '<div class="bar-row-label">' + label + '</div>' +
        '<div class="bar-track"><div class="bar-fill ' + colorCls + '" style="width:' + pct + '%">' + value.toFixed(1) + '</div></div>' +
        '</div>';
    }
    rows += barRow('B2B Reviews', comp.b2b, 'bar-fill-blue');
    rows += barRow('iOS App Store', comp.ios, comp.ios >= 4.0 ? 'bar-fill-green' : comp.ios >= 3.0 ? 'bar-fill-yellow' : 'bar-fill-red');
    rows += barRow('Google Play', comp.android, comp.android >= 4.0 ? 'bar-fill-green' : comp.android >= 3.0 ? 'bar-fill-yellow' : 'bar-fill-red');

    var gap = '';
    var mobileAvg = null;
    if (comp.ios && comp.android) mobileAvg = (comp.ios + comp.android) / 2;
    else if (comp.ios) mobileAvg = comp.ios;
    else if (comp.android) mobileAvg = comp.android;
    if (comp.b2b && mobileAvg) {
      var diff = comp.b2b - mobileAvg;
      if (diff > 0.3) {
        gap = ' <span class="badge badge-stale">Gap: ' + diff.toFixed(1) + '</span>';
      }
    }

    return '<div class="bar-group"><div class="bar-group-label">' + escHtml(comp.name) + gap + '</div>' + rows + '</div>';
  }).join('');

  return '<section class="content-section"><h2>User Satisfaction Gap Analysis</h2>' +
    '<p class="chart-description">B2B review ratings (manager perspective) vs. app store ratings (field worker perspective). The gap reveals mobile app quality issues.</p>' +
    '<div class="bar-chart">' + groups + '</div></section>';
}

function renderSeoComparison(compDir, slugs) {
  var competitors = [];
  slugs.forEach(function(slug) {
    var seoPath = path.join(compDir, slug, 'seo.md');
    var profilePath = path.join(compDir, slug, 'profile.md');
    var name = humanizeSlug(slug);

    // Try profile first for company name
    if (fs.existsSync(profilePath)) {
      var profRaw = fs.readFileSync(profilePath, 'utf-8');
      var profParsed = parseFrontmatter(profRaw);
      if (profParsed.data.company) name = profParsed.data.company;
    }

    // Extract SEO data from seo.md or profile.md (some have inline SEO tables)
    var source = null;
    if (fs.existsSync(seoPath)) {
      source = fs.readFileSync(seoPath, 'utf-8');
    } else if (fs.existsSync(profilePath)) {
      var raw = fs.readFileSync(profilePath, 'utf-8');
      if (raw.indexOf('Domain Rating') !== -1) source = raw;
    }
    if (!source) return;

    var dr = null, traffic = null, keywords = null, top3 = null, trafficValue = null;
    var tableRows = source.match(/^\|[^|]+\|[^|]+\|$/gm);
    if (tableRows) {
      tableRows.forEach(function(row) {
        var cells = row.split('|').map(function(c) { return c.trim(); }).filter(Boolean);
        if (cells.length < 2) return;
        var metric = cells[0].toLowerCase();
        var val = cells[1].replace(/[,$]/g, '').replace(/\/mo$/, '');
        if (metric.indexOf('domain rating') !== -1) dr = parseInt(val) || null;
        if (metric.indexOf('organic traffic') !== -1 && metric.indexOf('value') === -1) traffic = parseInt(val) || null;
        if (metric.indexOf('organic keywords') !== -1) {
          var kwMatch = val.match(/^(\d+)/);
          keywords = kwMatch ? parseInt(kwMatch[1]) : null;
        }
        if (metric.indexOf('top 3') !== -1) top3 = parseInt(val) || null;
        if (metric.indexOf('traffic value') !== -1) trafficValue = parseInt(val) || null;
      });
    }

    if (dr || traffic) {
      competitors.push({ name: name, dr: dr, traffic: traffic, keywords: keywords, top3: top3, trafficValue: trafficValue });
    }
  });

  if (competitors.length === 0) return '';

  // Sort by DR descending
  competitors.sort(function(a, b) { return (b.dr || 0) - (a.dr || 0); });

  var maxDr = Math.max.apply(null, competitors.map(function(c) { return c.dr || 0; }));
  var maxTraffic = Math.max.apply(null, competitors.map(function(c) { return c.traffic || 0; }));

  var rows = competitors.map(function(comp) {
    var drPct = maxDr > 0 ? ((comp.dr || 0) / 100) * 100 : 0;
    var trafficPct = maxTraffic > 0 ? ((comp.traffic || 0) / maxTraffic) * 100 : 0;

    var drBar = '<div class="bar-row">' +
      '<div class="bar-row-label">DR</div>' +
      '<div class="bar-track"><div class="bar-fill bar-fill-teal" style="width:' + drPct + '%">' + (comp.dr || '-') + '</div></div>' +
      '</div>';
    var trafficBar = '<div class="bar-row">' +
      '<div class="bar-row-label">Traffic/mo</div>' +
      '<div class="bar-track"><div class="bar-fill bar-fill-blue" style="width:' + trafficPct + '%">' + (comp.traffic ? comp.traffic.toLocaleString() : '-') + '</div></div>' +
      '</div>';

    var meta = [];
    if (comp.keywords) meta.push(comp.keywords + ' keywords');
    if (comp.top3) meta.push(comp.top3 + ' in top 3');
    if (comp.trafficValue) meta.push('$' + comp.trafficValue.toLocaleString() + '/mo value');
    var metaHtml = meta.length > 0
      ? '<div class="bar-group-meta">' + meta.join(' \u00b7 ') + '</div>'
      : '';

    return '<div class="bar-group"><div class="bar-group-label">' + escHtml(comp.name) + '</div>' +
      drBar + trafficBar + metaHtml + '</div>';
  }).join('');

  return '<section class="content-section"><h2>SEO Competitive Position</h2>' +
    '<p class="chart-description">Domain authority and organic traffic comparison. Higher DR = harder to outrank.</p>' +
    '<div class="bar-chart">' + rows + '</div></section>';
}

function renderFeatureHeatmap(body) {
  // Parse pillar sections with tables
  var pillarRe = /## (Pillar \d+: [^\n]+|Cross-Cutting: [^\n]+)\s*\n([\s\S]*?)(?=\n## |$)/g;
  var pillars = [];
  var m;
  while ((m = pillarRe.exec(body)) !== null) {
    var pillarName = m[1];
    var tableContent = m[2];
    var rows = tableContent.match(/^\|(?!\s*[-:]).+\|$/gm);
    if (!rows || rows.length < 2) continue;

    var headers = rows[0].split('|').map(function(c) { return c.trim(); }).filter(Boolean);
    var features = [];
    for (var i = 1; i < rows.length; i++) {
      var cells = rows[i].split('|').map(function(c) { return c.trim(); }).filter(Boolean);
      if (cells.length >= 2) features.push(cells);
    }
    pillars.push({ name: pillarName, headers: headers, features: features });
  }

  if (pillars.length === 0) return renderMarkdown(body);

  var ratingClass = function(val) {
    var v = val.toLowerCase();
    if (v === 'full') return 'heatmap-full';
    if (v === 'partial') return 'heatmap-partial';
    if (v === 'missing') return 'heatmap-missing';
    if (v === 'differentiator') return 'heatmap-diff';
    return '';
  };

  var ratingLabel = function(val) {
    var v = val.toLowerCase();
    if (v === 'full') return '\u2713';
    if (v === 'partial') return '\u00BD';
    if (v === 'missing') return '\u2717';
    if (v === 'differentiator') return '\u2605';
    return escHtml(val);
  };

  // Build single unified table
  var allHeaders = pillars[0].headers;
  var colHeaders = allHeaders.slice(1).map(function(h) { return '<th>' + escHtml(h) + '</th>'; }).join('');
  var tableRows = '';

  pillars.forEach(function(p) {
    tableRows += '<tr><td colspan="' + allHeaders.length + '" class="heatmap-pillar">' + escHtml(p.name) + '</td></tr>';
    p.features.forEach(function(row) {
      var cells = '<td>' + escHtml(row[0]) + '</td>';
      for (var j = 1; j < row.length; j++) {
        var cls = ratingClass(row[j]);
        cells += '<td class="' + cls + '">' + ratingLabel(row[j]) + '</td>';
      }
      tableRows += '<tr>' + cells + '</tr>';
    });
  });

  return '<h2>Feature Parity Matrix</h2>' +
    '<div class="heatmap-legend">' +
    '<span class="heatmap-full heatmap-legend-badge">\u2713 Full</span>' +
    '<span class="heatmap-partial heatmap-legend-badge">\u00BD Partial</span>' +
    '<span class="heatmap-missing heatmap-legend-badge">\u2717 Missing</span>' +
    '<span class="heatmap-diff heatmap-legend-badge">\u2605 Differentiator</span>' +
    '</div>' +
    '<table class="heatmap-table"><thead><tr><th>Capability</th>' + colHeaders + '</tr></thead><tbody>' +
    tableRows + '</tbody></table>';
}

function renderLandscapeWithViz(body) {
  // Replace positioning map section with scatter plot
  var posMapRe = /## Market Positioning Map\s*\n([\s\S]*?)(?=\n## |$)/;
  var posMatch = body.match(posMapRe);
  if (posMatch) {
    var scatter = renderPositioningScatter(posMatch[1]);
    if (scatter) {
      var before = body.substring(0, posMatch.index);
      var after = body.substring(posMatch.index + posMatch[0].length);
      body = before + '## Market Positioning Map\n\n<!-- VIZ_PLACEHOLDER_SCATTER -->\n' + after;
    }
  }

  // Replace keyword section with quadrant chart
  var kwRe = /### Core category keywords \(US\)\s*\n([\s\S]*?)(?=\n### |\n## |$)/;
  var kwMatch = body.match(kwRe);
  var kwQuadrant = kwMatch ? renderKeywordQuadrant(body) : null;
  if (kwQuadrant && kwMatch) {
    var kwBefore = body.substring(0, kwMatch.index);
    var kwAfter = body.substring(kwMatch.index + kwMatch[0].length);
    body = kwBefore + '### Keyword Opportunity Matrix (US)\n\n<!-- VIZ_PLACEHOLDER_KEYWORDS -->\n' + kwAfter;
  }

  var html = renderMarkdown(body);

  // Inject visualizations
  if (posMatch) {
    var scatterPlot = renderPositioningScatter(posMatch[1]);
    if (scatterPlot) html = html.replace('<!-- VIZ_PLACEHOLDER_SCATTER -->', scatterPlot);
  }
  if (kwQuadrant) {
    html = html.replace('<!-- VIZ_PLACEHOLDER_KEYWORDS -->', kwQuadrant);
  }

  return html;
}

function extractProfileSummary(profileContent) {
  var summary = {};
  var h1Match = profileContent.match(/^#\s+(.+?)(?:\s*[-—]|$)/m);
  if (h1Match) summary.company = h1Match[1].trim();
  var catMatch = profileContent.match(/\*\*Category claim:\*\*\s*(.+)/i);
  if (catMatch) summary.category = catMatch[1].trim();
  return summary;
}

function handleCompetitorsList(res, pmDir) {
  var compDir = path.join(pmDir, 'competitors');
  var cardsHtml = '';
  var indexContent = '';

  var indexPath = path.join(compDir, 'index.md');
  if (fs.existsSync(indexPath)) {
    var raw = fs.readFileSync(indexPath, 'utf-8');
    var parsed = parseFrontmatter(raw);
    var gapsMatch = parsed.body.match(/## Market Gaps\n([\s\S]*?)(?=\n## |$)/);
    if (gapsMatch) {
      indexContent = '<section class="content-section"><h2>Market Gaps</h2>' + renderMarkdown(gapsMatch[1].trim()) + '</section>';
    }
  }

  var matrixContent = '';
  var matrixPath = path.join(compDir, 'matrix.md');
  if (fs.existsSync(matrixPath)) {
    var matrixRaw = fs.readFileSync(matrixPath, 'utf-8');
    var matrixParsed = parseFrontmatter(matrixRaw);
    matrixContent = '<section class="content-section">' + renderMarkdown(matrixParsed.body) + '</section>';
  }

  if (fs.existsSync(compDir)) {
    var slugs = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(function(e) { return e.isDirectory(); })
      .map(function(e) { return e.name; });

    cardsHtml = slugs.map(function(slug) {
      var profilePath = path.join(compDir, slug, 'profile.md');
      var name = slug;
      var cat = '';
      var badge = '';

      if (fs.existsSync(profilePath)) {
        var profRaw = fs.readFileSync(profilePath, 'utf-8');
        var profParsed = parseFrontmatter(profRaw);
        if (profParsed.data.company) name = profParsed.data.company;

        var summary = extractProfileSummary(profParsed.body);
        if (summary.company) name = summary.company;
        if (summary.category) cat = '<p class="meta">' + escHtml(summary.category) + '</p>';

        var files = ['profile.md', 'features.md', 'api.md', 'seo.md', 'sentiment.md'];
        var present = files.filter(function(f) { return fs.existsSync(path.join(compDir, slug, f)); }).length;
        badge = '<span class="badge">' + present + '/5</span>';
      }

      return '<article class="card">' +
        '<h3><a href="/competitors/' + escHtml(slug) + '">' + escHtml(name) + '</a></h3>' +
        cat +
        '<div class="card-footer">' + badge +
        '<a href="/competitors/' + escHtml(slug) + '" class="view-link">View &rarr;</a></div>' +
        '</article>';
    }).join('');
  }

  var body = '<div class="page-header"><h1>Competitors</h1></div>' +
    (cardsHtml ? '<div class="card-grid">' + cardsHtml + '</div>' : renderEmptyState('No competitor profiles', 'Competitor profiles cover features, pricing, API, SEO, and user sentiment for each rival.', '/pm:research competitors', 'Profile your competitors')) +
    matrixContent + indexContent;

  var html = dashboardPage('Competitors', '/kb', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ========== KB Hub Helpers (PM-122) ==========

function buildStrategyBanner(pmDir) {
  const snapshot = parseStrategySnapshot(pmDir);
  if (!snapshot) return '';
  const deckExists = fs.existsSync(path.join(pmDir, 'strategy-deck.html'));
  return `<div class="strategy-banner">
  <div class="strategy-banner-content">
    <div class="strategy-banner-label">Strategy</div>
    <div class="strategy-banner-headline">${escHtml(snapshot.focus)}</div>
    <div class="strategy-banner-priorities">
      ${snapshot.priorities.map((p, i) => `<div class="strategy-banner-priority"><span class="priority-num">${i + 1}</span> ${escHtml(p)}</div>`).join('')}
    </div>
  </div>
  <div class="strategy-banner-actions">
    <div class="strategy-banner-meta">
      <span class="staleness-dot ${snapshot.staleness.level}"></span>
      Updated ${escHtml(snapshot.staleness.label)}
    </div>
    <a href="/kb?tab=strategy" class="btn-sm">View strategy</a>
    ${deckExists ? '<a href="/strategy-deck" target="_blank" class="btn-sm">Slide deck</a>' : ''}
  </div>
</div>`;
}

function buildLandscapeCard(pmDir) {
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (!fs.existsSync(landscapePath)) return '';
  const raw = fs.readFileSync(landscapePath, 'utf-8');
  const { body } = parseFrontmatter(raw);
  const titleMatch = body.match(/^#\s+(.+)/m);
  const title = titleMatch ? titleMatch[1] : 'Market Landscape';
  const paragraphs = body.split(/\n\n/).filter(p => !p.startsWith('#'));
  const summary = paragraphs[0] ? paragraphs[0].replace(/\n/g, ' ').trim().slice(0, 200) : '';
  const statsData = parseStatsData(body);
  const topStats = (statsData || []).slice(0, 3);
  return `<a href="/kb?tab=landscape" class="landscape-card">
  <div class="landscape-title">${escHtml(title)}</div>
  <div class="landscape-summary">${escHtml(summary)}</div>
  ${topStats.length > 0 ? `<div class="landscape-stats">${topStats.map(s =>
    `<div><div class="landscape-stat">${escHtml(s.value)}</div><div class="landscape-stat-label">${escHtml(s.label)}</div></div>`
  ).join('')}</div>` : ''}
</a>`;
}

function buildCompetitorGrid(pmDir) {
  const compDir = path.join(pmDir, 'competitors');
  if (!fs.existsSync(compDir)) return '';
  const slugs = fs.readdirSync(compDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (slugs.length === 0) return '';
  const displaySlugs = slugs.length > 6 ? slugs.slice(0, 6) : slugs;
  const cards = displaySlugs.map(slug => {
    const profilePath = path.join(compDir, slug, 'profile.md');
    let name = humanizeSlug(slug);
    let category = '';
    if (fs.existsSync(profilePath)) {
      const raw = fs.readFileSync(profilePath, 'utf-8');
      const parsed = parseFrontmatter(raw);
      if (parsed.data.company) name = parsed.data.company;
      const summary = extractProfileSummary(parsed.body);
      if (summary.company) name = summary.company;
      if (summary.category) category = summary.category;
    }
    return `<a href="/competitors/${escHtml(slug)}" class="competitor-card">
  <div class="competitor-name">${escHtml(name)}</div>
  <div class="competitor-category">${escHtml(category)}</div>
</a>`;
  }).join('');
  const viewAll = slugs.length > 6 ? `<a href="/kb?tab=competitors" class="section-link">View all ${slugs.length}</a>` : '';
  return `<div class="competitor-grid">${cards}</div>${viewAll ? `<div class="view-all-wrap">${viewAll}</div>` : ''}`;
}

function buildTopicRows(pmDir, maxTopics) {
  const researchDir = path.join(pmDir, 'research');
  if (!fs.existsSync(researchDir)) return { html: '', total: 0 };
  const topics = fs.readdirSync(researchDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);
  if (topics.length === 0) return { html: '', total: 0 };

  const topicData = topics.map(t => {
    const findingsPath = path.join(researchDir, t, 'findings.md');
    let label = humanizeSlug(t);
    let origin = 'external';
    let stale = null;
    let dateStr = '';
    if (fs.existsSync(findingsPath)) {
      const parsed = parseFrontmatter(fs.readFileSync(findingsPath, 'utf-8'));
      const meta = buildTopicMeta(t, parsed.data, findingsPath);
      label = meta.label;
      origin = normalizeSourceOrigin(parsed.data.source_origin);
      dateStr = getUpdatedDate(findingsPath) || '';
      stale = stalenessInfo(dateStr);
    }
    return { slug: t, label, origin, stale, dateStr };
  });

  // Sort by freshness (newest first)
  topicData.sort((a, b) => (b.dateStr || '').localeCompare(a.dateStr || ''));
  const display = maxTopics ? topicData.slice(0, maxTopics) : topicData;

  const originLabels = { external: 'External', internal: 'Customer', mixed: 'Mixed' };
  const originBadge = o => `badge-${o === 'internal' ? 'customer' : o}`;
  const freshBadge = s => s ? `<span class="badge badge-${s.level}">${s.level.charAt(0).toUpperCase() + s.level.slice(1)}</span>` : '';

  const rows = display.map(t => `<a href="/research/${escHtml(t.slug)}" class="topic-row">
  <span class="topic-name">${escHtml(t.label)}</span>
  <div class="topic-badges">
    <span class="badge ${originBadge(t.origin)}">${escHtml(originLabels[t.origin] || 'External')}</span>
    ${freshBadge(t.stale)}
    <span class="topic-date">${escHtml(formatRelativeDate(t.dateStr))}</span>
  </div>
</a>`).join('');

  return { html: `<div class="topic-list">${rows}</div>`, total: topicData.length };
}

function handleKnowledgeBasePage(res, pmDir, tab) {
  // If a specific sub-tab is requested, render the existing detail view
  if (tab === 'strategy') {
    return handleKbStrategyDetail(res, pmDir);
  }
  if (tab === 'competitors') {
    return handleKbCompetitorsDetail(res, pmDir);
  }
  if (tab === 'landscape') {
    return handleKbLandscapeDetail(res, pmDir);
  }
  if (tab === 'topics' || tab === 'research') {
    return handleKbTopicsDetail(res, pmDir);
  }

  // Hub page (default) -- single scrollable view
  const strategyBanner = buildStrategyBanner(pmDir);
  const landscapeCard = buildLandscapeCard(pmDir);
  const competitorGrid = buildCompetitorGrid(pmDir);
  const { html: topicRows, total: topicCount } = buildTopicRows(pmDir, 8);

  // Customer evidence section
  const evidenceDir = path.join(pmDir, 'evidence');
  const hasEvidence = fs.existsSync(evidenceDir) &&
    fs.readdirSync(evidenceDir, { withFileTypes: true }).some(e => e.isDirectory() || e.name.endsWith('.md'));
  const evidenceHtml = hasEvidence
    ? '' // TODO: build evidence summary in PM-125
    : `<div class="empty-state-hub">
  <div class="empty-state-hub-title">No customer evidence yet</div>
  <div class="empty-state-hub-text">Import interview notes, support tickets, or feedback to ground decisions in real user signals.</div>
  ${renderClickToCopy('/pm:ingest path/to/evidence')}
</div>`;

  const compDir = path.join(pmDir, 'competitors');
  const compCount = fs.existsSync(compDir)
    ? fs.readdirSync(compDir, { withFileTypes: true }).filter(e => e.isDirectory()).length
    : 0;
  const matrixPath = path.join(pmDir, 'competitors', 'matrix.md');
  const matrixLink = fs.existsSync(matrixPath) ? '<a href="/kb?tab=competitors" class="section-link">Feature matrix</a>' : '';

  const body = `
<div class="page-header">
  <h1>Knowledge Base</h1>
  <p class="subtitle">Everything the team knows -- strategy, market, competitors, and research</p>
</div>
${strategyBanner}
${landscapeCard ? `<section class="section">
  <div class="section-header">
    <span class="section-title">Market Landscape</span>
  </div>
  ${landscapeCard}
</section>` : ''}
${compCount > 0 ? `<section class="section">
  <div class="section-header">
    <span class="section-title">Competitors</span>
    ${matrixLink}
  </div>
  ${competitorGrid}
</section>` : ''}
${topicCount > 0 ? `<section class="section">
  <div class="section-header">
    <span class="section-title">Research</span>
    <span class="section-count">${topicCount} topics</span>
  </div>
  ${topicRows}
  ${topicCount > 8 ? `<div class="view-all-wrap"><a href="/kb?tab=topics" class="section-link">View all ${topicCount} topics</a></div>` : ''}
</section>` : ''}
<section class="section">
  <div class="section-header">
    <span class="section-title">Customer Evidence</span>
  </div>
  ${evidenceHtml}
</section>`;

  const html = dashboardPage('Knowledge Base', '/kb', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ========== KB Detail Handlers (PM-122) ==========

function handleKbStrategyDetail(res, pmDir) {
  const filePath = path.join(pmDir, 'strategy.md');
  let contentHtml;
  if (!fs.existsSync(filePath)) {
    contentHtml = '<div class="page-header"><p class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></p><h1>Strategy</h1></div>' +
      renderEmptyState('No strategy defined', 'Your product strategy defines ICP, value proposition, competitive positioning, and priorities.', '/pm:strategy', 'Define your strategy');
  } else {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = parseFrontmatter(raw);
    const rendered = renderStrategyWithViz(parsed.body);
    contentHtml = '<div class="page-header"><p class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></p><h1>Strategy</h1></div>' +
      '<div class="markdown-body">' + rendered + '</div>';
  }
  const html = dashboardPage('Strategy', '/kb', contentHtml);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbCompetitorsDetail(res, pmDir) {
  const compDir = path.join(pmDir, 'competitors');
  let cardsHtml = '';
  if (fs.existsSync(compDir)) {
    const dirs = fs.readdirSync(compDir, { withFileTypes: true }).filter(e => e.isDirectory());
    cardsHtml = dirs.map(d => {
      const profilePath = path.join(compDir, d.name, 'profile.md');
      if (!fs.existsSync(profilePath)) return '';
      const summary = extractProfileSummary(parseFrontmatter(fs.readFileSync(profilePath, 'utf-8')).body);
      const stale = stalenessInfo(getUpdatedDate(profilePath));
      const staleBadge = stale ? `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>` : '';
      return `<article class="card">
        <h3><a href="/competitors/${escHtml(d.name)}">${escHtml(summary.company || humanizeSlug(d.name))}</a></h3>
        <p class="meta">${escHtml(summary.category || '')}</p>
        <div class="card-footer">${staleBadge}<a href="/competitors/${escHtml(d.name)}" class="view-link">View &rarr;</a></div>
      </article>`;
    }).join('');
  }
  const contentHtml = '<div class="page-header"><p class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></p><h1>Competitors</h1></div>' +
    (cardsHtml ? '<div class="card-grid">' + cardsHtml + '</div>' : renderEmptyState('No competitor profiles', 'Competitor profiles cover features, pricing, API, SEO, and user sentiment for each rival.', '/pm:research competitors', 'Profile your competitors'));
  const html = dashboardPage('Competitors', '/kb', contentHtml);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbLandscapeDetail(res, pmDir) {
  let landscapeHtml = '';
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (fs.existsSync(landscapePath)) {
    const raw = fs.readFileSync(landscapePath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    const statsData = parseStatsData(body);
    const statsHtml = renderStatsCards(statsData);
    var rendered = renderLandscapeWithViz(body);
    if (statsHtml) rendered = rendered.replace(/(<\/h1>)/, '$1' + statsHtml);
    landscapeHtml = '<div class="action-hint">Run <code>/pm:refresh</code> to update or <code>/pm:research landscape</code> to regenerate</div>' +
      '<div class="markdown-body">' + rendered + '</div>';
  } else {
    landscapeHtml = renderEmptyState('No landscape research', 'The landscape maps your market \u2014 TAM/SAM/SOM, market trends, and positioning opportunities.', '/pm:research landscape', 'Map your market');
  }
  const contentHtml = '<div class="page-header"><p class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></p><h1>Market Landscape</h1></div>' + landscapeHtml;
  const html = dashboardPage('Landscape', '/kb', contentHtml);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleKbTopicsDetail(res, pmDir) {
  let landscapeHtml = '';
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (fs.existsSync(landscapePath)) {
    const raw = fs.readFileSync(landscapePath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    const statsData = parseStatsData(body);
    const statsHtml = renderStatsCards(statsData);
    var rendered = renderLandscapeWithViz(body);
    if (statsHtml) rendered = rendered.replace(/(<\/h1>)/, '$1' + statsHtml);
    landscapeHtml = '<div class="action-hint">Run <code>/pm:refresh</code> to update or <code>/pm:research landscape</code> to regenerate</div>' +
      '<div class="markdown-body">' + rendered + '</div>';
  } else {
    landscapeHtml = renderEmptyState('No landscape research', 'The landscape maps your market \u2014 TAM/SAM/SOM, market trends, and positioning opportunities.', '/pm:research landscape', 'Map your market');
  }

  let topicsHtml = '';
  const researchDir = path.join(pmDir, 'research');
  if (fs.existsSync(researchDir)) {
    const topics = fs.readdirSync(researchDir, { withFileTypes: true })
      .filter(e => e.isDirectory());
    if (topics.length > 0) {
      const cards = topics.map(t => {
        const findingsPath = path.join(researchDir, t.name, 'findings.md');
        if (!fs.existsSync(findingsPath)) return '';
        const raw = fs.readFileSync(findingsPath, 'utf-8');
        const { data } = parseFrontmatter(raw);
        const meta = buildTopicMeta(t.name, data, findingsPath);
        return `<article class="card">
          <h3><a href="/research/${escHtml(t.name)}">${escHtml(meta.label)}</a></h3>
          <p class="meta">${escHtml(meta.subtitle)}</p>
          <div class="card-footer"><div class="topic-badges">${meta.badgesHtml}</div><a href="/research/${escHtml(t.name)}" class="view-link">View &rarr;</a></div>
        </article>`;
      }).join('');
      topicsHtml = '<h2>Topics</h2><div class="card-grid">' + cards + '</div>';
    }
  }

  const contentHtml = '<div class="page-header"><p class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></p><h1>Research</h1></div>' + landscapeHtml + topicsHtml;
  const html = dashboardPage('Research', '/kb', contentHtml);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleCompetitorDetail(res, pmDir, slug) {
  const compDir = path.join(pmDir, 'competitors', slug);
  if (!fs.existsSync(compDir)) {
    const html = dashboardPage('Not Found', '/kb', renderEmptyState('Competitor not found', 'This competitor profile does not exist.') + '<p><a href="/competitors">&larr; Back to competitors</a></p>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }

  const sectionKeys = ['profile', 'features', 'api', 'seo', 'sentiment'];
  const SECTION_LABELS = { profile: 'Profile', features: 'Features', api: 'API', seo: 'SEO', sentiment: 'Sentiment' };
  let name = slug;
  let category = '';
  let profileUpdatedDate = null;

  // Build flat sections and count available files
  const sectionBlocks = [];
  let availableCount = 0;
  sectionKeys.forEach((sec) => {
    const filePath = path.join(compDir, sec + '.md');
    if (!fs.existsSync(filePath)) return;
    availableCount++;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    if (sec === 'profile') {
      if (data.name) name = data.name;
      const summary = extractProfileSummary(body);
      if (summary.category) category = summary.category;
      profileUpdatedDate = data.updated || data.created || null;
    }
    const label = SECTION_LABELS[sec] || sec.charAt(0).toUpperCase() + sec.slice(1);
    const rendered = sec === 'profile' ? renderProfileWithSwot(body) : renderMarkdown(body);
    sectionBlocks.push(`<section class="detail-section">
  <h2 class="detail-section-title">${escHtml(label)}</h2>
  <div class="markdown-body">${rendered}</div>
</section>`);
  });

  // Breadcrumb
  const breadcrumb = `<nav class="detail-breadcrumb" aria-label="Breadcrumb">
  <a href="/kb?tab=competitors">Knowledge Base</a>
  <span class="breadcrumb-sep">/</span>
  <span class="breadcrumb-current">${escHtml(name)}</span>
</nav>`;

  // Title
  const titleHtml = `<h1 class="detail-title">${escHtml(name)}</h1>`;

  // Meta bar: category, sections count, freshness
  const metaParts = [];
  if (category) {
    metaParts.push(`<span class="meta-item">${escHtml(category)}</span>`);
  }
  metaParts.push(`<span class="meta-sep">&middot;</span>`);
  metaParts.push(`<span class="meta-item">${availableCount}/${sectionKeys.length} sections</span>`);
  const stale = stalenessInfo(profileUpdatedDate);
  if (stale) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`);
  }
  const metaBar = `<div class="detail-meta-bar">${metaParts.join('\n  ')}</div>`;

  // Action hint
  const actionHint = `<div class="detail-action-hint">${renderClickToCopy('/pm:research competitors')}</div>`;

  const body = `<div class="detail-page">
${breadcrumb}
${titleHtml}
${metaBar}
${sectionBlocks.join('\n')}
${actionHint}
</div>`;

  const html = dashboardPage(name, '/kb', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleResearchTopic(res, pmDir, topic) {
  const topicDir = path.join(pmDir, 'research', topic);
  const findingsPath = path.join(topicDir, 'findings.md');

  if (!fs.existsSync(findingsPath)) {
    const html = dashboardPage('Not Found', '/kb', renderEmptyState('Research topic not found', 'This research topic does not exist.') + '<p><a href="/research">&larr; Back to research</a></p>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }

  const raw = fs.readFileSync(findingsPath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const meta = buildTopicMeta(topic, data, findingsPath);

  // Breadcrumb
  const breadcrumb = `<nav class="detail-breadcrumb" aria-label="Breadcrumb">
  <a href="/kb?tab=research">Knowledge Base</a>
  <span class="breadcrumb-sep">/</span>
  <span class="breadcrumb-current">${escHtml(meta.label)}</span>
</nav>`;

  // Title + subtitle
  const titleHtml = `<h1 class="detail-title">${escHtml(meta.label)}</h1>
<p class="subtitle">${escHtml(meta.subtitle)}</p>`;

  // Meta bar: origin badge + evidence badge + freshness badge (reuse from buildTopicMeta)
  const metaBar = `<div class="detail-meta-bar">${meta.badgesHtml}</div>`;

  // Sections
  const sections = [];

  // Split body into main findings and sources/references
  const sourcesRe = /\n## (?:Sources|References)\s*\n/;
  const sourcesMatch = body.match(sourcesRe);
  let findingsBody = body;
  let sourcesBody = '';
  if (sourcesMatch) {
    findingsBody = body.substring(0, sourcesMatch.index);
    sourcesBody = body.substring(sourcesMatch.index + sourcesMatch[0].length);
  }

  // Main findings section
  sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Findings</h2>
  <div class="markdown-body">${renderMarkdown(findingsBody)}</div>
</section>`);

  // Sources section (if present)
  if (sourcesBody.trim()) {
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Sources</h2>
  <div class="markdown-body">${renderMarkdown(sourcesBody)}</div>
</section>`);
  }

  // Action hint
  const actionHint = `<div class="detail-action-hint">${renderClickToCopy('/pm:research ' + topic)}</div>`;

  const pageBody = `<div class="detail-page">
${breadcrumb}
${titleHtml}
${metaBar}
${sections.join('\n')}
${actionHint}
</div>`;

  const html = dashboardPage(meta.label, '/kb', pageBody);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleWireframe(res, pmDir, slug) {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/roadmap', '<div class="markdown-body"><h1>Not found</h1></div>'));
    return;
  }
  const wireframesDir = path.resolve(pmDir, 'backlog', 'wireframes');
  const wfPath = path.resolve(wireframesDir, slug + '.html');
  if (!wfPath.startsWith(wireframesDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Forbidden', '/roadmap', '<div class="markdown-body"><h1>Forbidden</h1></div>'));
    return;
  }
  try {
    const content = fs.readFileSync(wfPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Wireframe Not Found', '/roadmap', '<div class="markdown-body"><h1>Wireframe not found</h1><p>No wireframe exists for this backlog item.</p></div>'));
  }
}

function handleBacklog(res, pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const columns = {};
  const slugLookup = {};
  const STATUS_ORDER = ['idea', 'groomed', 'shipped'];
  const STATUS_MAP = { 'idea': 'idea', 'drafted': 'groomed', 'approved': 'groomed', 'in-progress': 'groomed', 'done': 'shipped' };

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      const rawStatus = data.status || 'idea';
      const status = STATUS_MAP[rawStatus] || rawStatus;
      const title = data.title || file.replace('.md', '');
      const slug = file.replace('.md', '');
      const badge = (rawStatus === 'in-progress' || rawStatus === 'approved') ? rawStatus : null;
      const priority = data.priority || 'medium';
      const labels = Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [];
      const scope = data.scope_signal || null;
      const id = data.id || null;
      const parent = data.parent || null;
      if (!columns[status]) columns[status] = [];
      slugLookup[slug] = { id, title };
      const updated = data.updated || data.created || '';
      columns[status].push({ slug, title, badge, priority, labels, scope, id, parent, updated });
    }
  }

  const allStatuses = STATUS_ORDER;

  const SHIPPED_LIMIT = 10;

  const renderItem = (item, status) => {
    const badgeHtml = item.badge ? ` <span class="status-badge badge-${item.badge}">${item.badge}</span>` : '';
    const labelHtml = item.labels.length > 0 ? '<div class="kanban-labels">' + item.labels.map(l => `<span class="kanban-label">${escHtml(l)}</span>`).join('') + '</div>' : '';
    const scopeHtml = item.scope ? `<span class="kanban-scope scope-${item.scope}">${item.scope}</span>` : '';
    const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span>` : '';
    const parentInfo = item.parent && slugLookup[item.parent] ? slugLookup[item.parent] : null;
    const parentHtml = parentInfo ? `<span class="kanban-parent">&uarr; ${escHtml(parentInfo.id || item.parent)}</span>` : '';
    const topLine = (idHtml || parentHtml) ? `<div class="kanban-item-ids">${idHtml}${parentHtml}${badgeHtml}</div>` : '';
    const hintHtml = status === 'idea'
      ? `<div class="kanban-item-hint">/pm:groom ${escHtml(item.slug)}</div>`
      : '';
    return `<a class="kanban-item priority-${item.priority}" href="/roadmap/${escHtml(item.slug)}" role="article">${topLine}<div class="kanban-item-title">${escHtml(item.title)}</div><div class="kanban-item-meta">${labelHtml}${scopeHtml}</div>${hintHtml}</a>`;
  };

  const COL_HINTS = {
    'idea': 'Run <code>/pm:groom &lt;slug&gt;</code> to scope an idea',
    'groomed': 'Edit <code>pm/backlog/&lt;slug&gt;.md</code> to update status',
  };

  const cols = allStatuses.map(status => {
    const allItems = columns[status] || [];
    const isShipped = status === 'shipped';
    const totalCount = allItems.length;
    const displayItems = isShipped && totalCount > SHIPPED_LIMIT
      ? allItems.sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, SHIPPED_LIMIT)
      : allItems;
    const items = displayItems.map(item => renderItem(item, status)).join('');
    const viewAllLink = isShipped && totalCount > SHIPPED_LIMIT
      ? `<a href="/roadmap/shipped" class="kanban-view-all">View all ${totalCount} shipped &rarr;</a>`
      : '';
    const label = status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const countLabel = isShipped && totalCount > SHIPPED_LIMIT ? ` <span class="col-count">${totalCount}</span>` : '';
    const emptyClass = totalCount === 0 ? ' col-empty' : '';
    const colHint = COL_HINTS[status] && totalCount > 0 ? `<div class="col-hint">${COL_HINTS[status]}</div>` : '';
    const shippedClass = isShipped ? ' shipped' : '';
    return `<div class="kanban-col${shippedClass}${emptyClass}">
  <div class="col-header">${label}${countLabel}</div>
  ${colHint}
  <div class="col-body">${items || '<div class="col-placeholder"></div>'}${viewAllLink}</div>
</div>`;
  }).join('');

  const legend = `<div class="backlog-legend">
<span class="legend-item"><span class="legend-bar priority-critical"></span>Critical</span>
<span class="legend-item"><span class="legend-bar priority-high"></span>High</span>
<span class="legend-item"><span class="legend-bar priority-medium"></span>Medium</span>
<span class="legend-item"><span class="legend-bar priority-low"></span>Low</span>
</div>`;
  const totalBacklogItems = Object.values(columns).reduce((sum, arr) => sum + arr.length, 0);
  const body = `
<div class="page-header"><h1>Roadmap</h1>
  <p class="subtitle">What's coming, what's in progress, and what just shipped</p>
${legend}</div>
${totalBacklogItems > 0 ? '<div class="kanban">' + cols + '</div>' : renderEmptyState('No backlog items', 'Backlog items are scoped issues created during grooming. They have acceptance criteria, wireframes, and priority.', '/pm:groom', 'Start grooming')}`;

  const html = dashboardPage('Roadmap', '/roadmap', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleShipped(res, pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const allItems = {};
  const childCount = {};

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      const slug = file.replace('.md', '');
      allItems[slug] = {
        slug,
        title: data.title || slug,
        status: data.status || 'idea',
        id: data.id || null,
        parent: data.parent || null,
        priority: data.priority || 'medium',
        labels: Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [],
        updated: data.updated || data.created || '',
        outcome: data.outcome || '',
        research_refs: Array.isArray(data.research_refs) ? data.research_refs : [],
      };
    }
  }

  // Build child counts
  for (const item of Object.values(allItems)) {
    if (item.parent && item.parent !== 'null' && allItems[item.parent]) {
      childCount[item.parent] = (childCount[item.parent] || 0) + 1;
    }
  }

  // Filter to done root items only
  const roots = Object.values(allItems).filter(i =>
    i.status === 'done' && (!i.parent || i.parent === 'null' || !allItems[i.parent])
  );
  roots.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const rows = roots.map(item => {
    const subCount = childCount[item.slug] || 0;
    const researchTopics = resolveResearchRefs(item.research_refs, pmDir);
    const strategyNote = resolveStrategyAlignment(item, allItems, pmDir);
    const competitorGaps = resolveCompetitiveContext(item, allItems, pmDir);

    // Build tag HTML
    const tags = [];
    for (const topic of researchTopics) {
      tags.push(`<span class="shipped-tag shipped-tag-research shipped-item-research">${escHtml(topic.label)}</span>`);
    }
    if (strategyNote) {
      tags.push(`<span class="shipped-tag shipped-tag-strategy">${escHtml(strategyNote)}</span>`);
    }
    for (const comp of competitorGaps) {
      tags.push(`<span class="shipped-tag shipped-tag-competitor">Addresses gap in ${escHtml(comp)}</span>`);
    }
    const labelTags = item.labels.map(l => `<span class="shipped-tag-label kanban-label">${escHtml(l)}</span>`);

    return `<a class="shipped-item-card" href="/roadmap/${escHtml(encodeURIComponent(item.slug))}">
  <div class="shipped-item-header">
    ${item.id ? `<span class="shipped-item-id">${escHtml(item.id)}</span>` : ''}
    <span class="shipped-item-title">${escHtml(item.title)}</span>
    ${subCount > 0 ? `<span class="shipped-item-sub">${subCount} sub-issue${subCount !== 1 ? 's' : ''}</span>` : ''}
    <span class="shipped-item-date">${escHtml(formatRelativeDate(item.updated))}</span>
  </div>
  ${item.outcome ? `<div class="shipped-item-outcome">${escHtml(item.outcome)}</div>` : ''}
  ${tags.length > 0 || labelTags.length > 0 ? `<div class="shipped-item-tags">${[...tags, ...labelTags].join('')}</div>` : ''}
</a>`;
  }).join('');

  const body = `
<p class="breadcrumb"><a href="/roadmap">&larr; Roadmap</a></p>
<div class="page-header"><h1>Shipped</h1>
  <p class="subtitle">${roots.length} item${roots.length !== 1 ? 's' : ''} shipped</p>
</div>
<div class="shipped-items">${rows || renderEmptyState('Nothing shipped yet', 'Completed items appear here once their status is set to done.')}</div>`;

  const html = dashboardPage('Shipped', '/roadmap', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleProposalDetail(res, pmDir, slug) {
  const meta = readProposalMeta(slug, pmDir);
  if (!meta) {
    res.writeHead(404); res.end('Not found');
    return;
  }

  const title = meta.title || humanizeSlug(slug);
  const status = meta.status || meta.verdict || 'draft';
  const issueCount = meta.issueCount || (Array.isArray(meta.issues) ? meta.issues.length : 0);
  const date = meta.date || meta.created || '';
  const outcome = meta.outcome || '';
  const strategyAlignment = meta.strategy_alignment || meta.strategy_check || '';
  const researchRefs = Array.isArray(meta.research_refs) ? meta.research_refs : [];
  const issues = Array.isArray(meta.issues) ? meta.issues : [];

  // Breadcrumb
  const breadcrumb = `<nav class="detail-breadcrumb" aria-label="Breadcrumb">
  <a href="/proposals">Proposals</a>
  <span class="breadcrumb-sep">/</span>
  <span class="breadcrumb-current">${escHtml(title)}</span>
</nav>`;

  // Title
  const titleHtml = `<h1 class="detail-title">${escHtml(title)}</h1>`;

  // Meta bar
  const metaParts = [];
  metaParts.push(`<span class="badge badge-${escHtml(status)}">${escHtml(status)}</span>`);
  if (issueCount > 0) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="meta-item">${issueCount} issue${issueCount !== 1 ? 's' : ''}</span>`);
  }
  if (date) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="meta-item">${escHtml(date)}</span>`);
  }
  const metaBar = `<div class="detail-meta-bar">${metaParts.join('\n  ')}</div>`;

  // Sections
  const sections = [];

  // Outcome section
  if (outcome) {
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Outcome</h2>
  <p>${escHtml(outcome)}</p>
</section>`);
  }

  // Strategy alignment section
  if (strategyAlignment) {
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Strategy Alignment</h2>
  <div class="detail-strategy-card"><p>${escHtml(strategyAlignment)}</p></div>
</section>`);
  }

  // Research references section
  if (researchRefs.length > 0) {
    const resolvedRefs = resolveResearchRefs(researchRefs, pmDir);
    const tags = resolvedRefs.map(r =>
      `<a href="/research/${escHtml(r.slug)}" class="detail-research-tag">${escHtml(r.label)}</a>`
    ).join('');
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Research</h2>
  <div class="detail-research-tags">${tags}</div>
</section>`);
  }

  // Issues list section
  if (issues.length > 0) {
    const backlogDir = path.join(pmDir, 'backlog');
    const issueItems = issues.map(issue => {
      const issueSlug = typeof issue === 'object' ? (issue.slug || '') : String(issue);
      if (!issueSlug) return '';
      let issueTitle = humanizeSlug(issueSlug);
      let issueId = '';
      const issuePath = path.join(backlogDir, issueSlug + '.md');
      if (fs.existsSync(issuePath)) {
        const parsed = parseFrontmatter(fs.readFileSync(issuePath, 'utf-8'));
        if (parsed.data.title) issueTitle = parsed.data.title;
        if (parsed.data.id) issueId = parsed.data.id;
      }
      const idSpan = issueId ? `<span class="detail-issue-id">${escHtml(issueId)}</span>` : '';
      return `<li><a href="/roadmap/${escHtml(issueSlug)}">${idSpan}${escHtml(issueTitle)}</a></li>`;
    }).filter(Boolean).join('\n');
    if (issueItems) {
      sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Issues</h2>
  <ul class="detail-issue-list">${issueItems}</ul>
</section>`);
    }
  }

  // Proposal embed (iframe) section
  const htmlPath = path.resolve(pmDir, 'backlog', 'proposals', slug + '.html');
  if (fs.existsSync(htmlPath)) {
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Full Proposal</h2>
  <div class="wireframe-embed">
    <div class="wireframe-header"><span class="wireframe-label">Proposal Document</span><a href="/proposals/${encodeURIComponent(slug)}/raw" target="_blank" class="wireframe-open">Open in new tab &nearr;</a></div>
    <iframe src="/proposals/${encodeURIComponent(slug)}/raw" class="wireframe-iframe"></iframe>
  </div>
</section>`);
  }

  // Action hint
  const actionHint = `<div class="detail-action-hint">${renderClickToCopy('/pm:groom ' + slug)}</div>`;

  const body = `<div class="detail-page">
${breadcrumb}
${titleHtml}
${metaBar}
${sections.join('\n')}
${actionHint}
</div>`;

  const page = dashboardPage(title, '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page);
}

function handleBacklogItem(res, pmDir, slug) {
  const filePath = path.join(pmDir, 'backlog', slug + '.md');
  if (!fs.existsSync(filePath)) {
    const html = dashboardPage('Not Found', '/roadmap', renderEmptyState('Backlog item not found', 'This backlog item does not exist.') + '<p><a href="/roadmap">&larr; Back to roadmap</a></p>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const title = data.title || slug;
  const status = data.status || 'idea';
  const priority = data.priority || '';
  const itemId = data.id || '';
  const date = data.updated || data.created || '';

  // Build slug lookup for resolving parent/children references
  const backlogDir = path.join(pmDir, 'backlog');
  const slugLookup = {};
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const s = file.replace('.md', '');
      const r = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data: d } = parseFrontmatter(r);
      slugLookup[s] = { id: d.id || null, title: d.title || s };
    }
  }

  // Resolve parent info for breadcrumb
  let parentSlug = data.parent || '';
  let parentTitle = '';
  if (parentSlug && slugLookup[parentSlug]) {
    parentTitle = slugLookup[parentSlug].title;
  }

  // Breadcrumb: Proposals / {Parent} / PM-XXX  OR  Roadmap / PM-XXX
  let breadcrumbInner = '';
  if (parentSlug && parentTitle) {
    breadcrumbInner = `<a href="/proposals">Proposals</a>
  <span class="breadcrumb-sep">/</span>
  <a href="/roadmap/${escHtml(parentSlug)}">${escHtml(parentTitle)}</a>
  <span class="breadcrumb-sep">/</span>
  <span class="breadcrumb-current">${escHtml(itemId ? itemId + ' ' + title : title)}</span>`;
  } else {
    breadcrumbInner = `<a href="/roadmap">Roadmap</a>
  <span class="breadcrumb-sep">/</span>
  <span class="breadcrumb-current">${escHtml(itemId ? itemId + ' ' + title : title)}</span>`;
  }
  const breadcrumb = `<nav class="detail-breadcrumb" aria-label="Breadcrumb">
  ${breadcrumbInner}
</nav>`;

  // Title with ID badge
  const idBadge = itemId ? `<span class="detail-id-badge">${escHtml(itemId)}</span>` : '';
  const titleHtml = `<h1 class="detail-title">${idBadge}${escHtml(title)}</h1>`;

  // Metadata bar
  const metaParts = [];
  metaParts.push(`<span class="badge badge-${escHtml(status)}">${escHtml(status)}</span>`);
  if (priority) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="meta-item">${escHtml(priority)} priority</span>`);
  }
  if (parentSlug && parentTitle) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="meta-item"><a href="/roadmap/${escHtml(parentSlug)}">${escHtml(parentTitle)}</a></span>`);
  }
  if (date) {
    metaParts.push(`<span class="meta-sep">&middot;</span>`);
    metaParts.push(`<span class="meta-item">${escHtml(date)}</span>`);
  }
  const metaBar = `<div class="detail-meta-bar">${metaParts.join('\n  ')}</div>`;

  // Sections
  const sections = [];

  // Outcome section
  if (data.outcome) {
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Outcome</h2>
  <p>${escHtml(data.outcome)}</p>
</section>`);
  }

  // Acceptance Criteria section — parse from body or frontmatter
  const acItems = [];
  if (Array.isArray(data.acceptance_criteria)) {
    data.acceptance_criteria.forEach(ac => acItems.push(String(ac)));
  } else {
    // Parse from markdown body: look for ## Acceptance Criteria section
    const acMatch = body.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
    if (acMatch) {
      const acBlock = acMatch[1];
      const acLines = acBlock.split('\n');
      for (const line of acLines) {
        const m = line.match(/^\s*[-*]\s+\[?\s*[xX ]?\]?\s*(.*)/);
        if (m && m[1].trim()) acItems.push(m[1].trim());
      }
    }
  }
  if (acItems.length > 0) {
    const acListItems = acItems.map(ac => `<li>${escHtml(ac)}</li>`).join('\n');
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Acceptance Criteria</h2>
  <ul class="detail-ac-list">${acListItems}</ul>
</section>`);
  }

  // Children section
  const children = Array.isArray(data.children) ? data.children.filter(c => c && slugLookup[c]) : [];
  if (children.length > 0) {
    const childItems = children.map(c => {
      const ch = slugLookup[c];
      const cId = ch.id ? `<span class="detail-issue-id">${escHtml(ch.id)}</span>` : '';
      return `<li><a href="/roadmap/${escHtml(c)}">${cId}${escHtml(ch.title)}</a></li>`;
    }).join('\n');
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Child Issues</h2>
  <ul class="detail-issue-list">${childItems}</ul>
</section>`);
  }

  // Wireframe embed section
  try {
    fs.accessSync(path.join(pmDir, 'backlog', 'wireframes', slug + '.html'));
    sections.push(`<section class="detail-section">
  <h2 class="detail-section-title">Wireframe</h2>
  <div class="wireframe-embed">
    <div class="wireframe-header"><span class="wireframe-label">Wireframe Preview</span><a href="/roadmap/wireframes/${encodeURIComponent(slug)}" target="_blank" class="wireframe-open">Open in new tab &nearr;</a></div>
    <iframe src="/roadmap/wireframes/${encodeURIComponent(slug)}" class="wireframe-iframe"></iframe>
  </div>
</section>`);
  } catch { /* no wireframe for this item */ }

  // Remaining markdown body section (strip AC section to avoid duplication)
  let remainingBody = body;
  if (acItems.length > 0) {
    remainingBody = remainingBody.replace(/## Acceptance Criteria\s*\n[\s\S]*?(?=\n## |\n# |$)/i, '').trim();
  }
  if (remainingBody.trim()) {
    sections.push(`<section class="detail-section">
  <div class="markdown-body">${renderMarkdown(rewriteKnowledgeBaseLinks(remainingBody))}</div>
</section>`);
  }

  // Action hint: click-to-copy /dev PM-XXX when status is not done
  let actionHint = '';
  if (itemId && status !== 'done') {
    actionHint = `<div class="detail-action-hint">${renderClickToCopy('/dev ' + itemId)}</div>`;
  } else if (!itemId && status !== 'done') {
    actionHint = `<div class="detail-action-hint">${renderClickToCopy('/pm:groom ' + slug)}</div>`;
  }

  const pageBody = `<div class="detail-page">
${breadcrumb}
${titleHtml}
${metaBar}
${sections.join('\n')}
${actionHint}
</div>`;

  const html = dashboardPage(title, '/roadmap', pageBody);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function rewriteKnowledgeBaseLinks(md) {
  return md
    .replace(/\]\(pm\/backlog\/wireframes\/([^).]+)\.html\)/g, '](/roadmap/wireframes/$1)')
    .replace(/\]\(pm\/research\/([^/]+)\/findings\.md\)/g, '](/research/$1)')
    .replace(/\]\(pm\/research\/([^)]+)\)/g, '](/research/$1)')
    .replace(/\]\(pm\/competitors\/([^/]+)\/([^)]+)\)/g, '](/competitors/$1#$2)')
    .replace(/\]\(pm\/competitors\/([^)]+)\)/g, '](/competitors/$1)');
}

// ========== Dashboard Server Factory ==========

function createDashboardServer(pmDir) {
  const dashClients = new Set();
  // Track all raw connections so we can force-close them when stopping
  const allConnections = new Set();
  const dirWatchers = new Map();
  const pmRuntimeRoot = getPmRuntimeRoot(pmDir);

  function handleDashboardUpgrade(req, socket) {
    touchActivity();
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = computeAcceptKey(key);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    dashClients.add(socket);
    allConnections.add(socket);
    let buffer = Buffer.alloc(0);

    function handleDashboardMessage(text) {
      let event;
      try {
        event = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e.message);
        return;
      }

      touchActivity();
      console.log(JSON.stringify({ source: 'user-event', ...event }));

      if (!event.choice) return;

      const slug = sessionSlugFromPath(event.path);
      if (!slug) return;

      const sessionDir = resolveSessionDir(pmDir, slug);
      if (!sessionDir) return;

      const eventsFile = path.join(sessionDir, '.events');
      fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
    }

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length > 0) {
        let result;
        try {
          result = decodeFrame(buffer);
        } catch (e) {
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          dashClients.delete(socket);
          allConnections.delete(socket);
          return;
        }
        if (!result) break;
        buffer = buffer.slice(result.bytesConsumed);

        switch (result.opcode) {
          case OPCODES.TEXT:
            handleDashboardMessage(result.payload.toString());
            break;
          case OPCODES.CLOSE:
            socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
            dashClients.delete(socket);
            allConnections.delete(socket);
            return;
          case OPCODES.PING:
            socket.write(encodeFrame(OPCODES.PONG, result.payload));
            break;
          case OPCODES.PONG:
            break;
          default: {
            const closeBuf = Buffer.alloc(2);
            closeBuf.writeUInt16BE(1003);
            socket.end(encodeFrame(OPCODES.CLOSE, closeBuf));
            dashClients.delete(socket);
            allConnections.delete(socket);
            return;
          }
        }
      }
    });

    socket.on('close', () => { dashClients.delete(socket); allConnections.delete(socket); });
    socket.on('error', () => { dashClients.delete(socket); allConnections.delete(socket); });
  }

  function broadcastDashboard(msg) {
    const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
    for (const socket of dashClients) {
      try { socket.write(frame); } catch (e) { dashClients.delete(socket); }
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method === 'GET') {
      routeDashboard(req, res, pmDir);
    } else {
      res.writeHead(405); res.end('Method Not Allowed');
    }
  });

  // Track HTTP connections too
  server.on('connection', (socket) => {
    allConnections.add(socket);
    socket.on('close', () => allConnections.delete(socket));
  });

  server.on('upgrade', handleDashboardUpgrade);

  let watcherActive = false;
  function closeWatchersUnder(prefixPath) {
    for (const [watchPath, watcher] of dirWatchers) {
      if (watchPath === prefixPath || watchPath.startsWith(prefixPath + path.sep)) {
        try { watcher.close(); } catch (e) {}
        dirWatchers.delete(watchPath);
      }
    }
  }

  function watchDirectoryTree(dirPath) {
    if (!watcherActive || dirWatchers.has(dirPath)) return;

    let stat;
    try {
      stat = fs.statSync(dirPath);
    } catch (e) {
      return;
    }
    if (!stat.isDirectory()) return;

    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        if (!watcherActive) return;

        const name = filename ? filename.toString() : '';
        const changedPath = name ? path.join(dirPath, name) : dirPath;

        if (eventType === 'rename') {
          try {
            const changedStat = fs.statSync(changedPath);
            if (changedStat.isDirectory()) {
              watchDirectoryTree(changedPath);
            }
          } catch (e) {
            closeWatchersUnder(changedPath);
          }
        }

        broadcastDashboard({ type: 'reload' });
      });

      dirWatchers.set(dirPath, watcher);
      watcher.on('error', () => closeWatchersUnder(dirPath));
    } catch (e) {
      return;
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        watchDirectoryTree(path.join(dirPath, entry.name));
      }
    }
  }

  if (fs.existsSync(pmDir)) {
    watcherActive = true;
    watchDirectoryTree(pmDir);
  }
  if (fs.existsSync(pmRuntimeRoot)) {
    watcherActive = true;
    watchDirectoryTree(pmRuntimeRoot);
  }

  // Patch server.close to also destroy all open connections and close watcher
  const origClose = server.close.bind(server);
  server.close = function(cb) {
    // Stop the watcher first so no more broadcasts fire during teardown
    watcherActive = false;
    closeWatchersUnder(pmDir);
    closeWatchersUnder(pmRuntimeRoot);
    // Destroy all open sockets so server.close callback fires promptly
    for (const sock of allConnections) {
      try { sock.destroy(); } catch (e) {}
    }
    allConnections.clear();
    dashClients.clear();
    origClose(cb);
  };

  return server;
}

const helperScript = fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf-8');
const helperInjection = '<script>\n' + helperScript + '\n</script>';

// ========== Helper Functions ==========

function slugifySessionTopic(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getPmRuntimeRoot(pmDir) {
  return path.resolve(pmDir, '..', '.pm');
}

function resolveSessionDir(pmDir, slug) {
  const sessionsDir = path.resolve(getPmRuntimeRoot(pmDir), 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;
  const prefixes = ['groom-', 'dev-', 'epic-', 'research-', ''];
  for (const prefix of prefixes) {
    const candidate = path.join(sessionsDir, prefix + slug);
    if (candidate.startsWith(sessionsDir + path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sessionSlugFromPath(requestPath) {
  const cleanPath = String(requestPath || '').split('?')[0];
  if (cleanPath.startsWith('/session/')) {
    return decodeURIComponent(cleanPath.slice('/session/'.length)).split('/')[0] || null;
  }
  if (cleanPath.startsWith('/groom/')) {
    return decodeURIComponent(cleanPath.slice('/groom/'.length)).split('/')[0] || null;
  }
  return null;
}

function injectSessionPageHelpers(html, slug) {
  const bootstrapScript = `<script>window.__PM_SESSION_SLUG = ${JSON.stringify(slug)};</script>`;
  const combined = bootstrapScript + '\n' + helperInjection;
  if (html.includes('window.__PM_SESSION_SLUG') || html.includes(helperScript.slice(0, 40))) {
    return html;
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', combined + '\n</body>');
  }
  return html + combined;
}

function loadSessionState(pmDir, slug) {
  const pmRoot = getPmRuntimeRoot(pmDir);
  const groomPath = path.join(pmRoot, 'groom-sessions', slug + '.md');
  if (fs.existsSync(groomPath)) {
    const raw = fs.readFileSync(groomPath, 'utf-8');
    const { data } = parseFrontmatter(raw);
    return { type: 'groom', data, raw };
  }

  const devPath = path.join(pmRoot, 'dev-sessions', slug + '.md');
  if (fs.existsSync(devPath)) {
    const raw = fs.readFileSync(devPath, 'utf-8');
    const { data } = parseFrontmatter(raw);
    return { type: 'dev', data, raw };
  }

  const legacyPath = path.join(pmRoot, '.groom-state.md');
  if (fs.existsSync(legacyPath)) {
    const raw = fs.readFileSync(legacyPath, 'utf-8');
    const { data } = parseFrontmatter(raw);
    if (slugifySessionTopic(data.topic) === slug) {
      return { type: 'groom', data, raw, legacy: true };
    }
  }

  return null;
}

function handleSessionPage(res, pmDir, slug) {
  const projectName = getProjectName(pmDir);
  const sessionDir = resolveSessionDir(pmDir, slug);
  if (sessionDir) {
    const currentHtml = path.join(sessionDir, 'current.html');
    if (currentHtml.startsWith(sessionDir + path.sep) && fs.existsSync(currentHtml)) {
      const html = injectSessionPageHelpers(fs.readFileSync(currentHtml, 'utf-8'), slug);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  const session = loadSessionState(pmDir, slug);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Session Not Found', '/', renderEmptyState('Session not found', 'No session found for <code>' + escHtml(slug) + '</code>.') + '<p><a href="/">&larr; Back to Home</a></p>', projectName));
    return;
  }

  const topic = session.data.topic || humanizeSlug(slug);
  const phase = session.type === 'groom'
    ? humanizeSlug(String(session.data.phase || 'in-progress'))
    : humanizeSlug(String(session.data.stage || session.data.phase || 'in-progress'));
  const started = session.data.started || session.data.updated || '';
  const typeLabel = session.type === 'groom' ? 'Grooming Session' : 'Development Session';
  const resumeCommand = session.type === 'groom' ? `/pm:groom ${slug}` : `/dev ${slug}`;
  const statePath = session.type === 'groom'
    ? (session.legacy ? '.pm/.groom-state.md' : `.pm/groom-sessions/${slug}.md`)
    : `.pm/dev-sessions/${slug}.md`;

  const body = `<div class="detail-page">
  <nav class="detail-breadcrumb" aria-label="Breadcrumb">
    <a href="/">Dashboard</a>
    <span class="breadcrumb-sep">/</span>
    <span class="breadcrumb-current">${escHtml(topic)}</span>
  </nav>
  <h1 class="detail-title">${escHtml(topic)}</h1>
  <div class="detail-meta-bar">
    <span class="meta-item">${escHtml(typeLabel)}</span>
    ${started ? `<span class="meta-sep">&middot;</span><span class="meta-item">Started ${escHtml(started)}</span>` : ''}
    <span class="meta-sep">&middot;</span><span class="meta-item">Phase ${escHtml(phase)}</span>
  </div>
  <section class="detail-section">
    <h2 class="detail-section-title">Resume</h2>
    <div class="markdown-body">
      <p>Resume this session from the terminal with <code>${escHtml(resumeCommand)}</code>.</p>
      <p>State file: <code>${escHtml(statePath)}</code></p>
    </div>
  </section>
</div>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(dashboardPage(`Session: ${topic}`, `/session/${slug}`, body, projectName));
}

// ========== Activity Tracking ==========

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let lastActivity = Date.now();

function touchActivity() {
  lastActivity = Date.now();
}

// ========== File Watching ==========

const debounceTimers = new Map();

// ========== Server Startup ==========

function startServer() {
  const pmDir = DIR_FLAG
    ? path.resolve(process.cwd(), DIR_FLAG)
    : path.join(process.cwd(), 'pm');

  const server = createDashboardServer(pmDir);

  function ownerAliveDash() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (e) { return false; }
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAliveDash()) {
      console.log(JSON.stringify({ type: 'server-stopped', reason: 'owner process exited' }));
      clearInterval(lifecycleCheck);
      server.close(() => process.exit(0));
    } else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      console.log(JSON.stringify({ type: 'server-stopped', reason: 'idle timeout' }));
      clearInterval(lifecycleCheck);
      server.close(() => process.exit(0));
    }
  }, 60 * 1000);
  lifecycleCheck.unref();

  server.listen(PORT, HOST, () => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? Number(address.port) : Number(PORT);
    const info = JSON.stringify({
      type: 'server-started', port: boundPort, host: HOST,
      url_host: URL_HOST, url: 'http://' + URL_HOST + ':' + boundPort,
      pm_dir: pmDir, mode: 'dashboard'
    });
    console.log(info);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  computeAcceptKey, encodeFrame, decodeFrame, OPCODES,
  parseMode, parseFrontmatter, renderMarkdown, inlineMarkdown, escHtml,
  createDashboardServer, dashboardPage,
  readProposalMeta, readGroomState, proposalGradient, buildProposalRows,
  formatRelativeDate, parseStrategySnapshot,
  resolveResearchRefs, resolveStrategyAlignment, resolveCompetitiveContext,
  DASHBOARD_CSS,
};
