# Seguranca e Operacao

## Principios

- Nenhuma chave sensivel no browser.
- Service role do Supabase somente no servidor.
- RLS habilitado nas tabelas expostas.
- Webhooks sempre validados.
- Eventos externos sempre idempotentes.
- Logs e auditoria desde o inicio.
- Videos protegidos por provedor especializado.

## Row Level Security

Todas as tabelas acessiveis pelo cliente devem ter RLS.

Politicas iniciais:

- aluno le seu proprio perfil;
- aluno le seu proprio progresso;
- aluno le somente conteudos liberados;
- aluno cria eventos proprios permitidos;
- aluno nao altera entitlement;
- admin/server altera conteudo, acesso e webhooks.

Implementado no MVP atual:

- Supabase Auth e usado como provedor de identidade;
- o `proxy.ts` do Next.js (antigo `middleware.ts`) renova/valida sessao com `@supabase/ssr`: `getUser()` por padrao ou `getClaims()` com `AUTH_SESSION_STRATEGY=claims`; `getSession()` nunca decide acesso no servidor;
- com `claims`, uma sessao revogada e um `must_change_password` marcado depois do login so aparecem no proxy quando o JWT for renovado (ate 1 h), mas as paginas protegidas seguem validando com `getUser()` (uma vez por request via `React.cache`) e, se o JWT ainda marca `must_change_password`, o proxy confirma com `getUser()` antes de redirecionar; ative `claims` primeiro no staging e so depois de migrar o projeto para signing keys assimetricas;
- `profiles`, `entitlements`, `student_events`, `lesson_progress`, `admin_roles`, `admin_functions` e todas as tabelas de comentarios/moderacao possuem RLS;
- aluno pode ler/editar somente o proprio perfil, ler os proprios entitlements e gravar eventos proprios;
- aluno nao possui policy para criar, alterar ou remover entitlements;
- `/admin` e as APIs `/api/admin/*` exigem papel em `admin_roles`, e cada area, tela, Server Action e rota exige a permissao dela (tabela em docs/17 §2.3, secao "Equipe e permissoes" abaixo);
- login, callback e reentrada em `/login` direcionam usuarios administrativos para `/admin` depois da autenticacao;
- `/api/progress/lessons` grava progresso usando `auth.user.id`, nao um id vindo do cliente.
- comentarios, reacoes, denuncias e progresso passam pela mesma autorizacao central de aula;
- a autorizacao valida conteudo/modulo/aula publicados, pertencimento, regra de liberacao e entitlement ativo;
- listas de aulas recebidas pelo endpoint de progresso sao validadas em lote antes de alterar conclusoes ou reacoes;
- respostas 5xx nao devolvem mensagens internas do Supabase; o detalhe fica no log do servidor.

Videos nao listados do YouTube nao devem ser tratados como conteudo criptografado ou inacessivel fora da plataforma. O player Bunker707 remove interacoes e links visiveis do embed por UX, mas o ID continua recuperavel por inspecao tecnica. Entitlements protegem o acesso pela aplicacao; protecao forte da origem exige um provedor com URLs assinadas/tokens e nao pode ser prometida usando YouTube gratuito.

No modo manual de resolucao, a API da aplicacao exige sessao e autorizacao para a aula antes de resolver os formatos, mas devolve ao navegador URLs temporarias diretas de audio e video; a aplicacao nao faz proxy do conteudo. Essas URLs, assim como o ID e as requisicoes do embed em `Automatica`, podem ser observadas por ferramentas do navegador. Expiracao reduz o tempo de validade, mas nao impede copia durante esse periodo e nao equivale a DRM, URL assinada controlada pela Bunker707 ou promessa de protecao. Como a extracao e nao oficial, mudancas do YouTube tambem podem interromper qualidades manuais sem aviso.

Como dissuasao adicional, a experiencia de aula bloqueia o menu de contexto global e os atalhos comuns de DevTools e codigo-fonte enquanto estiver montada. O payload do aluno remove a URL original do YouTube e mantem somente o ID canonico necessario ao player; streams e legendas recebem os IDs internos da aula/conteudo e resolvem o video no servidor depois da autorizacao. Isso dificulta a descoberta casual sem alterar as opcoes de resolucao, mas nao bloqueia o menu do navegador, ferramentas externas, requisicoes de rede ou gravacao de tela.

### Hardening pendente no ambiente remoto

A auditoria de 10/07/2026 encontrou policies antigas de catalogo com `using (true)`. Elas permitiam que qualquer cliente Supabase autenticado consultasse diretamente metadados de conteudo, modulos, aulas e `video_config`, contornando a filtragem do Next.js.

A migration `202607100002_harden_content_and_media_storage.sql` corrige isso ao remover essas policies, revogar acesso direto de `anon`/`authenticated`, restringir a funcao de onboarding, criar o bucket de capas e adicionar indices operacionais.

Situacao operacional em 10/07/2026:

- o bucket `content-assets` foi criado e as imagens inline foram migradas usando a credencial server-side existente;
- a DDL de revogacao e indices ainda nao foi aplicada ao projeto remoto, porque a conta disponivel nao possui privilegio de proprietario e nao ha senha de banco/token de gestao no ambiente;
- ate a migration ser aplicada por um proprietario, a exposicao direta antiga continua sendo um risco real no Supabase remoto;
- nao considerar o hardening concluido apenas porque o arquivo SQL existe no repositorio.

Revisao de deploy em 13/08/2026:

- a aplicacao passou a emitir CSP com nonce por requisicao, `frame-ancestors 'none'`, HSTS em producao e os demais cabecalhos defensivos documentados em `docs/15-deploy-vercel-seguro.md`;
- codigo embed de aula nao e mais executado como HTML em `srcDoc`; apenas a URL HTTPS de um iframe valido e extraida e persistida;
- o arquivo declarativo `supabase/config.toml` desabilita cadastro publico e exige senha com pelo menos oito caracteres;
- essas configuracoes locais nao comprovam o estado remoto. Antes de publicar, um proprietario ainda precisa confirmar no Dashboard que cadastro publico esta desligado, que todas as migrations constam como aplicadas e que os Security Advisors nao apontam RLS ou privilegios perigosos.

Aplicacao e verificacao exigidas:

```bash
supabase db push --linked
supabase migration list --linked
```

Como alternativa, um proprietario pode executar a migration no SQL Editor e confirmar que `anon` e `authenticated` nao possuem `SELECT` nas tabelas revogadas.

Regra de desenvolvimento:

- nao existe modo local de autenticacao, usuario fixo ou cookie de desenvolvimento;
- sem variaveis Supabase, login e APIs autenticadas devem falhar explicitamente;
- sem Supabase acessivel ou migrations aplicadas, a aplicacao nao deve criar dados sinteticos para seguir navegavel.

## Webhooks

Regras:

- validar assinatura/token quando a plataforma oferecer;
- salvar payload bruto;
- usar idempotencia;
- processar em background;
- registrar erro sem perder evento;
- permitir reprocessamento seguro.
- mapear evento externo para produto ou combo interno antes de alterar acesso;
- criar ou revogar somente entitlements internos, nunca liberar conteudo direto pelo payload do provider;
- guardar segredos de webhook somente no servidor ou gerenciador de segredos.

### Vendas pela Hotmart (17/10/2026)

`POST /api/webhooks/hotmart` (fluxo em `docs/04`, secao Webhooks externos; tabelas em `docs/05`, secao Webhooks):

- o token da Hotmart (hottok) nao e variavel de ambiente: o dono cola em Configuracoes > Vendas (`settings.sales`, so o dono) e ele fica em `integration_settings.secret`, tabela so de `service_role`. A tela nunca recebe o token de volta (so `secret_status` e a data); trocar grava por cima; Desconectar apaga. Nenhuma variavel nova em `.env.example` nem na Vercel;
- sem token guardado a rota responde 503 e nao grava nada; token errado ou ausente responde 401 e nao grava nada. A conferencia e em tempo constante (SHA-256 dos dois lados + `timingSafeEqual`), pelo cabecalho `X-HOTMART-HOTTOK` ou pelo `hottok` do corpo;
- o payload bruto e guardado em `webhook_events` sem o `hottok` (o corpo das versoes antigas repete o token) e com o e-mail do comprador; a tela mostra o e-mail mascarado (`c***@dominio`). E dado pessoal: retencao de 12 meses pendente, junto com `email_outbox`;
- idempotencia por (`provider`, `external_event_id`); evento repetido responde 200 sem reprocessar. Entitlements usam `source_provider = hotmart` e `source_event_id` = id da compra;
- a regra de acesso (`src/server/payments/process-sale.ts`) so libera o que `sales_product_links` liga ao codigo da plataforma, pela mesma rotina do admin (`src/server/students/access.ts`). Codigo sem ligacao, pacote em rascunho ou pausado, evento que nao muda acesso e aluno sem conta sao ignorados com o motivo, nunca liberam nada. Reembolso e chargeback revogam o produto (ou todos os produtos do pacote) de quem tem o e-mail da compra, qualquer que seja a origem do acesso; assinatura cancelada suspende;
- falha de verdade (evento sem e-mail valido, banco) responde 500, fica `failed` com o motivo e marca a plataforma como "Precisa de atencao"; o dono reprocessa pela tela (`reprocessSalesEvent`, auditado). Reprocessar tambem vale para o que foi ignorado (ex.: codigo ligado depois da venda);
- toda mudanca na tela vai para `admin_audit_log` (`sales.secret_saved`, `sales.disconnected`, `sales.event_reprocessed`) sem o token;
- corpo limitado a 256 KB (413 acima), runtime Node. Processamento sincrono: a Hotmart reenvia quando a resposta nao e 2xx, e o evento repetido para no 200 `duplicate`.

Configuracao por ambiente, uma vez: em Configuracoes > Vendas, copiar o endereco mostrado (origem do site + `/api/webhooks/hotmart`), cadastrar na Hotmart (Ferramentas > Webhook, versao 2.0.0) com os eventos listados na tela (compra aprovada, compra concluida, reembolso, chargeback, assinatura cancelada), colar o hottok e salvar; informar o codigo da Hotmart em cada produto (Acesso e venda) ou pacote. Diagnostico: `select provider, status, secret_status, last_sync_at, last_error from public.integration_settings;` e `select event_type, processing_status, outcome, outcome_detail, received_at from public.webhook_events order by received_at desc limit 20;`.

## Comentarios e moderacao

Regras:

- aluno so comenta em aula/produto que pode acessar;
- comentario deve passar por bloqueio de palavras antes de ser salvo como publicado;
- comentarios podem ficar pendentes, aprovados, ocultos ou marcados como spam;
- acoes de moderacao devem registrar ator, acao, comentario e horario;
- palavras bloqueadas devem mostrar uma mensagem clara ao aluno sem expor regras internas demais;
- denuncias de comentarios devem entrar na fila de moderacao.

Implementado no fluxo atual:

- todas as operacoes de comentario exigem sessao e validacao server-side do acesso real a aula; usuarios administrativos podem acessar como produtores;
- tabelas de comentarios nao possuem policy direta para `anon` ou `authenticated` e sao acessadas somente pelas APIs server-side;
- corpo limitado a 2.000 caracteres, caracteres de controle removidos, ate cinco envios por minuto e bloqueio de duplicata imediata;
- palavras bloqueadas sao normalizadas sem expor ao aluno qual termo interno foi encontrado;
- denuncias sao idempotentes por aluno/comentario e nao removem o conteudo automaticamente;
- moderacao usa funcao transacional no banco para alterar o status e inserir a auditoria na mesma operacao;
- triggers registram criacao, resposta, reacao e denuncia em `student_events` sem copiar o corpo do comentario.

## Agentes de IA

Regras:

- qualquer agente precisa checar entitlement antes de usar contexto de aula, produto ou transcricao;
- o Tutor IA (`lesson_tutor`) usa exclusivamente a aula autorizada e o historico do chat atual;
- a IA Diretor (`platform_guide`) aponta links e recomenda caminhos somente entre conteudos publicados e liberados ao aluno autenticado; conteudos bloqueados ficam fora do contexto do primeiro release;
- Tutor IA e IA Diretor nao compartilham conversa, resumo, prompt ou fonte por conveniencia. Toda troca de escopo precisa ser explicita e auditavel;
- resposta automatica em comentario deve ser configuravel e auditavel;
- prompts, instrucoes e fontes de treinamento nao devem incluir service keys, payloads privados ou dados pessoais desnecessarios;
- conversas do tutor exigem RLS por `user_id`: somente o aluno dono pode listar, abrir, continuar ou criar chats em seu nome;
- o historico do tutor nao tem expiracao automatica e deve permanecer isolado por aluno, aula e conversa;
- o cache do Tutor existe somente na memoria da pagina autenticada e usa chaves com `user_id`, conteudo, aula e conversa. Ele nao pode ser persistido em `localStorage`, IndexedDB, service worker nem compartilhado entre sessoes;
- as APIs do Tutor permanecem `private, no-store` e revalidam sessao, ownership e entitlement no servidor. `401` limpa todo o cache privado da sessao e `403` limpa o escopo da aula antes de impedir novas consultas;
- `Excluir chat` e uma exclusao logica autenticada: grava `student_deleted_at`, remove o chat de todas as consultas do aluno e impede que suas mensagens sejam reutilizadas pelo tutor, sem apagar imediatamente o registro analitico do backend;
- rotas do Tutor exigem `agent_type = lesson_tutor` e rotas da IA Diretor exigem `agent_type = platform_guide`, impedindo leitura, renomeacao, exclusao ou continuacao cruzada entre os dois historicos;
- transcricoes, resumos e titulos sao dados nao confiaveis dentro do prompt: instrucoes encontradas nesse material devem ser ignoradas;
- o modelo recebe referencias opacas, nao URLs. O servidor aceita somente marcadores retornados pelo conjunto previamente autorizado e constroi links relativos internos; qualquer URL ou identificador inventado pelo modelo e descartado;
- cada resposta da IA Diretor persiste tambem o conjunto opaco completo de conteudos usado como contexto. Ao reabrir ou continuar um chat, esse conjunto inteiro e revalidado; a revogacao nao depende de o modelo ter escolhido citar uma referencia;
- limites de perguntas e reservas mensais da IA Diretor sao serializados no banco entre chats concorrentes. A troca de provedor em fallback reserva a cota antes da tentativa;
- progresso que libera uma etapa sequencial e dado de autorizacao: `lesson_progress` nao aceita escrita direta de `authenticated` e so e persistido pela API server-side depois de validar a aula;
- a listagem da IA Diretor e limitada a 100 chats ativos, sem uma consulta por chat, e a criacao possui limites atomicos de volume ativo e diario;
- a retencao de conversas excluidas logicamente deve ser informada na politica de privacidade e usada com acesso administrativo minimo. Analises de demanda devem preferir dados agregados ou anonimizados e nao expor perguntas individuais fora das finalidades autorizadas;
- tabelas de transcricao, chunks, configuracao e conversa nao concedem acesso direto a `anon` ou `authenticated`; o `service_role` permanece somente no servidor;
- cada chave de Gemini, OpenAI e Anthropic e gravada no Supabase Vault por funcoes restritas ao `service_role`; somente uma dica mascarada retorna ao CRM;
- logins por conta ficam no volume privado do Bunker AI Gateway e nunca no navegador do aluno ou nas tabelas de conversa. O app acessa runtime e gestao com credenciais diferentes em `BUNKER_AI_GATEWAY_API_KEY` e `BUNKER_AI_GATEWAY_MANAGEMENT_KEY`;
- `BUNKER_AI_GATEWAY_URL` deve usar HTTPS fora de localhost, sem credenciais, query ou fragmento na URL. As tres variaveis do gateway sao segredos server-side e nao podem usar prefixo `NEXT_PUBLIC_`;
- em desenvolvimento, o Compose do gateway publica somente `127.0.0.1:8317`, executa sem capabilities e com `no-new-privileges`, usa filesystem raiz somente leitura e persiste apenas `/data/auth`. As chaves de runtime e gestao precisam ser distintas, URL-safe e ter no minimo 32 caracteres;
- `.env.local` e `.env.bunker-ai-gateway.local` sao arquivos locais ignorados pelo Git. O volume `bunker707-ai-gateway-auth` nao deve ser removido durante um deploy ou parada normal, pois contem os logins renovaveis das contas;
- o Compose local limita CPU, memoria, processos e rotaciona logs. Ele nao e a topologia de producao: um backend implantado precisa do gateway persistente na mesma rede privada e nao pode depender do `127.0.0.1` do computador do produtor;
- `/v0/management/oauth-callback` no upstream e protegido pelo `state`, mas nao pelo middleware da chave administrativa. Loopback no desenvolvimento e rede privada/allowlist em producao sao requisitos obrigatorios para essa rota;
- sessoes de conexao de conta pertencem ao administrador que iniciou o fluxo, expiram rapidamente e validam `state`. A primeira etapa apenas identifica a conexao e cria a tentativa; ela nao abre automaticamente o provedor. No passo seguinte, o administrador escolhe abrir o OAuth ou copiar seu endereco para outra janela ou perfil proprio. O link continua temporario e nao deve ser compartilhado. A URL colada de retorno aceita somente HTTP local sem usuario/senha e precisa conter `code` ou `error`;
- conectar uma assinatura pessoal por gateway e uma integracao experimental, nao uma cota de API oficialmente concedida pelo plano de consumidor. Antes de producao, o produtor deve validar termos de uso, limites, risco de bloqueio e um caminho de reautenticacao; API oficial continua sendo a opcao operacional mais previsivel;
- conexoes pausadas, em cooldown ou com erro de autenticacao ficam fora do pool normal. O balanceador registra apenas IDs, resultado, codigo sanitizado e tempos das tentativas, seleciona a proxima conexao elegivel e nunca inclui token ou segredo em `provider_attempts`;
- endpoints dos provedores sao fixos nos adapters, evitando URL arbitraria e SSRF; falhas de rede sao sanitizadas para que a URL do Gemini com a chave nunca apareca em log ou resposta;
- cada pergunta usa identificador idempotente, limite por aluno nas ultimas 24 horas, limite mensal da plataforma, limite de contexto e limite de tokens de resposta;
- prompts do tutor permitem somente a transcricao/chunks da aula autorizada. A IA recebe cues com identificadores opacos e nao recebe autorizacao para calcular horarios; o servidor valida a correspondencia textual, resolve SRT/VTT/YouTube no tempo real com margem de 3 segundos para tras e deixa tempos nao verificados sem clique. TXT usa referencias por trecho;
- eventos do tutor registram tamanho, provider, modelo e tokens, nunca o texto da pergunta/resposta nos metadados de analytics;
- o dashboard de consumo e exclusivamente administrativo. Consumo por aluno e ranking devem respeitar periodo e filtro de agente, nao podem virar pontuacao pedagogica e nao autorizam expor perguntas individuais; consultas e exportacoes devem aplicar minimizacao, retencao e controle de acesso;
- conversas e feedbacks futuros devem respeitar LGPD, retencao e exportacao/remocao quando aplicavel.

## Video

Nao expor arquivo original.

Requisitos:

- playback com token temporario;
- controle de permissao antes de entregar URL;
- thumbnails e duracao vindas do provedor;
- logs de acesso quando possivel.

Modo TV:

- `/tv` e uma rota publica somente para permitir o pareamento em outra tela; sem codigo valido ou token de receptor ela nao recebe nenhuma aula;
- a criacao da sessao exige usuario autenticado, ownership e `requireLessonAccess`; todas as consultas do controle remoto exigem novamente o usuario dono;
- o codigo de seis caracteres expira em dez minutos, e consumido uma unica vez e nao pode reconectar outro aparelho depois que a sessao muda para `connected`;
- o token do receptor usa entropia criptografica, e enviado uma unica vez, fica apenas em `sessionStorage` na TV e e armazenado no Supabase somente como SHA-256;
- a sessao completa expira em quatro horas e pode ser encerrada pelo aluno. APIs e pagina usam `no-store`, e `tv_sessions` nao concede privilegios diretos a `anon` ou `authenticated`;
- rotas de legenda e streams manuais da TV exigem o bearer token do receptor, revalidam a sessao e o entitlement antes de resolver a midia e nunca usam cache. A legenda (na TV e no player principal) le primeiro a transcricao guardada da aula, sempre depois da checagem de acesso, e so entao consulta o YouTube. Em qualidade manual, as URLs temporarias do `googlevideo` chegam ao navegador da TV e conservam as mesmas limitacoes de observabilidade e ausencia de DRM do player principal;
- o QR aponta apenas para a rota da Bunker707 com o codigo temporario. Apos o pareamento, o receptor YouTube ainda precisa do ID canonico para tocar o embed; esse ID continua observavel e nao deve ser descrito como ocultacao absoluta, streaming protegido ou DRM;
- o desenho atual e um controle remoto Bunker707 por polling e heartbeat, nao implementacao de Chromecast ou AirPlay nativo.

## LGPD

Pontos de atencao:

- coletar somente dados necessarios;
- informar uso de dados;
- registrar consentimentos quando aplicavel;
- permitir exportacao/remocao futura de dados pessoais;
- distinguir a organizacao do historico (`Excluir chat`, soft delete) do exercicio do direito de exclusao: o segundo precisa apagar ou anonimizar tambem conversas retidas para analise quando aplicavel;
- mascarar dados sensiveis em logs;
- cuidado com session replay e campos pessoais.

## Observabilidade

Ferramentas (fase 0 de `docs/17-admin-produtor-redesign.md`):

- Vercel Speed Insights para Web Vitals reais por rota (sempre ligado);
- Sentry para erros e uma amostra de performance (opcional, por variavel de ambiente);
- PostHog para analytics de produto (opcional, por variavel de ambiente);
- logs estruturados no servidor;
- tabela de auditoria para acoes sensiveis.

Regra de carregamento: sem as variaveis do Sentry e do PostHog, o navegador nao baixa nenhum codigo nem faz nenhuma requisicao para esses servicos, e a CSP nao muda. O unico script de observabilidade sempre presente e o do Speed Insights.

### Variaveis de ambiente

Todas estao em `.env.example`, sem valores. Variaveis `NEXT_PUBLIC_*` entram no bundle no build: depois de alterar, e preciso novo deploy.

| Variavel | Onde e lida | Vazia |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | `src/app/layout.tsx`, `src/components/analytics/posthog-analytics.tsx`, `proxy.ts` (CSP) | PostHog desligado: o layout nao le a sessao para analytics e `posthog-js` nunca e baixado |
| `NEXT_PUBLIC_POSTHOG_HOST` | `src/components/analytics/posthog-analytics.tsx`, `proxy.ts` (CSP) | `https://us.i.posthog.com` (UE: `https://eu.i.posthog.com`) |
| `SENTRY_DSN` | `src/instrumentation.ts`, `src/sentry.server.config.ts`, `src/sentry.edge.config.ts` | usa `NEXT_PUBLIC_SENTRY_DSN`; as duas vazias = SDK nem e importado no servidor |
| `NEXT_PUBLIC_SENTRY_DSN` | `src/instrumentation-client.ts`, `proxy.ts` (CSP) | Sentry desligado no navegador e fora da CSP |
| `SENTRY_ENVIRONMENT` | configs de servidor e edge | `VERCEL_ENV` ou `NODE_ENV` (no navegador: `NEXT_PUBLIC_VERCEL_ENV` ou `NODE_ENV`) |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | ainda nao usadas | reservadas para `withSentryConfig` e upload de source maps; o token e segredo de build e nunca leva prefixo `NEXT_PUBLIC_` |

A chave do PostHog e o DSN do Sentry sao publicos por natureza (vao para o navegador); nenhum deles autoriza leitura de dados. Tokens de API do PostHog e o `SENTRY_AUTH_TOKEN` sao segredos e nao entram no app.

### O que cada ferramenta coleta

**Vercel Speed Insights** (`src/components/analytics/speed-insights.tsx`, no layout raiz):

- coleta LCP, INP, CLS, FCP e TTFB por rota, com tipo de dispositivo e de conexao;
- a URL enviada perde query string e fragmento (`beforeSend`), entao `?code=` do login e `#access_token=` de convites nunca saem do navegador;
- nao usa cookies nem identifica o aluno;
- precisa ser ativado no painel do projeto na Vercel; fora da Vercel o script em `/_vercel/speed-insights` responde 404 sem afetar a pagina.

**Sentry, servidor** (`src/instrumentation.ts` + `src/sentry.server.config.ts` / `src/sentry.edge.config.ts`):

- `register()` so importa o SDK quando ha DSN, sem custo de cold start quando desligado;
- `onRequestError` envia erros de Server Components, Route Handlers, Server Actions e do `proxy.ts`;
- `tracesSampleRate: 0.1` (10% das requisicoes viram trace);
- o SDK 11 coleta cookies, cabecalhos, corpos e query strings por padrao. A configuracao (`dataCollection`) desliga cookies, corpos de request e resposta, query strings, variaveis locais de stack, dados de consultas ao banco, dados de fila, GraphQL e entradas/saidas de IA (prompts do Tutor e da IA Diretor), alem de `userInfo` (IP e usuario automaticos). Cabecalhos de request so em allowlist: `user-agent`, `content-type`, `accept-language`, `x-vercel-id`; os demais chegam como `[Filtered]`.

**Sentry, navegador** (`src/instrumentation-client.ts`):

- import dinamico so com `NEXT_PUBLIC_SENTRY_DSN`. O SDK inicia logo depois da hidratacao, nao antes: um erro muito precoce pode nao ser capturado, em troca de zero peso para quem nao configurou;
- coleta erros nao tratados, breadcrumbs (cliques, navegacao, fetch, console) e 10% das navegacoes como trace (`onRouterTransitionStart`);
- sem Session Replay e sem widget de feedback;
- URL do evento e URLs de breadcrumbs perdem query string e fragmento; cookies, corpos, `Referer` e dados de usuario nao sao enviados;
- mensagens de erro vao como foram escritas: nunca montar mensagens de erro com e-mail, nome, telefone ou token.

**PostHog** (`src/components/analytics/posthog-identity.tsx` + `posthog-analytics.tsx`, no layout raiz):

- so com `NEXT_PUBLIC_POSTHOG_KEY`. O layout raiz le o usuario dentro de `<Suspense>` com `getAuthenticatedUser()` (memoizado por request, entao paginas protegidas nao pagam outra validacao) e passa ao navegador apenas o `auth.users.id`;
- `posthog-js` e baixado depois da hidratacao com `defaults: '2026-08-30'`;
- coleta `$pageview` a cada troca de rota do App Router (`capture_pageview: 'history_change'`), `$pageleave`, cliques por autocapture com o texto dos elementos mascarado (`mask_all_text`), navegador, sistema, tamanho de tela e origem (`utm_source`, `utm_medium`, `utm_campaign`);
- identidade: `identify(auth.users.id)` quando ha sessao, nunca e-mail ou nome; `person_profiles: 'identified_only'` (anonimo nao gera perfil); sem sessao, uma identidade anterior e descartada com `reset()` (logout);
- `before_send` remove query string (exceto os tres `utm_*`), fragmento e credenciais de toda propriedade com URL (`$current_url`, `$referrer`, `$initial_*`);
- desligados: gravacao de sessao, surveys, product tours, conversations e captura de excecoes (erros ficam no Sentry);
- persistencia padrao do SDK (`localStorage` + cookie primario `ph_<chave>_posthog`), que deve constar na politica de privacidade;
- no projeto do PostHog: ligar "Discard client IP data" e alinhar a retencao a decisao D8 de `docs/17` (24 meses);
- eventos de dominio (catalogo tipado em `src/server/events`, espelhados com `$insert_id`) e `posthog-node` no servidor entram com o catalogo de eventos; o heartbeat de video nunca vai ao PostHog.

Custo conhecido com o PostHog ligado: como o layout raiz le a sessao, `/tv` deixa de ser pre-renderizada e paginas publicas (`/login`, `/tv`) fazem um `getUser()` a mais. A leitura fica em `<Suspense>` e nao atrasa o HTML inicial.

### CSP

O `proxy.ts` so acrescenta hosts quando a variavel correspondente existe:

- `connect-src`: origem de `NEXT_PUBLIC_POSTHOG_HOST` (padrao `https://us.i.posthog.com`) e, nas regioes gerenciadas, o host de assets (`https://us-assets.i.posthog.com` ou `https://eu-assets.i.posthog.com`); origem de ingestao derivada do `NEXT_PUBLIC_SENTRY_DSN` (por exemplo `https://o123.ingest.us.sentry.io`, sem a chave);
- `script-src`: host de assets do PostHog. Com `'strict-dynamic'`, navegadores modernos ignoram a lista de hosts e confiam nos scripts carregados pelo bundle com nonce; o host fica listado para navegadores sem CSP 3;
- Speed Insights usa o proprio dominio (`/_vercel/speed-insights`) em producao; em desenvolvimento o script de debug vem de `va.vercel-scripts.com`, liberado pelo `'strict-dynamic'`;
- proxy reverso do PostHog e `tunnelRoute` do Sentry estao fora do escopo desta fase.

### Verificacao

- sem as variaveis: na aba Network so aparece o script do Speed Insights; nenhuma requisicao para `posthog.com` ou `sentry.io`; a CSP e a mesma de antes;
- com as variaveis, num Preview da Vercel: `$pageview` aparece em Live events com `distinct_id` igual ao UUID do aluno e URL sem query; um erro de teste aparece no Sentry sem cookies nem corpo;
- rodar `next build` com `SENTRY_DSN` definido num Preview antes de promover, porque o SDK do servidor ainda nao passou por build com DSN nesta fase.

### Pendencias de observabilidade

- envolver `next.config.ts` com `withSentryConfig` (source maps, release e instrumentacao automatica);
- criar `src/app/global-error.tsx` chamando `Sentry.captureException` para erros de renderizacao no cliente;
- `Server-Timing` (auth/db/render), orcamento de bundle e Lighthouse CI, conforme `docs/17` 2.8.

Eventos criticos:

- login;
- alteracao de senha;
- criacao ou reenvio de acesso por convite;
- criacao de senha temporaria pelo admin;
- liberacao/revogacao de acesso;
- webhook processado;
- falha de webhook;
- aula concluida;
- erro de video.

## Backups

Responsabilidades:

- Supabase Postgres: backup automatico do plano escolhido (nuvem) ou `infra/scripts/backup.sh` (Hetzner);
- exports periodicos para seguranca;
- assets e materiais em storage com politica de backup;
- videos no provedor com estrategia de recuperacao.

Na Hetzner (docs/20, secao 10): backup diario as 03:30 UTC pelo timer `infra/systemd/bunker707-backup.timer`, criptografado pelo restic num Storage Box via SFTP, com retencao de 30 snapshots diarios. Cada snapshot leva o banco inteiro (`pg_dump` por partes e em formato custom, de dentro do container do Postgres), a chave raiz do Vault, o `.env` do stack e os arquivos do Storage. `infra/scripts/restore.sh` restaura num servidor limpo e termina no teste de fumaca; a regra e ensaiar a restauracao a cada trimestre e depois de toda mudanca no stack.

Capas publicas em `content-assets` usam nomes deterministas por hash e cache longo. Isso reduz duplicacao, mas nao substitui politica de backup/versionamento do Storage.

## Operacao inicial

Ambiente minimo:

- development;
- production.

Ambiente recomendado depois:

- development;
- staging;
- production.

Checklist de producao:

- dominio configurado;
- SSL ativo;
- variaveis de ambiente separadas;
- Sentry ativo;
- PostHog ativo;
- backups conferidos;
- RLS revisado;
- Supabase Auth configurado;
- primeiro usuario interno cadastrado em `admin_roles`;
- webhooks com segredo;
- pagina de erro amigavel;
- suporte funcional.

Servidor proprio na Hetzner: o runbook `docs/20-runbook-hetzner.md` cobre criacao do servidor, `bootstrap.sh` (SSH so com chave, ufw com Docker, fail2ban, atualizacoes automaticas), firewall da Hetzner (22 so do produtor, 80/443 so da Cloudflare), Studio atras de allowlist de IP e usuario/senha, primeiro deploy, deploy de nova versao, monitoramento externo (Better Stack ou Uptime Kuma fora do servidor), incidentes e a lista de diferencas para a nuvem (sem MCP do Supabase, sem previews, sem PITR). O checklist de seguranca do servidor esta na secao 16 do runbook.

Achado de 17/10/2026 (ensaio da infra): o `proxy.ts` na raiz nao e compilado pelo Next 16.4 quando o app esta em `src/app` (o Next so procura `src/proxy.ts`); a CSP com nonce e o redirecionamento na borda descritos na secao CSP nao estao ativos em nenhum build hoje. Correcao pendente em PR propria (mover para `src/proxy.ts` com teste de comportamento do cabecalho).

## Importacao de playlist

- exigir `requireApiAdmin` no preview e na gravacao;
- limitar o corpo das requisicoes mesmo quando `Content-Length` estiver ausente;
- nunca enviar a chave da API do YouTube ao navegador;
- reler metadados no servidor antes de persistir;
- no modo manual, tratar intervalos como intencao e rejeitar lacunas, sobreposicoes, modulos vazios e posicoes fora da playlist relida;
- limitar respostas externas, quantidade de paginas, tempo e numero de videos;
- aceitar somente IDs estritos e hosts fixos do YouTube;
- manter a `service_role` no servidor e restringir a RPC ao papel `service_role`;
- manter a tabela de importacoes com RLS sem acesso de `anon` ou `authenticated`;
- importar sempre como rascunho e sem conceder entitlement;
- sincronizar por IDs deterministas, arquivando ausencias sem exclusao automatica.

## Cadastro manual e senha temporaria

Regras:

- convite por email e o fluxo preferencial para novos alunos;
- senha temporaria existe apenas para suporte/onboarding e deve exigir troca no primeiro login;
- senha temporaria nao deve ser salva em banco, logs, historico do CRM ou metadata;
- `service_role` so pode ser usado na rota server-side administrativa;
- a tela `/alterar-senha` limpa `must_change_password` somente depois de atualizar a senha do usuario;
- remover aluno ou produto do acesso manual no CRM deve marcar os entitlements `admin-student:*` como `revoked`, sem apagar eventos ou payloads externos;
- o admin deve enviar senha temporaria por canal de atendimento controlado, evitando expor senha permanente por email.

## Recuperacao de senha e e-mails do Auth

Fluxo do "Esqueci minha senha" no `/login`: o navegador chama `resetPasswordForEmail` (PKCE), o e-mail leva a `/auth/callback?code=...&next=/alterar-senha&provider=email`, o servidor troca o codigo por sessao e a pessoa define a senha em `/alterar-senha`.

Regras e armadilhas (verificadas em 2026-10-11 no projeto `hrtnqcznhdmodjikvddm`):

- cada pedido grava um codigo de verificacao novo no navegador antes de chamar o Supabase, mesmo quando o pedido falha; um segundo clique invalida o link do e-mail anterior (erro `code challenge does not match previously saved code verifier` no `/token`). Por isso o botao trava enquanto envia e por 1 minuto depois do envio (`src/lib/auth/password-reset.ts`);
- o link precisa ser aberto no mesmo navegador em que foi pedido;
- o `?next=` (login, `/auth/callback`, troca de senha) so aceita caminho interno: `getSafeRedirectPath` (`src/lib/auth/redirect.ts`) recusa `//host`, barra invertida (`/\host` e `/%5Chost`, que o navegador le como outro site) e caracteres de controle, monta o caminho com o parser de URL e exige a mesma origem (`tests/auth-redirect.test.mjs`);
- quando a troca falha ou o Supabase volta com `?error_code=` (ex.: `otp_expired`), o callback manda para `/login?erro=link` e o login explica o que fazer; falha de login social vai para `?erro=oauth`;
- erros do Auth viram frases em portugues (`describePasswordResetError`); a mensagem tecnica nunca aparece na tela;
- o SMTP embutido do Supabase envia no maximo **2 e-mails por hora** por projeto (campo travado no painel) e so entrega para membros da organizacao. Estourar o limite devolve `429 over_email_send_rate_limit`. Antes de liberar alunos reais, configurar SMTP proprio em Authentication > Emails > SMTP Settings e ajustar o limite em Authentication > Rate Limits;
- convites gerados pelo painel do Supabase ou por `inviteUserByEmail` chegam com `#access_token=` (fluxo implicito), que o cliente PKCE do app recusa; ate o fluxo de convite migrar para `token_hash` + `verifyOtp`, contas de admin devem ser criadas em Authentication > Users > Create new user, e alunos convidados usam "Esqueci minha senha".

- Envio em massa (Reenviar convite na lista de Alunos, importacao com convite): depende de SMTP proprio com limite conhecido (hoje o Resend, configurado no painel do Supabase com a mesma chave de envio; Amazon SES na segunda rodada); sem ele, o Supabase hospedado entrega so para a equipe e poucos por hora. As rotinas param no primeiro 429 e marcam os e-mails como pendentes em vez de falhar as contas (`src/server/students/access.ts`). Os e-mails do proprio app (boas-vindas, compra) nao passam pelo Auth: saem pela fila da secao E-mail transacional.

## E-mail transacional (Resend)

Provedor atual: Resend (plano Free, decisao em `docs/19-infra-hetzner-e-email.md`, secao 2), atras do adaptador `src/server/email` (`docs/04`, secao E-mail transacional). Amazon SES fica para a segunda rodada, como outra implementacao do mesmo adaptador; o Resend continua como fallback. Dominio de envio `mail.bunker707.com.br` (subdominio proprio, para a reputacao transacional nao se misturar com a da raiz), remetente `Bunker707 <equipe@mail.bunker707.com.br>` e Reply-To em uma caixa real da raiz.

Regras:

- a chave do Resend tem so permissao de envio ("Sending access") e fica apenas no servidor (`RESEND_API_KEY` na Vercel e em `.env.local`); nunca em codigo, PR, log ou prefixo `NEXT_PUBLIC_`. Mensagens de erro guardadas em `email_outbox.last_error` sao curtas e vem da resposta do provedor, nunca do pedido;
- nenhum envio acontece na hora: tudo passa pela fila `email_outbox` e pelo job do tick, com limite diario (`EMAIL_DAILY_LIMIT`, padrao 90) para nao estourar os 100/dia do Free e com chave de idempotencia (um webhook de venda reprocessado nao manda o mesmo e-mail duas vezes);
- sem `EMAIL_PROVIDER=resend` e `RESEND_API_KEY`, nada sai: a fila espera com aviso no log e expira em 7 dias. Desenvolvimento local, previews e testes ficam assim; os testes usam um provedor falso e nunca enviam e-mail;
- o webhook do Resend (`POST /api/webhooks/resend`) exige `RESEND_WEBHOOK_SECRET` (sem ele responde 503) e verifica a assinatura Svix (`svix-id`, `svix-timestamp`, `svix-signature`, HMAC-SHA256 sobre o corpo bruto, janela de 5 minutos contra replay) antes de ler qualquer coisa; pedido sem assinatura valida responde 401 e nao grava nada. O payload bruto fica em `email_webhook_events`, unico por `svix-id`; bounce, reclamacao e falha marcam a linha da fila e nunca voltam atras. O Free tem 1 endpoint de webhook: apontar para o ambiente de producao;
- e-mails sao dado pessoal: a fila guarda e-mail, nome e o HTML montado. Retencao por idade e um item pendente (hoje a linha fica; a exclusao da conta so anula `user_id`);
- o texto dos e-mails diz como criar a senha, mas nunca carrega senha, link de sessao ou token: o link de criar senha continua saindo so pelo Supabase Auth.

### Variaveis de ambiente

Todas em `.env.example`, sem valores.

| Variavel | Onde e lida | Vazia |
|---|---|---|
| `EMAIL_PROVIDER` | `src/server/email/config.ts` | `none`: nada e enviado, a fila espera com aviso no log |
| `RESEND_API_KEY` | `src/server/email/provider.ts` (job do tick) | provedor vira `none` mesmo com `EMAIL_PROVIDER=resend` |
| `RESEND_WEBHOOK_SECRET` | `src/app/api/webhooks/resend/route.ts` | a rota responde 503 e nao grava nada |
| `EMAIL_FROM` | `src/server/email/config.ts` | `Bunker707 <equipe@mail.bunker707.com.br>` |
| `EMAIL_REPLY_TO` | `src/server/email/config.ts` | `contato@bunker707.com.br` (`none` desliga) |
| `EMAIL_DAILY_LIMIT` | `src/server/email/config.ts` | 90 por dia UTC (invalido volta ao padrao; `0` pausa o envio) |
| `NEXT_PUBLIC_SITE_URL` | `src/server/auth/site-origin.ts`, `src/server/email/transactional.ts` | links de convite e dos e-mails usam a origem do request |

Configuracao por ambiente, uma vez: criar a chave de envio e o endpoint de webhook no painel do Resend (eventos `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.delivery_delayed`) apontando para `https://<dominio>/api/webhooks/resend`; colar `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` e `EMAIL_PROVIDER=resend` na Vercel (Production; Preview so se quiser e-mail saindo de previews); o tick de jobs precisa estar ligado (secao Jobs de `docs/04`). Diagnostico: `select status, count(*) from public.email_outbox group by status;` e `select event_type, received_at, outbox_id, error from public.email_webhook_events order by received_at desc limit 20;`.

## Login e destaque configuraveis (Area de membros)

Desde 2026-10-11 o visual do `/login` e o topo da home sao editados no admin novo (Area de membros > Login e > Destaque) e gravados em `platform_settings` (`loginPage` e `hero`; formato em `docs/05`).

- `platform_settings` continua com RLS ligado e sem acesso para `anon`/`authenticated`: o `/login` le a configuracao no servidor, com a chave de servico, e entrega ao navegador so o que o componente desenha (textos, links e URLs de imagem). Nenhuma chave de provedor de auth fica nessa configuracao;
- gravar exige `storefront.write` (dono, administrador ou editor) na Server Action, alem da tela; analista e suporte so leem;
- a leitura do `/login` fica em cache (`unstable_cache`, tags `member-area-login` e `catalog`, 1 h). Falha de banco nao e guardada em cache: o login cai no visual padrao e tenta de novo na proxima visita. Publicar invalida na hora;
- links editaveis sao conferidos ao gravar e ao desenhar: a ajuda do login aceita so `https://` ou e-mail (vira `mailto:`), sem usuario/senha no link; o botao do destaque aceita caminho interno da area ou `https://`, e o que vier diferente (`javascript:`, `//host`, `/\host`, `http:`, `/api/...`) some da home, inclusive se tiver sido gravado pelo admin antigo ou por SQL. Link externo em nova aba abre com `rel="noopener noreferrer"`;
- imagens chegam ao banco so como URL: o recorte vira WebP no navegador, o servidor confere medida e peso pelo cabecalho do WebP e envia ao bucket `content-assets`; data URL, `http://` e `javascript:` sao recusados. Link de imagem colado (destaque, login, capa de produto, capa de modulo) tambem nao pode ter espaco, aspas, parenteses, `<`, `>` ou `\` (`imageLinkSchema`), e os cards do aluno desenham o fundo entre aspas e escapado (`cssImageUrl`): sem isso, uma capa `https://x/a.png);position:fixed;...` injetava CSS na home de todos os alunos;
- `?template=` no endereco do `/login` nao muda mais nada (antes qualquer visitante trocava o modelo pelo endereco);
- a previa do admin usa o proprio `LoginExperience` em modo `preview`: nao le nem cria sessao, nao envia formulario e nao redireciona. Quem esta logado e redirecionado ao abrir `/login`; para conferir o login publicado, use uma janela anonima.

## Equipe e permissoes

Desde 2026-10-15 o dono monta a equipe em Configuracoes > Equipe (`/admin/configuracoes/equipe`): funcoes prontas que se combinam, funcoes personalizadas e permissoes extras por pessoa. Tabela, regras e decisao de mercado em docs/17 §2.3.

- **Uma conta por pessoa.** Ninguem compartilha senha. Conta existente (um aluno, por exemplo) so ganha as funcoes. Conta nova e criada sem e-mail, as funcoes sao gravadas e so entao sai o link para criar a senha, para nunca mandar convite a quem nao entrou na equipe.
- **Menor privilegio e negar por padrao.** Cada area, tela, Server Action e rota confere a permissao no servidor. Permissao que vale so nos cursos da pessoa (a do Professor, por exemplo) so alcanca os cursos escolhidos: toda acao que pode valer por curso diz o que toca, e acao sem alvo e recusada. Permissao nova nunca entra sozinha numa funcao personalizada nem numa pessoa. Equipe e chaves de venda nunca entram numa funcao nem como extra.
- **Funcao personalizada muda para todos.** Mudar uma funcao muda as permissoes de todo mundo que a tem, na proxima requisicao; a lista de funcoes mostra quantas pessoas cada uma tem, e funcao com alguem nela nao e excluida. Funcao que sumiu do banco nao da nada, e erro ao ler as funcoes deixa a pessoa sem admin ate a leitura voltar.
- **Criar curso nao e vender curso.** Quem cria curso sem "Regras de acesso e venda" cria o curso fechado (so para quem tiver acesso), sem link de venda, fora de formacao e nao cria Formacao. Quem publica so nos proprios cursos nao publica uma formacao que levaria junto curso de fora da lista dele.
- **O que se abre sem compra.** Na area do aluno, a pessoa da equipe abre sem compra o que enxerga no catalogo do admin. O alcance do catalogo (`catalogScope` em `src/server/auth/roles.ts`) segue esta regra:
  - Alguma permissao de catalogo valendo na escola toda (montar aulas, criar cursos, editar os detalhes, acesso e venda, publicar, excluir ou ver os numeros): enxerga o catalogo inteiro no admin e abre todos os cursos sem compra.
  - Permissao de catalogo so nos cursos e nenhuma na escola toda (o Professor sozinho, por exemplo): so os cursos dela.
  - Nenhuma permissao de catalogo: quem so tem permissoes da escola toda (Suporte, por exemplo) enxerga tudo; quem tem alguma permissao so nos cursos (uma funcao so de comunidade por curso, por exemplo) ou ficou sem permissao porque a funcao nao abriu fica nos cursos dela.
  - Exemplo: Professor + Analista ve o catalogo inteiro e abre todos os cursos, porque "ver os numeros" vale na escola toda; Professor + Suporte ve so os cursos dele, porque o Suporte nao traz permissao de catalogo.
  - A Comunidade tem alcance proprio (`communityScope`), decidido so por responder e moderar: Professor + Suporte responde em todos os cursos, mas no catalogo continua so nos dele.
- **Dados pessoais e dinheiro.** Exportar CSV, excluir aluno e ver telefone sao permissoes separadas de "ver a lista". Exportar exige ver dados pessoais, porque o CSV leva telefone. Sem essa permissao, telefone e historico nem saem do servidor. Chaves das plataformas de venda (`settings.sales`) e a Equipe (`settings.team`) ficam so com o dono.
- **Conta da equipe nao muda por Alunos.** Adicionar aluno e "Enviar e-mail de acesso" recusam conta da equipe. Dados da equipe so o dono muda. Isso impede que alguem que libera acesso gere a senha do dono e entre como ele. Ao entrar na equipe, a senha antiga de uma conta que nunca entrou e trocada por uma aleatoria.
- **Dono protegido.**
  - Ninguem muda a propria funcao nem se remove.
  - A escola nunca fica sem dono: o servidor confere, e o gatilho `guard_last_admin_owner` confere de novo, com trava.
  - Apagar a conta do ultimo dono tambem falha.
- **Saida de alguem da equipe.** Tirar da equipe corta o admin na proxima requisicao, porque as permissoes sao lidas a cada requisicao. A conta continua como aluno; nao e preciso derrubar a sessao.
- **Area do aluno.** A equipe abre conteudo sem compra para conferir o que vende. Quem fica so nos proprios cursos pela regra acima (o Professor sozinho, por exemplo) so abre os cursos dele, e o "Ver como aluno" e so de quem ve o catalogo da escola toda.
- **Auditoria.** Adicionar, mudar funcoes, extras e cursos (antes e depois), tirar da equipe, reenviar convite e criar, mudar (antes e depois) ou excluir funcao personalizada gravam em `admin_audit_log`.
- **Recomendado antes de abrir a equipe para mais gente:**
  - ligar a 2FA (Supabase TOTP) e exigir `aal2` no `/admin`;
  - ligar a protecao contra senhas vazadas no Supabase Auth;
  - revisar a equipe a cada trimestre (a lista mostra o ultimo acesso).
