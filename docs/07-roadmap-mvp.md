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
- seed inicial de dados.

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
- Favoritos;
- pagina de curso avulso, formacao ou bootcamp;
- pagina da aula;
- player integrado;
- Modo TV proprio para YouTube com codigo/QR temporario, controle remoto e progresso persistido;
- playlist lateral;
- tabs de descricao/materiais/comentarios;
- dados persistidos com seed inicial.

## Fase 3.5: CMS UI-first

Objetivo: iniciar a area administrativa sem bloquear a futura migracao para Supabase.

Entregas:

- rota `/admin`;
- dashboard escuro inspirado em Netflix/ad manager;
- catalogo de produtos e conteudos;
- construtor de formacoes, cursos internos, modulos e aulas;
- area `Personalizacao` no CRM com lista inicial de destinos editaveis e editores fieis para login, pagina de produtos, paginas de cursos, estrutura interna e vitrine/home;
- itens de CRM para Produtos, Combos, Comunidade, Moderacao, Agentes de IA e Configuracoes > Integracoes;
- CRUD persistido de combos de produtos, com turma padrao `Turma A` quando nenhuma turma for criada;
- moderacao persistida de comentarios e palavras bloqueadas; integracoes externas e agentes de IA continuam em configuracao UI-first;
- regras de liberacao por compra, horas, dias, data fixa e atividade dentro do editor de formacoes, cursos, modulos e aulas;
- entitlements e webhooks externos como camada tecnica/auditavel, nao como item solto da sidebar principal;
- Supabase Postgres/RLS como fonte unica de runtime, sem seeds automaticas, mocks ou fallback local.

## Fase 4: Banco e acesso

Objetivo: conectar experiencia com dados reais.

Entregas:

- Supabase Postgres;
- schema inicial;
- RLS;
- auth com Supabase Auth;
- entitlements internos;
- cursos/modulos/aulas;
- progresso real.

Status atual: Auth, proxy de sessao (proxy.ts), guards de API, `admin_roles`, `profiles`, `student_events` e tabela base de `entitlements` foram implementados. A proxima etapa e conectar as regras de exibicao/liberacao de conteudo diretamente aos entitlements reais.

## Fase 5: Webhooks externos

Objetivo: liberar acesso com venda terceirizada.

Entregas:

- webhook manual/fake para testes;
- adaptador Hotmart;
- adaptador Ticto;
- adaptador TikTok/Kiwify quando entrar no fluxo comercial;
- mapeamento de provider para produto ou combo interno;
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

- comunidade completa;
- ranking;
- conversas;
- certificados;
- notificacoes;
- analise automatizada de sentimento, temas e insights dos comentarios para produtores (a persistencia e a moderacao operacional ja estao implementadas);
- Implementado antecipadamente: Tutor IA conectado a transcricoes versionadas, chunks, BYOK de Gemini/OpenAI/Anthropic, entitlement, citacoes e historico por aluno/aula/chat;
- Implementado antecipadamente: IA Diretor global para localizar conteudos autorizados, recomendar caminhos e montar trilhas, com historico separado, referencias internas validadas e consumo auditado;
- dashboard do professor/admin;
- automacoes de upsell/downsell.

## Prioridade absoluta

Para chegar rapido em algo utilizavel:

1. App shell.
2. Home.
3. Cards verticais.
4. Minhas compras.
5. Favoritos.
6. Pagina da aula.
7. Progresso.
8. Acesso por entitlement.
