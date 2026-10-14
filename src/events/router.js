'use strict';

const { sanitizeText, sanitizeName } = require('../lib/sanitize');
const { parseCommand } = require('./commentCommands');
const { CommentFeed } = require('../lib/commentFeed');

const NORMAL_COLORS = ['gold', 'purple', 'green', 'pink', 'blue', 'red', 'white', 'aqua', 'orange'];
const COLOR_NAMES = {
  gold: 'ゴールド', purple: 'パープル', green: 'グリーン', pink: 'ピンク', blue: 'ブルー',
  red: 'レッド', white: 'ホワイト', aqua: 'アクア', orange: 'オレンジ', rainbow: 'レインボー',
};
const TEST_PREFIX = '【テスト】';

const DURATION = { special: 9000, gift: 6500, manual: 7000, command: 5000, summary: 7000 };

function hashIndex(s, n) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % n;
}

/**
 * 正規化済みイベント（eventFactory 生成）を受け取り、検証・フィルター・キュー投入を行う。
 * 画面へ送る文字列は、ここでサニタイズ済みのものだけに限定する。
 */
class EventRouter {
  constructor({ queue, picker, emit, log, commandCooldownMs = 30000, maxUsers = 5000, feed = {} }) {
    this.queue = queue;
    this.picker = picker;
    this.emit = emit;
    this.log = log;
    this.commandCooldownMs = commandCooldownMs;
    this.maxUsers = maxUsers;
    this.users = new Map(); // userKey -> {color, lastCommandAt}（挿入順で古いものから削除）
    this.stats = { blockedComments: 0, blockedNames: 0, cooldownSkips: 0 };

    this.feed = new CommentFeed({ ...feed, onEmit: (c) => this.emit('comment', c) });

    queue.on('play', (item) => this.onPlay(item));
    queue.on('update', (item) => this.emit('play:update', { id: item.id, count: item.count, headline: this.headline(item) }));
    queue.on('end', (item) => this.emit('play:end', { id: item.id }));
    queue.on('drop', (item, reason) => this.log.event(item.simulated, `演出を破棄 kind=${item.kind} reason=${reason}`));
  }

  userState(key) {
    let s = this.users.get(key);
    if (s) {
      this.users.delete(key); // 最近使ったものを末尾へ
    } else {
      s = { color: null, lastCommandAt: 0 };
      if (this.users.size >= this.maxUsers) this.users.delete(this.users.keys().next().value);
    }
    this.users.set(key, s);
    return s;
  }

  displayName(event) {
    const r = sanitizeName(event.data.user && event.data.user.name);
    if (r.replaced && event.data.user && event.data.user.name) {
      this.stats.blockedNames++;
      this.log.event(event, `表示名を汎用名に置換 reasons=${r.reasons.join(',')}`);
    }
    return event.simulated ? `${TEST_PREFIX}${r.name}` : r.name;
  }

  /** @returns {object} 呼び出し元（テストUI）へ返す処理結果 */
  handle(event) {
    switch (event.type) {
      case 'gift': return this.handleGift(event);
      case 'comment': return this.handleComment(event);
      case 'manual': return this.handleManual(event);
      default: return { ok: false, error: 'unknown type' };
    }
  }

  handleGift(event) {
    const d = event.data;
    const userKey = d.user.key || `${event.origin}:anon`;
    const name = this.displayName(event);
    const giftName = sanitizeText(d.giftName, { maxLength: 16 });
    const label = giftName.ok ? giftName.text : 'ギフト';
    const special = d.tier === 'special';
    const chosen = this.users.get(userKey);
    const color = special ? 'rainbow' : (chosen && chosen.color) || NORMAL_COLORS[hashIndex(d.giftId, NORMAL_COLORS.length)];

    const res = this.queue.enqueue({
      lane: special ? 'high' : 'normal',
      kind: 'gift',
      origin: event.origin,
      simulated: event.simulated,
      mergeKey: `${event.origin}|${userKey}|${d.giftId}`,
      summarizable: true,
      userKey,
      count: d.count,
      durationMs: special ? DURATION.special : DURATION.gift,
      color,
      category: special ? 'blessing' : 'gratitude',
      name,
      giftLabel: event.simulated ? `${label}（テスト）` : label,
      tier: d.tier,
    });
    this.log.event(event, `ギフト受付 ${event.id} tier=${d.tier} count=${d.count} -> ${res.status}`);
    return { ok: true, eventId: event.id, simulated: event.simulated, queue: res };
  }

  handleComment(event) {
    const d = event.data;
    const userKey = d.user.key || `${event.origin}:anon`;
    const text = sanitizeText(d.text, { maxLength: 40 });
    if (!text.ok) {
      this.stats.blockedComments++;
      // 元の文字列はログに残さない（個人情報を保存しないため）
      this.log.event(event, `コメント非表示 ${event.id} reasons=${text.reasons.join(',')} len=${(d.text || '').length}`);
      return { ok: true, eventId: event.id, simulated: event.simulated, displayed: false, reasons: text.reasons };
    }
    const name = this.displayName(event);
    this.feed.push({ id: event.id, name, text: text.text, simulated: event.simulated });

    const result = { ok: true, eventId: event.id, simulated: event.simulated, displayed: true, text: text.text, command: null };
    const cmd = parseCommand(text.text);
    if (!cmd) return result;

    const st = this.userState(userKey);
    const now = Date.now();
    if (now - st.lastCommandAt < this.commandCooldownMs) {
      this.stats.cooldownSkips++;
      result.command = { type: cmd.command, status: 'cooldown' };
      return result;
    }
    st.lastCommandAt = now;
    if (cmd.command === 'color') st.color = cmd.color;
    const color = cmd.command === 'color' ? cmd.color : st.color || NORMAL_COLORS[Math.floor(Math.random() * NORMAL_COLORS.length)];
    const q = this.queue.enqueue({
      lane: 'low',
      kind: cmd.command === 'color' ? 'comment-color' : 'omikuji',
      origin: event.origin,
      simulated: event.simulated,
      mergeKey: `${event.origin}|${userKey}|cmd`,
      durationMs: DURATION.command,
      color,
      category: cmd.command === 'omikuji' ? 'omikuji' : null,
      name,
      intensity: 0.5,
    });
    this.log.event(event, `コメントコマンド ${event.id} ${cmd.command}${cmd.color ? `=${cmd.color}` : ''} -> ${q.status}`);
    result.command = { type: cmd.command, color, status: q.status };
    return result;
  }

  handleManual(event) {
    const { color, category } = event.data;
    if (!this.picker.hasColor(color)) return { ok: false, error: 'unknown color' };
    if (category && !Object.prototype.hasOwnProperty.call(this.picker.categories, category)) return { ok: false, error: 'unknown category' };
    const q = this.queue.enqueue({
      lane: 'normal',
      kind: 'manual',
      origin: event.origin,
      simulated: event.simulated,
      durationMs: DURATION.manual,
      color,
      category: category || null,
    });
    this.log.event(event, `手動演出 ${event.id} color=${color} -> ${q.status}`);
    return { ok: true, eventId: event.id, simulated: event.simulated, queue: q };
  }

  headline(item) {
    switch (item.kind) {
      case 'gift':
        return `${item.giftLabel}${item.count > 1 ? ` ×${item.count}` : ''}｜${item.name}さん ありがとう`;
      case 'summary':
        return `${item.simulated ? TEST_PREFIX : ''}たくさんの応援ありがとうございます（${item.count}件）`;
      case 'comment-color':
        return `${item.name}さんの色：${COLOR_NAMES[item.color]}`;
      case 'omikuji':
        return `${item.name}さんの今日のおみくじ`;
      default:
        return '';
    }
  }

  onPlay(item) {
    const category = item.kind === 'summary' ? 'blessing' : item.category || undefined;
    const color = item.kind === 'summary' ? 'gold' : item.color;
    const message = this.picker.pick(color, category);
    this.emit('play', {
      id: item.id,
      kind: item.kind,
      lane: item.lane,
      color,
      message,
      headline: this.headline(item),
      count: item.count,
      userCount: item.userCount || undefined,
      durationMs: item.playDurationMs,
      intensity: item.intensity || 1,
      origin: item.origin,
      simulated: !!item.simulated,
    });
  }
}

module.exports = { EventRouter, TEST_PREFIX };
