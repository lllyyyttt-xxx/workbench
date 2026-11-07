/* 随机挑战：抽一档，抽到什么做什么，完成或放弃都记一笔 */
(function () {
  'use strict';

  var db = WorkbenchStore.namespace('challenge');

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function p2(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
  }
  function nowStr() {
    var d = new Date();
    return p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  /* 四档：一分钟、十分钟、一小时、一整天 */
  var TIERS = [
    { id: 1, name: '一分钟', dur: '抬手的功夫' },
    { id: 2, name: '十分钟', dur: '一杯水的工夫' },
    { id: 3, name: '一小时', dur: '一节课的工夫' },
    { id: 4, name: '一整天', dur: '从早到晚' }
  ];

  /* 内置题池：偏室内、不费劲，难度都不高 */
  var BUILTIN = [
    /* 一分钟 */
    { tier: 1, text: '闭上眼睛深呼吸十次' },
    { tier: 1, text: '把桌上最乱的一块地方收拾干净' },
    { tier: 1, text: '喝一杯水，期间不看手机' },
    { tier: 1, text: '站起来拉伸一下脖子和肩' },
    { tier: 1, text: '给手机相册删掉十张废图' },
    { tier: 1, text: '想一件今天做得不错的事，写在纸上' },
    { tier: 1, text: '把明天要带的东西先放到门口' },
    { tier: 1, text: '关掉一个一直没看的群消息提醒' },

    /* 十分钟 */
    { tier: 2, text: '背十个英语单词并默写一遍' },
    { tier: 2, text: '整理一下桌面文件，删掉没用的' },
    { tier: 2, text: '读三页书，写一句话感受' },
    { tier: 2, text: '给一个很久没联系的同学发条消息' },
    { tier: 2, text: '把手机里最近三天的照片按类别放好' },
    { tier: 2, text: '写下这周还没做完的事，排个顺序' },
    { tier: 2, text: '找一个一直没搞懂的小问题，搜明白' },
    { tier: 2, text: '把水杯、充电线、耳机都放回原位' },
    { tier: 2, text: '闭眼听一首完整的歌，什么都不做' },

    /* 一小时 */
    { tier: 3, text: '专心读二十页书，中间不碰手机' },
    { tier: 3, text: '把某门课落下的笔记补完' },
    { tier: 3, text: '写五十行代码，能跑就行' },
    { tier: 3, text: '整理一次电脑桌面和下载文件夹' },
    { tier: 3, text: '看一集教学视频，边看边记要点' },
    { tier: 3, text: '把手机放远，专心做一件拖了很久的事' },
    { tier: 3, text: '整理自己的相册，选出十张最喜欢的' },
    { tier: 3, text: '做一次这周的复习，把不懂的列出来' },
    { tier: 3, text: '写一篇不少于三百字的随笔，随便写什么' },

    /* 一整天 */
    { tier: 4, text: '今天不点外卖，三顿都自己解决' },
    { tier: 4, text: '今天只在固定两个时间看手机' },
    { tier: 4, text: '今天把一件拖了一周以上的事做完' },
    { tier: 4, text: '今天说出口的每句话前先想一秒' },
    { tier: 4, text: '今天记录自己每一笔花销，不落到晚上补' },
    { tier: 4, text: '今天不喝任何含糖饮料' },
    { tier: 4, text: '今天把手机调成黑白屏，用一整天' }
  ];

  var state = {
    pool: [],        /* 自己加的题 */
    records: [],     /* 每次抽取的记录 */
    current: null,   /* 手上还没处理的那道 */
    lastDrawn: {}    /* 每道题上次抽到的时间，用来避免短期重复 */
  };

  /* 存的数据：自己加的题、记录、手上这道、抽过的记录 */
  function load() {
    state.pool = db.get('pool', []) || [];
    state.records = db.get('records', []) || [];
    state.current = db.get('current', null);
    state.lastDrawn = db.get('lastDrawn', {}) || {};
  }

  function save() {
    db.set('pool', state.pool);
    db.set('records', state.records);
    db.set('current', state.current);
    db.set('lastDrawn', state.lastDrawn);
    window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: 'challenge' } }));
  }

  /* 全部题目：内置的加上自己加的 */
  function allPool() {
    var list = BUILTIN.map(function (c, i) {
      return { key: 'b' + i, tier: c.tier, text: c.text, crit: '', builtin: true };
    });
    state.pool.forEach(function (c, i) {
      list.push({ key: 'u' + i, tier: c.tier, text: c.text, crit: c.crit || '', builtin: false });
    });
    return list;
  }

  /* 一档里可抽的题：最近三天抽过的不再抽 */
  function candidates(tier) {
    var cutoff = new Date(Date.now() - 3 * 86400000);
    var cds = cutoff.getFullYear() + '-' + p2(cutoff.getMonth() + 1) + '-' + p2(cutoff.getDate());
    return allPool().filter(function (c) {
      if (c.tier !== tier) return false;
      return !wasDrawnRecently(c.key, cds);
    });
  }

  /* 这道题最近三天内抽过没有 */
  function wasDrawnRecently(key, cutoffDate) {
    var last = state.lastDrawn[key];
    if (!last) return false;
    return String(last) >= String(cutoffDate);
  }

  /* 每完成满五次，这一档的难度往上走一档，封顶到一整天 */
  function effectiveTier(pickedTier) {
    var done = state.records.filter(function (r) { return r.tier === pickedTier && r.result === 'done'; });
    var bump = Math.floor(done.length / 5);
    var t = pickedTier + bump;
    return t > 4 ? 4 : t;
  }

  function draw(tier) {
    var realTier = effectiveTier(tier);
    var pool = candidates(realTier);
    if (!pool.length) {
      /* 这一档都被抽光了，退一步放宽限制 */
      pool = allPool().filter(function (c) { return c.tier === realTier; });
    }
    if (!pool.length) {
      alert('这一档没有题目了，去题池加几条吧');
      return;
    }
    var pick = pool[Math.floor(Math.random() * pool.length)];

    state.current = {
      key: pick.key,
      tier: realTier,
      pickedTier: tier,
      text: pick.text,
      crit: pick.crit,
      date: todayStr(),
      time: nowStr()
    };
    state.lastDrawn[pick.key] = todayStr();
    save();
    renderStage();
    renderStats();
  }

  /* 完成 */
  function finish(result) {
    if (!state.current) return;
    var cur = state.current;
    cur.result = result;
    cur.doneAt = nowStr();
    state.records.unshift(cur);
    state.current = null;
    save();
    renderStage();
    renderStats();
    renderRecords();
  }

  /* 抽完后点「再抽一个」 */
  function again() {
    state.current = null;
    save();
    renderStage();
  }

  /* ---- 界面 ---- */

  function renderStage() {
    var stage = $('stage');
    if (!stage) return;

    if (state.current) {
      var c = state.current;
      var tierName = TIERS[c.tier - 1].name;
      var bumped = c.pickedTier !== c.tier;
      stage.innerHTML =
        '<div class="challenge">' +
        '<div class="tier-badge">' + esc(tierName) +
        (bumped ? '（连完成五轮，升了一档）' : '') + '</div>' +
        '<div class="text">' + esc(c.text) + '</div>' +
        (c.crit ? '<div class="criteria">标准：' + esc(c.crit) + '</div>'
                : '<div class="criteria">做到了就算完成，你自己说了算。</div>') +
        '<div class="acts">' +
        '<button class="btn done" id="btnDone">完成</button>' +
        '<button class="btn give" id="btnGive">放弃</button>' +
        '<button class="btn again" id="btnAgain">再抽一个</button>' +
        '</div>' +
        '</div>';

      $('btnDone').addEventListener('click', function () { finish('done'); });
      $('btnGive').addEventListener('click', function () { finish('give'); });
      $('btnAgain').addEventListener('click', again);
      return;
    }

    var pool = allPool();
    var html = '<div class="question">想抽哪一档？抽到就必须做，不许换</div><div class="tiers">';
    TIERS.forEach(function (t) {
      var n = pool.filter(function (c) { return c.tier === t.id; }).length;
      html += '<button class="tier" data-tier="' + t.id + '">' +
        '<div class="tier-name">' + t.name + '</div>' +
        '<div class="tier-dur">' + t.dur + '</div>' +
        '<div class="tier-count">' + n + ' 道</div>' +
        '</button>';
    });
    html += '</div>';
    stage.innerHTML = html;

    Array.prototype.forEach.call(stage.querySelectorAll('[data-tier]'), function (b) {
      b.addEventListener('click', function () { draw(Number(b.dataset.tier)); });
    });
  }

  /* 连续完成天数：从今天往前数，每天至少完成一个 */
  function streakDays() {
    var done = {};
    state.records.forEach(function (r) {
      if (r.result === 'done') done[r.date] = true;
    });
    var n = 0;
    var d = new Date();
    for (;;) {
      var key = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
      if (done[key]) {
        n++;
        d = new Date(d.getTime() - 86400000);
      } else {
        /* 今天还没完成不算断，从昨天接着数 */
        if (n === 0) {
          d = new Date(d.getTime() - 86400000);
          var y = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
          if (done[y]) { n++; d = new Date(d.getTime() - 86400000); continue; }
        }
        break;
      }
    }
    return n;
  }

  function renderStats() {
    var bar = $('statsBar');
    if (!bar) return;

    var total = state.records.length;
    var done = state.records.filter(function (r) { return r.result === 'done'; }).length;
    var rate = total ? Math.round(done / total * 100) : 0;
    var st = streakDays();

    bar.innerHTML =
      '<div class="stat"><div class="label">一共抽了</div><div class="value">' + total +
      '<small>次</small></div></div>' +
      '<div class="stat"><div class="label">完成</div><div class="value">' + done +
      '<small>次</small></div></div>' +
      '<div class="stat"><div class="label">完成率</div><div class="value">' + rate +
      '<small>%</small></div></div>' +
      '<div class="stat streak"><div class="label">连续完成</div><div class="value">' + st +
      '<small>天</small></div></div>';
  }

  function renderRecords() {
    var list = $('recList');
    var cnt = $('recCount');
    if (!list) return;

    if (cnt) cnt.textContent = state.records.length ? state.records.length + ' 条' : '';

    if (!state.records.length) {
      list.innerHTML = '<div class="empty-tip">还没有记录，去抽一个试试</div>';
      return;
    }

    list.innerHTML = state.records.slice(0, 100).map(function (r) {
      var ok = r.result === 'done';
      return '<li class="rec">' +
        '<span class="mark ' + (ok ? 'ok' : 'give') + '"></span>' +
        '<div class="body">' +
        '<div class="txt' + (ok ? '' : ' given') + '">' + esc(r.text) + '</div>' +
        '<div class="meta">' + esc(r.date) + ' ' + esc(r.time) + '　' +
        esc((TIERS[r.tier - 1] || TIERS[0]).name) + '</div>' +
        '</div>' +
        '<span class="state ' + (ok ? 'ok' : 'give') + '">' + (ok ? '完成了' : '放弃了') + '</span>' +
        '</li>';
    }).join('');
  }

  function renderPool() {
    var list = $('poolList');
    var cnt = $('poolCount');
    if (!list) return;

    var all = allPool();
    if (cnt) cnt.textContent = all.length + ' 道';

    list.innerHTML = all.map(function (c) {
      return '<div class="chance-item">' +
        '<span class="t">' + esc(c.text) + '</span>' +
        '<span class="d">' + esc(TIERS[c.tier - 1].name) + '</span>' +
        (c.builtin ? '' : '<button class="del" data-del="' + esc(c.key) + '">删</button>') +
        '</div>';
    }).join('');

    Array.prototype.forEach.call(list.querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.dataset.del.slice(1));
        state.pool.splice(i, 1);
        save();
        renderPool();
        renderStage();
      });
    });
  }

  function addChance() {
    var t = $('newText');
    var crit = $('newCrit');
    var tier = Number($('newTier').value);
    var text = (t.value || '').trim();
    if (!text) { t.focus(); return; }

    /* 已经有的就不重复加 */
    var exists = allPool().some(function (c) { return c.text === text; });
    if (exists) {
      alert('这条已经有了');
      return;
    }

    state.pool.push({ tier: tier, text: text, crit: (crit.value || '').trim() });
    save();
    t.value = '';
    crit.value = '';
    renderPool();
    renderStage();
    t.focus();
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

    if (name === 'records') renderRecords();
    if (name === 'pool') renderPool();
    if (name === 'draw') { renderStage(); renderStats(); }
  }

  function init() {
    load();

    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { switchTab(b.dataset.tab); });
    });

    var add = $('btnAdd');
    if (add) add.addEventListener('click', addChance);
    var nt = $('newText');
    if (nt) {
      nt.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addChance();
      });
    }
    var nc = $('newCrit');
    if (nc) {
      nc.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addChance();
      });
    }

    renderStage();
    renderStats();
    renderRecords();
    renderPool();
    switchTab('draw');
  }

  window.Challenge = {
    wasDrawnRecently: wasDrawnRecently,
    debugLastDrawnKeys: function () { return Object.keys(state.lastDrawn); },
    init: init,
    draw: draw,
    finish: finish,
    again: again,
    TIERS: TIERS,
    allPool: allPool,
    candidates: candidates,
    effectiveTier: effectiveTier,
    streakDays: streakDays,
    state: state,
    renderStage: renderStage,
    renderStats: renderStats,
    renderRecords: renderRecords,
    renderPool: renderPool,
    switchTab: switchTab
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
