# Account isolation: Folio Dev rollout

This update separates cloud records, local caches, parsed pages, original EPUBs,
covers, catalog mappings, recovery entries and bookmarks by account and backend.
Guest has its own local space and never reads or writes personal cloud tables.
Signing out returns to Guest; signing back into the same account restores its
local space. Guest content is not silently uploaded when someone signs in.

## Before installing

**Export important notes from the current APK first**, using Notebook → Export
All, and keep your original EPUBs. Keep Folio Dev installed; do not clear app data.
The old caches cannot reliably identify who owns their records, so this update
preserves them under their original keys/files but does not automatically expose
or assign them to a new account or Guest. The Library explains this when old data
is present. A reviewed legacy-data import/export tool is not included in this step;
preserved unexported annotations are not accessible through the new reading spaces.

The old Supabase tables also contain shared, unattributed records. They remain
available to the project administrator for review/export; they are not copied
into private account tables. Do not assign them wholesale to the next user who
signs in. The existing account-owned `library_backups` table remains available
to its owner. It stores book metadata, not original EPUB files or annotations.

## Apply to the test project

1. Open the new **Folio Dev** Supabase project (the test project, not main Folio).
2. In SQL Editor, open a new query and paste **the entire contents** of
   [`202611200001_account_isolation.sql`](../supabase/migrations/202611200001_account_isolation.sql).
   Run the whole transaction, not selected CREATE TABLE statements.
3. Confirm the query succeeds. It creates `folio_books`, `folio_highlights`,
   `folio_lexicon`, `folio_reading_goals`, and `folio_reading_settings` with
   `(user_id, id)` primary keys and owner checks on reads and writes. It revokes
   app access to the old five shared tables without deleting their rows.
4. Install the new Folio Dev APK over the existing package. It starts separate
   spaces; an empty new library does not mean the preserved legacy files were
   deleted. Import a disposable test EPUB into the intended space.
5. Configure the test project's Google provider and `folio-dev://auth-callback`
   redirect if sign-in is not already enabled. Signing in and server ownership
   behavior still require a real-device test; local PostgreSQL tests do not prove
   provider configuration or successful deployment to your live project.

The SQL is rerunnable and transactional. New APKs never fall back to the shared
tables. If the SQL has not been applied, signed-in sync reports a failure; local
reading remains available. Existing older APKs lose access to the quarantined
cloud tables once the migration is applied, so coordinate their update. Nothing
in this step changes the separate production Supabase project.

## Verify with two test accounts

Use synthetic books/annotations and accounts **A** and **B**. Sign-in must work
before this check can establish anything about the actual app/backend.

1. As Guest, import a book and save a bookmark. Sign in as A. Guest's data must
   not appear or upload into A. Import another test EPUB, save a highlight/note
   and bookmark, and change a reading setting. Use Notebook → Sync.
2. Sign out. Guest's original book/bookmark should return; A's items must be
   absent from Library, Notebook, Search, Reading, Profile and open dialogs.
3. Sign in as B. A's books, settings, vocabulary, notes and bookmarks must not
   appear. Create different data as B. Its records should have B's `user_id` in
   the test project's private tables. File paths are not uploaded as cover URLs.
4. Switch back to A and verify its data remains. Restart the app and repeat;
   also check offline reopening while the SDK retains A's valid local session.
5. While a catalog download/restore is active, sign out when the UI permits it.
   Late work may finish in its original space, but must never populate or upload
   into B/Guest. Test signing back in, cancellation, and retry on the phone.
6. Delete a disposable book as B. A's book, files, annotations and bookmarks must
   remain. Uninstalling/clearing app storage is not part of this check.

Inspect the project's policies using the Supabase dashboard as administrator.
An administrator can see all rows by design; that is not evidence that an app
client can. The app must use the publishable/anon key, never a service-role key.
Do not assume cache separation proves server RLS, or that RLS alone proves cache
separation. Both the real sign-in transitions and live project rules need testing.

## Automated evidence and limits

`npm test` covers scoped cloud filters/payloads, stale session callbacks, forged
client ownership, local metadata/file/bookmark separation, unsafe file IDs, and
legacy preservation. `npm run test:account-db` executes the real migration against
PostgreSQL with a minimal `auth.uid()` test function and separate roles. It tests
anonymous denial, cross-account reads/writes/deletes, same-ID records, restrictive
policy behavior, idempotency, and legacy row preservation. CI runs both suites.

These tests do not apply SQL to Supabase, exercise its gateway/JWT validation,
complete Google OAuth, inspect native screens, or certify offline token refresh.
This step is not a full sync engine: the older cloud-wins merge/conflict strategy
and reliable offline upload retries still need separate work. On-device data is
namespaced inside the app sandbox, not separately encrypted per account; this does
not protect against a rooted device or direct access to the app's private files.
