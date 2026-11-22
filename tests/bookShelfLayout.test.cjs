const assert = require('node:assert/strict');
const { test } = require('node:test');
const { loadTypeScript } = require('./loadTypeScript.cjs');
const { bookShelfLayout } = loadTypeScript(require('node:path').join(__dirname, '../src/lib/bookShelfLayout.ts'));
const { libraryViewPreferences } = loadTypeScript(require('node:path').join(__dirname, '../src/lib/libraryViewPreferences.ts'));

test('two- and three-column shelves fit the same margins without overflow on phones and tablets', () => {
  for (const width of [280, 320, 360, 400, 768, 1024]) for (const preferred of [2, 3]) {
    const result = bookShelfLayout(width, 1, preferred);
    assert.ok(result.cardWidth >= 80);
    assert.ok(result.cardWidth * result.columns + result.gap * (result.columns - 1) <= Math.min(width, 768) - 40);
    assert.ok(result.columns <= preferred);
    if (width >= 320) assert.equal(result.columns, preferred);
  }
  assert.ok(bookShelfLayout(400, 1, 3).cardWidth < bookShelfLayout(400, 1, 2).cardWidth);
});

test('large system text and narrow windows get a readable layout without changing the saved column preference', () => {
  assert.equal(bookShelfLayout(400, 1.5, 3).columns, 1);
  assert.equal(bookShelfLayout(210, 1, 3).columns, 1);
  assert.equal(bookShelfLayout(1024, 1.5, 2).columns, 1);
});

test('saved shelf density survives with query/filter/sort while old or invalid preferences default to two columns', () => {
  const saved = { query: 'Folio', filter: 'reading', sort: 'title', viewMode: 'grid', gridColumns: 3 };
  assert.deepEqual(libraryViewPreferences(JSON.parse(JSON.stringify(saved))), saved);
  assert.equal(libraryViewPreferences({ ...saved, viewMode: 'list' }).gridColumns, 3);
  for (const gridColumns of [undefined, 0, 1, 4, '3', NaN]) assert.equal(libraryViewPreferences({ gridColumns }).gridColumns, 2);
});
