import * as SecureStore from 'expo-secure-store';
import { CryptoDigestAlgorithm, digestStringAsync } from 'expo-crypto';
import { createGoogleBooksKeyStore } from './googleBooksKeyStore';
/** App sandbox + backend/account/Guest scope keep each reader's key separate. */
export function googleBooksKeyStore(scope: string) {
  const options = { keychainService: 'folio.google-books', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return createGoogleBooksKeyStore(scope, {
    getItemAsync: key => SecureStore.getItemAsync(key, options),
    setItemAsync: (key, value) => SecureStore.setItemAsync(key, value, options),
    deleteItemAsync: key => SecureStore.deleteItemAsync(key, options),
  }, value => digestStringAsync(CryptoDigestAlgorithm.SHA256, value));
}
