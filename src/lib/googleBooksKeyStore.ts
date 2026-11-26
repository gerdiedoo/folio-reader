export interface GoogleBooksKeyStore {
  load(): Promise<string | null>;
  save(key: string): Promise<string>;
  remove(): Promise<void>;
}
interface SecureValues { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string): Promise<void>; deleteItemAsync(key: string): Promise<void> }
/** Encrypted native storage is supplied by the adapter; this key never enters archives. */
export function createGoogleBooksKeyStore(scope: string, secure: SecureValues, digest: (value: string) => Promise<string>): GoogleBooksKeyStore {
  let storageKey: Promise<string> | undefined;
  const id = () => storageKey ??= digest(scope).then(hash => `folio.google-books.${hash}`).catch(error => { storageKey = undefined; throw error; });
  return {
    async load() { return secure.getItemAsync(await id()); },
    async save(value) {
      const key = value.trim();
      if (!/^[a-zA-Z0-9_-]{20,200}$/.test(key)) throw Error('Enter a valid Google Books API key.');
      const name = await id();
      await secure.setItemAsync(name, key);
      if (await secure.getItemAsync(name) !== key) throw Error('The key could not be confirmed on this device. Please retry.');
      return key;
    },
    async remove() {
      const name = await id(); await secure.deleteItemAsync(name);
      if (await secure.getItemAsync(name) !== null) throw Error('The key removal could not be confirmed. Please retry.');
    },
  };
}
