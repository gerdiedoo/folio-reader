const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
function compiled(name) {
  return ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
}
const helper = {};
vm.runInNewContext(compiled('bookImport'), { exports: helper, Error });
const { createImportCommitter, ImportStorageError } = helper;
const book = id => ({ id, title: id, coverUrl: '', fileLocation: `file:///docs/folio/books/${id}.epub` });
const pages = [{ paragraph1: 'Saved text' }];
function gate() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function device() {
  const files = new Map(), directories = new Set(), deleted = [], failingDeletes = new Set();
  const control = { failAt: '', failingDeletes, files, deleted };
  const uri = parts => parts.map(p => typeof p === 'string' ? p : p.uri).join('/').replace(/\/$/, '');
  class Directory {
    constructor(...parts) { this.uri = uri(parts); }
    get exists() { return directories.has(this.uri); }
    create() { if (control.failAt === 'mkdir') throw Error('Directory unavailable'); directories.add(this.uri); }
  }
  class File {
    constructor(...parts) { this.uri = uri(parts); }
    get exists() { return files.has(this.uri); }
    create() { files.set(this.uri, ''); }
    write(data) {
      files.set(this.uri, control.failAt === 'write' ? 'partial' : data);
      if (control.failAt === 'write') throw Error('Disk full');
    }
    copy(destination) {
      files.set(destination.uri, control.failAt === 'copy' ? 'partial' : files.get(this.uri));
      if (control.failAt === 'copy') throw Error('Copy failed');
    }
    delete() {
      deleted.push(this.uri);
      if (failingDeletes.has(this.uri)) throw Error('Delete failed');
      files.delete(this.uri);
    }
    async text() { return files.get(this.uri); }
  }
  const storage = new Map();
  const asyncStorage = {
    async getItem(key) { return storage.get(key) ?? null; },
    async setItem(key, value) { storage.set(key, value); },
  };
  const exports = {};
  vm.runInNewContext(compiled('localStore'), {
    exports, Error, console: { warn() {} },
    require(name) {
      if (name === '@react-native-async-storage/async-storage') return asyncStorage;
      if (name === 'expo-file-system') return { File, Directory, Paths: { document: 'file:///docs' } };
      if (name === './bookImport') return helper;
      throw Error('Unexpected dependency ' + name);
    },
  });
  return { ...control, store: exports, asyncStorage, storage, setFailure(value) { control.failAt = value; } };
}

test('filesystem adapter page writes and original EPUB copies return only after storing the data', async () => {
  const d = device();
  d.files.set('file:///picked.epub', 'original EPUB');
  assert.equal(d.store.persistBookFile('file:///picked.epub', 'new'), 'file:///docs/folio/books/new.epub');
  d.store.savePages('new', pages);
  assert.equal(d.files.get('file:///docs/folio/books/new.epub'), 'original EPUB');
  assert.deepEqual(JSON.parse(d.files.get('file:///docs/folio/pages/new.json')), pages);
});

for (const failure of ['mkdir', 'write']) {
  test(`page ${failure} failure is surfaced instead of swallowed`, () => {
    const d = device(); d.setFailure(failure);
    assert.throws(() => d.store.savePages('new', pages), error => error instanceof ImportStorageError && /reading text/.test(error.message));
  });
}

test('original EPUB copy failure is surfaced instead of returning an absent file location', () => {
  const d = device(); d.setFailure('copy');
  assert.throws(() => d.store.persistBookFile('file:///picked.epub', 'new'), /Could not save the EPUB file/);
});

test('rollback removes partial import data and owned cover, without deleting the chosen source or other books', () => {
  const d = device();
  const owned = ['file:///docs/folio/pages/new.json', 'file:///docs/folio/books/new.epub', 'file:///docs/folio/covers/new.png'];
  const protectedFiles = ['file:///picked.epub', 'file:///docs/folio/books/other.epub'];
  for (const uri of [...owned, ...protectedFiles]) d.files.set(uri, 'content');
  assert.equal(d.store.removeBookFiles('new', owned[2]), true);
  for (const uri of owned) assert.ok(!d.files.has(uri));
  for (const uri of protectedFiles) assert.ok(d.files.has(uri));
});

test('rollback tries remaining files after a delete failure and reports incomplete cleanup', () => {
  const d = device();
  for (const uri of ['file:///docs/folio/pages/new.json', 'file:///docs/folio/books/new.epub']) d.files.set(uri, 'partial');
  d.failingDeletes.add('file:///docs/folio/pages/new.json');
  assert.equal(d.store.removeBookFiles('new'), false);
  assert.ok(!d.files.has('file:///docs/folio/books/new.epub'));
});

test('rollback never removes an external cover URL or a different book cover', () => {
  const d = device();
  const external = 'file:///picked-cover.png', other = 'file:///docs/folio/covers/other.png';
  d.files.set(external, 'original'); d.files.set(other, 'other');
  d.store.removeBookFiles('new', external); d.store.removeBookFiles('new', other);
  assert.ok(d.files.has(external)); assert.ok(d.files.has(other));
});

test('strict metadata persistence rejects errors while the legacy best-effort helper stays compatible', async () => {
  const d = device();
  d.asyncStorage.setItem = async () => { throw Error('Storage unavailable'); };
  await assert.rejects(d.store.saveJSONStrict('books', [book('new')]), /Storage unavailable/);
  await d.store.saveJSON('settings', { theme: 'white' });
});

test('same-key writes execute in order and a failed write does not poison the queue', async () => {
  const d = device(), paused = gate(), calls = [];
  d.asyncStorage.setItem = async (key, value) => {
    calls.push(value);
    if (value === '"old"') { await paused.promise; throw Error('first write failed'); }
    d.storage.set(key, value);
  };
  const first = d.store.saveJSONStrict('books', 'old');
  const second = d.store.saveJSONStrict('books', 'new');
  const outcome = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['"old"']);
  paused.resolve();
  const results = await outcome;
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  assert.equal(d.storage.get('folio.v1.books'), '"new"');
});

test('the import stays pending until both pages and library entry are durable', async () => {
  const paused = gate(), events = [];
  const commit = createImportCommitter({
    savePages() { events.push('pages'); },
    async saveLibraryEntry() { events.push('library'); await paused.promise; },
    removeFiles() { events.push('cleanup'); return true; },
  });
  let done = false;
  const importing = commit(book('new'), pages).then(() => { done = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['pages', 'library']); assert.equal(done, false);
  paused.resolve(); await importing; assert.equal(done, true);
});

for (const failure of ['pages', 'metadata']) {
  test(`${failure} failure rejects the import and rolls back its files`, async () => {
    const events = [];
    const commit = createImportCommitter({
      savePages() { events.push('pages'); if (failure === 'pages') throw Error('full'); },
      async saveLibraryEntry() { events.push('metadata'); throw Error('full'); },
      removeFiles(id) { events.push('cleanup:' + id); return true; },
    });
    await assert.rejects(commit(book('new'), pages), /Check available storage/);
    assert.deepEqual(events, failure === 'pages' ? ['pages', 'cleanup:new'] : ['pages', 'metadata', 'cleanup:new']);
  });
}

test('missing original file and empty reading data are rejected before registration', async () => {
  let registered = false;
  const commit = createImportCommitter({ savePages() {}, async saveLibraryEntry() { registered = true; }, removeFiles() { return true; } });
  await assert.rejects(commit({ ...book('new'), fileLocation: undefined }, pages));
  await assert.rejects(commit(book('new'), []));
  assert.equal(registered, false);
});

test('rollback failure is included in the import error', async () => {
  const commit = createImportCommitter({ savePages() { throw Error('full'); }, async saveLibraryEntry() {}, removeFiles() { return false; } });
  await assert.rejects(commit(book('new'), pages), /Some incomplete import files could not be removed/);
});

test('consecutive imports commit separately and a failed import can be retried', async () => {
  const entries = [], removed = [];
  let fail = true;
  const commit = createImportCommitter({
    savePages(id) { if (id === 'first' && fail) throw Error('full'); },
    async saveLibraryEntry(item) { entries.push(item.id); },
    removeFiles(id) { removed.push(id); return true; },
  });
  const results = await Promise.allSettled([commit(book('first'), pages), commit(book('second'), pages)]);
  assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'fulfilled');
  fail = false; await commit(book('first'), pages);
  assert.deepEqual(entries, ['second', 'first']); assert.deepEqual(removed, ['first']);
});

test('strict library reads distinguish missing storage from unreadable or corrupt data', async () => {
  const d = device();
  assert.equal(await d.store.loadJSONStrict('books'), null);
  d.storage.set('folio.v1.books', '{');
  await assert.rejects(d.store.loadJSONStrict('books'));
  assert.equal(d.storage.get('folio.v1.books'), '{');
  d.asyncStorage.getItem = async () => { throw Error('Read unavailable'); };
  await assert.rejects(d.store.loadJSONStrict('books'), /Read unavailable/);
});
