# Referencia Analisada: Astron Academy

## Objetivo da analise

A plataforma Astron Academy foi usada como referencia de fluxo da area do aluno. A Bunker707 pode aproveitar a logica de navegacao, estrutura de telas e padroes funcionais, mas deve ter identidade propria e UX adaptada para escola de IA.

Nao copiar textos, marcas, imagens, assets ou implementacao proprietaria.

Para o inventario detalhado da coleta, use tambem:

- `docs/11-inventario-coleta-astron.md`

## Telas navegadas

- Dashboard/home do aluno;
- Meu Conteudo;
- Pagina de aula;
- Busca;
- Meu Perfil;
- Meus Planos;
- Alterar Senha;
- Comunidades;
- Categoria de comunidade;
- Mural de membros;
- Conversas;
- Ranking;
- Suporte.

## Padroes observados

### App shell

- Tema escuro.
- Header fixo.
- Sidebar fixa no desktop.
- Busca global no topo.
- Perfil do aluno no canto superior direito.
- Links auxiliares no rodape da sidebar.

Para Bunker707: usar menu hamburguer abrindo sidebar, como decisao do produto.

### Home

- Banner horizontal no topo.
- Perfil/progresso na sidebar.
- Bloco "Continuar progresso".
- Categorias de cursos em secoes.
- Carrosseis com setas.
- Cards de curso com capas visuais.

Para Bunker707:

- hero mais forte;
- primeira linha de cards sobrepondo a hero;
- cards verticais;
- secoes mais proximas de streaming.

### Meu Conteudo observado / Minhas compras na Bunker707

- Grid de cursos liberados.
- Cards com capa, nota, progresso e quantidade de aulas.
- Paginacao.

Para Bunker707:

- chamar a tela de `Minhas compras`;
- manter grid de produtos liberados por entitlement ativo;
- adicionar filtros;
- mostrar status de acesso e proximo passo.

### Pagina da aula

Elementos observados:

- player grande;
- playlist lateral do curso;
- progresso total do curso;
- botao "Concluir e avancar";
- avaliacao da aula;
- modo TV;
- breadcrumb;
- tabs de descricao e comentarios;
- campo de comentario/resposta.

Para Bunker707:

- essa e a tela principal a ser reaproveitada como padrao;
- incluir materiais;
- reservar area para IA da aula;
- registrar eventos de play, progresso, pausa, conclusao e comentario.

### Comunidade

Tres niveis:

- lista de comunidades;
- categorias;
- topicos.

Para Bunker707:

- planejar para fase 2;
- deixar item de navegacao opcional;
- nao bloquear MVP.

### Mural de membros

- busca por nome;
- grid de membros;
- botao para ver perfil publico.

Para Bunker707:

- fase 2 ou fase 3;
- util para networking, mas nao essencial para primeiro lancamento.

### Conversas

- layout de chat;
- lista de conversas;
- usuarios online;
- estado vazio.

Para Bunker707:

- fase futura;
- avaliar se usar chat proprio ou integrar uma solucao externa.

### Ranking

- gamificacao por pontos;
- filtro por mes;
- regras de pontuacao;
- feed de atividade.

Para Bunker707:

- boa funcionalidade para engajamento;
- nao entra no MVP essencial;
- pode usar eventos de conteudo concluido como primeira fonte de pontos.

### Suporte

- formulario de contato;
- dados do produtor;
- texto de responsabilidade.

Para Bunker707:

- criar suporte simples no MVP;
- depois evoluir para tickets, categorias e automacoes.

## Funcionalidades candidatas ao MVP

- Home;
- Minhas compras;
- Pagina da aula;
- Playlist lateral;
- Progresso;
- Busca;
- Perfil;
- Meus acessos;
- Suporte.

## Funcionalidades para depois

- Comunidade;
- Mural de membros;
- Conversas;
- Ranking;
- Notificacoes avancadas;
- Certificados;
- IA da aula.
