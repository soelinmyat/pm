const crypto = require("crypto");
const http = require("http");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { normalizeKbPath, parseFrontmatter } = require("./kb-frontmatter.js");
const { buildStatus } = require("./start-status.js");
const { writeNote, parseNotesFile } = require("./note-helpers.js");

// ========== WebSocket Protocol (RFC 6455) ==========

const OPCODES = { TEXT: 0x01, CLOSE: 0x08, PING: 0x09, PONG: 0x0a };
const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function computeAcceptKey(clientKey) {
  return crypto
    .createHash("sha1")
    .update(clientKey + WS_MAGIC)
    .digest("base64");
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
  const opcode = buffer[0] & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLen = secondByte & 0x7f;
  let offset = 2;

  if (!masked) throw new Error("Client frames must be masked");

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
const HOST = process.env.PM_HOST || "127.0.0.1";
const URL_HOST = process.env.PM_URL_HOST || (HOST === "127.0.0.1" ? "localhost" : HOST);

// Owner PID tracking removed — server lifecycle is managed by idle timeout only.

// ========== Stable Port Resolution ==========

/**
 * Hash an absolute directory path to a deterministic port in 3000-9999.
 * @param {string} dir - Absolute directory path
 * @returns {number} Port in range [3000, 9999]
 */
function hashProjectPort(dir) {
  const hash = crypto.createHash("md5").update(dir).digest();
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
    const finish = (val) => {
      if (!done) {
        done = true;
        resolve(val);
      }
    };
    srv.once("error", () => srv.close(() => finish(false)));
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

function requireDashboardMode(value) {
  const mode = value || "dashboard";
  if (mode !== "dashboard") {
    throw new Error(`Unsupported PM server mode "${mode}". Use --mode dashboard.`);
  }
  return mode;
}

// --dir flag: directory for dashboard mode (default: 'pm/' relative to cwd)
const DIR_FLAG = (() => {
  const idx = process.argv.indexOf("--dir");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
})();

// ========== Mode Parsing (exported for testing) ==========

function parseMode(argv) {
  const idx = argv.indexOf("--mode");
  if (idx !== -1 && argv[idx + 1]) return requireDashboardMode(argv[idx + 1]);
  return requireDashboardMode(process.env.PM_MODE || "dashboard");
}

// ========== YAML Frontmatter Parser ==========

// ========== Simple Markdown-to-HTML Renderer ==========

function renderMarkdown(md) {
  const lines = md.split("\n");
  const out = [];
  let inCodeBlock = false;
  let inMermaid = false;
  let inList = false;
  let inTable = false;
  let tableHeaderDone = false;

  function closeList() {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  }
  function closeTable() {
    if (inTable) {
      out.push("</tbody></table>");
      inTable = false;
      tableHeaderDone = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      closeList();
      closeTable();
      if (inCodeBlock) {
        out.push("</code></pre>");
        inCodeBlock = false;
      } else if (inMermaid) {
        out.push("</pre>");
        inMermaid = false;
      } else if (line.trim() === "```mermaid") {
        out.push('<pre class="mermaid">');
        inMermaid = true;
      } else {
        out.push("<pre><code>");
        inCodeBlock = true;
      }
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
    if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
      closeList();
      const cells = line
        .trim()
        .slice(1, -1)
        .split("|")
        .map((c) => c.trim());
      // Separator row?
      if (cells.every((c) => /^[-: ]+$/.test(c))) {
        if (!tableHeaderDone) {
          out.push("</thead><tbody>");
          tableHeaderDone = true;
        }
        continue;
      }
      if (!inTable) {
        out.push("<table><thead>");
        inTable = true;
        tableHeaderDone = false;
        const row = cells.map((c) => "<th>" + inlineMarkdown(c) + "</th>").join("");
        out.push("<tr>" + row + "</tr>");
        continue;
      }
      const tag = tableHeaderDone ? "td" : "th";
      const row = cells.map((c) => "<" + tag + ">" + inlineMarkdown(c) + "</" + tag + ">").join("");
      out.push("<tr>" + row + "</tr>");
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
    if (h6) {
      closeList();
      out.push("<h6>" + inlineMarkdown(h6[1]) + "</h6>");
      continue;
    }
    if (h5) {
      closeList();
      out.push("<h5>" + inlineMarkdown(h5[1]) + "</h5>");
      continue;
    }
    if (h4) {
      closeList();
      out.push("<h4>" + inlineMarkdown(h4[1]) + "</h4>");
      continue;
    }
    if (h3) {
      closeList();
      out.push("<h3>" + inlineMarkdown(h3[1]) + "</h3>");
      continue;
    }
    if (h2) {
      closeList();
      out.push("<h2>" + inlineMarkdown(h2[1]) + "</h2>");
      continue;
    }
    if (h1) {
      closeList();
      out.push("<h1>" + inlineMarkdown(h1[1]) + "</h1>");
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      closeList();
      out.push("<hr>");
      continue;
    }

    // List items
    const liMatch = line.match(/^[ \t]*[-*+]\s+(.*)/);
    if (liMatch) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push("<li>" + inlineMarkdown(liMatch[1]) + "</li>");
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
    if (line.trim() === "") {
      continue;
    }

    // Paragraph
    out.push("<p>" + inlineMarkdown(line) + "</p>");
  }

  closeList();
  closeTable();
  if (inCodeBlock) out.push("</code></pre>");

  return out.join("\n");
}

// ========== JSON Body Parsing ==========

function parseJsonBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const contentType = (req.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("application/json")) {
      reject(new Error("Content-Type must be application/json"));
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes && !settled) {
        settled = true;
        req.destroy();
        reject(new Error("Body too large"));
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw || !raw.trim()) {
        reject(new Error("Empty body"));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function escHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(str) {
  // Escape HTML entities first to prevent XSS
  str = escHtml(str);
  // Bold+italic
  str = str.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Bold
  str = str.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  // Italic
  str = str.replace(/\*(.*?)\*/g, "<em>$1</em>");
  // Inline code
  str = str.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Links — sanitize href to block javascript:/data:/vbscript: schemes
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const scheme = url.trim().toLowerCase();
    if (/^(javascript|data|vbscript):/i.test(scheme)) return text;
    return '<a href="' + url + '">' + text + "</a>";
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
  --text-dim: #6d7585;
  --text-faint: #9ca3af;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #4f5bc4;
  --accent-subtle: #eef0ff;
  --dark: #1a1a2e;
  --sidebar-bg: #f0f1f4;
  --sidebar-text: #1a1d23;
  --sidebar-text-muted: rgba(30,33,40,0.5);
  --sidebar-hover-bg: rgba(0,0,0,0.03);
  --sidebar-active-bg: rgba(0,0,0,0.06);
  --sidebar-width: 240px;
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
  --text-xl: 1.25rem;      /* 20px */
  --text-2xl: 1.5rem;      /* 24px */
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
  --text-dim: #6d7585;
  --text-faint: #9ca3af;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #4f5bc4;
  --accent-subtle: #eef0ff;
  --dark: #1a1a2e;
  --sidebar-bg: #f0f1f4;
  --sidebar-text: #1a1d23;
  --sidebar-text-muted: rgba(30,33,40,0.5);
  --sidebar-hover-bg: rgba(0,0,0,0.03);
  --sidebar-active-bg: rgba(0,0,0,0.06);
  --sidebar-width: 240px;
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
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
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
  --text-dim: #6e7380;
  --text-faint: #4a4f57;
  --text-on-accent: #fff;
  --accent: #5e6ad2;
  --accent-hover: #7c85e0;
  --accent-subtle: #1e1f35;
  --dark: #111318;
  --sidebar-bg: #111318;
  --sidebar-text: rgba(255,255,255,0.9);
  --sidebar-text-muted: rgba(255,255,255,0.45);
  --sidebar-hover-bg: rgba(255,255,255,0.05);
  --sidebar-active-bg: rgba(255,255,255,0.08);
  --sidebar-width: 240px;
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
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.6; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-decoration: none; transition: color var(--transition); }
a:hover { color: var(--accent-hover); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 2px; }
button:focus-visible, [role="button"]:focus-visible, [tabindex]:focus-visible,
input:focus-visible, select:focus-visible, textarea:focus-visible {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  outline: none;
  border-radius: 4px;
}

/* Sidebar nav */
.sidebar { width: var(--sidebar-width); background: var(--sidebar-bg); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; position: fixed; top: 0; left: 0; bottom: 0; z-index: 10; }
.sidebar-brand { padding: 20px 16px 16px; font-weight: 700; font-size: 14px; color: var(--sidebar-text); letter-spacing: -0.02em; }
.sidebar nav { display: flex; flex-direction: column; gap: 2px; padding: 0 8px; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 7px 12px; font-size: 13px; font-weight: 500;
  color: var(--sidebar-text-muted); border-radius: 6px; text-decoration: none; transition: background 150ms, color 150ms; }
.nav-item:hover { background: var(--sidebar-hover-bg); color: var(--sidebar-text); }
.nav-item.active { background: var(--sidebar-active-bg); color: var(--sidebar-text); }
.nav-icon { width: 16px; height: 16px; opacity: 0.5; flex-shrink: 0; }
.nav-item.active .nav-icon { opacity: 0.8; }
.nav-divider { height: 1px; background: var(--border); margin: 6px 4px; }
.sidebar-footer { margin-top: auto; padding: 8px; border-top: 1px solid var(--border); }
.sidebar-footer-row { display: flex; align-items: center; justify-content: space-between; }
.sidebar-footer-item { font-size: 12px; flex: 1; }
.theme-toggle-btn {
  width: 32px; height: 32px; border-radius: var(--radius-sm); border: none; cursor: pointer;
  background: none; color: var(--sidebar-text-muted); display: flex; align-items: center;
  justify-content: center; flex-shrink: 0; transition: background 150ms, color 150ms;
}
.theme-toggle-btn:hover { background: var(--sidebar-hover-bg); color: var(--sidebar-text); }
.theme-icon-dark { display: none; }
[data-theme="dark"] .theme-icon-light { display: none; }
[data-theme="dark"] .theme-icon-dark { display: inline; }
/* Theme toggle is in sidebar footer — see .theme-toggle-btn */

/* Layout */
main.main-content { display: block; margin-left: var(--sidebar-width); }
.container { max-width: 960px; padding: 2rem 2rem; }

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
.kanban { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 1.5rem 0; align-items: start; }
.kanban-col { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.kanban-col .col-header { display: flex; align-items: center; gap: 8px;
  padding: 12px 16px; font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.col-count { font-size: 11px; font-weight: 500; color: var(--text-dim); font-variant-numeric: tabular-nums; }
.kanban-col .col-body { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.kanban-col.col-empty .col-body { display: flex; align-items: center; justify-content: center;
  padding: 32px 16px; color: var(--text-dim); font-size: 13px; min-height: 80px; }
.kanban-col.shipped .kanban-card { opacity: 0.7; }
.kanban-col.shipped .kanban-card:hover { opacity: 1; }
.kanban-card { padding: 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
  text-decoration: none; color: var(--text); transition: border-color 150ms; display: block; }
.kanban-card:hover { border-color: var(--border-strong); }
.kanban-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.kanban-card-id { font-size: 11px; font-weight: 600; color: var(--accent); font-variant-numeric: tabular-nums; }
.kanban-card-sub { font-size: 11px; color: var(--text-dim); }
.kanban-badge-planned { font-size: 0.625rem; padding: 0.0625rem 0.4rem; border-radius: 9999px; font-weight: 600; background: var(--badge-info-bg); color: var(--accent); margin-left: auto; }
.kanban-card-title { font-size: 13px; font-weight: 500; line-height: 1.4; }
.kanban-view-all { display: block; text-align: center; padding: 10px; font-size: 12px; color: var(--accent);
  text-decoration: none; border-top: 1px solid var(--border); }
.kanban-view-all:hover { background: var(--surface-hover); }
/* Status badges */
.status-badge { font-size: 0.6875rem; padding: 0.125rem 0.5rem; border-radius: 9999px; font-weight: 500; margin-left: 0.5rem; }
.badge-idea { background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
.badge-drafted { background: var(--badge-neutral-bg); color: var(--text-muted); }
.badge-proposed { background: var(--accent-subtle, rgba(94,106,210,0.1)); color: var(--accent); }
.badge-planned { background: var(--badge-info-bg); color: var(--badge-info-text); }
.badge-in-progress { background: var(--badge-info-bg); color: var(--accent); }
.badge-done { background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-approved { background: var(--badge-success-bg); color: var(--badge-success-text); }
/* Filter bar */
.filter-bar { margin-bottom: 24px; }
.filter-input { width: 100%; padding: 8px 12px; background: var(--surface); border: 1px solid var(--border);
  border-radius: 6px; font-size: 13px; color: var(--text); outline: none; font-family: inherit; transition: border-color 150ms; }
.filter-input::placeholder { color: var(--text-dim); }
.filter-input:focus { border-color: var(--accent); }
/* Legacy */
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

/* View toggle */
.view-toggle { display: flex; gap: 4px; margin-bottom: 1rem; }
.view-toggle-btn { padding: 6px 14px; font-size: 0.8125rem; font-weight: 500; border: 1px solid var(--border); border-radius: 6px; text-decoration: none; color: var(--text-secondary); background: var(--surface); transition: all 0.15s; }
.view-toggle-btn:hover { background: var(--surface-hover); }
.view-toggle-btn.active { background: var(--accent); color: var(--surface); border-color: var(--accent); }

/* Thread table */
.thread-table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; margin: 1rem 0; }
.thread-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin: 0; }
.thread-table thead { background: var(--bg); }
.thread-table th { text-align: left; font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); padding: 0.625rem 1rem; border-bottom: 1px solid var(--border); }
.thread-table td { padding: 0.625rem 1rem; border-bottom: 1px solid var(--border-subtle, var(--border)); vertical-align: middle; color: var(--text-secondary); }
.thread-table tr:last-child td { border-bottom: none; }
.thread-id { font-family: var(--font-mono, monospace); font-size: 0.75rem; font-weight: 600; color: var(--accent); background: var(--accent-subtle); padding: 2px 6px; border-radius: 4px; margin-right: 6px; }
.thread-feature { font-weight: 500; color: var(--text-primary, var(--text)); }
.thread-pill { display: inline-block; padding: 2px 8px; font-size: 0.75rem; font-weight: 500; border-radius: 4px; text-decoration: none; background: var(--accent-subtle); color: var(--accent); }
.thread-pill:hover { text-decoration: underline; }
.thread-pill-pr { background: var(--badge-info-bg); color: var(--badge-info-text); }
.thread-children-toggle { margin-top: 4px; }
.thread-children-toggle summary { font-size: 0.75rem; color: var(--text-muted); cursor: pointer; list-style: none; }
.thread-children-toggle summary::-webkit-details-marker { display: none; }
.thread-children-toggle summary::before { content: "\\25B6 "; font-size: 0.625rem; }
.thread-children-toggle[open] summary::before { content: "\\25BC "; }
.thread-children-list { list-style: none; padding: 4px 0 0 0; margin: 0; font-size: 0.75rem; color: var(--text-muted); }
.thread-children-list li { padding: 2px 0; }

.kanban-item-hint { font-size: 0.625rem; color: var(--text-muted); margin-top: 0.25rem; }
.suggested-next { margin-top: 1.5rem; padding: 1rem; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
.suggested-next-label { font-size: 0.75rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.375rem; }
.suggested-next code { background: var(--accent-subtle); padding: 0.15em 0.4em; border-radius: 3px; font-size: 0.8125rem; color: var(--accent); }
.session-brief-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 0.75rem; padding-top: 0.5rem; align-items: baseline; }
.session-brief-row:first-of-type { padding-top: 0; }
.session-brief-key { font-size: 0.6875rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; line-height: 1.5rem; }
.session-brief-value { min-width: 0; font-size: 0.9375rem; line-height: 1.5rem; }
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
  display: flex; flex-direction: column; gap: 2px;
  padding: var(--space-3) var(--space-4); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  transition: background 150ms;
}
.home-shipped-item:hover { background: var(--surface-raised, var(--surface)); }
.home-shipped-top { display: flex; align-items: baseline; gap: var(--space-3); }
.home-shipped-title { font-size: var(--text-base); font-weight: 500; flex: 1; }
.home-shipped-context { font-size: var(--text-xs); color: var(--text-muted); }
.home-shipped-date {
  font-size: var(--text-xs); color: var(--text-dim, var(--text-muted));
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
  background: var(--surface); border: 1px solid var(--border);
  transition: background 150ms;
}
.idea-row:hover { background: var(--surface-hover); }
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
/* ===== KB Search ===== */
.kb-search { margin-bottom: var(--space-4); }
.kb-search-input {
  width: 100%; padding: 0.5rem 0.75rem;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); border-radius: var(--radius, 6px);
  font-size: var(--text-sm); outline: none;
}
.kb-search-input:focus { border-color: var(--accent); }
.kb-search-input::placeholder { color: var(--text-dim, var(--text-muted)); }

/* ===== SETTINGS PAGE ===== */
.settings-header { margin-bottom: var(--space-8); }
.settings-header h1 { font-size: var(--text-xl); font-weight: 700; letter-spacing: -0.02em; color: var(--text-primary, var(--text)); margin: 0 0 var(--space-1); }
.settings-header .settings-subtitle { font-size: var(--text-sm); color: var(--text-muted); margin: 0; }
.settings-section { margin-bottom: var(--space-8); }
.settings-section-header { display: flex; align-items: baseline; margin-bottom: var(--space-4); }
.settings-section-header h2 { font-size: var(--text-sm); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 0; }
.section-count { font-size: var(--text-xs); color: var(--text-muted); font-weight: 500; }
.setting-row { display: flex; gap: var(--space-4); align-items: flex-start; padding: var(--space-4) var(--space-5); background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: var(--space-3); transition: border-color var(--transition); }
.setting-row:hover { border-color: var(--border-strong); }
.setting-icon { width: 36px; height: 36px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--accent-subtle); }
.setting-icon svg { width: 18px; height: 18px; color: var(--accent); }
.setting-body { flex: 1; min-width: 0; }
.setting-body h3 { font-size: var(--text-sm); font-weight: 600; color: var(--text-primary, var(--text)); margin: 0 0 var(--space-1); display: flex; align-items: center; gap: var(--space-2); }
.setting-body p { font-size: var(--text-xs); color: var(--text-muted); margin: 0; line-height: 1.5; }
.setting-body .click-to-copy { margin-top: var(--space-2); }
.setting-details { display: flex; flex-wrap: wrap; gap: var(--space-2); margin-top: var(--space-2); margin-bottom: 0; }
.detail-item { font-size: var(--text-xs); color: var(--text-secondary); }
.detail-label { font-weight: 600; color: var(--text-muted); text-transform: uppercase; font-size: var(--text-xs); letter-spacing: 0.04em; margin-right: var(--space-1); }
.detail-divider { color: var(--border-subtle, var(--border)); margin: 0 var(--space-1); }
.badge-connected { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-connected::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge-disconnected { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
.badge-disconnected::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.badge-on { display: inline-flex; font-size: var(--text-xs); font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--badge-success-bg); color: var(--badge-success-text); }
.badge-off { display: inline-flex; font-size: var(--text-xs); font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--badge-neutral-bg); color: var(--badge-neutral-text); }
.settings-help { font-size: var(--text-xs); color: var(--text-faint); line-height: 1.6; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border); margin-top: var(--space-6); }
.settings-help code { background: var(--surface-raised); padding: 0.15em 0.4em; border-radius: 3px; font-size: var(--text-xs); }

/* ===== KB HUB PAGE ===== */
.kb-domain-section { margin-bottom: var(--space-8); }

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
  display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); color: var(--text-muted);
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
.landscape-view-link { display: block; font-size: var(--text-sm); color: var(--accent); margin-top: var(--space-3); }
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
.competitor-view-link { display: block; font-size: var(--text-xs); color: var(--accent); margin-top: var(--space-2); }

/* Research topic rows */
.topic-list { display: flex; flex-direction: column; gap: var(--space-1); }
.topic-row {
  display: flex; align-items: center; gap: var(--space-3);
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
  text-decoration: none; color: var(--text);
  background: var(--surface); border: 1px solid var(--border);
  transition: background 150ms;
}
.topic-row:hover { background: var(--surface-hover); }
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

/* Customer evidence */
.evidence-summary { display: flex; flex-direction: column; gap: var(--space-3); }
.evidence-stats { display: flex; gap: var(--space-4); }
.evidence-stat { font-size: var(--text-sm); color: var(--text-muted); font-weight: 500; }
.evidence-imports { display: flex; flex-direction: column; gap: var(--space-1); }
.evidence-import-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm);
  background: var(--surface); border: 1px solid var(--border);
}
.evidence-import-info { display: flex; flex-direction: column; gap: 1px; }
.evidence-import-name { font-size: var(--text-base); font-weight: 500; }
.evidence-import-meta { font-size: var(--text-xs); color: var(--text-muted); }
.evidence-import-actions .view-link { font-size: var(--text-sm); color: var(--accent); text-decoration: none; font-weight: 500; }
.evidence-import-actions .view-link:hover { color: var(--accent-hover, var(--accent)); }
.evidence-topics, .evidence-tags { display: flex; align-items: baseline; gap: var(--space-2); flex-wrap: wrap; }
.evidence-section-label { font-size: var(--text-xs); color: var(--text-muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; min-width: var(--space-12); }
.evidence-badges { display: flex; gap: var(--space-1); flex-wrap: wrap; }

/* Transcript page */
.transcript-body { display: flex; flex-direction: column; gap: 1px; font-size: var(--text-sm); }
.transcript-line { display: flex; gap: var(--space-3); padding: var(--space-1) var(--space-2); border-radius: var(--space-1); align-items: baseline; }
.transcript-line:hover { background: var(--surface-hover); }
.transcript-ts { font-family: ui-monospace, SFMono-Regular, monospace; font-size: var(--text-xs); color: var(--text-muted); white-space: nowrap; min-width: 6ch; flex-shrink: 0; }
.transcript-speaker { font-weight: 600; white-space: nowrap; min-width: 10ch; flex-shrink: 0; }
.speaker-customer { color: var(--badge-success-text); }
.speaker-interviewer { color: var(--accent); }
.speaker-other { color: var(--text-muted); }
.transcript-text { flex: 1; line-height: 1.5; }

/* Detail page layout */
.detail-page { max-width: 960px; }
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
.detail-action-hint { margin-left: auto; }
.click-to-copy { cursor: pointer; display: inline-flex; align-items: center; gap: var(--space-2); padding: var(--space-2) var(--space-4); background: var(--accent-subtle); border-radius: var(--radius-sm); transition: background var(--transition); border: none; font-family: inherit; }
.click-to-copy:hover { background: var(--accent); color: var(--text-on-accent); }
.click-to-copy:hover code { color: var(--text-on-accent); background: transparent; }
.click-to-copy code { font-size: var(--text-base); color: var(--accent); background: transparent; }
.copy-icon { opacity: 0.6; vertical-align: middle; flex-shrink: 0; }
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
.detail-proposal-link {
  display: block; padding: var(--space-3) var(--space-4); background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--radius-sm); text-align: center;
  color: var(--accent); font-size: var(--text-sm); font-weight: 500;
  transition: background 150ms;
}
.detail-proposal-link:hover { background: var(--surface-raised); }
.detail-artifacts-row { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.detail-artifacts-row .detail-proposal-link { flex: 1; min-width: 140px; text-decoration: none; }
.detail-collapsible { border: 1px solid var(--border); border-radius: var(--radius-sm); margin-bottom: var(--space-2); }
.detail-collapsible summary { padding: var(--space-3) var(--space-4); font-weight: 600; font-size: var(--text-sm); cursor: pointer; color: var(--text); background: var(--surface); border-radius: var(--radius-sm); user-select: none; }
.detail-collapsible summary:hover { background: var(--surface-hover); }
.detail-collapsible[open] summary { border-bottom: 1px solid var(--border); border-radius: var(--radius-sm) var(--radius-sm) 0 0; }
.detail-collapsible .markdown-body { padding: var(--space-3) var(--space-4); }

/* Template wrappers (PM-140) */
.list-template { }
.kanban-template { }

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

/* Theme toggle is in sidebar footer — see .sidebar-theme-toggle */

/* Buttons */
.btn-primary {
  padding: var(--space-2) var(--space-5); font-size: var(--text-sm); font-weight: 600;
  border-radius: var(--radius-sm); border: none; cursor: pointer; font-family: inherit;
  background: var(--accent); color: var(--text-on-accent);
  transition: background var(--transition), box-shadow var(--transition);
  white-space: nowrap;
}
.btn-primary:hover { background: var(--accent-hover); box-shadow: var(--shadow-sm); }
.btn-primary:active { transform: scale(0.97); }

/* Notes page */
.page-desc { color: var(--text-muted); font-size: var(--text-base); margin-top: 2px; line-height: 1.5; }
.notes-capture-form {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-5) var(--space-6); margin-bottom: var(--space-8);
  box-shadow: var(--shadow-sm);
}
.form-row { margin-bottom: var(--space-4); }
.form-row-inline { display: flex; gap: var(--space-3); align-items: center; flex-wrap: wrap; }
.note-input {
  width: 100%; padding: var(--space-3) var(--space-4); border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-family: inherit; font-size: var(--text-base);
  background: var(--bg); color: var(--text); resize: vertical; line-height: 1.6;
  transition: border-color var(--transition), box-shadow var(--transition);
}
.note-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--selection-bg); outline: none; }
.note-input::placeholder { color: var(--text-faint); }
.note-select, .note-tags-input {
  padding: var(--space-2) var(--space-3); border: 1px solid var(--border);
  border-radius: var(--radius-sm); font-size: var(--text-sm);
  background: var(--bg); color: var(--text);
  transition: border-color var(--transition), box-shadow var(--transition);
}
.note-select:focus, .note-tags-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--selection-bg); outline: none; }
.note-tags-input { flex: 1; min-width: 160px; }
.note-tags-input::placeholder { color: var(--text-faint); }
.note-status { padding: var(--space-2) var(--space-3); border-radius: var(--radius-sm); font-size: var(--text-sm); margin-top: var(--space-3); }
.note-status-hidden { display: none; }
.note-success { background: var(--badge-success-bg); color: var(--badge-success-text); }
.note-error { background: var(--badge-error-bg); color: var(--badge-error-text); }
.notes-list { display: flex; flex-direction: column; gap: var(--space-3); }
.note-entry {
  background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
  padding: var(--space-4) var(--space-5); transition: border-color var(--transition);
}
.note-entry:hover { border-color: var(--border-strong); }
.note-header { display: flex; gap: var(--space-3); align-items: center; margin-bottom: var(--space-2); }
.note-timestamp { font-size: var(--text-xs); color: var(--text-faint); font-family: var(--font-mono, monospace); }
.note-source {
  font-size: var(--text-xs); font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--accent); background: var(--accent-subtle);
  padding: 2px var(--space-2); border-radius: var(--radius-sm);
}
.note-body { font-size: var(--text-base); color: var(--text); line-height: 1.6; }
.note-tags { font-size: var(--text-xs); color: var(--text-faint); margin-top: var(--space-2); }
.digest-status { margin-bottom: var(--space-4); display: flex; gap: var(--space-2); flex-wrap: wrap; }
.digest-badge { font-size: var(--text-xs); font-weight: 600; padding: 2px var(--space-2); border-radius: 999px; }
.badge-warning { background: var(--badge-warning-bg); color: var(--badge-warning-text); }
.badge-success { background: var(--badge-success-bg); color: var(--badge-success-text); }

/* Empty state card (inline) */
.empty-state-card {
  text-align: center; padding: var(--space-10) var(--space-6); color: var(--text-muted);
  border: 2px dashed var(--border); border-radius: var(--radius); margin: var(--space-4) 0;
}
.empty-title { font-size: var(--text-md); font-weight: 600; color: var(--text); margin-bottom: var(--space-2); }
.empty-desc { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.6; max-width: 420px; margin: 0 auto; }
.empty-desc code { background: var(--accent-subtle); padding: 0.15em 0.45em; border-radius: 4px; font-size: var(--text-xs); color: var(--accent); }

/* Animations */
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
`;

// ========== Dashboard HTML Shell ==========

function dashboardPage(title, activeNav, bodyContent, projectName) {
  projectName = projectName || "PM";
  const navLinks = [
    {
      href: "/",
      label: "Home",
      icon: '<svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6l6-4 6 4v7a1 1 0 01-1 1H3a1 1 0 01-1-1V6z"/></svg>',
    },
    {
      href: "/proposals",
      label: "Proposals",
      icon: '<svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 6h6M5 9h4"/></svg>',
    },
    {
      href: "/kb",
      label: "Knowledge Base",
      icon: '<svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h8"/></svg>',
    },
    {
      href: "/roadmap",
      label: "Roadmap",
      icon: '<svg class="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="4" height="10" rx="1"/><rect x="8" y="6" width="4" height="7" rx="1"/></svg>',
    },
  ];
  const settingsLink = {
    href: "/settings",
    label: "Settings",
    icon: '<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  };
  const navHtml = navLinks
    .map(
      (l) =>
        `<a href="${l.href}" class="nav-item${activeNav === l.href ? " active" : ""}">${l.icon}${l.label}</a>`
    )
    .join("\n      ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#f7f8fb">
<link rel="preconnect" href="https://rsms.me"><link href="https://rsms.me/inter/inter.css" rel="stylesheet">
<title>${escHtml(title)} - ${escHtml(projectName)}</title>
<script>
(function(){var t=localStorage.getItem('pm-theme');if(!t){t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);document.querySelector('meta[name=theme-color]')&&document.querySelector('meta[name=theme-color]').setAttribute('content',t==='dark'?'#0d0f12':'#f7f8fb');})();
</script>
<style>${DASHBOARD_CSS}</style>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true,theme:'neutral',securityLevel:'loose'});</script>
</head>
<body>
<aside class="sidebar" aria-label="Main navigation">
  <div class="sidebar-brand">${escHtml(projectName)}</div>
  <nav>
      ${navHtml}
  </nav>
  <div class="sidebar-footer">
    <div class="sidebar-footer-row">
      <a href="${settingsLink.href}" class="nav-item sidebar-footer-item${activeNav === settingsLink.href ? " active" : ""}">${settingsLink.icon}${settingsLink.label}</a>
      <button class="theme-toggle-btn" id="theme-toggle" aria-label="Toggle dark/light mode" title="Toggle dark/light mode">
        <svg class="theme-icon-light" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/></svg>
        <svg class="theme-icon-dark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13.2 9.8A5.5 5.5 0 016.2 2.8 6 6 0 1013.2 9.8z"/></svg>
      </button>
    </div>
  </div>
</aside>
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
    btn.setAttribute('title', t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }
  setTheme(getTheme());
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
  enterprise: "#5e6ad2",
  "mid-market": "#5e6ad2",
  smb: "#16a34a",
  horizontal: "#ea580c",
  self: "#044842",
  default: "#6b7280",
};

// ========== Reusable HTML Helpers ==========

function renderClickToCopy(command) {
  if (typeof command !== "string" || !command) return "";
  return `<span class="click-to-copy" data-copy="${escHtml(command)}" tabindex="0" role="button"><code>${escHtml(command)}</code><svg class="copy-icon" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>`;
}

function renderEmptyState(title, desc, command, ctaLabel) {
  // NOTE: desc is raw HTML — callers must escape user-supplied values with escHtml()
  // class="empty-state"><h2> pattern kept inline for PM-126 static source scan
  return (
    '<div class="empty-state"><h2>' +
    escHtml(title) +
    "</h2><p>" +
    desc +
    "</p>" +
    (command ? renderClickToCopy(command) : "") +
    (ctaLabel ? '<p class="empty-state-cta-label">' + escHtml(ctaLabel) + "</p>" : "") +
    "</div>"
  );
}

// ========== Template Engine ==========

/**
 * Render a detail page template from structured data.
 * @param {object} data - Template data matching the detail schema
 * @returns {string} HTML string for the detail page body
 */
/**
 * Shared header for all detail-* templates: breadcrumb, title, subtitle, meta bar.
 * Returns { breadcrumbHtml, titleHtml, subtitleHtml, metaBarHtml }.
 */
function renderDetailHeader(data) {
  const {
    breadcrumb = [],
    title = "",
    titlePrefix = "",
    subtitle = "",
    metaBadges = [],
    actionHint = "",
  } = data;

  const breadcrumbItems = breadcrumb.map((item, i) => {
    const isLast = i === breadcrumb.length - 1;
    const sep = i > 0 ? `\n  <span class="breadcrumb-sep">/</span>\n  ` : "";
    if (isLast) {
      return `${sep}<span class="breadcrumb-current">${escHtml(item.label)}</span>`;
    }
    return `${sep}<a href="${escHtml(item.href)}">${escHtml(item.label)}</a>`;
  });
  const breadcrumbHtml = `<nav class="detail-breadcrumb" aria-label="Breadcrumb">\n  ${breadcrumbItems.join("")}\n</nav>`;

  const titleHtml = `<h1 class="detail-title">${titlePrefix}${escHtml(title)}</h1>`;
  const subtitleHtml = subtitle ? `\n<p class="subtitle">${escHtml(subtitle)}</p>` : "";

  const badgesSeparated = metaBadges
    .map((b) => b.html)
    .join('<span class="meta-sep">&middot;</span>');
  const actionHintHtml = actionHint
    ? `<div class="detail-action-hint">${renderClickToCopy(actionHint)}</div>`
    : "";
  const metaBarHtml = `<div class="detail-meta-bar">${badgesSeparated}${actionHintHtml}</div>`;

  return { breadcrumbHtml, titleHtml, subtitleHtml, metaBarHtml };
}

function renderDetailTemplate(data) {
  const { sections = [] } = data;
  const { breadcrumbHtml, titleHtml, subtitleHtml, metaBarHtml } = renderDetailHeader(data);

  const sectionsHtml = sections
    .map((s) => {
      const sectionTitle = s.title ? `\n  <h2 class="detail-section-title">${s.title}</h2>` : "";
      return `<section class="detail-section">${sectionTitle}\n  ${s.html}\n</section>`;
    })
    .join("\n");

  return `<div class="detail-page">\n${breadcrumbHtml}\n${titleHtml}${subtitleHtml}\n${metaBarHtml}\n${sectionsHtml}\n</div>`;
}

var _tabCounter = 0;

function renderDetailTabsTemplate(data) {
  const { tabs = [] } = data;
  const { breadcrumbHtml, titleHtml, subtitleHtml, metaBarHtml } = renderDetailHeader(data);

  const prefix = "t" + _tabCounter++;

  const tabHeaders = tabs
    .map(
      (t, i) =>
        `<div class="tab${i === 0 ? " active" : ""}" role="tab" tabindex="0" aria-selected="${i === 0}" data-tab="${prefix}-${t.id}" onclick="${prefix}Switch(this,'${prefix}-${t.id}')" onkeydown="${prefix}Key(event,this,'${prefix}-${t.id}')">${escHtml(t.label)}</div>`
    )
    .join("");

  const tabPanels = tabs
    .map(
      (t, i) =>
        `<div id="${prefix}-${t.id}" class="tab-panel${i === 0 ? " active" : ""}" role="tabpanel"><div class="markdown-body">${t.html}</div></div>`
    )
    .join("");

  const tabBar =
    tabs.length > 1
      ? `<div class="tabs" role="tablist">${tabHeaders}</div>${tabPanels}`
      : tabs.length === 1
        ? `<div class="markdown-body">${tabs[0].html}</div>`
        : "";

  const script = `<script>
function ${prefix}Switch(el, panelId) {
  el.closest('.detail-page').querySelectorAll('.tabs .tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  el.closest('.detail-page').querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  el.setAttribute('aria-selected','true');
  document.getElementById(panelId).classList.add('active');
  history.replaceState(null, '', '#' + el.getAttribute('data-tab'));
}
function ${prefix}Key(e, el, panelId) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ${prefix}Switch(el, panelId); }
  if (e.key === 'ArrowRight') { var next = el.nextElementSibling; if (next) { next.focus(); next.click(); } }
  if (e.key === 'ArrowLeft') { var prev = el.previousElementSibling; if (prev) { prev.focus(); prev.click(); } }
}
(function() {
  var hash = location.hash.slice(1);
  if (hash) {
    var tab = document.querySelector('.tab[data-tab="' + hash + '"]');
    if (tab) ${prefix}Switch(tab, hash.replace('${prefix}-', '${prefix}-'));
  }
})();
</script>`;

  return `<div class="detail-page">\n${breadcrumbHtml}\n${titleHtml}${subtitleHtml}\n${metaBarHtml}\n${tabBar}\n</div>\n${script}`;
}

function renderDetailTocTemplate(data) {
  const { toc = [], bodyHtml = "" } = data;
  const { breadcrumbHtml, titleHtml, subtitleHtml, metaBarHtml } = renderDetailHeader(data);

  const tocNav =
    toc.length > 0
      ? `<nav class="tabs" role="navigation" aria-label="Sections">${toc
          .map((t) => `<a class="tab" href="#${t.slug}">${escHtml(t.text)}</a>`)
          .join("")}</nav>`
      : "";

  const script = `<script>
(function() {
  var sections = document.querySelectorAll('.detail-page [id]');
  var tocLinks = document.querySelectorAll('.tabs .tab');
  if (!tocLinks.length) return;
  function onScroll() {
    var scrollY = window.scrollY || document.documentElement.scrollTop;
    var current = null;
    sections.forEach(function(s) { if (s.offsetTop <= scrollY + 80) current = s; });
    tocLinks.forEach(function(l) {
      if (current && l.getAttribute('href') === '#' + current.id) l.classList.add('active');
      else l.classList.remove('active');
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
</script>`;

  return `<div class="detail-page">\n${breadcrumbHtml}\n${titleHtml}${subtitleHtml}\n${metaBarHtml}\n${tocNav}\n<div class="markdown-body">${bodyHtml}</div>\n</div>\n${script}`;
}

/**
 * Dispatch to the right template renderer.
 * @param {string} type - Template type: 'detail', 'detail-tabs', 'detail-toc'
 * @param {object} data - Template data
 * @returns {string} Rendered HTML
 */
function renderTemplate(type, data) {
  switch (type) {
    case "detail":
      return renderDetailTemplate(data);
    case "detail-tabs":
      return renderDetailTabsTemplate(data);
    case "detail-toc":
      return renderDetailTocTemplate(data);
    case "list":
      return renderListTemplate(data);
    case "kanban":
      return renderKanbanTemplate(data);
    default:
      throw new Error(`Unknown template type: ${type}`);
  }
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
  if (!stats) return "";
  var cards = stats
    .map(function (s) {
      return (
        '<div class="stat-card"><div class="value">' +
        escHtml(s.value) +
        '</div><div class="label">' +
        escHtml(s.label) +
        "</div></div>"
      );
    })
    .join("");
  return '<div class="stat-grid">' + cards + "</div>";
}

function parsePositioningData(mdBody) {
  const headerMatch = mdBody.match(
    /<!--\s*positioning:\s*company,\s*x\s*\(0-100,?\s*([^)]*)\),\s*y\s*\(0-100,?\s*([^)]*)\),\s*traffic,\s*segment-color\s*-->/i
  );
  if (!headerMatch) return null;

  const xDesc = headerMatch[1].trim();
  const yDesc = headerMatch[2].trim();

  const xParts = xDesc.split(/\s+to\s+/i);
  const xLabelLeft = xParts[0] || "";
  const xLabelRight = xParts[1] || "";
  const yParts = yDesc.split(/\s+to\s+/i);
  const yLabelBottom = yParts[0] || "";
  const yLabelTop = yParts[1] || "";

  const dataRegex = /<!--\s*([^,]+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\w[\w-]*)\s*-->/g;
  const points = [];
  let match;
  while ((match = dataRegex.exec(mdBody)) !== null) {
    if (match[1].trim().toLowerCase() === "positioning") continue;
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
  if (!data) return "";

  const W = 600,
    H = 400;
  const PAD = { top: 20, right: 30, bottom: 40, left: 30 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxTraffic = Math.max(
    ...data.points.map(function (p) {
      return p.traffic;
    }),
    1
  );
  function bubbleRadius(traffic) {
    if (traffic <= 0) return 4;
    var minR = 4,
      maxR = 16;
    var logVal = Math.log10(traffic + 1);
    var logMax = Math.log10(maxTraffic + 1);
    return minR + (maxR - minR) * (logVal / logMax);
  }

  var bubbles = data.points
    .map(function (p) {
      var cx = PAD.left + (p.x / 100) * plotW;
      var cy = PAD.top + (1 - p.y / 100) * plotH;
      var r = bubbleRadius(p.traffic);
      var color = SEGMENT_COLORS[p.segment] || SEGMENT_COLORS["default"];
      var labelY = cy - r - 6 > PAD.top ? cy - r - 6 : cy + r + 14;
      return (
        '<circle cx="' +
        cx +
        '" cy="' +
        cy +
        '" r="' +
        r +
        '" fill="' +
        color +
        '" fill-opacity="0.7" stroke="' +
        color +
        '" stroke-width="1.5"/>' +
        '<text x="' +
        cx +
        '" y="' +
        labelY +
        '" text-anchor="middle" font-size="10" font-weight="600" fill="var(--text)">' +
        escHtml(p.name) +
        "</text>"
      );
    })
    .join("\n    ");

  var gridLines = [];
  for (var i = 0; i <= 4; i++) {
    var gx = PAD.left + (i / 4) * plotW;
    var gy = PAD.top + (i / 4) * plotH;
    gridLines.push(
      '<line x1="' +
        gx +
        '" y1="' +
        PAD.top +
        '" x2="' +
        gx +
        '" y2="' +
        (PAD.top + plotH) +
        '" stroke="var(--border)" stroke-dasharray="4,4"/>'
    );
    gridLines.push(
      '<line x1="' +
        PAD.left +
        '" y1="' +
        gy +
        '" x2="' +
        (PAD.left + plotW) +
        '" y2="' +
        gy +
        '" stroke="var(--border)" stroke-dasharray="4,4"/>'
    );
  }

  var segments = [];
  data.points.forEach(function (p) {
    if (segments.indexOf(p.segment) === -1) segments.push(p.segment);
  });
  var legendItems = segments
    .map(function (s) {
      var color = SEGMENT_COLORS[s] || SEGMENT_COLORS["default"];
      return (
        '<span class="legend-item"><span class="legend-dot" style="background:' +
        color +
        '"></span>' +
        escHtml(s) +
        "</span>"
      );
    })
    .join("");

  return (
    '<div class="positioning-map">' +
    "<h3>Market Positioning Map</h3>" +
    '<div class="map-container">' +
    '<svg viewBox="0 0 ' +
    W +
    " " +
    H +
    '" width="100%" style="max-width:' +
    W +
    'px">' +
    gridLines.join("\n") +
    '<rect x="' +
    PAD.left +
    '" y="' +
    PAD.top +
    '" width="' +
    plotW +
    '" height="' +
    plotH +
    '" fill="none" stroke="var(--border)" stroke-width="1"/>' +
    bubbles +
    '<text x="' +
    PAD.left +
    '" y="' +
    (H - 4) +
    '" font-size="10" fill="var(--text-muted)">' +
    escHtml(data.xLabelLeft) +
    "</text>" +
    '<text x="' +
    (W - PAD.right) +
    '" y="' +
    (H - 4) +
    '" font-size="10" fill="var(--text-muted)" text-anchor="end">' +
    escHtml(data.xLabelRight) +
    "</text>" +
    '<text x="' +
    (PAD.left - 4) +
    '" y="' +
    (PAD.top + 4) +
    '" font-size="10" fill="var(--text-muted)" text-anchor="end" transform="rotate(-90, ' +
    (PAD.left - 4) +
    ", " +
    (PAD.top + 4) +
    ')">' +
    escHtml(data.yLabelTop) +
    "</text>" +
    '<text x="' +
    (PAD.left - 4) +
    '" y="' +
    (PAD.top + plotH) +
    '" font-size="10" fill="var(--text-muted)" text-anchor="end" transform="rotate(-90, ' +
    (PAD.left - 4) +
    ", " +
    (PAD.top + plotH) +
    ')">' +
    escHtml(data.yLabelBottom) +
    "</text>" +
    "</svg>" +
    "</div>" +
    '<div class="map-legend">' +
    legendItems +
    '<span class="legend-item scatter-legend-note">Bubble size = organic traffic</span></div>' +
    "</div>"
  );
}

// ========== Config + Project Name ==========

function readConfig(pmDir) {
  const configPath = path.join(path.dirname(pmDir), ".pm", "config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getProjectName(pmDir) {
  const config = readConfig(pmDir);
  return config.project_name || path.basename(path.dirname(pmDir)) || "PM";
}

// ========== Settings Page ==========

function handleSettingsPage(res, pmDir) {
  const config = readConfig(pmDir);
  const projectName = config.project_name || path.basename(path.dirname(pmDir)) || "PM";

  // Empty state: no config at all (readConfig returns {})
  if (
    !config.config_schema &&
    !config.project_name &&
    !config.integrations &&
    !config.preferences
  ) {
    const html = dashboardPage(
      "Settings",
      "/settings",
      renderEmptyState(
        "No configuration yet",
        "Initialize the project to configure integrations and preferences.",
        "/pm:start",
        "Set up this project"
      ),
      projectName
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const linear = config.integrations?.linear ?? {};
  const seo = config.integrations?.seo ?? {};
  const prefs = config.preferences ?? {};

  const linearConnected = linear.enabled === true;
  const seoConnected = seo.provider === "ahrefs";

  // Linear card
  const linearBadge = linearConnected
    ? '<span class="badge-connected">Connected</span>'
    : '<span class="badge-disconnected">Disconnected</span>';
  const linearDetails = linearConnected
    ? '<div class="setting-details">' +
      (linear.team
        ? '<span class="detail-item"><span class="detail-label">Team</span>' +
          escHtml(String(linear.team)) +
          "</span>"
        : "") +
      (linear.team && linear.project ? '<span class="detail-divider">&middot;</span>' : "") +
      (linear.project
        ? '<span class="detail-item"><span class="detail-label">Project</span>' +
          escHtml(String(linear.project)) +
          "</span>"
        : "") +
      "</div>"
    : "";
  const linearCommand = linearConnected ? "/pm:setup disable linear" : "/pm:setup enable linear";

  // SEO card
  const seoBadge = seoConnected
    ? '<span class="badge-connected">Connected</span>'
    : '<span class="badge-disconnected">Disconnected</span>';
  const seoCommand = seoConnected ? "/pm:setup disable ahrefs" : "/pm:setup enable ahrefs";

  // Auto launch preference
  const autoLaunch = prefs.auto_launch;
  const autoLaunchBadge =
    autoLaunch === true ? '<span class="badge-on">on</span>' : '<span class="badge-off">off</span>';

  // Ship auto-merge preference
  const shipPrefs = prefs.ship || {};
  const autoMerge = shipPrefs.auto_merge;
  const autoMergeBadge =
    autoMerge === true
      ? '<span class="badge-on">on</span>'
      : autoMerge === false
        ? '<span class="badge-off">off</span>'
        : '<span class="badge-off">not set</span>';

  const bodyHtml =
    '<div class="settings-header">' +
    "<h1>Settings</h1>" +
    '<p class="settings-subtitle">Integrations and preferences for this project.</p>' +
    "</div>" +
    // Integrations section
    '<div class="settings-section">' +
    '<div class="settings-section-header">' +
    "<h2>Integrations</h2>" +
    "</div>" +
    // Linear card
    '<div class="setting-row">' +
    '<div class="setting-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4l6-2 6 2v8l-6 2-6-2V4z"/><path d="M2 4l6 2 6-2"/><path d="M8 6v8"/></svg></div>' +
    '<div class="setting-body">' +
    "<h3>Linear " +
    linearBadge +
    "</h3>" +
    "<p>Issue tracking and project management sync</p>" +
    linearDetails +
    renderClickToCopy(linearCommand) +
    "</div></div>" +
    // SEO/Ahrefs card
    '<div class="setting-row">' +
    '<div class="setting-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><ellipse cx="8" cy="8" rx="3" ry="6"/></svg></div>' +
    '<div class="setting-body">' +
    "<h3>SEO / Ahrefs " +
    seoBadge +
    "</h3>" +
    "<p>SEO research and competitive analysis</p>" +
    renderClickToCopy(seoCommand) +
    "</div></div>" +
    "</div>" +
    // Preferences section
    '<div class="settings-section">' +
    '<div class="settings-section-header">' +
    "<h2>Preferences</h2>" +
    "</div>" +
    '<div class="setting-row">' +
    '<div class="setting-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M5 8h6"/></svg></div>' +
    '<div class="setting-body">' +
    "<h3>Auto-launch dashboard " +
    autoLaunchBadge +
    "</h3>" +
    "<p>Automatically start the dashboard when a PM session begins</p>" +
    "</div></div>" +
    // Ship auto-merge card
    '<div class="setting-row">' +
    '<div class="setting-icon"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 2v12"/><path d="M4 6l4-4 4 4"/><path d="M3 14h10"/></svg></div>' +
    '<div class="setting-body">' +
    "<h3>Ship auto-merge " +
    autoMergeBadge +
    "</h3>" +
    "<p>Automatically merge PR after CI passes. Turn off if main is your production branch.</p>" +
    "</div></div>" +
    "</div>" +
    // Help footer
    '<div class="settings-help">' +
    "Copy a command above to toggle settings, or edit <code>.pm/config.json</code> directly." +
    "</div>";

  const html = dashboardPage("Settings", "/settings", bodyHtml, projectName);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// ========== Notes (shared builder) ==========

function buildNotesContent(pmDir) {
  const notesDir = path.join(pmDir, "evidence", "notes");
  const allEntries = [];
  const monthDigestStatus = [];

  if (fs.existsSync(notesDir)) {
    const files = fs
      .readdirSync(notesDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    for (const file of files) {
      const filePath = path.join(notesDir, file);
      const parsed = parseNotesFile(filePath);
      const fm = parsed.frontmatter;

      let digestLabel = "Pending digest";
      let digestClass = "badge-warning";
      if (fm.digested_through && fm.digested_through !== "null") {
        const lastEntry =
          parsed.entries.length > 0 ? parsed.entries[parsed.entries.length - 1].timestamp : null;
        if (lastEntry && fm.digested_through >= lastEntry) {
          digestLabel = "Digested";
          digestClass = "badge-success";
        }
      }
      monthDigestStatus.push({
        month: fm.month || file.replace(".md", ""),
        digestLabel,
        digestClass,
      });

      allEntries.push(...parsed.entries.map((e) => ({ ...e, month: fm.month })));
    }
  }

  allEntries.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));

  let notesListHtml = "";
  if (allEntries.length === 0) {
    notesListHtml =
      '<div class="empty-state-card"><p class="empty-title">No notes yet</p><p class="empty-desc">Type <code>pm:note</code> in the CLI to capture your first observation.</p></div>';
  } else {
    notesListHtml = '<div class="notes-list">';
    for (const entry of allEntries) {
      notesListHtml += `<div class="note-entry">
        <div class="note-header"><span class="note-timestamp">${escHtml(entry.timestamp)}</span><span class="note-source">${escHtml(entry.source)}</span></div>
        <div class="note-body">${escHtml(entry.body)}</div>
        ${entry.tags ? '<div class="note-tags">' + escHtml(entry.tags) + "</div>" : ""}
      </div>`;
    }
    notesListHtml += "</div>";
  }

  let digestHtml = "";
  if (monthDigestStatus.length > 0) {
    digestHtml = '<div class="digest-status">';
    for (const ms of monthDigestStatus) {
      digestHtml += `<span class="digest-badge ${ms.digestClass}">${escHtml(ms.month)}: ${escHtml(ms.digestLabel)}</span> `;
    }
    digestHtml += "</div>";
  }

  return `
${digestHtml}
${notesListHtml}`;
}

function handleNotesPage(res, _pmDir) {
  // Redirect to KB notes tab
  res.writeHead(302, { Location: "/kb#notes" });
  res.end();
}

async function handleNoteCreate(req, res, pmDir) {
  try {
    const body = await parseJsonBody(req);
    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "text field is required and must be non-empty" }));
      return;
    }
    const result = writeNote(pmDir, body.text.trim(), body.source || "", body.tags || "");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, filePath: result.filePath, timestamp: result.timestamp }));
  } catch (err) {
    const status = err.message === "Body too large" ? 413 : 400;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: err.message }));
  }
}

// ========== Dashboard POST Router ==========

function routeDashboardPost(req, res, pmDir) {
  touchActivity();
  const url = req.url.split("?")[0];

  if (url === "/notes") {
    handleNoteCreate(req, res, pmDir);
  } else {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Not found" }));
  }
}

// ========== Dashboard Route Handlers ==========

function routeDashboard(req, res, pmDir) {
  touchActivity();
  const rawUrl = req.url;
  const url = rawUrl.split("?")[0];
  const pmExists = fs.existsSync(pmDir);
  const projectName = pmExists ? getProjectName(pmDir) : "PM";

  if (!pmExists) {
    const html = dashboardPage(
      "PM Dashboard",
      "/",
      renderEmptyState(
        "Welcome to PM",
        "PM is your team's shared product brain — strategy, research, proposals, and roadmap in one place. To get started, an engineer needs to initialize the knowledge base.",
        "/pm:setup",
        "Initialize knowledge base"
      )
    );
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Parse query params from the full URL (before ? stripping)
  const urlObj = new URL(rawUrl, "http://localhost");
  const urlPath = urlObj.pathname;
  const tab = urlObj.searchParams.get("tab");

  if (urlPath === "/") {
    handleDashboardHome(res, pmDir);
  } else if (urlPath.startsWith("/groom/")) {
    const slug = decodeURIComponent(urlPath.slice("/groom/".length)).replace(/\/$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleSessionPage(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath.startsWith("/session/")) {
    const slug = decodeURIComponent(urlPath.slice("/session/".length)).replace(/\/$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleSessionPage(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath === "/proposals") {
    handleProposalsPage(res, pmDir);
  } else if (urlPath.startsWith("/proposals/") && urlPath.endsWith("/raw")) {
    const slug = decodeURIComponent(urlPath.slice("/proposals/".length, -"/raw".length)).replace(
      /\/$/,
      ""
    );
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      const htmlPath = path.resolve(pmDir, "backlog", "proposals", slug + ".html");
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (/^\/proposals\/[^/]+\/wireframes\//.test(urlPath)) {
    // /proposals/{proposal}/wireframes/{wireframe} → serve from pm/backlog/wireframes/
    const wfSlug = decodeURIComponent(urlPath.replace(/^\/proposals\/[^/]+\/wireframes\//, ""))
      .replace(/\/$/, "")
      .replace(/\.html$/, "");
    handleWireframe(res, pmDir, wfSlug);
  } else if (urlPath.startsWith("/proposals/")) {
    const slug = decodeURIComponent(urlPath.slice("/proposals/".length)).replace(/\/$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleProposalDetail(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath === "/kb") {
    handleKnowledgeBasePage(res, pmDir, tab || null);
  } else if (urlPath === "/research") {
    // Redirect old route to KB
    res.writeHead(302, { Location: "/kb?tab=research" });
    res.end();
  } else if (urlPath === "/landscape") {
    // Redirect old route
    res.writeHead(302, { Location: "/kb?tab=landscape" });
    res.end();
  } else if (urlPath === "/competitors") {
    // Redirect old route to KB
    res.writeHead(302, { Location: "/kb?tab=competitors" });
    res.end();
  } else if (urlPath === "/strategy") {
    // Redirect old route to KB
    res.writeHead(302, { Location: "/kb?tab=strategy" });
    res.end();
  } else if (urlPath === "/strategy-deck") {
    const deckPath = path.resolve(pmDir, "strategy-deck.html");
    if (fs.existsSync(deckPath)) {
      const content = fs.readFileSync(deckPath, "utf-8");
      const header = injectableHeaderBar("Back", "Strategy Deck");
      const injected = content
        .replace(/(<\/head>)/i, header.style + "$1")
        .replace(/(<body[^>]*>)/i, "$1" + header.html);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(injected);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath === "/insights") {
    res.writeHead(302, { Location: "/kb" });
    res.end();
  } else if (urlPath === "/insights/competitors") {
    handleKbCompetitorsDetail(res, pmDir);
  } else if (urlPath === "/insights/business/landscape") {
    handleKbLandscapeDetail(res, pmDir);
  } else if (urlPath.startsWith("/insights/")) {
    const rest = decodeURIComponent(urlPath.slice("/insights/".length)).replace(/\/$/, "");
    const segments = rest.split("/").filter(Boolean);
    if (segments.length === 1 && !segments[0].includes("..")) {
      handleInsightDomainDetail(res, pmDir, segments[0]);
    } else if (
      segments.length === 2 &&
      !segments[0].includes("..") &&
      !segments[1].includes("..")
    ) {
      if (segments[0] === "competitors") {
        handleCompetitorDetail(res, pmDir, segments[1]);
      } else if (segments[0] === "business" && segments[1] === "landscape") {
        handleKbLandscapeDetail(res, pmDir);
      } else {
        handleInsightDocumentDetail(res, pmDir, segments[0], stripMdExtension(segments[1]));
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath === "/evidence") {
    res.writeHead(302, { Location: "/kb" });
    res.end();
  } else if (urlPath === "/evidence/research") {
    handleKbTopicsDetail(res, pmDir);
  } else if (urlPath.startsWith("/competitors/")) {
    const slug = urlPath.slice("/competitors/".length).replace(/\/$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleCompetitorDetail(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath.startsWith("/evidence/transcripts/")) {
    const slug = decodeURIComponent(urlPath.slice("/evidence/transcripts/".length))
      .replace(/\/$/, "")
      .replace(/\.md$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleTranscriptPage(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath.startsWith("/evidence/research/")) {
    const topic = decodeURIComponent(urlPath.slice("/evidence/research/".length))
      .replace(/\/$/, "")
      .replace(/\.md$/, "");
    if (topic && !topic.includes("/") && !topic.includes("..")) {
      handleResearchTopic(res, pmDir, topic);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath.startsWith("/research/")) {
    const topic = urlPath.slice("/research/".length).replace(/\/$/, "");
    if (topic && !topic.includes("/") && !topic.includes("..")) {
      handleResearchTopic(res, pmDir, topic);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  } else if (urlPath === "/notes") {
    handleNotesPage(res, pmDir);
  } else if (urlPath === "/roadmap") {
    const view = urlObj.searchParams.get("view");
    if (view === "threads") {
      handleBacklogThreads(res, pmDir);
    } else {
      handleBacklog(res, pmDir);
    }
  } else if (urlPath === "/roadmap/shipped") {
    handleShipped(res, pmDir);
  } else if (urlPath.startsWith("/roadmap/wireframes/")) {
    const slug = decodeURIComponent(urlPath.slice("/roadmap/wireframes/".length))
      .replace(/\/$/, "")
      .replace(/\.html$/, "");
    handleWireframe(res, pmDir, slug);
  } else if (urlPath.startsWith("/roadmap/")) {
    const slug = urlPath.slice("/roadmap/".length).replace(/\/$/, "");
    if (slug && !slug.includes("/") && !slug.includes("..")) {
      handleBacklogItem(res, pmDir, slug);
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
    // RFC (implementation plan) viewer
  } else if (urlPath.startsWith("/rfc/")) {
    const fileName = decodeURIComponent(urlPath.slice("/rfc/".length)).replace(/\/$/, "");
    handleRfcDetail(res, pmDir, fileName);
    // Legacy /backlog redirects
  } else if (urlPath === "/backlog") {
    res.writeHead(302, { Location: "/roadmap" });
    res.end();
  } else if (urlPath === "/backlog/shipped") {
    res.writeHead(302, { Location: "/roadmap/shipped" });
    res.end();
  } else if (urlPath.startsWith("/backlog/wireframes/")) {
    const rest = urlPath.slice("/backlog/wireframes".length);
    res.writeHead(302, { Location: "/roadmap/wireframes" + rest });
    res.end();
  } else if (urlPath.startsWith("/backlog/")) {
    const rest = urlPath.slice("/backlog".length);
    res.writeHead(302, { Location: "/roadmap" + rest });
    res.end();
  } else if (urlPath === "/settings") {
    handleSettingsPage(res, pmDir);
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
}

function getUpdatedDate(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { data } = parseFrontmatter(content);
    const raw = data.updated || data.created || null;
    if (!raw) return null;
    // Strip trailing YAML comments (e.g. "2026-03-13  # note")
    return String(raw).replace(/#.*$/, "").trim() || null;
  } catch {
    return null;
  }
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
        const idx = path.join(fp, "profile.md");
        if (fs.existsSync(idx)) d = getUpdatedDate(idx);
        if (!d) d = getNewestUpdated(fp);
      } else if (e.name.endsWith(".md")) {
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
  if (days === 0) label = "Updated today";
  else if (days === 1) label = "Updated yesterday";
  else if (days < 7) label = `Updated ${days}d ago`;
  else if (days < 30) {
    const w = Math.floor(days / 7);
    label = `Updated ${w}w ago`;
  } else {
    const m = Math.floor(days / 30);
    label = `Updated ${m}mo ago`;
  }

  if (days < 7) level = "fresh";
  else if (days < 30) level = "aging";
  else level = "stale";

  return { label, level };
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return "";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;
  const diffMs = now - then;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return dateStr;
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function humanizeSlug(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function stripMdExtension(value) {
  return String(value || "").replace(/\.md$/i, "");
}

function getResearchEvidenceDir(pmDir) {
  return path.join(pmDir, "evidence", "research");
}

function getLegacyResearchDir(pmDir) {
  return path.join(pmDir, "research");
}

function getTopicFilePath(pmDir, slug) {
  const layeredPath = path.join(getResearchEvidenceDir(pmDir), slug + ".md");
  if (fs.existsSync(layeredPath)) return layeredPath;
  const legacyPath = path.join(getLegacyResearchDir(pmDir), slug, "findings.md");
  if (fs.existsSync(legacyPath)) return legacyPath;
  return layeredPath;
}

function listResearchTopicFiles(pmDir) {
  const topics = new Map();
  const layeredDir = getResearchEvidenceDir(pmDir);
  if (fs.existsSync(layeredDir)) {
    const files = fs
      .readdirSync(layeredDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .filter((entry) => entry.name !== "index.md" && entry.name !== "log.md");
    for (const entry of files) {
      const slug = stripMdExtension(entry.name);
      topics.set(slug, { slug, filePath: path.join(layeredDir, entry.name) });
    }
  }

  const legacyDir = getLegacyResearchDir(pmDir);
  if (fs.existsSync(legacyDir)) {
    const dirs = fs
      .readdirSync(legacyDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
    for (const entry of dirs) {
      if (topics.has(entry.name)) continue;
      const findingsPath = path.join(legacyDir, entry.name, "findings.md");
      if (fs.existsSync(findingsPath)) {
        topics.set(entry.name, { slug: entry.name, filePath: findingsPath });
      }
    }
  }

  return Array.from(topics.values());
}

function getCompetitorsDir(pmDir) {
  const layeredDir = path.join(pmDir, "insights", "competitors");
  if (fs.existsSync(layeredDir)) return layeredDir;
  return path.join(pmDir, "competitors");
}

function getLandscapePath(pmDir) {
  const layeredPath = path.join(pmDir, "insights", "business", "landscape.md");
  if (fs.existsSync(layeredPath)) return layeredPath;
  return path.join(pmDir, "landscape.md");
}

function getInsightIndexPath(pmDir, domain) {
  return path.join(pmDir, "insights", domain, "index.md");
}

function listInsightDomains(pmDir) {
  const insightsDir = path.join(pmDir, "insights");
  if (!fs.existsSync(insightsDir)) return [];
  return fs
    .readdirSync(insightsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const indexPath = getInsightIndexPath(pmDir, entry.name);
      return fs.existsSync(indexPath) ? { slug: entry.name, indexPath } : null;
    })
    .filter(Boolean);
}

function extractMarkdownParagraphs(body) {
  return body.split(/\n\n/).filter((paragraph) => {
    const trimmed = paragraph.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed)) return false;
    if (/^\|/.test(trimmed)) return false;
    if (/^<!--[\s\S]*-->$/.test(trimmed.replace(/\n/g, ""))) return false;
    if (/^(<!--.*-->\s*)+$/.test(trimmed.replace(/\n/g, " "))) return false;
    return true;
  });
}

function extractMarkdownSummary(body, maxLength) {
  const firstParagraph = extractMarkdownParagraphs(body)[0] || "";
  return firstParagraph
    .replace(/\n/g, " ")
    .replace(/[*_`#]/g, "")
    .replace(/<!--.*?-->/g, "")
    .trim()
    .slice(0, maxLength || 200);
}

function extractMarkdownTitle(body, fallback) {
  const titleMatch = body.match(/^#\s+(.+)/m);
  return titleMatch ? titleMatch[1].trim() : fallback;
}

// ========== RFC Resolution ==========

/**
 * Find RFC (implementation plan) files matching an issue slug.
 * Convention: docs/plans/YYYY-MM-DD-{slug}.md
 * Searches pm_plugin/docs/plans/, docs/plans/, and pm_server/docs/plans/.
 */
function findRfcsForSlug(pmDir, slug) {
  const projectRoot = path.dirname(pmDir);
  const planDirs = [
    path.join(projectRoot, "pm_plugin", "docs", "plans"),
    path.join(projectRoot, "docs", "plans"),
    path.join(projectRoot, "pm_server", "docs", "plans"),
  ];
  const results = [];
  const suffix = "-" + slug + ".md";
  for (const dir of planDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(suffix)) {
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        results.push({
          fileName: file,
          filePath: path.join(dir, file),
          date: dateMatch ? dateMatch[1] : "",
          repo: dir.includes("pm_server") ? "server" : "plugin",
        });
      }
    }
  }
  return results;
}

/**
 * Find RFCs for a slug and all its children slugs.
 */
function findRfcsForIssueTree(pmDir, slug, childrenSlugs) {
  const rfcs = findRfcsForSlug(pmDir, slug);
  if (Array.isArray(childrenSlugs)) {
    for (const child of childrenSlugs) {
      rfcs.push(...findRfcsForSlug(pmDir, child));
    }
  }
  return rfcs;
}

// ========== Shipped Enrichment Helpers ==========

/**
 * Resolve research_refs to topic labels.
 * research_refs can be legacy research paths with a `/findings.md` suffix,
 * layered evidence paths like "pm/evidence/research/dashboard-linear-quality.md", or shorthand topic slugs.
 */
function resolveResearchRefs(refs, pmDir) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  return refs.map((ref) => {
    const normalized = normalizeKbPath(ref) || String(ref).trim().replace(/\\/g, "/");
    const evidenceMatch = normalized.match(/^evidence\/research\/([^/]+?)(?:\.md)?$/);
    const legacyMatch = normalized.match(/^research\/([^/]+)(?:\/findings\.md)?$/);
    let slug = "";
    if (evidenceMatch) {
      slug = evidenceMatch[1];
    } else if (legacyMatch) {
      slug = legacyMatch[1];
    } else {
      slug = stripMdExtension(path.basename(normalized)).replace(/\/findings$/i, "");
    }

    const findingsPath = getTopicFilePath(pmDir, slug);
    if (fs.existsSync(findingsPath)) {
      const parsed = parseFrontmatter(fs.readFileSync(findingsPath, "utf-8"));
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
function resolveStrategyAlignment(_item, _allItems, _pmDir) {
  // Deprecated: strategy_check lived in .meta.json sidecars which have been removed.
  // This function is retained as a no-op for backwards compatibility of the export.
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
  const compDir = getCompetitorsDir(pmDir);
  if (fs.existsSync(compDir)) {
    const compSlugs = fs
      .readdirSync(compDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const ref of refs) {
      for (const comp of compSlugs) {
        if (String(ref).toLowerCase().includes(comp.toLowerCase())) {
          const profilePath = path.join(compDir, comp, "profile.md");
          let name = humanizeSlug(comp);
          if (fs.existsSync(profilePath)) {
            const parsed = parseFrontmatter(fs.readFileSync(profilePath, "utf-8"));
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
  "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
  "linear-gradient(135deg, #fa709a 0%, #fee140 100%)",
  "linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)",
  "linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)",
  "linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)",
];

function proposalGradient(slug) {
  if (!slug) return PROPOSAL_GRADIENTS[0];
  let hash = 5381;
  for (let i = 0; i < slug.length; i++) {
    hash = ((hash << 5) + hash + slug.charCodeAt(i)) >>> 0;
  }
  return PROPOSAL_GRADIENTS[hash % PROPOSAL_GRADIENTS.length];
}

function readProposalMeta(_slug, _pmDir) {
  // Deprecated: .meta.json sidecars have been removed. All proposal data now
  // lives in backlog .md frontmatter. Retained as a no-op for export compat.
  return null;
}

function buildProposalRows(pmDir) {
  const backlogDir = path.resolve(pmDir, "backlog");
  const proposals = [];

  // Build a map of parent → child statuses from backlog
  const childStatuses = {};
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"))) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const parent = data.parent;
      if (parent && parent !== "null") {
        if (!childStatuses[parent]) childStatuses[parent] = [];
        childStatuses[parent].push(data.status || "idea");
      }
    }
  }

  // Collect proposals from backlog .md files with prd field (excludes done)
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"))) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      if (!data.prd || data.status === "done") continue;
      const slug = file.replace(/\.md$/, "");

      const children = childStatuses[slug];
      if (children && children.length > 0 && children.every((s) => s === "done")) continue;

      const st = (data.status || "").toLowerCase();
      const displayStatus =
        st === "in-progress"
          ? "In Progress"
          : st === "proposed"
            ? "Ready"
            : st === "planned"
              ? "Planned"
              : "Groomed";
      const displayBadge =
        st === "in-progress" ? "in-progress" : st === "proposed" ? "ready" : "groomed";

      proposals.push({
        slug,
        id: data.id || "",
        title:
          typeof data.title === "string" && data.title.trim() ? data.title : humanizeSlug(slug),
        outcome: data.outcome || "",
        verdict: displayBadge,
        verdictLabel: displayStatus,
        issueCount: (children || []).length,
        date: data.updated || data.created || "",
      });
    }
  }

  proposals.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return proposals;
}

function readGroomState(pmDir) {
  const runtimeRoot = path.resolve(pmDir, "..", ".pm");
  const candidates = [];
  const sessionsDir = path.join(runtimeRoot, "groom-sessions");
  if (fs.existsSync(sessionsDir)) {
    for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".md")) {
        candidates.push(path.join(sessionsDir, entry.name));
      }
    }
  }
  const legacyPath = path.join(runtimeRoot, ".groom-state.md");
  if (fs.existsSync(legacyPath)) {
    candidates.push(legacyPath);
  }

  let best = null;
  for (const statePath of candidates) {
    try {
      const raw = fs.readFileSync(statePath, "utf-8");
      const { data } = parseFrontmatter(raw);
      if (typeof data.topic !== "string" || data.topic.trim() === "") {
        continue;
      }
      const updatedAt = Date.parse(data.updated || data.started_at || "") || 0;
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
  const origin = String(value || "external").toLowerCase();
  return origin === "internal" || origin === "mixed" || origin === "external" ? origin : "external";
}

function parseCount(value) {
  const count = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(count) ? count : null;
}

function buildTopicMeta(slug, data, findingsPath) {
  const origin = normalizeSourceOrigin(data.source_origin);
  const evidenceCount = parseCount(data.evidence_count);
  const label =
    typeof data.topic === "string" && data.topic.trim() !== ""
      ? data.topic.trim()
      : humanizeSlug(slug);
  const originLabel = origin.charAt(0).toUpperCase() + origin.slice(1);
  const subtitleParts = [
    origin === "internal"
      ? "Customer evidence"
      : origin === "mixed"
        ? "Customer + market evidence"
        : "External research",
  ];

  const badges = [`<span class="badge badge-origin-${origin}">${escHtml(originLabel)}</span>`];

  if ((origin === "internal" || origin === "mixed") && evidenceCount) {
    const evidenceLabel = `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"}`;
    subtitleParts.push(evidenceLabel);
    badges.push(`<span class="badge badge-evidence">${escHtml(evidenceLabel)}</span>`);
  }

  const stale = stalenessInfo(getUpdatedDate(findingsPath));
  if (stale) badges.push(`<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`);

  return {
    label,
    subtitle: subtitleParts.join(" · "),
    badgesHtml: badges.join(" "),
  };
}

function parseStrategySnapshot(pmDir) {
  const strategyPath = path.join(pmDir, "strategy.md");
  if (!fs.existsSync(strategyPath)) return null;
  const raw = fs.readFileSync(strategyPath, "utf-8");
  const { body } = parseFrontmatter(raw);

  // Extract focus: a one-liner value prop / positioning statement.
  // Priority: ## Focus/Vision > **Value prop:** > ## Value Prop > ## Product Identity first para
  let focus = "";
  const focusMatch = body.match(/## (?:Focus|Vision)\s*\n+(.*?)(?:\n\n|\n##)/s);
  if (focusMatch) focus = focusMatch[1].replace(/\n/g, " ").trim();
  if (!focus) {
    // Look for **Value prop:** bold inline label
    const vpInline = body.match(
      /\*\*Value prop[^*]*\*\*[:\s]*(.*?)(?:\n\n|\n-|\n\*|\n\d+\.|\n##)/s
    );
    if (vpInline) {
      let text = vpInline[1].replace(/\n/g, " ").trim();
      // Accept . ! ? or trailing : as sentence end
      const sentence = text.match(/^[^.!?:]*[.!?:]/);
      focus = sentence ? sentence[0].replace(/:$/, ".").trim() : text.slice(0, 200);
    }
  }
  if (!focus) {
    // Look for ## Core Value Prop or ## Value Prop section
    const vpSection = body.match(/## (?:Core )?Value Prop[^\n]*\s*\n+([\s\S]*?)(?:\n##|$)/);
    if (vpSection) {
      // Find first non-heading, non-empty line
      for (const line of vpSection[1].split("\n")) {
        const stripped = line
          .replace(/^#+\s+.*$/, "")
          .replace(/^\*\*[^*]+\*\*[:\s]*/, "")
          .trim();
        if (stripped) {
          const sentence = stripped.match(/^[^.!?]*[.!?]/);
          focus = sentence ? sentence[0].trim() : stripped.slice(0, 200);
          break;
        }
      }
    }
  }
  if (!focus) {
    // Fallback: ## Product Identity first meaningful paragraph
    const idSection = body.match(/## (?:\d+\.\s*)?Product Identity\s*\n+([\s\S]*?)(?:\n##|$)/);
    if (idSection) {
      const sentence = idSection[1]
        .replace(/\n/g, " ")
        .trim()
        .match(/^[^.!?]*[.!?]/);
      if (sentence) focus = sentence[0].trim();
    }
  }

  // Extract priorities: look for ## Priorities section or **Top N priorities:** label
  const priorities = [];
  const priSection =
    body.match(/## (?:\d+\.\s*)?(?:.*[Pp]riorities.*)\s*\n([\s\S]*?)(?:\n##|$)/) ||
    body.match(/\*\*Top \d+ priorities[^*]*\*\*[:\s]*\n([\s\S]*?)(?:\n##|$)/);
  if (priSection) {
    // Only match numbered list items (1. 2. 3.) — skip prose and bold labels
    const lines = priSection[1].split("\n").filter((l) => /^\s*\d+[\.\)]\s/.test(l));
    for (const line of lines.slice(0, 3)) {
      // Strip list marker, extract bold title if present, take first sentence
      let text = line.replace(/^\s*\d+[\.\)]\s*/, "").trim();
      const boldTitle = text.match(/^\*\*([^*]+)\*\*\.?\s*/);
      if (boldTitle) {
        text = boldTitle[1];
      } else {
        const sentence = text.match(/^[^.]*\./);
        if (sentence) text = sentence[0].trim();
        else text = text.slice(0, 120);
      }
      priorities.push(text);
    }
  }

  const stale = stalenessInfo(getUpdatedDate(strategyPath));
  return { focus, priorities, staleness: stale || { level: "fresh", label: "Current" } };
}

function renderListTemplate(opts) {
  const { breadcrumb, title, subtitle, sections = [], emptyState, contentBefore } = opts;

  const parts = [];

  // Page header
  parts.push('<div class="list-template">');
  parts.push('<div class="page-header">');
  if (breadcrumb) parts.push(`<p class="breadcrumb">${breadcrumb}</p>`);
  parts.push(`<h1>${escHtml(title)}</h1>`);
  if (subtitle) parts.push(`<p class="subtitle">${escHtml(subtitle)}</p>`);
  parts.push("</div>");

  // Empty state: shown when all sections have 0 items and no contentBefore
  const totalItems = sections.reduce((sum, s) => sum + (s.items ? s.items.length : 0), 0);
  if (emptyState && totalItems === 0 && !contentBefore) {
    parts.push(emptyState);
    parts.push("</div>");
    return parts.join("\n");
  }

  // Optional content before sections
  if (contentBefore) parts.push(contentBefore);

  // Sections
  for (const section of sections) {
    if (!section.items || section.items.length === 0) continue;
    parts.push('<section class="section">');
    if (section.title) {
      parts.push('<div class="section-header">');
      parts.push(`<span class="section-title">${escHtml(section.title)}</span>`);
      if (section.count) parts.push(`<span class="section-count">${escHtml(section.count)}</span>`);
      parts.push("</div>");
    }
    const containerClass =
      section.itemsClass || (section.layout === "cards" ? "card-grid" : "item-list");
    parts.push(`<div class="${containerClass}">${section.items.join("\n")}</div>`);
    parts.push("</section>");
  }

  parts.push("</div>");
  return parts.join("\n");
}

function renderKanbanTemplate(opts) {
  const { title, subtitle, legend, columns = [], emptyState, headerExtra } = opts;

  const parts = [];

  // Page header
  parts.push('<div class="kanban-template">');
  parts.push('<div class="page-header">');
  parts.push(`<h1>${escHtml(title)}</h1>`);
  if (subtitle) parts.push(`<p class="subtitle">${escHtml(subtitle)}</p>`);
  parts.push("</div>");

  // Optional extra content after header (e.g. view toggle)
  if (headerExtra) parts.push(headerExtra);

  // Optional legend
  if (legend) parts.push(legend);

  // Empty state: shown when all columns have 0 items
  const totalItems = columns.reduce((sum, c) => sum + (c.items ? c.items.length : 0), 0);
  if (emptyState && totalItems === 0) {
    parts.push(emptyState);
    parts.push("</div>");
    return parts.join("\n");
  }

  // Columns
  const colsHtml = columns
    .map((col) => {
      const totalCount = col.totalCount || (col.items ? col.items.length : 0);
      const emptyClass = totalCount === 0 ? " col-empty" : "";
      const extraClass = col.cssClass ? ` ${col.cssClass}` : "";
      const cards = (col.items || []).join("");
      const hintHtml = col.hint ? `<div class="col-hint">${col.hint}</div>` : "";
      const viewAllHtml =
        col.viewAllHref && col.totalCount > (col.displayCount || 0)
          ? `<a href="${escHtml(col.viewAllHref)}" class="kanban-view-all">View all ${col.totalCount} ${escHtml(col.viewAllLabel || col.label.toLowerCase())} &rarr;</a>`
          : "";
      const bodyContent =
        totalCount === 0
          ? '<div class="col-body"><span>No items</span></div>'
          : `<div class="col-body">${cards}</div>${viewAllHtml}`;

      return `<div class="kanban-col${extraClass}${emptyClass}">
  <div class="col-header">${escHtml(col.label)} <span class="col-count">${totalCount}</span></div>
  ${hintHtml}${bodyContent}
</div>`;
    })
    .join("");

  if (totalItems > 0) {
    parts.push(`<div class="kanban">${colsHtml}</div>`);
  }

  parts.push("</div>");
  return parts.join("\n");
}

function handleProposalsPage(res, pmDir) {
  const strategyBanner = buildStrategyBanner(pmDir);
  const proposals = buildProposalRows(pmDir);

  // Collect ideas (ungroomed backlog items)
  const backlogDir = path.join(pmDir, "backlog");
  const ideas = [];
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"))) {
      const slug = file.replace(".md", "");
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      if ((data.status || "idea") === "idea") {
        ideas.push({ slug, title: data.title || humanizeSlug(slug), id: data.id || null });
      }
    }
  }

  const subtitle = [
    proposals.length > 0 ? `${proposals.length} groomed` : null,
    ideas.length > 0 ? `${ideas.length} idea${ideas.length !== 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  // Groomed card rows (HTML stays in handler)
  const groomedItems = proposals.map((p) => {
    const badgeClass =
      p.verdict === "in-progress"
        ? "badge-in-progress"
        : p.verdict === "ready"
          ? "badge-ready"
          : "badge-groomed";
    const statusLabel = p.verdictLabel || "Groomed";
    return `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="proposal-card-row">
  <div class="proposal-card-body">
    <div class="proposal-card-title">${p.id ? `<span class="proposal-id">${escHtml(p.id)}</span>` : ""}${escHtml(p.title)}</div>
    ${p.outcome ? `<div class="proposal-card-outcome">${escHtml(p.outcome)}</div>` : ""}
  </div>
  <div class="proposal-card-meta">
    <span class="badge ${badgeClass}">${escHtml(statusLabel)}</span>
    ${p.issueCount > 0 ? `<span class="issue-count">${p.issueCount} issue${p.issueCount !== 1 ? "s" : ""}</span>` : ""}
    ${p.date ? `<span class="updated">${escHtml(formatRelativeDate(p.date))}</span>` : ""}
  </div>
</a>`;
  });

  // Idea rows (HTML stays in handler)
  const ideaItems = ideas.map((i) => {
    const idHtml = i.id
      ? `<span class="idea-id">${escHtml(i.id)}</span>`
      : '<span class="idea-id"></span>';
    return `<a class="idea-row" href="/roadmap/${escHtml(encodeURIComponent(i.slug))}">${idHtml}<span class="idea-title">${escHtml(i.title)}</span></a>`;
  });

  const sections = [];
  if (groomedItems.length > 0) {
    sections.push({
      title: "Groomed",
      count: `${proposals.length} proposal${proposals.length !== 1 ? "s" : ""}`,
      items: groomedItems,
      layout: "rows",
      itemsClass: "proposal-grid",
    });
  } else if (ideaItems.length > 0) {
    // No active proposals but ideas exist — show a prompt
    sections.push({
      title: "Groomed",
      items: [
        renderEmptyState(
          "No active proposals",
          "Pick an idea below and groom it into a structured proposal with research, strategy alignment, and scoped issues.",
          "/pm:groom"
        ),
      ],
      layout: "rows",
      itemsClass: "proposal-grid",
    });
  }
  if (ideaItems.length > 0) {
    sections.push({
      title: "Ideas",
      count: `${ideas.length} ungroomed`,
      items: ideaItems,
      layout: "rows",
      itemsClass: "idea-list",
    });
  } else if (groomedItems.length > 0 || sections.length > 0) {
    sections.push({
      title: "Ideas",
      items: [
        renderEmptyState(
          "No ideas in the backlog",
          "Ideas are the raw starting point. Add one to start the grooming pipeline.",
          "/pm:groom ideate"
        ),
      ],
      layout: "rows",
      itemsClass: "idea-list",
    });
  }

  const body = renderListTemplate({
    title: "Proposals",
    subtitle: subtitle || undefined,
    contentBefore: strategyBanner || undefined,
    sections,
    emptyState: renderEmptyState(
      "No proposals yet",
      "Proposals are structured feature plans with research, strategy alignment, and scoped issues.",
      "/pm:groom",
      "Create your first proposal"
    ),
  });

  const html = dashboardPage("Proposals", "/proposals", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderBriefValue(label, value) {
  if (!value) {
    return "";
  }

  let renderedValue = escHtml(value);
  if (label === "Next" && value.startsWith("/")) {
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
      return "";
    }

    if (value.startsWith("/")) {
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

  const backlogDir = path.join(pmDir, "backlog");
  const compDir = getCompetitorsDir(pmDir);

  // Collect updated dates for staleness
  const updatedDates = {
    strategy: getUpdatedDate(path.join(pmDir, "strategy.md")),
    backlog: getNewestUpdated(path.join(pmDir, "backlog")),
  };
  const researchDates = [
    getUpdatedDate(getLandscapePath(pmDir)),
    getNewestUpdated(getCompetitorsDir(pmDir)),
    ...listResearchTopicFiles(pmDir).map((topic) => getUpdatedDate(topic.filePath)),
  ].filter(Boolean);
  updatedDates.research = researchDates.length > 0 ? researchDates.sort().pop() : null;

  const projectName = getProjectName(pmDir);

  // ===== 1. Strategy snapshot =====
  const strategyBannerHtml = buildStrategyBanner(pmDir);
  const strategySection = strategyBannerHtml
    ? `<section class="home-section">${strategyBannerHtml}</section>`
    : "";

  // ===== 2. What's coming (active proposals) =====
  // Single pass: build child-count map and collect active proposals together
  const activeProposals = [];
  const homeChildCount = {};
  const pendingProposals = []; // collect candidates, resolve counts after loop
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"))) {
      try {
        const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
        const { data } = parseFrontmatter(raw);

        // Track child → parent relationships
        if (data.parent && data.parent !== "null") {
          homeChildCount[data.parent] = (homeChildCount[data.parent] || 0) + 1;
        }

        // Collect active proposals
        if (data.prd) {
          const st = (data.status || "").toLowerCase();
          if (["proposed", "planned", "in-progress"].includes(st)) {
            const slug = file.replace(/\.md$/, "");
            const statusLabel =
              st === "in-progress"
                ? "In Progress"
                : st === "proposed"
                  ? "Ready"
                  : st === "planned"
                    ? "Planned"
                    : "Active";
            const badgeClass =
              st === "in-progress" ? "in-progress" : st === "proposed" ? "ready" : "neutral";
            pendingProposals.push({
              slug,
              id: data.id || "",
              title: data.title || humanizeSlug(slug),
              statusLabel,
              badgeClass,
              updated: data.updated || data.created || "",
            });
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  // Resolve child counts after the full scan (children may appear before parents)
  for (const p of pendingProposals) {
    p.issueCount = homeChildCount[p.slug] || 0;
    activeProposals.push(p);
  }
  activeProposals.sort((a, b) => (b.updated > a.updated ? 1 : -1));
  activeProposals.splice(5);

  const proposalsSection = `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">What's coming</span>
    <a href="/proposals" class="home-section-link">All proposals</a>
  </div>
  ${
    activeProposals.length > 0
      ? `<div class="home-proposal-list">
    ${activeProposals
      .map(
        (
          p
        ) => `<a href="/proposals/${escHtml(encodeURIComponent(p.slug))}" class="proposal-card-row">
  <div class="proposal-card-body">
    <div class="proposal-card-title">${p.id ? `<span class="proposal-id">${escHtml(p.id)}</span>` : ""}${escHtml(p.title)}</div>
  </div>
  <div class="proposal-card-meta">
    <span class="badge badge-${escHtml(p.badgeClass)}">${escHtml(p.statusLabel)}</span>
    <span class="issue-count">${p.issueCount} issue${p.issueCount !== 1 ? "s" : ""}</span>
    <span class="updated">${escHtml(formatRelativeDate(p.updated))}</span>
  </div>
</a>`
      )
      .join("")}
  </div>`
      : renderEmptyState(
          "No active proposals",
          "Groom an idea to create your next proposal.",
          "/pm:groom"
        )
  }
</section>`;

  // ===== 3. Recently shipped =====
  const recentShipped = [];
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    const allItems = {};
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const slug = file.replace(".md", "");
      allItems[slug] = { slug, ...data };
    }
    const childSlugs = new Set();
    for (const item of Object.values(allItems)) {
      if (item.parent && item.parent !== "null" && allItems[item.parent]) childSlugs.add(item.slug);
    }
    const shipped = Object.values(allItems)
      .filter((i) => i.status === "done" && !childSlugs.has(i.slug))
      .sort((a, b) => ((b.updated || b.created || "") > (a.updated || a.created || "") ? 1 : -1))
      .slice(0, 5);
    for (const s of shipped) {
      const dateStr = s.updated || s.created || "";
      recentShipped.push({
        slug: s.slug,
        title: s.title || s.slug,
        outcome: s.outcome || "",
        dateLabel: formatRelativeDate(dateStr),
      });
    }
  }

  const shippedSection =
    recentShipped.length > 0
      ? `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">Recently shipped</span>
    <a href="/roadmap/shipped" class="home-section-link">All shipped</a>
  </div>
  <div class="home-shipped-list">
    ${recentShipped
      .map(
        (s) => `<a href="/roadmap/${escHtml(encodeURIComponent(s.slug))}" class="home-shipped-item">
      <span class="home-shipped-top">
        <span class="home-shipped-title">${escHtml(s.title)}</span>
        <span class="home-shipped-date">${escHtml(s.dateLabel)}</span>
      </span>
      ${s.outcome ? `<span class="home-shipped-context">${escHtml(s.outcome)}</span>` : ""}
    </a>`
      )
      .join("")}
  </div>
</section>`
      : `
<section class="home-section">
  <div class="home-section-header">
    <span class="home-section-title">Recently shipped</span>
  </div>
  ${renderEmptyState("Nothing shipped yet", "Ship your first feature to see it here.", "/pm:dev")}
</section>`;

  // ===== 4. KB health =====
  const researchFreshness = stalenessInfo(updatedDates.research) || {
    level: "stale",
    label: "No data",
  };
  const competitorFreshness = stalenessInfo(getNewestUpdated(compDir)) || {
    level: "stale",
    label: "No data",
  };

  // Customer evidence count from research topics with source_origin internal/mixed
  let evidenceCount = 0;
  for (const topic of listResearchTopicFiles(pmDir)) {
    if (fs.existsSync(topic.filePath)) {
      const { data } = parseFrontmatter(fs.readFileSync(topic.filePath, "utf-8"));
      const origin = (data.source_origin || "").toLowerCase();
      if ((origin === "internal" || origin === "mixed") && data.evidence_count) {
        evidenceCount += parseInt(data.evidence_count, 10) || 0;
      }
    }
  }
  const evidenceFreshness =
    evidenceCount > 0
      ? { level: "fresh", label: `${evidenceCount} records` }
      : { level: "stale", label: "No evidence" };

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
    <a href="/kb" class="kb-health-card">
      <div class="kb-health-value">${evidenceCount}</div>
      <div class="kb-health-label">Customer evidence</div>
      <div class="kb-health-freshness">
        <span class="staleness-dot ${evidenceFreshness.level}"></span>
        ${escHtml(evidenceFreshness.label)}
      </div>
    </a>
  </div>
</section>`;

  const firstWorkflowActions =
    status.next === "/pm:think (explore a product idea)"
      ? `
  <div class="session-brief-actions">
    <div class="session-brief-actions-label">Good first moves</div>
    <ul>
      <li><code>/pm:think</code> to explore and pressure-test a product idea</li>
      <li><code>/pm:research landscape</code> to understand the market</li>
      <li><code>/pm:research competitors</code> to profile alternatives</li>
      <li><code>/pm:groom &lt;idea&gt;</code> if you already know what feature to scope</li>
    </ul>
  </div>`
      : "";

  const alternativeActions =
    Array.isArray(status.alternatives) && status.alternatives.length > 0
      ? `
  <div class="session-brief-actions">
    <div class="session-brief-actions-label">Also consider</div>
    <ul>
      ${status.alternatives.map((action) => `<li>${renderActionValue(action)}</li>`).join("")}
    </ul>
  </div>`
      : "";

  // Count actual ungroomed ideas (status: idea only, not drafted)
  let unrefinedIdeas = 0;
  if (fs.existsSync(backlogDir)) {
    for (const file of fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"))) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      if (data.status === "idea") unrefinedIdeas++;
    }
  }
  const pipelineLabel = `${unrefinedIdeas} ungroomed idea${unrefinedIdeas !== 1 ? "s" : ""}, ${status.counts.inProgress} active proposal${status.counts.inProgress !== 1 ? "s" : ""}`;

  const suggestedHtml = `<div class="suggested-next">
  <div class="suggested-next-label">Session brief</div>
  ${status.update.available ? renderBriefValue("Update", status.update.message) : ""}
  ${renderBriefValue("Focus", status.focus)}
  ${renderBriefValue("Pipeline", pipelineLabel)}
  ${renderBriefValue("Next", status.next)}
  ${alternativeActions}
  ${firstWorkflowActions}
</div>`;

  const proposalCount = activeProposals.length;
  const isFullyEmpty =
    !strategyBannerHtml &&
    proposalCount === 0 &&
    recentShipped.length === 0 &&
    stats.backlog === 0 &&
    stats.competitors === 0 &&
    stats.research === 0;

  let body;
  if (isFullyEmpty) {
    body = `
<div class="page-header">
  <h1>${escHtml(projectName)}</h1>
  <p class="subtitle">Product knowledge base</p>
</div>
${renderEmptyState("Your team's shared product brain", "Strategy, research, proposals, and roadmap in one place. Once content is added, you'll see project health, active sessions, and recent proposals here.", "/pm:think", "Start with an idea")}
${suggestedHtml}`;
  } else if (proposalCount === 0 && recentShipped.length === 0) {
    // Partial state: strategy/KB exists but no proposals yet
    const partialProposals = `
<section class="home-section">
  <div class="home-section-header"><span class="home-section-title">What's coming</span></div>
  ${renderEmptyState("Ready for your first feature", "Your knowledge base has content. Start grooming to create a structured proposal with research and scoped issues.", "/pm:groom")}
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

  const html = dashboardPage("Home", "/", body, projectName);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function renderSwotGrid(body) {
  const swotRe =
    /### (Strengths|Weaknesses|Opportunities|Threats)\s*\n([\s\S]*?)(?=\n### |\n## |$)/g;
  const sections = {};
  let match;
  while ((match = swotRe.exec(body)) !== null) {
    sections[match[1].toLowerCase()] = match[2].trim();
  }
  if (!sections.strengths && !sections.weaknesses) return null;

  const keys = ["strengths", "weaknesses", "opportunities", "threats"];
  const labels = {
    strengths: "Strengths",
    weaknesses: "Weaknesses",
    opportunities: "Opportunities",
    threats: "Threats",
  };
  const boxes = keys
    .map((k) => {
      const items = (sections[k] || "")
        .split("\n")
        .filter((l) => l.match(/^[-*]\s/))
        .map((l) => {
          return "<li>" + inlineMarkdown(l.replace(/^[-*]\s+/, "")) + "</li>";
        })
        .join("");
      return (
        '<div class="swot-box swot-' +
        k +
        '"><h4>' +
        labels[k] +
        "</h4><ul>" +
        (items || '<li class="swot-empty">Not yet analyzed</li>') +
        "</ul></div>"
      );
    })
    .join("");

  return '<div class="swot-grid">' + boxes + "</div>";
}

function renderProfileWithSwot(body) {
  if (body.indexOf("## SWOT Analysis") === -1) return renderMarkdown(body);

  var swotStart = body.indexOf("## SWOT Analysis");
  var beforeSwot = body.substring(0, swotStart);
  var rest = body.substring(swotStart);
  var afterSwotMatch = rest.match(/\n## (?!SWOT)[^\n]+/);
  var swotSection, afterSwot;
  if (afterSwotMatch) {
    swotSection = rest.substring(0, afterSwotMatch.index);
    afterSwot = rest.substring(afterSwotMatch.index);
  } else {
    swotSection = rest;
    afterSwot = "";
  }

  var swotGrid = renderSwotGrid(swotSection);
  return (
    renderMarkdown(beforeSwot) +
    "<h2>SWOT Analysis</h2>" +
    (swotGrid || renderMarkdown(swotSection)) +
    renderMarkdown(afterSwot)
  );
}

function renderPositioningScatter(body) {
  var posRe = /<!-- ([\w\s]+), (\d+), (\d+), (\d+), ([\w-]+) -->/g;
  var dots = [];
  var m;
  while ((m = posRe.exec(body)) !== null) {
    dots.push({
      name: m[1].trim(),
      x: parseInt(m[2]),
      y: parseInt(m[3]),
      traffic: parseInt(m[4]),
      segment: m[5],
    });
  }
  if (dots.length === 0) return null;

  var maxTraffic = Math.max.apply(
    null,
    dots.map(function (d) {
      return d.traffic || 1;
    })
  );

  var dotsHtml = dots
    .map(function (d) {
      var size =
        d.segment === "self"
          ? 16
          : Math.max(10, Math.min(40, Math.sqrt(d.traffic / maxTraffic) * 40));
      var color = SEGMENT_COLORS[d.segment] || SEGMENT_COLORS["default"];
      var cls = d.segment === "self" ? " highlight" : "";
      var yFlipped = 100 - d.y;
      return (
        '<div class="scatter-dot' +
        cls +
        '" style="left:' +
        d.x +
        "%;top:" +
        yFlipped +
        "%;width:" +
        size +
        "px;height:" +
        size +
        "px;background:" +
        color +
        ';" title="' +
        escHtml(d.name) +
        '"></div>' +
        '<div class="scatter-label" style="left:' +
        d.x +
        "%;top:calc(" +
        yFlipped +
        "% + " +
        (size / 2 + 4) +
        'px);">' +
        escHtml(d.name) +
        "</div>"
      );
    })
    .join("");

  var legendItems = Object.keys(SEGMENT_COLORS)
    .filter(function (seg) {
      return seg !== "default";
    })
    .map(function (seg) {
      return (
        '<span class="scatter-legend-item"><span class="scatter-legend-dot" style="background:' +
        SEGMENT_COLORS[seg] +
        '"></span>' +
        seg.replace(/-/g, " ").replace(/\b\w/g, function (c) {
          return c.toUpperCase();
        }) +
        "</span>"
      );
    })
    .join("");

  return (
    '<div class="scatter-container">' +
    '<div class="scatter-axis-y">Target Segment</div>' +
    '<div class="scatter-axis-label scatter-axis-label-top">Enterprise</div>' +
    '<div class="scatter-axis-label scatter-axis-label-bottom">SMB</div>' +
    '<div class="scatter-gridline scatter-gridline-h"></div>' +
    '<div class="scatter-gridline scatter-gridline-v"></div>' +
    '<div class="scatter-area">' +
    dotsHtml +
    "</div>" +
    '<div class="scatter-axis-x">Feature Specificity</div>' +
    '<div class="scatter-axis-label scatter-axis-label-bl">Vertical-specific</div>' +
    '<div class="scatter-axis-label scatter-axis-label-br">Horizontal</div>' +
    "</div>" +
    '<div class="scatter-legend">' +
    legendItems +
    "</div>"
  );
}

function renderKeywordQuadrant(body) {
  var kwSection = body.match(/### Core category keywords \(US\)\s*\n([\s\S]*?)(?=\n### |\n## |$)/);
  if (!kwSection) return null;

  var rows = kwSection[1].match(/^\|(?!\s*[-:]).+\|$/gm);
  if (!rows || rows.length < 2) return null;

  var keywords = [];
  for (var i = 1; i < rows.length; i++) {
    var cells = rows[i]
      .split("|")
      .map(function (c) {
        return c.trim();
      })
      .filter(Boolean);
    if (cells.length >= 4) {
      keywords.push({
        name: cells[0],
        volume: parseInt(cells[1]) || 0,
        difficulty: parseInt(cells[2]) || 0,
        cpc: parseFloat(cells[3].replace("$", "")) || 0,
      });
    }
  }
  if (keywords.length === 0) return null;

  var maxVol = Math.max.apply(
    null,
    keywords.map(function (k) {
      return k.volume;
    })
  );
  var maxDiff = Math.max.apply(
    null,
    keywords.map(function (k) {
      return k.difficulty;
    })
  );
  var diffMid = maxDiff / 2;
  var volMid = maxVol / 2;

  var q1 = [],
    q2 = [],
    q3 = [],
    q4 = [];
  keywords.forEach(function (kw) {
    if (kw.volume >= volMid && kw.difficulty <= diffMid) q1.push(kw);
    else if (kw.volume >= volMid && kw.difficulty > diffMid) q2.push(kw);
    else if (kw.volume < volMid && kw.difficulty <= diffMid) q3.push(kw);
    else q4.push(kw);
  });

  function renderItems(arr, cls) {
    return arr
      .map(function (kw) {
        return (
          '<span class="quadrant-item ' +
          cls +
          '" title="Vol: ' +
          kw.volume +
          " | KD: " +
          kw.difficulty +
          " | CPC: $" +
          kw.cpc.toFixed(2) +
          '">' +
          escHtml(kw.name) +
          "</span>"
        );
      })
      .join("");
  }

  return (
    '<div class="quadrant-container">' +
    '<div class="quadrant-grid">' +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Quick Wins</div><div class="quadrant-items">' +
    renderItems(q1, "quadrant-q1") +
    "</div></div>" +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Long-term Bets</div><div class="quadrant-items">' +
    renderItems(q2, "quadrant-q2") +
    "</div></div>" +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Niche Plays</div><div class="quadrant-items">' +
    renderItems(q3, "quadrant-q3") +
    "</div></div>" +
    '<div class="quadrant-cell"><div class="quadrant-cell-label">Avoid</div><div class="quadrant-items">' +
    renderItems(q4, "quadrant-q4") +
    "</div></div>" +
    "</div>" +
    '<div class="quadrant-axis-x">Difficulty &rarr;</div>' +
    "</div>"
  );
}

function renderTimeline(body) {
  var phaseRe = /<!-- phase: ([^,]+), ([^,]+), ([^,]+), ([^>]+) -->/g;
  var phases = [];
  var m;
  while ((m = phaseRe.exec(body)) !== null) {
    phases.push({
      name: m[1].trim(),
      status: m[2].trim(),
      focus: m[3]
        .trim()
        .split("|")
        .map(function (s) {
          return s.trim();
        }),
      gate: m[4].trim(),
    });
  }
  if (phases.length === 0) return null;

  var phasesHtml = phases
    .map(function (p, i) {
      var cls = p.status === "active" ? " active" : "";
      var focusHtml =
        '<ul class="timeline-phase-focus">' +
        p.focus
          .map(function (f) {
            return "<li>" + escHtml(f) + "</li>";
          })
          .join("") +
        "</ul>";
      var arrow = i < phases.length - 1 ? '<div class="timeline-arrow"></div>' : "";
      return (
        '<div class="timeline-phase' +
        cls +
        '">' +
        '<div class="timeline-phase-name">Phase ' +
        (i + 1) +
        ": " +
        escHtml(p.name) +
        "</div>" +
        focusHtml +
        '<div class="timeline-phase-gate">' +
        escHtml(p.gate) +
        "</div>" +
        arrow +
        "</div>"
      );
    })
    .join("");

  var labelsHtml = phases
    .map(function (p) {
      var badge =
        p.status === "active"
          ? '<span class="badge badge-fresh">Active</span>'
          : '<span class="badge">Planned</span>';
      return '<div class="timeline-label">' + badge + "</div>";
    })
    .join("");

  return (
    '<div class="timeline-container">' +
    '<div class="timeline-track">' +
    phasesHtml +
    "</div>" +
    '<div class="timeline-labels">' +
    labelsHtml +
    "</div>" +
    "</div>"
  );
}

function renderStrategyWithViz(body) {
  var roadmapRe = /## 10\. Execution Roadmap\s*\n([\s\S]*?)(?=\n## \d|$)/;
  var roadmapMatch = body.match(roadmapRe);
  if (roadmapMatch) {
    var timeline = renderTimeline(roadmapMatch[1]);
    if (timeline) {
      var before = body.substring(0, roadmapMatch.index);
      var after = body.substring(roadmapMatch.index + roadmapMatch[0].length);
      body =
        before +
        "## 10. Execution Roadmap\n\n<!-- VIZ_PLACEHOLDER_TIMELINE -->\n" +
        roadmapMatch[1].replace(/<!-- phase:[^>]+-->\n?/g, "") +
        after;
      var html = renderMarkdown(body);
      html = html.replace("<!-- VIZ_PLACEHOLDER_TIMELINE -->", timeline);
      return html;
    }
  }
  return renderMarkdown(body);
}

function renderSentimentGap(compDir, slugs) {
  var competitors = [];
  slugs.forEach(function (slug) {
    var sentimentPath = path.join(compDir, slug, "sentiment.md");
    if (!fs.existsSync(sentimentPath)) return;
    var raw = fs.readFileSync(sentimentPath, "utf-8");
    var parsed = parseFrontmatter(raw);
    var name = parsed.data.company || humanizeSlug(slug);

    // Extract ratings from the ratings table
    var b2bRating = null;
    var iosRating = null;
    var androidRating = null;

    var tableRows = parsed.body.match(/^\|[^|]+\|[^|]+\|[^|]+\|.*\|$/gm);
    if (tableRows) {
      tableRows.forEach(function (row) {
        var cells = row
          .split("|")
          .map(function (c) {
            return c.trim();
          })
          .filter(Boolean);
        if (cells.length < 2) return;
        var platform = cells[0].toLowerCase();
        var ratingMatch = cells[1].match(/([\d.]+)\s*\/\s*5/);
        if (!ratingMatch) return;
        var rating = parseFloat(ratingMatch[1]);
        if (
          platform.indexOf("capterra") !== -1 ||
          platform.indexOf("g2") !== -1 ||
          platform.indexOf("getapp") !== -1
        ) {
          if (!b2bRating || rating > b2bRating) b2bRating = rating;
        }
        if (platform.indexOf("apple") !== -1 || platform.indexOf("ios") !== -1) {
          if (platform.indexOf("legacy") === -1) {
            if (!iosRating || rating < iosRating) iosRating = rating;
          }
        }
        if (platform.indexOf("google") !== -1 || platform.indexOf("android") !== -1) {
          androidRating = rating;
        }
      });
    }

    if (b2bRating || iosRating || androidRating) {
      competitors.push({ name: name, b2b: b2bRating, ios: iosRating, android: androidRating });
    }
  });

  if (competitors.length === 0) return "";

  var groups = competitors
    .map(function (comp) {
      var rows = "";
      function barRow(label, value, colorCls) {
        if (!value) return "";
        var pct = (value / 5) * 100;
        return (
          '<div class="bar-row">' +
          '<div class="bar-row-label">' +
          label +
          "</div>" +
          '<div class="bar-track"><div class="bar-fill ' +
          colorCls +
          '" style="width:' +
          pct +
          '%">' +
          value.toFixed(1) +
          "</div></div>" +
          "</div>"
        );
      }
      rows += barRow("B2B Reviews", comp.b2b, "bar-fill-blue");
      rows += barRow(
        "iOS App Store",
        comp.ios,
        comp.ios >= 4.0 ? "bar-fill-green" : comp.ios >= 3.0 ? "bar-fill-yellow" : "bar-fill-red"
      );
      rows += barRow(
        "Google Play",
        comp.android,
        comp.android >= 4.0
          ? "bar-fill-green"
          : comp.android >= 3.0
            ? "bar-fill-yellow"
            : "bar-fill-red"
      );

      var gap = "";
      var mobileAvg = null;
      if (comp.ios && comp.android) mobileAvg = (comp.ios + comp.android) / 2;
      else if (comp.ios) mobileAvg = comp.ios;
      else if (comp.android) mobileAvg = comp.android;
      if (comp.b2b && mobileAvg) {
        var diff = comp.b2b - mobileAvg;
        if (diff > 0.3) {
          gap = ' <span class="badge badge-stale">Gap: ' + diff.toFixed(1) + "</span>";
        }
      }

      return (
        '<div class="bar-group"><div class="bar-group-label">' +
        escHtml(comp.name) +
        gap +
        "</div>" +
        rows +
        "</div>"
      );
    })
    .join("");

  return (
    '<section class="content-section"><h2>User Satisfaction Gap Analysis</h2>' +
    '<p class="chart-description">B2B review ratings (manager perspective) vs. app store ratings (field worker perspective). The gap reveals mobile app quality issues.</p>' +
    '<div class="bar-chart">' +
    groups +
    "</div></section>"
  );
}

function renderSeoComparison(compDir, slugs) {
  var competitors = [];
  slugs.forEach(function (slug) {
    var seoPath = path.join(compDir, slug, "seo.md");
    var profilePath = path.join(compDir, slug, "profile.md");
    var name = humanizeSlug(slug);

    // Try profile first for company name
    if (fs.existsSync(profilePath)) {
      var profRaw = fs.readFileSync(profilePath, "utf-8");
      var profParsed = parseFrontmatter(profRaw);
      if (profParsed.data.company) name = profParsed.data.company;
    }

    // Extract SEO data from seo.md or profile.md (some have inline SEO tables)
    var source = null;
    if (fs.existsSync(seoPath)) {
      source = fs.readFileSync(seoPath, "utf-8");
    } else if (fs.existsSync(profilePath)) {
      var raw = fs.readFileSync(profilePath, "utf-8");
      if (raw.indexOf("Domain Rating") !== -1) source = raw;
    }
    if (!source) return;

    var dr = null,
      traffic = null,
      keywords = null,
      top3 = null,
      trafficValue = null;
    var tableRows = source.match(/^\|[^|]+\|[^|]+\|$/gm);
    if (tableRows) {
      tableRows.forEach(function (row) {
        var cells = row
          .split("|")
          .map(function (c) {
            return c.trim();
          })
          .filter(Boolean);
        if (cells.length < 2) return;
        var metric = cells[0].toLowerCase();
        var val = cells[1].replace(/[,$]/g, "").replace(/\/mo$/, "");
        if (metric.indexOf("domain rating") !== -1) dr = parseInt(val) || null;
        if (metric.indexOf("organic traffic") !== -1 && metric.indexOf("value") === -1)
          traffic = parseInt(val) || null;
        if (metric.indexOf("organic keywords") !== -1) {
          var kwMatch = val.match(/^(\d+)/);
          keywords = kwMatch ? parseInt(kwMatch[1]) : null;
        }
        if (metric.indexOf("top 3") !== -1) top3 = parseInt(val) || null;
        if (metric.indexOf("traffic value") !== -1) trafficValue = parseInt(val) || null;
      });
    }

    if (dr || traffic) {
      competitors.push({
        name: name,
        dr: dr,
        traffic: traffic,
        keywords: keywords,
        top3: top3,
        trafficValue: trafficValue,
      });
    }
  });

  if (competitors.length === 0) return "";

  // Sort by DR descending
  competitors.sort(function (a, b) {
    return (b.dr || 0) - (a.dr || 0);
  });

  var maxDr = Math.max.apply(
    null,
    competitors.map(function (c) {
      return c.dr || 0;
    })
  );
  var maxTraffic = Math.max.apply(
    null,
    competitors.map(function (c) {
      return c.traffic || 0;
    })
  );

  var rows = competitors
    .map(function (comp) {
      var drPct = maxDr > 0 ? ((comp.dr || 0) / 100) * 100 : 0;
      var trafficPct = maxTraffic > 0 ? ((comp.traffic || 0) / maxTraffic) * 100 : 0;

      var drBar =
        '<div class="bar-row">' +
        '<div class="bar-row-label">DR</div>' +
        '<div class="bar-track"><div class="bar-fill bar-fill-teal" style="width:' +
        drPct +
        '%">' +
        (comp.dr || "-") +
        "</div></div>" +
        "</div>";
      var trafficBar =
        '<div class="bar-row">' +
        '<div class="bar-row-label">Traffic/mo</div>' +
        '<div class="bar-track"><div class="bar-fill bar-fill-blue" style="width:' +
        trafficPct +
        '%">' +
        (comp.traffic ? comp.traffic.toLocaleString() : "-") +
        "</div></div>" +
        "</div>";

      var meta = [];
      if (comp.keywords) meta.push(comp.keywords + " keywords");
      if (comp.top3) meta.push(comp.top3 + " in top 3");
      if (comp.trafficValue) meta.push("$" + comp.trafficValue.toLocaleString() + "/mo value");
      var metaHtml =
        meta.length > 0 ? '<div class="bar-group-meta">' + meta.join(" \u00b7 ") + "</div>" : "";

      return (
        '<div class="bar-group"><div class="bar-group-label">' +
        escHtml(comp.name) +
        "</div>" +
        drBar +
        trafficBar +
        metaHtml +
        "</div>"
      );
    })
    .join("");

  return (
    '<section class="content-section"><h2>SEO Competitive Position</h2>' +
    '<p class="chart-description">Domain authority and organic traffic comparison. Higher DR = harder to outrank.</p>' +
    '<div class="bar-chart">' +
    rows +
    "</div></section>"
  );
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

    var headers = rows[0]
      .split("|")
      .map(function (c) {
        return c.trim();
      })
      .filter(Boolean);
    var features = [];
    for (var i = 1; i < rows.length; i++) {
      var cells = rows[i]
        .split("|")
        .map(function (c) {
          return c.trim();
        })
        .filter(Boolean);
      if (cells.length >= 2) features.push(cells);
    }
    pillars.push({ name: pillarName, headers: headers, features: features });
  }

  if (pillars.length === 0) return renderMarkdown(body);

  var ratingClass = function (val) {
    var v = val.toLowerCase();
    if (v === "full") return "heatmap-full";
    if (v === "partial") return "heatmap-partial";
    if (v === "missing") return "heatmap-missing";
    if (v === "differentiator") return "heatmap-diff";
    return "";
  };

  var ratingLabel = function (val) {
    var v = val.toLowerCase();
    if (v === "full") return "\u2713";
    if (v === "partial") return "\u00BD";
    if (v === "missing") return "\u2717";
    if (v === "differentiator") return "\u2605";
    return escHtml(val);
  };

  // Build single unified table
  var allHeaders = pillars[0].headers;
  var colHeaders = allHeaders
    .slice(1)
    .map(function (h) {
      return "<th>" + escHtml(h) + "</th>";
    })
    .join("");
  var tableRows = "";

  pillars.forEach(function (p) {
    tableRows +=
      '<tr><td colspan="' +
      allHeaders.length +
      '" class="heatmap-pillar">' +
      escHtml(p.name) +
      "</td></tr>";
    p.features.forEach(function (row) {
      var cells = "<td>" + escHtml(row[0]) + "</td>";
      for (var j = 1; j < row.length; j++) {
        var cls = ratingClass(row[j]);
        cells += '<td class="' + cls + '">' + ratingLabel(row[j]) + "</td>";
      }
      tableRows += "<tr>" + cells + "</tr>";
    });
  });

  return (
    "<h2>Feature Parity Matrix</h2>" +
    '<div class="heatmap-legend">' +
    '<span class="heatmap-full heatmap-legend-badge">\u2713 Full</span>' +
    '<span class="heatmap-partial heatmap-legend-badge">\u00BD Partial</span>' +
    '<span class="heatmap-missing heatmap-legend-badge">\u2717 Missing</span>' +
    '<span class="heatmap-diff heatmap-legend-badge">\u2605 Differentiator</span>' +
    "</div>" +
    '<table class="heatmap-table"><thead><tr><th>Capability</th>' +
    colHeaders +
    "</tr></thead><tbody>" +
    tableRows +
    "</tbody></table>"
  );
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
      body = before + "## Market Positioning Map\n\n<!-- VIZ_PLACEHOLDER_SCATTER -->\n" + after;
    }
  }

  // Replace keyword section with quadrant chart
  var kwRe = /### Core category keywords \(US\)\s*\n([\s\S]*?)(?=\n### |\n## |$)/;
  var kwMatch = body.match(kwRe);
  var kwQuadrant = kwMatch ? renderKeywordQuadrant(body) : null;
  if (kwQuadrant && kwMatch) {
    var kwBefore = body.substring(0, kwMatch.index);
    var kwAfter = body.substring(kwMatch.index + kwMatch[0].length);
    body =
      kwBefore +
      "### Keyword Opportunity Matrix (US)\n\n<!-- VIZ_PLACEHOLDER_KEYWORDS -->\n" +
      kwAfter;
  }

  var html = renderMarkdown(body);

  // Inject visualizations
  if (posMatch) {
    var scatterPlot = renderPositioningScatter(posMatch[1]);
    if (scatterPlot) html = html.replace("<!-- VIZ_PLACEHOLDER_SCATTER -->", scatterPlot);
  }
  if (kwQuadrant) {
    html = html.replace("<!-- VIZ_PLACEHOLDER_KEYWORDS -->", kwQuadrant);
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

// ========== KB Hub Helpers (PM-122) ==========

function buildStrategyBanner(pmDir) {
  const snapshot = parseStrategySnapshot(pmDir);
  if (!snapshot) return "";
  const deckExists = fs.existsSync(path.join(pmDir, "strategy-deck.html"));
  return `<div class="strategy-banner">
  <div class="strategy-banner-content">
    <div class="strategy-banner-label">Strategy</div>
    <div class="strategy-banner-headline">${escHtml(snapshot.focus)}</div>
    <div class="strategy-banner-priorities">
      ${snapshot.priorities.map((p, i) => `<div class="strategy-banner-priority"><span class="priority-num">${i + 1}</span> ${escHtml(p)}</div>`).join("")}
    </div>
  </div>
  <div class="strategy-banner-actions">
    <div class="strategy-banner-meta">
      <span class="staleness-dot ${snapshot.staleness.level}"></span>
      ${escHtml(snapshot.staleness.label)}
    </div>
    <a href="/kb?tab=strategy" class="btn-sm">View strategy</a>
    ${deckExists ? '<a href="/strategy-deck" class="btn-sm">Slide deck</a>' : ""}
  </div>
</div>`;
}

function buildTopicRows(pmDir, maxTopics) {
  const topics = listResearchTopicFiles(pmDir);
  if (topics.length === 0) return { html: "", total: 0 };

  const topicData = topics.map(({ slug, filePath }) => {
    let label = humanizeSlug(slug);
    let origin = "external";
    let stale = null;
    let dateStr = "";
    if (fs.existsSync(filePath)) {
      const parsed = parseFrontmatter(fs.readFileSync(filePath, "utf-8"));
      const meta = buildTopicMeta(slug, parsed.data, filePath);
      label = meta.label;
      origin = normalizeSourceOrigin(parsed.data.source_origin);
      dateStr = getUpdatedDate(filePath) || "";
      stale = stalenessInfo(dateStr);
    }
    return { slug, label, origin, stale, dateStr };
  });

  // Sort by freshness (newest first)
  topicData.sort((a, b) => (b.dateStr || "").localeCompare(a.dateStr || ""));
  const display = maxTopics ? topicData.slice(0, maxTopics) : topicData;

  const originLabels = { external: "External", internal: "Customer", mixed: "Mixed" };
  const originBadge = (o) => `badge-${o === "internal" ? "customer" : o}`;
  const freshBadge = (s) =>
    s
      ? `<span class="badge badge-${s.level}">${s.level.charAt(0).toUpperCase() + s.level.slice(1)}</span>`
      : "";

  const rows = display
    .map(
      (t) => `<a href="/evidence/research/${escHtml(t.slug)}" class="topic-row">
  <span class="topic-name">${escHtml(t.label)}</span>
  <div class="topic-badges">
    <span class="badge ${originBadge(t.origin)}">${escHtml(originLabels[t.origin] || "External")}</span>
    ${freshBadge(t.stale)}
    <span class="topic-date">${escHtml(formatRelativeDate(t.dateStr))}</span>
  </div>
</a>`
    )
    .join("");

  return { html: `<div class="topic-list">${rows}</div>`, total: topicData.length };
}

function buildKbDomainSection(pmDir, domain) {
  const domainDir = path.dirname(domain.indexPath);
  const label = humanizeSlug(domain.slug);

  if (domain.slug === "competitors") {
    const slugs = fs
      .readdirSync(domainDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    if (slugs.length === 0) {
      return `<div class="kb-domain-section">
  <div class="section-header"><span class="section-title">${escHtml(label)}</span></div>
  ${renderEmptyState("No competitor profiles yet", "Research competitors to build profiles.", "/pm:research competitors")}
</div>`;
    }
    const preview = slugs.slice(0, 3);
    const cards = preview
      .map((slug) => {
        const profilePath = path.join(domainDir, slug, "profile.md");
        let name = humanizeSlug(slug);
        let category = "";
        if (fs.existsSync(profilePath)) {
          const raw = fs.readFileSync(profilePath, "utf-8");
          const parsed = parseFrontmatter(raw);
          if (parsed.data.company) name = parsed.data.company;
          const summary = extractProfileSummary(parsed.body);
          if (summary.company) name = summary.company;
          if (summary.category) category = summary.category;
        }
        return `<article class="card">
  <h3><a href="/insights/competitors/${escHtml(slug)}">${escHtml(name)}</a></h3>
  <p class="meta">${escHtml(category)}</p>
  <div class="card-footer"><a href="/insights/competitors/${escHtml(slug)}" class="view-link">View &rarr;</a></div>
</article>`;
      })
      .join("");
    const viewAll =
      slugs.length > 3
        ? `<div class="view-all-wrap"><a href="/insights/competitors" class="section-link">View all ${slugs.length} profiles</a></div>`
        : "";
    return `<div class="kb-domain-section">
  <div class="section-header">
    <span class="section-title">${escHtml(label)}</span>
    <span class="section-count">${slugs.length} profile${slugs.length !== 1 ? "s" : ""}</span>
  </div>
  <div class="card-grid">${cards}</div>
  ${viewAll}
</div>`;
  }

  // Generic insight domain (product, business, custom)
  const files = fs
    .readdirSync(domainDir, { withFileTypes: true })
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md" && e.name !== "log.md"
    );
  if (files.length === 0) {
    const hint = domain.slug === "product" ? "/pm:research" : "/pm:research";
    return `<div class="kb-domain-section">
  <div class="section-header"><span class="section-title">${escHtml(label)}</span></div>
  ${renderEmptyState("No " + label.toLowerCase() + " insights yet", "Run research or groom features to synthesize insights here.", hint)}
</div>`;
  }
  const preview = files.slice(0, 3);
  const cards = preview
    .map((f) => {
      const filePath = path.join(domainDir, f.name);
      const raw = fs.readFileSync(filePath, "utf-8");
      const { data, body } = parseFrontmatter(raw);
      const title = extractMarkdownTitle(body, humanizeSlug(f.name.replace(".md", "")));
      const summary = extractMarkdownSummary(body, 120);
      const stale = stalenessInfo(getUpdatedDate(filePath));
      const slug = f.name.replace(".md", "");
      return `<article class="card">
  <h3><a href="/insights/${escHtml(domain.slug)}/${escHtml(slug)}">${escHtml(title)}</a></h3>
  <p class="meta">${escHtml(summary)}</p>
  <div class="card-footer">
    ${stale ? `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>` : ""}
    <a href="/insights/${escHtml(domain.slug)}/${escHtml(slug)}" class="view-link">View &rarr;</a>
  </div>
</article>`;
    })
    .join("");
  const viewAll =
    files.length > 3
      ? `<div class="view-all-wrap"><a href="/insights/${escHtml(domain.slug)}" class="section-link">View all ${files.length} topics</a></div>`
      : "";
  return `<div class="kb-domain-section">
  <div class="section-header">
    <span class="section-title">${escHtml(label)}</span>
    <span class="section-count">${files.length} topic${files.length !== 1 ? "s" : ""}</span>
  </div>
  <div class="card-grid">${cards}</div>
  ${viewAll}
</div>`;
}

function buildKbEvidenceSection(pmDir, subdir) {
  const evidenceDir = path.join(pmDir, "evidence", subdir);
  const label = humanizeSlug(subdir);
  if (!fs.existsSync(evidenceDir)) {
    return `<div class="kb-domain-section">
  <div class="section-header"><span class="section-title">${escHtml(label)}</span></div>
  ${renderEmptyState("No " + label.toLowerCase() + " yet", "Import evidence to populate this section.", "/pm:ingest")}
</div>`;
  }
  const files = fs
    .readdirSync(evidenceDir, { withFileTypes: true })
    .filter(
      (e) => e.isFile() && e.name.endsWith(".md") && e.name !== "index.md" && e.name !== "log.md"
    );
  if (files.length === 0) {
    const commands = {
      research: "/pm:research",
      transcripts: "/pm:ingest",
      "user-feedback": "/pm:ingest",
    };
    return `<div class="kb-domain-section">
  <div class="section-header"><span class="section-title">${escHtml(label)}</span></div>
  ${renderEmptyState("No " + label.toLowerCase() + " yet", "Import evidence to populate this section.", commands[subdir] || "/pm:ingest")}
</div>`;
  }

  // Sort by freshness
  const sorted = files
    .map((f) => {
      const filePath = path.join(evidenceDir, f.name);
      const dateStr = getUpdatedDate(filePath) || "";
      return { name: f.name, filePath, dateStr };
    })
    .sort((a, b) => (b.dateStr || "").localeCompare(a.dateStr || ""));

  const preview = sorted.slice(0, 3);
  const cards = preview
    .map((f) => {
      const raw = fs.readFileSync(f.filePath, "utf-8");
      const { data, body } = parseFrontmatter(raw);
      const slug = f.name.replace(".md", "");
      const title = data.topic || extractMarkdownTitle(body, humanizeSlug(slug));
      const summary = extractMarkdownSummary(body, 120);
      const stale = stalenessInfo(f.dateStr);
      return `<article class="card">
  <h3><a href="/evidence/${escHtml(subdir)}/${escHtml(slug)}">${escHtml(title)}</a></h3>
  <p class="meta">${escHtml(summary)}</p>
  <div class="card-footer">
    ${stale ? `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>` : ""}
    <a href="/evidence/${escHtml(subdir)}/${escHtml(slug)}" class="view-link">View &rarr;</a>
  </div>
</article>`;
    })
    .join("");
  const viewAll =
    sorted.length > 3
      ? `<div class="view-all-wrap"><a href="/evidence/${escHtml(subdir)}" class="section-link">View all ${sorted.length} items</a></div>`
      : "";
  return `<div class="kb-domain-section">
  <div class="section-header">
    <span class="section-title">${escHtml(label)}</span>
    <span class="section-count">${sorted.length} item${sorted.length !== 1 ? "s" : ""}</span>
  </div>
  <div class="card-grid">${cards}</div>
  ${viewAll}
</div>`;
}

function handleKnowledgeBasePage(res, pmDir, tab) {
  // If a specific sub-tab is requested, render the existing detail view
  if (tab === "strategy") {
    return handleKbStrategyDetail(res, pmDir);
  }
  if (tab === "competitors") {
    return handleKbCompetitorsDetail(res, pmDir);
  }
  if (tab === "landscape") {
    return handleKbLandscapeDetail(res, pmDir);
  }
  if (tab === "topics" || tab === "research") {
    return handleKbTopicsDetail(res, pmDir);
  }

  // Hub page -- two tabs: Insights and Evidence
  // Each tab has domain subsections with 3-card previews

  // Build Insights tab content
  const insightDomains = listInsightDomains(pmDir);
  const insightSections = insightDomains
    .map((domain) => buildKbDomainSection(pmDir, domain))
    .join("");
  const insightsHtml =
    insightSections ||
    renderEmptyState(
      "No insight domains yet",
      "Run research to start building your knowledge base.",
      "/pm:research"
    );

  // Build Evidence tab content
  const evidenceSubdirs = ["research", "transcripts", "user-feedback"];
  const evidenceHtml = evidenceSubdirs
    .map((subdir) => buildKbEvidenceSection(pmDir, subdir))
    .join("");

  // Build Notes tab content
  const notesHtml = buildNotesContent(pmDir);

  const prefix = "kb" + _tabCounter++;

  const body = `
<div class="page-header">
  <h1>Knowledge Base</h1>
  <p class="subtitle">Everything the team knows -- market, competitors, and research</p>
</div>
<div class="detail-page">
  <div class="tabs" role="tablist">
    <div class="tab active" role="tab" tabindex="0" aria-selected="true" data-tab="${prefix}-insights" onclick="${prefix}Switch(this,'${prefix}-insights')" onkeydown="${prefix}Key(event,this,'${prefix}-insights')">Insights</div>
    <div class="tab" role="tab" tabindex="0" aria-selected="false" data-tab="${prefix}-evidence" onclick="${prefix}Switch(this,'${prefix}-evidence')" onkeydown="${prefix}Key(event,this,'${prefix}-evidence')">Evidence</div>
    <div class="tab" role="tab" tabindex="0" aria-selected="false" data-tab="notes" onclick="${prefix}Switch(this,'notes')" onkeydown="${prefix}Key(event,this,'notes')">Notes</div>
  </div>
  <div id="${prefix}-insights" class="tab-panel active" role="tabpanel">${insightsHtml}</div>
  <div id="${prefix}-evidence" class="tab-panel" role="tabpanel">${evidenceHtml}</div>
  <div id="notes" class="tab-panel" role="tabpanel">${notesHtml}</div>
</div>
<script>
function ${prefix}Switch(el, panelId) {
  el.closest('.detail-page').querySelectorAll('.tabs .tab').forEach(function(t) { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
  el.closest('.detail-page').querySelectorAll('.tab-panel').forEach(function(p) { p.classList.remove('active'); });
  el.classList.add('active');
  el.setAttribute('aria-selected','true');
  document.getElementById(panelId).classList.add('active');
  history.replaceState(null, '', '#' + el.getAttribute('data-tab'));
}
function ${prefix}Key(e, el, panelId) {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ${prefix}Switch(el, panelId); }
  if (e.key === 'ArrowRight') { var next = el.nextElementSibling; if (next) { next.focus(); next.click(); } }
  if (e.key === 'ArrowLeft') { var prev = el.previousElementSibling; if (prev) { prev.focus(); prev.click(); } }
}
(function() {
  var hash = location.hash.slice(1);
  if (hash && /^[a-zA-Z0-9_-]+$/.test(hash)) {
    var tab = document.querySelector('.tab[data-tab="' + hash + '"]');
    if (tab) ${prefix}Switch(tab, hash);
  }
})();
</script>`;

  const html = dashboardPage("Knowledge Base", "/kb", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

// ========== KB Detail Handlers (PM-122) ==========

function handleKbStrategyDetail(res, pmDir) {
  const filePath = path.join(pmDir, "strategy.md");
  let contentHtml;
  if (!fs.existsSync(filePath)) {
    contentHtml =
      `<div class="detail-page">
<nav class="detail-breadcrumb"><a href="/kb">Knowledge Base</a></nav>
<h1>Strategy</h1>
</div>` +
      renderEmptyState(
        "No strategy defined",
        "Your product strategy defines ICP, value proposition, competitive positioning, and priorities.",
        "/pm:strategy",
        "Define your strategy"
      );
  } else {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);
    const rendered = renderStrategyWithViz(parsed.body);
    contentHtml = `<div class="detail-page">
<nav class="detail-breadcrumb"><a href="/kb">Knowledge Base</a></nav>
<h1>Strategy</h1>
<div class="markdown-body">${rendered}</div>
</div>`;
  }
  const html = dashboardPage("Strategy", "/kb", contentHtml);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleKbCompetitorsDetail(res, pmDir) {
  const compDir = getCompetitorsDir(pmDir);
  const cardItems = [];
  if (fs.existsSync(compDir)) {
    const dirs = fs.readdirSync(compDir, { withFileTypes: true }).filter((e) => e.isDirectory());
    for (const d of dirs) {
      const profilePath = path.join(compDir, d.name, "profile.md");
      if (!fs.existsSync(profilePath)) continue;
      const summary = extractProfileSummary(
        parseFrontmatter(fs.readFileSync(profilePath, "utf-8")).body
      );
      const stale = stalenessInfo(getUpdatedDate(profilePath));
      const staleBadge = stale
        ? `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`
        : "";
      cardItems.push(`<article class="card">
        <h3><a href="/insights/competitors/${escHtml(d.name)}">${escHtml(summary.company || humanizeSlug(d.name))}</a></h3>
        <p class="meta">${escHtml(summary.category || "")}</p>
        <div class="card-footer">${staleBadge}<a href="/insights/competitors/${escHtml(d.name)}" class="view-link">View &rarr;</a></div>
      </article>`);
    }
  }
  const searchBar =
    cardItems.length > 0
      ? `<div class="kb-search">
  <input type="text" class="kb-search-input" placeholder="Filter competitors..." oninput="kbFilter(this.value)">
</div>
<script>
function kbFilter(q) {
  var cards = document.querySelectorAll('.card-grid .card');
  var lower = q.toLowerCase();
  var visible = 0;
  cards.forEach(function(card) {
    var text = card.textContent.toLowerCase();
    var match = !q || text.indexOf(lower) !== -1;
    card.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  var empty = document.getElementById('kb-no-results');
  if (empty) empty.style.display = visible === 0 ? 'block' : 'none';
}
</script>
<div id="kb-no-results" class="empty-state" style="display:none"><h2>No matches</h2><p>Try a different search term.</p></div>`
      : "";
  const contentHtml = renderListTemplate({
    breadcrumb: '<a href="/kb">&larr; Knowledge Base</a>',
    title: "Competitors",
    contentBefore: searchBar,
    sections: [{ items: cardItems, layout: "cards" }],
    emptyState: renderEmptyState(
      "No competitor profiles",
      "Competitor profiles cover features, pricing, API, SEO, and user sentiment for each rival.",
      "/pm:research competitors",
      "Profile your competitors"
    ),
  });
  const html = dashboardPage("Competitors", "/kb", contentHtml);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleKbLandscapeDetail(res, pmDir) {
  const landscapePath = getLandscapePath(pmDir);
  if (!fs.existsSync(landscapePath)) {
    const emptyHtml = renderEmptyState(
      "No landscape research",
      "The landscape maps your market \u2014 TAM/SAM/SOM, market trends, and positioning opportunities.",
      "/pm:research landscape",
      "Map your market"
    );
    const html = dashboardPage("Landscape", "/kb", emptyHtml);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(landscapePath, "utf-8");
  const { body } = parseFrontmatter(raw);
  const statsData = parseStatsData(body);
  const statsHtml = renderStatsCards(statsData);

  // Split body into sections by ## headings
  const sectionTabs = [];
  const parts = body.split(/^(?=## )/m);
  for (const part of parts) {
    const h2Match = part.match(/^## (.+)$/m);
    if (!h2Match) continue;
    const label = h2Match[1].replace(/[*_`#]/g, "").trim();
    const id = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let rendered = renderLandscapeWithViz(part);
    sectionTabs.push({ id, label, rendered });
  }

  // Inject stats cards into the first tab if available
  if (statsHtml && sectionTabs.length > 0) {
    sectionTabs[0].rendered = statsHtml + sectionTabs[0].rendered;
  }

  // Build meta badges
  const metaBadges = [];
  const stale = stalenessInfo(getUpdatedDate(landscapePath));
  if (stale) {
    metaBadges.push({
      html: `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`,
    });
  }
  metaBadges.push({ html: `<span class="meta-item">${sectionTabs.length} sections</span>` });

  const contentHtml = renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb", label: "Knowledge Base" }, { label: "Market Landscape" }],
    title: "Market Landscape",
    metaBadges,
    tabs: sectionTabs.map((s) => ({ id: s.id, label: s.label, html: s.rendered })),
    actionHint: "/pm:research landscape",
  });

  const html = dashboardPage("Landscape", "/kb", contentHtml);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleKbTopicsDetail(res, pmDir) {
  const { html: topicRows, total: topicCount } = buildTopicRows(pmDir, null);

  const body = `
<div class="page-header">
  <div class="breadcrumb"><a href="/kb">&larr; Knowledge Base</a></div>
  <h1>Research</h1>
  <p class="subtitle">${topicCount} topic${topicCount !== 1 ? "s" : ""}</p>
</div>
${
  topicCount > 0
    ? `<section class="section">
  ${topicRows}
</section>`
    : renderEmptyState(
        "No research topics",
        "Run research to build your knowledge base.",
        "/pm:research",
        "Start research"
      )
}`;

  const html = dashboardPage("Research", "/kb", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleCompetitorDetail(res, pmDir, slug) {
  const compDir = path.join(getCompetitorsDir(pmDir), slug);
  if (!fs.existsSync(compDir)) {
    const html = dashboardPage(
      "Not Found",
      "/kb",
      renderEmptyState(
        "Competitor not found",
        'This competitor profile does not exist.<br><br><a href="/insights/competitors" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
      )
    );
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const sectionKeys = ["profile", "features", "api", "seo", "sentiment"];
  const SECTION_LABELS = {
    profile: "Profile",
    features: "Features",
    api: "API",
    seo: "SEO",
    sentiment: "Sentiment",
  };
  let name = slug;
  let category = "";
  let profileUpdatedDate = null;

  // Build tab sections
  const sectionTabs = [];
  let availableCount = 0;
  sectionKeys.forEach((sec) => {
    const filePath = path.join(compDir, sec + ".md");
    if (!fs.existsSync(filePath)) return;
    availableCount++;
    const raw = fs.readFileSync(filePath, "utf-8");
    const { data, body } = parseFrontmatter(raw);
    if (sec === "profile") {
      if (data.company) name = data.company;
      else if (data.name) name = data.name;
      const summary = extractProfileSummary(body);
      if (summary.category) category = summary.category;
      profileUpdatedDate = data.updated || data.created || null;
    }
    const label = SECTION_LABELS[sec] || sec.charAt(0).toUpperCase() + sec.slice(1);
    const rendered = sec === "profile" ? renderProfileWithSwot(body) : renderMarkdown(body);
    sectionTabs.push({ id: sec, label, rendered });
  });

  // Build meta badges
  const metaBadges = [];
  if (category) {
    const truncated = category.length > 80 ? category.slice(0, 80).trim() + "\u2026" : category;
    metaBadges.push({ html: `<span class="meta-item">${escHtml(truncated)}</span>` });
  }
  metaBadges.push({
    html: `<span class="meta-item">${availableCount}/${sectionKeys.length} sections</span>`,
  });
  const stale = stalenessInfo(profileUpdatedDate);
  if (stale) {
    metaBadges.push({
      html: `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`,
    });
  }

  const body = renderTemplate("detail-tabs", {
    breadcrumb: [{ href: "/kb?tab=competitors", label: "Knowledge Base" }, { label: name }],
    title: name,
    metaBadges,
    tabs: sectionTabs.map((s) => ({ id: s.id, label: s.label, html: s.rendered })),
    actionHint: "/pm:refresh " + slug,
  });

  const html = dashboardPage(name, "/kb", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleResearchTopic(res, pmDir, topic) {
  const findingsPath = getTopicFilePath(pmDir, topic);

  if (!fs.existsSync(findingsPath)) {
    const html = dashboardPage(
      "Not Found",
      "/kb",
      renderEmptyState(
        "Research topic not found",
        'This research topic does not exist.<br><br><a href="/evidence/research" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
      )
    );
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(findingsPath, "utf-8");
  const { data, body } = parseFrontmatter(raw);
  const meta = buildTopicMeta(topic, data, findingsPath);

  // Split body into main findings and sources/references
  const sourcesRe = /\n## (?:Sources|References)\s*\n/;
  const sourcesMatch = body.match(sourcesRe);
  let findingsBody = body;
  let sourcesBody = "";
  if (sourcesMatch) {
    findingsBody = body.substring(0, sourcesMatch.index);
    sourcesBody = body.substring(sourcesMatch.index + sourcesMatch[0].length);
  }

  // Strip leading h1 if it duplicates the page title
  findingsBody = findingsBody.replace(/^\s*#\s+.+\n+/, "");

  // Rewrite pm/ relative links to dashboard routes
  findingsBody = rewriteKnowledgeBaseLinks(findingsBody);
  if (sourcesBody) sourcesBody = rewriteKnowledgeBaseLinks(sourcesBody);

  // Build sections
  const templateSections = [];
  templateSections.push({
    title: "Findings",
    html: `<div class="markdown-body">${renderMarkdown(findingsBody)}</div>`,
  });
  if (sourcesBody.trim()) {
    templateSections.push({
      title: "Sources",
      html: `<div class="markdown-body">${renderMarkdown(sourcesBody)}</div>`,
    });
  }

  const pageBody = renderTemplate("detail", {
    breadcrumb: [{ label: "Knowledge Base", href: "/kb?tab=research" }, { label: meta.label }],
    title: meta.label,
    subtitle: meta.subtitle,
    metaBadges: [{ html: meta.badgesHtml }],
    sections: templateSections,
    actionHint: "/pm:refresh " + topic,
  });

  const html = dashboardPage(meta.label, "/kb", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleInsightDomainDetail(res, pmDir, domain) {
  const indexPath = getInsightIndexPath(pmDir, domain);
  if (!fs.existsSync(indexPath)) {
    const body = renderEmptyState(
      "Insight domain not found",
      'This insight domain does not exist.<br><br><a href="/kb" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
    );
    const html = dashboardPage("Not Found", "/kb", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(indexPath, "utf-8");
  const { body } = parseFrontmatter(raw);
  const title = extractMarkdownTitle(body, humanizeSlug(domain));
  const renderedBody = rewriteKnowledgeBaseLinks(body.replace(/^\s*#\s+.+\n+/, ""));
  const docCount = fs
    .readdirSync(path.dirname(indexPath), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => entry.name !== "index.md" && entry.name !== "log.md").length;
  const metaBadges = [
    { html: `<span class="meta-item">${docCount} document${docCount === 1 ? "" : "s"}</span>` },
  ];
  const stale = stalenessInfo(getNewestUpdated(path.dirname(indexPath)));
  if (stale) {
    metaBadges.push({
      html: `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>`,
    });
  }

  const pageBody = renderTemplate("detail", {
    breadcrumb: [{ href: "/kb", label: "Knowledge Base" }, { label: title }],
    title,
    metaBadges,
    sections: [
      { title: null, html: `<div class="markdown-body">${renderMarkdown(renderedBody)}</div>` },
    ],
    actionHint: "/pm:refresh " + domain,
  });

  const html = dashboardPage(title, "/kb", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleInsightDocumentDetail(res, pmDir, domain, slug) {
  const filePath = path.join(pmDir, "insights", domain, slug + ".md");
  if (!fs.existsSync(filePath)) {
    const body = renderEmptyState(
      "Insight document not found",
      `This insight document does not exist.<br><br><a href="/insights/${escHtml(encodeURIComponent(domain))}" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>`
    );
    const html = dashboardPage("Not Found", "/kb", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const { body } = parseFrontmatter(raw);
  const title = extractMarkdownTitle(body, humanizeSlug(slug));
  const stale = stalenessInfo(getUpdatedDate(filePath));
  const metaBadges = stale
    ? [{ html: `<span class="badge badge-${stale.level}">${escHtml(stale.label)}</span>` }]
    : [];

  const pageBody = renderTemplate("detail", {
    breadcrumb: [
      { href: "/kb", label: "Knowledge Base" },
      { href: "/insights/" + domain, label: humanizeSlug(domain) },
      { label: title },
    ],
    title,
    metaBadges,
    sections: [
      {
        title: null,
        html: `<div class="markdown-body">${renderMarkdown(rewriteKnowledgeBaseLinks(body.replace(/^\s*#\s+.+\n+/, "")))}</div>`,
      },
    ],
    actionHint: "/pm:refresh " + domain,
  });

  const html = dashboardPage(title, "/kb", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleTranscriptPage(res, pmDir, slug) {
  // Try committed transcript first (pm/evidence/transcripts/), then private (.pm/evidence/transcripts/)
  const committedPath = path.join(pmDir, "evidence", "transcripts", slug + ".md");
  const privatePath = path.join(getPmRuntimeRoot(pmDir), "evidence", "transcripts", slug + ".txt");

  let raw = "";
  let title = humanizeSlug(slug);
  let sourceFile = "";
  let isMarkdown = false;

  if (fs.existsSync(committedPath)) {
    raw = fs.readFileSync(committedPath, "utf-8");
    isMarkdown = true;
  } else if (fs.existsSync(privatePath)) {
    raw = fs.readFileSync(privatePath, "utf-8");
  } else {
    const html = dashboardPage(
      "Not Found",
      "/kb",
      renderEmptyState(
        "Transcript not found",
        'This transcript does not exist.<br><br><a href="/kb" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
      )
    );
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  let bodyContent = raw;
  if (isMarkdown) {
    const parsed = parseFrontmatter(raw);
    if (parsed.data.source) sourceFile = parsed.data.source;
    bodyContent = parsed.body;
    bodyContent = bodyContent.replace(/^\s*#\s+.+\n+/, "");
  }

  // Render transcript content with line-by-line styling
  const lines = bodyContent.trim().split("\n");
  const transcriptHtml = lines
    .map((line) => {
      const match = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*\[([^\]]+)\]:\s*(.*)/);
      if (match) {
        const [, ts, speaker, text] = match;
        const speakerClass = speaker.toLowerCase().includes("customer")
          ? "speaker-customer"
          : speaker.toLowerCase().includes("interviewer")
            ? "speaker-interviewer"
            : "speaker-other";
        return `<div class="transcript-line"><span class="transcript-ts">${escHtml(ts)}</span><span class="transcript-speaker ${speakerClass}">${escHtml(speaker)}</span><span class="transcript-text">${escHtml(text)}</span></div>`;
      }
      const tsOnly = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*(.*)/);
      if (tsOnly) {
        return `<div class="transcript-line"><span class="transcript-ts">${escHtml(tsOnly[1])}</span><span class="transcript-text">${escHtml(tsOnly[2])}</span></div>`;
      }
      if (line.trim())
        return `<div class="transcript-line"><span class="transcript-text">${escHtml(line)}</span></div>`;
      return "";
    })
    .filter(Boolean)
    .join("\n");

  const subtitle = sourceFile ? `Source: ${escHtml(sourceFile)}` : "";
  const pageBody = renderTemplate("detail", {
    breadcrumb: [{ label: "Knowledge Base", href: "/kb" }, { label: "Transcript" }],
    title,
    subtitle,
    metaBadges: [],
    sections: [
      { title: "Transcript", html: `<div class="transcript-body">${transcriptHtml}</div>` },
    ],
  });

  const html = dashboardPage(title, "/kb", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

/**
 * Build an injectable header bar (style + html) for standalone HTML pages.
 * @param {string} backLabel - Label for the back button
 * @param {string} [title] - Optional center title
 * @param {string} [copyCommand] - Optional command to show as click-to-copy
 * @returns {{style: string, html: string}}
 */
function injectableHeaderBar(backLabel, title, copyCommand) {
  const style = `<style>
.pm-hdr{position:sticky;top:0;z-index:9999;display:flex;align-items:center;justify-content:space-between;padding:8px 16px;background:rgba(13,15,18,0.95);backdrop-filter:blur(8px);border-bottom:1px solid rgba(255,255,255,0.08);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.pm-hdr-back{color:#a0a4ab;text-decoration:none;font-size:13px;font-weight:500;display:flex;align-items:center;gap:6px}
.pm-hdr-back span{font-size:16px}
.pm-hdr-title{color:#e8eaed;font-size:13px;font-weight:500}
.pm-hdr-cmd{cursor:pointer;padding:4px 12px;background:rgba(94,106,210,0.15);border:1px solid rgba(94,106,210,0.3);border-radius:4px;color:#7c85e0;font-size:12px;font-family:ui-monospace,SFMono-Regular,monospace;display:flex;align-items:center;gap:6px}
.pm-hdr-cmd code{color:inherit;background:none;padding:0}
.pm-hdr-cmd .pm-hdr-icon{opacity:0.6;flex-shrink:0}
.pm-hdr-toast{position:fixed;top:48px;right:16px;padding:4px 12px;background:#222;color:#4ade80;font-size:12px;border-radius:4px;opacity:0;transition:opacity 0.3s;pointer-events:none}
</style>`;

  const titleHtml = title ? `<span class="pm-hdr-title">${escHtml(title)}</span>` : "";
  let rightHtml = "";
  if (copyCommand) {
    const escaped = escHtml(copyCommand);
    rightHtml = `<span class="pm-hdr-cmd" onclick="navigator.clipboard.writeText('${escaped}').then(function(){var t=document.getElementById('pm-hdr-toast');t.style.opacity=1;setTimeout(function(){t.style.opacity=0},1500)})"><code>${escaped}</code><svg class="pm-hdr-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span>
  <span id="pm-hdr-toast" class="pm-hdr-toast">Copied!</span>`;
  }

  const html = `<div class="pm-hdr">
  <a href="#" onclick="history.back();return false" class="pm-hdr-back"><span>&larr;</span> ${escHtml(backLabel)}</a>
  ${titleHtml}
  ${rightHtml}
</div>`;

  return { style, html };
}

function handleWireframe(res, pmDir, slug) {
  if (!slug || slug.includes("/") || slug.includes("..")) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      dashboardPage("Not Found", "/roadmap", '<div class="markdown-body"><h1>Not found</h1></div>')
    );
    return;
  }
  const wireframesDir = path.resolve(pmDir, "backlog", "wireframes");
  const wfPath = path.resolve(wireframesDir, slug + ".html");
  if (!wfPath.startsWith(wireframesDir + path.sep)) {
    res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      dashboardPage("Forbidden", "/roadmap", '<div class="markdown-body"><h1>Forbidden</h1></div>')
    );
    return;
  }
  try {
    const content = fs.readFileSync(wfPath, "utf-8");
    const label = slug
      .replace(/^mockup-/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const wfHeader = injectableHeaderBar("Back", label);
    const injected = content
      .replace(/(<\/head>)/i, wfHeader.style + "$1")
      .replace(/(<body[^>]*>)/i, "$1" + wfHeader.html);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(injected);
  } catch {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      dashboardPage(
        "Wireframe Not Found",
        "/roadmap",
        '<div class="markdown-body"><h1>Wireframe not found</h1><p>No wireframe exists for this backlog item.</p></div>'
      )
    );
  }
}

function renderViewToggle(activeView) {
  const kanbanClass = activeView === "kanban" ? " active" : "";
  const threadsClass = activeView === "threads" ? " active" : "";
  return `<div class="view-toggle"><a href="/roadmap" class="view-toggle-btn${kanbanClass}">Kanban</a><a href="/roadmap?view=threads" class="view-toggle-btn${threadsClass}">Threads</a></div>`;
}

function handleBacklog(res, pmDir) {
  const backlogDir = path.join(pmDir, "backlog");
  const columns = {};
  const childCounts = {};
  const STATUS_ORDER = ["ideas", "proposed", "in-progress", "shipped"];
  const STATUS_MAP = {
    idea: "ideas",
    drafted: "ideas",
    proposed: "proposed",
    planned: "proposed",
    "in-progress": "in-progress",
    done: "shipped",
  };
  const COL_LABELS = {
    ideas: "Ideas",
    proposed: "Proposed",
    "in-progress": "In Progress",
    shipped: "Shipped",
  };
  const COL_LIMIT = 10;

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    // First pass: count children per parent
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const parent = data.parent || null;
      if (parent && parent !== "null") {
        childCounts[parent] = (childCounts[parent] || 0) + 1;
      }
    }
    // Second pass: build columns with parent items only
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const slug = file.replace(".md", "");
      const parent = data.parent || null;
      if (parent && parent !== "null") continue; // skip sub-issues
      const rawStatus = data.status || "idea";
      const status = STATUS_MAP[rawStatus] || "ideas";
      if (!columns[status]) columns[status] = [];
      columns[status].push({
        slug,
        title: data.title || slug,
        id: data.id || null,
        subCount: childCounts[slug] || 0,
        updated: data.updated || data.created || "",
        rawStatus,
      });
    }
  }

  const renderCard = (item) => {
    const idHtml = item.id ? `<span class="kanban-card-id">${escHtml(item.id)}</span>` : "";
    const subHtml =
      item.subCount > 0
        ? `<span class="kanban-card-sub">${item.subCount} sub-issue${item.subCount !== 1 ? "s" : ""}</span>`
        : "";
    const plannedHtml =
      item.rawStatus === "planned" ? '<span class="kanban-badge-planned">RFC ready</span>' : "";
    const header =
      idHtml || subHtml || plannedHtml
        ? `<div class="kanban-card-header">${idHtml}${subHtml}${plannedHtml}</div>`
        : "";
    return `<a class="kanban-card" href="/roadmap/${escHtml(encodeURIComponent(item.slug))}" role="article">${header}<div class="kanban-card-title">${escHtml(item.title)}</div></a>`;
  };

  const COL_EMPTY_HINTS = {
    ideas: "",
    proposed: "",
    "in-progress": "",
    shipped: "",
  };

  const templateColumns = STATUS_ORDER.map((status) => {
    const allItems = (columns[status] || []).sort((a, b) =>
      (b.updated || "").localeCompare(a.updated || "")
    );
    const totalCount = allItems.length;
    const isCapped = totalCount > COL_LIMIT;
    const displayItems = isCapped ? allItems.slice(0, COL_LIMIT) : allItems;
    const isShipped = status === "shipped";
    return {
      label: COL_LABELS[status],
      status,
      items: displayItems.map(renderCard),
      totalCount,
      displayCount: displayItems.length,
      viewAllHref: isShipped ? "/roadmap/shipped" : undefined,
      viewAllLabel: "shipped",
      cssClass: isShipped ? "shipped" : "",
      hint: totalCount === 0 ? COL_EMPTY_HINTS[status] : undefined,
    };
  });

  const totalItems = templateColumns.reduce((sum, col) => sum + col.totalCount, 0);
  const filterBar =
    totalItems > 0
      ? '<div class="filter-bar"><input type="text" class="filter-input" id="roadmap-filter" placeholder="Filter issues..."></div>'
      : "";
  const filterScript =
    totalItems > 0
      ? `<script>
document.getElementById('roadmap-filter').addEventListener('input', function(e) {
  var q = e.target.value.toLowerCase();
  document.querySelectorAll('.kanban-card').forEach(function(card) {
    card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
});
</script>`
      : "";

  const viewToggle = renderViewToggle("kanban");

  const body =
    renderKanbanTemplate({
      title: "Roadmap",
      subtitle: "What's coming, what's in progress, and what just shipped",
      headerExtra: viewToggle,
      legend: filterBar,
      columns: templateColumns,
      emptyState: renderEmptyState(
        "No backlog items",
        "Backlog items are scoped issues created during grooming.",
        "/pm:groom",
        "Start grooming"
      ),
    }) + filterScript;

  const html = dashboardPage("Roadmap", "/roadmap", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleBacklogThreads(res, pmDir) {
  const backlogDir = path.join(pmDir, "backlog");
  const items = [];
  const childrenByParent = {};

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    // First pass: collect children per parent
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const parent = data.parent || null;
      if (parent && parent !== "null") {
        if (!childrenByParent[parent]) childrenByParent[parent] = [];
        childrenByParent[parent].push({
          id: data.id || null,
          title: data.title || file.replace(".md", ""),
        });
      }
    }
    // Second pass: collect parent items
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const slug = file.replace(".md", "");
      const parent = data.parent || null;
      if (parent && parent !== "null") continue; // skip sub-issues
      items.push({
        slug,
        title: data.title || slug,
        id: data.id || null,
        status: data.status || "idea",
        prd: data.prd || null,
        rfc: data.rfc || null,
        linear_id: data.linear_id || null,
        prs: Array.isArray(data.prs) ? data.prs : [],
        updated: data.updated || data.created || "",
        children: childrenByParent[slug] || [],
      });
    }
  }

  // Sort by updated date descending
  items.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));

  const viewToggle = renderViewToggle("threads");

  let pageBody = "";
  pageBody += '<div class="thread-view">';
  pageBody += '<div class="page-header">';
  pageBody += "<h1>Roadmap</h1>";
  pageBody += '<p class="subtitle">Feature lifecycle — from idea to shipped</p>';
  pageBody += "</div>";
  pageBody += viewToggle;

  if (items.length === 0) {
    pageBody += renderEmptyState(
      "No features yet",
      "Start with /pm:groom to create your first proposal.",
      "/pm:groom",
      "Start grooming"
    );
  } else {
    pageBody += '<div class="thread-table-wrap">';
    pageBody += '<table class="thread-table">';
    pageBody += "<thead><tr>";
    pageBody +=
      "<th>Feature</th><th>Status</th><th>Proposal</th><th>RFC</th><th>Linear</th><th>PRs</th>";
    pageBody += "</tr></thead>";
    pageBody += "<tbody>";

    for (const item of items) {
      const titleHtml = item.id
        ? `<span class="thread-id">${escHtml(item.id)}</span> ${escHtml(item.title)}`
        : escHtml(item.title);

      const statusHtml = `<span class="badge badge-${escHtml(item.status)}">${escHtml(item.status)}</span>`;

      const prdSlug = item.prd ? item.prd.replace(/^proposals\//, "").replace(/\.html$/, "") : null;
      const prdHtml = prdSlug
        ? `<a href="/proposals/${escHtml(prdSlug)}" class="thread-pill">PRD</a>`
        : "\u2014";

      const rfcSlug = item.rfc ? item.rfc.replace(/^rfcs\//, "").replace(/\.html$/, "") : null;
      const rfcHtml =
        rfcSlug && rfcSlug !== "null"
          ? `<a href="/rfc/${escHtml(rfcSlug)}" class="thread-pill">RFC</a>`
          : "\u2014";

      const linearHtml =
        item.linear_id && item.linear_id !== "null"
          ? `<span class="thread-pill">${escHtml(item.linear_id)}</span>`
          : "\u2014";

      const prsHtml =
        item.prs.length > 0
          ? item.prs
              .map((pr) => `<span class="thread-pill thread-pill-pr">${escHtml(pr)}</span>`)
              .join(" ")
          : "\u2014";

      let featureCell = `<div class="thread-feature">${titleHtml}`;
      if (item.children.length > 0) {
        const count = item.children.length;
        const childListHtml = item.children
          .map((c) => {
            const cId = c.id ? `<strong>${escHtml(c.id)}</strong> ` : "";
            return `<li>${cId}${escHtml(c.title)}</li>`;
          })
          .join("");
        featureCell += `<details class="thread-children-toggle"><summary>${count} sub-issue${count !== 1 ? "s" : ""}</summary><ul class="thread-children-list">${childListHtml}</ul></details>`;
      }
      featureCell += "</div>";

      pageBody += "<tr>";
      pageBody += `<td>${featureCell}</td>`;
      pageBody += `<td>${statusHtml}</td>`;
      pageBody += `<td>${prdHtml}</td>`;
      pageBody += `<td>${rfcHtml}</td>`;
      pageBody += `<td>${linearHtml}</td>`;
      pageBody += `<td>${prsHtml}</td>`;
      pageBody += "</tr>";
    }

    pageBody += "</tbody></table>";
    pageBody += "</div>";
  }

  pageBody += "</div>";

  const html = dashboardPage("Roadmap", "/roadmap", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleShipped(res, pmDir) {
  const backlogDir = path.join(pmDir, "backlog");
  const allItems = {};
  const childCount = {};

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data } = parseFrontmatter(raw);
      const slug = file.replace(".md", "");
      allItems[slug] = {
        slug,
        title: data.title || slug,
        status: data.status || "idea",
        id: data.id || null,
        parent: data.parent || null,
        priority: data.priority || "medium",
        labels: Array.isArray(data.labels) ? data.labels.filter((l) => l !== "ideate") : [],
        updated: data.updated || data.created || "",
        outcome: data.outcome || "",
        research_refs: Array.isArray(data.research_refs) ? data.research_refs : [],
      };
    }
  }

  // Build child counts
  for (const item of Object.values(allItems)) {
    if (item.parent && item.parent !== "null" && allItems[item.parent]) {
      childCount[item.parent] = (childCount[item.parent] || 0) + 1;
    }
  }

  // Filter to done root items only
  const roots = Object.values(allItems).filter(
    (i) => i.status === "done" && (!i.parent || i.parent === "null" || !allItems[i.parent])
  );
  roots.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));

  const cardItems = roots.map((item) => {
    const subCount = childCount[item.slug] || 0;
    const researchTopics = resolveResearchRefs(item.research_refs, pmDir);
    const strategyNote = resolveStrategyAlignment(item, allItems, pmDir);
    const competitorGaps = resolveCompetitiveContext(item, allItems, pmDir);

    // Build tag HTML
    const tags = [];
    for (const topic of researchTopics) {
      tags.push(
        `<span class="shipped-tag shipped-tag-research shipped-item-research">${escHtml(topic.label)}</span>`
      );
    }
    if (strategyNote) {
      tags.push(`<span class="shipped-tag shipped-tag-strategy">${escHtml(strategyNote)}</span>`);
    }
    for (const comp of competitorGaps) {
      tags.push(
        `<span class="shipped-tag shipped-tag-competitor">Addresses gap in ${escHtml(comp)}</span>`
      );
    }
    const labelTags = item.labels.map(
      (l) => `<span class="shipped-tag-label kanban-label">${escHtml(l)}</span>`
    );

    return `<a class="shipped-item-card" href="/roadmap/${escHtml(encodeURIComponent(item.slug))}">
  <div class="shipped-item-header">
    ${item.id ? `<span class="shipped-item-id">${escHtml(item.id)}</span>` : ""}
    <span class="shipped-item-title">${escHtml(item.title)}</span>
    ${subCount > 0 ? `<span class="shipped-item-sub">${subCount} sub-issue${subCount !== 1 ? "s" : ""}</span>` : ""}
    <span class="shipped-item-date">${escHtml(formatRelativeDate(item.updated))}</span>
  </div>
  ${item.outcome ? `<div class="shipped-item-outcome">${escHtml(item.outcome)}</div>` : ""}
  ${tags.length > 0 || labelTags.length > 0 ? `<div class="shipped-item-tags">${[...tags, ...labelTags].join("")}</div>` : ""}
</a>`;
  });

  const body = renderListTemplate({
    breadcrumb: '<a href="/roadmap">&larr; Roadmap</a>',
    title: "Shipped",
    subtitle: `${roots.length} item${roots.length !== 1 ? "s" : ""} shipped`,
    sections: [{ items: cardItems, layout: "rows", itemsClass: "shipped-items" }],
    emptyState: renderEmptyState(
      "Nothing shipped yet",
      "Completed items appear here once their status is set to done."
    ),
  });

  const html = dashboardPage("Shipped", "/roadmap", body);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleProposalDetail(res, pmDir, slug) {
  // Read backlog .md with prd field
  let meta = null;
  const backlogPath = path.resolve(pmDir, "backlog", slug + ".md");
  if (fs.existsSync(backlogPath)) {
    try {
      const raw = fs.readFileSync(backlogPath, "utf-8");
      const { data } = parseFrontmatter(raw);
      if (data.prd) {
        meta = data;
      }
    } catch {
      /* skip */
    }
  }
  if (!meta) {
    const body = renderEmptyState(
      "Proposal not found",
      'This proposal does not exist.<br><br><a href="/proposals" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
    );
    const html = dashboardPage("Not Found", "/proposals", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Serve the proposal HTML directly with a sticky header bar
  const htmlPath = path.resolve(pmDir, "backlog", "proposals", slug + ".html");
  if (!fs.existsSync(htmlPath)) {
    const body = renderEmptyState(
      "Proposal not found",
      'This proposal does not exist.<br><br><a href="/proposals" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
    );
    const html = dashboardPage("Not Found", "/proposals", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  const status = (meta.status || "").toLowerCase();
  const actionCommand = ["proposed", "planned", "in-progress"].includes(status)
    ? `/pm:dev ${slug}`
    : `/pm:groom ${slug}`;
  const title = meta.title || humanizeSlug(slug);

  const header = injectableHeaderBar("Back", title, actionCommand);
  const proposalHtml = fs.readFileSync(htmlPath, "utf-8");
  const injected = proposalHtml
    .replace(/(<\/head>)/i, header.style + "$1")
    .replace(/(<body[^>]*>)/i, "$1" + header.html);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(injected);
}

function handleBacklogItem(res, pmDir, slug) {
  const filePath = path.join(pmDir, "backlog", slug + ".md");
  if (!fs.existsSync(filePath)) {
    const html = dashboardPage(
      "Not Found",
      "/roadmap",
      renderEmptyState(
        "Backlog item not found",
        'This backlog item does not exist.<br><br><a href="/roadmap" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
      )
    );
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, body } = parseFrontmatter(raw);
  const title = data.title || slug;
  const status = data.status || "idea";
  const priority = data.priority || "";
  const itemId = data.id || "";
  const date = data.updated || data.created || "";

  // Build slug lookup for resolving parent/children references
  const backlogDir = path.join(pmDir, "backlog");
  const slugLookup = {};
  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const s = file.replace(".md", "");
      const r = fs.readFileSync(path.join(backlogDir, file), "utf-8");
      const { data: d } = parseFrontmatter(r);
      slugLookup[s] = { id: d.id || null, title: d.title || s };
    }
  }

  // Resolve parent info for breadcrumb
  let parentSlug = data.parent || "";
  let parentTitle = "";
  if (parentSlug && slugLookup[parentSlug]) {
    parentTitle = slugLookup[parentSlug].title;
  }

  // Breadcrumb
  const currentLabel = itemId ? itemId + " " + title : title;
  const breadcrumbItems =
    parentSlug && parentTitle
      ? [
          { label: "Proposals", href: "/proposals" },
          { label: parentTitle, href: "/roadmap/" + escHtml(parentSlug) },
          { label: currentLabel },
        ]
      : [{ label: "Roadmap", href: "/roadmap" }, { label: currentLabel }];

  // Title prefix (ID badge)
  const idBadge = itemId ? `<span class="detail-id-badge">${escHtml(itemId)}</span>` : "";

  // Meta badges (content items only — template adds separators)
  const metaBadges = [];
  metaBadges.push({
    html: `<span class="badge badge-${escHtml(status)}">${escHtml(status)}</span>`,
  });
  if (priority) {
    metaBadges.push({ html: `<span class="meta-item">${escHtml(priority)} priority</span>` });
  }
  if (parentSlug && parentTitle) {
    metaBadges.push({
      html: `<span class="meta-item"><a href="/roadmap/${escHtml(parentSlug)}">${escHtml(parentTitle)}</a></span>`,
    });
  }
  if (date) {
    metaBadges.push({ html: `<span class="meta-item">${escHtml(date)}</span>` });
  }

  // Sections
  const templateSections = [];

  // Outcome section
  if (data.outcome) {
    templateSections.push({ title: "Outcome", html: `<p>${escHtml(data.outcome)}</p>` });
  }

  // Acceptance Criteria section — parse from body or frontmatter
  const acItems = [];
  if (Array.isArray(data.acceptance_criteria)) {
    data.acceptance_criteria.forEach((ac) => acItems.push(String(ac)));
  } else {
    const acMatch = body.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?=\n## |\n# |$)/i);
    if (acMatch) {
      const acBlock = acMatch[1];
      const acLines = acBlock.split("\n");
      for (const line of acLines) {
        const m = line.match(/^\s*[-*]\s+\[?\s*[xX ]?\]?\s*(.*)/);
        if (m && m[1].trim()) acItems.push(m[1].trim());
      }
    }
  }
  if (acItems.length > 0) {
    const acListItems = acItems.map((ac) => `<li>${escHtml(ac)}</li>`).join("\n");
    templateSections.push({
      title: "Acceptance Criteria",
      html: `<ul class="detail-ac-list">${acListItems}</ul>`,
    });
  }

  // Children section
  const children = Array.isArray(data.children)
    ? data.children.filter((c) => c && slugLookup[c])
    : [];
  if (children.length > 0) {
    const childItems = children
      .map((c) => {
        const ch = slugLookup[c];
        const cId = ch.id ? `<span class="detail-issue-id">${escHtml(ch.id)}</span>` : "";
        return `<li><a href="/roadmap/${escHtml(c)}">${cId}${escHtml(ch.title)}</a></li>`;
      })
      .join("\n");
    templateSections.push({
      title: "Child Issues",
      html: `<ul class="detail-issue-list">${childItems}</ul>`,
    });
  }

  // RFC section — find implementation plans matching this issue or its children
  const rfcs = findRfcsForIssueTree(pmDir, slug, data.children);
  if (rfcs.length > 0) {
    const rfcItems = rfcs
      .map((rfc) => {
        const label = rfc.fileName.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
        return `<li><a href="/rfc/${escHtml(encodeURIComponent(rfc.fileName))}">${escHtml(humanizeSlug(label))}</a> <span class="meta-item">${escHtml(rfc.date)}</span></li>`;
      })
      .join("\n");
    templateSections.push({
      title: `Implementation Plan${rfcs.length > 1 ? "s" : ""}`,
      html: `<ul class="detail-issue-list">${rfcItems}</ul>`,
    });
  }

  // Artifacts section — proposal, RFC, and PR links in one compact row
  const proposalsBase = path.join(pmDir, "backlog", "proposals");
  const rfcsBase = path.join(pmDir, "backlog", "rfcs");
  let proposalSlug = null;
  let proposalLabel = "";
  if (fs.existsSync(path.join(proposalsBase, slug + ".html"))) {
    proposalSlug = slug;
    proposalLabel = "View Proposal";
  } else if (parentSlug && fs.existsSync(path.join(proposalsBase, parentSlug + ".html"))) {
    proposalSlug = parentSlug;
    proposalLabel = "View Parent Proposal";
  }
  let rfcSlug = null;
  if (data.rfc) {
    rfcSlug = data.rfc.replace(/^rfcs\//, "").replace(/\.html$/, "");
  }
  if (!rfcSlug && parentSlug && fs.existsSync(path.join(rfcsBase, parentSlug + ".html"))) {
    rfcSlug = parentSlug;
  }
  const artifactLinks = [];
  if (proposalSlug) {
    artifactLinks.push(
      `<a href="/proposals/${escHtml(encodeURIComponent(proposalSlug))}" class="detail-proposal-link">${proposalLabel} &nearr;</a>`
    );
  }
  if (rfcSlug) {
    artifactLinks.push(
      `<a href="/rfc/${escHtml(encodeURIComponent(rfcSlug))}" class="detail-proposal-link">View RFC &nearr;</a>`
    );
  }
  const prs = Array.isArray(data.prs) ? data.prs.filter(Boolean) : [];
  if (prs.length > 0) {
    for (const pr of prs) {
      artifactLinks.push(
        `<a href="${escHtml(pr)}" target="_blank" class="detail-proposal-link">PR: ${escHtml(pr.replace(/.*\/pull\//, "#"))} &nearr;</a>`
      );
    }
  }
  if (artifactLinks.length > 0) {
    templateSections.push({
      title: "Artifacts",
      html: `<div class="detail-artifacts-row">${artifactLinks.join("")}</div>`,
    });
  }

  // Wireframe embed section
  try {
    fs.accessSync(path.join(pmDir, "backlog", "wireframes", slug + ".html"));
    templateSections.push({
      title: "Wireframe",
      html: `<div class="wireframe-embed">
    <div class="wireframe-header"><span class="wireframe-label">Wireframe Preview</span><a href="/roadmap/wireframes/${encodeURIComponent(slug)}" target="_blank" class="wireframe-open">Open in new tab &nearr;</a></div>
    <iframe src="/roadmap/wireframes/${encodeURIComponent(slug)}" class="wireframe-iframe"></iframe>
  </div>`,
    });
  } catch {
    /* no wireframe for this item */
  }

  // Remaining markdown body — only show if no proposal exists (avoids duplication)
  if (!proposalSlug) {
    let remainingBody = body;
    if (acItems.length > 0) {
      remainingBody = remainingBody
        .replace(/## Acceptance Criteria\s*\n[\s\S]*?(?=\n## |\n# |$)/i, "")
        .trim();
    }
    if (data.outcome) {
      remainingBody = remainingBody.replace(/## Outcome\s*\n[\s\S]*?(?=\n## |\n# |$)/i, "").trim();
    }
    if (remainingBody.trim()) {
      const bodySections = remainingBody.split(/(?=^## )/m).filter((s) => s.trim());
      const collapsibleParts = [];
      for (const section of bodySections) {
        const headingMatch = section.match(/^## (.+)\n([\s\S]*)$/);
        if (headingMatch) {
          const sectionTitle = headingMatch[1].trim();
          const sectionContent = headingMatch[2].trim();
          if (sectionContent) {
            collapsibleParts.push({ title: sectionTitle, content: sectionContent });
          }
        } else {
          templateSections.push({
            title: null,
            html: `<div class="markdown-body">${renderMarkdown(rewriteKnowledgeBaseLinks(section))}</div>`,
          });
        }
      }
      if (collapsibleParts.length > 0) {
        const detailsHtml = collapsibleParts
          .map(
            (p, i) =>
              `<details class="detail-collapsible"${i === 0 ? " open" : ""}>` +
              `<summary>${escHtml(p.title)}</summary>` +
              `<div class="markdown-body">${renderMarkdown(rewriteKnowledgeBaseLinks(p.content))}</div>` +
              `</details>`
          )
          .join("\n");
        templateSections.push({
          title: "Details",
          html: detailsHtml,
        });
      }
    }
  }

  // Action hint: ideas need grooming, groomed items need dev
  let actionHintCmd = "";
  if (status !== "done") {
    const ref = itemId || slug;
    if (status === "idea") {
      actionHintCmd = "/groom " + ref;
    } else {
      actionHintCmd = "/dev " + ref;
    }
  }

  const pageBody = renderTemplate("detail", {
    breadcrumb: breadcrumbItems,
    title,
    titlePrefix: idBadge,
    metaBadges,
    sections: templateSections,
    actionHint: actionHintCmd,
  });

  const html = dashboardPage(title, "/roadmap", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function handleRfcDetail(res, pmDir, fileName) {
  if (!fileName || fileName.includes("..") || fileName.includes("/")) {
    const body = renderEmptyState(
      "Implementation plan not found",
      'This RFC does not exist.<br><br><a href="/roadmap" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
    );
    const html = dashboardPage("Not Found", "/roadmap", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Check for HTML RFC in pm/backlog/rfcs/ first (generated by groom)
  const rfcSlug = fileName.replace(/\.html$/, "").replace(/\.md$/, "");
  const htmlRfcPath = path.join(pmDir, "backlog", "rfcs", rfcSlug + ".html");
  if (fs.existsSync(htmlRfcPath)) {
    const backlogPath = path.join(pmDir, "backlog", rfcSlug + ".md");
    let title = humanizeSlug(rfcSlug);
    let actionCommand = "";
    if (fs.existsSync(backlogPath)) {
      const { data } = parseFrontmatter(fs.readFileSync(backlogPath, "utf-8"));
      title = data.title || title;
      const status = (data.status || "").toLowerCase();
      actionCommand = ["proposed", "planned", "in-progress"].includes(status)
        ? `/pm:dev ${rfcSlug}`
        : `/pm:groom ${rfcSlug}`;
    }
    const header = injectableHeaderBar("Back", title, actionCommand);
    const rfcHtml = fs.readFileSync(htmlRfcPath, "utf-8");
    const injected = rfcHtml
      .replace(/(<\/head>)/i, header.style + "$1")
      .replace(/(<body[^>]*>)/i, "$1" + header.html);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(injected);
    return;
  }

  // Fall back to .md implementation plans in docs/plans/
  const projectRoot = path.dirname(pmDir);
  const candidates = [
    path.join(projectRoot, "pm_plugin", "docs", "plans", fileName),
    path.join(projectRoot, "docs", "plans", fileName),
    path.join(projectRoot, "pm_server", "docs", "plans", fileName),
  ];
  const filePath = candidates.find((p) => fs.existsSync(p));
  if (!filePath) {
    const body = renderEmptyState(
      "Implementation plan not found",
      'This RFC does not exist.<br><br><a href="/roadmap" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a>'
    );
    const html = dashboardPage("Not Found", "/roadmap", body);
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, body } = parseFrontmatter(raw);
  const mdSlug = fileName.replace(/\.md$/, "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const title = extractMarkdownTitle(body, humanizeSlug(mdSlug));
  const dateMatch = fileName.match(/^(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  const metaBadges = [];
  metaBadges.push({ html: '<span class="badge badge-ready">RFC</span>' });
  if (date) metaBadges.push({ html: `<span class="meta-item">${escHtml(date)}</span>` });

  const backlogPath = path.join(pmDir, "backlog", mdSlug + ".md");
  const backlogExists = fs.existsSync(backlogPath);

  const breadcrumbItems = backlogExists
    ? [
        { label: "Roadmap", href: "/roadmap" },
        { label: humanizeSlug(mdSlug), href: "/roadmap/" + mdSlug },
        { label: "RFC" },
      ]
    : [{ label: "Roadmap", href: "/roadmap" }, { label: "RFC" }];

  const pageBody = renderTemplate("detail", {
    breadcrumb: breadcrumbItems,
    title,
    metaBadges,
    sections: [{ title: null, html: `<div class="markdown-body">${renderMarkdown(body)}</div>` }],
  });

  const html = dashboardPage("RFC: " + title, "/roadmap", pageBody);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function rewriteKnowledgeBaseLinks(md) {
  return md
    .replace(/\]\(pm\/backlog\/wireframes\/([^).]+)\.html\)/g, "](/roadmap/wireframes/$1)")
    .replace(/\]\(pm\/evidence\/research\/([^).]+)\.md\)/g, "](/evidence/research/$1)")
    .replace(/\]\(pm\/evidence\/research\/([^)]+)\)/g, "](/evidence/research/$1)")
    .replace(
      /\]\(pm\/evidence\/transcripts\/([^)]+?)(?:\.md|\.txt)?\)/g,
      "](/evidence/transcripts/$1)"
    )
    .replace(/\]\(pm\/research\/([^/]+)\/findings\.md\)/g, "](/evidence/research/$1)")
    .replace(/\]\(pm\/research\/([^)]+)\)/g, "](/evidence/research/$1)")
    .replace(/\]\(pm\/insights\/business\/landscape\.md\)/g, "](/insights/business/landscape)")
    .replace(
      /\]\(pm\/insights\/competitors\/([^/]+)\/([^)]+?)\.md\)/g,
      "](/insights/competitors/$1#$2)"
    )
    .replace(/\]\(pm\/insights\/competitors\/([^/]+)\/([^)]+)\)/g, "](/insights/competitors/$1#$2)")
    .replace(/\]\(pm\/insights\/competitors\/([^)]+)\)/g, "](/insights/competitors/$1)")
    .replace(/\]\(pm\/insights\/([^/]+)\/index\.md\)/g, "](/insights/$1)")
    .replace(/\]\(pm\/insights\/([^/]+)\/([^).]+)\.md\)/g, "](/insights/$1/$2)")
    .replace(/\]\(pm\/competitors\/([^/]+)\/([^)]+)\)/g, "](/insights/competitors/$1#$2)")
    .replace(/\]\(pm\/competitors\/([^)]+)\)/g, "](/insights/competitors/$1)");
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
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }
    const accept = computeAcceptKey(key);
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        "Sec-WebSocket-Accept: " +
        accept +
        "\r\n\r\n"
    );
    dashClients.add(socket);
    allConnections.add(socket);
    let buffer = Buffer.alloc(0);

    function handleDashboardMessage(text) {
      let event;
      try {
        event = JSON.parse(text);
      } catch (e) {
        console.error("Failed to parse WebSocket message:", e.message);
        return;
      }

      touchActivity();
      console.log(JSON.stringify({ source: "user-event", ...event }));

      if (!event.choice) return;

      const slug = sessionSlugFromPath(event.path);
      if (!slug) return;

      const sessionDir = resolveSessionDir(pmDir, slug);
      if (!sessionDir) return;

      const eventsFile = path.join(sessionDir, ".events");
      fs.appendFileSync(eventsFile, JSON.stringify(event) + "\n");
    }

    socket.on("data", (chunk) => {
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

    socket.on("close", () => {
      dashClients.delete(socket);
      allConnections.delete(socket);
    });
    socket.on("error", () => {
      dashClients.delete(socket);
      allConnections.delete(socket);
    });
  }

  function broadcastDashboard(msg) {
    const frame = encodeFrame(OPCODES.TEXT, Buffer.from(JSON.stringify(msg)));
    for (const socket of dashClients) {
      try {
        socket.write(frame);
      } catch (e) {
        dashClients.delete(socket);
      }
    }
  }

  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      routeDashboard(req, res, pmDir);
    } else if (req.method === "POST") {
      routeDashboardPost(req, res, pmDir);
    } else {
      res.writeHead(405);
      res.end("Method Not Allowed");
    }
  });

  // Track HTTP connections too
  server.on("connection", (socket) => {
    allConnections.add(socket);
    socket.on("close", () => allConnections.delete(socket));
  });

  server.on("upgrade", handleDashboardUpgrade);

  let watcherActive = false;
  function closeWatchersUnder(prefixPath) {
    for (const [watchPath, watcher] of dirWatchers) {
      if (watchPath === prefixPath || watchPath.startsWith(prefixPath + path.sep)) {
        try {
          watcher.close();
        } catch (e) {}
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

        const name = filename ? filename.toString() : "";
        const changedPath = name ? path.join(dirPath, name) : dirPath;

        if (eventType === "rename") {
          try {
            const changedStat = fs.statSync(changedPath);
            if (changedStat.isDirectory()) {
              watchDirectoryTree(changedPath);
            }
          } catch (e) {
            closeWatchersUnder(changedPath);
          }
        }

        broadcastDashboard({ type: "reload" });
      });

      dirWatchers.set(dirPath, watcher);
      watcher.on("error", () => closeWatchersUnder(dirPath));
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
  server.close = function (cb) {
    // Stop the watcher first so no more broadcasts fire during teardown
    watcherActive = false;
    closeWatchersUnder(pmDir);
    closeWatchersUnder(pmRuntimeRoot);
    // Destroy all open sockets so server.close callback fires promptly
    for (const sock of allConnections) {
      try {
        sock.destroy();
      } catch (e) {}
    }
    allConnections.clear();
    dashClients.clear();
    origClose(cb);
  };

  return server;
}

const helperScript = fs.readFileSync(path.join(__dirname, "helper.js"), "utf-8");
const helperInjection = "<script>\n" + helperScript + "\n</script>";

// ========== Helper Functions ==========

function slugifySessionTopic(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getPmRuntimeRoot(pmDir) {
  return path.resolve(pmDir, "..", ".pm");
}

function resolveSessionDir(pmDir, slug) {
  const sessionsDir = path.resolve(getPmRuntimeRoot(pmDir), "sessions");
  if (!fs.existsSync(sessionsDir)) return null;
  const prefixes = ["groom-", "dev-", "epic-", "research-", ""];
  for (const prefix of prefixes) {
    const candidate = path.join(sessionsDir, prefix + slug);
    if (candidate.startsWith(sessionsDir + path.sep) && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sessionSlugFromPath(requestPath) {
  const cleanPath = String(requestPath || "").split("?")[0];
  if (cleanPath.startsWith("/session/")) {
    return decodeURIComponent(cleanPath.slice("/session/".length)).split("/")[0] || null;
  }
  if (cleanPath.startsWith("/groom/")) {
    return decodeURIComponent(cleanPath.slice("/groom/".length)).split("/")[0] || null;
  }
  return null;
}

function injectSessionPageHelpers(html, slug) {
  const bootstrapScript = `<script>window.__PM_SESSION_SLUG = ${JSON.stringify(slug)};</script>`;
  const combined = bootstrapScript + "\n" + helperInjection;
  if (html.includes("window.__PM_SESSION_SLUG") || html.includes(helperScript.slice(0, 40))) {
    return html;
  }
  if (html.includes("</body>")) {
    return html.replace("</body>", combined + "\n</body>");
  }
  return html + combined;
}

function loadSessionState(pmDir, slug) {
  const pmRoot = getPmRuntimeRoot(pmDir);
  const groomPath = path.join(pmRoot, "groom-sessions", slug + ".md");
  if (fs.existsSync(groomPath)) {
    const raw = fs.readFileSync(groomPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    return { type: "groom", data, raw };
  }

  const devPath = path.join(pmRoot, "dev-sessions", slug + ".md");
  if (fs.existsSync(devPath)) {
    const raw = fs.readFileSync(devPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    return { type: "dev", data, raw };
  }

  const legacyPath = path.join(pmRoot, ".groom-state.md");
  if (fs.existsSync(legacyPath)) {
    const raw = fs.readFileSync(legacyPath, "utf-8");
    const { data } = parseFrontmatter(raw);
    if (slugifySessionTopic(data.topic) === slug) {
      return { type: "groom", data, raw, legacy: true };
    }
  }

  return null;
}

function handleSessionPage(res, pmDir, slug) {
  const projectName = getProjectName(pmDir);
  const sessionDir = resolveSessionDir(pmDir, slug);
  if (sessionDir) {
    const currentHtml = path.join(sessionDir, "current.html");
    if (currentHtml.startsWith(sessionDir + path.sep) && fs.existsSync(currentHtml)) {
      const html = injectSessionPageHelpers(fs.readFileSync(currentHtml, "utf-8"), slug);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
  }

  const session = loadSessionState(pmDir, slug);
  if (!session) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      dashboardPage(
        "Session Not Found",
        "/",
        renderEmptyState(
          "Session not found",
          "No session found for <code>" + escHtml(slug) + "</code>."
        ) +
          '<p><a href="/" onclick="if(history.length>1){history.back();return false}">&larr; Go back</a></p>',
        projectName
      )
    );
    return;
  }

  const topic = session.data.topic || humanizeSlug(slug);
  const phase =
    session.type === "groom"
      ? humanizeSlug(String(session.data.phase || "in-progress"))
      : humanizeSlug(String(session.data.stage || session.data.phase || "in-progress"));
  const started = session.data.started || session.data.updated || "";
  const typeLabel = session.type === "groom" ? "Grooming Session" : "Development Session";
  const resumeCommand = session.type === "groom" ? `/pm:groom ${slug}` : `/dev ${slug}`;
  const statePath =
    session.type === "groom"
      ? session.legacy
        ? ".pm/.groom-state.md"
        : `.pm/groom-sessions/${slug}.md`
      : `.pm/dev-sessions/${slug}.md`;

  // Build meta badges
  const metaBadges = [{ html: `<span class="meta-item">${escHtml(typeLabel)}</span>` }];
  if (started) {
    metaBadges.push({ html: `<span class="meta-item">Started ${escHtml(started)}</span>` });
  }
  metaBadges.push({ html: `<span class="meta-item">Phase ${escHtml(phase)}</span>` });

  const body = renderTemplate("detail", {
    breadcrumb: [{ label: "Dashboard", href: "/" }, { label: topic }],
    title: topic,
    metaBadges,
    sections: [
      {
        title: "Resume",
        html: `<div class="markdown-body">
      <p>Resume this session from the terminal with <code>${escHtml(resumeCommand)}</code>.</p>
      <p>State file: <code>${escHtml(statePath)}</code></p>
    </div>`,
      },
    ],
  });

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(dashboardPage(`Session: ${topic}`, `/session/${slug}`, body, projectName));
}

// ========== Activity Tracking ==========

const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
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

  const pmDir = DIR_FLAG ? path.resolve(process.cwd(), DIR_FLAG) : path.join(process.cwd(), "pm");

  const server = createDashboardServer(pmDir);

  const lifecycleCheck = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
      console.log(JSON.stringify({ type: "server-stopped", reason: "idle timeout (60 min)" }));
      clearInterval(lifecycleCheck);
      server.close(() => process.exit(0));
    }
  }, 60 * 1000);
  lifecycleCheck.unref();

  server.listen(PORT, HOST, () => {
    const address = server.address();
    const boundPort = address && typeof address === "object" ? Number(address.port) : Number(PORT);
    const info = JSON.stringify({
      type: "server-started",
      port: boundPort,
      host: HOST,
      url_host: URL_HOST,
      url: "http://" + URL_HOST + ":" + boundPort,
      pm_dir: pmDir,
      mode: "dashboard",
    });
    console.log(info);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  computeAcceptKey,
  encodeFrame,
  decodeFrame,
  OPCODES,
  parseMode,
  parseFrontmatter,
  normalizeKbPath,
  renderMarkdown,
  inlineMarkdown,
  escHtml,
  readConfig,
  createDashboardServer,
  dashboardPage,
  readProposalMeta,
  readGroomState,
  proposalGradient,
  buildProposalRows,
  formatRelativeDate,
  parseStrategySnapshot,
  resolveResearchRefs,
  resolveStrategyAlignment,
  resolveCompetitiveContext,
  hashProjectPort,
  isPortAvailable,
  resolvePort,
  DASHBOARD_CSS,
  renderTemplate,
  renderListTemplate,
  renderKanbanTemplate,
};
