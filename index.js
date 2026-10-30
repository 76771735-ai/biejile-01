// 方块挤一挤 · 抖音云托管服务（koa 容器版，服务：bijiele-01）
// 接口：POST /report 上报 | POST /top 榜单 | POST /danmaku/add 发弹幕 | POST /danmaku/list 拉弹幕 | GET /health 健康检查
// 依赖：koa + @open-dy/node-server-sdk（抖音云文档型数据库服务端 SDK）
// 用户身份：callContainer 请求自动带 X-TT-OPENID 请求头（免登录），无需 code 换取
// 集合：scores { openid, nick, total, month, monthKey, puzzle, lv, ts, upd }
//       danmaku { openid, text, nick, mode, ts }
const Koa = require('koa');
const sdk = require('@open-dy/node-server-sdk');
const dySDK = sdk.dySDK || (sdk.default && sdk.default.dySDK) || sdk;   // 兼容 CJS/ESM 两种导出

const db = dySDK.database();
const app = new Koa();
const MAXV = 10000000;                          // 单值上限（防脏数据撑爆排序）

const int = v => { const n = Math.floor(Number(v)); return isFinite(n) && n > 0 ? Math.min(n, MAXV) : 0; };
const cut = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const rows = r => (Array.isArray(r) ? r : (r && r.data) || []);   // 兼容 get() 返回数组或 {data:[]}
const openidOf = ctx => ctx.get('X-TT-OPENID') || ctx.get('x-tt-openid') || '';

// POST body 手工解析（不依赖模板是否装了 bodyparser；GET 复用 query）
app.use(async (ctx, next) => {
  if (ctx.method === 'POST') {
    let raw = '';
    ctx.req.on('data', c => { raw += c; });
    await new Promise(res => ctx.req.on('end', res));
    try { ctx.state.body = JSON.parse(raw || '{}') || {}; } catch (e) { ctx.state.body = {}; }
  } else {
    ctx.state.body = Object.assign({}, ctx.query);
  }
  await next();
});

// 兼容不同 SDK 版本的 update 签名（update(data) / update({data})）
async function updateOne(col, cond, data) {
  try { await col.where(cond).update(data); }
  catch (e1) { await col.where(cond).update({ data }); }
}

// ---------- /report：上报本人积分 ----------
async function report(ctx) {
  const openid = openidOf(ctx);
  if (!openid) { ctx.body = { ok: false, err: 'no_openid' }; return; }
  const b = ctx.state.body || {};
  const now = Date.now();
  const nick = cut(b.nick, 12);
  const monthKey = cut(b.monthKey, 7);
  const col = db.collection('scores');
  const old = rows(await col.where({ openid }).limit(1).get())[0];
  if (!old) {
    const doc = {
      openid, nick,
      total: int(b.total), month: int(b.month), monthKey,
      puzzle: int(b.puzzle), lv: int(b.lv),
      ts: now, upd: now,
    };
    await col.add(doc);
    ctx.body = { ok: true, created: true, total: doc.total, month: doc.month };
    return;
  }
  const sameMonth = old.monthKey === monthKey;
  const next = {
    nick: nick || old.nick || '',
    total: Math.max(int(old.total), int(b.total)),
    month: sameMonth ? Math.max(int(old.month), int(b.month)) : int(b.month),
    monthKey: sameMonth ? old.monthKey : monthKey,
    puzzle: Math.max(int(old.puzzle), int(b.puzzle)),
    lv: Math.max(int(old.lv), int(b.lv)),
    upd: now,
  };
  await updateOne(col, { openid }, next);
  ctx.body = { ok: true, created: false, total: next.total, month: next.month };
}

// ---------- /top：Top N ----------
async function top(ctx) {
  const b = ctx.state.body || {};
  const kind = b.kind === 'month' ? 'month' : 'total';
  const limit = Math.min(Math.max(int(b.limit) || 50, 1), 100);
  const monthKey = cut(b.monthKey, 7);
  const openid = openidOf(ctx);
  const col = db.collection('scores');
  const q = kind === 'month' ? col.where({ monthKey }) : col;
  const list = rows(await q.orderBy(kind, 'desc').orderBy('ts', 'asc').limit(limit).get())
    .map(d => ({ nick: d.nick || '玩家', value: int(d[kind]), lv: int(d.lv), me: !!openid && d.openid === openid }));
  let count = list.length;
  try {
    const c = await (kind === 'month' ? col.where({ monthKey }) : col).count();
    count = (c && (c.total || c.count)) || count;
  } catch (e) { /* count 不可用时以返回条数为准 */ }
  ctx.body = { ok: true, kind, count, list };
}

// ---------- /danmaku/add ----------
async function danmakuAdd(ctx) {
  const b = ctx.state.body || {};
  const text = cut(b.text, 20);
  if (!text) { ctx.body = { ok: false, err: 'empty_text' }; return; }
  await db.collection('danmaku').add({
    openid: openidOf(ctx),
    text,
    nick: cut(b.nick, 12) || '玩家',
    mode: cut(b.mode, 10) || 'endless',
    ts: Date.now(),
  });
  ctx.body = { ok: true };
}

// ---------- /danmaku/list ----------
async function danmakuList(ctx) {
  const b = ctx.state.body || {};
  const since = int(b.since) || 0;
  const limit = Math.min(Math.max(int(b.limit) || 10, 1), 50);
  const _ = db.command;
  const list = rows(await db.collection('danmaku')
    .where({ mode: cut(b.mode, 10) || 'endless', ts: _.gt(since) })
    .orderBy('ts', 'asc').limit(limit).get())
    .map(d => ({ _id: d._id, text: d.text, nick: d.nick, ts: int(d.ts) }));
  ctx.body = { ok: true, list };
}

// ---------- 路由 ----------
app.use(async ctx => {
  try {
    if (ctx.path === '/report' && ctx.method === 'POST') return await report(ctx);
    if (ctx.path === '/top') return await top(ctx);
    if (ctx.path === '/danmaku/add' && ctx.method === 'POST') return await danmakuAdd(ctx);
    if (ctx.path === '/danmaku/list') return await danmakuList(ctx);
    if (ctx.path === '/' || ctx.path === '/health') { ctx.body = { ok: true, msg: 'bijiele server up' }; return; }
    ctx.status = 404;
    ctx.body = { ok: false, err: 'not_found' };
  } catch (e) {
    ctx.status = 200;                              // 业务错误也走 200，客户端按 ok 字段判断
    ctx.body = { ok: false, err: String((e && e.message) || e) };
  }
});

// 抖音云容器通过 PORT 环境变量注入端口；日志走标准输出（console）即可在平台日志查看
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => { console.log('[bijiele-server] listening on', PORT); });
