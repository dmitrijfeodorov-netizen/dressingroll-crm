create extension if not exists pgcrypto;

create table if not exists public.email_candidate_discovery_progress (
  owner_id uuid primary key,
  last_clinic_id uuid references public.clinics(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace function public.set_email_candidate_discovery_progress_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_email_candidate_discovery_progress_updated_at on public.email_candidate_discovery_progress;
create trigger trg_email_candidate_discovery_progress_updated_at
before update on public.email_candidate_discovery_progress
for each row
execute function public.set_email_candidate_discovery_progress_updated_at();

alter table public.email_candidate_discovery_progress enable row level security;

grant all privileges on table public.email_candidate_discovery_progress to service_role;
revoke all on table public.email_candidate_discovery_progress from anon, authenticated;

drop policy if exists email_candidate_discovery_progress_no_browser_access on public.email_candidate_discovery_progress;
create policy email_candidate_discovery_progress_no_browser_access
on public.email_candidate_discovery_progress
for all
to anon, authenticated
using (false)
with check (false);
