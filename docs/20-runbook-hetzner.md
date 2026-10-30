# 20. Runbook: Bunker707 na Hetzner (servidor proprio)

Data: 17/10/2026; atualizado em 18/10/2026. Estado em 18/10/2026: **decisao tomada de migrar agora** (docs/19, secao 0), em dois servidores (membros e marketing), executada pela IA pelo workflow do GitHub Actions (secao 4A). Nada e criado na Hetzner ate a etapa `provision` rodar com o ok do produtor no chat; a partir dela custa dinheiro. As secoes 5 a 8 dizem o que as etapas fazem e mantem o caminho manual como referencia. As secoes 4A e 8A foram acrescentadas em 18/10/2026 sem renumerar as demais.

Linguagem: o texto evita jargao; os poucos termos tecnicos estao explicados na secao 17.

---

## 1. Resumo em uma pagina

**O que e.** Dois servidores Ubuntu 24.04 na Hetzner (Alemanha), em Docker. **Servidor A, `bunker707-membros` (8 GB ou mais)**: Supabase self-hosted (Postgres 17, Auth, API, Storage, Realtime, Functions, Studio e pooler), o app Next.js da area de membros e o Caddy na frente com HTTPS automatico. **Servidor B, `bunker707-marketing` (4 GB ou mais)**: Mautic 7.2.1, MySQL 8.4.11 e o proprio Caddy (secao 8A). A Cloudflare fica na frente dos quatro nomes; so ela chega nas portas 80/443; a porta 22 fica fechada e abre so durante cada etapa do workflow, para o IP do runner. Backup diario criptografado dos dois para um Storage Box da Hetzner. Tudo operado por etapas do workflow `Infra (Hetzner)` que a IA dispara (secao 4A); nenhum passo na maquina do produtor.

**O que ja esta pronto (neste repositorio).**

| Peca | Onde | Para que |
|---|---|---|
| Imagem do app | `Dockerfile`, `.dockerignore`, `/api/health` | Next.js standalone, Node 24, usuario sem privilegio, HEALTHCHECK |
| Publicacao da imagem | `.github/workflows/build-image.yml` | a cada push na `main`, imagem em `ghcr.io/danilosouza-dev/bunker707-member-area` |
| Stack | `infra/compose/docker-compose.yml` | Supabase self-hosted (imagens pinadas) + app + Caddy, portas so em 127.0.0.1 |
| Segredos | `infra/compose/generate-secrets.sh` + `.env.example` | gera `.env` completo (JWT, chaves `sb_`, senhas, Vault, restic) |
| Borda | `infra/compose/caddy/Caddyfile` | TLS automatico, 3 hostnames, Studio so por allowlist de IP |
| Servidor | `infra/scripts/bootstrap.sh` | usuario deploy, SSH so com chave, ufw + Docker, fail2ban, atualizacoes automaticas, Docker CE, swap, CLI do Supabase |
| Firewall da Hetzner | `infra/scripts/hetzner-firewall.sh` | 22 so do produtor, 80/443 so da Cloudflare (caminho manual de 17/10; em 18/10/2026 o firewall passou a ser feito por `infra/cloud/lib.sh`, secao 4A.4) |
| Migracoes | `infra/scripts/migrate.sh` | `supabase db push --db-url` no Postgres do stack |
| Deploy | `infra/scripts/deploy.sh` | troca a imagem, migra, recria o app, smoke, volta atras |
| Backup / restore | `infra/scripts/backup.sh`, `restore.sh`, `infra/systemd/` | restic -> Storage Box (SFTP), retencao 30 dias, restauracao em servidor limpo com smoke |
| Atualizacao do stack | `infra/scripts/update.sh` | compara e reescreve as imagens com o compose oficial do Supabase |
| Teste de fumaca | `infra/scripts/smoke.sh` | app, Auth, REST, Storage, Realtime, Studio fechado |
| Servidor como codigo (opcional) | `infra/terraform/` | servidor + firewall + volume; validado, nao aplicado; substituido por `infra/cloud` em 18/10/2026 (fica como referencia) |
| Provisionamento e operacao pela nuvem (18/10/2026) | `infra/cloud/` (`run.sh`, `plan.sh`, `provision.sh`, `deploy.sh`, `secrets.sh`, `envelope.sh`, `equipe.sh`, `status.sh`, `lib.sh`, `deploy-key.mjs`, `cloud-init.yaml`) | cria servidores, firewalls, Storage Box e DNS pela API; bootstrap, deploy, segredos por envelope, equipe e status por SSH, com a porta 22 aberta so durante a etapa |
| Workflow (18/10/2026) | `.github/workflows/infra.yml` | `Infra (Hetzner)`: disparo manual por etapa, com `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` dos segredos do repositorio; uma etapa por vez |
| Mautic (18/10/2026) | `infra/mautic/` (`docker-compose.yml`, `compose.colocado.yml`, `.env.example`, `generate-secrets.sh/.mjs`, `caddy/Caddyfile`, `cron/mautic`, `scripts/{install,smoke,backup,restore}.sh`) | Mautic 7.2.1 + MySQL 8.4.11 + Caddy no servidor B; instalacao sem instalador web; cron e worker; backup proprio |

**Ensaio local feito em 17/10/2026** (Mac M-series, Docker Desktop): `docker compose up` sobe os 13 containers em cerca de 25 s, as 37 migracoes do repositorio aplicam em 3,5 s no Postgres 17, a escola de teste entra pelo gateway, a aluna de teste faz login pelo navegador e abre a home com "Minhas compras". RAM ociosa: **1,27 GiB** no total (secao 4.3).

**Custo estimado por mes** (precos de referencia de 17/10/2026, docs/19, secao 0.6; conferir no `plan`): com estoque da linha CX, CX33 (EUR 8,49) + CX23 (EUR 5,49) + 2 IPv4 (EUR 1,00) + Storage Box bx11 (EUR 3,20) = EUR 18,18. Sem estoque, CPX32 (EUR 35,49) ou CCX13 (EUR 42,99) para o servidor A e o menor tipo com 4 GB que o `plan` listar para o B. Servidor desligado continua cobrando; o jeito barato de "pausar" e snapshot + apagar.

---

## 2. Arquitetura do servidor A (app e Supabase num servidor so)

O servidor B (Mautic) tem o mesmo firewall, o mesmo bootstrap e o mesmo esquema de Caddy na frente; esta descrito na secao 8A. Nada do servidor B fala com o A: o Mautic nao acessa o Postgres do Supabase.

```txt
Aluno / produtor
  -> Cloudflare (DNS proxied, WAF, cache de estaticos)
    -> Hetzner Cloud Firewall (80/443 so da Cloudflare; 22 fechada fora das etapas)
      -> ufw do servidor (+ regras DOCKER-USER)
        -> Caddy (TLS Let's Encrypt)
             membros.bunker707.com.br  -> app:3000        (Next.js standalone)
             api.bunker707.com.br      -> api-gw:8000     (Envoy: /auth, /rest, /storage, /realtime, /functions)
             studio.bunker707.com.br   -> api-gw:8000     (so STUDIO_ALLOWED_IPS; o Envoy pede usuario e senha)
        app -> https://api.bunker707.com.br (pelo proprio servidor, extra_hosts host-gateway)
        api-gw -> auth (GoTrue) | rest (PostgREST) | storage (+ imgproxy) | realtime | functions | meta | studio
        todos -> db (Postgres 17 da imagem supabase/postgres)
        supavisor (pooler) -> db, so em 127.0.0.1:5432 / 6543
        db direto em 127.0.0.1:5433 (migrate.sh, psql, restauracao)
```

Portas publicadas no servidor:

| Porta | Quem | Interface |
|---|---|---|
| 80, 443 (tcp e udp) | Caddy | 0.0.0.0 (so Cloudflare chega, pelo firewall da Hetzner) |
| 8000 | Envoy (API e Studio com basic auth) | 127.0.0.1 |
| 5432, 6543 | Supavisor (sessao e transacao) | 127.0.0.1 |
| 5433 | Postgres direto | 127.0.0.1 |
| 22 | SSH | fechada; aberta so durante cada etapa do workflow para o IP do runner (e `PRODUCER_IP`, se informado), secao 4A.4 |

Por que o app fala com o Supabase pelo endereco publico e nao por `http://api-gw:8000`: o cookie de sessao do `@supabase/ssr` se chama `sb-<primeiro rotulo do host>-auth-token` e as URLs publicas do Storage saem do servidor; navegador e servidor precisam usar o MESMO endereco. O `extra_hosts: <host>:host-gateway` do compose faz esse nome resolver para o proprio servidor (Caddy em producao, Envoy no ensaio local), sem sair pela Cloudflare.

Chaves: o stack usa as chaves novas (`sb_publishable_` no navegador, `sb_secret_` no servidor) com tokens assinados em ES256 e JWKS em `/auth/v1/.well-known/jwks.json`; as chaves legadas (`anon`/`service_role`, HS256) continuam no `.env` so para uso interno dos servicos. Com isso o servidor usa `AUTH_SESSION_STRATEGY=claims` (validacao local do JWT no `src/proxy.ts`, sem ir ao Auth a cada pagina; as paginas protegidas ainda confirmam com `getUser`): padrao do `infra/compose/.env.example` desde 19/10/2026, depois do teste de carga (secao 12.1), em que o Auth gastava 40% de 1 vCPU com duas validacoes por pagina.

---

## 3. O que cada arquivo faz

```txt
Dockerfile                      imagem do app (3 estagios: deps, build, runner)
.dockerignore                   so o necessario para o build entra na imagem
src/app/api/health/route.ts     GET /api/health -> {ok, version}; HEALTHCHECK e monitor
.github/workflows/build-image.yml  build (PR) e publicacao (main) no ghcr.io (conferencia do build; a imagem de producao sai do deploy-membros)
.github/workflows/infra.yml     Infra (Hetzner): disparo manual de uma etapa de infra/cloud/run.sh com os tokens (18/10/2026)
infra/
  compose/
    docker-compose.yml          o stack inteiro
    .env.example                todas as variaveis, comentadas; nunca com valor real
    generate-secrets.sh/.mjs    gera o .env (modo --local ou --domain ...)
    caddy/Caddyfile             sites do Caddy
    caddy/cloudflare-trusted-proxies.caddyfile  faixas da Cloudflare (IP real do visitante)
    volumes/                    arquivos copiados do Supabase oficial (Envoy, SQL de init, pooler, functions)
    UPSTREAM.md                 de que commit do supabase/supabase os arquivos vieram
  scripts/
    bootstrap.sh                prepara o Ubuntu 24.04 (root, uma vez)
    hetzner-firewall.sh         firewall da Hetzner pela CLI hcloud (roda na sua maquina)
    cloudflare-ips.sh           faixas da Cloudflare (texto, --caddy, --json)
    migrate.sh                  supabase db push --db-url no banco do stack
    deploy.sh                   nova versao do app (imagem do ghcr.io ou build local)
    smoke.sh                    teste de fumaca
    backup.sh                   backup diario (restic -> Storage Box); --init, --check, --install-timer
    restore.sh                  restauracao em servidor limpo + smoke
    update.sh                   compara/reescreve as imagens com o compose oficial
    lib.sh                      funcoes comuns (le o .env chave a chave, espera healthcheck...)
  systemd/                      timer do backup (03:30 UTC)
  terraform/                    servidor + firewall + volume como codigo (opcional, nao aplicado; referencia)
  cloud/                        (18/10/2026) operacao pela API da Hetzner e da Cloudflare, a partir do runner
    run.sh                      ponto de entrada: bash infra/cloud/run.sh <etapa> (OPCOES, PAYLOAD, COMANDO)
    lib.sh                      hcloud (versao pinada, checksum), firewall que abre a 22 so durante a etapa, SSH, Cloudflare
    plan.sh                     tipos e precos do dia; escolhe o mais barato por papel; nao cria nada
    provision.sh                chave SSH, firewalls, servidores, Storage Box, bootstrap, transfer.key, DNS e TLS
    deploy.sh                   deploy de um papel (membros: imagem no GHCR + stack + migracoes + backup; marketing: Mautic)
    secrets.sh                  aplica um envelope cifrado no .env do papel e recria os servicos
    envelope.sh                 encrypt (na sessao) / decrypt (no servidor) de CHAVE=VALOR para a transfer.key
    equipe.sh                   contas da equipe por convite + papel em admin_roles
    status.sh                   servidores, Storage Box, DNS, respostas publicas; com SSH=1, o interior de cada servidor
    deploy-key.mjs              chave SSH Ed25519 derivada do HCLOUD_TOKEN (HKDF), formato OpenSSH
    cloud-init.yaml             primeiro boot: so o usuario deploy com a chave; o resto e o bootstrap.sh
  mautic/                       (18/10/2026) stack do Mautic (secao 8A)
    docker-compose.yml          MySQL 8.4.11, Mautic 7.2.1 (web, cron, worker) e Caddy (perfil borda)
    compose.colocado.yml        plano B: entra na rede do compose principal, sem Caddy proprio
    .env.example                variaveis comentadas; generate-secrets.sh/.mjs gera o .env
    caddy/Caddyfile             HTTPS automatico; /installer so para MAUTIC_ADMIN_IPS
    cron/mautic                 crontab versionado (segmentos, campanhas, broadcasts, importacao)
    scripts/                    _env.sh, install.sh (sem instalador web), smoke.sh, backup.sh, restore.sh
```

---

## 4. Ensaio local (obrigatorio antes de qualquer mudanca na infra)

Precisa de Docker Desktop (8 GB para o Docker ja basta), Node 24 e internet (o nome `127.0.0.1.sslip.io` resolve para 127.0.0.1 por DNS publico; e o que permite navegador e container usarem o mesmo endereco sem mexer em `/etc/hosts`).

### 4.1 Subir

```bash
sh infra/compose/generate-secrets.sh --local          # escreve infra/compose/.env (chmod 600)
docker compose -f infra/compose/docker-compose.yml up -d --build
docker compose -f infra/compose/docker-compose.yml ps  # 11 containers "healthy" (13 com o perfil studio; o Caddy nao tem healthcheck)
sh infra/scripts/migrate.sh                            # 37 migracoes via npx supabase, ~4 s
sh infra/scripts/smoke.sh
```

Enderecos do ensaio: app em `http://localhost:3080`, Supabase em `http://127.0.0.1.sslip.io:8000`, Studio em `http://127.0.0.1:8000/` (so com o perfil `studio`, secao 8.1; usuario `bunker707`, senha `DASHBOARD_PASSWORD` do `.env`).

### 4.2 Entrar com um usuario de teste

A escola de teste do docs/18 (`tests/fixtures/escola-de-teste.mjs`) entra no stack pelo gateway, com as chaves do `.env`:

```bash
ENVF=infra/compose/.env; val() { grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2-; }
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8000 \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$(val SUPABASE_PUBLISHABLE_KEY)" \
SUPABASE_SECRET_KEY="$(val SUPABASE_SECRET_KEY)" \
node --input-type=module -e '
import { createLocalAdminClient } from "./tests/support/local-db.mjs";
import { seedEscolaDeTeste } from "./tests/fixtures/escola-de-teste.mjs";
await seedEscolaDeTeste(createLocalAdminClient());'
```

Depois, em `http://localhost:3080/login`: `aluna.teste@bunker707.test` / `bunker707-teste-2026` (senha das contas de teste, so vale no stack local). Resultado esperado e obtido em 17/10: a home abre com "Minhas compras" e os tres cursos de teste; `produtor.teste@bunker707.test` cai em `/admin`.

### 4.3 Consumo medido (17/10/2026, stack ocioso, logo apos subir)

| Container | RAM |
|---|---|
| realtime | 210 MiB |
| studio | 196 MiB |
| pooler (Supavisor) | 186 MiB |
| rest (PostgREST) | 136 MiB |
| db (Postgres 17) | 121 MiB |
| storage | 99 MiB |
| meta | 98 MiB |
| app (Next.js) | 62 MiB |
| imgproxy | 42 MiB |
| envoy | 38 MiB |
| auth (GoTrue) | 30 MiB |
| edge-functions | 27 MiB |
| caddy | 26 MiB |
| **Total** | **1.271 MiB** |

Leitura: num servidor de 8 GB sobram mais de 6 GB para o Postgres crescer (shared_buffers, cache do sistema), para o app sob carga e para o build ocasional. O app em uso real tende a 150 a 300 MiB; o Postgres usa o que o sistema deixar de cache. Studio e meta (~300 MiB) ficam desligados desde 19/10/2026 (perfil `studio`, secao 8.1); o pooler (186 MiB) tambem e dispensavel se um dia faltar memoria: `docker compose stop supavisor` (o app nao depende dele).

### 4.4 Backup e restauracao em disco (ensaio)

O `.env` do modo `--local` aponta o restic para `/tmp/bunker707-restic-local`. `sh infra/scripts/backup.sh --init && sh infra/scripts/backup.sh --check` faz um backup completo em disco; `sh infra/scripts/restore.sh --snapshot latest --yes` apaga o banco local e restaura por cima, terminando no smoke. Resultado do ensaio em 17/10 na secao 10.3.

### 4.5 Derrubar

```bash
docker compose -f infra/compose/docker-compose.yml down          # mantem dados em volumes/db/data e volumes/storage
docker compose -f infra/compose/docker-compose.yml down -v && rm -rf infra/compose/volumes/db/data   # zera tudo
```

---

## 4A. Sessao na nuvem: execucao pelo GitHub Actions (18/10/2026)

### 4A.1 Por que o GitHub Actions e o braco

A sessao do Claude na nuvem nao chega na Hetzner: o proxy de saida reencripta o TLS e so deixa HTTPS para hosts de uma lista; `api.hetzner.cloud` e `api.cloudflare.com` estao fora dela e SSH nao passa. O que a sessao alcanca e a API do GitHub. Por isso o repositorio ganhou o workflow `.github/workflows/infra.yml` (nome `Infra (Hetzner)`), disparado a mao (`workflow_dispatch`), que roda `bash infra/cloud/run.sh <etapa>` num runner do GitHub com os segredos do repositorio. A IA dispara a etapa e le o log; o produtor acompanha em Actions. Nada roda em push.

O que o produtor faz uma vez so: cola `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` em Settings > Secrets and variables > Actions (permissoes exatas em docs/19, secao 8) e liga o 2FA na Hetzner. O workflow precisa existir no branch que a IA escolher (push antes do primeiro disparo).

### 4A.2 Como a IA dispara e le

- Disparo: `POST /repos/<dono>/<repositorio>/actions/workflows/infra.yml/dispatches` com `ref` (o branch) e `inputs` (`etapa`, `opcoes`, `payload`); pelo MCP do GitHub, `actions_run_trigger`.
- Leitura: lista de execucoes do workflow e log do job (`get_job_logs`). O runner mascara os segredos do repositorio; os scripts nunca imprimem valores, so nomes de chaves. O `provision` imprime a `transfer.pub` (chave publica, pode ser vista) e mascara a senha do Storage Box.
- Uma etapa por vez: o job `infra` tem `concurrency: infra-hetzner`; um segundo disparo espera o primeiro terminar (duas etapas juntas disputariam o firewall e o `.env`). A fila fica no job, e nao no workflow, para um push do arquivo do workflow nao cancelar um disparo que esta esperando. Um terceiro disparo enquanto ha um na fila substitui o da fila (regra do GitHub): disparar uma etapa por vez.
- Limite de 50 minutos por etapa (60 no job), e um passo final `Fechar o SSH (sempre)` (secao 4A.4). Permissoes so do job `infra`: `contents: read`, `packages: write` (GHCR); o workflow tem `permissions: {}`.
- Os tokens ficam so no `env` dos passos que rodam os scripts do repositorio; as actions de terceiros (checkout, setup-node, setup-buildx) sao fixadas por commit e nao os recebem. A etapa entra no script por variavel (`ETAPA`), nunca interpolada no `run:`.

Inputs do workflow:

| Input | Para que |
|---|---|
| `etapa` | uma das etapas da tabela 4A.3 |
| `opcoes` | `CHAVE=VALOR` separados por espaco, exportados para os scripts: `MEMBROS_TYPE=cx33`, `MARKETING_TYPE=cx23`, `LOCATION=nbg1`, `FALLBACK_LOCATIONS=nbg1`, `STORAGE_BOX_LOCATION=fsn1`, `PRODUCER_IP=203.0.113.10` (um IP, ou rede de no maximo /24 ou /48; outra coisa para a etapa), `SKIP_MARKETING=1` (`0`, `false` ou vazio = dois servidores), `EQUIPE=a@x.com:owner,b@y.com:admin` (virgula, porque o espaco separa as opcoes). Valor com espaco nao cabe. |
| `payload` | nas etapas `secrets-*`, o envelope cifrado (base64); nas `exec-*`, o comando a rodar no servidor como `deploy`, em `/opt/bunker707`. As demais etapas o ignoram |

Valores padrao de `infra/cloud/lib.sh`: zona `bunker707.com.br`; local `fsn1` com `nbg1` e `hel1` de reserva; servidores `bunker707-membros` e `bunker707-marketing`; Storage Box `bunker707-backups` (bx11, em `fsn1`, independente do local dos servidores); chave SSH `bunker707-deploy`; usuario `deploy`; pasta `/opt/bunker707`; nomes `membros`, `api`, `studio` e `marketing`; e-mail do produtor para Let's Encrypt e admin do Mautic (`PRODUCER_EMAIL`).

### 4A.3 As etapas, na ordem

| Etapa | O que faz (segundo o script) | Precisa |
|---|---|---|
| `plan` | `plan.sh`: lista pela API os tipos x86 com preco mensal em `fsn1`, `nbg1` e `hel1` e a disponibilidade quando a API informa; escolhe o mais barato com 8 GB ou mais para `membros` e 4 GB ou mais para `marketing` (`MEMBROS_MIN_RAM_GB`/`MARKETING_MIN_RAM_GB` mudam o minimo; `MEMBROS_TYPE` e `MARKETING_TYPE` forcam; `*_MIN_DISK_GB` exige disco minimo, usado pelo `restaurar`). Lista os tipos de Storage Box com preco e locais. Nao cria nada. | `HCLOUD_TOKEN` |
| `provision` | `provision.sh`, idempotente, em 7 passos: (1) cadastra a chave publica de deploy no projeto da Hetzner como `bunker707-deploy` (para se ja existir uma diferente); (2) roda o `plan` se nenhum tipo foi forcado; (3) para cada papel, cria o firewall `<servidor>-fw` e o servidor (Ubuntu 24.04, IPv4 + IPv6, labels `app=bunker707` e `papel=...`) com um cloud-init que so cria o usuario `deploy` com a chave; se o tipo estiver indisponivel no local, tenta `nbg1` e `hel1`; (4) cria o Storage Box `bunker707-backups` (bx11, em `STORAGE_BOX_LOCATION`) com SSH ligado, acessivel de fora, senha aleatoria (mascarada, nao guardada) e uma chave de backup derivada do token, e liga o plano de snapshots diarios do box (7 guardados; snapshot do box nao se apaga por SFTP, entao um servidor comprometido nao consegue apagar os backups do outro); (5) por SSH como root, copia e roda `infra/scripts/bootstrap.sh` em cada servidor, cria a chave RSA de transferencia (`/etc/bunker707/transfer.key` e `transfer.pub`), instala a chave de backup em `~deploy/.ssh/id_ed25519_storagebox` e imprime a `transfer.pub` em base64 no log; (6) cria ou atualiza na Cloudflare os registros `membros`, `api`, `studio` (servidor A) e `marketing` (servidor B), A e AAAA, proxied, e poe a zona em SSL Full (strict), com "Always Use HTTPS" desligado (secao 7 explica); (7) resumo. A chave privada de backup e apagada do runner ao final. | os dois tokens |
| `deploy-membros` | `deploy.sh membros`: envia o commit atual (`git archive`, sem `git clone` nem chave do GitHub no servidor) para `/opt/bunker707`, sem tocar em `.env` e volumes; na primeira vez gera `infra/compose/.env` no servidor (`generate-secrets.sh --domain membros... --api-domain api... --studio-domain studio... --studio-ips PRODUCER_IP`); grava usuario e host do Storage Box; constroi a imagem do app no runner (buildx, linux/amd64) com as `NEXT_PUBLIC_*` lidas do `.env` do servidor e publica `ghcr.io/<repositorio>:hetzner-sha-<commit>` (prefixo proprio: o `build-image.yml` publica `sha-<commit>` no mesmo pacote com as variaveis de staging); o servidor faz `docker login` no GHCR com o `GITHUB_TOKEN` efemero do job, puxa e sobe o stack (ou, se o banco ja existe, roda `infra/scripts/deploy.sh --image`), aplica as migracoes, espera os healthchecks, roda o smoke e faz `docker logout`; grava `jobs_tick_url` e `jobs_tick_token` no Vault se ainda nao existem; `backup.sh --init`, instala o timer e faz o primeiro backup. | `HCLOUD_TOKEN`, `GITHUB_TOKEN` (automatico), Buildx |
| `deploy-marketing` | `deploy.sh marketing`: envia o repositorio; na primeira vez gera `infra/mautic/.env` (`generate-secrets.sh --domain marketing... --email PRODUCER_EMAIL --admin-ips PRODUCER_IP`); grava o Storage Box; sobe o stack com o perfil `borda` (Caddy proprio); `install.sh` (instala o Mautic sem o instalador web), `smoke.sh`, `backup.sh --init`, timer e primeiro backup. Com `SKIP_MARKETING=1`, faz tudo no servidor A com `compose.colocado.yml` (secao 8A.7). | `HCLOUD_TOKEN` |
| `secrets-membros`, `secrets-marketing` | `secrets.sh`: recebe o envelope em `payload`, decifra no servidor com `/etc/bunker707/transfer.key`, grava cada `CHAVE=VALOR` no `.env` do papel (troca a linha ou acrescenta), apaga o arquivo decifrado, `docker compose up -d` (recria so o que mudou) e smoke. O log lista so os nomes das chaves. | `HCLOUD_TOKEN`, `payload` |
| `equipe` | `equipe.sh`: para cada `email:papel` em `EQUIPE` (separados por virgula; padrao: a equipe atual, um owner e um admin; e-mail e papel sao validados), procura o usuario no Auth pela API administrativa do GoTrue (gateway local; a chave secreta e lida do `.env` no proprio servidor e vai ao curl por stdin, nunca em linha de comando); quem existe mas ainda nao confirmou o e-mail recebe o convite de novo; se nao existe, manda convite (`/auth/v1/invite`, que sai pelo SMTP do Resend); grava o papel em `public.admin_roles`. Idempotente. | `HCLOUD_TOKEN` (depois do `secrets-membros`, senao o convite nao sai) |
| `status` | `status.sh`: servidores (tipo, local, IP, estado), Storage Box (uso), registros DNS de `membros`, `api`, `studio` e `marketing` e o codigo HTTP de `/api/health`, `/`, `/auth/v1/health` e `/s/login`. Nao abre SSH. | `HCLOUD_TOKEN` (DNS so com o da Cloudflare) |
| `status-ssh` | o mesmo, mais por SSH em cada servidor: commit implantado (`.deployed-commit`), containers, memoria, disco, data do ultimo backup e a `transfer.pub` em base64. | `HCLOUD_TOKEN` |
| `backup-membros`, `backup-marketing` | roda `backup.sh --check` no servidor (backup completo + `restic check` de 10% dos dados). | `HCLOUD_TOKEN` |
| `exec-membros`, `exec-marketing` | roda o comando de `payload` como `deploy` em `/opt/bunker707` (logs, `docker compose ps`, `psql`, correcoes pontuais). Nunca passar segredo no comando: ele fica no historico do workflow. | `HCLOUD_TOKEN`, `payload` |

| `snapshot` | `snapshot.sh`: desliga cada servidor, tira um snapshot (imagem do disco inteiro: banco, `.env`, certificados, chave de transferencia), espera ficar disponivel, APAGA o servidor e apaga os registros A/AAAA dos quatro nomes. Firewalls, chave SSH e Storage Box ficam (`APAGAR_STORAGE_BOX=1` apaga o box e os backups). Exige `CONFIRMAR=apagar` em `opcoes`. | `HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN` |
| `carga` | `carga.sh`: teste de carga pelo dominio publico (Cloudflare). Cria um aluno (`carga@bunker707.test`, senha derivada do token, nunca impressa) e um curso de teste (`carga-*`, 2 modulos, 6 aulas), roda o k6 (imagem fixada por digest) no runner com `VUS` alunos (padrao 100; 1 min subindo, `DURACAO` no pico, padrao 3m) abrindo home, curso, aula e minhas compras com pausa de `PAUSA_MIN` a `PAUSA_MAX` s (1 a 4), mede CPU e memoria do servidor a cada 15 s e imprime mediana, p95 e maximo por pagina. Limites: p95 abaixo de 2 s por pagina, menos de 1% de erro e nenhuma pagina caindo no login. Aluno e curso sao apagados no fim, mesmo com erro (trap). | `HCLOUD_TOKEN` |
| `chave-backup` | para cada servidor existente, deriva do `HCLOUD_TOKEN` a senha de recuperacao dos backups (`deploy-key.mjs --secret`, nunca impressa) e a cadastra como segunda chave do repositorio restic do papel (`backup.sh --add-key`); idempotente. O `deploy-*` faz o mesmo depois do `--init`. Sem o `.env` do servidor, o token abre o backup (secao 10.2). | `HCLOUD_TOKEN` |
| `fechar-ssh` | passo final de todo disparo (`if: always()`): manda TERM aos scripts orfaos de um passo cancelado (o trap deles fecha a porta) e reescreve sem a 22 as regras dos servidores anotados em `fw-abertos`. Pode ser disparada a mao; sem nada anotado, nao faz nada. | `HCLOUD_TOKEN` |
| `restaurar` | `restaurar.sh`: para cada papel sem servidor, cria um novo a partir do snapshot mais recente daquele papel (tipo do `plan`, que so considera discos do tamanho do servidor de origem ou maiores, porque um snapshot nao cabe em disco menor; ou `MEMBROS_TYPE`/`MARKETING_TYPE`), aplica o firewall, confere os containers por SSH e refaz o DNS. Tudo volta como estava, so com IP novo; nao precisa de deploy. | `HCLOUD_TOKEN`, `CLOUDFLARE_API_TOKEN` |

Ordem na migracao: `plan` -> `provision` -> `deploy-membros` -> `deploy-marketing` -> `secrets-membros` -> `secrets-marketing` -> `equipe` -> `status`. Todas sao idempotentes: rodar de novo completa o que faltou ou atualiza (um `deploy-membros` repetido e um deploy de nova versao). O `generate-secrets.sh` so roda quando o `.env` ainda nao existe: para mudar `STUDIO_ALLOWED_IPS` ou `MAUTIC_ADMIN_IPS` depois, editar o `.env` por `exec-*` e recriar o Caddy (`docker compose ... up -d caddy`).

### 4A.4 Firewall: a porta 22 so abre durante a etapa

Fora das etapas, o firewall de cada servidor (`bunker707-membros-fw`, `bunker707-marketing-fw`) so aceita 80 e 443 (TCP, e 443 UDP para HTTP/3) das faixas da Cloudflare (`infra/scripts/cloudflare-ips.sh`) e ICMP; a porta 22 nao esta em regra alguma, ou so para `PRODUCER_IP` se ele foi informado em `opcoes`. Cada etapa que precisa de SSH descobre o IP de saida do runner (`checkip.amazonaws.com`), reescreve as regras com a 22 aberta para esse IP (e `PRODUCER_IP`), trabalha e, ao terminar, mesmo com erro, reescreve de novo sem ele (`trap EXIT` em `lib.sh`, armado antes de abrir). Se o fechamento falhar, a etapa termina com erro (nunca verde com a 22 aberta). Cancelamento ou timeout nao rodam o trap (o runner so sinaliza o shell do passo, e o script fica orfao ate ser morto): por isso cada servidor aberto e anotado em `$RUNNER_TEMP/bunker707-cloud/fw-abertos`, e o passo final `Fechar o SSH (sempre)` (`if: always()`) manda TERM aos orfaos e roda `run.sh fechar-ssh`. Mesmo aberta, a 22 so aceita chave, e so para o IP do runner.

Dentro do servidor continuam o ufw, o fail2ban e o SSH so por chave do bootstrap (secao 6).

### 4A.5 Chave de deploy derivada do token

`infra/cloud/deploy-key.mjs` deriva uma chave Ed25519 do `HCLOUD_TOKEN` (HKDF-SHA256, sal `bunker707-deploy-key-v1`), escreve no formato OpenSSH (`chmod 600`) e imprime so a impressao digital. A mesma chave nasce igual em todo runner enquanto o token for o mesmo. Nao ha segredo novo para guardar: quem tem o token ja controla o servidor pela API (console, reinstalacao, apagar). O `provision` cadastra a publica no projeto da Hetzner, o cloud-init a coloca em `~deploy/.ssh/authorized_keys` e o bootstrap a repete.

**Se o token for trocado** (vazou, ou foi apagado na Hetzner), a chave muda e os servidores deixam de aceitar o runner. Ordem certa, antes de trocar o segredo no GitHub:

1. Criar o token novo na Hetzner sem apagar o antigo.
2. Derivar a chave publica nova em qualquer maquina com Node (a chave publica nao e segredo; a privada fica no `--out` e pode ser apagada em seguida):
   ```bash
   HCLOUD_TOKEN='<token novo>' node infra/cloud/deploy-key.mjs --out /tmp/nova --print-public
   ```
3. Ainda com o token antigo no segredo `HCLOUD_TOKEN`, rodar `exec-membros` e depois `exec-marketing` com este `payload` (a linha inteira impressa no passo 2):
   ```bash
   echo 'ssh-ed25519 AAAA...nova... bunker707-deploy' >> ~/.ssh/authorized_keys
   ```
4. Na Hetzner (console > Security > SSH keys), apagar a chave `bunker707-deploy` antiga: o `provision` recusa continuar se a chave cadastrada com esse nome for diferente da derivada do token atual.
5. Trocar `HCLOUD_TOKEN` no GitHub, rodar `provision` (recadastra a chave; servidores, Storage Box e DNS ja existem, ele so confere) e `status-ssh`.
6. Apagar o token antigo na Hetzner e, por `exec-*`, tirar a linha antiga do `authorized_keys`: `sed -i '/<trecho unico da chave antiga>/d' ~/.ssh/authorized_keys`.

Sem o passo 3, o jeito de voltar e pelo console da Hetzner (acesso de emergencia), o que o produtor faria a mao.

### 4A.6 Segredos externos: o envelope

Chave de envio do Resend, segredo do webhook e, mais tarde, credenciais do SES nunca entram em texto em `opcoes` nem em `payload` aberto. O caminho:

1. Pegar a `transfer.pub` do servidor certo (base64 numa linha): esta no log do `provision` (passo 5) e do `status-ssh`. Cada servidor tem a sua; a chave privada (`/etc/bunker707/transfer.key`, RSA 4096) nunca sai do servidor.
2. Escrever um arquivo `CHAVE=VALOR` (uma por linha) na sessao da IA, fora do repositorio. Para o servidor A: `SMTP_PASS=re_...`, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY=re_...`, `RESEND_WEBHOOK_SECRET=whsec_...`. Para o B: `MAUTIC_MAILER_DSN=smtp://resend:re_...@smtp.resend.com:587`.
3. Cifrar: `bash infra/cloud/envelope.sh encrypt '<transfer.pub em base64>' segredos.txt` imprime o payload (base64). Por dentro: uma chave AES de 32 bytes aleatoria, cifrada com RSA-OAEP (SHA-256) para a `transfer.pub`, e o arquivo em AES-256-CBC (PBKDF2, 200 mil iteracoes) com essa chave; o payload e `base64(chave cifrada).base64(arquivo cifrado)` numa linha, perto de 900 caracteres (ate 19/10/2026 era um tar em base64 de 13 mil caracteres, quase todo de zeros, arriscado de copiar para o input do workflow). So a `transfer.key` abre; o payload pode aparecer no log sem risco.
4. Disparar `secrets-membros` (ou `secrets-marketing`) com o payload. Apagar `segredos.txt`. O log mostra o tamanho e o sha256 do payload recebido (conferir com o local: `tr -d '[:space:]' < payload | sha256sum`), e a etapa leva ao servidor o `envelope.sh` do proprio commit, entao o formato sempre bate.

Como a chave do Resend chega a sessao da IA sem passar pelo chat, a combinar com o produtor: (a) a IA cria uma chave nova de envio no Resend pelo conector (permissao so de envio, restrita a `mail.bunker707.com.br`); o valor existe so na sessao e vai direto para o envelope; ou (b) o produtor coloca a chave como segredo do ambiente da sessao na nuvem e a IA le a variavel. Nunca no chat, nunca no repositorio, nunca em `opcoes`.

### 4A.7 Guardar a producao sem pagar servidor parado (snapshot)

Decisao de 18/10/2026: a Vercel + Supabase cloud continuam como ambiente de desenvolvimento (staging) e a Hetzner e a producao, mas a producao so fica ligada quando o produtor disser "vai". Na Hetzner, servidor desligado e cobrado por inteiro (docs/19, secao 3.4); o jeito barato de guardar e snapshot + apagar: EUR 0,0143 por GB comprimido por mes (uns 10 GB usados dao cerca de EUR 0,15). O roteiro:

1. Migracao completa como ensaio real: `plan`, `provision`, `deploy-membros`, `deploy-marketing`, `secrets-*`, `equipe`, `status`. A cobranca e por hora: algumas horas de CX33 + CX23 custam centavos.
2. `snapshot` com `CONFIRMAR=apagar`: os dois servidores viram imagens (labels `app=bunker707`, `papel=membros|marketing`) e sao apagados; os registros DNS somem (os nomes param de responder). A Storage Box fica por padrao (EUR 3,20 por mes, com os backups); `APAGAR_STORAGE_BOX=1` apaga tudo e o custo mensal vira so os snapshots.
3. Quando for a hora: `restaurar` (servidores novos a partir dos snapshots, DNS refeito) e `status`. Os certificados do Caddy, o banco, o `.env` e a chave de transferencia vem no snapshot. Se o snapshot tiver mais de alguns dias, rodar `deploy-membros` e `deploy-marketing` em seguida para subir o commit atual.

Sem snapshot (por exemplo, se a producao ainda nao tiver nada de valor), o caminho equivalente e `provision` + `deploy-*` do zero, que leva uns 20 minutos.

---

## 5. Criar os servidores (etapa `provision`; atualizado em 18/10/2026)

Nada abaixo acontece sem o ok no chat. Custa dinheiro a partir do minuto em que o servidor existe.

Em 18/10/2026 este passo deixou de ser manual: a etapa `provision` (secao 4A.3) faz tudo, idempotente. O que ela cria, com os padroes de `infra/cloud/lib.sh`:

| Recurso | Valor |
|---|---|
| Servidor A | `bunker707-membros`, tipo escolhido pelo `plan` (8 GB ou mais; `MEMBROS_TYPE` forca), Ubuntu 24.04, `fsn1` (cai para `nbg1`, `hel1`), IPv4 + IPv6, labels `app=bunker707` e `papel=membros` |
| Servidor B | `bunker707-marketing`, 4 GB ou mais (`MARKETING_TYPE`), idem, `papel=marketing`; nao existe com `SKIP_MARKETING=1` |
| Chave SSH no projeto | `bunker707-deploy`, derivada do token (secao 4A.5) |
| Firewalls | `bunker707-membros-fw` e `bunker707-marketing-fw` (secao 4A.4) |
| Storage Box | `bunker707-backups`, bx11 (1 TB), SSH ligado, acessivel de fora, chave de backup instalada nos dois servidores |
| Bootstrap | `infra/scripts/bootstrap.sh` por SSH em cada servidor (secao 6) e a chave de transferencia `/etc/bunker707/transfer.key` |
| DNS e TLS | secao 7 |

Sem backups automaticos da Hetzner (20% a mais; o backup e o nosso). Antes do `provision`: o produtor ligou o 2FA na Hetzner e colou `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` nos segredos do repositorio (docs/19, secao 8). A IA roda `plan` primeiro e mostra no chat os tipos e precos do dia; o `provision` so e disparado com o ok.

Caminho manual de 17/10/2026 (referencia, se o workflow nao estiver disponivel):

1. **Conta e projeto** na Hetzner Cloud (conta criada em 17/10; ative o 2FA antes de criar qualquer coisa).
2. **Chave SSH**: no Mac do produtor, `ssh-keygen -t ed25519 -C "produtor@bunker707"`; cadastre a `.pub` no projeto (Security > SSH keys).
3. **Token da API** (Security > API tokens, leitura e escrita), so se for usar a CLI `hcloud` ou o Terraform. Guarde no gerenciador de senhas; nunca no repositorio.
4. **Servidor**: Ubuntu 24.04, local `fsn1` (Falkenstein) ou `nbg1`, tipo `cx33` (4 vCPU, 8 GB) se houver estoque; senao `cpx32` (AMD, 8 GB) ou `ccx13` (dedicado, 8 GB). IPv4 + IPv6. Nome `bunker707-prod`. Sem backups da Hetzner (20% a mais; o backup e o nosso). Cloud-init opcional: o `infra/terraform/cloud-init.yaml.tftpl` so cria o usuario `deploy`.
   - Pelo painel: Servers > Add Server.
   - Ou pelo Terraform: `cd infra/terraform && cp terraform.tfvars.example terraform.tfvars` (token, chave, IP) e `terraform init && terraform plan`; `apply` so com o ok.
5. **Firewall da Hetzner** (antes do primeiro boot, se pelo painel; o Terraform ja aplica): na sua maquina, com `brew install hcloud` e `export HCLOUD_TOKEN=...`:
   ```bash
   sh infra/scripts/hetzner-firewall.sh --server bunker707-prod --admin-ip auto
   ```
   Regras: TCP 22 so do seu IP; TCP 80 e 443 so das faixas da Cloudflare; ICMP liberado. Quando o seu IP mudar (internet residencial muda), rode de novo. `--dry-run` mostra as regras sem aplicar.
6. **Storage Box** (Storage Boxes > Order, BX11 = 1 TB) para os backups. Anote usuario `uNNNNNN` e host `uNNNNNN.your-storagebox.de`; ative SSH/SFTP nas configuracoes do box.

---

## 6. Preparar o servidor (bootstrap)

Em 18/10/2026: o `provision` copia e roda este script por SSH como root em cada um dos dois servidores (`SSH_PUBLIC_KEY` = chave de deploy derivada, `DEPLOY_USER=deploy`, `REPO_DIR=/opt/bunker707`), logo depois do primeiro boot. O texto abaixo vale para rodar a mao.

Primeiro acesso como root (a Hetzner manda a senha por e-mail se nao houver chave; com chave, entra direto):

```bash
scp infra/scripts/bootstrap.sh root@<ip>:/root/
ssh root@<ip> 'SSH_PUBLIC_KEY="ssh-ed25519 AAAA... produtor@bunker707" bash /root/bootstrap.sh'
```

O script e idempotente (pode rodar de novo). Ele cria o usuario `deploy` (sudo sem senha, grupo docker), fecha o SSH para senha, liga ufw (so 22, 80 e 443; sem rate limit na 22 desde 18/10/2026, porque o firewall da Hetzner ja restringe a origem e o deploy abre dezenas de comandos SSH em sequencia) com as regras `DOCKER-USER` para o Docker respeitar o ufw, fail2ban no sshd, atualizacoes automaticas (reinicio as 05:30 UTC se um kernel pedir), Docker CE com rotacao de logs, swap de 2 GB, a CLI do Supabase 2.121.0 e a pasta `/opt/bunker707`.

**Antes de fechar a sessao de root**, confirme em outro terminal que `ssh deploy@<ip>` entra. Depois disso, trabalhe sempre como `deploy`.

---

## 7. DNS e Cloudflare

A zona `bunker707.com.br` ja esta na Cloudflare (servidores de nome `tadeo` e `vera.ns.cloudflare.com`; o Registro.br so guarda o nome; docs/19, secao 2.1). Em 18/10/2026 os registros passaram a ser criados pela etapa `provision` (passo 6) com `CLOUDFLARE_API_TOKEN`:

| Registro | Tipo | Valor | Proxy |
|---|---|---|---|
| `membros` | A / AAAA | IPv4 / IPv6 do servidor A | laranja (proxied) |
| `api` | A / AAAA | idem | laranja |
| `studio` | A / AAAA | idem | laranja |
| `marketing` | A / AAAA | IPv4 / IPv6 do servidor B (ou do A, com `SKIP_MARKETING=1`) | laranja |

O `provision` tambem poe a zona em SSL/TLS Full (strict) e deixa "Always Use HTTPS" DESLIGADO (`PATCH /zones/<id>/settings/ssl` e `.../always_use_https`): o Let's Encrypt valida o dominio por HTTP (porta 80) passando pela Cloudflare, e um redirecionamento na borda para HTTPS faria a validacao bater num origin ainda sem certificado (erro 526). O Caddy redireciona HTTP para HTTPS no origin e o app manda HSTS; para o visitante o resultado e o mesmo. Registro que ja existe com o mesmo valor fica como esta; com valor diferente e atualizado (TTL automatico). Os registros do Resend em `mail.` nao sao tocados. `status` lista os quatro registros.

Configuracao da zona: SSL/TLS em **Full (strict)** (o Caddy tem certificado valido do Let's Encrypt); "Always Use HTTPS" desligado desde 18/10/2026 (motivo acima; em 17/10 estava previsto ligado); HSTS pode ficar desligado na Cloudflare (o app ja manda). O desafio HTTP-01 do Let's Encrypt passa pela Cloudflare em modo proxied; se a emissao falhar na primeira vez, coloque os tres registros em "DNS only" por alguns minutos, deixe o Caddy emitir (`docker compose logs caddy`) e volte para proxied. Alternativa sem Let's Encrypt: certificado Origin CA da Cloudflare montado no Caddy (`tls /certs/origin.pem /certs/origin.key` no site), valido 15 anos.

**Studio**: o Caddy so aceita os IPs de `STUDIO_ALLOWED_IPS` e o Envoy ainda pede usuario e senha (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). Se o produtor nao tiver IP fixo, duas alternativas: (a) Cloudflare WARP com "Gateway" e um IP de saida dedicado (pago) na allowlist; (b) Cloudflare Access (Zero Trust, gratis ate 50 usuarios) na frente de `studio.`, com login por e-mail, e um Cloudflare Tunnel em vez de abrir a porta: nesse caso o site `studio` sai do Caddy e o `cloudflared` roda como mais um container apontando para `api-gw:8000`. A opcao (b) e a mais segura e nao depende de IP.

Realtime usa websocket (`wss://api.../realtime/v1/websocket`): a Cloudflare repassa websockets por padrao.

---

## 8. Primeiro deploy

Em 18/10/2026: a etapa `deploy-membros` (secao 4A.3) faz os passos 1 a 5 abaixo, com duas diferencas: sem `git clone` (o runner envia o commit por `git archive`) e sem token classico do GitHub (o servidor usa o `GITHUB_TOKEN` do job e faz logout ao final). Ela tambem grava o tick de jobs no Vault. O que fica para outras etapas: a chave do Resend (`secrets-membros`) e as contas da equipe (`equipe`, por convite). O texto abaixo vale para fazer a mao.

Como `deploy`, no servidor:

```bash
# 1. codigo (chave de deploy somente leitura no GitHub: Settings > Deploy keys do repositorio)
git clone git@github.com:danilosouza-dev/bunker707-member-area.git /opt/bunker707
cd /opt/bunker707 && git checkout main

# 2. segredos e enderecos
sh infra/compose/generate-secrets.sh --domain membros.bunker707.com.br --api-domain api.bunker707.com.br \
    --studio-domain studio.bunker707.com.br --email voce@bunker707.com.br --studio-ips "SEU.IP.AQUI/32"
# preencha a mao no infra/compose/.env: SMTP_PASS (chave de envio do Resend), STORAGE_BOX_USER/HOST,
# APP_IMAGE (ghcr.io/danilosouza-dev/bunker707-member-area:sha-xxxxxxx), e os opcionais (PostHog, Sentry,
# EMAIL_PROVIDER/RESEND_*, gateway de IA). Guarde RESTIC_PASSWORD fora do servidor.

# 3. imagem do app (repositorio privado: token classico do GitHub com read:packages)
echo "<token>" | docker login ghcr.io -u danilosouza-dev --password-stdin

# 4. subir e migrar
docker compose -f infra/compose/docker-compose.yml pull
docker compose -f infra/compose/docker-compose.yml up -d
docker compose -f infra/compose/docker-compose.yml ps        # tudo healthy (Studio e meta so com o perfil studio, 8.1)
sh infra/scripts/migrate.sh
sh infra/scripts/smoke.sh

# 5. backup
sh infra/scripts/backup.sh --init        # chave SSH + alias storagebox + repositorio restic
sudo sh infra/scripts/backup.sh --install-timer
sudo systemctl start bunker707-backup.service && sudo journalctl -u bunker707-backup -n 30
```

Passos que o compose nao faz:

- **Tick dos jobs** (pg_cron chama o app a cada minuto; migracao `202610100001`): no Studio (SQL Editor) ou por `psql`:
  ```sql
  select vault.create_secret('http://app:3000/api/jobs/tick', 'jobs_tick_url', 'URL do tick');
  select vault.create_secret('<JOBS_TICK_TOKEN do .env>', 'jobs_tick_token', 'Token do tick');
  ```
  `http://app:3000` funciona porque o Postgres e o app estao na mesma rede do compose. Conferir: `select * from public.job_runs order by started_at desc limit 5;`.
- **Primeira conta da equipe** (em 18/10/2026: etapa `equipe`, por convite): criar o usuario no Studio (Authentication > Users > Add user, com senha) e inserir o papel em `public.admin_roles` (`insert into public.admin_roles (user_id, role) values ('<uuid>', 'owner')`), como no projeto da nuvem; depois os demais entram pelo admin > Equipe.
- **E-mail** (em 18/10/2026: a chave chega pela etapa `secrets-membros`): o Auth (convites, recuperacao de senha) sai pelo SMTP do Resend (`smtp.resend.com:587`, usuario `resend`, senha = chave de envio); o remetente `SMTP_ADMIN_EMAIL` precisa ser do dominio verificado (`mail.bunker707.com.br`). O e-mail transacional do app (PR #80) usa a API do Resend com `EMAIL_PROVIDER=resend`.
- **Modelos de e-mail do Auth em portugues** (18/10/2026): os seis HTML de docs/19, secao 2.4, estao em `infra/compose/volumes/auth-templates/`; o Caddy os serve em `https://api.bunker707.com.br/auth-templates/*.html` e o compose aponta o Auth para eles (`GOTRUE_MAILER_TEMPLATES_*`), com os assuntos em `GOTRUE_MAILER_SUBJECTS_*` (padrao do compose; `AUTH_SUBJECT_*` no `.env` para mudar). O Auth baixa o modelo pela URL na hora de enviar (o nome publico resolve para o proprio servidor, por `extra_hosts`); se nao conseguir, usa o texto padrao dele, em ingles. O remetente do Auth (`SMTP_ADMIN_EMAIL`) e o mesmo do app, `equipe@mail.bunker707.com.br`.
- **E-mail transacional do app**: `EMAIL_FROM`, `EMAIL_REPLY_TO` e `EMAIL_DAILY_LIMIT` passam pelo compose (vazios = `Bunker707 <equipe@mail.bunker707.com.br>`, `contato@bunker707.com.br` e 90 por dia).
- **Rotas de callback**: `ADDITIONAL_REDIRECT_URLS` ja aponta para `https://membros.../auth/callback`; se houver login com Google, cadastrar `https://api.bunker707.com.br/auth/v1/callback` no console do Google e as variaveis `GOTRUE_EXTERNAL_GOOGLE_*` no compose (comentadas no compose oficial).

Como entrar no Postgres no servidor: `docker compose -f infra/compose/docker-compose.yml exec db psql -U postgres` (ou pelo pooler em `127.0.0.1:5432` com usuario `postgres.bunker707`). De fora, so por tunel: `ssh -L 5433:127.0.0.1:5433 deploy@<ip>` e `psql postgresql://postgres:<senha>@127.0.0.1:5433/postgres`.

### 8.1 Studio (painel do banco): desligado, ligar so quando precisar (19/10/2026)

Studio e meta (o servico que le o catalogo do banco para o Studio) ficam no perfil `studio` do compose e nao sobem com `docker compose up -d` nem com o `deploy-membros`. Motivo, medido no teste de carga de 19/10/2026 (secao 12.1): os dois somavam cerca de 35% de 1 vCPU e 300 MiB sem ninguem usar o painel (os healthchecks do compose e do Envoy os acordam a cada 5 s). O app nao depende deles; o gateway sobe sem eles (sem o Studio, `/` e `/pg` do Envoy respondem 503), e o host `studio` continua barrado pelo Caddy para quem esta fora de `STUDIO_ALLOWED_IPS`.

Ligar (etapa `exec-membros` com este `payload`, ou por SSH em `/opt/bunker707`):

```sh
COMPOSE_PROFILES=studio docker compose -f infra/compose/docker-compose.yml up -d studio meta
```

Abrir `https://studio.bunker707.com.br` da maquina cujo IP esta em `STUDIO_ALLOWED_IPS` (o `deploy-membros` grava o `PRODUCER_IP` de `opcoes`), usuario `bunker707` e `DASHBOARD_PASSWORD` do `.env`. Para SQL pontual nao precisa do Studio: `exec-membros` com `docker compose -f infra/compose/docker-compose.yml exec -T db psql -U postgres -c "..."`. Desligar ao terminar (um deploy nao desliga o Studio ligado):

```sh
COMPOSE_PROFILES=studio docker compose -f infra/compose/docker-compose.yml rm -sf studio meta
```

No ensaio local, o mesmo `COMPOSE_PROFILES=studio` antes do `up -d`.

---

## 8A. Mautic (servidor de marketing, 18/10/2026)

### 8A.1 Stack (`infra/mautic/docker-compose.yml`, projeto `bunker707-mautic`)

| Container | Imagem | Papel |
|---|---|---|
| `bunker707-mautic-db` | `mysql:8.4.11` | banco proprio do Mautic (utf8mb4, buffer pool de 256 MB, `performance_schema` desligado, healthcheck); sem porta publicada |
| `bunker707-mautic` | `mautic/mautic:7.2.1-apache` | interface web e API (`DOCKER_MAUTIC_ROLE=mautic_web`); so o Caddy chega nele, em `mautic:80` |
| `bunker707-mautic-cron` | a mesma | tarefas agendadas (`mautic_cron`), com o crontab versionado em `infra/mautic/cron/mautic` |
| `bunker707-mautic-worker` | a mesma | consumidores das filas de e-mail, hits e falhas (`mautic_worker`; `MAUTIC_WORKERS` processos por fila, padrao 1) |
| `bunker707-mautic-caddy` | `caddy:2.11.7-alpine`, perfil `borda` | HTTPS automatico em `marketing.bunker707.com.br`; unica porta publica (80 e 443, TCP e UDP); IP real do visitante via `CF-Connecting-IP` |

Volumes em `infra/mautic/volumes/` (ignorados pelo git): `config/` (o `local.php`), `logs/`, `media/files`, `media/images`; o MySQL num volume nomeado (`mautic-db-data`; nunca `docker compose down -v`). As filas de envio, de hits e de falhas ficam no proprio MySQL, separadas (`MAUTIC_MESSENGER_DSN_EMAIL`, `_HIT` e `_FAILED` = `doctrine://default?queue_name=email|hit|failed`); sem a de falhas, o Mautic descartaria o e-mail que esgota as tentativas. MySQL sem binlog (`--disable-log-bin`: sem replica nem PITR, e o binlog de 30 dias encheria o disco de 40 GB).

Configuracao sem mexer em PHP: `MAUTIC_CONFIG_PARAMETERS` e um JSON que o Mautic mescla por cima do `config/local.php` (ParameterLoader oficial). Hoje leva `site_url`, `mailer_dsn`, `mailer_from_email`, `mailer_from_name`, `trusted_proxies` (a rede do compose, para o Mautic ler o IP real em `X-Forwarded-For` e o `https` em `X-Forwarded-Proto`) e `default_timezone` (`America/Sao_Paulo`; dados em UTC). Excecao verificada no codigo do 7.2.1: o `TrustMiddleware` le `trusted_proxies` so de `config/local.php` e `config/parameters_local.php`, nao deste JSON; por isso o `install.sh` grava `config/parameters_local.php` com o valor do JSON a cada execucao (sem ele, formularios sairiam com `action` em `http://`). Memoria do PHP por processo: `MAUTIC_PHP_MEMORY_LIMIT` (512M).

### 8A.2 Instalacao sem o instalador web

O instalador web do Mautic (`/installer`) aceita o primeiro visitante como administrador. Por isso o Caddy responde 403 nele fora de `MAUTIC_ADMIN_IPS` (padrao `127.0.0.1/32`, isto e, ninguem de fora) e `infra/mautic/scripts/install.sh` instala por linha de comando: espera os healthchecks, roda `php bin/console mautic:install --force --no-interaction ...` como `www-data` em `/var/www/html` (a imagem trabalha em `docroot`, onde nao ha `bin/console`) (banco, `site_url` e conta do administrador vindos do `.env`), limpa o cache e confere que `config/local.php` ficou com banco e `site_url`. Idempotente: se ja esta instalado, nao faz nada. O `deploy-marketing` chama este script; cron e worker esperam a instalacao e destravam sozinhos.

Conta do administrador: usuario `bunker707` (`MAUTIC_ADMIN_USERNAME`), e-mail `PRODUCER_EMAIL`, senha gerada em `MAUTIC_ADMIN_PASSWORD` no `infra/mautic/.env` do servidor (`chmod 600`, dono `deploy`). Nao ler a senha por `exec-marketing`: o valor apareceria no log do workflow. Depois do `secrets-marketing`, o produtor usa "Esqueci a senha" em `https://marketing.bunker707.com.br/s/login` com o e-mail do administrador (o link chega pelo Resend) e define a propria senha; ela passa a valer no lugar da gerada.

### 8A.3 E-mail: Resend agora, SES depois

`MAUTIC_MAILER_DSN` (DSN do Symfony Mailer) no `infra/mautic/.env`, entregue pela etapa `secrets-marketing` (envelope, secao 4A.6):

| Quando | DSN |
|---|---|
| Hoje: Resend, porta 587 (a Hetzner bloqueia 25 e 465 de saida) | `smtp://resend:<chave de envio do Resend>@smtp.resend.com:587` |
| Depois: Amazon SES, credenciais SMTP do SES em `sa-east-1` (senha codificada para URL) | `smtp://<SMTP_USER>:<SMTP_PASS>@email-smtp.sa-east-1.amazonaws.com:587` |
| Ensaio local, ou ate a chave chegar | `null://null` (nao envia nada) |

Remetente: `MAUTIC_MAILER_FROM_EMAIL=equipe@mail.bunker707.com.br` (dominio verificado no Resend), nome `Bunker707`. Trocar de provedor e trocar a linha e recriar `mautic`, `mautic-cron` e `mautic-worker` (`docker compose ... up -d` faz isso; a etapa `secrets-marketing` tambem). Limite do Resend Free: 100 e-mails por dia somando Auth, app e Mautic; campanha de verdade so com Resend Pro ou SES (docs/19, secao 0.8).

### 8A.4 Cron e worker

Crontab em `infra/mautic/cron/mautic` (montado em `/opt/mautic/cron`; a imagem usa este arquivo no lugar do modelo dela), usuario `www-data` no container `mautic-cron`:

| Comando | Quando |
|---|---|
| `mautic:segments:update` | a cada 15 min (minutos 0, 15, 30, 45) |
| `mautic:campaigns:update` | a cada 15 min, 5 min depois dos segmentos |
| `mautic:campaigns:trigger` | a cada 15 min, 10 min depois dos segmentos |
| `mautic:broadcasts:send` | a cada 5 min (o envio em si sai pelo worker) |
| `mautic:import` | a cada 3 min |

Desligados (comentados no arquivo): webhooks de saida, caixa IMAP de bounces (Resend e SES avisam por webhook), GeoLite2 e limpeza de dados antigos. Mudou o arquivo: `docker compose -f infra/mautic/docker-compose.yml restart mautic-cron`.

O worker consome tres filas (e-mail, hits, falhas) com 1 processo cada; `MAUTIC_WORKERS` no `.env` sobe o numero quando o volume de envio crescer.

### 8A.5 Backup e restauracao

`infra/mautic/scripts/backup.sh` (timer `bunker707-mautic-backup`, 03:50 UTC, usuario `deploy`): `mysqldump --single-transaction` do banco inteiro (gz), o `.env`, `volumes/config` e `volumes/media`, pelo restic para `sftp:storagebox:bunker707/restic-mautic` (mesmo Storage Box e mesma chave SSH do servidor A, repositorio separado), retencao de 30 dias, dois ultimos exports em `/var/backups/bunker707-mautic/stage`, `--check` le 10% dos dados, heartbeat opcional (`BACKUP_HEARTBEAT_URL`). A etapa `backup-marketing` roda `--check`.

`infra/mautic/scripts/restore.sh --snapshot latest [--yes]`: baixa o snapshot, poe o `.env` no lugar, copia `config/` e `media/`, sobe so o MySQL, importa o dump (recusa sobrescrever um volume existente sem `--yes`), confere o numero de tabelas, sobe o resto e roda o smoke. Precisa de `RESTIC_REPOSITORY` e `RESTIC_PASSWORD` (do gerenciador de senhas) quando o `.env` nao existe.

`infra/mautic/scripts/smoke.sh`: `/s/login` 200, `/mtc.js` 200, `/installer` fechado (403, 302 ou 404), `mautic-db` e `mautic` healthy, cron e worker rodando. Os scripts usam `infra/scripts/lib.sh` apontado para o compose do Mautic (`infra/mautic/scripts/_env.sh`).

### 8A.6 Memoria

Num servidor de 4 GB: MySQL com buffer pool de 256 MB e `performance_schema` desligado, PHP com limite de 512 MB por processo, 1 processo por fila no worker, Apache e Caddy. Se faltar memoria, manter `MAUTIC_WORKERS=1` e `MAUTIC_PHP_MEMORY_LIMIT=512M` e fazer rescale do servidor; nao desligar o worker (sem ele nenhum e-mail sai).

### 8A.7 Plano B: Mautic no servidor A (colocacao)

`SKIP_MARKETING=1` em `opcoes` de todas as etapas: `plan` e `provision` nao criam o servidor B e apontam `marketing` para o A; `deploy-marketing` sobe o stack com `-f infra/mautic/compose.colocado.yml` (entra na rede `bunker707_default` do compose principal, sem Caddy proprio) e grava `MAUTIC_SITE_ADDRESS` no `infra/compose/.env`, para o Caddy principal atender `marketing.bunker707.com.br` em `mautic:80` (`/installer` restrito a `STUDIO_ALLOWED_IPS`). Nos scripts, `BUNKER707_COMPOSE_OVERRIDE=infra/mautic/compose.colocado.yml`. Num servidor de 8 GB fica apertado (docs/19, secao 5, pede 16 GB com Mautic): so se faltar estoque de um segundo tipo, e com `MEMBROS_TYPE` maior.

### 8A.8 Ensaio local

```bash
sh infra/mautic/generate-secrets.sh --local
docker compose -f infra/mautic/docker-compose.yml --profile borda up -d
sh infra/mautic/scripts/install.sh
sh infra/mautic/scripts/smoke.sh      # http://mautic.127.0.0.1.sslip.io:3080/s/login, usuario bunker707
```

Em 18/10/2026 o ensaio com Docker nao foi feito (a sessao nao tem daemon Docker); `docker compose config` dos tres composes e a validacao do Caddyfile passaram. O primeiro `docker compose up` de verdade sera o do `deploy-marketing`.

---

## 8B. Webinarios: servidor C do Jitsi e o gravador por hora (servidor D) (29/10/2026)

O desenho esta no `docs/30` §6 e §7; aqui fica so a operacao. **Estado em 29/10/2026**: o C existe (`provision-meet`
com o ok do produtor no chat: `bunker707-meet`, cx23 em fsn1, EUR 6,49/mes sem IVA pela API, 2.31.106.201,
`meet.bunker707.com.br` so DNS). Em seguida, no mesmo dia: `deploy-meet` da `dev` com
`APP_DOMAIN=bunker707-member-area.vercel.app` (o `ROOM_GUARD_URL` do C aponta para a Vercel de teste, §8B.3),
`secrets-meet` com o `JWT_APP_SECRET`, e na Vercel `WEBINAR_MEET_DOMAIN` e `WEBINAR_JWT_SECRET` (Production e Preview).
O primeiro `deploy-meet` subiu o stack mas parou no healthcheck do jicofo (`/about/health` 404 sem
`JICOFO_ENABLE_HEALTH_CHECKS`; corrigido no compose, §8B.3). O D (gravador) so existe durante cada live e cada criacao
espera o pedido da equipe. O app ja funciona sem os dois servidores (a Live gravada e o Replay nao dependem do Jitsi).
**Estado em 30/10/2026**: os webinarios estao em producao (promocao #142, imagem `hetzner-sha-e15f6d4`). O app do A
recebeu os `WEBINAR_*` por `secrets-membros` (o mesmo `WEBINAR_JWT_SECRET` do C e da Vercel) e o compose os repassa
(#141). O C passou a atender a producao: `ROOM_GUARD_URL` em `membros.<dominio>` e `MEET_FRAME_ANCESTORS` com as duas
origens (`exec-meet` + `deploy-meet` da `main` com `SEM_LIVE_2H=sim`). Os banimentos da Vercel de teste deixam de
barrar na sala (o token de 15 min continua valendo). Gravacao automatica (D) ainda sem `JIBRI_SECRETS` e sem
`GITHUB_INFRA_TOKEN`: o console oferece a reserva (Gravar no navegador ou Enviar gravacao).

### 8B.1 O que e cada servidor e quanto custa

| Servidor | Papel | Tipo | Cobranca |
|---|---|---|---|
| C, `bunker707-meet` | a Live ao vivo: Jitsi proprio (web, prosody, jicofo, jvb) atras do Caddy, em `meet.<dominio>` | cx23 (`MEET_TYPE`) | mensal, a partir da criacao (preco lido pela API na hora; referencia `docs/30` §7.5) |
| D, `bunker707-jibri-<sessao>` | grava uma live em 1080p e envia o MP4 para a Bunny | cpx42 (`JIBRI_TYPE`; reserva ccx23 e cpx32, este em 720p) | por hora, so durante a live (uma live de 2,5 h ~ EUR 0,28) |

O C nao guarda dado de aluno (chat, presenca e relatorio ficam no banco do A), por isso nao tem Storage Box nem backup:
recriar e `provision-meet` + `deploy-meet` + `secrets-meet`.

### 8B.2 Criar o servidor C (etapa `provision-meet`)

1. O produtor da o ok no chat. 2. A IA dispara `provision-meet` com `CONFIRMADO=sim` nas opcoes (sem ele a etapa recusa). A
etapa garante a chave SSH do projeto, cria `bunker707-meet` com o firewall proprio (80/443 TCP e 443 UDP de qualquer lugar,
UDP 10000 da midia, 3478/5349 reservados para TURN, 5222 so dos gravadores vivos, 22 so durante as etapas), faz o
bootstrap (ufw, Docker, fail2ban, swap) e grava `meet.<dominio>` na Cloudflare **so DNS** (sem proxy: WebRTC nao passa
pela Cloudflare). O IP do C fica visivel; a protecao e o firewall da Hetzner, o ufw e o Caddy.

### 8B.3 Deploy e segredos (etapas `deploy-meet` e `secrets-meet`)

- `deploy-meet` roda da `main` ou da `dev` (decisao do produtor em 29/10/2026: o C nao guarda dado de aluno e atende o
  teste da Vercel e a producao; o `deploy-membros` continua so da `main`). Na primeira vez gera `infra/jitsi/.env` no
  servidor (`generate-secrets.sh`: senhas do Jicofo, do JVB e do Jibri, as credenciais de TURN e o `JWT_APP_SECRET`,
  nunca impressos), grava `JVB_ADVERTISE_IPS` com o IPv4 publico, sobe o stack com o perfil `borda` e roda o
  `smoke.sh` (site no ar, servicos saudaveis, nenhuma marca do Jitsi na interface, UDP 10000 ouvindo).
- Com o stack ja no ar, um novo `deploy-meet` recria containers e derruba quem esta na sala: so com `SEM_LIVE_2H=sim`
  nas opcoes (nenhuma live nas proximas 2 h).
- O `.env` do C leva `XMPP_MUC_MODULES=token_affiliation,bunker_room_guard` e `ROOM_GUARD_URL=<origem da area de
  membros>/api/webhooks/room-guard` (o `generate-secrets.sh` deriva os dois; num `.env` gerado antes de 29/10/2026,
  acrescentar as duas linhas a mao antes do proximo `deploy-meet`): o Prosody busca ali, a cada 5 s, quem a equipe
  removeu ou baniu e recusa a entrada dessas contas mesmo com o token antigo (`docs/30` §8.1). A busca e assinada com
  uma chave derivada do `JWT_APP_SECRET`: nenhum segredo novo. **Hoje o C atende a Vercel de teste**: o `.env` foi
  gerado com `APP_DOMAIN=bunker707-member-area.vercel.app` nas opcoes do `deploy-meet` (29/10/2026). No dia em que a
  producao (`membros.<dominio>`) passar a usar a sala ao vivo, trocar a linha no C (`exec-meet` com
  `sed -i 's#^ROOM_GUARD_URL=.*#ROOM_GUARD_URL=https://membros.<dominio>/api/webhooks/room-guard#' infra/jitsi/.env`
  e um `deploy-meet` com `SEM_LIVE_2H=sim`): uma URL so, entao o teste e a producao nao barram ao mesmo tempo.
- O jicofo so responde `/about/health` com `JICOFO_ENABLE_HEALTH_CHECKS=1` (no compose, padrao 1): sem isso a rota da
  404, o container fica `unhealthy` para sempre e o `deploy-meet` para no `wait_healthy jicofo` (a sala funciona, mas o
  `smoke.sh` nao roda). E com `JICOFO_ENABLE_REST=1` (padrao 1) a REST ouve em `0.0.0.0` dentro do container: sem
  isso ela fica so no loopback do container e o `smoke.sh`, que pergunta em `127.0.0.1:8888` do servidor, ve `000`. A
  porta continua publicada so em `127.0.0.1`.
- `secrets-meet` grava `JWT_APP_SECRET` no C pelo envelope (`docs/20` §4A.6). O **mesmo valor** vai para o app em
  `WEBINAR_JWT_SECRET` por `secrets-membros` (o app assina o token da sala, o Jitsi confere). Sem ele ninguem entra
  (`ENABLE_GUESTS=0`, `AUTH_TYPE=jwt`).
- O segredo do repositorio `JIBRI_SECRETS` (linhas `CHAVE=VALOR`: `BUNNY_LIBRARY_ID`, `BUNNY_API_KEY`,
  `WEBINAR_RECORDER_WEBHOOK_SECRET`; opcionais `WEBINAR_RECORDER_WEBHOOK_URL` e `BUNNY_COLLECTION_ID`) so entra nos
  passos de `jibri-up` e `jibri-down`, nunca no ambiente do job inteiro. O `WEBINAR_RECORDER_WEBHOOK_SECRET` tambem vai
  para o app (`secrets-membros`): e o HMAC que o webhook do gravador confere (`docs/30` §5.3).
- `status-meet`: DNS de `meet.<dominio>`, o site, a marca fora da interface e os gravadores vivos com tempo ligado e
  custo; avisa quando um gravador passa de 6 h ligado.
- **No dia em que a producao (`membros.<dominio>`) passar a usar a sala ao vivo**, junto com a troca do `ROOM_GUARD_URL`
  para `https://membros.<dominio>/api/webhooks/room-guard`: o `MEET_FRAME_ANCESTORS` do C tambem foi gerado so com a
  origem da Vercel de teste (o `--app-origin` do primeiro `deploy-meet`) e precisa da origem de producao; sem ela o
  navegador recusa a sala dentro da area (o cabecalho `frame-ancestors` do Caddy do C, `docs/30` D18 e D40). O
  `frame-ancestors` aceita uma lista separada por espaco, entao as duas origens ficam: `exec-meet` com
  `sed -i 's#^MEET_FRAME_ANCESTORS=.*#MEET_FRAME_ANCESTORS="https://membros.<dominio> https://bunker707-member-area.vercel.app"#' infra/jitsi/.env`
  e um `deploy-meet` com `SEM_LIVE_2H=sim` (recria o Caddy com o valor novo e o `smoke.sh` confere o cabecalho). As
  aspas funcionam: o compose tira as aspas do valor no `.env`, o Caddyfile poe o valor inteiro dentro de
  `"frame-ancestors {$MEET_FRAME_ANCESTORS}"` e o `env_value` dos scripts (`smoke.sh`) tambem tira as aspas. O
  `deploy-meet` nao regera um `.env` que ja existe, entao a troca fica.

### 8B.4 Antes da primeira live real

Testar a sala com 2 ou 3 contas (celular e computador, uma em 4G), conferir que nenhuma tela mostra o nome ou a marca do
Jitsi, que o aluno entra sem microfone e so com o token do app, e rodar o roteiro de conferencia do `docs/30` §10.3.

### 8B.5 O gravador por hora (etapas `jibri-up`, `jibri-down` e `exec-jibri`)

- **Antes da live** (cerca de 30 min): `jibri-up` com `CONFIRMADO=sim SESSAO=<id da sessao>`. Cria
  `bunker707-jibri-<sessao>` (tenta o cpx42 e as reservas nos locais da lista), grava `/opt/jibri/.env` por SSH (senhas e
  dominios do `.env` do C, segredos do `JIBRI_SECRETS`), abre a 5222 do C so para o IP dele, sobe o container, espera o
  Jibri ficar saudavel e avisa o app (`state=ready`). Sem estoque em tipo algum: avisa `unavailable` (a live acontece, sem
  gravacao; o plano B e gravar pelo OBS e enviar o arquivo pelo admin).
- **Durante a live**: o host clica Gravar; o app marca a ancora no relogio do servidor. O MP4 fica na maquina D.
- **Depois da live**: o `finalize.sh` envia o MP4 para a Bunny Stream e avisa o app (`uploaded`, com duracao, tamanho e
  sha256; ou `upload_failed`, guardando o arquivo). Em seguida `jibri-down` com `CONFIRMADO=sim SESSAO=<id>`: so apaga
  quando o app confirma `uploaded` (ou que nao houve gravacao) e nao ha MP4 sem a marca `.uploaded` na maquina. `FORCAR=1`
  apaga mesmo assim (perde o arquivo que nao subiu). Sem `SESSAO`, o `jibri-down` cuida de todos os gravadores vivos.
- **Envio falhou** (`upload_failed`, o e-mail chega ao produtor; o MP4 fica na maquina com a marca `.failed`): rodar o
  envio de novo com `exec-jibri`, `SESSAO=<id>` e `COMANDO='docker compose exec -T jibri sh /config/finalize.sh'` (sem
  argumento ele pega o MP4 mais novo da pasta de gravacoes; o app aceita o `uploaded` depois do `upload_failed` e a
  gravacao volta a `processing`); sem sucesso, copiar o MP4 da maquina e envia-lo pelo painel da Bunny (ligar o video a
  sessao pelo console da sala, **Enviar gravacao** / **Ligar um video da Bunny**), e so depois `jibri-down`.
- O `jibri-down` de uma sessao cujo servidor ja nao existe manda o `gone` de novo ao app (o primeiro pode ter se
  perdido); sem isso o job pediria a devolucao a cada 2 h para sempre.
- Um gravador esquecido custa por hora: `status-meet` avisa depois de 6 h; a regra e apagar no mesmo dia.

### 8B.6 Atualizar o Jitsi

A tag `stable-NNNNN` fica fixada em `infra/jitsi/.env.example` (e em `infra/jitsi/jibri/.env.example`, sempre igual). A
cada 4 a 8 semanas: `sh infra/jitsi/scripts/update.sh --check` (compara com a ultima stable), `--apply` (reescreve as duas
tags), ensaio local, PR, `main`, e `deploy-meet` com `SEM_LIVE_2H=sim` (o servidor roda `update.sh --server`, guarda a tag
anterior em `infra/jitsi/.previous-image-version` e roda o smoke). Voltar: `exec-meet` com
`COMANDO='bash infra/jitsi/scripts/update.sh --server --tag <tag anterior> --sem-live'`.

### 8B.7 Plano B: "Live gravada do dia"

Se o C cair na hora da live e nao voltar em 5 minutos: avisar a turma pelo sino (aviso da Comunicacao), publicar uma
**Live gravada do dia** com a gravacao mais recente do mesmo tema (ou o OBS gravando a tela do apresentador, enviado depois
como Replay) e remarcar a Live ao vivo (o app avisa quem tinha vaga). Nunca anunciar a gravada como ao vivo fora da area
(`docs/30` §8.6). O texto pronto do sino e o do `docs/30` §2.7 ("A live {titulo} de hoje mudou: assista a sessao gravada
as {hora}. Entrar."); o clique unico no admin que manda esse texto a quem garantiu vaga ainda nao existe (fica para
depois, `docs/30` §11): por ora, um aviso da Comunicacao para o segmento de quem tem vaga. Monitor: com o C no ar, um
monitor HTTPS no Better Stack (o mesmo do servidor A, §12) em `https://meet.<dominio>/` (200 e a palavra `Bunker707`),
o certificado (aviso 14 dias antes) e o ping; o alerta vai para os mesmos destinatarios do servidor A (o produtor e a
equipe tecnica). Se o monitor acusar queda com live marcada nas proximas 24 h, o plano B acima comeca antes da hora.

### 8B.8 Incidentes

| Sintoma | O que fazer |
|---|---|
| O smoke acusa `jicofo /about/health` 500 depois de um `deploy-meet` ou `secrets-meet` (log do jicofo: "No operational bridges available (total bridge count: 0)") | o prosody foi recriado e o jicofo reconectou sem retomar a sessao, ficando sem ponte (30/10/2026). Desde entao as etapas chamam `reconnect_focus` (`infra/jitsi/scripts/_env.sh`) depois do `up -d`; a mao: `exec-meet` com `COMANDO='docker compose -f infra/jitsi/docker-compose.yml restart jicofo'` e o `smoke.sh` |
| `deploy-meet` ou `secrets-meet` para em "jicofo nao ficou saudavel" | `exec-meet` com `docker inspect --format '{{json .State.Health}}' bunker707-meet-jicofo`: `404` = falta `JICOFO_ENABLE_HEALTH_CHECKS` no compose (§8B.3); `500` = sem ponte (ver `docker compose logs jvb`); o `smoke.sh` ve `000` em `127.0.0.1:8888` com o container saudavel = falta `JICOFO_ENABLE_REST` (a REST so no loopback do container) |
| Ninguem entra na sala | `status-meet`; conferir `JWT_APP_SECRET` (C) = `WEBINAR_JWT_SECRET` (app) e o relogio dos dois (o token vale 60 s antes) |
| Video trava para quem esta em 4G ou rede de empresa | UDP 10000 bloqueado na rede do aluno: TURN e o passo seguinte (portas reservadas no firewall) |
| Gravador nao fica saudavel | `exec-jibri` com `COMANDO='docker compose logs --tail 200 jibri'`; sem conserto em 10 min, `jibri-down` com `FORCAR=1` e gravar pelo OBS |
| Gravador ligado depois da live | `jibri-down` com `CONFIRMADO=sim` (sem `SESSAO`: todos). O app ja pede o `jibri-down` da sessao sozinho (job `webinar-recordings`, de novo a cada 2 h) e avisa no sino depois de 6 h; se o aviso chegou, o pedido do app nao esta passando: conferir o `GITHUB_INFRA_TOKEN` (§8B.9) |
| Aluno ve a sala mas sem video nem audio | UDP 10000 e TURN no firewall do C; os `webinar_room_error` do aluno (so o codigo) no historico; `exec-meet` com `COMANDO='docker compose logs --tail 200 jvb'`; testar com TURN forcado; TURN em 443 e a opcao B (`docs/30` I7) |
| Apresentador entra como participante, nao como moderador | `XMPP_MUC_MODULES=token_affiliation` e `ENABLE_AUTO_OWNER=0` no `.env` do C; o claim `moderator` vem do papel no app (o Apresentador precisa de `messaging.publish`; a Equipe so com "Pode remover e silenciar na sala"); `exec-meet` com `docker compose logs prosody`. Nunca imprimir o token nem a chave |
| "Gravacao pronta" nao chega (o console fica em Preparando) | o Jibri no brewery? a regra 5222 do C para o IP do gravador? `exec-jibri` com `docker compose logs jibri`; o webhook recusou? `webinar_recording_events` da sessao (o motivo do `ignored` em `error_message`; 401 nao grava linha: conferir `WEBINAR_RECORDER_WEBHOOK_SECRET` igual no app e no `JIBRI_SECRETS`); refazer `jibri-up` |
| Hetzner sem estoque para o gravador | log do `jibri-up` ("unavailable" nos locais e tipos de reserva); o console mostra "Sem gravador hoje: gravar no navegador": gravar no navegador ou no OBS e ligar o video pelo console (**Enviar gravacao**) |
| Envio para a Bunny falhou (`upload_failed`) | o e-mail "A gravacao nao subiu" chega ao Apresentador; arquivo em `/opt/jibri/recordings` (`exec-jibri`); reenviar como em §8B.5 ou subir pelo painel da Bunny e ligar pelo console; so entao `jibri-down` com `FORCAR=1` |
| Certificado do `meet` invalido | `docker compose logs caddy` no C; o registro DNS so DNS (sem proxy); porta 80 aberta; `docker compose restart caddy` |
| O servidor C sumiu | painel da Hetzner; o plano B "Live gravada do dia" (§8B.7) e o aviso pelo sino; reprovisionar com `provision-meet` + `deploy-meet` + `secrets-meet` (o DNS e refeito pelo `cf_apply_dns`) |
| Aluno removido ou banido volta para a sala | `XMPP_MUC_MODULES` com `bunker_room_guard` e `ROOM_GUARD_URL` no `.env` do C; `exec-meet` com `docker compose logs prosody` ("lista de barrados indisponivel" = o app nao respondeu: conferir `JWT_APP_SECRET` = `WEBINAR_JWT_SECRET` e o `ROOM_GUARD_URL`); o token vence em 15 min de qualquer jeito |
| O segredo do token vazou | trocar `JWT_APP_SECRET` (C, `secrets-meet`) e `WEBINAR_JWT_SECRET` (app, `secrets-membros`) juntos, fora de live (derruba quem esta na sala) |

### 8B.9 O app da fase 3 (sala ao vivo, 29/10/2026)

O app ja tem a sala ao vivo (`docs/30` §11; a migracao `202610290002` vai para a nuvem de teste antes do merge, `docs/21`
§9.8, e para a producao pelo `deploy-membros`, §9). Sem as variaveis abaixo nada quebra: a sala diz "em breve" e a Live gravada segue. Cada uma entra pelo envelope
(`secrets-membros`, §4A.6), nunca em `NEXT_PUBLIC_*`. O `environment:` do servico `app` em
`infra/compose/docker-compose.yml` repassa todas ao container (ate 30/10/2026 nao repassava: gravadas no `.env`, o app
nao as via; a guarda `tests/infra-compose-env.guard.test.mjs` confere que toda variavel do `.env.example` que o app le
chega ao container):

| Variavel (app) | Para que | Sem ela |
|---|---|---|
| `WEBINAR_MEET_DOMAIN` | hostname do C (`meet.<dominio>`, sem `https://`); tambem lido no build pela Permissions-Policy do app (`next.config.ts`, a mesma em toda pagina) | sala "em breve"; o build usa `meet.bunker707.com.br` na Permissions-Policy |
| `WEBINAR_JWT_SECRET` (+ `WEBINAR_JWT_APP_ID`, vazio = `bunker707`) | o token da sala; o mesmo valor de `JWT_APP_SECRET` no C | sala "em breve" (`join-token` 503) |
| `WEBINAR_RECORDER_WEBHOOK_SECRET` | o HMAC do webhook do gravador; o mesmo valor do `JIBRI_SECRETS` | o webhook responde 401 e nada e gravado |
| `GITHUB_INFRA_TOKEN` (opcional; so "Actions: write" deste repositorio) | o app pede `jibri-up` / `jibri-down` sozinho (Preparar gravacao, Gravar automaticamente, a devolucao) | o console mostra a reserva e a maquina e pedida a mao pelo workflow |
| `BUNNY_STREAM_API_KEY` + `BUNNY_STREAM_LIBRARY_ID` (opcionais) | o job `webinar-recordings` consulta a codificacao ate `ready`, cria o replay e apaga o vencido | a gravacao fica em processamento ate a equipe ligar o video pelo console |
| `WEBINAR_RECORDER_DISPATCH` | so fora da producao (`fake` = o duble dos testes) | nada (nunca na producao) |

A reserva **Gravar no navegador** do console usa a gravacao local do Jitsi, ligada de forma explicita no
`infra/jitsi/web/custom-config.js` (`config.localRecording = { disable: false }`): entra no C no proximo `deploy-meet`.

Antes de cada live: **Testar sala** no console (com a sessao ainda agendada, o Apresentador entra na sala da propria
sessao sem os alunos) e, com o gravador pedido, conferir que o cartao Gravacao chega a **Pronto**. Durante: o console
mostra a maquina ligada ha quanto tempo e a ancora da gravacao.

## 9. Deploy de nova versao do app

Desde 19/10/2026 a etapa so roda a partir da `main` (passo "Deploy so da main" do workflow): o caminho e branch da tarefa -> PR para `dev` (teste na Vercel com o Supabase da nuvem) -> PR `dev` -> `main` -> `deploy-membros` (ambientes em `CONTRIBUTING.md`). Em 18/10/2026 o caminho de producao passou a ser a etapa `deploy-membros` (secao 4A.3): ela constroi a imagem no runner com as `NEXT_PUBLIC_*` lidas do `.env` do servidor (`SUPABASE_PUBLIC_URL`, `SUPABASE_PUBLISHABLE_KEY` e, se preenchidos, PostHog e Sentry), publica `ghcr.io/<repositorio>:hetzner-sha-<commit>` e, no servidor, roda o `infra/scripts/deploy.sh --image` descrito abaixo. Nao ha variaveis `NEXT_PUBLIC_*` no GitHub. O `build-image.yml` continua rodando a cada push na `main` e em PR que mexe no build (Dockerfile, package.json, next.config) para conferir que o build passa; a imagem que ele publica (`sha-<commit>`) nao leva as `NEXT_PUBLIC_*` do servidor e nao e a de producao; por isso a de producao tem o prefixo `hetzner-`.

Caminho manual (o mesmo script que a etapa roda), no servidor. O servidor nao tem `.git` (o deploy envia o commit por `git archive`), entao `--ref` nao se aplica; e so a etapa tem credencial do GHCR (o `GITHUB_TOKEN` expira com o job): fora dela, so imagens que ja estao no disco.

```bash
cd /opt/bunker707
sh infra/scripts/deploy.sh --image ghcr.io/danilosouza-dev/bunker707-member-area:hetzner-sha-1a2b3c4
```

O script atualiza `APP_IMAGE` no `.env` (guardando a anterior em `infra/compose/.deploy-history`), puxa a imagem, aplica as migracoes novas, recria so o app, espera o healthcheck e roda o smoke. `curl https://membros.bunker707.com.br/api/health` mostra a versao no ar. Para voltar: `deploy.sh --image <anterior> --no-migrate`, por `exec-membros` (a imagem anterior esta no disco, entao nao ha pull; migracao nao volta sozinha: toda migracao do repositorio e aditiva por regra do docs/13).

**Antes de voltar para uma imagem anterior a Comunicacao v3b-2** (`docs/29`, migracao `202610260001`): em Comunicacao > Avisos e pop-ups, **pausar** os pop-ups com **No primeiro acesso** e **Ao concluir um curso** (a coluna Quando da lista mostra o momento) e so depois rodar o `deploy.sh --image <anterior> --no-migrate`. A imagem anterior le esses momentos como "Ao abrir a pagina": o plano dela os mostraria em toda pagina escolhida, o tick dela habilitaria o segmento inteiro num "No primeiro acesso" e editar um deles ali gravaria "Ao abrir a pagina" sem erro (`docs/29` R1). Depois de voltar para a versao nova, retomar: o recalculo tira as linhas sem a marca `first_access_at`. A migracao fica (aditiva) e nao atrapalha a imagem anterior.

**Antes de voltar para uma imagem anterior ao Quem pode por regras** (`docs/30` D41, migracao `202610300001`): nada a fazer no banco, mas quatro coisas na equipe, todas **antes** do `deploy.sh`. **(1) As lives com as regras novas.** Em Comunicacao > Webinarios, toda live em **Segmento** ou **Produto ou segmento** cujo segmento usa **Ganhou acesso recentemente** ou **Participação em lives** (inclusive "nunca garantiram vaga em nenhuma live") e que acontece, ou manda lembrete, enquanto a imagem anterior estiver no ar: trocar o **Quem pode** para **Quem tem o produto** (ou **Todos**) com a imagem nova ainda no ar (o schema da imagem anterior recusa salvar um webinario com essas regras) e anotar quais mudaram; ou nao voltar a imagem com uma delas marcada para as proximas horas. A imagem anterior avalia o tipo de regra que nao conhece como "nao" e nao tem a ancora: a live em **Segmento** fecha para todos os alunos, inclusive quem ja garantiu vaga ("Esta live não está disponível para você" na pagina e na sala), e no **Produto ou segmento** so quem tem o produto entra. E os avisos da live na imagem anterior (lembretes de 24 h e 1 h, **Começou agora**, cancelada e remarcada) nao conferem o **Quem pode**: vao para todas as vagas, e quem clica cai no "não disponível" (300 vagas numa live em Segmento com "Ganhou acesso hoje a Curso X" = 300 lembretes de 1 h para uma pagina fechada). Sem a ancora, em qualquer live em Segmento quem garantiu vaga e saiu do segmento tambem deixa de ver a live enquanto a imagem anterior estiver no ar. O segmento fica gravado no webinario mesmo com outro **Quem pode**: depois de voltar para a versao nova, devolver o **Quem pode** de cada live anotada. **(2) Os fluxos.** **Pausar os fluxos que usam as regras novas numa condicao, no Objetivo ou no "Só para quem…"**. Em Comunicacao > Fluxos (e nos avisos com notificacoes seguintes), pausar todo fluxo com **Ganhou acesso recentemente** ou **Participação em lives** numa condicao ("Participou da live X?"), no Objetivo ou no "Só para quem…" (ou no "Para quem") de uma notificacao, e so depois rodar o `deploy.sh --image <anterior> --no-migrate`. A imagem anterior avalia um tipo de regra que nao conhece como "nao": numa condicao, todo aluno que chega nela vai pelo caminho **Não** e recebe as notificacoes desse caminho (inclusive quem participou da live: "Voce perdeu, veja o replay"), e com "Esperar ate ser verdade" todos esperam ate o prazo e tambem vao pelo **Não**; no Objetivo, ninguem sai do fluxo por ele e quem ja atingiu continua recebendo; no "Só para quem…", ninguem combina, e todo aluno que chega na notificacao nao a recebe e para ali naquele caminho (nao volta a receber quando a imagem nova voltar). Depois de voltar para a versao nova, retomar esses fluxos. **(3) As notificacoes agendadas.** Em Comunicacao > Avisos e pop-ups, toda notificacao **agendada** cujo segmento usa **Ganhou acesso recentemente** ou **Participação em lives** e cuja hora cai enquanto a imagem anterior estiver no ar: abrir e mudar o **Quando** para depois da volta (ou salvar uma mudança como rascunho, que cancela o envio agendado) e anotar quais mudaram. O tick da imagem anterior reserva o aviso na hora, avalia a regra como "nao" para todo aluno e grava o aviso como enviado, com 0 destinatarios (o publicar confere o segmento vazio, o envio pelo tick nao): quando a imagem nova volta, o aviso continua enviado e ninguem o recebeu. Depois de voltar para a versao nova, agendar de novo cada aviso anotado. **(4) Os modelos.** Com a imagem anterior no ar, nao usar, nao salvar e nao excluir os modelos de Notificacao ou de Pop-up (`docs/28`) cujo segmento, ou cujas notificacoes seguintes, usam **Ganhou acesso recentemente** ou **Participação em lives**. O schema da imagem anterior recusa as regras novas ao ler o modelo: o segmento cai para "Todos os alunos" (com a nota "O segmento guardado neste modelo não pôde ser lido: ficou “Todos os alunos”.") e as notificacoes seguintes ficam de fora, entao o **Usar** abre o aviso para a escola inteira e sem as seguintes, e salvar o modelo ali grava sem o segmento e sem as seguintes (a imagem nova nao recupera). Onde a regra "fecha" e nao precisa de nada: o segmento dos pop-ups e o "Quem entra" de um fluxo (ninguem novo ve ou entra enquanto a imagem anterior estiver no ar; ao voltar, o recalculo e a entrada voltam a valer). O modo **Quem tem o produto e está no segmento** e gravado como `access_mode = 'product'` + `audience_restricts = true` (nenhum valor novo no `access_mode`, que a imagem anterior leria como `everyone`): a imagem anterior ignora a coluna e trata essas lives como **Quem tem o produto** enquanto estiver no ar (o segmento deixa de restringir, o produto continua exigido; nenhuma live abre para quem nao tem o produto). O schema dela recusa salvar webinarios e avisos com as regras novas. Ao voltar para a versao nova, o resto volta como estava (o banco nao muda); o que a imagem anterior ja gravou fica: o aviso agendado que saiu com 0 destinatarios, quem parou num "Só para quem…" e o modelo salvo com ela (os passos 2 a 4 evitam isso).

**Antes de voltar para uma imagem anterior a uniao das regras de lives** (a integracao da fase 4 dos webinarios, `docs/30` D52 e `docs/22` §3; sem migracao): as acoes do follow-up (viu o replay, viu o card de compra, saiu antes dele, clicou e nao comprou, comprou pelo card) sao acoes novas do mesmo tipo de regra **Participação em lives** (`webinar`), e a imagem do Quem pode por regras le qualquer acao que nao conhece como **participou** (negada, **não participou**), em vez de "nao". Antes do `deploy.sh --image <anterior> --no-migrate`: em Comunicacao > Avisos e pop-ups, retirar ou pausar os pop-ups no ar e tirar da agenda as notificacoes cujo segmento usa uma dessas acoes (um pop-up "comprou pelo card na live X" iria para todo mundo que participou da live X); em Comunicacao > Fluxos, pausar os fluxos com uma delas no "Quem entra"; e nao abrir nem salvar esses avisos e modelos com a imagem anterior no ar (o editor dela tira a regra ao salvar). Depois de voltar para a versao nova, devolver o que foi pausado.

**Antes de voltar para uma imagem anterior ao Celular do Livre** (`docs/27` §9.10, PR L3: valores proprios do celular em `devices.mobile`, sem migracao): a imagem anterior tem o schema estrito que recusa a chave `devices`, entao todo pop-up Livre salvo com algum valor de Celular fica invalido para ela ate a imagem nova voltar: some para os alunos (sai da lista no ar com o log `[comunicacao] design livre invalido <id do aviso>`), da 404 no `show` e abre como Padrao no editor do aviso (salvar ali troca o Livre pelo Padrao: nao salvar esses avisos com a imagem anterior no ar). Os Livres sem valor de Celular continuam iguais. O mesmo vale para os modelos (`docs/28`): um modelo de Design cujo Livre tem valores de Celular aparece como ilegivel ("Este modelo não pode ser aberto…") e um modelo de Pop-up com esse Livre abre com o design Padrao; nao excluir nem salvar esses modelos ate a imagem nova voltar. Ao voltar para a versao nova, avisos e modelos reaparecem como estavam (o banco nao muda). O espelho do R1 (`docs/29`): com uma imagem anterior no ar (inclusive no meio de um deploy), ninguem salva valores de Celular no editor Livre; a imagem nova le os Livres de antes sem mudanca.

**Antes de voltar para uma imagem anterior ao L4b do Livre** (`docs/27` §13.10, L45 e L47: ate 3 botoes "Abrir um link", sem migracao): a imagem anterior tem a regra de um "Abrir um link" so, entao todo pop-up Livre salvo com 2 ou 3 "Abrir um link" fica invalido para ela ate a imagem nova voltar, com os mesmos efeitos da nota do Celular acima: some para os alunos (log `[comunicacao] design livre invalido <id do aviso>`), da 404 no `show`, abre como Padrao no editor do aviso (salvar ali troca o Livre pelo Padrao: nao salvar esses avisos com a imagem anterior no ar), o modelo de Design com esse Livre aparece como ilegivel e o modelo de Pop-up abre com o Padrao (nao excluir nem salvar esses modelos). Os Livres com um link so continuam iguais. O resto do L4b nao atrapalha a volta: a Forma e a Caixa com largura e altura na sequencia ja valiam no schema de antes, e o `metadata.button` ja gravado no `message_clicked` fica no historico (a imagem anterior le so `event` e `via` do corpo e ignora o `button`: com ela no ar, os cliques gravam sem a chave). Ao voltar para a versao nova, avisos e modelos reaparecem como estavam (o banco nao muda). A regra, no molde do R1 (`docs/29`): com uma imagem anterior no ar (o meio de um deploy, ou uma previa antiga da Vercel ligada ao Supabase de teste), ninguem salva um segundo "Abrir um link" no editor Livre.

**Antes de voltar para uma imagem anterior ao L6 do Livre** (`docs/27` §13.11: os efeitos do Livre em entregas, sem migracao; uma linha por entrega que traz chave nova no JSON do Livre, conferida antes de promover a entrega para a `main`; o L6a e o L6g nao mudam o JSON e ficam fora):

- **L6b** (`docs/27` §13.11.2, L58): `stroke` (o contorno das letras, no `textStyle` dos elementos de texto e nas partes do Titulo e do Texto) e `mark` (o marca-texto das partes).
- **L6c** (`docs/27` §13.11.3, L63): `hover` (as cores ao passar o mouse, no Botao e nos Links).

A imagem anterior a uma entrega tem o schema estrito que recusa as chaves dela, entao todo pop-up Livre salvo com elas fica invalido para essa imagem ate a nova voltar, com os mesmos efeitos das notas acima: some para os alunos (log `[comunicacao] design livre invalido <id do aviso>`), da 404 no `show`, abre como Padrao no editor do aviso (salvar ali troca o Livre pelo Padrao: nao salvar esses avisos com a imagem anterior no ar), o modelo de Design com esse Livre aparece como ilegivel e o modelo de Pop-up abre com o Padrao (nao excluir nem salvar esses modelos). Os Livres sem as chaves continuam iguais. Ao voltar para a versao nova, avisos e modelos reaparecem como estavam (o banco nao muda).

Aba aberta antes do deploy (o cartao antigo ja baixado no navegador do aluno, critica C8 do plano do L6): o cartao antigo ignora as chaves que nao conhece e desenha o resto. No L6b, o texto vazado (a letra transparente com contorno) some, porque o cartao antigo pinta a letra transparente e nao desenha o contorno; e a parte com marca-texto fica sem o fundo, entao uma letra escura pensada para um marca-texto claro pode nao se ler. No L6c, o cartao antigo ignora o `hover`: o botao so clareia, como antes, e os links so sublinham; nada some. Recarregar a pagina baixa o cartao novo. Por isso o guia da IA pede o vazado so em palavras grandes do Titulo, nunca no texto que o aluno precisa ler, e o atalho "So o contorno" do editor fica so no Titulo e no Texto.

A regra, no molde do R1 (`docs/29`): com uma imagem anterior no ar (o meio de um deploy, ou uma previa antiga da Vercel ligada ao Supabase de teste), ninguem salva no editor Livre o que a entrega trouxe (no L6b, contorno e marca-texto; no L6c, as cores ao passar o mouse).

Sem GitHub no caminho (emergencia): `deploy.sh --build` constroi no proprio servidor (precisa de ~2 GB livres e uns 3 minutos).

---

## 10. Backup e restauracao

### 10.1 O que entra, quando, onde

Em 18/10/2026: o Storage Box (`bunker707-backups`, bx11) e criado pela etapa `provision`, que gera a chave de backup, a cadastra no box (`--ssh-key` do `hcloud storage-box create`, com SSH ligado e acesso externo) e a instala nos dois servidores em `~deploy/.ssh/id_ed25519_storagebox`; `deploy-membros` e `deploy-marketing` gravam usuario e host no `.env` e rodam `--init` e o timer. Sao dois repositorios restic no mesmo box: `/bunker707/restic` (servidor A, 03:30 UTC) e `/bunker707/restic-mautic` (servidor B, 03:50 UTC, secao 8A.5), cada um com a propria `RESTIC_PASSWORD` (gerada no `.env` de cada servidor; guardar as duas no gerenciador de senhas). As etapas `backup-membros` e `backup-marketing` fazem um backup com `--check` a qualquer hora.

`backup.sh` roda todo dia as 03:30 UTC (timer do systemd, usuario `deploy`) e guarda, criptografado pelo restic num Storage Box via SFTP (porta 23):

- `roles.sql` (papeis e senhas), `schema.sql`, `data.sql.gz` e `postgres.dump` (formato custom, e o que a restauracao usa), todos gerados pelo `pg_dump` de dentro do container do Postgres (mesma versao, sem imagem extra);
- `pgsodium_root.key`, a chave raiz do Vault (segredos dos provedores de IA): sem ela o Vault restaurado nao abre;
- o `infra/compose/.env` (todos os segredos do stack);
- `infra/compose/volumes/storage` (capas, materiais, fotos de perfil e, desde 20/10/2026, as imagens dos avisos em `content-assets/communications/images` e os audios dos avisos no bucket `communication-audio`).

Disco dos avisos (Comunicacao v1, `docs/22` §4.5): cada audio vai ate 10 MB e cada imagem ate 420 KB; um aviso por semana com audio da cerca de 0,5 GB por ano no Storage, e o mesmo no repositorio restic (o restic deduplica entre snapshots, entao os 30 diarios nao multiplicam isso). O bucket nasce pela migracao `202610200001` (sem passo manual nem variavel nova; o limite global `FILE_SIZE_LIMIT` de 50 MiB fica acima dos 10 MB). Audio ou imagem trocados no editor ficam no Storage sem referencia; se o disco apertar (monitor da secao 12), olhar primeiro os arquivos do bucket `communication-audio` em `infra/compose/volumes/storage`.

Retencao: um snapshot por dia pelos ultimos 30 dias (`BACKUP_KEEP_DAILY`). Os dois ultimos exports ficam tambem em `/var/backups/bunker707/stage` para restauracao rapida. `backup.sh --check` (semanal, a mao ou num segundo timer) le 10% dos dados do repositorio para conferir integridade. `BACKUP_HEARTBEAT_URL` no `.env` recebe um GET a cada backup bom (monitor de "push" do Uptime Kuma ou Better Stack: se nao chegar, alerta).

Por que nao `supabase db dump`: o dump da CLI exclui de proposito os esquemas que o Auth e o Storage administram (ele existe para migrar entre projetos da nuvem, onde esses esquemas ja existem). Num servidor proprio queremos o banco inteiro, inclusive `auth`, `storage`, `vault`, `cron` e `supabase_migrations`, para restaurar num Postgres identico sem reconstruir nada. Para migrar DA nuvem PARA a Hetzner, a CLI e a ferramenta certa (secao 14).

### 10.2 Restaurar num servidor limpo

1. Secoes 5 e 6 (servidor, firewall, bootstrap) e o repositorio em `/opt/bunker707` (pela etapa `provision` + `deploy-membros`, que enviam o commit por `git archive`, ou por `git clone` a mao).
2. `export RESTIC_REPOSITORY=sftp:storagebox:bunker707/restic RESTIC_PASSWORD=<senha>`. A senha e a `RESTIC_PASSWORD` do `.env` antigo ou, sem ele (servidor perdido), a senha de recuperacao: desde 19/10/2026 cada repositorio (o do app e o `restic-mautic`) tem uma segunda chave derivada do `HCLOUD_TOKEN` (etapa `chave-backup`). Para obte-la: `node infra/cloud/deploy-key.mjs --secret --info bunker707-restic-recovery-v1 --out <arquivo>` no runner (ou em qualquer lugar com o token), levar o arquivo ao servidor pelo stdin do SSH, como faz `backup_recovery_key` em `infra/cloud/lib.sh`, e `export RESTIC_PASSWORD=$(cat <arquivo>)`. Se o token for trocado, rodar `chave-backup` com o token novo enquanto o servidor ainda existe e `STORAGE_BOX_USER=... STORAGE_BOX_HOST=...` no ambiente; `sh infra/scripts/backup.sh --init` so para gravar o alias SSH. Atencao: o `provision` so gera e instala a chave de backup quando cria o Storage Box; num servidor novo criado depois, o `--init` gera uma chave nova e imprime o comando `install-ssh-key` para cadastra-la no box, o que exige a senha do box (redefinir no painel da Hetzner) ou o cadastro da chave pelo painel.
3. `sh infra/scripts/restore.sh --snapshot latest` (ou um id de `restic snapshots`). O script: baixa o snapshot, poe o `.env` no lugar, sobe so o Postgres, devolve a chave do Vault e reinicia, aplica papeis e `pg_restore --clean` do banco inteiro, copia os arquivos do Storage, sobe o resto e roda o smoke. Avisos do `pg_restore` sobre objetos que a imagem ja tinha sao normais; o script imprime o numero de contas no Auth e a ultima migracao para conferencia.
4. DNS: apontar `membros`, `api` e `studio` para o IP novo. Sessoes dos alunos continuam valendo (mesmo `JWT_SECRET`/`JWT_KEYS` no `.env` restaurado).

Detalhe que o ensaio pegou (17/10): a imagem do Supabase define privilegios padrao (`ALTER DEFAULT PRIVILEGES ... GRANT ALL ... TO anon, authenticated, service_role` no esquema `public`), e o `pg_dump` so grava os `GRANT`s de cada objeto, nunca os `REVOKE`s que as migracoes fizeram. Sem cuidado, depois do `pg_restore` a chave publica voltava a ler `job_runs` e a executar `enqueue_jobs_tick()`. O `restore.sh` suspende esses padroes durante o `pg_restore`, devolve-os ao final e confere que `anon` continua fechado; se a conferencia falhar, ele para.

### 10.3 Teste de restauracao

Backup que nunca foi restaurado nao e backup. A rotina e: uma vez por trimestre (e depois de toda mudanca no stack), um servidor temporario na Hetzner (pode ser um CX22 por uma hora), restauracao completa e smoke, depois apagar. O ensaio em disco local do 17/10/2026 esta registrado no fim desta secao; o primeiro ensaio num servidor de verdade fica para quando o servidor existir.

Ensaio local de 17/10/2026 (restic em `/tmp/bunker707-restic-local`, stack do item 4): ver "Resultado do ensaio de backup e restore" ao final deste documento.

---

## 11. Atualizar o stack e o Postgres

### 11.1 Servicos do Supabase (imagens)

Na sua maquina, nunca direto no servidor:

```bash
sh infra/scripts/update.sh --check          # tabela: nossa imagem x upstream, e os passos manuais do upgrades.json
sh infra/scripts/update.sh --apply          # reescreve as tags no compose e atualiza volumes/ vendidos
# ensaio local completo (secao 4), git commit, PR para dev, depois promocao para main
```

No servidor, depois do merge:

```bash
sh infra/scripts/backup.sh                                   # sempre antes
git pull --ff-only
docker compose -f infra/compose/docker-compose.yml pull
docker compose -f infra/compose/docker-compose.yml up -d     # recria so o que mudou
sh infra/scripts/smoke.sh
```

O `update.sh` nunca troca a versao maior do Postgres (`db`). O Supabase registra em `docker/upgrades.json` o que exige acao manual (por exemplo, a migracao do Storage 1.81 e irreversivel: backup antes).

### 11.2 Postgres (versao maior, ex.: 17 -> 18)

Procedimento proprio, com janela de manutencao:

1. `backup.sh` e conferir que o snapshot abre (`restic snapshots`).
2. `docker compose stop app` (ninguem grava), `backup.sh` de novo (estado final).
3. `docker compose down`, mover `volumes/db/data` para `volumes/db/data-pg17` (nao apagar), trocar a imagem `supabase/postgres` no compose para a nova versao maior.
4. `docker compose up -d db` (volume vazio: a imagem nova inicializa), devolver a chave do Vault e restaurar como na secao 10.2 a partir do `stage` mais recente (`pg_restore` do `postgres.dump`). O Supabase tambem publica `docker/utils/upgrade-pg17.sh` (upgrade no lugar, com `pg_upgrade`), que vale ler quando a versao seguinte chegar.
5. Subir o resto, `migrate.sh` (nada a aplicar, so confere), smoke, testes de login. Guardar `data-pg17` por uma semana.

---

## 12. Monitoramento

O monitor nao pode morar no mesmo servidor (se ele cair, o alarme cai junto). Duas opcoes:

- **Better Stack** (Uptime, plano gratis: 10 monitores, checagem a cada 3 min, alerta por e-mail; telefone/SMS no pago). Zero manutencao. Recomendado para comecar.
- **Uptime Kuma** (open source) num servidor pequeno fora da Hetzner ou num CX22 em outra regiao (`docker run -d -p 3001:3001 -v uptime-kuma:/app/data louislam/uptime-kuma:2`), com notificacao por Telegram/e-mail. Mais trabalho, sem limite de monitores.

Monitores minimos (em qualquer um dos dois):

| Monitor | Como | Alerta quando |
|---|---|---|
| App | HTTPS `https://membros.bunker707.com.br/api/health`, esperar `"ok":true` | 2 falhas seguidas |
| Auth | HTTPS `https://api.bunker707.com.br/auth/v1/health` com cabecalho `apikey: <sb_publishable_>`, esperar 200 | idem |
| Pagina de login | HTTPS `/login`, palavra-chave "Entrar" | idem |
| Backup | heartbeat/push: `BACKUP_HEARTBEAT_URL` no `.env`, periodo 26 h | nao chegou |
| Certificado | o proprio monitor HTTPS avisa 14 dias antes de vencer | |
| Disco | no servidor, `df -h /` a cada hora num cron que chama outro heartbeat quando < 80% | |

Continuam valendo Sentry (erros do app, `SENTRY_DSN`) e PostHog (produto). Logs no servidor: `docker compose logs --since 1h app`, `... auth`, etc.; a Cloudflare mostra trafego e ataques no painel. O stack nao tem Logflare (aba de logs do Studio desligada): os logs ficam nos containers (rotacao 5 x 20 MB por container, configurada pelo bootstrap).

### 12.1 Teste de carga (etapa `carga`, 19/10/2026, CX23 de 2 vCPU)

Cenario pior que o real: cada aluno virtual abre home, curso, aula e minhas compras em ciclo, com 1 a 4 s entre uma pagina e outra (so o HTML; video e estaticos ficam na Bunny e na Cloudflare). Um aluno de verdade assistindo aula pede uma pagina a cada dezenas de segundos.

| Rodada | Alunos | Mediana | p95 | Paginas/s | Erros |
|---|---|---|---|---|---|
| Antes (Studio ligado, sessao por `getUser`) | 30 | 2,4 s | 3,6 s | 4,9 | 0 |
| Antes | 100 | 14,3 s | 15,8 s | 5,5 | 0 |
| Studio fora e sessao por `claims` | 30 | 0,75 s | 2,1 s | 6,9 | 0 |
| Os dois mais o Envoy checando o PostgREST pela porta | 100 | 7,5 s | 13,6 s | 8,4 | 0 |
| Mais o app: catalogo em cache e paginas de conteudo so pelo JWT | 30 | 0,33 s | 0,5 a 0,8 s | 8,1 | 0 |
| Idem | 100 | 1,9 s | 3,9 s | 18,2 | 0 |

Leitura: depois dos ajustes de servidor (Studio fora, `claims`, Envoy pela porta) e do app (catalogo publicado em `unstable_cache` com a tag `catalog` e paginas de conteudo validando so o JWT, docs/06), o servidor atende cerca de 18 paginas por segundo, mais de 3 vezes as 5,5 do inicio. Com 30 alunos todas as paginas ficam abaixo do limite de 2 s do roteiro (p95 ate 0,8 s); com 100 clicando sem parar a fila ainda cresce (carga 7 a 9 nos 2 vCPU, antes 16 a 18). Nenhum erro e nenhuma sessao perdida em todas as rodadas. Pico de CPU por container na ultima rodada de 100: app 124% (renderizacao do Next, agora o gargalo), Postgres 74%, Auth 27% (so Minhas compras, que segue no `getUser`), Caddy 18%, Envoy 15%, PostgREST 15%. Cada pagina faz 5 chamadas ao PostgREST, todas do aluno (perfil, acessos, favoritos, progresso, papel na equipe); o catalogo so e relido quando o produtor publica ou a cada 60 s. Proximo ganho, se um dia for preciso: renderizacao do app ou um servidor com mais vCPU.

Como repetir: etapa `carga` com `opcoes` `VUS=30 DURACAO=2m PAUSA_MIN=1 PAUSA_MAX=4` ou `VUS=100 DURACAO=3m`. O k6 marca a etapa como falha quando o p95 passa de 2 s (o limite do roteiro); o resumo no fim do log vale mesmo assim.

**Rodada pendente: Comunicacao v2 (`docs/23`, 21/10/2026).** Depois que a `202610200002` e o app da v2 estiverem na producao (o `deploy-membros` aplica a migracao antes de trocar o app), repetir a etapa `carga` com as mesmas duas rodadas e **um fluxo no ar acompanhando uma pagina que os alunos virtuais abrem**, para medir a gravacao de visitas (`after()`, so para paginas acompanhadas, uma por aluno e pagina a cada 60 s) e o filtro do fim no sino. Aceite: p95 de cada pagina e do resumo do sino dentro dos numeros da ultima rodada acima (30 alunos ate 0,8 s; 100 alunos na mesma faixa), nenhum erro, e a fase de fluxos do job `comunicacao` parada em 3 leituras por minuto (`job_runs.metadata.flows` so aparece quando ha trabalho). Montagem segura, sem mandar nada para alunos reais:

1. em Comunicacao > Fluxos, **Começar do zero**, Quem entra com o modo `Só quem entrar no segmento a partir de agora` (ninguem entra ao ativar) e uma Notificacao qualquer; no Objetivo, a regra `Visitou o Início desde que entrou no fluxo` (o curso `carga-*` nasce e morre a cada rodada, entao a pagina dele nao serve sem mudar o `carga.sh`; o Inicio e aberto por todo aluno virtual). Ativar e **Pausar** logo em seguida: pausado, ninguem entra e nada sai, mas a pagina continua acompanhada;
2. rodar a `carga`; conferir `select count(*) from public.member_page_visits where page_key = 'home';` durante a rodada (o aluno `carga@` grava; a conta e apagada no fim e leva as visitas junto);
3. **Encerrar** o fluxo no fim (para de acompanhar a pagina) e anotar os numeros nesta secao.

**Rodada pendente: Comunicacao v3b-2 (`docs/29`, 23/10/2026).** Depois que a `202610260001` e o app da v3b-2 estiverem na producao, repetir a etapa `carga` com **um pop-up de hora marcada** para conferir o pico do `show` no servidor de verdade. No Supabase local (CLI, com o Kong como gateway), 200 `show` todos ao mesmo tempo deram fila de ~2 s e 55 respostas 500 em 1.200, porque o Kong local fecha conexoes acima de ~300 simultaneas; espalhados em 4 s (como o navegador faz), p95 de ~110 ms e nenhum erro (`docs/29` §7.2). Aqui o gateway e o Envoy (secao 2), com limites proprios que ninguem mediu: a rodada diz se o mesmo teto existe. Montagem segura, sem mostrar nada a aluno real: o pop-up precisa alcancar so o aluno `carga@bunker707.test`, e o curso `carga-curso` nasce e morre a cada rodada, entao o `infra/cloud/carga.sh` ganha um passo que, depois de criar o curso, grava o pop-up direto no banco (**Em qualquer pagina**, **Uma vez**, segmento do produto `carga-curso`, **Começa** no meio da rodada e **Termina** 10 minutos depois) e o apaga no `limpar` (mudanca do script numa PR propria, com ok do produtor). Conferir no fim o log do app (nenhum `fetch failed`). Aceite: p95 das paginas dentro da ultima rodada acima e nenhum erro 5xx no `show`. Se aparecer um teto de conexoes no gateway, a mitigacao e um teto de conexoes no `fetch` do servidor (`docs/29` R17).

---

## 13. Incidentes: o que fazer

Primeiro minuto, sempre: `ssh deploy@<ip>`, `cd /opt/bunker707`, `docker compose -f infra/compose/docker-compose.yml ps` e `sh infra/scripts/smoke.sh`. Pela sessao na nuvem (18/10/2026): etapa `status-ssh` (containers, memoria, disco, ultimo backup) e `exec-membros` com `docker compose -f infra/compose/docker-compose.yml ps && sh infra/scripts/smoke.sh`; os comandos da tabela abaixo rodam do mesmo jeito, por `exec-membros` ou `exec-marketing`. Depois, pelo sintoma:

| Sintoma | Verificar | Acao |
|---|---|---|
| App fora (health 5xx/timeout), Supabase ok | `docker compose logs --tail=200 app` | `docker compose restart app`; se e deploy recente, `deploy.sh --image <anterior> --no-migrate` |
| Ninguem consegue entrar | `logs auth`; `smoke.sh` (auth 200?) | `restart auth`; conferir `SMTP_*` se for e-mail; conferir relogio (`timedatectl`) |
| Tudo lento | `docker stats`, `free -h`, `df -h` | memoria: Studio desligado? (8.1); `stop supavisor`; disco cheio: `docker system prune -f`, logs, `stage/` antigos |
| Disco cheio | `df -h`, `du -sh infra/compose/volumes/*` | prune de imagens, apagar `/var/backups/bunker707/stage` antigos, ampliar (volume da Hetzner) |
| Certificado invalido | `logs caddy` | DNS/Cloudflare em Full (strict)? porta 80 aberta? `docker compose restart caddy` |
| Postgres nao sobe | `logs db` | NAO apagar `volumes/db/data`; snapshot do servidor na Hetzner antes de mexer; restaurar do backup num servidor novo (10.2) se preciso |
| Ataque / trafego anormal | painel da Cloudflare | "Under Attack Mode" na Cloudflare; o firewall da Hetzner ja so aceita a Cloudflare |
| Servidor sumiu / corrompido | painel da Hetzner | servidor novo + secao 10.2; tempo esperado: 30 a 60 min |
| Segredo vazou | | gerar so a chave afetada (ex.: `openssl rand -hex 32` para `JOBS_TICK_TOKEN`), atualizar `.env`, `docker compose up -d`; JWT_SECRET/JWT_KEYS novos derrubam todas as sessoes (avisar alunos) |

Reinicio completo e seguro: `docker compose -f infra/compose/docker-compose.yml restart`. Reinicio do servidor: `sudo reboot` (os containers voltam sozinhos, `restart: unless-stopped`).

Registro: todo incidente ganha uma linha em docs/06 (secao Operacao) com data, sintoma, causa e o que mudou.

---

## 14. Migrar da nuvem (Supabase cloud + Vercel) para a Hetzner

**Decisao de 18/10/2026: deploy limpo.** Os dados da nuvem sao de teste (4 contas, 2 na equipe, 1 curso, 8 arquivos, 0 vendas). Nada e exportado nem restaurado. O roteiro, pela IA:

1. `plan`, `provision`, `deploy-membros`, `deploy-marketing`, `secrets-membros`, `secrets-marketing` (secao 4A.3). O `deploy-membros` aplica as migracoes do repositorio num banco vazio e grava o tick de jobs no Vault; o compose ja serve os modelos de e-mail do Auth em portugues e os assuntos (docs/19, secao 2.4), e o `generate-secrets.sh` ja grava `SITE_URL`, redirect, SMTP (host, porta 587, usuario) e limites; a chave `SMTP_PASS` vem no envelope.
2. `equipe`: as contas da equipe sao recriadas por convite por e-mail (sai pelo SMTP do Resend); cada um cria a senha pelo link e entra em `/admin`. Papeis em `public.admin_roles`.
3. Conteudo de teste (1 curso, 8 arquivos): opcional e manual, recadastrado pelo admin se fizer falta; nao ha script de copia.
4. `status` com os quatro enderecos respondendo; teste de "Esqueci minha senha" e de convite; login de um membro da equipe; Studio so de `PRODUCER_IP`.
5. Webhooks: no Resend, trocar o endpoint para `https://membros.bunker707.com.br/api/webhooks/resend` (o segredo `RESEND_WEBHOOK_SECRET` vai no envelope do `secrets-membros`). Hotmart e Ticto: se houver webhook cadastrado apontando para `vercel.app`, trocar para `https://membros.bunker707.com.br/api/webhooks/hotmart` e `.../ticto` e reconectar em Configuracoes > Vendas do servidor novo (o token nao migra).
6. 24 h de observacao: monitor da secao 12, backup diario dos dois servidores rodando, `status-ssh` limpo. Mudou em 19/10/2026: a Vercel e o Supabase da nuvem (`hrtnqcznhdmodjikvddm`) nao sao apagados; viram o ambiente de teste da branch `dev` (`CONTRIBUTING.md`), sem aluno real, e as chaves "Supabase Integration" e "Vercel Integration" do Resend continuam la para o e-mail do teste.

Roteiro com dados reais (referencia de 17/10/2026, caso um dia haja alunos na nuvem antes de migrar), com janela de manutencao de ~1 h:

1. Servidor pronto (secoes 5 a 8) e **testado com dados falsos**; `.env` gerado; imagem do app publicada com `NEXT_PUBLIC_SUPABASE_URL=https://api.bunker707.com.br`.
2. Avisar alunos; colocar a Vercel em manutencao (ou deixar no ar so leitura).
3. Na sua maquina, dump do projeto da nuvem com a CLI (e para isso que ela serve), com a URL direta do projeto (Settings > Database, sessao). O dump leva o hash do hottok da Hotmart (`integration_settings`) e as vendas recebidas (`webhook_events`):
   ```bash
   supabase db dump --db-url "$CLOUD_DB_URL" -f roles.sql --role-only
   supabase db dump --db-url "$CLOUD_DB_URL" -f schema.sql
   supabase db dump --db-url "$CLOUD_DB_URL" -f data.sql --use-copy --data-only
   ```
4. No servidor, pelo tunel SSH (`ssh -L 5433:127.0.0.1:5433 deploy@<ip>`), num banco limpo onde o Auth e o Storage ja subiram uma vez (criaram seus esquemas):
   ```bash
   psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
        --command 'SET session_replication_role = replica' --file data.sql \
        --dbname "postgresql://postgres:<senha>@127.0.0.1:5433/postgres?sslmode=disable"
   ```
   O gatilho `handle_new_auth_user` em `auth.users` (migracao `202607100002`) fica de fora do dump da CLI: recriar rodando o trecho da migracao. `supabase_migrations.schema_migrations` vem no dump; `migrate.sh` depois nao aplica nada.
5. Arquivos do Storage: copiar os objetos do bucket `content-assets` da nuvem para `volumes/storage/<bucket>/...` (script com o cliente S3 do Supabase ou `supabase storage cp`, um bucket por vez); a tabela `storage.objects` veio no dump.
6. Vault: as chaves dos provedores de IA nao migram (criptografadas com a chave da nuvem): recadastrar no admin.
7. Senhas dos alunos migram (hashes em `auth.users`); sessoes nao (JWT novo): todos entram de novo.
8. DNS: `membros` para a Hetzner; Vercel desligada depois de 24 h de observacao; `jobs_tick_url` no Vault do servidor (secao 8).
9. Webhooks de venda e de e-mail, nesta ordem (uma venda que chegar na nuvem durante a janela grava acesso num banco que nao vai migrar; depois de desligar a Vercel, a Hotmart continuaria mandando para `vercel.app` e todas as vendas falhariam):
   - **logo depois do dump do passo 3, e nunca antes** (Desconectar apaga o hash do token e ele precisa estar no dump): em Configuracoes > Vendas da nuvem, clicar em **Desconectar** na Hotmart. Vendas novas passam a receber 503 e nao sao gravadas;
   - no painel da Hotmart (Ferramentas > Webhook), trocar a URL para `https://membros.bunker707.com.br/api/webhooks/hotmart`. O hash do hottok vem no dump; o token continua o mesmo na Hotmart, entao nada a colar de novo;
   - no Resend, trocar o endpoint para `https://membros.bunker707.com.br/api/webhooks/resend` (o segredo e o mesmo, `RESEND_WEBHOOK_SECRET` no `.env` do app);
   - depois da virada, comparar `select external_event_id from public.webhook_events` dos dois bancos; o que ficou so na nuvem e reenviado pela Hotmart (Ferramentas > Webhook > Historico) ou reprocessado pela tela.
   Alternativa: ligar `membros.bunker707.com.br` a Vercel antes da janela e usar esse dominio em `NEXT_PUBLIC_SITE_URL`; a virada vira so DNS e nenhum endereco de webhook muda.

---

## 15. Diferencas em relacao a nuvem (Supabase cloud + Vercel)

| Na nuvem hoje | Na Hetzner | O que muda no dia a dia |
|---|---|---|
| MCP do Supabase (a IA consulta e migra pelo chat) | nao existe | banco se acessa por `psql` via tunel SSH ou pela etapa `exec-membros`, pelo Studio ou por scripts; migracoes so por `migrate.sh` (o `deploy-membros` as aplica) |
| Branches/previews de banco e da Vercel | nao existem | todo teste e no ensaio local (secao 4) ou num servidor temporario |
| Management API, Advisors, logs no painel | nao existem | `docker compose logs`; checagem de RLS continua nos testes do repositorio |
| Backup e PITR do plano | backup proprio diario (10) | restauracao = secao 10.2, sem "voltar para as 14h03" |
| Studio na web com login Supabase | Studio atras de allowlist de IP + usuario/senha | abrir so da maquina do produtor (ou Cloudflare Access) |
| Logflare (aba de logs) | desligado | logs nos containers |
| Deploy automatico da Vercel por push | etapa `deploy-membros` do workflow (imagem + deploy + migracoes + smoke) | um disparo do workflow por versao, pela IA |
| `VERCEL_ENV` no Sentry | `SENTRY_ENVIRONMENT=production` no `.env` | |
| Vercel Speed Insights | nao existe | PostHog e Sentry seguem |
| Regiao `gru1` (Sao Paulo) perto do banco | tudo em Falkenstein; aluno no Brasil tem ~200 ms ate la | Cloudflare guarda estaticos perto do aluno; paginas dinamicas vao a Alemanha |
| E-mail do Auth pelo SMTP da Supabase | SMTP do Resend na 587 | remetente do dominio verificado |
| Chaves anon/service_role no `.env` da Vercel | `sb_publishable_` / `sb_secret_` do stack | mesmas variaveis do app |

**Achado do ensaio (17/10/2026), corrigido no mesmo dia**: o `proxy.ts` ficava na raiz do repositorio e o Next 16.4 so compila `src/proxy.ts` quando o app esta em `src/app`, entao nenhum build (Mac, Docker, Vercel) tinha o proxy: sem CSP com nonce, sem `no-store` e sem redirecionamento na borda. O arquivo foi movido para `src/proxy.ts`, com teste de ponta a ponta do 307 e do cabecalho (`tests/e2e/visitante-barrado-na-borda.spec.ts`). Desde entao o `smoke.sh` exige 307 em `/`; a imagem Docker nao precisou de mudanca, so de rebuild. Se um smoke voltar a ver 200 em `/`, o proxy saiu do build: dentro da imagem, `.next/server/functions-config-manifest.json` precisa ter a entrada `/_middleware` (runtime `nodejs`), e o resumo do `next build` a linha `ƒ Proxy (Middleware)`; o `middleware-manifest.json` fica vazio mesmo com o proxy no ar (so lista proxies no runtime Edge).

---

## 16. Seguranca: checklist do servidor

- [ ] 2FA na conta da Hetzner e no GitHub.
- [ ] SSH so com chave; `PermitRootLogin prohibit-password`; porta 22 fechada fora das etapas do workflow (so `PRODUCER_IP`, se informado; conferir no console da Hetzner > Firewalls depois de um job cancelado); fail2ban ativo.
- [ ] ufw com regras DOCKER-USER (`sudo ufw status`; `sudo iptables -L DOCKER-USER -n` mostra as regras).
- [ ] Nenhuma porta do Supabase em 0.0.0.0: `ss -ltnp` so mostra 22, 80 e 443 fora de 127.0.0.1.
- [ ] `.env` com `chmod 600`, dono `deploy`; nunca no git; `RESTIC_PASSWORD` tambem no gerenciador de senhas.
- [ ] Studio: allowlist de IP valida (`STUDIO_ALLOWED_IPS`), senha longa, desligado fora de uso (8.1).
- [ ] Cloudflare: Full (strict), WAF ligado, registros proxied; o IP do servidor nao aparece em lugar nenhum publico.
- [ ] Backup diario rodando (`systemctl list-timers`), heartbeat no monitor, ultimo `--check` com menos de 7 dias, ultimo teste de restauracao com menos de 3 meses.
- [ ] Atualizacoes automaticas ligadas; `update.sh --check` uma vez por mes.
- [ ] Segredos girados ao sair alguem da equipe com acesso ao servidor.
- [ ] (18/10/2026) `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` so nos segredos do repositorio; token da Cloudflare restrito a zona `bunker707.com.br` e as tres permissoes (docs/19, secao 8); troca do token da Hetzner pelo procedimento da secao 4A.5.
- [ ] (18/10/2026) Nenhum segredo em `opcoes` ou em `payload` de `exec-*`; chaves externas so por envelope (`secrets-*`).
- [ ] (19/10/2026) Quem tem acesso de escrita ao repositorio tem, na pratica, os tokens e root nos servidores: dispara `exec-*` (root via sudo) e pode publicar em qualquer branch um workflow que leia os segredos do repositorio (segredo de repositorio vale para toda branch; branch protection na `main` nao impede). Em 19/10/2026 tinham escrita `danilosouza-dev` (admin), `marketingLendario` (a conta usada pela IA) e `bertoldomolina8-cpu`. Manter so quem opera a infra; ou mover os tokens para um Environment `hetzner` com regra de branch e aprovacao.
- [ ] (18/10/2026) Mautic: `/installer` respondendo 403 de fora (`smoke.sh`); senha do administrador trocada pelo produtor no primeiro login; `MAUTIC_MAILER_DSN` com a chave de envio, nunca a chave com permissao total.
- [ ] (18/10/2026) Dois timers de backup ativos (`bunker707-backup` e `bunker707-mautic-backup`); as duas `RESTIC_PASSWORD` no gerenciador de senhas.

---

## 17. Glossario rapido

- **Caddy**: servidor web que recebe as conexoes, cuida do certificado HTTPS sozinho e repassa para o app ou para o Supabase.
- **Envoy / gateway**: a "porta unica" do Supabase; decide se um pedido vai para Auth, banco, arquivos etc. e confere a chave.
- **Supavisor / pooler**: fila de conexoes ao Postgres, para muitos clientes nao abrirem muitas conexoes.
- **Vault / pgsodium**: cofre dentro do Postgres onde ficam as chaves dos provedores de IA; a chave raiz esta num arquivo que entra no backup.
- **restic**: programa de backup que criptografa e guarda so o que mudou (desduplicacao).
- **Storage Box**: "HD na nuvem" da Hetzner, acessado por SFTP.
- **JWKS**: lista publica das chaves que assinam os tokens de login; permite ao app conferir um token sem perguntar ao Auth.
- **Healthcheck**: pergunta periodica do Docker ao container ("esta bem?"); `docker compose ps` mostra `healthy`.
- **sslip.io**: servico de DNS publico em que `127.0.0.1.sslip.io` responde 127.0.0.1; usado so no ensaio local.
- **Runner (GitHub Actions)**: a maquina temporaria do GitHub em que o workflow roda; e de la que saem as chamadas a Hetzner, a Cloudflare e o SSH para os servidores.
- **Envelope**: arquivo `CHAVE=VALOR` cifrado para a chave publica de um servidor (`transfer.pub`); so a chave privada dele (`transfer.key`) abre.
- **DSN (mailer)**: endereco numa linha que diz ao Mautic como enviar e-mail (`smtp://usuario:senha@host:porta`).
- **Storage Box (hcloud)**: o mesmo "HD na nuvem", agora criado e consultado pela CLI `hcloud storage-box`.

---

## Resultado do ensaio de backup e restore (17/10/2026)

Stack local da secao 4 (escola de teste carregada, aluna logada), restic 0.19 em `/tmp/bunker707-restic-local`:

| Passo | Resultado |
|---|---|
| `backup.sh --init` | repositorio criado (sem Storage Box: alias SSH pulado com aviso) |
| `backup.sh --check` | 3,3 s; export de 1,5 MB (roles 7 KB, schema 609 KB, data 79 KB gz, dump custom 807 KB, chave do Vault, .env); snapshot de 1,44 MiB; `restic check` sem erros |
| retencao | `forget --keep-daily` removeu um snapshot vazio de uma tentativa anterior no mesmo dia |
| `restore.sh --snapshot latest --yes` | 43 s: banco apagado e recriado, chave do Vault devolvida, papeis, `pg_restore` sem avisos, 6 contas no Auth, ultima migracao `202610170001`, Storage copiado, stack no ar, smoke com 11 verificacoes ok |
| sessao da aluna | continuou valida depois da restauracao (mesmas chaves JWT); a home abriu com os cursos |
| primeira tentativa de restore | smoke reprovou: `anon` lendo `job_runs` (200 em vez de 401), causa e correcao descritas na secao 10.2 |

Nao ensaiado ainda (precisa de servidor e Storage Box reais): SFTP para o Storage Box, timer do systemd, `bootstrap.sh`, firewall da Hetzner, Caddy com TLS de verdade e Cloudflare na frente. Em 18/10/2026 tambem nao ensaiados: `infra/cloud/*` contra a API real da Hetzner e da Cloudflare, e o stack do Mautic com Docker. O que foi conferido em 18/10/2026 sem Docker: `docker compose config` nos tres composes, Caddy 2.11.7 validando os dois Caddyfiles, ida e volta do envelope (`envelope.sh encrypt` e `decrypt`) e a chave derivada aceita pelo `ssh-keygen`. O primeiro ensaio real e o proprio `provision` + `deploy-*`, com os logs lidos pela IA.
