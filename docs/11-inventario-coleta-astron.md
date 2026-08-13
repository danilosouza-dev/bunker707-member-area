# Inventario da Coleta: Area do Aluno Astron Academy

## Finalidade

Este documento registra o que foi observado na navegacao da area do aluno da Astron Academy para servir como referencia funcional e de UX da Bunker707.

Importante:

- esta referencia nao deve ser tratada como especificacao de copia literal;
- nao copiar marca, textos proprietarios, imagens, assets, nomes de alunos ou dados pessoais;
- usar somente a logica de produto, hierarquia de telas, padroes de navegacao e ideias de componentes;
- dados pessoais observados durante a navegacao foram omitidos ou generalizados neste inventario.

## Escopo navegado

Foram navegadas as seguintes areas da experiencia do aluno:

- login, apenas para acesso;
- home/dashboard do aluno;
- Meu Conteudo;
- pagina de aula/curso;
- busca;
- perfil;
- meus planos/acessos;
- alterar senha;
- comunidades;
- detalhe de comunidade;
- categoria/topicos da comunidade;
- mural de membros;
- conversas;
- ranking;
- suporte.

## Padrao global do app

### Estrutura

Observado:

- tema escuro;
- header fixo no topo;
- logo no canto superior esquerdo;
- busca global no header;
- icones de ranking, conversas/notificacoes e perfil;
- sidebar fixa no desktop;
- avatar, nome e progresso do aluno na sidebar;
- navegacao principal pela sidebar;
- links auxiliares no rodape da sidebar.

Referencia para Bunker707:

- manter tema escuro premium;
- trocar sidebar fixa por menu hamburguer que abre drawer/sidebar;
- manter busca global no header;
- manter perfil e notificacoes no header;
- mostrar progresso do aluno no drawer/sidebar ou area "Minha jornada";
- preservar area util ampla para conteudo.

## Home / Dashboard

### Estrutura observada

- banner horizontal grande no topo;
- bloco "Continuar progresso";
- secoes de conteudo por categoria;
- carrosseis com setas;
- cards de cursos;
- categorias como "Cursos Completos", "Astron Members" e "E-books";
- conteudos bloqueados podem aparecer como skeleton/placeholder ou card com indicacao de bloqueio;
- pagina usa container central escuro com cards em blocos.

### Elementos

- banner/hero;
- card de progresso em andamento;
- card de curso;
- secoes por grupo;
- setas de carrossel;
- indicador/paginacao de carrossel;
- sidebar com progresso geral.

### Como usar na Bunker707

Adaptar para:

- hero maior e mais cinematografico;
- primeira linha de cards sobrepondo o fim da hero;
- primeira linha `Continue assistindo` com thumbnails horizontais e barra de progresso;
- fileiras seguintes configuraveis com cards verticais exibidos em cerca de 300 x 433.33 no desktop, podendo chegar perto de 320 x 462.22 em telas muito largas;
- setas de carrossel aparecem somente quando a fileira tiver overflow horizontal real; na adaptacao Bunker707, elas ficam sobrepostas às bordas dos cards com fade escuro lateral, e um indicador segmentado acima da fileira acompanha a pagina atual; com poucos cards, a fileira fica limpa, sem controles;
- capas dos cards verticais enviadas em 720 x 1040 px nesta fase, mantendo a mesma proporcao usada nos cards;
- cards verticais limpos por padrao, com hover flutuante: escala edge-aware somente nos cards que tocam as bordas visiveis do carrossel, enquanto o ultimo card de uma fileira curta com espaco livre à direita cresce centralizado; sombra forte, camada acima dos vizinhos, imagem escurecida com degrade inferior e informacoes dentro do proprio card;
- seta de detalhes nos cards verticais abre modal com informacoes do conteudo;
- `Minhas compras` agrupa tudo que o aluno comprou/tem entitlement ativo: formacoes, bootcamps e cursos avulsos;
- `Produtos a venda`/`Vitrine` mostra somente conteudos vendaveis aos quais o aluno ainda nao tem acesso;
- conteudos sem entitlement ativo devem aparecer com badge circular escuro/translucido no canto superior direito e cadeado branco sobreposto, capa em preto e branco no estado normal e CTA verde solido `Comprar` em destaque no hover, sem botao de salvar/favoritar; status, duracao, tipo e quantidade de aulas ficam para modal/pagina propria;
- secoes configuraveis podem aparecer para alunos/compradores, nao compradores/visitantes ou todos;
- adaptacao Bunker707: produtores com catalogo curto podem ativar uma secao com capa vertical reduzida do curso à esquerda, rotulo pequeno, titulo e botao `Acessar`/`Comprar` à direita, alem de cards de modulos em tamanho intermediario sem botao proprio; sem acesso, os modulos abrem o modal de detalhes do curso;
- secoes principais:
  - Continue assistindo;
  - Minhas compras;
  - Modulos de curso escolhido pelo produtor;
  - Produtos a venda;
  - Em breve na Bunker707;
  - Recomendadas para voce;
  - Materiais importantes.

## Meu Conteudo observado / Minhas compras na Bunker707

### Estrutura observada

- breadcrumb no topo;
- titulo e descricao curta;
- grid de cursos liberados;
- cada card mostra capa, avaliacao, progresso de aulas e acao/info;
- paginacao simples.

### Campos visuais do card

- capa horizontal;
- nota;
- progresso, por exemplo `0/33`;
- botao/info;
- titulo do curso.

### Como usar na Bunker707

Adaptar para:

- chamar a tela de `Minhas compras`;
- usar como biblioteca dos produtos liberados por entitlement ativo;
- grid de cards verticais;
- progresso visual mais evidente;
- filtros por tipo/status, incluindo formacoes, cursos avulsos, bootcamps, em andamento, concluidos e novos;
- card com:
  - capa vertical;
  - badge de tipo;
  - titulo;
  - trilha/categoria;
  - progresso;
  - status de acesso;
  - CTA "Continuar" ou "Comecar".

`Formacoes` nao deve ser uma rota principal na sidebar no MVP; deve ser filtro dentro de `Minhas compras`.

## Pagina de Aula

### Estrutura observada

- player grande no lado esquerdo;
- playlist lateral fixa no lado direito;
- titulo da aula abaixo do player;
- botao principal "Concluir e avancar";
- avaliacao da aula;
- botao "TV";
- botao para fechar/abrir conteudo;
- breadcrumb;
- tabs de descricao e comentarios;
- campo de comentario;
- respostas em comentarios;
- progresso total do curso na playlist lateral;
- aulas com miniaturas e status de conclusao.

### Funcionalidades observadas

- assistir video embutido;
- avancar para proxima aula ao concluir;
- avaliar aula;
- alternar descricao/comentarios;
- comentar e responder;
- navegar por aulas da playlist;
- ver progresso total do curso.

### Como usar na Bunker707

Esta deve ser a principal referencia para a pagina de aula.

MVP:

- player grande;
- playlist lateral;
- titulo;
- botao "Concluir", mudando para estado verde "Concluida" depois da conclusao;
- materiais;
- descricao;
- comentarios simples ou placeholder;
- progresso salvo;
- navegacao para outras aulas pela playlist lateral.

Decisoes Bunker707 para a pagina de aula:

- a playlist lateral deve usar modulos em formato sanfona, com apenas um modulo aberto por vez e possibilidade de fechar o modulo aberto;
- cada aula da playlist deve permitir marcar/desmarcar conclusao diretamente pelo check sobre a thumbnail, alem do botao de conclusao abaixo do video;
- a playlist lateral deve manter progresso total do curso no topo; os modulos mostram apenas contagem, como `2/6 concluidas`, sem barra propria para nao conflitar visualmente;
- o breadcrumb deve ficar acima do player, no topo da coluna principal;
- o botao de voltar para a pagina do conteudo deve ficar sobreposto no canto superior esquerdo do player, aparecendo no hover/foco no desktop, usando o mesmo hover circular escuro dos botoes secundarios, com tooltip acima do player sem corte pela area do video, e permanecendo acessivel em telas touch;
- overlays do player devem permanecer abaixo do header global quando houver sobreposicao durante o scroll;
- nao exibir tag do provedor de video sobre o player, como `YouTube`, porque essa informacao e tecnica e nao melhora o consumo da aula;
- erros, mensagens de carregamento e fallbacks da experiencia do aluno devem ser neutros e nunca revelar o provedor de video;
- o player Bunker707 deve usar timeline fina sobre uma superficie transparente e uma unica linha de controles: play/pausa, -10s, +10s, volume e tempos à esquerda; legenda, engrenagem de configuracoes e tela cheia à direita, sem outras acoes nem faixa escura continua. A engrenagem segue a navegacao hierarquica do YouTube: o primeiro nivel mostra somente `Velocidade de reprodução` e `Qualidade`, com o valor atual e seta; cada linha abre um submenu vertical dedicado com titulo e voltar, sem exibir as duas listas simultaneamente. Velocidade preserva a taxa escolhida ao trocar a resolucao e sincroniza audio/video no modo manual. O selo mostra a qualidade manual selecionada ou, em `Automático`, a qualidade efetiva reportada durante a reproducao; `AUTO` e apenas o estado inicial, e `highres` generico vira `HD+` sem falsa precisao. O submenu de qualidade lista todas as resolucoes sem scroll, deixa `Automático` por ultimo e nao exibe texto explicativo abaixo das opcoes;
- no Modo TV, o modal conectado deve oferecer velocidade junto aos controles remotos e marcar apenas a taxa confirmada pelo receptor. A legenda propria da plataforma deve trocar para a cue mais recente quando os tempos do YouTube se sobrepoem e, em qualidade manual, acompanhar o relogio do audio audivel;
- controles de aula anterior/proxima nao devem ficar no topo da pagina; a navegacao entre aulas acontece pela playlist lateral e futuramente pelos controles internos do player;
- o botao principal `Concluir` deve marcar/desmarcar a conclusao e preservar esse estado quando o aluno voltar para a aula; no prototipo UI-first isso pode ser feito localmente, e no produto final a fonte deve ser o backend de progresso;
- botoes secundarios como materiais, TV, salvar e avaliar devem ser circulares, iconograficos, com borda discreta no estado normal e feedback visual proprio no hover/foco, sem depender de tooltip nativo do navegador;
- tooltips desses botoes devem usar caixa branca com seta, fonte media/regular e sem peso excessivo;
- a playlist lateral deve alinhar seu topo ao player, nao ao breadcrumb;
- a playlist lateral deve ter scroll interno proprio, mantendo o cabecalho de progresso fora da area rolavel e garantindo acesso completo ao ultimo modulo e a ultima aula;
- abrir/fechar um modulo na playlist nao deve trocar a aula em reproducao; a aula ativa muda somente quando o aluno clica em uma aula;
- a avaliacao da aula deve aparecer depois que o aluno assistir pelo menos 30% do video e usar tres reacoes no estilo Netflix (`Nao gostei`, `Gostei`, `Amei`), em vez de escala de cinco estrelas; opcoes selecionadas usam apenas contorno colorido, incluindo o coracao de `Amei`, e a pilula de opcoes fecha depois da selecao. Depois de liberada uma vez, a avaliacao permanece disponivel mesmo se o aluno voltar o video para o inicio;
- materiais podem ser liberados normalmente ou ter uma regra individual de desbloqueio, configurada pelo professor/produtor no CMS;
- materiais bonus gerados por IA, como resumo estrategico, infografico ou detalhamento da aula, podem exigir avaliacao, comentario ou outra atividade para download;
- se o aluno passar o mouse ou tentar acessar material bloqueado, a interface deve explicar a condicao de desbloqueio, por exemplo avaliar a aula depois de assistir pelo menos 30%;
- o CMS futuro deve permitir regras de liberacao por data fixa, dias apos compra/entrada no curso, atividade concluida, comentario, avaliacao ou outras condicoes;
- o CRM/dashboard deve coletar consumo e comportamento com detalhe: aulas assistidas, percentual concluido por aula, ponto de abandono, trechos de maior retencao, avaliacoes, comentarios, downloads, cliques, frequencia de login e progresso por curso/produto;
- eventos futuros devem registrar conclusao manual pela playlist, conclusao pelo botao principal, avaliacao, tentativas de baixar material bloqueado, downloads liberados, progresso de video, abandono, retomada, login e interacoes relevantes.

Na referencia original, futuro; na Bunker707, Tutor IA e transcricao ja implementados:

- assistente de IA da aula;
- transcricao;
- perguntas com fonte;
- resumo da aula;
- anotacoes do aluno;
- certificados.

Eventos que a Bunker707 deve registrar:

- lesson_started;
- lesson_progress_updated;
- lesson_paused;
- lesson_completed;
- lesson_replayed;
- lesson_comment_created;
- material_downloaded.

## Busca

### Estrutura observada

- pagina dedicada de busca;
- input grande;
- estado vazio centralizado com "Nada encontrado";
- busca global tambem no header.

### Como usar na Bunker707

MVP:

- busca por cursos, trilhas, aulas e materiais;
- estado vazio claro;
- resultados agrupados por tipo.

Futuro:

- busca semantica;
- busca em transcricoes;
- filtros por progresso/status.

## Perfil

### Abas observadas

- Meu Perfil;
- Meus Planos;
- Alterar Senha.

### Meu Perfil

Observado:

- upload de imagem/avatar;
- dados pessoais;
- nome;
- email;
- telefone;
- data de nascimento;
- genero;
- documento;
- botao salvar.

### Meus Planos

Observado:

- tabela de acessos/compras;
- plano;
- status do acesso;
- data de compra;
- data de expiracao;
- observacoes/transacao.

### Alterar Senha

Observado:

- senha atual;
- nova senha;
- confirmar senha;
- botao alterar.

### Como usar na Bunker707

MVP:

- Meu Perfil;
- Meus Acessos;
- Alterar Senha.

Evitar:

- coletar documento/CPF cedo demais, a menos que seja necessario.

Importante:

- "Meus Planos" deve virar "Meus Acessos" ou "Minha assinatura/acessos", porque a venda sera externa e a fonte de verdade sera entitlement interno.

## Suporte

### Estrutura observada

- titulo;
- texto explicativo;
- formulario com nome, email, telefone, assunto e mensagem;
- botao enviar;
- card com dados do produtor;
- disclaimer.

### Como usar na Bunker707

MVP:

- formulario simples de suporte;
- registrar ticket no banco;
- enviar email/notificacao;
- status inicial "open".

Futuro:

- categorias;
- anexos;
- historico de tickets;
- integracao com ferramenta externa.

## Comunidade

### Lista de comunidades

Observado:

- banner/hero de comunidade;
- card de comunidade;
- contador de categorias/topicos ou comentarios;
- botao acessar.

### Detalhe de comunidade

Observado:

- banner;
- titulo;
- descricao;
- breadcrumb;
- lista de categorias;
- filtro "Mais recente";
- contadores;
- botao entrar.

### Categoria/topicos

Observado:

- busca por topico;
- ordenacao;
- lista de topicos;
- autor;
- ultima atualizacao;
- contador de comentarios/interacoes;
- botao entrar.

### Como usar na Bunker707

Fase 2:

- comunidade pode ser util para engajamento;
- estrutura recomendada:
  - comunidades;
  - categorias;
  - topicos;
  - posts/respostas.

Nao entrar no MVP essencial.

## Mural de Membros

### Estrutura observada

- breadcrumb;
- titulo;
- descricao;
- busca por nome;
- grid de membros;
- cards com avatar, nome, data de entrada e botao "Ver perfil";
- paginacao.

### Como usar na Bunker707

Fase futura.

Cuidados:

- privacidade;
- opt-in para perfil publico;
- moderacao;
- configuracao de visibilidade.

## Conversas

### Estrutura observada

- layout de chat;
- coluna de conversas;
- area de usuarios online;
- painel principal com estado vazio;
- mensagens aparecem quando conversa e selecionada.

### Como usar na Bunker707

Fase futura.

Decisao futura:

- construir chat proprio;
- usar integracao externa;
- substituir por comunidade/duvidas nas aulas.

## Ranking

### Estrutura observada

- pagina de ranking;
- abas/filtros por periodo mensal;
- estado vazio quando nao ha atividade;
- regras de pontuacao;
- atividade de outros alunos;
- pontos por conteudo concluido.

### Como usar na Bunker707

Fase 2 ou 3.

Primeira regra possivel:

- aula concluida: +2 pontos;
- curso concluido: pontos extras;
- sequencia semanal: pontos extras;
- comentario util: pontos extras, se houver moderacao.

Depende de:

- student_events;
- points_ledger;
- ranking_periods.

## Notificacoes e icones de topo

Observado:

- icones no header para ranking/coroa, conversas e notificacoes;
- perfil com dropdown;
- busca persistente.

Como usar na Bunker707:

- MVP pode ter notificacoes visuais simples;
- ranking e conversas podem ficar ocultos ate fase futura;
- perfil deve ter dropdown com Perfil, Meus Acessos, Suporte e Sair.

## Componentes derivados

Componentes que a Bunker707 deve ter:

- `AppShell`;
- `TopBar`;
- `HamburgerSidebar`;
- `StudentProgressSummary`;
- `HomeHero`;
- `ContentCarousel`;
- `VerticalContentCard`;
- `ContinueWatchingCard`;
- `CourseGrid`;
- `CourseDetailHeader`;
- `ModuleAccordion`;
- `LessonPlayer`;
- `LessonPlaylist`;
- `LessonTabs`;
- `MaterialList`;
- `CommentThread`;
- `SearchPage`;
- `ProfileTabs`;
- `AccessTable`;
- `SupportForm`;
- `EmptyState`;
- `LockedContentState`;
- `ProgressBar`.

Componentes futuros:

- `CommunityCard`;
- `CommunityCategoryList`;
- `TopicList`;
- `MemberCard`;
- `ConversationShell`;
- `RankingBoard`;
- `PointsRules`;
- `AiLessonAssistant`.

## Rotas sugeridas para Bunker707

```txt
/app
/app/home
/app/minhas-compras
/app/trilhas
/app/trilhas/[slug]
/app/cursos/[slug]
/app/aulas/[lessonId]
/app/busca
/app/perfil
/app/acessos
/app/suporte
```

Rotas futuras:

```txt
/app/comunidade
/app/comunidade/[communityId]
/app/comunidade/[communityId]/[categoryId]
/app/membros
/app/conversas
/app/ranking
/app/certificados
```

## Eventos derivados da coleta

Eventos minimos:

- home_viewed;
- content_card_clicked;
- course_opened;
- lesson_opened;
- lesson_started;
- lesson_progress_updated;
- lesson_completed;
- lesson_comment_created;
- material_downloaded;
- search_performed;
- profile_updated;
- support_ticket_created.

Eventos futuros:

- community_opened;
- topic_opened;
- topic_created;
- reply_created;
- member_profile_viewed;
- conversation_started;
- ranking_viewed;
- ai_question_asked;
- ai_answer_rated.

## O que entra no MVP

Entrar:

- app shell;
- home;
- meu conteudo;
- pagina de aula;
- busca;
- perfil;
- meus acessos;
- suporte;
- progresso;
- eventos basicos.

Nao entrar inicialmente:

- comunidade completa;
- mural de membros;
- conversas;
- ranking;
- certificados;
- agentes gerais de IA alem do Tutor IA da aula, que ja foi implementado.

## Decisoes de adaptacao

Tomadas:

- trocar sidebar fixa por menu hamburguer/sidebar;
- usar cards verticais;
- hero da home com sobreposicao da primeira linha;
- foco em area do aluno, nao dashboard administrativo;
- manter suporte simples;
- usar "Meus Acessos" em vez de "Meus Planos";
- preservar dados de comportamento para futuro dashboard.

Pendentes:

- Supabase Auth no MVP;
- Bunny Stream ou Mux;
- Drizzle ou Prisma;
- nomenclatura final das secoes da home;
- se comunidade aparece no menu desde o MVP ou fica oculta.
