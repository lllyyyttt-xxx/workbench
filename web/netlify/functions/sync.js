/* 同步存储（Netlify Blobs，不再经过 GitHub）
 *
 * 前端协议完全没变，只是把「Gist 里的文件」换成「Blobs 里的键」：
 *   GET   /api/sync/...        → { id, files: { 文件名: { content } } }
 *   PATCH /api/sync/...        ← { files: { 文件名: { content } } }
 *
 * 谁能读写什么，由凭证决定：
 * 1. 账号模式（主要用法）：x-wb-account: 名字:访问码，校验账号表后，
 *    只能碰 sync-<名字>-*.json 这一组，别人的数据在服务端就够不着。
 * 2. 站长模式（旧 token）：需要 token 等于 WB_ADMIN_TOKEN 环境变量，
 *    只能碰 sync-me-*.json。没配这个变量就等于关闭。
 * 3. 其他一律 401。
 */
const { hashName, cleanName, loadAccounts, json, preflight } = require('./_wbcommon');
const { readText, writeText, listKeys } = require('./_store');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const h = event.headers || {};
  const auth = h.authorization || '';
  const acct = h['x-wb-account'] || '';

  let prefix = null;

  if (acct) {
    const idx = acct.indexOf(':');
    const name = cleanName(idx >= 0 ? acct.slice(0, idx) : '');
    const code = idx >= 0 ? acct.slice(idx + 1) : '';
    if (!name) return json({ message: '账号格式不对' }, 401);
    const accs = await loadAccounts();
    if (accs === null) return json({ message: '存储暂时不可用，过一会儿再试' }, 500);
    const a = accs[name];
    if (!a || a.h !== hashName(name, code)) return json({ message: '账号验证失败，请重新登录' }, 401);
    prefix = 'sync-' + name + '-';
  } else if (auth && /^token\s+/i.test(auth)) {
    /* 老的 token 模式：只有站长本人配了 WB_ADMIN_TOKEN 才能用 */
    const admin = process.env.WB_ADMIN_TOKEN || '';
    const got = auth.replace(/^token\s+/i, '').trim();
    if (!admin || got !== admin) return json({ message: '站长模式已停用，请改用「账号模式」登录' }, 401);
    prefix = 'sync-me-';
  } else {
    return json({ message: '缺少凭证' }, 401);
  }

  if (event.httpMethod === 'GET' || event.httpMethod === 'HEAD') {
    const keys = await listKeys(prefix);
    const files = {};
    for (let i = 0; i < keys.length; i++) {
      try {
        const c = await readText(keys[i]);
        if (c !== null) files[keys[i]] = { content: c };
      } catch (e) { /* 单个文件读失败不影响其它 */ }
    }
    return json({ id: 'blobs', files: files });
  }

  if (event.httpMethod === 'PATCH') {
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : (event.body || {});
    } catch (e) {
      return json({ message: '请求格式不对' }, 400);
    }
    const files = (body && body.files) || {};
    const names = Object.keys(files);
    for (let i = 0; i < names.length; i++) {
      if (names[i].indexOf(prefix) !== 0) return json({ message: '只能同步自己的数据' }, 403);
    }
    try {
      for (let i = 0; i < names.length; i++) {
        const c = files[names[i]] && files[names[i]].content;
        if (typeof c === 'string') await writeText(names[i], c);
      }
      return json({ id: 'blobs' });
    } catch (e) {
      return json({ message: '写入失败: ' + ((e && e.message) || e) }, 502);
    }
  }

  return json({ message: '不支持的方法' }, 405);
};
