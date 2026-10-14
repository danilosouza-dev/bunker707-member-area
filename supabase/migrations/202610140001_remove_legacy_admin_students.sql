-- Remocao do admin antigo (2026-10-14).
--
-- O admin antigo guardava alunos em tabelas proprias (students, student_courses,
-- student_access_logs) e sincronizava acessos para entitlements por e-mail. O admin novo trabalha
-- direto sobre as contas (auth.users + profiles) e sobre entitlements, que sao a unica fonte de
-- autorizacao da area do aluno. Nada no codigo le mais essas tres tabelas; elas saem do banco.
--
-- A funcao admin_product_cohorts contava matriculas de student_courses por turma. Turmas continuam
-- existindo (tabela cohorts), mas ainda nao ha vinculo aluno x turma no modelo novo: a funcao
-- mantem a assinatura e devolve as turmas cadastradas com 0 alunos, ate a tela de Alunos ganhar turma.

create or replace function public.admin_product_cohorts(p_content_id text)
returns table (name text, students_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select c.name, 0::integer as students_count
  from public.cohorts c
  where false;
$$;

comment on function public.admin_product_cohorts(text) is
  'Turmas com alunos do produto. Sem vinculo aluno x turma no modelo novo, devolve vazio (assinatura mantida).';

drop trigger if exists set_student_courses_updated_at on public.student_courses;
drop trigger if exists set_students_updated_at on public.students;

drop table if exists public.student_access_logs cascade;
drop table if exists public.student_courses cascade;
drop table if exists public.students cascade;
