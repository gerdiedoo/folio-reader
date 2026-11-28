import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CatalogBook } from '../lib/catalog';
import { CATALOG_SOURCES, checkDiscoverySource } from '../lib/catalog';
import type { SourceAvailability } from '../lib/discoveryCatalog';
import { useAppTheme, type AppPalette } from '../AppTheme';
import { type } from '../theme';
import { Icon } from './ui/Icon';

export const EPUB_SOURCES = CATALOG_SOURCES.filter(item => item.id !== 'openlibrary') as (typeof CATALOG_SOURCES[number] & { id: SourceAvailability['source'] })[];
type SourceRow = SourceAvailability | { source: SourceAvailability['source']; state: 'checking'; editions: CatalogBook[] };
interface Props {
  book: CatalogBook;
  googleKey: string | null;
  keyLoading: boolean;
  onSetupGoogle: () => void;
  onGet: (book: CatalogBook) => void;
  disabled: boolean;
  activeId?: string;
  errors: Record<string, string>;
}

/** Each provider can finish/fail independently. Metadata is not an EPUB promise. */
export function EpubSources({ book, googleKey, keyLoading, onSetupGoogle, onGet, disabled, activeId, errors }: Props) {
  const palette = useAppTheme(), styles = useMemo(() => createStyles(palette), [palette]);
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [expanded, setExpanded] = useState<string[]>([]);
  const retry = useRef<(source: SourceAvailability['source']) => void>(() => {});
  useEffect(() => {
    let alive = true, cursor = 0;
    const controllers = new Map<SourceAvailability['source'], AbortController>();
    setExpanded([]);
    setRows(EPUB_SOURCES.map(item => ({ source: item.id, state: 'checking', editions: [] })));
    const run = async (source: SourceAvailability['source']) => {
      if (!alive || controllers.has(source)) return;
      const controller = new AbortController(); controllers.set(source, controller);
      setRows(current => current.map(row => row.source === source ? { source, state: 'checking', editions: [] } : row));
      try {
        const result = await checkDiscoverySource(book, source, controller.signal, { googleBooksKey: googleKey });
        if (alive && !controller.signal.aborted) setRows(current => current.map(row => row.source === source ? result : row));
      } catch {
        if (alive && !controller.signal.aborted) setRows(current => current.map(row => row.source === source ? { source, state: 'error', editions: [], message: 'This source could not be checked. Try again.' } : row));
      } finally { if (controllers.get(source) === controller) controllers.delete(source); }
    };
    retry.current = source => { void run(source); };
    const sources = EPUB_SOURCES.filter(source => source.id !== 'google' || !keyLoading);
    void Promise.all(Array.from({ length: 3 }, async () => {
      while (alive && cursor < sources.length) await run(sources[cursor++].id);
    }));
    return () => { alive = false; controllers.forEach(controller => controller.abort()); retry.current = () => {}; };
  }, [book.id, googleKey, keyLoading]);
  const downloadAction = (edition: CatalogBook, label: string, count: number, index: number) => <Pressable
    onPress={() => { if (!disabled) onGet({ ...edition, discoveryWorkId: book.id, useDiscoveryCover: true, coverUrl: book.coverUrl, description: book.description || edition.description }); }}
    disabled={disabled} accessibilityRole="button" accessibilityLabel={`Download ${book.title} from ${label}${count > 1 ? `, edition ${index + 1}` : ''}`}
    accessibilityState={{ disabled, busy: activeId === edition.id }} style={[styles.button, disabled && { opacity: 0.55 }]}>
    <Icon name={activeId === edition.id ? 'sync' : 'download'} size={17} color={palette.primary} spin={activeId === edition.id} />
    <Text style={styles.action}>{activeId === edition.id ? 'Adding…' : errors[edition.id] ? 'Retry' : edition.source === 'wikisource' ? 'Generate' : 'Download'}</Text>
  </Pressable>;
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>EPUB sources</Text>
    <Text style={styles.caption}>Editions may differ in language and formatting.</Text>
    {rows.map(row => {
      const label = EPUB_SOURCES.find(source => source.id === row.source)!.label;
      const first = row.editions[0];
      const open = expanded.includes(row.source);
      const status = row.state === 'checking' ? row.source === 'google' && keyLoading ? 'Checking saved key…' : 'Checking…'
        : row.state === 'available' ? `${row.source === 'wikisource' ? 'EPUB on request' : 'EPUB'}${first?.languages?.length ? ` · ${first.languages.join(', ')}` : ''}`
        : row.state === 'not-found' ? 'No matching EPUB found in this check.'
        : row.state === 'key-required' ? 'Personal API key needed' : 'Could not check this source.';
      return <View key={row.source} style={styles.source}>
        <View style={styles.line}>
          <View style={styles.info}><Text style={styles.sourceName}>{label}</Text><Text accessibilityLiveRegion="polite" style={styles.caption}>{status}</Text></View>
          {row.state === 'checking' ? <View style={styles.indicator}><Icon name="sync" size={16} color={palette.muted} spin /></View>
            : first ? downloadAction(first, label, row.editions.length, 0)
            : row.source === 'google' && row.state === 'key-required' ? <Pressable onPress={() => { if (!disabled) onSetupGoogle(); }} disabled={disabled} accessibilityRole="button" accessibilityLabel="Google Books setup" accessibilityState={{ disabled }} style={styles.button}><Text style={styles.action}>{googleKey ? 'Manage key' : 'Add key'}</Text></Pressable>
            : <Pressable onPress={() => { if (!disabled) retry.current(row.source); }} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Retry EPUB check for ${label}`} accessibilityState={{ disabled }} style={styles.button}><Text style={styles.action}>Retry</Text></Pressable>}
        </View>
        {'message' in row && row.message && row.state === 'error' && <Text style={styles.caption}>{row.message}</Text>}
        {first && errors[first.id] && <Text accessibilityRole="alert" style={styles.caption}>{errors[first.id]}</Text>}
        {row.source === 'google' && row.state !== 'checking' && row.state !== 'key-required' && <Pressable onPress={() => { if (!disabled) onSetupGoogle(); }} disabled={disabled} accessibilityRole="button" accessibilityLabel="Google Books setup" accessibilityState={{ disabled }} style={styles.editionToggle}><Text style={styles.action}>Manage key</Text></Pressable>}
        {row.editions.length > 1 && <Pressable onPress={() => setExpanded(current => open ? current.filter(source => source !== row.source) : [...current, row.source])}
          accessibilityRole="button" accessibilityLabel={`${open ? 'Hide' : 'Show'} editions from ${label}`} accessibilityState={{ expanded: open }} style={styles.editionToggle}>
          <Text style={styles.action}>{open ? 'Fewer editions' : `${row.editions.length} editions`}</Text><Icon name={open ? 'expand_less' : 'expand_more'} size={16} color={palette.primary} />
        </Pressable>}
        {open && first && <Text style={styles.caption}>{first.title}</Text>}
        {open && row.editions.slice(1).map((edition, index) => <View key={edition.id}>
          <View style={styles.line}><Text style={[styles.caption, styles.info]}>{edition.title}{edition.languages?.length ? ` · ${edition.languages.join(', ')}` : ''}</Text>{downloadAction(edition, label, row.editions.length, index + 1)}</View>
          {errors[edition.id] && <Text accessibilityRole="alert" style={styles.caption}>{errors[edition.id]}</Text>}
        </View>)}
      </View>;
    })}
  </View>;
}
const createStyles = (palette: AppPalette) => StyleSheet.create({
  section: { gap: 4 }, heading: { ...type.labelLg, color: palette.onSurface }, caption: { ...type.bodySm, color: palette.muted },
  source: { paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.borderSoft },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  info: { flexGrow: 1, flexShrink: 1, flexBasis: 140, gap: 2 }, sourceName: { ...type.labelMd, color: palette.onSurface },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 5, paddingHorizontal: 8, borderRadius: 6 },
  action: { ...type.labelSm, color: palette.primary }, indicator: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  editionToggle: { minHeight: 44, alignSelf: 'flex-start', alignItems: 'center', flexDirection: 'row', gap: 4 },
});
