# Testing Folio on Android alongside the main app

Use the `development` Git branch. The `dev-preview` EAS profile builds a standalone
APK named **Folio Dev**, package `com.folio.reader.dev`, URL scheme `folio-dev`.
The default/production configuration remains Folio (`com.folio.reader`). Android
keeps each package's local books, settings, and sign-in storage separate. Uninstalling
Folio Dev deletes its local data; you do not need to uninstall the main app.

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
`development`. It runs tests and TypeScript checks, then submits an EAS Android
build and waits for completion. It does not publish an app-store release.
The workflow only builds `development`; documentation-only commits do not trigger
another build. Each triggered run may consume EAS build quota.
**Re-run jobs** rebuilds that run's commit, not the latest branch tip.
Manual dispatch is also declared, but GitHub normally requires the workflow to
exist on the default branch before exposing that button.

Open the run under the repository's **Actions** tab. After it turns green, open its
summary and tap **Download the Android APK** on your phone. Install **Folio Dev**;
the main Folio app stays installed. The token must have Developer access and the
EAS account must have available build quota. If a step fails, inspect that error
before retrying; never paste the token into the logs or chat.

## Build and install

From the checkout with an authenticated Expo account authorized for the EAS project:

```bash
npx eas-cli@latest build --platform android --profile dev-preview
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
