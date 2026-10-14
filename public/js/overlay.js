/* オーバーレイ本体：画面スケーリング、テーマ適用、演出再生、コメント表示、テストUI。
 * 演出の順番と長さはサーバー側のキューが決める（play / play:update / play:end）。
 * 画面に出す文字列はサーバーでサニタイズ済みのものだけで、挿入は必ず textContent で行う。
 */
(function () {
  'use strict';

  const THEMES = window.HADO_THEMES;
  const FX = window.HadoEffects;
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);

  const THEME_HOLD_MS = 4000;  // 演出終了後に色を残す時間
  const TICKER_MAX = 3;        // 同時に表示するコメント数（DOM 肥大化防止）
  const TICKER_MS = 9000;      // コメント1件の表示時間
  const LOG_MAX = 40;          // テストログの最大行数
  const IDLE = { colors: ['#ffd98a', '#fff3d6', '#c9973a'], glow: '#ffcf70' };

  const stage = $('stage');
  const bgLayers = [$('bgA'), $('bgB')];
  let bgIndex = 0;
  let currentId = null;
  let currentTheme = null;
  let endTimer = 0;
  let themeTimer = 0;
  let lastBurst = 0;

  /* ---------- 9:16 スケーリング ---------- */
  function fit() {
    const s = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    // 原点を左上にして中央寄せ（left/top:50% から半分戻す）
    stage.style.transform = `translate(${-540 * s}px, ${-960 * s}px) scale(${s})`;
  }
  window.addEventListener('resize', fit);
  fit();

  if (params.get('transparent') === '1') document.body.classList.add('transparent');
  if (params.get('disclaimer') === 'top') $('disclaimer').classList.add('pos-top');

  FX.init($('fx'), { x: 540, y: 790 });

  /* ---------- テーマ適用 ---------- */
  function setPalette(t) {
    const c = t.colors;
    stage.style.setProperty('--c1', c[0]);
    stage.style.setProperty('--c2', c[1] || c[0]);
    stage.style.setProperty('--c3', c[2] || c[0]);
    stage.style.setProperty('--glow', t.glow);
    FX.setAmbientColor(c[0]);
  }

  function applyTheme(colorId) {
    const t = THEMES[colorId];
    setPalette(t);
    const next = bgLayers[bgIndex ^ 1];
    next.style.background = t.bg;
    next.classList.add('is-on');
    bgLayers[bgIndex].classList.remove('is-on');
    bgIndex ^= 1;

    const aura = $('aura');
    aura.className = `aura aura--${colorId}`;
    void aura.offsetWidth; // アニメーションを先頭から再生
    aura.classList.add('is-on');
  }

  function resetTheme() {
    setPalette(IDLE);
    bgLayers.forEach((l) => l.classList.remove('is-on'));
    $('aura').classList.remove('is-on');
  }

  function renderText(el, text, anim) {
    el.className = `card__text text-anim--${anim}${Array.from(text).length > 32 ? ' card__text--long' : ''}`;
    el.textContent = '';
    const perChar = anim === 'pop' || anim === 'type' || anim === 'wave' || anim === 'bounce';
    if (!perChar) { el.textContent = text; return; }
    const frag = document.createDocumentFragment();
    Array.from(text).forEach((ch, i) => {
      const s = document.createElement('span');
      s.className = 'ch';
      s.style.setProperty('--i', i);
      s.textContent = ch;
      frag.appendChild(s);
    });
    el.appendChild(frag);
  }

  /* ---------- 演出再生（キューから1件ずつ届く） ---------- */
  function play(item) {
    const t = THEMES[item.color];
    if (!t) return;
    clearTimeout(endTimer);
    clearTimeout(themeTimer);
    currentId = item.id;
    currentTheme = t;

    applyTheme(item.color);
    FX.fadeOut();
    FX.spawn(t, item.intensity || 1);

    const hl = $('cardHeadline');
    hl.textContent = item.headline || '';
    hl.hidden = !item.headline;
    $('cardColor').textContent = `${t.name}｜${t.meaning}`;
    $('cardCategory').textContent = item.message.categoryLabel;
    renderText($('cardText'), item.message.text, t.text);

    const src = $('cardSource');
    const label = item.simulated ? 'テスト演出（シミュレーション）' : item.origin === 'operator' ? '配信者による演出' : '';
    src.hidden = !label;
    src.textContent = label;
    src.classList.toggle('card__source--operator', item.origin === 'operator');

    const card = $('card');
    card.classList.remove('is-on');
    void card.offsetWidth;
    card.classList.add('is-on');
    $('idleText').classList.add('is-hidden');

    // サーバーからの play:end が届かない場合の保険
    endTimer = setTimeout(() => end(item.id), (item.durationMs || 6000) + 8000);
  }

  function update(u) {
    if (u.id !== currentId) return;
    const hl = $('cardHeadline');
    hl.textContent = u.headline || hl.textContent;
    hl.classList.remove('bump');
    void hl.offsetWidth;
    hl.classList.add('bump');
    const now = performance.now();
    if (currentTheme && now - lastBurst > 400) { lastBurst = now; FX.spawn(currentTheme, 0.2); }
  }

  function end(id) {
    if (id !== currentId) return;
    clearTimeout(endTimer);
    currentId = null;
    $('card').classList.remove('is-on');
    $('idleText').classList.remove('is-hidden');
    themeTimer = setTimeout(resetTheme, THEME_HOLD_MS);
  }

  /** 全停止（緊急停止）：演出・カード・コメントをすべて消す（免責注記は残る） */
  function clearAll() {
    clearTimeout(endTimer);
    clearTimeout(themeTimer);
    currentId = null;
    currentTheme = null;
    FX.clear();
    $('card').classList.remove('is-on');
    $('ticker').textContent = '';
    $('idleText').classList.remove('is-hidden');
    resetTheme();
  }

  /* ---------- コメント表示 ---------- */
  function showComment(c) {
    const ul = $('ticker');
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'ticker__name';
    name.textContent = c.name;
    li.append(name, document.createTextNode(c.text));
    if (c.simulated) {
      const tag = document.createElement('span');
      tag.className = 'ticker__tag';
      tag.textContent = 'テスト';
      li.appendChild(tag);
    }
    ul.appendChild(li);
    while (ul.children.length > TICKER_MAX) ul.firstElementChild.remove();
    setTimeout(() => {
      li.classList.add('is-out');
      setTimeout(() => li.remove(), 500);
    }, TICKER_MS);
  }

  /* ---------- サーバー接続（受信専用） ---------- */
  const socket = window.io ? window.io() : null;
  const conn = $('conn');

  if (socket) {
    socket.on('status', (st) => { $('modeBadge').hidden = st.mode !== 'simulation'; });
    socket.on('play', (item) => {
      play(item);
      log(`[${item.origin === 'operator' ? 'OPERATOR' : item.simulated ? 'SIMULATION' : 'LIVE'}] 再生 #${item.id} ${item.kind} ${THEMES[item.color].name} ${item.durationMs}ms`);
    });
    socket.on('play:update', update);
    socket.on('play:end', (e) => end(e.id));
    socket.on('comment', showComment);
    socket.on('stop', () => { clearAll(); log('全停止（緊急停止）を受信：画面を消去'); });
  } else {
    // サーバーなしで開いた場合も「実イベント未接続」であることを表示する
    $('modeBadge').hidden = false;
  }

  /* ---------- テストUI ---------- */
  function log(line) {
    const ol = $('testLog');
    if (!ol) return;
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString('ja-JP')} ${line}`;
    ol.prepend(li);
    while (ol.children.length > LOG_MAX) ol.lastElementChild.remove();
  }

  /* 操作の送信は管理用の接続（トークン必須）で行う */
  let adminSocket = null;

  function connectAdmin(token) {
    if (adminSocket) adminSocket.disconnect();
    adminSocket = window.io('/admin', { auth: { token }, reconnectionAttempts: 3 });
    adminSocket.on('connect', () => {
      conn.textContent = '管理接続：OK（テストイベントを送信できます）'; conn.className = 'test-panel__conn ok';
      $('authMsg').textContent = '';
      try { sessionStorage.setItem('hadoToken', token); } catch (e) { /* 保存できなくても動作する */ }
    });
    adminSocket.on('connect_error', (e) => {
      conn.textContent = `管理接続：失敗（${e.message}）`; conn.className = 'test-panel__conn ng';
      try { sessionStorage.removeItem('hadoToken'); } catch (e2) { /* noop */ }
    });
    adminSocket.on('disconnect', () => { conn.textContent = '管理接続：切断'; conn.className = 'test-panel__conn ng'; });
    adminSocket.on('admin:state', showQueue);
    adminSocket.on('admin:init', (d) => showQueue(d.state));
  }

  function showQueue(st) {
    const q = st.queue;
    const w = q.waiting;
    const run = { running: '稼働中', paused: '一時停止中', stopped: '全停止中' }[st.runState];
    $('queueStats').textContent =
      `状態：${run} / キュー ${q.state} 待機 high=${w.high} normal=${w.normal} low=${w.low} 速度x${q.speedFactor}\n` +
      `受付${q.counters.enqueued} まとめ${q.counters.merged} 集約${q.counters.summarized} 破棄${q.counters.dropped} 再生${q.counters.played}\n` +
      `非表示コメント${st.stats.blockedComments} 名前置換${st.stats.blockedNames} クールダウン${st.stats.cooldownSkips} 間引き${st.stats.feedDropped}`;
  }

  function send(name, payload, onResult) {
    if (!adminSocket || !adminSocket.connected) { log('管理接続がないため送信できません（トークンを入力してください）'); return; }
    adminSocket.emit(name, payload, (res) => {
      if (!res || !res.ok) { log(`エラー: ${(res && res.error) || 'no response'}`); return; }
      if (res.ignored) { log(`受付せず: ${res.ignored}`); return; }
      if (onResult) onResult(res);
    });
  }

  const simName = () => $('simName').value || '視聴者';
  const gift = (tier, user, count) => send('sim:gift', {
    tier, count: count || 1,
    giftId: tier === 'special' ? 'test-special' : 'test-normal',
    giftName: tier === 'special' ? '特別ギフト' : '通常ギフト',
    user,
  }, (r) => log(`[SIMULATION] ギフト受付 ${r.eventId} -> ${r.queue.status}`));

  function comment(text, user) {
    send('sim:comment', { text, user: user || { key: simName(), name: simName() } }, (r) => {
      if (!r.displayed) log(`[SIMULATION] コメント非表示 ${r.eventId} 理由: ${r.reasons.join(', ')}`);
      else log(`[SIMULATION] コメント表示 ${r.eventId}${r.command ? ` コマンド:${r.command.type} ${r.command.status}` : ''}`);
    });
  }

  function setupTestPanel() {
    $('testPanel').hidden = false;
    conn.textContent = '管理接続：未接続（トークンを入力）';
    $('authForm').addEventListener('submit', (e) => {
      e.preventDefault();
      connectAdmin($('authToken').value.trim());
      $('authToken').value = '';
    });
    try {
      const saved = sessionStorage.getItem('hadoToken');
      if (saved) connectAdmin(saved);
    } catch (e) { /* noop */ }
    const colorsBox = $('testColors');
    Object.entries(THEMES).forEach(([id, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.color = id;
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = id === 'rainbow' ? `linear-gradient(90deg, ${t.colors.join(',')})` : t.colors[0];
      b.append(sw, `${t.name}（${t.meaning}）`);
      b.addEventListener('click', () => send('sim:effect', { color: id, category: $('testCategory').value || null }));
      colorsBox.appendChild(b);
    });
    $('testRandom').addEventListener('click', () => {
      const ids = Object.keys(THEMES);
      send('sim:effect', { color: ids[Math.floor(Math.random() * ids.length)], category: $('testCategory').value || null });
    });

    const me = () => ({ key: simName(), name: simName() });
    $('simGiftNormal').addEventListener('click', () => gift('normal', me()));
    $('simGiftSpecial').addEventListener('click', () => gift('special', me()));
    $('simGiftCombo').addEventListener('click', () => {
      for (let i = 0; i < 10; i++) setTimeout(() => gift('normal', me()), i * 150);
    });
    $('simGiftBurst').addEventListener('click', () => {
      for (let i = 1; i <= 20; i++) gift(i % 7 === 0 ? 'special' : 'normal', { key: `burst${i}`, name: `視聴者${i}` });
    });
    $('simGiftFlood').addEventListener('click', () => {
      for (let i = 1; i <= 100; i++) gift('normal', { key: `flood${i}`, name: `視聴者${i}` });
    });
    $('simMixed').addEventListener('click', () => {
      const samples = ['こんばんは', 'ピンク', 'おみくじ', 'きれい！', 'バカ', '090-0000-0000'];
      for (let i = 1; i <= 40; i++) {
        setTimeout(() => {
          if (i % 2) gift('normal', { key: `mix${i % 5}`, name: `視聴者${i % 5}` });
          else comment(samples[i % samples.length], { key: `mix${i}`, name: `視聴者${i}` });
        }, i * 50);
      }
    });

    $('simPreset').addEventListener('change', (e) => { $('simText').value = e.target.value; });
    $('simCommentSend').addEventListener('click', () => comment($('simText').value));
    $('simCommentFlood').addEventListener('click', () => {
      for (let i = 1; i <= 30; i++) comment(`テストコメント${i}`, { key: `c${i}`, name: `視聴者${i}` });
    });

    fetch('/api/status').then((r) => r.json()).then((st) => {
      const sel = $('testCategory');
      Object.entries(st.categories || {}).forEach(([k, v]) => {
        const o = document.createElement('option');
        o.value = k; o.textContent = v; sel.appendChild(o);
      });
    }).catch(() => log('分類一覧の取得に失敗しました'));

    setInterval(() => {
      const s = FX.stats();
      $('stats').textContent = `粒子 ${s.particles} / 波紋 ${s.ripples} / sprite ${s.spriteCache} / DOM ${document.getElementsByTagName('*').length}`;
    }, 1000);
  }

  if (params.get('test') === '1') setupTestPanel();

  // 自動テスト用（状態の参照のみ。イベントの生成はできない）
  window.__hado = { stats: FX.stats, currentId: () => currentId };
})();
