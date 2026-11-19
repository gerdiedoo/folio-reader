interface BackendCredentials {
  url: string;
  key: string;
}

// A test build must never fall back to the credentials for the installed main app.
export function selectBackend(
  variant: string | undefined,
  production: BackendCredentials,
  development: BackendCredentials,
): BackendCredentials {
  if (variant && variant !== 'development' && variant !== 'production') {
    throw new Error('Unknown Folio app variant.');
  }
  if (variant !== 'development') return production;

  if (development.url) {
    const url = new URL(development.url);
    if (url.protocol !== 'https:') throw new Error('Folio Dev requires an HTTPS Supabase URL.');
    const productionHost = production.url ? new URL(production.url).hostname : '';
    if (url.hostname === productionHost || url.hostname === 'radjkztdsanbnacpvmnk.supabase.co') {
      throw new Error('Folio Dev must use a separate Supabase test project.');
    }
  }
  return development;
}
