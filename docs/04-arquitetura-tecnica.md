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
  -> notificacoes futuras

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

## Autenticacao

Decisao do MVP: Supabase Auth.

Motivos:

- menos fornecedores no primeiro ciclo;
- integrado ao banco e as policies RLS;
- bom para MVP enxuto;
- permite email/senha, OAuth e recuperacao de senha sem expor service role no browser.

Implementacao atual:

- `@supabase/ssr` cria clientes de browser, servidor e proxy;
- o `proxy.ts` na raiz (convencao do Next 16 que substitui `middleware.ts`, runtime Node) protege home, `Minhas compras`, `Favoritos`, paginas de conteudo/aula e `/admin`;
- o `proxy.ts` valida a sessao com `getUser()` por padrao ou com `getClaims()` quando `AUTH_SESSION_STRATEGY=claims` (verificacao local do JWT via JWKS so com signing keys assimetricas no Supabase; sem elas o `getClaims()` ainda consulta o Auth); nas paginas, `getAuthenticatedUser` e `getAdminRoleForUser` usam `React.cache`, entao layout, pagina, guards e loaders fazem uma unica chamada ao Supabase por request;
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

Modulo `src/server/payments/` (migracao `202610170003_sales_webhooks.sql`; tela em `docs/17` §1.10). Ticto e Kiwify entram pelo mesmo caminho quando tiverem adaptador; ate la aparecem como "Em configuracao".

- `types.ts`: contrato `PaymentProviderAdapter` (`verify`, `normalize`, `redact`, `handledEvents`, `maxPayloadBytes`) e o evento normalizado `{ provider, eventId, type: purchase_approved | refund | chargeback | subscription_canceled | other, rawType, buyer { email, name, phone }, externalProductId, externalProductName, transactionId, purchasedAt, warrantyEndsAt, occurredAt }`;
- `hotmart.ts` (puro): le o envelope 2.0 (`id`, `event`, `creation_date` em epoch ms, `data.product/buyer/purchase/subscriber`), traduz `PURCHASE_APPROVED` e `PURCHASE_COMPLETE` para `purchase_approved`, `PURCHASE_REFUNDED` para `refund`, `PURCHASE_CHARGEBACK` para `chargeback`, `SUBSCRIPTION_CANCELLATION` para `subscription_canceled` e o resto para `other`; confere o hottok (cabecalho `X-HOTMART-HOTTOK`, ou `hottok` no corpo) em tempo constante (SHA-256 dos dois lados + `timingSafeEqual`) contra o segredo salvo em `integration_settings`, nunca contra variavel de ambiente; `redact` tira o `hottok` do payload guardado;
- `adapters.ts`: registro (`getPaymentAdapter`, `isSalesProviderSupported`);
- `process-sale.ts`: a regra de acesso, separada do parser. Resolve `sales_product_links` (codigo da plataforma -> produto ou pacote); compra aprovada chama `provisionStudentAccess` de `src/server/students/access.ts` com `source: "webhook"`, `sourceProvider: "hotmart"`, `sourceEventId` = `purchase.transaction` (ou o id do evento), `delivery: "none"` e `siteOrigin` do request (a mesma rotina do admin: conta, perfil, boas-vindas e e-mail de compra saem dali); reembolso e chargeback chamam `applyAccessAction` com `revoke` e assinatura cancelada com `suspend`, produto a produto (pacote = todos). O que nao da para fazer (evento `other`, codigo sem ligacao, pacote em rascunho ou pausado, aluno sem conta, acesso ja fechado) e **ignorado com o motivo escrito**; erro de verdade (sem e-mail valido, banco) vira `failed`;
- `webhook-handler.ts`: fluxo comum de `POST /api/webhooks/<plataforma>`: plataforma conectada (senao 503) -> corpo ate 256 KB (413) -> JSON (400) -> token (401, nada gravado) -> evento normalizado (400) -> `webhook_events` com o payload bruto, unico por (`provider`, `external_event_id`) (repetido responde 200 `duplicate` sem reprocessar) -> regra de acesso -> resultado na linha (`processed`/`ignored`/`failed`, `outcome`, `outcome_detail`, `error_message`, alvo e aluno resolvidos) e em `integration_settings` (`last_sync_at`; `needs_attention` + `last_error` quando o ultimo evento falhou). Falha responde 500 e o evento fica guardado; `reprocessWebhookEvent` roda a regra de novo a partir do payload guardado (falhou ou ignorado);
- `store.ts`, `queries.ts`, `actions.ts` (`saveSalesSecret`, `disconnectSalesProvider`, `reprocessSalesEvent`, todas `settings.sales`, com `admin_audit_log` sem o token), `schemas.ts`, `model.ts` (rotulos, mascara do e-mail, situacao);
- `src/app/api/webhooks/hotmart/route.ts` (runtime Node) chama `receiveSaleWebhook("hotmart", request)`;
- um evento de venda pode liberar varios produtos: `grantResolvedProducts` grava `source_event_id` com o sufixo `:<produto>` quando ha mais de um produto no mesmo evento (indice unico `(user_id, source_event_id)`); o e-mail de compra continua um por venda.

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
- `analysis_status`, `analysis_result` e `analyzed_at` deixam cada comentario pronto para jobs futuros de sentimento, temas, intencao, duvidas e oportunidades de conteudo.

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
- `src/server/jobs/registry.ts`: ponto de extensao. `Job = { name, run(ctx) }`; `ctx` traz o cliente administrativo do Supabase, um `AbortSignal` com o prazo do tick, o instante do tick e os ids de `job_runs`. Registrado hoje: `email-outbox` (`src/server/jobs/email-outbox-job.ts`, fila de e-mails transacionais; secao E-mail transacional);
- `src/server/jobs/run-tick.ts`: executa os jobs em sequencia com orcamento de 45 s; um job que lanca erro ou estoura o prazo vira `failed` sem derrubar os demais; jobs que nao couberem no prazo ficam para o proximo tick (`skipped`);
- `src/server/jobs/job-runs.ts`: gravacao de `public.job_runs`.

Regras para um job novo no registro:

- `name` unico em kebab-case (`tick` e reservado);
- idempotente: o mesmo minuto pode chegar duas vezes e um minuto pode ser perdido; o job busca o que esta vencido em vez de assumir que roda exatamente uma vez por minuto;
- curto e em lotes pequenos, respeitando `ctx.signal`;
- recomputos pesados (por exemplo `student_facts`) rodam a noite em agendamento proprio, nunca por minuto no banco primario;
- dead-letter apos 3 falhas e retentativas com `attempts` ficam com o job que precisar delas (a coluna ja existe em `job_runs`).

Retencao: `public.prune_job_history()` roda diariamente as 06:17 UTC (`bunker707-jobs-history-prune`) e apaga `job_runs` com sucesso apos 30 dias, com falha apos 90 dias, e `cron.job_run_details` apos 7 dias.

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

Pontos de disparo (`src/server/students/access.ts`, a mesma rotina do admin e dos webhooks de venda):

- **boas-vindas** (`welcome`): na primeira vez que a conta nasce. Numa venda por webhook, sempre; pelo admin (Adicionar aluno, importacao), so quando a equipe escolheu convite ou senha temporaria, porque "Nao enviar agora" significa isso. O texto diz com qual e-mail entrar e como criar a senha conforme a entrega: convite (chega outro e-mail com o link), senha temporaria (a equipe passa) ou nada (usar "Esqueci minha senha" na tela de entrar);
- **acesso liberado por compra** (`purchase`): quando `grantProductAccess` vem de `source = "webhook"` e abre um acesso que estava fechado (novo, revogado, suspenso ou expirado). Um e-mail por compra, com os produtos abertos e o link de cada um (`/conteudo/<id>`). Prazo a mais num acesso ja aberto e acoes da equipe (liberar, em massa, importacao) nao avisam o aluno; envio em massa a partir da lista de alunos fica para o modulo Comunicacao.

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
```

Codigo:

- `src/server/email/types.ts`, `config.ts`, `providers/resend.ts`, `outbox-rules.ts`, `webhook-signature.ts`, `webhook-events.ts`, `templates/*`: modulos puros, cobertos por `tests/email-*.test.mjs`;
- `src/server/email/outbox.ts` (fila no banco), `provider.ts` (escolha pelo ambiente), `transactional.ts` (os dois e-mails), `src/server/jobs/email-outbox-job.ts` e `src/app/api/webhooks/resend/route.ts`: cobertos por `tests/integration/email-transacional.test.mjs` com o banco local e o provedor falso de `tests/support/integration-email-provider.mjs`. Nenhum teste envia e-mail de verdade.

Variaveis: `EMAIL_PROVIDER`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `EMAIL_DAILY_LIMIT` e `NEXT_PUBLIC_SITE_URL` (`.env.example`; tabela em `docs/06-seguranca-operacao.md`, secao E-mail transacional).

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
