/* AI 的长期记忆
 *
 * 之前它每次回答都靠现算的摘要，记不住「我讨厌背单词」「体测在下周三」这种话，
 * 下次还得再说一遍。这里给它一个小本子：能写、能读、能删，用久了会越来越懂你。
 *
 * 几条规矩：
 *   - 最多 60 条，超了丢最久没被用到的那条，别让小本子无限膨胀；
 *   - 写入时做去重，意思一样的不重复记，只把用到的时间往后推；
 *   - 拼进提示词时只取最近的 40 条、总共不超过 1200 字，别把上下文吃光。
 */
window.WorkbenchMemory = (function () {
  'use strict';

  var ns = window.WorkbenchStore.namespace('__workbench');
  var KEY = 'aiMemory';
  var MAX = 60;
  var PROMPT_MAX = 40;
  var PROMPT_CHARS = 1200;

  function load() {
    var list = ns.get(KEY, []);
    if (!Array.isArray(list)) return [];
    return list.filter(function (m) { return m && m.text; });
  }

  function save(list) {
    return ns.set(KEY, list.slice(-MAX));
  }

  function uid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  /* 两条记忆算不算同一件事：完全一样，或者一条把另一条整个含住了 */
  function same(a, b) {
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    return a.indexOf(b) >= 0 || b.indexOf(a) >= 0;
  }

  function list() { return load(); }

  function add(text, tag) {
    var t = clean(text);
    if (!t) return { ok: false, text: '要记的内容是空的。' };

    var arr = load();
    for (var i = 0; i < arr.length; i++) {
      if (same(arr[i].text, t)) {
        arr[i].at = Date.now();
        arr[i].hits = (arr[i].hits || 0) + 1;
        save(arr);
        return { ok: true, text: '这条我已经记着了：' + arr[i].text, changed: false };
      }
    }

    arr.push({ id: uid(), text: t, tag: String(tag || '').slice(0, 8), at: Date.now(), hits: 0 });
    while (arr.length > MAX) {
      /* 丢最久没被提到的那条 */
      var oldest = 0;
      for (var k = 1; k < arr.length; k++) {
        if ((arr[k].at || 0) < (arr[oldest].at || 0)) oldest = k;
      }
      arr.splice(oldest, 1);
    }
    save(arr);
    return { ok: true, text: '记住了：' + t, changed: true };
  }

  function remove(keyword) {
    var kw = clean(keyword);
    if (!kw) return { ok: false, text: '要删哪一条？说个关键词。' };

    var arr = load();
    var hit = arr.filter(function (m) { return m.text.indexOf(kw) >= 0; });
    if (!hit.length) return { ok: false, text: '没找到含「' + kw + '」的记忆。' };
    if (hit.length > 1) {
      return {
        ok: false,
        text: '有 ' + hit.length + ' 条都含「' + kw + '」：' + hit.map(function (m) { return m.text; }).join('；') + '。说具体点。'
      };
    }

    var left = arr.filter(function (m) { return m !== hit[0]; });
    save(left);
    return { ok: true, text: '已经忘掉：' + hit[0].text, changed: true };
  }

  function search(keyword) {
    var kw = clean(keyword);
    var arr = load();
    if (kw) arr = arr.filter(function (m) { return m.text.indexOf(kw) >= 0; });
    return arr;
  }

  function clear() {
    ns.remove(KEY);
  }

  /* 拼进系统提示的那一段。没记过东西就返回空串，别占地方 */
  function promptText() {
    var arr = load();
    if (!arr.length) return '';

    var recent = arr.slice(-PROMPT_MAX).reverse();
    var lines = [];
    var used = 0;
    for (var i = 0; i < recent.length; i++) {
      var line = '· ' + recent[i].text;
      if (used + line.length > PROMPT_CHARS) break;
      lines.push(line);
      used += line.length;
    }
    if (!lines.length) return '';

    return '\n\n关于我，你之前记下的（能用上就用，别硬套）：\n' + lines.join('\n');
  }

  return {
    list: list,
    add: add,
    remove: remove,
    search: search,
    clear: clear,
    promptText: promptText,
    MAX: MAX
  };
})();
