'use strict';

const config = require('./config');
const log = require('./lib/logger');
const { createApp } = require('./app');
const { isLoopback } = require('./lib/security');

const { server, token, tokenGenerated } = createApp({ config, log });

if (config.requestedMode !== 'simulation') {
  log.warn(`EVENT_MODE=${config.requestedMode} が指定されましたが、実連携は未実装のため simulation で起動します。`);
}
if (!isLoopback(config.host) && config.host !== 'localhost') {
  log.warn(`HOST=${config.host} で待ち受けます。同じネットワーク内の他の端末から画面にアクセスできます。インターネットには公開しないでください。`);
}
if (config.adminToken && config.adminToken.length < 16) {
  log.warn('ADMIN_TOKEN が短すぎます。16文字以上の推測されにくい値にしてください。');
}

server.listen(config.port, config.host, () => {
  const base = `http://${config.host}:${config.port}`;
  log.info(`運命の波動神社 overlay（OBS用）: ${base}/`);
  log.info(`管理パネル:                      ${base}/admin`);
  log.info(`テストUI付きオーバーレイ:        ${base}/?test=1`);
  if (tokenGenerated) {
    log.info(`管理用トークン（今回の起動のみ有効）: ${token}`);
    log.info('固定したい場合は .env の ADMIN_TOKEN に設定してください。');
  } else {
    log.info('管理用トークン: .env の ADMIN_TOKEN を使用します。');
  }
  log.simulation('現在はシミュレーションモードです。TikTok からの実イベントは受信していません。');
});
