# Vocabulary cards and mastery: local storage protection

Step 13 applies confirmed local storage to dictionary cards and mastery ratings.
It follows the [highlight/reflection safeguards](highlight-storage.md), with a
separate archive for vocabulary.

## Upgrade and recovery

Export important notes/cards from the current APK with **Notebook → Export All**.
Install the new Folio Dev APK over the existing package; do not uninstall or clear
app data. No new Supabase SQL migration is required. If upgrading from before
step 6, follow the [account-isolation rollout](account-isolation.md) first.

The app reads the earlier `lexicon` array within the current account/backend's
local namespace until a `lexiconArchive` exists. The first successful card/rating
change, book-card removal or cloud-only card import writes the versioned archive.
The original array remains intact and is not maintained as an up-to-date backup.
Optional null metadata from older cards becomes empty display text; word,
definition, IDs and mastery must be valid. Unassigned cards with an empty book ID
remain supported. Pre-isolation, unattributed data is not adopted automatically.

Unreadable JSON, stored `null`, duplicate IDs, invalid mastery values and
unsupported/inconsistent archives block changes instead of being replaced with
an empty collection. Notebook shows a persistent notice and **Try again** action.
Definition lookup and note creation remain available; vocabulary Save, ratings,
and combined export/upload wait for readable saved data. Persistent corruption
may need a reviewed recovery tool; this step does not reset it automatically.

Older APKs cannot read new archive changes. Export using the new APK before any
downgrade. Later changes written to the old array by an older APK are not
automatically reconciled into the new archive.

## Confirmed saves and startup merge

Dictionary Save waits for storage acknowledgement before reporting success and
closing. Duplicate taps are blocked while pending. A failed save keeps the
definition/context open and displays an inline error. Flashcard ratings behave
the same way: a failed rating keeps the revealed card open, and the saved level
does not change until the write is confirmed. Success messages say **on this
device**; a network backup is a separate operation.

Queued updates read durable state, including saves from another mounted instance
of the same account. New cards receive IDs with a random suffix. Mastery changes
update the existing record without replacing its definition or source context.

Startup adds valid cloud-only cards and preserves existing device records by ID,
including mastery changed offline or while the cloud fetch was pending. Invalid
cloud records are skipped with a notice. New cloud cards are shown only after
their local cache write succeeds. A failed local read prevents cloud import.

Book removal records the removed book ID alongside the vocabulary collection.
Stale cloud cards for that book stay suppressed in this device's archive after
restart; other books and unassigned cards remain. Book removal still spans several
separate writes (bookmarks, highlights, vocabulary, library metadata and files).
If vocabulary removal fails after the earlier stages, the book is kept and the
app reports that bookmarks/notes were already removed. It is not one atomic
transaction. The final library update uses the current list so an import completed
while removal was pending is retained.

## Limits and evidence

Cloud uploads remain best-effort after local confirmation. There is no durable
network outbox, cross-device deletion protocol or field-level conflict resolution
in this step. Existing device cards win during merge; a different device's edit
to the same ID does not replace them. Review other-device changes before manual
**Upload to Supabase**. Book metadata retains its older storage/merge path;
[reading preferences](reader-settings-storage.md) have their own confirmed archive.
Profile's library metadata backup does not include these cards or archives.

Tests cover read/write failures, acknowledgements, concurrency, restart, malformed
data, stale cloud results, account/backend/Guest isolation, book-removal markers,
retained definitions/cards and disabled export/upload. They use storage and native
adapters. They do not prove native storage behavior under process death/power
loss, live Supabase synchronization, device layout or TalkBack focus. Follow the
[step 13 phone checklist](android-testing.md#vocabulary-and-mastery-storage-step-13).
