'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sanitizeText, sanitizeName } = require('../src/lib/sanitize');

const ok = (s, opts) => {
  const r = sanitizeText(s, opts);
  assert.ok(r.ok, `表示されるべき: ${JSON.stringify(s)} reasons=${r.reasons}`);
  return r.text;
};
const ng = (s, reasonPrefix) => {
  const r = sanitizeText(s);
  assert.strictEqual(r.ok, false, `ブロックされるべき: ${JSON.stringify(s)}`);
  assert.strictEqual(r.text, null, 'ブロック時は元の文字列を返さない');
  if (reasonPrefix) assert.ok(r.reasons.some((x) => x.startsWith(reasonPrefix)), `${JSON.stringify(s)} reasons=${r.reasons}`);
};

test('通常のコメントはそのまま表示できる', () => {
  assert.strictEqual(ok('こんばんは！今日も癒やされます'), 'こんばんは!今日も癒やされます'); // NFKC で全角記号は半角へ
  ok('ゴールド');
  ok('ばかりじゃない、すごい');      // 「ばか」の例外
  ok('お天気がくずれるね');          // 「くず」の例外
  ok('I am so tired today');         // red を誤検知しない
  ok('Great skill!');
  ok('grape juice');                 // 英語の部分一致誤検知をしない
  ok('2024年に始めました');           // 短い数字は個人情報扱いしない
  ok('8888');
});

test('型・空文字', () => {
  assert.deepStrictEqual(sanitizeText(123).reasons, ['type']);
  assert.deepStrictEqual(sanitizeText(null).reasons, ['type']);
  assert.deepStrictEqual(sanitizeText('   ').reasons, ['empty']);
  assert.deepStrictEqual(sanitizeText('​​').reasons, ['empty']);
});

test('HTML・スクリプト風の文字列はブロック', () => {
  ng('<script>alert(1)</script>', 'markup');
  ng('<img src=x onerror=alert(1)>', 'markup');
  ng('javascript:alert(1)', 'markup');
  ng('&lt;b&gt;', 'markup');
  ng('<b>太字</b>', 'markup');
});

test('タグでない山括弧などは全角に置換して表示', () => {
  assert.strictEqual(ok('大好き <3'), '大好き ＜3');
  assert.strictEqual(ok('A & B'), 'A ＆ B');
  assert.strictEqual(ok('"quote"'), '”quote”');
});

test('制御文字・不可視文字・方向制御文字を除去', () => {
  assert.strictEqual(ok('きれい​ですね‮'), 'きれいですね');
  assert.strictEqual(ok('a\u0000b\u0007c'), 'a b c');
  assert.strictEqual(ok('tag\u{E0041}\u{E0042}'), 'tag');
});

test('結合文字の連打（Zalgo）を抑制', () => {
  const zalgo = 'a' + '́'.repeat(30) + 'b';
  const t = ok(zalgo);
  assert.ok(Array.from(t).length <= 4, t);
});

test('同じ文字の連続を3文字に圧縮', () => {
  assert.strictEqual(ok('わあああああああああああ'), 'わあああ');
});

test('長すぎる文字列は切り詰め', () => {
  const t = ok('あ'.repeat(3) + 'い'.repeat(3) + 'う'.repeat(3) + 'えおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよ', { maxLength: 20 });
  assert.strictEqual(Array.from(t).length, 20);
  assert.ok(t.endsWith('…'));
  // 巨大入力でも例外にならない
  assert.ok(sanitizeText('x'.repeat(100000)).ok);
});

test('URL はブロック', () => {
  ng('https://example.com を見て', 'url');
  ng('www.example.jp', 'url');
  ng('example.com', 'url');
  ng('ｈｔｔｐｓ：／／ｅｘａｍｐｌｅ．ｃｏｍ', 'url'); // 全角も NFKC で検出
});

test('個人情報らしき文字列はブロック', () => {
  ng('電話して 090-1234-5678', 'pii:number');
  ng('０９０１２３４５６７８', 'pii:number');
  ng('+81 90 1234 5678', 'pii:number');
  ng('test@example.com に連絡', 'pii:email');
  ng('〒160-0023', 'pii:postal');
  ng('東京都新宿区西新宿2丁目8-1', 'pii:address');
  ng('1-2-3に住んでる', 'pii:address');
  ng('LINE ID教えて', 'pii:contact');
  ng('@someone見て', 'mention');
});

test('攻撃的・不適切な表現はブロック', () => {
  ng('お前バカだろ', 'ng:harassment');
  ng('しね', 'ng:harassment');
  ng('死 ね', 'ng:harassment');         // 空白を挟む回避
  ng('ﾊﾞｶ', 'ng:harassment');            // 半角カナ
  ng('殺す', 'ng:violence');
  ng('f u c k', 'ng:harassment');        // 1文字ずつの分かち書き
  ng('FUCK', 'ng:harassment');
  ng('sh1t', 'ng:harassment');           // 数字への置き換え
  ng('you idiots', 'ng:harassment');     // 複数形
  ng('kys', 'ng:self_harm');
  ng('自殺', 'ng:self_harm');
  ng('ガイジ', 'ng:discrimination');
  ng('パパ活しよ', 'ng:sexual');
});

test('表示名：不適切なら汎用名に置換', () => {
  assert.deepStrictEqual(sanitizeName('さくら'), { name: 'さくら', replaced: false, reasons: [] });
  const r = sanitizeName('バカ太郎');
  assert.strictEqual(r.name, '視聴者');
  assert.ok(r.replaced);
  assert.strictEqual(sanitizeName(undefined).name, '視聴者');
  assert.strictEqual(Array.from(sanitizeName('あいうえおかきくけこさしすせそたちつてと').name).length, 14);
});
