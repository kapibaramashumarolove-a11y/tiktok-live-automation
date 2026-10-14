'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const { MessagePicker } = require('./lib/messagePicker');
const { EffectQueue } = require('./lib/effectQueue');
const { EventRouter } = require('./events/router');
const { attachAdminSource } = require('./sources/adminSource');
const { tokenEquals, isLoopback, sameOrigin, generateToken, securityHeaders } = require('./lib/security');
const messages = require('./data/messages.json');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const AUTH_FAIL_LIMIT = 10;      // この回数失敗すると
const AUTH_BLOCK_MS = 60 * 1000; // この時間ブロック

/**
 * アプリ全体を組み立てる（listen は呼び出し側）。
 *  - '/'      名前空間：OBS 用オーバーレイ。受信専用（クライアントからの操作は受け付けない）
 *  - '/admin' 名前空間：管理パネル・テストUI。トークン必須、既定でループバックのみ、Origin を確認
 */
function createApp({ config, log }) {
  const token = config.adminToken || generateToken();
  const picker = new MessagePicker(messages, { historySize: config.messageHistorySize });
  const queue = new EffectQueue();

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  const remoteAllowed = (addr) => config.adminAllowRemote || isLoopback(addr);

  // 管理パネルのページ自体もループバック以外からは返さない（操作にはさらにトークンが必要）
  app.get(['/admin', '/admin.html'], (req, res) => {
    if (!remoteAllowed(req.socket.remoteAddress)) return res.status(403).type('text/plain').send('Forbidden');
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
  });
  app.use(express.static(PUBLIC_DIR, { index: 'overlay.html' }));

  app.get('/api/status', (_req, res) => {
    res.json({
      mode: config.eventMode,
      realConnection: false,
      colors: picker.colors(),
      categories: messages.categories,
    });
  });

  const server = http.createServer(app);
  const io = new Server(server, { serveClient: true, maxHttpBufferSize: 16 * 1024 });
  const overlay = io.of('/');
  const admin = io.of('/admin');

  const router = new EventRouter({
    queue,
    picker,
    log,
    emit: (name, payload) => overlay.emit(name, payload),
    adminEmit: (name, payload) => admin.emit(name, payload),
    commandCooldownMs: config.commandCooldownMs,
  });

  const getState = () => ({
    ...router.state(),
    mode: config.eventMode,
    realConnection: false,
    overlays: overlay.sockets.size,
  });

  // 状態通知は間引いて送る（イベント集中時の通信量を抑える）
  let stateTimer = null;
  const pushState = () => {
    if (stateTimer) return;
    stateTimer = setTimeout(() => {
      stateTimer = null;
      const st = getState();
      admin.emit('admin:state', st);
      overlay.emit('runstate', { runState: st.runState });
    }, 300);
  };
  queue.on('change', pushState);

  overlay.on('connection', (socket) => {
    socket.emit('status', { mode: config.eventMode, realConnection: false });
    socket.emit('runstate', { runState: router.runState });
    pushState();
    socket.on('disconnect', pushState);
    // 受信専用：ハンドラは登録しない
  });

  // 認証失敗の多い接続元を一時的にブロック
  const failures = new Map(); // addr -> {count, until}
  admin.use((socket, next) => {
    const addr = socket.handshake.address;
    const f = failures.get(addr);
    if (f && f.until > Date.now()) return next(new Error('too many attempts'));
    if (!remoteAllowed(addr)) {
      log.warn(`管理接続を拒否（ループバック以外）: ${addr}`);
      return next(new Error('forbidden'));
    }
    if (!sameOrigin(socket.handshake.headers.origin, socket.handshake.headers.host)) {
      log.warn(`管理接続を拒否（Origin 不一致）: ${addr}`);
      return next(new Error('forbidden'));
    }
    const given = socket.handshake.auth && socket.handshake.auth.token;
    if (!tokenEquals(given, token)) {
      // ブロック期間が明けていれば数え直す
      const rec = f && !f.until ? f : { count: 0, until: 0 };
      rec.count++;
      if (rec.count >= AUTH_FAIL_LIMIT) rec.until = Date.now() + AUTH_BLOCK_MS;
      failures.set(addr, rec);
      if (failures.size > 1000) failures.delete(failures.keys().next().value);
      log.warn(`管理接続の認証に失敗: ${addr}`);
      return next(new Error('unauthorized'));
    }
    failures.delete(addr);
    next();
  });

  admin.on('connection', (socket) => {
    socket.emit('admin:init', {
      state: getState(),
      colors: picker.colors(),
      categories: messages.categories,
      recentComments: router.recentComments,
      recentLogs: router.recentLogs,
    });
    attachAdminSource(socket, { router, getState: () => { pushState(); return getState(); } });
    // 操作後は状態をすぐ反映
    socket.onAny((name) => { if (name.startsWith('admin:')) pushState(); });
  });

  return { app, server, io, queue, router, picker, token, tokenGenerated: !config.adminToken };
}

module.exports = { createApp };
