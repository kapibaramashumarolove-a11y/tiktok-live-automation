'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MessagePicker } = require('../src/lib/messagePicker');
const data = require('../src/data/messages.json');

test('直近N件と重複しない（色ごと）', () => {
  const N = 10;
  const p = new MessagePicker(data, { historySize: N });
  for (const color of p.colors()) {
    const picked = [];
    for (let i = 0; i < 500; i++) picked.push(p.pick(color).id);
    for (let i = 0; i < picked.length; i++) {
      const window = picked.slice(Math.max(0, i - N), i);
      assert.ok(!window.includes(picked[i]), `${color} #${i} が直近${N}件と重複`);
    }
  }
});

test('カテゴリ指定時は候補数より大きい履歴でも抽選できる', () => {
  const p = new MessagePicker(data, { historySize: 20 });
  let prev = null;
  for (let i = 0; i < 50; i++) {
    const m = p.pick('gold', 'question');
    assert.strictEqual(m.category, 'question');
    assert.notStrictEqual(m.id, prev, '連続で同じメッセージ');
    prev = m.id;
  }
});

test('全メッセージが抽選対象になる', () => {
  const p = new MessagePicker(data, { historySize: 10 });
  const ids = new Set();
  for (let i = 0; i < 3000; i++) ids.add(p.pick('rainbow').id);
  assert.strictEqual(ids.size, 30);
});

test('履歴は上限で切り詰められる（メモリが増え続けない）', () => {
  const p = new MessagePicker(data, { historySize: 5 });
  for (let i = 0; i < 1000; i++) p.pick('blue');
  assert.ok(p.history.get('blue').length <= 5);
});

test('historySize=0 でも動作する', () => {
  const p = new MessagePicker(data, { historySize: 0 });
  for (let i = 0; i < 20; i++) p.pick('red');
  assert.ok(p.history.get('red').length <= 1);
});

test('不明な色はエラー', () => {
  const p = new MessagePicker(data);
  assert.throws(() => p.pick('black'), /unknown color/);
});

test('ラベルが付与される', () => {
  const p = new MessagePicker(data);
  const m = p.pick('green', 'omikuji');
  assert.strictEqual(m.categoryLabel, '今日のおみくじ');
});
