"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { isUiImpactPath } = require("../scripts/lib/ui-impact");

test("plain repository documentation does not inherit UI impact from directory names", () => {
  for (const file of [
    "docs/design-system/product-design-guidance.md",
    "docs/components/button.md",
    "docs/styles/conventions.markdown",
    "docs/theme/tokens.md",
  ])
    assert.equal(isUiImpactPath(file), false, file);
});

test("documentation exclusion preserves renderable routes, MDX, source and assets", () => {
  for (const file of [
    "docs/design-system/Button.tsx",
    "docs/design-system/examples.mdx",
    "docs/styles/site.css",
    "docs/tokens/colors.json",
    "docs/public/example.png",
    "docs/pages/example.md",
    "docs/app/guide/page.md",
    "docs/src/app/guide/page.mdx",
    "app/guide/page.md",
    "src/app/guide/page.mdx",
    "pages/guide.md",
    "src/components/Button.tsx",
  ])
    assert.equal(isUiImpactPath(file), true, file);
});
