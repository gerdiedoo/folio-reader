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

1. Run the SQL from **Notebook → Supabase Config → Copy SQL** in the Supabase SQL editor.
   (The original script was missing `books.cover_style` and `reading_settings.default_cover_style`,
   so book and settings upserts were failing silently. This version adds both, plus `ALTER`s.)
2. Google sign-in: Supabase → Authentication → URL Configuration → **Redirect URLs**, add:
   - `folio://auth-callback` (dev/production builds)
   - the `exp://…/--/auth-callback` URL shown in the app's profile → setup guide (Expo Go)
3. Enable the Google provider as described in that same guide.

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
- Imported EPUBs survive app restarts (previously the text lived only in memory).
- Odd paragraph counts no longer duplicate the last paragraph on a page.
- Toasts show on every tab (they were only visible in the reader).
- Dictionary uses dictionaryapi.dev for words outside the 4 built-in entries instead of showing a fake definition; saved cards are filed under the current book (was hard-coded to `remains-of-the-day`).
- Notebook defaults to "All Books" (it defaulted to a mock book id, so real highlights were hidden).
- "Sync to Supabase" now actually pushes books/highlights/vocabulary.
- Continuous mode tracks the visible page (Loc / minutes left update), and "Jump to Reader" lands on the right page.
- The straight-line (RSVP/tape) reader, unused in the web app, is reachable from the reader's "Line" mode.

## Things to know

- `SHOW_SUGGESTED_HIGHLIGHT` in `ReaderView.tsx` toggles the auto-highlighted first words on each second paragraph (a leftover from the mock).
- `src/data/initialData.ts` still holds the fallback profile name/email shown while signed out (`DEFAULT_PROFILE`).
- All tables use a shared `default_user` row / no RLS, so every install of the same Supabase project sees the same data. Add a `user_id` column and Row Level Security before shipping.
- No app icon / splash assets are included; add them to `app.json` before building for stores.
