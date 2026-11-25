# Development step — 25 November 2026

## Library

Today's reading time, the day streak and books finished this year share one compact
card. Continue reading remains directly below it. The separate bookmark/search
shortcut row is removed; Bookmarks is the first outlined action alongside the
collection filters. It opens the saved-bookmark sheet without changing the active
collection filter. Header search still opens the fixed title/author search input,
with query and filter reset behavior preserved.

Shelf density now accounts for both available width and system text size, rather
than forcing every large-text device to one column. Wide screens can retain the
requested two or three columns; narrow layouts still reduce density when needed.
Library and free books use the same calculation. The account notice also uses
app-neutral wording when describing preserved older data.

## EPUB fidelity

New imports preserve inline `white-space: pre`, `pre-wrap`, `pre-line` and
`break-spaces`, including inherited whitespace and explicit inline overrides.
Poetry remains prose rather than being mislabeled as code. Pages mode keeps blocks
with explicit line breaks or indentation intact instead of normalizing them into
prose; these blocks may scroll, like existing tables and code.

HTML `hidden` and inline `display:none` suppress their complete subtree, including
illustrations, before content or source anchors are collected. Table alternatives
apply the same exclusions to captions, row groups, cells and inline text.
`aria-hidden` alone does not remove visually displayed book text.

This is support for the listed HTML and inline declarations, not a publisher CSS
cascade or fixed-layout engine. Existing parsed copies are not silently reparsed
or replaced. Their original files, saved locations and annotations remain intact.

## Validation

- 529 regression tests passed, including the two review reproductions through the
  actual EPUB parser and ZIP fixtures, Pages preservation, table alternatives,
  Library search, bookmark access and adaptive shelf density.
- TypeScript checking passed.
- Android and iOS Hermes bundle exports passed.
- Eight Android automation helper tests passed.
- The Android journey now checks the combined reading totals and bookmark chip,
  and captures the reading summary at system font scale 1.5. Native execution is
  tracked separately in the GitHub workflow; an export is not a device test.

## Still open from the strict review

Reviewed recovery of preserved older libraries, edition-aware basic account
backup, larger portable archives, native measured pagination, live Google
sign-in/two-device reconciliation, actual provider downloads and full TalkBack
journeys still require further implementation or evidence. This step does not
certify deployed Supabase policies or live account behavior.
