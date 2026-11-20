# Folio – Expo (React Native)

Native port of the Google AI Studio "Folio" reader (Vite + React + Tailwind + Supabase).

## Run it

```bash
npm install
npx expo install --fix      # aligns native module versions with your installed Expo SDK
cp .env.example .env        # already included; edit if your Supabase project changes
npx expo start -c
```

Scan the QR code with **Expo Go**, or press `a` / `i` for an emulator. Everything used here
works in Expo Go; no custom native code.

## Supabase setup

1. For existing installations, read [account migration](docs/account-isolation.md)
   before updating. Run the complete [account-isolation migration](supabase/migrations/202611200001_account_isolation.sql)
   in the **Folio Dev test project first**. Fresh projects can use
   [`supabase/schema.sql`](./supabase/schema.sql), which contains the same canonical
   SQL. The migration creates private `folio_*` tables, enforces owner RLS, and
   quarantines the old shared tables without deleting or claiming their rows.

2. For EAS preview builds, add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` to the
   EAS **preview** environment. These `EXPO_PUBLIC_` values are bundled into the app; use the
   project URL and publishable/anon key, never a `service_role` key. Then rebuild the APK.
3. Google sign-in: Supabase → Authentication → URL Configuration → **Redirect URLs**, add:
   - `folio://auth-callback` (dev/production builds)
   - the `exp://…/--/auth-callback` URL shown in the app's profile → setup guide (Expo Go)
4. Enable the Google provider as described in that same guide.

## What changed from the web version

| Web | Native |
| --- | --- |
| Tailwind classes / `index.css` tokens | `src/theme.ts` (colors, type tokens) + `StyleSheet` |
| Material Symbols webfont | `@expo/vector-icons` via `src/components/ui/Icon.tsx` (same icon names) |
| `DOMParser` / `querySelector` EPUB parsing | `fast-xml-parser` + `node-html-parser` |
| Blob URL covers, in-memory pages | covers + parsed pages saved to the app document directory |
| Browser text selection + floating tooltip | long-press a paragraph → **PassageSheet** (tap a word, tap another to extend) |
| `<input type=file>` | `expo-document-picker` / `expo-image-picker` |
| `Blob` download of Markdown | `expo-file-system` + `expo-sharing` share sheet |
| `speechSynthesis` / `navigator.clipboard` | `expo-speech` / `expo-clipboard` |
| Supabase browser OAuth redirect | PKCE flow through `expo-web-browser` |
| supabase session in localStorage | AsyncStorage |

## Behaviour fixes made along the way

- Highlights, lexicon, books, settings and goal are cached locally (AsyncStorage) and merged with Supabase on launch.
- Imported EPUBs and their parsed pages survive app restarts; importing adds them to the Library without automatically opening the Reader.
- Selecting a library book opens its details page, with its reading position, EPUB metadata and local file location; **Start reading** opens the Reader.
- Library and free-book browsing each support grid and list layouts.
- Books can be removed from Library via **Customize cover → Remove Book**; confirming removes the saved EPUB, pages, highlights, and vocabulary cards locally and from Supabase.
- Odd paragraph counts no longer duplicate the last paragraph on a page.
- Toasts show on every tab (they were only visible in the reader).
- Dictionary uses dictionaryapi.dev for words outside the 4 built-in entries instead of showing a fake definition; saved cards are filed under the current book (was hard-coded to `remains-of-the-day`).
- Notebook defaults to "All Books" (it defaulted to a mock book id, so real highlights were hidden).
- "Sync to Supabase" now actually pushes books/highlights/vocabulary.
- “Today’s reading” tracks foreground time while the reader is visible and resets at local midnight.
- Signed-in profiles can back up book metadata to a private Supabase row and restore matching
  Project Gutenberg EPUBs on another device. EPUB files remain local; non-Gutenberg books are skipped.
- Continuous mode tracks the visible page (Loc / minutes left update), saves per-book reading position locally and to Supabase, and "Jump to Reader" lands on the right page.
- The straight-line (RSVP/tape) reader, unused in the web app, is reachable from the reader's "Line" mode.

## Things to know

- Imported book text is displayed without mock/suggested highlights; only highlights you save are marked in the reader.
- Signed-out profile and account surfaces show a Guest identity until the user signs in.
- The selected reading theme (Parchment, White, Sepia, or Charcoal) is applied across app screens, navigation, and dialogs.
- Signed-in cloud records use account-owned `folio_*` tables with RLS and composite `(user_id, id)` keys. Guest is local only. Accounts and Guest have separate metadata, files and bookmarks; legacy shared data is preserved without automatic adoption. See the migration guide before installing this update.
- `assets/folio-logo.svg` is the source logo; Expo uses its 1024×1024 PNG export as the app icon.

## Development checks

```bash
npm ci
npm test
npm run typecheck
npx expo export --platform android --platform ios --max-workers 2 --output-dir dist
```

The parser regression tests generate EPUB ZIP fixtures and use the actual XML/HTML
parsing dependencies. Native filesystem access is mocked; file-picker, storage,
and rendered reading behavior still require device testing.

### EPUB import limitations

Imports preserve short paragraphs, including single-character passages. Files with
no supported readable text, missing chapter references, or missing chapter files
are rejected with an error instead of producing placeholder reading content.
Validation runs before imported cover/book files are written. Existing imports
are not rewritten; re-import the original EPUB to recover previously omitted text.

The reader imports plain text in document order, including headings, nested
lists, table cells, captions, definition lists, and text outside paragraph tags.
Line breaks become separate reading blocks. Nested wrappers do not duplicate
passages. Visible chapter headings take precedence over the XHTML page title.

This does not reproduce publisher typography, list numbering/indentation, table
grids, illustrations, or linked footnote navigation. Inline emphasis is still
plain text. A successful import does not yet guarantee full EPUB fidelity.
Existing imports are not rewritten, so new extraction behavior requires re-import.

For a phone check, download [Folio Content Check](docs/fixtures/folio-content-check.epub)
and follow the [content-check instructions](docs/android-testing.md#content-preservation-check).

## Android test app

See [Android testing](docs/android-testing.md) for the standalone **Folio Dev** APK,
separate Supabase project configuration, and phone test checklist. Use the
`dev-preview` EAS profile to install beside the main Folio app.

## Bookmarks

In Scroll or Pages mode, tap the reader's bookmark icon to save/remove the current
passage. **More → Bookmarks** lists saved locations for the open book, with text
previews, jump actions, and individual removal. Bookmarks persist on this device
and are independent of font size and display pagination. They open the start of
the imported passage, not an exact word or subpage. In Line mode, switch to Scroll
or Pages to save; opening an existing bookmark switches Line mode to Scroll.

Bookmarks are local only and are not part of Supabase backup/restore. Removing a
book removes its bookmarks; re-importing creates a new book identity. The old
unsaved bookmark toggle cannot be migrated because it never stored a location.

## Reader typography and selection

The available typefaces are Literata, EB Garamond, Manrope, System Serif, and
System Sans. The first three are bundled fonts; the system choices use the
platform's own fonts. Older preferences are automatically relabeled to match
what was actually rendered: Bookerly/Georgia → System Serif, Inter → Manrope,
and OpenDyslexic → System Sans. No OpenDyslexic font is bundled or advertised.

The live preview shares the reader's font-size/line-height calculation and paper
colors. It demonstrates typography, not the exact page width or device text
scaling. Publisher-layout controls are hidden because EPUB text is still
reflowed without publisher layout. The legacy stored flag is normalized to false;
no database schema migration is required.

Passage selection, saved reader highlights, and notebook highlight labels use
opaque colors with contrasting text. Tests verify normal-text contrast of at
least 4.5:1 for the palette and representative saved colors. This is a targeted
contrast improvement, not certification of the whole app's accessibility.

## Import storage and recovery

A new book is added only after its original EPUB, parsed reading pages, and local
library entry have been saved. Local file imports, catalog downloads, and restore
imports share the same commit path. Reported copy/write failures reject the
import and attempt to remove its newly created files; the selected source EPUB
and other books are not removed. Cleanup failures are included in the error.

Import commits and per-key metadata writes are queued. Cloud synchronization
starts after local import success; an Added message confirms local storage, not
cloud backup. Optional cover extraction may fall back to a typographic cover.
The tests inject file-copy, page-write, metadata-write and deletion failures using
mocked storage adapters. This is not a filesystem-level atomic transaction or a
claim of recovery from power loss/process termination during a write.

## Account-isolation checks

`npm test` exercises the account-bound client, session races, namespaced caches,
and file-path restrictions with mocked adapters. `npm run test:account-db` starts
a disposable PostgreSQL 17 Docker container with no published port, tests real
RLS using two authenticated identities plus anon, then removes the container.
It needs a running Docker daemon and the official `postgres:17-alpine` image.
These checks also run in the Folio Dev build workflow. They do not contact the
live Supabase project or validate Google sign-in on a phone.
