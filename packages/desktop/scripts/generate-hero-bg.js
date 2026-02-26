/**
 * One-off: generate hero-gradient-bg.png matching CSS
 * linear-gradient(270deg, #971115 0%, #000 50.06%)
 * 270deg = right to left → left side black, right side red gradient to black.
 * Output: packages/desktop/assets/pdf-template/Planlux-PDF/assets/hero-gradient-bg.png
 */
const fs = require("fs");
const path = require("path");

const W = 794;
const H = 234;
// #971115 = rgb(151, 17, 21), #000 = rgb(0,0,0)
const R1 = 151, G1 = 17, B1 = 21;
const R0 = 0, G0 = 0, B0 = 0;
// 50.06% from right = gradient ends here (left of this = black)
const gradientEndFromRight = 0.5006 * W;
const gradientStartX = Math.floor(W - gradientEndFromRight); // first x that is in gradient (red side)

const outDir = path.join(__dirname, "..", "assets", "pdf-template", "Planlux-PDF", "assets");
const outPath = path.join(outDir, "hero-gradient-bg.png");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// PNG: 8-byte signature + IHDR (13) + IDAT (zlib) + IEND (12). Use minimal raw RGBA then zlib.
const crc32 = (data) => {
  let c = 0xffffffff;
  const table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const writeU32 = (buf, off, val) => {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
};

// Build raw RGBA image
const raw = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let r, g, b;
    if (x < gradientStartX) {
      r = R0; g = G0; b = B0;
    } else {
      const ratio = (x - gradientStartX) / (W - 1 - gradientStartX);
      r = Math.round(R0 + (R1 - R0) * ratio);
      g = Math.round(G0 + (G1 - G0) * ratio);
      b = Math.round(B0 + (B1 - B0) * ratio);
    }
    const i = (y * W + x) * 4;
    raw[i] = r;
    raw[i + 1] = g;
    raw[i + 2] = b;
    raw[i + 3] = 255;
  }
}

// PNG filter: each row prefixed with filter type 0 (None)
const filtered = Buffer.alloc(1 + raw.length);
for (let y = 0; y < H; y++) {
  filtered[y * (1 + W * 4)] = 0;
  raw.copy(filtered, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4);
}

const zlib = require("zlib");
const compressed = zlib.deflateSync(filtered, { level: 9 });

const IHDR = Buffer.alloc(25);
writeU32(IHDR, 0, 13);
IHDR.write("IHDR", 4);
writeU32(IHDR, 8, W);
writeU32(IHDR, 12, H);
IHDR[16] = 8;
IHDR[17] = 6; // color type RGBA
IHDR[18] = 0;
IHDR[19] = 0;
IHDR[20] = 0;

const idatLen = 4 + compressed.length + 4;
const IDAT = Buffer.alloc(4 + 4 + compressed.length + 4);
writeU32(IDAT, 0, compressed.length);
IDAT.write("IDAT", 4);
compressed.copy(IDAT, 8);
writeU32(IDAT, 8 + compressed.length, crc32(IDAT.slice(4, 8 + compressed.length)));

const ihdrData = IHDR.slice(8, 21);
const ihdrChunk = Buffer.concat([
  Buffer.from([0, 0, 0, 13]),
  Buffer.from("IHDR"),
  ihdrData,
  Buffer.alloc(4),
]);
ihdrChunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from("IHDR"), ihdrData])), 21);

const IEND = Buffer.alloc(12);
writeU32(IEND, 0, 0);
IEND.write("IEND", 4);
writeU32(IEND, 8, crc32(Buffer.from("IEND")));

fs.writeFileSync(
  outPath,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdrChunk,
    IDAT,
    IEND,
  ])
);
console.log("Written:", outPath);
console.log("Size:", fs.statSync(outPath).size, "bytes");
