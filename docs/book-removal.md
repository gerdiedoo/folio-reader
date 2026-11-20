# Confirmed local book removal: step 17

This step improves the removal confirmation in the Library's book editor.
Install over Folio Dev without uninstalling or clearing data. No SQL is needed.

## Confirmation and failure

The dialog previously closed as soon as Remove was tapped, even if the operation
later kept the book because bookmarks, notes or vocabulary could not be removed.
It now waits for a structured result. While pending it displays **Removing…** and
blocks duplicate taps, Cancel, close, backdrop dismissal and Android back through
the modal's close handler. A local failure leaves the confirmation open with an
inline error and permits retry or cancellation. Unexpected exceptions say removal
could not be confirmed, rather than claiming the book/data were definitely kept.
Leaving the screen through an account change does not let a late result close a
different screen.

The confirmation names the book and the affected local data. It no longer promises
that a connected database will always be cleaned up. Its content scrolls for large
text, and the buttons expose names, disabled/busy states and 48-point targets.

## Local order

Removal waits for readable, idle library/bookmark/note/vocabulary state. It then
removes bookmarks, highlights/reflections and vocabulary through their existing
stores. After those writes, it saves the filtered library with strict storage
acknowledgement. Only then does it remove the visible entry/loaded text and attempt
deleting the owned local files. Failed index storage keeps the entry and book files.
The in-memory update filters the current list so other entries completed during
annotation cleanup are retained.

These are separate writes, not one transaction. If a later stage fails, earlier
bookmark/note/card removals may already have completed. The error identifies that
partial outcome. Cancel does not restore those records, and their existing
book-removal markers can prevent new notes/cards on the kept book until removal
is completed or the EPUB is imported under a new ID. Export important records
before confirming removal.

If the index was saved but some file deletions fail, removal is still confirmed
and a separate warning says files remain. There is no orphan-file cleanup UI in
this step. Cloud cleanup starts only after local completion and does not hold the
dialog open while offline. A cloud failure is reported separately, retaining any
local-file warning. Guest removal never requests a server deletion.

## Limits and checks

Cloud cleanup remains best effort. This does not add a durable book-deletion
journal, retry queue, server deletion protocol or full library storage migration.
A surviving/stale cloud book row can return at startup, and other devices may
retain their copies. The existing generic library persistence/concurrent mutation
paths are not converted into an atomic transaction by this step.

Tests cover pending/duplicate/dismissal behavior, failures at each local stage,
storage acknowledgement before file deletion, retry, unexpected errors, offline
cloud requests, partial file cleanup and unmounted dialogs. Native storage faults,
actual cloud deletion, TalkBack focus and device layout still need the
[phone checklist](android-testing.md#book-removal-confirmation-step-17).
