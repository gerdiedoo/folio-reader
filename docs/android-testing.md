# Testing Folio on Android alongside the main app

Use the `development` Git branch. The `dev-preview` EAS profile builds a standalone
APK named **Folio Dev**, package `com.folio.reader.dev`, URL scheme `folio-dev`.
The default/production configuration remains Folio (`com.folio.reader`). Android
keeps each package's local books, settings, and sign-in storage separate. Uninstalling
Folio Dev deletes its local data; you do not need to uninstall the main app.

## Separate Supabase project

1. Open the new **Folio Dev** Supabase project. In SQL Editor, run
   [`supabase/schema.sql`](../supabase/schema.sql). Confirm you selected the test
   project before executing SQL. This is the schema for the current application;
   the main tables still share test data across clients. Use synthetic test data
   until per-account isolation is implemented. The backup table has account RLS.
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
  library should not change. Avoid interpreting this as proof of account isolation
  within the test project; that is a separate pending improvement.

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
