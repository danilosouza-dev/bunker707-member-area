-- Webinarios, o link aberto (docs/30 §14, D127 a D134; pedido do produtor de 23/11/2026: "Eu quero ter um link para
-- mandar para pessoas que queiram participar sem ser alunos", "pode ser 1 como pode ser 100 ou mais"): quem nao e aluno
-- entra por /webinarios/<slug>/entrar com o que a equipe escolheu pedir (nome, e-mail, telefone ou nada) e ganha uma
-- conta de convidado presa aquele webinario. A chave do link (ligado e o que pedir) mora em webinars.room_settings
-- (`openLink`), sem coluna nova, como o showPresentCount (D102). Esta migracao traz so o que a conta de convidado
-- precisa:
--
-- - profiles.is_guest: a marca do convidado. A lista de Alunos, os segmentos da Comunicacao, a busca por e-mail e os
--   avisos leem o perfil e deixam o convidado de fora por ela. O aluno nunca muda a marca: o grant de update do
--   authenticated continua so em full_name, phone e avatar_url (202610150001), e quem grava e o servidor (service_role);
-- - webinar_guests: quem entrou pelo link, uma linha por entrada, com o que a pessoa preencheu e a frase do aceite
--   (LGPD) quando deu e-mail ou telefone. A lista da equipe e o CSV leem daqui. A linha fica mesmo se a conta de
--   convidado sair (user_id vira nulo); sai junto com o webinario excluido de vez.
--
-- So do service_role (RLS ligada, sem politica, revoke de anon e authenticated). Sem delete, truncate, drop nem
-- create policy. Duas secoes, cada uma pelo MCP do Supabase (execute_sql, uma por chamada, na ordem), ou
-- apply_migration com o arquivo inteiro.
--
-- Verificacao manual depois de aplicar:
--   select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
--             and column_name = 'is_guest')
--     + (select count(*) from pg_tables where schemaname = 'public' and tablename = 'webinar_guests' and rowsecurity)
--     + (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'webinar_guests_webinar_idx') as total; -- 3
--
-- Idempotente: pode rodar de novo sem efeito.

/* ------------------------------------------------------------------------------------------------
 * 1. profiles.is_guest: a marca do convidado do link aberto. MCP.
 * ---------------------------------------------------------------------------------------------- */

alter table public.profiles add column if not exists is_guest boolean not null default false;

create index if not exists profiles_is_guest_idx on public.profiles (id) where is_guest;

/* ------------------------------------------------------------------------------------------------
 * 2. webinar_guests: quem entrou pelo link aberto. MCP.
 * ---------------------------------------------------------------------------------------------- */

create table if not exists public.webinar_guests (
  id uuid primary key default gen_random_uuid(),
  webinar_id uuid not null references public.webinars(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  full_name text check (full_name is null or char_length(full_name) between 1 and 80),
  email text check (email is null or char_length(email) between 3 and 254),
  phone text check (phone is null or char_length(phone) between 8 and 20),
  consent_text text check (consent_text is null or char_length(consent_text) <= 600),
  consent_at timestamptz,
  source text check (source is null or char_length(source) <= 120),
  created_at timestamptz not null default now()
);

create index if not exists webinar_guests_webinar_idx on public.webinar_guests (webinar_id, created_at desc);

alter table public.webinar_guests enable row level security;
revoke all on public.webinar_guests from anon, authenticated;
grant all on public.webinar_guests to service_role;
