"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MAX_LINEAGE_HOPS,
  assertAmendmentDepth,
  assertOwnsOnlyAmendment,
  parseAmendedIssueNums,
} = require("../scripts/lib/rfc-amendment");

function sidecar() {
  return {
    schema_version: 3,
    slug: "amend-contract",
    title: "Amend contract",
    size: "M",
    issues: [
      {
        num: 1,
        title: "First",
        size: "S",
        depends_on: [],
        owns: ["app/first.rb", "test/first_test.rb"],
        acceptance_criteria: ["First works"],
        approach: "First approach.",
        verification_commands: ["bin/test first"],
        test_hooks: ["First hook"],
      },
      {
        num: 2,
        title: "Second",
        size: "S",
        depends_on: [1],
        owns: ["app/second.rb"],
        acceptance_criteria: ["Second works"],
        approach: "Second approach.",
        verification_commands: ["bin/test second"],
        test_hooks: ["Second hook"],
      },
    ],
    test_strategy: { test_levels: "unit" },
  };
}

function amended(mutate) {
  const next = sidecar();
  mutate(next);
  return next;
}

test("an owns-only superset on declared issues is accepted and reports the added paths", () => {
  const next = amended((value) => value.issues[1].owns.push("test/first_test.rb"));
  assert.deepEqual(assertOwnsOnlyAmendment(sidecar(), next, [2]), [
    { num: 2, added_owns: ["test/first_test.rb"] },
  ]);
});

test("amendments reject removed, reordered-away, or rewritten ownership", () => {
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => {
          value.issues[1].owns = ["test/first_test.rb"];
        }),
        [2]
      ),
    /append-only.*app\/second\.rb/
  );
});

test("amendments keep prior owns as an ordered prefix; reorder or mid-list insertion is rejected", () => {
  for (const owns of [
    ["test/first_test.rb", "app/extra.rb", "app/first.rb"],
    ["app/first.rb", "app/extra.rb", "test/first_test.rb"],
  ]) {
    assert.throws(
      () =>
        assertOwnsOnlyAmendment(
          sidecar(),
          amended((value) => {
            value.issues[0].owns = owns;
          }),
          [1]
        ),
      /append-only/
    );
  }
});

test("amendments reject owns changes on undeclared issues", () => {
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues[0].owns.push("app/extra.rb")),
        [2]
      ),
    /issue 1 was not declared/
  );
});

test("amendments reject changes to any non-owns issue field", () => {
  for (const field of ["title", "size", "approach"]) {
    assert.throws(
      () =>
        assertOwnsOnlyAmendment(
          sidecar(),
          amended((value) => {
            value.issues[1].owns.push("test/first_test.rb");
            value.issues[1][field] = "changed";
          }),
          [2]
        ),
      new RegExp(`issue 2 field ${field}`)
    );
  }
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => {
          value.issues[1].owns.push("test/first_test.rb");
          value.issues[1].depends_on = [];
        }),
        [2]
      ),
    /issue 2 field depends_on/
  );
});

test("amendments reject added, removed, or renumbered issues", () => {
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues.pop()),
        [2]
      ),
    /issue list/
  );
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues.push({ ...value.issues[1], num: 3 })),
        [2]
      ),
    /issue list/
  );
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => {
          value.issues[1].num = 3;
        }),
        [2]
      ),
    /issue list/
  );
});

test("amendments reject top-level sidecar changes", () => {
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => {
          value.issues[1].owns.push("test/first_test.rb");
          value.title = "Retitled";
        }),
        [2]
      ),
    /top-level field title/
  );
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => {
          value.issues[1].owns.push("test/first_test.rb");
          value.extra = true;
        }),
        [2]
      ),
    /top-level field extra/
  );
});

test("an amendment must add at least one path, but not to every declared issue", () => {
  assert.throws(
    () => assertOwnsOnlyAmendment(sidecar(), sidecar(), [2]),
    /amendment adds no owned paths/
  );
  assert.throws(
    () => assertOwnsOnlyAmendment(sidecar(), sidecar(), [1, 2]),
    /amendment adds no owned paths/
  );
  assert.deepEqual(
    assertOwnsOnlyAmendment(
      sidecar(),
      amended((value) => value.issues[1].owns.push("test/first_test.rb")),
      [1, 2]
    ),
    [{ num: 2, added_owns: ["test/first_test.rb"] }]
  );
});

test("amendments reject duplicate added paths and undeclared issue numbers", () => {
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues[1].owns.push("app/second.rb")),
        [2]
      ),
    /duplicate/
  );
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues[1].owns.push("x")),
        [9]
      ),
    /issue 9 does not exist/
  );
});

test("issue number lists parse as unique positive integers", () => {
  assert.deepEqual(parseAmendedIssueNums("2, 1"), [1, 2]);
  assert.throws(() => parseAmendedIssueNums(""), /at least one/);
  assert.throws(() => parseAmendedIssueNums("1,1"), /unique/);
  assert.throws(() => parseAmendedIssueNums("0"), /positive integer/);
  assert.throws(() => parseAmendedIssueNums("two"), /positive integer/);
});

test("amend refuses a run whose lineage already holds the maximum amendments", () => {
  const runs = new Map();
  for (let index = 0; index <= MAX_LINEAGE_HOPS; index += 1) {
    runs.set(`rfc_${index}`, {
      run_id: `rfc_${index}`,
      amendment: index === 0 ? null : { of_run_id: `rfc_${index - 1}` },
    });
  }
  const load = (runId) => runs.get(runId);
  assert.doesNotThrow(() => assertAmendmentDepth(runs.get(`rfc_${MAX_LINEAGE_HOPS - 1}`), load));
  assert.throws(
    () => assertAmendmentDepth(runs.get(`rfc_${MAX_LINEAGE_HOPS}`), load),
    new RegExp(`${MAX_LINEAGE_HOPS} amendments`)
  );
  runs.get("rfc_0").amendment = { of_run_id: "rfc_1" };
  assert.throws(() => assertAmendmentDepth(runs.get("rfc_1"), load), /repeats/);
});

test("amendment HTML must list each added path once, in its own issue, and change nothing else", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const issue = (num, body) =>
    `<div class="issue-detail"><span class="issue-detail-num">${num}</span>\n  ${body}\n</div>`;
  const page = (status, hash, one, two) =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      issue(1, one),
      issue(2, two),
      "</main>",
    ].join("\n");
  const oneOwns =
    "<p><strong>Owns:</strong> <code>src/a&amp;b.js</code></p><p>Out of scope: <code>src/e.js</code></p>";
  const twoOwns =
    "<p><strong>Owns:</strong> <code>src/two.js</code></p><ul><li>src/two.js</li></ul>";
  const prior = page("approved", "a", oneOwns, twoOwns);
  const added = [{ num: 2, added_owns: ["src/c&d.js", "src/e.js"] }];
  const accepted = [
    // Inline, as the RFC template lists owned files.
    "<p><strong>Owns:</strong> <code>src/two.js</code>, <code>src/c&amp;d.js</code>, <code>src/e.js</code></p><ul><li>src/two.js</li></ul>",
    // List items, as a details list of owned files.
    "<p><strong>Owns:</strong> <code>src/two.js</code></p><ul><li>src/two.js</li>\n<li>src/c&amp;d.js</li><li><code>src/e.js</code></li></ul>",
  ];
  for (const two of accepted) {
    assert.doesNotThrow(() => assertOwnsOnlyHtml(prior, page("draft", "b", oneOwns, two), added));
  }
  const listed = accepted[0];
  const refused = {
    "leaves the added paths out": page("draft", "b", oneOwns, twoOwns),
    "lists a path under another issue": page(
      "draft",
      "b",
      oneOwns.replace("</code></p>", "</code>, <code>src/c&amp;d.js</code></p>"),
      "<p><strong>Owns:</strong> <code>src/two.js</code>, <code>src/e.js</code></p><ul><li>src/two.js</li></ul>"
    ),
    "lists a path twice": page(
      "draft",
      "b",
      oneOwns,
      listed.replace("</ul>", "<li>src/e.js</li></ul>")
    ),
    "deletes a prior line naming the path": page(
      "draft",
      "b",
      "<p><strong>Owns:</strong> <code>src/a&amp;b.js</code></p>",
      listed
    ),
    "lists an undeclared path": page(
      "draft",
      "b",
      oneOwns,
      listed.replace("</ul>", "<li>src/other.js</li></ul>")
    ),
    "adds prose": page("draft", "b", oneOwns, `${listed}<p>New prose.</p>`),
    "lists a path unescaped": page(
      "draft",
      "b",
      oneOwns,
      "<p><strong>Owns:</strong> <code>src/two.js</code>, <code>src/c&d.js</code>, <code>src/e.js</code></p><ul><li>src/two.js</li></ul>"
    ),
  };
  for (const [label, next] of Object.entries(refused)) {
    assert.throws(
      () => assertOwnsOnlyHtml(prior, next, added),
      /amendment changed RFC HTML beyond the lifecycle and added owned paths/,
      label
    );
  }
  // A list after the last issue card is outside every issue.
  const risks = (items) => `<ul><li>Risk.</li>${items}</ul></main>`;
  assert.throws(
    () =>
      assertOwnsOnlyHtml(
        prior.replace("</main>", risks("")),
        page("draft", "b", oneOwns, twoOwns).replace(
          "</main>",
          risks("<li>src/c&amp;d.js</li><li>src/e.js</li>")
        ),
        added
      ),
    /amendment changed RFC HTML beyond the lifecycle and added owned paths/
  );
});

test("amendment HTML shows an added path as text, never as markup", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const page = (status, hash, owns) =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      `<div class="issue-detail"><span class="issue-detail-num">1</span><p><strong>Owns:</strong> ${owns}</p><p>Rollback plan.</p></div>`,
      "</main>",
    ].join("\n");
  const prior = page("approved", "a", "<code>src/a.js</code>");
  const added = [{ num: 1, added_owns: ["src/c.js (see <!--)"] }];
  assert.doesNotThrow(() =>
    assertOwnsOnlyHtml(
      prior,
      page("draft", "b", "<code>src/a.js</code>, <code>src/c.js (see &lt;!--)</code>"),
      added
    )
  );
  assert.throws(
    () =>
      assertOwnsOnlyHtml(
        prior,
        page("draft", "b", "<code>src/a.js</code>, <code>src/c.js (see <!--)</code>"),
        added
      ),
    /amendment changed RFC HTML beyond the lifecycle and added owned paths/
  );
});

test("amendment HTML check stays fast for many added paths", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const paths = Array.from({ length: 24 }, (_, index) => `src/p${index}.js`);
  const listing = (items) => items.map((owned) => `<code>${owned}</code>`).join(", ");
  const page = (status, hash, owns, extra) =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      // Each path already appears in the card, so every listing has many candidates.
      `<div class="issue-detail"><span class="issue-detail-num">1</span><p><strong>Owns:</strong> ${owns}</p><p>Related: ${listing(paths)}, ${listing(paths)}</p>${extra}</div>`,
      "</main>",
    ].join("\n");
  const prior = page("approved", "a", "<code>src/a.js</code>", "");
  const owns = listing(["src/a.js", ...paths]);
  const added = [{ num: 1, added_owns: paths }];
  const started = Date.now();
  assert.doesNotThrow(() => assertOwnsOnlyHtml(prior, page("draft", "b", owns, ""), added));
  assert.throws(
    () => assertOwnsOnlyHtml(prior, page("draft", "b", owns, "<p>Stray edit.</p>"), added),
    /amendment changed RFC HTML beyond the lifecycle and added owned paths/
  );
  assert.ok(Date.now() - started < 2000, `check took ${Date.now() - started}ms`);
});
