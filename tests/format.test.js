import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionOf, formatBytes, formatDuration, safeBaseName } from '../src/lib/format.js';

test('formatBytes uses decimal units and never prints "1000 KB"', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(999), '999 B');
  assert.equal(formatBytes(1500), '1.50 KB');
  assert.equal(formatBytes(120_000_000), '120 MB');
  assert.equal(formatBytes(999_600), '1.00 MB');
  assert.equal(formatBytes(2_500_000_000), '2.50 GB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(NaN), '—');
});

test('formatDuration handles minutes, hours and invalid input', () => {
  assert.equal(formatDuration(5.9), '0:05');
  assert.equal(formatDuration(75), '1:15');
  assert.equal(formatDuration(3725), '1:02:05');
  assert.equal(formatDuration(Infinity), '—');
  assert.equal(formatDuration(null), '—');
});

test('safeBaseName strips unsafe characters and falls back to "video"', () => {
  assert.equal(safeBaseName('My Holiday (2026).MOV'), 'My-Holiday-2026');
  assert.equal(safeBaseName('../../etc/passwd.mp4'), 'etc-passwd');
  assert.equal(safeBaseName('日本語.mp4'), 'video');
  assert.equal(safeBaseName('a'.repeat(200) + '.mp4').length, 64);
});

test('extensionOf lower-cases and rejects odd extensions', () => {
  assert.equal(extensionOf('Clip.MOV'), 'mov');
  assert.equal(extensionOf('noextension'), 'bin');
  assert.equal(extensionOf('weird.toolongextension'), 'bin');
});
