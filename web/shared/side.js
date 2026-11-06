/* 首页侧边栏：今日概览
 * 只读，不改任何数据。数据变了（别处改了记账、待办）会自动重新读。
 *
 * 类名统一加 ov- 前缀（2026-10-27）：
 * 这里生成的 html 要塞进全站共享的左侧导航，而各模块页自己也有 .empty / .txt /
 * .num 这类通用类名。原来用 .empty 这种裸类名，英语页面的
 * `.empty { padding: 60px 20px; }` 直接把概览的四个空态各撑高到 216 像素，
 * 整个概览从 344 高变成 1073 高，模块列表被挤出屏幕。
 * 现在的规矩：喂给导航的内容一律用 ov- 前缀，别再退回裸类名。
 */
window.WorkbenchSide = (function () {
  'use strict';

  var life = window.WorkbenchStore.namespace('life');
  var meta = window.WorkbenchStore.namespace('__workbench');

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function p2(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) {
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }

  /* 金额显示：去掉多余的零 */
  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    return String(v);
  }

  /* 今天 / 本月花了多少 */
  function renderToday() {
    var box = $('sideToday');
    if (!box) return;

    var expenses = life.get('expenses', []) || [];
    var today = dateStr(new Date());
    var ym = today.slice(0, 7);

    var todaySum = 0, monthSum = 0;
    var catSum = {};

    expenses.forEach(function (e) {
      var amt = Number(e.amount) || 0;
      var d = String(e.date || '');
      if (d.slice(0, 7) === ym) {
        monthSum += amt;
        catSum[e.cat || '其他'] = (catSum[e.cat || '其他'] || 0) + amt;
        if (d === today) todaySum += amt;
      }
    });

    /* 花得最多的两个类别 */
    var top = Object.keys(catSum).sort(function (a, b) {
      return catSum[b] - catSum[a];
    }).slice(0, 2);

    var html = '';
    if (!expenses.length) {
      html += '<div class="ov-empty">还没有记账</div>';
    } else {
      html += '<div class="ov-big">' + (todaySum ? money(todaySum) : '0') + '<small>元 今天</small></div>';
      html += '<div class="ov-sub">本月 ' + money(monthSum) + ' 元</div>';
      if (top.length) {
        html += '<div class="ov-sub">' + top.map(function (c) {
          return esc(c) + ' ' + money(catSum[c]);
        }).join('　') + '</div>';
      }
    }
    box.innerHTML = html;
  }

  /* 待办：没做完几件，最近那件是什么 */
  function renderTodos() {
    var box = $('sideTodos');
    if (!box) return;

    var todos = life.get('todos', []) || [];
    var open = todos.filter(function (t) { return !t.done; });
    var today = dateStr(new Date());

    if (!todos.length) {
      box.innerHTML = '<div class="ov-empty">还没有待办</div>';
      return;
    }
    if (!open.length) {
      box.innerHTML = '<div class="ov-empty">全都做完了</div>';
      return;
    }

    /* 有日期的排前面，日期早的优先；没日期的排后面 */
    var sorted = open.slice().sort(function (a, b) {
      var da = a.due || '9999-99-99';
      var db = b.due || '9999-99-99';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    var html = '<div class="ov-big">' + open.length + '<small>件没做完</small></div>';
    sorted.slice(0, 3).forEach(function (t) {
      var over = t.due && t.due < today;
      html += '<div class="ov-row"><span class="ov-dotline"' + (over ? ' style="background:#e07b39;"' : '') + '></span>' +
        '<span class="ov-txt' + (over ? ' ov-warn' : '') + '">' + esc(t.text || '') + '</span>' +
        (t.due ? '<span class="ov-num">' + (over ? '过期' : esc(t.due.slice(5))) + '</span>' : '') +
        '</div>';
    });
    box.innerHTML = html;
  }

  /* 规划：正在走的那个，做到第几步（数据在时间管理模块） */
  function renderPlans() {
    var box = $('sidePlans');
    if (!box) return;

    var plans = WorkbenchStore.namespace('time').get('plans', []) || [];
    if (!plans.length) {
      box.innerHTML = '<div class="ov-empty">还没有规划</div>';
      return;
    }

    /* 优先显示没走完的 */
    var doing = plans.filter(function (p) {
      var steps = p.steps || [];
      return steps.length && steps.filter(function (s) { return !s.done; }).length > 0;
    });

    if (!doing.length) {
      box.innerHTML = '<div class="ov-empty">' + (plans.length ? '规划都做完了' : '还没有规划') + '</div>';
      return;
    }

    var html = '';
    doing.slice(0, 2).forEach(function (p) {
      var steps = p.steps || [];
      var done = steps.filter(function (s) { return s.done; }).length;
      var next = null;
      for (var i = 0; i < steps.length; i++) {
        if (!steps[i].done) { next = steps[i]; break; }
      }
      html += '<div class="ov-row"><span class="ov-dotline"></span>' +
        '<span class="ov-txt">' + esc(p.text || '规划') + '</span>' +
        '<span class="ov-num">' + done + '/' + steps.length + '</span></div>';
      if (next) {
        html += '<div class="ov-sub" style="padding-left:12px;margin-bottom:2px;">下一步 ' +
          (next.at ? esc(next.at) + ' ' : '') + esc(next.text || '') + '</div>';
      }
    });
    box.innerHTML = html;
  }

  /* 倒计时：离得最近的那个还剩几天 */
  function renderCountdown() {
    var box = $('sideCountdown');
    if (!box) return;

    var cds = life.get('cds', []) || [];
    if (!cds.length) {
      box.innerHTML = '<div class="ov-empty">还没有倒计时</div>';
      return;
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var list = cds.map(function (c) {
      var target = new Date(c.date + 'T00:00:00');
      var days = Math.round((target - today) / 86400000);
      return { name: c.name || '倒计时', days: days, date: c.date };
    }).filter(function (c) {
      return !isNaN(c.days) && c.days >= 0;
    }).sort(function (a, b) {
      return a.days - b.days;
    });

    if (!list.length) {
      box.innerHTML = '<div class="ov-empty">都是过去的日子了</div>';
      return;
    }

    var html = '';
    list.slice(0, 2).forEach(function (c) {
      html += '<div class="ov-row"><span class="ov-txt">' + esc(c.name) + '</span>' +
        '<span class="ov-num' + (c.days <= 3 ? ' ov-warn' : '') + '">' +
        (c.days === 0 ? '就是今天' : '还有 ' + c.days + ' 天') + '</span></div>';
    });
    box.innerHTML = html;
  }

  /* 最近打开过的模块 */
  function renderRecent() {
    var block = $('sideRecentBlock');
    var box = $('sideRecent');
    if (!block || !box) return;

    var lastUsed = meta.get('lastUsed', {}) || {};
    var modules = window.WORKBENCH_MODULES || [];

    var list = modules.filter(function (m) {
      return m.href && lastUsed[m.id];
    }).sort(function (a, b) {
      return (lastUsed[a.id] || '') < (lastUsed[b.id] || '') ? 1 : -1;
    }).slice(0, 3);

    if (!list.length) {
      block.style.display = 'none';
      return;
    }
    block.style.display = '';

    /* 概览现在每个页面都有，跳转路径要按当前页面位置算：
     * 首页直接用 modules/xxx/，模块页要用 ../xxx/
     */
    var inModule = /\/modules\//.test(location.pathname);
    box.innerHTML = list.map(function (m) {
      var href = inModule ? m.href.replace(/^modules\//, '../') : m.href;
      return '<div class="ov-recent" data-go="' + esc(href) + '">' +
        '<span class="ov-ico" style="background:' + esc(m.color || '#00897b') + '">' +
        esc(m.icon || '·') + '</span>' +
        '<span>' + esc(m.name) + '</span></div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-go]'), function (el) {
      el.addEventListener('click', function () { location.href = el.dataset.go; });
    });
  }

  function renderAll() {
    renderToday();
    renderTodos();
    renderPlans();
    renderCountdown();
    renderRecent();
  }

  function init() {
    renderAll();
    /* 别处改了数据，这里跟着更新 */
    window.addEventListener('workbench:data', renderAll);
    /* 从别的页面回来时也可能有新数据 */
    window.addEventListener('focus', renderAll);
  }

  /* 页面加载完自动初始化（概览现在每个页面都有） */
  function autoInit() {
    try { init(); } catch (e) {
      if (window.console && console.warn) console.warn('概览初始化失败：', e);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  return { init: init, renderAll: renderAll };
})();
