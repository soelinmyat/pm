"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const { parseJson } = require("./result");

const CODEX_RESULT_ENCODING = "canonical-json-string-v1";

function loadCanonicalSchema(filePath) {
  const Ajv2020 = require("ajv/dist/2020");
  const limit = 256 * 1024;
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  let bytes;
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error("result schema must be a regular file");
    const buffer = Buffer.alloc(limit + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    if (length > limit) throw new Error("result schema exceeds 256 KiB");
    bytes = buffer.subarray(0, length);
  } finally {
    fs.closeSync(fd);
  }
  const schema = JSON.parse(bytes.toString("utf8"));
  const check = new Ajv2020({ strictTypes: false, allErrors: true }).compile(schema);
  return {
    schema,
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    validate(value) {
      if (!check(value)) {
        throw new Error(`canonical result schema rejected output: ${JSON.stringify(check.errors)}`);
      }
      return value;
    },
  };
}

// The provider constrains this closed transport object. Conditional rules and
// open extension objects remain in the exact canonical schema checked locally;
// no canonical property, evidence field or status constraint is projected away.
function buildCodexOutputSchema(canonicalSchema) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["result_json"],
    properties: {
      result_json: {
        type: "string",
        description:
          "Serialize the complete worker result as JSON inside this string. It must satisfy this canonical schema, which is enforced locally: " +
          JSON.stringify(canonicalSchema),
      },
    },
  };
}

function decodeCodexResult(value, encoding) {
  const parsed = parseJson(value, "Codex structured result");
  if (encoding === undefined) return parsed; // Existing direct adapter callers.
  if (encoding !== CODEX_RESULT_ENCODING) throw new Error("unsupported Codex result encoding");
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== 1 ||
    typeof parsed.result_json !== "string"
  )
    throw new Error("Codex result must contain only the result_json transport string");
  return parseJson(parsed.result_json, "canonical worker result");
}

module.exports = {
  CODEX_RESULT_ENCODING,
  loadCanonicalSchema,
  buildCodexOutputSchema,
  decodeCodexResult,
};
