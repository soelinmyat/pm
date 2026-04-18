"use strict";

/**
 * Stub for an "agent dispatch" boundary — a scripted responder that matches
 * prompt fragments against a lookup table. Use this when an assertion needs
 * to drive a skill that would otherwise call out to a sub-agent.
 *
 * @param {Array<{match: (string|RegExp), response: any}>} scriptedResponses
 *   Each entry is tested in order. A string `match` is treated as a substring
 *   check on the prompt; a RegExp is tested as a regex. The first match wins.
 *
 * @returns {{
 *   dispatch(prompt: string): any,
 *   calls: Array<{prompt: string, response: any}>,
 * }}
 */
function createAgentDispatchStub(scriptedResponses) {
  const responses = Array.isArray(scriptedResponses) ? scriptedResponses : [];
  const calls = [];
  return {
    calls,
    dispatch(prompt) {
      for (const entry of responses) {
        const matches =
          entry.match instanceof RegExp
            ? entry.match.test(prompt)
            : String(prompt).includes(entry.match);
        if (matches) {
          calls.push({ prompt, response: entry.response });
          return entry.response;
        }
      }
      throw new Error(`agent-dispatch stub: no scripted response for prompt: ${prompt}`);
    },
  };
}

module.exports = { createAgentDispatchStub };
