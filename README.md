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
- A stack do MVP usa Next.js, TypeScript, Supabase Postgres/RLS, Supabase Auth, Mux/Bunny Stream, PostHog, Sentry e Trigger.dev/Inngest.
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
- login real com Supabase Auth, middleware de sessao e callback OAuth;
- modo local de desenvolvimento para navegar sem Supabase quando `NODE_ENV !== "production"`;
- paginas autenticadas protegidas por sessao;
- CMS/admin em `/admin` protegido por papel em `admin_roles`;
- hero de conteudo configuravel por backend persistido;
- cards internos de cursos e modulos;
- pagina da aula com player, playlist, materiais, progresso e comentarios/respostas/reacoes/denuncias persistidos no backend;
- favoritos/minha lista persistidos por aluno para produtos, conteudos e aulas;
- pagina `Favoritos` em `/favoritos`, acessivel pela sidebar, reunindo tudo que o aluno salvou;
- CMS/admin em `/admin`, com dashboard, catalogo, estrutura de conteudo, personalizacao, CRM de alunos e turmas; regras de liberacao sao configuradas dentro de formacoes, cursos, modulos e aulas;
- CRM com navegacao expandida para Produtos, Combos, Comunidade, Moderacao, Agentes de IA e Configuracoes > Integracoes;
- CRUD persistido de combos de produtos, usando `Turma A` como padrao quando nenhuma turma foi criada;
- moderacao persistida de comentarios e palavras bloqueadas no CRM, com fila por status/denuncia e auditoria das acoes;
- area de Personalizacao no CRM com lista inicial de vitrine, login, pagina de produtos e produtos/cursos; cada item abre um editor proprio com representacao fiel da pagina final e opcoes laterais de edicao;
- separacao visual e de navegacao entre area de membros (`/`) e CRM/backoffice (`/admin`), com logos levando para a home correta e atalhos entre as duas experiencias para usuarios admin;
- fluxo inicial de criacao no CMS para formacoes, cursos, mentorias, webinarios, produtos e bootcamps, com capa, acesso gratuito/fechado, limite de estudantes, link externo de compra e regras de entrega por data ou por dias apos inscricao;
- construtor em passos dentro do Catalogo para salvar a configuracao inicial e, no mesmo local, cadastrar modulos e aulas;
- opcao no CMS para exibir na home uma secao com capa pequena do curso e cards menores dos modulos de um curso especifico, util para produtores com catalogo curto;
- upload local da capa vertical do card em 720 x 1040 px e hero opcional da pagina propria em 1920 x 720 px;
- modo de preview na area de membros para navegar como sessao atual, produtor/admin, aluno com acesso ou aluno sem acesso, visivel somente para usuarios internos com papel em `admin_roles`;
- Supabase Postgres/RLS como persistencia primaria, com fallback local em `.data/bunker707-platform.json` apenas quando as variaveis Supabase nao estao configuradas no ambiente de desenvolvimento.
- quando Supabase esta configurado, a base real nao recebe seed/demo automaticamente; cursos, formacoes, modulos, turmas, alunos, aulas e progresso entram por cadastros persistidos e APIs server-side.

Sem as variaveis Supabase em desenvolvimento, a tela de login mostra `Entrar em modo local` para permitir navegacao no MVP. Em `localhost`, esse modo tambem fica disponivel quando Supabase esta configurado mas inacessivel durante o desenvolvimento. Ele usa cookie local httpOnly, funciona apenas fora de producao e nao substitui Supabase Auth em ambiente real.

O proximo passo natural e aplicar as migrations no projeto Supabase, popular `admin_roles` para os usuarios internos e evoluir a camada de entitlements/webhooks que libera acesso a partir das vendas externas.

## Skill Codex

Foi criado o skill pessoal `bunker707-members-area` em:

`/Users/danilosouza/.codex/skills/bunker707-members-area`

Use esse skill em futuras conversas sobre produto, UX, arquitetura ou implementacao da area de membros Bunker707.
