'use strict';

/**
 * 正規化済みイベントの生成。
 *
 * origin（イベントの出どころ）は呼び出し元モジュールで固定され、受信データの中身からは決まらない。
 *  - createSimulationEvent … テストUI（src/sources/simulationSource.js）専用
 *  - createLiveEvent       … 将来の実連携アダプタ（src/sources/liveSource.js）専用。現時点では未使用
 * 受信データに origin / simulated などの項目が含まれていても無視する。
 */

const ORIGIN = Object.freeze({ SIMULATION: 'simulation', LIVE: 'live' });
const TYPES = new Set(['gift', 'comment', 'manual']);
const GIFT_TIERS = new Set(['normal', 'special']);

let seq = 0;

function pickString(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 受信データから、型ごとに許可した項目だけを取り出す（未知の項目は捨てる） */
function pickData(type, raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const user = d.user && typeof d.user === 'object' ? d.user : {};
  const base = { user: { key: pickString(user.key, 64), name: pickString(user.name, 64) } };
  switch (type) {
    case 'gift':
      return {
        ...base,
        giftId: pickString(d.giftId, 64) || 'unknown',
        giftName: pickString(d.giftName, 64),
        tier: GIFT_TIERS.has(d.tier) ? d.tier : 'normal',
        count: clampInt(d.count, 1, 999, 1),
      };
    case 'comment':
      return { ...base, text: pickString(d.text, 500) };
    case 'manual':
      return { color: pickString(d.color, 16), category: pickString(d.category, 16) || null };
    default:
      return {};
  }
}

function createEvent(origin, type, raw) {
  if (origin !== ORIGIN.SIMULATION && origin !== ORIGIN.LIVE) throw new Error(`invalid origin: ${origin}`);
  if (!TYPES.has(type)) throw new Error(`invalid event type: ${type}`);
  const simulated = origin === ORIGIN.SIMULATION;
  const data = pickData(type, raw);
  if (simulated && data.user) {
    // テスト用の視聴者は実在の視聴者と誤認されないよう、キーと表示名を必ずテスト用にする
    data.user.key = `sim:${data.user.key || 'anon'}`;
    data.user.testLabel = true;
  }
  return Object.freeze({
    id: `${simulated ? 'sim' : 'live'}-${++seq}`,
    origin,
    simulated,
    type,
    receivedAt: Date.now(),
    data: Object.freeze(data),
  });
}

const createSimulationEvent = (type, raw) => createEvent(ORIGIN.SIMULATION, type, raw);
const createLiveEvent = (type, raw) => createEvent(ORIGIN.LIVE, type, raw);

module.exports = { ORIGIN, createSimulationEvent, createLiveEvent };
