import type { Session, SupabaseClient } from '@supabase/supabase-js';

/** A late initial read must not restore A after a newer sign-out/sign-in event. */
export function watchAccountSession(
  auth: SupabaseClient['auth'],
  onSession: (session: Session | null) => void,
  onError: () => void,
) {
  let active = true;
  let receivedEvent = false;
  const { data: listener } = auth.onAuthStateChange((_event, session) => {
    if (!active) return;
    receivedEvent = true;
    onSession(session);
  });
  void auth.getSession().then(({ data, error }) => {
    if (!active || receivedEvent) return;
    if (error) onError();
    else onSession(data.session);
  }).catch(() => { if (active && !receivedEvent) onError(); });
  return () => { active = false; listener.subscription.unsubscribe(); };
}
