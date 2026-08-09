"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDeliveryPlan, verifyPlanDigest } = require("../scripts/repository-delivery-plan");
const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

const commands = {
  "mobile-quality": { glob: "apps/mobile/**/*.{ts,tsx}", run: "pnpm --filter mobile test" },
  "shared-checks": { glob: "{apps/mobile,packages/shared}/**/*.{ts,tsx}", run: "pnpm shared" },
  "api-full": { glob: "apps/api/**", run: "bundle exec rails test" },
};

test("mobile-only selects mobile and shared but excludes API", () => {
  const plan = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: {
      identity: "cap",
      policy: {
        candidate_push: { permitted: true, skipped_commands: [] },
        provenance: "authenticated",
      },
    },
    remote: "origin",
    remoteUrl: "git@example/x",
    refUpdates: [`refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}`],
  });
  assert.deepEqual(plan.targeted_commands, ["mobile-quality", "shared-checks"]);
  assert.equal(plan.targeted_commands.includes("api-full"), false);
  assert.equal(plan.complete_commands.includes("api-full"), false);
  assert.equal(plan.candidate_push.permitted, true);
  assert.equal(verifyPlanDigest(plan), true);
});

test("candidate permission requires protected policy coverage of every skipped command", () => {
  const plan = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands: {
      ...commands,
      "mobile-final": { glob: "apps/mobile/**", run: "pnpm final", candidate: false },
    },
    capabilities: {
      identity: "cap",
      policy: {
        candidate_push: { permitted: true, skipped_commands: [] },
        provenance: "candidate",
      },
    },
  });
  assert.equal(plan.candidate_push.permitted, false);
});

test("protected policy must name every command skipped during candidate publication", () => {
  const withFinal = {
    ...commands,
    "mobile-final": { glob: "apps/mobile/**", run: "pnpm final", candidate: false },
  };
  const denied = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: withFinal,
    capabilities: {
      identity: "x",
      policy: {
        provenance: "authenticated",
        candidate_push: {
          permitted: true,
          candidate_commands: ["mobile-quality", "shared-checks"],
          skipped_commands: [],
        },
      },
    },
  });
  assert.equal(denied.candidate_push.permitted, false);
  const allowed = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands: withFinal,
    capabilities: {
      identity: "x",
      policy: {
        provenance: "authenticated",
        candidate_push: {
          permitted: true,
          candidate_commands: ["mobile-quality", "shared-checks"],
          skipped_commands: ["mobile-final"],
        },
      },
    },
  });
  assert.equal(allowed.candidate_push.permitted, true);
});

test("rejects malformed Git remote and exact four-field ref-update protocol", () => {
  const base = {
    root: "/repo",
    changedPaths: ["apps/mobile/a.ts"],
    commands,
    capabilities: { identity: "cap" },
    remote: "origin",
    remoteUrl: "git@example/x",
  };
  for (const refUpdates of [
    [`refs/heads/x ${OLD_SHA} refs/heads/x`],
    [`refs/heads/x short refs/heads/x ${NEW_SHA}`],
    [`refs/heads/x ${OLD_SHA} refs/heads/x ${NEW_SHA}\nINJECT`],
    [`bad-ref ${OLD_SHA} refs/heads/x ${NEW_SHA}`],
  ])
    assert.throws(() => buildDeliveryPlan({ ...base, refUpdates }), /ref|sha|Git/i);
  assert.throws(
    () => buildDeliveryPlan({ ...base, remote: "origin\n--upload-pack=x", refUpdates: [] }),
    /remote/i
  );
  assert.throws(
    () => buildDeliveryPlan({ ...base, remoteUrl: "git@example/x\nmalformed", refUpdates: [] }),
    /remote/i
  );
});

test("relevant identities alter plan digest", () => {
  const a = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: { identity: "a" },
  });
  const b = buildDeliveryPlan({
    root: "/repo",
    changedPaths: ["apps/mobile/src/a.tsx"],
    commands,
    capabilities: { identity: "b" },
  });
  assert.notEqual(a.plan_digest, b.plan_digest);
});
