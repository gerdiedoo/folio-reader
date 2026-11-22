# Promoting Folio development to main

This promotion includes the compact Library, formatted existing EPUB descriptions,
free-book details, and the reliability work recorded in the development roadmap.
The Library header again includes its bundled offline icon.

Google OAuth now handles browser completion, warm deep links and a cold-start
callback after Android restarts Folio. Simultaneous delivery exchanges a PKCE code
once, verifies that a session was established and checks the installed app's
callback address. Errors appear in Account. Token refresh follows native
foreground/background state. Cancelling remains a cancellation, not a successful
sign-in. No Google client secret belongs in the app.

Account library backup still saves the list and basic reading progress, rather
than original EPUB files or the full notebook. The client requires the server to
return the saved owner's ID before confirming success. Unreadable backup records
are reported and retained rather than silently omitted. Use the portable safety
copy, with original files selected, for complete local recovery.

## Production configuration before distributing a main-app build

- In EAS's **production** environment retain the main project's public
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY`. The production profile
  explicitly selects the production app variant. A production/preview build
  fails if its backend values are absent or point at the known Folio Dev project.
- Enable Google in the **main** Supabase project's Authentication providers.
  Its Google OAuth client must allow that project's
  `https://<main-project>.supabase.co/auth/v1/callback` URL. Allow
  `folio://auth-callback` in Supabase's redirect URLs. The Dev project keeps
  `folio-dev://auth-callback` and its own provider configuration.
- Review the [account-isolation migration](../supabase/migrations/202611200001_account_isolation.sql)
  and [revision-sync migration](../supabase/migrations/202611210001_revision_sync.sql)
  against the target project before applying them. Both are required by the new
  account client. They preserve legacy records and deliberately do not assign
  previously shared records to an account. Export important older data first;
  coordinate client upgrades because revision sync makes old private tables
  read-only. No remote database migration is performed by a Git merge.
- Both app variants now apply the native 64 MB AsyncStorage capacity setting
  used by the journaled, segmented account archives. They retain different
  package identifiers, OAuth schemes and Supabase projects.

## Verification and remaining live checks

The previous illustrated-EPUB Android journey passed in
[run 45007107233](https://github.com/gerdiedoo/folio-reader/actions/runs/45007107233).
That run checks Guest import, rendering, saved positions across reopen/restart,
bookmark persistence and a saved reflection. It does not establish Google sign-in
or cloud backup behavior.

All 508 regression tests and TypeScript checks passed for this promotion. Tests
exercise the Google browser handoff,
PKCE and legacy callbacks, cancellation/errors, duplicate delivery, native
refresh, backup acknowledgement and invalid-backup recovery. Disposable real
PostgreSQL tests passed all 12 checks covering backup JSON round-trips,
two-account ownership and the revision migrations. Android/iOS Hermes exports
also passed; exports check bundling rather than device behavior.

The workspace cannot reach the Supabase host: its read-only Auth settings request
was rejected by the network proxy. Production EAS backend values and Google
provider settings are not available here. Neither a real Google consent journey
nor a signed-in request to the deployed backup table has been certified.

On the updated app, sign in with Google, return to Folio and confirm Account
shows the expected identity. Import a disposable book in that account's reading
space, select **Back up**, restart and verify the session remains signed in.
Restore with another installation signed into the same account, then check an
unrelated account cannot see its list. Also test cancelling Google and returning
after time in the background. Guest books remain in Guest; signing in opens a
separate account space. Keep a portable copy of important books during checks.

## Main APK workflow

The **Build Folio Main APK** workflow compiles `main` using the `main-apk`
profile, inheriting the production environment and remote signing credentials.
It produces `folio-main-apk`, a ZIP containing `folio.apk`, rather than a Play
Store AAB. It runs locally on GitHub without consuming an Expo cloud build slot.
The package and signature are checked before upload; a separate disposable
emulator exercises the main package using synthetic Guest data.

Production client values are loaded with `eas env:exec production` before the
guarded build profile is evaluated. They must have **Plain text** or **Sensitive**
visibility on Expo, because EAS local builds cannot download variables marked
**Secret**. Only a publishable or legacy anon client key may enter the bundle.
This workflow never substitutes the Dev backend or uploads signing files.
If production values are absent, it can reuse an existing complete client pair
from Expo preview/development only when it matches Folio's known original main
project, uses a public client key and does not conflict with a configured
production value. These lookups are captured without printing values; no Expo
environment is modified. Missing or unrelated settings still stop compilation.

Download **folio-main-apk** from the successful main workflow run, extract the
ZIP and install `folio.apk` over the installed main Folio app. Keep Folio Dev
installed. If Android rejects the update's signature, keep the installed app and
its data while the signing mismatch is investigated; do not uninstall it to
force installation. The artifact is retained for seven days.
