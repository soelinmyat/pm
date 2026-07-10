"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const PLUGIN_ROOT = path.resolve(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relPath), "utf8");
}

test("using-pm no longer forces pm:start for direct first messages", () => {
  const text = read("skills/using-pm/SKILL.md");

  assert.match(text, /If it's a direct question or a concrete task/);
  assert.doesNotMatch(
    text,
    /\*\*If it exists\*\* — invoke `pm:start` before responding to the user/
  );
});

test("research quick references are removed from meta and think skills", () => {
  const usingPm = read("skills/using-pm/SKILL.md");
  const think = read("skills/think/SKILL.md");

  assert.doesNotMatch(usingPm, /pm:research quick/);
  assert.doesNotMatch(think, /pm:research quick/);
});

test("start skill explicitly references step files after step extraction", () => {
  const text = read("skills/start/SKILL.md");

  assert.match(text, /runtime conventions/);
  assert.match(text, /Read all `\.md` files from.*skills\/start\/steps\//);
});

test("bootstrap uses evidence/competitors as the canonical competitor location", () => {
  const text = read("skills/start/steps/02-bootstrap.md");

  assert.match(
    text,
    /mkdir -p \{pm_dir\}\/evidence\/\{competitors,research,transcripts,user-feedback\}/
  );
  assert.doesNotMatch(text, /mkdir -p \{pm_dir\}\/insights\/\{trends,competitors,business\}/);
  assert.match(text, /Competitor profiling lives under `\{pm_dir\}\/evidence\/competitors\/`/);
});

test("sync skill references kb-sync-git.js and does not use raw curl", () => {
  const text = read("skills/sync/SKILL.md");

  assert.match(text, /kb-sync-git\.js/);
  assert.doesNotMatch(text, /curl -s -H "Authorization: Bearer \{token\}"/);
});

test("sync skill keeps bare sync bidirectional with explicit pull and push overrides", () => {
  const skill = read("skills/sync/SKILL.md");
  const command = read("commands/sync.md");
  const parse = read("skills/sync/steps/01-parse-subcommand.md");
  const pullStep = read("skills/sync/steps/04-pull.md");
  const pushStep = read("skills/sync/steps/05-push.md");

  assert.match(skill, /Bare `\/pm:sync` is always bidirectional/);
  assert.match(command, /With no subcommand, run bidirectional sync/);
  assert.match(parse, /Route to `sync`/);
  assert.match(pullStep, /kb-sync-git\.js" sync/);
  assert.match(pushStep, /selected route is `push`/);
  assert.doesNotMatch(
    `${parse}\n${pullStep}\n${pushStep}`,
    /route is `auto`|selected route is `auto`/
  );
});

test("loop docs describe the lease envelope and isolated recovery transactions", () => {
  const readme = read("README.md");
  const skill = read("skills/loop/SKILL.md");
  const config = read("skills/loop/steps/04-config.md");
  const work = read("skills/loop/steps/06-work.md");

  assert.match(config, /budgets\.lease_ttl_seconds/);
  assert.match(config, /claim-to-final-push\s+envelope/);
  assert.match(config, /scheduler overlap margin/);
  assert.match(work, /detached PM Git transaction/);
  assert.match(work, /pm\/loop\/events\/.*run_id/);
  assert.match(work, /pm\/loop\/recovery\/.*run_id/);
  assert.match(work, /never-dispatched/);
  assert.match(work, /dispatched-without-terminal-result/);
  assert.match(work, /recovery-required/);
  assert.match(skill, /needs-human.*non-dispatchable/is);
  assert.match(work, /PM_LOOP_RESULT_FILE/);
  assert.match(work, /failed-contract/);
  assert.match(work, /\.pm\/loop-results\/<run_id>/);
  assert.match(readme, /validated stage results.*needs-human/is);
});

test("loop docs keep scheduling gated on exact same-identity supervised canaries", () => {
  const readme = read("README.md");
  const install = read(".codex/INSTALL.md");
  const skill = read("skills/loop/SKILL.md");
  const config = read("skills/loop/steps/04-config.md");
  const route = read("skills/loop/steps/01-route.md");
  const installStep = read("skills/loop/steps/05-install.md");
  const work = read("skills/loop/steps/06-work.md");
  const all = [readme, install, skill, config, route, installStep, work].join("\n");

  assert.match(
    all,
    /node scripts\/loop-canary\.js --project-dir "\$CLEANLOG_ROOT" --case preflight-failure/
  );
  assert.match(
    all,
    /node scripts\/loop-canary\.js --project-dir "\$CLEANLOG_ROOT" --case blocked-result/
  );
  assert.match(
    all,
    /node scripts\/loop-canary\.js --project-dir "\$CLEANLOG_ROOT" --case verified-pr --card "\$CANARY_CARD" --no-merge/
  );
  assert.match(all, /usage_available: false/);
  assert.match(all, /TERM.*KILL/is);
  assert.match(all, /same.*plugin.*source.*config.*engine/is);
  assert.match(all, /stale.*mixed.*fail/is);
  assert.match(all, /scheduler.*(paused|uninstalled).*until/is);
  assert.match(all, /--scheduled/);
  assert.match(all, /scheduled.*wake.*rechecks/is);
  assert.match(route, /canary-required/);
  assert.match(installStep, /Linux updates crontab/);
  assert.match(all, /does not support exact token cutoffs/i);
});

test("loop-capable workflows return stage results and leave durable card writes to the worker", () => {
  const contracts = {
    dev: /shipped, blocked, failed, noop/,
    ship: /merged, ready-for-human, waiting, blocked, failed, noop/,
    rfc: /artifact-ready, needs-approval, blocked, failed, noop/,
    research: /artifact-ready, blocked, failed, noop/,
  };

  for (const [skill, statuses] of Object.entries(contracts)) {
    const text = read(`skills/${skill}/SKILL.md`);
    assert.match(text, /Loop Worker Mode \(headless\)/, `${skill} needs a loop-mode contract`);
    assert.match(text, /PM_LOOP_RESULT_FILE/, `${skill} must name the result capability`);
    assert.match(
      text,
      /only canonical durable card-state writer/i,
      `${skill} must enforce one writer`
    );
    assert.match(text, /do not (write|update).*backlog|skip.*backlog writes/i);
    assert.match(text, statuses, `${skill} must list its exact stage statuses`);
  }

  assert.match(read("skills/dev/SKILL.md"), /TDD.*review.*QA.*verification/is);
  assert.match(read("skills/ship/SKILL.md"), /review.*CI.*verification/is);
  assert.match(read("skills/rfc/SKILL.md"), /human approval.*never.*self-approve/is);
  assert.match(read("skills/rfc/SKILL.md"), /document.*mode `?0600`?/is);
  assert.match(read("skills/research/SKILL.md"), /sourcing.*synthesis.*verification/is);
  assert.match(read("skills/research/SKILL.md"), /document.*mode `?0600`?/is);

  for (const file of [
    "skills/dev/steps/03-workspace.md",
    "skills/ship/steps/07-merge-loop.md",
    "skills/rfc/steps/02-rfc-generation.md",
    "skills/rfc/steps/03-rfc-review.md",
    "skills/research/steps/03-landscape.md",
    "skills/research/steps/04-competitor.md",
    "skills/research/steps/05-topic.md",
  ]) {
    const text = read(file);
    assert.match(text, /PM_LOOP_WORKER/, `${file} needs an executable loop-mode branch`);
    assert.match(
      text,
      /PM_LOOP_RESULT_(FILE|DIR)|skip.*(backlog|PM|index|log).*write/i,
      `${file} must route or skip its normal durable writes`
    );
  }
});
