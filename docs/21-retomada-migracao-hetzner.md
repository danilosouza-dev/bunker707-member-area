# 21. Retomada: migracao para a Hetzner (estado em 19/10/2026)

Documento de passagem de sessao. Quem continuar (outra conta, outra sessao do Claude Code na nuvem) le este
arquivo primeiro e segue a secao 4, na ordem. Tudo que esta aqui foi verificado na sessao de 18 e 19/10/2026.
Contexto completo: docs/19 (secao 0, decisao) e docs/20 (secoes 4A e 8A, operacao).

## 1. Decisoes do produtor (nao reabrir)

| Tema | Decisao |
|---|---|
| Arquitetura | Dois servidores proprios na Hetzner Cloud: `bunker707-membros` (app Next.js + Supabase self-hosted + Caddy, banco junto com o app) e `bunker707-marketing` (Mautic 7.2.1 + MySQL 8.4.11 + Caddy). Cloudflare na frente. Backup no Storage Box. |
| Por que assim | Banco junto: o Supabase e uma unidade e a latencia app/banco pesa; escala pequena. Mautic separado: PHP publico com mais falhas de seguranca, carga em rajada, ciclo de vida proprio. Detalhe em docs/19 §0.2 e §0.3. |
| Disponibilidade | Queda de 15 a 20 minutos e aceitavel para o produtor. Sem alta disponibilidade; crescimento por rescale e, depois, banco separado (docs/19 §0.5). |
| Staging e producao | Vercel + Supabase cloud continuam como staging (desenvolvimento). A Hetzner e a producao: migrar tudo como ensaio real, guardar em snapshot, APAGAR os servidores (servidor desligado e cobrado por inteiro) e recriar dos snapshots quando o produtor disser "vai" (docs/20 §4A.7). |
| E-mail | Resend (dominio `mail.bunker707.com.br`, verificado) ate a conta do Amazon SES existir. Mautic ja instalado e enviando pelo Resend; a troca para o SES e so `MAUTIC_MAILER_DSN`. |
| Custo | O mais barato que atenda: CX33 (8 GB) + CX23 (4 GB) se houver estoque; o `plan` escolhe pelo preco do dia. Mautic tem custo fixo (servidor) e nao cobra por contato (docs/19 §0.8). |
| Execucao | 100% pela IA, sem nada na maquina do produtor (ele so tem creditos na nuvem). |

## 2. Por que a execucao e pelo GitHub Actions

A sessao do Claude Code na nuvem sai por um proxy que reencripta TLS e so libera HTTPS para uma lista de
hosts. Verificado em 18/10/2026: `api.hetzner.cloud`, `api.cloudflare.com`, `www.cloudflare.com`,
`api.resend.com` e o dominio bunker707.com.br estao bloqueados; SSH nao passa (o tunel CONNECT abre, mas o
trafego SSH e cortado). `github.com`, `api.github.com`, `registry-1.docker.io`, `raw.githubusercontent.com`
e `checkip.amazonaws.com` passam.

Por isso os "bracos" sao o workflow `Infra (Hetzner)` (`.github/workflows/infra.yml`, id 388832203 no
GitHub), disparado pela ferramenta MCP do GitHub `actions_run_trigger` (metodo `run_workflow`,
`workflow_id: infra.yml`, `ref: claude/hopeful-franklin-04s7wt`, inputs `etapa`, `opcoes`, `payload`) e lido
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
Continue a migracao da Bunker707 para a Hetzner de onde parou. Trabalhe na branch
claude/hopeful-franklin-04s7wt do repositorio danilosouza-dev/bunker707-member-area. Leia primeiro
docs/21-retomada-migracao-hetzner.md e siga a secao 4 na ordem: termine a revisao da secao 4.1, depois
confira se os segredos HCLOUD_TOKEN e CLOUDFLARE_API_TOKEN ja estao no GitHub (dispare a etapa status do
workflow Infra (Hetzner)) e execute as etapas da secao 4.3, me reportando o custo do plan antes do
provision e o resultado de cada etapa. Tudo pela IA; eu nao tenho maquina local.
```
