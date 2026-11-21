const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const JSZip = require('jszip');
const modules = new Map();
function load(name) {
  const file = path.resolve(__dirname, '../src/lib', name + '.ts');
  if (modules.has(file)) return modules.get(file).exports;
  const m = new Module(file, module); modules.set(file, m); m.filename = file; m.paths = module.paths;
  const original = m.require.bind(m); m.require = id => id.startsWith('.') ? load(path.relative(path.resolve(__dirname, '../src/lib'), path.resolve(path.dirname(file), id))) : original(id);
  m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
  return m.exports;
}
const { buildPortableBackup, inspectPortableBackup } = load('portableBackup');
const { restorePortableBackup, recoverPortableRestore, hasPendingRestore, readBackupSnapshot } = load('backupRecovery');
const { createLibraryStore } = load('libraryStore');
const { DEFAULT_READER_SETTINGS } = load('readerPreferences');
const book = (id = 'a') => ({ id, title: 'A book', author: 'An author', coverUrl: 'file:///private/cover.jpg', currentPage: 1, totalPages: 1, progressPercent: 20, minutesLeft: 2,
  currentChapter: 'Chapter 1', lastOpened: '2026-11-21', coverAlt: 'Book cover', fileLocation: 'file:///private/book.epub',
  readingPosition: { pageNumber: 1, wordOffset: 4, scroll: { offset: 20, layout: 'device-screen' } } });
const page = { chapterTitle: 'One', chapterNumber: '1', folioNumber: '1', dropCap: 'A', paragraph1: ' story.', paragraph2Lead: '', highlightedText: '', paragraph2Rest: '', pageNumber: 1, totalBookPages: 1, locNumber: 100, totalLoc: 220, minutesLeftInChapter: 2 };
const note = { id: 'note', bookId: 'a', bookTitle: 'A book', chapter: 'One', page: 1, text: 'A story.', colorName: 'Amber Crayon', colorHex: '#F8E8A2', dateAdded: '2026-11-21', note: 'My reflection' };
const word = { id: 'word', bookId: 'a', word: 'story', definition: 'A narrative', phonetic: '', partOfSpeech: 'noun', contextPassage: 'A story.', chapter: 'One', masteryLevel: 3 };
const bookmark = { id: 'a:1', bookId: 'a', pageNumber: 1, locNumber: 100, chapterTitle: 'One', excerpt: 'A story.', createdAt: '2026-11-21T00:00:00Z' };
const snapshot = () => ({ books: [book()], highlights: [note], lexicon: [word], bookmarks: [bookmark], settings: { ...DEFAULT_READER_SETTINGS, theme: 'charcoal' }, goal: { minutesReadToday: 5, dailyTargetMinutes: 20, streakDays: 2, booksFinishedYear: 3, yearTargetBooks: 12 } });
const bytes = value => new Uint8Array(Buffer.from(JSON.stringify(value)));
const original = Uint8Array.from([80, 75, 3, 4, 5]);
const artwork = Uint8Array.from([255, 216, 255, 224]);
const assets = { readPages: async () => bytes([page]), readOriginal: async () => original, readCover: async () => ({ bytes: artwork, extension: 'jpg' }) };
let serial = 0;
function store() {
  const data = new Map(); const scope = `backup-${++serial}:`; let failKey, failCount = 0;
  const storage = { storageKey: key => scope + key, async loadJSONEntryStrict(key) { return data.has(key) ? { present: true, value: JSON.parse(data.get(key)) } : { present: false, value: null }; },
    async saveJSONStrict(key, value) { if (key === failKey && failCount-- > 0) throw Error('Simulated interruption'); data.set(key, JSON.stringify(value)); } };
  return { storage, data, set: (key, value) => data.set(key, JSON.stringify(value)), get: key => JSON.parse(data.get(key)), fail: (key, count = 1) => { failKey = key; failCount = count; } };
}
function fileStore() {
  const files = new Map(); const deleted = []; let failKind;
  return { files, deleted, fail: kind => { failKind = kind; }, write(id, kind, value, extension) { if (kind === failKind) throw Error('Disk full'); const uri = `file:///account/${id}.${extension || kind}`; files.set(uri, value); return uri; },
    remove(id) { deleted.push(id); for (const key of files.keys()) if (key.includes('/' + id + '.')) files.delete(key); return true; } };
}
async function prepared() { return inspectPortableBackup(await buildPortableBackup(snapshot(), assets, true)); }

test('portable copy round-trips every saved-work category and available book assets without device paths', async () => {
  const zip = await buildPortableBackup(snapshot(), assets, true), copy = await inspectPortableBackup(zip);
  assert.deepEqual(copy.summary, { books: 1, originals: 1, readable: 1, highlights: 1, vocabulary: 1, bookmarks: 1 });
  assert.equal(copy.manifest.highlights[0].note, 'My reflection'); assert.equal(copy.manifest.lexicon[0].masteryLevel, 3);
  assert.equal(copy.manifest.settings.theme, 'charcoal');
  assert.equal(copy.manifest.books[0].book.fileLocation, undefined); assert.equal(copy.manifest.books[0].book.coverUrl, '');
  assert.deepEqual(copy.manifest.books[0].book.readingPosition, { pageNumber: 1, wordOffset: 4 });
  assert.deepEqual(copy.files.get('books/0.epub'), original); assert.deepEqual(copy.files.get('covers/0.jpg'), artwork);
});

test('excluding originals never reads them; missing assets are honestly counted and notes-only copies work', async () => {
  const copy = await inspectPortableBackup(await buildPortableBackup(snapshot(), { ...assets, readOriginal: async () => { throw Error('Must not read'); }, readPages: async () => null, readCover: async () => null }, false));
  assert.equal(copy.summary.originals, 0); assert.equal(copy.summary.readable, 0); assert.equal(copy.summary.highlights, 1);
  const notesOnly = snapshot(); notesOnly.books = [];
  assert.equal((await inspectPortableBackup(await buildPortableBackup(notesOnly, assets, false))).summary.books, 0);
});

test('restore adds independent linked copies and retains existing records, deletion markers, and preferences', async () => {
  const f = store(), files = fileStore(); await createLibraryStore(f.storage).add(book('existing'));
  f.set('highlightArchive', { version: 1, items: [{ ...note, id: 'existing-note', bookId: 'existing' }], removedIds: ['removed-note'], removedBookIds: ['removed-book'] });
  f.set('settingsArchive', { version: 1, settings: DEFAULT_READER_SETTINGS });
  await restorePortableBackup(f.storage, await prepared(), files, false, 'test-restore');
  const saved = await readBackupSnapshot(f.storage), imported = saved.books[0];
  assert.equal(saved.books.length, 2); assert.equal(saved.books[1].id, 'existing'); assert.equal(imported.id, 'restore-test-restore-0');
  assert.equal(imported.isDownloaded, true); assert.match(imported.fileLocation, /restore-test-restore-0/); assert.match(imported.coverUrl, /\.jpg$/);
  assert.equal(saved.highlights[0].bookId, imported.id); assert.equal(saved.lexicon[0].bookId, imported.id); assert.equal(saved.bookmarks[0].id, `${imported.id}:1`);
  assert.equal(saved.highlights.length, 2); assert.deepEqual(f.get('highlightArchive').removedIds, ['removed-note']); assert.equal(saved.settings.theme, 'parchment');
  assert.equal(await hasPendingRestore(f.storage), false);
});

for (const key of ['libraryArchive', 'highlightArchive', 'lexiconArchive', 'bookmarks', 'settingsArchive', 'goal', 'restoreJournal']) {
  test(`an interrupted restore at ${key} can recover without duplicate or missing saved work`, async () => {
    const f = store(), files = fileStore(); await createLibraryStore(f.storage).add(book('existing'));
    // restoreJournal is interrupted on clearing, after its initial write succeeds.
    if (key === 'restoreJournal') {
      const write = f.storage.saveJSONStrict;
      f.storage.saveJSONStrict = async (name, value) => { if (name === key && value === null) { f.storage.saveJSONStrict = write; throw Error('Interrupted clear'); } return write(name, value); };
    } else f.fail(key);
    await assert.rejects(restorePortableBackup(f.storage, await prepared(), files, true, 'interrupted'));
    assert.equal(await hasPendingRestore(f.storage), true); assert.equal(files.files.size, 3);
    await recoverPortableRestore(f.storage); await recoverPortableRestore(f.storage);
    const saved = await readBackupSnapshot(f.storage); assert.equal(saved.books.length, 2); assert.equal(saved.highlights.length, 1); assert.equal(saved.settings.theme, 'charcoal');
    assert.equal(saved.bookmarks[0].bookId, saved.books[0].id); assert.equal(await hasPendingRestore(f.storage), false);
  });
}

test('failed staging or journal creation never changes the existing library', async () => {
  const f = store(), files = fileStore(); await createLibraryStore(f.storage).add(book('existing')); files.fail('epub');
  await assert.rejects(restorePortableBackup(f.storage, await prepared(), files, false, 'stage-failure'));
  assert.equal(files.files.size, 0); assert.equal((await readBackupSnapshot(f.storage)).books[0].id, 'existing'); assert.equal(await hasPendingRestore(f.storage), false);
  files.fail(null); f.fail('restoreJournal');
  await assert.rejects(restorePortableBackup(f.storage, await prepared(), files, false, 'journal-failure'));
  assert.equal((await readBackupSnapshot(f.storage)).books.length, 1); assert.equal(files.files.size, 3); // unknown acknowledgement: keep recoverable files.
});

test('corrupt existing stores and unrecognized recovery journals cannot be overwritten by restore', async () => {
  const f = store(); f.set('highlightArchive', null);
  await assert.rejects(restorePortableBackup(f.storage, await prepared(), fileStore())); assert.equal(f.get('highlightArchive'), null);
  f.set('restoreJournal', { version: 1, kind: 'portable-restore', values: { arbitraryKey: 'bad' } });
  await assert.rejects(recoverPortableRestore(f.storage)); assert.equal(f.data.has('arbitraryKey'), false);
});

for (const [name, mutate] of [
  ['unknown version', manifest => { manifest.version = 99; }],
  ['duplicate book IDs', manifest => { manifest.books.push(manifest.books[0]); }],
  ['foreign asset path', manifest => { manifest.books[0].epub = '../../private.epub'; }],
  ['invalid note', manifest => { manifest.highlights[0].page = -1; }],
  ['invalid reading position', manifest => { manifest.books[0].book.readingPosition.wordOffset = -1; }],
  ['invalid bookmarks', manifest => { manifest.bookmarks[0].id = 'wrong'; }],
]) {
  test(`rejects ${name} before any restore writes`, async () => {
    const zip = await JSZip.loadAsync(await buildPortableBackup(snapshot(), assets, true));
    const manifest = JSON.parse(await zip.file('folio.json').async('string')); mutate(manifest); zip.file('folio.json', JSON.stringify(manifest));
    await assert.rejects(inspectPortableBackup(await zip.generateAsync({ type: 'uint8array' })), /No saved work was changed/);
  });
}

test('rejects unlisted entries, corrupt page JSON, CRC damage and dishonest ZIP expansion sizes', async () => {
  const originalZip = await buildPortableBackup(snapshot(), assets, true);
  for (const change of [zip => zip.file('../other', 'bad'), zip => zip.file('pages/0.json', JSON.stringify([{ ...page, pageNumber: -1 }]))]) {
    const zip = await JSZip.loadAsync(originalZip); change(zip); await assert.rejects(inspectPortableBackup(await zip.generateAsync({ type: 'uint8array', createFolders: false })));
  }
  const damaged = originalZip.slice(); damaged[40] ^= 255; await assert.rejects(inspectPortableBackup(damaged));
  const zip = await JSZip.loadAsync(originalZip); zip.file('books/0.epub', 'x'.repeat(100000));
  const bomb = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const directory = Buffer.from(bomb).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); const view = new DataView(bomb.buffer, bomb.byteOffset, bomb.byteLength);
  let at = directory;
  while (view.getUint32(at, true) === 0x02014b50) {
    const length = view.getUint16(at + 28, true), name = Buffer.from(bomb.subarray(at + 46, at + 46 + length)).toString();
    if (name === 'books/0.epub') { view.setUint32(at + 24, 1, true); break; }
    at += 46 + length + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  await assert.rejects(inspectPortableBackup(bomb));
});

const { removeBookWithRecovery } = load('backupRecovery');
const { retryRecordedDeletions } = load('deletionRetries');
async function removalFixture() {
  const f = store(); await createLibraryStore(f.storage).add(book()); await createLibraryStore(f.storage).add(book('other'));
  f.set('highlightArchive', { version: 1, items: [note, { ...note, id: 'other-note', bookId: 'other' }], removedIds: [], removedBookIds: [] });
  f.set('lexiconArchive', { version: 1, items: [word], removedBookIds: [] }); f.set('bookmarks', [bookmark]);
  return f;
}
for (const key of ['libraryArchive', 'highlightArchive', 'lexiconArchive', 'bookmarks', 'settingsArchive', 'goal']) {
  test(`book-removal journal resumes after interruption at ${key}, preserving other books and saved work`, async () => {
    const f = await removalFixture(); f.fail(key);
    await assert.rejects(removeBookWithRecovery(f.storage, 'a'));
    assert.equal(await hasPendingRestore(f.storage), true);
    await recoverPortableRestore(f.storage);
    const saved = await readBackupSnapshot(f.storage);
    assert.deepEqual(saved.books.map(b => b.id), ['other']); assert.deepEqual(saved.highlights.map(n => n.id), ['other-note']);
    assert.equal(saved.lexicon.length, 0); assert.equal(saved.bookmarks.length, 0);
    const library = await createLibraryStore(f.storage).load(); assert.deepEqual(library.removedBookIds, ['a']); assert.equal(library.pendingFileRemovals[0].id, 'a');
  });
}

test('book removal does nothing before its journal acknowledgement and file-cleanup failures remain queued', async () => {
  const f = await removalFixture(); f.fail('restoreJournal'); await assert.rejects(removeBookWithRecovery(f.storage, 'a'));
  const saved = await readBackupSnapshot(f.storage); assert.equal(saved.books.length, 2); assert.equal(saved.highlights.length, 2); assert.equal(saved.bookmarks.length, 1);
  await removeBookWithRecovery(f.storage, 'a');
  const library = createLibraryStore(f.storage);
  assert.equal((await library.cleanupFiles(() => false)).pendingFileRemovals.length, 1);
  let calls = 0;
  f.fail('libraryArchive'); await assert.rejects(library.cleanupFiles(() => { calls++; return true; }));
  assert.equal((await library.load()).pendingFileRemovals.length, 1);
  assert.equal((await library.cleanupFiles(() => { calls++; return true; })).pendingFileRemovals.length, 0); assert.equal(calls, 2);
});

test('account cleanup retries offline removals after restart and acknowledges each success durably', async () => {
  const f = await removalFixture(); await removeBookWithRecovery(f.storage, 'a');
  const events = []; let online = false;
  const cloud = { async deleteBookFromSupabase(id) { events.push(['book', id]); return online; }, async deleteHighlightFromSupabase(id) { events.push(['note', id]); return online; } };
  assert.deepEqual(await retryRecordedDeletions(f.storage, cloud), { pending: 2, failed: 2 });
  assert.equal(f.data.has('deletionReceipts'), false); online = true;
  assert.deepEqual(await retryRecordedDeletions(f.storage, cloud, () => false, 1), { pending: 1, failed: 0 });
  assert.deepEqual(await retryRecordedDeletions(f.storage, cloud), { pending: 0, failed: 0 });
  const count = events.length; await retryRecordedDeletions(f.storage, cloud); assert.equal(events.length, count);
  assert.deepEqual((await createLibraryStore(f.storage).load()).removedBookIds, ['a']);
});

test('failed receipt storage retries an idempotent server deletion; cancellation cannot acknowledge another account’s work', async () => {
  const f = await removalFixture(); await removeBookWithRecovery(f.storage, 'a'); f.fail('deletionReceipts');
  let calls = 0, cancelled = false;
  const cloud = { async deleteBookFromSupabase() { calls++; return true; }, async deleteHighlightFromSupabase() { return true; } };
  await assert.rejects(retryRecordedDeletions(f.storage, cloud)); assert.equal(f.data.has('deletionReceipts'), false);
  await retryRecordedDeletions(f.storage, cloud); assert.equal(calls, 2);
  const other = await removalFixture(); await removeBookWithRecovery(other.storage, 'a');
  await retryRecordedDeletions(other.storage, { ...cloud, async deleteBookFromSupabase() { cancelled = true; return true; } }, () => cancelled);
  assert.equal(other.data.has('deletionReceipts'), false); assert.equal(f.get('deletionReceipts').books[0], 'a');
});

const { beginOriginalImport, recoverOriginalImport, hasPendingOriginalImport } = load('importRecovery');
const { createImportCommitter, waitForImportCommits } = load('bookImport');
function journaledImport(f, extra = {}) {
  const events = [];
  return { events, commit: createImportCommitter({ commitKey: f.storage.storageKey('importJournal'), savePages: () => events.push('pages'), removeFiles: () => { events.push('cleanup'); return true; },
    beginImport: value => beginOriginalImport(f.storage, value), clearImport: () => f.storage.saveJSONStrict('importJournal', null), saveLibraryEntry: value => createLibraryStore(f.storage).add(value), ...extra }) };
}

test('original import keeps staged files after an uncertain journal acknowledgement, then recovers idempotently', async () => {
  const f = store(), write = f.storage.saveJSONStrict;
  f.storage.saveJSONStrict = async (key, value) => { await write(key, value); if (key === 'importJournal' && value !== null) throw Error('Lost acknowledgement'); };
  const importer = journaledImport(f);
  await assert.rejects(importer.commit(book(), [page]), /files have been kept/); assert.deepEqual(importer.events, ['pages']);
  assert.equal(await hasPendingOriginalImport(f.storage), true); assert.equal((await createLibraryStore(f.storage).load()).books.length, 0);
  f.storage.saveJSONStrict = write;
  await recoverOriginalImport(f.storage, async () => true); await recoverOriginalImport(f.storage, async () => { throw Error('Should not verify a completed import'); });
  assert.equal((await createLibraryStore(f.storage).load()).books.length, 1); assert.equal(await hasPendingOriginalImport(f.storage), false);
});

test('original import resumes a failed library write and does not report failure after only intent clearing fails', async () => {
  const f = store(); f.fail('libraryArchive'); const importer = journaledImport(f);
  await assert.rejects(importer.commit(book(), [page]), /finish recovery/); assert.deepEqual(importer.events, ['pages']);
  await recoverOriginalImport(f.storage, async () => true); assert.equal((await createLibraryStore(f.storage).load()).books[0].id, 'a');
  const other = store(), write = other.storage.saveJSONStrict;
  other.storage.saveJSONStrict = async (key, value) => { if (key === 'importJournal' && value === null) throw Error('Failed clear'); return write(key, value); };
  await journaledImport(other).commit(book(), [page]); assert.equal((await createLibraryStore(other.storage).load()).books.length, 1); assert.equal(await hasPendingOriginalImport(other.storage), true);
  other.storage.saveJSONStrict = write;
  await recoverOriginalImport(other.storage, async () => false); assert.equal(await hasPendingOriginalImport(other.storage), false);
});

test('import recovery rejects damaged or conflicting intents, verifies missing files and respects prior removal', async () => {
  const f = store(); await beginOriginalImport(f.storage, book());
  await assert.rejects(recoverOriginalImport(f.storage, async () => false), /unavailable/); assert.equal((await createLibraryStore(f.storage).load()).books.length, 0);
  await createLibraryStore(f.storage).add({ ...book(), title: 'Another book' }); await assert.rejects(recoverOriginalImport(f.storage, async () => true), /conflicts/);
  assert.equal((await createLibraryStore(f.storage).load()).books[0].title, 'Another book');
  await createLibraryStore(f.storage).remove('a'); await recoverOriginalImport(f.storage, async () => { throw Error('Removed records must not be recovered'); });
  assert.equal(await hasPendingOriginalImport(f.storage), false); assert.equal((await createLibraryStore(f.storage).load()).books.length, 0);
  f.set('importJournal', { version: 99, book: book() }); await assert.rejects(recoverOriginalImport(f.storage, async () => true)); assert.equal(f.get('importJournal').version, 99);
});

test('portable jobs can wait for prior import commits, and pre-intent readiness failures roll back only the new files', async () => {
  const f = store(); let release; const gate = new Promise(done => { release = done; });
  const importer = journaledImport(f, { saveLibraryEntry: async value => { await gate; await createLibraryStore(f.storage).add(value); } });
  const pending = importer.commit(book(), [page]); await new Promise(done => setImmediate(done));
  let drained = false; const waiting = waitForImportCommits(f.storage.storageKey('importJournal')).then(() => { drained = true; });
  await new Promise(done => setImmediate(done)); assert.equal(drained, false); release(); await pending; await waiting; assert.equal(drained, true);
  const blocked = journaledImport(f, { assertReady: async () => { throw Error('Space changed'); } });
  await assert.rejects(blocked.commit(book('new'), [page])); assert.deepEqual(blocked.events, ['cleanup']); assert.equal((await createLibraryStore(f.storage).load()).books[0].id, 'a');
});

test('matching-edition recovery reattaches missing files and retains current progress and notes without duplicate books',async()=>{
 const f=store(),files=fileStore(), fingerprint='a'.repeat(64), initial=snapshot();initial.books[0].documentFingerprint=fingerprint;
 const copy=await inspectPortableBackup(await buildPortableBackup(initial,assets,true));
 await createLibraryStore(f.storage).add({...book(),documentFingerprint:fingerprint,fileLocation:undefined,coverUrl:'',currentPage:8,progressPercent:80});
 f.set('highlightArchive',{version:1,items:[{...note,note:'Newer reflection'}],removedIds:[],removedBookIds:[]});
 await restorePortableBackup(f.storage,copy,files,false,'matching',true);
 await restorePortableBackup(f.storage,copy,files,false,'matching-again',true);
 const saved=await readBackupSnapshot(f.storage);assert.equal(saved.books.length,1);assert.equal(saved.books[0].id,'a');assert.equal(saved.books[0].currentPage,8);assert.match(saved.books[0].fileLocation,/\/a\./);
 assert.equal(saved.highlights.length,1);assert.equal(saved.highlights[0].note,'Newer reflection');assert.equal(saved.lexicon.length,1);assert.equal(saved.bookmarks.length,1);
});
test('matching recovery preserves original identities on a new device and never revives removed books or notes',async()=>{
 const f=store(),files=fileStore(), initial=snapshot();initial.books[0].documentFingerprint='a'.repeat(64);
 const copy=await inspectPortableBackup(await buildPortableBackup(initial,assets,true));
 await restorePortableBackup(f.storage,copy,files,false,'new-device',true);
 assert.equal((await readBackupSnapshot(f.storage)).books[0].id,'a');assert.equal((await readBackupSnapshot(f.storage)).highlights[0].id,'note');
 const blocked=store();blocked.set('libraryArchive',{version:1,books:[],removedBookIds:['a'],pendingFileRemovals:[]});
 await restorePortableBackup(blocked.storage,copy,fileStore(),false,'removed',true);const saved=await readBackupSnapshot(blocked.storage);assert.equal(saved.books.length,0);assert.equal(saved.highlights.length,0);
});
