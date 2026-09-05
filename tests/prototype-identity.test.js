"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { buildPrototypeIdentity, validateDesignContext } = require("../scripts/lib/dev-work-units");
const { rfcIssuesToDevWorkUnits } = require("../scripts/lib/rfc-work-units");

function tempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pm-prototype-identity-"));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function write(root, relative, value) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
}

function assertRejectsAtomicSameSizeReplacement(options) {
  const { targetPath, replacementPath, replacement, run, expected } = options;
  const targetIdentity = fs.statSync(targetPath, { bigint: true });
  const replacementBytes = Buffer.from(replacement);
  assert.equal(BigInt(replacementBytes.length), targetIdentity.size);
  fs.writeFileSync(replacementPath, replacementBytes);

  const originalReadSync = fs.readSync;
  let replaced = false;
  fs.readSync = function replaceTargetAfterRead(descriptor, ...args) {
    const count = Reflect.apply(originalReadSync, fs, [descriptor, ...args]);
    const openedIdentity = fs.fstatSync(descriptor, { bigint: true });
    if (
      !replaced &&
      openedIdentity.dev === targetIdentity.dev &&
      openedIdentity.ino === targetIdentity.ino
    ) {
      fs.renameSync(replacementPath, targetPath);
      replaced = true;
    }
    return count;
  };

  try {
    assert.throws(run, expected);
    assert.equal(replaced, true);
  } finally {
    fs.readSync = originalReadSync;
    fs.rmSync(replacementPath, { force: true });
  }
}

function assertRejectsAncestorSymlinkSwap(options) {
  const { ancestorPath, attackerPath, targetPath, swapAt, restoreAt, run, expected } = options;
  const canonicalTargetPath = fs.realpathSync(targetPath);
  const originalPath = `${ancestorPath}.original`;
  const originalLstatSync = fs.lstatSync;
  let targetLstats = 0;
  let swapped = false;
  let restored = false;
  fs.lstatSync = function swapAncestorAroundLeafChecks(file, ...args) {
    const isTarget = path.resolve(String(file)) === canonicalTargetPath;
    if (isTarget) {
      targetLstats += 1;
      if (targetLstats === swapAt) {
        fs.renameSync(ancestorPath, originalPath);
        fs.symlinkSync(attackerPath, ancestorPath, "dir");
        swapped = true;
      }
    }
    const result = Reflect.apply(originalLstatSync, fs, [file, ...args]);
    if (isTarget && swapped && targetLstats === restoreAt) {
      fs.unlinkSync(ancestorPath);
      fs.renameSync(originalPath, ancestorPath);
      restored = true;
    }
    return result;
  };

  try {
    assert.throws(run, expected);
    assert.equal(swapped, true);
  } finally {
    fs.lstatSync = originalLstatSync;
    if (swapped && !restored) {
      fs.rmSync(ancestorPath, { force: true });
      fs.renameSync(originalPath, ancestorPath);
    }
  }
}

function writeMultiFilePrototype(root) {
  const prefix = "pm/backlog/wireframes/account-settings";
  write(root, `${prefix}/index.html`, '<a href="profile.html">Profile</a>\n');
  write(root, `${prefix}/base.css`, ".screen { display: grid; }\n");
  write(root, `${prefix}/profile.html`, '<section class="screen">Profile</section>\n');
  write(root, `${prefix}/security.html`, '<section class="screen">Security</section>\n');
  write(
    root,
    `${prefix}/meta.json`,
    `${JSON.stringify({
      slug: "account-settings",
      screens: [
        { id: "profile", label: "Profile", file: "profile.html", states: ["populated"] },
        {
          id: "security",
          label: "Security",
          file: "security.html",
          states: ["populated"],
        },
      ],
    })}\n`
  );
  return `${prefix}/index.html`;
}

function visualContext(prototype) {
  return {
    design_requirements: ["Keep account changes understandable and recoverable."],
    ui_impact: true,
    prototype,
    critical_states: ["populated", "error"],
    experience_invariants: ["Every setting change names its effect before it is saved."],
    visual_invariants: ["The save action remains visually subordinate until content changes."],
  };
}

test("multi-file prototype identity binds every file in a deterministic bounded tree", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const prototype = buildPrototypeIdentity(prototypePath, project.root);
    assert.equal(prototype.path, prototypePath);
    assert.deepEqual(
      prototype.manifest.files.map((entry) => entry.path),
      ["base.css", "index.html", "meta.json", "profile.html", "security.html"]
    );
    assert.match(prototype.manifest.tree_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      prototype.manifest.files.find((entry) => entry.path === "index.html").sha256,
      prototype.sha256
    );
    assert.doesNotThrow(() =>
      validateDesignContext(visualContext(prototype), "design_context", {
        repoRoot: project.root,
        requireCurrentPrototypeIdentity: true,
        requireExperienceClassification: true,
      })
    );

    write(project.root, "pm/backlog/wireframes/account-settings/base.css", ".screen{}\n");
    assert.throws(
      () =>
        validateDesignContext(visualContext(prototype), "design_context", {
          repoRoot: project.root,
          requireCurrentPrototypeIdentity: true,
          requireExperienceClassification: true,
        }),
      /prototype.*(?:manifest|tree|base\.css).*repository bytes/i
    );

    write(
      project.root,
      "pm/backlog/wireframes/account-settings/base.css",
      ".screen { display: grid; }\n"
    );
    write(
      project.root,
      "pm/backlog/wireframes/account-settings/security.html",
      '<section class="screen">Changed</section>\n'
    );
    assert.throws(
      () =>
        validateDesignContext(visualContext(prototype), "design_context", {
          repoRoot: project.root,
          requireCurrentPrototypeIdentity: true,
          requireExperienceClassification: true,
        }),
      /prototype.*(?:manifest|tree|security\.html).*repository bytes/i
    );
  } finally {
    project.cleanup();
  }
});

test("single-file identity rejects an atomic same-sized pathname replacement", () => {
  const project = tempProject();
  try {
    const prototypePath = "pm/backlog/wireframes/inline.html";
    const targetPath = write(project.root, prototypePath, "<!doctype html><main>AAAA</main>\n");
    assertRejectsAtomicSameSizeReplacement({
      targetPath,
      replacementPath: path.join(project.root, ".single-file-replacement"),
      replacement: "<!doctype html><main>BBBB</main>\n",
      run: () => buildPrototypeIdentity(prototypePath, project.root),
      expected: /prototype\.path cannot be read.*input (?:path )?changed during bounded read/i,
    });
  } finally {
    project.cleanup();
  }
});

test("multi-file manifest rejects an atomic same-sized pathname replacement", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const targetPath = path.join(project.root, "pm/backlog/wireframes/account-settings/base.css");
    assertRejectsAtomicSameSizeReplacement({
      targetPath,
      replacementPath: path.join(project.root, ".manifest-file-replacement"),
      replacement: ".screen { display: flex; }\n",
      run: () => buildPrototypeIdentity(prototypePath, project.root),
      expected:
        /prototype manifest base\.css cannot be read.*input (?:path )?changed during bounded read/i,
    });
  } finally {
    project.cleanup();
  }
});

test("multi-file manifest rejects replacement of an already-read file before the next opens", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const basePath = path.join(project.root, "pm/backlog/wireframes/account-settings/base.css");
    const indexPath = fs.realpathSync(
      path.join(project.root, "pm/backlog/wireframes/account-settings/index.html")
    );
    const originalOpenSync = fs.openSync;
    let indexOpens = 0;
    let replaced = false;
    fs.openSync = function replaceEarlierFileBeforeNextOpen(file, ...args) {
      if (path.resolve(String(file)) === indexPath) {
        indexOpens += 1;
        if (indexOpens === 2) {
          fs.writeFileSync(basePath, ".screen { display: flex; }\n");
          replaced = true;
        }
      }
      return Reflect.apply(originalOpenSync, fs, [file, ...args]);
    };
    try {
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /prototype tree changed during bounded read at base\.css/i
      );
      assert.equal(replaced, true);
    } finally {
      fs.openSync = originalOpenSync;
    }
  } finally {
    project.cleanup();
  }
});

test("multi-file manifest rejects an early file changed after its verification read", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const basePath = path.join(project.root, "pm/backlog/wireframes/account-settings/base.css");
    const indexPath = fs.realpathSync(
      path.join(project.root, "pm/backlog/wireframes/account-settings/index.html")
    );
    const originalOpenSync = fs.openSync;
    let indexOpens = 0;
    let changed = false;
    fs.openSync = function changeEarlierFileAfterVerification(file, ...args) {
      if (path.resolve(String(file)) === indexPath) {
        indexOpens += 1;
        if (indexOpens === 3) {
          fs.writeFileSync(basePath, ".screen { display: flex; }\n");
          changed = true;
        }
      }
      return Reflect.apply(originalOpenSync, fs, [file, ...args]);
    };
    try {
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /prototype tree changed during final verification at base\.css/i
      );
      assert.equal(changed, true);
    } finally {
      fs.openSync = originalOpenSync;
    }
  } finally {
    project.cleanup();
  }
});

test("multi-file manifest rejects a file added after the last verification sample", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const prototypeDirectory = path.join(project.root, "pm/backlog/wireframes/account-settings");
    const lastPath = fs.realpathSync(path.join(prototypeDirectory, "security.html"));
    const originalOpenSync = fs.openSync;
    const originalCloseSync = fs.closeSync;
    let lastOpens = 0;
    let verificationDescriptor;
    let added = false;
    fs.openSync = function trackLastVerificationOpen(file, ...args) {
      const descriptor = Reflect.apply(originalOpenSync, fs, [file, ...args]);
      if (path.resolve(String(file)) === lastPath) {
        lastOpens += 1;
        if (lastOpens === 2) verificationDescriptor = descriptor;
      }
      return descriptor;
    };
    fs.closeSync = function addFileAfterLastVerification(descriptor) {
      const result = Reflect.apply(originalCloseSync, fs, [descriptor]);
      if (!added && descriptor === verificationDescriptor) {
        fs.writeFileSync(path.join(prototypeDirectory, "unbound.html"), "<main>Unbound</main>\n");
        added = true;
      }
      return result;
    };
    try {
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /prototype tree changed during final verification/i
      );
      assert.equal(added, true);
    } finally {
      fs.openSync = originalOpenSync;
      fs.closeSync = originalCloseSync;
    }
  } finally {
    project.cleanup();
  }
});

test("single-file identity rejects a checked ancestor swapped to a same-parent symlink", () => {
  const project = tempProject();
  try {
    const prototypePath = "pm/backlog/wireframes/inline/preview.html";
    const targetPath = write(project.root, prototypePath, "<!doctype html><main>AAAA</main>\n");
    const ancestorPath = path.dirname(targetPath);
    const attackerPath = `${ancestorPath}.attacker`;
    write(attackerPath, "preview.html", "<!doctype html><main>BBBB</main>\n");
    assertRejectsAncestorSymlinkSwap({
      ancestorPath,
      attackerPath,
      targetPath,
      swapAt: 2,
      restoreAt: 3,
      run: () => buildPrototypeIdentity(prototypePath, project.root),
      expected: /prototype\.path cannot be read.*(?:symlink|containment|path changed)/i,
    });
  } finally {
    project.cleanup();
  }
});

test("multi-file manifest rejects a checked ancestor swapped to a same-parent symlink", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const ancestorPath = path.join(project.root, path.dirname(prototypePath));
    const attackerPath = `${ancestorPath}.attacker`;
    fs.cpSync(ancestorPath, attackerPath, { recursive: true });
    const targetPath = path.join(ancestorPath, "base.css");
    fs.writeFileSync(path.join(attackerPath, "base.css"), ".screen { display: flex; }\n");
    assertRejectsAncestorSymlinkSwap({
      ancestorPath,
      attackerPath,
      targetPath,
      swapAt: 3,
      restoreAt: 4,
      run: () => buildPrototypeIdentity(prototypePath, project.root),
      expected:
        /prototype manifest base\.css cannot be read.*(?:symlink|containment|path changed)/i,
    });
  } finally {
    project.cleanup();
  }
});

test("legacy index-only bindings remain readable but cannot enter a current handoff", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const current = buildPrototypeIdentity(prototypePath, project.root);
    const legacy = { path: current.path, sha256: current.sha256 };
    assert.doesNotThrow(() =>
      validateDesignContext(visualContext(legacy), "design_context", {
        repoRoot: project.root,
      })
    );
    assert.throws(
      () =>
        validateDesignContext(visualContext(legacy), "design_context", {
          repoRoot: project.root,
          requireCurrentPrototypeIdentity: true,
        }),
      /legacy multi-file prototype.*recertif/i
    );
  } finally {
    project.cleanup();
  }
});

test("single-file HTML cannot hide mutable local dependencies behind its entry hash", () => {
  const project = tempProject();
  try {
    const htmlPath = "pm/backlog/wireframes/demo.html";
    write(
      project.root,
      htmlPath,
      '<!doctype html><link rel="stylesheet" href="demo.css"><main>Demo</main>\n'
    );
    write(project.root, "pm/backlog/wireframes/demo.css", "main { color: blue; }\n");
    assert.throws(
      () => buildPrototypeIdentity(htmlPath, project.root),
      /single-file HTML references link\[href\].*use an index\.html prototype tree/i
    );
    const forged = {
      path: htmlPath,
      sha256: `sha256:${crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(project.root, htmlPath)))
        .digest("hex")}`,
    };
    assert.doesNotThrow(() =>
      validateDesignContext(visualContext(forged), "design_context", {
        repoRoot: project.root,
      })
    );
    write(project.root, "pm/backlog/wireframes/demo.css", "main { color: red; }\n");
    assert.throws(
      () =>
        validateDesignContext(visualContext(forged), "design_context", {
          repoRoot: project.root,
          requireCurrentPrototypeIdentity: true,
          requireExperienceClassification: true,
        }),
      /single-file HTML references link\[href\].*use an index\.html prototype tree/i
    );

    const inlinePath = "pm/backlog/wireframes/inline.html";
    write(
      project.root,
      inlinePath,
      '<!doctype html><style>main{background:url("data:image/png;base64,iVBORw0KGgo=")}</style><script type="application/json" id="wireframe-meta">{"screens":[]}</script><main><a href="#detail">Jump</a><svg><use href="#icon"></use></svg><section id="detail">Detail</section></main>\n'
    );
    const identity = buildPrototypeIdentity(inlinePath, project.root);
    assert.doesNotThrow(() =>
      validateDesignContext(visualContext(identity), "design_context", {
        repoRoot: project.root,
        requireCurrentPrototypeIdentity: true,
        requireExperienceClassification: true,
      })
    );

    const dataStylesheetPath = "pm/backlog/wireframes/data-stylesheet.html";
    const activeCss = Buffer.from('@import "https://example.test/live.css";').toString("base64");
    write(
      project.root,
      dataStylesheetPath,
      `<link rel="stylesheet" href="data:text/css;base64,${activeCss}"><main>Data CSS</main>\n`
    );
    assert.throws(
      () => buildPrototypeIdentity(dataStylesheetPath, project.root),
      /single-file HTML references link\[href\]/i
    );

    write(
      project.root,
      "pm/backlog/wireframes/dynamic.html",
      '<!doctype html><script>fetch("state.json")</script><main>Dynamic</main>\n'
    );
    assert.throws(
      () => buildPrototypeIdentity("pm/backlog/wireframes/dynamic.html", project.root),
      /active or external script/i
    );

    const activeCases = [
      [
        "event.html",
        "<!doctype html><main onmouseenter=\"fetch('state.json')\">Event</main>",
        /inline event handler/i,
      ],
      [
        "refresh.html",
        '<!doctype html><meta http-equiv="refresh" content="0;url=state.html"><main>Refresh</main>',
        /refresh\/navigation directive/i,
      ],
      [
        "srcdoc.html",
        "<!doctype html><iframe srcdoc=\"&lt;script>fetch('state.json')&lt;/script>\"></iframe>",
        /nested or plugin content/i,
      ],
      [
        "frame.html",
        '<!doctype html><frameset><frame src="state.html"></frameset>',
        /nested or plugin content/i,
      ],
      [
        "css-comment.html",
        '<!doctype html><style>@import/**/"theme.css";main{background:u/**/rl("hero.png")}</style><main>CSS</main>',
        /CSS resource|CSS import/i,
      ],
    ];
    for (const [name, html, expected] of activeCases) {
      const relative = `pm/backlog/wireframes/${name}`;
      write(project.root, relative, `${html}\n`);
      assert.throws(() => buildPrototypeIdentity(relative, project.root), expected, name);
    }
  } finally {
    project.cleanup();
  }
});

test("prototype identities reject HTML-encoded refresh directives", () => {
  const project = tempProject();
  try {
    const encodedRefresh =
      '<meta http-equiv="&#114;efresh" content="0;url=state.html"><main>Refresh</main>\n';
    const singlePath = "pm/backlog/wireframes/encoded-refresh.html";
    write(project.root, singlePath, encodedRefresh);
    assert.throws(
      () => buildPrototypeIdentity(singlePath, project.root),
      /refresh\/navigation directive/i,
      "single-file encoded refresh directive"
    );

    const prototypePath = writeMultiFilePrototype(project.root);
    write(project.root, "pm/backlog/wireframes/account-settings/index.html", encodedRefresh);
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /index\.html.*refresh\/navigation directive/i,
      "bundled encoded refresh directive"
    );

    const encodedContentType =
      '<meta http-equiv="content&#45;type" content="text/html;charset=utf-8"><main>Safe</main>\n';
    write(project.root, singlePath, encodedContentType);
    assert.doesNotThrow(() => buildPrototypeIdentity(singlePath, project.root));
    write(project.root, "pm/backlog/wireframes/account-settings/index.html", encodedContentType);
    assert.doesNotThrow(() => buildPrototypeIdentity(prototypePath, project.root));
  } finally {
    project.cleanup();
  }
});

test("prototype identities reject unbound bundle dependencies and unsupported active entries", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const indexPath = "pm/backlog/wireframes/account-settings/index.html";
    write(project.root, "pm/backlog/wireframes/shared.css", "body { color: red; }\n");
    write(
      project.root,
      indexPath,
      '<link rel="stylesheet" href="../shared.css"><main>Settings</main>\n'
    );
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /(?:outside the prototype directory|not covered by the prototype manifest)/i
    );

    write(
      project.root,
      indexPath,
      '<img src="https://example.test/live.png" alt="remote"><main>Settings</main>\n'
    );
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /remote or absolute resource/i
    );

    write(project.root, indexPath, '<img src="missing.png" alt="missing">\n');
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /not covered by the prototype manifest/i
    );

    write(
      project.root,
      indexPath,
      "<main onmouseenter=\"fetch('live.json')\">Interactive</main>\n"
    );
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /inline event handler/i
    );

    write(
      project.root,
      indexPath,
      "<iframe srcdoc=\"&lt;script>fetch('live.json')&lt;/script>\"></iframe>\n"
    );
    assert.throws(() => buildPrototypeIdentity(prototypePath, project.root), /srcdoc/i);

    write(project.root, indexPath, '<main class="screen">Settings</main>\n');
    write(
      project.root,
      "pm/backlog/wireframes/account-settings/base.css",
      '.screen { background-image: image-set("https://example.test/live.png" 1x); }\n'
    );
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /remote or absolute resource/i
    );

    const unsupported = "pm/backlog/wireframes/active.xhtml";
    write(project.root, unsupported, '<script src="https://example.test/live.js"></script>\n');
    assert.throws(
      () => buildPrototypeIdentity(unsupported, project.root),
      /prototype entry must be an HTML file/i
    );

    const imageSet = "pm/backlog/wireframes/image-set.html";
    write(
      project.root,
      imageSet,
      '<style>main { background-image: image-set("https://example.test/live.png" 1x); }</style><main>Demo</main>\n'
    );
    assert.throws(
      () => buildPrototypeIdentity(imageSet, project.root),
      /single-file HTML references CSS resource/i
    );
  } finally {
    project.cleanup();
  }
});

test("prototype identities decode HTML character references before CSS dependency inspection", () => {
  const project = tempProject();
  try {
    const singlePath = "pm/backlog/wireframes/encoded-style.html";
    const prototypePath = writeMultiFilePrototype(project.root);
    const bundledIndex = "pm/backlog/wireframes/account-settings/index.html";
    const cases = [
      [
        "numeric references",
        '<main style="background-image:u&#114;l(&#104;ttps://example.test/live.png)">Demo</main>\n',
      ],
      [
        "named punctuation references",
        '<main style="background-image:url&lpar;https&colon;&sol;&sol;example.test/live.png&rpar;">Demo</main>\n',
      ],
      [
        "semicolonless named punctuation reference",
        '<main style="background-image:url&lpar;https&colon//example.test/live.png&rpar;">Demo</main>\n',
      ],
      [
        "encoded import",
        '<main style="&#64;im&#112;ort &quot;https://example.test/live.css&quot;">Demo</main>\n',
      ],
    ];
    for (const [name, encodedRemoteStyle] of cases) {
      write(project.root, singlePath, encodedRemoteStyle);
      assert.throws(
        () => buildPrototypeIdentity(singlePath, project.root),
        /single-file HTML references CSS resource/i,
        `single-file encoded style dependency using ${name}`
      );

      write(project.root, bundledIndex, encodedRemoteStyle);
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /remote or absolute resource/i,
        `bundled encoded style dependency using ${name}`
      );
    }
  } finally {
    project.cleanup();
  }
});

test("prototype identities inspect legacy and interaction-triggered fetch attributes", () => {
  const project = tempProject();
  try {
    const singlePath = "pm/backlog/wireframes/fetch-attributes.html";
    const prototypePath = writeMultiFilePrototype(project.root);
    const bundledIndex = "pm/backlog/wireframes/account-settings/index.html";
    for (const [name, markup] of [
      ["anchor ping", '<a href="#detail" ping="https://example.test/audit">Open</a>'],
      ["area ping", '<map><area href="#detail" ping="https://example.test/audit"></map>'],
      ["image lowsrc", '<img alt="Preview" lowsrc="https://example.test/preview.png">'],
    ]) {
      write(project.root, singlePath, `${markup}<section id="detail">Detail</section>\n`);
      assert.throws(
        () => buildPrototypeIdentity(singlePath, project.root),
        /single-file HTML references .* resource/i,
        `single-file ${name}`
      );

      write(project.root, bundledIndex, `${markup}<section id="detail">Detail</section>\n`);
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /remote or absolute resource/i,
        `bundled ${name}`
      );
    }

    const inertMarkup =
      '<main data-background="https://example.test/inert" aria-label="R&amp;D">Demo</main>\n';
    write(project.root, singlePath, inertMarkup);
    assert.doesNotThrow(() => buildPrototypeIdentity(singlePath, project.root));
    write(project.root, bundledIndex, inertMarkup);
    assert.doesNotThrow(() => buildPrototypeIdentity(prototypePath, project.root));

    const inlineLegacyImage = '<img alt="Preview" lowsrc="data:image/png;base64,iVBORw0KGgo=">\n';
    write(project.root, singlePath, inlineLegacyImage);
    assert.doesNotThrow(() => buildPrototypeIdentity(singlePath, project.root));
    write(project.root, bundledIndex, inlineLegacyImage);
    assert.doesNotThrow(() => buildPrototypeIdentity(prototypePath, project.root));
  } finally {
    project.cleanup();
  }
});

test("prototype identities inspect legacy background resource attributes", () => {
  const project = tempProject();
  try {
    const remote = "https://example.test/live.png";
    const markupFor = (tag, target) => {
      const element = `<${tag} background="${target}">Demo</${tag}>`;
      if (["thead", "tbody", "tfoot"].includes(tag)) return `<table>${element}</table>\n`;
      if (tag === "tr") return `<table><tbody>${element}</tbody></table>\n`;
      if (["td", "th"].includes(tag)) {
        return `<table><tbody><tr>${element}</tr></tbody></table>\n`;
      }
      return `${element}\n`;
    };
    const tags = ["body", "table", "thead", "tbody", "tfoot", "tr", "td", "th"];
    const singlePath = "pm/backlog/wireframes/background.html";
    const prototypePath = writeMultiFilePrototype(project.root);
    const bundledIndex = "pm/backlog/wireframes/account-settings/index.html";

    for (const tag of tags) {
      write(project.root, singlePath, markupFor(tag, remote));
      assert.throws(
        () => buildPrototypeIdentity(singlePath, project.root),
        new RegExp(`single-file HTML references ${tag}\\[background\\] resource`, "i"),
        `single-file ${tag}[background] dependency`
      );

      write(project.root, bundledIndex, markupFor(tag, remote));
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /remote or absolute resource/i,
        `bundled ${tag}[background] dependency`
      );
    }

    const inlineImage = "data:image/png;base64,iVBORw0KGgo=";
    const inlineBackgrounds = `<body background="${inlineImage}"><table background="${inlineImage}"><thead background="${inlineImage}"><tr background="${inlineImage}"><th background="${inlineImage}">Head</th></tr></thead><tbody background="${inlineImage}"><tr><td background="${inlineImage}">Body</td></tr></tbody><tfoot background="${inlineImage}"><tr><td>Foot</td></tr></tfoot></table></body>`;
    write(project.root, singlePath, inlineBackgrounds);
    assert.doesNotThrow(() => buildPrototypeIdentity(singlePath, project.root));
    write(project.root, bundledIndex, inlineBackgrounds);
    assert.doesNotThrow(() => buildPrototypeIdentity(prototypePath, project.root));
  } finally {
    project.cleanup();
  }
});

test("prototype identities reject active data URIs but accept inert image media", () => {
  const project = tempProject();
  try {
    const prototypePath = writeMultiFilePrototype(project.root);
    const prefix = "pm/backlog/wireframes/account-settings";
    const cssData = `data:text/css;base64,${Buffer.from(
      '@import "https://example.test/live.css";'
    ).toString("base64")}`;
    const htmlData = `data:text/html;base64,${Buffer.from(
      '<script src="https://example.test/live.js"></script>'
    ).toString("base64")}`;

    for (const [name, markup] of [
      ["stylesheet", `<link rel="stylesheet" href="${cssData}"><main>Settings</main>`],
      ["iframe", `<iframe src="${htmlData}"></iframe>`],
      ["frame", `<frameset><frame src="${htmlData}"></frameset>`],
      ["object", `<object data="${htmlData}"></object>`],
      ["embed", `<embed src="${htmlData}">`],
      ["form action", `<form action="${htmlData}"><button>Submit</button></form>`],
      ["navigation", `<a href="${htmlData}">Open</a>`],
      ["SVG image", '<img src="data:image/svg+xml;base64,PHN2Zy8+" alt="Vector">'],
    ]) {
      write(project.root, `${prefix}/index.html`, `${markup}\n`);
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /unsupported data resource/i,
        name
      );
    }

    write(project.root, `${prefix}/&`, "decoy\n");
    write(
      project.root,
      `${prefix}/index.html`,
      `<iframe src="${htmlData.replace("data:", "&#100;&#97;&#116;&#97;&#58;")}"></iframe>\n`
    );
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /index\.html.*&#100;&#97;&#116;&#97;&#58;/i,
      "HTML-encoded data scheme"
    );

    const whitespaceData = htmlData.replace("data:", "da\nta:");
    write(project.root, `${prefix}/${whitespaceData}`, "decoy\n");
    write(project.root, `${prefix}/index.html`, `<iframe src="${whitespaceData}"></iframe>\n`);
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /unsupported (?:encoded )?resource/i,
      "newline-obfuscated data scheme"
    );

    write(project.root, `${prefix}/index.html`, "<main>Settings</main>\n");
    write(project.root, `${prefix}/base.css`, `@import/**/"${cssData}";\n`);
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /unsupported data resource/i,
      "comment-separated CSS import"
    );

    for (const [name, newline] of [
      ["LF", "\n"],
      ["CRLF", "\r\n"],
      ["CR", "\r"],
      ["form-feed", "\f"],
    ]) {
      const continuedCssData = cssData.replace("data:", ["da\\", `${newline}ta:`].join(""));
      write(project.root, `${prefix}/base.css`, `@import "${continuedCssData}";\n`);
      assert.throws(
        () => buildPrototypeIdentity(prototypePath, project.root),
        /unsupported data resource/i,
        `${name} CSS string continuation`
      );
    }

    write(project.root, `${prefix}/base.css`, `@import "${cssData}";\n`);
    assert.throws(
      () => buildPrototypeIdentity(prototypePath, project.root),
      /unsupported data resource/i,
      "CSS import"
    );

    write(
      project.root,
      `${prefix}/base.css`,
      '@font-face { font-family: Inline; src: url("data:font/woff2;base64,d09GMg=="); }\n'
    );
    write(
      project.root,
      `${prefix}/index.html`,
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="Inline preview"><audio src="data:audio/mpeg;base64,SUQz"></audio><video src="data:video/mp4;base64,AAAA" poster="data:image/webp;base64,UklGRg=="><source src="data:video/webm;base64,GkXf"><track src="data:text/vtt;base64,V0VCVlRU"></video>\n'
    );
    assert.doesNotThrow(() => buildPrototypeIdentity(prototypePath, project.root));
  } finally {
    project.cleanup();
  }
});

test("nonvisual experience contracts reject invented visual requirements", () => {
  const nonvisual = {
    design_requirements: ["Return actionable validation errors to CLI callers."],
    ui_impact: false,
    prototype: null,
    critical_states: ["success", "invalid input", "service unavailable"],
    experience_invariants: ["Failures keep a stable nonzero exit code and name the next action."],
    visual_invariants: [],
  };
  assert.doesNotThrow(() =>
    validateDesignContext(nonvisual, "design_context", {
      requireExperienceClassification: true,
    })
  );

  const inventedVisuals = structuredClone(nonvisual);
  inventedVisuals.visual_invariants.push("Keep the primary action above the fold.");
  assert.throws(
    () =>
      validateDesignContext(inventedVisuals, "design_context", {
        requireExperienceClassification: true,
      }),
    /nonvisual.*visual_invariants.*empty/i
  );

  const missingExperience = structuredClone(nonvisual);
  missingExperience.experience_invariants = [];
  assert.throws(
    () =>
      validateDesignContext(missingExperience, "design_context", {
        requireExperienceClassification: true,
      }),
    /experience_invariants.*non-empty/i
  );
});

test("RFC work units preserve the complete design context without field reconstruction", () => {
  const project = tempProject();
  try {
    const prototype = buildPrototypeIdentity(writeMultiFilePrototype(project.root), project.root);
    const designContext = visualContext(prototype);
    const sidecar = {
      schema_version: 3,
      design_context: designContext,
      issues: [
        {
          num: 1,
          title: "Implement settings flow",
          size: "M",
          depends_on: [],
          owns: ["src/settings/**"],
          acceptance_criteria: ["Saving a valid profile persists it."],
          approach: "Reuse the existing settings boundary.",
          verification_commands: ["npm test"],
          test_hooks: ["settings integration"],
        },
      ],
    };
    const [unit] = rfcIssuesToDevWorkUnits(sidecar, { repoRoot: project.root });
    assert.deepEqual(unit.contract.design_context, designContext);
  } finally {
    project.cleanup();
  }
});
