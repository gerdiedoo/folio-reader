const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/bookCover.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { saveBookCover, coverImageUrl, normalizeCoverTint, CoverSaveError } = loaded.exports;
const flush = () => new Promise(resolve => setImmediate(resolve));
const original = () => ({ id: 'book', title: 'A book', coverUrl: 'file:///owned/old.jpg', coverStyle: 'image', currentPage: 8, readingPosition: { pageNumber: 8, wordOffset: 31 } });
const photo = { style: 'image', tint: 'sage', image: { kind: 'photo', uri: 'file:///picker/photo.jpg' } };
function fixture() {
  let books = [original(), { id: 'other', title: 'Another book', coverUrl: '' }], gate, failWrite = false;
  const files = new Set(['file:///owned/old.jpg']), uploads = [], removed = [], events = [];
  let serial = 0;
  const storage = {
    getBooks: () => books,
    persistPhoto(uri, id) { events.push('copy'); const created = `file:///owned/custom-${id}-${++serial}.jpg`; files.add(created); return created; },
    removeCustomCover(id, uri) { removed.push(uri); files.delete(uri); return true; },
    async saveBooks(next) { events.push('save'); if (gate) await gate; if (failWrite) throw Error('Storage full'); storage.durable = JSON.parse(JSON.stringify(next)); },
    publish(id, patch) { events.push('publish'); books = books.map(book => book.id === id ? { ...book, ...patch } : book); },
    async upload(book) { uploads.push(book); return false; },
  };
  return { storage, files, uploads, removed, events, books: () => books, change: fn => { books = fn(books); },
    fail: value => { failWrite = value; },
    block: () => { let release; gate = new Promise(resolve => { release = resolve; }); return release; } };
}

test('cover photos and colors publish and upload only after storage acknowledgement', async () => {
  const f = fixture(), release = f.block(); let done = false;
  const pending = saveBookCover('book', photo, f.storage).then(result => { done = true; return result; });
  await flush(); assert.equal(done, false); assert.equal(f.books()[0].coverUrl, original().coverUrl);
  assert.equal(f.uploads.length, 0); assert.ok(f.files.has(original().coverUrl));
  release(); const result = await pending; await flush();
  assert.equal(result.saved, true); assert.match(result.message, /on this device/);
  assert.equal(f.books()[0].coverTint, 'sage'); assert.match(f.books()[0].coverUrl, /custom-book/);
  assert.equal(f.storage.durable[0].coverTint, 'sage'); assert.equal(f.uploads.length, 1);
  assert.deepEqual(f.events, ['copy', 'save', 'publish']);
  assert.deepEqual(f.removed, [original().coverUrl]);
});

test('failed metadata storage retains the old cover and removes only the newly copied draft', async () => {
  const f = fixture(); f.fail(true);
  const result = await saveBookCover('book', photo, f.storage); await flush();
  assert.equal(result.saved, false); assert.match(result.message, /draft is still here/);
  assert.equal(f.books()[0].coverUrl, original().coverUrl); assert.ok(f.files.has(original().coverUrl));
  assert.equal(f.uploads.length, 0); assert.equal(f.files.size, 1); assert.match(f.removed[0], /custom-book/);
  f.fail(false); assert.equal((await saveBookCover('book', photo, f.storage)).saved, true);
});

test('strict photo-copy failures do not write metadata or upload an ephemeral URI', async () => {
  const f = fixture(); f.storage.persistPhoto = () => { throw new CoverSaveError('Photo could not be copied.'); };
  const result = await saveBookCover('book', photo, f.storage);
  assert.equal(result.saved, false); assert.equal(result.message, 'Photo could not be copied.');
  assert.deepEqual(f.events, []); assert.equal(f.uploads.length, 0); assert.ok(f.files.has(original().coverUrl));
});

test('publishing a cover patch preserves reading updates, other metadata and imports completed during the save', async () => {
  const f = fixture(), release = f.block();
  const pending = saveBookCover('book', photo, f.storage); await flush();
  f.change(books => [...books.map(book => book.id === 'book' ? { ...book, currentPage: 10, readingPosition: { pageNumber: 10, wordOffset: 55 }, annotation: 'New metadata' } : book), { id: 'new-import', coverUrl: '' }]);
  release(); await pending; await flush();
  assert.equal(f.books()[0].currentPage, 10); assert.equal(f.books()[0].readingPosition.wordOffset, 55);
  assert.equal(f.books()[0].annotation, 'New metadata'); assert.equal(f.books().length, 3);
  assert.equal(f.uploads[0].currentPage, 10);
});

test('typographic covers keep the previous image and do not copy an unused photo draft', async () => {
  const f = fixture(); const result = await saveBookCover('book', { ...photo, style: 'typographic', tint: 'slate' }, f.storage);
  assert.equal(result.saved, true); assert.equal(f.books()[0].coverStyle, 'typographic'); assert.equal(f.books()[0].coverTint, 'slate');
  assert.equal(f.books()[0].coverUrl, original().coverUrl); assert.equal(f.files.size, 1); assert.equal(f.removed.length, 0);
  assert.deepEqual(f.events, ['save', 'publish']);
});

test('URL validation rejects local paths, invalid protocols, malformed URLs and embedded credentials', async () => {
  assert.equal(coverImageUrl('  HTTPS://example.com/a.png?size=2  '), 'https://example.com/a.png?size=2');
  for (const url of ['', 'not a URL', 'https:example.com', 'file:///private/photo.jpg', 'content://photo', 'data:image/png;base64,abc', 'javascript:alert(1)', 'https://name:password@example.com/cover']) {
    assert.throws(() => coverImageUrl(url), /valid public HTTP or HTTPS/);
    const f = fixture(); const result = await saveBookCover('book', { ...photo, image: { kind: 'url', url } }, f.storage);
    assert.equal(result.saved, false); assert.deepEqual(f.events, []);
  }
});

test('keep-image and URL choices save only supported cover fields and normalize invalid legacy colors', async () => {
  const f = fixture(); await saveBookCover('book', { style: 'image', tint: 'constructor', image: { kind: 'keep' } }, f.storage);
  assert.equal(f.books()[0].coverTint, 'parchment'); assert.equal(f.books()[0].coverUrl, original().coverUrl);
  await saveBookCover('book', { ...photo, image: { kind: 'url', url: 'https://example.com/new.png' } }, f.storage);
  assert.equal(f.books()[0].coverUrl, 'https://example.com/new.png'); assert.equal(f.books()[1].id, 'other');
  for (const value of ['__proto__', null, {}, undefined]) assert.equal(normalizeCoverTint(value), 'parchment');
});

test('cleanup errors distinguish a saved cover from an unconfirmed draft, and cloud delivery never blocks local completion', async () => {
  const f = fixture(); f.storage.removeCustomCover = () => false;
  f.storage.upload = () => new Promise(() => {});
  const result = await saveBookCover('book', photo, f.storage);
  assert.equal(result.saved, true); assert.match(result.message, /previous cover files could not be removed/);
  const failed = fixture(); failed.fail(true); failed.storage.removeCustomCover = () => false;
  const outcome = await saveBookCover('book', photo, failed.storage);
  assert.equal(outcome.saved, false); assert.match(outcome.message, /incomplete cover files/);
});

test('a missing book is never recreated by a stale cover editor', async () => {
  const f = fixture(); f.change(books => books.filter(book => book.id !== 'book'));
  const result = await saveBookCover('book', photo, f.storage);
  assert.equal(result.saved, false); assert.equal(f.books().length, 1); assert.deepEqual(f.events, []);
});

test('a photo copy still in progress cannot publish cover metadata or remove the current cover',async()=>{
 const f=fixture(),copy=f.storage.persistPhoto;let release;
 const copying=new Promise(done=>release=done);f.storage.persistPhoto=async(...args)=>{await copying;return copy(...args);};
 const saving=saveBookCover('book',photo,f.storage);await flush();assert.equal(f.books()[0].coverUrl,original().coverUrl);assert.deepEqual(f.events,[]);assert.equal(f.removed.length,0);
 release();assert.equal((await saving).saved,true);assert.deepEqual(f.events,['copy','save','publish']);
});
