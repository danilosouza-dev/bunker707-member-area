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
- Tutor IA por aula para tirar duvidas somente sobre aquela aula;
- IA Diretor, separada do Tutor, para orientar o aluno sobre cursos, assuntos, trilhas e a plataforma como um todo;
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
- [Auditoria tecnica de 10/07/2026](docs/14-auditoria-tecnica-2026-07-10.md)
- [Deploy seguro na Vercel](docs/15-deploy-vercel-seguro.md)
- [Auditoria tecnica de 01/10/2026](docs/16-auditoria-tecnica-2026-10-01.md)
- [Admin do Produtor: especificacao do redesign (10/10/2026)](docs/17-admin-produtor-redesign.md)
- [Padrao de testes e rotina de qualidade (16/10/2026)](docs/18-padrao-de-testes.md)
- [Infra propria (Hetzner) e e-mail (Resend): numeros e decisao de 18/10/2026](docs/19-infra-hetzner-e-email.md)
- [Runbook: Bunker707 na Hetzner, dois servidores (membros e marketing) operados pelo workflow Infra (Hetzner) (17/10/2026, atualizado em 18/10/2026)](docs/20-runbook-hetzner.md)
- [Retomada da migracao para a Hetzner (estado em 19/10/2026)](docs/21-retomada-migracao-hetzner.md)
- [Comunicacao v1: notificacoes no sino e pop-ups (20/10/2026)](docs/22-comunicacao-notificacoes-e-pop-ups.md)
- [Comunicacao v2: quem envia, tempo no sino, notificacoes seguintes e fluxos (21/10/2026)](docs/23-comunicacao-v2-fluxos.md)
- [Comunicacao v3a: sino e avisos (CRUD, lixeira, cartao clicavel, reacoes, enquete e velocidade) (22/10/2026)](docs/24-comunicacao-v3a-sino-e-avisos.md)
- [Comunicacao v3b-1: pop-ups com paginas, momentos, frequencia e como fechar (22/10/2026)](docs/25-comunicacao-v3b1-pop-ups.md)
- [Comunicacao: design do pop-up com video, degrade, blocos, fontes e botoes (22/10/2026)](docs/26-comunicacao-design-do-pop-up.md)
- [Comunicacao: design Livre do pop-up, editor no estilo do Elementor (23/10/2026)](docs/27-comunicacao-design-livre.md)

## Padroes de trabalho

Este projeto usa um unico repositorio privado para a area de membros e o CMS.

- branch principal: `main`;
- commits: Conventional Commits, como `feat: adicionar pagina de aula` ou `fix: corrigir card bloqueado`;
- verificacao local: `npm run verify`;
- pull requests: usar o template em `.github/pull_request_template.md`;
- segredos: nunca commitar `.env`, chaves de servico, tokens ou payloads sensiveis;
- infra: os servidores da Hetzner (`bunker707-membros` e `bunker707-marketing`) sao operados pelo workflow `Infra (Hetzner)` (`.github/workflows/infra.yml`, disparo manual de uma etapa por vez, scripts em `infra/cloud/`), com `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` nos segredos do repositorio; chaves externas chegam ao servidor so por envelope cifrado, nunca nos inputs. Passo a passo em docs/20.

Veja [CONTRIBUTING.md](CONTRIBUTING.md) para o fluxo completo.

## Decisoes iniciais

- A venda sera terceirizada; a plataforma controla somente acesso, conteudo e experiencia do aluno.
- O core do backend deve ser orientado por acesso e eventos, nao por ecommerce.
- A stack do MVP usa Next.js, TypeScript, Supabase Postgres/RLS, Supabase Auth, Mux/Bunny Stream, PostHog, Sentry e Trigger.dev/Inngest.
- O app pode comecar na Vercel e ser migrado para Hetzner depois se o projeto for construindo com Docker, variaveis de ambiente limpas e pouca dependencia especifica da Vercel. Em 18/10/2026 a migracao foi decidida: dois servidores proprios na Hetzner, banco junto com o app e Mautic separado (docs/19, secao 0).

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
- login real com Supabase Auth, proxy de sessao (`src/proxy.ts`) e callback OAuth;
- paginas autenticadas protegidas por sessao;
- CMS/admin em `/admin` protegido por papel em `admin_roles`;
- hero de conteudo configuravel por backend persistido;
- cards internos de cursos e modulos;
- pagina da aula com player, playlist, materiais, progresso e comentarios/respostas/reacoes/denuncias persistidos no backend;
- Modo TV proprio para aulas do YouTube, com pareamento temporario por codigo ou QR, controle remoto no celular e progresso da reproducao persistido no Supabase;
- Tutor IA funcional na pagina da aula, com respostas baseadas no conteudo da aula, timestamps clicaveis, historico persistente, varios chats independentes por aluno/aula, exclusao logica e cache privado em memoria que preserva o estado entre abas sem armazenar conversas no cache HTTP;
- transcricoes versionadas no Supabase, importadas da legenda publica do YouTube ou enviadas pelo produtor em SRT, VTT, TXT ou texto colado quando o video nao possui legenda;
- Bunker AI LB server-side para Gemini, OpenAI/GPT e Anthropic/Claude, com varias conexoes por API ou conta, prioridade, round-robin, saude, cooldown e fallback; chaves de API ficam criptografadas no Supabase Vault e logins por conta passam por um gateway isolado;
- consumo de IA auditavel por tipo de agente, tutor/aula, aluno, provedor, modelo e conexao, incluindo ranking administrativo dos alunos que mais usam IA;
- IA Diretor (`platform_guide`) em chat flutuante global, com busca somente no catalogo autorizado do aluno, recomendacao de caminhos e trilhas, referencias internas validadas, historico persistente, varios chats, renomeacao e exclusao logica, sem compartilhar contexto com o Tutor IA (`lesson_tutor`);
- favoritos/minha lista persistidos por aluno para produtos, conteudos e aulas;
- pagina `Favoritos` em `/favoritos`, acessivel pela sidebar, reunindo tudo que o aluno salvou;
- CMS/admin em `/admin`, com dashboard, catalogo, estrutura de conteudo, personalizacao, CRM de alunos e turmas; regras de liberacao sao configuradas dentro de formacoes, cursos, modulos e aulas;
- CRM com navegacao expandida para Produtos, Combos, Comunidade, Moderacao, Agentes de IA e Configuracoes > Integracoes;
- CRUD persistido de combos de produtos, usando `Turma A` como padrao quando nenhuma turma foi criada;
- moderacao persistida de comentarios e palavras bloqueadas no CRM, com fila por status/denuncia e auditoria das acoes;
- sino de notificacoes no topo da area do aluno (desde 20/10/2026): avisos da escola com imagem, audio que toca no proprio sino, botao para uma pagina da area ou link externo e resposta `Aceitar`/`Recusar`, mais as respostas e mencoes nos comentarios; pop-ups so na home (1 por sessao e 1 a cada 24 h, `Lembrar depois` e `Não mostrar de novo`); no admin, Comunicacao > Avisos e pop-ups cria, agenda e mede cada aviso para segmentos montados por regras E/OU, com aprovacao acima de 500 alunos e envio agendado pelo tick de minuto (docs/22);
- area de Personalizacao no CRM com lista inicial de vitrine, login, pagina de produtos e produtos/cursos; cada item abre um editor proprio com representacao fiel da pagina final e opcoes laterais de edicao;
- separacao visual e de navegacao entre area de membros (`/`) e CRM/backoffice (`/admin`), com logos levando para a home correta e atalhos entre as duas experiencias para usuarios admin;
- fluxo inicial de criacao no CMS para formacoes, cursos, mentorias, webinarios, produtos e bootcamps, com capa, acesso gratuito/fechado, limite de estudantes, link externo de compra e regras de entrega por data ou por dias apos inscricao;
- assistente nativo de criacao de cursos pelo YouTube, com preview, organizacao automatica pela nomenclatura `C01 - Curso | M01 - Modulo | A01 - Aula` ou divisao manual por intervalos de videos, capa opcional, card unico ou cards de modulos e gravacao idempotente sempre em rascunho;
- construtor em passos dentro do Catalogo para salvar a configuracao inicial e, no mesmo local, cadastrar, editar, reordenar e excluir modulos e aulas;
- feedback de carregamento e persistencia no CRM, com estado local nos controles acionados, status global acessivel e confirmacao explicita de sucesso ou erro;
- opcao no CMS para exibir na home uma secao com capa pequena do curso e cards menores dos modulos de um curso especifico, util para produtores com catalogo curto;
- upload local da capa vertical do card em 720 x 1040 px e hero opcional da pagina propria em 1920 x 720 px;
- cards de curso sem capa usam uma superficie neutra apenas com o nome, sem imagem generica automatica;
- modo de preview na area de membros para navegar como sessao atual, produtor/admin, aluno com acesso ou aluno sem acesso, visivel somente para usuarios internos com papel em `admin_roles`;
- Supabase Postgres/RLS como unica persistencia de runtime para catalogo, alunos, acessos, favoritos, progresso, comentarios, moderacao e configuracoes;
- leituras da area do aluno isoladas por usuario e memoizadas por request, sem carregar dados administrativos ou de outros alunos;
- gravacoes granulares no Supabase para conteudo, modulos, aulas, favoritos e progresso, sem regravar a base inteira;
- imagens de conteudo no Supabase Storage, com limite de 8 MB, formatos JPG/PNG/WebP e cache imutavel, sem Base64 dentro das linhas do banco ou do HTML;
- autorizacao centralizada de aulas, incluindo pertencimento ao conteudo, publicacao, regra de liberacao e entitlement da formacao principal;
- relacao explicita entre curso interno e formacao principal por `content_page_settings.parentFormationId` enquanto a tabela relacional definitiva nao e materializada;
- a base real nao recebe seed/demo automaticamente; cursos, formacoes, modulos, turmas, alunos, aulas, progresso, comentarios, transcricoes e conversas do tutor entram por cadastros persistidos, APIs server-side, webhooks ou migrations controladas.

Sem variaveis Supabase ou sem migrations aplicadas, o app deve falhar explicitamente em vez de usar dados simulados, sinteticos, seed ou fallback local.

Ao preparar um novo ambiente, todas as migrations versionadas em `supabase/migrations` precisam ser aplicadas na ordem antes de liberar o runtime. Elas materializam as garantias relacionais, o Tutor IA, a IA Diretor, a exclusao logica dos chats, as sessoes protegidas do Modo TV e o pool auditavel de conexoes de IA. A evolucao natural e concluir adapters idempotentes de webhooks, observabilidade e testes E2E automatizados.

## Skill Codex

Foi criado o skill pessoal `bunker707-members-area` em:

`/Users/danilosouza/.codex/skills/bunker707-members-area`

Use esse skill em futuras conversas sobre produto, UX, arquitetura ou implementacao da area de membros Bunker707.
