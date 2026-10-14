/* 管理パネル。すべての操作は認証済みの '/admin' ソケットで送る。
 * 視聴者由来の文字列はサーバーでサニタイズ済みだが、ここでも textContent でのみ挿入する。
 */
(function () {
  'use strict';

  const THEMES = window.HADO_THEMES;
  const $ = (id) => document.getElementById(id);
  const COMMENTS_MAX = 50;
  const LOG_MAX = 100;
  const RUN = { running: '稼働中', paused: '一時停止中', stopped: '全停止中' };

  let socket = null;
  let state = null;

  /* ---------- 接続 ---------- */
  function connect(token) {
    if (socket) socket.disconnect();
    $('loginError').textContent = '';
    socket = window.io('/admin', { auth: { token }, reconnectionAttempts: 5 });

    socket.on('connect', () => {
      $('connBadge').textContent = '管理接続 OK';
      try { sessionStorage.setItem('hadoToken', token); } catch (e) { /* 保存できなくても動作する */ }
      $('loginView').hidden = true;
      $('mainView').hidden = false;
    });
    socket.on('connect_error', (e) => {
      $('connBadge').textContent = '接続失敗';
      $('loginError').textContent = e.message === 'unauthorized' ? 'トークンが違います。'
        : e.message === 'too many attempts' ? '失敗が続いたため、しばらく接続できません（約1分）。'
          : e.message === 'forbidden' ? 'この端末からの管理接続は許可されていません。' : `接続できません（${e.message}）`;
      try { sessionStorage.removeItem('hadoToken'); } catch (e2) { /* noop */ }
      $('loginView').hidden = false;
      $('mainView').hidden = true;
    });
    socket.on('disconnect', () => { $('connBadge').textContent = '切断（再接続中）'; });

    socket.on('admin:init', (d) => {
      fillCategories(d.categories);
      $('comments').textContent = '';
      d.recentComments.forEach(addComment);
      $('log').textContent = '';
      d.recentLogs.forEach(addLog);
      renderState(d.state);
    });
    socket.on('admin:state', renderState);
    socket.on('admin:comment', addComment);
    socket.on('admin:log', addLog);
  }

  function send(name, payload) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) { resolve({ ok: false, error: '未接続です' }); return; }
      socket.timeout(5000).emit(name, payload || {}, (err, res) => resolve(err ? { ok: false, error: '応答がありません' } : res));
    });
  }

  /* ---------- 状態表示 ---------- */
  function renderState(st) {
    state = st;
    const b = $('runBadge');
    b.textContent = RUN[st.runState] || st.runState;
    b.className = `badge is-${st.runState}`;
    $('modeBadge').hidden = st.mode !== 'simulation';
    $('overlayBadge').textContent = `OBS画面 ${st.overlays}台接続`;
    $('btnPause').disabled = st.runState !== 'running';
    $('btnResume').disabled = st.runState === 'running';
    $('setGift').checked = st.settings.giftEffects;
    $('setCommentDisplay').checked = st.settings.commentDisplay;
    $('setCommands').checked = st.settings.commentCommands;
    const q = st.queue;
    const w = q.waiting;
    $('queueStats').textContent =
      `再生: ${q.current ? `#${q.current.id} ${q.current.kind}${q.current.count > 1 ? ` ×${q.current.count}` : ''}` : 'なし'}（${q.state}）\n` +
      `待機: 特別 ${w.high} / 通常 ${w.normal} / コメント ${w.low}　表示時間 x${q.speedFactor}\n` +
      `受付 ${q.counters.enqueued}・まとめ ${q.counters.merged}・集約 ${q.counters.summarized}・破棄 ${q.counters.dropped}・再生 ${q.counters.played}\n` +
      `非表示コメント ${st.stats.blockedComments}・名前置換 ${st.stats.blockedNames}・クールダウン ${st.stats.cooldownSkips}・停止中に無視 ${st.stats.ignoredWhileStopped}`;
  }

  function fillCategories(cats) {
    const sel = $('ovCategory');
    sel.length = 1;
    Object.entries(cats || {}).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k; o.textContent = v; sel.appendChild(o);
    });
  }

  /* ---------- コメント一覧と返答候補 ---------- */
  function tag(text, cls) {
    const s = document.createElement('span');
    s.className = `tag ${cls || ''}`;
    s.textContent = text;
    return s;
  }

  function addComment(c) {
    const ol = $('comments');
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.appendChild(document.createTextNode(new Date(c.at).toLocaleTimeString('ja-JP')));
    if (c.simulated) meta.appendChild(tag('テスト', 'tag--sim'));
    if (c.blocked) {
      meta.appendChild(tag(`非表示：${c.reasons.join(', ')}`, 'tag--blocked'));
      li.appendChild(meta);
      const p = document.createElement('div');
      p.className = 'text';
      p.textContent = '（フィルターにより本文は表示しません）';
      li.appendChild(p);
    } else {
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = c.name;
      meta.appendChild(name);
      if (!c.displayed) meta.appendChild(tag('画面非表示'));
      if (c.command) meta.appendChild(tag(`${c.command.type === 'color' ? '色' : 'おみくじ'}:${c.command.status}`));
      li.appendChild(meta);
      const p = document.createElement('div');
      p.className = 'text';
      p.textContent = c.text;
      li.appendChild(p);
      const cands = document.createElement('div');
      cands.className = 'cands';
      (c.candidates || []).forEach((r) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = r;
        b.addEventListener('click', () => {
          $('msgTarget').value = c.name;
          $('msgText').value = r;
          updateCount();
          $('msgText').focus();
        });
        cands.appendChild(b);
      });
      li.appendChild(cands);
    }
    ol.prepend(li);
    while (ol.children.length > COMMENTS_MAX) ol.lastElementChild.remove();
  }

  function addLog(l) {
    const ol = $('log');
    const li = document.createElement('li');
    li.className = `t-${l.tag}`;
    li.textContent = `${new Date(l.at).toLocaleTimeString('ja-JP')} [${l.tag}] ${l.msg}`;
    ol.prepend(li);
    while (ol.children.length > LOG_MAX) ol.lastElementChild.remove();
  }

  /* ---------- 操作 ---------- */
  async function act(name, payload) {
    const res = await send(name, payload);
    if (!res.ok) addLog({ at: Date.now(), tag: 'ERROR', msg: `${name}: ${res.error}${res.reasons ? ` (${res.reasons.join(', ')})` : ''}` });
    if (res.state) renderState({ ...state, ...res.state });
    return res;
  }

  $('btnPause').addEventListener('click', () => act('admin:pause'));
  $('btnResume').addEventListener('click', () => act('admin:resume'));
  $('btnSkip').addEventListener('click', () => act('admin:skip'));
  $('btnClear').addEventListener('click', () => act('admin:clear'));

  // 全停止は2回押しで実行（押し間違い防止。ブラウザのダイアログは使わない）
  let armTimer = 0;
  $('btnStop').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (!btn.classList.contains('is-armed')) {
      btn.classList.add('is-armed');
      btn.textContent = 'もう一度押すと全停止';
      armTimer = setTimeout(() => { btn.classList.remove('is-armed'); btn.textContent = '全停止（緊急停止）'; }, 3000);
      return;
    }
    clearTimeout(armTimer);
    btn.classList.remove('is-armed');
    btn.textContent = '全停止（緊急停止）';
    act('admin:stop');
  });

  ['setGift', 'setCommentDisplay', 'setCommands'].forEach((id) => {
    $(id).addEventListener('change', () => act('admin:settings', {
      giftEffects: $('setGift').checked,
      commentDisplay: $('setCommentDisplay').checked,
      commentCommands: $('setCommands').checked,
    }));
  });

  // 色ボタン（手動オーバーライド）とメッセージ色の選択肢
  Object.entries(THEMES).forEach(([id, t]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.color = id;
    b.textContent = t.name;
    b.style.background = id === 'rainbow' ? `linear-gradient(90deg, ${t.colors.join(',')})` : t.colors[0];
    b.addEventListener('click', () => act('admin:override', {
      color: id, category: $('ovCategory').value || null, interrupt: $('ovInterrupt').checked,
    }));
    $('colorGrid').appendChild(b);
    const o = document.createElement('option');
    o.value = id; o.textContent = `${t.name}（${t.meaning}）`;
    $('msgColor').appendChild(o);
  });

  function updateCount() { $('msgCount').textContent = `${Array.from($('msgText').value).length} / 60`; }
  $('msgText').addEventListener('input', updateCount);
  $('msgReset').addEventListener('click', () => { $('msgTarget').value = ''; $('msgText').value = ''; $('msgError').textContent = ''; updateCount(); });
  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('msgError').textContent = '';
    const res = await act('admin:message', {
      text: $('msgText').value, target: $('msgTarget').value.trim(), color: $('msgColor').value, interrupt: $('msgInterrupt').checked,
    });
    if (!res.ok) {
      $('msgError').textContent = res.reasons ? `自動チェックで表示できませんでした（${res.reasons.join(', ')}）` : `送信できませんでした（${res.error}）`;
    } else {
      $('msgText').value = ''; $('msgTarget').value = ''; updateCount();
    }
  });

  // テスト（シミュレーション）
  $('simGift').addEventListener('click', () => act('sim:gift', { tier: 'normal', giftId: 'test-normal', giftName: '通常ギフト', user: { key: 'admin-test', name: '管理パネル' } }));
  $('simGiftSp').addEventListener('click', () => act('sim:gift', { tier: 'special', giftId: 'test-special', giftName: '特別ギフト', user: { key: 'admin-test', name: '管理パネル' } }));
  $('simCommentForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('simComment').value;
    if (!text) return;
    act('sim:comment', { text, user: { key: 'admin-test', name: '管理パネル' } });
    $('simComment').value = '';
  });

  /* ---------- ログイン ---------- */
  $('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    connect($('token').value.trim());
    $('token').value = '';
  });
  try {
    const saved = sessionStorage.getItem('hadoToken');
    if (saved) connect(saved);
  } catch (e) { /* noop */ }
})();
