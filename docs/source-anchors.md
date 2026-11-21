# Source locations and original import recovery

New imports use SHA-256 of the exact original EPUB bytes as their file identity.
New import IDs use native cryptographic UUIDs; existing original/text/cover files
cannot be overwritten by an import identifier collision.
Each reading block carries its chapter ZIP path and the path to its first source
node. New saved reading positions, bookmarks and reader highlights carry that
identity/path plus a word offset. Source paths resolve before synthetic reading
passage numbers, including when blocks are regrouped into different passages.
An unresolved identity/path does not fall through to an unrelated numbered page.
Reader reports unmatched progress; Bookmark/Search/Notebook refuse unmatched jumps.

These are Folio version 1 source anchors, not EPUB CFI or interoperable annotations.
Repackaging the same EPUB changes its byte fingerprint and is conservatively treated
as a different file. Existing plain-text imports are not reparsed automatically;
their saved actions retain their previous passage-based behavior. Legacy anchors
cannot be fabricated safely. Future parser changes must preserve source-path
meaning or explicitly version/migrate this model. Cross-edition quote matching,
external annotation exchange and renderer layout fidelity remain separate work.
Anchors currently travel in portable safety copies. The existing cloud table
schema/upload adapters do not yet carry this richer location model.

Word offsets are useful in Pages and Line. Scroll still restores measured intra-
passage pixels only for the same layout/source grouping, otherwise opening the
anchored passage. It does not yet measure exact word-to-screen coordinates.
Bookmarks open source passage context; their stored numeric labels can refer to
the original grouping after a future migration. Highlights currently choose the
first matching quote within their source passage when identical text repeats.

Original import writes an account-scoped intent after parsed text exists and before
publishing a library entry. Original copies check destination size. After an uncertain
journal/library acknowledgement, files remain for recovery instead of being deleted.
Startup runs before archive hooks, checks an interrupted import's owned files, and
adds the entry once. An existing removal marker wins. A matching already-confirmed
entry only needs its intent cleared. Corrupt/conflicting intents keep their files.
The user can explicitly set an incomplete import aside and open the existing library.
Files created before an intent can still remain after a crash; this change does not
blindly scan/delete old orphan files or establish physical power-loss durability.
The filesystem adapter verifies expected original byte size and parsed page count/
shape before recovering a previously unlisted import.

Automated tests cover exact-byte identity, stable source paths, regrouping, word
offsets, mismatched editions, legacy behavior, backup retention, import interruptions
and queue barriers. Real phone restoration and text-layout behavior remain unverified.
