# Roadmap do MVP

## Fase 0: Preparacao

Objetivo: transformar o planejamento em base implementavel.

Entregas:

- documentacao do projeto;
- decisoes de stack;
- schema inicial;
- wireframe da home e aula;
- identidade visual inicial da Bunker707.

Status: em andamento.

## Fase 1: App base

Objetivo: ter uma aplicacao Next.js navegavel com design inicial.

Entregas:

- projeto Next.js com TypeScript;
- Tailwind/shadcn/ui;
- layout autenticado;
- header;
- sidebar via menu hamburguer;
- tema escuro;
- dados mockados.

## Fase 2: Home do aluno

Objetivo: primeira experiencia estilo streaming.

Entregas:

- hero;
- primeira fileira sobrepondo hero;
- cards verticais;
- carrosseis;
- secoes de continue assistindo, formacoes, cursos avulsos e bootcamps;
- responsividade desktop/mobile.

## Fase 3: Conteudo e aula

Objetivo: permitir consumo basico de aulas.

Entregas:

- Minhas compras;
- pagina de curso avulso, formacao ou bootcamp;
- pagina da aula;
- player integrado;
- playlist lateral;
- tabs de descricao/materiais/comentarios;
- dados mockados ou seed inicial.

## Fase 3.5: CMS UI-first

Objetivo: iniciar a area administrativa sem bloquear o backend real.

Entregas:

- rota `/admin`;
- dashboard escuro inspirado em Netflix/ad manager;
- catalogo de produtos e conteudos;
- construtor de formacoes, cursos internos, modulos e aulas;
- regras mockadas de liberacao por compra, horas, dias, data fixa e atividade;
- visao inicial de entitlements e webhooks externos;
- dados mockados alinhados ao modelo futuro.

## Fase 4: Banco e acesso

Objetivo: conectar experiencia com dados reais.

Entregas:

- Supabase Postgres;
- schema inicial;
- RLS;
- auth;
- entitlements;
- cursos/modulos/aulas;
- progresso real.

## Fase 5: Webhooks externos

Objetivo: liberar acesso com venda terceirizada.

Entregas:

- webhook manual/fake para testes;
- adaptador Hotmart;
- adaptador Ticto;
- idempotencia;
- logs de eventos;
- tela de meus acessos.

## Fase 6: Analytics e suporte

Objetivo: registrar comportamento desde o inicio.

Entregas:

- student_events;
- eventos de aula;
- PostHog;
- Sentry;
- suporte simples;
- busca funcional.

## Fase 7: Melhorias pos-MVP

Funcionalidades:

- comunidade;
- ranking;
- conversas;
- certificados;
- notificacoes;
- IA da aula;
- dashboard do professor/admin;
- automacoes de upsell/downsell.

## Prioridade absoluta

Para chegar rapido em algo utilizavel:

1. App shell.
2. Home.
3. Cards verticais.
4. Minhas compras.
5. Pagina da aula.
6. Progresso.
7. Acesso por entitlement.
