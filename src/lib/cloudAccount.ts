import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Book,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
} from '../types';
import type { LibraryBackupEntry } from './catalog';

/** Bind once per mounted account. Late work from A cannot upload under B. */
export function createAccountRepository(supabase: SupabaseClient, ownerId: string | null) {
  // Device file paths are never trusted from the server or shared with other devices.
  const webCover = (value: unknown) => typeof value === 'string' && /^https?:\/\//i.test(value) ? value : '';
  async function ownsSession(): Promise<boolean> {
    if (!ownerId) return false;
    try {
      const { data, error } = await supabase.auth.getSession();
      return !error && data.session?.user.id === ownerId;
    } catch { return false; }
  }
  async function saveLibraryBackup(userId: string, books: LibraryBackupEntry[]): Promise<void> {
    if (userId !== ownerId || !await ownsSession()) { throw new Error('Sign in to this account before backing up.'); }
    const { error } = await supabase.from('library_backups').upsert(
      { user_id: userId, books, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
    if (error) {
      console.warn('Supabase library backup failed:', error.message);
      throw new Error(`Could not back up your library: ${error.message}`);
    }
  }

  async function fetchLibraryBackup(userId: string): Promise<LibraryBackupEntry[] | null> {
    if (userId !== ownerId || !await ownsSession()) { throw new Error('Sign in to this account before restoring.'); }
    const { data, error } = await supabase
      .from('library_backups')
      .select('books')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.warn('Supabase library restore lookup failed:', error.message);
      throw new Error(`Could not load your library backup: ${error.message}`);
    }
    if (!data || !Array.isArray(data.books)) return null;

    return data.books.filter((entry): entry is LibraryBackupEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<LibraryBackupEntry>;
      return typeof candidate.title === 'string' && typeof candidate.author === 'string';
    }).map((entry) => ({
      title: entry.title,
      author: entry.author,
      ...(typeof entry.gutenbergId === 'number' && Number.isInteger(entry.gutenbergId)
        ? { gutenbergId: entry.gutenbergId }
        : {}),
      ...(typeof entry.currentPage === 'number' && Number.isFinite(entry.currentPage)
        ? { currentPage: entry.currentPage }
        : {}),
      ...(typeof entry.progressPercent === 'number' && Number.isFinite(entry.progressPercent)
        ? { progressPercent: entry.progressPercent }
        : {}),
      ...(typeof entry.currentChapter === 'string' ? { currentChapter: entry.currentChapter } : {}),
      ...(typeof entry.currentLoc === 'number' && Number.isFinite(entry.currentLoc)
        ? { currentLoc: entry.currentLoc }
        : {}),
      ...(typeof entry.isFinished === 'boolean' ? { isFinished: entry.isFinished } : {}),
    }));
  }

  async function testSupabaseConnection(): Promise<{ connected: boolean; message: string }> {
    if (!await ownsSession()) { return { connected: false, message: 'Sign in before using cloud synchronization.' }; }
    try {
      const { error } = await supabase.from('folio_books').select('id').eq('user_id', ownerId!).limit(1);
      if (!error) {
        return { connected: true, message: 'Connected to Supabase database successfully.' };
      }
      return { connected: false, message: 'Private account tables are unavailable. Apply the account-isolation migration in the test project.' };
    } catch (err: any) {
      return { connected: false, message: err?.message || 'Failed to connect to Supabase.' };
    }
  }

  function logIfError(label: string, error: { message: string } | null): boolean {
    if (error) {
      console.warn(`Supabase ${label} failed:`, error.message);
      return false;
    }
    return true;
  }

  // 1. Books ---------------------------------------------------------------
  async function fetchBooksFromSupabase(): Promise<Book[] | null> {
    if (!await ownsSession()) { return null; }
    try {
      const { data, error } = await supabase.from('folio_books').select('*').eq('user_id', ownerId!);
      if (error || !data || data.length === 0) return null;
      return data.map((row: any) => ({
        id: row.id,
        title: row.title,
        author: row.author,
        coverUrl: webCover(row.cover_url),
        progressPercent: row.progress_percent,
        currentPage: row.current_page,
        totalPages: row.total_pages,
        minutesLeft: row.minutes_left,
        currentChapter: row.current_chapter,
        lastOpened: row.last_opened,
        isFinished: row.is_finished,
        isDownloaded: row.is_downloaded,
        isWantToRead: row.is_want_to_read,
        totalLoc: row.total_loc,
        currentLoc: row.current_loc,
        coverStyle: row.cover_style || (row.cover_url ? 'image' : 'typographic'),
        coverAlt: row.cover_alt || `Cover of ${row.title}`,
      }));
    } catch {
      return null;
    }
  }

  async function upsertBookToSupabase(book: Book): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_books').upsert({
        user_id: ownerId,
        id: book.id,
        title: book.title,
        author: book.author,
        cover_url: webCover(book.coverUrl),
        cover_style: book.coverStyle || (book.coverUrl ? 'image' : 'typographic'),
        progress_percent: book.progressPercent,
        current_page: book.currentPage,
        total_pages: book.totalPages,
        minutes_left: book.minutesLeft,
        current_chapter: book.currentChapter,
        last_opened: book.lastOpened,
        is_finished: book.isFinished,
        is_downloaded: book.isDownloaded,
        is_want_to_read: book.isWantToRead,
        total_loc: book.totalLoc,
        current_loc: book.currentLoc,
        cover_alt: book.coverAlt,
      }, { onConflict: 'user_id,id' });
      return logIfError('book upsert', error);
    } catch (err) {
      console.warn('Supabase book upsert failed:', err);
      return false;
    }
  }

  async function deleteBookFromSupabase(bookId: string): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error: highlightsError } = await supabase.from('folio_highlights').delete().eq('user_id', ownerId!).eq('book_id', bookId);
      if (!logIfError('book highlights delete', highlightsError)) return false;

      const { error: lexiconError } = await supabase.from('folio_lexicon').delete().eq('user_id', ownerId!).eq('book_id', bookId);
      if (!logIfError('book lexicon delete', lexiconError)) return false;

      const { error: bookError } = await supabase.from('folio_books').delete().eq('user_id', ownerId!).eq('id', bookId);
      return logIfError('book delete', bookError);
    } catch (err) {
      console.warn('Supabase book delete failed:', err);
      return false;
    }
  }

  // 2. Highlights ----------------------------------------------------------
  async function fetchHighlightsFromSupabase(): Promise<HighlightEntry[] | null> {
    if (!await ownsSession()) { return null; }
    try {
      const { data, error } = await supabase
        .from('folio_highlights')
        .select('*').eq('user_id', ownerId!)
        .order('created_at', { ascending: false });
      if (error || !data || data.length === 0) return null;
      return data.map((row: any) => ({
        id: row.id,
        bookId: row.book_id,
        bookTitle: row.book_title,
        chapter: row.chapter,
        page: row.page,
        loc: row.loc,
        colorName: row.color_name,
        colorHex: row.color_hex,
        text: row.text,
        note: row.note,
        dateAdded: row.date_added,
      }));
    } catch {
      return null;
    }
  }

  async function upsertHighlightToSupabase(hl: HighlightEntry): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_highlights').upsert({
        user_id: ownerId,
        id: hl.id,
        book_id: hl.bookId,
        book_title: hl.bookTitle,
        chapter: hl.chapter,
        page: hl.page,
        loc: hl.loc,
        color_name: hl.colorName,
        color_hex: hl.colorHex,
        text: hl.text,
        note: hl.note,
        date_added: hl.dateAdded,
      }, { onConflict: 'user_id,id' });
      return logIfError('highlight upsert', error);
    } catch (err) {
      console.warn('Supabase highlight upsert failed:', err);
      return false;
    }
  }

  async function deleteHighlightFromSupabase(id: string): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_highlights').delete().eq('user_id', ownerId!).eq('id', id);
      return logIfError('highlight delete', error);
    } catch (err) {
      console.warn('Supabase highlight delete failed:', err);
      return false;
    }
  }

  // 3. Lexicon -------------------------------------------------------------
  async function fetchLexiconFromSupabase(): Promise<LexiconEntry[] | null> {
    if (!await ownsSession()) { return null; }
    try {
      const { data, error } = await supabase
        .from('folio_lexicon')
        .select('*').eq('user_id', ownerId!)
        .order('created_at', { ascending: false });
      if (error || !data || data.length === 0) return null;
      return data.map((row: any) => ({
        id: row.id,
        bookId: row.book_id,
        word: row.word,
        phonetic: row.phonetic,
        partOfSpeech: row.part_of_speech,
        definition: row.definition,
        contextPassage: row.context_passage,
        chapter: row.chapter,
        masteryLevel: row.mastery_level,
      }));
    } catch {
      return null;
    }
  }

  async function upsertLexiconToSupabase(lex: LexiconEntry): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_lexicon').upsert({
        user_id: ownerId,
        id: lex.id,
        book_id: lex.bookId,
        word: lex.word,
        phonetic: lex.phonetic,
        part_of_speech: lex.partOfSpeech,
        definition: lex.definition,
        context_passage: lex.contextPassage,
        chapter: lex.chapter,
        mastery_level: lex.masteryLevel,
      }, { onConflict: 'user_id,id' });
      return logIfError('lexicon upsert', error);
    } catch (err) {
      console.warn('Supabase lexicon upsert failed:', err);
      return false;
    }
  }

  // 4. Reading goal & settings --------------------------------------------
  async function fetchReadingGoalFromSupabase(): Promise<ReadingGoal | null> {
    if (!await ownsSession()) { return null; }
    try {
      const { data, error } = await supabase
        .from('folio_reading_goals')
        .select('*').eq('user_id', ownerId!)
        .eq('id', 'default_user')
        .single();
      if (error || !data) return null;
      return {
        minutesReadToday: data.minutes_read_today,
        dailyTargetMinutes: data.daily_target_minutes,
        streakDays: data.streak_days,
        booksFinishedYear: data.books_finished_year,
        yearTargetBooks: data.year_target_books,
      };
    } catch {
      return null;
    }
  }

  async function upsertReadingGoalToSupabase(goal: ReadingGoal): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_reading_goals').upsert({
        user_id: ownerId,
        id: 'default_user',
        minutes_read_today: goal.minutesReadToday,
        daily_target_minutes: goal.dailyTargetMinutes,
        streak_days: goal.streakDays,
        books_finished_year: goal.booksFinishedYear,
        year_target_books: goal.yearTargetBooks,
      }, { onConflict: 'user_id,id' });
      return logIfError('reading goal upsert', error);
    } catch (err) {
      console.warn('Supabase reading goal upsert failed:', err);
      return false;
    }
  }

  async function fetchReadingSettingsFromSupabase(): Promise<Partial<ReadingSettings> | null> {
    if (!await ownsSession()) { return null; }
    try {
      const { data, error } = await supabase
        .from('folio_reading_settings')
        .select('*').eq('user_id', ownerId!)
        .eq('id', 'default_user')
        .single();
      if (error || !data) return null;
      return {
        theme: data.theme,
        font: data.font,
        fontSizeStep: data.font_size_step,
        lineSpacing: data.line_spacing,
        margins: data.margins,
        usePublisherDefaults: data.use_publisher_defaults,
        displayReadingPace: data.display_reading_pace,
        defaultCoverStyle: data.default_cover_style || 'image',
      };
    } catch {
      return null;
    }
  }

  async function upsertReadingSettingsToSupabase(settings: ReadingSettings): Promise<boolean> {
    if (!await ownsSession()) { return false; }
    try {
      const { error } = await supabase.from('folio_reading_settings').upsert({
        user_id: ownerId,
        id: 'default_user',
        theme: settings.theme,
        font: settings.font,
        font_size_step: settings.fontSizeStep,
        line_spacing: settings.lineSpacing,
        margins: settings.margins,
        use_publisher_defaults: settings.usePublisherDefaults,
        display_reading_pace: settings.displayReadingPace,
        default_cover_style: settings.defaultCoverStyle || 'image',
      }, { onConflict: 'user_id,id' });
      return logIfError('settings upsert', error);
    } catch (err) {
      console.warn('Supabase settings upsert failed:', err);
      return false;
    }
  }

  return { saveLibraryBackup, fetchLibraryBackup, testSupabaseConnection, fetchBooksFromSupabase, upsertBookToSupabase, deleteBookFromSupabase, fetchHighlightsFromSupabase, upsertHighlightToSupabase, deleteHighlightFromSupabase, fetchLexiconFromSupabase, upsertLexiconToSupabase, fetchReadingGoalFromSupabase, upsertReadingGoalToSupabase, fetchReadingSettingsFromSupabase, upsertReadingSettingsToSupabase };
}
