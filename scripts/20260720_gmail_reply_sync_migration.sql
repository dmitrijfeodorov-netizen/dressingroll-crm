create extension if not exists pgcrypto;

-- Per-owner Gmail sync cursor/state for history-based incremental sync.
create table if not exists public.gmail_sync_cursors (
  owner_id uuid primary key,
  gmail_email text,
  last_history_id text,
  watch_expiration_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_gmail_sync_cursors_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gmail_sync_cursors_updated_at on public.gmail_sync_cursors;
create trigger trg_gmail_sync_cursors_updated_at
before update on public.gmail_sync_cursors
for each row
execute function public.set_gmail_sync_cursors_updated_at();

-- Extend email_messages for inbound/reply syncing while preserving existing rows.
alter table public.email_messages
  add column if not exists direction text,
  add column if not exists received_at timestamptz,
  add column if not exists processing_status text,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_error text;

-- Backfill/normalize defaults for existing outbound rows.
update public.email_messages
set direction = coalesce(direction, 'outbound')
where direction is null;

update public.email_messages
set processing_status = coalesce(processing_status, 'processed')
where processing_status is null;

alter table public.email_messages
  alter column direction set default 'outbound',
  alter column direction set not null,
  alter column processing_status set default 'pending',
  alter column processing_status set not null;

-- Add enum-like safety checks idempotently.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_messages_direction_check'
      and conrelid = 'public.email_messages'::regclass
  ) then
    alter table public.email_messages
      add constraint email_messages_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'email_messages_processing_status_check'
      and conrelid = 'public.email_messages'::regclass
  ) then
    alter table public.email_messages
      add constraint email_messages_processing_status_check
      check (processing_status in ('pending', 'processed', 'failed', 'ignored'));
  end if;
end $$;

-- Allow inbound messages that are not yet mapped to a clinic/contact/template.
alter table public.email_messages
  alter column clinic_id drop not null;

-- Optional but useful indexes for sync jobs.
create index if not exists idx_email_messages_owner_direction
  on public.email_messages(owner_id, direction);

create index if not exists idx_email_messages_owner_received_at
  on public.email_messages(owner_id, received_at desc);

create index if not exists idx_email_messages_owner_processing_status
  on public.email_messages(owner_id, processing_status);

create index if not exists idx_email_messages_owner_thread
  on public.email_messages(owner_id, gmail_thread_id)
  where gmail_thread_id is not null;

-- Prevent duplicate Gmail messages per owner while allowing nulls.
create unique index if not exists uq_email_messages_owner_gmail_message_id
  on public.email_messages(owner_id, gmail_message_id)
  where gmail_message_id is not null and direction = 'inbound';

-- Security posture: keep sync cursor table inaccessible to browser roles.
alter table public.gmail_sync_cursors enable row level security;
grant all privileges on table public.gmail_sync_cursors to service_role;
revoke all on table public.gmail_sync_cursors from anon, authenticated;

drop policy if exists gmail_sync_cursors_no_browser_access on public.gmail_sync_cursors;
create policy gmail_sync_cursors_no_browser_access
on public.gmail_sync_cursors
for all
to anon, authenticated
using (false)
with check (false);
