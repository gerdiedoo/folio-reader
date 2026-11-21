const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { sourceAnchorForPosition, sourceAnchorForQuote, resolveSourceAnchor, validSourceAnchor } = loadTypeScript(path.resolve(__dirname, '../src/lib/sourceAnchors.ts'));
const { applyReadingPosition, savedReadingPosition } = loadTypeScript(path.resolve(__dirname, '../src/lib/readingPosition.ts'));
const { createBookmark, findBookmarkPage } = loadTypeScript(path.resolve(__dirname, '../src/lib/bookmarks.ts'));
const { canOpenSavedPassage } = loadTypeScript(path.resolve(__dirname, '../src/lib/archiveSearch.ts'));
const edition = 'a'.repeat(64);
function page(number, first, second, paths) { return { pageNumber: number, locNumber: number * 100, dropCap: '', paragraph1: first, paragraph2Lead: '', highlightedText: second, paragraph2Rest: '', source: { version: 1, edition, href: 'EPUB/text/chapter.xhtml', paths } }; }
const original = page(1, 'One two three.', 'Four five six seven.', ['body/1/0', 'body/3/0']);
const regrouped = [page(7, 'An earlier block.', 'One two three.', ['body/0/0', 'body/1/0']), page(8, 'Four five six seven.', '', ['body/3/0'])];

test('source word anchors resolve the same block after source passage regrouping and renumbering', () => {
  const anchor = sourceAnchorForPosition(original, { wordOffset: 5 });
  assert.equal(anchor.path, 'body/3/0'); assert.equal(anchor.wordOffset, 2); assert.deepEqual(resolveSourceAnchor(anchor, regrouped), { index: 1, wordOffset: 2 });
  assert.deepEqual(resolveSourceAnchor(sourceAnchorForPosition(original, { wordOffset: 1 }), regrouped), { index: 0, wordOffset: 4 });
});

test('saved positions use source paths before synthetic numbers and discard pixel offsets after regrouping', () => {
  const book = applyReadingPosition({ id: 'book' }, original, 1, { pageNumber: 1, wordOffset: 5, scroll: { offset: 200, layout: 'same' } }, 'now');
  const same = savedReadingPosition(book, [original]); assert.equal(same.position.scroll.offset, 200); assert.equal(same.position.wordOffset, 5);
  const moved = savedReadingPosition(book, regrouped); assert.equal(moved.position.pageNumber, 8); assert.equal(moved.position.wordOffset, 2); assert.equal(moved.position.scroll, undefined);
});

test('different editions, unsupported versions, malformed paths and missing blocks never fall back to a numbered passage', () => {
  const anchor = sourceAnchorForPosition(original);
  for (const changed of [{ ...anchor, edition: 'b'.repeat(64) }, { ...anchor, version: 2 }, { ...anchor, href: 'https://example.test/book' }, { ...anchor, path: '../private' }, { ...anchor, path: 'body/99/0' }, { ...anchor, wordOffset: 1000 }]) {
    assert.equal(resolveSourceAnchor(changed, [original]), null);
    assert.equal(savedReadingPosition({ currentPage: 1, readingPosition: { pageNumber: 1, anchor: changed } }, [original]).anchorUnresolved, true);
    assert.equal(canOpenSavedPassage([{ id: 'book' }], { book: [original] }, 'book', 1, changed), false);
  }
  assert.equal(validSourceAnchor({ ...anchor, href: '../other.xhtml' }), false);
  assert.equal(resolveSourceAnchor(anchor, [{ pageNumber: 1, source: original.source }]), null);
});

test('new bookmarks and quote anchors retain source identity; legacy bookmarks keep their original page behavior', () => {
  const bookmark = createBookmark('book', original); assert.equal(findBookmarkPage(bookmark, regrouped), 0); assert.equal(bookmark.anchor.path, 'body/1/0');
  const anchor = sourceAnchorForQuote(original, 'six seven.'); assert.equal(anchor.path, 'body/3/0'); assert.equal(anchor.wordOffset, 2);
  assert.equal(sourceAnchorForQuote(original, 'missing'), undefined);
  assert.equal(findBookmarkPage({ ...bookmark, anchor: undefined }, [original]), 0);
  assert.equal(findBookmarkPage({ ...bookmark, anchor: { ...bookmark.anchor, edition: 'b'.repeat(64) } }, [original]), -1);
});
