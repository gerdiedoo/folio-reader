const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { backupBookKey, backupProgressNotice, hasBackupReadingProgress, libraryBackupEntry, matchingLibraryBackupEntry, readLibraryBackupEntry, restoreLibraryProgress } = loadTypeScript(path.resolve(__dirname, '../src/lib/libraryBackup.ts'));
const edition = 'a'.repeat(64), otherEdition = 'b'.repeat(64);
const anchor = { version: 1, edition, href: 'EPUB/body.xhtml', path: 'body/2/0', wordOffset: 2 };
const pages = Array.from({ length: 3 }, (_, index) => ({ chapterTitle: 'Chapter', chapterNumber: '2', folioNumber: '1', pageNumber: index + 1, totalBookPages: 3, locNumber: 100 + index, totalLoc: 200, minutesLeftInChapter: 2, dropCap: '', paragraph1: 'one two three four', paragraph2Lead: '', highlightedText: '', paragraph2Rest: '', source: { version: 1, edition, href: 'EPUB/body.xhtml', paths: [`body/${index}/0`] } }));
const imported = { id: 'new-copy', title: 'Book', author: 'Author', documentFingerprint: edition, currentPage: 1, totalPages: 3, progressPercent: 0, lastOpened: 'Not yet read', currentChapter: '1', coverUrl: '', fileLocation: 'file:///private/original.epub', minutesLeft: 10, coverAlt: '' };
const readBook = { ...imported, id: 'old-copy', currentPage: 88, totalPages: 200, currentChapter: '9', currentLoc: 950, progressPercent: 44, readingPosition: { pageNumber: 88, wordOffset: 20, anchor, scroll: { offset: 492, layout: 'old-phone', sourcePaths: ['body/2/0'] } } };

test('book-list backup retains the edition and source passage without local paths or pixel offsets', () => {
 const entry = libraryBackupEntry(readBook, 1342);
 assert.equal(entry.documentFingerprint, edition); assert.equal(entry.gutenbergId, 1342);
 assert.deepEqual(entry.readingPosition, { pageNumber: 88, wordOffset: 20, anchor });
 assert.equal(JSON.stringify(entry).includes('file:///'), false);
 assert.equal(JSON.stringify(entry).includes('old-phone'), false);
 assert.equal(JSON.stringify(entry).includes('scroll'), false);
 assert.notEqual(entry.readingPosition.anchor, readBook.readingPosition.anchor);
});

test('matching-edition recovery resolves the passage after source pages have regrouped', () => {
 const result = restoreLibraryProgress(imported, libraryBackupEntry(readBook), pages);
 assert.equal(result.restored, true); assert.equal(result.book.currentPage, 3);
 assert.equal(result.book.readingPosition.wordOffset, 2); assert.equal(result.book.currentLoc, 102);
 assert.deepEqual(result.book.readingPosition.anchor, anchor);
 assert.equal(result.book.readingPosition.scroll, undefined);
 assert.equal(result.book.currentChapter, '2'); assert.equal(result.book.progressPercent, 100);
 assert.equal(result.book.fileLocation, imported.fileLocation);
 assert.match(backupProgressNotice(result), /Restored the saved passage/);
});

test('a different edition never inherits a synthetic page, chapter or location; completion remains book-list metadata', () => {
 const original = { ...readBook, documentFingerprint: otherEdition, readingPosition: { ...readBook.readingPosition, anchor: { ...anchor, edition: otherEdition } }, isFinished: true };
 const result = restoreLibraryProgress(imported, libraryBackupEntry(original), pages);
 assert.equal(result.restored, false); assert.equal(result.reason, 'different-edition');
 assert.equal(result.book.currentPage, imported.currentPage); assert.equal(result.book.currentChapter, imported.currentChapter);
 assert.equal(result.book.currentLoc, imported.currentLoc); assert.equal(result.book.readingPosition, undefined);
 assert.equal(result.book.isFinished, true);
 assert.match(backupProgressNotice(result), /differs from your backup/);
});

test('unresolvable paths or words stay at the beginning without guessing a nearby page', () => {
 for (const invalid of [{ ...anchor, path: 'body/100/0' }, { ...anchor, wordOffset: 99 }]) {
  const entry = libraryBackupEntry({ ...readBook, readingPosition: { ...readBook.readingPosition, anchor: invalid } });
  const result = restoreLibraryProgress(imported, entry, pages);
  assert.equal(result.restored, false); assert.equal(result.reason, 'missing-passage'); assert.equal(result.book, imported);
  assert.match(backupProgressNotice(result), /could not be found/);
 }
});

test('legacy book lists remain readable but do not claim to restore a precise passage', () => {
 const old = readLibraryBackupEntry({ title: 'Old book', author: 'Author', currentPage: 88, progressPercent: 44 });
 const result = restoreLibraryProgress(imported, old, pages);
 assert.equal(hasBackupReadingProgress(old), true); assert.equal(result.restored, false);
 assert.equal(result.reason, 'missing-anchor'); assert.equal(result.book, imported);
 assert.match(backupProgressNotice(result), /older backup has no exact saved passage/);
 assert.equal(hasBackupReadingProgress({ title: 'Unread', author: 'Author', currentPage: 1, progressPercent: 0 }), false);
});

test('invalid edition-specific checkpoints fail validation before backup replacement', () => {
 const valid = libraryBackupEntry(readBook);
 for (const change of [
  { documentFingerprint: 'invalid' },
  { readingPosition: { pageNumber: 88, anchor: { ...anchor, edition: otherEdition } } },
  { readingPosition: { pageNumber: 88, anchor: { ...anchor, href: '../../outside' } } },
  { readingPosition: { pageNumber: 0, anchor } },
  { readingPosition: { pageNumber: 88, wordOffset: -1, anchor } },
  { readingPosition: { pageNumber: 88 } },
 ]) assert.throws(() => readLibraryBackupEntry({ ...valid, ...change }), /read safely/);
});

test('backup lookup prefers matching content over title matches and keeps authors and non-Latin titles distinct', () => {
 const old = { title: 'Book', author: 'Author', documentFingerprint: otherEdition };
 const exact = { title: 'Renamed book', author: 'Author', documentFingerprint: edition };
 assert.equal(matchingLibraryBackupEntry(imported, [old, exact]), exact);
 assert.equal(matchingLibraryBackupEntry(imported, [{ title: 'Book', author: 'Another author' }]), undefined);
 assert.notEqual(backupBookKey({ title: '山', author: '李' }), backupBookKey({ title: '海', author: '李' }));
 assert.notEqual(backupBookKey({ title: 'Same', author: 'Alice' }), backupBookKey({ title: 'Same', author: 'Bob' }));
 assert.equal(backupBookKey({ title: 'CAFÉ!', author: 'Zoë' }), backupBookKey({ title: 'Café', author: 'Zoe' }));
});

test('legacy completion status survives without inventing a source position or applying to another work', () => {
 const entry = { title: 'Book', author: 'Author', currentPage: 88, progressPercent: 100, isFinished: true };
 const sameWork = restoreLibraryProgress(imported, entry, pages);
 assert.equal(sameWork.restored, false); assert.equal(sameWork.book.isFinished, true);
 assert.equal(sameWork.book.currentPage, 1); assert.equal(sameWork.book.readingPosition, undefined);
 const differentWork = restoreLibraryProgress({ ...imported, title: 'A different work' }, entry, pages);
 assert.equal(differentWork.book.isFinished, undefined);
});
