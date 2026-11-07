/* 首页逻辑：渲染卡片、记录每个模块的最近使用、设置面板 */
(function () {
  'use strict';

  var meta = WorkbenchStore.namespace('__workbench');
  var grid = document.getElementById('grid');
  var emptyHint = document.getElementById('emptyHint');
  /* 轮播当前停在第几张：记下来，下次打开还停在这 */
  var deckIndex = Math.max(0, Number(meta.get('deckIndex', 0)) || 0);

  function saveDeckIndex() {
    meta.set('deckIndex', deckIndex);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 卡片名字：设置里改过的优先 */
  function cardName(m) {
    var names = meta.get('cardNames', {}) || {};
    return (names[m.id] || '').trim() || m.name;
  }

  function render() {
    var modules = window.WORKBENCH_MODULES || [];
    var lastUsed = meta.get('lastUsed', {});
    grid.innerHTML = modules.map(function (m, i) {
      var ready = !!m.href;
      var used = lastUsed[m.id];
      var tags = (m.tags || []).map(function (t) {
        return '<span class="tag">' + escapeHtml(t) + '</span>';
      }).join('');
      return '<article class="card' + (ready ? '' : ' disabled') + '" data-id="' + escapeHtml(m.id) + '"' +
        ' data-href="' + escapeHtml(m.href || '') + '" data-i="' + i + '"' +
        ' style="--card-color:' + escapeHtml(m.color || '#00897b') + '">' +
        '<div class="card-top">' +
        '<span class="card-icon">' + escapeHtml(m.icon || '·') + '</span>' +
        (ready ? '' : '<span class="card-state">建设中</span>') +
        '</div>' +
        '<h2 class="card-name">' + escapeHtml(cardName(m)) + '</h2>' +
        '<p class="card-desc">' + escapeHtml(m.desc || '') + '</p>' +
        '<div class="card-tags">' + tags + '</div>' +
        '<div class="card-foot">' +
        '<span class="card-enter">' + (ready ? '进入 →' : '暂未开放') + '</span>' +
        (used ? '<span class="card-used">上次 ' + escapeHtml(used) + '</span>' : '') +
        '</div>' +
        '</article>';
    }).join('');
    emptyHint.style.display = modules.length ? 'none' : 'block';

    Array.prototype.forEach.call(grid.querySelectorAll('.card'), function (el) {
      el.addEventListener('click', function () {
        var href = el.dataset.href;
        if (!href) {
          flash(el);
          return;
        }
        /* 点的是旁边那张，先让它转到中间，不直接打开
         * 按索引判断而不是看类名，卡片在流动时类名一直在变
         */
        if (Number(el.dataset.i) !== deckIndex) {
          gotoDeck(Number(el.dataset.i));
          return;
        }
        saveDeckIndex();
        openModule(el.dataset.id, href);
      });
    });

    /* 只有卡片数超过 1 才需要轮播 */
    if (deckIndex >= modules.length) deckIndex = 0;
    if (deckIndex < 0) deckIndex = Math.max(0, modules.length - 1);
    layoutDeck();
  }

  /* ============ 卡片切换 ============
   * 手机版不做三维圆环，也不做自动流动。
   * 卡片横着排一行，当前那张居中，左右各露出一点边当提示。
   * 点左右箭头或下面的圆点切换，点当前这张才进入模块。
   */

  function deckModules() { return window.WORKBENCH_MODULES || []; }

  function deckStageWidth() {
    var stage = grid ? grid.parentNode : null;
    var w = stage ? stage.getBoundingClientRect().width : 0;
    if (!w) w = Math.min(window.innerWidth || 390, 420);
    return w;
  }

  /* 卡片宽度：别占满，左右要露出一点边 */
  function deckCardWidth() {
    var w = deckStageWidth();
    var cw = w * 0.78;
    if (cw > 320) cw = 320;
    if (cw < 200) cw = 200;
    return cw;
  }

  function layoutDeck() {
    if (!grid) return;
    var n = deckModules().length;
    if (!n) return;
    if (deckIndex >= n) deckIndex = 0;
    if (deckIndex < 0) deckIndex = n - 1;

    var cards = grid.querySelectorAll('.card');
    if (!cards.length) return;

    var cw = deckCardWidth();
    var gap = 12;

    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var off = i - deckIndex;
      var abs = Math.abs(off);
      var x = off * (cw + gap);

      el.style.position = 'absolute';
      el.style.top = '0';
      el.style.left = '50%';
      el.style.width = cw + 'px';
      el.style.height = '100%';
      el.style.marginLeft = '0px';
      el.style.transform = 'translateX(' + (x - cw / 2).toFixed(1) + 'px)';
      el.style.transition = 'transform .32s cubic-bezier(.4,0,.2,1), opacity .32s';
      el.style.opacity = abs > 1 ? '0' : (abs === 1 ? '0.5' : '1');
      el.style.zIndex = String(100 - abs);
      el.style.pointerEvents = abs > 1 ? 'none' : 'auto';

      if (off === 0) el.classList.add('is-center');
      else el.classList.remove('is-center');
    }

    renderDots();
    paintDots();
  }

  /* 圆点：有几张卡就几个点，当前那个亮 */
  function renderDots() {
    var box = document.getElementById('deckDots');
    if (!box) return;
    var n = deckModules().length;
    if (box.children.length === n) return;
    var html = '';
    for (var i = 0; i < n; i++) {
      html += '<button class="deck-dot" data-dot="' + i + '"></button>';
    }
    box.innerHTML = html;
  }

  function paintDots() {
    var box = document.getElementById('deckDots');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('.deck-dot'), function (d) {
      var i = Number(d.dataset.dot);
      if (i === deckIndex) d.classList.add('on');
      else d.classList.remove('on');
    });
  }

  function saveDeckIndex() {
    meta.set('deckIndex', deckIndex);
  }

  function gotoDeck(i) {
    var n = deckModules().length;
    if (!n) return;
    deckIndex = ((i % n) + n) % n;
    layoutDeck();
    saveDeckIndex();
  }

  function deckStep(delta) {
    gotoDeck(deckIndex + delta);
  }

  /* 这些名字以前给自动播放用，手机版没有自动播放，留着空实现免得别处调用报错 */
  function autoRest() {}
  function reflow() { layoutDeck(); }
  function startFlow() {}
  function advance() { deckStep(1); }
  function setAutoSec() {}

  function flash(el) {
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
  }

  function openModule(id, href) {
    var lastUsed = meta.get('lastUsed', {});
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    lastUsed[id] = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    meta.set('lastUsed', lastUsed);
    // 每个模块是独立页面，跳过去即可，互不影响
    location.href = href;
  }

  function setupSettings() {
    var panel = document.getElementById('settingsPanel');
    /* 页面顶部那个设置按钮已经去掉，只留左侧导航里的。
     * 这里判空，别让缺元素把后面整段初始化打断
     */
    var btnSettings = document.getElementById('btnSettings');
    if (btnSettings) {
      btnSettings.addEventListener('click', function () {
        panel.classList.toggle('show');
        if (panel.classList.contains('show')) { refreshSettings();; }
      });
    }
    var close = document.getElementById('settingsClose');
    if (close) close.addEventListener('click', function () { panel.classList.remove('show'); });

    window.__refreshSettings = refreshSettings;

    document.getElementById('btnExportAll').addEventListener('click', exportAll);
    document.getElementById('btnImportAll').addEventListener('click', function () {
      document.getElementById('importAllFile').click();
    });
    document.getElementById('importAllFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          importAll(String(reader.result || ''));
          alert('导入完成');
        } catch (err) {
          alert('导入失败：文件内容不是有效的备份。');
        }
        e.target.value = '';
        refreshSettings();
      };
      reader.readAsText(f, 'utf-8');
    });

  }

  function refreshSettings() {
    var box = document.getElementById('storeInfo');
    var names = { native: '本机应用存储', browser: '浏览器本地存储', memory: '临时内存（不保存）' };
    box.textContent = names[WorkbenchStore.backend] || WorkbenchStore.backend;
    var warn = document.getElementById('storeWarn');
    warn.style.display = WorkbenchStore.isMemoryOnly() ? 'block' : 'none';

    var list = document.getElementById('moduleData');
    var modules = window.WORKBENCH_MODULES || [];
    list.innerHTML = modules.map(function (m) {
      var ns = WorkbenchStore.namespace(m.id);
      var n = ns.keys().length;
      return '<li><span>' + escapeHtml(cardName(m)) + '</span>' +
        '<span class="dim">' + n + ' 项数据</span>' +
        '<button data-clear="' + escapeHtml(m.id) + '">清空</button></li>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('button[data-clear]'), function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.clear;
        var m = modules.filter(function (x) { return x.id === id; })[0];
        if (!confirm('确定清空「' + (m ? cardName(m) : id) + '」的全部数据吗？其他模块不受影响。')) return;
        WorkbenchStore.namespace(id).clear();
        refreshSettings();
      });
    });

    /* 卡片改名 */
    var rl = document.getElementById('renameList');
    if (rl) {
      var names = meta.get('cardNames', {}) || {};
      rl.innerHTML = modules.map(function (m) {
        return '<li class="rename-row">' +
          '<span class="rename-label">' + escapeHtml(m.name) + '</span>' +
          '<input type="text" data-rename="' + escapeHtml(m.id) + '" value="' + escapeHtml(names[m.id] || '') + '"' +
          ' placeholder="' + escapeHtml(m.name) + '">' +
          '<button data-rename-save="' + escapeHtml(m.id) + '">保存</button>' +
          '</li>';
      }).join('');
      Array.prototype.forEach.call(rl.querySelectorAll('button[data-rename-save]'), function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.dataset.renameSave;
          var input = rl.querySelector('input[data-rename="' + id + '"]');
          if (!input) return;
          var v = (input.value || '').trim();
          var namesNow = meta.get('cardNames', {}) || {};
          if (v) {
            namesNow[id] = v;
          } else {
            delete namesNow[id];
          }
          meta.set('cardNames', namesNow);
          render();
          layoutDeck();
          refreshSettings();
          var tip = document.getElementById('renameTip');
          if (tip) {
            var m = modules.filter(function (x) { return x.id === id; })[0];
            tip.textContent = v ? '已改成「' + v + '」' : '已恢复成「' + (m ? m.name : id) + '」';
            setTimeout(function () { tip.textContent = ''; }, 2000);
          }
        });
      });
      Array.prototype.forEach.call(rl.querySelectorAll('input[data-rename]'), function (input) {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            var btn = rl.querySelector('button[data-rename-save="' + input.dataset.rename + '"]');
            if (btn) btn.click();
          }
        });
      });
    }
  }

  function exportAll() {
    var modules = window.WORKBENCH_MODULES || [];
    var data = { app: 'workbench', version: 1, exportedAt: new Date().toISOString(), modules: {} };
    modules.forEach(function (m) { data.modules[m.id] = WorkbenchStore.namespace(m.id).dump(); });
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    a.href = url;
    a.download = '工作台备份-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importAll(text) {
    var data = JSON.parse(text);
    if (!data || !data.modules) throw new Error('格式不符');
    Object.keys(data.modules).forEach(function (id) {
      WorkbenchStore.namespace(id).load(data.modules[id]);
    });
  }

  /* ---------------- AI 对话区 ----------------
   *
   * 分两层：
   *   1. 本地回答：不联网，直接读各模块数据，常见问题自己能答；
   *   2. 模型回答：需要填接口地址和密钥，用本地文件打开时会被浏览器拦，
   *      做成应用后可用。
   */
  var aiNs = WorkbenchStore.namespace('__workbench');
  var AI_HISTORY_MAX = 8;

  function setupAI() {
    var bar = document.getElementById('aiBar');
    if (!bar) return;

    var input = document.getElementById('aiInput');
    var btn = document.getElementById('aiSendBtn');
    var dot = document.getElementById('aiDot');
    var stateEl = document.getElementById('aiState');
    var hint = document.getElementById('aiHint');
    var log = document.getElementById('aiLog');
    var ctxBox = document.getElementById('aiCtx');
    var ctxBody = document.getElementById('aiCtxBody');

    var cfg = aiNs.get('aiCfg', {}) || {};

    /* 部署到网上之后，密钥放在服务器上，网页这边什么都不用填。
     * 打开页面先问一句「服务器配好了吗」，配好了就走服务器，
     * 在电脑上直接打开页面（本地文件）问不到，就还用自己填的那套。 */
    var proxyState = { ready: false, model: '', checked: false };

    var probeTries = 0;
    var probing = null;

    function probeOnce() {
      return fetch('/api/ai', { method: 'GET' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j && j.ready) {
            proxyState.ready = true;
            proxyState.model = j.model || '';
          }
          return proxyState.ready;
        })
        .catch(function () { return false; });
    }

    /* 页面刚打开时网络可能还没就绪，问一次失败不能就下结论。
     * 失败就隔一会儿再问，最多问三次；还没成，等用户点发送时再问一次。
     */
    function probeProxy() {
      if (proxyState.ready) return Promise.resolve(true);
      if (probing) return probing;
      probing = probeOnce().then(function (ok) {
        probeTries++;
        if (ok) {
          proxyState.checked = true;
          probing = null;
          refreshState();
          return true;
        }
        if (probeTries < 3) {
          return new Promise(function (res) { setTimeout(res, 800 * probeTries); })
            .then(function () { probing = null; return probeProxy(); });
        }
        proxyState.checked = true;
        probing = null;
        refreshState();
        return false;
      });
      return probing;
    }

    var sh = window.__WORKBENCH_SHELL__;
    function refreshState() {
      /* 服务器配好了：手机上什么都不用填，直接用 */
      if (proxyState.ready) {
        dot.style.background = '#26a69a';
        stateEl.textContent = '已连接';
        hint.textContent = '可以问各模块的情况，也能让它帮你记账、加待办、加倒计时。';
      } else if (cfg.base && cfg.key && cfg.model) {
        dot.style.background = '#26a69a';
        stateEl.textContent = '已配置';
        hint.textContent = '可以问各模块的情况。已填好接口，但本地直接打开时浏览器会拦跨域请求。';
      } else {
        dot.style.background = '#7e57c2';
        stateEl.textContent = proxyState.checked ? '本地预览' : '检查中';
        hint.textContent = '现在只会根据你本地数据回答常见问题（花销、待办、倒计时、课表、各模块概况）。';
      }
      /* 顶上那行状态同步给输入框下面的小字 */
      var inlineEl = document.getElementById('aiStateInline');
      if (inlineEl) inlineEl.textContent = stateEl.textContent;
      /* 还在检查的时候，过一会儿再看一眼，别一直挂着「检查中」 */
      if (!proxyState.ready && !proxyState.checked) {
        setTimeout(refreshState, 1000);
      }
    }
    refreshState();

    function addMsg(role, text, bad) {
      var div = document.createElement('div');
      div.className = 'ai-msg ' + role + (bad ? ' bad' : '');
      var lbl = document.createElement('span');
      lbl.className = 'lbl';
      lbl.textContent = role === 'me' ? '你' : '助手';
      div.appendChild(lbl);
      div.appendChild(document.createTextNode(text));
      log.appendChild(div);
      /* 等排版完成再滚到底，免得滚不到位 */
      setTimeout(function () { log.scrollTop = log.scrollHeight; }, 0);
      return div;
    }

    function showCtx(text) {
      if (!text) { ctxBox.style.display = 'none'; return; }
      ctxBody.textContent = text;
      ctxBox.style.display = 'block';
    }

    /* -------- 本地回答 -------- */
    /* 本地预览直接复用工具层，保证不联网时给出的数字和模型走工具时看到的是同一套 */
    function viaTool(name, args) {
      try {
        if (!window.WorkbenchTools) return '';
        var r = window.WorkbenchTools.run(name, args || {});
        return (r && r.text) ? r.text : '';
      } catch (e) { return ''; }
    }

    function answerLocal(q) {
      var modules = window.WORKBENCH_MODULES || [];
      var life = WorkbenchStore.namespace('life');
      var text = q.toLowerCase();

      /* 时间记录要放在花销前面判断：
       * 「时间都花在哪了」带一个"花"字，先给花销那条会答成这个月花了多少钱。 */
      if (/时间记录|时间.*花|花.*时间|专注|坐在?桌前|学了多久/.test(q)) {
        var tScope = /本周|这周|一周/.test(q) ? 'week'
          : /本月|这个月/.test(q) ? 'month'
          : /全部|所有|一共/.test(q) ? 'all' : 'today';
        var tTxt = viaTool('query_time_records', { scope: tScope });
        if (tTxt) return tTxt;
      }

      /* 课表 */
      if (/课表|有课|上课|几节课|哪几节|什么课/.test(q)) {
        var scope = /明天/.test(q) ? 'tomorrow'
          : /本周|这周|整周|一周/.test(q) ? 'week' : 'today';
        var ttTxt = viaTool('query_timetable', { scope: scope });
        if (ttTxt) return ttTxt;
      }

      /* 花销相关 */
      if (/花|消费|支出|钱|账/.test(q)) {
        var exps = life.get('expenses', []) || [];
        if (!exps.length) return '还没有记账数据。去生活模块记几笔，或者把账本导入进来。';
        var now = new Date();
        var p = function (n) { return String(n).padStart(2, '0'); };
        var ym = now.getFullYear() + '-' + p(now.getMonth() + 1);
        var td = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());

        // 问某个类型花了多少，比如「吃饭花了多少」
        var cats = life.get('cats', []) || [];
        var hitCat = null;
        cats.forEach(function (c) {
          if (c && hitCat === null && q.indexOf(c) >= 0) hitCat = c;
        });
        if (hitCat === null) {
          // 用户自建的类型可能不在列表里，从已有记录里再找一遍
          exps.forEach(function (e) {
            if (hitCat === null && e.cat && q.indexOf(e.cat) >= 0) hitCat = e.cat;
          });
        }
        // 问法像「某某花了多少」但类型不存在时，要说清没有这类记录，不能拿总额糊弄
        if (hitCat === null && /(.{1,6}?)花(了)?多少/.test(q)) {
          var m = q.match(/(.{1,6}?)花(了)?多少/);
          var maybe = m ? m[1].replace(/^(这个月|上个月|上月|今天|今日|我|你|最近)/, '').trim() : '';
          if (maybe && !/^(钱|账|总共|一共|都|大概|约|实际)/.test(maybe)) {
            var known = [];
            exps.forEach(function (e) { if (e.cat && known.indexOf(e.cat) < 0) known.push(e.cat); });
            return '没有「' + maybe + '」这个类型，所以查不到。\n你现在的类型有：' + known.join('、') +
              '。\n如果要记这类支出，可以去生活模块的「管理类型」里加一个。';
          }
        }

        if (hitCat !== null) {
          var scope = /上个月|上月/.test(q) ? lastMonthKey(now) : ym;
          var catExp = exps.filter(function (e) { return e.cat === hitCat && String(e.date).indexOf(scope) === 0; });
          var scopeName = scope === ym ? '这个月' : (Number(scope.slice(5)) + '月');
          if (!catExp.length) return scopeName + '还没有「' + hitCat + '」的记录。';
          var catSum = catExp.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
          var allSum = exps.filter(function (e) { return String(e.date).indexOf(scope) === 0; })
            .reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
          var pct = allSum > 0 ? Math.round(catSum / allSum * 100) : 0;
          return scopeName + '「' + hitCat + '」花了 ' + fmtMoney(catSum) + ' 元，共 ' + catExp.length +
            ' 笔，占全部的 ' + pct + '%。';
        }

        if (/上个月|上月/.test(q)) {
          var lm = lastMonthKey(now);
          var lmExp = exps.filter(function (e) { return String(e.date).indexOf(lm) === 0; });
          if (!lmExp.length) return '上个月还没有记账。';
          var lmSum = lmExp.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
          var lmDays = new Date(Number(lm.slice(0, 4)), Number(lm.slice(5)), 0).getDate();
          return (Number(lm.slice(5))) + '月花了 ' + fmtMoney(lmSum) + ' 元，共 ' + lmExp.length +
            ' 笔，日均 ' + fmtMoney(lmSum / lmDays) + ' 元。';
        }

        if (/今天|今日/.test(q)) {
          var te = exps.filter(function (e) { return e.date === td; });
          var ts = te.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
          if (!te.length) return '今天还没有记账。';
          var byCat = {};
          te.forEach(function (e) { byCat[e.cat] = (byCat[e.cat] || 0) + Number(e.amount || 0); });
          var parts = Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; })
            .map(function (c) { return c + ' ' + fmtMoney(byCat[c]) + ' 元'; });
          return '今天花了 ' + fmtMoney(ts) + ' 元，共 ' + te.length + ' 笔。' +
            (parts.length > 1 ? '\n主要用途：' + parts.join('，') : '');
        }

        var me = exps.filter(function (e) { return String(e.date).indexOf(ym) === 0; });
        var ms = me.reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
        if (!me.length) return '这个月还没有记账。';
        var bc = {};
        me.forEach(function (e) { bc[e.cat] = (bc[e.cat] || 0) + Number(e.amount || 0); });
        var top = Object.keys(bc).sort(function (a, b) { return bc[b] - bc[a]; }).slice(0, 3)
          .map(function (c) { return c + ' ' + fmtMoney(bc[c]) + ' 元'; });
        // 日均分两种：按自然天数，和按实际有记账的天数，后者更贴近感受
        var days = now.getDate();
        var activeDays = {};
        me.forEach(function (e) { activeDays[e.date] = 1; });
        var actN = Object.keys(activeDays).length;
        return (now.getMonth() + 1) + '月花了 ' + fmtMoney(ms) + ' 元，共 ' + me.length +
          ' 笔。\n按天数算日均 ' + fmtMoney(ms / days) + ' 元；' +
          (actN < days ? '只在有记账的 ' + actN + ' 天算，日均 ' + fmtMoney(ms / actN) + ' 元。\n' : '\n') +
          '花得比较多的是：' + top.join('，');
      }

      // 待办相关
      if (/待办|要做|任务|安排/.test(q)) {
        var todos = life.get('todos', []) || [];
        var open = todos.filter(function (t) { return !t.done; });
        if (!open.length) return '没有未完成的待办，都清完了。';
        var lines = open.slice(0, 8).map(function (t) {
          return '· ' + t.text + (t.due ? '（' + t.due + '）' : '');
        });
        return '还有 ' + open.length + ' 件待办：\n' + lines.join('\n') +
          (open.filter(function (t) { return t.due; }).length ? '\n带日期的是有截止时间的。' : '');
      }

      // 倒计时
      if (/倒计时|还剩|几天|距离/.test(q)) {
        var cds = life.get('cds', []) || [];
        if (!cds.length) return '还没有设置倒计时。去生活模块加一个，比如交房租、生日。';
        return '你设置了 ' + cds.length + ' 个倒计时：\n' +
          cds.map(function (c) {
            var t = { once: '一次性', monthly: '每月', yearly: '每年', weekly: '每周' }[c.type] || '';
            return '· ' + c.name + '（' + t + '）' + (c.date ? ' ' + c.date : '');
          }).join('\n') + '\n具体还剩几天，打开生活模块的倒计时页看最准。';
      }

      // 规划。注意规划早就从生活搬到时间管理了，这里必须读 time 命名空间，
      // 读 life 永远是空的（以前就是这个错，问"我的规划"一直答"还没有写规划"）。
      if (/规划|计划/.test(q)) {
        var planTxt = viaTool('query_plans', {});
        if (planTxt) return planTxt;
      }

      // 随手记和情绪精力
      if (/随手记|灵感|记了什么|记了些|情绪|精力|心情/.test(q)) {
        var noteTxt = viaTool('query_notes', {});
        if (noteTxt) return noteTxt;
      }

      // 随机挑战
      if (/挑战/.test(q)) {
        var chTxt = viaTool('query_challenges', {});
        if (chTxt) return chTxt;
      }

      // 模块概况
      if (/概况|概览|情况|有什么|哪些模块|总结/.test(q)) {
        var items = window.WorkbenchSummary ? WorkbenchSummary.collect(modules) : [];
        if (!items.length) return '各模块还没有数据。';
        return '现在的整体情况：\n' + items.map(function (it) { return fmtBlock(it); }).join('\n\n');
      }

      // 兜底
      var all = window.WorkbenchSummary ? WorkbenchSummary.collect(modules) : [];
      return '没听明白这句。不联网时我能答这些：\n' +
        '· 花销：「这个月花了多少」「今天花了多少」「吃饭花了多少」「上个月花了多少」\n' +
        '· 待办：「还有什么没做」\n' +
        '· 课表：「今天有课吗」「明天有什么课」「本周课表」\n' +
        '· 时间记录：「今天时间花在哪了」「本周时间记录」\n' +
        '· 随手记和情绪：「我记了什么」「最近情绪怎么样」\n' +
        '· 挑战、倒计时、规划、模块概况\n\n' +
        '现在的整体情况：\n' + (all.length ? all.map(function (it) { return fmtBlock(it); }).join('\n\n') : '还没有数据。') +
        '\n\n要能自由提问，在设置里填接口地址即可（本地直接打开时浏览器可能拦下请求）。';
    }

    // 每个模块占一行，模块名加粗位置在前，后面跟完整摘要
    function fmtBlock(it) {
      return '【' + it.name + '】' + String(it.text).trim();
    }

    // 上个月的年月，比如 2026-09
    function lastMonthKey(now) {
      var y = now.getFullYear(), m = now.getMonth();
      if (m === 0) { m = 12; y -= 1; }
      return y + '-' + String(m).padStart(2, '0');
    }

    function fmtMoney(n) {
      var v = Math.round(Number(n) * 100) / 100;
      if (!isFinite(v)) return '0';
      return v % 1 === 0 ? String(v) : String(parseFloat(v.toFixed(2)));
    }

    /* -------- 模型回答 -------- */
    function buildMessages(question) {
      var modules = window.WORKBENCH_MODULES || [];
      var ctx = window.WorkbenchSummary ? WorkbenchSummary.asPrompt(modules) : '';
      var sys = (cfg.system || '').trim() ||
        '你是我的工作台助手，根据下面的数据回答我的问题。回答简短直接，用中文，不要编造数据里没有的内容。';

      /* 告诉模型它还能查数据、加东西 */
      var toolHint = '';
      if (window.WorkbenchTools) {
        toolHint = '\n\n你还能调用这些工具来查数据或者加东西：\n' + WorkbenchTools.promptText() +
          '\n\n需要调用工具时，只输出一行 JSON，不要有别的话：\n' +
          '{"tool":"工具名","args":{"参数名":"值"}}\n' +
          '不需要调用工具时，直接用中文回答。一次只调一个工具。';
      }

      var msgs = [{ role: 'system', content: sys + '\n\n' + ctx + toolHint }];
      var hist = aiNs.get('aiHistory', []) || [];
      hist.slice(-AI_HISTORY_MAX).forEach(function (h) {
        msgs.push({ role: h.role, content: h.content });
      });
      msgs.push({ role: 'user', content: question });
      return { messages: msgs, ctx: ctx };
    }

    /* 从模型输出里找出工具调用，找不到返回 null */
    function parseToolCall(text) {
      if (!text) return null;
      var s = String(text).trim();
      /* 去掉可能的代码块包裹 */
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      var m = s.match(/\{[\s\S]*\}/);
      if (!m) return null;
      var obj = null;
      try { obj = JSON.parse(m[0]); } catch (e) { return null; }
      if (!obj || !obj.tool || typeof obj.tool !== 'string') return null;
      return { tool: obj.tool, args: obj.args || {} };
    }

    /* 调一次模型，拿回文字 */
    function callModel(messages) {
      /* 还没确认服务器可用的话，先问一下再决定走哪条路 */
      if (!proxyState.ready && !proxyState.checked) {
        return probeProxy().then(function () { return callModel(messages); });
      }

      /* 服务器配好了就直接发给自己站点，密钥不进网页 */
      if (proxyState.ready) {
        return fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: cfg.model || proxyState.model,
            messages: messages,
            temperature: 0.3
          })
        }).then(function (resp) {
          if (!resp.ok) {
            return resp.text().then(function (t) {
              var msg = String(t || '');
              try { var o = JSON.parse(msg); if (o && o.error) msg = o.error; } catch (e) {}
              throw new Error('服务器返回 ' + resp.status + '：' + msg.slice(0, 200));
            });
          }
          return resp.json();
        }).then(function (data) {
          var content = '';
          try { content = data.choices[0].message.content; } catch (e) { content = ''; }
          return content || '';
        });
      }

      var base = (cfg.base || '').replace(/\/+$/, '');
      var url = base + '/chat/completions';
      var payload = { model: cfg.model, messages: messages, temperature: 0.3 };
      var sh = window.__WORKBENCH_SHELL__;

      /* 桌面版：请求交给外壳从主进程发出去。
       * 页面里直连的时候，file:// 和自定义来源都会被跨域拦，主进程发不受这个限制。 */
      if (sh && sh.desktop && sh.aiPost) {
        return sh.aiPost(url, {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        }, JSON.stringify(payload), 90000).then(function (r) {
          if (!r) throw new Error('接口没有回应。');
          if (!r.ok) throw new Error('接口返回 ' + r.status + '：' + String(r.text || '').slice(0, 200));
          var data = {};
          try { data = JSON.parse(r.text); } catch (e) {
            throw new Error('接口返回的不是 JSON：' + String(r.text || '').slice(0, 120));
          }
          var content = '';
          try { content = data.choices[0].message.content; } catch (e) { content = ''; }
          return content || '';
        });
      }

      return fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + cfg.key
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: messages,
          temperature: 0.3
        })
      }).then(function (resp) {
        if (!resp.ok) {
          return resp.text().then(function (t) {
            throw new Error('接口返回 ' + resp.status + '：' + t.slice(0, 200));
          });
        }
        return resp.json();
      }).then(function (data) {
        var content = '';
        try { content = data.choices[0].message.content; } catch (e) { content = ''; }
        return content || '';
      });
    }

    function askModel(question) {
      var built = buildMessages(question);
      showCtx(built.ctx);

      var waiting = addMsg('bot', '正在问模型…');
      btn.disabled = true;

      callModel(built.messages).then(function (content) {
        if (waiting.parentNode) waiting.parentNode.removeChild(waiting);
        if (!content) {
          addMsg('bot', '模型没有返回内容。', true);
          return;
        }

        /* 模型想调工具：执行完把结果再交给它说人话 */
        var call = parseToolCall(content);
        if (call && window.WorkbenchTools) {
          var res = WorkbenchTools.run(call.tool, call.args);
          var done = addMsg('bot', res.ok ? '（已执行：' + toolLabel(call.tool) + '）' : '（没做成：' + res.text + '）', !res.ok);

          /* 让模型用这次结果来回答 */
          var msgs2 = built.messages.concat([
            { role: 'assistant', content: content },
            { role: 'user', content: '工具返回结果：' + res.text + '\n请根据这个结果用中文简短回答我。' }
          ]);
          return callModel(msgs2).then(function (finalText) {
            if (finalText) {
              var p = parseToolCall(finalText);
              addMsg('bot', p ? res.text : finalText);
              saveHistory(question, p ? res.text : finalText);
            } else {
              addMsg('bot', res.text);
              saveHistory(question, res.text);
            }
            /* 数据变了要刷新首页卡片 */
            if (res.changed) refreshAfterChange();
          });
        }

        addMsg('bot', content);
        saveHistory(question, content);
      }).catch(function (err) {
        if (waiting.parentNode) waiting.parentNode.removeChild(waiting);
        var msg = String(err && err.message || err);
        if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
          addMsg('bot', (window.__WORKBENCH_SHELL__ && window.__WORKBENCH_SHELL__.desktop)
            ? '请求发不出去。检查一下接口地址、密钥和网络，也可能是接口那边不接受这个请求。'
            : '请求发不出去。多半是浏览器拦下了跨域请求，用本地文件直接打开时很常见。' +
              '做成应用后再用这个功能。', true);
        } else {
          addMsg('bot', msg, true);
        }
      }).then(function () {
        btn.disabled = false;
      });
    }

    function toolLabel(name) {
      var t = {
        query_expenses: '查花销', query_todos: '查待办', query_plans: '查行程',
        query_countdowns: '查倒计时',
        query_timetable: '查课表', query_time_records: '查时间记录',
        query_notes: '查随手记', query_challenges: '查挑战',
        add_todo: '加待办', add_expense: '记一笔', add_plan: '加行程',
        add_plan_step: '加步骤', add_note: '记灵感', add_countdown: '加倒计时'
      };
      return t[name] || name;
    }

    function saveHistory(q, a) {
      var hist = aiNs.get('aiHistory', []) || [];
      hist.push({ role: 'user', content: q });
      hist.push({ role: 'assistant', content: a });
      aiNs.set('aiHistory', hist.slice(-AI_HISTORY_MAX * 2));
    }

    /* 工具改了数据，首页卡片上的摘要要跟着变 */
    function refreshAfterChange() {
      try {
        if (window.WorkbenchSummary) {
          var modules = window.WORKBENCH_MODULES || [];
          showCtx(WorkbenchSummary.asPrompt(modules));
        }
        render();
      } catch (e) { /* 刷新失败不影响主流程 */ }
    }

    function send() {
      var q = input.value.trim();
      if (!q) return;
      addMsg('me', q);
      input.value = '';
      input.style.height = 'auto';

      /* 服务器配好了就用服务器，手机上什么都不用填；
       * 服务器没配（比如在电脑上本地打开）才看自己填没填过。 */
      var configured = proxyState.ready || (cfg.base && cfg.key && cfg.model);
      if (configured) {
        /* 历史统一由 askModel 里的 saveHistory 记。
         * 这里以前又记了一遍提问，结果每问一句历史里就多一条重复的 user 消息，
         * 下次把历史发给模型时上下文是乱的。 */
        askModel(q);
      } else {
        var ans = answerLocal(q);
        addMsg('bot', ans);
        saveHistory(q, ans);
        var modules = window.WORKBENCH_MODULES || [];
        showCtx(window.WorkbenchSummary ? WorkbenchSummary.asPrompt(modules) : '');
      }
    }

    input.addEventListener('input', function () {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    btn.addEventListener('click', send);

    /* 底下的快捷提问：点一下直接问 */
    Array.prototype.forEach.call(document.querySelectorAll('.ai-chip'), function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.dataset.ask || chip.textContent;
        send();
      });
    });

    // 上下文展示开关
    var ctxOpen = false;
    var toggleBtn = document.getElementById('aiCtxToggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        ctxOpen = !ctxOpen;
        ctxBody.style.display = ctxOpen ? 'none' : 'block';
        toggleBtn.textContent = ctxOpen ? '展开' : '收起';
      });
    }

    /* -------- 设置面板 -------- */
    var panel = document.getElementById('aiCfgPanel');

    /* 清空对话：屏幕上的记录和存起来的历史一起清，免得旧历史把新问题带偏 */
    var clearLogBtn = document.getElementById('aiClearLog');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', function () {
        log.innerHTML = '';
        aiNs.remove('aiHistory');
        ctxBox.style.display = 'none';
        addMsg('bot', '对话记录清空了。');
      });
    }

    function openCfg() {
      document.getElementById('cfgBase').value = cfg.base || '';
      document.getElementById('cfgKey').value = cfg.key || '';
      document.getElementById('cfgModel').value = cfg.model || '';
      document.getElementById('cfgSystem').value = cfg.system || '';
      panel.classList.add('show');
    }
    document.getElementById('aiCfgBtn').addEventListener('click', openCfg);
    document.getElementById('aiCfgClose').addEventListener('click', function () {
      panel.classList.remove('show');
    });

    document.getElementById('cfgSave').addEventListener('click', function () {
      cfg = {
        base: document.getElementById('cfgBase').value.trim(),
        key: document.getElementById('cfgKey').value.trim(),
        model: document.getElementById('cfgModel').value.trim(),
        system: document.getElementById('cfgSystem').value.trim()
      };
      aiNs.set('aiCfg', cfg);
      refreshState();
      document.getElementById('cfgStatus').textContent = '已保存。';
    });

    document.getElementById('cfgClear').addEventListener('click', function () {
      cfg = { base: cfg.base || '', key: '', model: cfg.model || '', system: cfg.system || '' };
      aiNs.set('aiCfg', cfg);
      aiNs.remove('aiHistory');
      document.getElementById('cfgKey').value = '';
      refreshState();
      document.getElementById('cfgStatus').textContent = '已清除密钥和对话记录。';
    });

    document.getElementById('cfgTest').addEventListener('click', function () {
      var statusEl = document.getElementById('cfgStatus');
      var base = document.getElementById('cfgBase').value.trim().replace(/\/+$/, '');
      var key = document.getElementById('cfgKey').value.trim();
      var model = document.getElementById('cfgModel').value.trim();
      if (!base || !key || !model) { statusEl.textContent = '地址、密钥、模型名都要填。'; return; }
      statusEl.textContent = '正在测试…';

      var sh = window.__WORKBENCH_SHELL__;
      var testPayload = JSON.stringify({ model: model, messages: [{ role: 'user', content: '你好' }], max_tokens: 10 });

      function showFail(status, text) {
        var tip = '';
        if (status === 401 || status === 403) tip = '密钥不对或者过期了。';
        else if (status === 404) tip = '地址或模型名不对，检查地址结尾是不是少了 /v1，或者这个名字没有这个模型。';
        else if (status === 429) tip = '请求太频繁，或者额度用完了。';
        else if (status >= 500) tip = '对方服务器出问题了，过会儿再试。';
        statusEl.textContent = '连不上，返回 ' + status + '。' + tip + ' 原始回应：' + String(text || '').slice(0, 120);
      }

      /* 桌面版走外壳发，不受跨域限制 */
      if (sh && sh.desktop && sh.aiPost) {
        sh.aiPost(base + '/chat/completions', {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        }, testPayload, 30000).then(function (r) {
          if (!r) { statusEl.textContent = '没有收到回应，检查一下地址。'; return; }
          if (r.ok) { statusEl.textContent = '连上了，配置可用。'; return; }
          if (r.status === 0) { statusEl.textContent = String(r.text || '请求发不出去。'); return; }
          showFail(r.status, r.text);
        });
        return;
      }

      fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: testPayload
      }).then(function (r) {
        if (r.ok) { statusEl.textContent = '连上了，配置可用。'; return; }
        r.text().then(function (t) { showFail(r.status, t); });
      }).catch(function () {
        statusEl.textContent = '请求发不出去。最常见的原因是跨域被拦：本地直接打开网页时，接口那边必须允许这种来源。换个允许跨域的接口，或者等做成应用。';
      });
    });

    /* 打开页面就问一句服务器配好没有 */
    probeProxy();
  }

  function setupClock() {
    var el = document.getElementById('clock');
    var days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    function tick() {
      var d = new Date();
      var p = function (n) { return String(n).padStart(2, '0'); };
      el.textContent = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
        days[d.getDay()] + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    tick();
    setInterval(tick, 30000);
  }

  /* ---------------- 桌面版专属 ----------------

  /* ---------------- 左侧模块导航 ----------------
   * 导航栏本体在 shared/rail.js 里，首页和所有模块页共用同一份。
   * 这里只负责把它初始化起来，并且让高亮跟着轮播走。
   */
  function setupRail() {
    /* 导航栏由 shared/rail.js 自己初始化，这里不用再调 */
  }

  /* 轮播停下来时，同步导航栏的高亮 */
  function syncRailActive() {
    var modules = window.WORKBENCH_MODULES || [];
    var cur = modules[deckIndex];
    if (cur && window.WorkbenchRail) WorkbenchRail.paint(cur.id);
  }

  render();
  setupRail();
  setupAI();
  setupSettings();
  setupClock();
  if (window.WorkbenchSide) {
    WorkbenchSide.init();
  }
  /* 概览现在挪进了导航里，元素在导航内部。
   * 等布局稳定后再渲染一次，保证内容一定填上
   */
  setTimeout(function () {
    if (window.WorkbenchSide) WorkbenchSide.renderAll();
  }, 0);

  /* 轮播的左右按钮和键盘方向键 */

  document.addEventListener('keydown', function (e) {
    /* 在输入框里打字时不要触发翻页 */
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') deckStep(-1);
    else if (e.key === 'ArrowRight') deckStep(1);

  });
  /* 圆点右边那两个换卡箭头 */
  var arrowPrev = document.getElementById('deckArrowPrev');
  var arrowNext = document.getElementById('deckArrowNext');
  if (arrowPrev) arrowPrev.addEventListener('click', function () { deckStep(-1); });
  if (arrowNext) arrowNext.addEventListener('click', function () { deckStep(1); });

  /* 点圆点直接跳到那张 */
  var dotsWrap = document.getElementById('deckDots');
  if (dotsWrap) {
    dotsWrap.addEventListener('click', function (e) {
      var d = e.target.closest ? e.target.closest('.deck-dot') : null;
      if (!d || d.dataset.dot === undefined) return;
      gotoDeck(Number(d.dataset.dot));
    });
  }

  /* 转屏或者改窗口大小时重新排一次，卡片宽度是按舞台算的 */
  var resizeTimer = null;
  window.addEventListener('resize', function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { layoutDeck(); }, 120);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { layoutDeck(); }, 200);
  });

  /* AI 区：平时只有一条输入框，点展开铺满整屏看长对话 */
  var aiBar = document.getElementById('aiBar');
  var aiCollapse = document.getElementById('aiCollapse');
  function setAiOpen(on) {
    if (!aiBar) return;
    if (on) {
      aiBar.classList.add('ai-open');
      document.documentElement.style.overflow = 'hidden';
      setTimeout(function () {
        var log = document.getElementById('aiLog');
        if (log) log.scrollTop = log.scrollHeight;
      }, 30);
    } else {
      aiBar.classList.remove('ai-open');
      document.documentElement.style.overflow = '';
    }
  }
  /* 手机版没有单独的全屏对话，直接在输入框问，回答显示在下面 */
  var aiCfgQuick = document.getElementById('aiCfgQuick');
  var aiStateInline = document.getElementById('aiStateInline');
  var aiStateMain = document.getElementById('aiState');
  if (aiStateInline && aiStateMain) {
    aiStateInline.textContent = aiStateMain.textContent;
  }
  if (aiCfgQuick) {
    aiCfgQuick.addEventListener('click', function () {
      setAiOpen(true);
      var btnCfg = document.getElementById('aiCfgBtn');
      if (btnCfg) btnCfg.click();
    });
  }
  if (aiCollapse) aiCollapse.addEventListener('click', function () { setAiOpen(false); });
  var aiInputEl = document.getElementById('aiInput');
  if (aiInputEl) {
    /* 手机版不自动全屏：直接在这儿打字就能问，回答显示在卡片下面 */
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && aiBar && aiBar.classList.contains('ai-open')) setAiOpen(false);
  });
})();
