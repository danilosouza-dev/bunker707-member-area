# Design system Bunker707

Este documento define a base visual da area de membros Bunker707. A referencia principal e a experiencia Netflix: escura, cinematografica, focada em conteudo, com interface limpa e estados de hover claros. A plataforma nao deve virar uma copia literal de marca, mas deve manter consistencia de comportamento, hierarquia e acabamento.

## Principios

- Conteudo primeiro: imagens, capas, aulas e progresso devem ser mais importantes que molduras decorativas.
- Escuro premium: usar base escura constante, sem variacoes aleatorias de paleta por tela.
- Poucas fontes e pesos: usar uma familia tipografica principal e variar por tamanho/peso, nao por troca de fonte.
- Estados visiveis: todo botao interativo deve ter hover/foco proprio, sem depender de tooltip nativo do navegador.
- Bordas discretas: bordas normais devem ser suaves; hover pode reforcar contraste.
- UI previsivel: abrir modulo nao troca aula; trocar aula exige clique em aula.
- Sem excesso de cards: cards devem representar conteudo, modais ou ferramentas reais, nao envolver secoes inteiras.

## Tipografia

Familia padrao: `Inter`, carregada globalmente em `src/app/layout.tsx`.

Nao introduzir outra fonte sem decisao explicita. O padrao visual deve vir de hierarquia, peso e espacamento.

Escala recomendada:

- Hero/titulo grande: 40-64px, `font-black`, apenas em hero ou titulo editorial.
- Titulo de pagina/conteudo: 28-40px, `font-black`.
- Titulo de painel/lista: 13-16px, `font-semibold` ou `font-bold`.
- Texto de corpo: 14-16px, `font-normal` ou `font-medium`.
- Metadados/labels: 11-13px, `font-medium` ou `font-semibold`.
- Tooltips: 13px, `font-medium`, nunca pesado demais.

Regras:

- `letter-spacing` deve permanecer normal.
- Evitar textos longos em maiusculas; usar uppercase apenas para labels pequenos.
- Dentro de paineis compactos, evitar `font-black` quando `font-semibold` resolve.

## Cores

Tokens atuais:

```css
--background: #141414;
--foreground: #f7f7f4;
--muted: #a8a8a2;
--panel: #171717;
--panel-strong: #202020;
--border: rgba(255, 255, 255, 0.1);
--accent: #e50914;
--accent-warm: #ff7a1a;
```

Uso:

- Fundo principal: `#141414`.
- Paineis: `#171717`, `#181818`, `#202020`.
- Hover de painel: `#242424` ou branco com baixa opacidade.
- Texto principal: branco/quase branco.
- Texto secundario: zinc 300-500.
- Destaque Bunker/Netflix-like: `#e50914`.
- Sucesso/concluido: emerald 600/500.
- Avisos/bloqueios: amber 400/500.

Evitar:

- Paletas novas por secao.
- Gradientes coloridos decorativos.
- Roxo/azul dominante, bege dominante ou laranja/marrom dominante.

## Iconografia

Biblioteca padrao: `lucide-react`.

Motivos:

- Mantem o mesmo estilo visual de traco em toda a plataforma.
- Tem boa variedade de icones para acoes, navegacao, conteudo, aulas e estados.
- Usa SVG inline e imports por componente.
- E tree-shakable, entao apenas os icones importados entram no bundle final.
- Tem suporte bom a TypeScript e permite controlar tamanho, cor e espessura via props/classes.

Regras:

- Nao misturar `lucide-react` com outras bibliotecas de icones sem decisao explicita.
- Preferir icones Lucide existentes a SVGs manuais para botoes e controles comuns.
- Usar tamanho padrao de 16-20px para controles compactos e 20-24px para botoes circulares.
- Manter `strokeWidth` visual entre 2.2 e 2.8 em botoes de acao Netflix-like.
- Usar preenchimento (`fill-current`) apenas quando o padrao visual exigir, como play solido.
- Todo icone sem texto visivel precisa de `aria-label` no botao ou texto acessivel equivalente.

## Botoes

### Botao primario claro

Uso: assistir, concluir, acoes centrais.

- Fundo branco, texto preto.
- Raio: 6-8px.
- Peso: `font-extrabold`.
- Hover: cinza claro ou brilho leve.

### Botao concluido

Uso: aula concluida.

- Fundo emerald.
- Texto branco.
- Deve alternar para estado nao concluido quando clicado novamente.

### Botoes circulares Netflix-like

Uso: materiais, TV, minha lista, avaliar, voltar sobre video.

- Formato circular.
- Na pagina de aula, minha lista/salvar usa icone de bookmark/salvar, nao o sinal de `+`.
- Borda normal: 1px branco com baixa opacidade.
- Fundo normal: cinza/preto translucido.
- Hover: fundo cinza mais claro e borda branca mais forte.
- Tooltip proprio, nunca `title` nativo.

Tooltip:

- Caixa branca/cinza clara.
- Texto escuro.
- Fonte 13px `font-medium`.
- Seta triangular inferior.
- Deve ficar acima de tudo e nao ser cortado pelo player.

## Player e pagina de aula

- Breadcrumb fica acima do player.
- Player fica alinhado com o topo da playlist lateral.
- Botao de voltar fica sobreposto no canto superior esquerdo do player.
- A camada de video pode ter `overflow-hidden` para preservar cantos arredondados, mas a camada de controles deve permitir tooltip acima do player.
- Controles de aula anterior/proxima nao ficam no topo da pagina; futuramente podem existir dentro do player.
- Abaixo do player, nao colocar chips de duracao ou contagem antes do titulo; o titulo da aula deve alinhar visualmente com os botoes de acao.

## Playlist lateral da aula

Header:

- Deve mostrar a capa vertical do curso/produto no lado esquerdo.
- A capa deve ocupar a altura do bloco de titulo/progresso para funcionar como referencia visual real, nao como miniatura decorativa pequena.
- Nome do curso usa Inter, `font-semibold`, com ate tres linhas para preservar leitura e respiro.
- Progresso fica ancorado na parte inferior do bloco da capa vertical; o espaco entre titulo e progresso e aceitavel quando a capa exigir altura.
- Nao usar label redundante como `Lista de aulas` quando o contexto ja esta claro.

Comportamento:

- Abrir/fechar modulo nao troca aula em reproducao.
- Aula ativa muda somente quando o aluno clica em uma aula.
- A playlist tem scroll interno proprio.
- Cabecalho/progresso ficam fora da area rolavel.
- Ultimo modulo e ultima aula devem ser totalmente acessiveis.

## Reacoes da aula

Substituem escala de cinco estrelas.

Opcoes:

- `Nao gostei`: polegar para baixo, contorno vermelho quando selecionado.
- `Gostei`: polegar para cima, contorno verde quando selecionado.
- `Amei`: coracao, contorno vermelho de destaque quando selecionado.

Comportamento:

- Botao principal abre pilula escura com tres opcoes.
- Cada opcao tem tooltip branco individual.
- Depois da selecao, a pilula fecha para nao conflitar com outros tooltips.
- A reacao pode liberar materiais que exigem avaliacao.

## Comentarios da aula

- A lista de comentarios deve parecer conversa/thread, nao uma pilha de cards.
- Cada comentario usa avatar circular ou foto de perfil, nome, tempo relativo e texto em fluxo livre, com separadores discretos entre itens.
- Avatares usam cor solida ou foto, sem degrade decorativo; icones/emoji devem preencher bem o circulo, e o indicador de presenca fica na intersecao inferior direita do avatar, com borda na cor do fundo da pagina e sem brilho/esfumacado. Online usa ponto verde; offline usa ponto cinza com centro na cor do fundo.
- O selo `Professor` aparece ao lado do nome quando a resposta vier de professor/equipe.
- Respostas aparecem indentadas dentro do comentario principal, com recuo e divisor vertical discreto para deixar clara a hierarquia da conversa.
- Todo comentario e resposta deve ter acao `Responder`; ao clicar, o composer entra em modo resposta e preenche automaticamente `@nickname` da pessoa respondida.
- O composer em modo resposta deve mostrar uma faixa de contexto com a mencao ativa e opcao de cancelar antes do envio.
- Mencoes e respostas devem alimentar notificacoes futuras no sininho da plataforma para a pessoa mencionada ou dona do comentario respondido.
- Reacoes de comentario usam chips compactos com emoji/curtida e contador; o estado selecionado reforca a borda/acento sem dominar a leitura.
- O menu `Reagir` deve oferecer uma lista padrao ampla de emojis, como curtir, fogo, insight, coracao, aplausos, risada, surpresa, foguete, de olho e util.
- O menu de tres pontos deve oferecer denuncia de comentario para moderacao.
- Menus de reacao e denuncia devem fechar ao clicar fora deles.
- O composer de novo comentario deve ser diferente dos comentarios publicados: caixa propria de digitacao, textarea evidente e botao de envio alinhado dentro do bloco.

## Cards

- Cards de conteudo devem ser verticais na home.
- Fileiras de cards verticais da home devem usar gap de 12px entre cards.
- Hover pode ampliar e elevar o card, mantendo cantos arredondados. Na home, o card vertical deve ampliar por escala externa sem zoom interno adicional da imagem.
- Cards verticais expansivos da home devem crescer para dentro somente quando estiverem nas bordas visíveis do carrossel: o primeiro da esquerda preserva a borda esquerda e expande para a direita; o último da direita preserva a borda direita e expande para a esquerda. Os cards internos mantem escala central normal.
- `Continue assistindo` usa hover proprio de video: superficie estavel, zoom interno minimo na imagem igual aos cards de modulo do modal e play aparente no centro, sem a expansao externa grande dos cards verticais.
- Overlay do hover deve priorizar legibilidade.
- Cards bloqueados na home devem usar badge circular escuro/translucido no canto superior direito, com cadeado branco simples centralizado sobre a capa. O icone deve usar o `Lock` da Lucide, sem preenchimento (`fill`), para evitar efeito de massa branca.
- Evitar mostrar metadados demais no hover; detalhes completos ficam em modal ou pagina propria.
- Cards de cursos internos dentro de formacoes e cards de modulos dentro de cursos podem compartilhar o mesmo poster vertical.
- A diferenca atual e funcional: modulos mostram progresso no hover; cursos internos dentro de formacoes nao mostram barra de progresso nem botao `Acessar`.
- O CMS futuro pode permitir tags/selo por card para indicar `Curso`, `Modulo`, `Bonus`, `Projeto` ou outro texto configurado pelo produtor.

## Modal de detalhes

- O topo do modal deve usar uma capa/hero mais alta, com fade inferior escuro integrado ao fundo do painel.
- Apenas o titulo e os botoes de acao devem ficar sobrepostos a imagem, com os botoes imediatamente abaixo do titulo.
- Descricao, professor, progresso, tipo, duracao/aulas e demais textos informativos devem comecar depois da imagem.

## Imagens

- Usar imagens reais ou capas do conteudo quando disponiveis.
- Evitar imagem escura/blur quando o usuario precisa reconhecer o conteudo.
- Miniaturas de aulas e cursos devem manter aspect ratio estavel.

## Documentacao e evolucao

Quando uma decisao visual mudar, atualizar este documento e os documentos de UX relacionados.

Se forem coletados novos prints da Netflix, registrar apenas o comportamento e os principios visuais relevantes. Nao copiar textos proprietarios, assets, marcas ou uma tela literal.
