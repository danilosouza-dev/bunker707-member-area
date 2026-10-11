# Auditoria tecnica 2026-10-01

Auditoria completa da area de membros Bunker707 apos ressincronizacao do repositorio local com `danilosouza-dev/bunker707-member-area` (commit `7658da8`, branches `main` e `dev`). O fork local "Cursos Flix" (75 commits) foi descartado por decisao do mantenedor; backup completo em bundle git fora do repositorio.

Metodo: 7 auditores independentes (arquitetura, seguranca, UX do aluno, modelo de dados, qualidade/testes, dependencias/operacao, residuos de marca), com verificacao adversarial dos defeitos de severidade alta e media (2-3 ceticos por finding, veredito por maioria). `npm run verify` no estado sincronizado: lint ok, typecheck ok, 210 testes ok, build ok.

## Estado geral

O MVP do aluno (itens 1-9 da prioridade do AGENTS.md) esta implementado com dados reais do Supabase: app shell, home streaming com hero e fileira sobreposta, sidebar/hamburguer, cards verticais, minhas compras, pagina de curso, pagina de aula com player YouTube e playlist, progresso persistido e catalogo dirigido por entitlements com enforcement server-side. Alem do MVP ja existem CMS admin, Tutor IA, IA Diretor, Modo TV e importador de playlists do YouTube. O item 10 (busca, perfil, suporte) nao existe. A postura de seguranca e boa (RLS em todas as tabelas, service_role confinada ao servidor, CSP com nonce, guards em todas as rotas), mas ha riscos reais de autorizacao listados abaixo.

## Criticos (resolver antes de evoluir funcionalidades)

1. **`is_locked` funciona como fonte de autorizacao** (`src/server/access/lesson-access.ts:284`, `src/server/db/platform-store.ts:1216`, `:1341`). `hasOpenAccess = access_model === 'free' || is_locked === false` libera conteudo fechado sem entitlement — e `is_locked` tem default `false` na migration. Derivar bloqueio exclusivamente de `access_model` + entitlements; tratar `is_locked` como apresentacao.
2. **Pipeline de webhooks/compras externas inexistente.** Nao ha `src/app/api/webhooks`, tabela `webhook_events` nem adapters Hotmart/Ticto. Entitlements so entram por CRM manual. O painel de integracoes do admin e decorativo (grava JSON em `platform_settings` sem backend) — esconder ou rotular "em breve" ate o pipeline existir.

## Defeitos e riscos confirmados (media severidade)

- **`PUT /api/admin/students` replace-all sem validacao** (`src/app/api/admin/students/route.ts:14`, `platform-store.ts:2842`): payload parcial apaga alunos, historicos e entitlements em massa; dois admins concorrentes se sobrescrevem. Migrar para mutacoes granulares com schema (zod).
- **Regra de entitlement implementada 3x com semanticas diferentes** (`platform-store.ts`, `lesson-access.ts`, `learning-catalog.ts`): home concede por CRM manual, aula so por entitlements — card liberado pode dar 403 na aula. Extrair um unico resolver em `src/server/access`.
- **Datas/status de acesso em texto livre** (`students`/`student_courses` com colunas `text`, parse de "Vitalicio" e `dd/mm/aaaa`, regex `/^bloqueado/i`): texto fora do padrao vira acesso vitalicio. Migrar para `timestamptz` + coluna de status.
- **Estado por aluno em coluna global** (`lessons.completed`, `content_items.progress`): aula com `completed=true` aparece concluida para todos os alunos sem progresso proprio.
- **`lesson_progress` com read-modify-write serializado so em memoria** (`platform-store.ts:3668`): em serverless, heartbeats concorrentes perdem progresso. Mover merge para o banco.
- **`entitlements` sem unique em `(user_id, source_event_id)`** + select-then-insert em loop: duplicacao sob concorrencia, N+1 de escritas.
- **`deleteContentItem` nao revoga entitlements do alvo**; re-import de playlist com IDs deterministicos (`yt-course-<playlistId>`) reanexa entitlements antigos.
- **`requireApiAdmin` sem granularidade de papel**: `analyst`/`support` tem escrita total nas 26 rotas admin, incluindo substituir a base de alunos e trocar chaves de IA.
- **Corpo JSON sem limite em ~34 rotas** (`readBoundedJson` so usado em 2), incluindo rotas sem sessao (`/api/tv/connect`, `/api/tv/receiver/*`).
- **91% da suite de testes e regex sobre o codigo-fonte** (1.880 de ~2.060 asserts): nao valida comportamento e quebra com refactor. Fluxos criticos (`getActiveContentEntitlements`, `requireLessonAccess`, auth) sem nenhum teste comportamental.
- **CI nao roda na branch `dev`** (so push/PR para `main`); pre-commit nao roda typecheck.
- **God components**: `admin-dashboard.tsx` 6.458 linhas/59 useState, `lesson-experience.tsx` 4.893, `platform-store.ts` 3.814 — ~30% de `src/` em 3 arquivos, contra o limite de ~1.000 de docs/13.
- **Sem jobs em background**: import de playlist roda sincrono no route handler sem `maxDuration` — playlists grandes estouram timeout na Vercel.
- **Producao sem Sentry/PostHog** apesar de exigidos no checklist de docs/06.

## Divergencias doc vs codigo

- `docs/05-modelo-dados.md` descreve dezenas de entidades que nao existem (`products`, `webhook_events`, `support_tickets`, `admin_activity_log`, `course_progress` etc.) e nao documenta o schema real. Atualizar com secao "estado atual".
- `AGENTS.md` ainda recomenda Mux/Bunny, PostHog, Sentry, Trigger.dev como stack corrente; a decisao real (docs/09) e YouTube-first. Atualizar a secao de stack e a lista de docs (faltam 10, 12, 14, 15).
- Tabelas `home_sections`/`home_section_items` existem no banco mas estao mortas; runtime usa `platform_settings`.
- Modulos prescritos ausentes em `src/server`: `content/`, `progress/`, `events/`, `payments/`, `support/`, `jobs/`.

## Limpezas menores

- `set_updated_at()` sem `search_path` fixado; `ilike` sem escapar `%`/`_` na busca por email (`platform-store.ts:987`); `user_id` sem FK em `lesson_progress`/`saved_items`; no-op na migration 202606150004; busca do header sem handler; perfil/suporte/sidebar com botoes mortos; `shadcn` (CLI) em dependencies de producao; SWR instalado mas usado em 1 arquivo; global `window.__bunker707FlushLessonProgress` duplicado.
- Volume exFAT do SSD gera arquivos `._*` dentro de `.git` que causam erros `non-monotonic index` (cosmeticos). Limpeza: `find .git -name '._*' -delete`.

## Correcoes aplicadas em 2026-10-01

- `is_locked` removido das decisoes de autorizacao (lesson-access, learning-catalog, platform-store); segue como estado visual.
- `applyLessonProgress` nao vaza mais `lessons.completed`/`progress` globais para aluno sem progresso proprio.
- `replaceCompletedLessons` com compare-and-swap otimista por `updated_at` + retry (3x), protegendo contra instancias serverless concorrentes.
- Sync CRM -> entitlements com upsert atomico `on conflict (user_id, source_event_id)` e fallback legado enquanto a migration 202610010002 nao for aplicada ao banco.
- `deleteContentItem` revoga entitlements ativos do conteudo removido.
- `PUT /api/admin/students`: payload validado campo a campo (`src/server/students/validate.ts`), corpo limitado a 20MB e trava contra remocao em massa (>10 alunos e >50% da base).
- `requireApiAdmin({ roles })`: mutacoes de alunos, acessos e chaves/conexoes de IA restritas a owner/admin (12 handlers).
- `readBoundedJson` aplicado as ~34 rotas que liam corpo sem limite (16KB a 10MB conforme a rota); `maxDuration = 60` no import de playlists.
- CI roda na branch dev e usa `npm run verify`; pre-commit ganhou typecheck; `.gitignore` cobre `*.bundle`.
- Escape de curingas no `ilike` de email; `getDefaultAdminStatus` simplificado.
- Migrations novas (aplicar ao banco com `supabase db push` ou SQL editor): `202610010001_fix_set_updated_at_search_path.sql`, `202610010002_entitlements_unique_source_event.sql`.
- `npm run verify` completo apos as mudancas: lint ok, typecheck ok, 210 testes ok, build ok.

Nota de conteudo: o banco Supabase (`zbvzfmdjtbibxhkvoeuv`) contem apenas 6 cursos de teste importados em 13-15/ago (era Cursos Flix); o catalogo original Bunker707 nao esta nesse banco. Decisao do mantenedor em 2026-10-01: manter como esta por ora e verificar depois se a producao usa outro projeto Supabase. A producao atual na Vercel esta na conta do fork descartado (Bertoldo's projects, repo cursos-flix) — migrar o projeto Vercel para a conta danilosouza-dev e conectar ao repo bunker707-member-area e pendencia de infra.

## Plano de retomada sugerido

1. ~~Restaurar ambiente local (env do gateway renomeado para `BUNKER_AI_GATEWAY_*`, identidade git, baseline `npm run verify`)~~ — feito em 2026-10-01.
2. Fechar a Fase 4: remover o fallback `is_locked` e unificar o resolver de acesso em entitlements reais (docs/07:92).
3. Fase 5: `src/app/api/webhooks` com evento fake/manual, idempotencia e tabela `webhook_events` de payload bruto (RLS deny-all).
4. Adapters Hotmart e Ticto mapeando venda externa para produto/combo interno.
5. Item 10 do MVP: busca server-side filtrada por entitlements, pagina de perfil, formulario de suporte.
6. Fase 6: Sentry e PostHog sobre os `student_events` existentes; eventos nucleares (`user_signed_in`, `lesson_started`, `lesson_completed`).
7. Decisoes abertas: ORM (docs/09:19) e provedor de video pago definitivo (docs/09:33).
8. Higiene continua: granularizar `replaceAdminStudents`, papeis admin, `readBoundedJson` nas rotas, CI na `dev`, decomposicao incremental dos monolitos, migracao das datas texto para `timestamptz`.
