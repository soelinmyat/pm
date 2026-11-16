"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseVdsoMapping,
  vdsoImageDigest,
  sharedObjectIdentities,
} = require("../scripts/lib/verification-runtime");

function fixture(arch = "x64", start = 0x10000n) {
  const size = 4096;
  const maps = `${start.toString(16)}-${(start + BigInt(size)).toString(16)} r-xp 00000000 00:00 0 [vdso]\n`;
  const auxiliary = Buffer.alloc(32);
  auxiliary.writeBigUInt64LE(33n, 0);
  auxiliary.writeBigUInt64LE(start, 8);
  const image = Buffer.alloc(size);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]).copy(image);
  image.writeUInt16LE(3, 16);
  image.writeUInt16LE(arch === "arm64" ? 183 : 62, 18);
  return { maps, auxiliary, image, arch };
}

for (const arch of ["x64", "arm64"]) {
  test(`VDSO ${arch} identity uses actual image bytes and tolerates address randomization`, () => {
    const first = fixture(arch),
      second = fixture(arch, 0x20000n);
    const a = parseVdsoMapping(first.maps, first.auxiliary, arch);
    const b = parseVdsoMapping(second.maps, second.auxiliary, arch);
    assert.notEqual(a.start, b.start);
    assert.equal(vdsoImageDigest(first.image, a), vdsoImageDigest(second.image, b));
    second.image[128] = 1;
    assert.notEqual(vdsoImageDigest(first.image, a), vdsoImageDigest(second.image, b));
  });
}

for (const mutation of [
  "unsupported architecture",
  "missing",
  "duplicate",
  "writable",
  "offset",
  "device",
  "inode",
  "file alias",
  "zero",
  "oversized",
  "unsafe address",
  "wrong address",
  "duplicate address",
  "truncated vector",
  "unterminated vector",
  "trailing vector",
  "oversized vector",
  "oversized maps",
]) {
  test(`VDSO mapping rejects ${mutation}`, () => {
    const f = fixture();
    if (mutation === "unsupported architecture") f.arch = "ia32";
    if (mutation === "missing") f.maps = "";
    if (mutation === "duplicate") f.maps += f.maps;
    if (mutation === "writable") f.maps = f.maps.replace("r-xp", "rwxp");
    if (mutation === "offset") f.maps = f.maps.replace("00000000", "00001000");
    if (mutation === "device") f.maps = f.maps.replace("00:00", "01:01");
    if (mutation === "inode") f.maps = f.maps.replace("00:00 0", "00:00 123");
    if (mutation === "file alias") f.maps = f.maps.replace("[vdso]", "/tmp/[vdso]");
    if (mutation === "zero") f.maps = f.maps.replace("10000-11000", "10000-10000");
    if (mutation === "oversized") f.maps = f.maps.replace("10000-11000", "10000-210000");
    if (mutation === "unsafe address")
      f.maps = f.maps.replace("10000-11000", "1000000000000000-1000000000001000");
    if (mutation === "wrong address") f.auxiliary.writeBigUInt64LE(0x20000n, 8);
    if (mutation === "duplicate address")
      f.auxiliary = Buffer.concat([f.auxiliary.subarray(0, 16), f.auxiliary]);
    if (mutation === "truncated vector") f.auxiliary = f.auxiliary.subarray(0, 31);
    if (mutation === "unterminated vector") f.auxiliary = f.auxiliary.subarray(0, 16);
    if (mutation === "trailing vector") f.auxiliary = Buffer.concat([f.auxiliary, f.auxiliary]);
    if (mutation === "oversized vector") f.auxiliary = Buffer.alloc(16384 + 16);
    if (mutation === "oversized maps") f.maps += " ".repeat(1024 * 1024);
    assert.throws(() => parseVdsoMapping(f.maps, f.auxiliary, f.arch));
  });
}

for (const mutation of [
  "truncation",
  "oversize",
  "magic",
  "class",
  "endianness",
  "version",
  "type",
  "machine",
]) {
  test(`VDSO image rejects ${mutation}`, () => {
    const f = fixture(),
      mapping = parseVdsoMapping(f.maps, f.auxiliary, f.arch);
    if (mutation === "truncation") f.image = f.image.subarray(0, 63);
    if (mutation === "oversize") f.image = Buffer.alloc(1024 * 1024 + 1);
    if (mutation === "magic") f.image[0] = 0;
    if (mutation === "class") f.image[4] = 1;
    if (mutation === "endianness") f.image[5] = 2;
    if (mutation === "version") f.image[6] = 0;
    if (mutation === "type") f.image.writeUInt16LE(2, 16);
    if (mutation === "machine") f.image.writeUInt16LE(183, 18);
    assert.throws(() => vdsoImageDigest(f.image, mapping));
  });
}

for (const names of [
  null,
  ["relative-module.so"],
  ["/missing", "/missing"],
  [1],
  Array(513).fill("/module"),
  ["x".repeat(4097)],
]) {
  test(`unknown runtime inventory fails closed: ${typeof names}/${names?.length}`, () => {
    assert.throws(() => sharedObjectIdentities({ sharedObjects: names }));
  });
}
test("a virtual library label alone cannot grant observation or be silently omitted", () => {
  assert.throws(() =>
    sharedObjectIdentities({
      header: { glibcVersionRuntime: "2.41" },
      sharedObjects: ["linux-vdso.so.1"],
    })
  );
});

const fs = require("node:fs");
const nativeReport = process.report.getReport();
const hasKernelVdso =
  process.platform === "linux" &&
  nativeReport.header.glibcVersionRuntime &&
  nativeReport.sharedObjects.includes("linux-vdso.so.1");
for (const fault of ["denied", "truncated", "changed image", "changed mapping"]) {
  test(
    `actual Linux kernel observation fails closed on ${fault}`,
    { skip: !hasKernelVdso },
    (t) => {
      const open = fs.openSync,
        read = fs.readSync;
      const files = new Map();
      let mapOpens = 0,
        memoryReads = 0,
        injected = false,
        syntheticOffset = 0;
      const changedMaps = Buffer.from(
        fs
          .readFileSync("/proc/self/maps", "utf8")
          .replace(/^.*r-xp.*\[vdso\]$/m, (line) => line.replace("r-xp", "rwxp"))
      );
      t.mock.method(fs, "openSync", (...args) => {
        if (args[0] === "/proc/self/mem" && fault === "denied") {
          injected = true;
          throw new Error("kernel-read-denied");
        }
        const fd = open(...args);
        files.set(fd, args[0]);
        if (args[0] === "/proc/self/maps") mapOpens++;
        return fd;
      });
      t.mock.method(fs, "readSync", (...args) => {
        const [fd, buffer, offset, length] = args;
        if (files.get(fd) === "/proc/self/mem") {
          memoryReads++;
          if (fault === "truncated") {
            injected = true;
            return 0;
          }
          const count = read(...args);
          if (fault === "changed image" && memoryReads > 1 && count > 0) {
            injected = true;
            buffer[offset] ^= 1;
          }
          return count;
        }
        if (files.get(fd) === "/proc/self/maps" && fault === "changed mapping" && mapOpens > 1) {
          injected = true;
          const count = Math.min(length, changedMaps.length - syntheticOffset);
          changedMaps.copy(buffer, offset, syntheticOffset, syntheticOffset + count);
          syntheticOffset += count;
          return count;
        }
        return read(...args);
      });
      assert.throws(
        () => sharedObjectIdentities(nativeReport),
        /kernel-read-denied|truncated VDSO|changed during observation|unknown VDSO mapping/
      );
      assert.equal(injected, true);
    }
  );
}
