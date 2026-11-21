# Reliability roadmap after step 27

This tracks the requested full roadmap; completing a stage does not establish
native/device validation for the whole product.

Completed in this development batch:

- Notebook no longer contains SQL, database setup or infrastructure configuration.
  Manual upload reports failure in reader-facing language and releases pending state.
- Removal has its own book-details entry and confirmation dialog; it is separate
  from the cover editor. Technical identifiers and paths are collapsed by default.
- Library metadata uses a versioned, account-scoped archive with queued read/modify/
  write operations. Cover changes, progress, imports, last-opened dates and explicit
  restores patch only the affected book/fields. The generic full-snapshot effect
  no longer writes the library. Book deletion markers suppress stale cloud rows
  after restart. Existing legacy `books` values remain preserved and are read only
  until the first confirmed archive mutation. Downgrading cannot see newer changes.
- Account → Portable safety copy exports notes/reflections, vocabulary/mastery,
  bookmarks, reading settings/goals, available parsed text/covers and optional
  original EPUBs. Guest can also use it. Restore previews counts and adds new IDs,
  remapping all saved-work links without replacing existing books. Reading settings
  are preserved unless explicitly selected. Device file paths and pixel offsets do
  not travel. Original missing files are counted honestly rather than fabricated.
- A restore journal rolls partially applied metadata forward before the reading
  space mounts. Portable jobs first unmount the reader and drain archive/bookmark
  queues. Staged files are verified before journal creation; a possibly written
  journal retains those files after an uncertain storage acknowledgement.
- Safety-copy import validates ZIP directory paths, versions, record shapes,
  references, CRC and declared/actual expanded sizes. Current memory-based ZIP
  handling limits compressed archives to 48 MB and expanded entries to 96 MB.
  Larger collections need a future streaming implementation. Native Android file
  picker, sharing destinations, image decoding and memory use remain untested.
- Account help now explains reading spaces and backup scope; OAuth provisioning
  instructions are no longer shown in the consumer app.
- Book removal also uses a journal with the reading UI unmounted. Interrupted
  bookmark/note/vocabulary/library changes complete before reopening the space.
  Owned file cleanup is stored with the library tombstone and retried on reopening;
  an unconfirmed cleanup acknowledgement is safe to repeat.
- Signed-in spaces retry recorded book/highlight deletions on opening/foreground,
  with bounded batches, backoff, per-operation durable receipts, and a Notebook
  status/retry action. These receipts acknowledge the current server deletion;
  they are not server tombstones and cannot stop another stale device re-uploading
  records. Local tombstones continue suppressing those records on this device.
- Original imports now write an intent after saving parsed text and before adding
  the library entry. An uncertain journal/library acknowledgement retains files;
  startup verifies and completes the import idempotently. Portable/removal jobs
  wait for active import commits. A damaged incomplete import can be set aside
  explicitly without deleting its remaining files or existing library records.
- New EPUB imports carry a SHA-256 file fingerprint and source-node paths. New
  reading positions, bookmarks and reader highlights carry file-specific anchors.
  Path resolution takes precedence over synthetic passage numbers; unresolved
  anchors report a mismatch rather than opening an unrelated numbered passage.
  Legacy imports/bookmarks retain their prior location behavior. Pixel offsets
  only survive when source grouping and the existing layout key both match.
  Backups preserve these anchors but exclude device-specific scroll pixels.
  New import IDs use cryptographic UUIDs; collisions cannot overwrite or roll back
  existing originals, reading text or covers. Existing cloud adapters still use
  their earlier, more limited location fields.

Still required as this roadmap proceeds:

- Durable account-scoped network retries and explicit multi-device conflict/deletion
  handling. The library archive is not a server synchronization protocol.
- Structured EPUB rendering and edition-stable annotation/reading anchors, with
  migration safeguards for existing paragraph-based imports.
- Orphan-file cleanup before a journal exists. Import, backup restore and book
  removal are now journaled; old pre-journal orphan files are not deleted blindly.
- Actual Android reading, offline restart, TalkBack, OAuth and two-account checks;
  performance measurements and later iOS/iPad validation. No adb/emulator or phone
  control is available in the current workspace.

Current library writes and recovery acknowledge filesystem/AsyncStorage APIs; they
do not guarantee survival through power loss. A safety copy contains private
reading work and is not encrypted. Durable upload queues, server tombstones,
revision conflicts and multi-device reconciliation remain separate required work.

## Remaining-critique implementation — 21 November 2026

The earlier “still required” list above describes the previous milestone. This
batch adds structured EPUB content, lazy loading and revision synchronization:

- New reflowable EPUB imports preserve short dialogue, headings, ordered and
  unordered list markers, emphasis, links, quotations, code whitespace, embedded
  PNG/JPEG/GIF/WebP images, supported static SVG and simple tables. Chapter and
  fragment references offer a return action. Unsupported fixed layout, MathML,
  interactive media, merged/nested tables and remote images reject explicitly.
  Publisher CSS is not a full browser layout engine. Existing imports retain
  their original parsed model and anchors; they are not silently reparsed.
- ZIP expansion, embedded image dimensions and serialized reading caches are
  bounded before a successful import. Native cache and portable-restore inputs
  validate structured content before rendering it.
- Scroll now maps native text lines to source word ordinals. Same-layout reopening
  retains measured pixels; reflow can locate the corresponding source line.
  Images and tables retain block-level fallback. Device confirmation is pending.
- Library parses only an opened book, keeps a two-book LRU, and virtualizes rows.
  Continue reading and daily activity take less space. Search/filter/sort/view
  preferences persist per reading space. Failed opens retain actionable details.
- Dictionary cards retain their source anchor and offer **Read in book**. A failed
  or uncertain new note/card save retries its identity without duplicating it.
- Large JSON archives use bounded immutable segments and an acknowledged commit
  pointer, avoiding Android’s per-row cursor limit. Interrupted segments never
  replace a confirmed archive; reads finish before old segments are cleaned up.
- Personal records and pending mutations share one local write. Foreground retry,
  compare-and-swap revisions, persistent server tombstones, owner checks, explicit
  conflict review and full source-anchor transport replace best-effort uploads.
  The required Dev migration and exact deployment limits are in
  [revision-sync.md](revision-sync.md). It is tested, but not deployed remotely.
- Portable recovery can reuse matching edition identities on another device and
  preserve newer existing work. Separate-copy restore remains available. Owned
  files are never replaced with different bytes. Recovery may keep staged files
  if an acknowledgement is uncertain, so a retry can finish safely.
- The APK workflow now includes a disposable Android emulator journey with an
  illustrated fixture, reopening/restart checks, bookmarks, reflection creation,
  screenshots and startup timing. Evidence becomes available only after that
  workflow actually executes; adding automation is not evidence it passed.

Still needed outside implementation: deploy the Dev migration, run the two-device
check, test TalkBack, real phone file sharing/OAuth, sustained reading comfort,
large-book memory/energy measurements, and iOS/iPad native journeys. Emulator
screenshots and Hermes exports cannot establish those outcomes. Streaming large
archives, a complete publisher-CSS engine, and old orphan-file collection remain
future work with explicit current limits.
