#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic } = require("./lib/atomic-file");
const { acquireOwnedLock } = require("./lib/owned-lock");
const {
  bindReleaseEvidence,
  beginEffect,
  planEffect,
  reconcileEffect,
  releaseReadiness,
  transactionIssues,
} = require("./lib/release-transaction-schema");

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command.startsWith("--"))
    throw new Error("release transaction command is required");
  const values = {};
  const booleans = new Set(["--json"]);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument: ${flag}`);
    if (booleans.has(flag)) {
      values[flag.slice(2).replaceAll("-", "_")] = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values[flag.slice(2).replaceAll("-", "_")] = value;
  }
  return { command, ...values };
}

function runCommand(args, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const transactionPath = resolvePrivateFile(args.transaction, cwd, "transaction");
  if (["validate", "status"].includes(args.command)) {
    const transaction = readJson(transactionPath, "release transaction");
    const issues = transactionIssues(transaction);
    if (issues.length > 0) throw new Error(`invalid release transaction: ${issues.join("; ")}`);
    return args.command === "validate"
      ? { ok: true, transaction_path: relative(cwd, transactionPath) }
      : statusView(transaction, relative(cwd, transactionPath));
  }
  return mutateTransaction(transactionPath, (transaction) => {
    if (args.command === "plan") {
      const target = readJson(resolveInputFile(args.target_file, cwd, "target"), "effect target");
      return {
        transaction: planEffect(transaction, { effect: args.effect, target }),
        decision: "planned",
      };
    }
    if (args.command === "begin") {
      const session = readJson(resolvePrivateFile(args.session, cwd, "session"), "Dev session");
      if (session.run_id !== transaction.run_id) {
        throw new Error("Dev session run_id does not match the release transaction");
      }
      return beginEffect(transaction, {
        effect: args.effect,
        authority: session.authority,
        actor: args.actor,
      });
    }
    if (args.command === "reconcile") {
      const observation = readJson(
        resolveInputFile(args.observation_file, cwd, "observation"),
        "effect observation"
      );
      const receipt = args.receipt_file
        ? readJson(resolveInputFile(args.receipt_file, cwd, "receipt"), "effect receipt")
        : undefined;
      return reconcileEffect(transaction, {
        effect: args.effect,
        outcome: args.outcome,
        observation,
        receipt,
        reason: args.reason,
        classification: args.classification,
      });
    }
    if (args.command === "bind-evidence") {
      return {
        transaction: bindReleaseEvidence(transaction, {
          kind: args.kind,
          commit: args.commit,
          artifact: args.artifact,
          sha256: args.sha256,
        }),
        decision: "evidence-bound",
      };
    }
    throw new Error(`unknown release transaction command: ${args.command}`);
  });
}

function mutateTransaction(transactionPath, mutation) {
  const release = acquireOwnedLock(`${transactionPath}.lock`, {
    attempts: 200,
    waitMs: 25,
    invalidGraceMs: 1000,
    timeoutMessage: `timed out waiting for release transaction lock: ${transactionPath}`,
  });
  try {
    const transaction = readJson(transactionPath, "release transaction");
    const result = mutation(transaction);
    const issues = transactionIssues(result.transaction);
    if (issues.length > 0) throw new Error(`invalid release transaction: ${issues.join("; ")}`);
    writeJsonAtomic(transactionPath, result.transaction, {
      directoryMode: 0o700,
      fileMode: 0o600,
    });
    return {
      ok: true,
      decision: result.decision,
      effect: result.transaction.effects?.[result.effect]?.name || undefined,
      status: statusView(result.transaction, transactionPath),
    };
  } finally {
    release();
  }
}

function statusView(transaction, transactionPath) {
  const readiness = releaseReadiness(transaction);
  return {
    schema_version: 1,
    transaction_path: transactionPath,
    run_id: transaction.run_id,
    release: {
      version: transaction.release.next_version,
      tag: transaction.release.tag,
      prepared_commit: transaction.release.prepared_commit,
      tag_created: transaction.release.tag_created,
    },
    ready: readiness.ok,
    readiness_issues: readiness.issues,
    effects: Object.fromEntries(
      Object.entries(transaction.effects).map(([name, effect]) => [
        name,
        {
          status: effect.status,
          attempts: effect.attempts.length,
          required_authority: effect.required_authority,
        },
      ])
    ),
  };
}

function resolvePrivateFile(value, cwd, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`--${label} is required`);
  const resolved = path.resolve(cwd, value);
  const privateRoot = path.join(cwd, ".pm");
  if (resolved !== privateRoot && !resolved.startsWith(`${privateRoot}${path.sep}`)) {
    throw new Error(`${label} must be beneath .pm/`);
  }
  return resolved;
}

function resolveInputFile(value, cwd, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`--${label.replaceAll(" ", "-")}-file is required`);
  }
  const resolved = path.resolve(cwd, value);
  const relativePath = path.relative(cwd, resolved);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`${label} file must stay inside the project root`);
  }
  return resolved;
}

function readJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} ${filePath}: ${error.message}`);
  }
  return value;
}

function relative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    const result = runCommand(args);
    process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`release-transaction: ${error.message}\n`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { main, parseArgs, runCommand, statusView };
