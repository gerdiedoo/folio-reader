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

Still required as this roadmap proceeds:

- Durable account-scoped network retries and explicit multi-device conflict/deletion
  handling. The library archive is not a server synchronization protocol.
- Structured EPUB rendering and edition-stable annotation/reading anchors, with
  migration safeguards for existing paragraph-based imports.
- Recoverable journals for original EPUB import and orphan-file cleanup before
  a journal exists. Backup restore and book removal are now journaled.
- Actual Android reading, offline restart, TalkBack, OAuth and two-account checks;
  performance measurements and later iOS/iPad validation. No adb/emulator or phone
  control is available in the current workspace.

Current library writes and recovery acknowledge filesystem/AsyncStorage APIs; they
do not guarantee survival through power loss. A safety copy contains private
reading work and is not encrypted. Durable upload queues, server tombstones,
revision conflicts and multi-device reconciliation remain separate required work.
