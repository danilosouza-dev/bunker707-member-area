# Arquitetura Tecnica

## Stack recomendada

Stack principal:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- shadcn/ui;
- Supabase Postgres;
- Row Level Security;
- Supabase Auth;
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

Hotmart/Ticto/TikTok/Kiwify
  -> adapter do provider
  -> produto ou combo interno
  -> entitlements por produto incluido

Aluno assistindo aula
  -> eventos de progresso
  -> tabela student_events
  -> dashboards futuros

Aluno comentando aula
  -> bloqueio por palavra proibida
  -> comentario pendente/aprovado
  -> fila de moderacao
  -> notificacoes futuras

Aluno perguntando para IA
  -> checagem de entitlement
  -> escopo do agente
  -> contexto permitido
  -> conversa auditavel
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
    comments/
    moderation/
    ai/
    jobs/
```

## Autenticacao

Decisao do MVP: Supabase Auth.

Motivos:

- menos fornecedores no primeiro ciclo;
- integrado ao banco e as policies RLS;
- bom para MVP enxuto;
- permite email/senha, OAuth e recuperacao de senha sem expor service role no browser.

Implementacao atual:

- `@supabase/ssr` cria clientes de browser, servidor e middleware;
- o middleware protege home, `Minhas compras`, `Favoritos`, paginas de conteudo/aula e `/admin`;
- `/login` autentica por email/senha e provedores sociais habilitados no Supabase;
- `/auth/callback` troca o codigo OAuth por sessao no servidor;
- apos autenticar, usuarios com papel em `admin_roles` sao direcionados para `/admin`; alunos sem papel administrativo seguem para a area de membros;
- `/alterar-senha` permite que aluno autenticado defina nova senha quando `must_change_password` estiver ativo;
- o middleware redireciona usuarios com `must_change_password = true` para `/alterar-senha` antes de liberar a area de membros;
- `/admin` exige papel em `admin_roles`;
- APIs de progresso exigem usuario autenticado e APIs do CMS exigem permissao administrativa.

Cadastro manual de aluno:

- o CRM pode enviar convite para o aluno criar senha, que e o fluxo padrao;
- alternativamente, o admin pode gerar ou definir uma senha temporaria;
- a rota `/api/admin/students/access` roda apenas no servidor, exige admin e usa Supabase Admin com `service_role`;
- convite usa Supabase Auth e direciona para `/auth/callback?next=/alterar-senha&provider=email`, para trocar o codigo do link em sessao server-side antes de levar o aluno para definir senha;
- senha temporaria cria ou atualiza o usuario no Supabase Auth, marca `must_change_password = true` e nao salva a senha no CMS;
- o mesmo fluxo sincroniza `profiles` e `entitlements` para os cursos/produtos selecionados no cadastro.

Para desenvolvimento local sem variaveis Supabase, existe um fallback controlado:

- aparece o CTA `Entrar em modo local` no login;
- cria um cookie httpOnly local;
- funciona somente quando `NODE_ENV !== "production"` e Supabase Auth nao esta configurado;
- serve apenas para navegar o MVP em `localhost`, nao para autorizacao real.

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
7. Resolver produto ou combo interno.
8. Atualizar entitlements internos.
9. Registrar auditoria.

Combos devem ser tratados como pacotes internos: o adapter normaliza a venda externa, o backend encontra o combo/produto correspondente e a camada de acesso cria entitlements para todos os produtos incluidos. O dado do provider nao autoriza conteudo diretamente.

## Comentarios e moderacao

Comentarios de aula entram pela API autenticada do aluno e devem passar por validacoes antes de aparecer:

1. Verificar sessao e entitlement da aula.
2. Checar palavras bloqueadas.
3. Criar comentario como `pending` ou `approved`, conforme regra do produto.
4. Permitir que moderadores aprovem, ocultem, restaurem ou marquem como spam.
5. Registrar acoes sensiveis em auditoria.

## Agentes de IA

Agentes de IA devem ficar atras de adapters e regras de escopo:

- agente de comentarios: pode sugerir ou publicar respostas conforme configuracao;
- tutor de aula: responde apenas com contexto da aula/produto liberado;
- assistente geral: conhece estrutura, produtos liberados e links internos;
- chat da home: orienta proximos passos do aluno.

Antes de qualquer resposta, o servidor precisa checar entitlement e escopo. Transcricoes, chunks e historico de conversa devem ser armazenados em tabelas proprias quando a IA sair da fase de configuracao.

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

Tracking de progresso:

- o frontend deve registrar inicio, segundos assistidos, percentual atual, maior percentual ja alcancado, abandono/pausa e conclusao por aula;
- players HTML5/proprios usam eventos nativos (`play`, `timeupdate`, `pause`, `ended`) para segundos reais;
- YouTube usa a IFrame API como adapter inicial, lendo `currentTime`, `duration`, estados de play/pause/end e retomando com `seekTo` sem autoplay; enquanto o aluno nao aciona play, a UI cobre o iframe com a thumbnail oficial do YouTube e a barra de progresso salva, porque o frame pausado do embed pode aparecer preto antes da reproducao;
- antes de navegar da aula para home, curso ou modulos, a UI deve forcar um ultimo flush de progresso do player para evitar que carrosseis e barras carreguem dados antigos vindos de prefetch/cache de rota;
- Vimeo, Bunny, Mux e embeds externos devem ficar atras de adapters de player equivalentes, expondo uma interface comum de play, pause, currentTime, duration, seek e estado de conclusao;
- enquanto um adapter especifico ainda nao estiver completo, o app pode registrar inicio por clique no player e um temporizador de sessao para alimentar `Continue assistindo`, deixando claro que esse fallback nao substitui a precisao de provedores com API integrada.

## Eventos do aluno

Registrar eventos desde o MVP.

Eventos iniciais:

- user_signed_in;
- home_viewed;
- course_opened;
- saved_item_toggled;
- lesson_started;
- lesson_progress_updated;
- lesson_retention_point_recorded;
- lesson_completed;
- material_downloaded;
- search_performed;
- support_requested.

Esses eventos alimentarao dashboards, automacoes e IA no futuro.

No MVP, a avaliacao da aula em formato de reacao (`Nao gostei`, `Gostei`, `Amei`) e persistida junto do progresso autenticado da aula em `lesson_progress.lesson_reactions`, para sobreviver a refresh e futuras telas de CRM. A elegibilidade da avaliacao usa o maior percentual ja alcancado na aula, nao apenas a posicao atual do player.

## Favoritos e minha lista

A acao de salvar/favoritar usa a rota server-side `/api/saved-items`, exige sessao autenticada e grava a relacao pessoal do aluno em `saved_items`.

Regras:

- salvar um item nao concede acesso;
- itens salvos continuam respeitando entitlements e regras de liberacao;
- no desenvolvimento local sem Supabase, a mesma lista fica no fallback `.data/bunker707-platform.json`;
- quando Supabase esta configurado, a tabela `saved_items` usa RLS para que cada aluno leia e altere somente os proprios favoritos.
- a sidebar expõe a rota `/favoritos`, que lista conteudos, modulos e aulas salvos pelo aluno autenticado.

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
