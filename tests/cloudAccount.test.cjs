const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
function load(name) {
  return require('./loadTypeScript.cjs').loadTypeScript(path.resolve(__dirname, '../src/lib', name + '.ts'));
}
const { createAccountRepository } = load('cloudAccount');
const { watchAccountSession } = load('accountSession');
const { SUPABASE_SQL_SCHEMA } = load('schemaSql');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const reads = ['fetchBooksFromSupabase','fetchHighlightsFromSupabase','fetchLexiconFromSupabase','fetchReadingGoalFromSupabase','fetchReadingSettingsFromSupabase'];
const payloads = {
  upsertBookToSupabase: { id: 'same', title: 'Book', author: 'Author', coverUrl: '', user_id: B },
  upsertHighlightToSupabase: { id: 'same', bookId: 'same', text: 'Private quote', user_id: B },
  upsertLexiconToSupabase: { id: 'same', word: 'Private word', user_id: B },
  upsertReadingGoalToSupabase: { dailyTargetMinutes: 30, user_id: B },
  upsertReadingSettingsToSupabase: { font: 'Literata', user_id: B },
};
function client() {
  const state = { user: A, queries: [], data: null, error: null, authError: null, acknowledgeBackup: true };
  return {
    state,
    auth: { async getSession() { return { data: { session: state.user ? { user: { id: state.user } } : null }, error: state.authError }; } },
    from(table) {
      const query = { table, filters: [], operation: '' }; state.queries.push(query);
      const builder = {
        select(columns) { if (!query.operation) query.operation = 'select'; query.columns = columns; return builder; },
        eq(key, value) { query.filters.push([key, value]); return builder; },
        upsert(value, options) { query.operation = 'upsert'; query.value = value; query.options = options; return builder; },
        delete() { query.operation = 'delete'; return builder; },
        order() { return builder; }, limit() { return builder; },
        single() { return builder; }, maybeSingle() { return builder; },
        then(resolve, reject) { return Promise.resolve({ data: state.data ?? (table === 'library_backups' && query.operation === 'upsert' && state.acknowledgeBackup ? { user_id: query.value.user_id } : null), error: state.error }).then(resolve, reject); },
      };
      return builder;
    },
  };
}

test('guests make no cloud data requests, including empty sync and backup paths', async () => {
  const c = client(), repo = createAccountRepository(c, null);
  for (const read of reads) assert.equal(await repo[read](), null);
  for (const [name, value] of Object.entries(payloads)) assert.equal(await repo[name](value), false);
  assert.equal(await repo.deleteBookFromSupabase('same'), false);
  assert.equal(await repo.deleteHighlightFromSupabase('same'), false);
  assert.equal((await repo.testSupabaseConnection()).connected, false);
  await assert.rejects(repo.fetchLibraryBackup(A));
  await assert.rejects(repo.saveLibraryBackup(A, []));
  assert.equal(c.state.queries.length, 0);
});

test('every private read uses its captured owner and private tables', async () => {
  const c = client(), repo = createAccountRepository(c, A);
  for (const read of reads) await repo[read]();
  assert.equal(c.state.queries.length, 5);
  for (const q of c.state.queries) {
    assert.ok(q.table.startsWith('folio_'));
    assert.ok(q.filters.some(([key, value]) => key === 'user_id' && value === A));
  }
});

for (const [name, payload] of Object.entries(payloads)) {
  test(`${name} ignores forged payload ownership and uses a per-account conflict key`, async () => {
    const c = client();
    assert.equal(await createAccountRepository(c, A)[name](payload), true);
    const q = c.state.queries[0];
    assert.equal(q.value.user_id, A);
    assert.equal(q.options.onConflict, 'user_id,id');
    assert.ok(q.table.startsWith('folio_'));
  });
}

test('book and annotation deletion apply an owner filter to every operation', async () => {
  const c = client(), repo = createAccountRepository(c, A);
  await repo.deleteBookFromSupabase('same'); await repo.deleteHighlightFromSupabase('same');
  assert.equal(c.state.queries.length, 4);
  for (const q of c.state.queries) {
    assert.equal(q.operation, 'delete');
    assert.ok(q.filters.some(([key, value]) => key === 'user_id' && value === A));
  }
});

test('late A callbacks after sign-out or sign-in as B cannot access cloud data', async () => {
  const c = client(), staleA = createAccountRepository(c, A);
  for (const next of [null, B]) {
    c.state.user = next;
    for (const read of reads) assert.equal(await staleA[read](), null);
    for (const [name, payload] of Object.entries(payloads)) assert.equal(await staleA[name](payload), false);
    assert.equal(await staleA.deleteBookFromSupabase('same'), false);
    assert.equal(await staleA.deleteHighlightFromSupabase('same'), false);
    await assert.rejects(staleA.saveLibraryBackup(A, []));
    await assert.rejects(staleA.fetchLibraryBackup(A));
  }
  assert.equal(c.state.queries.length, 0);
  await createAccountRepository(c, B).upsertBookToSupabase(payloads.upsertBookToSupabase);
  assert.equal(c.state.queries[0].value.user_id, B);
});

test('backup APIs cannot be pointed at a different account', async () => {
  const c = client(), repo = createAccountRepository(c, A);
  await assert.rejects(repo.saveLibraryBackup(B, [])); await assert.rejects(repo.fetchLibraryBackup(B));
  assert.equal(c.state.queries.length, 0);
  await repo.saveLibraryBackup(A, []); await repo.fetchLibraryBackup(A);
  assert.equal(c.state.queries[0].value.user_id, A);
  assert.deepEqual(c.state.queries[1].filters, [['user_id', A]]);
});

test('backup saves require a server acknowledgement for the captured owner', async () => {
  const c = client(), repo = createAccountRepository(c, A);
  const books = [{ title: 'A book', author: 'An author', gutenbergId: 1342, currentPage: 3 }];
  await repo.saveLibraryBackup(A, books);
  assert.deepEqual(c.state.queries[0].value.books, books);
  assert.equal(c.state.queries[0].columns, 'user_id');
  c.state.acknowledgeBackup = false;
  await assert.rejects(repo.saveLibraryBackup(A, books), /did not confirm/);
  c.state.data = { user_id: B };
  await assert.rejects(repo.saveLibraryBackup(A, books), /did not confirm/);
  c.state.error = { message: 'permission denied' };
  await assert.rejects(repo.saveLibraryBackup(A, books), /permission denied/);
});

test('missing backups and valid empty backups differ from unreadable backups; invalid entries are never silently dropped', async () => {
  const c = client(), repo = createAccountRepository(c, A);
  assert.equal(await repo.fetchLibraryBackup(A), null);
  c.state.data = { books: [] }; assert.deepEqual(await repo.fetchLibraryBackup(A), []);
  for (const books of [null, 'unreadable', [{ title: 'Good', author: 'Author' }, { title: 'Missing author' }]]) {
    c.state.data = { books }; await assert.rejects(repo.fetchLibraryBackup(A), /read safely/);
  }
  c.state.data = { books: [{ title: 'Good', author: 'Author', gutenbergId: 1342, progressPercent: 30 }] };
  assert.deepEqual(await repo.fetchLibraryBackup(A), c.state.data.books);
});

test('a failed connection is not reported as connected', async () => {
  const c = client(); c.state.error = { code: '42501', message: 'permission denied' };
  assert.equal((await createAccountRepository(c, A).testSupabaseConnection()).connected, false);
});

test('the app SQL copy matches the reviewed canonical migration', () => {
  assert.equal(SUPABASE_SQL_SCHEMA, fs.readFileSync(path.resolve(__dirname, '../supabase/schema.sql'), 'utf8'));
});

function sessionHarness() {
  let finish, event;
  const initial = new Promise(resolve => { finish = resolve; });
  const state = { sessions: [], errors: 0, unsubscribed: false };
  const auth = {
    onAuthStateChange(callback) { event = callback; return { data: { subscription: { unsubscribe() { state.unsubscribed = true; } } } }; },
    getSession() { return initial; },
  };
  const stop = watchAccountSession(auth, session => state.sessions.push(session?.user.id ?? 'guest'), () => state.errors++);
  return { state, stop, event: (kind, id) => event(kind, id ? { user: { id } } : null), finish };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('a late initial session cannot restore A after a newer sign-out', async () => {
  const h = sessionHarness(); h.event('SIGNED_OUT', null);
  h.finish({ data: { session: { user: { id: A } } }, error: null }); await tick();
  assert.deepEqual(h.state.sessions, ['guest']); h.stop();
});
test('a newer B sign-in wins over the initial A session', async () => {
  const h = sessionHarness(); h.event('SIGNED_IN', B);
  h.finish({ data: { session: { user: { id: A } } }, error: null }); await tick();
  assert.deepEqual(h.state.sessions, [B]); h.stop();
});
test('session read errors do not silently select Guest or expose another account', async () => {
  const h = sessionHarness(); h.finish({ data: { session: null }, error: Error('unavailable') }); await tick();
  assert.equal(h.state.errors, 1); assert.deepEqual(h.state.sessions, []); h.stop();
});
test('unmounted session listeners ignore late reads and events', async () => {
  const h = sessionHarness(); h.stop(); h.event('SIGNED_IN', B);
  h.finish({ data: { session: { user: { id: A } } }, error: null }); await tick();
  assert.equal(h.state.unsubscribed, true); assert.deepEqual(h.state.sessions, []);
});

test('cloud upserts never upload device-local cover file paths', async () => {
  const c = client();
  await createAccountRepository(c, A).upsertBookToSupabase({ ...payloads.upsertBookToSupabase, coverUrl: 'file:///private/account-A/cover.png' });
  assert.equal(c.state.queries[0].value.cover_url, '');
});


test('remote file cover URLs never become trusted local paths', async () => {
  const c = client();
  c.state.data = [{ id: 'same', title: 'Test', author: 'Author', cover_url: 'file:///private/account-A/cover.png' }];
  const items = await createAccountRepository(c, A).fetchBooksFromSupabase();
  assert.equal(items[0].coverUrl, '');
});

test('a successful initial session opens the known account or known Guest space', async () => {
  for (const id of [A, null]) {
    const h = sessionHarness();
    h.finish({ data: { session: id ? { user: { id } } : null }, error: null }); await tick();
    assert.deepEqual(h.state.sessions, [id ?? 'guest']); assert.equal(h.state.errors, 0); h.stop();
  }
});

test('profile metadata cannot change account identity or reference another account local files', () => {
  const { toUserProfile } = load('userProfile');
  const profile = toUserProfile({ id: A, email: 'test@example.com', user_metadata: { id: B, avatar_url: 'file:///private/account-B/cover.png' } });
  assert.equal(profile.id, A); assert.equal(profile.avatarUrl, undefined);
  assert.equal(toUserProfile({ id: A, user_metadata: { picture: 'https://example.com/avatar.png' } }).avatarUrl, 'https://example.com/avatar.png');
});

test('account book-list backup round trips an edition checkpoint while dropping device-local fields', async () => {
 const c = client(), repo = createAccountRepository(c, A);
 const edition = 'a'.repeat(64), anchor = { version: 1, edition, href: 'EPUB/body.xhtml', path: 'body/2/0', wordOffset: 3 };
 const entry = { title: 'Book', author: 'Author', currentPage: 12, documentFingerprint: edition,
  readingPosition: { pageNumber: 12, wordOffset: 8, anchor, scroll: { offset: 240, layout: 'private-device' } }, fileLocation: 'file:///private/book.epub' };
 await repo.saveLibraryBackup(A, [entry]);
 const saved = c.state.queries[0].value.books;
 assert.equal(saved[0].documentFingerprint, edition);
 assert.deepEqual(saved[0].readingPosition, { pageNumber: 12, wordOffset: 8, anchor });
 assert.equal(saved[0].fileLocation, undefined);
 c.state.data = { books: saved };
 assert.deepEqual(await repo.fetchLibraryBackup(A), saved);
 c.state.data = { books: [{ ...saved[0], documentFingerprint: 'bad' }] };
 await assert.rejects(repo.fetchLibraryBackup(A), /read safely/);
 const writesBefore = c.state.queries.length;
 await assert.rejects(repo.saveLibraryBackup(A, c.state.data.books), /read safely/);
 assert.equal(c.state.queries.length, writesBefore);
});
