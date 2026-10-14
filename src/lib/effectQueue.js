'use strict';

const { EventEmitter } = require('events');

/**
 * 演出キュー。画面のメイン演出は常に1件ずつ再生し、重ならないようにする。
 *
 *  - レーン（優先度順）: high（特別ギフト） > normal（通常ギフト・手動演出） > low（コメント由来）
 *  - mergeKey が同じ項目（同一視聴者×同一ギフトの連続など）は、待機中ならカウントを加算してまとめる。
 *    再生中の項目と同じなら 'update' を出し、表示時間を少しだけ延長する（上限あり）。
 *  - maxWaitMs を超えて待っている項目は優先度に関係なく先に再生する（低優先度の取り残し防止）。
 *  - 待機数が多いほど1件あたりの表示時間を短縮する（滞留の解消）。
 *  - レーン上限を超えた場合、summarizable な項目はレーン末尾の「まとめ」項目に集約、それ以外は破棄。
 *
 * イベント: 'play'(item) / 'update'(item) / 'end'(item) / 'change'(stats) / 'drop'(item, reason)
 */
class EffectQueue extends EventEmitter {
  constructor({
    lanes = { high: 10, normal: 20, low: 10 },
    gapMs = 600,
    maxWaitMs = 20000,
    minDurationMs = 2200,
    extendMs = 1200,
    maxExtendMs = 6000,
  } = {}) {
    super();
    this.order = Object.keys(lanes);
    this.caps = { ...lanes };
    this.lanes = Object.fromEntries(this.order.map((k) => [k, []]));
    this.gapMs = gapMs;
    this.maxWaitMs = maxWaitMs;
    this.minDurationMs = minDurationMs;
    this.extendMs = extendMs;
    this.maxExtendMs = maxExtendMs;

    this.current = null;
    this.timer = null;
    this.state = 'idle'; // idle | playing | gap
    this.paused = false;
    this.lastWasAged = false;
    this.seq = 0;
    this.counters = { enqueued: 0, merged: 0, summarized: 0, dropped: 0, played: 0 };
  }

  size() {
    return this.order.reduce((n, k) => n + this.lanes[k].length, 0);
  }

  /**
   * @param {object} item {lane, kind, durationMs, mergeKey?, count?, summarizable?, ...payload}
   * @returns {{status: 'queued'|'merged'|'merged-playing'|'summarized'|'dropped', id?: number}}
   */
  enqueue(item) {
    const laneName = this.lanes[item.lane] ? item.lane : this.order[this.order.length - 1];
    const lane = this.lanes[laneName];
    const count = Number.isInteger(item.count) && item.count > 0 ? item.count : 1;

    if (item.mergeKey) {
      const cur = this.current;
      if (cur && cur.mergeKey === item.mergeKey && this.state === 'playing') {
        cur.count += count;
        this.counters.merged++;
        this.extendCurrent();
        this.emit('update', cur);
        return { status: 'merged-playing', id: cur.id };
      }
      const waiting = lane.find((x) => x.mergeKey === item.mergeKey);
      if (waiting) {
        waiting.count += count;
        this.counters.merged++;
        this.emitChange();
        return { status: 'merged', id: waiting.id };
      }
    }

    if (lane.length >= this.caps[laneName]) {
      if (item.summarizable) {
        let summary = lane.find((x) => x.kind === 'summary');
        if (!summary) {
          summary = {
            id: ++this.seq, lane: laneName, kind: 'summary', origin: item.origin, simulated: item.simulated,
            durationMs: item.durationMs, count: 0, users: new Set(), enqueuedAt: Date.now(), color: item.color,
          };
          lane.push(summary); // 上限 +1 件まで許容（まとめ専用枠）
        }
        summary.count += count;
        if (item.userKey) summary.users.add(item.userKey);
        // 実イベントとシミュレーションが混在した場合は、シミュレーション扱いを優先して表示する
        summary.simulated = summary.simulated || item.simulated;
        this.counters.summarized++;
        this.emitChange();
        return { status: 'summarized', id: summary.id };
      }
      this.counters.dropped++;
      this.emit('drop', item, 'lane-full');
      this.emitChange();
      return { status: 'dropped' };
    }

    const queued = { ...item, lane: laneName, id: ++this.seq, count, enqueuedAt: Date.now() };
    lane.push(queued);
    this.counters.enqueued++;
    this.emitChange();
    this.kick();
    return { status: 'queued', id: queued.id };
  }

  extendCurrent() {
    const cur = this.current;
    if (!cur || cur.extendedMs >= this.maxExtendMs) return;
    const add = Math.min(this.extendMs, this.maxExtendMs - cur.extendedMs);
    cur.extendedMs += add;
    cur.endsAt += add;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(), Math.max(0, cur.endsAt - Date.now()));
  }

  next() {
    const now = Date.now();
    // 待ちすぎている項目を、優先度の低いレーンから1件だけ先に出す。
    // 直前にこの繰り上げを行った場合は通常の優先度順に戻し、低優先度が連続して占有しないようにする。
    if (!this.lastWasAged) {
      for (let i = this.order.length - 1; i > 0; i--) {
        const lane = this.lanes[this.order[i]];
        if (lane.length && now - lane[0].enqueuedAt >= this.maxWaitMs) {
          this.lastWasAged = true;
          return lane.shift();
        }
      }
    }
    this.lastWasAged = false;
    for (const k of this.order) if (this.lanes[k].length) return this.lanes[k].shift();
    return null;
  }

  speedFactor() {
    const backlog = this.size();
    if (backlog >= 20) return 0.4;
    if (backlog >= 10) return 0.55;
    if (backlog >= 5) return 0.75;
    return 1;
  }

  kick() {
    if (this.paused || this.state !== 'idle') return;
    const item = this.next();
    if (!item) { this.emitChange(); return; }
    this.start(item);
  }

  start(item) {
    const duration = Math.max(this.minDurationMs, Math.round(item.durationMs * this.speedFactor()));
    item.playDurationMs = duration;
    item.startedAt = Date.now();
    item.endsAt = item.startedAt + duration;
    item.extendedMs = 0;
    if (item.users instanceof Set) item.userCount = item.users.size;
    this.current = item;
    this.state = 'playing';
    this.counters.played++;
    this.emit('play', item);
    this.emitChange();
    this.timer = setTimeout(() => this.finish(), duration);
  }

  finish() {
    if (this.state !== 'playing') return;
    const done = this.current;
    this.current = null;
    this.state = 'gap';
    this.emit('end', done);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.state = 'idle';
      this.kick();
    }, this.gapMs);
  }

  /**
   * 割り込み再生（配信者の手動オーバーライド用）。再生中の演出は打ち切り、待機中の項目はそのまま残す。
   * 一時停止中でも再生する。終了後は通常どおり（一時停止中なら停止したまま）。
   */
  playNow(item) {
    clearTimeout(this.timer);
    this.timer = null;
    const cur = this.state === 'playing' ? this.current : null;
    this.current = null;
    this.state = 'idle';
    if (cur) this.emit('end', cur);
    const queued = { ...item, id: ++this.seq, count: 1, enqueuedAt: Date.now() };
    this.counters.enqueued++;
    this.start(queued);
    return { status: 'playing', id: queued.id };
  }

  /** 新しい演出の開始を止める（再生中の演出は最後まで流す） */
  pause() { this.paused = true; this.emitChange(); }

  resume() { this.paused = false; this.emitChange(); this.kick(); }

  /** 再生中の演出を終了して次へ */
  skip() { if (this.state === 'playing') { clearTimeout(this.timer); this.finish(); } }

  /** 待機中の項目をすべて破棄（再生中は残す） */
  clear() {
    for (const k of this.order) this.lanes[k].length = 0;
    this.emitChange();
  }

  /** 全停止：待機中を破棄し、再生中も即終了 */
  stopAll() {
    this.clear();
    clearTimeout(this.timer);
    this.timer = null;
    const cur = this.current;
    this.current = null;
    this.state = 'idle';
    if (cur) this.emit('end', cur);
    this.emitChange();
  }

  stats() {
    return {
      state: this.state,
      paused: this.paused,
      current: this.current ? { id: this.current.id, kind: this.current.kind, lane: this.current.lane, count: this.current.count } : null,
      waiting: Object.fromEntries(this.order.map((k) => [k, this.lanes[k].length])),
      speedFactor: this.speedFactor(),
      counters: { ...this.counters },
    };
  }

  emitChange() { this.emit('change', this.stats()); }
}

module.exports = { EffectQueue };
