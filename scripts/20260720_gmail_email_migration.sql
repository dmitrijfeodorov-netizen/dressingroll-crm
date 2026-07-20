create extension if not exists pgcrypto;

create table if not exists public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique,
  google_email text,
  access_token text,
  refresh_token text not null,
  expires_at bigint,
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  template_id uuid references public.email_templates(id) on delete set null,
  recipient text not null,
  sender text not null,
  subject text not null,
  body_html text,
  body_text text,
  gmail_message_id text,
  gmail_thread_id text,
  status text not null,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_messages_owner_id on public.email_messages(owner_id);
create index if not exists idx_email_messages_clinic_id on public.email_messages(clinic_id);
create index if not exists idx_email_messages_sent_at on public.email_messages(sent_at);

create or replace function public.set_gmail_connections_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_gmail_connections_updated_at on public.gmail_connections;
create trigger trg_gmail_connections_updated_at
before update on public.gmail_connections
for each row
execute function public.set_gmail_connections_updated_at();

alter table public.gmail_connections enable row level security;
alter table public.email_messages enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on table public.email_messages to anon, authenticated;

revoke all on table public.gmail_connections from anon, authenticated;

drop policy if exists gmail_connections_no_browser_access on public.gmail_connections;
create policy gmail_connections_no_browser_access
on public.gmail_connections
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists email_messages_select_owner on public.email_messages;
create policy email_messages_select_owner
on public.email_messages
for select
to anon, authenticated
using (owner_id = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9'::uuid);

drop policy if exists email_messages_insert_owner on public.email_messages;
create policy email_messages_insert_owner
on public.email_messages
for insert
to anon, authenticated
with check (owner_id = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9'::uuid);

drop policy if exists email_messages_update_owner on public.email_messages;
create policy email_messages_update_owner
on public.email_messages
for update
to anon, authenticated
using (owner_id = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9'::uuid)
with check (owner_id = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9'::uuid);

drop policy if exists email_messages_delete_owner on public.email_messages;
create policy email_messages_delete_owner
on public.email_messages
for delete
to anon, authenticated
using (owner_id = '4fe3eb83-7c50-4eee-8af7-4a550dacecd9'::uuid);
