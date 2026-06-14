# Arquitetura Tecnica

## Stack recomendada

Stack principal:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- shadcn/ui;
- Supabase Postgres;
- Row Level Security;
- Clerk ou Supabase Auth;
- Mux ou Bunny Stream para video;
- PostHog para analytics de produto;
- Sentry para erros;
- Trigger.dev ou Inngest para jobs;
- Vercel no inicio, com possibilidade de migrar para Hetzner.

## Principio de arquitetura

O backend nao deve ser apenas "Supabase". A divisao recomendada e:

```txt
Next.js = aplicacao + backend de regra de negocio
Supabase = banco + RLS + storage simples + auth se escolhido
Jobs = processamento em background
Video = provedor especializado
Analytics = eventos e funis
```

## Componentes

```txt
Aluno
  -> Next.js app
  -> Route handlers/server actions
  -> Supabase Postgres
  -> Provedor de video

Hotmart/Ticto/etc.
  -> Webhook API
  -> evento bruto
  -> job de processamento
  -> entitlement/acesso

Aluno assistindo aula
  -> eventos de progresso
  -> tabela student_events
  -> dashboards futuros
```

## Modulos do backend

Estrutura sugerida:

```txt
src/
  app/
    api/
      webhooks/
      progress/
      search/
      support/
  server/
    auth/
    db/
    access/
    content/
    progress/
    events/
    payments/
    video/
    support/
    jobs/
```

## Autenticacao

Duas opcoes:

### Clerk

Vantagens:

- experiencia pronta e polida;
- MFA, passkeys e provedores sociais;
- boa integracao com Next.js;
- reduz tempo no login.

### Supabase Auth

Vantagens:

- menos fornecedores;
- integrado ao banco;
- bom para MVP enxuto.

Decisao inicial sugerida: Clerk se prioridade for velocidade e UX de login; Supabase Auth se prioridade for simplicidade de stack.

## Acesso e entitlements

A plataforma nao deve perguntar "o aluno comprou?". Ela deve perguntar "o aluno tem entitlement ativo para este conteudo?".

Entitlement e a permissao real dentro da Bunker707.

Exemplos:

- acesso vitalicio a uma formacao;
- acesso temporario a um curso;
- acesso liberado por plano;
- acesso bloqueado por reembolso;
- acesso suspenso por inadimplencia.

## Webhooks externos

Cada plataforma deve ter adaptador proprio:

```txt
HotmartAdapter
TictoAdapter
TikTokAdapter
StripeAdapter
ManualGrantAdapter
```

Fluxo:

1. Receber webhook.
2. Validar assinatura ou token.
3. Salvar payload bruto.
4. Checar idempotencia.
5. Normalizar evento.
6. Processar em job.
7. Atualizar acesso.
8. Registrar auditoria.

## Video

Nao hospedar videos no VPS nem na Vercel.

Usar:

- Mux;
- Bunny Stream;
- Cloudflare Stream, se fizer sentido.

Requisitos:

- playback seguro;
- urls/tokens temporarios;
- controle por aula;
- suporte a thumbnails;
- metadados de duracao;
- possibilidade futura de transcricao.

## Eventos do aluno

Registrar eventos desde o MVP.

Eventos iniciais:

- user_signed_in;
- home_viewed;
- course_opened;
- lesson_started;
- lesson_progress_updated;
- lesson_completed;
- material_downloaded;
- search_performed;
- support_requested.

Esses eventos alimentarao dashboards, automacoes e IA no futuro.

## Deploy

Fase inicial:

- Vercel para app Next.js;
- Supabase para banco;
- Mux/Bunny para video.

Para facilitar migracao futura para Hetzner:

- manter variaveis de ambiente organizadas;
- evitar dependencia forte de Edge Functions da Vercel;
- usar Route Handlers padrao;
- criar Dockerfile quando a implementacao comecar;
- nao guardar arquivos importantes no filesystem local do servidor.
