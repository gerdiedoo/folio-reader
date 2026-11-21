import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import type { createReplicatedStore } from '../lib/replicatedStore';
import type { Payload } from '../lib/syncModel';
import { useAppTheme } from '../AppTheme';
import { type } from '../theme';
import { ModalShell } from './ui/ModalShell';
type Conflict = Awaited<ReturnType<ReturnType<typeof createReplicatedStore>['replication']['status']>>['conflicts'][number];
function describe(kind: Conflict['kind'], p: Payload | null): string {
  if (!p) return 'Removed';
  if (kind === 'book') return `${p.title}\n${p.author}\n${p.progressPercent}% · ${p.currentChapter || 'Unknown chapter'} · Passage ${p.currentPage}`;
  if (kind === 'highlight') return `${p.text}${p.note ? '\nReflection: ' + p.note : ''}\n${p.bookTitle} · ${p.chapter} · Passage ${p.page}`;
  if (kind === 'lexicon') return `${p.word}: ${p.definition}\n${p.contextPassage || ''}\nMastery ${p.masteryLevel} of 5`;
  if (kind === 'bookmark') return `${p.chapterTitle}\n${p.excerpt}\nPassage ${p.pageNumber}`;
  return `${p.theme} · ${p.font} · Size ${p.fontSizeStep}\n${p.lineSpacing} spacing · ${p.margins} margins\n${p.readingFlowMode || 'Scroll'} reading`;
}
export function SyncReviewModal({ conflicts, onResolve, onClose }: { conflicts: Conflict[]; onResolve: (record: Conflict, choice: 'device' | 'account') => Promise<void>; onClose: () => void }) {
  const colors = useAppTheme(), pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const choose = async (record: Conflict, choice: 'device' | 'account') => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try { await onResolve(record, choice); } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : 'This choice could not be saved. Both versions are kept.'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const close = () => { if (!pending.current) onClose(); };
  return <ModalShell onClose={close} maxWidth={560} cardStyle={{ maxHeight: '90%' }}>
    <View style={{ padding: 16, gap: 8 }}>
      <Text accessibilityRole="header" style={{ ...type.headlineSm, color: colors.onSurface }}>Review account changes</Text>
      <Text style={{ ...type.bodySm, color: colors.muted }}>Competing versions stay available until you choose. “Use device” queues your version for upload; “Use account” replaces this device’s record. Original EPUB files and local cover photos stay on the device.</Text>
      {error && <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text>}
      <Pressable accessibilityRole="button" accessibilityLabel="Close account change review" disabled={busy} accessibilityState={{ disabled: busy }} style={{ minHeight: 48, justifyContent: 'center' }} onPress={close}><Text style={{ color: colors.primary }}>Done</Text></Pressable>
    </View>
    <FlatList data={conflicts} keyExtractor={record => `${record.kind}:${record.id}`}
      ListEmptyComponent={<Text style={{ padding: 16, color: colors.onSurface }}>No conflicts need review. Any queued changes will synchronize when the account is available.</Text>}
      renderItem={({ item }) => <View style={{ padding: 16, gap: 10, borderTopWidth: 1, borderColor: colors.border }}>
        <Text accessibilityRole="header" style={{ ...type.labelLg, color: colors.onSurface }}>{({ book: 'Book', highlight: 'Highlight or reflection', lexicon: 'Vocabulary', bookmark: 'Bookmark', settings: 'Reading settings' })[item.kind]}</Text>
        <Text style={{ ...type.labelMd, color: colors.primary }}>On this device</Text>
        <Text selectable style={{ ...type.bodyMd, color: colors.onSurface }}>{describe(item.kind, item.device)}</Text>
        <Text style={{ ...type.labelMd, color: colors.primary }}>In your account</Text>
        <Text selectable style={{ ...type.bodyMd, color: colors.onSurface }}>{describe(item.kind, item.account.payload)}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {(['device','account'] as const).map(choice => <Pressable key={choice} accessibilityRole="button" accessibilityLabel={`Use ${choice} version`} accessibilityState={{ disabled: busy, busy }} disabled={busy}
            style={{ minHeight: 48, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: colors.border }} onPress={() => void choose(item, choice)}><Text style={{ color: colors.primary }}>Use {choice} version</Text></Pressable>)}
        </View>
      </View>}
      initialNumToRender={3} windowSize={5} />
  </ModalShell>;
}
