-- Consumo do Tutor IA por intervalo (rodada "Layout do protótipo", 11/10/2026; docs/17 §1.10).
--
-- O que muda:
-- get_ai_usage_summary_between(p_start, p_end, p_agent_type, p_granularity) e uma copia de
-- get_ai_usage_summary(p_days, p_agent_type) (migracao 202607160001) com duas diferencas:
-- 1. a janela e o intervalo [p_start, p_end), e nao "os ultimos N dias ate agora". O admin novo manda
--    os instantes do periodo escolhido na barra superior (Hoje, 1d, 3d, 7d, 30d ou um intervalo do
--    calendario), ja resolvidos no fuso da escola por src/components/admin/v2/period.ts;
-- 2. a serie do grafico sai por balde de hora ou de dia no fuso de America/Sao_Paulo ("byBucket", com
--    a chave 'AAAA-MM-DD' por dia ou 'AAAA-MM-DD"T"HH' por hora, o mesmo formato de getAdminBucketKey),
--    e os "dias ativos" de cada aluno tambem contam o dia de Sao Paulo.
-- O JSON tem as mesmas chaves do resumo antigo (totals, byAgent, byProvider, byConnection, byLesson,
-- byStudent), mais "to", "granularity" e "byBucket" no lugar de "byDay". A funcao antiga continua
-- igual: o admin antigo (/api/admin/ai-usage) segue usando o periodo em dias.
--
-- Seguranca: mesma da funcao copiada (security definer, search_path fixo), execucao so para
-- service_role; o admin le pelo servidor depois de checar o papel. Idempotente (create or replace).

create or replace function public.get_ai_usage_summary_between(
  p_start timestamptz,
  p_end timestamptz,
  p_agent_type text default null,
  p_granularity text default 'day'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Intervalo de consumo invalido.';
  end if;

  -- Um ano bissexto inteiro (366 dias) mais folga de um dia para a troca de fuso.
  if p_end - p_start > interval '367 days' then
    raise exception 'Intervalo de consumo maior que um ano.';
  end if;

  if p_granularity is null or p_granularity not in ('hour', 'day') then
    raise exception 'Granularidade invalida.';
  end if;

  if p_agent_type is not null and p_agent_type not in ('lesson_tutor', 'platform_guide') then
    raise exception 'Tipo de agente invalido.';
  end if;

  with assistant_messages as (
    select
      message.id,
      message.user_id,
      message.conversation_id,
      message.provider,
      message.model,
      message.connection_id,
      message.input_tokens,
      message.output_tokens,
      message.status,
      message.created_at,
      (message.created_at at time zone 'America/Sao_Paulo')::date as local_day,
      case
        when p_granularity = 'hour' then to_char(message.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24')
        else to_char(message.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
      end as bucket,
      conversation.agent_type,
      conversation.lesson_id,
      conversation.lesson_title_snapshot,
      connection.label as connection_label,
      connection.auth_mode
    from public.ai_messages message
    join public.ai_conversations conversation on conversation.id = message.conversation_id
    left join public.ai_provider_connections connection on connection.id = message.connection_id
    where message.role = 'assistant'
      and message.created_at >= p_start
      and message.created_at < p_end
      and (p_agent_type is null or conversation.agent_type = p_agent_type)
  ),
  completed as (
    select * from assistant_messages where status = 'completed'
  ),
  totals as (
    select jsonb_build_object(
      'answers', count(*)::integer,
      'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
      'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
      'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint,
      'activeStudents', count(distinct user_id)::integer,
      'conversations', count(distinct conversation_id)::integer,
      'lessons', (count(distinct lesson_id) filter (where agent_type = 'lesson_tutor'))::integer,
      'failures', (select count(*)::integer from assistant_messages where status = 'failed')
    ) as value
    from completed
  ),
  by_provider as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'provider', coalesce(provider, 'unknown'),
          'model', coalesce(model, 'unknown'),
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by provider, model
    ) grouped
  ),
  by_agent as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'agentType', agent_type,
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'conversations', count(distinct conversation_id)::integer,
          'lessons', count(distinct lesson_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by agent_type
    ) grouped
  ),
  by_connection as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'connectionId', connection_id,
          'label', coalesce(connection_label, 'Conexao removida'),
          'authMode', auth_mode,
          'provider', coalesce(provider, 'unknown'),
          'answers', count(*)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      group by connection_id, connection_label, auth_mode, provider
    ) grouped
  ),
  by_lesson as (
    select coalesce(jsonb_agg(item order by total_tokens desc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'lessonId', lesson_id,
          'lessonTitle', coalesce(
            nullif(trim((array_agg(lesson_title_snapshot order by created_at desc, id desc))[1]), ''),
            'Aula removida'
          ),
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'conversations', count(distinct conversation_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item,
        coalesce(sum(input_tokens + output_tokens), 0) as total_tokens
      from completed
      where agent_type = 'lesson_tutor'
        and lesson_id is not null
      group by lesson_id
      order by total_tokens desc
      limit 100
    ) grouped
  ),
  by_bucket as (
    select coalesce(jsonb_agg(item order by bucket asc), '[]'::jsonb) as value
    from (
      select
        bucket,
        jsonb_build_object(
          'bucket', bucket,
          'answers', count(*)::integer,
          'activeStudents', count(distinct user_id)::integer,
          'inputTokens', coalesce(sum(input_tokens), 0)::bigint,
          'outputTokens', coalesce(sum(output_tokens), 0)::bigint,
          'totalTokens', coalesce(sum(input_tokens + output_tokens), 0)::bigint
        ) as item
      from completed
      group by bucket
    ) grouped
  ),
  by_student as (
    select coalesce(jsonb_agg(item order by total_tokens desc, answers desc, full_name asc), '[]'::jsonb) as value
    from (
      select
        jsonb_build_object(
          'userId', usage.user_id,
          'fullName', coalesce(
            nullif(trim(profile.full_name), ''),
            nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
            'Aluno ' || left(usage.user_id::text, 8)
          ),
          'email', nullif(trim(profile.email), ''),
          'avatarUrl', nullif(trim(profile.avatar_url), ''),
          'answers', usage.answers,
          'conversations', usage.conversations,
          'lessons', usage.lessons,
          'activeDays', usage.active_days,
          'lessonTutorAnswers', usage.lesson_tutor_answers,
          'platformGuideAnswers', usage.platform_guide_answers,
          'inputTokens', usage.input_tokens,
          'outputTokens', usage.output_tokens,
          'totalTokens', usage.total_tokens,
          'lastActivityAt', usage.last_activity_at
        ) as item,
        usage.answers,
        usage.total_tokens,
        coalesce(
          nullif(trim(profile.full_name), ''),
          nullif(split_part(coalesce(profile.email, ''), '@', 1), ''),
          'Aluno ' || left(usage.user_id::text, 8)
        ) as full_name
      from (
        select
          user_id,
          count(*)::integer as answers,
          count(distinct conversation_id)::integer as conversations,
          (count(distinct lesson_id) filter (where agent_type = 'lesson_tutor'))::integer as lessons,
          count(distinct local_day)::integer as active_days,
          (count(*) filter (where agent_type = 'lesson_tutor'))::integer as lesson_tutor_answers,
          (count(*) filter (where agent_type = 'platform_guide'))::integer as platform_guide_answers,
          coalesce(sum(input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(input_tokens + output_tokens), 0)::bigint as total_tokens,
          max(created_at) as last_activity_at
        from completed
        group by user_id
      ) usage
      left join public.profiles profile on profile.id = usage.user_id
    ) grouped
  )
  select jsonb_build_object(
    'from', p_start,
    'to', p_end,
    'granularity', p_granularity,
    'generatedAt', now(),
    'totals', totals.value,
    'byAgent', by_agent.value,
    'byProvider', by_provider.value,
    'byConnection', by_connection.value,
    'byLesson', by_lesson.value,
    'byBucket', by_bucket.value,
    'byStudent', by_student.value
  )
  into result
  from totals, by_agent, by_provider, by_connection, by_lesson, by_bucket, by_student;

  return result;
end;
$$;

revoke all on function public.get_ai_usage_summary_between(timestamptz, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_usage_summary_between(timestamptz, timestamptz, text, text)
  to service_role;
