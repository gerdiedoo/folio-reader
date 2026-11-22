const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { test } = require('node:test'), ts = require('typescript');
function fixture({ configured = true, browser, oauth, exchange } = {}) {
  const calls = [], session = { data: { session: { user: { id: 'reader' } } }, error: null };
  const auth = {
    signInWithOAuth: async options => { calls.push(['oauth', options]); return oauth ?? { data: { url: 'https://test.supabase.co/auth/v1/authorize?provider=google' }, error: null }; },
    exchangeCodeForSession: async code => { calls.push(['exchange', code]); return exchange ?? session; },
    setSession: async () => session, signOut: async () => ({ error: null }),
  };
  const mocks = {
    'react-native-url-polyfill/auto': {}, '@react-native-async-storage/async-storage': {},
    '@supabase/supabase-js': { createClient: (url, key, options) => { calls.push(['client', options]); return { auth }; } },
    'expo-linking': { createURL: () => 'folio://auth-callback' },
    'expo-web-browser': { maybeCompleteAuthSession() {}, openAuthSessionAsync: async (...args) => { calls.push(['browser', ...args]); return typeof browser === 'function' ? browser() : browser ?? { type: 'success', url: 'folio://auth-callback?code=pkce' }; } },
    './backendConfig': { selectBackend: () => ({ url: configured ? 'https://test.supabase.co' : '', key: configured ? 'test-public-key' : '' }) },
    './userProfile': {}, './schemaSql': {}, './cloudAccount': {},
  };
  function load(name) {
    const filename = path.resolve(__dirname, '../src/lib', name + '.ts');
    const loaded = new Module(filename, module); loaded.filename = filename; loaded.paths = module.paths;
    loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : id.startsWith('.') ? load(id.slice(2)) : require(id);
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
    return loaded.exports;
  }
  return { calls, ...load('supabase') };
}

test('Google sign-in opens the provider with the app callback and PKCE session persistence', async () => {
  const f = fixture(); await f.signInWithGoogle();
  const options = f.calls.find(c => c[0] === 'client')[1];
  assert.equal(options.auth.flowType, 'pkce'); assert.equal(options.auth.persistSession, true);
  assert.deepEqual(f.calls.find(c => c[0] === 'oauth')[1], { provider: 'google', options: {
    redirectTo: 'folio://auth-callback', skipBrowserRedirect: true, queryParams: { access_type: 'offline', prompt: 'consent select_account' },
  } });
  assert.equal(f.calls.find(c => c[0] === 'browser')[2], 'folio://auth-callback');
  assert.deepEqual(f.calls.find(c => c[0] === 'exchange'), ['exchange', 'pkce']);
});

test('cancelling Google does not exchange or claim a session; locked browsers report an actionable error', async () => {
  for (const type of ['cancel', 'dismiss']) {
    const f = fixture({ browser: { type } }); await f.signInWithGoogle();
    assert.equal(f.calls.some(c => c[0] === 'exchange'), false);
  }
  const locked = fixture({ browser: { type: 'locked' } }); await assert.rejects(locked.signInWithGoogle(), /Close any other sign-in window/);
});

test('configuration, provider and exchange failures cannot report successful Google sign-in', async () => {
  const missing = fixture({ configured: false }); await assert.rejects(missing.signInWithGoogle(), /not configured/);
  assert.equal(missing.calls.some(c => c[0] === 'browser'), false);
  const provider = fixture({ oauth: { data: null, error: Error('Google provider disabled') } });
  await assert.rejects(provider.signInWithGoogle(), /provider disabled/);
  const exchange = fixture({ exchange: { data: { session: null }, error: Error('Code exchange failed') } });
  await assert.rejects(exchange.signInWithGoogle(), /Code exchange failed/);
});

test('concurrent sign-ins cannot overwrite the PKCE verifier and a completed browser can be reopened', async () => {
  let finish;
  const f = fixture({ browser: () => new Promise(resolve => { finish = resolve; }) });
  const first = f.signInWithGoogle(); await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.signInWithGoogle(), /already open/);
  finish({ type: 'cancel' }); await first;
  const again = f.signInWithGoogle(); await new Promise(resolve => setImmediate(resolve));
  finish({ type: 'cancel' }); await again;
  assert.equal(f.calls.filter(c => c[0] === 'oauth').length, 2);
});
