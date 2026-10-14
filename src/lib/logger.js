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
  /** イベントの出どころに応じて [SIMULATION] / [LIVE] / [OPERATOR] を付けて記録する */
  event: (x, msg) => {
    let tag;
    if (typeof x === 'boolean') tag = x ? 'SIMULATION' : 'LIVE';
    else if (x && x.origin === 'operator') tag = 'OPERATOR';
    else tag = x && x.simulated ? 'SIMULATION' : 'LIVE';
    console.log(fmt('INFO', tag, msg));
  },
};
