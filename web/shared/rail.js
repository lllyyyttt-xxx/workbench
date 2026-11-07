/* 全局左侧导航栏
 *
 * 首页和每个模块页面都引入这个文件，导航栏就会自动出现在页面左边，
 * 在任何页面都能直接跳到别的模块，不用先回首页。
 *
 * 用法：在页面里引用
 *   <script src="../../shared/rail.js"></script>
 * 它会自己插入导航栏、读取模块清单、高亮当前页面对应的那一项。
 *
 * 当前在哪个模块：优先看 <body data-rail-current="模块id">，
 * 没有的话按路径猜（/modules/时间管理/ 这种）。
 */
window.WorkbenchRail = (function () {
  'use strict';

  var PREFIX = 'wb:';
  var rail = null;
  var currentId = null;

  /* 存储读写：优先用外壳注入的，其次 localStorage */
  function readRaw(key) {
    try {
      var inj = window.__WORKBENCH_STORE__;
      if (inj && typeof inj.get === 'function') {
        var v = inj.get(PREFIX + key);
        if (v !== null && v !== undefined) return v;
      }
    } catch (e) {}
    try { return window.localStorage.getItem(PREFIX + key); } catch (e) { return null; }
  }

  function writeRaw(key, val) {
    try {
      var inj = window.__WORKBENCH_STORE__;
      if (inj && typeof inj.set === 'function') { inj.set(PREFIX + key, val); return; }
    } catch (e) {}
    try { window.localStorage.setItem(PREFIX + key, val); } catch (e) {}
  }

  function getMeta(key, fallback) {
    var raw = readRaw('__workbench:' + key);
    if (raw === null || raw === undefined || raw === '') return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function setMeta(key, val) {
    try { writeRaw('__workbench:' + key, JSON.stringify(val)); } catch (e) {}
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 卡片改名功能：名字可能在 __workbench:cardNames 里被改过 */
  function cardName(m) {
    var names = getMeta('cardNames', {}) || {};
    return names[m.id] || m.name;
  }

  /* 当前在哪个模块 */
  function detectCurrent() {
    var attr = document.body && document.body.getAttribute('data-rail-current');
    if (attr) return attr;
    /* 按路径猜：.../modules/xxx/index.html */
    var m = /\/modules\/([^\/]+)\//.exec(location.pathname);
    if (m) {
      var dir = decodeURIComponent(m[1]);
      if (dir === 'time') return 'time';
      var mods = window.WORKBENCH_MODULES || [];
      for (var i = 0; i < mods.length; i++) {
        if (mods[i].id === dir) return mods[i].id;
      }
      return dir;
    }
    return null;   /* 首页 */
  }

  /* 模块入口地址：首页用 modules/xxx/，模块页用 ../xxx/ */
  function hrefFor(m, fromHome) {
    if (!m.href) return '';
    return fromHome ? m.href : m.href.replace(/^modules\//, '../');
  }

  /* 首页地址：从模块页回去 */
  function homeHref() {
    return document.body.getAttribute('data-rail-home') || '../../index.html';
  }

  function isHomePage() {
    return !/\/modules\//.test(location.pathname);
  }

  function build() {
    var mods = window.WORKBENCH_MODULES || [];
    if (!mods.length) return;

    var home = isHomePage();
    currentId = detectCurrent();

    var nav = document.createElement('nav');
    nav.className = 'wrail';
    nav.id = 'wrail';

    /* 回首页：作为导航栏里普通的一项，排在模块图标最上面 */
    var homeItem = home ? '' :
      '<a class="wrail-item wrail-home" href="' + esc(homeHref()) + '" title="工作台">' +
      '<span class="wrail-icon">⌂</span>' +
      '<span class="wrail-text"><span class="wrail-name">工作台</span></span></a>';

    var items = mods.map(function (m) {
      var cur = (m.id === currentId);
      return '<a class="wrail-item' + (cur ? ' on' : '') + (m.href ? '' : ' disabled') + '"' +
        ' href="' + esc(hrefFor(m, home)) + '"' +
        ' title="' + esc(cardName(m)) + '"' +
        ' style="--rail-color:' + esc(m.color || '#8e9aab') + '">' +
        '<span class="wrail-icon">' + esc(m.icon || '·') + '</span>' +
        '<span class="wrail-text">' +
        '<span class="wrail-name">' + esc(cardName(m)) + '</span>' +
        '<span class="wrail-desc">' + esc(m.desc || '') + '</span>' +
        '</span>' +
        '</a>';
    }).join('');

    nav.innerHTML =
      '<div class="wrail-scroll">' +
      '<div class="wrail-list">' + homeItem + items + '</div>' +
      '</div>' +
      '<button class="wrail-setting" id="wrailSetting" type="button" title="设置">' +
      '<span class="wrail-icon">⚙</span>' +
      '<span class="wrail-name">设置</span>' +
      '</button>';

    document.body.insertBefore(nav, document.body.firstChild);

    /* 设置按钮：共享面板任何页面直接打开；首页用本页的旧面板 */
    var setBtn = nav.querySelector('#wrailSetting');
    if (setBtn) {
      setBtn.addEventListener('click', function () {
        if (window.WorkbenchSettings) {
          window.WorkbenchSettings.open();
          return;
        }
        if (home) {
          var panel = document.getElementById('settingsPanel');
          if (panel) {
            panel.classList.add('show');
            if (window.__refreshSettings) window.__refreshSettings();
          }
        } else {
          location.href = homeHref() + '#settings';
        }
      });
    }

    rail = nav;
  }

  function init() {
    /* 模块清单要先加载好 */
    if (!window.WORKBENCH_MODULES) return;
    build();
  }

  /* 给外部用的：重新画一遍当前项高亮 */
  function paint(current) {
    if (!rail) return;
    if (current !== undefined) currentId = current;
    var items = rail.querySelectorAll('.wrail-item');
    Array.prototype.forEach.call(items, function (el) {
      var href = el.getAttribute('href') || '';
      var id = (/([^\/]+)\/index\.html$/.exec(href) || [])[1] || '';
      el.classList.toggle('on', id === currentId);
    });
  }

  /* 页面加载完自动初始化。
   * 这样各页面只需要引一个 <script src>，不用再写内联脚本——
   * 内联脚本会被某些验证脚本的正则一起抓走。
   */
  function autoInit() {
    try { init(); } catch (e) {
      if (window.console && console.warn) console.warn('导航栏初始化失败：', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  return { init: init, paint: paint, detectCurrent: detectCurrent };
})();
