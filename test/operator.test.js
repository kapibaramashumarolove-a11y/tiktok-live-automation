'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EffectQueue } = require('../src/lib/effectQueue');
const { EventRouter } = require('../src/events/router');
const { MessagePicker } = require('../src/lib/messagePicker');
const { createSimulationEvent, createLiveEvent, createOperatorEvent } = require('../src/events/eventFactory');
const { replyCandidates } = require('../src/events/replyCandidates');
const data = require('../src/data/messages.json');
const tpl = require('../src/data/replyTemplates.json');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 9_000_000 });
  const emitted = [];
  const admin = [];
  const queue = new EffectQueue({ gapMs: 100 });
  const router = new EventRouter({
    queue,
    picker: new MessagePicker(data),
    emit: (name, payload) => emitted.push({ name, payload }),
    adminEmit: (name, payload) => admin.push({ name, payload }),
    log: { event: () => {} },
    feed: { intervalMs: 100, maxBuffer: 5 },
  });
  const of = (name, list = emitted) => list.filter((e) => e.name === name).map((e) => e.payload);
  const tick = (ms) => { for (let left = ms; left > 0; left -= Math.min(50, left)) t.mock.timers.tick(Math.min(50, left)); };
  return { queue, router, emitted, admin, of, tick };
}

test('配信者のイベントはギフト形式を作れない', () => {
  assert.throws(() => createOperatorEvent('gift', {}), /invalid event type for operator/);
  assert.throws(() => createOperatorEvent('comment', {}), /invalid event type for operator/);
  assert.throws(() => createSimulationEvent('message', {}), /invalid event type/);
  assert.throws(() => createLiveEvent('message', {}), /invalid event type/);
  const e = createOperatorEvent('manual', { color: 'gold' });
  assert.strictEqual(e.origin, 'operator');
  assert.strictEqual(e.simulated, false);
  assert.ok(e.id.startsWith('op-'));
});

test('手動オーバーライド（割り込み）は再生中を打ち切って即再生し、一時停止中でも再生する', (t) => {
  const { router, of } = setup(t);
  router.handle(createSimulationEvent('gift', { giftId: 'a', user: { key: 'u', name: 'A' } }));
  router.pause();
  const r = router.handle(createOperatorEvent('manual', { color: 'blue', category: 'blessing', interrupt: true }));
  assert.strictEqual(r.queue.status, 'playing');
  const plays = of('play');
  assert.strictEqual(plays.length, 2);
  assert.strictEqual(plays[1].origin, 'operator');
  assert.strictEqual(plays[1].color, 'blue');
  assert.strictEqual(plays[1].message.category, 'blessing');
  assert.strictEqual(of('play:end')[0].id, plays[0].id);
});

test('シミュレーションからの割り込み指定は無視される（キューに並ぶ）', (t) => {
  const { router } = setup(t);
  router.handle(createSimulationEvent('gift', { giftId: 'a', user: { key: 'u', name: 'A' } }));
  const r = router.handle(createSimulationEvent('manual', { color: 'blue', interrupt: true }));
  assert.strictEqual(r.queue.status, 'queued');
});

test('配信者メッセージ：サニタイズ済みの本文を表示、NGは拒否', (t) => {
  const { router, of } = setup(t);
  const ok = router.handle(createOperatorEvent('message', { text: 'みなさん、今日もありがとう！', color: 'pink' }));
  assert.ok(ok.ok);
  const p = of('play')[0];
  assert.strictEqual(p.kind, 'operator-message');
  assert.strictEqual(p.headline, '配信者からのメッセージ');
  assert.strictEqual(p.message.text, 'みなさん、今日もありがとう!');
  assert.strictEqual(p.origin, 'operator');
  assert.strictEqual(p.simulated, false);

  for (const bad of ['<script>x</script>', 'https://example.com', '090-1234-5678', 'バカ']) {
    const r = router.handle(createOperatorEvent('message', { text: bad }));
    assert.strictEqual(r.ok, false, bad);
    assert.ok(r.reasons.length > 0);
  }
  assert.strictEqual(router.handle(createOperatorEvent('message', { text: 'こんにちは', target: 'バカ' })).ok, false);
});

test('コメントへの返答：宛先付きで表示', (t) => {
  const { router, of } = setup(t);
  router.handle(createOperatorEvent('message', { text: '来てくれてありがとう！', target: '【テスト】さくら', interrupt: true }));
  const p = of('play')[0];
  assert.strictEqual(p.kind, 'reply');
  assert.strictEqual(p.headline, '【テスト】さくらさんへ');
  assert.strictEqual(p.message.categoryLabel, '配信者からの返答');
});

test('全停止：画面消去を通知し、配信者以外のイベントを受け付けない。再開で戻る', (t) => {
  const { router, queue, of, tick } = setup(t);
  router.handle(createSimulationEvent('gift', { giftId: 'a', user: { key: 'u', name: 'A' } }));
  router.handle(createSimulationEvent('gift', { giftId: 'b', user: { key: 'u', name: 'A' } }));
  router.handle(createSimulationEvent('comment', { text: 'こんばんは', user: { key: 'u', name: 'A' } }));
  router.stopAll();
  assert.strictEqual(of('stop').length, 1);
  assert.strictEqual(queue.size(), 0);
  assert.strictEqual(queue.current, null);
  const r = router.handle(createSimulationEvent('gift', { giftId: 'c', user: { key: 'u', name: 'A' } }));
  assert.strictEqual(r.ignored, 'stopped');
  assert.strictEqual(router.handle(createLiveEvent('comment', { text: 'hi', user: { key: 'x', name: 'x' } })).ignored, 'stopped');
  tick(20000);
  assert.strictEqual(of('play').length, 1);
  // 配信者の操作は全停止中でも可能
  assert.ok(router.handle(createOperatorEvent('message', { text: 'しばらくお待ちください', interrupt: true })).ok);
  assert.strictEqual(of('play').length, 2);
  router.resume();
  assert.strictEqual(router.runState, 'running');
  router.handle(createSimulationEvent('gift', { giftId: 'd', user: { key: 'u', name: 'A' } }));
  tick(20000);
  assert.strictEqual(of('play').length, 3);
});

test('一時停止：新しい演出もコメント表示も止まり、再開で流れる', (t) => {
  const { router, of, tick } = setup(t);
  router.pause();
  router.handle(createSimulationEvent('gift', { giftId: 'a', user: { key: 'u', name: 'A' } }));
  const c = router.handle(createSimulationEvent('comment', { text: 'こんばんは', user: { key: 'u', name: 'A' } }));
  assert.strictEqual(c.displayed, false);
  tick(10000);
  assert.strictEqual(of('play').length, 0);
  assert.strictEqual(of('comment').length, 0);
  router.resume();
  assert.strictEqual(of('play').length, 1);
});

test('スキップ・待ち分の破棄', (t) => {
  const { router, queue, of, tick } = setup(t);
  for (let i = 0; i < 3; i++) router.handle(createSimulationEvent('gift', { giftId: `g${i}`, user: { key: `u${i}`, name: 'A' } }));
  router.skip();
  tick(100);
  assert.strictEqual(of('play').length, 2);
  router.clearWaiting();
  assert.strictEqual(queue.size(), 0);
});

test('設定：ギフト演出・コメント表示・コマンドを個別にオフ', (t) => {
  const { router, of, tick } = setup(t);
  router.setSettings({ giftEffects: false, commentDisplay: false, commentCommands: false, unknown: true });
  assert.strictEqual(router.settings.unknown, undefined);
  assert.strictEqual(router.handle(createSimulationEvent('gift', { user: { key: 'u', name: 'A' } })).ignored, 'giftEffects-off');
  const c = router.handle(createSimulationEvent('comment', { text: 'ゴールド', user: { key: 'u', name: 'A' } }));
  assert.strictEqual(c.displayed, false);
  assert.strictEqual(c.command, null);
  tick(5000);
  assert.strictEqual(of('play').length, 0);
  assert.strictEqual(of('comment').length, 0);
  router.setSettings({ giftEffects: 'yes' }); // 真偽値以外は無視
  assert.strictEqual(router.settings.giftEffects, false);
});

test('管理パネルへ：コメントと返答候補を送る。ブロックしたコメントは本文を送らない', (t) => {
  const { router, admin, of } = setup(t);
  router.handle(createSimulationEvent('comment', { text: 'こんばんは！', user: { key: 'u', name: 'A' } }));
  router.handle(createSimulationEvent('comment', { text: '電話 090-1234-5678', user: { key: 'u2', name: 'B' } }));
  const list = of('admin:comment', admin);
  assert.strictEqual(list[0].replyKind, 'greeting');
  assert.strictEqual(list[0].candidates.length, 3);
  assert.strictEqual(list[0].name, '【テスト】A');
  assert.strictEqual(list[1].blocked, true);
  assert.strictEqual(list[1].text, undefined);
  assert.ok(!JSON.stringify(admin).includes('1234-5678'));
  assert.strictEqual(router.recentComments.length, 2);
});

test('管理パネル向けの保持件数に上限がある', (t) => {
  const { router } = setup(t);
  for (let i = 0; i < 300; i++) router.handle(createSimulationEvent('comment', { text: `こんにちは${i}`, user: { key: `u${i}`, name: 'A' } }));
  assert.ok(router.recentComments.length <= 50);
  assert.ok(router.recentLogs.length <= 100);
});

test('返答候補', () => {
  assert.strictEqual(replyCandidates('はじめまして').kind, 'greeting');
  assert.strictEqual(replyCandidates('おやすみ〜').kind, 'farewell');
  assert.strictEqual(replyCandidates('すごくきれい').kind, 'praise');
  assert.strictEqual(replyCandidates('これは何ですか?').kind, 'question');
  assert.strictEqual(replyCandidates('ふむふむ').kind, 'default');
  const c = replyCandidates('ゴールド', { type: 'color', color: 'gold' });
  assert.strictEqual(c.kind, 'color');
  assert.ok(c.replies.every((r) => r.includes('ゴールド')));
  assert.strictEqual(replyCandidates('おみくじ', { type: 'omikuji' }).kind, 'omikuji');
});

test('返答候補の定型文に禁止表現が含まれない', () => {
  const all = [...tpl.rules.flatMap((r) => r.replies), ...tpl.commands.color, ...tpl.commands.omikuji, ...tpl.default];
  const banned = ['必ず', '絶対', '保証', '不幸', '災い', 'ギフト', '送って', '投げ銭', 'コイン'];
  for (const s of all) for (const w of banned) assert.ok(!s.includes(w), `${w}: ${s}`);
});
