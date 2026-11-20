# Confirmed cover editing: step 18

Install over Folio Dev without uninstalling or clearing data. No new SQL is needed.

## Apply and draft behavior

Apply now waits for a confirmed device save before closing. It shows **Saving…**
and blocks duplicate Apply, photo selection, edits, removal and dismissal while
pending. A failed save retains the selected style/color/photo/URL with an inline
error and permits retry. Unexpected callback errors say the result could not be
confirmed and suggest checking Library, rather than claiming success.

Photo selection is a draft: selecting or cancelling a photo does not create a
permanent cover file. Android uses the system picker without requiring broad
photo-library permission. The iOS editing path retains its permission request.
Permission/picker failures leave the prior draft available. Late picker/save
results cannot change an unmounted editor or close another screen.

An image URL must be a valid public HTTP/HTTPS address without embedded login
credentials. Prefer HTTPS; hosts, connectivity and platform cleartext policies
can prevent an otherwise valid address from loading. Saving confirms storage,
not a successful remote-image fetch. Blank URL text keeps the current image.
Choosing a photo replaces the URL draft; typing a URL replaces the photo draft.
Applying Typographic keeps the previously saved image, without copying an unused
selected photo. Closing/cancelling discards unsaved editor choices.

## Photos, metadata and colors

Apply copies a selected photo into the current reading space's covers directory.
The copy must exist and have nonzero size. Failures throw instead of returning a
temporary picker URI. Filenames include a timestamp/random suffix with a distinct
separator; collisions never overwrite/delete an existing cover. Partial copies
are cleaned up where possible. The original selected photo is never deleted.

The filtered cover changes are then written through strict library metadata
storage. Only after acknowledgement are cover fields published and a best-effort
cloud upload attempted. A failed metadata write cleans only the newly created
custom photo, keeps the old cover and reports any cleanup failure. A successful
replacement can clean the previous owned custom cover; imported/original files,
other books' files and other reading spaces are excluded. Prefix/case differences
between book IDs are checked. Cleanup failure is a warning after a confirmed save.

The editor applies only cover fields to current in-memory book records, so a stale
editor snapshot cannot reset reading progress, annotations or other entries when
publishing. The existing whole-library storage path remains; this is not an atomic
migration of concurrent imports, progress updates and other metadata writes.

Cloth colors now persist as optional `Book.coverTint` metadata and appear on library
covers and typographic fallbacks after restart. Older/malformed colors fall back
to Parchment. Preview color overrides remain local to the draft. Local photo files
and cloth color are device-only; the existing cloud schema/metadata backup does
not contain them. Existing device records take precedence over startup cloud rows.

## Validation

Tests cover acknowledgements, failures/retry, partial-copy rollback, filename
collisions, scoped cleanup, URL validation, reading-state preservation during
publication, color rendering, picker cancellation/errors and unmounted editors.
Controls expose names/selection/disabled/busy states and larger touch targets;
the URL field uses theme-aware colors. Native photo permissions, cropping,
storage failures, image decoding/hosting, layout and TalkBack still require the
[phone checklist](android-testing.md#book-cover-saves-step-18).
