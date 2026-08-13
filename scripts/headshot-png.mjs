// Monogram headshots as PNG.
//
// They used to be SVG. SVG is a scriptable document, and the security pass made the
// upload and serving path accept only PNG, JPEG, WebP, and GIF, so the seeded
// pictures had to become one of those or stop rendering. No image library: a flat
// tile with two letters is a hand-drawn raster and a zlib stream, both of which Node
// has in the standard library.

import { deflateSync } from "node:zlib";

// 5x7 uppercase glyphs, one string per row, "#" is ink. Enough for initials.
const GLYPHS = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** A flat tile with the initials centred, as an 8-bit RGB PNG. */
export function headshotPng(initials, background, size = 320) {
  const [br, bg, bb] = hexToRgb(background);
  const letters = [...initials.toUpperCase()].slice(0, 2).map((ch) => GLYPHS[ch] ?? null);

  // Glyph geometry: 5x7 cells scaled up, one blank column between the two letters.
  const scale = Math.floor(size / 14);
  const glyphWidth = 5 * scale;
  const glyphHeight = 7 * scale;
  const gap = scale;
  const totalWidth = letters.length * glyphWidth + (letters.length - 1) * gap;
  const originX = Math.round((size - totalWidth) / 2);
  const originY = Math.round((size - glyphHeight) / 2);

  const ink = (x, y) => {
    const gx = x - originX;
    if (gx < 0 || y < originY || y >= originY + glyphHeight) return false;
    const slot = Math.floor(gx / (glyphWidth + gap));
    if (slot < 0 || slot >= letters.length) return false;
    const withinSlot = gx - slot * (glyphWidth + gap);
    if (withinSlot >= glyphWidth) return false;
    const rows = letters[slot];
    if (!rows) return false;
    return rows[Math.floor((y - originY) / scale)][Math.floor(withinSlot / scale)] === "1";
  };

  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const at = rowStart + 1 + x * 3;
      if (ink(x, y)) {
        raw[at] = 255;
        raw[at + 1] = 255;
        raw[at + 2] = 255;
      } else {
        raw[at] = br;
        raw[at + 1] = bg;
        raw[at + 2] = bb;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
