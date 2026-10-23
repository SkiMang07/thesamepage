-- Schema drift check: production vs schema.sql. Read-only (catalog queries only).
--
-- 1. Build schema.sql on a throwaway Postgres (local_verify_stub.sql first,
--    see docs/ENGINEERING.md -> Verifying schema and RLS changes).
-- 2. Run both statements there, and in the Supabase SQL editor (one at a
--    time there: the editor only shows the last statement's result).
-- 3. Compare. Every row of the first result should match (category, n,
--    fingerprint). Where a fingerprint differs, list that category's
--    objects with left(md5(def),10) on both sides to find the one that moved.
--    A function that differs only in comments is cosmetic. As of 2026-10-22
--    the function fingerprint differs for exactly that reason (comments in
--    accept_direct_report_invite and complete_performance_review).
--    In the second result, anon should be true only for get_invite_preview,
--    current_org_id and the trigger function handle_new_user (see
--    ENGINEERING.md -> SECURITY DEFINER functions).

with
pub_tables as (
  select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and not exists (select 1 from pg_depend d where d.objid=c.oid and d.deptype='e')
),
objs(category, name, def) as (
  select 'table'::text, t.relname::text, c.relrowsecurity::text||'/'||c.relforcerowsecurity::text
    from pub_tables t join pg_class c on c.oid=t.oid
  union all
  select 'column', t.relname||'.'||a.attname,
         format_type(a.atttypid,a.atttypmod)||'|nn='||a.attnotnull||'|def='||coalesce(pg_get_expr(d.adbin,d.adrelid),'')
         ||'|id='||a.attidentity::text||'|gen='||a.attgenerated::text
    from pub_tables t join pg_attribute a on a.attrelid=t.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  union all
  select 'constraint', t.relname||'.'||co.conname, co.contype::text||' '||pg_get_constraintdef(co.oid)
    from pub_tables t join pg_constraint co on co.conrelid=t.oid
  union all
  select 'index', i.indexname, i.indexdef from pg_indexes i where i.schemaname='public'
  union all
  select 'policy', p.schemaname||'.'||p.tablename||'.'||p.policyname,
         p.permissive||'|'||p.cmd||'|'||array_to_string(p.roles,',')||'|q='||coalesce(p.qual,'')||'|wc='||coalesce(p.with_check,'')
    from pg_policies p where p.schemaname='public' or (p.schemaname='storage' and p.tablename='objects')
  union all
  select 'function', p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_functiondef(p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind in ('f','p')
      and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  union all
  select 'trigger', c.relname||'.'||tg.tgname, pg_get_triggerdef(tg.oid)
    from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_proc f on f.oid=tg.tgfoid
    join pg_namespace fn on fn.oid=f.pronamespace
    where not tg.tgisinternal and fn.nspname='public'
  union all
  select 'view', c.relname, pg_get_viewdef(c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m')
  union all
  select 'enum', t.typname, (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typtype='e'
  union all
  select 'bucket', b.id, b.public::text from storage.buckets b where b.id='context-engine-docs'
  union all
  select 'seed', 'test_account_patterns.'||pattern, coalesce(note,'') from public.test_account_patterns
  union all
  select 'extension', e.extname, '' from pg_extension e where e.extname='uuid-ossp'
)
-- Result 1: one row per object category
select category, count(*) as n,
       left(md5(string_agg(name||'='||md5(def), ';' order by name collate "C")), 12) as fingerprint
from objs group by category order by category;

-- Result 2: who can call the security-definer functions and the two locked tables
select 'function' as kind, p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as name,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
union all
select 'table', c.relname, has_table_privilege('anon', c.oid, 'select'), has_table_privilege('authenticated', c.oid, 'select')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('deleted_accounts','test_account_patterns')
order by 1, 2;
