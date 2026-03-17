const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

// Default SCREEN_DIR to .pm/sessions/{timestamp} relative to cwd
const DEFAULT_SCREEN_DIR = path.join(process.cwd(), '.pm', 'sessions', String(Date.now()));
const SCREEN_DIR = process.env.PM_DIR || DEFAULT_SCREEN_DIR;

const OWNER_PID = process.env.PM_OWNER_PID ? Number(process.env.PM_OWNER_PID) : null;

// --mode flag: 'companion' (default) or 'dashboard'
const MODE = (() => {
  const idx = process.argv.indexOf('--mode');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return process.env.PM_MODE || 'companion';
})();

// --dir flag: directory for dashboard mode (default: 'pm/' relative to cwd)
const DIR_FLAG = (() => {
  const idx = process.argv.indexOf('--dir');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
})();

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml'
};

// ========== Templates and Constants ==========

const WAITING_PAGE = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>PM Companion</title>
<style>body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 800px; margin: 0 auto; }
h1 { color: #333; } p { color: #666; }</style>
</head>
<body><h1>PM Companion</h1>
<p>Waiting for Claude to push a screen...</p></body></html>`;

// ========== Mode Parsing (exported for testing) ==========

function parseMode(argv) {
  const idx = argv.indexOf('--mode');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  return process.env.PM_MODE || 'companion';
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
:root {
  --bg: #f7f8fb;
  --surface: #ffffff;
  --border: #e2e5ea;
  --text: #1e2128;
  --text-muted: #6b7280;
  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-subtle: #eff4ff;
  --dark: #1a1a2e;
  --success: #16a34a;
  --warning: #ea580c;
  --info: #0891b2;
  --radius: 10px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.04);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.07);
  --transition: 180ms ease-out;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
a:hover { color: var(--accent-hover); text-decoration: underline; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }

/* Nav */
nav { background: var(--dark); padding: 0 1.5rem; display: flex; gap: 0; align-items: stretch; min-height: 48px; }
nav .brand { color: #fff; font-weight: 700; font-size: 0.9375rem; display: flex; align-items: center;
  margin-right: 1.5rem; letter-spacing: -0.01em; }
nav a { color: rgba(255,255,255,0.6); font-size: 0.8125rem; padding: 0 0.875rem;
  display: flex; align-items: center; border-bottom: 2px solid transparent;
  transition: color var(--transition), border-color var(--transition); text-decoration: none; }
nav a:hover { color: rgba(255,255,255,0.9); text-decoration: none; }
nav a.active { color: #fff; border-bottom-color: var(--accent); }
nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }

/* Layout */
.container { max-width: 1120px; margin: 0 auto; padding: 2rem 1.5rem; }

/* Typography */
h1 { font-size: 1.625rem; font-weight: 700; margin-bottom: 0.25rem; letter-spacing: -0.02em; }
h2 { font-size: 1.1875rem; font-weight: 600; margin: 1.75rem 0 0.75rem; letter-spacing: -0.01em; }
h3 { font-size: 0.9375rem; font-weight: 600; margin: 1rem 0 0.5rem; }
p { margin-bottom: 0.75rem; }
ul { margin: 0.5rem 0 0.75rem 1.5rem; }
li { margin-bottom: 0.25rem; }
pre { background: var(--dark); color: #e8eaed; padding: 1rem; border-radius: var(--radius-sm);
  overflow-x: auto; margin: 0.75rem 0; font-size: 0.8125rem; line-height: 1.5; }
code { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.85em; }
p code, li code { background: #eef0f4; padding: 0.15em 0.35em; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; font-size: 0.875rem; }
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
th { background: #eef0f4; font-weight: 600; font-size: 0.8125rem; text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: 1.25rem; text-align: center; box-shadow: var(--shadow-sm); }
.stat-card .value { font-size: 2rem; font-weight: 700; color: var(--accent); line-height: 1; }
.stat-card .label { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.25rem;
  text-transform: uppercase; letter-spacing: 0.05em; }

/* Card grid */
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
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
  overflow: hidden; box-shadow: none; border-right: 1px solid var(--border); }
.kanban-col:last-child { border-right: none; }
.kanban-col .col-header { background: transparent; padding: 0.5rem 1rem 0.75rem; font-weight: 600;
  font-size: 0.8125rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.kanban-col .col-body { padding: 0.5rem 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.kanban-col.col-empty { opacity: 0.45; }
.kanban-col.col-empty .col-body { min-height: 3rem; }
.status-badge { font-size: 0.6875rem; padding: 0.125rem 0.5rem; border-radius: 9999px; font-weight: 500; margin-left: 0.5rem; }
.badge-in-progress { background: #dbeafe; color: #1d4ed8; }
.badge-approved { background: #dcfce7; color: #15803d; }
.kanban-item { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 0.75rem;
  font-size: 0.875rem; transition: box-shadow var(--transition); border-left: 3px solid var(--border); }
.kanban-item.priority-critical { border-left-color: #dc2626; }
.kanban-item.priority-high { border-left-color: #f59e0b; }
.kanban-item.priority-medium { border-left-color: #3b82f6; }
.kanban-item.priority-low { border-left-color: #9ca3af; }
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
.wireframe-iframe { width: 100%; height: 500px; border: none; background: #fff; }
.kanban-item-ids { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem; }
.kanban-item-title { font-weight: 500; }
.kanban-item-meta { display: flex; align-items: center; gap: 0.375rem; margin-top: 0.375rem; flex-wrap: wrap; }
.kanban-label { font-size: 0.6875rem; padding: 0.0625rem 0.4rem; border-radius: 9999px; background: #f1f5f9; color: #475569; }
.kanban-scope { font-size: 0.6875rem; padding: 0.0625rem 0.4rem; border-radius: 9999px; font-weight: 500; }
.scope-small { background: #dcfce7; color: #15803d; }
.scope-medium { background: #dbeafe; color: #1d4ed8; }
.scope-large { background: #fef3c7; color: #92400e; }
.backlog-legend { display: flex; gap: 1rem; margin-top: 0.5rem; }
.legend-item { display: flex; align-items: center; gap: 0.375rem; font-size: 0.75rem; color: var(--text-muted); }
.legend-bar { width: 3px; height: 14px; border-radius: 2px; }
.legend-bar.priority-critical { background: #dc2626; }
.legend-bar.priority-high { background: #f59e0b; }
.legend-bar.priority-medium { background: #3b82f6; }
.legend-bar.priority-low { background: #9ca3af; }
.kanban-item a:hover { color: var(--accent); text-decoration: none; }
.kanban-view-all { display: block; text-align: center; padding: 0.5rem; font-size: 0.8125rem; color: var(--accent); text-decoration: none; border-top: 1px solid var(--border); margin-top: 0.25rem; }
.kanban-view-all:hover { text-decoration: underline; }
.col-count { font-size: 0.75rem; font-weight: 400; color: var(--text-muted); }
.shipped-list { display: flex; flex-direction: column; gap: 0.5rem; max-width: 40rem; }
.shipped-date { font-size: 0.6875rem; color: var(--text-muted); margin-left: auto; }

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
  font-weight: 600; background: #eef0f4; color: var(--text-muted); vertical-align: middle;
  letter-spacing: 0.02em; }
.badge-ready { background: #dcfce7; color: #166534; }
.badge-empty { background: #f3f4f6; color: #9ca3af; }
.badge-fresh { background: #dcfce7; color: #166534; }
.badge-aging { background: #fef3c7; color: #92400e; }
.badge-stale { background: #fee2e2; color: #991b1b; }
.badge-origin-internal { background: #dbeafe; color: #1d4ed8; }
.badge-origin-external { background: #e5e7eb; color: #374151; }
.badge-origin-mixed { background: #fde68a; color: #92400e; }
.badge-evidence { background: #e0f2fe; color: #0c4a6e; }

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

/* Empty states */
.empty-state { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-state h2 { color: var(--text); margin-bottom: 0.5rem; }
.empty-state p { max-width: 420px; margin-left: auto; margin-right: auto; }
.empty-state code { background: var(--accent-subtle); padding: 0.2em 0.5em; border-radius: 4px;
  font-size: 0.85rem; color: var(--accent); }

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
.swot-strengths { background: #f0fdf4; border-color: #bbf7d0; }
.swot-strengths h4 { color: #166534; }
.swot-weaknesses { background: #fef2f2; border-color: #fecaca; }
.swot-weaknesses h4 { color: #991b1b; }
.swot-opportunities { background: #eff6ff; border-color: #bfdbfe; }
.swot-opportunities h4 { color: #1e40af; }
.swot-threats { background: #fffbeb; border-color: #fde68a; }
.swot-threats h4 { color: #92400e; }
@media (max-width: 700px) { .swot-grid { grid-template-columns: 1fr; } }

/* Scatter plot */
.scatter-container { position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 2.5rem 2.5rem 2.5rem 3rem; margin: 1.5rem 0 3rem 0; aspect-ratio: 16/10; }
.scatter-area { position: relative; width: 100%; height: 100%; }
.scatter-dot { position: absolute; border-radius: 50%; background: var(--accent); opacity: 0.85;
  transform: translate(-50%, -50%); transition: opacity var(--transition), transform var(--transition); cursor: default; }
.scatter-dot:hover { opacity: 1; transform: translate(-50%, -50%) scale(1.15); z-index: 2; }
.scatter-dot.highlight { background: #044842; opacity: 1; }
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
.quadrant-q1 { background: #dcfce7; color: #166534; }
.quadrant-q2 { background: #fef3c7; color: #92400e; }
.quadrant-q3 { background: #dbeafe; color: #1d4ed8; }
.quadrant-q4 { background: #f3f4f6; color: #6b7280; }
.quadrant-axis-x { text-align: center; font-size: 0.6875rem; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-top: 0.75rem; }
.quadrant-axis-y { position: absolute; top: 50%; left: -2rem; transform: translateY(-50%) rotate(-90deg);
  font-size: 0.6875rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

/* Heatmap */
.heatmap-table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.8125rem; }
.heatmap-table th, .heatmap-table td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: center; }
.heatmap-table th { background: #eef0f4; font-weight: 600; font-size: 0.75rem; text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
.heatmap-table th:first-child, .heatmap-table td:first-child { text-align: left; font-weight: 500; }
.heatmap-pillar { background: var(--dark); color: #fff; font-weight: 700; font-size: 0.6875rem;
  text-transform: uppercase; letter-spacing: 0.05em; }
.heatmap-full { background: #dcfce7; color: #166534; font-weight: 600; }
.heatmap-partial { background: #fef3c7; color: #92400e; font-weight: 600; }
.heatmap-missing { background: #fee2e2; color: #991b1b; font-weight: 600; }
.heatmap-diff { background: #ccfbf1; color: #044842; font-weight: 700; }

/* Horizontal bar chart */
.bar-chart { margin: 1.5rem 0; }
.bar-group { margin-bottom: 1.25rem; }
.bar-group-label { font-size: 0.875rem; font-weight: 600; margin-bottom: 0.5rem; }
.bar-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.375rem; }
.bar-row-label { font-size: 0.75rem; color: var(--text-muted); width: 100px; flex-shrink: 0; text-align: right; }
.bar-track { flex: 1; height: 20px; background: #eef0f4; border-radius: 4px; position: relative; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 0.5rem;
  font-size: 0.6875rem; font-weight: 600; color: #fff; min-width: fit-content; }
.bar-fill-green { background: #16a34a; }
.bar-fill-yellow { background: #eab308; }
.bar-fill-red { background: #dc2626; }
.bar-fill-blue { background: #2563eb; }
.bar-fill-teal { background: #044842; }
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
.coverage-dot-fresh { background: #16a34a; }
.coverage-dot-aging { background: #eab308; }
.coverage-dot-stale { background: #dc2626; }
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

/* Proposal cards */
.proposal-card { position: relative; overflow: hidden; }
.proposal-card .card-gradient { height: 48px; border-radius: var(--radius) var(--radius) 0 0; }
.proposal-card h3 { margin: 0.5rem 0 0.25rem; }
.proposal-card.draft { border-style: dashed; border-color: #b8d4f0; cursor: default; opacity: 0.85; }
.proposal-card.draft:hover { box-shadow: var(--shadow-sm); transform: none; }
.draft-gradient { background: repeating-linear-gradient(45deg, #e8e8e8, #e8e8e8 10px, #f0f0f0 10px, #f0f0f0 20px); }
.badge-draft { background: #dbeafe; color: #1d4ed8; }
.proposals-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.75rem; }
.proposals-header h2 { margin: 0; }
.proposals-view-all { font-size: 0.8125rem; color: var(--accent); text-decoration: none; }
.proposals-view-all:hover { text-decoration: underline; }

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
    { href: '/research', label: 'Research' },
    { href: '/strategy', label: 'Strategy' },
    { href: '/backlog', label: 'Backlog' },
  ];
  const navHtml = navLinks.map(l =>
    `<a href="${l.href}"${activeNav === l.href ? ' class="active"' : ''}>${l.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} - ${escHtml(projectName)}</title>
<style>${DASHBOARD_CSS}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose'});</script>
</head>
<body>
<nav>
  <span class="brand">${escHtml(projectName)}</span>
  ${navHtml}
</nav>
<div class="container">
${bodyContent}
</div>
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onmessage = function(e) {
    try { var d = JSON.parse(e.data); if (d.type === 'reload') location.reload(); } catch(err) {}
  };
})();
</script>
</body>
</html>`;
}

// ========== Positioning Map Renderer ==========

const SEGMENT_COLORS = {
  'enterprise':  '#7c3aed',
  'mid-market':  '#2563eb',
  'smb':         '#16a34a',
  'horizontal':  '#ea580c',
  'self':        '#ef4444',
  'default':     '#6b7280',
};

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
    '<div class="map-legend">' + legendItems + '<span class="legend-item" style="margin-left:1rem;font-style:italic">Bubble size = organic traffic</span></div>' +
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
  const url = req.url.split('?')[0];
  const pmExists = fs.existsSync(pmDir);
  const projectName = pmExists ? getProjectName(pmDir) : 'PM';

  if (!pmExists) {
    const html = dashboardPage('PM Dashboard', '/', `
<div class="empty-state">
  <h2>No knowledge base found</h2>
  <p>The <code>pm/</code> directory does not exist yet.</p>
  <p>Run <code>/pm:setup</code> to get started and initialize your knowledge base.</p>
</div>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (url === '/') {
    handleDashboardHome(res, pmDir);
  } else if (url === '/research') {
    handleResearchPage(res, pmDir);
  } else if (url === '/landscape') {
    // Redirect old route
    res.writeHead(302, { 'Location': '/research#landscape' }); res.end();
  } else if (url === '/competitors') {
    // Redirect old route
    res.writeHead(302, { 'Location': '/research#competitors' }); res.end();
  } else if (url.startsWith('/competitors/')) {
    const slug = url.slice('/competitors/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleCompetitorDetail(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (url.startsWith('/research/')) {
    const topic = url.slice('/research/'.length).replace(/\/$/, '');
    if (topic && !topic.includes('/') && !topic.includes('..')) {
      handleResearchTopic(res, pmDir, topic);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (url === '/strategy') {
    handleStrategyPage(res, pmDir);
  } else if (url === '/backlog') {
    handleBacklog(res, pmDir);
  } else if (url === '/backlog/shipped') {
    handleShipped(res, pmDir);
  } else if (url.startsWith('/backlog/wireframes/')) {
    const slug = decodeURIComponent(url.slice('/backlog/wireframes/'.length)).replace(/\/$/, '').replace(/\.html$/, '');
    handleWireframe(res, pmDir, slug);
  } else if (url.startsWith('/backlog/')) {
    const slug = url.slice('/backlog/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleBacklogItem(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (url === '/proposals') {
    handleProposalsPage(res, pmDir);
  } else if (url.startsWith('/proposals/')) {
    const slug = decodeURIComponent(url.slice('/proposals/'.length)).replace(/\/$/, '');
    handleProposalDetail(res, pmDir, slug);
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

function humanizeSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
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

function readGroomState(pmDir) {
  const statePath = path.resolve(pmDir, '..', '.pm', '.groom-state.md');
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const { data } = parseFrontmatter(raw);
    if (typeof data.topic !== 'string' || data.topic.trim() === '') return null;
    return data;
  } catch {
    return null;
  }
}

const GROOM_PHASE_LABELS = {
  'intake': 'Intake', 'strategy-check': 'Strategy Check', 'research': 'Research',
  'scope': 'Scoping', 'scope-review': 'Scope Review', 'groom': 'Drafting Issues',
  'team-review': 'Team Review', 'bar-raiser': 'Bar Raiser', 'present': 'Presentation',
  'link': 'Linking Issues',
};

function groomPhaseLabel(phase) {
  if (!phase) return 'Unknown';
  return GROOM_PHASE_LABELS[phase] || humanizeSlug(phase);
}

function sanitizeGradient(value) {
  if (typeof value === 'string' && /^linear-gradient\(/.test(value) && !value.includes('url(')) return value;
  return '#e5e7eb';
}

function buildProposalCards(pmDir, limit) {
  const entries = [];

  // Scan completed proposals
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of files) {
      const slug = file.replace('.meta.json', '');
      const meta = readProposalMeta(slug, pmDir);
      if (!meta) continue;
      const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title : humanizeSlug(slug);
      const gradient = sanitizeGradient(meta.gradient);
      const stale = stalenessInfo(meta.date);
      const staleLabel = stale ? stale.label : '';
      const verdictHtml = meta.verdictLabel
        ? `<span class="badge badge-ready">${escHtml(String(meta.verdictLabel))}</span> `
        : '';
      const issueHtml = typeof meta.issueCount === 'number'
        ? `<span class="badge">${meta.issueCount} issue${meta.issueCount !== 1 ? 's' : ''}</span>`
        : '';
      entries.push({
        date: meta.date || '0000-00-00',
        isDraft: false,
        html: `<a href="/proposals/${escHtml(encodeURIComponent(slug))}" class="card proposal-card">
  <div class="card-gradient" style="background: ${gradient}"></div>
  <h3>${escHtml(title)}</h3>
  <p class="meta">${escHtml(staleLabel)}</p>
  <div class="card-footer"><div>${verdictHtml}${issueHtml}</div><span class="view-link">View →</span></div>
</a>`
      });
    }
  }

  // Check for draft from groom state
  const groomState = readGroomState(pmDir);
  if (groomState) {
    const topic = escHtml(groomState.topic);
    const phase = escHtml(groomPhaseLabel(groomState.phase || ''));
    const started = escHtml(groomState.started || '');
    entries.push({
      date: '9999-99-99', // pin to front
      isDraft: true,
      html: `<div class="card proposal-card draft">
  <div class="card-gradient draft-gradient"></div>
  <h3>${topic}</h3>
  <p class="meta">Grooming since ${started}</p>
  <div class="card-footer"><span class="badge badge-draft">Draft — ${phase}</span></div>
  <p class="action-hint">Resume with <code>/pm:groom</code></p>
</div>`
    });
  }

  // Sort newest first (draft pinned via 9999 date)
  entries.sort((a, b) => b.date.localeCompare(a.date));

  const totalCount = entries.length;
  const limited = limit ? entries.slice(0, limit) : entries;
  const cardsHtml = limited.map(e => e.html).join('\n');

  return { cardsHtml, totalCount };
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

function handleDashboardHome(res, pmDir) {
  // Scan pm/ and count files by type
  const stats = { total: 0, landscape: 0, strategy: 0, competitors: 0, backlog: 0, research: 0 };

  function countFiles(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) countFiles(path.join(dir, e.name));
      else if (e.name.endsWith('.md')) stats.total++;
    }
  }
  countFiles(pmDir);

  if (fs.existsSync(path.join(pmDir, 'landscape.md'))) stats.landscape = 1;
  if (fs.existsSync(path.join(pmDir, 'strategy.md'))) stats.strategy = 1;

  const backlogDir = path.join(pmDir, 'backlog');
  if (fs.existsSync(backlogDir)) {
    stats.backlog = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md')).length;
  }

  const compDir = path.join(pmDir, 'competitors');
  if (fs.existsSync(compDir)) {
    stats.competitors = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).length;
  }

  const researchDir = path.join(pmDir, 'research');
  if (fs.existsSync(researchDir)) {
    stats.research = fs.readdirSync(researchDir, { withFileTypes: true })
      .filter(e => e.isDirectory()).length;
  }

  // Collect updated dates for staleness
  const updatedDates = {
    strategy: getUpdatedDate(path.join(pmDir, 'strategy.md')),
    backlog: getNewestUpdated(path.join(pmDir, 'backlog')),
  };
  // Research staleness = newest across landscape, competitors, topics
  const researchDates = [
    getUpdatedDate(path.join(pmDir, 'landscape.md')),
    getNewestUpdated(path.join(pmDir, 'competitors')),
    getNewestUpdated(path.join(pmDir, 'research')),
  ].filter(Boolean);
  updatedDates.research = researchDates.length > 0 ? researchDates.sort().pop() : null;

  // Build research sub-counts
  const researchParts = [];
  if (stats.landscape) researchParts.push('Landscape');
  if (stats.competitors > 0) researchParts.push(`${stats.competitors} competitor${stats.competitors !== 1 ? 's' : ''}`);
  if (stats.research > 0) researchParts.push(`${stats.research} topic${stats.research !== 1 ? 's' : ''}`);
  const researchHasContent = researchParts.length > 0;
  const researchDesc = researchHasContent ? researchParts.join(' · ') : 'Landscape, competitors, and topic research';

  const sections = [
    { href: '/research', title: 'Research', desc: researchDesc, hasContent: researchHasContent, key: 'research' },
    { href: '/strategy', title: 'Strategy', desc: 'Product strategy and roadmap direction', hasContent: !!stats.strategy, key: 'strategy' },
    { href: '/backlog', title: 'Backlog', desc: `${stats.backlog} backlog item${stats.backlog !== 1 ? 's' : ''}`, hasContent: stats.backlog > 0, key: 'backlog' },
  ].map(s => {
    const badge = s.hasContent
      ? '<span class="badge badge-ready">Ready</span>'
      : '<span class="badge badge-empty">Empty</span>';
    const stale = s.hasContent ? stalenessInfo(updatedDates[s.key]) : null;
    const footerRight = stale
      ? `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`
      : '';
    return `<div class="card">
      <h3><a href="${s.href}">${s.title}</a> ${badge}</h3>
      <p class="meta">${s.desc}</p>
      <div class="card-footer"><span></span>${footerRight}</div>
    </div>`;
  }).join('');

  // Suggested next action based on knowledge base state
  let suggestedNext = '';
  if (!stats.strategy) {
    suggestedNext = 'Run <code>/pm:strategy</code> to define your product strategy';
  } else if (!stats.landscape) {
    suggestedNext = 'Run <code>/pm:research landscape</code> to map your market';
  } else if (stats.competitors === 0) {
    suggestedNext = 'Run <code>/pm:research competitors</code> to profile competitors';
  } else if (stats.backlog === 0) {
    suggestedNext = 'Run <code>/pm:ideate</code> to generate feature ideas from your knowledge base';
  } else {
    // Find first idea-status item to suggest grooming
    const backlogDir = path.join(pmDir, 'backlog');
    let firstIdea = null;
    if (fs.existsSync(backlogDir)) {
      const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
      for (const file of files) {
        const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
        const { data: d } = parseFrontmatter(raw);
        if (d.status === 'idea') { firstIdea = file.replace('.md', ''); break; }
      }
    }
    if (firstIdea) {
      suggestedNext = `Run <code>/pm:groom ${escHtml(firstIdea)}</code> to scope your next idea`;
    } else {
      suggestedNext = 'Run <code>/pm:ideate</code> to discover new opportunities';
    }
  }

  const suggestedHtml = `<div class="suggested-next">
  <div class="suggested-next-label">Suggested next</div>
  <div>${suggestedNext}</div>
</div>`;

  const projectName = getProjectName(pmDir);

  // Proposal cards section
  let proposalsHtml = '';
  const { cardsHtml: proposalCards, totalCount: proposalCount } = buildProposalCards(pmDir, 6);
  if (proposalCount > 0) {
    const viewAllText = proposalCount > 6
      ? `View all ${proposalCount} proposals →`
      : 'View all proposals →';
    proposalsHtml = `
<div class="content-section">
  <div class="proposals-header">
    <h2>Recent Proposals</h2>
    <a href="/proposals" class="proposals-view-all">${viewAllText}</a>
  </div>
  <div class="card-grid">${proposalCards}</div>
</div>`;
  }

  const body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Knowledge base overview</p>
</div>
${proposalsHtml}
<div class="card-grid">${sections}</div>
${suggestedHtml}`;

  const html = dashboardPage('Home', '/', body, projectName);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleProposalDetail(res, pmDir, slug) {
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/proposals', '<div class="empty-state"><p>Proposal not found.</p><p><a href="/proposals">&larr; Back to Proposals</a></p></div>'));
    return;
  }
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const htmlPath = path.resolve(proposalsDir, slug + '.html');
  if (!htmlPath.startsWith(proposalsDir + path.sep) || !fs.existsSync(htmlPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/proposals', '<div class="empty-state"><p>Proposal not found.</p><p><a href="/proposals">&larr; Back to Proposals</a></p></div>'));
    return;
  }
  const html = fs.readFileSync(htmlPath, 'utf-8');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleProposalsPage(res, pmDir) {
  const { cardsHtml, totalCount } = buildProposalCards(pmDir, null);

  let body;
  if (totalCount === 0) {
    body = `<div class="page-header"><h1>Proposals</h1></div>
<div class="empty-state">
  <h2>No proposals yet</h2>
  <p>Run <code>/pm:groom</code> to create your first proposal.</p>
</div>`;
  } else {
    body = `<div class="page-header"><h1>Proposals</h1>
  <p class="subtitle">${totalCount} proposal${totalCount !== 1 ? 's' : ''}</p>
</div>
<div class="card-grid">${cardsHtml}</div>`;
  }

  const html = dashboardPage('Proposals', '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
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
    landscapeHtml = '<div class="empty-state"><p>No landscape research yet.</p><p>Run <code>/pm:research landscape</code> to generate a market overview.</p></div>';
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

        return '<div class="card">' +
          '<h3><a href="/competitors/' + escHtml(slug) + '">' + escHtml(name) + '</a></h3>' +
          cat +
          '<div class="card-footer">' + badge +
          '<a href="/competitors/' + escHtml(slug) + '" class="view-link">View &rarr;</a></div>' +
          '</div>';
      }).join('');
      competitorsHtml = '<div class="action-hint">Run <code>/pm:research competitors</code> to re-profile or <code>/pm:refresh</code> to update</div>' +
        '<div class="card-grid">' + cards + '</div>';

      // Feature matrix (heatmap)
      const matrixPath = path.join(compDir, 'matrix.md');
      if (fs.existsSync(matrixPath)) {
        const matrixRaw = fs.readFileSync(matrixPath, 'utf-8');
        const matrixParsed = parseFrontmatter(matrixRaw);
        competitorsHtml += '<div class="content-section">' + renderFeatureHeatmap(matrixParsed.body) + '</div>';
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
    competitorsHtml = '<div class="empty-state"><p>No competitor profiles yet.</p><p>Run <code>/pm:research competitors</code> to start profiling.</p></div>';
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
        const pillarColors = {
          'Operational Replacement': '#dcfce7',
          'Payroll-Readiness': '#dbeafe',
          'Exception-First Ops': '#fef3c7',
          'AI & Platform': '#e0e7ff',
          'UX & Design': '#fce7f3',
          'Infrastructure': '#e5e7eb',
          'Other': '#f3f4f6'
        };

        const groupsHtml = pillarGroups.map(function(g) {
          const headerColor = pillarColors[g.name] || '#eef0f4';
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
            if (hasComparison) badges.push('<span class="badge" style="font-size:0.5625rem">+comparison</span>');

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
            '<div class="coverage-group-header" style="background:' + headerColor + '">' + escHtml(g.name) + ' <span class="badge">' + g.topics.length + '</span></div>' +
            '<div class="coverage-group-body">' + topicItems + '</div>' +
            '</div>';
        }).join('');

        const legendHtml = '<div style="display:flex;gap:1rem;font-size:0.75rem;color:var(--text-muted);margin-bottom:1rem">' +
          '<span style="display:flex;align-items:center;gap:0.25rem"><span class="coverage-dot coverage-dot-fresh"></span> Fresh (&lt;7d)</span>' +
          '<span style="display:flex;align-items:center;gap:0.25rem"><span class="coverage-dot coverage-dot-aging"></span> Aging (7-30d)</span>' +
          '<span style="display:flex;align-items:center;gap:0.25rem"><span class="coverage-dot coverage-dot-stale"></span> Stale (&gt;30d)</span>' +
          '</div>';

        topicsHtml = '<h2 style="margin-top:0">Research Coverage Matrix</h2>' + legendHtml +
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
          return '<div class="card">' +
            '<h3><a href="/research/' + escHtml(t) + '">' + escHtml(meta.label) + '</a></h3>' +
            '<p class="meta">' + escHtml(meta.subtitle) + '</p>' +
            '<div class="card-footer"><span>' + meta.badgesHtml + '</span><a href="/research/' + escHtml(t) + '" class="view-link">View &rarr;</a></div>' +
            '</div>';
        }).join('');
        topicsHtml = '<div class="card-grid">' + topicCards + '</div>';
      }
    }
  }
  if (!topicsHtml) {
    topicsHtml = '<div class="empty-state"><p>No topic research yet.</p><p>Run <code>/pm:research &lt;topic&gt;</code> for external research or <code>/pm:ingest &lt;path&gt;</code> to add customer evidence.</p></div>';
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

  const html = dashboardPage('Research', '/research', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleMarkdownPage(res, pmDir, filename, title, navPath) {
  const filePath = path.join(pmDir, filename);
  if (!fs.existsSync(filePath)) {
    const html = dashboardPage(title, navPath, `
<div class="page-header"><h1>${escHtml(title)}</h1></div>
<div class="empty-state">
  <p>No <code>${escHtml(filename)}</code> found.</p>
  <p>Run <code>/pm:setup</code> to initialize the knowledge base structure.</p>
</div>`);
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
    return '<div class="swot-box swot-' + k + '"><h4>' + labels[k] + '</h4><ul>' + (items || '<li style="color:var(--text-muted)">Not yet analyzed</li>') + '</ul></div>';
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
  var segColors = {
    'horizontal': '#6366f1', 'enterprise': '#dc2626', 'mid-market': '#2563eb',
    'smb': '#16a34a', 'self': '#044842'
  };

  var dotsHtml = dots.map(function(d) {
    var size = d.segment === 'self' ? 16 : Math.max(10, Math.min(40, Math.sqrt(d.traffic / maxTraffic) * 40));
    var color = segColors[d.segment] || '#6b7280';
    var cls = d.segment === 'self' ? ' highlight' : '';
    var yFlipped = 100 - d.y;
    return '<div class="scatter-dot' + cls + '" style="left:' + d.x + '%;top:' + yFlipped + '%;width:' + size + 'px;height:' + size + 'px;background:' + color + ';" title="' + escHtml(d.name) + '"></div>' +
      '<div class="scatter-label" style="left:' + d.x + '%;top:calc(' + yFlipped + '% + ' + (size / 2 + 4) + 'px);">' + escHtml(d.name) + '</div>';
  }).join('');

  var legendItems = Object.keys(segColors).map(function(seg) {
    return '<span class="scatter-legend-item"><span class="scatter-legend-dot" style="background:' + segColors[seg] + '"></span>' +
      seg.replace(/-/g, ' ').replace(/\b\w/g, function(c) { return c.toUpperCase(); }) + '</span>';
  }).join('');

  return '<div class="scatter-container">' +
    '<div class="scatter-axis-y">Target Segment</div>' +
    '<div class="scatter-axis-label scatter-axis-label-top" style="top:-1.25rem;left:0">Enterprise</div>' +
    '<div class="scatter-axis-label scatter-axis-label-bottom" style="bottom:-2.75rem;left:0">SMB</div>' +
    '<div class="scatter-gridline scatter-gridline-h" style="top:50%"></div>' +
    '<div class="scatter-gridline scatter-gridline-v" style="left:50%"></div>' +
    '<div class="scatter-area">' + dotsHtml + '</div>' +
    '<div class="scatter-axis-x">Feature Specificity</div>' +
    '<div class="scatter-axis-label" style="bottom:-1.25rem;left:0">Vertical-specific</div>' +
    '<div class="scatter-axis-label" style="bottom:-1.25rem;right:0">Horizontal</div>' +
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
      '<div style="margin-top:0.5rem;font-size:0.6875rem;color:var(--text-muted);font-style:italic">' + escHtml(p.gate) + '</div>' +
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
    var html = dashboardPage('Strategy', '/strategy', '<div class="page-header"><h1>Strategy</h1></div>' +
      '<div class="empty-state"><p>No <code>strategy.md</code> found.</p><p>Run <code>/pm:strategy</code> to create one.</p></div>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  var raw = fs.readFileSync(filePath, 'utf-8');
  var parsed = parseFrontmatter(raw);
  var rendered = renderStrategyWithViz(parsed.body);

  var html = dashboardPage('Strategy', '/strategy', '<div class="page-header"><h1>Strategy</h1></div>' +
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

  return '<div class="content-section"><h2>User Satisfaction Gap Analysis</h2>' +
    '<p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:1rem">B2B review ratings (manager perspective) vs. app store ratings (field worker perspective). The gap reveals mobile app quality issues.</p>' +
    '<div class="bar-chart">' + groups + '</div></div>';
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
      ? '<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:0.25rem">' + meta.join(' \u00b7 ') + '</div>'
      : '';

    return '<div class="bar-group"><div class="bar-group-label">' + escHtml(comp.name) + '</div>' +
      drBar + trafficBar + metaHtml + '</div>';
  }).join('');

  return '<div class="content-section"><h2>SEO Competitive Position</h2>' +
    '<p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:1rem">Domain authority and organic traffic comparison. Higher DR = harder to outrank.</p>' +
    '<div class="bar-chart">' + rows + '</div></div>';
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
    '<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:0.75rem">' +
    '<span class="heatmap-full" style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem">\u2713 Full</span>' +
    '<span class="heatmap-partial" style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem">\u00BD Partial</span>' +
    '<span class="heatmap-missing" style="padding:0.15em 0.5em;border-radius:4px;margin-right:0.5rem">\u2717 Missing</span>' +
    '<span class="heatmap-diff" style="padding:0.15em 0.5em;border-radius:4px">\u2605 Differentiator</span>' +
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
      indexContent = '<div class="content-section"><h2>Market Gaps</h2>' + renderMarkdown(gapsMatch[1].trim()) + '</div>';
    }
  }

  var matrixContent = '';
  var matrixPath = path.join(compDir, 'matrix.md');
  if (fs.existsSync(matrixPath)) {
    var matrixRaw = fs.readFileSync(matrixPath, 'utf-8');
    var matrixParsed = parseFrontmatter(matrixRaw);
    matrixContent = '<div class="content-section">' + renderMarkdown(matrixParsed.body) + '</div>';
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

      return '<div class="card">' +
        '<h3><a href="/competitors/' + escHtml(slug) + '">' + escHtml(name) + '</a></h3>' +
        cat +
        '<div class="card-footer">' + badge +
        '<a href="/competitors/' + escHtml(slug) + '" class="view-link">View &rarr;</a></div>' +
        '</div>';
    }).join('');
  }

  var body = '<div class="page-header"><h1>Competitors</h1></div>' +
    (cardsHtml ? '<div class="card-grid">' + cardsHtml + '</div>' : '<div class="empty-state"><p>No competitor profiles yet.</p></div>') +
    matrixContent + indexContent;

  var html = dashboardPage('Competitors', '/competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleCompetitorDetail(res, pmDir, slug) {
  const compDir = path.join(pmDir, 'competitors', slug);
  if (!fs.existsSync(compDir)) {
    const html = dashboardPage('Not Found', '/competitors', '<div class="empty-state"><p>Competitor not found.</p><p><a href="/competitors">&larr; Back to competitors</a></p></div>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }

  const sections = ['profile', 'features', 'api', 'seo', 'sentiment'];
  let name = slug;

  const tabHeaders = [];
  const tabPanels = [];

  const TAB_LABELS = { profile: 'Profile', features: 'Features', api: 'API', seo: 'SEO', sentiment: 'Sentiment' };

  sections.forEach((sec, idx) => {
    const filePath = path.join(compDir, sec + '.md');
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    if (idx === 0 && data.name) name = data.name;
    const label = TAB_LABELS[sec] || sec.charAt(0).toUpperCase() + sec.slice(1);
    const isFirst = tabHeaders.length === 0;
    tabHeaders.push(`<div class="tab${isFirst ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${isFirst}" onclick="switchTab(this,'tab-${sec}')" onkeydown="tabKey(event,this,'tab-${sec}')">${label}</div>`);
    const rendered = sec === 'profile' ? renderProfileWithSwot(body) : renderMarkdown(body);
    tabPanels.push(`<div id="tab-${sec}" class="tab-panel${isFirst ? ' active' : ''}" role="tabpanel"><div class="markdown-body">${rendered}</div></div>`);
  });

  const body = `
<div class="page-header">
  <p class="breadcrumb"><a href="/research#competitors">&larr; Competitors</a></p>
  <h1>${escHtml(name)}</h1>
</div>
<div class="tabs" role="tablist">${tabHeaders.join('')}</div>
${tabPanels.join('')}
<script>
function switchTab(el, panelId) {
  document.querySelectorAll('.tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  document.querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  el.setAttribute('aria-selected','true');
  document.getElementById(panelId).classList.add('active');
}
function tabKey(e, el, panelId) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(el, panelId); }
  if (e.key === 'ArrowRight') { var next = el.nextElementSibling; if (next) { next.focus(); next.click(); } }
  if (e.key === 'ArrowLeft') { var prev = el.previousElementSibling; if (prev) { prev.focus(); prev.click(); } }
}
</script>`;

  const html = dashboardPage(name, '/competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleResearchTopic(res, pmDir, topic) {
  const topicDir = path.join(pmDir, 'research', topic);
  const findingsPath = path.join(topicDir, 'findings.md');

  if (!fs.existsSync(findingsPath)) {
    const html = dashboardPage('Not Found', '/research', '<div class="empty-state"><p>Research topic not found.</p><p><a href="/research">&larr; Back to research</a></p></div>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }

  const raw = fs.readFileSync(findingsPath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const meta = buildTopicMeta(topic, data, findingsPath);
  const html = dashboardPage(meta.label, '/research', `
<div class="page-header">
  <p class="breadcrumb"><a href="/research#topics">&larr; Research</a></p>
  <h1>${escHtml(meta.label)}</h1>
  <p class="subtitle">${escHtml(meta.subtitle)}</p>
  <div class="topic-badges">${meta.badgesHtml}</div>
</div>
<div class="markdown-body">${renderMarkdown(body)}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleWireframe(res, pmDir, slug) {
  if (!slug || slug.includes('/') || slug.includes('..')) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/backlog', '<div class="markdown-body"><h1>Not found</h1></div>'));
    return;
  }
  const wireframesDir = path.resolve(pmDir, 'backlog', 'wireframes');
  const wfPath = path.resolve(wireframesDir, slug + '.html');
  if (!wfPath.startsWith(wireframesDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Forbidden', '/backlog', '<div class="markdown-body"><h1>Forbidden</h1></div>'));
    return;
  }
  try {
    const content = fs.readFileSync(wfPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Wireframe Not Found', '/backlog', '<div class="markdown-body"><h1>Wireframe not found</h1><p>No wireframe exists for this backlog item.</p></div>'));
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
    return `<a class="kanban-item priority-${item.priority}" href="/backlog/${escHtml(item.slug)}">${topLine}<div class="kanban-item-title">${escHtml(item.title)}</div><div class="kanban-item-meta">${labelHtml}${scopeHtml}</div>${hintHtml}</a>`;
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
      ? `<a href="/backlog/shipped" class="kanban-view-all">View all ${totalCount} shipped &rarr;</a>`
      : '';
    const label = status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const countLabel = isShipped && totalCount > SHIPPED_LIMIT ? ` <span class="col-count">${totalCount}</span>` : '';
    const emptyClass = totalCount === 0 ? ' col-empty' : '';
    const colHint = COL_HINTS[status] && totalCount > 0 ? `<div class="col-hint">${COL_HINTS[status]}</div>` : '';
    return `<div class="kanban-col${emptyClass}">
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
  const body = `
<div class="page-header"><h1>Backlog</h1>${legend}</div>
${cols ? '<div class="kanban">' + cols + '</div>' : '<div class="empty-state"><p>No backlog items yet. Run <code>/pm:groom &lt;feature idea&gt;</code> to start grooming.</p></div>'}`;

  const html = dashboardPage('Backlog', '/backlog', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleShipped(res, pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const STATUS_MAP = { 'done': true };
  const items = [];

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      if (!STATUS_MAP[data.status]) continue;
      items.push({
        slug: file.replace('.md', ''),
        title: data.title || file.replace('.md', ''),
        id: data.id || null,
        priority: data.priority || 'medium',
        labels: Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [],
        updated: data.updated || data.created || '',
      });
    }
  }

  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const rows = items.map(item => {
    const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
    const labelHtml = item.labels.map(l => `<span class="kanban-label">${escHtml(l)}</span>`).join(' ');
    return `<a class="kanban-item priority-${item.priority}" href="/backlog/${escHtml(item.slug)}">
  <div class="kanban-item-ids">${idHtml}</div>
  <div class="kanban-item-title">${escHtml(item.title)}</div>
  <div class="kanban-item-meta">${labelHtml}<span class="shipped-date">${escHtml(item.updated)}</span></div>
</a>`;
  }).join('');

  const body = `
<p class="breadcrumb"><a href="/backlog">&larr; Backlog</a></p>
<div class="page-header"><h1>Shipped</h1><span class="col-count" style="font-size:1rem;margin-left:0.5rem">${items.length} items</span></div>
<div class="shipped-list">${rows || '<div class="empty-state"><p>No shipped items yet.</p></div>'}</div>`;

  const html = dashboardPage('Shipped', '/backlog', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleBacklogItem(res, pmDir, slug) {
  const filePath = path.join(pmDir, 'backlog', slug + '.md');
  if (!fs.existsSync(filePath)) {
    const html = dashboardPage('Not Found', '/backlog', '<div class="empty-state"><p>Backlog item not found.</p><p><a href="/backlog">&larr; Back to backlog</a></p></div>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const title = data.title || slug;

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

  const idTag = data.id ? `<span class="backlog-item-id">${escHtml(data.id)}</span> ` : '';

  // Parent link
  let parentHtml = '';
  if (data.parent && slugLookup[data.parent]) {
    const p = slugLookup[data.parent];
    const pLabel = p.id ? `${escHtml(p.id)} ${escHtml(p.title)}` : escHtml(p.title);
    parentHtml = `<div class="issue-relation"><span class="relation-label">Parent:</span> <a href="/backlog/${escHtml(data.parent)}">${pLabel}</a></div>`;
  }

  // Children links
  let childrenHtml = '';
  const children = Array.isArray(data.children) ? data.children.filter(c => c && slugLookup[c]) : [];
  if (children.length > 0) {
    const childLinks = children.map(c => {
      const ch = slugLookup[c];
      const cLabel = ch.id ? `${escHtml(ch.id)} ${escHtml(ch.title)}` : escHtml(ch.title);
      return `<li><a href="/backlog/${escHtml(c)}">${cLabel}</a></li>`;
    }).join('');
    childrenHtml = `<div class="issue-relation"><span class="relation-label">Children:</span><ul class="issue-children">${childLinks}</ul></div>`;
  }

  const relationsHtml = (parentHtml || childrenHtml) ? `<div class="issue-relations">${parentHtml}${childrenHtml}</div>` : '';

  // Wireframe embed
  let wireframeHtml = '';
  try {
    fs.accessSync(path.join(pmDir, 'backlog', 'wireframes', slug + '.html'));
    wireframeHtml = `<div class="wireframe-embed">
  <div class="wireframe-header"><span class="wireframe-label">Wireframe Preview</span><a href="/backlog/wireframes/${encodeURIComponent(slug)}" target="_blank" class="wireframe-open">Open in new tab &nearr;</a></div>
  <iframe src="/backlog/wireframes/${encodeURIComponent(slug)}" class="wireframe-iframe"></iframe>
</div>`;
  } catch { /* no wireframe for this item */ }

  // Action hint based on status
  const rawStatus = data.status || 'idea';
  let actionHint = '';
  if (rawStatus === 'idea') {
    actionHint = `<div class="action-hint">Run <code>/pm:groom ${escHtml(slug)}</code> to scope and research this idea</div>`;
  } else if (rawStatus === 'drafted' || rawStatus === 'approved' || rawStatus === 'in-progress') {
    actionHint = `<div class="action-hint">Edit <code>pm/backlog/${escHtml(slug)}.md</code> to update status</div>`;
  }

  const html = dashboardPage(title, '/backlog', `
<div class="page-header">
  <p class="breadcrumb"><a href="/backlog">&larr; Backlog</a></p>
  <h1>${idTag}${escHtml(title)}</h1>
  ${actionHint}
  ${relationsHtml}
</div>
${wireframeHtml}
<div class="markdown-body">${renderMarkdown(rewriteKnowledgeBaseLinks(body))}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function rewriteKnowledgeBaseLinks(md) {
  return md
    .replace(/\]\(pm\/backlog\/wireframes\/([^).]+)\.html\)/g, '](/backlog/wireframes/$1)')
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

  // Patch server.close to also destroy all open connections and close watcher
  const origClose = server.close.bind(server);
  server.close = function(cb) {
    // Stop the watcher first so no more broadcasts fire during teardown
    watcherActive = false;
    closeWatchersUnder(pmDir);
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

const frameTemplate = fs.readFileSync(path.join(__dirname, 'frame-template.html'), 'utf-8');
const helperScript = fs.readFileSync(path.join(__dirname, 'helper.js'), 'utf-8');
const helperInjection = '<script>\n' + helperScript + '\n</script>';

// ========== Helper Functions ==========

function isFullDocument(html) {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
}

function wrapInFrame(content) {
  return frameTemplate.replace('<!-- CONTENT -->', content);
}

function getNewestScreen() {
  const files = fs.readdirSync(SCREEN_DIR)
    .filter(f => f.endsWith('.html'))
    .map(f => {
      const fp = path.join(SCREEN_DIR, f);
      return { path: fp, mtime: fs.statSync(fp).mtime.getTime() };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0].path : null;
}

// ========== HTTP Request Handler ==========

function handleRequest(req, res) {
  touchActivity();
  if (req.method === 'GET' && req.url === '/') {
    const screenFile = getNewestScreen();
    let html = screenFile
      ? (raw => isFullDocument(raw) ? raw : wrapInFrame(raw))(fs.readFileSync(screenFile, 'utf-8'))
      : WAITING_PAGE;

    if (html.includes('</body>')) {
      html = html.replace('</body>', helperInjection + '\n</body>');
    } else {
      html += helperInjection;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.method === 'GET' && req.url.startsWith('/files/')) {
    const fileName = req.url.slice(7);
    const filePath = path.join(SCREEN_DIR, path.basename(fileName));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(fs.readFileSync(filePath));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
}

// ========== WebSocket Connection Handling ==========

const clients = new Set();

function handleUpgrade(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = computeAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  let buffer = Buffer.alloc(0);
  clients.add(socket);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length > 0) {
      let result;
      try {
        result = decodeFrame(buffer);
      } catch (e) {
        socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
        clients.delete(socket);
        return;
      }
      if (!result) break;
      buffer = buffer.slice(result.bytesConsumed);

      switch (result.opcode) {
        case OPCODES.TEXT:
          handleMessage(result.payload.toString());
          break;
        case OPCODES.CLOSE:
          socket.end(encodeFrame(OPCODES.CLOSE, Buffer.alloc(0)));
          clients.delete(socket);
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
          clients.delete(socket);
          return;
        }
      }
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
}

function handleMessage(text) {
  let event;
  try {
    event = JSON.parse(text);
  } catch (e) {
    console.error('Failed to parse WebSocket message:', e.message);
    return;
  }
  touchActivity();
  console.log(JSON.stringify({ source: 'user-event', ...event }));
  if (event.choice) {
    const eventsFile = path.join(SCREEN_DIR, '.events');
    fs.appendFileSync(eventsFile, JSON.stringify(event) + '\n');
  }
}

function broadcast(msg) {
  const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
  for (const socket of clients) {
    try { socket.write(frame); } catch (e) { clients.delete(socket); }
  }
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
  // ---- Dashboard mode ----
  if (MODE === 'dashboard') {
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
        pm_dir: pmDir, mode: MODE
      });
      console.log(info);
    });
    return;
  }

  // ---- Companion mode (default) ----
  if (!fs.existsSync(SCREEN_DIR)) fs.mkdirSync(SCREEN_DIR, { recursive: true });

  // Track known files to distinguish new screens from updates.
  // macOS fs.watch reports 'rename' for both new files and overwrites,
  // so we can't rely on eventType alone.
  const knownFiles = new Set(
    fs.readdirSync(SCREEN_DIR).filter(f => f.endsWith('.html'))
  );

  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);

  const watcher = fs.watch(SCREEN_DIR, (eventType, filename) => {
    if (!filename || !filename.endsWith('.html')) return;

    if (debounceTimers.has(filename)) clearTimeout(debounceTimers.get(filename));
    debounceTimers.set(filename, setTimeout(() => {
      debounceTimers.delete(filename);
      const filePath = path.join(SCREEN_DIR, filename);

      if (!fs.existsSync(filePath)) return; // file was deleted
      touchActivity();

      if (!knownFiles.has(filename)) {
        knownFiles.add(filename);
        const eventsFile = path.join(SCREEN_DIR, '.events');
        if (fs.existsSync(eventsFile)) fs.unlinkSync(eventsFile);
        console.log(JSON.stringify({ type: 'screen-added', file: filePath }));
      } else {
        console.log(JSON.stringify({ type: 'screen-updated', file: filePath }));
      }

      broadcast({ type: 'reload' });
    }, 100));
  });
  watcher.on('error', (err) => console.error('fs.watch error:', err.message));

  function shutdown(reason) {
    console.log(JSON.stringify({ type: 'server-stopped', reason }));
    const infoFile = path.join(SCREEN_DIR, '.server-info');
    if (fs.existsSync(infoFile)) fs.unlinkSync(infoFile);
    fs.writeFileSync(
      path.join(SCREEN_DIR, '.server-stopped'),
      JSON.stringify({ reason, timestamp: Date.now() }) + '\n'
    );
    watcher.close();
    clearInterval(lifecycleCheck);
    server.close(() => process.exit(0));
  }

  function ownerAlive() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (e) { return false; }
  }

  // Check every 60s: exit if owner process died or idle for 30 minutes
  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) shutdown('owner process exited');
    else if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) shutdown('idle timeout');
  }, 60 * 1000);
  lifecycleCheck.unref();

  server.listen(PORT, HOST, () => {
    const address = server.address();
    const boundPort = address && typeof address === 'object' ? Number(address.port) : Number(PORT);
    const info = JSON.stringify({
      type: 'server-started', port: boundPort, host: HOST,
      url_host: URL_HOST, url: 'http://' + URL_HOST + ':' + boundPort,
      screen_dir: SCREEN_DIR, mode: MODE
    });
    console.log(info);
    fs.writeFileSync(path.join(SCREEN_DIR, '.server-info'), info + '\n');
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  computeAcceptKey, encodeFrame, decodeFrame, OPCODES,
  parseMode, parseFrontmatter, renderMarkdown, inlineMarkdown, escHtml,
  createDashboardServer,
  readProposalMeta, readGroomState, proposalGradient, groomPhaseLabel, sanitizeGradient, buildProposalCards,
};
