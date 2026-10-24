"use strict";

const { PRODUCT_UI_VISUAL_THRESHOLDS, visualDifference } = require("./media-inspect");

// Native-derived bands must show material change on at least two edges and
// enough actual pixel support; tiny beacons cannot borrow surrounding content.
function hasNativeFocusBandChange(inspectBefore, inspectAfter, regions) {
  let qualifying = 0;
  let support = 0;
  for (const region of regions) {
    const before = inspectBefore(region);
    const difference = visualDifference(before, inspectAfter(region));
    if (
      !difference ||
      difference.distance < PRODUCT_UI_VISUAL_THRESHOLDS.minVisualDistance ||
      difference.changedTileRatio < PRODUCT_UI_VISUAL_THRESHOLDS.minChangedTileRatio
    )
      continue;
    qualifying++;
    const cells = Buffer.from(before.perceptualGrid, "base64").length / 3;
    const size = Math.sqrt(cells);
    support +=
      difference.distance *
      cells *
      Math.max(1, Math.floor(region.width / size)) *
      Math.max(1, Math.floor(region.height / size));
    if (qualifying >= 2 && support >= 32) return true;
  }
  return false;
}

module.exports = { hasNativeFocusBandChange };
