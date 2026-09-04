"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const {
  PRODUCT_UI_VISUAL_THRESHOLDS,
  inspectPdfBytes,
  inspectPngBytes,
  inspectPngVisualBytes,
  visualDifference,
  visualDistance,
} = require("../scripts/lib/media-inspect");

test("strict PNG inspection accepts a complete decodable image", () => {
  assert.deepEqual(inspectPngBytes(png({ colorType: 6 })), { width: 10, height: 10 });
});

test("visual PNG inspection ignores ancillary encoding bytes in its pixel identity", () => {
  const first = inspectPngVisualBytes(png({ colorType: 6, textByte: 0x61 }));
  const second = inspectPngVisualBytes(png({ colorType: 6, textByte: 0x62 }));

  assert.equal(first.pixelSha256, second.pixelSha256);
  assert.equal(first.visiblePixels, 0);
  assert.equal(first.hasVisualVariation, false);
});

test("visual PNG inspection has one pixel identity across PNG row-filter encodings", () => {
  const encodings = [0, 1, 2, 3, 4].map((filter) => filteredRgbaPng(filter));
  const inspected = encodings.map((bytes) => inspectPngVisualBytes(bytes));

  assert.equal(new Set(encodings.map((bytes) => bytes.toString("base64"))).size, 5);
  assert.equal(new Set(inspected.map((item) => item.pixelSha256)).size, 1);
  assert.ok(inspected.every((item) => item.visiblePixels === 100));
  assert.ok(inspected.every((item) => item.hasVisualVariation === true));
  assert.equal(new Set(inspected.map((item) => item.perceptualGrid)).size, 1);
  assert.ok(inspected.every((item) => item.meaningfulPixelRatio > 0.9));
  assert.ok(inspected.every((item) => item.meaningfulTileRatio > 0.9));
  assert.ok(inspected.every((item) => item.colorBucketCount > 10));
  assert.ok(inspected.every((item) => item.luminanceRange > 100));
});

test("visual PNG metrics expose a one-pixel beacon as spatially near blank", () => {
  const inspected = inspectPngVisualBytes(
    rgbaPng(100, 100, (x, y) => (x === 50 && y === 50 ? [0, 0, 0, 255] : [255, 255, 255, 255]))
  );
  assert.equal(inspected.visiblePixels, 10_000);
  assert.equal(inspected.hasVisualVariation, true);
  assert.equal(inspected.meaningfulPixelRatio, 0.0001);
  assert.equal(inspected.meaningfulTileRatio, 0);
  assert.equal(inspected.colorBucketCount, 2);
});

test("visual PNG metrics reject a 99.75 percent uniform two-tile beacon", () => {
  const width = 1024;
  const height = 600;
  const changedPixels = Math.ceil(width * height * 0.0025);
  const changedPerTile = Math.ceil(changedPixels / 2);
  const tileWidth = width / 8;
  const inspected = inspectPngVisualBytes(
    rgbaPng(width, height, (x, y) => {
      const firstTileIndex = y * tileWidth + x;
      const secondTileIndex = y * tileWidth + x - tileWidth;
      const changed =
        (x < tileWidth && firstTileIndex < changedPerTile) ||
        (x >= tileWidth && x < tileWidth * 2 && secondTileIndex < changedPixels - changedPerTile);
      return changed ? [0, 0, 0, 255] : [250, 250, 250, 255];
    })
  );
  assert.ok(inspected.meaningfulPixelRatio >= 0.002);
  assert.ok(inspected.meaningfulPixelRatio < 0.003);
  assert.equal(inspected.meaningfulTileRatio, 2 / 64);
  assert.ok(inspected.meaningfulPixelRatio < PRODUCT_UI_VISUAL_THRESHOLDS.minMeaningfulPixelRatio);
});

test("perceptual distance is deterministic and detects materially different UI pixels", () => {
  const first = inspectPngVisualBytes(
    rgbaPng(64, 64, (x) => (x < 32 ? [20, 40, 180, 255] : [240, 240, 250, 255]))
  );
  const same = inspectPngVisualBytes(
    rgbaPng(64, 64, (x) => (x < 32 ? [20, 40, 180, 255] : [240, 240, 250, 255]))
  );
  const changed = inspectPngVisualBytes(
    rgbaPng(64, 64, (y) => (y < 32 ? [190, 30, 40, 255] : [15, 25, 35, 255]))
  );
  assert.equal(visualDistance(first, same), 0);
  assert.ok(visualDistance(first, changed) > 0.2);
});

test("visual difference does not treat a 200-pixel patch as material full-page change", () => {
  const width = 1024;
  const height = 600;
  const base = inspectPngVisualBytes(
    rgbaPng(width, height, (x) => (x < width / 2 ? [20, 40, 180, 255] : [240, 240, 250, 255]))
  );
  const changed = inspectPngVisualBytes(
    rgbaPng(width, height, (x, y) => {
      const index = y * width + x;
      if (index >= width * height - 200) return [0, 0, 0, 255];
      return x < width / 2 ? [20, 40, 180, 255] : [240, 240, 250, 255];
    })
  );
  const difference = visualDifference(base, changed);
  assert.ok(difference.distance < PRODUCT_UI_VISUAL_THRESHOLDS.minVisualDistance);
  assert.ok(difference.changedTileRatio < PRODUCT_UI_VISUAL_THRESHOLDS.minChangedTileRatio);
});

test("visual PNG inspection rejects transparency it cannot canonicalize", () => {
  const bytes = png({ colorType: 0, transparency: true });
  assert.deepEqual(inspectPngBytes(bytes), { width: 10, height: 10 });
  assert.throws(
    () => inspectPngVisualBytes(bytes),
    /transparency chunks are unsupported for visual identity/
  );
});

test("strict PNG inspection rejects indexed images without a palette", () => {
  assert.throws(() => inspectPngBytes(png({ colorType: 3 })), /requires a palette/);
});

test("strict PNG inspection rejects bytes after IEND", () => {
  assert.throws(
    () => inspectPngBytes(Buffer.concat([png({ colorType: 6 }), Buffer.from("trailing")])),
    /end chunk/
  );
});

test("strict PDF inspection resolves xref objects instead of trusting token text", () => {
  const fakeObjects =
    "% /Type /Catalog /Pages 2 0 R /Type /Pages /Count 1 /Kids [3 0 R] /Type /Page";
  let body = `%PDF-1.7\n${fakeObjects}\n${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 2\n0000000000 65535 f \n0000000009 00000 n \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  assert.throws(
    () => inspectPdfBytes(Buffer.from(body, "latin1")),
    /xref entry|cannot be resolved/
  );
});

test("strict PDF inspection ignores page-tree tokens inside object streams", () => {
  const streamTokens =
    "/Type /Catalog /Pages 2 0 R /Type /Pages /Count 1 /Kids [3 0 R] /Type /Page";
  const objects = [
    `1 0 obj\n<< /Length ${streamTokens.length} >>\nstream\n${streamTokens}\nendstream\nendobj\n`,
    "2 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
    "3 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  assert.throws(() => inspectPdfBytes(Buffer.from(body, "latin1")), /Root is not a Catalog/);
});

test("strict PDF inspection ignores page-tree tokens inside dictionary comments and strings", () => {
  const objects = [
    "1 0 obj\n<< /Length 0 % /Type /Catalog /Pages 2 0 R\n /Note (/Type /Catalog /Pages 2 0 R) >>\nstream\n\nendstream\nendobj\n",
    "2 0 obj\n<< /Length 0 % /Type /Pages /Count 1 /Kids [3 0 R]\n /Note (/Type /Pages /Count 1 /Kids [3 0 R]) >>\nstream\n\nendstream\nendobj\n",
    "3 0 obj\n<< /Length 0 % /Type /Page\n /Note (/Type /Page) >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  assert.throws(() => inspectPdfBytes(Buffer.from(body, "latin1")), /Root is not a Catalog/);
});

test("strict PDF inspection ignores page-tree tokens inside nested dictionary values", () => {
  const objects = [
    "1 0 obj\n<< /Note << /Type /Catalog /Pages 2 0 R >> >>\nendobj\n",
    "2 0 obj\n<< /Note << /Type /Pages /Count 1 /Kids [3 0 R] >> >>\nendobj\n",
    "3 0 obj\n<< /Note << /Type /Page >> >>\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  assert.throws(() => inspectPdfBytes(Buffer.from(body, "latin1")), /Root is not a Catalog/);
});

test("strict PDF inspection accepts opaque literal and hex values before semantic keys", () => {
  const objects = [
    "1 0 obj\n<< /Lang (en-US) /Identifier <656e2d5553> /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Label (Pages) /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Label <50616765> /Type /Page /Parent 2 0 R >>\nendobj\n",
  ];
  let body = "%PDF-1.7\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += object;
  }
  body += `%${"padding".repeat(150)}\n`;
  const xref = Buffer.byteLength(body, "latin1");
  body += "xref\n0 4\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size 4 /ID [(one) <74776f>] /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  assert.deepEqual(inspectPdfBytes(Buffer.from(body, "latin1")), { pages: 1 });
});

function png({ colorType, textByte = 0x61, transparency = false }) {
  const width = 10;
  const height = 10;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colorType;
  const channels = colorType === 6 ? 4 : 1;
  const rows = Buffer.alloc((width * channels + 1) * height);
  const chunks = [
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.alloc(1024, textByte)),
  ];
  if (colorType === 3) {
    // Deliberately omit PLTE for the rejection case.
  }
  if (transparency) chunks.push(chunk("tRNS", Buffer.alloc(2)));
  chunks.push(chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

function filteredRgbaPng(filter) {
  const width = 10;
  const height = 10;
  const bytesPerPixel = 4;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  for (let offset = 0; offset < pixels.length; offset += bytesPerPixel) {
    const pixel = offset / bytesPerPixel;
    pixels[offset] = (pixel * 17) & 0xff;
    pixels[offset + 1] = (pixel * 31) & 0xff;
    pixels[offset + 2] = (pixel * 47) & 0xff;
    pixels[offset + 3] = 255;
  }
  const rowBytes = width * bytesPerPixel;
  const rows = Buffer.alloc((rowBytes + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * rowBytes;
    const targetOffset = row * (rowBytes + 1);
    rows[targetOffset] = filter;
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = pixels[sourceOffset + column];
      const left = column >= bytesPerPixel ? pixels[sourceOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? pixels[sourceOffset + column - rowBytes] : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? pixels[sourceOffset + column - rowBytes - bytesPerPixel]
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upperLeft);
      rows[targetOffset + column + 1] = (raw - predictor) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.alloc(1024, 0x61)),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function rgbaPng(width, height, pixelAt) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const [red, green, blue, alpha] = pixelAt(x, y);
      const offset = row + 1 + x * 4;
      rows[offset] = red;
      rows[offset + 1] = green;
      rows[offset + 2] = blue;
      rows[offset + 3] = alpha;
    }
  }
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.alloc(1024, 0x61)),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
