const assert = require('node:assert/strict');
const fs = require('node:fs');
const { test } = require('node:test');
const yaml = require('yaml');
const { mainBuildConfiguration, findExistingMainSettings, KNOWN_MAIN_HOST } = require('../scripts/build-main-apk.cjs');
const profiles = require('../eas.json').build;
const env = {
  RUNNER_TEMP: '/tmp/folio-main-test', EXPO_PUBLIC_APP_VARIANT: 'development',
  EXPO_PUBLIC_SUPABASE_URL: 'https://main-project.supabase.co',
  EXPO_PUBLIC_SUPABASE_KEY: 'sb_publishable_test_client_value',
};

test('main APK inherits production settings, uses an installable APK and the existing remote signing credentials', () => {
  assert.equal(profiles['main-apk'].extends, 'production');
  assert.equal(profiles.production.environment, 'production');
  assert.equal(profiles.production.env.EXPO_PUBLIC_APP_VARIANT, 'production');
  assert.equal(profiles['main-apk'].android.buildType, 'apk');
  assert.equal(profiles['main-apk'].credentialsSource, 'remote');
  const actual = mainBuildConfiguration(env);
  assert.deepEqual(actual.args, ['build', '--platform', 'android', '--profile', 'main-apk', '--non-interactive', '--local', '--output', '/tmp/folio-main-test/folio.apk']);
  assert.equal(actual.env.EXPO_PUBLIC_APP_VARIANT, 'production');
  assert.equal(actual.env.EAS_BUILD_PROFILE, 'main-apk');
  assert.equal(env.EXPO_PUBLIC_APP_VARIANT, 'development');
});

test('main build cannot silently substitute Dev, an insecure endpoint or absent production values', () => {
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY', 'RUNNER_TEMP']) {
    assert.throws(() => mainBuildConfiguration({ ...env, [name]: '' }));
  }
  for (const url of [profiles['dev-preview'].env.EXPO_PUBLIC_DEV_SUPABASE_URL, 'http://main-project.supabase.co', 'https://user:password@main-project.supabase.co', 'https://main-project.supabase.co/extra']) {
    assert.throws(() => mainBuildConfiguration({ ...env, EXPO_PUBLIC_SUPABASE_URL: url }));
  }
});

test('only public client key types can enter the main bundle and errors do not expose rejected key values', () => {
  const jwt = role => `e30.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test-signature`;
  assert.equal(mainBuildConfiguration({ ...env, EXPO_PUBLIC_SUPABASE_KEY: jwt('anon') }).env.EXPO_PUBLIC_SUPABASE_KEY, jwt('anon'));
  for (const value of ['sb_secret_test_should_not_be_printed', jwt('service_role'), 'invalid-key']) {
    assert.throws(() => mainBuildConfiguration({ ...env, EXPO_PUBLIC_SUPABASE_KEY: value }), error => !error.message.includes(value));
  }
});

test('main workflow loads Expo production values before enabling the guarded build profile and verifies its package', () => {
  const workflow = yaml.parse(fs.readFileSync(require('node:path').join(__dirname, '../.github/workflows/build-folio-main.yml'), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.jobs.build.env.EXPO_PUBLIC_APP_VARIANT, 'production');
  assert.equal(workflow.jobs.build.env.EAS_BUILD_PROFILE, undefined);
  const steps = workflow.jobs.build.steps;
  const compile = steps.find(step => step.name?.startsWith('Build signed main APK'));
  assert.match(compile.run, /eas env:exec production 'node scripts\/build-main-apk.cjs' --non-interactive/);
  assert.match(steps.find(step => step.name === 'Verify main package and APK signature').run, /com\.folio\.reader/);
  assert.equal(workflow.jobs['android-smoke'].env.FOLIO_ANDROID_PACKAGE, 'com.folio.reader');
});

test('missing production settings can reuse only an existing public client pair for the known main project', () => {
  const calls = [], missing = { RUNNER_TEMP: '/tmp/folio-main-test' };
  const candidate = { url: `https://${KNOWN_MAIN_HOST}`, key: env.EXPO_PUBLIC_SUPABASE_KEY };
  const execute = (_command, args) => {
    calls.push(args);
    return { status: 0, stdout: 'FOLIO_MAIN_CLIENT=' + JSON.stringify(candidate) };
  };
  const actual = findExistingMainSettings(missing, execute);
  assert.equal(actual.EXPO_PUBLIC_SUPABASE_URL, candidate.url);
  assert.equal(actual.EXPO_PUBLIC_SUPABASE_KEY, candidate.key);
  assert.equal(calls[0][1], 'preview');
  assert.equal(findExistingMainSettings(env, () => assert.fail('No lookup required')), env);
});

test('other projects, Dev client values, unreadable settings and conflicting production values are never substituted', () => {
  const missing = { RUNNER_TEMP: '/tmp/folio-main-test' };
  for (const candidate of [null, { url: 'https://other-project.supabase.co', key: env.EXPO_PUBLIC_SUPABASE_KEY },
    { url: `https://${KNOWN_MAIN_HOST}`, key: 'sb_secret_do_not_bundle' }]) {
    assert.equal(findExistingMainSettings(missing, () => ({ status: 0, stdout: 'FOLIO_MAIN_CLIENT=' + JSON.stringify(candidate) })), missing);
  }
  const partial = { ...missing, EXPO_PUBLIC_SUPABASE_URL: 'https://different-main.supabase.co' };
  assert.equal(findExistingMainSettings(partial, () => ({ status: 0, stdout: 'FOLIO_MAIN_CLIENT=' + JSON.stringify({ url: `https://${KNOWN_MAIN_HOST}`, key: env.EXPO_PUBLIC_SUPABASE_KEY }) })), partial);
});
