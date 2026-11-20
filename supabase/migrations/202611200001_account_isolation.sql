-- Folio private account storage. Run in the Folio Dev project first.
-- No shared or local records are assigned to an account automatically.
-- Legacy tables and records remain intact but are denied to app clients.
begin;

create table if not exists public.folio_books (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
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
  created_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, id)
);

create table if not exists public.folio_highlights (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
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
  created_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, id)
);

create table if not exists public.folio_lexicon (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null,
  book_id text,
  word text not null,
  phonetic text,
  part_of_speech text,
  definition text not null,
  context_passage text,
  chapter text,
  mastery_level int default 1,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, id)
);

create table if not exists public.folio_reading_goals (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default 'default_user',
  minutes_read_today int default 0,
  daily_target_minutes int default 45,
  streak_days int default 0,
  books_finished_year int default 0,
  year_target_books int default 24,
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, id)
);

create table if not exists public.folio_reading_settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default 'default_user',
  theme text default 'parchment',
  font text default 'Literata',
  font_size_step int default 4,
  line_spacing text default 'standard',
  margins text default 'regular',
  use_publisher_defaults boolean default false,
  display_reading_pace boolean default true,
  default_cover_style text default 'image',
  updated_at timestamp with time zone default timezone('utc'::text, now()),
  primary key (user_id, id)
);

create table if not exists public.library_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  books jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default timezone('utc'::text, now())
);

grant usage on schema public to authenticated;

alter table public.folio_books enable row level security;
revoke all on table public.folio_books from public, anon, authenticated;
grant select, insert, update, delete on table public.folio_books to authenticated;
drop policy if exists folio_owner_boundary on public.folio_books;
create policy folio_owner_boundary on public.folio_books
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.folio_books;
create policy folio_owner_access on public.folio_books
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.folio_highlights enable row level security;
revoke all on table public.folio_highlights from public, anon, authenticated;
grant select, insert, update, delete on table public.folio_highlights to authenticated;
drop policy if exists folio_owner_boundary on public.folio_highlights;
create policy folio_owner_boundary on public.folio_highlights
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.folio_highlights;
create policy folio_owner_access on public.folio_highlights
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.folio_lexicon enable row level security;
revoke all on table public.folio_lexicon from public, anon, authenticated;
grant select, insert, update, delete on table public.folio_lexicon to authenticated;
drop policy if exists folio_owner_boundary on public.folio_lexicon;
create policy folio_owner_boundary on public.folio_lexicon
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.folio_lexicon;
create policy folio_owner_access on public.folio_lexicon
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.folio_reading_goals enable row level security;
revoke all on table public.folio_reading_goals from public, anon, authenticated;
grant select, insert, update, delete on table public.folio_reading_goals to authenticated;
drop policy if exists folio_owner_boundary on public.folio_reading_goals;
create policy folio_owner_boundary on public.folio_reading_goals
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.folio_reading_goals;
create policy folio_owner_access on public.folio_reading_goals
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.folio_reading_settings enable row level security;
revoke all on table public.folio_reading_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.folio_reading_settings to authenticated;
drop policy if exists folio_owner_boundary on public.folio_reading_settings;
create policy folio_owner_boundary on public.folio_reading_settings
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.folio_reading_settings;
create policy folio_owner_access on public.folio_reading_settings
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.library_backups enable row level security;
revoke all on table public.library_backups from public, anon, authenticated;
grant select, insert, update on table public.library_backups to authenticated;
drop policy if exists folio_owner_boundary on public.library_backups;
create policy folio_owner_boundary on public.library_backups
  as restrictive for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists folio_owner_access on public.library_backups;
create policy folio_owner_access on public.library_backups
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Preserve the old shared rows for an administrator to review/export.
-- A restrictive policy also protects against pre-existing permissive policies.
do $migration$
declare legacy text;
begin
  foreach legacy in array array['books','highlights','lexicon','reading_goals','reading_settings'] loop
    if to_regclass('public.' || legacy) is not null then
      execute format('alter table public.%I enable row level security', legacy);
      execute format('revoke all on table public.%I from public, anon, authenticated', legacy);
      execute format('drop policy if exists folio_legacy_quarantine on public.%I', legacy);
      execute format('create policy folio_legacy_quarantine on public.%I as restrictive for all to anon, authenticated using (false) with check (false)', legacy);
    end if;
  end loop;
end
$migration$;

commit;
