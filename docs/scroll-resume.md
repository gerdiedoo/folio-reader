# Scroll resume: step 15

This step addresses returning to Library and reopening the same book in Scroll
without closing Folio Dev. It also covers returning through the Reading tab.

## What changed

The previous Scroll list started at the saved source passage and automatically
prepended earlier passages when its start was reached. That callback could fire
during opening, and position reporting combined row indices with the changing
list base. The reader also saved only the source passage, losing any scroll
distance within its two paragraphs. Moving within one passage was ignored by
the app's progress handler.

Scroll now measures cells using their source passage numbers, records the top
visible passage and pixel offset within it, and restores that offset after layout.
Opening/restoration events do not count as reading movement. Tracking begins on
a drag or momentum scroll. Old list callbacks cannot change a newly opened
window. Earlier passages use an explicit **Previous passage** button above the
first passage of the window; opening no longer prepends automatically. Contents,
the scrubber, bookmarks and search remain available for larger jumps.

Position changes are debounced while scrolling and flushed on drag/momentum end,
leaving Reading or backgrounding. The app accepts within-passage updates, uses its
latest book state and updates the in-memory reference immediately. Saving to device
storage does not wait for the network. Storage failures produce a message, and
progress uploads are ordered per book after local acknowledgement. Cloud delivery
remains best effort.

Notebook/search navigation targets are consumed once instead of being replayed
on every Reading mount. Opening from Library also clears an old target. Each
book mounts a separate reader. Late cloud snapshots add cloud-only books while
existing device library entries retain their progress and local file metadata.
An explicit library-progress restore still applies the selected backup and clears
an obsolete local scroll offset.

## Upgrade and limits

Install over the existing Folio Dev APK without uninstalling or clearing data.
No SQL migration is needed. Scroll offsets are optional fields in the existing
account/backend-scoped book metadata. Earlier saved positions have only a passage:
read and scroll once with the new APK to save a precise offset. There is no way
to reconstruct an offset that an earlier version never stored.

Offsets apply to the same window width, system font scale, typeface, text size,
spacing and margins. If those change, resume falls back to the saved source
passage rather than applying an obsolete pixel distance. This step does not
provide word-level restoration across reflow, exact Pages/Line resume, or
cross-device viewport synchronization. The cloud schema and Profile metadata
backup retain their passage-level progress fields. Device entries take precedence
over startup cloud snapshots; full multi-device conflict resolution is separate.

The library still uses its existing metadata storage path, with confirmed writes
for position updates. This is not a complete library storage migration or a
power-loss guarantee. Tests use measured-cell events and storage adapters; actual
Android layout, momentum timing, TalkBack scrolling and process interruption need
[phone validation](android-testing.md#scroll-resume-step-15).
