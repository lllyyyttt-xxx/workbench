/* 撤销与每日快照
 *
 * 交给 AI 写数据之后，它总有理解偏的时候，所以配两层后悔药：
 *
 *   1. 单步撤销：每次写操作前把受影响的命名空间整个存一份，
 *      点一下「撤销上次改动」就把上一份写回去，并说清撤的是什么。
 *   2. 每日快照：每天第一次打开工作台时，把当天开始的样子存一份，
 *      保留最近七天，改坏了能回到今天早上或者前天。
 *
 * 两个特性跟存储容量有关，所以要有点分寸：
 *   - 撤销栈最多留 8 条，写不进去就丢最早的，直到写得进去为止；
 *   - 每日快照最多留 7 天，同样按容量从最早的开始丢。
 * 宁可少留几份，也不能因为存不下把主数据弄坏。
 *
 * 有个坑要绕：撤销 __workbench 这个命名空间时，栈本身就存在里面，
 * 直接清空会把栈一起干掉。所以恢复时要排除这几个内部键。
 */
window.WorkbenchUndo = (function () {
  'use strict';

  var store = window.WorkbenchStore;
  var meta = store.namespace('__workbench');

  var UNDO_KEY = 'undoStack';

  /* 快照体很大（整库副本），桌面版放独立文件（外壳注入 __WORKBENCH_SHELF__），
   * 主数据文件保持苗条；浏览器没有外壳，仍存主库。 */
  var SHELF = (typeof window !== "undefined" ? window.__WORKBENCH_SHELF__ : null) || null;
  function shelfGet(key, fallback) {
    if (SHELF) {
      try {
        var raw = SHELF.get(key);
        return (raw === null || raw === undefined) ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    }
    return meta.get(key, fallback);
  }
  function shelfSet(key, val) {
    if (SHELF) {
      try { return SHELF.set(key, JSON.stringify(val)); } catch (e) { return false; }
    }
    return meta.set(key, val);
  }
  var DAILY_KEY = 'dailyShelf';
  var MAX_UNDO = 8;
  var KEEP_DAYS = 7;

  /* 内部键：恢复 __workbench 时不能动它们，否则栈和备份自己就没了 */
  var INTERNAL_KEYS = [UNDO_KEY, DAILY_KEY, 'aiHistory', 'tzBoot'];

  var NAMES = {
    life: '生活', time: '时间管理', notes: '随手记',
    challenge: '随机挑战', showcase: '作品展示台', english: '英语',
    javascript: 'JavaScript', __workbench: '助手设置'
  };

  function pad(n) { return String(n).padStart(2, '0'); }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function clone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (e) { return null; }
  }

  function nsName(id) { return NAMES[id] || id; }

  function touch(id) {
    try {
      window.dispatchEvent(new CustomEvent('workbench:data', { detail: { module: id } }));
    } catch (e) {}
  }

  /* ---------------- 单步撤销 ---------------- */

  /* 写之前调一次，拿到一个快照凭证。
   * 记两样：这个命名空间现在有哪些键、每个键的值。
   *
   * 为什么要记键名：课表这种数据平时是「用默认值、根本没落盘」的，
   * 一个键都 dump 不出来。如果只存值，撤销时就分不清「本来就空」和
   * 「读不到」，容易把数据清空。记下键名以后，撤销只要做两件事：
   * 把写之前有的键覆盖回去，把这次新增的键删掉，就够了。 */
  function begin(label, targets) {
    var list = [];
    (targets || []).forEach(function (id) {
      if (!id) return;
      var n = store.namespace(id);
      var keys = [];
      try { keys = n.keys(); } catch (e) { keys = []; }
      list.push({ ns: id, keys: keys, data: clone(n.dump()) || {} });
    });
    return { label: String(label || '改动'), at: Date.now(), targets: list };
  }

  /* 写成功了再压栈；中途报错就别压，免得撤销时把没改的也盖回去 */
  function commit(snap) {
    if (!snap || !snap.targets || !snap.targets.length) return false;

    /* 补一份写完之后的键名，撤销时靠它算出差集 */
    snap.targets.forEach(function (t) {
      try { t.after = store.namespace(t.ns).keys(); } catch (e) { t.after = []; }
    });

    var stack = meta.get(UNDO_KEY, []) || [];
    stack.push(snap);

    while (stack.length > MAX_UNDO) stack.shift();

    var ok = meta.set(UNDO_KEY, stack);
    /* 存不下就继续丢最早的，至少保证最近一次能撤 */
    while (!ok && stack.length > 1) {
      stack.shift();
      ok = meta.set(UNDO_KEY, stack);
    }
    return ok;
  }

  function last() {
    var stack = meta.get(UNDO_KEY, []) || [];
    if (!stack.length) return null;
    var s = stack[stack.length - 1];
    return {
      label: s.label,
      at: s.at,
      modules: (s.targets || []).map(function (t) { return nsName(t.ns); })
    };
  }

  /* 精确恢复：只动这次碰过的键，别的一概不碰。
   * 这样就算哪天存储后端不给键列表，最坏也只是撤不动，不会把数据洗掉。 */
  function restoreNs(id, data, beforeKeys, afterKeys) {
    var n = store.namespace(id);
    var before = beforeKeys || Object.keys(data || {});

    /* 1. 删掉这次新增的键 */
    (afterKeys || []).forEach(function (k) {
      if (before.indexOf(k) >= 0) return;
      if (id === '__workbench' && INTERNAL_KEYS.indexOf(k) >= 0) return;
      n.remove(k);
    });

    /* 2. 把写之前的值覆盖回去 */
    Object.keys(data || {}).forEach(function (k) {
      if (id === '__workbench' && INTERNAL_KEYS.indexOf(k) >= 0) return;
      n.set(k, data[k]);
    });
  }

  /* 整包恢复：每日快照用这个，因为它存的是全量 */
  function restoreFull(id, data) {
    var n = store.namespace(id);
    var keep = {};

    if (id === '__workbench') {
      INTERNAL_KEYS.forEach(function (k) {
        var v = n.get(k, null);
        if (v !== null) keep[k] = v;
      });
    }

    n.clear();
    Object.keys(data || {}).forEach(function (k) {
      if (id === '__workbench' && INTERNAL_KEYS.indexOf(k) >= 0) return;
      n.set(k, data[k]);
    });
    Object.keys(keep).forEach(function (k) { n.set(k, keep[k]); });
  }

  function undo() {
    var stack = meta.get(UNDO_KEY, []) || [];
    if (!stack.length) return { ok: false, text: '还没有可以撤销的改动。' };

    var snap = stack.pop();
    var targets = snap.targets || [];

    if (!targets.length) {
      meta.set(UNDO_KEY, stack);
      return { ok: false, text: '上次改动没留下可以恢复的快照，撤不回去了。' };
    }

    targets.forEach(function (t) { restoreNs(t.ns, t.data, t.keys, t.after); });
    meta.set(UNDO_KEY, stack);

    var names = targets.map(function (t) { return nsName(t.ns); });
    targets.forEach(function (t) { touch(t.ns); });

    return {
      ok: true,
      text: '已经撤销：' + snap.label + '（影响 ' + names.join('、') + '）',
      label: snap.label,
      names: names
    };
  }

  function clear() {
    meta.remove(UNDO_KEY);
  }

  /* ---------------- 每日快照 ---------------- */

  function allIds() {
    var ids = (window.WORKBENCH_MODULES || []).map(function (m) { return m.id; });
    if (ids.indexOf('__workbench') < 0) ids.push('__workbench');
    return ids;
  }

  /* 每天第一次打开时存一份。已经有今天的不重复存，避免一天开八次存八份 */
  function dailyBackup() {
    var shelf = shelfGet(DAILY_KEY, {}) || {};
    var k = todayStr();
    if (shelf[k]) return { ok: true, skipped: true, key: k };

    var pack = { at: Date.now(), modules: {} };
    allIds().forEach(function (id) {
      pack.modules[id] = clone(store.namespace(id).dump()) || {};
    });
    shelf[k] = pack;

    var keys = Object.keys(shelf).sort();
    while (keys.length > KEEP_DAYS) delete shelf[keys.shift()];

    var ok = shelfSet(DAILY_KEY, shelf);
    /* 存不下就少留几天，从最早的开始丢 */
    while (!ok && keys.length > 1) {
      delete shelf[keys.shift()];
      ok = shelfSet(DAILY_KEY, shelf);
    }

    return { ok: ok, key: k, days: Object.keys(shelf).length };
  }

  function dailyList() {
    var shelf = shelfGet(DAILY_KEY, {}) || {};
    return Object.keys(shelf).sort().reverse().map(function (k) {
      var p = shelf[k] || {};
      var mods = Object.keys(p.modules || {}).length;
      return { date: k, at: p.at || 0, modules: mods };
    });
  }

  function restoreDaily(date) {
    var shelf = shelfGet(DAILY_KEY, {}) || {};
    var pack = shelf[date];
    if (!pack || !pack.modules) return { ok: false, text: '找不到 ' + date + ' 的快照。' };

    /* 恢复前先给当前状态留一份撤销，万一恢复错了还能退回来 */
    var snap = begin('恢复到 ' + date, allIds());

    Object.keys(pack.modules).forEach(function (id) { restoreFull(id, pack.modules[id]); });
    Object.keys(pack.modules).forEach(touch);

    commit(snap);
    return { ok: true, text: '已经回到 ' + date + ' 开始时的样子。' };
  }

  return {
    begin: begin,
    commit: commit,
    undo: undo,
    last: last,
    clear: clear,
    dailyBackup: dailyBackup,
    dailyList: dailyList,
    restoreDaily: restoreDaily,
    names: NAMES
  };
})();
