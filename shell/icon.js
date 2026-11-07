/* 从 exe / dll 里直接读图标资源，转成一张 PNG 的 data URL
 *
 * 为什么不用 app.getFileIcon 单独扛：
 *   那接口走系统 shell，在某些机器上（安全策略收紧、图标缓存坏了）会返回空图，
 *   页面就只能显示占位符。这里改成自己读 PE 文件里的 RT_GROUP_ICON / RT_ICON，
 *   纯读文件、不调外部程序、不依赖任何包，只要文件本身带图标就一定拿得到。
 *
 * 两种图标帧都要处理：
 *   · 新程序给的是 PNG 帧，直接拿来用
 *   · 老程序（计算器、资源管理器这类）给的是 BMP 帧，得自己解成像素再编成 PNG
 *
 * 用法：
 *   const { iconDataUrl } = require('./icon');
 *   const url = iconDataUrl('C:\\xxx\\yyy.exe');   // 没有图标返回 ''
 */
'use strict';

const fs = require('fs');
const zlib = require('zlib');
const msix = require('./msix');

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

/* ---------------- PNG 编码 ---------------- */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/* rgba: Buffer，长度 = w*h*4 */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);  /* 8 位深 */
  ihdr.writeUInt8(6, 9);  /* RGBA */
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  /* 每行前面加一个过滤字节 0（不过滤），像素原样塞进去 */
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 图标帧：BMP → 像素 ---------------- */

/* 图标里的 BMP 是不带文件头的 DIB，高度写的是两倍（含 AND 蒙版） */
function decodeDib(dib) {
  if (dib.length < 40) return null;
  const biSize = dib.readUInt32LE(0);
  const w = dib.readInt32LE(4);
  const rawH = dib.readInt32LE(8);
  const bitCount = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  const clrUsed = dib.readUInt32LE(32);
  const h = Math.abs(rawH) >> 1;
  if (w <= 0 || h <= 0 || w > 1024 || h > 1024) return null;

  let palOff = biSize;
  let palCount = clrUsed;
  if (!palCount && bitCount <= 8) palCount = 1 << bitCount;

  /* BI_BITFIELDS 的 40 字节头后面还跟三个掩码 */
  let maskSkip = 0;
  if (compression === 3 && biSize === 40) maskSkip = 12;

  const palSize = palCount * 4;
  const pixelOff = palOff + palSize + maskSkip;
  const stride = Math.floor((w * bitCount + 31) / 32) * 4;
  if (pixelOff + stride * h > dib.length) return null;

  const maskOff = pixelOff + stride * h;
  const maskStride = Math.floor((w + 31) / 32) * 4;

  const rgba = Buffer.alloc(w * h * 4);
  let anyAlpha = false;

  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y; /* 自下而上存 */
    const row = pixelOff + srcY * stride;
    const maskRow = maskOff + srcY * maskStride;
    const dstRow = y * w * 4;

    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 255;
      const d = dstRow + x * 4;

      if (bitCount === 32) {
        const o = row + x * 4;
        if (o + 3 >= dib.length) break;
        b = dib[o]; g = dib[o + 1]; r = dib[o + 2]; a = dib[o + 3];
        if (a > 0) anyAlpha = true;
      } else if (bitCount === 24) {
        const o = row + x * 3;
        if (o + 2 >= dib.length) break;
        b = dib[o]; g = dib[o + 1]; r = dib[o + 2];
      } else if (bitCount === 8 || bitCount === 4 || bitCount === 1) {
        let idx;
        if (bitCount === 8) idx = dib[row + x];
        else if (bitCount === 4) {
          const o = row + (x >> 1);
          idx = (x & 1) ? (dib[o] & 0x0f) : (dib[o] >> 4);
        } else {
          const o = row + (x >> 3);
          idx = (dib[o] >> (7 - (x & 7))) & 1;
        }
        const p = palOff + idx * 4;
        if (p + 3 >= dib.length) break;
        b = dib[p]; g = dib[p + 1]; r = dib[p + 2];
      } else {
        return null;
      }

      /* AND 蒙版：这一位是 1 表示完全透明 */
      if (a === 255 || bitCount !== 32 || !anyAlpha) {
        if (maskOff + maskStride * h <= dib.length) {
          const bit = (dib[maskRow + (x >> 3)] >> (7 - (x & 7))) & 1;
          if (bit) a = 0;
        }
      }

      rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
    }
  }

  /* 32bpp 但 alpha 全 0 的老图标：说明它没写 alpha，退回全不透明 */
  if (bitCount === 32 && !anyAlpha) {
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  }

  return { width: w, height: h, rgba: rgba };
}

/* ---------------- PE 资源解析 ---------------- */

function rvaToOffset(buf, peOff, rva) {
  const numSections = buf.readUInt16LE(peOff + 6);
  const optSize = buf.readUInt16LE(peOff + 20);
  const secOff = peOff + 24 + optSize;

  for (let i = 0; i < numSections; i++) {
    const s = secOff + i * 40;
    if (s + 40 > buf.length) break;
    const va = buf.readUInt32LE(s + 12);
    const rawSize = buf.readUInt32LE(s + 16);
    const rawPtr = buf.readUInt32LE(s + 20);
    if (rva >= va && rva < va + Math.max(rawSize, 1)) return rawPtr + (rva - va);
  }
  return -1;
}

function walkDir(buf, resBase, dirOff, cb) {
  const base = resBase + dirOff;
  if (base + 16 > buf.length) return;
  const named = buf.readUInt16LE(base + 12);
  const ids = buf.readUInt16LE(base + 14);
  const total = named + ids;

  for (let i = 0; i < total; i++) {
    const e = base + 16 + i * 8;
    if (e + 8 > buf.length) return;
    const nameRaw = buf.readUInt32LE(e);
    const offRaw = buf.readUInt32LE(e + 4);
    cb((offRaw & 0x80000000) !== 0, (nameRaw & 0x80000000) ? -1 : nameRaw, offRaw & 0x7fffffff);
  }
}

function isPng(buf, off) {
  return off + 8 <= buf.length && buf.readUInt32BE(off) === 0x89504e47;
}

/* ---------------- 对外接口 ---------------- */

/* 返回 { png: Buffer } 或 null
 *
 * 只读需要的那两段：文件头（PE 结构 + 段表）和资源段本身。
 * 不整文件读进来，Edge 那种两百多 M 的程序也不会卡一下。
 */
function iconPng(file) {
  let fd = null;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return null; }

  try {
    const size = fs.fstatSync(fd).size;
    if (size < 0x40) return null;

    const headLen = Math.min(size, 64 * 1024);
    const head = Buffer.alloc(headLen);
    fs.readSync(fd, head, 0, headLen, 0);

    if (head.readUInt16LE(0) !== 0x5a4d) return null; /* 'MZ' */
    const peOff = head.readUInt32LE(0x3c);
    if (!peOff || peOff + 24 > headLen) return null;
    if (head.readUInt32LE(peOff) !== 0x00004550) return null;

    const optOff = peOff + 24;
    const magic = head.readUInt16LE(optOff);
    const dirOff = optOff + (magic === 0x20b ? 112 : 96);
    if (dirOff + 8 > headLen) return null;

    const resRva = head.readUInt32LE(dirOff + 16);
    const resSize = head.readUInt32LE(dirOff + 20);
    if (!resRva) return null;

    const resOff = rvaToOffset(head, peOff, resRva);
    if (resOff < 0 || resOff >= size) return null;

    const len = Math.min(resSize || (size - resOff), size - resOff);
    if (len < 16) return null;
    const res = Buffer.alloc(len);
    fs.readSync(fd, res, 0, len, resOff);

    /* 进了资源段以后，段首就是偏移 0，目录里的地址都相对它 */
    const resBase = 0;
    const inRes = (rva) => {
      const o = rva - resRva;
      return (o < 0 || o >= res.length) ? -1 : o;
    };

    return pickIcon(res, resBase, inRes);
  } catch (e) {
    return null;
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
  }
}

function pickIcon(res, resBase, inRes) {
  /* 第一组图标就够用 */
  let groupRva = 0;
  walkDir(res, resBase, 0, (isDir, id, off) => {
    if (groupRva || !isDir || id !== RT_GROUP_ICON) return;
    walkDir(res, resBase, off, (isDir2, id2, off2) => {
      if (groupRva || !isDir2) return;
      walkDir(res, resBase, off2, (isDir3, id3, off3) => {
        if (groupRva || isDir3) return;
        const e = resBase + off3;
        if (e + 16 <= res.length) groupRva = res.readUInt32LE(e);
      });
    });
  });
  if (!groupRva) return null;

  const gOff = inRes(groupRva);
  if (gOff < 0 || gOff + 6 > res.length) return null;
  const count = res.readUInt16LE(gOff + 4);

  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = gOff + 6 + i * 14;
    if (e + 14 > res.length) break;
    entries.push({
      w: res.readUInt8(e) || 256,
      h: res.readUInt8(e + 1) || 256,
      bitCount: res.readUInt16LE(e + 6),
      id: res.readUInt16LE(e + 12)
    });
  }
  if (!entries.length) return null;

  /* 胶囊里只显示 26px：优先 64 及以下里最大的，同样大小挑色深高的 */
  const small = entries.filter((m) => m.w <= 64 && m.h >= 16);
  const pool = small.length ? small : entries.filter((m) => m.w >= 16);
  pool.sort((a, b) => (b.w - a.w) || (b.bitCount - a.bitCount));

  for (const m of pool) {
    const hit = findIconData(res, resBase, m.id);
    if (!hit) continue;
    const off = inRes(hit.rva);
    if (off < 0 || off + hit.size > res.length) continue;
    const data = res.slice(off, off + hit.size);
    if (!data.length) continue;

    /* 新程序：帧本身就是 PNG，直接用 */
    if (isPng(data, 0)) return { png: data };

    /* 老程序：BMP 帧，解成像素再编 PNG */
    const px = decodeDib(data);
    if (px) return { png: encodePng(px.width, px.height, px.rgba) };
  }

  return null;
}

/* 按 id 找某个图标的数据位置 */
function findIconData(res, resBase, id) {
  let hit = null;
  walkDir(res, resBase, 0, (isDir, type, off) => {
    if (hit || !isDir || type !== RT_ICON) return;
    walkDir(res, resBase, off, (isDir2, id2, off2) => {
      if (hit || !isDir2 || String(id2) !== String(id)) return;
      walkDir(res, resBase, off2, (isDir3, id3, off3) => {
        if (hit || isDir3) return;
        const e = resBase + off3;
        if (e + 16 > res.length) return;
        hit = { rva: res.readUInt32LE(e), size: res.readUInt32LE(e + 4) };
      });
    });
  });
  return hit;
}

/* ---------------- 快捷方式 ---------------- */

/* .lnk 里的路径不是 UTF-8，是系统本地代码页：中文 Windows 上就是 GBK。
 * 直接当 latin1 读会变成 D:/ÏÂÔØ/... 这种乱码，路径永远对不上。 */
let ansiDecoder = null;
let ansiTried = false;

function decodeAnsi(buf) {
  if (!ansiTried) {
    ansiTried = true;
    try { ansiDecoder = new TextDecoder('gbk'); } catch (e) { ansiDecoder = null; }
  }
  if (ansiDecoder) {
    try { return ansiDecoder.decode(buf); } catch (e) {}
  }
  return buf.toString('latin1');
}

function isFile(p) {
  try { return !!p && fs.statSync(p).isFile(); } catch (e) { return false; }
}

function sliceZ(buf, start, len) {
  if (start < 0 || start >= buf.length) return Buffer.alloc(0);
  const end = Math.min(buf.length, start + len);
  const seg = buf.slice(start, end);
  const nul = seg.indexOf(0);
  return nul >= 0 ? seg.slice(0, nul) : seg;
}

function utf16At(buf, start, maxChars) {
  let s = '';
  for (let i = start; i + 1 < buf.length && s.length < maxChars; i += 2) {
    const c = buf.readUInt16LE(i);
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}

/* 按 MS-SHLLINK 的结构把 .lnk 拆开，按可靠性从高到低给出候选目标路径
 *
 *   头 76 字节 → LinkTargetIDList → LinkInfo（真正的绝对路径在这里）
 *   → StringData → ExtraData（环境变量块里也常常留着一份完整路径）
 */
function lnkCandidates(file) {
  let buf;
  try {
    if (fs.statSync(file).size > 512 * 1024) return [];
    buf = fs.readFileSync(file);
  } catch (e) {
    return [];
  }
  if (buf.length < 0x4c || buf.readUInt32LE(0) !== 0x4c) return [];

  const flags = buf.readUInt32LE(0x14);
  const out = [];
  /* 只认真正的盘符路径 / UNC。结构算偏的时候会冒出 "R"、"机" 这种碎片，
   * 放进候选里会先把它们当成目标去试，白跑一趟还容易误判。 */
  const looksPath = (p) => /^[a-zA-Z]:\\[^\\]/.test(p) || /^\\\\[^\\]/.test(p);
  const push = (p) => { if (p && looksPath(p) && out.indexOf(p) < 0) out.push(p); };

  let o = 0x4c;

  /* 一、LinkTargetIDList：只用来跳过去，里面的东西是 shell 内部结构 */
  if (flags & 0x01) {
    const sz = buf.readUInt16LE(o);
    o += 2 + sz;
  }

  /* 二、LinkInfo：LocalBasePath + CommonPathSuffix，这是最准的一处 */
  if ((flags & 0x02) && o + 0x1c <= buf.length) {
    try {
      const liSize = buf.readUInt32LE(o);
      const liHead = buf.readUInt32LE(o + 4);
      const liFlags = buf.readUInt32LE(o + 8);
      const baseOff = buf.readUInt32LE(o + 16);
      const suffixOff = buf.readUInt32LE(o + 24);

      let base = '';
      let suffix = '';
      if (baseOff) base = decodeAnsi(sliceZ(buf, o + baseOff, 520));
      if (suffixOff) suffix = decodeAnsi(sliceZ(buf, o + suffixOff, 520));

      /* 新版头里还带一份 unicode 的，优先用它 */
      if (liHead >= 0x24 && o + 0x24 <= buf.length) {
        const uBaseOff = buf.readUInt32LE(o + 28);
        const uSuffixOff = buf.readUInt32LE(o + 32);
        if (uBaseOff) {
          const u = utf16At(buf, o + uBaseOff, 520);
          if (u) base = u;
        }
        if (uSuffixOff) {
          const u = utf16At(buf, o + uSuffixOff, 520);
          if (u) suffix = u;
        }
      }

      if ((liFlags & 1) && base) push(base + (suffix && !/\\$/.test(base) ? suffix.replace(/^\\/, '') : suffix));
      if (base) push(base);

      o += liSize;
    } catch (e) {
      o += 4;
    }
  }

  /* 三、StringData：名字 / 相对路径 / 工作目录 / 参数 / 图标位置 */
  const uni = !!(flags & 0x80);
  const skipStr = () => {
    if (o + 2 > buf.length) return '';
    const cnt = buf.readUInt16LE(o);
    const bytes = uni ? cnt * 2 : cnt;
    const val = uni ? utf16At(buf, o + 2, cnt) : decodeAnsi(sliceZ(buf, o + 2, bytes));
    o += 2 + bytes;
    return val;
  };
  try {
    if (flags & 0x04) skipStr();
    if (flags & 0x08) {
      const rel = skipStr();
      if (rel && /^[a-zA-Z]:\\/.test(rel)) push(rel);
    }
    if (flags & 0x10) skipStr();
    if (flags & 0x20) skipStr();
    if (flags & 0x40) {
      const icon = skipStr();
      if (icon && /^[a-zA-Z]:\\/.test(icon)) push(icon);
    }
  } catch (e) {}

  /* 四、ExtraData：环境变量块里常有一份展开前后的完整路径 */
  while (o + 8 <= buf.length) {
    let blkSize, sig;
    try {
      blkSize = buf.readUInt32LE(o);
      sig = buf.readUInt32LE(o + 4);
    } catch (e) { break; }
    if (!blkSize || blkSize < 4 || o + blkSize > buf.length) break;

    /* A0000007 图标环境 / A0000009 目标环境：都是 260 字节 ANSI + 520 字节 unicode */
    if (sig === 0xa0000007 || sig === 0xa0000009) {
      const ansi = decodeAnsi(sliceZ(buf, o + 8, 260));
      const wide = utf16At(buf, o + 268, 520);
      if (ansi) push(ansi);
      if (wide) push(wide);
    }
    o += blkSize;
  }

  /* 五、兜底：直接在字节流里扫像绝对路径的串（老工具生成的 lnk 结构可能不规范） */
  for (let i = 0; i + 8 < buf.length; i++) {
    const c0 = buf[i], c1 = buf[i + 1], c2 = buf[i + 2], c3 = buf[i + 3];
    const isLetter = (c0 >= 0x41 && c0 <= 0x5a) || (c0 >= 0x61 && c0 <= 0x7a);
    if (!isLetter || c1 !== 0 || c2 !== 0x3a || c3 !== 0) continue;
    if (buf[i + 4] !== 0x5c || buf[i + 5] !== 0) continue;
    const s = utf16At(buf, i, 400);
    if (/\.(exe|dll|ico)$/i.test(s)) push(s);
  }

  const ascii = buf.toString('latin1');
  const re = /[A-Za-z]:\\[^\x00-\x1f"<>|*?\r\n]{1,380}/g;
  let m;
  while ((m = re.exec(ascii))) {
    if (/\.(exe|dll|ico)$/i.test(m[0])) push(m[0].replace(/[\s\x00]+$/, ''));
  }

  return out;
}

/* 快捷方式指向的那个文件（存在才算数），没有就返回空 */
function lnkTarget(file) {
  const list = lnkCandidates(file);
  for (const p of list) {
    if (isFile(p)) return p;
  }
  return '';
}

/* ---------------- 找不到文件时：按名字把它找回来 ---------------- */

/* 用户拖进来的多是自己整理的快捷方式，后来文件夹改名/挪走就断了。
 * 这里按文件名去几个常见位置找同名的 lnk，找到就当目标。 */
const SCAN_ROOTS = () => {
  const home = process.env.USERPROFILE || '';
  const appdata = process.env.APPDATA || '';
  const progdata = process.env.ProgramData || '';
  const list = [
    home && home + '\\Desktop',
    home && home + '\\Downloads\\app',
    home && home + '\\Documents\\app',
    home && home + '\\Downloads',
    appdata && appdata + '\\Microsoft\\Windows\\Start Menu\\Programs',
    progdata && progdata + '\\Microsoft\\Windows\\Start Menu\\Programs',
    progdata && progdata + '\\Desktop'
  ];
  return list.filter(Boolean);
};

let indexCache = null;
let indexAt = 0;

function buildIndex() {
  const map = Object.create(null);
  /* 索引的键也走 cleanName：用户手上有 "HBuilder X.lnk"、"微信 - 快捷方式.lnk"、
   * "5E对战平台 (2).lnk" 各种写法，键统一了按名字才找得回来 */
  const add = (full) => {
    const base = cleanName(full).toLowerCase();
    if (!base) return;
    if (!map[base]) map[base] = full;
  };

  const walk = (dir, depth) => {
    let list;
    try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const d of list) {
      const full = dir + '\\' + d.name;
      if (d.isDirectory()) {
        if (depth < 3) walk(full, depth + 1);
        continue;
      }
      if (/\.(lnk|exe|url|bat|cmd)$/i.test(d.name)) add(full);
    }
  };

  for (const r of SCAN_ROOTS()) walk(r, 0);
  indexCache = map;
  indexAt = Date.now();
  return map;
}

function lookupName(name) {
  const key = String(name || '').replace(/^.*[\\\/]/, '').replace(/\.[^.]+$/, '').trim().toLowerCase();
  if (!key) return '';
  if (!indexCache || Date.now() - indexAt > 120000) buildIndex();
  return indexCache[key] || '';
}

/* 系统里的特殊项（此电脑、回收站这些）根本没有 exe，用系统程序借一张图标 */
const SHELL_ALIAS = {
  '此电脑': 'explorer.exe',
  '我的电脑': 'explorer.exe',
  '计算机': 'explorer.exe',
  '文件资源管理器': 'explorer.exe',
  '文件管理器': 'explorer.exe',
  '回收站': 'explorer.exe',
  '控制面板': 'control.exe'
};

function shellAlias(name) {
  const key = String(name || '').trim();
  const exe = SHELL_ALIAS[key];
  if (!exe) return '';
  const dir = process.env.WINDIR || 'C://Windows';
  const p = dir + '\\' + exe;
  return isFile(p) ? p : '';
}

/* 名字归一：去掉扩展名、目录，还有" - 快捷方式""- 副本""(2)"这些尾巴，
 * 不然后面按名字找程序和查系统别名都对不上。 */
function cleanName(s) {
  /* 先去扩展名再去"快捷方式"尾巴：
   *   "此电脑 - 快捷方式.lnk"        → 此电脑
   *   "xyz.exe - 快捷方式.lnk"       → xyz
   * 反过来的话第二种会被砍成 "xyz.exe - 快捷方式"，名字对不上。 */
  const stripExt = (x) => String(x || '').replace(/\.[a-z0-9]{1,6}$/i, '');
  return stripExt(
    stripExt(String(s || '').replace(/^.*[\\\/]/, ''))
      .replace(/\s*[-–—]\s*快捷方式\s*$/i, '')
      .replace(/\s*[-–—]\s*副本\s*$/i, '')
      .replace(/\s*\(\d+\)\s*$/, '')
  ).trim();
}

/* 给定拖进来的东西（可能是 exe、快捷方式，也可能已经失效），返回
 *   launch  双击时打开什么（原件还在就用原件，快捷方式的参数和工作目录才不会丢）
 *   icon    从哪个文件取图标
 * 两个都可能是空字符串；页面遇到空 icon 会画一个首字方块，不会留白。 */
function resolveApp(file, label) {
  const p = String(file || '').trim();
  const clean = cleanName(p) || cleanName(label);

  if (p && isFile(p)) {
    if (/\.lnk$/i.test(p)) {
      const t = lnkTarget(p);
      if (t) return { launch: p, icon: t };
      /* 纯 IDList 的快捷方式（商店应用、此电脑这类）解析不出文件，
       * 启动还是用这个快捷方式本身，图标借系统的顶上 */
      return { launch: p, icon: shellAlias(clean) || lookupName(clean) };
    }
    if (/\.url$/i.test(p)) return { launch: p, icon: urlIconFile(p) };
    return { launch: p, icon: p };
  }

  /* 原文件没了（常见于用户后来整理过文件夹）：按名字再找一次 */
  const names = [clean, cleanName(label)];
  for (const n of names) {
    if (!n) continue;
    const found = lookupName(n);
    if (found && isFile(found)) {
      if (/\.lnk$/i.test(found)) {
        const t = lnkTarget(found);
        return { launch: found, icon: t || shellAlias(n) || '' };
      }
      return { launch: found, icon: found };
    }
  }

  for (const n of names) {
    if (!n) continue;
    const alias = shellAlias(n);
    if (alias) return { launch: alias, icon: alias };
  }

  return { launch: '', icon: '' };
}

/* .url 是 ini 格式，图标可能写在 IconFile 里 */
function urlIconFile(file) {
  let txt = '';
  try { txt = fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
  const m = /^\s*IconFile\s*=\s*(.+)$/im.exec(txt);
  if (!m) return '';
  const p = m[1].trim().replace(/^"|"$/g, '');
  return isFile(p) ? p : '';
}

function iconDataUrl(file) {
  const src = String(file || '');
  if (!isFile(src)) return '';

  let r = iconPng(src);

  /* 快捷方式 / 网址文件自己没图标，顺着它指的地方再找一次 */
  if (!r && /\.lnk$/i.test(src)) {
    const t = lnkTarget(src);
    if (t) r = iconPng(t);
    /* 商店应用（微信、抖音、ChatGPT 那种）的快捷方式是纯 IDList，
     * 里面根本没有文件可解析。它们的图标藏在自己的安装包里，另走一条路取。 */
    if (!r || !r.png || !r.png.length) {
      const u = msix.msixIconSync(src);
      if (u) return u;
    }
  }
  if (!r && /\.url$/i.test(src)) {
    const t = urlIconFile(src);
    if (t) r = iconPng(t);
  }

  if (!r || !r.png || !r.png.length) return '';
  return 'data:image/png;base64,' + r.png.toString('base64');
}

module.exports = {
  iconPng, iconDataUrl, encodePng, decodeDib,
  lnkCandidates, lnkTarget, resolveApp, lookupName, buildIndex, cleanName
};
