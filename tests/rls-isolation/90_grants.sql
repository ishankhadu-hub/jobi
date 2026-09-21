-- =============================================================================
-- TEST-ONLY grants for a PLAIN Postgres (NOT applied on real Supabase).
-- On Supabase, `authenticated`/`anon`/`service_role` already hold these grants
-- via default privileges. RLS then filters rows on top of these table grants.
-- Applied only when RLS_LOCAL_BOOTSTRAP=1.
-- =============================================================================
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
grant all on all tables in schema public to service_role;

grant usage, select on all sequences in schema public to authenticated, service_role;

-- Future tables too (harmless here; mirrors Supabase defaults).
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant select on tables to anon;
