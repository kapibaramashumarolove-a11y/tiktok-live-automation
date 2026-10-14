'use strict';

const { sanitizeText, sanitizeName } = require('../lib/sanitize');
const { parseCommand } = require('./commentCommands');
const { replyCandidates, COLOR_NAMES } = require('./replyCandidates');
const { CommentFeed } = require('../lib/commentFeed');

const NORMAL_COLORS = ['gold', 'purple', 'green', 'pink', 'blue', 'red', 'white', 'aqua', 'orange'];
const TEST_PREFIX = '【テスト】';

const DURATION = { special: 9000, gift: 6500, manual: 7000, command: 5000, summary: 7000, message: 9000 };
const RECENT_COMMENTS = 50;
const RECENT_LOGS = 100;

function hashIndex(s, n) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % n;
}

function originTag(x) {
  if (x && x.origin === 'operator') return 'OPERATOR';
  return x && x.simulated ? 'SIMULATION' : 'LIVE';
}

/**
 * 正規化済みイベント（eventFactory 生成）を受け取り、検証・フィルター・キュー投入を行う。
 * 画面へ送る文字列は、ここでサニタイズ済みのものだけに限定する。
 *
 * 運転状態 runState:
 *  - running : 通常
 *  - paused  : 新しい演出を開始しない（届いたイベントは上限までキューに貯める）。コメント表示も止める
 *  - stopped : 全停止（緊急停止）。画面を消去し、配信者の操作以外のイベントは受け付けない
 */
class EventRouter {
  constructor({ queue, picker, emit, adminEmit = () => {}, log, commandCooldownMs = 30000, maxUsers = 5000, feed = {} }) {
    this.queue = queue;
    this.picker = picker;
    this.emit = emit;
    this.adminEmit = adminEmit;
    this.baseLog = log;
    this.commandCooldownMs = commandCooldownMs;
    this.maxUsers = maxUsers;
    this.users = new Map(); // userKey -> {color, lastCommandAt}（挿入順で古いものから削除）
    this.stats = { blockedComments: 0, blockedNames: 0, cooldownSkips: 0, ignoredWhileStopped: 0 };
    this.runState = 'running';
    this.settings = { giftEffects: true, commentDisplay: true, commentCommands: true };
    this.recentComments = []; // 管理パネル向け（サニタイズ済みのみ）
    this.recentLogs = [];

    this.feed = new CommentFeed({ ...feed, onEmit: (c) => this.emit('comment', c) });

    queue.on('play', (item) => this.onPlay(item));
    queue.on('update', (item) => this.emit('play:update', { id: item.id, count: item.count, headline: this.headline(item) }));
    queue.on('end', (item) => this.emit('play:end', { id: item.id }));
    queue.on('drop', (item, reason) => this.logEvent(item, `演出を破棄 kind=${item.kind} reason=${reason}`));
  }

  /** ログ出力（コンソール＋管理パネル）。本文などの視聴者入力は渡さないこと */
  logEvent(x, msg) {
    const tag = originTag(x);
    this.baseLog.event(x, msg);
    const line = { at: Date.now(), tag, msg };
    this.recentLogs.push(line);
    if (this.recentLogs.length > RECENT_LOGS) this.recentLogs.shift();
    this.adminEmit('admin:log', line);
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
      this.logEvent(event, `表示名を汎用名に置換 reasons=${r.reasons.join(',')}`);
    }
    return event.simulated ? `${TEST_PREFIX}${r.name}` : r.name;
  }

  /** @returns {object} 呼び出し元へ返す処理結果 */
  handle(event) {
    if (this.runState === 'stopped' && event.origin !== 'operator') {
      this.stats.ignoredWhileStopped++;
      return { ok: true, eventId: event.id, simulated: event.simulated, ignored: 'stopped' };
    }
    switch (event.type) {
      case 'gift': return this.handleGift(event);
      case 'comment': return this.handleComment(event);
      case 'manual': return this.handleManual(event);
      case 'message': return this.handleMessage(event);
      default: return { ok: false, error: 'unknown type' };
    }
  }

  handleGift(event) {
    if (!this.settings.giftEffects) {
      this.logEvent(event, `ギフト演出オフのため演出なし ${event.id}`);
      return { ok: true, eventId: event.id, simulated: event.simulated, ignored: 'giftEffects-off' };
    }
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
    this.logEvent(event, `ギフト受付 ${event.id} tier=${d.tier} count=${d.count} -> ${res.status}`);
    return { ok: true, eventId: event.id, simulated: event.simulated, queue: res };
  }

  pushAdminComment(entry) {
    this.recentComments.push(entry);
    if (this.recentComments.length > RECENT_COMMENTS) this.recentComments.shift();
    this.adminEmit('admin:comment', entry);
  }

  handleComment(event) {
    const d = event.data;
    const userKey = d.user.key || `${event.origin}:anon`;
    const text = sanitizeText(d.text, { maxLength: 40 });
    if (!text.ok) {
      this.stats.blockedComments++;
      // 元の文字列は画面・ログ・管理パネルのどこにも出さない（個人情報を保存しないため）
      this.logEvent(event, `コメント非表示 ${event.id} reasons=${text.reasons.join(',')} len=${(d.text || '').length}`);
      this.pushAdminComment({ id: event.id, at: Date.now(), simulated: event.simulated, blocked: true, reasons: text.reasons });
      return { ok: true, eventId: event.id, simulated: event.simulated, displayed: false, reasons: text.reasons };
    }
    const name = this.displayName(event);
    const displayed = this.settings.commentDisplay && this.runState !== 'paused';
    if (displayed) this.feed.push({ id: event.id, name, text: text.text, simulated: event.simulated });

    const result = { ok: true, eventId: event.id, simulated: event.simulated, displayed, text: text.text, command: null };
    const cmd = this.settings.commentCommands ? parseCommand(text.text) : null;
    if (cmd) {
      const st = this.userState(userKey);
      const now = Date.now();
      if (now - st.lastCommandAt < this.commandCooldownMs) {
        this.stats.cooldownSkips++;
        result.command = { type: cmd.command, status: 'cooldown' };
      } else {
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
        this.logEvent(event, `コメントコマンド ${event.id} ${cmd.command}${cmd.color ? `=${cmd.color}` : ''} -> ${q.status}`);
        result.command = { type: cmd.command, color, status: q.status };
      }
    }
    const rc = replyCandidates(text.text, result.command && { type: result.command.type, color: result.command.color });
    this.pushAdminComment({
      id: event.id, at: Date.now(), simulated: event.simulated, blocked: false,
      name, text: text.text, displayed, command: result.command, replyKind: rc.kind, candidates: rc.replies,
    });
    return result;
  }

  handleManual(event) {
    const { color, category, interrupt } = event.data;
    if (!this.picker.hasColor(color)) return { ok: false, error: 'unknown color' };
    if (category && !Object.prototype.hasOwnProperty.call(this.picker.categories, category)) return { ok: false, error: 'unknown category' };
    const item = {
      lane: event.origin === 'operator' ? 'high' : 'normal',
      kind: 'manual',
      origin: event.origin,
      simulated: event.simulated,
      durationMs: DURATION.manual,
      color,
      category: category || null,
    };
    // 割り込み再生は配信者の操作だけに許可する
    const q = interrupt && event.origin === 'operator' ? this.queue.playNow(item) : this.queue.enqueue(item);
    this.logEvent(event, `手動演出 ${event.id} color=${color}${interrupt ? ' (割り込み)' : ''} -> ${q.status}`);
    return { ok: true, eventId: event.id, simulated: event.simulated, queue: q };
  }

  /** 配信者のメッセージ（視聴者全体へのメッセージ／コメントへの返答）。origin=operator のみ */
  handleMessage(event) {
    if (event.origin !== 'operator') return { ok: false, error: 'operator only' };
    const { text, color, target, interrupt } = event.data;
    const body = sanitizeText(text, { maxLength: 60 });
    if (!body.ok) return { ok: false, error: 'text rejected', reasons: body.reasons };
    let targetName = null;
    if (target) {
      const t = sanitizeName(target);
      if (t.replaced) return { ok: false, error: 'target rejected', reasons: t.reasons };
      targetName = t.name;
    }
    const c = this.picker.hasColor(color) ? color : 'gold';
    const item = {
      lane: 'high',
      kind: target ? 'reply' : 'operator-message',
      origin: event.origin,
      simulated: false,
      durationMs: DURATION.message,
      color: c,
      customText: body.text,
      name: targetName,
    };
    const q = interrupt ? this.queue.playNow(item) : this.queue.enqueue(item);
    this.logEvent(event, `配信者メッセージ ${event.id} kind=${item.kind} len=${body.text.length}${interrupt ? ' (割り込み)' : ''} -> ${q.status}`);
    return { ok: true, eventId: event.id, queue: q, text: body.text };
  }

  /* ---------- 運転制御（管理パネルから） ---------- */

  pause() {
    if (this.runState === 'stopped') return this.state();
    this.runState = 'paused';
    this.queue.pause();
    this.feed.pause();
    this.logEvent({ origin: 'operator' }, '一時停止');
    return this.state();
  }

  resume() {
    this.runState = 'running';
    this.queue.resume();
    this.feed.resume();
    this.emit('resume', {});
    this.logEvent({ origin: 'operator' }, '再開');
    return this.state();
  }

  skip() {
    this.queue.skip();
    this.logEvent({ origin: 'operator' }, 'スキップ');
    return this.state();
  }

  clearWaiting() {
    const n = this.queue.size() + this.feed.buffer.length;
    this.queue.clear();
    this.feed.clear();
    this.logEvent({ origin: 'operator' }, `待ち分を破棄 (${n}件)`);
    return this.state();
  }

  /** 全停止（緊急停止）：待ち分を破棄、再生中も終了、画面を消去し、再開するまで新しいイベントを受け付けない */
  stopAll() {
    this.runState = 'stopped';
    this.queue.pause();
    this.queue.stopAll();
    this.feed.pause();
    this.feed.clear();
    this.emit('stop', {});
    this.logEvent({ origin: 'operator' }, '全停止（緊急停止）');
    return this.state();
  }

  setSettings(patch) {
    for (const k of Object.keys(this.settings)) {
      if (patch && typeof patch[k] === 'boolean') this.settings[k] = patch[k];
    }
    if (!this.settings.commentDisplay) this.feed.clear();
    this.logEvent({ origin: 'operator' }, `設定変更 ${JSON.stringify(this.settings)}`);
    return this.state();
  }

  state() {
    return {
      runState: this.runState,
      settings: { ...this.settings },
      stats: { ...this.stats, feedDropped: this.feed.dropped },
      queue: this.queue.stats(),
    };
  }

  /* ---------- 画面向け ---------- */

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
      case 'reply':
        return `${item.name}さんへ`;
      case 'operator-message':
        return '配信者からのメッセージ';
      default:
        return '';
    }
  }

  onPlay(item) {
    let message;
    let color = item.color;
    if (item.customText) {
      message = { id: 'operator', color, category: 'operator', categoryLabel: item.kind === 'reply' ? '配信者からの返答' : '配信者からのメッセージ', text: item.customText };
    } else {
      const category = item.kind === 'summary' ? 'blessing' : item.category || undefined;
      if (item.kind === 'summary') color = 'gold';
      message = this.picker.pick(color, category);
    }
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
