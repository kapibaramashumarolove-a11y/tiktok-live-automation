'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EffectQueue } = require('../src/lib/effectQueue');
const { EventRouter } = require('../src/events/router');
const { MessagePicker } = require('../src/lib/messagePicker');
const { createSimulationEvent, createLiveEvent } = require('../src/events/eventFactory');
const data = require('../src/data/messages.json');

function setup(t, opts = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 5_000_000 });
  const emitted = [];
  const logs = [];
  const queue = new EffectQueue({ gapMs: 100 });
  const router = new EventRouter({
    queue,
    picker: new MessagePicker(data),
    emit: (name, payload) => emitted.push({ name, payload }),
    log: { event: (e, m) => logs.push(`${(typeof e === 'boolean' ? e : e.simulated) ? '[SIMULATION]' : '[LIVE]'} ${m}`) },
    commandCooldownMs: 30000,
    feed: { intervalMs: 100, maxBuffer: 5 },
    ...opts,
  });
  const of = (name) => emitted.filter((e) => e.name === name).map((e) => e.payload);
  const tick = (ms) => { for (let left = ms; left > 0; left -= Math.min(50, left)) t.mock.timers.tick(Math.min(50, left)); };
  return { queue, router, emitted, logs, of, tick };
}

test('シミュレーションのギフトは画面・ログでテストと分かる', (t) => {
  const { router, of, logs } = setup(t);
  router.handle(createSimulationEvent('gift', { tier: 'normal', giftId: 'g', giftName: '通常ギフト', user: { key: 'a', name: 'さくら' } }));
  const p = of('play')[0];
  assert.strictEqual(p.simulated, true);
  assert.strictEqual(p.origin, 'simulation');
  assert.match(p.headline, /^通常ギフト（テスト）｜【テスト】さくらさん/);
  assert.ok(logs[0].startsWith('[SIMULATION]'));
  assert.strictEqual(p.message.category, 'gratitude');
});

test('実イベントの表示には【テスト】が付かず、ログは [LIVE]', (t) => {
  const { router, of, logs } = setup(t);
  router.handle(createLiveEvent('gift', { tier: 'special', giftId: 'g', giftName: 'Galaxy', user: { key: 'a', name: 'sakura' } }));
  const p = of('play')[0];
  assert.strictEqual(p.simulated, false);
  assert.strictEqual(p.color, 'rainbow');
  assert.match(p.headline, /^Galaxy｜sakuraさん/);
  assert.ok(!p.headline.includes('テスト'));
  assert.ok(logs[0].startsWith('[LIVE]'));
});

test('不適切な表示名は汎用名に置き換えて演出は続行', (t) => {
  const { router, of } = setup(t);
  router.handle(createSimulationEvent('gift', { user: { key: 'a', name: 'バカ太郎' } }));
  assert.match(of('play')[0].headline, /｜【テスト】視聴者さん/);
  assert.strictEqual(router.stats.blockedNames, 1);
});

test('ブロックされたコメントは画面に送られず、ログにも本文を残さない', (t) => {
  const { router, of, logs, tick } = setup(t);
  const secret = '090-1234-5678';
  const r = router.handle(createSimulationEvent('comment', { text: `電話 ${secret}`, user: { key: 'a', name: 'A' } }));
  tick(1000);
  assert.strictEqual(r.displayed, false);
  assert.deepStrictEqual(of('comment'), []);
  assert.ok(logs.every((l) => !l.includes(secret)));
  assert.strictEqual(router.stats.blockedComments, 1);
});

test('コメントは間引いて送り出し、上限を超えた古いものは捨てる', (t) => {
  const { router, of, tick } = setup(t);
  for (let i = 0; i < 12; i++) router.handle(createSimulationEvent('comment', { text: `こんにちは${i}`, user: { key: `u${i}`, name: `n${i}` } }));
  assert.strictEqual(of('comment').length, 1); // 即時は1件だけ
  tick(100);
  assert.strictEqual(of('comment').length, 2);
  tick(2000);
  const shown = of('comment');
  assert.strictEqual(shown.length, 6); // 最初の1件 + バッファ上限5件
  assert.strictEqual(shown[shown.length - 1].text, 'こんにちは11');
  assert.ok(shown.every((c) => c.simulated && c.name.startsWith('【テスト】')));
  assert.strictEqual(router.feed.dropped, 6);
});

test('色コマンド：選んだ色を記憶し、そのあとのギフト演出に使う。クールダウンあり', (t) => {
  const { router, of, tick } = setup(t);
  const u = { key: 'a', name: 'A' };
  const r1 = router.handle(createSimulationEvent('comment', { text: 'パープル', user: u }));
  assert.strictEqual(r1.command.status, 'queued');
  const r2 = router.handle(createSimulationEvent('comment', { text: 'ピンク', user: u }));
  assert.strictEqual(r2.command.status, 'cooldown');
  tick(30000);
  router.handle(createSimulationEvent('gift', { giftId: 'x', user: u }));
  tick(20000);
  const plays = of('play');
  assert.strictEqual(plays[0].kind, 'comment-color');
  assert.strictEqual(plays[0].color, 'purple');
  assert.strictEqual(plays[0].intensity, 0.5);
  assert.strictEqual(plays[1].kind, 'gift');
  assert.strictEqual(plays[1].color, 'purple');
});

test('おみくじコマンドは omikuji 分類のメッセージ', (t) => {
  const { router, of } = setup(t);
  router.handle(createSimulationEvent('comment', { text: 'おみくじ', user: { key: 'a', name: 'A' } }));
  assert.strictEqual(of('play')[0].message.category, 'omikuji');
  assert.match(of('play')[0].headline, /今日のおみくじ/);
});

test('連続ギフトは1つの演出にまとまり、再生中は play:update でカウント更新', (t) => {
  const { router, of } = setup(t);
  for (let i = 0; i < 10; i++) router.handle(createSimulationEvent('gift', { giftId: 'rose', user: { key: 'a', name: 'A' } }));
  assert.strictEqual(of('play').length, 1);
  const ups = of('play:update');
  assert.strictEqual(ups.length, 9);
  assert.match(ups[8].headline, /×10/);
});

test('同時多発：シミュレーションと実イベントは別々にまとめられる', (t) => {
  const { router, queue } = setup(t);
  queue.pause();
  router.handle(createSimulationEvent('gift', { giftId: 'rose', user: { key: 'a', name: 'A' } }));
  router.handle(createLiveEvent('gift', { giftId: 'rose', user: { key: 'a', name: 'A' } }));
  assert.strictEqual(queue.lanes.normal.length, 2);
  assert.deepStrictEqual(queue.lanes.normal.map((x) => x.simulated), [true, false]);
});

test('手動演出：不正な色・分類は拒否', (t) => {
  const { router } = setup(t);
  assert.strictEqual(router.handle(createSimulationEvent('manual', { color: 'black' })).ok, false);
  assert.strictEqual(router.handle(createSimulationEvent('manual', { color: 'gold', category: '__proto__' })).ok, false);
  assert.strictEqual(router.handle(createSimulationEvent('manual', { color: 'gold', category: 'omikuji' })).ok, true);
});

test('視聴者ごとの状態は上限件数を超えて増えない', (t) => {
  const { router } = setup(t, { maxUsers: 50 });
  for (let i = 0; i < 500; i++) router.handle(createSimulationEvent('comment', { text: '赤', user: { key: `u${i}`, name: 'n' } }));
  assert.ok(router.users.size <= 50);
});
