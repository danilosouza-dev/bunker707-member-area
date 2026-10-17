# Infra propria (Hetzner) e e-mail transacional (Resend): estado, numeros e decisao

Data: 2026-10-17 (madrugada; DNS e verificacao na manha do mesmo dia). Status: proposta para o produtor decidir pela manha.
Fontes: pesquisa com verificacao independente feita em 17/10/2026 (lista no fim). Precos sem IVA, cambio PTAX de 16/10/2026 (USD R$ 5,0826 / EUR R$ 5,7088). Sobre pagamentos em cartao brasileiro incide IOF de 3,5% e spread do banco, nao incluidos nas tabelas.

## 1. Resumo para decidir pela manha

Pergunta do produtor: vamos agora para a Hetzner ou continuamos em Vercel + Supabase durante o desenvolvimento?

Recomendacao: **continuar desenvolvendo em Vercel + Supabase e montar a Hetzner em paralelo, como codigo, sem trocar a producao agora.** Motivos, em ordem de peso:

1. **Hoje nao ha o servidor barato.** A linha CX (CX33, € 8,49) e a CAX (ARM) aparecem como "currently not available" no site da Hetzner, e o incidente "Limited availability of cloud instances" (aberto em 26/06/2026) restringe a criacao de servidores para contas novas e parte das existentes. A conta da Bunker707 e nova. O piso real com 8 GB hoje e CPX32 (€ 35,99 com IPv4) ou CCX13 (€ 43,49 com IPv4).
2. **Com esse piso, o custo mensal empata com o cenario gerenciado.** Hetzner CPX32 completo (backup, Storage Box) da cerca de R$ 264/mes; Vercel Pro + Supabase Pro + Resend Free da cerca de R$ 229/mes; o cenario com ActiveCampaign da R$ 305. A economia grande (R$ 79/mes) so existe se a CX33 voltar ao estoque.
3. **Ainda nao ha aluno.** A "migracao" para a Hetzner, quando acontecer, e um deploy limpo (migracoes do repositorio + usuarios de teste), nao uma mudanca de dados. Nao ha ganho em ir antes.
4. **O fluxo de desenvolvimento depende da Vercel.** Preview por PR, CI com Supabase local, MCP do Supabase (migracoes, advisors, logs) e branch alias da dev so existem no gerenciado. Na Hetzner nada disso vem pronto.
5. **Deixar "desligado" nao e gratis.** A Hetzner cobra o servidor ate ele ser apagado, ligado ou nao. O jeito barato de guardar e snapshot (€ 0,0143/GB/mes, centavos) + apagar.

O que fazer agora, sem depender dessa decisao: e-mail via Resend (ja encaminhado, ver secao 2) e o adaptador de e-mail no app. Mautic e Amazon SES ficam para a segunda rodada (secao 6).

## 2. E-mail: o que ja esta feito e o que falta (Resend)

Conta Resend: login `gtd.danilosouza`, plano Free. Limites do Free: 3.000 e-mails/mes, **100 por dia**, 3 dominios, retencao de 30 dias, 1 endpoint de webhook; Marketing Free com 1.000 contatos e Broadcasts (da para boas-vindas e campanhas simples sem Mautic). Pro: US$ 20/mes (50.000/mes, sem limite diario).

Feito em 17/10 (pelo Claude, no Chrome do produtor):

- **Chave de API** `bunker707-member-area-envio`, permissao "Sending access" (so envia; nao le nem apaga nada), todos os dominios. Prefixo `re_DR6nc3HC`. Copiada pelo botao do painel e gravada em `.env.local` como `RESEND_API_KEY` (arquivo ignorado pelo git). O Claude nao digita segredos em paineis de terceiros: Vercel e Supabase recebem a chave colada pelo produtor.
- **Dominio** `mail.bunker707.com.br` adicionado no Resend (id `31a560a3-1f63-4ed5-ad56-12762781f98f`), regiao **sa-east-1 (Sao Paulo)**, Return-Path `send`, rastreio de cliques/aberturas desligado. Status: **verificado em 17/10/2026 (10h27, horario de Brasilia)** (DKIM e os dois CNAMEs de SPF/Return-Path).

Por que subdominio e nao a raiz: a raiz `bunker707.com.br` ja tem MX do Cloudflare Email Routing, SPF `include:_spf.mx.cloudflare.net`, DMARC `p=none` com relatorios para o Brevo e verificacoes Brevo/Zoho. O subdominio isola a reputacao transacional da reputacao de marketing e nao toca em nada que ja funciona. O Resend recomenda exatamente isso. O remetente fica `Bunker707 <equipe@mail.bunker707.com.br>` com Reply-To em uma caixa real da raiz (ex.: `contato@bunker707.com.br`, que ja existe pelo Email Routing).

### 2.1 Registros DNS pendentes (zona `bunker707.com.br` na Cloudflare)

O DNS do dominio **nao esta no Registro.br**: os servidores de nome sao `tadeo.ns.cloudflare.com` e `vera.ns.cloudflare.com`. O Registro.br so guarda o nome. Os registros precisam ser criados na Cloudflare (a conta estava deslogada no Chrome em 17/10, por isso nao foram criados naquela noite).

**Atualizacao 17/10 (manha):** com o produtor logado na Cloudflare, os tres registros abaixo foram criados na zona `bunker707.com.br` (18 de 200 registros), conferidos nos resolvedores 8.8.8.8 e 1.1.1.1, e a verificacao foi disparada no Resend ("Verify DNS Records"). Nada da raiz foi alterado. A tabela fica aqui como registro do que existe.

| Tipo | Nome (campo "Name" da Cloudflare) | Conteudo | Proxy | TTL |
| --- | --- | --- | --- | --- |
| TXT | `resend._domainkey.mail` | valor DKIM abaixo (218 caracteres, comeca com `p=MIGfMA0GCSqG`) | nao se aplica | Auto |
| CNAME | `rsend.mail` | `rsend-sae1.forge.rmta.net` | **DNS only** (nuvem cinza) | Auto |
| CNAME | `send.mail` | `send.forge.rmta.net` | **DNS only** (nuvem cinza) | Auto |

Valor completo do registro DKIM (chave publica, pode ficar no repositorio):

```txt
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDL9ez5valQe9f22CdDhkrk+p35cblHLrCCUeLeDftBEDfiTzmjKBj1sEGF2etWIp7v0BrCNH+Al4TavYcnovZFfInIU5E+JRGo6XiOlVva6KP5v3npVyBGTHiJjpsatVFGOKoWHQyMJgYNs+IP2Dj4OgAYcNOS+Tw38j89gr7jOwIDAQAB
```

Nao criar o MX de recebimento (`inbound-smtp.sa-east-1.amazonaws.com`): "Enable Receiving" ficou desligado, so enviamos. Nao criar DMARC novo: o `_dmarc.bunker707.com.br` existente (`p=none`) ja cobre os subdominios. A documentacao do Resend ainda descreve o formato antigo (MX + TXT `v=spf1 include:amazonses.com` no subdominio `send`); o painel gerou CNAMEs para este dominio, e o painel e quem manda.

Tres jeitos de concluir, do mais rapido ao manual:

1. Fazer login na Cloudflare no Chrome e avisar o Claude: ele cria os tres registros e clica em "Verify" no Resend (uns 2 minutos; verificacao costuma sair em ate 15 minutos).
2. No Resend, em Domains > mail.bunker707.com.br, usar "Auto configure" (botao Cloudflare): abre um OAuth da Cloudflare que cria os registros sozinho.
3. Criar os tres registros a mao na Cloudflare (DNS > Records > Add record) com a tabela acima e clicar em "I've already added the records" no Resend.

### 2.2 Depois que o dominio verificar (feito em 17/10, manha, pelas integracoes oficiais)

Como o Claude nao digita segredos em paineis, o produtor autorizou no chat as duas integracoes oficiais do Resend, que gravam a chave sem ela passar pelo Claude:

1. **Supabase Auth (cloud, projeto hrtnqcznhdmodjikvddm)**: feito por Resend > Settings > Integrations > "Connect to Supabase" (OAuth na organizacao Bunker707, permissao Auth + Projects leitura e escrita). O Resend criou a chave "Supabase Integration" e gravou em Authentication > Emails > SMTP: host `smtp.resend.com`, porta `465`, usuario `resend`, remetente `equipe@mail.bunker707.com.br`, nome `Bunker707`. Conferido no painel do Supabase: "Enable custom SMTP" ligado e limite em Rate Limits = 25 e-mails/hora (ajustavel). Isso tira o limite de 2 e-mails/hora do SMTP embutido. Atencao: os e-mails do Auth (recuperacao, confirmacao, convite) consomem a mesma cota do Resend Free (100/dia).
2. **Vercel**: feito por Resend > Integrations > "Go to Vercel Integration" (instalada no time Bertoldo's projects, acesso so ao projeto bunker707-member-area, permissoes de ler instalacao/projetos/time e escrever variaveis de ambiente). O Resend criou a chave "Vercel Integration" restrita ao dominio `mail.bunker707.com.br` e gravou `RESEND_API_KEY` no projeto (conferido pela API da Vercel: ambientes production, preview e development; a variavel pertence a integracao e fica legivel no painel, nao e do tipo "sensitive"). O app ainda nao le essa variavel (espera o adaptador de e-mail).
3. **Teste**: recuperacao de senha enviada pelo painel do Supabase (Users > ferramentas.bunker707@gmail.com > Send password recovery) e entregue: Resend > Emails mostra "Reset your password", status Delivered, remetente `equipe@mail.bunker707.com.br`. O "Esqueci minha senha" de `/login` usa o mesmo caminho.
4. **Webhook** do Resend (bounce, complaint, delivered) apontando para o app: fica para o adaptador de e-mail. O Free tem 1 endpoint.

Chaves existentes no Resend: `bunker707-member-area-envio` (manual, so envio, em `.env.local` para desenvolvimento local), `Supabase Integration` (usada pelo SMTP do Auth) e `Vercel Integration` (variavel da Vercel). Para revogar: Resend > API keys; as autorizacoes OAuth ficam em Supabase > Organization > OAuth Apps e Vercel > Team > Integrations.

Limites praticos: 100 e-mails/dia no Free. Um lote de boas-vindas para 300 alunos num dia estoura; o adaptador precisa enfileirar e respeitar o limite, ou o plano vai para Pro (US$ 20) antes de um lancamento. Volume previsto (boas-vindas + compra + auth) para 300 alunos/mes fica bem abaixo de 3.000.

### 2.4 Modelos de e-mail do Auth em portugues (painel do Supabase, 17/10)

O produtor recebeu o e-mail de recuperacao em ingles (modelos padrao do Supabase). Os seis modelos foram reescritos em portugues no painel (Authentication > Emails > Templates), mantendo as variaveis do GoTrue. Site URL tambem foi trocado de `http://localhost:3000` para `https://bunker707-member-area.vercel.app` (Redirect URLs seguem: `http://localhost:3000/**`, `https://*-bertoldo-s-projects.vercel.app/**`, `https://bunker707-member-area.vercel.app/**`). Os modelos de "Security" (senha alterada, e-mail alterado etc.) continuam desligados, como vieram.

| Modelo | Assunto |
| --- | --- |
| Confirm sign up | Confirme seu e-mail na Bunker707 |
| Invite user | Seu acesso a Bunker707 esta pronto |
| Magic link or OTP | Seu link de acesso a Bunker707 |
| Change email address | Confirme a troca de e-mail na Bunker707 |
| Reset password | Redefina sua senha da Bunker707 |
| Reauthentication | Seu codigo de confirmacao da Bunker707 |

Corpos (HTML), na mesma ordem:

```html
<!-- Confirm sign up -->
<h2>Confirme seu e-mail</h2>
<p>Falta um passo para liberar seu acesso à área de membros da Bunker707.</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p>
<p>Se você não criou uma conta na Bunker707, pode ignorar esta mensagem.</p>

<!-- Invite user -->
<h2>Você foi convidado para a Bunker707</h2>
<p>Seu acesso à área de membros está liberado. Clique abaixo para criar sua senha e entrar.</p>
<p><a href="{{ .ConfirmationURL }}">Criar minha senha e entrar</a></p>
<p>O link vale por tempo limitado. Se expirar, use "Esqueci minha senha" na tela de login com este mesmo e-mail.</p>

<!-- Magic link or OTP -->
<h2>Entrar na Bunker707</h2>
<p>Clique abaixo para entrar sem senha. O link funciona uma vez e por tempo limitado.</p>
<p><a href="{{ .ConfirmationURL }}">Entrar agora</a></p>
<p>Se a tela pedir um código, use este: <strong>{{ .Token }}</strong></p>
<p>Se você não pediu este link, ignore esta mensagem.</p>

<!-- Change email address -->
<h2>Confirme seu novo e-mail</h2>
<p>Recebemos um pedido para trocar o e-mail da sua conta de {{ .Email }} para {{ .NewEmail }}.</p>
<p><a href="{{ .ConfirmationURL }}">Confirmar a troca</a></p>
<p>Se não foi você, ignore esta mensagem e sua conta continua como está.</p>

<!-- Reset password -->
<h2>Redefinir senha</h2>
<p>Recebemos um pedido para redefinir a senha da sua conta na Bunker707.</p>
<p><a href="{{ .ConfirmationURL }}">Criar uma nova senha</a></p>
<p>O link vale por 60 minutos. Se você não pediu, ignore esta mensagem: sua senha continua a mesma.</p>

<!-- Reauthentication -->
<h2>Confirme que é você</h2>
<p>Use este código para confirmar a ação:</p>
<p><strong>{{ .Token }}</strong></p>
<p>Se você não pediu este código, ignore esta mensagem.</p>
```

### 2.5 O que vive so no painel do Supabase cloud e precisa ser recriado na migracao para a Hetzner

Decisao do produtor (17/10): nao versionar isso agora; seguir desenvolvendo e, na migracao, recriar tudo no self-hosted. Esta e a lista do que o painel guarda e o `docker compose` nao herda:

1. **SMTP do Auth** -> variaveis do GoTrue no `.env` do compose: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587` (a Hetzner bloqueia a 465 de saida), `SMTP_USER=resend`, `SMTP_PASS=<chave Resend de envio>`, `SMTP_ADMIN_EMAIL=equipe@mail.bunker707.com.br`, `SMTP_SENDER_NAME=Bunker707`. A chave "Supabase Integration" criada pelo Resend serve so ao cloud; criar uma chave nova de envio para o self-hosted (ou reaproveitar `bunker707-member-area-envio`).
2. **Site URL e Redirect URLs** -> `SITE_URL=https://<dominio final da area de membros>` e `ADDITIONAL_REDIRECT_URLS` (sem os previews da Vercel).
3. **Modelos de e-mail** (secao 2.4) -> `GOTRUE_MAILER_TEMPLATES_{CONFIRMATION,INVITE,MAGIC_LINK,EMAIL_CHANGE,RECOVERY,REAUTHENTICATION}` apontando para os HTML servidos por URL (volume estatico no Caddy) e `GOTRUE_MAILER_SUBJECTS_*` com os assuntos da tabela.
4. **Rate Limits** -> `GOTRUE_RATE_LIMIT_EMAIL_SENT=25` (ou o valor da epoca), demais limites conforme o painel.
5. **Cadastro publico desligado**, senha minima, protecao contra senhas vazadas -> `GOTRUE_DISABLE_SIGNUP=true`, `GOTRUE_PASSWORD_MIN_LENGTH`, `GOTRUE_PASSWORD_HIBP_ENABLED`.
6. **Provedores de login** (hoje so e-mail + senha) e **Auth Hooks** (nenhum ativo) -> conferir no painel na hora e replicar por variavel.
7. **Usuarios** (`auth.users`, hashes bcrypt) e **dados** -> `supabase db dump` + restore; JWT secret novo (todo mundo loga de novo); objetos do Storage copiados a mao (secao 5).
8. **Integracoes OAuth do Resend** (Supabase e Vercel) -> nao existem no self-hosted; a Vercel deixa de existir nesse cenario (a variavel `RESEND_API_KEY` passa a ser `.env` do app no servidor).
9. **Bucket `content-assets`** (publico, 8 MB, JPEG/PNG/WebP) e politicas -> recriar pelas migracoes/SQL do repositorio e conferir no Storage self-hosted.
10. **Vault** (`jobs_tick_url`, `jobs_tick_token`) e o agendamento `pg_cron` do tick de jobs (docs/04) -> recriar apontando para o dominio final.

Ordem sugerida na migracao: subir o compose (PR #81) -> `.env` com os itens 1 a 5 -> migracoes do repositorio -> restore dos usuarios -> modelos (item 3) -> teste de "Esqueci minha senha" e de convite -> DNS do dominio final -> cutover. Quem executa e a IA, com esta lista como roteiro.

### 2.6 O app: adaptador de e-mail (PR #80)

Ate 17/10 de manha nao existia nenhum codigo de envio em `src/`. A PR #80 (feat/email, aberta para a dev em 17/10) traz `src/server/email/` com provedor atras de interface (Resend agora; SES depois por configuracao), fila `email_outbox` processada pelo tick de jobs respeitando 100/dia, templates de boas-vindas e de compra, disparo no acesso do aluno, webhook assinado do Resend e testes de comportamento (docs/18). Nao mesclada ate o produtor autorizar.

## 3. Hetzner: fatos verificados em 17/10/2026

### 3.1 Compartilhado x individual

Na Hetzner Cloud **todo servidor e uma maquina virtual em hardware compartilhado**. O que muda e a CPU:

- **Shared vCPU** (linhas CX, CPX, CAX): o hypervisor divide o tempo de CPU com as VMs vizinhas. Disco NVMe, memoria, rede e sistema sao exclusivos da sua VM. Indicado pela Hetzner para "uso variavel", nao para carga alta constante. Para uma area de membros com video na Bunny, a CPU fica ociosa quase o tempo todo: shared sobra.
- **Dedicated vCPU** (linha CCX): cada vCPU e um thread reservado, desempenho previsivel. Continua sendo VM.
- **Individual de verdade** (hardware exclusivo) so na linha de **Dedicated Root Server** (AX) ou no leilao de servidores usados: AX41-1-LTD por € 57,30/mes sem taxa de instalacao (estoque limitado; historicamente Ryzen 5 3600, 64 GB RAM, 2 x 512 GB NVMe, trafego ilimitado), AX42 € 97,30 + € 49 de instalacao, leilao a partir de ~€ 68. Nao tem backup automatico, snapshot nem Cloud Firewall; backup e firewall sao por sua conta.

Dado o preconceito com "compartilhado": para este projeto a diferenca pratica e nula; o que importa e isolamento de dados (igual nas duas) e previsibilidade (CCX ou AX). Se quiser hardware so seu, o AX41 custa ~€ 14/mes a mais que o CCX13 e tem 8 vezes a memoria.

### 3.2 Linhas, precos e disponibilidade (Alemanha/Finlandia, sem IVA, + € 0,50 do IPv4)

| Modelo | vCPU | RAM | Disco | Preco/mes | Situacao em 17/10 |
| --- | --- | --- | --- | --- | --- |
| CX23 | 2 shared Intel/AMD | 4 GB | 40 GB | € 5,49 | indisponivel |
| CX33 | 4 shared | 8 GB | 80 GB | € 8,49 (era € 6,49 ate 15/06/2026) | indisponivel (estoque intermitente em fsn1/nbg1/hel1) |
| CAX21 | 4 shared ARM | 8 GB | 80 GB | € 10,49 | indisponivel; ARM exige conferir imagens multi-arch do Supabase |
| CPX32 | 4 shared AMD | 8 GB | 160 GB | € 35,49 | disponivel |
| CCX13 | 2 dedicadas AMD | 8 GB | 80 GB | € 42,99 | disponivel (6/6 locais) |
| CCX23 | 4 dedicadas | 16 GB | 160 GB | € 85,99 | disponivel |
| AX41 (bare metal) | Ryzen 6 nucleos | 64 GB | 2 x 512 GB | € 57,30, sem setup | conferir no Robot |

Outros valores: Backups automaticos = 20% do servidor (7 slots diarios, apagados junto com o servidor); Snapshot € 0,0143/GB comprimido/mes (fica depois de apagar o servidor); Storage Box BX11 (1 TB) € 3,20/mes; Object Storage com 1 TB incluso (preco base nao renderizou); Cloud Firewall gratis; trafego 20 TB/mes incluso na UE, excedente € 1/TB; Volume € 0,0572/GB/mes. O site aplica IVA 0% para "All others" (Brasil), mas os termos falam em IVA legal: conferir na primeira fatura.

Reajustes: 01/04/2026 (atingiu tudo) e 15/06/2026 (so pedidos novos e rescale). Quem ja tem servidor mantem o preco antigo; rescale conta como pedido novo.

### 3.3 Localizacao

- Precos iguais em Falkenstein, Nuremberg e Helsinki. Nos EUA (Ashburn, Hillsboro) e Singapura so existem CPX e CCX, com CPX bem mais caro (CPX31 € 62,49) e CCX praticamente igual (CCX13 € 43,49). Trafego incluso: 20 TB na UE, 1 TB nos EUA, 0,5 TB em Singapura.
- Latencia (ida e volta a partir de Sao Paulo, medicoes publicas): Falkenstein/Nuremberg ~187-196 ms, Helsinki ~233 ms, Ashburn ~113-128 ms; a partir do Ceara, 160 ms (Alemanha) e 87 ms (Ashburn). Com app e banco no mesmo servidor, cada navegacao sem prefetch paga uma ida e volta; `<Link>` com prefetch, `loading.tsx` e os arquivos estaticos na borda da Cloudflare escondem boa parte disso; o video continua na Bunny (CDN), fora desse caminho. A Hetzner nao tem data center na America do Sul.
- Conclusao: Alemanha/Finlandia, como ja decidido. Se um dia o custo de latencia incomodar, CCX13 em Ashburn custa o mesmo.

### 3.4 Regras que mudam o plano

- **Portas 25 e 465 de saida bloqueadas** em todo servidor novo; desbloqueio so e pedido depois de 1 mes de conta e primeira fatura paga, caso a caso. A 587 fica aberta. Logo, SMTP de dentro da Hetzner (Supabase self-hosted -> Resend, Mautic -> SES) tem que usar **587/2587 (STARTTLS)**. Nao afeta o Supabase cloud.
- **Servidor desligado e cobrado** por inteiro ("until you delete them, independent of their state"); cobranca por hora com teto mensal; IPv4 primario cobra mesmo sem servidor.
- **Criacao de servidor restrita** para contas novas enquanto o incidente de capacidade durar. Primeiro passo pratico: abrir Create Server no console, ver quais tipos aparecem, e cancelar (o Claude foi bloqueado de abrir esse assistente pelo classificador de seguranca; o produtor faz ou autoriza explicitamente).
- Conta sem 2FA (aviso no console em 17/10). Ligar antes de qualquer servidor. Conta nova pode ser pedida a enviar documento ou fazer pre-pagamento antes do primeiro pedido.

## 4. Comparativo de custo mensal

| Cenario | Composicao | Moeda | Em reais | Operacao |
| --- | --- | --- | --- | --- |
| A | Vercel Pro (1 seat) + Supabase Pro + ActiveCampaign Starter 1.000 contatos (anual) | US$ 60 | ~R$ 305 | quase zero, tudo gerenciado |
| A' | Vercel Pro + Supabase Pro + Resend Free (sem ActiveCampaign) | US$ 45 | ~R$ 229 | quase zero |
| B | Hetzner CX33 + IPv4 + Backups 20% + Storage Box + Resend Free + Cloudflare Free | € 13,89 | ~R$ 79 | voce vira o SRE |
| B' | igual a B com **CPX32** (o que da para comprar hoje) | € 46,29 | ~R$ 264 | idem |
| C | igual a B com **CCX13** (vCPU dedicada) | € 55,29 | ~R$ 316 | idem |
| C' | igual a C com **CCX23** (16 GB, se o Mautic for no mesmo servidor) | € 106,89 | ~R$ 610 | idem |
| D | **AX41 bare metal** + Storage Box (sem backups da Hetzner; backup proprio) | € 60,50 | ~R$ 345 | maior: sem snapshot, hardware e seu |

Observacoes:

- Vercel Hobby (o plano atual) **proibe uso comercial**: ao lancar, ficar na Vercel exige Pro (US$ 20). Supabase Free pausa o projeto apos 7 dias sem atividade e nao tem backup; o Pro (US$ 25) traz backup diario de 7 dias.
- Custos iguais nos dois lados e fora da tabela: Bunny Stream, dominio, PostHog e Sentry (free), IOF de 3,5%.
- Os totais em reais nao incluem o tempo de operacao (atualizacoes de SO e Docker, releases mensais do Supabase self-hosted, upgrades de Postgres manuais com parada, renovacao TLS, teste de restore, monitoramento). Ninguem publica um numero; estimar horas/mes e o valor da hora antes de comparar R$ 264 com R$ 229.
- A economia que justificava a Hetzner (R$ 79 contra R$ 229-305) depende da CX33 voltar ao estoque para contas novas.

## 5. Supabase self-hosted: o que muda em relacao ao cloud

- Requisitos oficiais: minimo 4 GB RAM / 2 nucleos / 40 GB; recomendado 8 GB+ / 4 nucleos / 80 GB+. Stack completa ociosa mede 1,5-3 GB (terceiros). Next.js standalone ~0,5-1 GB; Coolify ~0,5-0,8 GB; sistema ~0,5 GB: total 3-5 GB. **8 GB cabe Next + Supabase + painel; com Mautic (PHP + MySQL 8.4/MariaDB 10.11 proprios) planejar 16 GB ou um segundo servidor.** Os 80 GB de disco tambem apertam com imagens, logs e backups locais: manter os backups fora do servidor.
- Painel recomendado: Coolify para o Next (previews por PR, deploy de imagem do GHCR) e o compose oficial do Supabase ao lado, atualizado com `update.sh`; nao usar o template Supabase do Coolify. Compose + Caddy puro so se abrir mao de previews na Hetzner. Nunca rodar `docker compose down -v` (apaga os volumes do banco).
- Componentes do compose oficial (out/2026): Studio, Envoy (Kong virou override opcional), Auth (GoTrue), PostgREST, Realtime, Storage, imgproxy, postgres-meta, Postgres **17** (padrao desde junho/2026; volumes PG 15 nao sobem sem `upgrade-pg17.sh`), Supavisor, Edge Runtime; Logflare/Vector so via override.
- Nao existe no self-hosted: branching, backups gerenciados e PITR, Management API (logo o **MCP do Supabase deixa de funcionar**; operacao vira psql e `supabase db push --db-url`), metricas avancadas, tela de SMTP (vai por `.env`: `SMTP_HOST`, `SMTP_PORT=587`, `SMTP_USER=resend`, `SMTP_PASS`, `SMTP_ADMIN_EMAIL`, `SMTP_SENDER_NAME`, mais `GOTRUE_RATE_LIMIT_EMAIL_SENT`), MFA/hooks por variaveis sem UI.
- Studio e protegido so por usuario/senha basica (`DASHBOARD_PASSWORD`): nunca expor na internet; VPN (Cloudflare Tunnel/Access) ou allowlist de IP no Cloud Firewall. O compose publica 8000 (gateway), 5432 e 6543 (Supavisor) em todas as interfaces se nao prefixar `127.0.0.1`; o Docker ignora o ufw para portas publicadas.
- Nunca subir com os valores do `.env.example`: rodar `utils/generate-keys.sh`, trocar `POSTGRES_PASSWORD`, `DASHBOARD_PASSWORD`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, `VAULT_ENC_KEY`.
- Atualizacoes: `update.sh` (merge de 3 vias, manifesto de breaking changes), releases aproximadamente mensais. Upgrade maior de Postgres e manual (`pg_upgrade`, 2x o tamanho do banco + 5 GB livres, backup da chave pgsodium).
- Backup precisa cobrir **banco + `./volumes/storage` + volume `db-config` (chave pgsodium) + `.env`/compose**. Dump via `supabase db dump` (nao `pg_dump` cru). PITR so com WAL-G/pgBackRest configurados por conta propria.
- Migracao cloud -> self-hosted: `supabase db dump` traz schema, dados, roles, RLS, funcoes e `auth.users` com os hashes bcrypt; JWT secret e chaves sao novos (todo mundo loga de novo); provedores sociais, redirect URLs, Edge Functions e objetos do Storage sao manuais. Como nao ha aluno, o caminho e deploy limpo.
- Paineis: **Coolify** v4.4.6 (09/10/2026; preview por PR via GitHub App com DNS wildcard; rolling update nao vale para compose) tem template Supabase **defasado** (Postgres 15, Kong, erro de imagem MinIO em issues de set-out/2026). **Dokploy** v0.30.8 (ainda 0.x; CVE critico de RCE em previews publicos corrigido em 2025) tem template atualizado (Postgres 17 + Envoy). Alternativa sem painel: compose oficial do Supabase + Caddy (TLS automatico), sem preview por PR.

## 6. Cronograma recomendado

1. **Agora (desenvolvimento)**: Vercel + Supabase cloud como esta. Resend: concluir DNS, SMTP do Auth, variavel na Vercel, adaptador de e-mail no app (boas-vindas e compra). Codigo continua portavel (Docker, nada exclusivo da Vercel; `@vercel/speed-insights` opcional).
2. **Em paralelo (quando a conta conseguir criar servidor)**: infra como codigo em `infra/` no repositorio (compose do Supabase pinado, Next standalone, Caddy ou Coolify, scripts de backup/restore, firewall, Cloudflare), ensaio completo de deploy num servidor de teste, teste de restore, documentacao do runbook. O servidor pode ficar ligado como staging (CPX32 € 36/mes) ou virar snapshot + apagar (centavos) depois do ensaio.
3. **Lancamento (antes do primeiro aluno)**: decidir producao com os precos daquele dia: Hetzner (CX33 se voltou; senao CPX32/CCX13) ou Vercel Pro + Supabase Pro (A'). Cutover = deploy limpo + migracoes + usuarios de equipe + teste de restore. Cloudflare Tunnel ou proxy na frente.
4. **Segunda rodada (captura e marketing)**: Amazon SES (conta AWS so na hora: o free tier atual sao creditos de ate US$ 200 que expiram em 6 meses; conta nova nasce no plano Essentials US$ 0,16/1.000 e deve ser trocada para a la carte US$ 0,10/1.000; sandbox 200/dia por regiao; pedido de producao em sa-east-1, aprovacao tipica de 1 a 3 dias uteis). Mautic 7.2 (PHP 8.2+, MySQL 8.4+/MariaDB 10.11+, tag Docker `7.2-apache`, tem e-mails transacionais proprios; o plugin comunitario de bounce do SES so instala no Mautic 5). Resend fica como fallback: dois DKIM no mesmo subdominio (seletores diferentes) e SPF/Return-Path em subdominios separados nao conflitam.

## 7. Seguranca e backup (checklist da "camada de seguranca")

Contas: 2FA na Hetzner (hoje desligado), Cloudflare, Resend, GitHub, Supabase, Vercel; chave de recuperacao guardada fora do computador.

Servidor (quando existir):

- Ubuntu 24.04 LTS, usuario nao-root com sudo, SSH so por chave (sem senha), `unattended-upgrades`, `fail2ban`.
- Hetzner Cloud Firewall (gratis): 22 so do seu IP; 80/443 so dos ranges da Cloudflare (ou nada, se usar Cloudflare Tunnel); resto fechado. Firewall do host (ufw) como segunda camada, lembrando que o Docker passa por cima dele: publicar portas em `127.0.0.1` e deixar so o proxy em 0.0.0.0:80/443.
- Cloudflare na frente: proxy (WAF basico, DDoS, TLS, cache de `_next/static`), 1 regra de rate limiting no Free, limite de upload de 100 MB por requisicao (uploads grandes vao direto para Bunny/Storage). Cloudflare Access protegendo Studio e paineis.
- Segredos em `.env` com permissao 600, fora do git; chaves do Supabase geradas no servidor; Postgres e Studio nunca publicos.
- Backups: Hetzner Backups (20%) para o servidor inteiro + dump diario do Postgres + `volumes/storage` + chave pgsodium + `.env` enviados criptografados (restic) para Storage Box (SFTP na porta 23, com "External Reachability" ligado na Storage Box); snapshot manual antes de cada upgrade; **restore testado todo mes** num servidor temporario.
- Monitoramento: Sentry (ja existe) + Uptime Kuma no proprio servidor ou Better Stack free (10 monitores externos) com alerta no celular; rotacao de logs do Docker no `daemon.json`.
- Cloudflare: modo TLS Full (strict) com certificado Let's Encrypt na origem; WebSockets do Realtime passam pelo proxy; HTML nao e cacheado; IP real do aluno vem em `CF-Connecting-IP`; limite de 125 s por requisicao.
- Ferramentas: `hcloud` CLI v1.70.1 e provider Terraform 1.70.0 sao oficiais; nao ha MCP oficial da Hetzner (os comunitarios funcionam; se usar, token somente leitura por projeto). Token com escrita so para o Claude operar com o ok do produtor, guardado em arquivo local ignorado pelo git.
- LGPD: dados de alunos guardados na Alemanha (e logs do Resend nos EUA) sao transferencia internacional (art. 33); precisa constar na politica de privacidade.

## 8. Checklist para a manha (ordem sugerida)

1. ~~Fazer login na Cloudflare no Chrome e avisar -> Claude cria DKIM + 2 CNAMEs e verifica o dominio no Resend.~~ Feito em 17/10 (manha); conferir em Resend > Domains se o status ja esta "Verified".
2. ~~Colar a `RESEND_API_KEY` no Supabase (SMTP) e na Vercel. Testar "Esqueci minha senha".~~ Feito em 17/10 (manha) pelas integracoes oficiais; teste entregue (secao 2.2).
3. Ligar 2FA na Hetzner.
4. No console da Hetzner, abrir Create Server so para ver quais tipos a conta consegue criar hoje (CX33? CPX32? CCX13?) e cancelar. Com isso a tabela da secao 4 vira decisao.
5. Decidir a trilha (secao 6). Se for montar a Hetzner em paralelo: criar um API token (projeto Default > Security > API tokens, Read & Write) e colar em `.env.hetzner.local` (git-ignored) para o Claude operar via `hcloud`; nunca no chat.
6. Autorizar as duas PRs seguintes: adaptador de e-mail (secao 2.3) e `infra/` como codigo (secao 6, item 2).

## 9. Fontes principais

- Hetzner: https://www.hetzner.com/cloud/ (linhas, "currently not available"), https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ (reajustes de 2026), https://status.hetzner.com/incident/0a75c7ae-3377-41dc-aabe-601063724d24 (Limited availability desde 26/06/2026), https://docs.hetzner.com/cloud/general/locations, https://wondernetwork.com/pings/Sao%20Paulo (latencias), https://docs.hetzner.com/cloud/billing/faq/ (cobranca de servidor desligado, 20% dos backups), https://docs.hetzner.com/cloud/servers/overview/ (shared x dedicated, IPv4), https://docs.hetzner.com/cloud/servers/backups-snapshots/overview/, https://docs.hetzner.com/cloud/servers/faq/ (portas 25/465), feed oficial de precos https://www.hetzner.com/_resources/app/data/app/live_data_prices.json.
- Supabase: https://supabase.com/docs/guides/self-hosting/docker (requisitos, segredos, compose), https://supabase.com/docs/guides/self-hosting (o que nao existe no self-hosted), https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore (dump/restore com auth.users), https://supabase.com/docs/guides/auth/auth-smtp (2/hora no embutido, 30/hora com SMTP proprio), https://supabase.com/pricing.
- Resend: https://resend.com/pricing, https://resend.com/docs/send-with-supabase-smtp, https://resend.com/docs/send-with-smtp (portas), https://resend.com/docs/dashboard/domains/introduction, https://resend.com/docs/dashboard/api-keys/introduction.
- Amazon SES: https://aws.amazon.com/ses/pricing/, https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html.
- Mautic: https://mautic.org/blog/mautic-7-columba-edition-is-released, https://forum.mautic.org/t/mautic-7-2-lynx-edition-is-released, https://hub.docker.com/r/mautic/mautic.
- Vercel: https://vercel.com/pricing (Hobby nao comercial; Pro US$ 20/seat). ActiveCampaign: https://www.activecampaign.com/pricing. Cloudflare: https://developers.cloudflare.com/waf/, https://www.cloudflare.com/plans/.
- Coolify: https://coolify.io/docs, https://github.com/coollabsio/coolify/releases. Dokploy: https://docs.dokploy.com, https://github.com/Dokploy/dokploy/releases.
- Cambio: PTAX Banco Central 16/10/2026 (https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/).
