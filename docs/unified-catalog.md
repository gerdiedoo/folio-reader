# Unified book discovery

Browse books now starts with Open Library work metadata, including contemporary
and metadata-only books. A work appearing in this catalog does not promise access
to its text. No API contains every published book.

## Find a book

The All books filter queries Open Library's work search without public-scan or
EPUB-only constraints. Results include title, authors, first publication year,
edition count, languages and Archive identifiers where supplied. Metadata is
paged in groups of 24. Newest published uses Open Library's `new` sort (first
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
apart, and use a bounded two-minute cache of public metadata. Each request has the
existing transport deadline and one attempt per slot; explicit retries are also
paced. Provider-filter enrichment batches eight titles per request instead of
sending a lookup for every cover. No full catalog is downloaded or maintained.

606 regression tests, TypeScript and Android/iOS Hermes exports pass. Automated
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
