/* 预加载：把外壳能力递给页面
 *
 * 两套接口：
 *
 * 1. window.__WORKBENCH_STORE__ —— 存储
 *    页面那边 store.js 会先找它，找到就用它当存储后端。
 *    它要求的接口是 get / set / remove / keys / available 五个，而且必须是同步的
 *    （页面里是直接拿返回值当数据用，不能返回 Promise）。
 *    所以用 ipcRenderer.sendSync，主进程那边配 ipcMain.on + returnValue。
 *    千万别改成 invoke/handle，那是异步的，页面会拿到 Promise 当数据，整个工作台会乱。
 *
 * 2. window.__WORKBENCH_SHELL__ —— 桌面能力
 *    启动程序、取程序图标、窗口按钮、开机自启、系统通知、AI 请求转发、环境信息。
 *    这些是异步的，用 invoke，页面那边按 Promise 处理。
 *
 * 另外拖文件进来这件事在这里处理：只有 preload 能拿到文件的真实路径
 * （webUtils.getPathForFile），页面里那个 File 对象是拿不到路径的。
 * 拖完把结果用一条自定义事件告诉页面。
 */
'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

/* ---------------- 存储 ---------------- */

contextBridge.exposeInMainWorld('__WORKBENCH_STORE__', {
  get: function (k) { return ipcRenderer.sendSync('store:get', String(k)); },
  set: function (k, v) { return ipcRenderer.sendSync('store:set', String(k), v); },
  remove: function (k) { return ipcRenderer.sendSync('store:remove', String(k)); },
  keys: function () { return ipcRenderer.sendSync('store:keys'); },
  available: function () { return ipcRenderer.sendSync('store:available'); },
  where: function () { return ipcRenderer.sendSync('store:where'); }
});

/* 每日快照独立文件（大体积数据专用，主数据文件保持苗条） */
contextBridge.exposeInMainWorld('__WORKBENCH_SHELF__', {
  get: function (k) { return ipcRenderer.sendSync('store:shelf:get', String(k)); },
  set: function (k, v) { return ipcRenderer.sendSync('store:shelf:set', String(k), v); }
});

/* ---------------- 桌面能力 ---------------- */

contextBridge.exposeInMainWorld('__WORKBENCH_SHELL__', {
  desktop: true,

  launchApp: function (p) { return ipcRenderer.invoke('shell:launch', String(p || '')); },
  fileIcon: function (p, label) { return ipcRenderer.invoke('shell:fileIcon', String(p || ''), String(label || '')); },
  appInfo: function (p, label) { return ipcRenderer.invoke('shell:appInfo', String(p || ''), String(label || '')); },
  pickApp: function () { return ipcRenderer.invoke('shell:pickApp'); },
  openExternal: function (u) { ipcRenderer.send('shell:openExternal', String(u || '')); },

  winMin: function () { ipcRenderer.send('win:min'); },
  winMax: function () { ipcRenderer.send('win:max'); },
  winClose: function () { ipcRenderer.send('win:close'); },
  winState: function () { return ipcRenderer.sendSync('win:state'); },
  /* 番茄钟用的：铺满并置顶 / 收回 */
  winFullscreen: function (on) { ipcRenderer.send('win:fullscreen', !!on); },

  autostartGet: function () { return ipcRenderer.sendSync('app:autostart-get'); },
  autostartSet: function (v) { return ipcRenderer.sendSync('app:autostart-set', !!v); },

  notify: function (title, body) { return ipcRenderer.invoke('notify:show', String(title || ''), String(body || '')); },

  /* 应用内提醒：主进程每次发通知都会同步推一份过来，
   * 系统通知被关掉时页面里的横幅照样能看见。返回一个取消订阅的函数。 */
  onRemind: function (cb) {
    if (typeof cb !== 'function') return function () {};
    const h = function (e, data) { try { cb(data || {}); } catch (err) {} };
    ipcRenderer.on('app:remind', h);
    return function () { try { ipcRenderer.removeListener('app:remind', h); } catch (err) {} };
  },

  /* AI 请求走主进程，绕开页面同源限制 */
  aiPost: function (url, headers, body, timeout) {
    return ipcRenderer.invoke('net:post', { url: url, headers: headers, body: body, timeout: timeout });
  },

  /* 联网搜索：AI 查实时信息时用。返回 { ok, results:[{title,snippet,url}], error } */
  webSearch: function (q, n) {
    return ipcRenderer.invoke('web:search', String(q || ''), Number(n) || 6);
  },

  info: function () { return ipcRenderer.sendSync('env:info'); },
  openDataFolder: function () { ipcRenderer.send('env:openData'); }
});

/* ---------------- 拖文件进来 ---------------- */

/* 拖拽过程中把窗口"跳去打开这个文件"的默认行为压住，不然整个页面会变成那个 exe */
window.addEventListener('dragover', function (e) {
  e.preventDefault();
  try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; } catch (err) {}
}, true);

window.addEventListener('drop', function (e) {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (!dt) return;

  const files = [];
  try {
    for (let i = 0; i < dt.files.length; i++) files.push(dt.files[i]);
  } catch (err) {}
  if (!files.length) return;

  (async function () {
    const out = [];
    for (const f of files) {
      let p = '';
      try {
        p = webUtils && webUtils.getPathForFile ? webUtils.getPathForFile(f) : (f.path || '');
      } catch (err) {
        p = f.path || '';
      }
      if (!p) continue;
      let icon = '';
      try { icon = await ipcRenderer.invoke('shell:fileIcon', p); } catch (err) { icon = ''; }
      out.push({ path: p, name: f.name || '', icon: icon || '' });
    }
    /* 走事件而不是直接调页面的函数：页面那边可能还没加载完，事件方式不会报错 */
    try {
      window.dispatchEvent(new CustomEvent('workbench:apps-dropped', { detail: JSON.stringify(out) }));
    } catch (err) {}
  })();
}, true);
