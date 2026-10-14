'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { tokenEquals, isLoopback, sameOrigin, generateToken } = require('../src/lib/security');

test('tokenEquals', () => {
  assert.ok(tokenEquals('abc123', 'abc123'));
  assert.ok(!tokenEquals('abc124', 'abc123'));
  assert.ok(!tokenEquals('abc', 'abc123'));
  assert.ok(!tokenEquals('', ''));
  assert.ok(!tokenEquals(undefined, 'x'));
  assert.ok(!tokenEquals({ toString: () => 'x' }, 'x'));
});

test('isLoopback', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.1.2.3']) assert.ok(isLoopback(a), a);
  for (const a of ['192.168.0.2', '10.0.0.1', '::ffff:192.168.0.2', '', undefined, '1270.0.0.1']) assert.ok(!isLoopback(a), String(a));
});

test('sameOrigin', () => {
  assert.ok(sameOrigin(undefined, 'localhost:3000'));
  assert.ok(sameOrigin('http://localhost:3000', 'localhost:3000'));
  assert.ok(!sameOrigin('http://evil.example', 'localhost:3000'));
  assert.ok(!sameOrigin('http://localhost:3001', 'localhost:3000'));
  assert.ok(!sameOrigin('null', 'localhost:3000'));
});

test('generateToken は十分な長さでランダム', () => {
  const a = generateToken();
  assert.ok(a.length >= 24);
  assert.notStrictEqual(a, generateToken());
});
