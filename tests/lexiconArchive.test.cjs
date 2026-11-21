const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/lexiconArchive.ts');
const loaded = new Module(filename, module);
loaded.require = name => require('./loadTypeScript.cjs').loadTypeScript(path.resolve(path.dirname(filename), name + '.ts'));
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { createLexiconArchive } = loaded.exports;
let sequence = 0;
const card = (id, extra = {}) => ({ id, bookId: 'book', word: `Word ${id}`, phonetic: '/word/', partOfSpeech: 'noun', definition: 'A definition.', contextPassage: 'Original context.', chapter: 'Arrival', masteryLevel: 1, ...extra });
function fixture() {
  const data = new Map(), prefix = `lexicon-test-${++sequence}:`;
  let writes = 0, failRead = false, failWrite = false, gate;
  const store = scope => ({
    storageKey: key => `${prefix}${scope}.${key}`,
    async loadJSONEntryStrict(key) {
      if (failRead) throw new Error('Read failure');
      const raw = data.get(`${prefix}${scope}.${key}`);
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      writes++;
      if (gate) await gate;
      if (failWrite) { failWrite = false; throw new Error('Storage full'); }
      data.set(`${prefix}${scope}.${key}`, JSON.stringify(value));
    },
  });
  const storage = store('dev:A');
  return { data, store, storage, archive: createLexiconArchive(storage), writes: () => writes,
    legacy: value => data.set(storage.storageKey('lexicon'), JSON.stringify(value)),
    failRead: value => { failRead = value; }, failWrite: () => { failWrite = true; },
    blockWrite: () => { let release; gate = new Promise(ok => { release = ok; }); return release; },
  };
}

test('legacy account vocabulary loads without writes, normalizes optional nulls and preserves the original array', async () => {
  const f = fixture();
  f.legacy([card('old', { phonetic: null, chapter: null, partOfSpeech: null, contextPassage: null }), card('unassigned', { bookId: '' })]);
  const original = f.data.get(f.storage.storageKey('lexicon'));
  const before = await f.archive.load();
  assert.equal(before.items[0].phonetic, '');
  assert.equal(before.items[0].contextPassage, '');
  assert.equal(before.items[1].bookId, '');
  assert.equal(f.writes(), 0);
  await f.archive.add(card('new'));
  assert.equal(f.data.get(f.storage.storageKey('lexicon')), original);
  assert.equal((await createLexiconArchive(f.storage).load()).items.length, 3);
});

test('malformed/null vocabulary, invalid mastery and duplicate IDs never become an empty writable archive', async () => {
  for (const raw of ['null', '{', '{}', JSON.stringify([card('a'), card('a')]), JSON.stringify([card('a', { masteryLevel: 0 })]), JSON.stringify([card('a', { definition: {} })])]) {
    const f = fixture(); f.data.set(f.storage.storageKey('lexicon'), raw);
    await assert.rejects(f.archive.load());
    await assert.rejects(f.archive.add(card('new')));
    assert.equal(f.writes(), 0);
    assert.equal(f.data.get(f.storage.storageKey('lexicon')), raw);
  }
});

test('unsupported or inconsistent archives do not fall back to stale legacy vocabulary', async () => {
  for (const value of [null, { version: 2, items: [], removedBookIds: [] },
    { version: 1, items: [card('a')], removedBookIds: ['book'] },
    { version: 1, items: [], removedBookIds: ['book', 'book'] }]) {
    const f = fixture(); f.legacy([card('legacy')]);
    const raw = JSON.stringify(value); f.data.set(f.storage.storageKey('lexiconArchive'), raw);
    await assert.rejects(f.archive.add(card('new')));
    assert.equal(f.writes(), 0);
    assert.equal(f.data.get(f.storage.storageKey('lexiconArchive')), raw);
  }
});

test('storage acknowledgement is required before save completion and a remounted load waits for it', async () => {
  const f = fixture(), release = f.blockWrite();
  let done = false;
  const saving = f.archive.add(card('new')).then(value => { done = true; return value; });
  const reloading = createLexiconArchive(f.storage).load();
  await new Promise(ok => setImmediate(ok));
  assert.equal(done, false);
  assert.equal(f.data.size, 0);
  release(); await saving;
  assert.equal((await reloading).items[0].id, 'new');
});

test('concurrent instances preserve all cards and apply mastery to the latest durable state', async () => {
  const f = fixture(), other = createLexiconArchive(f.storage);
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? other : f.archive).add(card(`card-${i}`))));
  await Promise.all([f.archive.mastery('card-0', 3), other.mastery('card-1', 5)]);
  const saved = await f.archive.load();
  assert.equal(saved.items.length, 8);
  assert.equal(saved.items.find(item => item.id === 'card-0').masteryLevel, 3);
  assert.equal(saved.items.find(item => item.id === 'card-1').masteryLevel, 5);
  assert.equal(saved.items.find(item => item.id === 'card-0').definition, 'A definition.');
});

test('read/write failures retain previous data and do not poison a later retry', async () => {
  const f = fixture(); f.legacy([card('old')]);
  f.failRead(true); await assert.rejects(f.archive.add(card('new'))); assert.equal(f.writes(), 0);
  f.failRead(false); f.failWrite(); await assert.rejects(f.archive.mastery('old', 5));
  assert.equal((await f.archive.load()).items[0].masteryLevel, 1);
  assert.equal((await f.archive.mastery('old', 5)).items[0].masteryLevel, 5);
  for (const level of [0, 6, 2.5, NaN]) await assert.rejects(f.archive.mastery('old', level));
  await assert.rejects(f.archive.mastery('missing', 3));
});

test('startup union keeps local-only cards and device mastery while adding valid cloud-only cards', async () => {
  const f = fixture(); f.legacy([card('same', { masteryLevel: 5 }), card('offline')]);
  const merged = await f.archive.mergeRemote([card('same', { masteryLevel: 1 }), card('remote'), { id: 'bad' }]);
  assert.equal(merged.skipped, 1);
  assert.deepEqual(merged.items.map(item => item.id), ['same', 'offline', 'remote']);
  assert.equal(merged.items[0].masteryLevel, 5);
  const editing = f.archive.mastery('same', 3);
  const late = f.archive.mergeRemote([card('same', { masteryLevel: 1 })]);
  await editing;
  assert.equal((await late).items[0].masteryLevel, 3);
});

test('a failed cloud-cache write does not replace local cards and can be retried', async () => {
  const f = fixture(); f.legacy([card('local')]); f.failWrite();
  await assert.rejects(f.archive.mergeRemote([card('remote')]));
  assert.deepEqual((await f.archive.load()).items.map(item => item.id), ['local']);
  assert.equal((await f.archive.mergeRemote([card('remote')])).items.length, 2);
});

test('confirmed book removal suppresses stale vocabulary after restart without removing other books or unassigned cards', async () => {
  const f = fixture(); f.legacy([card('a'), card('b', { bookId: 'other' }), card('unassigned', { bookId: '' })]);
  f.failWrite(); await assert.rejects(f.archive.removeBook('book'));
  assert.equal((await f.archive.load()).items.length, 3);
  await f.archive.removeBook('book');
  const restarted = createLexiconArchive(f.storage);
  const merged = await restarted.mergeRemote([card('unknown'), card('new', { bookId: 'other' })]);
  assert.deepEqual(merged.items.map(item => item.id), ['b', 'unassigned', 'new']);
  await assert.rejects(restarted.mastery('a', 5));
  await assert.rejects(restarted.add(card('old-book')));
});

test('accounts, backend scopes and Guest cannot see or remove each other’s vocabulary', async () => {
  const f = fixture();
  const a = f.archive, b = createLexiconArchive(f.store('dev:B')), guest = createLexiconArchive(f.store('dev:Guest')), other = createLexiconArchive(f.store('other:A'));
  await Promise.all([a.add(card('same', { word: 'A' })), b.add(card('same', { word: 'B' })), guest.add(card('same', { word: 'Guest' })), other.add(card('same', { word: 'Other backend' }))]);
  await b.removeBook('book');
  assert.equal((await a.load()).items[0].word, 'A');
  assert.equal((await b.load()).items.length, 0);
  assert.equal((await guest.load()).items[0].word, 'Guest');
  assert.equal((await other.load()).items[0].word, 'Other backend');
});
