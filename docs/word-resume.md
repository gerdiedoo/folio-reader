# Pages and Line resume: step 16

Step 16 extends the [Scroll resume fix](scroll-resume.md) with source-word anchors
for Pages and Line. Install over Folio Dev without uninstalling or clearing data.
No SQL migration is required.

## Behavior

Pages previously stored only the imported passage number. When that passage
occupied several display pages, reopening selected its first display page.
The initial unmeasured layout could also use a different page index from the
final measured layout. Pages now records the first word's ordinal within the
source passage when turning a page. After measuring the viewport or changing
typography, it finds the display page containing that saved word. The old display
page number is not treated as a permanent location.

Line now records every active word within its source passage, including moves
within the same passage. Reopening starts at that word and remains paused.
Seeking and replay keep their existing pause/play rules. Returning to Pages from
Line opens the page containing the same word. Search in Pages or Line targets and
stores the matched word; Notebook/bookmark passage jumps intentionally start at
the passage's first word. User backward navigation remains supported.

Reader position changes still settle for 400 ms and flush on leaving/backgrounding.
A second timer schedules a save after at most two seconds of continuous updates,
so uninterrupted playback or dragging cannot reset the debounce indefinitely.
This is a JavaScript scheduling limit, not a guarantee against event-loop stalls,
native storage failure or process death. Local acknowledgement and best-effort
cloud delivery retain the step 15 behavior.

The reader remounts when a book's locally loaded text becomes available. Line
therefore initializes from the saved position instead of reporting a temporary
first passage before the saved text finishes loading.

## Data and limits

The optional `readingPosition.wordOffset` field lives in the existing scoped book
metadata alongside the source passage number. It is a zero-based whitespace-word
ordinal across both source paragraphs, independent of chapter/display page indices.
Invalid offsets fall back safely; oversized valid offsets stop at the end of that
passage. Earlier installs have only passage-level positions until they navigate
with the new APK. Previously lost word positions cannot be reconstructed.

Pages maps an anchor to a containing page after reflow; the exact screen page
number and first visible word can change when the viewport or fonts change.
Pagination still estimates wrapping. System font scale is included in that
estimate, but actual native text fitting and large-text layout need phone checks.
This does not add native line measurement or guarantee every language's word
segmentation. The source EPUB must remain the same.

Scroll keeps its layout-specific pixel offset from step 15. Switching between
Scroll and a word-based mode uses the source passage as fallback; there is no
pixel-to-word conversion. The cloud schema and Profile backup continue to store
passage-level progress, not precise word or viewport positions. Full cross-device
synchronization and a library storage migration are separate work.

Tests cover word preservation through pagination, repeated source passages,
viewport/typography/system-scale reflow, Pages reopen, paused Line reopen, search,
backward navigation, mode handoff and the bounded save timer. Existing Scroll
regressions remain included. Follow the
[phone checklist](android-testing.md#pages-and-line-resume-step-16) for native behavior.
