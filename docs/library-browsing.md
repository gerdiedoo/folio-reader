# Library browsing: step 19

Install over Folio Dev. No reinstall, clearing data or new SQL is needed.

Library now has a title/author search field. Search is local, literal, case and
accent insensitive, and limited to 200 characters. Each whitespace-separated
term must occur somewhere in the combined title and author. Search combines
with the selected filter; recovery entries appear separately under All Books
and also match title/author search. Clear search keeps the filter; the empty
results action clears both search and filter while keeping the chosen sort.
The global search modal is unchanged. Query/filter/sort/view choices survive
book details and returning with Android back, but are not saved across Library
unmounts, tab changes or app restarts.

Recent now sorts by valid last-read timestamps instead of insertion order.
Older human-readable labels such as “Yesterday” have no reliable date and keep
their original relative order below timestamped books. Title sorts by normalized
title. Progress uses bounded percentages and displays finished books as 100%.
Sorting and filtering leave the stored library order intact.

Continue Reading chooses the most recently read, unfinished book whose text is
loaded on this device. It does not feature an arbitrary first book or an unread
import. New EPUBs start at 0%. Older untouched imports with artificial 1% progress
are displayed as not started unless a reading date, saved position, later passage
or further progress establishes reading history. A valid read timestamp qualifies
even at 0%. Finished and Want to Read use the existing saved flags; this step adds
no new status-editing controls. The featured section hides during search/filtering.

Downloaded now means that nonempty parsed text is loaded in this reading space;
a cloud `isDownloaded` flag alone is insufficient. Cloud-only entries remain in
All Books, identify the missing EPUB and cannot open an empty reader from their
details. Continue Reading also excludes them. This checks loaded text, not a new
full-file integrity audit. Recovery entries retain their existing re-import path;
automatic matching/repair of cloud-only book IDs is not added here.

While local books/text load, Library shows a loading message and blocks import,
catalog browsing and cover changes. A failed library-index read shows a persistent
error and keeps these changes blocked, instead of presenting a writable empty
library. A stored JSON null index is rejected; an absent index is a valid empty
reading space. Restart is the current recovery action. This is not a complete
library-row schema migration or an atomic rewrite of all storage operations.

Filter/sort/view controls expose button names and selected states. Search clearing
and cover editing have named actions. Book details and cover editing use separate
sibling buttons, avoiding the previous nested cover action. Small actions and chips
have at least 48-point targets; sort controls wrap and the grid uses one column
at larger system text sizes or narrow widths. Saved passage counts are labeled as
reading passages rather than printed pages/bookmarks. Colors follow the theme.

Pure logic and component event tests cover matching, filtering, sorting, availability,
continuation, reset behavior, named actions and details/back navigation. Type checks
and native bundle exports do not verify actual TalkBack focus, keyboard behavior,
layout or Android file access; follow the [phone checklist](android-testing.md#library-browsing-step-19).
