/* 工作台共享存储层
 *
 * 每个模块用自己的命名空间，键名自动加上前缀，模块之间互不干扰。
 * 换一个模块的算法、清空某个模块的数据，都不会碰到别的模块。
 *
 * 用法：
 *   const store = WorkbenchStore.namespace('english');
 *   store.set('notebook', [...]);   // 实际写入 wb:english:notebook
 *   store.get('notebook', []);      // 读不到时返回默认值
 *
 * 存储后端：优先用外壳注入的（打包成应用时写本机文件），其次浏览器本地存储。
 * 两者都不可用时退化成内存存储，页面照常能用，只是关掉就没了，并且会提示。
 */
(function (global) {
  'use strict';

  var PREFIX = 'wb:';
  var memory = {};
  var memoryOnly = false;

  function nativeBackend() {
    var inj = global.__WORKBENCH_STORE__;
    if (inj && typeof inj.get === 'function' && typeof inj.set === 'function') {
      return {
        name: 'native',
        get: function (k) { try { return inj.get(k); } catch (e) { return null; } },
        set: function (k, v) { try { inj.set(k, v); return true; } catch (e) { return false; } },
        remove: function (k) { try { if (inj.remove) inj.remove(k); } catch (e) {} },
        keys: function () { try { return inj.keys ? inj.keys() : []; } catch (e) { return []; } },
        available: function () { try { return inj.available ? !!inj.available() : true; } catch (e) { return true; } }
      };
    }
    return null;
  }

  function browserBackend() {
    var ok = false;
    try {
      var probe = '__wb_probe__';
      global.localStorage.setItem(probe, '1');
      ok = global.localStorage.getItem(probe) === '1';
      global.localStorage.removeItem(probe);
    } catch (e) { ok = false; }
    return {
      name: 'browser',
      get: function (k) { try { return global.localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { global.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
      remove: function (k) { try { global.localStorage.removeItem(k); } catch (e) {} },
      keys: function () { try { return Object.keys(global.localStorage); } catch (e) { return []; } },
      available: function () { return ok; }
    };
  }

  var backend = nativeBackend();
  if (!backend) {
    var b = browserBackend();
    backend = b.available() ? b : null;
  }
  if (!backend) {
    memoryOnly = true;
    backend = {
      name: 'memory',
      get: function (k) { return Object.prototype.hasOwnProperty.call(memory, k) ? memory[k] : null; },
      set: function (k, v) { memory[k] = v; return true; },
      remove: function (k) { delete memory[k]; },
      keys: function () { return Object.keys(memory); },
      available: function () { return false; }
    };
  }

  function fullKey(ns, key) { return PREFIX + ns + ':' + key; }

  /* 删除墓碑：同步时把「这个键在本地被删了」传给其他设备。
   * 键名带 wb:sync: 的元数据不记（它们不参与同步），30 天后由 sync.js 清理。 */
  var TOMB_KEY = 'wb:sync:tomb';
  function recordTomb(k) {
    if (typeof k !== 'string' || k.indexOf(PREFIX) !== 0) return;
    if (k.indexOf('wb:sync:') === 0) return;
    /* 探针键（英语模块每次打开写一下再删）不记墓碑，免得同步文件里堆垃圾 */
    if (/__wb_probe__$/.test(k)) return;
    try {
      var raw = backend.get(TOMB_KEY);
      var tomb = raw ? JSON.parse(raw) : {};
      if (!tomb[k]) tomb[k] = Date.now();
      backend.set(TOMB_KEY, JSON.stringify(tomb));
    } catch (e) {}
  }

  var WorkbenchStore = {
    /* 当前后端名称：native / browser / memory */
    backend: backend.name,
    /* 存储是否可长期保存 */
    persistent: backend.name !== 'memory',
    /* memoryOnly 时提示调用方 */
    isMemoryOnly: function () { return memoryOnly; },

    namespace: function (ns) {
      if (!ns || typeof ns !== 'string') throw new Error('命名空间必须是非空字符串');
      return {
        ns: ns,
        get: function (key, fallback) {
          try {
            var raw = backend.get(fullKey(ns, key));
            if (raw === null || raw === undefined || raw === '') return fallback;
            return JSON.parse(raw);
          } catch (e) { return fallback; }
        },
        set: function (key, value) {
          try { return backend.set(fullKey(ns, key), JSON.stringify(value)); } catch (e) { return false; }
        },
        remove: function (key) {
          try {
            var fk = fullKey(ns, key);
            backend.remove(fk);
            recordTomb(fk);
          } catch (e) {}
        },
        /* 列出本命名空间下所有键（不含前缀） */
        keys: function () {
          var pre = PREFIX + ns + ':';
          return backend.keys().filter(function (k) { return k.indexOf(pre) === 0; })
            .map(function (k) { return k.slice(pre.length); });
        },
        /* 清空本命名空间，不影响其他模块 */
        clear: function () {
          var self = this;
          self.keys().forEach(function (k) { self.remove(k); });
        },
        /* 导出本模块全部数据，用于备份 */
        dump: function () {
          var out = {};
          this.keys().forEach(function (k) { out[k] = this.get(k, null); }, this);
          return out;
        },
        /* 从备份恢复本模块数据，只覆盖自己的键 */
        load: function (data) {
          if (!data || typeof data !== 'object') return false;
          var self = this;
          Object.keys(data).forEach(function (k) { self.set(k, data[k]); });
          return true;
        }
      };
    },

    /* 整库原始读写：给同步/备份用，键名带 wb: 前缀，值是原始字符串 */
    raw: {
      get: function (k) { return backend.get(k); },
      set: function (k, v) { return backend.set(k, v); },
      remove: function (k) { backend.remove(k); recordTomb(k); },
      keys: function () {
        return backend.keys().filter(function (k) { return k.indexOf(PREFIX) === 0; });
      }
    }
  };

  global.WorkbenchStore = WorkbenchStore;
})(typeof window !== 'undefined' ? window : this);
