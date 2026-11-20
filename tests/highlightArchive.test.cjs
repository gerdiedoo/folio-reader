const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/highlightArchive.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { createHighlightArchive } = loaded.exports;
let nextFixture = 0;
function highlight(id, extra = {}) {
  return { id, bookId: 'book', bookTitle: 'A book', chapter: 'Arrival', page: 1, loc: 100, text: `Quote ${id}`, colorName: 'Amber Crayon', colorHex: '#F8E8A2', dateAdded: 'Added just now', ...extra };
}
function deferred() { let resolve; const promise = new Promise(ok => { resolve = ok; }); return { promise, resolve }; }
function fixture() {
  const prefix = `archive-test-${++nextFixture}:`;
  const data = new Map();
  let writes = 0, failWrite = false, failRead = false, gate;
  const store = scope => ({
    storageKey: key => `${prefix}${scope}.${key}`,
    async loadJSONEntryStrict(key) {
      if (failRead) throw new Error('Read failed');
      const raw = data.get(`${prefix}${scope}.${key}`);
      return raw === undefined ? { present: false, value: null } : { present: true, value: JSON.parse(raw) };
    },
    async saveJSONStrict(key, value) {
      writes++;
      if (gate) await gate.promise;
      if (failWrite) { failWrite = false; throw new Error('Storage full'); }
      data.set(`${prefix}${scope}.${key}`, JSON.stringify(value));
    },
  });
  const storage = store('A');
  return { data, storage, store, archive: createHighlightArchive(storage), writes: () => writes,
    failWrite() { failWrite = true; }, failRead(value) { failRead = value; },
    gate() { gate = deferred(); return gate; },
    legacy(items) { data.set(storage.storageKey('highlights'), JSON.stringify(items)); },
  };
}

test('per-account legacy notes load without rewriting; the new archive keeps the legacy source intact', async () => {
  const f = fixture();
  f.legacy([highlight('old', { note: null, loc: null })]);
  const original = f.data.get(f.storage.storageKey('highlights'));
  assert.equal((await f.archive.load()).items[0].id, 'old');
  assert.equal(f.writes(), 0);
  const saved = await f.archive.add(highlight('new'));
  assert.deepEqual(saved.items.map(item => item.id), ['new', 'old']);
  assert.equal(f.data.get(f.storage.storageKey('highlights')), original);
  assert.equal((await createHighlightArchive(f.storage).load()).items.length, 2);
});

test('unreadable JSON, invalid arrays and duplicate records never become an empty writable archive', async () => {
  for (const raw of ['null', '{', '{}', JSON.stringify([highlight('same'), highlight('same')]), JSON.stringify([highlight('bad', { chapter: null })])]) {
    const f = fixture();
    f.data.set(f.storage.storageKey('highlights'), raw);
    await assert.rejects(f.archive.load());
    await assert.rejects(f.archive.add(highlight('new')));
    assert.equal(f.writes(), 0);
    assert.equal(f.data.get(f.storage.storageKey('highlights')), raw);
    assert.equal(f.data.has(f.storage.storageKey('highlightArchive')), false);
  }
});

test('a newer or inconsistent archive is preserved rather than falling back to the old array', async () => {
  for (const archive of [
    null,
    { version: 2, items: [], removedIds: [], removedBookIds: [] },
    { version: 1, items: [highlight('a')], removedIds: ['a'], removedBookIds: [] },
    { version: 1, items: [], removedIds: ['a', 'a'], removedBookIds: [] },
  ]) {
    const f = fixture(); f.legacy([highlight('legacy')]);
    const raw = JSON.stringify(archive);
    f.data.set(f.storage.storageKey('highlightArchive'), raw);
    await assert.rejects(f.archive.add(highlight('new')));
    assert.equal(f.data.get(f.storage.storageKey('highlightArchive')), raw);
    assert.equal(f.writes(), 0);
  }
});

test('read and write failures keep the previous data and do not poison a later retry', async () => {
  const f = fixture(); f.legacy([highlight('old')]);
  f.failRead(true);
  await assert.rejects(f.archive.add(highlight('new')));
  assert.equal(f.writes(), 0);
  f.failRead(false); f.failWrite();
  await assert.rejects(f.archive.add(highlight('new')));
  assert.deepEqual((await f.archive.load()).items.map(item => item.id), ['old']);
  assert.deepEqual((await f.archive.add(highlight('new'))).items.map(item => item.id), ['new', 'old']);
});

test('a save remains pending until storage acknowledges it; remounted loads wait for that save', async () => {
  const f = fixture(), gate = f.gate();
  let completed = false;
  const saving = f.archive.add(highlight('new')).then(result => { completed = true; return result; });
  const reopening = createHighlightArchive(f.storage).load();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(f.data.size, 0);
  gate.resolve();
  await saving;
  assert.equal((await reopening).items[0].id, 'new');
});

test('concurrent stores serialize updates against durable state without losing notes', async () => {
  const f = fixture(), other = createHighlightArchive(f.storage);
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? other : f.archive).add(highlight(`note-${i}`))));
  assert.equal((await f.archive.load()).items.length, 8);
  await Promise.all([f.archive.note('note-0', 'A reflection'), other.note('note-1', 'Another reflection')]);
  const saved = await f.archive.load();
  assert.equal(saved.items.find(item => item.id === 'note-0').note, 'A reflection');
  assert.equal(saved.items.find(item => item.id === 'note-1').note, 'Another reflection');
});

test('a failed reflection edit keeps its old text and successful edits preserve source metadata', async () => {
  const f = fixture(); f.legacy([highlight('a', { note: 'Original note' })]);
  f.failWrite();
  await assert.rejects(f.archive.note('a', 'Draft'));
  assert.equal((await f.archive.load()).items[0].note, 'Original note');
  const changed = (await f.archive.note('a', 'Draft')).items[0];
  assert.deepEqual(changed, highlight('a', { note: 'Draft' }));
});

test('startup merge preserves local-only notes and local edits, while adding new cloud records', async () => {
  const f = fixture(); f.legacy([highlight('same', { note: 'Offline edit' }), highlight('local-only')]);
  const result = await f.archive.mergeRemote([highlight('same', { note: 'Old cloud note' }), highlight('remote-only'), { id: 'broken' }]);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.items.map(item => item.id), ['same', 'local-only', 'remote-only']);
  assert.equal(result.items[0].note, 'Offline edit');
  assert.equal((await createHighlightArchive(f.storage).load()).items.length, 3);
});

test('a remote merge queued behind an edit reads the latest durable note', async () => {
  const f = fixture(); f.legacy([highlight('same')]);
  const editing = f.archive.note('same', 'Latest edit');
  const merging = f.archive.mergeRemote([highlight('same', { note: 'Stale cloud edit' })]);
  await editing;
  assert.equal((await merging).items[0].note, 'Latest edit');
});

test('failed cloud-cache writes keep local data and can be retried without replacing it', async () => {
  const f = fixture(); f.legacy([highlight('local')]); f.failWrite();
  await assert.rejects(f.archive.mergeRemote([highlight('remote')]));
  assert.deepEqual((await f.archive.load()).items.map(item => item.id), ['local']);
  assert.equal((await f.archive.mergeRemote([highlight('remote')])).items.length, 2);
});

test('durable deletion markers prevent stale cloud resurrection after restart and reject stale edits', async () => {
  const f = fixture(); f.legacy([highlight('deleted'), highlight('kept')]);
  await f.archive.remove('deleted');
  const restarted = createHighlightArchive(f.storage);
  const merged = await restarted.mergeRemote([highlight('deleted'), highlight('new')]);
  assert.deepEqual(merged.items.map(item => item.id), ['kept', 'new']);
  assert.ok(merged.removedIds.includes('deleted'));
  await assert.rejects(restarted.note('deleted', 'Stale edit'));
  await assert.rejects(restarted.add(highlight('deleted')));
});

test('book note removal is acknowledged before publishing and suppresses later unknown cloud notes for that book', async () => {
  const f = fixture(); f.legacy([highlight('a'), highlight('b', { bookId: 'other' })]);
  f.failWrite(); await assert.rejects(f.archive.removeBook('book'));
  assert.equal((await f.archive.load()).items.length, 2);
  await f.archive.removeBook('book');
  const merged = await createHighlightArchive(f.storage).mergeRemote([highlight('unknown'), highlight('new-other', { bookId: 'other' })]);
  assert.deepEqual(merged.items.map(item => item.id), ['b', 'new-other']);
  assert.ok(merged.removedIds.includes('unknown'));
});

test('accounts and Guest cannot see, edit or delete one another’s highlight archives', async () => {
  const f = fixture();
  const a = f.archive, b = createHighlightArchive(f.store('B')), guest = createHighlightArchive(f.store('Guest'));
  await a.add(highlight('same', { note: 'A' }));
  await b.add(highlight('same', { note: 'B' }));
  await guest.add(highlight('same', { note: 'Guest' }));
  await b.remove('same');
  assert.equal((await a.load()).items[0].note, 'A');
  assert.equal((await b.load()).items.length, 0);
  assert.equal((await guest.load()).items[0].note, 'Guest');
});
