'use strict';

/**
 * 配信者向けのコメント返答候補（定型文）を選ぶ。
 * 入力はサニタイズ済みのコメント本文。生成AIは使わず、src/data/replyTemplates.json の定型文から選ぶ。
 * 候補は配信者が読み上げる、または管理パネルで選んで画面に表示するためのもので、自動では表示しない。
 */
const T = require('../data/replyTemplates.json');

const COLOR_NAMES = {
  gold: 'ゴールド', purple: 'パープル', green: 'グリーン', pink: 'ピンク', blue: 'ブルー',
  red: 'レッド', white: 'ホワイト', aqua: 'アクア', orange: 'オレンジ', rainbow: 'レインボー',
};

const RULES = T.rules.map((r) => ({ kind: r.kind, re: new RegExp(r.pattern, 'i'), replies: r.replies }));

/**
 * @param {string} text サニタイズ済み本文
 * @param {{type: string, color?: string}|null} command
 * @returns {{kind: string, replies: string[]}}
 */
function replyCandidates(text, command) {
  if (command && command.type === 'color' && command.color) {
    const name = COLOR_NAMES[command.color] || command.color;
    return { kind: 'color', replies: T.commands.color.map((s) => s.replace('{color}', name)) };
  }
  if (command && command.type === 'omikuji') return { kind: 'omikuji', replies: [...T.commands.omikuji] };
  const rule = RULES.find((r) => r.re.test(text || ''));
  return rule ? { kind: rule.kind, replies: [...rule.replies] } : { kind: 'default', replies: [...T.default] };
}

module.exports = { replyCandidates, COLOR_NAMES };
