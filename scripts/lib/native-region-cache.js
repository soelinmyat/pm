"use strict";

const { createPngRegionInspector, inspectPngHeaderBytes } = require("./media-inspect");

// Cache only bounded derived metrics, never full decoded PNG closures. The
// caller supplies a descriptor-read, hash-verified file and native geometry.
function createNativeRegionCache({ maxRegions = 4096, maxDecodedPixels = 256 * 1024 * 1024 } = {}) {
  if (![maxRegions, maxDecodedPixels].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error("native region work limits must be positive integers");
  const metrics = new Map();
  let decodedPixels = 0;
  let failure = null;
  function budgetFailure() {
    failure ||= `native regional evidence exceeds the ${maxRegions}-region or ${maxDecodedPixels}-decoded-pixel work budget`;
    const error = new Error(failure);
    error.code = "PM_NATIVE_REGION_BUDGET";
    throw error;
  }
  return {
    get failure() {
      return failure;
    },
    inspect(file, region) {
      const key = JSON.stringify([
        file.path,
        file.sha256,
        region.x,
        region.y,
        region.width,
        region.height,
      ]);
      if (metrics.has(key)) return metrics.get(key);
      if (failure || metrics.size >= maxRegions) return budgetFailure();
      const header = inspectPngHeaderBytes(file.bytes);
      if (
        ![region.x, region.y, region.width, region.height].every(Number.isInteger) ||
        region.x < 0 ||
        region.y < 0 ||
        region.width < 1 ||
        region.height < 1 ||
        region.x + region.width > header.width ||
        region.y + region.height > header.height
      )
        throw new Error("invalid native PNG region");
      const cost = header.width * header.height;
      if (decodedPixels + cost > maxDecodedPixels) return budgetFailure();
      decodedPixels += cost;
      const value = createPngRegionInspector(file.bytes)(region);
      metrics.set(key, value);
      return value;
    },
  };
}

module.exports = { createNativeRegionCache };
