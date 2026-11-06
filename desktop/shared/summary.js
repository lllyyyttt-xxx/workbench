/* 模块摘要
 *
 * 首页的 AI 助手要知道各模块现在的情况，才能回答「这个月花了多少」这类问题。
 *
 * 关键点：模块是各自独立的页面，首页打开时模块脚本并不在内存里，
 * 所以不能指望模块「注册」一个函数。做法是直接读存储里的数据，
 * 由这里统一算出摘要。模块如果在页面上想覆盖默认算法，
 * 可以在自己页面里调用 WorkbenchSummary.register(id, fn)。
 *
 * 新增模块时：在 SUMMARY 里加一条，说明从哪个键读、算什么。
 */
(function (global) {
  'use strict';

  var MAX_LEN = 300;

  function ns(id) { return global.WorkbenchStore.namespace(id); }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function money(n) {
    var v = Math.round(Number(n) * 100) / 100;
    if (!isFinite(v)) return '0';
    return v % 1 === 0 ? String(v) : String(parseFloat(v.toFixed(2)));
  }

  /* 各个模块的摘要算法。
   * 每个函数返回一句话；数据为空时返回空字符串，表示这个模块没内容可说。
   */
  var SUMMARY = {

    life: function () {
      var store = ns('life');
      var expenses = store.get('expenses', []) || [];
      var todos = store.get('todos', []) || [];
      var cds = store.get('cds', []) || [];

      var now = new Date();
      var td = todayStr();
      var ym = now.getFullYear() + '-' + pad(now.getMonth() + 1);
      var parts = [];

      if (expenses.length) {
        var monthExp = expenses.filter(function (e) { return String(e.date).indexOf(ym) === 0; });
        var monthSum = monthExp.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
        var todayExp = expenses.filter(function (e) { return e.date === td; });
        var todaySum = todayExp.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
        parts.push(now.getMonth() + 1 + '月花了 ' + money(monthSum) + ' 元（' + monthExp.length + ' 笔），今天 ' +
          money(todaySum) + ' 元（' + todayExp.length + ' 笔）');

        // 这个月花得最多的类型
        if (monthExp.length) {
          var byCat = {};
          monthExp.forEach(function (e) { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount || 0); });
          var top = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })[0];
          if (top) parts.push('以' + top + '最多');
        }
      }

      var open = todos.filter(function (t) { return !t.done; });
      if (open.length) {
        var due = open.filter(function (t) { return t.due && t.due <= td; });
        parts.push('还有 ' + open.length + ' 件待办' + (due.length ? '，其中 ' + due.length + ' 件已到期' : ''));
      }

      // 规划：已经从生活搬到时间管理，这里从时间管理的存储里读
      var plans = ns('time').get('plans', []) || [];
      if (Array.isArray(plans) && plans.length) {
        // 没走完的排在前面，按开始日期由近到远
        var active = plans.filter(function (p) {
          var steps = p.steps || [];
          return !(steps.length && steps.every(function (s) { return s.done; }));
        });
        if (active.length) {
          var near = active.slice().sort(function (a, b) {
            var ad = a.from || '9999', bd = b.from || '9999';
            return ad.localeCompare(bd);
          })[0];
          var st = near.steps || [];
          var doneN = st.filter(function (s) { return s.done; }).length;
          var txt = '有 ' + active.length + ' 个行程没走完，最近的是「' + near.text + '」';
          if (st.length) {
            txt += '（' + doneN + '/' + st.length + ' 步）';
            // 下一步是什么，方便直接回答“接下来该做什么”
            var nextStep = null;
            for (var i = 0; i < st.length; i++) {
              if (!st[i].done) { nextStep = st[i]; break; }
            }
            if (nextStep) txt += '，下一步是「' + nextStep.text + '」';
          }
          parts.push(txt);
        }
      }

      if (cds.length) {
        var today = new Date();
        today.setHours(0, 0, 0, 0);
        var best = null;
        cds.forEach(function (cd) {
          var d = nextDate(cd);
          if (!d || d < today) return;
          var days = Math.round((d - today) / 86400000);
          if (!best || days < best.days) best = { name: cd.name, days: days };
        });
        if (best) parts.push('最近的是「' + best.name + '」还有 ' + best.days + ' 天');
      }

      return parts.join('；');
    },

    time: function () {
      /* 课表 + 规划 + 时间记录，能回答"明天有什么课""这周排了什么" */
      var store = ns('time');
      var plans = store.get('plans', []) || [];
      var parts = [];

      /* 课表：今天和明天的课。
       * 编辑保存过的课表优先；首页不加载默认课表数据，所以全局变量没有时就只能用存的那份。
       */
      var TT = store.get('timetable', null);
      if (!TT || !TT.term || !Array.isArray(TT.courses)) TT = global.WorkbenchTimetable || null;
      if (TT && TT.term && TT.term.firstMonday && Array.isArray(TT.courses)) {
        var DAY = 86400000;
        var first = String(TT.term.firstMonday).split('-');
        var firstD = new Date(Number(first[0]), Number(first[1]) - 1, Number(first[2]));

        var dayName = ['日', '一', '二', '三', '四', '五', '六'];

        function coursesOn(offset) {
          var now = new Date();
          var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
          var week = Math.floor(Math.round((d - firstD) / DAY) / 7) + 1;
          var di = d.getDay() === 0 ? 7 : d.getDay();
          var out = [];
          TT.courses.forEach(function (c) {
            if (c.day !== di) return;
            var w = c.weeks;
            if (w === 'odd' && week % 2 !== 1) return;
            if (w === 'even' && week % 2 !== 0) return;
            if (Array.isArray(w) && w.indexOf(week) < 0) return;
            out.push('「' + c.name + '」' + (c.start || '') + (c.room ? ' 在 ' + c.room : ''));
          });
          return out;
        }

        var t0 = coursesOn(0);
        var t1 = coursesOn(1);
        if (t0.length) parts.push('今天有 ' + t0.length + ' 节课：' + t0.join('、'));
        else parts.push('今天没课');
        if (t1.length) parts.push('明天有 ' + t1.length + ' 节：' + t1.join('、'));
      }

      /* 规划 */
      var active = plans.filter(function (p) {
        var steps = p.steps || [];
        return !(steps.length && steps.every(function (s) { return s.done; }));
      });
      if (active.length) {
        var near = active.slice().sort(function (a, b) {
          var ad = a.from || '9999', bd = b.from || '9999';
          return ad.localeCompare(bd);
        })[0];
        var st = near.steps || [];
        var doneN = st.filter(function (s) { return s.done; }).length;
        var txt = '有 ' + active.length + ' 个规划没做完，最近的是「' + near.text + '」';
        if (st.length) txt += '（' + doneN + '/' + st.length + ' 步）';
        parts.push(txt);
      }

      return parts.join('；');
    },

    english: function () {
      // 键名和结构与英语模块内部一致：vocab_srs 复习记录、vocab_stats 每日打卡、vocab_notebook 生词本
      var store = ns('english');
      var srs = store.get('vocab_srs', {}) || {};
      var stats = store.get('vocab_stats', {}) || {};
      var notebook = store.get('vocab_notebook', []) || [];
      if (!srs || typeof srs !== 'object' || Array.isArray(srs)) srs = {};
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) stats = {};

      var words = Object.keys(srs);
      var parts = [];

      if (words.length) {
        var now = Date.now();
        var due = 0, mastered = 0, cet4 = 0, cet6 = 0;
        words.forEach(function (w) {
          var rec = srs[w] || {};
          if (rec.d && rec.d <= now) due++;
          if ((rec.s || 0) >= 4) mastered++;
          if (rec.lv === 'cet6') cet6++; else cet4++;
        });
        parts.push('开始复习 ' + words.length + ' 个词');
        if (due) parts.push('今天有 ' + due + ' 个到期');
        if (mastered) parts.push('已掌握 ' + mastered + ' 个');
      }

      // 今天的学习情况
      var td = todayStr();
      var today = stats[td];
      if (today && today.n > 0) {
        parts.push('今天答了 ' + today.n + ' 次，对 ' + (today.ok || 0) + ' 次');
      }

      // 连续打卡天数
      var streak = 0;
      var d = new Date();
      for (;;) {
        var key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        var day = stats[key];
        if (day && day.n > 0) { streak++; d.setDate(d.getDate() - 1); }
        else if (streak === 0 && key === td) { d.setDate(d.getDate() - 1); }
        else break;
      }
      if (streak) parts.push('已连续 ' + streak + ' 天');

      if (Array.isArray(notebook) && notebook.length) {
        parts.push('生词本 ' + notebook.length + ' 个词');
      }

      return parts.join('；');
    },

    notes: function () {
      // 键名与随手记一致：notes 是灵感条目，moods 是每天的情绪精力打分
      var store = ns('notes');
      var notes = store.get('notes', []) || [];
      var moods = store.get('moods', {}) || {};
      var parts = [];

      if (Array.isArray(notes) && notes.length) {
        var td = todayStr();
        var todayN = notes.filter(function (n) { return n.date === td; }).length;
        parts.push('灵感收件箱有 ' + notes.length + ' 条' + (todayN ? '，今天记了 ' + todayN + ' 条' : ''));
      }

      var keys = Object.keys(moods || {}).sort();
      if (keys.length) {
        var last = keys[keys.length - 1];
        var m = moods[last] || {};
        if (m.mood !== undefined || m.energy !== undefined) {
          parts.push('最近一次情绪精力记在 ' + last.slice(5) + '：情绪 ' +
            (m.mood === undefined ? '-' : m.mood) + '/10、精力 ' +
            (m.energy === undefined ? '-' : m.energy) + '/10');
        }
        // 最近取七天做个平均，方便回答“这周状态怎么样”
        var recent = keys.slice(-7);
        var ms = 0, es = 0, cn = 0;
        recent.forEach(function (k) {
          var v = moods[k] || {};
          if (v.mood !== undefined) ms += Number(v.mood);
          if (v.energy !== undefined) es += Number(v.energy);
          cn++;
        });
        if (cn) {
          parts.push('最近 ' + cn + ' 天平均情绪 ' + Math.round(ms / cn) + '、精力 ' + Math.round(es / cn));
        }
      }

      return parts.join('；');
    },

    challenge: function () {
      // 键名与随机挑战一致：records 是完成/放弃的记录，current 是手上还没结束的那条
      var store = ns('challenge');
      var recs = store.get('records', []) || [];
      var cur = store.get('current', null);
      var parts = [];

      if (cur && cur.text) {
        parts.push('手上还有一条没结束的挑战「' + String(cur.text).slice(0, 30) + '」');
      }
      if (Array.isArray(recs) && recs.length) {
        var done = recs.filter(function (r) { return r.result === 'done'; }).length;
        var td = todayStr();
        var todayN = recs.filter(function (r) { return r.date === td; }).length;
        parts.push('总共抽了 ' + recs.length + ' 次，完成 ' + done + ' 次、放弃 ' + (recs.length - done) + ' 次' +
          (todayN ? '，今天抽了 ' + todayN + ' 次' : ''));
      }

      return parts.join('；');
    }

  };

  // 倒计时的下一次日期，和模块里的算法保持一致
  function nextDate(cd) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    function parse(s) {
      var p = String(s).split('-');
      return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    }
    if (cd.type === 'once') return cd.date ? parse(cd.date) : null;
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
      if (!cd.date) return null;
      var b = parse(cd.date);
      var c = new Date(today.getFullYear(), b.getMonth(), b.getDate());
      if (c < today) c = new Date(today.getFullYear() + 1, b.getMonth(), b.getDate());
      return c;
    }
    if (cd.type === 'weekly') {
      var target = Number(cd.day) || 1;
      var cur = today.getDay() === 0 ? 7 : today.getDay();
      var diff = (target - cur + 7) % 7;
      return new Date(today.getFullYear(), today.getMonth(), today.getDate() + diff);
    }
    return null;
  }

  // 模块页面里可以覆盖默认算法
  var overrides = {};

  function register(id, fn) {
    if (!id || typeof id !== 'string') throw new Error('注册摘要需要模块标识');
    if (typeof fn !== 'function') throw new Error('注册摘要需要提供函数');
    overrides[id] = fn;
  }

  function get(id) {
    var text = '';
    try {
      if (overrides[id]) {
        text = overrides[id]() || '';
      } else if (SUMMARY[id]) {
        text = SUMMARY[id]() || '';
      }
    } catch (e) {
      return '';
    }
    if (typeof text !== 'string') return '';
    text = text.replace(/\s+/g, ' ').trim();
    if (text.length > MAX_LEN) {
      // 省略号也要算进长度里
      text = text.slice(0, MAX_LEN - 1) + '…';
    }
    return text;
  }

  function collect(modules) {
    var list = modules || [];
    var out = [];
    list.forEach(function (m) {
      var text = get(m.id);
      if (text) out.push({ id: m.id, name: m.name, desc: m.desc || '', text: text });
    });
    return out;
  }

  function asPrompt(modules) {
    var items = collect(modules);
    if (!items.length) return '';
    var d = new Date();
    var head = '现在是 ' + d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日。工作台各模块情况：';
    var lines = items.map(function (it) { return '- ' + it.name + '：' + it.text; });
    return head + '\n' + lines.join('\n');
  }

  function has(id) { return !!overrides[id] || !!SUMMARY[id]; }

  function ids() { return Object.keys(SUMMARY); }

  global.WorkbenchSummary = {
    register: register,
    get: get,
    collect: collect,
    asPrompt: asPrompt,
    has: has,
    ids: ids,
    MAX_LEN: MAX_LEN
  };
})(typeof window !== 'undefined' ? window : this);
