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
admin_activity_log
lesson_progress
course_progress
product_progress
learning_tasks
learning_task_submissions
saved_items
student_events
webhook_events
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
- o modo de preview de acesso e ferramenta administrativa: so aparece para usuarios com papel em `admin_roles` e nao altera a experiencia de alunos comuns.

## Home configuravel

### home_sections

- id;
- title;
- subtitle;
- order_index;
- section_type: continue_watching, purchases, course_modules, showcase, upcoming, custom;
- visibility: students, non_students, all;
- content_source: manual, entitlement_products, selected_course_modules, sellable_products, upcoming_products, recent_lessons;
- source_content_id: curso/produto usado quando `section_type` for `course_modules`;
- is_active;
- created_at;
- updated_at.

Regras:

- `purchases` deve listar produtos com entitlement ativo do aluno, agrupando formacoes, bootcamps e cursos avulsos;
- `showcase`/`sellable_products` pode listar produtos comprados e nao comprados, conforme configuracao;
- produtos sem entitlement aparecem bloqueados na UI;
- `upcoming_products` pode listar produtos futuros, novidades e listas de espera;
- `course_modules` mostra os modulos de um curso especifico escolhido pelo produtor, com capa vertical reduzida do curso à esquerda e, à direita, rotulo pequeno, titulo e botao de acao abaixo do titulo;
- `course_modules` pode aparecer para alunos com ou sem entitlement ativo; os cards de modulos nao exibem botao proprio e usam clique no card; sem acesso, o curso mostra acao `Comprar` e os modulos abrem o modal de detalhes por padrao;
- o botao `Comprar` pode abrir o modal de detalhes ou o link externo de compra, conforme configuracao do CMS;
- modulos dentro de `course_modules` continuam respeitando regras de compra, entitlement, drip/agendamento e podem aparecer bloqueados;
- a regra `visibility` define se a secao aparece apenas para alunos/compradores, apenas para nao compradores/visitantes ou para todos.

## Login configuravel

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

Regras:

- personalizacao altera apresentacao, texto, imagens, ordem e preview, mas nao concede acesso;
- a home/vitrine editavel deve ser uma representacao fiel da home real do aluno em modo editor, com controles discretos sobre banner, textos e secoes;
- o editor da home deve consumir as mesmas `home_sections`/`homeRows` resolvidas pela home publicada, preservando variantes como `continue_watching`, `vertical` e `course_modules`;
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
- author_name, author_username, author_avatar_url e author_role como snapshot de exibicao;
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

- id;
- provider: hotmart, ticto, tiktok, kiwify, manual;
- webhook_url;
- secret_status;
- status: not_configured, configured, needs_attention;
- events jsonb;
- last_sync_at;
- created_at;
- updated_at.

Regras:

- segredos reais de webhook ficam somente no servidor ou gerenciador de segredos;
- dados de plataforma externa sao entrada para processamento, nao fonte de autorizacao;
- cada provider deve ter adapter proprio.

## Agentes de IA

### ai_agents

- id;
- name;
- scope: comments, lesson_tutor, global_assistant, home_chat;
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

Regras:

- agentes de comentarios, tutor de aula e assistente geral podem ser configurados antes da IA estar conectada;
- respostas automaticas devem ficar desligadas por padrao ate treinamento e revisao;
- agentes nao podem revelar conteudo sem entitlement ativo para o aluno.

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

O construtor de criacao e edicao do Catalogo deve abrir em um modal central sobre a listagem. Criar item, editar item, criar curso, modulo ou aula nao deve transformar a pagina inteira em formulario nem navegar para uma pagina separada; o contexto operacional do catalogo permanece visivel por baixo do modal.

Campos planejados/adicionados ao item educacional:

- access_model: closed ou free;
- max_students: numero maximo de estudantes ou nulo para ilimitado;
- purchase_url: pagina de vendas ou checkout externo para itens bloqueados;
- purchase_target: same_tab ou new_tab;
- release_rule: regra de entrega/publicacao.
- cover_url/image: capa vertical enviada pelo produtor, preferencialmente em 720 x 1040 px nesta fase;
- hero media opcional via `content_page_settings.hero`, com tamanho definido de 1920 x 720 px para pagina propria do curso/produto.
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

Permissoes de usuarios administrativos com Supabase Auth.

- id;
- user_id;
- role: owner, admin, editor, support, analyst;
- permissions jsonb;
- created_at;
- updated_at.

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

## Webhooks

### webhook_events

Guarda o evento bruto de plataformas externas.

- id;
- provider;
- external_event_id;
- event_type;
- payload jsonb;
- signature_valid;
- processing_status: received, processed, failed, ignored;
- processed_at;
- error_message;
- created_at.

Obrigatorio:

- idempotencia por provider + external_event_id;
- guardar payload bruto;
- nao confiar no payload sem validacao.

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

- lesson_transcripts;
- content_chunks;
- ai_conversations;
- ai_messages;
- ai_feedback;
