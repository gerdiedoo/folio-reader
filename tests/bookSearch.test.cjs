const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/bookSearch.ts');
const loaded = new Module(filename, module);
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { searchBookPages, searchDisplayPage, BookSearchCancelled } = loaded.exports;
const immediate = { yieldControl: async () => {} };
function page(number, p1, p2 = '') {
  return { chapterTitle: `Chapter ${number}`, chapterNumber: String(number), pageNumber: number,
    dropCap: '', paragraph1: p1, paragraph2Lead: p2, highlightedText: '', paragraph2Rest: '' };
}

test('search finds full book text, drop caps and both paragraphs in reading order', async () => {
  const pages = [{ ...page(10, 'arden garden.', 'Another garden.'), dropCap: 'G' }, page(11, 'A final garden.')];
  const result = await searchBookPages(pages, 'GARDEN', immediate);
  assert.equal(result.hasMore, false);
  assert.deepEqual(result.matches.map(m => [m.sourceIndex, m.pageNumber, m.paragraph, m.match]),
    [[0, 10, 0, 'Garden'], [0, 10, 0, 'garden'], [0, 10, 1, 'garden'], [1, 11, 0, 'garden']]);
  assert.equal(new Set(result.matches.map(m => m.id)).size, 4);
  assert.equal(result.matches[2].wordIndex, 3);
});

test('accent/case/whitespace folding retains exact original offsets and complete glyphs', async () => {
  for (const [text, query, match] of [
    ['Café and tea', 'CAFE', 'Café'], ['Cafe\u0301 and tea', 'café', 'Cafe\u0301'],
    ['A\n \tquiet\u00A0garden', 'a quiet garden', 'A\n \tquiet\u00A0garden'],
    ['İSTANBUL', 'istanbul', 'İSTANBUL'], ['Straße', 'STRASSE', 'Straße'],
    ['ΟΣ ος', 'οσ', 'ΟΣ'], ['a ﬁsh', 'fish', 'ﬁsh'], ['A 📖 book', '📖', '📖'],
  ]) {
    const result = await searchBookPages([page(1, text)], query, immediate);
    const found = result.matches[0];
    assert.ok(found, `${query} should match ${text}`);
    assert.equal(found.match, match);
    assert.equal(text.slice(found.start, found.end), match);
  }
  const foldedGlyph = await searchBookPages([page(1, 'ß')], 's', immediate);
  assert.equal(foldedGlyph.matches.length, 1, 'One original glyph should not become duplicate hits');
});

test('queries are literal, trim surrounding whitespace and do not cross paragraph boundaries', async () => {
  for (const query of ['[x]', '.*', '(a)', '$5', '  [x]  ']) {
    const result = await searchBookPages([page(1, '[x] .* (a) $5')], query, immediate);
    assert.equal(result.matches.length, 1);
    assert.equal(result.matches[0].match, query.trim());
  }
  assert.equal((await searchBookPages([page(1, 'last', 'first')], 'last first', immediate)).matches.length, 0);
  assert.deepEqual(await searchBookPages([page(1, 'words')], ' \n ', immediate), { matches: [], hasMore: false });
  assert.deepEqual(await searchBookPages([], 'words', immediate), { matches: [], hasMore: false });
});

test('the result cap distinguishes exactly 100 from more matches without claiming a total', async () => {
  for (const count of [100, 101]) {
    const result = await searchBookPages([page(1, Array(count).fill('word').join(' '))], 'word', immediate);
    assert.equal(result.matches.length, 100);
    assert.equal(result.hasMore, count > 100);
  }
  const limited = await searchBookPages([page(1, 'word word word word')], 'word', { ...immediate, limit: 3 });
  assert.equal(limited.matches.length, 3);
  assert.equal(limited.hasMore, true);
  await assert.rejects(searchBookPages([], 'x'.repeat(201), immediate), /200 characters/);
});

test('snippets are bounded and never split supplementary Unicode at context edges', async () => {
  const text = '📖'.repeat(70) + 'match' + '📖'.repeat(70);
  const { matches: [result] } = await searchBookPages([page(1, text)], 'match', immediate);
  assert.equal(result.match, 'match');
  assert.equal(result.leadingEllipsis, true);
  assert.equal(result.trailingEllipsis, true);
  assert.ok(result.before.length <= 65 && result.after.length <= 65);
  assert.equal(result.before, '📖'.repeat(32));
  assert.equal(result.after, '📖'.repeat(32));
  const shifted = await searchBookPages([page(1, '📖'.repeat(70) + 'z' + 'match' + 'z' + '📖'.repeat(70))], 'match', immediate);
  for (const snippet of [shifted.matches[0].before, shifted.matches[0].after]) {
    assert.ok(!snippet.includes('\uFFFD'));
    assert.ok(!/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(snippet));
  }
});

test('chunked searches yield and abort without returning partial or stale results', async () => {
  const pages = Array.from({ length: 40 }, (_, i) => page(i + 1, 'a quiet garden'));
  const signal = { aborted: true };
  await assert.rejects(searchBookPages(pages, 'garden', { ...immediate, signal }), BookSearchCancelled);
  signal.aborted = false;
  let yields = 0;
  await assert.rejects(searchBookPages(pages, 'absent', {
    signal,
    yieldControl: async () => { if (++yields === 2) signal.aborted = true; },
  }), BookSearchCancelled);
  assert.equal(yields, 2);
  let completedYields = 0;
  const complete = await searchBookPages(pages, 'absent', { yieldControl: async () => { completedYields++; } });
  assert.equal(completedYields, 5);
  assert.deepEqual(complete, { matches: [], hasMore: false });
  const longSignal = { aborted: false };
  let longYields = 0;
  await assert.rejects(searchBookPages([page(1, 'a'.repeat(50000))], 'absent', {
    signal: longSignal,
    yieldControl: async () => { if (++longYields === 2) longSignal.aborted = true; },
  }), BookSearchCancelled);
  assert.equal(longYields, 2, 'One long paragraph must also allow cancellation');
});

test('Pages mode targets the reflowed segment containing the first matched word', async () => {
  const original = page(5, 'first parts then', 'a needle follows');
  const { matches: [match] } = await searchBookPages([original], 'eedle', immediate);
  assert.equal(match.wordIndex, 4, 'A match inside a word must target that word');
  const segments = [
    { sourceIndex: 3, page: page(4, 'unrelated words') },
    { sourceIndex: 0, page: page(5, 'first parts') },
    { sourceIndex: 0, page: page(5, 'then', 'a') },
    { sourceIndex: 0, page: page(5, '', 'needle follows') },
  ];
  assert.equal(searchDisplayPage(segments, match), 3);
  const reflowed = [{ sourceIndex: 0, page: page(5, 'first parts then', 'a needle follows') }];
  assert.equal(searchDisplayPage(reflowed, match), 0, 'The same source word must survive a keyboard/viewport reflow');
  assert.equal(searchDisplayPage([], match), -1);
});
