'use strict';

/**
 * 画面のコメント表示を間引くバッファ。
 * 一度に大量のコメントが届いても、intervalMs ごとに1件だけ送り出す。
 * バッファが上限を超えたら古いものから捨てる（最新のコメントを優先）。
 */
class CommentFeed {
  constructor({ intervalMs = 800, maxBuffer = 20, onEmit }) {
    this.intervalMs = intervalMs;
    this.maxBuffer = maxBuffer;
    this.onEmit = onEmit;
    this.buffer = [];
    this.timer = null;
    this.dropped = 0;
    this.paused = false;
  }

  push(item) {
    this.buffer.push(item);
    while (this.buffer.length > this.maxBuffer) { this.buffer.shift(); this.dropped++; }
    this.ensure();
  }

  ensure() {
    if (this.timer || this.paused || !this.buffer.length) return;
    this.flushOne();
    this.timer = setInterval(() => {
      if (this.paused || !this.buffer.length) { clearInterval(this.timer); this.timer = null; return; }
      this.flushOne();
    }, this.intervalMs);
  }

  flushOne() {
    const item = this.buffer.shift();
    if (item) this.onEmit(item);
  }

  pause() { this.paused = true; }

  resume() { this.paused = false; this.ensure(); }

  clear() { this.buffer.length = 0; }

  stop() { clearInterval(this.timer); this.timer = null; this.buffer.length = 0; }
}

module.exports = { CommentFeed };
