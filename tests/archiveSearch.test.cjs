const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const cache = new Map();
function load(relative) {
  const filename = path.resolve(__dirname, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = new Module(filename, module); cache.set(filename, loaded);
  loaded.require = name => load(path.relative(__dirname, path.resolve(path.dirname(filename), name)) + '.ts');
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  return loaded.exports;
}
const { searchArchive, canOpenSavedPassage } = load('../src/lib/archiveSearch.ts');
const books = [
  { id: 'a', title: 'Café Garden', author: 'Zoë Straße', lastOpened: '2026-01-01' },
  { id: 'b', title: 'A Garden', author: 'Someone Else', lastOpened: '2026-11-20' },
];
const highlights = [{ id: 'a', bookId: 'a', bookTitle: 'Café Garden', text: 'A quiet morning', note: 'Roses [at dawn]', chapter: 'Arrival' }];
const lexicon = [{ id: 'a', bookId: 'a', word: 'Quietude', definition: 'Calmness', contextPassage: 'The garden at dawn', chapter: 'Arrival', partOfSpeech: 'noun' }];
const search = (query, filter = 'all') => searchArchive(books, highlights, lexicon, query, filter);

test('global search treats blank/whitespace and over-limit suffixes as no query rather than matching the archive', () => {
  for (const query of ['', ' \n\t ', ' '.repeat(200) + 'garden']) assert.deepEqual(search(query).sections, []);
  assert.equal(search('garden' + ' '.repeat(194) + 'absent').count, 4);
});

test('global search uses normalized literal all-term matching across the selected result type', () => {
  const result = search('CAFE STRASSE');
  assert.equal(result.count, 1); assert.equal(result.sections[0].data[0].book.id, 'a');
  assert.equal(search('roses arrival', 'quotes').sections[0].data[0].quote.id, 'a');
  assert.equal(search('calmness dawn', 'vocabulary').sections[0].data[0].vocabulary.id, 'a');
  assert.equal(search('[at dawn]', 'quotes').count, 1); assert.equal(search('.*').count, 0);
});

test('categories form separate typed sections and leave the source records and ordering intact', () => {
  const snapshot = JSON.stringify({ books, highlights, lexicon });
  const result = search('garden');
  assert.deepEqual(result.sections.map(section => section.key), ['books', 'quotes', 'vocabulary']);
  assert.deepEqual(result.sections[0].data.map(item => item.book.id), ['b', 'a']);
  for (const [filter, kind, count] of [['books', 'book', 2], ['quotes', 'quote', 1], ['vocabulary', 'vocabulary', 1]]) {
    const selected = search('garden', filter); assert.equal(selected.count, count);
    assert.ok(selected.sections.flatMap(section => section.data).every(item => item.kind === kind));
  }
  assert.equal(result.sections[2].data[0].vocabulary, lexicon[0]);
  assert.equal(JSON.stringify({ books, highlights, lexicon }), snapshot);
});

test('saved quote jumps require a real existing book and an exact loaded source passage', () => {
  const pages = { a: [{ pageNumber: 2 }, { pageNumber: 4 }] };
  assert.equal(canOpenSavedPassage(books, pages, 'a', 4), true);
  for (const page of [1, 3, 5, 0, -1, 2.5, NaN, Infinity, '2']) assert.equal(canOpenSavedPassage(books, pages, 'a', page), false);
  assert.equal(canOpenSavedPassage([], pages, 'a', 2), false);
  assert.equal(canOpenSavedPassage(books, {}, 'a', 2), false);
  assert.equal(canOpenSavedPassage([{ id: 'constructor' }], {}, 'constructor', 1), false);
  assert.equal(canOpenSavedPassage(books, Object.create({ a: [{ pageNumber: 2 }] }), 'a', 2), false);
});
