const crypto = require('crypto');
const http = require('http');
const net = require('net');
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

// Port is resolved at startup inside startServer() via resolvePort().
// PM_PORT env var overrides; otherwise hash project dir to 3000-9999.
const HOST = process.env.PM_HOST || '127.0.0.1';
const URL_HOST = process.env.PM_URL_HOST || (HOST === '127.0.0.1' ? 'localhost' : HOST);

const OWNER_PID = process.env.PM_OWNER_PID ? Number(process.env.PM_OWNER_PID) : null;

// ========== Stable Port Resolution ==========

/**
 * Hash an absolute directory path to a deterministic port in 3000-9999.
 * @param {string} dir - Absolute directory path
 * @returns {number} Port in range [3000, 9999]
 */
function hashProjectPort(dir) {
  const hash = crypto.createHash('md5').update(dir).digest();
  const num = hash.readUInt32BE(0);
  return 3000 + (num % 7000);
}

/**
 * Check if a port is available by attempting to listen on it.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    let done = false;
    const finish = (val) => { if (!done) { done = true; resolve(val); } };
    srv.once('error', () => srv.close(() => finish(false)));
    srv.listen(port, host, () => srv.close(() => finish(true)));
  });
}

/**
 * Resolve the port to use. PM_PORT overrides; otherwise hash project dir
 * and auto-increment on collision.
 * @param {string} host
 * @returns {Promise<{port: number, hashed: number|null, shifted: boolean}>}
 */
async function resolvePort(host) {
  if (process.env.PM_PORT) {
    const port = Number(process.env.PM_PORT);
    if (port === 0) {
      // PM_PORT=0 means "let OS pick" (used in tests)
      return { port: 0, hashed: null, shifted: false };
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid PM_PORT: "${process.env.PM_PORT}"`);
    }
    return { port, hashed: null, shifted: false };
  }

  const projectDir = process.env.PM_PROJECT_DIR || process.cwd();
  const hashed = hashProjectPort(projectDir);

  for (let offset = 0; offset < 100; offset++) {
    const candidate = hashed + offset;
    if (candidate > 9999) break;
    if (await isPortAvailable(candidate, host)) {
      return { port: candidate, hashed, shifted: offset > 0 };
    }
  }

  // Fallback: let OS pick
  return { port: 0, hashed, shifted: true };
}

// --dir flag: pm/ directory to serve (default: 'pm/' relative to cwd)
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

    // No inline value — check if next lines are array items or nested object
    const items = [];
    let nestedObj = null;
    i++;

    // Peek at the first indented line to determine if this is an array or a nested object
    if (i < lines.length) {
      const peek = lines[i];
      const isListItem = peek.match(/^[ \t]+-\s/);
      const isNestedKey = peek.match(/^[ \t]+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);

      if (!isListItem && isNestedKey) {
        // Nested object (not an array)
        nestedObj = {};
        while (i < lines.length) {
          const nl = lines[i];
          if (nl.trim() === '') { i++; continue; }
          const nestedKeyMatch = nl.match(/^[ \t]+([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
          if (!nestedKeyMatch) break;
          const nk = nestedKeyMatch[1];
          const nv = nestedKeyMatch[2].trim();
          if (nv === '' || nv === '[]' || nv === 'null') {
            // Check for sub-array
            const subItems = [];
            if (nv === '[]') { nestedObj[nk] = []; i++; continue; }
            if (nv === 'null') { nestedObj[nk] = null; i++; continue; }
            i++;
            while (i < lines.length) {
              const sl = lines[i];
              const subMatch = sl.match(/^[ \t]{4,}-\s+(.*)/);
              if (subMatch) { subItems.push(subMatch[1].trim().replace(/^["'](.*)["']$/, '$1')); i++; }
              else break;
            }
            nestedObj[nk] = subItems.length > 0 ? subItems : null;
          } else {
            // Parse value: numbers, booleans, strings
            let val = nv.replace(/^["'](.*)["']$/, '$1');
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
            nestedObj[nk] = val;
            i++;
          }
        }
        data[key] = nestedObj;
        continue;
      }
    }

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
:root, [data-theme="dark"] {
  --bg: #0d0f12;
  --surface: #1a1d23;
  --surface-raised: #1e2128;
  --border: rgba(255, 255, 255, 0.08);
  --text: #e8eaed;
  --text-muted: #8b8f96;
  --accent: #5e6ad2;
  --accent-hover: #7c85e0;
  --accent-subtle: #1e1f35;
  --dark: #111318;
  --sidebar-bg: #111318;
  --sidebar-text: #ffffff;
  --sidebar-text-muted: rgba(255,255,255,0.5);
  --sidebar-text-hover: rgba(255,255,255,0.9);
  --sidebar-hover-bg: rgba(255,255,255,0.06);
  --sidebar-active-bg: rgba(255,255,255,0.08);
  --success: #4ade80;
  --warning: #fb923c;
  --info: #38bdf8;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.4);
  --transition: 150ms ease-out;
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
  --space-16: 64px;
  --space-24: 96px;
  /* Typography scale */
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-base: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 2rem;
  color-scheme: dark;
}
[data-theme="light"] {
  --bg: #f8f9fb;
  --surface: #ffffff;
  --surface-raised: #f0f2f5;
  --border: rgba(0, 0, 0, 0.06);
  --text: #1e2128;
  --sidebar-bg: #f0f1f4;
  --sidebar-text: #1e2128;
  --sidebar-text-muted: rgba(30,33,40,0.5);
  --sidebar-text-hover: rgba(30,33,40,0.9);
  --sidebar-hover-bg: rgba(0,0,0,0.04);
  --sidebar-active-bg: rgba(0,0,0,0.07);
  --text-muted: #6b7280;
  --accent: #5e6ad2;
  --accent-hover: #4f5bc4;
  --accent-subtle: #eef0ff;
  --dark: #1a1a2e;
  --success: #16a34a;
  --warning: #ea580c;
  --info: #0891b2;
  --radius: 8px;
  --radius-sm: 6px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --transition: 150ms ease-out;
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
  --space-16: 64px;
  --space-24: 96px;
  /* Typography scale */
  --text-xs: 0.75rem;
  --text-sm: 0.8125rem;
  --text-base: 0.875rem;
  --text-lg: 1rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 2rem;
  color-scheme: light;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg); color: var(--text); font-size: var(--text-base); line-height: 1.5; -webkit-font-smoothing: antialiased;
  letter-spacing: -0.011em; }
.stat-card .value, .pulse-arc-text, .pulse-dim-score, .bar-value, .col-count, .group-count { font-variant-numeric: tabular-nums; }
a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
a:hover { color: var(--accent-hover); }
a:focus-visible { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent); outline: none; border-radius: 4px; }

/* Nav */
nav { background: var(--dark); padding: 0 var(--space-6); display: flex; gap: 0; align-items: stretch; min-height: 48px; }
nav .brand { color: #fff; font-weight: 700; font-size: var(--text-base); display: flex; align-items: center;
  margin-right: var(--space-6); letter-spacing: -0.01em; }
nav a { color: rgba(255,255,255,0.6); font-size: var(--text-sm); padding: 0 var(--space-3);
  display: flex; align-items: center; border-bottom: 2px solid transparent;
  transition: color var(--transition), border-color var(--transition); text-decoration: none; }
nav a:hover { color: rgba(255,255,255,0.9); text-decoration: none; }
nav a.active { color: #fff; border-bottom-color: var(--accent); }
nav a:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.kb-sub-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin-bottom: var(--space-6); }
.kb-sub-tab { padding: var(--space-3) var(--space-4); font-size: var(--text-sm); font-weight: 500; color: var(--text-muted);
  text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; transition: color 0.15s; }
.kb-sub-tab:hover { color: var(--text); }
.kb-sub-tab.active { color: var(--accent, #2563eb); border-bottom-color: var(--accent, #2563eb); }

/* Layout */
.container { max-width: 1120px; margin: 0 auto; padding: var(--space-6) var(--space-8); }

/* Typography */
h1 { font-size: var(--text-2xl); font-weight: 600; margin-bottom: var(--space-1); letter-spacing: -0.02em; }
h2 { font-size: var(--text-lg); font-weight: 600; margin: var(--space-8) 0 var(--space-3); letter-spacing: -0.01em; }
h3 { font-size: var(--text-base); font-weight: 600; margin: var(--space-4) 0 var(--space-2); }
p { margin-bottom: var(--space-3); }
ul { margin: var(--space-2) 0 var(--space-3) var(--space-6); }
li { margin-bottom: var(--space-1); }
pre { background: #111318; color: #c4c8d0; padding: var(--space-4); border-radius: var(--radius-sm);
  overflow-x: auto; margin: var(--space-3) 0; font-size: var(--text-sm); line-height: 1.5; }
code { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; font-size: 0.85em; }
p code, li code { background: #1e2128; padding: 0.15em 0.35em; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin: var(--space-4) 0; font-size: var(--text-base); }
th, td { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); text-align: left; }
th { background: #1e2128; font-weight: 600; font-size: var(--text-sm); text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
hr { border: none; border-top: 1px solid var(--border); margin: var(--space-6) 0; }

/* Stat cards */
.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); margin: var(--space-4) 0; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-4) var(--space-5); text-align: left; }
.stat-card .value { font-size: var(--text-2xl); font-weight: 700; color: var(--text); line-height: 1; }
.stat-card .label { font-size: var(--text-xs); color: var(--text-muted); margin-top: var(--space-1);
  text-transform: uppercase; letter-spacing: 0.05em; }
a.stat-card-link { text-decoration: none; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s; }
a.stat-card-link:hover { border-color: var(--accent, #2563eb); box-shadow: var(--shadow-sm); }
a.stat-card-link .label { color: var(--accent, #2563eb); }
.backlog-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); margin-bottom: var(--space-6); }
.backlog-section-title { font-size: var(--text-lg); font-weight: 600; margin: 0 0 var(--space-3); display: flex; align-items: center; gap: var(--space-2); }
.backlog-list { display: flex; flex-direction: column; gap: var(--space-2); }

/* Card grid — renders as dense list rows (Linear-style) */
.card-grid { display: flex; flex-direction: column; gap: 1px; margin: var(--space-6) 0;
  background: var(--border); border-radius: var(--radius); overflow: hidden; }
.card { background: var(--surface); border: none; border-radius: 0;
  padding: var(--space-3) var(--space-4); display: flex; align-items: center; gap: var(--space-4);
  box-shadow: none; transition: background 150ms; }
.card:hover { background: rgba(255,255,255,0.03); box-shadow: none; transform: none; }
.card h3 { margin: 0; font-size: var(--text-base); font-weight: 500; }
.card .meta { font-size: var(--text-xs); color: var(--text-muted); margin: 0; }
.card .card-footer { display: flex; align-items: center; gap: var(--space-2); margin-left: auto; margin-top: 0; padding-top: 0; flex-shrink: 0; }
.card .card-footer .view-link { font-size: var(--text-xs); font-weight: 500; }

/* Kanban */
.kanban { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin: var(--space-6) 0; align-items: start; }
.kanban-col { background: transparent; border: none; border-radius: 0;
  overflow: hidden; box-shadow: none; border-right: 1px solid var(--border); }
.kanban-col:last-child { border-right: none; }
.kanban-col .col-header { background: transparent; padding: var(--space-2) var(--space-4) var(--space-3); font-weight: 600;
  font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: var(--space-2); }
.col-count { font-size: var(--text-xs); font-weight: 500; color: var(--text-muted); opacity: 0.7; }
.kanban-col .col-body { padding: var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
.kanban-col.col-empty { opacity: 0.45; }
.kanban-col.col-empty .col-body { min-height: 3rem; }
.status-badge { font-size: var(--text-xs); padding: 0.125rem 0.5rem; border-radius: 9999px; font-weight: 500; margin-left: var(--space-2); }
.badge-in-progress { background: #1a2040; color: #818cf8; }
.badge-approved { background: #132b1a; color: #4ade80; }
.badge-archived { background: #1e2128; color: #8b8f96; }
.kanban-item { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-3);
  font-size: var(--text-base); transition: box-shadow var(--transition); border-left: 3px solid var(--border); }
.kanban-item.priority-critical { border-left-color: #dc2626; }
.kanban-item.priority-high { border-left-color: #f59e0b; }
.kanban-item.priority-medium { border-left-color: #3b82f6; }
.kanban-item.priority-low { border-left-color: #9ca3af; }
.kanban-item:hover { box-shadow: var(--shadow-sm); }
.kanban-item.done-item { opacity: 0.6; }
a.kanban-item { color: var(--text); text-decoration: none; display: block; cursor: pointer; }
.done-collapse { margin-top: 0.25rem; }
.done-toggle { background: none; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs); color: var(--text-muted); cursor: pointer; display: flex; align-items: center; gap: var(--space-2); width: 100%; }
.done-toggle:hover { background: var(--bg); }
.done-arrow { display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent;
  border-top: 5px solid var(--text-muted); transition: transform 0.15s; }
.done-arrow.open { transform: rotate(180deg); }
.done-items { display: flex; flex-direction: column; gap: var(--space-2); margin-top: var(--space-2); }
.kanban-id { font-size: var(--text-xs); font-weight: 600; color: var(--accent); white-space: nowrap; }
.kanban-sub-count { font-size: var(--text-xs); color: var(--text-muted); margin-left: 0.25rem; }
.kanban-parent { font-size: var(--text-xs); color: var(--accent, #2563eb); white-space: nowrap; cursor: pointer; }
.kanban-parent:hover { text-decoration: underline; }
.backlog-item-id { font-size: 0.75em; font-weight: 600; color: var(--accent); }
.issue-relations { margin-top: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--surface); border: 1px solid var(--border); border-radius: 0.5rem; }
.issue-relation { font-size: var(--text-base); margin-bottom: var(--space-2); }
.issue-relation:last-child { margin-bottom: 0; }
.relation-label { font-weight: 600; color: var(--text-muted); }
.issue-relation a { color: var(--accent); text-decoration: none; }
.issue-relation a:hover { text-decoration: underline; }
.issue-children { margin: var(--space-1) 0 0 var(--space-5); padding: 0; }
.issue-children li { margin-bottom: 0.125rem; }
.wireframe-embed { margin: var(--space-6) 0; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.wireframe-header { display: flex; align-items: center; justify-content: space-between; padding: var(--space-2) var(--space-4); background: var(--surface); border-bottom: 1px solid var(--border); }
.wireframe-label { font-size: var(--text-sm); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.wireframe-open { font-size: var(--text-xs); color: var(--accent); text-decoration: none; }
.wireframe-open:hover { text-decoration: underline; }
.wireframe-iframe { width: 100%; height: 500px; border: none; background: var(--surface); }
.kanban-item-ids { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); }
.kanban-item-title { font-weight: 500; }
.kanban-item-meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); flex-wrap: wrap; }
.kanban-label { font-size: var(--text-xs); padding: 0.0625rem 0.4rem; border-radius: 9999px; background: #1e2128; color: #8b8f96; }
.kanban-scope { font-size: var(--text-xs); padding: 0.0625rem 0.4rem; border-radius: 9999px; font-weight: 500; }
.scope-small { background: #132b1a; color: #4ade80; }
.scope-medium { background: #1a2040; color: #818cf8; }
.scope-large { background: #2e2810; color: #fbbf24; }
.backlog-legend { display: flex; gap: var(--space-4); margin-top: var(--space-2); }
.legend-item { display: flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); color: var(--text-muted); }
.legend-bar { width: 3px; height: 14px; border-radius: 2px; }
.legend-bar.priority-critical { background: #dc2626; }
.legend-bar.priority-high { background: #f59e0b; }
.legend-bar.priority-medium { background: #3b82f6; }
.legend-bar.priority-low { background: #9ca3af; }
.kanban-item a:hover { color: var(--accent); text-decoration: none; }
.kanban-view-all { display: block; text-align: center; padding: var(--space-2); font-size: var(--text-sm); color: var(--accent); text-decoration: none; border-top: 1px solid var(--border); margin-top: var(--space-1); }
.kanban-view-all:hover { text-decoration: underline; }
.col-count { font-size: var(--text-xs); font-weight: 400; color: var(--text-muted); }
.shipped-list { display: flex; flex-direction: column; gap: var(--space-2); }
.shipped-date { font-size: var(--text-xs); color: var(--text-muted); margin-left: auto; }

/* Tabs */
.tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: var(--space-6); }
.tab { padding: var(--space-3) var(--space-4); cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -2px; font-size: var(--text-sm); font-weight: 500; color: var(--text-muted);
  transition: color var(--transition), border-color var(--transition); user-select: none; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; animation: fadeIn 150ms ease-out; }

/* Badges */
.badge { display: inline-block; padding: 0.15em 0.5em; border-radius: 4px; font-size: var(--text-xs);
  font-weight: 600; background: #1e2128; color: var(--text-muted); vertical-align: middle;
  letter-spacing: 0.02em; }
.badge-ready { background: #132b1a; color: #4ade80; }
.badge-empty { background: #222630; color: #6b7280; }
.badge-fresh { background: #132b1a; color: #4ade80; }
.badge-aging { background: #2e2810; color: #fbbf24; }
.badge-stale { background: #2e1a1a; color: #f87171; }
.badge-origin-internal { background: #1a2040; color: #818cf8; }
.badge-origin-external { background: #222630; color: #8b8f96; }
.badge-origin-mixed { background: #2e2810; color: #fbbf24; }
.badge-evidence { background: #0d2530; color: #38bdf8; }
.badge-green { background: #132b1a; color: #4ade80; }

/* Transcript reader */
.transcript-reader p strong { color: var(--accent); }
.transcript-meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-2); font-size: var(--text-sm); color: var(--text-secondary); flex-wrap: wrap; }
.meta-label { font-weight: 600; }
.meta-sep { color: var(--border); }
.speaker-badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: var(--text-xs); font-weight: 600; text-transform: capitalize; }
.speaker-interviewer { background: var(--bg-secondary); color: var(--text-secondary); }
.speaker-customer { background: rgba(16, 185, 129, 0.1); color: #10b981; }
.speaker-unknown { background: rgba(245, 158, 11, 0.1); color: #f59e0b; }
.transcript-highlight { background: rgba(251, 191, 36, 0.25); padding: 0.1rem 0.2rem; border-radius: 2px; }

/* Content sections */
.content-section { margin-top: var(--space-8); }
.content-section h2 { margin-top: 0; }

/* Action hints */
.action-hint { font-size: var(--text-xs); color: var(--text-muted); margin-top: var(--space-1); }
.action-hint code { background: var(--accent-subtle); padding: 0.125em 0.375em; border-radius: 3px; font-size: var(--text-xs); color: var(--accent); }
.action-code { background: var(--accent-subtle); padding: 0.125em 0.375em; border-radius: 3px; font-size: var(--text-xs); color: var(--accent); white-space: nowrap; }
.col-hint { font-size: var(--text-xs); color: var(--text-muted); padding: 0 var(--space-4) var(--space-1); }
.col-hint code { background: var(--accent-subtle); padding: 0.1em 0.3em; border-radius: 3px; font-size: var(--text-xs); color: var(--accent); }
.kanban-item-hint { font-size: var(--text-xs); color: var(--text-muted); margin-top: var(--space-1); }
.canvas-tabs { display:flex; gap:var(--space-2); overflow-x:auto; padding:0 0 var(--space-4); scrollbar-width:none; }
.canvas-tabs::-webkit-scrollbar { display:none; }
.canvas-tab { display:flex; align-items:center; gap:var(--space-2); padding:var(--space-2) var(--space-3);
  background:var(--surface); border:1px solid var(--border); border-radius:999px;
  font-size:var(--text-sm); text-decoration:none; color:var(--text); white-space:nowrap; transition:border-color 150ms; }
.canvas-tab:hover { border-color:var(--accent); }
.canvas-tab-dot { width:6px; height:6px; border-radius:50%; background:var(--success); flex-shrink:0; animation:canvas-pulse 2s ease-in-out infinite; }
.canvas-tab-dot.idle { background:var(--warning); animation:none; }
@keyframes canvas-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@media (prefers-reduced-motion: reduce) { .canvas-tab-dot { animation:none; } }
.canvas-tab.completed { opacity:0.6; }
.canvas-tab-check { font-size:var(--text-xs); color:var(--text-muted); }
.canvas-tab-sep { color:var(--border); font-size:var(--text-xs); align-self:center; }
.canvas-tab-type { font-size:var(--text-xs); font-weight:600; text-transform:uppercase; color:var(--text-muted); }
.canvas-tab-label { font-weight:500; }
.pulse-score { text-align: center; margin: 0 0 var(--space-3); padding: var(--space-5) 0 var(--space-2); }
.pulse-arc { display: block; margin: 0 auto; }
.pulse-arc-text { font-size: var(--text-3xl); font-weight: 700; }
.pulse-arc-fg { animation: pulse-fill 600ms ease-out forwards; }
@keyframes pulse-fill { to { stroke-dashoffset: var(--pulse-target); } }
@media (prefers-reduced-motion: reduce) { .pulse-arc-fg { animation: none; stroke-dashoffset: var(--pulse-target); } }
.pulse-score-label { font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-2); }
.pulse-breakdown { max-height: 0; overflow: hidden; transition: max-height 200ms ease-out, opacity 200ms ease-out; opacity: 0; }
.pulse-breakdown.open { max-height: 12rem; opacity: 1; }
.pulse-dim-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-3); padding: var(--space-3) 0 var(--space-4); }
.pulse-dim-card { padding: var(--space-3); background: var(--surface); border: 1px solid var(--border); border-radius: 6px; text-align: left; }
.pulse-dim-name { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
.pulse-dim-score { font-size: var(--text-lg); font-weight: 700; margin: 0.125rem 0; }
.pulse-dim-bar { height: 4px; background: var(--border); border-radius: 2px; margin: var(--space-1) 0; }
.pulse-dim-fill { height: 100%; border-radius: 2px; transition: width 400ms ease-out; }
.pulse-dim-detail { font-size: var(--text-xs); color: var(--text-muted); }
@media (max-width: 600px) { .pulse-arc { width: 80px; height: 80px; } .pulse-arc-text { font-size: var(--text-2xl); } .pulse-dim-row { grid-template-columns: repeat(2, 1fr); } }
.suggested-next { margin-top: var(--space-6); padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5); border: none; border-left: 2px solid var(--accent);
  border-radius: 0; background: var(--surface); }
.suggested-next-label { font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: var(--space-2); }
.suggested-next code { background: var(--accent-subtle); padding: 0.15em 0.4em; border-radius: 3px; font-size: var(--text-sm); color: var(--accent); }

/* Empty states */
.empty-state { text-align: center; padding: var(--space-16) var(--space-8); color: var(--text-muted); }
.empty-state h2 { color: var(--text); margin-bottom: var(--space-2); }
.empty-state p { max-width: 420px; margin-left: auto; margin-right: auto; }
.empty-state code { background: var(--accent-subtle); padding: 0.2em 0.5em; border-radius: 4px;
  font-size: var(--text-sm); color: var(--accent); }
/* Empty-state CTA */
.empty-state-cta { text-align: center; padding: var(--space-16) var(--space-8); margin: var(--space-8) 0;
  background: var(--accent-subtle); border: 2px dashed var(--accent); border-radius: var(--radius); }
.empty-state-cta h2 { color: var(--text); margin-bottom: var(--space-3); font-size: var(--text-2xl); }
.empty-state-cta p { max-width: 480px; margin-left: auto; margin-right: auto; color: var(--text-muted); }
.empty-state-cta code { background: var(--accent); color: #fff; padding: 0.5em 1.25em;
  border-radius: var(--radius-sm); font-size: var(--text-lg); font-weight: 600;
  display: inline-block; margin-top: var(--space-3); }
/* Knowledge base reference (collapsible) */
.kb-reference { margin-top: var(--space-8); border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--surface); }
.kb-reference summary { padding: var(--space-4) var(--space-5); font-weight: 600; font-size: var(--text-base);
  cursor: pointer; user-select: none; color: var(--text); }
.kb-reference summary:hover { color: var(--accent); }
.kb-ref-body { padding: var(--space-2) var(--space-5) var(--space-4); }
.kb-ref-item { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) 0;
  font-size: var(--text-base); border-bottom: 1px solid var(--border); }
.kb-ref-item:last-child { border-bottom: none; }
.kb-ref-item a { font-weight: 500; min-width: 80px; }
.kb-ref-desc { color: var(--text-muted); font-size: var(--text-sm); margin-left: auto; }

/* Page header */
.page-header { margin-bottom: var(--space-8); }
.page-header .subtitle { color: var(--text-muted); margin-top: 0.125rem; font-size: var(--text-base); }
.page-header .breadcrumb { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: var(--space-2); }
.page-header .breadcrumb a { color: var(--text-muted); }
.page-header .breadcrumb a:hover { color: var(--accent); }
.topic-badges { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }

/* Markdown body — content pages */
.markdown-body { max-width: 820px; }
.markdown-body h1 { font-size: var(--text-2xl); margin: var(--space-8) 0 var(--space-3); }
.markdown-body h2 { font-size: var(--text-xl); margin: var(--space-8) 0 var(--space-3); }
.markdown-body h3 { font-size: var(--text-lg); margin: var(--space-5) 0 var(--space-2); }
.markdown-body p { line-height: 1.7; }
.markdown-body ul, .markdown-body ol { margin-left: var(--space-5); }
.markdown-body li { margin-bottom: var(--space-2); line-height: 1.6; }
.markdown-body table { font-size: var(--text-sm); }
.markdown-body table th { white-space: nowrap; }
.markdown-body strong { font-weight: 600; }

/* SWOT grid */
.swot-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); margin: var(--space-6) 0; }
.swot-box { border-radius: var(--radius); padding: var(--space-5); border: 1px solid var(--border); }
.swot-box h4 { font-size: var(--text-sm); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 var(--space-3); }
.swot-box ul { margin: 0; padding-left: var(--space-5); font-size: var(--text-base); }
.swot-box li { margin-bottom: var(--space-2); line-height: 1.5; }
.swot-strengths { background: #0d1f0d; border-color: #1a3a1a; }
.swot-strengths h4 { color: #4ade80; }
.swot-weaknesses { background: #1f0d0d; border-color: #3a1a1a; }
.swot-weaknesses h4 { color: #f87171; }
.swot-opportunities { background: #0d1520; border-color: #1a2540; }
.swot-opportunities h4 { color: #818cf8; }
.swot-threats { background: #1f1a0d; border-color: #3a3010; }
.swot-threats h4 { color: #fbbf24; }
@media (max-width: 700px) { .swot-grid { grid-template-columns: 1fr; } }

/* Scatter plot */
.scatter-container { position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: var(--space-10) var(--space-10) var(--space-10) var(--space-12); margin: var(--space-6) 0 var(--space-12) 0; aspect-ratio: 16/10; }
.scatter-area { position: relative; width: 100%; height: 100%; }
.scatter-dot { position: absolute; border-radius: 50%; background: var(--accent); opacity: 0.85;
  transform: translate(-50%, -50%); transition: opacity var(--transition), transform var(--transition); cursor: default; }
.scatter-dot:hover { opacity: 1; transform: translate(-50%, -50%) scale(1.15); z-index: 2; }
.scatter-dot.highlight { background: #044842; opacity: 1; }
.scatter-label { position: absolute; transform: translate(-50%, 0); font-size: var(--text-xs); font-weight: 600;
  white-space: nowrap; color: var(--text); text-align: center; pointer-events: none; }
.scatter-axis-x, .scatter-axis-y { position: absolute; font-size: var(--text-xs); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.scatter-axis-x { bottom: -1.75rem; left: 50%; transform: translateX(-50%); }
.scatter-axis-y { top: 50%; left: -2.5rem; transform: translateY(-50%) rotate(-90deg); }
.scatter-axis-label { position: absolute; font-size: var(--text-xs); color: var(--text-muted); }
.scatter-axis-label-left { left: 0; }
.scatter-axis-label-right { right: 0; }
.scatter-axis-label-top { top: 0; }
.scatter-axis-label-bottom { bottom: 0; }
.scatter-gridline { position: absolute; background: var(--border); }
.scatter-gridline-h { left: 0; right: 0; height: 1px; }
.scatter-gridline-v { top: 0; bottom: 0; width: 1px; }
.scatter-legend { display: flex; gap: var(--space-4); flex-wrap: wrap; margin-top: var(--space-3); font-size: var(--text-xs); color: var(--text-muted); }
.scatter-legend-item { display: flex; align-items: center; gap: var(--space-2); }
.scatter-legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }

/* Quadrant chart */
.quadrant-container { position: relative; background: var(--surface); border: 1px solid var(--border);
  border-radius: var(--radius); padding: var(--space-8); margin: var(--space-6) 0; }
.quadrant-grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
  gap: 2px; background: var(--border); aspect-ratio: 1.6/1; }
.quadrant-cell { background: var(--surface); padding: var(--space-4); position: relative; }
.quadrant-cell-label { position: absolute; top: var(--space-2); left: var(--space-3); font-size: var(--text-xs);
  font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); opacity: 0.7; }
.quadrant-item { display: inline-block; padding: 0.25em 0.625em; border-radius: 4px; font-size: var(--text-xs);
  font-weight: 500; margin: 0.25rem; cursor: default; }
.quadrant-items { display: flex; flex-wrap: wrap; gap: var(--space-1); margin-top: var(--space-6); }
.quadrant-q1 { background: #132b1a; color: #4ade80; }
.quadrant-q2 { background: #2e2810; color: #fbbf24; }
.quadrant-q3 { background: #1a2040; color: #818cf8; }
.quadrant-q4 { background: #222630; color: #8b8f96; }
.quadrant-axis-x { text-align: center; font-size: var(--text-xs); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; margin-top: var(--space-3); }
.quadrant-axis-y { position: absolute; top: 50%; left: -2rem; transform: translateY(-50%) rotate(-90deg);
  font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }

/* Heatmap */
.heatmap-table { width: 100%; border-collapse: collapse; margin: var(--space-6) 0; font-size: var(--text-sm); }
.heatmap-table th, .heatmap-table td { padding: var(--space-2) var(--space-3); border: 1px solid var(--border); text-align: center; }
.heatmap-table th { background: #1e2128; font-weight: 600; font-size: var(--text-xs); text-transform: uppercase;
  letter-spacing: 0.03em; color: var(--text-muted); }
.heatmap-table th:first-child, .heatmap-table td:first-child { text-align: left; font-weight: 500; }
.heatmap-pillar { background: var(--dark); color: #fff; font-weight: 700; font-size: var(--text-xs);
  text-transform: uppercase; letter-spacing: 0.05em; }
.heatmap-full { background: #132b1a; color: #4ade80; font-weight: 600; }
.heatmap-partial { background: #2e2810; color: #fbbf24; font-weight: 600; }
.heatmap-missing { background: #2e1a1a; color: #f87171; font-weight: 600; }
.heatmap-diff { background: #0d2520; color: #2dd4bf; font-weight: 700; }

/* Horizontal bar chart */
.bar-chart { margin: var(--space-6) 0; }
.bar-group { margin-bottom: var(--space-5); }
.bar-group-label { font-size: var(--text-base); font-weight: 600; margin-bottom: var(--space-2); }
.bar-row { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-2); }
.bar-row-label { font-size: var(--text-xs); color: var(--text-muted); width: 100px; flex-shrink: 0; text-align: right; }
.bar-track { flex: 1; height: 20px; background: #1e2128; border-radius: 4px; position: relative; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; display: flex; align-items: center; padding: 0 var(--space-2);
  font-size: var(--text-xs); font-weight: 600; color: #fff; min-width: fit-content; }
.bar-fill-green { background: #16a34a; }
.bar-fill-yellow { background: #eab308; }
.bar-fill-red { background: #dc2626; }
.bar-fill-blue { background: #2563eb; }
.bar-fill-teal { background: #044842; }
.bar-value { font-size: var(--text-xs); font-weight: 600; color: var(--text); min-width: 36px; }

/* Timeline */
.timeline-container { margin: var(--space-6) 0; padding: var(--space-6); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius); }
.timeline-track { display: flex; gap: 0; position: relative; }
.timeline-phase { flex: 1; padding: var(--space-4); border: 1px solid var(--border); position: relative; }
.timeline-phase:first-child { border-radius: var(--radius) 0 0 var(--radius); }
.timeline-phase:last-child { border-radius: 0 var(--radius) var(--radius) 0; }
.timeline-phase:not(:first-child) { border-left: none; }
.timeline-phase-name { font-size: var(--text-sm); font-weight: 700; margin-bottom: var(--space-2); }
.timeline-phase-focus { font-size: var(--text-xs); color: var(--text-muted); }
.timeline-phase-focus li { margin-bottom: 0.125rem; }
.timeline-phase.active { background: var(--accent-subtle); border-color: var(--accent); }
.timeline-phase.active .timeline-phase-name { color: var(--accent); }
.timeline-arrow { position: absolute; right: -0.5rem; top: 50%; transform: translateY(-50%);
  width: 0; height: 0; border-top: 8px solid transparent; border-bottom: 8px solid transparent;
  border-left: 8px solid var(--border); z-index: 1; }
.timeline-labels { display: flex; gap: 0; margin-top: var(--space-2); }
.timeline-label { flex: 1; text-align: center; font-size: var(--text-xs); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }

/* Coverage matrix */

/* Positioning map */
.positioning-map { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-6); margin: var(--space-6) 0; box-shadow: var(--shadow-sm); }
.positioning-map h3 { margin: 0 0 var(--space-4); font-size: var(--text-base); }
.positioning-map svg { display: block; margin: 0 auto; }
.positioning-map .map-legend { display: flex; flex-wrap: wrap; gap: var(--space-4); margin-top: var(--space-4);
  justify-content: center; font-size: var(--text-xs); color: var(--text-muted); }
.positioning-map .map-legend .legend-item { display: flex; align-items: center; gap: var(--space-2); }
.positioning-map .map-legend .legend-dot { width: 10px; height: 10px; border-radius: 50%; }
.positioning-map .map-axes { display: flex; justify-content: space-between; margin-top: var(--space-2);
  font-size: var(--text-xs); color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
.positioning-map .map-y-label { position: absolute; font-size: var(--text-xs); color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; }
.positioning-map .map-container { position: relative; }

/* Active session banners */
a.groom-session { text-decoration: none; display: flex; }
a.groom-session:hover { background: #1e2240; }
.groom-session { background: #1a1d28; border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-4) var(--space-5); margin-bottom: var(--space-2); display: flex; align-items: center; gap: var(--space-4);
  transition: background var(--transition); }
.groom-session-dot { width: 10px; height: 10px; border-radius: 50%;
  flex-shrink: 0; animation: pulse 2s ease-in-out infinite; }
.groom-session-topic { font-weight: 600; font-size: var(--text-base); color: var(--text); }
.groom-session-meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: 0.125rem; }
.groom-session-label { font-size: var(--text-xs); font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--text-muted); margin-bottom: var(--space-2); margin-top: var(--space-6); }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* Session hub page */
.session-status { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-4) var(--space-5); margin-bottom: var(--space-6); }
.session-status-row { margin-bottom: var(--space-2); font-size: var(--text-base); }
.session-status-row:last-child { margin-bottom: 0; }
.session-artifact { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-5); margin-bottom: var(--space-4); }
.session-artifact h3 { margin: 0 0 var(--space-3); font-size: var(--text-lg); }
.session-artifact a { color: var(--accent); text-decoration: none; }
.session-artifact a:hover { text-decoration: underline; }
.session-issue { padding: var(--space-2) 0; border-bottom: 1px solid var(--border); font-size: var(--text-base); }
.session-issue:last-child { border-bottom: none; }
.verdicts-table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.verdicts-table td { padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border); }
.back-link { color: var(--text-muted); text-decoration: none; font-size: var(--text-sm); }
.back-link:hover { color: var(--accent); }
.badge-groom { background: #1a2040; color: #818cf8; }
.badge-dev { background: #132b1a; color: #4ade80; }

/* KB sub-tabs */
.kb-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: var(--space-6); }
.nav-secondary { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin: 0 0 var(--space-6); overflow-x: auto; background: transparent; padding: 0; min-height: auto; }
.kb-tab { padding: var(--space-3) var(--space-4); font-size: var(--text-sm); font-weight: 500; color: var(--text-muted);
  text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -2px;
  transition: color var(--transition), border-color var(--transition); }
.kb-tab:hover { color: var(--text); }
.kb-tab.active { color: var(--accent); border-bottom-color: var(--accent); }

/* Proposal cards */
.proposal-card { position: relative; overflow: hidden; }
.card-gradient { display: none; }
.proposal-card h3 { margin-top: 0; }
.proposal-card h3 { margin: 0 0 var(--space-1); }
.proposal-id { font-size: var(--text-xs); font-weight: 600; color: var(--accent); margin-right: var(--space-2); }
.proposal-card.draft { border-style: dashed; border-color: #2a3545; cursor: default; opacity: 0.85; padding: var(--space-2) var(--space-4); }
.proposal-card.draft:hover { box-shadow: var(--shadow-sm); transform: none; }
.badge-draft { background: #1a2040; color: #818cf8; }
.proposals-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: var(--space-3); }
.proposals-header h2 { margin: 0; }
.proposals-view-all { font-size: var(--text-sm); color: var(--accent); text-decoration: none; }
.proposals-view-all:hover { text-decoration: underline; }

/* View toggle */
.view-toggle { display: flex; gap: 0; margin-bottom: var(--space-4); border: 1px solid var(--border);
  border-radius: 4px; overflow: hidden; width: fit-content; }
.toggle-btn { padding: var(--space-2) var(--space-3); font-size: var(--text-xs); font-weight: 500;
  color: var(--text-muted); background: var(--bg); text-decoration: none;
  border-right: 1px solid var(--border); }
.toggle-btn:last-child { border-right: none; }
.toggle-btn.active { background: var(--accent); color: #fff; }

/* Backlog proposal groups */
.proposal-group { margin-bottom: var(--space-6); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.group-header { display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4); background: var(--surface); border-bottom: 1px solid var(--border);
  text-decoration: none; color: var(--text); }
.group-header:hover { background: #222630; }
.group-gradient { width: 0.875rem; height: 0.875rem; border-radius: 999px; flex-shrink: 0; }
.group-title { font-weight: 600; font-size: var(--text-base); flex: 1; }
.group-count { font-size: var(--text-xs); color: var(--text-muted); }
.group-items { padding: var(--space-2); display: flex; flex-direction: column; gap: var(--space-2); }
.group-items .child-item { margin-left: var(--space-5); }
.standalone-header { background: #1e2128; cursor: default; }
.standalone-header:hover { background: #1e2128; }

.proposal-embed { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; margin-top: var(--space-4); }
.proposal-embed-header { display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-2) var(--space-4); background: var(--surface); border-bottom: 1px solid var(--border); }
.proposal-iframe { width: 100%; height: 800px; border: none; background: var(--surface); }

/* Animations */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}

/* ========== Responsive ========== */

/* Tablet (<=900px) */
@media (max-width: 900px) {
  .container { padding: var(--space-6) var(--space-4); }
  .kanban { grid-template-columns: 1fr; gap: 0; }
  .kanban-col { border-right: none; border-bottom: 1px solid var(--border); }
  .kanban-col:last-child { border-bottom: none; }
  .backlog-stats { grid-template-columns: repeat(2, 1fr); }
  .quadrant-grid { grid-template-columns: 1fr; grid-template-rows: auto; }
  .scatter-container { padding: var(--space-6) var(--space-4) var(--space-6) var(--space-8); }
  .timeline-track { flex-direction: column; }
  .timeline-phase:first-child { border-radius: var(--radius) var(--radius) 0 0; }
  .timeline-phase:last-child { border-radius: 0 0 var(--radius) var(--radius); }
  .timeline-phase:not(:first-child) { border-left: 1px solid var(--border); border-top: none; }
  .timeline-labels { flex-direction: column; }
  .bar-row-label { width: 80px; }
  .heatmap-table { font-size: var(--text-xs); }
  .heatmap-table th, .heatmap-table td { padding: var(--space-2) var(--space-2); }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .proposal-iframe { height: 500px; }
  .wireframe-iframe { height: 350px; }
}

/* Mobile (<=600px) */
@media (max-width: 600px) {
  .container { padding: var(--space-4) var(--space-3); }
  h1 { font-size: var(--text-xl); }
  h2 { font-size: var(--text-lg); }
  nav { flex-wrap: wrap; padding: 0 var(--space-3); min-height: auto; }
  nav .brand { padding: var(--space-3) 0; margin-right: auto; }
  nav a { padding: var(--space-2) var(--space-3); font-size: var(--text-xs); }
  .kb-tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; flex-wrap: nowrap; }
  .kb-tab { white-space: nowrap; flex-shrink: 0; }
  .kb-sub-tabs { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .kb-sub-tab { white-space: nowrap; flex-shrink: 0; }
  .backlog-stats { grid-template-columns: 1fr 1fr; }
  .stat-grid { grid-template-columns: 1fr 1fr; }
  .card-grid { gap: 1px; }
  .swot-grid { grid-template-columns: 1fr; }
  .scatter-container { aspect-ratio: auto; min-height: 280px; padding: var(--space-4) var(--space-3) var(--space-4) var(--space-6); }
  .scatter-axis-y { left: -1.5rem; }
  .scatter-label { font-size: 0.5625rem; }
  .groom-session { flex-direction: column; align-items: flex-start; gap: var(--space-2); padding: var(--space-3) var(--space-4); }
  .proposal-iframe { height: 400px; }
  .wireframe-iframe { height: 280px; }
  .empty-state { padding: var(--space-8) var(--space-4); }
  .empty-state-cta { padding: var(--space-8) var(--space-4); }
  .group-header { padding: var(--space-2) var(--space-3); }
  .proposals-header { flex-direction: column; gap: var(--space-1); }
  .view-toggle { width: 100%; }
  .toggle-btn { flex: 1; text-align: center; }
}

/* Small mobile (<=400px) */
@media (max-width: 400px) {
  .backlog-stats { grid-template-columns: 1fr; }
  .stat-grid { grid-template-columns: 1fr; }
  nav a { padding: var(--space-2) var(--space-2); font-size: var(--text-xs); }
  .stat-card .value { font-size: var(--text-2xl); }
}

/* Dark scrollbar */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #3a3f4a; }

/* Selection */
::selection { background: rgba(94,106,210,0.3); }

/* ========== Light theme overrides for hardcoded colors ========== */
[data-theme="light"] pre { background: #f0f2f5; color: #1e2128; }
[data-theme="light"] p code, [data-theme="light"] li code { background: #eef0f4; }
[data-theme="light"] th { background: #f0f2f5; }
[data-theme="light"] .heatmap-table th { background: #f0f2f5; }
[data-theme="light"] .bar-track { background: #eef0f4; }
[data-theme="light"] .badge { background: #eef0f4; }
[data-theme="light"] .badge-ready, [data-theme="light"] .badge-fresh { background: #dcfce7; color: #166534; }
[data-theme="light"] .badge-empty { background: #f3f4f6; color: #9ca3af; }
[data-theme="light"] .badge-aging { background: #fef3c7; color: #92400e; }
[data-theme="light"] .badge-stale { background: #fee2e2; color: #991b1b; }
[data-theme="light"] .badge-in-progress { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .badge-approved { background: #dcfce7; color: #15803d; }
[data-theme="light"] .badge-archived { background: #f1f5f9; color: #64748b; }
[data-theme="light"] .badge-origin-internal { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .badge-origin-external { background: #e5e7eb; color: #374151; }
[data-theme="light"] .badge-origin-mixed { background: #fef3c7; color: #92400e; }
[data-theme="light"] .badge-evidence { background: #e0f2fe; color: #0c4a6e; }
[data-theme="light"] .badge-green { background: #dcfce7; color: #166534; }
[data-theme="light"] .speaker-interviewer { background: #f1f5f9; color: #475569; }
[data-theme="light"] .speaker-customer { background: #dcfce7; color: #166534; }
[data-theme="light"] .speaker-unknown { background: #fef3c7; color: #92400e; }
[data-theme="light"] .transcript-highlight { background: rgba(251, 191, 36, 0.35); }
[data-theme="light"] .badge-groom { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .badge-dev { background: #dcfce7; color: #15803d; }
[data-theme="light"] .badge-draft { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .scope-small { background: #dcfce7; color: #15803d; }
[data-theme="light"] .scope-medium { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .scope-large { background: #fef3c7; color: #92400e; }
[data-theme="light"] .kanban-label { background: #f1f5f9; color: #475569; }
[data-theme="light"] .swot-strengths { background: #f0fdf4; border-color: #bbf7d0; }
[data-theme="light"] .swot-strengths h4 { color: #166534; }
[data-theme="light"] .swot-weaknesses { background: #fef2f2; border-color: #fecaca; }
[data-theme="light"] .swot-weaknesses h4 { color: #991b1b; }
[data-theme="light"] .swot-opportunities { background: #f5f3ff; border-color: #ddd6fe; }
[data-theme="light"] .swot-opportunities h4 { color: #5b21b6; }
[data-theme="light"] .swot-threats { background: #fffbeb; border-color: #fde68a; }
[data-theme="light"] .swot-threats h4 { color: #92400e; }
[data-theme="light"] .quadrant-q1 { background: #dcfce7; color: #166534; }
[data-theme="light"] .quadrant-q2 { background: #fef3c7; color: #92400e; }
[data-theme="light"] .quadrant-q3 { background: #ede9fe; color: #5b21b6; }
[data-theme="light"] .quadrant-q4 { background: #f3f4f6; color: #6b7280; }
[data-theme="light"] .heatmap-full { background: #dcfce7; color: #166534; }
[data-theme="light"] .heatmap-partial { background: #fef3c7; color: #92400e; }
[data-theme="light"] .heatmap-missing { background: #fee2e2; color: #991b1b; }
[data-theme="light"] .heatmap-diff { background: #ccfbf1; color: #044842; }
[data-theme="light"] a.groom-session:hover { background: #ede9fe; }
[data-theme="light"] .groom-session { background: #f8f9fb; border-color: var(--border); }
[data-theme="light"] .group-header:hover { background: #f0f2f5; }
[data-theme="light"] .standalone-header, [data-theme="light"] .standalone-header:hover { background: #f0f2f5; }
[data-theme="light"] .proposal-card.draft { border-color: #c4b5fd; }
[data-theme="light"] .card:hover { background: rgba(0,0,0,0.02); }
[data-theme="light"] .nav-item { color: var(--sidebar-text-muted); }
[data-theme="light"] .nav-item:hover { background: var(--sidebar-hover-bg); color: var(--sidebar-text-hover); }
[data-theme="light"] .nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-text); }
[data-theme="light"] .suggested-next { background: #f8f9fb; }
[data-theme="light"] ::-webkit-scrollbar-thumb { background: #d1d5db; }
[data-theme="light"] ::-webkit-scrollbar-thumb:hover { background: #9ca3af; }
[data-theme="light"] ::selection { background: rgba(94,106,210,0.2); }

/* Sidebar layout */
.app-layout { display: flex; min-height: 100vh; }
.sidebar { width: 220px; background: var(--sidebar-bg); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 10; }
.sidebar-brand { color: var(--sidebar-text); font-weight: 700; font-size: var(--text-base); padding: var(--space-5) var(--space-4) var(--space-4);
  letter-spacing: -0.02em; border-bottom: 1px solid var(--border); }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; padding: var(--space-3) var(--space-2); background: transparent; }
.nav-item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm); font-weight: 500; color: var(--sidebar-text-muted); border-radius: 6px;
  text-decoration: none; transition: background 150ms, color 150ms; }
.nav-item:hover { background: var(--sidebar-hover-bg); color: var(--sidebar-text-hover); text-decoration: none; }
.nav-item:focus-visible { box-shadow: 0 0 0 2px var(--accent); outline: none; }
.nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-text); }
.nav-item svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }
.nav-item.active svg { opacity: 1; }
.main-content { flex: 1; margin-left: 220px; min-height: 100vh; }

/* Theme toggle */
.sidebar-footer { margin-top: auto; padding: var(--space-3); border-top: 1px solid var(--border); }
.theme-toggle { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-3);
  font-size: var(--text-xs); font-weight: 500; color: var(--sidebar-text-muted); border-radius: 6px;
  background: none; border: none; cursor: pointer; width: 100%; transition: background 150ms, color 150ms; }
.theme-toggle:hover { background: var(--sidebar-hover-bg); color: var(--sidebar-text-hover); }
.theme-toggle svg { width: 16px; height: 16px; flex-shrink: 0; opacity: 0.7; }

@media (max-width: 768px) {
  .sidebar { position: static; width: 100%; height: auto; flex-direction: row; align-items: center;
    border-right: none; border-bottom: 1px solid var(--border); }
  .sidebar-brand { padding: var(--space-3) var(--space-4); border-bottom: none; }
  .sidebar nav { flex-direction: row; gap: 0; padding: 0; }
  .nav-item { padding: var(--space-3) var(--space-3); border-radius: 0; font-size: var(--text-xs); }
  .sidebar-footer { margin-top: 0; padding: var(--space-2); border-top: none; border-left: 1px solid var(--border); }
  .main-content { margin-left: 0; }
  .app-layout { flex-direction: column; }
}

/* Toast notifications */
.toast-container {
  position: fixed;
  bottom: var(--space-6);
  right: var(--space-6);
  z-index: 100;
  display: flex;
  flex-direction: column-reverse;
  gap: var(--space-2);
  pointer-events: none;
}
.toast {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-md);
  padding: var(--space-3) var(--space-4);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text);
  max-width: 320px;
  opacity: 0;
  transform: translateY(8px);
  animation: toast-in 300ms ease-out forwards;
  pointer-events: auto;
}
.toast-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
}
.toast-icon svg {
  width: 16px;
  height: 16px;
}
.toast.toast-out {
  animation: toast-out 200ms ease-in forwards;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(8px); }
}
@media (prefers-reduced-motion: reduce) {
  .toast {
    animation: none;
    opacity: 1;
    transform: none;
  }
  .toast.toast-out {
    animation: none;
    opacity: 0;
  }
}

`;

// ========== Dashboard HTML Shell ==========

function dashboardPage(title, activeNav, bodyContent, projectName, sidebarSlot) {
  projectName = projectName || _cachedProjectName || 'PM';
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/proposals', label: 'Proposals' },
    { href: '/kb?tab=research', label: 'Knowledge Base' },
    { href: '/backlog', label: 'Backlog' },
  ];
  const linksHtml = navLinks.map(l => {
    const active = l.label === 'Knowledge Base'
      ? (activeNav && (activeNav.startsWith('/kb') || activeNav.startsWith('/competitors/') || activeNav.startsWith('/research/') || activeNav === '/landscape'))
      : activeNav === l.href;
    return `<a href="${l.href}" class="nav-item${active ? ' active' : ''}">${l.label}</a>`;
  }).join('\n      ');

  let activeKbTab = '';
  if (activeNav && activeNav.startsWith('/kb?tab=')) {
    activeKbTab = activeNav.slice('/kb?tab='.length);
  } else if (activeNav && activeNav.startsWith('/competitors/')) {
    activeKbTab = 'competitors';
  } else if (activeNav && activeNav.startsWith('/research/')) {
    activeKbTab = 'research';
  } else if (activeNav === '/kb') {
    activeKbTab = 'research';
  }

  const secondaryLinks = [
    { href: '/kb?tab=strategy', label: 'Strategy', active: activeKbTab === 'strategy' },
    { href: '/kb?tab=research', label: 'Research', active: activeKbTab === 'research' || activeKbTab === 'topics' },
    { href: '/kb?tab=competitors', label: 'Competitors', active: activeKbTab === 'competitors' },
    { href: '/landscape', label: 'Landscape', active: activeKbTab === 'landscape' },
  ];
  const secondaryHtml = secondaryLinks.map(link =>
    `${link.active ? '<span class="active" hidden aria-hidden="true"></span>' : ''}<a href="${link.href}" class="kb-tab${link.active ? ' active' : ''}">${link.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)} - ${escHtml(projectName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${DASHBOARD_CSS}</style>
<script>
(function(){var t=localStorage.getItem('pm-theme');if(!t){t=window.matchMedia('(prefers-color-scheme:light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',t)})();
</script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
(function(){var t=document.documentElement.getAttribute('data-theme')||'dark';mermaid.initialize({startOnLoad:true,theme:t==='light'?'default':'dark',securityLevel:'loose'})})();
</script>
</head>
<body>
<div class="app-layout">
  <aside class="sidebar">
    <div class="sidebar-brand">${escHtml(projectName)}</div>
    <nav>
      ${linksHtml}
    </nav>
    <div class="sidebar-footer">
      <button class="theme-toggle" id="theme-toggle" title="Toggle theme">
        <svg id="theme-icon-sun" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.4 3.4l.7.7M11.9 11.9l.7.7M3.4 12.6l.7-.7M11.9 4.1l.7-.7"/></svg>
        <svg id="theme-icon-moon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:none"><path d="M13.5 8.5a5.5 5.5 0 01-7-7 5.5 5.5 0 107 7z"/></svg>
        <span id="theme-label">Light mode</span>
      </button>
    </div>
  </aside>
  <main class="main-content${sidebarSlot ? ' main-with-feed' : ''}">
    <div class="container">
      ${activeKbTab ? `<nav class="nav-secondary">${secondaryHtml}</nav>` : ''}
${bodyContent}
    </div>
${sidebarSlot || ''}
  </main>
  <div class="toast-container" id="toast-container" aria-live="polite" aria-atomic="false"></div>
</div>
<script>
(function() {
  var ws = new WebSocket('ws://' + location.host + '/ws');
  ws.onmessage = function(e) {
    try { var d = JSON.parse(e.data); if (d.type === 'reload') location.reload(); } catch(err) {}
  };
  // Theme toggle
  var btn = document.getElementById('theme-toggle');
  var sun = document.getElementById('theme-icon-sun');
  var moon = document.getElementById('theme-icon-moon');
  var label = document.getElementById('theme-label');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('pm-theme', t);
    sun.style.display = t === 'dark' ? '' : 'none';
    moon.style.display = t === 'light' ? '' : 'none';
    label.textContent = t === 'dark' ? 'Light mode' : 'Dark mode';
  }
  var cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur);
  btn.addEventListener('click', function() {
    applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  // ---- Toast Notifications (PM-092) ----
  // Static trusted SVG icons per milestone type (safe for innerHTML — not user input)
  var TOAST_ICONS = {
    tests_passed: '<svg viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
    pr_created: '<svg viewBox="0 0 16 16" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v8m0 0a2 2 0 104 0M12 14V6m0 0a2 2 0 10-4 0"/></svg>',
    review_done: '<svg viewBox="0 0 16 16" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><path d="M5.5 8.5l2 2 3.5-4"/></svg>',
    merged: '<svg viewBox="0 0 16 16" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2v4a4 4 0 004 4h4M8 10l4-4M8 10l4 4"/></svg>'
  };
  var TOAST_LABELS = {
    tests_passed: 'Tests passed',
    pr_created: 'PR created',
    review_done: 'Review done',
    merged: 'Merged'
  };

  var toastContainer = document.getElementById('toast-container');
  var activeToasts = [];
  var MAX_TOASTS = 3;

  function showToast(eventData) {
    if (!TOAST_ICONS[eventData.type]) return;
    var msg = (eventData.detail && eventData.detail.message) || TOAST_LABELS[eventData.type];
    var words = msg.split(/\\s+/).slice(0, 10);
    msg = words.join(' ');

    while (activeToasts.length >= MAX_TOASTS) {
      dismissToast(activeToasts[0]);
    }

    var el = document.createElement('div');
    el.className = 'toast';
    var iconSpan = document.createElement('span');
    iconSpan.className = 'toast-icon';
    // Safe: TOAST_ICONS values are static trusted SVG strings, keyed by validated type
    iconSpan.innerHTML = TOAST_ICONS[eventData.type];
    var textSpan = document.createElement('span');
    textSpan.textContent = msg;
    el.appendChild(iconSpan);
    el.appendChild(textSpan);
    toastContainer.appendChild(el);

    var duration = Math.min(Math.max(words.length * 500 + 1000, 3000), 5000);
    var entry = { el: el, timer: null };
    activeToasts.push(entry);
    entry.timer = setTimeout(function() { dismissToast(entry); }, duration);
  }

  function dismissToast(entry) {
    if (!entry || !entry.el) return;
    // Remove from active list immediately to prevent re-dismissal from queue loop
    activeToasts = activeToasts.filter(function(t) { return t !== entry; });
    clearTimeout(entry.timer);
    if (!entry.el.parentNode) return;
    entry.el.classList.add('toast-out');
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var removalDelay = reducedMotion ? 0 : 200;
    setTimeout(function() {
      if (entry.el.parentNode) entry.el.parentNode.removeChild(entry.el);
    }, removalDelay);
  }

  if (typeof EventSource !== 'undefined') {
    var evtSource = new EventSource('/events');
    evtSource.onmessage = function(e) {
      try {
        var data = JSON.parse(e.data);
        if (TOAST_ICONS[data.type]) {
          showToast(data);
        }
      } catch(err) {}
    };
  }
})();
</script>
<script>
(function() {
  var feedBody = document.getElementById('feed-body');
  if (!feedBody) return;

  var feedEmpty = document.getElementById('feed-empty');
  var statusDot = document.getElementById('feed-status-dot');
  var statusLabel = document.getElementById('feed-status-label');
  var RECENT_MS = 3 * 60 * 1000;

  function dotClass(type) {
    if (!type) return '';
    if (type.indexOf('fail') !== -1 || type.indexOf('error') !== -1 || type.indexOf('warn') !== -1) return 'warning';
    if (type.indexOf('test') !== -1 || type.indexOf('pass') !== -1 || type.indexOf('merge') !== -1) return 'success';
    if (type.indexOf('pr_') !== -1 || type.indexOf('push') !== -1 || type.indexOf('commit') !== -1) return 'info';
    return 'accent';
  }

  function relativeTime(ts) {
    var diff = Math.max(0, Date.now() - ts);
    if (diff < 5000) return 'just now';
    if (diff < 60000) return Math.floor(diff / 1000) + 's ago';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    return Math.floor(diff / 3600000) + 'h ago';
  }

  function isRecent(ts) {
    return (Date.now() - ts) < RECENT_MS;
  }

  function createEventEl(event) {
    var recent = isRecent(event.timestamp);
    var div = document.createElement('div');
    div.className = 'feed-event' + (recent ? '' : ' muted');
    div.setAttribute('data-event-id', event.id);
    div.setAttribute('data-timestamp', event.timestamp);

    var dot = document.createElement('div');
    dot.className = 'feed-event-dot ' + dotClass(event.type);
    div.appendChild(dot);

    var content = document.createElement('div');
    content.className = 'feed-event-content';

    var text = document.createElement('div');
    text.className = 'feed-event-text';
    var sourceSpan = document.createElement('span');
    sourceSpan.className = 'feed-event-source';
    sourceSpan.textContent = event.source;
    text.appendChild(sourceSpan);
    var desc = event.detail && event.detail.description ? event.detail.description : event.type.replace(/_/g, ' ');
    text.appendChild(document.createTextNode(' ' + desc));
    content.appendChild(text);

    var time = document.createElement('div');
    time.className = 'feed-event-time';
    time.textContent = relativeTime(event.timestamp);
    content.appendChild(time);

    div.appendChild(content);
    return div;
  }

  function refreshFade() {
    var events = feedBody.querySelectorAll('.feed-event');
    var sepInserted = false;
    var seps = feedBody.querySelectorAll('.feed-time-sep');
    for (var i = 0; i < seps.length; i++) seps[i].remove();

    for (var j = 0; j < events.length; j++) {
      var ts = parseInt(events[j].getAttribute('data-timestamp'), 10);
      var recent = isRecent(ts);
      if (recent) {
        events[j].classList.remove('muted');
      } else {
        events[j].classList.add('muted');
        if (!sepInserted) {
          var sep = document.createElement('div');
          sep.className = 'feed-time-sep';
          sep.textContent = 'Earlier';
          feedBody.insertBefore(sep, events[j]);
          sepInserted = true;
        }
      }
      var timeEl = events[j].querySelector('.feed-event-time');
      if (timeEl) timeEl.textContent = relativeTime(ts);
    }
  }

  function setConnected(connected) {
    if (connected) {
      statusDot.className = 'feed-status-dot live';
      statusLabel.textContent = 'Live';
    } else {
      statusDot.className = 'feed-status-dot idle';
      statusLabel.textContent = 'Idle';
    }
  }

  var lastEventId = null;

  function connect() {
    var es = new EventSource('/events');
    window.__pmEventSource = es;

    es.onopen = function() {
      setConnected(true);
    };

    es.onmessage = function(e) {
      var event;
      try { event = JSON.parse(e.data); } catch(err) { return; }

      lastEventId = e.lastEventId || event.id;

      if (feedBody.querySelector('[data-event-id="' + event.id + '"]')) return;

      if (feedEmpty) feedEmpty.style.display = 'none';

      var el = createEventEl(event);
      var firstChild = feedBody.querySelector('.feed-event, .feed-time-sep');
      if (firstChild) {
        feedBody.insertBefore(el, firstChild);
      } else {
        feedBody.appendChild(el);
      }

      refreshFade();
    };

    es.onerror = function() {
      setConnected(false);
    };
  }

  connect();
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
  const rawUrl = req.url;
  const url = rawUrl.split('?')[0];
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

  // Parse query params from the full URL (before ? stripping)
  const urlObj = new URL(rawUrl, 'http://localhost');
  const urlPath = urlObj.pathname;
  const tab = urlObj.searchParams.get('tab');
  const view = urlObj.searchParams.get('view');

  if (urlPath === '/') {
    handleDashboardHome(res, pmDir);
  } else if (urlPath === '/kb') {
    handleKnowledgeBasePage(res, pmDir, tab || 'research');
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
  } else if (urlPath === '/strategy-deck') {
    const deckPath = path.join(pmDir, 'strategy-deck.html');
    if (fs.existsSync(deckPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(deckPath, 'utf-8'));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(dashboardPage('Not Found', '/kb?tab=strategy', '<div class="empty-state"><p>No strategy deck found.</p><p>Run <code>/pm:strategy deck</code> to generate one.</p></div>'));
    }
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
  } else if (urlPath === '/backlog') {
    handleBacklog(res, pmDir, view);
  } else if (urlPath === '/backlog/shipped') {
    handleShipped(res, pmDir);
  } else if (urlPath === '/backlog/archived') {
    handleArchived(res, pmDir);
  } else if (urlPath.match(/^\/backlog\/wireframes\/.+\/raw$/)) {
    const slug = decodeURIComponent(urlPath.slice('/backlog/wireframes/'.length)).replace(/\/raw$/, '').replace(/\.html$/, '');
    // Serve raw wireframe HTML for iframe embedding
    const wfDir = path.resolve(pmDir, 'backlog', 'wireframes');
    const wfPath = path.resolve(wfDir, slug + '.html');
    if (wfPath.startsWith(wfDir + path.sep) && fs.existsSync(wfPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(wfPath, 'utf-8'));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/backlog/wireframes/')) {
    const slug = decodeURIComponent(urlPath.slice('/backlog/wireframes/'.length)).replace(/\/$/, '').replace(/\.html$/, '');
    handleWireframe(res, pmDir, slug);
  } else if (urlPath.startsWith('/backlog/')) {
    const slug = urlPath.slice('/backlog/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleBacklogItem(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/assets/')) {
    const assetName = decodeURIComponent(urlPath.slice('/assets/'.length)).replace(/\.\./g, '');
    const pluginAssetPath = path.join(__dirname, '..', 'assets', assetName);
    const projectAssetPath = path.resolve(pmDir, '..', 'assets', assetName);
    const assetPath = fs.existsSync(pluginAssetPath) ? pluginAssetPath : projectAssetPath;
    if (fs.existsSync(assetPath)) {
      const ext = path.extname(assetPath).toLowerCase();
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=86400' });
      res.end(fs.readFileSync(assetPath));
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/groom/')) {
    const slug = decodeURIComponent(urlPath.slice('/groom/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleGroomProgress(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.match(/^\/session\/[^/]+\/flows$/)) {
    const slug = decodeURIComponent(urlPath.split('/')[2]);
    if (slug && !slug.includes('..')) {
      const pmRoot = path.resolve(pmDir, '..', '.pm');
      const prefixes = ['groom-', 'dev-', ''];
      let served = false;
      for (const prefix of prefixes) {
        const flowsPath = path.join(pmRoot, 'sessions', prefix + slug, 'user-flows-draft.html');
        if (flowsPath.startsWith(path.join(pmRoot, 'sessions') + path.sep) && fs.existsSync(flowsPath)) {
          let flowHtml = fs.readFileSync(flowsPath, 'utf-8');
          // Inject back bar if not already present
          if (!flowHtml.includes('detail-back-bar')) {
            const backBar = detailBackBar(slug, pmDir, 'flows');
            flowHtml = flowHtml.includes('<body>') ? flowHtml.replace('<body>', '<body>' + backBar) : backBar + flowHtml;
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(flowHtml);
          served = true;
          break;
        }
      }
      if (!served) { res.writeHead(404); res.end('Not found'); }
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
  } else if (urlPath.startsWith('/transcripts/')) {
    const slug = decodeURIComponent(urlPath.slice('/transcripts/'.length)).replace(/\/$/, '');
    if (slug && !slug.includes('/') && !slug.includes('..')) {
      handleTranscriptPage(res, pmDir, slug, urlObj.searchParams.get('highlight') || '');
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath === '/proposals') {
    handleProposalsPage(res, pmDir);
  } else if (urlPath.match(/^\/proposals\/[^/]+\/wireframes\/.+$/)) {
    const parts = urlPath.split('/').filter(Boolean);
    const proposalSlug = decodeURIComponent(parts[1] || '');
    const wireframeSlug = decodeURIComponent(parts.slice(3).join('/')).replace(/\/$/, '').replace(/\.html$/, '');
    if (
      proposalSlug && wireframeSlug
      && !proposalSlug.includes('/') && !proposalSlug.includes('..')
      && !wireframeSlug.includes('/') && !wireframeSlug.includes('..')
    ) {
      handleWireframe(res, pmDir, wireframeSlug, {
        backHref: `/proposals/${encodeURIComponent(proposalSlug)}#wireframes`,
        backLabel: 'Back to proposal',
      });
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (urlPath.startsWith('/proposals/wireframes/')) {
    const slug = decodeURIComponent(urlPath.slice('/proposals/wireframes/'.length)).replace(/\/$/, '').replace(/\.html$/, '');
    handleWireframe(res, pmDir, slug);
  } else if (urlPath.startsWith('/proposals/')) {
    const remainder = urlPath.slice('/proposals/'.length).replace(/\/$/, '');
    const isRaw = remainder.endsWith('/raw');
    const rawSlug = isRaw ? remainder.slice(0, -'/raw'.length) : remainder;
    let slug;
    try { slug = decodeURIComponent(rawSlug); }
    catch { res.writeHead(400); res.end('Bad request'); return; }
    if (isRaw) {
      handleProposalDetailRaw(res, pmDir, slug);
    } else {
      handleProposalDetail(res, pmDir, slug);
    }
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

function computePulseScore(pmDir) {
  const dimensions = [];
  const now = new Date();
  const STALE_DAYS = 30;
  const STRATEGY_STALE_DAYS = 60;

  function daysSince(dateStr) {
    if (!dateStr) return Infinity;
    return Math.floor((now - new Date(dateStr)) / (1000 * 60 * 60 * 24));
  }

  // 1. Research freshness (0-25)
  const researchDir = path.join(pmDir, 'research');
  let researchScore = 0;
  let researchDetail = 'No research topics';
  if (fs.existsSync(researchDir)) {
    const topics = fs.readdirSync(researchDir, { withFileTypes: true }).filter(e => e.isDirectory());
    if (topics.length > 0) {
      const freshCount = topics.filter(t => {
        const d = getUpdatedDate(path.join(researchDir, t.name, 'findings.md'));
        return d && daysSince(d) < STALE_DAYS;
      }).length;
      researchScore = Math.round((freshCount / topics.length) * 25);
      researchDetail = `${freshCount} of ${topics.length} topics fresh`;
    }
  }
  dimensions.push({ name: 'Research', score: researchScore, max: 25, detail: researchDetail });

  // 2. Competitor freshness (0-25)
  const compDir = path.join(pmDir, 'competitors');
  let compScore = 0;
  let compDetail = 'No competitors profiled';
  if (fs.existsSync(compDir)) {
    const profiles = fs.readdirSync(compDir, { withFileTypes: true }).filter(e => e.isDirectory());
    if (profiles.length > 0) {
      const freshCount = profiles.filter(p => {
        const d = getUpdatedDate(path.join(compDir, p.name, 'profile.md'));
        return d && daysSince(d) < STALE_DAYS;
      }).length;
      compScore = Math.round((freshCount / profiles.length) * 25);
      compDetail = `${freshCount} of ${profiles.length} profiles fresh`;
    }
  }
  dimensions.push({ name: 'Competitors', score: compScore, max: 25, detail: compDetail });

  // 3. Backlog coverage (0-25)
  const backlogDir = path.join(pmDir, 'backlog');
  let backlogScore = 0;
  let backlogDetail = 'No backlog items';
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    let ideas = 0, shipped = 0;
    for (const f of files) {
      try {
        const raw = fs.readFileSync(path.join(backlogDir, f), 'utf-8');
        const { data } = parseFrontmatter(raw);
        if (data.status === 'idea' || data.status === 'drafted') ideas++;
        if (data.status === 'done') shipped++;
      } catch {}
    }
    backlogScore = Math.min(25, shipped * 5);
    if (shipped > 0 && ideas > shipped * 3) backlogScore = Math.max(0, backlogScore - 5);
    backlogDetail = `${shipped} shipped, ${ideas} ideas`;
  }
  dimensions.push({ name: 'Backlog', score: backlogScore, max: 25, detail: backlogDetail });

  // 4. Strategy presence (0-25)
  const strategyPath = path.join(pmDir, 'strategy.md');
  let strategyScore = 0;
  let strategyDetail = 'No strategy defined';
  if (fs.existsSync(strategyPath)) {
    const d = getUpdatedDate(strategyPath);
    const days = daysSince(d);
    if (days < STRATEGY_STALE_DAYS) {
      strategyScore = 25;
      strategyDetail = 'Strategy current';
    } else {
      strategyScore = 15;
      strategyDetail = `Strategy ${Math.floor(days / 30)}mo old`;
    }
  }
  dimensions.push({ name: 'Strategy', score: strategyScore, max: 25, detail: strategyDetail });

  const score = dimensions.reduce((sum, d) => sum + d.score, 0);
  return { score, dimensions };
}

function discoverCanvases(pmDir) {
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
  if (!fs.existsSync(sessionsDir)) return [];
  try {
    return fs.readdirSync(sessionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && fs.existsSync(path.join(sessionsDir, e.name, 'current.html')))
      .map(e => {
        const name = e.name;
        const dashIdx = name.indexOf('-');
        const type = dashIdx > 0 ? name.slice(0, dashIdx) : 'session';
        const slug = dashIdx > 0 ? name.slice(dashIdx + 1) : name;
        const htmlPath = path.join(sessionsDir, name, 'current.html');
        const mtime = fs.statSync(htmlPath).mtimeMs;
        const statePath = path.join(sessionsDir, name, '.state');
        let state = 'active';
        try { state = fs.readFileSync(statePath, 'utf-8').trim() || 'active'; } catch {}
        // Cross-reference groom/dev session state — if session is done, mark canvas completed
        if (state === 'active' && (type === 'groom' || type === 'dev')) {
          const sessionFile = path.resolve(pmDir, '..', '.pm', type + '-sessions', slug + '.md');
          try {
            const raw = fs.readFileSync(sessionFile, 'utf-8');
            const { data } = parseFrontmatter(raw);
            if (data.phase === 'done' || data.stage === 'done') state = 'completed';
          } catch {}
        }
        return { dirName: name, slug, type, label: humanizeSlug(slug), mtime, state };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

function archiveCompletedCanvases(pmDir) {
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;
  const rootDir = path.resolve(pmDir, '..');
  const ARCHIVE_MS = 24 * 60 * 60 * 1000;

  // Collect active session slugs to protect from archival
  const protectedSlugs = new Set();
  const groomDir = path.resolve(rootDir, '.pm', 'groom-sessions');
  const devDir = path.resolve(rootDir, '.pm', 'dev-sessions');
  for (const dir of [groomDir, devDir]) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.md'))) {
        protectedSlugs.add(f.replace('.md', ''));
      }
    } catch {}
  }

  try {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(sessionsDir, entry.name);
      const statePath = path.join(dirPath, '.state');
      if (!fs.existsSync(statePath)) continue;
      try {
        const state = fs.readFileSync(statePath, 'utf-8').trim();
        if (state !== 'completed') continue;
        const mtime = fs.statSync(statePath).mtimeMs;
        if (Date.now() - mtime < ARCHIVE_MS) continue;
        // Check if protected by active state file
        const dashIdx = entry.name.indexOf('-');
        const slug = dashIdx > 0 ? entry.name.slice(dashIdx + 1) : entry.name;
        if (protectedSlugs.has(slug) || protectedSlugs.has(entry.name)) continue;
        // Archive: remove directory
        fs.rmSync(dirPath, { recursive: true, force: true });
      } catch {}
    }
  } catch {}
}

function humanizeSlug(slug) {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ========== Progressive Proposal CSS (matches proposal-reference.html) ==========

const PROGRESSIVE_PROPOSAL_CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 16px; -webkit-font-smoothing: antialiased; scroll-behavior: smooth; scroll-padding-top: 3.5rem; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; background: #f8f9fa; line-height: 1.6; }

/* Progress bar */
.pp-progress { position: sticky; top: 0; z-index: 100; background: #f8f9fa; padding-bottom: 0.5rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.pp-bar { display: flex; gap: 3px; padding: 0.75rem 1.5rem 0; max-width: 960px; margin: 0 auto; }
.pp-seg { flex: 1; height: 5px; border-radius: 3px; background: #e5e7eb; transition: background 400ms ease; }
.pp-seg.done { background: #7c3aed; }
.pp-seg.current { background: #7c3aed; animation: pp-pulse 2s ease-in-out infinite; }
@keyframes pp-pulse { 0%,100%{opacity:.5} 50%{opacity:1} }
.pp-status { display: flex; justify-content: space-between; align-items: baseline; padding: 0.375rem 1.5rem 0; max-width: 960px; margin: 0 auto; font-size: 0.7rem; color: #999; }
.pp-phase { font-weight: 600; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.05em; }

/* Hero */
.hero { background: linear-gradient(135deg, #2e1065 0%, #7c3aed 50%, #8b5cf6 100%); color: #fff; padding: 3rem 1.5rem 2.5rem; position: relative; overflow: hidden; }
.hero::before { content: ''; position: absolute; top: -50%; right: -20%; width: 600px; height: 600px; background: radial-gradient(circle, rgba(255,255,255,0.06) 0%, transparent 70%); border-radius: 50%; }
.hero-inner { max-width: 960px; margin: 0 auto; position: relative; z-index: 1; }
.hero-eyebrow { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.7); margin-bottom: 0.5rem; }
.hero h1 { font-size: 2.25rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
.hero .subtitle { font-size: 1.1rem; color: rgba(255,255,255,0.85); max-width: 640px; margin-bottom: 1.5rem; }
.pp-placeholder-hero { opacity: 0.6; }

/* Metrics strip */
.metrics-strip { display: flex; gap: 0; background: rgba(255,255,255,0.1); border-radius: 10px; overflow: hidden; backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.15); }
.metric { flex: 1; padding: 0.75rem 1rem; text-align: center; border-right: 1px solid rgba(255,255,255,0.1); }
.metric:last-child { border-right: none; }
.metric-value { font-size: 1.4rem; font-weight: 800; display: block; line-height: 1.2; }
.metric-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; color: rgba(255,255,255,0.7); }

/* TOC */
.toc { background: #fff; border-bottom: 1px solid #e5e7eb; overflow-x: auto; }
.toc-inner { max-width: 960px; margin: 0 auto; display: flex; gap: 0; padding: 0 1rem; }
.toc a { display: block; padding: 0.6rem 0.75rem; font-size: 0.75rem; font-weight: 500; color: #777; text-decoration: none; white-space: nowrap; border-bottom: 2px solid transparent; transition: color 0.2s, border-color 0.2s; }
.toc a:hover { color: #7c3aed; border-bottom-color: #7c3aed; }

/* Layout */
.proposal { max-width: 960px; margin: 0 auto; padding: 2.5rem 1.5rem 4rem; }

/* Sections */
.section { margin-bottom: 3rem; opacity: 0; transform: translateY(16px); animation: fadeUp 0.5s ease forwards; }
.section:nth-child(1) { animation-delay: 0.05s; }
.section:nth-child(2) { animation-delay: 0.1s; }
.section:nth-child(3) { animation-delay: 0.15s; }
.section:nth-child(4) { animation-delay: 0.2s; }
.section:nth-child(5) { animation-delay: 0.25s; }
.section:nth-child(6) { animation-delay: 0.3s; }
.section:nth-child(7) { animation-delay: 0.35s; }
.section:nth-child(8) { animation-delay: 0.4s; }
.section:nth-child(9) { animation-delay: 0.45s; }
@keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }

.section-title { font-size: 1.25rem; font-weight: 700; color: #111; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e5e7eb; display: flex; align-items: center; gap: 0.5rem; }
.section-title .icon { width: 28px; height: 28px; border-radius: 6px; background: #f5f3ff; color: #7c3aed; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
.section-title .icon svg { width: 16px; height: 16px; }
.section p, .section li { font-size: 0.95rem; color: #444; }
.section-lead { font-weight: 600; color: #111; font-size: 1rem; margin-bottom: 0.75rem; }
.section ul, .section ol { padding-left: 1.25rem; margin-bottom: 0.75rem; }
.section li { margin-bottom: 0.35rem; }

/* Placeholder sections — greyed out, clearly inactive */
.pp-placeholder { margin-bottom: 0.5rem; pointer-events: none; }
.pp-placeholder .section-title { font-size: 0.875rem; font-weight: 500; color: #d1d5db; border-bottom: 1px dashed #e5e7eb; margin-bottom: 0; padding-bottom: 0.375rem; }
.pp-placeholder .section-title .icon { width: 20px; height: 20px; background: #f3f4f6; color: #d1d5db; }
.pp-placeholder .pp-hint { display: none; }

/* Callout */
.callout { background: linear-gradient(135deg, #f5f3ff 0%, #faf5ff 100%); border-left: 4px solid #7c3aed; border-radius: 0 8px 8px 0; padding: 1rem 1.25rem; margin: 1rem 0; font-size: 0.93rem; color: #5b21b6; }
.callout strong { color: #4c1d95; }

/* Scope */
.scope-grid { display: grid; grid-template-columns: 1fr; gap: 0.75rem; margin-bottom: 1rem; }
.scope-col { border-radius: 8px; padding: 1rem; }
.scope-grid { grid-template-columns: 1fr 1fr; }
.scope-col { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; }
.scope-col h4 { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; display: flex; align-items: center; gap: 0.3rem; }
.scope-col h4 svg { width: 12px; height: 12px; }
.scope-col ul { list-style: none; padding: 0; margin: 0; }
.scope-col li { font-size: 0.875rem; line-height: 1.5; padding: 0.35rem 0; border-bottom: 1px solid #f3f4f6; }
.scope-col li:last-child { border-bottom: none; }
.scope-col li strong { font-weight: 600; color: #111; }
.scope-col.in-scope h4 { color: #16a34a; }
.scope-col.in-scope li { color: #374151; }
.scope-col.out-scope h4 { color: #999; }
.scope-col.out-scope li { color: #6b7280; }
.filter-badge { display: inline-flex; align-items: center; gap: 0.35rem; background: linear-gradient(135deg, #7c3aed, #8b5cf6); color: #fff; font-size: 0.75rem; font-weight: 600; padding: 0.25rem 0.7rem; border-radius: 999px; vertical-align: middle; }
.scope-jobs { margin-bottom: 1.5rem; }
.scope-jobs-header { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin-bottom: 0.5rem; }
.scope-jobs-list { list-style: none; padding: 0; margin: 0; }
.scope-jobs-list li { padding: 0.4rem 0; border-bottom: 1px solid #f3f4f6; font-size: 0.9rem; color: #333; line-height: 1.5; }
.scope-jobs-list li:last-child { border-bottom: none; }
.scope-jobs-list .job-want { font-weight: 600; }
.scope-jobs-list .job-so { color: #888; }
.scope-review-details { margin-top: 1.25rem; border-top: 1px solid #f3f4f6; padding-top: 0.75rem; }
.scope-review-summary { font-size: 0.8rem; font-weight: 500; color: #999; cursor: pointer; display: flex; align-items: center; gap: 0.5rem; }
.scope-review-summary:hover { color: #666; }
.scope-review-body { padding-top: 0.75rem; }
.scope-review-section { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid #e5e7eb; }
.scope-review-header { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #bbb; margin-bottom: 0.75rem; }
.reviewer-row { display: flex; align-items: flex-start; gap: 0.625rem; padding: 0.5rem 0; border-bottom: 1px solid #f3f4f6; }
.reviewer-row:last-child { border-bottom: none; padding-bottom: 0; }
.reviewer-avatar { width: 40px; height: 40px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.reviewer-content { flex: 1; min-width: 0; }
.reviewer-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.125rem; }
.reviewer-header strong { font-size: 0.8rem; }
.reviewer-summary { font-size: 0.75rem; color: #888; line-height: 1.4; }

/* Issue cards */
.issue-group { margin-bottom: 1.5rem; }
.issue-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.25rem; margin-bottom: 0.75rem; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
.issue-card.parent { border-left: 4px solid #7c3aed; }
.issue-card.child { margin-left: 2rem; border-left: 4px solid #c4b5fd; }
.issue-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
.issue-id { font-size: 0.75rem; font-weight: 700; color: #fff; background: #7c3aed; padding: 0.1rem 0.5rem; border-radius: 4px; white-space: nowrap; }
.issue-title { font-size: 1rem; font-weight: 600; color: #111; }
.issue-outcome { font-size: 0.9rem; color: #555; margin-bottom: 0.75rem; font-style: italic; padding-left: 0.75rem; border-left: 2px solid #e5e7eb; }
details { margin-top: 0.5rem; }
summary { font-size: 0.85rem; font-weight: 600; color: #7c3aed; cursor: pointer; }
.issue-priority { font-size: 0.65rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: auto; }
.issue-priority-critical { background: #fef2f2; color: #991b1b; }
.issue-priority-high { background: #fff7ed; color: #9a3412; }
.issue-priority-medium { background: #fefce8; color: #854d0e; }
.issue-priority-low { background: #f0fdf4; color: #166534; }
.issue-label { font-size: 0.65rem; font-weight: 500; padding: 0.1rem 0.4rem; border-radius: 4px; background: #f3f4f6; color: #6b7280; margin-left: 0.25rem; }
.ac-list { font-size: 0.88rem; padding-left: 1.25rem; color: #555; margin-top: 0.5rem; }
.ac-list li { margin-bottom: 0.25rem; }
.ac-list li::marker { color: #7c3aed; }

/* Mermaid */
.mermaid-container { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1.5rem; margin-bottom: 1rem; overflow-x: auto; }
.mermaid { text-align: center; }

/* Wireframes */
.wireframe-embed { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; margin-bottom: 1rem; }
.wireframe-embed iframe { width: 100%; height: 520px; border: none; background: #f8f9fa; }
.wireframe-chrome { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
.wireframe-chrome-title { font-size: 0.75rem; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
.wireframe-chrome-open { font-size: 0.75rem; color: #7c3aed; text-decoration: none; font-weight: 500; }
.wireframe-chrome-open:hover { text-decoration: underline; }
.section-scroll { max-height: 700px; overflow-y: auto; }
.wireframe-link { font-size: 0.85rem; color: #7c3aed; text-decoration: none; font-weight: 500; }

/* Verdict badges */
.verdict-badge { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8rem; font-weight: 600; padding: 0.2rem 0.65rem; border-radius: 999px; }
.verdict-badge.ready { background: #dcfce7; color: #166534; }
.verdict-badge.caution { background: #fef3c7; color: #92400e; }
.verdict-badge.blocked { background: #fee2e2; color: #991b1b; }

/* Review cards */
.review-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }
.review-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 1rem; }
.review-card-header { display: flex; justify-content: space-between; align-items: center; }
.review-card-role { font-size: 0.85rem; font-weight: 600; color: #333; }

/* Advisory */
.advisory-card { background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 1rem 1.25rem; margin-top: 1rem; }
.advisory-card h3 { font-size: 0.8rem; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 0.5rem; }
.advisory-list { padding-left: 1.25rem; font-size: 0.88rem; color: #78350f; }
.advisory-list li { margin-bottom: 0.3rem; }

/* Responsive */
@media (max-width: 640px) {
  .hero h1 { font-size: 1.5rem; }
  .metrics-strip { flex-wrap: wrap; }
  .metric { min-width: 50%; }
  .scope-grid { grid-template-columns: 1fr; }
  .issue-card.child { margin-left: 1rem; }
  .review-cards { grid-template-columns: 1fr; }
}
@media print {
  body { background: #fff; }
  .hero { background: #7c3aed !important; -webkit-print-color-adjust: exact; }
  .toc, .pp-bar, .pp-status { display: none; }
  .proposal { max-width: 100%; padding: 1rem 0; }
  .section { opacity: 1 !important; transform: none !important; animation: none !important; }
  .pp-placeholder { display: none; }
}
`;

// ========== Progressive Proposal Handler ==========

const PP_ICONS = {
  // Lucide: lightbulb
  problem:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  // Lucide: compass
  strategy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/></svg>',
  // Lucide: search
  research: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/></svg>',
  // Lucide: crosshair
  scope:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" x2="18" y1="12" y2="12"/><line x1="6" x2="2" y1="12" y2="12"/><line x1="12" x2="12" y1="6" y2="2"/><line x1="12" x2="12" y1="22" y2="18"/></svg>',
  // Lucide: git-branch
  flows:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6a9 9 0 0 0-9 9V3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/></svg>',
  // Lucide: layout-dashboard
  wireframe:'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
  // Lucide: kanban (used as list for issues)
  issues:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v14"/><path d="M12 3v8"/><path d="M19 3v18"/></svg>',
  // Lucide: users
  review:   '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/></svg>',
  // Lucide: shield-check
  verdict:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>',
  // Lucide: triangle-alert
  warning:  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  // Lucide: check
  check:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  // Lucide: x
  cross:    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

const GROOM_PHASE_ORDER_PP = ['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'design', 'groom', 'team-review', 'bar-raiser', 'present'];

const TIER_PHASES_PP = {
  quick:    ['intake', 'scope', 'groom'],
  standard: ['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'design', 'groom'],
  full:     ['intake', 'strategy-check', 'research', 'scope', 'scope-review', 'design', 'groom', 'team-review', 'bar-raiser', 'present'],
};

function phaseIndex(phase) {
  const idx = GROOM_PHASE_ORDER_PP.indexOf(phase);
  return idx >= 0 ? idx : -1;
}

function isPhaseComplete(currentPhase, checkPhase) {
  const cur = phaseIndex(currentPhase);
  const chk = phaseIndex(checkPhase);
  if (cur < 0 || chk < 0) return false;
  return cur > chk;
}


function handleGroomProgress(res, pmDir, slug) {
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'groom-sessions');
  const sessionPath = path.join(sessionsDir, slug + '.md');

  if (!fs.existsSync(sessionPath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Not Found', '/proposals', `<div class="empty-state"><p>No grooming session found for "${escHtml(slug)}".</p><p><a href="/">&larr; Back to Home</a></p></div>`));
    return;
  }

  let session;
  try {
    const raw = fs.readFileSync(sessionPath, 'utf-8');
    const { data } = parseFrontmatter(raw);
    session = { ...data, _slug: slug };
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Error', '/', '<div class="empty-state"><p>Could not parse groom session state.</p></div>'));
    return;
  }

  const html = buildProgressiveProposalHtml(session, pmDir, slug);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function buildProgressiveProposalHtml(session, pmDir, slug) {
  const tier = session.tier || 'full';
  const phases = TIER_PHASES_PP[tier] || TIER_PHASES_PP.full;
  const currentPhase = session.phase || 'intake';
  const currentIdx = phases.indexOf(currentPhase);
  const topic = session.topic || 'Untitled Feature';
  const esc = escHtml;

  // Progress bar
  const progressSegs = phases.map((p, i) => {
    const cls = i < currentIdx ? 'done' : i === currentIdx ? 'current' : '';
    return `<div class="pp-seg ${cls}" title="${groomPhaseLabel(p)}"></div>`;
  }).join('');
  const progressHtml = `<div class="pp-progress"><div class="pp-bar">${progressSegs}</div>
<div class="pp-status"><span class="pp-phase">${esc(groomPhaseLabel(currentPhase))}</span><span>${Math.max(0,currentIdx)} of ${phases.length} phases</span></div></div>`;

  // Hero
  const hasHero = !!session.topic;
  const badges = [];
  if (session.priority) badges.push(esc(String(session.priority)));
  if (tier) badges.push(esc(tier) + ' groom');
  const issueCount = Array.isArray(session.issues) ? session.issues.length : 0;
  const scopeFilter = session.scope && session.scope.filter_result ? esc(String(session.scope.filter_result)) : '';
  const successMetric = session.success_metric || '';
  const metricsHtml = `<div class="metrics-strip">
  ${session.priority ? `<div class="metric"><span class="metric-value">${esc(String(session.priority))}</span><span class="metric-label">Priority</span></div>` : '<div class="metric"><span class="metric-value">—</span><span class="metric-label">Priority</span></div>'}
  ${scopeFilter ? `<div class="metric"><span class="metric-value">${scopeFilter}</span><span class="metric-label">Differentiator</span></div>` : '<div class="metric"><span class="metric-value">—</span><span class="metric-label">Differentiator</span></div>'}
  ${successMetric ? `<div class="metric"><span class="metric-value" style="font-size:0.85rem;">${esc(String(successMetric))}</span><span class="metric-label">Success Metric</span></div>` : '<div class="metric"><span class="metric-value">—</span><span class="metric-label">Success Metric</span></div>'}
</div>`;
  const heroHtml = hasHero
    ? `<header class="hero"><div class="hero-inner"><a href="/" style="font-size:0.85rem;color:rgba(255,255,255,0.7);text-decoration:none;display:inline-block;margin-bottom:0.5rem;">&larr; Back to dashboard</a><div class="hero-eyebrow">Feature Proposal &mdash; In Progress</div><h1>${esc(topic)}</h1>${metricsHtml}</div></header>`
    : `<header class="hero pp-placeholder-hero"><div class="hero-inner"><a href="/" style="font-size:0.85rem;color:rgba(255,255,255,0.7);text-decoration:none;display:inline-block;margin-bottom:0.5rem;">&larr; Back to dashboard</a><div class="hero-eyebrow">Feature Proposal</div><h1>Untitled Feature</h1><p class="subtitle">Waiting for intake...</p></div></header>`;

  // TOC — show all sections that exist for this tier (filled or placeholder)
  const sc = session.strategy_check;
  const hasFlowsJson = ['groom-', 'dev-', ''].some(fp => fs.existsSync(path.resolve(pmDir, '..', '.pm', 'sessions', fp + slug, 'flows.json')));
  const wfDirToc = path.resolve(pmDir, 'backlog', 'wireframes');
  const hasWireframes = (fs.existsSync(wfDirToc) && fs.readdirSync(wfDirToc).some(f => f.endsWith('.html') && f.includes(slug))) || (Array.isArray(session.wireframes) && session.wireframes.length > 0);

  const tocDefs = [
    { id: 'problem', label: 'Problem', show: true },
    { id: 'strategy', label: 'Strategy', show: phases.includes('strategy-check') },
    { id: 'research', label: 'Research', show: phases.includes('research') },
    { id: 'scope', label: 'Scope', show: phases.includes('scope') },
    { id: 'flows', label: 'Flows', show: phases.includes('groom') || phases.includes('design') },
    { id: 'wireframes', label: 'Wireframes', show: hasWireframes },
    { id: 'issues', label: 'Issues', show: phases.includes('groom') },
    { id: 'review', label: 'Review', show: phases.includes('team-review') },
    { id: 'verdict', label: 'Verdict', show: phases.includes('bar-raiser') },
  ];
  const tocItems = tocDefs.filter(t => t.show).map(t => {
    // Dim items that are still placeholders
    const filled = (t.id === 'problem' && session.outcome)
      || (t.id === 'strategy' && sc && sc.status)
      || (t.id === 'research' && session.research_location)
      || (t.id === 'scope' && session.scope && session.scope.in_scope)
      || (t.id === 'flows' && (hasFlowsJson || issueCount > 0))
      || (t.id === 'wireframes' && hasWireframes)
      || (t.id === 'issues' && issueCount > 0)
      || (t.id === 'review' && session.team_review && session.team_review.pm_verdict)
      || (t.id === 'verdict' && session.bar_raiser && session.bar_raiser.verdict);
    return `<a href="#${t.id}"${filled ? '' : ' style="opacity:0.4"'}>${t.label}</a>`;
  });
  const tocHtml = tocItems.length > 0 ? `<nav class="toc"><div class="toc-inner">${tocItems.join('')}</div></nav>` : '';

  // Sections
  let sections = '';

  // Problem Statement (intake output — full content here, not in hero)
  if (session.outcome) {
    let problemBody = `<p class="section-lead">${esc(String(session.outcome))}</p>`;
    if (session.trigger) problemBody += `<p><strong>Trigger:</strong> ${esc(String(session.trigger))}</p>`;
    if (session.codebase_context) problemBody += `<p><strong>Codebase:</strong> ${esc(String(session.codebase_context))}</p>`;
    sections += `<div class="section" id="problem"><div class="section-title"><span class="icon">${PP_ICONS.problem}</span> Problem Statement</div>${problemBody}</div>`;
  } else {
    sections += ppPlaceholder('problem', PP_ICONS.problem, 'Problem Statement', 'Pending intake');
  }

  // Strategy
  if (phases.includes('strategy-check')) {
    if (sc && sc.status) {
      const verdictCls = sc.status === 'passed' ? 'ready' : sc.status === 'failed' ? 'blocked' : 'caution';
      sections += `<div class="section" id="strategy"><div class="section-title"><span class="icon">${PP_ICONS.strategy}</span> Strategy Alignment <span class="verdict-badge ${verdictCls}" style="margin-left:auto;">${esc(sc.status)}</span></div>
  ${sc.supporting_priority ? `<p>Supports: <strong>${esc(String(sc.supporting_priority))}</strong></p>` : ''}
  ${sc.conflicts && sc.conflicts.length > 0 ? '<div class="callout"><strong>Conflicts:</strong><ul>' + sc.conflicts.map(c => `<li>${esc(String(c))}</li>`).join('') + '</ul></div>' : ''}
</div>`;
    } else if (isPhaseComplete(currentPhase, 'strategy-check')) {
      sections += `<div class="section" id="strategy"><div class="section-title"><span class="icon">${PP_ICONS.strategy}</span> Strategy Alignment <span class="verdict-badge caution" style="margin-left:auto;">skipped</span></div><p style="color:#999;">No strategy check performed.</p></div>`;
    } else {
      sections += ppPlaceholder('strategy', PP_ICONS.strategy, 'Strategy Alignment', 'Pending strategy check');
    }
  }

  // Research
  if (phases.includes('research')) {
    if (session.research_location) {
      const resDir = path.resolve(pmDir, '..', session.research_location);
      const findingsPath = path.join(resDir, 'findings.md');
      const resSlug = String(session.research_location).replace(/^pm\/research\//, '').replace(/\/$/, '');
      let resBody = '';
      let hasFindings = false;
      if (fs.existsSync(findingsPath)) {
        hasFindings = true;
        try {
          const raw = fs.readFileSync(findingsPath, 'utf-8');
          // Try summary first, then key findings
          const sumMatch = raw.match(/## Summary\n([\s\S]*?)(?=\n## |\n---)/i);
          if (sumMatch) {
            const sumText = sumMatch[1].trim().split('\n').filter(l => l.trim()).slice(0, 3).join(' ');
            if (sumText) resBody += `<p>${esc(sumText)}</p>`;
          }
          const fMatch = raw.match(/## (?:Key )?Findings\n([\s\S]*?)(?=\n## |\n---)/i);
          if (fMatch) {
            const bullets = fMatch[1].trim().split('\n').filter(l => l.trim().startsWith('-') || /^\d+\./.test(l.trim())).slice(0, 6);
            if (bullets.length > 0) resBody += '<ul>' + bullets.map(l => `<li>${esc(l.replace(/^[\s\-\d.]+/, ''))}</li>`).join('') + '</ul>';
          }
        } catch {}
      }
      if (hasFindings) {
        resBody += `<p style="margin-top:0.75rem;"><a href="/kb/research/${encodeURIComponent(resSlug)}" style="color:#7c3aed;font-weight:500;text-decoration:none;">View full research &rarr;</a></p>`;
        sections += `<div class="section" id="research"><div class="section-title"><span class="icon">${PP_ICONS.research}</span> Market &amp; Competitive</div>${resBody}</div>`;
      } else if (isPhaseComplete(currentPhase, 'research')) {
        sections += `<div class="section" id="research"><div class="section-title"><span class="icon">${PP_ICONS.research}</span> Market &amp; Competitive</div><p style="color:#999;">No research available.</p></div>`;
      } else {
        sections += ppPlaceholder('research', PP_ICONS.research, 'Market & Competitive', 'Pending research');
      }
    } else if (isPhaseComplete(currentPhase, 'research')) {
      sections += `<div class="section" id="research"><div class="section-title"><span class="icon">${PP_ICONS.research}</span> Market &amp; Competitive</div><p style="color:#999;">No research available.</p></div>`;
    } else {
      sections += ppPlaceholder('research', PP_ICONS.research, 'Market & Competitive', 'Pending research');
    }
  }

  // Scope
  if (phases.includes('scope')) {
    const scope = session.scope;
    if (scope && scope.in_scope) {
      const inItems = Array.isArray(scope.in_scope) ? scope.in_scope : [];
      const outItems = Array.isArray(scope.out_of_scope) ? scope.out_of_scope : [];
      const filterBadge = scope.filter_result ? `<span class="filter-badge">${esc(String(scope.filter_result))}</span>` : '';
      // Bold the noun phrase (before first : or --)
      const fmtScope = (s) => {
        const str = String(s);
        const sep = str.indexOf(':') > 0 ? ':' : str.indexOf(' -- ') > 0 ? ' -- ' : null;
        if (sep) {
          const idx = str.indexOf(sep);
          return `<strong>${esc(str.slice(0, idx))}</strong> <span style="color:#888;">${esc(str.slice(idx + sep.length).trim())}</span>`;
        }
        return esc(str);
      };
      const filterDescs = { '10x': 'Meaningfully better than alternatives', parity: 'Matching competitor capabilities', 'gap-fill': 'Filling a missing capability' };
      const fd = scope.filter_result ? (filterDescs[scope.filter_result] || '') : '';
      // Jobs-to-be-Done
      const jobs = Array.isArray(session.jobs) ? session.jobs : [];
      let scopeBody = '';
      if (jobs.length > 0) {
        scopeBody += '<div class="scope-jobs"><h4 class="scope-jobs-header">Jobs to be Done</h4><ul class="scope-jobs-list">';
        for (const job of jobs) {
          scopeBody += `<li><span class="job-want">${esc(String(job.want || ''))}</span> <span class="job-so">&mdash; ${esc(String(job.so || ''))}</span></li>`;
        }
        scopeBody += '</ul></div>';
      }

      // In/Out scope grid
      scopeBody += `<div class="scope-grid">
  <div class="scope-col in-scope"><h4>${PP_ICONS.check} Included</h4><ul>${inItems.map(i => `<li>${fmtScope(i)}</li>`).join('')}</ul></div>
  <div class="scope-col out-scope"><h4>${PP_ICONS.cross} Excluded</h4><ul>${outItems.map(i => `<li>${fmtScope(i)}</li>`).join('')}</ul></div>
</div>`;
      // Scope review verdicts — secondary info, collapsible
      const sr = session.scope_review;
      if (sr && sr.pm_verdict) {
        const srDesc = {
          pm: { 'ship-it': 'Ready to proceed', 'ship-if': 'Needs minor adjustments', 'rethink-scope': 'Needs significant rework', 'wrong-priority': 'Not the right priority' },
          competitive: { strengthens: 'Strengthens position', 'strengthens-if': 'Could strengthen with adjustments', neutral: 'No competitive impact', weakens: 'Could weaken position' },
          em: { feasible: 'Technically feasible', 'feasible-with-caveats': 'Feasible with constraints', 'needs-rearchitecting': 'Needs architectural changes' },
        };
        const addReviewer = (avatar, role, verdict, descs, summary) => {
          const v = String(verdict);
          const cls = /ship-it|strengthens|feasible/.test(v) ? 'ready' : /if|caveat/.test(v) ? 'caution' : 'blocked';
          const desc = summary || (descs && descs[v]) || v;
          return `<div class="reviewer-row"><img src="/assets/${avatar}" class="reviewer-avatar" alt="${esc(role)}"><div class="reviewer-content"><div class="reviewer-header"><strong>${esc(role)}</strong> <span class="verdict-badge ${cls}">${esc(v)}</span></div><div class="reviewer-summary">${esc(desc)}</div></div></div>`;
        };
        let reviewerHtml = '';
        if (sr.pm_verdict) reviewerHtml += addReviewer('reviewer-pm.png', 'Product Manager', sr.pm_verdict, srDesc.pm, sr.pm_summary);
        if (sr.competitive_verdict) reviewerHtml += addReviewer('reviewer-competitive.png', 'Competitive Strategist', sr.competitive_verdict, srDesc.competitive, sr.competitive_summary);
        if (sr.em_verdict) reviewerHtml += addReviewer('reviewer-engineering.png', 'Engineer', sr.em_verdict, srDesc.em, sr.em_summary);
        scopeBody += `<details class="scope-review-details" open><summary class="scope-review-summary">${filterBadge ? filterBadge + ' ' : ''}Scope Review — ${esc(String(sr.iterations || 1))} iteration${(sr.iterations || 1) > 1 ? 's' : ''}</summary><div class="scope-review-body">${reviewerHtml}</div></details>`;
      }
      sections += `<div class="section" id="scope"><div class="section-title"><span class="icon">${PP_ICONS.scope}</span> Scope Overview</div>${scopeBody}</div>`;
    } else {
      sections += ppPlaceholder('scope', PP_ICONS.scope, 'Scope Overview', 'Pending scoping');
    }
  }

  // Design phase check
  const designed = isPhaseComplete(currentPhase, 'design') || currentPhase === 'design' || currentPhase === 'groom' || currentPhase === 'team-review' || currentPhase === 'bar-raiser' || currentPhase === 'present' || currentPhase === 'link';

  // Flows
  const groomed = isPhaseComplete(currentPhase, 'groom') || currentPhase === 'groom' || currentPhase === 'team-review' || currentPhase === 'bar-raiser' || currentPhase === 'present' || currentPhase === 'link';
  if (phases.includes('design') || phases.includes('groom')) {
    // Check for flows.json and user-flows-draft.html in session directory
    const flowsPrefixes = ['groom-', 'dev-', ''];
    let flowsData = null;
    let hasFlowsDraft = false;
    for (const fp of flowsPrefixes) {
      const jsonPath = path.resolve(pmDir, '..', '.pm', 'sessions', fp + slug, 'flows.json');
      const htmlPath = path.resolve(pmDir, '..', '.pm', 'sessions', fp + slug, 'user-flows-draft.html');
      if (!flowsData && fs.existsSync(jsonPath)) {
        try { flowsData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')); } catch {}
      }
      if (!hasFlowsDraft && fs.existsSync(htmlPath)) hasFlowsDraft = true;
    }
    const flowsLink = hasFlowsDraft ? `<a href="/session/${encodeURIComponent(slug)}/flows" style="font-size:0.85rem;font-weight:500;color:#7c3aed;text-decoration:none;margin-left:auto;">View all flows &rarr;</a>` : '';

    if (flowsData && flowsData.length > 0) {
      // Render top 3 featured flows inline
      const featured = flowsData.filter(f => f.featured).slice(0, 3);
      let flowBody = '';
      for (let fi = 0; fi < featured.length; fi++) {
        const flow = featured[fi];
        flowBody += `<div style="margin-bottom:1.5rem;"><h4 style="font-size:0.85rem;font-weight:600;color:#333;margin-bottom:0.5rem;"><span style="display:inline-flex;align-items:center;justify-content:center;width:1.25rem;height:1.25rem;border-radius:50%;background:#7c3aed;color:#fff;font-size:0.65rem;font-weight:700;margin-right:0.4rem;">${fi + 1}</span>${esc(String(flow.title))}</h4>`;
        flowBody += `<p style="font-size:0.8rem;color:#888;margin-bottom:0.75rem;">${esc(String(flow.job))}</p>`;
        flowBody += `<div class="mermaid-container"><pre class="mermaid">${esc(String(flow.mermaid))}</pre></div>`;
        if (flow.edges && flow.edges.length > 0) {
          flowBody += '<ul style="margin-top:0.5rem;padding-left:1.25rem;">';
          for (const edge of flow.edges) flowBody += `<li style="font-size:0.8rem;color:#888;">${esc(String(edge))}</li>`;
          flowBody += '</ul>';
        }
        flowBody += '</div>';
      }
      sections += `<div class="section" id="flows"><div class="section-title"><span class="icon">${PP_ICONS.flows}</span> User Flows ${flowsLink}</div><div class="section-scroll">${flowBody}</div></div>`;
    } else if (designed && issueCount > 0) {
      let flowBody = '';
      const issues = session.issues || [];
      for (const iss of issues) {
        const issuePath = path.resolve(pmDir, 'backlog', (iss.slug || '') + '.md');
        if (!fs.existsSync(issuePath)) continue;
        try {
          const raw = fs.readFileSync(issuePath, 'utf-8');
          const mm = raw.match(/```mermaid\n([\s\S]*?)```/);
          if (mm) { flowBody += `<div class="mermaid-container"><pre class="mermaid">${esc(mm[1].trim())}</pre></div>`; break; }
        } catch {}
      }
      if (!flowBody) flowBody = '<p style="color:#999;">No user flow diagrams generated.</p>';
      sections += `<div class="section" id="flows"><div class="section-title"><span class="icon">${PP_ICONS.flows}</span> User Flows ${flowsLink}</div><div class="section-scroll">${flowBody}</div></div>`;
    } else {
      sections += ppPlaceholder('flows', PP_ICONS.flows, 'User Flows', 'Pending issue drafting');
    }

    // Wireframes — check issue slugs, session slug, and any wireframe referencing this topic
    {
      let wfBody = '';
      const wfDir = path.resolve(pmDir, 'backlog', 'wireframes');
      const wfSlugs = new Set();
      // Check issue-linked wireframes
      for (const iss of (session.issues || [])) {
        const s = iss.slug || '';
        if (s && fs.existsSync(path.join(wfDir, s + '.html'))) wfSlugs.add(s);
      }
      // Check session slug wireframe
      if (fs.existsSync(path.join(wfDir, slug + '.html'))) wfSlugs.add(slug);
      // Check wireframes listed in state file
      if (Array.isArray(session.wireframes)) {
        for (const wf of session.wireframes) {
          if (wf && fs.existsSync(path.join(wfDir, String(wf) + '.html'))) wfSlugs.add(String(wf));
        }
      }
      // Scan wireframes dir for any that include the slug in the filename
      if (fs.existsSync(wfDir)) {
        try {
          for (const f of fs.readdirSync(wfDir)) {
            if (f.endsWith('.html') && f.includes(slug)) wfSlugs.add(f.replace('.html', ''));
          }
        } catch {}
      }
      const wfSlugArr = Array.from(wfSlugs);
      for (const wfSlug of wfSlugArr) {
        // Extract title from wireframe HTML for the chrome header
        let wfTitle = wfSlug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        try {
          const wfHtml = fs.readFileSync(path.join(wfDir, wfSlug + '.html'), 'utf-8');
          const titleMatch = wfHtml.match(/<title>(?:Wireframe:\s*)?(.+?)<\/title>/i);
          if (titleMatch) wfTitle = titleMatch[1].trim();
        } catch {}
        wfBody += `<div class="wireframe-embed"><div class="wireframe-chrome"><span class="wireframe-chrome-title">${esc(wfTitle)}</span><a href="/backlog/wireframes/${encodeURIComponent(wfSlug)}" class="wireframe-chrome-open" target="_blank">Open in new tab &nearr;</a></div><iframe src="/backlog/wireframes/${encodeURIComponent(wfSlug)}/raw"></iframe></div>`;
      }
      if (wfBody) {
        sections += `<div class="section" id="wireframes"><div class="section-title"><span class="icon">${PP_ICONS.wireframe}</span> Wireframes</div><div class="section-scroll">${wfBody}</div></div>`;
      } else if (groomed || currentPhase === 'groom') {
        // Distinguish "deliberately empty" (wireframes: []) from "not yet generated" (wireframes undefined)
        const wfExplicitlyEmpty = session.wireframes === '[]' || (Array.isArray(session.wireframes) && session.wireframes.length === 0);
        if (wfExplicitlyEmpty) {
          sections += `<div class="section" id="wireframes"><div class="section-title"><span class="icon">${PP_ICONS.wireframe}</span> Wireframes <span class="verdict-badge caution" style="margin-left:auto;">skipped</span></div><p style="color:#999;">No wireframes needed — UI changes applied directly.</p></div>`;
        } else {
          sections += ppPlaceholder('wireframes', PP_ICONS.wireframe, 'Wireframes', 'Pending wireframe generation');
        }
      }
    }

    // Issues
    if (issueCount > 0) {
      // Read all issue data and determine parent/child relationships
      const issueData = [];
      for (const iss of (session.issues || [])) {
        const issuePath = path.resolve(pmDir, 'backlog', (iss.slug || '') + '.md');
        const entry = { slug: iss.slug || '', title: iss.title || iss.slug || '', outcome: '', id: '', parent: null, priority: '', labels: [], acItems: [] };
        if (fs.existsSync(issuePath)) {
          try {
            const raw = fs.readFileSync(issuePath, 'utf-8');
            const { data } = parseFrontmatter(raw);
            entry.outcome = data.outcome || '';
            entry.id = data.id || '';
            entry.parent = (data.parent && data.parent !== 'null') ? data.parent : null;
            entry.priority = data.priority || '';
            if (data.labels) {
              entry.labels = typeof data.labels === 'string' ? [data.labels] : (Array.isArray(data.labels) ? data.labels : []);
            }
            const acMatch = raw.match(/## Acceptance Criteria\n([\s\S]*?)(?=\n## )/);
            if (acMatch) {
              entry.acItems = acMatch[1].trim().split('\n').filter(l => /^\d+\./.test(l.trim())).map(i => i.replace(/^\d+\.\s*/, ''));
            }
          } catch {}
        }
        issueData.push(entry);
      }

      // Separate parents and children
      const parentSlugs = new Set(issueData.filter(i => !i.parent).map(i => i.slug));
      const renderCard = (entry, isChild) => {
        const cls = isChild ? 'child' : 'parent';
        const idBadge = entry.id ? `<span class="issue-id">${esc(String(entry.id))}</span>` : '';
        const priorityBadge = entry.priority ? `<span class="issue-priority issue-priority-${esc(entry.priority)}">${esc(entry.priority)}</span>` : '';
        const labelHtml = entry.labels.length > 0 ? entry.labels.map(l => `<span class="issue-label">${esc(String(l))}</span>`).join('') : '';
        const acList = entry.acItems.length > 0 ? `<details><summary>Acceptance Criteria (${entry.acItems.length})</summary><ol class="ac-list">${entry.acItems.map(i => `<li>${esc(i)}</li>`).join('')}</ol></details>` : '';
        return `<div class="issue-card ${cls}"><div class="issue-header">${idBadge}<span class="issue-title">${esc(String(entry.title))}</span>${priorityBadge}${labelHtml}</div>${entry.outcome ? `<div class="issue-outcome">${esc(String(entry.outcome))}</div>` : ''}${acList}</div>`;
      };

      let issBody = '';
      const parentCount = issueData.filter(i => !i.parent).length;
      const childCount = issueData.filter(i => i.parent).length;
      // Render parents first, then their children
      for (const parent of issueData.filter(i => !i.parent)) {
        issBody += renderCard(parent, false);
        for (const child of issueData.filter(i => i.parent === parent.slug)) {
          issBody += renderCard(child, true);
        }
      }
      // Render orphan children (parent not in this session) as parents
      for (const orphan of issueData.filter(i => i.parent && !parentSlugs.has(i.parent))) {
        issBody += renderCard(orphan, false);
      }

      const leadText = childCount > 0 ? `${parentCount} epic${parentCount !== 1 ? 's' : ''}, ${childCount} child issue${childCount !== 1 ? 's' : ''}.` : `${issueCount} issue${issueCount !== 1 ? 's' : ''} drafted.`;
      sections += `<div class="section" id="issues"><div class="section-title"><span class="icon">${PP_ICONS.issues}</span> Issue Breakdown</div><p class="section-lead">${leadText}</p><div class="issue-group">${issBody}</div></div>`;
    } else {
      sections += ppPlaceholder('issues', PP_ICONS.issues, 'Issue Breakdown', 'Pending issue drafting');
    }
  }

  // Team Review
  if (phases.includes('team-review')) {
    const tr = session.team_review;
    if (tr && tr.pm_verdict) {
      const addTeamReviewer = (avatar, role, verdict, summary) => {
        const v = String(verdict);
        const cls = /ready|ship|feasible|strengthens|complete|sharp/.test(v) ? 'ready' : /if|caveat/.test(v) ? 'caution' : 'blocked';
        const desc = summary || v;
        return `<div class="reviewer-row"><img src="/assets/${avatar}" class="reviewer-avatar" alt="${esc(role)}"><div class="reviewer-content"><div class="reviewer-header"><strong>${esc(role)}</strong> <span class="verdict-badge ${cls}">${esc(v)}</span></div><div class="reviewer-summary">${esc(desc)}</div></div></div>`;
      };
      let revBody = '';
      if (tr.pm_verdict) revBody += addTeamReviewer('reviewer-pm.png', 'Product Manager', tr.pm_verdict, tr.pm_summary);
      if (tr.competitive_verdict) revBody += addTeamReviewer('reviewer-competitive.png', 'Competitive Strategist', tr.competitive_verdict, tr.competitive_summary);
      if (tr.em_verdict) revBody += addTeamReviewer('reviewer-engineering.png', 'Engineering Manager', tr.em_verdict, tr.em_summary);
      if (tr.design_verdict && tr.design_verdict !== 'null') revBody += addTeamReviewer('reviewer-designer.png', 'UX Designer', tr.design_verdict, tr.design_summary);
      const iterLabel = (tr.iterations || 1) === 1 ? '1 iteration' : `${tr.iterations} iterations`;
      const fixLabel = (tr.blocking_issues_fixed || 0) > 0 ? `, ${tr.blocking_issues_fixed} blocking issue${tr.blocking_issues_fixed > 1 ? 's' : ''} fixed` : '';
      if (tr.conditions && tr.conditions.length > 0) {
        revBody += `<div class="advisory-card"><h3>${PP_ICONS.warning} Conditions</h3><ul class="advisory-list">` + tr.conditions.map(c => `<li>${esc(String(c))}</li>`).join('') + '</ul></div>';
      }
      sections += `<div class="section" id="review"><div class="section-title"><span class="icon">${PP_ICONS.review}</span> Review Summary</div><p class="section-lead">${iterLabel}${fixLabel}.</p>${revBody}</div>`;
    } else {
      sections += ppPlaceholder('review', PP_ICONS.review, 'Review Summary', 'Pending team review');
    }
  }

  // Bar Raiser / Verdict
  if (phases.includes('bar-raiser')) {
    const br = session.bar_raiser;
    if (br && br.verdict) {
      const vCls = br.verdict === 'ready' || br.verdict === 'ready-if' ? 'ready' : br.verdict === 'send-back' ? 'caution' : 'blocked';
      const vLabel = { ready: 'Ready to Build', 'ready-if': 'Ready (with conditions)', 'send-back': 'Sent Back', pause: 'Paused' };
      let vBody = `<p class="section-lead"><span class="verdict-badge ${vCls}" style="font-size:1rem;padding:0.4rem 1rem;">${esc(vLabel[br.verdict] || br.verdict)}</span></p>`;
      if (br.conditions && br.conditions.length > 0) {
        vBody += `<div class="advisory-card"><h3>${PP_ICONS.warning} Conditions</h3><ul class="advisory-list">` + br.conditions.map(c => `<li>${esc(String(c))}</li>`).join('') + '</ul></div>';
      }
      sections += `<div class="section" id="verdict"><div class="section-title"><span class="icon">${PP_ICONS.verdict}</span> Final Verdict</div>${vBody}</div>`;
    } else {
      sections += ppPlaceholder('verdict', PP_ICONS.verdict, 'Final Verdict', 'Pending bar raiser review');
    }
  }

  // WebSocket auto-reload script
  const wsScript = `<script>
(function(){try{var ws=new WebSocket('ws://'+location.host+'/ws');ws.onmessage=function(e){var d=JSON.parse(e.data);if(d.type==='reload')location.reload();};}catch(e){}})();
</script>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Proposal: ${esc(topic)}</title>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({ startOnLoad: true, theme: 'neutral' });</script>
<style>
${PROGRESSIVE_PROPOSAL_CSS}
</style>
</head>
<body>
${progressHtml}
${heroHtml}
${tocHtml}
<div class="proposal">
${sections}
</div>
${wsScript}
<script>
(function() {
  var sections = document.querySelectorAll('.proposal > .section');
  if (!sections.length) return;

  var progressBar = document.querySelector('.pp-progress');
  var barTop = progressBar ? progressBar.offsetHeight : 0;

  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:' + barTop + 'px;left:0;right:0;z-index:150;background:#f8f9fa;box-shadow:0 2px 8px rgba(0,0,0,0.06);display:none;';
  var inner = document.createElement('div');
  inner.style.cssText = 'max-width:960px;margin:0 auto;padding:0.5rem 1.5rem;display:flex;align-items:center;gap:0.5rem;font-size:1rem;font-weight:700;color:#111;';
  bar.appendChild(inner);
  document.body.appendChild(bar);

  function onScroll() {
    var active = null;
    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].getBoundingClientRect();
      var title = sections[i].querySelector('.section-title');
      if (!title) continue;
      var titleBottom = title.getBoundingClientRect().bottom;
      if (titleBottom < barTop && rect.bottom > barTop + 60) {
        active = { section: sections[i], title: title };
      }
    }
    if (active) {
      inner.textContent = '';
      var icon = active.title.querySelector('.icon');
      if (icon) inner.appendChild(icon.cloneNode(true));
      var spans = active.title.childNodes;
      for (var j = 0; j < spans.length; j++) {
        if (spans[j].nodeType === 3 && spans[j].textContent.trim()) {
          var t = document.createElement('span');
          t.textContent = spans[j].textContent.trim();
          inner.appendChild(t);
        }
      }
      var link = active.title.querySelector('a');
      if (link) {
        var a = document.createElement('a');
        a.href = link.href;
        a.textContent = link.textContent;
        a.style.cssText = 'font-size:0.85rem;font-weight:500;color:#7c3aed;text-decoration:none;margin-left:auto;';
        inner.appendChild(a);
      }
      bar.style.display = 'block';
    } else {
      bar.style.display = 'none';
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
</script>
</body>
</html>`;
}

function ppPlaceholder(id, icon, title, hint) {
  return `<div class="section pp-placeholder" id="${id}"><div class="section-title"><span class="icon">${icon}</span> ${escHtml(title)}</div><p class="pp-hint">${escHtml(hint)}</p></div>`;
}

function ppReviewCard(role, verdict) {
  const cls = /ready|ship|feasible|strengthens|complete|sharp/.test(String(verdict)) ? 'ready' : /caution|if|caveat/.test(String(verdict)) ? 'caution' : /rethink|needs|missing|wrong|gaps|weak|under/.test(String(verdict)) ? 'blocked' : 'caution';
  return `<div class="review-card"><div class="review-card-header"><span class="review-card-role">${escHtml(role)}</span><span class="verdict-badge ${cls}">${escHtml(String(verdict))}</span></div></div>`;
}

// ========== Proposal Metadata Helpers ==========

const PROPOSAL_GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
];

function proposalGradient(slug) {
  const input = String(slug || '');
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return PROPOSAL_GRADIENTS[Math.abs(hash) % PROPOSAL_GRADIENTS.length];
}

function sanitizeGradient(value) {
  const fallback = '#e5e7eb';
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (/[;]/.test(trimmed) || /url\s*\(/i.test(trimmed) || /javascript:/i.test(trimmed) || /expression\s*\(/i.test(trimmed)) {
    return fallback;
  }
  if (/^#(?:[0-9a-fA-F]{3,8})$/.test(trimmed)) return trimmed;
  if (/^linear-gradient\([#%,.\s0-9A-Za-z-]+\)$/.test(trimmed)) return trimmed;
  return fallback;
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

const GROOM_PHASE_LABELS = {
  'intake': 'Intake',
  'strategy-check': 'Strategy Check',
  'research': 'Research',
  'scope': 'Scope',
  'scope-review': 'Scope Review',
  'design': 'Design',
  'groom': 'Issue Drafting',
  'team-review': 'Team Review',
  'bar-raiser': 'Bar Raiser',
  'present': 'Presentation',
  'link': 'Linking Issues',
  'done': 'Done',
};

function groomPhaseLabel(phase) {
  if (!phase) return 'Unknown';
  return GROOM_PHASE_LABELS[phase] || humanizeSlug(phase);
}

function readGroomState(pmDir) {
  // Support both new multi-session directory and legacy single file
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'groom-sessions');
  const legacyPath = path.resolve(pmDir, '..', '.pm', '.groom-state.md');
  const sessions = [];

  // Read from groom-sessions/ directory (new format)
  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf-8');
        const { data } = parseFrontmatter(raw);
        if (typeof data.topic === 'string' && data.topic.trim() !== '') {
          if (data.phase === 'done') continue; // skip completed sessions
          sessions.push({ ...data, _slug: file.replace('.md', '') });
        }
      } catch {}
    }
  } catch {}

  // Fall back to legacy single file
  if (sessions.length === 0) {
    try {
      const raw = fs.readFileSync(legacyPath, 'utf-8');
      const { data } = parseFrontmatter(raw);
      if (typeof data.topic === 'string' && data.topic.trim() !== '') {
        sessions.push(data);
      }
    } catch {}
  }

  return sessions;
}

function readDevState(pmDir) {
  const sessionsDir = path.resolve(pmDir, '..', '.pm', 'dev-sessions');
  const sessions = [];

  try {
    const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), 'utf-8');
        const { data } = parseFrontmatter(raw);
        // Dev state files use a table format, not frontmatter — parse the table
        const stageMatch = raw.match(/\|\s*Stage\s*\|\s*(.+?)\s*\|/i);
        const sizeMatch = raw.match(/\|\s*Size\s*\|\s*(.+?)\s*\|/i);
        const ticketMatch = raw.match(/\|\s*Ticket\s*\|\s*(.+?)\s*\|/i);
        const branchMatch = raw.match(/\|\s*Branch\s*\|\s*(.+?)\s*\|/i);
        const slug = file.replace('.md', '');
        const stat = fs.statSync(path.join(sessionsDir, file));
        sessions.push({
          _slug: slug,
          _type: 'dev',
          _mtime: stat.mtimeMs,
          topic: data.topic || slug.replace(/-/g, ' '),
          stage: stageMatch ? stageMatch[1].trim() : (data.stage || ''),
          size: sizeMatch ? sizeMatch[1].trim() : (data.size || ''),
          ticket: ticketMatch ? ticketMatch[1].trim() : (data.ticket || ''),
          branch: branchMatch ? branchMatch[1].trim() : (data.branch || ''),
        });
      } catch {}
    }
  } catch {}

  return sessions;
}

function readAllActiveSessions(pmDir) {
  const groomSessions = readGroomState(pmDir).map(s => {
    const sessionsDir = path.resolve(pmDir, '..', '.pm', 'groom-sessions');
    let mtime = 0;
    try { mtime = fs.statSync(path.join(sessionsDir, (s._slug || '') + '.md')).mtimeMs; } catch {}
    return { ...s, _type: 'groom', _mtime: mtime };
  });
  const devSessions = readDevState(pmDir);
  const sessions = [...groomSessions, ...devSessions];

  // Check for active Claude Code session marker (touched by skill invocations)
  const markerPath = path.resolve(pmDir, '..', '.pm', 'active-session.md');
  try {
    const stat = fs.statSync(markerPath);
    sessions.push({ _slug: 'active', _type: 'session', _mtime: stat.mtimeMs, topic: 'Claude Code session' });
  } catch {}

  return sessions.sort((a, b) => (b._mtime || 0) - (a._mtime || 0));
}

function groomSessionDisplay(session) {
  const slug = session._slug ? escHtml(session._slug) : '';
  return {
    topic: escHtml(session.topic),
    phase: escHtml(groomPhaseLabel(session.phase || '')),
    started: escHtml(session.started || ''),
    slug,
    resumeHint: slug ? `/pm:groom ${slug}` : '/pm:groom',
  };
}

function devSessionDisplay(session) {
  const slug = session._slug ? escHtml(session._slug) : '';
  return {
    topic: escHtml(session.topic || slug.replace(/-/g, ' ')),
    stage: escHtml(session.stage || 'unknown'),
    size: escHtml(session.size || ''),
    ticket: escHtml(session.ticket || ''),
    branch: escHtml(session.branch || ''),
    slug,
  };
}

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);

function safePriority(value) {
  return VALID_PRIORITIES.has(value) ? value : 'medium';
}

function buildBacklogGrouped(pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const emptyHtml = '<div class="empty-state"><p>No backlog items yet. Run <code>/pm:groom &lt;feature idea&gt;</code> to start grooming.</p></div>';
  if (!fs.existsSync(backlogDir)) return emptyHtml;

  const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return emptyHtml;

  // Build items map
  const items = {};
  for (const file of files) {
    const slug = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
    const { data } = parseFrontmatter(raw);
    const itemStatus = data.status || 'idea';
    if (itemStatus === 'idea') continue; // ideas belong on Proposals page, not backlog
    const rawParent = data.parent || null;
    items[slug] = {
      slug, title: data.title || humanizeSlug(slug), status: itemStatus,
      id: data.id || null, parent: (rawParent === 'null' ? null : rawParent), priority: data.priority || 'medium',
      labels: Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [],
    };
  }

  // Build proposal set from meta.json files
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const proposalSlugs = new Set();
  if (fs.existsSync(proposalsDir)) {
    for (const f of fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'))) {
      proposalSlugs.add(f.replace('.meta.json', ''));
    }
    // Also discover HTML-only proposals (legacy, no sidecar)
    for (const f of fs.readdirSync(proposalsDir).filter(f => f.endsWith('.html'))) {
      proposalSlugs.add(f.replace('.html', ''));
    }
  }

  // Also treat any backlog item whose slug matches a proposal as a proposal parent
  // (the parent chain may reference the backlog item slug, not the proposal slug)

  // Group items by proposal ancestor
  // Also check for "dead proposals" — parent references a slug that isn't a backlog item
  // but also isn't in proposalSlugs. Treat the parent as a dead proposal group.
  const groups = {}; // proposalSlug → [items]
  const standalone = [];
  for (const slug of Object.keys(items)) {
    const ancestor = findProposalAncestor(slug, items, proposalSlugs);
    if (ancestor) {
      if (!groups[ancestor]) groups[ancestor] = [];
      groups[ancestor].push(items[slug]);
    } else {
      // No proposal ancestor found — check if the chain ends at a non-existent parent (dead proposal)
      let deadSlug = null;
      let walk = slug;
      const walkVisited = new Set();
      for (let d = 0; d < 10; d++) {
        if (walkVisited.has(walk)) break;
        walkVisited.add(walk);
        const w = items[walk];
        if (!w || !w.parent) break;
        if (!items[w.parent]) { deadSlug = w.parent; break; }
        walk = w.parent;
      }
      if (deadSlug) {
        if (!groups[deadSlug]) groups[deadSlug] = [];
        groups[deadSlug].push(items[slug]);
      } else {
        standalone.push(items[slug]);
      }
    }
  }

  // Render proposal groups — just name + link, skip fully-shipped proposals
  let html = '';

  for (const proposalSlug of Object.keys(groups)) {
    const groupItems = groups[proposalSlug];
    const meta = readProposalMeta(proposalSlug, pmDir);

    // Skip fully-shipped proposals — they belong on the Shipped page
    const allShipped = groupItems.every(i => i.status === 'done');
    if (allShipped) continue;

    // Status breakdown
    const activeCount = groupItems.filter(i => i.status !== 'done').length;
    const shippedCount = groupItems.filter(i => i.status === 'done').length;
    const countParts = [`${activeCount} active`];
    if (shippedCount > 0) countParts.push(`${shippedCount} shipped`);
    const countText = `${groupItems.length} issue${groupItems.length !== 1 ? 's' : ''} — ${countParts.join(', ')}`;

    if (meta) {
      const title = escHtml(meta.title || humanizeSlug(proposalSlug));
      const verdictBadge = meta.verdictLabel
        ? `<span class="badge badge-ready">${escHtml(String(meta.verdictLabel))}</span>`
        : '';
      const gradient = sanitizeGradient(meta.gradient || proposalGradient(proposalSlug));
      html += `<div class="proposal-group">
  <a href="/proposals/${escHtml(encodeURIComponent(proposalSlug))}" class="group-header">
    <div class="group-gradient" style="background:${escHtml(gradient)}"></div>
    <div class="group-title">${title}</div>
    ${verdictBadge}
    <div class="group-count">${escHtml(countText)}</div>
  </a>
</div>\n`;
    } else {
      // Dead proposal — no gradient, no link
      const title = escHtml(humanizeSlug(proposalSlug));
      html += `<div class="proposal-group">
  <div class="group-header standalone-header">
    <div class="group-title">${title}</div>
    <div class="group-count">${escHtml(countText)}</div>
  </div>
</div>\n`;
    }
  }

  // Standalone section
  if (standalone.length > 0) {
    const saActive = standalone.filter(i => i.status !== 'done');
    const saDone = standalone.filter(i => i.status === 'done');
    html += `<div class="proposal-group">
  <div class="group-header standalone-header">
    <div class="group-title">Standalone Issues</div>
    <div class="group-count">${standalone.length} issue${standalone.length !== 1 ? 's' : ''}</div>
  </div>
  <div class="group-items">`;
    for (const item of saActive) {
      const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
      const badgeHtml = item.status ? `<span class="status-badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>` : '';
      html += `<a class="kanban-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}${badgeHtml}<span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
    }
    if (saDone.length > 0) {
      html += `<div class="done-collapse">
  <button class="done-toggle" onclick="var el=document.getElementById('done-standalone');el.style.display=el.style.display==='none'?'flex':'none';this.querySelector('.done-arrow').classList.toggle('open')" type="button">
    <span class="done-arrow"></span> ${saDone.length} shipped
  </button>
  <div id="done-standalone" class="done-items" style="display:none">`;
      for (const item of saDone) {
        const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
        html += `<a class="kanban-item done-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">${idHtml}<span class="status-badge badge-done">shipped</span><span class="kanban-item-title">${escHtml(item.title)}</span></a>\n`;
      }
      html += '</div></div>';
    }
    html += '</div></div>\n';
  }

  return html;
}

function buildBacklogKanban(pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  if (!fs.existsSync(backlogDir)) {
    return '<div class="empty-state"><p>No backlog items yet. Run <code>/pm:groom &lt;feature idea&gt;</code> to start grooming.</p></div>';
  }

  // Build full items map to identify parent/child relationships
  const allItems = {};
  const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const slug = file.replace('.md', '');
    const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
    const { data } = parseFrontmatter(raw);
    const rawParent = data.parent || null;
    allItems[slug] = {
      slug,
      title: data.title || humanizeSlug(slug),
      status: data.status || 'idea',
      id: data.id || null,
      parent: (rawParent === 'null' ? null : rawParent),
      updated: data.updated || data.created || '',
      priority: safePriority(data.priority),
    };
  }

  // Collect child slugs — any item whose parent is another backlog item
  const childSlugs = new Set();
  for (const slug of Object.keys(allItems)) {
    const p = allItems[slug].parent;
    if (p && allItems[p]) childSlugs.add(slug);
  }

  // Parent issues only: not a child, not an idea
  const items = Object.values(allItems)
    .filter(i => i.status !== 'idea' && !childSlugs.has(i.slug));

  if (items.length === 0) {
    return '<div class="empty-state"><p>No backlog items yet. Run <code>/pm:groom &lt;feature idea&gt;</code> to start grooming.</p></div>';
  }

  // Count sub-issues per parent
  const subCount = {};
  for (const slug of childSlugs) {
    const p = allItems[slug].parent;
    if (p) subCount[p] = (subCount[p] || 0) + 1;
  }

  items.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const doneItems = items.filter(item => item.status === 'done');
  const inProgressItems = items.filter(item => item.status === 'in-progress');
  const openItems = items.filter(item => item.status !== 'done' && item.status !== 'in-progress' && item.status !== 'archived');

  const columns = [
    { key: 'open', label: 'Open', items: openItems },
    { key: 'in-progress', label: 'In Progress', items: inProgressItems },
    { key: 'done', label: 'Shipped', items: doneItems.slice(0, 10), total: doneItems.length },
  ];

  return `<div class="kanban">${columns.map(column => {
    const rows = column.items.map(item => {
      const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span>` : '';
      const badgeHtml = column.key === 'done'
        ? '<span class="status-badge badge-done">shipped</span>'
        : `<span class="status-badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>`;
      const subHtml = subCount[item.slug]
        ? `<span class="kanban-sub-count">${subCount[item.slug]} sub-issue${subCount[item.slug] !== 1 ? 's' : ''}</span>`
        : '';
      return `<a class="kanban-item${column.key === 'done' ? ' done-item' : ''} priority-${item.priority}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">
  <div class="kanban-item-ids">${idHtml}${badgeHtml}${subHtml}</div>
  <div class="kanban-item-title">${escHtml(item.title)}</div>
</a>`;
    }).join('\n');

    const viewAllHtml = column.key === 'done' && column.total > 10
      ? `<a href="/backlog/shipped" class="kanban-view-all">View all ${column.total} shipped</a>`
      : '';

    const count = column.total || column.items.length;
    return `<div class="kanban-col${column.items.length === 0 ? ' col-empty' : ''}">
  <div class="col-header">${column.label} <span class="col-count">${count}</span></div>
  <div class="col-body">
    ${rows || '<div class="empty-state"><p>No items</p></div>'}
    ${viewAllHtml}
  </div>
</div>`;
  }).join('')}</div>`;
}

function findProposalAncestor(slug, items, proposalSlugs) {
  let current = slug;
  const visited = new Set();
  for (let depth = 0; depth < 10; depth++) {
    if (proposalSlugs.has(current)) return current;
    if (visited.has(current)) return null;
    visited.add(current);
    const item = items[current];
    if (!item || !item.parent) return null;
    current = item.parent;
  }
  return null;
}

function buildProposalCards(pmDir, limit, preloadedSessions) {
  const entries = [];
  let shippedCount = 0;
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  if (fs.existsSync(proposalsDir)) {
    const files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.meta.json'));
    for (const file of files) {
      const slug = file.replace('.meta.json', '');
      const meta = readProposalMeta(slug, pmDir);
      if (!meta) continue;
      const verdict = (meta.verdict || '').toLowerCase();
      if (verdict === 'shipped') { shippedCount++; continue; }
      const title = typeof meta.title === 'string' && meta.title.trim() ? meta.title : humanizeSlug(slug);
      const stale = stalenessInfo(meta.date);
      const staleLabel = stale ? stale.label : '';
      const verdictHtml = meta.verdictLabel
        ? `<span class="badge badge-ready">${escHtml(String(meta.verdictLabel))}</span> `
        : '';
      const issueHtml = typeof meta.issueCount === 'number'
        ? `<span class="badge">${meta.issueCount} issue${meta.issueCount !== 1 ? 's' : ''}</span>`
        : '';
      const gradient = sanitizeGradient(meta.gradient || proposalGradient(slug));
      entries.push({
        date: meta.date || '0000-00-00',
        isDraft: false,
        html: `<a href="/proposals/${escHtml(encodeURIComponent(slug))}" class="card proposal-card">
  <div class="card-gradient" style="background:${escHtml(gradient)}"></div>
  <h3>${meta.id ? `<span class="proposal-id">${escHtml(meta.id)}</span>` : ''}${escHtml(title)}</h3>
  <p class="meta">${escHtml(staleLabel)}</p>
  <div class="card-footer"><div>${verdictHtml}${issueHtml}</div><span class="view-link">View →</span></div>
</a>`
      });
    }
  }
  // Scan for legacy HTML-only proposals (no .meta.json sidecar)
  if (fs.existsSync(proposalsDir)) {
    const metaSlugs = new Set(
      fs.readdirSync(proposalsDir)
        .filter(f => f.endsWith('.meta.json'))
        .map(f => f.replace('.meta.json', ''))
    );
    const htmlFiles = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.html'));
    for (const file of htmlFiles) {
      const slug = file.replace('.html', '');
      if (metaSlugs.has(slug)) continue; // already handled by meta.json path
      const title = humanizeSlug(slug);
      entries.push({
        date: '0000-00-00', // unknown date — sort to end
        isDraft: false,
        html: `<a href="/proposals/${escHtml(encodeURIComponent(slug))}" class="card proposal-card">
  <div class="card-gradient" style="background:${sanitizeGradient(null)}"></div>
  <h3>${escHtml(title)}</h3>
  <p class="meta">Legacy proposal</p>
  <div class="card-footer"><div></div><span class="view-link">View →</span></div>
</a>`
      });
    }
  }
  const groomSessions = preloadedSessions || readGroomState(pmDir);
  for (const session of groomSessions) {
    const d = groomSessionDisplay(session);
    entries.push({
      date: '9999-99-99',
      isDraft: true,
      html: `<div class="card proposal-card draft">
  <h3>${d.topic}</h3>
  <p class="meta">Grooming since ${d.started}</p>
  <div class="card-footer"><span class="badge badge-draft">Draft — ${d.phase}</span> <code class="action-code">${d.resumeHint}</code></div>
</div>`
    });
  }
  entries.sort((a, b) => b.date.localeCompare(a.date));
  const totalCount = entries.length;
  const limited = limit ? entries.slice(0, limit) : entries;
  const cardsHtml = limited.map(e => e.html).join('\n');
  return { cardsHtml, totalCount, shippedCount };
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

  const kbItems = [
    { href: '/kb?tab=research', label: 'Landscape', hasContent: !!stats.landscape, desc: stats.landscape ? 'Market landscape overview' : 'Run /pm:research landscape', key: 'research' },
    { href: '/kb?tab=competitors', label: 'Competitors', hasContent: stats.competitors > 0, desc: stats.competitors > 0 ? `${stats.competitors} competitor${stats.competitors !== 1 ? 's' : ''} profiled` : 'Run /pm:research competitors', key: 'research' },
    { href: '/kb?tab=strategy', label: 'Strategy', hasContent: !!stats.strategy, desc: 'Product strategy and roadmap', key: 'strategy' },
    { href: '/kb?tab=topics', label: 'Topics', hasContent: stats.research > 0, desc: stats.research > 0 ? `${stats.research} topic${stats.research !== 1 ? 's' : ''} researched` : 'Run /pm:research <topic>', key: 'research' },
    { href: '/backlog', label: 'Backlog', hasContent: stats.backlog > 0, desc: `${stats.backlog} item${stats.backlog !== 1 ? 's' : ''}`, key: 'backlog' },
  ].map(item => {
    const badge = item.hasContent
      ? '<span class="badge badge-ready">Ready</span>'
      : '<span class="badge badge-empty">Empty</span>';
    const stale = item.hasContent ? stalenessInfo(updatedDates[item.key]) : null;
    const staleBadge = stale
      ? ` <span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`
      : '';
    return `<div class="kb-ref-item">
    <a href="${item.href}">${item.label}</a> ${badge}${staleBadge}
    <span class="kb-ref-desc">${escHtml(item.desc)}</span>
  </div>`;
  }).join('\n');

  const kbReferenceHtml = `
<details class="kb-reference">
  <summary>Knowledge Base</summary>
  <div class="kb-ref-body">${kbItems}</div>
</details>`;

  let suggestedNext = '';
  let firstIdea = null;
  if (fs.existsSync(backlogDir)) {
    const ideaFiles = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of ideaFiles) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data: d } = parseFrontmatter(raw);
      if (d.status === 'idea') { firstIdea = file.replace('.md', ''); break; }
    }
  }
  if (firstIdea) {
    suggestedNext = `Run <code>/pm:groom ${escHtml(firstIdea)}</code> to scope your next idea`;
  } else if (!stats.strategy) {
    suggestedNext = 'Run <code>/pm:groom</code> to start grooming &mdash; it will help you set up strategy along the way';
  } else if (!stats.landscape) {
    suggestedNext = 'Run <code>/pm:research landscape</code> to map your market';
  } else if (stats.competitors === 0) {
    suggestedNext = 'Run <code>/pm:research competitors</code> to profile competitors';
  } else if (stats.backlog === 0) {
    suggestedNext = 'Run <code>/pm:groom ideate</code> to generate feature ideas from your knowledge base';
  } else {
    suggestedNext = 'Run <code>/pm:groom ideate</code> to discover new opportunities';
  }

  const suggestedHtml = `<div class="suggested-next">
  <div class="suggested-next-label">Suggested next</div>
  <div>${suggestedNext}</div>
</div>`;

  const projectName = getProjectName(pmDir);

  // Active sessions (groom + dev)
  // Groom sessions stay active until phase=done; dev sessions expire after 24h
  const groomSessions = readGroomState(pmDir);
  const staleMs = 60 * 60 * 1000;
  const allSessions = readAllActiveSessions(pmDir).filter(s => {
    if (s._type === 'groom') return true; // groom sessions are already filtered by phase!=done
    return s._mtime && (Date.now() - s._mtime) < staleMs;
  });
  let sessionBannerHtml = '';
  if (allSessions.length > 0) {
    const label = allSessions.every(s => s._type === 'groom')
      ? (allSessions.length === 1 ? 'Currently grooming' : `Currently grooming (${allSessions.length} sessions)`)
      : (allSessions.length === 1 ? 'Active Session' : `Active Sessions (${allSessions.length})`);
    const sessionItems = allSessions.map(s => {
      const slug = s._slug || '';
      const link = slug ? `/session/${encodeURIComponent(slug)}` : '#';
      if (s._type === 'groom') {
        const d = groomSessionDisplay(s);
        return `<a href="${link}" class="groom-session">
  <div class="groom-session-dot" style="background:#2563eb"></div>
  <div>
    <div class="groom-session-topic">${d.topic}</div>
    <div class="groom-session-meta">Grooming · Phase: ${d.phase} · Started ${d.started}</div>
  </div>
</a>`;
      } else {
        const d = devSessionDisplay(s);
        return `<a href="${link}" class="groom-session">
  <div class="groom-session-dot" style="background:#16a34a"></div>
  <div>
    <div class="groom-session-topic">${d.topic}</div>
    <div class="groom-session-meta">Dev · Stage: ${d.stage}${d.size ? ' · ' + d.size : ''}${d.branch ? ' · ' + d.branch : ''}</div>
  </div>
</a>`;
      }
    }).join('\n');
    sessionBannerHtml = `\n<div class="groom-session-label">${label}</div>\n${sessionItems}`;
  }

  // Proposal cards section — pass pre-loaded sessions to avoid redundant I/O
  let proposalsHtml = '';
  const { cardsHtml: proposalCards, totalCount: proposalCount } = buildProposalCards(pmDir, 6, groomSessions);
  if (proposalCount > 0) {
    proposalsHtml = `
<div class="content-section">
  <div class="proposals-header">
    <h2>Recent Proposals</h2>
    <a href="/proposals" class="proposals-view-all">View all proposals</a>
  </div>
  <div class="card-grid">${proposalCards}</div>
</div>`;
  }

  // Build stat cards for control tower
  const strategyStale = updatedDates.strategy ? stalenessInfo(updatedDates.strategy) : null;
  const strategyBadge = stats.strategy
    ? (strategyStale ? `<span class="badge badge-${strategyStale.level}">${escHtml(strategyStale.label)}</span>` : '<span class="badge badge-fresh">Current</span>')
    : '<span class="badge badge-empty">Not set</span>';

  const controlCards = `<div class="stat-grid">
  <a href="/backlog" class="stat-card stat-card-link">
    <div class="value">${stats.backlog}</div>
    <div class="label">Backlog Items</div>
  </a>
  <a href="/kb?tab=competitors" class="stat-card stat-card-link">
    <div class="value">${stats.competitors}</div>
    <div class="label">Competitors</div>
  </a>
  <a href="/kb?tab=research" class="stat-card stat-card-link">
    <div class="value">${stats.research}</div>
    <div class="label">Research Topics</div>
  </a>
  <div class="stat-card">
    <div class="value">${allSessions.length}</div>
    <div class="label">Active Sessions</div>
  </div>
</div>
<div style="text-align:center;margin:-0.5rem 0 1.5rem;">
  <span style="font-size:0.8125rem;color:var(--text-muted);">Strategy: ${strategyBadge}</span>
  ${researchHasContent ? `<span style="font-size:0.8125rem;color:var(--text-muted);margin-left:1rem;">Research: ${escHtml(researchDesc)}</span>` : ''}
</div>`;

  // Compute pulse score
  const pulse = computePulseScore(pmDir);
  const pulseColor = pulse.score >= 80 ? 'var(--success)' : pulse.score >= 50 ? 'var(--warning)' : '#ef4444';
  const pulseLabel = pulse.score >= 80 ? 'Healthy' : pulse.score >= 50 ? 'Needs attention' : 'At risk';
  // SVG arc: radius 54, circumference = 2 * PI * 54 ≈ 339.29
  const arcCircumference = 339.29;
  const arcOffset = arcCircumference - (pulse.score / 100) * arcCircumference;
  const breakdownCards = pulse.dimensions.map(d => {
    const pct = Math.round((d.score / d.max) * 100);
    return `<div class="pulse-dim-card">
      <div class="pulse-dim-name">${escHtml(d.name)}</div>
      <div class="pulse-dim-score">${d.score}/${d.max}</div>
      <div class="pulse-dim-bar"><div class="pulse-dim-fill" style="width:${pct}%;background:${pulseColor}"></div></div>
      <div class="pulse-dim-detail">${escHtml(d.detail)}</div>
    </div>`;
  }).join('\n');
  const pulseScoreHtml = stats.total > 0 ? `
<div class="pulse-score" onclick="document.getElementById('pulse-breakdown').classList.toggle('open');localStorage.setItem('pm-pulse-expanded',document.getElementById('pulse-breakdown').classList.contains('open'))" style="cursor:pointer" role="button" tabindex="0" aria-label="Project health score — click to see breakdown">
  <svg class="pulse-arc" width="120" height="120" viewBox="0 0 120 120">
    <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" stroke-width="8"/>
    <circle class="pulse-arc-fg" cx="60" cy="60" r="54" fill="none" stroke="${pulseColor}" stroke-width="8"
      stroke-linecap="round" stroke-dasharray="${arcCircumference}" stroke-dashoffset="${arcCircumference}"
      style="--pulse-target:${arcOffset}" transform="rotate(-90 60 60)"/>
    <text x="60" y="60" text-anchor="middle" dominant-baseline="central"
      class="pulse-arc-text" fill="${pulseColor}">${pulse.score}</text>
  </svg>
  <div class="pulse-score-label">Project Health &middot; <span style="color:${pulseColor}">${pulseLabel}</span></div>
</div>
<div class="pulse-breakdown" id="pulse-breakdown">
  <div class="pulse-dim-row">${breakdownCards}</div>
</div>
<script>if(localStorage.getItem('pm-pulse-expanded')==='true')document.getElementById('pulse-breakdown').classList.add('open');</script>` : '';

  // Discover active canvases (hide completed ones entirely)
  const canvases = discoverCanvases(pmDir).filter(c => c.state !== 'completed');
  const canvasTabsHtml = canvases.length > 0 ? `
<div class="canvas-tabs">
  ${canvases.map(c => {
    const dotClass = c.state === 'idle' ? 'canvas-tab-dot idle' : 'canvas-tab-dot';
    return `<a href="/session/${encodeURIComponent(c.slug)}" class="canvas-tab">
    <span class="${dotClass}"></span>
    <span class="canvas-tab-type">${escHtml(c.type)}</span>
    <span class="canvas-tab-label">${escHtml(c.label)}</span>
  </a>`;
  }).join('\n  ')}
</div>` : '';

  let body;
  if (proposalCount === 0 && allSessions.length === 0 && stats.total === 0) {
    // Empty state — prominent "Start Grooming" CTA
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Knowledge base overview</p>
</div>
<div class="empty-state-cta">
  <h2>Ready to build?</h2>
  <p>Start grooming your first feature to create a structured proposal with research, strategy alignment, and scoped issues.</p>
  <p><code>/pm:groom</code></p>
</div>
${suggestedHtml}`;
  } else {
    // Active state — control tower
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Knowledge base overview</p>
</div>
${pulseScoreHtml}
${canvasTabsHtml}
${controlCards}
${sessionBannerHtml}
${proposalsHtml}
${kbReferenceHtml}
${suggestedHtml}`;
  }

  const html = dashboardPage('Home', '/', body, projectName);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleSessionPage(res, pmDir, slug) {
  const projectName = getProjectName(pmDir);
  const rootDir = path.resolve(pmDir, '..');
  const pmRoot = path.resolve(rootDir, '.pm');

  // Check for current.html canvas override — scan all type prefixes
  // Skip canvas if the session state file is newer (canvas is stale)
  const sessionsDir = path.resolve(pmRoot, 'sessions');
  const canvasPrefixes = ['groom-', 'dev-', 'epic-', 'research-', ''];
  for (const prefix of canvasPrefixes) {
    const candidatePath = path.join(sessionsDir, prefix + slug, 'current.html');
    if (candidatePath.startsWith(sessionsDir + path.sep) && fs.existsSync(candidatePath)) {
      // Check if session state is newer than canvas — prefer dynamic page if so
      const canvasMtime = fs.statSync(candidatePath).mtimeMs;
      const groomStatePath = path.join(pmRoot, 'groom-sessions', slug + '.md');
      const devStatePath = path.join(pmRoot, 'dev-sessions', slug + '.md');
      const statePath = fs.existsSync(groomStatePath) ? groomStatePath : (fs.existsSync(devStatePath) ? devStatePath : null);
      if (statePath && fs.statSync(statePath).mtimeMs > canvasMtime) continue; // canvas is stale
      let html = fs.readFileSync(candidatePath, 'utf-8');
      // Inject SSE hot-reload script before </body> if not already present
      if (!html.includes('canvas-hot-reload')) {
        const reloadScript = `<script data-canvas-hot-reload>
(function(){var es=new EventSource('/events');var slug='${slug.replace(/'/g,"\\'")}';
es.onmessage=function(e){try{var d=JSON.parse(e.data);
if(d.type==='canvas_update'&&d.detail&&d.detail.indexOf(slug)!==-1)location.reload();
}catch(x){}};})();
</script>`;
        if (html.includes('</body>')) {
          html = html.replace('</body>', reloadScript + '</body>');
        } else {
          html += reloadScript;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
  }

  // Find the session — check groom first, then dev
  let sessionType = null;
  let sessionData = null;
  let sessionRaw = '';

  const groomPath = path.join(pmRoot, 'groom-sessions', slug + '.md');
  const devPath = path.join(pmRoot, 'dev-sessions', slug + '.md');

  if (fs.existsSync(groomPath)) {
    // Groom sessions render as progressive proposals
    return handleGroomProgress(res, pmDir, slug);
  } else if (fs.existsSync(devPath)) {
    sessionType = 'dev';
    sessionRaw = fs.readFileSync(devPath, 'utf-8');
    const { data } = parseFrontmatter(sessionRaw);
    sessionData = data;
  }

  if (!sessionType) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Session Not Found', '/', `
<div class="empty-state">
  <p>No session found for <code>${escHtml(slug)}</code>.</p>
  <p><a href="/">&larr; Back to Home</a></p>
</div>`, projectName));
    return;
  }

  const title = escHtml(sessionData.topic || slug.replace(/-/g, ' '));
  const typeBadge = sessionType === 'groom'
    ? '<span class="badge badge-groom">Grooming</span>'
    : '<span class="badge badge-dev">Development</span>';

  // Build artifact sections
  const sections = [];

  // --- Session status ---
  if (sessionType === 'groom') {
    const phase = groomPhaseLabel(sessionData.phase || '');
    const started = sessionData.started || '';
    sections.push(`<div class="session-status">
  <div class="session-status-row"><strong>Phase:</strong> ${escHtml(phase)}</div>
  <div class="session-status-row"><strong>Started:</strong> ${escHtml(started)}</div>
  <div class="session-status-row"><strong>Resume:</strong> <code>/pm:groom ${escHtml(slug)}</code></div>
</div>`);
  } else {
    const stageMatch = sessionRaw.match(/\|\s*Stage\s*\|\s*(.+?)\s*\|/i);
    const sizeMatch = sessionRaw.match(/\|\s*Size\s*\|\s*(.+?)\s*\|/i);
    const branchMatch = sessionRaw.match(/\|\s*Branch\s*\|\s*(.+?)\s*\|/i);
    const ticketMatch = sessionRaw.match(/\|\s*Ticket\s*\|\s*(.+?)\s*\|/i);
    sections.push(`<div class="session-status">
  <div class="session-status-row"><strong>Stage:</strong> ${escHtml(stageMatch ? stageMatch[1].trim() : 'unknown')}</div>
  <div class="session-status-row"><strong>Size:</strong> ${escHtml(sizeMatch ? sizeMatch[1].trim() : '')}</div>
  ${branchMatch ? `<div class="session-status-row"><strong>Branch:</strong> <code>${escHtml(branchMatch[1].trim())}</code></div>` : ''}
  ${ticketMatch ? `<div class="session-status-row"><strong>Ticket:</strong> ${escHtml(ticketMatch[1].trim())}</div>` : ''}
</div>`);
  }

  // --- Research findings ---
  const researchLocation = sessionData.research_location;
  if (researchLocation) {
    const findingsPath = path.join(rootDir, researchLocation, 'findings.md');
    if (fs.existsSync(findingsPath)) {
      const raw = fs.readFileSync(findingsPath, 'utf-8');
      const { body } = parseFrontmatter(raw);
      const summaryMatch = body.match(/## Summary\s*\n([\s\S]*?)(?=\n##|\n$)/);
      const summary = summaryMatch ? renderMarkdown(summaryMatch[1].trim()) : '<em>No summary</em>';
      const topicSlug = researchLocation.replace(/.*\//, '');
      sections.push(`<div class="session-artifact">
  <h3>Research</h3>
  ${summary}
  <a href="/research/${encodeURIComponent(topicSlug)}">View full findings &rarr;</a>
</div>`);
    }
  }

  // --- Wireframes ---
  const wireframesDir = path.join(pmDir, 'backlog', 'wireframes');
  if (fs.existsSync(wireframesDir)) {
    const wfFiles = fs.readdirSync(wireframesDir).filter(f => f.endsWith('.html') && f.includes(slug));
    if (wfFiles.length > 0) {
      const wfLinks = wfFiles.map(f => {
        const wfSlug = f.replace('.html', '');
        return `<a href="/backlog/wireframes/${encodeURIComponent(wfSlug)}">${escHtml(wfSlug)}</a>`;
      }).join(', ');
      sections.push(`<div class="session-artifact">
  <h3>Wireframes</h3>
  <p>${wfLinks}</p>
</div>`);
    }
  }

  // --- Proposal ---
  const proposalPath = path.join(pmDir, 'backlog', 'proposals', slug + '.html');
  if (fs.existsSync(proposalPath)) {
    sections.push(`<div class="session-artifact">
  <h3>Proposal</h3>
  <a href="/proposals/${encodeURIComponent(slug)}">View proposal &rarr;</a>
</div>`);
  }

  // --- Backlog issues ---
  const backlogDir = path.join(pmDir, 'backlog');
  if (fs.existsSync(backlogDir)) {
    const issueFiles = fs.readdirSync(backlogDir)
      .filter(f => f.endsWith('.md'))
      .filter(f => {
        const raw = fs.readFileSync(path.join(backlogDir, f), 'utf-8');
        const { data } = parseFrontmatter(raw);
        return data.parent === slug || f.replace('.md', '') === slug;
      });
    if (issueFiles.length > 0) {
      const issueLinks = issueFiles.map(f => {
        const iSlug = f.replace('.md', '');
        const raw = fs.readFileSync(path.join(backlogDir, f), 'utf-8');
        const { data } = parseFrontmatter(raw);
        const statusBadge = `<span class="badge badge-${data.status || 'idea'}">${escHtml(data.status || 'idea')}</span>`;
        return `<div class="session-issue"><a href="/backlog/${encodeURIComponent(iSlug)}">${escHtml(data.title || iSlug)}</a> ${statusBadge}</div>`;
      }).join('\n');
      sections.push(`<div class="session-artifact">
  <h3>Issues (${issueFiles.length})</h3>
  ${issueLinks}
</div>`);
    }
  }

  // --- Review verdicts (from groom state) ---
  if (sessionType === 'groom') {
    const verdicts = [];
    if (sessionData.scope_review) {
      const sr = sessionData.scope_review;
      verdicts.push(`<tr><td>Scope Review</td><td>PM: ${escHtml(sr.pm_verdict || '—')}</td><td>Competitive: ${escHtml(sr.competitive_verdict || '—')}</td><td>EM: ${escHtml(sr.em_verdict || '—')}</td></tr>`);
    }
    if (sessionData.team_review) {
      const tr = sessionData.team_review;
      verdicts.push(`<tr><td>Team Review</td><td>PM: ${escHtml(tr.pm_verdict || '—')}</td><td>Competitive: ${escHtml(tr.competitive_verdict || '—')}</td><td>EM: ${escHtml(tr.em_verdict || '—')}</td></tr>`);
    }
    if (sessionData.bar_raiser) {
      const br = sessionData.bar_raiser;
      verdicts.push(`<tr><td>Bar Raiser</td><td colspan="3">${escHtml(br.verdict || '—')}</td></tr>`);
    }
    if (verdicts.length > 0) {
      sections.push(`<div class="session-artifact">
  <h3>Review Verdicts</h3>
  <table class="verdicts-table"><tbody>${verdicts.join('\n')}</tbody></table>
</div>`);
    }
  }

  // --- Dev review/CI status (from dev state raw text) ---
  if (sessionType === 'dev') {
    const reviewMatch = sessionRaw.match(/Review gate:\s*(.+)/i);
    const ciMatch = sessionRaw.match(/Gate 1 \(CI\):\s*(.+)/i);
    const prMatch = sessionRaw.match(/PR:\s*(#\d+.+)/i);
    const statusItems = [];
    if (reviewMatch) statusItems.push(`<div class="session-status-row"><strong>Review:</strong> ${escHtml(reviewMatch[1].trim())}</div>`);
    if (prMatch) statusItems.push(`<div class="session-status-row"><strong>PR:</strong> ${escHtml(prMatch[1].trim())}</div>`);
    if (ciMatch) statusItems.push(`<div class="session-status-row"><strong>CI:</strong> ${escHtml(ciMatch[1].trim())}</div>`);
    if (statusItems.length > 0) {
      sections.push(`<div class="session-artifact">
  <h3>Ship Status</h3>
  ${statusItems.join('\n')}
</div>`);
    }
  }

  const body = `
<div class="page-header">
  <div><a href="/" class="back-link">&larr; Home</a></div>
  <h1>${title} ${typeBadge}</h1>
</div>
${sections.join('\n')}`;

  const html = dashboardPage(`Session: ${sessionData.topic || slug}`, '/session/' + slug, body, projectName);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleProposalDetailRaw(res, pmDir, slug) {
  if (!slug || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    res.writeHead(404); res.end('Not found');
    return;
  }
  const proposalsDir = path.resolve(pmDir, 'backlog', 'proposals');
  const htmlPath = path.resolve(proposalsDir, slug + '.html');
  if (!htmlPath.startsWith(proposalsDir + path.sep)) {
    res.writeHead(404); res.end('Not found');
    return;
  }
  try {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "frame-ancestors 'self'",
    });
    res.end(html);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
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
  const encodedSlug = encodeURIComponent(slug);
  const title = humanizeSlug(slug);
  const body = `
<div class="page-header">
  <p class="breadcrumb"><a href="/proposals">&larr; Back to Proposals</a></p>
  <h1>${escHtml(title)}</h1>
</div>
<div class="proposal-embed">
  <div class="proposal-embed-header">
    <span class="wireframe-label">PROPOSAL</span>
    <a href="/proposals/${encodedSlug}/raw" target="_blank" class="wireframe-open">Open standalone &nearr;</a>
  </div>
  <iframe src="/proposals/${encodedSlug}/raw" class="proposal-iframe"></iframe>
</div>`;
  const html = dashboardPage(title, '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleProposalsPage(res, pmDir) {
  const { cardsHtml, totalCount } = buildProposalCards(pmDir, null);

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

  let ideasHtml = '';
  if (ideas.length > 0) {
    const ideasItems = ideas.map(i => {
      const idHtml = i.id ? `<span class="kanban-id">${escHtml(i.id)}</span> ` : '';
      return `<a class="kanban-item" href="/backlog/${escHtml(encodeURIComponent(i.slug))}">${idHtml}<span class="kanban-item-title">${escHtml(i.title)}</span></a>`;
    }).join('\n');
    ideasHtml = `\n<div style="margin-top:2rem;">
  <div class="group-header standalone-header">
    <div class="group-title">Ideas</div>
    <div class="group-count">${ideas.length} ungroomed</div>
  </div>
  <div class="group-items">${ideasItems}</div>
</div>`;
  }

  let body;
  if (totalCount === 0 && ideas.length === 0) {
    body = `<div class="page-header"><h1>Proposals</h1></div>
<div class="empty-state">
  <h2>No proposals yet</h2>
  <p>Run <code>/pm:groom</code> to create your first proposal.</p>
</div>`;
  } else {
    const subtitle = [
      totalCount > 0 ? `${totalCount} groomed` : null,
      ideas.length > 0 ? `${ideas.length} idea${ideas.length !== 1 ? 's' : ''}` : null,
    ].filter(Boolean).join(', ');
    body = `<div class="page-header"><h1>Proposals</h1>
  <p class="subtitle">${subtitle}</p>
</div>
${totalCount > 0 ? `<div class="card-grid">${cardsHtml}</div>` : ''}${ideasHtml}`;
  }
  const html = dashboardPage('Proposals', '/proposals', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ========== Shared Research Content Builders ==========

function buildLandscapeContent(pmDir) {
  const landscapePath = path.join(pmDir, 'landscape.md');
  if (fs.existsSync(landscapePath)) {
    const raw = fs.readFileSync(landscapePath, 'utf-8');
    const { body } = parseFrontmatter(raw);
    const statsData = parseStatsData(body);
    const statsHtml = renderStatsCards(statsData);
    var rendered = renderLandscapeWithViz(body);
    if (statsHtml) rendered = rendered.replace(/(<\/h1>)/, '$1' + statsHtml);
    return '<div class="action-hint">Run <code>/pm:refresh</code> to update or <code>/pm:research landscape</code> to regenerate</div>' +
      '<div class="markdown-body">' + rendered + '</div>';
  }
  return '<div class="empty-state"><p>No landscape research yet.</p><p>Run <code>/pm:research landscape</code> to generate a market overview.</p></div>';
}

function buildCompetitorsContent(pmDir) {
  const compDir = path.join(pmDir, 'competitors');
  let competitorsHtml = '';
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
  return competitorsHtml;
}

function buildTopicsContent(pmDir) {
  const researchDir = path.join(pmDir, 'research');
  if (!fs.existsSync(researchDir)) {
    return '<div class="empty-state"><p>No topic research yet.</p><p>Run <code>/pm:research &lt;topic&gt;</code> for external research or <code>/pm:ingest &lt;path&gt;</code> to add customer evidence.</p></div>';
  }

  const topics = fs.readdirSync(researchDir, { withFileTypes: true })
    .filter(e => e.isDirectory()).map(e => e.name);

  if (topics.length === 0) {
    return '<div class="empty-state"><p>No topic research yet.</p><p>Run <code>/pm:research &lt;topic&gt;</code> for external research or <code>/pm:ingest &lt;path&gt;</code> to add customer evidence.</p></div>';
  }

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
      '<div class="card-footer"><div>' + meta.badgesHtml + '</div>' +
      '<a href="/research/' + escHtml(t) + '" class="view-link">View &rarr;</a></div>' +
      '</div>';
  }).join('');

  return '<div class="card-grid">' + topicCards + '</div>';
}

function handleResearchPage(res, pmDir) {
  const landscapeHtml = buildLandscapeContent(pmDir);
  const competitorsHtml = buildCompetitorsContent(pmDir);
  const topicsHtml = buildTopicsContent(pmDir);

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

  const html = dashboardPage('Research', '/kb?tab=research', body);
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
    var html = dashboardPage('Strategy', '/kb?tab=strategy', '<div class="page-header"><h1>Strategy</h1></div>' +
      '<div class="empty-state"><p>No <code>strategy.md</code> found.</p><p>Run <code>/pm:strategy</code> to create one.</p></div>');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  var raw = fs.readFileSync(filePath, 'utf-8');
  var parsed = parseFrontmatter(raw);
  var rendered = renderStrategyWithViz(parsed.body);

  var html = dashboardPage('Strategy', '/kb?tab=strategy', '<div class="page-header"><h1>Strategy</h1></div>' +
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

  var html = dashboardPage('Competitors', '/kb?tab=competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function buildKbSubTabs(activeTab) {
  const tabs = [
    { id: 'strategy', label: 'Strategy' },
    { id: 'research', label: 'Research' },
    { id: 'competitors', label: 'Competitors' },
    { id: 'landscape', label: 'Landscape' },
  ];
  return '<nav class="nav-secondary">' + tabs.map(t =>
    `<a href="${t.id === 'landscape' ? '/landscape' : '/kb?tab=' + t.id}" class="kb-tab${t.id === activeTab ? ' active' : ''}">${t.label}</a>`
  ).join('') + '</nav>';
}

function handleKnowledgeBasePage(res, pmDir, tab) {
  const validTabs = ['research', 'competitors', 'strategy', 'topics', 'landscape'];
  const activeTab = validTabs.includes(tab) ? tab : 'research';

  let contentHtml = '';
  let title = 'Research';

  if (activeTab === 'research') {
    title = 'Research';
    contentHtml = `<div class="content-section">
  <h2>Landscape</h2>
  ${buildLandscapeContent(pmDir)}
</div>
<div class="content-section">
  <h2>Research</h2>
  ${buildTopicsContent(pmDir)}
</div>`;
  } else if (activeTab === 'landscape') {
    title = 'Research — Landscape';
    contentHtml = buildLandscapeContent(pmDir);
  } else if (activeTab === 'strategy') {
    title = 'Research — Strategy';
    const filePath = path.join(pmDir, 'strategy.md');
    if (!fs.existsSync(filePath)) {
      contentHtml = '<div class="empty-state"><p>No <code>strategy.md</code> found.</p><p>Run <code>/pm:strategy</code> to create one.</p></div>';
    } else {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = parseFrontmatter(raw);
      const rendered = renderStrategyWithViz(parsed.body);
      const deckExists = fs.existsSync(path.join(pmDir, 'strategy-deck.html'));
      const deckBtn = deckExists
        ? '<a href="/strategy-deck" target="_blank" style="display:inline-flex;align-items:center;gap:0.4rem;padding:0.5rem 1rem;background:var(--accent,#2563eb);color:#fff;border-radius:8px;text-decoration:none;font-size:0.85rem;font-weight:600;">&#9654; View as Presentation</a>'
        : '';
      contentHtml = (deckBtn ? '<div style="margin-bottom:1rem;text-align:right">' + deckBtn + '</div>' : '') +
        '<div class="markdown-body">' + rendered + '</div>';
    }
  } else if (activeTab === 'competitors') {
    title = 'Research — Competitors';
    contentHtml = buildCompetitorsContent(pmDir);
  } else if (activeTab === 'topics') {
    title = 'Research';
    contentHtml = buildTopicsContent(pmDir);
  }

  const navActive = activeTab === 'topics' ? 'research' : activeTab;
  const body = '<div class="page-header"><h1>Research</h1></div>' + contentHtml;
  const html = dashboardPage(title, '/kb?tab=' + navActive, body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleCompetitorDetail(res, pmDir, slug) {
  const compDir = path.join(pmDir, 'competitors', slug);
  if (!fs.existsSync(compDir)) {
    const html = dashboardPage('Not Found', '/kb?tab=competitors', '<div class="empty-state"><p>Competitor not found.</p><p><a href="/competitors">&larr; Back to competitors</a></p></div>');
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
    if (idx === 0 && data.company) name = data.company;
    const label = TAB_LABELS[sec] || sec.charAt(0).toUpperCase() + sec.slice(1);
    const isFirst = tabHeaders.length === 0;
    tabHeaders.push(`<div class="tab${isFirst ? ' active' : ''}" role="tab" tabindex="0" aria-selected="${isFirst}" onclick="switchTab(this,'tab-${sec}')" onkeydown="tabKey(event,this,'tab-${sec}')">${label}</div>`);
    const rendered = sec === 'profile' ? renderProfileWithSwot(body) : renderMarkdown(body);
    tabPanels.push(`<div id="tab-${sec}" class="tab-panel${isFirst ? ' active' : ''}" role="tabpanel"><div class="markdown-body">${rendered}</div></div>`);
  });

  const body = `
<div class="page-header">
  <p class="breadcrumb"><a href="/kb?tab=competitors">&larr; Competitors</a></p>
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
  var tabName = panelId.replace('tab-', '');
  var url = new URL(window.location);
  url.searchParams.set('tab', tabName);
  history.replaceState(null, '', url);
}
function tabKey(e, el, panelId) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); switchTab(el, panelId); }
  if (e.key === 'ArrowRight') { var next = el.nextElementSibling; if (next) { next.focus(); next.click(); } }
  if (e.key === 'ArrowLeft') { var prev = el.previousElementSibling; if (prev) { prev.focus(); prev.click(); } }
}
(function() {
  var params = new URLSearchParams(window.location.search);
  var tab = params.get('tab');
  if (tab) {
    var panel = document.getElementById('tab-' + tab);
    var tabEl = document.querySelector('.tab[onclick*="tab-' + tab + '"]');
    if (panel && tabEl) switchTab(tabEl, 'tab-' + tab);
  }
})();
</script>`;

  const html = dashboardPage(name, '/kb?tab=competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleResearchTopic(res, pmDir, topic) {
  const topicDir = path.join(pmDir, 'research', topic);
  const findingsPath = path.join(topicDir, 'findings.md');

  if (!fs.existsSync(findingsPath)) {
    const html = dashboardPage('Not Found', '/kb?tab=topics', '<div class="empty-state"><p>Research topic not found.</p><p><a href="/research">&larr; Back to research</a></p></div>');
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
    return;
  }

  const raw = fs.readFileSync(findingsPath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const meta = buildTopicMeta(topic, data, findingsPath);
  const html = dashboardPage(meta.label, '/kb?tab=topics', `
<div class="page-header">
  <p class="breadcrumb"><a href="/kb?tab=research">&larr; Research</a></p>
  <h1>${escHtml(meta.label)}</h1>
  <p class="subtitle">${escHtml(meta.subtitle)}</p>
  <div class="topic-badges">${meta.badgesHtml}</div>
</div>
<div class="markdown-body">${renderMarkdown(body)}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleTranscriptPage(res, pmDir, slug, highlight) {
  const transcriptPath = path.join(pmDir, 'evidence', 'transcripts', slug + '.md');

  if (!fs.existsSync(transcriptPath)) {
    const html = dashboardPage('Transcript Not Found', '/kb?tab=research', `
<div class="empty-state">
  <p>No transcript found for <code>${escHtml(slug)}</code>.</p>
  <p><a href="/kb?tab=research">&larr; Back to research</a></p>
</div>`);
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(transcriptPath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);

  const sourceFile = data.source_file || slug;
  const speakers = (data.speakers || [])
    .map(s => `<span class="speaker-badge speaker-${escHtml(String(s.role))}">${escHtml(String(s.role))}</span>`)
    .join(' ');

  let renderedBody = renderMarkdown(body);

  if (highlight) {
    const safeHighlight = escHtml(highlight).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    renderedBody = renderedBody.replace(
      new RegExp(safeHighlight, 'g'),
      match => '<mark class="transcript-highlight">' + match + '</mark>'
    );
  }

  const html = dashboardPage(`Transcript: ${escHtml(sourceFile)}`, '/kb?tab=research', `
<div class="page-header">
  <p class="breadcrumb"><a href="/kb?tab=research">&larr; Research</a></p>
  <h1>Transcript: ${escHtml(sourceFile)}</h1>
  <div class="transcript-meta">
    <span class="meta-label">Speakers:</span> ${speakers}
    ${data.transcribed_at ? `<span class="meta-sep">&middot;</span> <span class="meta-label">Transcribed:</span> ${escHtml(String(data.transcribed_at).slice(0, 10))}` : ''}
    ${data.redacted ? '<span class="meta-sep">&middot;</span> <span class="badge badge-green">PII Redacted</span>' : ''}
  </div>
</div>
<div class="markdown-body transcript-reader">${renderedBody}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function detailBackBar(slug, pmDir, sectionAnchor) {
  // Find the groom/dev session this artifact belongs to
  const pmRoot = path.resolve(pmDir, '..', '.pm');
  let sessionSlug = null;
  // Check if slug itself is a groom session
  const groomDir = path.join(pmRoot, 'groom-sessions');
  if (fs.existsSync(path.join(groomDir, slug + '.md'))) {
    sessionSlug = slug;
  }
  // Otherwise scan groom sessions for artifact references
  if (!sessionSlug) {
    try {
      for (const f of fs.readdirSync(groomDir).filter(f2 => f2.endsWith('.md'))) {
        const raw = fs.readFileSync(path.join(groomDir, f), 'utf-8');
        if (raw.includes(slug)) { sessionSlug = f.replace('.md', ''); break; }
      }
    } catch {}
  }
  const anchor = sectionAnchor ? '#' + sectionAnchor : '';
  const backHref = sessionSlug ? '/session/' + encodeURIComponent(sessionSlug) + anchor : '/';
  const backLabel = sessionSlug ? 'Back to proposal' : 'Back to home';
  return `<div class="detail-back-bar" style="position:sticky;top:0;z-index:200;background:#fff;border-bottom:1px solid #e5e7eb;padding:0.5rem 1.5rem;display:flex;align-items:center;gap:0.75rem;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,0.04);"><a href="${escHtml(backHref)}" style="font-size:0.85rem;color:#7c3aed;text-decoration:none;font-weight:500;">&larr; ${escHtml(backLabel)}</a></div>`;
}

function handleWireframe(res, pmDir, slug, options = {}) {
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
    const label = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    let backHref = options.backHref;
    let backLabel = options.backLabel;
    if (!backHref || !backLabel) {
      // Find parent session for back link when the wireframe is opened outside a proposal-specific route.
      const pmRoot = path.resolve(pmDir, '..', '.pm');
      let sessionSlug = null;
      const groomDir = path.join(pmRoot, 'groom-sessions');
      try {
        for (const f of fs.readdirSync(groomDir).filter(f2 => f2.endsWith('.md'))) {
          const raw = fs.readFileSync(path.join(groomDir, f), 'utf-8');
          if (raw.includes(slug)) { sessionSlug = f.replace('.md', ''); break; }
        }
      } catch {}
      backHref = sessionSlug ? '/session/' + encodeURIComponent(sessionSlug) + '#wireframes' : '/';
      backLabel = sessionSlug ? 'Back to proposal' : 'Back to home';
    }

    const isFullPage = isFullDocument(content) && /<style[^>]*>[\s\S]*?(\.sidebar|\.app|display:\s*flex|display:\s*grid)[\s\S]*?<\/style>/i.test(content);

    if (isFullPage) {
      const hrefJson = JSON.stringify(backHref);
      const labelJson = JSON.stringify('\u2190 ' + backLabel);
      const backScript = `<script>(function(){var b=document.createElement('a');b.href=${hrefJson};b.textContent=${labelJson};b.style.cssText='position:fixed;top:12px;left:12px;z-index:99999;background:rgba(124,58,237,0.92);color:#fff;padding:6px 14px;border-radius:8px;font-weight:500;font-size:13px;font-family:-apple-system,system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,0.15);backdrop-filter:blur(4px);transition:opacity 0.2s';b.onmouseenter=function(){this.style.opacity='0.85'};b.onmouseleave=function(){this.style.opacity='1'};document.body.appendChild(b);})()</script>`;
      const injected = content.replace(/<\/body>/i, backScript + '</body>');
      const output = injected !== content ? injected : content + backScript;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(output);
    } else {
      let wfStyles = '';
      const styleMatch = content.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
      if (styleMatch) wfStyles = styleMatch[1];
      let wfBody = content;
      const bodyMatch = content.match(/<body[^>]*>([\s\S]*)<\/body>/i);
      if (bodyMatch) wfBody = bodyMatch[1];
      else {
        // Strip html/head/doctype if no body tag
        wfBody = wfBody.replace(/<!DOCTYPE[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '').replace(/<head>[\s\S]*?<\/head>/i, '');
      }
      const wrapped = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wireframe: ${escHtml(label)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #f8f9fa; color: #1a1a1a; line-height: 1.6; }
  .wf-header { background: linear-gradient(135deg, #2e1065 0%, #7c3aed 50%, #8b5cf6 100%); color: #fff; padding: 2rem 1.5rem; }
  .wf-header-inner { max-width: 960px; margin: 0 auto; }
  .wf-header .back-link { display: inline-block; font-size: 0.85rem; color: rgba(255,255,255,0.7); text-decoration: none; margin-bottom: 0.5rem; }
  .wf-header .back-link:hover { color: #fff; }
  .wf-header h1 { font-size: 1.5rem; font-weight: 700; }
  .wf-header p { font-size: 0.9rem; color: rgba(255,255,255,0.75); margin-top: 0.25rem; }
  .wf-content { max-width: 960px; margin: 0 auto; padding: 1rem 0; }
  ${wfStyles}
  body { padding: 0 !important; margin: 0 !important; }
</style>
</head>
<body>
<div class="wf-header">
  <div class="wf-header-inner">
    <a class="back-link" href="${escHtml(backHref)}">&larr; ${escHtml(backLabel)}</a>
    <h1>${escHtml(label)}</h1>
    <p>Lo-fi wireframe</p>
  </div>
</div>
<div class="wf-content">
${wfBody}
</div>
</body>
</html>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(wrapped);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(dashboardPage('Wireframe Not Found', '/backlog', '<div class="markdown-body"><h1>Wireframe not found</h1><p>No wireframe exists for this backlog item.</p></div>'));
  }
}

function handleBacklog(res, pmDir, view) {
  const backlogDir = path.join(pmDir, 'backlog');

  const contentHtml = buildBacklogKanban(pmDir);

  const searchHtml = `<div style="margin-bottom:1rem;">
<input type="text" id="backlog-search" placeholder="Filter backlog..."
  style="width:100%;padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.875rem;background:var(--surface);color:var(--text);outline:none;"
  onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" />
</div>
<script>
(function(){
  var input = document.getElementById('backlog-search');
  if (!input) return;
  input.addEventListener('input', function() {
    var q = this.value.toLowerCase();
    document.querySelectorAll('.kanban .kanban-item').forEach(function(el) {
      var text = el.textContent.toLowerCase();
      el.style.display = text.includes(q) ? '' : 'none';
    });
  });
})();
</script>`;

  const body = `<div class="page-header"><h1>Backlog</h1></div>
${searchHtml}
${contentHtml}`;

  const html = dashboardPage('Backlog', '/backlog', body);
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
        slug, title: data.title || slug, status: data.status || 'idea',
        id: data.id || null, parent: data.parent || null,
        priority: data.priority || 'medium',
        labels: Array.isArray(data.labels) ? data.labels.filter(l => l !== 'ideate') : [],
        updated: data.updated || data.created || '',
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
    const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
    const subCount = childCount[item.slug] || 0;
    const subBadge = subCount > 0 ? `<span class="badge">${subCount} sub-issue${subCount !== 1 ? 's' : ''}</span> ` : '';
    const labelHtml = item.labels.map(l => `<span class="kanban-label">${escHtml(l)}</span>`).join(' ');
    return `<a class="kanban-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">
  <div class="kanban-item-ids">${idHtml}${subBadge}</div>
  <div class="kanban-item-title">${escHtml(item.title)}</div>
  <div class="kanban-item-meta">${labelHtml}<span class="shipped-date">${escHtml(item.updated)}</span></div>
</a>`;
  }).join('');

  const body = `
<p class="breadcrumb"><a href="/backlog">&larr; Backlog</a></p>
<div class="page-header"><h1>Shipped</h1><span class="col-count" style="font-size:1rem;margin-left:0.5rem">${roots.length} items</span></div>
<div class="shipped-list">${rows || '<div class="empty-state"><p>No shipped items yet.</p></div>'}</div>`;

  const html = dashboardPage('Shipped', '/backlog', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleArchived(res, pmDir) {
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
        slug, title: data.title || slug, status: data.status || 'idea',
        id: data.id || null, parent: data.parent || null,
        priority: data.priority || 'medium',
        updated: data.updated || data.created || '',
      };
    }
  }

  for (const item of Object.values(allItems)) {
    if (item.parent && item.parent !== 'null' && allItems[item.parent]) {
      childCount[item.parent] = (childCount[item.parent] || 0) + 1;
    }
  }

  const roots = Object.values(allItems).filter(i =>
    i.status === 'archived' && (!i.parent || i.parent === 'null' || !allItems[i.parent])
  );
  roots.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));

  const rows = roots.map(item => {
    const idHtml = item.id ? `<span class="kanban-id">${escHtml(item.id)}</span> ` : '';
    const subCount = childCount[item.slug] || 0;
    const subBadge = subCount > 0 ? `<span class="badge">${subCount} sub-issue${subCount !== 1 ? 's' : ''}</span> ` : '';
    return `<a class="kanban-item done-item priority-${safePriority(item.priority)}" href="/backlog/${escHtml(encodeURIComponent(item.slug))}">
  <div class="kanban-item-ids">${idHtml}${subBadge}<span class="status-badge badge-archived">archived</span></div>
  <div class="kanban-item-title">${escHtml(item.title)}</div>
  <div class="kanban-item-meta"><span class="shipped-date">${escHtml(item.updated)}</span></div>
</a>`;
  }).join('');

  const body = `
<p class="breadcrumb"><a href="/backlog">&larr; Backlog</a></p>
<div class="page-header"><h1>Archived</h1><span class="col-count" style="font-size:1rem;margin-left:0.5rem">${roots.length} items</span></div>
<div class="shipped-list">${rows || '<div class="empty-state"><p>No archived items.</p></div>'}</div>`;

  const html = dashboardPage('Archived', '/backlog', body);
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
  } else if (rawStatus === 'drafted' || rawStatus === 'in-progress') {
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

  // ---- SSE Event Bus: ring buffer + broadcast ----
  const EVENT_BUFFER_CAP = 200;
  const eventBuffer = [];
  let eventIdCounter = 0;
  const sseClients = new Set();

  function pushEvent(event) {
    eventIdCounter++;
    const stored = { id: eventIdCounter, ...event };
    eventBuffer.push(stored);
    if (eventBuffer.length > EVENT_BUFFER_CAP) {
      eventBuffer.shift();
    }
    return stored;
  }

  function formatSSE(event) {
    return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  function broadcastSSE(event) {
    const data = formatSSE(event);
    for (const client of sseClients) {
      try { client.write(data); } catch { sseClients.delete(client); }
    }
  }

  const MAX_EVENT_BODY = 65536; // 64KB

  function handlePostEvent(req, res) {
    let body = '';
    let aborted = false;
    req.on('data', chunk => {
      body += chunk;
      if (!aborted && body.length > MAX_EVENT_BODY) {
        aborted = true;
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request body too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { type, source, timestamp } = parsed;
      if (!type || !source || timestamp == null) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields: type, source, timestamp' }));
        return;
      }

      const event = {
        type,
        source,
        timestamp,
        detail: parsed.detail || {},
        source_type: parsed.source_type || 'terminal',
      };

      const stored = pushEvent(event);
      broadcastSSE(stored);

      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: stored.id }));
    });
  }

  function handleSSEConnection(req, res) {
    touchActivity();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Replay events: missed events on reconnect, or all buffered on fresh load
    const lastId = req.headers['last-event-id'];
    if (lastId != null) {
      const lastIdNum = parseInt(lastId, 10);
      if (!isNaN(lastIdNum)) {
        for (const event of eventBuffer) {
          if (event.id > lastIdNum) {
            res.write(formatSSE(event));
          }
        }
      }
    } else {
      // Fresh connection — replay all buffered events
      for (const event of eventBuffer) {
        res.write(formatSSE(event));
      }
    }

    sseClients.add(res);
    allConnections.add(res.socket);

    // Heartbeat every 15 seconds
    const heartbeat = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { clearInterval(heartbeat); }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(res);
    });
  }

  const server = http.createServer((req, res) => {
    const reqUrl = req.url.split('?')[0];

    if (reqUrl === '/events') {
      if (req.method === 'POST') {
        handlePostEvent(req, res);
      } else if (req.method === 'GET') {
        handleSSEConnection(req, res);
      } else {
        res.writeHead(405); res.end('Method Not Allowed');
      }
      return;
    }

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

  // Watch .pm/sessions/ for HTML changes (PM-060 AC4)
  const sessionsWatchDir = path.resolve(pmDir, '..', '.pm', 'sessions');
  fs.mkdirSync(sessionsWatchDir, { recursive: true });

  if (fs.existsSync(pmDir)) {
    watcherActive = true;
    watchDirectoryTree(pmDir);
    watchDirectoryTree(sessionsWatchDir);
  }

  // Patch server.close to also destroy all open connections and close watcher
  const origClose = server.close.bind(server);
  server.close = function(cb) {
    // Stop the watcher first so no more broadcasts fire during teardown
    watcherActive = false;
    closeWatchersUnder(pmDir);
    closeWatchersUnder(sessionsWatchDir);
    // End SSE connections cleanly
    for (const client of sseClients) {
      try { client.end(); } catch {}
    }
    sseClients.clear();
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

// ========== Helper Functions ==========

function isFullDocument(html) {
  const trimmed = html.trimStart().toLowerCase();
  return trimmed.startsWith('<!doctype') || trimmed.startsWith('<html');
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

async function startServer() {
  const { port: PORT, hashed, shifted } = await resolvePort(HOST);
  if (PORT === 0) {
    console.error(`All ports in range ${hashed}–${hashed + 99} occupied; letting OS assign a port`);
  } else if (shifted && hashed !== null) {
    console.error(`Port ${hashed} occupied, using ${PORT} instead`);
  }

  const pmDir = DIR_FLAG
    ? path.resolve(process.cwd(), DIR_FLAG)
    : path.join(process.cwd(), 'pm');

  const server = createDashboardServer(pmDir);

  function ownerAlive() {
    if (!OWNER_PID) return true;
    try { process.kill(OWNER_PID, 0); return true; } catch (e) { return false; }
  }

  const lifecycleCheck = setInterval(() => {
    if (!ownerAlive()) {
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

  // Archive completed canvases older than 24 hours on startup
  archiveCompletedCanvases(pmDir);

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
  startServer().catch(err => { console.error(err); process.exit(1); });
}

module.exports = {
  computeAcceptKey, encodeFrame, decodeFrame, OPCODES,
  parseFrontmatter, renderMarkdown, inlineMarkdown, escHtml,
  createDashboardServer,
  readProposalMeta, proposalGradient, sanitizeGradient,
  readGroomState, groomPhaseLabel, buildProposalCards, findProposalAncestor, buildBacklogGrouped, buildBacklogKanban,
  hashProjectPort, isPortAvailable, resolvePort,
  DASHBOARD_CSS,
};
