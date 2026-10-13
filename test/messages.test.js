'use strict';

const test = require('node:test');
const assert = require('node:assert');
const data = require('../src/data/messages.json');

const COLORS = ['gold', 'purple', 'green', 'pink', 'blue', 'red', 'white', 'aqua', 'orange', 'rainbow'];
const CATEGORIES = ['omikuji', 'positive', 'question', 'gratitude', 'cheer', 'blessing'];

// 不安喚起・災いの予告・結果の保証・ギフト誘導につながりやすい語。
// 機械チェックは補助であり、最終確認は人の目で行うこと。
const BANNED = [
  '必ず', '絶対', '確実', '保証', '不幸', '災い', '災難', '呪', '祟', '厄', '凶', '危険', '病気', '治る', '治ります',
  '儲か', '当選', '大金', '宝くじ', '結婚でき', '復縁', '別れ', 'ギフト', '投げ銭', 'コイン', '送って', '送らない', 'しないと',
];

test('10色すべてが定義されている', () => {
  assert.deepStrictEqual(Object.keys(data.colors).sort(), [...COLORS].sort());
});

test('各色に6分類があり、合計30件以上', () => {
  for (const color of COLORS) {
    const byCat = data.colors[color];
    assert.deepStrictEqual(Object.keys(byCat).sort(), [...CATEGORIES].sort(), color);
    const total = Object.values(byCat).reduce((n, a) => n + a.length, 0);
    assert.ok(total >= 30, `${color}: ${total} 件`);
    for (const cat of CATEGORIES) assert.ok(byCat[cat].length >= 1, `${color}/${cat}`);
  }
});

test('全メッセージが空でなく、画面に収まる長さで、重複していない', () => {
  const seen = new Set();
  for (const [color, byCat] of Object.entries(data.colors)) {
    for (const [cat, list] of Object.entries(byCat)) {
      for (const text of list) {
        assert.ok(typeof text === 'string' && text.trim().length > 0, `${color}/${cat}`);
        assert.ok(text.length <= 60, `長すぎ(${text.length}): ${text}`);
        assert.ok(!seen.has(text), `重複: ${text}`);
        seen.add(text);
      }
    }
  }
});

test('禁止語を含まない', () => {
  for (const [color, byCat] of Object.entries(data.colors)) {
    for (const [cat, list] of Object.entries(byCat)) {
      for (const text of list) {
        for (const w of BANNED) assert.ok(!text.includes(w), `${color}/${cat}: 「${w}」を含む: ${text}`);
      }
    }
  }
});
