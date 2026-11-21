create or replace function public.enqueue_analysis_jobs(p_org uuid,p_actor uuid,p_project uuid,p_estimate uuid,p_drawings uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
 if not exists(select 1 from public.organisation_members where org_id=p_org and user_id=p_actor) then raise exception 'Membership required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,0));
 if cardinality(p_drawings)<1 or cardinality(p_drawings)>20 then raise exception 'Select 1 to 20 documents'; end if;
 if (select count(*) from public.ai_analysis_jobs where org_id=p_org and created_at>now()-interval '24 hours')+cardinality(p_drawings)>20 then raise exception 'Daily document quota reached'; end if;
 if not exists(select 1 from public.estimates where org_id=p_org and project_id=p_project and id=p_estimate) then raise exception 'Estimate not found'; end if;
 if (select count(*) from public.drawings where org_id=p_org and project_id=p_project and id=any(p_drawings) and status='ready' and size<=15728640 and page_count between 1 and 50)<>cardinality(p_drawings) then raise exception 'Invalid documents'; end if;
 with inserted as (insert into public.ai_analysis_jobs(org_id,project_id,estimate_id,drawing_id) select p_org,p_project,p_estimate,unnest(p_drawings) returning id) select jsonb_agg(id) into result from inserted;
 return result;end; $$;
revoke all on function public.enqueue_analysis_jobs(uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.enqueue_analysis_jobs(uuid,uuid,uuid,uuid,uuid[]) to service_role;
create or replace function public.snapshot_estimate_header() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into public.estimate_versions(org_id,project_id,estimate_id,snapshot) values(new.org_id,new.project_id,new.id,jsonb_build_object('estimate',to_jsonb(new),'items',coalesce((select jsonb_agg(b order by b.created_at,b.id) from public.boq_items b where b.estimate_id=new.id),'[]'::jsonb)));
 return new;end; $$;
create trigger snapshot_header after insert or update on public.estimates for each row execute function public.snapshot_estimate_header();
-- Calibration records are immutable snapshots. Measurement updates do not reprice existing BOQ items.
-- Storage content cannot be overwritten after validation; only one-use, non-upsert upload URLs are issued.
alter table public.ai_analysis_jobs add column failures integer not null default 0 check(failures>=0);
