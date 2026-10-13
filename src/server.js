'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const log = require('./lib/logger');
const { MessagePicker } = require('./lib/messagePicker');
const messages = require('./data/messages.json');

const picker = new MessagePicker(messages, { historySize: config.messageHistorySize });

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'overlay.html' }));

app.get('/api/status', (_req, res) => {
  res.json({
    mode: config.eventMode,
    realConnection: false,
    colors: picker.colors(),
    categories: messages.categories,
  });
});

const server = http.createServer(app);
const io = new Server(server, { serveClient: true });

let effectSeq = 0;

/**
 * 演出イベントを生成して全クライアントへ送る。
 * source は 'simulation'（テストUI）のみ。実イベント経路は未実装。
 */
function emitEffect({ color, category, source }) {
  const message = picker.pick(color, category);
  const effect = {
    id: ++effectSeq,
    type: 'color-effect',
    color,
    message,
    source,
    simulated: source === 'simulation',
    at: Date.now(),
  };
  io.emit('effect', effect);
  return effect;
}

io.on('connection', (socket) => {
  socket.emit('status', { mode: config.eventMode, realConnection: false });

  socket.on('test:effect', (payload, ack) => {
    const color = payload && payload.color;
    const category = payload && payload.category;
    if (typeof color !== 'string' || !picker.hasColor(color)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'unknown color' });
      return;
    }
    if (category != null && !Object.prototype.hasOwnProperty.call(messages.categories, category)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'unknown category' });
      return;
    }
    const effect = emitEffect({ color, category: category || undefined, source: 'simulation' });
    log.simulation(`テスト演出 #${effect.id} color=${color} msg=${effect.message.id}`);
    if (typeof ack === 'function') ack({ ok: true, id: effect.id });
  });
});

if (config.requestedMode !== 'simulation') {
  log.warn(`EVENT_MODE=${config.requestedMode} が指定されましたが、実連携は未実装のため simulation で起動します。`);
}

server.listen(config.port, config.host, () => {
  log.info(`運命の波動神社 overlay: http://${config.host}:${config.port}/`);
  log.info(`テストUI付き:            http://${config.host}:${config.port}/?test=1`);
  log.simulation('現在はシミュレーションモードです。TikTok からの実イベントは受信していません。');
});

module.exports = { app, server, io };
