/* 顶部启动台
 *
 * 首页和七个模块页都引用这一份，页面顶部就会出现一条常驻的图标栏，
 * 点一下就能打开常用的东西，当前所在的那个用半透明白底圆角托着。
 *
 * 用法：页面里引用一次就行
 *   <link rel="stylesheet" href="../../shared/dock.css">
 *   <script src="../../shared/dock.js"></script>
 * 它自己往 body 最前面插一条，并给 body 加上 has-wdock 类让页面整体下移。
 *
 * 能打开的三类：
 *   module  工作台自己的页面，直接在当前窗口跳过去
 *   url     网址，交给系统默认浏览器打开
 *   app     本机软件。浏览器没有任何权限启动本机程序（不然任何网页都能乱开软件），
 *           所以浏览器里点了只出一句提示；打包成桌面应用后由外壳真启动。
 *
 * 桌面版（外壳注入了 window.__WORKBENCH_SHELL__）额外多三件事：
 *   1. 把 exe 拖到胶囊上就能加进来，图标用程序自带的
 *   2. 点软件图标真的启动
 *   3. 胶囊右边多出最小化、最大化、关闭三个窗口按钮（无边框窗口必须自己给）
 * 判断依据只有一条：window.__WORKBENCH_SHELL__ 在不在。浏览器里这三件事全部不出现，
 * 行为跟以前一模一样，验证脚本 verify_dock.js 测的就是浏览器里的那份。
 *
 * 存储键：wb:__workbench:dockItems，外壳注入存储时优先用外壳的，否则用 localStorage。
 */
window.WorkbenchDock = (function () {
  'use strict';

  var KEY = 'wb:__workbench:dockItems';

  /* 默认这一排：工作台 + 几个常用软件 */
  var DEFAULTS = [
    { icon: '⌂', label: '工作台', kind: 'module', target: 'index.html' },
    { icon: '💬', label: '微信', kind: 'app', target: '微信' },
    { icon: '🌐', label: '浏览器', kind: 'app', target: 'Microsoft Edge' },
    { icon: '⌨', label: '代码编辑器', kind: 'app', target: 'Visual Studio Code' },
    { icon: '📁', label: '文件管理', kind: 'app', target: '文件资源管理器' },
    { icon: '🧮', label: '计算器', kind: 'app', target: '计算器' },
    { icon: '📝', label: '记事本', kind: 'app', target: '记事本' },
    { icon: '🎵', label: '音乐', kind: 'app', target: '音乐播放器' }
  ];

  var wrap = null;
  var toastEl = null;

  function shell() {
    var s = window.__WORKBENCH_SHELL__;
    return (s && s.desktop) ? s : null;
  }

  /* ---------------- 存储 ---------------- */

  function readRaw() {
    try {
      var inj = window.__WORKBENCH_STORE__;
      if (inj && typeof inj.get === 'function') {
        var v = inj.get(KEY);
        if (v !== null && v !== undefined) return v;
      }
    } catch (e) {}
    try { return window.localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function writeRaw(val) {
    try {
      var inj = window.__WORKBENCH_STORE__;
      if (inj && typeof inj.set === 'function') { inj.set(KEY, val); return; }
    } catch (e) {}
    try { window.localStorage.setItem(KEY, val); } catch (e) {}
  }

  /* 图标有两种：一个是表情/字符，一个是程序自带的图标（data:image/png;base64,...）。
   * 表情最多留几个字，dataURL 必须整段留着，不能按长度截。 */
  function normIcon(v) {
    var s = String(v == null ? '' : v);
    if (/^data:image\//i.test(s)) return s;
    return s.slice(0, 4) || '•';
  }

  function normalize(it) {
    return {
      icon: normIcon(it && it.icon),
      label: String(it && it.label || '未命名'),
      kind: (it && (it.kind === 'module' || it.kind === 'url' || it.kind === 'app')) ? it.kind : 'app',
      target: String(it && it.target || '')
    };
  }

  function loadItems() {
    var raw = readRaw();
    if (!raw) return DEFAULTS.map(normalize);
    try {
      var list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return DEFAULTS.map(normalize);
      return list.map(normalize);
    } catch (e) {
      return DEFAULTS.map(normalize);
    }
  }

  function saveItems(list) {
    try { writeRaw(JSON.stringify(list)); } catch (e) {}
  }

  /* ---------------- 小工具 ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function isHomePage() {
    return !/\/modules\//.test(location.pathname);
  }

  /* 页面里写的路径都是相对项目根的，模块页要多回退两层 */
  function resolveHref(target) {
    var t = String(target || '').trim();
    if (!t) return '';
    if (/^[a-z]+:/i.test(t) || t.indexOf('//') === 0) return t;
    if (isHomePage()) return t;
    return '../../' + t.replace(/^[.\/]+/, '');
  }

  /* 当前在哪个页面，用来高亮 */
  function currentTarget() {
    if (isHomePage()) return 'index.html';
    var m = /\/modules\/([^\/]+)\//.exec(location.pathname);
    return m ? 'modules/' + decodeURIComponent(m[1]) + '/index.html' : '';
  }

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'wdock-toast';
      toastEl.id = 'wdockToast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(function () { toastEl.classList.remove('show'); }, 3600);
  }

  /* 打个短工：先显示提示，再把异步结果补上 */
  function toastLater(promise, failPrefix) {
    promise.then(function (r) {
      if (r && r.ok) toast('已启动。');
      else toast((failPrefix || '') + ((r && r.msg) || '启动失败。'));
    }, function (e) {
      toast('启动失败：' + String((e && e.message) || e));
    });
  }

  /* ---------------- 点击行为 ---------------- */

  function activate(item) {
    if (!item) return;

    if (item.kind === 'module') {
      var href = resolveHref(item.target);
      if (!href) { toast('这一项还没填页面地址。'); return; }
      location.href = href;
      return;
    }

    if (item.kind === 'url') {
      var u = String(item.target || '').trim();
      if (!u) { toast('这一项还没填网址。'); return; }
      if (!/^https?:/i.test(u)) u = 'https://' + u;
      var sh = shell();
      if (sh) { sh.openExternal(u); return; }
      try { window.open(u, '_blank'); } catch (e) { toast('浏览器拦住了这个网址。'); }
      return;
    }

    /* 本机软件 */
    var s = shell();
    if (s) {
      if (!item.target) { toast('「' + item.label + '」还没设程序。把它的 exe 拖到胶囊上就行。'); return; }
      toastLater(s.launchApp(item.target), '「' + item.label + '」');
      return;
    }

    /* 浏览器没法启动，说清楚，别让人以为坏了 */
    toast('「' + item.label + '」要等打包成桌面应用之后才能从这里启动。现在请从开始菜单打开它。');
  }

  /* ---------------- 渲染 ---------------- */

  /* 首字方块：实在拿不到图标时用的兜底。
   * 系统对「此电脑」这类、以及指向商店应用的快捷方式给不出真图标，
   * 与其顶着那张空白的通用快捷方式图，不如画个带首字的色块，一眼能认。 */
  function tileColor(label) {
    var t = String(label || '?');
    var h = 0;
    for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) % 360;
    return 'hsl(' + h + ', 40%, 62%)';
  }

  function iconHtml(it) {
    var ic = String(it.icon || '');

    /* 真图：data URL 且不是系统那张通用小图（那种只有几百字符） */
    if (/^data:image\//i.test(ic) && ic.length >= 1200) {
      return '<span class="wdock-ico"><img class="wdock-img" src="' + esc(ic) + '" alt=""></span>';
    }

    /* 自己写的字符图标（⌂、emoji），老数据里还有 */
    if (ic && !/^data:image\//i.test(ic)) {
      return '<span class="wdock-ico">' + esc(ic) + '</span>';
    }

    var ch = String(it.label || '?').trim().charAt(0) || '?';
    return '<span class="wdock-ico"><span class="wdock-tile" style="background:' + tileColor(it.label) + '">' +
      esc(ch) + '</span></span>';
  }

  function itemHtml(it, idx, cur) {
    var on = (it.kind === 'module' && it.target === cur);
    var cls = 'wdock-item' + (on ? ' on' : '') + (it.kind === 'app' ? ' is-app' : '');
    return '<button type="button" class="' + cls + '" data-idx="' + idx + '">' +
      iconHtml(it) +
      '<span class="wdock-tip">' + esc(it.label) + '</span>' +
      '</button>';
  }

  /* ---------------- 横向溢出的反馈 ----------------
   * 图标多到胶囊装不下的时候，得让人看得出来"后面还有"：
   * 两端渐隐跟着滚动位置走，哪头滚到头哪头就不淡。
   * 滚动条平时藏起来，鼠标放到胶囊上才浮出细的一条（样式在 dock.css）。
   * 竖着的滚轮在胶囊上直接当横向滚用；已经滚到头就不再拦，把滚轮还给页面，
   * 不然页面想往下滚会被胶囊"吸"住（左侧导航当时也踩过这个坑）。
   */
  function paintFade() {
    if (!wrap) return;
    var list = wrap.querySelector('.wdock-list');
    if (!list) return;
    var max = list.scrollWidth - list.clientWidth;
    if (max <= 1) {
      list.style.removeProperty('-webkit-mask-image');
      list.style.removeProperty('mask-image');
      return;
    }
    var x = list.scrollLeft;
    var L = Math.round(Math.min(1, x / 28) * 22);
    var R = Math.round(Math.min(1, (max - x) / 28) * 22);
    var m = 'linear-gradient(90deg, rgba(0,0,0,0) 0, #000 ' + L + 'px' +
      ', #000 calc(100% - ' + R + 'px), rgba(0,0,0,0) 100%)';
    list.style.webkitMaskImage = m;
    list.style.maskImage = m;
  }

  function setupScroll() {
    var list = wrap.querySelector('.wdock-list');
    if (!list) return;

    list.addEventListener('scroll', paintFade);

    list.addEventListener('wheel', function (e) {
      var max = list.scrollWidth - list.clientWidth;
      if (max <= 0) return;
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      var atStart = list.scrollLeft <= 0;
      var atEnd = list.scrollLeft >= max - 1;
      if ((d < 0 && atStart) || (d > 0 && atEnd)) return;
      e.preventDefault();
      list.scrollLeft += d;
    }, { passive: false });

    window.addEventListener('resize', paintFade);
  }

  function paint() {
    if (!wrap) return;
    var items = loadItems();
    var cur = currentTarget();
    var list = wrap.querySelector('.wdock-list');
    if (!list) return;
    list.innerHTML = items.map(function (it, i) { return itemHtml(it, i, cur); }).join('');
    paintFade();
    ensureIcons();
  }

  /* ---------------- 补图标 / 修失效路径 ----------------
   *
   * 每次重绘顺手问一遍主进程，三种情况都要处理：
   *   · 之前压根没取到图标
   *   · 取到的是系统那张"通用快捷方式"空白图（几百字符，不是程序真样子）
   *   · 存的老路径失效了（用户后来整理过文件夹），但同名程序还在别处
   * 同一个条目只问一次；问回来更长的图标才替换，路径变了才改写，免得来回抖。
   */
  var iconAsked = {};

  function ensureIcons() {
    var s = shell();
    if (!s) return;

    var ask = s.appInfo
      ? function (it) { return s.appInfo(it.target, it.label); }
      : function (it) {
        return s.fileIcon(it.target, it.label).then(function (u) {
          return { path: '', icon: u };
        });
      };

    var items = loadItems();
    var todo = [];

    items.forEach(function (it) {
      if (it.kind !== 'app') return;
      /* 路径已经不像是本机文件了（比如只填了个名字），问了也没用 */
      if (!/^[a-zA-Z]:[\\\/]/.test(it.target) && !/^\\\\/.test(it.target)) return;
      var key = it.target + '\u0000' + it.label;
      if (iconAsked[key]) return;
      iconAsked[key] = true;
      todo.push(it);
    });

    if (!todo.length) return;

    todo.forEach(function (job) {
      Promise.resolve(ask(job)).then(function (r) {
        r = r || {};
        var gotIcon = String(r.icon || '');
        var gotPath = String(r.path || '');
        if (!gotIcon && !gotPath) return;

        var list = loadItems();
        var changed = false;

        list.forEach(function (it) {
          if (it.kind !== 'app') return;
          if (it.target !== job.target || it.label !== job.label) return;

          /* 只有更长（更清晰）的图才换，别拿小的把大的盖了 */
          if (gotIcon && gotIcon.length > String(it.icon || '').length) {
            it.icon = gotIcon;
            changed = true;
          }
          /* 主进程找到新位置了才改写；原来那个已经打不开了 */
          if (gotPath && gotPath !== it.target) {
            it.target = gotPath;
            changed = true;
          }
        });

        if (changed) { saveItems(list); paint(); }
      }, function () {});
    });
  }

  function build() {
    var items = loadItems();
    var cur = currentTarget();
    var s = shell();

    wrap = document.createElement('div');
    wrap.className = 'wdock' + (s ? ' is-desktop' : '');
    wrap.id = 'wdock';

    wrap.innerHTML =
      '<div class="wdock-list">' +
      items.map(function (it, i) { return itemHtml(it, i, cur); }).join('') +
      '</div>' +
      '<button type="button" class="wdock-edit" id="wdockEdit" title="编辑这一排">⚙</button>' +
      (s ? '<div class="wdock-wctrl">' +
        '<button type="button" class="wdock-wbtn" id="wdockMin" title="最小化">─</button>' +
        '<button type="button" class="wdock-wbtn" id="wdockMax" title="最大化">□</button>' +
        '<button type="button" class="wdock-wbtn wdock-wclose" id="wdockClose" title="关闭">✕</button>' +
        '</div>' : '');

    /* 图标点击 */
    wrap.querySelector('.wdock-list').addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('.wdock-item') : null;
      if (!btn || !wrap.contains(btn)) return;
      var idx = Number(btn.getAttribute('data-idx'));
      activate(loadItems()[idx]);
    });

    wrap.querySelector('#wdockEdit').addEventListener('click', openEditor);

    if (s) {
      wrap.querySelector('#wdockMin').addEventListener('click', function () { s.winMin(); });
      wrap.querySelector('#wdockMax').addEventListener('click', function () { s.winMax(); });
      wrap.querySelector('#wdockClose').addEventListener('click', function () { s.winClose(); });
      setupDrop();
    }

    document.body.insertBefore(wrap, document.body.firstChild);
    document.body.classList.add('has-wdock');

    setupScroll();
    paintFade();
    /* 图标是异步补进来的，尺寸可能会变，晚一点再刷一遍渐隐 */
    setTimeout(paintFade, 400);

    /* 一进来就把没图标 / 只拿到通用图标的条目补一遍，
     * 不然得等用户点了编辑或拖了新东西才会触发 */
    ensureIcons();
  }

  /* ---------------- 拖 exe 进来 ----------------
   * 真正的路径只有外壳拿得到（preload 里用 webUtils），
   * 那边处理完会发一条 workbench:apps-dropped 事件过来，这里接住就行。
   * 这里只负责拖动时的视觉反馈和拦住浏览器的默认行为。
   */

  function setupDrop() {
    ['dragenter', 'dragover'].forEach(function (type) {
      wrap.addEventListener(type, function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        wrap.classList.add('wdock-drop');
      });
    });
    ['dragleave', 'dragend'].forEach(function (type) {
      wrap.addEventListener(type, function (e) {
        if (e.target === wrap) wrap.classList.remove('wdock-drop');
      });
    });
    wrap.addEventListener('drop', function (e) {
      e.preventDefault();
      wrap.classList.remove('wdock-drop');
    });

    window.addEventListener('workbench:apps-dropped', function (e) {
      var list = [];
      try { list = JSON.parse(e.detail || '[]'); } catch (err) { list = []; }
      if (!list || !list.length) { toast('没认出拖进来的文件。'); return; }
      addApps(list);
    });
  }

  function appLabel(name, p) {
    var base = String(name || p || '').split(/[\\\/]/).pop();
    return base.replace(/\.(exe|lnk|bat|cmd)$/i, '') || '新程序';
  }

  function addApps(list) {
    var items = loadItems();
    var added = 0;
    var skipped = [];

    list.forEach(function (f) {
      var p = String(f.path || '');
      if (!p) return;
      if (!/\.(exe|lnk|bat|cmd)$/i.test(p)) { skipped.push(appLabel(f.name, p)); return; }

      var label = appLabel(f.name, p);
      var icon = /^data:image\//i.test(f.icon || '') ? f.icon : '🧩';

      /* 已经在里面（同一个路径）就只更新图标和名字，不重复加 */
      var hit = null;
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'app' && items[i].target === p) { hit = items[i]; break; }
      }
      if (hit) { hit.icon = icon; hit.label = label; return; }

      items.push(normalize({ icon: icon, label: label, kind: 'app', target: p }));
      added++;
    });

    saveItems(items);
    paint();

    if (added) toast('已加到启动台：' + added + ' 个程序，点图标就能开。');
    else if (skipped.length) toast('只能拖程序（exe、快捷方式），这几个没加：' + skipped.slice(0, 3).join('、'));
    else if (!items.length) toast('没认出拖进来的文件。');
  }

  /* 外壳那边选一个程序（编辑面板里的「选」按钮） */
  function pickProgram(row) {
    var s = shell();
    if (!s) { toast('只有桌面版能选程序，浏览器里请手动填路径。'); return; }
    s.pickApp().then(function (r) {
      if (!r) return;
      row.querySelector('.wdock-i-target').value = r.path;
      row.querySelector('.wdock-i-label').value = r.name;
      row.querySelector('.wdock-i-icon').value = '';
      row.setAttribute('data-icon', r.icon || '');
      row.querySelector('.wdock-i-kind').value = 'app';
      toast('已选好，记得点保存。');
    });
  }

  /* ---------------- 编辑面板 ---------------- */

  function rowHtml(it) {
    var s = shell();
    return '<div class="wdock-row" data-icon="' + esc(/^data:image\//i.test(it.icon) ? it.icon : '') + '">' +
      '<input class="wdock-i-icon" value="' + esc(/^data:image\//i.test(it.icon) ? '' : it.icon) + '" maxlength="4" placeholder="图标" title="图标，可以填一个表情">' +
      '<input class="wdock-i-label" value="' + esc(it.label) + '" placeholder="名字" title="名字">' +
      '<select class="wdock-i-kind" title="类型">' +
      '<option value="module"' + (it.kind === 'module' ? ' selected' : '') + '>工作台页面</option>' +
      '<option value="url"' + (it.kind === 'url' ? ' selected' : '') + '>网址</option>' +
      '<option value="app"' + (it.kind === 'app' ? ' selected' : '') + '>本机软件</option>' +
      '</select>' +
      '<input class="wdock-i-target" value="' + esc(it.target) + '" placeholder="页面路径、网址或程序路径" title="目标">' +
      (s ? '<button type="button" class="wdock-mini wdock-pick" title="选一个程序">选</button>' : '') +
      '<button type="button" class="wdock-mini wdock-up" title="上移">↑</button>' +
      '<button type="button" class="wdock-mini wdock-down" title="下移">↓</button>' +
      '<button type="button" class="wdock-mini wdock-del" title="删掉这一项">✕</button>' +
      '</div>';
  }

  function openEditor() {
    var mask = document.getElementById('wdockMask');
    if (!mask) {
      mask = document.createElement('div');
      mask.className = 'wdock-mask';
      mask.id = 'wdockMask';
      mask.innerHTML =
        '<div class="wdock-panel">' +
        '<div class="wdock-panel-head">' +
        '<h3>顶部启动台</h3>' +
        '<span class="wdock-sub">改完点保存</span>' +
        '<button type="button" class="wdock-close" id="wdockClose2">×</button>' +
        '</div>' +
        '<div class="wdock-rows" id="wdockRows"></div>' +
        '<div class="wdock-hint" id="wdockHint"></div>' +
        '<div class="wdock-panel-foot">' +
        '<button type="button" id="wdockAdd">＋ 加一个</button>' +
        '<span class="wdock-spacer"></span>' +
        '<button type="button" id="wdockReset">恢复默认</button>' +
        '<button type="button" class="wdock-primary" id="wdockSave">保存</button>' +
        '</div>' +
        '</div>';
      document.body.appendChild(mask);

      mask.addEventListener('click', function (e) {
        if (e.target === mask) closeEditor();
      });
      mask.querySelector('#wdockClose2').addEventListener('click', closeEditor);

      var rows = mask.querySelector('#wdockRows');

      mask.querySelector('#wdockAdd').addEventListener('click', function () {
        rows.insertAdjacentHTML('beforeend', rowHtml({ icon: '⭐', label: '', kind: 'url', target: '' }));
      });

      mask.querySelector('#wdockReset').addEventListener('click', function () {
        rows.innerHTML = DEFAULTS.map(rowHtml).join('');
        toast('已经恢复成默认这一排，点保存才生效。');
      });

      mask.querySelector('#wdockSave').addEventListener('click', function () {
        saveItems(readRows(rows));
        paint();
        closeEditor();
        toast('启动台已保存。');
      });

      rows.addEventListener('click', function (e) {
        var t = e.target;
        if (!t.classList) return;
        var row = t.closest ? t.closest('.wdock-row') : null;
        if (!row) return;
        if (t.classList.contains('wdock-del')) {
          row.parentNode.removeChild(row);
        } else if (t.classList.contains('wdock-up')) {
          if (row.previousElementSibling) rows.insertBefore(row, row.previousElementSibling);
        } else if (t.classList.contains('wdock-down')) {
          if (row.nextElementSibling) rows.insertBefore(row, row.nextElementSibling);
        } else if (t.classList.contains('wdock-pick')) {
          pickProgram(row);
        }
      });
    }

    var hint = mask.querySelector('#wdockHint');
    if (hint) {
      hint.textContent = shell()
        ? '把程序的 exe 直接拖到上面那个胶囊上最快，图标会自动取程序自带的。这里也可以点「选」挑一个程序，或者手动填路径。'
        : '图标那格可以直接填一个表情。类型选「本机软件」的，要等打包成桌面应用后才能真启动，现在点了只会提示。';
    }

    mask.querySelector('#wdockRows').innerHTML = loadItems().map(rowHtml).join('');
    mask.classList.add('show');
  }

  function closeEditor() {
    var mask = document.getElementById('wdockMask');
    if (mask) mask.classList.remove('show');
  }

  function readRows(rows) {
    var out = [];
    Array.prototype.forEach.call(rows.querySelectorAll('.wdock-row'), function (row) {
      var label = (row.querySelector('.wdock-i-label').value || '').trim();
      var target = (row.querySelector('.wdock-i-target').value || '').trim();
      /* 名字和目标都空的行就是没填，直接丢掉 */
      if (!label && !target) return;
      var icon = (row.querySelector('.wdock-i-icon').value || '').trim();
      if (!icon) icon = row.getAttribute('data-icon') || '';
      out.push(normalize({
        icon: icon,
        label: label || target,
        kind: row.querySelector('.wdock-i-kind').value,
        target: target
      }));
    });
    return out;
  }

  /* ---------------- 启动 ---------------- */

  function init() {
    if (!document.body) return;
    if (document.getElementById('wdock')) return;
    try { build(); } catch (e) {
      if (window.console && console.warn) console.warn('启动台初始化失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init: init,
    reload: paint,
    openEditor: openEditor,
    addApps: addApps,
    DEFAULTS: DEFAULTS,
    isDesktop: function () { return !!shell(); }
  };
})();
