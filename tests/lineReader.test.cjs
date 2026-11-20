const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/lineReader.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { createLineChapter, firstLineWord, linePassage, lineQuote, lineSpeed } = loaded.exports;
function page(pageNumber, p1, p2 = '') {
  return { chapterNumber: 'I', chapterTitle: 'Garden', pageNumber, locNumber: pageNumber * 50, dropCap: '', paragraph1: p1, paragraph2Lead: p2, highlightedText: '', paragraph2Rest: '' };
}

test('word tokens keep source pages and original paragraph offsets, including Unicode', () => {
  const first = { ...page(10, 'lan —  garden.\nStill here.', 'Second\tparagraph.'), dropCap: 'É' };
  const last = page(11, '終わり。 📖');
  const chapter = createLineChapter([first, page(20, ''), last]);
  assert.deepEqual(chapter.words.map(w => w.text), ['Élan', '—', 'garden.', 'Still', 'here.', 'Second', 'paragraph.', '終わり。', '📖']);
  assert.equal(firstLineWord(chapter, 10), 0);
  assert.equal(firstLineWord(chapter, 11), 7);
  assert.equal(linePassage(chapter, 7), last);
  assert.equal(lineQuote(chapter, 2).text, 'Élan —  garden.\nStill here.');
  assert.equal(lineQuote(chapter, 5).text, 'Second\tparagraph.');
});

test('every saved line quote is an exact substring of one source paragraph and has its own anchor', () => {
  const pages = [page(1, 'first  paragraph starts here', 'another\nparagraph'), page(2, Array.from({ length: 30 }, (_, i) => `word${i}`).join('  '))];
  const chapter = createLineChapter(pages);
  for (let i = 0; i < chapter.words.length; i++) {
    const quote = lineQuote(chapter, i);
    assert.ok(quote.text.includes(chapter.words[i].text));
    assert.ok([quote.page.paragraph1, quote.page.paragraph2Lead].some(text => text.includes(quote.text)));
    assert.equal(quote.page, linePassage(chapter, i));
    assert.ok(quote.text.split(/\s+/).length <= 14);
  }
  assert.equal(lineQuote(chapter, chapter.words.length - 1).page.pageNumber, 2);
});

test('empty text and invalid word indices cannot create fabricated quotes or anchors', () => {
  const empty = createLineChapter([page(1, '', '')]);
  assert.deepEqual(empty, { words: [], segments: [] });
  assert.equal(firstLineWord(empty, 1), 0);
  assert.equal(linePassage(empty, 0), undefined);
  assert.equal(lineQuote(empty, 0), null);
  const chapter = createLineChapter([page(1, 'a word')]);
  for (const index of [-1, 2, NaN]) {
    assert.equal(lineQuote(chapter, index), null);
    assert.equal(linePassage(chapter, index), undefined);
  }
});

test('invalid playback rates cannot create zero-delay or unbounded timers', () => {
  for (const bad of [0, -200, 20]) assert.equal(lineSpeed(bad), 60);
  for (const bad of [700, 100000]) assert.equal(lineSpeed(bad), 600);
  for (const bad of [undefined, null, NaN, Infinity, '300']) assert.equal(lineSpeed(bad), 240);
  assert.equal(lineSpeed(239.7), 240);
});
