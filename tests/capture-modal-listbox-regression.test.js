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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-modal-listbox-test-"));
  const script = `
    const scenario=${JSON.stringify(scenario)};
    const trigger=document.getElementById('reviewer');
    const content=scenario==='main-self-hidden'?document.querySelector('main'):document.getElementById('application');
    if(scenario==='unowned-traversable')trigger.removeAttribute('aria-controls');
    if(['unnamed-trigger','unnamed'].includes(scenario))trigger.removeAttribute('aria-label');
    if(scenario==='implicit-owner'){trigger.removeAttribute('aria-haspopup');trigger.removeAttribute('aria-label');const label=document.createElement('label');label.htmlFor='reviewer';label.textContent='Language';trigger.before(label);}
    if(scenario==='incompatible-popup')trigger.setAttribute('aria-haspopup','menu');
    if(scenario==='unreachable-trigger')trigger.tabIndex=-1;
    if(scenario==='unsupported-trigger')trigger.setAttribute('role','button');
    if(scenario==='ambiguous-owner'){const other=trigger.cloneNode(true);other.id='other';other.hidden=true;trigger.after(other);}
    let dialog;
    if(scenario==='inside-dialog'){
      dialog=document.createElement('div');dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Navigation');
      for(const id of ['before','reviewer','after'])dialog.append(document.getElementById(id));document.body.append(dialog);content.setAttribute('aria-hidden','true');
    }
    const close=()=>{const menu=document.getElementById('review-menu');if(scenario==='retained-hidden')menu.hidden=true;else if(scenario!=='still-exposed')menu?.remove();if(dialog)dialog.removeAttribute('aria-hidden');else content.removeAttribute('aria-hidden');trigger.setAttribute('aria-expanded','false');trigger.focus();};
    const open=(keyboard=false)=>{
      const retained=document.getElementById('review-menu');if(retained){if(!retained.hidden)return;retained.remove();}
      if(scenario!=='document-menu')content.setAttribute('aria-hidden','true');trigger.setAttribute('aria-expanded','true');
      if(dialog)dialog.setAttribute('aria-hidden','true');
      const menu=document.createElement('div');menu.id='review-menu';menu.setAttribute('role','listbox');menu.tabIndex=['unowned-traversable','document-menu'].includes(scenario)?0:-1;
      if(!['unnamed','implicit-owner'].includes(scenario)) {
        if(scenario==='independent-name')menu.setAttribute('aria-label','Available languages');
        else menu.setAttribute('aria-labelledby','reviewer');
      }
      if(keyboard&&scenario==='popup-id-drift')menu.id='other-popup';
      menu.innerHTML='<div role="option" tabindex="-1">Profile</div><div role="option" tabindex="-1">Account settings</div><div role="option" tabindex="-1" id="signout" data-pm-state="primary">Sign out</div>';
      if(scenario==='checked-items'){
        menu.children[0].setAttribute('role','optioncheckbox');menu.children[0].setAttribute('aria-checked','false');
        menu.children[1].setAttribute('role','optionradio');menu.children[1].setAttribute('aria-checked','true');
      }
      if(scenario==='disabled-item')menu.children[1].setAttribute('aria-disabled','true');
      if(keyboard&&scenario==='member-name-drift')menu.children[1].textContent='Changed language';
      if(scenario==='owner-only-arrows')menu.children[1].remove();
      menu.addEventListener('keydown',event=>{
        if(event.key==='Tab'){if(!['unowned-traversable','document-menu'].includes(scenario))event.preventDefault();return;}
        if(event.key==='Escape'){event.preventDefault();close();return;}
        if(scenario==='broken-arrows'||(scenario==='owner-only-arrows'&&event.target!==menu))return;
        if(!['ArrowDown','ArrowUp'].includes(event.key))return;
        event.preventDefault();const items=[...menu.querySelectorAll('[role^=option]')].filter(item=>item.getAttribute('aria-disabled')!=='true');let i=items.indexOf(document.activeElement);
        if(scenario==='owner-only-arrows'&&event.key==='ArrowUp'&&i===-1)i=0;
        i=scenario==='endpoints'
          ? Math.max(0,Math.min(items.length-1,i+(event.key==='ArrowDown'?1:-1)))
          : event.key==='ArrowDown'?(i+1)%items.length:(i-1+items.length)%items.length;
        items.forEach((item,n)=>item.tabIndex=n===i?0:-1);items[i].focus();
        if(scenario==='arrow-name-drift')items[0].textContent='Changed language';
        if(scenario==='owner-name-drift')trigger.setAttribute('aria-label','Changed owner');
        if(scenario==='ownership-drift')trigger.setAttribute('aria-controls','other-popup');
      });document.body.append(menu);
      if(scenario==='endpoints'){menu.children[1].setAttribute('aria-selected','true');menu.children[1].focus();}
      else if(keyboard){const first=menu.firstElementChild;first.tabIndex=0;first.focus();}else menu.focus();
    };
    trigger.addEventListener('click',event=>{if(event.isTrusted&&['broken-entry','space-only','submit-opener'].includes(scenario))return;open();});
    trigger.addEventListener('keydown',event=>{const key=scenario==='enter-only'||scenario==='submit-opener'?'Enter':scenario==='space-only'?' ':'ArrowDown';if(event.key===key&&scenario!=='broken-entry'){event.preventDefault();open(true);}});
    if(scenario==='submit-opener'){const form=document.createElement('form');trigger.before(form);form.append(trigger);form.addEventListener('submit',event=>event.preventDefault());}
    trigger.click();
    if(scenario==='foreign-focus'){const outside=document.createElement('button');outside.textContent='Outside';document.body.append(outside);outside.focus();}
  `;
  const html = `<!doctype html><html lang="en"><head><title>Language options</title><link rel="icon" href="data:,"><style>body{font:16px sans-serif;padding:32px}button,[role=option]{padding:12px}#review-menu{border:1px solid;padding:8px;width:220px}</style></head><body><div id="application"><main><h1>Account profile</h1><p>Review your account details and return to your work.</p><button id="before">Edit account</button><button id="reviewer" role="combobox" aria-label="Language" aria-haspopup="listbox" aria-expanded="false" aria-controls="review-menu">Language</button><button id="after">Help</button>${scenario === "ambiguous-trigger" ? '<button id="reviewer" hidden>Other owner</button>' : ""}</main></div><script>${script}</script></body></html>`;
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
        { locator: { by: "role-name", value: "option:Sign out" }, expect: { kind: "visible" } },
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
  "proves native entry and arrows for a named modal listbox with hidden background main",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t, "working"));
    assert.equal(result.assertion_passed, true);
    assert.deepEqual(audit(result).checks, { landmarks: true, names: true, focus_order: true });
    assert.deepEqual(audit(result).findings, []);
  }
);

for (const scenario of [
  "disabled-item",
  "retained-hidden",
  "enter-only",
  "space-only",
  "independent-name",
  "endpoints",
]) {
  test(`proves native listbox traversal of ${scenario}`, { skip }, async (t) => {
    const result = runCaptureProbe(await fixture(t, scenario));
    assert.deepEqual(audit(result).checks, { landmarks: true, names: true, focus_order: true });
  });
}
for (const scenario of [
  "broken-entry",
  "broken-arrows",
  "unnamed",
  "ambiguous-trigger",
  "unowned-traversable",
  "still-exposed",
  "submit-opener",
  "owner-only-arrows",
  "unnamed-trigger",
  "unreachable-trigger",
  "unsupported-trigger",
  "ambiguous-owner",
  "foreign-focus",
  "popup-id-drift",
  "member-name-drift",
  "arrow-name-drift",
  "incompatible-popup",
  "owner-name-drift",
  "ownership-drift",
]) {
  test(`keeps ${scenario} listbox scope non-passing`, { skip }, async (t) => {
    const result = runCaptureProbe(await fixture(t, scenario));
    assert.equal(audit(result).checks.landmarks && audit(result).checks.focus_order, false);
  });
}

test(
  "proves unnamed popup through a named native combobox with implicit listbox ownership",
  { skip },
  async (t) => {
    const result = runCaptureProbe(await fixture(t, "implicit-owner"));
    assert.deepEqual(audit(result).checks, { landmarks: true, names: true, focus_order: true });
    const popup = result.accessibility_observations.popups[0];
    assert.equal(popup.name, "");
    assert.deepEqual(popup.owner, {
      role: "combobox",
      name: "Language",
      locator: "button#reviewer",
    });
  }
);
