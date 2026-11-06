/* AI 转发
 *
 * 为什么要有这个东西：网页直接请求第三方的 AI 接口，浏览器会因为跨域把它拦掉。
 * 手机上尤其严。所以让请求先发到自己的站点，由这里转给上游。
 *
 * 密钥放在 Netlify 后台的环境变量里，不进网页。
 * 这样手机上打开就能直接用，什么都不用填；别人看网页源码也偷不到密钥。
 *
 * 需要在 Netlify 后台配三个环境变量：
 *   AI_BASE   接口地址，比如 https://sub.ap-sub.top/v1
 *   AI_KEY    密钥
 *   AI_MODEL  默认模型名，比如 deepseek-v4-flash（不配就用下面这个默认值）
 */

const DEFAULT_MODEL = 'deepseek-v4-flash';

/* 桌面版是 file:// 页面，跨域限制比普通网站更严。
 * 这里显式放行，客户端才读得到返回内容。 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, x-wb-account, authorization, if-none-match',
  'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  'access-control-max-age': '86400',
};

async function handle(event) {
  const BASE = process.env.AI_BASE || '';
  const KEY = process.env.AI_KEY || '';
  const MODEL = process.env.AI_MODEL || DEFAULT_MODEL;

  // 网页启动时会先问一句「你这儿配好了吗」
  if (event.httpMethod === 'GET') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ready: !!(BASE && KEY),
        model: MODEL,
        // 只告诉前端配没配、用哪个模型，绝不返回地址和密钥
      }),
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: '只支持 GET 和 POST' }) };
  }

  if (!BASE || !KEY) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: '服务器还没配好接口地址或密钥。去 Netlify 后台的 Environment variables 里加上 AI_BASE 和 AI_KEY，然后重新部署一次。',
      }),
    };
  }

  let payload = {};
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: '请求内容不是合法的 JSON' }) };
  }

  // 启动时的探活：不发消息、不花钱，只问「能不能用」
  if (payload.probe) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ready: !!(BASE && KEY), model: MODEL }),
    };
  }

  // 只转发需要的字段，别的东西不带过去
  const body = {
    model: payload.model || MODEL,
    messages: Array.isArray(payload.messages) ? payload.messages : [],
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.3,
  };
  if (payload.tools) body.tools = payload.tools;
  if (payload.tool_choice) body.tool_choice = payload.tool_choice;
  if (payload.stream) body.stream = false; // 网页这边没做流式，统一关掉
  if (payload.max_tokens) body.max_tokens = payload.max_tokens;
  // 看图转结构化数据这种活儿，不需要长篇推导，省下来的时间都是响应速度
  body.response_format = payload.response_format || { type: 'text' };

  const url = BASE.replace(/\/+$/, '') + '/chat/completions';

  /* 上游要是卡住不回，这里得主动放弃。
   * Netlify 的函数有执行时限，等到平台来砍会变成 504，
   * 还不如自己先超时，返回一句能看懂的话。 */
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + KEY,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    clearTimeout(timer);
    return {
      statusCode: r.status,
      headers: { 'Content-Type': 'application/json' },
      body: text,
    };
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && (e.name === 'AbortError' || String(e.message).indexOf('abort') >= 0);
    return {
      statusCode: aborted ? 504 : 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: aborted
          ? '模型太久没回话，这次放弃了。图片可以截小一点再试，或者改用粘贴文字。'
          : '转发请求失败：' + (e && e.message ? e.message : String(e)),
      }),
    };
  }
}

/* 统一给所有响应加上跨域头，桌面版和别的站点才读得到 */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  const res = await handle(event);
  return Object.assign({}, res, {
    headers: Object.assign({}, CORS, res.headers || {}),
  });
};
