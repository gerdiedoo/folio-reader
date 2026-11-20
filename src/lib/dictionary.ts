import { LOCAL_DICTIONARY } from '../data/dictionary';

export interface DictionaryEntry {
  phonetic: string;
  partOfSpeech: string;
  definition: string;
  synonyms: string[];
  example: string;
}

export class DictionaryLookupError extends Error {
  constructor(public readonly kind: 'timeout' | 'network' | 'service' | 'invalid' | 'input') {
    super({
      timeout: 'The dictionary took too long to respond. Try again.',
      network: 'Couldn’t reach the dictionary. Check your connection and try again.',
      service: 'The dictionary service is unavailable. Try again shortly.',
      invalid: 'The dictionary returned an unreadable definition. Try again.',
      input: 'Use a word or phrase of 80 characters or fewer.',
    }[kind]);
  }
}

export function dictionaryWord(value: string): string { return value.trim().normalize('NFC').toLowerCase(); }

export function bundledDefinition(word: string): DictionaryEntry | null {
  return Object.prototype.hasOwnProperty.call(LOCAL_DICTIONARY, word) ? LOCAL_DICTIONARY[word] : null;
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length <= limit ? value.trim() : '';

/** Accept usable fields from one sense; never borrow an example from another. */
export function parseDictionaryResponse(data: unknown): DictionaryEntry | null {
  if (!Array.isArray(data)) throw new DictionaryLookupError('invalid');
  if (!data.length) return null;
  for (const entry of data) {
    if (!record(entry) || !Array.isArray(entry.meanings)) continue;
    for (const meaning of entry.meanings) {
      if (!record(meaning) || !Array.isArray(meaning.definitions)) continue;
      for (const definition of meaning.definitions) {
        if (!record(definition)) continue;
        const body = text(definition.definition, 10000);
        if (!body) continue;
        const alternatives = Array.isArray(entry.phonetics) ? entry.phonetics : [];
        const phonetic = text(entry.phonetic, 300) || alternatives.reduce<string>((found, item) => found || (record(item) ? text(item.text, 300) : ''), '');
        const synonyms = [...(Array.isArray(definition.synonyms) ? definition.synonyms : []), ...(Array.isArray(meaning.synonyms) ? meaning.synonyms : [])]
          .map(value => text(value, 100)).filter(Boolean);
        return {
          definition: body, phonetic,
          partOfSpeech: text(meaning.partOfSpeech, 100),
          synonyms: [...new Set(synonyms)].slice(0, 6),
          example: text(definition.example, 4000),
        };
      }
    }
  }
  throw new DictionaryLookupError('invalid');
}

interface DictionaryResponse { ok: boolean; status: number; json(): Promise<unknown> }
interface Options {
  signal?: AbortSignal;
  fetcher?: (url: string, options: { signal: AbortSignal }) => Promise<DictionaryResponse>;
  timeoutMs?: number;
}

function cancelled(): Error { const error = new Error('Lookup cancelled'); error.name = 'AbortError'; return error; }

/** Covers headers and JSON body; timeout/cancellation finish even if a client ignores abort. */
export async function fetchDictionaryDefinition(word: string, { signal, fetcher = fetch, timeoutMs = 8000 }: Options = {}): Promise<DictionaryEntry | null> {
  if (signal?.aborted) throw cancelled();
  const key = dictionaryWord(word);
  if (!key) return null;
  if (key.length > 80) throw new DictionaryLookupError('input');
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => { reject(cancelled()); controller.abort(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { reject(new DictionaryLookupError('timeout')); controller.abort(); }, timeoutMs);
  });
  try {
    const request = Promise.resolve().then(async () => {
      if (signal?.aborted) throw cancelled();
      const response = await fetcher(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(key)}`, { signal: controller.signal });
      if (response.status === 404) return null;
      if (!response.ok) throw new DictionaryLookupError('service');
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new DictionaryLookupError('invalid'); }
      return parseDictionaryResponse(data);
    });
    return await Promise.race([request, stopped]);
  } catch (error) {
    if (signal?.aborted) throw cancelled();
    if (error instanceof DictionaryLookupError) throw error;
    throw new DictionaryLookupError('network');
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener('abort', onAbort!);
    controller.abort();
  }
}
