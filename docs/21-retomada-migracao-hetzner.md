# 21. Retomada: migracao para a Hetzner (estado em 19/10/2026)

> **Atualizacao de 19/10/2026 (segunda sessao):** a revisao da secao 4.1 foi feita (secao 7) e a execucao da
> 4.3 comecou. O produtor decidiu CX23 (4 GB) para os dois servidores, mantidos ligados (secao 8). Leia as
> secoes 7 e 8 antes da 4.
>
> **Atualizacao de 21/10/2026:** a Comunicacao v2 traz a migracao `202610200002` (com a RPC 7.15 e as correcoes
> M1 a M4), que precisa estar aplicada antes do deploy que a usa: no Supabase da nuvem antes do merge na `dev`;
> na producao o `deploy-membros` aplica sozinho. Passos na secao 9. As correcoes da revisao vem na
> `202610210001` (a 0002 ja esta aplicada na nuvem de teste e nao muda): mesma regra, secao 9.1.
>
> **Atualizacao de 19/10/2026 (fim do dia):** a producao na Hetzner roda a `main` (promocao #107, imagem
> `hetzner-sha-5e44340`). Daqui em diante vale o fluxo do `CONTRIBUTING.md`: branch a partir da `dev`, PR para a
> `dev` (teste na Vercel), promocao para a `main` e `deploy-membros` disparado da `main` (secao 8, item 6).

Documento de passagem de sessao. Quem continuar (outra conta, outra sessao do Claude Code na nuvem) le este
arquivo primeiro e segue a secao 4, na ordem. Tudo que esta aqui foi verificado na sessao de 18 e 19/10/2026.
Contexto completo: docs/19 (secao 0, decisao) e docs/20 (secoes 4A e 8A, operacao).

## 1. Decisoes do produtor (nao reabrir)

| Tema | Decisao |
|---|---|
| Arquitetura | Dois servidores proprios na Hetzner Cloud: `bunker707-membros` (app Next.js + Supabase self-hosted + Caddy, banco junto com o app) e `bunker707-marketing` (Mautic 7.2.1 + MySQL 8.4.11 + Caddy). Cloudflare na frente. Backup no Storage Box. |
| Por que assim | Banco junto: o Supabase e uma unidade e a latencia app/banco pesa; escala pequena. Mautic separado: PHP publico com mais falhas de seguranca, carga em rajada, ciclo de vida proprio. Detalhe em docs/19 §0.2 e §0.3. |
| Disponibilidade | Queda de 15 a 20 minutos e aceitavel para o produtor. Sem alta disponibilidade; crescimento por rescale e, depois, banco separado (docs/19 §0.5). |
| Staging e producao | Vercel + Supabase cloud continuam como staging (desenvolvimento). A Hetzner e a producao. Em 19/10/2026 o plano de "snapshot e apagar" foi revisto: com o estoque da linha CX intermitente, apagar o servidor arrisca nao conseguir recriar o tipo barato. Os servidores ficam ligados (secao 8). |
| E-mail | Resend (dominio `mail.bunker707.com.br`, verificado) ate a conta do Amazon SES existir. Mautic ja instalado e enviando pelo Resend; a troca para o SES e so `MAUTIC_MAILER_DSN`. |
| Custo | Ate US$ 10 por mes no servidor da area de membros. Em 19/10/2026: CX23 (2 vCPU, 4 GB, EUR 6,49) nos dois servidores, porque o CX33 estava sem estoque e subiu para EUR 9,99 (acima de US$ 10). Ver secao 8. Mautic tem custo fixo (servidor) e nao cobra por contato (docs/19 §0.8). |
| Execucao | 100% pela IA, sem nada na maquina do produtor (ele so tem creditos na nuvem). |

## 2. Por que a execucao e pelo GitHub Actions

A sessao do Claude Code na nuvem sai por um proxy que reencripta TLS e so libera HTTPS para uma lista de
hosts. Verificado em 18/10/2026: `api.hetzner.cloud`, `api.cloudflare.com`, `www.cloudflare.com`,
`api.resend.com` e o dominio bunker707.com.br estao bloqueados; SSH nao passa (o tunel CONNECT abre, mas o
trafego SSH e cortado). `github.com`, `api.github.com`, `registry-1.docker.io`, `raw.githubusercontent.com`
e `checkip.amazonaws.com` passam.

Por isso os "bracos" sao o workflow `Infra (Hetzner)` (`.github/workflows/infra.yml`, id 388832203 no
GitHub), disparado pela ferramenta MCP do GitHub `actions_run_trigger` (metodo `run_workflow`,
`workflow_id: infra.yml`, `ref: main`, inputs `etapa`, `opcoes`, `payload`; `deploy-*` so roda da `main`, as
outras etapas rodam de qualquer branch) e lido
por `actions_list` (`list_workflow_runs`) e `get_job_logs` (`run_id`, `failed_only`, `return_content: true`).
Teste feito em 18/10/2026: a execucao 39174505182 (etapa `status`) rodou e parou em "Segredo HCLOUD_TOKEN
ausente", como esperado. O caminho funciona; faltam os segredos.

## 3. O que esta pronto (branch `claude/hopeful-franklin-04s7wt`, sem PR aberta)

Commits de 18/10/2026, todos publicados:

| Commit | O que |
|---|---|
| e2cda8a | infra/cloud (provisionamento e operacao), infra/mautic (stack do Mautic), modelos de e-mail do Auth em portugues, workflow |
| 3f0ef34 | job `registrar` no push do arquivo do workflow (um workflow novo so aceita disparo depois de rodar uma vez) |
| 6d382ea | tests/infra-mautic.test.mjs e tests/infra-cloud.test.mjs |
| 64845a5, 827b9a7 | docs/19 secao 0, docs/20 secoes 4A e 8A, README, infra/terraform/README |
| cce4638 | etapas `snapshot` e `restaurar` |
| 60c9355 | correcoes da revisao de shell (set_env por base64, guarda para dash, ControlMaster, ufw allow, chave de backup derivada, cloud-init, envelope hex, pasta de backup) |
| 7ca1be1 | correcoes da revisao de APIs (IP pelo JSON, firewall por id, snapshot sem -o json, validacao de segredos, plan, equipe, smoke) |

Verificado em 19/10/2026: `npm run verify` passa (lint, typecheck, testes, build); os 26 testes de
`tests/infra-*.test.mjs` passam; `docker compose config` passa nos tres composes; o Caddy 2.11.7 valida os
Caddyfiles; envelope de segredos faz ida e volta; a chave derivada e aceita pelo `ssh-keygen`.

Nunca executado de verdade (a sessao nao tem Docker nem acesso a Hetzner): o primeiro `docker compose up`,
o bootstrap, o Caddy com TLS e o Storage Box serao os da primeira rodada no Actions. Espere ajustes ali.

## 4. O que falta, na ordem

### 4.1 Revisao que ficou pela metade (IA)

A segunda rodada de revisao adversarial caiu no limite semanal da conta antes de comecar. Faltam tres
lentes, com verificacao de cada achado antes de corrigir:

1. Docker/Compose/Caddy/Mautic/MySQL: infra/mautic/** , infra/compose/caddy/Caddyfile (site do Mautic e
   `/auth-templates`), infra/compose/docker-compose.yml (auth com `GOTRUE_MAILER_TEMPLATES_*`,
   `GOTRUE_MAILER_SUBJECTS_*` e `extra_hosts`; volume dos modelos no caddy). Conferir: nomes das variaveis
   do GoTrue, se o Auth baixa `https://api.../auth-templates/*.html` de dentro do container, comandos do cron
   no Mautic 7, healthchecks, perfil `borda`, rede `bunker707_default` na colocacao.
2. Seguranca: segredos em logs do Actions; `equipe.sh` passa a chave `sb_secret_` em linha de comando remota
   (aparece no `ps` do servidor); envelope sem autenticacao (AES-CBC); fechamento do SSH no trap.
3. GitHub Actions: expressoes de `PAYLOAD`/`COMANDO`, `packages: write` para o push no GHCR e o pull no
   servidor com o `GITHUB_TOKEN` do job, `git archive HEAD` com checkout raso, tamanho do caminho do socket
   do ControlMaster em `RUNNER_TEMP` (limite de 108 caracteres para socket unix).

Pode ser feito com o Workflow tool (o script anterior esta descrito acima) ou direto. Corrigir, rodar
`node --test tests/infra-*.test.mjs` e `npm run verify`, commitar e publicar na mesma branch.

### 4.2 O que o produtor faz (uma vez, cerca de 10 minutos)

1. Ligar o 2FA na Hetzner (console > conta > Security).
2. Token da Hetzner: console > projeto > Security > API tokens > Generate, permissao Read & Write.
3. Token da Cloudflare: dash.cloudflare.com > My Profile > API Tokens > Create Custom Token, permissoes
   Zone > DNS > Edit, Zone > Zone Settings > Edit, Zone > Zone > Read, recurso: zona `bunker707.com.br`.
4. No GitHub: repositorio `danilosouza-dev/bunker707-member-area` > Settings > Secrets and variables >
   Actions > New repository secret: `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN`. Nunca colar no chat.
5. Na nova conta do Claude: conectar o GitHub com acesso a esse repositorio. Os conectores do Supabase e do
   Resend ajudam (leitura do projeto da nuvem e criacao da chave de envio), mas nao sao obrigatorios.

### 4.3 Execucao pela IA (depois dos segredos)

Cada etapa e um disparo do workflow; ler o log, corrigir o que falhar, commitar, disparar de novo. Todas
sao idempotentes.

1. `plan`: mostra tipos, precos e a escolha. Reportar o custo ao produtor.
2. `provision`: chave SSH, firewalls, servidores, Storage Box, bootstrap, chave de transferencia, DNS. O log
   imprime a `transfer.pub` de cada servidor (base64) para os envelopes. A partir daqui ha cobranca por hora.
3. `deploy-membros`: imagem no GHCR, stack, migracoes, smoke, tick de jobs, backup.
4. `deploy-marketing`: Mautic, instalacao sem instalador web, smoke, backup.
5. Chave do Resend: pelo conector do Resend, criar uma chave nova so de envio restrita a
   `mail.bunker707.com.br` (nome sugerido `bunker707-hetzner-envio`). Gravar o valor num arquivo do scratchpad
   (nunca no chat nem no repositorio):
   - membros: `SMTP_PASS=<chave>`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=<chave>`;
   - marketing: `MAUTIC_MAILER_DSN=smtp://resend:<chave>@smtp.resend.com:587`.
   Cifrar com `bash infra/cloud/envelope.sh encrypt '<transfer.pub base64 do servidor>' <arquivo>`, disparar
   `secrets-membros` e `secrets-marketing` com o payload e apagar os arquivos. `RESEND_WEBHOOK_SECRET` fica
   para quando a producao entrar no ar: o plano Free tem um endpoint de webhook e ele aponta para a Vercel
   (staging) hoje.
6. `equipe`: convites para `ferramentas.bunker707@gmail.com` (owner) e `bertoldomolina8@gmail.com` (admin).
   So depois do passo 5 (o convite sai pelo SMTP).
7. `status` e `status-ssh`: os quatro enderecos respondendo, backups registrados. Reportar ao produtor.
8. `snapshot` com `opcoes: CONFIRMAR=apagar`: guarda os dois servidores e apaga. Confirmar com o produtor se
   a Storage Box fica (EUR 3,20 por mes, com os backups) ou vai junto (`APAGAR_STORAGE_BOX=1`).
9. Quando o produtor disser "vai": `restaurar`, `status`; se o snapshot estiver velho, `deploy-membros` e
   `deploy-marketing`; trocar o webhook do Resend para `https://membros.bunker707.com.br/api/webhooks/resend`.

Opcoes uteis em `opcoes`: `MEMBROS_TYPE=cx33`, `MARKETING_TYPE=cx23`, `LOCATION=nbg1`,
`PRODUCER_IP=<ip>` (libera SSH e Studio para o produtor), `SKIP_MARKETING=1` (Mautic no mesmo servidor,
plano B se faltar estoque).

## 5. Fatos da nuvem atual (staging), lidos em 18/10/2026

- Supabase: projeto `hrtnqcznhdmodjikvddm` (sa-east-1, Postgres 17), 4 contas, 2 na equipe, 1 curso,
  8 arquivos no bucket `content-assets`, 0 vendas, Hotmart/Ticto/Kiwify nao configuradas, 42 migracoes
  (ultima `202610170008`), 3 agendamentos `pg_cron`, Vault com `jobs_tick_url` e `jobs_tick_token`.
- Resend: dominio verificado; chaves `bunker707-member-area-envio`, `Supabase Integration`,
  `Vercel Integration`; webhook para `https://bunker707-member-area.vercel.app/api/webhooks/resend`.
- Vercel: projeto `bunker707-member-area` no time `team_48lgM8CQkfSDKsqIG5WIrNk1`; o conector respondeu 403
  para esse time (leitura de dominios e variaveis indisponivel pela IA).
- Migracao e deploy limpo: nada e copiado da nuvem; a equipe entra por convite.

## 6. Texto para colar na nova sessao

```txt
Continue a migracao da Bunker707 para a Hetzner de onde parou. Trabalhe numa branch criada a partir da
dev do repositorio danilosouza-dev/bunker707-member-area (fluxo do CONTRIBUTING.md). Leia primeiro
docs/21-retomada-migracao-hetzner.md: os servidores ja estao no ar (secao 8). Confira o estado com a etapa
status do workflow Infra (Hetzner) e siga os pendentes da secao 8 (a virada de producao, item 4), me
reportando o resultado de cada etapa. Codigo novo vai para o servidor so pela main, depois do teste na dev.
Tudo pela IA; eu nao tenho maquina local.
```

## 7. Revisao da secao 4.1 (feita em 19/10/2026)

Tres revisores, um por lente, com verificacao de cada achado. Correcoes no commit `593ae6d` (lentes 2 e 3);
a lente 1 (Docker/Compose/Caddy/Mautic) esta na secao 8.

- Bloqueante: sem Node no servidor, o `generate-secrets.sh` rodava o Node num container como root e o `.env`
  nascia `root:root 0600`, ilegivel para o `deploy` (quebraria `deploy-*` e `secrets-*`). Agora o container
  roda com o usuario de quem chamou.
- Porta 22: trap armado antes de abrir; falha ao fechar vira erro; cancelamento ou timeout (que nao rodam o
  trap) sao cobertos pelo passo final `Fechar o SSH (sempre)` e pela etapa nova `fechar-ssh`.
- Workflow: tokens so no `env` dos passos que rodam os scripts, actions fixadas por commit, `ETAPA` por env,
  permissoes e fila so no job `infra`.
- Envelope: so os dois membros esperados, sem link simbolico, nada impresso se a decifragem falhar; texto
  claro em 0600 e apagado em qualquer desfecho. AES-CBC sem autenticacao ficou: quem pode mandar payload ja
  tem `exec-*` (root), entao cifra autenticada nao muda o risco.
- `equipe.sh`: a chave `sb_secret_` fica no servidor (curl le os cabecalhos do stdin); `EQUIPE` separada por
  virgula; e-mail e papel validados.
- Imagem de producao com tag `hetzner-sha-<commit>` (a `sha-<commit>` do `build-image.yml` e de staging);
  rollback sem pull quando a imagem ja esta no disco.
- Storage Box: senha com caractere especial (a API recusava), local proprio (`STORAGE_BOX_LOCATION`, hel1)
  e snapshots diarios do box (um servidor comprometido nao apaga os backups do outro).
- `PRODUCER_IP` validado (no maximo /24 ou /48); `SKIP_MARKETING` normalizado; CLI do Supabase conferida por
  sha256; `restaurar` so escolhe tipos com disco que comporta o snapshot; migracoes trocadas inteiras no
  `sync_repo`.
- Aceito sem mudar: `StrictHostKeyChecking=accept-new` (known_hosts novo a cada job); `OPCOES` sem allowlist
  (quem preenche ja tem `exec-*`).
- Para o produtor decidir: quem tem escrita no repositorio tem, na pratica, os tokens e root nos servidores
  (docs/20 §16). Em 19/10/2026: `danilosouza-dev`, `marketingLendario` e `bertoldomolina8-cpu`.

## 8. Estado da producao na Hetzner (19/10/2026, fim da segunda sessao)

Decisao do produtor: o servidor da area de membros tem de custar ate US$ 10 por mes. Com o CX33 sem estoque
(e a EUR 9,99, acima disso), ficou o CX23 (2 vCPU, 4 GB, EUR 6,49) nos dois papeis. Os servidores ficam
LIGADOS: o estoque da linha CX e intermitente, e apagar para recriar depois arrisca nao conseguir o tipo
barato. O "snapshot e apagar" da secao 4.3 (passos 8 e 9) nao foi feito.

| Item | Estado |
|---|---|
| `bunker707-membros` | CX23 em fsn1, 2.28.47.222; app + Supabase, 11 containers saudaveis (Studio e meta so quando ligados, docs/20 §8.1) |
| `bunker707-marketing` | CX23 em fsn1, 91.99.219.220; Mautic 7.2.1 instalado por linha de comando |
| Storage Box | `bunker707-backups` (bx11) em hel1, separado do datacenter dos servidores; snapshots diarios do box |
| Backups | restic em `bunker707/restic` e `bunker707/restic-mautic`, timers diarios, primeiro backup feito |
| DNS | `membros`, `api`, `studio` e `marketing` proxied na Cloudflare, SSL Full (strict) |
| E-mail | chave `bunker707-hetzner-envio` no Resend (so envio, restrita a `mail.bunker707.com.br`), nos dois servidores |
| Equipe | `ferramentas.bunker707@gmail.com` (owner) e `bertoldomolina8@gmail.com` (admin) convidados; os dois ja com e-mail confirmado, criam a senha por "Esqueci minha senha" |
| Custo | cerca de EUR 18 por mes (2 x EUR 6,49 + IPv4 + Storage Box EUR 4,00), sem IVA |

O que a primeira rodada real corrigiu (alem da revisao da secao 7): senha do Storage Box com especial;
`/run/sshd` antes do `sshd -t`; caminho do restic relativo a `/home` do box; smoke esperando o Realtime e os
servicos recriados; envelope compacto (o de tar tinha 13 mil caracteres); convite e recuperacao por
`token_hash` em `/auth/confirm` (o `ConfirmationURL` caia no login, docs/06); redirecionamentos pela origem
dos cabecalhos (o `request.url` do Next no container vinha como `0.0.0.0:3000`).

Pendente, para o produtor decidir:

1. (Feito em 19/10/2026, a pedido do produtor.) Senha de recuperacao dos backups: segunda chave de cada
   repositorio restic, derivada do `HCLOUD_TOKEN` (etapa `chave-backup`; docs/20 §10.2). Sem o `.env` do
   servidor, o token guardado no GitHub abre o backup.
2. Acesso de escrita ao repositorio (docs/20 §16): quem tem escrita tem os tokens e root nos servidores.
3. (Feito em 19/10/2026.) Teste de carga, etapa `carga` (docs/20 §12.1): o CX23 atende cerca de 18 paginas
   por segundo sem erro, mais de 3 vezes o inicio. Ajustes de servidor (Studio e meta no perfil `studio`,
   `AUTH_SESSION_STRATEGY=claims`, Envoy checando o PostgREST pela porta) e do app, aprovado pelo produtor
   (catalogo publicado em cache com a tag `catalog`; paginas de conteudo validando so o JWT, docs/06). Mediana com
   100 alunos: 14,3 s -> 7,5 s -> 1,9 s; com 30: 2,4 s -> 0,75 s -> 0,33 s. O gargalo agora e a renderizacao do app.
4. A virada de producao (docs/20 §14): webhook do Resend para `https://membros.bunker707.com.br/api/webhooks/resend`
   e `RESEND_WEBHOOK_SECRET` por `secrets-membros`; Hotmart e Ticto; conteudo (nada e copiado da nuvem). A Vercel e
   o Supabase da nuvem ficam como ambiente de teste (item 6).
5. Opcional: igualar os modelos de e-mail do Supabase cloud (staging) ao `/auth/confirm` (docs/06).
6. (Decidido em 19/10/2026.) Ambientes: `dev` = teste na Vercel com o Supabase da nuvem, so contas da equipe;
   `main` = producao na Hetzner, e `deploy-membros` recusa outra branch (`CONTRIBUTING.md`). Feito no mesmo dia:
   o produtor trocou na Vercel (projeto `bunker707-member-area`, conta do Bertoldo, plano Hobby) o Branch
   Tracking de Production de `main` para `dev`; a branch da migracao entrou na `dev` (#105, com a #106) e foi
   promovida para a `main` (#107); `deploy-membros` da `main` (execucao 39313206338) pos no ar
   `hetzner-sha-5e44340`, smoke verde, `AUTH_SESSION_STRATEGY=claims` conferido no container.

## 9. Comunicacao v2: migracao `202610200002` antes do deploy (21/10/2026)

A PR da Comunicacao v2 (`docs/23`, branch `claude/notification-system-ymk02g`) traz a migracao
`supabase/migrations/202610200002_communication_v2.sql`. A `202610200001` (v1) ja esta aplicada no Supabase da
nuvem e nao muda.

Regra: **a 0002 vai antes do deploy que a usa**. O app da v2 nao tem caminho de volta para as colunas da v1:
sem a migracao o sino e o pop-up respondem vazio, a rota do audio responde 404, o job `comunicacao` registra
"migracao 202610200001 pendente ou 202610200002 pendente" e termina, as telas mostram o aviso de atualizacao,
e envios, cliques e respostas nao funcionam. O contrario e seguro: a migracao sozinha nao atrapalha o app da
v1 (colunas novas nulas; `expires_at` preenchido pelo gatilho).

A versao a aplicar e a do repositorio, que ja traz as correcoes feitas na implementacao:

- M1: RPC 7.15 `communication_release_flow_tasks(jsonb)` (devolve um lote que falhou antes de aplicar, devolvendo a
  tentativa), com revoke/grant/comment;
- M2: a reserva (7.1) carimba `greatest(p_now, clock_timestamp())`;
- M3: a 7.5 recusa pai ou ancora fora da arvore enviada (`Passo invalido.`);
- M4: o check `notifications_engagement_v2` nao tem "aberta implica lida";
- `notifications.flow_id` com `on delete cascade` (achado no teste do contrato, antes do M1).

Se alguma versao anterior da 0002 tivesse sido aplicada em algum banco, os blocos `if not exists` manteriam o
check antigo: confira antes (abaixo). Ate 21/10/2026 a 0002 nao foi aplicada em nenhum banco fora do local.

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**, antes do merge da PR na `dev` (a Vercel
publica a `dev` sozinha no merge):

1. secoes 1 a 8 pelo MCP do Supabase (`apply_migration`, nome `communication_v2`), de uma vez ou em partes, na
   ordem do arquivo (fluxos -> passos -> `campaigns` -> `notifications` -> passagens e tarefas -> visitas ->
   RPCs -> permissoes). O MCP trava (timeout) em comando que ele julga destrutivo; a 0002 nao tem `drop`, mas
   se uma parte travar, mande-a pelo SQL Editor;
2. secao 9 (retencao: `delete` dentro de `prune_communication_history()`) pelo SQL Editor (ou `psql`);
3. conferir: as consultas do cabecalho da migracao (`sem_fim = 0`);
   `select count(*) from pg_proc where proname = 'communication_release_flow_tasks';` = 1;
   `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_engagement_v2';` sem
   `read_at`; `list_migrations` com `202610200002`. Se partes foram pelo SQL Editor e a versao nao aparece:
   `insert into supabase_migrations.schema_migrations (version, name) values ('202610200002', 'communication_v2') on conflict do nothing;`
4. o tick do ambiente de teste ligado (secao 5: `jobs_tick_url` e `jobs_tick_token` no Vault); seguir o roteiro
   do `docs/23` §11.

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam as migracoes novas
antes de trocar o app (`deploy.sh`, docs/20 §9). Depois, a rodada do `carga` com um fluxo no ar (docs/20 §12.1).

### 9.1 Correcoes da revisao: migracao `202610210001` (21/10/2026)

A 0002 ja foi aplicada no Supabase da nuvem de teste e **nao muda mais**. O que a revisao corrigiu no banco
vem em `supabase/migrations/202610210001_communication_v2_fixes.sql`, idempotente, sem `drop` e sem `delete`:

1. coluna `communication_flow_nodes.born_first_level` + gatilho `set_communication_flow_nodes_first_level`
   (passo criado como filho da entrada);
2. 7.1 `communication_claim_flow_tasks`: a tarefa presa que vira falha fecha a passagem sem nada aberto;
3. 7.2 `communication_enroll_flow`: confere a `revision` de cada entrada;
4. 7.3 `communication_enroll_notice_recipients`: complemento so de passo que nasceu de primeiro nivel, criado
   depois da passagem (nunca o passo que subiu de nivel para quem foi pelo outro caminho);
5. 7.4 `communication_apply_flow_results`: confere a `revision` de cada decisao (`stale_version`);
6. permissoes e descricoes (mesmas assinaturas).

Ambiente de teste: secoes 1 a 6 pelo MCP do Supabase (`apply_migration`, nome `communication_v2_fixes`), de uma
vez ou em partes, **antes** do merge da correcao na `dev` (o app novo manda `revision`; a migracao sozinha nao
atrapalha o app anterior, que nao manda e nao e conferido). Conferir:
`select tgname from pg_trigger where tgrelid = 'public.communication_flow_nodes'::regclass;` (com
`set_communication_flow_nodes_first_level`) e `list_migrations` com `202610210001`. Passos ja existentes ficam com
`born_first_level = false` (o complemento so vale para seguintes criadas depois de aplicar). Producao: nada
manual (o `deploy-membros` aplica).
