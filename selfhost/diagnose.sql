-- Diagnostics for the self-hosted instance, for the three symptoms that the front-end code
-- already handles correctly (so the cause is on this side).
--
-- Run on the server:
--   docker compose -f /opt/mkn/supabase/docker/docker-compose.yml exec -T db \
--     psql -U postgres -d postgres -f - < diagnose.sql
-- ...or paste into Studio's SQL editor.

\echo '=== A. Did the beds migrate? =========================================='
-- Bed Master builds its location dropdown and its "last bed number" hint from these rows.
-- With zero rows the dropdown correctly collapses to a free-text "new location" box and the
-- Remove-beds card hides itself entirely -- which looks exactly like "the feature is missing".
select count(*) as bed_count, count(distinct location) as locations from public.mkn_beds;
select location, count(*) as beds, max(nullif(regexp_replace(bed,'\D','','g'),'')::int) as last_bed_number
  from public.mkn_beds group by location order by location;

\echo '=== B. Row counts overall (compare against the old project) ============'
-- Old project at migration time: 18 users, 12-13 requests, 17 travellers, 2 cabs, 45 beds.
select 'auth.users' t, count(*) from auth.users
union all select 'mkn_profiles', count(*) from public.mkn_profiles
union all select 'mkn_trip_requests', count(*) from public.mkn_trip_requests
union all select 'mkn_trip_travellers', count(*) from public.mkn_trip_travellers
union all select 'mkn_cab_requests', count(*) from public.mkn_cab_requests
union all select 'mkn_beds', count(*) from public.mkn_beds
union all select 'storage.objects', count(*) from storage.objects;

\echo '=== C. Can the accommodation desk actually SEE approved requests? ======'
-- The Accommodation tab asks for status in (approved, booked). If RLS returns no rows for an
-- accommodation_desk caller, the tab looks empty however correct the front end is. This is the
-- same function that had to be hand-fixed for cancelled requests, so it is the prime suspect.
select id, role from public.mkn_profiles where role in ('accommodation_desk','travel_desk','admin');

\echo '--- simulated accommodation_desk view (rolled back, nothing persisted) ---'
begin;
  set local role authenticated;
  set local request.jwt.claims = (
    select json_build_object('sub', id::text, 'role', 'authenticated')::text
      from public.mkn_profiles where role = 'accommodation_desk' limit 1);
  select status, count(*) as visible_rows
    from public.mkn_trip_requests group by status order by status;
rollback;

\echo '--- the same for travel_desk, to compare ---'
begin;
  set local role authenticated;
  set local request.jwt.claims = (
    select json_build_object('sub', id::text, 'role', 'authenticated')::text
      from public.mkn_profiles where role = 'travel_desk' limit 1);
  select status, count(*) as visible_rows
    from public.mkn_trip_requests group by status order by status;
rollback;

\echo '=== D. Is the schema the current version? ============================='
-- ticket_path is what per-traveller ticket uploads write to. If it is missing, the migration
-- carried an older schema and booking separate tickets will fail at the RPC.
select column_name from information_schema.columns
 where table_schema='public' and table_name='mkn_trip_travellers'
   and column_name in ('ticket_path','id_number','id_number_masked','bed_id') order by 1;

-- mkn_tr_set_bed must accept 'approved', not just 'booked' -- that is what lets accommodation
-- pre-assign a bed before the ticket exists.
select proname,
       (pg_get_functiondef(p.oid) like '%approved%') as mentions_approved
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in
   ('mkn_tr_set_bed','mkn_can_see_request','mkn_can_see_cab','mkn_tr_book','mkn_ensure_profile')
 order by proname;

\echo '=== E. Functions present (old project had 32 mkn_* functions) ========='
select count(*) as mkn_function_count from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname like 'mkn%';

\echo '=== F. id_number must stay unreadable ================================'
-- The raw ID number is hidden by column-level grants, not by RLS. If the migration restored a
-- blanket table grant, raw Aadhaar/passport numbers became readable through the API.
select grantee, string_agg(column_name, ', ' order by column_name) as readable_columns
  from information_schema.column_privileges
 where table_schema='public' and table_name='mkn_trip_travellers' and privilege_type='SELECT'
   and grantee in ('anon','authenticated')
 group by grantee;
