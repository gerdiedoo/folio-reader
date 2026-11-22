const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const factory = require('../app.config');
const base = require('../app.json').expo;
const profiles = require('../eas.json').build;
const source = fs.readFileSync(path.join(__dirname, '../src/lib/backendConfig.ts'), 'utf8');
const exportsObj = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: exportsObj, URL });
const { selectBackend } = exportsObj;
const production = { url: 'https://production.example.com', key: 'production-publishable-key' };
const development = { url: 'https://test.example.com', key: 'test-publishable-key' };

function config(env) {
  const keys = ['EXPO_PUBLIC_APP_VARIANT', 'EAS_BUILD_PROFILE', 'EXPO_PUBLIC_DEV_SUPABASE_URL', 'EXPO_PUBLIC_DEV_SUPABASE_KEY', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return factory({ config: structuredClone(base) });
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('default and production identities remain unchanged', () => {
  const expected = { ...base, plugins: [...base.plugins, './plugins/withReaderStorage'] };
  assert.deepEqual(config({}), expected);
  assert.deepEqual(config({ EXPO_PUBLIC_APP_VARIANT: 'production' }), expected);
});

test('production builds require the main backend and cannot bundle the Folio Dev project', () => {
  const env = { EXPO_PUBLIC_APP_VARIANT: 'production', EAS_BUILD_PROFILE: 'production' };
  assert.throws(() => config(env), /Configure EXPO_PUBLIC_SUPABASE/);
  const credentials = { EXPO_PUBLIC_SUPABASE_URL: production.url, EXPO_PUBLIC_SUPABASE_KEY: production.key };
  assert.equal(config({ ...env, ...credentials }).scheme, 'folio');
  assert.throws(() => config({ ...env, ...credentials, EXPO_PUBLIC_SUPABASE_URL: 'https://ntdhzgjkmfohgjzymdgh.supabase.co' }), /main Folio app/);
  assert.throws(() => config({ ...env, ...credentials, EXPO_PUBLIC_SUPABASE_URL: 'http://production.example.com' }), /HTTPS/);
  assert.ok(config({ ...env, ...credentials }).plugins.includes('./plugins/withReaderStorage'));
});

test('main APK config retains the main package, callback and production backend requirement', () => {
  const env = { EXPO_PUBLIC_APP_VARIANT: 'production', EAS_BUILD_PROFILE: 'main-apk' };
  assert.throws(() => config(env), /Configure EXPO_PUBLIC_SUPABASE/);
  const actual = config({ ...env, EXPO_PUBLIC_SUPABASE_URL: production.url, EXPO_PUBLIC_SUPABASE_KEY: production.key });
  assert.equal(actual.name, 'Folio'); assert.equal(actual.android.package, 'com.folio.reader'); assert.equal(actual.scheme, 'folio');
});

test('Folio Dev installs independently and owns a separate OAuth scheme', () => {
  const result = config({ EXPO_PUBLIC_APP_VARIANT: 'development' });
  assert.equal(result.name, 'Folio Dev');
  assert.equal(result.android.package, 'com.folio.reader.dev');
  assert.equal(result.ios.bundleIdentifier, 'com.folio.reader.dev');
  assert.equal(result.scheme, 'folio-dev');
  assert.deepEqual(result.extra, base.extra);
});

test('dev-preview is a standalone APK using the EAS development environment', () => {
  assert.equal(profiles['dev-preview'].environment, 'development');
  assert.equal(profiles['dev-preview'].env.EXPO_PUBLIC_APP_VARIANT, 'development');
  assert.equal(profiles['dev-preview'].android.buildType, 'apk');
  assert.notEqual(profiles['dev-preview'].developmentClient, true);
});

test('test APK requires dedicated backend values', () => {
  const env = { EXPO_PUBLIC_APP_VARIANT: 'development', EAS_BUILD_PROFILE: 'dev-preview' };
  assert.throws(() => config(env), /Configure EXPO_PUBLIC_DEV/);
  assert.throws(() => config({ ...env, EXPO_PUBLIC_DEV_SUPABASE_URL: development.url }), /Configure EXPO_PUBLIC_DEV/);
  assert.equal(config({ ...env, EXPO_PUBLIC_DEV_SUPABASE_URL: development.url, EXPO_PUBLIC_DEV_SUPABASE_KEY: development.key }).name, 'Folio Dev');
});

test('unknown variants are rejected', () => {
  assert.throws(() => config({ EXPO_PUBLIC_APP_VARIANT: 'develpment' }), /must be/);
  assert.throws(() => selectBackend('develpment', production, development), /Unknown/);
});

test('development selects only the test backend while production stays unchanged', () => {
  assert.equal(selectBackend('development', production, development), development);
  assert.equal(selectBackend(undefined, production, development), production);
  assert.equal(selectBackend('production', production, development), production);
});

test('missing development values never fall back to production', () => {
  const empty = { url: '', key: '' };
  assert.equal(selectBackend('development', production, empty), empty);
});

test('development refuses both the known main backend and any configured production host', () => {
  for (const url of [production.url + '/', 'https://radjkztdsanbnacpvmnk.supabase.co']) {
    assert.throws(() => selectBackend('development', production, { ...development, url }), /separate Supabase/);
  }
});

test('development refuses insecure and malformed endpoints', () => {
  for (const url of ['http://test.example.com', 'not a URL']) {
    assert.throws(() => selectBackend('development', production, { ...development, url }));
  }
});
