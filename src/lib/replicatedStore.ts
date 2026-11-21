import { withArchiveLock } from './archiveQueue';
import { applyRecord, canonical, keyKind, recordsFor, syncPayload, SYNC_KEYS, type SyncKind, type Replica, type RecordState, type RemoteRecord, type Payload } from './syncModel';

interface BaseStorage {
  storageKey(key: string): string;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
const listeners = new Map<string, Set<() => void>>();
const listen = (key: string, callback: () => void) => { const list = listeners.get(key) ?? new Set(); list.add(callback); listeners.set(key, list); return () => { list.delete(callback); if (!list.size) listeners.delete(key); }; };
const emit = (key: string) => listeners.get(key)?.forEach(callback => callback());
const own = (value: unknown, key: string) => Boolean(value) && Object.hasOwn(value as object, key);

/** Value and its pending network mutations share one acknowledged physical write. */
export function createReplicatedStore<T extends BaseStorage>(base: T, token: () => string, enabled: boolean) {
  const physical = (key: string) => `replica:${key}`;
  const notify = () => emit(base.storageKey('@sync'));
  const legacy = { libraryArchive: 'books', highlightArchive: 'highlights', lexiconArchive: 'lexicon', settingsArchive: 'settings' } as Record<string, string>;
  const readUnqueued = async (key: string): Promise<Replica> => {
    const saved = await base.loadJSONEntryStrict(physical(key));
    if (saved.present) {
      const r = saved.value as Replica;
      if (!r || r.version !== 1 || !Array.isArray(r.states) || new Set(r.states.map(s => s.id)).size !== r.states.length ||
        !r.states.every(s => s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 500 &&
          (!s.pending || typeof s.pending.token === 'string' && Number.isSafeInteger(s.pending.baseRevision) && s.pending.baseRevision >= 0) &&
          (!s.server || Number.isSafeInteger(s.server.revision) && s.server.revision > 0 && s.server.id === s.id))) throw Error('Saved account synchronization state could not be read. Existing data has been kept.');
      const kind = keyKind(key)!;
      if (r.cursor !== undefined && (!Number.isSafeInteger(r.cursor) || r.cursor < 0)) throw Error('Invalid saved account cursor. Existing work is kept.');
      for (const state of r.states) {
        if (state.pending) {
          if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(state.pending.token)) throw Error('Invalid saved mutation identifier.');
          const payload = state.pending.payload === null ? null : syncPayload(kind, state.pending.payload);
          if (payload && payload.id !== state.id) throw Error('Invalid saved pending record.');
        }
        if (state.server) validateRemote(kind, state.server);
        if (state.conflict && (!state.pending || !state.server || validateRemote(kind,state.conflict).id !== state.id || state.conflict.revision !== state.server.revision)) throw Error('Invalid saved conflict. Existing work is kept.');
      }
      recordsFor(kind, r.value);
      return r;
    }
    const entry = await base.loadJSONEntryStrict(key);
    if (entry.present) { recordsFor(keyKind(key)!, entry.value); return { version: 1, value: entry.value, states: [] }; }
    if (legacy[key]) {
      const earlier = await base.loadJSONEntryStrict(legacy[key]);
      if (earlier.present) {
        const value = key === 'libraryArchive' ? { version: 1, books: earlier.value, removedBookIds: [], pendingFileRemovals: [] }
          : key === 'settingsArchive' ? { version: 1, settings: earlier.value }
          : { version: 1, items: earlier.value, removedBookIds: [], ...(key === 'highlightArchive' ? { removedIds: [] } : {}) };
        recordsFor(keyKind(key)!, value); return { version: 1, value, states: [] };
      }
    }
    return { version: 1, states: [] };
  };
  const read = (key: string) => withArchiveLock(base.storageKey(physical(key)), () => readUnqueued(key));
  const write = async (key: string, replica: Replica, changed = false) => {
    await base.saveJSONStrict(physical(key), replica); notify();
    if (changed) emit(base.storageKey(key));
  };
  const bootstrap = (kind: SyncKind, replica: Replica) => {
    const states = new Map(replica.states.map(state => [state.id, state]));
    for (const [id, payload] of recordsFor(kind, replica.value)) if (!states.has(id)) states.set(id, { id, pending: { token: token(), baseRevision: 0, payload } });
    return { ...replica, states: [...states.values()] };
  };
  const saveJSONStrict = async (key: string, value: unknown) => {
    const kind = keyKind(key);
    if (!kind || !enabled) return base.saveJSONStrict(key, value);
    await withArchiveLock(base.storageKey(physical(key)), async () => {
      const current = bootstrap(kind, await readUnqueued(key)), before = recordsFor(kind, current.value), after = recordsFor(kind, value);
      const states = new Map(current.states.map(state => [state.id, state]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const payload = after.get(id) ?? null, previous = before.get(id) ?? null, old = states.get(id) ?? { id };
        if (canonical(payload) === canonical(previous) && states.has(id)) continue;
        if (old.server && canonical(payload) === canonical(old.server.payload)) states.set(id, { id, server: old.server });
        else states.set(id, { ...old, pending: { token: token(), baseRevision: old.pending?.baseRevision ?? old.server?.revision ?? 0, payload } });
      }
      await write(key, { version: 1, value, states: [...states.values()] });
    });
  };
  const loadJSONEntryStrict = async (key: string) => {
    if (!keyKind(key) || !enabled) return base.loadJSONEntryStrict(key);
    const r = await read(key); return { present: own(r, 'value'), value: r.value ?? null };
  };
  const mutateReplica = <R,>(kind: SyncKind, work: (current: Replica) => Promise<{ replica: Replica; result: R; changed?: boolean }>): Promise<R> => {
    const key = SYNC_KEYS[kind];
    return withArchiveLock(base.storageKey(key), () => withArchiveLock(base.storageKey(physical(key)), async () => {
      const before = await readUnqueued(key), result = await work(bootstrap(kind, before));
      if (canonical(before) !== canonical(result.replica)) await write(key, result.replica, canonical(before.value) !== canonical(result.replica.value));
      return result.result;
    }));
  };
  const validateRemote = (kind: SyncKind, row: RemoteRecord): RemoteRecord => {
    if (!row || row.kind !== kind || typeof row.id !== 'string' || !row.id || row.id.length > 500 || !Number.isSafeInteger(row.revision) || row.revision < 1 || typeof row.mutationId !== 'string') throw Error('An account revision could not be read safely.');
    const payload = row.payload === null ? null : syncPayload(kind, row.payload);
    if (payload && payload.id !== row.id) throw Error('An account revision has an inconsistent identifier.');
    return { ...row, payload };
  };
  const pull = (kind: SyncKind, incoming: RemoteRecord[]) => mutateReplica(kind, async current => {
    const states = new Map(current.states.map(state => [state.id, state])); let value = current.value, changed = false;
    for (const raw of incoming) {
      const row = validateRemote(kind, raw), old = states.get(row.id) ?? { id: row.id };
      if ((old.server?.revision ?? 0) > row.revision) continue;
      if (!old.pending && old.server?.revision === row.revision) continue;
      if (old.pending) {
        if (canonical(old.pending.payload) === canonical(row.payload)) states.set(row.id, { id: row.id, server: row });
        else states.set(row.id, { ...old, server: row, ...(row.revision !== old.pending.baseRevision ? { conflict: row } : {}) });
      } else {
        const local = kind === 'book' ? recordsFor(kind, value).get(row.id) : undefined;
        // Removing an unchanged downloaded original on another device still deserves review.
        const ownedBook = kind === 'book' && row.payload === null && local && (value as any)?.books?.find((b: Payload) => b.id === row.id)?.fileLocation;
        if (ownedBook) states.set(row.id, { ...old, server: row, pending: { token: token(), baseRevision: old.server?.revision ?? 0, payload: local! }, conflict: row });
        else { value = applyRecord(kind, value, row.id, row.payload); changed = true; states.set(row.id, { id: row.id, server: row }); }
      }
    }
    const cursor = Math.max(current.cursor ?? 0, ...incoming.map(row => row.changeId ?? 0));
    return { replica: { ...current, value, states: [...states.values()], cursor }, result: value, changed };
  });
  const pending = async () => {
    const result: { kind: SyncKind; id: string; pending: NonNullable<RecordState['pending']> }[] = [];
    if (!enabled) return result;
    for (const kind of Object.keys(SYNC_KEYS) as SyncKind[]) {
      await mutateReplica(kind, async current => ({ replica: current, result: undefined }));
      const current = await read(SYNC_KEYS[kind]);
      for (const state of current.states) if (state.pending && !state.conflict) result.push({ kind, id: state.id, pending: state.pending });
    }
    return result;
  };
  const acknowledgeMany = async (responses: { kind: SyncKind; id: string; sent: NonNullable<RecordState['pending']>; response: RemoteRecord; accepted: boolean }[]) => {
    for (const kind of Object.keys(SYNC_KEYS) as SyncKind[]) {
      const matching = responses.filter(item => item.kind === kind); if (!matching.length) continue;
      await mutateReplica(kind, async current => {
        const states = new Map(current.states.map(state => [state.id,state]));
        for (const { id, sent, response, accepted } of matching) {
          const row = validateRemote(kind,response); if (row.id !== id) throw Error('Account acknowledgement did not match the saved record.');
          const state = states.get(id); if (!state || (state.server?.revision ?? 0) > row.revision) continue;
          if (!accepted) states.set(id,state.pending ? { ...state, server: row, conflict: row } : { ...state, server: row });
          else if (state.pending?.token === sent.token) states.set(id,{ id,server:row });
          else if (state.pending && row.mutationId === sent.token) states.set(id,{ ...state, server:row, conflict:undefined, pending:{ ...state.pending,baseRevision:row.revision } });
          else states.set(id,{ ...state,server:row });
        }
        return { replica:{ ...current,states:[...states.values()] },result:undefined };
      });
    }
  };
  const acknowledge = (kind: SyncKind, id: string, sent: NonNullable<RecordState['pending']>, response: RemoteRecord, accepted: boolean) => acknowledgeMany([{kind,id,sent,response,accepted}]);
  const status = async () => {
    const conflicts: { kind: SyncKind; id: string; token: string; device: Payload | null; account: RemoteRecord }[] = []; let count = 0;
    if (enabled) for (const kind of Object.keys(SYNC_KEYS) as SyncKind[]) {
      const r = await read(SYNC_KEYS[kind]);
      for (const s of r.states) if (s.pending) { count++; if (s.conflict) conflicts.push({ kind, id: s.id, token: s.pending.token, device: s.pending.payload, account: s.conflict }); }
    }
    return { pending: count, conflicts };
  };
  const resolve = (kind: SyncKind, id: string, expectedToken: string, revision: number, choice: 'device' | 'account') => mutateReplica(kind, async current => {
    const state = current.states.find(s => s.id === id);
    if (!state?.pending || state.pending.token !== expectedToken || state.conflict?.revision !== revision) throw Error('This record changed while you reviewed it. Refresh and review the latest versions.');
    const account = state.conflict, states = current.states.filter(s => s.id !== id);
    let value = current.value;
    if (choice === 'account') { value = applyRecord(kind, value, id, account.payload); states.push({ id, server: account }); }
    else states.push({ id, server: account, pending: { ...state.pending, token: token(), baseRevision: account.revision } });
    return { replica: { ...current, value, states }, result: undefined, changed: choice === 'account' };
  });
  return { ...base, saveJSONStrict, loadJSONEntryStrict,
    loadJSONStrict: async <V,>(key: string): Promise<V | null> => { const entry = await loadJSONEntryStrict(key); return entry.present ? entry.value as V : null; },
    loadJSON: async <V,>(key: string): Promise<V | null> => { try { const entry = await loadJSONEntryStrict(key); return entry.present ? entry.value as V : null; } catch { return null; } },
    saveJSON: async (key: string, value: unknown) => { try { await saveJSONStrict(key,value); } catch { console.warn('A local save could not be confirmed:', key); } },
    subscribeArchive: (key: string, callback: () => void) => listen(base.storageKey(key), callback),
    subscribeSync: (callback: () => void) => listen(base.storageKey('@sync'), callback),
    replication: { enabled, pull, pending, acknowledge, acknowledgeMany, status, resolve, cursor: async (kind: SyncKind) => (await read(SYNC_KEYS[kind])).cursor ?? 0 },
  };
}
