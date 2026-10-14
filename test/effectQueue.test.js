'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EffectQueue } = require('../src/lib/effectQueue');

function setup(t, opts) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const q = new EffectQueue({ gapMs: 500, maxWaitMs: 20000, minDurationMs: 1000, ...opts });
  const played = [];
  const updates = [];
  q.on('play', (i) => played.push(i));
  q.on('update', (i) => updates.push({ id: i.id, count: i.count }));
  // mock.timers.tick は時刻を先に進めるため、コールバック内で登録したタイマーがずれないよう小刻みに進める
  const tick = (ms) => { for (let left = ms; left > 0; left -= Math.min(50, left)) t.mock.timers.tick(Math.min(50, left)); };
  return { q, played, updates, tick };
}

const item = (o) => ({ lane: 'normal', kind: 'gift', durationMs: 4000, ...o });

test('1件ずつ順番に再生し、重ならない', (t) => {
  const { q, played, tick } = setup(t);
  q.enqueue(item({ name: 'a' }));
  q.enqueue(item({ name: 'b' }));
  q.enqueue(item({ name: 'c' }));
  assert.strictEqual(played.length, 1);
  assert.strictEqual(q.state, 'playing');
  tick(3999);
  assert.strictEqual(played.length, 1);
  tick(1); // 終了 → 間隔
  assert.strictEqual(q.state, 'gap');
  assert.strictEqual(played.length, 1);
  tick(500);
  assert.strictEqual(played.length, 2);
  assert.deepStrictEqual(played.map((p) => p.name), ['a', 'b']);
  tick(4500);
  assert.deepStrictEqual(played.map((p) => p.name), ['a', 'b', 'c']);
  tick(4500);
  assert.strictEqual(q.state, 'idle');
});

test('優先度：high > normal > low', (t) => {
  const { q, played, tick } = setup(t);
  q.enqueue(item({ name: 'first' })); // 再生開始
  q.enqueue(item({ lane: 'low', name: 'low' }));
  q.enqueue(item({ lane: 'normal', name: 'normal' }));
  q.enqueue(item({ lane: 'high', name: 'high' }));
  for (let i = 0; i < 3; i++) tick(4500);
  assert.deepStrictEqual(played.map((p) => p.name), ['first', 'high', 'normal', 'low']);
});

test('待ちすぎた低優先度は先に再生（取り残し防止）', (t) => {
  const { q, played, tick } = setup(t, { maxWaitMs: 10000 });
  q.enqueue(item({ name: 'first', durationMs: 12000 }));
  q.enqueue(item({ lane: 'low', name: 'low' }));
  tick(11000);
  q.enqueue(item({ lane: 'high', name: 'high' }));
  tick(1500);
  assert.deepStrictEqual(played.map((p) => p.name), ['first', 'low']);
});

test('待ちすぎた低優先度は繰り上げるが、連続では占有しない', (t) => {
  const { q, played, tick } = setup(t, { maxWaitMs: 10000 });
  q.pause();
  for (let i = 0; i < 4; i++) q.enqueue(item({ lane: 'normal', name: `n${i}` }));
  for (let i = 0; i < 3; i++) q.enqueue(item({ lane: 'low', name: `l${i}` }));
  tick(11000); // すべて待ち時間超過
  q.resume();
  for (let i = 0; i < 7; i++) tick(4600);
  assert.deepStrictEqual(played.map((p) => p.name), ['l0', 'n0', 'l1', 'n1', 'l2', 'n2', 'n3']);
});

test('同じ mergeKey は待機中ならまとめてカウント加算', (t) => {
  const { q, played, tick } = setup(t);
  q.enqueue(item({ name: 'first' }));
  const r1 = q.enqueue(item({ mergeKey: 'u1|rose', count: 1 }));
  const r2 = q.enqueue(item({ mergeKey: 'u1|rose', count: 2 }));
  const r3 = q.enqueue(item({ mergeKey: 'u2|rose', count: 1 }));
  assert.strictEqual(r1.status, 'queued');
  assert.strictEqual(r2.status, 'merged');
  assert.strictEqual(r2.id, r1.id);
  assert.strictEqual(r3.status, 'queued');
  tick(4500);
  assert.strictEqual(played[1].count, 3);
});

test('再生中と同じ mergeKey は update を出し、表示を少し延長（上限あり）', (t) => {
  const { q, played, updates, tick } = setup(t, { extendMs: 1000, maxExtendMs: 2000 });
  q.enqueue(item({ mergeKey: 'u1|rose' }));
  for (let i = 0; i < 5; i++) assert.strictEqual(q.enqueue(item({ mergeKey: 'u1|rose' })).status, 'merged-playing');
  assert.strictEqual(updates.length, 5);
  assert.strictEqual(updates[4].count, 6);
  tick(5999);
  assert.strictEqual(q.state, 'playing'); // 4000 + 最大2000
  tick(1);
  assert.strictEqual(q.state, 'gap');
  assert.strictEqual(played.length, 1);
});

test('待機が多いほど表示時間を短縮（下限あり）', (t) => {
  const { q, played } = setup(t, { lanes: { high: 50, normal: 50, low: 50 } });
  q.pause();
  for (let i = 0; i < 25; i++) q.enqueue(item({ durationMs: 4000 }));
  q.resume();
  assert.strictEqual(played[0].playDurationMs, 1600); // 24件待ち → x0.4
});

test('短縮しても下限を下回らない', (t) => {
  const { q, played } = setup(t, { lanes: { high: 50, normal: 50, low: 50 } });
  q.pause();
  for (let i = 0; i < 25; i++) q.enqueue(item({ durationMs: 1500 }));
  q.resume();
  assert.strictEqual(played[0].playDurationMs, 1000);
});

test('レーン上限超過：summarizable は1件のまとめに集約、それ以外は破棄', (t) => {
  const { q } = setup(t, { lanes: { high: 2, normal: 3, low: 2 } });
  q.pause();
  const res = [];
  for (let i = 0; i < 10; i++) res.push(q.enqueue(item({ summarizable: true, userKey: `u${i % 4}` })).status);
  assert.deepStrictEqual(res.slice(0, 3), ['queued', 'queued', 'queued']);
  assert.ok(res.slice(3).every((s) => s === 'summarized'));
  const summary = q.lanes.normal.find((x) => x.kind === 'summary');
  assert.strictEqual(summary.count, 7);
  assert.strictEqual(summary.users.size, 4);
  assert.strictEqual(q.lanes.normal.length, 4); // 上限 + まとめ枠1

  q.enqueue(item({ lane: 'low' }));
  q.enqueue(item({ lane: 'low' }));
  assert.strictEqual(q.enqueue(item({ lane: 'low' })).status, 'dropped');
  assert.strictEqual(q.stats().counters.dropped, 1);
});

test('pause / resume / skip / clear / stopAll', (t) => {
  const { q, played, tick } = setup(t);
  q.pause();
  q.enqueue(item({ name: 'a' }));
  q.enqueue(item({ name: 'b' }));
  assert.strictEqual(played.length, 0);
  q.resume();
  assert.strictEqual(played.length, 1);
  q.skip();
  tick(500);
  assert.strictEqual(played.length, 2);
  q.enqueue(item({ name: 'c' }));
  q.clear();
  assert.strictEqual(q.size(), 0);
  q.stopAll();
  assert.strictEqual(q.state, 'idle');
  assert.strictEqual(q.current, null);
  tick(10000);
  assert.strictEqual(played.length, 2);
});

test('大量投入でもメモリが上限内に収まる', (t) => {
  const { q } = setup(t);
  q.pause();
  for (let i = 0; i < 10000; i++) {
    q.enqueue(item({ lane: ['high', 'normal', 'low'][i % 3], summarizable: i % 2 === 0, userKey: `u${i}`, mergeKey: i % 5 === 0 ? `m${i % 50}` : undefined }));
  }
  assert.ok(q.size() <= 10 + 20 + 10 + 3, `size=${q.size()}`);
});
