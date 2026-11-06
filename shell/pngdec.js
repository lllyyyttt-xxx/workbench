/* 最小 PNG 解码：够用就行（8/16 位灰度、RGB、RGBA、调色板，含 tRNS） */
const zlib = require('zlib');

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function decodePng(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  if (buf.slice(0, 8).toString('latin1') !== '\x89PNG\r\n\x1a\n') return null;

  let off = 8, ihdr = null, plte = null, trns = null;
  const idat = [];
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.slice(off + 4, off + 8).toString('latin1');
    const data = buf.slice(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        w: data.readUInt32BE(0), h: data.readUInt32BE(4),
        depth: data[8], color: data[9], interlace: data[12]
      };
    } else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr || !idat.length || ihdr.interlace) return null;

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }

  const { w, h, depth, color } = ihdr;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) return null;
  const bitsPP = channels * depth;
  const bpp = Math.max(1, Math.ceil(bitsPP / 8));
  const stride = Math.ceil((w * bitsPP) / 8);

  const out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;

  for (let y = 0; y < h; y++) {
    if (pos >= raw.length) return null;
    const filter = raw[pos++];
    const line = Buffer.from(raw.slice(pos, pos + stride));
    pos += stride;
    if (line.length < stride) return null;

    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      line[i] = v & 0xff;
    }

    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (color === 3) {
        const idx = depth === 8 ? line[x] : (line[(x * depth) >> 3] >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        const pi = idx * 3;
        out[o] = plte ? plte[pi] : 0;
        out[o + 1] = plte ? plte[pi + 1] : 0;
        out[o + 2] = plte ? plte[pi + 2] : 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (color === 0) {
        const g = depth === 16 ? line[x * 2] : line[x];
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = 255;
      } else if (color === 4) {
        const g = depth === 16 ? line[x * 4] : line[x * 2];
        out[o] = out[o + 1] = out[o + 2] = g;
        out[o + 3] = depth === 16 ? line[x * 4 + 2] : line[x * 2 + 1];
      } else if (color === 2) {
        const step = depth === 16 ? 6 : 3;
        const base = depth === 16 ? x * 6 : x * 3;
        out[o] = line[base];
        out[o + 1] = line[base + (depth === 16 ? 2 : 1)];
        out[o + 2] = line[base + (depth === 16 ? 4 : 2)];
        out[o + 3] = 255;
      } else {
        const base = depth === 16 ? x * 8 : x * 4;
        out[o] = line[base];
        out[o + 1] = line[base + (depth === 16 ? 2 : 1)];
        out[o + 2] = line[base + (depth === 16 ? 4 : 2)];
        out[o + 3] = line[base + (depth === 16 ? 6 : 3)];
      }
    }
    prev = line;
  }

  return { w, h, data: out };
}

module.exports = { decodePng };
