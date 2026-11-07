/* 账号注册 / 登录
 *
 * POST /api/account/  body: { action: 'register' | 'login', name, code }
 * 返回 { ok, text }
 * 账号表在中转站 gist 的 __accounts.json，只存哈希不存明文。
 */
const { hashName, cleanName, loadAccounts, saveAccounts, json, preflight, failKey, tooMany, noteFail, clearFails } = require('./_wbcommon');

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return preflight();
  if (event.httpMethod !== 'POST') return json({ ok: false, text: '只支持 POST' }, 405);
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json({ ok: false, text: '请求格式不对' }, 400); }

  const name = cleanName(body.name);
  const code = String(body.code || '');
  if (!name) return json({ ok: false, text: '名字只能用字母、数字、- 和 _' });
  if (!/^\d{4}$/.test(code)) return json({ ok: false, text: '访问码是 4 位数字' });

  /* 同一 IP + 名字连续错太多次就先挡住，防 4 位码被脚本穷举 */
  const key = failKey(event, name);
  if (tooMany(key)) return json({ ok: false, text: '尝试次数太多了，过十分钟再试' }, 429);

  const accs = await loadAccounts();
  if (accs === null) return json({ ok: false, text: '服务端没配好，请联系站长' }, 500);

  if (body.action === 'register') {
    if (accs[name]) return json({ ok: false, text: '这个名字已经被注册了，换一个，或者直接登录' });
    accs[name] = { h: hashName(name, code), t: Date.now() };
    const r = await saveAccounts(accs);
    if (!r.ok) return json({ ok: false, text: '保存失败（' + r.status + '），稍后再试' }, 502);
    clearFails(key);
    return json({ ok: true, text: '注册成功，欢迎你，' + name });
  }

  if (body.action === 'login') {
    const a = accs[name];
    /* 不区分「没这个账号」和「码不对」，避免被人拿来枚举名字 */
    if (!a || a.h !== hashName(name, code)) {
      noteFail(key);
      return json({ ok: false, text: '名字或访问码不对' });
    }
    clearFails(key);
    return json({ ok: true, text: '登录成功，欢迎回来，' + name });
  }

  return json({ ok: false, text: '未知操作' }, 400);
};
