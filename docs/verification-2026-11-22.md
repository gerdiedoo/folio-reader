# Folio Dev verification — 22 November 2026

Application source: `7b20420` on `development`.
[Successful APK and Android verification run](https://github.com/gerdiedoo/folio-reader/actions/runs/44963583122).
Install **folio-dev-apk** from that run over the existing Folio Dev installation.
Keep the main Folio app installed and do not clear Folio Dev data.

## Observed results

| Check | Result and scope |
| --- | --- |
| Regression suite | 478 tests passed, including structured EPUB fidelity, source locations, delayed native copies, failed/uncertain storage acknowledgements, large Unicode archives, sync conflicts and recovery. |
| TypeScript | Passed locally and in GitHub Actions. |
| PostgreSQL | The 11-check suite passed against disposable PostgreSQL, including two-account isolation, anonymous denial, migration reruns, forged ownership, retry identity, cascading tombstones and simultaneous writes. This does not establish deployment in the user's Supabase project. |
| Android and iOS bundle exports | Hermes exports passed. An iOS bundle export is not iOS device testing. |
| Native Android | An Android 36 emulator installed and launched the signed Folio Dev APK, imported the illustrated EPUB through DocumentsUI, opened the reader, exposed the illustration's alternative text, and saved a bookmark. |
| Reading persistence | Saved source-position data remained equal after returning from Library and after force-stopping/restarting the app. Screenshots were captured for review of the rendered location; the assertion compares persisted source data rather than identical viewport pixels. |
| Saved work | The bookmark remained in native storage after restart. A quotation/reflection created through Notebook remained visible after another process restart. |
| Large text | The Notebook was captured at system font scale 1.5. This is not a complete clipping or accessibility audit. |

Download **folio-android-evidence** from the same run for screenshots, startup
activity timings, the native log, and the result JSON. The fixture and Guest data
are synthetic. Screenshots were captured by automation; an overall visual-quality
assessment is still needed. Raw SQLite diagnostic copies are not uploaded.

## Native defect found and fixed

Expo SDK 57's `File.copy()` returns a Promise. The earlier adapter verified the
destination immediately, producing `Incomplete EPUB copy` before copying ended.
EPUB preparation and cover-photo saving now await native completion before
verification or metadata publication. Deferred-copy tests reproduce that API
contract. The successful native run above uses the rebuilt application with this
fix, rather than the earlier APKs used while developing the test harness.

## Activation and remaining evidence

- Follow [revision-sync.md](revision-sync.md) to apply the account-isolation and
  revision-sync migrations in the **separate Folio Dev Supabase project**. No
  migration was executed remotely by this workspace. Upgrade test devices before
  making older private tables read-only, and keep a portable safety copy.
- Confirm live authentication, offline edits and conflicting changes on two
  signed-in devices, then matching-edition recovery of their original EPUBs.
  Database protocol tests and a Guest emulator do not replace that journey.
- Complete TalkBack, real phone file sharing, sustained reading, large-book
  memory/energy checks, and later iOS/iPad native checks.
- Structured rendering applies to new EPUB imports. Existing parsed copies retain
  their prior model and saved work; they are not silently reparsed. Keep old books
  and their notes when importing an original as a separate copy for richer layout.
- The renderer supports common reflowable EPUB structures. Arbitrary publisher
  CSS/fixed layout, complex tables and interactive media remain explicitly
  unsupported. Archive/cache limits and preserved older orphan files are described
  in the roadmap and recovery documentation.
