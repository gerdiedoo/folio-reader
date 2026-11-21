import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { createBookmarkStore } from './bookmarks';
import { readBackupSnapshot, restorePortableBackup, recoverPortableRestore } from './backupRecovery';
import { BACKUP_LIMIT, buildPortableBackup, inspectPortableBackup, type PreparedBackup } from './portableBackup';
import type { LocalStore } from './localStore';

export async function choosePortableBackup(): Promise<PreparedBackup | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/octet-stream', '*/*'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets[0]) return null;
  const file = new File(result.assets[0].uri);
  if (file.size > BACKUP_LIMIT) throw Error('Choose a Folio safety copy smaller than 48 MB. No saved work was changed.');
  return inspectPortableBackup(await file.bytes());
}

/** Run after unmounting the reading UI, so the exported archives form a quiet snapshot. */
export async function exportPortableBackup(storage: LocalStore, includeOriginals: boolean): Promise<void> {
  if (!await Sharing.isAvailableAsync()) throw Error('File sharing is unavailable on this device.');
  await recoverPortableRestore(storage);
  await createBookmarkStore(AsyncStorage, storage.storageKey('bookmarks')).load();
  const snapshot = await readBackupSnapshot(storage);
  const bytes = await buildPortableBackup(snapshot, {
    readPages: id => storage.readBackupAsset(id, 'pages'),
    readOriginal: book => storage.readBackupAsset(book.id, 'epub'),
    readCover: async book => {
      const bytes = await storage.readBackupAsset(book.id, 'cover', book.coverUrl);
      return bytes ? { bytes, extension: book.coverUrl.split('.').pop()!.toLowerCase() } : null;
    },
  }, includeOriginals);
  const file = new File(Paths.cache, `folio-safety-copy-${Date.now()}.zip`);
  file.create(); file.write(bytes);
  // Keep this cache file: some Android sharing targets read it after the sheet closes.
  await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', UTI: 'public.zip-archive', dialogTitle: 'Save your Folio safety copy' });
}

export async function importPortableBackup(storage: LocalStore, backup: PreparedBackup, preferences: boolean): Promise<void> {
  await createBookmarkStore(AsyncStorage, storage.storageKey('bookmarks')).load();
  await restorePortableBackup(storage, backup, { write: storage.writeRecoveryAsset, remove: storage.removeBookFiles }, preferences);
}
