/* 随手记：灵感收件箱、情绪精力、时间记录
 * 三样都只做一件事：花几秒钟记一笔，价值在事后回看。
 */
(function () {
  'use strict';

  var db = WorkbenchStore.namespace('notes');

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
  function timeStr(d) {
    d = d || new Date();
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  }
  function prettyDate(s) {
    if (!s) return '';
    var today = dateStr();
    if (s === today) return '今天';
    var y = new Date(Date.now() - 86400000);
    if (s === dateStr(y)) return '昨天';
    return s.slice(5);
  }

  /* 默认类别：都是大学生日常会用到的 */
  var DEFAULT_CATS = ['上课', '作业', '自学', '社团', '通勤', '运动', '社交', '刷手机', '娱乐', '休息'];

  /* 哪些类别算“可自己支配” */
  var FREE_CATS = ['自学', '运动', '社交', '娱乐', '休息'];

  var state = {
    notes: [],
    moods: {},     /* 日期 -> { mood, energy } */
    times: [],     /* {date, start, end, cat, what} */
    cats: []
  };

  function load() {
    state.notes = db.get('notes', []) || [];
    state.moods = db.get('moods', {}) || {};
    state.times = db.get('times', []) || [];
    state.cats = db.get('cats', []) || DEFAULT_CATS.slice();
    if (!state.cats.length) state.cats = DEFAULT_CATS.slice();
  }

  function save(what) {
    if (!what || what === 'notes') db.set('notes', state.notes);
    if (!what || what === 'moods') db.set('moods', state.moods);
    if (!what || what === 'times') {
      db.set('times', state.times);
      db.set('cats', state.cats);
    }
    window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: 'notes' } }));
  }

  /* ---------- 灵感收件箱 ---------- */

  var curMark = '';

  function addNote() {
    var input = $('inboxInput');
    var text = (input.value || '').trim();
    if (!text) { input.focus(); return; }

    var d = new Date();
    state.notes.unshift({
      id: 'n' + d.getTime() + Math.floor(Math.random() * 1000),
      text: text,
      mark: curMark,
      date: dateStr(d),
      time: timeStr(d)
    });
    save('notes');
    input.value = '';
    renderNotes();
    input.focus();
  }

  function renderNotes() {
    var list = $('noteList');
    var cnt = $('noteCount');
    if (!list) return;

    var q = (($('noteSearch') || {}).value || '').trim().toLowerCase();
    var items = state.notes;
    if (q) {
      items = items.filter(function (n) {
        return (n.text || '').toLowerCase().indexOf(q) >= 0 ||
               (n.mark || '').toLowerCase().indexOf(q) >= 0;
      });
    }

    if (cnt) cnt.textContent = state.notes.length ? state.notes.length + ' 条' : '';

    if (!items.length) {
      list.innerHTML = '<div class="empty-tip">' +
        (state.notes.length ? '没搜到' : '还没有记东西，上面写一句试试') + '</div>';
      return;
    }

    list.innerHTML = items.slice(0, 200).map(function (n) {
      return '<li class="note" data-id="' + esc(n.id) + '">' +
        '<div class="body">' +
        '<div class="txt">' + esc(n.text) + '</div>' +
        '<div class="meta">' +
        '<span>' + esc(prettyDate(n.date)) + ' ' + esc(n.time) + '</span>' +
        (n.mark ? '<span class="tagx">' + esc(n.mark) + '</span>' : '') +
        '</div></div>' +
        '<div class="ops">' +
        '<button data-copy="' + esc(n.id) + '">复制</button>' +
        '<button class="danger" data-del="' + esc(n.id) + '">删</button>' +
        '</div></li>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.del;
        state.notes = state.notes.filter(function (n) { return n.id !== id; });
        save('notes');
        renderNotes();
      });
    });

    Array.prototype.forEach.call(list.querySelectorAll('[data-copy]'), function (b) {
      b.addEventListener('click', function () {
        var id = b.dataset.copy;
        var n = state.notes.filter(function (x) { return x.id === id; })[0];
        if (!n) return;
        try {
          navigator.clipboard.writeText(n.text);
          b.textContent = '已复制';
          setTimeout(function () { b.textContent = '复制'; }, 1200);
        } catch (e) {
          b.textContent = '复制不了';
          setTimeout(function () { b.textContent = '复制'; }, 1200);
        }
      });
    });
  }

  /* ---------- 情绪精力 ---------- */

  function saveMood() {
    var m = Number($('moodRange').value);
    var e = Number($('energyRange').value);
    var today = dateStr();
    state.moods[today] = { mood: m, energy: e };
    save('moods');
    renderMood();
    var hint = $('moodHint');
    if (hint) {
      hint.textContent = '今天的记下了';
      setTimeout(function () { hint.textContent = ''; }, 2000);
    }
  }

  function renderMood() {
    var today = dateStr();

    /* 今天已经记过就把滑块摆到当时的值 */
    if (state.moods[today]) {
      var t = state.moods[today];
      if ($('moodRange')) $('moodRange').value = t.mood;
      if ($('energyRange')) $('energyRange').value = t.energy;
      if ($('moodVal')) $('moodVal').textContent = t.mood;
      if ($('energyVal')) $('energyVal').textContent = t.energy;
    }

    /* 最近三十天柱状图 */
    var chart = $('moodChart');
    if (chart) {
      var days = [];
      for (var i = 29; i >= 0; i--) {
        var d = new Date(Date.now() - i * 86400000);
        var key = dateStr(d);
        days.push({ key: key, v: state.moods[key] || null });
      }
      chart.innerHTML = days.map(function (d) {
        var m = d.v ? d.v.mood : 0;
        var e = d.v ? d.v.energy : 0;
        return '<div class="mood-bar" title="' + d.key + (d.v ? ' 情绪' + d.v.mood + ' 精力' + d.v.energy : ' 没记') + '">' +
          '<div class="m" style="height:' + (m * 8) + 'px;"></div>' +
          '<div class="e" style="height:' + (e * 8) + 'px;"></div>' +
          '</div>';
      }).join('');
    }

    /* 一周里哪天状态最好 */
    var row = $('weekdayRow');
    if (row) {
      var names = ['一', '二', '三', '四', '五', '六', '日'];
      var sum = [0, 0, 0, 0, 0, 0, 0];
      var cnts = [0, 0, 0, 0, 0, 0, 0];
      Object.keys(state.moods).forEach(function (k) {
        var d = new Date(k + 'T00:00:00');
        if (isNaN(d.getTime())) return;
        var idx = (d.getDay() + 6) % 7;   /* 周一算 0 */
        sum[idx] += (state.moods[k].mood + state.moods[k].energy) / 2;
        cnts[idx]++;
      });
      row.innerHTML = names.map(function (n, i) {
        if (!cnts[i]) {
          return '<div class="wd-cell"><div class="n">' + n + '</div><div class="v" style="color:#c8d0c8;">--</div></div>';
        }
        var avg = sum[i] / cnts[i];
        return '<div class="wd-cell"><div class="n">' + n + '</div>' +
          '<div class="v' + (avg < 2.8 ? ' low' : '') + '">' + avg.toFixed(1) + '</div></div>';
      }).join('');
    }
  }

  /* ---------- 时间记录 ---------- */

  function minutesOf(t) {
    if (!t) return 0;
    var p = String(t).split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  /* ---------- 切换标签 ---------- */

  function switchTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (v) {
      v.classList.remove('active');
    });
    var view = $('view' + name.charAt(0).toUpperCase() + name.slice(1));
    if (view) view.classList.add('active');

    if (name === 'inbox') renderNotes();
    if (name === 'mood') renderMood();
  }

  function init() {
    load();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    /* 灵感 */
    var bs = $('btnSaveNote');
    if (bs) bs.addEventListener('click', addNote);
    var ii = $('inboxInput');
    if (ii) {
      ii.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote(); }
      });
      ii.addEventListener('input', function () {
        ii.style.height = 'auto';
        ii.style.height = Math.min(ii.scrollHeight, 160) + 'px';
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-mark]'), function (b) {
      b.addEventListener('click', function () {
        curMark = b.dataset.mark;
        Array.prototype.forEach.call(document.querySelectorAll('[data-mark]'), function (x) {
          x.classList.toggle('on', x.dataset.mark === curMark);
        });
      });
    });
    var ns = $('noteSearch');
    if (ns) ns.addEventListener('input', renderNotes);

    /* 情绪 */
    var mr = $('moodRange');
    if (mr) mr.addEventListener('input', function () { $('moodVal').textContent = mr.value; });
    var er = $('energyRange');
    if (er) er.addEventListener('input', function () { $('energyVal').textContent = er.value; });
    var bm = $('btnSaveMood');
    if (bm) bm.addEventListener('click', saveMood);


    renderNotes();
    renderMood();
    switchTab('inbox');
  }

  window.Notes = {
    init: init,
    addNote: addNote,
    saveMood: saveMood,
    switchTab: switchTab,
    state: state,
    DEFAULT_CATS: DEFAULT_CATS,
    FREE_CATS: FREE_CATS,
    renderNotes: renderNotes,
    renderMood: renderMood,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
