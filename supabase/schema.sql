-- ============================================================================
-- Engage X Operating System — Supabase schema
--
-- Run this ONCE in your Supabase project: Dashboard → SQL Editor → New query →
-- paste this whole file → Run.
--
-- Design: one generic table per "collection" the app already uses (employees,
-- clients, tasks, invoices, ...), each holding a free-form JSONB payload. This
-- mirrors the flexible document-store the app was originally built against, so
-- NONE of the app's business logic needed to change — only the thin adapter
-- layer in index.html (EX.makeSupabaseDb) that talks to these tables.
--
-- SECURITY NOTE: the app signs people in with real Supabase Auth (individual
-- email + password per employee, set up from the Employees page). To match
-- that, every table below is open ONLY to the "authenticated" role — i.e. only
-- to a request carrying a valid Supabase Auth session. The "anon" key alone
-- (which is what config.js ships to every visitor's browser) grants NO read or
-- write access on its own; a visitor has to actually sign in first. See the
-- README for how the login flow works, and the "OPTIONAL HARDENING" section at
-- the bottom of this file for even finer-grained, per-role policies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. One JSONB-document table per collection
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'config','employees','leads','proposals','clients','content','tasks','invoices','payments',
    'expenses','vendors','vendorInvoices','bankAccounts','attendance','leaveRequests','wfhRequests','meetings',
    'supportTickets','notifications','videoShoots','auditLog','workRequests','companyAssets'
  ];
begin
  foreach t in array tables loop
    execute format('
      create table if not exists %I (
        id text primary key default gen_random_uuid()::text,
        data jsonb not null default ''{}''::jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    ', t);

    -- Keep updated_at accurate regardless of which code path wrote the row.
    -- NOTE: the derived function/trigger name is built as a plain string FIRST
    -- (t || '_suffix') and THEN quoted as one piece via %I — quoting a bare
    -- table name with %I and then gluing literal text onto the end of that
    -- (e.g. %I_set_updated_at) breaks for any camelCase table name, because
    -- %I only adds double-quotes when the identifier needs them (camelCase
    -- does, lowercase doesn't), and text glued right after a closing quote
    -- is not part of the same identifier.
    execute format('
      create or replace function %I() returns trigger as $f$
      begin
        new.updated_at = now();
        return new;
      end;
      $f$ language plpgsql;
    ', t || '_set_updated_at');
    execute format('drop trigger if exists %I on %I;', 'trg_' || t || '_updated_at', t);
    execute format('
      create trigger %I before update on %I
      for each row execute function %I();
    ', 'trg_' || t || '_updated_at', t, t || '_set_updated_at');

    -- Enable Realtime so EX.watchCollection()''s onSnapshot gets live updates
    -- (safe to re-run; ignores the error if the table is already added).
    begin
      execute format('alter publication supabase_realtime add table %I;', t);
    exception when duplicate_object then
      null;
    end;

    -- Row Level Security: ON, open to any SIGNED-IN user (see SECURITY NOTE
    -- above) but closed to the "anon" role entirely — so simply holding the
    -- public anon key is not enough; a valid Supabase Auth session is required.
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "allow all to anon" on %I;', t);
    execute format('drop policy if exists "allow all to authenticated" on %I;', t);
    execute format('
      create policy "allow all to authenticated" on %I
      for all
      to authenticated
      using (true)
      with check (true);
    ', t);
  end loop;
end $$;

-- Helpful indexes for the two tables the app queries/sorts by most.
create index if not exists idx_employees_created on employees (created_at);
create index if not exists idx_tasks_created on tasks (created_at);

-- ---------------------------------------------------------------------------
-- 2. Storage bucket for uploads (QR payment code, payment-proof images)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('assets', 'assets', true)
on conflict (id) do nothing;

drop policy if exists "assets public read" on storage.objects;
drop policy if exists "assets authenticated read" on storage.objects;
create policy "assets authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'assets');

drop policy if exists "assets anon upload" on storage.objects;
drop policy if exists "assets authenticated upload" on storage.objects;
create policy "assets authenticated upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'assets');

-- ============================================================================
-- OPTIONAL HARDENING (worth doing once real client/financial data is in):
--
-- 1. Finer-grained control — e.g. only Accounts can read `payments` and
--    `invoices`, only HR/Ops/Admin can read `employees.data->>'salary'`.
--    Write per-table policies that look up the signed-in user's employee
--    record (match auth.jwt()->>'email' against employees.data->>'email')
--    and check its role, then drop the blanket "allow all to authenticated"
--    policy on the tables that need it.
--
-- 2. Consider upgrading to a paid Supabase plan for daily backups and to
--    avoid the free tier's auto-pause after a week of inactivity.
--
-- 3. In Supabase → Authentication → Providers → Email, you can turn OFF
--    "Confirm email" so the very first Super Admin signup doesn't need to
--    click a confirmation link before signing in (recommended for an
--    internal tool like this one — logins created from the Employees page
--    are already confirmed automatically either way).
-- ============================================================================
