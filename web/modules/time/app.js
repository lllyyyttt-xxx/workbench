/* 时间管理
 *
 * 四块：课表、规划、时间记录、统计。
 * 课表从学校给的格式来，周次用单双周算出来；页面上能编辑，
 * 编辑结果存在 wb:time:timetable，没存过就用 timetable-data.js 里的自带数据。
 * 规划和原来的行程是同一种数据，从生活模块搬过来。
 * 时间记录从随手记搬过来。
 */
(function () {
  'use strict';

  var db = WorkbenchStore.namespace('time');
  var TB = {};   /* 生效课表，load() 里定：编辑保存过的优先，没有就用自带数据 */

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function p2(n) { return String(n).padStart(2, '0'); }
  function dateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function parseDate(s) {
    var p = String(s).split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function minutesOf(t) {
    if (!t) return 0;
    var p = String(t).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }
  function hhmm(m) {
    m = Math.round(m);
    return p2(Math.floor(m / 60) % 24) + ':' + p2(m % 60);
  }

  /* ---------- 周次计算 ---------- */

  var DAY = 86400000;

  /* 第几周：第一周周一那天算第 1 周的第 1 天 */
  function weekOf(date) {
    var first = firstMondaySafe();
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((d - first) / DAY);
    return Math.floor(diff / 7) + 1;
  }

  /* 某一周的周一 */
  function mondayOfWeek(week) {
    var first = firstMondaySafe();
    return new Date(first.getTime() + (week - 1) * 7 * DAY);
  }

  /* 单双周 */
  function isOddWeek(week) { return week % 2 === 1; }

  /* 这门课这周上不上 */
  function courseInWeek(c, week) {
    var w = c.weeks;
    if (w === 'all' || !w) return true;
    if (w === 'odd') return isOddWeek(week);
    if (w === 'even') return !isOddWeek(week);
    if (Array.isArray(w)) return w.indexOf(week) >= 0;
    return true;
  }

  /* 一节课的起止时间
   * 课程数据里带准确时间就用它（学校各节长短不一）
   * 没带就按首节开始 + 末节结束拼
   */
  function courseTime(c) {
    var first = TB.slots[c.from] || {};
    var last = TB.slots[c.to] || {};
    var s = c.start || first.start;
    var endStr = c.end || last.end;
    if (!endStr) {
      endStr = hhmm(minutesOf(s) + (TB.slotMinutes || 45));
    }


    return { start: s, end: endStr, startMin: minutesOf(s), endMin: minutesOf(endStr) };
  }

  /* 学期第一周的周一。用户没填开学日期时，不能拿空字符串去算，
   * 那样会解析成 1899 年，周条上会显示一个荒唐的周数。
   * 这种情况先用「本周一」顶着，等用户填了真实日期就自动对齐。 */
  function firstMondaySafe() {
    var s = TB && TB.term ? TB.term.firstMonday : '';
    var d = s ? parseDate(s) : null;
    if (d && !isNaN(d.getTime()) && d.getFullYear() > 1970) return d;
    var now = new Date();
    var dow = now.getDay();            /* 0=周日 */
    var back = (dow === 0 ? 6 : dow - 1);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
  }

  /* 开学日期到底填了没有，界面上要据此提示用户 */
  function hasFirstMonday() {
    var s = TB && TB.term ? TB.term.firstMonday : '';
    var d = s ? parseDate(s) : null;
    return !!(d && !isNaN(d.getTime()) && d.getFullYear() > 1970);
  }

  /* ---------- 生效课表 ---------- */

  /* 编辑保存过的课表优先；存的结构不完整就当没有，用回自带数据 */
  function effectiveTT() {
    var saved = db.get('timetable', null);
    if (saved && saved.term && saved.slots && Array.isArray(saved.courses)) return saved;
    return window.WorkbenchTimetable || {};
  }

  /* ---------- 数据 ---------- */

  var state = {
    plans: [],
    times: [],
    cats: [],
    week: null      /* 课表当前看第几周 */
  };

  var DEFAULT_CATS = ['上课', '作业', '自学', '社团', '通勤', '运动', '社交', '刷手机', '娱乐', '休息'];
  var FREE_CATS = ['自学', '运动', '社交', '娱乐', '休息'];

  /* 第一次打开时，把生活模块的规划和随手记的时间搬过来 */
  function migrate() {
    var done = db.get('migrated', false);
    if (done) return;

    var movedPlans = 0, movedTimes = 0;

    /* 规划：从生活模块搬 */
    var life = WorkbenchStore.namespace('life');
    var lifePlans = life.get('plans', []) || [];
    if (lifePlans.length) {
      var have = {};
      state.plans.forEach(function (p) { have[p.id] = true; });
      lifePlans.forEach(function (p) {
        if (!have[p.id]) { state.plans.push(p); movedPlans++; }
      });
      life.remove('plans');
    }

    /* 时间记录：从随手记搬 */
    var notes = WorkbenchStore.namespace('notes');
    var noteTimes = notes.get('times', []) || [];
    if (noteTimes.length) {
      state.times = state.times.concat(noteTimes);
      movedTimes = noteTimes.length;
      notes.remove('times');
    }
    /* 类别也跟着搬
     * 随手记里存的是用户实际用过的类别，比这里的默认值准，直接用它
     */
    var noteCats = notes.get('cats', []) || [];
    if (noteCats.length) {
      state.cats = noteCats.slice();
    }
    notes.remove('cats');

    if (!state.cats.length) state.cats = DEFAULT_CATS.slice();

    db.set('plans', state.plans);
    db.set('times', state.times);
    db.set('cats', state.cats);
    db.set('migrated', true);

    return { plans: movedPlans, times: movedTimes };
  }

  function load() {
    state.plans = db.get('plans', []) || [];
    state.times = db.get('times', []) || [];
    state.cats = db.get('cats', []) || [];
    if (!state.cats.length) state.cats = DEFAULT_CATS.slice();
    migrate();
    TB = effectiveTT();
    state.week = weekOf(new Date());
    /* 学期改过以后，今天可能落在学期外，收在第一周到最后一周之间 */
    if (!(state.week >= 1)) state.week = 1;
    if (state.week > (TB.term.totalWeeks || 18)) state.week = TB.term.totalWeeks || 18;
  }

  function save(what) {
    if (!what || what === 'plans') db.set('plans', state.plans);
    if (!what || what === 'times') {
      db.set('times', state.times);
      db.set('cats', state.cats);
    }
    window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: 'time' } }));
  }

  /* ---------- 课表 ---------- */

  /* 某一天有哪些课 */
  function dayCourses(date) {
    var week = weekOf(date);
    var day = date.getDay() === 0 ? 7 : date.getDay();
    var list = [];
    (TB.courses || []).forEach(function (c) {
      if (c.day !== day) return;
      if (!courseInWeek(c, week)) return;
      var t = courseTime(c);
      list.push({
        name: c.name, room: c.room, from: c.from, to: c.to,
        start: t.start, end: t.end, startMin: t.startMin, endMin: t.endMin,
        weeks: c.weeks, week: week
      });
    });
    list.sort(function (a, b) { return a.startMin - b.startMin; });
    return list;
  }

  /* 某一周每天上几节课 */
  function weekLoad(week) {
    var mon = mondayOfWeek(week);
    var total = 0;
    var mins = 0;
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon.getTime() + i * DAY);
      var cs = dayCourses(d);
      cs.forEach(function (c) {
        total++;
        mins += c.endMin - c.startMin;
      });
    }
    return { count: total, minutes: mins };
  }

  /* 下一节课：从此刻往后找，找不到就往后找几天 */
  function nextClass() {
    var now = new Date();
    var nowMin = now.getHours() * 60 + now.getMinutes();

    for (var i = 0; i < 8; i++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      var cs = dayCourses(d);
      for (var j = 0; j < cs.length; j++) {
        var c = cs[j];
        if (i === 0 && c.endMin <= nowMin) continue;
        var diff = (i === 0) ? (c.startMin - nowMin) : null;
        return { course: c, date: d, daysAhead: i, minutesLeft: diff };
      }
    }
    return null;
  }

  function renderNextClass() {
    var box = $('nextClass');
    if (!box) return;
    var n = nextClass();
    if (!n) {
      box.className = 'next-class none';
      box.innerHTML = '<span class="lbl">下一节课</span><div class="ncls"><div class="nm">最近没有课</div></div>';
      return;
    }
    var c = n.course;
    box.className = 'next-class';

    var when;
    if (n.daysAhead === 0) when = '今天';
    else if (n.daysAhead === 1) when = '明天';
    else when = (n.daysAhead === 2 ? '后天' : p2(n.date.getMonth() + 1) + '/' + p2(n.date.getDate()));

    var right = '';
    if (n.daysAhead === 0) {
      if (n.minutesLeft > 0) {
        right = '<div class="cd"><span class="n">' + n.minutesLeft + '</span><span class="u"> 分钟后</span></div>';
      } else {
        right = '<div class="cd"><span class="n">上着</span></div>';
      }
    } else {
      right = '<div class="cd"><span class="n">' + n.daysAhead + '</span><span class="u"> 天后</span></div>';
    }

    box.innerHTML =
      '<span class="lbl">下一节课</span>' +
      '<div class="ncls">' +
      '<div class="nm">' + esc(c.name) + '</div>' +
      '<div class="meta">' + when + ' ' + esc(c.start) + '-' + esc(c.end) +
      '　' + esc(c.room) + '</div>' +
      '</div>' + right;
  }

  function renderTimetable() {
    var box = $('timetable');
    if (!box) return;

    var week = state.week;
    var mon = mondayOfWeek(week);
    var today = dateStr(new Date());
    var total = TB.term.totalWeeks || 18;

    /* 周条 */
    var wkNow = $('weekNow');
    if (wkNow) {
      var sun = new Date(mon.getTime() + 6 * DAY);
      var thisWeek = weekOf(new Date());
      var oddTag = '<span class="tag' + (isOddWeek(week) ? ' odd' : '') + '">' +
        (isOddWeek(week) ? '单周' : '双周') + '</span>';
      wkNow.innerHTML = '<b>第 ' + week + ' 周</b>' + oddTag +
        '　' + p2(mon.getMonth() + 1) + '/' + p2(mon.getDate()) + ' - ' +
        p2(sun.getMonth() + 1) + '/' + p2(sun.getDate()) +
        (week === thisWeek ? '　（本周）' : '');
    }
    var prev = $('weekPrev'), next = $('weekNext');
    if (prev) prev.disabled = week <= 1;
    if (next) next.disabled = week >= total;

    /* 表头 */
    var names = ['一', '二', '三', '四', '五', '六', '日'];
    var html = '<div class="tt-head"><div>节次</div>';
    for (var i = 0; i < 7; i++) {
      var d = new Date(mon.getTime() + i * DAY);
      var isToday = dateStr(d) === today;
      html += '<div class="' + (isToday ? 'today' : '') + '">周' + names[i] +
        '<div style="font-size:10.5px;color:#b0bac6;margin-top:2px;">' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()) + '</div></div>';
    }
    html += '</div>';

    /* 用哪几节做行：课程用到的节次、作息表里有的节次，两者取大的。
     * 只看课程的话，课表到第 6 节就没了，作息表里第 7 节往后的时间根本看不到。 */
    var maxSlot = 0;
    (TB.courses || []).forEach(function (c) { if (c.to > maxSlot) maxSlot = c.to; });
    Object.keys(TB.slots || {}).forEach(function (k) {
      var n = Number(k);
      if (n > maxSlot) maxSlot = n;
    });
    if (!maxSlot) maxSlot = 9;

    var SLOT_H = 74;   /* 每节格子高度，跟样式里一致 */

    html += '<div class="tt-body">';

    /* 左边节次列：写清每节从几点到几点，跟课里标的时间对得上 */
    html += '<div class="tt-slots">';
    for (var slot = 1; slot <= maxSlot; slot++) {
      var sl = TB.slots[slot] || {};
      html += '<div class="tt-slot">' +
        '<span class="n">' + slot + '</span>' +
        '<span class="t">' + esc(sl.start || '') + '</span>' +
        '<span class="t">' + esc(sl.end || '') + '</span>' +
        '</div>';
    }
    html += '</div>';

    /* 七列日期，每列里课按节次绝对定位，连堂课自然跨格 */
    for (var k = 0; k < 7; k++) {
      var day = new Date(mon.getTime() + k * DAY);
      var isTodayCol = dateStr(day) === today;
      var cs = dayCourses(day);

      html += '<div class="tt-col">';
      /* 背景横线 */
      for (var b = 1; b <= maxSlot; b++) {
        html += '<div class="bg' + (isTodayCol ? ' today-col' : '') + '"></div>';
      }
      /* 课 */
      cs.forEach(function (c) {
        var kind = c.weeks === 'odd' ? ' odd' : (c.weeks === 'even' ? ' even' : '');
        var top = (c.from - 1) * SLOT_H + 3;
        var h = (c.to - c.from + 1) * SLOT_H - 6;
        html += '<div class="cls' + kind + '" style="top:' + top + 'px;height:' + h + 'px;">' +
          '<div class="n">' + esc(c.name) + '</div>' +
          '<div class="r">' + esc(c.room) + '</div>' +
          '<div class="tm">' + esc(c.start) + '-' + esc(c.end) + '　' + c.from + '-' + c.to + '节</div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    box.innerHTML = html;

    /* 空课表、没填开学日期，这两种情况得跟用户说清楚，
     * 不然打开一片空格子不知道该干什么。 */
    var tipBox = $('ttTip');
    if (tipBox) {
      if (!(TB.courses || []).length) {
        tipBox.className = 'tip show';
        tipBox.textContent = '还没有课。点上面的「编辑课表」，可以手动一门门加，也可以导入一张课表截图。';
      } else if (!hasFirstMonday()) {
        tipBox.className = 'tip show';
        tipBox.textContent = '还没填开学日期，周次先按这周算。到编辑课表里设一下第一周周一，周次就准了。';
      }
    }
  }

  function shiftWeek(delta) {
    var total = TB.term.totalWeeks || 18;
    var w = state.week + delta;
    if (w < 1 || w > total) return;
    state.week = w;
    renderTimetable();
  }

  /* ---------- 课表编辑 ---------- */

  /* 编辑器的工作副本。editing: null 表单收起，'new' 加新课，数字是改第几门 */
  var ed = { tt: null, editing: null };

  function weeksText(w) {
    if (w === 'odd') return '单周';
    if (w === 'even') return '双周';
    if (Array.isArray(w)) return '第 ' + w.join(',') + ' 周';
    return '每周';
  }
  function weeksClass(w) {
    if (w === 'odd') return ' odd';
    if (w === 'even') return ' even';
    return '';
  }

  /* "1,3,5-7" 这类写法转成周次数组，填错返回 null */
  function parseWeeksText(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var out = [];
    var parts = s.split(/[，,]/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p) continue;
      var m = p.match(/^(\d+)-(\d+)$/);
      if (m) {
        var a = Number(m[1]), b = Number(m[2]);
        if (a < 1 || b < a) return null;
        for (var k = a; k <= b; k++) out.push(k);
      } else if (/^\d+$/.test(p)) {
        var n = Number(p);
        if (n < 1) return null;
        out.push(n);
      } else return null;
    }
    if (!out.length) return null;
    out.sort(function (x, y) { return x - y; });
    var uniq = out.filter(function (v, idx) { return idx === 0 || v !== out[idx - 1]; });
    return uniq;
  }

  function slotUsed(n) {
    return ed.tt.courses.some(function (c) { return c.from <= n && n <= c.to; });
  }

  function edTip(msg) {
    var t = $('edTip');
    if (!t) return;
    if (msg) { t.className = 'tip show'; t.textContent = msg; }
    else { t.className = 'tip'; t.textContent = ''; }
  }
  function formTip(msg) {
    var t = $('edFormTip');
    if (!t) return;
    if (msg) { t.className = 'tip show'; t.textContent = msg; }
    else { t.className = 'tip'; t.textContent = ''; }
  }

  function openEditor() {
    if (!ed.tt) {
      ed.tt = JSON.parse(JSON.stringify(effectiveTT()));
      if (!ed.tt.term) ed.tt.term = { firstMonday: '', totalWeeks: 16 };
      if (!ed.tt.term.totalWeeks) ed.tt.term.totalWeeks = 16;
      if (!ed.tt.slots) ed.tt.slots = {};
      if (!ed.tt.courses) ed.tt.courses = [];
      ed.editing = null;
    }
    renderEditor();
    switchTab('edit');
  }

  function closeEditor() {
    ed.tt = null;
    ed.editing = null;
    edTip('');
    formTip('');
    switchTab('timetable');
  }

  /* 把工作副本换成自带课表。只是填进编辑器，点保存才真用回它 */
  function resetEditorDefault() {
    ed.tt = JSON.parse(JSON.stringify(window.WorkbenchTimetable || {}));
    if (!ed.tt.term) ed.tt.term = { firstMonday: '', totalWeeks: 16 };
    if (!ed.tt.slots) ed.tt.slots = {};
    if (!ed.tt.courses) ed.tt.courses = [];
    ed.editing = null;
    formTip('');
    renderEditor();
    edTip('已经把下面的内容换成自带课表，还没保存：点“保存课表”就用回它，点“取消”回到你原来改的样子。');
  }

  function renderEditor() {
    if (!ed.tt) return;
    $('edFirst').value = ed.tt.term.firstMonday || '';
    $('edTotalWeeks').value = ed.tt.term.totalWeeks || 16;

    /* 节次 */
    var slotNos = Object.keys(ed.tt.slots).map(Number).sort(function (a, b) { return a - b; });
    var sh = '';
    slotNos.forEach(function (n) {
      var sl = ed.tt.slots[n] || {};
      sh += '<div class="ed-slot-row">' +
        '<span class="no">第 ' + n + ' 节</span>' +
        '<input type="time" value="' + esc(sl.start || '') + '" data-sedit="' + n + '" data-sf="start">' +
        '<span class="dash">到</span>' +
        '<input type="time" value="' + esc(sl.end || '') + '" data-sedit="' + n + '" data-sf="end">' +
        (slotUsed(n) ? '' : '<button class="step-del" data-sdel="' + n + '" title="这节没课在用，可以删">删</button>') +
        '</div>';
    });
    $('edSlotList').innerHTML = sh;

    Array.prototype.forEach.call(document.querySelectorAll('[data-sedit]'), function (inp) {
      inp.addEventListener('change', function () {
        var n = Number(inp.dataset.sedit);
        if (!ed.tt.slots[n]) ed.tt.slots[n] = {};
        ed.tt.slots[n][inp.dataset.sf] = inp.value;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sdel]'), function (b) {
      b.addEventListener('click', function () { deleteSlot(Number(b.dataset.sdel)); });
    });

    /* 课程 */
    var ch = '';
    ed.tt.courses.forEach(function (c, i) {
      var dayName = ['一', '二', '三', '四', '五', '六', '日'];
      ch += '<div class="ed-course-row">' +
        '<span class="n">' + esc(c.name) + '</span>' +
        '<span class="meta">' + esc(c.room || '没写教室') + '　周' + (dayName[c.day - 1] || '?') + '　' +
        c.from + '-' + c.to + '节　' + esc(c.start) + '-' + esc(c.end) + '</span>' +
        '<span class="wk' + weeksClass(c.weeks) + '">' + weeksText(c.weeks) + '</span>' +
        '<button class="plan-del" data-cedit="' + i + '">改</button>' +
        '<button class="plan-del" data-cdel="' + i + '">删</button>' +
        '</div>';
    });
    $('edCourseList').innerHTML = ch || '<div class="empty-tip">一门课都没有，点右上角“加一门课”</div>';

    Array.prototype.forEach.call(document.querySelectorAll('[data-cedit]'), function (b) {
      b.addEventListener('click', function () { editCourse(Number(b.dataset.cedit)); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-cdel]'), function (b) {
      b.addEventListener('click', function () { deleteCourse(Number(b.dataset.cdel)); });
    });

    renderCourseForm();
  }

  function renderCourseForm() {
    var box = $('edCourseForm');
    if (!box) return;
    if (ed.editing === null) { box.innerHTML = ''; box.style.display = 'none'; return; }

    var c = ed.editing === 'new' ? {} : (ed.tt.courses[ed.editing] || {});
    var dayName = ['一', '二', '三', '四', '五', '六', '日'];
    var curDay = Number(c.day) || 1;
    var dayOpts = dayName.map(function (n, i) {
      return '<option value="' + (i + 1) + '"' + (curDay === i + 1 ? ' selected' : '') + '>周' + n + '</option>';
    }).join('');
    var isCustom = Array.isArray(c.weeks);
    var wk = isCustom ? 'custom' : (c.weeks || 'all');

    box.style.display = 'block';
    box.innerHTML =
      '<div class="form-row">' +
      '<input type="text" id="edCName" placeholder="课程名" style="flex:1;min-width:130px;" value="' + esc(c.name || '') + '">' +
      '<input type="text" id="edCRoom" placeholder="教室（可不填）" style="flex:1;min-width:110px;" value="' + esc(c.room || '') + '">' +
      '<select id="edCDay">' + dayOpts + '</select>' +
      '</div>' +
      '<div class="form-row">' +
      '<label>第</label><input type="number" id="edCFrom" min="1" style="width:64px;" value="' + (c.from || 1) + '">' +
      '<span class="ed-sep">到</span>' +
      '<label>节</label><input type="number" id="edCTo" min="1" style="width:64px;" value="' + (c.to || 1) + '">' +
      '<input type="time" id="edCStart" value="' + esc(c.start || '') + '" title="开始时间">' +
      '<span class="ed-sep">到</span>' +
      '<input type="time" id="edCEnd" value="' + esc(c.end || '') + '" title="结束时间">' +
      '</div>' +
      '<div class="form-row">' +
      '<select id="edCWeeksSel">' +
      '<option value="all"' + (wk === 'all' ? ' selected' : '') + '>每周都上</option>' +
      '<option value="odd"' + (wk === 'odd' ? ' selected' : '') + '>只有单周</option>' +
      '<option value="even"' + (wk === 'even' ? ' selected' : '') + '>只有双周</option>' +
      '<option value="custom"' + (isCustom ? ' selected' : '') + '>指定几周</option>' +
      '</select>' +
      '<input type="text" id="edCWeeksText" placeholder="哪些周，如 1,3,5-7" style="' +
      (isCustom ? '' : 'display:none;') + 'width:150px;" value="' + (isCustom ? esc(c.weeks.join(',')) : '') + '">' +
      '<button class="btn primary sm" id="btnEdCourseOk">确定</button>' +
      '<button class="btn sm" id="btnEdCourseCancel">不改了</button>' +
      '</div>' +
      '<div style="font-size:12px;color:#b0bac6;margin-top:4px;">起止时间会按节次自动带出来，能改；留空就按那节的作息算。</div>';

    /* 节次变了把时间带出来，带出来的仍能改 */
    var fromI = $('edCFrom'), toI = $('edCTo');
    function bringTimes() {
      var f = Number(fromI.value), t = Number(toI.value);
      var fs = ed.tt.slots[f], ts = ed.tt.slots[t];
      if (fs && fs.start) $('edCStart').value = fs.start;
      if (ts && ts.end) $('edCEnd').value = ts.end;
    }
    fromI.addEventListener('change', bringTimes);
    toI.addEventListener('change', bringTimes);

    $('edCWeeksSel').addEventListener('change', function () {
      $('edCWeeksText').style.display = $('edCWeeksSel').value === 'custom' ? '' : 'none';
    });
    $('btnEdCourseOk').addEventListener('click', saveCourseForm);
    $('btnEdCourseCancel').addEventListener('click', function () {
      ed.editing = null;
      formTip('');
      renderEditor();
    });
  }

  function editCourse(i) {
    ed.editing = i;
    formTip('');
    renderEditor();
  }

  function deleteCourse(i) {
    if (ed.editing === i) ed.editing = null;
    else if (typeof ed.editing === 'number' && ed.editing > i) ed.editing--;
    ed.tt.courses.splice(i, 1);
    renderEditor();
  }

  function saveCourseForm() {
    var name = ($('edCName').value || '').trim();
    if (!name) { formTip('课程名要填一个'); return; }
    var day = Number($('edCDay').value);
    var from = parseInt($('edCFrom').value, 10);
    var to = parseInt($('edCTo').value, 10);
    if (!(from >= 1) || !(to >= from)) { formTip('节次要填对，开始那节不能比结束那节晚'); return; }
    if (!ed.tt.slots[from] || !ed.tt.slots[to]) {
      formTip('第 ' + from + ' 或第 ' + to + ' 节不存在，先在“作息节次”里加上'); return;
    }
    var start = $('edCStart').value || ed.tt.slots[from].start;
    var end = $('edCEnd').value || ed.tt.slots[to].end;
    if (!start || !end) { formTip('起止时间要填（或先把那节的作息时间填好）'); return; }
    if (minutesOf(end) <= minutesOf(start)) { formTip('结束时间要晚于开始时间'); return; }

    var weeksSel = $('edCWeeksSel').value;
    var weeks = weeksSel;
    if (weeksSel === 'custom') {
      var parsed = parseWeeksText($('edCWeeksText').value);
      if (!parsed) { formTip('指定周次没填对，示例：1,3,5-7'); return; }
      weeks = parsed;
    }

    var obj = { day: day, from: from, to: to, start: start, end: end, name: name, room: ($('edCRoom').value || '').trim(), weeks: weeks };
    if (ed.editing === 'new') ed.tt.courses.push(obj);
    else ed.tt.courses[ed.editing] = obj;
    ed.editing = null;
    formTip('');
    renderEditor();
  }

  function addSlot() {
    var maxN = 0;
    Object.keys(ed.tt.slots).forEach(function (k) { if (Number(k) > maxN) maxN = Number(k); });
    ed.tt.slots[maxN + 1] = { start: '', end: '' };
    renderEditor();
    var inp = document.querySelector('[data-sedit="' + (maxN + 1) + '"][data-sf="start"]');
    if (inp) inp.focus();
  }

  function deleteSlot(n) {
    if (slotUsed(n)) {
      edTip('第 ' + n + ' 节有课在用，先把那些课改到别的节或删掉。');
      return;
    }
    delete ed.tt.slots[n];
    edTip('');
    renderEditor();
  }

  function saveTimetable() {
    if (!ed.tt) return;
    var tt = ed.tt;

    var first = ($('edFirst').value || '').trim();
    var total = parseInt($('edTotalWeeks').value, 10);
    /* 开学日期允许先空着：很多人导完课表就想先存下来，回头再补日期。
     * 空着的时候周次按本周算，课表页会提示去补。填了就必须是合法日期。 */
    if (first && !/^\d{4}-\d{2}-\d{2}$/.test(first)) { edTip('第一周周一的日期格式不对，用上面的日期框重选一下'); return; }
    if (!(total >= 1 && total <= 40)) { edTip('总周数填 1 到 40 的数'); return; }
    tt.term.firstMonday = first;
    tt.term.totalWeeks = total;

    var slotNos = Object.keys(tt.slots).map(Number).sort(function (a, b) { return a - b; });
    for (var i = 0; i < slotNos.length; i++) {
      var n = slotNos[i], sl = tt.slots[n] || {};
      if (!sl.start || !sl.end) { edTip('第 ' + n + ' 节的起止时间要填全；不用这节就把它删掉。'); return; }
      if (minutesOf(sl.end) <= minutesOf(sl.start)) { edTip('第 ' + n + ' 节结束时间要晚于开始时间'); return; }
    }

    for (var j = 0; j < tt.courses.length; j++) {
      var c = tt.courses[j];
      if (!c.name || !String(c.name).trim()) { edTip('第 ' + (j + 1) + ' 门课没写课程名，点“改”补上'); return; }
      if (!(c.day >= 1 && c.day <= 7)) { edTip('「' + c.name + '」星期不对'); return; }
      if (!(c.from >= 1 && c.to >= c.from)) { edTip('「' + c.name + '」节次不对，开始那节不能比结束那节晚'); return; }
      if (!tt.slots[c.from] || !tt.slots[c.to]) { edTip('「' + c.name + '」用的第 ' + c.from + ' 或 ' + c.to + ' 节不存在'); return; }
      if (!c.start) c.start = tt.slots[c.from].start;
      if (!c.end) c.end = tt.slots[c.to].end;
      if (minutesOf(c.end) <= minutesOf(c.start)) { edTip('「' + c.name + '」结束时间要晚于开始时间'); return; }
      if (Array.isArray(c.weeks) && !c.weeks.length) { edTip('「' + c.name + '」指定周次是空的'); return; }
    }

    /* 自带数据里的学期名、学校、兜底节长，编辑里没动就照搬 */
    var def = window.WorkbenchTimetable || {};
    tt.slotMinutes = tt.slotMinutes || def.slotMinutes || 45;
    if (!tt.term.name && def.term) tt.term.name = def.term.name;
    if (!tt.term.school && def.term) tt.term.school = def.term.school;

    db.set('timetable', tt);
    TB = effectiveTT();

    /* 新学期里今天可能跑出学期外，收回来 */
    var w = weekOf(new Date());
    if (!(w >= 1)) w = 1;
    if (w > (TB.term.totalWeeks || 18)) w = TB.term.totalWeeks || 18;
    state.week = w;

    ed.tt = null;
    ed.editing = null;
    edTip('');

    renderNextClass();
    renderTimetable();
    renderPlans();
    renderStats();
    switchTab('timetable');
    var ok = $('ttTip');
    if (ok) {
      ok.className = 'tip show';
      ok.textContent = '课表已保存生效。';
      setTimeout(function () { ok.className = 'tip'; ok.textContent = ''; }, 4000);
    }
  }

/* ================= 导入课表 =================
 * 三种来源：课表截图（走 AI 识别）、文本/CSV/JSON 文件、直接粘贴文字。
 * 识别出来的课先放在 imp.list 里，用户在界面上看一眼、删掉不对的，
 * 再点「全部加入课表」才进到编辑器的草稿里，最后还得点「保存课表」才真生效。
 * 多两道确认，是为了不把错的课写进去。
 */
var imp = { list: [], slots: null, busy: false };

function impTip(msg, bad) {
  var t = $('importTip');
  if (!t) return;
  if (msg) {
    t.className = 'tip show' + (bad ? ' bad' : '');
    t.textContent = msg;
  } else {
    t.className = 'tip';
    t.textContent = '';
  }
}

/* 「周一」「星期一」「礼拜2」里的数字 */
function dayNum(str) {
  var m = String(str).match(/(?:周|星期|礼拜)\s*([一二三四五六日天1-7])/);
  if (!m) return 0;
  var map = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };
  var c = m[1];
  return map[c] || Number(c) || 0;
}

/* 按开始时间找是第几节，找不到返回 0 */
function slotByTime(hhmmStr) {
  var t = String(hhmmStr || '').trim();
  if (!/^\d{1,2}:\d{2}$/.test(t)) return 0;
  var mins = minutesOf(t);
  var best = 0, bestDiff = 999;
  Object.keys(TB.slots || {}).forEach(function (k) {
    var sl = TB.slots[k] || {};
    if (!sl.start) return;
    var d = Math.abs(minutesOf(sl.start) - mins);
    if (d < bestDiff) { bestDiff = d; best = Number(k); }
  });
  return bestDiff <= 12 ? best : 0;
}

/* 一行文字拆成一门课，拆不出来返回 null */
function parseCourseLine(line) {
  var raw = String(line || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 3) return null;

  var day = dayNum(raw);
  if (!day) return null;

  /* 周次：单周 / 双周 / 第1-16周 / 1,3,5周 */
  var weeks = 'all';
  if (/单周/.test(raw)) weeks = 'odd';
  else if (/双周/.test(raw)) weeks = 'even';
  else {
    var wm = raw.match(/第?\s*([\d,，\-~到]+)\s*周/);
    if (wm && !/^\d{1,2}[-~到]\d{1,2}$/.test(wm[1])) {
      var arr = [];
      wm[1].split(/[,，]/).forEach(function (seg) {
        var rg = seg.split(/[-~到]/);
        if (rg.length === 2) {
          var a1 = parseInt(rg[0], 10), b1 = parseInt(rg[1], 10);
          if (a1 > 0 && b1 >= a1 && b1 <= 30) for (var q = a1; q <= b1; q++) arr.push(q);
        } else {
          var one = parseInt(seg, 10);
          if (one > 0) arr.push(one);
        }
      });
      if (arr.length) weeks = arr;
    }
  }

  /* 节次：1-3节 / 第1、2节 / 1,2,3 */
  var from = 0, to = 0;
  var sm = raw.match(/(\d{1,2})\s*[-~到至]\s*(\d{1,2})\s*节/);
  if (sm) { from = parseInt(sm[1], 10); to = parseInt(sm[2], 10); }
  if (!from) {
    var sm2 = raw.match(/第\s*([\d,，、]+)\s*节/);
    if (sm2) {
      var ns = sm2[1].split(/[,，、]/).map(function (x) { return parseInt(x, 10); }).filter(function (x) { return x > 0; });
      if (ns.length) { from = Math.min.apply(null, ns); to = Math.max.apply(null, ns); }
    }
  }
  if (!from) {
    var sm3 = raw.match(/(\d{1,2})\s*节/);
    if (sm3) { from = to = parseInt(sm3[1], 10); }
  }

  /* 起止时间 */
  var start = '', end = '';
  var tm = raw.match(/(\d{1,2}:\d{2})\s*[-~到至]\s*(\d{1,2}:\d{2})/);
  if (tm) { start = tm[1]; end = tm[2]; }
  if (!from && start) {
    from = slotByTime(start);
    to = from;
    if (from && end) {
      var e = slotByTime(end);
      /* 结束时间往前一节的结束点算 */
      if (e) to = e;
    }
  }
  if (!from || !to) return null;
  if (to < from) { var t2 = from; from = to; to = t2; }

  /* 教室：形如 3-201、A101、教学楼302 */
  var roomM = raw.match(/(?:教室\s*[:：]?\s*)?([A-Za-z]?\d{1,2}\s*[-－]\s*\d{2,4}|[A-Za-z]\d{2,4}|[\u4e00-\u9fa5]{2,8}\d{2,4}(?:教室)?)/);
  var room = roomM ? roomM[1].replace(/\s/g, '') : '';

  /* 课程名：去掉星期、节次、时间、周次、教室之后剩下的 */
  var name = raw;
  name = name.replace(/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/g, ' ');
  name = name.replace(/第?\s*[\d,，、]+\s*[-~到至]?\s*[\d,，、]*\s*节/g, ' ');
  name = name.replace(/\d{1,2}:\d{2}\s*[-~到至]\s*\d{1,2}:\d{2}/g, ' ');
  name = name.replace(/第?\s*[\d,，\-~到]+\s*周/g, ' ');
  name = name.replace(/[（(]?\s*(单周|双周)\s*[)）]?/g, ' ');
  if (room) name = name.replace(room, ' ');
  name = name.replace(/(?:教室|地点)\s*[:：]?/g, ' ');
  name = name.replace(/[|｜,，、\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!name || name.length < 1) return null;

  return { day: day, from: from, to: to, name: name, room: room, weeks: weeks, start: start, end: end };
}

/* 多行文字 → 课程数组 */
function parseCourseText(text) {
  var out = [], miss = 0;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    /* CSV 风格：1,1,3,高等数学,3-201 */
    var csv = line.split(/[,\t]/);
    if (csv.length >= 4 && /^\d$/.test(csv[0].trim()) && /^\d+$/.test(csv[1].trim())) {
      var d = parseInt(csv[0], 10), f = parseInt(csv[1], 10), t = parseInt(csv[2], 10);
      if (d >= 1 && d <= 7 && f >= 1 && t >= f) {
        out.push({ day: d, from: f, to: t, name: (csv[3] || '').trim(), room: (csv[4] || '').trim(), weeks: 'all', start: '', end: '' });
        return;
      }
    }
    var c = parseCourseLine(line);
    if (c) out.push(c); else miss++;
  });
  return { courses: out, missed: miss };
}

/* JSON 文件：整份课表，或者只有一个课程数组 */
function parseCourseJson(text) {
  var j;
  try { j = JSON.parse(text); } catch (e) { return { error: '文件不是有效的 JSON。' }; }
  var courses = null, term = null, slots = null;
  if (Array.isArray(j)) courses = j;
  else if (j && Array.isArray(j.courses)) { courses = j.courses; term = j.term || null; slots = j.slots || null; }
  if (!courses) return { error: '这个 JSON 里没找到课程。' };
  var clean = courses.filter(function (c) {
    return c && c.day >= 1 && c.day <= 7 && c.from >= 1 && c.to >= c.from && c.name;
  }).map(function (c) {
    return {
      day: Number(c.day), from: Number(c.from), to: Number(c.to),
      name: String(c.name), room: c.room ? String(c.room) : '',
      weeks: c.weeks === undefined ? 'all' : c.weeks,
      start: c.start || '', end: c.end || ''
    };
  });
  if (!clean.length) return { error: '课程数据格式不对，一条都没读出来。' };
  return { courses: clean, term: term, slots: slots };
}

/* 作息时间那一块：认错了能当场改，不用重新识别一遍 */
function renderImportSlots() {
  var box = $('importSlots');
  if (!box) return;
  var nos = imp.slots ? Object.keys(imp.slots).map(Number).sort(function (a, b) { return a - b; }) : [];
  if (!nos.length) {
    box.innerHTML = '';
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  var html = '<div class="imp-slot-head"><b>识别到的作息时间</b>' +
    '<span class="imp-slot-hint">认错了可以直接改</span></div>';
  nos.forEach(function (n) {
    var sl = imp.slots[n];
    html += '<div class="imp-slot-line">第 ' + n + ' 节' +
      '<input type="time" data-slotn="' + n + '" data-slotf="start" value="' + esc(sl.start) + '">' +
      '<span class="dash">到</span>' +
      '<input type="time" data-slotn="' + n + '" data-slotf="end" value="' + esc(sl.end) + '">' +
      '</div>';
  });
  box.innerHTML = html;
  Array.prototype.forEach.call(box.querySelectorAll('[data-slotn]'), function (inp) {
    inp.addEventListener('change', function () {
      var n = inp.dataset.slotn;
      if (!imp.slots[n]) return;
      imp.slots[n][inp.dataset.slotf] = inp.value;
    });
  });
}

function renderImportList() {
  var box = $('importList');
  var row = $('importApplyRow');
  if (!box) return;

  renderImportSlots();

  box.innerHTML = '';
  imp.list.forEach(function (c, i) {
    var li = document.createElement('li');
    var main = document.createElement('div');
    main.className = 'imp-main';
    /* 节次做成可改的：模型看错数字是常事，用户自己改一下比重新识别快得多 */
    var dayName = ['', '一', '二', '三', '四', '五', '六', '日'][c.day];
    var weeksTxt = '';
    if (c.weeks === 'odd') weeksTxt = '　单周';
    else if (c.weeks === 'even') weeksTxt = '　双周';
    else if (Array.isArray(c.weeks)) weeksTxt = '　第' + c.weeks.join(',') + '周';
    var dayOpts = '';
    for (var di = 1; di <= 7; di++) {
      dayOpts += '<option value="' + di + '"' + (c.day === di ? ' selected' : '') + '>周' +
        ['', '一', '二', '三', '四', '五', '六', '日'][di] + '</option>';
    }
    var html = '<div class="imp-line"><select class="imp-day" data-idx="' + i + '">' + dayOpts + '</select>' +
      ' 第 <input class="imp-num" type="number" min="1" max="20" value="' + c.from +
      '" data-if="from" data-idx="' + i + '"> 到 ' +
      '<input class="imp-num" type="number" min="1" max="20" value="' + c.to +
      '" data-if="to" data-idx="' + i + '"> 节' + esc(weeksTxt) + '</div>' +
      '<div>' + esc(c.name) + '</div>';
    if (c.room) html += '<div class="imp-room">' + esc(c.room) + '</div>';
    main.innerHTML = html;

    var daySel = main.querySelector('.imp-day');
    if (daySel) {
      daySel.addEventListener('change', function () {
        var it = imp.list[Number(daySel.dataset.idx)];
        if (it) it.day = Math.max(1, Math.min(7, Number(daySel.value) || 1));
      });
    }
    Array.prototype.forEach.call(main.querySelectorAll('[data-if]'), function (inp) {
      inp.addEventListener('change', function () {
        var idx2 = Number(inp.dataset.idx);
        var item = imp.list[idx2];
        if (!item) return;
        var v = Math.max(1, Math.min(20, Number(inp.value) || 1));
        if (inp.dataset.if === 'from') {
          item.from = v;
          if (item.to < item.from) item.to = item.from;
        } else {
          item.to = Math.max(v, item.from);
        }
        renderImportList();
      });
    });
    var del = document.createElement('button');
    del.className = 'imp-del';
    del.textContent = '删掉';
    del.addEventListener('click', function () {
      imp.list.splice(i, 1);
      renderImportList();
    });
    li.appendChild(main);
    li.appendChild(del);
    box.appendChild(li);
  });
  if (row) row.style.display = imp.list.length ? 'flex' : 'none';
}

/* 把识别/解析的结果换进列表 */
function setImportList(courses, note, slots) {
  imp.list = courses.slice(0);
  imp.slots = slots && Object.keys(slots).length ? slots : null;
  renderImportList();
  var slotN = imp.slots ? Object.keys(imp.slots).length : 0;
  if (!courses.length) {
    impTip(note || '一条课都没认出来。可以试试换成文字粘贴，或者手动加。', true);
  } else {
    impTip('认出 ' + courses.length + ' 门课' +
      (slotN ? '，还有 ' + slotN + ' 个节次的作息时间' : '') +
      '，核对一下再导入。' + (note ? ' ' + note : ''));
  }
}

/* 图片太大要缩一下，不然传不上去也浪费额度 */
/* 图片要先压小再传：手机截图动辄几 MB，原样发过去容易把请求卡到超时。
 * 策略是先限最大边，再看 base64 体积，超了就把质量往下调，还超就继续缩边。 */
function shrinkImage(file, done) {
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      /* 课表里的字号本来就小，「第几节」和几点几分全靠那几个数字。
       * 压得太狠，数字就糊成一团，模型只能猜，节次和时间就会串行。
       * 所以这里优先保清晰度：先保住尺寸，质量不低于 0.75，实在太大才缩尺寸。 */
      var MAX_W = 1200;          /* 宽度基本不缩，手机截图大多一千出头 */
      var MAX_H = 2400;
      var MAX_B64 = 620 * 1024;  /* 实测这个体积的请求能正常返回 */

      function render(scale, quality) {
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        var g = cv.getContext('2d');
        g.fillStyle = '#fff';          /* 透明背景转 jpeg 会变黑，先铺白底 */
        g.fillRect(0, 0, w, h);
        g.drawImage(img, 0, 0, w, h);
        return cv.toDataURL('image/jpeg', quality);
      }

      var scale = Math.min(1, MAX_W / img.width, MAX_H / img.height);
      var q = 0.92;
      var url = render(scale, q);
      var guard = 0;
      while (url.length > MAX_B64 && guard < 8) {
        guard++;
        if (q > 0.75) { q -= 0.05; }   /* 先降质量，最低留到 0.75 */
        else { scale *= 0.85; }        /* 还不够才缩尺寸 */
        url = render(scale, q);
      }
      done(url);
    };
    img.onerror = function () { done(null); };
    img.src = reader.result;
  };
  reader.onerror = function () { done(null); };
  reader.readAsDataURL(file);
}

/* 把时间统一成 08:00 这种两位数写法，写不成的一律丢掉，免得脏数据进课表 */
function tidyTime(t) {
  var m = String(t == null ? '' : t).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  var h = Number(m[1]), mi = Number(m[2]);
  if (!(h >= 0 && h <= 23) || !(mi >= 0 && mi <= 59)) return '';
  return (h < 10 ? '0' + h : '' + h) + ':' + (mi < 10 ? '0' + mi : '' + mi);
}

/* 整理识别出来的作息时间，只留下能用的节次 */
function pickSlots(raw) {
  var out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach(function (k) {
    var n = Number(k);
    if (!(n >= 1 && n <= 30)) return;
    var v = raw[k];
    if (!v || typeof v !== 'object') return;
    var st = tidyTime(v.start), en = tidyTime(v.end);
    if (!st || !en) return;
    out[n] = { start: st, end: en };
  });
  return out;
}

/* 发给服务器让模型看这张图 */
function recognizeShot(dataUrl) {
  var prompt = '这是一张学校课表的截图。请把它转成 JSON，只输出 JSON，不要任何解释。\n' +
    '格式：{"slots":{"1":{"start":"08:00","end":"08:45"},"2":{"start":"08:55","end":"09:40"}},' +
    '"courses":[{"day":1,"from":1,"to":2,"name":"课程名","room":"教室","weeks":"all"}]}\n' +
    'slots 是作息时间。课表左边一般有一列是「第几节」，紧挨着的一列是这一节的时间，' +
    '同一行里的节次和时间是配套的，绝对不能串行；时间要照着图上的数字逐字读，' +
    '不要自己推算、补齐或者改成整点。图上没写时间的，slots 给空的。\n' +
    'courses 是课程。day 用 1 到 7 表示周一到周日；' +
    '判断一门课是星期几，一定看它正上方表头写的是周几，不要按它在图上的左右位置推算；' +
    'from 和 to 是第几节到第几节，按左侧节次列上的编号来数，不要按课程块的高度去猜；' +
    'weeks 填 "all" 表示每周，或 "odd" 单周、"even" 双周。\n' +
    '先写 slots，再写 courses。看不清的字段留空字符串，空着的格子不要输出。';

  /* 模型看图要十几秒，浏览器这边给足 60 秒，超了自己撤 */
  var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 60000);

  return fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ctrl ? ctrl.signal : undefined,
    body: JSON.stringify({
      /* 额度要留够：这个模型先思考再回答，思考的字数也算在这里面。
       * 给少了，思考一多就把额度吃光，正文一个字都不剩。 */
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }]
    })
  }).then(function (r) {
    clearTimeout(timer);
    if (!r.ok) {
      if (r.status === 504) {
        throw new Error('这次等太久没等到结果。图片可以截小一点，或者改用粘贴文字。');
      }
      if (r.status === 413) {
        throw new Error('图片太大了，换一张小一点的截图。');
      }
      throw new Error('服务器返回 ' + r.status);
    }
    return r.json();
  }).catch(function (e) {
    clearTimeout(timer);
    if (e && (e.name === 'AbortError' || String(e.message).indexOf('abort') >= 0)) {
      throw new Error('等太久了，这次放弃。图片可以截小一点再试。');
    }
    throw e;
  }).then(function (j) {
    var txt = j && j.choices && j.choices[0] && j.choices[0].message
      ? (j.choices[0].message.content || '') : '';
    if (!txt) {
      var fin = j && j.choices && j.choices[0] ? j.choices[0].finish_reason : '';
      if (fin === 'length') {
        throw new Error('这张图信息太多，模型想太久了，没轮上说话。可以只截课表那一块再试，或者用粘贴文字');
      }
      throw new Error('模型没有返回内容');
    }
    /* 可能被 ```json 包住，切出来 */
    var m = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (m) txt = m[1];
    /* 先按带作息时间的对象解析；如果模型只给了课程数组，也照样能用 */
    var data = null;
    var ob = txt.indexOf('{'), oe = txt.lastIndexOf('}');
    if (ob >= 0 && oe > ob) {
      try { data = JSON.parse(txt.slice(ob, oe + 1)); } catch (e1) { data = null; }
    }
    if (!data || typeof data !== 'object') {
      var a = txt.indexOf('['), b = txt.lastIndexOf(']');
      if (a < 0 || b < 0) throw new Error('模型返回的不是课程清单');
      var raw0 = JSON.parse(txt.slice(a, b + 1));
      if (!Array.isArray(raw0)) throw new Error('返回格式不对');
      data = { courses: raw0 };
    }
    var arr = Array.isArray(data) ? data : (Array.isArray(data.courses) ? data.courses : null);
    if (!arr) throw new Error('返回格式不对');
    var courses = arr.filter(function (c) {
      return c && Number(c.day) >= 1 && Number(c.day) <= 7 && Number(c.from) >= 1 && c.name;
    }).map(function (c) {
      return {
        day: Number(c.day), from: Number(c.from),
        to: Number(c.to) >= Number(c.from) ? Number(c.to) : Number(c.from),
        name: String(c.name), room: c.room ? String(c.room) : '',
        weeks: c.weeks === undefined || c.weeks === null ? 'all' : c.weeks,
        start: c.start || '', end: c.end || ''
      };
    });
    return { courses: courses, slots: pickSlots(data.slots) };
  });
}

/* 把列表里的课并进编辑器草稿（不是直接保存） */
function applyImport() {
  if (!ed.tt) { openEditor(); }
  if (!ed.tt) return;
  if (!Array.isArray(ed.tt.courses)) ed.tt.courses = [];
  if (!ed.tt.slots) ed.tt.slots = {};

  /* 先落作息时间。识别出来的作息要是和现在的对不上，就以图上的为准，
   * 这样下面给课程补时间用的就是新作息，不会还是老的一套。 */
  var slotChanged = 0;
  if (imp.slots) {
    Object.keys(imp.slots).forEach(function (k) {
      var n = Number(k), s2 = imp.slots[k], old2 = ed.tt.slots[n];
      if (!old2 || old2.start !== s2.start || old2.end !== s2.end) slotChanged++;
      ed.tt.slots[n] = { start: s2.start, end: s2.end };
    });
  }
  var added = 0;
  imp.list.forEach(function (c) {
    /* 用共享规则补时间和查重，跟手动加课走同一套 */
    var one = {
      day: c.day, from: c.from, to: c.to, name: c.name,
      room: c.room || '', weeks: c.weeks === undefined ? 'all' : c.weeks,
      start: c.start || '', end: c.end || ''
    };
    /* 起止时间按作息表补上，跟手动加课用的是同一套作息 */
    if (!one.start && ed.tt.slots[one.from]) one.start = ed.tt.slots[one.from].start;
    if (!one.end && ed.tt.slots[one.to]) one.end = ed.tt.slots[one.to].end;
    if (one.start && !one.end) one.end = hhmm(minutesOf(one.start) + (TB.slotMinutes || 45));
    ed.tt.courses.push(one);
    added++;
  });
  imp.list = [];
  imp.slots = null;
  renderImportList();
  renderEditor();
  impTip('已加入 ' + added + ' 门课' +
    (slotChanged ? '，另外更新了 ' + slotChanged + ' 个节次的作息时间' : '') +
    '。往下核对，没问题点最下面的「保存课表」才生效。');
}

function setupImport() {
  var toggle = $('btnImportToggle');
  var box = $('importBox');
  if (toggle && box) {
    toggle.addEventListener('click', function () {
      var open = box.style.display !== 'none';
      box.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? '展开' : '收起';
    });
  }

  var pickImg = $('btnPickImage'), fileImg = $('fileImage');
  if (pickImg && fileImg) {
    pickImg.addEventListener('click', function () { fileImg.click(); });
    fileImg.addEventListener('change', function () {
      var f = fileImg.files && fileImg.files[0];
      if (!f) return;
      impTip('正在识别，可能要十几秒…');
      shrinkImage(f, function (dataUrl) {
        if (!dataUrl) { impTip('这张图读不出来，换一张试试。', true); return; }
        recognizeShot(dataUrl).then(function (r) {
          setImportList(r.courses, '', r.slots);
        }).catch(function (e) {
          var msg = String(e && e.message ? e.message : e).replace(/[。.]s*$/g, '');
          impTip('识别没成功：' + msg + '。也可以把课表文字粘贴进来，那条路是稳的。', true);
        }).then(function () {
          fileImg.value = '';
        });
      });
    });
  }

  var pickDoc = $('btnPickFile'), fileDoc = $('fileDoc');
  if (pickDoc && fileDoc) {
    pickDoc.addEventListener('click', function () { fileDoc.click(); });
    fileDoc.addEventListener('change', function () {
      var f = fileDoc.files && fileDoc.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || '');
        var name = (f.name || '').toLowerCase();
        if (name.indexOf('.json') > 0) {
          var j = parseCourseJson(text);
          if (j.error) impTip(j.error, true);
          else {
            if (j.term && ed.tt) {
              if (j.term.firstMonday) ed.tt.term.firstMonday = j.term.firstMonday;
              if (j.term.totalWeeks) ed.tt.term.totalWeeks = Number(j.term.totalWeeks) || 16;
              renderEditor();
            }
            setImportList(j.courses);
          }
        } else {
          var r = parseCourseText(text);
          setImportList(r.courses, r.missed ? '有 ' + r.missed + ' 行没认出来。' : '');
        }
        fileDoc.value = '';
      };
      reader.onerror = function () { impTip('文件读不出来。', true); };
      reader.readAsText(f, 'utf-8');
    });
  }

  var parseBtn = $('btnParseText'), ta = $('importText');
  if (parseBtn && ta) {
    parseBtn.addEventListener('click', function () {
      var text = ta.value.trim();
      if (!text) { impTip('先把课表文字贴进来。', true); return; }
      var r = parseCourseText(text);
      setImportList(r.courses, r.missed ? '有 ' + r.missed + ' 行没认出来。' : '');
    });
  }

  var apply = $('btnImportApply');
  if (apply) apply.addEventListener('click', applyImport);

  var clear = $('btnImportClear');
  if (clear) {
    clear.addEventListener('click', function () {
      imp.list = [];
      imp.slots = null;
      renderImportList();
      impTip('');
    });
  }
}

/* 把当前草稿导出成 JSON 文件，换手机或者清理浏览器之前存一份 */
function exportTimetable() {
  var data = ed.tt || TB;
  if (!data || !Array.isArray(data.courses)) { impTip('没有可以导出的课表。', true); return; }
  var text = JSON.stringify({
    term: data.term || {},
    slots: data.slots || {},
    courses: data.courses || [],
    slotMinutes: data.slotMinutes || 45
  }, null, 2);
  var blob = new Blob([text], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  var d = new Date();
  a.href = url;
  a.download = '课表备份-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  impTip('已经导出，存好这个文件，换设备时用「选文件」导回来。');
}

function setupExport() {
  var b = $('btnEdExport');
  if (b) b.addEventListener('click', exportTimetable);
}

  /* ---------- 冲突判断 ---------- */

  /* 某天的某段时间有没有课 */
  function clashOn(dateStr2, timeStr2) {
    if (!dateStr2 || !timeStr2) return null;
    var d = parseDate(dateStr2);
    var mins = minutesOf(timeStr2);
    var cs = dayCourses(d);
    for (var i = 0; i < cs.length; i++) {
      if (mins >= cs[i].startMin && mins < cs[i].endMin) return cs[i];
    }
    return null;
  }

  /* 步骤或规划有没有跟课撞 */
  function planClash(p) {
    if (!p || !p.steps) return null;
    for (var i = 0; i < p.steps.length; i++) {
      var s = p.steps[i];
      if (!s.at) continue;
      var from = p.from || '';
      if (!from) continue;
      /* 多天的规划，只有开始那天能对上课表 */
      var c = clashOn(from, s.at);
      if (c) return { step: s, course: c, date: from };
    }
    return null;
  }

  /* ---------- 规划 ---------- */

  function findPlan(id) {
    for (var i = 0; i < state.plans.length; i++) {
      if (state.plans[i].id === id) return state.plans[i];
    }
    return null;
  }

  function addPlan() {
    var t = $('planText');
    var text = (t.value || '').trim();
    if (!text) { t.focus(); return; }

    var from = $('planFrom').value || '';
    var to = $('planTo').value || '';

    var p = {
      id: 'p' + Date.now() + Math.floor(Math.random() * 1000),
      text: text,
      from: from,
      to: to || from,
      steps: []
    };
    state.plans.unshift(p);
    save('plans');
    t.value = '';
    var tip = $('planTip');
    if (tip) { tip.className = 'tip'; tip.textContent = ''; }
    renderPlans();
  }

  function addStep(planId) {
    var p = findPlan(planId);
    if (!p) return;
    var inp = document.querySelector('[data-padd="' + planId + '"]');
    var timeInp = document.querySelector('[data-paddtime="' + planId + '"]');
    if (!inp) return;
    var v = (inp.value || '').trim();
    if (!v) { inp.focus(); return; }

    var at = (timeInp && timeInp.value) || '';

    /* 跟课撞了也要让加，只是提示一句 */
    var c = at ? clashOn(p.from, at) : null;

    if (!p.steps) p.steps = [];
    p.steps.push({ text: v, at: at, done: false, clash: !!c });
    sortSteps(p);
    save('plans');
    renderPlans();

    if (c) {
      var tip = $('planTip');
      if (tip) {
        tip.className = 'tip show';
        tip.textContent = '「' + v + '」排在 ' + at + '，这个时间有课：' + c.name +
          '（' + c.room + '，' + c.start + '-' + c.end + '）。已经加上了，它前面会有橙色记号。';
      }
    } else {
      var tip2 = $('planTip');
      if (tip2) { tip2.className = 'tip'; tip2.textContent = ''; }
    }
  }

  function sortSteps(p) {
    if (!p.steps) return;
    var withT = p.steps.filter(function (s) { return s.at; });
    var noT = p.steps.filter(function (s) { return !s.at; });
    withT.sort(function (a, b) { return minutesOf(a.at) - minutesOf(b.at); });
    p.steps = withT.concat(noT);
  }

  function renderPlans() {
    var box = $('planList');
    if (!box) return;

    var list = state.plans.slice().sort(function (a, b) {
      return (b.from || '').localeCompare(a.from || '');
    });

    var cnt = $('planCount');
    if (cnt) cnt.textContent = list.length ? list.length + ' 条' : '';

    if (!list.length) {
      box.innerHTML = '<div class="empty-tip">还没有规划。上面加一条，再往里添步骤。</div>';
      return;
    }

    box.innerHTML = list.map(function (p) {
      var range = p.from && p.to ? (p.from + ' 到 ' + p.to) : (p.from || p.to || '');
      var steps = p.steps || [];
      var doneN = steps.filter(function (s) { return s.done; }).length;
      var allDone = steps.length > 0 && doneN === steps.length;
      var clash = planClash(p);

      var stepHtml = steps.map(function (s, i) {
        var stepClash = s.at ? clashOn(p.from, s.at) : null;
        return '<div class="step ' + (s.done ? 'done' : '') + '">' +
          '<span class="step-chk" data-pdone="' + esc(p.id) + '" data-si="' + i + '">' + (s.done ? '✓' : '') + '</span>' +
          '<span class="step-no">' + (i + 1) + '</span>' +
          (s.at ? '<span class="step-time' + (stepClash ? ' clash' : '') + '" title="' +
            (stepClash ? '这个时间有课：' + esc(stepClash.name) : '') + '">' + esc(s.at) + '</span>' : '') +
          '<span class="step-text">' + esc(s.text) + '</span>' +
          '<button class="step-del" data-pstepdel="' + esc(p.id) + '" data-si="' + i + '" title="删掉这步">×</button>' +
          '</div>';
      }).join('');

      var bar = '';
      if (steps.length) {
        var pct = Math.round(doneN / steps.length * 100);
        bar = '<div class="step-bar"><div class="step-bar-in" style="width:' + pct + '%;"></div></div>';
      }

      var clashNote = clash ? '<span class="clash">　·　有节课撞着</span>' : '';

      return '<div class="plan-item' + (allDone ? ' plan-done' : '') + '">' +
        '<div class="plan-head">' +
        '<div class="body">' +
        '<div class="t">' + esc(p.text) + '</div>' +
        '<div class="meta">' + (range ? esc(range) : '没填日期') +
        (steps.length ? '　·　' + doneN + ' / ' + steps.length + ' 步' : '') + clashNote + '</div>' +
        '</div>' +
        '<button class="plan-del" data-pd="' + esc(p.id) + '">删除</button>' +
        '</div>' +
        (bar ? bar : '') +
        (stepHtml ? '<div class="steps">' + stepHtml + '</div>' : '') +
        '<div class="step-add">' +
        '<input class="step-time-input" data-paddtime="' + esc(p.id) + '" type="time" title="几点做这步">' +
        '<input class="step-input" data-padd="' + esc(p.id) + '" placeholder="加一步，比如 买高铁票">' +
        '<button class="btn sm" data-paddbtn="' + esc(p.id) + '">加步骤</button>' +
        '</div>' +
        '</div>';
    }).join('');

    /* 事件 */
    Array.prototype.forEach.call(box.querySelectorAll('[data-pd]'), function (el) {
      el.addEventListener('click', function () {
        state.plans = state.plans.filter(function (x) { return x.id !== el.dataset.pd; });
        save('plans'); renderPlans();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-pdone]'), function (el) {
      el.addEventListener('click', function () {
        var p = findPlan(el.dataset.pdone);
        if (!p || !p.steps) return;
        var s = p.steps[+el.dataset.si];
        if (!s) return;
        s.done = !s.done;
        save('plans'); renderPlans();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-pstepdel]'), function (el) {
      el.addEventListener('click', function () {
        var p = findPlan(el.dataset.pstepdel);
        if (!p || !p.steps) return;
        p.steps.splice(+el.dataset.si, 1);
        save('plans'); renderPlans();
      });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-paddbtn]'), function (b) {
      b.addEventListener('click', function () { addStep(b.dataset.paddbtn); });
    });
    Array.prototype.forEach.call(box.querySelectorAll('[data-padd]'), function (inp) {
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addStep(inp.dataset.padd); }
      });
    });
  }

  /* ---------- 时间记录 ---------- */

  function renderCats() {
    var sel = $('tCat');
    if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = state.cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    if (cur && state.cats.indexOf(cur) >= 0) sel.value = cur;
  }

  function addTime() {
    var start = $('tStart').value;
    var end = $('tEnd').value;
    var cat = $('tCat').value;
    var what = ($('tWhat').value || '').trim();

    if (!start || !end) return;
    if (minutesOf(end) <= minutesOf(start)) {
      var tip = $('timeTip');
      if (tip) { tip.className = 'tip show'; tip.textContent = '结束时间要晚于开始时间。'; }
      return;
    }

    state.times.unshift({ date: dateStr(), start: start, end: end, cat: cat, what: what });
    save('times');
    $('tWhat').value = '';

    /* 记的时间如果正好在课时里，说一句 */
    var c = clashOn(dateStr(), start);
    var tip2 = $('timeTip');
    if (c && tip2) {
      tip2.className = 'tip show';
      tip2.textContent = '这段时间正好是「' + c.name + '」的上课时间，已经照你说的记上了。';
    } else if (tip2) {
      tip2.className = 'tip'; tip2.textContent = '';
    }

    renderTime();
    renderStats();
  }

  function renderTime() {
    var today = dateStr();
    var todays = state.times.filter(function (t) { return t.date === today; });

    /* 合计 */
    var total = 0;
    todays.forEach(function (t) {
      var m = minutesOf(t.end) - minutesOf(t.start);
      if (m > 0) total += m;
    });
    var sum = $('timeSum');
    if (sum) sum.textContent = todays.length ? '共 ' + (Math.round(total / 6) / 10) + ' 小时' : '';

    var box = $('dayList');
    if (box) {
      if (!todays.length) {
        box.innerHTML = '<div class="empty-tip">今天还没记</div>';
      } else {
        box.innerHTML = todays.map(function (t, i) {
          return '<div class="step" style="padding:8px 0;border-bottom:1px solid #f4f6f9;">' +
            '<span class="step-time">' + esc(t.start) + '-' + esc(t.end) + '</span>' +
            '<span class="step-text">' + esc(t.cat) + (t.what ? '　' + esc(t.what) : '') + '</span>' +
            '<button class="step-del" data-delt="' + i + '">删</button>' +
            '</div>';
        }).join('');

        Array.prototype.forEach.call(box.querySelectorAll('[data-delt]'), function (b) {
          b.addEventListener('click', function () {
            var obj = todays[Number(b.dataset.delt)];
            var idx = state.times.indexOf(obj);
            if (idx >= 0) state.times.splice(idx, 1);
            save('times');
            renderTime();
            renderStats();
          });
        });
      }
    }

    /* 各类占比 */
    var byCat = {};
    todays.forEach(function (t) {
      var m = minutesOf(t.end) - minutesOf(t.start);
      if (m > 0) byCat[t.cat] = (byCat[t.cat] || 0) + m;
    });
    var bar = $('catBar');
    if (bar) {
      var keys = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; });
      var all = keys.reduce(function (s, k) { return s + byCat[k]; }, 0);
      if (!keys.length) {
        bar.innerHTML = '<div class="empty-tip">记了才看得到</div>';
      } else {
        bar.innerHTML = keys.map(function (k) {
          var pct = Math.round(byCat[k] / all * 100);
          var free = FREE_CATS.indexOf(k) >= 0;
          return '<div class="cat-line">' +
            '<span class="nm">' + esc(k) + '</span>' +
            '<span class="tr"><span class="fl" style="width:' + pct + '%;background:' +
            (free ? '#8fae86' : '#c9b8a0') + ';"></span></span>' +
            '<span class="hr">' + (Math.round(byCat[k] / 6) / 10) + ' 时 ' + pct + '%</span>' +
            '</div>';
        }).join('');
      }
    }
  }

  /* ---------- 统计 ---------- */

  function renderStats() {
    var week = weekOf(new Date());
    var load = weekLoad(week);

    /* 一周可用总时长：按每天 16 小时自由时间算（去掉睡觉 8 小时） */
    var WEEK_MIN = 7 * 16 * 60;
    var classMin = load.minutes;
    var freeMin = WEEK_MIN - classMin;

    var mon = mondayOfWeek(week);
    var weekDays = [];
    for (var i = 0; i < 7; i++) weekDays.push(dateStr(new Date(mon.getTime() + i * DAY)));

    /* 本周记了多少（按时间段跟课时有重叠就算记了那节课） */
    var recorded = 0;
    var seen = {};
    weekDays.forEach(function (ds) {
      state.times.forEach(function (t) {
        if (t.date !== ds) return;
        var cs = dayCourses(parseDate(ds));
        cs.forEach(function (c, ci) {
          var key = ds + '-' + ci + '-' + c.name;
          if (seen[key]) return;
          /* 记录的时间段跟课时重叠就算 */
          if (minutesOf(t.start) < c.endMin && minutesOf(t.end) > c.startMin) {
            seen[key] = true;
            recorded++;
          }
        });
      });
    });

    var el1 = $('stClass'); if (el1) el1.innerHTML = load.count + '<small>节</small>';
    var el2 = $('stRecorded'); if (el2) el2.innerHTML = recorded + '<small>节</small>';
    var el3 = $('stFree');
    if (el3) el3.innerHTML = (Math.round(freeMin / 6) / 10) + '<small>小时</small>';

    /* 可支配时间进度条 */
    var prog = $('freeProg');
    if (prog) {
      var classPct = Math.round(classMin / WEEK_MIN * 100);
      var freePct = 100 - classPct;
      var freeHours = Math.round(freeMin / 6) / 10;

      /* 这周规划里有几步、已经排了多长时间 */
      var planSteps = 0, planMin = 0;
      state.plans.forEach(function (p) {
        (p.steps || []).forEach(function (s) {
          if (p.from && weekDays.indexOf(p.from) >= 0) {
            planSteps++;
            if (s.at) planMin += 60;   /* 有时间的按一小时估 */
          }
        });
      });

      prog.innerHTML =
        '<div class="prog">' +
        '<div class="prog-head"><span>一周里被课占掉的时间</span>' +
        '<span class="num">' + (Math.round(classMin / 6) / 10) + ' 小时 · ' + classPct + '%</span></div>' +
        '<div class="prog-bar"><span class="in" style="width:' + classPct + '%;background:#7d9bc4;"></span></div>' +
        '</div>' +
        '<div class="prog">' +
        '<div class="prog-head"><span>剩下能自己支配的</span>' +
        '<span class="num">' + freeHours + ' 小时 · ' + freePct + '%</span></div>' +
        '<div class="prog-bar"><span class="in" style="width:' + freePct + '%;background:#8fae86;"></span></div>' +
        '</div>' +
        '<div class="prog-note">按每天 16 小时清醒时间算，一周一共 112 小时。' +
        (planSteps ? '这周规划里有 ' + planSteps + ' 步待做' + (planMin ? '，其中有时间的约 ' + (Math.round(planMin / 6) / 10) + ' 小时' : '') + '。' : '这周规划里还没排事。') +
        '</div>';
    }

    /* 课表与实际记录 */
    var clashBox = $('clashBox');
    if (clashBox) {
      var rows = [];
      weekDays.forEach(function (ds) {
        var d = parseDate(ds);
        var cs = dayCourses(d);
        if (!cs.length) return;
        var dayRec = state.times.filter(function (t) { return t.date === ds; });
        var covered = 0;
        cs.forEach(function (c) {
          var hit = dayRec.some(function (t) {
            return minutesOf(t.start) < c.endMin && minutesOf(t.end) > c.startMin;
          });
          if (hit) covered++;
        });
        var dayName = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
        rows.push({
          ds: ds,
          name: '周' + dayName + ' ' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()),
          total: cs.length,
          covered: covered
        });
      });

      if (!rows.length) {
        clashBox.innerHTML = '<div class="empty-tip">这周没有课</div>';
      } else {
        clashBox.innerHTML = rows.map(function (r) {
          var pct = Math.round(r.covered / r.total * 100);
          return '<div class="prog">' +
            '<div class="prog-head"><span>' + r.name + '</span>' +
            '<span class="num">' + r.total + ' 节课，记了 ' + r.covered + ' 节</span></div>' +
            '<div class="prog-bar"><span class="in" style="width:' + pct + '%;background:' +
            (pct === 100 ? '#8fae86' : '#c9b8a0') + ';"></span></div>' +
            '</div>';
        }).join('');
      }
    }
  }

  /* ---------- 页签 ---------- */

  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.remove('active');
    });
    var view = $('view' + name.charAt(0).toUpperCase() + name.slice(1));
    if (view) view.classList.add('active');

    if (name === 'timetable') { renderNextClass(); renderTimetable(); }
    if (name === 'plans') renderPlans();
    if (name === 'time') { renderCats(); renderTime(); }
    if (name === 'stats') renderStats();
  }

  function init() {
    load();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    var wp = $('weekPrev');
    if (wp) wp.addEventListener('click', function () { shiftWeek(-1); });
    var wn = $('weekNext');
    if (wn) wn.addEventListener('click', function () { shiftWeek(1); });

    var bp = $('btnAddPlan');
    if (bp) bp.addEventListener('click', addPlan);
    var pt = $('planText');
    if (pt) pt.addEventListener('keydown', function (e) { if (e.key === 'Enter') addPlan(); });

    var bt = $('btnAddTime');
    if (bt) bt.addEventListener('click', addTime);

    /* 课表编辑 */
    var bet = $('btnEditTimetable');
    if (bet) bet.addEventListener('click', openEditor);
    var bes = $('btnEdSave');
    if (bes) bes.addEventListener('click', saveTimetable);
    var bec = $('btnEdCancel');
    if (bec) bec.addEventListener('click', closeEditor);
    var ber = $('btnEdReset');
    if (ber) ber.addEventListener('click', resetEditorDefault);

    /* 导入课表 */
    setupImport();
    setupExport();
    var bas = $('btnEdAddSlot');
    if (bas) bas.addEventListener('click', addSlot);
    var bac = $('btnEdAddCourse');
    if (bac) bac.addEventListener('click', function () {
      if (!ed.tt) openEditor();
      ed.editing = 'new';
      formTip('');
      renderEditor();
    });
    /* 学期两个框是静态的，改动要同步进工作副本，否则重渲染会把手输的冲掉 */
    var ef = $('edFirst');
    if (ef) ef.addEventListener('change', function () { if (ed.tt) ed.tt.term.firstMonday = ef.value; });
    var et = $('edTotalWeeks');
    if (et) et.addEventListener('change', function () { if (ed.tt) ed.tt.term.totalWeeks = parseInt(et.value, 10) || ed.tt.term.totalWeeks; });

    /* 日期默认今天 */
    var pf = $('planFrom');
    if (pf && !pf.value) pf.value = dateStr();
    var pto = $('planTo');
    if (pto && !pto.value) pto.value = dateStr();

    renderNextClass();
    renderTimetable();
    renderPlans();
    renderCats();
    renderTime();
    renderStats();
    switchTab('timetable');
  }

  window.TimeModule = {
    init: init,
    state: state,
    weekOf: weekOf,
    mondayOfWeek: mondayOfWeek,
    isOddWeek: isOddWeek,
    courseInWeek: courseInWeek,
    courseTime: courseTime,
    dayCourses: dayCourses,
    weekLoad: weekLoad,
    nextClass: nextClass,
    clashOn: clashOn,
    planClash: planClash,
    addPlan: addPlan,
    addStep: addStep,
    addTime: addTime,
    switchTab: switchTab,
    shiftWeek: shiftWeek,
    migrate: migrate,
    renderTimetable: renderTimetable,
    renderPlans: renderPlans,
    renderTime: renderTime,
    renderStats: renderStats,
    renderNextClass: renderNextClass,
    getTimetable: effectiveTT,
    openEditor: openEditor,
    closeEditor: closeEditor,
    resetTimetableDefault: resetEditorDefault,
    saveTimetable: saveTimetable,
    saveCourseForm: saveCourseForm,
    editCourse: editCourse,
    deleteCourse: deleteCourse,
    addSlot: addSlot,
    deleteSlot: deleteSlot,
    parseWeeksText: parseWeeksText,
    ed: ed,
    FREE_CATS: FREE_CATS,
    DEFAULT_CATS: DEFAULT_CATS
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
