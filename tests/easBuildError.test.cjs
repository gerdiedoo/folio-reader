const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildErrorAnnotation } = require('../scripts/report-eas-build-error.cjs');

test('EAS failures expose captured JSON and stderr as one escaped GitHub annotation', () => {
  const value = buildErrorAnnotation('{"message":"Build quota exceeded"}', 'An error occurred.\nRate: 50%\r\n');
  assert.ok(value.startsWith('::error title=EAS APK build failed::'));
  assert.ok(value.includes('Build quota exceeded')); assert.ok(value.includes('An error occurred.'));
  assert.ok(value.includes('50%25')); assert.ok(value.includes('%0A')); assert.ok(!value.includes('\n'));
});

test('failure diagnostics redact configured credentials and bearer headers before truncating', () => {
  const value = buildErrorAnnotation('token example-private-token', '\u001b[31mBearer another-private-value\u001b[0m', ['example-private-token']);
  assert.ok(!value.includes('example-private-token')); assert.ok(!value.includes('another-private-value'));
  assert.ok(!value.includes('\u001b')); assert.ok(value.includes('[REDACTED]'));
});

test('empty output gives an actionable fallback and long output is bounded', () => {
  assert.match(buildErrorAnnotation('', ''), /without diagnostic output/);
  const long = buildErrorAnnotation('a'.repeat(20000) + 'final failure', '');
  assert.ok(long.length < 12100); assert.ok(long.endsWith('final failure'));
});
