#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { runPack } = require("./rules/plugin/index.js");
const { SKILL_CLASSIFICATION } = require("./lib/skill-authoring/classification.js");

function parseArgs(argv) {
  const options = { root: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--json") options.json = true;
    else if (argv[index] === "--root" && argv[index + 1]) options.root = argv[++index];
    else throw new Error(`unknown or incomplete argument: ${argv[index]}`);
  }
  return options;
}

function clusterFor(skillClass) {
  return {
    capture: "redirect-capture-read-only",
    redirect: "redirect-capture-read-only",
    "read-only-projection": "redirect-capture-read-only",
    "operational-effect": "operational",
    "evidence-pipeline": "evidence",
    conversational: "product-reasoning",
    lifecycle: "core-legacy",
    "reviewer-gate": "core-legacy",
  }[skillClass];
}

function buildAudit(rootDir) {
  const result = runPack(rootDir);
  const d2 = result.issues.filter((issue) => issue.ruleId.startsWith("D2-"));
  const skills = Object.entries(SKILL_CLASSIFICATION)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, skillClass]) => {
      const prefix = `skills/${name}/`;
      const issues = d2.filter(
        (issue) => issue.file.startsWith(prefix) || issue.file === `commands/${name}.md`
      );
      return {
        name,
        class: skillClass,
        remediation_cluster: clusterFor(skillClass),
        issue_count: issues.length,
        issues,
      };
    });
  return {
    schema_version: 1,
    enforcement: "advisory",
    summary: {
      skill_count: skills.length,
      issue_count: d2.length,
      clean_skill_count: skills.filter((skill) => skill.issue_count === 0).length,
    },
    skills,
  };
}

function render(audit) {
  const lines = [
    `Skill authoring audit: ${audit.summary.issue_count} issue(s) across ${audit.summary.skill_count} skills`,
  ];
  for (const skill of audit.skills.filter((entry) => entry.issue_count > 0)) {
    lines.push(
      `${skill.name} [${skill.class}] — ${skill.issue_count} (${skill.remediation_cluster})`
    );
  }
  return `${lines.join("\n")}\n`;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const audit = buildAudit(path.resolve(options.root));
    process.stdout.write(options.json ? `${JSON.stringify(audit, null, 2)}\n` : render(audit));
  } catch (error) {
    process.stderr.write(`skill-audit: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { buildAudit, parseArgs, render };
