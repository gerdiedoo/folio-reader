# Highlights and reflection notes: local storage protection

Step 12 protects highlights and their reflection notes. Step 13 separately adds
[vocabulary storage protection](vocabulary-storage.md).
[Reading preferences](reader-settings-storage.md) have their own archive.
Book metadata and cloud conflict/retry systems need separate work.

## Upgrade

Export important notes from the current APK using **Notebook → Export All** and
keep your original EPUBs. Install the new Folio Dev APK over the existing package;
do not uninstall or clear app data. No new Supabase SQL migration is required.
If upgrading from before step 6, complete the [account-isolation rollout](account-isolation.md)
first. Unattributed pre-isolation data is still preserved without automatic adoption.

The first successful note mutation or cloud import writes a versioned
`highlightArchive` entry in the current account/backend's local namespace. It
contains the highlights, reflection notes and local deletion markers together.
Until that entry exists, the app reads the earlier per-account `highlights`
array. That earlier array remains intact; it is not updated as a current backup.
Guest and each account/backend use separate archives.

Older APKs read the earlier array and cannot see new archive changes. Export from
the new APK before any downgrade; changes made in an older APK after migration
are not automatically reconciled into the archive.

## Save and failure behavior

Adding a highlight, editing a reflection, or deleting a highlight waits for the
strict storage promise before publishing the result to the UI. Save controls
show a pending state and block duplicate taps. A failed save leaves the input
open, without a success message. A successful message says **on this device**;
it does not establish cloud backup.

Updates read durable state inside a queue shared by archive instances using the
same storage key. Returning to the same account waits for earlier queued saves.
A missing key is distinguished from a stored JSON `null`. Invalid JSON, malformed
records, duplicate IDs and unsupported/inconsistent archive versions block
mutations and merges instead of replacing the archive with an empty array.
Notebook offers **Try again** and disables quote creation/export/upload while
saved highlights cannot be loaded. Persistent corruption may need a reviewed
recovery tool; this step provides no reset or automatic destructive repair.

The archive is one AsyncStorage value per account/backend. These are API-level
write acknowledgements, not a claim of survival through power loss, process death
during a native write, or loss of app storage. Book removal still spans bookmarks,
notes, library metadata and files. It is not one atomic transaction: if bookmark
removal succeeds but note storage then fails, the book is kept and the app reports
that its bookmarks were already removed. Do not use uninstall/clear storage to
test failure handling.

## Startup merge and cloud limits

Startup adds valid cloud-only highlights to the local archive. Existing device
records win by ID, including offline reflection edits. A delayed cloud response
reads the latest durable archive, preserving saves made while it was pending.
Malformed cloud records are skipped with a notice; local read failures prevent
cloud import entirely. Cloud additions are published only after their local cache
write succeeds.

Removing a highlight stores a local deletion marker with the updated collection.
Removing a book also records its ID, so later cloud rows for that book cannot
reappear in this device's archive. Markers survive restart within that reading
space. They are local suppression records, not a server-wide deletion protocol.

Cloud writes/deletes remain best-effort after local success. There is no durable
network outbox or multi-device version/conflict resolution in this step. A failed
server delete may leave a row visible on another device. A remote edit to an ID
already present locally does not replace this device's copy. Notebook labels its
manual operation **Upload to Supabase** and warns to review other-device changes:
it pushes current records and does not reconcile remote deletions/conflicts.
Vocabulary has its own [archive and merge rules](vocabulary-storage.md), and
[reading preferences](reader-settings-storage.md) use a separate confirmed store.
Book metadata retains its older merge policies. Profile's library metadata backup
does not include this archive or original EPUB files.

## Evidence

Tests inject read/write failures, pending saves, malformed/null data, concurrent
store instances, stale cloud data, deletion/restart, account/Guest separation and
late unmount callbacks. Component tests check pending controls, retained drafts,
truthful success feedback and blocked export/upload on read failure. They use
storage/native adapters, not real Android storage faults or a live Supabase server.
Use the [step 12 phone checklist](android-testing.md#highlight-and-reflection-storage-step-12)
to validate normal saves, restarts, account changes and native UI behavior.
