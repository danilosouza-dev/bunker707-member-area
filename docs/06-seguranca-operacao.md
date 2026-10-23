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
- o `proxy.ts` do Next.js (antigo `middleware.ts`) renova/valida sessao com `@supabase/ssr` nas paginas: `getUser()` por padrao ou `getClaims()` com `AUTH_SESSION_STRATEGY=claims`; `getSession()` nunca decide acesso no servidor. Em `/api/*` o proxy nao consulta o Auth: o handler valida e renova a sessao sozinho (`requireApiUser`/`requireApiRole`, que gravam o cookie renovado porque Route Handlers podem escrever cookies) ou exige token proprio (receptor da TV, tick de jobs, webhooks);
- com `claims`, uma sessao revogada e um `must_change_password` marcado depois do login so aparecem no proxy quando o JWT for renovado (ate 1 h); se o JWT ainda marca `must_change_password`, o proxy confirma com `getUser()` antes de redirecionar; ative `claims` primeiro no staging e so depois de migrar o projeto para signing keys assimetricas;
- paginas (desde 19/10/2026, decisao do produtor depois do teste de carga, docs/20 §12.1): as paginas de conteudo do aluno (home, curso, aula, favoritos, materiais, minha jornada, continue assistindo) usam `requireStudentPageUser`/`getSessionUser`, que com `claims` validam so o JWT (assinatura pelo JWKS em cache no processo) e nao chamam o Auth. Contrapartida aceita: conta apagada ou bloqueada e sessao revogada ("sair de todos os dispositivos", troca de senha) continuam vendo conteudo ate o JWT vencer (`JWT_EXPIRY`, 1 h). O acesso aos cursos nao muda: `entitlements` e lido do banco a cada pagina, entao reembolso ou acesso removido vale na hora. Admin, Minhas compras, Perfil, Suporte, troca de senha e as rotas `/api` seguem com `getUser()` (`requirePageUser`, `requireApiUser`), uma vez por request via `React.cache`. Excecao (21/10/2026, Comunicacao v2): os dois beacons de telemetria, `POST /api/notifications/[id]/audio` e `POST /api/page-visits`, usam `requireApiSessionUser` (o `getSessionUser` das rotas: so o JWT com `claims`, 401 `Sessao obrigatoria.`), porque so escrevem dados do proprio aluno, sao idempotentes e saem varias vezes por pagina; a mesma contrapartida (sessao revogada ate o JWT vencer). Sem `claims`, `getSessionUser` e o proprio `getUser()`;
- `profiles`, `entitlements`, `student_events`, `lesson_progress`, `admin_roles`, `admin_functions` e todas as tabelas de comentarios/moderacao possuem RLS; as da Comunicacao (`campaigns`, `notifications`, `campaign_deliveries`, desde 20/10/2026; `communication_flows`, `communication_flow_nodes`, `communication_flow_runs`, `communication_flow_tasks` e `member_page_visits`, desde 21/10/2026) tambem, sem nenhuma policy para `anon`/`authenticated` (secao Comunicacao);
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

- o token da Hotmart (hottok) nao e variavel de ambiente: o dono cola em Configuracoes > Vendas (`settings.sales`, so o dono) e o que fica em `integration_settings.secret` (tabela so de `service_role`) e o **SHA-256** do token (`src/server/payments/secret.ts`); um dump ou backup que vaze nao permite forjar uma venda. Token guardado em texto puro (formato de antes do hash) faz a rota responder 503 e o cartao pedir "troque o token", nunca um 401 silencioso. A tela nunca recebe o token de volta (so `secret_status` e a data); trocar grava por cima; Desconectar apaga. Nenhuma variavel nova em `.env.example` nem na Vercel. Depois de qualquer suspeita de vazamento do token (ele continua existindo no painel da Hotmart), trocar o hottok la e colar o novo na tela;
- sem token guardado a rota responde 503 e nao grava nada; token errado ou ausente responde 401 e nao grava nada. A conferencia e em tempo constante (SHA-256 do token recebido contra o hash guardado, `timingSafeEqual`), pelo cabecalho `X-HOTMART-HOTTOK` ou pelo `hottok` do corpo. Nao ha limite de taxa proprio na rota: pedido anonimo custa uma leitura do hash e o parse do corpo (ate 256 KB) antes do 401; se aparecer abuso, a regra entra no firewall da Vercel/Caddy para `/api/webhooks/*`;
- do payload so ficam em `webhook_events` os campos permitidos (envelope; produto; compra; assinatura; do comprador, e-mail, nome e telefone): documento, endereco, afiliados, comissoes e o token nunca sao gravados, e evento que nao muda acesso guarda so o envelope. O e-mail e mascarado no servidor (`c***@dominio`): o inteiro nao vai para o navegador. "Excluir aluno" anonimiza as vendas dele (e-mail nulo, payload so com o envelope). E dado pessoal: 12 meses depois, a rotina de retencao (secao LGPD) troca o payload por `{}` e anula o e-mail e o erro; a linha fica com o resultado, o id da transacao e o tipo do evento (o reembolso antigo continua barrando a compra reenviada), a tela mostra "Dados apagados (12 meses)" e nao oferece Reprocessar;
- idempotencia por (`provider`, `external_event_id`); evento repetido responde 200 sem reprocessar. Entitlements usam `source_provider = hotmart` e `source_event_id` = id da compra;
- a regra de acesso (`src/server/payments/process-sale.ts`) so libera o que `sales_product_links` liga ao codigo da plataforma, pela mesma rotina do admin (`src/server/students/access.ts`). Codigo sem ligacao, pacote em rascunho ou pausado (so na compra), evento que nao muda acesso e aluno sem conta sao ignorados com o motivo, nunca liberam nada. Compra que ja tem reembolso ou chargeback registrado nao libera (reprocesso ou reenvio fora de ordem). Fim da garantia (`PURCHASE_COMPLETE`) libera so para quem nunca teve acesso ao produto e nunca reabre acesso suspenso ou revogado. Nenhuma venda libera acesso sem registrar o vinculo venda -> acesso (`sale_grants`, docs/05; sem a tabela, o evento fica com erro). Reembolso, chargeback e assinatura cancelada decidem cada acesso pelo historico inteiro dos vinculos dele, em qualquer ordem de chegada: revogam (ou suspendem) o acesso que a venda abriu (todos os produtos do pacote, mesmo com o pacote pausado), inclusive a renovacao de assinatura que chega como compra nova; mantem o acesso que outra compra paga ainda sustenta (produto comprado sozinho e depois num pacote) ou que veio da equipe sem prazo; devolvem o prazo quando as vendas so tinham estendido um acesso da equipe com data de fim (resultado "Prazo devolvido"), tambem para assinaturas (cobrancas de uma assinatura nao se sustentam entre si, mas nunca fecham o que a equipe deu). A equipe que revoga, suspende, reativa ou reabre um acesso fecha os vinculos dele: a partir dali so uma compra nova manda, e o reembolso dela fecha so o que ela abriu. Alguem que compra, assina ou cancela com o e-mail de outro aluno nao tira o acesso pago dele. Cancelamento com codigo de assinatura sem cobranca registrada e ignorado com o motivo (nao adivinha pelo produto). A regra age primeiro e fecha os vinculos depois: uma falha no meio deixa tudo para o reprocesso refazer;
- falha de verdade (evento sem e-mail valido, banco) responde 500, fica `failed` com o motivo e marca a plataforma como "Precisa de atencao", que dura enquanto houver qualquer venda com erro ou presa (um evento certo logo depois nao a esconde; a tela e o hub conferem ao vivo e marcam a plataforma mesmo sem evento novo); o dono reprocessa pela tela (`reprocessSalesEvent`, auditado). Reprocessar tambem vale para o que foi ignorado (ex.: codigo ligado depois da venda) e para o que ficou preso em `received` ha mais de 5 minutos (a funcao estourou o tempo depois de gravar), que tambem conta em "Precisa de atencao"; o reenvio da propria plataforma retoma esse caso sozinho, por update condicional, depois de 45 s, e antes disso recebe 409 para tentar de novo (nunca "entregue"). Reprocessar e reenvio usam a mesma trava: dois ao mesmo tempo, um recebe 409;
- toda mudanca na tela vai para `admin_audit_log` (`sales.secret_saved`, `sales.disconnected`, `sales.event_reprocessed`) sem o token;
- corpo limitado a 256 KB (413 acima), runtime Node. Processamento sincrono: a Hotmart reenvia quando a resposta nao e 2xx, e o evento repetido para no 200 `duplicate`.

Configuracao por ambiente, uma vez, e SO pelo endereco de producao (`NEXT_PUBLIC_SITE_URL` definida; a tela avisa quando ela falta ou quando o admin esta aberto por outro endereco, como uma previa da Vercel, cujas vendas bateriam na protecao do preview): em Configuracoes > Vendas, copiar o endereco mostrado (origem do site + `/api/webhooks/hotmart`), cadastrar na Hotmart (Ferramentas > Webhook, versao 2.0.0) com os eventos listados na tela (compra aprovada, compra concluida, reembolso, chargeback, assinatura cancelada), colar o hottok e salvar; informar o codigo da Hotmart em cada produto (Acesso e venda) ou pacote. Antes de um lancamento com muitas vendas no mesmo dia, lembrar da cota do Resend Free (100 e-mails/dia, compartilhada com o Auth): cada comprador novo gasta boas-vindas + compra pela fila e, se pedir "Esqueci minha senha", mais um pelo Auth; passar o Resend para o Pro ou baixar `EMAIL_DAILY_LIMIT` para reservar cota ao Auth (`docs/15`). Diagnostico: `select provider, status, secret_status, last_sync_at, last_error from public.integration_settings;` e `select event_type, processing_status, outcome, outcome_detail, received_at from public.webhook_events order by received_at desc limit 20;`.

### Vendas pela Ticto (17/10/2026)

`POST /api/webhooks/ticto`, pelo mesmo fluxo e com as mesmas regras da Hotmart acima (token no banco e nunca em variavel de ambiente, 503 sem conexao, 401 sem gravar, idempotencia, regra de acesso unica, ignorado com motivo, `failed` + Reprocessar, auditoria, 256 KB, processamento sincrono). O que muda:

- o token da Ticto vem **so no corpo**, no campo `token` (referencia oficial: https://webhook.ticto.dev/docs/v2). Nao ha cabecalho nem assinatura HMAC: a protecao e o segredo do token, conferido em tempo constante. Por isso o endereco do webhook so deve ser cadastrado na Ticto, e o token trocado (Trocar token) se vazar;
- o token da Ticto fica guardado como SHA-256, no mesmo formato do hottok (`secret.ts`); o banco nunca guarda o token;
- o payload guardado fica so com os campos permitidos (envelope, pedido, transacao, produto e oferta, bumps, assinaturas e nome, e-mail e telefone do comprador). O `token`, o `direct_login_url` (link de entrada direta na area da Ticto, que funciona como credencial do comprador), o CPF/CNPJ, o endereco, o cartao, o produtor, os afiliados e as comissoes nunca sao gravados; o e-mail e o nome seguem a retencao de `webhook_events`;
- reembolso, chargeback e cancelamento da Ticto seguem o vinculo venda -> acesso (`sale_grants`): so mexem no que aquela venda abriu na Ticto, inclusive os order bumps, nunca no acesso pago na Hotmart ou liberado pela equipe. O cancelamento fecha a assinatura inteira (`subscriptions[].id`);
- reativacao de assinatura (`uncanceled`) nao e compra nova: so reabre o acesso cujo vinculo desta transacao foi fechado pelo cancelamento. Se a equipe revogou, suspendeu ou reabriu o acesso depois (vinculo fechado por `admin`), ou se nao ha cancelamento registrado, a reativacao fica "Ignorado" com o motivo e o acesso fica como esta; um reembolso ou chargeback depois tambem nao mexe nele. Assinatura com reembolso ou chargeback em qualquer cobranca tambem nao volta por reativacao (decisao de 17/10): na Ticto, reembolso e chargeback de uma cobranca encerram a compra, e uma reativacao depois disso nao e pagamento novo; o acesso fica fechado e a equipe decide em Alunos. A reativacao que falha no meio (vinculo ja reaberto, acesso ainda fechado) termina no Reprocessar. Um cancelamento que chega depois de um reembolso ou chargeback nao rebaixa o acesso revogado para suspenso;
- order bump numa compra de assinatura e tratado como cobranca unica (decisao de 17/10): so o item principal leva o codigo da assinatura. O cancelamento da assinatura suspende o principal e mantem o bump; reembolso e chargeback da compra tiram os dois. Motivo: a referencia do webhook 2.0 nao liga `subscriptions[]` a produtos, e os bumps chegam com preco da oferta (`offer_price`), sem dados de recorrencia; suspender um produto pago uma vez seria pior do que deixar aberto um bump recorrente, que ainda sai no reembolso. Se a Ticto passar a cobrar bump recorrente, rever;
- pedido com o produto principal sem codigo ligado e um bump ligado: a venda fica "Acesso liberado" pelo bump, e o detalhe diz que o principal nao foi liberado. Ligar o codigo depois nao reprocessa essa venda (Reprocessar so vale para erro, ignorado ou preso); a equipe libera o principal a mao em Alunos;
- a Ticto nao manda id de evento: a idempotencia usa `transacao:produto:status:status_date` (sem data, um digest do payload sem o token; chave longa vira hash inteira, nunca cortada). O mesmo postback reenviado para no 200 `duplicate`;
- order bumps (`bumps`): cada produto vendido junto com codigo da Ticto ligado e liberado na mesma compra e tirado no mesmo reembolso ou chargeback; o que nao tem codigo ligado fica escrito no resultado da venda e nao libera nada;
- entitlements usam `source_provider = ticto` e `source_event_id` = `transaction.hash`; assinatura reativada (`uncanceled`) devolve o acesso suspenso pelo cancelamento, sem novo e-mail de compra (mesma chave de idempotencia da compra).

Configuracao por ambiente, uma vez: em Configuracoes > Vendas, no cartao da Ticto, copiar o endereco mostrado (origem do site + `/api/webhooks/ticto`); na Ticto, em Tictools > Webhooks, adicionar um webhook com esse endereco, versao 2.0 e formato JSON, marcar os eventos listados na tela (compra aprovada, assinatura reativada, reembolso, chargeback, assinatura cancelada), copiar o token que a Ticto gera e colar no cartao; informar o codigo da Ticto (id do produto) em cada produto (Acesso e venda) ou pacote, inclusive nos que a Ticto vende como order bump. O caminho do menu vem de guias de integradores e pode mudar no painel da Ticto; a referencia oficial nao o descreve.

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
- triggers registram criacao, resposta, reacao e denuncia em `student_events` sem copiar o corpo do comentario;
- a notificacao de resposta e mencao (desde 20/10/2026) guarda o trecho da resposta e o link da aula para quem foi respondido ou citado e some do sino quando a moderacao esconde ou exclui a resposta ou o comentario respondido; a mencao so vale para um autor da mesma conversa (secao Comunicacao).

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

### Retencao por idade (17/10/2026)

O que guarda dado pessoal fora do perfil do aluno perde esse dado sozinho, por idade, sem depender do tick de jobs: `public.prune_personal_data()` (migracao `202610170004`; tabelas em `docs/05`, secao Retencao de dados pessoais) roda todo dia as 06:23 UTC pelo pg_cron (`bunker707-personal-data-prune`), logo depois da limpeza do historico de jobs.

- vendas recebidas (`webhook_events`): 12 meses depois de recebidas (prazo de `docs/17` §2.4), a linha perde o payload, o e-mail do comprador e a mensagem de erro e ganha `anonymized_at`. Fica o resultado (plataforma, evento, acesso liberado/revogado, motivo, produto, aluno, datas), o id do evento, para o mesmo evento entregue de novo continuar barrado, e o id da transacao com o tipo do evento (migracao `202610170005`), para o reembolso ou chargeback antigo continuar barrando a compra reenviada. Nenhum dos dois e dado pessoal. A tela de Vendas lista a linha como "Dados apagados (12 meses)" e nao oferece Reprocessar; reprocessar pela acao responde 409 com o motivo;
- fila de e-mail (`email_outbox`): 90 dias depois de criada, a linha enviada perde destinatario, HTML, texto e erro; falha, bounce e reclamacao ficam 180 dias para diagnostico e depois perdem o mesmo. Linha ainda na fila depois de 180 dias vira `failed` ("Expirado pela retenção") e e anonimizada; o job nunca envia uma linha sem destinatario. Ficam tipo, aluno, assunto (fixo ou com o nome do produto), chave de idempotencia (um webhook reprocessado nao manda o e-mail de novo), status, datas e metadata (ids e rotulos);
- eventos brutos do Resend (`email_webhook_events`): apagados 90 dias depois de recebidos (o payload traz o destinatario; entrega, bounce e motivo ja ficaram na linha da fila);
- a funcao e idempotente e so o servidor (`service_role`) ou o proprio pg_cron a executam; `anon` e `authenticated` recebem `permission denied`. Nenhuma tela chama por enquanto. A exclusao da conta anula `user_id` nas duas tabelas; "Excluir aluno" tambem ja anonimiza na hora as vendas daquele aluno (e-mail nulo, payload so com o envelope; secao Vendas pela Hotmart), e a retencao completa o resto aos 12 meses. A fila de e-mail desse aluno so perde o dado pessoal pelos prazos acima.

Comunicacao (desde 20/10/2026, migracao `202610200001`): `public.prune_communication_history()` roda todo dia as 06:41 UTC (`bunker707-communication-prune`) e apaga notificacoes e estados de pop-up com mais de 24 meses (`docs/17` D8), menos os estados de pop-up ainda no ar ou pausado (la fica o "Não mostrar de novo" de quem ja viu; apagar faria o pop-up voltar); o sino so mostra 90 dias. Conta excluida leva as notificacoes e os estados de pop-up dela (cascade). Eventos e auditoria guardam so ids e contagens. Desde 21/10/2026 (migracao `202610200002`) a mesma rotina apaga tarefas de fluxo terminadas, passagens de fluxos encerrados ou excluidos e visitas de pagina com mais de 24 meses; as tarefas pendentes e as passagens de fluxos no ar ficam (garantem "uma vez por aluno"), e a conta excluida leva passagens, tarefas e visitas. Detalhe na secao Comunicacao abaixo e em `docs/05`.

Operacao: `select public.prune_personal_data();` roda agora e devolve quantas linhas mudaram; `select jobname, schedule, active from cron.job where jobname = 'bunker707-personal-data-prune';` confere o agendamento; `select cron.unschedule('bunker707-personal-data-prune');` pausa (rodar a migracao de novo agenda outra vez). Prazos novos sao mudanca de migracao, com o teste `tests/integration/retencao-de-dados-pessoais.test.mjs` ajustado.

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
| `NEXT_PUBLIC_POSTHOG_KEY` | `src/app/layout.tsx`, `src/components/analytics/posthog-analytics.tsx`, `src/proxy.ts` (CSP) | PostHog desligado: o layout nao le a sessao para analytics e `posthog-js` nunca e baixado |
| `NEXT_PUBLIC_POSTHOG_HOST` | `src/components/analytics/posthog-analytics.tsx`, `src/proxy.ts` (CSP) | `https://us.i.posthog.com` (UE: `https://eu.i.posthog.com`) |
| `SENTRY_DSN` | `src/instrumentation.ts`, `src/sentry.server.config.ts`, `src/sentry.edge.config.ts` | usa `NEXT_PUBLIC_SENTRY_DSN`; as duas vazias = SDK nem e importado no servidor |
| `NEXT_PUBLIC_SENTRY_DSN` | `src/instrumentation-client.ts`, `src/proxy.ts` (CSP) | Sentry desligado no navegador e fora da CSP |
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

Custo conhecido com o PostHog ligado: como o layout raiz le a sessao, paginas publicas (`/login`, `/tv`) fazem um `getUser()` a mais (nenhuma pagina e pre-renderizada de qualquer forma, por causa do nonce da CSP; ver a secao CSP). A leitura fica em `<Suspense>` e nao atrasa o HTML inicial.

### CSP

A CSP e montada por request em `src/proxy.ts` (nonce novo a cada pedido, `script-src 'self' 'nonce-...' 'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`), que tambem manda pagina protegida sem sessao para `/login?next=` com `Cache-Control: private, no-store`. O arquivo precisa ficar em `src/`: com o app em `src/app`, o Next 16 so compila `src/proxy.ts` e ignora em silencio um `proxy.ts` na raiz. Como saber se o proxy entrou no build: o resumo do `next build` traz a linha `ƒ Proxy (Middleware)` e `.next/server/functions-config-manifest.json` tem a entrada `/_middleware` com `runtime: "nodejs"` e o matcher (o `middleware-manifest.json` fica vazio mesmo com o proxy, porque so lista proxies no runtime Edge).

Em `/api/*` o proxy so acrescenta a CSP e o nonce e devolve o pedido, sem criar o cliente de sessao nem consultar o Supabase Auth (desde 17/10/2026; antes, cada pedido de API com cookie fazia um `getUser()` a mais que nao decidia nada, dobrando as chamadas ao Auth no poll e no heartbeat do Modo TV, no progresso, nos comentarios e no tutor). A decisao de acesso e, se preciso, a renovacao do cookie ficam no handler. `tests/proxy-rotas-de-api.test.mjs` chama o proxy com um cliente do Supabase falso e confere que nenhuma rota de API dispara `getUser()`/`getClaims()` enquanto uma pagina protegida com o mesmo cookie continua validando; o teste de ponta a ponta confere que rota de API com a sessao da aluna segue 200 com a CSP e que, sem sessao, e o handler quem responde 401. A renovacao tambem tem teste: em `tests/e2e/aluno-renova-sessao-nas-rotas-api.spec.ts`, a aluna com o token de acesso vencido chama `/api/guide/conversations`, recebe 200 e o cookie renovado (gravado pelo `setAll` de `src/server/auth/supabase.ts`), e o cookie novo vale na chamada seguinte.

`upgrade-insecure-requests` entra so em producao e so quando o pedido chegou em https (`x-forwarded-proto` ou o protocolo do pedido): numa pagina http (next start na propria maquina, testes de ponta a ponta) o WebKit/Safari aplica a diretiva ate em `127.0.0.1` e busca scripts, CSS e fontes por https, e a pagina fica sem hidratar; o Chromium isenta a propria maquina, por isso o problema so aparecia no WebKit.

Nonce por pedido exige renderizacao por pedido: o Next so carimba o nonce nos scripts de uma pagina renderizada na hora; uma pagina pre-renderizada no build sai sem nonce, o navegador bloqueia os scripts que revelam e hidratam o conteudo e a tela fica em branco (foi o que aconteceu com `/tv`, a unica pagina estatica, ao ligar o proxy). Por isso `src/app/layout.tsx` exporta `dynamic = "force-dynamic"` e o resumo do build nao pode ter nenhuma rota `○ (Static)`; o teste de ponta a ponta confere que `/tv` sai com o nonce do pedido no HTML. Foi o que aconteceu ate 17/10/2026; desde a correcao, `tests/e2e/visitante-barrado-na-borda.spec.ts` confere o 307 de `/` anonima e o cabecalho `Content-Security-Policy` com nonce em toda resposta, e `tests/deployment-security.test.mjs` recusa `proxy.ts` ou `middleware.ts` fora de `src/`.

A CSP de producao nao tem `'unsafe-eval'` (so o `next dev` acrescenta). O zod 4 testa `new Function("")` na primeira vez que monta um schema de objeto, para saber se pode compilar a validacao; o erro e tratado, mas o navegador registra a tentativa como violacao `script-src eval` e, com o DSN, manda para o Sentry. Desde 17/10/2026 `src/instrumentation-client.ts` liga o modo `jitless` do zod (o mesmo que `z.config({ jitless: true })`) antes de qualquer modulo do app, e o teste nem acontece. Ele grava direto em `globalThis.__zod_globalConfig`, onde o zod le a configuracao, sem importar o zod: so o admin usa zod no navegador, e o import colocaria cerca de 7 KB (comprimidos) de zod em toda tela do aluno. A validacao nao muda: com a CSP o zod ja caia no caminho sem compilacao. O servidor nao tem CSP e continua compilando. `tests/zod-sem-eval-no-navegador.test.mjs` quebra se uma versao nova do zod mudar onde le a configuracao, e `tests/e2e/visitante-barrado-na-borda.spec.ts` abre `/admin/configuracoes/vendas` com a sessao do produtor, coleta os eventos `securitypolicyviolation` desde antes do primeiro script e exige zero.

Os cabecalhos fixos ficam em `next.config.ts` (`Permissions-Policy`, `Referrer-Policy`, `Cross-Origin-Opener-Policy` e os demais). A `Permissions-Policy` bloqueia camera, captura de tela, localizacao, microfone e pagamento em todo o app; desde 20/10/2026 uma segunda regra para `/admin/:path*` (depois da global; o Next usa a ultima que define a mesma chave) libera `microphone=(self)`, so para a equipe gravar o audio de um aviso no navegador (Comunicacao > Avisos e pop-ups). A area do aluno continua com `microphone=()`. `tests/deployment-security.test.mjs` chama o `headers()` da configuracao e confere o valor efetivo nas duas areas.

O `src/proxy.ts` so acrescenta hosts quando a variavel correspondente existe:

- `connect-src`: origem de `NEXT_PUBLIC_POSTHOG_HOST` (padrao `https://us.i.posthog.com`) e, nas regioes gerenciadas, o host de assets (`https://us-assets.i.posthog.com` ou `https://eu-assets.i.posthog.com`); origem de ingestao derivada do `NEXT_PUBLIC_SENTRY_DSN` (por exemplo `https://o123.ingest.us.sentry.io`, sem a chave);
- `script-src`: host de assets do PostHog. Com `'strict-dynamic'`, navegadores modernos ignoram a lista de hosts e confiam nos scripts carregados pelo bundle com nonce; o host fica listado para navegadores sem CSP 3;
- Speed Insights usa o proprio dominio (`/_vercel/speed-insights`) em producao; em desenvolvimento o script de debug vem de `va.vercel-scripts.com`, liberado pelo `'strict-dynamic'`;
- `img-src` e `media-src`: `https:` e, so quando o Supabase e a propria maquina (testes de integracao e ponta a ponta), a origem `http://` dele; o `media-src` ganhou essa origem em 20/10/2026 para o audio dos avisos no Storage local tocar como as imagens ja apareciam;
- `report-uri`: com `NEXT_PUBLIC_SENTRY_DSN`, o navegador envia cada violacao de CSP ao endpoint de seguranca do Sentry derivado do DSN (`<origem de ingestao>/api/<projeto>/security/?sentry_key=<chave publica>`, `src/lib/sentry-csp-report-uri.ts`), e ela aparece no Sentry como evento "CSP"; sem o DSN, a violacao so aparece no console do navegador;
- quem ja tem sessao e abre `/login` ou `/auth/callback` com `?code=` (recuperacao de senha, magic link, OAuth) nao e mandado para a home: a pagina e o callback trocam o codigo pela sessao nova (o convite chega por `#access_token`, fragmento que o servidor nao ve, e continua caindo na sessao aberta; ver "Recuperacao de senha e e-mails do Auth"); sem `code`, o proxy devolve a pessoa ao destino de `?next=` (ou `/admin` para a equipe) montado pelo parser de URL, para a query do destino (`?lessonId=`) chegar inteira. O destino passa por `getSafeRedirectPath`, que recusa outro site, barra invertida e caminho que vira `//` depois de resolver `.` e `..` (`/.//evil.com`), e o proxy ainda confere que a URL montada tem a origem do pedido;
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

Achado de 17/10/2026 (ensaio da infra), corrigido no mesmo dia: o `proxy.ts` ficava na raiz e o Next 16.4 nao o compilava com o app em `src/app`, entao a CSP com nonce e o redirecionamento na borda da secao CSP nao estavam ativos em nenhum build (Mac, Docker e Vercel). O arquivo foi movido para `src/proxy.ts`; o teste de ponta a ponta `visitante-barrado-na-borda` e a conferencia de caminho em `deployment-security.test.mjs` impedem a volta. O `infra/scripts/smoke.sh` voltou a exigir 307 em `/`. Ao promover para a `main`, o passo obrigatorio e abrir um Preview da Vercel com o DevTools: `/` anonima redireciona, a resposta traz `Content-Security-Policy`, e o console fica sem violacao na home, na aula (YouTube e Bunny), no modo TV e nos uploads do admin. Uma violacao de CSP que nunca apareceu antes (script inline de terceiro, por exemplo) aparece no console do navegador; so chega ao Sentry se `NEXT_PUBLIC_SENTRY_DSN` estiver definido no ambiente, porque e dele que o proxy deriva a diretiva `report-uri` (secao CSP).

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
- convites gerados pelo painel do Supabase ou por `inviteUserByEmail` com o `{{ .ConfirmationURL }}` padrao chegam com `#access_token=` (fluxo implicito), que o cliente PKCE do app recusa. No servidor proprio (19/10/2026) os modelos de convite, recuperacao e link magico (`infra/compose/volumes/auth-templates`) apontam para `/auth/confirm?token_hash=...&type=...`, que confirma no servidor com `verifyOtp`, grava a sessao e leva convite e recuperacao a `/alterar-senha`, em qualquer navegador. Na nuvem (staging), enquanto os modelos do painel usarem `ConfirmationURL`, contas de admin sao criadas em Authentication > Users > Create new user e alunos convidados usam "Esqueci minha senha"; para igualar, trocar o link dos tres modelos no painel pelo mesmo `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=...`.

- Envio em massa (Reenviar convite na lista de Alunos, importacao com convite): depende de SMTP proprio com limite conhecido (hoje o Resend, configurado no painel do Supabase com a mesma chave de envio; Amazon SES na segunda rodada); sem ele, o Supabase hospedado entrega so para a equipe e poucos por hora. As rotinas param no primeiro 429 e marcam os e-mails como pendentes em vez de falhar as contas (`src/server/students/access.ts`). Os e-mails do proprio app (boas-vindas, compra) nao passam pelo Auth: saem pela fila da secao E-mail transacional.

## E-mail transacional (Resend)

Provedor atual: Resend (plano Free, decisao em `docs/19-infra-hetzner-e-email.md`, secao 2), atras do adaptador `src/server/email` (`docs/04`, secao E-mail transacional). Amazon SES fica para a segunda rodada, como outra implementacao do mesmo adaptador; o Resend continua como fallback. Dominio de envio `mail.bunker707.com.br` (subdominio proprio, para a reputacao transacional nao se misturar com a da raiz), remetente `Bunker707 <equipe@mail.bunker707.com.br>` e Reply-To em uma caixa real da raiz.

Regras:

- a chave do Resend tem so permissao de envio ("Sending access") e fica apenas no servidor (`RESEND_API_KEY` na Vercel e em `.env.local`); nunca em codigo, PR, log ou prefixo `NEXT_PUBLIC_`. Mensagens de erro guardadas em `email_outbox.last_error` sao curtas e vem da resposta do provedor, nunca do pedido;
- nenhum envio acontece na hora: tudo passa pela fila `email_outbox` e pelo job do tick, com limite diario (`EMAIL_DAILY_LIMIT`, padrao 90) para nao estourar os 100/dia do Free e com chave de idempotencia (um webhook de venda reprocessado nao manda o mesmo e-mail duas vezes);
- sem `EMAIL_PROVIDER=resend` e `RESEND_API_KEY`, nada sai: a fila espera com aviso no log e expira em 7 dias. Desenvolvimento local, previews e testes ficam assim; os testes usam um provedor falso e nunca enviam e-mail;
- o webhook do Resend (`POST /api/webhooks/resend`) exige `RESEND_WEBHOOK_SECRET` (sem ele responde 503) e verifica a assinatura Svix (`svix-id`, `svix-timestamp`, `svix-signature`, HMAC-SHA256 sobre o corpo bruto, janela de 5 minutos contra replay) antes de ler qualquer coisa; pedido sem assinatura valida responde 401 e nao grava nada. O payload bruto fica em `email_webhook_events`, unico por `svix-id`; bounce, reclamacao e falha marcam a linha da fila e nunca voltam atras. O Free tem 1 endpoint de webhook: apontar para o ambiente de producao;
- e-mails sao dado pessoal: a fila guarda e-mail, nome e o HTML montado. A exclusao da conta anula `user_id`; a retencao por idade (secao LGPD) anula destinatario, HTML, texto e erro 90 dias depois de criada a linha enviada (180 dias para falha, bounce, reclamacao e o que ficou na fila) e apaga os eventos brutos do Resend em 90 dias;
- o texto dos e-mails diz como criar a senha, mas nunca carrega senha, link de sessao ou token: o link de criar senha continua saindo so pelo Supabase Auth;
- desde 21/10/2026 a fila tambem leva o e-mail `sent_as` para a pessoa da equipe escolhida como remetente de uma notificacao ou de um fluxo (secao Comunicacao): so para quem ainda esta em `admin_roles`, nunca para quem publicou, endereco lido pelo `auth.admin.getUserById` no servidor, metadata so com ids e a contagem, botao para o admin so para quem tem `messaging.write`.

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

## Comunicacao (avisos, sino e pop-ups)

Desde 20/10/2026 a equipe cria notificacoes para o sino e pop-ups para a home em Comunicacao > Avisos e pop-ups (`docs/22`; tabelas em `docs/05`, secao Comunicacao).

- **Tabelas fechadas.** `campaigns`, `notifications` e `campaign_deliveries` tem RLS ligado e nada para `anon`/`authenticated`; so o servidor (chave de servico) le e grava, depois de conferir a sessao (rotas do aluno) ou a permissao (Server Actions do admin). As RPCs (`communication_comment_counts`, `communication_campaign_stats`, `communication_overview`) e a retencao so executam com `service_role`.
- **Permissoes** (`docs/17` §2.3 e D4): `messaging.write` (dono, admin, editor) abre a area e cria, edita, duplica, exclui, manda o teste para si e pede a publicacao; `messaging.publish` (dono, admin, editor) publica ate 500 alunos e pausa, retoma, encerra, cancela agendamento e retira do sino; `messaging.publish_large` (dono e admin) publica acima de 500 e aprova ou devolve o pedido de outra pessoa. Sem `messaging.publish`, ou acima de 500 sem `messaging.publish_large`, publicar vira `Aguardando aprovação`; quem aprova reconta o segmento e vira quem publicou. Editar ou retomar pop-up no ar segue a mesma regra, mas responde 403 em vez de virar pedido (sem `messaging.publish`, nunca; acima de 500 alunos, so com `messaging.publish_large`). O limite de 500 vale de novo na hora do envio: notificacao agendada sem aprovacao (sem `approved_at`) cujo segmento passou de 500 volta para `Aguardando aprovação` em vez de sair (auditoria `communication.approval_requested`, motivo `grew_after_schedule`); o pop-up no ar pode crescer sem nova aprovacao (decisao em `docs/22` §2.3). Professor, suporte e analista nao veem a area (a acao responde 403). Comunicacao vale para a escola toda: nenhuma acao tem alcance por curso.
- **Guardas.** Paginas com `requirePageArea("comunicacao")`; Server Actions por `runAdminAction` (permissao + zod + versao lida: `updated_at` e situacao conferidos no proprio UPDATE, senao 409 "Este aviso mudou em outra tela"; publicar e aprovar gravam sempre a versao que contaram, a linha lida do banco, mesmo quando a chamada nao manda a versao, entao um segmento salvo no meio da contagem nunca sai sem ser contado); a rota do audio com `requireApiRole("messaging.write")`. As rotas do aluno chamam `requireApiUser`, usam so o `user_id` da sessao, leem o corpo com `readBoundedJson` (8 KB; ate 50 ids por pedido) e devolvem 404 para notificacao ou pop-up de outra pessoa ou que nao esta mais visivel, sem dizer se existe. Resposta 5xx sem mensagem interna do Supabase.
- **Auditoria.** `admin_audit_log` grava `communication.saved`, `published`, `approval_requested`, `approved`, `rejected`, `canceled`, `paused`, `resumed`, `ended`, `withdrawn`, `duplicated`, `deleted` e `test_sent`, so com ids, contagens, tipo e situacao; nunca o texto do aviso nem nomes.
- **Links.** O botao do aviso aceita caminho interno da area ou `https://` (mesma regra do destaque, `isSafeHeroCtaHref`): conferido ao gravar (schema), ao ler no servidor (o sino e o pop-up descartam o que nao passa) e ao desenhar. Link externo abre em nova aba com `rel="noopener noreferrer"`; caminho interno leva o modo "ver como" do produtor. A notificacao de comentario so leva para a aula.
- **Imagem e audio.** Imagem do aviso: recorte WebP no navegador, servidor confere medida e peso pelo cabecalho (slot `notice`, 1280 x 720, ate 420 KB) e grava no `content-assets`. Audio: rota propria, multipart, ate 10 MB (413 antes de ler o corpo quando o `content-length` passa de 11 MB), tipo conferido pelos primeiros bytes contra o tipo informado (422 se nao bate), bucket publico `communication-audio` com nome pelo hash. No banco e no desenho, imagem e audio so com `https` (ou o Supabase na propria maquina) e sem usuario/senha na URL.
- **Microfone.** `microphone=(self)` so em `/admin` (secao CSP); a area do aluno nunca pede o microfone.
- **Caches e navegador.** A lista de pop-ups no ar fica em `unstable_cache` (60 s, tag `communications`, invalidada por toda mudanca de pop-up) e so tem os avisos; o estado de cada aluno e lido a cada pedido. As rotas do aluno respondem `Cache-Control: private, no-store, max-age=0` com `Vary: Cookie`. No navegador ficam so o numero do sino (memoria da pagina, 1 minuto) e a marca "pop-up ja mostrado nesta sessao" (`sessionStorage`, valor `1`); nenhuma notificacao vai para `localStorage`, IndexedDB ou service worker.
- **Equipe e previa.** A equipe nunca entra num segmento: nao conta, nao recebe notificacao de aviso e nao ve pop-up; o teste para si e marcado (`is_test`) e fica fora dos numeros. O modo "ver como" do produtor nao mostra pop-up. A previa do segmento devolve os 5 nomes de amostra so para quem tem `students.read_basic`: uma funcao personalizada so com `messaging.write` ve a contagem e a frase, sem nomes (combinar regras e ler nomes revelaria progresso, estudo e acesso de alunos com nome). `messaging.write` continua sem puxar `students.read_basic` (nada de permissao nova escondida).
- **Limite de pedidos.** As rotas do sino e do pop-up nao tem limite por minuto: cada escrita mexe so nas linhas do proprio aluno, e idempotente (marcar como lida, clique, primeira resposta, eventos do pop-up sobre o valor lido) e tem corpo limitado. O limite por usuario e IP entra com o `POST /api/events` do `docs/17` §2.3.
- **LGPD.** Retencao de 24 meses e 90 dias no sino (secao LGPD, Retencao por idade); conta excluida leva as linhas dela (cascade); `student_events` recebe so ids (`notification_*`, `message_*`).

### Comunicacao v2 (21/10/2026)

Quem envia, icone, tempo no sino, audio ouvido, notificacoes seguintes e Fluxos (`docs/23`; migracao `202610200002`; tabelas em `docs/05`, secao Comunicacao v2).

- **Tabelas e RPCs fechadas.** `communication_flows`, `communication_flow_nodes`, `communication_flow_runs`, `communication_flow_tasks` e `member_page_visits` com RLS ligado e nada para `anon`/`authenticated`; as 15 RPCs novas sao `security invoker`, com `search_path` fixo, revogadas de `public`/`anon`/`authenticated` e executadas so pelo `service_role`; as funcoes de gatilho nao executam para ninguem. `tests/comunicacao-v2.guard.test.mjs` confere tudo isso na migracao (e que a `202610200001` nao mudou).
- **Quem envia (enviar em nome de alguem).** So pessoas da equipe (`admin_roles`) podem ser escolhidas; nada de nome digitado nem foto avulsa (evita se passar por alguem). O servidor confere ao salvar (400), ao publicar, aprovar e ativar (422 com o nome) e de novo ao desenhar: o sino resolve quem envia na hora de ler, e quem saiu da equipe aparece como a escola, tambem nas notificacoes antigas. O nome mostrado e o do perfil (sem nome, `Equipe Bunker707`); o e-mail da pessoa nunca vai para o aluno. A pessoa escolhida (quando nao e quem publicou) recebe o e-mail `sent_as` (secao E-mail transacional), a auditoria grava `sender_user_id` (avisos) ou `sender_user_ids` (fluxos) e o relatorio mostra `Criada por … · em nome de …`. Sem permissao nova: publicar ja pede `messaging.publish` ou aprovacao.
- **Permissoes nos fluxos.** As mesmas tres de Avisos com o mesmo sentido (`docs/23` §2.9): ativar, retomar e aplicar mudancas num fluxo no ar valem como publicar, com a contagem do segmento de entrada agora para os 500; mudanca no ar sem permissao responde 403 (nunca vira pedido); a aprovacao de uma notificacao cobre as seguintes dela. Paginas com `requirePageArea("comunicacao")` + `messaging.write`; acoes por `runAdminAction` com versao conferida (409).
- **Auditoria.** Alem das acoes de aviso: `communication.flow_saved`, `flow_approval_requested`, `flow_approved`, `flow_rejected`, `flow_activated`, `flow_changes_applied`, `flow_paused`, `flow_resumed`, `flow_ended`, `flow_duplicated`, `flow_deleted`, `flow_step_withdrawn` e `communication.follow_ups_saved` (`entity_type = communication_flow`), so com ids e contagens.
- **Audio ouvido.** `POST /api/notifications/[id]/audio` grava so na linha do proprio aluno, que precisa aparecer no sino, nao estar vencida e ter audio (senao 404, sem dizer se existe); corpo ate 2 KB, validado por zod (`started` ou `progress` com 48 caracteres `0`/`1`); a mascara so cresce (OU no servidor). Guarda: `requireApiSessionUser`. Eventos `notification_audio_started` e `notification_audio_completed`, so com ids.
- **Visitas de pagina.** O que fica: a ultima visita (e a primeira) de cada aluno a cada pagina da area e o clique em Comprar, por chave normalizada (`home`, `content:<id>`, `checkout:<id>`…), nunca o endereco, query ou referer. So e gravado para as paginas que um fluxo ativo ou pausado usa (cache de 60 s, tag `communications`), nunca para a equipe, no modo "ver como" ou num pre-carregamento (`next-router-prefetch`, `sec-purpose`/`purpose: prefetch`), no maximo uma vez por (aluno, pagina) a cada 60 s, sempre depois da resposta (`after()`), e um erro so vira log. A gravacao e feita pelo servidor na propria pagina (nada no `proxy.ts`). O beacon `POST /api/page-visits` (abrir detalhes de um produto, clicar em Comprar) usa `requireApiSessionUser`, aceita so `{ key }` com `^(content|checkout):[A-Za-z0-9_-]{1,240}$` em ate 1.000 bytes (400 `Pagina invalida.`) e responde 204 tambem quando ignora, entao nao da para encher a tabela de lixo nem descobrir o que e acompanhado. Retencao de 24 meses; conta excluida leva junto.
- **Equipe fora.** A equipe nunca entra num fluxo nem recebe notificacao de fluxo: sai na entrada, na decisao e de novo na transacao do envio (promovida no meio do fluxo, nao recebe mais).
- **Marca.** O Icone da escola e publicado com a Marca (`storefront.write`); SVG e convertido em imagem no navegador e nunca guardado como SVG; o servidor aceita so upload valido ou URL http(s).
- **Navegador.** O estado do audio ouvido vem do servidor; no navegador fica so a memoria da pagina. Nenhuma notificacao, visita ou mascara vai para `localStorage`, IndexedDB ou service worker.

### Comunicacao v3a (22/10/2026)

Editar e excluir avisos em qualquer situacao, lixeira do aluno, cartao clicavel, mudar a resposta, reacoes, enquete e o sino numa consulta so (`docs/24`; migracao `202610220001`; tabelas em `docs/05`, secao Comunicacao v3a).

- **RPCs fechadas.** As 9 funcoes novas (`communication_visible_notifications`, `communication_poll_tally`, `communication_inbox_page`, `communication_inbox_counts`, `communication_respond_notification`, `communication_vote_notification_poll`, `communication_reshow_popup`, `communication_message_interactions`, `communication_notice_citations`) sao `security invoker`, com `search_path` fixo, revogadas de `public`/`anon`/`authenticated` e executadas so pelo `service_role`; a 7.9 mantem a assinatura e as permissoes. Nenhuma tabela nova; nada novo para o navegador. `tests/comunicacao-v3.guard.test.mjs` confere permissoes com a assinatura exata, a ausencia de `drop`/`delete`/gatilho e os hashes das migracoes anteriores.
- **Sessao do sino pelas claims do JWT (troca aceita).** Toda rota do sino (`/api/notifications`, `summary`, `read`, `[id]/click`, `[id]/response`, `[id]/reaction`, `[id]/poll`, `[id]/hide`, `[id]/audio`) e o beacon `POST /api/popups/[id]/events` usam `requireApiSessionUser`: com `AUTH_SESSION_STRATEGY=claims` (producao) a sessao sai do JWT assinado, sem ida ao Auth; sem a variavel, o mesmo `getUser()` de antes. Uma sessao revogada pode mexer **so no proprio sino** (marcar, reagir, votar, excluir, responder) ate o JWT vencer (1 h) — a mesma troca ja aceita nas paginas de conteudo. O Auth era 40 % de 1 vCPU no teste de carga (`docs/20` §12.1). O guarda confere que nenhuma rota do sino voltou a `requireApiUser`.
- **Limite de escritas do aluno.** Reacao, voto, lixeira/desfazer e resposta somam no maximo **30 por minuto por aluno** (`takeStudentWrite`, janela fixa de 1 minuto em memoria, ate 20.000 alunos): a 31a responde 429 `Muitas tentativas. Espere um pouco.` com `Retry-After: 60`, antes de ler o corpo. Por processo: na Hetzner vale para a producao inteira; na Vercel (teste) e por instancia, melhor esforco. Os eventos dessas escritas param em **20 por linha** (`notifications.interaction_writes`), para um script que alterna nao encher `student_events`; a linha guarda sempre o estado final. Corpos ate 1.000 bytes (resposta, 8 KB como antes). Linha de outro aluno, escondida, vencida, excluida pelo aluno ou de aviso excluido: 404 sem dizer se existe. As rotas de leitura continuam sem limite (linhas proprias, idempotentes), como na v1.
- **Uma regra de visibilidade.** O que aparece no sino e decidido numa funcao so, em SQL (`communication_visible_notifications`), usada pela lista, pelos numeros, pelas marcacoes e por toda conferencia de uma linha: nao ha caminho em que uma escrita alcance uma linha que a lista nao mostraria (teste de paridade em `tests/integration/sino-v3.test.mjs`).
- **Editar e excluir o que os alunos veem.** Editar uma notificacao enviada vale como publicar (`messaging.publish`; acima de 500 que receberam, `messaging.publish_large`; senao 403, nunca pedido de aprovacao) e o menu nem oferece **Editar** a quem levaria o 403. O servidor recusa campo travado (segmento, envio, tempo no sino, audio, resposta ligada, enquete) com 400 no campo, mesmo que a tela seja contornada. Excluir agendado, enviado ou pop-up no ar/pausado pede `messaging.publish` (403 `Só quem pode publicar exclui um aviso que os alunos veem ou que está agendado.`); "Enviando" e 409. "Mostrar de novo para quem ja viu" pede `messaging.publish` e, acima de 500 reiniciados, `publish_large`; respeita sempre "Nao mostrar de novo" e quem clicou. Encerrar enquete pede `messaging.publish`.
- **Auditoria.** Novas: `communication.edited_after_send` (`{ kind, fields, recipients }`: so os nomes das colunas, nunca o texto), `communication.popup_reshown` (`{ count, via }`), `communication.poll_closed`; `communication.deleted` grava `{ kind, status, removed, follow_ups_removed, cited_by_notices, cited_by_flows }` e `communication.withdrawn` ganha as citacoes (`cited_by_notices`, `cited_by_flows`). So ids e contagens.
- **Eventos do aluno.** `notification_reacted` (`{ campaign_id, reaction }`), `notification_voted` (`{ campaign_id, option_ids }`), `notification_hidden` (`{ campaign_id, hidden }`) e `notification_responded` com `changed`: ids e ids de catalogo (o emoji e um id fixo; a opcao, um id de 8 caracteres hexadecimais escolhido pelo editor), nunca texto. A equipe nunca ve quem votou em que nem quem reagiu: o relatorio so tem contagens.
- **Navegador.** A primeira pagina do sino fica numa memoria do modulo (ate 10 minutos, so na aba, some numa navegacao completa e no 401); nada vai para `localStorage`, IndexedDB ou service worker. O link decorativo do cartao clicavel e `aria-hidden` e fora do Tab, e o link de verdade passa pela mesma conferencia do botao (caminho interno ou `https://`). Enquete e reacoes nunca mostram nomes.
- **LGPD.** Os campos novos ficam nas linhas que ja tinham retencao de 24 meses (`prune_communication_history` sem mudanca); conta excluida leva tudo (cascade).

### Comunicacao v3b-1 (22/10/2026)

Pop-ups com paginas, momento, frequencia escolhida pela equipe e como fechar (`docs/25`; migracao `202610220003`; tabelas em `docs/05`, secao Comunicacao v3b-1).

- **Conteudo so depois de autorizar.** O resumo (`?page=`) leva o **mapa grosso** (onde algum pop-up no ar pode aparecer: `content:*`, `lesson:*`, as paginas fixas e `any`), que vai a todo aluno, inclusive fora do segmento, e por isso **nunca tem id de produto** (ids sao slugs legiveis dos titulos) nem id de pop-up; o **plano** (ids, paginas exatas, momento, quando pode de novo) vai so na pagina coberta e so com os pop-ups do segmento do aluno, sem conteudo. O conteudo so vem no `POST /api/popups/[id]/show`, depois de o servidor conferir no ar, segmento, pagina, momento e frequencia e gravar a abertura.
- **Escrita atomica.** `communication_record_popup_impression` grava so se `updated_at` ainda e o lido (compare-and-set): duas abas nunca contam a mesma abertura, um clique noutra aba nunca e atropelado. "Nao mostrar de novo" e conferido no TypeScript e de novo no SQL. Sem trava consultiva.
- **RPCs fechadas.** As duas funcoes novas e a de reinicio trocada sao `security invoker`, `search_path` fixo, revogadas de `public`/`anon`/`authenticated`, so `service_role`, com a assinatura exata (guarda `tests/comunicacao-v3b1.guard.test.mjs`); RLS sem mudanca.
- **Limites contra abuso.** `show` e os eventos do pop-up tiram de uma cota propria de **30 por minuto por aluno** (`takeStudentWrite("popup:<id>")`, antes de ler o corpo; 429 com `Retry-After: 60`), separada da do sino (um nao esgota o outro); o mesmo pop-up nunca abre duas vezes para um aluno em menos de **5 s** (`decideShow`); as aberturas vao para `student_events` ate **100 por pop-up, aluno e dia** (a linha guarda a conta exata); corpos ate 1 KB (`show`) e 8 KB (eventos). Por processo, como o limite da v3a.
- **Sinais do navegador nao sao confiaveis.** O evento `bunker707:lesson-media` e os atributos do palco da aula podem ser forjados por um script na pagina; o pior que conseguem e pedir o `show` de um pop-up que o aluno ja poderia ver (o servidor decide o resto).
- **Sessao.** As duas rotas do pop-up usam `requireApiSessionUser` (claims do JWT); toda escrita usa o id da sessao; pop-up de outro aluno, fora do segmento, pausado, encerrado ou excluido responde 404 sem dizer se existe; a equipe nunca tem linha (404).
- **CSP** sem mudanca (`src/proxy.ts`): nenhuma origem nova, nenhum script inline, nenhum iframe novo. Nenhum HTML novo: todo texto novo e texto do React; padroes de pagina conferidos pelo zod e pelo check do banco; ids de produto pela mesma expressao das rotas.
- **Auditoria e eventos.** Salvar, pedir aprovacao, publicar e aprovar um pop-up gravam `{ popup_trigger, popup_pages: <quantos>, popup_frequency }`; `message_impressed` com `{ campaign_id, page, trigger }` e `message_closed` com `{ campaign_id, via }`: so ids e codigos curtos (LGPD; retencao sem mudanca).

### Design do pop-up (22/10/2026)

O pop-up "Personalizado" (`docs/26`; migracao `202610230001`; tabelas em `docs/05`, secao Design do pop-up).

- **Texto de verdade, CSS so por objeto.** Todo texto do design e texto do React (escapado); os estilos sao objetos de estilo montados de valores ja validados (hex `#RRGGBB`/`#RRGGBBAA`, numeros com limite, escolhas de lista). Nunca `dangerouslySetInnerHTML`, `innerHTML`, `cssText` nem `<style>` no cartao (guarda `tests/popup-design.guard.test.mjs`, que tambem confere que o cartao do aluno nao importa o zod). Familia CSS so `bf_<12 hex>`.
- **Zod no salvar e no ler.** `popupDesignSchema` versao 1, `.strict()` em todo objeto (chave a mais recusa), na Server Action e na leitura do banco (`parsePopupDesign`: invalido ou de outra versao = Padrão, o pop-up nunca cai). O banco so garante objeto com `version` e ate 32 KB.
- **URLs so dos nossos buckets.** Video: caminho `videos/<uuid>.<mp4|webm>`, extensao igual ao tipo, url publica desse objeto na nossa origem Supabase (http so em 127.0.0.1/localhost); o servidor **troca a url pela do caminho** ao salvar e ao ler. Fonte: nunca guardada no design (so o id); a url sai da biblioteca no servidor. O navegador confere de novo (video fora do bucket vira so a capa; fonte fora do bucket nao e registrada). Imagem no fundo do cartao (23/10/2026): so o objeto publico `content-assets/communications/images/<24 hex>.webp` (o lugar do `uploadNoticeImage`; mais estrito que a imagem do aviso), sem query, fragmento ou usuario e com maquina so `[a-z0-9.-]` (o endereco vai dentro de `url("...")` no CSS do cartao, montado so de valores validados); ao salvar, um caminho novo precisa existir no Storage como WebP (`inspectPopupCardImage`, 400 em `design.card.background.url`, nada apagado); a url e recalculada do caminho ao salvar e ao ler; o cartao confere de novo e, fora disso, mostra so a cor de apoio.
- **Uploads.** Video: direto do navegador ao Storage por endereco assinado (`startPopupVideoUpload`, `messaging.write`), nunca pelo servidor do app; `finishPopupVideoUpload` le o tamanho (`info()`) e **so os primeiros 64 bytes** (`Range: bytes=0-63`, lidos ate 64 e cancelados sem esperar: dentro do `next start` esperar o cancel travava a acao) e recusa (apaga o objeto) MP4 sem `ftyp` valido ou com marca QuickTime/audio/imagem, WEBM sem DocType `webm`, tipo gravado diferente dos bytes, acima de 15 MB. Fonte: `POST /api/admin/communications/popup-fonts` (multipart, `messaging.write`, `content-length` ate 2,2 MB, arquivo ate 2 MB), tipo pelos primeiros bytes e pelo cabecalho minimo (WOFF2/WOFF com o tamanho do arquivo, TTF/OTF com o diretorio inteiro; coleção `ttcf` recusada); o tipo do navegador nunca e usado; ate 40 na biblioteca. Os buckets conferem tipo e tamanho de novo.
- **Biblioteca fechada.** `communication_fonts` com RLS ligado e sem politica, so `service_role`; listar, renomear e excluir sao Server Actions com `messaging.write`.
- **CSP.** `font-src 'self' data: <origem do Supabase>` (a mesma de `connect-src`; `src/proxy.ts`): o FontFace baixa do Storage. Nada do Google Fonts em tempo de execucao (a guarda confere que a CSP nao cita `fonts.googleapis.com`/`fonts.gstatic.com`); a equipe baixa a fonte e envia. `img-src`/`media-src` ja aceitavam o Storage.
- **Menos movimento e economia de dados.** Com `prefers-reduced-motion: reduce` ou `Save-Data`, o `<video>` nem e montado (nada baixado); o video e sempre mudo, sem controles, escondido do leitor de tela.
- **Auditoria.** `popup_design: "custom" | "default"` em salvar/publicar/aprovar; `communication.font_uploaded` (`{ format, size_bytes }`), `communication.font_renamed`, `communication.font_deleted`, `communication.video_uploaded` (`{ mime_type, size_bytes }`): so ids e codigos, nunca o texto do design.
- **Licenca das fontes.** O dialogo de envio lembra a equipe de conferir se a licenca permite usar no site; a fonte de teste do repositorio (subconjunto da Inter, OFL-1.1) tem `tests/fixtures/popup-design/LICENCA.txt`.

### Design Livre do pop-up (23/10/2026)

O pop-up "Livre" (`docs/27`; sem migracao; dados em `docs/05`, secao Design Livre do pop-up).

- **Texto de verdade, CSS so por objeto.** Todo texto e texto do React; nunca `dangerouslySetInnerHTML`, `innerHTML`, `cssText`, `<style>` nem `style` em texto no cartao Livre, no `member-popup*` e no editor (guardas `popup-livre.guard` e no teste do editor). As unicas strings montadas sao gradientes, sombras, mascaras, `rotate()`, `translate()` (so na previa do arrastar), `sizes` e `url()`, todas de valores validados.
- **`url()` nunca com texto do design.** O design guarda so caminhos; o endereco e `freeAssetUrl` = a origem do Supabase de `NEXT_PUBLIC_SUPABASE_URL` conferida uma vez (`freeStorageOrigin`: https, ou http so na propria maquina, sem usuario, senha, caminho, query ou fragmento, maquina so `[a-z0-9.-]`) + o caminho publico do bucket + um caminho que casou com o padrao do tipo. Um design colado, gerado por IA ou nao salvo nao abre `url()` para fora nem sai das aspas (teste com 14 origens maliciosas).
- **Zod estrito no navegador, na Server Action e na leitura**; chave a mais recusa em qualquer nivel (inclusive `url` num arquivo e `devices`); Livre invalido no banco nao aparece para o aluno (log `[comunicacao] design livre invalido <id>`, nunca o conteudo). Regra das duas chaves de design conferida no servidor depois da juncao.
- **Arquivos conferidos pelos bytes.** `uploadPopupFreeImage` (`messaging.write`) aceita so WebP de 16 a 1.600 px e ate 420.000 bytes (`communications/free/<24 hex>.webp`); ao salvar, todo caminho novo e conferido no Storage (existe, tamanho, primeiros 64 bytes WebP com as medidas, que substituem as do navegador; video pela conferencia do Personalizado); arquivo que a linha gravada ainda usa nunca e apagado.
- **Contra pop-up que engana.** O X sempre existe, fora da prancheta e por cima de tudo, sempre visivel (alfa do icone >= `cc` e contraste >= 3:1 com o fundo dele: erro que impede salvar) e o `Esc` sempre fecha; elementos decorativos nao recebem clique; a prancheta corta o que passa dela; no maximo um botao "Abrir um link", com a regra do botao principal.
- **Peso.** Ate 32 elementos, 6 imagens de 420 KB, 1 video, desfoque em ate 4 elementos e o teto do JSON; com menos movimento ou economia de dados o video nem e baixado; o cartao Livre so e baixado quando o pop-up armado e Livre.
- **Copia de recuperacao do editor** (`localStorage` de quem edita): so o design e o `cta`, lida com o mesmo zod e apagada ao salvar.
- **Auditoria.** `popup_design: "free"` em salvar/publicar/aprovar e `communication.free_image_uploaded` (`{ height, size_bytes, width }`); nunca o conteudo do design. **CSP** sem mudanca.

### Limpeza dos arquivos sem uso (23/10/2026)

Video, imagem, audio e fonte da Comunicacao sem uso saem do Storage 30 dias depois (`docs/22` §4.6; migracao `202610240001`; tabela em `docs/05`, secao Limpeza dos arquivos sem uso).

- **Nunca apagar o que esta em uso.** A leitura do que esta em uso e larga de proposito (`media-refs.ts`: endereco do Storage de qualquer origem, caminho solto, tipo de arquivo desconhecido nos dois buckets) e e a mesma do salvar; antes de apagar, o uso e lido de novo e a marca e reservada de forma atomica (so sai a linha ainda antiga); envio do mesmo arquivo (audio, imagens e fontes tem nome pelo conteudo) apaga a marca e o prazo recomeca. Arquivo com menos de 24 h nao e julgado. A guarda `comunicacao-limpeza-de-arquivos.guard` falha quando um campo de arquivo novo aparece no design, em `campaigns` ou num tipo de notificacao sem ser lido.
- **So os nossos lugares.** Os buckets `communication-popup-video` (`videos/`), `communication-fonts` (`fonts/`), `communication-audio` (`campaigns/`) e, no `content-assets`, so `communications/images/` e `communications/free/`; objeto fora do padrao de nome nunca e marcado nem apagado. O check da tabela recusa qualquer caminho do `content-assets` fora de `communications/`.
- **Banco fechado, Storage pela API.** `communication_media_orphans` com RLS ligado e sem politica, so `service_role`; o arquivo sai pela API do Storage com a chave de servico, nunca por SQL em `storage.objects`. Ate 500 por rodada, uma vez por dia.
- **Registro so com numeros.** Log e `job_runs.metadata.media_cleanup` levam contagens (listados, em uso, marcados, desmarcados, apagados, falhas); nunca caminho, titulo ou dado de aluno. Falha no Storage devolve a marca e tenta no dia seguinte.
- **Backup.** O que saiu do Storage so volta pelo backup diario do servidor (`docs/20` §10.1) enquanto ele guardar o dia.

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
