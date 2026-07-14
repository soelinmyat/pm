#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { writeJsonAtomic } = require("./lib/atomic-file.js");
const { runOperationalEffect } = require("./lib/operational-effect-journal.js");
const { stableStringify } = require("./lib/workflow-runtime/records.js");

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const FIELD_SEGMENT = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function readConfigBytes(configPath) {
  const stat = fs.lstatSync(configPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("config must be a regular file");
  return fs.readFileSync(configPath);
}

function readConfig(configPath) {
  const value = JSON.parse(readConfigBytes(configPath).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("config root must be an object");
  }
  return value;
}

function fieldSegments(field) {
  if (typeof field !== "string" || !field || field.startsWith(".") || field.endsWith(".")) {
    throw new TypeError("config field must be a dotted path");
  }
  const segments = field.split(".");
  if (
    segments.some(
      (segment) => !FIELD_SEGMENT.test(segment) || FORBIDDEN_SEGMENTS.has(segment.toLowerCase())
    )
  ) {
    throw new TypeError("config field contains an unsupported segment");
  }
  return segments;
}

function valueAt(root, segments) {
  let current = root;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setValue(root, segments, value) {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!Object.hasOwn(current, segment)) current[segment] = {};
    if (
      !current[segment] ||
      typeof current[segment] !== "object" ||
      Array.isArray(current[segment])
    ) {
      throw new Error(`config field parent is not an object: ${segment}`);
    }
    current = current[segment];
  }
  current[segments.at(-1)] = structuredClone(value);
}

function deleteValue(root, segments) {
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return;
    current = current[segment];
  }
  if (current && typeof current === "object") delete current[segments.at(-1)];
}

function normalizeChanges(options) {
  const raw = options.changes || [
    {
      operation: "set",
      field: options.field,
      value: options.value,
    },
  ];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) {
    throw new TypeError("config changes must contain 1 to 16 operations");
  }
  const seen = new Set();
  return raw.map((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new TypeError("each config change must be an object");
    }
    if (!["set", "delete"].includes(change.operation)) {
      throw new TypeError("config change operation must be set or delete");
    }
    const segments = fieldSegments(change.field);
    if (seen.has(change.field)) throw new Error(`duplicate config field: ${change.field}`);
    seen.add(change.field);
    if (change.operation === "set" && change.value === undefined) {
      throw new TypeError("set config change requires a JSON value");
    }
    return {
      operation: change.operation,
      field: change.field,
      segments,
      ...(change.operation === "set" ? { value: structuredClone(change.value) } : {}),
    };
  });
}

function changeMatches(config, change) {
  const observed = valueAt(config, change.segments);
  if (change.operation === "delete") return observed === undefined;
  return stableStringify(observed) === stableStringify(change.value);
}

function configReceipt(configPath, changes) {
  const bytes = readConfigBytes(configPath);
  const receipt = {
    config_sha256: sha256(bytes),
    fields: changes.map((change) => change.field),
    intent_sha256: sha256(
      stableStringify(changes.map(({ operation, field, value }) => ({ operation, field, value })))
    ),
  };
  if (changes.length === 1) {
    receipt.field = changes[0].field;
    receipt.value_sha256 = sha256(
      stableStringify(changes[0].operation === "set" ? changes[0].value : null)
    );
  }
  return receipt;
}

function applyConfigEffect(options) {
  const projectDir = path.resolve(options.projectDir || process.cwd());
  const pmStateDir = path.join(projectDir, ".pm");
  const configPath = path.join(pmStateDir, "config.json");
  const changes = normalizeChanges(options);
  const configExists = fs.existsSync(configPath);
  if (!configExists && (!options.initialConfig || typeof options.initialConfig !== "object")) {
    throw new Error("config does not exist and no initialConfig scaffold was supplied");
  }
  const initialBytes = configExists ? readConfigBytes(configPath) : null;
  const initialHash = initialBytes ? sha256(initialBytes) : "absent";
  const intentHash = sha256(
    stableStringify(changes.map(({ operation, field, value }) => ({ operation, field, value })))
  );
  const recovery = {
    code: "inspect-config-effect",
    command: "/pm:setup status",
  };

  const observe = () => {
    try {
      const config = readConfig(configPath);
      if (!changes.every((change) => changeMatches(config, change))) {
        return { state: "absent", safe_to_retry: true, reason: "configured value is absent" };
      }
      return { state: "verified", receipt: configReceipt(configPath, changes) };
    } catch (error) {
      return { state: "ambiguous", reason: error.message };
    }
  };

  return runOperationalEffect({
    pmStateDir,
    workflow: "setup",
    effect: "update-config",
    authorityAction: "update_config",
    authorityActions: options.authorityActions,
    target: { file: ".pm/config.json", fields: changes.map((change) => change.field) },
    intent: { value_sha256: intentHash },
    precondition: { config_sha256: initialHash },
    recovery,
    observe,
    mutate() {
      if (typeof options.beforeMutate === "function") options.beforeMutate();
      const currentExists = fs.existsSync(configPath);
      const currentBytes = currentExists ? readConfigBytes(configPath) : null;
      const currentHash = currentBytes ? sha256(currentBytes) : "absent";
      if (currentHash !== initialHash) {
        return {
          blocked: true,
          reason: "config changed after the effect was planned",
          recovery: {
            code: "config-precondition-changed",
            command: "/pm:setup status",
          },
        };
      }
      const config = currentBytes
        ? JSON.parse(currentBytes.toString("utf8"))
        : structuredClone(options.initialConfig);
      for (const change of changes) {
        if (change.operation === "set") setValue(config, change.segments, change.value);
        else deleteValue(config, change.segments);
      }
      writeJsonAtomic(configPath, config, { fileMode: 0o600, directoryMode: 0o700 });
      return { receipt: configReceipt(configPath, changes) };
    },
  });
}

function parseArgs(argv) {
  const options = { projectDir: process.cwd(), authorityActions: [], changes: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project-dir") options.projectDir = argv[++index];
    else if (arg === "--field") options.field = argv[++index];
    else if (arg === "--value-json") options.value = JSON.parse(argv[++index]);
    else if (arg === "--set-json") {
      options.changes.push({
        operation: "set",
        field: argv[++index],
        value: JSON.parse(argv[++index]),
      });
    } else if (arg === "--set-number") {
      const field = argv[++index];
      const value = Number(argv[++index]);
      if (!Number.isFinite(value)) throw new Error("--set-number requires a finite number");
      options.changes.push({ operation: "set", field, value });
    } else if (arg === "--set-local-pointer") {
      options.changes.push({
        operation: "set",
        field: argv[++index],
        value: { type: "local", path: argv[++index] },
      });
    } else if (arg === "--delete-field") {
      options.changes.push({ operation: "delete", field: argv[++index] });
    } else if (arg === "--initial-project-name") {
      const projectName = argv[++index];
      options.initialConfig = {
        config_schema: 2,
        project_name: projectName,
        integrations: {
          linear: { enabled: false },
          seo: { provider: "none" },
        },
        preferences: {},
      };
    } else if (arg === "--authorize") options.authorityActions.push(argv[++index]);
    else throw new Error(`unknown config-effect option: ${arg}`);
  }
  if (options.changes.length === 0) delete options.changes;
  if ((!options.field || options.value === undefined) && !options.changes) {
    throw new Error(
      "usage: config-effect --field <dotted-path> --value-json <json> --authorize update_config"
    );
  }
  return options;
}

function main() {
  try {
    const result = applyConfigEffect(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.state !== "verified") process.exitCode = 3;
  } catch (error) {
    process.stderr.write(`config-effect: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { applyConfigEffect, fieldSegments, normalizeChanges, readConfig, sha256 };

if (require.main === module) main();
