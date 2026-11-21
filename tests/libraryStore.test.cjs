const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/libraryStore.ts');
const loaded = new Module(filename, module);
loaded.require = name => require('./loadTypeScript.cjs').loadTypeScript(path.resolve(path.dirname(filename), name + '.ts'));
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { createLibraryStore, readingFields } = loaded.exports;
const book = (id, extra = {}) => ({ id, title: id, author: 'Author', coverUrl: '', currentPage: 1, totalPages: 10, progressPercent: 0, ...extra });
const flush = () => new Promise(done => setImmediate(done));
let serial = 0;
function fixture() {
  const data = new Map(), scope = `library-${++serial}:`; let fail = false, gate;
  const storage = { storageKey: key => scope + key,
    async loadJSONEntryStrict(key) { const raw = data.get(scope + key); return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) }; },
    async saveJSONStrict(key, value) { if (gate) await gate; if (fail) throw Error('Storage full'); data.set(scope + key, JSON.stringify(value)); } };
  return { store: createLibraryStore(storage), other: () => createLibraryStore(storage), storage, data,
    raw: (key, value) => data.set(scope + key, JSON.stringify(value)), value: key => JSON.parse(data.get(scope + key)),
    fail: value => { fail = value; }, block: () => { let done; gate = new Promise(resolve => { done = resolve; }); return () => { gate = null; done(); }; } };
}

test('library migration preserves legacy data until a confirmed archive write and rejects stored null', async () => {
  const f = fixture(); f.raw('books', [book('a')]);
  assert.equal((await f.store.load()).books[0].id, 'a'); assert.equal(f.data.size, 1);
  await f.store.patch('a', { coverTint: 'sage' }); assert.equal(f.value('books')[0].coverTint, undefined); assert.equal(f.value('libraryArchive').books[0].coverTint, 'sage');
  const bad = fixture(); bad.raw('books', null); await assert.rejects(bad.store.add(book('a'))); assert.equal(bad.data.size, 1);
});

test('queued per-book mutations retain concurrent cover, reading position and imported books across store instances', async () => {
  const f = fixture(); await f.store.add(book('a')); const release = f.block();
  const cover = f.store.patch('a', { coverUrl: 'file:///new.jpg', coverTint: 'sage' }); await flush();
  const progress = f.other().patch('a', { currentPage: 6, readingPosition: { pageNumber: 6, wordOffset: 19 } });
  const importing = f.other().add(book('b')); release(); await Promise.all([cover, progress, importing]);
  const saved = await f.other().load(); assert.equal(saved.books.length, 2);
  const a = saved.books.find(item => item.id === 'a'); assert.equal(a.coverUrl, 'file:///new.jpg'); assert.equal(a.currentPage, 6); assert.equal(a.readingPosition.wordOffset, 19);
});

test('removal and its marker persist together and stale cloud books cannot resurrect after restart', async () => {
  const f = fixture(); await f.store.add(book('a')); await f.store.remove('a');
  const result = await f.other().mergeRemote([book('a'), book('b')]); assert.deepEqual(result.books.map(item => item.id), ['b']); assert.deepEqual(result.removedBookIds, ['a']);
  await assert.rejects(f.other().patch('a', { currentPage: 2 }));
});

test('failed writes retain the confirmed library and do not poison subsequent queued operations', async () => {
  const f = fixture(); await f.store.add(book('a')); f.fail(true);
  await assert.rejects(f.store.patch('a', { currentPage: 4 })); assert.equal((await f.store.load()).books[0].currentPage, 1);
  f.fail(false); await f.store.patch('a', { currentPage: 4 }); assert.equal((await f.other().load()).books[0].currentPage, 4);
});

test('malformed archives, duplicate identifiers and inconsistent deletion markers block mutations', async () => {
  for (const value of [null, { version: 9, books: [], removedBookIds: [] }, { version: 1, books: [book('a'), book('a')], removedBookIds: [] }, { version: 1, books: [book('a')], removedBookIds: ['a'] }]) {
    const f = fixture(); f.raw('libraryArchive', value); await assert.rejects(f.store.add(book('new'))); assert.deepEqual(f.value('libraryArchive'), value);
  }
});

test('device books win cloud hydration, malformed remote records are skipped, and unrelated metadata never enters progress patches', async () => {
  const f = fixture(); await f.store.add(book('a', { currentPage: 4, coverTint: 'sage' }));
  const result = await f.store.mergeRemote([book('a', { currentPage: 1 }), {}, book('b')]); assert.equal(result.skipped, 1); assert.equal(result.books[0].currentPage, 4);
  assert.equal(readingFields(book('a', { coverTint: 'sage', fileLocation: 'file:///book.epub' })).coverTint, undefined);
  assert.equal(Object.hasOwn(readingFields(book('a')), 'fileLocation'), false);
});
