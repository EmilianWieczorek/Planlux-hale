/**
 * Creates a multi-resolution Windows ICO (16, 24, 32, 48, 64, 128, 256) at assets/icon.ico and build/icon.ico.
 * Single source of truth: packages/desktop/assets/icon.ico. Run: node scripts/create-icon.js (from packages/desktop)
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const buildDir = path.join(__dirname, "..", "build");
const assetsDir = path.join(__dirname, "..", "assets");

// CRC32 for PNG
let crcTable;
function buildCrc32Table() {
  crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[n] = c >>> 0;
  }
}
function crc32(buf, start, len) {
  if (!crcTable) buildCrc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < len; i++) c = crcTable[(c ^ buf[start + i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function writeU32BE(buf, off, val) {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}
function pngChunk(type, data) {
  const len = data ? data.length : 0;
  const buf = Buffer.alloc(12 + len);
  writeU32BE(buf, 0, len);
  buf.write(type, 4);
  if (data) data.copy(buf, 8);
  writeU32BE(buf, 8 + len, crc32(buf, 4, 4 + len));
  return buf;
}

// Planlux blue #4a90e2 (R,G,B)
const R = 0x4a, G = 0x90, B = 0xe2;

/** Build a BMP-style image for ICO (size x size, 32bpp) + AND mask. Returns Buffer. */
function bmpForSize(size) {
  const dibSize = 40;
  const rowBytes = size * 4;
  const pixSize = rowBytes * size;
  const maskRow = Math.ceil(size / 32) * 4;
  const maskSize = maskRow * size;
  const total = dibSize + pixSize + maskSize;
  const buf = Buffer.alloc(total);
  let off = 0;
  buf.writeUInt32LE(40, off); off += 4;
  buf.writeInt32LE(size, off); off += 4;
  buf.writeInt32LE(size * 2, off); off += 4; // height = 2*size for XOR+AND
  buf.writeUInt16LE(1, off); off += 2;
  buf.writeUInt16LE(32, off); off += 2;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  buf.writeUInt32LE(0, off); off += 4;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      buf[off++] = B;
      buf[off++] = G;
      buf[off++] = R;
      buf[off++] = 0xff;
    }
  }
  for (let i = 0; i < maskSize; i++) buf[off++] = 0;
  return buf;
}

/** Build 256x256 PNG for ICO (embedded). */
function png256() {
  const w = 256, h = 256;
  const rawRows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    row[0] = 0;
    for (let x = 0; x < w; x++) {
      const i = 1 + x * 4;
      row[i] = R;
      row[i + 1] = G;
      row[i + 2] = B;
      row[i + 3] = 0xff;
    }
    rawRows.push(row);
  }
  const compressed = zlib.deflateSync(Buffer.concat(rawRows), { level: 9 });
  const ihdr = Buffer.alloc(13);
  writeU32BE(ihdr, 0, w);
  writeU32BE(ihdr, 4, h);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", null),
  ]);
}

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const bmps = SIZES.filter((s) => s <= 128).map((s) => ({ w: s, h: s, data: bmpForSize(s) }));
const png = png256();
const allEntries = [...bmps, { w: 0, h: 0, data: png }];

let offset = 6 + allEntries.length * 16;
const entries = [];
allEntries.forEach(({ w, h, data }) => {
  entries.push({ w, h, size: data.length, offset });
  offset += data.length;
});

const header = Buffer.alloc(6);
header[0] = 0;
header[1] = 0;
header[2] = 1;
header[3] = 0;
header[4] = entries.length;
header[5] = 0;

const dirEntries = Buffer.alloc(16 * entries.length);
entries.forEach((e, i) => {
  const o = i * 16;
  dirEntries[o] = e.w;
  dirEntries[o + 1] = e.h;
  dirEntries[o + 2] = 0;
  dirEntries[o + 3] = 0;
  dirEntries.writeUInt16LE(0, o + 4);
  dirEntries.writeUInt16LE(e.w === 0 ? 0 : 32, o + 6);
  dirEntries.writeUInt32LE(e.size, o + 8);
  dirEntries.writeUInt32LE(e.offset, o + 12);
});

const icoBuffer = Buffer.concat([
  header,
  dirEntries,
  ...allEntries.map((e) => e.data),
]);

if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });
if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
const buildFile = path.join(buildDir, "icon.ico");
const assetsFile = path.join(assetsDir, "icon.ico");
fs.writeFileSync(assetsFile, icoBuffer);
fs.writeFileSync(buildFile, icoBuffer);
console.log("Created", assetsFile, "and", buildFile, "(multi-resolution ICO: " + SIZES.join(", ") + ")");
