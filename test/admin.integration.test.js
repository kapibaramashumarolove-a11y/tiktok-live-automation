'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { io: ioc } = require('socket.io-client');
const { createApp } = require('../src/app');

const silent = { info() {}, warn() {}, error() {}, simulation() {}, event() {} };
const TOKEN = 'test-token-0123456789abcdef';

async function start(overrides = {}) {
  const config = {
    port: 0, host: '127.0.0.1', messageHistorySize: 10, commandCooldownMs: 0, eventMode: 'simulation',
    requestedMode: 'simulation', adminToken: TOKEN, adminAllowRemote: false, ...overrides,
  };
  const ctx = createApp({ config, log: silent });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  ctx.base = `http://127.0.0.1:${ctx.server.address().port}`;
  return ctx;
}

function connect(url, opts) {
  const s = ioc(url, { reconnection: false, forceNew: true, transports: ['websocket'], ...opts });
  return new Promise((resolve) => {
    s.on('connect', () => resolve({ s, ok: true }));
    s.on('connect_error', (e) => resolve({ s, ok: false, error: e.message }));
  });
}

const emit = (s, name, payload) => new Promise((r) => s.emit(name, payload, r));
const once = (s, name) => new Promise((r) => s.once(name, r));

async function stop(ctx, sockets) {
  sockets.forEach((s) => s.close());
  ctx.io.close();
  await new Promise((r) => ctx.server.close(r));
}

test('管理用接続：トークンなし・誤り・別Originは拒否、正しいトークンは接続できる', async () => {
  const ctx = await start();
  const none = await connect(`${ctx.base}/admin`);
  const wrong = await connect(`${ctx.base}/admin`, { auth: { token: 'nope' } });
  const evil = await connect(`${ctx.base}/admin`, { auth: { token: TOKEN }, extraHeaders: { Origin: 'http://evil.example' } });
  const good = await connect(`${ctx.base}/admin`, { auth: { token: TOKEN }, extraHeaders: { Origin: ctx.base } });
  assert.deepStrictEqual([none.ok, none.error], [false, 'unauthorized']);
  assert.deepStrictEqual([wrong.ok, wrong.error], [false, 'unauthorized']);
  assert.deepStrictEqual([evil.ok, evil.error], [false, 'forbidden']);
  assert.ok(good.ok);
  await stop(ctx, [none.s, wrong.s, evil.s, good.s]);
});

test('認証失敗が続くと一時的にブロック', async () => {
  const ctx = await start();
  const socks = [];
  for (let i = 0; i < 10; i++) socks.push((await connect(`${ctx.base}/admin`, { auth: { token: 'bad' } })).s);
  const blocked = await connect(`${ctx.base}/admin`, { auth: { token: TOKEN } });
  assert.strictEqual(blocked.error, 'too many attempts');
  await stop(ctx, [...socks, blocked.s]);
});

test('OBS 用の接続は受信専用：イベントを送っても演出は起きない', async () => {
  const ctx = await start();
  const obs = await connect(ctx.base);
  assert.ok(obs.ok);
  let played = 0;
  obs.s.on('play', () => played++);
  obs.s.emit('sim:gift', { tier: 'special' });
  obs.s.emit('test:effect', { color: 'gold' });
  obs.s.emit('admin:stop', {});
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(played, 0);
  assert.strictEqual(ctx.router.runState, 'running');
  await stop(ctx, [obs.s]);
});

test('管理操作がOBS画面に届く：テストギフト・全停止・再開・メッセージ', async () => {
  const ctx = await start();
  const obs = await connect(ctx.base);
  const adm = await connect(`${ctx.base}/admin`, { auth: { token: TOKEN } });
  const playP = once(obs.s, 'play');
  const r1 = await emit(adm.s, 'sim:gift', { tier: 'normal', giftId: 'g', user: { key: 'k', name: 'テスト' } });
  assert.ok(r1.ok && r1.simulated);
  const p1 = await playP;
  assert.strictEqual(p1.simulated, true);

  const stopP = once(obs.s, 'stop');
  const r2 = await emit(adm.s, 'admin:stop');
  assert.strictEqual(r2.state.runState, 'stopped');
  await stopP;
  assert.strictEqual((await emit(adm.s, 'sim:gift', { tier: 'normal' })).ignored, 'stopped');

  const msgP = once(obs.s, 'play');
  const r3 = await emit(adm.s, 'admin:message', { text: '少しお待ちください', interrupt: true });
  assert.ok(r3.ok);
  const p3 = await msgP;
  assert.strictEqual(p3.origin, 'operator');

  const r4 = await emit(adm.s, 'admin:resume');
  assert.strictEqual(r4.state.runState, 'running');
  const bad = await emit(adm.s, 'admin:message', { text: '<img src=x onerror=alert(1)>' });
  assert.strictEqual(bad.ok, false);
  await stop(ctx, [obs.s, adm.s]);
});

test('HTTP：セキュリティヘッダー、管理ページ', async () => {
  const ctx = await start();
  const r = await fetch(`${ctx.base}/`);
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.strictEqual(r.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(r.headers.get('x-powered-by'), null);
  const a = await fetch(`${ctx.base}/admin`);
  assert.strictEqual(a.status, 200);
  assert.match(await a.text(), /管理パネル/);
  const st = await (await fetch(`${ctx.base}/api/status`)).json();
  assert.strictEqual(st.realConnection, false);
  assert.strictEqual(JSON.stringify(st).includes(TOKEN), false);
  await stop(ctx, []);
});
