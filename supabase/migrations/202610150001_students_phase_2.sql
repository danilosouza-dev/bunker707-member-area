-- Alunos, entrega 2 (2026-10-15): registro de auditoria do admin, segmentos salvos, turmas por aluno,
-- ultimo login no perfil, atividade diaria real do player e ciclo de vida semanal.
--
-- Regras:
-- - nenhuma destas tabelas e lida pelo navegador: RLS ligado, nada para anon/authenticated e so o
--   servidor (service_role), sempre depois de requireRole;
-- - funcoes de leitura sao `security invoker` com `search_path` fixo e executaveis so pelo servidor;
-- - a unica `security definer` e a do gatilho em auth.users, que nunca pode derrubar o login.
--
-- Verificacao manual depois de aplicar (nao ha harness SQL no repositorio):
--   select * from public.admin_lifecycle_weeks(12);
--   select count(*) from public.student_daily_activity where approximate;
--   select name, students_count from public.admin_product_cohorts('<id de um produto>');

/* ------------------------------------------------------------------------------------------------
 * 1. Registro de auditoria do admin (docs/17 §2.3): exportacao, acoes de acesso, importacao, exclusao.
 *    So ids e contagens em metadata (nunca nome, busca digitada ou e-mail, exceto a exclusao, que
 *    guarda o e-mail como prova). O servidor so insere e le: nao altera nem apaga o rastro.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(action) between 3 and 80),
  entity_type text check (entity_type is null or char_length(entity_type) <= 40),
  entity_id text check (entity_id is null or char_length(entity_id) <= 240),
  count integer check (count is null or count >= 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 4096),
  occurred_at timestamptz not null default now()
);

create index if not exists admin_audit_log_occurred_idx on public.admin_audit_log (occurred_at desc);
create index if not exists admin_audit_log_actor_action_idx on public.admin_audit_log (actor_id, action, occurred_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated, service_role;
grant select, insert on public.admin_audit_log to service_role;

comment on table public.admin_audit_log is
  'Quem fez o que no admin (acesso, exportacao, importacao, exclusao). Append-only: o servidor so insere e le.';

/* ------------------------------------------------------------------------------------------------
 * 2. Segmentos salvos da lista de Alunos: nome + os mesmos parametros do endereco da lista, ja na
 *    forma canonica (o servidor revalida com o mesmo parser ao salvar e ao abrir).
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.student_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 60),
  params jsonb not null default '{}'::jsonb
    check (jsonb_typeof(params) = 'object' and pg_column_size(params) <= 2048),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_segments_name_lower_idx on public.student_segments (lower(btrim(name)));

drop trigger if exists set_student_segments_updated_at on public.student_segments;
create trigger set_student_segments_updated_at
  before update on public.student_segments
  for each row execute function public.set_updated_at();

alter table public.student_segments enable row level security;
revoke all on public.student_segments from anon, authenticated;
grant select, insert, update, delete on public.student_segments to service_role;

/* ------------------------------------------------------------------------------------------------
 * 3. Turmas por aluno: uma turma por (aluno, produto). Nome da turma unico sem diferenciar
 *    maiusculas. admin_product_cohorts volta a contar de verdade: so quem tem acesso aberto agora e
 *    nao faz parte da equipe.
 * ---------------------------------------------------------------------------------------------- */

do $$
begin
  if exists (select 1 from public.cohorts group by lower(btrim(name)) having count(*) > 1) then
    raise notice 'cohorts: ha nomes repetidos sem diferenciar maiusculas; una-os e crie o indice cohorts_name_lower_idx depois.';
  else
    create unique index if not exists cohorts_name_lower_idx on public.cohorts (lower(btrim(name)));
  end if;
end $$;

create table if not exists public.cohort_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.content_items(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (user_id, product_id)
);

create index if not exists cohort_memberships_product_cohort_idx on public.cohort_memberships (product_id, cohort_id);

alter table public.cohort_memberships enable row level security;
revoke all on public.cohort_memberships from anon, authenticated;
grant select, insert, update, delete on public.cohort_memberships to service_role;

create or replace function public.admin_product_cohorts(p_content_id text)
returns table (name text, students_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select c.name, count(distinct m.user_id)::integer as students_count
  from public.cohort_memberships m
  join public.cohorts c on c.id = m.cohort_id
  where m.product_id = p_content_id
    and exists (
      select 1
      from public.entitlements e
      where e.user_id = m.user_id
        and e.target_id = m.product_id
        and e.status = 'active'
        and e.starts_at <= now()
        and (e.ends_at is null or e.ends_at > now())
    )
    and not exists (select 1 from public.admin_roles s where s.user_id = m.user_id)
  group by c.name
  order by c.name;
$$;

revoke all on function public.admin_product_cohorts(text) from public, anon, authenticated;
grant execute on function public.admin_product_cohorts(text) to service_role;

comment on function public.admin_product_cohorts(text) is
  'Turmas do produto com a quantidade de alunos que tem acesso aberto agora (sem a equipe).';

/* ------------------------------------------------------------------------------------------------
 * 4. Ultimo login no perfil: copiado de auth.users por gatilho (a lista de Alunos nao precisa mais
 *    varrer o Auth). A funcao nunca lanca erro, para um problema no perfil nao derrubar o login.
 *    O aluno so pode alterar nome, telefone e foto do proprio perfil.
 * ---------------------------------------------------------------------------------------------- */

alter table public.profiles add column if not exists last_sign_in_at timestamptz;

create or replace function public.sync_profile_last_sign_in()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set last_sign_in_at = new.last_sign_in_at
    where id = new.id;
  return new;
exception
  when others then
    raise warning 'sync_profile_last_sign_in: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.sync_profile_last_sign_in() from public, anon, authenticated, service_role;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in
  after update of last_sign_in_at on auth.users
  for each row
  when (old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.sync_profile_last_sign_in();

update public.profiles p
  set last_sign_in_at = u.last_sign_in_at
  from auth.users u
  where u.id = p.id
    and p.last_sign_in_at is distinct from u.last_sign_in_at;

revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

/* ------------------------------------------------------------------------------------------------
 * 5. Atividade diaria real: segundos assistidos e aulas concluidas por aluno, dia e produto, gravados
 *    pelo servidor depois de cada progresso confirmado (ver src/server/progress/student-activity.ts).
 *    Dia no fuso da escola. Limites repetidos aqui: no maximo 30 s e 50 aulas por chamada.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.student_daily_activity (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  content_id text not null,
  seconds_watched integer not null default 0 check (seconds_watched >= 0),
  lessons_completed integer not null default 0 check (lessons_completed >= 0),
  approximate boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day, content_id)
);

create index if not exists student_daily_activity_day_idx on public.student_daily_activity (day);

alter table public.student_daily_activity enable row level security;
revoke all on public.student_daily_activity from anon, authenticated;
grant select, insert, update, delete on public.student_daily_activity to service_role;

create or replace function public.record_student_activity(
  p_user_id uuid,
  p_content_id text,
  p_seconds integer,
  p_completed integer
)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.student_daily_activity (user_id, day, content_id, seconds_watched, lessons_completed)
  values (
    p_user_id,
    (now() at time zone 'America/Sao_Paulo')::date,
    p_content_id,
    least(greatest(coalesce(p_seconds, 0), 0), 30),
    least(greatest(coalesce(p_completed, 0), 0), 50)
  )
  on conflict (user_id, day, content_id) do update set
    seconds_watched = public.student_daily_activity.seconds_watched + excluded.seconds_watched,
    lessons_completed = public.student_daily_activity.lessons_completed + excluded.lessons_completed,
    approximate = false,
    updated_at = now();
$$;

revoke all on function public.record_student_activity(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_student_activity(uuid, text, integer, integer) to service_role;

-- Backfill aproximado (docs/17 §2.5): o ultimo "assistiu" de cada aula ja gravado em
-- lesson_progress.lesson_watch_states vira um dia de atividade (sem segundos; aulas concluidas do
-- produto contam nesse dia). Marcado como aproximado para a tela avisar.
insert into public.student_daily_activity (user_id, day, content_id, seconds_watched, lessons_completed, approximate)
select
  p.user_id::uuid,
  (w.last_watched at time zone 'America/Sao_Paulo')::date,
  p.content_id,
  0,
  coalesce(cardinality(p.completed_lesson_ids), 0),
  true
from public.lesson_progress p
cross join lateral (
  select max((entry.value->>'lastWatchedAt')::timestamptz) as last_watched
  from jsonb_each(coalesce(p.lesson_watch_states, '{}'::jsonb)) as entry
  where (entry.value->>'lastWatchedAt') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
) w
where w.last_watched is not null
  and p.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and exists (select 1 from auth.users u where u.id::text = p.user_id)
on conflict (user_id, day, content_id) do nothing;

/* ------------------------------------------------------------------------------------------------
 * 6. Ciclo de vida semanal (docs/17 §1.11), classificado no banco e devolvido pronto (<= 26 linhas).
 *    Semana comeca na segunda, no fuso da escola. Ativo na semana = >= 600 s ou >= 1 aula concluida.
 *    Novos = primeira semana ativa em toda a historia; Retidos = ativo nesta e na anterior;
 *    Recuperados = ativo nesta, nao na anterior, com atividade antes; Inativos = acesso aberto ha
 *    pelo menos 4 semanas e sem semana ativa nas 4 ultimas. A equipe nunca entra.
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_lifecycle_weeks(p_weeks integer default 12)
returns table (
  week_start date,
  new_count integer,
  retained_count integer,
  recovered_count integer,
  inactive_count integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      greatest(1, least(coalesce(p_weeks, 12), 26)) as weeks,
      date_trunc('week', now() at time zone 'America/Sao_Paulo')::date as current_week
  ),
  weeks as (
    select (p.current_week - (g.i * 7))::date as week_start
    from params p
    cross join generate_series(0, p.weeks - 1) as g(i)
  ),
  students as (
    select pr.id as user_id
    from public.profiles pr
    where not exists (select 1 from public.admin_roles s where s.user_id = pr.id)
  ),
  active as (
    select a.user_id, date_trunc('week', a.day)::date as week_start
    from public.student_daily_activity a
    join students st on st.user_id = a.user_id
    group by 1, 2
    having sum(a.seconds_watched) >= 600 or sum(a.lessons_completed) >= 1
  ),
  first_active as (
    select user_id, min(week_start) as first_week from active group by 1
  ),
  eligible as (
    select w.week_start, e.user_id
    from weeks w
    join public.entitlements e
      on e.status = 'active'
     and e.starts_at <= (w.week_start + 7) - interval '28 days'
     and (e.ends_at is null or e.ends_at >= w.week_start + 7)
    join students st on st.user_id = e.user_id
    group by 1, 2
  )
  select
    w.week_start,
    (select count(*) from first_active f where f.first_week = w.week_start)::integer as new_count,
    (
      select count(*)
      from active a
      where a.week_start = w.week_start
        and exists (select 1 from active b where b.user_id = a.user_id and b.week_start = w.week_start - 7)
    )::integer as retained_count,
    (
      select count(*)
      from active a
      join first_active f on f.user_id = a.user_id
      where a.week_start = w.week_start
        and f.first_week < w.week_start
        and not exists (select 1 from active b where b.user_id = a.user_id and b.week_start = w.week_start - 7)
    )::integer as recovered_count,
    (
      select count(*)
      from eligible x
      where x.week_start = w.week_start
        and not exists (
          select 1 from active a
          where a.user_id = x.user_id
            and a.week_start > w.week_start - 28
            and a.week_start <= w.week_start
        )
    )::integer as inactive_count
  from weeks w
  order by w.week_start;
$$;

create or replace function public.admin_lifecycle_week_members(p_week_start date, p_group text)
returns table (user_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  with students as (
    select pr.id as user_id
    from public.profiles pr
    where not exists (select 1 from public.admin_roles s where s.user_id = pr.id)
  ),
  active as (
    select a.user_id, date_trunc('week', a.day)::date as week_start
    from public.student_daily_activity a
    join students st on st.user_id = a.user_id
    group by 1, 2
    having sum(a.seconds_watched) >= 600 or sum(a.lessons_completed) >= 1
  ),
  first_active as (
    select user_id, min(week_start) as first_week from active group by 1
  ),
  eligible as (
    select e.user_id
    from public.entitlements e
    join students st on st.user_id = e.user_id
    where e.status = 'active'
      and e.starts_at <= (p_week_start + 7) - interval '28 days'
      and (e.ends_at is null or e.ends_at >= p_week_start + 7)
    group by 1
  )
  select f.user_id from first_active f where p_group = 'new' and f.first_week = p_week_start
  union
  select a.user_id from active a
    where p_group = 'retained' and a.week_start = p_week_start
      and exists (select 1 from active b where b.user_id = a.user_id and b.week_start = p_week_start - 7)
  union
  select a.user_id from active a join first_active f on f.user_id = a.user_id
    where p_group = 'recovered' and a.week_start = p_week_start and f.first_week < p_week_start
      and not exists (select 1 from active b where b.user_id = a.user_id and b.week_start = p_week_start - 7)
  union
  select x.user_id from eligible x
    where p_group = 'inactive'
      and not exists (
        select 1 from active a
        where a.user_id = x.user_id and a.week_start > p_week_start - 28 and a.week_start <= p_week_start
      )
  limit 1000;
$$;

revoke all on function public.admin_lifecycle_weeks(integer) from public, anon, authenticated;
revoke all on function public.admin_lifecycle_week_members(date, text) from public, anon, authenticated;
grant execute on function public.admin_lifecycle_weeks(integer) to service_role;
grant execute on function public.admin_lifecycle_week_members(date, text) to service_role;

comment on function public.admin_lifecycle_weeks(integer) is
  'Ciclo de vida semanal dos alunos (novos, retidos, recuperados, inativos), semanas a partir da segunda-feira no fuso da escola.';
comment on function public.admin_lifecycle_week_members(date, text) is
  'Alunos de um grupo do ciclo de vida numa semana (new, retained, recovered, inactive); ate 1000.';
