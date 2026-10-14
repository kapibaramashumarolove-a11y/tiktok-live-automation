'use strict';

/**
 * TikTok 実イベントの受信アダプタ（未実装）。
 *
 * 実装する場合は、利用条件を確認した正規の手段で受信したイベントだけを
 * createLiveEvent() で正規化し、router.handle() に渡すこと。
 * 利用条件の調査はフェーズ3で行う。調査が済むまで、このモジュールは起動しない。
 */
const { createLiveEvent } = require('../events/eventFactory');

function startLiveSource() {
  throw new Error('実連携は未実装です（フェーズ3で利用条件を調査予定）。シミュレーションモードで動作しています。');
}

module.exports = { startLiveSource };
