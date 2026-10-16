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

1. Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor, or copy the
   same SQL from **Notebook → Supabase Config → Copy SQL** in the app.
   This creates the private, RLS-protected `library_backups` table used by the profile's
   **Back up** and **Restore** actions. If upgrading an existing project, rerun the script to
   add this table and its account-only policies. It also adds the previously missing
   `books.cover_style` and `reading_settings.default_cover_style` columns.
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
- All tables use a shared `default_user` row / no RLS, so every install of the same Supabase project sees the same data. Add a `user_id` column and Row Level Security before shipping.
- `assets/folio-logo.svg` is the source logo; Expo uses its 1024×1024 PNG export as the app icon.
