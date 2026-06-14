# Bunker707 Member Area

Documentacao inicial da area de membros da escola de IA Bunker707.

O produto sera uma plataforma fechada para alunos, sem vitrine publica de cursos e sem checkout interno. As vendas acontecem em plataformas externas como Hotmart, Ticto, TikTok ou outras. A Bunker707 recebe eventos dessas plataformas e usa esses eventos para liberar, manter ou remover acesso aos conteudos.

## Objetivo

Construir uma area de membros robusta, moderna e preparada para evoluir com:

- home estilo Netflix;
- login e acesso fechado;
- cursos, trilhas, modulos e aulas;
- cards verticais;
- progresso do aluno;
- pagina de aula com player, playlist, materiais e comentarios;
- webhooks de plataformas externas;
- eventos comportamentais para dashboards futuros;
- IA futura para tirar duvidas dentro das aulas;
- base de dados preparada para metricas, segmentacao e personalizacao.

## Documentos

- [Visao do produto](docs/01-visao-produto.md)
- [Area do aluno e UX](docs/02-area-aluno-ux.md)
- [Referencia analisada: Astron Academy](docs/03-referencia-astron.md)
- [Arquitetura tecnica](docs/04-arquitetura-tecnica.md)
- [Modelo de dados inicial](docs/05-modelo-dados.md)
- [Seguranca e operacao](docs/06-seguranca-operacao.md)
- [Roadmap do MVP](docs/07-roadmap-mvp.md)
- [Backlog inicial](docs/08-backlog-inicial.md)
- [Decisoes abertas](docs/09-decisoes-abertas.md)
- [Workflow e skill Codex](docs/10-codex-workflow.md)
- [Inventario da coleta Astron](docs/11-inventario-coleta-astron.md)
- [Design system Bunker707](docs/12-design-system-bunker707.md)
- [Padroes de engenharia e repositorio](docs/13-padroes-engenharia.md)

## Padroes de trabalho

Este projeto usa um unico repositorio privado para a area de membros e o CMS.

- branch principal: `main`;
- commits: Conventional Commits, como `feat: adicionar pagina de aula` ou `fix: corrigir card bloqueado`;
- verificacao local: `npm run verify`;
- pull requests: usar o template em `.github/pull_request_template.md`;
- segredos: nunca commitar `.env`, chaves de servico, tokens ou payloads sensiveis.

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo completo.

## Decisoes iniciais

- A venda sera terceirizada; a plataforma controla somente acesso, conteudo e experiencia do aluno.
- O core do backend deve ser orientado por acesso e eventos, nao por ecommerce.
- A stack recomendada para o MVP e Next.js, TypeScript, Supabase Postgres/RLS, Clerk ou Supabase Auth, Mux/Bunny Stream, PostHog, Sentry e Trigger.dev/Inngest.
- O app pode comecar na Vercel e ser migrado para Hetzner depois se o projeto for construindo com Docker, variaveis de ambiente limpas e pouca dependencia especifica da Vercel.

## Estado atual

O repositorio ja possui a base inicial do app:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- lucide-react para icones;
- app shell com header;
- menu hamburguer com sidebar/drawer;
- home do aluno com hero estilo streaming;
- primeira linha de cards sobrepondo o fim da hero;
- cards verticais;
- pagina propria de formacao/curso com breadcrumb;
- pagina `Minhas compras` em `/minhas-compras`;
- hero de conteudo configuravel por mock data;
- cards internos de cursos e modulos;
- pagina da aula com player mockado, playlist, materiais, comentarios e progresso local;
- prototipo inicial do CMS/admin em `/admin`, com dashboard, catalogo, estrutura de conteudo, regras de liberacao e entitlements mockados;
- dados mockados.

O proximo passo natural e evoluir o CMS UI-first junto das telas auxiliares de busca, perfil/acessos e suporte, ainda com dados mockados, antes de conectar Supabase/Auth.

## Skill Codex

Foi criado o skill pessoal `bunker707-members-area` em:

`/Users/danilosouza/.codex/skills/bunker707-members-area`

Use esse skill em futuras conversas sobre produto, UX, arquitetura ou implementacao da area de membros Bunker707.
