const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/bookmarks.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, filename);
const { createBookmark, createBookmarkStore, findBookmarkPage } = loaded.exports;

function memory(raw = null) {
  const api = {
    reads: 0, writes: 0, failRead: false, failWrite: false,
    get raw() { return raw; },
    async getItem(key) {
      assert.equal(key, 'folio.v1.bookmarks');
      api.reads++;
      if (api.failRead) throw new Error('read failed');
      return raw;
    },
    async setItem(key, value) {
      assert.equal(key, 'folio.v1.bookmarks');
      api.writes++;
      if (api.failWrite) throw new Error('disk full');
      raw = value;
    },
  };
  return api;
}
function page(number = 1) {
  return { pageNumber: number, locNumber: number * 120, chapterTitle: 'Chapter One',
    dropCap: 'H', paragraph1: 'ello.', paragraph2Lead: '', highlightedText: 'Next passage.', paragraph2Rest: '' };
}
const bookmark = (book = 'book-a', number = 1) => createBookmark(book, page(number));

test('starts empty instead of assuming an existing bookmark', async () => {
  assert.deepEqual(await createBookmarkStore(memory()).load(), []);
});

test('survives a new store instance with book identity, location and preview intact', async () => {
  const storage = memory();
  const saved = bookmark();
  await createBookmarkStore(storage).toggle(saved);
  const restored = await createBookmarkStore(storage).load();
  assert.deepEqual(restored, [saved]);
  assert.equal(restored[0].excerpt, 'Hello. Next passage.');
});

test('the same passage number in different books is independent', async () => {
  const store = createBookmarkStore(memory());
  const a = bookmark(), b = bookmark('book-b');
  await store.toggle(a);
  assert.deepEqual(await store.toggle(b), [a, b]);
  assert.deepEqual(await store.toggle(a), [b]);
});

test('multiple locations in one book persist and toggling removes only that location', async () => {
  const storage = memory(), store = createBookmarkStore(storage);
  const first = bookmark(), later = bookmark('book-a', 7);
  await store.toggle(first);
  await store.toggle(later);
  await store.toggle(first);
  assert.deepEqual(await createBookmarkStore(storage).load(), [later]);
});

test('concurrent operations serialize without losing bookmarks', async () => {
  const storage = memory(), store = createBookmarkStore(storage);
  const a = bookmark(), b = bookmark('book-b');
  await Promise.all([store.toggle(a), store.toggle(b)]);
  assert.deepEqual(await createBookmarkStore(storage).load(), [a, b]);
  assert.equal(storage.reads, 2); // one for each store instance
});

test('two concurrent toggles of one passage do not create duplicates', async () => {
  const storage = memory(), store = createBookmarkStore(storage), item = bookmark();
  await Promise.all([store.toggle(item), store.toggle(item)]);
  assert.deepEqual(await createBookmarkStore(storage).load(), []);
});

test('storage failure rejects the save, preserves the old snapshot, and allows retry', async () => {
  const storage = memory(), store = createBookmarkStore(storage);
  const existing = bookmark(), candidate = bookmark('book-b');
  await store.toggle(existing);
  const original = storage.raw;
  storage.failWrite = true;
  await assert.rejects(store.toggle(candidate), /disk full/);
  assert.equal(storage.raw, original);
  assert.deepEqual(await store.load(), [existing]);
  storage.failWrite = false;
  assert.deepEqual(await store.toggle(candidate), [existing, candidate]);
});

test('a failed removal leaves the bookmark available after restart', async () => {
  const storage = memory(), store = createBookmarkStore(storage), saved = bookmark();
  await store.toggle(saved);
  storage.failWrite = true;
  await assert.rejects(store.remove(saved.id), /disk full/);
  assert.deepEqual(await createBookmarkStore(storage).load(), [saved]);
});

test('a failed read does not overwrite saved data and can be retried', async () => {
  const existing = bookmark(), storage = memory(JSON.stringify([existing]));
  const original = storage.raw, store = createBookmarkStore(storage);
  storage.failRead = true;
  await assert.rejects(store.toggle(bookmark('book-b')), /read failed/);
  assert.equal(storage.writes, 0);
  assert.equal(storage.raw, original);
  storage.failRead = false;
  assert.deepEqual(await store.load(), [existing]);
});

for (const [name, raw] of [
  ['invalid JSON', '{'], ['non-array', '{}'], ['invalid record', '[{}]'],
  ['invalid location', JSON.stringify([{ ...bookmark(), pageNumber: 0 }])],
  ['duplicate identity', JSON.stringify([bookmark(), bookmark()])],
]) {
  test(`does not replace ${name} storage with an empty collection`, async () => {
    const storage = memory(raw), store = createBookmarkStore(storage);
    await assert.rejects(store.toggle(bookmark('book-b')));
    assert.equal(storage.raw, raw);
    assert.equal(storage.writes, 0);
  });
}

test('deleting a book removes only its bookmarks, including persisted records', async () => {
  const storage = memory(), store = createBookmarkStore(storage);
  const a = bookmark(), later = bookmark('book-a', 2), other = bookmark('book-b');
  await store.toggle(a); await store.toggle(later); await store.toggle(other);
  await store.removeBook('book-a');
  assert.deepEqual(await createBookmarkStore(storage).load(), [other]);
});

test('font and display pagination changes do not change a saved source passage', () => {
  const saved = bookmark('book-a', 4), pages = [page(1), page(4), page(7)];
  assert.equal(findBookmarkPage(saved, pages), 1);
  assert.equal(findBookmarkPage(saved, pages.map(p => ({ ...p, displayFontSize: 32 }))), 1);
  assert.equal(findBookmarkPage(saved, [page(1)]), -1);
  assert.equal(findBookmarkPage(saved, [{ ...page(4), locNumber: 999 }]), -1);
});
