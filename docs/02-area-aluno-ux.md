# Area do Aluno e UX

A base visual detalhada da plataforma esta em [`docs/12-design-system-bunker707.md`](12-design-system-bunker707.md). Este documento de UX deve seguir os tokens, componentes, estados e regras de tipografia definidos no design system.

## App shell

Todas as telas autenticadas devem compartilhar uma estrutura consistente:

- header fixo;
- menu hamburguer no inicio do header;
- logo Bunker707 clicavel, levando para a home;
- busca global;
- avatar do aluno com menu da conta (`Perfil`, `Minhas compras`, `Suporte` e `Sair`);
- sidebar aberta pelo menu hamburguer.

Notificacoes e conquistas ficam para a fase 2. Ate la o topo nao mostra sino, trofeu ou qualquer icone sem funcao (decisao de 2026-10-11, aluno v2).

Toda mudanca de pagina deve ser reconhecida no mesmo instante do clique ou comando. O app shell mantem um unico spinner circular vermelho ancorado no centro do viewport, sobre uma camada preta mais escura e desfocada que preserva as cores da pagina, no estilo Netflix, ate a nova tela assumir. O mesmo posicionamento e usado pelo fallback do App Router e os dois indicadores nunca aparecem ao mesmo tempo. O comportamento cobre links, cards, navegacao programatica, redirecionamentos e voltar/avancar. O destino contextual continua anunciado para leitores de tela, sem caixa de texto visivel. Esse feedback tambem deve aparecer em rotas rapidas, cacheadas ou pre-carregadas; nenhum fluxo pode depender apenas do fallback `loading.tsx` do App Router.

Para usuarios internos com papel administrativo, a area de membros deve manter a experiencia de aluno como produto final, mas expor um atalho claro para o CRM/backoffice. O CRM e a area de membros sao experiencias separadas: a home da area do aluno e `/`, enquanto a home do CRM e `/admin`.

## Login

A tela de login deve ser uma experiencia fechada de area de membros, nao uma vitrine publica nem checkout.

O produtor podera escolher um modelo de login na area `Personalizacao` do CRM. A configuracao deve ser persistida no backend quando a tela de login entrar no escopo administrativo persistido.

Modelos iniciais:

- dividido com formulario de um lado e imagem editorial do outro;
- dividido com imagem editorial invertida;
- formulario centralizado sobre imagem de fundo com painel translucido;
- formulario lateral sobre imagem de fundo com painel translucido.

Customizacoes planejadas:

- modelo/template;
- logo;
- imagem de fundo ou imagem lateral;
- titulo e texto de apoio;
- tom do painel: escuro, claro ou translucido;
- superficie do formulario: transparente, borda sutil ou painel;
- posicao do formulario;
- provedores sociais habilitados.

Regras:

- nao exibir venda, carrinho ou checkout interno;
- manter links discretos de suporte, privacidade e termos;
- registrar o evento `user_signed_in` quando o aluno entrar por email/senha ou OAuth;
- usar Supabase Auth no MVP, mantendo a tela configuravel pelo CMS futuro.

## Personalizacao no CRM

A sidebar do CRM/backoffice deve ter uma opcao principal chamada `Personalizacao`.

Essa area agrupa as configuracoes visuais da experiencia do aluno:

- pagina de login: template, logo, imagem, titulo, texto de apoio, superficie do formulario e provedores visiveis;
- paginas dos cursos, formacoes, bootcamps e produtos principais: hero, textos opcionais, CTA, capa e modo de apresentacao;
- estrutura interna dos cursos: como modulos, aulas, capas, ordem, overlays e estados de liberacao aparecem para o aluno;
- vitrine/home: hero, banner, textos, fileiras, cards/secoes, ordem, origem dos conteudos e regras de visibilidade.

A primeira tela de `Personalizacao` deve ser uma lista central dos destinos personalizaveis, no estilo operacional do CRM: `Vitrine`, `Pagina de login`, `Pagina de produtos` e cada produto/formacao/curso vendavel. Cada linha mostra nome, caminho de preview quando existir, status e acao `Personalizar`. O editor especifico so abre depois desse clique; a tela inicial nao deve abrir todas as opcoes de edicao ao mesmo tempo.

Dentro de cada editor, o painel lateral deve listar apenas as partes editaveis daquela pagina, como `Banner` e `Secoes` na vitrine, `Template`, `Imagem`, `Formulario` e `Provedores` no login, ou `Pagina do produto` e `Modulos e cards` nos produtos/cursos. Ao escolher uma parte, o canvas ao lado continua mostrando a representacao fiel da pagina final.

Nos editores de produtos/cursos, o canvas deve representar a composicao visual limpa que o produtor esta configurando para o aluno com acesso. Estados padrao de bloqueio por compra, entitlement ou drip nao precisam aparecer nesse modo de personalizacao, porque sao comportamentos globais ja conhecidos; eles continuam existindo na pagina real quando o aluno nao tiver acesso ou quando a regra de entrega exigir bloqueio.

Ao clicar para personalizar a vitrine/home, o produtor deve ver uma representacao fiel da home real do aluno em modo editor, com controles discretos para editar banner, textos e secoes sobre a propria pagina. A tela nao deve introduzir um hero, dashboard ou explicacao de personalizacao acima da pagina editada; a renderizacao final da home continua respeitando entitlements, regras de liberacao e visibilidade por aluno.

O editor da vitrine usa tres areas coordenadas: estrutura ordenavel à esquerda, preview central da Home e inspetor da secao selecionada à direita. O produtor pode criar, duplicar, ocultar, excluir e reordenar secoes por arraste ou pelos comandos de mover. As mudancas permanecem em rascunho ate `Publicar`; `Descartar` restaura a ultima configuracao publicada e sair/recarregar com rascunho pendente deve gerar aviso.

Uma secao de cards pode usar fonte automatica (`Continue assistindo`, entitlements, produtos vendaveis ou futuros) ou selecao manual de produtos. Uma secao estrutural escolhe um curso, formacao ou bootcamp e oferece apresentacao `Compacta` ou `Imersiva`. Formacoes exibem seus cursos internos; cursos e bootcamps exibem seus modulos. A configuracao visual nunca concede acesso e o preview deve deixar claro o estado publicado versus rascunho.

Essa representacao deve usar as mesmas fontes e variantes da home publicada:

- `Continue assistindo` continua usando cards horizontais de aula, com thumbnail/resume frame da aula e barra de progresso, nunca capa vertical do curso;
- secoes verticais continuam usando o mesmo tamanho e comportamento dos cards da area do aluno;
- secoes de modulos de curso continuam usando a mesma composicao da home publicada;
- textos, subtitulos, badges e elementos que nao aparecem na pagina final nao devem ser inventados no editor; o produtor pode adicionar novos textos ou secoes pelos controles de edicao quando isso fizer parte da configuracao.

`Personalizacao` nao substitui `Catalogo` nem `Estrutura`: o catalogo cria produtos e conteudos, a estrutura monta modulos e aulas, e a personalizacao controla como esses elementos aparecem na experiencia final.

No CRM/backoffice, a sidebar administrativa pode ir alem do MVP do aluno quando o produtor pedir: `Produtos` reaproveita o Catalogo/construtor, `Combos` agrupa produtos existentes, `Moderacao` controla comentarios das aulas, `Agentes de IA` prepara agentes por escopo e `Configuracoes > Integracoes` concentra provedores externos. `Comunidade` pode aparecer como item reservado de fase futura, sem ativar a experiencia de comunidade para alunos comuns.

## Header

Elementos recomendados:

- menu hamburguer;
- logo Bunker707 clicavel, levando para a home;
- busca global em icone expansivel, alinhada aos icones da direita;
- avatar do aluno, que abre o menu da conta com `Perfil`, `Minhas compras`, `Suporte` e `Sair` (`Saindo...` enquanto sai). O menu fecha ao clicar fora, com `Esc` ou quando o foco sai dele, e as setas percorrem os itens (`src/components/member/shell/member-account-menu.tsx`).

O sino de notificacoes volta quando existirem notificacoes reais (fase 2).

Na home, o header deve ficar praticamente transparente sobre a hero, com apenas um degrade sutil de cima para baixo para manter menu e icones legiveis. Apos o aluno fazer scroll, o header deve assumir fundo preto/solido, como no comportamento da Netflix.

A transicao do header deve ser suave, sem borda inferior e sem piscadas. O comportamento recomendado e usar camadas sobrepostas: uma camada de degrade no topo e uma camada preta que entra por opacidade conforme o scroll aumenta, revelando o preto de cima para baixo.

Os controles internos do header, como botoes, busca e perfil, nao devem trocar de estilo abruptamente durante o scroll. Apenas o fundo do header deve transicionar.

A busca deve iniciar como um icone no grupo direito do header. Ao clicar, ela expande suavemente para permitir digitacao, recebe foco automatico e pode ser recolhida pelo proprio icone ou pela tecla `Esc`.

Nas demais telas, o header pode iniciar solido.

## Sidebar

Aberta pelo menu hamburguer. No desktop, pode deslizar por cima do conteudo com backdrop. No mobile, ocupa a maior parte da tela.

A abertura e o fechamento devem ser suaves, com backdrop em fade e painel deslizando lateralmente.

O sidebar nao deve mostrar formacao atual fixa, curso atual fixo ou barra generica de progresso do aluno. Progresso deve ser contextual por formacao, curso, bootcamp, modulo ou aula, porque um percentual unico da escola inteira fica pouco claro quando o aluno tem varios produtos, desafios, quizzes e projetos.

Itens (fonte unica em `src/lib/member-navigation.ts`), em dois grupos:

- Estudar: Inicio (`/`), Minha jornada (`/minha-jornada`), Continue assistindo (`/continue-assistindo`), Minhas compras (`/minhas-compras`), Favoritos (`/favoritos`), Materiais (`/materiais`);
- Conta e ajuda: Suporte (`/suporte`), Perfil (`/perfil`);
- rodape com a conta do aluno (avatar, nome, link para Perfil) e `Sair`.

Todo item leva a uma pagina real; nenhum item fica desabilitado ou sem destino. O item ativo usa fundo claro translucido, barra vermelha a esquerda e icone vermelho (tambem no modo de visualizacao do produtor, com `?accessPreview`). Cada item tem icone proprio; a bussola fica reservada para a IA Diretor.

Comportamento (`src/components/member/shell/member-sidebar.tsx`):

- largura `min(340px, 88vw)`, altura total e respiro para a borda inferior do aparelho;
- abrir o menu poe o foco no primeiro item; `Tab` e `Shift+Tab` ficam presos dentro do menu; `Esc` fecha e o foco volta ao botao do menu;
- fechado, o menu sai do alcance do teclado e do leitor de tela (`inert`), e a pagina nao rola enquanto ele esta aberto;
- a animacao some para quem pede menos movimento;
- todo link do menu salva progresso e favoritos pendentes antes de trocar de pagina;
- abrir o menu fecha a IA Diretor.

Quando o usuario autenticado tambem for admin/produtor, a sidebar mostra o cartao `Área do produtor`, com `Ir para o admin` (`/admin`) e o `Modo de visualização` da area do aluno. Esse cartao nao aparece para alunos comuns.

`Formacoes` nao deve aparecer como item principal da sidebar no MVP, porque formacoes sao apenas um tipo de produto dentro de `Minhas compras`. Quando o aluno quiser ver somente formacoes, isso deve acontecer por filtro dentro de `Minhas compras`.

Itens planejados para fase 2:

- Comunidade;
- Mural de membros;
- Conversas;
- Ranking;
- Certificados.

## Home

Estrutura:

```txt
Header
Hero
  Bloco visual configuravel da escola
  Titulo
  Descricao curta

Primeira fileira sobreposta ao final da hero
  Continue assistindo

Demais secoes
  Minhas compras
  Modulos de curso escolhido pelo produtor
  Produtos a venda
  Em breve na Bunker707
  Recomendadas para voce
  Materiais importantes
  Novidades

Footer
  Marca Bunker707
  Links de suporte e documentos
  Observacao de acesso
```

O fundo base da area de membros deve usar `#141414`, alinhado ao fundo da Netflix, para que paineis escuros de hover, modais, fades da hero e secoes de cards mantenham contraste sem se misturar com preto absoluto.

As fileiras depois de `Continue assistindo` devem ser configuraveis futuramente pela area administrativa: nome da fileira, ordem, tipo de conteudo, conteudos exibidos e publico-alvo. Exemplos: Minhas compras, Produtos a venda, Em breve na Bunker707, Bootcamps, Workshops, Aulas recentes ou Materiais.

Fileiras configuradas, mas sem itens resolvidos para aquele aluno, nao devem aparecer na home. Exemplo: `Em breve na Bunker707` so aparece quando houver conteudo cadastrado para essa fileira.

Para produtores com pouco catalogo, o CMS deve permitir ativar uma secao de modulos de um curso especifico na home. Essa secao mostra uma capa vertical reduzida do curso à esquerda, preservando a mesma proporcao da capa principal. À direita da thumbnail ficam o rotulo pequeno como `Cursos Online`, o titulo do curso e o botao de acao abaixo do titulo. O objetivo e evitar uma home vazia quando o produtor tem apenas um curso e reduzir o caminho do aluno: home > modulo > aula, sem exigir clique previo na capa do curso.

A mesma secao estrutural pode usar o layout imersivo: a imagem do conteudo vira um banner de fundo com degradê de legibilidade, titulo, descricao, CTA e uma fileira interna de cards. O layout compacto preserva a composicao mais curta. Em formacoes, os cards internos representam cursos associados; em cursos e bootcamps, representam modulos. Os dois layouts usam o mesmo resolvedor de acesso da Home e nao podem expor conteudo fora dos entitlements do aluno.

Quando o aluno tem acesso, o botao da capa reduzida do curso deve ser `Acessar`, com hover premium no estilo dos demais cards, e leva para a pagina normal do curso, com os modulos listados. Quando o aluno nao tem acesso, o botao deve ser `Comprar`. O produtor configura no CMS se esse botao abre o modal de detalhes ou o link externo de compra; quando usar link externo, o CMS tambem define se abre na mesma aba ou em nova aba.

Clicar diretamente em um card de modulo leva para a pagina de aula/playlist daquele modulo, com a sidebar de modulos à direita, quando o aluno tem acesso. O card de modulo dessa secao nao exibe botao proprio; o hover mostra titulo, metadado curto e progresso sobre o overlay. Quando o aluno nao tem acesso ao curso, clicar em qualquer modulo abre o modal de detalhes do curso por padrao.

Na home, os cards dos modulos dessa secao devem ter tamanho intermediario: menores que os cards principais de cursos, formacoes e bootcamps para nao confundir hierarquia, mas maiores que os cards internos da pagina do curso. O tamanho menor e a variacao visual de cards de modulos ficam reservados para a pagina propria do curso.

Essa secao de modulos nao deve virar uma explicacao longa sobre o que sao modulos. A propria capa, o rotulo pequeno, o titulo e os nomes cadastrados pelo produtor comunicam o conteudo. Modulos bloqueados por compra, entitlement ou regra de entrega devem manter overlay de bloqueio e levar o aluno ao modal de detalhes quando clicados.

`Minhas compras` deve agrupar todos os produtos com entitlement ativo do aluno, independentemente do tipo: formacoes, bootcamps e cursos avulsos. Evitar separar cedo demais em `Minhas formacoes` e `Meus cursos avulsos`, porque isso deixa a home mais fragmentada e menos natural para o aluno.

Cada fileira configuravel deve poder definir uma regra de visibilidade:

- apenas alunos/compradores;
- apenas visitantes ou pessoas sem compra ativa;
- todos.

A fileira `Produtos a venda`/`Vitrine` mostra somente produtos vendaveis aos quais o aluno ainda nao tem acesso. Produtos com entitlement ativo, gratuitos ou ja liberados para aquele aluno ficam fora dessa fileira e permanecem em `Minhas compras` ou nas demais secoes de biblioteca. Os produtos ainda nao adquiridos aparecem com cadeado.

Uma fileira como `Em breve na Bunker707` pode mostrar proximos cursos, formacoes, bootcamps, novidades e listas de espera para criar expectativa sem liberar acesso.

Regra de produto da vitrine:

- a vitrine mostra apenas produtos vendaveis: formacoes, bootcamps e cursos avulsos;
- em dados/UI, esses itens devem ser tratados como `sellable_product`;
- uma formacao e sempre um produto;
- uma pessoa que compra uma formacao tem acesso a todos os cursos internos daquela formacao;
- cursos internos de uma formacao nunca devem aparecer como produto separado na vitrine;
- cursos internos de uma formacao nunca devem ser vendidos separadamente;
- cursos internos de uma formacao devem ser tratados como `included_content`;
- cursos internos aparecem apenas dentro do modal ou pagina da propria formacao;
- cursos avulsos existem fora de formacoes e podem aparecer na vitrine como produto proprio;
- bootcamps tambem podem aparecer na vitrine como produto proprio.

O footer deve ser discreto, em uma linha sempre que houver espaco: logo, copyright/texto curto de acesso e links de suporte/documentos. Nao deve exibir subtitulo como `Area do aluno` abaixo da logo nem linguagem de venda publica. A logo oficial da Bunker707 deve ser usada no header, sidebar e footer, preservando a proporcao horizontal do asset.

## Hero

O hero deve ter altura generosa e imagem ou video de fundo. Ele deve ser configuravel na area interna da escola e pode ser uma capa institucional, uma chamada editorial, uma arte visual da Bunker707 ou um destaque de conteudo.

A hero nao precisa obrigatoriamente ter botoes, barra de progresso ou acao de assistir. O consumo principal acontece nos cards e fileiras. Quando houver CTA na hero, ele deve ser opcional e configuravel, nao uma regra fixa da home.

A primeira linha de cards deve comecar levemente sobre o fim da hero, criando continuidade visual.

O rodape da hero deve ter um degrade preto para suavizar a transicao entre a imagem/video e o fundo da area de membros. Esse fade deve ficar por baixo da primeira fileira, evitando uma divisao seca entre hero e carrosseis.

A primeira fileira deve invadir a hero apenas o suficiente para criar continuidade visual. Deve existir respiro claro entre o conteudo visual/textual da hero e o titulo `Continue assistindo`, evitando que a home pareca apertada.

Degrades editoriais coloridos na hero, como vermelho, laranja ou outras cores de campanha, nao devem ficar hardcoded na home. O padrao da interface deve ser neutro e escuro; cor, intensidade de overlay e efeitos visuais da hero devem ser configuraveis futuramente no dashboard da escola.

Conteudo configuravel do hero:

- midia de fundo: imagem, video ou capa;
- selo/label opcional;
- titulo;
- descricao curta;
- CTA opcional;
- cor, intensidade de overlay/degrade e efeitos visuais, fase futura.

Nas paginas proprias de formacoes, cursos, bootcamps e demais conteudos depois da home, o estado atual do prototipo deve usar hero limpa por padrao: apenas a imagem/capa visual, sem selo, titulo, descricao, breadcrumb ou botao sobreposto. Esses elementos continuam previstos como opcoes configuraveis do CMS para quando o produtor quiser ativar titulo centralizado, alinhado à esquerda/direita, subtitulo, tag ou CTA.

Quando a hero tiver apenas imagem/capa, nao deve haver degrade lateral da esquerda para a direita. O unico fade padrao e o degrade inferior, de baixo para cima, usado para integrar a imagem ao fundo da pagina. O degrade lateral deve entrar automaticamente ou por configuracao somente quando houver texto, CTA ou outros elementos sobrepostos que precisem de legibilidade.

Nas paginas proprias de conteudo, a secao de cards deve invadir levemente a hero, um pouco mais alta que a sobreposicao inicial, mantendo continuidade visual sem cobrir area importante da imagem.

## Cards verticais

Os cards da Bunker707 devem ser verticais nas fileiras de formacoes, bootcamps, cursos avulsos, workshops e demais secoes configuraveis.

A excecao e a primeira fileira da home:

- `Continue assistindo` usa thumbnails horizontais de video;
- deve mostrar a barra de progresso no ponto em que o aluno parou, derivada do progresso real da aula;
- pode mostrar titulo, contexto, percentual assistido e aula abaixo da thumbnail;
- pode ter um play discreto no centro da thumbnail durante o hover;
- deve manter hover proprio de video, com superficie estavel, zoom interno minimo na imagem igual aos cards de modulo do modal e play aparente no centro; nao usar a expansao externa grande dos cards verticais;
- nao deve usar botao grande de CTA nem botao de detalhes/seta para baixo; a acao esperada e clicar no card para continuar assistindo;
- titulo, contexto e progresso nao devem sumir no hover.

Formato recomendado:

- tamanho exibido do card vertical no desktop: cerca de 300 x 433.33;
- em telas desktop muito largas, pode crescer ate cerca de 320 x 462.22 sem dominar a fileira;
- proporcao do card: 720:1040, com largura:altura de 1:1.444;
- arquivo de capa enviado pelo admin/professor: 720 x 1040 px nesta fase, preservando margem de seguranca nas laterais;
- imagem/capa deve funcionar como poster premium: arte forte, titulo legivel e poucos elementos fixos;
- a foto do professor pode aparecer na arte quando fizer sentido para o curso, mas nao deve ser obrigatoria em todos os cards;
- dados como nome do professor, Instagram, nivel, quantidade de aulas e promessa curta devem existir como metadata do conteudo, para uso no modal e na pagina propria do curso/formacao;
- nenhuma tag, borda de tipo, botao ou informacao fixa sobre a capa;
- a capa deve aparecer limpa no estado normal;
- cards verticais podem exibir a logo horizontal completa da Bunker707 no canto superior esquerdo apenas no hover, em tamanho discreto, preservando a capa como elemento principal;
- no hover, o card vertical da home deve saltar para frente com escala maior que o estado inicial, leve elevacao para cima, sombra profunda, `z-index` acima dos vizinhos e transicao suave, aproximando o comportamento visual da Netflix sem parecer brusco;
- nos cards verticais expansivos da home, o hover deve respeitar a borda visivel do carrossel: o card encostado à esquerda cresce para a direita, e o card encostado à direita cresce para a esquerda, sem invadir o alinhamento lateral da secao; os cards internos da fileira mantem a escala central normal; em uma fileira curta, o ultimo card com espaco livre depois dele nao conta como borda direita e tambem cresce de forma centralizada;
- quando um card parcialmente visivel em qualquer borda vier para dentro no hover, o card adjacente que está fora da area visivel deve ocupar temporariamente o trecho parcial deixado no canto, indicando que a fileira continua; isso vale para o card seguinte à direita e para o card anterior à esquerda durante a volta do carrossel; ao sair do hover, os dois retornam suavemente às posicoes originais;
- o arredondamento deve permanecer em todos os cantos durante o hover;
- o hover nao deve revelar filetes claros, bordas brancas acidentais ou linhas de subpixel na parte inferior dos cards;
- as informacoes devem aparecer dentro do proprio card, sobre um degrade escuro de baixo para cima, sem criar painel externo abaixo da capa;
- o degrade do hover deve ser bem forte na area inferior, onde ficam texto e botoes, priorizando legibilidade sobre capas com muito contraste ou texto na arte; o topo deve continuar suave para preservar a arte;
- o hover deve mostrar apenas titulo, descricao curta, acao principal, botao para salvar/favoritar quando o aluno tiver acesso e um botao de seta para baixo para abrir o modal de detalhes;
- status de acesso, duracao, quantidade de aulas, tipo de produto e demais metadados nao devem aparecer no hover do card vertical da home; essas informacoes ficam no modal e/ou na pagina propria do conteudo; a excecao e o progresso, mostrado como um anel no canto superior direito do hover (nunca como a barra dos modulos, para nao confundir);
- qualquer elemento que tenha hover interativo deve usar cursor de mao/pointer;
- professor, foto do professor, Instagram e demais informacoes complementares nao devem aparecer no hover dos cards verticais; devem ficar no modal ou na pagina propria do curso/formacao;
- clicar no card ou na acao principal `Acessar` deve levar para a pagina propria do curso, formacao ou bootcamp;
- clicar na seta para baixo deve abrir o modal de detalhes sem navegar.
- clicar no botao de salvar/favoritar deve adicionar/remover o item da lista de favoritos do aluno sem navegar.
- em mobile/tablet, nao depender de hover para a acao principal; o toque no card deve abrir o modal de detalhes do conteudo;
- em mobile/tablet real, nao depender de hover ou pressao prolongada para revelar acoes; se o navegador simular hover em algum contexto, o card deve permanecer estavel e esse estado nao pode bloquear o toque principal.

## Carrosseis

As setas laterais de cada fileira devem aparecer somente quando houver overflow horizontal real e mover os cards com scroll horizontal suave, no estilo streaming. O movimento deve ser suficiente para revelar novos cards sem saltos bruscos.

As setas nao ficam em botoes circulares acima da fileira. Elas devem ser sobrepostas diretamente às bordas esquerda e direita do carrossel, centralizadas verticalmente sobre os cards, com um degrade escuro/esfumacado limitado à altura visual das capas entre a borda da pagina e o conteudo. O fade nao pode invadir o indicador acima, nem o respiro superior/inferior reservado para o card crescer no hover. O hover da seta nao pode criar um quadrado escuro isolado ao redor do icone; o feedback deve intensificar a faixa inteira do fade e ampliar/deslocar claramente a seta na direcao da navegacao. Exibir apenas a direcao que ainda tem conteudo disponivel; no inicio, a seta esquerda fica oculta, e no fim, a seta direita fica oculta. Quando os cards cabem dentro da largura disponivel, nao exibir setas nem fades.

Acima da fileira, alinhado à direita antes dos cards, deve existir um indicador compacto de paginas no formato de pequenos segmentos horizontais. O segmento ativo fica mais claro e deve acompanhar o `scrollLeft` real durante cliques nas setas, scroll nativo ou gesto de toque. O indicador aparece somente quando houver mais de uma pagina e vale para fileiras de produtos, cursos, formacoes e modulos, tanto na home quanto nas paginas internas de conteudo.

Carrosseis com cards verticais devem manter respiro vertical interno suficiente para que o hover ampliado nao seja cortado pelo proprio container de scroll horizontal, preservando o arredondamento superior e inferior dos cards.

Em mobile/tablet, os carrosseis devem usar o scroll horizontal nativo do navegador para preservar a fluidez do dedo e tambem manter controles discretos de navegacao por setas, sem depender de hover ou de drag customizado em JavaScript.

## Modal de detalhes

O botao de seta para baixo nos cards verticais deve abrir um modal de detalhes do conteudo. O modal deve funcionar como uma camada de navegacao e entendimento do conteudo, inspirado no modal da Netflix, mas adaptado para educacao.

O modal deve ficar acima de todos os elementos da aplicacao, inclusive header e sidebar, usando uma camada propria/portal quando necessario.

O modal nao deve ter uma barra de rolagem interna propria. Quando o conteudo for maior que a tela, a rolagem deve acontecer na camada externa do modal, ocupando o viewport, como se fosse o scroll da pagina. A barra de scroll deve aparecer no canto direito da tela/camada do modal, nao dentro do painel. A pagina de fundo deve ficar bloqueada na posicao atual enquanto o modal estiver aberto; apenas o conteudo do modal deve rolar.

O scroll do modal deve funcionar mesmo quando o mouse estiver sobre a area escura fora do painel, nao apenas sobre o painel do modal.

A abertura do modal deve ser suave, com backdrop entrando em fade e o painel aparecendo com leve movimento vertical e escala, evitando qualquer sensacao de abertura seca. O fechamento tambem deve ter uma micro transicao antes de desmontar o modal.

O topo do modal deve concentrar:

- capa/hero do conteudo;
- titulo sobreposto a capa;
- botoes de acao logo abaixo do titulo, tambem sobrepostos a capa;
- degrade inferior suficiente para manter titulo e botoes legiveis sobre a imagem.

A midia do topo e a mesma do banner da pagina do produto (`content_page_settings.hero`), desde 14/10/2026: a Imagem de destaque ou, quando o produtor cadastra um Video de destaque na aba Detalhes do admin, esse video com a Imagem de destaque como capa. O video pode ser um arquivo direto (.mp4/.webm/.mov, como o mp4 do Bunny Stream) ou um link do YouTube. Opcoes do produtor: tocar sozinho (sem som), repetir, botao de som, controle de volume, botao de pausar e linha do tempo (controles nossos, num grupo no canto do video, que no YouTube falam com o player pela API de mensagens) e, no YouTube, esconder logo e titulo (o iframe e ampliado alguns pontos e recortado pelas bordas, sem receber mouse; e um recorte de CSS fora das regras do player incorporado do YouTube, nao um recurso oficial, e pode ser desligado). Se o aparelho bloquear o autoplay, o player do YouTube volta a receber toque para o aluno usar o botao de tocar dele; video indisponivel ou fim sem repeticao voltam para a capa. Quem prefere menos movimento, ou quando "tocar sozinho" esta desligado, ve a capa com um botao de tocar. Sem destaque configurado, o topo continua usando a capa vertical do card (fallback). O componente e `src/components/hero-video.tsx`, compartilhado com o banner da pagina do curso.

Depois da imagem/capa, o modal deve exibir:

- descricao;
- professor, quando houver;
- metadados uteis para o aluno, como aulas/duracao e professor quando houver;
- progresso e demais informacoes do curso.

O modal da area do aluno nao deve exibir informacoes de CRM/backoffice, estrategia comercial ou classificacoes administrativas que nao ajudam o aluno a estudar. Evitar blocos como `comprado`, `conteudo: curso`, `nivel livre`, origem da compra, status operacional interno ou qualquer resumo que pareca dashboard do produtor. Esses dados podem existir no CRM, mas a experiencia do aluno deve priorizar entendimento da jornada, progresso e proximos passos.

Abaixo do topo, o conteudo do modal muda conforme o tipo:

- formacao: deve mostrar `Cursos da formacao`, em cards, com possibilidade de expandir para ver mais cards;
- curso avulso: deve mostrar `Modulos do curso`, em cards, com possibilidade de expandir para ver mais modulos;
- bootcamp: deve mostrar `Modulos do bootcamp`, em cards, com possibilidade de expandir para ver mais modulos;
- quando existirem mais cards escondidos em uma secao do modal, o estado fechado deve mostrar o inicio dos proximos cards com um degrade por cima e o botao circular de expansao, dando feedback visual de que ha mais conteudo abaixo;
- ao clicar em um modulo no desktop, o modulo selecionado deve ocupar a primeira posicao visual da secao, à esquerda, e a lista de aulas deve aparecer à direita;
- quando o modulo selecionado vier de uma area expandida ou antes escondida, o scroll do modal deve acompanhar suavemente o foco para que o aluno veja imediatamente o modulo selecionado e suas aulas;
- ao ocultar as aulas, os cards devem voltar ao grid normal;
- no mobile, o modulo selecionado pode ficar acima da lista de aulas, em coluna unica;
- a transicao entre grid normal, modulo selecionado e reagrupamento deve ser suave, com fade, leve deslocamento e movimento coerente com a direcao do layout;
- quando um modulo tiver muitas aulas, a listagem de aulas deve manter altura controlada e usar scroll interno discreto somente nessa lista, evitando que o card do modulo seja esticado verticalmente ou fique centralizado com grandes vazios;
- todos os cards verticais internos do modal devem compartilhar o mesmo comportamento de hover, inclusive cards em formacoes bloqueadas: o card nao move, nao cresce, nao altera sua sombra e nao exibe filetes claros; apenas a imagem interna recebe zoom leve e escurecimento discreto, com transicao lenta e suave;
- modulo: deve abrir/expandir uma lista de aulas com thumbnail, titulo, descricao e duracao, em formato mais detalhado, semelhante a uma lista de episodios;
- a thumbnail da aula no modal deve vir da propria aula: primeiro thumbnail oficial do video quando disponivel, depois thumbnail cadastrada para a aula. Nao usar capa aleatoria, capa generica do modulo ou imagem inventada como se fosse da aula;
- aula: deve priorizar dados da aula, materiais relacionados e proximos passos.

A area de `Episodios` do modelo da Netflix nao deve ser copiada diretamente para formacoes e cursos. Ela so faz sentido quando o aluno estiver olhando aulas dentro de um modulo.

No modal de uma formacao, os cards exibidos representam cursos internos da formacao, nao aulas diretamente. A lista de aulas aparece quando o aluno estiver olhando um curso/bootcamp e selecionar um modulo. Futuramente, clicar em um curso interno da formacao pode abrir a pagina/modal daquele curso.

O modal tambem deve ter um bloco `Sobre`, com explicacao, estrutura do conteudo, professor quando houver e demais informacoes relevantes para o aluno.

Nos cards de cursos internos dentro de uma formacao, nao exibir tags extras como `Incluso na formacao`, `Curso pratico`, `Curso base` ou similares. O proprio titulo da secao `Cursos da formacao` ja comunica o contexto. Priorizar capa, titulo, quantidade de aulas e descricao.

Por decisao atual, o modal de detalhes nao deve ter uma secao generica de `Conteudos relacionados`. Essa area pode voltar em fase futura se houver uma estrategia clara de recomendacao.

Excecao para conteudo nao comprado:

- cards verticais de formacoes, bootcamps e cursos avulsos sem entitlement ativo podem aparecer na home;
- devem aparecer preferencialmente em uma fileira de `Vitrine` ou outra fileira configurada para oferta, nao nas fileiras de biblioteca como `Minhas formacoes`, `Meus cursos avulsos` ou `Meus bootcamps`;
- a `Vitrine` deve conter somente produtos que o aluno ainda nao possui nem consegue acessar;
- no estado normal, devem mostrar apenas a capa em preto e branco e um cadeado moderno, bem visivel, sem texto e sem efeito colorido no topo;
- o cadeado de produto nao adquirido deve ser preto, sem caixa ou moldura ao redor, para nao competir com a marca/capa;
- ao passar o mouse, a capa bloqueada deve voltar a ter cor, mantendo o cadeado visivel;
- no hover, devem manter apenas titulo, descricao curta e acoes; o botao `Comprar` deve ser verde solido, com texto branco e largura destacada para diferenciar claramente da acao `Acessar`;
- conteudos bloqueados nao devem exibir botao de salvar/favoritar, porque o aluno ainda nao tem acesso ao produto;
- o botao `Comprar` deve apontar futuramente para oferta externa ou fluxo configurado, sem transformar a area de membros em checkout interno.

Metadados como professor, Instagram, qualidade de video `HD`/`4K`, desafios, quizzes e projetos devem existir como dados configuraveis para modal, pagina propria e futura area administrativa. Eles nao devem ser todos exibidos obrigatoriamente no hover do card, para evitar poluicao visual.

Nao usar cards muito arredondados. Preferir raio de 6px a 8px.

## Minhas compras

Tela em grid com todos os produtos comprados ou liberados por entitlement ativo.

Esta tela substitui a ideia generica de `Meu Conteudo` na navegacao principal. O nome comunica melhor a expectativa do aluno: ver tudo que ele comprou ou recebeu acesso.

Deve incluir:

- formacoes;
- cursos avulsos;
- bootcamps;
- filtros por tipo e status;
- progresso contextual de cada produto;
- acao principal: continuar, comecar, revisar ou ver cursos/modulos.

Nao deve mostrar cursos internos de formacao como produtos comprados separados. Cursos internos aparecem dentro da pagina/modal da propria formacao.

Implementacao atual (aluno v2, `src/server/member-area/purchases-view.ts` + `src/components/purchases-experience.tsx`):

- os numeros vem da biblioteca do aluno (`getMemberLibrary`), com o progresso do proprio aluno; a tela nao usa mais as colunas globais `content_items.progress/status` e o antigo "Progresso medio" saiu;
- topo com `Produtos`, `Em andamento`, `Concluídos` e `Aulas concluídas` (de N) e o botao `Continuar de onde parei` quando existe aula para retomar;
- filtros por situacao (`Todos`, `Em andamento`, `Não iniciados`, `Concluídos`), por tipo (so os tipos presentes) e busca pelo nome;
- card vertical por produto: progresso real (na formacao, soma os cursos internos), acao `Continuar` com o nome da aula, `Começar`, `Revisar` ou `Ver cursos`, quantas aulas faltam liberar ou `Liberação em 08/11/2026` quando o produto inteiro ainda esta fechado;
- linha de acesso: `Desde 01/01/2026 · Acesso vitalício` ou `Acesso até ...`, em ambar quando faltam 30 dias ou menos. Conteudo gratuito, previa do produtor e acesso sem data registrada ficam sem essa linha;
- ordem: o que o aluno assistiu por ultimo primeiro; depois os nao iniciados, na ordem do produtor;
- vazio real: `Você ainda não tem produtos liberados`, com o caminho para o Suporte; vazio de filtro: `Nada encontrado` com limpar filtros.

## Favoritos

Tela em `/favoritos` com tudo que o aluno salvou para voltar depois.

Deve incluir:

- cursos, formacoes, bootcamps, mentorias, webinarios e produtos salvos;
- modulos salvos;
- aulas salvas;
- filtros por tipo;
- busca textual nos itens favoritos;
- acao para remover da lista sem sair da tela.

Favoritar nao libera acesso. A tela continua respeitando entitlements e regras de liberacao.

Implementacao atual (aluno v2, `src/server/member-area/favorites-view.ts` + `src/components/favorites-experience.tsx`): abas `Todos`, `Conteúdos`, `Módulos` e `Aulas` com contagem, busca, produtos e modulos em card vertical e aulas em card 16:9 com o progresso do aluno. Item salvo sem acesso aparece como `Sem acesso`, leva para a pagina do produto e nunca mostra a capa do video; aula ainda nao liberada mostra a data de liberacao. Remover um favorito tira o card na hora, sem sair da tela. Vazio: `Você ainda não salvou nada`, com o caminho para a pagina inicial.

## Paginas da barra lateral (aluno v2)

Todas leem a biblioteca do aluno (`getMemberLibrary` em `src/server/db/platform-store.ts`, tipos em `src/lib/member-library.ts`): so conteudo com acesso real (ou gratuito, ou previa do produtor para admin), com o progresso do proprio aluno. Nenhuma pagina mostra numero, curso ou material inventado; sem dado, aparece o estado vazio com o proximo passo.

- Minha jornada: numeros reais (aulas concluidas, cursos em andamento e concluidos, ultima atividade), "Continue de onde parou", progresso por produto com a proxima aula e as aulas que ainda vao ser liberadas, e atividade recente. Sem pontos, ranking ou sequencia de dias nesta fase.
- Continue assistindo: aulas comecadas e nao terminadas (mesma regra da fileira da home), da mais recente para a mais antiga.
- Materiais: materiais de apoio de todas as aulas liberadas do aluno, com filtro por produto e tipo e busca; material com regra extra mostra o motivo do bloqueio.
- Suporte: canais configurados pela escola (link de ajuda da tela de entrar: e-mail, WhatsApp ou pagina de ajuda) e perguntas frequentes. Sem formulario enquanto nao existir caixa de entrada no admin para responder.
- Perfil: abas Dados, Acessos (data de inicio e fim de cada acesso ativo) e Segurança (alterar senha e sair). Edicao de nome/telefone fica para depois de unificar as tres origens do nome (cadastro do aluno, perfil e conta).

## Pagina de formacao e curso

Formacoes, cursos avulsos, bootcamps e cursos internos de uma formacao devem ter pagina propria dentro da area do aluno.

A navegacao superior dessa pagina deve usar breadcrumb, nao um botao isolado de voltar para a home. O breadcrumb deve mostrar o rastro real da navegacao, por exemplo:

- Home > Formacoes > Nome da formacao;
- Home > Nome da formacao > Nome do curso interno;
- Home > Cursos > Nome do curso avulso.

A pagina deve ter uma hero configuravel pelo dono do conteudo no dashboard/CRM:

- midia de fundo: imagem ou video;
- selo/label opcional;
- titulo opcional;
- descricao opcional;
- botao/CTA opcional;
- link ou destino do CTA;
- intensidade de overlay/degrade e efeitos visuais em fase futura.

Todos os textos da hero da pagina de formacao, curso, bootcamp ou modulo devem ser opcionais e configuraveis de forma independente no CMS. A hero pode ser apenas visual, usando somente imagem ou video de fundo, sem selo, titulo, descricao ou botao.

Cursos, bootcamps, mentorias, webinarios e produtos com aulas devem ter uma configuracao explicita de apresentacao:

- curso com cards de modulos: o card do curso leva para a pagina do conteudo e a pagina mostra cards verticais dos modulos; ao clicar em um modulo, o aluno entra na pagina de aula/playlist;
- `Card unico`: o card do curso leva diretamente para a pagina de aula/playlist, mantendo os modulos listados na sidebar lateral da aula.

Essa escolha deve ser feita por switch no CMS. A ausencia de imagem em modulos nao deve decidir o fluxo, porque um curso pode ter alguns modulos com capa e outros sem capa sem que isso mude a navegacao esperada.

Abaixo da hero:

- se o conteudo for formacao, exibir uma fileira horizontal unica com cards verticais dos cursos internos;
- se o conteudo for curso avulso ou bootcamp, exibir uma fileira horizontal unica com cards verticais dos modulos;
- fileiras internas devem navegar por setas laterais e scroll horizontal, seguindo o espacamento entre fileiras da home quando o produtor criar secoes adicionais como materiais extras, bonus ou outros blocos configuraveis;
- se um curso interno de formacao for configurado para abrir direto em formato de aula, ele deve navegar para a pagina de aula/playlist, nao listar aulas dentro da pagina da formacao;
- a escolha entre abrir curso interno como pagina de modulos ou direto no formato de aulas deve ser configuravel no dashboard/CRM.
- decisao atual Bunker707: cursos internos dentro de formacoes abrem direto a pagina de aula/playlist; nao ha uma etapa intermediaria com cards de modulos nesses cursos.
- decisao atual Bunker707: cursos avulsos continuam exibindo cards verticais de modulos antes da pagina de aula.

Ao clicar em um modulo, o destino deve ser uma pagina de aula/playlist separada. A pagina do curso ou bootcamp nao deve expandir nem listar aulas embaixo do card do modulo.

Tamanho dos cards:

- cards verticais da home: voltar para o porte premium anterior, cerca de 398 x 574,88 px no desktop amplo, reduzindo proporcionalmente em telas menores;
- cards de cursos dentro de formacoes e cards de modulos dentro de cursos avulsos/bootcamps podem usar o mesmo padrao de poster vertical, com informacao dentro do proprio poster via overlay/degrade no hover.
- somente os cards verticais da home crescem e saltam para frente no hover. Cards internos de cursos, formacoes, modulos e bootcamps nao devem aumentar, subir, empurrar vizinhos ou mudar de posicao; no hover, apenas a imagem de fundo da capa faz zoom interno e o overlay revela texto/informacoes.
- cards internos nao devem ter bloco externo de texto/progresso abaixo da capa.
- cards de modulos devem mostrar uma barra de progresso personalizada dentro do overlay do hover, com metadado curto a esquerda, percentual a direita e a barra logo abaixo.
- cards de cursos internos dentro de formacoes nao devem mostrar a barra de progresso no card; o hover pode mostrar titulo, descricao curta e metadado como quantidade de aulas.
- cards internos podem ter acao explicita em botao ou acao implicita pelo clique no card, conforme configuracao futura do CMS.
- o CMS futuro pode permitir tags/selo por card, como `Curso`, `Modulo`, `Bonus`, `Projeto` ou texto definido pelo produtor, para diferenciar niveis sem exigir um componente visual diferente.
- decisao atual Bunker707: cards de modulos de cursos avulsos nao exibem botao retangular `Acessar`; o card inteiro e clicavel e o hover comunica titulo, descricao, progresso e quantidade de aulas.
- decisao atual Bunker707: cards de cursos internos dentro de formacoes tambem usam acao implicita; clicar no card abre a pagina de aula/playlist do curso e o card nao exibe botao `Acessar` nem barra de progresso.
- o espaco horizontal entre cards deve usar 1.5rem, equivalente a 24px na base padrao de 16px.

Cada card deve mostrar:

- capa;
- titulo;
- progresso, quando o card representar modulo ou quando o CMS habilitar progresso naquele tipo de card;
- quantidade de aulas concluidas;
- status de acesso;
- acao principal: abrir ou continuar, quando o CMS habilitar botao explicito; quando a acao for implicita, o proprio card deve ser o alvo clicavel.

O progresso exibido aqui deve ser do produto ou conteudo daquele card, nao um progresso global do aluno.

Filtros planejados:

- todos;
- cursos avulsos;
- formacoes;
- bootcamps;
- em andamento;
- concluidos;
- novos.

## Pagina de curso, formacao ou bootcamp

Objetivo: explicar o conteudo e mostrar a estrutura completa.

Estrutura:

- banner;
- titulo;
- descricao;
- progresso contextual do produto;
- botao "Continuar";
- lista de modulos;
- aulas dentro dos modulos;
- desafios, quizzes e projetos praticos, quando configurados;
- materiais complementares;
- certificado, quando existir.

O progresso deve separar consumo e execucao:

- progresso de aulas: aulas assistidas, aulas concluidas e tempo assistido;
- progresso pratico: quizzes respondidos, desafios enviados, projetos entregues e aprovacoes, quando houver;
- conclusao real: calculada a partir das regras do produto, podendo exigir apenas aulas ou tambem entregas praticas obrigatorias.

## Pagina da aula

Tela principal de consumo.

Estrutura:

```txt
Breadcrumb
Player principal
Titulo da aula
Botao Concluir / Concluida
Favoritar ou salvar
Materiais
Avaliacao por reacao
Tabs: Comentários, Materiais, Tutor IA
Playlist lateral com modulos e aulas
```

Desktop:

- breadcrumb acima do player;
- player grande a esquerda;
- botao de voltar para a pagina do conteudo sobreposto no canto superior esquerdo do player, aparecendo no hover/foco e usando o mesmo hover circular escuro dos botoes secundarios; seu tooltip deve ficar acima do player e nao pode ser cortado pela area do video;
- overlays do player, como voltar, reproduzir e mostrar playlist, devem ficar abaixo do header global quando houver sobreposicao durante o scroll;
- nao exibir selo/tag do provedor de video sobre o player, como `YouTube`, `Vimeo` ou similares; essa informacao nao ajuda o aluno no consumo da aula;
- mensagens visiveis ao aluno sobre carregamento, indisponibilidade, erro ou Modo TV devem ser neutras e nunca citar `YouTube`, Vimeo, Bunny, Mux ou qualquer outro provedor de video;
- controles de aula anterior/proxima nao ficam no topo da pagina; essa navegacao acontece pela playlist lateral e futuramente pelos controles internos do player;
- aula ou modulo com liberacao programada mostra a data real calculada no servidor para aquele aluno, no fuso de Sao Paulo, tanto na lista de aulas quanto no aviso sobre o video: `Liberação em 08/01/2026` (com hora, `Liberação em 08/01/2026 às 14:00`, quando o atraso for em horas; `Liberação hoje às 14:00` no proprio dia). A data vem da mesma conta que libera o acesso (`src/server/access/release-policy.ts`: inicio do acesso + atraso). Sem acesso real ou sem data (visitante, previa do produtor, conteudo gratuito) continua a frase generica (`Disponível 7 dias após a compra`). Quando o webhook da plataforma de venda gravar o fim da garantia (Hotmart: `warranty_expire_date`), a mesma conta podera usar essa data como inicio;
- o aviso sobre o video mostra cadeado, `Esta aula será liberada`, a data e a linha discreta `Conta a partir da data da sua compra.`; na lista de aulas o selo curto e `Liberação em 08/01` (a frase completa fica no nome acessivel). Aula que depende da anterior mostra `Disponível depois que a aula anterior for concluída`;
- se a data passar com a pagina aberta, a pagina se atualiza sozinha e o aviso oferece `Atualizar agora` como plano B. Ao concluir a aula anterior, a pagina busca de novo os dados e a proxima aula chega pronta para assistir;
- aula ainda nao liberada nunca chega ao navegador com o video (nem o ID do YouTube); o modal da home e a pagina do conteudo nao enviam video de nenhuma aula, so a imagem ja resolvida;
- botao principal abaixo do video marca/desmarca a aula como concluida, muda para estado verde `Concluida` e deve preservar esse estado quando o aluno voltar para a aula;
- botoes secundarios como materiais, TV, salvar e avaliar devem ser circulares, iconograficos, com borda discreta no estado normal e feedback visual proprio no hover/foco, sem depender de tooltip nativo do navegador;
- o botao de TV usa o nome acessivel e o tooltip `Assistir na TV`. Ao clicar, abre um modal compacto com endereco `/tv`, QR Code, codigo temporario de seis caracteres e estados explicitos de preparacao, espera, conexao, reconexao, expiracao, erro e encerramento;
- o QR Code contem apenas o endereco Bunker707 `/tv` com o codigo temporario. Depois do pareamento, o mesmo modal vira um controle remoto com reproduzir/pausar, voltar 10 segundos, avancar 10 segundos e encerrar; o tempo assistido na TV atualiza o progresso real da aula;
- depois do pareamento, o receptor mantem a capa da aula sobre o embed ate o primeiro estado real de reproducao, evitando mostrar o frame preto inicial e legendas soltas do YouTube; depois do primeiro play, pausas normais preservam o frame atual do video;
- comandos do controle remoto devem chegar ao receptor em poucos centenas de milissegundos, sem requisicoes sobrepostas; play e pausa atualizam o modal de forma otimista enquanto a confirmacao real da TV continua vindo do heartbeat;
- o controle remoto conectado tambem oferece `Velocidade de reprodução` com as taxas realmente aceitas pelo player da TV. A taxa marcada e sempre a velocidade efetiva confirmada pelo receptor; enquanto uma mudanca aguarda confirmacao, o modal mostra esse estado sem declarar antecipadamente que a TV aceitou a nova velocidade;
- no primeiro pareamento e sempre que um modal conectado e reaberto, o estado atual do player da aula e enviado por inteiro para a TV: posicao absoluta, reproduzindo/pausado, volume, mudo, velocidade, legenda e qualidade. Assim, assistir um trecho no computador com o modal fechado e reabrir `Assistir na TV` transfere a reproducao a partir do ponto atual;
- a legenda nativa do YouTube permanece descarregada no receptor. Quando a legenda Bunker707 estiver ativa no player, a TV consulta a mesma faixa protegida e renderiza sua propria legenda centralizada, sem fragmentos cortados pelo recorte do iframe. Cues sobrepostas usam sempre a frase mais recente que ja iniciou; no player manual, o relogio da legenda acompanha o audio audivel, mantendo a fala alinhada sem tornar a sincronizacao de audio e video agressiva;
- em `Automático`, a TV continua usando a adaptacao do embed. Quando a aula estiver em uma resolucao manual como `2160p`, o receptor autenticado pelo token temporario busca os mesmos fluxos separados de video e audio e reproduz essa resolucao com o player manual da plataforma;
- o receptor oferece o mesmo controle iconografico de tela cheia do player, no canto inferior direito da barra de controles, sem um botao textual flutuante sobre o conteudo. O icone muda para sair da tela cheia enquanto o modo estiver ativo. O controle e seu degrade aparecem durante interacao por mouse, toque, teclado ou controle remoto e desaparecem automaticamente depois de alguns segundos sem atividade, deixando o video limpo. A entrada nesse modo exige uma acao feita na propria TV por restricao dos navegadores e nao pode ser forçada pelo controle remoto em outro aparelho;
- o iframe do receptor nao recebe clique, foco ou teclado e usa o mesmo recorte de contencao visual do player da aula para manter titulo, links laterais e marca do YouTube fora da area visivel. Essa camada e de UX e nao oculta tecnicamente a origem do video;
- a primeira versao do Modo TV e propria da plataforma e atende aulas do YouTube. Ela nao deve ser apresentada como Chromecast, Google Cast ou AirPlay nativo, porque a IFrame API do YouTube nao fornece um comando programatico para iniciar esses protocolos;
- o titulo principal da aula usa branco puro para manter a hierarquia e o contraste sobre o fundo escuro;
- clicar no atalho iconografico de `Materiais` seleciona essa aba, move o foco para ela e faz uma rolagem suave ate o painel de apoio, respeitando a altura do header fixo;
- tooltips desses botoes devem usar caixa branca com seta, fonte media/regular e sem peso excessivo;
- avaliacao da aula deve seguir o padrao de reacao da Netflix: um botao de curtida abre tres opcoes (`Nao gostei`, `Gostei`, `Amei`) em uma pilula escura, com tooltip branco individual; opcoes selecionadas usam apenas contorno colorido, incluindo o coracao de `Amei`;
- depois da selecao da reacao, a pilula deve fechar para nao conflitar com outros tooltips;
- depois que o aluno assistir pelo menos 30% uma vez, o botao de avaliacao permanece disponivel nessa aula mesmo se ele arrastar o video de volta para o inicio; o percentual atual continua podendo regredir para alimentar `Continue assistindo` e progresso do modulo.
- `Continue assistindo` deve priorizar imagem do ponto de retomada quando o provider/adapter fornecer um frame salvo; quando isso nao existir, usar thumbnail oficial do video; somente depois usar thumbnail cadastrada da aula ou imagem do modulo como fallback;
- playlist lateral fixa a direita, alinhada ao topo do player e nao ao breadcrumb;
- playlist lateral deve ter scroll interno proprio, com cabecalho fixo e area de aulas rolavel, garantindo que o ultimo modulo e a ultima aula fiquem totalmente acessiveis;
- abrir/fechar um modulo na playlist nao deve trocar a aula em reproducao; a aula ativa muda somente quando o aluno clica em uma aula;
- tabs abaixo do player.
- o painel de apoio da aula usa as abas `Comentários`, `Materiais` e `Tutor IA`; a terceira combina um chapéu de formatura, representando tutoria, com uma estrela discreta, representando IA;
- `Tutor IA` usa respostas reais geradas somente depois de validar sessao, entitlement, transcricao ativa, chunks e provedor configurado. A interface nunca simula resposta e explica quando a aula ou o modelo ainda nao estao prontos;
- visual do `Tutor IA` (aluno v2): cabecalho com o icone do Tutor, `Responde com base nesta aula` e ponto verde/cinza de disponibilidade; historico recolhivel (trilho a esquerda no computador, folha por cima no celular); sugestoes em 2x2 no chat vazio; pergunta do aluno em balao a direita e resposta sem balao, com avatar; campo em pilula que cresce ate 6 linhas, `Enter` envia e `Shift+Enter` quebra linha;
- aba `Materiais` (aluno v2): mostra so materiais reais da aula, lidos por `/api/materials/lessons/[lessonId]` depois de conferir sessao, acesso e liberacao da aula. O painel separa `Disponíveis` de `Para liberar` (com o que fazer para liberar), tem estados de carregando, vazio (`Esta aula ainda não tem materiais`) e erro com `Tentar de novo`; o numero da aba so aparece depois de carregar. A antiga lista fixa de exemplo foi removida;
- o histórico do `Tutor IA` pertence ao aluno e à aula atual, fica persistido sem expiração automática e pode ser consultado ou retomado posteriormente;
- o Tutor e carregado somente no primeiro acesso daquela aula. Depois disso, trocar entre `Comentários`, `Materiais` e `Tutor IA` preserva chat selecionado, mensagens, rascunho, posição e resposta em andamento; dados ja carregados reaparecem imediatamente, sem retornar ao loading integral;
- o historico pode ser revalidado silenciosamente depois da janela de frescor, ao recuperar foco ou conexao. A interface continua mostrando os dados existentes durante essa verificacao e so muda quando o servidor devolver um estado diferente;
- trocar de aula encerra o escopo em memoria da aula anterior. A nova aula nunca exibe conversas antigas e continua sem buscar o Tutor antes do primeiro acesso, exceto quando o aluno troca de aula mantendo a aba `Tutor IA` visivel;
- um mesmo aluno pode criar vários chats independentes com o tutor dentro da mesma aula. Por exemplo, pode manter um chat para resumo e outro para localizar os momentos em que determinado assunto aparece no vídeo;
- a entrada da aba deve permitir abrir um chat anterior ou iniciar `Novo chat`; continuar um chat preserva todas as mensagens anteriores, enquanto criar outro inicia um contexto separado sem misturar as conversas;
- cada item do histórico deve oferecer um menu discreto de três pontos com `Renomear chat` e `Excluir chat`. O dropdown usa largura fixa, tipografia leve, ícones pequenos e rótulos em uma única linha; renomear abre um diálogo compacto e persiste o título, enquanto excluir exige confirmação;
- depois de confirmar a exclusão, a conversa desaparece imediatamente, não pode ser aberta nem continuada pelo aluno e o próximo chat disponível é selecionado;
- essa ação é uma exclusão lógica: a conversa permanece no backend para análise agregada de dúvidas, temas e oportunidades de novos conteúdos, sem voltar ao contexto do tutor. Exclusão ou anonimização efetiva de dados pessoais pertence ao fluxo de privacidade/LGPD, não a essa ação de organização do histórico;
- respostas do tutor podem mostrar `[MM:SS]` ou `[HH:MM:SS]` somente quando o backend validar uma fonte especifica da legenda. A IA cita identificadores opacos de cues, nunca calcula horarios; o servidor converte a fonte aprovada no tempo real, aplica margem de 3 segundos para tras e torna apenas esse marcador clicavel. Horarios antigos, livres ou sem citacao validada permanecem como texto comum. Transcricoes TXT sem tempo usam `Trecho N` e nunca inventam horario;
- o estado `Assistindo...` na thumbnail da playlist deve aparecer somente depois que o aluno clicar no player/botao de reproduzir naquela sessao, nao apenas porque a aula esta selecionada.
- o clique/play do player deve registrar `lesson_started`/progresso inicial e permitir que a aula apareca em `Continue assistindo`.
- a plataforma deve salvar segundos e percentual assistidos por aula, independentemente do provedor de video. HTML5/player proprio envia tempo real por eventos nativos; YouTube usa a IFrame API para ler `currentTime`, `duration`, pausa e conclusao; Vimeo, Bunny, Mux e embeds externos devem passar por adaptadores equivalentes ou, enquanto a API especifica nao estiver integrada, por uma ponte de inicio + temporizador de sessao.
- ao retornar para uma aula com progresso salvo, o player deve posicionar no ponto salvo quando o provedor permitir `seek`/parametro de inicio; YouTube deve usar `start` no embed e `seekTo` no adapter, mas sem autoplay. O aluno precisa dar play explicitamente. No YouTube, antes do clique de play, a UI deve mostrar a thumbnail oficial do video com a barra de progresso salva, evitando a tela preta que o embed pode renderizar antes da reproducao. Providers que renderizem frame pausado de forma confiavel podem usar esse frame no futuro.
- no modo gratuito com YouTube, a area do aluno deve exibir somente os controles Bunker707: o iframe nao recebe clique, foco ou teclado, os controles nativos ficam desativados e as regioes residuais de titulo, canal, compartilhamento e marca do provedor sao cobertas pelo proprio player. Play/pausa, seek, som/volume, velocidade, qualidade e tela cheia continuam acessiveis pelos controles da plataforma.
- os controles Bunker707 usam uma timeline fina e transparente acima da linha de acoes, sem faixa escura continua sobre o video. À esquerda ficam play/pausa, retroceder 10 segundos, avancar 10 segundos, volume e tempo atual/total; à direita ficam somente legenda, engrenagem de configuracoes e tela cheia. Em telas estreitas, os tempos podem ficar junto da timeline para preservar todos os sete botoes.
- a engrenagem de configuracoes deve reunir velocidade e qualidade em navegacao hierarquica igual ao YouTube. O primeiro nivel mostra somente `Velocidade de reprodução` e `Qualidade`, cada linha com icone proprio, valor atual discreto e chevron fino. A superficie e preta translucida com blur, cantos suaves e tipografia regular, sem fontes grandes ou pesadas. Ao clicar, o menu navega para a lista vertical correspondente, com titulo e botao de voltar; velocidade e resolucoes nunca aparecem achatadas ao mesmo tempo. A engrenagem nao exibe tooltip visual no hover; seu contexto permanece no nome acessivel para tecnologias assistivas. Ela continua exibindo um selo compacto da qualidade em uso; no modo manual, ele deriva da selecao (`HD`, `2K`, `4K` etc.) e, em `Automático`, comeca como `AUTO` e muda conforme a qualidade reportada pelo player. Se o provider informar apenas a categoria generica `highres`, usar `HD+` e nao inventar `2K` ou `4K`.
- o menu da engrenagem fecha e retorna ao primeiro nivel quando o aluno clica em qualquer ponto fora do proprio controle, inclusive fora do player;
- o submenu de velocidade deve listar verticalmente somente as taxas aceitas pelo video/player atual, marcar a taxa efetiva e confirmar mudancas reportadas pela API do provider. A velocidade escolhida deve ser preservada ao trocar entre resolucao automatica e manual; no modo manual, audio e video separados precisam usar a mesma taxa para permanecer sincronizados.
- o submenu de qualidade deve listar verticalmente primeiro todas as resolucoes reais disponiveis para aquele video e compativeis com o navegador, deixando `Automático` como a ultima opcao. Se a origem oferecer 4K, por exemplo, o menu deve incluir `2160p` com a dimensao `3840x2160`; nao exibir opcoes fixas ou inventadas. A caixa deve mostrar todas as opcoes sem scroll interno e nao precisa de paragrafo explicando como o modo automatico funciona.
- `Automático` e o modo inicial e mantem a adaptacao nativa do YouTube: o provedor busca a maior qualidade sustentavel para as condicoes atuais de conexao, buffer, tamanho de exibicao e capacidade do dispositivo, podendo subir ou reduzir a resolucao durante a aula. Em um video 4K, conexao estavel e dispositivo compativel permitem que o YouTube chegue a 4K, mas a plataforma nao deve fingir que `Automático` fixa 4K. A IFrame API nao aceita mais comandos para forcar ou consultar diretamente a qualidade; a UI apenas acompanha as mudancas reportadas por `onPlaybackQualityChange`.
- ao escolher uma resolucao manual, o player Bunker707 reproduz diretamente os fluxos temporarios separados de video e audio, mantendo os mesmos controles e sem revelar branding clicavel do provedor. A troca de modo ou resolucao deve preservar, sempre que possivel, a posicao atual, o estado de reproducao, o volume, a velocidade e a legenda. Durante a preparacao conjunta das duas faixas, inclusive em 4K, a thumbnail permanece visivel em vez de uma tela preta; a reproducao so retoma quando audio e video possuem dados suficientes, e correcoes periodicas de sincronia devem evitar reposicionamentos agressivos que causem cortes audiveis.
- essa camada e apenas de apresentacao e pode precisar de ajuste quando o YouTube mudar o embed. Ela nao e DRM: uma pessoa com conhecimento tecnico ainda pode descobrir o ID e a origem do video inspecionando o HTML ou as requisicoes de rede.
- enquanto a pagina de aula estiver montada, o menu de contexto deve ficar bloqueado em toda a pagina, inclusive fora do player. A mesma barreira de atrito intercepta `F12`, os atalhos comuns de DevTools no Windows, Linux e macOS, `Ver codigo-fonte`, a tecla de menu de contexto e `Shift+F10`. Esses bloqueios nao substituem autorizacao, nao impedem abertura das ferramentas pelo menu do navegador e nao devem ser descritos como protecao absoluta.
- a carga da pagina do aluno nao deve serializar a URL original de visualizacao do YouTube quando um ID valido ja puder ser derivado no servidor. Rotas auxiliares de resolucao e legenda recebem apenas os IDs internos de conteudo/aula, validam sessao e entitlement e resolvem o ID do YouTube no servidor. O iframe e os fluxos de reproducao ainda tornam a origem tecnicamente observavel, mas a URL completa deixa de aparecer de forma redundante nos dados e consultas da aplicacao.
- comentarios da aula devem usar layout de thread leve, sem transformar cada comentario em card; avatar/foto, nome, tempo relativo, etiqueta de funcao, reacoes por emoji/curtida e menu de denuncia ficam no proprio item;
- toda pessoa tem etiqueta de funcao ao lado do nome: `Aluno` (discreta), `Professor` (vermelha, para produtor/equipe de conteudo) e `Moderador` (neutra, para os papeis de suporte e analista). O papel e gravado no comentario no momento do envio; comentarios antigos mantem o papel gravado;
- respostas a um comentario devem aparecer indentadas dentro do comentario principal, com a mesma etiqueta de funcao;
- cada comentario e resposta deve ter acao `Responder`; ao clicar, o composer deve entrar em modo resposta e preencher automaticamente a mencao `@nickname` da pessoa respondida;
- mencoes em comentarios/respostas devem gerar notificacao futura no sininho da plataforma para a pessoa mencionada ou dona do comentario respondido;
- avatares dos comentarios usam cor solida ou foto do perfil, sem degrade; o indicador de presenca fica na intersecao inferior direita do circulo, com borda na cor do fundo da pagina e sem brilho/esfumacado; online usa ponto verde, offline usa ponto cinza com centro na cor do fundo;
- a lista padrao de reacoes de comentario deve ter mais opcoes que apenas curtir, por exemplo curtir, fogo, insight, coracao, aplausos, risada, surpresa, foguete, de olho e util;
- menus de reacao e denuncia devem fechar quando o aluno clicar fora do menu;
- o campo de novo comentario deve ser visualmente diferente da thread, usando uma caixa clara de digitacao com textarea e botao de envio alinhado dentro do mesmo bloco;
- a caixa de escrever fica no topo da aba (aluno v2, `src/components/lesson/lesson-comment-composer.tsx`): avatar do aluno, campo que cresce, faixa `Respondendo a @usuario` com cancelar, contador a partir de 1.800 de 2.000 caracteres, `Ctrl/⌘ + Enter` publica e botao `Publicar` (ou `Responder`). Com a aula ainda bloqueada, a caixa fica desabilitada com o motivo e os comentarios nao sao buscados.

Mobile:

- player no topo;
- playlist vira accordion ou drawer;
- materiais e comentarios abaixo.

## IA Diretor

A IA Diretor e a orientadora geral da escola. Ela nao substitui o Tutor IA de cada aula: o Tutor funciona como professor do conteudo atual, enquanto a Diretora ajuda o aluno a encontrar cursos, modulos, aulas e assuntos, decidir o proximo passo e organizar trilhas de estudo.

Comportamento:

- fica disponivel em um launcher circular discreto no canto inferior direito de todas as paginas autenticadas da area do aluno;
- usa `Compass` com uma estrela de IA, diferenciando-se do chapeu de formatura do Tutor;
- no desktop abre um painel flutuante ancorado acima do launcher, sem bloquear a pagina; no celular ocupa a tela para preservar leitura, teclado e historico;
- a entrada explica apenas que o aluno pode encontrar aulas, descobrir o que estudar e organizar o proximo passo, sem mencionar transcricao ou detalhes tecnicos;
- oferece sugestoes como `Onde encontro um assunto?`, `O que devo estudar agora?` e `Monte uma trilha de estudos`;
- possui historico persistente, varios chats independentes, novo chat, renomeacao e exclusao logica;
- respostas podem usar Markdown, mas destinos de navegacao aparecem como referencias internas verificadas pelo servidor, com tipo, titulo, contexto e acao `Abrir`;
- ao abrir uma referencia, a navegacao preserva o salvamento pendente de progresso e favoritos;
- o historico da IA Diretor nunca e misturado com chats do Tutor IA, mesmo quando o painel e usado dentro de uma pagina de aula;
- as conversas ficam salvas no historico do aluno. Excluir um chat o remove da experiencia e do contexto futuro, mantendo o registro de backend conforme a politica de retencao e privacidade;
- se nao houver provedor ativo ou conteudo autorizado disponivel, a interface apresenta indisponibilidade real e nao simula respostas; o motivo aparece no lugar das sugestoes, para nao ficar escondido;
- visual (aluno v2): a entrada cumprimenta pelo primeiro nome (`Olá, Ana`) e mostra tres sugestoes em cartoes; o historico abre dentro do proprio painel, agrupado em `Hoje`, `Ontem`, `Últimos 7 dias`, `Últimos 30 dias` e `Mais antigas`, com data relativa e quantidade de mensagens; o campo cresce ate 6 linhas, `Enter` envia e um contador aparece perto do limite de 4.000 caracteres;
- a pergunta recem-enviada fica na tela ate a resposta chegar, mesmo quando o envio cria um chat novo.

## Busca

Busca deve encontrar:

- cursos avulsos;
- cursos internos;
- formacoes;
- bootcamps;
- aulas;
- materiais;
- lives gravadas, quando existirem.

Estado vazio deve ser simples e util:

- "Nada encontrado";
- sugestao de alterar os termos;
- talvez links para conteudos populares.

## Perfil

Pagina `/perfil` (aluno v2), com abas no endereco (`?aba=dados|acessos|seguranca`):

- `Dados`: nome, e-mail, telefone, aluno desde e ultimo acesso. Le so a linha do proprio usuario em `profiles` (com a sessao dele e RLS) e os dados da conta; o que nao existe aparece como `Não informado`;
- `Acessos`: cada produto com acesso, com data de inicio e fim (ou vitalicio); gratuito e previa do produtor aparecem rotulados; sem acessos, estado vazio com o caminho para o Suporte;
- `Segurança`: `Alterar senha` (leva a `/alterar-senha` e volta para o perfil) e `Sair da conta`.

Fica para depois: editar nome/telefone/foto (antes e preciso unificar as tres origens do nome: cadastro do aluno, perfil e conta), preferencias e dispositivos/sessoes.

## Suporte

Pagina `/suporte` (aluno v2, `src/lib/member-support.ts` + `src/components/member/pages/support-view.tsx`):

- canais de atendimento: o link de ajuda que a escola ja configura em Admin › Área de membros › Entrar (`mailto:` vira `E-mail`, `wa.me`/`api.whatsapp.com` vira `WhatsApp`, outro `https://` vira `Central de ajuda`) mais a lista fixa `MEMBER_SUPPORT_CHANNELS` (vazia por padrao). So entram links `https://` sem usuario/senha ou `mailto:` valido;
- sem canal cadastrado: `A escola ainda não cadastrou um canal de atendimento`; para o produtor aparece o caminho da configuracao;
- perguntas frequentes revisadas: acesso depois da compra, por que algumas aulas mostram `Liberação em` (inclui o prazo de garantia de 7 dias), senha, onde ficam os materiais, como o progresso e contado e acesso expirado;
- atalhos para `Minhas compras`, `Meus acessos` e `Alterar senha`.

Formulario (nome, e-mail, assunto, mensagem, categoria e anexos no futuro) fica para quando existir caixa de entrada no admin para responder e envio de e-mail. Ate la, nada de formulario que grava sem ninguem ler.

## Funcionalidades de fase 2

- Comunidade;
- Mural de membros;
- Conversas;
- Ranking;
- Certificados;
- Notificacoes;
- IA dentro da aula;
- recomendacoes personalizadas.

## Curso importado por playlist

- uma playlist do YouTube representa um curso;
- o CRM oferece `Criar curso com YouTube` como fluxo nativo, sem exigir scripts, SQL ou edicao manual de cada aula;
- o produtor pode organizar o curso automaticamente pelos titulos ou definir cada modulo pelo primeiro e ultimo video do intervalo;
- antes de importar, o assistente mostra todos os modulos e aulas e bloqueia intervalos vazios, sobrepostos ou com videos sem modulo;
- o card unico do curso abre diretamente a experiencia de aula com modulos e aulas na playlist lateral;
- o produtor pode optar por exibir cards de modulos antes das aulas;
- a capa vertical do curso e opcional; sem capa, o card mostra somente o nome sobre uma superficie neutra;
- a importacao entra como rascunho e nao aparece para alunos antes da revisao e publicacao administrativa.
