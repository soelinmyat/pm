"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const VDSO = "linux-vdso.so.1";
const MAP_LIMIT = 1024 * 1024;
const AUX_LIMIT = 16 * 1024;
const IMAGE_LIMIT = 1024 * 1024;
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");

function readKernelInput(file, limit) {
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = fs.readSync(fd, buffer, offset, buffer.length - offset, null);
      if (count === 0) break;
      offset += count;
    }
    if (offset > limit) throw new Error("kernel observation exceeds budget");
    return buffer.subarray(0, offset);
  } finally {
    fs.closeSync(fd);
  }
}

// Linux ELF64 AT_SYSINFO_EHDR (33) identifies the kernel-provided VDSO.
// Require the auxiliary vector and the unique read-only executable mapping to
// agree; never interpret a reported relative library name as a filesystem path.
function parseVdsoMapping(maps, auxiliary, arch) {
  if (
    !["x64", "arm64"].includes(arch) ||
    typeof maps !== "string" ||
    Buffer.byteLength(maps) > MAP_LIMIT ||
    !Buffer.isBuffer(auxiliary) ||
    auxiliary.length > AUX_LIMIT ||
    auxiliary.length % 16 !== 0
  )
    throw new Error("unsupported kernel observation");
  const lines = maps.split("\n").filter((line) => line.includes("[vdso]"));
  const match =
    lines.length === 1 &&
    /^([a-f0-9]+)-([a-f0-9]+)\s+r-xp\s+0+\s+00:00\s+0\s+\[vdso\]$/.exec(lines[0]);
  if (!match) throw new Error("unknown VDSO mapping");
  const start = BigInt(`0x${match[1]}`),
    end = BigInt(`0x${match[2]}`);
  const size = end - start;
  if (
    start < 1n ||
    end > BigInt(Number.MAX_SAFE_INTEGER) ||
    size < 64n ||
    size > BigInt(IMAGE_LIMIT)
  )
    throw new Error("VDSO mapping exceeds budget");
  const addresses = [];
  let terminated = false;
  for (let offset = 0; offset < auxiliary.length; offset += 16) {
    const type = auxiliary.readBigUInt64LE(offset),
      value = auxiliary.readBigUInt64LE(offset + 8);
    if (type === 0n) {
      terminated = value === 0n && offset + 16 === auxiliary.length;
      break;
    }
    if (type === 33n) addresses.push(value);
  }
  if (!terminated || addresses.length !== 1 || addresses[0] !== start)
    throw new Error("kernel VDSO address disagrees with mapping");
  return { start: Number(start), size: Number(size), line: lines[0], arch };
}

function vdsoImageDigest(bytes, mapping) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length !== mapping.size ||
    bytes.length < 64 ||
    bytes.length > IMAGE_LIMIT ||
    bytes.subarray(0, 4).toString("hex") !== "7f454c46" ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    bytes[6] !== 1 ||
    bytes.readUInt16LE(16) !== 3 ||
    bytes.readUInt16LE(18) !== { x64: 62, arm64: 183 }[mapping.arch]
  )
    throw new Error("unknown VDSO ELF image");
  return hash(bytes);
}

function observeVdso(report) {
  if (
    process.platform !== "linux" ||
    os.endianness() !== "LE" ||
    !/^\d+\.\d+(?:\.\d+)?$/.test(report.header?.glibcVersionRuntime || "") ||
    report.sharedObjects.filter((name) => name === VDSO).length !== 1 ||
    !report.sharedObjects.some(
      (name) => path.isAbsolute(name) && path.basename(name) === "libc.so.6"
    )
  )
    throw new Error("unknown virtual shared object");
  const observe = () =>
    parseVdsoMapping(
      readKernelInput("/proc/self/maps", MAP_LIMIT).toString("utf8"),
      readKernelInput("/proc/self/auxv", AUX_LIMIT),
      process.arch
    );
  const before = observe();
  const fd = fs.openSync("/proc/self/mem", "r");
  let image;
  try {
    const read = () => {
      const bytes = Buffer.alloc(before.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(fd, bytes, offset, bytes.length - offset, before.start + offset);
        if (count === 0) throw new Error("truncated VDSO image");
        offset += count;
      }
      return bytes;
    };
    image = read();
    if (!image.equals(read())) throw new Error("VDSO changed during observation");
  } finally {
    fs.closeSync(fd);
  }
  if (observe().line !== before.line) throw new Error("VDSO mapping changed during observation");
  return vdsoImageDigest(image, before);
}

function sharedObjectIdentities(report) {
  const names = report?.sharedObjects;
  if (
    !Array.isArray(names) ||
    names.length > 512 ||
    new Set(names).size !== names.length ||
    names.some((name) => typeof name !== "string" || !name || name.length > 4096)
  )
    throw new Error("unknown shared-object inventory");
  return [...names].sort().map((file) => {
    if (file === VDSO) return [file, observeVdso(report)];
    if (!path.isAbsolute(file)) throw new Error("unknown shared-object path");
    return [file, hash(fs.readFileSync(file))];
  });
}

module.exports = { sharedObjectIdentities, parseVdsoMapping, vdsoImageDigest };
