/* 同步数据的存储层：Netlify Blobs
 *
 * 不再依赖 GitHub Gist。键名沿用原来的文件名格式，前端协议完全不用改：
 *   __accounts.json                 账号表（哈希，不存明文）
 *   sync-<名字>-<模块>.json          每个用户每个模块一份
 */
const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'workbench';
let cached = null;

/* 手动部署（netlify deploy --dir）不会自动注入 NETLIFY_BLOBS_CONTEXT，
 * 这时得自己带上 siteID 和 token。token 用运行时自带的 NETLIFY_FUNCTIONS_TOKEN，
 * 不需要在代码或环境变量里另存一份。 */
function store() {
  if (cached) return cached;
  if (process.env.NETLIFY_BLOBS_CONTEXT) {
    cached = getStore(STORE_NAME);
  } else {
    cached = getStore({
      name: STORE_NAME,
      siteID: process.env.WB_SITE_ID || process.env.SITE_ID,
      token: process.env.WB_BLOBS_TOKEN || process.env.NETLIFY_FUNCTIONS_TOKEN
    });
  }
  return cached;
}

async function readText(key) {
  /* 键不存在返回 null；存储本身出问题会抛错，交给调用方判断 */
  return await store().get(key, { type: 'text' });
}

async function writeText(key, text) {
  await store().set(key, text);
}

async function listKeys(prefix) {
  const out = [];
  try {
    const r = await store().list({ prefix: prefix || '' });
    (r.blobs || []).forEach(function (b) { out.push(b.key); });
  } catch (e) {}
  return out;
}

module.exports = { readText, writeText, listKeys, STORE_NAME };
