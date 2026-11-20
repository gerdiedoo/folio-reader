const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/readerPagination.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { paginateContent, displayPageForPosition } = loaded.exports;
const page = (n, p1, p2 = '', dropCap = '') => ({ pageNumber: n, chapterNumber: 'I', chapterTitle: 'Arrival', dropCap, paragraph1: p1, paragraph2Lead: p2, highlightedText: '', paragraph2Rest: '' });
const words = p => ((p.dropCap + p.paragraph1) + ' ' + p.paragraph2Lead + p.highlightedText + p.paragraph2Rest).trim().split(/\s+/).filter(Boolean);

test('pagination preserves every source word and contiguous word ordinals across both paragraphs', () => {
  const sources = [page(1, 'lan  —\n' + Array.from({ length: 50 }, (_, i) => `first${i}`).join(' '),
    'A\tsecond  paragraph.\n' + Array.from({ length: 30 }, (_, i) => `last${i}`).join(' '), 'É'), page(2, '', '終わり。 📖 More words.'), page(3, '')];
  for (const [lines, chars] of [[4, 12], [8, 30], [24, 80]]) {
    const segments = paginateContent(sources, lines, chars);
    for (const source of sources) {
      const parts = segments.filter(s => s.page.pageNumber === source.pageNumber);
      assert.deepEqual(parts.flatMap(s => words(s.page)), words(source));
      let count = 0;
      for (const part of parts) {
        assert.equal(part.startWord, count); count += words(part.page).length;
        assert.equal(part.endWord, count);
      }
    }
  }
});

test('each source word resolves to the containing display page after narrow/wide and short/tall reflows', () => {
  const sources = [page(3, 'Earlier.'), page(8, Array.from({ length: 180 }, (_, i) => `word${i}`).join(' '), 'Final paragraph after the first.'), page(9, 'Later.')];
  const original = words(sources[1]);
  for (const [lines, chars] of [[4, 12], [8, 28], [20, 70]]) {
    const segments = paginateContent(sources, lines, chars);
    for (let offset = 0; offset < original.length; offset++) {
      const at = displayPageForPosition(segments, { pageNumber: 8, wordOffset: offset });
      assert.equal(segments[at].page.pageNumber, 8);
      assert.ok(words(segments[at].page).includes(original[offset]));
      assert.ok(offset >= segments[at].startWord && offset < segments[at].endWord);
    }
  }
});

test('legacy and invalid offsets safely select a source passage while empty and out-of-range sources stay bounded', () => {
  const segments = paginateContent([page(8, Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')), page(9, '')], 4, 12);
  for (const wordOffset of [undefined, NaN, -1, '20', Infinity]) {
    assert.equal(displayPageForPosition(segments, { pageNumber: 8, wordOffset }), 0);
  }
  assert.equal(displayPageForPosition(segments, { pageNumber: 8, wordOffset: 9999 }), segments.length - 2);
  assert.equal(displayPageForPosition(segments, { pageNumber: 9, wordOffset: 0 }), segments.length - 1);
  assert.equal(displayPageForPosition(segments, { pageNumber: 99, wordOffset: 0 }), -1);
  assert.equal(displayPageForPosition([], { pageNumber: 1 }), -1);
});
