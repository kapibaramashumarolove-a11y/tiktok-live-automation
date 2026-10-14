'use strict';

const crypto = require('crypto');

/** 管理用トークンの比較（長さや内容による応答時間の差が出ないよう、ハッシュ同士を定数時間で比較） */
function tokenEquals(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !given || !expected) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function isLoopback(addr) {
  if (!addr) return false;
  const a = String(addr).replace(/^::ffff:/, '');
  return a === '::1' || /^127\.\d+\.\d+\.\d+$/.test(a);
}

/**
 * ブラウザからの接続で、Origin のホストが接続先ホストと一致するか。
 * 別サイトのページから管理用ソケットへ接続させる攻撃（クロスサイト WebSocket ハイジャック）を防ぐ。
 * Origin がない（ブラウザ以外のクライアント）場合は許可し、トークン認証に任せる。
 */
function sameOrigin(origin, host) {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function generateToken() {
  return crypto.randomBytes(18).toString('base64url');
}

/** すべての応答に付けるセキュリティヘッダー */
function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
}

module.exports = { tokenEquals, isLoopback, sameOrigin, generateToken, securityHeaders };
