# Secao imersiva de conteudo na Home

## Objetivo

Permitir que o produtor escolha como um curso, formacao ou outro conteudo com estrutura interna aparece na Home do aluno. O formato atual continua disponivel como `Compacto`; o novo formato `Imersivo` usa um banner panoramico com informacoes do conteudo e cards internos integrados ao mesmo bloco.

O novo layout deve destacar um unico conteudo por secao. Ele nao substitui fileiras genericas como `Minhas compras`, `Produtos a venda` ou `Em breve`.

## Alternativas consideradas

1. Manter apenas o formato compacto. E mais simples, mas nao atende ao pedido de uma apresentacao editorial e visualmente marcante.
2. Criar uma secao imersiva independente, com curadoria manual de cards. Oferece liberdade, mas duplica configuracoes e permite misturar cards sem uma hierarquia clara para o aluno.
3. Usar os mesmos dados da secao estrutural e permitir escolher seu layout. Esta e a decisao adotada: preserva o comportamento existente e adiciona somente uma variacao de apresentacao.

## Configuracao no CMS

A configuracao da pagina do conteudo passa a aceitar uma secao estrutural na Home com:

- `enabled`: mostra ou oculta a secao;
- `layout`: `compact` ou `immersive`;
- o valor padrao e `compact`, inclusive para registros existentes sem `layout` salvo.

O controle aparece para formacoes e para conteudos com modulos. Ao ativar a secao, o produtor escolhe entre dois cards de opcao com nome e descricao curta: `Compacta` e `Imersiva`.

## Hierarquia dos cards

- Formacao: os cards representam somente os cursos internos daquela formacao.
- Curso, bootcamp, mentoria, webinario ou produto com aulas: os cards representam somente seus modulos.
- A secao nao permite uma mistura livre de produtos, cursos e modulos.
- Itens indisponiveis preservam as regras atuais de entitlement, liberacao e acao de compra/detalhes.

## Layout compacto

O formato atual permanece inalterado: capa vertical reduzida, rotulo, titulo e CTA no cabecalho da secao, com o carrossel de cards logo abaixo.

## Layout imersivo

No desktop, a secao e um painel panoramico de largura total e altura controlada:

- imagem de fundo do conteudo, priorizando a hero configurada e usando a capa como fallback;
- degradê escuro lateral e inferior para manter contraste;
- bloco editorial à esquerda com rotulo, titulo, descricao curta opcional e CTA;
- carrossel dos cards internos ocupando a metade direita e podendo avancar visualmente sobre o fundo;
- cantos discretamente arredondados e acabamento coerente com o tema escuro da Bunker707;
- controles do carrossel somente quando houver overflow real.

O bloco deve ser visualmente forte, mas menor que a hero principal da Home. A Home pode ter varias secoes configuradas, embora a recomendacao editorial seja usar no maximo uma ou duas secoes imersivas por pagina.

No mobile, o painel vira uma composicao vertical: informacoes e CTA no topo, carrossel abaixo, sem texto sobreposto aos cards. A imagem de fundo permanece como ambientacao e recebe overlay mais forte.

## Interacoes

- O CTA abre a pagina do conteudo quando houver acesso.
- Sem acesso, o CTA preserva o modo configurado: modal de detalhes ou link externo de compra.
- Clicar em um curso interno abre seu destino configurado.
- Clicar em um modulo abre a pagina de aula/playlist quando liberado; quando bloqueado, usa a explicacao existente.
- Os cards mantem foco visivel, navegacao por teclado e rotulos acessiveis.
- O carrossel reutiliza paginacao, setas, scroll suave e tratamento de bordas existentes.

## Dados e compatibilidade

`ContentPageSettings.homeModuleSection` continua sendo a configuracao persistida para evitar migracao destrutiva, mas passa a aceitar `layout`. A leitura sem esse campo usa `compact`.

A linha entregue à Home passa a informar:

- o conteudo pai em `course`/conteudo destacado;
- os cards internos apropriados;
- o layout escolhido;
- a variante estrutural da secao.

Formacoes tambem passam a poder gerar essa linha, usando seus cursos internos em vez de modulos.

## Estados de excecao

- Sem cards internos publicados: a secao nao aparece.
- Sem hero configurada: usar a capa do conteudo como fundo, ampliada com overlay suficiente.
- Sem descricao: manter somente rotulo, titulo e CTA, sem reservar espaco vazio.
- Imagem indisponivel: manter fundo escuro e conteudo textual utilizavel.
- Um unico card: esconder setas e indicador de paginas.

## Verificacao

- Testes de dados para layout padrao `compact`, layout `immersive` e formacao com cursos internos.
- Testes do formulario administrativo e persistencia do campo `layout`.
- Testes de renderizacao para estados com acesso, sem acesso, sem descricao e sem overflow.
- Validacao visual em desktop e mobile, incluindo contraste, recorte da imagem, carrossel e ausencia de cortes no hover.
- Execucao de `npm run verify` antes da entrega.

## Fora de escopo

- Curadoria livre de cards dentro da secao.
- Mais de uma imagem de fundo por secao.
- Video de fundo na Home nesta primeira versao.
- Novas regras de entitlement, compra ou liberacao.
