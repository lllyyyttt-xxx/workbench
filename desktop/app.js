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
  /* 首页顶上那一条「今天」：课、待办、倒计时、番茄，
   * 打开就能知道今天要干什么，不用点进模块 */
  function renderToday() {
    var bar = document.getElementById('todayBar');
    if (!bar) return;

    var t;
    try {
      if (!window.WorkbenchTools) return;
      t = WorkbenchTools.todayData();
    } catch (e) { return; }

    var now = new Date();
    var hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    var nextC = null;
    t.courses.forEach(function (c) {
      if (!nextC && c.end && hm <= c.end) nextC = c;
    });

    var cells = [];

    if (!t.courses.length) {
      cells.push({ k: '今天', v: '没课', s: '第 ' + t.week + ' 周' });
    } else if (nextC) {
      cells.push({ k: '接下来', v: nextC.name, s: nextC.start + '-' + nextC.end + (nextC.room ? ' · ' + nextC.room : '') });
    } else {
      cells.push({ k: '今天', v: '课都上完了', s: '共 ' + t.courses.length + ' 节 · 第 ' + t.week + ' 周' });
    }

    cells.push({
      k: '待办',
      v: t.todosOpen ? t.todosOpen + ' 条没做' : '都做完了',
      s: t.todosDue ? '今天到期 ' + t.todosDue + ' 条' : '今天没有到期的'
    });

    cells.push(t.countdown
      ? { k: '最近的', v: t.countdown.name, s: '还有 ' + t.countdown.days + ' 天' }
      : { k: '倒计时', v: '还没设', s: '想要就去生活模块加一个' });

    var fm = t.focusMinutes || 0;
    var fh = fm >= 60 ? (Math.round(fm / 6) / 10) + ' 小时' : fm + ' 分钟';
    cells.push({
      k: '今天专注',
      v: t.focus ? t.focus + ' 个番茄' : '还没开始',
      s: t.focus ? '共 ' + fh : '去时间管理开一个'
    });

    bar.innerHTML = cells.map(function (c) {
      return '<div class="today-cell">' +
        '<div class="today-k">' + escapeHtml(c.k) + '</div>' +
        '<div class="today-v" title="' + escapeHtml(c.v) + '">' + escapeHtml(c.v) + '</div>' +
        (c.s ? '<div class="today-s">' + escapeHtml(c.s) + '</div>' : '') +
        '</div>';
    }).join('');
  }

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

  /* ============ 3D 圆环轮播 ============
   * 七张卡片立在一个圆环的圆周上，圆环绕竖轴转。
   * 每张卡片按自己的角度算出位置、朝向，然后自己再反向转一点，
   * 让朝观众的那张永远正面朝前。
   *
   * 角度怎么算：第 i 张在圆上占 (i - deckPos) * (360/n) 度，
   * deckPos 是小数所以能连续转，不会一格一格跳。
   */
  var RING_RADIUS = 760;        /* 圆的半径，越大越平，越小越立 */
  /* 七张卡每张占 51 度，侧边那张投影宽度必然被压到一半多，
   * 这是几何决定的，不是 bug。所以让侧面那张早点淡掉，
   * 只保留正面和略侧的两张清楚，转过去的就虚化。
   */
  var VIEW_LIMIT = 78;          /* 超过这个角度就基本看不见了 */

  function lerp(a, b, t) { return a + (b - a) * t; }

  /* 当前环的半径：容器窄的时候要收一收，别让两侧卡片跑出去 */
  function ringRadius(n) {
    var w = grid ? grid.getBoundingClientRect().width : 0;
    if (!w) w = 1100;
    /* 让最边上那张（朝侧面 90 度）也落在容器里 */
    var maxR = Math.max(220, w / 2 - 60);
    return Math.min(RING_RADIUS, maxR);
  }

  /* 卡片在该位置的样式：位置、朝向、透明度 */
  function styleForAngle(deg, n, radius) {
    /* 归一化到 -180 ~ 180，0 表示正对观众 */
    var a = ((deg + 180) % 360 + 360) % 360 - 180;
    var rad = a * Math.PI / 180;

    /* 圆上的位置：sin 给横向，cos 给纵深 */
    var x = Math.sin(rad) * radius;
    var z = Math.cos(rad) * radius - radius;   /* 以最前面那张为 0 */

    /* 朝向：卡片自己转 -a，就正面朝观众 */
    var facing = -a;

    /* 越往侧面越暗。七张卡角度大，侧边那张已经压得很扁，
     * 所以提前淡出，别让它像一块纸片侧着插在那
     */
    var absA = Math.abs(a);
    var alpha;
    if (absA <= 30) {
      alpha = 1 - (absA / 30) * 0.12;                    /* 正面 1，30 度 0.88 */
    } else if (absA <= VIEW_LIMIT) {
      alpha = 0.88 * (1 - (absA - 30) / (VIEW_LIMIT - 30));  /* 渐渐淡出 */
    } else {
      alpha = 0;
    }

    return {
      x: x, z: z, facing: facing, alpha: alpha,
      hidden: absA > VIEW_LIMIT,
      /* 侧面那张稍微缩一点，增加纵深 */
      scale: 1 - (absA / 90) * 0.1
    };
  }

  /* 渲染时用的连续位置（小数），自动流动时每帧变一点点 */
  var deckPos = deckIndex;
  var deckRaf = null;
  var deckFlow = false;        /* 此刻是不是在按帧直写位置 */

  function layoutDeck() {
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.card'));
    var n = cards.length;
    if (!n) return;

    var prevBtn = document.getElementById('deckPrev');
    var nextBtn = document.getElementById('deckNext');
    var single = n <= 1;
    if (prevBtn) prevBtn.style.visibility = single ? 'hidden' : 'visible';
    if (nextBtn) nextBtn.style.visibility = single ? 'hidden' : 'visible';

    var radius = ringRadius(n);
    /* 卡片少的时候别按 360/n 摆：5 张会摆到 72 度，侧面那张淡到几乎看不见。
     * 固定 46 度间距，只显示正负两张，看起来才像"环形"而不是"一张卡"。 */
    var step = n <= 5 ? 46 : 360 / n;

    cards.forEach(function (card) {
      var i = Number(card.dataset.i);
      /* 这张卡在圆上的角度：用小数位置算，所以转起来是连续的 */
      var d = i - deckPos;
      if (n <= 5) {
        /* 取环上最近的一侧，否则倒着翻会绕一大圈 */
        d = ((d + n / 2) % n + n) % n - n / 2;
      }
      var deg = d * step;
      var st = styleForAngle(deg, n, radius);

      if (deckFlow) card.style.transition = 'none';
      else card.style.transition = '';

      /* 先平移到圆上的位置，再按朝向转，最后缩一点 */
      card.style.transform =
        'translate3d(' + st.x.toFixed(2) + 'px, 0, ' + st.z.toFixed(2) + 'px) ' +
        'rotateY(' + st.facing.toFixed(2) + 'deg) ' +
        'scale(' + st.scale.toFixed(4) + ')';
      card.style.opacity = st.alpha.toFixed(3);

      /* 类名只用来挂阴影、判断"哪张算中间"
       * 中间那张按整数索引判断，不能用角度——卡片一直在转，
       * 角度常常落在两张之间，那时候一张都不算中间，点卡片就失效了
       */
      card.classList.remove('is-center', 'is-near-l', 'is-near-r', 'is-far-l', 'is-far-r', 'is-hidden');
      var a = ((deg + 180) % 360 + 360) % 360 - 180;
      if (st.hidden) {
        card.classList.add('is-hidden');
      } else if (i === deckIndex) {
        card.classList.add('is-center');
      } else if (Math.abs(a) < 60) {
        card.classList.add(a < 0 ? 'is-near-l' : 'is-near-r');
      } else {
        card.classList.add(a < 0 ? 'is-far-l' : 'is-far-r');
      }
      card.style.visibility = st.hidden ? 'hidden' : '';
      /* 越靠前的层级越高 */
      card.style.zIndex = String(st.hidden ? 1 : Math.round(100 + st.z / 10));
      card.style.pointerEvents = st.hidden ? 'none' : 'auto';
    });

    /* 底下的小圆点 */
    var dotsBox = document.getElementById('deckDots');
    if (dotsBox) {
      if (dotsBox.children.length !== n) {
        dotsBox.innerHTML = cards.map(function (card, i) {
          return '<button class="deck-dot" data-dot="' + i + '"></button>';
        }).join('');
        Array.prototype.forEach.call(dotsBox.querySelectorAll('[data-dot]'), function (b) {
          b.addEventListener('click', function () {
            gotoDeck(Number(b.dataset.dot));
            autoRest();
          });
        });
      }
      var near = ((Math.round(deckPos) % n) + n) % n;
      Array.prototype.forEach.call(dotsBox.children, function (b, i) {
        b.classList.toggle('on', i === near);
      });
    }

    /* 左侧导航跟着高亮 */
    syncRailActive();
  }

  /* 跳到某一张（手动点圆点用），带过渡 */
  function gotoDeck(i) {
    deckFlow = false;
    deckIndex = i;
    deckPos = i;
    saveDeckIndex();
    layoutDeck();
  }

  /* 往左往右翻
   * 流动到一半时手动翻页，从当前停的位置直接挪一张，不会跳回去
   */
  function deckStep(delta) {
    var n = grid.querySelectorAll('.card').length;
    if (n <= 1) return;
    deckPos = deckPos + delta;
    deckIndex = ((Math.round(deckPos) % n) + n) % n;
    saveDeckIndex();
    layoutDeck();
  }

  /* ---------------- 卡片自动流动 ----------------
   *
   * 卡片一直在缓慢往前滑，像一条不停转的带子，不是翻一下停一会儿。
   * 用小数位置每帧推进，配合 requestAnimationFrame，所以是连贯的。
   *
   * 档位是"一张卡片走多久"：慢 40 秒、中 28 秒、快 18 秒。
   * 这个秒数是走过一整张卡的时间，不是停顿间隔。
   *
   * 什么时候停下来：
   *   1. 鼠标停在轮播区上（想看的时候别动）
   *   2. AI 输入框正在打字
   *   3. 页面切到后台
   * 用户手动翻过之后，先停 3 秒让人看清，再继续流。
   */
  /* 档位是"走完一整张卡片用几秒"：慢 3 秒、中 2 秒、快 1 秒
   * 用户觉得原来的 40/28/18 太慢，明确要求最慢也是 3 秒一个
   */
  var FLOW_LEVELS = [0, 3, 2, 1];
  var FLOW_REST = 3000;                          /* 手动翻过之后停多久（毫秒） */

  var autoSec = Number(meta.get('deckAuto', 3));
  if (FLOW_LEVELS.indexOf(autoSec) < 0) autoSec = 3;

  var autoRestUntil = 0;
  var autoHover = false;
  var autoTyping = false;
  var flowLast = 0;
  var flowRaf = null;

  function autoEnabled() { return autoSec > 0; }

  function autoPausedNow() {
    return !autoEnabled() || autoHover || autoTyping || document.hidden || Date.now() < autoRestUntil;
  }

  /* 每秒走多少个卡片位 */
  function flowSpeed() {
    if (!autoEnabled()) return 0;
    return 1 / autoSec;
  }

  /* 下一次检查延迟多久（毫秒），验证脚本用得到 */
  function autoDelayNext() {
    if (!autoEnabled()) return 0;
    var left = autoRestUntil - Date.now();
    if (left > 0) return left;
    return Math.round(autoSec * 1000 / 60);
  }

  /* 动画帧接口，老环境或测试环境里可能没有，兜底成定时器 */
  var RAF = (typeof requestAnimationFrame === 'function')
    ? function (fn) { return requestAnimationFrame(fn); }
    : function (fn) { return setTimeout(function () { fn(Date.now()); }, 16); };
  var CAF = (typeof cancelAnimationFrame === 'function')
    ? function (id) { cancelAnimationFrame(id); }
    : function (id) { clearTimeout(id); };

  function autoClear() {
    if (flowRaf) { CAF(flowRaf); flowRaf = null; }
  }

  /* 一帧一帧往前推 */
  function flowFrame(ts) {
    flowRaf = null;
    if (autoPausedNow()) { deckFlow = false; flowLast = 0; return; }

    if (!flowLast) flowLast = ts;
    var dt = Math.min(ts - flowLast, 100);   /* 卡顿或切后台回来别一下跳太远 */
    flowLast = ts;

    deckFlow = true;
    deckPos += flowSpeed() * (dt / 1000);
    /* 位置太大就绕回来，避免数字越滚越大 */
    var n = grid.querySelectorAll('.card').length || 1;
    while (deckPos >= n) deckPos -= n;
    deckIndex = ((Math.round(deckPos) % n) + n) % n;

    layoutDeck();
    flowRaf = RAF(flowFrame);
  }

  function startFlow() {
    autoClear();
    flowLast = 0;
    if (autoPausedNow()) { deckFlow = false; return; }
    flowRaf = RAF(flowFrame);
  }

  /* 状态变了就重新评估要不要流动 */
  function reflow() {
    if (autoPausedNow()) {
      autoClear();
      deckFlow = false;
    } else if (!flowRaf) {
      startFlow();
    }
  }

  /* 用户手动动过：先停一会儿，再继续流 */
  function autoRest() {
    autoRestUntil = Date.now() + FLOW_REST;
    autoClear();
    deckFlow = false;
    layoutDeck();
    reflow();
    if (autoRestUntil > Date.now()) {
      setTimeout(function () { reflow(); }, FLOW_REST + 30);
    }
  }

  function setAutoSec(v) {
    autoSec = Number(v);
    if (FLOW_LEVELS.indexOf(autoSec) < 0) autoSec = 40;
    autoRestUntil = 0;
    meta.set('deckAuto', autoSec);
    deckFlow = false;
    layoutDeck();
    reflow();
    /* 共享设置面板里的档位高亮同步一下 */
    if (window.WorkbenchSettings) { try { WorkbenchSettings.refresh(); } catch (e) {} }
  }

  /* 直接推进一段位置，验证脚本用它模拟时间流逝，不用真等 */
  function advance(seconds) {
    if (autoPausedNow()) return false;
    deckFlow = true;
    deckPos += flowSpeed() * seconds;
    var n = grid.querySelectorAll('.card').length || 1;
    while (deckPos >= n) deckPos -= n;
    deckIndex = ((Math.round(deckPos) % n) + n) % n;
    layoutDeck();
    return true;
  }

  function setupAutoDeck() {
    /* 鼠标停在卡片上不再暂停流动（用户要求去掉这条）
     * autoHover 保留但一直是 false，其它判断不用改
     */
    autoHover = false;

    /* 点卡片、手动翻页都先停一下 */
    grid.addEventListener('click', function () { autoRest(); });
    var prevBtn = document.getElementById('deckPrev');
    var nextBtn = document.getElementById('deckNext');
    if (prevBtn) prevBtn.addEventListener('click', function () { autoRest(); });
    if (nextBtn) nextBtn.addEventListener('click', function () { autoRest(); });
    var dotsBox = document.getElementById('deckDots');
    if (dotsBox) dotsBox.addEventListener('click', function () { autoRest(); });

    /* AI 输入框：只有真正在打字才停，停手 3 秒自动恢复（点进去不算打字） */
    var aiInput = document.getElementById('aiInput') || document.getElementById('aiAsk');
    if (aiInput) {
      var aiTypingTimer = null;
      aiInput.addEventListener('input', function () {
        autoTyping = true;
        reflow();
        if (aiTypingTimer) clearTimeout(aiTypingTimer);
        aiTypingTimer = setTimeout(function () {
          autoTyping = false;
          reflow();
        }, 3000);
      });
      aiInput.addEventListener('blur', function () {
        if (aiTypingTimer) { clearTimeout(aiTypingTimer); aiTypingTimer = null; }
        autoTyping = false;
        reflow();
      });
    }

    /* 切到后台停，切回来接着流 */
    document.addEventListener('visibilitychange', function () {
      deckFlow = false;
      reflow();
    });

    /* 从别的页面退回来也要先停一下 */
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) autoRest();
    });

    /* 页面滚动时也能一直流，不用额外处理 */
    startFlow();
  }

  /* 给验证脚本用 */
  window.WorkbenchDeck = {
    get index() { return deckIndex; },
    get pos() { return deckPos; },
    get autoSec() { return autoSec; },
    get enabled() { return autoEnabled(); },
    get paused() { return autoPausedNow(); },
    get flowing() { return !!flowRaf; },
    step: deckStep,
    goto: gotoDeck,
    setAutoSec: setAutoSec,
    rest: autoRest,
    advance: advance,
    delayNext: autoDelayNext,
    setHover: function (v) { autoHover = !!v; reflow(); },
    setTyping: function (v) { autoTyping = !!v; reflow(); },
    clear: function () { autoClear(); deckFlow = false; },
    /* 让页面回到静止状态，验证脚本收尾用
     * 只清暂停状态和位置，不动用户选的档位
     */
    settle: function () {
      autoRestUntil = 0;
      autoHover = false;
      autoTyping = false;
      deckFlow = false;
      deckPos = deckIndex;
      layoutDeck();
      startFlow();
    }
  };

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

    var cfg = aiNs.get('aiCfg', {}) || {};

    /* 联网对话默认走自己的服务器：密钥放在服务端，用户端什么都不用填。
     *
     * 【重要】开源版这里故意留空。填上你自己的站点地址，就等于把 AI 额度
     * 免费开放给所有下载这个项目的人——他们的每次提问都会算在你账上。
     * 想开箱即用，请自己部署 netlify/functions/ai.js 并配置 AI_KEY，
     * 再把这一行改成你的域名，例如 'https://你的站点.netlify.app'。
     * 留空时自动退回用户在「设置」里填的接口，或用本地数据回答。 */
    var AI_REMOTE = '';
    var remoteReady = false;

    var sh = window.__WORKBENCH_SHELL__;
    function refreshState() {
      if (remoteReady) {
        dot.style.background = '#26a69a';
        stateEl.textContent = '已连接';
        hint.textContent = '开箱即用，不用填地址和密钥。可以问各模块的情况，也能让它帮你记账、加待办、加倒计时。';
        return;
      }
      if (cfg.base && cfg.key && cfg.model) {
        dot.style.background = '#26a69a';
        stateEl.textContent = '已配置';
        hint.textContent = (sh && sh.desktop)
          ? '可以问各模块的情况，也能让它帮你记账、加待办、加倒计时。'
          : '可以问各模块的情况。已填好接口，但在本地直接打开时浏览器会拦下请求，做成应用后才能真正联网回答。';
      } else {
        dot.style.background = '#7e57c2';
        stateEl.textContent = '本地预览';
        hint.textContent = (sh && sh.desktop)
          ? '现在只会根据你本地数据回答常见问题（花销、待办、倒计时、课表、各模块概况）。点右上角「设置」填接口地址就能真正联网对话。'
          : '现在只会根据你本地数据回答常见问题（花销、待办、倒计时、各模块概况）。点右上角「设置」填接口地址，做成应用后可以真正联网对话。';
      }
    }
    refreshState();

    /* 启动时问一句服务器能不能用。能的话就不用用户填任何东西。
     * 桌面版是 file:// 页面，直连会被拦，所以交给主进程发。 */
    function probeRemote() {
      if (!AI_REMOTE) return;   /* 没配服务器就不探活，直接用本地模式 */
      var s = window.__WORKBENCH_SHELL__;
      function set(v) { if (!v) return; remoteReady = true; refreshState(); }
      if (s && s.desktop && s.aiPost) {
        s.aiPost(AI_REMOTE + '/api/ai', { 'Content-Type': 'application/json' },
          JSON.stringify({ messages: [], probe: true }), 15000).then(function (r) {
          if (!r || !r.ok) return;
          var j = {};
          try { j = JSON.parse(r.text); } catch (e) { return; }
          set(!!j.ready);
        })['catch'](function () { /* 连不上就安静退回本地模式 */ });
        return;
      }
      fetch(AI_REMOTE + '/api/ai', { method: 'GET' }).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (j) { set(!!(j && j.ready)); })['catch'](function () {});
    }
    probeRemote();

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

    function showCtx() { /* 已下线：不再展示发送给模型的数据 */ }

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

      /* 长期记忆：它自己攒下来的关于我的事，能对上就用 */
      var memTxt = window.WorkbenchMemory ? WorkbenchMemory.promptText() : '';

      /* 告诉模型它能干什么，以及几条硬规矩 */
      var toolHint = '';
      if (window.WorkbenchTools) {
        toolHint =
          '\n\n你能调用下面这些工具。它们按用途分组，标了（会改数据）的会先弹确认条：\n' +
          WorkbenchTools.promptText() +
          '\n\n调用规则：\n' +
          '1. 要调用工具时，只输出一行 JSON，别写别的字：\n' +
          '   {"tool":"工具名","args":{"参数名":"值"}}\n' +
          '   一轮里要连着做几件事，就一次给一串：\n' +
          '   {"calls":[{"tool":"A","args":{}},{"tool":"B","args":{}}]}\n' +
          '2. 只读工具会立刻执行，直接把结果给你。会改数据的工具我会先弹确认条，\n' +
          '   你只管把参数写具体：哪门课、星期几、第几节、改到什么，别含糊。\n' +
          '3. 最多来回四轮。四轮还没做完就直接给结论，别硬撑。\n' +
          '4. 打招呼、闲聊、问概念、问你是谁，一律不要调工具，直接用中文聊。\n' +
          '5. 改完数据要用一句话说清改了什么，比如「已经把周三的 Web 前端挪到周五 5-8 节」。\n' +
          '6. 数据里没有的不要编。算不出来的就直说，别拿假数字凑。\n' +
          '7. 碰到你不知道、或者会过时的信息——考试时间、放假安排、新闻、比分、价格、某个东西的最新情况——' +
          '先用 web_search 查，别凭印象答。查到具体日期要建倒计时就直接建，日期用搜到的；' +
          '搜不到就说明没查到，绝不编一个日期出来。';
      }

      var msgs = [{ role: 'system', content: sys + '\n\n' + ctx + memTxt + toolHint }];
      var hist = aiNs.get('aiHistory', []) || [];
      hist.slice(-AI_HISTORY_MAX).forEach(function (h) {
        msgs.push({ role: h.role, content: h.content });
      });
      msgs.push({ role: 'user', content: question });
      return { messages: msgs, ctx: ctx };
    }

    /* 从模型输出里找出工具调用。两种写法都认：
     *   {"tool":"x","args":{}}              一次一个
     *   {"calls":[{"tool":"x","args":{}}, …]}  一次一串
     */
    function parseCalls(text) {
      if (!text) return [];
      var s = String(text).trim();
      /* 去掉可能的代码块包裹 */
      s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      var m = s.match(/\{[\s\S]*\}/);
      if (!m) return [];
      var obj = null;
      try { obj = JSON.parse(m[0]); } catch (e) { return []; }
      if (!obj) return [];

      var raw = [];
      if (Array.isArray(obj.calls)) raw = obj.calls;
      else if (obj.tool) raw = [obj];

      return raw.filter(function (c) {
        return c && typeof c.tool === 'string';
      }).map(function (c) {
        return { tool: c.tool, args: c.args || {} };
      });
    }

    /* -------- 多轮工具调用 -------- */

    /* 一轮问答最多来回几次，防止它自己绕圈把 token 烧光 */
    var MAX_ROUNDS = 4;

    /* 当前这轮问答的状态，跨多次模型调用复用 */
    var turn = null;
    /* 正在等用户点确认的那一条 */
    var pendingConfirm = null;

    var confirmBox = document.getElementById('aiConfirm');
    var confirmBody = document.getElementById('aiConfirmBody');
    var undoRow = document.getElementById('aiUndo');
    var undoText = document.getElementById('aiUndoText');

    /* 改动回显：单独一行绿的，扫一眼就知道它改了什么 */
    function addNote(text, tone) {
      var div = document.createElement('div');
      div.className = 'ai-note' + (tone ? ' ' + tone : '');
      div.textContent = text;
      log.appendChild(div);
      setTimeout(function () { log.scrollTop = log.scrollHeight; }, 0);
      return div;
    }

    /* 底下的撤销条：有可撤的东西才出现 */
    function paintUndoRow() {
      if (!undoRow) return;
      if (!window.WorkbenchUndo) { undoRow.style.display = 'none'; return; }
      var last = WorkbenchUndo.last();
      if (!last) { undoRow.style.display = 'none'; return; }
      undoRow.style.display = 'flex';
      undoText.textContent = '上一次改动：' + last.label;
    }

    function clearWaiting() {
      if (turn && turn.waiting && turn.waiting.parentNode) {
        turn.waiting.parentNode.removeChild(turn.waiting);
      }
      if (turn) turn.waiting = null;
    }

    function showConfirm(call, preview, rest) {
      pendingConfirm = { call: call, rest: rest };
      if (confirmBody) confirmBody.textContent = preview.text || preview.plan || '（没写出具体要改什么）';
      if (confirmBox) confirmBox.style.display = 'block';
      clearWaiting();
    }

    function hideConfirm() {
      if (confirmBox) confirmBox.style.display = 'none';
      pendingConfirm = null;
    }

    /* 用户点了同意 / 算了 */
    function answerConfirm(agree) {
      var p = pendingConfirm;
      if (!p || !turn) { hideConfirm(); return; }
      hideConfirm();

      if (!agree) {
        addNote('你取消了：' + toolLabel(p.call.tool), 'dim');
        turn.results.push({ tool: p.call.tool, ok: false, text: '我取消了这次改动，没执行' });
        runCalls(p.rest, 0);
        return;
      }

      var r = window.WorkbenchTools.run(p.call.tool, p.call.args, { confirmed: true });
      if (r && typeof r.then === 'function') {
        r.then(function (x) {
          if (!turn) return;
          if (x.pending) { showConfirm(p.call, x, p.rest); return; }
          recordResult(p.call, x);
          runCalls(p.rest, 0);
        });
        return;
      }
      if (r.pending) { showConfirm(p.call, r, p.rest); return; }
      recordResult(p.call, r);
      runCalls(p.rest, 0);
    }

    function recordResult(call, r) {
      turn.results.push({ tool: call.tool, ok: r.ok !== false, text: r.text });

      if (r.changed) {
        addNote('✓ ' + (r.plan || r.text));
        refreshAfterChange();
        paintUndoRow();
      } else if (r.ok === false) {
        addNote('× ' + r.text, 'bad');
      }
    }

    /* 顺着一个数组往下跑；碰到要确认的就停下来等。
     * 工具可以是同步的，也可以返回 Promise（联网搜索就得等网络），
     * 所以这里用「指针 + 回调续跑」的写法，不能简单 for 循环。 */
    function runCalls(calls, from) {
      if (!turn) return;
      var i = from;

      function step() {
        if (!turn) return;
        for (; i < calls.length; i++) {
          var c = calls[i];
          var r = window.WorkbenchTools
            ? window.WorkbenchTools.run(c.tool, c.args)
            : { ok: false, text: '工具层没加载起来。' };

          if (r && typeof r.then === 'function') {
            var idx = i;
            r.then(function (res) {
              if (!turn) return;
              if (res.pending) { showConfirm(calls[idx], res, calls.slice(idx + 1)); return; }
              recordResult(calls[idx], res);
              i = idx + 1;
              step();
            }, function (e) {
              if (!turn) return;
              recordResult(calls[idx], { ok: false, text: '执行出错：' + String((e && e.message) || e) });
              i = idx + 1;
              step();
            });
            return;
          }

          if (r.pending) {
            showConfirm(c, r, calls.slice(i + 1));
            return;
          }
          recordResult(c, r);
        }
        continueWithResults();
      }

      step();
    }

    /* 把这一批结果交回模型，让它用中文说人话 */
    function continueWithResults() {
      if (!turn) return;
      if (!turn.results.length) { finishTurn('做完了。'); return; }

      var lines = turn.results.map(function (r) {
        return (r.ok ? '成功' : '失败') + '｜' + r.text;
      });
      turn.results = [];

      turn.base.push({
        role: 'user',
        content: '工具执行结果：\n' + lines.join('\n') + '\n按规则用中文简短回答我，说清改了什么。'
      });
      stepModel();
    }

    function stepModel() {
      if (!turn) return;

      if (turn.round >= MAX_ROUNDS) {
        finishTurn('这轮已经做到上限，上面是做完的部分。还想继续就再说一句。');
        return;
      }
      turn.round++;

      callModel(turn.base).then(function (content) {
        if (!turn) return;
        if (!content) { finishTurn('模型没有返回内容。'); return; }

        var calls = parseCalls(content);
        if (!calls.length) { finishTurn(content); return; }

        /* 把模型这轮的原始输出接进上下文，后面把工具结果一起交给它 */
        turn.base.push({ role: 'assistant', content: content });
        runCalls(calls, 0);
      }).catch(function (err) {
        failTurn(err);
      });
    }

    function finishTurn(text) {
      clearWaiting();
      if (!turn) return;
      var q = turn.question;
      turn = null;

      addMsg('bot', text);
      saveHistory(q, text);
      btn.disabled = false;
      paintUndoRow();
    }

    function failTurn(err) {
      clearWaiting();
      var msg = String((err && err.message) || err);
      if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
        msg = (window.__WORKBENCH_SHELL__ && window.__WORKBENCH_SHELL__.desktop)
          ? '请求发不出去。检查一下接口地址、密钥和网络，也可能是接口那边不接受这个请求。'
          : '请求发不出去。多半是浏览器拦下了跨域请求，用本地文件直接打开时很常见。做成应用后再用这个功能。';
      }
      if (turn) {
        var q = turn.question;
        turn = null;
        addMsg('bot', msg, true);
        saveHistory(q, msg);
      } else {
        addMsg('bot', msg, true);
      }
      btn.disabled = false;
    }

    /* 调一次模型，拿回文字 */
    function callModel(messages) {
      var shell = window.__WORKBENCH_SHELL__;
      var localOk = !!(cfg.base && cfg.key && cfg.model);

      /* 走自己的服务器：服务端拿密钥去问上游，用户不用配任何东西 */
      function viaRemote() {
        var payload = { messages: messages, temperature: 0.3 };
        if (cfg.model) payload.model = cfg.model;
        var req;
        if (shell && shell.desktop && shell.aiPost) {
          req = shell.aiPost(AI_REMOTE + '/api/ai',
            { 'Content-Type': 'application/json' }, JSON.stringify(payload), 90000);
        } else {
          req = fetch(AI_REMOTE + '/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          }).then(function (r) {
            return r.text().then(function (t) { return { ok: r.ok, status: r.status, text: t }; });
          });
        }
        return req.then(function (r) {
          if (!r) throw new Error('服务器没有回应。');
          if (!r.ok) throw new Error('服务器返回 ' + r.status + '：' + String(r.text || '').slice(0, 160));
          var data = {};
          try { data = JSON.parse(r.text); } catch (e) {
            throw new Error('服务器返回的不是 JSON：' + String(r.text || '').slice(0, 120));
          }
          var content = '';
          try { content = data.choices[0].message.content; } catch (e) { content = ''; }
          return content || '';
        });
      }

      /* 服务器不通时，才退回用户自己填的接口 */
      function viaLocal() {
        var base = (cfg.base || '').replace(/\/+$/, '');
        var url = base + '/chat/completions';
        var payload = { model: cfg.model, messages: messages, temperature: 0.3 };

        /* 桌面版：请求交给外壳从主进程发出去。
         * 页面里直连的时候，file:// 和自定义来源都会被跨域拦，主进程发不受这个限制。 */
        if (shell && shell.desktop && shell.aiPost) {
          return shell.aiPost(url, {
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
          body: JSON.stringify(payload)
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

      if (AI_REMOTE && (remoteReady || !localOk)) {
        return viaRemote()['catch'](function (err) {
          if (!localOk) throw err;
          return viaLocal();
        });
      }
      /* 没配服务器、用户自己也没填接口：给一句人话，别抛原始错误 */
      if (!localOk) {
        return Promise.reject(new Error(
          '还没有配置 AI 接口。点右上角「设置」，填入接口地址、密钥和模型名就能联网对话；' +
          '不填也能用，只是回答会基于本地数据。'));
      }
      return viaLocal();
    }

    function askModel(question) {
      var built = buildMessages(question);
      showCtx(built.ctx);

      turn = {
        base: built.messages,
        results: [],
        round: 0,
        question: question,
        waiting: addMsg('bot', '正在问模型…')
      };
      btn.disabled = true;
      stepModel();
    }

    function toolLabel(name) {
      var t = {
        query_today: '今天怎么样',
        query_timetable: '查课表', query_free_time: '查空档',
        add_course: '加课', update_course: '改课', remove_course: '删课', import_courses: '批量导入课表',
        query_time_records: '查时间记录', add_time_record: '记时间',
        update_time_record: '改时间记录', remove_time_record: '删时间记录',
        query_focus: '查番茄',
        query_plans: '查行程', add_plan: '加行程', add_plan_step: '加步骤',
        step_done: '勾步骤', plan_done: '整条完成',
        query_expenses: '查花销', add_expense: '记一笔',
        query_todos: '查待办', add_todo: '加待办', done_todo: '勾待办',
        remove_todo: '删待办', update_todo: '改待办',
        query_countdowns: '查倒计时', add_countdown: '加倒计时',
        query_notes: '查随手记', add_note: '记灵感', set_mood: '记情绪',
        query_challenges: '查挑战', record_challenge: '标挑战结果',
        remember: '记住', forget: '忘掉', query_memory: '翻记忆',
        import_data: '批量导入', undo_last: '撤销'
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

      var configured = remoteReady || (cfg.base && cfg.key && cfg.model);
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

    /* 确认条上的两个按钮 */
    var cok = document.getElementById('aiConfirmOk');
    var cno = document.getElementById('aiConfirmNo');
    if (cok) cok.addEventListener('click', function () { answerConfirm(true); });
    if (cno) cno.addEventListener('click', function () { answerConfirm(false); });

    /* 撤销条：点一下退回上一次改动 */
    var undoBtn = document.getElementById('aiUndoBtn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        var r = window.WorkbenchUndo ? WorkbenchUndo.undo() : { ok: false, text: '撤销模块没加载起来。' };
        addNote((r.ok ? '↩ ' : '× ') + r.text, r.ok ? 'dim' : 'bad');
        refreshAfterChange();
        paintUndoRow();
      });
    }
    paintUndoRow();

    /* 底下的快捷提问：点一下直接问 */
    Array.prototype.forEach.call(document.querySelectorAll('.ai-chip'), function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.dataset.ask || chip.textContent;
        send();
      });
    });

    /* -------- 设置面板 -------- */
    var panel = document.getElementById('aiCfgPanel');

    /* 清空对话：屏幕上的记录和存起来的历史一起清，免得旧历史把新问题带偏 */
    var clearLogBtn = document.getElementById('aiClearLog');
    if (clearLogBtn) {
      clearLogBtn.addEventListener('click', function () {
        log.innerHTML = '';
        aiNs.remove('aiHistory');
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
   * 只有打包成应用之后页面里才有 window.__WORKBENCH_SHELL__。
   * 浏览器里这整段不执行，界面上什么都不多、什么都不变。
   */
  function setupDesktop() {
    var sh = window.__WORKBENCH_SHELL__;
    if (!sh || !sh.desktop) return;

    /* 桌面应用那块（开机自启/测试通知/打开数据目录）由 shared/settings.js 统一接线 */

    /* 文案：浏览器那套说法在应用里不成立，逐处换掉 */
    var note = document.getElementById('cfgNote');
    if (note) {
      note.style.color = '';
      note.textContent = '应用版由程序自己发请求，不受跨域限制。填好地址、密钥、模型名，点「测试连接」试试。密钥只存在这台电脑上。';
    }
  }

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

  /* 每天第一次打开时存一份快照，改坏了能回到今天早上 */
  try { if (window.WorkbenchUndo) WorkbenchUndo.dailyBackup(); } catch (e) {}

  /* 给共享设置面板用的首页钩子（卡片名、自动切换档位） */

  /* 首次把自带课表写进数据，让它能随同步走到别的设备（出厂空课表不会触发） */
  (function seedTimetableToStore() {
    try {
      var tt = window.WorkbenchTimetable;
      if (!tt || !tt.term || !Array.isArray(tt.courses) || !tt.courses.length) return;
      if (!tt.term.firstMonday && !tt.term.name) return;
      var timeNs = WorkbenchStore.namespace('time');
      var saved = timeNs.get('timetable', null);
      if (saved && saved.term && Array.isArray(saved.courses)) return;
      timeNs.set('timetable', JSON.parse(JSON.stringify(tt)));
      /* 只写本地：上传交给到点那一轮或手动上传，别在开页面时偷偷推 */
    } catch (e) {}
  })();

  window.WorkbenchHome = {
    cardName: cardName,
    getNames: function () { return meta.get('cardNames', {}) || {}; },
    setNames: function (n) { meta.set('cardNames', n || {}); },
    rerender: function () { render(); layoutDeck(); },
    setAuto: setAutoSec,
    autoSec: function () { return autoSec; }
  };

  render();
  renderToday();
  /* 临时：逐个 init 包 try/catch，定位启动期未捕获错误 */
  window.__initErr = null;
  [['setupRail', setupRail], ['setupAI', setupAI], ['setupDesktop', setupDesktop], ['setupAutoDeck', setupAutoDeck], ['setupClock', setupClock]].forEach(function (p) {
    try { p[1](); } catch (e) { window.__initErr = p[0] + ': ' + (e && (e.stack || e.message)); }
  });

  /* 今天面板每隔一分钟对一次，跨过上课时间、番茄数变了都能跟上 */
  setInterval(function () { try { renderToday(); } catch (e) {} }, 60000);

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
  var prevBtn = document.getElementById('deckPrev');
  var nextBtn = document.getElementById('deckNext');
  if (prevBtn) prevBtn.addEventListener('click', function () { deckStep(-1); });
  if (nextBtn) nextBtn.addEventListener('click', function () { deckStep(1); });
  document.addEventListener('keydown', function (e) {
    /* 在输入框里打字时不要触发翻页 */
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') deckStep(-1);
    else if (e.key === 'ArrowRight') deckStep(1);
  });
})();
