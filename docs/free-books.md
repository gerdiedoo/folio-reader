# Free books and illustrated thumbnails: step 20

Install over Folio Dev. No uninstall, clearing data, new SQL or account setup is
needed. Open Library → Browse free books. Source chips now offer:

- **Project Gutenberg:** English EPUBs via Gutendex. If its live catalog fails,
  the screen explicitly shows matching books from a bundled 19-book starter
  collection, or a previously loaded in-memory page. This is not the complete
  catalog or an offline download service. Retry live catalog attempts the service
  again; failed subsequent pages never append unrelated starter results.
- **Standard Ebooks:** its public website catalog, illustrated covers and compatible
  EPUB links. This uses the public site, not the subscription OPDS feed. Download
  links use the site's normal `source=download` parameter so the native downloader
  receives the EPUB instead of its HTML thank-you page. Unreleased placeholders
  are excluded. The site does not expose a reliable total in this view, so the
  screen reports books loaded rather than an invented total.
- **Internet Archive:** search for text editions dated before 1931 with an EPUB
  format and an explicit unrestricted-access flag. Item metadata is checked again
  for dark/restricted/private/encrypted files. Actual EPUB filenames come from
  metadata; there is no borrowing, DRM removal, account login or guessed filename.
  Metadata errors, missing EPUBs, poor OCR and regional availability remain possible.

Search/topic results stay within the selected source. Switching sources cancels
old requests and ignores late results. Each source supports pagination; failed
pages keep existing results and offer retry. Title/Author sort the loaded results;
Popularity uses provider ordering. Newest added uses Standard Ebooks/Archive dates
and approximate Gutenberg ID order, not original publication date. Topic matching
uses the provider's search language, so results may differ between sources.

## Error recovery and downloads

Catalog requests have a 10-second deadline including response bodies. A network
failure or server 5xx gets one retry; rate limiting does not cause immediate repeat
requests. Invalid responses show an error instead of becoming an empty success.
Source-specific cached pages expire after two minutes; stale fallback pages are
explicitly labeled and not presented as a fresh response. Cache is in memory only.

Downloads are cancellable and have a 60-second deadline per transfer. Gutenberg
tries its illustrated EPUB 3 endpoint first, then supplied/older EPUB alternatives
(up to three distinct URLs). Other sources resolve real download links first.
Files must have a ZIP signature and sensible size; parsing still validates actual
EPUB content. Transfers above 40 MB stop with a clear message to try a smaller
edition or import a file. Native tasks are released and failed/cancelled cache
files are removed where possible, including ignored late completions. Cache
cleanup is best effort; app termination is not a durable cleanup transaction.

Failures remain beside the affected book with a Retry action and do not mark it
as added. A global active-download panel offers Cancel even after changing the
search/source. Closing the catalog cancels downloading. Once Preparing/saving
begins, close/back wait for the import outcome. Late results cannot import after
a cancelled transfer or update an unmounted catalog. Confirmed library storage
precedes the Read shortcut. If shortcut bookkeeping fails, the book remains saved
and the message tells the reader to open Library. A shortcut cannot offer Read
without loaded text on this device. Existing title-duplicate confirmation remains.

Library/text storage remains scoped to the current Guest/test account. This step
does not migrate catalog identity into the cloud backup schema; automatic cloud
recovery is still based on the previous Gutenberg/title lookup path and does not
promise an exact Standard Ebooks or Archive edition on another device.

## Initial covers

New EPUB imports use image style. Embedded publisher artwork is preferred and
saved locally; EPUB 3 SVG wrappers around raster images now resolve to the actual
JPEG/PNG. Catalog art is a remote fallback when no embedded cover is available.
If art is absent or fails to load, a bundled landscape/botanical illustration with
title and author appears offline. It is decorative Folio artwork, not a claim to
reproduce an original book cover. It is deterministic for title/author and needs
no image API or generated-image service. Explicit Typographic choices and saved
custom photos/colors remain available; existing covers are not silently rewritten.

The form scrolls with results so errors/controls remain reachable on short screens.
Larger text uses a single grid column; controls expose names, selection and busy
states with larger touch targets. Native layout/focus remains a device check.

## Validation limits

Provider parsing, malformed responses, deadlines, retries, cancellation, late
results, fallback labeling, file validation/cleanup, import acknowledgement and
cover extraction have automated tests. Standard Ebooks selectors/download behavior
were checked against its [public website source](https://github.com/standardebooks/web/tree/452aaed6707714039b1f0b88c5c624cf48bf155a).
The workspace network proxy denies live connections to these book hosts. Local
fixtures and Android/iOS bundle exports cannot prove live service reachability,
redirects, native storage or image decoding on the phone. Follow the
[Android checklist](android-testing.md#free-books-and-initial-covers-step-20).

## Browse shelf membership — 26 November 2026

Browse cards show artwork, title and author, with no Get/Read footer. Opening a
cover or title still shows details with the existing Add to Library/Read actions.
Failed downloads retain their named Retry action and error; active transfers
expose progress and preparation state.

A small book-and-check badge at the cover's top left indicates library membership
in grid, list and detail views. Saved catalog mappings identify known copies;
normalized title plus author also recognizes imported works. Membership is
separate from having readable EPUB text on this device. Metadata matches do not
redirect Read to an unverified edition. Removed books lose their badge, and new
downloads gain it only after the library save is confirmed.

Regression coverage checks both shelf layouts, details navigation, imported and
mapped membership, unavailable text, removal, deferred import acknowledgement,
retry/progress accessibility and fallback-cover badges. 543 tests and TypeScript
checks pass. This update is on development.

## Additional providers and reader-owned Google keys — 26 November 2026

Gutendex (the Gutenberg source), Standard Ebooks and Internet Archive were already
implemented; no duplicate source entries were added. Browse now also offers:

| Source | Discovery and download behavior |
| --- | --- |
| Open Library | Public-scan/public-access work search. Rechecks Internet Archive metadata and actual unencrypted EPUB files before downloading; borrowing-only entries are excluded. |
| Google Books | `free-ebooks` + `download=epub`; requires full viewability, free/public-domain status and a direct EPUB link. Previews, purchase-only books and ACS/DRM token links are excluded. Availability is rechecked with the current reader's key before download. |
| OAPEN | Open-access repository metadata, original bundles and verified EPUB bitstreams. Supports legacy REST and modern DSpace discovery/file graphs. PDF-only records are excluded. |
| DOAB | Directory metadata followed to an OAPEN public handle and verified EPUB. This integration includes OAPEN-hosted EPUBs, not arbitrary external publisher downloads or PDF links. |
| Wikisource | English main-namespace works with MediaWiki metadata, excluding missing/disambiguation/chapter pages. Downloads are generated by WS Export in EPUB 3 format. The generated file still undergoes Folio's ZIP and EPUB validation. |
| Feedbooks | Legacy public-domain OPDS, free acquisition links, discovered OpenSearch templates and next links. Paid/sample/borrowing links and untrusted hosts are excluded. Service availability has not been established here. |

Repository and Google filtering can produce no EPUBs on a metadata page while
additional pages exist. Browse explains this, leaves an explicit Load more action,
and does not automatically page through empty results. Informational format/source
notes do not show a failure-retry button. Source order replaces a popularity claim
where providers do not supply download rankings; unsupported newest sorting is
hidden. Source changes cancel catalog and follow-up requests.

### Google Books setup

Open **Browse free books → Google Books → Google Books setup**. Each reader can
paste their own API key, replace it or remove it. Enable the Books API in the key's
Google Cloud project. Google application/API restrictions and project quotas must
permit the request. Saving a key confirms device storage, not Google authorization;
rejections are reported in the catalog without displaying keys or raw API errors.
Other sources work without a Google key.

The key uses Expo SecureStore, Android Keystore/iOS Keychain, and a SHA-256 name
scoped to the existing backend/account/Guest storage boundary. It is not written to
AsyncStorage, library archives, portable exports, cloud synchronization, source
metadata, logs or repository configuration. The secure-store plugin excludes its
Android preferences from system backup; iOS uses `WHEN_UNLOCKED_THIS_DEVICE_ONLY`.
Different accounts and Guest do not inherit one another's key. A reader configures
their key separately on another device. Main and Dev use their own app sandboxes.

Editing is masked, autofill is disabled, duplicate writes/dismissal are blocked
while saving, and native read-back confirms replacement/removal. Unreadable secure
storage must be checked again before mutation. Late callbacks cannot update an
unmounted reading space. Google catalog requests do not reuse another reader's
access check, and replacing/removing a key cancels older requests.

### Verification and limits

568 regression tests cover provider schemas, filtering, credential isolation,
rejected access, downloads, source cancellation, pagination, XML entity rejection,
bounded repository lookups, key acknowledgement and setup UI. Android and iOS
Hermes exports and Expo secure-store plugin configuration are checked separately.
The Android journey adds native encrypted save, process restart and removal using
a synthetic, nonfunctional key. It does not prove live Google authorization.

The workspace's enforced destination allowlist denies all book-provider hosts;
requests fail at its proxy before reaching the providers. Official Google Books
API schema, DSpace REST contracts and WS Export routes were inspected in their
public source repositories. Fixture tests establish integration contracts, not
current service uptime, rate limits, Feedbooks continuity or real-book downloads.
Phone checks remain necessary for each live provider and a valid Google key.

Existing account book-list restoration still looks up Gutenberg titles. Use a
portable safety copy with original EPUBs to preserve other providers' exact editions
and generated exports. This feature adds no Supabase schema migration.
