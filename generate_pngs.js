const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 Table & Calculation
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);

  const typeBuf = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuf, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);

  return Buffer.concat([len, typeAndData, crc]);
}

function createPng(width, height) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR Chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 6;  // RGBA color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  // Raw Image Data (Filter byte 0x00 per row + RGBA)
  const rowLength = 1 + width * 4;
  const rawData = Buffer.alloc(rowLength * height);

  const cx = width / 2;
  const cy = height / 2;
  const r = width * 0.44;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter byte: None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      
      // Distance from center
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded background corner check
      const cornerR = width * 0.22;
      const qx = Math.max(Math.abs(dx) - (cx - cornerR), 0);
      const qy = Math.max(Math.abs(dy) - (cy - cornerR), 0);
      const cornerDist = Math.sqrt(qx * qx + qy * qy);

      if (cornerDist > cornerR) {
        // Transparent outside rounded icon
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
        continue;
      }

      // Background Gradient (Deep Indigo / Slate)
      const gradRatio = (x + y) / (width + height);
      let rCol = Math.round(15 + gradRatio * 20);
      let gCol = Math.round(23 + gradRatio * 15);
      let bCol = Math.round(42 + gradRatio * 50);

      // Core Diamond Emblem
      const diamondDist = Math.abs(dx) + Math.abs(dy);
      const diamondSize = width * 0.32;
      const innerDiamond = width * 0.16;

      if (diamondDist < diamondSize && diamondDist > innerDiamond) {
        // Glowing Cyan-Violet Shield
        const t = (x / width);
        rCol = Math.round(99 * (1 - t) + 6 * t);
        gCol = Math.round(102 * (1 - t) + 182 * t);
        bCol = Math.round(241 * (1 - t) + 212 * t);
      } else if (diamondDist <= innerDiamond) {
        // Center Core Spark
        const t = (y / height);
        rCol = Math.round(236 * (1 - t) + 56 * t);
        gCol = Math.round(72 * (1 - t) + 189 * t);
        bCol = Math.round(153 * (1 - t) + 248 * t);
      }

      rawData[pxOffset] = rCol;
      rawData[pxOffset + 1] = gCol;
      rawData[pxOffset + 2] = bCol;
      rawData[pxOffset + 3] = 255;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressedData);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

// Generate Icons
const iconDir = path.join(__dirname, 'assets', 'icons');
fs.writeFileSync(path.join(iconDir, 'icon-192.png'), createPng(192, 192));
fs.writeFileSync(path.join(iconDir, 'icon-512.png'), createPng(512, 512));
fs.writeFileSync(path.join(iconDir, 'apple-touch-icon.png'), createPng(192, 192));

console.log('Successfully generated pure PNG icons: icon-192.png, icon-512.png, apple-touch-icon.png');
