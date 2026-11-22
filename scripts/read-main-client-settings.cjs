// Called only by the parent's captured env:exec process. Never run with inherited
// stdout in a workflow: its public client values belong in the app, not CI logs.
const { mainBuildConfiguration, KNOWN_MAIN_HOST } = require('./build-main-apk.cjs');
let result = null;
try {
  const env = process.env;
  if (new URL(env.EXPO_PUBLIC_SUPABASE_URL).hostname === KNOWN_MAIN_HOST) {
    mainBuildConfiguration(env);
    result = { url: env.EXPO_PUBLIC_SUPABASE_URL, key: env.EXPO_PUBLIC_SUPABASE_KEY };
  }
} catch { /* Report no candidate when missing, invalid, secret, or a Dev project. */ }
process.stdout.write('FOLIO_MAIN_CLIENT=' + JSON.stringify(result) + '\n');
