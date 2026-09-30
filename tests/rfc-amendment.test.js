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

test("amendment HTML ends each amended issue card with one line of its added paths and changes nothing else", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const page = (status, hash, one, two, after = "") =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      `<div class="issue-detail"><span class="issue-detail-num">1</span>\n  ${one}\n</div>`,
      `<section class="issue-detail"><span class="issue-detail-num">2</span>\n  ${two}\n</section>`,
      after,
      "</main>",
    ].join("\n");
  // Issue 1 lists its files in prose, issue 2 in an owned-files list.
  const one =
    "<p>Owns the parser in <code>src/a&amp;b.js</code>.</p><ul><li>Modify: <code>src/a&amp;b.js</code></li></ul>";
  const two =
    "<details><summary>Owned files</summary><ul><li>src/two.js</li></ul></details><p>Verify: <code>npm test</code></p>";
  const prior = page("approved", "a", one, two);
  const line = (...paths) =>
    `<p><strong>Added owned files:</strong> ${paths.map((item) => `<code>${item}</code>`).join(", ")}</p>`;
  const added = [{ num: 2, added_owns: ["src/c&d.js", "src/e.js"] }];
  const both = [{ num: 1, added_owns: ["src/f.js"] }, ...added];
  const cd = "src/c&amp;d.js";
  const accepted = [
    [page("draft", "b", one, `${two}${line(cd, "src/e.js")}`), added],
    [
      page(
        "draft",
        "b",
        one,
        `${two}\n  <p><strong>Added owned files:</strong>\n    <code>${cd}</code>,\n    <code>src/e.js</code></p>`
      ),
      added,
    ],
    [page("draft", "b", `${one}${line("src/f.js")}`, `${two}${line(cd, "src/e.js")}`), both],
  ];
  for (const [next, changes] of accepted) {
    assert.doesNotThrow(() => assertOwnsOnlyHtml(prior, next, changes));
  }
  // A later amendment adds its own line after the earlier one.
  const once = page("approved", "c", one, `${two}${line(cd)}`);
  assert.doesNotThrow(() =>
    assertOwnsOnlyHtml(once, page("draft", "d", one, `${two}${line(cd)}${line("src/e.js")}`), [
      { num: 2, added_owns: ["src/e.js"] },
    ])
  );
  const misplaced = {
    "leaves the line out": page("draft", "b", one, two),
    "adds the line to another issue": page("draft", "b", `${one}${line(cd, "src/e.js")}`, two),
    "lists the paths in the owned-files list": page(
      "draft",
      "b",
      one,
      two.replace("</li></ul>", `</li><li>${cd}</li><li>src/e.js</li></ul>`)
    ),
    "puts the line before other card content": page(
      "draft",
      "b",
      one,
      `${line(cd, "src/e.js")}${two}`
    ),
    "puts the line after the last card": page("draft", "b", one, two, line(cd, "src/e.js")),
    "lists a path unescaped": page("draft", "b", one, `${two}${line("src/c&d.js", "src/e.js")}`),
    "lists the paths out of order": page("draft", "b", one, `${two}${line("src/e.js", cd)}`),
    "leaves a path out": page("draft", "b", one, `${two}${line(cd)}`),
    "lists an undeclared path": page(
      "draft",
      "b",
      one,
      `${two}${line(cd, "src/e.js", "src/x.js")}`
    ),
    "hides the line in a comment": page(
      "draft",
      "b",
      one,
      `${two}<!-- ${line(cd, "src/e.js")} -->`
    ),
  };
  for (const [label, next] of Object.entries(misplaced)) {
    assert.throws(
      () => assertOwnsOnlyHtml(prior, next, added),
      (error) =>
        error.message ===
        `amendment HTML must end issue 2's card with its added owned files, exactly: ${line(cd, "src/e.js")}`,
      label
    );
  }
  const redesigned = {
    "adds prose": page("draft", "b", one, `${two}<p>New prose.</p>${line(cd, "src/e.js")}`),
    "deletes a prior line": page(
      "draft",
      "b",
      "<p>Owns the parser in <code>src/a&amp;b.js</code>.</p>",
      `${two}${line(cd, "src/e.js")}`
    ),
    "lists the line twice": page(
      "draft",
      "b",
      one,
      `${two}${line(cd, "src/e.js")}${line(cd, "src/e.js")}`
    ),
    "adds a line for an undeclared issue": page(
      "draft",
      "b",
      `${one}${line("src/f.js")}`,
      `${two}${line(cd, "src/e.js")}`
    ),
  };
  for (const [label, next] of Object.entries(redesigned)) {
    assert.throws(
      () => assertOwnsOnlyHtml(prior, next, added),
      /amendment changed RFC HTML beyond the lifecycle and added owned paths; any other change is a new RFC design/,
      label
    );
  }
  assert.throws(
    () =>
      assertOwnsOnlyHtml(prior, page("draft", "b", one, `${two}${line(cd, "src/e.js")}`), [
        { num: 3, added_owns: ["src/g.js"] },
      ]),
    /must end issue 3's card/
  );
});

test("amendment HTML finds each issue card by its badge, whatever markup the card holds", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const line = "<p><strong>Added owned files:</strong> <code>src/new.js</code></p>";
  const page = (status, hash, open, badge, body, extra) =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      `<section class="issue-detail"><span class="issue-detail-num">1</span><p>Owns <code>src/one.js</code>.</p></section>`,
      `${open}<span class="issue-detail-num">${badge}</span>${body}${extra}</section>`,
      "</main>",
    ].join("\n");
  const cards = {
    "an Issue-prefixed badge": ['<section class="issue-detail">', "Issue 2", "<p>Owns.</p>"],
    "a zero-padded badge": ['<section class="issue-detail">', "02", "<p>Owns.</p>"],
    "a quoted greater-than before the class": [
      '<section data-note="a>b" class="issue-detail">',
      "2",
      "<p>Owns.</p>",
    ],
    "a closing tag inside a comment": [
      '<section class="issue-detail">',
      "2",
      "<!-- ends at </section> --><p>Owns.</p>",
    ],
    "a nested element of the same name": [
      '<section class="issue-detail">',
      "2",
      "<section><p>Owns.</p></section>",
    ],
  };
  const added = [{ num: 2, added_owns: ["src/new.js"] }];
  for (const [label, [open, badge, body]] of Object.entries(cards)) {
    const prior = page("approved", "a", open, badge, body, "");
    assert.doesNotThrow(
      () => assertOwnsOnlyHtml(prior, page("draft", "b", open, badge, body, line), added),
      label
    );
    assert.throws(
      () => assertOwnsOnlyHtml(prior, page("draft", "b", open, badge, body, ""), added),
      /must end issue 2's card with its added owned files/,
      label
    );
  }
  // A badge naming another issue, or only mentioning the number, is not that card.
  for (const badge of ["Issue 12", "2b", "PM-244-2"]) {
    const open = '<section class="issue-detail">';
    const prior = page("approved", "a", open, badge, "<p>Owns.</p>", "");
    assert.throws(
      () => assertOwnsOnlyHtml(prior, page("draft", "b", open, badge, "<p>Owns.</p>", line), added),
      /must end issue 2's card/,
      badge
    );
  }
});

test("amendment HTML shows an added path as text, never as markup", () => {
  const { assertOwnsOnlyHtml } = require("../scripts/lib/rfc-session-schema");
  const page = (status, hash, extra) =>
    [
      `<script id="pm-artifact" type="application/json">{"lifecycle":"${status}"}</script>`,
      `<script id="rfc-lifecycle" type="application/json">{"status":"${status}"}</script>`,
      `<main data-sidecar-hash="sha256:${hash.repeat(64)}">`,
      `<p>Status: <span data-pm-lifecycle>${status[0].toUpperCase()}${status.slice(1)}</span></p>`,
      `<div class="issue-detail"><span class="issue-detail-num">1</span><p><strong>Owns:</strong> <code>src/a.js</code></p>${extra}</div>`,
      "</main>",
    ].join("\n");
  const prior = page("approved", "a", "");
  const added = [{ num: 1, added_owns: ["src/c.js (see <!--)"] }];
  assert.doesNotThrow(() =>
    assertOwnsOnlyHtml(
      prior,
      page(
        "draft",
        "b",
        "<p><strong>Added owned files:</strong> <code>src/c.js (see &lt;!--)</code></p>"
      ),
      added
    )
  );
  assert.throws(
    () =>
      assertOwnsOnlyHtml(
        prior,
        page(
          "draft",
          "b",
          "<p><strong>Added owned files:</strong> <code>src/c.js (see <!--)</code></p>"
        ),
        added
      ),
    /must end issue 1's card with its added owned files, exactly: .*src\/c\.js \(see &lt;!--\)/
  );
});
