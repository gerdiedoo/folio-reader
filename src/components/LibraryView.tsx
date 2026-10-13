import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { parseEpubFile } from '../lib/epubParser';
import { persistCoverImage, savePages } from '../lib/localStore';
import { colors, F, NAV_SPACE, type } from '../theme';
import { Book, BookContentPage, ReadingGoal } from '../types';
import { BookCover, CLOTH, ClothTint } from './BookCover';
import { Chip } from './ui/Chip';
import { Icon } from './ui/Icon';
import { ModalShell } from './ui/ModalShell';
import { ProgressBar } from './ui/ProgressBar';

interface LibraryViewProps {
  books: Book[];
  readingGoal: ReadingGoal;
  globalCoverStyle: 'image' | 'typographic';
  onOpenBook: (bookId: string) => void;
  onLogReadingTime: (mins: number) => void;
  onAddEpubBook: (book: Book, pages: BookContentPage[]) => void;
  onUpdateBookCover: (bookId: string, style: 'image' | 'typographic', url?: string) => void;
  onChangeGlobalCoverStyle: (style: 'image' | 'typographic') => void;
  showToast: (msg: string) => void;
  bottomInset: number;
}

type Filter = 'all' | 'reading' | 'finished' | 'downloaded' | 'want';
type Sort = 'recent' | 'title' | 'progress';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All Books' },
  { id: 'reading', label: 'Reading' },
  { id: 'finished', label: 'Finished' },
  { id: 'downloaded', label: 'Downloaded' },
  { id: 'want', label: 'Want to Read' },
];

const SORTS: { id: Sort; label: string }[] = [
  { id: 'recent', label: 'Recent' },
  { id: 'title', label: 'Title' },
  { id: 'progress', label: 'Progress' },
];

export const LibraryView: React.FC<LibraryViewProps> = ({
  books,
  readingGoal,
  globalCoverStyle,
  onOpenBook,
  onLogReadingTime,
  onAddEpubBook,
  onUpdateBookCover,
  onChangeGlobalCoverStyle,
  showToast,
  bottomInset,
}) => {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('recent');
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);

  const contentWidth = Math.min(width, 768) - 40;
  const cardWidth = Math.floor((contentWidth - 16) / 2);

  const featured = books.find((b) => b.id === 'remains-of-the-day') || books[0];

  const visible = useMemo(() => {
    const q = query.toLowerCase().trim();
    let list = books.filter((b) => {
      if (q && !b.title.toLowerCase().includes(q) && !b.author.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'reading':
          return b.progressPercent > 0 && !b.isFinished;
        case 'finished':
          return !!b.isFinished;
        case 'downloaded':
          return !!b.isDownloaded;
        case 'want':
          return !!b.isWantToRead;
        default:
          return true;
      }
    });
    if (sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'progress') list = [...list].sort((a, b) => b.progressPercent - a.progressPercent);
    return list;
  }, [books, query, filter, sort]);

  const goalPct = Math.min(
    100,
    Math.round((readingGoal.minutesReadToday / Math.max(1, readingGoal.dailyTargetMinutes)) * 100)
  );

  const handleImport = async () => {
    if (importing) return;
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['application/epub+zip', 'application/octet-stream', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      if (!/\.epub$/i.test(asset.name)) {
        showToast('Please choose an .epub file');
        return;
      }
      setImporting(true);
      const { book, pages } = await parseEpubFile(asset.uri, asset.name);
      savePages(book.id, pages);
      onAddEpubBook(book, pages);
    } catch (err: unknown) {
      console.warn('EPUB import failed:', err);
      showToast(err instanceof Error ? err.message : 'Failed to read EPUB file');
    } finally {
      setImporting(false);
    }
  };

  const renderRing = () => {
    const r = 22;
    const c = 2 * Math.PI * r;
    return (
      <Svg width={56} height={56} viewBox="0 0 56 56">
        <Circle cx={28} cy={28} r={r} stroke={colors.surfaceHighest} strokeWidth={5} fill="none" />
        <Circle
          cx={28}
          cy={28}
          r={r}
          stroke={colors.primaryContainer}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c}`}
          strokeDashoffset={c * (1 - goalPct / 100)}
          rotation={-90}
          origin="28, 28"
        />
      </Svg>
    );
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: NAV_SPACE + bottomInset }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Daily goal */}
      <View style={styles.goalCard}>
        <View style={styles.ringWrap}>
          {renderRing()}
          <View style={styles.ringLabel}>
            <Text style={styles.ringPct}>{goalPct}%</Text>
          </View>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.goalTitle}>Today’s reading</Text>
          <Text style={styles.goalSub}>
            {readingGoal.minutesReadToday} of {readingGoal.dailyTargetMinutes} minutes
          </Text>
          <View style={styles.logRow}>
            {[5, 15, 30].map((m) => (
              <Pressable key={m} onPress={() => onLogReadingTime(m)} style={styles.logBtn}>
                <Text style={styles.logText}>+{m}m</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>

      {/* Continue reading */}
      {featured ? (
        <View>
          <Text style={styles.sectionLabel}>CONTINUE READING</Text>
          <Pressable onPress={() => onOpenBook(featured.id)} style={styles.featured}>
            <BookCover
              book={featured}
              style={featured.coverStyle || globalCoverStyle}
              size="compact"
              containerStyle={{ width: 92, aspectRatio: 2 / 3 }}
            />
            <View style={{ flex: 1, justifyContent: 'space-between' }}>
              <View>
                <Text style={styles.featTitle} numberOfLines={2}>
                  {featured.title}
                </Text>
                <Text style={styles.featAuthor}>{featured.author}</Text>
                <Text style={styles.featMeta} numberOfLines={1}>
                  {featured.currentChapter} · {featured.minutesLeft} min left
                </Text>
              </View>
              <View style={{ gap: 6 }}>
                <ProgressBar percent={featured.progressPercent} height={5} />
                <View style={styles.featFoot}>
                  <Text style={styles.featPct}>{featured.progressPercent}% complete</Text>
                  <View style={styles.continueBtn}>
                    <Text style={styles.continueText}>Continue</Text>
                    <Icon name="chevron_right" size={16} color="#fff" />
                  </View>
                </View>
              </View>
            </View>
          </Pressable>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <Icon name="local_library" size={36} color={colors.secondaryFixedDim} />
          <Text style={styles.emptyTitle}>Your library is empty</Text>
          <Text style={styles.emptyBody}>Import an EPUB from your device to start reading.</Text>
        </View>
      )}

      {/* Import */}
      <Pressable onPress={handleImport} disabled={importing} style={[styles.importBtn, importing && { opacity: 0.7 }]}>
        <Icon name={importing ? 'sync' : 'upload_file'} size={20} color={colors.primary} spin={importing} />
        <Text style={styles.importText}>{importing ? 'Reading EPUB…' : 'Import EPUB from device'}</Text>
      </Pressable>

      {/* Search */}
      <View style={styles.searchBox}>
        <Icon name="search" size={20} color={colors.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library..."
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Icon name="close" size={18} color={colors.muted} />
          </Pressable>
        ) : null}
      </View>

      {/* Filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {FILTERS.map((f) => (
          <Chip key={f.id} label={f.label} active={filter === f.id} onPress={() => setFilter(f.id)} />
        ))}
      </ScrollView>

      {/* Sort + cover style */}
      <View style={styles.toolRow}>
        <View style={styles.sortGroup}>
          <Icon name="sort" size={16} color={colors.muted} />
          {SORTS.map((s) => (
            <Pressable key={s.id} onPress={() => setSort(s.id)}>
              <Text style={[styles.sortText, sort === s.id && styles.sortActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.coverToggle}>
          {(['image', 'typographic'] as const).map((s) => {
            const active = globalCoverStyle === s;
            return (
              <Pressable
                key={s}
                onPress={() => onChangeGlobalCoverStyle(s)}
                style={[styles.toggleBtn, active && { backgroundColor: colors.surface }]}
                accessibilityLabel={s === 'image' ? 'Illustrated covers' : 'Typographic covers'}
              >
                <Icon name={s === 'image' ? 'image' : 'title'} size={16} color={active ? colors.primary : colors.muted} />
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Grid */}
      {visible.length === 0 ? (
        <View style={styles.noResults}>
          <Text style={styles.emptyBody}>No books found matching criteria.</Text>
          {(query || filter !== 'all') && (
            <Pressable
              onPress={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              <Text style={styles.reset}>Reset Filters</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <View style={styles.grid}>
          {visible.map((b) => (
            <Pressable key={b.id} onPress={() => onOpenBook(b.id)} style={{ width: cardWidth }}>
              <BookCover
                book={b}
                style={b.coverStyle || globalCoverStyle}
                containerStyle={{ width: '100%', aspectRatio: 2 / 3 }}
                badge={
                  b.isFinished
                    ? { kind: 'read' }
                    : b.progressPercent > 0
                    ? { kind: 'percent', value: b.progressPercent }
                    : undefined
                }
                onEdit={() => setEditing(b)}
              />
              <Text style={styles.cardTitle} numberOfLines={2}>
                {b.title}
              </Text>
              <Text style={styles.cardAuthor} numberOfLines={1}>
                {b.author}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {editing && (
        <CoverEditor
          book={editing}
          globalStyle={globalCoverStyle}
          onClose={() => setEditing(null)}
          onSave={(style, url) => {
            onUpdateBookCover(editing.id, style, url);
            showToast('Book thumbnail updated');
            setEditing(null);
          }}
        />
      )}
    </ScrollView>
  );
};

// ---------------------------------------------------------------------------
// Cover editor
// ---------------------------------------------------------------------------
const CoverEditor: React.FC<{
  book: Book;
  globalStyle: 'image' | 'typographic';
  onClose: () => void;
  onSave: (style: 'image' | 'typographic', url?: string) => void;
}> = ({ book, globalStyle, onClose, onSave }) => {
  const [style, setStyle] = useState<'image' | 'typographic'>(book.coverStyle || globalStyle);
  const [url, setUrl] = useState(book.coverUrl?.startsWith('http') ? book.coverUrl : '');
  const [pickedUri, setPickedUri] = useState<string | undefined>(undefined);
  const [tint, setTint] = useState<ClothTint>('parchment');

  const previewUri = pickedUri ?? (url.trim() || book.coverUrl);

  const choosePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (res.canceled || !res.assets?.[0]) return;
    setPickedUri(persistCoverImage(res.assets[0].uri, book.id));
    setStyle('image');
  };

  return (
    <ModalShell onClose={onClose} maxWidth={400}>
      <View style={styles.editHead}>
        <Text style={styles.editTitle}>Customize Thumbnail</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Icon name="close" size={20} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <BookCover
            book={book}
            style={style}
            uriOverride={previewUri}
            tint={tint}
            size="compact"
            containerStyle={{ width: 110, aspectRatio: 2 / 3 }}
          />
        </View>

        <View style={styles.coverToggle}>
          {(['image', 'typographic'] as const).map((s) => (
            <Pressable
              key={s}
              onPress={() => setStyle(s)}
              style={[styles.toggleBtn, { flex: 1, flexDirection: 'row', gap: 6 }, style === s && { backgroundColor: colors.surface }]}
            >
              <Icon name={s === 'image' ? 'image' : 'title'} size={16} color={style === s ? colors.primary : colors.muted} />
              <Text style={[styles.sortText, style === s && styles.sortActive]}>
                {s === 'image' ? 'Illustrated' : 'Typographic'}
              </Text>
            </Pressable>
          ))}
        </View>

        {style === 'image' ? (
          <View style={{ gap: 8 }}>
            <TextInput
              value={url}
              onChangeText={(t) => {
                setUrl(t);
                setPickedUri(undefined);
              }}
              placeholder="Paste an image URL (https://…)"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.urlInput}
            />
            <Pressable onPress={choosePhoto} style={styles.photoBtn}>
              <Icon name="upload" size={18} color={colors.primary} />
              <Text style={styles.photoText}>Choose from photos</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.tintRow}>
            {(Object.keys(CLOTH) as ClothTint[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTint(t)}
                style={[
                  styles.tint,
                  { backgroundColor: CLOTH[t].bg },
                  tint === t && { borderColor: colors.primary, borderWidth: 2 },
                ]}
              />
            ))}
          </View>
        )}

        <Pressable onPress={() => onSave(style, style === 'image' ? previewUri : undefined)} style={styles.saveBtn}>
          <Text style={styles.saveText}>Apply</Text>
        </Pressable>
      </ScrollView>
    </ModalShell>
  );
};

const styles = StyleSheet.create({
  scroll: { paddingTop: 4, gap: 18 },
  goalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  ringWrap: { width: 56, height: 56 },
  ringLabel: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontFamily: F.sansBold, fontSize: 12, color: colors.onSurface },
  goalTitle: { ...type.headlineSm, fontSize: 19, lineHeight: 24, color: colors.onSurface },
  goalSub: { ...type.bodySm, color: colors.muted, marginTop: 2 },
  logRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  logBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.primaryFixed },
  logText: { ...type.labelMd, color: colors.primary },

  sectionLabel: { ...type.labelSm, color: colors.muted, marginBottom: 8, letterSpacing: 1 },
  featured: {
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  featTitle: { ...type.headlineSm, fontSize: 20, lineHeight: 25, color: colors.onSurface },
  featAuthor: { ...type.bodyMd, color: colors.muted, marginTop: 2 },
  featMeta: { ...type.bodySm, color: colors.muted, marginTop: 6 },
  featFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  featPct: { ...type.labelSm, color: colors.primary },
  continueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingLeft: 12,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 999,
  },
  continueText: { ...type.labelMd, color: '#fff' },

  emptyCard: {
    alignItems: 'center',
    gap: 6,
    padding: 28,
    borderRadius: 16,
    backgroundColor: colors.surfaceLow,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSoft,
  },
  emptyTitle: { ...type.headlineSm, fontSize: 20, color: colors.onSurface },
  emptyBody: { ...type.bodyMd, color: colors.muted, textAlign: 'center' },

  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(137,52,20,0.4)',
    backgroundColor: 'rgba(255,219,207,0.25)',
  },
  importText: { ...type.labelLg, color: colors.primary },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceContainer,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontFamily: F.sans, fontSize: 14, color: colors.onSurface },
  chipRow: { gap: 8, paddingRight: 8 },
  toolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sortGroup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  sortText: { ...type.labelMd, color: colors.muted },
  sortActive: { color: colors.primary },
  coverToggle: { flexDirection: 'row', backgroundColor: colors.surfaceContainer, padding: 3, borderRadius: 10, gap: 2 },
  toggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, rowGap: 22 },
  cardTitle: { ...type.headlineSm, fontSize: 16, lineHeight: 20, color: colors.onSurface, marginTop: 8 },
  cardAuthor: { ...type.bodySm, color: colors.muted, marginTop: 2 },
  noResults: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  reset: { ...type.labelMd, color: colors.primary },

  editHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: colors.surfaceLow,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderMid,
  },
  editTitle: { ...type.headlineSm, fontSize: 19, color: colors.onSurface },
  urlInput: {
    backgroundColor: colors.white,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: F.sans,
    fontSize: 13,
    color: colors.onSurface,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surfaceContainer,
  },
  photoText: { ...type.labelMd, color: colors.primary },
  tintRow: { flexDirection: 'row', justifyContent: 'center', gap: 14 },
  tint: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border },
  saveBtn: { backgroundColor: colors.primary, paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  saveText: { ...type.labelLg, color: '#fff' },
});
