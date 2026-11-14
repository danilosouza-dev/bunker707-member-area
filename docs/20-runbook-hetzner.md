# 20. Runbook: Bunker707 na Hetzner (servidor proprio)

Data: 17/10/2026; atualizado em 18/10/2026. **Desde 03/11/2026 a producao (A, B e C) fica guardada em snapshot e so e ligada para os testes da equipe (secao 4A.7).** Estado em 18/10/2026: **decisao tomada de migrar agora** (docs/19, secao 0), em dois servidores (membros e marketing), executada pela IA pelo workflow do GitHub Actions (secao 4A). Nada e criado na Hetzner ate a etapa `provision` rodar com o ok do produtor no chat; a partir dela custa dinheiro. As secoes 5 a 8 dizem o que as etapas fazem e mantem o caminho manual como referencia. As secoes 4A e 8A foram acrescentadas em 18/10/2026 sem renumerar as demais.

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
| Migrador do kit (11/11/2026) | `infra/kit/migrar.sh`, `infra/kit/migrador.sql` | migracoes sem a CLI no servidor do comprador, com o mesmo historico dela (secao 9A) |
| Backup e recuperacao do kit (11/11/2026) | `infra/kit/membros` e os scripts dele, `infra/kit/kit.conf` | backup para o destino do comprador (S3, SFTP ou pasta), kit de recuperacao, ensaio de restauracao isolado, restauracao num servidor novo e a situacao sem segredo (secao 9B) |
| Deploy | `infra/scripts/deploy.sh` | troca a imagem, migra, recria o app, smoke, volta atras |
| Backup / restore | `infra/scripts/backup.sh`, `restore.sh`, `infra/systemd/` | restic -> Storage Box (SFTP), retencao 30 dias, restauracao em servidor limpo com smoke |
| Atualizacao do stack | `infra/scripts/update.sh` | compara e reescreve as imagens com o compose oficial do Supabase |
| Teste de fumaca | `infra/scripts/smoke.sh` | app, Auth, REST, Storage, Realtime, Studio fechado |
| Servidor como codigo (opcional) | `infra/terraform/` | servidor + firewall + volume; validado, nao aplicado; substituido por `infra/cloud` em 18/10/2026 (fica como referencia) |
| Provisionamento e operacao pela nuvem (18/10/2026) | `infra/cloud/` (`run.sh`, `plan.sh`, `provision.sh`, `deploy.sh`, `secrets.sh`, `envelope.sh`, `equipe.sh`, `status.sh`, `lib.sh`, `deploy-key.mjs`, `cloud-init.yaml`) | cria servidores, firewalls, Storage Box e DNS pela API; bootstrap, deploy, segredos por envelope, equipe e status por SSH, com a porta 22 aberta so durante a etapa |
| Workflow (18/10/2026) | `.github/workflows/infra.yml` | `Infra (Hetzner)`: disparo manual por etapa, com `HCLOUD_TOKEN` e `CLOUDFLARE_API_TOKEN` dos segredos do repositorio; uma etapa por vez |
| Mautic (18/10/2026) | `infra/mautic/` (`docker-compose.yml`, `compose.colocado.yml`, `.env.example`, `generate-secrets.sh/.mjs`, `caddy/Caddyfile`, `cron/mautic`, `scripts/{install,smoke,backup,restore}.sh`) | Mautic 7.2.1 + MySQL 8.4.11 + Caddy no servidor B; instalacao sem instalador web; cron e worker; backup proprio |

**Ensaio local feito em 17/10/2026** (Mac M-series, Docker Desktop): `docker compose up` sobe os 13 containers em cerca de 25 s, as 37 migracoes do repositorio aplicam em 3,5 s no Postgres 17, a escola de teste entra pelo gateway, a aluna de teste faz login pelo navegador e abre a home com "Minhas compras". RAM ociosa: **1,27 GiB** no total (secao 4.3).

**Custo estimado por mes** (precos de referencia de 17/10/2026, docs/19, secao 0.6; conferir no `plan`): com estoque da linha CX, CX33 (EUR 8,49) + CX23 (EUR 5,49) + 2 IPv4 (EUR 1,00) + Storage Box bx11 (EUR 3,20) = EUR 18,18. Sem estoque, CPX32 (EUR 35,49) ou CCX13 (EUR 42,99) para o servidor A e o menor tipo com 4 GB que o `plan` listar para o B. Servidor desligado continua cobrando; o jeito barato de "pausar" e snapshot + apagar, e desde 03/11/2026 a producao fica guardada assim fora dos testes da equipe (secao 4A.7).

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
.github/workflows/pacote-escola.yml  o pacote da escola de um fundador, como artefato privado (11/11/2026; secao 9D.6)
infra/
  compose/
    docker-compose.yml          o stack inteiro
    docker-compose.kit.yml      (11/11/2026) o compose do kit, no servidor do comprador: sem Realtime, Supavisor, Edge
                                Runtime, Studio e meta; imagens pelo resumo; nomes do kit.conf (secao 9C)
    .env.example                todas as variaveis, comentadas; nunca com valor real
    generate-secrets.sh/.mjs    gera o .env (modo --local ou --domain ...)
    caddy/Caddyfile             sites do Caddy
    caddy/cloudflare-trusted-proxies.caddyfile  faixas da Cloudflare (IP real do visitante)
    caddy/Caddyfile.kit, caddy/frente/  o Caddy do kit: certificado direto, modelos na rede interna, Cloudflare opcional
    volumes/                    arquivos copiados do Supabase oficial (Envoy, SQL de init, pooler, functions)
    UPSTREAM.md                 de que commit do supabase/supabase os arquivos vieram
  scripts/
    bootstrap.sh                prepara o servidor (root): perfil producao (Ubuntu 24.04 na Hetzner) e kit (secao 9C)
    hetzner-firewall.sh         firewall da Hetzner pela CLI hcloud (roda na sua maquina)
    cloudflare-ips.sh           faixas da Cloudflare (texto, --caddy, --json)
    migrate.sh                  supabase db push --db-url no banco do stack
    deploy.sh                   nova versao do app (imagem do ghcr.io ou build local)
    smoke.sh                    teste de fumaca
    backup.sh                   backup diario (restic -> Storage Box); --init, --check, --install-timer
    restore.sh                  restauracao em servidor limpo + smoke
    update.sh                   compara/reescreve as imagens com o compose oficial
    lib.sh                      funcoes comuns (le o .env chave a chave, espera healthcheck...)
  kit/                          (11/11/2026) o kit do produto licenciado (docs/32 §11.6 e §11.7; secao 9A)
    migrar.sh                   migracoes sem a CLI: psql no container do banco, trava, um arquivo por transacao
    migrador.sql                ferramentas de SQL da sessao (pg_temp): divisor de comandos da CLI, plano e conferencia
    membros                     o comando de operacao do Bunker Members: status, backup, restaurar, kit-de-recuperacao (9B)
    kit.conf                    os nomes tecnicos do kit num arquivo so (padrao neutro, membros; A10)
    lib-kit.sh, kit.py          funcoes comuns: destino, trava, situacao sem segredo, folha, veredito do ensaio
    backup.sh, recuperacao.sh   backup diario e kit de recuperacao
    ensaio.sh, restaurar.sh     ensaio de restauracao isolado e restauracao num servidor novo
    status.sh                   a situacao, sem sudo e sem rede
    preparar-servidor.sh        o preparo do servidor do comprador: o bootstrap.sh no perfil kit (secao 9C)
    fixar-imagens.mjs           resolve os resumos das imagens do compose do kit a partir das tags da producao
    instalar, instalador.py     o instalador de um comando (secao 9D)
    montar-pacote.mjs           o Pacote da versao (do nosso lado; nao vai no pacote)
    pacote-escola.mjs           os valores publicos do pacote de um fundador (do nosso lado; secao 9D.6)
    conferir-imagem.mjs         as guardas da imagem do pacote de um fundador (do nosso lado; secao 9D.6)
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
    licencas.sh                 (10/11/2026) servidor do Emissor de licencas: plan, dns, cerimonia, segredos, deploy,
                                backup, restaurar, ensaio e status (secao 8C); a criacao e o provision.sh licencas
    licencas-chave.mjs          confere no runner a chave de emissao, o certificado e as raizes antes do secrets-licencas
    cerimonia-licencas.mjs      a cerimonia das chaves, dentro da imagem do Emissor, sem rede (secao 8C.8)
    teste.sh                    (11/11/2026) o ensaio de comprador real no servidor bunker707-teste (secao 9E)
  licencas/                     (10/11/2026) o lado nosso do servidor bunker707-licencas (secao 8C)
    docker-compose.yml          so o Caddy, na rede do servidor; o Emissor sobe pelo compose do bunker-licensing
    caddy/Caddyfile             a API (sem proxy da Cloudflare) e o Painel (login do proprio Painel, D40), cada um numa porta
    .env.example                as variaveis do lado nosso no servidor (nomes, portas, backup)
    scripts/                    _env.sh, implantar.sh, backup.sh (de hora em hora), restore.sh (e --ensaio), smoke.sh,
                                conta-do-produtor.sh (a conta do produtor no Painel, no deploy)
    raizes.json                 as raizes publicas que a cerimonia-licencas imprime (num commit; secao 8C.8)
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
| `plan-licencas`, `provision-licencas`, `dns-licencas`, `cerimonia-licencas`, `secrets-licencas`, `deploy-licencas`, `conectar-licencas`, `backup-licencas`, `restaurar-licencas`, `ensaio-licencas`, `status-licencas`, `exec-licencas` | o servidor do Emissor de licencas, `bunker707-licencas` (secao 8C). Todas, menos `plan-licencas` e `status-licencas`, so rodam da `main`; criar pede `CONFIRMADO=sim` depois do ok do produtor, restaurar pede `CONFIRMAR=restaurar` e ligar a nossa escola a API interna do Emissor pede `CONFIRMAR=conectar` (8C.9). O snapshot e o restaurar da producao nunca tocam neste servidor | `HCLOUD_TOKEN`; DNS, deploy e conectar tambem `CLOUDFLARE_API_TOKEN`; os segredos `LICENCAS_*` (secao 8C.5) |
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

Decisao de 18/10/2026, revista em 19/10/2026 (servidores ligados, por causa do estoque intermitente do CX23) e **retomada pelo produtor em 03/11/2026**: enquanto a producao so servir para a equipe testar (nenhum aluno, nenhuma venda), ela fica guardada em snapshot e so e ligada quando a equipe precisar dela, como o gravador por hora (§8B.5). Na Hetzner, servidor desligado e cobrado por inteiro (docs/19 §3.4); o jeito barato de guardar e snapshot + apagar (EUR 0,0143 por GB comprimido por mes). Ligada, a producao custa cerca de EUR 25 por mes sem IVA (tres CX23, tres IPv4 e o Storage Box); guardada, cerca de EUR 4,50 (o Storage Box fica, com os backups), ou menos de EUR 0,50 sem ele. **No dia em que entrarem alunos ou vendas reais, a producao volta a ficar ligada o tempo todo**: guardada, o aluno nao entra, a venda chega num servidor que nao existe e o acesso nao e liberado, e o tick (avisos, pop-ups, fluxos) para.

**Guardar: etapa `snapshot` com `CONFIRMAR=apagar`** (`PAPEIS=meet`, `marketing` ou `membros` guarda so os pedidos, varios separados por virgula, como `PAPEIS=membros,marketing`, porque as opcoes do workflow sao separadas por espaco; padrao, os tres). Para cada papel que existe:

1. backup novo do A e do B no Storage Box (o C nao guarda dado de aluno). Se falhar, a etapa para antes de apagar qualquer coisa (`SEM_BACKUP=1` pula, so com motivo);
2. desliga pelo sistema (ACPI: o Postgres fecha limpo; so corta a energia se o servidor nao responder em cerca de 3 min);
3. snapshot com as labels `app=bunker707`, `papel`, `origem`, `tipo` e `local` (o tipo e o local de origem, que o `restaurar` usa);
4. o servidor so e apagado com o snapshot disponivel, e o snapshot fica protegido contra exclusao. Se o snapshot nao ficar pronto, nada e apagado e o servidor volta a ligar;
5. os registros DNS do papel somem (os nomes param de responder);
6. ficam os `MANTER_SNAPSHOTS` (2) mais novos do papel; o mais velho sai.

Com um gravador vivo o C nao e guardado (`FORCAR=1` passa por cima). Firewalls, chave SSH e Storage Box ficam. `APAGAR_STORAGE_BOX=1` apaga o box com os backups: nao usar antes de uma volta conferida, e so com o ok do produtor.

**Duas copias independentes antes de cada servidor sumir**: o snapshot (Hetzner, mesmo projeto, protegido) e o backup restic no Storage Box (hel1, outro datacenter, com 30 dias de backups e snapshots diarios do proprio box). Se um snapshot nao voltar, ha o anterior (ficam 2) e, por ultimo, o caminho da secao 10.2 (servidor novo + backup).

**Trazer de volta: etapa `restaurar`** (`PAPEIS=meet` traz so o Jitsi, por exemplo para um teste de live na dev). Para cada papel com snapshot e sem servidor:

1. o tipo e o do servidor de origem (label `tipo`, hoje `cx23`), tentado no local de origem e depois em `LOCATION` e `FALLBACK_LOCATIONS`; `MEMBROS_TYPE`, `MARKETING_TYPE` ou `MEET_TYPE` forcam outro, com o ok do produtor. **Sem estoque do tipo em nenhum local, a etapa para e avisa: nunca sobe sozinha num tipo mais caro.** Um disco maior tambem nao volta mais para o tipo pequeno (o snapshot so cabe num disco do mesmo tamanho ou maior);
2. firewall, DNS do papel (o `meet` sem proxy), stacks de pe com `up -d`, saude e smoke; no C, `JVB_ADVERTISE_IPS` passa a ser o IP novo (o Jitsi anuncia o IP publico para a midia);
3. avisa quando o commit no servidor e outro que o do checkout: `deploy-membros` da `main` (ou `deploy-meet` com `SEM_LIVE_2H=sim`).

Os certificados do Caddy, o banco, os `.env`, os timers de backup e a chave de transferencia vem no snapshot, e o snapshot continua guardado depois da volta. A cobranca e por hora a partir da criacao (cerca de EUR 0,01 por hora por CX23). O `status` lista os snapshots com o custo; `deploy-*` e `jibri-up` com o servidor guardado param com "rode restaurar".

**Rotina da equipe.** As promocoes para a `main` seguem normais; o deploy so acontece com a producao ligada: `restaurar` -> `deploy-membros` (aplica de uma vez todas as migracoes pendentes) -> `status` -> testar -> `snapshot` com `CONFIRMAR=apagar`. Teste de live na dev (o C atende a Vercel tambem): `restaurar` com `PAPEIS=meet` (cerca de 15 min), testar, `snapshot` com `CONFIRMAR=apagar PAPEIS=meet`. Risco que fica: o estoque do CX23 e intermitente; num dia de teste da para esperar, e no lancamento a producao e ligada alguns dias antes.

Sem snapshot nenhum, o caminho equivalente e `provision` + `deploy-*` do zero, que leva uns 20 minutos (e nasce sem os dados).

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

Desde 11/11/2026 o mesmo script tem dois perfis: sem `PERFIL` (como o `provision` chama) e o de sempre, descrito acima; `PERFIL=kit` e o servidor de um comprador, sempre pelo `infra/kit/preparar-servidor.sh` (secao 9C). Nos dois, `--simular` mostra o que faria sem mudar nada, rodar de novo nao reinicia servico nem regrava arquivo que ja esta certo, a chave do repositorio do Docker e conferida pela impressao digital e o `daemon.json` ganha a rotacao de log sem perder o que ja tinha.

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

O desenho esta no `docs/30` §6 e §7; aqui fica so a operacao. **Desde 03/11/2026 o C fica guardado em snapshot junto com a producao (§4A.7)**: para uma live (na dev ou na producao), `restaurar` com `PAPEIS=meet` antes e `snapshot` com `CONFIRMAR=apagar PAPEIS=meet` depois; o `jibri-up` com o C guardado para com "rode restaurar". **Estado em 29/10/2026**: o C existe (`provision-meet`
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
barrar na sala (o token de 15 min continua valendo). **Gravacao automatica (D) ligada em 31/10/2026**: o produtor criou o
segredo `JIBRI_SECRETS` (biblioteca "Lives Bunker 707" da Bunny Stream, Frankfurt com replica em Sao Paulo; o segredo do
webhook; o `GITHUB_INFRA_TOKEN` fine-grained da conta dona do repositorio, so "Actions: Read and write" neste repositorio,
com validade de 1 ano: renovar antes de vencer e rodar de novo o `secrets-membros` com `DO_JIBRI=sim`) e as chaves foram
para o app pelo `secrets-membros` com `DO_JIBRI=sim`. Sem o token valido, o console volta a oferecer a reserva (Gravar
no navegador ou Enviar gravacao).

### 8B.1 O que e cada servidor e quanto custa

| Servidor | Papel | Tipo | Cobranca |
|---|---|---|---|
| C, `bunker707-meet` | a Live ao vivo: Jitsi proprio (web, prosody, jicofo, jvb) atras do Caddy, em `meet.<dominio>` | cx23 (`MEET_TYPE`) | por hora enquanto existir, com teto mensal (preco lido pela API na hora; referencia `docs/30` §7.5); desde 03/11/2026 guardado em snapshot fora das lives e dos testes (§4A.7) |
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
- **A foto do Perfil na miniatura (13/11/2026, `docs/30` D115)**: o Prosody carrega tambem o nosso
  `bunker_presence_guard` (a presenca de cada um leva so a foto do token e nunca o video compartilhado). O
  `deploy-meet` acrescenta o modulo ao `XMPP_MUC_MODULES` do `.env` do C quando falta, sem tirar os outros, e o compose
  recria o prosody (o ambiente mudou; o `reconnect_focus` reinicia o jicofo). Vale como qualquer `deploy-meet`: da
  `main`, com `SEM_LIVE_2H=sim`, e com o C restaurado do snapshot antes (`restaurar` com `PAPEIS=meet`, §4A.7).
  Conferir depois: numa sala de teste com duas contas, a miniatura de quem tem foto no Perfil mostra a foto; no C,
  `exec-meet` com `docker compose logs prosody | grep -i presence_guard` nao mostra erro ao carregar.
- **A miniatura que nao se repete quando alguem volta a sala (13/11/2026, `docs/30` D122)**: o Prosody carrega tambem
  o nosso `bunker_ghost_guard` (`infra/jitsi/prosody/plugins/mod_bunker_ghost_guard.lua`). Quando a conexao de alguem
  cai sem o motor se despedir, o Prosody guarda a sessao por 60 s (`mod_smacks`) e a pessoa continua na sala; o modulo
  tira essa entrada antiga na hora em que a mesma conta do token entra de novo (so a entrada com todas as conexoes
  caidas; duas abas abertas da mesma conta continuam). O `deploy-meet` acrescenta o modulo ao `XMPP_MUC_MODULES` do
  `.env` do C quando falta, como o `bunker_presence_guard`, e o compose recria o prosody: da `main`, com
  `SEM_LIVE_2H=sim` e o ok do produtor. Conferir depois: o roteiro 14 do `docs/30` §10.3; no C, `exec-meet` com
  `docker compose logs prosody | grep -i "ghost_guard\|entrada antiga"` mostra uma linha "entrada antiga da mesma
  conta saiu" a cada volta e nenhum erro ao carregar.
- **O Jicofo sem dar papel a ninguem (13/11/2026, `docs/30` D116)**: o servico `jicofo` do compose leva
  `JICOFO_ENABLE_AUTH=0` (o padrao do compose ja e 0, entao vale no C sem mexer no `.env`). Com a autenticacao do
  Jicofo ligada, todo token valido virava dono da sala, o do aluno tambem. Vale como qualquer `deploy-meet`: da
  `main`, com `SEM_LIVE_2H=sim`, e com o C restaurado do snapshot antes (`restaurar` com `PAPEIS=meet`, §4A.7); o
  compose recria o jicofo (o ambiente mudou). Conferir depois: o `smoke.sh` do `deploy-meet` mostra
  `ok jicofo sem dar papel (JICOFO_ENABLE_AUTH=0)`; numa sala de teste com duas contas, o **Liberar** e o
  **Silenciar** do microfone, o **Fechar cameras** e a mao levantada funcionam, e a miniatura do aluno nao leva o
  icone de moderador.
- **Os participantes simulados nas miniaturas (13/11/2026, `docs/30` D120 e §6.9)**: o `web` do C serve tambem
  `/libs/bunker707-plateia.js` (montado pelo compose, somente leitura), e o `custom-config.js` o liga so no iframe do
  nosso app e no gravador. Vale como qualquer `deploy-meet`: da `main`, com `SEM_LIVE_2H=sim`; o deploy recria o `web`
  e o `smoke.sh` confere o arquivo servido pelo sha256 e o `?v=` no `config.js`. Conferir depois, numa sala de teste
  com duas contas e participantes simulados ligados: a lista de miniaturas do aluno na ordem do `docs/30` §10.3 (item
  13), o console sem simulado nenhum no video e, com a gravacao ligada, as miniaturas simuladas no video gravado.
- O `.env` do C leva `XMPP_MUC_MODULES=token_affiliation,bunker_room_guard,bunker_presence_guard,bunker_ghost_guard` e `ROOM_GUARD_URL=<origem da area de
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
- **As chaves do app que repetem o gravador vem do proprio `JIBRI_SECRETS`** (30/10/2026): `secrets-membros` com
  `opcoes` `DO_JIBRI=sim` e sem `payload` copia para o `.env` do app, pelo SSH, `BUNNY_API_KEY` -> `BUNNY_STREAM_API_KEY`,
  `BUNNY_LIBRARY_ID` -> `BUNNY_STREAM_LIBRARY_ID`, `WEBINAR_RECORDER_WEBHOOK_SECRET` e `GITHUB_INFRA_TOKEN` (so as linhas
  presentes; `app_env_from_jibri` em `infra/cloud/lib.sh`, valores mascarados no log). Assim o produtor cadastra um segredo
  so, na tela do GitHub, e nada passa pelo chat. O `GITHUB_INFRA_TOKEN` pode ficar no `JIBRI_SECRETS`: o gravador le so as
  chaves dele. O `WEBINAR_RECORDER_WEBHOOK_SECRET` do app de producao foi gerado em 30/10/2026 e entregue ao produtor num
  arquivo, para o `JIBRI_SECRETS`.
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
- **Falha no preparo (correcao de 03/11/2026)**: o `jibri-up` que falha depois de criar a maquina, antes do HEALTHY, apaga a maquina e o firewall dela, refaz a 5222 do C e avisa `unavailable` (o console mostra a reserva na hora). Para investigar uma falha, rode de novo com `MANTER_SE_FALHAR=1`: a maquina fica, e depois `jibri-down`. Um gravador que ja existia nunca e apagado pelo `jibri-up`. A causa de 03/11 (o SSH reaproveitado sem o grupo `docker`, `permission denied` no `docker compose up`) foi corrigida: o `jibri-up` troca de conexao depois do cloud-init e confere `docker info`.
- **Saude do gravador (correcao de 13/11/2026)**: o Jibri so escuta a API HTTP no `127.0.0.1` do proprio container, entao a saude e sempre perguntada por dentro: `exec-jibri` com `COMANDO='bash jibri-status.sh'`, ou direto `COMANDO='docker compose exec -T jibri curl -fsS http://127.0.0.1:2222/jibri/api/v1.0/health'`. Um `curl` da propria maquina para a 2222 nunca responde, e isso nao quer dizer que o gravador esta fora (em 13/11 o `jibri-up` perguntava assim, desistia de um gravador saudavel em 5 min e apagava a maquina; o app recebia `unavailable`). Nenhuma porta do gravador e publicada. `JIBRI_SINGLE_USE_MODE` e sempre `false` ou `true`: com `0` ou `1` o Jibri nao volta a ficar livre depois da primeira gravacao (`docs/30` §6.7).
- **O preparo demora cerca de 3 min** do pedido ao `ready` (medido em 13/11/2026, no primeiro preparo que chegou ao fim: 3 min 14 s; a maquina em 15 s, o Docker e a imagem perto de 2 min, o gravador saudavel em 6 s). Passou muito disso, olhe a execucao do `jibri-up` no workflow antes de pedir de novo. A primeira gravacao de verdade (150 s, 4,0 MB) chegou a Bunny na primeira tentativa e o app pediu o `jibri-down` sozinho (`docs/21` §10.2).
- O `jibri-down` aceita `preparing` como "nao houve gravacao" (o MP4 na maquina continua conferido). O job do app pede sozinho o `jibri-down` com `SO_SE_PREPARANDO=sim` para o preparo abandonado (`preparing` ha mais de 70 min): ele so apaga se o app ainda disser `preparing`, entao o gravador que ficou pronto nesse meio tempo fica (`docs/30` §6.7).

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
| Aluno com poder de moderador no motor (remove ou silencia outro pelo navegador; a miniatura dele leva o icone de moderador) | o `smoke.sh` do C falha em `jicofo sem dar papel`: o servico `jicofo` precisa de `JICOFO_ENABLE_AUTH=0` (`docs/30` D116); `exec-meet` com `docker compose exec -T jicofo grep -c "authentication {" /run/jicofo/config/jicofo.conf` tem de responder 0; se responder 1, `deploy-meet` de novo da `main` |
| Apresentador entra como participante, nao como moderador | `XMPP_MUC_MODULES=token_affiliation` e `ENABLE_AUTO_OWNER=0` no `.env` do C; o claim `moderator` vem do papel no app (o Apresentador precisa de `messaging.publish`; a Equipe so com "Pode remover e silenciar na sala"); `exec-meet` com `docker compose logs prosody`. Nunca imprimir o token nem a chave |
| "Gravacao pronta" nao chega (o console fica em Preparando) | o Jibri no brewery? a regra 5222 do C para o IP do gravador? `exec-jibri` com `docker compose logs jibri`; o webhook recusou? `webinar_recording_events` da sessao (o motivo do `ignored` em `error_message`; 401 nao grava linha: conferir `WEBINAR_RECORDER_WEBHOOK_SECRET` igual no app e no `JIBRI_SECRETS`); refazer `jibri-up` |
| Hetzner sem estoque para o gravador | log do `jibri-up` ("unavailable" nos locais e tipos de reserva); o console mostra "Sem gravador hoje: gravar no navegador": gravar no navegador ou no OBS e ligar o video pelo console (**Enviar gravacao**) |
| Envio para a Bunny falhou (`upload_failed`) | o e-mail "A gravacao nao subiu" chega ao Apresentador; arquivo em `/opt/jibri/recordings` (`exec-jibri`); reenviar como em §8B.5 ou subir pelo painel da Bunny e ligar pelo console; so entao `jibri-down` com `FORCAR=1` |
| Certificado do `meet` invalido | `docker compose logs caddy` no C; o registro DNS so DNS (sem proxy); porta 80 aberta; `docker compose restart caddy` |
| O servidor C sumiu | painel da Hetzner; o plano B "Live gravada do dia" (§8B.7) e o aviso pelo sino; reprovisionar com `provision-meet` + `deploy-meet` + `secrets-meet` (o DNS e refeito pelo `cf_apply_dns`) |
| A miniatura mostra as iniciais de quem tem foto no Perfil | o `custom-config.js` servido (`https://meet.<dominio>/config.js`) termina com `config.disableThirdPartyRequests = false`; `XMPP_MUC_MODULES` com `bunker_presence_guard` no `.env` do C e `docker compose logs prosody` sem erro do modulo; a foto e a enviada pelo Perfil (a do Google vira iniciais, `docs/30` D115); o motor le a foto so na entrada |
| As miniaturas dos participantes simulados nao aparecem para o aluno | o numero de simulados esta acima de zero no selo dos presentes? `https://meet.<dominio>/config.js` termina com o carregador `bunker707:plateia-loader` e `https://meet.<dominio>/libs/bunker707-plateia.js` responde 200 (o `smoke.sh` confere os dois)? o iframe e o do nosso app (a chave do tema no hash)? `GET /api/webinars/<id>/audience?sessao=<id>` responde `enabled: true` (sem a decisao registrada ou com a live encerrada, `false`)? no celular a sala nao mostra miniaturas (`docs/30` D120) |
| A miniatura de quem saiu e voltou aparece duas vezes (some sozinha em ate 1 min) | `XMPP_MUC_MODULES` do `.env` do C tem `bunker_ghost_guard`? (`deploy-meet` da `main` acrescenta); `exec-meet` com `docker compose logs prosody \| grep -i ghost_guard`: erro ao carregar = o arquivo `mod_bunker_ghost_guard.lua` nao chegou a `infra/jitsi/prosody/plugins`; sem a linha "entrada antiga da mesma conta saiu" na volta = a conexao antiga ainda nao tinha caido para o servidor (a rede cortada sem aviso: sai sozinha no prazo) ou sao duas abas abertas da mesma conta (`docs/30` A56) |
| A live caiu para todos por cerca de 1 min perto das 02:30 de Brasilia (05:30 UTC) e voltou sozinha | o reinicio automatico das atualizacoes de seguranca (`Unattended-Upgrade::Automatic-Reboot-Time "05:30"`, `infra/scripts/bootstrap.sh`), que roda nos servidores A e C quando uma atualizacao pede: `exec-membros` e `exec-meet` com `docker inspect -f '{{.State.StartedAt}}' <container>` mostram todos os containers de pe desde 05:30 e pouco. Visto em 14/11/2026 num teste do produtor. O console de antes do `docs/30` D123 ficava com os botoes desligados depois disso: reabrir a pagina resolve. Mudar o horario ou segurar o reinicio com live no ar: `docs/30` A58 |
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

## 8C. Emissor de licencas: o servidor `bunker707-licencas` (10/11/2026)

O desenho esta no `docs/32` (§10, §11.2 e D39; o codigo, no repositorio privado `bunker-licensing`); aqui fica so a
operacao. **Decisao do produtor (D39):** o Emissor e o Painel de licencas rodam num servidor so deles desde o comeco, o
tipo e o local mais baratos da Hetzner, mesmo que mais lento, porque so a equipe abre o Painel e as Instalacoes conferem
uma vez por dia. **Estado em 11/11/2026: as etapas existem e foram testadas so com a Hetzner e a Cloudflare de mentira
(`tests/infra-licencas*.test.mjs`); nada foi criado.** Em 11/11/2026 o `deploy-licencas` passou a configurar o Painel e
a conta de envio do Emissor (8C.5), que chegaram ao `bunker-licensing` depois das etapas. Nada e criado nem cobrado sem
o ok do produtor no chat.

### 8C.1 O que roda e quanto custa

| Peca | Onde | Observacao |
|---|---|---|
| Servidor | `bunker707-licencas`, o mais barato que o `plan-licencas` acha no dia, x86 ou ARM, em qualquer local que a API informa | minimo: 2 GB de memoria, 20 GB de disco, 1 vCPU (`LICENCAS_MIN_*`). O Emissor (Node, com o Painel no mesmo processo) usa uns 100 a 200 MB; o Postgres 16 com o banco pequeno, 50 a 150 MB; o Caddy, uns 30 MB; Docker e Ubuntu, uns 400 MB. Os 2 GB deixam folga para o `pg_dump`, o restic, o `apt` e a troca de imagem (o bootstrap ainda poe 2 GB de swap). Disco nao pesa: todo tipo da Hetzner tem 40 GB ou mais |
| IPv4 | um, obrigatorio | a API e a conferencia inicial so falam IPv4 (`docs/32` §11.2) |
| Emissor (com o Painel) e Postgres 16 | `/opt/bunker707/emissor` (compose.yaml do `bunker-licensing`, `.env` e `segredos/`) | a imagem vem do GHCR (8C.2); nada e construido no servidor. O Painel e o mesmo processo do Emissor, noutra porta (8C.4), e a fila de e-mail envia pelo Resend (8C.5) |
| Caddy 2.11.7 | `infra/licencas/docker-compose.yml`, na rede do servidor | as duas portas locais do compose do Emissor (8C.4) |
| Backup | o Storage Box que ja existe (`bunker707-backups`), repositorio `bunker707/restic-licencas` | de hora em hora (8C.6) |

**Custo, a confirmar com o produtor antes do `provision-licencas`:** o preco do dia sai do `plan-licencas` (sem IVA),
mais o IPv4 (cerca de EUR 0,50 por mes). Referencia conhecida: o CX23 (x86, 4 GB) custava EUR 6,49 por mes pela API em
19/10/2026 (docs/21 §8); um ARM (CAX) ou outro local pode sair mais barato, e o plano escolhe sozinho. O Storage Box nao
muda de preco (o banco do Emissor tem poucos MB). Sem snapshot: o servidor fica ligado o tempo todo, porque as
Instalacoes dos compradores dependem dele. Com o servidor no ar, a cobranca e por hora ate o teto do mes.

### 8C.2 A imagem do Emissor e os arquivos de implantacao (GHCR)

Como a producao hoje (secao 9): a imagem e construida no GitHub e o servidor so puxa, entrando no GHCR com o
`GITHUB_TOKEN` efemero do job (vence com ele) e saindo no fim. A diferenca e que a imagem do Emissor e publicada pelo
CI do proprio `bunker-licensing`, e o `deploy-licencas` deste repositorio a puxa:

- `ghcr.io/danilosouza-dev/bunker-licensing:<tag>` (`main` e `sha-<commit>`), amd64 e arm64;
- `ghcr.io/danilosouza-dev/bunker-licensing:<tag>-implantacao`, uma imagem sem programa com o `compose.yaml` e o
  `.env.example` do mesmo commit, que o deploy copia para `/opt/bunker707/emissor`. Assim o servidor roda sempre o
  compose do mesmo commit da imagem, sem copia dele aqui e sem clonar o repositorio privado.

Duas coisas fora deste repositorio, antes do primeiro `deploy-licencas` (a IA nao mexe no `bunker-licensing` daqui):

1. o job de publicacao no CI do `bunker-licensing` (o job `publicar`, escrito la em 10/11/2026 com o YAML do
   docs/21 §11.3): publica a cada push na `main` de la, depois dos testes e do compose de ponta a ponta, entao a
   primeira imagem sai quando aquele trabalho chegar a `main`;
2. **o produtor da leitura do pacote a este repositorio, uma vez**: GitHub > pacote `bunker-licensing` > Package
   settings > Manage Actions access > Add repository > `bunker707-member-area`, papel Read. Sem isso o servidor nao
   puxa a imagem ("Nao consegui puxar ... Manage Actions access").

`LICENCAS_TAG=sha-<commit>` nas opcoes implanta uma versao exata (padrao `main`); o digest implantado fica em
`/opt/bunker707/emissor/.imagem` e o historico em `.imagens`. Voltar uma versao e o mesmo deploy com a tag anterior,
**desde que as duas tenham as mesmas migracoes**: o migrador do Emissor para quando o banco tem uma migracao que a
imagem nao conhece; sem isso, o caminho e restaurar o backup de antes (8C.6).

### 8C.3 Ordem para subir (da primeira vez)

Desde 11/11/2026 (`docs/32` D40 e D41) nada disto passa pelo computador do produtor: as chaves nascem numa etapa do
workflow, o Painel entra com e-mail e senha e a chave do Resend chega cifrada para o servidor. O passo a passo do
primeiro ensaio de comprador, com o Emissor junto, esta na secao 9F.

| Passo | Quem | O que |
|---|---|---|
| 1 | produtor | No `bunker-licensing`: o trabalho chega a `main` de la (o job de publicacao gera a primeira imagem) e, uma vez, o acesso do pacote a este repositorio (8C.2: pacote `bunker-licensing` > Package settings > Manage Actions access > Add repository > `bunker707-member-area`, Read) |
| 2 | IA | `plan-licencas` (de qualquer branch): mostra os tipos, os precos por local e a escolha. Reportar o custo ao produtor |
| 3 | produtor | O ok no chat, com o preco |
| 4 | IA | `provision-licencas` da `main`, com `CONFIRMADO=sim LICENCAS_PRECO_MAX=<preco aprovado>`: cria o servidor, o firewall `bunker707-licencas-fw`, o bootstrap (Docker, restic, ufw, fail2ban, swap; sem a CLI do Supabase), a chave do Storage Box e imprime a `transfer.pub` (publica) do servidor. Se o preco do dia passou do aprovado, para sem criar nada |
| 5 | IA | `dns-licencas` da `main`: registros A (8C.4) |
| 6 | IA | `cerimonia-licencas` da `main`, com `CONFIRMAR=cerimonia` (8C.8): as duas raizes so cifradas no Storage Box, a chave de emissao direto em `segredos/` do servidor; o registro mostra so as raizes publicas, que a IA grava em `infra/licencas/raizes.json` num commit que chega a `main` antes do passo 8 |
| 7 | IA | A chave do Resend so de envio do Emissor, criada pelo conector do Resend (restrita a `mail.bunker707.com.br`), num envelope para a `transfer.pub` do passo 4 (`infra/cloud/envelope.sh encrypt`, a linha `RESEND_API_KEY=re_...`), e `secrets-licencas` da `main` com o envelope no `payload` (8C.5). O valor nunca passa pelo chat nem vira segredo do GitHub |
| 8 | IA | `deploy-licencas` da `main`. Ele confere o DNS e a configuracao do Painel (todas as variaveis tem padrao; uma fora do formato para antes de tudo; 8C.5), puxa a imagem, escreve o `.env` do compose (com as raizes de `infra/licencas/raizes.json`, o Painel e a conta de envio), aplica as migracoes (`npm run migrate` no container, o servico `migrar`), confere o `/health`, sobe o Caddy, liga o backup de hora em hora e, na primeira vez, cria a conta do produtor no Painel (passo 9) |
| 9 | automatico | Dentro do `deploy-licencas` (`infra/licencas/scripts/conta-do-produtor.sh`): a conta do produtor (`LICENCAS_EMISSOR_EMAIL_PRODUTOR`, padrao `PRODUCER_EMAIL`), so se ainda nao existe: `bin/painel.ts adicionar <e-mail> --funcao produtor`. O Emissor manda ao e-mail do produtor o link de uso unico para definir a senha (vale 60 minutos), e o script confere na fila do Emissor que o e-mail saiu. O link nunca aparece no registro quando o e-mail sai. Se o e-mail nao sai, a etapa avisa e nao mostra nada; so com `LICENCAS_MOSTRAR_LINK=sim` nas opcoes, e so nesse caso, um link novo aparece no registro, uma vez (`redefinir-senha --mostrar-link`). `LICENCAS_NOVO_LINK=sim` manda outro link, pelo e-mail, a conta que ja existe. O e-mail vai ao servidor pelo stdin e e trocado por `<e-mail do produtor>` no que chega ao log. As outras contas: `exec-licencas` com `cd emissor && docker compose exec -T emissor node bin/painel.ts adicionar <e-mail> --funcao atendente --nome "<nome>" --motivo "..."`; `listar`, `redefinir-senha`, `desbloquear`, `funcao`, `desligar` e `religar` estao no `docs/painel.md` do `bunker-licensing` |
| 10 | produtor | Abre o e-mail "definir a senha" do Painel, escolhe a senha e entra em `https://licencas.bunker707.com.br` (o segundo fator por aplicativo fica em Minha conta, recomendado) |
| 11 | IA | `ensaio-licencas` da `main`: o ensaio de restauracao (8C.6). E `status-licencas` com `SSH=1` |
| 12 | IA ou produtor | Monitor externo (secao 12): `https://licencas-api.bunker707.com.br/health` com `"ok":true`, e o heartbeat do backup (`BACKUP_HEARTBEAT_URL` no `infra/licencas/.env`, periodo de 2 h) |
| 13 | IA | Com a nossa escola no ar (`restaurar` e `deploy-membros` da `main`): `conectar-licencas` com `CONFIRMAR=conectar` (8C.9), que liga a escola a API interna do Emissor. Rodar de novo depois de cada `restaurar` da escola (o IP dela muda) |

Os segredos `LICENCAS_RAIZES`, `LICENCAS_EMISSAO_CHAVE`, `LICENCAS_EMISSAO_SENHA`, `LICENCAS_EMISSAO_CERTIFICADO` e
`LICENCAS_RESEND_CHAVE` ainda valem se existirem (a cerimonia feita fora, como antes), mas nenhum e preciso: o produtor
nao cadastra segredo nem variavel para o Emissor.

Toda etapa e idempotente: rodar de novo completa o que faltou. Um `deploy-licencas` repetido e uma atualizacao.

### 8C.4 DNS, Cloudflare e Caddy

| Nome (variavel em `infra/cloud/lib.sh`) | Registro | Proxy | Para que |
|---|---|---|---|
| `licencas-api.bunker707.com.br` (`LICENCAS_API_DOMAIN`) | so A | **sem** proxy | a API publica das Instalacoes. Sem o proxy, nenhum desafio de robos da Cloudflare barra a conferencia feita por servidor (o Bot Fight Mode do plano gratis vale para a zona inteira e nao tem excecao por regra), e o nome so resolve para IPv4, o unico em que a conferencia inicial bate de volta. O nome vai gravado no produto vendido: trocar depois pede versao nova para todos |
| `licencas.bunker707.com.br` (`LICENCAS_PAINEL_DOMAIN`) | so A | **com** proxy | o Painel de licencas da equipe, com o login de e-mail e senha do proprio Painel (D40) |
| `licencas-interno.bunker707.com.br` (`LICENCAS_INTERNO_DOMAIN`) | so A | **sem** proxy | a API interna da nossa escola (`docs/api-interna.md` do `bunker-licensing`): o Caddy do Emissor so deixa entrar o IPv4 do servidor da escola, conferido na propria conexao (com o proxy, o IP seria o da Cloudflare), e so `/interno/v1/*`; a credencial quem confere e o Emissor (8C.9) |

`dns-licencas` apaga qualquer AAAA dos tres nomes e nunca cria um. O `deploy-licencas` para se o DNS nao estiver
assim (sem isso o Let's Encrypt falharia e o Caddy esperaria horas para tentar de novo). Consequencia de a API ficar
fora do proxy: o IP do servidor fica publico, a API nao tem o WAF nem a protecao contra ataque da Cloudflare (a defesa e
o limite de pedidos do proprio Emissor, o firewall e o Caddy), e por isso 80 e 443 ficam abertas para qualquer lugar.
O Painel nao tem mais lista de IPs nem o Cloudflare Access (decisao do produtor em 11/11/2026, `docs/32` D40): entra com
o e-mail e a senha do proprio Painel, de qualquer internet. O que segura e o login dele (senha forte em hash lento,
bloqueio por tentativas por conta e por IP, sessao curta, aviso ao produtor de aparelho novo e a auditoria). O Caddy
continua lendo o IP real do `CF-Connecting-IP` so quando a conexao vem das faixas da Cloudflare (`client_ip`), para o
bloqueio por IP contar o IP certo, e tira do pedido os cabecalhos `Cf-Access-*`: a identidade e so a do login do Painel.

O Caddy roda na rede do servidor e manda cada nome para uma porta local do compose do Emissor, pelos nomes do
`.env.example` do `bunker-licensing`: a API para `EMISSOR_PORTA_NO_HOST` (8080) e o Painel para `PAINEL_PORTA_NO_HOST`
(8081), os nomes e as portas do compose do Emissor com o Painel (conferido em 11/11/2026; o deploy le os dois do `.env`
do compose a cada rodada). Na API o Caddy so passa `/v1/*` e `/health` e corta o corpo acima de 64 KB. O Painel nunca
responde na porta da API. Desde 11/11/2026 ha o terceiro site, o da API interna: `/interno/v1/*` para
`INTERNO_PORTA_NO_HOST` (8082), so do IPv4 da escola (`LICENCAS_INTERNO_IPS` no `infra/licencas/.env`; sem a escola no
ar, `127.0.0.1/32`, ninguem), corpo ate 32 KB, e qualquer outro IP ou caminho recebe 403 sem chegar ao Emissor (8C.9).

O IP de quem pediu: o Emissor confia em proxies por porta e, nas tres, so no gateway da rede `borda` dele, por onde o
Caddy chega: `EMISSOR_PROXIES_CONFIAVEIS` na API, `PAINEL_PROXIES_CONFIAVEIS` no Painel e `INTERNO_PROXIES_CONFIAVEIS`
na API interna, as tres iguais ao `EMISSOR_GATEWAY_BORDA` (172.30.70.1), com `EMISSOR_CABECALHO_IP`,
`PAINEL_CABECALHO_IP` e `INTERNO_CABECALHO_IP` em `x-forwarded-for`. O `deploy-licencas` escreve as seis no `.env` do
compose a cada rodada, com a porta da API interna (`INTERNO_PORTA_NO_HOST`, a que ja estava ou 8082;
`infra/licencas/scripts/implantar.sh`): mudar no servidor nao dura. O resumo da credencial da API interna
(`INTERNO_CREDENCIAL_HASH`) e do `conectar-licencas`: o deploy nunca o troca nem o apaga. O Emissor le o `X-Forwarded-For` da direita para a esquerda, e o Caddy escreve ali um IP so: na API,
o IP da propria conexao (`{remote_host}`; o que vier no cabecalho e ignorado), e no Painel o IP real que a Cloudflare
repassa (`{client_ip}`, aceito so das faixas dela). Por isso as faixas da Cloudflare nao entram em nenhuma das duas
listas; na da API, nunca (um Worker da Cloudflare escolheria o IP que o limite de pedidos conta e onde a conferencia
inicial bate). Se um dia a API passar para tras do proxy, trocar `{remote_host}` por `{client_ip}` e desligar o IPv6
da zona (docs/21 §11.4).

### 8C.5 Segredos (etapa `secrets-licencas`) e a configuracao do Painel

**Desde a cerimonia automatica (8C.8), nenhum segredo do GitHub e preciso para o Emissor.** A chave de emissao, a senha
dela e o certificado nascem direto em `segredos/` do servidor; as raizes publicas ficam em `infra/licencas/raizes.json`
(que vale por cima do segredo `LICENCAS_RAIZES`, com um aviso para apaga-lo se forem diferentes); a senha do banco nasce
no servidor; e a chave do Resend chega no **envelope** do `secrets-licencas`, como a da producao chega no
`secrets-membros` (secao 4A.6): a IA cria uma chave so de envio pelo conector do Resend, restrita a
`mail.bunker707.com.br`, monta o envelope com a linha `RESEND_API_KEY=re_...` para a `transfer.pub` do servidor do
Emissor (impressa pelo `provision-licencas` e pelo `status-licencas` com `SSH=1`) e roda o `secrets-licencas` com o
envelope no `payload`. Nao existe segredo do Resend da producao no repositorio para reaproveitar: a chave da producao
tambem so viaja em envelope, para o `.env` do servidor dela. So o servidor abre o envelope; a chave vai direto do
envelope para `segredos/resend-chave` (1000:1000, 0400), sem passar pelo disco, pelo runner nem pelo log. A ordem: o
envelope; senao o segredo `LICENCAS_RESEND_CHAVE`; senao a que ja esta no servidor.

Os segredos de antes ainda valem, cada um entregue so a etapa que o usa (a chave de emissao, os tres juntos):

| Segredo | O que e | Vai para |
|---|---|---|
| `LICENCAS_RAIZES` | a lista JSON das duas raizes **publicas**, como a cerimonia imprime: `[{"rid":"...","publicKey":"..."},...]` | `EMISSOR_RAIZES` no `.env` do compose (deploy) e a conferencia do secrets |
| `LICENCAS_EMISSAO_CHAVE` | o conteudo do arquivo `emissao-*.pem` (cifrado com senha) | `segredos/emissao.pem` |
| `LICENCAS_EMISSAO_SENHA` | a senha da chave de emissao (16 ou mais caracteres) | `segredos/emissao-senha` |
| `LICENCAS_EMISSAO_CERTIFICADO` | a saida JSON de `bin/chaves.ts emissao` | `segredos/emissao-certificado.json` |
| `LICENCAS_RESEND_CHAVE` | uma chave do Resend so de envio, restrita a `mail.bunker707.com.br`, so do Emissor (uma linha, `re_...`, o formato que o Emissor confere) | `segredos/resend-chave`, que o compose do Emissor monta sempre (`ARQUIVO_CHAVE_RESEND`). Com o Painel, obrigatoria: o `deploy-licencas` para sem ela. Sem o segredo, o `secrets-licencas` mantem a chave que ja esta no servidor, ou cria o arquivo vazio (serve so para o Emissor sem o Painel) |
| `LICENCAS_BANCO_SENHA` (opcional) | a senha do banco | `segredos/postgres-senha`; sem ela, a senha nasce no servidor e nunca sai dele |

Antes de qualquer coisa sair do runner, `infra/cloud/licencas-chave.mjs` confere: a chave esta cifrada e abre com a
senha; **ela nao e uma das raizes** (se alguem colar a raiz no lugar, a etapa para e nada sai); o certificado e dessa
chave, serve para licenca, esta no prazo e foi assinado por uma das raizes. No servidor, cada valor chega pelo stdin
do SSH (nunca em linha de comando) e vira um arquivo `1000:1000` (o usuario `node` do container) com `0400`, dentro de
`segredos/` (`0700`, dono `deploy`), trocado de uma vez. Servicos do Emissor ja no ar sao recriados para ler o
arquivo novo. A senha do banco so le na primeira subida do Postgres: trocar a de um banco que ja existe exige
`TROCAR_SENHA_BANCO=sim`, que muda a senha dentro do banco antes do arquivo. A raiz nunca e segredo daqui.

Trocar a chave de emissao (a cada ~400 dias, ou se vazar): `cerimonia-licencas` com `CONFIRMAR=cerimonia
ROTACIONAR=emissao` (8C.8), que assina a chave nova com a raiz guardada no Storage Box. (Com a cerimonia feita fora,
como antes: nova `bin/chaves.ts emissao` com outro `--kid`, trocar os tres segredos `LICENCAS_EMISSAO_*` no GitHub e
rodar `secrets-licencas`.) As licencas ja emitidas continuam valendo. Na
troca no prazo, ponha o `kid` anterior em `LICENCAS_EMISSOR_KIDS_ANTERIORES` por 30 dias e rode `deploy-licencas`
(a readocao depois de restaurar o banco ainda aceita as licencas dele); depois, tire. A chave que vazou nunca entra ali.

**O Painel e a conta de envio do Emissor.** Nao sao segredo: ficam nas variaveis do repositorio (Settings > Secrets and
variables > Actions > Variables), que o workflow entrega so ao `deploy-licencas`. A cada rodada o deploy confere cada
valor como o Emissor confere ao subir e escreve no `.env` do compose do Emissor com o nome sem o `LICENCAS_`:

| Variavel do repositorio | No `.env` do Emissor | Sem ela | O que e |
|---|---|---|---|
| `LICENCAS_EMISSOR_EMAIL_REMETENTE` | `EMISSOR_EMAIL_REMETENTE` | `Bunker Members <licencas@mail.bunker707.com.br>` | quem envia, um endereco do dominio de envio ja verificado no Resend |
| `LICENCAS_EMISSOR_EMAIL_PRODUTOR` | `EMISSOR_EMAIL_PRODUTOR` | `PRODUCER_EMAIL` | quem recebe o aviso de toda acao que da valor sem venda e a lista de toda segunda-feira; e tambem a conta do produtor no Painel, que o deploy cria na primeira vez |
| `LICENCAS_PAINEL_TETO_DIARIO` | `PAINEL_TETO_DIARIO` | 10 | quantas acoes que dao valor sem venda o Painel aceita por dia, somando a equipe toda (de 1 a 1000) |
| `LICENCAS_EMISSOR_KIDS_ANTERIORES` | `EMISSOR_KIDS_ANTERIORES` | nenhuma | os `kid` das chaves de emissao anteriores que a readocao ainda aceita, separados por virgula (acima) |
| `LICENCAS_EMISSOR_LINK_RENOVAR` e `LICENCAS_EMISSOR_LINK_LOJA` | `EMISSOR_LINK_RENOVAR` e `EMISSOR_LINK_LOJA` | sem os botoes | os enderecos `https` do Renovar e da loja que vao dentro da licenca (`{licenca}` vira o numero); so quando as paginas existirem na nossa area |
| `LICENCAS_SEM_PAINEL` | | | `sim`: o Emissor sobe sem o Painel e sem e-mail; a API das Instalacoes funciona igual |

- O endereco do Painel (`PAINEL_ENDERECO`) e `https://` mais `LICENCAS_PAINEL_DOMAIN`, o nome que o Caddy serve.
- Nenhuma variavel e obrigatoria: os padroes servem (o Painel entra com e-mail e senha, sem o Cloudflare Access, D40).
  Com um valor fora do formato, o `deploy-licencas` para antes de qualquer chamada e diz qual. Com o Painel, o servidor
  ainda precisa da chave do Resend em `segredos/resend-chave` (o deploy para sem ela, antes de mexer no que esta no ar).
  `LICENCAS_SEM_PAINEL=sim` e a unica forma de subir sem o Painel. O `PAINEL_ACCESS_EQUIPE` e o `PAINEL_ACCESS_AUD` de
  um deploy antigo ficam vazios no `.env` do Emissor a cada rodada.
- As opcoes do workflow passam na frente das variaveis (por exemplo, `LICENCAS_SEM_PAINEL=sim` numa rodada so). O
  remetente com nome tem espaco: so pela variavel; nas opcoes, so o e-mail.
- Mudar um destes valores direto no `.env` do servidor nao dura: o proximo `deploy-licencas` escreve de novo. Para
  aumentar o teto diario, por exemplo, mude `LICENCAS_PAINEL_TETO_DIARIO` e rode `deploy-licencas`.
- As contas do Painel nao passam por aqui: sao do banco do Emissor. A do produtor, o `deploy-licencas` cria na primeira
  vez (8C.3, passo 11); as outras, por `exec-licencas`.

### 8C.6 Backup, restauracao e ensaio

- **Backup** (`infra/licencas/scripts/backup.sh`, timer `bunker707-licencas-backup`, de hora em hora no minuto 17 UTC,
  como `deploy`): `pg_dump -Fc` do banco do Emissor de dentro do container, pelo restic, para
  `sftp:storagebox:bunker707/restic-licencas` (o Storage Box que ja existe, com a chave SSH derivada do token que o
  `provision-licencas` instala). Os segredos nao entram: voltam pelo `secrets-licencas`. Cada backup sai marcado
  `com-dados` ou `vazio` (banco sem Licenca nem Instalacao).
- **Retencao:** os de hora em hora das ultimas 48 horas e um por dia dos ultimos 30 dias (`BACKUP_KEEP_HOURLY`,
  `BACKUP_KEEP_DAILY`), agrupados pelo host; o `prune` roda uma vez por dia, as 03 UTC, e no `backup-licencas`, que tambem
  confere 10% dos dados. Os dois ultimos dumps ficam tambem em `/var/backups/bunker707-licencas/stage`.
- **Senhas:** a `RESTIC_PASSWORD` nasce no servidor (`infra/licencas/.env`) e nunca sai dele; a segunda chave do
  repositorio e a de recuperacao, derivada do `HCLOUD_TOKEN` (a mesma regra da secao 10.2). Num servidor novo, depois de
  um perdido, o `deploy-licencas` adota o repositorio antigo por essa chave, sem criar outro.
- **Restaurar** (`restaurar-licencas` da `main`, com `CONFIRMAR=restaurar`; `SNAPSHOT=<id>` escolhe o backup, e sem ele
  vale o mais novo `com-dados`, para o servidor novo e vazio de uma recuperacao nunca passar na frente do backup bom):
  confere o arquivo, faz um backup do banco como esta, para o Emissor (o banco fica), troca o banco, sobe tudo (as
  migracoes mais novas que o backup rodam antes) e confere o `/health`. Depois vale a **readocao** (`docs/32` §11.2): a
  Instalacao ativada depois do backup apresenta o segredo e a licenca guardada na conferencia seguinte (em ate 24 h, ou
  na hora pelo Verificar agora) e e aceita de volta, com o alerta `instalacao.readotada` no Painel. O que a equipe fez
  no Painel depois do backup precisa ser refeito.
- **Servidor perdido:** `provision-licencas` (com o ok do produtor), `dns-licencas`, `secrets-licencas`,
  `deploy-licencas` (sobe vazio e faz backups `vazio`), `restaurar-licencas` com `CONFIRMAR=restaurar`. As Instalacoes
  nao sentem nada enquanto o arquivo guardado valer (30 ou 90 dias, `docs/32` §2.1).
- **Ensaio** (`ensaio-licencas`): restaura o backup num Postgres descartavel, sem rede, no proprio servidor, confere as
  migracoes e conta Licencas, Instalacoes e eventos, compara com o banco em uso e apaga tudo. Nao para o Emissor nem
  toca no banco. Rodar depois do primeiro deploy, uma vez por trimestre e antes de todo `restaurar-licencas` (com o
  mesmo `SNAPSHOT`).

### 8C.7 Incidentes

| Sintoma | O que fazer |
|---|---|
| `deploy-licencas` para em "Nao consegui puxar ... -implantacao" | o CI do `bunker-licensing` publicou a imagem e os arquivos de implantacao? O pacote da leitura a este repositorio (8C.2)? A tag existe? |
| `deploy-licencas` para em "DNS do Emissor fora do lugar" | `dns-licencas` e deploy de novo |
| `deploy-licencas` para em "falta a configuracao do Painel" ou num valor fora do formato | as variaveis do repositorio (8C.5) e deploy de novo; para subir sem o Painel, `LICENCAS_SEM_PAINEL=sim` |
| `deploy-licencas` para em "Falta a chave do Resend" | o segredo `LICENCAS_RESEND_CHAVE`, `secrets-licencas` e deploy de novo; ou `LICENCAS_SEM_PAINEL=sim` |
| `/health` com `"ok":false` | `exec-licencas` com `COMANDO='cd /opt/bunker707/emissor && docker compose logs --tail 100 emissor'`: configuracao, chave, certificado vencido ou banco. O certificado vencido pede a troca da chave de emissao (8C.5) |
| Instalacoes recebendo erro de rede, com o servidor no ar | `status-licencas` (as respostas publicas); o Caddy (`docker logs bunker707-licencas-caddy`); o certificado do Let's Encrypt; um AAAA que voltou no nome da API |
| O produtor nao recebeu o link para definir a senha | o registro do `deploy-licencas` (a linha da conta do produtor; com o envio falhando, o link de uso unico aparece ali, so nesse caso); a chave do Resend e o remetente (8C.5). A conta ja existe: o `docs/painel.md` do `bunker-licensing` diz como gerar um link novo |
| `cerimonia-licencas` para em "As chaves ja existem" | e o esperado numa segunda rodada: a cerimonia nunca roda por cima. Trocar a chave de emissao: `ROTACIONAR=emissao`. Se a primeira rodada parou no meio (as raizes no box, a emissao fora do servidor), o mesmo `ROTACIONAR=emissao` completa |
| `cerimonia-licencas` diz que a raiz "nao abre com a senha derivada do HCLOUD_TOKEN" | o token mudou depois da cerimonia (8C.8, "Trocar o HCLOUD_TOKEN") |
| O Painel recusa o login | conta desligada ou bloqueada por tentativas (`exec-licencas` com `cd emissor && docker compose exec -T emissor node bin/painel.ts listar`). O motivo exato: `exec-licencas` com `cd emissor && docker compose logs --tail 200 emissor`, nas linhas `painel`, campo `recusa` |
| O Painel mostra o aviso vermelho de e-mail | a chave do Resend (8C.5) ou o dominio do remetente nao verificado no Resend; o motivo fica no registro do Emissor, nas linhas "e-mail" |
| Servidor perdido | 8C.6, "Servidor perdido" |
| A chave de emissao vazou | trocar a chave (8C.5), olhar a auditoria no Painel e levar ao produtor: o certificado da chave vazada continua valendo no produto ate vencer, e o que fazer com as licencas assinadas por ela e decisao do desenho (`docs/32` §10) |

### 8C.8 A cerimonia das chaves (etapa `cerimonia-licencas`)

Decidido em 11/11/2026 (`docs/32` D41): as chaves que assinam as licencas nascem numa etapa do workflow, sem passo no
computador do produtor. `cerimonia-licencas`, so da `main`, com `CONFIRMAR=cerimonia` nas opcoes:

1. **Recusa rodar por cima:** se `infra/licencas/raizes.json` ja traz raizes, se o Storage Box ja guarda raizes cifradas
   em `bunker707/licencas-raizes` ou se o servidor do Emissor ja tem `segredos/emissao.pem`, para e diz qual, sem criar
   nada. So `ROTACIONAR=emissao` roda de novo (abaixo).
2. **As senhas:** a da chave de emissao, sorteada no runner (64 hexadecimais); a das duas raizes, derivada do
   `HCLOUD_TOKEN` como a chave de recuperacao do backup (`infra/cloud/deploy-key.mjs --secret --info
   bunker707-licencas-raizes-v1`). Nenhuma vai para o log, para segredo do GitHub ou para artefato.
3. **As chaves, com o codigo do proprio Emissor:** a imagem do Emissor do GHCR (`LICENCAS_IMAGEM:LICENCAS_TAG`) nao leva
   o `bin/chaves.ts` (o Dockerfile do `bunker-licensing` o deixa de fora de proposito), mas leva o `src/keys.ts` e o
   `src/signing.ts` que ele usa. `infra/cloud/cerimonia-licencas.mjs` faz o que o `bin/chaves.ts raiz` e o `emissao` fazem,
   com aquele codigo, num container sem rede, so leitura, sem privilegio e como o usuario `node`; as senhas entram por
   `-e NOME` (nunca o valor na linha de comando), e a saida e um JSON com as chaves privadas so cifradas, gravado num
   arquivo 0600 do runner. Saem a raiz `raiz-AAAA-MM`, a raiz de reserva `raiz-reserva-AAAA-MM` e a chave de emissao
   `emissao-AAAA-MM`, com o certificado de 400 dias (`LICENCAS_DIAS`) assinado pela raiz.
4. **A conferencia, fora da imagem:** com o Node do runner, as raizes abrem com a senha derivada e batem com as publicas;
   a emissao passa pela mesma conferencia do `secrets-licencas` (`licencas-chave.mjs`: cifrada, abre com a senha, nao e
   uma raiz, o certificado e dela, serve para licenca, esta no prazo e foi assinado por uma das raizes).
5. **As raizes, so cifradas, no Storage Box:** direto do runner para `bunker707/licencas-raizes/` (o box aceita SFTP de
   fora, porta 23, com a chave de backup derivada do token), com o `raizes.json` publico e um `LEIA-ME.txt`, e lidas de
   volta para conferir byte a byte. Nunca passam pelo disco do servidor do Emissor. A pasta e criada sem sobrescrever:
   se ja existisse, o SFTP pararia.
6. **A emissao no servidor do Emissor:** a chave cifrada, a senha e o certificado em `segredos/` (1000:1000, 0400), pela
   entrada do SSH, como o `secrets-licencas` faz; os servicos no ar sao recriados para ler os arquivos novos.
7. **O registro mostra so as raizes publicas**, que vao para `infra/licencas/raizes.json` num commit. Dali saem o
   `EMISSOR_RAIZES` do `deploy-licencas` e o `BUNKER_LICENSING_ROOTS` do produto vendido (secao 9D.6).

No fim, a pasta das chaves no runner e apagada (com `shred`), e o runner sai do GHCR.

| Onde fica | O que |
|---|---|
| Storage Box `bunker707-backups`, pasta `bunker707/licencas-raizes/` | as duas raizes, so cifradas (PKCS#8 AES-256, senha derivada do `HCLOUD_TOKEN`), o `raizes.json` publico e o `LEIA-ME.txt`. Os snapshots diarios do box guardam copias |
| Servidor `bunker707-licencas`, `segredos/` | a chave de emissao cifrada, a senha dela e o certificado |
| Repositorio, `infra/licencas/raizes.json` | as raizes publicas |
| Em nenhum outro lugar | nem no log, nem em artefato, nem em segredo do GitHub, nem no chat |

**Trocar a chave de emissao** (a cada ~400 dias, ou se vazar): `cerimonia-licencas` com `CONFIRMAR=cerimonia
ROTACIONAR=emissao`. Baixa a raiz principal cifrada do box, assina uma chave de emissao nova (`emissao-AAAA-MM-DD`, ou
`LICENCAS_KID`) e a instala no servidor; as raizes nao mudam. O registro diz o `kid` anterior: por 30 dias, rode o
`deploy-licencas` com `LICENCAS_EMISSOR_KIDS_ANTERIORES=<kid anterior>` (a readocao ainda aceita as licencas dela); a
chave que vazou nunca entra ali. Trocar as raizes e uma versao nova do produto para todos os compradores e fica fora desta
etapa (`docs/32` §10).

**Trocar o HCLOUD_TOKEN:** a senha das raizes e derivada dele. Antes de apagar o token antigo, as raizes precisam ser
cifradas de novo com a senha do token novo (baixar do box, abrir com a senha derivada do antigo, cifrar com a do novo e
subir de volta). Ainda nao ha etapa para isso (`docs/32` §16, em aberto): sem ela, quem troca o token perde a raiz, e a
saida e a raiz de reserva so se ela tambem foi recifrada. A chave de deploy e a de recuperacao do backup tem o mesmo
cuidado (secao 10.2).

**O que segura e o que nao segura** (`docs/32` D41): a raiz deixa de estar fora de qualquer servidor. Quem tiver o
`HCLOUD_TOKEN` e o acesso ao Storage Box alcanca as raizes cifradas e a senha delas. Da para voltar a cerimonia no
computador do produtor antes da venda aberta, trocando as raizes numa versao.

**Testes:** `tests/infra-licencas-cerimonia.test.mjs` roda a etapa de verdade contra a Hetzner, o servidor, o docker do
runner e o Storage Box de mentira (com um duble do codigo das chaves do Emissor, `tests/fixtures/emissor-chaves`): nada
privado no registro nem em linha de comando, as permissoes (1000:1000, 0400), a recusa da segunda rodada, as raizes so
cifradas no box (e abrindo so com a senha derivada), a troca da chave de emissao com as raizes intactas, o token trocado,
o box fora do ar e a imagem que nao vem. Rodou tambem, fora do CI, o `cerimonia-licencas.mjs` contra o codigo de verdade
do `bunker-licensing` (`src/keys.ts` e `src/signing.ts`, commit 1131d72): o `loadSignerFromFiles` do Emissor carregou a
chave e o certificado, com as raizes. Nao rodou: a imagem do GHCR, o Storage Box e o servidor de verdade.

### 8C.9 A API interna da nossa escola: a etapa `conectar-licencas` (11/11/2026)

A venda do Bunker Members pela nossa escola e **Minhas licencas** (`docs/32` §2.4 e §11.10) falam com o Emissor pela API
interna dele (`docs/api-interna.md` do `bunker-licensing`). A escola precisa de duas configuracoes no `.env` do app,
`EMISSOR_INTERNO_URL` e `EMISSOR_INTERNO_CREDENCIAL`, e o Emissor guarda so o resumo da credencial
(`INTERNO_CREDENCIAL_HASH`). A etapa `conectar-licencas` faz as duas pontas de uma vez, sem ninguem colar segredo em
lugar nenhum. So da `main`, com `CONFIRMAR=conectar` nas opcoes, e com a escola no ar (`restaurar` e `deploy-membros` da
`main` antes; com a escola guardada em snapshot, a etapa para e diz isso):

1. confere o DNS dos tres nomes (8C.4), como o `deploy-licencas`;
2. **antes de mudar qualquer coisa**, confere os dois servidores: o Emissor no ar tem a API interna (o `compose.yaml` dele
   le `INTERNO_CREDENCIAL_HASH` e publica a porta dela) e a conta de envio (sem ela o Emissor nao sobe com a API interna
   ligada); e o compose da escola no ar leva `EMISSOR_INTERNO_URL` e `EMISSOR_INTERNO_CREDENCIAL` ao app (senao: rode
   `deploy-membros` da `main`);
3. sorteia **no runner** uma credencial nova no formato do Emissor (`bki_` e 256 bits, `infra/cloud/credencial-interna.mjs`,
   o mesmo de `bin/painel.ts credencial-interna`) e o resumo dela, em arquivos 0600 apagados com `shred` no fim. A
   credencial nunca aparece no registro (e mascarada no Actions); do resumo, so os 8 primeiros caracteres;
4. no servidor do Emissor, **so o resumo**, pela entrada do SSH (`infra/licencas/scripts/credencial-interna.sh`):
   `INTERNO_CREDENCIAL_HASH` no `.env` do compose dele, com a nova primeiro e as anteriores atras, ate 4 (o limite do
   Emissor; a mais velha sai), para a escola nunca ficar sem acesso no meio da troca. O Emissor e recriado e conferido
   (`/health`); se nao voltar saudavel, o `.env` de antes volta e a etapa para sem tocar na escola. Depois, o Caddy do
   endereco interno passa a aceitar so o IPv4 de agora do servidor da escola (`LICENCAS_INTERNO_IPS`); o Caddy e
   recriado, o que corta a API publica e o Painel por alguns segundos;
5. no servidor da escola, a credencial e o endereco (`https://licencas-interno.bunker707.com.br`) no `.env` do app, pela
   entrada do SSH e pelo mesmo programa do `secrets-membros` (`env_aplicar_kv` em `infra/cloud/lib.sh`: 0600, dono
   `deploy`, o arquivo temporario apagado em qualquer desfecho), e o app recriado, com o smoke;
6. de dentro do app da escola (o mesmo ambiente, a mesma saida de rede), `GET /interno/v1/planos` com a credencial nova
   tem de responder 200 (`infra/cloud/conferir-interno.mjs`; o registro mostra so o codigo e quantos planos o mapa tem).
   Ate 12 tentativas, 10 s entre elas, enquanto o certificado do endereco novo sai; o 401 nao repete (cada credencial
   errada conta para o bloqueio do IP da escola no Emissor: 20 em 10 minutos). Cada tentativa leva um `X-Pedido`
   (`conectar-licencas-<data>-<n>`), que aparece na auditoria do Emissor.

**Rodar de novo e trocar a credencial** (a rotacao). As anteriores continuam aceitas, ate 4, para nada parar no meio. Com
`REVOGAR_ANTERIORES=sim`, depois do 200 o Emissor fica so com a nova e a escola confere de novo: use quando uma credencial
vazou, ou para fechar uma troca.

**Depois de cada `restaurar` da escola**, rode o `conectar-licencas` de novo: o snapshot volta com IP novo, e o Caddy do
Emissor so aceita o de antes (o `restaurar` lembra, quando a escola tem `EMISSOR_INTERNO_URL`). O `deploy-licencas` le o
IPv4 da escola na API da Hetzner a cada rodada; com a escola guardada, fecha o endereco interno para todos
(`127.0.0.1/32`): o IP de antes pode ser de outro cliente da Hetzner.

| Onde fica | O que |
|---|---|
| Servidor do Emissor, `/opt/bunker707/emissor/.env` | `INTERNO_CREDENCIAL_HASH` (os resumos, ate 4), `INTERNO_PROXIES_CONFIAVEIS`, `INTERNO_CABECALHO_IP` e `INTERNO_PORTA_NO_HOST` |
| Servidor do Emissor, `/opt/bunker707/infra/licencas/.env` | `LICENCAS_INTERNO_DOMAIN`, `INTERNO_PORTA_NO_HOST` e `LICENCAS_INTERNO_IPS` (o Caddy) |
| Servidor da escola, `/opt/bunker707/infra/compose/.env` (0600, `deploy`) | `EMISSOR_INTERNO_URL` e `EMISSOR_INTERNO_CREDENCIAL` (a credencial, so aqui) |
| Em nenhum outro lugar | a credencial nunca vai ao servidor do Emissor, ao registro, a segredo do GitHub, ao chat nem a linha de comando |

O `status-licencas` confere de fora que o endereco interno responde 403 ao runner (so a escola entra) e, com `SSH=1`,
mostra quantas credenciais o Emissor aceita e quem o Caddy deixa chegar.

| Sintoma | O que fazer |
|---|---|
| Para em "esta guardada em snapshot" | `restaurar` com `PAPEIS=membros`, `deploy-membros` da `main` e de novo |
| Para em "O Emissor no ar nao tem a API interna" | o `bunker-licensing` com a API interna na `main` de la e `deploy-licencas` |
| Para em "precisa da conta de envio" | a chave do Resend (`secrets-licencas`) e o `deploy-licencas` sem `LICENCAS_SEM_PAINEL=sim` |
| Conferencia com 403 | o pedido nao saiu do IPv4 da escola: `status-licencas` com `SSH=1` (quem o Caddy deixa chegar) e de novo |
| Conferencia com 401 | o resumo nao entrou no Emissor (o passo 4 no registro); rode de novo |
| Conferencia com 000 | DNS ou o certificado do endereco novo (a primeira vez leva alguns minutos); rode de novo daqui a pouco |
| Conferencia com 502 | o Caddy nao chegou na porta da API interna: o registro do Emissor (`exec-licencas`) |
| Conferencia com `000 exec_falhou` | a conferencia nem rodou dentro do app da escola (o app fora do ar): `status-ssh` e de novo |

**Testes:** `tests/infra-licencas-conectar.test.mjs` (a etapa inteira contra a Hetzner, a Cloudflare e os dois servidores
de mentira: o resumo so no Emissor, a credencial so na escola, nada no registro nem em linha de comando, 0600, a ordem, a
trava da `main` e do `CONFIRMAR`, a rotacao, o `REVOGAR_ANTERIORES`, as recusas antes de mudar qualquer coisa e cada
falha da conferencia; o vetor do resumo saiu do codigo do Emissor), `tests/infra-licencas-servidor.test.mjs` (o
`credencial-interna.sh`: ate 4, a volta do `.env` sem saude; o `implantar.sh` com as variaveis `INTERNO_*`) e
`tests/infra-licencas.test.mjs` (o DNS e o Caddy do terceiro nome). **Nao rodou:** nada de verdade (Hetzner, Cloudflare,
o Emissor e a escola no ar, o certificado do endereco novo).

## 9. Deploy de nova versao do app

**Com a producao guardada (secao 4A.7), `restaurar` antes do `deploy-membros`** (a etapa para com "rode restaurar" se o servidor nao existir) e `snapshot` com `CONFIRMAR=apagar` depois do teste.

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

## 9A. O migrador do kit (produto licenciado, 11/11/2026)

O servidor de um comprador (`docs/32` §11.6) aplica as migracoes sem a CLI do Supabase, com `infra/kit/migrar.sh`. A nossa producao continua no `migrate.sh` (a CLI) por enquanto; os dois gravam o mesmo historico, entao um banco aplicado por um segue com o outro.

```bash
bash infra/kit/migrar.sh --listar   # confere o historico contra o pacote e lista o que falta; nada muda no banco
bash infra/kit/migrar.sh            # aplica o que falta
```

**Como roda.** Uma sessao so do `psql` dentro do container do banco (servico `db` do compose; `MIGRAR_CONTAINER=<nome>` aponta outro container), como `postgres` pelo socket local, sem senha na linha de comando e com `ON_ERROR_STOP`. A sessao pega uma trava de sessao do Postgres (`pg_advisory_lock(70707, 1)`, que some sozinha se o `psql` cair), le `supabase_migrations.schema_migrations`, confere o pacote e aplica cada arquivo pendente numa transacao propria, com a linha do historico gravada na mesma transacao e `RESET ALL` antes de cada arquivo. As ferramentas de SQL (`infra/kit/migrador.sql`) sao criadas em `pg_temp`: somem quando o `psql` sai e nunca entram no esquema da escola. `--pasta` e `--banco` trocam a pasta das migracoes e o banco.

**O historico e o da CLI 2.121.0** (a versao pinada em `infra/scripts/lib.sh` e no CI), conferido no codigo dela (tag `v2.121.0`, `apps/cli/src/command-internal/`): a tabela criada como no `createMigrationTable` (`version text` chave, `statements text[]`, `name text`), `version` e `name` tirados do nome do arquivo e, em `statements`, os comandos do arquivo cortados como o `splitAndTrim` dela corta (inclusive o comentario depois do ultimo `;`, que vira mais um comando). Trocar a versao da CLI pede conferir de novo o divisor e a tabela; a guarda `tests/kit-migrador.guard.test.mjs` lembra.

**O que ele recusa antes de aplicar qualquer coisa:**

| Codigo | Quando | O que fazer |
|---|---|---|
| 0 | o banco esta em dia (aplicou o que faltava, ou nada faltava) | nada |
| 1 | opcao errada, pasta sem migracao, arquivo que nao le | conferir o comando e o pacote |
| 2 | sem conexao com o banco (container parado, copia para o container falhou) | subir o `db` e rodar de novo |
| 3 | uma migracao falhou: foi desfeita inteira, as anteriores ficaram | ler o erro do Postgres (arquivo e linha) e rodar de novo depois de corrigir; o migrador continua dela |
| 4 | outra execucao do migrador esta aplicando agora | esperar e rodar de novo |
| 5 | o historico do banco nao bate com o pacote: versao no banco sem arquivo, ou arquivo pendente mais velho que a ultima aplicada | conferir se o pacote e o desta instalacao (pacote mais velho que o banco nunca e aplicado) |
| 6 | uma migracao ja aplicada mudou no pacote (os comandos do historico nao batem com os do arquivo; linha em branco entre comandos nao conta, e o mesmo texto cortado por outra versao da CLI so avisa) | pacote corrompido ou alterado: baixar de novo ou suporte |
| 7 | arquivo recusado: nome fora de `<versao>_<nome>.sql`, UTF-8 invalido, versao repetida, comando que nao roda em transacao sem a diretiva, `BEGIN`/`COMMIT` soltos, `DISCARD`, barra invertida fora de texto (o `psql` leria como comando dele) | corrigir a migracao no repositorio |

**Migracao que nao roda dentro de transacao** (`CREATE INDEX CONCURRENTLY`, `DROP INDEX CONCURRENTLY`, `REINDEX ... CONCURRENTLY`, `VACUUM`, `ALTER SYSTEM`, `CLUSTER`, `CREATE`/`DROP DATABASE` e `TABLESPACE`, `DETACH PARTITION ... CONCURRENTLY`): vai num arquivo so dela, com a primeira linha exatamente `-- pg-delta: transaction=false`. Com ela, o migrador e a CLI rodam o arquivo comando por comando, sem transacao, e gravam o historico no fim. Sem ela, o migrador recusa (codigo 7); a CLI 2.121.0 nao recusa: corta a transacao em pedacos sem avisar, e e isso que a recusa evita. Arquivo assim tem que poder rodar de novo do comeco (`if not exists`; um indice `CONCURRENTLY` que falhou fica invalido e precisa de `drop index concurrently if exists` antes), porque uma falha no meio deixa os comandos anteriores no banco e a linha fora do historico. `ALTER TYPE ... ADD VALUE` roda na transacao (Postgres 12 em diante), mas o valor novo so pode ser usado depois do `COMMIT`: o uso vai no arquivo seguinte (o migrador avisa). A guarda `tests/kit-migrador.guard.test.mjs` confere as migracoes do repositorio.

**Testes.** `tests/kit-migrador.test.mjs` (o roteiro e as saidas, com `psql` e `docker` de mentira), `tests/integration/kit-migrador.test.mjs` (num Postgres de verdade; fora do CI, `MIGRAR_TESTE_PSQL="psql -h <socket> -p <porta> -U postgres"` aponta um Postgres de rascunho) e, so no CI, o passo **Migrador do kit igual à CLI** (`tests/support/kit-migrador-contra-cli.sh`): zera o banco local sem migracoes, aplica todas com o migrador, zera de novo, aplica com a CLI e compara o esquema (`pg_dump --schema-only`), o historico byte a byte e os dados que as migracoes gravam.

## 9B. Backup e recuperacao do kit (produto licenciado, 11/11/2026)

No servidor de um comprador (`docs/32` §3.2 e §4), o backup, o kit de recuperacao, o ensaio e a restauracao sao subcomandos do comando de operacao `membros` (`infra/kit/membros`, nome provisorio; ele funciona tambem como link, por exemplo em `/usr/local/sbin`, que o instalador cria: 9D). A nossa producao continua no `infra/scripts/backup.sh` (secao 10).

```bash
sudo membros backup --iniciar               # confere o destino e cria o repositorio la (SFTP: cria a chave SSH e mostra)
sudo membros backup                         # backup agora: banco, arquivos do Storage e segredos, retencao, situacao
sudo membros backup --conferir              # backup + restic check de 10% dos dados
sudo membros backup --conferir-destino      # so diz que destino e esse e se abre; nada muda
sudo membros backup --instalar-agendamento  # servico e timer do systemd: todo dia 03:30 de Brasilia, ate 30 min de folga
sudo membros kit-de-recuperacao [--nova | --conferir]   # no terminal: a folha e a confirmacao digitada
sudo membros restaurar --ensaio [--snapshot ID] [--chave-arquivo ARQ]   # ensaio isolado: nao toca na escola
sudo membros restaurar [--snapshot ID] [--chave-arquivo ARQ] [--destino REPO]   # servidor novo, modo de restauracao
membros status [--json]                     # sem sudo, sem rede e sem abrir o backup
```

**Os nomes num arquivo so (A10).** O projeto do compose, os containers e volumes da escola, as pastas (`/var/lib/<nome>` para a situacao, `/var/backups/<nome>` para a exportacao e o ensaio), a trava, o servico do systemd, o host e a marca dos backups, o prefixo e o rotulo do ensaio, o teto de memoria dele e os scripts reaproveitados estao em `infra/kit/kit.conf`, com o nome neutro como padrao (`KIT_NOME=membros`, decisao do produtor em 11/11/2026, `docs/32` item 17: os containers `membros-db`, `membros-app` e os outros, as pastas `/opt/membros`, `/var/lib/membros` e `/var/backups/membros`, o servico `membros-backup`); a nossa producao continua com os nomes dela (`bunker707`) ate a migracao planejada. Nenhum outro arquivo do kit escreve o nome (a guarda esta em `tests/kit-membros.test.mjs`). Trocar o nome e trocar `KIT_NOME` ali e, junto, o `name:` e os `container_name:` do compose que for no pacote.

**O destino**, no arquivo de segredos da instalacao (`infra/compose/.env`, so o administrador le):

| Destino | `RESTIC_REPOSITORY` | Acesso |
|---|---|---|
| S3 (Backblaze B2, Wasabi, Cloudflare R2, AWS) | `s3:https://<servidor>/<bucket>[/pasta]`, por exemplo `s3:https://s3.us-east-005.backblazeb2.com/escola-backup/membros` | `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` (a chave criada no painel do armazenamento, com acesso ao bucket); no R2, `AWS_DEFAULT_REGION=auto` |
| SFTP | `sftp:usuario@servidor:/pasta` | a chave SSH que o `--iniciar` cria em `/var/lib/<nome>/backup/sftp_ed25519` e mostra para a pessoa autorizar; `BACKUP_SFTP_PORTA` se nao for a 22 |
| Pasta deste servidor | `/mnt/backup/escola` | nenhum; o backup morre junto com o servidor, e o `status` e a folha dizem isso |

O kit recusa, sem repetir segredo na mensagem: S3 sem `https`, chave de acesso ou senha dentro do endereco, os tipos `b2:`, `rest:`, `azure:`, `gs:`, `swift:` e `rclone:` (no B2, usa-se o endereco S3 do bucket) e pastas como `/`, `/root` ou `/var`. A senha que cifra o backup e a `RESTIC_PASSWORD` do servidor; a chave de recuperacao e a segunda (abaixo). O kit pede o restic 0.16 ou mais novo (`--retry-lock`); o apt do Debian 12 traz o 0.14, e o bootstrap atualiza com `restic self-update`.

**O que vai em cada backup:** `roles.sql` e `postgres.dump` (`pg_dumpall --roles-only` e `pg_dump -Fc`, de dentro do container do banco, como `supabase_admin`), `pgsodium_root.key` (a chave do Vault), `env` (o arquivo de segredos) e a pasta do Storage. A exportacao fica em `/var/backups/<nome>/atual` so durante o envio e sai do disco no fim, com ou sem erro. Todo backup leva o host fixo do `kit.conf` (nao o nome da maquina: o servidor novo de uma recuperacao continua a mesma linha do tempo) e duas marcas: a do kit e `com-dados`, ou `vazio` quando o banco nao tem nenhuma conta (instalacao recem-criada). O ensaio e a restauracao escolhem o mais novo `com-dados`.

**Retencao:** `BACKUP_KEEP_DAILY` 7, `BACKUP_KEEP_WEEKLY` 4 e `BACKUP_KEEP_MONTHLY` 6 no arquivo de segredos (zero nos tres e recusado), aplicados por `restic forget --host <host> --tag <marca> --group-by host,tags ... --prune` depois de cada backup. O agrupamento por host e marcas, e nunca pelo caminho, e o que faz a retencao apagar: o padrao do restic (host e caminhos) deixa sozinho no grupo todo backup cuja pasta muda de nome, e entao nada sai, que era o caso da nossa producao ate 11/11/2026 (secao 10.1). Com as marcas no grupo, os backups `vazio` de um servidor recem-instalado nunca empurram os `com-dados` para fora. `tests/kit-membros-restic.test.mjs` prova as duas coisas com o restic de verdade.

**Trava, agendamento e situacao.** Uma operacao do backup por vez neste servidor (backup, kit de recuperacao, ensaio, restauracao), com `flock` em `/run/lock/<nome>-backup.lock`: quem chega com a trava ocupada para com o codigo 4; o backup agendado espera ate uma hora. O agendado confere 10% dos dados do repositorio (`restic check --read-data-subset=10%`) uma vez por semana. Enquanto a instalacao espera uma restauracao (`/var/lib/<nome>/restauracao-pendente`), o backup fica parado (codigo 9), para os backups de um servidor vazio nunca passarem na frente do bom. A situacao fica em `/var/lib/<nome>/situacao.json` (0644, lida sem sudo por `membros status` e pelo diagnostico): ultimo backup bom, tamanho, destino (tipo e servidor, nunca o endereco inteiro), retencao, ultima conferencia, kit de recuperacao, ultimo ensaio e restauracao. O `kit.py` recusa gravar um valor que contenha um segredo do arquivo de segredos ou a chave de recuperacao em uso.

**Kit de recuperacao** (`docs/32` §4). Sem ele, a senha do backup so existe dentro do servidor, e o backup nao abre se o servidor morrer.

- Uma segunda chave do repositorio (`restic key add`), sorteada pelo kit: 32 letras e numeros do alfabeto de Crockford (sem I, L, O e U), em 8 grupos de 4. Na digitacao, minusculas, hifens e espacos nao contam, e O vira 0, I e L viram 1.
- A folha, texto simples de uma pagina: a escola, onde esta o backup (tipo, endereco e o identificador da chave de acesso, nunca o segredo dela), a chave de recuperacao, o que fazer se o servidor morrer, o ensaio por trimestre e o que fazer se perder a folha.
- A pessoa confirma digitando dois grupos sorteados da chave (tres tentativas). Ate la, a folha fica pendente em `/var/lib/<nome>/recuperacao/folha-pendente.txt` (0600, pasta 0700) e volta na vez seguinte; `--conferir` devolve 6, e o instalador so termina com 0.
- **A chave nao fica no servidor.** Depois da confirmacao, a folha pendente e apagada com `shred` e o servidor guarda so o identificador da chave no repositorio. Se ficasse, ela vazaria junto com qualquer coisa que vaze do servidor (um suporte, a IA lendo arquivos, uma copia do disco), e a pessoa perderia a unica senha que nao depende dele. O servidor nao precisa dela: o backup diario usa a `RESTIC_PASSWORD`.
- So roda com uma pessoa no terminal: sem terminal (a IA rodando o comando), para com o codigo 7 sem criar nada. `--nova` gera outra folha; a chave antiga so sai do repositorio quando a nova e confirmada.

**Ensaio de restauracao** (`restaurar --ensaio`). Abre o backup mais novo com dados (ou o `--snapshot`) com a chave de recuperacao, digitada sem eco ou num arquivo so do administrador (`--chave-arquivo`, 0600), e diz se a escola esta la dentro, sem tocar nela:

| Isolamento | Como |
|---|---|
| Container proprio | da mesma imagem do banco da escola (ja esta no servidor: nada e baixado), com nome e rotulo do ensaio (`<nome>-ensaio-<id>`, `<nome>.ensaio=<id>`); so o banco sobe, sem app, Auth, Storage ou qualquer coisa que envie |
| Sem rede | `--network none`: nem a internet, nem o Emissor, nem o e-mail, nem os containers da escola; o pg_cron sobe sem disparar tarefa (`cron.launch_active_jobs=off`) |
| Sem porta, sem privilegio | nada publicado, nada de `--privileged`, `--pid`/`--ipc` do servidor, capacidade a mais ou volume de outro container |
| So as pastas do ensaio | o banco temporario e o dump (so leitura) em `/var/backups/<nome>/ensaio/<id>`; a unica outra montagem aceita e o volume anonimo que a propria imagem declare, que nasce para o container e sai com ele. O `docker inspect` e conferido antes de ligar; o container que nao passa e apagado sem ligar |
| Memoria e disco | teto de 512 MB sem troca (`KIT_ENSAIO_MEMORIA`), 1 CPU e 512 processos, com o Postgres afinado para caber; so comeca se a memoria livre cobre o teto mais 256 MB de folga para a escola (`KIT_ENSAIO_FOLGA_MEMORIA`) e se o disco tem 5 vezes o dump mais 1 GB livres; senao, codigo 8 antes de criar o banco |

Do backup saem so o dump, os papeis e a chave do Vault. A restauracao segue o `restore.sh` (papeis, privilegios padrao suspensos, `pg_restore --clean`, privilegios devolvidos), conectando pelo `127.0.0.1` de dentro do container; os papeis do backup trazem a senha que o `supabase_admin` tem na escola, e na mesma sessao a senha sorteada do banco temporario volta. A conferencia: contas do Auth, alunos com acesso, conteudos, aulas, acessos, progresso, o historico das migracoes, a linha da `license_state` (e se a licenca ja foi ativada), a chave publica fechada para as tabelas internas e cada objeto do `storage.objects` contra a lista de arquivos do backup. O veredito sai em portugues (DEU CERTO, DEU CERTO com avisos, FALHOU, com o motivo) e vai para a situacao, so com as contagens. Depois, tudo e apagado (o container, os volumes anonimos dele, a pasta e a chave digitada, que fica em `/dev/shm` enquanto o comando roda), tambem na falha e na interrupcao (Ctrl+C, `kill`, SSH caido). Numa queda de luz, as sobras saem no comeco do ensaio seguinte ou no backup diario, que tambem pega a trava. O ensaio nao prova que o app sobe com esse banco (isso e o `atualizar --ensaio`, ainda por fazer) nem le o conteudo dos arquivos do Storage.

**Restaurar num servidor novo** (`restaurar`). Para o servidor de uma recuperacao, instalado no modo de restauracao (`instalar --restauracao`, 9D: sem Chave de ativacao, so o banco de pe e o arquivo de segredos com o destino e as chaves de acesso; ou o `--destino` da folha):

1. poe a instalacao no modo de restauracao (o backup diario fica parado ate o fim);
2. abre o backup com a chave de recuperacao e escolhe o mais novo com dados (ou o `--snapshot`);
3. mostra de quando e de qual escola e o backup, avisa que o servidor antigo nao pode estar no ar junto (os alunos receberiam os e-mails em dobro) e pede a confirmacao digitada: o endereco da escola, ou `APAGAR <endereco>` quando esta instalacao ja tem contas;
4. roda o `infra/scripts/restore.sh --sem-fumaca` (banco inteiro, chave do Vault, arquivo de segredos, Storage e tudo de pe);
5. devolve ao arquivo de segredos o destino e as chaves de acesso que abriram o backup, confere que a `RESTIC_PASSWORD` restaurada ainda abre o repositorio (se nao, cadastra uma nova pela chave de recuperacao), aplica as migracoes do pacote que o backup nao tinha (`migrar.sh`) e apaga o que foi baixado;
6. sai do modo de restauracao e roda o `smoke.sh` pelo endereco publico. Ele so passa quando o endereco ja aponta para este servidor: se falha, nada e desfeito, e a mensagem diz para apontar o registro A e conferir de novo com `sudo bash <pacote>/infra/scripts/smoke.sh`.

A licenca vem no backup: no mesmo endereco, o Emissor reconhece a Instalacao na conferencia seguinte (readocao, `docs/32` §11.2). A folha continua valendo.

**Codigos de saida** (todos os subcomandos):

| Codigo | Quando |
|---|---|
| 0 | deu certo (o ensaio com ou sem avisos) |
| 1 | opcao errada, configuracao faltando ou invalida, restic velho, confirmacao diferente |
| 2 | o destino nao responde ou recusa a chave de acesso |
| 3 | o backup, o ensaio ou a restauracao falhou (o motivo vem na mensagem e na situacao) |
| 4 | outra operacao do backup esta rodando neste servidor |
| 5 | a senha do servidor ou a chave de recuperacao nao abre o backup |
| 6 | o kit de recuperacao nao foi confirmado |
| 7 | o passo mostra ou pede uma chave e so roda com uma pessoa no terminal |
| 8 | falta disco ou memoria livre para o ensaio |
| 9 | a instalacao espera a restauracao de um backup (backup parado) |

**Testes.** `tests/kit-membros.test.mjs` roda os scripts de verdade com docker, restic, systemctl e df de mentira (`tests/fixtures/kit-de-mentira.mjs`; o docker de mentira so deixa entrar no banco do ensaio com a senha que o `supabase_admin` tem naquele momento) e, quando o passo mostra ou pede uma chave, com uma pessoa num pseudo-terminal. `tests/kit-membros-restic.test.mjs` usa o restic de verdade num repositorio em pasta (o CI instala o restic no job Verify). Nao rodou: o ensaio com o Docker e a imagem do banco de verdade (este ambiente nao tem o servico do Docker), um destino S3 ou SFTP de verdade, o timer do systemd e a medida de memoria num servidor de 4 GB com a escola no ar.

## 9C. O servidor do comprador: o preparo e o compose do kit (produto licenciado, 11/11/2026)

Duas pecas do instalador (`docs/32` §3.2 passos 2 e 5, §11.6 e §11.7) que tambem rodam sozinhas: o preparo de um servidor de terceiros (Hetzner, Contabo, Hostinger e parecidos) e o compose reduzido do kit. O instalador, que junta tudo, esta na secao 9D.

### 9C.1 Preparar o servidor

```bash
sudo bash infra/kit/preparar-servidor.sh --simular        # mostra o que faria; nada muda
sudo bash infra/kit/preparar-servidor.sh [--chave-ssh "ssh-ed25519 AAAA... voce"] [--reinicio-automatico] \
     [--ssh-sem-limite] [--manter-firewall]
sudo bash infra/kit/preparar-servidor.sh --fechar-login-por-senha   # numa sessao SSH que entrou com a chave
sudo membros preparar-servidor ...                         # o mesmo, depois de instalado
```

E o `infra/scripts/bootstrap.sh` da producao no perfil `kit`, com os nomes e as pastas do `kit.conf` (A10): o que muda e configuracao, nao um script a parte. Idempotente; `--simular` nao chama nenhum comando que muda o servidor.

| | producao (nossos servidores) | kit (servidor do comprador) |
|---|---|---|
| Sistema | Ubuntu 24.04 (outro so avisa) | Ubuntu 22.04 ou 24.04, Debian 12 ou 13, x86-64; outro para com o codigo 10 antes de mudar qualquer coisa |
| Acesso | usuario `deploy` com a chave, SSH so com chave e `AllowUsers` | o acesso de hoje continua igual: o preparo nao mexe no sshd. `--chave-ssh` acrescenta uma chave publica a conta de quem entrou (a do `sudo`, a do registro do sshd ou o root); o login por senha so fecha com `--fechar-login-por-senha` |
| Firewall | zera o ufw; a 22 sem limite (o firewall da Hetzner restringe a origem) | mantem as regras e a politica de quem ja tinha o ufw ligado; abre so as portas do SSH (as do `sshd -T`, do `ssh.socket` e da sessao de agora, com `ufw limit`), a 80/tcp e a 443 (TCP e UDP); com o ufw desligado, avisa o que deixa de responder de fora antes de ligar. O firewalld nao e tocado: para com o codigo 11, ou `--manter-firewall` deixa o firewall com o dono |
| fail2ban | `jail.d/sshd.local` | `jail.d/<nome>-sshd.local`, com o IP de quem esta preparando no `ignoreip` (senha errada nao tranca o dono do lado de fora); a regra que o dono ja tinha para o sshd fica |
| Reinicio automatico | ligado (05:30 UTC) | desligado; `--reinicio-automatico` liga |
| Docker | repositorio do Ubuntu | repositorio da distribuicao (`linux/ubuntu` ou `linux/debian` e o codinome); o Docker que ja existe fica, e sem o compose 2 para com o codigo 12 |
| restic | o do apt (0.16 no 24.04) | 0.16 ou mais novo: no Ubuntu 22.04 (0.12) e no Debian 12 (0.14) o do apt nao serve e nao tem `self-update`; baixa o 0.18.1 oficial, conferido pelo sha256 do `SHA256SUMS` do release, em `/usr/local/bin` |
| CLI do Supabase e git | sim | nao (o kit usa o `migrar.sh`) |
| Pastas | `/opt/bunker707`, `/var/backups/bunker707` | as do `kit.conf`: estado, backup, certificados e a pasta da instalacao |

**Fechar o login por senha sem trancar o dono.** Muitos provedores criam o servidor com senha. O preparo nunca fecha a senha sozinho; `--fechar-login-por-senha` so fecha quando prova que outra forma de entrar funciona:

1. acha a sessao SSH de quem roda (`SSH_CONNECTION`, ou, debaixo do `sudo`, que limpa o ambiente, o primeiro processo acima que a tenha) e procura no registro do sshd como ela entrou (`Accepted publickey for <conta> from <ip> port <porta>`, no journal ou no `auth.log`). Pelo console do provedor, entrou por senha ou nao achou no registro: codigo 13 e nada muda;
2. pede uma pessoa no terminal (a IA rodando o comando recebe o codigo 7) e a palavra `FECHAR` digitada;
3. grava `/etc/ssh/sshd_config.d/01-<nome>-sem-senha.conf` (`PasswordAuthentication no` e `KbdInteractiveAuthentication no`). O `01-` e de proposito: o sshd usa o primeiro valor que le, e o `50-cloud-init.conf` de muitos provedores liga a senha;
4. confere com `sshd -t` e com o valor efetivo (`sshd -T -C user=...,addr=...`). Se o sshd recusa, ou se outro arquivo ou um bloco `Match` continua ligando a senha, apaga o arquivo e para com o codigo 14, dizendo qual arquivo manda;
5. recarrega o sshd (`reload`, nunca `restart`): as sessoes abertas continuam. A mensagem final pede para entrar de novo com a chave num terceiro terminal antes de fechar o atual.

**O limite do SSH.** O `ufw limit` recusa a sexta conexao nova em 30 s do mesmo IP (a mesma conta do comentario da producao no `bootstrap.sh`). A senha errada e com o fail2ban (5 em 10 minutos, 1 hora). Quem automatiza (a IA do kit, `docs/32` §3.3) abre uma conexao so e reaproveita, no `~/.ssh/config` do computador dela:

```txt
Host escola
  HostName <ip do servidor>
  User <conta>
  ControlMaster auto
  ControlPath ~/.ssh/cm-%r@%h:%p
  ControlPersist 10m
```

`--ssh-sem-limite` troca o `limit` por `allow`. Se o dono ja tinha `ufw allow 22`, essa regra vem antes e o limite nao vale; o preparo avisa e nao apaga a regra dele.

**Codigos de saida:** 0 ok; 1 uso ou confirmacao diferente; 3 um passo falhou (download, sha256, chave do Docker que nao e a esperada, `daemon.json` que nao e JSON); 7 o passo pede uma pessoa no terminal; 10 sistema ou processador fora do kit; 11 o firewalld cuida do firewall; 12 Docker sem o compose 2; 13 fechar a senha pede uma sessao SSH que entrou com chave; 14 o sshd nao aceitou fechar a senha (voltou como estava).

### 9C.2 O compose do kit

`infra/compose/docker-compose.kit.yml`, ao lado do da producao, com as mesmas pastas de dados, o mesmo `.env` e os mesmos arquivos do banco, do Envoy e dos modelos de e-mail (o `restore.sh`, o backup e o migrador leem dali). O `kit.conf` aponta para ele (`KIT_ARQUIVO_COMPOSE`).

- **Servicos:** `db`, `auth`, `rest`, `storage`, `imgproxy`, `api-gw` (Envoy), `app` e `caddy`. Fora: Realtime, Supavisor e Edge Runtime (o app nao usa, D30), Studio e meta (D14), e os scripts de inicio do banco que so eles usavam (`_realtime`, `_supabase`, `_analytics`). O Envoy usa a configuracao da producao: as rotas do Realtime, das Functions e do painel ficam sem destino, e o Caddy nem encaminha esses caminhos (404).
- **Imagens presas pelo resumo** (`tag@sha256:...`, o resumo do indice de plataformas, conferido pelo sha256 do indice baixado). As tags sao as da producao, que recebe toda versao primeiro: trocou uma na producao, rode `node infra/kit/fixar-imagens.mjs` (o `--conferir` so compara) e a guarda `tests/kit-compose.test.mjs` fica verde de novo. O app e a imagem do Pacote da versao (`APP_IMAGE`, obrigatorio, carregada com `docker load`): o comprador nunca constroi.
- **Nomes:** `name:` e os `container_name:` vem de `KIT_NOME`, que os comandos do kit exportam (`lib-kit.sh`, junto com `KIT_PASTA_CERTIFICADOS`). Sem eles o compose para com a mensagem, em vez de criar um segundo projeto sobre as mesmas pastas do banco. Para mexer a mao, rode pelo `membros` ou exporte as duas.
- **Portas:** so o Caddy publica (80 e 443, TCP e UDP). O banco e o gateway ficam so na rede interna; o migrador, o backup e a restauracao entram por `docker compose exec`.
- **Rede interna:** o app tem `SUPABASE_INTERNAL_URL=http://api-gw:8000`, e o proxy, a sessao e o cliente administrativo do app levam o Auth, o PostgREST e o Storage ao gateway por ali (`src/server/db/supabase/internal-fetch.ts`). O cliente continua com o endereco publico, entao o nome do cookie da sessao, as URLs publicas do Storage e os links nao mudam; DNS ou certificado errados nao derrubam mais o banco do app. So o otimizador do `next/image` ainda busca as capas pelo endereco publico, pelo `extra_hosts` (o proprio servidor, sem DNS). Sem a variavel (Vercel, dev, nossa producao), nada muda.
- **Modelos de e-mail do Auth:** servidos pelo Caddy na porta 8088, que nao e publicada; o Auth baixa de `http://caddy:8088/auth-templates/...`. Os assuntos padrao do kit nao tem a nossa marca (`AUTH_SUBJECT_*` troca); o texto dos modelos ainda tem (marca branca, `docs/32` §6).
- **Certificados:** o Caddy tira o certificado direto (HTTP-01 na 80 ou TLS-ALPN-01 na 443). Com o e-mail da conta (`ACME_EMAIL`, obrigatorio), os emissores padrao do Caddy 2.11 sao o Let's Encrypt e, se ele falhar, o ZeroSSL (conferido no codigo da tag `v2.11.7`, `DefaultIssuers`): o kit nao fixa autoridade. A conta e os certificados ficam em `KIT_PASTA_CERTIFICADOS` (padrao `/var/lib/<nome>/caddy`), fora do pacote e dos volumes do Docker: uma reinstalacao reaproveita o certificado em vez de pedir outro (o Let's Encrypt limita 5 certificados iguais por semana).
- **Cloudflare opcional:** `CADDY_FRENTE=direta` (padrao) nao confia em cabecalho de IP nenhum; `CADDY_FRENTE=cloudflare` importa as faixas da Cloudflare da producao e le o `CF-Connecting-IP`. E a opcao avancada do `docs/32` §3.1, depois da instalacao. Outro valor nao acha o arquivo e o Caddy nao sobe.

**A conferencia final** (`infra/scripts/smoke.sh`) le os servicos do compose: onde ha Realtime (a nossa producao), exige o healthcheck e o `/realtime/v1/api/tenants` fechado (403), como sempre; onde nao ha (o kit), exige o caminho fechado na borda (404). Se o compose nao responde, cai no ramo do kit, que a producao reprova. Nos dois, baixa os seis modelos de e-mail pelo caminho do Auth: no kit, de dentro do container do Auth; na producao, pelo endereco publico.

**Testes.** `tests/kit-preparar-servidor.test.mjs` roda o `bootstrap.sh` de verdade, nos dois perfis, num servidor de mentira (`tests/fixtures/servidor-de-mentira.mjs`: o servidor inteiro numa pasta, um shim para cada ferramenta que muda o sistema, o `sshd -T` calculado dos arquivos como o OpenSSH, o PATH so com os shims e ferramentas que nao mudam o sistema, e uma pessoa num pseudo-terminal). `tests/kit-compose.test.mjs` confere o compose do kit (servicos, resumos, nomes, portas, rede interna, modelos, certificados e frente) e, quando ha o plugin do compose, o `docker compose config`. `tests/supabase-rede-interna.test.mjs` e `tests/proxy-rede-interna.test.mjs` rodam o supabase-js e o @supabase/ssr de verdade com o fetch interno. `tests/infra-smoke.test.mjs` roda a conferencia final com docker e curl de mentira. Nao rodou: nada disso num servidor de verdade (nem o preparo na Contabo ou na Hostinger, nem o compose com o Docker), a emissao de um certificado, o ZeroSSL como reserva e a medida de memoria do kit (A29).

## 9D. O instalador do kit (produto licenciado, 11/11/2026)

O comando que junta as pecas das secoes 9A a 9C e instala a escola no servidor do comprador (`docs/32` §3.2 e §11.7): `infra/kit/instalar`. No lote fundador quem roda e a nossa equipe; na venda aberta, o comprador ou a IA dele. O mesmo comando, depois do primeiro passo, e `sudo membros instalar`.

### 9D.1 O Pacote da versao (formato 1)

O instalador roda de dentro do pacote aberto na pasta da instalacao (`KIT_PASTA_INSTALACAO`, padrao `/opt/<nome>`, do `kit.conf`): os dados da escola (`infra/compose/volumes/db/data` e `volumes/storage`) e o arquivo de segredos (`infra/compose/.env`) ficam ao lado dele, entao o pacote aberto noutra pasta e recusado (codigo 20, com o comando certo).

```txt
/opt/<nome>/
  MANIFESTO.json              formato 1: produto, versao, criado_em, commit, instalacao, instalacao_api e
                              chave_publicavel (os tres so no pacote de um fundador, 9D.6), imagens,
                              imagens_de_terceiros, chaves_seguintes e, para cada arquivo, caminho, bytes, sha256 e modo
  MANIFESTO.json.assinatura   (com a chave) base64 da assinatura Ed25519 dos bytes do MANIFESTO.json
  imagens/app.tar             a imagem do app, de `docker save` (no lote fundador, uma por Instalacao)
  imagens/terceiros-N.tar     (opcional) imagens de terceiros, para servidor sem acesso ao Docker Hub
  infra/kit/                  o instalador, o membros, o kit.conf e as ferramentas (menos montar-pacote e fixar-imagens)
  infra/compose/              o compose do kit, o .env.example, o gerador de segredos, o Caddyfile.kit (com frente/ e
                              as faixas da Cloudflare), o Envoy, os modelos de e-mail e os scripts de inicio do banco
  infra/scripts/              lib.sh, bootstrap.sh, restore.sh e smoke.sh (reaproveitados)
  supabase/migrations/        as migracoes, aplicadas pelo migrar.sh (9A)
```

- **Montar** (do nosso lado, nunca no servidor do comprador): `node infra/kit/montar-pacote.mjs --versao 1.0.0 --app app.tar --saida pacote/ [--instalacao alunos.escola.com.br] [--imagem terceiros.tar] [--assinar chave.pem]`. A lista do que vai e fechada (`LISTA_DO_PACOTE`) e recusa `src/`, `tests/`, `docs/`, `infra/cloud/`, o Emissor, `.env` e chave privada. O id de cada imagem (o resumo da configuracao, que o `docker image inspect` mostra) e as tags saem do `manifest.json` de dentro do `docker save`. As imagens de terceiros do compose entram no manifesto como estao no compose, presas pelo resumo.
- **Entregar no lote fundador** (`docs/32` §11.5): a imagem da Instalacao e gerada no nosso CI, vai ao servidor por `docker save` e `docker load`, pelo SSH, sem login de registry no servidor do comprador: `scp pacote-1.0.0.tgz` e `tar -xzf` em `/opt/<nome>`, ou o pacote sem `imagens/app.tar` e `docker save <imagem> | ssh root@servidor docker load`. Sem o arquivo, a imagem vale se ja esta carregada com o id do manifesto (o id fixa a configuracao, e a configuracao fixa o resumo de cada camada).
- **Conferir, sempre**: o sha256 e o tamanho de todo arquivo e de toda imagem do manifesto, caminhos so relativos e sem `..`, os arquivos que o instalador precisa presentes e uma imagem do app com id e tag (codigo 32). O pacote gerado para outro endereco (`instalacao`) e recusado antes de mudar o servidor (35). Depois do `docker load`, o id de cada imagem tem de ser o do manifesto (34).
- **A assinatura**: com a chave publica no `kit.conf` (`KIT_CHAVE_DO_PACOTE`: a chave Ed25519 em DER do SubjectPublicKeyInfo, em base64, numa linha; mais de uma separadas por espaco), o pacote sem assinatura ou com assinatura que nao confere e recusado (33), conferido com `openssl pkeyutl -verify -rawin`. **Sem chave no `kit.conf`, so o sha256 vale e o instalador diz isso**: a cerimonia da chave do pacote e quem assina na rotina de versao ainda estao em aberto (`docs/32` §11.6), e ate la o `kit.conf` sai com a chave vazia. A primeira instalacao com pacote assinado grava a chave em `KIT_PASTA_ESTADO/chaves-do-pacote`, e dali em diante ela vale por cima da do `kit.conf` do pacote que chega (o pacote trocado no caminho nao traz a chave dele junto). A troca de chave vai em `chaves_seguintes`, dentro do manifesto assinado pela chave atual. `node infra/kit/montar-pacote.mjs --chave-publica chave.pem` imprime a chave no formato do `kit.conf`.

### 9D.2 O comando

```bash
sudo bash /opt/<nome>/infra/kit/instalar                       # guiado: pergunta so o que falta
sudo bash /opt/<nome>/infra/kit/instalar --respostas respostas.conf [--ativacao-arquivo chave.txt]
sudo bash /opt/<nome>/infra/kit/instalar --simular [--respostas ...]     # o plano; nada muda
sudo bash /opt/<nome>/infra/kit/instalar --restauracao --respostas ...   # para receber um backup (membros restaurar)
bash infra/kit/instalar --conferir [--endereco alunos.meucurso.com.br] [--json]   # antes de comprar: sem Licenca,
                                                                                   # sem pacote e sem sudo
```

**As respostas** (`KEY=valor`, lido e nunca executado; chave desconhecida e recusada; o arquivo com segredo tem de ser so do administrador, `chmod 600`): `ENDERECO` (o endereco da escola, subdominio; `https://`, maiusculas e barra saem), `ENDERECO_API` (padrao `api.<ENDERECO>`, enquanto o endereco unico nao for testado, D14), `EMAIL_DONO` (a primeira conta e o e-mail dos certificados), `NOME_DA_ESCOLA` (o remetente), `RESEND_API_KEY`, `EMAIL_REMETENTE` (padrao `escola@mail.<dominio>`; o dominio dele e o dominio de envio no Resend), `EMAIL_RESPONDER_PARA`, `EMAIL_TESTE_PARA`, `CHAVE_ATIVACAO` (ou `CHAVE_ATIVACAO_ARQUIVO` / `--ativacao-arquivo`, 0600), `BACKUP_DESTINO` com `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY` e `BACKUP_AWS_DEFAULT_REGION` (S3) ou `BACKUP_SFTP_PORTA` (SFTP), ou `BACKUP_SO_NESTE_SERVIDOR=ACEITO O BACKUP SO NESTE SERVIDOR` (o aceite escrito), `CHAVE_SSH`, `REINICIO_AUTOMATICO` (sim ou nao) e `IP_DO_SERVIDOR` (quando o servidor nao ve o proprio IPv4 publico). No guiado, o que falta e perguntado (os segredos sem eco); rodar de novo nao pergunta o que ja foi respondido (as respostas ficam no arquivo de segredos desde o passo 5). Sem terminal e com resposta faltando: codigo 1, com a lista. O endereco de uma instalacao ja comecada nao muda por aqui (36; trocar de endereco e outro comando, `docs/32` §2.3).

**Os passos**, cada um anotado em `KIT_ARQUIVO_INSTALACAO` (`/var/lib/<nome>/instalacao.json`, 0644, sem segredo e sem dado de aluno). Rodar de novo pula o que esta feito, continua no que parou e nunca apaga dado: nada roda `down -v`, apaga volume ou pasta de dados, gera segredo por cima do arquivo que existe ou recria repositorio de backup.

| # | Passo | O que faz |
|---|---|---|
| 1 | conferir o servidor (sempre) | o mesmo do `--conferir`; o DNS aqui so avisa (o passo 12 bloqueia) |
| 2 | conferir o pacote (sempre) | 9D.1; poe o `membros` no PATH (`KIT_LINK_DO_COMANDO`) |
| 3 | preparar o servidor | `preparar-servidor.sh` (9C.1), com `--chave-ssh` e `--reinicio-automatico` das respostas; nunca fecha o login por senha |
| 4 | carregar as imagens | `docker load` de cada arquivo do manifesto e o id conferido; a que ja esta carregada com o mesmo id fica |
| 5 | gerar os segredos | so se o arquivo de segredos nao existe: o `generate-secrets.mjs --kit` roda dentro da imagem do app (`docker run --network none`, sem Node no servidor), grava 0600 e nada aparece na tela; tira os valores da nossa producao do `.env.example` (remetente, Storage Box, repositorio) e poe a retencao do kit (7, 4, 6) |
| 6 | subir os servicos | `db`, `auth`, `rest`, `storage`, `imgproxy`, `api-gw` e `app`, saudaveis em 5 minutos; o Caddy fica para o passo 12, para o certificado so ser pedido depois do DNS |
| 7 | criar o banco | `migrar.sh` (9A) |
| 8 | o agendador | o tick no Vault (`jobs_tick_url` e `jobs_tick_token`), criado ou trocado se mudou, com o token pela entrada do `psql`; confere a tarefa no `cron.job` (as migracoes a criam). Era o `infra/cloud/deploy.sh` |
| 9 | a primeira conta | o dono pela API administrativa do Auth, de dentro do container do app, ja confirmado e sem senha; papel `owner` em `admin_roles`. A conta que ja existia vira a do dono. Era o `infra/cloud/equipe.sh`, sem depender do e-mail |
| 10 | o e-mail | grava o Resend (SMTP do Auth e API do app, a mesma chave); confere a chave e o dominio de envio pela API do Resend (cria o dominio, mostra os registros de DNS para copiar e espera a verificacao ate `KIT_ESPERA_DOMINIO_EMAIL`); manda o e-mail de teste pelo SMTP, como o Auth manda, na primeira porta que sai (587, 2587, 465; o Auth so faz TLS direto na 465, a conferir no ensaio) e grava a porta; recria o Auth e o app; no terminal, pergunta se chegou. Com a chave que so envia, o dominio nao e conferido e o e-mail de teste decide |
| 11 | o backup | grava o destino; `membros backup --iniciar` (no SFTP, mostra a chave para autorizar), `--instalar-agendamento`, o primeiro backup e o kit de recuperacao (so com uma pessoa no terminal: sem ela, codigo 49 e o instalador continua depois). Com o aceite escrito do backup so neste servidor, sem o kit de recuperacao |
| 12 | o endereco | o DNS dos dois nomes (o registro A so com o IPv4 deste servidor, sem AAAA de outro lugar, sem o proxy da Cloudflare), depois sobe o Caddy e espera o certificado dos dois nomes (`curl --resolve` na porta do Caddy deste servidor, com o certificado conferido) ate `KIT_ESPERA_CERTIFICADO`, reiniciando o Caddy uma vez para ele pedir de novo sem esperar |
| 13 | a conferencia final | `smoke.sh` pelos enderecos publicos e o agendador rodando de verdade (`job_runs` dos ultimos 15 minutos) |
| 14 | ativar a Licenca | a Chave so e gasta aqui: `membros licenca estado` (pula na imagem sem licenca e na ja ativada) e `membros licenca ativar --da-entrada` (9D.3) |

No fim, o resumo: o endereco, o admin, o link de entrada do dono (de uso unico, so com uma pessoa no terminal; sem ela, o comando para gera-lo), a folha de recuperacao para guardar, o backup, a Licenca, o e-mail e os comandos de acompanhar.

**Segredo nunca na tela nem na linha de comando:** as respostas chegam ao shell pela saida capturada do `instalador.py`, vao ao arquivo de segredos pela entrada do `kit.py segredos-trocar`, a chave do Resend vai ao `curl` por `-K -` (a entrada), a Chave de ativacao e o e-mail vao ao container do app pela entrada, e o token do tick e a chave secreta do Supabase nunca saem do container (`infra/kit/no-app.mjs`).

**Modo de restauracao** (`--restauracao`): para o servidor novo de uma recuperacao. Pede so `ENDERECO`, `EMAIL_DONO` e o destino da folha de recuperacao; gera um arquivo de segredos provisorio (o backup traz o de verdade), sobe so o banco, grava o destino e as chaves de acesso, confere que o destino responde (`membros backup --conferir-destino`: o backup que so a chave de recuperacao abre e o esperado), instala o agendamento e poe a instalacao em espera (`restauracao-pendente`), com o backup diario parado ate `sudo membros restaurar` (9B). Pula as migracoes, o agendador, a conta, o e-mail, a conferencia final e a ativacao (vem do backup; a Licenca, na readocao). O endereco que ainda aponta para o servidor antigo so avisa.

**`--conferir`** (antes de comprar, `docs/32` §1.4 e A26): o sistema (Ubuntu 22.04 ou 24.04, Debian 12 ou 13), x86-64, maquina virtual (container nao), vCPU, memoria e disco contra os minimos do `kit.conf`, as portas 80 e 443 livres (ou com a escola), o IPv4 publico, o DNS dos dois nomes (com `--endereco`), a saida HTTPS para o Emissor e para o provedor de e-mail, a porta de envio de e-mail que sai e o relogio (pela hora do Emissor). Se as portas abrem de fora so da para conferir com um servico de fora: na instalacao, o certificado (passo 12) e a conferencia inicial da ativacao conferem. O Emissor fora do ar com o resto saindo e so um aviso. `--json` para a IA.

### 9D.3 Comando de operacao: licenca, link-do-dono e diagnostico

```bash
sudo membros licenca estado [--json]                         # modo, ativada, degrau, validade, endereco da licenca
sudo membros licenca ativar [--chave-arquivo ARQ | --da-entrada] [--json]
sudo membros link-do-dono [--email E]                        # so no terminal
sudo membros diagnostico [--json]
```

- **Ativar pelo terminal (a escolha desta peca).** A Chave nao vai ao Emissor por um cliente a parte: vai ao proprio app, dentro do container (`docker compose exec -T app node -e no-app.mjs`), que chama a rota interna `POST /api/licenca/instalador` (`src/server/licensing/installer.ts`) com as mesmas operacoes da tela Licenca (`operations.ts`: a conferencia inicial, que para tudo com erro de Chave ou de vaga antes de gastar, e a ativacao). A rota so responde a pedido de dentro do container do app (o Host e o `127.0.0.1` da porta do app, o `X-Forwarded-For`, se veio, e um loopback so, e nenhum cabecalho de IP de cliente; o Caddy repassa sempre o nome publico da escola, entao o que vem por ele responde 404, antes do token; o servidor do Next poe os `X-Forwarded-*` que faltam, entao a falta deles nao prova nada) e com o token do tick; e dever legal; no modo `off` o `ativar` nao existe; a resposta nunca traz a Chave, o segredo, a sequencia ou a licenca, e a auditoria leva so o codigo (`origem: "terminal"`). A tela Configuracoes > Licenca continua sendo o outro caminho, com a mesma Chave. Codigos: 0 ativada; 7 a Chave pede uma pessoa (ou `--chave-arquivo` 0600); 52 a Chave nao vale ou a Licenca nao esta ativa; 53 a vaga esta em uso; 54 o Emissor nao respondeu; 55 outro motivo.
- **`link-do-dono`**: um link novo de uso unico (`/auth/confirm?token_hash=...&type=recovery&next=/admin`, o caminho do "esqueci a senha"), que abre a escola na troca de senha. Gerado pela API do Auth de dentro do container, sem e-mail; vale 1 hora. So com uma pessoa no terminal (7): a IA nunca recebe o link (`docs/32` §3.3).
- **`diagnostico`** (primeira versao): a versao e os passos da instalacao, a mesma conferencia do `--conferir` (com o DNS dos dois enderecos), os servicos do compose (estado e saude), o backup (idade do ultimo bom, kit de recuperacao, ultimo ensaio), a situacao da Licenca pelo app e o disco, com a lista "Atencao". Sem segredo e sem dado de aluno: as linhas de registro dos servicos ficam de fora nesta versao. Sem sudo, mostra o que der.

### 9D.4 Codigos de saida do instalador

Toda falha sai com a frase do que houve, o que fazer e de quem e: do produto (Correcao de defeito, pelo suporte) ou do servidor e das contas do comprador (provedor, DNS, e-mail, armazenamento). `python3 infra/kit/instalador.py codigos --json` da a tabela para a IA. 1, 7 e 10 a 14 sao os mesmos do comando de operacao e do preparo (9B e 9C).

| Codigo | Nome | Quando | De quem |
|---|---|---|---|
| 0 | ok | instalado (ou a conferencia passou) | |
| 1 | uso | opcao errada, resposta faltando ou invalida, arquivo de respostas com segredo legivel por outros | comprador |
| 7 | precisa_de_terminal | o passo mostra ou pede uma chave e so roda com uma pessoa no terminal | comprador |
| 10 | sistema | sistema ou processador fora do kit | comprador |
| 11 | firewall | o firewalld cuida do firewall (do preparo) | comprador |
| 12 | docker_sem_compose | Docker sem o compose 2 (do preparo) | comprador |
| 13 | sessao_ssh | fechar a senha pede uma sessao SSH com chave (do preparo) | comprador |
| 14 | sshd | o sshd nao aceitou fechar a senha (do preparo) | comprador |
| 20 | pacote_fora_do_lugar | o pacote nao esta aberto na pasta da instalacao | comprador |
| 21 | virtualizacao | o servidor e um container (OpenVZ, LXC), nao uma maquina virtual | comprador |
| 22 | processador | menos vCPU que o minimo (2) | comprador |
| 23 | memoria | menos memoria que o minimo (4 GB) | comprador |
| 24 | disco | disco menor que 40 GB ou sem a folga livre | comprador |
| 25 | porta_ocupada | outro programa usa a porta 80 ou a 443 | comprador |
| 26 | endereco_nao_aponta | sem registro A, mais de um, ou apontando para outro IP | comprador |
| 27 | registro_aaaa | um registro AAAA aponta para outro servidor | comprador |
| 28 | proxy_cloudflare | o proxy da Cloudflare esta ligado no endereco | comprador |
| 29 | sem_internet | o servidor nao sai por HTTPS | comprador |
| 30 | sem_saida_de_email | nenhuma porta de envio de e-mail sai, ou a API do provedor nao responde | comprador |
| 31 | sem_ipv4_publico | o servidor nao mostra um IPv4 publico (aviso; IP_DO_SERVIDOR resolve) | comprador |
| 32 | pacote_corrompido | arquivo do pacote faltando ou diferente do manifesto | produto |
| 33 | assinatura_do_pacote | com a chave do pacote: sem assinatura ou assinatura que nao confere | produto |
| 34 | imagem | o docker load falhou ou a imagem tem outro id | produto |
| 35 | pacote_de_outra_instalacao | o pacote foi gerado para outro endereco | comprador |
| 36 | instalacao_diferente | a instalacao comecou com outro endereco, noutro modo, ou ja esta pronta noutra versao | comprador |
| 37 | falta_ferramenta | falta python3, curl, openssl ou o docker | comprador |
| 38 | relogio | o relogio do servidor esta mais de 5 minutos fora | comprador |
| 39 | preparo | o preparo do servidor falhou num passo (apt, Docker, restic) | comprador |
| 40 | segredos | a geracao das senhas falhou | produto |
| 41 | servicos | um servico nao subiu ou nao ficou saudavel | produto |
| 42 | migracoes | o migrador parou (o codigo dele, 9A, vai na mensagem) | produto |
| 43 | agendador | o tick nao foi gravado no Vault, a tarefa nao esta no banco ou nao rodou | produto |
| 44 | conta_do_dono | a primeira conta da equipe nao foi criada | produto |
| 45 | chave_do_email | o provedor de e-mail recusou a chave | comprador |
| 46 | dominio_do_email | o dominio de envio nao foi verificado no prazo (os registros aparecem na tela) | comprador |
| 47 | email_de_teste | o provedor recusou o e-mail de teste, ou a pessoa disse que nao chegou | comprador |
| 48 | backup | o destino, o agendamento ou o primeiro backup falhou (o codigo do membros backup vai na mensagem) | comprador |
| 49 | kit_de_recuperacao | o kit de recuperacao pede a pessoa no terminal, ou nao foi confirmado | comprador |
| 50 | certificado | o certificado HTTPS nao saiu no prazo (as linhas do Caddy vao na mensagem) | comprador |
| 51 | conferencia_final | o smoke pelos enderecos publicos falhou | produto |
| 52 | chave_de_ativacao | a Chave nao vale (mal copiada, vencida, usada, de outro endereco) ou a Licenca nao esta ativa | comprador |
| 53 | vaga_em_uso | a Licenca esta em uso noutro endereco | comprador |
| 54 | emissor_fora | o Emissor de licencas nao respondeu | produto |
| 55 | ativacao | a ativacao nao terminou por outro motivo (a mensagem diz; ou pela tela Licenca) | produto |

### 9D.5 Testes

`tests/kit-instalar.test.mjs` roda o instalador de verdade, de dentro de um pacote montado pelo `montar-pacote.mjs` de verdade, num servidor de mentira (`tests/fixtures/instalador-de-mentira.mjs`: docker, curl, getent, ip, ss, nproc, uname, systemd-detect-virt, df, systemctl e sleep de mentira, com o app, o Auth, o Resend, o Emissor e o Caddy por tras deles; o preparo, o migrador e o smoke de mentira, que tem os testes deles; o `membros licenca` de verdade), com o openssl e o gerador de segredos de verdade e uma pessoa num pseudo-terminal: cada modo, cada problema do `--conferir` com o seu codigo, retomar depois de uma falha em cada passo sem refazer o que ja foi feito, rodar de novo sem mudar nada, os segredos que nunca aparecem na tela nem em linha de comando e o arquivo de segredos 0600, o pacote alterado, faltando, sem assinatura, com assinatura de outra chave e a chave gravada no servidor valendo, a imagem pelo id, o modo de restauracao sem a Chave, as respostas conferidas e o guiado que pergunta so o que falta. `tests/licenca-instalador.test.mjs` testa a rota interna contra o Emissor falso do protocolo e `tests/kit-no-app.test.mjs` roda o `no-app.mjs` de verdade contra um app e um Auth de mentira. Nao rodou: nada disso num servidor de verdade (o Docker, o Resend, o Let's Encrypt, a API administrativa do Auth e a imagem com `enforce`), a porta 2465 e o TLS direto do Auth na 465, e os tempos de instalacao.

### 9D.6 O pacote da escola do lote fundador (workflow `pacote-escola.yml`, 11/11/2026)

No lote fundador a imagem e por Instalacao (`docs/32` §11.5): o Next grava no codigo, na hora do build, o endereco da
escola (`NEXT_PUBLIC_SITE_URL`), o da API (`NEXT_PUBLIC_SUPABASE_URL`, `https://api.<endereco>`) e a chave publicavel do
Supabase (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). O workflow **Pacote da escola (lote fundador)**, so da `main`, por
`workflow_dispatch` com o `endereco`, a `versao` e, se for outro, o `endereco_api`:

1. `infra/kit/pacote-escola.mjs`: confere as entradas e monta os valores publicos: os dois enderecos, a chave publicavel,
   as raizes de `infra/licencas/raizes.json` (sem o arquivo, para e manda rodar a cerimonia, 8C.8), o Emissor
   (`https://licencas-api.bunker707.com.br`), a tag da imagem (`membros/app:<versao>`) e o nome do artefato
   (`pacote-<endereco>-<versao>`);
2. `docker build` com `BUNKER_LICENSING_MODE=enforce`, as raizes, o Emissor, os tres valores da escola e a versao, e
   **sem** `NEXT_PUBLIC_POSTHOG_*` nem `NEXT_PUBLIC_SENTRY_DSN` (a imagem do comprador nao leva as nossas chaves, D19). O
   `Dockerfile` so grava o endereco da escola quando o build o recebe: sem ele, a producao continua lendo ao rodar;
3. **as guardas** (`infra/kit/conferir-imagem.mjs`, sobre o `/app` tirado da imagem): para se sobrou leitura de
   `process.env.BUNKER_LICENSING_*` no servidor, se falta uma raiz, o Emissor ou o endereco da escola no servidor, ou a
   API e a chave publicavel no navegador; se aparece uma chave nossa de analise de uso ou de erros (as variaveis
   `NEXT_PUBLIC_POSTHOG_KEY` e `NEXT_PUBLIC_SENTRY_DSN` do repositorio, so para a comparacao, uma chave `phc_...` ou um
   DSN do Sentry); se a imagem leva `src/` ou mapa de fonte com o codigo original. E avisa, sem parar, o que ainda cita
   `bunker707.com.br` fora o Emissor e a propria escola (a marca branca, `docs/32` §6: por exemplo o dominio padrao do
   Jitsi na permissao da sala, `next.config.ts`, e os textos e os modelos de e-mail com a nossa marca);
4. `docker save` e `montar-pacote.mjs` com `--instalacao`, `--instalacao-api` e `--chave-publicavel` (o manifesto leva os
   tres) e o `.tgz` com o sha256 ao lado;
5. o artefato **privado** do repositorio, por 7 dias (`retention-days: 7`), que a etapa `teste-instalar` (9E) ou a equipe
   leva ao servidor.

**Por que um passo so, e nao dois.** A ordem pedida era primeiro o servidor (`instalar --preparar`: gerar os segredos e
mostrar so os valores publicos) e depois o pacote. Lendo o gateway do kit (`volumes/api/envoy/lds.template.yaml`), a chave
publicavel nao sai do segredo JWT da escola: e um texto opaco que o Envoy so compara com o `SUPABASE_PUBLISHABLE_KEY` do
`.env` antes de trocar pela chave anon, assinada no servidor. Entao ela pode ser escolhida no CI: `pacote-escola.mjs` a
deriva do endereco (a mesma em toda versao da escola; publica, como em qualquer pagina da escola), o manifesto a leva, e
o instalador a passa ao gerador (`generate-secrets.mjs --publishable-key`) ou a grava no arquivo de segredos que ja
existe. O segredo JWT, as chaves de servico e todas as senhas continuam nascendo so no servidor da escola e nunca passam
pelo CI, pelo log ou pelo artefato. O outro caminho simples (o segredo JWT gerado no CI e levado cifrado) foi descartado:
poria a chave de servico de cada fundador sob a nossa chave da Hetzner.

O instalador recusa (codigo 35) o pacote gerado para outro endereco ou outra API. Testes: `tests/kit-pacote-escola.test.mjs`
(os valores, a chave com o resumo certo, o gerador, o manifesto, as guardas e o workflow) e o caso do fundador em
`tests/kit-instalar.test.mjs`. Nao rodou: o build de verdade com `enforce` e as guardas sobre uma imagem de verdade.

## 9E. O ensaio de comprador real: o servidor `bunker707-teste` (11/11/2026)

Decisao do produtor (`docs/32` item 13): o produto e ensaiado como cliente novo num servidor novo e vazio da Hetzner,
separado da nossa producao, e o servidor e apagado no fim. A escola do ensaio fica na nossa zona,
`escola-teste.bunker707.com.br` e `api.escola-teste.bunker707.com.br` (`TESTE_DOMAIN` e `TESTE_API_DOMAIN` em
`infra/cloud/lib.sh`), sem o proxy da Cloudflare. Etapas do workflow Infra (`infra/cloud/teste.sh`), **todas so da main**:

| Etapa | O que faz | Trava |
|---|---|---|
| `teste-plano` | o tipo e o local mais baratos que servem ao kit (x86, 2 vCPU, 4 GB, 40 GB; o mesmo plano do `plan-licencas`, em `lib.sh`), com o preco por mes e por hora. Nao cria nada | |
| `teste-criar` | o servidor `bunker707-teste`: Ubuntu 24.04 vazio, sem cloud-init nosso, com a chave de deploy no root (como o comprador entra com a dele), a marca `papel=teste` e o firewall `bunker707-teste-fw` (80 e 443 de qualquer lugar, a 22 so durante as etapas). Sem estoque, so outro local do mesmo tipo e preco | `CONFIRMADO=sim`; `TESTE_PRECO_MAX` para se o preco do dia passou do aprovado |
| `teste-dns` | os dois nomes so com registro A para o servidor, sem proxy; AAAA sai | |
| `teste-instalar` | baixa o pacote mais novo da escola entre os artefatos (o workflow 9D.6; `PACOTE_VERSAO` escolhe), confere o sha256, abre em `/opt/membros` e roda o instalador como root com um arquivo de respostas (0600): a escola, o dono e os e-mails (o `PRODUCER_EMAIL`, ou `TESTE_EMAIL_DONO`), o remetente `escola-teste@mail.bunker707.com.br` (o dominio de envio ja verificado), o backup so no servidor (o aceite escrito: o servidor e apagado no fim). A chave do Resend: o segredo `LICENCAS_RESEND_CHAVE`, se existir, ou a do Emissor, de um servidor para o outro pela entrada do SSH. A Chave de ativacao vem no `payload` do disparo: o primeiro passo do workflow a mascara, lida do arquivo do evento, e ela vai ao servidor so pela entrada do SSH. O e-mail do dono sai do que vai ao log. As respostas e a Chave saem do servidor no fim. Sem a Chave, o instalador para no ultimo passo (52), com a escola no ar | |
| `teste-apagar` | apaga o servidor (so com a marca `papel=teste`), o firewall e os dois registros | `CONFIRMAR=apagar` |

Sem terminal, o instalador nao mostra o link do dono: o dono entra pela tela de entrar, em **Esqueci a senha**, com o
e-mail dele. Testes: `tests/infra-teste.test.mjs` (a Hetzner, a Cloudflare, o GitHub e os servidores de mentira). Nao
rodou: nada de verdade.

## 9F. O teste de cliente novo nos nossos servidores: a lista, na ordem (11/11/2026)

**Decisao do produtor (11/11/2026):** o teste inteiro de cliente novo roda nos nossos servidores, sem a Vercel. A nossa
escola de producao (`bunker707-membros`, guardada em snapshot desde 03/11) e ligada para o teste e vende o Bunker Members
como um curso; o Emissor e o Painel de licencas rodam no `bunker707-licencas`; a escola do comprador roda no
`bunker707-teste`, criado para o ensaio e apagado no fim. Ninguem cola segredo em lugar nenhum: as chaves nascem nas
etapas, e a unica coisa que passa pela mao do produtor e a Chave de ativacao, uma vez.

"IA" e a sessao do Claude, pelo workflow **Infra (Hetzner)** (sempre da `main`) e pelos conectores; "produtor" e o que so
ele faz, com os cliques. Uma etapa por vez; se uma parar, a mensagem diz o que fazer, e rodar de novo completa o que
faltou. Precos sem IVA e a conferir no dia (o plano de cada etapa mostra o do dia).

| # | Quem | O que | Custo |
|---|---|---|---|
| | | **Parte 1. O codigo na `main`** | |
| 1 | IA | CI verde nas PRs: `bunker-licensing#1` (o Emissor com o Painel de e-mail e senha e a API interna), `bunker707-member-area#168` (Minhas licencas, a venda que vira Licenca e as migracoes novas) e a deste trabalho (o `conectar-licencas`), que vai para a `dev` depois da #168. A `dev` da Vercel publica sozinha: as migracoes novas entram na nuvem de teste antes do merge da #168 (a `202611120001` muda checks que o app novo usa ao gravar; `docs/21` §9) | nada |
| 2 | produtor | No `bunker-licensing`: **Pull requests** > #1 > **Merge pull request** > **Confirm merge**. O CI de la publica a imagem do Emissor no GHCR | nada |
| 3 | produtor | No `bunker707-member-area`: a #168 para a `dev`, depois a PR deste trabalho para a `dev`, e por ultimo a PR que promove a `dev` para a `main` (`CONTRIBUTING.md`): em cada uma, **Merge pull request** > **Confirm merge** | nada |
| 4 | produtor | Uma vez so: GitHub > seu perfil > **Packages** > `bunker-licensing` > **Package settings** > **Manage Actions access** > **Add repository** > `bunker707-member-area` > papel **Read**. Sem isso o runner nao puxa a imagem do Emissor (a cerimonia e o deploy param com essa dica) | nada |
| | | **Parte 2. O Emissor e o Painel (`bunker707-licencas`, ligado o tempo todo)** | |
| 5 | IA | `plan-licencas`: o tipo e o local mais baratos que servem e o preco por mes, no chat | nada |
| 6 | produtor | O ok no chat, com o preco | |
| 7 | IA | `provision-licencas` com `CONFIRMADO=sim LICENCAS_PRECO_MAX=<o aprovado>` (8C.3) | o mais barato do dia (referencia: um CX23 a EUR 6,49/mes, ou um ARM mais barato) mais o IPv4 (uns EUR 0,50/mes), por mes, a partir daqui |
| 8 | IA | `dns-licencas`: os tres nomes so com registro A (o Painel com o proxy da Cloudflare; a API e a API interna sem) | nada |
| 9 | IA | `cerimonia-licencas` com `CONFIRMAR=cerimonia` (8C.8). As raizes publicas do registro vao para `infra/licencas/raizes.json` num commit, numa PR para a `dev` e a promocao para a `main` | nada (o Storage Box ja existe) |
| 10 | produtor | O **Merge** das duas PRs do passo 9, como no passo 3 | nada |
| 11 | IA | A chave do Resend so de envio, criada pelo conector do Resend, num envelope para a `transfer.pub` do Emissor, e `secrets-licencas` com o envelope no `payload` (8C.5). Sem ela o Painel e a API interna nao sobem | nada (plano gratis do Resend, 100 e-mails por dia) |
| 12 | IA | `deploy-licencas`: o Emissor, o Painel, o backup de hora em hora e a conta do produtor no Painel. Com a escola guardada, a API interna fica fechada para todos ate o passo 16 | nada |
| 13 | produtor | No e-mail "definir a senha" do Painel: o link > a senha (duas vezes) > **Definir**; depois, em `https://licencas.bunker707.com.br`, **Entrar**. Recomendado: **Minha conta** > ligar o segundo fator | nada |
| | | **Parte 3. A nossa escola ligada (`bunker707-membros`) e conectada ao Emissor** | |
| 14 | IA | `restaurar` com `PAPEIS=membros` (4A.7): a escola volta do snapshot, so ela (o Mautic e o Jitsi ficam guardados) | cerca de EUR 0,01 por hora (CX23) mais o IPv4, enquanto estiver ligada |
| 15 | IA | `deploy-membros`: o codigo da `main`, com as migracoes novas (de `202611100001` a `202611130001`, todas depois da ultima que a producao aplicou, `202611010001`) aplicadas antes do app (9; o `deploy.sh` do servidor roda o `migrate.sh`) | minutos do GitHub Actions |
| 16 | IA | `conectar-licencas` com `CONFIRMAR=conectar` (8C.9): a credencial nova so na escola, o resumo so no Emissor, o endereco interno aberto so para o IP da escola, e a conferencia de dentro do app (`200`) | nada |
| 17 | produtor | No Painel de licencas: **Planos** > o produto da plataforma (Hotmart ou Ticto, e o codigo do produto la) com a forma que ele vende (para o teste, a **Licenca anual** de 12 meses), a venda. No admin da escola (`https://membros.bunker707.com.br/admin`): **Produtos** > o produto do Bunker Members (a aula de instalacao) > **Acesso e venda**: o mesmo codigo da plataforma e a marca **Bunker Members** | nada |
| 18 | produtor | A venda chegando a producao: em **Configuracoes** > **Vendas**, no cartao da Hotmart (ou da Ticto), copiar o endereco mostrado (`https://membros.bunker707.com.br/api/webhooks/hotmart`, ou `.../ticto`), cadastrar na plataforma (Hotmart: Ferramentas > Webhook, versao 2.0.0; Ticto: Tictools > Webhooks, versao 2.0, JSON), com os eventos que o cartao lista, de preferencia so para este produto, e colar o token no cartao > **Salvar** (`docs/06`, Vendas). **Hoje nada aponta para a producao:** a virada das vendas (`docs/21` §8, item 4) nunca foi feita, a producao nunca recebeu venda e o token e de cada ambiente (so o resumo, no banco dele); webhook que ja exista aponta para a Vercel (a `dev`) | nada |
| | | **Parte 4. A compra e Minhas licencas** | |
| 19 | produtor | Uma compra de verdade do produto, com um e-mail seu que ainda nao tem conta na escola (por exemplo, um apelido `+teste` do Gmail). O envio de teste da plataforma so prova o endereco e o token: ele manda um produto e um comprador de exemplo, que nao viram Licenca | o preco do produto, que volta no reembolso do passo 28 (a taxa da plataforma, a conferir) |
| 20 | produtor | No e-mail do comprador: o acesso da escola > a senha > **Entrar**. Em **Configuracoes** > **Vendas** do admin, a venda aparece com o acesso liberado; a fila do Emissor envia a venda em ate um minuto (venda de produto que nao esta em Planos fica tentando, e o Painel avisa por e-mail) | nada |
| 21 | produtor | Como o comprador: menu > **Minhas licencas** > a Licenca nova > o titular (o nome e um CPF ou CNPJ de verdade: os digitos sao conferidos, e o nome vai na licenca assinada) e o aceite dos termos > **Gerar chave**. A Chave aparece uma vez so: copiar. No Painel, o cliente aparece com a Licenca e a Chave gerada | nada |
| | | **Parte 5. A escola do comprador (`bunker707-teste`)** | |
| 22 | IA | `teste-plano`: o preco por hora no chat | nada |
| 23 | produtor | O ok no chat, com o preco | |
| 24 | IA | `teste-criar` com `CONFIRMADO=sim TESTE_PRECO_MAX=<o aprovado>`; `teste-dns` (9E) | por hora, enquanto existir: referencia CX23, cerca de EUR 0,01 por hora mais o IPv4 (uns EUR 0,25 por dia) |
| 25 | IA | O workflow **Pacote da escola (lote fundador)**, da `main`, com `endereco` = `escola-teste.bunker707.com.br` e `versao` = `1.0.0-ensaio.1` (9D.6) | minutos do GitHub Actions (uns 20) e o artefato (umas centenas de MB por 7 dias) |
| 26 | produtor | GitHub > `bunker707-member-area` > **Actions** > **Infra (Hetzner)** > **Run workflow** > Branch **main**, etapa **teste-instalar**, `payload` = a Chave do passo 21 > **Run workflow**. A Chave e mascarada no registro e nunca passa pelo chat. (A outra saida: a IA roda o `teste-instalar` sem a Chave, e o produtor ativa na escola do teste, em **Configuracoes** > **Licenca**, com a mesma Chave.) Depois, em `https://escola-teste.bunker707.com.br`: **Entrar** > **Esqueci a senha** > o e-mail dele > a senha | o servidor do passo 24, por hora |
| | | **Parte 6. As conferencias** | |
| 27 | produtor | Na escola do teste, **Configuracoes** > **Licenca**: ativa. Em Minhas licencas (nossa escola), **Revogar**; na escola do teste, **Verificar agora**: a escola congela (vaga liberada). Em Minhas licencas, **Gerar chave** de novo e ativar a Chave nova na escola do teste: ela volta. O Painel mostra cada Chave gerada e revogada e a troca | nada |
| 28 | produtor | O reembolso da compra na plataforma (o produtor reembolsa a venda no painel dela; se nao der, o comprador pede la). A nossa escola recebe o aviso (em **Vendas**, reembolso), o Emissor revoga a Licenca, e na escola do teste o **Verificar agora** mostra o Aviso (Admin limitado em 7 dias e Escola congelada em 30) | nada (o valor volta ao comprador) |
| | | **Parte 7. Desligar** | |
| 29 | IA | Com o ok do produtor no chat: `teste-apagar` com `CONFIRMAR=apagar` | a cobranca do ensaio para aqui |
| 30 | IA | A nossa escola de volta ao snapshot (`snapshot` com `CONFIRMAR=apagar PAPEIS=membros`), ou ligada, se o produtor quiser. Guardada, o webhook do passo 18 precisa ser desligado na plataforma: a venda chegaria num servidor que nao existe, e a Hotmart desliga a configuracao de quem responde com erro. Depois de cada `restaurar`, o `conectar-licencas` de novo (o IP muda; 8C.9) | guardada, os snapshots da escola (ficam os 2 mais novos, uns 13 GB a EUR 0,0143 por GB), cerca de EUR 0,19 por mes; ligada, cerca de EUR 7 por mes |

O que fica cobrando depois: o servidor do Emissor (passo 7), o Storage Box de sempre e o snapshot da escola (ou a escola
ligada). Nada do ensaio fica no ar.

O passo de dados `supabase/dados/202611120001_midia_pelo_caminho.sql` (os enderecos antigos de midia pelo caminho) nao e
preciso para o teste: o app novo le as duas formas.

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

Retencao: um snapshot por dia pelos ultimos 30 dias (`BACKUP_KEEP_DAILY`). Ate a correcao de 11/11/2026 isso nao valia, aqui e no Mautic (secao 8A.5): o `restic forget` agrupava pelo padrao do restic (host e caminhos), e como a pasta de cada exportacao tem a hora no nome (`stage/<data>`), cada snapshot ficava sozinho no grupo e nenhum era apagado. Com a correcao, os dois agrupam so pelo host (`--group-by host`); `tests/kit-membros-restic.test.mjs` confere com o restic de verdade. Na primeira noite com a correcao no servidor, o `forget --prune` aplica a retencao a tudo de uma vez: fica um snapshot por dia, nos ultimos 30 dias com backup. Os dois ultimos exports ficam tambem em `/var/backups/bunker707/stage` para restauracao rapida. `backup.sh --check` (semanal, a mao ou num segundo timer) le 10% dos dados do repositorio para conferir integridade. `BACKUP_HEARTBEAT_URL` no `.env` recebe um GET a cada backup bom (monitor de "push" do Uptime Kuma ou Better Stack: se nao chegar, alerta).

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
| Capas e imagens do Storage quebradas no app (o `/_next/image` responde 400 "\"url\" parameter is not allowed") | `docker compose logs app` mostra "hostname resolved to private IP": o app chega ao Storage pelo host-gateway (IP privado) | a imagem precisa ter sido construida com `images.dangerouslyAllowLocalIP` ligado (`next.config.ts`, so com `NEXT_OUTPUT=standalone`, desde 30/10/2026); refazer o `deploy-membros` da `main` |
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
