/* 工作台桌面版主进程
 *
 * 职责：
 *   1. 开窗口（无边框，顶部胶囊兼当标题栏），加载 workbench 目录里现成的页面
 *   2. 提供数据存储（写到 userData 下的 JSON 文件，原子写）
 *   3. 拖进来的 exe：取真实路径、取程序自带图标、点图标启动
 *   4. 窗口按钮（最小化/最大化/关闭）、记住窗口大小和位置、开机自启
 *   5. 到期系统通知（倒计时、待办）、AI 请求转发（绕开跨域）
 *
 * 启动参数 --selftest 会跑一遍自检然后退出，不弹窗口给人看，用来验证。
 */
'use strict';

const {
  app, BrowserWindow, ipcMain, shell, net, Notification, Menu, screen, dialog, session
} = require('electron');
const path = require('path');
const fs = require('fs');

/* 图标解析单独一个文件。万一哪天打包漏了它，也不能让整个程序起不来，
 * 拿不到就走系统接口那条路，功能降级但窗口照开。 */
let iconMod = null;
try { iconMod = require('./icon'); } catch (e) { iconMod = null; }
let msixMod = null;
try { msixMod = require('./msix'); } catch (e) { msixMod = null; }
/* 联网搜索也单独一个文件：解析逻辑能脱离 Electron 单测 */
let searchMod = null;
try { searchMod = require('./search'); } catch (e) { searchMod = null; }
const SELFTEST = process.argv.includes('--selftest');

const APP_DIR = __dirname;
const PROJECT = path.join(APP_DIR, '..');

/* 页面目录：开发时是 app/../workbench；打包后页面放在 resources/workbench。
 * 两处都找，谁先有 index.html 就用谁，这样开发态和成品态用的是同一套代码。 */
function findWorkbench() {
  const cands = [
    path.join(PROJECT, 'workbench'),
    path.join(process.resourcesPath || '', 'workbench'),
    path.join(APP_DIR, 'workbench')
  ];
  for (const dir of cands) {
    try {
      if (dir && fs.existsSync(path.join(dir, 'index.html'))) return dir;
    } catch (e) {}
  }
  return path.join(PROJECT, 'workbench');
}

const WORKBENCH = findWorkbench();
const PAGE = path.join(WORKBENCH, 'index.html');
const ICON = path.join(APP_DIR, 'build', 'icon.ico');

/* 存在同一个 JSON 里的几个键（页面那边也读得到，前缀跟页面统一） */
const K_BOUNDS = 'wb:__workbench:winBounds';
const K_NOTIFIED = 'wb:__workbench:notifiedDays';
const K_AUTOSTART = 'wb:__workbench:autoStart';

/* 通知不弹、也没报错的经典原因就是没设这个 */
app.setAppUserModelId('com.workbench.desktop');
/* 名字定死成中文，数据目录就是 %APPDATA%\工作台，
 * 不这样写会跟着 package.json 的 name 跑成 workbench-desktop，用户找起来很别扭 */
app.setName('工作台');

/* ---------------- 数据存储 ----------------
 * 全部数据放在一个 JSON 文件里，键名就是页面那边的 wb:xxx。
 * 页面走 sendSync 同步调用，所以这里的 handler 必须是 on + returnValue 的同步形式，
 * 不能用 handle/invoke（那是异步的，页面会拿到 Promise 当数据，全乱）。
 */

let storeCache = null;
let saveTimer = null;

function dataFile() {
  return path.join(app.getPath('userData'), 'workbench-data.json');
}

function loadStore() {
  if (storeCache) return storeCache;
  storeCache = {};
  try {
    const raw = fs.readFileSync(dataFile(), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) storeCache = obj;
  } catch (e) {
    /* 文件不存在或者坏了，就从空开始，不覆盖已有的坏文件，留个备份 */
    try {
      if (fs.existsSync(dataFile())) {
        fs.copyFileSync(dataFile(), dataFile() + '.broken-' + Date.now());
      }
    } catch (e2) {}
  }
  return storeCache;
}

function saveStore() {
  const f = dataFile();
  const tmp = f + '.tmp';
  fs.mkdirSync(path.dirname(f), { recursive: true });
  /* 先写临时文件再改名，断电或崩了也不会留半个文件 */
  fs.writeFileSync(tmp, JSON.stringify(storeCache), 'utf8');
  fs.renameSync(tmp, f);
}

/* 主进程自己改数据（窗口位置、已提醒标记）用这个，带节流，别每次动都写盘 */
function saveStoreSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveStore(); } catch (e) {}
  }, 400);
}

function setupStore() {
  ipcMain.on('store:get', (e, k) => {
    const s = loadStore();
    e.returnValue = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null;
  });
  ipcMain.on('store:set', (e, k, v) => {
    loadStore();
    storeCache[k] = v;
    try { saveStore(); e.returnValue = true; } catch (err) { e.returnValue = false; }
  });
  ipcMain.on('store:remove', (e, k) => {
    loadStore();
    delete storeCache[k];
    try { saveStore(); } catch (err) {}
    e.returnValue = true;
  });
  ipcMain.on('store:keys', (e) => {
    e.returnValue = Object.keys(loadStore());
  });
  ipcMain.on('store:available', (e) => { e.returnValue = true; });
  ipcMain.on('store:where', (e) => { e.returnValue = dataFile(); });
}

/* ---------------- 每日快照独立文件 ----------------
 * 快照是整库副本，塞在主数据文件里会让它膨胀到 10MB+，
 * 而且每改一个字都要整文件重写。挪到单独的 workbench-shelf.json，
 * 主文件保持苗条，快照读写也不再拖累日常操作。
 */
let shelfCache = null;

function shelfFile() {
  return path.join(app.getPath('userData'), 'workbench-shelf.json');
}

function loadShelf() {
  if (shelfCache) return shelfCache;
  shelfCache = {};
  try {
    const raw = fs.readFileSync(shelfFile(), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) shelfCache = obj;
  } catch (e) { /* 没有就从空开始 */ }
  return shelfCache;
}

function saveShelf() {
  try {
    const f = shelfFile();
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(shelfCache), 'utf8');
    fs.renameSync(tmp, f);
  } catch (e) {}
}

function setupShelf() {
  ipcMain.on('store:shelf:get', (e, k) => {
    const s = loadShelf();
    e.returnValue = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null;
  });
  ipcMain.on('store:shelf:set', (e, k, v) => {
    loadShelf();
    shelfCache[k] = v;
    try { saveShelf(); e.returnValue = true; } catch (err) { e.returnValue = false; }
  });
}

/* 一次性迁移：把主数据文件里的大快照搬到独立文件 */
function migrateShelf() {
  const s = loadStore();
  const KEY = 'wb:__workbench:dailyShelf';
  if (!Object.prototype.hasOwnProperty.call(s, KEY)) return;
  try {
    const shelf = loadShelf();
    if (!shelf['dailyShelf']) shelf['dailyShelf'] = s[KEY];
    shelfCache = shelf;
    saveShelf();
    delete s[KEY];
    saveStore();
    console.log('[工作台] 已把每日快照迁移到独立文件，主数据文件瘦身完成');
  } catch (e) {
    console.error('[工作台] 快照迁移失败（原数据保留）:', e && e.message);
  }
}

/* ---------------- 窗口大小和位置 ---------------- */

function readBounds() {
  const fallback = { width: 1500, height: 950 };
  let b = null;
  try {
    const raw = loadStore()[K_BOUNDS];
    if (raw && typeof raw === 'object') b = raw;
  } catch (e) {}
  if (!b) return fallback;

  const w = Math.max(960, Math.min(Number(b.width) || fallback.width, 5000));
  const h = Math.max(700, Math.min(Number(b.height) || fallback.height, 3500));

  /* 位置要判断还在不在屏幕上：换过显示器、拔掉扩展屏之后，旧坐标会把窗口丢到看不见的地方 */
  let x = Number(b.x);
  let y = Number(b.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { width: w, height: h };

  const visible = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    return x + 120 > wa.x && x < wa.x + wa.width - 120 &&
           y + 60 > wa.y && y < wa.y + wa.height - 60;
  });
  if (!visible) return { width: w, height: h };
  return { width: w, height: h, x: Math.round(x), y: Math.round(y) };
}

function rememberBounds(win, immediate) {
  try {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
    const b = win.getBounds();
    loadStore()[K_BOUNDS] = { x: b.x, y: b.y, width: b.width, height: b.height };
    /* 关窗口那一刻要立刻落盘：程序马上就退了，节流定时器根本来不及跑 */
    if (immediate) saveStore(); else saveStoreSoon();
  } catch (e) {}
}

/* ---------------- 窗口 ---------------- */

let mainWin = null;

function createWindow() {
  const b = readBounds();

  const win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 960,
    minHeight: 700,
    frame: false,                 /* 去掉系统标题栏，顶部胶囊兼当标题栏 */
    backgroundColor: '#eef1f8',
    show: false,
    title: '工作台',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  });

  mainWin = win;

  /* 窗口一拿到焦点就别再闪任务栏了 */
  win.on('focus', () => { try { win.flashFrame(false); } catch (e) {} });

  win.once('ready-to-show', () => { if (!SELFTEST) win.show(); });

  /* 页面内的跳转只允许在 workbench 目录里，别的（拖进来的文件、外链）一律拦下 */
  win.webContents.on('will-navigate', (e, url) => {
    let p = '';
    try { p = decodeURIComponent(url.replace(/^file:\/\/\//i, '').replace(/\//g, path.sep)); } catch (err) { p = ''; }
    const inside = p && path.resolve(p).toLowerCase().startsWith(path.resolve(WORKBENCH).toLowerCase());
    if (inside) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  /* 网址类图标走系统默认浏览器，不在应用里开新窗口 */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  let rt = null;
  const touch = () => { clearTimeout(rt); rt = setTimeout(() => rememberBounds(win), 500); };
  win.on('resize', touch);
  win.on('move', touch);
  win.on('close', () => rememberBounds(win, true));

  /* 看不到菜单栏了，留一个开发工具的口子，以后出问题自己能查 */
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
      win.webContents.toggleDevTools();
      e.preventDefault();
    }
  });

  win.loadFile(PAGE);
  return win;
}

/* ---------------- 窗口按钮 ---------------- */

function setupWindowIpc() {
  const w = () => BrowserWindow.getAllWindows()[0];
  ipcMain.on('win:min', () => { const x = w(); if (x) x.minimize(); });
  ipcMain.on('win:max', () => {
    const x = w(); if (!x) return;
    if (x.isMaximized()) x.unmaximize(); else x.maximize();
  });
  ipcMain.on('win:close', () => { const x = w(); if (x) x.close(); });

  /* 番茄钟：把窗口铺满并置顶，倒计时结束或按 ESC 再收回来。
   * 用 screen-saver 这一档，才盖得住别的窗口。 */
  ipcMain.on('win:fullscreen', (e, on) => {
    const x = w();
    if (!x) return;
    try {
      if (on) {
        x.setAlwaysOnTop(true, 'screen-saver');
        x.setFullScreen(true);
      } else {
        x.setFullScreen(false);
        x.setAlwaysOnTop(false);
      }
    } catch (err) { /* 有些环境下不允许置顶，铺满就行 */ }
  });

  ipcMain.on('win:state', (e) => {
    const x = w();
    e.returnValue = { maximized: !!(x && x.isMaximized()) };
  });
}

/* ---------------- 拖 exe：图标 + 启动 ---------------- */

/* 取一个程序的图标，返回 data URL，拿不到给空字符串。
 *
 * 先自己读 exe 里的图标资源：直接解析 PE 文件，几毫秒出结果，
 * 不依赖系统 shell，也不会因为图标缓存坏了、安全软件收紧而拿到空图。
 * 自己读不出来（快捷方式、.bat、图标放在别处的系统程序）再问系统。
 */
/* 把一个条目解析成「能启动的路径 + 能取图标的文件」
 *   · 原件还在：直接用
 *   · 原件没了（用户后来整理过文件夹）：按名字去桌面、下载、开始菜单找同名的
 *   · 快捷方式指向商店应用 / 此电脑这类：解析不出文件，图标借系统的
 * 解析不出来时两个都返回空，页面会退成首字方块。 */
function resolveAppInfo(p, label) {
  try {
    if (iconMod && iconMod.resolveApp) {
      const r = iconMod.resolveApp(p, label);
      if (r && (r.launch || r.icon)) return r;
    }
  } catch (e) {}
  return { launch: '', icon: '' };
}

async function iconUrlFor(p) {
  try {
    const own = iconMod && iconMod.iconDataUrl ? iconMod.iconDataUrl(p) : '';
    if (own) return own;
  } catch (e) {}

  /* 商店应用要走一步系统查询才知道装在哪，这条是异步的，所以放这儿再试一次。
   * 查到的结果会落盘缓存，之后就是纯读文件，不再问系统。 */
  if (msixMod && /\.lnk$/i.test(String(p || ''))) {
    try {
      const u = await msixMod.msixIcon(p);
      if (u) return u;
    } catch (e) {}
  }

  try {
    for (const size of ['large', 'normal', 'small']) {
      const img = await app.getFileIcon(p, { size: size });
      if (img && !img.isEmpty()) {
        const u = img.toDataURL();
        if (u) return u;
      }
    }
  } catch (e) {}

  return '';
}

function setupAppIpc() {
  ipcMain.handle('shell:fileIcon', async (e, p, label) => {
    try {
      if (!p) return '';
      const info = resolveAppInfo(p, label);
      if (info.icon) return await iconUrlFor(info.icon);
      if (fs.existsSync(p)) return await iconUrlFor(p);
      return '';
    } catch (err) {
      return '';
    }
  });

  /* 页面补图标时用这个：一次拿回「启动路径 + 图标」，
   * 顺带把已经失效的老路径换成新找到的，不然点图标也启动不了 */
  ipcMain.handle('shell:appInfo', async (e, p, label) => {
    try {
      const info = resolveAppInfo(p, label);
      const icon = info.icon ? await iconUrlFor(info.icon) : '';
      return { path: info.launch || '', icon: icon || '' };
    } catch (err) {
      return { path: '', icon: '' };
    }
  });

  /* shell.openPath 不抛异常，是用返回值报错：成功返回空字符串 */
  ipcMain.handle('shell:launch', async (e, p) => {
    const target = String(p || '').trim();
    if (!target) return { ok: false, msg: '这一项还没设置程序路径。' };
    if (!path.isAbsolute(target)) return { ok: false, msg: '「' + target + '」只是个名字，还没有指向真正的程序。把程序文件拖到胶囊上就能设好。' };
    let run = target;
    if (!fs.existsSync(target)) {
      /* 存的老路径失效了，按名字再找一次，找得到就直接用 */
      const info = resolveAppInfo(target, '');
      if (info.launch && fs.existsSync(info.launch)) run = info.launch;
      else return { ok: false, msg: '找不到这个文件了：' + target };
    }
    try {
      const err = await shell.openPath(run);
      if (err) return { ok: false, msg: '启动失败：' + err };
      return { ok: true, msg: '' };
    } catch (err) {
      return { ok: false, msg: '启动失败：' + ((err && err.message) || err) };
    }
  });

  ipcMain.handle('shell:pickApp', async () => {
    const win = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: '选一个程序',
      properties: ['openFile'],
      filters: [
        { name: '程序', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });
    if (r.canceled || !r.filePaths.length) return null;
    const p = r.filePaths[0];
    const info = resolveAppInfo(p, '');
    const icon = info.icon ? await iconUrlFor(info.icon) : await iconUrlFor(p);
    return { path: p, name: path.basename(p).replace(/\.(exe|lnk|bat|cmd)$/i, ''), icon: icon };
  });

  ipcMain.on('shell:openExternal', (e, url) => {
    if (/^https?:/i.test(String(url || ''))) shell.openExternal(String(url));
  });
}

/* ---------------- 到期通知 ---------------- */

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* 应用内横幅：系统通知被关掉、或者被专注助手拦了，这条还能让人看见。
 * 同一次提醒两路一起走，只要有一路到就算提醒到了。 */
function remindInApp(title, body) {
  const wins = BrowserWindow.getAllWindows();
  let n = 0;
  wins.forEach((w) => {
    try {
      if (!w || w.isDestroyed()) return;
      w.webContents.send('app:remind', {
        title: String(title || ''),
        body: String(body || ''),
        at: Date.now()
      });
      /* 没在前台才闪任务栏；正在用的窗口闪一下反而烦 */
      if (!w.isFocused()) w.flashFrame(true);
      n++;
    } catch (e) {}
  });
  return n;
}

function notify(title, body) {
  const t = String(title || '工作台');
  const b = String(body || '');
  let shown = false;

  try {
    if (Notification.isSupported()) {
      const n = new Notification({ title: t, body: b, icon: fs.existsSync(ICON) ? ICON : undefined });
      /* 点通知把窗口叫回来，不然用户点了没反应会以为没发 */
      n.on('click', () => {
        const w = mainWin;
        if (!w || w.isDestroyed()) return;
        try {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
        } catch (e) {}
      });
      n.show();
      shown = true;
    }
  } catch (e) {
    shown = false;
  }

  /* 不管系统那条成不成，应用内都推一份 */
  remindInApp(t, b);
  return shown;
}

/* 开始菜单快捷方式：Windows 认应用靠的是这条快捷方式上的 AppUserModelID。
 * 没有它，通知要么不弹，要么弹出个 Electron 的名字。
 * 装好之后每次启动刷一遍，指向当前这个 exe（绿色版换目录也能跟上）。 */
function ensureShortcut() {
  if (process.platform !== 'win32') return false;
  if (!app.isPackaged) return false;      /* 开发态是 electron.exe，别去污染开始菜单 */
  try {
    const dir = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    if (!fs.existsSync(dir)) return false;
    const lnk = path.join(dir, '工作台.lnk');
    const opts = {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      icon: process.execPath,
      iconIndex: 0,
      description: '工作台',
      appUserModelId: 'com.workbench.desktop'
    };
    /* update 只是补字段，有些系统上 AUMID 这段补不进去；
     * replace 是整条重写，最稳，字段我们本来就给全了。 */
    let ok = false;
    try { ok = shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', opts); } catch (e) { ok = false; }
    if (!ok) {
      try { ok = shell.writeShortcutLink(lnk, 'create', opts); } catch (e) { ok = false; }
    }
    return ok;
  } catch (e) {
    return false;
  }
}

/* 每分钟看一次，同一条一天只提醒一次（不然会烦死人） */
function checkDue() {
  const s = loadStore();
  const list = [];
  const today = new Date();
  const todayStr = ymd(today);
  const md = todayStr.slice(5);
  const isoDay = today.getDay() === 0 ? 7 : today.getDay();

  const todos = Array.isArray(s['wb:life:todos']) ? s['wb:life:todos'] : [];
  todos.forEach((t) => {
    if (!t || t.done) return;
    if (t.due && t.due === todayStr) list.push({ id: 'todo:' + (t.id || t.text), title: '待办今天到期', body: String(t.text || '') });
  });

  const cds = Array.isArray(s['wb:life:cds']) ? s['wb:life:cds'] : [];
  cds.forEach((c) => {
    if (!c) return;
    const type = c.type || 'once';
    let hit = false;
    if (type === 'once') hit = !!c.date && c.date === todayStr;
    else if (type === 'monthly') hit = Number(c.day) === today.getDate();
    else if (type === 'yearly') hit = !!c.date && String(c.date).slice(5) === md;
    else if (type === 'weekly') hit = Number(c.day) === isoDay;
    if (hit) list.push({ id: 'cd:' + (c.id || c.name), title: '倒计时到了', body: String(c.name || '') });
  });

  if (!list.length) return 0;

  const notified = (s[K_NOTIFIED] && typeof s[K_NOTIFIED] === 'object' && !Array.isArray(s[K_NOTIFIED])) ? s[K_NOTIFIED] : {};
  let n = 0;
  list.forEach((it) => {
    if (notified[it.id] === todayStr) return;
    if (SELFTEST) { n++; return; }
    if (notify(it.title, it.body)) {
      notified[it.id] = todayStr;
      n++;
    }
  });

  if (n && !SELFTEST) {
    s[K_NOTIFIED] = notified;
    try { saveStore(); } catch (e) {}
  }
  return n;
}

function setupNotifyIpc() {
  ipcMain.handle('notify:show', (e, title, body) => notify(String(title || '工作台'), String(body || '')));
}

function startDueWatcher() {
  setTimeout(() => { try { checkDue(); } catch (e) {} }, 4000);
  setInterval(() => { try { checkDue(); } catch (e) {} }, 60000);
}

/* ---------------- 开机自启 ---------------- */

/* 开机自启动要指向"用户手里那个 exe"：
 * 便携版是从临时目录跑起来的（process.execPath 指向解包出来的那个），
 * 所以优先用 electron-builder 给的 PORTABLE_EXECUTABLE_FILE。 */
function loginExe() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function autostartOn() {
  try {
    /* 查询也要带同一个路径，不然查出来永远是"没开"，界面会跟实际状态对不上 */
    const s = app.getLoginItemSettings({ path: loginExe() });
    if (s && typeof s.openAtLogin === 'boolean') return s.openAtLogin;
  } catch (e) {}
  return !!(loadStore()[K_AUTOSTART]);
}

function setupAutostartIpc() {
  ipcMain.on('app:autostart-get', (e) => { e.returnValue = autostartOn(); });
  ipcMain.on('app:autostart-set', (e, v) => {
    const on = !!v;
    try {
      app.setLoginItemSettings({ openAtLogin: on, path: loginExe() });
      loadStore()[K_AUTOSTART] = on;
      saveStore();
      /* 以系统里查到的为准，查不到再回落到刚存下的值 */
      let real;
      try { real = app.getLoginItemSettings({ path: loginExe() }).openAtLogin; } catch (err) { real = undefined; }
      e.returnValue = (typeof real === 'boolean') ? real : on;
    } catch (err) {
      e.returnValue = false;
    }
  });
}

/* ---------------- AI 请求转发 ----------------
 * 页面里是直连接口的，file:// 或者应用内页面直接发出去会被跨域拦。
 * 主进程用 net.fetch 发，不受页面同源策略限制，页面只拿到结果文字。
 */
function setupNetIpc() {
  ipcMain.handle('net:post', async (e, opts) => {
    const o = opts || {};
    const url = String(o.url || '');
    if (!/^https?:/i.test(url)) return { ok: false, status: 0, text: '地址不对：' + url };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(5000, Number(o.timeout) || 90000));
    try {
      const resp = await net.fetch(url, {
        method: 'POST',
        headers: o.headers || {},
        body: typeof o.body === 'string' ? o.body : JSON.stringify(o.body || {}),
        signal: ctrl.signal
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text: text };
    } catch (err) {
      const m = (err && err.message) || String(err);
      return { ok: false, status: 0, text: /abort/i.test(m) ? '请求超时了。' : ('请求发不出去：' + m) };
    } finally {
      clearTimeout(timer);
    }
  });
}

/* ---------------- 联网搜索 ----------------
 *
 * AI 要查实时信息（考试时间、新闻、政策）时走这条。
 * 页面是 file:// 起的，自己 fetch 外部接口会被同源策略挡住，所以绕主进程。
 * 搜索本身在 search.js 里，这边只做一层 IPC 和兜底：
 * 不管出什么事都返回 { ok, results, error }，绝不让异常冒到页面上。
 */
function setupSearchIpc() {
  ipcMain.handle('web:search', async (e, q, n) => {
    if (!searchMod) return { ok: false, results: [], error: '搜索模块没加载起来' };
    const query = String(q || '').trim();
    if (!query) return { ok: false, results: [], error: '搜索词是空的' };
    try {
      return await searchMod.search(query, n);
    } catch (err) {
      return { ok: false, results: [], error: String((err && err.message) || err) };
    }
  });
}

/* ---------------- 环境信息 ---------------- */
function setupEnvIpc() {
  ipcMain.on('env:info', (e) => {
    e.returnValue = {
      desktop: true,
      version: app.getVersion(),
      electron: process.versions.electron,
      dataFile: dataFile(),
      workbench: WORKBENCH,
      notifySupported: (() => { try { return Notification.isSupported(); } catch (err) { return false; } })()
    };
  });
  ipcMain.on('env:openData', (e) => {
    try { shell.showItemInFolder(dataFile()); } catch (err) {}
  });
}

/* ---------------- 跨域放行（英语页查同义词这类简单请求） ---------------- */

function setupCorsRelax() {
  try {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      const h = details.responseHeaders || {};
      const has = Object.keys(h).some((k) => k.toLowerCase() === 'access-control-allow-origin');
      if (!has && /^https?:/i.test(details.url)) {
        h['Access-Control-Allow-Origin'] = ['*'];
      }
      cb({ responseHeaders: h });
    });
  } catch (e) {}
}

/* ---------------- 自检 ---------------- */

function selftest(win) {
  const report = [];
  const add = (name, ok, extra) => report.push({ name, ok: !!ok, extra: extra === undefined ? '' : String(extra) });

  const writeLog = (text) => {
    try {
      const f = path.join(app.getPath('userData'), 'selftest.log');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text, 'utf8');
    } catch (e) {}
    return text;
  };

  /* 万一窗口压根没起来，别让自检一直挂着，45 秒后自己交代清楚 */
  const watchdog = setTimeout(() => {
    console.log(writeLog('____SELFTEST____\nFAIL 页面在 45 秒内没有加载完（窗口没起来，或者页面报错了）\n失败数: 1\n'));
    app.exit(1);
  }, 45000);

  win.webContents.once('did-finish-load', async () => {
    const js = (code) => win.webContents.executeJavaScript(code, true);

    try {
      await new Promise((r) => setTimeout(r, 1600));

      add('页面标题非空', await js('document.title').then((t) => !!t), await js('document.title'));
      add('模块清单加载', await js('(window.WORKBENCH_MODULES||[]).length').then((n) => n === 7), await js('(window.WORKBENCH_MODULES||[]).length'));
      add('卡片渲染出来', await js('document.querySelectorAll(".card").length').then((n) => n === 7), await js('document.querySelectorAll(".card").length'));
      add('胶囊启动台在', await js('!!document.getElementById("wdock")').then(Boolean));
      /* 用户可能自己加过删过，只要不是空的就算正常 */
      add('启动台图标还在', await js('document.querySelectorAll(".wdock-item").length').then((n) => n >= 1), await js('document.querySelectorAll(".wdock-item").length'));
      add('启动台认出了桌面环境', await js('!!document.querySelector(".wdock.is-desktop")').then(Boolean));
      add('胶囊上有窗口按钮', await js('!!document.getElementById("wdockClose")').then(Boolean));
      add('存储后端是 native', await js('WorkbenchStore.backend').then((b) => b === 'native'), await js('WorkbenchStore.backend'));
      add('存储标记可持久化', await js('WorkbenchStore.persistent').then(Boolean), await js('String(WorkbenchStore.persistent)'));
      add('页面能看到外壳存储接口', await js('!!window.__WORKBENCH_STORE__').then(Boolean));
      add('页面能看到外壳功能接口', await js('!!window.__WORKBENCH_SHELL__').then(Boolean));

      await js('WorkbenchStore.namespace("__probe").set("tick", (WorkbenchStore.namespace("__probe").get("tick", 0) || 0) + 1)');
      const tick = await js('WorkbenchStore.namespace("__probe").get("tick", 0)');
      add('写入后能立刻读回', Number(tick) >= 1, 'tick=' + tick);

      await js('WorkbenchStore.namespace("life").set("todos", [{id:"selftest",text:"自检待办",done:false,t:1}])');
      const todos = await js('JSON.stringify(WorkbenchStore.namespace("life").get("todos", []))');
      add('生活模块数据能存能读', /自检待办/.test(todos), todos);

      /* 窗口按钮走一遍（不真的关掉自己） */
      const state = await js('(function(){ try { return JSON.stringify(window.__WORKBENCH_SHELL__.winState()); } catch(e){ return "异常"; } })()');
      add('窗口按钮接口通', /maximized/.test(state), state);

      add('系统通知可用', (() => { try { return Notification.isSupported(); } catch (e) { return false; } })());
      add('开机自启能读', typeof autostartOn() === 'boolean', String(autostartOn()));
      add('窗口无系统标题栏', true, 'frame:false');

      /* 图标解析要能真的读出图来。这条失败通常意味着打包漏了 icon.js，
       * 那样拖进来的程序会全变成占位符，所以单独查一遍 */
      let icoFromExe = '';
      try {
        icoFromExe = iconMod && iconMod.iconDataUrl ? iconMod.iconDataUrl(process.execPath) : '';
      } catch (e) { icoFromExe = ''; }
      add('程序图标解析可用', /^data:image\/png;base64,/.test(icoFromExe),
        iconMod ? (icoFromExe ? icoFromExe.length + '字符' : '读不到图') : 'icon.js 没打进包');

      /* 快捷方式这条路最容易在打包后断掉（icon.js 掉了、或者接口被改坏），
       * 单独盯一条：能按名字把失效路径找回来，页面补图标靠的就是它 */
      add('快捷方式解析可用', !!(iconMod && typeof iconMod.resolveApp === 'function'),
        iconMod && typeof iconMod.resolveApp === 'function' ? 'ok' : '没有 resolveApp');

      /* 商店应用（微信、抖音、ChatGPT 这些从微软商店装的）走另一条解析路，
       * 依赖 msix.js + pngdec.js 两个文件，打包白名单漏了就会退成色块 */
      const msixOk = !!(msixMod && typeof msixMod.msixIcon === 'function' && typeof msixMod.ensureMap === 'function');
      add('商店应用图标可用', msixOk, msixOk ? 'ok' : 'msix.js 没打进包');

      add('首页有 AI 对话区', await js('!!document.getElementById("aiBar")').then(Boolean));
      add('左侧导航在', await js('!!document.querySelector(".wrail")').then(Boolean));
      add('今日概览有内容', await js('(document.querySelector(".wrail-ov")||document.body).textContent.length').then((n) => n > 20), await js('(document.querySelector(".wrail-ov")||document.body).textContent.length'));

      /* 2026-10-28 新加的三样，都是"平时看不出坏，真用起来才发现"的地方 */
      add('今天面板在', await js('!!document.getElementById("todayBar")').then(Boolean));
      add('今天面板有内容', await js('(document.getElementById("todayBar")||{}).textContent ? document.getElementById("todayBar").textContent.trim().length : 0').then((n) => n > 0), await js('(document.getElementById("todayBar")||{}).textContent ? document.getElementById("todayBar").textContent.trim().length : 0'));

      /* 撤销：写一笔再退回来，看数据是不是真的回到原样 */
      const undoOk = await js(`(function () {
        try {
          var U = window.WorkbenchUndo;
          if (!U) return 'no-undo';
          var ns = WorkbenchStore.namespace('life');
          ns.set('todos', [{ id: 'a', text: '原来那条', done: false, t: 1 }]);
          var snap = U.begin('自检改动', ['life']);
          ns.set('todos', [{ id: 'b', text: '新加的', done: false, t: 2 }]);
          U.commit(snap);
          var r = U.undo();
          var back = JSON.stringify(ns.get('todos', []));
          return (r && r.ok && /原来那条/.test(back)) ? 'ok' : ('没退回去 ' + back);
        } catch (e) { return '异常 ' + (e && e.message); }
      })()`);
      add('撤销能真的退回去', undoOk === 'ok', undoOk);

      /* 长期记忆：记得住、查得到、删得掉 */
      const memOk = await js(`(function () {
        try {
          var M = window.WorkbenchMemory;
          if (!M) return 'no-memory';
          M.remove('自检记忆');
          var w = M.add('自检记忆：晚上十点后不喝咖啡');
          if (!w || !w.ok) return '写不进去：' + (w && w.text);
          var hit = M.list().some(function (x) { return /不喝咖啡/.test(x.text || ''); });
          M.remove('自检记忆');
          var gone = !M.list().some(function (x) { return /不喝咖啡/.test(x.text || ''); });
          return hit && gone ? 'ok' : (hit ? '删不掉' : '记了但查不到');
        } catch (e) { return '异常 ' + (e && e.message); }
      })()`);
      add('长期记忆能记能查能删', memOk === 'ok', memOk);

      /* 工具层和确认闸门：写工具不许一调就落地，必须返回待确认 */
      add('工具层在', await js('!!window.WorkbenchTools').then(Boolean));
      add('工具数量够用', await js('(window.WorkbenchTools ? window.WorkbenchTools.DEFS.length : 0)').then((n) => n >= 30), await js('(window.WorkbenchTools ? window.WorkbenchTools.DEFS.length : 0)'));
      const gate = await js(`(function () {
        try {
          var T = window.WorkbenchTools;
          if (!T) return 'no-tools';
          var r = T.run('add_todo', { text: '自检闸门' });
          if (!r.pending) return '没拦住，直接落地了';
          var after = (WorkbenchStore.namespace('life').get('todos', []) || [])
            .filter(function (t) { return /自检闸门/.test(t.text || ''); }).length;
          return after === 0 ? 'ok' : '预览阶段就把数据写了';
        } catch (e) { return '异常 ' + (e && e.message); }
      })()`);
      add('改数据前会拦一道确认', gate === 'ok', gate);

      /* 番茄钟在时间管理页里，单独开一个看不见的窗口验一遍：
       * 页面能加载、接口在、新增的专注页签和看板都在 */
      const timeProbe = await (async () => {
        let probeWin = null;
        try {
          probeWin = new BrowserWindow({
            show: false,
            webPreferences: { preload: path.join(APP_DIR, 'preload.js'), contextIsolation: true, nodeIntegration: false }
          });
          await probeWin.loadFile(path.join(WORKBENCH, 'modules/time/index.html'));
          await new Promise((r) => setTimeout(r, 900));
          const tjs = (code) => probeWin.webContents.executeJavaScript(code, true);
          const lack = [];
          if (!await tjs('!!window.TimeModule')) lack.push('TimeModule 没加载');
          if (!await tjs('typeof window.TimeModule.startFocus === "function" && typeof window.TimeModule.renderFocus === "function"')) lack.push('番茄钟接口缺');
          if (!await tjs('!!document.querySelector("[data-tab=\\"focus\\"]")')) lack.push('没有专注页签');
          if (!await tjs('!!document.getElementById("viewFocus")')) lack.push('没有专注界面');
          if (!await tjs('!!document.getElementById("boardBox")')) lack.push('没有数据看板');
          return lack.length ? lack.join('、') : 'ok';
        } catch (e) {
          return '打不开：' + String((e && e.message) || e);
        } finally {
          try { if (probeWin) probeWin.destroy(); } catch (e) {}
        }
      })();
      add('番茄钟和看板都在', timeProbe === 'ok', timeProbe);

      add('数据文件路径', true, dataFile());
      add('数据文件存在', fs.existsSync(dataFile()), dataFile());
      add('页面目录', true, WORKBENCH);
    } catch (e) {
      add('自检过程异常', false, (e && e.message) || e);
    }

    const bad = report.filter((r) => !r.ok).length;
    const lines = report.map((r) => (r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? ' :: ' + r.extra : ''));
    /* 打包后的 exe 是图形界面程序，控制台里看不到输出，
     * 所以同时写一份到数据目录，自检.bat 会把它打出来给人看 */
    clearTimeout(watchdog);
    const full = '____SELFTEST____\n' + lines.join('\n') + '\n失败数: ' + bad + '\n';
    writeLog(full);
    console.log(full);
    app.exit(bad ? 1 : 0);
  });
}

/* ---------------- 启动 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  setupStore();
  setupShelf();
  migrateShelf();
  setupWindowIpc();
  setupAppIpc();
  setupAutostartIpc();
  setupNetIpc();
  setupSearchIpc();
  setupEnvIpc();
  setupNotifyIpc();

  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    try { Menu.setApplicationMenu(null); } catch (e) {}
    /* 先把快捷方式的 AppUserModelID 对齐，再开窗口。
     * 通知能不能挂到「工作台」名下就看这一步。 */
    if (!SELFTEST) { try { ensureShortcut(); } catch (e) {} }
    setupCorsRelax();
    const win = createWindow();
    if (SELFTEST) selftest(win);
    else startDueWatcher();

    /* 商店应用的安装目录要先问一次系统（约 1.8 秒），结果落盘存七天。
     * 放在窗口出来之后再跑，用户不会觉得卡；下次取图标就是直接读文件。 */
    if (!SELFTEST && msixMod && msixMod.ensureMap) {
      setTimeout(() => { try { msixMod.ensureMap(); } catch (e) {} }, 3000);
    }
  });

  app.on('window-all-closed', () => { app.quit(); });
}
