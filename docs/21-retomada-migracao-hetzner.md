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
> **Atualizacao de 23/10/2026:** a Comunicacao v3b-2 traz a migracao `202610260001` (cinco secoes, a 5 sozinha;
> antes, contar as linhas de `student_events`), que vai antes do merge na `dev`; e uma regra de operacao: **nao
> publicar nem editar pop-ups "No primeiro acesso" ou "Ao concluir um curso" enquanto o app do ambiente rodar a versao
> de antes** (R1). Passos na secao 9.5.
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

### 9.2 Comunicacao v3a: migracao `202610220001` antes do deploy (22/10/2026)

A PR da Comunicacao v3a "Sino e avisos" (`docs/24`, branch `claude/notification-system-ymk02g`) traz
`supabase/migrations/202610220001_communication_v3a.sql`. As `202610200001`, `202610200002` e `202610210001` ja
estao aplicadas no Supabase da nuvem de teste e nao mudam.

Regra: **a 0003 vai antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha). O app da v3a sem ela mostra
o sino vazio e as escritas novas (reagir, votar, excluir) respondem 404; a migracao sozinha nao atrapalha o app da
v2 (colunas novas com padrao; nenhuma linha fica excluida antes das rotas novas).

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**:

1. conferir que ela ainda nao esta la: `list_migrations` (sem `202610220001`);
2. secoes 1 a 6 pelo MCP do Supabase (`apply_migration`, nome `communication_v3a`), de uma vez ou uma secao por
   chamada, **na ordem do arquivo**: 1 `campaigns` (colunas e checks) -> 2 `notifications` (colunas, checks e o
   indice parcial) -> 3 `campaign_deliveries` -> 4 leitura do sino (4.1 visibilidade, 4.2 contagem da enquete,
   4.3 pagina, 4.4 numeros: a 4.2 precisa existir antes da 4.3 e da 5.2, que a chamam) -> 5 escritas (5.1 a 5.6,
   com a 7.9 refeita com a mesma assinatura) -> 6 permissoes e descricoes. Nao ha `drop` nem `delete`: nenhuma
   parte precisa do SQL Editor. O indice novo nasce vazio (ninguem votou);
3. conferir: as consultas do cabecalho da migracao;
   `select count(*) from pg_proc where proname = 'communication_inbox_page';` = 1;
   `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_poll_v3';`;
   `select indexname from pg_indexes where indexname = 'notifications_poll_tally_idx';`; `list_migrations` com
   `202610220001`. Se alguma parte foi pelo SQL Editor e a versao nao aparece:
   `insert into supabase_migrations.schema_migrations (version, name) values ('202610220001', 'communication_v3a') on conflict do nothing;`
4. a idempotencia foi conferida no banco local (segunda aplicacao sem erro, so "already exists, skipping"):
   reaplicar uma secao que travou no meio e seguro;
5. ajustes depois do primeiro teste (`docs/24` §10): `supabase/migrations/202610220002_communication_v3a_ajustes.sql`,
   tambem **antes do merge** (o app novo le `allow_hide` na pagina do sino e grava menos de 60 minutos no tempo do
   sino). Secoes 1 a 4 pelo MCP (`apply_migration`, nome `communication_v3a_ajustes`), na ordem do arquivo; a secao 5
   (`alter table public.campaigns drop constraint if exists campaigns_validity_v2;`, a unica que tira alguma coisa)
   sozinha, pelo MCP ou pelo SQL Editor. Conferir com `list_migrations` (`202610220002`) e as consultas do
   `docs/24` §12, passo 8;
6. fazer o merge e seguir o roteiro do `docs/24` §12.

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam a migracao antes de
trocar o app. Depois, a rodada do `carga` com o sino novo (docs/20 §12.1; meta de tempo de servidor ate 20 ms).

### 9.3 Comunicacao v3b-1: migracao `202610220003` antes do deploy (22/10/2026)

A PR da Comunicacao v3b-1 "Pop-ups: frequencia, paginas e como fechar" (`docs/25`) traz
`supabase/migrations/202610220003_communication_v3b1.sql`. As `202610200001`, `202610200002`, `202610210001`,
`202610220001` e `202610220002` ja estao aplicadas no Supabase da nuvem de teste e nao mudam.

Regra: **a 0003 vai antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha). Sem ela, o app novo para mais
que os pop-ups: o admin mostra o aviso de banco desatualizado (as colunas novas estao em `CAMPAIGN_COLUMNS`), o resumo
responde `popups: null`, o `show` responde 404 e **o job `comunicacao` do tick falha** (le as campanhas com
`CAMPAIGN_COLUMNS`), parando notificacoes agendadas, seguintes e fluxos ate a migracao. O sino continua. A migracao
sozinha nao atrapalha o app da v3a (colunas com padrao = o comportamento de antes; a funcao de reinicio mantem o
contrato).

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**:

1. conferir que ela ainda nao esta la: `list_migrations` (com `202610220002`, sem `202610220003`);
2. secoes 1 a 6 pelo MCP do Supabase, **na ordem do arquivo**, `execute_sql` **uma secao por chamada** (a secao 2
   usa a funcao da 1; a secao 4, que valida o check de `campaign_deliveries`, vai sozinha para a leitura da tabela
   nao segurar o `add column` da 3), ou `apply_migration` com o arquivo inteiro, nome `communication_v3b1`. Nao ha
   `drop`, `delete` nem gatilho: nenhuma parte precisa do SQL Editor;
3. conferir com as consultas do cabecalho da migracao (os pop-ups de antes em `page_load`, `null`, `any`, `1440`;
   7 constraints `campaign%v3b`, todas `convalidated = true`; 2 funcoes; `popup_repeat` fora da funcao de reinicio) e
   `list_migrations` com `202610220003`. Se foi por `execute_sql` (que nao grava a versao):
   `insert into supabase_migrations.schema_migrations (version, name) values ('202610220003', 'communication_v3b1') on conflict do nothing;`
4. a idempotencia foi conferida no banco local (segunda aplicacao com `psql` sem erro, so "already exists,
   skipping"): reaplicar uma secao que travou no meio e seguro;
5. fazer o merge e seguir o roteiro do `docs/25` §10;
6. **depois do merge, nao editar pop-ups pela previa de uma PR mais antiga** (criada antes da v3b-1): ela usa o mesmo
   banco, e salvar um pop-up "Mais de uma vez" como o "Uma vez" da v3a fere `campaigns_popup_frequency_v3b` (a previa
   antiga mostra o erro generico; o app novo sempre grava `popup_repeat` e `popup_frequency` juntos).

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam a migracao antes de
trocar o app.

### 9.4 Modelos da Comunicacao: migracao `202610250001` antes do deploy (25/10/2026)

A PR dos Modelos (`docs/28`) traz `supabase/migrations/202610250001_communication_templates.sql`. As migracoes ate a
`202610240001` nao mudam (a guarda `comunicacao-modelos.guard` confere os hashes).

Regra: **a 0001 vai antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha). Sem ela, o app novo continua
de pe: a aba Modelos mostra "migracao pendente" (`202610250001`), o "Novo aviso" continua um link, o `?modelo=` abre o
editor em branco com "Este modelo não existe mais" e a limpeza segue sem modelos (so a tabela ausente vale como
"nenhum modelo"). Salvar um modelo falha ate aplicar. A migracao sozinha nao atrapalha o app de antes (tabela nova).

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**:

1. conferir que ela ainda nao esta la: `list_migrations` (com `202610240001`, sem `202610250001`);
2. a secao unica pelo MCP do Supabase, numa chamada so: `execute_sql` com `set lock_timeout = '5s';` antes do texto
   do arquivo (a tabela e nova; o `lock_timeout` so protege o `create trigger`, que pega um lock curto na tabela
   nova), ou `apply_migration` com o arquivo inteiro, nome `communication_templates`. Nao ha `drop`, `delete` nem
   funcao nova: o gatilho usa a `public.set_updated_at()` que ja existe, dentro de `do $$ ... if not exists`. Se o
   MCP recusar o bloco `do`, o plano B esta no `docs/28` §8 (risco 1);
3. conferir com as consultas do cabecalho da migracao: `relrowsecurity = true`, 0 politicas, `anon` e
   `authenticated` sem `select`, 9 constraints, o gatilho `set_communication_templates_updated_at` e 0 linhas. Se
   foi por `execute_sql` (que nao grava a versao), gravar o historico com o `insert into
   supabase_migrations.schema_migrations (version, name, statements) ... on conflict (version) do nothing` do
   relatorio da PR;
4. a idempotencia foi conferida no banco local (segunda aplicacao com `psql` sem erro, so "already exists,
   skipping"; e a primeira aplicacao numa tabela nova, dentro de uma transacao desfeita);
5. fazer o merge e seguir o roteiro do `docs/28` §11.

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam a migracao antes de
trocar o app.

### 9.5 Comunicacao v3b-2: migracao `202610260001` antes do deploy (23/10/2026)

A PR da Comunicacao v3b-2 "Pop-ups: hora marcada ao vivo, primeiro acesso, curso concluido, relatorio e players de
fora" (`docs/29`) traz `supabase/migrations/202610260001_communication_v3b2.sql` (sha256 `44566be5...f3b76ae8`, fixado
na guarda `comunicacao-v3b2.guard`). As migracoes ate a `202610250001` nao mudam.

Regra: **a 0026 vai antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha). Sem ela, `CAMPAIGN_COLUMNS`
(que ganhou `popup_access_products`) quebra o admin de avisos e **o job `comunicacao` do tick**, parando notificacoes
agendadas, seguintes e fluxos ate a migracao (como na v3b-1). A migracao sozinha nao atrapalha o app de antes (ele nao
le as colunas novas; o navegador de antes nao grava `campaign` no historico).

**Regra de operacao (R1, `docs/29` §3 e §9.2)**: **nao publicar nem editar "No primeiro acesso" ou "Ao concluir um
curso" num ambiente enquanto o app (e o tick) desse ambiente roda a versao de antes.** O app de antes le os dois como
"Ao abrir a pagina": o plano e o `show` dele aceitam, o tick dele habilita o segmento inteiro num "No primeiro acesso"
(o app novo desfaz no recalculo seguinte: a linha sem a marca `first_access_at` sai) e editar ali um "No primeiro
acesso" sem produtos grava "Ao abrir a pagina" sem erro. Na nuvem, vale entre aplicar a migracao e o merge; depois do
merge, nao usar previas de PRs anteriores para criar ou editar pop-ups. Na Hetzner, vale ao voltar para a imagem
anterior (`docs/20` §9).

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**:

1. conferir que ela ainda nao esta la: `list_migrations` (com `202610250001`, sem `202610260001`);
2. contar as linhas: `select count(*) from public.student_events;` (o indice da secao 3 nao e `concurrently`: enquanto
   ele monta, as escritas na tabela esperam; ate uns 10 milhoes de linhas, segundos; no local, 2,66 milhoes em ~2,3 s);
3. as cinco secoes pelo MCP do Supabase, `execute_sql`, **uma por chamada e na ordem do arquivo**, cada uma comecando
   com `set lock_timeout = '5s';`: 1 `campaigns` (funcao `communication_popup_products_ok`, coluna
   `popup_access_products`, comentarios e o check `campaigns_popup_access_v3b2` dentro de `do $$ ... if not exists`) ->
   2 `campaign_deliveries.first_access_at` -> 3 o indice `student_events_campaign_idx`, numa chamada so dele -> 4 a
   funcao `communication_popup_report` (`create or replace`, mesma assinatura: se uma versao anterior ja tiver sido
   aplicada, ela e trocada) -> 5 o `alter policy "Students can create own events"`, **sozinha** (se o MCP recusar, pelo
   SQL Editor). Ou `apply_migration` com o arquivo inteiro, nome `communication_v3b2`. Nao ha `drop`, `delete`, gatilho
   nem `create policy`. O texto de cada chamada e o bloco `/* N. ... */` correspondente do proprio arquivo da migracao
   (do cabecalho da secao ate o cabecalho da seguinte), com `set lock_timeout = '5s';` na frente;
4. conferir com as consultas do cabecalho da migracao: constraint `campaigns_popup_access_v3b2` com
   `convalidated = true`; 1 funcao `communication_popup_products_ok`; 0 pop-ups com produtos; 0 linhas com
   `first_access_at`; o indice existe; `communication_popup_report` com `authenticated` = false e `service_role` =
   true; `select metric, total, students from public.communication_popup_report(gen_random_uuid()) order by 1;` =
   `max 0 0`, `median 0 0`, `viewers 0 0`; a politica com `campaign` no `with check`. O cabecalho nao confere as
   permissoes da funcao dos produtos: rode a parte
   `select has_function_privilege('authenticated', 'public.communication_popup_products_ok(text[])', 'execute'),
   has_function_privilege('service_role', 'public.communication_popup_products_ok(text[])', 'execute');` = `false`, `true`;
5. se foi por `execute_sql` (que nao grava a versao), gravar o historico com
   `insert into supabase_migrations.schema_migrations (version, name) values ('202610260001', 'communication_v3b2') on conflict (version) do nothing;`
   (a coluna `statements` e `text[]`; o texto da migracao nao precisa entrar); `list_migrations` com `202610260001`;
6. a idempotencia foi conferida no banco local (duas aplicacoes com `psql` sem erro, so "already exists, skipping";
   `db:reset` com 52 migracoes e mais uma aplicacao por cima): reaplicar uma secao que travou no meio e seguro;
7. fazer o merge e seguir o roteiro do `docs/29` §10 (o primeiro passo e conferir que a `dev` ja roda a v3b-2 antes de
   publicar os momentos novos). A conferencia dos players em aparelho real (`docs/29` §10.1) e condicao para a PR
   `dev` -> `main`.

**Producao (Hetzner)**: nada manual para a migracao. A promocao `dev` -> `main` e o `deploy-membros` aplicam a
migracao antes de trocar o app (o indice trava as escritas em `student_events` pelos segundos da montagem). Antes de
voltar para a imagem anterior, pausar os pop-ups "No primeiro acesso" e "Ao concluir um curso" (`docs/20` §9). Depois,
uma rodada do `carga` com um pop-up de hora marcada (`docs/20` §12.1, `docs/29` R17).

### 9.6 Webinarios v1: migracao `202610280001` aplicada na nuvem de teste (28/10/2026)

A PR dos webinarios, fase 1 "Base: agenda, vaga garantida e lembretes" (`docs/30` §11, branch `claude/nifty-mendel-tx2kro`)
traz `supabase/migrations/202610280001_webinars_v1.sql` (sha256 fixado na guarda `webinarios-migracao.guard`). As
migracoes ate a `202610260001` nao mudam.

Regra: **a 0028 vai antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha). Sem ela, o app novo mostra o
aviso de migracao pendente em `/admin/comunicacao/webinarios`, a pagina `/webinarios` do aluno responde vazia, "Garantir
vaga" responde 404 e o job `webinarios` do tick registra "migracao 202610280001 pendente" e termina; o resto do app segue.
A migracao sozinha nao atrapalha o app de antes: cinco tabelas novas que ele nao le, o kind `webinar` que ele nunca grava
(a funcao do sino so ganha um ramo), e a politica do historico que so tira do navegador um `entity_type` que ele nao usa.

**Ambiente de teste (Supabase da nuvem, `hrtnqcznhdmodjikvddm`)**: feito em 28/10/2026, pelo MCP do Supabase,
`execute_sql`, **uma secao por chamada e na ordem do arquivo**, cada uma comecando com `set lock_timeout = '5s';`:
1 `webinars` -> 2 `webinar_sessions` -> 3 `webinar_presenters` -> 4 `webinar_recordings` e a chave
`webinar_sessions_recording_fk` -> 5 `webinar_registrations` -> 6 `notifications` (a troca do check do kind dentro do
`do $$ ... if not exists`, a unica remocao, e a funcao `communication_visible_notifications` com o ramo do `webinar`)
-> 7 o `alter policy "Students can create own events"` e o indice `student_events_webinar_idx` (69 linhas em
`student_events`: instantaneo) -> 8 `webinar_report`. Nenhuma chamada travou; o MCP nao pediu confirmacao. A versao
foi gravada com `insert into supabase_migrations.schema_migrations (version, name) values ('202610280001', 'webinars_v1')
on conflict (version) do nothing;` e `list_migrations` mostra `202610280001`.

Conferido depois de aplicar (as consultas do cabecalho da migracao): 5 tabelas `webinar%`, todas com RLS;
`notifications_kind_v4` existe e e o unico check de kind; `webinar_report` existe, `authenticated` = false e
`service_role` = true, e devolve 0 linhas para um id qualquer; a politica com `campaign` e `webinar`; o indice existe; 4
gatilhos `set_webinar*_updated_at`. A idempotencia foi conferida la mesmo (a secao 1 e a 6 de novo: sem erro, nada muda).

Se a migracao mudar antes do merge (pedido da implementacao ou da revisao): aplicar de novo o arquivo inteiro (ou so a
secao que mudou) do mesmo jeito, e atualizar juntos este paragrafo e o hash da guarda.

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam a migracao antes de trocar o
app (o indice parcial trava as escritas em `student_events` pelos segundos da montagem). Jitsi e Jibri so entram na fase
3 (`docs/30` §7), com ok do produtor no chat antes de qualquer servidor novo.

### 9.7 Webinarios v2: migracao `202610290001` aplicada na nuvem de teste (29/10/2026)

A mesma PR leva a fase 2 "Live gravada" (`docs/30` §11) com `supabase/migrations/202610290001_webinars_v2_chat.sql`
(sha256 fixado na guarda `webinarios-v2.guard`). Regra igual a da 9.6: **antes do merge na `dev`**. Sem ela, a sala da
Live gravada, o console e o relatorio mostram o aviso de migracao pendente; o resto do app segue.

**Ambiente de teste (`hrtnqcznhdmodjikvddm`)**: secoes 1 a 12 pelo MCP do Supabase, `execute_sql`, uma por chamada, na
ordem do arquivo, cada uma com `set lock_timeout = '5s';` (nenhuma travou). A secao 13 (`prune_webinar_history`, os unicos
`delete` do arquivo, e o agendamento `bunker707-webinar-prune` as 06:47 UTC) fez o MCP pedir confirmacao, e a janela
expirou tres vezes (ela espera 60 s e nao apareceu para o produtor): o produtor rodou no SQL Editor, num arquivo so, a 13, a
14 (as permissoes das funcoes so para a `service_role`) e o registro da versao (`insert into
supabase_migrations.schema_migrations (version, name) values ('202610290001', 'webinars_v2_chat') on conflict (version)
do nothing;`). `list_migrations` mostra `202610290001`. Proxima vez que uma secao tiver `delete`: mandar direto o arquivo
para o SQL Editor.

### 9.8 Webinarios v3: migracao `202610290002` antes do merge (29/10/2026)

A fase 3 "Sala ao vivo" (`docs/30` §11) vem na mesma PR com `supabase/migrations/202610290002_webinars_v3_live.sql`
(sha256 `b48d8504a243ba8f...`, fixado na guarda `webinarios-v3.guard`, que tambem confere byte a byte as 54 migracoes de
antes). Regra igual a da 9.6: **antes do merge na `dev`** (a Vercel publica a `dev` sozinha). Sem ela, o app novo pede as
colunas novas de `webinar_sessions` em toda leitura de sessao: as paginas de webinario do aluno e do admin mostram o
aviso de migracao pendente e o job `webinar-recordings` registra a migracao pendente e termina; o resto do app segue. A
migracao sozinha nao atrapalha o app de antes: as colunas novas tem padrao (`recorder_status = 'none'`,
`room_locked = false`, o resto nulo) e o check `webinar_sessions_live_only_v3` aceita toda linha que o app de antes grava;
tres tabelas e uma funcao que ele nao le.

**Ambiente de teste (`hrtnqcznhdmodjikvddm`)**: pelo MCP do Supabase, `execute_sql`, **uma secao por chamada e na ordem
do arquivo**, cada uma comecando com `set lock_timeout = '5s';`: 1 `webinar_sessions` (as sete colunas, os tres checks
dentro de `do $$ ... if not exists`, o indice unico parcial de `room_name` e os comentarios) -> 2 `webinar_recordings`
(`checked_at`, `purged_at` e os dois indices parciais) -> 3 `webinar_session_bans` e `webinar_user_bans` (RLS, revoke de
`anon` e `authenticated`, grant ao `service_role`) -> 4 `webinar_recording_events` (idem, e os tres indices) -> 5 a
funcao `webinar_mark_recording_anchor` (com o revoke e o grant so ao `service_role`) -> 6 os indices
`webinar_sessions_recorder_idx` e `webinar_session_bans_session_idx`. Nenhuma secao tem `delete`, `drop` nem politica (a
5 so define a funcao; os `update` dela rodam quando o app chama). Se o MCP pedir confirmacao e a janela expirar (como na
9.7), mandar o arquivo inteiro para o SQL Editor (e idempotente). Depois, gravar a versao:
`insert into supabase_migrations.schema_migrations (version, name) values ('202610290002', 'webinars_v3_live') on conflict
(version) do nothing;` e conferir `list_migrations`.

Conferencia depois de aplicar (as consultas do cabecalho da migracao):

```sql
select column_name from information_schema.columns where table_name = 'webinar_sessions'
  and column_name in ('room_name', 'recorder_status', 'recorder_requested_at', 'recorder_release_requested_at',
    'recorder_alerted_at', 'recording_requested_at', 'room_locked'); -- 7 linhas
select column_name from information_schema.columns where table_name = 'webinar_recordings'
  and column_name in ('checked_at', 'purged_at'); -- 2 linhas
select count(*) from pg_tables where schemaname = 'public'
  and tablename in ('webinar_session_bans', 'webinar_user_bans', 'webinar_recording_events'); -- 3
select indexname from pg_indexes where schemaname = 'public' and indexname in ('webinar_sessions_room_name_idx',
  'webinar_recording_events_unique_idx', 'webinar_session_bans_session_idx', 'webinar_sessions_recorder_idx'); -- 4 linhas
select proname from pg_proc where proname = 'webinar_mark_recording_anchor'; -- 1 linha
select public.webinar_mark_recording_anchor(gen_random_uuid()); -- erro P0002 (sessao inexistente)
```

E mais duas, das regras de acesso: `select relrowsecurity from pg_class where relname in ('webinar_session_bans',
'webinar_user_bans', 'webinar_recording_events')` (3 x `true`) e
`select has_function_privilege('authenticated', 'public.webinar_mark_recording_anchor(uuid, timestamptz)', 'execute')`
(`false`; `service_role`: `true`). A idempotencia se confere rodando a secao 1 de novo (sem erro, nada muda). Estado em
29/10/2026: aplicada na nuvem de teste antes do merge da PR da fase 3. As seis secoes da 0002 e a secao 2 da 0003 foram pelo
MCP, uma por chamada, sem travar. A secao 1 da 0003 (`drop index` da chave antiga) fez o MCP pedir confirmacao e a janela
expirou, entao o produtor rodou no SQL Editor as secoes 1 e 3 da 0003 e o registro das duas versoes. `list_migrations`
mostra `202610290002` e `202610290003`. Antes disso, o arquivo rodou duas vezes num Postgres 16 limpo e duas no banco de
ensaio com o rascunho.

Se a migracao mudar antes do merge (pedido da implementacao ou da revisao): aplicar de novo o arquivo inteiro (ou so a
secao que mudou) do mesmo jeito, e atualizar juntos este paragrafo e o hash da guarda.

**A 0003 da revisao (29/10/2026)**: `supabase/migrations/202610290003_webinars_v3_ajustes.sql` vem na mesma PR, depois da
0002 (as duas sao aplicadas juntas, nesta ordem; a 0002 nao muda mais). Tres secoes, pelo MCP uma por chamada (cada uma com `set lock_timeout = '5s';`)
ou o arquivo inteiro no SQL Editor (idempotente): 1 `webinar_recording_events.machine_requested_at` e a chave unica
nova (o indice novo nasce antes de o velho sair) -> 2 `webinar_sessions.browser_recording_at` e o check -> 3 a funcao
`webinar_live_offset_from_anchor` e os quatro triggers. Tambem antes do merge na `dev`: o app novo pede
`browser_recording_at` em toda leitura de sessao (sem ela, o aviso de migracao pendente aponta a 0003) e o webhook do
gravador grava `machine_requested_at`. Depois, gravar a versao:
`insert into supabase_migrations.schema_migrations (version, name) values ('202610290003', 'webinars_v3_ajustes') on
conflict (version) do nothing;`, e conferir com as consultas do cabecalho dela (a coluna, so o indice
`webinar_recording_events_machine_unique_idx`, a coluna da sessao e os 4 triggers). Conferida num Postgres 16 com a 0002
(duas vezes seguidas, e a escrita em voo esperando a ancora e gravando o offset pela ancora).

**Producao (Hetzner)**: nada manual. A promocao `dev` -> `main` e o `deploy-membros` aplicam a migracao antes de trocar o
app. Os servidores C (Jitsi) e D (gravador por hora) seguem com o ok do produtor no chat antes de qualquer criacao
(`docs/20` §8B); sem `WEBINAR_MEET_DOMAIN` e `WEBINAR_JWT_SECRET` no app, a sala ao vivo diz "em breve" e nada
quebra. Estado em 29/10/2026: o C esta no ar e atende a Vercel de teste (`deploy-meet` da `dev`, `secrets-meet`, e os dois
envs na Vercel em Production e Preview); para a producao usar a sala, o `.env` do servidor A recebe o mesmo
`WEBINAR_JWT_SECRET` por `secrets-membros` e o `ROOM_GUARD_URL` do C passa para `membros.<dominio>` (`docs/20` §8B.3).

### 9.9 Quem pode por regras: migracao `202610300001` aplicada na nuvem de teste (30/10/2026)

Os ajustes do teste da live (`docs/30` §1.1, D41 e D42) vem com `supabase/migrations/202610300001_webinars_quem_pode_regras.sql`:
1 `webinars.audience_restricts` (o modo **Quem tem o produto e esta no segmento** grava `access_mode = 'product'` + a
coluna, sem mexer no check da 202610280001) e 2 a funcao `communication_webinar_facts(p_user_ids, p_after, p_limit)`
(as lives de cada aluno para as regras "Participacao em lives" e a ancora; so `service_role`). **Antes do merge na
`dev`**: o app novo le `audience_restricts` junto das outras colunas do webinario; sem ela, as telas de webinario mostram
o aviso de migracao pendente (`WEBINARS_MIGRATION = "202610300001"`). A migracao sozinha nao atrapalha o app de antes (a
coluna tem padrao `false`; a funcao ele nao chama).

**Ambiente de teste (`hrtnqcznhdmodjikvddm`)**: aplicada em 30/10/2026 pelo MCP, uma secao por chamada com
`set lock_timeout = '5s';`. A secao 2 comeca por um bloco `do` que apaga versoes anteriores da propria funcao; como
nenhuma existia na nuvem de teste (`to_regprocedure` nulo nas duas assinaturas), rodou so o `create or replace`, o
comentario, o `revoke` e o `grant` (o bloco seria um nada a fazer). Depois:
`insert into supabase_migrations.schema_migrations (version, name) values ('202610300001', 'webinars_quem_pode_regras')
on conflict (version) do nothing;`. Conferido: `audience_restricts` boolean, nao nulo, padrao `false`; a funcao em
plpgsql, `security invoker`, retorno `TABLE(user_id uuid, registered uuid[], attended uuid[])`; `authenticated` sem
`execute` e `service_role` com; `select count(*) from public.communication_webinar_facts()` roda; o check
`webinars_access_mode_check` com os quatro modos de antes. Se a migracao mudar antes do merge, aplicar de novo a secao
que mudou do mesmo jeito.
