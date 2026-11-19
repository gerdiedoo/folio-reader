// Keep production identifiers in app.json; opt into a separate installed app.
module.exports = ({ config }) => {
  const variant = process.env.EXPO_PUBLIC_APP_VARIANT;
  if (variant && !['development', 'production'].includes(variant)) {
    throw new Error('EXPO_PUBLIC_APP_VARIANT must be development or production.');
  }
  if (variant !== 'development') return config;

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
