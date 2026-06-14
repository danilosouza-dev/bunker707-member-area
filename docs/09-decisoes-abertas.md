# Decisoes Abertas

## Stack

### Auth

Opcoes:

- Clerk;
- Supabase Auth.

Recomendacao atual:

- Clerk se quiser login mais polido e recursos prontos;
- Supabase Auth se quiser reduzir fornecedores.

Decisao pendente.

### ORM

Opcoes:

- Drizzle;
- Prisma.

Recomendacao atual:

- Drizzle se quisermos SQL mais explicito e leve;
- Prisma se quisermos produtividade com schema bem conhecido.

Decisao pendente.

### Video

Opcoes:

- Bunny Stream;
- Mux;
- Cloudflare Stream.

Recomendacao atual:

- Bunny Stream para custo inicial menor;
- Mux para experiencia de desenvolvedor e analytics de video mais fortes.

Decisao pendente.

### Deploy

Opcao inicial:

- Vercel.

Opcao futura:

- Hetzner com Docker/Nginx.

Decisao atual:

- comecar em Vercel, mantendo portabilidade.

## Produto

### Progresso

Decisao tomada:

- nao usar formacao atual fixa, curso atual fixo ou barra de progresso geral do aluno no sidebar.
- progresso deve ser contextual por formacao, curso, bootcamp, modulo ou aula.
- separar progresso de consumo de aulas e progresso pratico, incluindo quizzes, desafios, projetos e demais tarefas configuraveis.
- conclusao real de um produto pode depender apenas de aulas ou tambem de entregas praticas obrigatorias, conforme regra configurada.

### Comunidade no MVP

Recomendacao:

- nao entrar no MVP essencial;
- manter no menu como item futuro ou ocultar ate estar pronto.

### Ranking no MVP

Recomendacao:

- fase 2;
- eventos de conclusao ja devem preparar os dados.

### Chat interno

Recomendacao:

- fase futura;
- avaliar custo operacional e moderacao.

### IA da aula

Recomendacao:

- preparar modelo de dados;
- implementar depois que aulas, transcricoes e progresso estiverem estaveis.

## Design

### Login

Decisao tomada:

- a tela de login sera configuravel pelo produtor no CMS futuro.
- os modelos iniciais sao: dividido com visual a direita, dividido com visual a esquerda, formulario central translucido sobre imagem e formulario lateral translucido sobre imagem.
- o formulario deve permitir superficie configuravel: transparente, borda sutil ou painel.
- no MVP UI-first, a configuracao pode ficar mockada e tipada no frontend, sem criar dashboard administrativo.
- a tela de login nao deve virar vitrine publica nem checkout; suporte e links legais ficam discretos.
- a autenticacao real continua dependente da decisao aberta entre Clerk e Supabase Auth.

### CMS/Admin

Decisao tomada:

- iniciar um prototipo UI-first do CMS em `/admin`, usando mock data e sem backend real nesta etapa.
- o design do CMS segue a linha escura, densa e operacional da referencia Netflix-style Ad Manager enviada no Figma, sem copiar marca, textos ou assets proprietarios.
- o CMS deve controlar catalogo, home, formacoes, cursos avulsos, cursos internos de formacoes, bootcamps, modulos, aulas, materiais, regras de liberacao e entitlements.
- regras de liberacao precisam cobrir pelo menos: liberacao imediata, depois da compra/entitlement, depois de tantas horas ou dias, data e hora fixa, aula anterior concluida, percentual assistido, avaliacao enviada, comentario enviado e tarefa concluida.
- entitlements continuam sendo a fonte de verdade de acesso; eventos de Hotmart, Ticto, TikTok ou outros provedores sao entradas externas auditaveis, nao autorizacao direta.
- o acesso ao CMS devera ser protegido por papel/permissao administrativa quando Auth e banco forem conectados. O link no prototipo e apenas conveniencia de navegacao.

### Fundo

Decisao tomada:

- o fundo base da area de membros deve usar `#141414`, alinhado ao fundo da Netflix, para melhorar a leitura dos cards em hover e evitar que paineis escuros se confundam com preto absoluto.

### Cards

Decisao tomada:

- `Continue assistindo` usa thumbnails horizontais com barra de progresso.
- no hover de `Continue assistindo`, o card pode mostrar um play discreto no centro da thumbnail, mas nao deve esconder titulo, contexto, aula ou percentual assistido.
- `Continue assistindo` nao deve ter CTA grande nem botao de detalhes/seta para baixo; a acao e continuar a aula.
- demais fileiras usam cards verticais exibidos em 398 x 574.88 no desktop.
- as imagens de capa enviadas para esses cards devem ter 720 x 1040 px, mantendo a mesma proporcao usada no card.
- capas devem ser tratadas como posters premium: arte e titulo forte; informacoes detalhadas ficam em metadata, modal e pagina propria do conteudo.
- cards verticais podem exibir a logo horizontal completa oficial da Bunker707 no canto superior esquerdo apenas no hover, em tamanho discreto.
- cards verticais aparecem somente como capa no estado normal; no hover, os cards da home saltam mais para frente com escala maior, leve elevacao, transicao suave, cantos arredondados preservados, imagem escurecida e informacoes/acoes dentro do proprio card.
- o hover dos cards verticais usa degrade escuro de baixo para cima, bem forte na area das informacoes e suave no topo, priorizando legibilidade sobre capas com muito contraste ou texto na arte.
- o hover dos cards verticais deve ter apenas titulo, descricao curta, acao principal, botao de salvar/favoritar quando o aluno tiver acesso e botao de detalhes; status, duracao, quantidade de aulas e tipo ficam no modal/pagina propria.
- professor, foto do professor, Instagram e informacoes complementares nao aparecem no hover dos cards verticais; ficam no modal e/ou na pagina propria do conteudo.
- qualquer elemento com hover interativo deve usar cursor de mao/pointer.
- clicar no card ou em `Acessar` leva para a pagina propria do curso/formacao/bootcamp; clicar na seta para baixo abre o modal de detalhes.
- cards verticais sem compra/entitlement ativo devem ficar preferencialmente em uma fileira de `Vitrine` ou outra fileira configurada para oferta, com capa em preto e branco no estado normal, cadeado preto sem caixa/moldura, sem texto no topo; no hover a capa volta a ter cor, o cadeado permanece visivel, e o card exibe somente titulo, descricao curta e botao verde solido `Comprar`, largo e com texto branco, sem botao de salvar/favoritar.
- `Minhas compras` substitui a separacao inicial entre `Minhas formacoes`, `Meus cursos avulsos` e `Meus bootcamps`; ela agrupa todos os produtos com entitlement ativo do aluno.
- `Minhas compras` tambem substitui `Meu Conteudo` como item principal da sidebar. `Formacoes` nao deve aparecer como item principal no MVP; deve ser filtro/tipo dentro de `Minhas compras`.
- `Produtos a venda`/`Vitrine` e configuravel no dashboard e pode conter produtos comprados e nao comprados na mesma fileira.
- fileiras configuraveis devem poder ter regra de visibilidade: apenas alunos/compradores, apenas nao compradores/visitantes ou todos.
- uma fileira `Em breve` pode mostrar proximos cursos, formacoes, bootcamps, novidades e listas de espera.
- a vitrine mostra apenas produtos vendaveis: formacoes, bootcamps e cursos avulsos.
- uma formacao e sempre um produto vendavel proprio; ao comprar a formacao, o aluno recebe acesso a todos os cursos internos dela.
- cursos internos de uma formacao nunca devem aparecer como produto separado na vitrine e nunca devem ser vendidos separadamente.
- cursos internos de uma formacao aparecem somente dentro do modal ou pagina da formacao.
- setas dos carrosseis fazem scroll horizontal suave e ficam desativadas quando nao houver mais conteudo para navegar naquela direcao.
- carrosseis de cards verticais devem ter respiro vertical interno suficiente para o hover ampliado nao ser cortado pelo container de scroll horizontal.
- cards internos de cursos e modulos podem usar acao explicita em botao ou acao implicita pelo clique no card, conforme configuracao futura do CMS.
- decisao atual Bunker707: cards de modulos de cursos avulsos ficam sem botao retangular `Acessar`; o card inteiro e clicavel, com hover, progresso e metadados dentro do poster.
- decisao atual Bunker707: cards de cursos internos dentro de formacoes tambem usam acao implicita e levam direto para a pagina de aula/playlist, sem etapa intermediaria de cards de modulos.
- decisao atual Bunker707: cursos internos dentro de formacoes usam o mesmo padrao de poster vertical dos cards de modulos, mas sem botao `Acessar` e sem barra de progresso no card.
- o CMS futuro pode permitir tags/selo por card, como `Curso`, `Modulo`, `Bonus`, `Projeto` ou texto definido pelo produtor, para diferenciar niveis sem exigir um componente visual diferente.

### Modal de detalhes

Decisao tomada:

- o modal de detalhes deve ser inspirado no modelo da Netflix, mas adaptado para educacao e hierarquia de conteudo.
- formacoes mostram cursos internos da formacao, em cards, com expansao para ver mais.
- cursos internos dentro de formacoes podem abrir pagina propria de modulos ou direto o formato de aula/playlist, conforme configuracao. No caso atual da Bunker707, abrem direto a pagina de aula/playlist.
- cursos avulsos mostram modulos, em cards, com expansao para ver mais modulos. No caso atual da Bunker707, esses cards nao exibem botao retangular de acesso.
- bootcamps mostram modulos, em cards, com expansao para ver mais modulos.
- secoes do modal com cards escondidos devem mostrar um preview recortado dos proximos cards com degrade e botao circular de expansao, para indicar visualmente que ha mais conteudo abaixo.
- aulas aparecem em formato de lista detalhada com thumbnail, titulo, descricao e duracao quando o aluno abre ou expande um modulo.
- no desktop, ao abrir um modulo, o modulo selecionado ocupa a primeira posicao visual à esquerda e a lista de aulas aparece à direita; ao ocultar, os cards voltam ao grid normal.
- quando o modulo aberto vier de uma area expandida/escondida, o modal deve rolar suavemente ate o foco do modulo selecionado.
- no mobile, o modulo selecionado e a lista de aulas podem ficar empilhados em coluna unica.
- abrir aulas, trocar o modulo selecionado e ocultar aulas devem ter animacoes suaves de reorganizacao, sem troca seca de layout.
- todos os cards verticais internos do modal, inclusive em formacoes bloqueadas, devem compartilhar o mesmo hover: o card nao move, nao cresce e nao altera sombra; apenas a imagem interna recebe zoom leve e escurecimento discreto, com transicao lenta e suave.
- hovers de cards verticais nao devem revelar filetes claros, bordas brancas acidentais ou linhas de subpixel na base do card.
- a area de episodios da Netflix nao deve ser usada diretamente em formacoes e cursos.
- o modal nao deve ter `Conteudos relacionados` nesta fase; deve manter apenas a hierarquia principal do conteudo e um bloco `Sobre` no final.
- o modal deve ser renderizado acima de todos os elementos da aplicacao, inclusive header.
- o modal nao deve ter scroll interno no proprio painel; a camada externa do modal rola pelo viewport, com barra visivel no canto da tela, enquanto a pagina de fundo fica bloqueada.
- o wheel/scroll deve mover o modal mesmo quando o mouse estiver sobre a area escura fora do painel.
- a abertura do modal deve ser suave, com fade no backdrop, leve escala/movimento no painel e micro transicao de fechamento.
- cards de cursos internos dentro de uma formacao nao devem exibir tags extras como `Incluso na formacao`, `Curso pratico`, `Curso base` ou similares.

### Footer

Decisao tomada:

- a home da area de membros deve ter um footer discreto com marca, suporte e documentos, sem linguagem de vitrine publica.
- a logo oficial horizontal da Bunker707 deve substituir o monograma temporario no header, sidebar e footer, usando o asset `public/brand/logo-bunker.png`.
- a logo oficial deve funcionar como link para voltar para a home em todos os locais onde aparecer.

### Hero

Decisao tomada:

- primeira linha de cards deve sobrepor o fim da hero.
- hero e configuravel pela area interna da escola e pode ser apenas visual/editorial, sem obrigatoriedade de botoes, progresso ou acao de assistir.
- degrades coloridos/editoriais da hero nao devem ser fixos no frontend; o padrao da home e neutro/escuro e cores/intensidade devem ser configuraveis futuramente no dashboard da escola.
- consumo principal acontece nos cards e fileiras, nao necessariamente na hero.
- na home, o header fica transparente sobre a hero com degrade sutil; apos scroll, assume fundo preto solido por transicao suave de opacidade/altura, revelando o preto de cima para baixo, sem borda inferior e sem piscadas.
- os controles do header nao devem trocar de estado visual durante o scroll; apenas o fundo do header transiciona.

### Sidebar

Decisao tomada:

- menu hamburguer abre sidebar.
- sidebar abre e fecha com transicao suave lateral e backdrop em fade.

## Dados

### Fonte da verdade de acesso

Decisao tomada:

- entitlement interno da Bunker707.

### Venda

Decisao tomada:

- venda fora da plataforma.

### Checkout interno

Decisao tomada:

- nao havera checkout interno no MVP.
