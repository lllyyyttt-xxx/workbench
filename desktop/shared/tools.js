/* 工作台工具层
 *
 * 让 AI 能查数据，也能真正动手改数据。
 *
 * 每个工具四部分：给 AI 看的说明、参数、预览、执行。
 *
 * 写操作（write: true）不直接落地，走两道闸：
 *   1. 先跑 preview()，把「我要把周三 Web 前端挪到周五」这句话交给界面，
 *      界面上弹出确认条，你点同意才继续；
 *   2. 真正执行前先存一份快照，执行完压进撤销栈，点一下就能退回去。
 *
 * 这样既省事又不至于它一迷糊就把课表洗了。
 */
window.WorkbenchTools = (function () {
  'use strict';

  var store = window.WorkbenchStore;

  /* 这几个模块靠加载顺序保证，取不到就退化成不做（而不是整个坏掉） */
  function undoMod() { return window.WorkbenchUndo || null; }
  function memMod() { return window.WorkbenchMemory || null; }
  function rulesMod() { return window.WorkbenchCourseRules || null; }
  function normMod() { return window.WorkbenchNormalize || null; }

  function plan(label, detail) { return { label: label, detail: detail || label }; }
  function fail(msg) { return { error: msg }; }

  /* ---------------- 公用 ---------------- */

  function ns(id) { return store.namespace(id); }

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function monthStr(offset) {
    var d = new Date();
    /* 必须先把日期拨到 1 号再挪月份。31 号直接 setMonth(-1) 会溢出：
     * 10 月 31 日减一个月 = "9 月 31 日" = 10 月 1 日，上个月就算成本月了。
     * 每月最后几天问"上个月花了多少"会答错，是 2026-10-31 跑测试才发现的。 */
    d.setDate(1);
    d.setMonth(d.getMonth() + (offset || 0));
    return d.getFullYear() + '-' + pad(d.getMonth() + 1);
  }

  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    if (!isFinite(v)) return '0';
    return v % 1 === 0 ? String(v) : String(parseFloat(v.toFixed(2)));
  }

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function minutesOf(hhmm) {
    var p = String(hhmm || '').split(':');
    var h = Number(p[0]);
    var m = Number(p[1]);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }

  function humanMins(min) {
    if (!min) return '0 分钟';
    var h = Math.floor(min / 60);
    var m = min % 60;
    if (!h) return m + ' 分钟';
    return h + ' 小时' + (m ? ' ' + m + ' 分钟' : '');
  }

  function touch(moduleId) {
    try {
      window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: moduleId } }));
    } catch (e) {}
  }

  function checkDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    var d = new Date(String(s) + 'T00:00:00');
    return !isNaN(d.getTime());
  }

  /* ---------------- 课表基础 ---------------- */

  function timetable() {
    var tt = ns('time').get('timetable', null);
    if (!tt || !tt.term || !Array.isArray(tt.courses)) {
      tt = window.WorkbenchTimetable || null;
    }
    if (!tt || !tt.term || !tt.term.firstMonday || !Array.isArray(tt.courses)) return null;

    /* 拿默认表时复制一份，别把全局对象改了 */
    return {
      term: JSON.parse(JSON.stringify(tt.term)),
      slots: JSON.parse(JSON.stringify(tt.slots || {})),
      slotMinutes: tt.slotMinutes,
      courses: (tt.courses || []).map(function (c) {
        return { day: c.day, from: c.from, to: c.to, start: c.start, end: c.end, name: c.name, room: c.room || '', weeks: c.weeks };
      })
    };
  }

  function saveTimetable(tt) {
    ns('time').set('timetable', tt);
    touch('time');
  }

  function dateAt(y, m, d) { return new Date(y, m - 1, d); }

  function weekOf(tt, d) {
    var f = String(tt.term.firstMonday).split('-');
    var first = dateAt(Number(f[0]), Number(f[1]), Number(f[2]));
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor(Math.round((day - first) / 86400000) / 7) + 1;
  }

  function dayIndex(d) { return d.getDay() === 0 ? 7 : d.getDay(); }

  function coursesOn(tt, d) {
    var week = weekOf(tt, d);
    var di = dayIndex(d);
    var out = [];
    tt.courses.forEach(function (c) {
      if (Number(c.day) !== di) return;
      var w = c.weeks;
      if (w === 'odd' && week % 2 !== 1) return;
      if (w === 'even' && week % 2 !== 0) return;
      if (Array.isArray(w) && w.indexOf(week) < 0) return;
      out.push(c);
    });
    out.sort(function (a, b) {
      return String(a.start || '').localeCompare(String(b.start || ''));
    });
    return out;
  }

  /* 按课程名 + 可选星期/节次定位一条课，找不到或找到多条都返回说明 */
  function findCourse(tt, name, day, from) {
    var kw = String(name || '').trim();
    if (!kw) return { error: '要说是哪门课。' };

    var hits = tt.courses.filter(function (c) { return String(c.name) === kw; });
    if (!hits.length) {
      hits = tt.courses.filter(function (c) { return String(c.name).indexOf(kw) >= 0; });
    }
    if (day) hits = hits.filter(function (c) { return Number(c.day) === Number(day); });
    if (from) hits = hits.filter(function (c) { return Number(c.from) === Number(from); });

    if (!hits.length) return { error: '课表里没找到「' + kw + '」。' };

    if (hits.length > 1) {
      var R = rulesMod();
      var desc = hits.map(function (c) {
        return R ? R.human(tt, c) : (c.name + ' 周' + c.day + ' 第' + c.from + '-' + c.to + '节');
      }).join('；');
      return { error: '有 ' + hits.length + ' 节都叫「' + kw + '」：' + desc + '。说清是星期几或第几节。' };
    }

    var target = hits[0];
    var idx = tt.courses.indexOf(target);
    return { index: idx, course: target };
  }

  /* ---------------- 读工具 ---------------- */

  function queryExpenses(a) {
    var exps = ns('life').get('expenses', []) || [];
    if (!exps.length) return { ok: true, text: '还没有记过账。' };

    var scope = a.date ? 'date' : (a.scope || 'month');
    var list = exps.slice();

    if (scope === 'date') {
      list = list.filter(function (e) { return e.date === a.date; });
    } else if (scope === 'today') {
      var td = todayStr();
      list = list.filter(function (e) { return e.date === td; });
    } else if (scope === 'month') {
      var ym = monthStr(0);
      list = list.filter(function (e) { return String(e.date).indexOf(ym) === 0; });
    } else if (scope === 'lastMonth') {
      var lm = monthStr(-1);
      list = list.filter(function (e) { return String(e.date).indexOf(lm) === 0; });
    }

    if (a.cat) list = list.filter(function (e) { return e.cat === a.cat; });
    if (!list.length) return { ok: true, text: '这段时间没有符合条件的记录。' };

    var sum = list.reduce(function (x, e) { return x + Number(e.amount || 0); }, 0);
    var byCat = {};
    list.forEach(function (e) {
      var c = e.cat || '其他';
      byCat[c] = (byCat[c] || 0) + Number(e.amount || 0);
    });
    var cats = Object.keys(byCat).sort(function (x, y) { return byCat[y] - byCat[x]; });

    var label = a.date ? a.date : ({ today: '今天', month: '本月', lastMonth: '上个月', all: '全部' }[scope] || '这段时间');
    var txt = label + (a.cat ? '的' + a.cat : '') + '一共 ' + money(sum) + ' 元，' + list.length + ' 笔。';
    txt += '按类别：' + cats.map(function (c) {
      return c + ' ' + money(byCat[c]) + ' 元';
    }).join('，') + '。';

    var recent = list.slice().sort(function (x, y) {
      return String(y.date).localeCompare(String(x.date));
    }).slice(0, 5);
    txt += '最近几笔：' + recent.map(function (e) {
      return e.date + ' ' + (e.cat || '其他') + ' ' + money(e.amount) + ' 元' + (e.note ? '（' + e.note + '）' : '');
    }).join('；') + '。';

    return { ok: true, text: txt, data: { sum: sum, count: list.length, byCat: byCat } };
  }

  function queryTodos(a) {
    var todos = ns('life').get('todos', []) || [];
    var which = a.which || 'open';

    var list = todos.filter(function (t) {
      if (which === 'all') return true;
      if (which === 'done') return t.done;
      return !t.done;
    });

    if (!list.length) {
      return { ok: true, text: which === 'done' ? '还没有做完的待办。' : '现在没有未完成的待办。' };
    }

    var td = todayStr();
    var txt = list.map(function (t) {
      var extra = '';
      if (t.done) extra = '（已完成）';
      else if (t.due && t.due < td) extra = '（已过期 ' + t.due + '）';
      else if (t.due) extra = '（截止 ' + t.due + '）';
      return t.text + extra;
    }).join('；');

    return { ok: true, text: '一共 ' + list.length + ' 条：' + txt };
  }

  function queryPlans(a) {
    var plans = ns('time').get('plans', []) || [];
    if (!plans.length) return { ok: true, text: '还没有行程规划。' };

    var list = plans;
    if (a.name) {
      list = plans.filter(function (p) {
        return String(p.text || '').indexOf(a.name) >= 0;
      });
      if (!list.length) return { ok: false, text: '没找到名字里带「' + a.name + '」的行程。' };
    } else {
      var active = plans.filter(function (p) {
        var st = p.steps || [];
        return !(st.length && st.every(function (x) { return x.done; }));
      });
      if (active.length) list = active;
    }

    var parts = list.map(function (p) {
      var st = p.steps || [];
      var doneN = st.filter(function (x) { return x.done; }).length;
      var head = '「' + p.text + '」';
      if (p.from || p.to) head += '（' + (p.from || '?') + ' 到 ' + (p.to || '?') + '）';
      if (!st.length) return head + '，还没有步骤';

      var stepsTxt = st.map(function (x) {
        return (x.done ? '✓' : '○') + (x.at ? ' ' + x.at : '') + ' ' + x.text;
      }).join('，');
      return head + ' ' + doneN + '/' + st.length + ' 步：' + stepsTxt;
    });

    var text = parts.join('。');
    if (!/。$/.test(text)) text += '。';
    return { ok: true, text: text };
  }

  function queryCountdowns() {
    var cds = ns('life').get('cds', []) || [];
    if (!cds.length) return { ok: true, text: '还没有设倒计时。' };

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var rows = [];

    cds.forEach(function (c) {
      var d = nextDate(c, today);
      if (!d) return;
      rows.push({ name: c.name, days: Math.round((d - today) / 86400000) });
    });

    if (!rows.length) return { ok: true, text: '倒计时都过期了。' };
    rows.sort(function (x, y) { return x.days - y.days; });

    return {
      ok: true,
      text: rows.map(function (r) { return '「' + r.name + '」还有 ' + r.days + ' 天'; }).join('；') + '。'
    };
  }

  function nextDate(cd, today) {
    if (!today) {
      today = new Date();
      today.setHours(0, 0, 0, 0);
    }
    if (cd.type === 'once') {
      if (!cd.date) return null;
      var d = new Date(cd.date + 'T00:00:00');
      return isNaN(d) ? null : (d >= today ? d : null);
    }
    if (cd.type === 'monthly') {
      var day = Math.min(Number(cd.day) || 1, 31);
      var y = today.getFullYear(), m = today.getMonth();
      for (var k = 0; k < 13; k++) {
        var cand = new Date(y, m + k, Math.min(day, new Date(y, m + k + 1, 0).getDate()));
        if (cand >= today) return cand;
      }
      return null;
    }
    if (cd.type === 'yearly') {
      var base = cd.date ? new Date(cd.date + 'T00:00:00') : null;
      if (!base || isNaN(base)) return null;
      var c = new Date(today.getFullYear(), base.getMonth(), base.getDate());
      if (c < today) c = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate());
      return c;
    }
    return null;
  }

  function oneDayText(tt, d) {
    var names = ['日', '一', '二', '三', '四', '五', '六'];
    var head = (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + names[d.getDay()];
    var cs = coursesOn(tt, d);
    if (!cs.length) return head + '没课';
    return head + '有 ' + cs.length + ' 节课：' + cs.map(function (c) {
      var seg = '';
      if (c.from && c.to) seg = '第' + c.from + (c.to !== c.from ? '-' + c.to : '') + '节 ';
      var time = (c.start || '') + (c.end ? '-' + c.end : '');
      return '「' + c.name + '」' + seg + time + (c.room ? ' 在 ' + c.room : '');
    }).join('；');
  }

  function queryTimetable(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '还没拿到课表数据。' };

    if (a.date) {
      var p = String(a.date).split('-');
      if (p.length !== 3) return { ok: false, text: '日期看不懂：' + a.date + '，要写成 2026-11-03 这样。' };
      var d = dateAt(Number(p[0]), Number(p[1]), Number(p[2]));
      if (isNaN(d.getTime())) return { ok: false, text: '日期看不懂：' + a.date };
      return { ok: true, text: oneDayText(tt, d) + '。' };
    }

    var scope = a.scope || 'today';
    if (scope === 'tomorrow') {
      var t = new Date();
      var tm = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
      return { ok: true, text: '明天' + oneDayText(tt, tm) + '。' };
    }

    if (scope === 'week') {
      var now = new Date();
      var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dayIndex(now) - 1));
      var lines = [];
      for (var i = 0; i < 7; i++) {
        var dd = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
        lines.push(oneDayText(tt, dd));
      }
      return { ok: true, text: '本周（第 ' + weekOf(tt, now) + ' 周）课表：' + lines.join('；') + '。' };
    }

    var today = new Date();
    return { ok: true, text: '今天' + oneDayText(tt, today) + '，现在是第 ' + weekOf(tt, today) + ' 周。' };
  }

  /* 空档：按作息节次，把有课的节次挖掉，剩下的连成段 */
  function freeBlocks(tt, d) {
    var cs = coursesOn(tt, d);
    var slots = tt.slots || {};
    var maxSlot = 0;
    Object.keys(slots).forEach(function (k) { if (Number(k) > maxSlot) maxSlot = Number(k); });
    if (!maxSlot) maxSlot = 9;

    var busy = {};
    cs.forEach(function (c) {
      for (var n = Number(c.from); n <= Number(c.to); n++) busy[n] = c.name;
    });

    var blocks = [];
    var cur = null;
    for (var i = 1; i <= maxSlot; i++) {
      if (busy[i]) {
        cur = null;
        continue;
      }
      if (!cur) { cur = { from: i, to: i }; blocks.push(cur); }
      else cur.to = i;
    }

    return {
      maxSlot: maxSlot,
      busyCount: cs.length,
      courses: cs,
      blocks: blocks.map(function (b) {
        var s = slots[b.from] ? slots[b.from].start : '';
        var e = slots[b.to] ? slots[b.to].end : '';
        return { from: b.from, to: b.to, start: s, end: e };
      })
    };
  }

  function queryFreeTime(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '还没拿到课表数据。' };

    function line(d) {
      var f = freeBlocks(tt, d);
      var names = ['日', '一', '二', '三', '四', '五', '六'];
      var head = '周' + names[d.getDay()];
      if (!f.blocks.length) return head + '整天都有课';
      return head + '空着：' + f.blocks.map(function (b) {
        var seg = '第' + b.from + (b.to !== b.from ? '-' + b.to : '') + '节';
        var time = b.start && b.end ? '（' + b.start + '-' + b.end + '）' : '';
        return seg + time;
      }).join('、');
    }

    if (a.date) {
      if (!checkDate(a.date)) return { ok: false, text: '日期要写成 2026-11-03 这样。' };
      var p = a.date.split('-');
      var d = dateAt(Number(p[0]), Number(p[1]), Number(p[2]));
      return { ok: true, text: a.date + ' ' + line(d) + '。' };
    }

    var now = new Date();
    if (a.scope === 'week') {
      var monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dayIndex(now) - 1));
      var out = [];
      for (var i = 0; i < 5; i++) {
        out.push(line(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)));
      }
      return { ok: true, text: '本周（第 ' + weekOf(tt, now) + ' 周）空档：' + out.join('；') + '。' };
    }

    return { ok: true, text: '今天' + line(now) + '。' };
  }

  /* ---------------- 时间记录 ---------------- */

  function queryTimeRecords(a) {
    var list = ns('time').get('times', []) || [];
    if (!list.length) return { ok: true, text: '还没有记过时间记录。' };

    var scope = a.date ? 'date' : (a.scope || 'today');
    var day = todayStr();
    var rows = list.slice();

    if (scope === 'date') {
      rows = rows.filter(function (r) { return r.date === a.date; });
    } else if (scope === 'today') {
      rows = rows.filter(function (r) { return r.date === day; });
    } else if (scope === 'week') {
      var since = new Date();
      since.setDate(since.getDate() - 6);
      var k = since.getFullYear() + '-' + pad(since.getMonth() + 1) + '-' + pad(since.getDate());
      rows = rows.filter(function (r) { return String(r.date) >= k; });
    } else if (scope === 'month') {
      var ym = monthStr(0);
      rows = rows.filter(function (r) { return String(r.date).indexOf(ym) === 0; });
    }

    if (a.cat) rows = rows.filter(function (r) { return r.cat === a.cat; });
    if (!rows.length) return { ok: true, text: '这段时间没有时间记录。' };

    var total = 0;
    var byCat = {};
    rows.forEach(function (r) {
      var s1 = minutesOf(r.start);
      var e1 = minutesOf(r.end);
      var mins = (s1 !== null && e1 !== null && e1 > s1) ? (e1 - s1) : 0;
      total += mins;
      var c = r.cat || '其他';
      byCat[c] = (byCat[c] || 0) + mins;
    });

    var cats = Object.keys(byCat).sort(function (x, y) { return byCat[y] - byCat[x]; });
    var label = scope === 'today' ? '今天'
      : scope === 'date' ? (a.date || '这天')
      : scope === 'week' ? '最近七天' : scope === 'month' ? '本月' : '全部';

    var txt = label + '记了 ' + rows.length + ' 条，共 ' + humanMins(total) + '。';
    if (cats.length) {
      txt += '按类别：' + cats.map(function (c) {
        var pct = total ? Math.round(byCat[c] / total * 100) : 0;
        return c + ' ' + humanMins(byCat[c]) + '（' + pct + '%）';
      }).join('、') + '。';
    }

    var recent = rows.slice(0, 3).map(function (r) {
      var what = r.what ? '「' + r.what + '」' : '';
      return (r.date || '').slice(5) + ' ' + (r.start || '') + '-' + (r.end || '') + ' ' + (r.cat || '其他') + what;
    });
    if (recent.length) txt += '最近几条：' + recent.join('；') + '。';

    return { ok: true, text: txt, data: { total: total, byCat: byCat, count: rows.length } };
  }

  function queryNotes(a) {
    var s = ns('notes');
    var notes = s.get('notes', []) || [];
    var moods = s.get('moods', {}) || {};
    var parts = [];

    var list = notes.slice();
    if (a.keyword) list = list.filter(function (n) { return String(n.text || '').indexOf(a.keyword) >= 0; });
    if (a.date) list = list.filter(function (n) { return n.date === a.date; });

    if (list.length) {
      var n = Number(a.limit) || 5;
      if (n > 20) n = 20;
      if (n < 1) n = 1;
      var head = '随手记' + (a.keyword ? '里有 ' + list.length + ' 条含「' + a.keyword + '」的' : '里有 ' + list.length + ' 条');
      parts.push(head + '，最近 ' + Math.min(n, list.length) + ' 条：' + list.slice(0, n).map(function (x) {
        var mark = x.mark ? '【' + x.mark + '】' : '';
        return (x.date || '').slice(5) + ' ' + mark + String(x.text || '').slice(0, 60);
      }).join('；'));
    } else if (a.keyword) {
      return { ok: true, text: '没找到含「' + a.keyword + '」的随手记。' };
    } else if (a.date) {
      return { ok: true, text: a.date + ' 这天没记什么。' };
    } else {
      parts.push('灵感收件箱还空着');
    }

    var keys = Object.keys(moods).sort().slice(-7);
    if (keys.length) {
      parts.push('情绪精力最近 ' + keys.length + ' 天：' + keys.map(function (k) {
        var m = moods[k] || {};
        return k.slice(5) + ' 情绪 ' + (m.mood === undefined ? '-' : m.mood) + '/10、精力 ' + (m.energy === undefined ? '-' : m.energy) + '/10';
      }).join('；'));
    }

    return { ok: true, text: parts.join('；') + '。' };
  }

  function queryChallenges(a) {
    var recs = ns('challenge').get('records', []) || [];
    if (!recs.length) return { ok: true, text: '还没有抽过挑战。' };

    var scope = a.scope || 'all';
    var rows = recs.slice();
    var label = '全部记录';

    if (scope === 'today') {
      rows = rows.filter(function (r) { return r.date === todayStr(); });
      label = '今天';
    } else if (scope === 'week') {
      var since = new Date();
      since.setDate(since.getDate() - 6);
      var k = since.getFullYear() + '-' + pad(since.getMonth() + 1) + '-' + pad(since.getDate());
      rows = rows.filter(function (r) { return String(r.date) >= k; });
      label = '最近七天';
    }

    if (!rows.length) return { ok: true, text: label + '没有挑战记录。' };

    var done = rows.filter(function (r) { return r.result === 'done'; }).length;
    var txt = label + '一共抽了 ' + rows.length + ' 次，完成 ' + done + ' 次，放弃 ' + (rows.length - done) + ' 次。';

    var recent = rows.slice(0, 3).map(function (r) {
      var st = r.result === 'done' ? '完成' : '放弃';
      var tier = r.tier ? '[' + r.tier + ']' : '';
      return (r.date || '').slice(5) + ' ' + tier + '「' + String(r.text || '').slice(0, 40) + '」' + st;
    });
    if (recent.length) txt += '最近几次：' + recent.join('；') + '。';

    return { ok: true, text: txt };
  }

  /* 番茄统计 */
  function queryFocus(a) {
    var foc = ns('time').get('focus', []) || [];
    var today = todayStr();
    var mine = foc.filter(function (f) { return f.date === today; });

    if (!foc.length) return { ok: true, text: '还没用过番茄钟。' };

    var totalMin = mine.reduce(function (x, f) { return x + Number(f.min || 0); }, 0);
    var txt = '今天专注 ' + mine.length + ' 个番茄，共 ' + humanMins(totalMin) + '。';

    /* 连续天数：从今天往前数，哪天有番茄就算 */
    var days = {};
    foc.forEach(function (f) { days[f.date] = true; });
    var streak = 0;
    var d = new Date();
    while (true) {
      var k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      if (!days[k]) break;
      streak++;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }
    if (streak > 1) txt += '连着第 ' + streak + ' 天有番茄。';

    if (a.scope === 'week') {
      var weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 6);
      var kw = weekAgo.getFullYear() + '-' + pad(weekAgo.getMonth() + 1) + '-' + pad(weekAgo.getDate());
      var w = foc.filter(function (f) { return f.date >= kw; });
      txt += '最近七天一共 ' + w.length + ' 个。';
    }

    return { ok: true, text: txt, data: { today: mine.length, minutes: totalMin, streak: streak } };
  }

  /* ---------------- 联网搜索 ----------------
   * 模型自己不知道、或者会过时的东西（考试时间、政策、新闻、价格）靠它。
   * 真正发请求的是外壳（主进程），页面这边只负责把结果整理成人话。
   * 浏览器里没有外壳，就明说用不了——不能装作搜过。
   */
  function webSearch(a) {
    var q = String((a && (a.q || a.query || a.keyword)) || '').trim();
    if (!q) return { ok: false, text: '搜索词是空的，想查什么？' };

    var sh = window.__WORKBENCH_SHELL__;
    if (!sh || typeof sh.webSearch !== 'function') {
      return { ok: false, text: '联网搜索要在桌面版里才有（浏览器里发不出去）。' };
    }

    var n = Math.max(1, Math.min(Number(a.n) || 6, 8));
    return sh.webSearch(q, n).then(function (r) {
      r = r || {};
      var list = Array.isArray(r.results) ? r.results.slice(0, n) : [];
      if (!list.length) {
        return {
          ok: false,
          text: '「' + q + '」没搜到结果' + (r.error ? '（' + r.error + '）' : '') +
            '。换个说法再搜一次，或者直接说没查到。'
        };
      }
      var lines = list.map(function (it, i) {
        var t = String(it.title || '').trim();
        var s = String(it.snippet || '').trim();
        var u = String(it.url || '').trim();
        return (i + 1) + '. ' + t + (s ? '\n   ' + s : '') + (u ? '\n   ' + u : '');
      });
      return {
        ok: true,
        text: '搜到 ' + list.length + ' 条（关键词：' + q + '，来源：' + (r.source || '必应') + '）：\n' +
          lines.join('\n') +
          '\n这些是网页摘要。日期以摘要里写的为准，摘要没写的别自己编，可以说没查到确切时间。'
      };
    }, function (e) {
      return { ok: false, text: '搜索失败：' + String((e && e.message) || e) };
    });
  }

  /* 记忆读取 */
  function queryMemory(a) {
    var M = memMod();
    if (!M) return { ok: false, text: '记忆模块没加载起来。' };

    var list = M.search(a.keyword || '');
    if (!list.length) {
      return { ok: true, text: a.keyword ? '关于「' + a.keyword + '」我这边没记下什么。' : '我这边还没记过关于你的事。' };
    }

    return {
      ok: true,
      text: '我记着 ' + list.length + ' 条：' + list.slice(-15).map(function (m) { return m.text; }).join('；') + '。'
    };
  }

  /* 四级陪练：把该背的词端出来，让模型带着人练。
   * 模型自己认识这些词，所以这里只给"哪些词该练、之前错得多不多"，答案由它现场出。 */
  function queryCet4(a) {
    var eng = ns('english');
    var srs = eng.get('vocab_srs', {}) || {};
    var stats = eng.get('vocab_stats', {}) || {};
    var book = eng.get('vocab_notebook', []) || [];
    if (!srs || typeof srs !== 'object' || Array.isArray(srs)) srs = {};

    var words = Object.keys(srs);
    var scope = String(a.scope || 'due');
    var n = Math.max(1, Math.min(20, Number(a.count) || 8));
    var now = Date.now();

    /* 今天的打卡：练了几个、对了几个 */
    var t = stats[todayStr()] || {};
    var head = t.n ? '今天已经练过 ' + t.n + ' 个词，对了 ' + (t.ok || 0) + ' 个。' : '今天还没练词。';

    if (!words.length) {
      return {
        ok: true,
        text: '英语那边还没开始背词，词库里一个复习记录都没有。' + head +
          '可以先去英语工作台挑一组词，或者我按四级高频词现场考你几个。'
      };
    }

    var pool;
    if (scope === 'notebook') {
      pool = book.map(function (b) { return String(b.w || b.word || b.text || ''); }).filter(Boolean);
      if (!pool.length) return { ok: true, text: head + '生词本还是空的。' };
    } else if (scope === 'weak') {
      /* 反复练还是不熟的：复习次数少、但又到期的排前面 */
      pool = words.filter(function (w) { return Number((srs[w] || {}).s || 0) <= 2; });
      if (!pool.length) pool = words.slice();
    } else {
      pool = words.filter(function (w) { var r = srs[w] || {}; return r.d && r.d <= now; });
      if (!pool.length) {
        return {
          ok: true,
          text: head + '这会儿没有到期的词，不用硬练。想加练我可以按「不熟的」挑几个。'
        };
      }
    }

    /* 到期早的先上，其次复习次数少的 */
    pool.sort(function (x, y) {
      var rx = srs[x] || {}, ry = srs[y] || {};
      var dx = rx.d || 0, dy = ry.d || 0;
      if (dx !== dy) return dx - dy;
      return (rx.s || 0) - (ry.s || 0);
    });

    var pick = pool.slice(0, n);
    var lines = pick.map(function (w, i) {
      var r = srs[w] || {};
      var lv = r.lv === 'cet6' ? '六级' : '四级';
      return (i + 1) + '. ' + w + '（' + lv + '，复习过 ' + (r.s || 0) + ' 次）';
    });

    var txt = head + '这 ' + pick.length + ' 个词该练了：\n' + lines.join('\n') +
      '\n练的时候一个一个来：先给中文意思让它想英文，或者给英文让它说意思，别一次把答案全说了。它答错就直说错在哪，答对再下一个。';

    return { ok: true, text: txt, data: { words: pick, scope: scope } };
  }

  /* 周复盘：把这一周的数据摊平给模型，让它写一段像样的复盘 */
  function weekRangeOf(offset) {
    var now = new Date();
    var dow = (now.getDay() + 6) % 7;              /* 0 = 周一 */
    var mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow - 7 * (offset || 0));
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return {
      from: dstr(mon),
      to: dstr(sun),
      mon: mon
    };
  }

  function dstr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function queryWeeklyReview(a) {
    var off = Math.max(0, Math.min(8, Number(a.weeks_ago) || 0));
    var r = weekRangeOf(off);
    var inRange = function (d) { return d && d >= r.from && d <= r.to; };

    var parts = [];
    parts.push((off === 0 ? '本周' : off + ' 周前那周') + '（' + r.from + ' 到 ' + r.to + '）');

    /* 时间记录 */
    var times = (ns('time').get('times', []) || []).filter(function (t) { return inRange(t.date); });
    var byCat = {};
    var totalMin = 0;
    times.forEach(function (t) {
      var a1 = minutesOf(t.start), b1 = minutesOf(t.end);
      var m = (a1 !== null && b1 !== null && b1 > a1) ? (b1 - a1) : 0;
      totalMin += m;
      var c = t.cat || '没分类';
      byCat[c] = (byCat[c] || 0) + m;
    });

    if (times.length) {
      var top = Object.keys(byCat).sort(function (x, y) { return byCat[y] - byCat[x]; }).slice(0, 3);
      var studyMin = 0;
      ['上课', '作业', '自学'].forEach(function (c) { studyMin += byCat[c] || 0; });
      parts.push('记了 ' + times.length + ' 段时间，共 ' + humanMins(totalMin) +
        '（学习类 ' + humanMins(studyMin) + '）');
      parts.push('时间主要花在：' + top.map(function (c) {
        return c + ' ' + humanMins(byCat[c]) + '（' + Math.round(byCat[c] / Math.max(1, totalMin) * 100) + '%）';
      }).join('、'));
    } else {
      parts.push('这周没有时间记录');
    }

    /* 番茄 */
    var foc = (ns('time').get('focus', []) || []).filter(function (f) { return inRange(f.date); });
    if (foc.length) {
      var fmin = foc.reduce(function (x, f) { return x + Number(f.min || 0); }, 0);
      parts.push('番茄 ' + foc.length + ' 个，共 ' + humanMins(fmin));
    }

    /* 花销 */
    var exps = (ns('life').get('expenses', []) || []).filter(function (e) { return inRange(e.date); });
    if (exps.length) {
      var sum = 0, byCat2 = {};
      exps.forEach(function (e) {
        var v = Number(e.amount || 0);
        sum += v;
        var c = e.cat || '其他';
        byCat2[c] = (byCat2[c] || 0) + v;
      });
      var big = Object.keys(byCat2).sort(function (x, y) { return byCat2[y] - byCat2[x]; })[0];
      parts.push('花销 ' + money(sum) + ' 元，共 ' + exps.length + ' 笔，最多的是' + big + ' ' + money(byCat2[big]) + ' 元');
    }

    /* 待办（没有完成时间，只能看当前状态，别瞎编） */
    var todos = ns('life').get('todos', []) || [];
    if (todos.length) {
      var doneN = todos.filter(function (t) { return t.done; }).length;
      var openN = todos.length - doneN;
      var added = todos.filter(function (t) { return inRange(dstr(new Date(Number(t.t) || 0))); }).length;
      parts.push('待办这周新加 ' + added + ' 件，现在已完成 ' + doneN + ' 件、还剩 ' + openN + ' 件');
    }

    /* 挑战 */
    var chs = (ns('challenge').get('records', []) || []).filter(function (c) { return inRange(c.date); });
    if (chs.length) {
      var cdone = chs.filter(function (c) { return c.result === 'done'; }).length;
      parts.push('抽了 ' + chs.length + ' 次挑战，完成 ' + cdone + ' 次、放弃 ' + (chs.length - cdone) + ' 次');
    }

    /* 情绪精力 */
    var moods = ns('notes').get('moods', {}) || {};
    var mDays = Object.keys(moods).filter(function (k) { return inRange(k); });
    if (mDays.length) {
      var ms = 0, es = 0;
      mDays.forEach(function (k) {
        ms += Number(moods[k].mood || 0);
        es += Number(moods[k].energy || 0);
      });
      parts.push('情绪平均 ' + (ms / mDays.length).toFixed(1) + '/10，精力平均 ' +
        (es / mDays.length).toFixed(1) + '/10（记了 ' + mDays.length + ' 天）');
    }

    /* 背词 */
    var stats = ns('english').get('vocab_stats', {}) || {};
    var wDays = Object.keys(stats).filter(function (k) { return inRange(k); });
    if (wDays.length) {
      var wn = 0, wok = 0;
      wDays.forEach(function (k) { wn += Number(stats[k].n || 0); wok += Number(stats[k].ok || 0); });
      parts.push('背词 ' + wn + ' 个，对了 ' + wok + ' 个（' + wDays.length + ' 天有练）');
    }

    if (parts.length <= 1) {
      return { ok: true, text: '这段时间基本没留下数据，复盘不出什么。' };
    }

    parts.push('按这些写一段复盘：先说这周实际做了什么（用数字），再说哪里和计划不一样、为什么，最后给两三条下周能真做到的调整。别喊口号，也别编数据里没有的事。');

    return { ok: true, text: parts.join('\n') };
  }

  /* 今天总览：首页「今天」也用这个，所以给结构化数据 */
  function todayData() {
    var out = {
      date: todayStr(),
      week: 0,
      courses: [],
      todosDue: 0,
      todosOpen: 0,
      countdown: null,
      focus: 0,
      focusMinutes: 0,
      timeMinutes: 0,
      mood: null
    };

    var tt = timetable();
    var now = new Date();
    if (tt) {
      out.week = weekOf(tt, now);
      out.courses = coursesOn(tt, now).map(function (c) {
        return { name: c.name, room: c.room || '', start: c.start || '', end: c.end || '', from: c.from, to: c.to };
      });
    }

    var todos = ns('life').get('todos', []) || [];
    var td = out.date;
    out.todosOpen = todos.filter(function (t) { return !t.done; }).length;
    out.todosDue = todos.filter(function (t) { return !t.done && t.due && t.due <= td; }).length;

    var cds = ns('life').get('cds', []) || [];
    var best = null;
    cds.forEach(function (c) {
      var d = nextDate(c);
      if (!d) return;
      var days = Math.round((d - startOfToday()) / 86400000);
      if (!best || days < best.days) best = { name: c.name, days: days };
    });
    out.countdown = best;

    var foc = ns('time').get('focus', []) || [];
    var mine = foc.filter(function (f) { return f.date === td; });
    out.focus = mine.length;
    out.focusMinutes = mine.reduce(function (x, f) { return x + Number(f.min || 0); }, 0);

    var times = ns('time').get('times', []) || [];
    out.timeMinutes = times.filter(function (r) { return r.date === td; }).reduce(function (x, r) {
      var s1 = minutesOf(r.start), e1 = minutesOf(r.end);
      return x + ((s1 !== null && e1 !== null && e1 > s1) ? (e1 - s1) : 0);
    }, 0);

    var moods = ns('notes').get('moods', {}) || {};
    out.mood = moods[td] || null;

    return out;
  }

  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function queryTodayMsg() {
    var t = todayData();
    var parts = [];
    parts.push('今天是第 ' + t.week + ' 周');
    parts.push(t.courses.length ? ('有 ' + t.courses.length + ' 节课：' + t.courses.map(function (c) {
      return c.name + ' ' + c.start + '-' + c.end + (c.room ? ' ' + c.room : '');
    }).join('；')) : '今天没课');
    if (t.todosOpen) parts.push('待办还剩 ' + t.todosOpen + ' 条' + (t.todosDue ? '（今天到期 ' + t.todosDue + ' 条）' : ''));
    if (t.countdown) parts.push('最近的事是「' + t.countdown.name + '」还有 ' + t.countdown.days + ' 天');
    if (t.focus) parts.push('今天已经专注 ' + t.focus + ' 个番茄，共 ' + humanMins(t.focusMinutes));
    if (t.timeMinutes) parts.push('今天记了 ' + humanMins(t.timeMinutes) + ' 的时间');
    if (t.mood) parts.push('情绪 ' + t.mood.mood + '/10、精力 ' + t.mood.energy + '/10');

    return { ok: true, text: parts.join('，') + '。', data: t };
  }

  /* ---------------- 追加（原有） ---------------- */

  function addTodo(a) {
    var text = String(a.text || '').trim();
    if (!text) return { ok: false, text: '待办内容不能是空的。' };

    var s = ns('life');
    var todos = s.get('todos', []) || [];

    var dup = todos.filter(function (t) { return !t.done && t.text === text; })[0];
    if (dup) return { ok: true, text: '已经有一条一样的待办了：「' + text + '」，没有再重复加。', changed: false };

    todos.unshift({ id: uid(), text: text, due: a.due || '', done: false, t: Date.now() });
    s.set('todos', todos);
    touch('life');

    return {
      ok: true,
      text: '加好了：「' + text + '」' + (a.due ? '，截止 ' + a.due : '') + '。',
      changed: true
    };
  }

  function addExpense(a) {
    var amount = Number(a.amount);
    if (!isFinite(amount) || amount <= 0) return { ok: false, text: '金额要是一个正数。' };
    if (amount > 1000000) return { ok: false, text: '金额 ' + a.amount + ' 太大了，确认一下是不是记错了。' };

    var s = ns('life');
    var expenses = s.get('expenses', []) || [];

    var item = {
      id: uid(),
      amount: Math.round(amount * 100) / 100,
      cat: a.cat || '其他',
      date: a.date || todayStr(),
      note: a.note || '',
      t: Date.now()
    };
    expenses.unshift(item);
    s.set('expenses', expenses);
    touch('life');

    return {
      ok: true,
      text: '记好了：' + item.date + ' ' + item.cat + ' ' + money(item.amount) + ' 元' +
        (item.note ? '（' + item.note + '）' : '') + '。',
      changed: true
    };
  }

  function addPlan(a) {
    var text = String(a.text || '').trim();
    if (!text) return { ok: false, text: '行程名不能是空的。' };

    var s = ns('time');
    var plans = s.get('plans', []) || [];

    var dup = plans.filter(function (p) { return p.text === text; })[0];
    if (dup) return { ok: true, text: '已经有一个叫「' + text + '」的行程了，没有再重复加。', changed: false };

    plans.unshift({ id: uid(), text: text, from: a.from || '', to: a.to || '', steps: [], t: Date.now() });
    s.set('plans', plans);
    touch('time');

    var range = a.from || a.to ? '（' + (a.from || '?') + ' 到 ' + (a.to || '?') + '）' : '';
    return { ok: true, text: '行程加好了：「' + text + '」' + range + '。要加步骤就说一声。', changed: true };
  }

  function addPlanStep(a) {
    var planName = String(a.plan || '').trim();
    var text = String(a.text || '').trim();
    if (!planName) return { ok: false, text: '要说是哪一条行程。' };
    if (!text) return { ok: false, text: '步骤内容不能是空的。' };

    var s = ns('time');
    var plans = s.get('plans', []) || [];

    var p = plans.filter(function (x) { return x.text === planName; })[0];
    if (!p) {
      var fuzzy = plans.filter(function (x) { return String(x.text).indexOf(planName) >= 0; });
      if (fuzzy.length === 1) p = fuzzy[0];
      else if (fuzzy.length > 1) {
        return { ok: false, text: '有不止一条行程名字里有「' + planName + '」：' +
          fuzzy.map(function (x) { return x.text; }).join('、') + '。说全一点。' };
      }
    }
    if (!p) return { ok: false, text: '没找到叫「' + planName + '」的行程。' };

    if (!p.steps) p.steps = [];
    p.steps.push({ text: text, at: a.at || '', done: false });

    var withTime = [], noTime = [];
    p.steps.forEach(function (x) { if (x.at) withTime.push(x); else noTime.push(x); });
    withTime.sort(function (x, y) { return x.at.localeCompare(y.at); });
    p.steps = withTime.concat(noTime);

    s.set('plans', plans);
    touch('time');

    return {
      ok: true,
      text: '给「' + p.text + '」加了第 ' + p.steps.length + ' 步：' + (a.at ? a.at + ' ' : '') + text + '。',
      changed: true
    };
  }

  function addNote(a) {
    var text = String(a.text || '').trim();
    if (!text) return { ok: false, text: '要记的内容不能是空的。' };

    var MARKS = ['', '想法', '待办', '要查', '想买'];
    var mark = String(a.mark || '').trim();
    if (MARKS.indexOf(mark) < 0) mark = '想法';

    var now = new Date();
    var s = ns('notes');
    var notes = s.get('notes', []) || [];

    notes.unshift({
      id: uid(), text: text, mark: mark,
      date: todayStr(), time: pad(now.getHours()) + ':' + pad(now.getMinutes())
    });
    s.set('notes', notes);
    touch('notes');

    return {
      ok: true,
      text: '记到随手记了：' + (mark ? '【' + mark + '】' : '') + text + '。',
      changed: true
    };
  }

  function addCountdown(a) {
    var name = String(a.name || '').trim();
    if (!name) return { ok: false, text: '倒计时要有个名字。' };

    var date = String(a.date || '').trim();
    if (!checkDate(date)) return { ok: false, text: '日期要写成 2026-11-20 这样。' };

    var target = new Date(date + 'T00:00:00');
    var s = ns('life');
    var cds = s.get('cds', []) || [];
    var dup = cds.filter(function (c) { return c.name === name && c.date === date; })[0];
    if (dup) return { ok: true, text: '已经有一个一样的倒计时了：「' + name + '」，没有再重复加。', changed: false };

    cds.push({ id: uid(), name: name, type: 'once', date: date, day: '', t: Date.now() });
    s.set('cds', cds);
    touch('life');

    var days = Math.round((target - startOfToday()) / 86400000);
    var tail = days > 0 ? '还有 ' + days + ' 天' : days === 0 ? '就是今天' : '已经过去 ' + (-days) + ' 天';

    return { ok: true, text: '倒计时加好了：「' + name + '」' + date + '，' + tail + '。', changed: true };
  }

  /* ---------------- 课表写 ---------------- */

  function weeksArg(v) {
    if (v === undefined || v === null || v === '') return 'all';
    var s = String(v).trim().toLowerCase();
    if (s === 'all' || s === '每周') return 'all';
    if (s === 'odd' || s === '单周') return 'odd';
    if (s === 'even' || s === '双周') return 'even';
    /* "1,3,5-7" 这种写法 */
    var out = [];
    String(v).split(/[,，、\s]+/).forEach(function (part) {
      if (!part) return;
      var m = part.match(/^(\d+)\s*[-~到]\s*(\d+)$/);
      if (m) {
        for (var i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
      } else if (/^\d+$/.test(part)) {
        out.push(Number(part));
      }
    });
    out = out.filter(function (n, i, arr) { return n >= 1 && arr.indexOf(n) === i; });
    return out.length ? out : 'all';
  }

  function buildCourse(tt, a) {
    var R = rulesMod();
    var c = {
      day: Number(a.day) || 1,
      name: String(a.name || '').trim(),
      from: Number(a.from) || 1,
      to: Number(a.to) || Number(a.from) || 1,
      room: String(a.room || '').trim(),
      weeks: weeksArg(a.weeks),
      start: String(a.start || '').trim(),
      end: String(a.end || '').trim()
    };
    if (R) R.fillTimes(tt, c);
    return c;
  }

  function previewAddCourse(a) {
    var tt = timetable();
    if (!tt) return fail('课表数据没读到，先打开时间管理确认一下。');

    var R = rulesMod();
    var c = buildCourse(tt, a);
    if (R) {
      var err = R.validate(tt, c);
      if (err) return fail(err);
      var hit = R.conflict(tt, c, -1);
      if (hit) return fail('这个时间已经占着了：' + R.human(tt, hit.course) + '。要么换时间，要么先把那节删掉。');
      return plan('加一节课：' + R.human(tt, c), '在课表上加一节：' + R.human(tt, c));
    }
    return plan('加一节课：' + c.name);
  }

  function doAddCourse(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '课表数据没读到。' };
    var c = buildCourse(tt, a);
    tt.courses.push(c);
    saveTimetable(tt);
    return { ok: true, text: '加好了：' + c.name + '，周' + c.day + ' 第' + c.from + '-' + c.to + '节。', changed: true };
  }

  function previewUpdateCourse(a) {
    var tt = timetable();
    if (!tt) return fail('课表数据没读到。');
    var R = rulesMod();
    var found = findCourse(tt, a.name, a.day, a.from);
    if (found.error) return fail(found.error);

    var old = found.course;
    var next = {
      day: a.newDay ? Number(a.newDay) : old.day,
      name: String(a.newName || old.name).trim(),
      from: a.newFrom ? Number(a.newFrom) : old.from,
      to: a.newTo ? Number(a.newTo) : old.to,
      room: a.newRoom !== undefined ? String(a.newRoom).trim() : (old.room || ''),
      weeks: a.newWeeks !== undefined ? weeksArg(a.newWeeks) : old.weeks,
      start: '',
      end: ''
    };
    if (R) {
      R.fillTimes(tt, next);
      var err = R.validate(tt, next);
      if (err) return fail(err);
      var hit = R.conflict(tt, next, found.index);
      if (hit) return fail('改完会跟这节撞上：' + R.human(tt, hit.course) + '。');
      return plan('改课：' + R.human(tt, old) + ' → ' + R.human(tt, next),
        '把「' + old.name + '」从 ' + R.human(tt, old) + ' 改成 ' + R.human(tt, next));
    }
    return plan('改课：' + old.name);
  }

  function doUpdateCourse(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '课表数据没读到。' };
    var found = findCourse(tt, a.name, a.day, a.from);
    if (found.error) return { ok: false, text: found.error };

    var old = found.course;
    var next = {
      day: a.newDay ? Number(a.newDay) : old.day,
      name: String(a.newName || old.name).trim(),
      from: a.newFrom ? Number(a.newFrom) : old.from,
      to: a.newTo ? Number(a.newTo) : old.to,
      room: a.newRoom !== undefined ? String(a.newRoom).trim() : (old.room || ''),
      weeks: a.newWeeks !== undefined ? weeksArg(a.newWeeks) : old.weeks,
      start: '',
      end: ''
    };
    var R = rulesMod();
    if (R) R.fillTimes(tt, next);

    tt.courses[found.index] = next;
    saveTimetable(tt);
    return { ok: true, text: '改好了：' + next.name + ' 现在是周' + next.day + ' 第' + next.from + '-' + next.to + '节。', changed: true };
  }

  function previewRemoveCourse(a) {
    var tt = timetable();
    if (!tt) return fail('课表数据没读到。');
    var found = findCourse(tt, a.name, a.day, a.from);
    if (found.error) return fail(found.error);
    var R = rulesMod();
    var h = R ? R.human(tt, found.course) : found.course.name;
    return plan('删课：' + h, '从课表里删掉：' + h);
  }

  function doRemoveCourse(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '课表数据没读到。' };
    var found = findCourse(tt, a.name, a.day, a.from);
    if (found.error) return { ok: false, text: found.error };
    var name = found.course.name;
    tt.courses.splice(found.index, 1);
    saveTimetable(tt);
    return { ok: true, text: '删掉了：' + name + '。', changed: true };
  }

  /* 换学期或者整批导入：旧表先归档，别让过去的时间记录对不上课 */
  function archiveTimetable(old, reason) {
    var s = ns('time');
    var arr = s.get('timetableArchive', []) || [];
    arr.unshift({
      at: Date.now(),
      reason: reason || '换课表',
      term: old.term,
      courses: old.courses,
      count: (old.courses || []).length
    });
    s.set('timetableArchive', arr.slice(0, 6));
  }

  function planOfImport(a) {
    var R = rulesMod();
    var items = a.courses;
    if (!Array.isArray(items) || !items.length) return fail('没有要导入的课程。');
    if (items.length > 60) return fail('一次最多导入 60 节课。');

    var tt = timetable();
    if (!tt) return fail('课表数据没读到。');

    var bad = [];
    items.forEach(function (it, i) {
      var c = buildCourse(tt, it);
      var err = R ? R.validate(tt, c) : '';
      if (err) bad.push('第 ' + (i + 1) + ' 条：' + err);
    });
    if (bad.length) return fail('有 ' + bad.length + ' 条不对：' + bad.slice(0, 3).join('；') + (bad.length > 3 ? '…' : ''));

    if (a.replace === 'all' || a.replace === true) {
      return plan('换掉整张课表：' + items.length + ' 节课',
        '用新表替换现在的 ' + tt.courses.length + ' 节课，原来的表会存进归档（还能查）。新表共 ' + items.length + ' 节：' +
        items.slice(0, 3).map(function (it) {
          return (it.name || '?') + ' 周' + (it.day || '?') + ' 第' + (it.from || '?') + '-' + (it.to || '?') + '节';
        }).join('，') + (items.length > 3 ? '…' : ''));
    }

    return plan('往课表加 ' + items.length + ' 节课',
      '往课表里加 ' + items.length + ' 节：' + items.slice(0, 3).map(function (it) {
        return (it.name || '?') + ' 周' + (it.day || '?') + ' 第' + (it.from || '?') + '-' + (it.to || '?') + '节';
      }).join('，') + (items.length > 3 ? '…' : ''));
  }

  function doImportCourses(a) {
    var tt = timetable();
    if (!tt) return { ok: false, text: '课表数据没读到。' };

    var next = (a.courses || []).map(function (it) { return buildCourse(tt, it); });

    if (a.replace === 'all' || a.replace === true) {
      archiveTimetable(tt, a.reason || '换课表');
      tt.courses = next;
      saveTimetable(tt);
      return { ok: true, text: '课表换好了，现在有 ' + next.length + ' 节课。旧表已经存进归档。', changed: true };
    }

    next.forEach(function (c) { tt.courses.push(c); });
    saveTimetable(tt);
    return { ok: true, text: '往课表加了 ' + next.length + ' 节课。', changed: true };
  }

  /* ---------------- 时间记录写 ---------------- */

  function nowHHMM() {
    var d = new Date();
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function shiftHHMM(hhmm, deltaMin) {
    var m = minutesOf(hhmm);
    if (m === null) return hhmm;
    var v = Math.max(0, Math.min(24 * 60 - 1, m + deltaMin));
    return pad(Math.floor(v / 60)) + ':' + pad(v % 60);
  }

  /* 用户说「刷了三小时手机」时只有时长，没有起止，就按结束时间是现在倒推 */
  function resolveSpan(a) {
    var end = String(a.end || '').trim();
    var start = String(a.start || '').trim();
    var mins = Number(a.minutes);

    if (!end && !start && !(mins > 0)) {
      /* 什么都没给：按最近一小时算，别硬编 */
      return { error: '要给个时长或者起止时间，比如「练了一小时」。' };
    }

    if (!end) end = nowHHMM();
    if (!start && mins > 0) start = shiftHHMM(end, -mins);
    if (!start) return { error: '开始时间是空的。' };

    var s1 = minutesOf(start), e1 = minutesOf(end);
    if (s1 === null || e1 === null) return { error: '时间要写成 14:30 这样。' };
    if (e1 <= s1) return { error: '结束时间要晚于开始时间。' };
    if (e1 - s1 > 16 * 60) return { error: '这一条超过 16 小时了，确认一下时间对不对。' };

    return { start: start, end: end, min: e1 - s1 };
  }

  function previewAddTime(a) {
    var span = resolveSpan(a);
    if (span.error) return fail(span.error);

    var what = String(a.what || '').trim();
    if (!what) return fail('要说是做了什么，比如「练四级听力」。');

    var N = normMod();
    var cat = N ? N.fixCat(a.cat, what + ' ' + (a.what || '')) : (a.cat || '其他');

    return plan('记一条时间：' + cat + ' ' + what + ' ' + span.start + '-' + span.end + '（' + humanMins(span.min) + '）',
      '记一条时间记录：' + cat + '，' + what + '，' + span.start + ' 到 ' + span.end + '，共 ' + humanMins(span.min) + (a.date ? '，日期 ' + a.date : '，今天'));
  }

  function doAddTime(a) {
    var span = resolveSpan(a);
    if (span.error) return { ok: false, text: span.error };
    var what = String(a.what || '').trim();
    var N = normMod();
    var cat = N ? N.fixCat(a.cat, what) : (a.cat || '其他');

    var s = ns('time');
    var list = s.get('times', []) || [];
    list.unshift({
      id: uid(),
      date: a.date && checkDate(a.date) ? a.date : todayStr(),
      start: span.start,
      end: span.end,
      cat: cat,
      what: what,
      t: Date.now()
    });
    s.set('times', list);
    touch('time');

    return { ok: true, text: '记好了：' + cat + ' ' + what + ' ' + humanMins(span.min) + '。', changed: true };
  }

  function findTime(a) {
    var s = ns('time');
    var list = s.get('times', []) || [];
    var date = a.date && checkDate(a.date) ? a.date : todayStr();
    var kw = String(a.what || '').trim();

    var hits = list.filter(function (r) { return r.date === date; });
    if (kw) {
      var byWhat = hits.filter(function (r) { return String(r.what || '').indexOf(kw) >= 0; });
      if (byWhat.length) hits = byWhat;
      else hits = hits.filter(function (r) { return String(r.cat || '').indexOf(kw) >= 0; });
    }
    if (a.start) hits = hits.filter(function (r) { return String(r.start) === String(a.start); });

    if (!hits.length) return { error: date + ' 没有能对上的时间记录。' };
    if (hits.length > 1) {
      return {
        error: '对上了 ' + hits.length + ' 条：' + hits.slice(0, 4).map(function (r) {
          return r.start + '-' + r.end + ' ' + (r.cat || '') + (r.what || '');
        }).join('；') + '。说清是哪一条（带上开始时间）。'
      };
    }
    return { list: list, item: hits[0] };
  }

  function previewUpdateTime(a) {
    var f = findTime(a);
    if (f.error) return fail(f.error);
    var old = f.item;
    var next = {
      cat: a.newCat || old.cat,
      what: a.newWhat || old.what,
      start: a.newStart || old.start,
      end: a.newEnd || old.end
    };
    return plan('改时间记录：' + old.start + '-' + old.end + ' ' + (old.cat || '') + ' ' + (old.what || '') +
      ' → ' + next.start + '-' + next.end + ' ' + next.cat + ' ' + next.what,
      '把 ' + old.date + ' 这条时间记录从「' + old.start + '-' + old.end + ' ' + (old.cat || '') + ' ' + (old.what || '') +
      '」改成「' + next.start + '-' + next.end + ' ' + next.cat + ' ' + next.what + '」');
  }

  function doUpdateTime(a) {
    var f = findTime(a);
    if (f.error) return { ok: false, text: f.error };
    var old = f.item;
    if (a.newCat) old.cat = String(a.newCat).trim();
    if (a.newWhat) old.what = String(a.newWhat).trim();
    if (a.newStart) old.start = String(a.newStart).trim();
    if (a.newEnd) old.end = String(a.newEnd).trim();

    var s1 = minutesOf(old.start), e1 = minutesOf(old.end);
    if (s1 === null || e1 === null || e1 <= s1) return { ok: false, text: '改完起止时间不成立，没动。' };

    ns('time').set('times', f.list);
    touch('time');
    return { ok: true, text: '改好了：' + old.start + '-' + old.end + ' ' + old.cat + ' ' + old.what + '。', changed: true };
  }

  function previewRemoveTime(a) {
    var f = findTime(a);
    if (f.error) return fail(f.error);
    var it = f.item;
    return plan('删一条时间记录：' + it.start + '-' + it.end + ' ' + (it.cat || '') + ' ' + (it.what || ''),
      '删掉 ' + it.date + ' 这条时间记录：' + it.start + '-' + it.end + ' ' + (it.cat || '') + ' ' + (it.what || ''));
  }

  function doRemoveTime(a) {
    var f = findTime(a);
    if (f.error) return { ok: false, text: f.error };
    var left = f.list.filter(function (r) { return r !== f.item; });
    ns('time').set('times', left);
    touch('time');
    return { ok: true, text: '删掉了：' + (f.item.what || f.item.cat) + '。', changed: true };
  }

  /* ---------------- 情绪 ---------------- */

  function previewMood(a) {
    var m = Number(a.mood);
    var e = Number(a.energy);
    if (!(m >= 0 && m <= 10)) return fail('情绪要打 0 到 10 分。');
    if (!(e >= 0 && e <= 10)) return fail('精力要打 0 到 10 分。');
    var date = a.date && checkDate(a.date) ? a.date : todayStr();
    var existing = (ns('notes').get('moods', {}) || {})[date];
    return plan('记情绪和精力：' + date + ' 情绪 ' + m + '/10、精力 ' + e + '/10',
      (existing ? '把 ' + date + ' 的打分改成' : '记下 ' + date + ' 的') + ' 情绪 ' + m + '/10、精力 ' + e + '/10');
  }

  function doMood(a) {
    var date = a.date && checkDate(a.date) ? a.date : todayStr();
    var s = ns('notes');
    var moods = s.get('moods', {}) || {};
    moods[date] = { mood: Number(a.mood), energy: Number(a.energy) };
    s.set('moods', moods);
    touch('notes');
    return { ok: true, text: '记下了：' + date + ' 情绪 ' + a.mood + '/10、精力 ' + a.energy + '/10。', changed: true };
  }

  /* ---------------- 待办改 ---------------- */

  function findTodo(a) {
    var s = ns('life');
    var todos = s.get('todos', []) || [];
    var kw = String(a.text || '').trim();
    if (!kw) return { error: '要说是哪条待办。' };

    /* 先按名字找全量的，同名有多条时优先没做完的那条
     * （不然勾完之后想取消完成，会找不到它） */
    var exact = todos.filter(function (t) { return String(t.text) === kw; });
    if (exact.length === 1) return { todos: todos, item: exact[0] };
    if (exact.length > 1) {
      var openExact = exact.filter(function (t) { return !t.done; });
      return { todos: todos, item: openExact.length ? openExact[0] : exact[0] };
    }

    /* 退一步按片段找，先找没做完的，再找全部 */
    var open = todos.filter(function (t) { return !t.done; });
    var hits = open.filter(function (t) { return String(t.text).indexOf(kw) >= 0; });
    if (!hits.length) hits = todos.filter(function (t) { return String(t.text).indexOf(kw) >= 0; });

    if (!hits.length) return { error: '待办里没找到「' + kw + '」。' };
    if (hits.length > 1) {
      return { error: '有 ' + hits.length + ' 条都含「' + kw + '」：' + hits.map(function (t) { return t.text; }).join('；') + '。说具体点。' };
    }
    return { todos: todos, item: hits[0] };
  }

  function previewDoneTodo(a) {
    var f = findTodo(a);
    if (f.error) return fail(f.error);
    var want = a.done === false || a.done === 'false' ? false : true;
    if (!!f.item.done === want) {
      return plan((want ? '这条已经是完成状态了' : '这条本来就没打勾') + '：' + f.item.text, null);
    }
    return plan((want ? '勾完成：' : '取消完成：') + f.item.text,
      (want ? '把待办「' : '把待办「') + f.item.text + (want ? '」标成做完' : '」改回没做'));
  }

  function doDoneTodo(a) {
    var f = findTodo(a);
    if (f.error) return { ok: false, text: f.error };
    var want = a.done === false || a.done === 'false' ? false : true;
    f.item.done = want;
    ns('life').set('todos', f.todos);
    touch('life');
    return { ok: true, text: (want ? '勾上了：' : '取消完成：') + f.item.text + '。', changed: true };
  }

  function previewRemoveTodo(a) {
    var f = findTodo(a);
    if (f.error) return fail(f.error);
    return plan('删待办：' + f.item.text, '把待办「' + f.item.text + '」删掉');
  }

  function doRemoveTodo(a) {
    var f = findTodo(a);
    if (f.error) return { ok: false, text: f.error };
    var text = f.item.text;
    var left = f.todos.filter(function (t) { return t !== f.item; });
    ns('life').set('todos', left);
    touch('life');
    return { ok: true, text: '删掉了：「' + text + '」', changed: true };
  }

  function previewUpdateTodo(a) {
    var f = findTodo(a);
    if (f.error) return fail(f.error);
    var bits = [];
    if (a.newText) bits.push('内容改成「' + a.newText + '」');
    if (a.due !== undefined) bits.push(a.due ? '截止改成 ' + a.due : '去掉截止日期');
    if (!bits.length) return fail('没说改什么。');
    return plan('改待办：' + f.item.text + ' → ' + bits.join('，'), '把待办「' + f.item.text + '」' + bits.join('，'));
  }

  function doUpdateTodo(a) {
    var f = findTodo(a);
    if (f.error) return { ok: false, text: f.error };
    if (a.newText) f.item.text = String(a.newText).trim();
    if (a.due !== undefined) f.item.due = String(a.due || '').trim();
    ns('life').set('todos', f.todos);
    touch('life');
    return { ok: true, text: '改好了：「' + f.item.text + '」。', changed: true };
  }

  /* ---------------- 行程步骤 ---------------- */

  function findPlan(a) {
    var s = ns('time');
    var plans = s.get('plans', []) || [];
    var kw = String(a.plan || '').trim();
    if (!kw) return { error: '要说是哪条行程。' };

    var hits = plans.filter(function (p) { return String(p.text) === kw; });
    if (!hits.length) hits = plans.filter(function (p) { return String(p.text).indexOf(kw) >= 0; });
    if (!hits.length) return { error: '没找到叫「' + kw + '」的行程。' };
    if (hits.length > 1) {
      return { error: '有 ' + hits.length + ' 条行程名字里有「' + kw + '」：' + hits.map(function (p) { return p.text; }).join('、') + '。' };
    }
    return { plans: plans, plan: hits[0] };
  }

  function findStep(p, kw) {
    var steps = p.steps || [];
    var k = String(kw || '').trim();
    if (!k) return { error: '要说是哪一步。' };
    var hits = steps.filter(function (x) { return String(x.text) === k; });
    if (!hits.length) hits = steps.filter(function (x) { return String(x.text).indexOf(k) >= 0; });
    if (!hits.length) {
      return { error: '「' + p.text + '」里没找到「' + k + '」这一步。现在有：' + steps.map(function (x) { return x.text; }).join('、') };
    }
    if (hits.length > 1) return { error: '有 ' + hits.length + ' 步都含「' + k + '」，说具体点。' };
    return { step: hits[0] };
  }

  function previewStepDone(a) {
    var f = findPlan(a);
    if (f.error) return fail(f.error);
    var s = findStep(f.plan, a.step);
    if (s.error) return fail(s.error);
    var want = a.done === false || a.done === 'false' ? false : true;
    return plan((want ? '勾完成：' : '取消完成：') + f.plan.text + ' / ' + s.step.text,
      (want ? '把「' + f.plan.text + '」里的「' : '把「' + f.plan.text + '」里的「') + s.step.text + (want ? '」标成做完' : '」改回没做'));
  }

  function doStepDone(a) {
    var f = findPlan(a);
    if (f.error) return { ok: false, text: f.error };
    var s = findStep(f.plan, a.step);
    if (s.error) return { ok: false, text: s.error };
    var want = a.done === false || a.done === 'false' ? false : true;
    s.step.done = want;
    ns('time').set('plans', f.plans);
    touch('time');
    return { ok: true, text: (want ? '勾上了：' : '取消完成：') + s.step.text + '。', changed: true };
  }

  function previewPlanDone(a) {
    var f = findPlan(a);
    if (f.error) return fail(f.error);
    var n = (f.plan.steps || []).length;
    return plan('整个行程标完成：' + f.plan.text + '（' + n + ' 步）',
      '把行程「' + f.plan.text + '」的 ' + n + ' 个步骤全部标成完成');
  }

  function doPlanDone(a) {
    var f = findPlan(a);
    if (f.error) return { ok: false, text: f.error };
    (f.plan.steps || []).forEach(function (x) { x.done = true; });
    ns('time').set('plans', f.plans);
    touch('time');
    return { ok: true, text: '「' + f.plan.text + '」全部步骤都标完成了。', changed: true };
  }

  /* ---------------- 挑战结果 ---------------- */

  function previewChallenge(a) {
    var s = ns('challenge');
    var cur = s.get('current', null);
    var recs = s.get('records', []) || [];
    var target = cur && !cur.result ? cur : null;

    if (!target) {
      var latest = recs[0];
      if (!latest) return fail('还没抽过挑战，先抽一个再标结果。');
      if (latest.result) return fail('最近这个挑战已经标过结果了。想再抽一个就去挑战页抽。');
      target = latest;
    }

    var want = a.result === 'skip' || a.result === '放弃' ? 'skip' : 'done';
    return plan((want === 'done' ? '标已完成：' : '标放弃：') + String(target.text || '').slice(0, 30),
      '把最近抽到的挑战「' + String(target.text || '').slice(0, 40) + '」标成' + (want === 'done' ? '完成' : '放弃'));
  }

  function doChallenge(a) {
    var s = ns('challenge');
    var want = a.result === 'skip' || a.result === '放弃' ? 'skip' : 'done';
    var cur = s.get('current', null);
    var recs = s.get('records', []) || [];
    var stamp = nowHHMM();

    if (cur && !cur.result) {
      cur.result = want;
      cur.doneAt = stamp;
      recs.unshift(cur);
      s.set('records', recs);
      s.remove('current');
      touch('challenge');
      return { ok: true, text: '标好了：' + (want === 'done' ? '完成' : '放弃') + '。', changed: true };
    }

    var latest = recs[0];
    if (latest && !latest.result) {
      latest.result = want;
      latest.doneAt = stamp;
      s.set('records', recs);
      touch('challenge');
      return { ok: true, text: '标好了：' + (want === 'done' ? '完成' : '放弃') + '。', changed: true };
    }

    return { ok: false, text: '找不到可以标结果的挑战。' };
  }

  /* ---------------- 记忆 ---------------- */

  function previewRemember(a) {
    var M = memMod();
    if (!M) return fail('记忆模块没加载起来。');
    var text = String(a.text || '').trim();
    if (!text) return fail('要记的内容是空的。');
    return plan('记住：' + text, '把「' + text + '」记进长期记忆');
  }

  function doRemember(a) {
    var M = memMod();
    if (!M) return { ok: false, text: '记忆模块没加载起来。' };
    var r = M.add(a.text, a.tag);
    return { ok: r.ok, text: r.text, changed: !!r.changed };
  }

  function previewForget(a) {
    var M = memMod();
    if (!M) return fail('记忆模块没加载起来。');
    var kw = String(a.text || '').trim();
    if (!kw) return fail('要忘了哪一条？说个关键词。');
    var hit = M.search(kw);
    if (!hit.length) return fail('没找到含「' + kw + '」的记忆。');
    if (hit.length > 1) return fail('有 ' + hit.length + ' 条都含「' + kw + '」，说具体点：' + hit.map(function (m) { return m.text; }).join('；'));
    return plan('忘掉：' + hit[0].text, '把「' + hit[0].text + '」从长期记忆里删掉');
  }

  function doForget(a) {
    var M = memMod();
    if (!M) return { ok: false, text: '记忆模块没加载起来。' };
    var r = M.remove(a.text);
    return { ok: r.ok, text: r.text, changed: !!r.changed };
  }

  /* ---------------- 批量导入 ---------------- */

  function previewImport(a) {
    var kind = String(a.kind || '').trim();
    var items = a.items;

    if (!Array.isArray(items) || !items.length) return fail('没有要导入的内容。');
    if (items.length > 200) return fail('一次最多 200 条。');

    if (kind === 'expenses') {
      var bad = [];
      var sum = 0;
      items.forEach(function (it, i) {
        var v = Number(it && it.amount);
        if (!isFinite(v) || v <= 0) bad.push('第 ' + (i + 1) + ' 条金额不对');
        else sum += v;
      });
      if (bad.length) return fail(bad.slice(0, 3).join('；') + '。');
      return plan('导入 ' + items.length + ' 笔账，合计 ' + money(sum) + ' 元',
        '从粘贴的内容里拆出 ' + items.length + ' 笔账，合计 ' + money(sum) + ' 元，前几笔：' +
        items.slice(0, 3).map(function (it) {
          return (it.date || '今天') + ' ' + (it.cat || '其他') + ' ' + money(it.amount) + ' 元';
        }).join('；'));
    }

    if (kind === 'courses') {
      return planOfImport({ courses: items, replace: a.replace });
    }

    return fail('只支持把文字转成账目（expenses）或课表（courses）。');
  }

  function doImport(a) {
    var kind = String(a.kind || '').trim();
    var items = a.items || [];

    if (kind === 'expenses') {
      var s = ns('life');
      var exps = s.get('expenses', []) || [];
      var n = 0;
      items.forEach(function (it) {
        var v = Number(it.amount);
        if (!isFinite(v) || v <= 0) return;
        exps.unshift({
          id: uid(),
          amount: Math.round(v * 100) / 100,
          cat: String(it.cat || '其他').trim() || '其他',
          date: it.date && checkDate(it.date) ? it.date : todayStr(),
          note: String(it.note || '').trim(),
          t: Date.now()
        });
        n++;
      });
      s.set('expenses', exps);
      touch('life');
      return { ok: true, text: '导入了 ' + n + ' 笔账。', changed: n > 0 };
    }

    if (kind === 'courses') {
      return doImportCourses({ courses: items, replace: a.replace, reason: a.reason });
    }

    return { ok: false, text: '不认识的类型：' + kind };
  }

  /* ---------------- 撤销 ---------------- */

  function doUndo() {
    var U = undoMod();
    if (!U) return { ok: false, text: '撤销模块没加载起来。' };
    var r = U.undo();
    return { ok: r.ok, text: r.text, changed: r.ok, undo: true };
  }

  /* ---------------- 工具清单 ---------------- */

  var DEFS = [
    /* --- 今天 / 概况 --- */
    {
      name: 'query_today', group: '今天', desc: '今天怎么样：第几周、几节课、待办、最近的倒计时、今天专注几个番茄、记了多少时间。',
      params: {}, run: function () { return queryTodayMsg(); }
    },
    {
      name: 'web_search', group: '搜索',
      desc: '联网搜一下。考试时间、政策、新闻、比分、价格、活动日期这类你现在不知道、或者会过时的信息，先用它查，再根据结果回答或建倒计时。',
      params: {
        q: '搜索词。像人一样写，短一点更准，比如「四级笔试时间 2026年12月」',
        n: '要几条结果，默认 6'
      },
      run: function (a) { return webSearch(a); }
    },
    {
      name: 'query_timetable', group: '课表', desc: '查课表。今天、明天、本周整周，或者某个具体日期。',
      params: {
        scope: 'today（今天，默认）、tomorrow（明天）、week（本周一到周日）',
        date: '具体某一天，格式 2026-11-03。填了就以这一天为准'
      },
      run: function (a) { return queryTimetable(a); }
    },
    {
      name: 'query_free_time', group: '课表', desc: '查空档：哪几节没课。用来回答「周三下午有课吗」「这周哪天最闲」。',
      params: {
        scope: 'today（今天，默认）、week（本周一到周五）',
        date: '具体某一天，格式 2026-11-03'
      },
      run: function (a) { return queryFreeTime(a); }
    },
    {
      name: 'add_course', group: '课表', write: true, targets: ['time'],
      desc: '往课表加一节课。时间跟已有的课撞上会被拦住。',
      params: {
        name: '课程名，必填', day: '星期几，1 是周一，7 是周日',
        from: '从第几节开始', to: '到第几节结束',
        room: '教室，可以不填', weeks: '周次：all 每周（默认）、odd 单周、even 双周，或者 "1,3,5-7"'
      },
      preview: previewAddCourse, run: function (a) { return doAddCourse(a); }
    },
    {
      name: 'update_course', group: '课表', write: true, targets: ['time'],
      desc: '改一节已有的课，比如换时间、换教室、改周次。用 name 定位，加上 day 或 from 更准。',
      params: {
        name: '要改哪门课，必填', day: '用来定位的星期几', from: '用来定位的第几节',
        newDay: '改成星期几', newFrom: '改成第几节开始', newTo: '改成第几节结束',
        newRoom: '改成哪个教室', newName: '改成什么课名', newWeeks: '改成什么周次'
      },
      preview: previewUpdateCourse, run: function (a) { return doUpdateCourse(a); }
    },
    {
      name: 'remove_course', group: '课表', write: true, targets: ['time'],
      desc: '从课表删掉一节课。用 name 定位，同名多节时加 day 或 from。',
      params: { name: '要删哪门课，必填', day: '用来定位的星期几', from: '用来定位的第几节' },
      preview: previewRemoveCourse, run: function (a) { return doRemoveCourse(a); }
    },
    {
      name: 'import_courses', group: '课表', write: true, targets: ['time'],
      desc: '批量加课或整张换课表。用户粘贴一段课表文字、或者要换学期时用这个。',
      params: {
        courses: '课程数组，每项 {name, day, from, to, room, weeks}',
        replace: '填 "all" 表示整张替换（旧的会归档），不填就是追加'
      },
      preview: function (a) { return planOfImport({ courses: a.courses, replace: a.replace }); },
      run: function (a) { return doImportCourses(a); }
    },

    /* --- 时间 --- */
    {
      name: 'query_time_records', group: '时间', desc: '查时间记录，看时间花在哪儿了。',
      params: {
        scope: 'today（今天，默认）、week（最近七天）、month（本月）、all（全部）',
        date: '具体某一天，格式 2026-10-26',
        cat: '类别，比如 学习、休息、刷手机'
      },
      run: function (a) { return queryTimeRecords(a); }
    },
    {
      name: 'add_time_record', group: '时间', write: true, targets: ['time'],
      desc: '记一条时间记录。用户说「我今天刷了三小时手机」时，传 minutes 就行，起止时间会自动倒推。',
      params: {
        what: '做了什么，必填', cat: '类别（上课/作业/自学/社团/通勤/运动/社交/刷手机/娱乐/休息），不填会自动猜',
        start: '开始时间 14:30', end: '结束时间 16:00', minutes: '时长（分钟），没有起止时间时用这个',
        date: '日期 2026-10-28，不填就是今天'
      },
      preview: previewAddTime, run: function (a) { return doAddTime(a); }
    },
    {
      name: 'update_time_record', group: '时间', write: true, targets: ['time'],
      desc: '改一条已有的时间记录。用 what 关键词加日期定位。',
      params: {
        what: '靠什么词找这条记录', date: '哪一天，默认今天', start: '这一条的开始时间，定位更准',
        newCat: '改成什么类别', newWhat: '改成什么活动', newStart: '改成几点开始', newEnd: '改成几点结束'
      },
      preview: previewUpdateTime, run: function (a) { return doUpdateTime(a); }
    },
    {
      name: 'remove_time_record', group: '时间', write: true, targets: ['time'],
      desc: '删一条时间记录。',
      params: { what: '靠什么词找', date: '哪一天，默认今天', start: '开始时间，定位更准' },
      preview: previewRemoveTime, run: function (a) { return doRemoveTime(a); }
    },
    {
      name: 'query_focus', group: '时间', desc: '查番茄钟：今天专注几个、共多久、连着几天。',
      params: { scope: 'today（今天，默认）、week（最近七天）' },
      run: function (a) { return queryFocus(a); }
    },
    {
      name: 'query_cet4', group: '英语',
      desc: '四级陪练。把该背的词端出来，你照着一个个考我；答错说错在哪。查不到词就说没有，别自己编词库。',
      params: {
        scope: 'due（到期的，默认）、weak（老练不熟的）、notebook（生词本里的）',
        count: '这次练几个，默认 8，最多 20'
      },
      run: function (a) { return queryCet4(a); }
    },
    {
      name: 'query_weekly_review', group: '复盘',
      desc: '周复盘。把这一周的时间、番茄、花销、待办、挑战、情绪、背词摊成一段数据，照着写复盘。',
      params: { weeks_ago: '0 是本周（默认），1 是上周，最多往回八周' },
      run: function (a) { return queryWeeklyReview(a); }
    },
    {
      name: 'query_plans', group: '行程', desc: '查行程规划，包括每一步做到哪了。',
      params: { name: '行程名的一部分，不填就列出没走完的' },
      run: function (a) { return queryPlans(a); }
    },
    {
      name: 'add_plan', group: '行程', write: true, targets: ['time'], desc: '加一条行程规划。',
      params: {
        text: '行程名，比如 杭州两日游，必填',
        from: '开始日期 2026-11-01，可以不填', to: '结束日期 2026-11-02，可以不填'
      },
      preview: function (a) {
        var t = String(a.text || '').trim();
        if (!t) return fail('行程名不能是空的。');
        return plan('加行程：' + t, '加一条行程规划「' + t + '」' + (a.from || a.to ? '（' + (a.from || '?') + ' 到 ' + (a.to || '?') + '）' : ''));
      },
      run: function (a) { return addPlan(a); }
    },
    {
      name: 'add_plan_step', group: '行程', write: true, targets: ['time'], desc: '给已有的行程加一个步骤。',
      params: {
        plan: '行程名，可以是名字的一部分，必填', text: '这一步做什么，必填', at: '几点做，格式 08:30'
      },
      preview: function (a) {
        var f = findPlan(a);
        if (f.error) return fail(f.error);
        if (!String(a.text || '').trim()) return fail('步骤内容不能是空的。');
        return plan('给「' + f.plan.text + '」加一步：' + a.text, '给行程「' + f.plan.text + '」加一步：' + (a.at ? a.at + ' ' : '') + a.text);
      },
      run: function (a) { return addPlanStep(a); }
    },
    {
      name: 'step_done', group: '行程', write: true, targets: ['time'],
      desc: '勾掉行程里的某一步，或者取消勾选。',
      params: { plan: '行程名，必填', step: '哪一步，必填', done: '不填是勾完成，填 false 是取消' },
      preview: previewStepDone, run: function (a) { return doStepDone(a); }
    },
    {
      name: 'plan_done', group: '行程', write: true, targets: ['time'],
      desc: '把整条行程的所有步骤标成完成。',
      params: { plan: '行程名，必填' },
      preview: previewPlanDone, run: function (a) { return doPlanDone(a); }
    },

    /* --- 生活 --- */
    {
      name: 'query_expenses', group: '花销', desc: '查花销。按月份、按类别、按某一天。',
      params: {
        scope: 'today（今天）、month（本月，默认）、lastMonth（上个月）、all（全部）',
        cat: '类别，比如 吃饭、交通', date: '具体某一天 2026-10-26'
      },
      run: function (a) { return queryExpenses(a); }
    },
    {
      name: 'add_expense', group: '花销', write: true, targets: ['life'], desc: '记一笔花销。',
      params: {
        amount: '金额，正数，必填', cat: '类别，比如 吃饭、交通、买菜。不填算其他',
        date: '日期 2026-10-26，不填算今天', note: '备注'
      },
      preview: function (a) {
        var v = Number(a.amount);
        if (!isFinite(v) || v <= 0) return fail('金额要是一个正数。');
        if (v > 1000000) return fail('金额 ' + a.amount + ' 太大了，确认一下。');
        var d = a.date && checkDate(a.date) ? a.date : todayStr();
        return plan('记一笔：' + (a.cat || '其他') + ' ' + money(v) + ' 元', '记一笔花销：' + d + ' ' + (a.cat || '其他') + ' ' + money(v) + ' 元' + (a.note ? '（' + a.note + '）' : ''));
      },
      run: function (a) { return addExpense(a); }
    },
    {
      name: 'query_todos', group: '待办', desc: '查待办。可以只看没做完的，也可以看全部。',
      params: { which: 'open（没做完的，默认）、done（做完的）、all（全部）' },
      run: function (a) { return queryTodos(a); }
    },
    {
      name: 'add_todo', group: '待办', write: true, targets: ['life'], desc: '加一条待办。',
      params: { text: '待办内容，必填', due: '截止日期 2026-10-30' },
      preview: function (a) {
        var t = String(a.text || '').trim();
        if (!t) return fail('待办内容不能是空的。');
        return plan('加待办：' + t, '加一条待办「' + t + '」' + (a.due ? '，截止 ' + a.due : ''));
      },
      run: function (a) { return addTodo(a); }
    },
    {
      name: 'done_todo', group: '待办', write: true, targets: ['life'], desc: '把待办勾成做完，或者取消完成。',
      params: { text: '待办内容，必填', done: '不填是勾完成，填 false 是取消' },
      preview: previewDoneTodo, run: function (a) { return doDoneTodo(a); }
    },
    {
      name: 'remove_todo', group: '待办', write: true, targets: ['life'], desc: '删掉一条待办。',
      params: { text: '待办内容，必填' },
      preview: previewRemoveTodo, run: function (a) { return doRemoveTodo(a); }
    },
    {
      name: 'update_todo', group: '待办', write: true, targets: ['life'], desc: '改待办的内容或截止日期。',
      params: { text: '要改哪条，必填', newText: '改成什么内容', due: '新的截止日期，填空字符串表示去掉' },
      preview: previewUpdateTodo, run: function (a) { return doUpdateTodo(a); }
    },
    {
      name: 'query_countdowns', group: '倒计时', desc: '查倒计时，看在等着的事还有几天。',
      params: {}, run: function () { return queryCountdowns(); }
    },
    {
      name: 'add_countdown', group: '倒计时', write: true, targets: ['life'], desc: '加一个倒计时。',
      params: { name: '叫什么，比如 交论文，必填', date: '目标日期 2026-11-20，必填' },
      preview: function (a) {
        var n = String(a.name || '').trim();
        if (!n) return fail('倒计时要有个名字。');
        if (!checkDate(a.date)) return fail('日期要写成 2026-11-20 这样。');
        return plan('加倒计时：' + n + ' · ' + a.date, '加一个倒计时「' + n + '」，目标 ' + a.date);
      },
      run: function (a) { return addCountdown(a); }
    },

    /* --- 随手记 / 情绪 --- */
    {
      name: 'query_notes', group: '随手记', desc: '查随手记的灵感条目，以及每天的情绪精力打分。',
      params: { keyword: '按关键词找', date: '只看某一天 2026-10-26', limit: '最多几条，默认 5' },
      run: function (a) { return queryNotes(a); }
    },
    {
      name: 'add_note', group: '随手记', write: true, targets: ['notes'], desc: '把一句话记进随手记。',
      params: { text: '要记的内容，必填', mark: '想法、待办、要查、想买' },
      preview: function (a) {
        var t = String(a.text || '').trim();
        if (!t) return fail('要记的内容不能是空的。');
        return plan('记灵感：' + t.slice(0, 30), '记进随手记：' + (a.mark ? '【' + a.mark + '】' : '') + t);
      },
      run: function (a) { return addNote(a); }
    },
    {
      name: 'set_mood', group: '随手记', write: true, targets: ['notes'],
      desc: '记某天的情绪和精力打分（0 到 10 分）。用户说「今天挺累，精力 5 分」就用这个。',
      params: { mood: '情绪 0-10，必填', energy: '精力 0-10，必填', date: '哪一天，默认今天' },
      preview: previewMood, run: function (a) { return doMood(a); }
    },

    /* --- 挑战 --- */
    {
      name: 'query_challenges', group: '挑战', desc: '查随机挑战抽过哪些、完成几次。',
      params: { scope: 'today（今天）、week（最近七天）、all（全部，默认）' },
      run: function (a) { return queryChallenges(a); }
    },
    {
      name: 'record_challenge', group: '挑战', write: true, targets: ['challenge'],
      desc: '把最近抽到的挑战标成完成或放弃。',
      params: { result: 'done（完成）或 skip（放弃）' },
      preview: previewChallenge, run: function (a) { return doChallenge(a); }
    },

    /* --- 记忆 --- */
    {
      name: 'remember', group: '记忆', write: true, targets: ['__workbench'],
      desc: '把关于我的一件事记进长期记忆。用户说「记一下我讨厌背单词」「以后提醒我」时用。',
      params: { text: '要记住的事，必填', tag: '分类，比如 偏好、计划' },
      preview: previewRemember, run: function (a) { return doRemember(a); }
    },
    {
      name: 'forget', group: '记忆', write: true, targets: ['__workbench'],
      desc: '从长期记忆里删掉一条。',
      params: { text: '靠什么关键词找，必填' },
      preview: previewForget, run: function (a) { return doForget(a); }
    },
    {
      name: 'query_memory', group: '记忆', desc: '看看自己记了关于我的什么事。',
      params: { keyword: '按关键词找，不填就列最近的' },
      run: function (a) { return queryMemory(a); }
    },

    /* --- 批量导入 --- */
    {
      name: 'import_data', group: '导入', write: true, targets: ['life', 'time'],
      desc: '把一整段文字拆成账目或课表之后批量写进来。用户粘贴一段流水、一段课表时用。',
      params: {
        kind: 'expenses（账目）或 courses（课表）',
        items: '数组。账目每项 {amount, cat, date, note}；课表每项 {name, day, from, to, room, weeks}',
        replace: 'kind 是 courses 时填 "all" 表示整张替换'
      },
      preview: previewImport, run: function (a) { return doImport(a); }
    },

    /* --- 系统 --- */
    {
      name: 'undo_last', group: '系统',
      desc: '撤销上一次改动。用户说「刚才那个撤销」「退回上一步」时用。',
      params: {}, run: function () { return doUndo(); }
    }
  ];

  /* ---------------- 执行 ---------------- */

  function byName(name) {
    for (var i = 0; i < DEFS.length; i++) {
      if (DEFS[i].name === name) return DEFS[i];
    }
    return null;
  }

  /* 真正落地：先起快照，跑，成功才把快照压栈 */
  function execWrite(def, args) {
    var p = def.preview ? def.preview(args) : null;
    if (p && p.error) return { ok: false, text: p.error };
    if (!p) p = { label: def.name, detail: def.name };

    var U = undoMod();
    var snap = (U && def.targets) ? U.begin(p.label, def.targets) : null;

    var r;
    try {
      r = def.run(args || {});
    } catch (e) {
      /* 写了一半出错：直接退回去，别留半截数据 */
      if (snap && U) {
        (snap.targets || []).forEach(function (t) {
          if (t.empty) return;
          var nsObj = store.namespace(t.ns);
          nsObj.clear();
          nsObj.load(t.data || {});
        });
      }
      return { ok: false, text: '执行出错，已经退回原样：' + String((e && e.message) || e) };
    }

    if (!r) return { ok: false, text: '工具没有返回结果。' };
    if (r.ok && r.changed !== false && snap && U) U.commit(snap);

    /* 描述文字用预览那句更具体，执行结果只补状态 */
    if (r.ok && p.detail) r.plan = p.detail;
    return r;
  }

  /**
   * 执行一次工具调用
   * @param name 工具名
   * @param args 参数
   * @param opts {confirmed:true} 表示用户已经在确认条上点了同意
   * @returns {ok, text, changed, pending, plan, tool, args}
   */
  function run(name, args, opts) {
    var def = byName(name);
    if (!def) return { ok: false, text: '没有这个工具：' + name };

    var a = args || {};
    var confirmed = !!(opts && opts.confirmed);

    try {
      if (def.write && !confirmed) {
        var p = def.preview ? def.preview(a) : null;
        if (p && p.error) return { ok: false, text: p.error };
        if (!p) p = { label: def.name, detail: def.name };
        return {
          ok: true,
          pending: true,
          tool: def.name,
          args: a,
          plan: p.label,
          text: p.detail || p.label
        };
      }

      var r = def.write ? execWrite(def, a) : def.run(a);

      /* 工具可以返回 Promise（联网搜索就得等网络）。
       * 统一在出口处把它收成同样的形状，调用方按 thenable 判断就行。 */
      if (r && typeof r.then === 'function') {
        return r.then(function (x) {
          if (!x || typeof x.text !== 'string') return { ok: false, text: '工具没有返回结果。' };
          return x;
        }, function (e) {
          return { ok: false, text: '执行出错：' + String((e && e.message) || e) };
        });
      }

      if (!r || typeof r.text !== 'string') return { ok: false, text: '工具没有返回结果。' };
      return r;
    } catch (e) {
      return { ok: false, text: '执行出错：' + String((e && e.message) || e) };
    }
  }

  /* ---------------- 给模型看的说明 ---------------- */

  var GROUP_ORDER = ['今天', '搜索', '课表', '时间', '待办', '花销', '行程', '倒计时', '随手记', '挑战', '英语', '复盘', '记忆', '导入', '系统'];

  function promptText() {
    var byGroup = {};
    DEFS.forEach(function (d) {
      var g = d.group || '其他';
      (byGroup[g] = byGroup[g] || []).push(d);
    });

    var groups = Object.keys(byGroup).sort(function (x, y) {
      var ix = GROUP_ORDER.indexOf(x), iy = GROUP_ORDER.indexOf(y);
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy);
    });

    return groups.map(function (g) {
      var lines = byGroup[g].map(function (d) {
        var ps = Object.keys(d.params || {}).map(function (k) {
          return '      ' + k + '：' + d.params[k];
        });
        var mark = d.write ? '（会改数据）' : '（只读）';
        return '  - ' + d.name + mark + ' ' + d.desc + (ps.length ? '\n' + ps.join('\n') : '');
      });
      return '【' + g + '】\n' + lines.join('\n');
    }).join('\n\n');
  }

  function catalog() {
    return DEFS.map(function (d) {
      return { name: d.name, group: d.group, write: !!d.write, desc: d.desc };
    });
  }

  return {
    DEFS: DEFS,
    run: run,
    byName: byName,
    promptText: promptText,
    catalog: catalog,
    nextDate: nextDate,
    todayData: todayData,
    timetable: timetable
  };
})();
