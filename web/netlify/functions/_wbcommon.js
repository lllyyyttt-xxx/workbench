/* 工作台账号系统公共库（给 account.js / sync.js 两个函数共用）
 *
 * 账号表存在 Netlify Blobs 的 __accounts.json 里，只存「名字 → 访问码哈希」，
 * 不存明文。存储用 Netlify 自带能力，不再依赖 GitHub。
 */
const crypto = require('crypto');
const { readText, writeText } = require('./_store');

const ACCOUNTS_FILE = '__accounts.json';

function hashName(name, code) {
  return crypto.createHash('sha256').update('wb-sync::' + name + '::' + code).digest('hex');
}

function cleanName(raw) {
  return String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
}

/* 返回 null = 存储读不了（别当成空表，否则会把别人的账号覆盖掉） */
async function loadAccounts() {
  try {
    const t = await readText(ACCOUNTS_FILE);
    return t ? JSON.parse(t) : {};
  } catch (e) {
    return null;
  }
}

async function saveAccounts(accs) {
  try {
    await writeText(ACCOUNTS_FILE, JSON.stringify(accs));
    return { ok: true, status: 200 };
  } catch (e) {
    return { ok: false, status: 500, text: (e && e.message) || '写入失败' };
  }
}

/* 跨域：桌面版是 file:// 页面（Origin 为 null），要直接问线上这个接口，
 * 所以这里放开跨域。接口本身每次都要带凭证（token 或 名字+访问码），
 * 放开读权限不会多出什么能被白拿的东西。 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-wb-account, authorization, if-none-match',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-max-age': '86400'
};

/* 浏览器/Electron 的预检请求，直接放行 */
function preflight() {
  return { statusCode: 204, headers: CORS, body: '' };
}

function json(obj, status) {
  return { statusCode: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, CORS), body: JSON.stringify(obj) };
}

/* 简单的失败限流：同一个 IP + 名字，十分钟内错太多次就先挡住。
 * Netlify 的函数实例会被复用，内存里的计数对短时间爆破足够；
 * 实例冷启动后计数清零，属于可接受的取舍（4 位码也不至于被瞬间穷举完）。 */
const FAIL_WINDOW = 10 * 60 * 1000;
const FAIL_LIMIT = 8;
const fails = new Map();

function failKey(event, name) {
  const h = (event && event.headers) || {};
  const ip = h['x-nf-client-connection-ip'] || h['client-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown';
  return ip + '|' + (name || '');
}
function tooMany(key) {
  const r = fails.get(key);
  if (!r) return false;
  if (Date.now() - r.at > FAIL_WINDOW) { fails.delete(key); return false; }
  return r.n >= FAIL_LIMIT;
}
function noteFail(key) {
  const r = fails.get(key);
  if (!r || Date.now() - r.at > FAIL_WINDOW) fails.set(key, { n: 1, at: Date.now() });
  else { r.n++; r.at = Date.now(); }
}
function clearFails(key) { fails.delete(key); }

module.exports = {
  ACCOUNTS_FILE, hashName, cleanName, loadAccounts, saveAccounts,
  json, preflight, CORS, failKey, tooMany, noteFail, clearFails
};
