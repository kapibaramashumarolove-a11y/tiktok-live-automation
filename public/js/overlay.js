/* オーバーレイ本体：画面スケーリング、テーマ適用、メッセージ表示、テストUI。
 * フェーズ1：新しい演出が来たら現在の演出を置き換える（キュー処理はフェーズ2で実装）。
 */
(function () {
  'use strict';

  const THEMES = window.HADO_THEMES;
  const FX = window.HadoEffects;
  const params = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);

  const CARD_MS = 11000;   // メッセージ表示時間
  const THEME_MS = 16000;  // 背景・オーラを維持する時間
  const LOG_MAX = 30;      // テストログの最大行数（DOM 肥大化防止）
  const IDLE = { colors: ['#ffd98a', '#fff3d6', '#c9973a'], glow: '#ffcf70' };

  const stage = $('stage');
  const bgLayers = [$('bgA'), $('bgB')];
  let bgIndex = 0;
  let cardTimer = 0;
  let themeTimer = 0;

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

  FX.init($('fx'), { x: 540, y: 880 });

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
    el.className = `card__text text-anim--${anim}`;
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

  function showEffect(effect) {
    const t = THEMES[effect.color];
    if (!t) return;
    clearTimeout(cardTimer);
    clearTimeout(themeTimer);

    applyTheme(effect.color);
    FX.fadeOut();
    FX.spawn(t);

    $('cardColor').textContent = `${t.name}｜${t.meaning}`;
    $('cardCategory').textContent = effect.message.categoryLabel;
    renderText($('cardText'), effect.message.text, t.text);

    const src = $('cardSource');
    if (effect.simulated) {
      src.textContent = 'テスト演出（シミュレーション）';
      src.hidden = false;
    } else {
      src.hidden = true;
    }

    const card = $('card');
    card.classList.remove('is-on');
    void card.offsetWidth;
    card.classList.add('is-on');
    $('idleText').classList.add('is-hidden');

    cardTimer = setTimeout(() => {
      card.classList.remove('is-on');
      $('idleText').classList.remove('is-hidden');
    }, CARD_MS);
    themeTimer = setTimeout(resetTheme, THEME_MS);
  }

  /* ---------- サーバー接続 ---------- */
  const socket = window.io ? window.io() : null;
  const conn = $('conn');

  if (socket) {
    socket.on('connect', () => { conn.textContent = 'サーバー接続：OK'; conn.className = 'test-panel__conn ok'; });
    socket.on('disconnect', () => { conn.textContent = 'サーバー切断（再接続待ち）'; conn.className = 'test-panel__conn ng'; });
    socket.on('status', (st) => { $('modeBadge').hidden = st.mode !== 'simulation'; });
    socket.on('effect', (effect) => {
      showEffect(effect);
      if (effect.simulated) log(`[SIMULATION] #${effect.id} ${THEMES[effect.color].name} / ${effect.message.categoryLabel}`);
    });
  } else {
    // サーバーなしで開いた場合も「実イベント未接続」であることを表示する
    $('modeBadge').hidden = false;
    conn.textContent = 'サーバー未接続'; conn.className = 'test-panel__conn ng';
  }

  /* ---------- テストUI ---------- */
  function log(line) {
    const ol = $('testLog');
    const li = document.createElement('li');
    li.textContent = `${new Date().toLocaleTimeString('ja-JP')} ${line}`;
    ol.prepend(li);
    while (ol.children.length > LOG_MAX) ol.lastElementChild.remove();
  }

  function requestTest(color) {
    if (!socket || !socket.connected) { log('サーバー未接続のため送信できません'); return; }
    const category = $('testCategory').value || undefined;
    socket.emit('test:effect', { color, category }, (res) => {
      if (!res || !res.ok) log(`エラー: ${(res && res.error) || 'no response'}`);
    });
  }

  if (params.get('test') === '1') {
    $('testPanel').hidden = false;
    const colorsBox = $('testColors');
    Object.entries(THEMES).forEach(([id, t]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.color = id;
      const sw = document.createElement('span');
      sw.className = 'sw';
      sw.style.background = t.colors.length > 2 && id === 'rainbow'
        ? `linear-gradient(90deg, ${t.colors.join(',')})` : t.colors[0];
      b.append(sw, `${t.name}（${t.meaning}）`);
      b.addEventListener('click', () => requestTest(id));
      colorsBox.appendChild(b);
    });
    $('testRandom').addEventListener('click', () => {
      const ids = Object.keys(THEMES);
      requestTest(ids[Math.floor(Math.random() * ids.length)]);
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

  // デバッグ・自動テスト用（演出の状態確認のみ。イベントの生成はできない）
  window.__hado = { stats: FX.stats };
})();
