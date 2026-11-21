create extension if not exists pgcrypto;
create table public.organisations(id uuid primary key default gen_random_uuid(),name text not null check(length(name) between 1 and 200),created_at timestamptz not null default now());
create table public.organisation_members(org_id uuid not null references public.organisations(id),user_id uuid not null references auth.users(id),role text not null check(role in ('admin','estimator')),created_at timestamptz not null default now(),primary key(org_id,user_id));
create or replace function public.is_member(target uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.organisation_members where org_id=target and user_id=auth.uid()); $$;
create or replace function public.create_organisation(org_name text) returns uuid language plpgsql security definer set search_path='' as $$ declare result uuid; begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if exists(select 1 from public.organisation_members where user_id=auth.uid()) then raise exception 'Already a member'; end if;
 insert into public.organisations(name) values(trim(org_name)) returning id into result;
 insert into public.organisation_members(org_id,user_id,role) values(result,auth.uid(),'admin'); return result; end; $$;
revoke all on function public.create_organisation(text) from public;
grant execute on function public.create_organisation(text) to authenticated;
create table public.projects(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organisations(id),data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(org_id,id));
create table public.estimates(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,project_id) references public.projects(org_id,id),unique(org_id,project_id,id));
create table public.drawings(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,name text not null,mime text not null,size integer not null check(size>0 and size<=20971520),path text not null unique,number text not null default '',revision text not null,discipline text not null,status text not null default 'pending' check(status in ('pending','ready','invalid')),page_count integer not null default 0 check(page_count>=0),created_at timestamptz not null default now(),foreign key(org_id,project_id) references public.projects(org_id,id),unique(org_id,project_id,id),check(path=org_id::text||'/'||project_id::text||'/'||id::text));
create table public.drawing_pages(org_id uuid not null,project_id uuid not null,drawing_id uuid not null,page integer not null check(page>0),primary key(drawing_id,page),unique(org_id,project_id,drawing_id,page),foreign key(org_id,project_id,drawing_id) references public.drawings(org_id,project_id,id));
create table public.takeoff_calibrations(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,drawing_id uuid not null,page integer not null,data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,project_id,drawing_id,page) references public.drawing_pages(org_id,project_id,drawing_id,page),unique(org_id,project_id,id));
create table public.takeoff_measurements(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,calibration_id uuid not null,drawing_id uuid not null,page integer not null,data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,project_id,calibration_id) references public.takeoff_calibrations(org_id,project_id,id),foreign key(org_id,project_id,drawing_id,page) references public.drawing_pages(org_id,project_id,drawing_id,page),unique(org_id,project_id,id));
create table public.cost_rates(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organisations(id),data jsonb not null,version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(org_id,id));
create unique index cost_rate_code on public.cost_rates(org_id,(data->>'code'));
create table public.ai_analysis_jobs(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,estimate_id uuid not null,drawing_id uuid not null,status text not null default 'queued' check(status in ('queued','running','completed','failed')),response_id text,attempts integer not null default 0,available_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,error text,result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,project_id,estimate_id) references public.estimates(org_id,project_id,id),foreign key(org_id,project_id,drawing_id) references public.drawings(org_id,project_id,id),unique(org_id,project_id,id));
create table public.boq_items(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,estimate_id uuid not null,drawing_id uuid,source_page integer,data jsonb not null,rate_snapshot jsonb,status text not null default 'draft' check(status in ('draft','approved','rejected')),version integer not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,project_id,estimate_id) references public.estimates(org_id,project_id,id),foreign key(org_id,project_id,drawing_id,source_page) references public.drawing_pages(org_id,project_id,drawing_id,page),check((drawing_id is null)=(source_page is null)),check(status<>'approved' or (data->>'quantity' is not null and (data->>'quantity')::numeric>=0 and (data->>'rate')::numeric>=0)));
create table public.estimate_versions(id uuid primary key default gen_random_uuid(),org_id uuid not null,project_id uuid not null,estimate_id uuid not null,snapshot jsonb not null,created_at timestamptz not null default now(),foreign key(org_id,project_id,estimate_id) references public.estimates(org_id,project_id,id));
create table public.audit_events(id bigint generated always as identity primary key,org_id uuid not null references public.organisations(id),project_id uuid,actor_id uuid references auth.users(id),entity text not null,entity_id uuid,operation text not null,before_data jsonb,after_data jsonb,created_at timestamptz not null default now(),foreign key(org_id,project_id) references public.projects(org_id,id));
create table public.request_limits(org_id uuid not null references public.organisations(id),bucket text not null,window_start timestamptz not null,hits integer not null default 0,primary key(org_id,bucket,window_start));
create index memberships_user on public.organisation_members(user_id);
create index jobs_pending on public.ai_analysis_jobs(status,available_at);
create index boq_estimate on public.boq_items(org_id,estimate_id);
create index audit_project on public.audit_events(org_id,project_id,created_at desc);
create or replace function public.audit_change() returns trigger language plpgsql security definer set search_path='' as $$ declare row_data jsonb; begin
 row_data=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 insert into public.audit_events(org_id,project_id,actor_id,entity,entity_id,operation,before_data,after_data) values((row_data->>'org_id')::uuid,case when TG_TABLE_NAME='projects' then (row_data->>'id')::uuid else (row_data->>'project_id')::uuid end,nullif(current_setting('app.actor_id',true),'')::uuid,TG_TABLE_NAME,(row_data->>'id')::uuid,TG_OP,case when TG_OP<>'INSERT' then to_jsonb(old) end,case when TG_OP<>'DELETE' then to_jsonb(new) end);
 return coalesce(new,old);end; $$;
do $$ declare t text; begin
 foreach t in array array['organisations','organisation_members','projects','estimates','drawings','drawing_pages','takeoff_calibrations','takeoff_measurements','cost_rates','ai_analysis_jobs','boq_items','estimate_versions','audit_events','request_limits'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t<>'request_limits' then
 execute format('grant select on public.%I to authenticated',t);
 execute format('create policy tenant_read on public.%I for select to authenticated using(public.is_member(%I))',t,case when t='organisations' then 'id' else 'org_id' end);
 end if;
 if t in ('projects','estimates','drawings','takeoff_calibrations','takeoff_measurements','cost_rates','boq_items') then
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
 end if;
 if t not in ('organisations','organisation_members','request_limits') then execute format('create index on public.%I(org_id)',t); end if;
 end loop; end $$;
-- All writes go through authenticated server routes using the service role. Browser clients are read-only.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('documents','documents',false,20971520,array['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- No storage policies grant browser reads/writes: server issues short-lived URLs after membership checks.
create or replace function public.consume_limit(p_org uuid,p_bucket text,p_limit integer,p_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$ declare n integer; w timestamptz; begin
 w=to_timestamp(floor(extract(epoch from now())/p_seconds)*p_seconds);
 insert into public.request_limits(org_id,bucket,window_start,hits) values(p_org,p_bucket,w,1) on conflict(org_id,bucket,window_start) do update set hits=public.request_limits.hits+1 returning hits into n;
 return n<=p_limit; end; $$;
revoke all on function public.consume_limit(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_limit(uuid,text,integer,integer) to service_role;
