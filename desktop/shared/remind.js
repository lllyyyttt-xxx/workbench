/* 应用内提醒横幅
 *
 * 为什么要有这个：Windows 的通知总开关、专注助手、通知权限，
 * 任何一层关掉，系统通知就一声不响地没了。这条横幅走的是页面自己，
 * 只要工作台开着就一定看得见。
 *
 * 主进程每次 notify() 都会同步推一份过来，所以上课提醒、番茄钟结束、
 * 待办到期、倒计时到日子，全都自动带上，不用各处单独接。
 *
 * 用法：页面什么都不用写，引进来就行。
 *       想手动弹一条可以 window.WorkbenchRemind.show('标题', '正文')
 */
(function () {
  'use strict';

  if (window.WorkbenchRemind) return;

  var MAX = 3;          /* 同时最多挂三条，再多就挤了 */
  var LIFE = 12000;     /* 十二秒自己收起来 */

  var host = null;
  var live = [];

  function ensureHost() {
    if (host && host.parentNode) return host;
    host = document.createElement('div');
    host.className = 'wremind-stack';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
    return host;
  }

  function close(el, now) {
    if (!el || el.getAttribute('data-gone') === '1') return;
    el.setAttribute('data-gone', '1');

    var i = live.indexOf(el);
    if (i >= 0) live.splice(i, 1);

    if (now) {
      if (el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    el.classList.add('out');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 240);
  }

  function show(title, body) {
    if (!document.body) return null;

    var t = String(title || '提醒');
    var b = String(body || '');

    var box = ensureHost();
    var el = document.createElement('div');
    el.className = 'wremind';

    var head = document.createElement('div');
    head.className = 'wremind-head';

    var tt = document.createElement('div');
    tt.className = 'wremind-title';
    tt.textContent = t;                 /* 一律 textContent，不拼 HTML，省得注入 */

    var x = document.createElement('button');
    x.className = 'wremind-close';
    x.type = 'button';
    x.textContent = '×';
    x.setAttribute('aria-label', '关闭提醒');

    head.appendChild(tt);
    head.appendChild(x);
    el.appendChild(head);

    if (b) {
      var bd = document.createElement('div');
      bd.className = 'wremind-body';
      bd.textContent = b;
      el.appendChild(bd);
    }

    var bar = document.createElement('div');
    bar.className = 'wremind-bar';
    bar.style.animationDuration = LIFE + 'ms';
    el.appendChild(bar);

    box.appendChild(el);
    live.push(el);

    /* 三条以上，最旧的那条立刻让位 */
    while (live.length > MAX) close(live[0], true);

    var timer = 0;
    function arm() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { close(el); }, LIFE);
    }
    function disarm() {
      if (timer) { clearTimeout(timer); timer = 0; }
    }

    /* 鼠标停在上面说明在看，别掐掉 */
    el.addEventListener('mouseenter', disarm);
    el.addEventListener('mouseleave', arm);
    x.addEventListener('click', function (e) { e.stopPropagation(); close(el); });
    el.addEventListener('click', function () { close(el); });

    arm();
    return el;
  }

  function boot() {
    var sh = window.__WORKBENCH_SHELL__;
    if (!sh || typeof sh.onRemind !== 'function') return;
    try {
      sh.onRemind(function (d) {
        if (!d) return;
        show(d.title, d.body);
      });
    } catch (e) {}
  }

  window.WorkbenchRemind = { show: show, close: close };

  /* 脚本放在 body 末尾时 document.body 已经有了，直接订阅；
   * 放在 head 里就等 DOMContentLoaded。两条路都要能走通。 */
  if (document.body) boot();
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
