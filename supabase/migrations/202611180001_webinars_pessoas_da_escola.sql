-- Webinarios, as pessoas que comentam da escola (docs/30 D115; docs/31 §18; docs/21 §9.21; pedido do produtor de
-- 13/11/2026: "listar so o que foi criado hoje nao faz sentido, ne? Tem que listar todos os nomes que foram criados"):
-- a lista "Pessoas que comentam" deixa de ser de cada webinario e passa a ser uma so da escola. Toda pessoa criada
-- aparece em qualquer webinario, novo ou antigo, no editor e no console; trocar o nome, a foto ou o Aparece como muda
-- em todos os roteiros (o que a turma ja viu nao muda: a mensagem e a pergunta guardam a copia). As migracoes de antes
-- nao mudam.
--
-- Regras:
-- - webinar_personas.webinar_id vira so a origem (o webinario em que a pessoa foi criada): aceita nulo, e excluir o
--   webinario deixa a pessoa na lista com a origem nula (on delete set null no lugar do on delete cascade da
--   202611140001). A chave estrangeira antiga sai com `drop constraint if exists`, logo antes do add da nova e atras da
--   guarda do pg_constraint dela (rodar de novo nao derruba nada);
-- - o nome e unico na escola pelo name_key (o mesmo nome comparavel da 202611140001: NFC, espacos repetidos viram um,
--   sem espacos nas pontas, sem caixa). Antes do indice unico, as repetidas de webinarios diferentes viram uma pessoa
--   so: fica a mudada por ultimo (updated_at, depois created_at e id); sem foto, ela recebe a foto mais recente das
--   repetidas que tem foto; os itens do roteiro e as perguntas simuladas das repetidas passam para ela; os itens ligados
--   ficam com a copia dela (a pessoa e a fonte, D75); e as repetidas saem (o unico `delete`: nada mais aponta para
--   elas). O indice antigo (webinar_id, name_key) continua (a 202611140001 o usa no preenchimento) e nunca recusa nada
--   que o novo aceite;
-- - a lista fica parada enquanto junta (lock da tabela na secao 2, a mesma transacao do indice): nenhuma pessoa nova
--   entra entre juntar e criar o indice. A secao 2 inteira e um bloco `do $$` (um comando so, que junta tudo ou nada):
--   o CLI do Supabase aplica cada comando fora de uma transacao, e o lock table pede uma;
-- - os unicos `drop` sao o `drop not null` da origem e o da chave estrangeira trocada; o unico `delete` e o das
--   repetidas. Nada de truncate, create policy nem alter policy; a tabela continua so do service_role. Duas secoes,
--   cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na ordem, as duas comecando com
--   `set lock_timeout = '5s';`), ou apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar (docs/21 §9.21):
--   select (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'webinar_personas_school_name_idx')
--     + (select count(*) from pg_constraint where conname = 'webinar_personas_webinar_school' and confdeltype = 'n')
--     + (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'webinar_personas'
--         and column_name = 'webinar_id' and is_nullable = 'YES') as total; -- 3
--   select count(*) from (select name_key from public.webinar_personas group by name_key having count(*) > 1) as repetidas; -- 0
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. webinar_personas.webinar_id: so a origem, nula quando o webinario e excluido. MCP.
 * ---------------------------------------------------------------------------------------------- */

set lock_timeout = '5s';

alter table public.webinar_personas alter column webinar_id drop not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'webinar_personas_webinar_school') then
    alter table public.webinar_personas drop constraint if exists webinar_personas_webinar_id_fkey;
    alter table public.webinar_personas add constraint webinar_personas_webinar_school
      foreign key (webinar_id) references public.webinars(id) on delete set null;
  end if;
end;
$$;

comment on table public.webinar_personas is 'As pessoas que comentam da escola (docs/30 D115): uma lista so, que o editor e o console de todo webinario usam. O nome e unico na escola.';
comment on column public.webinar_personas.webinar_id is 'O webinario em que a pessoa foi criada (so a origem; a lista e da escola, docs/30 D115). Nula quando ele foi excluido.';

/* ------------------------------------------------------------------------------------------------
 * 2. Uma pessoa por nome na escola: as repetidas viram uma so, e o indice unico do nome. MCP.
 * ---------------------------------------------------------------------------------------------- */

set lock_timeout = '5s';

-- Tudo num bloco so: o CLI do Supabase (o db push da producao e o db start dos testes) aplica cada comando fora de uma
-- transacao, e o lock table so vale dentro de uma. O bloco e um comando so: junta tudo ou nada.
do $$
begin
  -- A lista parada ate o fim da transacao: nenhuma pessoa nova entre juntar e criar o indice.
  lock table public.webinar_personas in share row exclusive mode;

  -- A foto: a que fica, sem foto, recebe a mais recente das repetidas que tem foto.
  with ranked as (
    select p.id, p.avatar_path, p.updated_at, p.created_at,
      first_value(p.id) over (partition by p.name_key order by p.updated_at desc, p.created_at desc, p.id) as survivor_id
    from public.webinar_personas p
  ),
  photo as (
    select distinct on (r.survivor_id) r.survivor_id, r.avatar_path
    from ranked r
    where r.avatar_path is not null
    order by r.survivor_id, r.updated_at desc, r.created_at desc, r.id
  )
  update public.webinar_personas s
  set avatar_path = photo.avatar_path
  from photo
  where s.id = photo.survivor_id
    and s.avatar_path is null;

  -- Os itens do roteiro das repetidas passam para a que fica.
  with ranked as (
    select p.id,
      first_value(p.id) over (partition by p.name_key order by p.updated_at desc, p.created_at desc, p.id) as survivor_id
    from public.webinar_personas p
  )
  update public.webinar_chat_script_items i
  set persona_id = r.survivor_id
  from ranked r
  where i.persona_id = r.id
    and r.id <> r.survivor_id;

  -- As perguntas simuladas das repetidas tambem (so a ligacao: a copia gravada nelas e o que a turma viu).
  with ranked as (
    select p.id,
      first_value(p.id) over (partition by p.name_key order by p.updated_at desc, p.created_at desc, p.id) as survivor_id
    from public.webinar_personas p
  )
  update public.webinar_questions q
  set persona_id = r.survivor_id
  from ranked r
  where q.persona_id = r.id
    and r.id <> r.survivor_id;

  -- A pessoa e a fonte (D75): o item ligado fica com a copia dela (o nome, o papel e a foto).
  update public.webinar_chat_script_items i
  set persona_name = p.name, persona_role = p.role, persona_avatar_path = p.avatar_path
  from public.webinar_personas p
  where i.persona_id = p.id
    and (i.persona_name, i.persona_role, i.persona_avatar_path) is distinct from (p.name, p.role, p.avatar_path);

  -- As repetidas saem: nada mais aponta para elas.
  with ranked as (
    select p.id,
      first_value(p.id) over (partition by p.name_key order by p.updated_at desc, p.created_at desc, p.id) as survivor_id
    from public.webinar_personas p
  )
  delete from public.webinar_personas p
  using ranked r
  where p.id = r.id
    and r.id <> r.survivor_id;

  -- O nome unico na escola.
  create unique index if not exists webinar_personas_school_name_idx on public.webinar_personas (name_key);
end;
$$;
