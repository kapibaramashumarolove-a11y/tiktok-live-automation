'use strict';

/**
 * 正規化済みイベントの生成。
 *
 * origin（イベントの出どころ）は呼び出し元モジュールで固定され、受信データの中身からは決まらない。
 *  - createSimulationEvent … テストUI（src/sources/simulationSource.js）専用
 *  - createLiveEvent       … 将来の実連携アダプタ（src/sources/liveSource.js）専用。現時点では未使用
 *  - createOperatorEvent   … 管理パネルでの配信者の操作（src/sources/adminSource.js）専用。
 *                            ギフト通知の形式（type=gift）は作れない（偽のギフト通知を防ぐため）
 * 受信データに origin / simulated などの項目が含まれていても無視する。
 */

const ORIGIN = Object.freeze({ SIMULATION: 'simulation', LIVE: 'live', OPERATOR: 'operator' });
const TYPES = new Set(['gift', 'comment', 'manual', 'message']);
const OPERATOR_TYPES = new Set(['manual', 'message']);
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
      return { color: pickString(d.color, 16), category: pickString(d.category, 16) || null, interrupt: d.interrupt === true };
    case 'message':
      return {
        text: pickString(d.text, 500),
        color: pickString(d.color, 16),
        target: pickString(d.target, 64),
        replyTo: pickString(d.replyTo, 64),
        interrupt: d.interrupt === true,
      };
    default:
      return {};
  }
}

function createEvent(origin, type, raw) {
  if (!Object.values(ORIGIN).includes(origin)) throw new Error(`invalid origin: ${origin}`);
  if (!TYPES.has(type)) throw new Error(`invalid event type: ${type}`);
  if (origin === ORIGIN.OPERATOR && !OPERATOR_TYPES.has(type)) throw new Error(`invalid event type for operator: ${type}`);
  if (origin !== ORIGIN.OPERATOR && type === 'message') throw new Error(`invalid event type for ${origin}: ${type}`);
  const simulated = origin === ORIGIN.SIMULATION;
  const data = pickData(type, raw);
  if (simulated && data.user) {
    // テスト用の視聴者は実在の視聴者と誤認されないよう、キーと表示名を必ずテスト用にする
    data.user.key = `sim:${data.user.key || 'anon'}`;
    data.user.testLabel = true;
  }
  return Object.freeze({
    id: `${{ simulation: 'sim', live: 'live', operator: 'op' }[origin]}-${++seq}`,
    origin,
    simulated,
    type,
    receivedAt: Date.now(),
    data: Object.freeze(data),
  });
}

const createSimulationEvent = (type, raw) => createEvent(ORIGIN.SIMULATION, type, raw);
const createLiveEvent = (type, raw) => createEvent(ORIGIN.LIVE, type, raw);
const createOperatorEvent = (type, raw) => createEvent(ORIGIN.OPERATOR, type, raw);

module.exports = { ORIGIN, createSimulationEvent, createLiveEvent, createOperatorEvent };
