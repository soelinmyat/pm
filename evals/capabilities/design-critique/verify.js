"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveBrowser, runBrowserProbe } = require("../../../scripts/artifact-render-check.js");

const SETTLEMENT_PATTERN_DECLARATIONS = [
  "const pendingPattern = /\\b(?:saving|loading|updating)\\b/i;",
  "const failurePattern = /\\b(?:fail(?:ed|ure)?|error|wrong|unable|unsuccessful(?:ly)?)\\b|could not|did not|\\b(?:no|not|never|nothing|none|without|wasn['’]t|weren['’]t|isn['’]t|aren['’]t|hasn['’]t|haven['’]t|couldn['’]t|didn['’]t|won['’]t)\\b[^,;:.!?\\n]{0,80}\\b(?:sav(?:e|ed|ing)|updat(?:e|ed|ing)|success(?:ful(?:ly)?)?|complet(?:e|ed|ing)|done)\\b/i;",
  "const successPattern = /\\b(?:saved|updated|success(?:ful(?:ly)?)?|complete(?:d)?|done)\\b/i;",
].join("\n      ");

const CHECKS = Object.freeze({
  "responsive-shell-overflow": {
    viewport: { width: 375, height: 812 },
    expression: "document.documentElement.scrollWidth <= window.innerWidth + 1",
  },
  "export-heading-occlusion": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      const action = document.querySelector(".export-action");
      const heading = document.querySelector("h1");
      if (!action || !heading) return false;
      const left = action.getBoundingClientRect();
      const right = heading.getBoundingClientRect();
      return !(left.right > right.left && left.left < right.right && left.bottom > right.top && left.top < right.bottom);
    })()`,
  },
  "focus-indicator-suppressed": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      const actions = Array.from(document.querySelectorAll("button, a[href]"));
      if (actions.length === 0) return false;
      return actions.every((element) => {
        element.focus();
        const style = getComputedStyle(element);
        const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
        const shadowed = style.boxShadow !== "none" && style.boxShadow !== "rgba(0, 0, 0, 0) 0px 0px 0px 0px";
        return document.activeElement === element && (outlined || shadowed);
      });
    })()`,
  },
  "row-action-target-small": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      const actions = Array.from(document.querySelectorAll(".icon-button"));
      return actions.length > 0 && actions.every((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 44 && rect.height >= 44;
      });
    })()`,
  },
  "print-chrome-obscures-content": {
    viewport: { width: 900, height: 800 },
    emulatedMedia: "print",
    expression: `(() => {
      const hidden = (element) => {
        if (!element) return true;
        const style = getComputedStyle(element);
        return style.display === "none" || style.visibility === "hidden";
      };
      const main = document.querySelector("main");
      if (!main || !hidden(document.querySelector("nav")) || !hidden(document.querySelector(".export-action"))) return false;
      const content = main.getBoundingClientRect();
      return Array.from(document.querySelectorAll("button, nav, [role=button]"))
        .filter((element) => !hidden(element) && getComputedStyle(element).position === "fixed")
        .every((element) => {
          const rect = element.getBoundingClientRect();
          return !(rect.right > content.left && rect.left < content.right && rect.bottom > content.top && rect.top < content.bottom);
        });
    })()`,
  },
  "modal-semantics-missing": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      document.querySelector("#invite")?.click();
      const dialog = document.querySelector(".dialog");
      const visible = dialog && getComputedStyle(dialog).display !== "none" && dialog.getBoundingClientRect().width > 0;
      return Boolean(visible && dialog.getAttribute("role") === "dialog" && dialog.getAttribute("aria-modal") === "true");
    })()`,
  },
  "modal-initial-focus-missing": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      document.querySelector("#invite")?.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const dialog = document.querySelector(".dialog");
      return Boolean(dialog && dialog.contains(document.activeElement) && document.activeElement !== dialog);
    })()`,
  },
  "modal-escape-close-missing": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const invite = document.querySelector("#invite");
      invite?.focus();
      invite?.click();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      const scrim = document.querySelector("#scrim");
      const hidden = !scrim || getComputedStyle(scrim).display === "none" || scrim.hidden;
      return Boolean(hidden && document.activeElement === invite);
    })()`,
  },
  "modal-focus-trap-missing": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      document.querySelector("#invite")?.click();
      const dialog = document.querySelector(".dialog");
      const controls = dialog ? Array.from(dialog.querySelectorAll("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])")) : [];
      if (controls.length < 2) return false;
      const first = controls[0];
      const last = controls[controls.length - 1];
      last.focus();
      last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      const forwardWrapped = document.activeElement === first;
      first.focus();
      first.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      return forwardWrapped && document.activeElement === last;
    })()`,
  },
  "modal-background-interactive": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      document.querySelector("#invite")?.click();
      const main = document.querySelector("main");
      return Boolean(main && (main.inert === true || main.getAttribute("aria-hidden") === "true"));
    })()`,
  },
  "modal-return-focus-missing": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const invite = document.querySelector("#invite");
      const closeAndCheck = async (selector) => {
        invite?.click();
        document.querySelector(selector)?.click();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const scrim = document.querySelector("#scrim");
        const hidden = !scrim || getComputedStyle(scrim).display === "none" || scrim.hidden;
        return hidden && document.activeElement === invite;
      };
      return Boolean(invite && await closeAndCheck("#cancel") && await closeAndCheck("#send"));
    })()`,
  },
  "loading-allows-repeat-submit": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const email = document.querySelector("#team-email");
      const submit = document.querySelector("button[type=submit]");
      const notice = document.querySelector("#notice");
      if (!email || !submit || !notice) return false;
      ${SETTLEMENT_PATTERN_DECLARATIONS}
      email.value = "delivery@example.com";
      submit.click();
      if (submit.disabled !== true) return false;
      const deadline = Date.now() + 5000;
      let observedSaving = false;
      while (Date.now() < deadline) {
        const message = (notice.textContent || "").trim();
        if (failurePattern.test(message)) return false;
        if (pendingPattern.test(message)) {
          observedSaving = true;
          if (submit.disabled !== true) return false;
        } else if (successPattern.test(message)) {
          if (observedSaving && submit.disabled === false) return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    })()`,
  },
  "loading-status-unannounced": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const notice = document.querySelector("#notice");
      const submit = document.querySelector("button[type=submit]");
      if (!notice || !submit) return false;
      submit.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const live = notice.getAttribute("role") === "status" || ["polite", "assertive"].includes(notice.getAttribute("aria-live"));
      return live && /saving|loading|updating/i.test(notice.textContent || "");
    })()`,
  },
  "validation-error-unbound": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const email = document.querySelector("#team-email");
      const submit = document.querySelector("button[type=submit]");
      if (!email || !submit) return false;
      email.value = "not-an-email";
      submit.click();
      await new Promise((resolve) => setTimeout(resolve, 30));
      const ids = (email.getAttribute("aria-describedby") || "").trim().split(/\\s+/).filter(Boolean);
      return email.getAttribute("aria-invalid") === "true" && ids.length > 0 && ids.every((id) => (document.getElementById(id)?.textContent || "").trim());
    })()`,
  },
  "success-feedback-ephemeral": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const email = document.querySelector("#team-email");
      const submit = document.querySelector("button[type=submit]");
      const notice = document.querySelector("#notice");
      if (!email || !submit || !notice) return false;
      ${SETTLEMENT_PATTERN_DECLARATIONS}
      email.value = "delivery@example.com";
      submit.click();
      const deadline = Date.now() + 5000;
      let observedSaving = false;
      let observedSuccess = false;
      while (Date.now() < deadline) {
        const message = (notice.textContent || "").trim();
        if (failurePattern.test(message)) return false;
        if (pendingPattern.test(message)) observedSaving = true;
        if (observedSaving && successPattern.test(message)) {
          observedSuccess = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!observedSuccess) return false;
      const persistenceDeadline = Date.now() + 4100;
      while (Date.now() < persistenceDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const message = (notice.textContent || "").trim();
        if (failurePattern.test(message) || pendingPattern.test(message) || !successPattern.test(message)) {
          return false;
        }
      }
      return true;
    })()`,
  },
  "secondary-action-competes": {
    viewport: { width: 900, height: 800 },
    expression: `(() => {
      const primary = document.querySelector("button[type=submit]");
      const secondary = document.querySelector("#test");
      if (!primary || !secondary) return false;
      const left = getComputedStyle(primary);
      const right = getComputedStyle(secondary);
      return left.backgroundColor !== right.backgroundColor || left.color !== right.color || left.borderColor !== right.borderColor;
    })()`,
  },
  "failure-has-no-recovery": {
    viewport: { width: 900, height: 800 },
    expression: `(async () => {
      const trigger = document.querySelector("#test");
      const notice = document.querySelector("#notice");
      if (!trigger || !notice) return false;
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const message = (notice.textContent || "").trim();
      const identifiesAction = /test|send|notification/i.test(message) && /fail|error|wrong|unable/i.test(message);
      const recovery = Array.from(document.querySelectorAll("button, a[href]"))
        .some((element) => /retry|try again|resend/i.test(element.textContent || ""));
      return identifiesAction && recovery;
    })()`,
  },
});

function validateVerifierCoverage(oracle) {
  const expected = new Set(oracle.cases.flatMap((item) => item.defects.map((defect) => defect.id)));
  const actual = new Set(Object.keys(CHECKS));
  const issues = [];
  for (const id of expected) if (!actual.has(id)) issues.push(`missing fix verifier for ${id}`);
  for (const id of actual) if (!expected.has(id)) issues.push(`unknown fix verifier ${id}`);
  return issues;
}

function verifyPostSubject({ oracleCase, htmlPath, browserPath, probe = runBrowserProbe }) {
  for (const defect of oracleCase.defects) {
    if (!CHECKS[defect.id]) throw new Error(`no fix verifier is registered for ${defect.id}`);
  }
  let snapshot;
  try {
    snapshot = snapshotSafePostSubject(htmlPath);
  } catch {
    return oracleCase.defects.map((defect) => indeterminateResult(defect, CHECKS[defect.id]));
  }
  try {
    if (oracleCase.defects.length === 0) return [];
    let resolvedBrowser;
    try {
      resolvedBrowser = resolveBrowser(browserPath);
    } catch {
      resolvedBrowser = null;
    }
    return oracleCase.defects.map((defect) => {
      const check = CHECKS[defect.id];
      const base = resultIdentity(defect, check);
      if (!resolvedBrowser) return { ...base, status: "indeterminate" };
      try {
        const result = probe(
          {
            browserPath: resolvedBrowser,
            htmlPath: snapshot.htmlPath,
            viewport: check.viewport,
            expression: check.expression,
            networkIsolation: true,
            ...(check.emulatedMedia ? { emulatedMedia: check.emulatedMedia } : {}),
          },
          `fix verification ${defect.id}`
        );
        return { ...base, status: JSON.parse(result.stdout) === true ? "pass" : "fail" };
      } catch {
        return { ...base, status: "indeterminate" };
      }
    });
  } finally {
    snapshot.cleanup();
  }
}

function assertSafePostSubject(htmlPath) {
  assertSafeHtml(readPinnedPostSubject(htmlPath).toString("utf8"));
}

function assertSafeHtml(html) {
  const forbidden = [
    { pattern: /\b(?:https?|wss?|ftp|file):/i, reason: "URL scheme" },
    {
      pattern:
        /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|SharedWorker|Worker)\s*(?:\(|\.)/i,
      reason: "network-capable API",
    },
    { pattern: /navigator\s*\.\s*serviceWorker|\bimport\s*\(/i, reason: "active loader" },
    {
      pattern:
        /<(?:script|link|img|iframe|object|embed|source|audio|video)\b[^>]*\b(?:src|href)\s*=/i,
      reason: "external resource element",
    },
    { pattern: /\burl\s*\(/i, reason: "CSS resource URL" },
    { pattern: /<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i, reason: "meta refresh" },
    { pattern: /<form\b[^>]*\baction\s*=/i, reason: "form action" },
  ];
  const match = forbidden.find((entry) => entry.pattern.test(html));
  if (match) throw new Error(`post-run subject contains forbidden ${match.reason}`);
}

function snapshotSafePostSubject(htmlPath) {
  const bytes = readPinnedPostSubject(htmlPath);
  assertSafeHtml(bytes.toString("utf8"));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dc-fix-verify-"));
  const snapshotPath = path.join(directory, "subject.html");
  try {
    fs.writeFileSync(snapshotPath, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    htmlPath: snapshotPath,
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function readPinnedPostSubject(htmlPath) {
  const descriptor = fs.openSync(htmlPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n) {
      throw new Error("post-run subject must be a regular non-linked file");
    }
    if (before.size > BigInt(4 * 1024 * 1024)) {
      throw new Error("post-run subject exceeds 4194304 bytes");
    }
    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) throw new Error("post-run subject ended before its pinned size");
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("post-run subject changed during bounded read");
    }
    return bytes;
  } finally {
    fs.closeSync(descriptor);
  }
}

function resultIdentity(defect, check) {
  return {
    oracle_id: defect.id,
    fix_oracle_sha256: digest(defect.fix_oracle),
    verification_sha256: check
      ? digest(JSON.stringify({ version: 1, network_isolation: true, check }))
      : null,
  };
}

function indeterminateResult(defect, check) {
  return { ...resultIdentity(defect, check), status: "indeterminate" };
}

function digest(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

module.exports = {
  CHECKS,
  assertSafePostSubject,
  validateVerifierCoverage,
  verifyPostSubject,
};
