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
      // Flat key-value
      data[key] = inlineVal;
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
        obj[objItemMatch[1]] = objItemMatch[2].trim();
        i++;
        // Collect continuation lines for this object
        while (i < lines.length) {
          const cont = lines[i];
          const contMatch = cont.match(/^[ \t]{2,}([a-zA-Z_][a-zA-Z0-9_-]*):\s*(.*)/);
          if (contMatch && !cont.match(/^[ \t]+-\s/)) {
            obj[contMatch[1]] = contMatch[2].trim();
            i++;
          } else {
            break;
          }
        }
        items.push(obj);
      } else if (scalarItemMatch) {
        items.push(scalarItemMatch[1].trim());
        i++;
      } else if (contObjMatch && items.length > 0 && typeof items[items.length - 1] === 'object') {
        // Continuation of last object (shouldn't normally reach here but be safe)
        items[items.length - 1][contObjMatch[1]] = contObjMatch[2].trim();
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
      else { out.push('<pre><code>'); inCodeBlock = true; }
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
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMarkdown(str) {
  // Bold+italic
  str = str.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
  // Bold
  str = str.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  // Italic
  str = str.replace(/\*(.*?)\*/g, '<em>$1</em>');
  // Inline code
  str = str.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links
  str = str.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return str;
}

// ========== Dashboard CSS ==========

const DASHBOARD_CSS = `
:root {
  --bg: #f8f9fa;
  --surface: #ffffff;
  --border: #dee2e6;
  --text: #212529;
  --text-muted: #6c757d;
  --accent: #0d6efd;
  --accent-hover: #0b5ed7;
  --dark: #1a1a2e;
  --success: #198754;
  --warning: #fd7e14;
  --info: #0dcaf0;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  background: var(--bg); color: var(--text); line-height: 1.6; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
nav { background: var(--dark); padding: 0.75rem 1.5rem; display: flex; gap: 1.5rem; align-items: center; }
nav .brand { color: #fff; font-weight: 700; font-size: 1rem; margin-right: 1rem; }
nav a { color: rgba(255,255,255,0.75); font-size: 0.875rem; padding: 0.25rem 0.5rem;
  border-radius: 4px; transition: background 0.15s; }
nav a:hover, nav a.active { color: #fff; background: rgba(255,255,255,0.1); text-decoration: none; }
.container { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem; }
h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.5rem; }
h2 { font-size: 1.25rem; font-weight: 600; margin: 1.5rem 0 0.75rem; }
h3 { font-size: 1rem; font-weight: 600; margin: 1rem 0 0.5rem; }
p { margin-bottom: 0.75rem; }
ul { margin: 0.5rem 0 0.75rem 1.5rem; }
li { margin-bottom: 0.25rem; }
pre { background: var(--dark); color: #f8f9fa; padding: 1rem; border-radius: 6px;
  overflow-x: auto; margin: 0.75rem 0; }
code { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.875em; }
p code, li code { background: #e9ecef; padding: 0.1em 0.3em; border-radius: 3px; }
table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
th, td { padding: 0.5rem 0.75rem; border: 1px solid var(--border); text-align: left; }
th { background: #e9ecef; font-weight: 600; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.5rem 0; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 1.25rem; text-align: center; }
.stat-card .value { font-size: 2rem; font-weight: 700; color: var(--accent); line-height: 1; }
.stat-card .label { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem; text-transform: uppercase; letter-spacing: 0.05em; }
.card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin: 1.5rem 0; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 1.25rem; transition: box-shadow 0.15s; }
.card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
.card h3 { margin-top: 0; }
.card .meta { font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem; }
.kanban { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin: 1.5rem 0; align-items: start; }
.kanban-col { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.kanban-col .col-header { background: #e9ecef; padding: 0.75rem 1rem; font-weight: 600;
  font-size: 0.875rem; text-transform: uppercase; letter-spacing: 0.05em; }
.kanban-col .col-body { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
.kanban-item { background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem;
  font-size: 0.875rem; }
.kanban-item a { color: var(--text); font-weight: 500; }
.kanban-item a:hover { color: var(--accent); text-decoration: none; }
.tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 1.5rem; }
.tab { padding: 0.625rem 1rem; cursor: pointer; border-bottom: 2px solid transparent;
  margin-bottom: -2px; font-size: 0.875rem; font-weight: 500; color: var(--text-muted); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
.tab-panel { display: none; }
.tab-panel.active { display: block; }
.badge { display: inline-block; padding: 0.2em 0.5em; border-radius: 4px; font-size: 0.75rem;
  font-weight: 600; background: #e9ecef; color: var(--text); }
.empty-state { text-align: center; padding: 4rem 2rem; color: var(--text-muted); }
.empty-state h2 { color: var(--text); margin-bottom: 0.5rem; }
.empty-state code { background: #e9ecef; padding: 0.25rem 0.5rem; border-radius: 4px;
  font-size: 0.9rem; color: var(--accent); }
.page-header { margin-bottom: 2rem; }
.page-header .subtitle { color: var(--text-muted); margin-top: 0.25rem; }
`;

// ========== Dashboard HTML Shell ==========

function dashboardPage(title, activeNav, bodyContent) {
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: '/landscape', label: 'Landscape' },
    { href: '/strategy', label: 'Strategy' },
    { href: '/competitors', label: 'Competitors' },
    { href: '/research', label: 'Research' },
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
<title>${escHtml(title)} - PM Dashboard</title>
<style>${DASHBOARD_CSS}</style>
</head>
<body>
<nav>
  <span class="brand">PM Dashboard</span>
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

// ========== Dashboard Route Handlers ==========

function routeDashboard(req, res, pmDir) {
  const url = req.url.split('?')[0];
  const pmExists = fs.existsSync(pmDir);

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
  } else if (url === '/landscape') {
    handleMarkdownPage(res, pmDir, 'landscape.md', 'Landscape', '/landscape');
  } else if (url === '/strategy') {
    handleMarkdownPage(res, pmDir, 'strategy.md', 'Strategy', '/strategy');
  } else if (url === '/competitors') {
    handleCompetitorsList(res, pmDir);
  } else if (url.startsWith('/competitors/')) {
    const slug = url.slice('/competitors/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/')) {
      handleCompetitorDetail(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (url === '/research') {
    handleResearchList(res, pmDir);
  } else if (url.startsWith('/research/')) {
    const topic = url.slice('/research/'.length).replace(/\/$/, '');
    if (topic && !topic.includes('/')) {
      handleResearchTopic(res, pmDir, topic);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else if (url === '/backlog') {
    handleBacklog(res, pmDir);
  } else if (url.startsWith('/backlog/')) {
    const slug = url.slice('/backlog/'.length).replace(/\/$/, '');
    if (slug && !slug.includes('/')) {
      handleBacklogItem(res, pmDir, slug);
    } else {
      res.writeHead(404); res.end('Not found');
    }
  } else {
    res.writeHead(404); res.end('Not found');
  }
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

  const statCards = [
    { value: stats.total, label: 'Total Files' },
    { value: stats.competitors, label: 'Competitors' },
    { value: stats.backlog, label: 'Backlog Items' },
    { value: stats.research, label: 'Research Topics' },
  ].map(s => `<div class="stat-card"><div class="value">${s.value}</div><div class="label">${s.label}</div></div>`).join('');

  const sections = [
    { href: '/landscape', title: 'Market Landscape', desc: 'Competitive landscape and market overview' },
    { href: '/strategy', title: 'Strategy', desc: 'Product strategy and roadmap direction' },
    { href: '/competitors', title: 'Competitors', desc: `${stats.competitors} competitor profiles` },
    { href: '/research', title: 'Research', desc: `${stats.research} research topics` },
    { href: '/backlog', title: 'Backlog', desc: `${stats.backlog} backlog items` },
  ].map(s => `<div class="card"><h3><a href="${s.href}">${s.title}</a></h3><p class="meta">${s.desc}</p></div>`).join('');

  const body = `
<div class="page-header">
  <h1>PM Dashboard</h1>
  <p class="subtitle">Knowledge base overview</p>
</div>
<div class="stat-grid">${statCards}</div>
<h2>Sections</h2>
<div class="card-grid">${sections}</div>`;

  const html = dashboardPage('Home', '/', body);
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

function handleCompetitorsList(res, pmDir) {
  const compDir = path.join(pmDir, 'competitors');
  let cards = '';

  if (fs.existsSync(compDir)) {
    const slugs = fs.readdirSync(compDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    cards = slugs.map(slug => {
      const overviewPath = path.join(compDir, slug, 'overview.md');
      let name = slug;
      if (fs.existsSync(overviewPath)) {
        const { data } = parseFrontmatter(fs.readFileSync(overviewPath, 'utf-8'));
        if (data.name) name = data.name;
      }
      return `<div class="card"><h3><a href="/competitors/${escHtml(slug)}">${escHtml(name)}</a></h3>
<p class="meta">${escHtml(slug)}</p></div>`;
    }).join('');
  }

  const body = `
<div class="page-header"><h1>Competitors</h1></div>
${cards ? '<div class="card-grid">' + cards + '</div>' : '<div class="empty-state"><p>No competitor profiles yet.</p></div>'}`;

  const html = dashboardPage('Competitors', '/competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleCompetitorDetail(res, pmDir, slug) {
  const compDir = path.join(pmDir, 'competitors', slug);
  if (!fs.existsSync(compDir)) {
    res.writeHead(404); res.end('Competitor not found');
    return;
  }

  const sections = ['overview', 'positioning', 'features', 'pricing', 'weaknesses'];
  let name = slug;

  const tabHeaders = [];
  const tabPanels = [];

  sections.forEach((sec, idx) => {
    const filePath = path.join(compDir, sec + '.md');
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, body } = parseFrontmatter(raw);
    if (idx === 0 && data.name) name = data.name;
    const label = sec.charAt(0).toUpperCase() + sec.slice(1);
    const isFirst = tabHeaders.length === 0;
    tabHeaders.push(`<div class="tab${isFirst ? ' active' : ''}" onclick="switchTab(this,'tab-${sec}')">${label}</div>`);
    tabPanels.push(`<div id="tab-${sec}" class="tab-panel${isFirst ? ' active' : ''}">${renderMarkdown(body)}</div>`);
  });

  const body = `
<div class="page-header"><h1>${escHtml(name)}</h1><p class="subtitle">Competitor profile</p></div>
<div class="tabs">${tabHeaders.join('')}</div>
${tabPanels.join('')}
<script>
function switchTab(el, panelId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(panelId).classList.add('active');
}
</script>`;

  const html = dashboardPage(name, '/competitors', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleResearchList(res, pmDir) {
  const researchDir = path.join(pmDir, 'research');
  let items = '';

  if (fs.existsSync(researchDir)) {
    // Read index.md if present
    const indexPath = path.join(researchDir, 'index.md');
    let indexHtml = '';
    if (fs.existsSync(indexPath)) {
      const { body } = parseFrontmatter(fs.readFileSync(indexPath, 'utf-8'));
      indexHtml = renderMarkdown(body);
    }

    const topics = fs.readdirSync(researchDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);

    items = indexHtml + (topics.length > 0
      ? '<ul>' + topics.map(t =>
          `<li><a href="/research/${escHtml(t)}">${escHtml(t)}</a></li>`
        ).join('') + '</ul>'
      : '');
  }

  const body = `
<div class="page-header"><h1>Research</h1></div>
${items || '<div class="empty-state"><p>No research topics yet.</p></div>'}`;

  const html = dashboardPage('Research', '/research', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleResearchTopic(res, pmDir, topic) {
  const topicDir = path.join(pmDir, 'research', topic);
  const findingsPath = path.join(topicDir, 'findings.md');

  if (!fs.existsSync(findingsPath)) {
    res.writeHead(404); res.end('Research topic not found');
    return;
  }

  const raw = fs.readFileSync(findingsPath, 'utf-8');
  const { body } = parseFrontmatter(raw);

  const html = dashboardPage(topic, '/research', `
<div class="page-header"><h1>${escHtml(topic)}</h1><p class="subtitle"><a href="/research">Research</a></p></div>
<div class="markdown-body">${renderMarkdown(body)}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleBacklog(res, pmDir) {
  const backlogDir = path.join(pmDir, 'backlog');
  const columns = {};

  if (fs.existsSync(backlogDir)) {
    const files = fs.readdirSync(backlogDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const raw = fs.readFileSync(path.join(backlogDir, file), 'utf-8');
      const { data } = parseFrontmatter(raw);
      const status = data.status || 'todo';
      const title = data.title || file.replace('.md', '');
      const slug = file.replace('.md', '');
      if (!columns[status]) columns[status] = [];
      columns[status].push({ slug, title });
    }
  }

  const STATUS_ORDER = ['todo', 'in-progress', 'done'];
  // Include any statuses found in files even if not in default order
  const allStatuses = [...new Set([...STATUS_ORDER, ...Object.keys(columns)])];

  const cols = allStatuses.filter(s => columns[s] && columns[s].length > 0).map(status => {
    const items = columns[status].map(item =>
      `<div class="kanban-item"><a href="/backlog/${escHtml(item.slug)}">${escHtml(item.title)}</a></div>`
    ).join('');
    const label = status.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return `<div class="kanban-col">
  <div class="col-header">${label}</div>
  <div class="col-body">${items}</div>
</div>`;
  }).join('');

  const body = `
<div class="page-header"><h1>Backlog</h1></div>
<div class="kanban">${cols || '<p>No backlog items yet.</p>'}</div>`;

  const html = dashboardPage('Backlog', '/backlog', body);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function handleBacklogItem(res, pmDir, slug) {
  const filePath = path.join(pmDir, 'backlog', slug + '.md');
  if (!fs.existsSync(filePath)) {
    res.writeHead(404); res.end('Backlog item not found');
    return;
  }
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, body } = parseFrontmatter(raw);
  const title = data.title || slug;

  const html = dashboardPage(title, '/backlog', `
<div class="page-header"><h1>${escHtml(title)}</h1><p class="subtitle"><a href="/backlog">Backlog</a></p></div>
<div class="markdown-body">${renderMarkdown(body)}</div>`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

// ========== Dashboard Server Factory ==========

function createDashboardServer(pmDir) {
  const dashClients = new Set();
  // Track all raw connections so we can force-close them when stopping
  const allConnections = new Set();

  function handleDashboardUpgrade(req, socket) {
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

  // Watch pm/ directory for changes (recursive on supported platforms)
  let pmWatcher = null;
  let watcherActive = false;
  if (fs.existsSync(pmDir)) {
    watcherActive = true;
    const onWatchEvent = (eventType, filename) => {
      if (!filename || !watcherActive) return;
      broadcastDashboard({ type: 'reload' });
    };
    try {
      pmWatcher = fs.watch(pmDir, { recursive: true }, onWatchEvent);
    } catch (e) {
      // recursive not available on this platform, fall back
      try {
        pmWatcher = fs.watch(pmDir, onWatchEvent);
      } catch (err) {}
    }
    if (pmWatcher) {
      pmWatcher.on('error', () => {}); // swallow ENOENT and other watch errors
    }
  }

  // Patch server.close to also destroy all open connections and close watcher
  const origClose = server.close.bind(server);
  server.close = function(cb) {
    // Stop the watcher first so no more broadcasts fire during teardown
    watcherActive = false;
    if (pmWatcher) {
      try { pmWatcher.close(); } catch (e) {}
      pmWatcher = null;
    }
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
    const info = JSON.stringify({
      type: 'server-started', port: Number(PORT), host: HOST,
      url_host: URL_HOST, url: 'http://' + URL_HOST + ':' + PORT,
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
  parseMode, parseFrontmatter, renderMarkdown,
  createDashboardServer,
};
