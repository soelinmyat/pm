"use strict";

const LIMIT_CODE =
  /^(?:rate_limit_exceeded|insufficient_quota|quota_exceeded|usage_limit_reached)$/i;
const LIMIT_MESSAGE =
  /\b(?:usage limit|rate limit exceeded|out of credits?|insufficient credits?|quota (?:exceeded|exhausted))\b/i;

function classifyProviderFailure(events, stderr) {
  const errors = [];
  for (const line of String(events || "").split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      if (event.type === "error") errors.push(unwrapError(event));
      if (event.type === "turn.failed") errors.push(unwrapError(event.error));
      if (event.type === "result" && event.is_error === true) {
        errors.push(unwrapError(event.error || { message: event.result }));
      }
    } catch {
      // Diagnostics and model content are not provider failure evidence.
    }
  }
  const failure = errors.at(-1);
  if (failure) {
    if (
      failure.code === "invalid_json_schema" ||
      /invalid schema for (?:response_format|response format)|invalid.*output schema/i.test(
        failure.message
      )
    )
      return "invalid-output-schema";
    if (failure.status === 400) return "provider-request-rejected";
    if (failure.status !== null && failure.status !== 429) return null;
    if (
      failure.status === 429 ||
      LIMIT_CODE.test(failure.code) ||
      LIMIT_MESSAGE.test(failure.message)
    )
      return "usage-limit";
    return null;
  }
  // Accept explicit CLI error lines, never broad INFO/configuration telemetry.
  for (const line of String(stderr || "").split(/\r?\n/)) {
    if (
      /^(?:Error:\s*)?(?:You've hit your usage limit|Usage limit reached|Rate limit exceeded|Out of credits?|Insufficient credits?|Quota exceeded)\b/i.test(
        line.trim()
      )
    )
      return "usage-limit";
  }
  return null;
}

function unwrapError(input, depth = 0) {
  if (depth > 4) return { message: "", code: "", status: null };
  if (typeof input === "string") {
    try {
      return unwrapError(JSON.parse(input), depth + 1);
    } catch {
      return { message: input, code: "", status: null };
    }
  }
  if (!input || typeof input !== "object") return { message: "", code: "", status: null };
  if (input.error) {
    const inner = unwrapError(input.error, depth + 1);
    return { ...inner, status: input.status ?? inner.status };
  }
  if (typeof input.message === "string" && input.message.trim().startsWith("{")) {
    const inner = unwrapError(input.message, depth + 1);
    return { ...inner, code: inner.code || input.code || "", status: input.status ?? inner.status };
  }
  return {
    message: typeof input.message === "string" ? input.message : "",
    code: typeof input.code === "string" ? input.code : "",
    status: input.status ?? null,
  };
}

module.exports = { classifyProviderFailure };
