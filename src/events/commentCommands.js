'use strict';

/**
 * コメントから「色の選択」「今日のおみくじ」を読み取る。
 * 入力はサニタイズ済みの文字列を前提とする。
 *  - contains: 文中に含まれていれば一致（カタカナ語・ひらがな語）
 *  - word    : 英単語として独立して含まれていれば一致（"red" が "tired" に誤一致しないように）
 *  - exact   : 記号を除いたコメント全体が一致（「青」「金色」など、短く他の語に含まれやすいもの）
 */
const COLOR_WORDS = {
  gold: { contains: ['ゴールド', '黄金'], word: ['gold'], exact: ['金', '金色'] },
  purple: { contains: ['パープル', 'むらさき'], word: ['purple'], exact: ['紫', '紫色'] },
  green: { contains: ['グリーン', 'みどり'], word: ['green'], exact: ['緑', '緑色'] },
  pink: { contains: ['ピンク', '桃色'], word: ['pink'], exact: [] },
  blue: { contains: ['ブルー'], word: ['blue'], exact: ['青', '青色'] },
  red: { contains: ['レッド'], word: ['red'], exact: ['赤', '赤色'] },
  white: { contains: ['ホワイト'], word: ['white'], exact: ['白', '白色'] },
  aqua: { contains: ['アクア', '水色'], word: ['aqua'], exact: [] },
  orange: { contains: ['オレンジ', '橙色'], word: ['orange'], exact: ['橙'] },
  rainbow: { contains: ['レインボー', '七色', 'にじいろ', '虹色'], word: ['rainbow'], exact: ['虹'] },
};
const OMIKUJI = ['おみくじ', 'オミクジ', '御神籤', 'omikuji'];

function strip(s) {
  return s.replace(/[\s\p{P}\p{S}]/gu, '');
}

/** @returns {{command: 'color', color: string} | {command: 'omikuji'} | null} */
function parseCommand(text) {
  if (typeof text !== 'string' || !text) return null;
  const lower = text.toLowerCase();
  const bare = strip(lower);
  if (OMIKUJI.some((w) => lower.includes(w))) return { command: 'omikuji' };
  const words = lower.split(/[^a-z]+/).filter(Boolean);
  for (const [color, def] of Object.entries(COLOR_WORDS)) {
    if (def.exact.includes(bare) || def.contains.some((w) => lower.includes(w)) || def.word.some((w) => words.includes(w))) {
      return { command: 'color', color };
    }
  }
  return null;
}

module.exports = { parseCommand, COLOR_WORDS };
