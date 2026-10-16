-- Folio Supabase schema.
-- Run this script in the Supabase SQL Editor.
-- Note: this schema does not enable Row Level Security; data is shared by all
-- users of this Supabase project, matching the app's current behavior.

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

-- Private per-account library backups. Only metadata is stored; EPUBs are
-- re-downloaded from Project Gutenberg when a backup is restored.
create table if not exists library_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  books jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

alter table library_backups enable row level security;
revoke all on table library_backups from anon;
grant select, insert, update on table library_backups to authenticated;
drop policy if exists "Users can read their own library backup" on library_backups;
create policy "Users can read their own library backup" on library_backups
  for select using (auth.uid() = user_id);
drop policy if exists "Users can create their own library backup" on library_backups;
create policy "Users can create their own library backup" on library_backups
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their own library backup" on library_backups;
create policy "Users can update their own library backup" on library_backups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Add columns when upgrading a database created with the older schema.
alter table books add column if not exists cover_style text;
alter table reading_settings
  add column if not exists default_cover_style text default 'image';
