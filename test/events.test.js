'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createSimulationEvent, createLiveEvent, ORIGIN } = require('../src/events/eventFactory');
const { parseCommand } = require('../src/events/commentCommands');

test('シミュレーションイベントは受信データで origin を変更できない', () => {
  const e = createSimulationEvent('gift', { origin: 'live', simulated: false, tier: 'special', user: { key: 'u1', name: 'A' } });
  assert.strictEqual(e.origin, ORIGIN.SIMULATION);
  assert.strictEqual(e.simulated, true);
  assert.ok(e.id.startsWith('sim-'));
  assert.strictEqual(e.data.user.key, 'sim:u1');
  assert.strictEqual(e.data.origin, undefined);
  assert.strictEqual(e.data.simulated, undefined);
  assert.ok(Object.isFrozen(e));
  assert.ok(Object.isFrozen(e.data));
});

test('実イベントは simulated=false で、id の接頭辞が異なる', () => {
  const e = createLiveEvent('comment', { text: 'hi', user: { key: 'u', name: 'n' } });
  assert.strictEqual(e.origin, ORIGIN.LIVE);
  assert.strictEqual(e.simulated, false);
  assert.ok(e.id.startsWith('live-'));
  assert.strictEqual(e.data.user.key, 'u');
});

test('許可した項目以外は捨て、値を検証する', () => {
  const g = createSimulationEvent('gift', { tier: 'mega', count: 1e9, giftId: 42, extra: '<script>' });
  assert.strictEqual(g.data.tier, 'normal');
  assert.strictEqual(g.data.count, 999);
  assert.strictEqual(g.data.giftId, 'unknown');
  assert.strictEqual(g.data.extra, undefined);
  assert.strictEqual(createSimulationEvent('gift', { count: -5 }).data.count, 1);
  assert.strictEqual(createSimulationEvent('gift', { count: 'abc' }).data.count, 1);
  assert.strictEqual(createSimulationEvent('comment', null).data.text, '');
  assert.strictEqual(createSimulationEvent('comment', { text: 'x'.repeat(9999) }).data.text.length, 500);
});

test('不正な type / origin は例外', () => {
  assert.throws(() => createSimulationEvent('hack', {}), /invalid event type/);
});

test('コメントコマンドの解析', () => {
  assert.deepStrictEqual(parseCommand('ゴールド!'), { command: 'color', color: 'gold' });
  assert.deepStrictEqual(parseCommand('青'), { command: 'color', color: 'blue' });
  assert.deepStrictEqual(parseCommand('Red please'), { command: 'color', color: 'red' });
  assert.deepStrictEqual(parseCommand('虹色がいい'), { command: 'color', color: 'rainbow' });
  assert.deepStrictEqual(parseCommand('おみくじ引きたい'), { command: 'omikuji' });
  assert.strictEqual(parseCommand('I am tired'), null);   // red の誤一致なし
  assert.strictEqual(parseCommand('青春だね'), null);      // 一文字の色は完全一致のみ
  assert.strictEqual(parseCommand('金曜日'), null);
  assert.strictEqual(parseCommand('こんばんは'), null);
  assert.strictEqual(parseCommand(''), null);
});
