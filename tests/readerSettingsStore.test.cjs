const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
function load(filename) {
  const loaded = new Module(filename, module);
  loaded.require = name => load(path.resolve(path.dirname(filename), name + '.ts'));
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return loaded.exports;
}
const { createReaderSettingsStore } = load(path.resolve(__dirname, '../src/lib/readerSettingsStore.ts'));
let sequence = 0;
function fixture() {
  const data = new Map(), prefix = `preferences-${++sequence}.`;
  let failRead = false, failWrite = false, gate, writes = 0;
  const scope = id => ({
    storageKey: key => prefix + id + '.' + key,
    async loadJSONEntryStrict(key) {
      if (failRead) throw new Error('Read failure');
      const raw = data.get(this.storageKey(key));
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      writes++;
      if (gate) await gate;
      if (failWrite) { failWrite = false; throw new Error('Full'); }
      data.set(this.storageKey(key), JSON.stringify(value));
    },
  });
  const storage = scope('dev:A');
  return { data, scope, storage, store: createReaderSettingsStore(storage), writes: () => writes,
    legacy: value => data.set(storage.storageKey('settings'), JSON.stringify(value)),
    failRead: value => { failRead = value; }, failWrite: () => { failWrite = true; },
    block: () => { let release; gate = new Promise(ok => { release = ok; }); return release; },
  };
}

test('legacy reading choices load without writes and remain intact after an archive save', async () => {
  const f = fixture(); f.legacy({ theme: 'charcoal', font: 'Inter', fontSizeStep: 7 });
  const original = f.data.get(f.storage.storageKey('settings'));
  const loaded = await f.store.load();
  assert.equal(loaded.hasSaved, true); assert.equal(loaded.settings.font, 'Manrope');
  assert.equal(f.writes(), 0);
  await f.store.patch({ margins: 'wide' });
  const restart = await createReaderSettingsStore(f.storage).load();
  assert.equal(restart.settings.theme, 'charcoal'); assert.equal(restart.settings.margins, 'wide');
  assert.equal(restart.settings.fontSizeStep, 7);
  assert.equal(f.data.get(f.storage.storageKey('settings')), original);
});

test('malformed/null legacy settings, unreadable storage and unknown archives block writes and cloud seeding', async () => {
  for (const [key, raw] of [['settings', '{'], ['settings', 'null'], ['settings', '[]'],
    ['settingsArchive', 'null'], ['settingsArchive', '{"version":2,"settings":{}}'],
    ['settingsArchive', '{"version":1,"settings":null}']]) {
    const f = fixture(); f.data.set(f.storage.storageKey(key), raw);
    await assert.rejects(f.store.load());
    await assert.rejects(f.store.patch({ theme: 'white' }));
    await assert.rejects(f.store.seedCloud({ theme: 'white' }));
    assert.equal(f.writes(), 0); assert.equal(f.data.get(f.storage.storageKey(key)), raw);
  }
  const f = fixture(); f.failRead(true);
  await assert.rejects(f.store.patch({ theme: 'white' })); assert.equal(f.writes(), 0);
  f.failRead(false); await f.store.patch({ theme: 'white' });
  assert.equal((await f.store.load()).settings.theme, 'white');
});

test('a present unsupported archive never falls back to earlier valid choices', async () => {
  const f = fixture(); f.legacy({ theme: 'sepia' });
  f.data.set(f.storage.storageKey('settingsArchive'), '{"version":9,"settings":{}}');
  await assert.rejects(f.store.patch({ margins: 'wide' })); assert.equal(f.writes(), 0);
});

test('save confirmation and remounted loads wait for storage acknowledgement', async () => {
  const f = fixture(), release = f.block();
  let done = false;
  const pending = f.store.patch({ theme: 'sepia' }).then(value => { done = true; return value; });
  const reloading = createReaderSettingsStore(f.storage).load();
  await new Promise(ok => setImmediate(ok));
  assert.equal(done, false); assert.equal(f.data.size, 0);
  release(); await pending;
  assert.equal((await reloading).settings.theme, 'sepia');
});

test('concurrent partial changes and relative size taps use the latest durable settings', async () => {
  const f = fixture(), other = createReaderSettingsStore(f.storage);
  await Promise.all([f.store.patch({ theme: 'charcoal' }), other.patch({ font: 'Manrope' }),
    f.store.patch(current => ({ fontSizeStep: current.fontSizeStep + 1 })),
    other.patch(current => ({ fontSizeStep: current.fontSizeStep + 1 }))]);
  const saved = (await f.store.load()).settings;
  assert.equal(saved.theme, 'charcoal'); assert.equal(saved.font, 'Manrope'); assert.equal(saved.fontSizeStep, 6);
});

test('a failed write retains confirmed settings and does not poison the save queue', async () => {
  const f = fixture(); await f.store.patch({ theme: 'sepia' }); f.failWrite();
  await assert.rejects(f.store.patch({ theme: 'charcoal' }));
  assert.equal((await f.store.load()).settings.theme, 'sepia');
  await f.store.patch({ margins: 'wide' });
  assert.equal((await f.store.load()).settings.margins, 'wide');
});

test('cloud choices seed an empty device once and cannot replace legacy or newer local choices', async () => {
  const f = fixture(); assert.equal((await f.store.load()).hasSaved, false);
  await f.store.seedCloud({ theme: 'charcoal', font: 'Georgia', fontSizeStep: 6 });
  assert.equal((await f.store.load()).settings.font, 'System Serif');
  await f.store.seedCloud({ theme: 'white' });
  assert.equal((await f.store.load()).settings.theme, 'charcoal');
  const legacy = fixture(); legacy.legacy({ theme: 'sepia' });
  await legacy.store.seedCloud({ theme: 'white' }); assert.equal(legacy.writes(), 0);
  const late = fixture(); await late.store.patch({ theme: 'sepia' });
  await late.store.seedCloud({ theme: 'white' });
  assert.equal((await late.store.load()).settings.theme, 'sepia');
});

test('invalid individual preference fields receive safe fallbacks without erasing valid choices', async () => {
  const f = fixture(); f.legacy({ theme: 'constructor', margins: 'wide', fontSizeStep: 30, font: 'Inter', wpm: 'fast' });
  const saved = (await f.store.load()).settings;
  assert.equal(saved.theme, 'parchment'); assert.equal(saved.margins, 'wide');
  assert.equal(saved.fontSizeStep, 8); assert.equal(saved.font, 'Manrope'); assert.equal(saved.wpm, 240);
  assert.equal(f.writes(), 0);
});

test('backend, accounts and Guest keep independent preferences', async () => {
  const f = fixture();
  const spaces = ['dev:A', 'dev:B', 'dev:guest', 'production:A'].map(id => createReaderSettingsStore(f.scope(id)));
  await Promise.all(spaces.map((space, index) => space.patch({ fontSizeStep: index + 1 })));
  assert.deepEqual(await Promise.all(spaces.map(async space => (await space.load()).settings.fontSizeStep)), [1, 2, 3, 4]);
});
