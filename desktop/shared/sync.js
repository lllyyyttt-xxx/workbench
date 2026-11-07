/* 工作台数据同步（GitHub Gist 云端中转）
 *
 * 云端布局：一个私有 Gist 里，每个用户 × 每个模块一个小文件：
 *   sync-<名字>-<模块>.json  =  { savedAt, data: { 完整键名: 原始值 }, __del?: {...} }
 *
 * ---- 同步规则（以本地为准）----
 * 1. 任何改动先写本地，切页面 / 关掉 / 断网都不影响；
 * 2. 只有三种情况碰云端：整点自动比对、手动上传、手动下载；
 * 3. 整点那一轮：本地有没传的改动 → 上传（本地赢）；本地没改、云端变了 →
 *    只提示「云端有新数据」，点了才写入并刷新（避免页面内存里的旧数据把它覆盖回去）；
 * 4. 刚打开页面时（还没动手点东西），若错过了整点，会先比对一次，拉到新数据直接应用并刷新；
 * 5. 只有「立即下载」会用云端覆盖本地未上传的改动（点了会先确认）。
 *
 * 哪些键参与同步：见 SYNC_RULES。内容模块默认同步，设备状态命名空间默认不同步，
 * 密钥、聊天记录、界面开关这些明确排除。
 *
 * 判断「本地有没有改动」不看时钟：拿本地内容和「上次同步时的内容指纹」比。
 * 指纹按排好序的键算，键顺序不同不会误判。删除用墓碑（__del）传播，
 * 哪怕某个模块被删到一个键都不剩，也要把删除传出去。
 */
(function (global) {
  'use strict';

  /* 【开源版默认留空】
   * 「账号模式」（几个人共用同一份数据）需要一个后端：账号表和同步数据都放在
   * 那里，也就是本仓库 web/netlify/functions/ 下那几个函数。自己部署好之后，
   * 把下面这行改成你的站点地址即可。
   * 留空也不影响使用——用「token 模式」把数据同步到你自己的 GitHub Gist 就行。 */
  var REMOTE = '';
  function isWeb() {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  }
  function apiBase() {
    /* 账号模式：网页版从自己站点打开，同源走相对路径；
     * 桌面版是 file://，只能问配置好的线上后台。 */
    if (mode() === 'account') {
      return (isWeb() ? '' : REMOTE) + '/api/sync/';
    }
    return isWeb() ? '/api/sync/' : 'https://api.github.com/gists/';
  }

  var K_TOKEN = 'wb:sync:token';
  var K_GID = 'wb:sync:gid';
  var K_USER = 'wb:sync:user';
  var K_MODE = 'wb:sync:mode';   // '' = token 模式（站长自己），'account' = 账号模式（朋友）
  var K_CODE = 'wb:sync:code';   // 账号模式的 4 位访问码（只存本机）
  var MAX_VALUE = 500000;        // 超过这个字符数的值不同步（真正的 base64 大图）

  var RETRY_GAP = 5 * 60000;     // 整点这轮失败后，至少隔 5 分钟再试

  /* 同步范围：内容模块默认全同步，这里只列例外。
   *   only   = 只同步这几个键
   *   except = 除了这几个键，其余都同步
   * 没列到的命名空间默认同步（以后新加的内容模块不用改这里）。 */
  var SYNC_RULES = {
    '__workbench': { only: ['cardNames'] },          // 设备状态命名空间：只同步卡片改名
    '__probe': { only: [] },                          // 探针类垃圾键
    '_': { only: [] },                                // 没有命名空间的杂项
    'time': { except: ['focus', 'focusCfg', 'migrated'] },            // 番茄钟状态/偏好/迁移标记
    'english': { except: [] }
  };

  /* 明确留在本机、不上云的键（历史原因保留，实际由 SYNC_RULES 兜底） */
  var LOCAL_ONLY = {
    'wb:__workbench:winBounds': 1,
    'wb:__workbench:dockItems': 1,
    'wb:__workbench:deckIndex': 1,
    'wb:__workbench:railOpen': 1,
    'wb:__workbench:notifiedDays': 1,
    'wb:__workbench:undoStack': 1,
    'wb:__workbench:dailyShelf': 1
  };

  function nsOf(key) { var m = key.match(/^wb:([^:]+):/); return m ? m[1] : '_'; }
  function shortKey(key) { var ns = nsOf(key); return key.slice(3 + ns.length + 1); }

  function allowed(key) {
    if (key.indexOf('wb:sync:') === 0) return false;
    if (LOCAL_ONLY[key]) return false;
    var ns = nsOf(key);
    var r = SYNC_RULES[ns];
    if (!r) return true;
    var s = shortKey(key);
    if (r.only) return r.only.indexOf(s) >= 0;
    if (r.except) return r.except.indexOf(s) < 0;
    return true;
  }

  function raw() { return global.WorkbenchStore && global.WorkbenchStore.raw; }
  function get(k) { var r = raw(); return r ? r.get(k) : null; }
  function set(k, v) { var r = raw(); if (r) r.set(k, v); }
  function del(k) { var r = raw(); if (r) r.remove(k); }

  function parse(k, dft) { try { return JSON.parse(get(k) || JSON.stringify(dft)); } catch (e) { return dft; } }
  function token() { return parse(K_TOKEN, ''); }
  function gid() { return parse(K_GID, ''); }
  function mode() { return parse(K_MODE, ''); }
  function code() { return parse(K_CODE, ''); }
  function user() { return String(parse(K_USER, '') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20); }
  function u() { return user() || 'me'; }
  function fileName(ns) { return 'sync-' + u() + '-' + ns + '.json'; }
  function savedKey(ns) { return 'wb:sync:savedAt:' + u() + ':' + ns; }
  function savedAt(ns) { return Number(get(savedKey(ns)) || 0); }
  function hashKey(ns) { return 'wb:sync:hash:' + u() + ':' + ns; }
  function storedHash(ns) { return String(parse(hashKey(ns), '') || ''); }
  function lastRunKey() { return 'wb:sync:lastRun:' + u(); }
  function lastRun() { return Number(get(lastRunKey()) || 0); }
  function markRun(ts) { set(lastRunKey(), String(ts || Date.now())); }
  function pendingKey(ns) { return 'wb:sync:pending:' + u() + ':' + ns; }
  function isPending(ns) { return get(pendingKey(ns)) === '1'; }

  function headers() {
    var h = { 'Content-Type': 'application/json', 'User-Agent': 'workbench' };
    if (mode() === 'account') {
      h['x-wb-account'] = u() + ':' + code();
    } else {
      h['Authorization'] = 'token ' + token();
    }
    return h;
  }

  /* djb2：足够区分「变没变」 */
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return String(h);
  }

  /* 只留真正参与同步的键 */
  function syncedView(obj) {
    var out = {};
    Object.keys(obj || {}).forEach(function (k) {
      if (k === '__del') return;
      if (!allowed(k)) return;
      var v = obj[k];
      if (typeof v !== 'string') return;
      if (v.length > MAX_VALUE) return;
      out[k] = v;
    });
    return out;
  }

  /* 指纹：键排序后串起来，键顺序不同不算改动 */
  function fingerprint(obj) {
    var view = syncedView(obj);
    var ks = Object.keys(view).sort();
    var parts = [];
    for (var i = 0; i < ks.length; i++) parts.push(ks[i] + '\u0001' + view[ks[i]]);
    return hash(parts.join('\u0002'));
  }
  function emptyView(obj) { return Object.keys(syncedView(obj)).length === 0; }

  /* 墓碑：store.js 在删除时记到 wb:sync:tomb（键 → 删除时间）。
   * 30 天后清掉；键重新创建则撤销。 */
  var TOMB_KEY = 'wb:sync:tomb';
  var TOMB_KEEP = 30 * 86400000;
  function tombs() { try { return JSON.parse(get(TOMB_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function tombsSave(t) { set(TOMB_KEY, JSON.stringify(t)); }

  /* 收集：按模块分组（只留允许同步的键），并给「删过键」的模块挂上墓碑。
   * 关键点：模块即使被删到一个键都不剩，只要墓碑还在，也要建出这个模块，
   * 否则删除永远传不出去。 */
  function collect() {
    var out = {};
    var skipped = 0;
    var ks = raw() ? raw().keys() : [];
    var exists = {};
    ks.forEach(function (k) {
      if (k.indexOf('wb:sync:') === 0) return;
      if (LOCAL_ONLY[k]) { skipped++; return; }
      var v = raw().get(k);
      if (v === null || v === undefined) return;
      exists[k] = true;
      if (!allowed(k)) { skipped++; return; }
      if (v.length > MAX_VALUE) { skipped++; return; }
      var ns = nsOf(k);
      (out[ns] = out[ns] || {})[k] = v;
    });

    var tomb = tombs();
    var now = Date.now();
    var changed = false;
    Object.keys(tomb).forEach(function (k) {
      if (now - tomb[k] > TOMB_KEEP) { delete tomb[k]; changed = true; return; }
      if (exists[k]) { delete tomb[k]; changed = true; return; }
      if (!allowed(k)) return;
      var ns = nsOf(k);
      out[ns] = out[ns] || {};                       // 模块可能已经没有其它键了
      (out[ns].__del = out[ns].__del || {})[k] = tomb[k];
    });
    if (changed) tombsSave(tomb);
    out.__skipped = skipped;
    return out;
  }

  /* 这个模块有没有「还没传上去的删除」 */
  function hasPendingDeletes(ns) {
    var tomb = tombs();
    var since = savedAt(ns);
    var found = false;
    Object.keys(tomb).forEach(function (k) {
      if (found) return;
      if (nsOf(k) !== ns) return;
      if (!allowed(k)) return;
      if (tomb[k] > since) found = true;
    });
    return found;
  }

  /* 应用云端某个模块（data 可能为空：只带删除） */
  function apply(data, cloudDel) {
    var n = 0;
    Object.keys(data || {}).forEach(function (k) {
      if (k === '__del') return;
      if (!allowed(k)) return;
      if (typeof data[k] === 'string') { set(k, data[k]); n++; }
    });
    if (cloudDel) {
      var local = tombs();
      Object.keys(cloudDel).forEach(function (k) {
        if (typeof cloudDel[k] !== 'number') return;
        if (local[k] && local[k] >= cloudDel[k]) return;
        var r = raw();
        if (r && r.get(k) !== null) { r.remove(k); }
        local[k] = cloudDel[k];
      });
      tombsSave(local);
    }
    return n;
  }

  /* 中转站 ID 失效（Gist 被删或重建）时，用 token 自己找回来：
     在该 token 名下的 Gist 里，找文件名以 sync-<用户名>- 开头的那一个。 */
  var healTried = false;
  function healGid(bad) {
    if (mode() === 'account' || !token() || healTried) return Promise.resolve('');
    healTried = true;
    return fetch('https://api.github.com/gists?per_page=100', { headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (list) {
        if (!list || !list.length) return '';
        var pre = 'sync-' + u() + '-';
        var hit = null;
        list.forEach(function (g) {
          if (hit) return;
          var names = Object.keys(g.files || {});
          for (var i = 0; i < names.length; i++) {
            if (names[i].indexOf(pre) === 0) { hit = g; break; }
          }
        });
        /* 兜底：只有一个 Gist 且里面确实是同步文件，才认它 */
        if (!hit && list.length === 1 && list[0].id !== bad) {
          var only = Object.keys(list[0].files || {});
          for (var j = 0; j < only.length; j++) {
            if (only[j].indexOf('sync-') === 0) { hit = list[0]; break; }
          }
        }
        if (!hit || hit.id === bad) return '';
        set(K_GID, JSON.stringify(hit.id));
        return hit.id;
      }).catch(function () { return ''; });
  }

  function api(path, method, body) {
    function req(p) {
      var opt = { method: method || 'GET', headers: headers() };
      if (body) opt.body = JSON.stringify(body);
      return fetch(apiBase() + p, opt).then(function (res) {
        return res.json().then(function (j) { return { ok: res.ok, status: res.status, json: j }; });
      });
    }
    return req(path).then(function (r) {
      /* 404 多半是中转站 ID 过期了，先试着找回来，再重试一次 */
      if (r.status !== 404 || mode() === 'account' || !token()) return r;
      return healGid(path).then(function (ng) {
        if (!ng || ng === path) return r;
        return req(ng);
      });
    });
  }

  function netError(r) {
    if (r.status === 401) return mode() === 'account' ? '账号验证失败，重新登录一下。' : 'token 失效了，去设置里重新填。';
    if (r.status === 404 && mode() !== 'account') return '中转站 ID 不对或已被删除，去设置里核对一下。';
    return '网络请求失败（' + r.status + '）。';
  }

  /* 上传：整份写上去；顺带把「已同步指纹」记成本地现在的内容 */
  function upload(local, nss, done) {
    var now = Date.now();
    var files = {};
    var hs = {};
    nss.forEach(function (ns) {
      files[fileName(ns)] = { content: JSON.stringify({ savedAt: now, data: local[ns] || {} }) };
      hs[ns] = fingerprint(local[ns] || {});
    });
    return api(gid(), 'PATCH', { files: files }).then(function (r) {
      if (!r.ok) return { ok: false, text: netError(r) };
      nss.forEach(function (ns) {
        set(hashKey(ns), hs[ns]);
        set(savedKey(ns), String(now));
        del(pendingKey(ns));
      });
      if (done) done(now);
      return { ok: true, text: '已上传 ' + nss.length + ' 个模块（' + nss.join('、') + '）', uploaded: nss };
    }).catch(function (e) { return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
  }

  /* 手动上传：只传本地有新改动的模块，不碰云端别的 */
  function push() {
    if (!ready()) return Promise.resolve({ ok: false, text: '还没连接云端。' });
    var local = collect();
    delete local.__skipped;
    var list = Object.keys(local).filter(function (ns) {
      return isPending(ns) || hasPendingDeletes(ns) || fingerprint(local[ns]) !== storedHash(ns);
    });
    if (!list.length) return Promise.resolve({ ok: true, text: '本地没有新改动，云端不用更新。' });
    return upload(local, list, markRun);
  }

  /* 手动下载：云端覆盖本地（调用方已确认） */
  function pull() {
    if (!ready()) return Promise.resolve({ ok: false, text: '还没连接云端。' });
    return api(gid(), 'GET').then(function (r) {
      if (!r.ok) return { ok: false, text: netError(r) };
      var files = r.json.files || {};
      var pre = 'sync-' + u() + '-';
      var got = [];
      Object.keys(files).forEach(function (name) {
        if (name.indexOf(pre) !== 0) return;
        var ns = name.slice(pre.length, -'.json'.length);
        var f = files[name];
        if (!f || !f.content) return;
        var cloud;
        try { cloud = JSON.parse(f.content); } catch (e) { return; }
        apply(cloud.data, cloud.data && cloud.data.__del);
        set(hashKey(ns), fingerprint(cloud.data || {}));
        set(savedKey(ns), String(cloud.savedAt || 0));
        got.push(ns);
      });
      markRun();
      if (!got.length) return { ok: true, text: '云端还没有数据。' };
      return { ok: true, text: '已用云端数据覆盖本地：' + got.join('、'), downloaded: got };
    }).catch(function (e) { return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
  }

  /* 自动比对一轮
   * opts.apply = 'auto'（打开页面时，直接应用并刷新）| 'prompt'（整点，只提示） */
  function autoRound(opts) {
    opts = opts || {};
    if (!ready()) return Promise.resolve({ ok: false, text: '还没连接云端。' });
    return api(gid(), 'GET').then(function (r) {
      if (!r.ok) return { ok: false, text: netError(r) };
      var files = r.json.files || {};
      var pre = 'sync-' + u() + '-';
      var local = collect();
      delete local.__skipped;
      var names = {};
      Object.keys(files).forEach(function (name) {
        if (name.indexOf(pre) !== 0) return;
        names[name.slice(pre.length, -'.json'.length)] = files[name];
      });
      Object.keys(local).forEach(function (ns) { if (!(ns in names)) names[ns] = null; });

      var toUpload = [], got = [], conflicts = [];
      Object.keys(names).forEach(function (ns) {
        var f = names[ns];
        var cloud = null;
        if (f && f.content) { try { cloud = JSON.parse(f.content); } catch (e) { cloud = null; } }
        var cloudView = (cloud && cloud.data) ? cloud.data : null;
        var cloudHash = cloudView ? fingerprint(cloudView) : '';
        var localHash = fingerprint(local[ns]);

        /* 云端还残留着不该同步的键（老版本传上去的密钥、聊天记录等） */
        var forbidden = !!cloudView && Object.keys(cloudView).some(function (k) {
          return k !== '__del' && !allowed(k);
        });

        /* 两边都动过 → 不悄悄覆盖，交给用户选 */
        var dirtyLocal = isPending(ns) || hasPendingDeletes(ns) ||
          (storedHash(ns) && localHash !== storedHash(ns));
        var cloudMoved = !!(cloud && cloud.savedAt && cloud.savedAt > savedAt(ns) + 1500);
        if (dirtyLocal && cloudMoved && cloudHash !== localHash) {
          conflicts.push({ ns: ns, cloud: cloud });
          return;
        }

        /* 删过键、还没传上去 → 先传删除，哪怕模块已经空了 */
        if (hasPendingDeletes(ns)) { toUpload.push(ns); return; }
        /* 云端文件没了 / 没内容，本地还有 → 补传，避免云端被删后一直空着 */
        if (!cloudView && !emptyView(local[ns])) { toUpload.push(ns); return; }

        if (cloudHash && cloudHash === localHash) {
          /* 内容一致，但云端有脏键 → 重传一份干净的把它盖掉 */
          if (forbidden) { toUpload.push(ns); return; }
          set(hashKey(ns), cloudHash);
          /* 记下「云端这个版本我看过了」，否则下一轮会把自己误判成「云端动过」 */
          if (cloud && cloud.savedAt) set(savedKey(ns), String(cloud.savedAt));
          del(pendingKey(ns));
          return;
        }
        if (isPending(ns)) { toUpload.push(ns); return; }
        /* 本地有没传的改动 → 上传（本地赢） */
        if (storedHash(ns) && localHash !== storedHash(ns)) { toUpload.push(ns); return; }
        if (cloudHash && cloudHash === localHash) { set(hashKey(ns), cloudHash); del(pendingKey(ns)); return; }
        if (isPending(ns)) { toUpload.push(ns); return; }

        if (!storedHash(ns)) {
          /* 第一次同步这个模块：云端有就以云端为准（新设备/新账号接入），
           * 云端没有才把本地这份传上去（老用户第一次开封云端） */
          if (cloudView) { got.push({ ns: ns, cloud: cloud, scrub: forbidden }); return; }
          if (!emptyView(local[ns])) { toUpload.push(ns); return; }
          return;
        }
        /* 本地没改、云端变了 → 下载（顺手记下这个模块云端有没有脏键要清） */
        if (cloudView) { got.push({ ns: ns, cloud: cloud, scrub: forbidden }); return; }
      });

      var finish = function (uploadResult) {
        var parts = [];
        if (uploadResult && uploadResult.text) parts.push(uploadResult.text);
        var auto = opts.apply === 'auto';

        /* 打开页面时直接应用 */
        if (auto && got.length) {
          got.forEach(function (g) {
            apply(g.cloud.data, g.cloud.data && g.cloud.data.__del);
            set(hashKey(g.ns), fingerprint(g.cloud.data || {}));
            set(savedKey(g.ns), String(g.cloud.savedAt || 0));
          });
          parts.push('下载 ' + got.map(function (g) { return g.ns; }).join('、'));
          var scrubNs = got.filter(function (g) { return g.scrub; }).map(function (g) { return g.ns; });
          if (scrubNs.length) {
            var fresh = collect();
            delete fresh.__skipped;
            return upload(fresh, scrubNs, null).then(finalize, finalize);
          }
        }
        return finalize();

        function finalize() {
          /* 两边都改：不替用户做决定，弹条让他选 */
          if (conflicts.length) {
            pendingConflicts = conflicts;
            showConflictBar(conflicts.map(function (c) { return c.ns; }));
            markRun();
            return {
              ok: true,
              text: (parts.length ? parts.join('；') + '；' : '') +
                conflicts.length + ' 个模块两边都改了，等你选',
              conflict: conflicts.map(function (c) { return c.ns; })
            };
          }
          if (auto) {
            markRun();
            if (!parts.length) return { ok: true, text: '两边一致，无需同步。' };
            return {
              ok: true, text: parts.join('；'),
              downloaded: got.map(function (g) { return g.ns; })
            };
          }
          /* 整点：只提示，等用户点了才写入 */
          if (got.length) {
            pendingUpdates = got;
            showUpdateBar(got.length);
            markRun();
            return {
              ok: true, text: '云端有 ' + got.length + ' 个模块更新，等你确认',
              pending: got.map(function (g) { return g.ns; })
            };
          }
          markRun();
          return { ok: true, text: parts.join('；') || '两边一致，无需同步。' };
        }
      };

      if (toUpload.length) {
        return upload(local, toUpload, markRun).then(function (ur) { return finish(ur); });
      }
      return finish(null);
    }).catch(function (e) { return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
  }

  /* 用户在提示条上点了「应用」：写入 + 刷新 */
  var pendingUpdates = [];
  function applyPending() {
    if (!pendingUpdates || !pendingUpdates.length) return false;
    pendingUpdates.forEach(function (g) {
      apply(g.cloud.data, g.cloud.data && g.cloud.data.__del);
      set(hashKey(g.ns), fingerprint(g.cloud.data || {}));
      set(savedKey(g.ns), String(g.cloud.savedAt || 0));
    });
    pendingUpdates = [];
    var bar = document.getElementById('wbSyncBar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    location.reload();
    return true;
  }

  /* ---------- 两边都改了：让用户选 ---------- */
  var pendingConflicts = [];
  var NS_LABEL = {
    life: '记账', notes: '笔记', time: '时间/课表', english: '英语',
    challenge: '挑战', __workbench: '设置'
  };
  function labelOf(ns) { return NS_LABEL[ns] || ns; }

  function showConflictBar(nss) {
    if (typeof document === 'undefined' || !document.body) return;
    var old = document.getElementById('wbSyncConflict');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var bar = document.createElement('div');
    bar.id = 'wbSyncConflict';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:9997;' +
      'display:flex;flex-wrap:wrap;align-items:center;gap:8px;max-width:92vw;padding:11px 14px;border-radius:14px;' +
      'background:#8a3f5a;color:#fff;font-size:13px;box-shadow:0 10px 30px rgba(60,20,35,.3);' +
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;';
    bar.innerHTML = '<span>两边都改过：' + nss.map(labelOf).join('、') + '</span>' +
      '<button id="wbSyncMine" style="border:0;border-radius:9px;padding:5px 10px;background:#fff;color:#8a3f5a;font-size:12px;cursor:pointer;">用我这台</button>' +
      '<button id="wbSyncTheirs" style="border:0;border-radius:9px;padding:5px 10px;background:rgba(255,255,255,.18);color:#fff;font-size:12px;cursor:pointer;">用云端的</button>' +
      '<button id="wbSyncLater" style="border:0;background:transparent;color:#f0c9d5;font-size:16px;cursor:pointer;line-height:1;">×</button>';
    document.body.appendChild(bar);
    var mine = document.getElementById('wbSyncMine');
    if (mine) mine.addEventListener('click', function () { resolveConflict('mine'); });
    var theirs = document.getElementById('wbSyncTheirs');
    if (theirs) theirs.addEventListener('click', function () { resolveConflict('theirs'); });
    var later = document.getElementById('wbSyncLater');
    if (later) later.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
  }

  function resolveConflict(which) {
    var list = pendingConflicts.slice();
    pendingConflicts = [];
    var bar = document.getElementById('wbSyncConflict');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (!list.length) return;
    if (which === 'mine') {
      var fresh = collect();
      delete fresh.__skipped;
      upload(fresh, list.map(function (c) { return c.ns; }), markRun);
      return;
    }
    list.forEach(function (c) {
      apply(c.cloud.data, c.cloud.data && c.cloud.data.__del);
      set(hashKey(c.ns), fingerprint(c.cloud.data || {}));
      set(savedKey(c.ns), String(c.cloud.savedAt || 0));
    });
    markRun();
    location.reload();
  }

  function ready() {
    if (mode() === 'account') return !!code() && !!user();
    return !!token() && !!gid();
  }

  /* 指纹算法换过（改成与键顺序无关）。升级时把本地现有内容记成基线，
   * 并给有数据的模块挂「待上传」，保证升级前后的本地改动不被云端盖掉。只做一次。 */
  var FP_VER = '3';
  function migrateFingerprints() {
    try {
      if (get('wb:sync:fpver') === FP_VER) return;
      var local = collect();
      delete local.__skipped;
      var ks = (raw() && raw().keys()) || [];
      var hadHash = null;   // 旧版本留下的基线；null = 全新设备或刚换账号
      ks.forEach(function (k) {
        if (k.indexOf('wb:sync:hash:') === 0) {
          if (hadHash === null) hadHash = k;
          del(k);
        } else if (k.indexOf('wb:sync:localat:') === 0) {
          del(k);
        }
      });
      Object.keys(local).forEach(function (ns) {
        if (emptyView(local[ns])) return;
        /* 只有「以前同步过」的模块才把现有内容记成基线。全新设备或刚换账号没有基线，
           留给首次同步按正常规则判断：云端有就下载，云端没有就把本地传上去。 */
        if (hadHash === null && !savedAt(ns)) return;
        set(hashKey(ns), fingerprint(local[ns]));
        if (savedAt(ns)) set(pendingKey(ns), '1');
      });
      set('wb:sync:fpver', FP_VER);
    } catch (e) {}
  }
  migrateFingerprints();

  /* ---------- 整点自动比对 ---------- */
  var lastTry = 0;
  var running = false;

  function nextHourAt() {
    var d = new Date();
    d.setMinutes(0, 2, 0);
    d.setHours(d.getHours() + 1);
    return d.getTime();
  }
  function missedHour() {
    var now = Date.now();
    var lr = lastRun();
    /* 时钟回拨 / 改时区：上次同步时间跑到未来 → 归零，立刻重新对一次 */
    if (lr > now + 60000) { markRun(0); lr = 0; }
    var d = new Date();
    d.setMinutes(0, 0, 0);
    var top = d.getTime();                        // 最近一个整点
    if (lr >= top) return false;                  // 这个整点已经跑过
    if (now - lastTry < RETRY_GAP) return false;  // 刚失败过，别连着敲
    return true;
  }

  var interacted = false;
  if (typeof document !== 'undefined') {
    ['pointerdown', 'keydown', 'input', 'touchstart', 'wheel'].forEach(function (t) {
      document.addEventListener(t, function () { interacted = true; }, true);
    });
  }

  function tick(applyMode) {
    if (running || !ready()) return;
    if (!missedHour()) return;
    running = true;
    lastTry = Date.now();
    autoRound({ apply: applyMode || 'prompt' }).then(function (r) {
      running = false;
      lastTry = Date.now();
      if (!r.ok) return;
      markRun();
      refreshState(r.text);
      if (applyMode === 'auto' && r.downloaded && r.downloaded.length) {
        /* 打开页面就拉到新数据：还没动手就刷一下，动手了就不打扰 */
        if (!interacted) location.reload();
      }
    });
  }

  function scheduleHour() {
    var wait = Math.max(2000, nextHourAt() - Date.now());
    setTimeout(function () {
      tick('prompt');
      scheduleHour();
    }, wait);
  }

  function boot() {
    if (typeof document === 'undefined' || !ready()) return;
    setTimeout(function () { tick('auto'); }, 1500);   // 打开页面：错过整点就先比对一次
    scheduleHour();                                   // 之后每个整点跑一轮
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick('prompt');           // 切回来补看一眼，仍受整点限制
    });
  }

  /* ---------- 云端有更新时的小提示条（不自动写入） ---------- */
  function showUpdateBar(n) {
    if (typeof document === 'undefined' || !document.body) return;
    var old = document.getElementById('wbSyncBar');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var bar = document.createElement('div');
    bar.id = 'wbSyncBar';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:9997;' +
      'display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:14px;' +
      'background:#5e4a9e;color:#fff;font-size:13px;box-shadow:0 10px 30px rgba(40,30,80,.28);' +
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;';
    bar.innerHTML = '<span>云端有 ' + (n || 1) + ' 处更新</span>' +
      '<button id="wbSyncBarGo" style="border:0;border-radius:9px;padding:5px 10px;background:#fff;color:#5e4a9e;font-size:12px;cursor:pointer;">应用并刷新</button>' +
      '<button id="wbSyncBarNo" style="border:0;background:transparent;color:#cfc7ec;font-size:16px;cursor:pointer;line-height:1;">×</button>';
    document.body.appendChild(bar);
    var go = document.getElementById('wbSyncBarGo');
    if (go) go.addEventListener('click', applyPending);
    var no = document.getElementById('wbSyncBarNo');
    if (no) no.addEventListener('click', function () { if (bar.parentNode) bar.parentNode.removeChild(bar); });
  }

  /* 连接：验证 token，可选绑已有中转站（传 gid），可选设用户名 */
  function connect(t, existingGid, userName) {
    t = (t || '').trim();
    if (!/^gh[pousr]_[A-Za-z0-9]{20,}$/.test(t)) return Promise.resolve({ ok: false, text: 'token 格式不对，应以 ghp_ 开头。' });
    var g = (existingGid || '').trim();
    var up = (userName || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    set(K_MODE, JSON.stringify(''));
    del(K_CODE);
    set(K_USER, JSON.stringify(up));
    set(K_TOKEN, JSON.stringify(t));
    if (g) {
      return api(g, 'GET').then(function (r) {
        if (r.status === 401) { del(K_TOKEN); return { ok: false, text: 'token 无效或没勾 gist 权限。' }; }
        if (!r.ok || !r.json.files) { del(K_TOKEN); return { ok: false, text: '找不到这个中转站（' + r.status + '），检查一下 ID。' }; }
        set(K_GID, JSON.stringify(g));
        return { ok: true, text: '已连上中转站。', id: g };
      }).catch(function (e) { del(K_TOKEN); return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
    }
    var seed = {};
    seed[fileName('_home')] = { content: '{"savedAt":0,"data":{}}' };
    return api('', 'POST', { description: '工作台数据同步（勿删）', public: false, files: seed })
      .then(function (r) {
        if (r.status === 401) { del(K_TOKEN); return { ok: false, text: 'token 无效或没勾 gist 权限。' }; }
        if (!r.ok || !r.json.id) { del(K_TOKEN); return { ok: false, text: '建中转站失败（' + r.status + '）：' + (r.json.message || '未知错误') }; }
        set(K_GID, JSON.stringify(r.json.id));
        return { ok: true, text: '连接成功，云端已建好。', id: r.json.id };
      })
      .catch(function (e) { del(K_TOKEN); return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
  }

  function unlink() {
    del(K_TOKEN); del(K_GID); del(K_USER); del(K_MODE); del(K_CODE); del(lastRunKey());
    var ks = (raw() && raw().keys()) || [];
    ks.forEach(function (k) {
      if (k.indexOf('wb:sync:savedAt:') === 0 || k.indexOf('wb:sync:hash:') === 0 || k.indexOf('wb:sync:pending:') === 0) del(k);
    });
  }

  /* 账号模式：注册 / 登录（网页走同源，桌面版问线上后台） */
  function accountAuth(name, codev, isRegister) {
    var n = (name || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
    var c = String(codev || '');
    if (!n) return Promise.resolve({ ok: false, text: '名字只能用字母、数字、- 和 _' });
    if (!/^\d{4}$/.test(c)) return Promise.resolve({ ok: false, text: '访问码是 4 位数字' });
    /* 网页版同源问自己的站点；桌面版（file://）才需要配置好的线上后台 */
    var acctBase = isWeb() ? '' : REMOTE;
    if (!isWeb() && !acctBase) {
      return Promise.resolve({ ok: false, text: '账号模式需要先配置同步服务器（shared/sync.js 里的 REMOTE），或者改用 token 模式。' });
    }
    return fetch(acctBase + '/api/account/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'workbench' },
      body: JSON.stringify({ action: isRegister ? 'register' : 'login', name: n, code: c })
    }).then(function (r) { return r.json(); }).then(function (j) {
      if (!j.ok) return { ok: false, text: j.text || '操作失败' };
      set(K_MODE, JSON.stringify('account'));
      set(K_USER, JSON.stringify(n));
      set(K_CODE, JSON.stringify(c));
      del(K_TOKEN); del(K_GID); del(lastRunKey());
      return { ok: true, text: j.text };
    }).catch(function (e) { return { ok: false, text: '网络不通：' + (e && e.message || e) }; });
  }

  function accountLogout() {
    del(K_MODE); del(K_CODE); del(K_USER); del(lastRunKey());
  }

  function status() {
    return {
      connected: ready(),
      mode: mode() === 'account' ? 'account' : (token() && gid() ? 'token' : ''),
      user: u(),
      savedAt: savedAt('__workbench'),
      lastRun: lastRun()
    };
  }

  global.WorkbenchSync = {
    connect: connect, push: push, pull: pull, autoRound: autoRound, applyPending: applyPending,
    resolveConflict: resolveConflict,
    unlink: unlink, status: status, collect: collect,
    accountAuth: accountAuth, accountLogout: accountLogout
  };

  /* ---------- 设置界面 ---------- */
  function fmtTime(ts) {
    if (!ts) return '还没同步过';
    var d = new Date(ts);
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function buildUI() {
    var body = document.querySelector('#settingsPanel .set-body');
    if (!body || document.getElementById('syncBlock')) return;
    var st = status();
    var block = document.createElement('div');
    block.className = 'set-block';
    block.id = 'syncBlock';
    block.innerHTML =
      '<h3>数据同步</h3>' +
      (st.connected
        ? '<p id="syncState">已连接（' + st.user + (st.mode === 'account' ? '，账号模式' : '') + '），上次同步：' + fmtTime(st.lastRun) + '</p>' +
          '<div class="set-row" style="margin-top:8px;">' +
          '<button id="btnSyncPush">立即上传</button>' +
          '<button id="btnSyncPull">立即下载</button>' +
          '<button id="btnSyncOff">退出' + (st.mode === 'account' ? '登录' : '绑定') + '</button></div>' +
          '<p class="dim" style="margin-top:6px;">改动只存本地。每个整点自动比对一次：本地有改动就上传，云端有新数据就提示你，点一下才应用；两边都改过会弹条让你选用哪边。其余时间不动云端，只有「立即下载」会直接覆盖本地。</p>' +
          (st.mode === 'account'
            ? '<p class="dim" style="margin-top:4px;">换设备登录：填同样的名字和访问码就行。忘了访问码找站长重置。</p>'
            : '')
        : '<p class="dim" style="margin-bottom:8px;">两种连法：有 token 就走下面「站长模式」；没有的话用「账号模式」，注册一个名字就行。</p>' +
          '<div class="set-row"><input id="syncUser" class="cfg-input" placeholder="你的名字（多人各填各的，留空就是 me）" style="flex:1;min-width:0;"></div>' +
          '<div class="set-row" style="margin-top:8px;"><input id="syncToken" class="cfg-input" type="password" placeholder="站长模式：粘贴 ghp_ 开头的 token" style="flex:1;min-width:0;"></div>' +
          '<div class="set-row" style="margin-top:8px;"><input id="syncGid" class="cfg-input" placeholder="中转站 ID（第一次连留空）" style="flex:1;min-width:0;"></div>' +
          '<div class="set-row" style="margin-top:8px;"><button id="btnSyncConn">连接云端（站长模式）</button></div>' +
          '<p class="dim" id="syncTip" style="margin-top:6px;"></p>' +
          '<div style="border-top:1px solid rgba(128,128,128,.25);margin:12px 0;"></div>' +
          '<p class="dim" style="margin-bottom:8px;">账号模式（朋友用）：起个名字 + 4 位访问码，之后在别的设备登录同一个名字就能互相同步。</p>' +
          '<div class="set-row"><input id="accName" class="cfg-input" placeholder="名字（字母或数字）" style="flex:1;min-width:0;"></div>' +
          '<div class="set-row" style="margin-top:8px;"><input id="accCode" class="cfg-input" type="password" placeholder="4 位数字访问码" maxlength="4" style="flex:1;min-width:0;"></div>' +
          '<div class="set-row" style="margin-top:8px;">' +
          '<button id="btnAccLogin">登录</button>' +
          '<button id="btnAccReg">注册新账号</button></div>' +
          '<p class="dim" id="accTip" style="margin-top:6px;">名字 + 4 位访问码就是账号，手机和电脑都填这一组，不用管 token。</p>');
    body.appendChild(block);

    function tip(msg) { var el = document.getElementById('syncTip'); if (el) el.textContent = msg; }

    var btnConn = document.getElementById('btnSyncConn');
    if (btnConn) btnConn.addEventListener('click', function () {
      btnConn.disabled = true;
      var uEl = document.getElementById('syncUser');
      var input = document.getElementById('syncToken');
      var g = document.getElementById('syncGid');
      if (!(g && g.value.trim()) && !(global.confirm && !global.confirm('「中转站 ID」留空的话，会新建一个全新的独立云端，跟你其他设备连的不是同一个，数据不会互通。\n\n如果是要接入已有的中转站，请点取消，把 ID 填上。\n确定要新建吗？'))) {
        btnConn.disabled = false;
        return;
      }
      tip('正在连接…');
      connect(input.value, g ? g.value : '', uEl ? uEl.value : '').then(function (r) {
        tip(r.text);
        if (r.ok) location.reload();
        else btnConn.disabled = false;
      });
    });

    var bp = document.getElementById('btnSyncPush');
    if (bp) bp.addEventListener('click', function () {
      bp.disabled = true;
      push().then(function (r) { bp.disabled = false; refreshState(r.text); });
    });

    var bl = document.getElementById('btnSyncPull');
    if (bl) bl.addEventListener('click', function () {
      if (hasLocalChanges() && global.confirm && !global.confirm('云端的数据会覆盖本地还没上传的改动，确定要下载吗？')) return;
      bl.disabled = true;
      pull().then(function (r) {
        bl.disabled = false;
        refreshState(r.text);
        if (r.ok && r.downloaded && r.downloaded.length) setTimeout(function () { location.reload(); }, 600);
      });
    });

    var bo = document.getElementById('btnSyncOff');
    if (bo) bo.addEventListener('click', function () {
      var off = function () { if (status().mode === 'account') accountLogout(); else unlink(); location.reload(); };
      if (!global.confirm || global.confirm('退出后云端数据还在，但本设备不再同步。确定？')) off();
    });

    var bl2 = document.getElementById('btnAccLogin');
    if (bl2) bl2.addEventListener('click', function () { accGo(false); });
    var br2 = document.getElementById('btnAccReg');
    if (br2) br2.addEventListener('click', function () { accGo(true); });
    function accGo(reg) {
      var n = document.getElementById('accName');
      var c = document.getElementById('accCode');
      var t = document.getElementById('accTip');
      t.textContent = '正在' + (reg ? '注册' : '登录') + '…';
      accountAuth(n.value, c.value, reg).then(function (r) {
        t.textContent = r.text;
        if (r.ok) { if (metaSet) metaSet('gateSolo', 0); location.reload(); }
      });
    }
  }

  // 账号登录成功后清掉「先自己用」的标记
  var metaSet = null;
  try {
    if (global.WorkbenchStore && global.WorkbenchStore.namespace) {
      var meta = global.WorkbenchStore.namespace('__workbench');
      metaSet = function (k, v) { meta.set(k, v); };
    }
  } catch (e) {}

  /* 本地有没有还没传上去的改动（给「立即下载」的确认框用） */
  function hasLocalChanges() {
    var local = collect();
    delete local.__skipped;
    return Object.keys(local).some(function (ns) {
      return isPending(ns) || hasPendingDeletes(ns) || fingerprint(local[ns]) !== storedHash(ns);
    });
  }

  function refreshState(msg) {
    var el = document.getElementById('syncState');
    if (!el) return;
    el.textContent = '已连接（' + status().user + '）' + (msg ? '，' + msg : '，上次同步：' + fmtTime(status().lastRun));
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { buildUI(); boot(); });
    else { buildUI(); boot(); }
  }
})(typeof window !== 'undefined' ? window : this);
