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

Still required as this roadmap proceeds:

- Durable account-scoped network retries and explicit multi-device conflict/deletion
  handling. The library archive is not a server synchronization protocol.
- Complete portable backup/import of saved work and optional original files.
- Structured EPUB rendering and edition-stable annotation/reading anchors, with
  migration safeguards for existing paragraph-based imports.
- Recoverable journals for multi-store/file import/removal and orphan-file cleanup.
- Actual Android reading, offline restart, TalkBack, OAuth and two-account checks;
  performance measurements and later iOS/iPad validation. No adb/emulator or phone
  control is available in the current workspace.

Current library writes acknowledge AsyncStorage's API; they do not guarantee
survival through power loss. Book removal still spans multiple archives and files.
