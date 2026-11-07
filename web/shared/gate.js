/* 首页账号门：第一次打开时问一句「要不要同步」
 *
 * - 已连接（token 或账号模式）→ 直接进，不打扰；
 * - 点过「先自己用」→ 记住选择，直接进（设置里随时能补登录）；
 * - 其余情况弹全屏引导：注册/登录账号，或先自己用。
 * 账号模式两头都能用：网页走同源后台，桌面版直接问线上后台。
 */
(function (global) {
  'use strict';

  function init() {
    /* 无头浏览器/自动化环境不弹门，免得挡住验证脚本 */
    try { if (global.navigator && global.navigator.webdriver) return; } catch (e) {}
    try { if (location.search.indexOf('nogate=1') >= 0) return; } catch (e) {}
    var S = global.WorkbenchSync;
    if (!S || !S.status) return;
    var st = S.status();
    if (st.connected) return;                      // 已经连着，直接进
    var meta = global.WorkbenchStore && global.WorkbenchStore.namespace('__workbench');
    if (meta && meta.get('gateSolo', 0)) return;   // 选过「先自己用」

    /* 桌面版也能注册/登录了：没有同源后台就走线上那个 */
    var canAccount = true;

    var style = document.createElement('style');
    style.textContent =
      '#wbGate{position:fixed;inset:0;z-index:9998;display:flex;align-items:center;justify-content:center;' +
      'background:linear-gradient(160deg,#f4f6fb,#eef1f8 55%,#f6f4f9);}' +
      '#wbGate .g-card{width:min(360px,88vw);background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.85);' +
      'border-radius:22px;box-shadow:0 18px 60px rgba(31,38,52,.14);padding:30px 28px 22px;text-align:center;' +
      'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#2b2b2b;}' +
      '#wbGate .g-logo{font-size:34px;}' +
      '#wbGate h1{font-size:20px;margin:8px 0 6px;font-weight:700;}' +
      '#wbGate .g-sub{font-size:13px;color:#8a8f99;line-height:1.7;margin-bottom:18px;}' +
      '#wbGate input{width:100%;box-sizing:border-box;border:1px solid #dfe3ea;border-radius:10px;' +
      'padding:11px 12px;font-size:15px;margin-bottom:10px;font-family:inherit;outline:none;}' +
      '#wbGate input:focus{border-color:#8e7cc3;}' +
      '#wbGate .g-btn{width:100%;padding:12px 0;border:0;border-radius:12px;font-size:15px;' +
      'font-family:inherit;cursor:pointer;margin-bottom:10px;}' +
      '#wbGate .g-main{background:#5e4a9e;color:#fff;}' +
      '#wbGate .g-row{display:flex;gap:10px;}' +
      '#wbGate .g-sec{background:#eef0f5;color:#4a5262;flex:1;}' +
      '#wbGate .g-skip{display:inline-block;margin-top:6px;font-size:13px;color:#98a0ad;cursor:pointer;' +
      'text-decoration:underline;background:none;border:0;font-family:inherit;}' +
      '#wbGate .g-tip{font-size:12.5px;color:#c62828;min-height:18px;margin-bottom:4px;}' +
      '#wbGate .g-note{font-size:12px;color:#a8aeb9;margin-top:10px;line-height:1.6;}';
    document.head.appendChild(style);

    var wrap = document.createElement('div');
    wrap.id = 'wbGate';
    wrap.innerHTML =
      '<div class="g-card">' +
      '<div class="g-logo">🏠</div>' +
      '<h1>欢迎使用工作台</h1>' +
      '<div class="g-sub">登录同一个账号，手机和电脑的数据就自动互通。<br>不需要同步的话，也可以先自己用。</div>' +
      (canAccount
        ? '<input id="gName" placeholder="起个名字（字母或数字）" autocomplete="off">' +
          '<input id="gCode" type="password" placeholder="4 位数字访问码" maxlength="4">' +
          '<div class="g-tip" id="gTip"></div>' +
          '<div class="g-row">' +
          '<button class="g-btn g-main" id="gGo">进入</button>' +
          '<button class="g-btn g-sec" id="gReg">注册</button></div>' +
          '<button class="g-skip" id="gSkip">先自己用，不同步 →</button>' +
          '<div class="g-note">名字 + 访问码就是你的账号，<br>在别的设备登录同样的账号即可同步。</div>'
        : '<div class="g-tip" id="gTip"></div>' +
          '<button class="g-btn g-main" id="gSkip2">进入工作台</button>' +
          '<div class="g-note">想开启多设备同步？在「设置 → 数据同步」里连接。</div>');
    document.body.appendChild(wrap);

    function close() { var g = document.getElementById('wbGate'); if (g) g.remove(); }

    var skip = document.getElementById('gSkip') || document.getElementById('gSkip2');
    if (skip) skip.addEventListener('click', function () {
      if (meta) meta.set('gateSolo', 1);
      close();
    });

    var go = document.getElementById('gGo');
    var reg = document.getElementById('gReg');
    function act(isReg) {
      var n = document.getElementById('gName');
      var c = document.getElementById('gCode');
      var tip = document.getElementById('gTip');
      tip.textContent = '正在' + (isReg ? '注册' : '登录') + '…';
      S.accountAuth(n.value, c.value, isReg).then(function (r) {
        tip.textContent = r.text;
        if (r.ok) { if (meta) meta.set('gateSolo', 0); location.reload(); }
      });
    }
    if (go) go.addEventListener('click', function () { act(false); });
    if (reg) reg.addEventListener('click', function () { act(true); });
    var codeEl = document.getElementById('gCode');
    if (codeEl) codeEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && go) go.click(); });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : this);
