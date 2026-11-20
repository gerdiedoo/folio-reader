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
