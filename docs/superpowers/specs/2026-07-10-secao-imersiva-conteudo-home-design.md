# Editor funcional de secoes e secao imersiva da Home

## Objetivo

Transformar `Personalizacao > Vitrine` em um editor funcional da Home do aluno. O produtor deve conseguir criar, selecionar, configurar, ordenar, duplicar, ocultar e excluir secoes, visualizar o resultado e publicar as alteracoes.

O mesmo trabalho adiciona uma segunda apresentacao para secoes ligadas a um curso ou formacao: `Compacta`, preservando o formato atual, e `Imersiva`, com banner panoramico e cards internos integrados.

## Diagnostico do estado atual

A interface atual comunica funcoes que ainda nao existem:

- `Criar`, menu de opcoes e varios botoes de edicao nao possuem operacoes reais;
- a lista de secoes e inicializada como estado somente de leitura;
- nao existem comandos para reordenar, duplicar, ocultar ou excluir;
- a Home e montada por uma lista fixa no servidor;
- nao existe API nem persistencia para `home_sections`;
- o preview ocupa quase toda a area, enquanto a secao selecionada nao possui um inspetor de propriedades.

A correcao deve tratar a causa estrutural. Nao basta adicionar drag-and-drop sobre a lista estatica.

## Decisoes aprovadas

### Estrutura do editor

Usar o modelo de tres paineis escolhido pelo usuario:

1. **Estrutura à esquerda:** lista ordenavel do banner e das secoes.
2. **Preview ao centro:** representacao fiel da Home publicada.
3. **Inspetor à direita:** propriedades completas do item selecionado.

O preview nao deve ser coberto pelo inspetor. Em larguras menores, o inspetor pode virar drawer, mas a lista de estrutura continua acessivel.

### Fontes de conteudo

Oferecer dois modos:

- `Automatico`: a secao resolve seus cards a partir de uma fonte dinamica;
- `Selecao manual`: o produtor escolhe e ordena os cards individualmente.

### Layout estrutural

Secoes ligadas a um unico conteudo oferecem:

- `Compacta`: capa pequena, titulo, CTA e cards internos logo abaixo;
- `Imersiva`: banner panoramico, bloco editorial e cards internos integrados.

## Arquitetura da tela

### Barra superior

A barra superior mostra:

- voltar para a Personalizacao;
- nome `Vitrine`;
- indicador `Alteracoes nao publicadas` quando o rascunho divergir da versao publicada;
- `Descartar`, desabilitado quando nao houver alteracoes;
- `Publicar`, desabilitado quando nao houver alteracoes ou houver erro de validacao.

`Publicar` envia a configuracao completa para o servidor. `Descartar` restaura a ultima versao publicada. Ao tentar sair com alteracoes, a interface pede confirmacao.

### Painel Estrutura

O banner aparece como item fixo no topo. Ele nao pode ser removido nem reordenado entre as secoes.

Cada secao mostra:

- alca de arraste;
- titulo;
- quantidade de itens resolvidos;
- status ativo/oculto;
- menu de acoes.

O menu oferece:

- duplicar;
- ocultar/ativar;
- mover para cima;
- mover para baixo;
- excluir.

O drag-and-drop altera a ordem imediatamente no rascunho e mostra placeholder de destino. `Mover para cima/baixo` oferece a mesma funcao para teclado e tecnologias assistivas.

O botao `Criar secao` abre o fluxo de criacao. Um estado vazio explica como adicionar a primeira secao.

### Preview

O preview usa os mesmos componentes e a mesma resolucao de dados da Home do aluno. Clicar numa secao do preview seleciona o mesmo item no painel Estrutura e abre suas propriedades no inspetor.

A secao selecionada recebe um contorno discreto somente no modo editor. Controles administrativos nunca aparecem na Home publicada.

O preview pode ser alternado entre desktop e mobile. Interacoes que atrapalhariam a edicao, como navegar para outra pagina, ficam desabilitadas no preview.

### Inspetor

O inspetor da secao possui:

- status: ativa ou oculta;
- titulo;
- subtitulo opcional;
- tipo de secao;
- modo de conteudo: automatico ou manual;
- fonte automatica ou seletor de cards;
- layout disponivel para aquele tipo;
- visibilidade;
- resumo de validacao;
- acoes `Duplicar` e `Excluir`.

Alteracoes do inspetor atualizam o rascunho e o preview imediatamente. O botao `Publicar` continua sendo a confirmacao global.

## Criacao de secao

`Criar secao` abre um dialog com tres grupos claros.

### 1. Secoes automaticas

- `Continue assistindo`: aulas iniciadas pelo aluno, em cards horizontais;
- `Minhas compras`: produtos com entitlement ativo;
- `Produtos à venda`: produtos vendaveis aos quais o aluno ainda nao tem acesso;
- `Em breve`: produtos e turmas futuras.

Cada fonte automatica pode existir apenas uma vez por Home na primeira versao, evitando secoes duplicadas com a mesma funcao.

### 2. Secao de conteudo em destaque

O produtor escolhe um curso, formacao, bootcamp, mentoria, webinario ou produto com estrutura interna.

- formacao mostra somente seus cursos internos;
- curso, bootcamp, mentoria, webinario ou produto mostra somente seus modulos;
- o produtor escolhe `Compacta` ou `Imersiva`;
- a hierarquia interna nao pode ser misturada manualmente.

### 3. Selecao manual

O produtor informa titulo e subtitulo, pesquisa conteudos publicaveis, seleciona cards e define sua ordem. Cursos internos de formacao nao podem ser escolhidos como produtos independentes de vitrine.

O dialog cria a secao no rascunho e a seleciona no editor. A secao so chega à Home do aluno depois de `Publicar`.

## Tipos, fontes e layouts

### Tipos de secao

- `continue_watching`;
- `content_carousel`;
- `content_structure`.

### Fontes automaticas

- `recent_lessons`;
- `entitlement_products`;
- `sellable_products`;
- `upcoming_products`.

### Fonte manual

- `manual`, acompanhada por uma lista ordenada de IDs de conteudo.

### Layouts

- `continue`: exclusivo para `continue_watching`;
- `vertical`: padrao de `content_carousel`;
- `compact`: opcao de `content_structure`;
- `immersive`: opcao de `content_structure`.

O editor mostra apenas combinacoes validas, evitando configuracoes contraditorias.

## Visibilidade e acesso

Cada secao aceita:

- `students`: alunos com acesso ativo;
- `non_students`: usuarios sem compra ativa para os itens relevantes;
- `all`: todos os usuarios autenticados.

A visibilidade da secao nao concede acesso. Entitlements e regras de liberacao continuam sendo aplicados ao resolver os cards.

Na fonte `sellable_products`, a resolucao remove todo produto que ja esteja acessivel ao aluno. Essa regra e obrigatoria e nao pode ser desativada pela curadoria da Home.

Uma secao ativa que resulte em zero itens para determinado aluno nao aparece para ele. No editor, ela continua visivel com um aviso de estado vazio.

## Layout compacto

Preservar o formato existente: capa vertical reduzida, rotulo, titulo e CTA no cabecalho, com o carrossel de cards internos logo abaixo.

## Layout imersivo

No desktop, usar um painel panoramico de largura total e altura menor que a hero principal:

- imagem de fundo do conteudo, priorizando a hero configurada e usando a capa como fallback;
- degrade escuro lateral e inferior;
- rotulo, titulo, descricao curta opcional e CTA à esquerda;
- carrossel dos cards internos à direita;
- controles somente quando houver overflow real.

No mobile, empilhar informacoes, CTA e carrossel. O overlay fica mais forte e o texto nao se sobrepoe aos cards.

Recomenda-se no maximo uma ou duas secoes imersivas por Home, sem impor bloqueio tecnico.

## Interacoes dos cards

- CTA do conteudo com acesso abre sua pagina;
- sem acesso, o CTA preserva a configuracao de modal ou link externo;
- curso interno abre seu destino configurado;
- modulo liberado abre aula/playlist;
- item bloqueado preserva a explicacao de acesso existente;
- cards mantem foco visivel, rotulos acessiveis, prefetch e comportamento edge-aware existentes.

## Persistencia

Materializar `home_sections` no Supabase conforme o modelo de dados do projeto.

Campos principais:

- `id`;
- `title`;
- `subtitle`;
- `order_index`;
- `section_type`;
- `content_source`;
- `source_content_id`;
- `layout`;
- `visibility`;
- `is_active`;
- timestamps.

Materializar `home_section_items` para a selecao manual:

- `section_id`;
- `content_id`;
- `order_index`.

O servidor recebe e valida a configuracao completa no momento de publicar. A versao publicada e a unica consumida pela Home do aluno. O rascunho desta primeira versao vive no estado do editor ate publicar ou descartar; nao existe salvamento de rascunho entre sessoes.

Registros existentes sem `home_sections` recebem uma configuracao inicial equivalente às fileiras atuais. Isso preserva `Continue assistindo`, `Minhas compras`, secoes de curso ja habilitadas, `Produtos à venda` e `Em breve`.

`ContentPageSettings.homeModuleSection` continua sendo lido durante a compatibilidade inicial, mas novas secoes sao controladas por `home_sections`. Depois da migracao dos dados, o editor deixa de depender desse campo para ordenar a Home.

## API administrativa

Criar uma rota administrativa dedicada à configuracao da Home:

- leitura da versao publicada e dos itens resolvidos para preview;
- publicacao da lista completa com validacao server-side;
- autorizacao obrigatoria de admin;
- rejeicao de IDs inexistentes, combinacoes invalidas, ordens duplicadas e cursos internos usados indevidamente como produtos manuais.

A resposta de publicacao devolve a configuracao canonica e os `homeRows` resolvidos para manter editor e Home sincronizados.

## Erros e feedback

- mostrar erro no campo correspondente quando uma configuracao for invalida;
- mostrar toast de sucesso apenas depois da persistencia confirmada;
- manter o rascunho na tela se a publicacao falhar;
- pedir confirmacao antes de excluir uma secao;
- impedir exclusao acidental de todas as secoes sem mostrar um estado vazio orientativo;
- exibir skeleton durante a primeira carga e estado de retry em falha de leitura.

## Verificacao

### Testes de dados e API

- criacao e publicacao dos tres tipos de secao;
- fontes automaticas e selecao manual;
- ordenacao persistida;
- duplicacao, ocultacao e exclusao;
- validacao de combinacoes de tipo, fonte e layout;
- migracao da configuracao fixa atual;
- filtragem por visibilidade e entitlement;
- formacao com cursos internos e curso com modulos.

### Testes do editor

- drag-and-drop e botoes mover;
- sincronizacao entre lista, preview e inspetor;
- estado sujo, descartar e publicar;
- aviso ao sair com alteracoes;
- dialog de criacao;
- seletor manual e ordenacao dos cards;
- estados vazio, carregando e erro.

### Validacao visual

- editor em desktop amplo, notebook e tablet;
- preview desktop e mobile;
- layouts compacto e imersivo;
- contraste, foco, recorte de imagem e ausencia de cortes no hover;
- comparacao da Home publicada com o preview.

Executar `npm run verify` antes da entrega e validar o fluxo real no navegador.

## Fora de escopo

- salvar rascunhos entre sessoes;
- agendar publicacao;
- historico de versoes e rollback;
- segmentacao por turma ou tags alem das tres visibilidades iniciais;
- curadoria manual dos cursos/modulos internos de uma secao estrutural;
- video de fundo na secao imersiva;
- novas regras de entitlement, compra ou liberacao.
