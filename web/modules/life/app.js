/* 生活模块
 *
 * 四块内容：今天（总览）、记账、计划（待办 + 日常规划）、倒计时。
 * 数据存在 life 命名空间下，和别的模块互不影响。
 */
(function () {
  'use strict';

  var store = WorkbenchStore.namespace('life');
  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 数据 ---------------- */
  var DEFAULT_CATS = ['吃饭', '外卖', '买菜', '交通', '学习用品', '书籍', '娱乐', '衣服',
    '日用品', '房租水电', '话费网费', '医疗', '社交聚会', '给家里人买东西', '其他'];

  var db = {
    expenses: [],   // { id, date:'YYYY-MM-DD', amount:Number, cat, memo, src:'manual'|'import' }
    todos: [],      // { id, text, due:'YYYY-MM-DD'|'', done:bool, t }
    plans: [],      // { id, text, from, to, t }
    cds: [],        // { id, name, type:'once'|'monthly'|'yearly'|'weekly', date, day, t }
    cats: []
  };

  function loadDB() {
    db.expenses = store.get('expenses', []) || [];
    db.todos = store.get('todos', []) || [];
    db.plans = store.get('plans', []) || [];
    db.cds = store.get('cds', []) || [];
    db.cats = store.get('cats', null);
    if (!Array.isArray(db.cats) || !db.cats.length) db.cats = DEFAULT_CATS.slice();
  }

  function save(key) {
    if (key === 'expenses') store.set('expenses', db.expenses);
    else if (key === 'todos') store.set('todos', db.todos);
    else if (key === 'plans') store.set('plans', db.plans);
    else if (key === 'cds') store.set('cds', db.cds);
    else if (key === 'cats') store.set('cats', db.cats);
  }

  /* ---------------- 工具 ---------------- */
  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function dateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseDate(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    // 整数不显示小数，有小数时最多两位并去掉末尾多余的 0
    if (v % 1 === 0) return String(v);
    return String(parseFloat(v.toFixed(2)));
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var toastTimer = null;
  function toast(msg, bad) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2200);
  }

  /* ---------------- 视图切换 ---------------- */
  var currentView = 'today';
  function setView(v) {
    currentView = v;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.view === v);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) {
      s.classList.toggle('active', s.id === 'view-' + v);
    });
    if (v === 'today') renderToday();
    else if (v === 'money') renderMoney();
    else if (v === 'plan') renderPlan();
    else if (v === 'countdown') renderCountdown();
  }

  /* ---------------- 今天 ---------------- */
  // 只刷新总览页顶部的四个数字，不重画整页（因为可能不在总览上）
  function refreshTodayStats() {
    var td = todayStr();
    var todayExp = db.expenses.filter(function (e) { return e.date === td; });
    var todaySum = todayExp.reduce(function (a, e) { return a + e.amount; }, 0);
    $('sToday').innerHTML = money(todaySum) + '<small>元</small>';
    $('sTodaySub').textContent = todayExp.length ? '共 ' + todayExp.length + ' 笔' : '还没有记录';

    var now = new Date();
    var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    var monthExp = db.expenses.filter(function (e) { return e.date.indexOf(ym) === 0; });
    var monthSum = monthExp.reduce(function (a, e) { return a + e.amount; }, 0);
    $('sMonth').innerHTML = money(monthSum) + '<small>元</small>';
    $('sMonthSub').textContent = '日均 ' + money(monthSum / Math.max(1, now.getDate())) + ' 元';

    var openTodos = db.todos.filter(function (t) { return !t.done; });
    var dueToday = openTodos.filter(function (t) { return t.due && t.due <= td; });
    $('sTodo').innerHTML = openTodos.length + '<small>件</small>';
    $('sTodoSub').textContent = dueToday.length ? '其中 ' + dueToday.length + ' 件已到期' : (openTodos.length ? '没有到期的' : '没有待办');
  }

  function renderToday() {
    var td = todayStr();
    var todayExp = db.expenses.filter(function (e) { return e.date === td; });
    var todaySum = todayExp.reduce(function (a, e) { return a + e.amount; }, 0);
    $('sToday').innerHTML = money(todaySum) + '<small>元</small>';
    $('sTodaySub').textContent = todayExp.length ? '共 ' + todayExp.length + ' 笔' : '还没有记录';

    var now = new Date();
    var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
    var monthExp = db.expenses.filter(function (e) { return e.date.indexOf(ym) === 0; });
    var monthSum = monthExp.reduce(function (a, e) { return a + e.amount; }, 0);
    $('sMonth').innerHTML = money(monthSum) + '<small>元</small>';
    var days = now.getDate();
    $('sMonthSub').textContent = '日均 ' + money(monthSum / Math.max(1, days)) + ' 元';

    var openTodos = db.todos.filter(function (t) { return !t.done; });
    var dueToday = openTodos.filter(function (t) { return t.due && t.due <= td; });
    $('sTodo').innerHTML = openTodos.length + '<small>件</small>';
    $('sTodoSub').textContent = dueToday.length ? '其中 ' + dueToday.length + ' 件已到期' : (openTodos.length ? '没有到期的' : '没有待办');

    var near = nearestCountdown();
    if (near) {
      $('sCd').innerHTML = near.days + '<small>天</small>';
      $('sCdSub').textContent = near.name;
    } else {
      $('sCd').innerHTML = '—';
      $('sCdSub').textContent = '还没有添加';
    }

    renderTodayTodos(td);
    renderWeekChart();
  }

  function renderTodayTodos(td) {
    var box = $('todayTodos');
    var list = db.todos.filter(function (t) {
      if (t.done) return false;
      return !t.due || t.due <= td;
    });
    if (!list.length) {
      var rest = db.todos.filter(function (t) { return !t.done; }).length;
      box.innerHTML = '<li style="border:none;"><span class="empty-tip" style="padding:0;">' +
        (rest ? '今天没有到期的待办，还有 ' + rest + ' 件别的安排' : '今天没有待办，轻松一天') + '</span></li>';
      return;
    }
    box.innerHTML = list.map(function (t) {
      return '<li data-id="' + t.id + '">' +
        '<span class="chk" data-toggle="' + t.id + '"></span>' +
        '<span class="txt">' + esc(t.text) + '</span>' +
        (t.due ? '<span class="due">' + (t.due < td ? '已过期' : '今天到期') + '</span>' : '') +
        '</li>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-toggle]'), function (el) {
      el.addEventListener('click', function () {
        toggleTodo(el.dataset.toggle);
        renderToday();
      });
    });
  }

  function renderWeekChart() {
    var days = [];
    var d = new Date();
    for (var i = 6; i >= 0; i--) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
      days.push(dateStr(x));
    }
    var vals = days.map(function (ds) {
      return db.expenses.filter(function (e) { return e.date === ds; })
        .reduce(function (a, e) { return a + e.amount; }, 0);
    });
    $('weekChart').innerHTML = barChart(days.map(function (ds) { return Number(ds.slice(8)) + '日'; }), vals,
      { height: 150, color: '#e0a58c', showValue: true, el: 'weekChart' });
  }

  /* ---------------- 简单图表 ---------------- */
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / pow;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return m * pow;
  }

  function barChart(labels, values, opt) {
    opt = opt || {};
    var h = opt.height || 140;
    var boxW = 0;
    if (opt.el) {
      var host = $(opt.el);
      if (host) boxW = host.clientWidth || 0;
    }

    /* 宽度直接用容器的实际宽度。
     * 以前是「点数多就把画布撑宽、再用缩放塞回容器」，
     * 结果整张图被横向压扁，横轴的日期全叠在一起看不清。 */
    var w = boxW || Math.max(320, labels.length * 46);
    var padL = 34, padR = 10, padT = 14, padB = 24;
    var innerW = w - padL - padR;
    var innerH = h - padT - padB;
    var max = Math.max.apply(null, values.concat([1]));

    /* 纵轴刻度要先算出来，柱子的高度依赖它。
     * 这里原来顺序颠倒了，柱子拿到的是空值，算出来的高度是无效数，
     * 于是记了账也画不出柱子，图上永远只有网格线。 */
    var step = niceStep(max / 3);
    var top = Math.ceil(max / step) * step;
    var scaleMax = top || 1;

    /* 点太多就隔几个显示一个日期，不然挤成一团 */
    var labelStep = labels.length > 10 ? Math.ceil(labels.length / 7) : 1;
    var slot = innerW / Math.max(1, values.length);

    var bars = values.map(function (v, i) {
      var bw = Math.max(3, slot * 0.52);
      var x = padL + slot * (i + 0.5) - bw / 2;
      var bh = innerH * (v / scaleMax);
      var y = padT + innerH - bh;
      var showLabel = (i % labelStep === 0) || (i === values.length - 1);
      var val = opt.showValue && v > 0
        ? '<text x="' + (x + bw / 2) + '" y="' + (y - 4) +
          '" text-anchor="middle" font-size="10" fill="#b0a69e">' + money(v) + '</text>'
        : '';
      var lab = showLabel
        ? '<text x="' + (x + bw / 2) + '" y="' + (h - 8) +
          '" text-anchor="middle" font-size="10" fill="#a09790">' + esc(labels[i]) + '</text>'
        : '';
      return '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + Math.max(1, bh) +
        '" rx="3" fill="' + (opt.color || '#c0775c') + '"></rect>' + val + lab;
    }).join('');

    var grid = '';
    for (var gv = 0; gv <= scaleMax + 0.001; gv += step) {
      var gy = padT + innerH * (1 - gv / scaleMax);
      grid += '<line x1="' + padL + '" y1="' + gy + '" x2="' + (w - padR) + '" y2="' + gy +
        '" stroke="#f2eee9"></line>' +
        '<text x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="10" fill="#c0b6ae">' +
        money(gv) + '</text>';
    }

    return '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:' + h + 'px;overflow:visible">' +
      grid + bars + '</svg>';
  }

  function pieChart(items) {
    var total = items.reduce(function (a, it) { return a + it.value; }, 0);
    if (!total) return '<div class="empty-tip">这个月还没有支出</div>';
    var w = 320, h = 190, cx = 110, cy = 95, r = 76;
    var svgHead = '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:auto;height:' + h + 'px;max-width:100%">';

    /* 只有一种类型时，它占了整个圆。
     * 圆弧的起点和终点重合，用路径画出来是空的，所以这里直接画一个圆。 */
    if (items.length === 1) {
      return svgHead + '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
        '" fill="' + items[0].color + '"></circle></svg>';
    }

    var start = -Math.PI / 2;
    var paths = items.map(function (it) {
      var ang = it.value / total * Math.PI * 2;
      var end = start + ang;
      var x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
      var x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
      var large = ang > Math.PI ? 1 : 0;
      var d = 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
        ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z';
      var seg = '<path d="' + d + '" fill="' + it.color + '"></path>';
      start = end;
      return seg;
    }).join('');
    return svgHead + paths + '</svg>';
  }

  var PALETTE = ['#c0775c', '#d9a05b', '#a8b56a', '#7ba7a0', '#8d8bb5', '#c98b9a',
    '#b7874b', '#8fa7c4', '#a89a76', '#9d7f95', '#7e9a7a', '#c4a484'];

  /* ---------------- 记账 ---------------- */
  var viewYM = (function () { var d = new Date(); return { y: d.getFullYear(), m: d.getMonth() + 1 }; })();

  function renderCatSelects() {
    var opts = db.cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    var a = $('inCat'); if (a) a.innerHTML = opts;
    var b = $('impCat');
    if (b) b.innerHTML = '<option value="未分类">未分类</option>' + opts;
  }

  function renderMoney() {
    renderCatSelects();
    if (!$('inDate').value) $('inDate').value = todayStr();
    renderMonth();
  }

  function renderMonth() {
    var y = viewYM.y, m = viewYM.m;
    var prefix = y + '-' + pad(m);
    $('monthLabel').textContent = y + '年' + m + '月';

    var list = db.expenses.filter(function (e) { return e.date.indexOf(prefix) === 0; });
    var total = list.reduce(function (a, e) { return a + e.amount; }, 0);
    $('monthTotal').textContent = money(total);

    // 按天分组
    var byDay = {};
    list.forEach(function (e) {
      (byDay[e.date] = byDay[e.date] || []).push(e);
    });
    var days = Object.keys(byDay).sort(function (a, b) { return b.localeCompare(a); });
    var box = $('expenseList');
    if (!days.length) {
      box.innerHTML = '<div class="empty-tip">这个月还没有记录</div>';
    } else {
      var todayKey = todayStr();
      box.innerHTML = days.map(function (d) {
        var items = byDay[d].slice().sort(function (a, b) { return b.t - a.t; });
        var sum = items.reduce(function (a, e) { return a + e.amount; }, 0);
        var dd = Number(d.slice(8));
        // 今天的默认展开，其余日期默认收起，点一下展开
        var open = d === todayKey;
        return '<div class="day-group' + (open ? ' open' : '') + '">' +
          '<div class="day-head' + (open ? ' open' : '') + '" data-day="' + d + '">' +
          '<span class="arrow">▶</span>' +
          '<span class="d">' + dd + ' 号</span>' +
          '<span class="cnt">' + items.length + ' 笔</span>' +
          '<span class="sum">' + money(sum) + '</span></div>' +
          '<div class="day-items">' +
          items.map(function (e) {
            return '<div class="item">' +
              '<span class="tag">' + esc(e.cat) + '</span>' +
              (e.memo ? '<span class="memo">' + esc(e.memo) + '</span>' : '') +
              (e.src === 'import' ? '<span class="tag" style="background:#eef2f5;color:#8fa7c4;">导入</span>' : '') +
              '<span class="amt">' + money(e.amount) + '</span>' +
              '<span class="ops">' +
              '<button class="btn-ghost" data-edit="' + e.id + '">改</button>' +
              '<button class="btn-ghost btn-danger-text" data-del="' + e.id + '">删</button>' +
              '</span></div>';
          }).join('') +
          '</div></div>';
      }).join('');
    }
    bindExpenseOps();

    var td = todayStr();
    var todaySum = db.expenses.filter(function (e) { return e.date === td; })
      .reduce(function (a, e) { return a + e.amount; }, 0);
    $('todayHint').textContent = '今天已记 ' + money(todaySum) + ' 元';

    renderAnalysis(prefix);
  }

  function bindExpenseOps() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-day]'), function (h) {
      h.addEventListener('click', function () {
        var g = h.parentNode;
        g.classList.toggle('open');
        h.classList.toggle('open');
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.del;
        if (!confirm('删除这笔记录？')) return;
        db.expenses = db.expenses.filter(function (e) { return e.id !== id; });
        save('expenses');
        renderMonth();
        refreshTodayStats();
        toast('已删除');
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () {
        editExpense(b.dataset.edit);
      });
    });
  }

  function editExpense(id) {
    var e = db.expenses.filter(function (x) { return x.id === id; })[0];
    if (!e) return;

    // 金额：填错了就停下来，不改任何东西
    var a = prompt('修改金额：', e.amount);
    if (a === null) return;
    var n = Number(a);
    if (!(n > 0)) { toast('金额不对，这次没有改动', true); return; }

    // 类型：允许改成列表里没有的，但要提示一下
    var c = prompt('修改类型（可选，现有：' + db.cats.join('、') + '）：', e.cat);
    if (c === null) return;
    var newCat = c.trim() || e.cat;
    if (newCat !== e.cat && db.cats.indexOf(newCat) < 0) {
      if (!confirm('「' + newCat + '」不在你的类型列表里，仍然改成这个吗？\n（之后可以在「管理类型」里加进去）')) return;
    }

    // 日期：导入的账记错了日子，要能改
    var ds = prompt('修改日期（格式 2026-10-26，留空则不改）：', e.date);
    if (ds === null) return;
    var newDate = ds.trim() || e.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      toast('日期格式不对，这次没有改动', true);
      return;
    }
    var testD = new Date(newDate + 'T00:00:00');
    if (isNaN(testD.getTime())) { toast('日期不存在，这次没有改动', true); return; }

    var m = prompt('修改备注（留空则清空）：', e.memo || '');
    if (m === null) return;

    // 全部确认完再一次性写入，中途取消不会留下半截改动
    e.amount = Math.round(n * 100) / 100;
    e.cat = newCat;
    e.date = newDate;
    e.memo = m.trim();
    save('expenses');
    renderMonth();
    refreshTodayStats();
    toast('已更新');
  }

  function addExpense() {
    var raw = $('inAmount').value.trim();
    var n = Number(raw);
    if (!raw || !(n > 0)) { toast('先填一个金额', true); $('inAmount').focus(); return; }
    var date = $('inDate').value || todayStr();
    db.expenses.push({
      id: uid(),
      date: date,
      amount: Math.round(n * 100) / 100,
      cat: $('inCat').value || '其他',
      memo: $('inMemo').value.trim(),
      src: 'manual',
      t: Date.now()
    });
    save('expenses');
    $('inAmount').value = '';
    $('inMemo').value = '';
    $('inAmount').focus();
    // 如果记的是别的月份，切过去看得到
    if (date.indexOf(viewYM.y + '-' + pad(viewYM.m)) !== 0) {
      viewYM = { y: Number(date.slice(0, 4)), m: Number(date.slice(5, 7)) };
    }
    renderMonth();
    // 总览页的「今天花销」也要跟着变，否则切回去还是旧数字
    refreshTodayStats();
    toast('已记下 ' + money(n) + ' 元');
  }

  function renderAnalysis(prefix) {
    var list = db.expenses.filter(function (e) { return e.date.indexOf(prefix) === 0; });
    var y = Number(prefix.slice(0, 4)), m = Number(prefix.slice(5, 7));
    var daysInMonth = new Date(y, m, 0).getDate();
    var labels = [], values = [];
    for (var d = 1; d <= daysInMonth; d++) {
      var ds = prefix + '-' + pad(d);
      labels.push(String(d));
      values.push(list.filter(function (e) { return e.date === ds; })
        .reduce(function (a, e) { return a + e.amount; }, 0));
    }
    $('dayChart').innerHTML = barChart(labels, values, { height: 150, color: '#dfae95', el: 'dayChart' });

    var byCat = {};
    list.forEach(function (e) { byCat[e.cat] = (byCat[e.cat] || 0) + e.amount; });
    var items = Object.keys(byCat).map(function (k, i) {
      return { name: k, value: byCat[k], color: PALETTE[i % PALETTE.length] };
    }).sort(function (a, b) { return b.value - a.value; });

    $('catChart').innerHTML = pieChart(items);
    $('catLegend').innerHTML = items.slice(0, 8).map(function (it) {
      var total = items.reduce(function (a, x) { return a + x.value; }, 0);
      return '<span class="lg"><span class="dot" style="background:' + it.color + '"></span>' +
        esc(it.name) + ' ' + money(it.value) + '（' + Math.round(it.value / total * 100) + '%）</span>';
    }).join('');

    var total = list.reduce(function (a, e) { return a + e.amount; }, 0);
    var maxDay = 0, maxVal = 0;
    values.forEach(function (v, i) { if (v > maxVal) { maxVal = v; maxDay = i + 1; } });
    $('analysisHint').textContent = list.length
      ? '共 ' + list.length + ' 笔 · 合计 ' + money(total) + ' 元' +
        (maxVal ? ' · 花得最多的是 ' + maxDay + ' 号（' + money(maxVal) + ' 元）' : '')
      : '';
  }

  /* ---------------- 待办 ---------------- */
  function toggleTodo(id) {
    var t = db.todos.filter(function (x) { return x.id === id; })[0];
    if (!t) return;
    t.done = !t.done;
    save('todos');
  }

  function addTodo() {
    var v = $('inTodo').value.trim();
    if (!v) { toast('先写点什么', true); return; }
    db.todos.unshift({ id: uid(), text: v, due: $('inTodoDue').value || '', done: false, t: Date.now() });
    save('todos');
    $('inTodo').value = '';
    $('inTodoDue').value = '';
    renderPlan();
    toast('已添加');
  }

  function renderPlan() {
    var box = $('todoList');
    var list = db.todos.slice().sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      var ad = a.due || '9999', bd = b.due || '9999';
      return ad.localeCompare(bd);
    });
    if (!list.length) {
      box.innerHTML = '<li style="border:none;"><span class="empty-tip" style="padding:0;">还没有待办</span></li>';
    } else {
      box.innerHTML = list.map(function (t) {
        return '<li data-id="' + t.id + '">' +
          '<span class="chk" data-tt="' + t.id + '" style="width:18px;height:18px;border:1.5px solid #d8cfc7;border-radius:5px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;' +
          (t.done ? 'background:#7cb342;border-color:#7cb342;' : '') + '">' + (t.done ? '✓' : '') + '</span>' +
          '<div class="body"><div class="t ' + (t.done ? 'done' : '') + '">' + esc(t.text) + '</div>' +
          (t.due ? '<div class="meta">截止 ' + t.due + '</div>' : '') + '</div>' +
          '<div class="ops"><button class="btn-ghost btn-sm btn-danger-text" data-td="' + t.id + '">删除</button></div>' +
          '</li>';
      }).join('');
    }
    Array.prototype.forEach.call(box.querySelectorAll('[data-tt]'), function (el) {
      el.addEventListener('click', function () { toggleTodo(el.dataset.tt); renderPlan(); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-td]'), function (el) {
      el.addEventListener('click', function () {
        db.todos = db.todos.filter(function (x) { return x.id !== el.dataset.td; });
        save('todos'); renderPlan();
      });
    });

  }


  /* ---------------- 倒计时 ---------------- */
  function nextDateOf(cd) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (cd.type === 'once') {
      if (!cd.date) return null;
      var d = parseDate(cd.date);
      return { d: d, past: d < today };
    }
    if (cd.type === 'monthly') {
      var day = Math.min(Number(cd.day) || 1, 31);
      var y = today.getFullYear(), m = today.getMonth();
      for (var k = 0; k < 13; k++) {
        var cand = new Date(y, m + k, Math.min(day, new Date(y, m + k + 1, 0).getDate()));
        if (cand >= today) return { d: cand, past: false };
      }
      return null;
    }
    if (cd.type === 'yearly') {
      var base = cd.date ? parseDate(cd.date) : null;
      if (!base) return null;
      var mm = base.getMonth(), dd = base.getDate();
      var c = new Date(today.getFullYear(), mm, dd);
      if (c < today) c = new Date(today.getFullYear() + 1, mm, dd);
      return { d: c, past: false };
    }
    if (cd.type === 'weekly') {
      var target = Number(cd.day) || 1; // 1=周一
      var cur = today.getDay() === 0 ? 7 : today.getDay();
      var diff = (target - cur + 7) % 7;
      var w = new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
      return { d: w, past: false };
    }
    return null;
  }

  function daysBetween(a, b) {
    var ms = b.getTime() - a.getTime();
    return Math.round(ms / 86400000);
  }

  function nearestCountdown() {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var best = null;
    db.cds.forEach(function (cd) {
      var nx = nextDateOf(cd);
      if (!nx || nx.past) return;
      var days = daysBetween(today, nx.d);
      if (!best || days < best.days) best = { name: cd.name, days: days };
    });
    return best;
  }

  function renderCountdown() {
    var box = $('cdList');
    if (!db.cds.length) {
      box.innerHTML = '<div class="empty-tip" style="grid-column:1/-1;">还没有倒计时。上面加一个，比如交房租、生日、放假。</div>';
      return;
    }
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var items = db.cds.map(function (cd) {
      var nx = nextDateOf(cd);
      if (!nx) return { cd: cd, days: null, past: true, txt: '' };
      var days = daysBetween(today, nx.d);
      return { cd: cd, days: days, past: nx.past, txt: dateStr(nx.d) };
    }).sort(function (a, b) {
      if (a.past !== b.past) return a.past ? 1 : -1;
      return (a.days === null ? 1e9 : a.days) - (b.days === null ? 1e9 : b.days);
    });

    box.innerHTML = items.map(function (it) {
      var cd = it.cd;
      var typeLabel = { once: '一次性', monthly: '每月', yearly: '每年', weekly: '每周' }[cd.type] || '';
      var num, sub;
      if (it.past) {
        num = '—'; sub = '日期已过';
      } else {
        num = it.days + '<small>天</small>';
        sub = it.txt + ' · ' + typeLabel;
      }
      return '<div class="cd-card' + (it.past ? ' past' : '') + '" data-cd="' + cd.id + '">' +
        '<button class="del" data-cddel="' + cd.id + '">×</button>' +
        '<div class="nm">' + esc(cd.name) + '</div>' +
        '<div class="num">' + num + '</div>' +
        '<div class="dd">' + esc(sub) + '</div></div>';
    }).join('');

    Array.prototype.forEach.call(box.querySelectorAll('[data-cddel]'), function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('删除这个倒计时？')) return;
        db.cds = db.cds.filter(function (x) { return x.id !== b.dataset.cddel; });
        save('cds'); renderCountdown();
      });
    });
  }

  function addCountdown() {
    var name = $('inCdName').value.trim();
    if (!name) { toast('先填个名字', true); return; }
    var type = $('inCdType').value;
    var cd = { id: uid(), name: name, type: type, date: '', day: '', t: Date.now() };
    if (type === 'once') {
      if (!$('inCdDate').value) { toast('选一个日期', true); return; }
      cd.date = $('inCdDate').value;
    } else if (type === 'monthly') {
      var d = Number($('inCdDay').value);
      if (!(d >= 1 && d <= 31)) { toast('填 1 到 31 之间的号数', true); return; }
      cd.day = d;
    } else if (type === 'yearly') {
      if (!$('inCdDate').value) { toast('选一个日期', true); return; }
      cd.date = $('inCdDate').value;
    } else if (type === 'weekly') {
      var w = Number($('inCdWeek').value);
      cd.day = w;
    }
    db.cds.push(cd);
    save('cds');
    $('inCdName').value = '';
    renderCountdown();
    toast('已添加');
  }

  /* ---------------- 类型管理 ---------------- */
  function renderCatList() {
    var box = $('catListView');
    box.innerHTML = db.cats.map(function (c) {
      var used = db.expenses.some(function (e) { return e.cat === c; });
      return '<li><span class="body" style="font-size:14px;">' + esc(c) + '</span>' +
        '<button class="btn-ghost btn-sm btn-danger-text" data-catdel="' + esc(c) + '"' +
        (used ? ' disabled title="这个类型已经有记录在用"' : '') + '>删除</button></li>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('[data-catdel]'), function (b) {
      b.addEventListener('click', function () {
        var c = b.dataset.catdel;
        db.cats = db.cats.filter(function (x) { return x !== c; });
        save('cats');
        renderCatList();
        renderCatSelects();
      });
    });
  }

  function addCat() {
    var v = $('inNewCat').value.trim();
    if (!v) return;
    if (db.cats.indexOf(v) >= 0) { toast('已经有这个类型了', true); return; }
    db.cats.push(v);
    save('cats');
    $('inNewCat').value = '';
    renderCatList();
    renderCatSelects();
    toast('已添加类型');
  }

  /* ---------------- 导入 ---------------- */
  var parsedRows = null;

  var NUM = '\\d+(?:\\.\\d+)?';
  function parseLedger(text) {
    var lines = String(text).split(/\r?\n/);
    var rows = [];
    lines.forEach(function (line, idx) {
      if (!line.trim()) return;
      if (/账本|合计|总额/.test(line) && !/号/.test(line)) return;
      var m = line.match(/^\s*(\d{1,2})\s*[号日]\s*(.*)$/);
      if (!m) {
        // 也支持 2026-10-05 这类完整日期
        var m2 = line.match(/^\s*(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s*[：:号]?\s*(.*)$/);
        if (!m2) {
          if (/\d/.test(line)) rows.push({ raw: line, day: null, warn: '看不懂这一行' });
          return;
        }
        rows.push({
          raw: line, day: null, fullDate: m2[1] + '-' + pad(Number(m2[2])) + '-' + pad(Number(m2[3])),
          nums: extractNums(m2[4]), total: extractTotal(m2[4]), warn: ''
        });
        return;
      }
      var day = Number(m[1]);
      var rest = m[2].trim();
      var nums = extractNums(rest);
      var total = extractTotal(rest);
      var warn = '';
      if (!nums.length) warn = '这天没有金额';
      else if (/[+＋]\s*$/.test(rest)) warn = '最后一项没写完';
      else if (total !== null && Math.abs(nums.reduce(function (a, b) { return a + b; }, 0) - total) > 0.02) {
        warn = '明细和合计对不上';
      }
      rows.push({ raw: line, day: day, nums: nums, total: total, warn: warn });
    });
    return rows;
  }

  function extractNums(s) {
    if (!s) return [];
    var left = s.indexOf('=') >= 0 ? s.slice(0, s.indexOf('=')) : s;
    var out = [];
    left.split(/[+＋]/).forEach(function (part) {
      var v = part.match(new RegExp('^\\s*(' + NUM + ')'));
      if (v) out.push(Number(v[1]));
    });
    return out;
  }

  function extractTotal(s) {
    var m = s.match(new RegExp('=\\s*(' + NUM + ')'));
    return m ? Number(m[1]) : null;
  }

  function yearMonthFromText(text) {
    var m = String(text).match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
    if (m) return { y: Number(m[1]), m: Number(m[2]) };
    var cn = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 };
    var m2 = String(text).match(/(十一|十二|一|二|三|四|五|六|七|八|九|十)\s*月/);
    if (m2) return { m: cn[m2[1]] };
    return null;
  }

  function doParse() {
    var text = $('pasteArea').value;
    if (!text.trim()) { toast('先把内容贴进来', true); return; }
    var ym = yearMonthFromText(text);
    if (ym) {
      if (ym.y) $('impYear').value = ym.y;
      if (ym.m) $('impMonth').value = ym.m;
    }
    parsedRows = parseLedger(text);
    renderPreview();
  }

  function renderPreview() {
    var box = $('impPreview');
    if (!parsedRows || !parsedRows.length) {
      box.innerHTML = '<div class="pv-sum">没有识别到任何记录。请确认格式是「2 号 3.8+1.5=5.3」这样。</div>';
      $('btnDoImport').disabled = true;
      return;
    }
    var y = Number($('impYear').value) || new Date().getFullYear();
    var m = Number($('impMonth').value) || (new Date().getMonth() + 1);
    var valid = 0, totalAmt = 0, cnt = 0;
    var html = parsedRows.map(function (r) {
      if (r.warn && !r.nums) {
        return '<div class="pv-row warn"><span class="pd">—</span><span class="pn">' + esc(r.warn) + '：' + esc(r.raw.slice(0, 40)) + '</span></div>';
      }
      if (!r.nums || !r.nums.length) {
        return '<div class="pv-row warn"><span class="pd">' + (r.day !== null ? r.day + ' 号' : '—') + '</span>' +
          '<span class="pn">没有金额，跳过</span></div>';
      }
      var sum = r.nums.reduce(function (a, b) { return a + b; }, 0);
      valid++; cnt += r.nums.length; totalAmt += sum;
      return '<div class="pv-row' + (r.warn ? ' warn' : '') + '">' +
        '<span class="pd">' + (r.day !== null ? r.day + ' 号' : r.fullDate) + '</span>' +
        '<span class="pn">' + r.nums.length + ' 笔' + (r.warn ? ' · ' + r.warn : '') + '</span>' +
        '<span class="pa">' + money(sum) + '</span></div>';
    }).join('');

    var sumBar = '<div class="pv-sum pv-sticky">共识别 <b>' + valid + '</b> 天、<b>' + cnt + '</b> 笔明细，' +
      '合计 <b>' + money(totalAmt) + '</b> 元 · 导入到 ' + y + '年' + m + '月 · 类型「' + esc($('impCat').value) + '」</div>';
    box.innerHTML = sumBar + html;
    $('btnDoImport').disabled = valid === 0;
  }

  function doImport() {
    if (!parsedRows) return;
    var y = Number($('impYear').value) || new Date().getFullYear();
    var m = Number($('impMonth').value) || (new Date().getMonth() + 1);
    var cat = $('impCat').value || '未分类';
    var added = 0;
    parsedRows.forEach(function (r) {
      if (!r.nums || !r.nums.length) return;
      r.nums.forEach(function (v) {
        var date = r.fullDate || (y + '-' + pad(m) + '-' + pad(r.day));
        db.expenses.push({
          id: uid(), date: date, amount: Math.round(v * 100) / 100,
          cat: cat, memo: '', src: 'import', t: Date.now()
        });
        added++;
      });
    });
    save('expenses');
    closeModal('importModal');
    parsedRows = null;
    $('impPreview').innerHTML = '';
    $('pasteArea').value = '';
    $('btnDoImport').disabled = true;
    viewYM = { y: y, m: m };
    setView('money');
    toast('已导入 ' + added + ' 笔');
  }

  /* ---------------- 从 PDF 取文字 ---------------- */
  // PDF 里的中文通常用自定义编码存，需要靠 ToUnicode 映射表还原。
  // 这里用浏览器自带的解压能力解开内容流，再按映射表把编码换回文字。
  function bytesToString(bytes) {
    var out = '';
    var CHUNK = 8192;
    for (var i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return out;
  }

  async function inflateBytes(bytes) {
    if (typeof DecompressionStream !== 'function') return null;
    // zlib 流用 deflate，裸流用 deflate-raw
    for (var fmt of ['deflate', 'deflate-raw']) {
      try {
        var ds = new DecompressionStream(fmt);
        var resp = new Response(new Blob([bytes]).stream().pipeThrough(ds));
        var buf = await resp.arrayBuffer();
        return new Uint8Array(buf);
      } catch (e) { /* 换下一种 */ }
    }
    return null;
  }

  function parseToUnicode(cmapText) {
    var map = {};
    var reChar = /beginbfchar([\s\S]*?)endbfchar/g;
    var m;
    while ((m = reChar.exec(cmapText)) !== null) {
      var pair = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, pm;
      while ((pm = pair.exec(m[1])) !== null) {
        map[parseInt(pm[1], 16)] = hexToStr(pm[2]);
      }
    }
    var reRange = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = reRange.exec(cmapText)) !== null) {
      var tri = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g, tm;
      while ((tm = tri.exec(m[1])) !== null) {
        var lo = parseInt(tm[1], 16), hi = parseInt(tm[2], 16), base = parseInt(tm[3], 16);
        for (var k = lo; k <= hi && k - lo < 65536; k++) {
          map[k] = String.fromCharCode(base + (k - lo));
        }
      }
    }
    return map;
  }

  function hexToStr(hex) {
    var out = '';
    for (var i = 0; i + 3 < hex.length + 1; i += 4) {
      out += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
    }
    return out;
  }

  function decodePdfHex(hex, cmap) {
    var out = '';
    for (var i = 0; i + 3 < hex.length + 1; i += 4) {
      var code = parseInt(hex.substr(i, 4), 16);
      out += cmap[code] !== undefined ? cmap[code] : '';
    }
    return out;
  }

  function unescapePdf(s) {
    return s.replace(/\\([()\\])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\t/g, '\t');
  }

  async function extractTextFromPdf(arrayBuffer) {
    var bytes = new Uint8Array(arrayBuffer);
    var latin = bytesToString(bytes);

    // 1. 逐个内容流解开，找出映射表和文字
    // 注意：latin 只用来定位位置（一个字符对应一个字节），
    // 真正的流内容必须从原始字节里切，不能从字符串转回去，否则字节会丢。
    var cmap = {};
    var textFlows = [];
    // stream 关键字后面可能紧跟换行，也可能直接就是数据，两种都要处理
    var re = /stream/g;
    var m;
    while ((m = re.exec(latin)) !== null) {
      var absStart = m.index + 6;
      var c1 = latin.charCodeAt(absStart);
      if (c1 === 13) { absStart += 1; if (latin.charCodeAt(absStart) === 10) absStart += 1; }
      else if (c1 === 10) { absStart += 1; }
      var endIdx = latin.indexOf('endstream', absStart);
      if (endIdx < 0) continue;
      // endstream 前面通常有一个换行，属于分隔不算数据
      var stop = endIdx;
      if (latin.charCodeAt(stop - 1) === 10) stop--;
      if (latin.charCodeAt(stop - 1) === 13) stop--;
      var streamBytes = bytes.slice(absStart, stop);
      if (!streamBytes.length) continue;

      var inflated = await inflateBytes(streamBytes);
      var text = inflated ? bytesToString(inflated) : streamBytes.length < 400000 ? bytesToString(streamBytes) : '';

      if (text.indexOf('beginbfchar') >= 0 || text.indexOf('beginbfrange') >= 0) {
        var cm = parseToUnicode(text);
        for (var k in cm) cmap[k] = cm[k];
      }
      if (text.indexOf('BT') >= 0 && text.indexOf('Tj') >= 0) {
        textFlows.push(text);
      }
    }

    // 2. 按位置取出文字块
    var runs = [];
    textFlows.forEach(function (flow) {
      var btRe = /BT([\s\S]*?)ET/g, bm;
      while ((bm = btRe.exec(flow)) !== null) {
        var seg = bm[1];
        var tm = seg.match(/([\d.\-]+)\s+([\d.\-]+)\s+Tm/);
        if (!tm) continue;
        var x = parseFloat(tm[1]), y = parseFloat(tm[2]);
        var txt = '';
        var sre = /<([0-9A-Fa-f\s]+)>\s*Tj|\(((?:\\.|[^\\)])*)\)\s*Tj|\[([\s\S]*?)\]\s*TJ/g, sm;
        while ((sm = sre.exec(seg)) !== null) {
          if (sm[1] !== undefined) {
            txt += decodePdfHex(sm[1].replace(/\s/g, ''), cmap);
          } else if (sm[2] !== undefined) {
            txt += unescapePdf(sm[2]);
          } else if (sm[3] !== undefined) {
            var pre = /\(((?:\\.|[^\\)])*)\)/g, pm;
            while ((pm = pre.exec(sm[3])) !== null) txt += unescapePdf(pm[1]);
          }
        }
        if (txt.trim()) runs.push({ y: y, x: x, t: txt });
      }
    });

    if (!runs.length) return '';

    // 3. 按纵坐标聚成行
    runs.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var lines = [], curY = null, buf = [];
    runs.forEach(function (r) {
      if (curY === null || Math.abs(r.y - curY) > 4) {
        if (buf.length) lines.push(buf.join(''));
        buf = [r.t];
        curY = r.y;
      } else {
        buf.push(r.t);
      }
    });
    if (buf.length) lines.push(buf.join(''));
    return lines.join('\n');
  }

  /* ---------------- 弹层 ---------------- */
  function openModal(id) { $(id).classList.add('show'); }
  function closeModal(id) { $(id).classList.remove('show'); }

  function setupModals() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { closeModal(b.dataset.close); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.modal-mask'), function (mask) {
      mask.addEventListener('click', function (e) {
        if (e.target === mask) mask.classList.remove('show');
      });
    });
  }

  /* ---------------- 初始化 ---------------- */
  function setup() {
    loadDB();
    renderCatSelects();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { setView(b.dataset.view); });
    });

    var d = new Date();
    var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    $('dateNow').textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;

    $('btnAddExpense').addEventListener('click', addExpense);
    $('inAmount').addEventListener('keydown', function (e) { if (e.key === 'Enter') addExpense(); });
    $('inMemo').addEventListener('keydown', function (e) { if (e.key === 'Enter') addExpense(); });
    $('prevMonth').addEventListener('click', function () {
      viewYM.m--; if (viewYM.m < 1) { viewYM.m = 12; viewYM.y--; } renderMonth();
    });
    $('nextMonth').addEventListener('click', function () {
      viewYM.m++; if (viewYM.m > 12) { viewYM.m = 1; viewYM.y++; } renderMonth();
    });
    $('goMoney').addEventListener('click', function () { setView('money'); });
    $('quickAddTodo').addEventListener('click', function () { setView('plan'); $('inTodo').focus(); });

    $('btnAddTodo').addEventListener('click', addTodo);
    $('inTodo').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTodo(); });
    $('btnClearDone').addEventListener('click', function () {
      var n = db.todos.filter(function (t) { return t.done; }).length;
      if (!n) { toast('没有已完成的'); return; }
      db.todos = db.todos.filter(function (t) { return !t.done; });
      save('todos'); renderPlan();
      toast('清掉 ' + n + ' 条');
    });

    $('btnAddCd').addEventListener('click', addCountdown);
    $('inCdType').addEventListener('change', function () {
      var t = this.value;
      $('cdDateField').style.display = (t === 'once' || t === 'yearly') ? 'flex' : 'none';
      $('cdDayField').style.display = (t === 'monthly') ? 'flex' : 'none';
      $('cdWeekField').style.display = (t === 'weekly') ? 'flex' : 'none';
    });

    $('btnManageCats').addEventListener('click', function () { renderCatList(); openModal('catModal'); });
    $('btnAddCat').addEventListener('click', addCat);
    $('inNewCat').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCat(); });
    // 其余输入框也支持回车提交，省得每次都用鼠标点按钮
    $('inTodoDue').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTodo(); });
    $('inCdName').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCountdown(); });
    $('inCdDay').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCountdown(); });
    $('inCdWeek').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCountdown(); });

    $('btnImport').addEventListener('click', function () {
      $('impYear').value = new Date().getFullYear();
      $('impMonth').value = new Date().getMonth() + 1;
      openModal('importModal');
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-imp]'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('[data-imp]'), function (x) {
          x.classList.toggle('on', x === b);
        });
        $('impPaste').style.display = b.dataset.imp === 'paste' ? '' : 'none';
        $('impFile').style.display = b.dataset.imp === 'file' ? '' : 'none';
      });
    });
    $('btnParse').addEventListener('click', doParse);
    $('btnDoImport').addEventListener('click', doImport);
    $('impCat').addEventListener('change', function () { if (parsedRows) renderPreview(); });
    $('impYear').addEventListener('change', function () { if (parsedRows) renderPreview(); });
    $('impMonth').addEventListener('change', function () { if (parsedRows) renderPreview(); });

    $('impFileInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var isPdf = /\.pdf$/i.test(f.name);
      var reader = new FileReader();
      reader.onload = function () {
        if (!isPdf) {
          $('pasteArea').value = String(reader.result || '');
          toast('已读取，点「解析预览」');
          return;
        }
        toast('正在读取 PDF…');
        extractTextFromPdf(reader.result).then(function (txt) {
          if (!txt || !txt.trim()) {
            toast('这个 PDF 提取不到文字，请改用粘贴方式', true);
            return;
          }
          $('pasteArea').value = txt;
          var ym = yearMonthFromText(txt);
          if (ym) {
            if (ym.y) $('impYear').value = ym.y;
            if (ym.m) $('impMonth').value = ym.m;
          }
          doParse();
        }).catch(function () {
          toast('读取 PDF 出错，请改用粘贴方式', true);
        });
      };
      if (isPdf) reader.readAsArrayBuffer(f);
      else reader.readAsText(f, 'utf-8');
    });

    setupModals();
    setView('today');
  }

  setup();
})();
