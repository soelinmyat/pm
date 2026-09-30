"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertOwnsOnlyAmendment, parseAmendedIssueNums } = require("../scripts/lib/rfc-amendment");

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

test("amendments must add at least one path to every declared issue", () => {
  assert.throws(() => assertOwnsOnlyAmendment(sidecar(), sidecar(), [2]), /issue 2 adds no/);
  assert.throws(
    () =>
      assertOwnsOnlyAmendment(
        sidecar(),
        amended((value) => value.issues[1].owns.push("test/first_test.rb")),
        [1, 2]
      ),
    /issue 1 adds no/
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
