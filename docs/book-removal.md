# Library book removal

## Select several books

Hold a book for 400 ms to enter selection mode. The first hold requests Android's
native long-press haptic (a light impact on iOS). Feedback respects system/device
support; unavailable haptics do not prevent selection. A screen-reader action
named **Select book** offers the same entry without requiring a held gesture.

Tap more books to select or deselect them. Selected books have a checkmark and
expose a checked checkbox state. The compact toolbar shows the selected count,
**Select shown / Deselect shown**, **Remove**, and an exit button. Selection works
in two/three-column grids and list view. Sorting, filtering and search retain
selection by book ID. A warning counts selected books outside the current view;
Select shown affects only matching Library books, preserving other selections.
Recovery placeholders needing re-import are not selectable and are disabled
while selecting. Cover customization stays available outside selection mode.

Android Back or the exit button leaves selection without removing anything.
Selection is temporary and does not cross account boundaries or process restarts.
Disappearing books are pruned from selection. Library loading/errors prevent entry.

## Confirm removal

Remove opens one confirmation listing the selected titles and explaining that
saved files, bookmarks, highlights, notes and vocabulary will be removed too.
Cancellation keeps the selection. Zero selected books disables Remove. The dialog
blocks repeated submission and dismissal while the operation is pending. Singular
removal from book details uses the same persistence path.

Before starting, the app checks library/bookmark/note/vocabulary readiness and
rejects concurrent cover saves or removals. The reading UI unmounts during the job
so background archive hooks cannot overwrite it. A completed job reports the book
count and offers **Open Library**. An error leads to recovery instead of claiming
that all selected books have been kept or removed.

## Recovery and synchronization

`removeBooksWithRecovery` validates the entire selection against the latest saved
library and creates one account-scoped recovery journal for the whole batch.
Duplicate IDs are deduplicated. Missing or invalid IDs abort before recording a
new removal intent.

The journal contains the resulting library, saved-work archives, bookmarks,
preferences and goal. It records each removed book, note and pending file cleanup
while retaining all unselected work and older deletion markers. The intent is
saved before applying those archive writes. If interrupted, startup rolls it
forward before mounting the reading UI. File cleanup follows confirmed archive
writes; failed deletions stay queued for another attempt. This is recoverable
roll-forward, not a single native database transaction.

Signed-in account removals use the existing queued synchronization and legacy
cleanup retries; Guest removal stays local. Other devices may retain downloaded
files. There is no Undo or promise of immediate deletion on an offline server.
No Supabase schema change is required.

## Validation

587 regression tests and TypeScript pass, and the Android/Hermes bundle exports.
Tests exercise actual component handlers for long-press haptics, checked state,
selection across layouts/filters, hidden selections, cancel/Back, one batch
submission, pending/duplicate actions, missing haptics and unmounted callbacks.
Storage tests interrupt each journaled write and final journal clearing, recover
repeatedly, preserve unrelated books/work, reject stale selections, retain failed
file cleanup, and retry offline account removals within the original account.

These checks do not establish native focus, TalkBack speech or physical vibration.
A fresh APK is required for the new `expo-haptics` native module. Follow the
[phone checklist](android-testing.md#library-multiple-selection-and-removal).
