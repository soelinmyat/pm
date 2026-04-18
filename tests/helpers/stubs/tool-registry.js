"use strict";

/**
 * Stub for the tool-registry boundary. Returns a minimal resolver that maps
 * tool names to fixture objects.
 *
 * @param {Record<string, any>} tools  name -> tool fixture.
 *
 * @returns {{
 *   resolve(name: string): any,
 * }}
 */
function createToolRegistryStub(tools) {
  const map = Object.assign({}, tools || {});
  return {
    resolve(name) {
      if (!(name in map)) {
        throw new Error(`tool-registry stub: no tool registered as "${name}"`);
      }
      return map[name];
    },
  };
}

module.exports = { createToolRegistryStub };
