import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { selectBackend } from './backendConfig';

// Lets the in-app browser close itself when the OAuth redirect comes back.
WebBrowser.maybeCompleteAuthSession();

const backend = selectBackend(
  process.env.EXPO_PUBLIC_APP_VARIANT,
  {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
    key: process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '',
  },
  {
    url: process.env.EXPO_PUBLIC_DEV_SUPABASE_URL ?? '',
    key: process.env.EXPO_PUBLIC_DEV_SUPABASE_KEY ?? '',
  },
);
export const SUPABASE_URL = backend.url;
const SUPABASE_KEY = backend.key;
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!hasSupabaseConfig) {
  console.warn(
    'Supabase env vars missing. Configure the Supabase URL and publishable key for this app variant; see docs/android-testing.md.'
  );
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_KEY || 'placeholder-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // there is no browser URL in React Native
      flowType: 'pkce',
    },
  }
);

/** URL Supabase redirects back to after Google sign-in. Add it to Auth → URL Configuration. */
export function getAuthRedirectUrl(): string {
  return Linking.createURL('auth-callback');
}

/**
 * Google sign-in via Supabase OAuth. On native we open the consent screen in an
 * in-app browser session and exchange the returned PKCE code for a session.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!hasSupabaseConfig) {
    throw new Error(
      'Supabase is not configured in this app build. Configure the Supabase variables for this app variant, then rebuild; see docs/android-testing.md.'
    );
  }

  const redirectTo = getAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'consent select_account' },
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase did not return an OAuth URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // user cancelled / dismissed

  const url = result.url;
  const queryString = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const code = new URLSearchParams(queryString).get('code');
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return;
  }

  // Fallback for implicit-flow style redirects (#access_token=…&refresh_token=…)
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    return;
  }

  throw new Error(params.get('error_description') || 'Google sign-in did not return a session.');
}

export async function signOutSupabase(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}


export { toUserProfile } from './userProfile';
export { SUPABASE_SQL_SCHEMA } from './schemaSql';
export { createAccountRepository } from './cloudAccount';
