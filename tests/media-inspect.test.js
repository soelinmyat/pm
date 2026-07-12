"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { inspectPdfBytes, inspectPngBytes } = require("../scripts/lib/media-inspect");

test("strict PNG inspection accepts a complete decodable image", () => {
  assert.deepEqual(inspectPngBytes(png({ colorType: 6 })), { width: 10, height: 10 });
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

function png({ colorType }) {
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
    chunk("tEXt", Buffer.alloc(1024, 0x61)),
  ];
  if (colorType === 3) {
    // Deliberately omit PLTE for the rejection case.
  }
  chunks.push(chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(chunks);
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
