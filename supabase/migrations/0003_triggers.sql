-- =============================================================================
-- 0003_triggers.sql
--   * handle_new_user(): when someone signs up (row lands in auth.users), create
--     their public.users profile AND a `free` subscription row automatically.
--   * set_updated_at(): keep updated_at columns fresh on UPDATE.
-- =============================================================================

-- ── updated_at maintenance ──────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.users;
create trigger set_updated_at before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.resumes;
create trigger set_updated_at before update on public.resumes
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.subscriptions;
create trigger set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── new-user bootstrap ──────────────────────────────────────────────────────
-- SECURITY DEFINER so it can write to public.* regardless of who inserted into
-- auth.users. search_path pinned for safety.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;

  insert into public.subscriptions (user_id, status)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
