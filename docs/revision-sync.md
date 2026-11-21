# Revision sync in Folio Dev

The new Dev client saves each personal archive and its pending uploads in one
acknowledged local write. Large JSON archives use immutable, bounded storage
segments and a small commit pointer, avoiding Android’s single-row cursor limit.
Reads and writes serialize through pointer replacement; failed segment writes
keep the previous archive, and an uncertain commit preserves both generations. Uploads retry after reopening or returning to the app.
The server accepts changes only against an expected revision; retries reuse a
mutation UUID. Conflicting versions remain on the device for explicit review in
Notebook or Account. Choosing the device version queues it against the reviewed
account revision; choosing the account version replaces that device record.
New source anchors, bookmarks and vocabulary context travel with these records.
Original EPUB files, local cover photos, scroll pixels and reading-time counters
stay on the device. This is foreground synchronization, not background delivery.

## Apply to the separate test project

1. Export a portable safety copy of important Folio Dev work and save the ZIP in
   Files. Keep it until the upgrade and two-device checks below succeed.
2. Install the new Folio Dev APK on every test device. Keep the main Folio app
   installed, and do not uninstall or clear Folio Dev data.
3. In the **Folio Dev** Supabase SQL Editor, apply
   [the account-isolation migration](../supabase/migrations/202611200001_account_isolation.sql)
   if it has not already been applied, then
   [the revision-sync migration](../supabase/migrations/202611210001_revision_sync.sql).
   The latter was exercised in disposable PostgreSQL, including migration reruns,
   two-account permissions, simultaneous writes, idempotent retries and cascading
   tombstones. It has **not** been deployed to your project by this workspace.
4. Reopen Folio Dev. Check Notebook → Sync now, then review any conflicting
   records. Older private rows seed the new records; richer device versions may
   need review on their first upload because those old rows lack revision history.

The second migration makes the older private tables read-only to clients, so
older APKs cannot bypass the revision protocol. They retain device data but can
no longer upload through those tables. Upgrade the test devices together.
The old shared tables remain quarantined. Migration never assigns shared rows
to a reader, deletes the old private rows, or changes the main Folio project.
Running only `schema.sql` installs account isolation; the second migration is
also required for revision synchronization.

## Verify recovery and competing edits

- Sign into A on two test devices. Import a new illustrated EPUB on device 1,
  make a bookmark, reflection and vocabulary card. Sync. Device 2 receives the
  metadata and saved work; its missing EPUB is reported honestly.
- Export a safety copy including the EPUB from device 1. On device 2 choose the
  copy, leave **Recover matching editions** selected, and recover. Matching book
  IDs and SHA-256 editions reuse identities and retain current progress/notes;
  existing files must match exactly before reuse. Legacy or different editions
  become separate copies. Explicit removals stay removed. Test reopening its
  saved passage and **Read in book** from the vocabulary card.
- Go offline on both devices, edit the same reflection differently, restart, and
  reconnect. Review must show both versions. Choose one, sync, and confirm the
  other device receives the accepted revision. Noncompeting record IDs merge.
- Remove the book on device 1, then reconnect a stale device 2. A downloaded
  original requires local review before removal. Old uploads cannot resurrect
  the server book or its children. Restoring the removed book is an explicit
  conflict choice, never an automatic stale upload.
- Sign out and sign into B. A's data must not appear. Test a third anonymous
  session as well. Do not put production or private test data in public evidence.

## Limits

Sync works at record granularity; it does not combine two edits to one reflection
or average competing reading positions. It preserves versions for a reader's
choice. Tombstones persist until account deletion, and original EPUBs travel by
portable copy rather than cloud storage. Safety copies are private, unencrypted
ZIP files with a 48 MB limit. A device JSON archive is limited to 16 million
UTF-16 code units, with the Dev native database capped at 64 MB; exceeding capacity
rejects the new save and keeps the confirmed version. Old segments from an
uncertain commit can remain for recovery. Unknown/unreadable archive versions block writes
and keep existing bytes; no automatic repair discards them. Older unjournaled
orphan files remain preserved rather than being deleted speculatively.
