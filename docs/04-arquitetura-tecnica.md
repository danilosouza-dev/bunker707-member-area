# Arquitetura Tecnica

## Stack recomendada

Stack principal:

- Next.js App Router;
- TypeScript;
- Tailwind CSS;
- shadcn/ui;
- Supabase Postgres;
- Row Level Security;
- Supabase Auth;
- Mux ou Bunny Stream para video;
- PostHog para analytics de produto;
- Sentry para erros;
- Trigger.dev ou Inngest para jobs;
- Vercel no inicio, com possibilidade de migrar para Hetzner.

## Principio de arquitetura

O backend nao deve ser apenas "Supabase". A divisao recomendada e:

```txt
Next.js = aplicacao + backend de regra de negocio
Supabase = banco + RLS + storage simples + auth se escolhido
Jobs = processamento em background
Video = provedor especializado
Analytics = eventos e funis
```

## Componentes

```txt
Aluno
  -> Next.js app
  -> Route handlers/server actions
  -> Supabase Postgres
  -> Provedor de video

Hotmart/Ticto/etc.
  -> Webhook API
  -> evento bruto
  -> job de processamento
  -> entitlement/acesso

Hotmart/Ticto/TikTok/Kiwify
  -> adapter do provider
  -> produto ou combo interno
  -> entitlements por produto incluido

Aluno assistindo aula
  -> eventos de progresso
  -> tabela student_events
  -> dashboards futuros

Aluno comentando aula
  -> bloqueio por palavra proibida
  -> comentario pendente/aprovado
  -> fila de moderacao
  -> notificacao no sino de quem foi respondido ou mencionado (desde 20/10/2026)

Equipe criando aviso (Comunicacao > Avisos e pop-ups)
  -> segmento por regras sobre os dados dos alunos
  -> notificacao no sino (agora ou agendada pelo tick) ou pop-up na home
  -> vistos, cliques e quem voltou a estudar
  -> notificacoes seguintes e fluxos (desde 21/10/2026): o motor no tick decide, para cada aluno,
     o que sai e quando, pelo que ele fez com as notificacoes anteriores, visitas e acessos

Aluno perguntando para IA
  -> checagem de entitlement
  -> escopo do agente
  -> contexto permitido
  -> conversa auditavel
```

## Modulos do backend

Estrutura sugerida:

```txt
src/
  app/
    api/
      webhooks/
      progress/
      search/
      support/
  server/
    auth/
    db/
    access/
    content/
    progress/
    events/
    payments/
    video/
    support/
    comments/
    moderation/
    ai/
    jobs/
    email/
    communications/   (avisos, sino, pop-ups, notificacoes seguintes e fluxos; secao Comunicacao abaixo)
    member-area/      (inclui page-visits.ts: visitas das paginas que um fluxo no ar usa)
```

## Arquitetura de dados implementada

A aplicacao usa o Supabase como fonte unica, mas o browser nao consulta as tabelas de catalogo diretamente. O fluxo atual e:

```txt
Browser autenticado
  -> pagina ou Route Handler do Next.js
  -> guard de sessao/admin
  -> regra de acesso de dominio
  -> cliente Supabase service role somente no servidor
  -> consulta ou mutacao granular
```

Invariantes:

- leituras administrativas e leituras da area do aluno usam caminhos separados;
- a leitura do aluno filtra `lesson_progress`, `saved_items` e `entitlements` pela identidade autenticada (entitlements sao a unica fonte de acesso; as tabelas `students`/`student_courses` do admin antigo foram removidas em 14/10/2026);
- modulos e aulas da area do aluno carregam somente registros publicados;
- chamadas repetidas durante a mesma renderizacao sao memoizadas com `cache`, evitando a segunda leitura integral antes causada pelo shell e pela pagina;
- paginas por aluno (aula com progresso, perfil) nunca sao abertas por `<Link prefetch>`: o prefetch cheio do Next 16 guarda a pagina inteira por ate 5 min no navegador e o clique mostra estado velho (bug da aula "Concluida" por um caminho e "Concluir" por outro, 16/10/2026); usa-se o prefetch padrao (auto), que so aquece a rota, e `router.refresh()` quando uma acao do cliente muda o que a pagina mostra;
- favoritos e progresso usam `upsert`/`delete` direcionados; mutacoes do CMS gravam somente as tabelas afetadas;
- exclusoes de aulas e modulos sao mutacoes administrativas autenticadas; a camada server-side limpa favoritos e referencias de progresso e os triggers do Supabase repetem essa garantia na mesma transacao da exclusao, enquanto eventos comportamentais historicos permanecem append-only;
- nao existe mais sincronizacao que leia e regrave toda a base para salvar uma unica interacao;
- erros inesperados sao registrados no servidor e recebem mensagem publica sanitizada.

O arquivo `src/server/db/platform-store.ts` ainda concentra mapeamentos legados e casos de uso demais. A separacao por dominios (`content`, `students`, `progress`, `saved-items`) e divida estrutural registrada na auditoria, mas deve ser feita incrementalmente com testes de contrato, sem trocar a fonte de verdade nem duplicar regras.

### Configuracao publicada da Home

`HomeSectionConfig` e o contrato canonico compartilhado entre o CRM e a Home do aluno. O editor mantem o rascunho no cliente e publica a lista ordenada inteira por `PUT /api/admin/home-sections`; a rota exige administrador, valida IDs, fontes, layouts e referencias de conteudo e so entao atualiza a configuracao publicada.

O servidor transforma a configuracao em `HomeRow` e aplica visibilidade, entitlements, progresso e estado salvo antes de renderizar. Preview e Home reutilizam `FeaturedStructureHomeSection` para os layouts estrutural compacto e imersivo, evitando uma implementacao visual paralela que possa divergir da pagina final.

A fonte `sellable_products` e resolvida por aluno: antes de criar a fileira, o servidor remove todo produto para o qual `hasPurchaseAccess` ja retorna acesso. Assim, `Produtos a venda` nunca repete um produto presente na biblioteca do aluno; se nenhuma oferta restar, a fileira nao e renderizada.

A migration `202607100003_home_sections.sql` materializa `home_sections` e `home_section_items`. Enquanto essa migration relacional nao estiver aplicada no ambiente remoto, a implementacao ativa persiste a lista canonica em `platform_settings.homeSections`; esse fallback e transitorio e nao altera o contrato da API nem transforma configuracao visual em autorizacao.

## Midia de conteudo

Capas e thumbnails nao devem ser persistidas como Data URL/Base64 em colunas do Postgres. O fluxo implementado converte uploads inline em objetos deterministas no bucket publico `content-assets`:

- JPG, PNG e WebP;
- limite de 8 MB;
- caminho segmentado por entidade e hash SHA-256 do arquivo;
- `Cache-Control` de um ano;
- URL publica persistida nas tabelas de conteudo.

O bucket e publico porque as capas sao arte de exibicao, nao material protegido. Videos, materiais privados e arquivos originais continuam fora desse bucket e exigem autorizacao/token proprio.

Avisos da Comunicacao (desde 20/10/2026, `docs/22` §4.5): a imagem 16:9 do aviso usa o mesmo fluxo (recorte WebP de 1280 x 720 no navegador, servidor confere medida e peso, ate 420 KB) e vai para `content-assets/communications/images`. O audio do aviso fica no bucket publico proprio `communication-audio` (migracao `202610200001`: so tipos de audio, ate 10 MB), em `campaigns/{hash}.{ext}` com `Cache-Control` de um ano. Ele sobe por rota (`POST /api/admin/communications/audio`, multipart), nao por Server Action (limite de 1 MB), e o servidor confere o formato pelos primeiros bytes. Duracao e forma de onda sao medidas no navegador da equipe e gravadas com o aviso; so a URL vai para o banco. Publico pelo mesmo motivo das capas: aviso nao e conteudo pago e o nome por hash nao e adivinhavel.

## Autenticacao

Decisao do MVP: Supabase Auth.

Motivos:

- menos fornecedores no primeiro ciclo;
- integrado ao banco e as policies RLS;
- bom para MVP enxuto;
- permite email/senha, OAuth e recuperacao de senha sem expor service role no browser.

Implementacao atual:

- `@supabase/ssr` cria clientes de browser, servidor e proxy;
- o `src/proxy.ts` (convencao do Next 16 que substitui `middleware.ts`, runtime Node; precisa ficar em `src/` porque o app esta em `src/app`, senao o Next o ignora no build) protege home, `Minhas compras`, `Favoritos`, paginas de conteudo/aula e `/admin`;
- o `proxy.ts` valida a sessao com `getUser()` por padrao ou com `getClaims()` quando `AUTH_SESSION_STRATEGY=claims` (verificacao local do JWT via JWKS so com signing keys assimetricas no Supabase; sem elas o `getClaims()` ainda consulta o Auth); nas paginas, `getAuthenticatedUser` e `getAdminRoleForUser` usam `React.cache`, entao layout, pagina, guards e loaders fazem uma unica chamada ao Supabase por request; as paginas de conteudo do aluno usam `getSessionUser` (com `claims`, so o JWT, sem chamada ao Auth; docs/06) e leem o catalogo publicado de `unstable_cache` com a tag `catalog` (platform-store; o admin le direto do banco);
- em `/api/*` o proxy nao consulta o Auth (desde 17/10/2026): devolve o pedido so com a CSP e o nonce, e cada handler valida e renova a sessao por conta propria (`requireApiUser`, `requireApiRole`, `createSupabaseServerClient`) ou usa token proprio (receptor da TV, tick de jobs, webhooks). Antes, a consulta do proxy dobrava as chamadas ao Auth nas rotas mais frequentes (poll e heartbeat do Modo TV, progresso, comentarios, tutor) sem decidir nada; `tests/proxy-rotas-de-api.test.mjs` garante que nenhuma rota de API dispara `getUser()`/`getClaims()` no proxy;
- `/login` autentica por email/senha e provedores sociais habilitados no Supabase;
- `/auth/callback` troca o codigo OAuth por sessao no servidor;
- apos autenticar, usuarios com papel em `admin_roles` sao direcionados para `/admin`; alunos sem papel administrativo seguem para a area de membros;
- `/alterar-senha` permite que aluno autenticado defina nova senha quando `must_change_password` estiver ativo;
- o `proxy.ts` redireciona usuarios com `must_change_password = true` para `/alterar-senha` antes de liberar a area de membros;
- `/admin` exige papel em `admin_roles`, e cada area, tela e acao exige a permissao dela (docs/17 §2.3): menu e busca mostram so o que a pessoa pode abrir, e permissao que vale so nos cursos da pessoa (a do Professor, por exemplo) fica presa aos cursos dela (`requireScope`, `src/server/auth/product-scope.ts`). As permissoes somam as funcoes da pessoa (prontas e personalizadas, `admin_functions`) e os extras dela, calculadas uma vez por requisicao (`loadAdminAccess`, `src/server/auth/admin-access.ts`);
- APIs de progresso exigem usuario autenticado e APIs do CMS exigem permissao administrativa.

Cadastro manual de aluno:

- o CRM pode enviar convite para o aluno criar senha, que e o fluxo padrao;
- alternativamente, o admin pode gerar ou definir uma senha temporaria;
- as Server Actions de Alunos (`src/server/students/actions.ts`) rodam apenas no servidor, passam por `runAdminAction` com as acoes `students.*` e usam o Supabase Admin com `service_role` para criar contas, convidar e liberar acesso (`src/server/students/access.ts`, a mesma rotina que os webhooks de venda vao usar);
- convite usa Supabase Auth e direciona para `/auth/callback?next=/alterar-senha&provider=email`, para trocar o codigo do link em sessao server-side antes de levar o aluno para definir senha;
- senha temporaria cria ou atualiza o usuario no Supabase Auth, marca `must_change_password = true` e nao salva a senha no CMS;
- o mesmo fluxo sincroniza `profiles` e `entitlements` para os cursos/produtos selecionados no cadastro.

Desenvolvimento local tambem usa Supabase real:

- nao existe login local, usuario fixo ou cookie de desenvolvimento;
- sem variaveis Supabase, a autenticacao fica indisponivel;
- sem banco acessivel ou migrations aplicadas, leitura e escrita falham explicitamente;
- dados de catalogo, modulos, aulas, alunos, favoritos, progresso e configuracoes nao devem vir de seed, mock, fallback `.data` ou fixtures de runtime.

## Acesso e entitlements

A plataforma nao deve perguntar "o aluno comprou?". Ela deve perguntar "o aluno tem entitlement ativo para este conteudo?".

Entitlement e a permissao real dentro da Bunker707.

Cursos com `commerce_scope = included_content` precisam declarar a formacao principal. A implementacao atual grava essa relacao em `content_page_settings.parentFormationId`; o entitlement da formacao libera apenas os cursos explicitamente associados a ela. A relacao deve migrar para `formation_courses` quando o modelo relacional definitivo for materializado, mantendo compatibilidade de leitura durante a transicao.

Exemplos:

- acesso vitalicio a uma formacao;
- acesso temporario a um curso;
- acesso liberado por plano;
- acesso bloqueado por reembolso;
- acesso suspenso por inadimplencia.

## Webhooks externos

Cada plataforma deve ter adaptador proprio:

```txt
HotmartAdapter
TictoAdapter
TikTokAdapter
StripeAdapter
ManualGrantAdapter
```

Fluxo:

1. Receber webhook.
2. Validar assinatura ou token.
3. Salvar payload bruto.
4. Checar idempotencia.
5. Normalizar evento.
6. Processar em job.
7. Resolver produto ou combo interno.
8. Atualizar entitlements internos.
9. Registrar auditoria.

Combos devem ser tratados como pacotes internos: o adapter normaliza a venda externa, o backend encontra o combo/produto correspondente e a camada de acesso cria entitlements para todos os produtos incluidos. O dado do provider nao autoriza conteudo diretamente.

### Implementado (17/10/2026): Hotmart, webhook 2.0

Modulo `src/server/payments/` (migracao `202610170003_sales_webhooks.sql`; tela em `docs/17` §1.10). A Ticto entrou pelo mesmo caminho (secao seguinte); a Kiwify entra quando tiver adaptador e ate la aparece como "Em configuracao". Retencao: 12 meses depois, `public.prune_personal_data()` (migracao `202610170004`) tira payload, e-mail e erro de `webhook_events`; a linha fica para historico e idempotencia e `reprocessWebhookEvent` recusa com 409 (`docs/06`, secao LGPD).

- `types.ts`: contrato `PaymentProviderAdapter` (`verify`, `normalize`, `redact`, `handledEvents`, `maxPayloadBytes`) e o evento normalizado `{ provider, eventId, type: purchase_approved | refund | chargeback | subscription_canceled | other, rawType, buyer { email, name, phone }, externalProductId, externalProductName, transactionId, purchasedAt, warrantyEndsAt, occurredAt }`;
- `hotmart.ts` (puro): le o envelope 2.0 (`id`, `event`, `creation_date` em epoch ms, `data.product/buyer/purchase/subscriber`), traduz `PURCHASE_APPROVED` e `PURCHASE_COMPLETE` para `purchase_approved` (o segundo com `reopenClosedAccess: false`: fim da garantia confirma uma compra anterior e so libera para quem nunca teve acesso ao produto, nunca reabre acesso suspenso ou revogado), `PURCHASE_REFUNDED` para `refund`, `PURCHASE_CHARGEBACK` para `chargeback`, `SUBSCRIPTION_CANCELLATION` para `subscription_canceled` e o resto para `other`; confere o hottok (cabecalho `X-HOTMART-HOTTOK`, ou `hottok` no corpo) em tempo constante contra o **SHA-256** guardado em `integration_settings.secret` (`secret.ts`: o token em si nunca vai para o banco), nunca contra variavel de ambiente; `redact` guarda so os campos permitidos do payload (envelope; `product.id/name`; `purchase.transaction/status/approved_date/order_date/warranty_expire_date`; `subscription.status/subscriber.code`; do comprador so e-mail, nome e telefone). Documento, endereco, produtor, afiliados, comissoes e o token nunca sao gravados; evento que nao muda acesso guarda so o envelope;
- `adapters.ts`: registro (`getPaymentAdapter`, `isSalesProviderSupported`);
- `process-sale.ts`: a regra de acesso, separada do parser. Resolve `sales_product_links` (codigo da plataforma -> produto ou pacote); compra aprovada chama `provisionStudentAccess` de `src/server/students/access.ts` com `source: "webhook"`, `sourceProvider: "hotmart"`, `sourceEventId` = `purchase.transaction` (ou o id do evento), `delivery: "none"` e `siteOrigin` do request (a mesma rotina do admin: conta, perfil, boas-vindas e e-mail de compra saem dali). Antes de liberar, uma compra que ja tem reembolso ou chargeback registrado em `webhook_events` (mesma plataforma e `transaction_id`) e ignorada: reprocesso ou reenvio fora de ordem nao devolve acesso a quem foi reembolsado. Cada (venda, acesso) liberado vira um vinculo em `sale_grants` (migracao `202610170008`): se a venda ABRIU o acesso (nao existia ou estava fechado) ou so ESTENDEU um acesso aberto (e que prazo ele tinha), com o codigo da assinatura quando houver. Sem a tabela de vinculos no banco nenhuma venda libera acesso (o evento fica `failed` ate a migracao entrar e o reprocesso). Acesso que ja existia ganha o vinculo ANTES da liberacao (uma falha no meio nao perde o prazo guardado; a mesma venda nao duplica o vinculo) e acesso novo logo depois; no reprocesso de uma falha, o acesso cujo `source_event_id` e da propria venda conta como aberto por ela, nunca como "estendido". Reembolso, chargeback e assinatura cancelada decidem cada acesso por `decideEntitlementAfterSale` (`model.ts`) olhando o HISTORICO INTEIRO dos vinculos dele (a ordem dos reembolsos nao muda o resultado): vinculos fechados pela equipe (`closed_by = admin`) nao contam e, so com eles, o acesso fica com a equipe; outra compra paga ainda aberta o sustenta (outra transacao, que nao seja cobranca das assinaturas sendo desfeitas) -> fica; senao manda o vinculo mais antigo: abriu o acesso e a origem ainda e a plataforma -> `applyAccessAction` com `revoke` (ou `suspend`, no cancelamento); so estendeu um acesso de outra origem com prazo -> o prazo volta (`restoreEntitlements`, resultado `access_restored`); so estendeu sem prazo -> fica. Cobrancas de uma assinatura nao se sustentam entre si (a renovacao reembolsada fecha o acesso que a primeira cobranca abriu), mas nunca fecham o que a equipe deu. A regra age primeiro e so depois fecha os vinculos da venda (uma falha no meio deixa tudo para o reprocesso refazer; vinculo ja fechado numa tentativa anterior ainda manda no acesso). A equipe que revoga, suspende, reativa ou reabre um acesso (`access.ts`) marca TODOS os vinculos dele como `admin`. Cancelamento com `subscriber.code` sem cobranca registrada e ignorado (nao adivinha pelo produto); sem codigo nenhum, vale o `source_provider` nos produtos do alvo, respeitando vinculos abertos de outras compras. Sem vinculo gravado, vale o `source_event_id` (a 0008 preenche os vinculos das vendas anteriores a ela). Pacote pausado ou em rascunho barra so a compra, nunca o reembolso. O que nao da para fazer (evento `other`, codigo sem ligacao, pacote em rascunho na compra, aluno sem conta, acesso ja fechado) e **ignorado com o motivo escrito**; erro de verdade (sem e-mail valido, banco) vira `failed`;
- `webhook-handler.ts`: fluxo comum de `POST /api/webhooks/<plataforma>`: plataforma conectada (senao 503; token guardado em texto puro, de antes do hash, tambem responde 503 e marca "Precisa de atencao" com "troque o token") -> corpo ate 256 KB (413) -> JSON (400) -> token (401, nada gravado) -> evento normalizado (400) -> `webhook_events` com os campos permitidos do payload, `transaction_id` e `processing_started_at` (evento que nao muda acesso nao guarda nem o e-mail), unico por (`provider`, `external_event_id`) -> regra de acesso -> resultado na linha (`processed`/`ignored`/`failed`, `outcome`, `outcome_detail`, `error_message`, alvo e aluno resolvidos, trava solta) e em `integration_settings` (`last_sync_at`; `needs_attention` + `last_error` enquanto houver QUALQUER venda `failed` ou presa em `received` ha mais de 5 minutos, nao so quando a ultima falhou). Evento repetido: processado, ignorado ou com erro responde 200 `duplicate`; preso em `received` ha mais de 45 s (a funcao estourou o tempo depois de gravar) e reivindicado por update condicional e processado de novo (`resumed: true`); preso ha menos de 45 s responde 409 `processing` para a plataforma tentar de novo e nunca dar como entregue. Falha responde 500 e o evento fica guardado; `reprocessWebhookEvent` reivindica a linha com a mesma trava (segundo clique ou reenvio ao mesmo tempo recebe 409) e roda a regra de novo a partir do payload guardado para o que falhou, foi ignorado ou esta preso em `received` ha mais de 5 minutos;
- `store.ts`, `queries.ts` (o e-mail do comprador sai do servidor ja mascarado; o endereco do webhook vem de `NEXT_PUBLIC_SITE_URL` e a tela avisa quando a variavel falta ou o admin esta aberto por outro endereco; a situacao de cada plataforma e conferida AO VIVO ao abrir a tela ou o hub: venda `failed` ou presa em `received` ha mais de 5 minutos, que nao gera evento nenhum, vira "Precisa de atencao" na hora e e gravada em `integration_settings`, nunca o contrario), `actions.ts` (`saveSalesSecret` grava o hash, `disconnectSalesProvider`, `reprocessSalesEvent`, todas `settings.sales`, com `admin_audit_log` sem o token), `schemas.ts`, `secret.ts` (hash e conferencia do token), `model.ts` (rotulos, mascara do e-mail, situacao);
- `src/app/api/webhooks/hotmart/route.ts` (runtime Node) chama `receiveSaleWebhook("hotmart", request)`;
- um evento de venda pode liberar varios produtos: `grantResolvedProducts` grava `source_event_id` com o sufixo `:<produto>` quando ha mais de um produto no mesmo evento (indice unico `(user_id, source_event_id)`); o e-mail de compra continua um por venda. Um acesso fechado (revogado, suspenso, expirado) reaberto por uma venda passa a pertencer a essa venda (`source_provider` e `source_event_id` atualizados): o reembolso dela o fecha de novo, e um acesso aberto que so ganhou prazo continua da origem antiga;
- "Codigo do produto na Hotmart" em Produtos > Acesso e venda e em Pacotes confere o conflito (`assertSalesLinkAvailable`) ANTES de gravar a linha do produto ou criar o pacote: codigo repetido vira erro do campo sem deixar nada gravado pela metade. Sem a tabela de ligacoes (banco sem a migracao), as telas do catalogo seguem sem o campo e a gravacao do codigo recusa com a frase da migracao;
- exclusao do aluno (`deleteStudent`) anonimiza as vendas dele em `webhook_events` (e-mail nulo, payload so com o envelope e `anonymized: true`); o historico do resultado fica.

```txt
Hotmart -> POST /api/webhooks/hotmart (X-HOTMART-HOTTOK)
  -> integration_settings.secret (503 sem) -> token conferido (401) -> webhook_events (payload bruto, idempotente)
  -> sales_product_links (codigo -> produto | pacote) -> src/server/students/access.ts -> entitlements + email_outbox
  -> webhook_events.outcome + integration_settings.last_sync_at/status
Configuracoes > Vendas (settings.sales): token, endereco, eventos, vendas recebidas, Reprocessar
Produtos > Acesso e venda / Pacotes: "Codigo do produto na Hotmart" (sales_product_links)
Hoje > Novos acessos: origem por admin_access_origins (Hotmart x equipe)
```

Processamento sincrono na rota (a Hotmart espera a resposta e reenvia em erro): um job em background fica para quando o volume pedir.

### Implementado (17/10/2026): Ticto, webhook 2.0

Mesmo modulo, mesma tabela, mesma regra de acesso e mesmo fluxo de `webhook-handler.ts`; o que e da Ticto fica so no adaptador. Fonte do formato: https://webhook.ticto.dev/docs/v2 (referencia oficial do webhook 2.0, conferida em 17/10/2026); onde cadastrar no painel (Tictools > Webhooks, versao 2, formato JSON, token gerado pela Ticto) vem de guias de integradores (Nemu, Voxuy), porque a referencia oficial nao descreve o painel.

- `ticto.ts` (puro): le o envelope 2.0 (`version` "2.0", `status`, `status_date` e `order.order_date` em "AAAA-MM-DD HH:MM:SS" no horario de Brasilia, convertidos para UTC com -03:00; `order` com `id`, `hash` e `transaction_hash`; `transaction.hash`; `item` com `product_id`, `product_name`, `offer_id`, `offer_code` e `refund_deadline` em dias; `customer` com `name`, `email`, `phone { ddi, ddd, number }`, `cpf`/`cnpj`). Traduz `authorized` e `uncanceled` (assinatura reativada) para `purchase_approved`, `refunded` para `refund`, `chargeback` para `chargeback`, `subscription_canceled` para `subscription_canceled` e o resto (pix/boleto gerado, aguardando pagamento, recusado, reclamacao, trial, carrinho abandonado...) para `other`. Comprador em `customer`; telefone do objeto `customer.phone` (ou dos campos soltos `phone_local_code_customer` + `phone_number_customer`) no formato `+55 11999990000`. Codigo do produto = `item.product_id` (o da oferta, `offer_id`/`offer_code`, nao e usado: uma venda de qualquer oferta do produto libera o mesmo produto). Os order bumps (`bumps[]`, cada um com `product_id` e `product_name`) viram `extraProducts` no evento normalizado (campo opcional, ausente na Hotmart), sem repetir o principal e no maximo 20. `transactionId` = `transaction.hash` (ou `order.transaction_hash`). Fim da garantia = data do pedido + `refund_deadline` dias (normalizado, ainda nao gravado, como na Hotmart);
- a Ticto **nao manda id de evento**: a chave de idempotencia (`external_event_id`) e `<transacao>:<produto>:<status>:<status_date>` (sem transacao, o `order.hash`; o produto separa um postback proprio de bump do postback do principal). Sem `status_date`, um digest do payload guardado (sem o token) entra no lugar da data. Chave acima de 200 caracteres vira `sha256:<hex>` inteira, nunca cortada. O mesmo postback reenviado tem a mesma chave e para no 200 `duplicate`; outra situacao da mesma compra (reembolso, cancelamento) e outro evento;
- order bumps em `process-sale.ts`: cada codigo do pedido (o principal e os vendidos junto) e resolvido em `sales_product_links` como o principal (`resolveLine`); os produtos de todos os codigos ligados entram numa so liberacao (um e-mail de compra; `source_event_id` com o sufixo `:<produto>`) e num so reembolso, chargeback ou cancelamento. Codigo nao ligado, pacote pausado ou alvo sem produto fica escrito no `outcome_detail` ("O produto vendido junto 9001 (...) nao esta ligado ... e nao foi liberado") e nao bloqueia o resto. A linha de `webhook_events` guarda o principal (ou o primeiro codigo liberado, quando o principal nao esta ligado);
- autenticacao: o `token` vem **so no corpo** (a referencia chama de "principal garantia" de que o post vem da Ticto; nao ha cabecalho nem assinatura). `verify` confere esse campo em tempo constante contra o SHA-256 guardado em `integration_settings.secret`, com o mesmo `isValidSalesToken` da Hotmart (`secret.ts`); o banco nunca guarda o token. A leitura comum aos dois adaptadores (`asObject`, `shortString`, `normalizeBuyerEmail` e `pick`, que copia so os campos permitidos) fica em `adapter-helpers.ts`. Um cabecalho com o token nao vale;
- `redact` guarda so a lista de campos permitidos, como na Hotmart: envelope (`version`, `status`, `status_date`, `payment_method`), `order` (ids, data e valor), `transaction.hash`, `item` (produto, oferta e prazo de reembolso), `bumps` (produto e oferta), `subscriptions` (id, intervalo, cancelamento e proxima cobranca) e, do comprador, nome, e-mail, telefone e codigo. Token, `direct_login_url` (link de entrada direta na area da Ticto), CPF/CNPJ, endereco, cartao, rastreio, produtor, afiliados, coprodutores e comissoes nunca sao gravados; o reprocesso relê so o que ficou;
- `reopenClosedAccess` = verdadeiro em `authorized` e `uncanceled` (pagamento novo e assinatura reativada reabrem o acesso fechado); `subscriptionCode` = `subscriptions[0].id` (o mesmo em todas as cobrancas da assinatura e no cancelamento). Reembolso, chargeback e cancelamento seguem o vinculo venda -> acesso da Hotmart (`sale_grants`, migracao `202610170008`): cada produto liberado pela venda, inclusive os order bumps, vira um vinculo da mesma transacao; o reembolso fecha os vinculos daquela venda e so revoga o que ela abriu (o curso pago antes na Hotmart, que outra compra sustenta, fica). O cancelamento da Ticto traz a transacao da ultima cobranca, mas com o codigo da assinatura fecha a assinatura inteira, como na Hotmart; sem cobranca registrada com o codigo, vale a transacao. A reativacao (`uncanceled`, mesma transacao) reabre o vinculo que o cancelamento fechou (`reopenSubscriptionCanceledGrants`): com a decisao pelo historico inteiro do acesso, e isso que faz a assinatura reativada voltar a sustentar o acesso (sem reabrir, o reembolso de uma compra da Hotmart depois revogaria o curso que a assinatura paga). Vinculo fechado pela equipe (`admin`), por reembolso ou por chargeback nunca reabre. A reativacao tambem nao e compra nova (`reactivatesSubscription` no evento): so libera os produtos cujo vinculo desta transacao foi fechado por `subscription_canceled`; o resto (equipe decidiu depois, sem cancelamento registrado) fica de fora com o motivo, e sem nenhum, a venda fica ignorada. Vinculo desta transacao aberto com o acesso ainda fechado tambem conta como reabrivel (uma tentativa anterior reabriu e falhou antes de liberar), e assinatura com reembolso ou chargeback em qualquer cobranca (vinculo fechado por eles ou evento registrado) nao volta por reativacao. No `removeAccess`, o cancelamento nao rebaixa um acesso revogado para suspenso. No pedido com bump, so os produtos do item principal levam o codigo da assinatura (o bump e cobranca unica, `docs/06`), e no cancelamento pela assinatura o acesso com vinculo da mesma transacao fora da assinatura nao entra como "acesso sem vinculo";
- `adapters.ts` registra `ticto`; `src/app/api/webhooks/ticto/route.ts` (runtime Node) chama `receiveSaleWebhook("ticto", request)`; eventos que a tela pede para marcar: `authorized`, `uncanceled`, `refunded`, `chargeback`, `subscription_canceled`;
- catalogo: "Codigo do produto na Ticto" ao lado do da Hotmart em Produtos > Acesso e venda (`updateProductAccess.tictoProductId`) e em Pacotes (`saveCombo.tictoProductId`), gravado em `sales_product_links` com `provider = ticto`. Cada plataforma tem o proprio codigo (o mesmo numero pode existir nas duas). `assertSalesLinksAvailable` (`store.ts`) confere os codigos **antes** de gravar o produto ou o pacote: codigo de outro alvo e recusado no campo da plataforma (`SALES_CODE_FIELDS` em `model.ts`) e nada e gravado. Antes, a linha do produto era gravada e o codigo recusado depois, e o Salvar seguinte, com o codigo corrigido, respondia 409.

```txt
Ticto -> POST /api/webhooks/ticto (token no corpo)
  -> o mesmo fluxo da Hotmart (503 / 413 / 400 / 401 / duplicate / 200 / 500)
  -> webhook_events (provider ticto, chave transacao:status:data, payload sem token nem CPF)
Produtos > Acesso e venda / Pacotes: "Codigo do produto na Ticto" (sales_product_links, provider ticto)
```

## Comentarios e moderacao

Comentarios de aula entram pela API autenticada do aluno e devem passar por validacoes antes de aparecer:

1. Verificar sessao e entitlement da aula.
2. Checar palavras bloqueadas.
3. Aplicar limite de tamanho, controle de rajada e protecao contra envio duplicado.
4. Criar comentario como `pending` ou `approved`, conforme regra do produto; no MVP atual, comentarios validos entram como `approved`.
5. Persistir respostas, uma reacao por aluno/comentario e denuncias idempotentes.
6. Permitir que moderadores aprovem, ocultem, restaurem ou marquem como spam.
7. Registrar acoes sensiveis em auditoria e eventos comportamentais sem duplicar o corpo do comentario nos metadados.

Implementacao atual:

- leitura e criacao: `/api/comments/lessons/[lessonId]`;
- reacoes: `/api/comments/[commentId]/reaction`;
- denuncias: `/api/comments/[commentId]/report`;
- moderacao: `/api/admin/moderation/comments/[commentId]`;
- palavras bloqueadas: `/api/admin/moderation/blocked-words`;
- tabelas de comentarios ficam com RLS habilitado e sem acesso direto de `anon`/`authenticated`; as regras de sessao, entitlement e moderacao rodam nas APIs server-side;
- `analysis_status`, `analysis_result` e `analyzed_at` deixam cada comentario pronto para jobs futuros de sentimento, temas, intencao, duvidas e oportunidades de conteudo;
- desde 20/10/2026 toda resposta (pela aula em `createLessonComment` ou pela Comunidade do admin em `replyToComment`) chama `scheduleCommentReplyNotification` (`src/server/communications/comment-notifications.ts`), que roda depois da resposta HTTP (`after()` do Next; fora de um pedido, na hora) e grava no sino a notificacao de resposta para o dono do comentario e a de mencao para o `@usuario` do comeco da resposta. Melhor esforco: falha vira log `[notificacoes]` e nunca derruba a publicacao. O sino so mostra a notificacao enquanto a resposta e o comentario respondido estao aprovados e nao excluidos.

## Agentes de IA

Agentes de IA devem ficar atras de adapters e regras de escopo:

- agente de comentarios: pode sugerir ou publicar respostas conforme configuracao;
- `lesson_tutor` (Tutor IA): representa o professor daquela aula e responde apenas com a transcricao, o perfil e o historico daquele chat de uma aula autorizada;
- `platform_guide` (IA Diretor): representa a orientacao geral da escola, conhece a estrutura autorizada de cursos, modulos, aulas e assuntos, pode recomendar caminhos e localizar conteudo, mas nao e um tutor de aula;
- os dois agentes usam conversas, escopos, prompts e metricas separados. A IA Diretor aparece no shell autenticado do aluno e nunca reutiliza silenciosamente uma conversa do Tutor.

O Tutor IA de aula esta implementado com o seguinte fluxo:

```txt
Cadastro da aula
  -> legenda publica do YouTube ou SRT/VTT/TXT/texto do produtor
  -> normalizacao, checksum e versao ativa em lesson_transcripts
  -> chunks com timestamps em content_chunks
  -> analise da aula em lesson_ai_profiles quando houver provedor

Pergunta do aluno
  -> sessao + ownership da conversa + entitlement da aula
  -> limites de perguntas por aluno e da plataforma
  -> selecao da transcricao/chunks permitidos e cues identificadas por fontes opacas
  -> Bunker AI LB seleciona uma conexao elegivel de Gemini, OpenAI ou Anthropic
  -> adapter REST usa API protegida ou conta especifica no gateway
  -> validacao lexical das fontes citadas, resolucao server-side dos tempos e margem de seek de 3 segundos
  -> resposta, tokens, tentativas, conexao e citacoes verificadas persistidos em ai_messages
```

No cliente, o painel do Tutor e montado somente no primeiro acesso e depois permanece no DOM com `hidden` durante as trocas de aba, mantendo ativos o provider SWR, o chat, o rascunho e o scroll. O SWR funciona como cache privado somente em memoria. As chaves incluem usuario, conteudo, aula e conversa; a lista e cada historico possuem recursos separados, evitando que respostas atrasadas de um chat sobrescrevam outro. A primeira leitura mostra loading, enquanto revalidacoes por foco, reconexao ou mutacao explicita preservam os dados atuais e acontecem sem bloquear a interface. Criar, renomear, excluir e enviar atualizam somente as chaves afetadas e revalidam a lista em segundo plano.

Esse cache de aplicacao nao altera o contrato HTTP: todas as rotas do Tutor continuam dinamicas, autenticadas e com `Cache-Control: private, no-store`, e o fetcher tambem usa `cache: "no-store"`. Nenhum historico e persistido em `localStorage`, IndexedDB, service worker, CDN ou cache compartilhado. Respostas `401` e `403` limpam imediatamente o namespace privado e interrompem novas leituras no componente montado.

`list_tutor_conversations` agrega contagem e ultima mensagem concluida em uma unica RPC restrita a `service_role`, filtrada por aluno, aula, `lesson_tutor` e exclusao logica. Isso remove a antiga consulta adicional a `ai_messages` para cada conversa sem impor limite novo ao historico do Tutor.

A IA Diretor usa o mesmo pool de provedores, mas possui um pipeline de recuperacao independente:

```txt
Pergunta autenticada em conversa platform_guide
  -> ownership + exclusao logica + limites de uso
  -> catalogo server-side com publication_status, regras de liberacao e entitlements ativos
  -> ranking lexical de titulos, descricoes, resumos e topicos autorizados
  -> chunks relevantes somente das aulas candidatas e com transcricao ativa
  -> contexto limitado com referencias opacas [R1], [R2]...
  -> Bunker AI LB e fallback entre conexoes elegiveis
  -> servidor descarta referencias inventadas e resolve somente links internos autorizados
  -> resposta, referencias, tokens, tentativas e conexao persistidos em ai_messages
```

`content_items.publication_status` separa publicacao editorial (`draft`, `published`, `archived`) do campo legado `status`, que representa estado pedagogico/comercial como `Novo` ou `Liberado`. Registros existentes recebem `published` no backfill; novos conteudos nascem como `draft` e o CMS exige a decisao editorial. Autorizacao de aula, leitura do aluno e catalogo da IA usam exclusivamente o campo editorial, alem da publicacao de modulo/aula, regras de liberacao e entitlement. O navegador nunca escolhe os IDs que formam o contexto da IA Diretor.

`ai_provider_configs` define modelo, limites, prioridade e habilitacao por provedor. Cada provedor pode ter varias entradas em `ai_provider_connections`: chaves BYOK protegidas no Supabase Vault ou contas ligadas ao Bunker AI Gateway. Segredos sao lidos somente pelo servidor; APIs administrativas retornam apenas identificadores e dicas mascaradas. Conexoes pausadas, em cooldown ou que exigem nova autenticacao nao entram no pool normal.

A politica de modelo e compartilhada pelas conexoes do mesmo provedor. O CRM consulta `/v1/models` do gateway, filtra modelos de texto pelo provedor e os oferece como sugestoes; a conexao fica salva, mas o teste permanece desabilitado ate o produtor salvar uma politica compativel em `Modelos e limites`. Modelos de API ainda podem ser digitados manualmente quando nao aparecem no gateway.

Dentro de cada politica de provedor, o pool ordena conexoes por prioridade, saude e menor `last_used_at`, produzindo round-robin entre conexoes equivalentes. Cada falha fica registrada em `provider_attempts`, atualiza saude e pode causar cooldown/backoff; o servidor tenta a proxima conexao elegivel e grava em `connection_id` qual delas concluiu a resposta. Erros 401/403 exigem atencao, 429 aciona cooldown de cota e falhas transitorias usam backoff crescente. Uma conexao degradada volta por provas sucessivas antes de ser considerada saudavel.

Logins por conta sao intermediados por um servico isolado e persistente em `services/bunker-ai-gateway`, configurado por `BUNKER_AI_GATEWAY_URL`, `BUNKER_AI_GATEWAY_API_KEY` e `BUNKER_AI_GATEWAY_MANAGEMENT_KEY`. O app inicia OAuth, valida sessao/ator/state e registra a conta encontrada; o gateway renova credenciais e traduz protocolos, enquanto a Bunker707 continua escolhendo a conexao exata. O uso de conta de consumidor e experimental e operacionalmente distinto de uma API oficial: deve ser validado contra os termos e limites do provedor antes de producao.

No desenvolvimento local, `services/bunker-ai-gateway/compose.yml` publica o servico somente em `127.0.0.1:8317`, persiste `/data/auth` no volume nomeado `bunker707-ai-gateway-auth` e recebe segredos por `.env.bunker-ai-gateway.local`. O Next.js recebe as variaveis correspondentes por `.env.local`. Os comandos `ai-gateway:up`, `ai-gateway:status`, `ai-gateway:smoke`, `ai-gateway:logs` e `ai-gateway:down` padronizam a operacao; detalhes e fluxo de login estao em `services/bunker-ai-gateway/README.md`.

Conversas ficam separadas por `user_id`, `agent_type`, aula quando aplicavel e `conversation_id`, nao expiram automaticamente e nao compartilham historico entre chats. `PATCH /api/tutor/conversations/[conversationId]` normaliza e atualiza o titulo somente depois de validar sessao e ownership. `DELETE` no mesmo endpoint grava `student_deleted_at`: listagem, leitura e novas perguntas sempre filtram esse campo, portanto um chat excluido pelo aluno permanece somente no backend para analise e deixa de integrar sua experiencia e o contexto do tutor.

Cada mensagem recebe no banco um `message_sequence` estritamente crescente dentro da conversa. A sequencia e atribuida por trigger com bloqueio transacional por `conversation_id`, e todas as telas, previas e historicos enviados aos modelos usam esse campo. Assim, pergunta e resposta permanecem na ordem correta mesmo quando compartilham o mesmo `created_at` por terem sido criadas na mesma transacao.

O consumo administrativo e calculado a partir de respostas persistidas, nunca por estimativa do frontend. O produtor pode filtrar o periodo e acompanhar totais, falhas, tokens de entrada/saida, tipo de agente, tutor/aula, provedor/modelo, conexao, dia e aluno. A lista por aluno funciona tambem como ranking de quem mais utilizou IA no periodo. `lesson_tutor` e `platform_guide` permanecem separaveis no agregado para que a IA Diretor nao distorca o custo de cada tutor.

Para aulas curtas o tutor pode usar toda a transcricao dentro do limite configurado. Em aulas longas, uma selecao lexical escolhe chunks relevantes e vizinhos. O modelo recebe cada cue com um identificador como `[F152]`, sem acesso ao horario, e deve citar a primeira fonte que sustenta diretamente a afirmacao. O servidor rejeita marcadores incompatíveis com o texto proximo, converte somente fontes verificadas no timestamp real e subtrai 3 segundos do inicio para dar contexto ao aluno. O frontend nao transforma tempos livres ou citacoes legadas sem `verified` em links. O prompt proibe conhecimento externo: quando um assunto nao aparece no material, o tutor deve informar essa ausencia.

## Video

Nao hospedar videos no VPS nem na Vercel.

Usar:

- Mux;
- Bunny Stream;
- Cloudflare Stream, se fizer sentido.

Requisitos:

- playback seguro;
- urls/tokens temporarios;
- controle por aula;
- suporte a thumbnails;
- metadados de duracao;
- possibilidade futura de transcricao.

Tracking de progresso:

- o frontend deve registrar inicio, segundos assistidos, percentual atual, maior percentual ja alcancado, abandono/pausa e conclusao por aula;
- players HTML5/proprios usam eventos nativos (`play`, `timeupdate`, `pause`, `ended`) para segundos reais;
- YouTube usa a IFrame API como adapter inicial, lendo `currentTime`, `duration`, estados de play/pause/end e retomando com `seekTo` sem autoplay; enquanto o aluno nao aciona play, a UI cobre o iframe com a thumbnail oficial do YouTube e a barra de progresso salva, porque o frame pausado do embed pode aparecer preto antes da reproducao;
- o adapter gratuito do YouTube usa o dominio `youtube-nocookie.com`, desliga controles, teclado e fullscreen nativos, remove o iframe da ordem de foco e dos pointer events e fornece controles Bunker707 para play/pausa, timeline, volume e fullscreen do container. Mascaras nas bordas e uma tela final propria evitam expor o chrome clicavel do provedor na UI; como esse chrome e controlado externamente, mudancas no embed podem exigir manutencao;
- no seletor de qualidade, `Automático` e o modo inicial, continua no embed e delega a adaptacao ao YouTube. O provedor escolhe dinamicamente a maior qualidade sustentavel para conexao, buffer, tamanho de exibicao e dispositivo, podendo chegar a 4K quando a origem e as condicoes permitirem e reduzir a resolucao quando necessario. Como o embed decide a qualidade pelo tamanho do proprio viewport em pixels CSS (o `devicePixelRatio` nao entra: com 540 px de altura em DPR 2 ele ficou em 720p), um palco de ~500 px de altura ficava em 720p; desde 2026-10-14 o iframe e renderizado com altura interna minima de 1080 px CSS (`src/lib/youtube-embed-sizing.ts`: altura `max(altura do palco, 1080)`, largura 3x a do palco como antes) e reduzido com `transform: scale()` ate caber no palco, recalculado por `ResizeObserver` (janela, tela cheia). O documento de dentro do iframe nao enxerga a transformacao e escolhe a qualidade para o tamanho grande: no mesmo palco o `Automático` passou a reportar 1080p (verificado no navegador). Com `navigator.connection.saveData` o iframe fica no tamanho do palco. O adapter acompanha `onPlaybackQualityChange` para atualizar o selo da engrenagem conforme a qualidade efetiva reportada; `getPlaybackQuality`, `setPlaybackQuality`, `getAvailableQualityLevels`, `suggestedQuality` e o parametro `vq` nao devem ser usados porque deixaram de ser suportados ou sao ignorados oficialmente. Os valores exatos sao convertidos no selo: `hd720` vira `HD`, `hd1080` vira `FHD`, `hd1440` e `hd2160` viram `2K` e `4K`; o valor publico generico `highres` deve aparecer como `HD+`, sem inferir uma resolucao exata. As opcoes manuais vem de `GET /api/video/youtube/streams`, rota sem cache que exige sessao e acesso a aula, correspondem apenas aos formatos reais encontrados para o video e compativeis com o navegador, incluindo `2160p` (`3840x2160`) quando a origem disponibilizar esse formato, e aparecem antes de `Automático` em uma caixa sem scroll interno;
- a resposta dessa rota contem um fluxo de audio, os fluxos de video por qualidade e o prazo de expiracao. O servidor resolve essas URLs temporarias, mas nao retransmite nem faz proxy dos bytes: no modo manual, elementos HTML de audio e video consomem os fluxos diretamente. A troca prepara as duas faixas com preload, mantem a thumbnail sobre o player ate o primeiro frame estar disponivel, so retoma quando ambas possuem dados suficientes e usa uma tolerancia conservadora nas correcoes periodicas de sincronizacao para evitar cortes audiveis. (2026-10-14) Verificado que o `googlevideo` responde `403` a requisicoes sem `Range` ou com `Range` aberto (`bytes=0-`), exatamente o que `<video src>` e `<audio src>` dos navegadores enviam; ele so aceita faixas limitadas (ate ~10 MiB, por cabecalho ou pelo parametro `range=`) e nao devolve `Access-Control-Allow-Origin` para origens fora de `youtube.com`, o que tambem impede MSE no navegador sem proxy. Isso vale para todas as qualidades e para os clients `ANDROID_VR`, `IOS` e `ANDROID`: o modo manual deixou de reproduzir, e o `Automático` com o iframe ampliado e o caminho para Full HD ate a migracao para Bunny (fase 4 de `docs/17-admin-produtor-redesign.md`). Recomendado `YOUTUBE_UNOFFICIAL_STREAMS=off` em producao para o menu nao listar resolucoes que falham;
- a extracao dos fluxos manuais nao usa uma API oficial de playback do YouTube. URLs podem expirar ou deixar de funcionar por mudancas do provedor, codec/navegador, CORS ou restricoes da entrega; `Automático` deve permanecer como fallback operacional, e o modo manual nao deve ser descrito como streaming protegido;
- essa extracao fica atras da flag de servidor `YOUTUBE_UNOFFICIAL_STREAMS` (`src/server/video/feature-flags.ts`), criada na fase 0 de `docs/17-admin-produtor-redesign.md`: vazia ou `on` (padrao nesta fase) preserva o comportamento atual; `off`, ou qualquer valor diferente de `on`, faz `GET /api/video/youtube/streams` e `GET /api/tv/receiver/{sessionId}/streams` responderem `404` com `{ "error": "youtube_unofficial_streams_disabled" }` antes de sessao, banco ou YouTube, e `fetchYouTubeStreams` falha com o mesmo codigo sem nenhuma requisicao externa. O aluno fica apenas com `Automático` no embed oficial, inclusive no Modo TV; legendas (`youtube-captions.ts` e rotas `captions`) continuam ativas porque alimentam a transcricao do Tutor IA. A flag sera desligada na fase 4 e o codigo removido um ciclo depois;
- esse adapter nao protege a URL nem substitui streaming com token/DRM: o ID do YouTube permanece tecnicamente descobrivel no DOM e na rede, mesmo que nenhum link direto apareca para o aluno;
- na pagina de aula, uma barreira de atrito em captura bloqueia o evento global de menu de contexto e atalhos comuns de DevTools/codigo-fonte somente enquanto a experiencia estiver montada. A carga do aluno serializa apenas o ID canonico do YouTube, sem repetir a URL original de visualizacao, e as rotas de streams/legendas derivam esse ID no servidor a partir de `contentId` e `lessonId` depois de validar acesso. Essas medidas reduzem exposicao casual, mas nao alteram o seletor de qualidade e nao impedem inspecao iniciada pelo navegador;
- antes de navegar da aula para home, curso ou modulos, a UI deve forcar um ultimo flush de progresso do player para evitar que carrosseis e barras carreguem dados antigos vindos de prefetch/cache de rota;
- o Modo TV inicial usa uma sessao Bunker707 persistida em `tv_sessions`, sem fingir Google Cast: o aluno autenticado cria a sessao somente depois de `requireLessonAccess`, a TV abre a rota publica `/tv`, consome uma vez o codigo temporario e passa a autenticar cada polling/heartbeat com um token aleatorio cujo banco guarda apenas o SHA-256;
- comandos de play, pause, seek relativo, mudanca dedicada de velocidade e sincronizacao integral do player sao persistidos com revisao monotona. A sincronizacao integral carrega posicao absoluta, estado de reproducao, volume, mudo, velocidade, legenda e qualidade ao parear ou reabrir o modal. O receptor consulta comandos em polling curto, aplica cada revisao uma unica vez e envia heartbeat com estado, tempo, duracao, revisao aplicada, velocidade efetiva e taxas disponiveis; `tv_sessions.playback_rate` e `available_playback_rates` alimentam o seletor remoto somente depois da confirmacao real do player. O servidor atualiza `lesson_progress` para o usuario dono da sessao, enquanto o modal consulta estado e presenca da TV separadamente;
- o receptor descarrega o modulo nativo de legendas do YouTube e busca cues pela rota protegida com bearer token, renderizando a legenda Bunker707 fora do iframe. Desde 2026-10-14 essa rota e a do player principal (`GET /api/video/youtube/captions`) resolvem a legenda por `resolveLessonCaptions` (`src/server/video/lesson-captions.ts`): primeiro a transcricao ativa da aula em `lesson_transcripts` (enviada, colada ou importada pelo produtor no admin; `cues` normalizadas, `status = error` ignorado), e so na falta dela a legenda ao vivo do YouTube. A resposta traz `source` (`platform`, `youtube` ou `none`). Motivo: em producao o servidor sai de IP de datacenter e o YouTube nega a pagina do video e a faixa de legenda, deixando o botao de legenda travado; a copia guardada nao depende disso. Falha ao ler a copia nao derruba a legenda (cai para o YouTube e registra aviso). O seletor temporal compartilhado escolhe a cue mais recente ja iniciada quando o JSON3 possui duracoes sobrepostas, em vez de manter uma frase anterior ainda ativa. A legenda usa um relogio curto separado do heartbeat; no player manual esse relogio le `audio.currentTime`, com fallback para o video, porque a fala audivel vem da faixa de audio. Qualidade `Automático` usa o embed; uma selecao manual usa uma rota de streams exclusiva do receptor e o mesmo player de video/audio separados da aula. Essas rotas revalidam token, sessao e `requireLessonAccess` antes de devolver dados;
- erros publicos do player e do Modo TV devem ser sanitizados na fronteira de UI/API e permanecer agnosticos ao provedor; nomes como YouTube, Vimeo, Bunny ou Mux podem existir apenas em implementacao, logs internos e CMS, nunca na experiencia do aluno;
- a tela cheia do receptor usa a Fullscreen API sobre o container Bunker707 do video e fica no canto inferior direito da barra de controles, com o mesmo icone do player da aula e sem botao textual flutuante. A barra e seu degrade entram durante interacao local e perdem opacidade automaticamente apos um curto periodo sem mouse, toque ou tecla, sem depender de hover persistente. Ela precisa ser ativada por gesto direto na pagina `/tv`; um comando remoto nao pode inicia-la porque navegadores bloqueiam fullscreen sem interacao local;
- o QR do Modo TV aponta somente para `/tv?code=...`, nunca para o YouTube. A resposta pareada entrega apenas o ID canonico necessario ao embed `youtube-nocookie.com`; isso preserva a mesma limitacao do player principal: o ID ainda e tecnicamente observavel na TV e o recurso nao equivale a DRM;
- a primeira entrega cobre YouTube. Chromecast/AirPlay nativos e adapters receptores para Vimeo, Bunny, Mux ou URL propria permanecem evolucoes separadas por provider;
- Vimeo, Bunny, Mux e embeds externos devem ficar atras de adapters de player equivalentes, expondo uma interface comum de play, pause, currentTime, duration, seek e estado de conclusao;
- enquanto um adapter especifico ainda nao estiver completo, o app pode registrar inicio por clique no player e um temporizador de sessao para alimentar `Continue assistindo`, deixando claro que esse fallback nao substitui a precisao de provedores com API integrada.

## Eventos do aluno

Registrar eventos desde o MVP.

Eventos iniciais:

- user_signed_in;
- home_viewed;
- course_opened;
- saved_item_toggled;
- lesson_started;
- lesson_progress_updated;
- lesson_retention_point_recorded;
- lesson_completed;
- lesson_comment_created;
- lesson_comment_reply_created;
- lesson_comment_reacted;
- lesson_comment_reaction_removed;
- lesson_comment_reported;
- material_downloaded;
- search_performed;
- support_requested.

Esses eventos alimentarao dashboards, automacoes e IA no futuro.

Comunicacao v1 (20/10/2026) grava, pelas rotas do sino e do pop-up, `notification_read`, `notification_clicked`, `notification_responded`, `message_impressed`, `message_clicked`, `message_closed`, `message_dismissed` e `message_snoozed`, so com ids no metadata (`docs/05`, secao Eventos). A v2 (21/10/2026) soma `notification_audio_started` e `notification_audio_completed` (rota do audio, uma vez cada); visitas de pagina nao viram evento: vao para `member_page_visits`, so enquanto um fluxo precisa (secao Comunicacao).

No MVP, a avaliacao da aula em formato de reacao (`Nao gostei`, `Gostei`, `Amei`) e persistida junto do progresso autenticado da aula em `lesson_progress.lesson_reactions`, para sobreviver a refresh e futuras telas de CRM. A elegibilidade da avaliacao usa o maior percentual ja alcancado na aula, nao apenas a posicao atual do player.

## Favoritos e minha lista

A acao de salvar/favoritar usa a rota server-side `/api/saved-items`, exige sessao autenticada e grava a relacao pessoal do aluno em `saved_items`.

Regras:

- salvar um item nao concede acesso;
- itens salvos continuam respeitando entitlements e regras de liberacao;
- a tabela `saved_items` usa RLS para que cada aluno leia e altere somente os proprios favoritos.
- a sidebar expõe a rota `/favoritos`, que lista conteudos, modulos e aulas salvos pelo aluno autenticado.

## Performance de navegacao

As regras atuais para evitar regressao sao:

- nao encadear `router.push` e `router.refresh` para a mesma navegacao;
- nao colocar Base64 de imagem em payload de Server Component ou HTML;
- compartilhar a mesma leitura memoizada entre app shell e pagina dentro do request;
- salvar progresso e favorito por chave, sem regravar outras entidades;
- manter caches de build e dependencias em filesystem APFS quando o repositorio estiver em volume ExFAT.

## Jobs

Dois mecanismos, com papeis diferentes (ver `docs/17-admin-produtor-redesign.md`, secao 2.3):

- **Tick de minuto** (implementado na fase 0): `pg_cron` + `pg_net` no Supabase chamam `POST /api/jobs/tick` a cada minuto. Serve para trabalho leve e frequente: lembretes, envios agendados, liberacoes vencidas, rollups horarios pequenos.
- **Fila de jobs** (Inngest ou Trigger.dev, a partir da fase 1): importacoes, transcricoes, exportacoes, calculo de audiencias e envios em massa, com retomada e retentativas. Nada disso roda dentro do tick.

Excecao decidida em 20/10/2026 (Comunicacao v1; `docs/09`, secao Notificacoes e pop-ups): a notificacao do sino agendada e o segmento dos pop-ups no ar rodam no tick, no job `comunicacao`. A fila de jobs ainda nao esta instalada e o trabalho cabe nas regras do tick: cada notificacao e uma linha pequena (dois ids e uma chave unica por aluno), gravada em lotes de 500, com teto de 20.000 linhas e 3 avisos por rodada, retomavel sem duplicar (o tick cortado continua no seguinte), e o recalculo de quem ve cada pop-up le os dados dos alunos uma vez por rodada (ate 5 pop-ups, cada um a cada 15 minutos). Envio em massa de e-mail, push e WhatsApp continua fora do tick.

A mesma excecao vale para o motor dos fluxos e das notificacoes seguintes (Comunicacao v2, 21/10/2026; `docs/23` §4 e V20): fase 2 do job `comunicacao`, depois do trabalho da v1, com orcamento proprio de 25 s, lotes de 150 tarefas, ate 20 lotes por tick, entrada em lotes de 500 ate 5.000 por tick, tudo idempotente (chave por passo e aluno) e retomavel. Parado, custa 3 leituras indexadas por minuto e nao le os alunos. Os numeros vao para `job_runs.metadata` da execucao do job (`{ tick_run_id, flows }`); o tipo `Job` e o registro nao mudam. Fila nova so se a escala pedir (o relatorio mostra a fila atrasada).

Fluxo do tick:

```txt
pg_cron 'bunker707-jobs-tick' (* * * * *)
  -> select public.enqueue_jobs_tick()            -- security definer, search_path fixo
       le 'jobs_tick_url' e 'jobs_tick_token' de vault.decrypted_secrets
       sem os dois segredos: retorna null e nao faz nada
  -> net.http_post(url, Authorization: Bearer <token>, body {source, scheduled_at}, timeout 55 s)
  -> POST /api/jobs/tick (runtime nodejs, maxDuration 60)
       1. JOBS_TICK_TOKEN ausente ou com menos de 32 caracteres -> 503
       2. Bearer diferente -> 401 (comparacao em tempo constante: SHA-256 + crypto.timingSafeEqual)
       3. corpo opcional, lido com readBoundedJson (ate 4 KB) so quando enviado como JSON
       4. marca como failed execucoes em running ha mais de 15 min
       5. job_runs(job='tick', running) -> percorre jobRegistry -> succeeded/failed
       6. responde { ok, ran: [...] } (+ failed/skipped quando houver; 500 se algum job falhar)
```

Codigo:

- `src/app/api/jobs/tick/route.ts`: autenticacao, leitura do corpo e resposta;
- `src/server/jobs/tick-auth.ts`: validacao do token, modulo puro coberto por `tests/jobs-tick.test.mjs`;
- `src/server/jobs/registry.ts`: ponto de extensao. `Job = { name, run(ctx) }`; `ctx` traz o cliente administrativo do Supabase, um `AbortSignal` com o prazo do tick, o instante do tick e os ids de `job_runs`. Registrados hoje, nesta ordem: `email-outbox` (`src/server/jobs/email-outbox-job.ts`, fila de e-mails transacionais; secao E-mail transacional) `comunicacao` (`src/server/jobs/communications-job.ts`, notificacoes do sino agendadas, quem ve cada pop-up e, na fase 2, o motor dos fluxos; secao Comunicacao) e, por ultimo, `comunicacao-limpeza-de-arquivos` (`src/server/jobs/communication-media-job.ts`: uma rodada por dia, a partir das 06:53 UTC, tira do Storage os arquivos da Comunicacao sem uso ha 30 dias, ate 500 por rodada; `docs/22` §4.6);
- `src/server/jobs/run-tick.ts`: executa os jobs em sequencia com orcamento de 45 s; um job que lanca erro ou estoura o prazo vira `failed` sem derrubar os demais; jobs que nao couberem no prazo ficam para o proximo tick (`skipped`);
- `src/server/jobs/job-runs.ts`: gravacao de `public.job_runs`.

Regras para um job novo no registro:

- `name` unico em kebab-case (`tick` e reservado);
- idempotente: o mesmo minuto pode chegar duas vezes e um minuto pode ser perdido; o job busca o que esta vencido em vez de assumir que roda exatamente uma vez por minuto;
- curto e em lotes pequenos, respeitando `ctx.signal`;
- recomputos pesados (por exemplo `student_facts`) rodam a noite em agendamento proprio, nunca por minuto no banco primario;
- dead-letter apos 3 falhas e retentativas com `attempts` ficam com o job que precisar delas (a coluna ja existe em `job_runs`).

Retencao: `public.prune_job_history()` roda diariamente as 06:17 UTC (`bunker707-jobs-history-prune`) e apaga `job_runs` com sucesso apos 30 dias, com falha apos 90 dias, e `cron.job_run_details` apos 7 dias. Na mesma linha, `public.prune_personal_data()` roda as 06:23 UTC (`bunker707-personal-data-prune`, migracao `202610170004`) e anonimiza `webhook_events` (12 meses) e `email_outbox` (90/180 dias) e apaga `email_webhook_events` (90 dias): regras em `docs/06`, secao LGPD. Depois, as 06:41 UTC, `public.prune_communication_history()` (`bunker707-communication-prune`, migracao `202610200001`, refeita pela `202610200002`) apaga notificacoes e estados de pop-up com mais de 24 meses (menos os de pop-up ainda no ar ou pausado) e, desde 21/10/2026, tarefas terminadas, passagens de fluxos encerrados ou excluidos e visitas de pagina com mais de 24 meses.

Configuracao por ambiente (passos completos no topo de `supabase/migrations/202610100001_jobs_cron.sql`):

1. gerar o token com `openssl rand -hex 32`;
2. definir `JOBS_TICK_TOKEN` nas variaveis de ambiente do servidor;
3. criar no Vault os segredos `jobs_tick_url` (URL completa da rota) e `jobs_tick_token` (mesmo valor do passo 2) com `select vault.create_secret(...)`.

Sem esses passos o agendamento existe mas nao chama nada, o que e o estado esperado em desenvolvimento local e em branches de preview. Para pausar: `select cron.unschedule('bunker707-jobs-tick');`. Diagnostico: `cron.job_run_details` (execucao do agendamento), `net._http_response` (status HTTP da chamada) e `public.job_runs` (resultado na aplicacao). Vercel Cron fica apenas como redundancia diaria, se necessario.

## E-mail transacional

Decisao em `docs/19-infra-hetzner-e-email.md` (secao 2): Resend agora (plano Free: 3.000 e-mails/mes, 100 por dia, 1 endpoint de webhook), Amazon SES na segunda rodada, atras do mesmo adaptador. Os e-mails do Supabase Auth (convite, recuperacao de senha) continuam saindo pelo SMTP configurado no painel do Supabase, nao por este modulo.

Regras:

- quem dispara nunca envia na hora: enfileira uma linha em `email_outbox` e segue; o envio acontece no job `email-outbox` do tick de minuto. Falha ao enfileirar vira log, porque o acesso ja foi dado e e o que importa;
- o provedor fica atras de `EmailProvider` (`src/server/email/types.ts`): `send(mensagem) -> { ok, providerMessageId } | { ok: false, outcome: retry | throttle | fail }`. Hoje existe `providers/resend.ts` (HTTP direto em `https://api.resend.com/emails`, `Authorization: Bearer RESEND_API_KEY`, cabecalho `Idempotency-Key`); o SES entra como outra implementacao sem mudar quem dispara;
- `EMAIL_PROVIDER=resend|none` escolhe o provedor (`src/server/email/config.ts`). Vazio, `none`, sem `RESEND_API_KEY` ou com remetente invalido: nenhum envio, a fila espera com um aviso no log e cada linha expira em 7 dias. E o estado de desenvolvimento local, previews e testes;
- limite diario `EMAIL_DAILY_LIMIT` (padrao 90, por dia do calendario UTC, contado em `email_outbox.sent_at`) abaixo dos 100/dia do Free. Os e-mails do Auth pelo SMTP consomem a mesma cota do Resend, mas nao entram nesta conta: ao abrir vagas para muitos alunos num dia, ou o plano vai para Pro ou a fila drena em varios dias;
- idempotencia em duas camadas: a chave `idempotency_key` e unica na fila (`welcome:<user_id>` e `purchase:<provedor>:<evento>:<user_id>`; sem id de evento, os ids dos acessos abertos) e vai ao Resend, que nao envia duas vezes a mesma chave em 24 h. Um webhook de venda reprocessado nao duplica e-mail;
- retentativa: erro passageiro (rede, 5xx, chave ainda em uso) volta para a fila com espera crescente (1 min, 5 min, 30 min, 2 h, 12 h) e vira `failed` na quinta falha; limite do provedor (429, cota do dia) devolve a linha sem contar tentativa e para o lote ate a proxima janela; erro definitivo (remetente invalido, dominio nao verificado, chave recusada) vira `failed` na hora com o motivo em `last_error`;
- cada linha e reservada (`sending`) antes do envio: dois ticks no mesmo minuto nao enviam a mesma linha; linha presa em `sending` ha mais de 10 minutos volta para a fila; no maximo 25 envios por tick, com pausa de 550 ms entre eles (o Resend aceita 2 pedidos por segundo), respeitando `ctx.signal`.
- o job le so as colunas que a migracao `202610170002` criou (`EMAIL_OUTBOX_COLUMNS`): o deploy pode sair antes de uma migracao posterior, e uma coluna nova na lista pararia a fila inteira. A retencao (`202610170004`) so deixa `to_email` e `html` nulos em linha que ja saiu da fila; se uma dessas for reservada, vira `failed` com o motivo em vez de sair vazia;

Pontos de disparo (`src/server/students/access.ts`, a mesma rotina do admin e dos webhooks de venda):

- **boas-vindas** (`welcome`): na primeira vez que a conta nasce. Numa venda por webhook, sempre; pelo admin (Adicionar aluno, importacao), so quando a equipe escolheu convite ou senha temporaria, porque "Nao enviar agora" significa isso. O texto diz com qual e-mail entrar e como criar a senha conforme a entrega: convite (chega outro e-mail com o link), senha temporaria (a equipe passa) ou nada (usar "Esqueci minha senha" na tela de entrar);
- **acesso liberado por compra** (`purchase`): quando `grantProductAccess` vem de `source = "webhook"` e abre um acesso que estava fechado (novo, revogado, suspenso ou expirado). Um e-mail por compra, com os produtos abertos e o link de cada um (`/conteudo/<id>`). Prazo a mais num acesso ja aberto e acoes da equipe (liberar, em massa, importacao) nao avisam o aluno; envio em massa a partir da lista de alunos fica para o modulo Comunicacao (a v1 de 20/10/2026 manda so para o sino e o pop-up; e-mail e um canal da proxima etapa, `docs/22` §6);
- **enviada em seu nome** (`sent_as`, desde 21/10/2026, `docs/23` §1.6): para a pessoa da equipe escolhida em "Quem envia" quando uma notificacao sai (agora, agendada ou aprovada) ou um fluxo e ativado, aprovado ou ganha um remetente novo. Disparado por `src/server/communications/sender-notices.ts` (`notifySendersOnBehalf`) depois da resposta (`after()`), nunca para quem publicou nem para quem saiu da equipe; template `templates/sent-as.ts`; chaves `sent-as:campaign:<aviso>:<pessoa>` e `sent-as:flow:<fluxo>:<pessoa>`. E para a equipe, nao para alunos: nao e envio em massa.

Links nos e-mails usam `NEXT_PUBLIC_SITE_URL`; sem ela, a origem do request que disparou (`redirectTo` do admin ou `siteOrigin` informado pelo webhook); por ultimo, `http://localhost:3000`.

Fluxo:

```txt
venda por webhook / Adicionar aluno / importacao
  -> src/server/students/access.ts
  -> src/server/email/transactional.ts   (template em portugues + chave de idempotencia)
  -> email_outbox (queued)
pg_cron tick (* * * * *) -> POST /api/jobs/tick -> job email-outbox
  -> src/server/email/outbox.ts: expira > 7 dias, recupera `sending` orfas, conta o dia (UTC),
     busca ate 25 linhas vencidas, reserva cada uma, provider.send(...) com Idempotency-Key
  -> sent (provider_message_id) | queued com next_attempt_at | failed
Resend -> POST /api/webhooks/resend (assinatura Svix com RESEND_WEBHOOK_SECRET)
  -> email_webhook_events (payload bruto, unico por svix-id)
  -> email_outbox: delivered_at | bounced | complained | failed
pg_cron 'bunker707-personal-data-prune' (06:23 UTC) -> public.prune_personal_data()
  -> email_outbox: 90 dias (enviado) / 180 dias (falha, bounce, fila) sem destinatario, HTML, texto e erro
  -> email_webhook_events: apagados depois de 90 dias
```

Codigo:

- `src/server/email/types.ts`, `config.ts`, `providers/resend.ts`, `outbox-rules.ts`, `webhook-signature.ts`, `webhook-events.ts`, `templates/*`: modulos puros, cobertos por `tests/email-*.test.mjs`;
- `src/server/email/outbox.ts` (fila no banco), `provider.ts` (escolha pelo ambiente), `transactional.ts` (os dois e-mails do aluno; o `sent_as` da equipe sai por `src/server/communications/sender-notices.ts`), `src/server/jobs/email-outbox-job.ts` e `src/app/api/webhooks/resend/route.ts`: cobertos por `tests/integration/email-transacional.test.mjs` com o banco local e o provedor falso de `tests/support/integration-email-provider.mjs`. Nenhum teste envia e-mail de verdade.

Variaveis: `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_DAILY_LIMIT` e `NEXT_PUBLIC_SITE_URL` (`.env.example`; tabela em `docs/06-seguranca-operacao.md`, secao E-mail transacional).

## Comunicacao (sino e pop-ups)

### Implementado (20/10/2026): Comunicacao v1

Produto, regras e decisoes em `docs/22`; tabelas em `docs/05` (secao Comunicacao); seguranca em `docs/06` (secao Comunicacao); admin em `docs/17` §1.8. Migracao `202610200001_communication_v1.sql`. Nenhuma variavel de ambiente nova.

Modulo `src/server/communications/`:

- modulos puros (sem `server-only`, carregados direto pelo Node nos testes unitarios e importados pelo editor do admin): `audience-model.ts` (regras do segmento, grupos E/OU com um nivel, `evaluateAudience`, `normalizeAudience`, `describeAudience` com a frase "Alunos que ...", conversao dos segmentos salvos de Alunos), `schemas.ts` (zod do rascunho, do segmento e das acoes, com as mensagens em portugues; `publishProblems` para o que so vale ao publicar), `campaign-model.ts` (tipos, limites fixos, situacao, acoes por situacao e permissao, `publishDecision` acima de 500, agenda no fuso de Sao Paulo, frase de revisao, `pickPopup` e `popupEventPatch`) e `notification-model.ts` (contratos da API do sino, titulo das notificacoes de comentario, mencao, trecho, cursor e forma de onda);
- `db.ts` (cliente de servico, `CommunicationError` com status HTTP, `NoticeFieldError` para erro de campo no formato do zod, deteccao da migracao pendente), `store.ts` (colunas explicitas, gravacao condicional por `updated_at` e situacao com 409, reserva das notificacoes vencidas, gravacao em lotes de 500, estados do pop-up, RPCs dos numeros), `audience-facts.ts` (os dados de cada aluno com as mesmas leituras de `src/server/students/store.ts` e a mesma conta de `buildStudentIndex`, sem a equipe, mais os comentarios por janela), `audience.ts` (quem esta no segmento e a amostra de 5 nomes);
- `dispatch.ts` (`dispatchInboxCampaign`, `refreshPopupDeliveries`, `processCommunications`), `actions.ts` (Server Actions do admin, todas por `runAdminAction` e com `admin_audit_log`), `queries.ts` (lista, detalhe, os quatro numeros e as opcoes do editor), `cache.ts` (tag `communications` da lista de pop-ups no ar), `media.ts` (audio), `inbox.ts` e `popups.ts` (lado do aluno), `comment-notifications.ts` (resposta e mencao) e `route-support.ts` (resposta sem cache e eventos do aluno);
- `src/server/jobs/communications-job.ts`: job `comunicacao`, registrado depois do `email-outbox` (secao Jobs).
- Limpeza dos arquivos sem uso (23/10/2026, migracao `202610240001`, `docs/22` §4.6): `media-refs.ts` (os lugares da Comunicacao no Storage e uma funcao por tipo de conteudo que devolve os arquivos que ele usa, a mesma do salvar), `media-cleanup-model.ts` (24 h, 30 dias, o dia da rodada, o plano e a reserva: `orphanMarkUploadStep`), `media-cleanup.ts` (a rodada, que reserva, remove e so entao tira a marca; `forgetOrphanMark`, chamado ANTES de cada envio com nome pelo conteudo, inclusive pelo `beforeUpload` do `persistImageAsset`; e `loadTemplateMediaUse`, que le os modelos pelo jsonb cru desde 25/10/2026) e `src/server/jobs/communication-media-job.ts` (job `comunicacao-limpeza-de-arquivos`, o ultimo do registro).
- Modelos (25/10/2026, migracao `202610250001`, `docs/28`): `template-model.ts` (puro, sem `@/` nem `server-only`: tipos do payload versao 1, limites, textos, schemas afrouxados do rascunho e estritos do payload, construtores, leitura parte por parte com `TEMPLATE_UPGRADES`, `noticeStartOfTemplate`, `applyDesignTemplatePatch`, resumo, nomes e mapa de erros), `template-store.ts` (a tabela, com a guarda de versao de `updateCampaign`), `template-queries.ts` (lista, detalhe, `prepareNoticeStart` com ids novos, `prepareTemplateEditor` com os ids gravados, recentes do "Novo aviso"), `template-actions.ts` (`"use server"`, tudo por `runAdminAction("messaging.write")`, nenhuma chama `revalidatePath`), `design-checks.ts` (as conferencias de arquivo do design, tiradas de `actions.ts`, com a lista de designs conhecidos e sem apagar; `videoPathInUse` e `mayRemoveRefusedVideo` do fim do envio) e `team-checks.ts` (quem envia na equipe). Telas em `src/components/admin/v2/communication/templates/` (aba, dialogos, miniaturas, "Novo aviso"), `template-editor-model.ts`, `template-kind-choice.tsx`, `design-template-editor.tsx` e `popup-free/free-templates-panel.tsx`; rotas `src/app/admin/(v2)/comunicacao/modelos/`.

Rotas:

- aluno (todas com `requireApiUser` e `Cache-Control: private, no-store`; as que recebem corpo usam `readBoundedJson` de 8 KB): `GET /api/notifications` (`?filter=all|unread`, `?cursor=`), `GET /api/notifications/summary` (`?popup=1` so na home), `POST /api/notifications/read` (`{ seen: true }`, `{ ids }` ou `{ all: true }`), `POST /api/notifications/[id]/click` (sem corpo, aceita `sendBeacon`), `POST /api/notifications/[id]/response` e `POST /api/popups/[id]/events` (aceita `text/plain`, como o `sendBeacon` manda);
- admin: `POST /api/admin/communications/audio` (`requireApiRole("messaging.write")`, multipart, `maxDuration` 60). O resto do admin sao Server Actions: `saveNoticeDraft`, `previewNoticeAudience`, `publishNotice`, `approveNotice`, `rejectNotice`, `cancelScheduledNotice`, `pauseNotice`, `resumeNotice`, `endNotice`, `withdrawNotice`, `duplicateNotice`, `deleteNotice`, `sendNoticeTestToMe` e `uploadNoticeImage`;
- telas: `/admin/comunicacao/avisos` (lista), `/avisos/novo` e `/avisos/[id]` (editor ou relatorio), atras de `requirePageArea("comunicacao")` (`messaging.write`). Lado do aluno: `MemberNotificationsMenu` no topo do `AppShell` e `MemberPopupHost` montado uma vez, ligado so em `/` e fora do modo "ver como" (`src/components/member/notifications/`).

```txt
Equipe (messaging.write) -> Server Action -> runAdminAction -> campaigns (rascunho, updated_at = versao)
  publicar -> conta o segmento (audience-facts + audience-model; 0 alunos = 422) na versao lida (grava so ela, senao 409)
           -> publishDecision: sem messaging.publish ou > 500 sem messaging.publish_large -> pending_approval
           -> com messaging.publish_large (ou aprovado): approved_at
  editar/retomar pop-up no ar -> publishDecision de novo; sem permissao -> 403 (sem pedido)
  notificacao agora   -> sending -> dispatchInboxCampaign na propria acao -> notifications (lotes de 500) -> sent
  notificacao agendada -> scheduled
  pop-up              -> active -> refreshPopupDeliveries -> campaign_deliveries -> invalidateLivePopups
pg_cron tick (* * * * *) -> POST /api/jobs/tick -> job comunicacao (processCommunications)
  1. claimDueInbox: ate 3 avisos (scheduled vencido, ou sending com reserva vazia ou de mais de 2 min), update condicional
     -> dispatchInboxCampaign: so quem ainda nao recebeu, ate 20.000 por rodada; cortado -> solta a reserva;
        falha -> attempts + 1, a terceira cancela com last_error
     -> sem approved_at e o segmento passou de 500: volta para pending_approval (sem data), nada sai
  2. fetchPopupsToRefresh: ate 5 pop-ups active (no ar ou com janela futura) sem recalculo desde o comeco da faixa de
     15 min (:00, :15, :30, :45) -> refreshPopupDeliveries (grava so se updated_at nao mudou; senao limpa a hora);
     falha -> grava so a hora (tenta na faixa seguinte)
  fatos dos alunos lidos uma vez por rodada e so se houver trabalho; sem a migracao: registra e termina
Resposta a comentario (aula ou Comunidade) -> after() -> notifyCommentReply -> notifications (comment_reply / comment_mention)
Aluno: AppShell (depois da hidratacao) -> GET /api/notifications/summary -> numero do sino (60 s em memoria, falha tambem)
  abre o sino (painel baixado ao chegar perto) -> GET /api/notifications -> POST read { seen: true } (so o que aparece)
  home -> GET /api/notifications/summary?popup=1 (1,5 s; unico pedido do resumo na home) -> pop-ups no ar
       (unstable_cache 60 s, tag communications) + campaign_deliveries do aluno + ultimo pop-up visto -> pickPopup
       -> janela baixada so com pop-up -> POST /api/popups/[id]/events
pg_cron 'bunker707-communication-prune' (06:41 UTC) -> public.prune_communication_history() (24 meses; pop-up no ar fica)
```

Invariantes:

- nada da Comunicacao e lido pelo navegador: RLS ligado e nada para `anon`/`authenticated`; as rotas usam o `user_id` da sessao e devolvem 404 para o que nao e do aluno;
- a lista de pop-ups no ar e o unico cache compartilhado e so tem os avisos; o estado de cada aluno e lido a cada pedido em duas consultas pequenas, e o numero do sino nunca entra no carregamento da pagina (`getAppShellData` nao mudou);
- notificacao de aviso nao copia o conteudo: o sino junta o aviso por chave estrangeira e esconde aviso excluido, nao enviado (o teste da equipe aparece) ou retirado;
- link do botao conferido ao gravar (`isSafeHeroCtaHref` no schema), ao ler no servidor e ao desenhar; imagem e audio so de `https` (ou do Supabase na propria maquina);
- toda escrita do admin confere a versao lida (`updated_at`) e a situacao no proprio UPDATE; o gatilho `touch_campaign_version` nao muda a versao quando so a contagem do segmento muda;
- deploy antes da migracao nao quebra: o sino responde vazio, marcar como vista ou lida nao faz nada, clique, resposta e eventos do pop-up respondem 404, o job registra e termina e as telas do admin mostram o aviso de atualizacao do banco.

### Implementado (21/10/2026): Comunicacao v2

Produto, regras e decisoes em `docs/23`; tabelas em `docs/05` (secao Comunicacao v2); seguranca em `docs/06` (secao Comunicacao v2); admin em `docs/17` §1.8. Migracao `202610200002_communication_v2.sql`. Nenhuma variavel de ambiente nova e nenhum servico novo.

Modulos novos ou mudados:

- puros (sem `server-only`, imports relativos, testados direto pelo Node): `message-meta.ts` (catalogo de icones e cores, tempo no sino e `computeExpiresAt`, `urgencyLabel`, icone da escola), `flow-model.ts` (limites fixos `FLOW_LIMITS`, `decideFlowTask`, `dueFromAnchor`, `childTasksOf`, `validateFlowTree`, `validateFlowGoal`, seguintes ↔ arvore, `watchedPageKeysOf`), `flow-schemas.ts` (zod do fluxo e das seguintes), `audience-model.ts` (as regras `message`, `page_visit` e `access_gained`), `src/server/member-area/page-visit-model.ts` (chaves das paginas) e, no admin, `flows-view-model.ts`, `flow-templates-model.ts` e `follow-ups-view-model.ts`;
- servidor: `flow-store.ts` (leituras, sondagens, RPCs do motor e `saveFlowTree`, a ordem do salvar), `flow-facts.ts` (fatos de um lote, com cache por tick), `flow-engine.ts` (`processFlows`), `facts-loader.ts` (leitor de fatos por chave dividido pelas duas fases do job), `flow-actions.ts` e `flow-queries.ts` (as telas de Fluxos), `sender-notices.ts` (e-mail `sent_as`), `audience-facts.ts` (linhas das notificacoes citadas em regras e fatos por lista de alunos, em pedacos de 150), `inbox.ts` (fim, "abriu", audio, quem envia ao vivo, `shown`), `actions.ts` (Quem envia, tempo no sino, seguintes) e `src/server/member-area/page-visits.ts` (`trackMemberPageVisit`, chaves acompanhadas em `unstable_cache`).

Rotas novas: `POST /api/notifications/[id]/audio` e `POST /api/page-visits` (as duas com `requireApiSessionUser`, que le so as claims do JWT); `POST /api/notifications/read` aceita `shown`. Telas novas: `/admin/comunicacao/fluxos`, `/fluxos/novo` e `/fluxos/[id]`.

```txt
Equipe -> notificacao com seguintes (saveNoticeDraft + saveNoticeFollowUps) ou fluxo (saveFlow)
  -> saveFlowTree: conteudo (versao nova se o fluxo esta no ar) + RPC 7.5 (arvore com versao, watched_page_keys)
  -> publicar a notificacao / ativar o fluxo -> RPC 7.13 (conteudo sent antes do fluxo active) -> e-mail sent_as
pg_cron tick -> POST /api/jobs/tick -> job comunicacao
  fase 1: processCommunications (v1)                     } um leitor de fatos por chave (createFactsLoader)
  fase 2: processFlows (25 s)                            }
    0. 3 sondagens (tarefa vencida de fluxo ativo, entrada pendente, seguintes esperando o aviso)
    1. seguintes: RPC 7.3 depois de o aviso estar sent (e o complemento de uma seguinte nova)
    2-3. construtor: entrada inicial e continua na faixa de 15 min (RPC 7.2, lotes de 500)
    4. lotes de 150: RPC 7.1 (reserva) -> RPC 7.9 (fatos) -> decideFlowTask (puro) -> RPC 7.4 (aplica:
       envio uma vez, limite de 3 por dia e 1 h, filhos); erro de dado -> divide ao meio; falha antes -> RPC 7.15
    5. varredura do Objetivo (RPC 7.6)   6. conclusao (RPC 7.13)
    -> job_runs.metadata { tick_run_id, flows }
Aluno: pagina da area -> trackMemberPageVisit (after(), so chave acompanhada, sem equipe, sem pre-carregamento)
  detalhes do produto / Comprar -> sendBeacon POST /api/page-visits
  sino: primeiro play -> POST /audio started (substitui POST /read {ids}); progresso por fetch ou beacon
```

Invariantes:

- nada novo e lido pelo navegador: RLS ligado, nada para `anon`/`authenticated`, RPCs so com `service_role`;
- o motor so envia o que a RPC de aplicacao confirma sob trava (fluxo, passo, versao e equipe relidos), uma vez por (passo, aluno), dentro do limite diario;
- nenhum embed entre `campaigns` e `communication_flows` sem a dica da FK (`PGRST201` derrubaria o job a cada minuto); teste confere;
- a 0002 vai antes do deploy que a usa: nao ha caminho de volta para as colunas da v1 (sem ela, o sino responde vazio, o job registra "202610200002 pendente" e termina, e envios e cliques nao funcionam).

### Implementado (22/10/2026): Comunicacao v3a

Produto, regras e decisoes em `docs/24`; tabelas em `docs/05` (secao Comunicacao v3a); seguranca em `docs/06` (secao Comunicacao v3a). Migracao `202610220001_communication_v3a.sql` (aditiva, toda pelo MCP). Nenhuma variavel de ambiente nova e nenhum servico novo.

Modulos novos ou mudados:

- puros: `interactions-model.ts` (catalogo das reacoes, `pollSchema`, `parsePoll`, `normalizePollChoice`, resultado da enquete, `shouldRecordInteraction`), `student-write-limit.ts` (`takeStudentWrite`: 30 escritas por minuto por aluno, por processo), `campaign-model.ts` (`availableNoticeActions` com `{ popupRepeat, recipients }`, `noticeRecipients`, `pickPopup` com as bases do "Mostrar de novo"), `schemas.ts` (`sentNoticeLockedProblems`, corpos das rotas novas), `notifications-model.ts` (cartao clicavel, nomes, enquete, Mudar resposta, `openingPlan`, `shouldPrefetchOnIntent`, constantes `INBOX_*`);
- servidor: `inbox.ts` (a lista e os numeros em uma RPC cada; `setNotificationHidden`, `reactToNotification`, `voteOnNotificationPoll`, `respondToNotification` com troca), `actions.ts` (editar a enviada, `deleteNotice` por situacao, `reshowPopup`, `closeNoticePoll`), `queries.ts` (citacoes, interacoes e `reshowable` no detalhe);
- navegador: `notifications-client.ts` guarda a primeira pagina do sino numa memoria do modulo (5 s / 60 s / 10 min) e a busca na intencao (`prefetchInbox`), junto com o codigo do painel.

Rotas novas: `POST /api/notifications/[id]/reaction`, `/poll` e `/hide`; `/response` aceita a troca. Toda rota do sino e o beacon do pop-up usam `requireApiSessionUser` (claims do JWT, sem ida ao Auth em producao).

```txt
Aluno: mouse 120 ms / foco pelo Tab / toque no sino -> codigo do painel + GET /api/notifications (uma vez)
  -> requireApiSessionUser (claims) -> RPC communication_inbox_page (pagina, pessoas, numeros, contagem da
     enquete so para quem votou ou encerrada) -> memoria do navegador (reabre na hora; > 5 s atualiza por tras)
  reagir / votar / excluir / responder -> takeStudentWrite (30/min) -> communication_visible_notifications
     (a mesma regra da lista) -> escrita (ou RPC 5.1 / 5.2) -> evento ate 20 por linha
Equipe: Editar a enviada -> saveNoticeDraft (versao, campos travados, publish/500, seguintes) -> so as colunas editaveis
  Excluir -> withdrawSentNotice + exclusao logica | Mostrar de novo -> RPC 5.3 (conta, 500, aplica)
```

Invariantes:

- a regra de "aparece no sino" existe so em SQL (`communication_visible_notifications`): lista, numeros, marcacoes e cada conferencia de uma linha usam a mesma; teste de paridade;
- editar a enviada nunca roda `publishProblems`, nunca move o fluxo das seguintes e nunca recalcula pop-ups;
- sem polling (C11): pedidos do sino so na intencao ou na abertura, no maximo um por abertura, nenhum ao fechar;
- a 0003 vai antes do deploy que a usa (sem ela, o sino responde vazio e as escritas novas 404); a migracao sozinha nao atrapalha o app da v2.

### Implementado (22/10/2026): Comunicacao v3b-1

Produto, regras e decisoes em `docs/25`; tabelas em `docs/05` (secao Comunicacao v3b-1); seguranca em `docs/06` (secao Comunicacao v3b-1). Migracao `202610220003_communication_v3b1.sql` (aditiva, toda pelo MCP, aplicada antes do merge). Nenhuma variavel de ambiente nova, nenhum servico novo, nenhum job novo nem fase nova do tick.

Modulos novos ou mudados:

- puros: `popup-display-model.ts` (chave da pagina, padroes e excecoes, formacao -> cursos, colunas <-> configuracao, `frequencyVerdict`, `showNext`, `decideShow`, `planPopups`, `pagesCovering`, dia de Sao Paulo), `popup-sentences.ts` (todas as frases da equipe), `popup-editor-model.ts` (os dois cards), `popup-host-model.ts` (o que o navegador arma e o que bloqueia), `src/lib/lesson-media-signal.ts` (o player da aula lido do DOM na hora); `campaign-model.ts` perdeu `pickPopup`, `reshowSkipped`, `LivePopup` e `POPUP_RULES.delayMs/minHoursBetween`;
- servidor: `popups.ts` (lista no ar em cache com as regras, `getPopupsAnswer`, `showPopup`, `recordPopupEvent`, o caminho da v1), `popup-store.ts` (leituras, formacoes, RPC da abertura), `actions.ts` (`withPopupSettings`, teto de 50, Mostrar de novo em qualquer modo), `queries.ts` (`placementLabel`, `popupMode`, `popupNames`, `opensOnLesson`);
- navegador: `notifications-client.ts` ganha a memoria dos pop-ups (1 minuto, mesmo dono do sino); `member-popup-host.tsx` vira uma fila por visualizacao de pagina, montada em toda pagina do aluno com chave; `lesson-experience.tsx` ganha cinco insercoes (os sinais do player).

Rotas: `GET /api/notifications/summary?page=<chave>` (mapa grosso e plano), `POST /api/popups/[id]/show` (novo) e `POST /api/popups/[id]/events` com `via`; `?popup=1` e o `impressed` da v1 continuam para abas antigas.

```txt
Aluno abre uma pagina -> topo: GET /api/notifications/summary?page=<chave> (so se o numero ou a memoria passou de 1 min)
  -> lista no ar (cache 60 s) -> mapa grosso; pagina coberta -> 1 leitura das linhas do aluno -> plano (sem conteudo)
  host: arma pelo plano (ou pela conclusao da aula) -> fila, um de cada vez -> bloqueios (player, tela cheia, camada)
  -> baixa a janela -> POST /api/popups/[id]/show -> decideShow -> RPC communication_record_popup_impression
     (compare-and-set em updated_at) -> conteudo + next -> abre; resultado -> beacon /events (com via)
Equipe: salvar -> withPopupSettings -> popup_* + popup_repeat juntos | publicar/aprovar/retomar -> teto de 50
  Mostrar de novo -> RPC communication_reshow_popup (qualquer modo; clique zera so em "never")
```

Invariantes:

- conteudo do pop-up so no `show`, depois de conferir e gravar; o mapa que vai a todo aluno nunca tem id de produto;
- as regras de frequencia moram so em `popup-display-model.ts` (servidor, navegador e testes); o SQL so guarda a escrita atomica e os formatos;
- sem polling (C11): nenhuma consulta por aluno nas paginas sem pop-up e nenhum pedido dentro do minuto; nada roda em intervalo alem da conferencia de 1 s enquanto algo bloqueia;
- o pop-up nunca pausa nem retoma o video da aula e nunca abre com o nosso player tocando;
- a 0003 vai antes do merge (sem ela, o job `comunicacao` do tick falha); a migracao sozinha nao atrapalha o app da v3a.

### Implementado (22/10/2026): Design do pop-up

Produto, regras e decisoes em `docs/26`; tabelas em `docs/05` (secao Design do pop-up); seguranca em `docs/06` (secao Design do pop-up). Migracao `202610230001_communication_popup_design.sql` (aditiva, toda pelo MCP, aplicada antes do merge). Nenhuma variavel de ambiente nova, nenhum servico novo, nenhum job novo. Video e fontes no Supabase Storage (nunca no servidor do app).

Modulos novos ou mudados:

- puros: `popup-design-model.ts` (tipos v1, limites, fontes prontas, modelos, forma canonica, sincronia com botao/audio, nome acessivel, escala `cqw`, CSS, contraste WCAG, regra das URLs do Storage; **sem zod**), `popup-design-schema.ts` (zod v1, `parsePopupDesign`, regras design x conteudo), `popup-design-editor-model.ts` (as pecas do card Design), `popup-design-styles.ts` (os estilos do cartao do aluno);
- servidor: `popup-fonts.ts` (resolver de fontes, biblioteca, conferencia ao salvar/publicar, url do video recalculada), `popup-media.ts` (sniffers de video e fonte, leitura de 64 bytes, gravacao da fonte), `popup-design-actions.ts` (envio de video, biblioteca), rota `POST /api/admin/communications/popup-fonts`; `actions.ts`, `store.ts`, `queries.ts`, `popups.ts`, `popup-store.ts`, `cache.ts` (chave `design1`) e `notification-model.ts` (`PopupItem.design/fonts`);
- navegador: `src/components/member/notifications/popup-design/` (cartao, blocos, midia, carregador de fontes), `MemberPopupCard` despacha Padrão ou Personalizado; `src/components/admin/v2/communication/popup-design/` (o card Design do editor).

```txt
Equipe: card Design -> video: startPopupVideoUpload -> PUT no endereco assinado (Storage) -> finishPopupVideoUpload (64 bytes)
        fonte: POST /api/admin/communications/popup-fonts -> communication_fonts + bucket
        salvar/publicar -> popupDesignSchema (zod) -> withCheckedDesign (design x conteudo, fontes, url do video) -> popup_design
Aluno:  lista no ar (cache 60 s, design1) -> parsePopupDesign + url do video + fontes resolvidas (1 consulta)
        -> POST /api/popups/[id]/show -> PopupItem { design, fonts } -> MemberPopupCard -> PopupDesignCard
        -> FontFace do Storage; <video> so sem menos movimento / Save-Data
```

Invariantes: o Padrão nao muda (mesmo HTML, mesma resposta do `show`); a notificacao nunca tem design; zod no salvar e no ler; nada de HTML ou CSS em texto; video e fonte so dos nossos buckets; o cartao do aluno nao importa o zod (o JS inicial do aluno nao cresce; o cartao fica no pedaco preguicoso da janela).

## Deploy

Fase inicial (hoje):

- Vercel para app Next.js;
- Supabase para banco;
- Mux/Bunny para video.

Producao propria na Hetzner (preparada em 17/10/2026, ainda nao criada; decisao do produtor em docs/19):

- `Dockerfile` na raiz gera a imagem do app em modo standalone (Node 24, usuario sem privilegio, `HEALTHCHECK` em `GET /api/health`); `output: "standalone"` so entra com `NEXT_OUTPUT=standalone`, entao Vercel, `npm run build` e os testes nao mudam;
- `.github/workflows/build-image.yml` publica a imagem no ghcr.io a cada push na `main` (sem deploy automatico);
- `infra/compose/docker-compose.yml` sobe o Supabase self-hosted (Postgres 17, Envoy, GoTrue, PostgREST, Realtime, Storage, imgproxy, postgres-meta, Supavisor, Edge Runtime, Studio) com o app e o Caddy num servidor so; portas do Supabase so em 127.0.0.1;
- o app fala com o Supabase pelo mesmo endereco publico que o navegador usa (cookie `sb-<host>-auth-token` e URLs do Storage dependem disso), resolvido para o proprio servidor por `extra_hosts`;
- scripts em `infra/scripts/` (bootstrap, firewall da Hetzner, migracoes, deploy, backup/restore, atualizacao do stack) e o passo a passo completo em `docs/20-runbook-hetzner.md`.

Regras que continuam valendo em qualquer hospedagem:

- manter variaveis de ambiente organizadas (`.env.example` na raiz e `infra/compose/.env.example`);
- evitar dependencia forte de Edge Functions da Vercel;
- usar Route Handlers padrao;
- nao guardar arquivos importantes no filesystem local do servidor (Storage do Supabase, com backup).

## Importador de playlists do YouTube

- o recurso pertence ao produto-base e aparece no Catalogo como um assistente nativo de criacao de curso;
- endpoints administrativos separados para preview e importacao;
- URL e playlist ID validados por allowlist fixa de hosts do YouTube;
- `YOUTUBE_DATA_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY` permanecem somente no servidor;
- o backend rele a playlist no momento da gravacao e nao confia na arvore enviada pelo navegador;
- o modo `automatic` deriva modulos e aulas dos titulos; o modo `manual_ranges` recebe somente nomes e intervalos de posicoes, relê a playlist no servidor e rejeita lacunas, sobreposicoes, intervalos vazios e posicoes invalidas;
- a funcao Postgres `import_youtube_course(jsonb)` grava curso, configuracao, modulos, aulas e fonte em uma unica transacao; o admin chama por `admin_import_new_youtube_course(jsonb)`, que trava a playlist e recusa (`playlist_already_imported`) a que ja virou curso, para duas importacoes ao mesmo tempo nao regravarem o curso uma da outra;
- IDs derivados da playlist e dos videos tornam o reenvio idempotente;
- itens que desapareceram da playlist sao arquivados, nao apagados, preservando auditoria e progresso;
- o caminho sem chave da API oficial e um fallback para playlists publicamente acessiveis e pode exigir manutencao se o HTML do YouTube mudar.
