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
    var open = !!getMeta('railOpen', 0);
    var ovOpen = getMeta('railOvOpen', 1) !== 0;

    var nav = document.createElement('nav');
    nav.className = 'wrail' + (open ? ' open' : '');
    nav.id = 'wrail';

    /* 展开收起 + 回首页 */
    var head = '';
    if (!home) {
      head += '<a class="wrail-home" href="' + esc(homeHref()) + '" title="回首页">' +
        '<span class="wrail-icon wrail-home-icon">⌂</span>' +
        '<span class="wrail-name">工作台</span></a>';
    }

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

    /* 今日概览只在首页有内容（side.js 只挂首页） */
    /* 今日概览：所有页面都有，不要图标，只保留文字 */
    var overview =
      '<div class="wrail-overview' + (ovOpen ? ' show' : '') + '" id="wrailOverview">' +
      '<button class="wrail-ov-head" id="wrailOvHead" type="button">' +
      '<span class="wrail-text wrail-ov-text">' +
      '<span class="wrail-name">今日概览</span>' +
      '</span>' +
      '<span class="wrail-ov-arrow">›</span>' +
      '</button>' +
      '<div class="wrail-ov-body" id="wrailOvBody">' +
      '<div class="ov-block"><div class="ov-head">今天</div><div class="ov-body" id="sideToday"></div></div>' +
      '<div class="ov-block"><div class="ov-head">待办</div><div class="ov-body" id="sideTodos"></div></div>' +
      '<div class="ov-block"><div class="ov-head">规划</div><div class="ov-body" id="sidePlans"></div></div>' +
      '<div class="ov-block"><div class="ov-head">倒计时</div><div class="ov-body" id="sideCountdown"></div></div>' +
      '<div class="ov-block" id="sideRecentBlock" style="display:none;">' +
      '<div class="ov-head">最近打开</div><div class="ov-body" id="sideRecent"></div></div>' +
      '</div></div>' +
      '<div class="wrail-sep"></div>';

    nav.innerHTML =
      '<button class="wrail-toggle" id="wrailToggle" type="button" title="' + (open ? '收起' : '展开') + '">' +
      '<span class="wrail-toggle-icon">' + (open ? '‹' : '›') + '</span>' +
      '</button>' +
      (home ? '' : '<div class="wrail-sep wrail-sep-top"></div>') +
      '<div class="wrail-scroll">' +
      head + overview +
      '<div class="wrail-list">' + items + '</div>' +
      '</div>' +
      '<button class="wrail-setting" id="wrailSetting" type="button" title="设置">' +
      '<span class="wrail-icon">⚙</span>' +
      '<span class="wrail-name">设置</span>' +
      '</button>';

    document.body.insertBefore(nav, document.body.firstChild);

    /* 滚动提示：内容超出时上下边缘渐隐，滚到哪一头那头就恢复清晰。
     * 不靠滚动条提示是因为它太细、收起态（76px）下更难看见；
     * 边缘一淡，一眼就知道"下面还有东西"。
     */
    var scroller = nav.querySelector('.wrail-scroll');

    function paintFade() {
      if (!scroller) return;
      var over = scroller.scrollHeight - scroller.clientHeight;
      if (over <= 2) {
        scroller.style.setProperty('--mt', '0px');
        scroller.style.setProperty('--mb', '0px');
        return;
      }
      var y = scroller.scrollTop;
      scroller.style.setProperty('--mt', y > 2 ? '14px' : '0px');
      scroller.style.setProperty('--mb', y < over - 2 ? '14px' : '0px');
    }

    /* 布局刚变过，等浏览器算完再做，不然量到的是旧高度 */
    function queueFade() {
      if (window.requestAnimationFrame) window.requestAnimationFrame(paintFade);
      else paintFade();
    }

    if (scroller) {
      scroller.addEventListener('scroll', paintFade, { passive: true });
      /* 概览是异步填进去的（side.js），填完高度会变，得盯着它重新算 */
      try {
        if (window.ResizeObserver) {
          var ro = new ResizeObserver(queueFade);
          Array.prototype.forEach.call(scroller.children, function (el) { ro.observe(el); });
        }
      } catch (e) {}
    }
    window.addEventListener('resize', queueFade);

    /* 展开收起 */
    var toggle = nav.querySelector('#wrailToggle');
    toggle.addEventListener('click', function () {
      var nowOpen = !nav.classList.contains('open');
      nav.classList.toggle('open', nowOpen);
      document.body.classList.toggle('wrail-open', nowOpen);
      setMeta('railOpen', nowOpen ? 1 : 0);
      toggle.title = nowOpen ? '收起' : '展开';
      toggle.querySelector('.wrail-toggle-icon').textContent = nowOpen ? '‹' : '›';
      /* 概览展开时导航收起来，内容先渲染一次，保证下次展开有内容 */
      if (window.WorkbenchSide && nowOpen) window.WorkbenchSide.renderAll();
      queueFade();
      setTimeout(queueFade, 400);   /* 等 0.34s 的宽度动画走完 */
    });

    /* 页面刚打开时概览还没填完，等一拍再量一次 */
    setTimeout(paintFade, 60);

    /* 概览展开收起（只有首页有） */
    var ovHead = nav.querySelector('#wrailOvHead');
    if (ovHead) {
      ovHead.addEventListener('click', function () {
        var ov = nav.querySelector('#wrailOverview');
        if (!nav.classList.contains('open')) {
          toggle.click();
          ov.classList.add('show');
          setMeta('railOvOpen', 1);
          return;
        }
        var show = !ov.classList.contains('show');
        ov.classList.toggle('show', show);
        setMeta('railOvOpen', show ? 1 : 0);
        queueFade();
        setTimeout(queueFade, 60);   /* 概览体 display 切换完再量 */
      });
    }

    /* 设置按钮：首页打开本地设置面板，模块页跳回首页再打开 */
    var setBtn = nav.querySelector('#wrailSetting');
    if (setBtn) {
      setBtn.addEventListener('click', function () {
        /* 设置面板是共享组件，任何页面都能直接打开 */
        if (window.WorkbenchSettings) {
          window.WorkbenchSettings.open();
        } else if (home) {
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

    document.body.classList.toggle('wrail-open', open);
    rail = nav;

    /* 导航建好了，概览的元素这时才存在，渲染一次把内容填上 */
    if (window.WorkbenchSide) {
      try { window.WorkbenchSide.renderAll(); } catch (e) {}
    }
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
