"use strict";

const fs = require("node:fs");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MIN_RENDER_BYTES = 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const PDF_TOKEN = new RegExp(String.raw`^[^\s<>\[\]()%/]+`);
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
  const trailerDictionary = directDictionary(extractDictionary(trailer, 0, "trailer"), "trailer");
  const rootRef = referenceValue(trailerDictionary.get("Root"));
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
  const root = directDictionary(
    objectDictionary(resolveObject(objects, rootRef.object, rootRef.generation, "Root"), "Root"),
    "Root"
  );
  if (nameValue(root.get("Type")) !== "Catalog") throw new Error("PDF Root is not a Catalog");
  const pagesRef = referenceValue(root.get("Pages"));
  if (!pagesRef) throw new Error("PDF Catalog Pages is required");
  const visited = new Set();
  const pages = walkPages(objects, pagesRef.object, pagesRef.generation, visited);
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
  const source = directDictionary(
    objectDictionary(resolveObject(objects, object, generation, "Pages"), "Pages"),
    "Pages"
  );
  if (nameValue(source.get("Type")) === "Page") return 1;
  if (nameValue(source.get("Type")) !== "Pages") throw new Error("PDF page tree node is invalid");
  const count = integerValue(source.get("Count"));
  const refs = referenceArrayValue(source.get("Kids"));
  if (!Number.isInteger(count) || !refs) throw new Error("PDF Pages node lacks Count or Kids");
  const actual = refs.reduce(
    (sum, ref) => sum + walkPages(objects, ref.object, ref.generation, visited),
    0
  );
  if (actual !== count) throw new Error("PDF page tree Count does not match Kids");
  return actual;
}

function directDictionary(dictionary, label) {
  const tokens = dictionaryTokens(dictionary);
  if (tokens[0]?.type !== "dict-start" || tokens.at(-1)?.type !== "dict-end")
    throw new Error(`PDF ${label} dictionary tokens are invalid`);
  const entries = new Map();
  let cursor = 1;
  while (cursor < tokens.length - 1) {
    const key = tokens[cursor];
    if (key.type !== "name") throw new Error(`PDF ${label} dictionary key is invalid`);
    if (entries.has(key.value)) throw new Error(`PDF ${label} dictionary key is duplicated`);
    const consumed = consumeDictionaryValue(tokens, cursor + 1, label);
    entries.set(key.value, consumed.value);
    cursor = consumed.next;
  }
  return entries;
}

function dictionaryTokens(source) {
  const tokens = [];
  let cursor = 0;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    const pair = source.slice(cursor, cursor + 2);
    if (pair === "<<" || pair === ">>") {
      tokens.push({ type: pair === "<<" ? "dict-start" : "dict-end", value: pair });
      cursor += 2;
      continue;
    }
    if (source[cursor] === "[" || source[cursor] === "]") {
      tokens.push({
        type: source[cursor] === "[" ? "array-start" : "array-end",
        value: source[cursor],
      });
      cursor += 1;
      continue;
    }
    if (source[cursor] === "/") {
      const match = source.slice(cursor + 1).match(PDF_TOKEN);
      if (!match) throw new Error("PDF dictionary name is invalid");
      tokens.push({ type: "name", value: match[0] });
      cursor += match[0].length + 1;
      continue;
    }
    const match = source.slice(cursor).match(PDF_TOKEN);
    if (!match) {
      cursor += 1;
      continue;
    }
    tokens.push({ type: /^\d+$/.test(match[0]) ? "integer" : "word", value: match[0] });
    cursor += match[0].length;
  }
  return tokens;
}

function consumeDictionaryValue(tokens, cursor, label) {
  const first = tokens[cursor];
  if (!first) throw new Error(`PDF ${label} dictionary value is missing`);
  if (first.type === "dict-start" || first.type === "array-start") {
    const opening = first.type;
    const closing = opening === "dict-start" ? "dict-end" : "array-end";
    let depth = 0;
    for (let index = cursor; index < tokens.length; index += 1) {
      if (tokens[index].type === opening) depth += 1;
      if (tokens[index].type === closing) depth -= 1;
      if (depth === 0) return { value: tokens.slice(cursor, index + 1), next: index + 1 };
    }
    throw new Error(`PDF ${label} nested value is unterminated`);
  }
  if (
    first.type === "integer" &&
    tokens[cursor + 1]?.type === "integer" &&
    tokens[cursor + 2]?.type === "word" &&
    tokens[cursor + 2].value === "R"
  )
    return { value: tokens.slice(cursor, cursor + 3), next: cursor + 3 };
  return { value: [first], next: cursor + 1 };
}

function nameValue(tokens) {
  return tokens?.length === 1 && tokens[0].type === "name" ? tokens[0].value : null;
}

function integerValue(tokens) {
  if (tokens?.length !== 1 || tokens[0].type !== "integer") return null;
  const value = Number(tokens[0].value);
  return Number.isSafeInteger(value) ? value : null;
}

function referenceValue(tokens) {
  if (
    tokens?.length !== 3 ||
    tokens[0].type !== "integer" ||
    tokens[1].type !== "integer" ||
    tokens[2].type !== "word" ||
    tokens[2].value !== "R"
  )
    return null;
  return { object: tokens[0].value, generation: tokens[1].value };
}

function referenceArrayValue(tokens) {
  if (tokens?.[0]?.type !== "array-start" || tokens.at(-1)?.type !== "array-end") return null;
  const refs = [];
  for (let cursor = 1; cursor < tokens.length - 1; cursor += 3) {
    const ref = referenceValue(tokens.slice(cursor, cursor + 3));
    if (!ref) return null;
    refs.push(ref);
  }
  return refs.length > 0 ? refs : null;
}

function objectDictionary(source, label) {
  const objectStart = source.match(/^\d+\s+\d+\s+obj\b/)?.[0].length;
  if (!objectStart) throw new Error(`PDF ${label} object header is invalid`);
  return extractDictionary(source, objectStart, `${label} object`);
}

function extractDictionary(source, start, label) {
  let cursor = skipPdfSpaceAndComments(source, start);
  if (!source.startsWith("<<", cursor)) throw new Error(`PDF ${label} dictionary is required`);
  const begin = cursor;
  let depth = 0;
  let literalDepth = 0;
  let escaped = false;
  let hexString = false;
  while (cursor < source.length) {
    const char = source[cursor];
    const next = source[cursor + 1];
    if (literalDepth > 0) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "(") literalDepth += 1;
      else if (char === ")") literalDepth -= 1;
      cursor += 1;
      continue;
    }
    if (hexString) {
      if (char === ">") hexString = false;
      cursor += 1;
      continue;
    }
    if (char === "%") {
      const lineEnd = source.indexOf("\n", cursor + 1);
      cursor = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }
    if (char === "(") {
      literalDepth = 1;
      cursor += 1;
      continue;
    }
    if (char === "<" && next !== "<") {
      hexString = true;
      cursor += 1;
      continue;
    }
    if (char === "<" && next === "<") {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (char === ">" && next === ">") {
      depth -= 1;
      cursor += 2;
      if (depth === 0) return sanitizeDictionary(source.slice(begin, cursor));
      if (depth < 0) break;
      continue;
    }
    cursor += 1;
  }
  throw new Error(`PDF ${label} dictionary is unterminated`);
}

function sanitizeDictionary(dictionary) {
  const output = [...dictionary];
  let literalDepth = 0;
  let escaped = false;
  let hexString = false;
  let comment = false;
  for (let index = 0; index < dictionary.length; index += 1) {
    const char = dictionary[index];
    const next = dictionary[index + 1];
    if (comment) {
      if (char === "\n" || char === "\r") comment = false;
      else output[index] = " ";
      continue;
    }
    if (literalDepth > 0) {
      output[index] = " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "(") literalDepth += 1;
      else if (char === ")") literalDepth -= 1;
      continue;
    }
    if (hexString) {
      output[index] = " ";
      if (char === ">") hexString = false;
      continue;
    }
    if (char === "%") {
      output[index] = " ";
      comment = true;
    } else if (char === "(") {
      output[index] = "S";
      literalDepth = 1;
    } else if ((char === "<" && next === "<") || (char === ">" && next === ">")) {
      index += 1;
    } else if (char === "<" && next !== "<") {
      output[index] = "S";
      hexString = true;
    }
  }
  return output.join("");
}

function skipPdfSpaceAndComments(source, start) {
  let cursor = start;
  while (cursor < source.length) {
    if (/\s/.test(source[cursor])) {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "%") {
      const lineEnd = source.indexOf("\n", cursor + 1);
      cursor = lineEnd < 0 ? source.length : lineEnd + 1;
      continue;
    }
    break;
  }
  return cursor;
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
