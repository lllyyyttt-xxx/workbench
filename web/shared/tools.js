/* 工作台工具层
 * 让 AI 能查数据、也能真正动手加东西，而不是只能说话。
 * 每个工具三部分：给 AI 看的说明、参数检查、真正执行的代码。
 * 只做查询和添加，删除和修改一律不给。
 */
window.WorkbenchTools = (function () {
  'use strict';

  var store = window.WorkbenchStore;

  /* 工具清单：这份也是给 AI 看的说明书 */
  var DEFS = [
    {
      name: 'query_expenses',
      desc: '查花销。可以按月份、按类别、按某一天查。不给日期就查本月。',
      params: {
        scope: '查询范围：today（今天）、month（本月）、lastMonth（上个月）、all（全部）。不填默认本月',
        cat: '类别名，比如 吃饭、交通。不填就是全部类别',
        date: '具体某一天，格式 2026-10-26。填了就以这一天为准'
      },
      run: function (a) { return queryExpenses(a); }
    },
    {
      name: 'query_todos',
      desc: '查待办。可以只看没做完的，也可以看全部。',
      params: {
        which: 'open（没做完的，默认）、done（做完的）、all（全部）'
      },
      run: function (a) { return queryTodos(a); }
    },
    {
      name: 'query_plans',
      desc: '查行程规划，包括每一步做到哪了。',
      params: {
        name: '行程名的一部分，用来找某一条。不填就列出全部没走完的'
      },
      run: function (a) { return queryPlans(a); }
    },
    {
      name: 'query_countdowns',
      desc: '查倒计时，看在等着的事还有几天。',
      params: {},
      run: function () { return queryCountdowns(); }
    },
    {
      name: 'add_todo',
      desc: '加一条待办。',
      params: {
        text: '待办内容，必填',
        due: '截止日期，格式 2026-10-30。可以不填'
      },
      run: function (a) { return addTodo(a); }
    },
    {
      name: 'add_expense',
      desc: '记一笔花销。',
      params: {
        amount: '金额，数字，必填',
        cat: '类别，比如 吃饭、交通、买菜。不填算作 其他',
        date: '日期，格式 2026-10-26。不填算今天',
        note: '备注，可以不填'
      },
      run: function (a) { return addExpense(a); }
    },
    {
      name: 'add_plan',
      desc: '加一条行程规划。',
      params: {
        text: '行程名，比如 杭州两日游，必填',
        from: '开始日期 2026-11-01，可以不填',
        to: '结束日期 2026-11-02，可以不填'
      },
      run: function (a) { return addPlan(a); }
    },
    {
      name: 'add_plan_step',
      desc: '给已有的行程加一个步骤。行程不存在会报错。',
      params: {
        plan: '行程名，可以是名字的一部分，必填',
        text: '这一步做什么，必填',
        at: '几点做，格式 08:30，可以不填'
      },
      run: function (a) { return addPlanStep(a); }
    },
    {
      name: 'query_timetable',
      desc: '查课表。可以查今天、明天、本周整周，也可以查某一天。',
      params: {
        scope: 'today（今天，默认）、tomorrow（明天）、week（本周一到周日）',
        date: '具体某一天，格式 2026-11-03。填了就以这一天为准，scope 失效'
      },
      run: function (a) { return queryTimetable(a); }
    },
    {
      name: 'query_time_records',
      desc: '查时间记录，看时间都花在哪儿了，能按天、按周、按类别。',
      params: {
        scope: 'today（今天，默认）、week（最近七天）、month（本月）、all（全部）',
        date: '具体某一天，格式 2026-10-26',
        cat: '类别名，比如 学习、休息。不填就是全部类别'
      },
      run: function (a) { return queryTimeRecords(a); }
    },
    {
      name: 'query_notes',
      desc: '查随手记里的灵感条目，以及每天记的情绪和精力打分。',
      params: {
        keyword: '按关键词找某一条，不填就列最近的',
        date: '只看某一天，格式 2026-10-26',
        limit: '最多列几条，默认 5，最多 20'
      },
      run: function (a) { return queryNotes(a); }
    },
    {
      name: 'query_challenges',
      desc: '查随机挑战抽过哪些、完成几次、放弃几次。',
      params: {
        scope: 'today（今天）、week（最近七天）、all（全部，默认）'
      },
      run: function (a) { return queryChallenges(a); }
    },
    {
      name: 'add_note',
      desc: '把一句话记进随手记的灵感收件箱。',
      params: {
        text: '要记的内容，必填',
        mark: '分类，可以是 想法、待办、要查、想买。不填就是不分'
      },
      run: function (a) { return addNote(a); }
    },
    {
      name: 'add_countdown',
      desc: '加一个倒计时，用来数还有几天到某件事。',
      params: {
        name: '倒计时叫什么，比如 交论文，必填',
        date: '目标日期，格式 2026-11-20，必填'
      },
      run: function (a) { return addCountdown(a); }
    }
  ];

  /* ---------------- 公用 ---------------- */

  function ns(id) { return store.namespace(id); }

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function monthStr(offset) {
    var d = new Date();
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

  /* 加完数据要让对应模块知道，下次打开能读到新数据 */
  function touch(moduleId) {
    try {
      window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: moduleId } }));
    } catch (e) { /* 老浏览器没有 CustomEvent 就算了 */ }
  }

  /* ---------------- 查询 ---------------- */

  function queryExpenses(a) {
    var s = ns('life');
    var exps = s.get('expenses', []) || [];
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

    if (a.cat) {
      list = list.filter(function (e) { return e.cat === a.cat; });
    }

    if (!list.length) {
      return { ok: true, text: '这段时间没有符合条件的记录。' };
    }

    var sum = list.reduce(function (x, e) { return x + Number(e.amount || 0); }, 0);

    /* 按类别汇总，方便直接说哪儿花得多 */
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

    /* 给最近几笔，方便对照 */
    var recent = list.slice().sort(function (x, y) {
      return String(y.date).localeCompare(String(x.date));
    }).slice(0, 5);
    txt += '最近几笔：' + recent.map(function (e) {
      return e.date + ' ' + (e.cat || '其他') + ' ' + money(e.amount) + ' 元' + (e.note ? '（' + e.note + '）' : '');
    }).join('；') + '。';

    return { ok: true, text: txt, data: { sum: sum, count: list.length, byCat: byCat } };
  }

  function queryTodos(a) {
    var s = ns('life');
    var todos = s.get('todos', []) || [];
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
    /* 行程规划已经搬到时间管理模块 */
    var s = ns('time');
    var plans = s.get('plans', []) || [];
    if (!plans.length) return { ok: true, text: '还没有行程规划。' };

    var list = plans;
    if (a.name) {
      list = plans.filter(function (p) {
        return String(p.text || '').indexOf(a.name) >= 0;
      });
      if (!list.length) {
        return { ok: false, text: '没找到名字里带「' + a.name + '」的行程。' };
      }
    } else {
      /* 没指定就只看没走完的 */
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

    /* 一句一条，别在结尾再补一个句号，否则会出现「。。」 */
    var text = parts.join('。');
    if (!/。$/.test(text)) text += '。';
    return { ok: true, text: text };
  }

  function queryCountdowns() {
    var s = ns('life');
    var cds = s.get('cds', []) || [];
    if (!cds.length) return { ok: true, text: '还没有设倒计时。' };

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var rows = [];

    cds.forEach(function (c) {
      var d = nextDate(c, today);
      if (!d) return;
      var days = Math.round((d - today) / 86400000);
      rows.push({ name: c.name, days: days });
    });

    if (!rows.length) return { ok: true, text: '倒计时都过期了。' };
    rows.sort(function (x, y) { return x.days - y.days; });

    return {
      ok: true,
      text: rows.map(function (r) {
        return '「' + r.name + '」还有 ' + r.days + ' 天';
      }).join('；') + '。'
    };
  }

  /* 和倒计时模块同一套算法，保证两边算出来一样 */
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

  /* ---------------- 课表 ---------------- */

  /* 课表数据：编辑保存过的优先，没有就用模块自带的 */
  function timetable() {
    var tt = ns('time').get('timetable', null);
    if (!tt || !tt.term || !Array.isArray(tt.courses)) {
      tt = window.WorkbenchTimetable || null;
    }
    if (!tt || !tt.term || !tt.term.firstMonday || !Array.isArray(tt.courses)) return null;
    return tt;
  }

  function dateAt(y, m, d) { return new Date(y, m - 1, d); }

  /* 这天是第几周（跟时间管理模块同一套算法） */
  function weekOf(tt, d) {
    var f = String(tt.term.firstMonday).split('-');
    var first = dateAt(Number(f[0]), Number(f[1]), Number(f[2]));
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.floor(Math.round((day - first) / 86400000) / 7) + 1;
  }

  /* 周一算 1，周日算 7 */
  function dayIndex(d) {
    return d.getDay() === 0 ? 7 : d.getDay();
  }

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

  /* ---------------- 时间记录 ---------------- */

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

    return { ok: true, text: txt };
  }

  /* ---------------- 随手记 ---------------- */

  function queryNotes(a) {
    var s = ns('notes');
    var notes = s.get('notes', []) || [];
    var moods = s.get('moods', {}) || {};
    var parts = [];

    var list = notes.slice();
    if (a.keyword) {
      list = list.filter(function (n) { return String(n.text || '').indexOf(a.keyword) >= 0; });
    }
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

  /* ---------------- 随机挑战 ---------------- */

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

  /* ---------------- 添加 ---------------- */

  function addTodo(a) {
    var text = String(a.text || '').trim();
    if (!text) return { ok: false, text: '待办内容不能是空的。' };

    var s = ns('life');
    var todos = s.get('todos', []) || [];

    /* 重复检查：同名且都没做完就别再加一条 */
    var dup = todos.filter(function (t) { return !t.done && t.text === text; })[0];
    if (dup) {
      return { ok: true, text: '已经有一条一样的待办了：「' + text + '」，没有再重复加。', changed: false };
    }

    todos.unshift({
      id: uid(),
      text: text,
      due: a.due || '',
      done: false,
      t: Date.now()
    });
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
    if (!isFinite(amount) || amount <= 0) {
      return { ok: false, text: '金额要是一个正数。' };
    }
    /* 太离谱的数字拦一下，多半是理解错了 */
    if (amount > 1000000) {
      return { ok: false, text: '金额 ' + a.amount + ' 太大了，确认一下是不是记错了。' };
    }

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
    if (dup) {
      return { ok: true, text: '已经有一个叫「' + text + '」的行程了，没有再重复加。', changed: false };
    }

    plans.unshift({
      id: uid(),
      text: text,
      from: a.from || '',
      to: a.to || '',
      steps: [],
      t: Date.now()
    });
    s.set('plans', plans);
    touch('life');

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

    /* 先精确找，找不到再按名字里包含来找 */
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

    /* 有时间的排前面按时间走，跟页面上的规则一致 */
    var withTime = [], noTime = [];
    p.steps.forEach(function (x) { if (x.at) withTime.push(x); else noTime.push(x); });
    withTime.sort(function (x, y) { return x.at.localeCompare(y.at); });
    p.steps = withTime.concat(noTime);

    s.set('plans', plans);
    touch('life');

    return {
      ok: true,
      text: '给「' + p.text + '」加了第 ' + p.steps.length + ' 步：' +
        (a.at ? a.at + ' ' : '') + text + '。',
      changed: true
    };
  }

  function addNote(a) {
    var text = String(a.text || '').trim();
    if (!text) return { ok: false, text: '要记的内容不能是空的。' };

    /* 跟随手记页面上的标记按钮保持一致 */
    var MARKS = ['', '想法', '待办', '要查', '想买'];
    var mark = String(a.mark || '').trim();
    if (MARKS.indexOf(mark) < 0) mark = '想法';

    var now = new Date();
    var s = ns('notes');
    var notes = s.get('notes', []) || [];

    notes.unshift({
      id: uid(),
      text: text,
      mark: mark,
      date: todayStr(),
      time: pad(now.getHours()) + ':' + pad(now.getMinutes())
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, text: '日期要写成 2026-11-20 这样。' };
    }
    var target = new Date(date + 'T00:00:00');
    if (isNaN(target.getTime())) return { ok: false, text: '日期看不懂：' + date };

    var s = ns('life');
    var cds = s.get('cds', []) || [];
    var dup = cds.filter(function (c) { return c.name === name && c.date === date; })[0];
    if (dup) {
      return { ok: true, text: '已经有一个一样的倒计时了：「' + name + '」，没有再重复加。', changed: false };
    }

    cds.push({ id: uid(), name: name, type: 'once', date: date, day: '', t: Date.now() });
    s.set('cds', cds);
    touch('life');

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = Math.round((target - today) / 86400000);
    var tail = days > 0 ? '还有 ' + days + ' 天' : days === 0 ? '就是今天' : '已经过去 ' + (-days) + ' 天';

    return {
      ok: true,
      text: '倒计时加好了：「' + name + '」' + date + '，' + tail + '。',
      changed: true
    };
  }

  /* ---------------- 对外 ---------------- */

  function byName(name) {
    for (var i = 0; i < DEFS.length; i++) {
      if (DEFS[i].name === name) return DEFS[i];
    }
    return null;
  }

  /* 执行一次工具调用，永远返回 {ok, text}，不抛错 */
  function run(name, args) {
    var def = byName(name);
    if (!def) {
      return { ok: false, text: '没有这个工具：' + name };
    }
    try {
      var r = def.run(args || {});
      if (!r || typeof r.text !== 'string') {
        return { ok: false, text: '工具没有返回结果。' };
      }
      return r;
    } catch (e) {
      return { ok: false, text: '执行出错：' + String(e && e.message || e) };
    }
  }

  /* 给模型看的工具说明，拼成一段文字塞进提示里 */
  function promptText() {
    var lines = DEFS.map(function (d) {
      var ps = Object.keys(d.params || {}).map(function (k) {
        return '      ' + k + '：' + d.params[k];
      });
      return '  - ' + d.name + '：' + d.desc + (ps.length ? '\n' + ps.join('\n') : '');
    });
    return lines.join('\n');
  }

  return {
    DEFS: DEFS,
    run: run,
    byName: byName,
    promptText: promptText,
    nextDate: nextDate
  };
})();
