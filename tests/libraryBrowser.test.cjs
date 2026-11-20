const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/libraryBrowser.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { browseLibrary, continueReadingBook, hasReadingHistory, libraryBookStatus, displayedBookProgress } = loaded.exports;
const book = (id, patch = {}) => ({ id, title: id, author: 'An Author', currentPage: 1, progressPercent: 0, lastOpened: 'Not yet read', ...patch });
const ids = rows => rows.map(row => row.id);
const browse = (books, options = {}) => browseLibrary(books, options.recovery ?? [], options.query ?? '', options.filter ?? 'all', options.sort ?? 'recent', new Set(options.available ?? []));

test('Recent uses reading timestamps, keeps unknown dates stable and never mutates the library', () => {
  const books = [book('old', { lastOpened: '2026-01-01T00:00:00Z' }), book('unknown', { lastOpened: 'Yesterday' }), book('new', { lastOpened: '2026-11-20T10:00:00Z' }), book('unread')];
  const snapshot = JSON.stringify(books);
  assert.deepEqual(ids(browse(books).books), ['new', 'old', 'unknown', 'unread']);
  assert.equal(JSON.stringify(books), snapshot);
});

test('Continue Reading chooses the most recent unfinished book with actual device text and reading history', () => {
  const books = [book('legacy-one', { progressPercent: 1 }), book('older', { lastOpened: '2026-01-01' }), book('cloud', { lastOpened: '2026-11-20' }), book('finished', { lastOpened: '2026-11-20', isFinished: true }), book('latest', { lastOpened: '2026-11-19', progressPercent: 0 })];
  assert.equal(continueReadingBook(books, new Set(['legacy-one', 'older', 'finished', 'latest'])).id, 'latest');
  assert.equal(continueReadingBook(books, new Set(['legacy-one', 'finished'])), undefined);
  assert.equal(continueReadingBook([book('legacy', { currentPage: 3 }), book('other', { progressPercent: 25 })], new Set(['legacy', 'other'])).id, 'legacy');
});

test('search matches literal title and author terms across accents, case and whitespace', () => {
  const books = [book('a', { title: 'Café [One]', author: 'Zoë Straße' }), book('b', { title: 'Cafe Two', author: 'Someone Else' })];
  assert.deepEqual(ids(browse(books, { query: '  CAFE \t zoe  STRASSE ' }).books), ['a']);
  assert.deepEqual(ids(browse(books, { query: '[one]' }).books), ['a']);
  assert.equal(browse(books, { query: '.*' }).books.length, 0);
  assert.equal(browse(books, { query: 'cafe absent' }).books.length, 0);
  assert.equal(browse(books, { query: '   ' }).books.length, 2);
  assert.deepEqual(ids(browse(books, { query: 'cafe' + ' '.repeat(196) + 'absent' }).books), ['a', 'b']);
});

test('Reading excludes untouched imports and historical artificial one-percent progress', () => {
  const books = [book('unread'), book('one', { progressPercent: 1 }), book('position', { readingPosition: { pageNumber: 1 } }), book('pages', { currentPage: 2 }), book('progress', { progressPercent: 10 }), book('opened', { lastOpened: '2026-11-20' }), book('finished', { isFinished: true, currentPage: 10 })];
  assert.deepEqual(ids(browse(books, { filter: 'reading', sort: 'title' }).books), ['opened', 'pages', 'position', 'progress']);
  assert.equal(hasReadingHistory(books[1]), false);
  assert.equal(displayedBookProgress(books[1]), 0);
  assert.equal(libraryBookStatus(books[1]), 'Not started');
  assert.equal(libraryBookStatus(book('want', { isWantToRead: true })), 'Want to read');
  assert.equal(libraryBookStatus(books[6]), 'Finished');
});

test('Downloaded uses loaded device text rather than a copied cloud metadata flag', () => {
  const books = [book('cloud', { isDownloaded: true }), book('local', { isDownloaded: false }), book('finished', { isFinished: true }), book('want', { isWantToRead: true })];
  assert.deepEqual(ids(browse(books, { filter: 'downloaded', available: ['local'] }).books), ['local']);
  assert.deepEqual(ids(browse(books, { filter: 'finished' }).books), ['finished']);
  assert.deepEqual(ids(browse(books, { filter: 'want' }).books), ['want']);
  assert.equal(browse(books, { filter: 'downloaded', available: ['local'], query: 'cloud' }).books.length, 0);
});

test('Title and Progress sort readable metadata without inventing progress for unread books', () => {
  const books = [book('z', { title: 'Zulu', progressPercent: 1 }), book('a', { title: 'Ámber', progressPercent: 36 }), book('f', { title: 'Fern', isFinished: true }), book('bad', { title: 'Brook', progressPercent: NaN })];
  assert.deepEqual(ids(browse(books, { sort: 'title' }).books), ['a', 'bad', 'f', 'z']);
  assert.deepEqual(ids(browse(books, { sort: 'progress' }).books), ['f', 'a', 'z', 'bad']);
  assert.equal(displayedBookProgress(book('overflow', { progressPercent: 150 })), 100);
  assert.equal(displayedBookProgress(book('negative', { progressPercent: -20, currentPage: 2 })), 0);
});

test('recovery entries participate in title/author search only under All Books and remain separate from readable books', () => {
  const recovery = [book('missing-z', { title: 'Zulu', author: 'Zoë' }), book('missing-a', { title: 'Amber', author: 'Zoë' })];
  const snapshot = JSON.stringify(recovery);
  assert.deepEqual(ids(browse([], { recovery, query: 'zoe', sort: 'title' }).recovery), ['missing-a', 'missing-z']);
  assert.equal(browse([], { recovery, query: 'absent' }).recovery.length, 0);
  for (const filter of ['reading', 'finished', 'downloaded', 'want']) assert.equal(browse([], { recovery, filter, available: ids(recovery) }).recovery.length, 0);
  assert.equal(JSON.stringify(recovery), snapshot);
});
