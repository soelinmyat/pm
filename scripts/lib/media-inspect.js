"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const MIN_RENDER_BYTES = 1024;
const MAX_DECODED_BYTES = 128 * 1024 * 1024;
const PRODUCT_UI_VISUAL_THRESHOLDS = Object.freeze({
  minVisiblePixelRatio: 0.01,
  minMeaningfulPixelRatio: 0.01,
  minMeaningfulTileRatio: 0.03,
  minMeaningfulPixelsPerTileRatio: 0.01,
  minLuminanceRange: 16,
  minVisualDistance: 0.005,
  minChangedTileRatio: 0.03,
  minChangedTileDistance: 0.01,
});
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
  const inspected = inspectPngInternal(bytes, false);
  return { width: inspected.width, height: inspected.height };
}

function inspectPngVisualBytes(bytes) {
  return inspectPngInternal(bytes, true);
}

function inspectPngHeaderBytes(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < MIN_RENDER_BYTES ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
  ) {
    throw new Error("invalid PNG capture");
  }
  const length = bytes.readUInt32BE(8);
  const end = 8 + 12 + length;
  const type = bytes.subarray(12, 16).toString("ascii");
  if (length !== 13 || type !== "IHDR" || end > bytes.length) {
    throw new Error("invalid PNG header order");
  }
  const data = bytes.subarray(16, 16 + length);
  if (
    crc32(Buffer.concat([Buffer.from(type, "ascii"), data])) !== bytes.readUInt32BE(16 + length)
  ) {
    throw new Error("invalid PNG IHDR checksum");
  }
  return parseHeader(data);
}

function inspectPngInternal(bytes, includeVisualEvidence) {
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
    } else if (type === "tRNS" && includeVisualEvidence) {
      throw new Error("PNG transparency chunks are unsupported for visual identity");
    } else if (type === "IEND") {
      if (length !== 0 || !sawData || end !== bytes.length)
        throw new Error("invalid PNG end chunk");
      validatePalette(header.colorType, sawPalette);
      const pixelStream = validatePixelStream(header, compressed);
      if (!includeVisualEvidence) return { width: header.width, height: header.height };
      const pixels = decodePixels(header, pixelStream);
      return {
        width: header.width,
        height: header.height,
        bitDepth: header.bitDepth,
        colorType: header.colorType,
        ...visualPixelEvidence(header, pixels),
      };
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

function validatePixelStream(header, compressed) {
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
  return { channels, rowBytes, pixels };
}

function decodePixels(header, pixelStream) {
  const { channels, rowBytes, pixels } = pixelStream;
  const bytesPerPixel = Math.max(1, Math.ceil((channels * header.bitDepth) / 8));
  const decoded = Buffer.alloc(rowBytes * header.height);
  for (let row = 0; row < header.height; row += 1) {
    const filter = pixels[row * (rowBytes + 1)];
    const sourceOffset = row * (rowBytes + 1) + 1;
    const targetOffset = row * rowBytes;
    if (filter === 0) {
      pixels.copy(decoded, targetOffset, sourceOffset, sourceOffset + rowBytes);
      continue;
    }
    for (let column = 0; column < rowBytes; column += 1) {
      const raw = pixels[sourceOffset + column];
      const left = column >= bytesPerPixel ? decoded[targetOffset + column - bytesPerPixel] : 0;
      const up = row > 0 ? decoded[targetOffset + column - rowBytes] : 0;
      const upperLeft =
        row > 0 && column >= bytesPerPixel
          ? decoded[targetOffset + column - rowBytes - bytesPerPixel]
          : 0;
      decoded[targetOffset + column] = unfilteredByte(filter, raw, left, up, upperLeft);
    }
  }
  return decoded;
}

function unfilteredByte(filter, raw, left, up, upperLeft) {
  if (filter === 0) return raw;
  if (filter === 1) return (raw + left) & 0xff;
  if (filter === 2) return (raw + up) & 0xff;
  if (filter === 3) return (raw + Math.floor((left + up) / 2)) & 0xff;
  return (raw + paeth(left, up, upperLeft)) & 0xff;
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function visualPixelEvidence(header, pixels) {
  const totalPixels = header.width * header.height;
  if (header.bitDepth !== 8 || !new Set([0, 2, 4, 6]).has(header.colorType)) {
    return {
      pixelSha256: null,
      visiblePixels: null,
      totalPixels,
      hasVisualVariation: null,
      meaningfulPixelRatio: null,
      meaningfulTileRatio: null,
      colorBucketCount: null,
      luminanceRange: null,
      perceptualGrid: null,
    };
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.colorType];
  const hash = crypto.createHash("sha256");
  hash.update(`rgba8:${header.width}x${header.height}\0`);
  let visibleAlphaUnits = 0;
  let sawVisiblePixel = false;
  let firstVisibleRed = 0;
  let firstVisibleGreen = 0;
  let firstVisibleBlue = 0;
  let firstVisibleAlpha = 0;
  let hasVisualVariation = false;
  const metrics = createVisualMetrics(header.width, header.height);
  if (header.colorType === 6) {
    let canonicalPixels = null;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const pixel = offset / 4;
      const x = pixel % header.width;
      const y = Math.floor(pixel / header.width);
      if (pixels[offset + 3] === 0) {
        if (pixels[offset] !== 0 || pixels[offset + 1] !== 0 || pixels[offset + 2] !== 0) {
          canonicalPixels ||= Buffer.from(pixels);
          canonicalPixels[offset] = 0;
          canonicalPixels[offset + 1] = 0;
          canonicalPixels[offset + 2] = 0;
        }
        metrics.observe(x, y, 0, 0, 0, 0);
        continue;
      }
      const alpha = pixels[offset + 3];
      const opacity = alpha / 255;
      const effectiveRed = alpha === 255 ? pixels[offset] : Math.round(pixels[offset] * opacity);
      const effectiveGreen =
        alpha === 255 ? pixels[offset + 1] : Math.round(pixels[offset + 1] * opacity);
      const effectiveBlue =
        alpha === 255 ? pixels[offset + 2] : Math.round(pixels[offset + 2] * opacity);
      visibleAlphaUnits += alpha;
      if (!sawVisiblePixel) {
        sawVisiblePixel = true;
        firstVisibleRed = effectiveRed;
        firstVisibleGreen = effectiveGreen;
        firstVisibleBlue = effectiveBlue;
        firstVisibleAlpha = alpha;
      } else if (
        effectiveRed !== firstVisibleRed ||
        effectiveGreen !== firstVisibleGreen ||
        effectiveBlue !== firstVisibleBlue ||
        alpha !== firstVisibleAlpha
      )
        hasVisualVariation = true;
      metrics.observe(x, y, effectiveRed, effectiveGreen, effectiveBlue, alpha);
    }
    hash.update(canonicalPixels || pixels);
    return {
      pixelSha256: hash.digest("hex"),
      visiblePixels: visibleAlphaUnits / 255,
      totalPixels,
      hasVisualVariation,
      ...metrics.finish(),
    };
  }
  for (let row = 0; row < header.height; row += 1) {
    const normalized = Buffer.alloc(header.width * 4);
    const rowOffset = row * header.width * channels;
    for (let column = 0; column < header.width; column += 1) {
      const source = rowOffset + column * channels;
      const target = column * 4;
      let red;
      let green;
      let blue;
      let alpha;
      if (header.colorType === 0) {
        red = green = blue = pixels[source];
        alpha = 255;
      } else if (header.colorType === 2) {
        [red, green, blue] = pixels.subarray(source, source + 3);
        alpha = 255;
      } else if (header.colorType === 4) {
        red = green = blue = pixels[source];
        alpha = pixels[source + 1];
      } else {
        [red, green, blue, alpha] = pixels.subarray(source, source + 4);
      }
      normalized[target] = alpha === 0 ? 0 : red;
      normalized[target + 1] = alpha === 0 ? 0 : green;
      normalized[target + 2] = alpha === 0 ? 0 : blue;
      normalized[target + 3] = alpha;
      const opacity = alpha / 255;
      const effectiveRed = alpha === 255 ? red : Math.round(red * opacity);
      const effectiveGreen = alpha === 255 ? green : Math.round(green * opacity);
      const effectiveBlue = alpha === 255 ? blue : Math.round(blue * opacity);
      if (alpha > 0) {
        visibleAlphaUnits += alpha;
        if (!sawVisiblePixel) {
          sawVisiblePixel = true;
          firstVisibleRed = effectiveRed;
          firstVisibleGreen = effectiveGreen;
          firstVisibleBlue = effectiveBlue;
          firstVisibleAlpha = alpha;
        } else if (
          effectiveRed !== firstVisibleRed ||
          effectiveGreen !== firstVisibleGreen ||
          effectiveBlue !== firstVisibleBlue ||
          alpha !== firstVisibleAlpha
        )
          hasVisualVariation = true;
      }
      metrics.observe(column, row, effectiveRed, effectiveGreen, effectiveBlue, alpha);
    }
    hash.update(normalized);
  }
  return {
    pixelSha256: hash.digest("hex"),
    visiblePixels: visibleAlphaUnits / 255,
    totalPixels,
    hasVisualVariation,
    ...metrics.finish(),
  };
}

function createVisualMetrics(width, height) {
  const gridSize = 8;
  const bucketCount = 16 * 16 * 16;
  const buckets = new Float64Array(bucketCount);
  const tileBuckets = new Float64Array(gridSize * gridSize * bucketCount);
  const redSums = new Float64Array(gridSize * gridSize);
  const greenSums = new Float64Array(gridSize * gridSize);
  const blueSums = new Float64Array(gridSize * gridSize);
  const cellCounts = new Uint32Array(gridSize * gridSize);
  const visibleCellCounts = new Float64Array(gridSize * gridSize);
  let minimumLuminance = 255;
  let maximumLuminance = 0;

  function observe(x, y, effectiveRed, effectiveGreen, effectiveBlue, alpha) {
    const cellX = Math.min(gridSize - 1, Math.floor((x * gridSize) / width));
    const cellY = Math.min(gridSize - 1, Math.floor((y * gridSize) / height));
    const cell = cellY * gridSize + cellX;
    redSums[cell] += effectiveRed;
    greenSums[cell] += effectiveGreen;
    blueSums[cell] += effectiveBlue;
    cellCounts[cell] += 1;
    if (alpha === 0) return;
    visibleCellCounts[cell] += alpha;
    const bucket = (effectiveRed >> 4) * 256 + (effectiveGreen >> 4) * 16 + (effectiveBlue >> 4);
    buckets[bucket] += alpha;
    tileBuckets[cell * bucketCount + bucket] += alpha;
    const luminance = Math.round(
      (54 * effectiveRed + 183 * effectiveGreen + 19 * effectiveBlue) / 256
    );
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
  }

  function finish() {
    let dominantBucket = 0;
    let dominantPixels = 0;
    let visiblePixels = 0;
    let colorBucketCount = 0;
    for (let bucket = 0; bucket < buckets.length; bucket += 1) {
      const count = buckets[bucket];
      visiblePixels += count;
      if (count > 0) colorBucketCount += 1;
      if (count > dominantPixels) {
        dominantPixels = count;
        dominantBucket = bucket;
      }
    }
    let meaningfulTiles = 0;
    for (let cell = 0; cell < gridSize * gridSize; cell += 1) {
      const dominantInCell = tileBuckets[cell * bucketCount + dominantBucket];
      const nonDominantInCell = visibleCellCounts[cell] - dominantInCell;
      if (
        visibleCellCounts[cell] > 0 &&
        nonDominantInCell / visibleCellCounts[cell] >=
          PRODUCT_UI_VISUAL_THRESHOLDS.minMeaningfulPixelsPerTileRatio
      )
        meaningfulTiles += 1;
    }
    const perceptual = Buffer.alloc(gridSize * gridSize * 3);
    for (let cell = 0; cell < gridSize * gridSize; cell += 1) {
      const count = cellCounts[cell] || 1;
      perceptual[cell * 3] = Math.round(redSums[cell] / count);
      perceptual[cell * 3 + 1] = Math.round(greenSums[cell] / count);
      perceptual[cell * 3 + 2] = Math.round(blueSums[cell] / count);
    }
    return {
      meaningfulPixelRatio:
        visiblePixels === 0 ? 0 : (visiblePixels - dominantPixels) / visiblePixels,
      meaningfulTileRatio: meaningfulTiles / (gridSize * gridSize),
      colorBucketCount,
      luminanceRange: visiblePixels === 0 ? 0 : maximumLuminance - minimumLuminance,
      perceptualGrid: perceptual.toString("base64"),
    };
  }

  return { observe, finish };
}

function visualDistance(left, right) {
  return visualDifference(left, right)?.distance ?? null;
}

function visualDifference(left, right) {
  if (typeof left?.perceptualGrid !== "string" || typeof right?.perceptualGrid !== "string")
    return null;
  const leftGrid = Buffer.from(left.perceptualGrid, "base64");
  const rightGrid = Buffer.from(right.perceptualGrid, "base64");
  if (leftGrid.length !== 192 || rightGrid.length !== leftGrid.length) return null;
  let difference = 0;
  let changedTiles = 0;
  for (let index = 0; index < leftGrid.length; index += 3) {
    let tileDifference = 0;
    for (let channel = 0; channel < 3; channel += 1)
      tileDifference += Math.abs(leftGrid[index + channel] - rightGrid[index + channel]);
    difference += tileDifference;
    if (tileDifference / (3 * 255) >= PRODUCT_UI_VISUAL_THRESHOLDS.minChangedTileDistance)
      changedTiles += 1;
  }
  return {
    distance: difference / (leftGrid.length * 255),
    changedTileRatio: changedTiles / (leftGrid.length / 3),
  };
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

module.exports = {
  PRODUCT_UI_VISUAL_THRESHOLDS,
  inspectPdf,
  inspectPdfBytes,
  inspectPng,
  inspectPngBytes,
  inspectPngHeaderBytes,
  inspectPngVisualBytes,
  visualDifference,
  visualDistance,
};
