# 26. Comunicação: design do pop-up (vídeo, degradê, blocos, fontes e botões)

Data: 22/10/2026. Pedido do produtor, depois da v3b-1 (`docs/25`): montar o visual do pop-up como num editor, a partir de uma referência de mercado (um pop-up escuro com um vídeo curto em cima que some num degradê, um selo em pílula por cima do degradê, um título em caixa alta de duas linhas com cores diferentes, um texto cinza e um botão em pílula), com **texto de verdade** (selecionável), fontes próprias, degradês e botões do jeito dele, no celular e no computador, com prévia dos dois. Pediu velocidade: o desenho ficou focado.

Este documento registra o **Design do pop-up**: no editor do pop-up, o card **Design** com **Padrão** (o visual de sempre, sem mudança nenhuma) ou **Personalizado** (o construtor). Vale para qualquer trabalho no visual do pop-up, no editor de avisos, nos envios de vídeo e de fonte ou no `MemberPopupCard`. Ele continua a v1 (`docs/22`), a v2 (`docs/23`), a v3a (`docs/24`) e a v3b-1 (`docs/25`); onde, quando, quantas vezes e como fecha continuam como no `docs/25`. Migração `202610230001_communication_popup_design.sql` (as `202610200001` … `202610220003`, já aplicadas, não mudam). Tabelas em `docs/05` (seção Design do pop-up), segurança em `docs/06` (seção Design do pop-up), desenho em `docs/12`, editor em `docs/17` §1.8.2, testes em `docs/18`. A notificação do sino **nunca** tem design.

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Padrão \| Personalizado** | Padrão é o cartão de sempre (todo pop-up que já existe continua exatamente igual); Personalizado liga o construtor | editor do pop-up, card **Design** (logo depois do conteúdo) |
| **Modelos para começar** | **Mídia no topo com degradê** (a estrutura da referência, com textos neutros), **Só texto**, **Texto sobre a mídia**; escolher preenche tudo, depois tudo muda | card Design, na primeira vez em Personalizado; **Trocar de modelo** pede confirmação |
| **Mídia** | **Sem mídia**, **Imagem** (a imagem do aviso, recorte 16:9) ou **Vídeo** (MP4 H.264 ou WEBM, até 15 MB, mudo, em repetição, toca sozinho e inline); formato 16:9, 4:3 ou 1:1; recorte em cima, no meio ou embaixo; **degradê para o fundo** com altura (10 a 100 %) e cor (igual ao fundo do cartão ou outra) | seção Mídia |
| **Texto e posição** | o grupo de texto **abaixo da mídia** (podendo **subir sobre a mídia** 0 a 60 %) ou **sobre a mídia, em cima / no meio / embaixo**; alinhamento esquerda, centro ou direita; espaço entre os blocos 0 a 48 px. Sem arrastar livre | seção Texto e posição |
| **Blocos** | até 12, na ordem que a equipe escolher: **Selo**, **Título** (1 a 4 linhas, cada uma com cor ou degradê e tamanho próprios), **Texto**, **Botão principal** (é o botão de sempre: texto, destino e o clique contado), **Segundo botão** (Fechar, Lembrar depois ou Abrir um link), **Áudio** (o player do áudio do aviso), **Espaço** | seção Blocos (Subir, Descer, Editar, Tirar) |
| **Estilos** | texto: fonte, tamanho (10 a 96 px), peso, altura da linha, espaço entre letras, maiúsculas, cor ou degradê, alinhamento; botão: fundo cor ou degradê, cor do texto, borda, cantos (até pílula), brilho, tamanho P/M/G, ocupa a linha ou do tamanho do texto, fonte, peso | dentro de cada bloco |
| **Cartão** | largura no computador P 360, M 440, G 520 px (no celular ocupa a tela e tudo encolhe junto), fundo cor ou degradê com ângulo, borda, cantos, respiro, sombra | seção Cartão |
| **Fontes** | as prontas (Inter e Exo 2 do app, mais Sistema, Condensada, Serifada e Monoespaçada do próprio aparelho) e as **enviadas** uma vez (WOFF2, WOFF, TTF ou OTF, até 2 MB; até 40 na biblioteca, até 4 diferentes por pop-up); nada vem do Google na hora | seção Fontes e o seletor de cada texto |
| **Fechar e links** | cor e fundo do X (36 px visíveis, 44 px de toque, sempre); cor de "Lembrar depois" e "Não mostrar de novo" | seção Fechar e links |
| **Prévia** | celular (375 px) e computador lado a lado (empilhados em telas estreitas), com o mesmo cartão que o aluno vê | coluna da prévia |
| **Contraste** | dica sem impedir salvar quando um texto fica difícil de ler (WCAG AA: 4,5:1 no texto, 3:1 no texto grande e no X) | embaixo do bloco ou da seção |

Vocabulário na tela: **Design**, **Padrão**, **Personalizado**, **Começar de um modelo**, **Mídia**, **Degradê**, **Texto e posição**, **Blocos**, **Selo**, **Título**, **Botão principal**, **Segundo botão**, **Cartão**, **Fontes**, **Fechar e links**, **Nome do pop-up**. Nunca "campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "automação", "lembrete", "layout", "template" ou "home" (teste de vocabulário em `popup-design-editor-modelo`).

---

## 1. O que o aluno vê

### 1.1 O cartão Personalizado

- O pop-up abre onde, quando e quantas vezes a equipe escolheu (`docs/25`), na mesma janela de sempre (Base UI `Dialog`): mesmo véu, mesmo foco inicial, mesmo `Esc`, mesmo "Como fechar", mesmo "um de cada vez".
- O cartão segue o design: a mídia (imagem ou vídeo) no topo, sumindo no fundo pelo degradê; o grupo de texto abaixo (subindo sobre a mídia) ou por cima dela; os blocos na ordem escolhida; no fim, "Lembrar depois" (quando vale) e "Não mostrar de novo" na cor escolhida, com 44 px de toque; o X redondo no canto, com as cores escolhidas.
- **Texto de verdade**: título, selo, texto e botões são texto da página (o aluno seleciona, copia, o leitor de tela lê, o tradutor do navegador traduz). O degradê no texto é `background-clip: text` sobre o próprio texto, nunca uma imagem.
- **Nome do diálogo** = o texto do título do design (as linhas com espaço entre elas); sem bloco Título, vale o "Nome do pop-up". A descrição é o primeiro bloco Texto.
- **Vídeo**: mudo, em repetição, toca sozinho e inline (`muted autoPlay loop playsInline`), sem controles, sem picture-in-picture, escondido do leitor de tela; a imagem do aviso é a capa (`poster`). Para quem pede **menos movimento** (`prefers-reduced-motion: reduce`) ou está em **economia de dados** (`Save-Data`), aparece só a capa e o vídeo nem é baixado (o `<video>` só entra depois dessa decisão, num efeito). Ao fechar, o vídeo pausa e o arquivo é solto.
- **Fonte enviada**: carregada pelo navegador direto do nosso Storage (FontFace com `display: swap`), só quando o pop-up abre; enquanto carrega, o texto aparece na fonte do sistema e troca sem pular.
- **Celular**: o cartão ocupa a tela menos 1 rem de cada lado e tudo dentro encolhe junto (unidades do próprio cartão); a fonte nunca fica abaixo de 12 px e os botões M e G nunca abaixo de 44 px de altura; nada rola para o lado em 375 px.
- **Botão principal**: é o botão de sempre (`cta`): mesmo destino, mesma aba, o mesmo clique contado (`message_clicked` e `clicked_at`), então **Para de aparecer: Quando o aluno clica no botão** continua valendo. **Segundo botão**: **Fechar** fecha como o X; **Lembrar depois** adia como o link (some quando o aluno já não pode adiar, e aí o link pequeno também não repete); **Abrir um link** leva ao destino e conta como o clique, igual ao botão principal.
- **Padrão**: o cartão de sempre, com o mesmo HTML de antes (conferido por teste contra a `origin/dev`).

### 1.2 Resposta curta ao produtor (para colar)

> Pronto: no pop-up, o card **Design** agora tem **Padrão** (o de sempre, e todo pop-up que já existe continua igual) e **Personalizado**. No Personalizado você começa de um modelo (**Mídia no topo com degradê** é a estrutura do exemplo que você mandou) e muda tudo: vídeo curto ou imagem em cima sumindo num degradê para o fundo, selo, título com até 4 linhas (cada uma com a sua cor ou degradê), texto, botão principal e um segundo botão com o estilo que quiser (cor ou degradê, cantos, brilho, tamanho), cores do cartão, do X e dos links. O texto fica por zonas (abaixo da mídia, subindo sobre ela, ou por cima dela em cima, no meio ou embaixo), com alinhamento e espaçamento; arrastar livre fica para depois.
>
> Fontes: além das prontas, você envia a sua uma vez (WOFF2, WOFF, TTF ou OTF, até 2 MB) e usa em qualquer texto. Quer uma do Google Fonts? Baixe o arquivo no site e envie aqui: nada é carregado do Google na hora (privacidade). Confira se a licença da fonte permite usar no site.
>
> Vídeo: MP4 (H.264) ou WEBM, até 15 MB, sem som e em repetição; vídeos de até 15 segundos ficam mais leves. Se o aviso não tiver imagem, o editor tira um quadro do vídeo para ser a capa. Quem prefere menos movimento ou está economizando dados vê só a capa.
>
> A prévia mostra o celular e o computador lado a lado. O texto é de verdade (o aluno seleciona e o leitor de tela lê), e o editor avisa quando uma cor fica difícil de ler. O clique no botão continua contando como antes, inclusive para "Para de aparecer: Quando o aluno clica no botão".

---

## 2. O que a equipe faz (editor do pop-up)

### 2.1 Card "Design"

Logo depois do card do conteúdo, só no pop-up. Descrição: `Escolha o visual do pop-up. O Padrão é o de sempre; no Personalizado você monta mídia, textos, botões e cores.`

- Escolha (`name="popup-design"`): **Padrão** · `Imagem em cima, título, texto e botão, com as cores da área de membros.` | **Personalizado** · `Monte o seu: vídeo ou imagem com degradê, textos com fontes e cores, botões do seu jeito.`
- Primeira vez em Personalizado: **Começar de um modelo** (`Escolha um modelo para começar. Depois, tudo pode ser mudado.`) com os três modelos e **Usar este modelo**. Sem botão no aviso, o modelo cria o botão `Saiba mais` com o destino vazio (o produtor escolhe para onde leva; salvar sem destino foca o campo). Com áudio, entra o bloco Áudio. O vídeo que já estava no design fica.
- Voltar a **Padrão** guarda o design em memória; voltar a Personalizado devolve sem perguntar (coerente com o botão e o áudio do momento). **Trocar de modelo** confirma (`Trocar de modelo?` / `Os textos e as cores do design atual serão trocados pelos do modelo.` / `Trocar` / `Cancelar`).
- No Personalizado, o card do conteúdo esconde **Texto**, **Ícone**, **Imagem** (vai para Mídia, com a descrição da imagem) e **Para onde leva** (vai para o bloco Botão principal); **Título** vira **Nome do pop-up** (`Aparece nas listas e nos relatórios. Para o aluno, vale o título do design.`); o bloco de mídia vira só **Áudio**. Texto e ícone ficam guardados: voltar a Padrão devolve tudo.

### 2.2 Seções (nesta ordem)

1. **Mídia** (`name="popup-design-midia"`): `Sem mídia` | `Imagem` | `Vídeo`. Imagem: o campo de imagem de sempre (`Também é a capa do vídeo.`). Vídeo: **Enviar vídeo** (`MP4 (H.264) ou WEBM, até 15 MB. Toca sem som, em repetição. Quem prefere menos movimento vê só a imagem.`), `Enviando o vídeo… n%`, depois `Vídeo enviado` com **Trocar vídeo** e **Tirar vídeo**; vídeo acima de 15 s ganha a dica `Vídeos curtos (até 15 segundos) ficam mais leves e combinam com a repetição.`. Enquanto sobe, salvar e sair da página esperam (`Espere o vídeo terminar de enviar.`). **Formato da mídia**, **Recorte**, **Degradê para o fundo** (chave), **Altura do degradê**, **Cor do degradê** com **Igual ao fundo do cartão**.
2. **Texto e posição** (`name="popup-design-posicao"`): **Onde fica o texto** (`Abaixo da mídia` · `Sobre a mídia, em cima` · `Sobre a mídia, no meio` · `Sobre a mídia, embaixo`), **Subir sobre a mídia** (só Abaixo com mídia; `Quanto o texto sobe por cima da mídia.`), **Alinhamento**, **Espaço entre os blocos**.
3. **Blocos** (`id="popup-design-blocos"`): cada linha com o nome (Selo, Título, Texto, Botão principal, Segundo botão, Áudio, Espaço), um resumo e **Subir**, **Descer**, **Editar**, **Tirar** (nome acessível `Subir o bloco Título` etc.). Uma edição aberta por vez (o bloco com erro abre sozinho). **Adicionar bloco**: Selo, Título, Texto e Espaço entram antes do primeiro botão; o Segundo botão entra no fim; **Botão principal** aparece quando não há (cria o botão `Saiba mais`). Tirar o Botão principal tira o botão do aviso. O Áudio entra e sai com o áudio do aviso. Com 12 blocos: `Use até 12 blocos.`.
4. **Cartão** (`id="popup-design-cartao"`): **Largura no computador** (`P (360 px)` · `M (440 px)` · `G (520 px)`; `No celular, o cartão ocupa a tela e tudo encolhe junto.`), **Fundo**, **Borda**, **Cantos**, **Respiro interno**, **Sombra** (`Sem` · `Suave` · `Forte`).
5. **Fontes** (`id="popup-design-fontes"`): a biblioteca (nome, peso, estilo, tamanho) com **Renomear** e **Excluir** (`Excluir a fonte?` / `Pop-ups que usam esta fonte não deixam excluir.`); vazia: `Nenhuma fonte enviada ainda. As prontas (Inter, Exo 2 e as do sistema) já estão na lista.`; dica `Quer uma fonte do Google Fonts? Baixe o arquivo no site e envie aqui. Nada é carregado do Google na hora.`. **Enviar fonte** abre o diálogo (`Use arquivos WOFF2, WOFF, TTF ou OTF de até 2 MB. Confira se a licença da fonte permite usar no site.`; **Arquivo**, **Nome**, **Peso**, **Estilo**). O seletor de fonte de cada texto tem as prontas, **Suas fontes** e **Enviar fonte…**.
6. **Fechar e links** (`id="popup-design-fechar"`): **Cor do X**, **Fundo do X**, **Cor dos links (Lembrar depois e Não mostrar de novo)**.

Campo de cor: texto `#RRGGBB` ou `#RRGGBBAA` mais o seletor nativo (que mantém a transparência digitada). Pintura: **Cor** | **Degradê** (De, Para, Ângulo 0 a 360°). Pesos: os que a fonte tem (Exo 2 só 500 a 700; a enviada começa no peso dela).

### 2.3 Prévia, erros e "Quantas vezes"

- **Prévia**: no Personalizado, celular (375 px) e computador (600 px, para o G caber em tamanho real) lado a lado quando há espaço, empilhados na coluna estreita, os dois pelo `MemberPopupCard` com `preview` (sem links, áudio parado, botões sem ação; o vídeo toca mudo). O relatório mostra a mesma prévia com as fontes do design.
- **Foco no erro**: cada erro do design leva ao campo (`design.blocks.N.lines.L.*` → a linha; `.text` → o texto; `.label` → o rótulo do segundo botão; `.action*` → o destino ou a escolha; `design.media.video` → o vídeo; `design.fonts` → Fontes; `design` → a escolha Padrão/Personalizado); `cta.*`, `image` e `audio` continuam nos campos de sempre (o destino do botão principal fica dentro do bloco).
- **Dica de contraste**: embaixo do bloco (no Título, embaixo de cada linha) ou de Fechar e links, com o ícone de aviso, por exemplo `Contraste baixo (2,1:1). Para ler bem, use pelo menos 4,5:1.`. Não impede salvar. Texto sobre a mídia sem degradê não é medido (não dá para medir sobre um vídeo).
- **Quantas vezes** (card da v3b-1): **Quando o aluno clica no botão** fica liberado também quando não há botão principal mas há um **Segundo botão** com **Abrir um link** (o link conta como o clique, D9). Sem nenhum dos dois, o aviso no Personalizado diz `Este pop-up não tem botão. Acrescente o Botão principal no Design ou escolha outra opção.` (no Padrão continua apontando para a chave "Levar o aluno a algum lugar").

### 2.4 Validação (zod no navegador, na Server Action e na leitura)

| Situação | Campo | Mensagem |
|---|---|---|
| botão no aviso sem bloco Botão principal | `design.blocks` | `Falta o bloco do botão principal no design.` |
| bloco Botão principal sem botão | `cta.label` | `Escreva o texto do botão e escolha para onde ele leva.` |
| áudio sem bloco Áudio / bloco Áudio sem áudio | `design.blocks` / `audio` | `Falta o bloco Áudio no design.` / `Envie o áudio ou tire o bloco Áudio.` |
| mídia Imagem sem imagem | `image` | `Envie a imagem do topo ou escolha “Sem mídia”.` |
| mídia Vídeo sem imagem | `image` | `Envie também uma imagem: ela aparece enquanto o vídeo carrega e para quem prefere menos movimento.` |
| mídia Vídeo sem vídeo | `design.media.video` | `Envie o vídeo ou escolha outra mídia.` |
| segundo botão Lembrar depois com Lembrar depois desligado | `design.blocks.N.action` | `Este botão usa o “Lembrar depois”, que está desligado neste pop-up.` |
| mais de 4 fontes enviadas | `design.fonts` | `Use até 4 fontes enviadas no mesmo pop-up.` |
| fonte que saiu da biblioteca (servidor) | `design.fonts` | `Esta fonte não está mais na biblioteca. Escolha outra.` |
| vídeo de fora do nosso bucket | `design.media.video` | `Envie o vídeo de novo.` |
| número fora do limite | o campo | `Use de 10 a 96.` (a frase do limite) |

---

## 3. Dados (migração `202610230001`)

Três seções aditivas e idempotentes, todas pelo MCP (sem `drop`, `delete`, gatilho ou função; constraint dentro de `if not exists`; nada para o SQL Editor). Detalhes em `docs/05`.

- `campaigns.popup_design jsonb` (nulo = **Padrão**). Check `campaigns_popup_design_v1`: nulo, ou objeto com `version` numérica, só em `kind = 'popup'`, até 32 KB. O formato fino (versão 1) mora no zod (`popup-design-schema.ts`), que roda ao salvar **e** ao ler: inválido ou de outra versão = Padrão. Nenhuma linha é reescrita.
- `communication_fonts`: a biblioteca (`name`, `family_key` `bf_` + 12 hex, `file_path` `fonts/<24 hex do sha256>.<ext>`, `format`, `weight`, `style`, `size_bytes`, `created_by`, `deleted_at`). RLS ligado e **sem política** (só `service_role`); o aluno nunca lê a tabela.
- Buckets públicos `communication-fonts` (2 MB; `font/woff2`, `font/woff`, `font/ttf`, `font/otf`) e `communication-popup-video` (15 MB; `video/mp4`, `video/webm`).

### 3.1 O design (versão 1, autocontido)

`{ version: 1, card, media, text, blocks[], close, links, fonts[] }` (tipos em `src/server/communications/popup-design-model.ts`): cores só `#RRGGBB`/`#RRGGBBAA` (minúsculas na forma canônica); números com limite; escolhas de lista; textos com teto (linha do título 60, texto 300, selo 32, segundo botão 30); ids de bloco `^[a-z0-9]{1,12}$` únicos; `button`, `button2` e `audio` no máximo uma vez; fontes enviadas só pelo id (`fonts` é derivado e recalculado ao salvar); vídeo `{ path, url, mimeType }` com o caminho `videos/<uuid>.<mp4|webm>` e a url **recalculada pelo servidor** a partir do caminho (ao salvar e ao ler). Nada no design aponta para o aviso: ele pode virar "modelo salvo" depois sem migração.

| Campo do aviso | Padrão | Personalizado |
|---|---|---|
| `title` | título visível | nome nas listas e relatórios; nome acessível só sem bloco Título |
| `body`, `icon` | visíveis | guardados, não aparecem |
| `image` | imagem 16:9 | imagem da mídia e capa do vídeo |
| `cta` | botão | texto e destino do bloco Botão principal |
| `audio` | player | bloco Áudio |
| `popup_design` | nulo | o design |

### 3.2 Limites

Blocos 1 a 12; linhas do título 1 a 4; fonte 10 a 96 px; altura da linha 0,8 a 2; espaço entre letras −0,1 a 0,5 em; cantos do cartão 0 a 40; respiro 12 a 48; borda 0 a 4 px; espaço entre blocos 0 a 48; espaço 4 a 96; subir 0 a 60 %; degradê 10 a 100 %; ângulo 0 a 360; cantos do botão e do selo 0 a 999 (999 = pílula); até 4 fontes enviadas por pop-up; até 40 fontes na biblioteca; fonte até 2 MB; vídeo até 15 MB; design até 32 KB no banco.

---

## 4. Segurança

- **Texto**: React escapa todo texto; estilos só por objetos de estilo do React montados de valores já validados (hex, números com limite, listas). Nunca `dangerouslySetInnerHTML`, `innerHTML`, `cssText` nem `<style>` no cartão (o teste de guarda `popup-design.guard` confere a pasta do cartão, `member-popup.tsx` e `member-popup-dialog.tsx`). Família CSS só `bf_<12 hex>` (nunca o nome do produtor).
- **Zod no salvar e no ler**: `.strict()` em todo objeto; chave a mais recusa; a leitura inválida vira Padrão (um design quebrado nunca chega ao aluno).
- **URLs**: vídeo só do bucket `communication-popup-video` da nossa origem Supabase (http só em 127.0.0.1/localhost), extensão igual ao tipo; o servidor troca a url pela pública do caminho. Fonte: a url sai da biblioteca no servidor, nunca do design. O navegador confere de novo (vídeo fora do bucket vira só a capa; fonte fora do bucket não é registrada).
- **Envio de vídeo**: direto do navegador ao Storage por endereço assinado (`startPopupVideoUpload`, só `messaging.write`); o arquivo nunca passa pelo servidor do app. Depois, `finishPopupVideoUpload` confere o tamanho (`info()` do Storage) e **só os primeiros 64 bytes** (pedido com `Range: bytes=0-63`, lido até 64 bytes e cancelado sem esperar): MP4 com `ftyp` e marca que não seja QuickTime, áudio ou imagem; WEBM com EBML e DocType `webm`; o tipo gravado no Storage tem que ser o dos bytes. Recusado = apagado (422/413). **Ao salvar**, um vídeo cujo caminho é diferente do já gravado no pop-up passa de novo pela mesma conferência (`assertPopupDesignVideo` em `actions.ts`): um objeto enviado pelo endereço assinado sem passar pelo `finishPopupVideoUpload`, ou um caminho que nunca recebeu arquivo, é recusado no campo `design.media.video` (e apagado, se existir).
- **Envio de fonte**: `POST /api/admin/communications/popup-fonts` (multipart, só `messaging.write`, 2 MB): o tipo vem dos primeiros bytes e do cabeçalho mínimo (WOFF2/WOFF com o tamanho do arquivo, TTF/OTF com o diretório de tabelas inteiro); coleção (`ttcf`) e qualquer outra coisa → 422; o tipo informado pelo navegador nunca é usado. O mesmo arquivo não duplica (caminho pelo sha256).
- **CSP**: `font-src 'self' data: <origem do Supabase>` (nada do Google: o teste de guarda confere que a CSP não cita `fonts.googleapis.com`/`fonts.gstatic.com`); `img-src` e `media-src` já aceitavam o Storage.
- **Auditoria** sem conteúdo: `popup_design: "custom" | "default"` em salvar/publicar/aprovar; `communication.font_uploaded`, `communication.font_renamed`, `communication.font_deleted` e `communication.video_uploaded` (só ids, formato e tamanho).
- **Arquivos órfãos** (vídeo trocado, fonte excluída) ficam no Storage nesta versão (D21); excluir uma fonte em uso por pop-up não excluído é recusado (409).

---

## 5. Por dentro

- **Do banco ao aluno**: a lista de pop-ups no ar (cache de 60 s, tag `communications`, chave `["communications-live-popups", "design1"]`) lê `popup_design`, valida (`parsePopupDesign`), recalcula a url do vídeo e resolve as fontes de todos os pop-ups numa consulta (`loadPopupFontFaces`, sem olhar `deleted_at`: pop-up gravado nunca perde a fonte; falha = sem fontes, o pop-up nunca cai). O `POST /api/popups/[id]/show` (e o `?popup=1` da v1) devolve `PopupItem` com `design` e `fonts` (`{ family, format, id, style, url, weight }`) só no Personalizado; o Padrão continua o objeto de antes, sem as chaves.
- **Cartão** (`src/components/member/notifications/popup-design/`): `popup-design-card.tsx` (cartão, mídia, grupo de texto, rodapé, X), `popup-design-blocks.tsx`, `popup-design-media.tsx` (`usePopupMotion` com `useSyncExternalStore` para menos movimento e economia de dados), `popup-design-styles.ts` (puro: todos os objetos de estilo), `popup-font-loader.ts` (FontFace com peso `"100 900"`, cache por família e endereço, erro engolido). `MemberPopupCard` despacha: com `popup.design`, `PopupDesignCard`; sem, o cartão de sempre (código idêntico). O diálogo e a prévia do admin usam o mesmo cartão.
- **Escala**: os tamanhos do design valem para o cartão na largura escolhida; dentro do cartão, tudo é `cqw` do próprio cartão (o elemento de fora é o container, porque `cqw` mede o container ancestral), com pisos de 12 px na fonte e 44 px nos botões M/G; a borda fica em px.
- **Degradê da mídia**: camada por cima da parte de baixo da mídia, de transparente até a cor, com paradas suavizadas (35 % da cor na metade, 75 % aos três quartos) para a mídia "sumir" sem faixa dura. Zona `below` com subir = margem negativa em `cqw` (% da altura da mídia); zonas "sobre a mídia" = mídia e texto na mesma célula de grid (a célula cresce se o texto for maior: nunca corta).
- **Módulos puros**: `popup-design-model.ts` (tipos, limites, modelos, forma canônica, contraste, escala, CSS) **sem zod**, para o cartão do aluno não puxar o zod; `popup-design-schema.ts` (zod) para o editor, a Server Action e a leitura; `popup-design-editor-model.ts` (as peças do editor).
- **Editor**: `src/components/admin/v2/communication/popup-design/` (card, seções, editores de bloco, campos de estilo, seletor e diálogo de fonte, envio de vídeo com porcentagem por XHR PUT no endereço assinado e o quadro da capa por canvas → WebP 1280 × 720 pelo `uploadNoticeImage`, que falha em silêncio). O `NoticeCtaField` ganhou `showSwitch` (no bloco Botão principal a chave "Levar o aluno a algum lugar" não faz sentido).

---

## 6. Rotas e ações

| Rota / ação | O que faz |
|---|---|
| `startPopupVideoUpload({ mimeType, sizeBytes })` | endereço assinado `videos/<uuid>.<ext>` (`Use um vídeo MP4 (H.264) ou WEBM.`, `O vídeo deve ter no máximo 15 MB.`) |
| `finishPopupVideoUpload({ path })` | confere tamanho e 64 bytes; devolve `{ mimeType, path, url }`; recusado = apagado (`Envie o vídeo de novo.` 400/404) |
| `POST /api/admin/communications/popup-fonts` | `file`, `name` (vazio = nome do arquivo), `weight` (100 a 900), `style` (normal/italic) → `{ data: PopupFontOption }` (a mesma fonte quando o arquivo já está); 413 `A fonte deve ter no máximo 2 MB.`, 422 `Use uma fonte WOFF2, WOFF, TTF ou OTF.`, 409 `A biblioteca já tem 40 fontes. Exclua uma antes de enviar outra.`, 400 `Escolha um arquivo de fonte.` / `Envie a fonte como arquivo.` / `Escolha um peso da lista.` / `Escolha o estilo da fonte.` / `Use de 1 a 60 caracteres.` |
| `listPopupFonts()`, `renamePopupFont({ id, name })`, `deletePopupFont({ id })` | biblioteca; 404 `Esta fonte não existe mais.`; 409 `Esta fonte está em uso em 1 pop-up. Troque a fonte nele antes de excluir.` (ou `… em N pop-ups. Troque a fonte neles antes de excluir.`); excluir = `deleted_at` |
| Salvar / publicar / aprovar (`actions.ts`) | `withCheckedDesign`: design × conteúdo, fontes na biblioteca, url do vídeo recalculada; publicar e aprovar conferem as fontes de novo; Duplicar copia o design |

---

## 7. Desempenho

O cartão Personalizado só entra no pedaço preguiçoso da janela do pop-up (baixado quando algo foi armado). Medido com `next build` (gzip), `origin/dev` × esta entrega:

| | `origin/dev` | esta entrega | diferença |
|---|---|---|---|
| JS inicial do Início (`/`) | 297.356 B | 297.375 B | **+19 B** (limite combinado: +2 KB) |
| JS inicial da página do produto (`/conteudo/[id]`) | 286.508 B | 286.526 B | +18 B |
| pedaço da janela do pop-up (o grupo do `import()` do host) | 11.426 B (2 arquivos) | 20.955 B (3 arquivos) | +9.529 B, só para quem tem pop-up armado |

O zod nunca entra no pedaço do aluno (guarda). O terceiro arquivo da janela é compartilhado com o editor do admin (o Dialog do Base UI e o `popup-design-model.ts` inteiro, inclusive os modelos para começar e o contraste, que o aluno não usa: ≈ 2 KB gzip a mais que o necessário; separar esses dois num módulo próprio fica para depois). Vídeo e fontes vêm do Storage, nunca do servidor do app; com menos movimento ou economia de dados o vídeo não é baixado; a fonte enviada só baixa quando o pop-up abre.

---

## 8. Decisões

| # | Decisão | Por quê |
|---|---|---|
| D1 | `campaigns.popup_design jsonb`, nulo = Padrão; só pop-up; o banco só garante objeto com `version` e ≤ 32 KB | todo pop-up de hoje fica igual sem reescrever linha; o formato fino num lugar só, testável |
| D2 | Zod versão 1, `.strict()`, no salvar e no ler (inválido ou outra versão = Padrão) | um design quebrado ou futuro nunca chega ao aluno |
| D3 | Modelo puro sem zod + schema zod separado | o pedaço da janela do aluno não puxa ~50 KB de zod |
| D4 | `title` continua obrigatório (nome nas listas e nome acessível de reserva); `body`/`icon` guardados | listas, relatório e auditoria seguem; voltar a Padrão devolve tudo |
| D5 | A imagem do aviso é a imagem da mídia e a capa do vídeo (obrigatória com mídia) | quem prefere menos movimento vê a capa, nunca um buraco |
| D6 | Botão principal = o `cta` (mesma validação, mesmo clique); bloco existe se e só se há `cta` | "para quando clica no botão" continua; nunca um botão invisível |
| D7 | Áudio = bloco Áudio, sincronizado sozinho | o produtor escolhe onde o player fica |
| D8 | Segundo botão: Fechar, Lembrar depois ou Abrir um link, reaproveitando os eventos de hoje | sem rota nem histórico novos |
| D9 | "Quando o aluno clica no botão" aceita também o segundo botão com link (no schema e, desde o fechamento, no card "Quantas vezes") | o clique do link grava `clicked_at` igual ao botão principal |
| D10 | Fontes enviadas numa biblioteca (RLS sem política), família `bf_…`, resolvidas pelo servidor; excluir = `deleted_at`, recusado se em uso; até 4 por pop-up, 40 na biblioteca | privacidade (nada do Google), CSS seguro, pop-up gravado nunca perde a fonte |
| D11 | FontFace com peso `"100 900"` | um arquivo estático vale para qualquer peso sem negrito imitado; fonte variável funciona |
| D12 | Vídeo direto do navegador ao Storage por endereço assinado, conferido depois (64 bytes) | Server Action tem limite de 1 MB e a Vercel 4,5 MB; o arquivo nunca passa pelo app |
| D13 | Fonte por rota multipart | 2 MB passa do limite das Server Actions |
| D14 | Escala por container query (`cqw`) com pisos de 12 px e 44 px | celular e computador (e a prévia) encolhem igual, nunca ilegível |
| D15 | Zonas: abaixo (com subir) e sobre a mídia em cima/meio/embaixo; sem mídia vale abaixo | cobre a referência e o "texto sobre a imagem" sem arrastar |
| D16 | Contraste é dica (WCAG AA), texto sobre mídia sem degradê não é medido | dica honesta; não inventa medida sobre vídeo |
| D17 | Chave nova do cache da lista no ar (`design1`) | o Data Cache sobrevive ao deploy; formato novo nunca lê entrada velha |
| D18 | CSP `font-src` com a origem do Supabase | o FontFace baixa do Storage; nada do Google |
| D19 | Auditoria só com códigos, ids, formato e tamanho | rastro sem dado pessoal nem texto |
| D20 | Design autocontido (sem id de aviso; fontes por id) | pode virar "modelo salvo" depois sem migração |
| D21 | Arquivos órfãos ficam no Storage nesta versão | limpeza é trabalho de job; volume pequeno (só a equipe envia) |
| D22 | Modelo "Mídia no topo com degradê" com subir 28 % e degradê de 65 % com paradas suavizadas (o contrato dizia 12 % e 55 % com degradê linear) | na conferência com a referência, com 12 % o selo encostava na borda da mídia e o degradê linear deixava uma faixa; com 28 %/65 % o selo fica dentro do degradê e o título começa onde a mídia some |
| D23 | No Personalizado, o card do conteúdo some com o rótulo "Áudio (opcional)" de dentro do bloco Áudio | o bloco já se chama Áudio; o rótulo repetia |
| D24 | O envio do vídeo cancela o corpo do pedido de 64 bytes sem esperar (`void cancel()`) | dentro do `next start`, esperar o `cancel` de um corpo lido pela metade nunca terminava e o editor ficava em "Enviando o vídeo… 100%" (pego nas fotos do editor; os testes no Node não pegavam) |
| D25 | Ao salvar, o vídeo novo do design é conferido de novo (tamanho e 64 bytes) | sem isso, um caminho `videos/<uuid>.mp4` do nosso bucket que nunca passou pelo `finishPopupVideoUpload` seria aceito (achado da revisão); só custa uma leitura de 64 bytes quando o vídeo muda |

---

## 9. Fica de fora

| Fora desta entrega | Onde está |
|---|---|
| Arrastar livre (posição x/y) | depois, se as zonas não bastarem |
| Enquete dentro do pop-up | v3b-3 |
| Salvar um design como modelo reutilizável | depois (o design já é autocontido, D20) |
| HTML ou CSS escrito pela equipe | nunca |
| Google Fonts carregado do Google na hora | nunca (baixar e enviar) |
| Design na notificação do sino | não planejado |
| Limpeza de vídeos e fontes sem uso no Storage | job futuro (D21) |
| Som no vídeo, controles, vídeo longo, vídeo de fora (YouTube, Bunny) no pop-up | não planejado (o vídeo é ambiente, curto e mudo) |
| Ponta a ponta no WebKit dos arquivos novos | rodados no Chromium; o WebKit roda no CI |

---

## 10. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/popup-design-modelo.test.mjs` (18) | zod v1 (strict, cores, limites, ids únicos, blocos únicos, 4 fontes, vídeo só do nosso bucket), `parsePopupDesign` (inválido/outra versão = Padrão), regras design × conteúdo, modelos válidos e sem dica de contraste, forma canônica, contraste WCAG, escala com pisos, CSS do degradê, o rascunho do pop-up com `design` e a notificação sem |
| Unitário | `tests/popup-design-desenho.test.mjs` (24) | estilos do cartão (texto sólido × degradê, linha do título, botão fit × full com piso, subir em `cqw`, zonas, degradê, cartão, X, rodapé), vídeo × capa (menos movimento, Save-Data, vídeo fora do bucket), o HTML do cartão (título real com as linhas, `<video>` com todos os atributos, prévia sem links, texto escapado, fonte enviada) e o **Padrão igual** ao da `origin/dev` |
| Unitário | `tests/popup-design-editor-modelo.test.mjs` (16) | modelos (cria o "Saiba mais", mantém o vídeo), Padrão ↔ Personalizado com memória, blocos (limite 12, ordem, tirar o principal), sincronia com botão e áudio, foco de cada erro, pesos por fonte, conferência do vídeo e da fonte antes de enviar, números, vocabulário; D9 no card "Quantas vezes" |
| Unitário | `tests/popup-media.test.mjs` (7) | sniffers de vídeo e de fonte com arquivos de verdade e falsos, caminhos, nome padrão, família `bf_`, 64 bytes com Range, recusado = apagado |
| Guarda | `tests/popup-design.guard.test.mjs` (7) | a migração pelo sha256, migrações antigas sem mudança, CSP sem Google, cartão sem `dangerouslySetInnerHTML`/`innerHTML`/`cssText`/`<style>`, cartão sem zod |
| Integração | `tests/integration/pop-ups-design-dados.test.mjs` (7) | salvar e ler o design, check do banco, RLS da biblioteca, lista no ar com design e fontes resolvidas numa consulta, Padrão sem as chaves, notificação sem design |
| Integração | `tests/integration/pop-ups-design-envios.test.mjs` (11) | rota de fonte (formatos, 413, 422, 403, 41ª = 409, mesmo arquivo), renomear, excluir em uso 409, vídeo por endereço assinado (mp4/webm de verdade), bytes inválidos apagados, url de fora recusada ao salvar, vídeo que não passou pela conferência recusado (e apagado) ao salvar |
| Ponta a ponta | `tests/e2e/produtor-desenha-pop-up.spec.ts` (4) | o produtor escolhe Personalizado + "Mídia no topo com degradê", envia o vídeo e a fonte, troca as duas linhas do título com duas cores, estiliza o botão, vê as duas prévias mudarem, publica; a aluna vê o título como texto selecionável na fonte enviada, o vídeo mudo em loop com a capa, o clique contado, 375 px sem rolagem; com menos movimento, nenhum `<video>` |
| Ponta a ponta | `tests/e2e/pop-up-design-aluno.spec.ts` (5) | nome acessível = título do design, `<video>` tocando, segundo botão Fechar = X, menos movimento sem baixar o vídeo, 375 px com fonte ≥ 12 px e botões ≥ 44 px, Padrão igual |
| Ponta a ponta | `tests/e2e/pop-up-design-editor.spec.ts` (1) | o card Design inteiro: nome do pop-up, vídeo com o quadro da capa, cor da linha, dica de contraste, segundo botão, fonte enviada, foco no destino vazio, salvar, reabrir, prévias, publicar |

Arquivos de amostra em `tests/fixtures/popup-design/` (vídeo MP4 H.264 e WEBM VP8 de 1 s, fonte WOFF2 e TTF, subconjunto da Inter, OFL-1.1, com `LICENCA.txt`). Ajudas: `tests/e2e/popup-design-fixtures.ts` (`prepararMidiaDoDesign`, `publicarPopUpComDesign`) e, em `tests/e2e/fixtures.ts`, `designDoPopUpNoBanco(titulo)`. `limparComunicacao` apaga as fontes das contas de teste.

---

## 11. Roteiro de conferência no ambiente de teste

1. **Antes do merge**, aplicar a `202610230001` no Supabase da nuvem: as três seções pelo MCP, na ordem e uma por chamada (ou `apply_migration` com o arquivo inteiro, nome `communication_popup_design`), e conferir com as consultas do cabeçalho (0 designs, constraint validada, RLS ligado sem política, 2 buckets públicos). Se foi por `execute_sql`: `insert into supabase_migrations.schema_migrations (version, name) values ('202610230001', 'communication_popup_design') on conflict do nothing;` (`docs/21` §9.2).
2. Um pop-up que já existia abre igual (Padrão) para o aluno e no editor.
3. Novo pop-up › Design › Personalizado › **Mídia no topo com degradê** › enviar um vídeo curto: o editor mostra `Vídeo enviado` e a capa aparece no campo Imagem.
4. Enviar uma fonte, usar no título, trocar o texto e a cor das duas linhas, estilizar o botão; conferir as prévias de celular e computador.
5. Publicar e abrir o Início com a aluna de teste (no computador e no celular): vídeo mudo em repetição, selo dentro do degradê, título com as cores, texto selecionável, X redondo; o clique no botão leva ao destino e aparece no relatório.
6. No celular com "Reduzir movimento" ligado (ou economia de dados): só a capa.
7. Excluir a fonte em uso: recusado com a frase; trocar a fonte no pop-up e excluir: some da biblioteca.
