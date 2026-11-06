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
    var first = parseDate(TB.term.firstMonday);
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var diff = Math.round((d - first) / DAY);
    return Math.floor(diff / 7) + 1;
  }

  /* 某一周的周一 */
  function mondayOfWeek(week) {
    var first = parseDate(TB.term.firstMonday);
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

  /* ---------- 生效课表 ---------- */

  /* 编辑保存过的课表优先；存的结构不完整就当没有，用回自带数据 */
  function effectiveTT() {
    var saved = db.get('timetable', null);
    if (saved && saved.term && saved.slots && Array.isArray(saved.courses)) return saved;
    return window.WorkbenchTimetable || {};
  }

  /* 第一次用：把自带的真实课表写进数据里，这样它能参与同步，
   * 手机/其他设备登录同一账号后拉下来就有了（原来只存在静态文件里，永远同步不到）。 */
  (function seedTimetable() {
    try {
      var saved = db.get('timetable', null);
      if (saved && saved.term && Array.isArray(saved.courses)) return;   // 已经有，不动
      var def = window.WorkbenchTimetable;
      if (!def || !def.term || !Array.isArray(def.courses) || !def.courses.length) return;
      if (!def.term.firstMonday && !def.term.name) return;               // 出厂空课表不写
      db.set('timetable', JSON.parse(JSON.stringify(def)));
      /* 只写本地：上传交给到点那一轮或手动上传 */
    } catch (e) {}
  })();

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

    /* 用哪几节做行：取实际用到的节次范围 */
    var maxSlot = 0;
    (TB.courses || []).forEach(function (c) { if (c.to > maxSlot) maxSlot = c.to; });
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

  /* 保存一条课程。校验统一走 shared/course-rules.js，
   * AI 改课表也用同一份规则，两边不会打架。 */
  function saveCourseForm() {
    var name = ($('edCName').value || '').trim();
    if (!name) { formTip('课程名要填一个'); return; }

    var day = Number($('edCDay').value);
    var from = parseInt($('edCFrom').value, 10);
    var to = parseInt($('edCTo').value, 10);

    var weeksSel = $('edCWeeksSel').value;
    var weeks = weeksSel;
    if (weeksSel === 'custom') {
      var parsed = parseWeeksText($('edCWeeksText').value);
      if (!parsed) { formTip('指定周次没填对，示例：1,3,5-7'); return; }
      weeks = parsed;
    }

    var obj = {
      day: day,
      from: from,
      to: to,
      start: $('edCStart').value || '',
      end: $('edCEnd').value || '',
      name: name,
      room: ($('edCRoom').value || '').trim(),
      weeks: weeks
    };

    var R = window.WorkbenchCourseRules;
    if (R) {
      R.fillTimes(ed.tt, obj);
      var err = R.validate(ed.tt, obj);
      if (err) { formTip(err); return; }

      var skip = (ed.editing === 'new') ? -1 : ed.editing;
      var hit = R.conflict(ed.tt, obj, skip);
      if (hit) {
        formTip('这个时间已经有「' + hit.course.name + '」了（' + R.human(ed.tt, hit.course) +
          '），换成别的时间，或者先把那节改掉。');
        return;
      }
    } else {
      /* 规则文件没加载到时的兜底，别让这里静默放行 */
      if (!(from >= 1) || !(to >= from)) { formTip('节次要填对，开始那节不能比结束那节晚'); return; }
      if (!ed.tt.slots[from] || !ed.tt.slots[to]) {
        formTip('第 ' + from + ' 或第 ' + to + ' 节不存在，先在“作息节次”里加上'); return;
      }
      if (!obj.start) obj.start = ed.tt.slots[from].start;
      if (!obj.end) obj.end = ed.tt.slots[to].end;
      if (!obj.start || !obj.end) { formTip('起止时间要填（或先把那节的作息时间填好）'); return; }
      if (minutesOf(obj.end) <= minutesOf(obj.start)) { formTip('结束时间要晚于开始时间'); return; }
    }

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(first)) { edTip('第一周周一是哪天要填上（用上面的日期框选）'); return; }
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

  /* ---------- 专注（番茄钟） ---------- */

  var F_LIST = 'focus';      /* 每个番茄一条：{date, start, end, min, task, done} */
  var F_CFG = 'focusCfg';
  var F_RUN = 'focusRun';    /* 正在跑的那一轮，关掉页面再开能接着走 */
  var RING = 326.7;          /* 圆周长，2π×52 */

  var focus = { timer: null, run: null, audio: null, warned: false };

  function focusList() {
    var l = db.get(F_LIST, []);
    return Array.isArray(l) ? l : [];
  }

  function focusCfg() {
    var c = db.get(F_CFG, {});
    return (c && typeof c === 'object') ? c : {};
  }

  function saveFocusCfg(patch) {
    var c = focusCfg();
    Object.keys(patch).forEach(function (k) { c[k] = patch[k]; });
    db.set(F_CFG, c);
  }

  function timeOfMs(ms) {
    var d = new Date(ms);
    return hhmm(d.getHours() * 60 + d.getMinutes());
  }

  function startFocus() {
    if (focus.run) return;

    var lenEl = $('focusLen');
    var len = Number(lenEl ? lenEl.value : 25) || 25;
    var taskEl = $('focusTask');
    var task = ((taskEl && taskEl.value) || '').trim();

    var now = Date.now();
    focus.run = { startAt: now, endAt: now + len * 60000, min: len, task: task };
    focus.warned = false;
    db.set(F_RUN, focus.run);

    var st = $('focusStart');
    if (st) st.style.display = 'none';
    var sp = $('focusStop');
    if (sp) sp.style.display = '';

    var hint = $('ffHint');
    if (hint) { hint.className = 'ff-hint'; hint.textContent = '按 ESC 退出'; }
    var ft = $('ffTask');
    if (ft) ft.textContent = task || '专心这一轮';

    showFull(true);
    startNoise();
    paintFocus();

    if (focus.timer) clearInterval(focus.timer);
    focus.timer = setInterval(tickFocus, 1000);
  }

  function tickFocus() {
    if (!focus.run) return;
    if (Date.now() >= focus.run.endAt) { finishFocus(true); return; }
    paintFocus();
    checkClassWarn();
  }

  function paintFocus() {
    if (!focus.run) return;
    var total = focus.run.min * 60000;
    var left = Math.max(0, focus.run.endAt - Date.now());

    var txt = Math.floor(left / 60000) + ':' + p2(Math.floor((left % 60000) / 1000));
    var num = $('focusNum');
    if (num) num.textContent = txt;
    var ff = $('ffNum');
    if (ff) ff.textContent = txt;

    var fg = $('frFg');
    if (fg) fg.style.strokeDashoffset = String(RING * (1 - left / total));
  }

  /* 有课就提前二十分钟喊一声 */
  function checkClassWarn() {
    if (focus.warned) return;
    var n = nextClass();
    if (!n || n.daysAhead !== 0 || n.minutesLeft === null) return;
    if (n.minutesLeft > 0 && n.minutesLeft <= 20) {
      focus.warned = true;
      var hint = $('ffHint');
      if (hint) {
        hint.className = 'ff-hint warn';
        hint.textContent = '还有 ' + n.minutesLeft + ' 分钟上课：' + n.course.name;
      }
      try {
        var sh = window.__WORKBENCH_SHELL__;
        if (sh && sh.notify) sh.notify('快上课了', '还有 ' + n.minutesLeft + ' 分钟上「' + n.course.name + '」');
      } catch (e) {}
    }
  }

  function stopFocusTimer() {
    if (focus.timer) { clearInterval(focus.timer); focus.timer = null; }
  }

  /* completed=true 是做满了，false 是提前结束 */
  function finishFocus(completed) {
    if (!focus.run) return;
    var r = focus.run;
    focus.run = null;
    stopFocusTimer();
    db.remove(F_RUN);
    stopNoise();
    showFull(false);

    var st = $('focusStart');
    if (st) st.style.display = '';
    var sp = $('focusStop');
    if (sp) sp.style.display = 'none';
    var num = $('focusNum');
    if (num) num.textContent = p2(Math.round(r.min)) + ':00';
    var fg = $('frFg');
    if (fg) fg.style.strokeDashoffset = '0';

    var endMs = completed ? r.endAt : Date.now();
    var mins = Math.max(1, Math.round((endMs - r.startAt) / 60000));

    var list = focusList();
    list.unshift({
      date: dateStr(),
      start: timeOfMs(r.startAt),
      end: timeOfMs(endMs),
      min: mins,
      task: r.task,
      done: !!completed
    });
    db.set(F_LIST, list);

    /* 顺手记一条时间记录，不用再手动补 */
    if (mins >= 1) {
      var N = window.WorkbenchNormalize;
      var cat = N ? N.fixCat('', r.task || '') : '';
      if (!cat || cat === '休息') cat = '自学';

      state.times.unshift({
        date: dateStr(),
        start: timeOfMs(r.startAt),
        end: timeOfMs(endMs),
        cat: cat,
        what: r.task || '专注'
      });
      save('times');
      renderTime();
      renderStats();
    }

    renderFocus();

    try {
      var sh = window.__WORKBENCH_SHELL__;
      if (sh && sh.notify) {
        sh.notify(completed ? '这一轮做完了' : '提前结束了',
          (r.task ? r.task + '：' : '') + mins + ' 分钟，已经记进时间记录了。');
      }
    } catch (e) {}
  }

  /* ---------- 白噪音 ---------- */
  /* 不用外部音频文件：现攒一段噪声，按档位改滤波，随音量淡入 */
  function startNoise() {
    stopNoise();
    var sel = $('focusNoise');
    var mode = (sel && sel.value) || 'off';
    if (mode === 'off') return;

    var volEl = $('focusVol');
    var vol = Number(volEl ? volEl.value : 35) / 100;
    if (!(vol > 0)) return;

    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();

      var len = Math.floor(ctx.sampleRate * 2);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;

      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = mode === 'rain' ? 1400 : mode === 'cafe' ? 620 : 7000;

      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = mode === 'cafe' ? 130 : 40;

      var gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(Math.max(0.02, vol * 0.45), ctx.currentTime + 0.8);

      src.connect(hp);
      hp.connect(lp);
      lp.connect(gain);
      gain.connect(ctx.destination);
      src.start();

      focus.audio = { ctx: ctx, src: src, gain: gain };
    } catch (e) {
      focus.audio = null;
    }
  }

  function stopNoise() {
    if (!focus.audio) return;
    try { focus.audio.src.stop(); } catch (e) {}
    try { focus.audio.ctx.close(); } catch (e) {}
    focus.audio = null;
  }

  function setNoiseVolume(v) {
    if (!focus.audio) return;
    try {
      focus.audio.gain.gain.value = Math.max(0, Number(v) / 100 * 0.45);
    } catch (e) {}
  }

  /* ---------- 全屏 ---------- */

  function showFull(on) {
    var el = $('focusFull');
    if (el) el.classList.toggle('show', !!on);

    var sh = window.__WORKBENCH_SHELL__;
    try {
      if (sh && sh.winFullscreen) {
        sh.winFullscreen(!!on);
      } else if (on) {
        if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
      } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      }
    } catch (e) {}
  }

  /* 页面上把上一次没跑完的番茄接上 */
  function restoreFocus() {
    var r = db.get(F_RUN, null);
    if (!r || !r.endAt || !r.startAt) return;

    if (r.endAt <= Date.now()) {
      /* 关页面的时候正好结束了，补一笔记录 */
      focus.run = r;
      finishFocus(true);
      return;
    }

    focus.run = r;
    /* 全屏层上的字要按这一轮重写：关掉再开时它还留着上一轮的名字，
     * 看着像"接上了但接错了"，验证脚本抓过这个 */
    var ft = $('ffTask');
    if (ft) ft.textContent = r.task || '专心这一轮';
    var hint = $('ffHint');
    if (hint) { hint.className = 'ff-hint'; hint.textContent = '按 ESC 退出'; }
    var st = $('focusStart');
    if (st) st.style.display = 'none';
    var sp = $('focusStop');
    if (sp) sp.style.display = '';

    showFull(true);
    startNoise();
    paintFocus();
    if (focus.timer) clearInterval(focus.timer);
    focus.timer = setInterval(tickFocus, 1000);
  }

  function renderFocus() {
    var list = focusList();
    var today = dateStr();
    var mine = list.filter(function (f) { return f.date === today; });
    var totalMin = mine.reduce(function (x, f) { return x + Number(f.min || 0); }, 0);

    /* 连着第几天有番茄 */
    var days = {};
    list.forEach(function (f) { days[f.date] = true; });
    var streak = 0;
    var cur = new Date();
    for (var i = 0; i < 400; i++) {
      var k = dateStr(cur);
      if (!days[k]) break;
      streak++;
      cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() - 1);
    }

    var stat = $('focusStat');
    if (stat) {
      if (!mine.length) {
        stat.textContent = '今天还没开过番茄。挑一件事，专心做一轮。';
      } else {
        stat.textContent = '今天 ' + mine.length + ' 个番茄，共 ' + totalMin + ' 分钟' +
          (streak > 1 ? '，连着第 ' + streak + ' 天' : '');
      }
    }

    var head = $('focusToday');
    if (head) head.textContent = mine.length ? mine.length + ' 个 · ' + totalMin + ' 分钟' : '';

    var box = $('focusList');
    if (!box) return;

    if (!mine.length) {
      box.innerHTML = '<div class="empty-tip">今天还没开过番茄。做完一轮会自动记进时间记录，不用再手动补。</div>';
      return;
    }

    box.innerHTML = mine.map(function (f) {
      return '<div class="step" style="padding:8px 0;border-bottom:1px solid #f4f6f9;">' +
        '<span class="step-time">' + esc(f.start) + '-' + esc(f.end) + '</span>' +
        '<span class="step-text">' + esc(f.task || '专注') + '　' + Number(f.min) + ' 分钟' +
        (f.done ? '' : '（提前结束）') + '</span>' +
        '</div>';
    }).join('');
  }

  /* ---------- 数据看板：学习、花销、情绪三条线 ---------- */

  var boardRange = 'week';
  var STUDY_CATS = { '上课': 1, '作业': 1, '自学': 1 };

  function money2(n) {
    var v = Math.round(Number(n) * 100) / 100;
    if (!isFinite(v)) return '0';
    return v % 1 === 0 ? String(v) : String(v.toFixed(2));
  }

  function boardRows() {
    var n = boardRange === 'week' ? 7 : 30;
    var base = new Date();
    var out = [];

    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() - i);
      out.push({ key: dateStr(d), label: (d.getMonth() + 1) + '/' + d.getDate(), mins: 0, cost: 0, mood: null });
    }

    var times = db.get('times', []) || [];
    var exps = WorkbenchStore.namespace('life').get('expenses', []) || [];
    var moods = WorkbenchStore.namespace('notes').get('moods', {}) || {};

    out.forEach(function (r) {
      times.forEach(function (t) {
        if (t.date !== r.key || !STUDY_CATS[t.cat]) return;
        var a = minutesOf(t.start), b = minutesOf(t.end);
        if (b > a) r.mins += b - a;
      });
      exps.forEach(function (e) {
        if (e.date === r.key) r.cost += Number(e.amount || 0);
      });
      if (moods[r.key] && moods[r.key].mood !== undefined) r.mood = Number(moods[r.key].mood);
    });

    return out;
  }

  function renderBoard() {
    var box = $('boardBox');
    var legend = $('boardLegend');
    if (!box) return;

    var rows = boardRows();
    var any = rows.some(function (r) { return r.mins || r.cost || r.mood !== null; });
    var span = boardRange === 'week' ? '七天' : '三十天';

    if (!any) {
      box.innerHTML = '<div class="board-empty">最近' + span + '还没有数据。<br>' +
        '记点时间、记几笔账、打一次情绪分，这里就长出曲线了。</div>';
      if (legend) legend.innerHTML = '';
      return;
    }

    var W = 720, H = 186, PL = 16, PR = 16, PT = 14, PB = 26;
    var iw = W - PL - PR, ih = H - PT - PB;
    var n = rows.length;

    var maxMins = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.mins; })));
    var maxCost = Math.max(1, Math.max.apply(null, rows.map(function (r) { return r.cost; })));

    function X(i) { return PL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); }
    function Y(v, max) { return PT + ih - Math.min(1, v / max) * ih; }

    var out = [];
    out.push('<svg viewBox="0 0 ' + W + ' ' + H + '">');

    for (var g = 0; g <= 3; g++) {
      var gy = PT + (ih / 3) * g;
      out.push('<line x1="' + PL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + gy.toFixed(1) + '" stroke="#f0f3f7" stroke-width="1"/>');
    }

    /* 学习时长：面积 + 线 */
    var areaPts = rows.map(function (r, i) { return X(i).toFixed(1) + ',' + Y(r.mins, maxMins).toFixed(1); });
    out.push('<polygon fill="rgba(74,111,165,.10)" points="' + PL + ',' + (PT + ih) + ' ' +
      areaPts.join(' ') + ' ' + (W - PR) + ',' + (PT + ih) + '"/>');
    out.push('<polyline fill="none" stroke="#4a6fa5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
      areaPts.join(' ') + '"/>');

    /* 花销：线 */
    var costPts = rows.map(function (r, i) { return X(i).toFixed(1) + ',' + Y(r.cost, maxCost).toFixed(1); });
    out.push('<polyline fill="none" stroke="#e08a5f" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
      costPts.join(' ') + '"/>');

    /* 情绪：散点。没记的那天就不画，别编 */
    rows.forEach(function (r, i) {
      if (r.mood === null) return;
      out.push('<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(r.mood, 10).toFixed(1) + '" r="3.2" fill="#7e57c2"/>');
    });

    /* 日期刻度 */
    var step = n <= 7 ? 1 : 5;
    rows.forEach(function (r, i) {
      if (i % step !== 0 && i !== n - 1) return;
      out.push('<text x="' + X(i).toFixed(1) + '" y="' + (H - 7) + '" font-size="10" fill="#a8b2c0" text-anchor="middle">' +
        r.label + '</text>');
    });

    /* 每天的悬停区 */
    var band = n <= 1 ? iw : iw / (n - 1);
    rows.forEach(function (r, i) {
      out.push('<rect class="board-hit" data-i="' + i + '" x="' + Math.max(0, X(i) - band / 2).toFixed(1) +
        '" y="0" width="' + band.toFixed(1) + '" height="' + H + '" fill="transparent"/>');
    });

    out.push('</svg>');
    out.push('<div class="board-tip" id="boardTip"></div>');
    box.innerHTML = out.join('');

    if (legend) {
      legend.innerHTML =
        '<span><i style="background:#4a6fa5"></i>学习时长（最多 ' + maxMins + ' 分钟/天）</span>' +
        '<span><i style="background:#e08a5f"></i>花销（最多 ' + money2(maxCost) + ' 元/天）</span>' +
        '<span><i style="background:#7e57c2"></i>情绪（0-10，没记的那天不画）</span>';
    }

    var tip = $('boardTip');
    Array.prototype.forEach.call(box.querySelectorAll('.board-hit'), function (hit) {
      hit.addEventListener('mouseenter', function () {
        var r = rows[Number(hit.dataset.i)];
        if (!r || !tip) return;
        tip.innerHTML = r.key + '<br>学习 ' + r.mins + ' 分钟 · 花销 ' + money2(r.cost) + ' 元' +
          (r.mood === null ? ' · 没记情绪' : ' · 情绪 ' + r.mood + '/10');
        tip.style.display = 'block';

        var br = box.getBoundingClientRect();
        var hr = hit.getBoundingClientRect();
        var left = hr.left - br.left + hr.width / 2 - 60;
        tip.style.left = Math.max(0, Math.min(br.width - 150, left)) + 'px';
        tip.style.top = '6px';
      });
      hit.addEventListener('mouseleave', function () {
        if (tip) tip.style.display = 'none';
      });
    });
  }

  function setupFocus() {
    var start = $('focusStart');
    if (start) start.addEventListener('click', startFocus);

    var stop = $('focusStop');
    if (stop) stop.addEventListener('click', function () { finishFocus(false); });

    var lenEl = $('focusLen');
    if (lenEl) {
      var c = focusCfg();
      if (c.len) lenEl.value = String(c.len);
      lenEl.addEventListener('change', function () {
        saveFocusCfg({ len: lenEl.value });
        var num = $('focusNum');
        if (num) num.textContent = p2(Number(lenEl.value)) + ':00';
      });
    }

    var noise = $('focusNoise');
    if (noise) {
      var c2 = focusCfg();
      if (c2.noise) noise.value = c2.noise;
      noise.addEventListener('change', function () {
        saveFocusCfg({ noise: noise.value });
        paintVolState();
        if (focus.run) startNoise();
      });
    }

    /* 白噪音关着的时候音量条摆那儿没用，灰掉别让人白拖 */
    function paintVolState() {
      var v = $('focusVol');
      if (!v || !noise) return;
      var off = noise.value === 'off';
      v.disabled = off;
      v.style.opacity = off ? '.38' : '1';
      v.title = off ? '先选一种白噪音再调音量' : '音量';
    }
    paintVolState();

    var vol = $('focusVol');
    if (vol) {
      var c3 = focusCfg();
      if (c3.vol !== undefined) vol.value = String(c3.vol);
      vol.addEventListener('input', function () {
        saveFocusCfg({ vol: vol.value });
        setNoiseVolume(vol.value);
      });
    }

    /* ESC 退出全屏 */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && focus.run) finishFocus(false);
    });

    var tabs = document.querySelectorAll('.board-tab');
    Array.prototype.forEach.call(tabs, function (b) {
      b.addEventListener('click', function () {
        boardRange = b.dataset.board === 'month' ? 'month' : 'week';
        Array.prototype.forEach.call(tabs, function (x) { x.classList.toggle('active', x === b); });
        renderBoard();
      });
    });

    /* 番茄进度每秒更新，标签页切回来也不错位 */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && focus.run) paintFocus();
    });
  }

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
    if (name === 'focus') renderFocus();
    if (name === 'stats') { renderStats(); renderBoard(); }
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
    renderFocus();
    renderBoard();
    setupFocus();
    restoreFocus();
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
    DEFAULT_CATS: DEFAULT_CATS,
    /* 专注与看板，验证脚本用 */
    startFocus: startFocus,
    finishFocus: finishFocus,
    renderFocus: renderFocus,
    restoreFocus: restoreFocus,
    focusList: focusList,
    renderBoard: renderBoard,
    boardRows: boardRows,
    setBoardRange: function (r) { boardRange = r === 'month' ? 'month' : 'week'; renderBoard(); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
