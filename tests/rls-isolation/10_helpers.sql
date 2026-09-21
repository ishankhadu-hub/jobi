-- =============================================================================
-- Test helper — applied on BOTH plain Postgres and Supabase.
-- create_test_user(): insert a row into auth.users so the on_auth_user_created
-- trigger provisions the profile + free subscription. SECURITY DEFINER so the
-- test can call it without owning the auth schema.
-- =============================================================================
create or replace function public.create_test_user(p_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (p_id, p_email, jsonb_build_object('full_name', split_part(p_email, '@', 1)))
  on conflict (id) do nothing;
end;
$$;
