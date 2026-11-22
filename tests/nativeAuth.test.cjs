const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { test } = require('node:test'), ts = require('typescript');
const filename = path.resolve(__dirname, '../src/lib/nativeAuth.ts');
const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { createOAuthCallbackHandler, watchNativeAuth } = loaded.exports;
const session = { data: { session: { user: { id: 'account-A' } } }, error: null };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture({ exchange, setSession, scheme = 'folio-dev' } = {}) {
  const calls = [], auth = {
    exchangeCodeForSession: async code => { calls.push(['exchange', code]); return exchange ? exchange(code) : session; },
    setSession: async tokens => { calls.push(['session', tokens]); return setSession ? setSession(tokens) : session; },
  };
  return { calls, handle: createOAuthCallbackHandler(auth, () => scheme + '://auth-callback') };
}

test('Google PKCE callbacks use the installed app scheme and exchange only the returned code', async () => {
  for (const scheme of ['folio', 'folio-dev']) {
    const f = fixture({ scheme });
    assert.equal(await f.handle(scheme + '://auth-callback?code=one%2Btwo'), true);
    assert.deepEqual(f.calls, [['exchange', 'one+two']]);
  }
});

test('browser and warm Linking delivery of one code exchange it once, including repeated callbacks', async () => {
  let finish;
  const f = fixture({ exchange: () => new Promise(resolve => { finish = resolve; }) });
  const first = f.handle('folio-dev://auth-callback?code=same'), second = f.handle('folio-dev://auth-callback?code=same');
  await tick(); assert.equal(f.calls.length, 1); finish(session);
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await f.handle('folio-dev://auth-callback?code=same'), true); assert.equal(f.calls.length, 1);
});

test('unrelated links, other app variants and callback lookalikes cannot establish sessions', async () => {
  const f = fixture();
  for (const value of [null, 'not a URL', 'https://attacker.test/auth-callback?code=x', 'folio://auth-callback?code=x', 'folio-dev://auth-callback/wrong?code=x', 'folio-dev://user@auth-callback?code=x']) {
    assert.equal(await f.handle(value), false);
  }
  assert.equal(f.calls.length, 0);
});

test('provider errors are reported from query or fragment and never exchange a code', async () => {
  const f = fixture();
  for (const separator of ['?', '#']) await assert.rejects(f.handle(`folio-dev://auth-callback${separator}error=access_denied&error_description=Consent%20declined&code=x`), /Consent declined/);
  assert.equal(f.calls.length, 0);
  await assert.rejects(f.handle('folio-dev://auth-callback'), /did not return a session/);
});

test('legacy token callbacks establish a verified session and failed exchanges remain retryable', async () => {
  const implicit = fixture();
  await implicit.handle('folio-dev://auth-callback#access_token=test-access&refresh_token=test-refresh');
  assert.deepEqual(implicit.calls, [['session', { access_token: 'test-access', refresh_token: 'test-refresh' }]]);
  let attempts = 0;
  const f = fixture({ exchange: async () => ++attempts === 1 ? { data: { session: null }, error: Error('Offline') } : session });
  await assert.rejects(f.handle('folio-dev://auth-callback?code=x'), /Offline/);
  await f.handle('folio-dev://auth-callback?code=x'); assert.equal(attempts, 2);
  const missing = fixture({ exchange: async () => ({ data: { session: null }, error: null }) });
  await assert.rejects(missing.handle('folio-dev://auth-callback?code=x'), /saved session/);
});

function lifecycle(callback) {
  let finish, stateListener, linkListener;
  const calls = [], errors = [], removed = [];
  const auth = { startAutoRefresh: async () => calls.push('start'), stopAutoRefresh: async () => calls.push('stop') };
  const appState = { currentState: 'active', addEventListener(_type, listener) { stateListener = listener; return { remove: () => removed.push('state') }; } };
  const linking = { getInitialURL: () => new Promise(resolve => { finish = resolve; }),
    addEventListener(_type, listener) { linkListener = listener; return { remove: () => removed.push('link') }; } };
  const stop = watchNativeAuth(auth, { appState, linking }, callback, error => errors.push(error.message));
  return { stop, calls, errors, removed, initial: url => finish(url), change: state => stateListener(state), link: url => linkListener({ url }) };
}

test('cold-start callbacks exchange after restart and session refresh follows foreground/background', async () => {
  const f = fixture(), l = lifecycle(f.handle);
  l.initial('folio-dev://auth-callback?code=cold'); await tick();
  assert.deepEqual(f.calls, [['exchange', 'cold']]); assert.deepEqual(l.calls, ['start']);
  l.change('background'); await tick(); l.change('active'); await tick();
  assert.deepEqual(l.calls, ['start', 'stop', 'start']); l.stop(); await tick();
  assert.deepEqual(l.removed, ['state', 'link']); assert.equal(l.calls.at(-1), 'stop');
});

test('newer warm callbacks win over a stale initial URL and unmounted events cannot act', async () => {
  const seen = [], l = lifecycle(async url => { seen.push(url); return true; });
  l.link('new'); l.initial('old'); await tick(); assert.deepEqual(seen, ['new']);
  l.stop(); l.link('late'); await tick(); assert.deepEqual(seen, ['new']);
});

test('callback failures are surfaced while mounted and ignored after the account boundary unmounts', async () => {
  let fail;
  const l = lifecycle(() => new Promise((_resolve, reject) => { fail = reject; }));
  l.link('callback'); fail(Error('Provider unavailable')); await tick(); assert.deepEqual(l.errors, ['Provider unavailable']);
  l.link('another'); l.stop(); fail(Error('Late error')); await tick(); assert.deepEqual(l.errors, ['Provider unavailable']);
});
