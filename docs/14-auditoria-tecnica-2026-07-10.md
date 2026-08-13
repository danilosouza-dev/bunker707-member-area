# Auditoria Tecnica - 10/07/2026

## Escopo

A auditoria cobriu o estado local do produto e o Supabase configurado para desenvolvimento:

- arquitetura Next.js App Router e fronteiras server/client;
- autenticacao, autorizacao, RLS e exposicao de dados;
- persistencia, integridade e modelo de acesso;
- performance de consultas, payload, navegacao e ambiente local;
- APIs de progresso, favoritos, comentarios e CMS;
- dependencias, segredos, tratamento de erro e qualidade estatica;
- testes, build, documentacao e operacao.

Ela nao valida servicos ainda nao conectados ou sem credencial operacional, como webhooks reais de cada plataforma, politica efetiva de backup do plano Supabase, Sentry/PostHog em producao e provedor final de video.

## Resultado executivo

Os problemas de maior impacto encontrados no codigo foram corrigidos:

- uma leitura da plataforma transferia cerca de 9 MB porque capas estavam em Base64;
- o HTML da home chegava a aproximadamente 19,8 milhoes de caracteres, dos quais 18,47 milhoes eram Data URLs;
- shell e pagina repetiam a mesma leitura e a navegacao executava `router.push` seguido de `router.refresh`;
- salvar favorito ou progresso podia ler e regravar um snapshot amplo da base;
- consultas de membro carregavam dados administrativos e registros de outros usuarios;
- cursos internos nao possuiam associacao explicita confiavel com sua formacao;
- progresso aceitava listas de aulas validando apenas um dos ids;
- policies antigas expunham metadados e configuracao de video diretamente a qualquer cliente Supabase autenticado;
- erros 5xx podiam devolver detalhes internos ao browser;
- o ambiente no SSD ExFAT acumulava dezenas de milhares de AppleDouble e cerca de 93 GB alocados apenas em `node_modules`.

O unico bloqueio critico restante nao pode ser resolvido apenas pelo repositorio: a migration de revogacao das policies precisa ser aplicada por uma conta proprietaria do projeto Supabase ou por credencial de banco.

## Correcoes aplicadas

### Performance e persistencia

- Leituras admin/membro foram separadas e memoizadas por request.
- Progresso, favoritos, conteudo, modulos, aulas, combos e alunos usam operacoes granulares.
- O fluxo de regravacao integral da base foi removido.
- `router.refresh` redundante foi removido da navegacao do shell e da aula.
- Seis capas de conteudo e uma capa de modulo foram migradas para `content-assets`.
- A carga das 14 consultas caiu de aproximadamente 9 MB para 68.222 bytes; medicao quente observada de 245 ms.
- O Storage respondeu HTTP 200 com `Cache-Control: public, max-age=31536000`.

### Acesso e integridade

- `requireLessonAccess` centraliza pertencimento, publicacao, release rule e entitlement.
- `requireLessonsAccess` valida em lote todos os ids enviados por progresso/conclusao/reacao.
- Leitura da area do aluno filtra progresso, favoritos, entitlements e CRM pela identidade autenticada.
- Cursos internos usam `parentFormationId`; a formacao libera somente seus proprios cursos mapeados.
- Os seis cursos internos existentes foram associados a `auto-formation-1`.

### Seguranca

- A migration `202607100002_harden_content_and_media_storage.sql` remove policies permissivas, revoga grants diretos, restringe funcao sensivel e adiciona indices.
- Rotas de aluno usam usuario da sessao, nunca `user_id` fornecido pelo cliente.
- Rotas administrativas continuam protegidas por `admin_roles`.
- Comentarios, reacoes e denuncias revalidam acesso ao conteudo.
- Erros inesperados sao logados no servidor e sanitizados na resposta.
- Varredura de segredos encontrou somente nomes de variaveis e referencias esperadas; nenhum valor de chave foi encontrado no repositorio.
- `npm audit` encontrou zero vulnerabilidades.

### Ambiente local

- `node_modules` foi reinstalado em cache APFS interno e ligado ao workspace.
- `.next` foi movido para cache APFS interno.
- 47.291 arquivos AppleDouble foram removidos do workspace.
- O SSD externo recuperou aproximadamente 95 GB de espaco.
- `git fsck --connectivity-only` confirmou conectividade do repositorio.

## Evidencias antes da correcao

Medicoes autenticadas no servidor Webpack antigo:

| Navegacao | Tempo observado |
| --- | ---: |
| Home para Minhas compras | 8,0 s |
| Minhas compras para Favoritos | 5,5 s |
| Favoritos para Home | 4,4 s |

Outras evidencias:

| Item | Antes |
| --- | ---: |
| Payload das 14 consultas | cerca de 9 MB |
| `content_items` | 7,79 MB |
| `course_modules` | 1,15 MB |
| HTML/DOM serializado da home | cerca de 19,8 milhoes de caracteres |
| Base64 inline na home | 18,47 milhoes de caracteres |
| Primeira compilacao de rota de aula | cerca de 10 s |

As medidas de navegacao posteriores devem ser registradas depois do teste autenticado com Turbopack; build limpo e navegacao quente sao metricas diferentes e nao devem ser misturados.

## Validacao executada

- ESLint: aprovado.
- TypeScript `--noEmit`: aprovado.
- Testes Node: 62 aprovados, zero falhas.
- `npm audit`: zero vulnerabilidades.
- Migracao de sete imagens reais: concluida.
- Leitura do Storage: HTTP 200 e cache longo confirmado.
- Conectividade Git: aprovada.

O gate final `npm run verify` e a validacao visual autenticada devem ser executados novamente depois das ultimas alteracoes e registrados na entrega.

## Pendencias e risco residual

### P0 operacional - aplicar RLS remoto

A migration esta pronta, mas nao foi aplicada remotamente. A conta Supabase disponivel nao enxerga o projeto `zbvzfmdjtbibxhkvoeuv`, e o ambiente nao possui `SUPABASE_DB_PASSWORD`, `DATABASE_URL` ou token de gestao. Ate um proprietario executar a DDL, as policies permissivas antigas continuam ativas no ambiente remoto.

### P2 estrutural - decompor modulos grandes

Arquivos ainda excessivamente concentrados:

- `src/components/admin-dashboard.tsx`: cerca de 5.163 linhas;
- `src/server/db/platform-store.ts`: cerca de 3.124 linhas;
- `src/components/lesson-experience.tsx`: cerca de 2.967 linhas;
- `src/components/content-details-modal.tsx`: cerca de 1.031 linhas.

Isso aumenta custo de mudanca e risco de conflito, mas uma extracao ampla durante uma correcao de seguranca seria mais arriscada que uma decomposicao incremental. Novas funcionalidades devem respeitar os limites descritos em `docs/13-padroes-engenharia.md`.

### P2 qualidade - cobertura E2E e observabilidade

Os testes atuais sao principalmente contratos estaticos e regras unitarias. Ainda faltam uma suite E2E automatizada autenticada, monitoramento de Web Vitals, Sentry/PostHog ativos e alertas de falha de webhook. A validacao manual no browser cobre o fluxo desta entrega, mas nao substitui CI E2E.

### Manutencao de dependencias

Existem atualizacoes patch/minor disponiveis, mas nenhuma vulnerabilidade. Elas devem entrar em mudanca isolada, com `npm run verify` e teste visual, em vez de serem misturadas automaticamente a esta correcao de arquitetura.
