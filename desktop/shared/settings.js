/* 工作台设置面板（共享组件）
 *
 * 为什么单独拎出来：原来设置面板只写在首页 index.html 里，在其他模块页
 * 点「设置」得先跳回首页，很别扭。现在把面板和它的逻辑做成一份共享组件，
 * 每个页面都能直接打开。
 *
 * 依赖：
 *   - shared/store.js（数据）
 *   - 首页可选挂 window.WorkbenchHome 钩子（卡片改名、自动切换档位）
 *   - 外壳可选注入 window.__WORKBENCH_SHELL__（开机自启、通知、数据目录）
 *   - shared/undo.js 存在时才有「每日快照」恢复
 *   - shared/sync.js 会自己往 .set-body 里追加「数据同步」块
 */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sh() { return global.__WORKBENCH_SHELL__; }
  function home() { return global.WorkbenchHome || null; }
  function modules() { return global.WORKBENCH_MODULES || []; }

  /* ---------- 备份导出 / 导入 ---------- */
  function exportAll() {
    var ids = modules().map(function (m) { return m.id; });
    ['__workbench', 'dock'].forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    var SKIP = { undoStack: 1, dailyShelf: 1 };
    var data = { app: 'workbench', version: 2, exportedAt: new Date().toISOString(), modules: {} };
    ids.forEach(function (id) {
      var dump = WorkbenchStore.namespace(id).dump();
      Object.keys(dump).forEach(function (k) { if (SKIP[k]) delete dump[k]; });
      data.modules[id] = dump;
    });
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    a.href = url;
    a.download = '工作台备份-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importAll(text) {
    var data = JSON.parse(text);
    if (!data || !data.modules) throw new Error('格式不符');
    var ids = Object.keys(data.modules);
    if (!ids.length) throw new Error('备份里没有数据');
    var names = ids.map(function (id) {
      var ms = modules();
      for (var i = 0; i < ms.length; i++) if (ms[i].id === id) return ms[i].name;
      return id === '__workbench' ? '助手设置和记忆' : id === 'dock' ? '启动台' : id;
    });
    if (!global.confirm('导入会覆盖这些模块现在的数据：\n' + names.join('、') +
      '\n\n导入前会先留一份撤销，导错了能点「撤销上次改动」退回来。继续？')) return false;
    var snap = global.WorkbenchUndo ? WorkbenchUndo.begin('导入备份', ids) : null;
    ids.forEach(function (id) { WorkbenchStore.namespace(id).load(data.modules[id]); });
    if (snap) WorkbenchUndo.commit(snap);
    return true;
  }

  /* ---------- 面板 HTML ---------- */
  function build() {
    if (document.getElementById('settingsPanel')) return;
    var aside = document.createElement('aside');
    aside.id = 'settingsPanel';
    aside.innerHTML =
      '<div class="set-head"><h2>设置</h2><button class="icon-btn" id="settingsClose">关闭</button></div>' +
      '<div class="set-body">' +
      '<div class="set-block">' +
      '<h3>数据保存位置</h3><p id="storeInfo">浏览器本地存储</p>' +
      '<p class="dim" style="margin-top:6px;">每个模块的数据独立存放，清空某个模块不会影响其他模块。</p>' +
      '<p id="storeWarn">当前环境无法长期保存数据，关闭页面后进度会丢失，请改用普通浏览器窗口或打包后的应用打开。</p>' +
      '</div>' +
      (sh() ? '<div class="set-block" id="appBlock">' +
        '<h3>桌面应用</h3><p class="dim" id="appInfo" style="margin-bottom:10px;"></p>' +
        '<div class="set-row"><button id="btnAutoStart">开机自启：关</button><button id="btnTestNotify">试一下通知</button></div>' +
        '<div class="set-row"><button id="btnOpenData">打开数据文件夹</button></div>' +
        '<p class="dim" id="autoStartTip">开了之后开机就会自动打开工作台，不想要随时关掉。</p></div>' : '') +
      '<div class="set-block"><h3>各模块数据</h3><ul id="moduleData"></ul></div>' +
      (home() ? '<div class="set-block" id="renameBlock">' +
        '<h3>卡片名字</h3><p class="dim" style="margin-bottom:10px;">想改哪张卡片的名字就改哪张，留空表示不改。</p>' +
        '<ul id="renameList" class="rename-list"></ul><p class="dim" id="renameTip" style="margin-top:8px;"></p></div>' +
        '<div class="set-block" id="autoBlock">' +
        '<h3>卡片自动切换</h3><p class="dim" style="margin-bottom:10px;">卡片会一直慢慢往前滑。鼠标停在卡片上或正在打字时会停下，移开接着走。</p>' +
        '<div class="auto-row" id="autoRow">' +
        '<button class="auto-opt" data-auto="1">快</button>' +
        '<button class="auto-opt" data-auto="2">中</button>' +
        '<button class="auto-opt" data-auto="3">慢</button></div></div>' : '') +
      '<div class="set-block"><h3>备份</h3>' +
      '<div class="set-row"><button id="btnExportAll">导出全部</button><button id="btnImportAll">导入备份</button></div>' +
      '<input type="file" id="importAllFile" accept=".json,application/json" style="display:none;">' +
      '<p class="dim">换电脑或清理数据前，建议先导出一份。</p>' +
      (global.WorkbenchUndo ? '<div class="set-row" style="margin-top:12px;">' +
        '<select id="dailySel" class="cfg-input" style="max-width:186px;"></select>' +
        '<button id="btnDailyRestore">恢复到那一天</button></div>' +
        '<p class="dim">每天第一次打开时自动存一份，保留最近七天。改坏了能退回当天早上的样子。</p>' : '') +
      '</div></div>';
    document.body.appendChild(aside);
    wire();
    if (typeof global.__wbAfterSettingsBuilt === 'function') { try { global.__wbAfterSettingsBuilt(); } catch (e) {} }
  }

  /* ---------- 交互 ---------- */
  function wire() {
    document.getElementById('settingsClose').addEventListener('click', close);

    document.getElementById('btnExportAll').addEventListener('click', exportAll);
    document.getElementById('btnImportAll').addEventListener('click', function () {
      document.getElementById('importAllFile').click();
    });
    document.getElementById('importAllFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var done = importAll(String(reader.result || ''));
          alert(done ? '导入完成。导错了可以点助手下面的「撤销上次改动」退回来。' : '没有导入，数据没动。');
        } catch (err) { alert('导入失败：文件内容不是有效的备份。'); }
        e.target.value = '';
        refresh();
      };
      reader.readAsText(f, 'utf-8');
    });

    /* 每日快照 */
    var dsel = document.getElementById('dailySel');
    var dbtn = document.getElementById('btnDailyRestore');
    if (dsel && dbtn) {
      dbtn.addEventListener('click', function () {
        var k = dsel.value;
        if (!k) { alert('还没有可以恢复的快照，明天再来看。'); return; }
        if (!confirm('把现在的数据换成 ' + k + ' 开始时的样子？\n\n换之前会给现在留一份撤销，觉得不对还能退回来。')) return;
        var r = WorkbenchUndo.restoreDaily(k);
        alert(r.text);
        if (r.ok) location.reload();
      });
    }

    /* 卡片自动切换档位 */
    var autoRow = document.getElementById('autoRow');
    if (autoRow && home()) {
      autoRow.addEventListener('click', function (e) {
        var b = e.target.closest('[data-auto]');
        if (!b) return;
        home().setAuto(b.dataset.auto);
        paintAuto();
      });
    }

    /* 桌面应用那几个按钮（外壳是同步 API：autostartGet/autostartSet/info） */
    var btnAuto = document.getElementById('btnAutoStart');
    if (btnAuto && sh()) {
      function paintAutoStart() {
        var on = false;
        try { on = !!sh().autostartGet(); } catch (e) { on = false; }
        btnAuto.textContent = '开机自启：' + (on ? '开' : '关');
        btnAuto.dataset.on = on ? '1' : '';
      }
      btnAuto.addEventListener('click', function () {
        var next = btnAuto.dataset.on !== '1';
        try { sh().autostartSet(next); } catch (e) {}
        paintAutoStart();
      });
      paintAutoStart();
      var btnNotify = document.getElementById('btnTestNotify');
      if (btnNotify) btnNotify.addEventListener('click', function () { try { sh().notify('工作台', '通知是通的，到点了就会这样提醒你。'); } catch (e) {} });
      var btnOpen = document.getElementById('btnOpenData');
      if (btnOpen) btnOpen.addEventListener('click', function () { try { sh().openDataFolder(); } catch (e) {} });
      var info = document.getElementById('appInfo');
      if (info) {
        var meta = {};
        try { meta = sh().info() || {}; } catch (e) { meta = {}; }
        info.textContent = '数据存在这台电脑的文件里，关掉再开还在，不再受浏览器清缓存影响。' +
          (meta.version ? '当前版本 ' + meta.version + '。' : '');
      }
    }
  }

  function paintAuto() {
    var row = document.getElementById('autoRow');
    if (!row || !home()) return;
    var cur = Number(home().autoSec());
    Array.prototype.forEach.call(row.querySelectorAll('[data-auto]'), function (b) {
      b.classList.toggle('on', Number(b.dataset.auto) === cur);
    });
  }

  function refresh() {
    var box = document.getElementById('storeInfo');
    if (box) {
      var names = { native: '本机应用存储', browser: '浏览器本地存储', memory: '临时内存（不保存）' };
      box.textContent = names[WorkbenchStore.backend] || WorkbenchStore.backend;
      var warn = document.getElementById('storeWarn');
      if (warn) warn.style.display = WorkbenchStore.isMemoryOnly() ? 'block' : 'none';
    }

    var list = document.getElementById('moduleData');
    if (list) {
      var ms = modules();
      var cn = home() ? home().cardName : function (m) { return m.name; };
      list.innerHTML = ms.map(function (m) {
        var n = WorkbenchStore.namespace(m.id).keys().length;
        return '<li><span>' + esc(cn(m)) + '</span><span class="dim">' + n + ' 项数据</span>' +
          '<button data-clear="' + esc(m.id) + '">清空</button></li>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('button[data-clear]'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.clear;
          var m = ms.filter(function (x) { return x.id === id; })[0];
          if (!confirm('确定清空「' + (m ? (home() ? home().cardName(m) : m.name) : id) + '」的全部数据吗？其他模块不受影响。')) return;
          WorkbenchStore.namespace(id).clear();
          refresh();
        });
      });
    }

    /* 卡片改名 */
    var rl = document.getElementById('renameList');
    if (rl && home()) {
      var custom = home().getNames();
      rl.innerHTML = modules().map(function (m) {
        return '<li class="rename-row"><span class="rename-label">' + esc(m.name) + '</span>' +
          '<input type="text" data-rename="' + esc(m.id) + '" value="' + esc(custom[m.id] || '') + '" placeholder="' + esc(m.name) + '">' +
          '<button data-rename-save="' + esc(m.id) + '">保存</button></li>';
      }).join('');
      Array.prototype.forEach.call(rl.querySelectorAll('button[data-rename-save]'), function (btn) {
        btn.addEventListener('click', function () { saveRename(rl, btn.dataset.renameSave); });
      });
      Array.prototype.forEach.call(rl.querySelectorAll('input[data-rename]'), function (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') saveRename(rl, input.dataset.rename);
        });
      });
    }

    /* 每日快照下拉 */
    var dsel = document.getElementById('dailySel');
    if (dsel && global.WorkbenchUndo) {
      var shelf = WorkbenchUndo.dailyList();
      dsel.innerHTML = shelf.length
        ? shelf.map(function (d) { return '<option value="' + d.date + '">' + d.date + '（' + d.modules + ' 个模块）</option>'; }).join('')
        : '<option value="">还没有快照</option>';
    }

    paintAuto();
  }

  function saveRename(rl, id) {
    var input = rl.querySelector('input[data-rename="' + id + '"]');
    if (!input || !home()) return;
    var v = (input.value || '').trim();
    var names = home().getNames();
    if (v) names[id] = v; else delete names[id];
    home().setNames(names);
    home().rerender();
    refresh();
    var tip = document.getElementById('renameTip');
    if (tip) {
      var m = modules().filter(function (x) { return x.id === id; })[0];
      tip.textContent = v ? '已改成「' + v + '」' : '已恢复成「' + (m ? m.name : id) + '」';
      setTimeout(function () { tip.textContent = ''; }, 2000);
    }
  }

  function open() {
    build();
    var p = document.getElementById('settingsPanel');
    if (!p) return;
    p.classList.add('show');
    refresh();
  }
  function close() {
    var p = document.getElementById('settingsPanel');
    if (p) p.classList.remove('show');
  }

  global.WorkbenchSettings = { open: open, close: close, refresh: refresh };
  /* 导出导入给验证脚本与外部复用 */
  global.WorkbenchBackup = { exportAll: exportAll, importAll: importAll };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})(typeof window !== 'undefined' ? window : this);
