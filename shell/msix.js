/* 商店应用（MSIX / UWP，比如商店版 ChatGPT、微信、抖音）的图标
 *
 * 这类应用的快捷方式是个纯 IDList 的 .lnk：里面没有 exe、没有 LinkInfo，
 * 所以「读 PE 资源」那条路必然空手。但它们有一个更简单的事实：
 *   · .lnk 里就写着 AppUserModelID（形如 OpenAI.Codex_2p2nqsd0c76g0!App）
 *   · 每个包装在 C:\Program Files\WindowsApps\<包全名>\ 下，里面一定有
 *     AppxManifest.xml 和一堆现成的 PNG 徽标（最大 256px）
 *
 * 于是流程是：IDList 取 AUMID → 包族名 → 当前安装目录 → 读 manifest
 *           → 挑最大的徽标 PNG → 按 manifest 的 BackgroundColor 合成磁贴
 *
 * 为什么必须自己合成：这类徽标是「透明底 + 纯白 logo」，Windows 用
 * BackgroundColor 当底板画出来（ChatGPT 那块蓝紫就是 #3143FF）。
 * 直接把白 logo 丢到浅色界面上会整片看不见。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { decodePng } = require('./pngdec');

/* encodePng 在 icon.js 里，惰性取避免两个文件互相 require 卡住初始化 */
function encPng(w, h, rgba) {
  try { return require('./icon').encodePng(w, h, rgba); } catch (e) { return null; }
}

const TILE = 96; // 输出边长：界面上图标 40px 显示，2x 屏也够
const CACHE_FILE = path.join(process.env.APPDATA || os.homedir(), '工作台', 'appx-map.json');
const CACHE_TTL = 7 * 24 * 3600 * 1000;

/* ---------------- 从 .lnk 里挖 AUMID ---------------- */

/* IDList 是二进制，但这些字符串是 UTF-16LE 存的，整段解码后能直接正则捞 */
function utf16Dump(buf) {
  let s = '';
  for (const off of [0, 1]) {
    try { s += buf.slice(off).toString('utf16le'); } catch (e) {}
    s += '\u0000';
  }
  return s;
}

function lnkMsix(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (!buf.length) return null;

  const dump = utf16Dump(buf);

  /* Name_Version_Arch__PublisherHash!AppId —— 包族名就是感叹号前面那段 */
  const m = /([A-Za-z0-9][A-Za-z0-9._-]{1,80})_([a-z0-9]{13})!([A-Za-z0-9._-]{1,64})/.exec(dump);
  if (!m) return null;
  const family = m[1] + '_' + m[2];

  /* 顺便看看 IDList 里有没有直接写着安装目录（版本没更新的包就不用查系统了） */
  let dir = '';
  const d = /([A-Za-z]:\\Program Files\\WindowsApps\\[^\\\u0000]{3,120})/.exec(dump) ||
            /([A-Za-z]:\\WindowsApps\\[^\\\u0000]{3,120})/.exec(dump);
  if (d) dir = d[1];

  return { aumid: m[0], family: family, dir: dir };
}

/* ---------------- 包族名 → 当前安装目录 ---------------- */

let mapMem = null;
let mapPending = null;

function readCache() {
  try {
    const j = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (j && j.at && Date.now() - j.at < CACHE_TTL && j.map) return j.map;
  } catch (e) {}
  return null;
}

function writeCache(map) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ at: Date.now(), map: map }), 'utf8');
  } catch (e) {}
}

function parseAppxList(text) {
  const map = Object.create(null);
  for (const line of String(text || '').split(/\r?\n/)) {
    const i = line.indexOf('\t');
    if (i <= 0) continue;
    const family = line.slice(0, i).trim();
    const dir = line.slice(i + 1).trim();
    if (!family || !dir) continue;
    /* 同一个族可能有多个包（新老版本并存），留最新的那个 */
    if (!map[family] || dir.length >= map[family].length) map[family] = dir;
  }
  return map;
}

/* 一次问全量，157 个包大约 1.8 秒，之后走磁盘缓存（7 天） */
function ensureMap() {
  if (mapMem) return Promise.resolve(mapMem);
  if (mapPending) return mapPending;

  const cached = readCache();
  if (cached && Object.keys(cached).length) {
    mapMem = cached;
    return Promise.resolve(mapMem);
  }

  mapPending = new Promise((resolve) => {
    const cmd = 'Get-AppxPackage | ForEach-Object { $_.PackageFamilyName + [char]9 + $_.InstallLocation }';
    let done = false;
    const finish = (map) => {
      if (done) return;
      done = true;
      mapMem = map;
      mapPending = null;
      if (Object.keys(map).length) writeCache(map);
      resolve(map);
    };
    try {
      execFile('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
        { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024 },
        (err, stdout) => finish(err ? Object.create(null) : parseAppxList(stdout)));
    } catch (e) {
      finish(Object.create(null));
    }
    /* 兜底：万一回调不来，5 秒后先给个空的，别让界面一直等 */
    setTimeout(() => finish(mapMem || Object.create(null)), 8000);
  });
  return mapPending;
}

/* ---------------- 挑徽标 ---------------- */

/* manifest 里一个 logo 属性往往对应一堆变体：
 *   Square44x44Logo.png
 *   Square44x44Logo.scale-200.png
 *   Square44x44Logo.targetsize-256_altform-unplated.png
 * targetsize-N 的 N 就是真实像素，scale-N 大约是 N/100*44，按估算像素取最大的。
 * 同尺寸优先 unplated（不带内置留白，铺得更满）。 */
function variantScore(name) {
  const s = name.toLowerCase();
  const ts = /targetsize-(\d+)/.exec(s);
  const sc = /scale-(\d+)/.exec(s);
  let px = 44;
  if (ts) px = parseInt(ts[1], 10);
  else if (sc) px = Math.round((parseInt(sc[1], 10) / 100) * 44);
  let bonus = 0;
  if (s.indexOf('altform-unplated') >= 0) bonus = 2;
  else if (s.indexOf('altform-lightunplated') >= 0) bonus = 1;
  return px * 10 + bonus;
}

function pickVariant(dir, rel) {
  const abs = path.join(dir, rel);
  const folder = path.dirname(abs);
  const stem = path.basename(abs).replace(/\.(png|jpg|jpeg)$/i, '').toLowerCase();
  let files = [];
  try { files = fs.readdirSync(folder); } catch (e) {
    /* 有些包（VS Code、微信分享组件这类 sparse 包）目录不让列，
     * 但 manifest 里写的就是完整文件名，直接按路径试一下 */
    return fs.existsSync(abs) ? abs : '';
  }
  const cands = files.filter((f) => /\.png$/i.test(f) && f.toLowerCase().startsWith(stem));
  if (!cands.length) return fs.existsSync(abs) ? abs : '';
  cands.sort((a, b) => variantScore(b) - variantScore(a));
  return path.join(folder, cands[0]);
}

function findLogo(dir) {
  let man = '';
  try { man = fs.readFileSync(path.join(dir, 'AppxManifest.xml'), 'utf8'); } catch (e) { return null; }

  const bg = /BackgroundColor\s*=\s*"#([0-9a-fA-F]{6})"/.exec(man);
  const keys = ['Square44x44Logo', 'Square150x150Logo', 'Logo', 'SmallLogo'];

  for (const k of keys) {
    const re = new RegExp(k + '\\s*=\\s*"([^"]+)"', 'gi');
    let m;
    while ((m = re.exec(man))) {
      const rel = m[1];
      if (!rel || /^ms-resource:/i.test(rel)) continue;
      const f = pickVariant(dir, rel.replace(/\//g, '\\'));
      if (f && fs.existsSync(f)) return { file: f, bg: bg ? '#' + bg[1] : '' };
    }
  }
  return null;
}

/* ---------------- 合成磁贴 ---------------- */

function alphaBox(d, w, h, cut) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > cut) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
}

/* 面积平均缩放，边缘不会发黑（先按 alpha 预乘再平均） */
function scaleRgba(src, sw, sh, sx0, sy0, swd, shd, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const fy0 = sy0 + (y * shd) / dh, fy1 = sy0 + ((y + 1) * shd) / dh;
    for (let x = 0; x < dw; x++) {
      const fx0 = sx0 + (x * swd) / dw, fx1 = sx0 + ((x + 1) * swd) / dw;
      let pr = 0, pg = 0, pb = 0, pa = 0, ws = 0;
      const iy0 = Math.floor(fy0), iy1 = Math.ceil(fy1);
      const ix0 = Math.floor(fx0), ix1 = Math.ceil(fx1);
      for (let sy = iy0; sy < iy1; sy++) {
        const cy = Math.min(sh - 1, Math.max(0, sy));
        const wy = Math.min(fy1, sy + 1) - Math.max(fy0, sy);
        if (wy <= 0) continue;
        for (let sx = ix0; sx < ix1; sx++) {
          const cx = Math.min(sw - 1, Math.max(0, sx));
          const wx = Math.min(fx1, sx + 1) - Math.max(fx0, sx);
          if (wx <= 0) continue;
          const wt = wx * wy;
          const o = (cy * sw + cx) * 4;
          const a = src[o + 3];
          pr += src[o] * a * wt;
          pg += src[o + 1] * a * wt;
          pb += src[o + 2] * a * wt;
          pa += a * wt;
          ws += wt;
        }
      }
      if (!ws || !pa) continue;
      const o = (y * dw + x) * 4;
      out[o] = Math.min(255, Math.round(pr / pa));
      out[o + 1] = Math.min(255, Math.round(pg / pa));
      out[o + 2] = Math.min(255, Math.round(pb / pa));
      out[o + 3] = Math.min(255, Math.round(pa / ws));
    }
  }
  return out;
}

function hexRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

/* 底板圆角矩形（用超采样算覆盖率，边上不会有锯齿） */
function roundRectMask(size, radius) {
  const m = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0;
      for (let sy = 0; sy < 3; sy++) {
        for (let sx = 0; sx < 3; sx++) {
          const px = x + (sx + 0.5) / 3, py = y + (sy + 0.5) / 3;
          const cx = Math.min(Math.max(px, radius), size - radius);
          const cy = Math.min(Math.max(py, radius), size - radius);
          const dx = px - cx, dy = py - cy;
          if (dx * dx + dy * dy <= radius * radius) cov++;
        }
      }
      m[y * size + x] = cov / 9;
    }
  }
  return m;
}

let maskCache = null;

function composeTile(srcBuf, bgHex) {
  const img = decodePng(srcBuf);
  if (!img || !img.w || !img.h) return null;

  const box = alphaBox(img.data, img.w, img.h, 20);
  if (!box) return null;

  const S = TILE;
  const round = Math.round(S * 0.22);
  /* 四角里有两个以上不透明，说明这本来就是一张完整方块图（底板画在图里了）。
   * 用多角判定而不是只看左上角，免得边缘有一像素噪声就判错。 */
  const cornerPx = [
    img.data[3],
    img.data[(img.w - 1) * 4 + 3],
    img.data[((img.h - 1) * img.w) * 4 + 3],
    img.data[((img.h - 1) * img.w + img.w - 1) * 4 + 3]
  ];
  const frameOpaque = cornerPx.filter((v) => v > 128).length >= 2;

  /* 判断 logo 是不是「纯白单色」：Windows 的 UWP 徽标大多如此，
   * 必须配一块底板才看得见；彩色徽标则直接透明铺上。 */
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = box.y0; y <= box.y1; y += 2) {
    for (let x = box.x0; x <= box.x1; x += 2) {
      const o = (y * img.w + x) * 4;
      if (img.data[o + 3] > 200) { r += img.data[o]; g += img.data[o + 1]; b += img.data[o + 2]; n++; }
    }
  }
  if (!n) return null;
  r /= n; g /= n; b /= n;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const whiteish = mx > 232 && mx - mn < 26;

  /* 一部分系统组件的徽标就是一张纯白占位方块（四角不透明、整体纯白），
   * 画出来是块白板。这种宁可不给图，让界面退成首字色块，至少看得出来是个什么应用。 */
  if (frameOpaque && whiteish) return null;

  const out = Buffer.alloc(S * S * 4);
  let bg = null;
  if (frameOpaque) {
    /* 自带底板的完整图标：圆角裁一下就行 */
  } else if (whiteish) {
    bg = hexRgb(bgHex) || { r: 47, g: 53, b: 66 };
  }

  if (bg) {
    const mask = maskCache && maskCache.size === S ? maskCache.m : (maskCache = { size: S, m: roundRectMask(S, round) }).m;
    for (let i = 0; i < S * S; i++) {
      const o = i * 4;
      out[o] = bg.r; out[o + 1] = bg.g; out[o + 2] = bg.b;
      out[o + 3] = Math.round(255 * mask[i]);
    }
  }

  /* logo 放在中间：有底板时占 62%，没底板时占 88% */
  const frac = bg ? 0.62 : 0.88;
  const side = Math.round(S * frac);
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const k = Math.min(side / bw, side / bh);
  const dw = Math.max(1, Math.round(bw * k)), dh = Math.max(1, Math.round(bh * k));
  const logo = scaleRgba(img.data, img.w, img.h, box.x0, box.y0, bw, bh, dw, dh);

  const ox = Math.round((S - dw) / 2), oy = Math.round((S - dh) / 2);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const so = (y * dw + x) * 4;
      const a = logo[so + 3] / 255;
      if (a <= 0) continue;
      const tx = ox + x, ty = oy + y;
      if (tx < 0 || ty < 0 || tx >= S || ty >= S) continue;
      const to = (ty * S + tx) * 4;
      out[to] = Math.round(logo[so] * a + out[to] * (1 - a));
      out[to + 1] = Math.round(logo[so + 1] * a + out[to + 1] * (1 - a));
      out[to + 2] = Math.round(logo[so + 2] * a + out[to + 2] * (1 - a));
      out[to + 3] = Math.min(255, Math.round(logo[so + 3] + out[to + 3] * (1 - a)));
    }
  }

  /* 自带底板的完整图：裁圆角 */
  if (frameOpaque) {
    const mask = (maskCache && maskCache.size === S) ? maskCache.m : (maskCache = { size: S, m: roundRectMask(S, round) }).m;
    for (let i = 0; i < S * S; i++) out[i * 4 + 3] = Math.round(out[i * 4 + 3] * mask[i]);
  }

  /* 最后看一眼：成图里得有东西跟底板区分得开，否则就是一张空板子 */
  let visible = 0;
  for (let i = 0; i < S * S; i++) {
    const o = i * 4;
    if (out[o + 3] < 20) continue;
    if (!bg) { visible++; continue; }
    const d = Math.abs(out[o] - bg.r) + Math.abs(out[o + 1] - bg.g) + Math.abs(out[o + 2] - bg.b);
    if (d > 60) visible++;
  }
  if (visible < S * S * 0.02) return null;

  return encPng(S, S, out);
}

/* ---------------- 对外 ---------------- */

function iconDataUrlFromDir(dir) {
  if (!dir) return '';
  const hit = findLogo(dir);
  if (!hit) return '';
  let buf;
  try { buf = fs.readFileSync(hit.file); } catch (e) { return ''; }
  if (buf.slice(1, 4).toString('latin1') !== 'PNG') return '';
  let png = null;
  try { png = composeTile(buf, hit.bg); } catch (e) { png = null; }
  /* 合成出来只有几百字节 = 一整块纯色，等于没图。交给界面的首字色块更好看 */
  if (png && png.length && png.length < 500) return '';
  /* 合成不出来也别空手：原图至少能显示（白 logo 在浅底上确实淡，但比方块强） */
  if (!png || !png.length) png = buf;
  return 'data:image/png;base64,' + png.toString('base64');
}

/* 同步版：只有命中缓存才有结果，用来在 await 之前先抢一次 */
function msixIconSync(file) {
  const info = lnkMsix(file);
  if (!info) return '';
  if (info.dir && fs.existsSync(info.dir)) return iconDataUrlFromDir(info.dir);
  if (mapMem && mapMem[info.family]) return iconDataUrlFromDir(mapMem[info.family]);
  return '';
}

async function msixIcon(file) {
  const info = lnkMsix(file);
  if (!info) return '';
  if (info.dir && fs.existsSync(info.dir)) return iconDataUrlFromDir(info.dir);
  const map = await ensureMap();
  const dir = map[info.family];
  if (!dir) return '';
  return iconDataUrlFromDir(dir);
}

module.exports = { lnkMsix, ensureMap, msixIcon, msixIconSync, iconDataUrlFromDir };
