-- Service-only transactional write gateway. The API validates input and checks membership first.
create or replace function public.write_entity(p_table text,p_org uuid,p_actor uuid,p_id uuid,p_version integer,p_values jsonb,p_delete boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare cols text; vals text; sets text; result jsonb; existing jsonb; has_version boolean; payload jsonb;
begin
 if p_table not in ('projects','estimates','drawings','drawing_pages','takeoff_calibrations','takeoff_measurements','cost_rates','boq_items') then raise exception 'Invalid entity'; end if;
 if not exists(select 1 from public.organisation_members where org_id=p_org and user_id=p_actor) then raise exception 'Membership required'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 has_version=p_table not in ('drawings','drawing_pages');
 if p_id is not null then
 execute format('select to_jsonb(t) from public.%I t where id=$1 and org_id=$2 for update',p_table) into existing using p_id,p_org;
 if existing is null then raise exception 'Not found'; end if;
 if has_version and (p_version is null or (existing->>'version')::integer<>p_version) then raise exception 'Version conflict' using errcode='40001'; end if;
 if p_delete then
 if p_table not in ('boq_items','takeoff_measurements') then raise exception 'Deletion is not supported'; end if;
 execute format('delete from public.%I where id=$1 and org_id=$2',p_table) using p_id,p_org; return existing;
 end if;
 payload=p_values-'id'-'org_id'-'created_at'-'version'-'updated_at';
 if has_version then payload=payload||jsonb_build_object('version',p_version+1,'updated_at',now()); end if;
 select string_agg(format('%I=v.%I',k,k),',') into sets from jsonb_object_keys(payload) k;
 execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I,$1) v where t.id=$2 and t.org_id=$3 returning to_jsonb(t)',p_table,sets,p_table) into result using payload,p_id,p_org;
 else
 payload=p_values||jsonb_build_object('org_id',p_org);
 select string_agg(format('%I',k),','),string_agg(format('v.%I',k),',') into cols,vals from jsonb_object_keys(payload) k;
 execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1) v returning to_jsonb(%I)',p_table,cols,vals,p_table,p_table) into result using payload;
 end if; return result; end; $$;
revoke all on function public.write_entity(text,uuid,uuid,uuid,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.write_entity(text,uuid,uuid,uuid,integer,jsonb,boolean) to service_role;
create or replace function public.snapshot_estimate() returns trigger language plpgsql security definer set search_path='' as $$ declare e public.estimates; target uuid; begin
 target=coalesce(new.estimate_id,old.estimate_id);
 select * into e from public.estimates where id=target for update;
 insert into public.estimate_versions(org_id,project_id,estimate_id,snapshot) values(e.org_id,e.project_id,e.id,jsonb_build_object('estimate',to_jsonb(e),'items',coalesce((select jsonb_agg(b order by b.created_at,b.id) from public.boq_items b where b.estimate_id=e.id),'[]'::jsonb)));
 return coalesce(new,old); end; $$;
create trigger snapshot_boq after insert or update or delete on public.boq_items for each row execute function public.snapshot_estimate();
create or replace function public.duplicate_estimate(p_org uuid,p_actor uuid,p_estimate uuid) returns uuid language plpgsql security definer set search_path='' as $$ declare e public.estimates; result uuid; begin
 if not public.is_member(p_org) and not exists(select 1 from public.organisation_members where org_id=p_org and user_id=p_actor) then raise exception 'Membership required'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 select * into strict e from public.estimates where id=p_estimate and org_id=p_org for update;
 insert into public.estimates(org_id,project_id,data) values(p_org,e.project_id,jsonb_set(e.data,'{name}',to_jsonb((e.data->>'name')||' — copy'))) returning id into result;
 insert into public.boq_items(org_id,project_id,estimate_id,drawing_id,source_page,data,rate_snapshot,status) select org_id,project_id,result,drawing_id,source_page,data,rate_snapshot,'draft' from public.boq_items where estimate_id=e.id;
 return result; end; $$;
revoke all on function public.duplicate_estimate(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.duplicate_estimate(uuid,uuid,uuid) to service_role;
create or replace function public.import_rates(p_org uuid,p_actor uuid,p_rates jsonb) returns integer language plpgsql security definer set search_path='' as $$ declare r jsonb; n integer=0; begin
 if not exists(select 1 from public.organisation_members where org_id=p_org and user_id=p_actor) then raise exception 'Membership required'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 if jsonb_array_length(p_rates)>10000 then raise exception 'Too many rates'; end if;
 for r in select value from jsonb_array_elements(p_rates) loop
 insert into public.cost_rates(org_id,data) values(p_org,r) on conflict(org_id,(data->>'code')) do update set data=excluded.data,version=public.cost_rates.version+1,updated_at=now(); n=n+1;
 end loop;return n;end; $$;
revoke all on function public.import_rates(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_rates(uuid,uuid,jsonb) to service_role;
