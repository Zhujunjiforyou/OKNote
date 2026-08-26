const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const SCALE = 4;
const WIDTH = SIZE * SCALE;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function insideRoundedRect(x, y, left, top, right, bottom, radius) {
  const cx = Math.max(left + radius, Math.min(right - radius, x));
  const cy = Math.max(top + radius, Math.min(bottom - radius, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

function renderHighResolution() {
  const pixels = new Uint8Array(WIDTH * WIDTH * 4);
  const paint = (x, y, [r, g, b, a]) => {
    const index = (y * WIDTH + x) * 4;
    pixels[index] = r; pixels[index + 1] = g; pixels[index + 2] = b; pixels[index + 3] = a;
  };
  const blue = [37, 99, 235, 255];
  const paper = [248, 250, 252, 255];
  const line = [96, 165, 250, 255];
  const ink = [30, 64, 175, 255];
  for (let y = 0; y < WIDTH; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      if (insideRoundedRect(x, y, 12 * SCALE, 12 * SCALE, 244 * SCALE, 244 * SCALE, 54 * SCALE)) paint(x, y, blue);
      if (insideRoundedRect(x, y, 53 * SCALE, 34 * SCALE, 203 * SCALE, 222 * SCALE, 27 * SCALE)) paint(x, y, paper);
      if (x >= 78 * SCALE && x <= 178 * SCALE && y >= 83 * SCALE && y <= 95 * SCALE) paint(x, y, ink);
      if (x >= 78 * SCALE && x <= 178 * SCALE && y >= 122 * SCALE && y <= 134 * SCALE) paint(x, y, line);
      if (x >= 78 * SCALE && x <= 151 * SCALE && y >= 161 * SCALE && y <= 173 * SCALE) paint(x, y, line);
    }
  }
  return pixels;
}

function downsample(source) {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const sums = [0, 0, 0, 0];
      for (let sy = 0; sy < SCALE; sy += 1) for (let sx = 0; sx < SCALE; sx += 1) {
        const sourceIndex = (((y * SCALE + sy) * WIDTH) + (x * SCALE + sx)) * 4;
        for (let channel = 0; channel < 4; channel += 1) sums[channel] += source[sourceIndex + channel];
      }
      const targetIndex = (y * SIZE + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) pixels[targetIndex + channel] = Math.round(sums[channel] / (SCALE * SCALE));
    }
  }
  return pixels;
}

function encodePng(pixels) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * (SIZE * 4 + 1);
    raw[row] = 0;
    pixels.copy(raw, row + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0); header.writeUInt32BE(SIZE, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, 'icon.png'), encodePng(downsample(renderHighResolution())));
console.log('  • generated build/icon.png');
