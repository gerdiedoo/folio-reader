# Unified book discovery

Browse books now starts with Open Library work metadata, including contemporary
and metadata-only books. A work appearing in this catalog does not promise access
to its text. No API contains every published book.

## Find a book

The All books opening page uses Open Library's recent-trending feed. Title and
author searches use its full work-search API without public-scan or EPUB-only
constraints. Results include title, authors, first publication year,
edition count, languages and Archive identifiers where supplied. Metadata is
paged in groups of 18. The default opening path does not execute a match-all
search. Explicit subject searches can use an edition-count sort, with spelling
suggestions disabled. Newest published uses Open Library's `new` sort (first
publication year); title/author sort only the loaded results, as labeled.

EPUB source chips query the selected provider's existing catalog, then batch-match
those titles to Open Library metadata. This searches that provider's catalog,
not just the current 24 Open Library rows. Matching work IDs group compatible
editions. Provider listings with no confident Open Library match remain visible
with source metadata and a typography cover; they are not mislabeled as Open
Library records. A failed metadata lookup leaves provider results usable and
shows a retry notice. Filtered result counts describe loaded works, not a claimed
complete cross-provider index. Pagination retains each provider's real cursor.

Open Library is the metadata catalog. Its Archive-linked EPUBs appear under
Internet Archive, avoiding a second Open Library entry in the EPUB-source filter.
The existing legacy Open Library download adapter and catalog mappings remain
compatible with earlier imported books.

## Book details and download choices

Details load independently of EPUB checks, so a description can be read even if
all providers are offline or no downloadable edition is found. The existing
native description formatter displays paragraphs and HTML emphasis safely.

Download choices use compact divider rows with inline actions. Additional editions
stay collapsed until requested, with language and edition labels retained. One
slim transfer bar remains visible above both details and results; it shows actual
percentages when available, a reduced-motion-aware waiting indicator otherwise,
and a separate preparation state until the Library save is confirmed. Cancellation
remains available during transfer.

Successful local imports and catalog downloads reset the Library to All Books,
clear search/selection and reveal the just-saved book first in Recent for that
viewing session. They preserve grid density and do not fabricate a last-read date.
Cancelled or failed saves retain the previous Library filters.

The EPUB sources section checks Gutenberg, Standard Ebooks, Internet Archive,
Google Books, OAPEN, DOAB, Wikisource and Feedbooks. Three provider checks can run
at once. Every provider independently reports checking, matching editions,
no match in this check, unavailable service, or Google key setup. Errors never
stand in for a definitive absence of EPUBs. Each failed/missing check can be retried
without resetting successful providers. Closing/changing the book or Google key
cancels obsolete work and ignores late results.

Candidates are matched conservatively by title and author. Different authors,
conflicting subtitles and numbered volumes are not silently combined. Known
source records and work-linked Archive IDs retain their explicit association.
Checks inspect one provider search page and at most three matching editions;
there is no claim of exhaustive availability. Translations or unusual metadata
may need a different source/search. A source catalog listing is rechecked in
details before a download option is offered, and download revalidates it again.

Existing access rules still apply: unrestricted Archive EPUBs, free/full-view
Google EPUBs, compatible Standard Ebooks files, verified OAPEN EPUB bitstreams,
DOAB links hosted by OAPEN, and the existing legacy Feedbooks restrictions.
Wikisource offers Generate EPUB rather than claiming a pre-existing file. No
borrowing, preview, DRM, purchase or PDF conversion is added.

Google Books still uses each reader's own device/account-scoped key. All books
and the other providers do not require it. Key management is also reachable from
the Google source row, including after a credentials error. No reader key enters
Open Library metadata URLs, shared metadata caches, archives or source records.

## Covers and saving

The catalog uses Open Library cover IDs with `default=false`, so missing images
return an error rather than Open Library's blank placeholder. Missing or failed
images use a typographic cover. Catalog cards and details do not substitute a
publisher/source image or a decorative illustration when Open Library art is
absent. Existing Library covers and explicit custom covers are not rewritten.

Choosing an EPUB downloads that provider's edition through the existing bounded,
cancellable import pipeline. Open Library artwork takes precedence over embedded
art for this new discovery flow; a missing catalog cover selects typography.
The acknowledged import saves shortcuts for both the work and selected edition,
so the work gains its Library badge and Read action only after storage succeeds.
Failures remain retryable at the affected source; they do not mark a work saved.
Duplicate-title confirmation, preparation guards and account isolation remain.

## Network behavior and validation

Anonymous Open Library metadata requests are serialized, start at least 1.1 seconds
apart, and use a bounded two-minute in-memory cache. Open Library gets a 25-second
request deadline; the other providers keep their ten-second default. Network/5xx
failures retry once in a new paced slot. Timeouts, invalid responses and rate
limits require an explicit retry. Provider-filter enrichment batches eight titles
per request, with spelling suggestions disabled. No full catalog is downloaded.

Successfully loaded All books pages also use an optional account-scoped device
cache: up to 12 pages, expiring after seven days. A saved page appears immediately
while refreshing; an unsuccessful refresh retains those books with a dated saved
results notice and Retry. Query, subject, page and server sort have distinct cache
keys. Switching searches or accounts cannot display an older in-flight result.
The cache stores only sanitized Open Library metadata, not provider EPUB links,
Google keys, descriptions, availability results or Library ownership. Cache errors
do not turn a live success into a failed catalog load.

639 regression tests, TypeScript and Android/iOS Hermes exports pass. Automated
coverage includes contemporary works without EPUBs, covers and failed images,
provider-filter matching/deduplication, incorrect author/volume rejection,
independent availability/error/retry states, cancellation and reader-key changes,
selected-edition import, storage acknowledgement, and work/edition shortcuts.
The existing Android journey uses the updated Browse books/search labels.

The workspace's enforced network policy excludes the live book-provider hosts.
Open Library query fields and sorting were checked against its public work-search
implementation; fixture tests establish contracts, not service uptime or current
catalog coverage. Live book search, source downloads, native layout and screen
reader behavior still need the phone checklist. No Supabase migration is needed.


## Compact browse controls and timeout recovery — 27 November 2026

The reported timeout used the generic ten-second deadline on a broad, unsorted
catalog request. The client now uses the smaller page, explicit browse sort,
reduced projection, no spelling suggestions, separate deadline, paced transient
retry and saved-page recovery described above. These changes reduce avoidable
request work and preserve useful results; they cannot guarantee upstream uptime.

The top area keeps one source-chip row. Subjects and sort choices open scrollable
bottom sheets from compact controls beside the column/list toggle. The repeated
subtitle/source heading and permanent subjects/sort strips are removed. Shared
Library/catalog chips use 28-point rounded rectangular faces (radius 8) inside
48-point touch targets. Large system text wraps the toolbar. Sort/subject sheets
have explicit bounded heights, and closing them preserves the current query.
The native journey also opens both menus and verifies retained search text.

The successful phone-browser Frankenstein response also has a regression fixture,
including its work ID, subtitle, cover ID, author and a representative Archive
identifier list. It confirms response parsing independently of request latency.


## Startup feed and grid loading

Phone testing established that title searches worked while the empty match-all
request still failed. The default opening page now requests
`/trending/now.json?limit=18&page=1` with a compact metadata projection. The user
confirmed this feed loads in the phone browser. Open Library's public source and
endpoint tests establish its work-document schema, fields and pagination. It uses
recent reading-log IDs rather than a whole-index search. A missing/incompatible
now route can fall back to the daily feed; startup never falls back to `q=*:*`.
Explicit title/author queries, subjects and newest publication still use search.

The feed is labeled Trending books, with a loaded count and no claimed
whole-catalog total. Pagination uses the real page parameter and stops on a short
or empty page. The existing account-scoped cache accepts the feed's URL and
collection label separately from search pages. EPUB availability and covers retain
the existing behavior.

Initial and pagination placeholders use the current shelf layout: two or three
cover columns, actual calculated card widths, 2:3 cover proportions and matching
spacing. Large-text column fallback is respected. List mode retains list rows.
The placeholders are noninteractive and expose one indeterminate loading state,
rather than announcing fake book cards. Their shape updates immediately when the
view/column control changes during a request.
