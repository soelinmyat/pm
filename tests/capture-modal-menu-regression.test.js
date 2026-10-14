"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { resolveBrowser, runCaptureProbe } = require("../scripts/design-critique-capture");
const { normalizeAuditBytes } = require("../scripts/design-critique-audit-normalize");

let browser;
try {
  browser = resolveBrowser();
} catch {
  /* Retain the native capability limitation, as in existing capture suites. */
}
const skip = process.env.PM_SKIP_BROWSER_TESTS || (!browser && "Chromium is unavailable");

async function fixture(t, scenario) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-modal-menu-test-"));
  const script = `
    const scenario=${JSON.stringify(scenario)};
    const trigger=document.getElementById('reviewer');
    const content=scenario==='main-self-hidden'?document.querySelector('main'):document.getElementById('application');
    let dialog;
    if(scenario==='inside-dialog'){
      dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Navigation');
      for(const id of ['before','reviewer','after'])dialog.append(document.getElementById(id));document.body.append(dialog);content.setAttribute('aria-hidden','true');
    }
    const close=()=>{document.getElementById('review-menu')?.remove();if(dialog)dialog.removeAttribute('aria-hidden');else content.removeAttribute('aria-hidden');trigger.setAttribute('aria-expanded','false');trigger.focus();};
    const open=(keyboard=false)=>{
      if(document.getElementById('review-menu'))return;
      content.setAttribute('aria-hidden','true');trigger.setAttribute('aria-expanded','true');
      if(dialog)dialog.setAttribute('aria-hidden','true');
      const menu=document.createElement('div');menu.id='review-menu';menu.setAttribute('role','menu');menu.tabIndex=-1;
      if(scenario!=='unnamed')menu.setAttribute('aria-labelledby','reviewer');
      menu.innerHTML='<div role="menuitem" tabindex="-1">Profile</div><div role="menuitem" tabindex="-1">Account settings</div><div role="menuitem" tabindex="-1" id="signout" data-pm-state="primary">Sign out</div>';
      if(scenario==='checked-items'){
        menu.children[0].setAttribute('role','menuitemcheckbox');menu.children[0].setAttribute('aria-checked','false');
        menu.children[1].setAttribute('role','menuitemradio');menu.children[1].setAttribute('aria-checked','true');
      }
      if(scenario==='disabled-item')menu.children[1].setAttribute('aria-disabled','true');
      menu.addEventListener('keydown',event=>{
        if(event.key==='Tab'){event.preventDefault();return;}
        if(event.key==='Escape'){event.preventDefault();close();return;}
        if(scenario==='broken-arrows')return;
        if(!['ArrowDown','ArrowUp'].includes(event.key))return;
        event.preventDefault();const items=[...menu.querySelectorAll('[role^=menuitem]')].filter(item=>item.getAttribute('aria-disabled')!=='true');let i=items.indexOf(document.activeElement);
        i=event.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;
        items.forEach((item,n)=>item.tabIndex=n===i?0:-1);items[i].focus();
      });document.body.append(menu);
      if(keyboard){const first=menu.firstElementChild;first.tabIndex=0;first.focus();}else menu.focus();
    };
    trigger.addEventListener('click',()=>open());
    trigger.addEventListener('keydown',event=>{if(event.key==='ArrowDown'&&scenario!=='broken-entry'){event.preventDefault();open(true);}});
    trigger.click();
  `;
  const html = `<!doctype html><html lang="en"><head><title>Reviewer menu</title><link rel="icon" href="data:,"><style>body{font:16px sans-serif;padding:32px}button,[role=menuitem]{padding:12px}#review-menu{border:1px solid;padding:8px;width:220px}</style></head><body><div id="application"><main><h1>Account profile</h1><p>Review your account details and return to your work.</p><button id="before">Edit account</button><button id="reviewer" aria-haspopup="menu" aria-expanded="false" aria-controls="review-menu">Review owner</button><button id="after">Help</button>${scenario === "ambiguous-trigger" ? '<button id="reviewer" hidden>Other owner</button>' : ""}</main></div><script>${script}</script></body></html>`;
  const server = spawn(
    process.execPath,
    [
      "-e",
      `const http=require('node:http');const html=${JSON.stringify(html)};const server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end(html)});server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port+'/'));`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  t.after(() => {
    server.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let setupError = "";
  server.stderr.on("data", (bytes) => {
    setupError += String(bytes).slice(0, 2000);
  });
  const [bytes] = await Promise.race([
    once(server.stdout, "data"),
    once(server, "exit").then(([code]) => {
      throw new Error(`Fixture server exited ${code}: ${setupError}`);
    }),
  ]);
  const url = String(bytes).trim();
  return {
    browserPath: browser,
    url,
    expectedUrl: url,
    allowedOrigins: [new URL(url).origin],
    viewport: { width: 1280, height: 800 },
    readinessTimeoutMs: 5000,
    settleMs: 200,
    outputPath: path.join(root, "capture.png"),
    verificationPath: path.join(root, "verification.png"),
    stateAssertion: {
      schema_version: 2,
      subject_id: "account-menu",
      coverage_id: "account-menu-primary-desktop",
      state: "primary",
      state_marker: {
        locator: { by: "id", value: "signout" },
        attribute: "data-pm-state",
        value: "primary",
      },
      all: [
        { locator: { by: "role-name", value: "menuitem:Sign out" }, expect: { kind: "visible" } },
      ],
    },
  };
}

function audit(result) {
  const raw = {
    schema_version: 1,
    kind: "accessibility-tree",
    subject_id: "account-menu",
    commit: "a".repeat(40),
    capture_ids: ["capture-account-menu"],
    observations: result.accessibility_observations,
  };
  const bytes = Buffer.from(JSON.stringify(raw));
  return normalizeAuditBytes(bytes, {
    path: "evidence/menu-raw.json",
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  });
}

test(
  "proves native entry and arrows for a named modal menu with hidden background main",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t, "working"));
    assert.equal(result.assertion_passed, true);
    assert.deepEqual(audit(result).checks, { landmarks: true, names: true, focus_order: true });
    assert.deepEqual(audit(result).findings, []);
  }
);

for (const scenario of ["checked-items", "disabled-item", "inside-dialog", "main-self-hidden"]) {
  test(
    `proves native traversal of ${scenario} without activating menu actions`,
    { skip },
    async (t) => {
      const result = runCaptureProbe(await fixture(t, scenario));
      assert.deepEqual(audit(result).checks, { landmarks: true, names: true, focus_order: true });
      assert.deepEqual(audit(result).findings, []);
    }
  );
}

for (const scenario of ["broken-entry", "broken-arrows", "unnamed", "ambiguous-trigger"]) {
  test(`keeps ${scenario} menu scope non-passing`, { skip }, async (t) => {
    const result = runCaptureProbe(await fixture(t, scenario));
    const normalized = audit(result);
    assert.equal(normalized.checks.landmarks && normalized.checks.focus_order, false);
    assert.ok(normalized.findings.length > 0);
  });
}
