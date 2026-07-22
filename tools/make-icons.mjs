import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "extension", "icons");

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

const MARK = [79, 107, 237];
const LIVE = [47, 158, 68];

const RING_CX = 16;
const RING_CY = 16;

const MIC_CX = 16;
const MIC_CY = 15.75;

const TUNING = {
  default: { outer: 15.2, inner: 11.7, mic: 0.8 },
  16: { outer: 15.7, inner: 12.6, mic: 0.88 }
};

function tuningFor(size) {
  return TUNING[size] || TUNING.default;
}

function sdRoundRect(px, py, x0, y0, x1, y1, r) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const qx = Math.abs(px - cx) - ((x1 - x0) / 2 - r);
  const qy = Math.abs(py - cy) - ((y1 - y0) / 2 - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function inMic(x, y) {
  if (sdRoundRect(x, y, 12.2, 3, 19.8, 18, 3.8) <= 0) return true;
  const d = Math.hypot(x - 16, y - 14);
  if (y >= 14 && d >= 6.6 && d <= 9.6) return true;
  if (sdRoundRect(x, y, 14.4, 21.5, 17.6, 28.5, 1.6) <= 0) return true;
  return false;
}

function inRing(x, y, tuning) {
  const d = Math.hypot(x - RING_CX, y - RING_CY);
  return d >= tuning.inner && d <= tuning.outer;
}

function sampleColor(x, y, connected, tuning) {
  if (inRing(x, y, tuning)) return connected ? LIVE : MARK;
  const mx = (x - MIC_CX) / tuning.mic + MIC_CX;
  const my = (y - MIC_CY) / tuning.mic + MIC_CY;
  if (inMic(mx, my)) return MARK;
  return null;
}

function render(size, connected) {
  const scale = size / 32;
  const tuning = tuningFor(size);
  const rgba = Buffer.alloc(size * size * 4);
  const total = SUPERSAMPLE * SUPERSAMPLE;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / scale;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / scale;
          const color = sampleColor(x, y, connected, tuning);
          if (color) {
            r += color[0];
            g += color[1];
            b += color[2];
            hits++;
          }
        }
      }

      const offset = (py * size + px) * 4;
      if (hits) {
        rgba[offset] = Math.round(r / hits);
        rgba[offset + 1] = Math.round(g / hits);
        rgba[offset + 2] = Math.round(b / hits);
        rgba[offset + 3] = Math.round((hits / total) * 255);
      }
    }
  }

  return rgba;
}

const crcTable = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const name = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function blit(sheet, sheetWidth, rgba, size, dx, dy, ground) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const alpha = rgba[src + 3] / 255;
      if (!alpha) continue;
      const dst = ((dy + y) * sheetWidth + (dx + x)) * 4;
      for (let c = 0; c < 3; c++) {
        sheet[dst + c] = Math.round(rgba[src + c] * alpha + ground[c] * (1 - alpha));
      }
      sheet[dst + 3] = 255;
    }
  }
}

function contactSheet() {
  const grounds = [
    [216, 219, 225],
    [41, 42, 46]
  ];
  const pad = 24;
  const gap = 20;
  const rowHeight = 128 + pad * 2;
  const groupWidth = pad + SIZES.reduce((sum, s) => sum + s + gap, 0);
  const width = groupWidth * 2 + pad;
  const height = rowHeight * grounds.length;
  const sheet = Buffer.alloc(width * height * 4);

  grounds.forEach((ground, row) => {
    for (let y = 0; y < rowHeight; y++) {
      for (let x = 0; x < width; x++) {
        const dst = ((row * rowHeight + y) * width + x) * 4;
        sheet[dst] = ground[0];
        sheet[dst + 1] = ground[1];
        sheet[dst + 2] = ground[2];
        sheet[dst + 3] = 255;
      }
    }

    [false, true].forEach((connected, group) => {
      let cursor = pad + group * groupWidth;
      for (const size of SIZES) {
        const rgba = render(size, connected);
        const dy = row * rowHeight + pad + (128 - size);
        blit(sheet, width, rgba, size, cursor, dy, ground);
        cursor += size + gap;
      }
    });
  });

  return { buffer: encodePng(width, height, sheet), width, height };
}

fs.mkdirSync(outDir, { recursive: true });

for (const size of SIZES) {
  const file = path.join(outDir, `icon${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, render(size, false)));
  console.log(`wrote ${path.relative(path.join(here, ".."), file)} (${size}x${size})`);
}

if (process.argv.includes("--sheet")) {
  const target = process.argv[process.argv.indexOf("--sheet") + 1];
  if (!target) {
    console.error("--sheet needs an output path");
    process.exit(1);
  }
  const { buffer, width, height } = contactSheet();
  fs.writeFileSync(target, buffer);
  console.log(`wrote ${target} (${width}x${height})`);
}
