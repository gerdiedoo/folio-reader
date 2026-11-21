# Portable safety copies

Open Account → Portable safety copy in Folio Dev. This also works in Guest.

1. Leave **Include original EPUB files** selected to include available originals,
   or clear it for a smaller ZIP with saved reading work and available parsed text.
2. Tap **Export copy** and save the ZIP with Android's sharing sheet. Folio cannot
   confirm that another app actually completed its save; check the destination.
3. Tap **Choose a copy** to inspect a Folio ZIP. Review counts before restoring.
4. **Restore copies** adds separately identified books and linked saved work to the
   current reading space. Repeating restore adds further copies. Existing books,
   notes and deletion markers stay in place. Reading settings only change if the
   review checkbox is selected. Existing reading goals take precedence.

The file includes notes/reflections, vocabulary/mastery, bookmarks, reading
settings/goals, available reading text/covers, and optional original files. Missing
files are not downloaded during export or restore. Books without saved reading
text need their original EPUB; original EPUB presence is reported separately.
Notes referencing a removed/unavailable book remain present as unlinked saved work.

The ZIP is not encrypted. Store it privately. Supported limits are currently 350
books, 1,200 ZIP entries, 48 MB compressed, 96 MB expanded, and an 8 MB manifest.
This is a bounded in-memory implementation, not streaming backup for large libraries.
Remote cover URLs are not downloaded or carried as active image URLs; only owned
local cover files are included. Device paths, account identity and layout-specific
pixel offsets are excluded.

Portable jobs temporarily unmount the reading UI and wait for prior archive and
bookmark writes. Restore stages independently named files, validates a journal,
then writes target archives. After an interruption, the same account's reading
space stays closed until journal replay completes. Replay uses the stored target
snapshot, so it does not generate duplicate records. It acknowledges native storage
APIs; it does not establish power-loss durability of those APIs. Incomplete staging
before a journal is created can leave unused files if cleanup also fails.

Automated tests exercise real ZIP/XML-free manifest handling, expanded-size/CRC
checks, account-scoped archive merging, link remapping, failure preservation and
interruption at every metadata write. Native file picking, sharing, memory use,
TalkBack and actual process interruption still need Android validation.
