import type { SupabaseClient } from '@supabase/supabase-js';

type Auth = SupabaseClient['auth'];

/** Browser completion and Linking can deliver the same callback simultaneously. */
export function createOAuthCallbackHandler(auth: Pick<Auth, 'exchangeCodeForSession' | 'setSession'>, redirectUrl: () => string) {
  const pending = new Map<string, Promise<boolean>>(), completed = new Set<string>();
  return async (value: string | null): Promise<boolean> => {
    if (!value) return false;
    let url: URL, expected: URL;
    try { url = new URL(value); expected = new URL(redirectUrl()); } catch { return false; }
    if (url.username || url.password || url.protocol !== expected.protocol || url.host !== expected.host || url.pathname !== expected.pathname) return false;
    const query = url.searchParams, fragment = new URLSearchParams(url.hash.slice(1));
    const parameter = (key: string) => query.get(key) || fragment.get(key);
    if (parameter('error')) throw new Error(parameter('error_description') || 'Google sign-in was declined. Please try again.');
    const code = parameter('code'), access = parameter('access_token'), refresh = parameter('refresh_token');
    if (!code && !(access && refresh)) throw new Error('Google sign-in did not return a session. Please try again.');
    const key = code ? `code:${code}` : `token:${access}`;
    if (completed.has(key)) return true;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const operation = Promise.resolve().then(async () => {
      const result = code ? await auth.exchangeCodeForSession(code) : await auth.setSession({ access_token: access!, refresh_token: refresh! });
      if (result.error) throw result.error;
      if (!result.data.session?.user?.id) throw new Error('Google sign-in could not establish a saved session. Please try again.');
      completed.add(key);
      if (completed.size > 16) completed.delete(completed.values().next().value!);
      return true;
    });
    pending.set(key, operation);
    try { return await operation; } finally { pending.delete(key); }
  };
}

interface NativeEvents {
  appState: { currentState: string | null; addEventListener(event: 'change', listener: (state: string) => void): { remove(): void } };
  linking: { getInitialURL(): Promise<string | null>; addEventListener(event: 'url', listener: (event: { url: string }) => void): { remove(): void } };
}

/** Handle cold/warm OAuth returns and refresh only while the native app is active. */
export function watchNativeAuth(auth: Pick<Auth, 'startAutoRefresh' | 'stopAutoRefresh'>, events: NativeEvents,
  callback: (url: string | null) => Promise<boolean>, onError: (error: unknown) => void) {
  let active = true, receivedLink = false;
  const report = (error: unknown) => { if (active) onError(error); };
  const refresh = (state: string | null) => {
    void Promise.resolve().then(() => {
      if (!active) return;
      return state === 'active' ? auth.startAutoRefresh() : auth.stopAutoRefresh();
    }).catch(report);
  };
  const accept = (url: string | null) => {
    if (active) void callback(url).catch(report);
  };
  const stateSubscription = events.appState.addEventListener('change', refresh);
  const linkSubscription = events.linking.addEventListener('url', event => { receivedLink = true; accept(event.url); });
  void events.linking.getInitialURL().then(url => { if (!receivedLink) accept(url); }).catch(report);
  refresh(events.appState.currentState);
  return () => {
    active = false; stateSubscription.remove(); linkSubscription.remove();
    void Promise.resolve().then(() => auth.stopAutoRefresh()).catch(() => undefined);
  };
}
