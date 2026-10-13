'use strict';

require('dotenv').config();

function toInt(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const requestedMode = (process.env.EVENT_MODE || 'simulation').toLowerCase();

const config = Object.freeze({
  port: toInt(process.env.PORT, 3000, 1, 65535),
  host: process.env.HOST || '127.0.0.1',
  messageHistorySize: toInt(process.env.MESSAGE_HISTORY_SIZE, 10, 0, 29),
  requestedMode,
  // 実連携は未実装のため、常にシミュレーションで動作する
  eventMode: 'simulation',
});

module.exports = config;
