create or replace function public.claim_analysis_job() returns public.ai_analysis_jobs language plpgsql security definer set search_path='' as $$ declare job public.ai_analysis_jobs; begin
 if not pg_try_advisory_xact_lock(72649301) then return null; end if;
 if (select count(*) from public.ai_analysis_jobs where status='running' and lease_until>now())>=2 then return null; end if;
 update public.ai_analysis_jobs set status='failed',error='Analysis timed out. Queue the document again.',updated_at=now() where status in ('queued','running') and created_at<now()-interval '24 hours';
 update public.ai_analysis_jobs set status='failed',error='Retry budget exhausted.',updated_at=now() where status in ('queued','running') and attempts>=3 and response_id is null and lease_until<now();
 select * into job from public.ai_analysis_jobs where status in ('queued','running') and available_at<=now() and (lease_until is null or lease_until<now()) and (attempts<3 or response_id is not null) order by available_at,created_at for update skip locked limit 1;
 if not found then return null; end if;
 update public.ai_analysis_jobs set status='running',lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),attempts=attempts+case when response_id is null then 1 else 0 end,updated_at=now() where id=job.id returning * into job;
 return job;end; $$;
create or replace function public.finish_analysis_job(p_id uuid,p_lease uuid,p_items jsonb,p_result jsonb) returns boolean language plpgsql security definer set search_path='' as $$ declare job public.ai_analysis_jobs; item jsonb; begin
 select * into job from public.ai_analysis_jobs where id=p_id and lease_token=p_lease and status='running' for update;
 if not found then return false; end if;
 for item in select value from jsonb_array_elements(p_items) loop
 insert into public.boq_items(org_id,project_id,estimate_id,drawing_id,source_page,data,status) values(job.org_id,job.project_id,job.estimate_id,job.drawing_id,(item->>'source_page')::integer,item,'draft');
 end loop;
 update public.ai_analysis_jobs set status='completed',result=p_result,error=null,lease_until=null,updated_at=now() where id=job.id;
 return true;end; $$;
revoke all on function public.claim_analysis_job() from public,anon,authenticated;
revoke all on function public.finish_analysis_job(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.claim_analysis_job() to service_role;
grant execute on function public.finish_analysis_job(uuid,uuid,jsonb,jsonb) to service_role;
