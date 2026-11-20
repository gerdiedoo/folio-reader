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
  return { ...load('../src/lib/catalog.ts'), providers: load('../src/lib/catalogProviders.ts'), request: load('../src/lib/catalogRequest.ts').catalogRequest,
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
