/* 联网搜索（主进程用）
 *
 * 为什么放在主进程：页面是 file:// 起的，直接 fetch 外部接口会被同源策略挡住；
 * 主进程没有这个限制。AI 请求（net:post）早就走这条路了，搜索也一样。
 *
 * 为什么用必应 RSS 而不是抓网页：`format=rss` 返回的是干净的 XML，
 * 网页那版全是动态类名和脚本，改版就崩。RSS 的 <item> 结构十几年没变过。
 * 实测在国内网络下 cn.bing.com 通、返回中文结果，够用。
 *
 * 不管拿到什么，这个模块都不抛异常：搜不到就返回空数组 + 原因，
 * 让模型能说"没搜到"，而不是整个对话挂掉。
 */
'use strict';

const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const HOSTS = ['https://cn.bing.com/search', 'https://www.bing.com/search'];
const MAX_ITEMS = 6;
const TIMEOUT = 12000;

/* 实体解码：RSS 里 &amp; &#39; &#x4E2D; 都会出现 */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return safeChar(parseInt(h, 16)); })
    .replace(/&#(\d+);/g, function (_, d) { return safeChar(parseInt(d, 10)); })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function safeChar(code) {
  try { return String.fromCodePoint(code); } catch (e) { return ''; }
}

/* 去掉 CDATA、标签、多余空白 */
function clean(s) {
  return decodeEntities(String(s || '')
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function pick(block, tag) {
  const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i'));
  return m ? m[1] : '';
}

function parseRss(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const block = m[1];
    const title = clean(pick(block, 'title'));
    const snippet = clean(pick(block, 'description'));
    const url = clean(pick(block, 'link'));
    if (!title) continue;
    /* 必应偶尔会把同一个页面塞两条，标题一样就跳过 */
    if (items.some(function (it) { return it.title === title; })) continue;
    items.push({ title: title, snippet: snippet, url: url });
    if (items.length >= 20) break;
  }
  return items;
}

function buildUrl(host, q) {
  const u = new URL(host);
  u.searchParams.set('q', q);
  u.searchParams.set('format', 'rss');
  u.searchParams.set('setlang', 'zh-CN');
  u.searchParams.set('count', '20');
  return u.toString();
}

function fetchText(url, timeout) {
  return new Promise(function (resolve, reject) {
    let done = false;
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      try { req.destroy(); } catch (e) {}
      reject(new Error('搜索超时'));
    }, timeout || TIMEOUT);

    const req = https.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/xml;q=0.9, */*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    }, function (res) {
      /* 跳转自己跟（必应偶尔会 302 到 m.bing 或加参数） */
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        if (done) return;
        done = true;
        const next = res.headers.location.indexOf('http') === 0
          ? res.headers.location
          : 'https://cn.bing.com' + res.headers.location;
        res.resume();
        fetchText(next, timeout).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        if (done) return;
        done = true;
        res.resume();
        reject(new Error('HTTP ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        clearTimeout(timer);
        if (done) return;
        done = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });

    req.on('error', function (e) {
      clearTimeout(timer);
      if (done) return;
      done = true;
      reject(e);
    });

    req.setTimeout((timeout || TIMEOUT) - 500, function () {
      try { req.destroy(new Error('搜索超时')); } catch (e) {}
    });
  });
}

/* 搜一轮。两个域名轮流试，谁先给出条目就用谁 */
async function search(q, limit) {
  const query = String(q || '').replace(/\s+/g, ' ').trim();
  const n = Math.max(1, Math.min(Number(limit) || MAX_ITEMS, 10));
  if (!query) return { ok: false, results: [], error: '搜索词是空的' };

  let lastErr = '';
  for (const host of HOSTS) {
    try {
      const xml = await fetchText(buildUrl(host, query));
      const items = parseRss(xml);
      if (items.length) {
        return {
          ok: true,
          results: items.slice(0, n),
          source: host.indexOf('cn.') >= 0 ? '必应' : '必应(国际)'
        };
      }
      lastErr = '没有结果';
    } catch (e) {
      lastErr = String((e && e.message) || e);
    }
  }
  return { ok: false, results: [], error: lastErr || '搜不到' };
}

module.exports = { search: search, parseRss: parseRss, buildUrl: buildUrl, clean: clean };
