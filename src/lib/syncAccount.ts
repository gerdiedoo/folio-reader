import type { SupabaseClient } from '@supabase/supabase-js';
import { createAccountRepository } from './cloudAccount';
import { createReplicatedStore } from './replicatedStore';
import { recordsFor, SYNC_KEYS, type SyncKind, type RemoteRecord } from './syncModel';

type Store = ReturnType<typeof createReplicatedStore>;
/** Owner is sent explicitly as well as checked against auth.uid() by every server write. */
export function createSyncAccountRepository(client: SupabaseClient, owner: string | null, store: Store) {
  const legacy = createAccountRepository(client, owner);
  let pendingFlush: Promise<boolean> | null = null, stopped = false, lastError: string | null = null;
  const owns = async () => {
    if (!owner || stopped) return false;
    const { data, error } = await client.auth.getSession();
    return !error && data.session?.user.id === owner;
  };
  const remote = (row: any): RemoteRecord => ({ kind: row.kind, id: row.id, revision: Number(row.revision), payload: row.payload,
    mutationId: row.mutation_id, changeId: Number(row.change_id) });
  const request = async <T,>(make: (signal: AbortSignal) => PromiseLike<T>): Promise<T> => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
    try { return await make(controller.signal); } finally { clearTimeout(timer); }
  };
  const flush = (): Promise<boolean> => {
    if (pendingFlush) return pendingFlush;
    const operation = (async () => {
      if (!store.replication.enabled || !await owns()) return false;
      const changes = await store.replication.pending();
      let failed = false;
      for (const change of changes.slice(0, 30)) {
        if (!await owns()) return false;
        try {
          const { data, error } = await request(signal => client.rpc('folio_write_record', {
            p_owner: owner, p_kind: change.kind, p_id: change.id, p_payload: change.pending.payload,
            p_expected_revision: change.pending.baseRevision, p_mutation_id: change.pending.token,
          }).abortSignal(signal));
          if (error || !data?.record) throw Error('Account synchronization is unavailable. Device changes are kept.');
          if (!await owns()) return false;
          await store.replication.acknowledge(change.kind, change.id, change.pending, remote(data.record), data.accepted === true);
          lastError = null;
        } catch {
          lastError = 'Account synchronization is unavailable. Device changes are kept and will retry.'; failed = true; break;
        }
      }
      return !failed && (await store.replication.status()).pending === 0;
    })();
    pendingFlush = operation;
    void operation.finally(() => { if (pendingFlush === operation) pendingFlush = null; }).catch(() => undefined);
    return operation;
  };
  const pull = async (kind: SyncKind) => {
    if (!store.replication.enabled || !await owns()) return null;
    let cursor = await store.replication.cursor(kind);
    for (let page = 0; page < 200; page++) {
      const { data, error } = await request(signal => client.from('folio_records').select('kind,id,payload,revision,mutation_id,change_id')
        .eq('user_id', owner!).eq('kind', kind).gt('change_id', cursor).order('change_id', { ascending: true }).limit(500).abortSignal(signal));
      if (error || !data) { lastError = 'Account synchronization is unavailable. Device changes are kept and will retry.'; throw Error(lastError); }
      if (!await owns()) return null;
      const rows = data.map(remote);
      if (rows.some(row => !Number.isSafeInteger(row.changeId) || row.changeId! <= cursor)) throw Error('The account change feed could not be read safely.');
      await store.replication.pull(kind, rows);
      lastError = null;
      if (rows.length < 500) break;
      cursor = await store.replication.cursor(kind);
      if (page === 199) throw Error('This account contains more changes than one synchronization pass can read. Try again.');
    }
    const saved = await store.loadJSONEntryStrict(SYNC_KEYS[kind]);
    return saved.present ? [...recordsFor(kind, saved.value).values()].filter((item): item is NonNullable<typeof item> => item !== null) : [];
  };
  const cycle = async () => {
    if (!await owns()) throw Error('Sign in again to confirm account synchronization. Device changes are kept.');
    await flush();
    for (const kind of Object.keys(SYNC_KEYS) as SyncKind[]) { if (stopped) return; await pull(kind); }
  };
  const fetchSettings = async () => (await pull('settings'))?.[0] ?? null;
  return { ...legacy,
    fetchBooksFromSupabase: () => pull('book') as ReturnType<typeof legacy.fetchBooksFromSupabase>,
    fetchHighlightsFromSupabase: () => pull('highlight') as ReturnType<typeof legacy.fetchHighlightsFromSupabase>,
    fetchLexiconFromSupabase: () => pull('lexicon') as ReturnType<typeof legacy.fetchLexiconFromSupabase>,
    fetchReadingSettingsFromSupabase: fetchSettings,
    upsertBookToSupabase: (_book: Parameters<typeof legacy.upsertBookToSupabase>[0]) => flush(),
    upsertHighlightToSupabase: (_entry: Parameters<typeof legacy.upsertHighlightToSupabase>[0]) => flush(),
    upsertLexiconToSupabase: (_entry: Parameters<typeof legacy.upsertLexiconToSupabase>[0]) => flush(),
    upsertReadingSettingsToSupabase: (_settings: Parameters<typeof legacy.upsertReadingSettingsToSupabase>[0]) => flush(),
    deleteBookFromSupabase: (_id: string) => flush(), deleteHighlightFromSupabase: (_id: string) => flush(),
    // Reading-time counters are device-local; merging them requires dated events, not snapshots.
    fetchReadingGoalFromSupabase: async () => null,
    upsertReadingGoalToSupabase: async (_goal: Parameters<typeof legacy.upsertReadingGoalToSupabase>[0]) => false,
    sync: { cycle, flush, pull, status: store.replication.status, resolve: store.replication.resolve,
      error: () => lastError, stop: () => { stopped = true; }, start: () => { stopped = false; } },
  };
}
