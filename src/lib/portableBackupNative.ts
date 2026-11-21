import JSZip from 'jszip';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { withArchiveLock } from './archiveQueue';
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
  await withArchiveLock(storage.storageKey('bookmarks'), async () => undefined);
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

export async function importPortableBackup(storage: LocalStore, backup: PreparedBackup, preferences: boolean, recoverMatching = false): Promise<void> {
  await withArchiveLock(storage.storageKey('bookmarks'), async () => undefined);
  if (recoverMatching) for (const item of backup.manifest.books) {
    const fingerprint = item.book.documentFingerprint;
    if (!fingerprint) continue;
    if (item.epub) {
      const bytes = backup.files.get(item.epub)!;
      const actual = Array.from(new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256,new Uint8Array(bytes))), byte => byte.toString(16).padStart(2,'0')).join('');
      if (actual !== fingerprint) throw Error('An original EPUB in this copy does not match its edition. No recovery files were written.');
    }
    if (item.pages) {
      const pages = JSON.parse(await new JSZip().file('pages',backup.files.get(item.pages)!).file('pages')!.async('string'));
      if (pages.some((page: { source?: { edition: string } }) => page.source && page.source.edition !== fingerprint)) throw Error('Reading text in this copy does not match its edition. No recovery files were written.');
    }
  }
  await restorePortableBackup(storage, backup, { write: storage.writeRecoveryAsset, remove: storage.removeBookFiles }, preferences, undefined, recoverMatching);
}
