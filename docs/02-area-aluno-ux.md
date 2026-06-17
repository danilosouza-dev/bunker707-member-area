# Area do Aluno e UX

A base visual detalhada da plataforma esta em [`docs/12-design-system-bunker707.md`](12-design-system-bunker707.md). Este documento de UX deve seguir os tokens, componentes, estados e regras de tipografia definidos no design system.

## App shell

Todas as telas autenticadas devem compartilhar uma estrutura consistente:

- header fixo;
- menu hamburguer no inicio do header;
- logo Bunker707 clicavel, levando para a home;
- busca global;
- notificacoes;
- avatar/perfil;
- sidebar aberta pelo menu hamburguer.

Para usuarios internos com papel administrativo, a area de membros deve manter a experiencia de aluno como produto final, mas expor um atalho claro para o CRM/backoffice. O CRM e a area de membros sao experiencias separadas: a home da area do aluno e `/`, enquanto a home do CRM e `/admin`.

## Login

A tela de login deve ser uma experiencia fechada de area de membros, nao uma vitrine publica nem checkout.

O produtor podera escolher futuramente um modelo de login no CMS. A configuracao deve ser persistida no backend quando a tela de login entrar no escopo administrativo.

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

## Header

Elementos recomendados:

- menu hamburguer;
- logo Bunker707 clicavel, levando para a home;
- busca global em icone expansivel, alinhada aos icones da direita;
- icone de notificacoes;
- avatar do aluno com menu de perfil.

Na home, o header deve ficar praticamente transparente sobre a hero, com apenas um degrade sutil de cima para baixo para manter menu e icones legiveis. Apos o aluno fazer scroll, o header deve assumir fundo preto/solido, como no comportamento da Netflix.

A transicao do header deve ser suave, sem borda inferior e sem piscadas. O comportamento recomendado e usar camadas sobrepostas: uma camada de degrade no topo e uma camada preta que entra por opacidade conforme o scroll aumenta, revelando o preto de cima para baixo.

Os controles internos do header, como botoes, busca e perfil, nao devem trocar de estilo abruptamente durante o scroll. Apenas o fundo do header deve transicionar.

A busca deve iniciar como um icone no grupo direito do header. Ao clicar, ela expande suavemente para permitir digitacao, recebe foco automatico e pode ser recolhida pelo proprio icone ou pela tecla `Esc`.

Nas demais telas, o header pode iniciar solido.

## Sidebar

Aberta pelo menu hamburguer. No desktop, pode deslizar por cima do conteudo com backdrop. No mobile, ocupa a maior parte da tela.

A abertura e o fechamento devem ser suaves, com backdrop em fade e painel deslizando lateralmente.

O sidebar nao deve mostrar formacao atual fixa, curso atual fixo ou barra generica de progresso do aluno. Progresso deve ser contextual por formacao, curso, bootcamp, modulo ou aula, porque um percentual unico da escola inteira fica pouco claro quando o aluno tem varios produtos, desafios, quizzes e projetos.

Itens iniciais:

- Home;
- Minha jornada;
- Minhas compras;
- Favoritos;
- Continue assistindo;
- Materiais;
- Suporte;
- Perfil;
- Sair.

Quando o usuario autenticado tambem for admin/produtor, a sidebar pode exibir um item administrativo separado para ir ao CRM/backoffice. Esse item nao deve aparecer para alunos comuns.

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

Quando o aluno tem acesso, o botao da capa reduzida do curso deve ser `Acessar`, com hover premium no estilo dos demais cards, e leva para a pagina normal do curso, com os modulos listados. Quando o aluno nao tem acesso, o botao deve ser `Comprar`. O produtor configura no CMS se esse botao abre o modal de detalhes ou o link externo de compra; quando usar link externo, o CMS tambem define se abre na mesma aba ou em nova aba.

Clicar diretamente em um card de modulo leva para a pagina de aula/playlist daquele modulo, com a sidebar de modulos à direita, quando o aluno tem acesso. O card de modulo dessa secao nao exibe botao proprio; o hover mostra titulo, metadado curto e progresso sobre o overlay. Quando o aluno nao tem acesso ao curso, clicar em qualquer modulo abre o modal de detalhes do curso por padrao.

Na home, os cards dos modulos dessa secao devem ter tamanho intermediario: menores que os cards principais de cursos, formacoes e bootcamps para nao confundir hierarquia, mas maiores que os cards internos da pagina do curso. O tamanho menor e a variacao visual de cards de modulos ficam reservados para a pagina propria do curso.

Essa secao de modulos nao deve virar uma explicacao longa sobre o que sao modulos. A propria capa, o rotulo pequeno, o titulo e os nomes cadastrados pelo produtor comunicam o conteudo. Modulos bloqueados por compra, entitlement ou regra de entrega devem manter overlay de bloqueio e levar o aluno ao modal de detalhes quando clicados.

`Minhas compras` deve agrupar todos os produtos com entitlement ativo do aluno, independentemente do tipo: formacoes, bootcamps e cursos avulsos. Evitar separar cedo demais em `Minhas formacoes` e `Meus cursos avulsos`, porque isso deixa a home mais fragmentada e menos natural para o aluno.

Cada fileira configuravel deve poder definir uma regra de visibilidade:

- apenas alunos/compradores;
- apenas visitantes ou pessoas sem compra ativa;
- todos.

A fileira `Produtos a venda`/`Vitrine` e configuravel no dashboard e pode misturar produtos comprados e nao comprados, de acordo com a estrategia da escola. Produtos sem entitlement aparecem com cadeado.

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

- tamanho exibido do card vertical no desktop: cerca de 300 x 485.4;
- em telas desktop muito largas, pode crescer ate cerca de 320 x 517.8 sem dominar a fileira;
- proporcao do card: proxima da regra aurea, com largura:altura de 1:1.618;
- arquivo de capa enviado pelo admin/professor: preferencialmente 1000 x 1618 px, preservando margem de seguranca nas laterais; capas antigas em 720 x 1040 px ainda podem funcionar com enquadramento central temporario;
- imagem/capa deve funcionar como poster premium: arte forte, titulo legivel e poucos elementos fixos;
- a foto do professor pode aparecer na arte quando fizer sentido para o curso, mas nao deve ser obrigatoria em todos os cards;
- dados como nome do professor, Instagram, nivel, quantidade de aulas e promessa curta devem existir como metadata do conteudo, para uso no modal e na pagina propria do curso/formacao;
- nenhuma tag, borda de tipo, botao ou informacao fixa sobre a capa;
- a capa deve aparecer limpa no estado normal;
- cards verticais podem exibir a logo horizontal completa da Bunker707 no canto superior esquerdo apenas no hover, em tamanho discreto, preservando a capa como elemento principal;
- no hover, o card vertical da home deve saltar para frente com escala maior que o estado inicial, leve elevacao para cima, sombra profunda, `z-index` acima dos vizinhos e transicao suave, aproximando o comportamento visual da Netflix sem parecer brusco;
- nos cards verticais expansivos da home, o hover deve respeitar a borda visivel do carrossel: o card encostado à esquerda cresce para a direita, e o card encostado à direita cresce para a esquerda, sem invadir o alinhamento lateral da secao; os cards internos da fileira mantem a escala central normal;
- o arredondamento deve permanecer em todos os cantos durante o hover;
- o hover nao deve revelar filetes claros, bordas brancas acidentais ou linhas de subpixel na parte inferior dos cards;
- as informacoes devem aparecer dentro do proprio card, sobre um degrade escuro de baixo para cima, sem criar painel externo abaixo da capa;
- o degrade do hover deve ser bem forte na area inferior, onde ficam texto e botoes, priorizando legibilidade sobre capas com muito contraste ou texto na arte; o topo deve continuar suave para preservar a arte;
- o hover deve mostrar apenas titulo, descricao curta, acao principal, botao para salvar/favoritar quando o aluno tiver acesso e um botao de seta para baixo para abrir o modal de detalhes;
- status de acesso, duracao, quantidade de aulas, tipo de produto e demais metadados nao devem aparecer no hover do card vertical da home; essas informacoes ficam no modal e/ou na pagina propria do conteudo;
- qualquer elemento que tenha hover interativo deve usar cursor de mao/pointer;
- professor, foto do professor, Instagram e demais informacoes complementares nao devem aparecer no hover dos cards verticais; devem ficar no modal ou na pagina propria do curso/formacao;
- clicar no card ou na acao principal `Acessar` deve levar para a pagina propria do curso, formacao ou bootcamp;
- clicar na seta para baixo deve abrir o modal de detalhes sem navegar.
- clicar no botao de salvar/favoritar deve adicionar/remover o item da lista de favoritos do aluno sem navegar.
- em mobile/tablet, nao depender de hover para a acao principal; o toque no card deve abrir o modal de detalhes do conteudo;
- em mobile/tablet real, nao depender de hover ou pressao prolongada para revelar acoes; se o navegador simular hover em algum contexto, o card deve permanecer estavel e esse estado nao pode bloquear o toque principal.

## Carrosseis

As setas laterais de cada fileira devem aparecer somente quando houver overflow horizontal real e mover os cards com scroll horizontal suave, no estilo streaming. O movimento deve ser suficiente para revelar novos cards sem saltos bruscos.

Quando os cards cabem dentro da largura disponivel da fileira, nao exibir setas. Quando houver overflow, a seta da direcao sem mais conteudo para navegar deve ficar visualmente desativada.

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

No estado atual, o topo do modal usa imagem/capa. Futuramente, o CMS deve permitir trocar essa imagem por video configurado para o modal, mantendo fallback de imagem quando o video nao estiver configurado ou nao puder reproduzir.

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
- a `Vitrine` pode conter tanto produtos comprados quanto nao comprados;
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
Tabs: Descricao, Comentarios, Duvidas/IA futura
Playlist lateral com modulos e aulas
```

Desktop:

- breadcrumb acima do player;
- player grande a esquerda;
- botao de voltar para a pagina do conteudo sobreposto no canto superior esquerdo do player, aparecendo no hover/foco e usando o mesmo hover circular escuro dos botoes secundarios; seu tooltip deve ficar acima do player e nao pode ser cortado pela area do video;
- overlays do player, como voltar, reproduzir e mostrar playlist, devem ficar abaixo do header global quando houver sobreposicao durante o scroll;
- nao exibir selo/tag do provedor de video sobre o player, como `YouTube`, `Vimeo` ou similares; essa informacao nao ajuda o aluno no consumo da aula;
- controles de aula anterior/proxima nao ficam no topo da pagina; essa navegacao acontece pela playlist lateral e futuramente pelos controles internos do player;
- botao principal abaixo do video marca/desmarca a aula como concluida, muda para estado verde `Concluida` e deve preservar esse estado quando o aluno voltar para a aula;
- botoes secundarios como materiais, TV, salvar e avaliar devem ser circulares, iconograficos, com borda discreta no estado normal e feedback visual proprio no hover/foco, sem depender de tooltip nativo do navegador;
- tooltips desses botoes devem usar caixa branca com seta, fonte media/regular e sem peso excessivo;
- avaliacao da aula deve seguir o padrao de reacao da Netflix: um botao de curtida abre tres opcoes (`Nao gostei`, `Gostei`, `Amei`) em uma pilula escura, com tooltip branco individual; opcoes selecionadas usam apenas contorno colorido, incluindo o coracao de `Amei`;
- depois da selecao da reacao, a pilula deve fechar para nao conflitar com outros tooltips;
- depois que o aluno assistir pelo menos 30% uma vez, o botao de avaliacao permanece disponivel nessa aula mesmo se ele arrastar o video de volta para o inicio; o percentual atual continua podendo regredir para alimentar `Continue assistindo` e progresso do modulo.
- `Continue assistindo` deve priorizar imagem do ponto de retomada quando o provider/adapter fornecer um frame salvo; quando isso nao existir, usar thumbnail oficial do video; somente depois usar thumbnail cadastrada da aula ou imagem do modulo como fallback;
- playlist lateral fixa a direita, alinhada ao topo do player e nao ao breadcrumb;
- playlist lateral deve ter scroll interno proprio, com cabecalho fixo e area de aulas rolavel, garantindo que o ultimo modulo e a ultima aula fiquem totalmente acessiveis;
- abrir/fechar um modulo na playlist nao deve trocar a aula em reproducao; a aula ativa muda somente quando o aluno clica em uma aula;
- tabs abaixo do player.
- o estado `Assistindo...` na thumbnail da playlist deve aparecer somente depois que o aluno clicar no player/botao de reproduzir naquela sessao, nao apenas porque a aula esta selecionada.
- o clique/play do player deve registrar `lesson_started`/progresso inicial e permitir que a aula apareca em `Continue assistindo`.
- a plataforma deve salvar segundos e percentual assistidos por aula, independentemente do provedor de video. HTML5/player proprio envia tempo real por eventos nativos; YouTube usa a IFrame API para ler `currentTime`, `duration`, pausa e conclusao; Vimeo, Bunny, Mux e embeds externos devem passar por adaptadores equivalentes ou, enquanto a API especifica nao estiver integrada, por uma ponte de inicio + temporizador de sessao.
- ao retornar para uma aula com progresso salvo, o player deve posicionar no ponto salvo quando o provedor permitir `seek`/parametro de inicio; YouTube deve usar `start` no embed e `seekTo` no adapter, mas sem autoplay. O aluno precisa dar play explicitamente. No YouTube, antes do clique de play, a UI deve mostrar a thumbnail oficial do video com a barra de progresso salva, evitando a tela preta que o embed pode renderizar antes da reproducao. Providers que renderizem frame pausado de forma confiavel podem usar esse frame no futuro.
- comentarios da aula devem usar layout de thread leve, sem transformar cada comentario em card; avatar/foto, nome, tempo relativo, selo `Professor` quando aplicavel, reacoes por emoji/curtida e menu de denuncia ficam no proprio item;
- respostas a um comentario devem aparecer indentadas dentro do comentario principal; respostas de professor mantem selo `Professor` no item indentado;
- cada comentario e resposta deve ter acao `Responder`; ao clicar, o composer deve entrar em modo resposta e preencher automaticamente a mencao `@nickname` da pessoa respondida;
- mencoes em comentarios/respostas devem gerar notificacao futura no sininho da plataforma para a pessoa mencionada ou dona do comentario respondido;
- avatares dos comentarios usam cor solida ou foto do perfil, sem degrade; o indicador de presenca fica na intersecao inferior direita do circulo, com borda na cor do fundo da pagina e sem brilho/esfumacado; online usa ponto verde, offline usa ponto cinza com centro na cor do fundo;
- a lista padrao de reacoes de comentario deve ter mais opcoes que apenas curtir, por exemplo curtir, fogo, insight, coracao, aplausos, risada, surpresa, foguete, de olho e util;
- menus de reacao e denuncia devem fechar quando o aluno clicar fora do menu;
- o campo de novo comentario deve ser visualmente diferente da thread, usando uma caixa clara de digitacao com textarea e botao de envio alinhado dentro do mesmo bloco.

Mobile:

- player no topo;
- playlist vira accordion ou drawer;
- materiais e comentarios abaixo.

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

Abas recomendadas:

- Meu perfil;
- Meus acessos;
- Alterar senha;
- Preferencias;
- Dispositivos/sessoes, fase futura.

## Suporte

Formulario inicial:

- nome;
- email;
- assunto;
- mensagem;
- categoria opcional;
- anexos em fase futura.

Para o MVP, suporte pode enviar email ou registrar ticket simples no banco.

## Funcionalidades de fase 2

- Comunidade;
- Mural de membros;
- Conversas;
- Ranking;
- Certificados;
- Notificacoes;
- IA dentro da aula;
- recomendacoes personalizadas.
