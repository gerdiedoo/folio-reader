const path = require('node:path');
const { spawnSync } = require('node:child_process');

function mainBuildConfiguration(env) {
  for (const name of ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_KEY']) {
    if (!env[name]) throw Error(`Set ${name} in the Expo project's production environment (Plain text or Sensitive visibility), then rerun this build.`);
  }
  let url;
  try { url = new URL(env.EXPO_PUBLIC_SUPABASE_URL); } catch { throw Error('The production Supabase URL is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw Error('The main APK needs an HTTPS Supabase project URL without credentials or a path.');
  }
  const devUrl = require('../eas.json').build['dev-preview'].env.EXPO_PUBLIC_DEV_SUPABASE_URL;
  if (url.hostname === new URL(devUrl).hostname) throw Error('The main APK cannot use the Folio Dev backend.');
  const key = env.EXPO_PUBLIC_SUPABASE_KEY;
  let role;
  try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* Publishable keys are not JWTs. */ }
  if (!/^sb_publishable_[a-zA-Z0-9_-]+$/.test(key) && role !== 'anon') {
    throw Error('The production Supabase key must be a publishable key or legacy anon key. Never use a secret or service-role key.');
  }
  if (!env.RUNNER_TEMP) throw Error('A disposable runner output directory is required.');
  return {
    env: { ...env, EXPO_PUBLIC_APP_VARIANT: 'production', EAS_BUILD_PROFILE: 'main-apk' },
    args: ['build', '--platform', 'android', '--profile', 'main-apk', '--non-interactive', '--local', '--output', path.join(env.RUNNER_TEMP, 'folio.apk')],
  };
}

module.exports = { mainBuildConfiguration };
if (require.main === module) {
  try {
    // EAS Sensitive values are not automatically registered as GitHub secrets.
    if (process.env.GITHUB_ACTIONS === 'true') {
      for (const [name, value] of Object.entries(process.env)) {
        if (/(?:TOKEN|SECRET|PASSWORD|KEY)/i.test(name) && value && value.length >= 8) {
          console.log('::add-mask::' + value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A'));
        }
      }
    }
    const settings = mainBuildConfiguration(process.env);
    console.log('Building Folio (com.folio.reader) with the production backend and remote signing credentials.');
    const result = spawnSync('eas', settings.args, { env: settings.env, stdio: 'inherit' });
    if (result.error) throw Error('The EAS build process could not start.');
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
