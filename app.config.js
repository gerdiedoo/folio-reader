// Keep production identifiers in app.json; opt into a separate installed app.
module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (variant && !['development', 'production'].includes(variant)) {
    throw new Error('EXPO_PUBLIC_APP_VARIANT must be development or production.');
  }
  config = { ...config, plugins: [...(config.plugins || []), './plugins/withReaderStorage'] };
  if (variant !== 'development') {
    if (['production', 'preview'].includes(process.env.EAS_BUILD_PROFILE)) {
      if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_KEY) {
        throw new Error('Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY in the EAS production/preview environment before building Folio.');
      }
      if (process.env.EXPO_PUBLIC_SUPABASE_URL === process.env.EXPO_PUBLIC_DEV_SUPABASE_URL ||
          new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).hostname === 'ntdhzgjkmfohgjzymdgh.supabase.co') {
        throw new Error('The main Folio app must use its production Supabase project, not Folio Dev.');
      }
      if (new URL(process.env.EXPO_PUBLIC_SUPABASE_URL).protocol !== 'https:') throw new Error('Folio requires an HTTPS Supabase URL.');
    }
    return config;
  }

  if (process.env.EAS_BUILD_PROFILE === 'dev-preview' &&
      (!process.env.EXPO_PUBLIC_DEV_SUPABASE_URL || !process.env.EXPO_PUBLIC_DEV_SUPABASE_KEY)) {
    throw new Error('Configure EXPO_PUBLIC_DEV_SUPABASE_URL and EXPO_PUBLIC_DEV_SUPABASE_KEY in the EAS development environment before building Folio Dev.');
  }

  return {
    ...config,
    name: 'Folio Dev',
    scheme: 'folio-dev',
    android: { ...config.android, package: 'com.folio.reader.dev' },
    ios: { ...config.ios, bundleIdentifier: 'com.folio.reader.dev' },
  };
};
