/* 波動カラー10種の演出定義。
 * particle.shape  : effects.js の描画関数名
 * particle.motion : effects.js の動き方
 * ripple.style    : effects.js の波紋スタイル
 * aura            : overlay.css の .aura--<id> で個別アニメーション
 * bg              : 背景グラデーション（CSS）
 * text            : overlay.css の .text-anim--<name>
 */
(function (global) {
  'use strict';

  const THEMES = {
    gold: {
      name: 'ゴールド', meaning: '豊かさ・感謝',
      colors: ['#ffd76a', '#fff2b8', '#d4a017'], glow: '#ffcf40',
      bg: 'radial-gradient(ellipse at 50% 40%, #6b4a0e 0%, #2e1d05 55%, #120a02 100%)',
      particle: { shape: 'star4', motion: 'rise', count: 120, size: [6, 16], speed: [1.2, 2.6], twinkle: true },
      ripple: { style: 'rings', count: 3, width: 3, speed: 9 },
      text: 'shine',
    },
    purple: {
      name: 'パープル', meaning: '直感',
      colors: ['#c39bff', '#e9dcff', '#7b3fe4'], glow: '#a970ff',
      bg: 'radial-gradient(ellipse at 50% 35%, #3d1a6e 0%, #1c0b36 60%, #0a0416 100%)',
      particle: { shape: 'orb', motion: 'swirl', count: 110, size: [4, 12], speed: [0.6, 1.4] },
      ripple: { style: 'soft', count: 2, width: 26, speed: 5 },
      text: 'blur',
    },
    green: {
      name: 'グリーン', meaning: '癒やし',
      colors: ['#8be3a1', '#d6f7dc', '#2f9e5a'], glow: '#6fdc8c',
      bg: 'radial-gradient(ellipse at 50% 45%, #1d5a35 0%, #0d2d1a 60%, #04120a 100%)',
      particle: { shape: 'leaf', motion: 'drift', count: 70, size: [12, 24], speed: [0.8, 1.6] },
      ripple: { style: 'wave', count: 5, width: 2, speed: 4 },
      text: 'float',
    },
    pink: {
      name: 'ピンク', meaning: '愛情',
      colors: ['#ff9fc8', '#ffe0ee', '#e8508f'], glow: '#ff7eb6',
      bg: 'radial-gradient(ellipse at 50% 40%, #6e2547 0%, #3a1026 60%, #170510 100%)',
      particle: { shape: 'heart', motion: 'float', count: 80, size: [12, 26], speed: [1.0, 2.0] },
      ripple: { style: 'double', count: 2, width: 4, speed: 7 },
      text: 'pop',
    },
    blue: {
      name: 'ブルー', meaning: '冷静さ',
      colors: ['#7fc4ff', '#dcefff', '#2a6fd6'], glow: '#5aaeff',
      bg: 'radial-gradient(ellipse at 50% 30%, #123c6e 0%, #081e3a 60%, #020a17 100%)',
      particle: { shape: 'drop', motion: 'fall', count: 90, size: [6, 14], speed: [3.5, 6.5] },
      ripple: { style: 'water', count: 4, width: 2, speed: 6 },
      text: 'type',
    },
    red: {
      name: 'レッド', meaning: '勇気',
      colors: ['#ff6a4d', '#ffd1a8', '#c4161c'], glow: '#ff4a2e',
      bg: 'radial-gradient(ellipse at 50% 60%, #6e1410 0%, #350806 60%, #140202 100%)',
      particle: { shape: 'ember', motion: 'rise', count: 150, size: [3, 9], speed: [2.5, 5.0], flicker: true },
      ripple: { style: 'shock', count: 2, width: 14, speed: 16 },
      text: 'flare',
    },
    white: {
      name: 'ホワイト', meaning: 'リセット',
      colors: ['#ffffff', '#f2f5ff', '#cfd8ea'], glow: '#ffffff',
      bg: 'radial-gradient(ellipse at 50% 40%, #5a6275 0%, #2a2f3b 60%, #101218 100%)',
      particle: { shape: 'snow', motion: 'fall', count: 110, size: [3, 9], speed: [0.8, 1.8] },
      ripple: { style: 'flash', count: 1, width: 0, speed: 14 },
      text: 'clean',
    },
    aqua: {
      name: 'アクア', meaning: '変化',
      colors: ['#7ff3f0', '#dcfffd', '#16b3b8'], glow: '#4fe6e2',
      bg: 'radial-gradient(ellipse at 50% 50%, #0d5c63 0%, #062e33 60%, #011316 100%)',
      particle: { shape: 'bubble', motion: 'wobble', count: 70, size: [10, 30], speed: [1.0, 2.2] },
      ripple: { style: 'ellipse', count: 3, width: 3, speed: 6 },
      text: 'wave',
    },
    orange: {
      name: 'オレンジ', meaning: '創造性',
      colors: ['#ffb057', '#ffe5c2', '#f06a0f'], glow: '#ff9a2e',
      bg: 'radial-gradient(ellipse at 50% 45%, #6e3a0c 0%, #361b05 60%, #150a01 100%)',
      particle: { shape: 'confetti', motion: 'burst', count: 140, size: [8, 16], speed: [6, 14] },
      ripple: { style: 'dash', count: 3, width: 4, speed: 8 },
      text: 'bounce',
    },
    rainbow: {
      name: 'レインボー', meaning: '祝福',
      colors: ['#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff', '#b06bff'], glow: '#ffffff',
      bg: 'radial-gradient(ellipse at 50% 40%, #3b2a5c 0%, #1d1530 60%, #0a0712 100%)',
      particle: { shape: 'prism', motion: 'burst', count: 160, size: [8, 18], speed: [5, 12], hueCycle: true },
      ripple: { style: 'rainbow', count: 6, width: 6, speed: 8 },
      text: 'rainbow',
    },
  };

  global.HADO_THEMES = THEMES;
})(window);
