-- Apply after 202611200001_account_isolation.sql, in Folio Dev first.
-- Old private-table writes become read-only; install the new Dev APK on test devices.
begin;
create sequence if not exists public.folio_record_changes;
revoke all on sequence public.folio_record_changes from public,anon,authenticated;
create table if not exists public.folio_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('book','highlight','lexicon','bookmark','settings')),
  id text not null check (length(id) between 1 and 500),
  payload jsonb,
  revision bigint not null check (revision > 0),
  mutation_id uuid not null,
  change_id bigint not null default nextval('public.folio_record_changes'),
  updated_at timestamptz not null default now(),
  primary key (user_id,kind,id),
  check (payload is null or jsonb_typeof(payload) = 'object')
);
alter table public.folio_records add column if not exists edition text;
create index if not exists folio_records_change_feed on public.folio_records(user_id,kind,change_id);
alter table public.folio_records enable row level security;
revoke all on public.folio_records from public,anon,authenticated;
grant select on public.folio_records to authenticated;
drop policy if exists folio_records_owner on public.folio_records;
create policy folio_records_owner on public.folio_records for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists folio_records_boundary on public.folio_records;
create policy folio_records_boundary on public.folio_records as restrictive for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Seed only already-private records. Original shared tables stay quarantined.
insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id)
select user_id,'book',id,jsonb_strip_nulls(jsonb_build_object(
 'id',id,'title',title,'author',author,'coverUrl',coalesce(cover_url,''),'coverStyle',coalesce(cover_style,'image'),
 'progressPercent',coalesce(progress_percent,0),'currentPage',coalesce(current_page,1),'totalPages',coalesce(total_pages,0),
 'minutesLeft',coalesce(minutes_left,0),'currentChapter',coalesce(current_chapter,''),'lastOpened',coalesce(last_opened,''),
 'isFinished',coalesce(is_finished,false),'isWantToRead',coalesce(is_want_to_read,false),'totalLoc',total_loc,'currentLoc',current_loc,'coverAlt',coalesce(cover_alt,'Cover of '||title))),1,gen_random_uuid()
from public.folio_books on conflict do nothing;
insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id)
select user_id,'highlight',id,jsonb_strip_nulls(jsonb_build_object('id',id,'bookId',book_id,'bookTitle',book_title,'chapter',coalesce(chapter,''),
 'page',coalesce(page,1),'loc',loc,'text',text,'colorName',coalesce(color_name,'Amber Crayon'),'colorHex',coalesce(color_hex,'#F8E8A2'),'note',note,'dateAdded',coalesce(date_added,''))),1,gen_random_uuid()
from public.folio_highlights on conflict do nothing;
insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id)
select user_id,'lexicon',id,jsonb_strip_nulls(jsonb_build_object('id',id,'bookId',coalesce(book_id,''),'word',word,'definition',definition,
 'phonetic',coalesce(phonetic,''),'partOfSpeech',coalesce(part_of_speech,''),'contextPassage',coalesce(context_passage,''),'chapter',coalesce(chapter,''),'masteryLevel',coalesce(mastery_level,1))),1,gen_random_uuid()
from public.folio_lexicon on conflict do nothing;
insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id)
select user_id,'settings','reader',jsonb_strip_nulls(jsonb_build_object('id','reader','theme',theme,'font',font,'fontSizeStep',font_size_step,
 'lineSpacing',line_spacing,'margins',margins,'usePublisherDefaults',false,'displayReadingPace',display_reading_pace,'defaultCoverStyle',default_cover_style)),1,gen_random_uuid()
from public.folio_reading_settings where id='default_user' on conflict do nothing;

create or replace function public.folio_write_record(p_owner uuid,p_kind text,p_id text,p_payload jsonb,p_expected_revision bigint,p_mutation_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare owner uuid := auth.uid(); current public.folio_records%rowtype; next_row public.folio_records%rowtype; parent_id text;
begin
 if owner is null or p_owner is distinct from owner then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_kind is null or p_kind not in ('book','highlight','lexicon','bookmark','settings') or p_id is null or length(p_id) not between 1 and 500 or p_expected_revision is null or p_expected_revision < 0 or p_mutation_id is null then
   raise exception 'Invalid revision request' using errcode='22023';
 end if;
 if p_payload is not null and (jsonb_typeof(p_payload) <> 'object' or p_payload->>'id' is distinct from p_id or octet_length(p_payload::text)>1048576 or p_payload ? 'user_id' or p_payload ? 'fileLocation') then
   raise exception 'Invalid record payload' using errcode='22023';
 end if;
 if p_payload is not null then
   if p_kind='book' and (jsonb_typeof(p_payload->'title') is distinct from 'string' or jsonb_typeof(p_payload->'author') is distinct from 'string') then raise exception 'Book metadata required' using errcode='22023'; end if;
   if p_kind in ('highlight','bookmark') and (jsonb_typeof(p_payload->'bookId') is distinct from 'string' or length(p_payload->>'bookId')=0) then raise exception 'Book identifier required' using errcode='22023'; end if;
   if p_kind='highlight' and (jsonb_typeof(p_payload->'text') is distinct from 'string' or length(trim(p_payload->>'text'))=0) then raise exception 'Highlight text required' using errcode='22023'; end if;
   if p_kind='lexicon' and (jsonb_typeof(p_payload->'word') is distinct from 'string' or jsonb_typeof(p_payload->'definition') is distinct from 'string') then raise exception 'Vocabulary text required' using errcode='22023'; end if;
   if p_kind='settings' and p_id<>'reader' then raise exception 'Unknown preferences identifier' using errcode='22023'; end if;
   if p_kind='book' and p_payload ? 'documentFingerprint' and (p_payload->>'documentFingerprint') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid edition fingerprint' using errcode='22023'; end if;
 end if;
 -- Serialize writes within an account so parent deletion and child writes cannot race.
 perform pg_advisory_xact_lock(hashtextextended(owner::text,0));
 select * into current from public.folio_records where user_id=owner and kind=p_kind and id=p_id for update;
 if found and current.mutation_id=p_mutation_id then
   if current.payload is distinct from p_payload then raise exception 'Mutation identifier reused' using errcode='22023'; end if;
   return jsonb_build_object('accepted',true,'record',to_jsonb(current)-'user_id');
 end if;
 if coalesce(current.revision,0) <> p_expected_revision then
   return jsonb_build_object('accepted',false,'record',to_jsonb(current)-'user_id');
 end if;
 if p_kind='book' and p_payload is not null and current.edition is not null and p_payload->>'documentFingerprint' is distinct from current.edition then
   raise exception 'The edition of an existing book cannot change; import a separate book' using errcode='22023';
 end if;
 parent_id := p_payload->>'bookId';
 if p_payload is not null and p_kind in ('highlight','lexicon','bookmark') and parent_id is not null and exists(
   select 1 from public.folio_records where user_id=owner and kind='book' and id=parent_id and payload is null
 ) then
   -- A stale child cannot return after its parent was removed, even if it was never uploaded.
   if current.id is null then
     insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id) values(owner,p_kind,p_id,null,1,gen_random_uuid()) returning * into current;
   elsif current.payload is not null then
     update public.folio_records set payload=null,revision=revision+1,mutation_id=gen_random_uuid(),change_id=nextval('public.folio_record_changes'),updated_at=now() where user_id=owner and kind=p_kind and id=p_id returning * into current;
   end if;
   return jsonb_build_object('accepted',false,'record',to_jsonb(current)-'user_id','reason','book_removed');
 end if;
 insert into public.folio_records(user_id,kind,id,payload,revision,mutation_id,edition)
 values(owner,p_kind,p_id,p_payload,p_expected_revision+1,p_mutation_id,case when p_kind='book' then coalesce(current.edition,p_payload->>'documentFingerprint') end)
 on conflict(user_id,kind,id) do update set payload=excluded.payload,edition=excluded.edition,revision=excluded.revision,mutation_id=excluded.mutation_id,updated_at=now(),change_id=nextval('public.folio_record_changes')
 returning * into next_row;
 if p_kind='book' and p_payload is null then
   update public.folio_records set payload=null,revision=revision+1,mutation_id=gen_random_uuid(),updated_at=now(),change_id=nextval('public.folio_record_changes')
   where user_id=owner and kind in ('highlight','lexicon','bookmark') and payload->>'bookId'=p_id;
 end if;
 return jsonb_build_object('accepted',true,'record',to_jsonb(next_row)-'user_id');
end $function$;
revoke all on function public.folio_write_record(uuid,text,text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.folio_write_record(uuid,text,text,jsonb,bigint,uuid) to authenticated;

-- Keep old rows for deliberate migration/recovery, but prevent older clients bypassing revisions.
revoke insert,update,delete on public.folio_books,public.folio_highlights,public.folio_lexicon,public.folio_reading_settings from authenticated;
commit;
