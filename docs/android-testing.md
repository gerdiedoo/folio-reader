# Testing Folio on Android alongside the main app

Use the `development` Git branch. The `dev-preview` EAS profile builds a standalone
APK named **Folio Dev**, package `com.folio.reader.dev`, URL scheme `folio-dev`.
The default/production configuration remains Folio (`com.folio.reader`). Android
keeps each package's local books, settings, and sign-in storage separate. Uninstalling
Folio Dev deletes its local data; you do not need to uninstall the main app.

[Latest verified APK and test evidence](verification-2026-11-22.md) — application commit `7b20420`.

## Current remaining-critique batch

This update adds structured EPUB rendering, measured text-line resume, a smaller
virtualized Library, matching-edition recovery, and durable revision sync.
Apply the separate Dev project's [revision-sync migration](revision-sync.md)
after installing the new APK on test devices. Earlier sections saying “no new
SQL” refer only to those older numbered steps.

The APK workflow also runs a disposable Android emulator journey on a separate
runner, after downloading the signed APK. **Re-run failed jobs** can repeat
native verification without recompiling a successful build. Workflow-only fixes
can reuse the known signed APK only when all application build inputs match;
changed app inputs or an unavailable artifact require compilation. Its
**folio-android-evidence** artifact includes screenshots, startup timings and
results when execution reaches those checks. A green compile alone is not a
native interaction result; inspect the smoke step and evidence separately.
TalkBack, two-device synchronization, actual phone sharing and iOS remain manual
checks. No public evidence should contain real reading data or credentials.

The emulator journey verifies root access before opening Folio so it can inspect
the disposable Guest database. It reconnects after `adb root` restarts the device
daemon and checks the actual UID rather than assuming the command succeeded.
Failures include the command output; a production Google Play system image cannot
provide root and must not be substituted for the configured `google_apis` image.
These privileges are only required on the test emulator, never on your phone.

## Step 27 APK batch

This APK includes steps 22–27, including the previously local-only UI, Notebook,
Settings, search and flashcard changes. Earlier sections marked “awaiting an APK”
are now included in this batch; their native phone checks still need completing.
Install over Folio Dev without uninstalling or clearing data. No new SQL is needed
for steps 22–27.

## Separate Supabase project

1. Open the new **Folio Dev** Supabase project. In SQL Editor, run
   [`supabase/schema.sql`](../supabase/schema.sql). Confirm you selected the test
   project before executing SQL. If upgrading an older Folio Dev install, read
   [account isolation](account-isolation.md) first and export important notes before
   updating. The complete SQL creates private account tables and quarantines old
   shared tables; it does not assign old rows or device caches to an account.
2. Get the test project's URL and publishable key (or legacy anon key). Never use
   a service-role key, `sb_secret_` key, or database password in the app.
3. The `dev-preview` profile in `eas.json` contains this test project's URL and
   publishable key. These are public client values, compiled into the APK; they
   are intentionally versioned only for that test profile. Database passwords,
   service-role keys, and Expo access tokens must never go in this file.

Dev builds select only the DEV variables; they never fall back to production
credentials. The known production host and any supplied production host are
rejected for a development build. When changing test projects, update the two
public values in the `dev-preview` profile and rebuild.

## Build from your phone using GitHub Actions

Save an Expo token with access to this app's EAS project as the repository's
`EXPO_TOKEN` Actions secret. The workflow never stores this token in source files.

**Build Folio Dev APK** starts automatically when application source, assets,
dependency declarations, app/build configuration, or the workflow is pushed to
`development`. It runs tests and TypeScript checks, then builds the APK on the
GitHub runner with EAS local build, Java 17 and the runner's Android SDK. It uses
this project's existing Expo signing credentials and does not use Expo's monthly
cloud Android build quota. No paid Expo plan is needed for this build path.
It does not publish an app-store release. The workflow only builds `development`;
documentation-only commits do not trigger another build.
**Re-run jobs** rebuilds that run's commit, not the latest branch tip.
Manual dispatch is also declared, but GitHub normally requires the workflow to
exist on the default branch before exposing that button.

Open the run under the repository's **Actions** tab in your phone's browser. After
it turns green, open its summary and tap **Download folio-dev-apk (ZIP)**, or find
**folio-dev-apk** under **Artifacts**. GitHub requires sign-in for artifact downloads.
Extract the ZIP in Android's Files app, then tap **folio-dev.apk** and install it
over **Folio Dev**. Do not uninstall or clear app data; keep the main Folio app
installed. The artifact is retained for seven days.

The Expo token still needs Developer access to retrieve the existing signing
credentials. On failure, inspect **EAS APK build failed** for captured diagnostics
before retrying. A cloud-build quota error on an older run does not affect this
local-build path. Never paste tokens into logs or chat.

## Build and install

On Linux/macOS with Java 17, Android SDK/NDK and an authenticated Expo account
authorized for the EAS project:

```bash
npx eas-cli@24.13.0 build --platform android --profile dev-preview --local --output ./folio-dev.apk
```

This uses the existing EAS project in app.json; it does not require another Expo
project. The profile selects the EAS development environment and sets
`EXPO_PUBLIC_APP_VARIANT=development`. EAS builds may consume your account's build
quota. This profile does not include a development client and does not need Metro.
Download the APK from the completed EAS build, install it on your phone, and open
**Folio Dev**. If prompted, allow installation from the download source.

For local Metro testing instead, put the same DEV variables and
`EXPO_PUBLIC_APP_VARIANT=development` in the ignored `.env.local`. Remove that variant
when returning to production builds. Do not copy production credentials into DEV
variables. Missing values can be used for local-only development, but the
`dev-preview` build requires both test backend values.

## Optional Google sign-in

In the test Supabase project's Authentication URL Configuration, allow
`folio-dev://auth-callback`. Configure its Google provider separately. Google's
OAuth client must allow the test project's Supabase `/auth/v1/callback` URL.
Do not replace production callbacks. The app's setup guide displays the current
app redirect. Authentication requires provider credentials entered in Supabase,
not in source files or this chat.

## First phone checks

- Confirm both Folio and Folio Dev remain installed, with different app names.
- Import a test EPUB with short dialogue; verify the first and last passages.
- Import an image-only EPUB; expect an unsupported-content error, not invented text.
- Restart Folio Dev and confirm the book and annotations remain available.
- Enable airplane mode and reopen an imported book.
- Try large system text and TalkBack, then report unreadable or unreachable controls.
- If testing sync, verify records appear only in the test project. Main Folio's
  library should not change. Use the two-account checklist in the migration guide
  to verify isolation in the actual Supabase project and on your phone.

Preparing configuration does not create an APK or apply SQL. Verify the EAS build,
installation, schema, connectivity, and device behavior as separate steps.

## Content preservation check

Download [Folio Content Check](fixtures/folio-content-check.epub), then import it
as a new book in the updated Folio Dev APK. Existing books retain previously
parsed pages; re-import is required to exercise new parser behavior. Keep originals
and avoid deleting books with annotations just to test this update.

Check the short opening “Yes.” and final “THE END.” Both should be present. Between
them, read the wrapper text in before/inside/after order, each phrase once. Confirm
all three list items are present, followed by the quotation's before/inside/after
phrases. Under Table Check, the caption is “Journey distances”, followed by Place,
Miles, Home, and 12, in that order. Both short lines and the fish-and-chips sentence
must remain readable. The chapter name should be Content Check, not the XHTML
file title. The same fixture's complete text sequence is asserted by `npm test`.

Lists and table cells are plain reading blocks, not a visual reproduction of their
original layout. Inline italics/bold and interactive footnotes are later work.
On the phone, verify continuous and paginated modes, then force-close/reopen the
app and return to the test book. Report missing/duplicated text and the mode used.
Automated fixture checks do not establish native rendering or restart behavior.

## Bookmark check

Install the updated Folio Dev APK over the previous version. No database migration
or EPUB re-import is needed for bookmarks.

1. Open a book in Scroll or Pages mode. The bookmark icon should initially be
   unselected. Save a passage; wait for “Bookmark saved on this device”.
2. Move to a different passage and save another. Open **More → Bookmarks**; verify
   the two previews and tap one to return to its beginning.
3. Change text size or switch between Scroll/Pages, then open the same bookmark.
   It should reach the same imported passage even when screen pagination changes.
4. Force-close and reopen Folio Dev. Open the book and verify both bookmarks remain.
   Repeat in airplane mode.
5. Save a bookmark in another book. Remove one from the first book's bookmark list;
   the other locations and the other book's bookmark must remain.
6. In Line mode, the bookmark button should explain that saving requires Scroll or
   Pages. Selecting an existing bookmark should open its passage in Scroll mode.
7. Check the bookmark controls and list in Charcoal theme, with large system text,
   and with TalkBack. Verify actions are named, the selected state is announced,
   and opening/removing bookmarks does not accidentally trigger the other action.

Bookmarks save the start of an imported passage (currently up to two text blocks),
not the exact word or displayed subpage. They stay local to this installation and
are not included in cloud backup. Remove books only using disposable test data;
removal should clear that book's bookmarks. Storage failures are covered by mocked
adapter tests; native persistence, screen-reader focus and visual layout still
need this phone check. A failed load offers **Try again** and must not erase data.

## Typography and contrast check

Install the updated Folio Dev APK over the existing installation; no schema
change or EPUB re-import is needed.

1. Open Settings → Font & Layout. Confirm only Literata, EB Garamond, Manrope,
   System Serif and System Sans are offered. If you previously chose Inter,
   Bookerly/Georgia or OpenDyslexic, expect Manrope, System Serif or System Sans,
   respectively. These names reflect the fonts the old options actually rendered.
2. Choose each font and apply it. Compare the preview and reader; restart and
   confirm the preference remains. Test both Scroll and Pages modes. In Line
   mode, confirm the focus word also follows the selected font.
3. Test size steps 1 and 8 and all three line-spacing options. The preview and
   reader use the same size/spacing values, although viewport width and system
   text scaling can change wrapping. Check that changing type does not prevent
   returning to a saved bookmark.
4. Confirm Reading Info no longer offers Use Publisher Defaults. The reading-time
   setting should describe an approximate estimate based on passage length.
5. Select Charcoal, then long-press a paragraph. Select a word/range and try all
   four highlight colors. Selected words must remain legible. Save a highlight,
   close the sheet, and inspect it in the reader and its color label in Notebook.
   Repeat on the other three paper themes. Existing annotations keep their colors.
6. With large Android text and TalkBack, check font selection, the close button,
   color selection states, and disabled Highlight/Define actions. Verify the larger
   color controls and wrapped actions remain reachable, including with the note
   keyboard open. Report clipping, inaccessible words or focus problems; native
   screen-reader behavior has not been established by the automated tests.

Highlights now use opaque fills to keep text contrast independent of the theme.
This step does not implement native text-selection handles, reduced-motion support,
full document formatting, or a complete screen-reader interaction model.

## Import storage check

Install the updated APK over Folio Dev. No schema migration or re-import of
existing books is required for this change; test a new, disposable EPUB import.

1. Import the content-check EPUB from the local picker. Wait for Added before
   opening it. Force-close/reopen the app, enable airplane mode, and verify the
   book and text remain available. The original picked file must still exist.
2. If catalog networking is configured, download a new free book. Wait through
   Preparing and verify restart/offline reading. A storage error should describe
   the save failure rather than incorrectly blaming the network.
3. If the test account has a backup, exercise a download restore and manual
   recovery re-import. Failed entries should remain recoverable, rather than
   being counted as restored before their local save completes.
4. If Android naturally reports insufficient storage, capture the import error.
   The book must not be presented as successfully added; existing books must
   remain readable. Free space and retry. Do not deliberately fill your phone's
   storage just to reproduce this case; fault injection is covered in tests.

Failures while writing the original EPUB, reading pages, or library entry are
handled separately from optional covers and cloud sync. Cleanup is attempted only
for the new import's app-owned files; incomplete cleanup is reported. Abrupt
process termination during import, native disk behavior and the older cloud merge
strategy still require separate validation. Settings saves continue to use
best-effort persistence. Steps 12/13 protect highlights/reflections and vocabulary.

If the saved library index cannot be read or parsed at startup, automatic library
saves and new imports are blocked rather than replacing it with an empty index.
Restart after resolving the storage problem. Persistent corruption may require
recovery work; the app does not delete or reset the index automatically.

## Account isolation update

Read [the migration and two-account checklist](account-isolation.md) **before
installing this APK**. Older device data is retained but will not appear in the
new account/Guest spaces automatically. Apply the entire SQL migration only to
Folio Dev's test project; do not change the main Folio production project in this
step. Guest works offline without the migration; signed-in sync needs it.

## Reading navigation accessibility (step 7)

This is a targeted improvement to navigation in **Scroll** and **Pages** modes,
not a claim that the entire reader is accessible. Use a disposable EPUB with
several chapters. The account-isolation migration instructions above still apply
if you have not installed that update yet; this step adds no database changes.

1. Enable Android **TalkBack** in the phone's accessibility settings. In Reading,
   move focus through the mode buttons, Quick typography, More, Contents and
   chapter controls. Each should have a clear name and role. Selected modes and
   themes should report selection; drawers should report expanded/collapsed.
2. Focus **Book position**. It should report the chapter and current page out of
   the total. Use TalkBack's increase/decrease actions (gestures depend on your
   settings). Each action should move exactly one reading page without dragging.
   Check both Scroll and Pages; Pages uses the current reflowed pages, while
   Scroll uses imported passages. At either end, adjustment must stay in bounds.
3. Open Contents. Confirm the current chapter is selected, choose another chapter
   and confirm its text appears. Find **Close contents** by swiping. Android Back
   should dismiss the sheet before leaving Reading. Other dialogs should not
   expose their blank scrim as an unnamed focus stop. Check focus return on close.
4. In Settings → Font & Layout, focus **Text size** and adjust it. Check the spoken
   step/value, preview, and saved size after Keep Changes. Decrease at size 1 and
   Increase at size 8 should be disabled. Spacing and margin options should have
   distinct names and selected states. Repeat in the reader's quick typography.
5. Enter immersive mode. The offscreen bottom tabs should no longer receive
   TalkBack focus. **Exit immersive mode** must remain discoverable; after exiting,
   the tabs should return with the current tab selected.
6. Turn TalkBack off. Drag the book scrubber: preview changes during the drag,
   with one jump on release. Test ordinary chapter and page buttons. On a narrow
   screen, spacing/margins should wrap into separate groups with usable targets.
   Repeat at a large system text size and in landscape to check clipping.

Automated component-handler tests cover adjustable actions, bounds, drag release
and cancellation, selected chapter/settings states, hidden navigation, and modal
escape. They do not run Android's accessibility service or prove native speech,
focus order/return, layout, or switch-access behavior. Those checks remain on the
phone. Paragraph selection and the remaining screens need separate accessibility
work. The following sections cover single-line playback, motion and feedback.

## Single-line playback and source locations (step 8)

No new SQL migration is required for this step. The step 6 migration/legacy-data
precautions still apply when upgrading from an older APK.

1. In Scroll or Pages, go to the middle of a chapter, then choose **Line**.
   Playback should start paused at the first word of the selected imported
   passage, not at the beginning of the chapter. Tap Play to start. Focus and Tape
   should retain the same word when switching display; speed changes should affect
   subsequent words without starting a second playback loop.
2. While playing, press Home, switch apps or lock the phone. Return to Folio Dev:
   the word should be unchanged from when it paused, with no catch-up playback.
   Tap Play to continue. Also open Contents, Bookmarks, Settings, Search and Profile
   while playing. Closing an overlay should leave playback paused.
3. Scrub the **word-position** bar or use the 15-word controls. Seeking should
   pause. With TalkBack enabled, the bar should report the current word and its
   index; increase/decrease actions should move one word, staying in bounds.
   Verify button names, selected speed/display, and the disabled end controls.
4. Use the book-position bar or Contents to select another passage/chapter.
   Single-line should reset to that selection and stay paused. Test two chapters
   with different lengths, including a very short final chapter. At the last
   word, playback stops and offers **Replay chapter**; it never jumps into the next
   chapter automatically. Empty text must not start a timer or save a blank quote.
5. Play past the initially selected imported passage, then save the current
   passage. Saving should pause. In Notebook, jump to that quote: it should open
   the source passage where the active word occurred. Quotes are limited to one
   original paragraph so they can be found and rendered as highlights; they keep
   original punctuation, line breaks and spacing.
6. Return to Pages/Scroll, leave Reading, and reopen the book after allowing a
   moment for the position save. It should resume the active imported passage.
   Reopening Line starts paused at that passage's first word. **Exact word-level
   progress is not persisted**; the saved anchor is the same imported-passage
   granularity used by the rest of the reader.
7. Test Focus/Tape and controls on Charcoal as well as light themes, with long
   words, larger system text and landscape. The controls should remain reachable
   by scrolling if they do not fit vertically. Check contrast and native layout
   on the phone; no screenshots or native accessibility-service tests were run in
   the cloud for this step.

Automated tests exercise real component handlers/effects with simulated timers
and AppState events, including pause, resume, overlay blocking, end/replay, source
callbacks, and cleanup. Pure source-mapping tests cover exact paragraph excerpts,
Unicode, empty text, and invalid speeds. These do not simulate Android process
death, native timer scheduling, OAuth, or cloud sync reliability. Position and
annotation durability still use the existing persistence paths.

## System motion and accessible feedback (step 9)

This step requires no new SQL or data migration. If upgrading from before step 6,
follow the account-isolation rollout and export precautions first.

1. In Android Settings, search for **Remove animations** (the name/location varies
   by manufacturer). Enable it and return to Folio Dev. Open Settings, Contents,
   Bookmarks and the catalog. Sheets/catalog should open without a slide or fade.
   Enter/exit immersive reading: header and navigation should change immediately.
   If sync/download is busy, rotating app icons should be static while the busy
   text remains. Restart Folio with this preference already enabled and repeat.
2. Turn the system option off and return. Ordinary transitions should return.
   Toggle the preference while a transition or busy icon is active if possible;
   the app should settle into the new state without getting stuck half-hidden.
   Single-line reading still starts paused and plays only after Play; the system
   motion preference does not disable deliberate word playback.
3. Enable TalkBack. Save/remove a bookmark, copy a quote, or try an unsupported
   import. The resulting message should be announced without moving focus to it.
   Check success and error messages; the generic information icon must not be
   interpreted as a success checkmark. Repeating an action should request a fresh
   announcement; there should be no duplicate live-region announcement.
4. Find Android's **Time to take action** setting (often under accessibility timing
   controls). Select a longer duration and trigger another message. It should
   remain visible for the timeout Android recommends, with a five-second minimum.
   Trigger a second message before the first expires: the old timeout must not
   clear the second early or restore old text. Test at a large system text size
   with a longer error message; text should not be clipped to two lines.
5. Once a message disappears, TalkBack should not focus its stale text. Hidden
   headers should also stay out of focus in immersive reading, while Exit
   immersive mode remains available. Check announcements with a sheet open and
   after dismissing it; native modal/focus behavior still needs phone validation.

Automated tests cover preference reads/events and their ordering, subscription
cleanup, cancellation of custom animations, modal animation selection, feedback
announcements, timeout extension/failure, replacement and unmount races. These use
native adapters and a lightweight hook/component harness. Actual Android setting
delivery, TalkBack speech, native modal transitions, built-in loading indicators
and large-text layout remain device checks; iOS has only bundle/code validation
in this cloud environment.

## Offline Find in book (step 10)

No new database migration is required. Use a locally imported EPUB with multiple
chapters, including a known phrase in the second paragraph of a passage. This
feature searches the current book's imported text; the archive search keeps its
existing metadata/annotation scope.

1. Open the book, then **More → Find in book**. Type a known word/phrase. Confirm
   the chapter and passage context, the emphasized match, and results in reading
   order. Try an absent phrase, a blank/spaces-only query and Clear. A blank query
   should show instructions; no matches should show a helpful message.
2. Check case and accents (`café`/`CAFE`), repeated spaces/line breaks within a
   paragraph, emoji and literal punctuation such as `[x]` or `.*`. Phrases spanning
   two separate paragraphs are not matched. Search input is limited to 200
   characters. Use a very common word to confirm the first-100 message appears
   when more matches exist; refine the query to narrow it down.
3. In Scroll, select a result in a later chapter. It should open that imported
   passage. In Pages, choose a match late in a long source passage: it should open
   the reflowed page containing the first matched word, including after the search
   keyboard closes. Read Next if a phrase spans display pages. Turn pages normally
   afterward; search must not keep jumping you back to the selected result.
4. In Line, start playback and open Find. Playback should pause. Select a result:
   it should open the matching imported passage, paused at its first word. Exact
   word-level search jumps in Line are not included in this step. Confirm the
   reading mode is retained in all three cases.
5. Enable airplane mode and repeat with a downloaded book. Change the query
   rapidly while searching, close the sheet mid-search, and open a different book.
   Old matches must not appear under a new query or book. Restarting/closing search
   clears its temporary query; results do not create Notebook highlights.
6. With TalkBack, find the named input, Clear, Close and result buttons. Check
   result-count announcements and whether selecting a result returns focus to
   useful reader content. Android Back should dismiss search first. Verify that
   the keyboard, scrolling results, larger system text, landscape and Charcoal
   theme leave controls and snippets readable/reachable.
7. Search a large EPUB, including one with a long paragraph. Check responsiveness
   during typing/cancellation and result scrolling. Automated yields/cancellation
   tests do not establish native frame rate or a maximum supported book size.

Automated tests verify literal/folded matches and original UTF-16 offsets, source
paragraph boundaries, bounded snippets/results, Unicode code points, cancellation
within long paragraphs, reflowed target selection, debounce/retry, and stale
query/book/unmount handling. Android/iOS bundle exports check packaging; they do
not exercise native keyboard layout, TalkBack focus or actual phone performance.

## Dictionary lookup and pronunciation (step 11)

This step adds no SQL migration. It fixes lookup/result pairing and service
recovery; step 13 separately covers protected vocabulary storage. Cloud retry and
conflict handling remain separate work.
When upgrading from before step 6, follow the [account-isolation rollout](account-isolation.md)
and export precautions first.

1. In Reading, use **More → Look up a word**, or Define from a selected passage.
   Enter an English word, then change it while a lookup is pending or showing a
   definition. The old definition must disappear immediately and Save must be
   disabled until the current word resolves. Try rapid changes with a slower
   connection; a late result/error must not replace a newer word's definition.
2. Try an unknown word and an offline lookup. A real missing result should say no
   English definition was found; connection/service failures should offer Try
   again. Retry the same word after reconnecting. If a request stalls, it should
   report a timeout after about eight seconds; offline failures can return sooner.
3. In airplane mode, try **quietude** (a bundled entry). It should display without
   a request and label itself available offline. Other words may need internet;
   this is not a full downloadable dictionary. Try **constructor** and
   **__proto__**: each should follow the ordinary online/error path without a crash.
4. From a book passage, look up a word whose definition has an example. Confirm
   **Dictionary example** and **Selected book passage** stay separately labelled.
   Save and inspect the card: word and definition should correspond, with the
   original selected book context. Save should remain disabled for loading,
   missing and failed results. Clear should return to the initial instructions.
5. Tap Pronounce. Confirm speech starts, and check the unavailable message on a
   device without a working English voice if applicable. Change the word, close
   the dictionary, press Home or lock the phone while it speaks: pronunciation
   should stop. Returning must not restart speech automatically. Close during a
   pending lookup and reopen with another word to check for stale results/toasts.
6. With TalkBack, verify the English word field, Close, Clear, Pronounce, Retry,
   synonym and Save names/roles, disabled Save state and error announcements.
   Check keyboard access and scrolling at a large text size, in landscape and
   with Charcoal enabled. Native voice availability and modal focus need device
   validation; cloud tests do not establish pronunciation quality.

Automated tests cover response validation, prototype-named input, URL encoding,
timeouts during transport/body reading, cancellation, stale completions, retry,
word/definition saving, source-context labels and pronunciation callbacks/cleanup.
Live Dictionary API access from this cloud was blocked by its outbound proxy
(HTTP 403); the real service connection still needs testing on the phone. iOS was
checked by bundle export, without a native runtime here.

## Highlight and reflection storage (step 12)

Read the [storage rollout and limits](highlight-storage.md) first. Export important
notes before upgrading; install over Folio Dev without uninstalling or clearing
data. The per-account local archive is created automatically. No new SQL is needed;
the existing step 6 migration is still required for signed-in cloud access.

1. In Guest, import a disposable EPUB. Save a highlight and a reflection from the
   reader, a manual quote from Notebook, and a passage from Line. Save should
   remain pending until storage confirms it; repeated taps must not add duplicates.
   Confirm the success text says **on this device**. Reopen each draft after a
   reported save failure, if one occurs naturally: it must not be cleared or
   presented as saved. Fault injection covers these failures in automated tests;
   do not fill the phone's storage deliberately.
2. Edit an existing reflection in the reader, leave Reading, restart the app and
   verify the highlight text, reflection and source passage remain correct.
   Repeat in airplane mode. Export and verify the Markdown contains the saved
   reflection. Deleting a note should remove it only after the local operation
   completes; reopen the app to verify it stays removed.
3. With a disposable signed-in account and the test backend, keep one local-only
   highlight and edit another while offline. Reconnect and restart. Local-only
   notes and the device's edited reflection must remain when cloud rows load.
   A new cloud-only record should be added. Check another account and Guest:
   neither should show or remove the first account's archive.
4. Delete a highlight offline, reconnect and restart while its old server row
   still exists. It must not return to this device's archive. Test book removal
   only on a disposable book; notes for a different book must remain. Deletion
   markers do not promise that other devices lose their server copies.
5. If loading saved notes fails, Notebook must show the persistent notice and
   Retry action, disable New Quote/export/upload, and avoid an empty-archive claim.
   Reader Save should explain the load problem and keep the selection/draft.
   Do not corrupt actual app data to reproduce this: malformed/null storage is
   covered by tests. Repeated failure may require recovery, not a reset.
6. Verify the renamed **Upload to Supabase** action and device-first note merge
   explanation. Review edits on other devices before uploading; this step is not
   a full sync/conflict engine. Vocabulary protection is covered by step 13;
   settings have their own step 14 checklist; book metadata needs separate work. Test TalkBack pending/disabled controls, large
   text, keyboard layout and modal dismissal on the phone.

Automated tests cover queued storage acknowledgements, failures, corrupt/null
data, retry, concurrent instances, startup merges, deletion suppression, account
scope and draft retention. Native storage semantics, process termination during
a save, live Supabase transitions and actual device layouts remain unverified.

## Vocabulary and mastery storage (step 13)

Read the [vocabulary rollout and limits](vocabulary-storage.md). Export important
notes/cards first, then install over Folio Dev without uninstalling or clearing
data. The local archive is created automatically; no new SQL is required. Older
APKs cannot see new archive changes, so export before any downgrade.

1. Look up a bundled word such as **quietude**, or an online definition when
   connected. Save it to Lexicon Cards. The button should show a pending state,
   reject duplicate taps and close only after confirmation. If saving fails
   naturally, the definition/context should stay open with an inline error and
   allow retry. Automated fault injection covers this without deliberately
   filling or corrupting the phone's storage.
2. In Notebook → Lexicon Cards, open the card, reveal its definition, then rate it.
   While saving, all rating controls should be disabled. Success should say
   **on this device**. Failure should retain the revealed card with an inline
   error and leave its previously saved mastery unchanged. Retry the rating.
3. Restart the app and verify the saved word, definition, context and mastery.
   Repeat in airplane mode with a bundled word or an already saved card. Return
   online and restart: local-only cards and device mastery should remain when
   cloud records load. A valid cloud-only card should be added.
4. Switch between two disposable signed-in accounts and Guest. Each should have
   its own cards/mastery. Repeat returning quickly to an account after a save;
   its latest confirmed state should remain. Supabase access still needs the
   existing step 6 test-project migration and real sign-in configuration.
5. If saved vocabulary cannot load, Notebook should offer **Try again** and block
   combined export/upload. Dictionary lookup and note creation should still
   work, but dictionary Save and mastery ratings must be disabled with an
   explanation. Do not edit/corrupt native app storage to force this condition.
6. Remove a disposable book with cards, restart and reconnect while old cloud
   rows still exist. Its vocabulary must not return to this device. Other books'
   cards and unassigned cards must remain. This does not prove server cleanup or
   deletion on another device. Book removal spans separate writes and can
   partially complete; read any reported failure before retrying.
7. Check TalkBack names/disabled/selected/pending states, keyboard layout in the
   dictionary, and long definitions/context in the scrollable flashcard. Repeat
   at a large system text size, in landscape and with Charcoal. Speech, focus and
   native layout still require device validation.

Automated tests cover queued acknowledgements, invalid/null data, failed writes
and retries, concurrent stores, stale cloud merges, mastery validation, account/
backend/Guest separation, book-removal suppression and retained failure UI. They
do not exercise actual Android storage faults, process death during a write, or
live multi-device synchronization.

## Reading preferences storage (step 14)

Read the [preference storage rollout and limits](reader-settings-storage.md).
Install over Folio Dev without uninstalling or clearing data; no new SQL is
required. Older APKs cannot read new preference archive changes.

1. Open Settings and choose a different typeface, size, spacing and margins.
   Choose a page theme in Themes and a default cover style in Reading Info.
   Tap **Keep Changes**: it should show **Saving…**, prevent duplicate saves and
   confirm **on this device**. In the reader, confirm the choices took effect.
2. Restart and check the same choices. Repeat with airplane mode enabled. Switch
   reading mode between Scroll, Pages and Line, restart and verify the confirmed
   mode. Line should remain paused when first opened. Its speed/Focus/Tape controls
   retain their session behavior; they are not persistent preferences in this step.
3. In quick typography, tap text size several times quickly. Each accepted tap
   should count, within sizes 1–8, and the final confirmed size should survive
   restart. Change theme or mode while a size save is pending; unrelated choices
   should remain. From Line, use a saved bookmark to return to its passage in Scroll.
4. Open Settings and change just margins, then close without saving. The previous
   saved margins should remain. **Reset Defaults** should likewise remain a draft
   until Keep Changes. If loading finishes while Settings is open, untouched fields
   should follow saved preferences while your draft edits remain selected.
5. If a write fails naturally, the settings sheet must keep the draft, show an
   error, and allow retry. Quick typography must keep the confirmed appearance
   and offer Open Settings. If saved preferences cannot load, Keep Changes must
   be disabled with a persistent notice and **Try again**. Automated fault-injection
   tests cover these paths; do not fill storage or corrupt actual app data.
6. With disposable accounts in the test backend, compare Guest and two accounts.
   Each space should retain independent preferences. Existing local choices
   should survive startup with different cloud settings. A new account space
   with no local settings can receive cloud choices; saving locally while that
   fetch is pending must take precedence. Cloud delivery remains best effort.
7. Check TalkBack selection, disabled and saving announcements, large system text,
   landscape and Charcoal. Leave the Settings tab during a save if it lasts long
   enough: completion must not bring you back unexpectedly. Return to verify the
   confirmed choices. Actual focus order, native storage durability and live
   multi-device behavior remain phone checks.

## Scroll resume (step 15)

Read the [resume behavior and limits](scroll-resume.md). Install over Folio Dev;
no uninstall, clearing data or new SQL is needed. This targets reopening a book
while the app stays open, as reported on the phone.

1. In Scroll, move well into a long passage. Note the first visible sentence, or
   take a screenshot for comparison. Go to Library and immediately reopen the
   same book. The same sentence should return at approximately the same screen
   position after layout. Repeat at least five times: it must not drift backward.
   Also return through the Reading tab without tapping the book's Resume action.
2. Repeat with only a small movement inside the same passage and close it quickly,
   before the normal save delay. Repeat after crossing several passages and after
   a fast fling has settled. Long passages must update position even when less
   than a quarter of the passage fits on screen. Check airplane mode as well.
3. Open two books in turn and alternate between them. Each should keep its own
   passage/offset. Go to a quote through Notebook or a search result, scroll farther,
   leave Reading and return. The earlier navigation target must not replay.
4. Opening must not insert earlier passages automatically. Scroll to the top of
   the current window to find **Previous passage** and activate it. It should go
   back intentionally. Contents, bookmarks and the scrubber should still navigate
   both forward and backward. Make sure restore never fights a new drag.
5. Save a position, background/foreground the app and reopen the book. Separately
   restart Folio Dev normally and check the device position. With a disposable
   signed-in account, loading an older cloud snapshot must not rewind a book
   already present on this device. Cloud-only books can still be added.
6. Change text size, spacing, margins, typeface, system font scale or orientation.
   The saved source passage should remain the fallback; exact pixel restoration
   across those layout changes is not promised. Old installs initially have only
   passage-level progress: scroll with the new APK before checking precise resume.
7. Check TalkBack scrolling, the Previous passage button, large text, landscape,
   Charcoal and a position near the book's end. A natural storage failure must
   show the save problem; move slightly and allow another save before leaving.
   Do not deliberately fill storage or corrupt data. Native failures and process
   death during writes are not covered by adapter tests.

Automated regressions cover layout-only opening events, same-passage offsets,
closing before debounce, momentum, long/late-measured cells, background flushing,
old-list callbacks, explicit backward navigation, stale Notebook jumps, layout
fallback, cloud/device precedence and storage acknowledgement/failure ordering.

## Pages and Line resume (step 16)

Read the [word-position behavior and limits](word-resume.md). Install over Folio
Dev without clearing data; no new SQL is needed. Precise anchors begin after
navigating in this APK, since earlier versions saved only a passage.

For a repeatable test book, download
[Folio Resume Check.epub](https://github.com/gerdiedoo/folio-reader/raw/refs/heads/development/docs/fixtures/folio-resume-check.epub)
and import it into Folio Dev. It contains two chapters with long paragraphs and
unique markers such as **Amber-037** and **Fern-042**. Use Find in book to select a
marker in Pages or Line, then compare it before/after reopening. The fixture is
synthetic text and can be removed after testing.

1. In Pages, reach the second or third display page of a long passage. Note its
   first sentence. Return to Library and reopen, then repeat using the Reading
   tab. The measured page should contain the saved sentence instead of resetting
   to the passage's beginning. Repeat after normal app restart and in airplane mode.
2. Change text size, spacing, margins, orientation and system font scale. Pages
   should find the page containing the same saved word after reflow. Page numbers
   and the top sentence may change as text wraps differently. Check actual text
   fitting at large font sizes; pagination still estimates the available space.
3. In Line, play or seek to a distinctive word partway through a passage. Leave
   Reading immediately and reopen. It should show that word, paused. Repeat with
   another passage and after a normal restart. Verify Replay still restarts the
   chapter intentionally and backgrounding never resumes playback automatically.
4. Run Line continuously for several seconds, then return to Library. Progress
   should be cached periodically while playback continues and flushed on leaving.
   Repeat with a long Scroll drag: the step 15 offset should still survive close/
   reopen. Do not force-kill during a write to infer a durability guarantee.
5. From Line, return to Pages: the page should contain the active word. Search for
   a word in a later part of a long passage in both Pages and Line. Reopening must
   retain that word destination, including after the search keyboard reflows Pages.
   Notebook/bookmark jumps should intentionally go to the passage's beginning.
6. Navigate backward using page turns, chapters, seeking and the scrubber, then
   reopen. The intentionally earlier position must remain. Alternate between two
   books and verify neither inherits the other's word position.
7. Keep the Scroll close/reopen tests from step 15. Its exact pixel offset applies
   only to matching layout; switching from/to word modes falls back to the source
   passage. Check TalkBack, large text, Charcoal and landscape on the device.

Automated tests use event/storage adapters. Actual phone layout, process death,
TalkBack speech/focus, live Supabase and cross-device precise restoration remain
outside that evidence.

## Book removal confirmation (step 17)

Read the [removal behavior and limits](book-removal.md). Export important notes/
cards before testing; use a disposable EPUB, such as the numbered resume fixture.
No new SQL or reinstall is required; install over the existing Folio Dev APK.

1. Add a bookmark, note and vocabulary card to a disposable book. Open its book
   editor in Library and choose **Remove Book**. Confirm the dialog names that book
   and explains local data removal plus best-effort cloud cleanup. Cancel should
   return to editing without starting removal.
2. Confirm Remove. While it is pending, the button should read **Removing…**;
   repeated taps, Cancel, close, backdrop taps and Android back must not trigger
   another operation or close the pending dialog. Local completion should close
   the dialog and remove the Library entry. It should not wait for a server when
   the phone is offline. Repeat in Guest and a disposable signed-in test account.
3. Restart offline and verify the book stays removed from the device's saved
   library. Other books and their files/notes must remain. If cloud cleanup could
   not be confirmed, an old cloud row may return after reconnecting/reloading;
   permanent cross-device deletion is not promised by this step.
4. If a local stage fails naturally, the dialog must stay open and explain whether
   earlier bookmarks/notes/cards were already removed. A library-index save failure
   must leave the book files intact. Retry should be allowed. Do not fill storage
   or corrupt data to force this; adapter tests inject these failures safely.
5. If file deletion is incomplete after the library save, removal is acknowledged
   with a warning that files remain. If cloud cleanup also fails, the later warning
   should retain that information. These partial outcomes are not a rollback or a
   durable cleanup queue. Cancel after a partial failure cannot restore notes/cards.
6. Check TalkBack names, pending/disabled states and error announcements. At large
   system text size, in landscape and with Charcoal, the full confirmation/error
   and actions should remain reachable by scrolling. Native focus and modal/back
   behavior still require phone validation.

## Book cover saves (step 18)

Read the [cover-save behavior and limits](cover-saves.md). Install over Folio Dev;
no uninstall, clearing data or new SQL is needed.

1. Edit a disposable book's thumbnail. Choose Typographic and a different cloth
   color, then Apply. It should show **Saving…**, reject duplicate taps and close
   only after a local save. Check the saved color on the library cover, reopen
   the editor and restart normally. Repeat with the other colors and Charcoal.
2. Choose a photo on Android. It should use the system picker without requiring
   access to the whole photo library. Cancel the picker and verify the previous
   draft stays. Select a photo, then close without Apply: the library cover must
   remain unchanged. Select again and Apply; restart offline and confirm it remains.
   The source gallery photo must remain intact.
3. Paste a valid HTTPS image URL and Apply. Invalid text, local file paths,
   unsupported schemes and URLs with embedded credentials must produce an inline
   error and keep the draft open. Blank text keeps the current image. A valid URL
   can be saved while its image is unavailable; remote loading is a separate check.
4. If copying or saving fails naturally, retain the current cover and editor draft,
   show the failure and allow retry. Partial-file cleanup failures must be reported.
   Do not fill storage or corrupt files to force this: tests inject these failures.
   Unexpected errors should suggest checking Library before retrying.
5. While Apply is pending, edits, photo selection, removal, close, backdrop and
   Android back should not dismiss or modify the saving draft. Once complete,
   retry the removal confirmation from step 17. Check that the book's reading
   position and other library entries were not reset by a cover edit.
6. Alternate Guest and disposable test accounts: local photo copies/colors should
   remain scoped to that reading space. They are not a cloud photo/tint sync feature.
   Test TalkBack control names/selection/pending states, large text, landscape and
   photo-picker return on the phone. iOS permission/cropping behavior needs a
   separate iOS device check.

## Library browsing (step 19)

Read the [browsing behavior and limits](library-browsing.md). Install the new APK
over Folio Dev without uninstalling or clearing data. No new SQL is required.

1. Import a disposable EPUB. Before opening it, verify it shows as not started
   and is absent from Reading/Continue Reading. Read two books in a different
   order from import, then return to Library: Recent and Continue Reading should
   reflect the last book read. Continue should resume its saved position.
2. Search by a partial title, author, mixed case and an accented name without
   accents. Multiple terms should all match across title/author. Try punctuation
   literally. Combine search with Reading or Downloaded. A recovery entry should
   match under All Books but not claim to be downloaded. Zero matches should
   offer Clear search and filters; it should retain the chosen sort.
3. Open a search result's details and return using Android back or the header
   back button. The query/filter/sort/view should remain. Open its cover button
   separately: it should edit that book without first opening details. Confirm
   List/Grid and Title/Progress ordering, including books with similar names.
4. Where an existing test account supplies metadata without local text, All Books
   should explain that an EPUB is needed. Downloaded and Continue Reading must
   exclude it, and details must not open an empty reader. Do not delete private
   app files to manufacture this state. Loading should show a checking message;
   a naturally occurring read failure should show a persistent error, not an
   empty library. Adapter tests cover disabled imports without damaging storage.
5. With TalkBack, check search/clear labels, filter/sort/view selection, result
   announcements and separate book-details/cover actions. Check details/back
   focus and keyboard dismissal on the phone. In Charcoal, landscape and large
   system text, controls should stay readable and reachable; the grid should
   use one column at larger text sizes. Query/view choices are not persisted
   after leaving Library for another tab or restarting.

## Free books and initial covers (step 20)

Read [source/error behavior and limits](free-books.md). Install over Folio Dev;
keep the current app data. No new SQL or credentials are required.

1. Open Library → Browse free books. Try Gutenberg, Standard Ebooks and Internet
   Archive independently on Wi-Fi and mobile data. Search a known title/author,
   change sources while loading, browse another page, then try a topic. Confirm
   the source label matches the results and late results never replace a newer
   source. Standard Ebooks reports loaded results rather than a false total.
2. Download a short book from each source. Wait for Preparing to finish; it must
   become Read only after saving. Open it, return to Library and restart offline
   to confirm the text and extracted cover remain. Archive editions with no
   unrestricted EPUB should give an actionable error, never a borrowing flow.
3. With networking unavailable, Gutenberg should explain the starter/cached
   fallback; search is then limited to those results. Standard/Archive should
   offer retry and allow source switching. A failed later page should keep
   earlier results and offer Retry loading more. Restore networking and retry.
4. Interrupt a download or cancel it, then retry. Its error should remain on the
   row until retry starts. Cancel/close while downloading must prevent a later
   automatic import. During Preparing, back/close should wait for the import.
   Check progress/cancel remains accessible while searching another source.
5. Confirm illustrated initial thumbnails for newly added books. Books with
   embedded art should use it. Books with absent/unavailable art should show a
   Folio illustration offline. Existing explicit Typographic covers should stay
   typographic, and custom photo/cloth editing should still work. For a book
   whose cover is an SVG wrapper, confirm the extracted raster illustration.
6. Test TalkBack names, source selection, retry/busy states and announcements.
   Check Charcoal, largest system text, landscape, keyboard dismissal and short
   screens: the search form, errors and book actions must remain reachable by
   scrolling. Real provider availability, redirects, native image rendering,
   cancellation and filesystem behavior still require these phone checks.

## Compact shared filter chips (step 21)

Install over Folio Dev. Library, Notebook and Free Books source/topic filters now
share one rounded rectangle: 36-point minimum visible height, 8-point corners,
consistent padding, 6-point horizontal gaps and a common selected color. The
transparent button around each chip retains a 48-point minimum touch target.
Text can increase the chip height at larger system font sizes; labels are not
forced into a clipped fixed height. Selected text uses the theme's contrast color.

1. Compare Library filters, Notebook filters, Free Books sources and Free Books
   topics. All should use the same compact shape and selected colors, including
   the Notebook vocabulary filter. Check the typeface buttons as the shape reference.
2. Switch filters/sources, search and change grid/list view. Existing selection,
   sorting and source behavior should remain. Check that tapping just above or
   below the visible chip still selects it and adjacent chips remain distinct.
3. Check Charcoal and large system text with TalkBack. Names and selection should
   remain clear, labels should expand without clipping, and horizontal chip rows
   should stay scrollable. Check landscape and a narrow screen.
4. Free Books has tighter header/card spacing, shorter metadata and rectangular
   Get/Retry/Read actions. Confirm long titles, progress and download errors can
   still expand cards. Library's reading summary is smaller with closer section
   spacing. Native layout and touch behavior require this phone check; automated
   regression tests and bundle exports do not verify visual appearance.

## Consistent typeface and sort choices (step 22, awaiting an APK)

This step is saved locally on development. No push or APK build was requested.
When a later APK includes it, check the following on the phone:

1. Compare Settings typefaces, Library sort choices and Free Books sort choices
   with the shared filter chips. All use a 36-point minimum visible rectangle,
   8-point corners and the same selected/background/contrast colors. The full
   button retains a 48-point minimum touch target. Typeface choices retain their
   selected checkmark and their existing pending-save disabled states.
2. Select a different typeface, apply it, reopen Settings and confirm the saved
   choice. Try Library Recent/Title/Progress and all Free Books sorting options;
   their labels, selected states and underlying sorting must remain intact.
3. Check Charcoal, large system text, narrow screens and landscape. Library sorts
   can wrap, Free Books sorts scroll horizontally, and typeface choices wrap.
   Text may grow beyond the minimum visible height. Confirm no clipping and
   check TalkBack names, selection and disabled states.

TypeScript and the existing 336 regression tests pass. Styling is shared in
`src/components/ui/choiceStyles.ts`; native appearance and touch checks remain
pending until an APK is requested.

## Notebook browsing (step 23, awaiting an APK)

See [Notebook behavior and limits](notebook-browsing.md). This step remains local;
no APK is built until requested. When a later APK includes it:

1. Check the compact Notebook title, New Quote action, search and book selector.
   Search for words in quotes, reflections, vocabulary context and chapter/book
   titles. Try mixed case, accent-free spellings, multiple terms and punctuation.
   Clear search should retain the selected book and entry filter.
2. Combine book and entry filters. Try All Entries with vocabulary cards only:
   it must show their count without claiming the Notebook is empty. Search misses,
   no reflections, no vocabulary and an empty Notebook should have distinct text.
   Show all entries should reset search, book and entry type together.
3. Check expanded/selected announcements for the book selector with TalkBack.
   Loading or failed relevant archives should not claim empty results; existing
   retry controls should remain available. Do not corrupt files to force failures;
   automated tests inject these states safely.
4. Start a reflection, type a draft, search so the card is hidden, then show all
   entries. The draft should remain. In a manual quote dialog, review Filed under
   before saving; it should retain that book if the Library list changes. If the
   book becomes unavailable, save should disable and retain the quote draft.
5. Export should count both scoped highlights and vocabulary, regardless of the
   visible search/filter. Upload should still explain that it sends the reading
   space's current records. Verify a disposable export before using important data.
6. Check Charcoal, large system text, landscape and narrow screens for clipping,
   readable selected colors, reachable actions, keyboard behavior and book names.
   No native visual/focus behavior is claimed by the local event tests.

## Compact reading settings (step 24, awaiting an APK)

This step remains local on development; no APK build is triggered. In a later
APK, check Settings both as a tab and as a sheet over an open book:

1. Reading Info now offers all three modes: Non-Stop Scroll, Page by Page and
   Single Line. Select Single Line, change tabs, then return: the selection must
   remain a draft until Keep Changes. Apply and confirm the existing Line reader
   opens at its saved position paused. Return to Scroll/Pages through Settings.
   Automated events verify the mode patch, pending lock and failed-save retry.
2. Tabs scroll horizontally within the settings content, keeping full names
   instead of ellipses. The title/close control stays above the vertical scroller.
   Reading Info omits the typography preview; Font & Layout and Themes retain it.
   Verify each tab's name/selected state with TalkBack and preserve unsaved choices
   when switching tabs.
3. Themes use the compact shared rectangles with small swatches matching the
   actual preview paper colors. Themes, typefaces and reading/cover choices can
   wrap rather than being forced into fixed-width rows. Check Charcoal selection
   contrast, largest system text, landscape and narrow widths. Text can increase
   visible choice height beyond the 36-point minimum; targets remain at least 48.
4. Reset Defaults and Keep Changes wrap on narrow screens. Check their full
   labels, reachability by scrolling, and saving/disabled states. Retry remains
   available at normal button height after a read/save failure. Existing draft,
   dirty-field merging, device acknowledgement and retry behavior are unchanged.
5. Default cover style now explains its existing scope: it applies when a book
   has no saved cover style. Change an already saved cover from Library. This
   step does not rewrite book covers or alter preference storage/cloud behavior.

All 352 regression tests and TypeScript pass locally. Native scrolling, focus,
text measurement and mode handoff still need the phone checks when an APK is
requested. No visual or device validation is claimed by component event tests.

## Global archive search (step 25, awaiting an APK)

See [search behavior and limits](archive-search.md). Changes remain local; no
APK is built for this step. When a later APK includes it:

1. Open global Search. Try title/author terms, a quote/reflection, and vocabulary
   definition/context/chapter terms. Check case/accent-insensitive multi-term
   matching and literal punctuation. Blank/whitespace queries should prompt for
   input. This is saved metadata/annotation search; Find in book searches reading
   text. Search should stay scoped to the current Guest/account reading space.
2. Switch All, Books, Quotes & notes and Vocabulary. Clear should keep the category;
   the empty-state reset should clear search and category. Confirm category/result
   counts and that any loading or error notice prevents a false no-matches claim.
   Use archive Retry when available; do not corrupt files to force failures.
3. Open a book result and confirm its details and saved cover style. Open a
   vocabulary result and confirm the expected word/card, with search closed.
   Existing rating save/loading/error behavior should remain intact.
4. Open a quote with a loaded book/passage. It should navigate to that source
   passage. If the text/passage or book is unavailable, search should retain the
   quote, disable its jump and offer Library. Notebook jumps have the same App
   guard. No exact word jump or automatic missing-file repair is promised.
5. Check compact excerpt cards and long titles at large system text, Charcoal,
   narrow widths and landscape. Check scrolling while the keyboard is visible,
   large result sets, TalkBack result/action names, loading/count announcements
   and focus when Search closes into Library, Reading or a flashcard. Unit tests
   do not validate native focus, keyboard behavior or scrolling performance.

## Compact vocabulary review (step 26, awaiting an APK)

This step remains local on development. No APK is built until requested. In a
later APK, open a vocabulary card from Notebook and from global Search:

1. The word/phonetic prompt should have a distinct Reveal definition action.
   Ratings stay disabled until the definition is revealed. Show word again
   returns to recall and disables rating until the next reveal. The saved level
   determines the selected rating appearance; Mastered is no longer permanently
   emphasized. Rating values remain Review=1, Good=3 and Mastered=5.
2. Definition and context are selectable text, separate from the flip action.
   Scrolling/long-pressing text should not flip the card. Empty context is omitted.
   Check long words/definitions and that the full card, status and rating row can
   scroll together in landscape or with large system text. Buttons wrap and use
   the shared compact rectangles with at least 48-point touch targets.
3. Rate a disposable card. While Saving mastery is shown, ratings, flip, close,
   backdrop and Android back should wait for the result. Confirmed local save
   should close the card and acknowledge the level. A failed save must retain
   the revealed card, expose an error and permit another rating or dismissal.
   Do not damage storage to force failures; tests inject them safely.
4. When the vocabulary archive cannot be read, Try again uses the existing archive
   retry without discarding the revealed view. The card reads the latest current
   archive entry after reload. A card removed from the reading space remains
   readable until dismissed but cannot be rated. Unrelated archive work should
   disable rating while leaving Close available.
5. Reopen another card: it should start at its own recall prompt. Late save results
   from an unmounted card must not close or update a newly opened card. App keys
   each review session by card ID; tests also cover late success/failure/errors
   after forced unmounting. A local save already started is not rolled back by
   unmounting or account changes.
6. Check TalkBack reveal/return/rating names, saved selection, disabled/busy states,
   error/status announcements and focus after revealing. Check Charcoal contrast,
   largest system text, narrow screens and keyboard-free scrolling. Component
   tests do not prove native focus, selection gestures or visual layout.

No vocabulary storage format, cloud merge policy or rating values change in this
step. Only confirmed storage acknowledgement can report a successful rating.


## Account actions and library backup (step 27)

1. Open Account and check the smaller heading, rectangular actions, readable
   labels and scrolling in Charcoal, landscape and large system text. Setup help
   stays optional; an ordinary sign-in failure should show an inline error rather
   than automatically expanding technical instructions.
2. In a disposable signed-in test account, back up a nonempty Library. Repeated
   taps must start only one operation. While an account action is pending, other
   account/library actions, Close, Done, backdrop and Android back must wait.
   Success should leave a persistent acknowledgement; failure should remain
   visible and allow retry. Guest/account reading spaces remain separate.
3. An unchecked/failed local Library must block backup and restore. An empty
   Library must block backup so it cannot replace a saved account list with an
   empty one; Restore should remain available once loading is complete. Tests
   inject read failures; do not corrupt app storage to force this state.
4. Restore a disposable backup. Progress, per-book failures and the final added/
   already-present counts should stay understandable. An empty backup must not
   claim that books were restored. EPUB files are not uploaded by backup; automatic
   restore still uses matching Gutenberg editions, not an exact source-edition
   restore for every book. Manually import unavailable originals when needed.
5. App/account unmounting must suppress late progress, completion and errors from
   updating another Account screen. Tests cover this and late callbacks from an
   earlier restore. Already started backend/file operations are not rolled back.
   Native browser sign-in return, back handling, focus and layout still need
   phone checks. Regression tests and bundle exports do not prove these behaviors.
# Reliability batch after step 27

Use a disposable book in **Folio Dev**. Keep the main Folio app installed.

1. Open a book's details. Check that **Remove book from Library** has its own
   confirmation and that cover editing contains no removal action. Expand/collapse
   **Technical book details**. Cancel removal and check the book is still readable.
2. Open Notebook and Account. Confirm normal reading work contains no SQL/database
   setup or OAuth provisioning instructions. Account help explains reading spaces.
3. Add a highlight with a reflection, vocabulary with a mastery rating, and bookmarks.
   Account → **Portable safety copy** → **Export copy**. Save the ZIP to Files and
   confirm it appears there; Android sharing-sheet dismissal alone proves no save.
4. **Choose a copy**, review counts, and cancel. Choose it again and **Restore copies**.
   Check that originals remain and restored notes/cards/bookmarks link to separate
   restored books. Reading settings stay unchanged unless their checkbox is selected.
5. Repeat with original EPUBs excluded. Verify the preview reports fewer originals
   while available reading text, saved work and covers remain. A missing file must
   not be counted as present. Test Guest independently from your signed-in space.
6. Use a corrupt ZIP and a non-Folio ZIP. They must fail before library changes.
   Use available device storage below the copy's size and check recovery failure is
   explicit, with existing records kept. Never clear app data to simulate a failure.
7. During restore or book removal, force-stop **Folio Dev**, then reopen. The reading
   space should finish its saved recovery before opening. Repeat at several timings;
   this timing-based phone exercise cannot guarantee hitting every storage write.
   Automated injected failures exercise each metadata stage separately.
8. Remove a disposable book offline. Check its local notes, cards and bookmarks are
   gone after reopening. Sign in/reconnect, open Notebook, and check pending account
   removal status and Retry removals. Device deletions must survive connection errors.
9. Import a fresh copy of the numbered resume fixture. New imports use file-specific
   source anchors. In Scroll, Pages and Line, save progress/highlights/bookmarks and
   reopen. Check the visible numbered text. Also test the same layout, changed text
   size, rotation, and large system font. Older imports retain legacy locations.
10. Complete the new controls with TalkBack. Verify focus after picker/sharing-sheet
    return and after recovery remounts; inspect small-phone wrapping and keyboard
    behavior. Check memory and responsiveness with a copy near the supported limit.

These device checks have **not** been run in this workspace. Android/iOS JavaScript
bundle exports do not establish native file sharing, process recovery, source-anchor
scroll accuracy, screen-reader usability or memory behavior. Multi-device revision
conflict handling and full publisher-layout EPUB rendering remain unimplemented.

## Library multiple selection and removal

Use expendable EPUBs in Folio Dev. Export a safety copy before testing removal of
saved work you care about. This change adds a native haptics module and requires
a fresh APK; it cannot be tested by reusing the previous signed APK.

1. With Android touch feedback enabled, hold a cover for about half a second.
   Confirm one brief haptic, a checkmark and the selection toolbar. Releasing the
   hold must keep selection open without opening details or the cover editor.
2. Tap two more books, then deselect one. Verify each checkmark and the count.
   Repeat in two/three columns and list view. Further taps should not repeat the
   initial long-press feedback. Disable system haptics and confirm selection still
   works without vibration.
3. Change sort, filter and search. Verify selected IDs stay selected, hidden
   selections are counted, and Select shown / Deselect shown affect only matching
   books. Recovery placeholders must not be included. Zero selected disables Remove.
4. Tap Remove. Verify the confirmation names exactly the selected books and
   explains removal of their saved work. Cancel and Android Back must not delete
   anything. Exiting selection restores normal tap-to-details and cover editing.
5. Create bookmarks, notes and vocabulary in two expendable books; leave a third
   book unselected. Remove the pair with one confirmation. After Open Library and
   a process restart, verify only that pair and its saved work are gone. Confirm
   the unselected book's progress, cover and annotations are unchanged.
6. On a disposable test device, interrupt a confirmed removal with a process
   stop. Reopen and allow recovery to finish. It must complete the recorded batch
   before allowing new library edits, with no stranded half-restored annotations.
7. With TalkBack and large text enabled, enter selection using the Select book
   accessibility action, check/uncheck books, inspect the count and confirmation,
   cancel and exit. Verify focus order and readable, reachable toolbar actions.

## Unified book catalog and EPUB choices

1. Open Browse books. Confirm All books is selected and that contemporary titles
   can appear without a download button or EPUB availability claim on their cards.
2. Search by title and author, paginate, change columns/list view and return from
   details. Confirm search text, source filter and grid choice remain intact.
3. Open a familiar public-domain title. Read its description, wait for individual
   EPUB sources, and select a named source/edition. Verify the chosen EPUB imports,
   its Open Library cover takes precedence, and the work's Library badge and Read
   action appear after the save. Try another provider for the same work.
4. Open a recent copyrighted title. Confirm readable metadata remains available
   even if no free EPUB is found. A source failure must say it could not be checked,
   rather than asserting that no EPUB exists anywhere.
5. Filter by Gutenberg, Standard Ebooks, Archive and the other providers. Verify
   results belong to that source, carry Open Library metadata where matched, and
   retain typography covers for unmatched records. Check pagination after an empty
   provider page and retry recovery after a metadata lookup fails.
6. Exercise Google key setup from details, including missing/unreadable/invalid
   keys. Replace/remove the key while checks are pending. Older responses must not
   update the current reader or offer an outdated download.
7. Test a missing Open Library cover and a failed image URL. Both must show title
   and author on typography, preserving the Library badge and details navigation.
8. Close details or switch books during slow source checks; old rows must not
   update the new view. During a download, the global progress panel remains
   available when returning to results. Cancel it or leave Browse and verify no
   late import. Preparing must wait for its save. Retry a failed edition, then
   reopen after restart to verify saved text.
9. With TalkBack and large text, inspect cover/title actions, filter states,
   source-check announcements, source downloads, key setup, Cancel and Back.


## Open Library timeout recovery and compact header

1. Open Browse books. Confirm the top area has a compact title/search, one source
   row and a single row for subject, sort and view controls. Chip faces should have
   small rounded corners, including the shared Library filters.
2. Open and cancel Subjects and Sort with the keyboard up. Search text must stay
   intact. Select a subject and sort option, return from details, and verify the
   choices remain selected. Repeat with large system text and TalkBack.
3. Load the All books page online, close Browse, then reopen it in airplane mode.
   The previously saved page should appear while refresh is attempted. After a
   failed refresh, it must remain visible with a saved-results date and Retry.
   This optional cache needs a previously successful page and working storage.
4. Search different titles quickly, switch providers, or change account during a
   slow refresh. Saved results must match the current query/account; an old reply
   must not replace the current view. No metadata-only card should claim its EPUB
   is saved or readable on this device.
5. Restore connectivity and retry. Verify live results replace the saved page.
   If Open Library itself remains unavailable, the message should identify it and
   offer retry, a specific-title search or an EPUB source. Compare the same
   one-result search in the phone browser when diagnosing a continuing timeout.


## Trending startup and layout-aware loading

1. Open Browse books with no search text. Verify trending books load from Open
   Library and are labeled Trending books, rather than showing a catalog-wide
   count. No EPUB availability is implied by the feed.
2. With a slow connection and an uncached query, select two columns, then three.
   Loading covers must align with that grid and the same cover proportions as
   results. Switch to list mode and verify list placeholders. Repeat while loading
   another page; the footer placeholders should match the selected layout too.
3. Search a title such as Harry Potter or Frankenstein. Verify the full search
   results still appear. Clear the query and return to the trending feed; inspect
   cached startup, refresh failure, pagination, and Back from details.
4. Check large text: if the preferred three columns fall back to fewer columns,
   loading must follow the actual displayed columns. With TalkBack, loading should
   be announced as one busy state, without fake selectable books.
