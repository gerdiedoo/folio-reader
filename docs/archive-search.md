# Global archive search: step 25

This step remains local on development until an APK is requested. No push,
APK build, new SQL or storage migration is part of it.

Global search now uses compact All / Books / Quotes & notes / Vocabulary chips.
A labeled search field has a 200-character limit, explicit Clear and Close
controls, and treats whitespace as no query. Clear keeps the category; the empty
results reset clears both query and category. Search state is not persisted.

Matching follows Library/Notebook: literal, case/accent insensitive terms must
match within one record, potentially across its fields. Books match title/author;
quotes include reflections, chapter and saved/current book titles; vocabulary
includes definition, context, chapter, part of speech and book title. This is
saved metadata/annotation search. Use Find in book for full reading text.

Results are grouped in a virtualized SectionList instead of rendering every
matching entry in one ScrollView. Books use the shared cover renderer, including
custom/default style and illustrated fallback. Status text uses the same reading
history rules as Library. Quotes/reflections and definitions have compact visual
excerpts; quote text remains available to accessibility and the full content stays
in the existing book/Notebook/card views. No large-archive device benchmark is
claimed by this change.

## Actions and availability

Book results open Library details. Vocabulary results now open the exact saved
flashcard after closing search; review is disabled while the vocabulary archive
is unavailable. Flashcard saves retain the existing archive status/busy guards.

A quote jump requires a ready local library, an existing book record and the exact
source passage loaded on this device. A metadata page count alone is insufficient.
Unavailable quotes remain readable in search and offer a route to Library rather
than opening an empty reader or silently clamping to another passage. This does
not automatically repair/relink missing book files or quote IDs. Valid quote jumps
open the saved source passage, not an exact word/intra-passage selection.

The shared App jump handler applies the same check to Notebook navigation, so a
stale result cannot bypass the UI guard. Passage numbers are validated as positive
safe integers; inherited object keys cannot be treated as loaded page files.

Each selected category reports relevant loading/errors. Partial results are labeled
as such; an archive failure is not displayed as a complete no-matches result.
Highlight/vocabulary read failures offer their existing retry callbacks. A library
index failure retains the existing restart guidance. Hiding a category hides its
unrelated status notice, without altering archive data or readiness.

## Validation

Tests cover category routing, normalization, literal punctuation, bounded/blank
queries, shared field matching, unchanged source records, exact loaded-passage
checks, action callbacks/closing order, missing-text protection, vocabulary review,
clear/reset semantics and partial loading/error retry. All 362 tests and TypeScript
pass locally. Device keyboard avoidance, SectionList layout/virtualization, focus,
TalkBack announcements and native navigation still await the
[phone checklist](android-testing.md#global-archive-search-step-25-awaiting-an-apk).
