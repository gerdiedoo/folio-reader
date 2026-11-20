import type { ReadingSettings } from '../types';
import { normalizeReaderSettings, type ReaderSettingsChange } from './readerPreferences';

interface Storage {
  storageKey(key: string): string;
  loadJSONEntryStrict(key: string): Promise<{ present: boolean; value: unknown }>;
  saveJSONStrict(key: string, value: unknown): Promise<void>;
}
const KEY = 'settingsArchive';
const queues = new Map<string, Promise<void>>();
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function settings(value: unknown) {
  if (!record(value)) throw new Error('Saved reading preferences could not be read.');
  return normalizeReaderSettings(value);
}

/** Serialize read/modify/write across store instances in the same reading space. */
export function createReaderSettingsStore(storage: Storage) {
  const queueKey = storage.storageKey(KEY);
  const enqueue = <T,>(work: () => Promise<T>): Promise<T> => {
    const operation = (queues.get(queueKey) ?? Promise.resolve()).then(work);
    const settled = operation.then(() => undefined, () => undefined);
    queues.set(queueKey, settled);
    void settled.then(() => { if (queues.get(queueKey) === settled) queues.delete(queueKey); });
    return operation;
  };
  const read = async (): Promise<{ settings: ReadingSettings; hasSaved: boolean }> => {
    const entry = await storage.loadJSONEntryStrict(KEY);
    if (entry.present) {
      if (!record(entry.value) || entry.value.version !== 1) throw new Error('Unsupported reading preferences archive.');
      return { settings: settings(entry.value.settings), hasSaved: true };
    }
    const legacy = await storage.loadJSONEntryStrict('settings');
    return { settings: legacy.present ? settings(legacy.value) : normalizeReaderSettings(null), hasSaved: legacy.present };
  };
  const write = async (value: ReadingSettings) => {
    await storage.saveJSONStrict(KEY, { version: 1, settings: value });
    return value;
  };
  return {
    load: () => enqueue(read),
    patch: (change: ReaderSettingsChange) => enqueue(async () => {
      const current = await read();
      const partial = typeof change === 'function' ? change({ ...current.settings }) : change;
      return write(normalizeReaderSettings({ ...current.settings, ...partial }));
    }),
    seedCloud: (remote: unknown) => enqueue(async () => {
      const current = await read();
      // Recheck after the network response: a user may already have saved locally.
      if (current.hasSaved) return current.settings;
      return write(settings(remote));
    }),
  };
}
