'use strict';

const { createSimulationEvent } = require('../events/eventFactory');

/**
 * テストUI（Socket.IO）からのシミュレーションイベントを受け付ける。
 * ここで生成されるイベントは必ず origin=simulation になる（受信データで変更不可）。
 */
const RATE_PER_SEC = 300; // ソケットごとの受付上限（暴走防止）

function attachSimulationSource(socket, router) {
  let windowStart = 0;
  let count = 0;

  function allowed() {
    const now = Date.now();
    if (now - windowStart >= 1000) { windowStart = now; count = 0; }
    return ++count <= RATE_PER_SEC;
  }

  function on(name, type) {
    socket.on(name, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!allowed()) { reply({ ok: false, error: 'rate limited' }); return; }
      try {
        reply(router.handle(createSimulationEvent(type, payload)));
      } catch (e) {
        reply({ ok: false, error: 'invalid event' });
      }
    });
  }

  on('sim:gift', 'gift');
  on('sim:comment', 'comment');
  on('sim:effect', 'manual');
  on('test:effect', 'manual'); // フェーズ1互換
}

module.exports = { attachSimulationSource };
