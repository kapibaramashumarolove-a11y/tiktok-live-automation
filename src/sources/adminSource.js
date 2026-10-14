'use strict';

const { createOperatorEvent } = require('../events/eventFactory');
const { attachSimulationSource } = require('./simulationSource');

const OPS_PER_SEC = 20; // 管理操作の受付上限（誤連打・暴走防止）

/**
 * 管理パネル用ソケット（認証済み）の操作を受け付ける。
 * 配信者の操作は origin=operator のイベントとして扱い、画面には「配信者による演出」と表示される。
 */
function attachAdminSource(socket, { router, getState }) {
  let windowStart = 0;
  let count = 0;
  const allowed = () => {
    const now = Date.now();
    if (now - windowStart >= 1000) { windowStart = now; count = 0; }
    return ++count <= OPS_PER_SEC;
  };

  function on(name, fn) {
    socket.on(name, (payload, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (!allowed()) { reply({ ok: false, error: 'rate limited' }); return; }
      try {
        reply(fn(payload && typeof payload === 'object' ? payload : {}));
      } catch (e) {
        reply({ ok: false, error: 'invalid request' });
      }
    });
  }

  on('admin:state', () => ({ ok: true, state: getState() }));
  on('admin:pause', () => ({ ok: true, state: router.pause() }));
  on('admin:resume', () => ({ ok: true, state: router.resume() }));
  on('admin:skip', () => ({ ok: true, state: router.skip() }));
  on('admin:clear', () => ({ ok: true, state: router.clearWaiting() }));
  on('admin:stop', () => ({ ok: true, state: router.stopAll() }));
  on('admin:settings', (p) => ({ ok: true, state: router.setSettings(p) }));
  // 手動オーバーライド：色・分類を指定した演出
  on('admin:override', (p) => router.handle(createOperatorEvent('manual', p)));
  // 視聴者全体へのメッセージ／コメントへの返答
  on('admin:message', (p) => router.handle(createOperatorEvent('message', p)));

  // テストUI（シミュレーション）も認証済みの接続からのみ受け付ける
  attachSimulationSource(socket, router);
}

module.exports = { attachAdminSource };
