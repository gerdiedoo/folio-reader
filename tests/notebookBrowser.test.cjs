const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/notebookBrowser.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { browseNotebook } = loaded.exports;
const books = [{ id: 'a', title: 'Café Stories' }, { id: 'b', title: 'Other Book' }];
const highlights = [
  { id: 'h1', bookId: 'a', bookTitle: 'Old title', text: 'A quiet garden [at dawn].', note: 'Straße and roses', chapter: 'Arrival' },
  { id: 'h2', bookId: 'a', bookTitle: 'Café Stories', text: 'Morning light', note: '   ', chapter: 'The Brook' },
  { id: 'h3', bookId: 'b', bookTitle: 'Other Book', text: 'A quiet place', chapter: 'Arrival' },
];
const lexicon = [
  { id: 'l1', bookId: 'a', word: 'quietude', definition: 'A calm state', contextPassage: 'A garden in the rain', chapter: 'Arrival', partOfSpeech: 'noun' },
  { id: 'l2', bookId: 'b', word: 'café', definition: 'A place for coffee', contextPassage: 'The square', chapter: 'Evening', partOfSpeech: 'noun' },
];
const browse = (options = {}, h = highlights, l = lexicon, b = books) => browseNotebook(b, h, l, { query: '', filter: 'all', bookId: 'all', ...options });
const ids = rows => rows.map(row => row.id);

test('Notebook search matches normalized literal terms across each highlight, reflection, chapter and book title', () => {
  assert.deepEqual(ids(browse({ query: ' CAFE\t garden  STRASSE ' }).highlights), ['h1']);
  assert.deepEqual(ids(browse({ query: '[at dawn]' }).highlights), ['h1']);
  assert.deepEqual(ids(browse({ query: 'old title' }).highlights), ['h1']);
  assert.equal(browse({ query: '.*' }).highlights.length, 0);
  assert.equal(browse({ query: 'roses morning' }).highlights.length, 0); // No matching across different entries.
});

test('vocabulary search includes definition, context, chapter, book title and part of speech', () => {
  assert.deepEqual(ids(browse({ query: 'cafe garden noun' }).lexicon), ['l1']);
  assert.deepEqual(ids(browse({ query: 'calm arrival' }).lexicon), ['l1']);
  assert.deepEqual(ids(browse({ query: 'coffee square' }).lexicon), ['l2']);
});

test('entry filters and book scope intersect; Notes requires a nonblank reflection', () => {
  assert.deepEqual(ids(browse({ filter: 'notes' }).highlights), ['h1']);
  assert.equal(browse({ filter: 'notes' }).lexicon.length, 0);
  assert.equal(browse({ filter: 'highlights' }).lexicon.length, 0);
  assert.equal(browse({ filter: 'lexicon' }).highlights.length, 0);
  assert.deepEqual(ids(browse({ bookId: 'a', filter: 'lexicon' }).lexicon), ['l1']);
  assert.deepEqual(ids(browse({ bookId: 'b', query: 'quiet' }).highlights), ['h3']);
});

test('blank queries show all scoped entries, query limits are bounded, and input arrays are not mutated', () => {
  const snapshot = JSON.stringify({ books, highlights, lexicon });
  assert.equal(browse({ query: ' \n\t ' }).highlights.length, 3);
  assert.deepEqual(ids(browse({ query: 'garden' + ' '.repeat(194) + 'absent' }).highlights), ['h1']);
  assert.equal(JSON.stringify({ books, highlights, lexicon }), snapshot);
});

test('export/book scope arrays remain complete while a search or entry filter narrows displayed results', () => {
  const result = browse({ bookId: 'a', query: 'missing', filter: 'notes' });
  assert.equal(result.highlights.length + result.lexicon.length, 0);
  assert.deepEqual(ids(result.bookHighlights), ['h1', 'h2']); assert.deepEqual(ids(result.bookLexicon), ['l1']);
});

test('saved highlights without current library metadata remain searchable by their saved book title', () => {
  const result = browse({ query: 'old title', bookId: 'a' }, highlights, lexicon, []);
  assert.deepEqual(ids(result.highlights), ['h1']);
  assert.deepEqual(ids(result.bookLexicon), ['l1']);
  assert.equal(browse({ bookId: 'missing' }).highlights.length + browse({ bookId: 'missing' }).lexicon.length, 0);
});
