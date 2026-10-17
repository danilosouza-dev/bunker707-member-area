# 20. Runbook: Bunker707 na Hetzner (servidor proprio)

Data: 17/10/2026. Estado: **nada foi criado na Hetzner**. Este documento e a pasta `infra/` existem para a infraestrutura estar escrita e ensaiada antes de qualquer servidor ser pago. A decisao "ir agora ou montar em paralelo e migrar no lancamento" e do produtor (docs/19). Quando ele disser "vai", o caminho e o da secao 5 em diante, na ordem.

Linguagem: o texto evita jargao; os poucos termos tecnicos estao explicados na secao 17.

---

## 1. Resumo em uma pagina

**O que e.** Um servidor Ubuntu 24.04 de 8 GB na Hetzner (Alemanha) rodando, em Docker, o Supabase self-hosted (Postgres 17, Auth, API, Storage, Realtime, Functions, Studio e pooler), o app Next.js da area de membros e o Caddy na frente com HTTPS automatico. A Cloudflare fica na frente do dominio; so ela chega nas portas 80/443 do servidor; o SSH so abre para o IP do produtor. Backup diario criptografado para um Storage Box da Hetzner. Tudo operado por scripts que uma IA ou o produtor rodam.

**O que ja esta pronto (neste repositorio).**

| Peca | Onde | Para que |
|---|---|---|
| Imagem do app | `Dockerfile`, `.dockerignore`, `/api/health` | Next.js standalone, Node 24, usuario sem privilegio, HEALTHCHECK |
| Publicacao da imagem | `.github/workflows/build-image.yml` | a cada push na `main`, imagem em `ghcr.io/danilosouza-dev/bunker707-member-area` |
| Stack | `infra/compose/docker-compose.yml` | Supabase self-hosted (imagens pinadas) + app + Caddy, portas so em 127.0.0.1 |
| Segredos | `infra/compose/generate-secrets.sh` + `.env.example` | gera `.env` completo (JWT, chaves `sb_`, senhas, Vault, restic) |
| Borda | `infra/compose/caddy/Caddyfile` | TLS automatico, 3 hostnames, Studio so por allowlist de IP |
| Servidor | `infra/scripts/bootstrap.sh` | usuario deploy, SSH so com chave, ufw + Docker, fail2ban, atualizacoes automaticas, Docker CE, swap, CLI do Supabase |
| Firewall da Hetzner | `infra/scripts/hetzner-firewall.sh` | 22 so do produtor, 80/443 so da Cloudflare |
| Migracoes | `infra/scripts/migrate.sh` | `supabase db push --db-url` no Postgres do stack |
| Deploy | `infra/scripts/deploy.sh` | troca a imagem, migra, recria o app, smoke, volta atras |
| Backup / restore | `infra/scripts/backup.sh`, `restore.sh`, `infra/systemd/` | restic -> Storage Box (SFTP), retencao 30 dias, restauracao em servidor limpo com smoke |
| Atualizacao do stack | `infra/scripts/update.sh` | compara e reescreve as imagens com o compose oficial do Supabase |
| Teste de fumaca | `infra/scripts/smoke.sh` | app, Auth, REST, Storage, Realtime, Studio fechado |
| Servidor como codigo (opcional) | `infra/terraform/` | servidor + firewall + volume; validado, nao aplicado |

**Ensaio local feito em 17/10/2026** (Mac M-series, Docker Desktop): `docker compose up` sobe os 13 containers em cerca de 25 s, as 37 migracoes do repositorio aplicam em 3,5 s no Postgres 17, a escola de teste entra pelo gateway, a aluna de teste faz login pelo navegador e abre a home com "Minhas compras". RAM ociosa: **1,27 GiB** no total (secao 4.3).

**Custo estimado por mes** (precos de 17/10/2026, docs/19): servidor CPX32 EUR 35,49 ou CCX13 EUR 42,99 (CX33 quando voltar ao estoque), Storage Box BX11 (1 TB) cerca de EUR 3,81, IPv4 incluso. Servidor desligado continua cobrando; o jeito barato de "pausar" e snapshot + apagar.

---

## 2. Arquitetura num servidor so

```txt
Aluno / produtor
  -> Cloudflare (DNS proxied, WAF, cache de estaticos)
    -> Hetzner Cloud Firewall (80/443 so da Cloudflare; 22 so do produtor)
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
| 22 | SSH | so do IP do produtor (firewall da Hetzner) |

Por que o app fala com o Supabase pelo endereco publico e nao por `http://api-gw:8000`: o cookie de sessao do `@supabase/ssr` se chama `sb-<primeiro rotulo do host>-auth-token` e as URLs publicas do Storage saem do servidor; navegador e servidor precisam usar o MESMO endereco. O `extra_hosts: <host>:host-gateway` do compose faz esse nome resolver para o proprio servidor (Caddy em producao, Envoy no ensaio local), sem sair pela Cloudflare.

Chaves: o stack usa as chaves novas (`sb_publishable_` no navegador, `sb_secret_` no servidor) com tokens assinados em ES256 e JWKS em `/auth/v1/.well-known/jwks.json`; as chaves legadas (`anon`/`service_role`, HS256) continuam no `.env` so para uso interno dos servicos. Com isso `AUTH_SESSION_STRATEGY=claims` (validacao local do JWT no `proxy.ts`) fica possivel quando o proxy estiver ativo (secao 15).

---

## 3. O que cada arquivo faz

```txt
Dockerfile                      imagem do app (3 estagios: deps, build, runner)
.dockerignore                   so o necessario para o build entra na imagem
src/app/api/health/route.ts     GET /api/health -> {ok, version}; HEALTHCHECK e monitor
.github/workflows/build-image.yml  build (PR) e publicacao (main) no ghcr.io
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
  terraform/                    servidor + firewall + volume como codigo (opcional, nao aplicado)
```

---

## 4. Ensaio local (obrigatorio antes de qualquer mudanca na infra)

Precisa de Docker Desktop (8 GB para o Docker ja basta), Node 24 e internet (o nome `127.0.0.1.sslip.io` resolve para 127.0.0.1 por DNS publico; e o que permite navegador e container usarem o mesmo endereco sem mexer em `/etc/hosts`).

### 4.1 Subir

```bash
sh infra/compose/generate-secrets.sh --local          # escreve infra/compose/.env (chmod 600)
docker compose -f infra/compose/docker-compose.yml up -d --build
docker compose -f infra/compose/docker-compose.yml ps  # 13 containers "healthy" (o Caddy nao tem healthcheck)
sh infra/scripts/migrate.sh                            # 37 migracoes via npx supabase, ~4 s
sh infra/scripts/smoke.sh
```

Enderecos do ensaio: app em `http://localhost:3080`, Supabase em `http://127.0.0.1.sslip.io:8000`, Studio em `http://127.0.0.1:8000/` (usuario `bunker707`, senha `DASHBOARD_PASSWORD` do `.env`).

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

Leitura: num servidor de 8 GB sobram mais de 6 GB para o Postgres crescer (shared_buffers, cache do sistema), para o app sob carga e para o build ocasional. O app em uso real tende a 150 a 300 MiB; o Postgres usa o que o sistema deixar de cache. Studio, meta e pooler (480 MiB) sao dispensaveis se um dia faltar memoria: `docker compose stop studio meta supavisor` (o app nao depende deles).

### 4.4 Backup e restauracao em disco (ensaio)

O `.env` do modo `--local` aponta o restic para `/tmp/bunker707-restic-local`. `sh infra/scripts/backup.sh --init && sh infra/scripts/backup.sh --check` faz um backup completo em disco; `sh infra/scripts/restore.sh --snapshot latest --yes` apaga o banco local e restaura por cima, terminando no smoke. Resultado do ensaio em 17/10 na secao 10.3.

### 4.5 Derrubar

```bash
docker compose -f infra/compose/docker-compose.yml down          # mantem dados em volumes/db/data e volumes/storage
docker compose -f infra/compose/docker-compose.yml down -v && rm -rf infra/compose/volumes/db/data   # zera tudo
```

---

## 5. Criar o servidor (quando o produtor autorizar)

Nada abaixo acontece sem o ok no chat. Custa dinheiro a partir do minuto em que o servidor existe.

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

Primeiro acesso como root (a Hetzner manda a senha por e-mail se nao houver chave; com chave, entra direto):

```bash
scp infra/scripts/bootstrap.sh root@<ip>:/root/
ssh root@<ip> 'SSH_PUBLIC_KEY="ssh-ed25519 AAAA... produtor@bunker707" bash /root/bootstrap.sh'
```

O script e idempotente (pode rodar de novo). Ele cria o usuario `deploy` (sudo sem senha, grupo docker), fecha o SSH para senha, liga ufw (so 22 com rate limit, 80 e 443) com as regras `DOCKER-USER` para o Docker respeitar o ufw, fail2ban no sshd, atualizacoes automaticas (reinicio as 05:30 UTC se um kernel pedir), Docker CE com rotacao de logs, swap de 2 GB, a CLI do Supabase 2.121.0 e a pasta `/opt/bunker707`.

**Antes de fechar a sessao de root**, confirme em outro terminal que `ssh deploy@<ip>` entra. Depois disso, trabalhe sempre como `deploy`.

---

## 7. DNS e Cloudflare

Zona `bunker707.com.br` na Cloudflare (a zona ainda nao esta la em 17/10: o registro esta no Registro.br; mover os nameservers e passo do produtor).

| Registro | Tipo | Valor | Proxy |
|---|---|---|---|
| `membros` | A / AAAA | IPv4 / IPv6 do servidor | laranja (proxied) |
| `api` | A / AAAA | idem | laranja |
| `studio` | A / AAAA | idem | laranja |

Configuracao da zona: SSL/TLS em **Full (strict)** (o Caddy tem certificado valido do Let's Encrypt); "Always Use HTTPS" ligado; HSTS pode ficar desligado na Cloudflare (o app ja manda). O desafio HTTP-01 do Let's Encrypt passa pela Cloudflare em modo proxied; se a emissao falhar na primeira vez, coloque os tres registros em "DNS only" por alguns minutos, deixe o Caddy emitir (`docker compose logs caddy`) e volte para proxied. Alternativa sem Let's Encrypt: certificado Origin CA da Cloudflare montado no Caddy (`tls /certs/origin.pem /certs/origin.key` no site), valido 15 anos.

**Studio**: o Caddy so aceita os IPs de `STUDIO_ALLOWED_IPS` e o Envoy ainda pede usuario e senha (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD`). Se o produtor nao tiver IP fixo, duas alternativas: (a) Cloudflare WARP com "Gateway" e um IP de saida dedicado (pago) na allowlist; (b) Cloudflare Access (Zero Trust, gratis ate 50 usuarios) na frente de `studio.`, com login por e-mail, e um Cloudflare Tunnel em vez de abrir a porta: nesse caso o site `studio` sai do Caddy e o `cloudflared` roda como mais um container apontando para `api-gw:8000`. A opcao (b) e a mais segura e nao depende de IP.

Realtime usa websocket (`wss://api.../realtime/v1/websocket`): a Cloudflare repassa websockets por padrao.

---

## 8. Primeiro deploy

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
docker compose -f infra/compose/docker-compose.yml ps        # tudo healthy (Studio demora ~20 s)
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
- **Primeira conta da equipe**: criar o usuario no Studio (Authentication > Users > Add user, com senha) e inserir o papel em `public.admin_roles` (`insert into public.admin_roles (user_id, role) values ('<uuid>', 'owner')`), como no projeto da nuvem; depois os demais entram pelo admin > Equipe.
- **E-mail**: o Auth (convites, recuperacao de senha) sai pelo SMTP do Resend (`smtp.resend.com:587`, usuario `resend`, senha = chave de envio); o remetente `SMTP_ADMIN_EMAIL` precisa ser do dominio verificado (`mail.bunker707.com.br`). O e-mail transacional do app (PR #80) usa a API do Resend com `EMAIL_PROVIDER=resend`.
- **Rotas de callback**: `ADDITIONAL_REDIRECT_URLS` ja aponta para `https://membros.../auth/callback`; se houver login com Google, cadastrar `https://api.bunker707.com.br/auth/v1/callback` no console do Google e as variaveis `GOTRUE_EXTERNAL_GOOGLE_*` no compose (comentadas no compose oficial).

Como entrar no Postgres no servidor: `docker compose -f infra/compose/docker-compose.yml exec db psql -U postgres` (ou pelo pooler em `127.0.0.1:5432` com usuario `postgres.bunker707`). De fora, so por tunel: `ssh -L 5433:127.0.0.1:5433 deploy@<ip>` e `psql postgresql://postgres:<senha>@127.0.0.1:5433/postgres`.

---

## 9. Deploy de nova versao do app

A imagem nasce no GitHub: todo push na `main` roda `build-image.yml` e publica `ghcr.io/danilosouza-dev/bunker707-member-area:sha-<7 chars>` (tambem `:main` e `:latest`). As variaveis `NEXT_PUBLIC_*` entram no JavaScript do navegador na hora do build, por isso vem de **variaveis** do repositorio no GitHub (Settings > Secrets and variables > Actions > Variables): `NEXT_PUBLIC_SUPABASE_URL=https://api.bunker707.com.br`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...` (valor publico, do `.env` do servidor) e, se usados, `NEXT_PUBLIC_POSTHOG_KEY/HOST` e `NEXT_PUBLIC_SENTRY_DSN`. Sem elas a imagem sobe mas o app pede configuracao. Em PR que mexe no build (Dockerfile, package.json, next.config) o workflow so constroi, sem publicar.

No servidor:

```bash
cd /opt/bunker707
sh infra/scripts/deploy.sh --image ghcr.io/danilosouza-dev/bunker707-member-area:sha-1a2b3c4 --ref main
```

O script atualiza `APP_IMAGE` no `.env` (guardando a anterior em `infra/compose/.deploy-history`), puxa a imagem, aplica as migracoes novas, recria so o app, espera o healthcheck e roda o smoke. `curl https://membros.bunker707.com.br/api/health` mostra a versao no ar. Para voltar: `deploy.sh --image <anterior> --no-migrate` (migracao nao volta sozinha: toda migracao do repositorio e aditiva por regra do docs/13).

Sem GitHub no caminho (emergencia): `deploy.sh --build` constroi no proprio servidor (precisa de ~2 GB livres e uns 3 minutos).

---

## 10. Backup e restauracao

### 10.1 O que entra, quando, onde

`backup.sh` roda todo dia as 03:30 UTC (timer do systemd, usuario `deploy`) e guarda, criptografado pelo restic num Storage Box via SFTP (porta 23):

- `roles.sql` (papeis e senhas), `schema.sql`, `data.sql.gz` e `postgres.dump` (formato custom, e o que a restauracao usa), todos gerados pelo `pg_dump` de dentro do container do Postgres (mesma versao, sem imagem extra);
- `pgsodium_root.key`, a chave raiz do Vault (segredos dos provedores de IA): sem ela o Vault restaurado nao abre;
- o `infra/compose/.env` (todos os segredos do stack);
- `infra/compose/volumes/storage` (capas, materiais, fotos de perfil).

Retencao: um snapshot por dia pelos ultimos 30 dias (`BACKUP_KEEP_DAILY`). Os dois ultimos exports ficam tambem em `/var/backups/bunker707/stage` para restauracao rapida. `backup.sh --check` (semanal, a mao ou num segundo timer) le 10% dos dados do repositorio para conferir integridade. `BACKUP_HEARTBEAT_URL` no `.env` recebe um GET a cada backup bom (monitor de "push" do Uptime Kuma ou Better Stack: se nao chegar, alerta).

Por que nao `supabase db dump`: o dump da CLI exclui de proposito os esquemas que o Auth e o Storage administram (ele existe para migrar entre projetos da nuvem, onde esses esquemas ja existem). Num servidor proprio queremos o banco inteiro, inclusive `auth`, `storage`, `vault`, `cron` e `supabase_migrations`, para restaurar num Postgres identico sem reconstruir nada. Para migrar DA nuvem PARA a Hetzner, a CLI e a ferramenta certa (secao 14).

### 10.2 Restaurar num servidor limpo

1. Secoes 5 e 6 (servidor, firewall, bootstrap), clone do repositorio.
2. `export RESTIC_REPOSITORY=sftp:storagebox:/bunker707/restic RESTIC_PASSWORD=<do gerenciador de senhas>` e `STORAGE_BOX_USER=... STORAGE_BOX_HOST=...` no ambiente; `sh infra/scripts/backup.sh --init` so para gravar o alias SSH (a chave nova precisa ser instalada no Storage Box).
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

---

## 13. Incidentes: o que fazer

Primeiro minuto, sempre: `ssh deploy@<ip>`, `cd /opt/bunker707`, `docker compose -f infra/compose/docker-compose.yml ps` e `sh infra/scripts/smoke.sh`. Depois, pelo sintoma:

| Sintoma | Verificar | Acao |
|---|---|---|
| App fora (health 5xx/timeout), Supabase ok | `docker compose logs --tail=200 app` | `docker compose restart app`; se e deploy recente, `deploy.sh --image <anterior> --no-migrate` |
| Ninguem consegue entrar | `logs auth`; `smoke.sh` (auth 200?) | `restart auth`; conferir `SMTP_*` se for e-mail; conferir relogio (`timedatectl`) |
| Tudo lento | `docker stats`, `free -h`, `df -h` | memoria: `stop studio meta`; disco cheio: `docker system prune -f`, logs, `stage/` antigos |
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

Quando chegar a hora (decisao do produtor), com janela de manutencao de ~1 h:

1. Servidor pronto (secoes 5 a 8) e **testado com dados falsos**; `.env` gerado; imagem do app publicada com `NEXT_PUBLIC_SUPABASE_URL=https://api.bunker707.com.br`.
2. Avisar alunos; colocar a Vercel em manutencao (ou deixar no ar so leitura).
3. Na sua maquina, dump do projeto da nuvem com a CLI (e para isso que ela serve), com a URL direta do projeto (Settings > Database, sessao):
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

---

## 15. Diferencas em relacao a nuvem (Supabase cloud + Vercel)

| Na nuvem hoje | Na Hetzner | O que muda no dia a dia |
|---|---|---|
| MCP do Supabase (a IA consulta e migra pelo chat) | nao existe | banco se acessa por `psql` via tunel SSH, pelo Studio ou por scripts; migracoes so por `migrate.sh` |
| Branches/previews de banco e da Vercel | nao existem | todo teste e no ensaio local (secao 4) ou num servidor temporario |
| Management API, Advisors, logs no painel | nao existem | `docker compose logs`; checagem de RLS continua nos testes do repositorio |
| Backup e PITR do plano | backup proprio diario (10) | restauracao = secao 10.2, sem "voltar para as 14h03" |
| Studio na web com login Supabase | Studio atras de allowlist de IP + usuario/senha | abrir so da maquina do produtor (ou Cloudflare Access) |
| Logflare (aba de logs) | desligado | logs nos containers |
| Deploy automatico da Vercel por push | imagem automatica, deploy manual (`deploy.sh`) | um comando no servidor por versao |
| `VERCEL_ENV` no Sentry | `SENTRY_ENVIRONMENT=production` no `.env` | |
| Vercel Speed Insights | nao existe | PostHog e Sentry seguem |
| Regiao `gru1` (Sao Paulo) perto do banco | tudo em Falkenstein; aluno no Brasil tem ~200 ms ate la | Cloudflare guarda estaticos perto do aluno; paginas dinamicas vao a Alemanha |
| E-mail do Auth pelo SMTP da Supabase | SMTP do Resend na 587 | remetente do dominio verificado |
| Chaves anon/service_role no `.env` da Vercel | `sb_publishable_` / `sb_secret_` do stack | mesmas variaveis do app |

**Achado do ensaio (17/10/2026), fora do escopo desta infra mas urgente**: o `proxy.ts` do repositorio fica na raiz, ao lado de `src/`, e o Next 16.4 so procura `proxy.ts` dentro de `src/` quando o app esta em `src/app`. Resultado: o proxy nao e compilado em nenhum build (manifesto de middleware vazio no Mac, no Docker e, por consequencia, na Vercel): CSP com nonce, `no-store` e o redirecionamento de pagina protegida na borda nao estao ativos; as paginas se protegem sozinhas no servidor (por isso os testes de ponta a ponta passam). O `smoke.sh` aceita 200 ou 307 em `/` por isso. Correcao em PR propria: mover para `src/proxy.ts`, ajustar os dois testes que leem o caminho e acrescentar um teste de comportamento do cabecalho CSP.

---

## 16. Seguranca: checklist do servidor

- [ ] 2FA na conta da Hetzner e no GitHub.
- [ ] SSH so com chave; `PermitRootLogin prohibit-password`; porta 22 so do IP do produtor (firewall da Hetzner); fail2ban ativo.
- [ ] ufw com regras DOCKER-USER (`sudo ufw status`; `sudo iptables -L DOCKER-USER -n` mostra as regras).
- [ ] Nenhuma porta do Supabase em 0.0.0.0: `ss -ltnp` so mostra 22, 80 e 443 fora de 127.0.0.1.
- [ ] `.env` com `chmod 600`, dono `deploy`; nunca no git; `RESTIC_PASSWORD` tambem no gerenciador de senhas.
- [ ] Studio: allowlist de IP valida (`STUDIO_ALLOWED_IPS`), senha longa.
- [ ] Cloudflare: Full (strict), WAF ligado, registros proxied; o IP do servidor nao aparece em lugar nenhum publico.
- [ ] Backup diario rodando (`systemctl list-timers`), heartbeat no monitor, ultimo `--check` com menos de 7 dias, ultimo teste de restauracao com menos de 3 meses.
- [ ] Atualizacoes automaticas ligadas; `update.sh --check` uma vez por mes.
- [ ] Segredos girados ao sair alguem da equipe com acesso ao servidor.

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

Nao ensaiado ainda (precisa de servidor e Storage Box reais): SFTP para o Storage Box, timer do systemd, `bootstrap.sh`, firewall da Hetzner, Caddy com TLS de verdade e Cloudflare na frente.
