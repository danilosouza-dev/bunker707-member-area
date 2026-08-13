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
- o middleware do Next.js renova/valida sessao com `@supabase/ssr`;
- `profiles`, `entitlements`, `student_events`, `lesson_progress`, `admin_roles` e todas as tabelas de comentarios/moderacao possuem RLS;
- aluno pode ler/editar somente o proprio perfil, ler os proprios entitlements e gravar eventos proprios;
- aluno nao possui policy para criar, alterar ou remover entitlements;
- `/admin` e as APIs `/api/admin/*` exigem papel em `admin_roles`;
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
- rotas de legenda e streams manuais da TV exigem o bearer token do receptor, revalidam a sessao e o entitlement antes de resolver a midia e nunca usam cache. Em qualidade manual, as URLs temporarias do `googlevideo` chegam ao navegador da TV e conservam as mesmas limitacoes de observabilidade e ausencia de DRM do player principal;
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

Ferramentas recomendadas:

- Sentry para erros;
- PostHog para analytics;
- logs estruturados no servidor;
- tabela de auditoria para acoes sensiveis.

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

- Supabase Postgres: backup automatico do plano escolhido;
- exports periodicos para seguranca;
- assets e materiais em storage com politica de backup;
- videos no provedor com estrategia de recuperacao.

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

## Cadastro manual e senha temporaria

Regras:

- convite por email e o fluxo preferencial para novos alunos;
- senha temporaria existe apenas para suporte/onboarding e deve exigir troca no primeiro login;
- senha temporaria nao deve ser salva em banco, logs, historico do CRM ou metadata;
- `service_role` so pode ser usado na rota server-side administrativa;
- a tela `/alterar-senha` limpa `must_change_password` somente depois de atualizar a senha do usuario;
- remover aluno ou produto do acesso manual no CRM deve marcar os entitlements `admin-student:*` como `revoked`, sem apagar eventos ou payloads externos;
- o admin deve enviar senha temporaria por canal de atendimento controlado, evitando expor senha permanente por email.
