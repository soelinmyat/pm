"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const checkScript = path.join(repoRoot, "scripts", "dev-gate-check.js");

const {
  checkGateManifest,
  deriveSessionSlug,
  loadChangedFilesFromGit,
  parseArgs,
} = require("../scripts/dev-gate-check.js");

function gate(name, commit = "abc123", overrides = {}) {
  return {
    name,
    status: "passed",
    commit,
    artifact: `tests/dev-gate-check.test.js#${name}`,
    reason: "",
    checked_at: "2026-07-01T05:01:00Z",
    ...overrides,
  };
}

function manifest(gates, overrides = {}) {
  return {
    schema_version: 1,
    ...overrides,
    gates,
  };
}

function makeTmpManifest(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-gates-"));
  const file = path.join(dir, "current.gates.json");
  fs.writeFileSync(file, JSON.stringify(content, null, 2));
  return {
    file,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("pm/ KB artifacts (generated RFC HTML) are not UI-impact paths", () => {
  const rows = [
    gate("tdd"),
    gate("simplify"),
    gate("design-critique", "abc123", {
      status: "skipped",
      artifact: "",
      reason: "backend-only: no UI impact",
    }),
    gate("qa"),
    gate("review"),
    gate("verification"),
  ];
  const result = checkGateManifest(manifest(rows), {
    currentCommit: "abc123",
    changedFiles: ["pm/backlog/rfcs/some-feature.html", ".pm/dev-sessions/x.md", "scripts/a.js"],
  });
  assert.equal(
    result.issues.some((issue) => /UI-impact/.test(issue.message)),
    false,
    JSON.stringify(result.issues)
  );
});

test("dev gate checker accepts required gates tied to the current commit", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker default rejects a partial final gate manifest", () => {
  const result = checkGateManifest(manifest([gate("review"), gate("verification")]), {
    currentCommit: "abc123",
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /missing required gate tdd/);
  assert.match(text, /missing required gate design-critique/);
  assert.match(text, /missing required gate qa/);
});

test("dev gate checker does not let an empty required list bypass default gates", () => {
  const result = checkGateManifest(manifest([gate("review"), gate("verification")]), {
    currentCommit: "abc123",
    requiredGates: [],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /missing required gate tdd/);
});

test("dev gate checker accepts recertified older evidence rows at final HEAD", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "implementation-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("simplify", "simplify-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("design-critique", "design-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("qa", "qa-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("review", "review-sha", {
        verified_commit: "final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
      gate("verification", "final-sha"),
    ]),
    {
      currentCommit: "final-sha",
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker accepts current evidence even when old recertification remains", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "final-sha", {
        verified_commit: "older-final-sha",
        verified_at: "2026-07-01T05:30:00Z",
      }),
    ]),
    {
      currentCommit: "final-sha",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker accepts explicit skip reasons for required gates", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "docs-only change",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker allows UI gates to skip only for no-UI-impact reasons", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects UI skips when UI-impact files changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: ["apps/web/src/screens/Orders.tsx", "apps/web/src/styles/orders.css"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker rejects UI skips for plain frontend JavaScript and TypeScript", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: [
        "src/App.js",
        "app/page.js",
        "app/layout.ts",
        "src/app/app.component.ts",
        "src/app/app.routes.ts",
        "src/app/app-routing.module.ts",
        "src/routes.ts",
        "src/router.ts",
        "src/routing.ts",
        "src/routes.ts",
        "src/router/index.ts",
        "src/features/orders/useOrderFilters.ts",
        "src/hooks/useCheckout.ts",
        "src/store/cart.ts",
        "src/context/AuthContext.ts",
        "src/redux/cart.ts",
        "src/reducers/cart.ts",
        "src/slices/cartSlice.ts",
        "src/zustand/cart.ts",
        "tailwind.config.ts",
        "apps/admin/src/store/cart.ts",
        "packages/admin/src/hooks/useCheckout.ts",
        "apps/backoffice/src/redux/cart.ts",
        "apps/admin/src/router.ts",
        "apps/admin/tailwind.config.ts",
        "packages/ui/tokens/colors.json",
        "src/design-tokens.json",
        "tokens.config.json",
        "theme.config.json",
        "style-dictionary.config.json",
        "app/page.mdx",
        "src/app/docs/page.md",
        "apps/admin/app/page.ts",
        "app/javascript/controllers/menu_controller.js",
        "assets/javascripts/checkout.js",
        "apps/web/src/main.ts",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker rejects UI skips for static and server-rendered templates", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: [
        "templates/base.html",
        "public/index.html",
        "views/orders/show.erb",
        "views/cart/show.ejs",
        "templates/emails/receipt.hbs",
        "templates/page.handlebars",
        "templates/product.liquid",
        "templates/profile.twig",
        "templates/dashboard.njk",
        "templates/report.j2",
        "templates/app.astro",
        "templates/article.pug",
        "templates/news.jade",
        "templates/card.slim",
        "templates/item.haml",
        "templates/post.mustache",
        "Pages/Account/Login.cshtml",
        "Pages/Index.razor",
        "resources/views/orders/show.blade.php",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped when UI-impact files changed/);
  assert.match(text, /qa cannot be skipped when UI-impact files changed/);
});

test("dev gate checker does not treat every JavaScript file as UI impact", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no visual impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      changedFiles: ["services/orders/recalculate.js", "app/api/orders/route.ts"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects UI gate environment failures recorded as skipped", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no UI screenshots because dev server cannot start",
      }),
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no UI artifacts because dev server cannot start",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique", "qa"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /design-critique cannot be skipped for environment failure/);
  assert.match(text, /qa cannot be skipped for environment failure/);
});

test("dev gate checker rejects arbitrary tdd and simplify skip reasons", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no time; tests not written",
      }),
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no time",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd", "simplify"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /tdd skip reason is not allowed/);
  assert.match(text, /simplify skip reason is not allowed/);
});

test("dev gate checker rejects tdd skips when behavior files changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "docs-only change",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["tdd"],
      changedFiles: [
        "src/orders/calculate-total.ts",
        "app/page.mdx",
        "src/app/docs/page.md",
        "templates/base.html",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /tdd cannot be skipped when behavior files changed/
  );
});

test("dev gate checker rejects no-code simplify skips when runtime source changed", () => {
  const result = checkGateManifest(
    manifest([
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "no code changes",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: [
        "skills/dev/SKILL.md",
        ".githooks/pre-push",
        "plugin.config.json",
        "app/page.mdx",
        "src/app/docs/page.md",
        "public/index.html",
      ],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /simplify cannot use no-code skip when runtime source files changed/
  );
});

test("dev gate checker validates contextual simplify skip reasons", () => {
  const xsWithoutSize = checkGateManifest(
    manifest([
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "XS size",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["scripts/dev-gate-check.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(xsWithoutSize.ok, false);
  assert.match(
    xsWithoutSize.issues.map((i) => i.message).join("\n"),
    /simplify XS skip requires manifest size XS/
  );

  const xsWithSize = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "XS size",
        }),
      ],
      { size: "XS" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["scripts/dev-gate-check.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(xsWithSize.ok, true, JSON.stringify(xsWithSize.issues, null, 2));

  const kindWithoutMatch = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "kind bug uses review gate instead",
        }),
      ],
      { kind: "task" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["skills/dev/SKILL.md"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(kindWithoutMatch.ok, false);
  assert.match(
    kindWithoutMatch.issues.map((i) => i.message).join("\n"),
    /simplify kind skip requires manifest kind bug/
  );

  const kindWithMatch = checkGateManifest(
    manifest(
      [
        gate("simplify", "abc123", {
          status: "skipped",
          artifact: "",
          reason: "kind bug uses review gate instead",
        }),
      ],
      { kind: "bug" }
    ),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      changedFiles: ["skills/dev/SKILL.md"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(kindWithMatch.ok, true, JSON.stringify(kindWithMatch.issues, null, 2));
});

test("dev gate checker rejects skipped review and verification gates by default", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "claimed no review needed",
      }),
      gate("verification", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "tests remembered from earlier",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review", "verification"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /required gate review cannot be skipped/);
  assert.match(text, /required gate verification cannot be skipped/);
});

test("dev gate checker rejects passed gates with missing artifacts", () => {
  const result = checkGateManifest(manifest([gate("design-critique")]), {
    currentCommit: "abc123",
    requiredGates: ["design-critique"],
    changedFiles: ["app/page.js"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, true, "control row uses an existing artifact");

  const missing = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        artifact: "/tmp/pm-dev-gate-missing-artifact.json",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique"],
      changedFiles: ["app/page.js"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(missing.ok, false);
  assert.match(missing.issues.map((i) => i.message).join("\n"), /artifact path does not exist/);
});

test("dev gate checker accepts state-section artifact anchors when the file exists", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        artifact: "tests/dev-gate-check.test.js#review",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects stale gate commits", () => {
  const result = checkGateManifest(manifest([gate("review", "oldsha")]), {
    currentCommit: "newsha",
    requiredGates: ["review"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /stale for current commit/);
});

test("dev gate checker ignores stale rows for gates that are not required", () => {
  const result = checkGateManifest(manifest([gate("tdd", "oldsha"), gate("simplify", "abc123")]), {
    currentCommit: "abc123",
    requiredGates: ["simplify"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker rejects missing required gates", () => {
  const result = checkGateManifest(manifest([gate("verification")]), {
    currentCommit: "abc123",
    requiredGates: ["review"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /missing required gate review/);
});

test("dev gate checker rejects failed or blocked required gates", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "failed",
        reason: "P1 finding remains unresolved",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /required gate review is failed/);
});

test("dev gate checker rejects skip rows without a reason", () => {
  const result = checkGateManifest(
    manifest([
      gate("design-critique", "abc123", {
        status: "skipped",
        artifact: "",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["design-critique"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /reason is required/);
});

test("dev gate checker validates recertification fields as a pair", () => {
  const result = checkGateManifest(
    manifest([
      gate("review", "oldsha", {
        verified_commit: "newsha",
      }),
    ]),
    {
      currentCommit: "newsha",
      requiredGates: ["review"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  assert.match(
    result.issues.map((i) => i.message).join("\n"),
    /verified_commit and verified_at must be written together/
  );
});

test("dev gate checker parses comma-separated required gates", () => {
  assert.deepEqual(parseArgs(["--require", "review,verification"]).requiredGates, [
    "review",
    "verification",
  ]);
});

test("dev gate checker parses base refs and changed files", () => {
  const parsed = parseArgs([
    "--base",
    "origin/main",
    "--changed-file",
    "src/App.tsx",
    "--changed-files",
    "README.md,skills/dev/SKILL.md",
  ]);
  assert.equal(parsed.baseRef, "origin/main");
  assert.deepEqual(parsed.changedFiles, ["src/App.tsx", "README.md", "skills/dev/SKILL.md"]);
});

test("dev gate checker can load changed files for a target commit that is not HEAD", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-dev-git-target-"));
  try {
    const git = (...args) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(git("init", "-q").status, 0);
    assert.equal(git("config", "user.email", "test@example.com").status, 0);
    assert.equal(git("config", "user.name", "Test User").status, 0);
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "base").status, 0);
    assert.equal(git("branch", "base").status, 0);
    fs.mkdirSync(path.join(dir, "commands"), { recursive: true });
    fs.writeFileSync(path.join(dir, "commands", "design-critique.md"), "runtime\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "runtime").status, 0);
    const target = git("rev-parse", "HEAD").stdout.trim();
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "head\n");
    assert.equal(git("add", ".").status, 0);
    assert.equal(git("commit", "-q", "-m", "head").status, 0);

    assert.deepEqual(loadChangedFilesFromGit("base", dir, target), ["commands/design-critique.md"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("deriveSessionSlug normalizes branch families the same way hooks and skills expect", () => {
  assert.equal(deriveSessionSlug("feat/add-auth"), "add-auth");
  assert.equal(deriveSessionSlug("codex/pm-dev-workflow-proposal"), "pm-dev-workflow-proposal");
  assert.equal(deriveSessionSlug("release/v1.2.3"), "v1.2.3");
  assert.equal(deriveSessionSlug("team/feature/foo"), "team-feature-foo");
  assert.equal(deriveSessionSlug(""), "current");
});

test("dev gate checker can explicitly allow only skippable gates", () => {
  const parsed = parseArgs(["--no-skip", "--allow-skip", "qa"]);
  const allowed = checkGateManifest(
    manifest([
      gate("qa", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "backend-only change with no UI impact",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["qa"],
      allowSkippedGates: parsed.allowSkippedGates,
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(allowed.ok, true, JSON.stringify(allowed.issues, null, 2));

  assert.throws(
    () => parseArgs(["--allow-skip", "review"]),
    /cannot include non-skippable gate review/
  );
  assert.throws(
    () => parseArgs(["--allow-skip", "verification"]),
    /cannot include non-skippable gate verification/
  );

  const rejected = checkGateManifest(
    manifest([
      gate("review", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "explicitly allowed by caller",
      }),
      gate("verification", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "explicitly allowed by caller",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["review", "verification"],
      allowSkippedGates: ["review", "verification"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(rejected.ok, false);
  const text = rejected.issues.map((i) => i.message).join("\n");
  assert.match(text, /required gate review cannot be skipped/);
  assert.match(text, /required gate verification cannot be skipped/);
});

test("dev gate checker rejects unknown required gate names", () => {
  const result = checkGateManifest(manifest([gate("review")]), {
    currentCommit: "abc123",
    requiredGates: ["review", "not-a-gate"],
    manifestPath: ".pm/dev-sessions/current.gates.json",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.map((i) => i.message).join("\n"), /unknown required gate/);
});

test("dev gate checker CLI args require values", () => {
  assert.throws(() => parseArgs(["--manifest"]), /--manifest requires a value/);
});

test("dev gate checker CLI exits non-zero on stale gate state", () => {
  const tmp = makeTmpManifest(manifest([gate("review", "oldsha")]));
  try {
    const result = spawnSync(
      process.execPath,
      [checkScript, "--manifest", tmp.file, "--commit", "newsha", "--require", "review", "--json"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      }
    );
    assert.notEqual(result.status, 0);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.match(output.issues.map((i) => i.message).join("\n"), /stale for current commit/);
  } finally {
    tmp.cleanup();
  }
});

test("dev gate checker does not require simplify by default (absorbed into review, v1.9)", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker tolerates legacy simplify rows without requiring freshness", () => {
  const result = checkGateManifest(
    manifest([
      gate("tdd"),
      gate("simplify", "old-stale-sha"),
      gate("design-critique"),
      gate("qa"),
      gate("review"),
      gate("verification"),
    ]),
    {
      currentCommit: "abc123",
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
});

test("dev gate checker still validates simplify when explicitly required (legacy sessions)", () => {
  const result = checkGateManifest(
    manifest([
      gate("simplify", "abc123", {
        status: "skipped",
        artifact: "",
        reason: "felt unnecessary",
      }),
    ]),
    {
      currentCommit: "abc123",
      requiredGates: ["simplify"],
      manifestPath: ".pm/dev-sessions/current.gates.json",
    }
  );
  assert.equal(result.ok, false);
  const text = result.issues.map((i) => i.message).join("\n");
  assert.match(text, /simplify skip reason is not allowed/);
});
