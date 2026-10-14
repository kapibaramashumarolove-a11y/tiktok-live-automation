'use strict';

/**
 * 視聴者由来の文字列（コメント本文・表示名など）を検証し、画面に出して安全な文字列だけを返す。
 *
 * 方針：
 *  - 判定に引っかかった場合、元の文字列は返さない（text は null）。
 *  - reasons には理由コードのみを入れる。ログにも元の文字列は残さない（個人情報を保存しないため）。
 *  - 画面側も textContent で挿入するため、ここでの処理は二重の防御になる。
 *  - 機械的な判定には誤検知・見逃しがある。最終的な安全性を保証するものではない。
 */

const NG = require('../data/ngwords.json');

const RAW_LIMIT = 500; // 正規化前に切り詰める長さ（巨大入力対策）

const RE = {
  control: /[\u0000-\u001F\u007F-\u009F]/g,
  invisible: /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ￹-￻]|[\u{E0000}-\u{E007F}]/gu,
  combiningFlood: /(\p{M}{2})\p{M}+/gu,
  repeated: /(.)\1{4,}/gu,
  markup: /<\s*\/?\s*[a-z!?]|javascript\s*:|data\s*:\s*text\/html|\bon[a-z]+\s*=|&#?[a-z0-9]+;/i,
  url: /(?:https?:\/\/|ftp:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|jp|co|io|me|ly|gl|gg|xyz|info|biz|tv|app|link|site|online|shop|top|cc|be|to)\b)/i,
  email: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
  postal: /〒|\b\d{3}-\d{4}\b/,
  address: /丁目|番地|号室|\b\d{1,4}-\d{1,4}-\d{1,4}\b/,
  handle: /@[a-z0-9_.]{2,}/i,
  contact: /(?:line|ライン|らいん|インスタ|insta|twitter|ツイッター|discord|ディスコ|カカオ|kakao)\s*(?:id|ＩＤ|ｉｄ|アカ|垢)/i,
};

function digitCountOfLongestRun(text) {
  // 数字と区切り（ハイフン・空白・括弧・ドット）の連なりのうち、数字の個数が最大のもの
  const runs = text.match(/[0-9][0-9\-\s().]*[0-9]/g) || [];
  return runs.reduce((max, r) => Math.max(max, (r.match(/[0-9]/g) || []).length), 0);
}

function buildNg() {
  const allow = NG.allow.map((w) => compact(w.normalize('NFKC').toLowerCase()));
  const ja = [];
  for (const [category, words] of Object.entries(NG.ja)) {
    for (const w of words) ja.push({ category, word: compact(w.normalize('NFKC').toLowerCase()) });
  }
  const en = [];
  for (const [category, words] of Object.entries(NG.en)) {
    for (const w of words) {
      const phrase = w.toLowerCase().trim().replace(/\s+/g, ' ');
      en.push({ category, re: new RegExp(`(?:^| )${phrase.replace(/ /g, ' ?')}(?:e?s)?(?: |$)`) });
    }
  }
  return { allow, ja, en };
}

function compact(s) {
  return s.replace(/[\s\p{P}\p{S}]/gu, '');
}

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };

function englishForm(s) {
  const spaced = s
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c])
    .replace(/[^a-z]+/g, ' ')
    .trim();
  // "f u c k" のような1文字ずつの分かち書きを連結する
  return spaced.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, (m) => m.replace(/ /g, ''));
}

const NGI = buildNg();

function findNg(normalized) {
  const found = new Set();
  let ja = compact(normalized.toLowerCase());
  for (const a of NGI.allow) if (a) ja = ja.split(a).join('　');
  for (const { category, word } of NGI.ja) if (word && ja.includes(word)) found.add(category);
  const en = englishForm(normalized);
  if (en) for (const { category, re } of NGI.en) if (re.test(en)) found.add(category);
  return [...found];
}

/**
 * @param {unknown} input
 * @param {{maxLength?: number}} [opts]
 * @returns {{ok: boolean, text: string|null, reasons: string[]}}
 */
function sanitizeText(input, { maxLength = 40 } = {}) {
  if (typeof input !== 'string') return { ok: false, text: null, reasons: ['type'] };

  let s = input.length > RAW_LIMIT ? input.slice(0, RAW_LIMIT) : input;
  s = s.normalize('NFKC');
  s = s.replace(RE.control, ' ').replace(RE.invisible, '');
  s = s.replace(RE.combiningFlood, '$1');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(RE.repeated, '$1$1$1');

  if (!s) return { ok: false, text: null, reasons: ['empty'] };

  const reasons = [];
  if (RE.markup.test(s)) reasons.push('markup');
  if (RE.url.test(s)) reasons.push('url');
  if (RE.email.test(s)) reasons.push('pii:email');
  if (digitCountOfLongestRun(s) >= 8) reasons.push('pii:number');
  if (RE.postal.test(s)) reasons.push('pii:postal');
  if (RE.address.test(s)) reasons.push('pii:address');
  if (RE.contact.test(s)) reasons.push('pii:contact');
  if (RE.handle.test(s)) reasons.push('mention');
  for (const c of findNg(s)) reasons.push(`ng:${c}`);

  if (reasons.length) return { ok: false, text: null, reasons };

  // 画面上で記号として解釈されないよう、山括弧などは全角に置き換える
  s = s.replace(/[<>&"'`]/g, (c) => ({ '<': '＜', '>': '＞', '&': '＆', '"': '”', "'": '’', '`': '｀' })[c]);

  const chars = Array.from(s);
  if (chars.length > maxLength) s = chars.slice(0, maxLength - 1).join('') + '…';
  return { ok: true, text: s, reasons: [] };
}

/** 表示名用。不適切な場合は汎用名に置き換える（イベント自体は止めない）。 */
function sanitizeName(input, fallback = '視聴者') {
  const r = sanitizeText(input, { maxLength: 14 });
  return r.ok ? { name: r.text, replaced: false, reasons: [] } : { name: fallback, replaced: true, reasons: r.reasons };
}

module.exports = { sanitizeText, sanitizeName, _internal: { englishForm, findNg } };
