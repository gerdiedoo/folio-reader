import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  Book,
  HighlightEntry,
  LexiconEntry,
  ReadingGoal,
  ReadingSettings,
  UserProfile,
} from '../types';

// Lets the in-app browser close itself when the OAuth redirect comes back.
WebBrowser.maybeCompleteAuthSession();

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? '';
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_KEY);

if (!hasSupabaseConfig) {
  console.warn(
    'Supabase env vars missing. Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY for this EAS build environment.'
  );
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_KEY || 'placeholder-key',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // there is no browser URL in React Native
      flowType: 'pkce',
    },
  }
);

/** URL Supabase redirects back to after Google sign-in. Add it to Auth → URL Configuration. */
export function getAuthRedirectUrl(): string {
  return Linking.createURL('auth-callback');
}

/**
 * Google sign-in via Supabase OAuth. On native we open the consent screen in an
 * in-app browser session and exchange the returned PKCE code for a session.
 */
export async function signInWithGoogle(): Promise<void> {
  if (!hasSupabaseConfig) {
    throw new Error(
      'Supabase is not configured in this app build. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_KEY to the EAS preview environment, then rebuild.'
    );
  }

  const redirectTo = getAuthRedirectUrl();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Supabase did not return an OAuth URL.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return; // user cancelled / dismissed

  const url = result.url;
  const queryString = url.includes('?') ? url.split('?')[1].split('#')[0] : '';
  const code = new URLSearchParams(queryString).get('code');
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
    if (exchangeError) throw exchangeError;
    return;
  }

  // Fallback for implicit-flow style redirects (#access_token=…&refresh_token=…)
  const fragment = url.includes('#') ? url.split('#')[1] : '';
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) throw sessionError;
    return;
  }

  throw new Error(params.get('error_description') || 'Google sign-in did not return a session.');
}

export async function signOutSupabase(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getCurrentSupabaseUser(): Promise<UserProfile | null> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return null;
    return toUserProfile(session.user);
  } catch {
    return null;
  }
}

export function toUserProfile(user: {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
}): UserProfile {
  return {
    id: user.id,
    email: user.email,
    fullName:
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email?.split('@')[0] ||
      'Reader',
    avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || undefined,
  };
}

/**
 * NOTE: the original schema was missing `books.cover_style` and
 * `reading_settings.default_cover_style`, which the upsert calls below write to,
 * so those upserts failed silently. This version adds both columns, plus ALTERs
 * for databases that were already provisioned with the old script.
 */
export const SUPABASE_SQL_SCHEMA = `-- Run this in your Supabase SQL Editor to provision tables for Folio:
create table if not exists books (
  id text primary key,
  title text not null,
  author text not null,
  cover_url text,
  cover_style text,
  progress_percent int default 0,
  current_page int default 1,
  total_pages int default 100,
  minutes_left int default 60,
  current_chapter text,
  last_opened text,
  is_finished boolean default false,
  is_downloaded boolean default false,
  is_want_to_read boolean default false,
  total_loc int default 1000,
  current_loc int default 0,
  cover_alt text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists highlights (
  id text primary key,
  book_id text not null,
  book_title text not null,
  chapter text,
  page int,
  loc int,
  color_name text,
  color_hex text,
  text text not null,
  note text,
  date_added text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists lexicon (
  id text primary key,
  book_id text,
  word text not null,
  phonetic text,
  part_of_speech text,
  definition text not null,
  context_passage text,
  chapter text,
  mastery_level int default 1,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists reading_goals (
  id text primary key default 'default_user',
  minutes_read_today int default 0,
  daily_target_minutes int default 45,
  streak_days int default 0,
  books_finished_year int default 0,
  year_target_books int default 24,
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists reading_settings (
  id text primary key default 'default_user',
  theme text default 'parchment',
  font text default 'Literata',
  font_size_step int default 4,
  line_spacing text default 'standard',
  margins text default 'regular',
  use_publisher_defaults boolean default false,
  display_reading_pace boolean default true,
  default_cover_style text default 'image',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- If you already ran the old script, add the missing columns:
alter table books add column if not exists cover_style text;
alter table reading_settings add column if not exists default_cover_style text default 'image';
`;

export async function testSupabaseConnection(): Promise<{ connected: boolean; message: string }> {
  try {
    const { error } = await supabase.from('books').select('id').limit(1);
    if (!error) {
      return { connected: true, message: 'Connected to Supabase database successfully.' };
    }
    if (error.code === '42P01') {
      return {
        connected: true,
        message: 'Connected to Supabase! (Tables ready to be created with provided SQL).',
      };
    }
    return { connected: true, message: `Connected to Supabase (${error.message})` };
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
export async function fetchBooksFromSupabase(): Promise<Book[] | null> {
  try {
    const { data, error } = await supabase.from('books').select('*');
    if (error || !data || data.length === 0) return null;
    return data.map((row: any) => ({
      id: row.id,
      title: row.title,
      author: row.author,
      coverUrl: row.cover_url ?? '',
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

export async function upsertBookToSupabase(book: Book): Promise<boolean> {
  try {
    const { error } = await supabase.from('books').upsert({
      id: book.id,
      title: book.title,
      author: book.author,
      cover_url: book.coverUrl,
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
    });
    return logIfError('book upsert', error);
  } catch (err) {
    console.warn('Supabase book upsert failed:', err);
    return false;
  }
}

export async function deleteBookFromSupabase(bookId: string): Promise<boolean> {
  try {
    const { error: highlightsError } = await supabase.from('highlights').delete().eq('book_id', bookId);
    if (!logIfError('book highlights delete', highlightsError)) return false;

    const { error: lexiconError } = await supabase.from('lexicon').delete().eq('book_id', bookId);
    if (!logIfError('book lexicon delete', lexiconError)) return false;

    const { error: bookError } = await supabase.from('books').delete().eq('id', bookId);
    return logIfError('book delete', bookError);
  } catch (err) {
    console.warn('Supabase book delete failed:', err);
    return false;
  }
}

// 2. Highlights ----------------------------------------------------------
export async function fetchHighlightsFromSupabase(): Promise<HighlightEntry[] | null> {
  try {
    const { data, error } = await supabase
      .from('highlights')
      .select('*')
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

export async function upsertHighlightToSupabase(hl: HighlightEntry): Promise<boolean> {
  try {
    const { error } = await supabase.from('highlights').upsert({
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
    });
    return logIfError('highlight upsert', error);
  } catch (err) {
    console.warn('Supabase highlight upsert failed:', err);
    return false;
  }
}

export async function deleteHighlightFromSupabase(id: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('highlights').delete().eq('id', id);
    return logIfError('highlight delete', error);
  } catch (err) {
    console.warn('Supabase highlight delete failed:', err);
    return false;
  }
}

// 3. Lexicon -------------------------------------------------------------
export async function fetchLexiconFromSupabase(): Promise<LexiconEntry[] | null> {
  try {
    const { data, error } = await supabase
      .from('lexicon')
      .select('*')
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

export async function upsertLexiconToSupabase(lex: LexiconEntry): Promise<boolean> {
  try {
    const { error } = await supabase.from('lexicon').upsert({
      id: lex.id,
      book_id: lex.bookId,
      word: lex.word,
      phonetic: lex.phonetic,
      part_of_speech: lex.partOfSpeech,
      definition: lex.definition,
      context_passage: lex.contextPassage,
      chapter: lex.chapter,
      mastery_level: lex.masteryLevel,
    });
    return logIfError('lexicon upsert', error);
  } catch (err) {
    console.warn('Supabase lexicon upsert failed:', err);
    return false;
  }
}

// 4. Reading goal & settings --------------------------------------------
export async function fetchReadingGoalFromSupabase(): Promise<ReadingGoal | null> {
  try {
    const { data, error } = await supabase
      .from('reading_goals')
      .select('*')
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

export async function upsertReadingGoalToSupabase(goal: ReadingGoal): Promise<boolean> {
  try {
    const { error } = await supabase.from('reading_goals').upsert({
      id: 'default_user',
      minutes_read_today: goal.minutesReadToday,
      daily_target_minutes: goal.dailyTargetMinutes,
      streak_days: goal.streakDays,
      books_finished_year: goal.booksFinishedYear,
      year_target_books: goal.yearTargetBooks,
    });
    return logIfError('reading goal upsert', error);
  } catch (err) {
    console.warn('Supabase reading goal upsert failed:', err);
    return false;
  }
}

export async function fetchReadingSettingsFromSupabase(): Promise<Partial<ReadingSettings> | null> {
  try {
    const { data, error } = await supabase
      .from('reading_settings')
      .select('*')
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

export async function upsertReadingSettingsToSupabase(settings: ReadingSettings): Promise<boolean> {
  try {
    const { error } = await supabase.from('reading_settings').upsert({
      id: 'default_user',
      theme: settings.theme,
      font: settings.font,
      font_size_step: settings.fontSizeStep,
      line_spacing: settings.lineSpacing,
      margins: settings.margins,
      use_publisher_defaults: settings.usePublisherDefaults,
      display_reading_pace: settings.displayReadingPace,
      default_cover_style: settings.defaultCoverStyle || 'image',
    });
    return logIfError('settings upsert', error);
  } catch (err) {
    console.warn('Supabase settings upsert failed:', err);
    return false;
  }
}
