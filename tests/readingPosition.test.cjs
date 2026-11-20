const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/readingPosition.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { savedReadingPosition, scrollPositionAtOffset, applyReadingPosition, mergeCloudBookForDevice, createReadingProgressWriter } = loaded.exports;
const page = n => ({ pageNumber: n, chapterNumber: '3', locNumber: n * 100 });
const pages = [page(1), page(2), page(3)];
const book = extra => ({ id: 'book', title: 'Read me', currentPage: 2, totalPages: 3, currentLoc: 200, ...extra });
const flush = () => new Promise(ok => setImmediate(ok));

test('resume accepts matching device offsets and falls back safely for legacy and invalid saved values', () => {
  const position = { pageNumber: 2, scroll: { offset: 321.5, layout: 'layout' } };
  assert.deepEqual(savedReadingPosition(book({ readingPosition: position }), pages), { index: 1, position });
  assert.deepEqual(savedReadingPosition(book(), pages), { index: 1, position: { pageNumber: 2 } });
  for (const readingPosition of [null, { pageNumber: 3, scroll: position.scroll },
    { pageNumber: 2, scroll: { offset: -1, layout: 'x' } },
    { pageNumber: 2, scroll: { offset: '123', layout: 'x' } },
    { pageNumber: 2, scroll: { offset: 123, layout: {} } }]) {
    assert.deepEqual(savedReadingPosition(book({ readingPosition }), pages).position, { pageNumber: 2 });
  }
  assert.equal(savedReadingPosition(book({ currentPage: NaN }), pages).index, 0);
  assert.equal(savedReadingPosition(book({ currentPage: Infinity }), pages).index, 0);
  assert.equal(savedReadingPosition(book({ currentPage: -4 }), pages).index, 0);
  assert.equal(savedReadingPosition(book({ currentPage: 99 }), pages).index, 2);
});

test('scroll positions use measured source cells independent of row order and list-window indices', () => {
  const rows = [{ pageNumber: 10, y: 2100, height: 1000 }, { pageNumber: 8, y: 100, height: 1000 }, { pageNumber: 9, y: 1100, height: 1000 }];
  assert.deepEqual(scrollPositionAtOffset(rows, 1725, 'portrait'), { pageNumber: 9, scroll: { offset: 625, layout: 'portrait' } });
  assert.equal(scrollPositionAtOffset(rows, 1100, 'portrait').pageNumber, 9);
  assert.equal(scrollPositionAtOffset(rows, -10, 'portrait').scroll.offset, 0);
  assert.equal(scrollPositionAtOffset(rows, NaN, 'portrait'), null);
  assert.equal(scrollPositionAtOffset(rows, 5000, 'portrait'), null, 'An unmeasured viewport must not invent a reading location');
  assert.equal(scrollPositionAtOffset([], 50, 'portrait'), null);
});

test('movement within one source passage updates its offset while keeping unrelated book metadata', () => {
  const initial = book({ coverUrl: 'file://cover', annotation: 'Keep this', readingPosition: { pageNumber: 2, scroll: { offset: 10, layout: 'x' } } });
  const position = { pageNumber: 2, scroll: { offset: 900, layout: 'x' } };
  const updated = applyReadingPosition(initial, page(2), 3, position, 'now');
  assert.equal(updated.currentPage, 2); assert.equal(updated.readingPosition.scroll.offset, 900);
  assert.equal(updated.currentChapter, '3'); assert.equal(updated.currentLoc, 200);
  assert.equal(updated.coverUrl, 'file://cover'); assert.equal(updated.annotation, 'Keep this');
  assert.equal(initial.readingPosition.scroll.offset, 10);
  const earlier = applyReadingPosition(updated, page(1), 3, { pageNumber: 1 }, 'later');
  assert.equal(earlier.currentPage, 1, 'Deliberate backward navigation remains possible');
  assert.equal(earlier.readingPosition.scroll, undefined);
});

test('cloud snapshots preserve existing device progress and files, while new cloud books can be added', () => {
  const local = book({ readingPosition: { pageNumber: 2, scroll: { offset: 800, layout: 'x' } }, coverUrl: 'file://cover', fileLocation: 'file://book.epub' });
  const remote = book({ currentPage: 1, currentLoc: 100, title: 'Server title', coverUrl: 'https://cover' });
  const merged = mergeCloudBookForDevice(local, remote);
  assert.equal(merged.currentPage, 2); assert.equal(merged.currentLoc, 200);
  assert.deepEqual(merged.readingPosition, local.readingPosition);
  assert.equal(merged.fileLocation, 'file://book.epub'); assert.equal(merged.coverUrl, 'file://cover');
  assert.equal(mergeCloudBookForDevice(undefined, remote), remote);
});

test('progress upload waits for device acknowledgement without delaying a later local save', async () => {
  let releaseStorage, releaseCloud;
  const stored = [], uploaded = [];
  let first = true;
  const write = createReadingProgressWriter(async books => {
    if (first) { first = false; await new Promise(ok => { releaseStorage = ok; }); }
    stored.push(books);
  }, async item => { uploaded.push(item); if (uploaded.length === 1) await new Promise(ok => { releaseCloud = ok; }); }, () => assert.fail('Unexpected failure'));
  const firstBook = book({ currentPage: 1 }), secondBook = book({ currentPage: 2 });
  let confirmed = false;
  const saving = write([firstBook], firstBook).then(value => { confirmed = value; });
  await flush(); assert.equal(confirmed, false); assert.equal(uploaded.length, 0);
  releaseStorage(); await saving; await flush();
  assert.equal(confirmed, true); assert.equal(uploaded.length, 1);
  assert.equal(await write([secondBook], secondBook), true); await flush();
  assert.equal(stored.length, 2); assert.equal(uploaded.length, 1, 'Cloud writes stay ordered');
  releaseCloud(); await flush(); assert.deepEqual(uploaded.map(item => item.currentPage), [1, 2]);
});

test('failed device writes are reported without cloud success and a retry is accepted', async () => {
  let fail = true, errors = 0;
  const uploaded = [];
  const write = createReadingProgressWriter(async () => { if (fail) throw new Error('Storage full'); }, async value => uploaded.push(value), () => { errors++; });
  assert.equal(await write([book()], book()), false); await flush();
  assert.equal(errors, 1); assert.equal(uploaded.length, 0);
  fail = false; assert.equal(await write([book()], book()), true); await flush(); assert.equal(uploaded.length, 1);
});

test('a cloud failure neither reports device loss nor blocks local saves or a different book', async () => {
  const uploaded = []; let errors = 0;
  const write = createReadingProgressWriter(async () => {}, async value => { uploaded.push(value.id); if (value.id === 'book') throw new Error('Offline'); }, () => { errors++; });
  assert.equal(await write([book()], book()), true);
  const other = book({ id: 'other' }); assert.equal(await write([other], other), true);
  assert.equal(await write([book()], book()), true); await flush();
  assert.equal(errors, 0); assert.equal(uploaded.length, 3); assert.ok(uploaded.includes('other'));
});
