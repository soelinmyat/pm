"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MIN_RENDER_BYTES = 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const VALID_DEPTHS = Object.freeze({
  0: new Set([1, 2, 4, 8, 16]),
  2: new Set([8, 16]),
  3: new Set([1, 2, 4, 8]),
  4: new Set([8, 16]),
  6: new Set([8, 16]),
});

function inspectPng(filePath) {
  return inspectPngBytes(readRegularFile(filePath, "PNG"));
}

function inspectPngBytes(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < MIN_RENDER_BYTES ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  )
    throw new Error("invalid PNG capture");
  let offset = 8;
  let header;
  let sawPalette = false;
  let sawData = false;
  let dataEnded = false;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error("invalid PNG chunk length");
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (
      crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) !==
      bytes.readUInt32BE(offset + 8 + length)
    )
      throw new Error(`invalid PNG ${type} checksum`);
    if (type === "IHDR") {
      if (header || length !== 13 || offset !== 8) throw new Error("invalid PNG header order");
      header = parseHeader(data);
    } else if (!header) throw new Error("PNG IHDR must be first");
    else if (type === "PLTE") {
      if (sawData || sawPalette || length === 0 || length % 3 !== 0 || length > 768)
        throw new Error("invalid PNG palette");
      sawPalette = true;
    } else if (type === "IDAT") {
      if (dataEnded) throw new Error("PNG IDAT chunks must be consecutive");
      sawData = true;
      compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.length)
        throw new Error("invalid PNG end chunk");
      validatePalette(header.colorType, sawPalette);
      validatePixels(header, compressed);
      return { width: header.width, height: header.height };
    } else if (sawData) dataEnded = true;
    offset = end;
  }
  throw new Error("PNG must contain IHDR, IDAT, and terminal IEND chunks");
}

function parseHeader(data) {
  const width = data.readUInt32BE(0);
  const height = data.readUInt32BE(4);
  const bitDepth = data[8];
  const colorType = data[9];
  if (
    !Number.isInteger(width) ||
    width < 1 ||
    !Number.isInteger(height) ||
    height < 1 ||
    !VALID_DEPTHS[colorType]?.has(bitDepth) ||
    data[10] !== 0 ||
    data[11] !== 0 ||
    data[12] !== 0
  )
    throw new Error("invalid or unsupported PNG header");
  return { width, height, bitDepth, colorType };
}

function validatePalette(colorType, sawPalette) {
  if (colorType === 3 && !sawPalette) throw new Error("indexed PNG requires a palette");
  if ([0, 4].includes(colorType) && sawPalette) throw new Error("grayscale PNG forbids a palette");
}

function validatePixels(header, compressed) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  const rowBytes = Math.ceil((header.width * channels * header.bitDepth) / 8);
  const expected = (rowBytes + 1) * header.height;
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > MAX_DECODED_BYTES)
    throw new Error("PNG decoded pixel budget exceeded");
  let pixels;
  try {
    pixels = zlib.inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  } catch (error) {
    throw new Error(`invalid PNG pixel stream: ${error.message}`);
  }
  if (pixels.length !== expected) throw new Error("invalid PNG pixel length");
  for (let row = 0; row < header.height; row += 1)
    if (pixels[row * (rowBytes + 1)] > 4) throw new Error("invalid PNG row filter");
}

function inspectPdf(filePath) {
  return inspectPdfBytes(readRegularFile(filePath, "PDF"));
}

function inspectPdfBytes(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < MIN_RENDER_BYTES ||
    !/^%PDF-1\.[0-7]/.test(bytes.subarray(0, 8).toString("ascii"))
  )
    throw new Error("invalid PDF header");
  const text = bytes.toString("latin1");
  if (!/%%EOF\s*$/.test(text)) throw new Error("invalid PDF end marker");
  const startMatches = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/g)];
  if (startMatches.length === 0) throw new Error("PDF startxref is required");
  const xrefOffset = Number(startMatches.at(-1)[1]);
  if (!Number.isSafeInteger(xrefOffset) || text.slice(xrefOffset, xrefOffset + 4) !== "xref")
    throw new Error("invalid PDF xref offset");
  const { entries, trailer } = parseXref(text, xrefOffset);
  const rootRef = trailer.match(/\/Root\s+(\d+)\s+(\d+)\s+R/);
  if (!rootRef) throw new Error("PDF trailer Root is required");
  const objects = new Map();
  for (const entry of entries.filter((item) => item.inUse)) {
    const source = text.slice(entry.offset);
    const prefix = new RegExp(`^${entry.object}\\s+${entry.generation}\\s+obj\\b`);
    if (!prefix.test(source)) throw new Error(`PDF xref entry ${entry.object} is invalid`);
    const end = source.indexOf("endobj");
    if (end < 0) throw new Error(`PDF object ${entry.object} is unterminated`);
    objects.set(`${entry.object}:${entry.generation}`, source.slice(0, end + 6));
  }
  const root = resolveObject(objects, rootRef[1], rootRef[2], "Root");
  if (!/\/Type\s*\/Catalog\b/.test(root)) throw new Error("PDF Root is not a Catalog");
  const pagesRef = root.match(/\/Pages\s+(\d+)\s+(\d+)\s+R/);
  if (!pagesRef) throw new Error("PDF Catalog Pages is required");
  const visited = new Set();
  const pages = walkPages(objects, pagesRef[1], pagesRef[2], visited);
  if (pages < 1) throw new Error("PDF must contain at least one page");
  return { pages };
}

function parseXref(text, offset) {
  let cursor = offset + 4;
  const entries = [];
  while (true) {
    cursor = skipSpace(text, cursor);
    if (text.startsWith("trailer", cursor)) break;
    const header = text.slice(cursor).match(/^(\d+)\s+(\d+)\s*/);
    if (!header) throw new Error("invalid PDF xref subsection");
    const start = Number(header[1]);
    const count = Number(header[2]);
    cursor += header[0].length;
    for (let index = 0; index < count; index += 1) {
      const line = text.slice(cursor).match(/^(\d{10})\s(\d{5})\s([nf])\s*(?:\r?\n|\r)/);
      if (!line) throw new Error("invalid PDF xref entry");
      entries.push({
        object: start + index,
        offset: Number(line[1]),
        generation: Number(line[2]),
        inUse: line[3] === "n",
      });
      cursor += line[0].length;
    }
  }
  const trailerStart = cursor + "trailer".length;
  const trailerEnd = text.indexOf("startxref", trailerStart);
  if (trailerEnd < 0) throw new Error("invalid PDF trailer");
  return { entries, trailer: text.slice(trailerStart, trailerEnd) };
}

function walkPages(objects, object, generation, visited) {
  const key = `${object}:${generation}`;
  if (visited.has(key)) throw new Error("PDF page tree cycle");
  visited.add(key);
  const source = resolveObject(objects, object, generation, "Pages");
  if (/\/Type\s*\/Page\b/.test(source)) return 1;
  if (!/\/Type\s*\/Pages\b/.test(source)) throw new Error("PDF page tree node is invalid");
  const count = Number(source.match(/\/Count\s+(\d+)/)?.[1]);
  const kidsBody = source.match(/\/Kids\s*\[([\s\S]*?)\]/)?.[1];
  if (!Number.isInteger(count) || !kidsBody) throw new Error("PDF Pages node lacks Count or Kids");
  const refs = [...kidsBody.matchAll(/(\d+)\s+(\d+)\s+R/g)];
  const actual = refs.reduce((sum, ref) => sum + walkPages(objects, ref[1], ref[2], visited), 0);
  if (actual !== count) throw new Error("PDF page tree Count does not match Kids");
  return actual;
}

function resolveObject(objects, object, generation, label) {
  const value = objects.get(`${object}:${generation}`);
  if (!value) throw new Error(`PDF ${label} reference cannot be resolved`);
  return value;
}

function skipSpace(text, cursor) {
  while (/\s/.test(text[cursor] || "")) cursor += 1;
  return cursor;
}

function readRegularFile(filePath, kind) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch {
    throw new Error(`browser did not create a fresh ${kind} capture: ${filePath}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${kind} capture is not a regular file`);
  return fs.readFileSync(filePath);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = { inspectPdf, inspectPdfBytes, inspectPng, inspectPngBytes };
