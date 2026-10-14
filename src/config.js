'use strict';

require('dotenv').config();

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const toBool = (v) => /^(1|true|yes|on)$/i.test(String(v || ''));

const requestedMode = (process.env.EVENT_MODE || 'simulation').toLowerCase();

const config = Object.freeze({
  port: toInt(process.env.PORT, 3000, 1, 65535),
  host: process.env.HOST || '127.0.0.1',
  messageHistorySize: toInt(process.env.MESSAGE_HISTORY_SIZE, 10, 0, 29),
  commandCooldownMs: toInt(process.env.COMMAND_COOLDOWN_SEC, 30, 0, 3600) * 1000,
  requestedMode,
  // 管理パネル・テストUI用のトークン。未設定なら起動ごとにランダム生成してコンソールに表示する
  adminToken: process.env.ADMIN_TOKEN || '',
  // true のときだけ、ループバック以外（LAN 内の別端末など）からの管理接続を許可する
  adminAllowRemote: toBool(process.env.ADMIN_ALLOW_REMOTE),
  // 実連携は未実装のため、常にシミュレーションで動作する
  eventMode: 'simulation',
});

module.exports = config;
