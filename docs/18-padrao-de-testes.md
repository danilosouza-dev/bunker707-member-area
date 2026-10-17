# 18. Padrão de testes e rotina de qualidade

Data: 16/10/2026. Etapa 1 (diagnóstico e padrão) aprovada pelo produtor em 16/10, com ok nas seis decisões da seção 6. Etapa 2 (base da rotina) feita nas PRs 2a (banco de teste local e primeiro teste de integração), 2b (Playwright e primeiro fluxo no navegador) e 2c (rotina escrita: template de PR, CONTRIBUTING, docs/13, `verify:full`). Etapa 3 (cobertura por prioridade) em andamento: PRs 3a (progresso da aula), 3b (acesso à aula), 3c (o que o aluno vê), 3d (comentários), 3e (perfil e foto) e 3f (biblioteca: favoritos, compras, jornada, materiais, suporte) feitas. Admin: PRs 3g (equipe e permissões), 3h (produtos), 3i (alunos) e 3j (área de membros) feitas. Conversão dos testes de texto concluída: 3k (player e home), 3l (Modo TV), 3m (Tutor IA e IA Diretor, com provedor falso) e 3n (comentários, menu, IA Diretor na tela e navegação). Documento vivo: cada PR da etapa 3 atualiza as seções 2.4, 3 e 4.

Este documento existe por causa de um erro simples que escapou: a mesma aula aparecia como **Concluída** quando o aluno entrava pelo módulo do curso e como **Concluir** quando entrava pelo card "Continue assistindo" da home. Nenhum dos 789 testes do repositório pegou isso, porque nenhum deles abre a tela ou grava no banco de verdade. A partir daqui, toda funcionalidade nova ou correção vem com um teste que prova o comportamento, e a rotina (template de PR, CI e documentação) cobra isso.

Linguagem: o texto evita jargão. Os poucos termos técnicos necessários estão explicados no glossário da seção 8.

---

## Resumo em uma página

**O que temos hoje.** 789 testes em 76 arquivos, rodando com `node --test` em cerca de 2 segundos. Cerca de dois terços chamam a função de verdade e conferem o resultado (bom). Cerca de um quarto só abre o arquivo do código e procura um trecho de texto, o que não prova que a tela funciona. Nenhum teste fala com um banco de dados real e nenhum abre o navegador. O CI roda `npm run verify` (lint, tipos, testes, build) em cerca de 2 minutos e meio. O GitHub **não bloqueia** merge com CI vermelho: o plano gratuito não permite proteção de branch em repositório privado (confirmado em 16/10: a API responde "Upgrade to GitHub Pro").

**O que vamos fazer.** Três tipos de teste, cada um com lugar e comando próprios:

| Tipo | O que prova | Onde fica | Comando |
|---|---|---|---|
| Unitário | uma regra, modelo ou ação do servidor, com dublês no lugar do banco | `tests/*.test.mjs` (como hoje) | `npm test` |
| Integração | funções do servidor e rotas `/api` contra um **banco Supabase local**, com sessão simulada | `tests/integration/*.test.mjs` | `npm run test:integration` |
| Ponta a ponta | o fluxo inteiro no navegador (Playwright), app rodando contra o banco local | `tests/e2e/*.spec.ts` | `npm run test:e2e` |

`npm run verify` continua sendo o portão local (não muda). O CI ganha um segundo job que sobe o banco local, roda integração e ponta a ponta em toda PR para `dev` e `main`. Dados de teste: uma escola fictícia criada do zero a cada execução no Supabase local (Docker), nunca o projeto compartilhado de dev/produção. Uma trava impede rodar contra qualquer endereço que não seja `localhost`.

**A rotina.** Toda PR de funcionalidade ou correção traz teste de comportamento do que mudou (correção traz um teste que falhava antes e passa depois). Sem teste, só com justificativa escrita na PR e pendência registrada no mapa de cobertura. Checklist no template de PR; regra em `CONTRIBUTING.md` e `docs/13`.

**O que precisa de decisão do produtor** (detalhe na seção 6): 1) Playwright como ferramenta de navegador; 2) Supabase local via Docker para integração e ponta a ponta; 3) assinar GitHub Pro (cerca de US$ 4/mês) para o GitHub bloquear merge sem CI verde, ou seguir só com a regra operacional; 4) rodar ponta a ponta em toda PR (recomendado) ou só na promoção para `main`; 5) manter `node --test` para unitário e integração (sem trocar de ferramenta); 6) ordem da etapa 3 (progresso da aula primeiro).

---

## 1. Diagnóstico do que existe hoje

### 1.1 Números

Contagem feita por script em 16/10/2026 sobre `tests/*.test.mjs` (margem de erro de uns 5%, porque a classificação é automática):

| Medida | Valor |
|---|---|
| Arquivos de teste | 76 |
| Testes (`test(...)`) | 789 |
| Testes de comportamento (chamam a função de verdade e conferem o resultado) | cerca de 530 (67%) |
| Testes mistos (um pouco de cada) | 64 (8%) |
| Testes que só conferem texto do código-fonte | cerca de 200 (25%) |
| Afirmações (`assert`) no total | 5.934 |
| Afirmações que conferem texto do código | cerca de 1.900 (um terço) |
| Arquivos que não importam nada do código, só leem arquivos como texto | 16 |
| Testes contra banco de dados real | 0 |
| Testes no navegador | 0 |
| Tempo do `npm test` | cerca de 2 s (789 testes, 16/10) |
| Tempo do job Verify no CI (16/10, branch `dev`) | 2 min 16 s |
| Hook de pre-commit (husky) | lint, typecheck e `npm test` |

Como classificamos: "comportamento" é o teste que importa a função de `src/` (às vezes com um banco falso em memória, como `tests/support/admin-action-stubs.mjs`) e confere o que ela devolve. "Texto" é o teste que abre o `.tsx`, `.ts` ou `.sql` como string e procura um trecho com expressão regular (`assert.match(source, /.../)`).

A auditoria de 01/10 (docs/16) apontava 91% de afirmações por texto em 210 testes. De lá para cá entraram cerca de 580 testes novos, a maioria de comportamento (admin v2: catálogo, alunos, equipe, comunidade). A proporção melhorou muito, mas o problema ficou concentrado justamente na **área do aluno**: home, página da aula, player, Modo TV, Tutor, comentários e menu.

### 1.2 Por que teste de texto não prova nada

Um teste que confere `assert.match(source, /isActiveLessonCompleted \? "Concluída" : "Concluir"/)` prova que **essa linha existe** no arquivo. Não prova que o botão mostra o texto certo para o aluno certo, nem que o estado vem do mesmo lugar nas duas telas. Ele tem dois defeitos que se somam:

- **passa com o bug**: o erro do "Concluída/Concluir" convive com todos os 789 testes verdes;
- **quebra sem bug**: qualquer reorganização inofensiva do código (mudar o nome de uma variável, extrair um componente) faz o teste falhar e obriga a editar o teste junto, o que acostuma todo mundo a "ajustar o teste até passar".

Há um uso legítimo e pequeno para conferência de texto: **testes de guarda** de regras de arquitetura, por exemplo "nenhum componente do aluno importa o cliente com chave de serviço", "toda migração liga RLS", "nenhum número de fallback no admin". Esses continuam, com nome que diga o que são (`*.guard.test.mjs`), e nunca como único teste de um comportamento.

### 1.3 Onde o texto domina

Arquivos em que a maioria dos testes é conferência de texto, com o destino proposto na etapa 3:

| Arquivo | Texto / total | O que vira |
|---|---|---|
| `home-card-hover-layout` | 24 / 26 | **convertido na PR 3k**: a conta de qual card está na borda do carrossel virou `home-row-hover-layout.test.mjs` (unitário, chamando a função); fileiras, cards, favoritos e modal já tinham teste de integração e no navegador; o resto era CSS de hover e saiu |
| `lesson-player-layout` | 22 / 24 | **convertido na PR 3k**: duas regras de produto viraram `lesson-player.guard.test.mjs` (controles do YouTube só da Bunker707; qualidade automática como padrão); reações da aula, o `POST` do `sendBeacon`, as abas e o atalho de materiais ganharam teste de comportamento; o resto era layout e saiu. O que depende do vídeo tocando (heartbeat, qualidade manual) fica pendente |
| `lesson-tv-mode` | 20 / 21 | **convertido na PR 3l**: contrato da TV e legenda viraram unitários (`tv-session-contract`, `media-captions`); 3 guardas em `lesson-tv-mode.guard` (credenciais só no servidor, mensagens sem o provedor, `/tv` fora dos buscadores); rotas `/api/tv` com banco em `tests/integration/modo-tv.test.mjs`; pareamento no navegador em `aluno-assiste-na-tv`. O que depende do vídeo tocando (comando aplicado no player, velocidade confirmada, legenda e qualidade na TV) fica pendente |
| `ai-provider-pool` | 11 / 11 | unitário do pool de provedores com provedor falso |
| `lesson-ai-tutor` | 8 / 15 | **convertido na PR 3m**: as citações e o salto no vídeo (já eram comportamento) foram para `tutor-citations` e `tutor-seek-intent`; 4 guardas em `ai-tutor.guard` (tabelas da IA fechadas e chave no cofre; só os endereços fixos dos provedores; instruções que prendem o modelo ao material; progresso só do servidor); rotas do Tutor com banco e provedor falso em `tests/integration/tutor-ia.test.mjs`. O que era texto da tela (SWR, abas, menu) saiu |
| `architecture-hardening` | 7 / 7 | guarda (mantém, renomeia para `.guard`) |
| `deployment-security` | 6 / 9 | guarda (CSP, config do Supabase) |
| `member-sidebar` | 6 / 12 | **convertido na PR 3n**: as 6 regras puras (grupos e itens, item ativo, menu da conta, saudação e histórico da IA Diretor) ficaram em `member-shell-model`; gaveta, menu da conta e cabeçalho viraram `aluno-menu-e-ia-diretor` no navegador |
| `platform-director-chat` | 6 / 6 | **convertido na PR 3n**: abrir o painel, saudação pelo nome, motivo quando não há provedor e fechar, no navegador (`aluno-menu-e-ia-diretor`); enviar mensagem na tela depende de um gateway falso (pendente); o resto era detalhe de tela e saiu |
| `platform-guide` | 6 / 8 | **convertido na PR 3m**: as referências (já eram comportamento) foram para `platform-guide-references`; rotas da IA Diretor com banco e provedor falso em `tests/integration/ia-diretor.test.mjs`; as regras de migração viraram guarda |
| `lesson-comments` | 5 / 8 | **convertido na PR 3n**: as 3 regras puras ficaram em `comment-validation`; a etiqueta de função (Professor/Moderador) já era integração (`comentarios-aula`); a migração virou 1 guarda; Cancelar resposta e o atalho Ctrl/Cmd + Enter entraram em `aluno-comenta-na-aula` |
| `lesson-tutor-layout` | 5 / 5 | ponta a ponta do painel do Tutor |
| `lesson-materials-api` | 4 / 7 | integração da rota de materiais |
| `jobs-tick`, `lesson-release-date` | 4 / 12 cada | já têm comportamento; a parte de texto vira guarda ou sai |
| `navigation-feedback` | 4 / 4 | ponta a ponta (barra de carregamento ao navegar) |
| `ai-admin-reliability`, `internal-poster-row`, `home-section-editor` | 3 / 3 | unitário ou ponta a ponta conforme o caso |
| `lesson-description` | 2 / 2 | ponta a ponta da aula (mesmo arquivo) |
| `locked-card-badge`, `internal-trigger-security`, `member-row-sizing`, `course-progress`, `auth-session` | 1–2 | guarda ou integração |

### 1.4 Onde já está bem

O admin v2 nasceu com um padrão bom que vale copiar: modelos puros (`*-model.ts`, `mappers.ts`, `schemas.ts`) testados direto, e Server Actions carregadas no Node com sessão e banco trocados por dublês (`tests/support/admin-action-stubs.mjs`, com `createFakeDb`). Exemplos: `catalog-server` (30 testes), `admin-content-tree` (22), `community-queue` (23), `admin-catalog-actions` (14). Isso continua sendo o **unitário** do padrão.

### 1.5 Buracos sem nenhum teste de comportamento

Estes são os pontos em que hoje só existe texto ou nada, e por onde a etapa 3 começa:

1. **Progresso da aula**: `PUT/POST /api/progress/lessons`, `replaceCompletedLessons` em `platform-store.ts` e a leitura desse estado nas três telas (módulo, "Continue assistindo", "Minha jornada"). É onde mora o bug que motivou este documento.
2. **Regra de acesso à aula com banco**: `requireLessonAccess` / `requireLessonsAccess` (com e sem acesso, acesso expirado, liberação por data, conteúdo bloqueado, pessoa da equipe). Só as regras de data têm unitário.
3. **O que o aluno vê**: `getHomePageData`, `getContentPageData`, `getLessonPageData`, `getMemberLibrary` (filtram pelo acesso do aluno; nenhum teste com banco).
4. **Entrar e rota protegida**: login com senha de verdade, redirecionamento de página protegida para `/login` e volta, destino pós-login (equipe vai para `/admin`).
5. **Comentários**: `comment-store.ts` (listar, criar, reagir, denunciar) e as rotas `/api/comments`.
6. **Favoritos**: rota `/api/saved-items`.
7. **Foto de perfil**: `PUT/DELETE /api/profile/avatar` com Storage (o bug do iPhone/iPad do #55 só é pego com WebKit no navegador).
8. **Alunos no admin**: `src/server/students/access.ts` (criar conta, liberar, estender, revogar, importar), que também vai atender os webhooks de venda.
9. **Equipe**: ações de convidar, trocar função, não remover a última pessoa dona, função protegida.
10. **Gravação com versão em `platform_settings`** (`writePlatformSettingGuarded`, 409 quando outra tela gravou antes): invariante do docs/13 sem teste com banco.
11. **Escritas atômicas do catálogo** (RPCs `202610110012`, `stale_structure` → 409): unitário com dublê existe; com banco, não.

### 1.6 Processo

- CI: um job `Verify` em push e PR para `dev` e `main`, rodando `npm run verify`. Nada de banco nem navegador.
- Proteção de branch: indisponível no plano atual (GitHub Free, repositório privado). Hoje a regra "só entra com CI verde e ok no chat" é operacional.
- Template de PR: a única linha de verificação é `npm run verify`. Não pergunta se há teste do comportamento.
- `docs/13` já pede "teste de regressão que prove a invariante" para acesso, persistência e navegação, mas não diz de que tipo nem como. Na prática virou teste de texto.
- Não existe `supabase/seed.sql` nem qualquer dado de teste; dev e produção usam o mesmo projeto Supabase (`hrtnqcznhdmodjikvddm`).

---

## 2. O padrão

### 2.1 Os três tipos de teste

| | Unitário | Integração | Ponta a ponta |
|---|---|---|---|
| **Pergunta que responde** | "Esta regra calcula certo?" | "Gravar e ler no banco dá o resultado certo, com as permissões certas?" | "O aluno (ou o produtor) consegue fazer isso na tela?" |
| **O que usa** | só Node; banco e sessão são dublês | Supabase local (Postgres, Auth, Storage reais, em Docker); sessão simulada | navegador real (Chromium e WebKit) + app rodando + Supabase local; login de verdade |
| **Onde fica** | `tests/*.test.mjs` (e `tests/*.guard.test.mjs` para guardas) | `tests/integration/*.test.mjs` | `tests/e2e/*.spec.ts` |
| **Ferramenta** | `node --test` (como hoje) | `node --test` | Playwright |
| **Velocidade** | milissegundos cada | segundos cada | 5 a 30 s cada |
| **Quantos** | muitos | alguns por área | poucos: só os fluxos principais e as regressões |
| **Comando** | `npm test` | `npm run test:integration` | `npm run test:e2e` |
| **Roda no pre-commit?** | sim | não | não |
| **Roda no CI?** | sim (job Verify) | sim (job E2E) | sim (job E2E) |

### 2.2 Qual tipo usar (regra de bolso)

1. Dá para chamar como função, sem banco? **Unitário.** Regras de liberação, cálculo de progresso, validação de comentário, mapeadores, schemas, modelos de tela, Server Actions com dublês.
2. Lê ou grava no banco, depende de RLS, RPC, trigger ou Storage? **Integração.** `platform-store`, `lesson-access`, `students/access`, `team/actions`, `comment-store`, `settings-store`, rotas `/api` chamadas como função.
3. O aluno ou o produtor vê e clica? **Ponta a ponta**, e só o caminho principal mais a regressão que motivou o bug. Variações e detalhes ficam no unitário ou na integração.
4. Nunca teste de texto como único teste de um comportamento. Conferir texto só para regra de arquitetura, em arquivo `.guard.test.mjs`.
5. Na dúvida entre integração e ponta a ponta: se o bug seria visível para o aluno numa tela, ponta a ponta; se é regra do servidor, integração.

Uma correção (`fix`) sempre traz um teste que **falhava antes** da correção e passa depois. Quem revisa pergunta: "se o bug voltar, este teste fica vermelho?"

### 2.3 Onde fica e como nomear

```txt
tests/
  *.test.mjs                 unitários (os 76 de hoje ficam onde estão)
  *.guard.test.mjs           guardas de arquitetura (conferência de texto, poucas)
  integration/
    *.test.mjs               contra o Supabase local
  e2e/
    *.spec.ts                Playwright
    auth.setup.ts            faz login uma vez por persona e guarda a sessão
  fixtures/
    escola-de-teste.sql      dados da escola fictícia (produtos, módulos, aulas, acessos)
    contas.ts                e-mails das contas de teste (domínio reservado .test)
  support/
    *.mjs                    ajudantes: dublês, carregador de TS, cliente do banco local
playwright.config.ts
```

Os arquivos atuais não são movidos agora: mover 76 arquivos geraria conflito com as PRs em andamento. Novos unitários continuam na raiz de `tests/`.

Nomes de arquivo: pelo comportamento ou tela, em português, com hífen. Ponta a ponta começa pela persona: `aluno-` ou `produtor-`.

```txt
tests/integration/progresso-aula.test.mjs
tests/integration/acesso-aula.test.mjs
tests/e2e/aluno-entra-e-abre-aula.spec.ts
tests/e2e/aluno-conclui-aula.spec.ts
tests/e2e/produtor-cria-produto.spec.ts
```

Título de cada teste: uma frase que diga o comportamento, para que a lista de falhas do CI se leia sozinha:

```txt
"aula concluída pelo módulo aparece concluída no card Continue assistindo"
"aluno sem acesso recebe 403 ao gravar progresso"
"analista recebe 403 em qualquer escrita do catálogo"
```

### 2.4 Como rodar

Local:

```bash
npm test                    # unitários, sem nada instalado além do npm ci
npm run db:start            # sobe o Supabase local (Docker), aplica migrações, escreve .env.test.local e cria a escola de teste
npm run test:integration    # precisa do db:start
npm run db:seed             # só recria a escola de teste (sem mexer no banco)
npm run db:reset            # recria o banco local do zero (migrações + escola de teste)
npm run db:stop
npm run test:e2e            # precisa do db:start; o Playwright builda e sobe o app sozinho na porta 3100
npm run test:e2e -- --ui    # modo visual para investigar
E2E_SKIP_BUILD=1 npm run test:e2e   # reaproveita o build anterior se ele foi feito para o Supabase local (iterar localmente)
npm run verify              # portão local: lint, typecheck, unitários, build (inalterado)
npm run verify:full         # verify + integração + ponta a ponta (o que o CI faz; precisa do db:start)
```

Primeira vez: `npm run db:start` baixa o CLI do Supabase (via `npx`) e as imagens do Docker, o que leva alguns minutos; depois, uns 20 segundos. O Docker Desktop precisa estar aberto. O que `db:start` faz está em `tests/support/db.mjs`. Para os testes de ponta a ponta, uma vez por máquina: `npx playwright install chromium webkit` (baixa os dois navegadores). O `npm run test:e2e` builda o app (`next build`, 1 a 2 minutos) e o sobe na porta 3100 com as variáveis de `.env.test.local` (`tests/support/e2e-server.mjs`); com o app já no ar nessa porta, ele reaproveita. Atenção: esse build fica em `.next`, o mesmo lugar de `npm run build` e do `npm run verify`, e as variáveis `NEXT_PUBLIC_*` entram no JavaScript do navegador na hora do build. Por isso o servidor de teste grava um marcador (`.next/e2e-build.json`) e `E2E_SKIP_BUILD=1` só reaproveita o build se ele foi feito para o Supabase local; depois de um `npm run verify`, ele rebuilda sozinho. Se for subir uma prévia de produção local (`next start`) depois de rodar o e2e, rode `npm run build` antes.

CI (`.github/workflows/ci.yml`), em toda PR e push para `dev` e `main`:

- job **Verify** (como hoje): `npm run verify`, cerca de 2,5 min;
- job **Integração e ponta a ponta (Supabase local)** (desde as PRs 2a e 2b, em paralelo com o Verify): instala o CLI do Supabase, sobe Postgres, Auth e Storage em Docker sem os serviços que os testes não usam (`db.mjs start --ci`), aplica as migrações do zero, cria a escola de teste, roda `npm run test:integration`, instala Chromium e WebKit e roda `npm run test:e2e` (que builda e sobe o app). Em falha, traços, capturas de tela e vídeos ficam como artefato "playwright" por 7 dias. Meta do job: menos de 8 min.

Os dois precisam estar verdes para a PR entrar. Como o GitHub não bloqueia (seção 6, decisão 3), a regra fica no `CONTRIBUTING.md` e no template até a conta permitir proteção de branch.

Pre-commit (husky) não muda: lint, typecheck e unitários. Integração e ponta a ponta ficam para o CI e para quem quiser rodar antes.

### 2.5 Dados e sessão de teste sem tocar em dados reais

**Problema.** Dev e produção usam o mesmo projeto Supabase. Nenhum teste automatizado pode escrever nele. Também não podem entrar nos testes dados reais de alunos.

**Caminhos avaliados.**

| Caminho | Como seria | Prós | Contras | Veredito |
|---|---|---|---|---|
| **Supabase local via CLI** | `npx supabase start` sobe Postgres, Auth, Storage e caixa de e-mail local em Docker; `supabase db reset` aplica as 37 migrações de `supabase/migrations` e os dados de teste | isolado de verdade; grátis; roda igual no Mac e no CI; de quebra prova que as migrações sobem do zero (hoje ninguém prova); e-mails de convite podem ser lidos na caixa local | precisa do Docker Desktop ligado no Mac (está instalado, mas desligado); primeira subida leva 1–2 min; versões das extensões (`pg_cron`, `pg_net`, `vault`) precisam bater com a nuvem | **Recomendado** para integração e ponta a ponta, local e CI |
| Projeto Supabase separado na nuvem | um segundo projeto gratuito só para testes | não precisa de Docker | um banco só para todas as PRs ao mesmo tempo (testes se atropelam); acumula lixo; lento; mais um lugar para cuidar; o plano gratuito limita projetos e pausa os inativos | não para testes automáticos; faz sentido depois como **ambiente de dev separado da produção**, que é outra pendência |
| Contas e escola de teste dentro do projeto compartilhado | criar "Aluno Teste" e "Curso Teste" no banco de produção | nenhuma instalação | escreve no banco dos alunos reais; risco de aparecer para aluno de verdade ou de apagar algo errado; e-mails reais disparados; nunca dá para resetar | **descartado** |
| Supabase Branching | um banco por PR, criado pela própria Supabase | ideal em teoria | exige plano Pro da Supabase e integração com o GitHub | revisitar quando houver plano pago |

**Escola de teste.** `tests/fixtures/escola-de-teste.mjs` cria, pelo cliente do Supabase (não por SQL solto, para passar pelas mesmas tabelas e gatilhos do app), uma escola fictícia pequena e previsível. Hoje: o curso comprado ("Curso de Teste: Agentes de IA", 2 módulos, 3 aulas com vídeo do YouTube de exemplo), o curso de liberação (também comprado: 1 aula liberada, 1 com data em 2099 e 1 em rascunho), 1 curso à venda que ninguém comprou (aparece bloqueado) e 6 contas criadas no Auth local com senha de teste: aluna com acesso, aluna com acesso expirado ontem, aluno sem acesso, produtor (dono), analista (só leitura) e professor com alcance só no curso de agentes. E-mails em domínio reservado (`@bunker707.test`), que nunca entrega nada. Nenhum dado vem de pessoa real. Cada PR da etapa 3 acrescenta o que precisar. Os testes apagam o que escreveram antes de começar (`limparProgresso`, `limparComentarios`, `limparFotoDoPerfil`). Os arquivos de integração rodam **um de cada vez** (`--test-concurrency=1` no `npm run test:integration`): todos usam o mesmo banco e as mesmas contas, e em paralelo um apaga o progresso enquanto o outro lê. Datas do seed ficam ao meio-dia UTC: o app mostra datas no fuso de São Paulo, e meia-noite UTC vira o dia anterior. A função é idempotente: rodar de novo deixa tudo igual, e `limparProgresso` zera progresso, favoritos e atividade das contas antes de cada arquivo de teste.

**Sessão.**

- Unitário: como hoje, `requireRole`/`getAuthenticatedUser` trocados por dublês pelo hook de `tests/support/admin-action-stubs.mjs`.
- Integração: `tests/support/integration-hooks.mjs` troca só a **sessão** (`src/server/auth/session.ts` vira `integration-session.mjs`; o teste diz quem está logado com `actAs(usuario)`, ou entra de verdade no Auth local com `actAsSignedIn(conta, senha)` quando o código grava "com a sessão do aluno" e a RLS precisa valer, como a foto do perfil) e os módulos que só existem dentro do Next (`server-only`, `next/navigation`, `next/cache` e `next/headers`: `revalidatePath` e companhia só existem dentro de um request e viram anotação em `integration-next-cache.mjs`; `headers()` e `cookies()` viram os de um request local em `integration-next-headers.mjs`). O cliente do banco, as regras de acesso e as gravações são as reais, contra o Supabase local. Rotas `/api` são chamadas como função com um `Request` montado no teste; as permissões da equipe continuam vindo de `admin_roles` no banco local. Limite do carregador: o Node só **tira** os tipos do TypeScript, não transforma código; por isso o código do servidor não pode usar `readonly`/`public` em parâmetro de construtor, `enum` nem `namespace` (o arquivo não carrega no teste). Declare o campo e atribua no construtor.
- Ponta a ponta: `tests/e2e/auth.setup.ts` garante a escola de teste, zera o progresso das contas de aluno e entra de verdade pela tela de entrar como a aluna; a sessão fica em `tests/e2e/.auth/` (ignorado pelo git) e os projetos `chromium` e `webkit` começam logados (`storageState`). Teste que precisa começar sem sessão declara `test.use({ storageState: { cookies: [], origins: [] } })`. Cada arquivo de teste começa com `test.beforeAll(zerarProgressoDosAlunos)` (em `fixtures.ts`), porque os arquivos dividem o banco local e a ordem não pode mudar o resultado. Esse helper só lê as contas: mexer numa conta no Auth (até trocar a senha pela mesma) derruba o login guardado. Bug que depende do roteador do navegador (cópias de página entre cliques, como o #58) só aparece navegando por cliques; `page.goto` recarrega e apaga essas cópias. Formulário controlado pelo React (tela de entrar, admin): no WebKit a hidratação chega depois do `goto`, e o que o teste digita cedo demais é apagado pelo estado inicial (apareceu como falha intermitente do login com a máquina carregada); espere `page.waitForLoadState("networkidle")` antes de preencher e confira o valor com `toHaveValue`. O navegador só fala com a máquina: `tests/e2e/fixtures.ts` corta qualquer pedido para fora (YouTube, PostHog, Sentry, CDNs); o espaço do player continua desenhado, só o vídeo não carrega.

**Travas de segurança.**

- `npm run db:start` escreve `.env.test.local` (ignorado pelo git) a partir de `supabase status`, e só se o endereço devolvido for local. Os testes de integração carregam esse arquivo (`node --env-file-if-exists=.env.test.local`), nunca `.env.local`. Variável já exportada no terminal tem prioridade sobre o arquivo, e por isso a segunda trava existe: `tests/support/local-db.mjs` **recusa rodar** antes de qualquer consulta se a URL não for `127.0.0.1`/`localhost`, com uma mensagem dizendo o que fazer.
- Nada de chave de produção em arquivo de teste. As chaves do Supabase local são as de demonstração do CLI, iguais em qualquer máquina, e não dão acesso a nada fora do computador.
- Serviços externos não são chamados: tudo o que não é `127.0.0.1`/`localhost` é cortado no navegador (`fixtures.ts`); o app de teste é buildado com todas as outras variáveis do `.env.example` vazias (PostHog, Sentry e gateway de IA desligados, mesmo que `.env.local` as tenha); e-mail do Auth fica na caixa local (Mailpit em `http://127.0.0.1:55324`) e o provedor de e-mail do app (Resend) vira o provedor falso de `tests/support/integration-email-provider.mjs` (`provedorDeEmailFalso`): a fila `email_outbox`, o limite diário e o job do tick seguem reais, e nenhum e-mail sai. Tutor IA com gateway falso entra na PR da etapa 3.
- O Storage local responde em `http://127.0.0.1:55321`, e o app só aceitava `https` para a foto do perfil (endereço gravado, foto no menu e `img-src` da CSP). Desde a PR 3e essas três regras aceitam `http` **só na própria máquina** (`src/lib/loopback-url.ts`: `127.0.0.1`, `localhost`, `[::1]`); qualquer outro `http` segue recusado.
- `supabase/config.toml` (só vale para o Supabase local) precisou de `[auth.email] enable_signup = true`: com `false`, o Auth local responde "Email logins are disabled" até para contas criadas pelo admin, e o login por senha não funciona. O cadastro público continua bloqueado por `[auth] enable_signup = false`. Esse arquivo não é enviado para a nuvem por nenhum comando da rotina.

### 2.6 Ferramenta de ponta a ponta: Playwright

Recomendação: **Playwright** (`@playwright/test`).

- Grátis e sem serviço pago embutido; roda no Mac e no GitHub Actions com uma ação oficial.
- Testa em **Chromium e WebKit** no mesmo comando. WebKit é o motor do Safari, do iPhone e do iPad, onde a foto de perfil quebrou (#55). Cypress só tem WebKit experimental.
- Sobe o app sozinho (`webServer`), guarda login por persona (`storageState`), e tem o `request` para chamar rotas `/api` com a sessão real quando o teste de integração não bastar.
- Em falha, gera traço navegável (cada passo com captura, rede e console), o que torna a investigação possível para quem não escreveu o teste.
- Já era a ferramenta prevista em docs/17 §2.9.

Alternativas: Cypress (mais pesado, WebKit experimental, painel pago), Testing Library com jsdom (testa componente isolado, não o fluxo; pode entrar depois para componentes do aluno se precisarmos, mas não resolve o problema de hoje).

### 2.7 A rotina (regra válida a partir da etapa 2)

1. Toda PR `feat` ou `fix` traz teste de comportamento do que mudou, no tipo certo pela regra de bolso (2.2).
2. `fix` traz um teste que falhava antes e passa depois. O título do teste cita o sintoma.
3. Mudou regra de acesso, progresso, gravação ou navegação: integração obrigatória (regra do docs/13, agora com forma definida).
4. Tela ou fluxo novo do aluno ou do produtor: um ponta a ponta do caminho principal.
5. PR sem teste só com "Sem teste porque ..." no corpo da PR e a pendência anotada no mapa (seção 3). Quem revisa decide se aceita.
6. Teste de texto novo só em `.guard.test.mjs`, só para regra de arquitetura.
7. Ao mexer em arquivo de teste de texto antigo, converte-se o que estiver ao alcance (regra do escoteiro: deixar o lugar melhor do que encontrou), além do plano da etapa 3.
8. Verify e E2E verdes antes de pedir merge. Teste intermitente (passa e falha sem mudança) não se "reroda até passar": abre-se correção ou o teste é marcado como pendente com motivo.
9. O mapa de cobertura (seção 3) é atualizado na PR que muda a situação de uma funcionalidade.

Checklist em `.github/pull_request_template.md` (desde a PR 2c):

```markdown
## Verificação

- [ ] `npm run verify` verde
- [ ] Job E2E do CI verde (integração + ponta a ponta)

## Testes

- [ ] Esta PR traz teste de comportamento do que mudou (unitário / integração / ponta a ponta)
- [ ] Se é correção: o teste falhava antes e passa agora
- [ ] Se mexe em acesso, progresso, gravação ou navegação: tem teste de integração
- [ ] Sem teste? Explique aqui por quê e atualize o mapa em docs/18:
```

---

## 3. Mapa de cobertura

Legenda da coluna "Hoje": **C** = teste de comportamento, **T** = só texto do código, **—** = nada. As colunas Unit / Integ / E2E dizem o que existe hoje em cada tipo. "Falta" é o que entra no plano. Prioridade: **A** alta (etapas 2 e 3, primeiro bloco), **M** média, **B** baixa.

### 3.1 Área do aluno

| Funcionalidade | O que faz hoje | Unit | Integ | E2E | Falta | Prior. |
|---|---|---|---|---|---|---|
| Entrar | senha, Google, esqueci a senha, volta para a página pedida (`?next=`), visual publicado pelo admin | C (destino seguro, erro do link, configuração da tela) + T (tela) | — | C (`aluno-entra-e-abre-aula`: entrar com senha e cair na home; rota protegida manda para `/login` e volta para ela; senha errada mostra o aviso) | equipe cai em `/admin` (integração ou ponta a ponta com o produtor, PR 3g); Google e esqueci a senha ficam de fora (dependem de serviço externo) | A |
| Home | hero/destaque, fileiras por acesso, "Continue assistindo", cards verticais, card bloqueado, modal de detalhes | C (destaque, vitrine, indisponíveis) + T (fileiras, cards, modal: 24 testes) | C (`o-que-o-aluno-ve`: Minhas compras só com o que tem acesso, Produtos a venda só com o que falta comprar e bloqueado, acesso expirado volta para a venda, aluno sem compra; fileira Continue assistindo em `progresso-aula`) | C (`aluno-ve-so-o-que-tem-acesso`: card bloqueado abre o modal de compra sem sair da home; aluno sem compra não vê Minhas compras nem Continue assistindo) | hero/destaque publicado pelo admin aparecendo na home; fileira de módulos de um curso; favoritar pelo card | A |
| Continue assistindo (fileira e página) | aulas começadas e não terminadas, da mais recente | C (modelo da página) | — | — | mesma regra nos dois lugares com banco; **regressão: concluída no módulo = concluída no card** | A |
| Curso, formação e módulos | página do produto, módulos, liberação por data, conteúdo bloqueado redireciona | C (regras de data; módulos/vitrine do lado do admin) | C (`acesso-aula`: regra central de acesso com banco; `o-que-o-aluno-ve`: página do curso comprado sem vídeo, curso a venda abre bloqueado como página de compra, aula futura com data e rascunho de fora, biblioteca só com acesso real e vazia para quem não comprou ou expirou) | C (abrir curso → módulo → aula; página do curso a venda com módulo "Acesso pendente" que não leva à aula; endereço de aula sem acesso volta para a home; aula futura com a data na playlist) | formação com cursos internos (acesso herdado); produto "oculto por enquanto" sem acesso respondendo como inexistente | A |
| Aula com player | YouTube oficial em Full HD, legendas, playlist, descrição, atalhos | C (medidas do embed, detecção de vídeo, legendas, faixas) (o layout por texto saiu na 3k; ficaram 2 guardas do player) | C (estados iniciais em `progresso-aula`) | C (`aluno-entra-e-abre-aula`: home → curso → módulo → aula com título, player, playlist e botão Concluir, em Chromium e WebKit) | trocar de aula pela playlist; legendas e qualidade no navegador | A |
| Concluir aula e progresso | botão Concluir/Concluída/Desmarcar, % no card, barra do módulo, Minha jornada | T (rota e componente) + C (1 cálculo de %) | C (`progresso-aula`: PUT grava, 401/400/403/404; página da aula, fileira Continue assistindo, Minha jornada e página Continue assistindo leem o mesmo estado ao concluir e ao desmarcar) | C (`aluno-conclui-e-desmarca-aula`: concluir e desmarcar pelo botão da aula; % no card do curso na home; mesmo estado entrando pelo card do módulo e pelo card Continue assistindo; regressão do #58, a cópia antiga da página pelo card do módulo) | fim do vídeo concluindo sozinho (precisa de player local); reversão visual do botão quando a gravação falha (#61) | A |
| Comentários | publicar, responder, reagir, denunciar, papel (Professor/Moderador), foto | C (validação e moderação de texto) + T (store, rotas, tela) | C (`comentarios-aula`: rotas com banco: 401/403/400, publicar como Aluno com o nome do perfil, duplicado 409, limites 400, resposta do professor aninhada como Professor, analista como Moderador, resposta de resposta 409, reação (uma por pessoa, contagem, trocar e tirar), denúncia única e não ao próprio, palavra bloqueada 422, escondido pela moderação some e volta, 5 por minuto 429) | C (`aluno-comenta-na-aula`: convite da aula vazia, publicar com o nome da autora, responder com a menção, reagir pelo seletor; tudo continua depois de recarregar) | comentário com foto de perfil (PR 3e); moderação pela fila do admin no navegador (PR 3h) | A |
| Materiais (aba e página) | lista real por aula, filtro, bloqueio com motivo | C (recarregar) + T (rota) | C (`biblioteca-do-aluno`: rota só de aula com acesso e liberada, 403/400; apostila disponível, checklist esperando 50% com o motivo, rascunho de fora; página Materiais reúne só as aulas liberadas, conta o bloqueado e tipos) | C (`aluno-biblioteca`: aba da aula com Disponíveis e Para liberar; página Materiais sem rascunho nem aula futura, e o atalho leva à aula) | liberar o checklist ao chegar em 50% (precisa de player local); filtros por curso e tipo no navegador | M |
| Tutor IA | chat por aula com base na transcrição, histórico, citações que levam ao tempo do vídeo | C (citações e salto no vídeo) + 4 guardas | C (`tutor-ia`: 401/403; sem transcrição e sem provedor o Tutor diz o motivo; o produtor cola a transcrição e analisa a aula com o provedor falso; chat novo; pergunta vazia e envio inválido 400; pergunta respondida com a transcrição no contexto, citação [F] virando tempo do vídeo e título do chat; envio repetido não duplica; falha do provedor fica marcada; limite diário 429; renomear/excluir só os próprios; não mexe nos chats da IA Diretor) | — | tela do Tutor no navegador com um gateway falso (`BUNKER_AI_GATEWAY_URL`) | B |
| IA Diretor | chat geral sobre cursos e trilhas, com links só para o que o aluno tem | C (referências) | C (`ia-diretor`: 401; sem provedor e sem conteúdo comprado diz o motivo; chat novo; pergunta com só o catálogo autorizado no contexto e a referência [R] virando link interno da aula; referência inventada e link externo não chegam ao aluno; envio repetido não duplica; limite diário 429; renomear/excluir só os próprios; não mexe nos chats do Tutor) | — | tela da IA Diretor no navegador com gateway falso | B |
| Favoritos | salvar e ver em `/favoritos` | C (visão) | C (`biblioteca-do-aluno`: rota 401/400, favoritar curso e aula, desfavoritar, alvo inexistente recusado) | C (`aluno-biblioteca`: favoritar pelo card da home, ver em Favoritos, remover lá) | favoritar módulo e aula pelo navegador; busca e filtro em Favoritos | M |
| Perfil e foto | abas Dados/Acessos/Segurança, enviar e remover foto (WebP, JPEG no Safari) | C (recorte, formatos, cabeçalho) + T (rota) | C (`foto-de-perfil`: PUT/DELETE com o Storage local e a sessão da aluna (RLS): 401, foto fora da regra com a frase certa, envio para a pasta da aluna, perfil e comentários antigos carimbados, troca apaga a antiga, remoção volta às iniciais) | C (`aluno-envia-foto-do-perfil`, Chromium e WebKit: escolher a imagem, recortar, salvar, ver no cabeçalho, no menu, na caixa de comentar e no comentário; remover) | abas Dados e Acessos com banco; alterar senha no navegador | A |
| Minhas compras | acessos com datas, expirados, vitalícios | C (visão) | C (`biblioteca-do-aluno`: os dois cursos com "Desde 01/01/2026 · Acesso vitalício"; acesso expirado não lista) | C (`aluno-biblioteca`: os dois cursos com o acesso, sem o bloqueado) | acesso com data de fim próxima (aviso) | M |
| Minha jornada | números reais, continue de onde parou, progresso por produto | C (modelo) | C (`progresso-aula`: números e retomada batem com o banco) | C (`aluno-biblioteca`: abre com os números e os cursos) | atividade recente com datas | M |
| Suporte | canais configurados e perguntas frequentes | C | — | C (`aluno-biblioteca`: abre com as perguntas frequentes) | canal configurado pela escola aparecendo | B |
| Alterar e redefinir senha | pelo perfil e pelo link de e-mail | C (erro do link) | — | — | alterar senha com Auth local | M |
| Modo TV | controlar a aula em outra tela por QR code | C (contrato da TV e legenda) + 3 guardas | C (`modo-tv`: 401/403/400; código de 6 letras e endereço da TV sem token; uma TV por aluno; só o dono vê; conectar sem login, uma vez só, token guardado só como hash; comandos com revisão e os inválidos; heartbeat grava posição, velocidade e progresso da aula, fim do vídeo conclui a aula; encerrar derruba a TV; código e sessão expirados; eventos) | C (`aluno-assiste-na-tv`: parear pelo código numa tela sem login, controle remoto na aula, encerrar derruba a TV; código errado avisa) | o que depende do vídeo tocando na TV: comando aplicado no player, velocidade confirmada, legenda e qualidade manual | B |
| Menu lateral, cabeçalho, navegação | hambúrguer, itens por acesso, menu da conta, IA Diretor, feedback de navegação | C (`member-shell-model`: grupos e itens, item ativo, menu da conta, saudação e histórico da IA Diretor) + 2 guardas de navegação | — | C (`aluno-menu-e-ia-diretor`: a gaveta abre com os grupos e o item atual marcado, Esc fecha e devolve o foco, o item leva à página; o avatar abre o menu da conta com o nome e os atalhos, Perfil leva à página pelo teclado e Minhas compras pelo clique do mouse (regressão do Safari, corrigida na PR #78); o botão flutuante abre a IA Diretor com a saudação pelo nome, sem provedor mostra o motivo e não deixa escrever, e fecha) | enviar mensagem à IA Diretor pela tela (gateway falso); estado "Abrindo..." da navegação (depende de tempo) | B |

### 3.2 Admin v2 (área do produtor)

| Funcionalidade | O que faz hoje | Unit | Integ | E2E | Falta | Prior. |
|---|---|---|---|---|---|---|
| Entrar como equipe, proteção e permissões | papéis, permissões por ação, alcance por curso, analista só leitura | C (forte: papéis, permissões, alcance) | C (`admin-equipe`: quem não é da equipe volta para `/` e recebe 403 na rota; sem sessão, `/login` e 401; produtor entra como dono; analista entra, mas página de permissão que não tem volta para a área dele e rotas respondem 403) | C (`produtor-admin-equipe`: aluno em `/admin` volta para a home; produtor e analista entram pelo login e caem no admin; analista não chega nas telas de escrita) | professor com alcance vendo só os cursos dele no admin | A |
| Visão geral (Hoje) | números do período, atenção, por produto | C (modelo, período, busca) | — | — | consultas batem com SQL sobre a escola de teste; abre sem erro | M |
| Produtos e conteúdo | lista, novo, árvore de módulos/aulas, painel de aula, detalhes, acesso e venda, alunos, desempenho, pacotes | C (forte: ações com dublês, árvore, formulários, imagens) | C (`admin-produtos`: 403/401; criar nasce rascunho sem capa; professor fora do alcance 403; 2 módulos e 3 aulas com posição e contagem; checklist bloqueia sem capa e sem aula e avisa sem vídeo; publicar com versão velha 409 e com a certa publica, aparecendo a venda para a aluna; reordenar pela RPC e 409 de estrutura antiga; excluir aula e desfazer; arquivar some da home; excluir exige o nome e leva módulos e aulas) | C (`produtor-cria-produto`: criar o produto, montar 2 módulos e 3 aulas pela árvore com Enter, publicar pelo checklist; a aluna vê o produto a venda na home) | capa enviada pela tela (recorte WebP; no WebKit não gera), painel da aula com vídeo, abas Detalhes/Acesso/Alunos/Desempenho, pacotes, mover entre módulos | A |
| Importação de playlist | YouTube → curso | C (parser, planejamento) | — | — | ação com YouTube falso | B |
| Alunos | lista, segmentos, adicionar, importar CSV, perfil 360, liberar/estender/revogar, exportar | C (modelo, segmentos, CSV) | C (`admin-alunos`: analista 403; adicionar com senha temporária e curso liberado cria a conta no Auth com acesso ativo; o aluno entra com a senha, precisa trocá-la e já abre a aula; mesmo e-mail não duplica; liberar outro produto e produto inexistente devolvido; estender 30 dias, data de fim no fuso da escola, tirar a data, revogar tira a aula e Minhas compras, reativar devolve; importar em lote; excluir exige o e-mail e apaga conta e acessos) | C (`produtor-adiciona-aluno`: o produtor adiciona o aluno com senha temporária e o curso; o aluno entra, troca a senha e vê o curso liberado na home e abre a aula) | convite por e-mail (caixa local), segmentos salvos, turmas, exportação CSV com banco | A |
| Equipe e funções | funções prontas e personalizadas, permissões extras, alcance por curso | C (modelo, schemas) + T (10 mistos) | C (`admin-equipe`: analista, professor e aluno recebem 403 em qualquer escrita; dono adiciona uma pessoa como Suporte, a conta nasce no Auth local e já abre o admin; 400 com o campo; troca para Analista e tira da equipe, a conta continua sem admin; ninguém mexe na própria linha; o banco recusa tirar ou rebaixar o último dono) | C (`produtor-admin-equipe`: produtor adiciona uma pessoa como Suporte e a tira pela tela) | funções personalizadas (criar, editar, excluir, protegida) e permissões extras por pessoa com banco | A |
| Comunidade | fila de perguntas, moderação, denúncias, aulas com mais dúvidas, regras | C (forte: 34 testes de modelos e fila) | — | — | ações com banco (responder, aprovar, ocultar, denúncia); responder da fila e a aluna ver | M |
| Comunicação | avisos, promoções, webinários (molduras; v1 é fase 5 do docs/17) | C (moldura) | — | — | só acesso/smoke até existir a v1 | B |
| Área de membros | destaque (hero), tela de entrar, marca, módulos/vitrine | C (forte: modelos e ações com dublês) | C (`admin-area-de-membros`: analista 403; destaque gravado com versão: primeira publicação grava, repetir sem versão ou com versão velha é 409, com a certa grava, e a aluna vê o título; destaque inválido 400; fileiras da home pela rota com versão e 409, a fileira que sai some da home da aluna e volta; tela de entrar com a frase nova e 409) | C (`produtor-publica-destaque`: escrever o título, ligar Mostrar, publicar; a aluna vê o título no topo da home) | marca (logo e estilo) e módulos/vitrine pela tela; imagem do destaque enviada pela tela | A |
| Configurações › IA | conexões, pool de provedores, consumo | C (modelo de consumo) + T (pool: 11) | — | — | pool com provedor falso (unitário); rotas | B |
| Jobs (tick por minuto) | autenticação por token, registro das execuções | C (8) + T (4) | C (`email-transacional`: o tick roda o registro de verdade e grava `job_runs` do job `email-outbox`) | — | — | B |
| E-mail transacional | boas-vindas e acesso liberado por compra pela fila `email_outbox`, job do tick, webhook do Resend | C (`email-config`, `email-provider-resend` com fetch falso, `email-templates`, `email-webhook-signature` com o vetor do Svix, `email-outbox-rules`: 47) | C (`email-transacional`, 15: venda por webhook enfileira boas-vindas e compra uma vez só; "Não enviar agora" não enfileira; sem provedor a fila espera; o job envia com a chave de idempotência e marca `sent`; limite diário por dia UTC; retentativa com espera, dead-letter na quinta falha e 429 sem contar tentativa; expiração em 7 dias e orçamento do tick; webhook 503/401 sem gravar, bounce, entrega, reclamação e evento repetido) | — | e-mail de verdade só em dev, à mão (Resend > Emails); SES quando existir | M |
| Vendas pela Hotmart | Configurações › Vendas (token, endereço, eventos, vendas recebidas, Reprocessar), `POST /api/webhooks/hotmart`, código da Hotmart no produto e no pacote, origem no Hoje | C (`vendas-hotmart`: adaptador com payloads fictícios, token conferido contra o hash em tempo constante, payload só com os campos permitidos, schemas, rótulos, máscara, preso em "Recebido", aviso do endereço, rodapé da origem, origem do pedido: 10) | C (`vendas-hotmart`, 21: 503 sem conexão; só o dono guarda o token e no banco fica só o hash; 401 sem gravar, inclusive mandando o hash; código no Acesso e venda e código repetido recusado ANTES de gravar (sem 409 depois); pacote novo com código repetido não é criado; compra aprovada cria a conta, libera, enfileira boas-vindas e compra e guarda só os campos permitidos; evento repetido não duplica; reembolso revoga só o acesso da compra e repetido não muda nada; reembolso com e-mail de quem tem acesso da equipe não tira; acesso reaberto por venda passa a pertencer à venda; pacote libera todos e, pausado, o reembolso ainda revoga todos; pacote pausado ignora a compra; fim da garantia não reabre acesso suspenso nem revogado e libera só para quem nunca teve; compra com reembolso registrado não libera no reprocesso; Reprocessar depois de ligar o código; evento preso em "Recebido" retomado pelo reenvio e pelo botão; falha fica guardada e "Precisa de atenção" dura até o reprocesso; eventos que não mudam acesso guardam só o envelope; excluir aluno anonimiza as vendas; `admin_access_origins`; desconectar volta ao 503) | C (`produtor-conecta-hotmart`: produtor vê Hotmart "Não conectada" e Ticto/Kiwify "Em configuração", cola o token e fica "Conectada"; uma venda fictícia chega pelo endereço da tela e aparece como "Acesso liberado"; token errado não entra; analista não chega na tela) | Ticto e Kiwify quando existirem; retenção | A |
| Segurança do deploy | CSP, cabeçalhos, flags | T (guarda) | — | — | mantém como guarda | — |

---

## 4. Plano por etapas (cada item é uma PR para a `dev`)

### Etapa 1 — Diagnóstico e padrão (esta PR)

- Este documento, ligado em `README.md`, `CONTRIBUTING.md`, `docs/13` e `AGENTS.md`.
- Pronto quando: o produtor leu e decidiu os itens da seção 6. Feito em 16/10 (ok nas seis decisões).

### Etapa 2 — Base da rotina (3 PRs)

**2a. Banco de teste e integração (feita).** Supabase local pelo CLI (`supabase/config.toml` já existia); `tests/fixtures/escola-de-teste.mjs`; scripts `db:start`, `db:stop`, `db:reset`, `db:seed`, `test:integration` (`tests/support/db.mjs`); trava de URL local (`tests/support/local-db.mjs`); sessão simulada para integração (`tests/support/integration-hooks.mjs`); **o primeiro teste de integração de verdade** (`tests/integration/progresso-aula.test.mjs`, 9 testes): gravar progresso pelo `PUT /api/progress/lessons` e ler de volta pelo `getLessonPageData` e pela fileira Continue assistindo de `getHomePageData`, ao concluir e ao desmarcar; 401, 400, 403 e 404. Job **Integração (Supabase local)** no CI. As 37 migrações sobem do zero.

**2b. Navegador (feita).** Playwright instalado (Chromium e WebKit), `playwright.config.ts` com `webServer` na porta 3100 e variáveis de `.env.test.local`, `auth.setup.ts` com login da aluna e sessão guardada, `fixtures.ts` cortando qualquer pedido para fora; **o primeiro fluxo de verdade** (`tests/e2e/aluno-entra-e-abre-aula.spec.ts`, 3 testes × 2 navegadores): rota protegida manda para entrar e volta; senha errada avisa; aluna abre o curso pela home, o módulo e a aula com título, player, playlist e botão Concluir. Job de CI com navegadores e artefatos de falha. No Mac: 7 testes em cerca de 10 s depois do build.

**2c. Rotina escrita (feita).** Template de PR com o checklist da seção 2.7; `CONTRIBUTING.md` (fluxo a partir da `dev`, seção Testes com os comandos) e `docs/13` com a regra; `npm run verify:full`. A próxima PR de qualquer pessoa já nasce com o checklist.

### Etapa 3 — Cobertura por prioridade (PRs pequenas, nesta ordem)

| # | PR | O que prova |
|---|---|---|
| 3a (feita) | Progresso da aula | integração: os quatro leitores (página da aula, fileira e página Continue assistindo, Minha jornada) devolvem o mesmo estado. Ponta a ponta (Chromium e WebKit): concluir pelo botão → home mostra 25% no card do curso → módulo abre pelo card na próxima aula, com a aula 1 marcada → desmarcar e voltar ao módulo pelo card só com cliques mostra "Concluir" (regressão do #58: com o `prefetch` cheio reaplicado de propósito, este teste fica vermelho; com a correção, verde) → aula começada entra em Continue assistindo e abre pelo card com a playlist igual |
| 3b (feita) | Acesso à aula | integração de `requireLessonAccess` e `requireLessonsAccess` (`tests/integration/acesso-aula.test.mjs`, 10 testes): com acesso, sem compra, acesso expirado, liberação futura, rascunho, aula de outro curso, várias aulas, dono, professor com alcance só num curso, analista. A escola de teste ganhou a aluna com acesso expirado, o professor e o curso de liberação (aula liberada, futura e rascunho) |
| 3c (feita) | O que o aluno vê | integração (`tests/integration/o-que-o-aluno-ve.test.mjs`, 8 testes): `getHomePageData`, `getPurchasesPageData`, `getContentPageData` e `getMemberLibrary` para a aluna, o aluno sem compra e a aluna com acesso expirado. Ponta a ponta (`tests/e2e/aluno-ve-so-o-que-tem-acesso.spec.ts`, 6 testes × 2 navegadores, com a segunda persona logada pelo setup): card bloqueado e modal de compra, endereço de aula sem acesso volta para a home, página do curso a venda com módulo pendente, aula futura com data, home do aluno sem compra |
| 3d (feita) | Comentários | integração das rotas `/api/comments` com banco (`tests/integration/comentarios-aula.test.mjs`, 12 testes, inclusive moderação por RPC e palavra bloqueada); ponta a ponta publicar, responder e reagir na aula (`tests/e2e/aluno-comenta-na-aula.spec.ts`, 3 testes × 2 navegadores). A foto no comentário fica para a 3e, junto com a foto de perfil |
| 3e (feita) | Perfil e foto | integração `tests/integration/foto-de-perfil.test.mjs` (6 testes, Storage local e sessão da aluna de verdade); ponta a ponta `tests/e2e/aluno-envia-foto-do-perfil.spec.ts` (3 testes × 2 navegadores, com uma imagem PNG gerada na hora por `tests/support/imagem-de-teste.mjs`). Para o app aceitar o Storage local (http), três regras passaram a aceitar http só na própria máquina (`src/lib/loopback-url.ts`): endereço da foto gravada, foto mostrada no menu e `img-src` da CSP |
| 3f (feita) | Favoritos, Minhas compras, Minha jornada, Materiais, Suporte | integração `tests/integration/biblioteca-do-aluno.test.mjs` (7 testes: favoritos, materiais, Minhas compras); ponta a ponta `tests/e2e/aluno-biblioteca.spec.ts` (4 testes × 2 navegadores). A escola de teste ganhou materiais (apostila, checklist com 50%, rascunho, material de aula futura) e o início dos acessos passou para meio-dia UTC, para a data cair em 01/01/2026 também no fuso da escola |
| 3g (feita) | Admin: equipe e permissões | integração `tests/integration/admin-equipe.test.mjs` (7 testes: guardas de página e rota, ações da Equipe, trava do banco do último dono); ponta a ponta `tests/e2e/produtor-admin-equipe.spec.ts` (5 testes × 2 navegadores, com produtor e analista logados pelo setup). Para as Server Actions rodarem fora do Next, `next/cache` virou dublê nos testes de integração (a invalidação fica anotada) |
| 3h (feita) | Admin: produtos | integração `tests/integration/admin-produtos.test.mjs` (10 testes); ponta a ponta `tests/e2e/produtor-cria-produto.spec.ts` (2 testes × 2 navegadores). **Bug achado pelo teste:** "Excluir produto" respondia 500 porque ainda apagava da tabela `student_courses`, removida em 14/10 (corrigido na PR própria #70, com este teste como prova). A capa do produto entra por arranjo do teste (link https direto no banco): enviar pela tela exige recorte WebP, que o WebKit não gera, e links externos são cortados |
| 3i (feita) | Admin: alunos | integração `tests/integration/admin-alunos.test.mjs` (8 testes, Auth local de verdade); ponta a ponta `tests/e2e/produtor-adiciona-aluno.spec.ts` (2 testes × 2 navegadores, com o aluno novo entrando num segundo navegador). `next/headers` virou dublê nos testes de integração (o link do e-mail de acesso lê o host do request) |
| 3j (feita) | Admin: área de membros | integração `tests/integration/admin-area-de-membros.test.mjs` (5 testes: destaque, fileiras da home pela rota e tela de entrar, todos com a gravação por versão e o 409); ponta a ponta `tests/e2e/produtor-publica-destaque.spec.ts` (2 testes × 2 navegadores). Pendência pequena vista no caminho: a rota das fileiras responde 500 (e não 400) para layout errado, porque a validação lança um erro comum; a tela valida antes de enviar |
| 3k (feita) | Conversão dos testes de texto, parte 1 | `lesson-player-layout` e `home-card-hover-layout` (46 testes de texto) convertidos: 3 unitários da regra das bordas do carrossel, 2 guardas de produto do player e comportamentos que só existiam em texto: reações da aula e `POST` do `sendBeacon` (integração, `progresso-aula`), abas da aula com o atalho de materiais e o modal de detalhes do curso comprado abrindo a aula (navegador). Unitários passam de 792 para 747 |
| 3l (feita) | Conversão dos testes de texto, parte 2 | `lesson-tv-mode` (20 testes de texto) convertido: 6 unitários (contrato da TV e legenda), 3 guardas, 15 testes de integração das rotas `/api/tv` com banco e 2 de navegador (pareamento e código errado) × 2 navegadores. O Modo TV, que só tinha texto, passa a ter comportamento coberto |
| 3m (feita) | Conversão dos testes de texto, parte 3 | `lesson-ai-tutor` e `platform-guide` (14 testes de texto) convertidos: 8 unitários (citações, salto no vídeo, referências), 4 guardas, 12 testes de integração do Tutor IA e 7 da IA Diretor, ambos com banco e **provedor de IA falso** (`tests/support/integration-ai-provider.mjs` entra no lugar de `src/server/ai/provider-adapter.ts` pelos hooks; pool, limites, mensagens e citações seguem reais) |
| 3n (feita) | Conversão dos testes de texto, parte 4 | `lesson-comments`, `member-sidebar`, `platform-director-chat` e `navigation-feedback` (21 testes de texto) convertidos: 9 unitários (validação de comentário, regras do topo), 3 guardas (`lesson-comments.guard`, `navigation.guard`: roteador com feedback e layout raiz) e 4 testes de navegador (gaveta, menu da conta, IA Diretor sem provedor, atalhos da caixa de comentário). Fim da conversão prevista na tabela 1.3: os arquivos de texto que sobram são guardas nomeadas. **Bug achado pelo teste:** no Safari/WebKit, clicar num atalho do menu da conta (Perfil, Minhas compras, Suporte) ou em Sair fechava o menu antes de o clique completar, porque o Safari não move o foco para o link no clique e o menu fechava no `blur`; pelo teclado funcionava. Corrigido na PR própria #78: o `blur` só fecha quando o foco vai para outro elemento da página (Tab para fora segue fechando; clique fora já fechava pelo `pointerdown` no documento). O teste de mouse ficou marcado como falha esperada no WebKit do macOS (`test.fail`) até a correção e agora passa nos dois navegadores (no WebKit do Linux, o da CI, o clique já focava o link e navegava) |

| Vendas (17/10) | Vendas pela Hotmart | unitários `tests/vendas-hotmart.test.mjs` (10); integração `tests/integration/vendas-hotmart.test.mjs` (21, rota do webhook de verdade contra o banco local, Server Actions de Vendas, do Acesso e venda, de Pacotes e a exclusão do aluno); ponta a ponta `tests/e2e/produtor-conecta-hotmart.spec.ts` (4 × 2 navegadores: a venda fictícia chega por `request.post` no endereço mostrado na tela). A escola de teste ganhou o pacote de vendas (`garantirPacoteDeTeste`), `ligarProdutoNaHotmart`, `desconectarVendas` e `limparVendasDeTeste`. O teste de texto do admin passou a aceitar a palavra "webhook" só em `settings/sales/` (docs/17 §1.3). A revisão pré-produção do mesmo dia (14 achados) virou 7 testes de integração novos, cada um com o cenário de falha que a revisão descreveu |

Cada PR da etapa 3 atualiza as tabelas da seção 3.

### Riscos conhecidos

- **Migrações do zero.** Resolvido na PR 2a: as 37 migrações sobem em banco vazio sem erro (Supabase CLI 2.121, Postgres 17), inclusive `202610100001_jobs_cron.sql` com `pg_cron`, `pg_net` e `vault`. A partir de agora o CI prova isso em toda PR.
- **Docker no Mac.** Instalado; precisa estar aberto para `npm run db:start`. Sem ele, integração e ponta a ponta só rodam no CI. É aceitável para começar.
- **Tempo do CI.** O job E2E deve ficar abaixo de 8 min. Se passar, cortamos WebKit para só os fluxos que dependem dele (foto, player) e mantemos Chromium no resto.
- **Testes intermitentes.** Player com vídeo externo e animações são as fontes clássicas. Mitigação: bloquear rede externa, esperar por estado e não por tempo, e a regra 8 da rotina.
- **Versão do Node.** `package.json` pede Node 24; o CI usa 24.11; o Mac está no 26. Os scripts novos não podem depender de nada fora do 24.

---

## 5. Pronto quando (critério das três etapas)

- O padrão existe aqui e está ligado em `CONTRIBUTING.md`, `docs/13`, `README.md` e `AGENTS.md`.
- Qualquer pessoa, seguindo a seção 2.4, roda `npm test`, `npm run test:integration` e `npm run test:e2e` no próprio computador (com Docker) sem tocar no Supabase compartilhado.
- O CI tem os jobs Verify e E2E em toda PR para `dev` e `main`; a regra "só entra verde" está escrita e, se a conta permitir, aplicada pelo GitHub.
- O template de PR cobra teste de comportamento ou justificativa.
- As tabelas da seção 3 mostram cada funcionalidade com teste de comportamento (C nas colunas certas) ou com a pendência escrita e justificada.
- O bug do "Concluída/Concluir" tem um teste de ponta a ponta que fica vermelho se ele voltar (PR 3a: `tests/e2e/aluno-conclui-e-desmarca-aula.spec.ts`, conferido revertendo a correção do #58 de propósito).

---

## 6. Decisões para o produtor

| # | Decisão | Recomendação | Alternativa |
|---|---|---|---|
| 1 | Ferramenta de navegador | **Playwright** (2.6) | Cypress (mais pesado, WebKit experimental, painel pago) |
| 2 | Banco de teste | **Supabase local em Docker**, no Mac e no CI (2.5). No Mac, exige abrir o Docker Desktop para rodar integração e ponta a ponta; unitários não precisam | só no CI (não roda local); projeto separado na nuvem só como futuro ambiente de dev |
| 3 | Bloqueio de merge pelo GitHub | **assinar GitHub Pro** (cerca de US$ 4/mês por conta): habilita proteção de branch em repositório privado, e aí Verify e E2E viram obrigatórios de verdade | seguir com a regra operacional (como hoje), sabendo que um clique errado passa |
| 4 | Quando rodar ponta a ponta | **em toda PR** para `dev` e `main` (é quando o erro é barato) | só na promoção para `main` (mais rápido, pega o erro tarde) |
| 5 | Ferramenta de unitário e integração | **manter `node --test`** (zero dependência, 789 testes já nele) | migrar para Vitest (mais recursos, mas é churn sem ganho agora) |
| 6 | Ordem da etapa 3 | **progresso da aula primeiro** (3a), depois acesso e o que o aluno vê, depois admin | admin primeiro |

Com o ok nessas seis linhas, a etapa 2 começa pela PR 2a.

---

## 7. Relação com outros documentos

- `docs/13-padroes-engenharia.md`: regra geral de verificação; passa a apontar para este documento para o "como".
- `CONTRIBUTING.md`: fluxo de PR, seção Testes com os comandos e a regra.
- `docs/17-admin-produtor-redesign.md` §2.9: já previa Playwright e os fluxos "criar produto com 2 módulos e 3 aulas", "liberar acesso em 3 cliques" e "publicar → aparece na home". Este documento é a execução daquela previsão.
- `docs/16-auditoria-tecnica-2026-10-01.md`: origem do diagnóstico "91% regex".
- `docs/06-seguranca-operacao.md`: nenhum teste escreve em dado real; os dados de teste são fictícios.

---

## 8. Glossário

- **Teste unitário**: testa uma peça pequena (uma função, uma regra) isolada do resto.
- **Teste de integração**: testa peças juntas, aqui o código do servidor com o banco de verdade.
- **Teste de ponta a ponta (e2e)**: abre o navegador e faz o que a pessoa faria, do login ao resultado na tela.
- **Teste de guarda**: confere uma regra de organização do código (por exemplo, "esse arquivo não pode importar aquele"). Não prova comportamento.
- **Dublê** (stub, fake): substituto controlado de uma peça de verdade, como um banco em memória que responde sempre igual.
- **Fixture / escola de teste**: dados prontos e previsíveis usados pelos testes.
- **Seed**: o ato de carregar esses dados num banco vazio.
- **Supabase local**: cópia do Supabase rodando no seu computador via Docker, com banco, login, arquivos e caixa de e-mail próprios.
- **Docker**: programa que roda serviços (como o banco) em caixas isoladas no computador.
- **CI**: os robôs do GitHub que rodam os comandos a cada PR e mostram verde ou vermelho.
- **Proteção de branch**: configuração do GitHub que impede o merge sem os checks verdes.
- **Teste intermitente** (flaky): passa e falha sem ninguém mudar nada; sinal de teste mal escrito ou de dependência externa.
- **Regressão**: erro que volta depois de já ter sido corrigido; teste de regressão é o que fica de guarda para ele não voltar.
- **storageState**: arquivo em que o Playwright guarda a sessão depois do login para não precisar entrar de novo em cada teste.
