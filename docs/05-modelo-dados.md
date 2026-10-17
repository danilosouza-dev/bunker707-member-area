# Modelo de Dados Inicial

Este e um modelo conceitual para o MVP. O schema final pode ser ajustado durante a implementacao.

## Entidades principais

```txt
users
profiles
external_accounts
products
product_combos
product_combo_items
entitlements
courses
formations
formation_courses
bootcamps
modules
lessons
lesson_materials
lesson_comments
lesson_comment_reactions
lesson_comment_reports
lesson_comment_moderation_actions
lesson_comment_blocked_words
content_release_rules
material_access_rules
content_drafts
content_versions
admin_roles
admin_functions
admin_activity_log
lesson_progress
course_progress
product_progress
learning_tasks
learning_task_submissions
saved_items
student_events
webhook_events
email_outbox
email_webhook_events
integration_settings
ai_agents
ai_agent_scopes
support_tickets
```

## Usuarios e perfil

### users

Representa a identidade autenticada. No MVP atual vem de Supabase Auth.

Campos conceituais:

- id;
- auth_provider;
- auth_provider_user_id;
- email;
- created_at;
- updated_at.

### profiles

Dados editaveis do aluno.

- id;
- user_id/id do Supabase Auth;
- email;
- full_name;
- avatar_url;
- phone;
- birth_date;
- document;
- created_at;
- updated_at.

## Acesso

### external_accounts

Relaciona um aluno a plataformas externas.

- id;
- user_id;
- provider: hotmart, ticto, tiktok, manual;
- external_customer_id;
- email_used_in_purchase;
- created_at.

### products

Representa um produto/plano interno da Bunker707.

- id;
- type: formation, standalone_course, mentorship, webinar, generic_product, bootcamp, platform_access;
- name;
- slug;
- description;
- target_type: formation, standalone_course, mentorship, webinar, product, bootcamp, platform;
- target_id;
- active;
- created_at.

### product_combos

Combos sao pacotes internos que agrupam produtos existentes. Eles nao criam checkout dentro da plataforma.

- id;
- name;
- description;
- status: active, draft, paused;
- default_cohort_id ou cohort_name;
- created_at;
- updated_at.

Regra: quando uma venda externa corresponde a um combo, o processamento do webhook deve resolver os produtos incluidos e criar/atualizar entitlements internos para cada alvo liberado. O combo em si nao substitui entitlement.

Implementacao atual:

- `product_combos` e `product_combo_items` possuem migration propria;
- o CRM usa rota administrativa `/api/admin/combos` para criar, editar e remover combos;
- combos sao persistidos somente no Supabase; sem banco configurado, o CRM deve falhar explicitamente.

### product_combo_items

Relaciona um combo aos produtos que ele libera.

- id;
- combo_id;
- product_id;
- target_type;
- target_id;
- created_at.

Regras:

- combo pode incluir cursos, formacoes, mentorias, webinarios, produtos genericos e bootcamps;
- remover um item do combo nao deve revogar automaticamente acessos ja concedidos sem uma operacao administrativa explicita;
- a auditoria deve registrar alteracoes em combos ativos.

### entitlements

Permissoes reais do aluno.

- id;
- user_id;
- source_provider;
- source_event_id;
- product_id;
- target_type: platform, formation, standalone_course, mentorship, webinar, product, bootcamp;
- target_id;
- status: active, suspended, revoked, expired;
- starts_at;
- ends_at;
- created_at;
- updated_at.

Regra: a interface nunca deve liberar conteudo apenas por dados de pagamento. Sempre consultar entitlement.

Implementacao atual:

- `entitlements` existe como tabela interna com RLS;
- aluno autenticado pode ler somente seus proprios entitlements;
- cliente nao pode criar, editar ou remover entitlement;
- webhooks, CRM e operacoes manuais devem alterar entitlements apenas via servidor/admin.
- a area do aluno aplica entitlements ativos por usuario autenticado para liberar cards, paginas e `Minhas compras`;
- enquanto o CRM manual e a tabela de entitlements coexistirem, o backend tambem reconhece os cursos ativos vinculados ao aluno por email/id e sincroniza esses cursos para `entitlements` quando o usuario Auth ja existe;
- quando um curso/produto ou aluno sai do CRM manual, os entitlements gerenciados pela origem `admin-student:*` sao marcados como `revoked`; entitlements criados por webhooks externos nao sao apagados por essa rotina;
- o modo de preview de acesso e ferramenta administrativa: so aparece para a equipe da escola toda (papel em `admin_roles` sem escopo por curso; o Professor nao) e nao altera a experiencia de alunos comuns. Na area do aluno, a equipe abre conteudo sem compra; o Professor, so os cursos dele.
- `starts_at` e o inicio da contagem das regras de liberacao "depois da compra/inscricao": a data mostrada ao aluno (`Liberação em 08/01/2026`) e a liberacao real saem da mesma conta (`resolveReleaseState` em `src/server/access/release-policy.ts`), usando o acesso ativo mais antigo que vale para o conteudo, no fuso de Sao Paulo.
- ponto de extensao da garantia (sem migracao nesta fase): quando o pipeline de webhooks gravar o fim da garantia da compra (Hotmart: `purchase.warranty_expire_date`), entra uma coluna opcional `warranty_ends_at` em `entitlements` (migracao `202610130002+`), enviada em `getReleasePolicyEntitlements` (`src/server/db/platform-store.ts`). A conta ja aceita esse campo e so o usa quando a regra pedir `anchor: "warranty_end"`; sem a data gravada, volta para `starts_at`.

## Home configuravel

### home_sections

- id;
- title editavel pelo aluno, normalizado e limitado a 160 caracteres;
- subtitle;
- order_index;
- section_type: continue_watching, content_carousel, content_structure;
- visibility: students, non_students, all;
- content_source: manual, entitlement_products, selected_content_structure, sellable_products, upcoming_products, recent_lessons;
- layout: continue, vertical, compact, immersive;
- source_content_id: curso, formacao ou bootcamp usado quando `section_type` for `content_structure`;
- is_active;
- created_at;
- updated_at.

### home_section_items

- section_id;
- content_id;
- order_index.

Registra a selecao manual ordenada de cards de uma secao. A chave composta `section_id + content_id` evita duplicacao e a exclusao da secao remove seus itens em cascata.

Regras:

- `purchases` deve listar produtos com entitlement ativo do aluno, agrupando formacoes, bootcamps e cursos avulsos;
- `showcase`/`sellable_products` lista somente produtos vendaveis aos quais o aluno ainda nao tem acesso;
- produtos com entitlement ativo, gratuitos ou ja liberados para o aluno sao removidos dessa fonte durante a resolucao da Home;
- produtos restantes sem entitlement aparecem bloqueados na UI;
- `upcoming_products` pode listar produtos futuros, novidades e listas de espera;
- `content_structure` mostra os modulos de um curso/bootcamp ou os cursos internos de uma formacao escolhida pelo produtor;
- `content_structure` aceita layout `compact` ou `immersive` e pode aparecer para alunos com ou sem entitlement ativo; sem acesso, o conteudo mostra acao `Comprar` e os cards internos preservam bloqueio;
- o botao `Comprar` pode abrir o modal de detalhes ou o link externo de compra, conforme configuracao do CMS;
- modulos dentro de `course_modules` continuam respeitando regras de compra, entitlement, drip/agendamento e podem aparecer bloqueados;
- a regra `visibility` define se a secao aparece apenas para alunos/compradores, apenas para nao compradores/visitantes ou para todos.

Estado de rollout: a migration relacional `202607100003_home_sections.sql` define essas duas tabelas. Ate sua aplicacao no Supabase remoto, a configuracao publicada e gravada em `platform_settings` com chave `homeSections`, usando a mesma estrutura `HomeSectionConfig[]`. Esse fallback e uma representacao transitoria da configuracao e nunca participa da decisao de acesso.

## Login configuravel

Estado atual (2026-10-11): a configuracao publicada fica em `platform_settings.loginPage` (ver "Area de membros do admin v2" abaixo), editada em Area de membros > Login. A tabela `login_page_settings` abaixo continua sendo o desenho futuro; nenhuma migracao a cria ainda.

### login_page_settings

Configuracao visual da tela de login escolhida pelo produtor na area `Personalizacao` do CRM.

- id;
- template: split_visual_right, split_visual_left, center_glass, side_glass_right;
- logo_url;
- background_image_url;
- side_image_url;
- panel_tone: dark, light, glass;
- form_surface: transparent, bordered, panel;
- form_position: left, right, center;
- title;
- subtitle;
- support_link_url;
- enabled_providers: google, apple, email_password;
- is_active;
- created_at;
- updated_at.

Regras:

- esta tabela controla apenas apresentacao e provedores visiveis;
- a liberacao de conteudo continua dependendo de `entitlements`;
- nenhuma chave de provedor de auth deve ser salva ou exposta nessa configuracao;
- imagens e textos devem ser tratados como conteudo customizavel, nao como regra de autenticacao.

## Personalizacao administrativa

A area `Personalizacao` do CRM e uma camada de edicao visual sobre configuracoes existentes:

- `login_page_settings` para a tela de login;
- `content_page_settings` para paginas de cursos, formacoes, bootcamps, mentorias, webinarios e produtos;
- `home_sections` para a vitrine/home, incluindo hero, fileiras, cards/secoes, ordem, origem dos conteudos e visibilidade;
- dados de modulos e aulas para ajustar como a estrutura interna aparece dentro da pagina do curso.

Campo de transicao implementado dentro de `content_page_settings.settings`:

- `parentFormationId`: formacao principal de um curso com `commerce_scope = included_content`.

Um curso interno deve apontar para exatamente uma formacao principal antes de ser publicado para consumo. O entitlement da formacao libera somente cursos internos cujo `parentFormationId` corresponde a ela; paginas e modais tambem listam apenas os cursos explicitamente associados. O campo representa a futura relacao `formation_courses` e nunca e aceito como autorizacao fornecida pelo browser.

Regras:

- personalizacao altera apresentacao, texto, imagens, ordem e preview, mas nao concede acesso;
- a home/vitrine editavel deve ser uma representacao fiel da home real do aluno em modo editor, com controles discretos sobre banner, textos e secoes;
- o editor da home deve consumir as mesmas `home_sections`/`homeRows` resolvidas pela home publicada, preservando variantes como `continue_watching`, `vertical` e `content_structure`;
- `continue_watching` deve usar thumbnails/resume frames de aulas e proporcao horizontal de video, nao capas verticais de cursos;
- a renderizacao final continua filtrando por `entitlements`, regras de liberacao e visibilidade da secao;
- cursos internos de formacao continuam fora da vitrine como produto vendavel separado;
- checkout interno continua fora do escopo do MVP.

Regras de produto e acesso:

- formacao e produto vendavel;
- curso, mentoria, webinario, produto generico e bootcamp tambem podem ser itens vendaveis ou gratuitos;
- bootcamp e produto vendavel;
- curso avulso e produto vendavel;
- curso interno de formacao nao e produto vendavel separado;
- ao comprar uma formacao, o aluno tem acesso a todos os cursos internos dessa formacao;
- a vitrine deve listar produtos vendaveis, nunca cursos internos de formacao;
- o webhook de pagamento cria/atualiza entitlement no produto comprado, nao em cada curso interno isoladamente.

## Turmas

### cohorts

Turmas podem existir por produto, combo ou operacao manual. Quando nenhum nome for definido, a interface administrativa assume `Turma A` como padrao de cadastro.

Campos conceituais:

- id;
- product_id opcional;
- combo_id opcional;
- name;
- starts_at;
- status;
- created_at.

### cohort_memberships

- id;
- user_id;
- cohort_id;
- entitlement_id;
- role: student, mentor, professor;
- created_at.

Regras:

- turma organiza experiencia, comunicacao e liberacoes extras;
- turma nao deve autorizar acesso sozinha; ela complementa entitlements ativos.

## Comentarios e moderacao

### lesson_comments

- id;
- content_id;
- lesson_id;
- author_id;
- author_name, author_username, author_avatar_url e author_role como snapshot de exibicao. `author_role` e gravado no envio: `producer` para quem da equipe monta modulos e aulas (dono, Administrador, Editor, Professor ou funcao com essa permissao; etiqueta `Professor`), `moderator` para o resto da equipe (Suporte, Analista...; etiqueta `Moderador`) e `student` para quem nao tem papel (etiqueta `Aluno`). Comentarios antigos mantem o papel gravado;
- parent_comment_id;
- body;
- status: pending, approved, hidden, spam;
- moderation_note, moderated_by e moderated_at;
- analysis_status: pending, processing, completed, failed;
- analysis_result jsonb e analyzed_at;
- deleted_at e deleted_by para remocao preservando rastreabilidade quando esse fluxo for habilitado;
- created_at;
- updated_at.

### lesson_comment_reactions

- comment_id;
- user_id;
- reaction: like, fire, insight, love, clap, laugh, wow, rocket, eyes, check;
- created_at;
- updated_at;
- chave primaria composta por comment_id e user_id, permitindo uma reacao ativa por aluno em cada comentario.

### lesson_comment_reports

- id;
- comment_id;
- reporter_id;
- reason opcional;
- created_at;
- unicidade por comment_id e reporter_id para tornar a denuncia idempotente.

### lesson_comment_moderation_actions

- id;
- comment_id;
- actor_id;
- action: approved, hidden, marked_spam, restored;
- previous_status;
- next_status;
- note;
- created_at.

### lesson_comment_blocked_words

- id;
- word;
- normalized_word;
- message;
- active;
- created_by e updated_by;
- created_at;
- updated_at.

Regras:

- comentarios e respostas podem ser filtrados por produto, tipo e status;
- palavras bloqueadas impedem o envio e mostram mensagem clara ao aluno;
- termos sao comparados sem diferenca de caixa/acentos e com limite de palavra ou frase, evitando falso positivo por substring;
- a moderacao preserva ator, estado anterior, estado seguinte, observacao e horario;
- denuncias nao ocultam automaticamente o comentario, evitando censura por abuso; elas elevam o item para a fila `Em revisao`;
- corpos de comentarios permanecem na tabela de dominio; `student_events` recebe ids, tipo, tamanho e contexto, sem copiar o texto para analytics;
- os campos de analise existem desde a coleta, mas o job/IA que preenche sentimento, temas e insights continua uma etapa futura.

## Integracoes

### integration_settings

Implementada na migracao `202610170003_sales_webhooks.sql` (17/10/2026), uma linha por plataforma (as tres ja inseridas pela migracao).

- id uuid;
- provider: hotmart, ticto, kiwify (unico);
- status: not_configured, configured, needs_attention;
- webhook_url (o endereco mostrado ao produtor, informativo);
- secret (o SHA-256 em hexadecimal do token que a plataforma manda em cada pedido; Hotmart: hottok. O token em si nunca e gravado: um dump nao permite forjar uma venda. So o servidor le, por `fetchIntegrationSecret`; a tela nunca recebe a coluna);
- secret_status: missing, set (consistente com `secret` por check);
- secret_updated_at;
- events jsonb (lista dos eventos da plataforma que mudam acesso, para a tela dizer o que marcar la);
- last_sync_at, last_error;
- created_at, updated_at.

Regras:

- segredos reais de webhook ficam somente no servidor: a coluna `secret` guarda o hash do token numa tabela so de `service_role`, e `saveSalesSecret` (settings.sales) grava sem devolver; depois de salvo, a tela mostra apenas "Token guardado em <data>" e o botao Trocar;
- dados de plataforma externa sao entrada para processamento, nao fonte de autorizacao;
- cada provider deve ter adapter proprio (`src/server/payments/adapters.ts`); plataforma sem adaptador aparece como "Em configuracao", nunca "Conectada".

## Agentes de IA

### ai_provider_configs

- provider: gemini, openai, anthropic;
- default_model;
- is_default;
- enabled;
- priority do provedor;
- status;
- daily_question_limit por aluno nas ultimas 24 horas;
- monthly_question_limit da plataforma;
- max_output_tokens;
- context_max_characters;
- temperature;
- last_tested_at;
- created_by, updated_by, created_at, updated_at.

Esta tabela representa a politica de modelo e limites do provedor, nao uma credencial unica. `vault_secret_id` e `key_last_four` permanecem nullable durante a compatibilidade com a configuracao BYOK antiga; migrations idempotentes movem cada segredo legado para o pool. Alteracoes e testes de politica geram `ai_provider_config_events` sem registrar a chave.

### ai_provider_connections

Cada linha e uma credencial elegivel no Bunker AI LB. Um mesmo provedor pode ter varias conexoes.

- provider: gemini, openai, anthropic;
- auth_mode: `api_key` ou `account_gateway`;
- label e `credential_hint` mascarada;
- `vault_secret_id` somente para API, ou `gateway_auth_id`, `gateway_auth_index` e `gateway_auth_name` somente para conta;
- status: active, paused, needs_attention, connecting;
- priority;
- consecutive_failures;
- health_tier: healthy, draining, probing;
- probe_success_streak;
- cooldown_until;
- last_error_at, last_error_code e mensagem sanitizada;
- last_tested_at e last_used_at;
- created_by, updated_by, created_at e updated_at.

Regras:

- a constraint separa conexoes de API e de conta: uma linha nunca pode ter os dois tipos de segredo;
- chaves de API ficam no Supabase Vault e apenas os ultimos caracteres aparecem na dica mascarada;
- conexoes equivalentes sao ordenadas por prioridade, saude e menor `last_used_at`, permitindo round-robin;
- falha atualiza cooldown/backoff e saude; sucesso em modo de prova exige uma sequencia antes de recuperar `healthy`;
- remover uma conexao apaga seu segredo de API, quando houver, mas `ai_messages.connection_id` usa `on delete set null` para preservar o consumo historico.

### ai_provider_connection_events e ai_account_link_sessions

`ai_provider_connection_events` audita criacao, edicao, teste, pausa, retomada, remocao, OAuth e resultados de runtime sem armazenar credenciais nem corpos de conversa.

`ai_account_link_sessions` representa uma tentativa curta de conectar conta:

- pertence ao administrador/produtor em `actor_id`;
- guarda provider, label, state do gateway e IDs existentes antes do login;
- status: pending, completed, failed, cancelled;
- expira em cinco minutos e registra erro sanitizado/conclusao;
- o callback so e aceito para URL HTTP local exibida pelo provedor, com codigo/erro e `state` compativel.

### lesson_transcripts e content_chunks

- `lesson_transcripts` guarda versoes por aula, origem `youtube`, `upload` ou `paste`, formato, idioma, texto, cues, checksum e versao ativa;
- a mesma transcricao ativa nao e importada novamente quando o checksum nao mudou;
- `content_chunks` divide a versao em trechos ordenados com `start_seconds`, `end_seconds`, texto e indice de busca;
- SRT, VTT e legendas do YouTube preservam tempo; TXT nao recebe timestamps inventados;
- `lesson_ai_profiles` guarda resumo, capitulos, topicos, FAQ, modelo e estado da analise da versao ativa.

### ai_agents

- id;
- name;
- scope: comments, lesson_tutor, platform_guide;
- status: draft, training, active, paused;
- instructions;
- auto_reply;
- training_sources jsonb;
- last_trained_at;
- created_at;
- updated_at.

### ai_agent_scopes

- id;
- ai_agent_id;
- product_id;
- module_id;
- lesson_id;
- created_at.

### ai_conversations

- id;
- user_id;
- agent_type: `lesson_tutor` ou `platform_guide`;
- lesson_id;
- lesson_title_snapshot;
- content_id_snapshot;
- title;
- summary e summarized_message_count para evolucao do contexto longo;
- student_deleted_at para exclusao logica solicitada pelo aluno;
- created_at;
- updated_at;
- last_message_at.

### ai_messages

- id;
- conversation_id;
- user_id;
- role: user, assistant, system;
- body;
- status: pending, completed, failed;
- citations jsonb: fontes verificadas da legenda usadas na resposta, com `verified`, identificador, trecho, tempo real e inicio de seek ja ajustado 3 segundos para tras; citacoes legadas sem verificacao nao habilitam navegacao no player;
- provider;
- model;
- connection_id: conexao que concluiu a resposta, preservada como nullable se a conexao for removida;
- provider_attempts: sequencia sanitizada de tentativas e fallbacks, sem segredo ou corpo;
- gateway_request_id: correlacao tecnica retornada pelo gateway quando aplicavel;
- input_tokens;
- output_tokens;
- client_request_id para envio idempotente;
- message_sequence: ordem canonica, positiva e unica dentro da conversa, atribuida pelo banco antes de cada insert;
- created_at.

Regras:

- `lesson_tutor` e o professor de uma aula especifica e usa somente o contexto autorizado daquela aula;
- `platform_guide` identifica a IA Diretor, que conhece somente a estrutura, os assuntos e os conteudos autorizados ao aluno para localizar aulas e aconselhar trilhas; ela nunca reutiliza silenciosamente um chat do Tutor IA;
- o tutor de aula usa o pool real de APIs e contas atras de adapters server-side;
- respostas automaticas devem ficar desligadas por padrao ate treinamento e revisao;
- agentes nao podem revelar conteudo sem entitlement ativo para o aluno.
- cada conversa do Tutor pertence a exatamente um aluno e uma aula; conversas da IA Diretor pertencem a um aluno e nao possuem escopo de aula;
- o mesmo aluno pode criar varios chats independentes para a mesma aula;
- o aluno pode renomear qualquer conversa ativa que lhe pertença; chats excluidos logicamente nao podem ser renomeados;
- mensagens sao persistidas em ordem e permanecem disponiveis sem expiracao automatica, permitindo consultar ou continuar qualquer chat anterior;
- continuar um chat reutiliza apenas o historico daquela conversa; chats diferentes da mesma aula nao compartilham mensagens entre si;
- conversas de alunos diferentes nunca compartilham historico, mesmo quando pertencem a mesma aula.
- excluir um chat preenche `student_deleted_at` somente depois de validar ownership; o registro e suas mensagens permanecem no Supabase, mas deixam de ser listados, abertos ou usados como contexto para novas perguntas;
- conversas excluidas logicamente podem alimentar apenas analises internas autorizadas e agregadas; um pedido de exclusao de dados pessoais deve apagar ou anonimizar o conteudo conforme a politica de privacidade aplicavel;
- transcricoes e tabelas do tutor ficam com RLS habilitado e sem privilegio direto para `anon` ou `authenticated`; as APIs server-side aplicam sessao, ownership e entitlement antes de usar o contexto;
- remover uma aula preserva a conversa e as mensagens historicas por snapshot, mas impede novas perguntas sem uma aula acessivel;
- referencias da IA Diretor ficam persistidas em `ai_messages.citations`, mas os links sao construidos pelo servidor somente depois de validar que o identificador opaco pertence ao conjunto autorizado recuperado para aquela resposta;
- `content_items.publication_status` controla publicacao editorial sem sobrecarregar `content_items.status`, que continua representando o estado pedagogico/comercial exibido na experiencia. O backfill preserva os itens existentes como `published`; novos itens usam `draft` ate a escolha explicita no CMS.

### Agregacao de consumo de IA

`get_ai_usage_summary(days, agent_type)` agrega somente mensagens de assistente persistidas no periodo e pode separar `lesson_tutor` de `platform_guide`. O retorno administrativo inclui:

- totais de respostas, falhas, conversas, alunos ativos, aulas e tokens de entrada/saida;
- consumo por tipo de agente;
- consumo por tutor/aula;
- consumo por aluno, ordenado por tokens para formar o ranking de quem mais usa IA no periodo;
- consumo por provedor/modelo, conexao e modo de autenticacao;
- serie diaria.

O ranking e uma visao de consumo, nao uma classificacao pedagogica. Ele deve ficar restrito ao produtor/admin, permitir periodo e filtro de agente e usar nome/email apenas na tela autorizada; exportacoes e analises amplas devem preferir identificadores ou dados agregados.

## CMS administrativo

O CMS em `/admin` grava dados por uma camada server-side persistida em Supabase Postgres/RLS. A fonte de verdade de runtime e sempre Supabase: nao existe fallback em `.data`, seed automatico, mock ou modo local para manter o app navegavel. Um Supabase vazio deve continuar vazio; cadastros reais entram pelo CMS, APIs, webhooks ou migrations controladas.

O menu principal do CMS deve manter Produto/Aluno/Operacao separados: Visao geral, Alunos, Produtos, Combos, Estrutura, Comunidade, Moderacao, Agentes de IA, Personalizacao e Configuracoes > Integracoes. Regras de liberacao nao ficam em uma tela solta; elas sao campos do proprio item editado, seja formacao, curso, mentoria, webinario, produto, modulo, aula ou material.

O primeiro fluxo de criacao do CMS deve funcionar como um construtor LMS:

1. criar o item educacional: formacao, curso, mentoria, webinario, produto ou bootcamp;
2. definir capa, descricao, modelo de acesso, limite de estudantes e link externo de compra quando houver;
3. no mesmo fluxo, avancar para a criacao de trilhas/modulos;
4. no mesmo fluxo, adicionar aulas dentro dos modulos;
5. em cada nivel, configurar regra de entrega/publicacao.

O produtor pode salvar apenas o primeiro passo e voltar depois para completar modulos e aulas. A aba Estrutura continua existindo como visao operacional, mas o cadastro principal do Catalogo deve permitir montar o conteudo sem trocar de tela.

O construtor CRUD do Catalogo deve abrir em um modal central sobre a listagem. Criar ou editar item, curso, modulo ou aula nao deve transformar a pagina inteira em formulario nem navegar para uma pagina separada; o contexto operacional do catalogo permanece visivel por baixo do modal. Modulos e aulas podem ser excluidos individualmente no mesmo fluxo, sempre com confirmacao explicita.

As exclusoes de estrutura sao fisicas e persistidas no Supabase. Excluir um modulo tambem exclui suas aulas. As FKs removem comentarios e seus registros dependentes em cascata; a camada server-side limpa favoritos e os IDs da aula em `completed_lesson_ids`, `lesson_reactions` e `lesson_watch_states`, e triggers no banco repetem essa garantia dentro da transacao da exclusao. `student_events` continua append-only para preservar o historico comportamental e de auditoria.

Campos planejados/adicionados ao item educacional:

- access_model: closed ou free;
- max_students: numero maximo de estudantes ou nulo para ilimitado;
- purchase_url: pagina de vendas ou checkout externo para itens bloqueados;
- purchase_target: same_tab ou new_tab;
- release_rule: regra de entrega/publicacao.
- cover_url/image: capa vertical enviada pelo produtor, preferencialmente em 720 x 1040 px nesta fase;
- hero media opcional via `content_page_settings.hero`, com tamanho definido de 1920 x 720 px para pagina propria do curso/produto; desde 14/10/2026 o mesmo `hero` aceita `mediaType: "video"` com `mediaSrc` = link direto do arquivo (.mp4/.webm/.mov) ou link canonico do YouTube (nesse caso com `youtubeId`), `poster` = a imagem de destaque e `videoOptions` = { autoplay, startWithSound, loop, soundButton, volumeSlider, pauseButton, timeline, hideBranding, nativeControls } (ausentes = padroes em src/lib/hero-video.ts); o modal da home usa essa mesma midia no topo.
- coursePresentationMode em `content_page_settings`: `module_cards` para curso com cards de modulos ou `lesson_playlist` para `Card unico`.
- homeModuleSection em `content_page_settings`: quando `enabled`, a home do aluno pode mostrar o nome do curso, capa pequena e os modulos desse curso como secao propria.
- lockedActionMode em `content_page_settings`: `details_modal` para abrir modal em conteudo sem acesso ou `external_link` para abrir o link externo de compra configurado em `purchase_url`.

Regras de entrega/publicacao:

- immediate: disponivel imediatamente;
- fixed_date: publicar/liberar em data e hora especificas;
- after_enrollment: liberar X horas ou dias apos a inscricao/entitlement do aluno;
- after_purchase: equivalente operacional para eventos externos de compra/entitlement;
- after_previous_lesson: liberar apos aula anterior;
- activity_required: liberar apos avaliacao, comentario, tarefa ou outra atividade.

Na area do aluno, conteudos bloqueados por compra devem abrir o modal de detalhes e mostrar CTA de compra externa configurada. Conteudos bloqueados por regra de entrega devem mostrar overlay com cadeado no card, modulo ou thumbnail da aula, informando quando o conteudo sera liberado para aquele aluno.

Para teste local/admin, a area de membros pode ser renderizada em modos de preview: sessao atual, produtor/admin, aluno com acesso e aluno sem acesso. O modo com acesso remove bloqueios de compra/entitlement, mas nao remove bloqueios de regra de entrega ou data. O modo sem acesso mostra a vitrine com produtos bloqueados e deixa `Minhas compras` sem produtos liberados.

### content_drafts

Rascunhos editaveis de produtos, cursos, modulos, aulas, materiais e configuracoes da home.

- id;
- owner_type: product, formation, course, bootcamp, module, lesson, material, home_section, login_page_settings, content_page_settings;
- owner_id;
- draft_payload jsonb;
- status: draft, review, scheduled, published, archived;
- created_by;
- updated_by;
- created_at;
- updated_at.

### content_versions

Historico de publicacao para auditoria e rollback.

- id;
- owner_type;
- owner_id;
- version_number;
- published_payload jsonb;
- published_by;
- published_at;
- change_summary.

### admin_roles

Equipe do admin com Supabase Auth: uma linha por pessoa, com uma ou mais funcoes e permissoes extras (docs/17 §2.3).

- id;
- user_id (unico, `auth.users` com `on delete cascade`);
- role: owner (Dono, exclusivo), admin, editor, instructor (Professor), support ou analyst quando a pessoa tem so essa funcao pronta e nenhum extra, e custom quando combina funcoes, usa funcao personalizada ou tem extras;
- permissions jsonb (objeto, ate 16 KB). Dono: `{}`. Funcao pronta sozinha: `{}`, ou `{ "productIds": [...] }` quando alguma permissao vale so nos cursos (Professor). `custom`: `{ "functions": [...], "actions": [...], "scopedActions": [...], "productIds": [...] }`, com `functions` = chaves das funcoes prontas (`admin`, `editor`, `instructor`, `support`, `analyst`) e ids de `admin_functions`, `actions` = permissoes extras so desta pessoa, `scopedActions` = quais extras valem so nos cursos e `productIds` = cursos escolhidos. Linha `custom` antiga, so com `actions`, vale como "so permissoes extras". O servidor descarta acao desconhecida, funcao que nao existe e id invalido ao ler; papel pronto nunca le extras;
- created_at;
- updated_at (gravacao condicional da tela de Equipe).

Regras de admin_roles (migracao `202610160001`):

- escrita so pelo servidor (`service_role`, depois de `settings.team`); o navegador le so a propria linha;
- gatilho `guard_last_admin_owner`: remover, rebaixar ou apagar a conta do ultimo dono falha (`last_owner`), com trava nas linhas de dono para dois pedidos ao mesmo tempo nao removerem os dois ultimos;
- permissoes efetivas sao calculadas a cada requisicao (`loadAdminAccess` em `src/server/auth/admin-access.ts`, que le a linha e as funcoes personalizadas citadas e chama `resolveAdminAccess` em `src/server/auth/roles.ts`): mudar ou remover alguem, ou mudar uma funcao personalizada, vale na proxima requisicao da pessoa;
- funcoes e extras se somam, e a escola toda vence "so nos cursos"; extra que as funcoes ja dao igual nao e gravado;
- erro ao ler as funcoes personalizadas da pessoa deixa a pessoa sem admin ate a leitura voltar (nunca com mais acesso); funcao que nao existe mais nao da nada;
- curso criado por quem cria so nos proprios cursos entra em `permissions.productIds` por `admin_add_course_to_member_scope(user_id, product_id)` (migracao `202610170001`): um UPDATE so, com a linha travada, que mexe so na lista de cursos (nao desfaz o que o dono mudou ao mesmo tempo) e respeita o teto de 100 cursos.

### admin_functions

Funcoes personalizadas da equipe (migracao `202610170001`, docs/17 §2.3): o dono junta funcoes prontas e marca permissoes, cada uma na escola toda ou so nos cursos de cada pessoa.

- id uuid;
- name (2 a 60 caracteres, unico sem diferenciar maiusculas e espacos nas pontas);
- description (ate 240 caracteres);
- actions text[] (1 a 40 permissoes, ja com os pre-requisitos);
- scoped_actions text[] (quais valem so nos cursos de cada pessoa; sempre dentro de `actions`);
- created_by (`auth.users`, `on delete set null`);
- created_at;
- updated_at (gatilho `set_updated_at`; gravacao condicional da tela).

Regras de admin_functions:

- RLS ligado e sem politica; `anon` e `authenticated` sem acesso. So o servidor (`service_role`, depois de `settings.team`) le e grava;
- Equipe (`settings.team`) e chaves de venda (`settings.sales`) nunca entram numa funcao;
- funcao com alguem nela nao e excluida (a pessoa perderia permissoes sem ver); a contagem usa `admin_roles.permissions->functions`;
- funcao citada numa pessoa e que nao existe mais nao da nada (falha fechada).

### admin_activity_log

Auditoria de acoes sensiveis do CMS.

- id;
- actor_user_id;
- action;
- target_type;
- target_id;
- metadata jsonb;
- created_at.

Regras:

- somente usuarios com papel administrativo em `admin_roles` podem acessar `/admin`;
- APIs `/api/admin/*` tambem exigem papel administrativo;
- edicoes de conteudo devem gerar log;
- alteracoes de entitlement, regra de liberacao e webhook reprocessado devem ser auditaveis;
- chaves de provedores, service role e segredos de webhook nunca ficam no browser.

### CRM de alunos

A tela administrativa de alunos deve ser uma visao operacional sobre `users`, `profiles`, `external_accounts`,
`products`, `entitlements`, `product_progress`, `student_events` e `webhook_events`.

Dados exibidos por aluno:

- listagem operacional enxuta: foto/avatar, nome, email, ultimo acesso, status, engajamento e produtos;
- detalhe do aluno: nome, email, foto/avatar, categoria, origem, primeiro acesso, ultimo acesso e quantidade de acessos;
- telefone, documento, cidade/UF, tags e observacoes continuam editaveis quando forem necessarios para suporte, mas nao devem poluir a listagem padrao;
- origem principal: hotmart, ticto, tiktok, kiwify ou manual;
- identificador externo do comprador/aluno quando existir;
- cursos, formacoes e bootcamps comprados, sempre representados por entitlements internos;
- capas dos produtos comprados devem aparecer compactas na listagem, sem abrir uma linha extra que desalinhe a tabela;
- clicar nos produtos da listagem deve levar ao detalhe do aluno, onde a lista completa de produtos fica organizada;
- turma/coorte de cada produto comprado, com regras de conteudo por segmento e extras opcionais;
- uma turma pode ter conteudo base igual ao produto principal e extras exclusivos que nao aparecem nas demais turmas;
- turma e categoria ajudam a segmentar liberacao, suporte e campanhas dentro do mesmo produto;
- status de acesso: active, suspended, revoked ou expired;
- progresso por produto e ultima atividade;
- engajamento derivado de acessos, progresso e atividade, exibido como nenhum, baixo, medio, alto ou altissimo;
- tags operacionais para suporte, segmentacao e acompanhamento.

Regras:

- adicionar aluno manualmente deve criar ou vincular perfil e gerar entitlement de origem `manual`;
- cadastro manual deve oferecer convite por email como padrao e senha temporaria como alternativa operacional;
- senha temporaria pode ser gerada automaticamente ou definida pelo admin, mas nao deve ser persistida no CMS;
- quando senha temporaria for usada, o usuario em Supabase Auth deve receber `must_change_password = true` em `user_metadata`;
- no primeiro acesso, alunos com `must_change_password = true` sao enviados para `/alterar-senha` antes de acessar aulas;
- compras de Hotmart, Ticto, TikTok, Kiwify ou plataformas similares entram por webhooks/adaptadores e atualizam entitlements;
- remover um aluno pelo CRM nao deve apagar historico bruto de webhook nem eventos de auditoria, mas deve revogar os entitlements criados pela propria operacao manual do CRM;
- a listagem por curso deve consultar alunos que possuem entitlement para o produto ou curso selecionado;
- filtros de CRM podem combinar origem, status, produto/curso, texto livre, tags e atividade.
- o modal de aluno deve bloquear o scroll da pagina de fundo via primitiva `Dialog`, sem efeito manual no `body`, e deixar a rolagem apenas na camada externa do modal;
- turmas podem liberar conteudos extras exclusivos por produto, sem expor esses extras para outras turmas.
- a navegacao lateral do CMS deve abrir e fechar pelo hamburger, seguindo o padrao de drawer da area do aluno.

## Conteudo

### courses

- id;
- sale_scope: standalone, formation_internal;
- product_id: obrigatorio apenas quando `sale_scope = standalone`;
- title;
- slug;
- description;
- cover_url;
- hero_url;
- hero_media_type: image, video;
- hero_badge;
- hero_title;
- hero_description;
- hero_cta_label;
- hero_cta_url;
- hero_visibility_config: controla exibicao opcional de selo, titulo, descricao e CTA;
- page_presentation_mode: module_cards, lesson_playlist;
- module_open_mode: lesson_page, expand_lessons;
- internal_card_action_mode: button, implicit;
- instructor_name;
- instructor_handle;
- instructor_avatar_url;
- level_label;
- duration_label;
- short_promise;
- status: draft, published, archived;
- order_index;
- created_at;
- updated_at.

### formations

Formacoes agrupam cursos internos e sao produtos vendaveis.

- id;
- title;
- slug;
- description;
- cover_url;
- hero_url;
- hero_media_type: image, video;
- hero_badge;
- hero_title;
- hero_description;
- hero_cta_label;
- hero_cta_url;
- hero_visibility_config: controla exibicao opcional de selo, titulo, descricao e CTA;
- course_open_mode: course_page_modules, course_lesson_format;
- internal_card_action_mode: button, implicit;
- status;
- order_index.

### formation_courses

Relaciona cursos internos a uma formacao. Esses cursos nao sao vendidos separadamente.

- id;
- formation_id;
- course_id;
- order_index;
- created_at.

Regra:

- `courses.sale_scope = formation_internal` deve existir em `formation_courses`;
- `courses.sale_scope = formation_internal` nao deve ter produto direto na vitrine;
- `courses.sale_scope = standalone` pode ter produto proprio e aparecer na vitrine.

Estado atual de implementacao: a mesma relacao esta persistida em `content_page_settings.settings.parentFormationId`. Quando `formation_courses` for materializada no schema de runtime, a migracao deve ser idempotente, validar referencias orfas e manter leitura compativel ate todos os registros serem convertidos.

### bootcamps

Bootcamps sao produtos vendaveis com estrutura propria de modulos/aulas ou relacao com cursos, conforme desenho final.

- id;
- product_id;
- title;
- slug;
- description;
- cover_url;
- status;
- order_index.

### modules

- id;
- owner_id: id da formacao, curso, mentoria, webinario, produto ou bootcamp ao qual pertence;
- owner_kind;
- title;
- description;
- image/capa;
- order_index;
- status.

Capas devem armazenar URL de objeto no bucket `content-assets`; Data URL/Base64 e aceita apenas como formato temporario de entrada no servidor e e convertida antes do `upsert`.

### lessons

- id;
- module_id;
- title;
- slug;
- description;
- video_provider;
- video_asset_id;
- video_url;
- video_embed_code;
- duration_seconds;
- thumbnail_url;
- status;
- order_index;
- published_at.

Thumbnails seguem a mesma regra de Storage: a coluna guarda URL, nunca o binario codificado. Imagens aceitas no upload de CMS sao JPG, PNG ou WebP, com limite de 8 MB.

No CMS, o cadastro de aula deve expor pelo menos: titulo, descricao, duracao, thumbnail, tipo de player/origem do video, URL ou ID do asset e codigo embed quando o player for externo/customizado. O app nao hospeda videos; ele referencia YouTube, Vimeo, Bunny Stream, Mux, URL propria segura ou codigo embed informado pelo produtor.

Na area do aluno, listas de aulas devem usar somente imagem associada a aula: thumbnail oficial do video quando disponivel ou `thumbnail_url` cadastrada para a aula. A falta de thumbnail propria nao deve ser preenchida automaticamente com capa do modulo ou imagem generica.

### lesson_materials

- id;
- lesson_id;
- title;
- file_url;
- file_type;
- access_rule_id: opcional, quando o material exigir uma condicao extra para download;
- generated_by_ai;
- ai_material_type: strategic_summary, infographic, transcript_notes, checklist, other;
- order_index;
- created_at.

Regra:

- materiais comuns podem ser baixados normalmente quando o aluno tem acesso a aula;
- materiais bonus podem exigir regra individual configurada no CMS, como avaliacao da aula, comentario, percentual minimo assistido ou outra atividade;
- a regra e por material, nao por aba inteira de materiais.

Estado atual (migracao `202610130001_lesson_materials.sql`, ainda nao aplicada em todos os bancos): colunas `id`, `lesson_id`, `title`, `description`, `file_url` (so https), `file_type` (pdf, spreadsheet, document, presentation, image, archive, audio, video, link, other), `file_size_bytes`, `unlock_rule` (`none`, `lesson_rated`, `lesson_progress` + `unlock_threshold`), `generated_by_ai`, `status` (draft, published, deleted), `sort_order`, `created_by`, `created_at`, `updated_at`. RLS ligada sem politica para aluno: o servidor le com a chave de servico depois de validar o acesso a aula e so devolve o endereco quando a regra do material foi cumprida (`src/server/member-area/lesson-materials.ts`, `src/lib/lesson-materials.ts`). Banco sem a tabela: a aula e a pagina Materiais mostram estado vazio. O cadastro de materiais no admin e a proxima etapa.

### content_release_rules

Regras configuraveis no CMS para liberar formacoes, cursos, modulos, aulas ou materiais. No produto, essas regras sao editadas dentro do item correspondente, nao como uma area isolada da navegacao principal.

- id;
- owner_type: formation, course, bootcamp, module, lesson, material;
- owner_id;
- rule_type: fixed_date, days_after_entitlement_start, days_after_course_start, lesson_progress_percent, lesson_completed, rating_submitted, comment_submitted, task_completed, manual;
- config jsonb;
- is_active;
- created_at;
- updated_at.

Estado atual: a regra fica no proprio item como `release_rule` (`ReleaseRuleConfig` em `src/lib/platform-types.ts`: `mode`, `delayValue`, `delayUnit` em horas ou dias, `fixedDate`, `requirement`). Campo opcional `anchor` (`access_start`, padrao, ou `warranty_end`) diz de onde conta o atraso de `after_enrollment`/`after_purchase`; nenhuma tela do admin grava `warranty_end` ainda.

Exemplos:

- liberar um modulo 7 dias depois da compra;
- liberar uma aula em uma data fixa;
- liberar um material bonus apenas depois de avaliacao da aula;
- liberar um arquivo depois de comentario ou atividade concluida.

### material_access_rules

Opcionalmente materializa regras especificas de materiais para consultas rapidas e auditoria.

- id;
- lesson_material_id;
- required_event_type: lesson_rating_submitted, lesson_comment_created, lesson_progress_reached, lesson_completed, task_completed;
- required_threshold;
- message_locked;
- created_at;
- updated_at.

## Progresso

### lesson_progress

- id;
- user_id;
- lesson_id;
- status: not_started, in_progress, completed;
- progress_seconds;
- progress_percent;
- resume_frame_url: opcional, quando o provider/adapter conseguir salvar uma imagem do ponto em que o aluno parou;
- completed_at;
- last_watched_at;
- lesson_reactions: mapa por aula com a avaliacao do aluno (`not-for-me`, `liked` ou `loved`) quando o progresso estiver agregado por conteudo no MVP;
- lesson_watch_states: mapa por aula com `progress_seconds`, `progress_percent`, `max_progress_percent`, `duration_seconds`, `resume_frame_url`, `status` e `last_watched_at` quando o progresso estiver agregado por conteudo no MVP;
- updated_at.

Regra de MVP:

- `Continue assistindo` deve ser derivado de aulas com `lesson_watch_states.status = in_progress` e percentual maior que 0;
- `progress_percent` representa a posicao atual para retomada/home/modulo e pode regredir se o aluno voltar o video; `max_progress_percent` preserva regras como liberar avaliacao apos 30%;
- a imagem de `Continue assistindo` deve priorizar `resume_frame_url` quando existir, depois thumbnail oficial do video, depois thumbnail cadastrada da aula ou imagem do modulo;
- aulas concluidas nao entram em `Continue assistindo`;
- a home nao renderiza fileiras sem itens depois de aplicar acesso, regras de liberacao e progresso do aluno.

### tv_sessions

Sessao temporaria criada quando um aluno autorizado usa `Assistir na TV`.

- id;
- user_id;
- content_id;
- lesson_id;
- pairing_code: codigo aleatorio de seis caracteres, unico e de curta duracao;
- pairing_expires_at;
- receiver_token_hash: SHA-256 do token entregue uma unica vez ao receptor;
- status: pending, connected, ended;
- current_time_seconds;
- duration_seconds;
- playback_state: unstarted, buffering, paused, playing, ended;
- last_command;
- command_revision;
- receiver_command_revision;
- connected_at;
- receiver_last_seen_at;
- expires_at;
- ended_at;
- created_at;
- updated_at.

Regras:

- a tabela usa RLS e revoga acesso direto de `anon` e `authenticated`; somente APIs server-side manipulam sessoes;
- o codigo pode ser pareado apenas enquanto a sessao esta `pending`, sem token e dentro da validade. A funcao de conexao usa bloqueio transacional para impedir consumo duplo;
- o token bruto existe somente no receptor durante a sessao do navegador; o banco persiste apenas o hash;
- cada comando incrementa uma revisao monotona, e a TV informa a ultima revisao aplicada;
- o heartbeat da TV atualiza presenca, posicao e estado, e alimenta `lesson_progress` do aluno dono da sessao;
- criacao, conexao, comandos e encerramento geram `student_events` auditaveis sem gravar o token.

### course_progress

Pode ser calculado, mas uma tabela materializada ajuda dashboards e home.

- id;
- user_id;
- course_id;
- completed_lessons_count;
- total_lessons_count;
- progress_percent;
- last_lesson_id;
- completed_at;
- updated_at.

### product_progress

Representa progresso contextual em um produto vendavel ou liberado, como formacao, curso avulso ou bootcamp. Nao deve ser confundido com um progresso global do aluno na escola inteira.

- id;
- user_id;
- product_id;
- target_type: formation, standalone_course, bootcamp;
- target_id;
- lessons_completed_count;
- lessons_total_count;
- lesson_progress_percent;
- tasks_completed_count;
- tasks_total_count;
- practical_progress_percent;
- overall_progress_percent;
- completion_status: not_started, in_progress, completed;
- completed_at;
- updated_at.

Regra:

- `lesson_progress_percent` mede consumo de aulas;
- `practical_progress_percent` mede execucao de quizzes, desafios, projetos e tarefas;
- `overall_progress_percent` deve ser calculado pelas regras do produto, podendo considerar apenas aulas ou exigir tarefas obrigatorias;
- nao usar um percentual global unico no sidebar como fonte principal de progresso.

### learning_tasks

Representa atividades praticas configuraveis dentro de cursos, modulos, aulas, formacoes ou bootcamps.

- id;
- owner_type: formation, course, bootcamp, module, lesson;
- owner_id;
- task_type: quiz, challenge, project, checklist, external_submission;
- title;
- description;
- required_for_completion;
- order_index;
- status: draft, published, archived;
- created_at;
- updated_at.

### learning_task_submissions

Registra resposta, entrega ou conclusao de uma atividade pratica por aluno.

- id;
- user_id;
- learning_task_id;
- status: not_started, submitted, passed, failed, reviewed;
- score;
- submitted_url;
- submitted_text;
- reviewed_at;
- completed_at;
- updated_at.

Regra:

- quizzes, desafios e projetos devem alimentar progresso pratico e eventos do aluno;
- tarefas obrigatorias podem bloquear a conclusao real de um curso, formacao ou bootcamp, conforme configuracao.

### saved_items

Lista de itens salvos/favoritados pelo aluno.

- id;
- user_id;
- target_type: formation, standalone_course, mentorship, webinar, product, bootcamp, module, lesson, material;
- target_id;
- collection_label: favoritos, assistir_depois, jornada;
- created_at;

Regra:

- o aluno pode salvar formacoes, cursos, bootcamps, modulos, aulas e materiais;
- salvar um item nao concede acesso, apenas cria uma referencia pessoal;
- itens bloqueados podem ser salvos como interesse/favorito, mas continuam dependendo de entitlement para consumo.

Implementacao atual:

- `saved_items` existe em migration Supabase com RLS por `user_id`;
- a rota `/api/saved-items` alterna salvar/remover para o usuario autenticado;
- cards da home, modal de detalhes e pagina de aula consomem `isSaved` retornado pelo backend.

## Eventos

Regra de produto: toda interacao relevante do aluno deve ser persistivel e virar dado real no Supabase para CRM, dashboards, segmentacao, suporte, recomendacao e IA futura. A interface nao deve tratar interacoes do aluno como mock quando fizerem parte de um fluxo de produto.

### student_events

Tabela append-only para comportamento do aluno.

- id;
- user_id;
- event_type;
- entity_type;
- entity_id;
- metadata jsonb;
- session_id;
- occurred_at.

Politicas atuais:

- aluno autenticado pode inserir somente evento com `user_id = auth.uid()`;
- aluno pode ler somente os proprios eventos;
- eventos de login ja usam `user_signed_in` no fluxo de email/senha e OAuth.

Exemplos de event_type:

- user_signed_in;
- user_session_started;
- home_viewed;
- course_opened;
- lesson_started;
- lesson_progress_updated;
- lesson_retention_point_recorded;
- lesson_abandoned;
- lesson_resumed;
- lesson_completed;
- lesson_completion_toggled;
- lesson_rating_submitted;
- lesson_comment_created;
- lesson_comment_reply_created;
- lesson_comment_mention_created;
- lesson_comment_reacted;
- lesson_comment_reaction_removed;
- lesson_comment_reported;
- notification_created;
- notification_read;
- saved_item_created;
- saved_item_removed;
- material_access_blocked;
- material_downloaded;
- content_release_unlocked;
- search_performed;
- support_requested.

Metadados importantes para CRM/dashboard:

- percentual assistido por aula;
- segundo exato de abandono/retomada;
- trechos com maior retencao;
- origem da conclusao: player, botao principal, check da playlist ou regra automatica;
- tipo de reacao escolhida/removida em aula ou comentario;
- comentario pai quando a interacao for resposta;
- usuarios mencionados por `@nickname` em comentario ou resposta;
- destino e motivo da notificacao: mencao, resposta ao comentario ou moderacao;
- origem do item salvo/removido: card, pagina de aula, pagina de conteudo ou material;
- frequencia de login e sessoes;
- cliques relevantes em aula, materiais, TV, salvar, comentarios e avaliacoes.

## youtube_course_imports

Registra a origem idempotente de cursos criados por playlist.

- `playlist_id`: chave primaria externa validada;
- `playlist_url`: URL canonica da playlist;
- `course_id`: curso interno unico;
- `last_manifest`: ultimo manifesto relido e validado no servidor, incluindo `organizationMode`, intervalos solicitados, conformidade da nomenclatura e arvore final;
- `created_at` e `updated_at`.

As aulas importadas usam `video_config.provider = youtube` e `assetId = videoId`. Importar nao cria `entitlements` e sempre redefine `content_items.publication_status` para `draft`.

No modo manual, `moduleRanges` armazena somente a intencao administrativa (`title`, `startPosition`, `endPosition`). A arvore persistida nunca e aceita diretamente do navegador: o servidor baixa novamente a playlist, confere cobertura integral e constroi os modulos com os videos atuais.

Reimportar a mesma playlist marca como `deleted` (com `deleted_at`) os modulos e aulas que sairam dela, em vez de `archived` (migracao `202610110010`).

## Catalogo do admin v2 (fase 1 de Produtos)

Migracoes `202610110010_catalog_v2_listing_and_soft_delete.sql` e `202610110011_catalog_v2_rpcs.sql`. Leituras e escritas em `src/server/catalog/**` (Server Actions com zod, escrita de uma linha por vez, `invalidateCatalog` depois de gravar).

### content_items.listing

- `listing text not null default 'listed'`, check `listing in ('listed', 'hidden')`;
- "Quem pode ver" = `access_model` + `listing`: "So quem tem acesso" = `closed` + `listed`; "Todos os alunos" = `free` + `listed`; "Oculto por enquanto" = `closed` + `hidden`;
- e coluna (e nao chave de `content_page_settings.settings`) porque filtra consultas da vitrine, de Minhas compras e da lista do admin, precisa de check no banco e nao pode ser apagada por quem regrava o JSON de apresentacao;
- oculto fica fora da vitrine (Produtos a venda, Em breve, secoes padrao e a lista "disponivel para comprar"), aparece em Minhas compras e na pagina do produto para quem tem acesso e responde como inexistente para quem nao tem;
- campos legados derivados a cada escrita nova: `is_locked` (= fechado), `status` (`Liberado` se aberto, senao `Bloqueado`; nunca `Em breve`), `purchase_label` (texto proprio, ou "Comprar" se fechado com link). "Em breve" e "Novo" sao calculados, nunca gravados.

### Status de modulos e aulas

- `course_modules.status` e `lessons.status` em `published`, `draft` ou `deleted` (check no banco); valores antigos fora disso viraram `draft` (`archived` virou `deleted`);
- excluir no admin novo = `status = 'deleted'` + `deleted_at` + `deleted_by` (referencia `auth.users`, `on delete set null`), com "Desfazer" que restaura o status anterior. Nada e apagado de verdade nesta fase: progresso, comentarios e avaliacoes da aula sobrevivem;
- a area do aluno so le `status = 'published'`; o admin le tudo menos `deleted`;
- aula nova nasce `published` dentro de produto em Rascunho e `draft` dentro de produto ja Publicado ou Arquivado;
- `course_modules.meta` ("N aulas") conta so aulas nao excluidas e e atualizado ao criar, excluir, restaurar e mover;
- indices `lessons (module_id, status, sort_order)` e `course_modules (owner_id, status, sort_order)`.

### Formacao

Curso incluido = `content_items.commerce_scope = 'included_content'` + `content_page_settings.settings.parentFormationId`, ordenado por `sort_order`. Remover da formacao devolve o curso como avulso em Rascunho (`sellable_product`, bucket `courses`); publicar a formacao publica junto os cursos incluidos em Rascunho.

### RPCs (security invoker, so `service_role`)

- `admin_product_list(p_kinds, p_status, p_search, p_offset, p_limit)`: pagina da lista de Produtos ja filtrada, com aulas (total e publicadas; Formacao soma os cursos incluidos), alunos com acesso ativo agora e `total_count`;
- `admin_reorder_product_content(p_content_id, p_modules)`: reescreve a ordem de modulos e aulas (inclusive entre modulos) numa transacao; conjunto de ids diferente do banco levanta `stale_structure` (a acao responde 409);
- `admin_product_cohorts(p_content_id)`: turmas com matricula ativa no produto e quantidade de alunos;
- `admin_product_students_with_access(p_content_id)`: alunos distintos com acesso ativo agora;
- `admin_patch_product_settings(p_content_id, p_set, p_unset)` (migracao `202610110012`): muda so as chaves pedidas de `content_page_settings.settings` num UPDATE atomico (`(settings - p_unset) || p_set`); sem chaves, a linha sai. Nenhuma escrita do admin novo le e regrava o JSON inteiro;
- `admin_add_course_to_formation`, `admin_remove_course_from_formation`, `admin_reorder_formation_courses`: `commerce_scope`, `sort_order` e `parentFormationId` do curso mudam na mesma transacao, com a formacao travada; conjunto divergente levanta `stale_structure` (409);
- `admin_save_combo(...)`: dados do pacote e troca de `product_combo_items` na mesma transacao.

Reordenar aceita a estrutura que ja existe ate o limite da importacao de playlist (100 modulos, 500 aulas por modulo); os limites de criacao (50 modulos, 100 aulas por modulo) valem so para criar.

`import_youtube_course` mantem `publication_status` e a capa de um curso que ja existe, so marca como excluidas aulas `yt-lesson-<playlist>-*` que sairam da playlist, nao republica aulas em Rascunho nem as excluidas pelo produtor (`deleted_by` preenchido) e nao esconde modulo da playlist que ainda tem aula criada pelo produtor. O admin novo recusa importar de novo uma playlist que ja virou curso, na tela e no banco: `admin_import_new_youtube_course` (migracao `202610170001`) trava a playlist e levanta `playlist_already_imported` antes de chamar `import_youtube_course`.

### Imagens do produto

Thumbnail do card (WebP 2:3, ate 720×1080; imagem menor sai no tamanho dela, sem ampliar) e imagem de topo (WebP 1920×720) sao recortadas no navegador; o servidor confere a medida no cabecalho do WebP, envia ao Storage (`content-assets`, caminho `content/{id}/{cover|hero}`) e grava so a URL publica (thumbnail em `content_items.image`, topo em `content_page_settings.settings.hero`). A capa propria dos modulos usa a mesma medida. Data URL nunca chega ao banco.

### Edicao concorrente

Toda edicao do admin novo envia o `updated_at` lido; a gravacao filtra por ele. Nenhuma linha afetada = 404 se o registro nao existe (ou foi excluido), senao 409 "Alterado em outro lugar ha instantes".

### Deploy antes da migracao

O codigo pode ir para producao antes das migracoes `202610110010`, `202610110011`, `202610110012` e `202610110020`. A area do aluno e o admin legado nao dependem delas: `listing` e lido como opcional (ausente = listado), `.neq('status', 'deleted')` nao muda nada enquanto nao ha linha `deleted`, e nenhuma rota REST chama RPC nova. As telas novas do admin que dependem delas (Produtos, Comunidade) trocam os dados pelo aviso "Esta tela precisa da atualizacao do banco (migracoes 202610110010-0020)": `failOnError`/`assertNoDbError` convertem erro de coluna, tabela ou funcao inexistente (42703, 42P01, 42883, PGRST202/204/205) em `PendingMigrationError` (`src/server/db/pending-migration.ts`). O contador da Comunidade no menu some ate a `202610110020` existir. Pacotes nao dependem das migracoes: sem `admin_save_combo`, salvar grava em passos, como antes. Ordem de aplicacao: `202610110010` → `202610110011` → `202610110012` → `202610110020`.

## Comunidade do admin v2 (fase 1)

Migracao `202610110020_community_v1.sql`. Leituras em `src/server/community/queries.ts` (RPCs, uma pagina por vez) e Server Actions em `src/server/community/actions.ts` e `rules.ts` (`runAdminAction` com `community.reply` ou `community.moderate`).

### lesson_comments: resolvido

- `resolved_at timestamptz` e `resolved_by uuid` (referencia `auth.users`, `on delete set null`): o professor tira a pergunta da fila "Precisam de resposta" sem responder; "Desfazer" limpa as duas colunas. Responder pela fila ja resolve junto;
- a area do aluno nao le estas colunas;
- indices parciais: fila (raiz de aluno, aprovada, nao excluida, nao resolvida, por `created_at`), respostas de professor/moderador por pergunta, `(status, created_at desc)` para a aba Comentarios e `ai_conversations (lesson_id)` para perguntas ao Tutor IA por aula.

### community_quick_replies

- `id`, `title` (1-60), `body` (1-2000, com `{nome}` e `{aula}`), `sort_order`, `created_by`, `updated_by`, `created_at`, `updated_at` (trigger `set_updated_at`);
- RLS ligada e nenhum acesso para `anon`/`authenticated`: so o servidor (`service_role`) le e grava, depois de conferir o papel.

### Views internas (so `service_role`)

- `community_open_questions`: pergunta sem resposta = comentario raiz de aluno, `approved`, sem `deleted_at`, nao resolvido e sem resposta visivel de professor/moderador;
- `community_report_state`: denuncia aberta = comentario visivel com denuncia mais nova que a ultima acao de moderacao.

Toda contagem da Comunidade usa estas definicoes e ignora aula ou modulo `deleted` e comentario com `deleted_at`.

### RPCs (security invoker, `search_path` fixo, so `service_role`)

- `community_lesson_scope(p_content_id)`: aulas visiveis de um produto (formacao inclui os cursos incluidos);
- `community_unanswered(...)`, `community_stats(...)`, `community_comment_list(...)`, `community_reported_comments(...)`, `community_top_commenters(...)`, `community_lesson_rows(...)`: fila, quatro numeros do topo, aba Comentarios, Denuncias, Top alunos (28 dias) e Aulas, sempre paginadas no banco;
- `community_filter_options()`: produtos e aulas para os filtros;
- `community_overdue_count(p_hours)`: perguntas sem resposta ha mais de `p_hours` horas (contador do menu e alerta de Hoje).

## Area de membros do admin v2 (login, destaque, modulos)

Rodada de 2026-10-11 (`docs/17`, "Registro da rodada Area de membros"). Sem migracao nova: tudo usa `platform_settings`, `content_page_settings` (pela RPC `admin_patch_product_settings` da `202610110012`) e `course_modules.image`. Leituras e Server Actions em `src/server/member-area/**` e `src/server/catalog/module-cover-actions.ts`.

### platform_settings: versao por chave

- `updated_at` e a versao de cada chave. A tabela nao tem gatilho: toda gravacao carimba a coluna (Server Actions novas por `writePlatformSettingGuarded` e as gravacoes do `platform-store.ts`: `publishHomeSections`, `updatePlatformAppearance`, `updateAdminDashboardCollections`);
- quem edita le a versao junto com o valor e manda de volta ao gravar: `UPDATE ... WHERE key = ? AND updated_at = ?` (ou `INSERT` quando a chave nao existia). Nenhuma linha afetada (ou chave criada no meio) = 409 "Esta configuracao mudou em outra tela ha instantes";
- `PUT /api/admin/home-sections` aceita `expectedUpdatedAt` (confere antes de gravar) e responde `{ data, sectionsUpdatedAt }`. A Vitrine nova e, desde esta rodada, a Vitrine do admin antigo (campo `homeSectionsUpdatedAt` de `AdminDashboardData`) mandam a versao. Sem o campo, a rota grava como antes;
- gatilho de `updated_at` no banco fica sugerido para a fase 6 (pegaria SQL manual).

### platform_settings.loginPage

JSON validado por zod (`src/server/member-area/login-model.ts`); chave ausente ou invalida = o login padrao (o `/login` nunca quebra).

- `version`: 1;
- `template`: `split-visual-right`, `split-visual-left`, `center-glass`, `side-glass-right`;
- `panelTone`: `dark`, `glass`, `light` (Escuro, Translucido, Claro);
- `sideImage` e `backgroundImage`: `{ url, alt }`. `url` e link https (Storage) ou imagem padrao do app (`/login/...`), `null` = imagem padrao; `alt` ate 160. Os modelos divididos usam `sideImage` (1200 x 1500), os modelos sobre a imagem usam `backgroundImage` (1920 x 1080); trocar de modelo nao apaga a outra;
- `quote` (ate 160) e `quoteDetail` (ate 240): frase da imagem, so nos modelos divididos;
- `formTitle` (ate 80) e `formSubtitle` (ate 200), opcionais;
- `supportLabel` (ate 60), `supportLinkLabel` (ate 40) e `supportHref`: so `https://` ou `mailto:`; `null` esconde a linha de ajuda;
- `googleEnabled`: mostra o botao "Entrar com Google" (Apple fica fora).

A logo do login nao fica aqui: vem de `platform_settings.branding` (Marca). Nenhuma chave de provedor de auth e gravada. O `/login` le `loginPage` e `branding` com `unstable_cache` (tags `member-area-login` e `catalog`, revalidacao de 1 h); publicar chama `updateTag("member-area-login")`. O parametro `?template=` do endereco nao muda mais o visual.

### platform_settings.hero (campos novos)

`HomeHeroConfig` ganhou, sem quebrar o que existia:

- `cta`: `{ href, label, target }`. `href` e caminho interno da area (comeca com uma `/`, nunca `//`, `/\`, espaco ou `/api`; ate 512) ou link `https://`; `label` ate 32; `target` `same_tab` ou `new_tab`. Produto grava `/conteudo/{id}`;
- `poster`: capa do video (obrigatoria quando `mediaType = video`; mesma medida da imagem, 1920 x 720);
- `glowColor`: cor da luz de fundo atras do destaque (`#rrggbb`); ausente = automatica, medida na imagem no navegador do aluno (13/10/2026);
- `visibility.cta`: mostra o botao.

`image` continua sendo a imagem (`mediaType = image`) ou o link do video (`.mp4`, `.webm`, `.mov`, so https). Texto escondido continua guardado. Chaves desconhecidas (ex.: `purpose`) sao preservadas pela gravacao. A home normaliza o que esta gravado (`resolveHomeHero`) e descarta botao com link inseguro, inclusive o que o admin antigo ou SQL manual gravarem.

### platform_settings.homeSections (fileira de modulos)

A fileira de modulos de um produto e uma secao `content_structure` (`contentSource = selected_content_structure`, `sourceContentId` = produto). A tela Modulos liga (`isActive`) ou cria (layout `compact`, `visibility = all`, antes de "Produtos a venda", senao depois de "Minhas compras", senao no fim) e troca o `title` (ate 80). Vitrine nunca publicada: a primeira gravacao fixa a ordem padrao atual mais a fileira. Desligar mantem titulo e posicao.

### content_page_settings

- `coursePresentationMode` (`module_cards` ou `lesson_playlist`): gravado pela tela Modulos e pela aba Detalhes com `admin_patch_product_settings` (so essa chave). Formacao nao tem (abre nos cursos dela);
- `homeModuleSection`: espelho usado so como padrao de uma vitrine nunca publicada. A fonte da verdade da fileira e `homeSections`; com a Vitrine publicada, a home ignora esta chave.

### course_modules.image (capa do modulo)

WebP 720 x 1040 recortado no navegador, conferido no servidor e enviado ao Storage (`content-assets`, `content/{produto}/modules/{modulo}/...`); so a URL fica na coluna. "Usar a capa do produto" grava de novo a capa atual do produto (a coluna e `not null`; o modulo ja nasce com uma copia dela). Gravacao com `updated_at` lido (409 se mudou).

### Storage

Pastas novas no bucket `content-assets`, nome do arquivo pelo hash do conteudo: `platform/home-hero`, `platform/login-side`, `platform/login-background`. Teto conferido no cabecalho do WebP: 230 KB para destaque e capas, 420 KB para as imagens do login. Imagem enviada e depois descartada fica sem referencia (limpeza fica para depois).

### Admin antigo (removido em 14/10/2026)

O admin antigo (`/admin/legado`, `src/components/admin-dashboard.tsx`, rotas `/api/admin/{students,content,modules,lessons,combos,cohorts,collections,youtube-playlists}`) saiu do projeto. Existe um admin so (`src/app/admin/(v2)`). As tabelas `students`, `student_courses` e `student_access_logs` foram derrubadas pela migracao `202610140001_remove_legacy_admin_students.sql`; a funcao `admin_product_cohorts` mantem a assinatura e devolve vazio ate existir vinculo aluno x turma no modelo novo. Alunos passaram a ser `auth.users` + `profiles` + `entitlements` (ver "Alunos" em `docs/17` §1.7).

## Alunos (entrega 2, 15/10/2026, migracao 202610150001)

- `admin_audit_log(id, actor_id -> auth.users set null, action, entity_type, entity_id, count, metadata jsonb <= 4 KB, occurred_at)`: quem fez o que no admin (acesso, exportacao, importacao, exclusao). Append-only: o servidor so insere e le (`grant select, insert` para `service_role`). Metadata guarda ids e contagens; nunca nome, busca digitada ou e-mail, exceto a prova da exclusao.
- `student_segments(id, name unico sem maiusculas, params jsonb <= 2 KB, created_by, created_at, updated_at)`: segmentos salvos da lista de Alunos; `params` e a forma canonica dos filtros do endereco, revalidada ao abrir.
- `cohort_memberships(id, user_id -> auth.users cascade, product_id -> content_items cascade, cohort_id -> cohorts cascade, created_by, created_at; unique (user_id, product_id))`: uma turma por aluno por produto. `cohorts.name` ganhou indice unico por `lower(name)`. `admin_product_cohorts` conta so alunos com acesso aberto ao produto (sem a equipe). Modelo diferente do previsto em §cohort_memberships (sem `entitlement_id`): `grantProductAccess` garante um acesso por (aluno, produto).
- `profiles.last_sign_in_at`: copiado de `auth.users` pelo gatilho `on_auth_user_signed_in` (`sync_profile_last_sign_in`, security definer, nunca lanca erro). `authenticated` so atualiza `full_name, phone, avatar_url` em `profiles`.
- `student_daily_activity(user_id -> auth.users cascade, day, content_id, seconds_watched, lessons_completed, approximate, updated_at; pk (user_id, day, content_id))`: estudo real por dia, gravado por `record_student_activity` (no maximo 30 s e 50 aulas por chamada; dia em America/Sao_Paulo) depois de cada progresso confirmado. Backfill aproximado a partir de `lesson_watch_states.lastWatchedAt`.
- RPCs `admin_lifecycle_weeks(p_weeks)` (<= 26 linhas prontas: novos, retidos, recuperados, inativos por semana) e `admin_lifecycle_week_members(p_week_start, p_group)` (ate 1000 ids), ambas `security invoker`, so `service_role`.

## Webhooks

Migracao `202610170003_sales_webhooks.sql` (17/10/2026). Fluxo em `docs/04-arquitetura-tecnica.md`, secao Webhooks externos; tela em `docs/17` §1.10. Nada aqui e lido pelo navegador: RLS ligado, nada para `anon`/`authenticated`, so `service_role`.

### webhook_events

Guarda o evento bruto de plataformas externas (so depois do token conferido) e o resultado do processamento.

- id uuid;
- provider: hotmart, ticto, kiwify;
- external_event_id (id do evento na plataforma; Hotmart: `id` do payload, ou `transaction:evento` sem ele);
- event_type (nome como a plataforma manda, ex.: `PURCHASE_APPROVED`);
- normalized_type: purchase_approved, refund, chargeback, subscription_canceled, other;
- payload jsonb (<= 512 KB; so os campos permitidos: envelope, produto, compra, assinatura e e-mail, nome e telefone do comprador; token, documento, endereco, afiliados e comissoes nunca entram; evento que nao muda acesso guarda so o envelope; exclusao do aluno deixa so o envelope com `anonymized: true`);
- transaction_id (migracao `202610170005`; id da compra na plataforma, igual em todos os eventos da mesma venda; indice (provider, transaction_id));
- processing_started_at (migracao `202610170005`; inicio do processamento ou do reprocesso; reenvio de evento preso em `received` reivindica a linha por update condicional nesta coluna);
- signature_valid;
- processing_status: received, processed, failed, ignored;
- outcome: access_granted, access_revoked, access_suspended, ignored, failed;
- outcome_detail (motivo escrito, <= 500);
- buyer_email, external_product_id, external_product_name (para a lista da tela, mesmo sem ligacao);
- product_id, combo_id (alvo resolvido, sem chave estrangeira: o historico fica se o produto sair);
- user_id -> auth.users (set null);
- received_at, processed_at;
- error_message (<= 2.000);
- anonymized_at: quando a retencao de 12 meses apagou payload, buyer_email e error_message (migracao 202610170004).

Obrigatorio:

- idempotencia por provider + external_event_id (indice unico; repetido responde 200 sem reprocessar);
- guardar payload bruto;
- nao confiar no payload sem validacao: o acesso so muda por `entitlements`, via `src/server/students/access.ts`.

Retencao: 12 meses depois de `received_at` (docs/17 §2.4), `public.prune_personal_data()` (secao Retencao de dados pessoais) troca `payload` por `{}`, anula `buyer_email` e `error_message` e marca `anonymized_at`. A linha fica: `provider` + `external_event_id` continuam barrando o evento repetido, `transaction_id` e `normalized_type` (migracao `202610170005`) continuam barrando a compra reenviada depois de reembolso ou chargeback (`hasClosingEventForTransaction`), e a tela de Vendas mostra "Dados apagados (12 meses)" sem o botao Reprocessar (`canReprocessSaleEvent` olha `anonymized_at`; a acao responde 409).

### sales_product_links

Codigo do produto na plataforma de venda ligado a um produto ou a um pacote da escola.

- id uuid;
- provider: hotmart, ticto, kiwify;
- external_product_id (Hotmart: o numero do produto, `data.product.id`);
- product_id -> content_items (cascade) ou combo_id -> product_combos (cascade), exatamente um;
- created_by, created_at, updated_at.

Indices unicos: (provider, external_product_id), (provider, product_id) e (provider, combo_id), inteiros (nulos nao conflitam) para o upsert do servidor. Gravado por "Codigo do produto na Hotmart" em Produtos > Acesso e venda (`updateProductAccess`, `catalog.access`) e em Pacotes (`saveCombo`). Venda de pacote libera todos os produtos dele; reembolso ou chargeback de pacote tira todos (docs/17 §1.6.8); pacote em rascunho ou pausado nao libera nada.

### entitlements.source_event_id nas vendas

Compra pela plataforma grava `source_provider = hotmart` e `source_event_id` = id da compra (`purchase.transaction`; sem ele, o id do evento). Quando um evento libera mais de um produto (pacote), cada linha leva o sufixo `:<produto>` (indice unico `(user_id, source_event_id)`). `warranty_expire_date` chega normalizado (`warrantyEndsAt`) mas ainda nao e gravado: a coluna `warranty_ends_at` continua o ponto de extensao descrito em §entitlements.

### sale_grants

Migracao `202610170008_sale_grants.sql`. Vinculo venda -> acesso: um acesso (um por aluno e produto) pode ser sustentado por mais de uma venda, ou ter nascido da equipe e so ganhado prazo numa venda; `source_event_id` guarda uma origem so.

- id uuid;
- provider; transaction_id (a compra; igual a `entitlements.source_event_id` da venda, sem o sufixo do produto);
- subscription_code (Hotmart: `subscriber.code`; cobrancas da mesma assinatura nao sustentam o acesso umas das outras);
- user_id -> auth.users (cascade); entitlement_id -> entitlements (cascade); product_id;
- opened: true quando a venda abriu o acesso (nao existia ou estava fechado); false quando so estendeu um acesso aberto;
- previous_ends_at: prazo que o acesso tinha antes (so quando estendeu), para o reembolso devolver;
- webhook_event_id -> webhook_events (set null); closed_at, closed_by (refund, chargeback, subscription_canceled);
- created_at.

Indices: unico (provider, transaction_id, entitlement_id); (entitlement_id); (provider, subscription_code). So `service_role`. Nenhum dado pessoal (so ids). Regras de decisao em `decideOnClosedGrant` (`src/server/payments/model.ts`) e em docs/04. A mesma migracao acrescenta o resultado `access_restored` ("Prazo devolvido") em `webhook_events.outcome`.

### admin_access_origins(p_start, p_end, p_content_id)

RPC `security invoker`, so `service_role`: acessos criados na janela por `source_provider` (hotmart, manual...), sem a equipe, com as mesmas regras de `admin_access_buckets`. Alimenta o rodape de "Novos acessos" no Hoje ("3 pela Hotmart · 2 pela equipe").

## Jobs

### job_runs

Registro de cada execucao do tick de minuto (`POST /api/jobs/tick`) e de cada job do registro (`src/server/jobs/registry.ts`). Migracao `202610100001_jobs_cron.sql`.

- id uuid, chave primaria;
- job: nome do job (`tick` para o proprio tick; demais em kebab-case);
- status: running, succeeded, failed;
- started_at;
- finished_at: nulo somente enquanto `status = running` (check no banco);
- attempts: comeca em 1; reservado para retentativas e dead-letter apos 3 falhas;
- error: mensagem truncada em 2.000 caracteres pela aplicacao (limite de 4.000 no banco);
- metadata jsonb (objeto): no tick, `source`, `scheduled_at`, `ran`, `failed`, `skipped`; nos jobs, `tick_run_id`.

Indices: `(job, started_at desc)` para historico por job e indice parcial em `started_at` para `status = running`, usado pelo tick para marcar como `failed` execucoes presas ha mais de 15 minutos.

Seguranca: RLS ligada sem policies e `revoke all` de `anon` e `authenticated`; somente o servidor (service role) le e grava.

Retencao: `public.prune_job_history()`, agendada diariamente, apaga linhas com sucesso apos 30 dias e com falha apos 90 dias.

Agendamentos (`cron.job`): `bunker707-jobs-tick` (a cada minuto, chama `public.enqueue_jobs_tick()`), `bunker707-jobs-history-prune` (diario) e `bunker707-personal-data-prune` (diario, chama `public.prune_personal_data()`; secao Retencao de dados pessoais). Segredos no Vault: `jobs_tick_url` e `jobs_tick_token`.

## E-mail transacional

Migracao `202610170002_email_outbox.sql`. Fluxo e regras em `docs/04-arquitetura-tecnica.md`, secao E-mail transacional.

### email_outbox

Fila de saida: quem dispara (venda por webhook, Adicionar aluno, importacao) insere uma linha; o job `email-outbox` do tick envia.

- id uuid, chave primaria;
- kind: `welcome` (boas-vindas) ou `purchase` (acesso liberado por compra);
- user_id -> auth.users (set null ao excluir a conta);
- to_email, subject, html, text: o e-mail pronto, montado pelo template na hora de enfileirar (`to_email` e `html` ficam nulos so depois da retencao; check no banco);
- idempotency_key: unica (`welcome:<user_id>`, `purchase:<provedor>:<evento>:<user_id>`); a mesma chave vai ao provedor;
- status: queued, sending (reservada por um tick), sent, failed, bounced, complained;
- attempts: tentativas feitas; na quinta falha passageira a linha vira `failed`;
- next_attempt_at: quando pode sair (espera crescente depois de uma falha passageira);
- last_error: motivo da ultima falha, do bounce ou da reclamacao (ate 2.000 caracteres);
- provider, provider_message_id: quem enviou e o id devolvido (o webhook localiza a linha por ele);
- sent_at, delivered_at, bounced_at;
- metadata jsonb (<= 4 KB): so ids e rotulos curtos (`password_hint`, `product_ids`, `source_provider`, `source_event_id`);
- created_at, updated_at (gatilho `set_updated_at`);
- anonymized_at: quando a retencao apagou to_email, html, text e last_error (migracao 202610170004).

Indices: parcial em `next_attempt_at` para `status in (queued, sending)` (o que o job busca), parcial em `sent_at` (limite diario), parcial em `provider_message_id` (webhook) e `(user_id, created_at desc)`.

Seguranca: RLS ligada sem policies, `revoke all` de `anon` e `authenticated`; so o servidor (service role) le e grava. O HTML guardado tem o e-mail e o nome do aluno: e dado pessoal. A exclusao da conta anula `user_id`; a retencao por idade (secao Retencao de dados pessoais) anula `to_email`, `html`, `text` e `last_error` 90 dias depois de criada a linha enviada e 180 dias nos demais casos, mantendo `kind`, `status`, `idempotency_key`, datas e `metadata`.

### email_webhook_events

Payload bruto de cada evento do provedor, para auditoria e reprocesso.

- id uuid;
- provider (`resend`) + event_id (cabecalho `svix-id`): unicos; o mesmo evento entregue de novo nao e aplicado duas vezes;
- event_type (`email.delivered`, `email.bounced`, `email.complained`, `email.failed`, ...);
- provider_message_id: `data.email_id` do payload;
- payload jsonb (<= 64 KB), received_at, processed_at;
- outbox_id -> email_outbox (set null): a linha que o evento alterou, quando havia;
- error: falha ao aplicar, se houve.

Seguranca: RLS ligada sem policies, nada para `anon`/`authenticated`; so o servidor insere e atualiza. Eventos de e-mails que nao sairam da fila (Auth do Supabase pelo mesmo Resend) ficam so registrados. Retencao: apagados 90 dias depois de `received_at` pela mesma rotina (secao Retencao de dados pessoais); o payload traz o destinatario, e `delivered_at`, `bounced_at` e `last_error` ja ficaram em `email_outbox`.

## Retencao de dados pessoais

Migracao `202610170004_personal_data_retention.sql` (17/10/2026). Regras em `docs/06-seguranca-operacao.md`, secao LGPD; teste `tests/integration/retencao-de-dados-pessoais.test.mjs`.

`public.prune_personal_data()` (security definer, `search_path` fixo; so `service_role` executa, `anon`/`authenticated` recebem `permission denied`) roda todo dia as 06:23 UTC pelo agendamento `bunker707-personal-data-prune` e devolve quantas linhas mudou em cada tabela:

| Tabela | Quando | O que sai | O que fica |
|---|---|---|---|
| `webhook_events` | 12 meses depois de `received_at` | `payload` (vira `{}`), `buyer_email`, `error_message` | provider, `external_event_id` (idempotencia), `transaction_id` e tipo (reembolso antigo segue barrando a compra reenviada), resultado, motivo, alvo, `user_id`, datas; `anonymized_at` marcado |
| `email_outbox` | 90 dias depois de `created_at` se `sent`; 180 dias nos demais status (falha, bounce, reclamacao e o que ainda estava na fila, que vira `failed` com o motivo) | `to_email`, `html`, `text`, `last_error` | `kind`, `user_id`, `subject`, `idempotency_key`, `status`, datas, `metadata`; `anonymized_at` marcado |
| `email_webhook_events` | 90 dias depois de `received_at` | a linha inteira | nada (entrega, bounce e motivo ja estao em `email_outbox`) |

Fora da rotina de proposito: `sale_grants` (migracao `202610170008`) so guarda ids (transacao, codigo da assinatura, aluno, acesso, produto) e datas, sem dado pessoal; sai junto com a conta (`on delete cascade`). Idempotente: linha com `anonymized_at` nao e tocada de novo. Checks no banco garantem a coerencia (`webhook_events_anonymized_consistent`; `email_outbox_anonymized_consistent`: `to_email` e `html` so sao nulos em linha anonimizada). A exclusao da conta anula `user_id` nas duas tabelas (`on delete set null`), e "Excluir aluno" ja anonimiza na hora as vendas do aluno (`anonymizeWebhookEventsFor`); prazos novos sao mudanca de migracao, com o teste ajustado.

## Suporte

### support_tickets

- id;
- user_id;
- subject;
- message;
- status: open, pending, closed;
- category;
- created_at;
- updated_at.

## Fase futura

Comunidade:

- communities;
- community_categories;
- community_topics;
- community_posts;
- community_reactions.

Ranking:

- points_ledger;
- ranking_periods;
- ranking_snapshots.

IA:

- experiencia e fontes indexadas da IA Diretor (`platform_guide`);
- ai_feedback;
