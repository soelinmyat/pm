"use strict";

const VIEWPORT_BOUNDS = Object.freeze({
  desktop: Object.freeze({ minWidth: 1024, maxWidth: 8192, minHeight: 600, maxHeight: 8192 }),
  tablet: Object.freeze({ minWidth: 601, maxWidth: 1023, minHeight: 600, maxHeight: 8192 }),
  narrow: Object.freeze({ minWidth: 320, maxWidth: 600, minHeight: 480, maxHeight: 8192 }),
});
const MAX_VIEWPORT_PIXELS = 16_777_216;

function validateWebViewport(name, width, height) {
  const bounds = VIEWPORT_BOUNDS[name];
  if (!bounds) throw new Error("trusted web capture supports desktop, tablet, or narrow viewports");
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
    throw new Error("viewport width and height must be safe integers");
  }
  if (width < bounds.minWidth || width > bounds.maxWidth) {
    throw new Error(`${name} viewport width ${width} is outside its accepted range`);
  }
  if (height < bounds.minHeight) {
    throw new Error(`${name} viewport height ${height} must be at least ${bounds.minHeight}`);
  }
  if (height > bounds.maxHeight) {
    throw new Error(`${name} viewport height ${height} must be at most ${bounds.maxHeight}`);
  }
  if (width > Math.floor(MAX_VIEWPORT_PIXELS / height)) {
    throw new Error(
      `${name} viewport ${width}x${height} exceeds the ${MAX_VIEWPORT_PIXELS}-pixel budget`
    );
  }
  return { width, height };
}

module.exports = { MAX_VIEWPORT_PIXELS, VIEWPORT_BOUNDS, validateWebViewport };
