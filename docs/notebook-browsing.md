# Notebook browsing: step 23

This change is saved locally on development and awaits a later APK request. No
push, APK build, reinstall, new SQL or storage migration is part of this step.

Notebook now has a compact heading, rectangular New Quote action, closer section
spacing and a smaller book selector. Shared entry filters retain the compact
style introduced in steps 21–22. Text sizes in saved quotes/cards are unchanged.

## Search and results

Search is local and limited to 200 characters. It matches literal, case/accent
insensitive whitespace-separated terms across fields within the same entry.
Highlights match quote text, saved reflections, chapter and book title. Vocabulary
matches the word, definition, context, chapter, part of speech and current book
title. A highlight's saved book title remains searchable if its Library record
is unavailable. Search does not combine words across different entries.

The selected book, entry filter and search intersect. Notes requires a nonblank
saved reflection. Clear search keeps the current book and entry type. The empty
results action, Show all entries, clears all three browsing constraints. These
choices are view state, not stored preferences; changing tabs/restarting can reset
them. Browsing/reset actions leave quote and reflection drafts intact.

Counts distinguish highlights from vocabulary cards. An All Entries view with
vocabulary cards no longer presents a false empty-highlights message. Search
misses, missing reflection notes, missing vocabulary and a truly empty Notebook
have different explanations. Loading/error states for the displayed entry types
suppress empty claims and are included in the result summary. Existing archive
retry controls and write guards remain. A failure in the hidden highlight archive
does not prevent an otherwise ready vocabulary view from showing its own results.

## Book selection and quote filing

The book selector exposes its expanded state; choices expose their full names and
selected state. If the selected book disappears, the selector says it is unavailable
rather than displaying All Books while silently filtering by another ID. New Quote
is disabled for that missing selection until another book/all-books is chosen.

A new quote is pinned to the book selected when its dialog opens. Under All Books,
the existing first-book default remains and the dialog names it for review. A list
reorder while the dialog is open cannot redirect the quote to another book. If
that book disappears, saving is disabled, the draft remains and an inline message
explains how to choose another book. Closing and intentionally reopening the dialog
under another book retains draft text and displays the newly chosen filing target.

## Export and upload scope

Export still includes all highlights and vocabulary in the selected book scope,
independent of search and entry filters. Its count now includes vocabulary cards;
the explanatory text states that browsing filters do not restrict the export.
Cloud upload still sends all current records in the reading space. Its scope is
stated separately. This step does not change archive storage, conflict handling,
deletions, upload ordering or Markdown format.

## Checks

Pure tests cover matching, literal punctuation, normalization, book/type intersections,
blank reflections, query limits, unchanged input order and export scope arrays.
Component event tests cover result/empty/loading/error states, book-picker semantics,
clear/reset behavior, preserved reflection drafts, quote-book pinning and missing
book protection. TypeScript and the regression suite run locally. Native layout,
TalkBack focus and keyboard behavior await the [phone checklist](android-testing.md#notebook-browsing-step-23-awaiting-an-apk).
