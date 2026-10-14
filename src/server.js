'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const log = require('./lib/logger');
const { MessagePicker } = require('./lib/messagePicker');
const { EffectQueue } = require('./lib/effectQueue');
const { EventRouter } = require('./events/router');
const { attachSimulationSource } = require('./sources/simulationSource');
const messages = require('./data/messages.json');

const picker = new MessagePicker(messages, { historySize: config.messageHistorySize });
const queue = new EffectQueue();

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'overlay.html' }));

app.get('/api/status', (_req, res) => {
  res.json({
    mode: config.eventMode,
    realConnection: false,
    colors: picker.colors(),
    categories: messages.categories,
    queue: queue.stats(),
  });
});

const server = http.createServer(app);
const io = new Server(server, { serveClient: true, maxHttpBufferSize: 16 * 1024 });

const router = new EventRouter({
  queue,
  picker,
  log,
  emit: (name, payload) => io.emit(name, payload),
  commandCooldownMs: config.commandCooldownMs,
});

// キュー状態の通知は間引いて送る（イベント集中時の通信量を抑える）
let queueTimer = null;
queue.on('change', () => {
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    io.emit('queue', { ...queue.stats(), router: router.stats, feedDropped: router.feed.dropped });
  }, 300);
});

io.on('connection', (socket) => {
  socket.emit('status', { mode: config.eventMode, realConnection: false });
  socket.emit('queue', { ...queue.stats(), router: router.stats, feedDropped: router.feed.dropped });
  // 現時点の入力経路はテストUI（シミュレーション）のみ
  attachSimulationSource(socket, router);
});

if (config.requestedMode !== 'simulation') {
  log.warn(`EVENT_MODE=${config.requestedMode} が指定されましたが、実連携は未実装のため simulation で起動します。`);
}

server.listen(config.port, config.host, () => {
  log.info(`運命の波動神社 overlay: http://${config.host}:${config.port}/`);
  log.info(`テストUI付き:            http://${config.host}:${config.port}/?test=1`);
  log.simulation('現在はシミュレーションモードです。TikTok からの実イベントは受信していません。');
});

module.exports = { app, server, io, queue, router };
