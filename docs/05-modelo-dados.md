# Modelo de Dados Inicial

Este e um modelo conceitual para o MVP. O schema final pode ser ajustado durante a implementacao.

## Entidades principais

```txt
users
profiles
external_accounts
products
entitlements
courses
formations
formation_courses
bootcamps
modules
lessons
lesson_materials
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
support_tickets
```

## Usuarios e perfil

### users

Representa a identidade autenticada. Pode vir de Clerk ou Supabase Auth.

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
- user_id;
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
- type: formation, standalone_course, bootcamp, platform_access;
- name;
- slug;
- description;
- target_type: formation, standalone_course, bootcamp, platform;
- target_id;
- active;
- created_at.

### entitlements

Permissoes reais do aluno.

- id;
- user_id;
- source_provider;
- source_event_id;
- product_id;
- target_type: platform, formation, standalone_course, bootcamp;
- target_id;
- status: active, suspended, revoked, expired;
- starts_at;
- ends_at;
- created_at;
- updated_at.

Regra: a interface nunca deve liberar conteudo apenas por dados de pagamento. Sempre consultar entitlement.

## Home configuravel

### home_sections

- id;
- title;
- subtitle;
- order_index;
- section_type: continue_watching, purchases, showcase, upcoming, custom;
- visibility: students, non_students, all;
- content_source: manual, entitlement_products, sellable_products, upcoming_products, recent_lessons;
- is_active;
- created_at;
- updated_at.

Regras:

- `purchases` deve listar produtos com entitlement ativo do aluno, agrupando formacoes, bootcamps e cursos avulsos;
- `showcase`/`sellable_products` pode listar produtos comprados e nao comprados, conforme configuracao;
- produtos sem entitlement aparecem bloqueados na UI;
- `upcoming_products` pode listar produtos futuros, novidades e listas de espera;
- a regra `visibility` define se a secao aparece apenas para alunos/compradores, apenas para nao compradores/visitantes ou para todos.

## Login configuravel

### login_page_settings

Configuracao visual da tela de login escolhida pelo produtor no CMS futuro.

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

Regras de produto e acesso:

- formacao e produto vendavel;
- bootcamp e produto vendavel;
- curso avulso e produto vendavel;
- curso interno de formacao nao e produto vendavel separado;
- ao comprar uma formacao, o aluno tem acesso a todos os cursos internos dessa formacao;
- a vitrine deve listar produtos vendaveis, nunca cursos internos de formacao;
- o webhook de pagamento cria/atualiza entitlement no produto comprado, nao em cada curso interno isoladamente.

## CMS administrativo

O prototipo inicial do CMS em `/admin` e UI-first e usa mock data. Quando conectado ao banco, o CMS deve gravar e versionar conteudo sem misturar autorizacao administrativa com a experiencia do aluno.

### content_drafts

Rascunhos editaveis de produtos, cursos, modulos, aulas, materiais e configuracoes da home.

- id;
- owner_type: product, formation, course, bootcamp, module, lesson, material, home_section, login_page_settings;
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

Permissoes de usuarios administrativos quando Auth estiver conectada.

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

- somente usuarios com papel administrativo podem acessar `/admin`;
- edicoes de conteudo devem gerar log;
- alteracoes de entitlement, regra de liberacao e webhook reprocessado devem ser auditaveis;
- chaves de provedores, service role e segredos de webhook nunca ficam no browser.

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
- course_id;
- title;
- description;
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
- duration_seconds;
- thumbnail_url;
- status;
- order_index;
- published_at.

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

Regras configuraveis no CMS para liberar formacoes, cursos, modulos, aulas ou materiais.

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
- completed_at;
- last_watched_at;
- updated_at.

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
- target_type: formation, standalone_course, bootcamp, module, lesson, material;
- target_id;
- collection_label: favoritos, assistir_depois, jornada;
- created_at;

Regra:

- o aluno pode salvar formacoes, cursos, bootcamps, modulos, aulas e materiais;
- salvar um item nao concede acesso, apenas cria uma referencia pessoal;
- itens bloqueados podem ser salvos como interesse/favorito, mas continuam dependendo de entitlement para consumo.

## Eventos

Regra de produto: toda interacao relevante do aluno deve ser persistivel e virar dado para CRM, dashboards, segmentacao, suporte, recomendacao e IA futura. No prototipo UI-first, essas interacoes podem existir em estado local/mock, mas a interface deve preservar o contrato mental do produto: reagiu, salvou, assistiu, concluiu, baixou, comentou ou denunciou, isso futuramente vira registro.

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
