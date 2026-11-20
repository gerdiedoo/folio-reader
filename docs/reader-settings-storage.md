# Reading preferences: confirmed device storage

Step 14 protects typography, page theme, reading mode, margins, spacing, reading
information and the default cover style. It follows the separate
[note](highlight-storage.md) and [vocabulary](vocabulary-storage.md) archives.

## Upgrade

Install over the existing Folio Dev APK without uninstalling or clearing data.
As with earlier upgrades, export important notes/cards first. No new SQL is
required. Signed-in cloud access still requires the step 6 account-isolation
migration in the test Supabase project.

Each account/backend or Guest space reads its earlier `settings` object until a
versioned `settingsArchive` exists. The first confirmed change writes the archive;
the old object is retained untouched. Older APKs cannot see later archive changes,
and their changes are not automatically reconciled when upgrading again. There
is no preferences export/recovery UI in this step.

Unreadable JSON, stored null, non-object settings and unsupported archive versions
block saving and cloud import. Settings shows a persistent notice and **Try again**.
The reader offers **Open Settings** for the same problem. Safe display defaults
allow the rest of the app to remain usable without replacing unreadable storage.
Within a valid object, unsupported individual values receive safe fallbacks;
numbers are bounded and only supported fields reach the reader. Font aliases
retain their earlier migration rules; unsupported publisher layout stays off.

## Saving and loading

Changes become active after device storage acknowledges the write. The settings
sheet displays **Saving…**, prevents duplicate saves and closes only on success.
A failure retains the draft with an inline retry explanation. **Reset Defaults**
changes the draft; it saves only after **Keep Changes**. Closing without saving
discards the draft. Leaving the tab during a save does not reopen it on completion.

The sheet tracks edited fields. If saved settings arrive while it is open, untouched
fields follow those settings and edited fields remain as the reader chose them.
Keep Changes applies only edited fields to the latest stored preferences. Queued
quick-control updates preserve other fields, and relative text-size taps accumulate
even when multiple taps occur before the first save completes. A failed quick
change leaves the confirmed appearance active and displays a notice.

Local saved preferences take precedence at startup. Cloud preferences seed only
a space with no local preferences, and appear after being cached successfully.
The store checks again after the cloud response so it cannot replace a choice
saved while the request was pending. A failed local read prevents cloud seeding.

## Limits and validation

Cloud uploads follow local confirmation in order within the current mounted
reading space. They remain best effort: there is no durable upload queue or full
multi-device preference synchronization. Another device's settings do not replace
existing local preferences on restart. Reading mode is stored only on the device;
the current cloud schema has no reading-mode or WPM columns. Line's speed, Focus,
Tape and temporary text-size controls retain their session behavior; this step
does not make those controls persistent.

The library metadata backup does not contain this archive. Book metadata and
reading goals retain their existing persistence paths; [step 15](scroll-resume.md)
adds precise Scroll resume within that metadata. Tests cover read/write
failures, queue ordering, storage acknowledgement, safe normalization, legacy
retention, account/backend separation, late cloud responses, draft preservation
and pending/disabled controls. Native storage faults, process death during writes,
live Supabase behavior and TalkBack/layout require
[phone validation](android-testing.md#reading-preferences-storage-step-14).
