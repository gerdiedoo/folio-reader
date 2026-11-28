const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const ts = require('typescript');
function fixture({ fetcher = async () => { throw Error('offline'); }, transfers = [] } = {}) {
  const timers = new Map(), modules = new Map(), files = new Map(), attempts = [], writes = [];
  let nextTimer = 1, now = 1000000;
  class File {
    constructor(...parts) {
      this.uri = parts.length === 1 ? parts[0] : parts.join('/');
      if (!files.has(this.uri)) files.set(this.uri, { exists: false, bytes: [80, 75, 3, 4], size: 2048 });
    }
    get exists() { return files.get(this.uri).exists; }
    get size() { return files.get(this.uri).size; }
    delete() { files.get(this.uri).exists = false; }
    open() { return { readBytes: () => Uint8Array.from(files.get(this.uri).bytes), close() {} }; }
    static createDownloadTask(url, dest, options) {
      const attempt = { url, dest, options, released: false }; attempts.push(attempt);
      return { downloadAsync: () => {
        const action = transfers.shift() ?? 'epub';
        files.get(dest.uri).exists = true;
        if (typeof action === 'function') return action(dest, options, files.get(dest.uri));
        if (action === 'error') return Promise.reject(Error('connection lost'));
        if (action === 'html') files.get(dest.uri).bytes = [60, 104, 116, 109];
        options.onProgress({ bytesWritten: 200, totalBytes: 2000 });
        return Promise.resolve(dest);
      }, release() { attempt.released = true; } };
    }
  }
  const native = { File, Paths: { cache: 'file:///cache' } };
  const storage = { loadJSON: async () => null, saveJSON: async (...args) => writes.push(args) };
  function load(relative) {
    const filename = path.resolve(__dirname, relative);
    if (modules.has(filename)) return modules.get(filename).exports;
    const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths; modules.set(filename, loaded);
    loaded.require = name => {
      if (name === 'expo-file-system') return native;
      if (name === './localStore') return storage;
      if (name === '__env') return { fetcher, Date: class extends Date { static now() { return now; } },
        setTimeout(fn, ms) { const id = nextTimer++; timers.set(id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); } };
      if (name.startsWith('.')) return load(path.relative(__dirname, path.resolve(path.dirname(filename), name)) + '.ts');
      return require(name);
    };
    loaded._compile("const {fetcher: fetch, Date, setTimeout, clearTimeout} = require('__env');\n" + ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
    return loaded.exports;
  }
  return { ...load('../src/lib/catalog.ts'), providers: load('../src/lib/catalogProviders.ts'), extras: load('../src/lib/extraCatalogProviders.ts'), request: load('../src/lib/catalogRequest.ts').catalogRequest,
    timers, files, attempts, writes, advance: ms => { now += ms; }, fire: ms => { const entry = [...timers].find(([, t]) => t.ms === ms); assert.ok(entry, 'Missing deadline'); timers.delete(entry[0]); entry[1].fn(); } };
}
const response = data => ({ ok: true, status: 200, json: async () => data, text: async () => data });
const gutBook = (id = 1342) => ({ id, title: 'Pride and Prejudice', authors: [{ name: 'Austen, Jane' }], formats: { 'application/epub+zip': `http://www.gutenberg.org/ebooks/${id}.epub.noimages`, 'image/jpeg': `https://www.gutenberg.org/cover.jpg` }, subjects: ['Fiction'], download_count: 20 });
const gutPage = () => ({ results: [gutBook()], next: null, count: 1 });
const catalogBook = () => ({ id: 'gutenberg-1342', epubUrl: 'https://www.gutenberg.org/ebooks/1342.epub.noimages' });
const flush = () => new Promise(resolve => setImmediate(resolve));
const standardHtml = `<main class="ebooks"><ol class="ebooks-list grid"><li typeof="schema:Book" about="/ebooks/jane-austen/pride-and-prejudice"><div><a property="schema:url" href="/ebooks/jane-austen/pride-and-prejudice"><picture><img src="/ebooks/jane-austen/pride-and-prejudice/downloads/cover-thumbnail.jpg"></picture></a></div><p><a property="schema:url"><span property="schema:name">Pride &amp; Prejudice</span></a></p><p class="author"><a><span property="schema:name">Jane Austen</span></a></p></li><li typeof="schema:Book" class="ribbon wanted" about="/ebooks/not/ready"><div class="placeholder-cover"></div></li></ol><nav class="pagination"><a rel="next" href="?page=2">Next</a></nav></main>`;

test('Gutenberg validates records, uses HTTPS, preserves author names and rejects unrelated download hosts', () => {
  const p = fixture().providers;
  const book = p.gutenbergBook(gutBook()); assert.equal(book.author, 'Jane Austen'); assert.match(book.epubUrl, /^https:/);
  assert.equal(p.gutenbergBook({ ...gutBook(), formats: { 'application/epub+zip': 'https://attacker.test/book.epub' } }), null);
  for (const data of [null, {}, { count: 1, next: null, results: [{}] }, { count: '1', results: [] }]) assert.throws(() => p.parseGutenbergPage(data));
  assert.deepEqual(p.parseGutenbergPage({ results: [], count: 0, next: null }).books, []);
});

test('Gutenberg detail descriptions and languages survive source normalization', async () => {
  const f = fixture({ fetcher: async () => response({ ...gutBook(), summaries: ['<p>A <i>classic</i>.</p>'], languages: ['en'] }) });
  const details = await f.loadCatalogBookDetails({ ...catalogBook(), title: 'Pride and Prejudice' });
  assert.equal(details.description, '<p>A <i>classic</i>.</p>'); assert.deepEqual(details.languages, ['en']);
});

test('Standard Ebooks details prefer the full description and never request an untrusted page', async () => {
  const urls = [], html = '<html lang="en"><head><meta name="description" content="Short preview"></head><section id="description"><p>Full <i>description</i>.</p><p>Second paragraph.</p></section></html>';
  const f = fixture({ fetcher: async url => { urls.push(url); return response(html); } });
  const item = { id: 'standard-author--book', source: 'standard', detailUrl: 'https://standardebooks.org/ebooks/author/book' };
  const details = await f.loadCatalogBookDetails(item);
  assert.equal(details.description, '<p>Full <i>description</i>.</p><p>Second paragraph.</p>'); assert.deepEqual(details.languages, ['en']);
  await f.loadCatalogBookDetails(item); assert.equal(urls.length, 1);
  await assert.rejects(f.loadCatalogBookDetails({ ...item, id: 'evil', detailUrl: 'https://attacker.test/ebooks/author/book' }));
  assert.equal(urls.length, 1);
});

test('Archive details preserve multi-part descriptions and optional metadata; cancelled results are not cached', async () => {
  let finish, calls = 0;
  const f = fixture({ fetcher: async () => { calls++; return new Promise(done => { finish = done; }); } });
  const item = { id: 'archive-book_123', source: 'archive', subjects: [] }, ctrl = new AbortController();
  const pending = f.loadCatalogBookDetails(item, ctrl.signal); await flush(); ctrl.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finish(response({ metadata: { description: 'Old' } })); await flush();
  const retry = f.loadCatalogBookDetails(item); await flush();
  finish(response({ metadata: { description: ['<p>First</p>', 'Second'], language: 'eng', subject: ['Fiction'] } }));
  const details = await retry; assert.equal(calls, 2); assert.equal(details.description, '<p>First</p>\n\nSecond');
  assert.deepEqual(details.languages, ['eng']); assert.deepEqual(details.subjects, ['Fiction']);
});

test('Standard Ebooks parses the public grid, skips unreleased books and resolves compatible EPUB download links', () => {
  const p = fixture().providers, page = p.parseStandardPage(standardHtml);
  assert.equal(page.books.length, 1); assert.equal(page.books[0].title, 'Pride & Prejudice'); assert.equal(page.books[0].author, 'Jane Austen'); assert.equal(page.hasMore, true); assert.equal(page.total, null);
  assert.equal(page.books[0].detailUrl, 'https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice');
  const links = p.standardEpubLinks('<a class="epub" href="/ebooks/jane-austen/pride-and-prejudice/downloads/book.epub">Compatible epub</a><a class="epub" href="https://attacker.test/file.epub">Bad</a>', page.books[0].detailUrl);
  assert.deepEqual(links, ['https://standardebooks.org/ebooks/jane-austen/pride-and-prejudice/downloads/book.epub?source=download']);
  assert.throws(() => p.parseStandardPage('<html>Temporarily unavailable</html>'));
  assert.equal(p.parseStandardPage('<main class="ebooks"><p class="no-results">No books</p></main>').books.length, 0);
  assert.match(p.standardSearchUrl('Jane', '', 2, 'descending'), /page=2.*sort=newest/);
});

test('Internet Archive search constrains editions and metadata rejects restricted/encrypted files', () => {
  const p = fixture().providers, url = new URL(p.archiveSearchUrl('title:"x" OR *', '', 1, 'popular'));
  assert.match(url.searchParams.get('q'), /access-restricted-item:false AND year:\[\* TO 1930\]/);
  assert.equal(url.searchParams.get('rows'), '24');
  const result = p.parseArchivePage({ response: { numFound: 30, docs: [{ identifier: 'book_123', title: 'A Book', creator: ['Author One', 'Author Two'], downloads: 4 }] } }, 1);
  assert.equal(result.hasMore, true); assert.equal(result.books[0].author, 'Author One, Author Two');
  const metadata = { metadata: {}, files: [{ name: 'derived.epub', format: 'EPUB' }, { name: 'original file.epub', source: 'original' }, { name: 'locked.epub', format: 'LCP Encrypted EPUB' }, { name: 'private.epub', private: true }, { name: '../escape.epub' }] };
  assert.deepEqual(p.archiveEpubLinks(metadata, 'book_123'), ['https://archive.org/download/book_123/original%20file.epub', 'https://archive.org/download/book_123/derived.epub']);
  for (const restricted of [true, 'true', '1', 1]) assert.deepEqual(p.archiveEpubLinks({ ...metadata, metadata: { 'access-restricted-item': restricted } }, 'book_123'), []);
  assert.deepEqual(p.archiveEpubLinks({ ...metadata, is_dark: true }, 'book_123'), []);
});

test('catalog request deadlines cover transport and response body even when abort is ignored', async () => {
  for (const body of [false, true]) {
    const f = fixture({ fetcher: async () => body ? { ok: true, json: () => new Promise(() => {}) } : new Promise(() => {}) });
    const pending = f.request('https://gutendex.com/books/', 'json'); await flush(); f.fire(10000);
    await assert.rejects(pending, error => error.kind === 'timeout'); assert.equal(f.timers.size, 0);
  }
});

test('Open Library can use a separate deadline without changing other providers', async () => {
  const f = fixture({ fetcher: async () => new Promise(() => {}) });
  const pending = f.request('https://openlibrary.org/search.json?q=books', 'json', undefined, 1, 25000);
  await flush(); assert.equal([...f.timers.values()].some(timer => timer.ms === 10000), false);
  f.fire(25000); await assert.rejects(pending, error => error.kind === 'timeout');
  assert.equal(f.timers.size, 0);
});

test('cancellation finishes promptly and never returns starter results for an aborted request', async () => {
  const f = fixture({ fetcher: async () => new Promise(() => {}) }), ctrl = new AbortController();
  const pending = f.searchCatalog({}, ctrl.signal); await flush(); ctrl.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(f.timers.size, 0);
});

test('rate limiting is not retried automatically; server/network errors retry once', async () => {
  for (const status of [429, 404, 503]) {
    let calls = 0;
    const f = fixture({ fetcher: async () => { calls++; return { ok: false, status }; } });
    await assert.rejects(f.request('url', 'json'), error => error.status === status);
    assert.equal(calls, status === 503 ? 2 : 1); assert.equal(f.timers.size, 0);
  }
});

test('failed Gutenberg lookup offers a labeled searchable starter collection, never as a subsequent page', async () => {
  const f = fixture(); const page = await f.searchCatalog({ query: 'austen' });
  assert.equal(page.books.length, 1); assert.equal(page.books[0].id, 'gutenberg-1342'); assert.match(page.notice, /starter collection/); assert.equal(page.hasMore, false);
  assert.match((await f.searchCatalog({ query: 'absent' })).notice, /unavailable/);
  await assert.rejects(f.searchCatalog({ page: 2 }));
  await assert.rejects(f.searchCatalog({ source: 'standard' }));
});

test('successful source results are cached separately and stale results disclose a source failure', async () => {
  let fail = false, calls = 0;
  const f = fixture({ fetcher: async url => { calls++; if (fail) throw Error('offline'); return response(url.includes('standardebooks') ? standardHtml : gutPage()); } });
  assert.equal((await f.searchCatalog({})).books[0].source, 'gutenberg');
  assert.equal((await f.searchCatalog({ source: 'standard' })).books[0].source, 'standard');
  await f.searchCatalog({}); assert.equal(calls, 2);
  f.advance(120001); fail = true;
  assert.match((await f.searchCatalog({})).notice, /previously loaded/);
  assert.equal(f.timers.size, 0);
});

test('downloads prefer illustrated Gutenberg EPUBs, reject HTML and clean the failed attempt before fallback', async () => {
  const f = fixture({ transfers: ['html', 'epub'] }), progress = [];
  const uri = await f.downloadEpub(catalogBook(), value => progress.push(value));
  assert.match(f.attempts[0].url, /epub3.images$/); assert.match(f.attempts[1].url, /epub.noimages$/);
  assert.equal(f.files.get(f.attempts[0].dest.uri).exists, false); assert.equal(f.files.get(uri).exists, true);
  assert.ok(f.attempts.every(attempt => attempt.released)); assert.equal(progress.at(-1), 100); assert.equal(f.timers.size, 0);
  f.deleteDownloaded(uri); assert.equal(f.files.get(uri).exists, false);
});

test('all failed transfers clean partial files and leave a retryable error', async () => {
  const f = fixture({ transfers: ['error', 'html', 'error'] });
  await assert.rejects(f.downloadEpub(catalogBook()), error => error.kind === 'file');
  assert.equal(f.attempts.length, 3); assert.ok([...f.files.values()].every(file => !file.exists)); assert.ok(f.attempts.every(attempt => attempt.released)); assert.equal(f.timers.size, 0);
});

test('a cancelled or timed-out transfer ignores late success and removes its cache file', async () => {
  for (const cancel of [true, false]) {
    let resolve;
    const f = fixture({ transfers: [dest => new Promise(done => { resolve = () => done(dest); })] });
    const ctrl = new AbortController(), pending = f.downloadEpub(catalogBook(), undefined, ctrl.signal);
    await flush(); if (cancel) ctrl.abort(); else f.fire(60000);
    await assert.rejects(pending, error => cancel ? error.name === 'AbortError' : error.kind === 'timeout');
    resolve(); await flush(); assert.ok([...f.files.values()].every(file => !file.exists)); assert.ok(f.attempts[0].released); assert.equal(f.timers.size, 0);
  }
});

test('Standard and Archive resolve source metadata before downloading instead of guessing filenames', async () => {
  const f = fixture({ fetcher: async url => response(url.includes('standardebooks') ? '<a class="epub" href="/ebooks/a/b/downloads/compatible.epub">Download</a>' : { metadata: {}, files: [{ name: 'edition.epub' }] }) });
  await f.downloadEpub({ id: 'standard-a--b', source: 'standard', detailUrl: 'https://standardebooks.org/ebooks/a/b' });
  assert.match(f.attempts[0].url, /compatible.epub\?source=download$/);
  await f.downloadEpub({ id: 'archive-book', source: 'archive' }); assert.equal(f.attempts[1].url, 'https://archive.org/download/book/edition.epub');
});

test('catalog bookkeeping rejects malformed mappings and can report strict save failure after a confirmed import', async () => {
  const f = fixture();
  assert.deepEqual(await f.loadAdded({ loadJSON: async () => ['bad'] }), {});
  assert.deepEqual(await f.loadAdded({ loadJSON: async () => ({ 'gutenberg-1': 'epub-123', arbitrary: 'x', 'standard-a': {} }) }), { 'gutenberg-1': 'epub-123' });
  await assert.rejects(f.rememberAdded({}, 'gutenberg-1', 'epub-123', { saveJSONStrict: async () => { throw Error('storage full'); } }), /storage full/);
});

test('oversized downloads stop promptly with a useful limit message and clean partial files', async () => {
  const f = fixture({ transfers: [(dest, options) => { options.onProgress({ bytesWritten: 1, totalBytes: 41 * 1024 * 1024 }); return Promise.resolve(dest); }] });
  await assert.rejects(f.downloadEpub(catalogBook()), error => error.kind === 'size' && /40 MB/.test(error.message));
  assert.equal(f.attempts.length, 1); assert.ok([...f.files.values()].every(file => !file.exists)); assert.equal(f.timers.size, 0);
});

const freeGoogle = (id = 'volume_1') => ({ id, volumeInfo: { title: 'A Free Book', authors: ['An Author'], description: '<p>Free text.</p>', language: 'en' },
 accessInfo: { viewability: 'ALL_PAGES', publicDomain: true, epub: { isAvailable: true, downloadLink: 'https://books.google.com/books/download/free.epub?output=epub' } }, saleInfo: { saleability: 'FREE' } });
const googleKeyA = 'reader-A-key-0123456789012345', googleKeyB = 'reader-B-key-0123456789012345';
const oapenItem = (id = 'item-1', file = 'book.epub') => ({ uuid: id, name: 'An Academic Book', metadata: [{ key: 'dc.title', value: 'An Academic Book' }, { key: 'dc.contributor.author', value: 'An Author' }, { key: 'dc.description.abstract', value: '<p>Open research.</p>' }], bitstreams: [{ uuid: 'file-1', name: file, mimeType: file.endsWith('.epub') ? 'application/epub+zip' : 'application/pdf', retrieveLink: `https://library.oapen.org/rest/bitstreams/file-1/retrieve` }] });

test('source registry contains each requested source once, with existing Gutendex under Gutenberg', () => {
 const { CATALOG_SOURCES } = fixture().providers;
 assert.deepEqual(CATALOG_SOURCES.map(source => source.id), ['gutenberg','standard','archive','openlibrary','google','oapen','doab','wikisource','feedbooks']);
 assert.equal(new Set(CATALOG_SOURCES.map(source => source.id)).size, CATALOG_SOURCES.length);
});

test('Open Library only accepts public-access works and keeps safe Archive IDs for EPUB checking', async () => {
 const f = fixture({ fetcher: async url => {
  const u = new URL(url); assert.match(u.searchParams.get('q'), /ebook_access:public AND public_scan_b:true/);
  return response({ numFound: 4, docs: [
   { key: '/works/OL1W', title: 'Public work', author_name: ['Author'], public_scan_b: true, ebook_access: 'public', ia: ['public-book', '../outside'], cover_i: 12 },
   { key: '/works/OL2W', title: 'Borrow only', public_scan_b: false, ebook_access: 'borrowable', ia: ['borrow'] },
   { key: '/works/OL3W', title: 'No scan', public_scan_b: true, ebook_access: 'public', ia: [] },
  ] });
 } });
 const page = await f.searchCatalog({ source: 'openlibrary', query: 'Public' });
 assert.equal(page.books.length, 1); assert.equal(page.books[0].id, 'openlibrary-OL1W'); assert.deepEqual(page.books[0].archiveIds, ['public-book']);
});

test('Open Library downloads recheck Archive restrictions and do not send borrow-only files to native storage', async () => {
 const book = { id: 'openlibrary-OL1W', source: 'openlibrary', sourceRecordId: 'OL1W', title: 'Public work', author: 'Author', archiveIds: ['public-book'] };
 for (const restricted of [true, false]) {
  const f = fixture({ fetcher: async () => response({ metadata: { 'access-restricted-item': restricted }, files: [{ name: 'book.epub', format: 'EPUB', source: 'original' }] }) });
  if (restricted) { await assert.rejects(f.downloadEpub(book), /unrestricted EPUB/); assert.equal(f.attempts.length, 0); }
  else { await f.downloadEpub(book); assert.equal(f.attempts[0].url, 'https://archive.org/download/public-book/book.epub'); }
 }
});

test('Google Books uses the current reader key and never reuses another reader’s access check', async () => {
 const requests = [];
 const f = fixture({ fetcher: async url => { requests.push(new URL(url)); return response({ totalItems: 1, items: [freeGoogle()] }); } });
 await assert.rejects(f.searchCatalog({ source: 'google' }), /own API key/); assert.equal(requests.length, 0);
 for (const key of [googleKeyA, googleKeyB]) {
  const page = await f.searchCatalog({ source: 'google', query: 'Free', googleBooksKey: key });
  assert.equal(page.books.length, 1); assert.equal(JSON.stringify(page).includes(key), false);
  assert.equal(requests.at(-1).searchParams.get('key'), key); assert.equal(requests.at(-1).searchParams.get('filter'), 'free-ebooks'); assert.equal(requests.at(-1).searchParams.get('download'), 'epub');
 }
 await assert.rejects(f.searchCatalog({ source: 'google' }), /own API key/); assert.equal(requests.length, 2);
});

test('Google excludes previews, purchases, token-only DRM and unrelated download hosts', () => {
 const p = fixture().extras, good = freeGoogle(); assert.ok(p.googleBook(good));
 for (const access of [
  { ...good.accessInfo, viewability: 'PARTIAL' },
  { ...good.accessInfo, publicDomain: false },
  { ...good.accessInfo, epub: { isAvailable: true, acsTokenLink: 'https://books.google.com/book.acsm' } },
  { ...good.accessInfo, epub: { isAvailable: true, downloadLink: 'https://evil.test/book.epub' } },
  { ...good.accessInfo, downloadAccess: { restricted: true } },
 ]) assert.equal(p.googleBook({ ...good, saleInfo: { saleability: 'FOR_SALE' }, accessInfo: access }), null);
});

test('Google rejection errors do not expose a reader’s key or raw API response', async () => {
 const f = fixture({ fetcher: async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'Private '+googleKeyA } }) }) });
 await assert.rejects(f.searchCatalog({ source: 'google', googleBooksKey: googleKeyA }), error => error.kind === 'credentials' && !error.message.includes(googleKeyA));
});

test('Google availability is rechecked before a native EPUB download', async () => {
 const f = fixture({ fetcher: async url => { assert.equal(new URL(url).searchParams.get('key'), googleKeyA); return response(freeGoogle()); } });
 await f.downloadEpub(f.extras.googleBook(freeGoogle()), undefined, undefined, { googleBooksKey: googleKeyA });
 assert.equal(f.attempts[0].url, freeGoogle().accessInfo.epub.downloadLink);
});

test('OAPEN search returns confirmed EPUBs, excluding PDF-only and withdrawn books', async () => {
 const f = fixture({ fetcher: async url => { assert.equal(new URL(url).pathname, '/rest/search'); return response([oapenItem(), oapenItem('pdf-item','book.pdf'), { ...oapenItem('withdrawn'), withdrawn: true }]); } });
 const page = await f.searchCatalog({ source: 'oapen', query: 'research' });
 assert.equal(page.books.length, 1); assert.equal(page.books[0].source, 'oapen'); assert.equal(page.books[0].author, 'An Author');
 assert.equal(page.books[0].description, '<p>Open research.</p>'); assert.equal(page.hasMore, false);
});

test('DOAB resolves an OAPEN file rather than treating directory metadata as an EPUB', async () => {
 const requests = [];
 const item = { uuid: 'doab-1', name: 'An Academic Book', metadata: [{ key: 'dc.identifier.uri', value: 'https://library.oapen.org/handle/20.500.12657/1234' }] };
 const f = fixture({ fetcher: async url => { requests.push(url); return response(url.includes('/rest/handle/') ? oapenItem() : [item]); } });
 const page = await f.searchCatalog({ source: 'doab' });
 assert.equal(page.books.length, 1); assert.equal(page.books[0].source, 'doab');
 assert.match(page.books[0].epubUrl, /^https:\/\/library\.oapen\.org\/rest\/bitstreams\//);
 assert.ok(requests.some(url => url.includes('/rest/handle/20.500.12657/1234')));
 const skipped = fixture({ fetcher: async () => response([{ ...item, metadata: [{ key: 'dc.identifier.uri', value: 'http://127.0.0.1/private.epub' }] }]) });
 assert.equal((await skipped.searchCatalog({ source: 'doab' })).books.length, 0);
});

test('modern DSpace discovery follows original bundles and allows only same-source EPUB content', async () => {
 const item = { uuid: 'modern-1', name: 'Modern research', metadata: {} };
 const f = fixture({ fetcher: async url => {
  if (url.includes('/rest/search')) return { ok: false, status: 404 };
  if (url.includes('/discover/search/objects')) return response({ _embedded: { searchResult: { _embedded: { objects: [{ _embedded: { indexableObject: item } }] }, page: { number: 0, totalPages: 1 } } } });
  if (url.includes('/items/modern-1/bundles')) return response({ _embedded: { bundles: [{ uuid: 'bundle-1', name: 'ORIGINAL' }] } });
  if (url.includes('/bundles/bundle-1/bitstreams')) return response({ _embedded: { bitstreams: [{ uuid: 'bit-1', name: 'research.epub', _links: { content: { href: 'https://library.oapen.org/server/api/core/bitstreams/bit-1/content' } } }] } });
  assert.fail('Unexpected repository request');
 } });
 const page = await f.searchCatalog({ source: 'oapen' }); assert.equal(page.books.length, 1);
 assert.equal(page.books[0].epubUrl, 'https://library.oapen.org/server/api/core/bitstreams/bit-1/content');
});

test('Wikisource discovery excludes non-work namespaces, missing pages and disambiguation', async () => {
 const f = fixture({ fetcher: async () => response({ query: { pages: {
  1: { pageid: 1, ns: 0, title: 'A Transcribed Work', links: [{ ns: 102, title: 'Author:Jane Doe' }] },
  2: { pageid: 2, ns: 102, title: 'Author:Jane Doe' },
  3: { pageid: 3, ns: 0, title: 'A Work/Chapter 1' },
  4: { pageid: 4, ns: 0, title: 'Missing', missing: '' },
  5: { pageid: 5, ns: 0, title: 'Ambiguous', pageprops: { disambiguation: '' } },
 } }, continue: { gsroffset: 20 } }) });
 const page = await f.searchCatalog({ source: 'wikisource' });
 assert.equal(page.books.length, 1); assert.equal(page.books[0].author, 'Jane Doe'); assert.equal(page.hasMore, true);
 const url = new URL(f.extras.wikiEpub(page.books[0])); assert.equal(url.hostname, 'ws-export.wmcloud.org'); assert.equal(url.searchParams.get('page'), 'A Transcribed Work'); assert.equal(url.searchParams.get('format'), 'epub-3');
});

const feed = (title='Free &amp; Clear', extra='') => `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>urn:feedbooks:book:123</id><title>${title}</title><author><name>An Author</name></author><link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="https://www.feedbooks.com/book/123.epub"/></entry>${extra}</feed>`;
test('Feedbooks accepts only free EPUB acquisition links and safe OPDS navigation', async () => {
 const f = fixture({ fetcher: async () => response(feed('Free &amp; Clear', '<entry><title>Buy me</title><link rel="http://opds-spec.org/acquisition/buy" type="application/epub+zip" href="https://www.feedbooks.com/book/456.epub"/></entry>')) });
 const page = await f.searchCatalog({ source: 'feedbooks' }); assert.equal(page.books.length, 1); assert.equal(page.books[0].title, 'Free & Clear');
 await f.downloadEpub(page.books[0]); assert.equal(f.attempts[0].url, 'https://www.feedbooks.com/book/123.epub');
 assert.throws(() => f.extras.feedXml('<!DOCTYPE feed [<!ENTITY x "bad">]><feed/>'));
 assert.throws(() => f.extras.feedbooksPage('<html>Service retired</html>', 'https://www.feedbooks.com'));
});

test('Feedbooks OpenSearch templates and next links preserve query pagination without guessing endpoints', async () => {
 const urls=[];
 const f=fixture({fetcher:async url=>{
  urls.push(url);
  if(url.endsWith('catalog.atom'))return response('<feed><link rel="search" href="https://catalog.feedbooks.com/search.xml"/></feed>');
  if(url.endsWith('search.xml'))return response('<OpenSearchDescription><Url type="application/atom+xml" template="https://catalog.feedbooks.com/search?query={searchTerms}&amp;page={startPage}"/></OpenSearchDescription>');
  return response(feed('Free',new URL(url).searchParams.get('page')==='1'?'<link rel="next" href="https://catalog.feedbooks.com/search?query=poetry&amp;page=2"/>':''));
 }});
 assert.equal((await f.searchCatalog({source:'feedbooks',query:'poetry'})).hasMore,true);
 assert.equal((await f.searchCatalog({source:'feedbooks',query:'poetry',page:2})).hasMore,false);
 assert.ok(urls.at(-1).includes('page=2'));assert.equal(urls.filter(url=>url.endsWith('catalog.atom')).length,1);
});

test('new source catalog mappings survive restart and still reject unknown or malformed IDs', async () => {
 const storage={loadJSON:async()=>({'google-volume_1':'local-1','openlibrary-OL1W':'local-2','wikisource-en-12':'local-3','oapen-item':'local-4','doab-item':'local-5','feedbooks-123':'local-6','unknown-1':'local-7'}),saveJSON:async()=>{}};
 assert.equal(Object.keys(await fixture().loadAdded(storage)).length,6);
});

test('repository catalogs bound follow-up requests even when a server ignores the requested page size', async () => {
 let lookups = 0;
 const f = fixture({ fetcher: async url => {
  if (url.includes('/rest/handle/')) { lookups++; return response(oapenItem()); }
  return response(Array.from({length:25},(_,i)=>({uuid:`doab-${i}`,name:'Book',metadata:[{key:'dc.identifier.uri',value:`https://library.oapen.org/handle/20.500.12657/${i+1}`}]})));
 } });
 const page = await f.searchCatalog({source:'doab'});assert.equal(lookups,20);assert.equal(page.books.length,20);assert.equal(page.hasMore,true);
});
test('a source change cancels repository follow-ups before publishing partial results',async()=>{
 const abort=new AbortController();let started;
 const f=fixture({fetcher:async url=>{
  if(url.includes('/rest/handle/')){started=true;abort.abort();return response(oapenItem());}
  return response([{uuid:'doab-1',name:'Book',metadata:[{key:'dc.identifier.uri',value:'https://library.oapen.org/handle/20.500.12657/1'}]}]);
 }});
 await assert.rejects(f.searchCatalog({source:'doab'},abort.signal),error=>error.name==='AbortError');assert.equal(started,true);
});

test('Feedbooks handles optional OpenSearch parameters with the standard one-based start index',async()=>{
 const f=fixture({fetcher:async url=>{
  if(url.endsWith('catalog.atom'))return response('<feed><link rel="search" href="https://catalog.feedbooks.com/search.xml"/></feed>');
  if(url.endsWith('search.xml'))return response('<OpenSearchDescription><Url type="application/atom+xml" template="https://catalog.feedbooks.com/search?q={searchTerms}&amp;start={startIndex?}"/></OpenSearchDescription>');
  assert.equal(new URL(url).searchParams.get('start'),'1');return response(feed());
 }});
 assert.equal((await f.searchCatalog({source:'feedbooks',query:'classic'})).books.length,1);
});
