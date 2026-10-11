-- Tela Hoje do admin (docs/17 §1.5 e §1.11; rodada "Layout do protótipo", frente HOJE).
--
-- O que muda: duas funcoes de leitura, sem tabela nova e sem mudar dado nenhum.
-- 1. admin_today_alerts(p_content_id): numeros dos cartoes "Precisa de atenção hoje" que dependem do banco:
--    - perguntas de alunos sem resposta do professor ha mais de 24 h (mesma definicao da Comunidade:
--      view community_open_questions + aulas visiveis de community_lesson_scope, migracao 202610110020);
--    - acessos ativos que terminam nos proximos 7 dias (ends_at em (agora, agora + 7 dias]).
-- 2. admin_access_buckets(p_start, p_end, p_granularity, p_content_id): acessos liberados (criados) na janela
--    [p_start, p_end), por hora ou por dia no fuso da escola. Alimenta o numero "Novos acessos", o delta contra o
--    periodo anterior (a pagina chama de novo com a janela anterior) e o mini-grafico.
--    A chave do balde e a mesma de getAdminBucketKey (src/components/admin/v2/period.ts):
--    'AAAA-MM-DD' por dia e 'AAAA-MM-DD"T"HH' por hora, em America/Sao_Paulo.
--
-- Regras (iguais em todo o admin): a equipe (quem esta em admin_roles) nunca entra nas contas; com um produto
-- escolhido, so o que e daquele produto (aulas do produto e dos cursos da formacao, como na Comunidade; acessos
-- cujo alvo e o produto). "Produto publicado sem aula publicada" nao precisa de SQL novo: sai de
-- admin_product_list(p_status => 'published') (migracao 202610110011).
--
-- Seguranca: security invoker, search_path fixo, execucao so para service_role (o admin le pelo servidor depois
-- de checar o papel). Idempotente: create or replace + revoke/grant repetiveis.

/* ------------------------------------------------------------------------------------------------
 * 1. Cartoes de atencao
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_today_alerts(p_content_id text default null)
returns table (overdue_questions bigint, expiring_accesses bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    (
      select count(*)
      from public.community_open_questions q
      join public.community_lesson_scope(p_content_id) scope on scope.lesson_id = q.lesson_id
      where q.created_at < now() - interval '24 hours'
    ) as overdue_questions,
    (
      select count(*)
      from (
        select distinct e.user_id, e.target_id
        from public.entitlements e
        where e.status = 'active'
          and e.starts_at <= now()
          and e.ends_at > now()
          and e.ends_at <= now() + interval '7 days'
          and (p_content_id is null or e.target_id = p_content_id)
          and not exists (select 1 from public.admin_roles staff where staff.user_id = e.user_id)
      ) expiring
    ) as expiring_accesses;
$$;

comment on function public.admin_today_alerts(text) is
  'Hoje do admin: perguntas sem resposta ha mais de 24 h e acessos ativos que terminam em 7 dias (sem a equipe).';

/* ------------------------------------------------------------------------------------------------
 * 2. Novos acessos por balde
 * ---------------------------------------------------------------------------------------------- */

create or replace function public.admin_access_buckets(
  p_start timestamptz,
  p_end timestamptz,
  p_granularity text,
  p_content_id text default null
)
returns table (bucket text, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_granularity is null or p_granularity not in ('hour', 'day') then
    raise exception 'invalid_granularity' using errcode = '22023';
  end if;

  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'invalid_window' using errcode = '22023';
  end if;

  -- Uma janela de grafico nunca passa de um ano (o calendario limita a 366 dias).
  if p_end - p_start > interval '370 days' then
    raise exception 'window_too_long' using errcode = '22023';
  end if;

  return query
  select
    case
      when p_granularity = 'hour' then to_char(e.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24')
      else to_char(e.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
    end as bucket,
    count(*)::bigint as total
  from public.entitlements e
  where e.created_at >= p_start
    and e.created_at < p_end
    and (p_content_id is null or e.target_id = p_content_id)
    and not exists (select 1 from public.admin_roles staff where staff.user_id = e.user_id)
  group by 1
  order by 1;
end;
$$;

comment on function public.admin_access_buckets(timestamptz, timestamptz, text, text) is
  'Hoje do admin: acessos criados em [p_start, p_end), por hora ou dia em America/Sao_Paulo, sem a equipe.';

-- Contagem por janela de criacao (o indice de usuario/situacao nao ajuda aqui).
create index if not exists entitlements_created_at_idx on public.entitlements (created_at);
-- Acessos que terminam em breve.
create index if not exists entitlements_active_ends_at_idx
  on public.entitlements (ends_at)
  where status = 'active' and ends_at is not null;

/* ------------------------------------------------------------------------------------------------
 * 3. Permissoes
 * ---------------------------------------------------------------------------------------------- */

revoke all on function public.admin_today_alerts(text) from public, anon, authenticated;
revoke all on function public.admin_access_buckets(timestamptz, timestamptz, text, text) from public, anon, authenticated;

grant execute on function public.admin_today_alerts(text) to service_role;
grant execute on function public.admin_access_buckets(timestamptz, timestamptz, text, text) to service_role;
