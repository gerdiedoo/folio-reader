const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/systemMotion.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { watchSystemMotion } = loaded.exports;
const settle = () => new Promise(resolve => setImmediate(resolve));

function source() {
  let resolve, reject, listener;
  let removed = false;
  const read = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return {
    api: { isReduceMotionEnabled: () => read, addEventListener(name, fn) {
      assert.equal(name, 'reduceMotionChanged'); listener = fn;
      return { remove() { removed = true; } };
    } },
    resolve: value => resolve(value), reject: () => reject(new Error('Native query failed')),
    emit: value => listener(value), removed: () => removed,
  };
}

test('motion starts conservatively and follows the system snapshot and later changes', async () => {
  const s = source(), values = [];
  const stop = watchSystemMotion(s.api, v => values.push(v));
  assert.deepEqual(values, [true]);
  s.resolve(false);
  await settle();
  s.emit(true);
  s.emit(false);
  assert.deepEqual(values, [true, false, true, false]);
  stop();
  assert.equal(s.removed(), true);
});

test('a newer preference event wins over an older initial query result', async () => {
  for (const event of [true, false]) {
    const s = source(), values = [];
    const stop = watchSystemMotion(s.api, v => values.push(v));
    s.emit(event);
    s.resolve(!event);
    await settle();
    assert.deepEqual(values, [true, event]);
    stop();
  }
});

test('query failure retains the safe default or latest event', async () => {
  for (const event of [undefined, false]) {
    const s = source(), values = [];
    const stop = watchSystemMotion(s.api, v => values.push(v));
    if (event !== undefined) s.emit(event);
    s.reject();
    await settle();
    assert.equal(values.at(-1), event ?? true);
    stop();
  }
});

test('unsubscribed observers ignore late query results and queued native events', async () => {
  const s = source(), values = [];
  const stop = watchSystemMotion(s.api, v => values.push(v));
  stop();
  s.emit(false);
  s.resolve(false);
  await settle();
  assert.deepEqual(values, [true]);
});

test('unavailable native APIs do not block app startup', () => {
  const values = [];
  const stop = watchSystemMotion({
    addEventListener() { throw new Error('Unavailable'); },
    isReduceMotionEnabled() { throw new Error('Unavailable'); },
  }, v => values.push(v));
  assert.deepEqual(values, [true]);
  stop();
});
