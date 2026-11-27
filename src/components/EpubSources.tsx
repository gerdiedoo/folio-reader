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
  const retry = useRef<(source: SourceAvailability['source']) => void>(() => {});
  useEffect(() => {
    let alive = true, cursor = 0;
    const controllers = new Map<SourceAvailability['source'], AbortController>();
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
  return <View style={styles.section}>
    <Text accessibilityRole="header" style={styles.heading}>EPUB sources</Text>
    <Text style={styles.caption}>Matching editions are checked separately. Translations, introductions and formatting may differ.</Text>
    {rows.map(row => {
      const label = EPUB_SOURCES.find(source => source.id === row.source)!.label;
      return <View key={row.source} style={styles.source}>
        <View style={styles.line}>
          <Text style={styles.sourceName}>{label}</Text>
          {row.state === 'checking' && <Icon name="sync" size={16} color={palette.muted} spin />}
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.caption}>{row.state === 'checking' ? row.source === 'google' && keyLoading ? 'Checking your saved key…' : 'Checking editions…'
          : row.state === 'available' ? row.source === 'wikisource' ? 'EPUB can be generated' : `${row.editions.length} EPUB ${row.editions.length === 1 ? 'edition found' : 'editions found'}`
          : row.state === 'not-found' ? 'No matching EPUB found in this check.'
          : row.state === 'key-required' ? 'Your Google Books key is needed to check this source.' : 'Could not check this source.'}</Text>
        {'message' in row && row.message && <Text style={styles.caption}>{row.message}</Text>}
        {row.source === 'google' && row.state !== 'checking' && <Pressable onPress={() => { if (!disabled) onSetupGoogle(); }} disabled={disabled} accessibilityRole="button" accessibilityLabel="Google Books setup" accessibilityState={{ disabled }} style={styles.button}><Text style={styles.action}>{googleKey ? 'Manage Google key' : 'Add Google key'}</Text></Pressable>}
        {(row.state === 'error' || row.state === 'not-found') && <Pressable onPress={() => { if (!disabled) retry.current(row.source); }} disabled={disabled} accessibilityRole="button" accessibilityLabel={`Retry EPUB check for ${label}`} accessibilityState={{ disabled }} style={styles.button}><Text style={styles.action}>Check again</Text></Pressable>}
        {row.editions.map((edition, index) => <View key={edition.id} style={{ gap: 4 }}>
          <Text style={styles.caption}>{edition.title}{edition.languages?.length ? ` · ${edition.languages.join(', ')}` : ''}</Text>
          <Pressable onPress={() => { if (!disabled) onGet({ ...edition, discoveryWorkId: book.id, useDiscoveryCover: true, coverUrl: book.coverUrl, description: book.description || edition.description }); }}
            disabled={disabled} accessibilityRole="button" accessibilityLabel={`Download ${book.title} from ${label}${row.editions.length > 1 ? `, edition ${index + 1}` : ''}`} accessibilityState={{ disabled, busy: activeId === edition.id }} style={[styles.button, styles.download, disabled && { opacity: 0.55 }]}>
            <Icon name="download" size={17} color={palette.white} /><Text style={styles.downloadText}>{activeId === edition.id ? 'Downloading…' : errors[edition.id] ? 'Retry download' : row.source === 'wikisource' ? 'Generate EPUB' : 'Download EPUB'}</Text>
          </Pressable>
          {errors[edition.id] && <Text accessibilityRole="alert" style={styles.caption}>{errors[edition.id]}</Text>}
        </View>)}
      </View>;
    })}
  </View>;
}
const createStyles = (palette: AppPalette) => StyleSheet.create({
  section: { gap: 12 }, heading: { ...type.labelLg, color: palette.onSurface }, caption: { ...type.bodySm, color: palette.muted },
  source: { gap: 6, padding: 12, borderRadius: 10, backgroundColor: palette.surfaceLow, borderWidth: StyleSheet.hairlineWidth, borderColor: palette.borderSoft },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, sourceName: { ...type.labelMd, color: palette.onSurface },
  button: { minHeight: 48, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 6, padding: 10, borderRadius: 8 }, action: { ...type.labelSm, color: palette.primary },
  download: { backgroundColor: palette.primaryContainer }, downloadText: { ...type.labelMd, color: palette.white },
});
