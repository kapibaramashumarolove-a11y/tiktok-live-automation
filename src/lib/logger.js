'use strict';

function stamp() {
  return new Date().toISOString();
}

function fmt(level, tag, msg) {
  return `${stamp()} [${level}]${tag ? ` [${tag}]` : ''} ${msg}`;
}

module.exports = {
  info: (msg) => console.log(fmt('INFO', '', msg)),
  warn: (msg) => console.warn(fmt('WARN', '', msg)),
  error: (msg) => console.error(fmt('ERROR', '', msg)),
  // シミュレーション（テスト）由来のイベントは必ずこのタグで記録する
  simulation: (msg) => console.log(fmt('INFO', 'SIMULATION', msg)),
  /** イベントの出どころに応じて [SIMULATION] / [LIVE] を付けて記録する */
  event: (evtOrSimulated, msg) => {
    const simulated = typeof evtOrSimulated === 'boolean' ? evtOrSimulated : !!(evtOrSimulated && evtOrSimulated.simulated);
    console.log(fmt('INFO', simulated ? 'SIMULATION' : 'LIVE', msg));
  },
};
