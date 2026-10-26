# 27. Comunicação: design Livre do pop-up (editor estilo Elementor)

Data: 23/10/2026. Pedido do produtor depois do Personalizado (`docs/26`): "criar o que eu quiser da forma que eu quiser", montando o pop-up do zero, elemento por elemento, com estilo em cada elemento, como no Elementor. No card **Design** do pop-up entra a terceira opção **Livre**, ao lado de **Padrão** e **Personalizado** (os dois continuam exatamente como estavam). Sem migração: o Livre mora na mesma coluna `campaigns.popup_design` (migração `202610230001`), com `mode: "free"`.

Este documento vale para qualquer trabalho no design Livre: o editor de tela cheia, o cartão do aluno (`PopupFreeCard`), o JSON do design, os envios de imagem e o "Criar com IA" que vem depois. Onde, quando, quantas vezes e como o pop-up fecha continuam como no `docs/25`; o Personalizado continua no `docs/26`. A notificação do sino **nunca** tem design.

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Padrão \| Personalizado \| Livre** | os dois primeiros continuam exatamente como no `docs/26`; **Livre** monta o pop-up do zero, elemento por elemento | editor do pop-up, card **Design** (logo depois do conteúdo) |
| **Modelos para começar** | **Vídeo no topo com degradê** (a estrutura da referência que o produtor mandou), **Só texto com brilho**, **Em branco**, **Imagem recortada com selo** (L1.1) e, quando o aviso tem um Personalizado, **Usar o design Personalizado** (L1.1, §13.2); escolher abre o editor (numa tela larga); **Trocar de modelo** pede confirmação e dá para desfazer no editor | card Design, na primeira vez em Livre |
| **Resumo no card** | miniatura (o próprio cartão do aluno, reduzido), **Abrir editor Livre**, `{n} elementos · {largura} px` e, com problemas, `{n} problemas para revisar` (abre o editor no Revisar) | card Design |
| **Editor Livre** | tela cheia por cima do editor do aviso: **Elementos** e **Camadas** à esquerda, a área de desenho no meio (selecionar, arrastar, redimensionar pelas alças, guias de alinhamento), **Conteúdo / Estilo / Avançado / Celular** à direita (ou **Pop-up**, sem seleção, ou **Revisar**); **Desfazer** / **Refazer** (100 passos), **Ver como** Computador / Celular (com o Celular, arrastar um solto, as alças, as setas, **Alinhar no pop-up** e **Aumentar a altura** mudam só o celular, §13.8; a ordem é uma só nos dois aparelhos, L29), zoom em passos `[−] [62 %] [+]` (**Ajustar à tela**, 50, 75, 100, 150 e 200 %, L43), **Atalhos**, **Salvar rascunho** (o editor continua aberto), **Concluir** | botão **Abrir editor Livre** (só em telas a partir de 1.024 px; abaixo, só a prévia) |
| **Elementos** | Título, Texto, Selo, Botão principal, Botão (Fechar, Lembrar depois ou Abrir um link; até 3 além do principal, em qualquer mistura, L45), Imagem (até 6 arquivos, com transparência), Vídeo (um), Ícone (24 prontos), Forma, Degradê, Linha, Espaço, Caixa em coluna, Caixa em linha; mais o Áudio (entra e sai com o áudio do aviso) e os Links (sempre um) | aba **Elementos** |
| **Arrastar** (L4a) | mudar a ordem arrastando: a linha nas **Camadas** (antes, depois, para dentro ou para fora de uma caixa), um elemento da sequência no próprio desenho (pelo corpo ou pela alça da barrinha), um botão do **Elementos** até o lugar no desenho e as camadas de fundo na faixa **Ordem**; uma linha mostra onde entra, soltar é um passo no histórico e `Esc` cancela; com o Celular, a ordem muda também no computador (§13.9) | Camadas, desenho, Elementos e o Fundo (Estilo e Pop-up) |
| **Vários e zoom** (L4b) | escolher vários (Shift, Ctrl ou ⌘ + clique no desenho; Ctrl ou ⌘ + clique, Shift + clique, Shift + ↑/↓ e Ctrl ou ⌘ + Enter nas Camadas; Ctrl ou ⌘ + A); com 2 ou mais, o painel **Vários** (duplicar, excluir, esconder, travar, camada, **Alinhar entre si**, **Alinhar no pop-up** e **Distribuir os espaços**) e mover junto pelo arrastar e pelas setas, cada comando um passo; `Alt + clique` escolhe o elemento de baixo; o zoom em passos também por Ctrl ou ⌘ + = e −, e por Ctrl ou ⌘ + roda no ponto do ponteiro; perto da borda, a área rola sozinha durante o arrastar (§13.10) | desenho, Camadas, painel da direita e barra de cima |
| **Na sequência / Solta** | na sequência, os elementos seguem a ordem da caixa (com largura, altura, margem até negativa e alinhamento); soltos têm X, Y, largura, altura, girar e camada, e 6 botões de **Alinhar no pop-up** | aba **Avançado** |
| **Estilo** | fundo com até 3 camadas (cor, degradê, degradê circular, imagem), borda, cantos, até 2 sombras (inclusive por dentro), opacidade, desfoque, desfoque do que está atrás, esmaecer de qualquer lado; texto com fonte (prontas e enviadas), tamanho, peso, itálico, altura da linha, espaço entre letras, maiúsculas, sublinhado ou riscado, alinhamento, cor ou degradê, sombra; **Outro estilo na seleção** dá cor, peso, tamanho ou fonte próprios a palavras escolhidas | aba **Estilo** e a área de texto |
| **Pop-up** | largura no computador (P 360, M 440, G 520, GG 640 ou outra de 280 a 720, com **Ajustar os elementos à nova largura**), altura mínima, fundo, borda, cantos, sombra, respiro, a sequência da prancheta, o X (cor, fundo, borda, tamanho, distância, lado) e as fontes | painel **Pop-up** (nada selecionado) |
| **Revisar** | sempre `Tamanho do design: N % do máximo.`; os erros que impedem salvar (cada um leva ao elemento e ao campo) e as dicas (contraste, texto pequeno, texto que muda de linha no celular (só quando o piso de 12 px muda o encaixe, §13.4), ordem de leitura, texto por cima de botão, cortado, celular alto, fonte que muda, vídeo sem capa) | botão **Revisar** |
| **Copiar e colar** (L1.1) | **Copiar o design** (o JSON na forma canônica), **Colar o design…** (o mesmo zod; arquivos de outro pop-up ficam vazios; um passo no desfazer) e **Copiar as instruções para a IA** (o §9), para a equipe pedir mudanças ao Claude ou ao ChatGPT dela e colar a resposta (§13.1) | barra de cima do editor Livre |
| **Celular** | o pop-up inteiro encolhe na mesma proporção (343 px numa tela de 375); texto nunca abaixo de 12 px e 44 px de toque nos botões, nos links e no X; valores próprios por elemento e da prancheta (`devices.mobile`, numa tela de até 767 px; §9.10 e §13.8) | aluno e prévia; no editor, a aba **Celular** e o **No celular** do painel Pop-up |
| **Links, foco e janela** (L6a) | "Lembrar depois" e "Não mostrar de novo" sublinham quando o mouse passa por cima (também em degradê); no foco por teclado, o anel escuro fica por cima da sombra própria do botão; o aperto de 1 px dos botões e a escala da janela ao abrir e ao fechar animam de verdade (nada anima com menos movimento); o `npm run verify` mede o pedaço do cartão e falha acima de 12 KB (§7, §13.11.1) | aluno (a janela, em todo pop-up) e o verify |
| **Dados** | o Livre mora em `campaigns.popup_design` com `mode: "free"` (o Personalizado sem a chave); sem migração; o JSON é estrito, esparso e só guarda caminhos dos nossos buckets (§3, §9) | banco |

Vocabulário na tela: **Livre**, **Abrir editor Livre**, **Editor Livre**, **Elementos**, **Camadas**, **Conteúdo**, **Estilo**, **Avançado**, **Pop-up**, **Revisar**, **Na sequência**, **Solta**, **Concluir**, **Salvar rascunho**, **Nome do pop-up**. Nunca "campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "automação", "lembrete", "layout", "template" nem "fluxo" (testes de vocabulário em `popup-livre-*-modelo` e `popup-design-editor-modelo`).

### Resposta curta ao produtor (para colar)

> Pronto: no card **Design** do pop-up agora tem **Livre**, ao lado de Padrão e Personalizado (os pop-ups que já existiam continuam iguais). No Livre você abre um editor de tela cheia, como o Elementor: à esquerda, **Elementos** (título, texto, selo, botões, imagem, vídeo, ícone, formas, degradê, linha, espaço e caixas em coluna ou em linha) e **Camadas** (a lista de tudo, para escolher, subir e descer, esconder e travar); no meio, o pop-up, onde você clica, arrasta e muda o tamanho, com guias para alinhar; à direita, **Conteúdo**, **Estilo** e **Avançado** de cada elemento. Para mudar a ordem, é só arrastar: a linha nas Camadas (para dentro ou para fora de uma caixa também), um elemento no próprio desenho, um elemento do painel Elementos até o lugar onde ele deve entrar e as camadas de fundo na faixa **Ordem**, com `Esc` para cancelar, Ctrl + Z para desfazer e, no Ver como Celular, o aviso de que a ordem muda também no computador. Você escreve o texto como num editor e pode dar outra cor, peso ou fonte a palavras escolhidas. Dá para colocar um elemento por cima do outro, soltar onde quiser, centralizar com um clique, girar, usar degradê em qualquer fundo e no texto, várias imagens (com fundo transparente), sombra, brilho, desfoque, esmaecer e preço riscado. Tem desfazer e refazer, a prévia de computador e celular (no celular, o pop-up inteiro fica menor, igual, e o texto nunca fica abaixo de 12 px) e o painel **Revisar**, que avisa o que precisa de ajuste. **Salvar rascunho** dentro do editor salva sem fechar. Comece pelo modelo **Vídeo no topo com degradê**, que é a estrutura do exemplo que você mandou; para ficar idêntico, envie a fonte do título em **Enviar fonte…**. O texto continua de verdade (o aluno seleciona e o leitor de tela lê) e o clique no botão conta como antes. O editor abre em telas a partir de 1.024 px (no celular e no tablet de pé, só a prévia). Na barra de cima ficam **Copiar o design**, **Colar o design…** e **Copiar as instruções para a IA**, para você pedir mudanças ao seu Claude ou ChatGPT e colar a resposta; o "Criar com IA", com a sua conta do Claude ou do Codex, vem no próximo passo. Agora você também escolhe vários elementos de uma vez (Shift ou Ctrl + clique, ou Ctrl + A) para mover, alinhar, distribuir os espaços, duplicar, esconder ou excluir juntos, pega o elemento de baixo com Alt + clique, usa o zoom de 50 a 200 % (os botões da barra, Ctrl + = e Ctrl + −) e põe até 3 botões "Abrir um link", cada um com o seu destino. E consertei três detalhes em todos os pop-ups, inclusive nos que já estão no ar: os links “Lembrar depois” e “Não mostrar de novo” do Livre sublinham quando o mouse passa por cima, o botão focado pelo teclado mostra o anel escuro mesmo quando tem sombra, e a janela do pop-up cresce de leve ao abrir e encolhe ao fechar (quem pede menos movimento no aparelho continua sem animação).

## 1. O que o aluno vê

- O pop-up Livre abre onde, quando e quantas vezes a equipe escolheu (`docs/25`), na mesma janela de sempre (mesmo véu, foco inicial, `Esc`, "Como fechar", "um de cada vez", nunca com o player tocando). Só o cartão muda. A janela de todo pop-up (Padrão, Personalizado e Livre) entra e sai com fade e escala de 95 %; a escala só anima de verdade desde o L6a (§13.11.1). Com menos movimento, nada anima.
- **O cartão** (`PopupFreeCard`): a prancheta na largura escolhida (280 a 720 px no computador), com os elementos na ordem das Camadas; os da sequência seguem as caixas (coluna ou linha), os soltos ficam na posição escolhida, um por cima do outro pela camada. O X fica por último, fora da prancheta e por cima de tudo (`zIndex` 60), sempre visível (o schema recusa um X que não contrasta, §9.6 regra 11) e com 44 px de toque. A prancheta corta o que passa dela: nada imita a página fora do cartão.
- **Texto de verdade** em tudo: título, texto, selo, botões e links são texto da página (o aluno seleciona, o leitor de tela lê, o tradutor traduz). O degradê no texto é `background-clip: text` em cada parte, com a cor de seleção legível. Nada vira imagem.
- **Nome do diálogo** = o texto do primeiro Título visível (`<h2>`, as linhas com espaço entre elas); sem Título, o "Nome do pop-up". A descrição é o primeiro Texto visível. Ordem de leitura e de Tab = ordem das Camadas (não a posição na tela); o X vem por último.
- **Celular**: o cartão ocupa a tela menos 1 rem de cada lado e tudo encolhe na mesma proporção (unidades `cqw` do próprio cartão: 375 px de tela → 343 px de cartão → 0,78 num cartão de 440). Duas proteções: o texto nunca fica abaixo de 12 px (um texto pequeno fica um pouco maior que a proporção, e os elementos com texto crescem em vez de vazar) e os botões, os links e o X têm 44 px de toque por um `::before` invisível (o desenho não muda). Nada rola para o lado em 375 px.
- **Valores próprios do celular** (PR L3, §9.10): com a tela do aluno até **767 px** de largura (`matchMedia("(max-width: 767px)")`, a mesma regra em todo lugar), o cartão desenha o design com `devices.mobile` por cima do computador (posição, tamanho do texto, respiro, elementos escondidos só no celular) e o encolher e o piso de 12 px continuam valendo por cima; acima de 767 px, o computador. A largura é lida antes do primeiro desenho (o cartão só aparece no navegador, depois do `POST /show`): o aluno nunca vê o computador piscar antes do celular. Girar o celular ou mudar a largura da janela com o pop-up aberto troca na hora. Um Título ou um Texto escondido só no celular não dá nome nem descrição ao diálogo ali (vale o primeiro visível no aparelho da tela). Sem `devices`, o cartão é exatamente o de antes (HTML comparado com o do commit-base).
- **Mídia**: imagens e o vídeo só dos nossos buckets, com o endereço montado na hora (§4). O vídeo é mudo, em repetição, inline, sem controles e escondido do leitor de tela; com **menos movimento** ou **economia de dados** aparece a capa (ou só o fundo do elemento, sem capa) e o vídeo nem é baixado. Imagens pelo `next/image` com `sizes` pela largura do elemento (o celular baixa a versão pequena).
- **Cliques**: elementos decorativos (forma, linha, espaço, ícone, imagem, vídeo, caixa) não recebem clique, então nada decorativo por cima bloqueia o botão nem o X; título, texto e selo recebem (para selecionar o texto), e o Revisar avisa quando um deles cobre um botão. O **Botão principal** é o botão de sempre (`cta`: mesmo destino, o mesmo clique contado em `message_clicked` e `clicked_at`); os botões **Abrir um link** (até 3 desde o L4b, cada um com o seu destino, L45) também contam como o clique, e no Livre o histórico guarda qual botão foi (`metadata.button` do `message_clicked`: `cta` ou `link:<id>`, L47); **Fechar** fecha como o X; **Lembrar depois** adia como o link (some quando o aluno não pode mais adiar).
- **Links**: "Lembrar depois" (quando o pop-up deixa adiar e não há botão Lembrar depois) e "Não mostrar de novo". Os dois se controlam em Links › Conteúdo: o "Lembrar depois" pela chave **Permitir “Lembrar depois”** (a mesma do aviso, `campaigns.allow_snooze`, §13.7) e o "Não mostrar de novo" pela chave **Mostrar “Não mostrar de novo”** (escondido, o aluno continua fechando pelo X, pelo `Esc` e, fora de "Só no X", clicando fora). Os dois sublinham quando o mouse passa por cima; com uma linha escolhida em Estilo (Sublinhado ou Riscado), ela fica sempre; com os Links em degradê, a linha tem a primeira cor do degradê (L6a).
- **Foco e aperto** (L6a): no foco por teclado, os botões, os links e o X mostram o contorno branco e o anel escuro de 4 px por dentro (a prancheta corta o que passa dela); num botão com sombra própria, o anel toma o lugar da sombra enquanto o foco dura. Os botões clareiam ao passar o mouse e descem 1 px ao apertar, com uma transição curta; com menos movimento, nada anima e o botão não desce.
- **Pedaço próprio**: o código do cartão Livre só é baixado quando o pop-up armado é Livre (o plano do aluno marca `design: "free"`), **antes** do `POST /show`: sem o código, nada abre e nada conta como visto (regra do `docs/25`). Padrão e Personalizado não pagam nada por ele (§7).
- **Livre inválido** no banco (edição direta, deploy voltado): não aparece para o aluno (§9.1).

## 2. O que a equipe faz (editor Livre)

### 2.1 Card "Design"

- Descrição: `Escolha o visual do pop-up. O Padrão é o de sempre; no Personalizado você monta por seções; no Livre você monta do zero, elemento por elemento.` Opções (`name="popup-design"`, empilhadas): **Padrão** e **Personalizado** como no `docs/26`, e **Livre** · `Monte do zero, como num editor de páginas: coloque cada elemento onde quiser, um por cima do outro, com o estilo que quiser.`
- **Memória entre os três**: trocar de modo guarda o design do modo que saiu; voltar devolve sem perguntar (coerente com o botão e o áudio de agora). Só o design do modo escolhido vai no rascunho (`design` ou `freeDesign`, nunca os dois).
- **Primeira vez no Livre**: **Começar de um modelo** (`Escolha um ponto de partida. No editor, tudo pode ser mudado.`), com a miniatura de cada modelo (o próprio `PopupFreeCard` em prévia, reduzido, fora do teclado) e `Usar este modelo`. Escolher aplica o modelo e abre o editor (numa tela larga). Sem botão no aviso, o modelo cria o `cta` `Saiba mais` com destino vazio (o "Para onde leva" fica no Botão principal, no editor); com áudio, entra o elemento Áudio; o vídeo do Personalizado atual ou guardado entra como arquivo do Vídeo e a imagem do aviso, quando é do nosso bucket, entra como capa (medidas lidas no navegador; o servidor confere ao salvar). Desde o L1.1 são quatro modelos (mais **Imagem recortada com selo**) e, quando o aviso tem um Personalizado (o do rascunho ou o guardado ao trocar de modo), o primeiro item é **Seu design Personalizado** com **Usar o design Personalizado** (§13.2).
- **Com o Livre montado**: miniatura, **Abrir editor Livre** (o editor é baixado no clique; passar o mouse ou focar o botão já começa a baixar), `{n} elementos · {largura} px` e, com erros que impedem salvar (do design ou do Botão principal), `{n} problemas para revisar`, que abre o editor no **Revisar**. **Trocar de modelo** pede confirmação (`Trocar de modelo?` / `O design Livre atual será trocado pelo modelo. Dá para desfazer no editor.` / `Trocar` / `Cancelar`) e abre o editor com o design de antes um passo atrás (Ctrl + Z volta a ele).
- Tela menor que 1.024 px: `O editor Livre precisa de uma tela maior (a partir de 1.024 px de largura). Aqui você vê a prévia.` (o botão fica desligado; a prévia continua).
- No Livre, o card do conteúdo se comporta como no Personalizado: esconde Texto, Ícone, Imagem e "Para onde leva" (o texto e o destino do Botão principal ficam no editor); "Título" vira **Nome do pop-up** (listas, relatórios e nome do diálogo quando o design não tem Título). O áudio continua no campo **Áudio** do aviso (`Um áudio curto. No design, o player fica onde estiver o elemento Áudio.`).
- **Prévia** do aviso e **relatório**: celular (375 px) e computador lado a lado, pelo mesmo cartão do aluno (o computador do tamanho da largura escolhida). Cada tela passa o seu aparelho ao cartão (`device`): a de 375 px mostra os valores próprios do celular (§9.10) e a do computador, os do computador, qualquer que seja a largura da janela de quem edita. As miniaturas (modelos para começar, "Meus modelos" e a lista de Modelos) desenham sempre o computador. **Quantas vezes → Quando o aluno clica no botão** vale quando o computador e o celular têm, cada um, um botão visível que conta como o clique: o Botão principal ou qualquer um dos até 3 **Abrir um link** com destino que vale (D9 do `docs/26`, L27); os botões podem ser outros em cada aparelho. Desde o L4b (L46, decisão 3 do produtor), o Botão principal escondido no computador (ou nos dois aparelhos) deixa de contar ali, como já não contava no celular. Um aviso já salvo assim (rascunho ou pedido de aprovação com "Quando o aluno clica no botão") abre com a regra **Só quando o pop-up terminar** (`noticeDraftOfRow`, como o caso antigo do `popup_frequency` nulo): publicar e aprovar não dão 400 num campo que ninguém mudou, e a equipe ajusta ao salvar. Publicar (no ar ou no pedido de aprovação) e aprovar gravam essa regra na linha, no mesmo update (`noticeStopOnToPublish`): o aluno recebe o que a equipe viu no editor e no relatório, e no celular, onde o Botão principal pode estar visível, o clique nele não faz o pop-up parar.

### 2.2 O editor Livre

- Um `Dialog` do Base UI em tela cheia por cima do editor do aviso. O `Esc` não fecha (serve para "selecionar a caixa de fora", com vários escolhidos a caixa de fora comum, e, no meio de um arrastar, para cancelar); fecha só em **Concluir**. Ao abrir, o foco vai para a primeira linha das Camadas; ao fechar, volta para **Abrir editor Livre**.
- Trabalha numa **cópia** do design e manda ao rascunho do aviso com atraso (no fim de um arrastar, 300 ms depois da última tecla e ao fechar). O histórico guarda o design e o `cta` juntos (excluir o Botão principal e desfazer devolve os dois).
- Barra de cima: **Concluir** (`Concluir e voltar ao aviso`), `Editor Livre` e o nome do pop-up; **Ver como** Computador | Celular; zoom `[Diminuir o zoom] [62 %] [Aumentar o zoom]` (desde o L4b, L43: o menu do meio tem **Ajustar à tela**, 50, 75, 100, 150 e 200 % e mostra a escala que se vê; abre sempre em **Ajustar à tela**); **Desfazer**, **Refazer**, **Revisar** (com o número de erros e dicas), **Copiar e colar** (L1.1, §13.1), **Atalhos** (`?`), **Salvar rascunho**. Três colunas: 280 / desenho / 340 px a partir de 1.280 px; 248 / desenho / 300 de 1.024 a 1.279.
- **Salvar rascunho** chama o salvar do editor do aviso e o editor **continua aberto**, com histórico, seleção e zoom (`Rascunho salvo.`). Com o pop-up no ar ou pausado, o botão é **Salvar alterações** e a frase é a do editor do aviso (por exemplo `Pop-up atualizado. Quem já viu não vê de novo. …`); o "Mostrar de novo para quem já viu" fica para o salvar do aviso (L16). Num aviso novo, o editor do aviso guarda o id e só troca de endereço no **Concluir** sem mudança depois do último salvar (trocar de endereço remontaria a página e levaria o editor junto); com mudança, o próximo salvar, já fora do editor, troca. Erro do design abre o **Revisar** com os itens; erro fora do design (por exemplo, o Nome do pop-up vazio) mostra `Há campos para revisar fora do editor: {nomes}.` com **Fechar o editor e revisar**. Enquanto um arquivo sobe, salvar e concluir esperam (`Espere o arquivo terminar de enviar.`). O Ctrl + Enter do editor do aviso não age com o editor Livre aberto.
- **Trabalho perdido**: com mudança não salva, o editor liga o `beforeunload` e guarda uma cópia de recuperação no navegador (`localStorage["bunker707:livre:<id do aviso ou novo>"]`, com o design, o `cta` e o `allowSnooze` da chave em Links › Conteúdo (§13.7), 1 s depois da última mudança, apagada ao salvar); ao abrir com uma cópia diferente, a faixa `Há um design deste pop-up que não foi salvo ({hora}).` oferece **Recuperar** (um passo no histórico; o `allowSnooze` volta pelo rascunho do aviso, fora do histórico) e **Descartar**. O editor do aviso também liga o `beforeunload` com o Livre mudado e não salvo.
- **Área de desenho**: o mesmo `PopupFreeCard` do aluno em prévia (Computador = palco da largura escolhida; Celular = moldura de 375 px com o cartão de 343 px). Clique seleciona o elemento mais de cima; duplo clique num texto abre a área de texto. Desde o L4b (§13.10): Shift, Ctrl ou ⌘ + clique põe ou tira da seleção (e nunca arrasta; com essas teclas o duplo clique não abre o texto) e `Alt + clique` sem arrastar escolhe o elemento de baixo, em ciclo pela pilha do ponto (L42). Soltos: arrastar (a partir de 3 px) muda X e Y, 8 alças (Shift mantém a proporção), setas (1 px; Shift, 10 px), guias que grudam nas bordas e no centro da prancheta e dos outros soltos (Alt ao mover desliga as guias e continua levando o elemento de cima, C2). Durante esse arrastar o design não muda (só a prévia); no fim, um passo no histórico; desde o L4b, `Esc` no meio cancela também o solto e as alças (L39), e o solto e as alças se arrastam também com o dedo (decisão 5 do produtor). Com 2 ou mais escolhidos, um contorno em cada um e a caixa tracejada do grupo com a etiqueta `3 elementos` (12 px), sem alças nem barrinha; arrastar um deles ou as setas movem os soltos juntos, num passo. Quando o palco não cabe na área (com 150 ou 200 %, ou num pop-up alto), a área rola, e perto da borda ela rola sozinha durante o arrastar (L44); Ctrl ou ⌘ + roda dá zoom no ponto do ponteiro. Da sequência (desde o L4a, §13.9): arrastar pelo próprio elemento (a partir de 6 px) ou pela alça do começo da barrinha (o jeito de pegar uma caixa coberta pelos filhos) muda o lugar na ordem, para cima, para baixo, para dentro ou para fora de uma caixa; uma linha mostra onde ele entra, um contorno tracejado mostra a caixa de destino e uma caixa que recusa mostra o motivo; `Esc` cancela, soltar fora do pop-up ou no mesmo lugar não muda nada, e soltar é um passo no histórico. A barrinha da sequência tem a alça, **Subir**, **Descer**, **Duplicar**, **Soltar** e **Excluir**. O palco é focável e diz o selecionado (`Selecionado: Título, X 24, Y 120.`). Com **Ver como: Celular** (desde o L3, §13.8) o palco desenha o design do celular (`resolveFreeForDevice(design, "mobile")`, o que se vê é o que se edita); arrastar um solto, as alças, as setas e **Alinhar no pop-up** gravam só no celular (`devices.mobile`, criando a entrada; um passo por gesto); arrastar um elemento da sequência muda a ordem, que é uma só nos dois aparelhos (o lugar sai do desenho do celular, e a etiqueta `Muda também no computador` e a frase `A ordem muda também no computador.` avisam, L29); trocar o aparelho diz `Editando o Celular.` ou `Editando o Computador.`; o selecionado com valores próprios do celular ganha a etiqueta `Celular` ao lado do nome.
- **Elementos**: clicar (ou Enter) num botão acrescenta como sempre. Arrastar o botão até o desenho (desde o L4a, §13.9; com o mouse, a partir de 4 px) põe o elemento onde foi solto: uma ficha com o ícone e o nome segue o ponteiro, e o desenho mostra a linha de onde ele entra (ou, na Forma e no Degradê, o retângulo do solto novo). A Forma entra com o centro no ponto, o Degradê com o meio na altura do ponto e o resto no vão da sequência, com as regras de 20 por caixa e da profundidade; depois, o mesmo caminho do clique (selecionado, o foco no painel da direita e a frase `Texto adicionado.`). Soltar fora do pop-up ou apertar `Esc` não acrescenta nada, e o botão desligado (no limite) não arrasta. Desde o L4b, com o ponteiro perto da borda da área de desenho, ela rola sozinha (L44). No topo do painel, a dica `Clique para acrescentar ou arraste até o lugar no desenho.`.
- **Camadas**: árvore na ordem de leitura, com etiquetas `Solta`, `Escondida`, `Travada`, `Celular` (o elemento tem valores próprios do celular, L3) e o aviso de algo para revisar; em cada linha **Esconder**, **Travar** e o menu `⋯` (Duplicar, Subir, Descer, Colocar dentro da caixa…, Tirar da caixa, Renomear, Excluir). Teclado: ↑/↓, →/←, Enter, Alt + ↑/↓, E, T, Shift + F10, Delete, Ctrl + D, F2; o Tab passa pela lista uma vez só. As etiquetas têm 12 px (nada abaixo disso no admin, `docs/17`) e quebram de linha quando não cabem lado a lado (são quatro desde o L3, com `Celular`). Links e Áudio não se excluem (`Os links ficam no desenho, mas cada um se tira em Conteúdo: desligue “Permitir Lembrar depois” ou “Mostrar Não mostrar de novo”.`; o contrato pede um Links, §9.6). **Arrastar a linha** (desde o L4a, §13.9): com o mouse, pelo nome da linha, a partir de 4 px. Numa caixa, o quarto de cima põe antes dela, o quarto de baixo põe depois e o meio põe dentro, no fim; numa linha que não é caixa vale a metade; abaixo da última linha é o fim do pop-up. Uma linha recuada no nível de destino mostra onde entra (no "dentro", o contorno da caixa), e um lugar recusado mostra o motivo. Soltar é um passo: o elemento fica selecionado e o foco fica na linha dele; soltar no mesmo lugar só seleciona, como um clique. Travados e escondidos também se arrastam. O `⋯` › **Tirar da caixa** fica desligado com `Use até 20 elementos dentro de uma caixa.` quando a caixa de fora está cheia, e depois de Subir, Descer, Colocar dentro ou Tirar pelo `⋯` o foco volta à linha movida. **Escolher vários** (desde o L4b, L36 e L37): Ctrl ou ⌘ + clique põe ou tira a linha; Shift + clique pega o intervalo entre irmãos desde a âncora (o último elemento escolhido sem ser por intervalo; sem âncora, ou com pais diferentes, só acrescenta); Shift + ↑/↓ estende pelo teclado e Ctrl ou ⌘ + Enter põe ou tira. As outras linhas escolhidas ganham a etiqueta `Na seleção` (12 px, lida pelo `aria-describedby` da linha) e o `aria-current` fica só no principal (o último escolhido). E, T, Delete e Ctrl + D numa linha que está numa seleção de 2 ou mais agem em todos, num passo, com a frase dizendo quantos; o olho, o cadeado, o `⋯` (Duplicar e Excluir também), F2 e Alt + ↑/↓ agem só na linha (C17). O arrastar da linha não começa com Shift, Ctrl, ⌘ ou Alt, e a lista rola sozinha perto da borda (L44).
- **Painel da direita**: **Conteúdo / Estilo / Avançado / Celular** do elemento (detalhes no `docs/17` §1.8.2 e na spec; a aba **Celular** e o grupo **No celular** do Pop-up na §13.8), ou **Pop-up** sem seleção, ou **Revisar**, ou, com 2 ou mais escolhidos, **Vários** (desde o L4b, §13.10: duplicar, excluir, esconder, travar, camada, alinhar e distribuir). Campos de número com arrastar no rótulo, setas (Shift = 10) e a frase do limite; cor como no Personalizado, com a **Opacidade 0–100 %** ao lado da cor (`docs/26` §2.2: 100 % grava os 6 dígitos; o código de 8 dígitos continua valendo; o nome acessível é `{rótulo}: opacidade`, sem rótulo visível, para não se confundir com a Opacidade de Estilo › Efeitos). Em **Links › Conteúdo** (§13.7): a chave **Permitir “Lembrar depois”** (a mesma do card "Quantas vezes e como fecha", `campaigns.allow_snooze`; ligada: `Volta em {1 dia}, até 2 vezes.`; desligada: `Sem “Lembrar depois”, o pop-up volta só pela regra de “Quantas vezes”.`), a chave **Mostrar “Não mostrar de novo”** (`dismiss` do Links; desligada: `O aluno continua fechando pelo X.`) e **Espaço entre os links**; a prévia perde o link na hora. No **Fundo** (no Estilo de cada elemento e no painel Pop-up), com 2 ou 3 camadas, entra no topo a faixa **Ordem** (desde o L4a, §13.9): uma ficha por camada, que se arrasta ou anda com Alt + ↑/↓, com o foco seguindo a camada (também no Subir, no Descer e no Tirar dos cartões). Mudar a ordem, tirar ou acrescentar uma camada é um passo próprio no histórico, e a cor continua juntando; enquanto uma imagem da lista sobe, a faixa e os botões da lista ficam desligados.
- **Revisar** confere também o botão do aviso que o Livre edita no Botão principal, com a mesma regra do salvar e as frases do Personalizado (`cta.href`, por exemplo `Escolha para onde o botão leva.` no "Saiba mais" de um modelo, e `cta.label`): o item leva ao "Para onde leva" (ou ao texto) no Conteúdo do Botão principal e some ao preencher, e o Revisar, o salvar e o `{n} problemas para revisar` do card contam sempre os mesmos erros.
- **Envios**: imagem de qualquer proporção (JPG, PNG ou WebP, convertida no navegador para WebP de até 1.600 px e 420 KB, transparência mantida) por `uploadPopupFreeImage`; vídeo pelo envio do Personalizado (direto ao Storage), com a capa tirada de um quadro do arquivo local; fontes pela biblioteca do Personalizado.

## 3. Dados

- Coluna `campaigns.popup_design` (migração `202610230001`, sem migração nova): o Personalizado é o objeto sem `mode`; o Livre, `{ "mode": "free", "version": 1, ... }`. O check do banco (objeto com `version`, só pop-up, `pg_column_size` até 32 KB) vale para os dois; o zod do Livre limita por uma estimativa do jsonb (até 30.000 bytes) e a 32 elementos (§9.5).
- **Rascunho do aviso** (`NoticeDraft`): `freeDesign` ao lado de `design`. O editor do aviso manda **sempre as duas chaves** (no máximo uma não nula, `Escolha um design só.`). Ao salvar, a **regra das duas chaves**: um pedido com uma só das chaves (mesmo nula) zera a outra; com as duas, vale como veio; sem nenhuma, fica o gravado. Assim uma aba do admin aberta antes do deploy (que só manda `design`) troca o Livre gravado em vez de gravá-lo de novo por baixo. Gravar: `popup_design = freeDesign ?? design ?? null`.
- **Pop-up do aluno** (`PopupItem`): `freeDesign` (sem `locked` e `name`, que são só do editor) e `fonts`; `title` = o texto do primeiro Título (ou o Nome do pop-up), `body` = o primeiro Texto, `image` e `icon` nulos (uma aba do aluno com o código antigo, no meio do deploy, mostra o cartão Padrão com o texto de verdade). **Plano** (`PopupPlanItem`): `design: "free"` só nos Livres. Cache da lista no ar com a chave nova `["communications-live-popups", "design2"]`.
- **Campos do aviso no Livre**: `title` = Nome do pop-up; `body`, `icon` e `image` guardados mas não aparecem (voltar a Padrão devolve; a imagem do nosso bucket pode virar capa do Vídeo de um modelo); `cta` = o Botão principal; `audio` = o elemento Áudio; `allowSnooze` = o "Lembrar depois" dos links e do botão.
- **Arquivos**: imagens em `content-assets/communications/free/<24 hex>.webp` (enviadas no editor) ou `communications/images/` (a do aviso, reaproveitada); vídeo em `communication-popup-video/videos/<uuid>.<mp4|webm>`. O design guarda só o caminho; o endereço é montado na hora (§4). Arquivos que ficaram sem uso saem do Storage 30 dias depois, pelo job diário da limpeza (`docs/22` §4.6; todo `assets[].path` de um Livre não excluído conta como uso).
- Auditoria: `popup_design: "free" | "custom" | "default"` (nunca o conteúdo) e `communication.free_image_uploaded` (`{ height, size_bytes, width }`).
- O formato completo do JSON (campos, padrões, limites, regras e exemplos testados) está na §9.

## 4. Segurança

- **Texto** sempre como texto do React (escapado). Nada de `dangerouslySetInnerHTML`, `innerHTML`, `cssText`, `<style>` nem `style` em texto no cartão Livre, no `member-popup*` e no editor (guardas em `popup-livre.guard` e no teste do editor).
- **CSS só de valores validados** (hex, números com limite, listas fechadas). As únicas strings montadas são gradientes, sombras, máscaras, `rotate()`, `translate()` (só na prévia do arrastar), `sizes` e `url()`. O `url()` **nunca** usa texto do design: é `freeAssetUrl` = a origem do nosso Supabase (de `NEXT_PUBLIC_SUPABASE_URL`, conferida uma vez por `freeStorageOrigin`: https, ou http só na própria máquina, sem usuário, senha, caminho, query ou fragmento, máquina só com `[a-z0-9.-]`) + o caminho público do bucket + um caminho que casou com o padrão do tipo. Um design colado, gerado por IA ou ainda não salvo não consegue abrir um `url()` para fora nem sair das aspas (teste com origens maliciosas).
- **Zod estrito** no navegador, na Server Action e na leitura; chave a mais recusa (inclusive `url` num arquivo e qualquer chave em `devices` fora da §9.10); Livre inválido no banco não aparece para o aluno. Os valores do celular só trocam números e listas fechadas que já passaram pelo mesmo zod (nenhuma cor, texto, pintura ou arquivo tem versão do celular), então o cartão do celular monta o CSS pelos mesmos caminhos do computador; escolher o aparelho no aluno lê só a largura da tela (`matchMedia`), nada do design.
- **Storage**: só os dois buckets e os padrões de caminho acima; arquivo novo conferido pelos bytes ao salvar (`inspectFreeImage`: existe, até 420.000 bytes, primeiros 64 bytes WebP com as medidas do cabeçalho, que substituem as do navegador; vídeo pela conferência do Personalizado); arquivo que a linha gravada (ou um modelo de onde o aviso veio, `docs/28` D16) já usa conta como conferido. **O salvar nunca apaga** (desde 25/10/2026): o arquivo novo recusado recebe o erro no campo e fica no bucket para a limpeza de 30 dias. Envio só para a equipe com `messaging.write`.
- **Links**: o botão "Abrir um link" segue a regra do botão principal (página da área, produto ou https); até 3 desde o L4b (dentro dos 3 botões além do principal, L45); `rel="noopener noreferrer"` em nova aba. O botão clicado que o navegador manda (`cta` ou `link:<id>`) só é gravado depois de conferido pela forma e contra o design no ar, num módulo só do servidor (L47; `docs/25` §5.1).
- **Contra pop-up que engana**: o X sempre existe, por cima de tudo, sempre visível (alfa do ícone ≥ `cc` e contraste ≥ 3:1 com o fundo dele: erro que impede salvar) e o `Esc` sempre fecha; decorativos não recebem clique; texto por cima de botão gera a dica de cobertura; a prancheta corta o que passa dela. Esconder "Não mostrar de novo" não tira nenhum jeito de fechar.
- **Abuso e peso**: até 32 elementos, 6 imagens de 420 KB, 1 vídeo de 15 MB, desfoque em até 4 elementos, teto de tamanho do JSON; o cartão do aluno não baixa nada antes de abrir.
- **Recuperação no navegador** só na máquina de quem edita, só o design e o `cta`, lida com o mesmo zod e apagada ao salvar. **Auditoria** só com códigos, ids, tamanhos e o tipo do design. **CSP** sem mudança.

## 5. Por dentro

- **Módulos puros** (imports relativos; os testes carregam pelo Node): `popup-free-model.ts` (tipos, limites, forma canônica, árvore, estimativa do jsonb, reescala, item de prévia; **sem zod**), `popup-free-render.ts` (o único módulo de valores que o cartão do aluno importa: padrões, escala, o design do aparelho `resolveFreeForDevice` (os valores do celular por cima do computador, §9.10), leituras do design, nome do diálogo, o D9 nos dois aparelhos `freeHasClickTarget`, origem e endereço dos arquivos), `popup-free-schema.ts` (zod, mensagens, regras com o conteúdo, chaves de erro), `popup-free-json-schema.ts` (o JSON Schema, que nenhuma tela importa, §7), `popup-free-starters.ts` (os 4 modelos, `freeFromCustomDesign`, elementos novos, sincronia com o conteúdo), `popup-free-checks.ts` (as dicas do Revisar, a dica "texto no celular" e o medidor), `popup-free-paste.ts` (L1.1: o texto de "Copiar o design" e a leitura do "Colar o design"), `popup-design-router.ts` (leitura da coluna). Servidor: `popup-free-assets.ts` (`server-only`) e `popup-free-actions.ts` (`uploadPopupFreeImage`).
- **Do banco ao aluno**: a lista no ar lê pelo roteador; o Livre passa por `freeDesignForStudent`; as fontes de todos os pop-ups numa consulta; o plano marca `design: "free"`. O host baixa a janela e o pedaço do cartão Livre **antes** do `POST /show` quando o plano diz Livre (se o `show` trouxer um Livre que o plano não marcou, a janela espera o pedaço).
- **Cartão** (`src/components/member/notifications/popup-free/`): `popup-free-card.tsx`, `popup-free-nodes.tsx` (um `switch` por tipo, `data-free-id` num elemento só), `popup-free-media.tsx`, `popup-free-styles.ts` (todos os objetos de estilo, puro), `popup-free-icons.tsx` (24 ícones), `popup-free-load.ts` (a única porta do pedaço), `popup-free-device.ts` (o aparelho pela largura da tela: `matchMedia("(max-width: 767px)")` lido por `useSyncExternalStore`, que o cartão e a janela do pop-up ouvem juntos; no servidor, o computador; sem imports, entra na janela sem puxar o cartão). `MemberPopupCard` despacha `freeDesign` → `PopupFreeCard` por `React.lazy` (o mesmo pedaço próprio do `next/dynamic` da spec, carregável pelo Node nos testes); senão `design` → `PopupDesignCard`; senão o cartão de sempre (HTML do Padrão e do Personalizado comparado com o de antes do Livre).
- **Editor** (`src/components/admin/v2/communication/popup-free/`): casca e palco (`free-editor.tsx`, `free-canvas.tsx`, `free-elements-panel.tsx`, `free-layers-panel.tsx`, `free-review-panel.tsx`, `free-editor-model.ts`, `free-editor-history.ts`, `free-editor-geometry.ts`, `free-editor-recovery.ts`; desde o L4a, `free-pointer-drag.ts`, o gesto de arrastar, §13.9; desde o L4b, `free-editor-selection.ts`, a seleção de vários e os comandos de vários, puros, e `free-zoom-control.tsx`, o zoom da barra, §13.10) e painel da direita (`free-inspector*.tsx`, com o painel Vários em `free-inspector-many.tsx` desde o L4b, `free-artboard-settings.tsx`, `free-fields.tsx`, `free-assets.ts`, `free-inspector-model.ts`). O card Design (`popup-design/popup-design-field.tsx`) carrega o editor com `next/dynamic` e passa o contrato `FreeDesignEditorProps` (spec §9.6), mais `undoTo` (o design de antes do **Trocar de modelo**). O editor do aviso (`notice-editor.tsx`) guarda o rascunho, passa `onSaveDraft` (o salvar sem os toasts dele, devolvendo os erros) e adia o `openSavedNotice` enquanto o editor Livre está aberto.
- **Erros**: os do zod chegam com índices (`freeDesign.children.3.lines.0.1.text`) e passam por `freeErrorKeys` (`freeDesign.nodes.<id>.lines.0.1.text`, estável se a ordem mudar) no navegador e nas respostas do servidor; os erros lançados pelo servidor já vêm nesse formato. Fora do editor, um erro do Livre (ou do Botão principal no Livre) leva o foco ao `{n} problemas para revisar`.

## 6. Rotas e ações

| Rota / ação | O que faz |
|---|---|
| `uploadPopupFreeImage({ image })` (`popup-free-actions.ts`) | data URL WebP (o editor converte) → `{ asset: { height, kind: "image", path, width } }` (sem endereço; o id do arquivo é do editor); `Envie a imagem como WebP.` / `A imagem precisa ter de 16 a 1.600 px de cada lado.` / `A imagem ficou grande demais. Use uma menor.`; 403 sem `messaging.write`; auditoria `communication.free_image_uploaded` |
| `startPopupVideoUpload` / `finishPopupVideoUpload` | os do Personalizado (`docs/26` §6), reaproveitados pelo Vídeo do Livre |
| Fontes (`POST /api/admin/communications/popup-fonts`, renomear, excluir) | as do Personalizado; uma fonte usada só por um Livre não deixa excluir (409) |
| Salvar (`saveNoticeDraft`) | regra das duas chaves; `withCheckedFreeDesign`: regras com o conteúdo do aviso (400 no campo), fontes na biblioteca, arquivos novos conferidos e medidas das imagens trocadas pelas do servidor; recusa em `freeDesign.assets.<id>` (`Envie a imagem de novo.` / `Envie o vídeo de novo.`) |
| Publicar / aprovar | conferem de novo as fontes do que está gravado (Livre ou Personalizado) |
| Duplicar | copia `popup_design` como está (o Livre vai junto) |
| `POST /api/popups/[id]/show` e o plano | o Livre do aluno (§3); 404 para Livre inválido |

## 7. Desempenho

O cartão Livre fica num pedaço próprio, baixado só quando o pop-up armado é Livre; o editor Livre só é baixado no admin, ao abrir. Medido com `next build` (Turbopack, gzip, o mesmo `.env.test.local` nas duas árvores), `origin/dev` (e555188) × esta entrega, com o método do `docs/26` §7 (`scratchpad/v3/livre/s-tools/measure-livre.mjs`):

| | `origin/dev` | esta entrega | diferença | limite da spec |
|---|---|---|---|---|
| JS inicial do Início (`/`) | 297.383 B | 297.616 B | **+233 B** | +200 B |
| JS inicial da página do produto (`/conteudo/[id]`) | 286.547 B | 286.763 B | **+216 B** | +200 B |
| pedaço da janela do pop-up (o `import()` do host, 3 arquivos) | 22.072 B | 22.272 B | **+200 B** | +300 B |
| pedaço do cartão Livre (`loadPopupFreeCard`, só para pop-up Livre) | — | 9.838 B | | 12 KB |
| pedaço do cartão Livre com o Celular (PR L3: `resolveFreeForDevice`, o aparelho pela largura da tela e o nome do diálogo pelo aparelho; base 55a8cc0) | 10.030 B | 10.280 B | **+250 B** | 12 KB |
| pedaço do editor Livre (só ao clicar em **Abrir editor Livre**) | — | 63.312 B | | baixado só ao abrir |
| JS inicial do editor do aviso no admin (`/admin/comunicacao/avisos/[id]`) | 608.760 B | 629.725 B | +20.965 B | sem limite |

- **Celular (PR L3)**: a linha do Celular foi medida do mesmo jeito (`next build`, gzip padrão, as mesmas variáveis públicas nas duas árvores), seguindo do manifesto do Início (`/`) até o arquivo do cartão pelo `import()` da janela e o do cartão: o commit-base 55a8cc0 (já com o L1.1 e o L1.2, por isso acima dos 9.838 B do L1) × o cartão que desenha o celular. Os +250 B são `resolveFreeForDevice` (que antes só o editor usava), a leitura da largura da tela e o nome do diálogo pelo aparelho; nada do schema nem do modelo entrou.
- zod, `popup-free-model.ts`, os modelos, as dicas e o schema **não** estão no pedaço do cartão Livre (conferido por texto e pela guarda `popup-livre.guard`); o cartão Livre não está no JS inicial nem na janela do Padrão/Personalizado.
- **Por que o JS inicial passou do combinado em ~30 B**: o próprio Livre no aluno custa ~+128 B (a marca `design: "free"` do plano e o despacho, medidos pelo pacote S). O resto vem de pedaços **compartilhados** que o build monta pelo uso no app inteiro, não por tela: o objeto de "motivos" do Base UI (que o Início já baixa pelo Dialog) ganhou as constantes do `NumberField` e das `Tabs` usados só no editor Livre do admin (`scrub`, `wheel`, `input-*`, `initial`, `missing`: ~110 B), e o mesmo efeito, maior, aparecia no zod. No fechamento, duas correções tiraram ~900 B gzip do Início: o JSON Schema do "Criar com IA" foi para um módulo próprio que nenhuma tela importa (`popup-free-json-schema.ts`; o `z.toJSONSchema` puxava para o pedaço do zod os conversores de todos os tipos) e o schema do Livre deixou de usar `z.tuple` (listas de tamanho fixo com `z.array(...).length(n)`, mesma validação e mesmas frases). Sobram os ~110 B do Base UI, que só sairiam trocando os campos de número e as abas do editor (escolhidos na spec §4.12); ficou registrado em vez de trocar componente no fechamento. Um teste (`popup-livre-modelo`) garante que só o módulo próprio chama `toJSONSchema` e que nenhuma tela o importa.
- O editor do aviso no admin cresce ~21 KB no JS inicial: o card Design passa a carregar o schema, os modelos e o modelo do Livre (validação no navegador, miniaturas, resumo e problemas). A miniatura usa o `MemberPopupCard` (o cartão Livre continua no pedaço próprio).
- Imagens e vídeo vêm do Storage, nunca do servidor do app; com menos movimento ou economia de dados o vídeo não é baixado; a fonte enviada só baixa quando o pop-up abre. O servidor faz um `safeParse` a mais por pop-up Livre no ar, uma vez a cada 60 s (cache), sem consulta nova.

**L4b (25/10/2026, §13.10).** Medido com `next build` (Turbopack, gzip padrão, sem `.env` nas duas árvores), o L4a (20fb1ab, a `dev`) × o L4b (d7fd7ac). JS inicial das páginas do aluno pelo método do `docs/29` §7.2 (soma dos `rootMainFiles` com os `entryJSFiles` do layout e da página, sem repetir arquivo); a janela, o grupo do `import()` do host que tem a janela; o cartão Livre, do manifesto do Início até o arquivo com `data-free-artboard`; o editor Livre, o grupo do `import()` do card Design que tem `data-free-editor`, menos o JS inicial da página do aviso (os `rootMainFiles` com todos os `entryJSFiles` dela):

| | L4a | L4b | diferença | limite |
|---|---|---|---|---|
| JS inicial do Início (`/`) | 300.940 B | 300.975 B | +35 B | `docs/29` §7.2 |
| JS inicial de Favoritos | 284.710 B | 284.736 B | +26 B | `docs/29` §7.2 |
| JS inicial da Aula | 394.948 B | 395.000 B | +52 B | `docs/29` §7.2 |
| pedaço da janela do pop-up (3 arquivos) | 22.796 B | 22.805 B | +9 B | +300 B |
| pedaço do cartão Livre (só para pop-up Livre) | 10.307 B | 10.362 B | +55 B | 12 KB |
| pedaço do editor Livre (só ao abrir) | 52.367 B | 61.668 B | +9.301 B | baixado só ao abrir |
| JS inicial do editor do aviso no admin (`/admin/comunicacao/avisos/[id]`) | 714.298 B | 716.632 B | +2.334 B | sem limite |

- O aluno paga só o botão clicado (L47): o cartão passa `cta` ou `link:<id>` ao `onCta`, a janela e o host levam ao `postPopupEvent` (que fica no JS inicial, por isso as dezenas de bytes nas três páginas), e a conferência mora num módulo só do servidor (`popup-clicked-button.ts`, `server-only`): nenhum arquivo de `.next/static` tem ela (crítica C4). O cartão Livre ganha a prévia de vários (`ids` no `dragPreview`) e o terceiro argumento do `onCta`; o HTML do aluno não muda.
- O editor Livre ganha a seleção de vários (`free-editor-selection.ts`), o painel Vários, o controle de zoom e o que cresceu no desenho, na casca, nas Camadas e no ponteiro. O JS inicial do editor do aviso cresce porque o card Design já carrega `free-editor-model.ts` (as frases e o modelo do Livre, para o resumo e os problemas), que ganhou as frases do zoom, as 5 linhas novas dos Atalhos e as teclas de vários das Camadas.
- As linhas do L1 (63.312 B do editor e 629.725 B da página do aviso) foram medidas de outro jeito e não se comparam com estas; a comparação do L4b é só L4a × L4b, pelo mesmo método nas duas árvores.
- **Ruído da compilação**: na mesma pasta, compilar de novo a mesma árvore dá os mesmos bytes; em pastas diferentes, não (os nomes dos pedaços mudam). O L4a compilado três vezes, em pastas diferentes, deu no JS inicial de 300.940 a 300.954 B no Início, de 284.710 a 284.732 B em Favoritos e de 394.948 a 394.971 B na Aula; a janela, de 22.796 a 22.797 B; o cartão, de 10.303 a 10.307 B; o editor Livre, de 52.356 a 52.373 B; e a página do aviso, de 714.298 a 714.386 B (até cerca de 90 B). As diferenças das páginas do aluno (+26 a +52 B) e da janela (+9 B) ficam dentro desse ruído: o que vale é a ordem de grandeza, dezenas de bytes. O cartão (+55 B), o editor Livre e a página do aviso passam dele. (O que muda entre pastas é a raiz do Turbopack, explicada no L6 abaixo.)
- Depois das correções da conferência do L4b (o desfazer e o refazer com a seleção viva, o **Voltar ao elemento** do Revisar e o D9 gravado ao publicar e aprovar), na mesma pasta do L4b: o pedaço do editor Livre foi para 61.809 B (+141 B) e o JS inicial da página do aviso para 716.633 B (+1 B); o JS inicial de Início, Favoritos e Aula, a janela e o cartão não mudaram (300.975, 284.736, 395.000, 22.805 e 10.362 B), porque a parte do D9 fica só no servidor.

**L6 (26/10/2026, §13.11): o teto do cartão e a régua.** O pedaço do cartão Livre tem um teto de **12 KB = 12.288 B gzip**, travado desde o L6a (L50): o `npm run verify` termina com `npm run livre:medir` (`scripts/livre-medir-cartao.mjs`, depois do `next build`), que imprime o cartão, a janela e o JS inicial do Início e sai com erro acima do teto. O CI roda o verify, então uma PR que passa do teto fica vermelha. É o método das linhas do L3 e do L4b acima, agora no repositório:

- começa nos arquivos que o manifesto do Início cita e segue as referências de arquivo em arquivo (o `import()` do host que traz a janela, o da janela que traz o cartão); um pedaço velho que nenhum arquivo cita (de um build anterior na mesma pasta) não conta;
- o cartão é o único arquivo alcançado, fora do JS inicial, com `data-free-artboard` e sem `data-free-editor`; nenhum ou mais de um é erro (`Não achei um pedaço só do cartão Livre (N).`), a régua não chuta;
- soma o arquivo do cartão, os pedaços que vêm no mesmo `import()` e os que só ele alcança, menos o que o Início baixa sem passar por ele (crítica C11): separar um pedaço do cartão, como o plano B do contador no L6f, não o tira da régua. Hoje o cartão é um arquivo só;
- gzip no nível padrão, arquivo por arquivo. Para conferir, imprime também a janela (o grupo do `import()` do host com o arquivo que tem `loadPopupFreeCard`) e o JS inicial do Início pelo `docs/29` §7.2; esses dois não têm trava;
- cada página tem a sua cópia do cartão, e a régua mede a do Início. No build do L6a, os arquivos com o cartão vão de 7.456 a 10.465 B; o maior fica 77 B acima do do Início, dentro da folga.

**Cotas por entrega** (a soma leva o cartão a cerca de 12.080 B; o resto é a reserva):

| Entrega | Cota | Medido |
|---|---|---|
| L6a: consertos e régua | +40 B | +26 B (10.362 → 10.388 B) |
| L6b: contorno e marca-texto | +220 B | |
| L6c: cores ao passar o mouse | +250 B | |
| L6d: animação de entrada | +200 B | |
| L6e: textura e mistura | +260 B | |
| L6f: contador (com o plano B, `React.lazy` só do contador, se passar da cota) | +700 B | |
| L6g: texto escrito no desenho | +60 B | |

A entrega que passar a sua cota em mais de 25 % encolhe antes do merge ou pega da reserva, escrito nesta tabela. Cada uma mede o antes e o depois **na mesma pasta** (o número muda quando muda a raiz do Turbopack, logo abaixo) e escreve aqui a sua linha, com o CSS global junto.

**O que muda com a pasta** (conferido no L6a): só a raiz do Turbopack. O `next.config.ts` (`getTurbopackRoot`) sobe a raiz até a pasta que contém o `node_modules` de verdade. Num worktree em `.claude/worktrees/`, cujo `node_modules` é um link para o do checkout principal, a raiz vira o checkout principal e os caminhos dos módulos ganham o prefixo do worktree, o que muda os números dos módulos e os bytes: o `src/` da `dev` deu, num worktree, 10.342 B no cartão, 22.790 B na janela e 301.021 B no JS inicial, contra 10.362, 22.805 e 300.975 B fora dele. Um checkout com `node_modules` próprio, como o do CI, dá os mesmos bytes em qualquer pasta: o L6a juntado (6155984), compilado numa pasta à parte com `node_modules` próprio, deu os mesmos 10.388, 22.802 e 300.977 B, o mesmo nome do pedaço do cartão e o mesmo CSS (md5) do checkout principal. O CI deve dar, então, exatamente os números da linha do L6a. Medir o antes e o depois na mesma pasta continua a regra: num worktree, os dois números saem com a mesma raiz.

**L6a** (§13.11.1), medido com `npm run build` (Turbopack, gzip padrão, sem `.env` nas duas árvores) e a régua, as duas árvores compiladas uma depois da outra na mesma pasta: a `dev` de antes (ebdb59f, igual à `main` depois da promoção #124) × o L6a juntado (6155984) e, no CSS, o L6a com o conserto dos exemplos (321b15f, abaixo), que não muda nenhum JS. O L6a compilado de novo deu os mesmos bytes. O CSS do Início é a soma dos 2 arquivos que o manifesto dá ao layout e à página `/`.

| | `dev` (ebdb59f) | L6a | diferença | limite |
|---|---|---|---|---|
| pedaço do cartão Livre | 10.362 B | 10.388 B | **+26 B** | cota +40 B; teto 12.288 B (folga de 1.900 B) |
| pedaço da janela do pop-up (3 arquivos) | 22.805 B | 22.802 B | −3 B | +300 B |
| JS inicial do Início (`/`) | 300.975 B | 300.977 B | +2 B | `docs/29` §7.2 |
| CSS do Início (2 arquivos) | 49.232 B | 49.252 B | +20 B (+82 B sem gzip) | medido, sem trava |

- A `dev` de antes dá exatamente os números do L4b (10.362, 22.805 e 300.975 B): o cartão, a janela e o JS inicial não mudaram desde a conferência do L4b. Os +26 B do cartão são os Links (a linha só quando escolhida e, em degradê, a cor da linha) e a classe do anel de foco, mais longa (a do aperto tem o mesmo tamanho de antes); medido sozinho nos worktrees onde foi feito, com a raiz do Turbopack no checkout principal (acima), o conserto do cartão deu +25 B (10.342 → 10.367 B: a régua no `.next` do worktree da régua, 9df96e8, com o `src/` da `dev`, e no do worktree dos consertos, 77045ec). A janela fica 3 B menor porque a transição da escala tem um nome mais curto que a de antes; os +2 B do JS inicial ficam no ruído.
- **CSS**: os consertos trocam 2 regras por 3 (a transição do aperto, a da janela e o anel com `!important`) e dão +82 B sem gzip (+20 B gzip). O L6a juntado (6155984) dava 49.302 B (+767 B sem gzip): os outros +685 B sem gzip (+50 B gzip) eram 5 regras que nenhum componente usa, porque o Tailwind 4 lê todo arquivo que não está no `.gitignore` (inclusive `tests/` e `docs/`) e gera regra para cada classe escrita como exemplo; um comentário e três linhas de exemplo da guarda `popup-design.guard` e dois comentários (em `popup-free-styles.ts` e em `popup-livre-desenho`) viraram regras, uma delas inválida (reticências no lugar da lista de propriedades). O conserto (321b15f, §13.11.1) troca esses exemplos e põe uma guarda: as 5 regras saíram (337.388 B sem gzip nos 2 arquivos, contra 338.073 B), e o cartão, a janela e o JS inicial ficaram iguais.

## 8. Decisões

| # | Decisão | Por quê |
|---|---|---|
| L1 | Livre na mesma coluna, com `mode: "free"`, e a chave `freeDesign` separada de `design` no rascunho e no `PopupItem` | sem migração; o código do Personalizado fica intocado; os pacotes paralelos não brigaram pelos arquivos dele |
| L2 | Regra das duas chaves ao salvar, conferida de novo depois da junção | uma aba antiga do admin (só `design`) troca o Livre gravado em vez de gravá-lo por baixo |
| L3 | O design guarda só caminhos; o endereço sai de `freeAssetUrl` com a origem conferida | nenhum texto do design entra num `url()` (o `img-src` aceita `https:`) |
| L4 | No celular, o pop-up inteiro encolhe (`cqw`), com texto ≥ 12 px e toque de 44 px; o PR L3 entregou os valores por aparelho (`devices.mobile`, §9.10 e §13.8, L27): o que não tem valor próprio continua encolhendo assim | decisão do produtor (pergunta 1 da spec): um desenho só, legível; o L3 dá o ajuste fino por elemento sem um segundo desenho |
| L5 | 32 elementos e estimativa do jsonb ≤ 30.000, sem migração; o medidor fica sempre no Revisar | o check de 32 KB mede o jsonb sem compressão (~21 KB de JSON de verdade); mudar a migração aplicada é proibido |
| L6 | O cartão Livre num pedaço próprio, baixado antes do `show` quando o plano diz Livre | sem o código nada abre e nada conta como visto; Padrão e Personalizado não pagam pelo Livre |
| L7 | `React.lazy` em vez de `next/dynamic` no `MemberPopupCard`, e o host baixa o cartão pela janela | o `next/dynamic` não carrega no Node (quebrava os testes do Personalizado); o `import()` direto duplicava ~13,6 KB gzip da janela no pedaço do Livre |
| L8 | Salvar de dentro do editor não fecha o editor; num aviso novo, a troca de endereço espera o **Concluir** sem mudança depois do último salvar | trocar de endereço remonta a página e levaria histórico, seleção e zoom |
| L9 | **Trocar de modelo** abre o editor com o design de antes um passo atrás (`undoTo`) | a frase combinada promete "Dá para desfazer no editor"; o editor começava cada abertura sem passado |
| L10 | O editor Livre só em telas a partir de 1.024 px; abaixo, só a prévia | decisão do produtor; três colunas e alças precisam de espaço |
| L11 | Escolher Livre (ou Personalizado) sem modelo deixa o rascunho sem design até escolher um modelo | igual ao Personalizado de antes: a prévia não muda antes da escolha |
| L12 | `{n} problemas para revisar` conta só os erros que impedem salvar (do design e do Botão principal), não as dicas | a dica "texto no celular" aparecia nos três modelos (Links de 13 px e Selo de 12 px viram 12 px no celular): contar dicas deixaria o card sempre com um "problema". Desde o L1.1 a dica só aparece quando o piso muda o encaixe (L18) e nenhum modelo a acende; a contagem continua só com os erros |
| L13 | Sem `z.tuple` no schema e o JSON Schema num módulo que nenhuma tela importa | o zod é um pedaço compartilhado com o JS inicial do Início e o build inclui ali toda classe e todo conversor do zod usados em qualquer tela; os dois custavam ~0,9 KB gzip a todo aluno (§7) |
| L14 | Copiar e colar o design no L1.1; "Criar com IA" no L2 | decisões do produtor (perguntas 2 e 3 da spec) |
| L15 | Em "Outro estilo na seleção", a divisão da parte só entra quando um estilo é escolhido; "Linha no texto: Nenhuma" numa parte não tira o sublinhado do elemento inteiro | dividir sem estilo seria um passo invisível no histórico; o tipo da parte só aceita sublinhado ou riscado (fica para quando ganhar "nenhuma") |
| L16 | Com o pop-up no ar ou pausado, o salvar de dentro do editor Livre fala como o editor do aviso: o botão **Salvar alterações** e, depois, a mesma frase do toast dele (`savedNoticeToast`, devolvida em `message`); o "Mostrar de novo para quem já viu" ligado não vai nesse salvar e continua ligado para o salvar do aviso. Rascunho: **Salvar rascunho** / `Rascunho salvo.`, como antes | o salvar do Livre no ar chega aos alunos em até 1 minuto, mas dizia "Rascunho salvo." e aplicava o "Mostrar de novo" sem mostrar quantos voltam a ver |
| L17 | No **Recarregar** depois de um 409, `design` e `freeDesign` são um campo só: mexeu em um dos dois aqui, ficam os dois daqui; senão, os dois do banco | campo a campo, o Personalizado daqui juntava-se ao Livre de outra tela: salvar recusava com `Escolha um design só.` e voltar ao Personalizado apagava o que foi editado |
| L18 | A dica "texto no celular" só aparece quando o piso de 12 px muda o encaixe: Título, Texto ou Selo com mais linhas, texto do botão cortado, Links que passam a quebrar ou uma Caixa em linha que deixa de caber (uma dica por elemento, §13.4) | a regra de antes (tamanho × 343 ÷ largura < 11,5) acendia em todos os modelos e virou barulho; o que importa ao produtor é o texto mudar de lugar, não ficar 2 px maior. É uma estimativa da largura das letras (o servidor não mede), então fica como dica, nunca como erro |
| L19 | **Colar o design** só fica com os arquivos que este pop-up conhece (o design aberto e todo o histórico do editor); os outros saem e o elemento fica com `asset: null` | um caminho de outro aviso passaria na conferência do salvar (o arquivo existe) e o salvar apaga o vídeo novo que não passa na conferência, que podia ser o de outro aviso; e a IA inventa caminhos. Enviar de novo é um clique no elemento vazio, que o Revisar aponta |
| L20 | As instruções para a IA são um arquivo gerado do §9 (`npm run livre:instrucoes`, com teste de igualdade), baixado só ao abrir **Copiar e colar** | o documento e as instruções nunca se separam; nada busca o docs na hora; o editor não carrega ~27 KB de texto antes de alguém pedir |
| L21 | **Colar** segue o aviso como os modelos: com áudio entra o Áudio (sem, sai), com botão entra o Botão principal que faltava, e o Botão principal colado num aviso sem botão cria o "Saiba mais" com o destino vazio | colar não apaga o botão que veio no design (o produtor colou de propósito), e é o comportamento já conhecido do **Usar este modelo** |
| L22 | **Usar o design Personalizado** é um ponto de partida à parte dos 4 modelos, só quando o aviso tem um Personalizado; a imagem no fundo do cartão vira camadas (escuro, imagem cabendo na largura, cor de apoio "clareada") | o resultado depende do aviso (não é um modelo fixo). No Livre o escuro cobre o cartão inteiro; clarear a cor de apoio na mesma conta deixa o resto do cartão com a cor de antes. "Parecido, não idêntico": a borda da imagem não some na cor de apoio como no Personalizado |
| L23 | O modelo **Imagem recortada com selo** com o selo de 128 px (o rascunho tinha 112), a coluna de texto de 256 px e os botões com quebra | com 112 px o "Aula bônus" quebrava em duas linhas no celular (a dica nova acendia no modelo); com a quebra ligada, um texto de botão longo desce para a linha de baixo em vez de apertar |
| L24 | **Usar o design Personalizado** com "Abaixo da mídia": o texto começa na altura exata da mídia (largura × proporção, sem arredondar antes) × (1 − subir) + respiro; o respiro de cima da prancheta vai até 200 e o que passa vira margem de cima do primeiro elemento na sequência (até 368, dentro dos 400 da margem) | o respiro de cima inteiro passava do teto de 200 sempre que a mídia, depois de subir, tinha mais de ~200 px (o modelo "Mídia no topo com degradê" no cartão G dava 217 e o schema recusava: 954 das 6.804 combinações do teste); a margem guarda o mesmo y sem mexer no schema. Um teste varre modelos, larguras, formatos, posições, subir, respiros, mídia e degradê pelo schema e pela conta do tamanho e confere o y com o do Personalizado (até 1 px) |
| L25 | Na conversão do Personalizado, o teto de 1.200 letras e o de 40 nos textos curtos cortam por letra (ponto de código, a mesma conta do schema), nunca no meio de um emoji | `slice` corta em unidades UTF-16: um emoji na fronteira deixava a metade solta, que o zod aceita mas o jsonb do banco recusa (erro do servidor ao salvar) |
| L26 | As instruções para a IA não levam detalhe de implementação: o que é só de quem mantém o código fica no §9 entre `<!-- ia:fora -->` e `<!-- /ia:fora -->` e o script tira; o tamanho vira um limite simples; Imagem e Vídeo novos sempre com `"asset": null` (os `assets` de um design mandado junto voltam como vieram); referências pelo nome da parte. O script para se sobrar `.ts`, banco, bucket, jsonb, `z.`, `§`, Storage ou um marcador | o texto vai para a conversa de um terceiro (o Claude ou o ChatGPT do produtor): nomes de arquivo, buckets, caminhos e o check do banco não ajudam a IA a escrever o design e expõem o que é interno; "§7" e "§9.5" apontavam para partes que a IA não recebe ou não reconhece |
| L27 | Celular (PR L3): o mesmo modo (solto ou na sequência) nos dois aparelhos; por aparelho só lugar, tamanho, texto (tamanho, altura da linha, espaço entre letras, alinhamento), esconder, respiro, cantos, a sequência da caixa e a prancheta (respiro, espaço, altura mínima): nunca cor, texto, pintura, sombra, camada ou girar; o aluno vê o celular numa tela de até 767 px (`matchMedia`, o cartão e a janela ouvindo o mesmo aparelho); um valor igual ao do computador fica enquanto o editor está aberto e a forma canônica tira ao salvar; sem migração e com `version: 1`; voltar à imagem de antes segue a nota do `docs/20` §9 (avisos e modelos com Celular ficam ilegíveis lá até a imagem nova voltar); o D9 conta um clique só quando ele é visível nos dois aparelhos | um desenho só, com ajuste fino por elemento (o L4); trocar o modo por aparelho ou as cores dobraria o editor e o Revisar; 767 px é a mesma regra das prévias de 375 px e do resto da área; a chave "Igual ao computador" não pode se ligar sozinha enquanto a equipe digita, e o gravado fica esparso; o `devices` é opcional e mora no mesmo jsonb (nada para migrar), mas o schema estrito da imagem de antes recusa a chave; um botão que o aluno do celular não vê faria "Quando o aluno clica no botão" nunca parar ali |
| L28 | O arrastar do L4a é um gesto por ponteiro próprio (`followFreePointer`, em `free-pointer-drag.ts`), o mesmo nas quatro frentes: ouvintes na janela, a captura do ponteiro só depois do limiar (6 px no desenho; 4 px nas Camadas, no Fundo e no Elementos), soltar só no `pointerup` (o `lostpointercapture` não grava), as teclas engolidas durante o gesto e o click de depois engolido. Não usa o arrastar nativo do HTML5 nem a biblioteca de arrastar do admin (`@atlaskit/pragmatic-drag-and-drop`, `docs/17` §2.2, usada na Vitrine e no Conteúdo). Só o mouse nas Camadas e no Elementos; mouse e caneta no desenho e na ficha do Fundo, que têm `touch-action: none`; o toque continua só tocando. Desde o L4b (L39), o arrastar e as alças do solto também passam por ele (a 3 px, com o mouse, a caneta e o dedo, decisão 5 do produtor), com as teclas Alt e Shift no `onMove` e a opção `autoScroll` (L44) | a biblioteca é feita sobre o arrastar nativo, e o Livre não cabe nele: o palco tem zoom (`transform: scale`) e o Celular desenha o cartão encolhido (343 px), então o lugar de soltar e o indicador saem das nossas contas em px da prancheta, e a imagem e o `DataTransfer` do navegador não acompanham essa escala; o gesto precisa de limiar próprio e da captura só depois dele, para o clique de selecionar, o clique de acrescentar e o duplo clique de editar texto (que lê o alvo do evento) continuarem iguais; o carregador dos testes do Node (`tests/support/transpile-tsx.mjs`) não resolve os caminhos do `@atlaskit` (`ERR_UNSUPPORTED_DIR_IMPORT`), e `free-fields.tsx` entra em vários testes do Node; nenhum ponta a ponta do repositório usa `dragTo` ou `DataTransfer`, e com os eventos de ponteiro os specs seguem os cuidados de sempre do WebKit. Sem `touch-action: none`, a caneta rola o painel e o navegador cancela o gesto. Trocar pelo padrão do admin traria esses problemas de volta |
| L29 | A ordem é uma só nos dois aparelhos: com **Ver como: Celular**, arrastar um elemento da sequência no desenho acha o lugar no desenho do celular (nas Camadas, a lista é a mesma nos dois), mas os dois gravam só a ordem em `children`, que vale para o computador e para o celular; nada vai para `devices.mobile` (só o solto que entra numa caixa perde a posição do celular, como no **Colocar dentro da caixa**). O indicador mostra a etiqueta `Muda também no computador` quando o soltar muda a ordem, e toda mudança de ordem com o Celular (arrastar, Subir, Descer, Colocar dentro e Tirar) termina a frase com `A ordem muda também no computador.`; Soltar e Seguir a sequência terminam com ela sempre, mesmo quando a ordem fica igual, porque o modo é um só nos dois aparelhos | o elemento do celular não tem ordem (L27: camada e ordem são do computador); uma ordem por aparelho dobraria as Camadas, a ordem de leitura e o nome do diálogo; sem a etiqueta e a frase, quem edita no Celular acharia que mudou só o celular (numa caixa em linha só no celular, à direita no celular é abaixo no computador) |
| L30 | O travado não se arrasta pelo desenho, mas se arrasta pelas Camadas, como no Subir e no Descer; uma caixa travada recebe elementos em todos os caminhos (Camadas, desenho, painel e `⋯`). **A confirmar com o produtor** | travado quer dizer "não seleciona nem mexe pelo desenho", e isso vale para o próprio elemento; os filhos de uma caixa travada continuam arrastáveis, e uma caixa travada que recusasse jogaria para fora um filho reordenado dentro dela. Inverter é dar um motivo de recusa à caixa travada em `freeFlowContainers` |
| L31 | No desenho, o lugar de soltar segue o que está desenhado por cima: entre os filhos da prancheta sob o ponteiro vence o de maior camada e, no empate, o último na ordem; um elemento que não recebe (da sequência, solto que não é caixa) tapa o que está embaixo; só dentro da caixa vencedora vale a mais funda. Soltar num vão que fica em cima de uma caixa solta de fundo (camada abaixo de 0) entra nela | o que se vê é onde entra; pela caixa mais funda, uma caixa solta de fundo pegava todo soltar e uma caixa solta por cima perdia para a de baixo. Se o produtor preferir que a caixa de fundo não receba, basta ela recusar |
| L32 | Dentro de um solto girado, os elementos não mudam de lugar pelo desenho: o gesto não começa e a alça da barrinha nem aparece; para eles ficam as Camadas, Subir e Descer e o `⋯` | o retângulo medido dentro de um solto girado é o contorno girado: o lugar sairia errado, e soltar no próprio lugar tiraria o elemento da caixa |
| L33 | No Fundo, mudar a ordem (arrastar, Alt + setas, Subir, Descer), Tirar e **+ Camada** são um passo próprio no histórico, sem chave e montado pelo design mais novo; a cor, o tipo e os números continuam juntando pela chave do campo. Enquanto uma imagem da lista sobe, a faixa, Subir, Descer, Tirar, **+ Camada** e o cartão que espera a imagem ficam desligados, e a imagem acha a sua camada pela própria camada, não pela posição; sem ela (um Ctrl + Z durante o envio), nada muda e não fica passo vazio | com a chave de antes, um arrastar a menos de 700 ms de uma troca de cor virava o mesmo passo; montado pelo design da hora do gesto, apagaria uma mudança feita em outro elemento no meio (um envio de imagem que termina); pela posição da hora do envio, a imagem cairia na camada errada depois de um **+ Camada** ou de um Desfazer |
| L34 | Links e Áudio não ganham regra nova: arrastam e entram em caixas como no Subir e no `⋯`, e o painel acrescenta onde soltou, inclusive depois dos Links. As alternativas pelo teclado são as que já existiam (§13.9); o modo de levar a qualquer vão num passo só pelo teclado (pegar a linha com uma tecla e levar com as setas) fica para o L4c (§10) | o schema aceita Links e Áudio dentro de caixa e o Subir já sobe os Links: uma regra só no arrastar seria diferente da do Subir ("Links no fim" continua só como guia da IA, §9.8); o teclado já alcança qualquer lugar válido em mais de um passo |
| L35 | A seleção é uma lista de ids na ordem da escolha, na casca do editor (`free-editor.tsx`); o último é o principal (as alças, a barrinha, o nome no desenho, o `aria-current` e o Tab das Camadas são dele; `selectedId` e `activeId` continuam com esses nomes e passam a ser o principal). A lista é sempre viva e normalizada (`freeNormalizeSelection`: sem id sem elemento, sem repetido e nunca uma caixa junto com algo dentro dela; fica o escolhido por último) e a mesma vai para o desenho, as Camadas e o painel Vários. Fica fora do design, do histórico e da cópia de recuperação. O painel de um elemento fica montado e escondido enquanto há vários, com o último elemento escolhido sozinho: ao voltar a um elemento, a aba de antes continua. Na troca entre Vários e um elemento (ou nada) com o foco no painel da direita, o foco vai ao título do painel Vários (`#livre-varios-titulo`) ou ao palco (C11) | o histórico guarda só `{ cta, design }` e a recuperação também: nada de schema, migração ou forma canônica; manter os nomes deixou valendo as guardas de fonte do L4a; trocar de painel desmontaria o painel de um elemento (a aba voltaria a Conteúdo) e deixaria o foco no vazio. O Ctrl + Z e o Ctrl + Shift + Z não devolvem a seleção: depois deles, ela fica só com os escolhidos que continuam vivos (as cópias de um duplicar desfeito saem dela e o refazer não as escolhe de novo), e o painel da direita que some com o foco dentro leva o foco como a C11 |
| L36 | **Desenho**: Shift, Ctrl ou ⌘ + clique põe ou tira e nunca arrasta; no vazio, com tecla nada muda e sem tecla limpa; no Mac, o menu de contexto do Ctrl + clique é barrado no cartão. **Camadas**: Ctrl ou ⌘ + clique põe ou tira (vale antes do Shift); Shift + clique pega o intervalo entre irmãos desde a âncora (o último escolhido sem ser por intervalo), e sem âncora ou com pais diferentes só acrescenta, nunca tira; Shift + ↑/↓ estende (na ponta, nada) e Ctrl ou ⌘ + Enter põe ou tira; Shift + T continua travando e Enter continua escolhendo só a linha; o arrastar da linha não começa com Shift, Ctrl, ⌘ ou Alt. **Ctrl ou ⌘ + A**, fora de campo de texto: os irmãos do principal (sem principal, os de primeiro nível), sem os travados nem os escondidos no aparelho do Ver como (o principal fica); sem ninguém para escolher, nada muda e nada é dito. **Esc**: com um, a caixa de fora; com vários, a caixa de fora comum, senão nada. Nas alças, o Shift continua sendo a proporção (C14). O retângulo de seleção fica para o L4c (decisão 7 do produtor) | Shift no desenho é o padrão do Figma; Ctrl e Shift nas Camadas são o de listas e gerenciadores de arquivo; no Mac o Ctrl + clique abre o menu de contexto, por isso o ⌘ vale junto; o Shift nunca tira o que a equipe já escolheu. O retângulo precisa da interseção com os girados e de um ponta a ponta próprio, e a prancheta é quase toda coberta pela sequência |
| L37 | Valem para vários, um passo cada (um `commitDesign`): mover (setas com a chave do grupo, que junta as seguidas, e arrastar), alinhar e distribuir, duplicar, excluir, esconder e travar (se algum ainda não tem a marca, todos ganham; senão, todos perdem) e a camada `[` e `]` (cada um ±1, de −10 a 10, quem está no limite fica; a chave do grupo junta as seguidas). Só com um: Alt + ↑/↓ no palco (`Escolha um elemento só.`), Soltar, Seguir a sequência, Colocar dentro, Tirar da caixa, Renomear, editar texto e as abas do elemento. Nas Camadas, E, T, Delete e Ctrl + D numa linha que está numa seleção de 2 ou mais agem na seleção; o olho, o cadeado, o `⋯` (o Duplicar e o Excluir dele também), F2 e Alt + ↑/↓ agem só na linha (C17). A frase sempre diz quantos. Alinhar, distribuir e a camada que não mudam nada não gravam passo e ficam em silêncio, como com um elemento. A etiqueta `Na seleção` fica fora das etiquetas de `FREE_EDITOR_COPY.layers.tags` e entra no `aria-describedby` da linha (C1) | um passo por comando é regra do projeto; Delete e Ctrl + D na seleção é o que o Figma e os gerenciadores de arquivo fazem; o `⋯` e os botões são da linha, como o olho e o cadeado, e a frase com o número evita excluir três achando que exclui um |
| L38 | **Duplicar** é atômico: na ordem do documento, cada um pelo duplicar de um elemento sobre o design que acumula, então 32 elementos, 24 soltos, 20 por caixa, um vídeo e 3 botões além do principal contam o conjunto, e um que não cabe recusa tudo com o motivo dele. Links, Áudio e o que contém Vídeo ficam de fora e entram na frase (`2 elementos duplicados. Os links, o áudio e o vídeo não se duplicam.`, C7); só eles escolhidos dão a frase de antes. A seleção vira as cópias (a do principal por último). **Excluir**: Links e Áudio ficam (`2 elementos excluídos. Os links e o áudio ficam. Ctrl + Z desfaz.`), as entradas do celular saem com o elemento, o Botão principal leva junto o botão do aviso, a seleção fica vazia e o foco vai para a linha que ocupa o lugar da primeira excluída (fora das Camadas, para o palco) | meio passo seria pior que nenhum; com o Ctrl + A, os Links (e muitas vezes o Vídeo) quase sempre entram, e recusar tudo por eles irritaria; Links e Áudio já eram fixos no Excluir de um |
| L39 | O arrastar e as alças do solto passam ao `followFreePointer` (L28): limiar de 3 px, a captura só depois dele, `Esc` cancela, o `lostpointercapture` não grava, as teclas engolidas, o click de depois engolido, um ponteiro por vez (um segundo dedo não escolhe nem desliga o gesto) e o gesto desligado ao desmontar (C13). Aceita mouse, caneta e dedo, porque o cartão do desenho tem `touch-action: none` (decisão 5 do produtor); a sequência continua com mouse e caneta. **O grupo**: apertar sem tecla um solto de uma seleção com 2 ou mais soltos que andam arrasta todos; a caixa é a dos que se veem no aparelho, as guias não miram os escolhidos e somem com Alt ou com algum girado, e o fim grava o deslocamento inteiro, limitado pelo grupo (quem chega antes à borda segura os outros), num passo; o clique sem arrastar deixa só ele. Um solto escondido no aparelho anda junto, mas não entra na caixa | antes, o `Esc` no meio do arrastar do solto escolhia a caixa de fora e o gesto gravava no `pointerup`, contra o que os Atalhos prometiam; o arrastar pelo dedo funcionava sem ter sido planejado e o produtor pediu para mantê-lo; limitar item por item deformaria o grupo na borda; o Alt (sem guias) e o Shift (proporção) chegam pelo `onMove` |
| L40 | `FreeDragPreview` ganha `ids?`: o deslocamento vale para todos os listados; a largura e a altura, só para o `id`. Fora da prévia do editor o `drag` é sempre nulo | aditivo: o HTML do aluno e as amostras `antes-*.html` não mudam (§7: +55 B no pedaço do cartão) |
| L41 | Alinhar e distribuir: entram só os filhos da prancheta soltos, não travados e desenhados no aparelho do Ver como; os outros ficam parados e entram na frase (`1 ficou no lugar (travado, na sequência ou escondido).`). A conta é pela caixa que se vê (o girado pela volta dele, decisão 2 do produtor), também no **Alinhar no pop-up** de um elemento só; a prancheta é medida por dentro da borda. **Alinhar entre si** (2 ou mais): pela caixa que envolve esses. **Alinhar no pop-up** (1 ou mais): cada um na prancheta (decisão 1 do produtor; o bloco que mantém as distâncias fica para o L4c). **Espaços iguais na horizontal** e **na vertical** (3 ou mais): o primeiro e o último no eixo ficam, e os espaços ficam iguais com até 1 px de diferença (no empate, a ordem das Camadas; espaço negativo vale). Grava só o eixo que muda, no aparelho do Ver como (com o Celular, só `devices.mobile`) | aplicar a cada um é previsível: Título, Texto e Botão com Alinhar ao centro no pop-up ficam todos centrados; um Selo de 100 × 20 girado 90° alinhado à esquerda pelo retângulo sem giro ficava com a borda visível 40 px para dentro; solto só existe na prancheta; "Distribuir" sozinho já é o da Caixa |
| L42 | `Alt + clique`: a pilha vem de `document.elementsFromPoint`, só dentro do cartão, sem os controles do desenho e o X, cada item no seu elemento, sem repetidos, de cima para baixo (filhos antes da caixa); travados e escondidos não entram. O ciclo anda só no click que não passou do limiar, a partir do principal de antes do `pointerdown`: com ele na pilha, o de baixo dele (depois do último, volta ao de cima); fora dela, o de baixo do de cima. O `pointerdown` com Alt continua com o elemento de cima e o arrastar com Alt continua sem guias (C2). Alt + Shift (ou Ctrl, ou ⌘) + clique só acrescenta: quem já está vira o principal e nunca sai. A frase: `Selecionado: Forma (2 de 3 neste ponto).` | o teste de clique do navegador já respeita camada, recorte, giro e `pointer-events`, que os retângulos medidos não sabem; o primeiro Alt + clique já pega o de baixo, que é o pedido; com o principal de depois do `pointerdown` (o de cima) o ciclo nunca sairia do segundo; Alt + arrastar levando o de baixo contradiria a linha "Alt ao mover: sem guias". Em alguns gerenciadores de janela do Linux, Alt + clique move a janela: a alternativa são as Camadas |
| L43 | Zoom: **Ajustar à tela** (o de abrir), 50, 75, 100, 150 e 200 %. Do Ajustar, o passo é o logo acima ou abaixo da escala mostrada (de 62 %, o + dá 75 e o − dá 50); nas pontas, o botão fica desligado (`aria-disabled`) com o motivo (`O zoom já está no maior.`, `O zoom já está no menor.`). Barra: `[Diminuir o zoom] [62 %] [Aumentar o zoom]`, com o menu de rádio e o foco de volta ao gatilho ao fechar. Ctrl ou ⌘ + `=` (ou `+`, ou o + do teclado numérico) e Ctrl ou ⌘ + `−` (ou `_`, ou o − do numérico), fora de campo de texto, dão zoom no desenho e não na página (decisão 6 do produtor); o Ctrl + 0 fica com o navegador. Ctrl ou ⌘ + roda só sobre a área de desenho: um passo a cada 50 px (um entalhe em linhas ou em páginas vale um passo), no máximo um por evento, com o ponto sob o ponteiro parado (perto das pontas da rolagem o navegador limita e o ponto anda o que faltou); botões, teclas e menu mantêm o meio da vista. Nunca no meio de um arrastar (a roda com Ctrl é barrada sem zoom). A âncora é guardada só por esses pedidos (C12): o Ajustar que muda sozinho (a prancheta cresce, a janela muda) não rola nada. Fora do histórico, mantido no Salvar rascunho e não guardado entre aberturas. Teclas, botões e menu falam `Zoom 150 %.` ou `Zoom: ajustar à tela (62 %).` (com a escala nova); a roda não fala | são os passos pedidos; até 200 % o contorno do escolhido continua com 1 px (acima disso ele arredonda e pede outra técnica, L4c); o arrastar guarda a escala no começo, e mudá-la no meio faria o elemento pular; o `onWheel` do React é passivo e não cancelaria o zoom da página (por isso o ouvinte próprio, não passivo) |
| L44 | Rolagem durante o arrastar: o arrastar do solto e das alças soma a rolagem da área desde o `pointerdown` e refaz a prévia quando ela rola, como já fazia a sequência. A rolagem sozinha é a opção `autoScroll` do `followFreePointer`: só com o gesto começado, numa faixa de 32 px dentro da borda da área, de 1 a 20 px por quadro (mais rápida perto da borda), e o `onMove` com o último ponto só quando rolou. Cada eixo só se arma depois que o ponto esteve dentro da área e fora das faixas daquele eixo no gesto (C10): pegar a primeira linha das Camadas ou entrar pela esquerda vindo do Elementos não rola, e descer em linha reta a partir da faixa da esquerda rola. Vale no desenho (solto, alças e sequência), nas Camadas (a lista) e no Elementos (a área de desenho) | com 150 e 200 % a área rola nos dois eixos e o arrastar usa px de tela: o solto escorregaria; um laço só serve às cinco frentes; armar por eixo evita rolar sem querer sem travar a descida pela borda |
| L45 | Até 3 "Abrir um link" em qualquer mistura com Fechar e Lembrar depois, dentro dos 3 botões além do principal: sai o limite próprio de um link (modelo, schema, editor e painel), e o 4º botão recusa só com `Use até 3 botões além do principal.`. A pílula "Abrir um link" nunca desliga; duplicar o Botão principal vira "Abrir um link" enquanto couber. Sem chave nova: `version: 1`, a mesma forma canônica e o mesmo JSON Schema; o cartão do aluno já desenhava cada link. A imagem anterior recusa 2 ou 3 links (`docs/20` §9) | um `linkButtons: 3` seria uma regra morta, com duas frases no mesmo caminho; o D9 já confere por aparelho qualquer link visível |
| L46 | D9 numa regra só (`freeHasClickTarget`): sem design, vale o botão do aviso; com botão no aviso e sem o Botão principal no design, vale (o erro `Falta o botão principal no design.` já aparece); senão, o computador e o celular precisam ter, cada um, um botão visível que conta: o Botão principal (com botão no aviso) ou um "Abrir um link" com destino que vale, e os botões podem ser outros em cada aparelho. O Botão principal escondido no computador (ou nos dois) deixa de contar (decisão 3 do produtor). Um aviso já salvo assim abre com "Só quando o pop-up terminar" (`noticeDraftOfRow`): publicar e aprovar não dão 400 (C3) e gravam essa regra na linha (`noticeStopOnToPublish`), e salvar de novo com o clique dá a frase de sempre | antes, com o botão no aviso, o principal escondido no computador passava, porque a regra só olhava o celular: um pop-up assim nunca pararia para quem está no computador; a mesma regra serve para 1, 2 ou 3 links |
| L47 | No Livre, o clique num botão com destino manda junto qual foi (`cta` ou `link:<id>`): cartão, janela, host e `postPopupEvent`, só no `clicked`. A rota grava `metadata.button` no `message_clicked` só quando a forma confere (`^(?:cta\|link:[a-z][a-z0-9]{0,15})$`, o id de `FREE_ID_PATTERN`) e o botão está visível no pop-up no ar (no computador ou no celular); senão grava o clique sem a chave, sem 400. Padrão e Personalizado não mandam. Sem migração (o `metadata` jsonb que já existe). "Clicaram no botão" do relatório continua somando todos; o bloco por botão fica para o L4c, com os dados já gravados. A conferência mora num módulo só do servidor (`popup-clicked-button.ts`, C4; contrato no `docs/25` §5.1). Volta de imagem: `docs/20` §9 | acompanhar o aluno desde o começo (AGENTS.md), sem migração (decisão 4 do produtor); o valor vem do navegador e só entra conferido contra o design; a imagem anterior lê só `event` e `via` e ignora a chave |
| L48 | O solto que vira sequência (Camadas, `⋯` › Colocar dentro, Seguir a sequência) perde o giro e a posição; a Forma e a Caixa guardam a largura (de 4 a 720; a largura da prancheta ou mais vira `fill`, o padrão, omitido) e a altura (de 4 a 1.600; na Caixa, a altura mínima); os outros tipos ficam só com a camada, como antes. Entrando numa caixa, uma camada abaixo de 0 vira 0 em todo tipo (C8), também para quem já está na sequência e entra numa caixa (reordenar na mesma caixa não muda a camada); na prancheta, a camada fica. No celular, a posição solta sai, mas a Forma e a Caixa com largura ou altura próprias no celular ficam com elas na sequência do celular (`devices.mobile.nodes.<id>.place` com `mode: "flow"`, só o que difere do computador, C9). O **Soltar** continua tirando a posição do celular | a Forma é uma div vazia e sumia na sequência; a caixa não isola as camadas (só a prancheta isola) e o Degradê de camada −1 ficaria atrás do fundo dela; sem a C9, a Forma do celular mudaria de tamanho no próprio gesto. O schema já aceitava largura e altura na sequência nos dois aparelhos |
| L49 | Os Atalhos passam de 12 para 17 linhas, as 5 novas no fim (a do Esc continua no mesmo lugar): Shift + clique, Ctrl + A, Alt + clique, o zoom e as Camadas com vários; a tecla dos Atalhos (`kbd`) passou de 11 para 12 px. As paradas do degradê não se reordenam (§10) | as linhas são conferidas por índice e palavra por palavra; a ordem das paradas vem de `at` no desenho, na prévia e na forma canônica: um arrastar seria desfeito ao salvar |
| L50 | O pedaço do cartão Livre tem teto de 12 KB = 12.288 B gzip, medido por `npm run livre:medir` (`scripts/livre-medir-cartao.mjs`) no fim do `npm run verify`, que falha acima dele. A régua segue os manifestos a partir do Início e soma o arquivo com a prancheta mais o que só ele faz baixar (C11). Cada entrega do L6 tem uma cota (L6a +40, L6b +220, L6c +250, L6d +200, L6e +260, L6f +700, L6g +60 B) e escreve o antes e o depois no §7, medidos na mesma pasta; passar a cota em mais de 25 % obriga a encolher antes do merge ou a pegar da reserva por escrito | o teto estava só no docs e a medida morava fora do repositório; seis entregas (L6b a L6g) vão disputar cerca de 1,9 KB de folga, e o aluno baixa esse pedaço inteiro antes de o pop-up Livre abrir. Seguir os manifestos deixa de fora os pedaços velhos da pasta `.next`; somar o que só o cartão alcança impede que um pedaço separado (o plano B do contador) passe sem contar. A janela e o JS inicial são impressos para conferir, sem trava (o `docs/29` §7.2 já os acompanha) |
| L51 | Os três defeitos do que o aluno já via (e o aperto dos botões, com a mesma causa da escala) entram no L6a, em todos os pop-ups, inclusive os que estão no ar: os Links sem linha escolhida deixam de pôr `text-decoration-line: none` no estilo em linha (o sublinhado ao passar o mouse volta a valer) e, em degradê, a linha usa a primeira parada (C21, só nos Links, no próprio `LinksView`); o anel de foco é o `box-shadow` inteiro com `!important` e, no foco por teclado, toma o lugar da sombra própria do botão; as transições do aperto dos botões e da janela listam `translate` e `scale`, as propriedades que o Tailwind 4 muda. A amostra `antes-celular-livre.html` foi gerada de novo uma vez, só com essas trocas (conferidas palavra a palavra), e fica travada daí em diante. O mesmo defeito de escala fora do Livre (o painel do sino e o ícone do botão de retomar de Minhas compras, na área do aluno, e três menus do admin) fica para uma PR de correção à parte (§10) | são defeitos do que o L6 vai construir (o passar o mouse, o foco com cores e a entrada); consertar depois mudaria as amostras no meio das entregas de efeitos, que prometem o HTML igual sem chave nova. A cor da linha no `LinksView`, e não na pintura do texto, deixa Título e Texto (e a amostra) como estavam. O estilo em linha vence qualquer classe sem `!important`: com o `box-shadow` inteiro no `!important`, o anel aparece por cima de qualquer sombra sem mudar como a sombra é montada (enquanto o foco dura, a sombra some). O sino, Minhas compras e os menus do admin ficam fora do cartão Livre e das amostras do L6 |
| L52 | O L6 sai em 7 entregas em série para a `dev` (L6a consertos e régua, L6b contorno e marca-texto, L6c cores ao passar o mouse, L6d animação de entrada, L6e textura e mistura, L6f contador e o quinto modelo, L6g texto escrito no desenho), cada uma testada sozinha pelo produtor e levada à produção só com o ok dele. Em todas: `version: 1` sem migração, só chaves opcionais que a forma canônica tira quando têm o padrão; nada novo em `devices.mobile` (só o contador herda o molde de texto dos Links); nenhum `url(` novo; o cartão sem zod e sem o modelo. A volta de imagem fica numa nota só do `docs/20` §9, aberta no L6b e completada a cada entrega que traz chave nova (o L6a e o L6g não mudam o schema). As decisões seguem numeradas daqui em diante, na ordem das entregas | decisão do produtor (26/10/2026): entregas por PR, na ordem proposta. Cada entrega mexe numa camada (texto, botão, a base do elemento, fundos, um tipo novo, o editor) e os arquivos grandes são mexidos por uma de cada vez; a regra do §9.1 deixa o que está gravado igual byte a byte; o schema estrito da imagem de antes recusa cada chave nova, por isso a nota de volta cresce junto |

## 9. Contrato do JSON

O JSON do design Livre é o contrato entre o editor, o servidor, o cartão do aluno e (no PR "Criar com IA") a IA. Esta seção é a fonte para quem escreve um design à mão ou pede a uma IA. **Todo bloco `json` desta seção é um design completo e passa no schema**: `tests/popup-livre-modelo.test.mjs` lê o documento e valida cada exemplo (documento e schema não se separam).

As partes 9.2 a 9.6, 9.8, 9.9 e 9.10 viram as instruções para a IA (§13.1), que vão para a conversa de um terceiro: o que é só de quem mantém o código (nomes de arquivo e de função, banco, buckets, caminhos) fica entre `<!-- ia:fora -->` e `<!-- /ia:fora -->` (o Markdown não mostra os marcadores; o script tira o trecho) e as referências entre partes dizem o nome da parte ("veja 9.4 Padrões"), nunca uma seção que não vai junto (L26).

### 9.1 Onde fica e como é lido

- Coluna `campaigns.popup_design` (jsonb). O Personalizado é o objeto sem a chave `mode`; o Livre é `{ "mode": "free", "version": 1, ... }`. A leitura passa pelo roteador (`src/server/communications/popup-design-router.ts`): `mode: "free"` vai ao schema do Livre (`popup-free-schema.ts`), o resto ao do Personalizado. Os dois são estritos: um nunca vira o outro por engano.
- Validação estrita no navegador do editor, na Server Action ao salvar e na leitura do banco: chave a mais é recusada em qualquer nível (inclusive `url` num arquivo e qualquer chave dentro de `devices` fora da §9.10).
- Livre inválido no banco (só com edição direta ou depois de voltar um deploy): **não aparece para o aluno** (sai da lista no ar com o log `[comunicacao] design livre invalido <id do aviso>`, nunca o conteúdo) e abre como Padrão no editor do aviso.
- O que se grava é sempre a **forma canônica** (`canonicalPopupFreeDesign`): sem o que é igual ao padrão (§9.4), cores em minúsculas, px e ângulos inteiros, altura da linha, espaço entre letras e traço do ícone com 2 casas, paradas do degradê ordenadas por `at`, lados no formato mais curto (`[a, a, a, a]` → `a`; `[v, h, v, h]` → `[v, h]`), nome aparado (vazio sai), partes vizinhas com o mesmo estilo juntas (sem passar de 600 letras), arquivos que nenhum elemento usa fora de `assets`, `assets` e `fonts` sempre presentes (`fonts` recalculado) e chaves em ordem alfabética.
- `version` do Livre só muda quando um documento velho deixar de valer. Campos novos (como `devices`, desde o PR L3, ou uma pintura nova) entram sem mudar a versão. **Voltar o deploy** para uma imagem de antes do L3: designs salvos com `devices` ficam inválidos para o código antigo (somem para o aluno com o log acima e abrem como Padrão no editor) até a imagem nova voltar; com o código antigo no ar ninguém salva valores de Celular (`docs/20` §9, espelho do R1 do `docs/29`).
- Toda medida está em **px da prancheta** na largura escolhida (`artboard.width`, 280 a 720). No celular o pop-up inteiro encolhe na mesma proporção (unidades `cqw` do próprio cartão), com duas proteções: texto nunca abaixo de 12 px e área de toque de 44 px nos botões, nos links e no X (invisível, não muda o desenho). Os valores próprios do celular (`devices.mobile`, §9.10) entram por cima do computador antes de encolher.
- Arquivos: o design guarda **só o caminho** no nosso Storage. O endereço é montado na hora pelo cartão e pelo editor (`freeAssetUrl`): a origem conferida do nosso Supabase + o caminho público do bucket + um caminho que casou com o padrão do tipo.

### 9.2 O documento mínimo

Prancheta e X com os padrões, sem arquivos nem fontes (`assets` e `fonts` podem ficar de fora: são completados sozinhos). Vale num aviso sem botão e sem áudio:

```json
{ "mode": "free", "version": 1, "children": [{ "id": "links", "type": "links" }] }
```

Com título, texto e o botão principal (o texto e o destino do botão moram no `cta` do aviso, fora do design):

```json
{
  "mode": "free",
  "version": 1,
  "children": [
    { "id": "titulo", "type": "heading", "lines": [[{ "text": "Aula nova no ar" }]] },
    { "id": "texto", "type": "text", "lines": [[{ "text": "Assista hoje e coloque em prática." }]], "textStyle": { "paint": { "kind": "solid", "color": "#d4d4d8" } } },
    { "id": "botao", "type": "button", "action": { "kind": "cta" }, "box": { "fill": [{ "kind": "solid", "color": "#e50914" }], "radius": 999, "padding": [12, 24] } },
    { "id": "links", "type": "links" }
  ]
}
```

### 9.3 Campos

Raiz:

| Chave | Tipo | O que é |
|---|---|---|
| `mode` | `"free"` | sempre |
| `version` | `1` | sempre |
| `artboard` | objeto (opcional) | a prancheta: `width` (280 a 720), `minHeight` (0 a 1.600; 0 = cresce com o conteúdo), `fill` (1 a 3 pinturas; a primeira fica por cima), `padding` (lados, 0 a 200), `gap` (0 a 96), `align` (`stretch` · `start` · `center` · `end`), `justify` (`start` · `center` · `end` · `between`), `radius` (0 a 64), `border`, `shadows` (até 2) |
| `close` | objeto (opcional) | o X: `color`, `background`, `border`, `size` (28 · 36 · 44), `inset` (8 a 24), `side` (`right` · `left`) |
| `children` | lista (1 a 32) | os elementos na ordem do DOM (= ordem de leitura e das Camadas) |
| `assets` | lista (opcional na entrada) | os arquivos de imagem e vídeo (veja Arquivos, mais abaixo) |
| `fonts` | lista (opcional na entrada) | ignorada na entrada: a forma canônica recalcula os ids das fontes enviadas usadas |
| `devices` | objeto (opcional) | `{ "mobile": { ... } }`: só o que muda no celular (veja 9.10 Celular); sem ele, o celular encolhe o desenho do computador |

Comum a todos os elementos: `id` (letra minúscula e depois letras minúsculas e números, até 16; único entre elementos e, à parte, entre arquivos), `type`, `name` (nome nas Camadas, até 40), `hidden` (não aparece para o aluno), `locked` (só no editor), `place`, `box`.

`place` (posição):

| Modo | Campos |
|---|---|
| `{ "mode": "flow" }` (na sequência; o padrão) | `width`: `"fill"` (ocupa a linha), `"hug"` (do tamanho do conteúdo) ou px (4 a 720); `height` (4 a 1.600: fixa em mídia, forma, linha e espaço; mínima nos elementos com texto e nas caixas); `align` (`start` · `center` · `end` · `stretch`; sem = o da caixa); `margin` (lados, −400 a 400; negativa sobrepõe o vizinho); `z` (−10 a 10) |
| `{ "mode": "free" }` (solta; só filhos diretos da prancheta) | `x` (−720 a 1.440), `y` (−400 a 2.400), `w` (4 a 1.440), `h` (4 a 2.400; sem = automática; mínima nos elementos com texto), `rotate` (−180 a 180), `z` (−10 a 10) |

`box` (caixa de qualquer elemento): `fill` (até 3 pinturas), `border` (`width` 0 a 8 px, `color`, `style` `solid` · `dashed` · `dotted`), `radius` (0 a 999, ou 4 cantos; 999 = pílula), `shadows` (até 2: `x`, `y` −100 a 100, `blur` 0 a 200, `spread` −50 a 50, `color`, `inset`), `padding` (lados, 0 a 200), `opacity` (0 a 100), `blur` (0 a 80), `backdropBlur` (0 a 40), `clip` (corta o que passa), `fade` (esmaecer: `side` `bottom` · `top` · `left` · `right`, `start` e `end` em %, fim pelo menos 5 depois do começo).

Pinturas (`fill`, e as três primeiras também em `textStyle.paint`):

| `kind` | Campos |
|---|---|
| `solid` | `color` |
| `linear` | `angle` (0 a 360; padrão 180 = de cima para baixo), `stops` (2 a 5 paradas `{ at: 0 a 100, color }`) |
| `radial` | `x`, `y` (centro em %), `shape` (`ellipse` · `circle`), `extent` (`farthest-corner` · `closest-side`), `stops` |
| `image` (só em `fill`) | `asset` (id de uma imagem de `assets`), `fit` (`cover` · `contain` · `tile`), `focus` (`[x, y]` em %) |

Lados (`padding`, `margin`): um número, `[vertical, horizontal]` ou `[cima, direita, baixo, esquerda]`. Cores: `#RRGGBB` ou `#RRGGBBAA`.

`textStyle` (Título, Texto, Selo, Botão, Links): `font` (`{ "kind": "builtin", "key": "inter" | "exo2" | "system" | "condensed" | "serif" | "mono" }` ou `{ "kind": "uploaded", "id": "<uuid da biblioteca>" }`), `size` (10 a 160), `weight` (100 a 900, de 100 em 100), `italic`, `lineHeight` (0,7 a 2,5), `letterSpacing` (−0,2 a 1 em), `uppercase`, `decoration` (`underline` · `line-through`), `align` (`left` · `center` · `right`; nos Links alinha a linha dos links), `paint` (sólida, linear ou circular), `shadow` (`x`, `y`, `blur`, `color`).

Texto do Título e do Texto: `lines` = linhas; cada linha = partes `{ "text": "...", "style": { ... } }` lado a lado. O texto da parte não é aparado (o espaço entre partes conta). `style` da parte aceita `font`, `size`, `weight`, `italic`, `uppercase`, `decoration`, `letterSpacing` e `paint`; o resto vem do elemento.

Elementos (`type`):

| `type` | Campos próprios |
|---|---|
| `heading` (Título) | `lines` (1 a 4), `textStyle`; o primeiro visível é o `<h2>` e o nome do diálogo |
| `text` (Texto) | `lines` (1 a 12), `textStyle`; o primeiro visível descreve o diálogo |
| `badge` (Selo) | `label` (1 a 40), `icon`, `textStyle` |
| `button` (Botão) | `action`: `{ "kind": "cta" }` (o botão principal: texto e destino no `cta` do aviso, sem `label`), `{ "kind": "close" }`, `{ "kind": "snooze" }` (Lembrar depois) ou `{ "kind": "link", "href": "...", "target": "same_tab" | "new_tab" }` (Abrir um link: até 3, cada um com o seu destino; o clique em qualquer um conta como o clique do pop-up); `label` (1 a 40, obrigatório fora do `cta`); `icon` (`{ "name", "side": "end" | "start" }`); `textStyle` |
| `image` (Imagem) | `asset` (id de uma imagem de `assets`, ou `null`: sem arquivo, a equipe envia no editor antes de publicar), `alt` (até 160; vazio = decorativa), `fit` (`cover` · `contain`), `focus` |
| `video` (Vídeo) | `asset` (id do vídeo de `assets`, ou `null`: sem arquivo, a equipe envia no editor antes de publicar), `fit`, `focus`; toca sem som, em repetição; com menos movimento ou economia de dados, só a capa |
| `icon` (Ícone) | `icon` (um dos 24 nomes abaixo), `size` (8 a 160), `stroke` (1 a 3), `color` |
| `divider` (Linha) | `thickness` (1 a 8), `color`, `style` |
| `spacer` (Espaço) | `size` (0 a 400) |
| `shape` (Forma e Degradê) | `shape` (`rect` · `ellipse`); o resto é `box` |
| `audio` (Áudio) | nenhum: o player do áudio do aviso |
| `links` (Links) | `dismiss` (mostra "Não mostrar de novo"; padrão `true`), `gap` (0 a 96), `textStyle`; "Lembrar depois" aparece sozinho quando o aluno pode adiar e não há botão Lembrar depois |
| `box` (Caixa) | `children` (0 a 20), `layout`: `dir` (`column` · `row`), `gap` (0 a 96), `align` (`stretch` · `start` · `center` · `end`), `justify` (`start` · `center` · `end` · `between` · `around`), `wrap` |

Ícones: `arrow-right`, `bell`, `book-open`, `calendar`, `check`, `chevron-right`, `circle-check`, `clock`, `crown`, `flame`, `gem`, `gift`, `graduation-cap`, `heart`, `lock-open`, `megaphone`, `percent`, `play`, `rocket`, `sparkles`, `star`, `tag`, `trophy`, `zap`.

Arquivos (`assets`): quem escreve o design (à mão ou por uma IA) não escreve arquivos. Imagem e Vídeo novos vão sempre com `"asset": null` e a equipe envia o arquivo no editor; nada de `assets` novos, de pintura `image` nova ou de endereço de arquivo. Num design copiado do editor, `assets` e os `asset` que vieram ficam exatamente como estão.

<!-- ia:fora -->
Por dentro (só o editor e o servidor escrevem; fica fora das instruções para a IA): cada arquivo é só o caminho no nosso Storage, sem endereço.

| `kind` | Campos |
|---|---|
| `image` | `id`, `path` (`communications/free/<24 hex>.webp`, enviada no editor, ou `communications/images/<24 hex>.webp`, a imagem do aviso; bucket `content-assets`), `width` e `height` (16 a 1.600; o servidor troca pelas medidas lidas do arquivo) |
| `video` | `id`, `path` (`videos/<uuid>.mp4` ou `.webm`, bucket `communication-popup-video`), `mimeType` (`video/mp4` · `video/webm`, igual à extensão), `poster` (opcional: id de uma imagem de `assets`) |
<!-- /ia:fora -->

### 9.4 Padrões (omitidos na forma canônica)

| Campo | Padrão |
|---|---|
| `artboard` | `width` 440, `minHeight` 0, `fill` `[{ "kind": "solid", "color": "#16181c" }]`, `padding` 24, `gap` 12, `align` `stretch`, `justify` `start`, `radius` 24, sem `border`, sem `shadows` |
| `close` | `color` `#ffffff`, `background` `#ffffff1f`, `size` 36, `inset` 12, `side` `right`, sem `border` |
| `hidden`, `locked`, `italic`, `uppercase`, `clip`, `inset`, `wrap` | `false` |
| `place` | `{ "mode": "flow" }` com largura `fill` (título, texto, imagem, vídeo, linha, caixa, áudio, links, forma, espaço) ou `hug` (selo, botão, ícone); `margin`, `z`, `rotate` 0; `align` = o da caixa |
| `box` | `opacity` 100, `blur` 0, `backdropBlur` 0, `padding` 0, `radius` 0, borda `style` `solid` |
| `textStyle` | título 28 / 800 / 1,1; texto 15 / 400 / 1,5; selo 12 / 700 / 1,2; botão 15 / 700 / 1,2; links 13 / 600 / 1,2; comum: fonte Inter, `letterSpacing` 0, `align` `left`, cor `#ffffff` |
| linear `angle` | 180 |
| radial `shape` / `extent` | `ellipse` / `farthest-corner` |
| imagem `fit` / `focus` / `alt` | `cover` / `[50, 50]` / `""` |
| ícone `size` / `stroke` / `color` | 24 / 2 / `#ffffff` |
| linha `thickness` / `style` / `color` | 1 / `solid` / `#ffffff1f` |
| espaço `size` | 16 |
| forma `shape` | `rect` |
| caixa `layout` | `dir` `column`, `gap` 0, `align` `stretch`, `justify` `start`, `wrap` false |
| links `dismiss` / `gap` | `true` / 8 |
| botão `icon.side` | `end` |

### 9.5 Limites

| Limite | Valor |
|---|---|
| Elementos | 1 a 32 (sem contar a prancheta) |
| Filhos por caixa | 0 a 20 |
| Caixas | uma caixa pode ter outra dentro; a de dentro não tem caixa |
| Elementos soltos | só na prancheta, até 24 |
| Títulos / linhas por título | até 4 / 1 a 4 |
| Linhas por texto / partes por linha / letras por parte | 1 a 12 / 1 a 6 / 1 a 600 |
| Texto do selo e do botão | 1 a 40 |
| Todos os textos somados | até 1.200 letras |
| Imagens diferentes / elementos Imagem | até 6 / até 8 |
| Vídeo | no máximo 1 |
| Ícones (elementos Ícone) | até 12 |
| Botões | um botão principal (existe se e só se o aviso tem botão); outros até 3: Fechar, Lembrar depois ou Abrir um link, em qualquer mistura (até 3 "Abrir um link") |
| Links / Áudio | exatamente 1 / no máximo 1 (existe se e só se o aviso tem áudio) |
| Elementos com desfoque | até 4 |
| Camadas de fundo / paradas / sombras | até 3 / 2 a 5 / até 2 |
| Fontes enviadas | até 4 |
| Imagem enviada | WebP, 16 a 1.600 px de cada lado, até 420.000 bytes |
| Tamanho | até 30.000 bytes na conta do editor, que pesa mais que o texto do JSON: fique abaixo de uns 12.000 caracteres de JSON sem espaços (cada modelo da 9.9 tem menos de 2.500)<!-- ia:fora -->; a conta é a estimativa do jsonb (`jsonbBytesUpperBound` da forma canônica) e o check do banco mede o jsonb sem compressão e para em 32.768<!-- /ia:fora --> |

### 9.6 Regras entre partes e com o conteúdo do aviso

Sempre (o schema confere ao colar e ao salvar): ids únicos; profundidade e contagens de 9.5 Limites; solto só na prancheta; `label` obrigatório fora do `cta` e proibido no `cta`; todo `asset` de elemento ou pintura existe em `assets` com o tipo certo; a capa do vídeo é uma imagem de `assets`;<!-- ia:fora --> o caminho casa com o padrão do bucket e o vídeo tem a extensão do tipo;<!-- /ia:fora --> o link do botão segue a regra do botão principal (página da área, produto ou https); cada linha tem pelo menos uma letra que não é espaço; até 4 fontes enviadas; o tamanho; e o **X sempre visível**: o alfa da cor do ícone do X é pelo menos `cc` e o contraste entre o ícone e o fundo do X (o fundo composto sobre a cor de base da prancheta, a camada de baixo do `fill`; com alfa, sobre preto) é pelo menos 3:1.

Com o conteúdo do aviso (no salvar e no publicar): aviso com botão pede o botão principal (`Falta o botão principal no design.`); botão principal sem botão no aviso (`Escreva o texto do botão e escolha para onde ele leva.` em `cta.label`); aviso com áudio pede o Áudio (`Falta o elemento Áudio no design.`); Áudio sem áudio no aviso (`Envie o áudio ou tire o elemento Áudio.` em `audio`); botão Lembrar depois com o adiar desligado; Imagem e Vídeo sem arquivo. "Quantas vezes → Quando o aluno clica no botão" vale quando o computador e o celular têm, cada um, um botão visível que conta como o clique: o botão principal (com o `cta`) ou qualquer "Abrir um link" com destino que vale; os botões podem ser outros em cada aparelho, e o escondido num aparelho não conta nele (o botão principal escondido no computador também não; veja 9.10 Celular). Sem isso: `Este pop-up não tem botão: escolha quando ele para de aparecer.`

<!-- ia:fora -->
No rascunho do aviso, `freeDesign` fica ao lado de `design` (o Personalizado): no máximo um não nulo (`Escolha um design só.`). Ao salvar, o pedido com uma só das chaves (mesmo `null`) zera a outra; com as duas, valem como vieram; sem nenhuma, fica o que está gravado.
<!-- /ia:fora -->

### 9.7 Chaves de erro

O editor recebe: `freeDesign` (o design inteiro), `freeDesign.artboard.<campo>`, `freeDesign.close.<campo>`, `freeDesign.assets.<id do arquivo>`, `freeDesign.fonts`, `freeDesign.size`, `freeDesign.nodes.<id do elemento>[.<caminho do campo>]` (por exemplo `freeDesign.nodes.botao.action.href` ou `freeDesign.nodes.titulo.lines.0.1.text`) e, no celular, `freeDesign.devices.mobile.artboard.<campo>` e `freeDesign.devices.mobile.nodes.<id do elemento>[.<caminho do campo>]` (por exemplo `freeDesign.devices.mobile.nodes.selo.place.x`; já vêm pelo id, sem índice). Os índices que o zod devolve (`freeDesign.children.3.children.0...`) viram ids por `freeErrorKey`/`freeErrorKeys`, estáveis se a ordem mudar; `freeNodeIdOfKey` acha o elemento nos dois formatos.

### 9.8 Guia curto para a IA

1. Escreva só o JSON do design, na forma desta seção. Imagem e Vídeo novos sempre com `"asset": null` (a equipe envia o arquivo no editor); não escreva `assets` nem `fonts` novos e nunca um endereço de arquivo. Se o design que eu mandar já tem `assets`, devolva essa lista e os `asset` exatamente como vieram.
2. Texto sempre na sequência (`place` omitido ou `flow`); solto só para mídia, forma, degradê e adesivo.
3. Um botão principal (`{ "kind": "cta" }`) quando o aviso tem botão; o texto dele vai no `cta` do aviso, fora do design. Para destinos além do principal, use "Abrir um link" (`{ "kind": "link", ... }`): até 3 botões além do principal, contando Fechar e Lembrar depois.
4. Os `links` sempre no fim da prancheta; o Áudio antes do primeiro botão, quando o aviso tem áudio.
5. Imagem de foto vira um elemento Imagem com `"asset": null` e `"name": "Troque esta imagem"`, que a equipe preenche.
6. Omita o que é igual ao padrão (veja 9.4 Padrões): o documento mínimo `{ mode, version, children }` já vale.
7. O X precisa contrastar com o fundo dele; cores com alfa só onde fizer sentido.
8. Fique bem abaixo do tamanho máximo: menos elementos e menos partes de texto.
9. Só escreva `devices.mobile` quando pedirem algo só para o celular (veja 9.10 Celular), e só com o que muda; sem esse pedido, deixe `devices` de fora: o celular encolhe o desenho do computador sozinho.

<!-- ia:fora -->
`popupFreeJsonSchema()` (em `popup-free-json-schema.ts`, um módulo que nenhuma tela importa, §7) gera o JSON Schema da entrada (`z.toJSONSchema` com `io: "input"`; o elemento recursivo sai em `$defs`/`$ref`).
<!-- /ia:fora -->

### 9.9 Exemplos: os 4 modelos para começar

Forma canônica (padrões omitidos). O Vídeo e a Imagem dos modelos começam sem arquivo (`"asset": null`): o editor preenche o Vídeo com o vídeo do Personalizado guardado ou pede o envio; a Imagem recortada a equipe envia.

**Vídeo no topo com degradê** (a estrutura da referência: vídeo solto no topo sumindo no fundo escuro, selo por cima, título condensado em duas cores, texto cinza, botão verde-limão com borda de baixo e brilho, X pequeno):

```json
{
  "artboard": {
    "align": "center",
    "border": { "color": "#ffffff1a", "width": 1 },
    "fill": [
      {
        "kind": "linear",
        "stops": [{ "at": 0, "color": "#111216" }, { "at": 55, "color": "#16181d" }, { "at": 100, "color": "#262b34" }]
      }
    ],
    "gap": 0,
    "padding": [168, 24, 20, 24],
    "shadows": [{ "blur": 80, "color": "#000000b3", "spread": 0, "x": 0, "y": 24 }]
  },
  "assets": [],
  "children": [
    {
      "asset": null,
      "box": { "fade": { "end": 100, "side": "bottom", "start": 40 } },
      "id": "midia",
      "name": "Vídeo do topo",
      "place": { "h": 248, "mode": "free", "w": 440, "x": 0, "y": 0 },
      "type": "video"
    },
    {
      "box": {
        "border": { "color": "#ff9ccf", "width": 1 },
        "fill": [{ "kind": "linear", "stops": [{ "at": 0, "color": "#e0007a" }, { "at": 100, "color": "#d1006f" }] }],
        "padding": [4, 10],
        "radius": 999,
        "shadows": [{ "blur": 0, "color": "#ffffff59", "inset": true, "spread": 0, "x": 0, "y": 1 }]
      },
      "icon": "gift",
      "id": "selo",
      "label": "Novidade",
      "type": "badge"
    },
    {
      "id": "titulo",
      "lines": [
        [{ "style": { "paint": { "color": "#e5ff1f", "kind": "solid" } }, "text": "Experimente grátis" }],
        [{ "text": "Nova aula ao vivo" }]
      ],
      "place": { "margin": [12, 0, 0, 0], "mode": "flow" },
      "textStyle": {
        "align": "center",
        "font": { "key": "condensed", "kind": "builtin" },
        "lineHeight": 0.95,
        "size": 40,
        "uppercase": true
      },
      "type": "heading"
    },
    {
      "id": "texto",
      "lines": [[{ "text": "Uma aula nova acabou de entrar na sua área. Assista agora e coloque em prática ainda hoje." }]],
      "place": { "margin": [12, 0, 0, 0], "mode": "flow" },
      "textStyle": { "align": "center", "paint": { "color": "#a1a1aa", "kind": "solid" } },
      "type": "text"
    },
    {
      "action": { "kind": "cta" },
      "box": {
        "fill": [{ "kind": "linear", "stops": [{ "at": 0, "color": "#f0ff5c" }, { "at": 100, "color": "#d9f500" }] }],
        "padding": [12, 22],
        "radius": 10,
        "shadows": [
          { "blur": 0, "color": "#9db300", "spread": 0, "x": 0, "y": 3 },
          { "blur": 0, "color": "#ffffff80", "inset": true, "spread": 0, "x": 0, "y": 1 }
        ]
      },
      "id": "botao",
      "place": { "margin": [24, 0, 0, 0], "mode": "flow" },
      "textStyle": { "paint": { "color": "#111216", "kind": "solid" } },
      "type": "button"
    },
    {
      "id": "links",
      "place": { "margin": [12, 0, 0, 0], "mode": "flow" },
      "textStyle": { "align": "center", "paint": { "color": "#a1a1aa", "kind": "solid" } },
      "type": "links"
    }
  ],
  "close": { "background": "#ffffff40", "size": 28 },
  "fonts": [],
  "mode": "free",
  "version": 1
}
```

**Só texto com brilho** (sem mídia: duas manchas de luz soltas atrás, título com uma parte em degradê, botão largo):

```json
{
  "artboard": {
    "align": "center",
    "border": { "color": "#ffffff14", "width": 1 },
    "fill": [{ "color": "#0b0b12", "kind": "solid" }],
    "gap": 14,
    "padding": [44, 28, 12, 28],
    "shadows": [{ "blur": 80, "color": "#000000b3", "spread": 0, "x": 0, "y": 24 }]
  },
  "assets": [],
  "children": [
    {
      "box": {
        "blur": 40,
        "fill": [
          {
            "extent": "closest-side",
            "kind": "radial",
            "stops": [{ "at": 0, "color": "#7c3aed99" }, { "at": 100, "color": "#7c3aed00" }],
            "x": 50,
            "y": 50
          }
        ]
      },
      "id": "luz1",
      "name": "Luz roxa",
      "place": { "h": 280, "mode": "free", "w": 280, "x": -90, "y": -90, "z": -1 },
      "shape": "ellipse",
      "type": "shape"
    },
    {
      "box": {
        "blur": 40,
        "fill": [
          {
            "extent": "closest-side",
            "kind": "radial",
            "stops": [{ "at": 0, "color": "#06b6d480" }, { "at": 100, "color": "#06b6d400" }],
            "x": 50,
            "y": 50
          }
        ]
      },
      "id": "luz2",
      "name": "Luz azul",
      "place": { "h": 260, "mode": "free", "w": 260, "x": 250, "y": 140, "z": -1 },
      "shape": "ellipse",
      "type": "shape"
    },
    {
      "box": {
        "border": { "color": "#ffffff26", "width": 1 },
        "fill": [{ "color": "#ffffff14", "kind": "solid" }],
        "padding": [5, 12],
        "radius": 999
      },
      "icon": "sparkles",
      "id": "selo",
      "label": "Ao vivo hoje",
      "textStyle": { "paint": { "color": "#e9d5ff", "kind": "solid" }, "size": 13 },
      "type": "badge"
    },
    {
      "id": "titulo",
      "lines": [
        [
          { "text": "Sua próxima aula " },
          {
            "style": {
              "paint": {
                "angle": 90,
                "kind": "linear",
                "stops": [{ "at": 0, "color": "#c084fc" }, { "at": 100, "color": "#22d3ee" }]
              }
            },
            "text": "começa às 20h"
          }
        ]
      ],
      "textStyle": { "align": "center", "size": 32 },
      "type": "heading"
    },
    {
      "id": "texto",
      "lines": [[{ "text": "Entre alguns minutos antes para pegar um bom lugar e mandar as suas perguntas." }]],
      "textStyle": { "align": "center", "paint": { "color": "#d4d4d8", "kind": "solid" }, "size": 16 },
      "type": "text"
    },
    {
      "action": { "kind": "cta" },
      "box": {
        "fill": [
          {
            "angle": 90,
            "kind": "linear",
            "stops": [{ "at": 0, "color": "#7c3aed" }, { "at": 100, "color": "#2563eb" }]
          }
        ],
        "padding": [14, 24],
        "radius": 14,
        "shadows": [{ "blur": 32, "color": "#7c3aed66", "spread": 0, "x": 0, "y": 8 }]
      },
      "id": "botao",
      "place": { "margin": [6, 0, 0, 0], "mode": "flow", "width": "fill" },
      "textStyle": { "size": 16 },
      "type": "button"
    },
    { "id": "links", "textStyle": { "paint": { "color": "#a1a1aa", "kind": "solid" }, "size": 14 }, "type": "links" }
  ],
  "close": { "background": "#ffffff14" },
  "fonts": [],
  "mode": "free",
  "version": 1
}
```

**Em branco** (só o fundo, um título, o botão e os links):

```json
{
  "artboard": {
    "border": { "color": "#ffffff1a", "width": 1 },
    "gap": 14,
    "padding": [28, 24, 12, 24],
    "shadows": [{ "blur": 80, "color": "#000000b3", "spread": 0, "x": 0, "y": 24 }]
  },
  "assets": [],
  "children": [
    { "id": "titulo", "lines": [[{ "text": "Seu título aqui" }]], "type": "heading" },
    {
      "action": { "kind": "cta" },
      "box": { "fill": [{ "color": "#ffffff", "kind": "solid" }], "padding": [13, 24], "radius": 999 },
      "id": "botao",
      "textStyle": { "paint": { "color": "#16181c", "kind": "solid" }, "size": 16 },
      "type": "button"
    },
    { "id": "links", "textStyle": { "paint": { "color": "#a1a1aa", "kind": "solid" }, "size": 14 }, "type": "links" }
  ],
  "close": { "background": "#ffffff14" },
  "fonts": [],
  "mode": "free",
  "version": 1
}
```

**Imagem recortada com selo** (<!-- ia:fora -->L1.1: <!-- /ia:fora -->a imagem sem fundo solta à direita, uma mancha de luz atrás dela, o selo inclinado por cima, o texto numa coluna à esquerda e os dois botões lado a lado, que passam para baixo quando o texto do botão é longo):

```json
{
  "artboard": {
    "align": "start",
    "border": { "color": "#ffffff1a", "width": 1 },
    "fill": [{ "angle": 135, "kind": "linear", "stops": [{ "at": 0, "color": "#1e1b4b" }, { "at": 100, "color": "#0f172a" }] }],
    "gap": 0,
    "minHeight": 320,
    "padding": [36, 32, 12, 32],
    "radius": 28,
    "shadows": [{ "blur": 80, "color": "#000000b3", "spread": 0, "x": 0, "y": 24 }],
    "width": 480
  },
  "assets": [],
  "children": [
    {
      "box": {
        "blur": 30,
        "fill": [
          { "extent": "closest-side", "kind": "radial", "stops": [{ "at": 0, "color": "#8b5cf680" }, { "at": 100, "color": "#8b5cf600" }], "x": 50, "y": 50 }
        ]
      },
      "id": "brilho",
      "name": "Brilho",
      "place": { "h": 280, "mode": "free", "w": 280, "x": 250, "y": -40, "z": -1 },
      "shape": "ellipse",
      "type": "shape"
    },
    {
      "asset": null,
      "fit": "contain",
      "id": "foto",
      "name": "Imagem recortada",
      "place": { "h": 200, "mode": "free", "w": 170, "x": 290, "y": 50 },
      "type": "image"
    },
    {
      "box": { "fill": [{ "color": "#facc15", "kind": "solid" }], "padding": [6, 12], "radius": 8 },
      "id": "selo",
      "label": "Aula bônus",
      "place": { "mode": "free", "rotate": -8, "w": 128, "x": 288, "y": 34, "z": 2 },
      "textStyle": { "align": "center", "paint": { "color": "#111111", "kind": "solid" }, "size": 14, "weight": 800 },
      "type": "badge"
    },
    {
      "children": [
        {
          "id": "titulo",
          "lines": [
            [{ "text": "Comece hoje" }],
            [
              {
                "style": { "paint": { "angle": 90, "kind": "linear", "stops": [{ "at": 0, "color": "#a78bfa" }, { "at": 100, "color": "#22d3ee" }] } },
                "text": "em 7 passos"
              }
            ]
          ],
          "textStyle": { "lineHeight": 1.05, "size": 34 },
          "type": "heading"
        },
        {
          "id": "texto",
          "lines": [[{ "text": "Um passo por dia, com exercícios curtos e uma aula ao vivo no fim." }]],
          "textStyle": { "lineHeight": 1.45, "paint": { "color": "#cbd5e1", "kind": "solid" }, "size": 17 },
          "type": "text"
        },
        {
          "children": [
            {
              "action": { "kind": "cta" },
              "box": { "fill": [{ "color": "#ffffff", "kind": "solid" }], "padding": [12, 18], "radius": 12 },
              "id": "botao",
              "textStyle": { "paint": { "color": "#0f172a", "kind": "solid" }, "size": 16 },
              "type": "button"
            },
            {
              "action": { "kind": "close" },
              "box": { "border": { "color": "#ffffff40", "width": 1 }, "padding": [11, 16], "radius": 12 },
              "id": "agoranao",
              "label": "Agora não",
              "textStyle": { "size": 16, "weight": 600 },
              "type": "button"
            }
          ],
          "id": "acoes",
          "layout": { "align": "center", "dir": "row", "gap": 8, "wrap": true },
          "place": { "margin": [8, 0, 0, 0], "mode": "flow" },
          "type": "box"
        }
      ],
      "id": "coluna",
      "layout": { "align": "start", "gap": 12 },
      "place": { "mode": "flow", "width": 256 },
      "type": "box"
    },
    {
      "id": "links",
      "place": { "margin": [12, 0, 0, 0], "mode": "flow" },
      "textStyle": { "paint": { "color": "#a5b4fc", "kind": "solid" }, "size": 14 },
      "type": "links"
    }
  ],
  "close": { "background": "#00000066" },
  "fonts": [],
  "mode": "free",
  "version": 1
}
```

### 9.10 Celular

Na tela do aluno com até 767 px de largura (o celular; as prévias do editor de 375 px também), o pop-up usa o desenho do computador encolhido na mesma proporção, com o texto nunca abaixo de 12 px. Quando algo precisa ser diferente só no celular (um título menor, um selo em outro lugar, uma imagem escondida), a raiz ganha `devices.mobile` só com o que muda. Medidas em px da prancheta, como no computador: o encolher e o piso de 12 px continuam valendo por cima. `version` continua `1`.

| Chave | O que é |
|---|---|
| `devices.mobile.artboard` | a prancheta no celular: só `padding` (lados, 0 a 200), `gap` (0 a 96) e `minHeight` (0 a 1.600) |
| `devices.mobile.nodes` | um objeto com o id de cada elemento que muda no celular (até 32), cada um só com os campos abaixo |

| Campo do elemento | Vale para | O que muda |
|---|---|---|
| `hidden` | todos | `true` esconde só no celular; `false` mostra só no celular um elemento escondido no computador |
| `place` | todos | com o **mesmo** `mode` do computador (sem `place` no computador = `flow`): solto (`free`) com `x`, `y`, `w`, `h`; na sequência (`flow`) com `width`, `height`, `margin`, `align`; os mesmos limites de 9.3 Campos; nunca `z` nem `rotate` |
| `textStyle` | Título, Texto, Selo, Botão, Links | só `size`, `lineHeight`, `letterSpacing` e `align` |
| `box` | todos | só `padding` e `radius` |
| `size` | Espaço (0 a 400) e Ícone (8 a 160) | o tamanho |
| `gap` | Links (0 a 96) | o espaço entre os links |
| `layout` | Caixa | `dir`, `gap`, `align`, `justify`, `wrap` |

Regras:

- Cores, textos, pinturas, fundos, bordas, sombras, fontes, camada (`z`) e girar (`rotate`) são os mesmos no computador e no celular: não têm versão do celular.
- Cada parte entra campo a campo por cima da do computador: `{ "place": { "mode": "free", "x": 24 } }` muda só o X; o Y, a largura, a altura, a camada e o girar continuam os do computador. `size`, `gap` e `hidden` trocam o valor inteiro.
- Um elemento solto continua solto no celular e um da sequência continua na sequência: um `place` com outro `mode` é recusado (`No celular, o elemento fica como no computador: solto continua solto e na sequência continua na sequência.`). Campo fora desta lista (ou de outro tipo, como `size` num Título) é recusado.
- Um id que não existe, um objeto vazio e um valor igual ao do computador saem sozinhos (a forma canônica); sem nada que mude, `devices` sai.

Exemplo (o título menor e centralizado, o selo mais à esquerda, o texto só no computador e menos respiro no celular):

```json
{
  "mode": "free",
  "version": 1,
  "children": [
    { "id": "selo", "type": "badge", "label": "Novidade", "place": { "mode": "free", "x": 300, "y": 16, "w": 116 } },
    { "id": "titulo", "type": "heading", "lines": [[{ "text": "Aula nova no ar" }]], "textStyle": { "size": 40 } },
    { "id": "texto", "type": "text", "lines": [[{ "text": "Assista hoje e coloque em prática." }]] },
    { "id": "links", "type": "links" }
  ],
  "devices": {
    "mobile": {
      "artboard": { "padding": 16 },
      "nodes": {
        "selo": { "place": { "mode": "free", "x": 24 } },
        "texto": { "hidden": true },
        "titulo": { "textStyle": { "align": "center", "size": 32 } }
      }
    }
  }
}
```

<!-- ia:fora -->
Por dentro: `resolveFreeForDevice(design, device)` mora em `popup-free-render.ts` (o único módulo de valores que o cartão do aluno importa; `popup-free-model.ts` reexporta): `"desktop"`, ou um design sem `devices.mobile`, devolve o mesmo objeto; `"mobile"` junta a prancheta e, por elemento, `place`, `textStyle`, `box` e `layout` campo a campo (`size`, `gap` e `hidden` trocam). O aluno usa o celular quando `matchMedia("(max-width: 767px)")` casa (a mesma regra em todo lugar); as prévias do admin passam `device` (a de 375 px é o celular). O schema confere o modo da posição, o tipo de cada campo e o limite do Ícone nas regras entre partes (que sabem o tipo do elemento); a estimativa do tamanho conta `devices` (é a da forma canônica). As ajudas do editor mantêm o mapa coerente: duplicar copia a entrada para o id novo (o solto anda 16 px também no celular), excluir tira a entrada do elemento e de tudo dentro dele, **Soltar**, **Seguir a sequência** e **Colocar dentro da caixa** (quando o solto vira sequência) tiram a posição do celular (desde o L4b, a Forma e a Caixa com largura ou altura próprias no celular ficam com elas na sequência do celular, `{ "mode": "flow", "width", "height" }`, §8 L48), e **Ajustar os elementos à nova largura** escala os valores do celular junto. Colar deixa `devices` passar (ids que não existem saem na forma canônica). A dica "texto no celular" mede o design do celular (com os valores próprios) e, quando o tamanho do texto é do celular, leva a `devices.mobile.nodes.<id>.textStyle.size`. Sem migração: a coluna e o check de 32 KB já aceitam.
<!-- /ia:fora -->

## 10. Fica de fora

| Fora desta entrega | Onde está |
|---|---|
| Dica do peso das imagens (precisa do tamanho do arquivo, que o design não guarda); capa de vídeo tirada de um vídeo que já está no Storage (precisa de CORS no `canvas`) | ficaram do L1.1 (que entregou o copiar e colar, as instruções para a IA, "Usar o design Personalizado", o quarto modelo e a dica nova, §13); vão para o L5 (Meus modelos e biblioteca de imagens), junto com o tamanho dos arquivos já enviados |
| "Criar com IA" (texto e/ou imagem de referência pela conta conectada no gateway) | PR L2 (§9.8 e spec §5.7) |
| Valores próprios do celular por elemento (`devices.mobile`) | feito no PR L3 (§9.10; no editor, §13.8) |
| Cores, textos, pinturas, sombras, camada e girar diferentes no celular; um terceiro aparelho (tablet) | fora de propósito (L3): um desenho só, com o que muda de tamanho e lugar por aparelho |
| Arrastar nas Camadas e nas camadas de fundo, arrastar elementos da sequência no desenho, arrastar do painel Elementos para o desenho | feito no L4a, 25/10/2026 (§13.9) |
| Seleção de vários, distribuir, `Alt + clique`, zoom com passos, até 3 botões "Abrir um link"; e do que o L4a deixou de fora: a rolagem sozinha perto da borda (nas Camadas, no desenho e no Elementos), o solto e as alças pelo dedo e a Forma e a Caixa levadas para a sequência guardarem a largura e a altura | feito no L4b, 25/10/2026 (§13.10) |
| Retângulo de seleção no desenho (decisão 7 do produtor); redimensionar e girar o grupo; arrastar vários da sequência ou várias linhas nas Camadas; mudar propriedades em comum com vários (cor, fonte, tamanho) e "Colocar numa caixa nova" (que também dá o "Alinhar no pop-up" em bloco); zoom de 25, 300 e 400 % (com os contornos por `box-shadow`), andar com Espaço, zoom no escolhido, a pinça do Safari e guardar o zoom entre aberturas; guias de espaço igual ao arrastar e alinhar a um elemento escolhido como referência; o menu "Selecionar camada" no clique direito; levar a qualquer vão num passo só pelo teclado nas Camadas (pegar a linha com uma tecla e levar com as setas); solto entrando em caixa pelo desenho; arrastar pelo toque nas Camadas e no Elementos; reordenar sombras e linhas de texto; o relatório "Clicaram em cada botão" (os dados já são gravados desde o L4b, L47; pede migração e medida nova); a dica no Revisar para um elemento com camada negativa dentro de uma caixa com fundo | PR L4c |
| Reordenar as paradas do degradê | fora: a ordem vem de `at` no desenho, na prévia e na forma canônica, e um arrastar seria desfeito ao salvar (L49); se fizer falta, um "Inverter o degradê" no L4c |
| Salvar como modelo | feito em 25/10/2026 (`docs/28`): "Meus modelos" e "Salvar design como modelo" no card Design e a aba **Modelos** do editor Livre ("Salvar este design como modelo" e "Usar este modelo", um passo só no histórico) |
| Copiar elementos entre pop-ups, biblioteca de imagens, cores salvas, migração para subir o teto de tamanho | PR L5 |
| Consertos do que o aluno já via: os Links que não sublinhavam ao passar o mouse (e a linha invisível dos Links em degradê), o anel de foco apagado pela sombra própria do botão, o aperto de 1 px e a escala da janela que pulavam sem animar; a régua do pedaço do cartão no verify | feito no L6a, 26/10/2026 (§13.11.1, L50 e L51) |
| Contorno do texto e marca-texto; e a linha própria de uma parte de Título ou Texto em degradê, hoje invisível pelo mesmo motivo dos Links (a linha usa a cor da parte, que é transparente) | PR L6b |
| Cores ao passar o mouse (Botão e Links) | PR L6c |
| Animação de entrada | PR L6d |
| Textura e mistura de cores | PR L6e |
| Contador e o quinto modelo para começar | PR L6f |
| Texto escrito direto no desenho (Título e Texto) | PR L6g |
| A mesma escala que pula sem animar fora do Livre, em 5 lugares: na área do aluno, o painel do sino (`member-notifications-menu.tsx`, ao abrir) e o ícone redondo do botão de retomar de Minhas compras (`purchases-experience.tsx`, que cresce 5 % ao passar o mouse com a transição de `transform` e da cor de fundo: a cor anima, a escala pula); no admin, três menus (`admin/v2/styles.ts`, `period-menu.tsx` e o menu de `free-fields.tsx`), que listam `transform` na transição e escalam ao abrir | PR de correção à parte, fora do L6 (L51) |
| Limpeza de imagens, vídeos e fontes sem uso no Storage | feito em 23/10/2026 (`docs/22` §4.6) |
| HTML ou CSS escrito pela equipe; mídia ou fonte de fora; texto em imagem no lugar de texto | nunca |
| Ponta a ponta no WebKit dos arquivos novos (e a foto dos cantos do vídeo com máscara, spec §3.2) | rodados no Chromium; o WebKit roda no CI |

## 11. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/popup-livre-modelo.test.mjs` (41) | schema estrito em todo nível (inclusive `url` e o que não é da §9.10 dentro de `devices`), documento mínimo, limites e frases, ids, profundidade, contagens, botões e links, 1.200 letras, caminhos dos buckets, capa, X visível, link seguro, estimativa do jsonb contra o banco, teto de tamanho, forma canônica, roteador, caminhos gravados, regras com o conteúdo, chaves de erro, reescala, `freeDesignForStudent`, origem e endereço dos arquivos, os 4 modelos, sincronia do Áudio, JSON Schema (e só o módulo próprio chama o `toJSONSchema`, nenhuma tela o importa), os exemplos desta §9, dicas e vocabulário; Celular (L3): o formato de `devices.mobile` vale, chave a mais, camada, girar, cor e campo de outro tipo recusados, limites do computador (o do Ícone também), até 32 entradas, a posição no modo do computador, a forma canônica (id que não existe, objeto vazio e valor igual ao do computador saem; sem nada, `devices` sai), `resolveFreeForDevice` (o computador devolve o mesmo objeto; o celular junta campo a campo; escondido ou mostrado só no celular), a reescala com o celular, duplicar/excluir/Soltar/Seguir a sequência/Colocar dentro da caixa com o mapa coerente, o tamanho contando `devices`, as chaves pelo id e o exemplo da §9.10; L4b: até 3 "Abrir um link" em qualquer mistura com Fechar e Lembrar depois (o 4º botão além do principal recusado só com a frase dos botões) e os 3 iguais na ida e na volta da forma canônica |
| Unitário | `tests/popup-livre-desenho.test.mjs` (39) | o desenho do aluno: sequência e solto em `cqw`, prancheta que cresce até os soltos, altura mínima nos textos, piso de 12 px, pinturas, `url()` só da origem conferida (14 origens maliciosas), esmaecer, texto em degradê, links, h2 e descrição, vídeo × capa, cliques, foco visível, `sizes`, quadriculado só na prévia, escondido, ordem do DOM, `dragPreview` e o **HTML do Padrão e do Personalizado igual ao de antes do Livre**; Celular (L3): `device="mobile"` desenha posição, largura, fonte e respiro do celular em `cqw` e não desenha o escondido só no celular; sem `device` (e no servidor) valem os do computador; a tela de até 767 px é o celular e a troca de largura avisa o cartão; o nome e a descrição do diálogo pelo aparelho da tela, com a janela ouvindo o mesmo aparelho do cartão (um `matchMedia` falso vira com o pop-up aberto e o nome troca junto); as prévias do admin passam o aparelho (a de 375 px desenha o celular, as miniaturas o computador); e o **HTML do Livre no computador igual ao de antes do Celular**; L4b: o `dragPreview` com `ids` desloca todos os listados (a largura e a altura só no `id`), 3 "Abrir um link" viram 3 links com o seu destino e o `onCta` recebe `cta` ou `link:<id>`; L6a: os Links sem linha escolhida não levam linha nenhuma no estilo em linha (vale o sublinhado ao passar o mouse; na prévia, o mesmo estilo), com Sublinhado ou Riscado a linha fica e, em degradê, a cor da linha é a primeira parada, também com Sublinhado (C21); o anel de foco pelo `box-shadow` inteiro com `!important` nos botões, nos links e no X, sem o anel antigo, com a sombra própria do botão no estilo em linha; o aperto com a transição de `filter` e `translate`, nada de `transform` e nada com menos movimento; e a amostra de antes do Celular gerada de novo no L6a, só com essas trocas |
| Guarda | `tests/popup-livre.guard.test.mjs` (6) | sem HTML/CSS em texto, o cartão sem zod/modelo/dicas, o cartão só por `import()` (do Livre, a janela só leva a porta do pedaço e o aparelho da tela, `popup-free-device.ts`, sem imports), `url(` só pelo `freeAssetUrl`, o editor fora do lado do aluno, nenhuma migração nova |
| Guarda | `tests/popup-design.guard.test.mjs` (8; um teste do L6a) | L6a, a janela do pop-up anima a escala: a classe da janela com escala de 95 % lista `opacity` e `scale` na transição, encolhe ao fechar e não tem transição com menos movimento; em `src/components/member/notifications`, toda classe que escala e tem transição lista `scale` (ou `all`, ou uma transição que já a cobre), e a regra recusa a classe de antes |
| Guarda | `tests/tailwind-regras-de-exemplo.guard.test.mjs` (2) | L6a, o CSS global: o mesmo scanner e o mesmo compilador do build leem o projeto, e toda classe que vira regra está no código de `src/` (comentário não conta); as 19 regras de exemplos de antes do L6a numa lista que só encolhe; o segundo teste prova que o comentário (de linha, de bloco, do JSX e do CSS) não conta e que a string, o template e o JSX contam |
| Unitário | `tests/livre-medir-cartao.test.mjs` (5) | L6a, a régua do pedaço do cartão (`scripts/livre-medir-cartao.mjs`) numa pasta `.next` de mentira no formato do Turbopack: segue as referências desde o manifesto do Início; ignora o pedaço velho sem referência, o do editor (`data-free-editor`) e o do JS inicial; soma o que vem no `import()` do cartão e o que só ele alcança, e deixa de fora o pedaço comum; gzip; a janela como grupo; o JS inicial pelo `docs/29` §7.2; erro com nenhum ou dois cartões e sem build; a linha de comando sai com 0 e imprime o tamanho e a folga, e sai com 1 acima de 12.288 B; o `verify` termina com a régua, depois do build |
| Unitário | `tests/popup-livre-editor-modelo.test.mjs` (38) | onde o elemento entra, foco no envio, duplicar/excluir/subir/descer/caixas (a frase do Excluir dos Links), soltar e seguir a sequência, setas, redimensionar com Shift, alinhar no pop-up, guias, escala do zoom e do celular, arrastar = um passo, histórico (junta, guarda o `cta`, 100 passos, modelo e recuperar), cópia de recuperação (com o `allowSnooze` ao lado do `cta`), `freeDirtySinceSave` (a regra do "Lembrar depois" conta como mudança desde o salvar; o editor do aviso só troca de endereço com os dois lados limpos) e `allowSnoozeToRestore` (só booleano e diferente), teclado das Camadas, as etiquetas das Camadas a 12 px, o botão e a frase do salvar no pop-up no ar (L16), o Botão principal sem destino no Revisar (a frase do Personalizado, o mesmo erro do salvar e do card, o "Para onde leva", some ao preencher), vocabulário; Celular (L3): com o Celular, arrastar um solto, alças, setas e Alinhar no pop-up gravam em `devices.mobile` e não no computador (a entrada nasce e some sozinha), Soltar e Seguir a sequência tiram a posição do celular, um passo por gesto e as setas do celular juntando à parte, a etiqueta `Celular` nas Camadas e no desenho a 12 px, o **Ajustar no Celular** da dica e as frases faladas, o **Aumentar a altura** do celular (grava a Altura mínima do celular, comparando com a prancheta do celular) e a chave do celular do Revisar, do Ajustar no Celular e do erro que abre o editor ligando o Celular; L4a: o painel Elementos e o desenho sem texto abaixo de 12 px (os nomes dos grupos e dos botões e o nome do selecionado); L4b: as teclas de vários das Camadas (Shift + ↓ estende, Ctrl ou ⌘ + Enter põe ou tira), o Botão principal duplicado até 3 "Abrir um link" (o 4º recusado, e o Elementos › Botão desligado com a mesma frase), **Seguir a sequência** com a Forma e a Caixa guardando a largura e a altura (no computador e, com tamanho próprio, no celular), o **Alinhar no pop-up** pela caixa que se vê e as frases do zoom |
| Unitário | `tests/popup-livre-painel-modelo.test.mjs` (39) | área de texto (Enter, limites, acentos e emoji), Outro estilo na seleção, editar mantendo estilos (400 edições aleatórias), voltar ao estilo, paradas, camadas de fundo, lados, sombras, chave de erro → aba e campo, "Abrir um link" que nunca desliga (desde o L4b, com outro botão já em link a pílula continua ligada), reescala, pesos, imagem até 1.600 px e 420 KB, Links › Conteúdo desenhado (a chave "Permitir “Lembrar depois”" no aviso; na página do modelo de Design, só a nota), vocabulário; Celular (L3): os campos de cada tipo (nunca cor, camada ou girar), Igual ao computador ligada e desligada (começa do computador), Voltar tudo ao do computador, o No celular da prancheta, chave de erro do celular → aba Celular e campo (e a da prancheta → No celular), a aba e o grupo desenhados (uma chave com nome por campo, o erro no campo e o do modo no topo), a Altura própria do celular de um texto solto sem altura no computador (aparece em Altura, o Revisar cai nela e sai com Igual ao computador), o alinhamento do botão sem escolha = o centro desenhado (o `Esquerda` do celular fica ao salvar), entrar na aba Celular liga o Celular e sair mantém, frases palavra por palavra; L4a (o Fundo): `moveFreeFillLayerTo` (a posição final sem perder nem duplicar camada; o mesmo lugar e fora da lista dão null; o design vale num Selo e na prancheta em toda ida), `freeFillDropIndex` e `freeFillDropAt` (32 px de folga), `freeFillReorder` (só com o fundo do começo), a amostra da ficha só com hex validado, o foco que segue a camada (Subir, Descer, a faixa, Tirar e **+ Camada**, que com a lista cheia leva à ficha nova), a imagem que acha a sua camada pela própria camada e o cartão que espera desligado, a imagem que termina de subir depois de a camada sumir (Ctrl + Z no envio) sem passo vazio (o Refazer continua), mudar a ordem como passo próprio montado pelo design mais novo (uma mudança em outro elemento fica; a cor junta pela chave), e a faixa **Ordem** desenhada (só com 2 ou 3 camadas, as fichas com o nome, `aria-keyshortcuts`, `touch-none` e os ids do foco) |
| Unitário | `tests/popup-livre-arrastar-modelo.test.mjs` (27) | L4a, o núcleo do arrastar: levar a (pai, vão) com `devices` igual; as recusas (o mesmo lugar não é passo, a caixa não entra nela mesma, 20 por caixa só quando o pai muda, a profundidade); o solto que entra numa caixa vira sequência e o reordenado na prancheta continua solto; paridade com o Subir e o Colocar dentro (travado, escondido, Links e Áudio); **Tirar da caixa** nunca deixa 21; as frases do mover e os textos palavra por palavra (os Atalhos com 17 linhas desde o L4b, a do Esc no mesmo lugar); Camadas: onde cai pela altura da linha e todo lugar válido alcançável pelas linhas; desenho: os lugares que recebem (a prancheta em coluna, as caixas desenhadas, o índice real), o solto girado (a subárvore fica de fora, dentro dele nada muda e `freeFlowDraggable` não deixa a alça aparecer), os motivos de recusa e o aparelho do palco, o lugar na coluna, na linha e na linha com quebra, a faixa da borda, a caixa vazia de 24 px, a caixa cheia, o empate, o ponto fora, a ordem de pintura e o mesmo vão; o ponto da tela em px da prancheta (a borda, o zoom e o Celular); Celular: o lugar pelo desenho do celular e a mesma ordem nos dois aparelhos; o elemento novo onde soltou (o vão, a Forma e o Degradê pelo ponto, os mesmos limites do clique, o fundo de uma prancheta alta); guardas de fonte do editor (o ramo `move`, um passo sem juntar, a frase do Celular em toda mudança de ordem) e do desenho (`previewDrop`, as etiquetas de 12 px, a alça só quando o arrastar pode começar); L4b: a Forma e a Caixa soltas que entram numa caixa guardam a largura e a altura, e a camada abaixo de 0 vira 0 em todo tipo, também para quem já está na sequência e entra numa caixa |
| Unitário | `tests/popup-livre-ponteiro.test.mjs` (21) | L4a, `followFreePointer` com uma janela falsa: toque, botão 2, ponteiro que não é o principal e caneta sem pedir não ligam nada; antes do limiar é clique (nada capturado, o click passa); a partir do limiar a captura é tentada (e falha sem quebrar), outro ponteiro é ignorado e o `pointerup` solta uma vez; `buttons` 0, `pointercancel` e o blur da janela cancelam; `Esc` cancela com a propagação parada; o bloqueador do click (o primeiro click, o próximo `pointerdown`, 350 ms, e sem o `pointerup` depois de `Esc` ou blur); `Esc` antes do limiar desliga o gesto; as teclas engolidas, menos Shift, Alt, Control e Meta; o `lostpointercapture` não chama nada; o `dragstart` barrado; a função devolvida; e a guarda: carrega no Node sem janela, sem HTML nem CSS em texto; L4b: o `onMove` com Alt e Shift, `freeAutoScrollStep`, a rolagem sozinha só com o gesto começado e armada por eixo (C10: entrar pela faixa ou começar nela não rola; descer em linha reta a partir da faixa da esquerda rola), o `onMove` com o último ponto só quando rolou, o laço parando em todo fim de gesto e o dedo só quando a chamada pede |
| Unitário | `tests/popup-livre-distribuir-e-zoom-modelo.test.mjs` (21) | L4b, a geometria pura: a caixa que se vê de um girado, a caixa de vários, alinhar numa moldura (o de um elemento dá o mesmo X ou Y de antes), espaços iguais (as pontas paradas, até 1 px de diferença, o empate pela ordem, espaço negativo, menos de 3 dá zeros), o limite comum do grupo nas quatro bordas, a sessão de vários (a prévia com `ids`, as guias pela caixa do grupo, sem guias com um girado, o fim inteiro e sem −0; um elemento só arrasta como antes), o limiar e a guia a 200 %, os passos do zoom e o passo seguinte a partir da escala mostrada, a roda com Ctrl (50 px por passo, um entalhe em linhas ou em páginas vale um passo, no máximo um por movimento, virar de sentido zera), o ponto sob o ponteiro ao mudar o zoom, o ponteiro com a rolagem somada e o menor rolar para mostrar o escolhido |
| Unitário | `tests/popup-livre-selecao-modelo.test.mjs` (19) | L4b, a seleção de vários pura (`free-editor-selection.ts`): viva e normalizada (caixa e filho: fica o último), pôr e tirar, o intervalo das Camadas, o Ctrl + A pelo aparelho, o Esc, a pilha do ponto e o próximo dela, mover junto (o grupo não se deforma na borda; no Celular só `devices.mobile`), alinhar entre si e no pop-up pela caixa que se vê, os motivos, espaços iguais, duplicar (Links, Áudio e Vídeo de fora; atômico com 32 elementos, 24 soltos, 20 por caixa e 3 botões), excluir (Links e Áudio ficam; o Botão principal tira o botão do aviso; o celular dos excluídos sai junto), esconder, travar e a camada no limite, a descrição do palco, as frases palavra por palavra, o vocabulário e o módulo puro |
| Unitário e guarda | `tests/popup-livre-desenho-fonte.test.mjs` (14) | L4b, o desenho (`free-canvas.tsx`): as regras do `pointerdown` e do clique como funções puras (Shift, Ctrl ou ⌘ põe ou tira; o grupo arrasta junto e o clique sem arrastar deixa só ele; o Alt leva o de cima e arrasta sem guias, e só o clique anda na pilha, a partir do principal de antes; Alt + Shift só acrescenta), o desenho com vários e com um (`react-dom/server`) e as guardas: o solto e as alças pelo `followFreePointer` com mouse, caneta e dedo e a sequência só com mouse e caneta, a primeira linha do `pointerdown`, as alças antes de qualquer regra de tecla (C14), o gesto desligado ao recomeçar e ao desmontar (C13), a roda não passiva e a âncora só nos pedidos de zoom (C12), a api depois de `visibleCenter`, a moldura que não corta e nada abaixo de 12 px |
| Unitário e guarda | `tests/popup-livre-camadas-varios.test.mjs` (12) | L4b, as Camadas com vários: `aria-current` só no principal, `Na seleção` nas outras (também numa linha sem outra etiqueta, lida pelo `aria-describedby`, C1), o Tab no principal e, sem a lista, as Camadas como antes; o clique com Ctrl, ⌘ e Shift, o arrastar que não começa com tecla, as teclas da linha na seleção e o olho, o cadeado e o `⋯` só na linha (C17), Shift + ↑/↓ e Ctrl ou ⌘ + Enter, a lista que rola sozinha e nada abaixo de 12 px |
| Unitário | `tests/popup-livre-varios-tela.test.mjs` (9) | L4b, o painel Vários desenhado (`react-dom/server`): o título focável, a dica e a lista com **Escolher só**, os 12 nomes de alinhar distintos, cada comando (o **Alinhar no pop-up** leva cada um à prancheta), os grupos desligados com o motivo de 12 px ligado pelo `aria-describedby`, Esconder ou Mostrar e Travar ou Destravar pela regra, a nota do Celular, o editor desligado, nada abaixo de 12 px e o vocabulário |
| Unitário | `tests/popup-livre-zoom-tela.test.mjs` (6) | L4b, o controle de zoom: os nomes, os atalhos (`Control` e `Meta`), o gatilho com a escala que se vê, as pontas com `aria-disabled` e o motivo, o menu de rádio só com os passos pedidos e o foco de volta ao gatilho |
| Unitário e guarda | `tests/popup-livre-editor-varios-fonte.test.mjs` (19) | L4b, a casca (`free-editor.tsx`): as regras de escolher como funções puras (os pedidos do desenho e das Camadas, Alt + Shift só acrescenta, pôr ou tirar com a frase, o intervalo sem âncora só acrescenta, o Ctrl + A pelo palco, o foco do painel da direita (C11, também de um para nada), a seleção viva depois de desfazer e refazer e as teclas do zoom) e as guardas: a mesma lista viva para o desenho, as Camadas e o painel Vários, o desfazer e o refazer passando a seleção viva pela troca de painel (com o Revisar aberto, o foco fica), o **Voltar ao elemento** com o pedido de foco, um passo por comando de vários, o teclado com vários, o painel de um elemento montado e escondido, o `FreeZoomControl` na barra, o Ctrl + = depois do `if (typing) return`, a frase do Ajustar com a escala nova, o Elementos que rola o desenho (C15) e a `kbd` de 12 px |
| Unitário e integração | `tests/pop-ups-v3b1-rotas.test.mjs` (26), `tests/pop-ups-v3b1-memoria.test.mjs` (16) e `tests/integration/pop-ups-relatorio.test.mjs` (5) | L4b, o clique por botão (L47): `popupClickedButton` e a conferência contra o design (visível no computador ou no celular; o `cta` pede o aviso com botão), a rota que grava `metadata.button` só no `clicked` conferido (Padrão, aviso sem botão e botão escondido nos dois aparelhos ficam sem a chave; com 2 e 3 links, cada clique com o seu id; a falha da leitura vira log; o teto de 8 KB e a cota de 30 por minuto continuam), o módulo só do servidor, o corpo do `postPopupEvent` (o `button` só no `clicked`) e o caminho do cartão ao host; com o banco, "Clicaram no botão" contando igual com e sem a chave |
| Unitário | `tests/popup-design-editor-modelo.test.mjs` (29) | os do Personalizado, mais: os três modos com memória (Livre e Personalizado nunca juntos no rascunho), os modelos do Livre (o "Saiba mais", o vídeo do Personalizado e a imagem do aviso como capa, só caminhos), o rascunho com as duas chaves, a forma canônica com o Livre, a prévia pelo item do Livre, o D9 com o "Abrir um link" do Livre, o D9 nos dois aparelhos (o "Abrir um link" ou o Botão principal escondido só no celular, L27), a sincronia do Livre com o botão e o áudio (que tira os valores do celular deles), a cópia nova do card palavra por palavra; L4b: o D9 por aparelho (links diferentes em cada aparelho valem; o Botão principal escondido no computador deixa de contar) e o `noticeDraftOfRow` abrindo um aviso já gravado assim com "Só quando o pop-up terminar", e o `noticeStopOnToPublish` que publicar e aprovar gravam na linha (o aluno recebe o que a equipe viu; o caso antigo do `popup_frequency` nulo não muda) |
| Unitário | `tests/popup-livre-copiar-colar.test.mjs` (21) | L1.1: copiar dá a forma canônica e colar devolve o mesmo design (e o mesmo texto); a resposta da IA com ```json em volta; arquivos de fora viram `asset: null`, a pintura e a capa de fora saem e os conhecidos ficam com as medidas daqui; as frases do colar (vazio, JSON quebrado, grande demais, Personalizado, zod com o nome do elemento, até 5 e "E mais N."); fonte fora da biblioteca vira Inter; o Botão principal e o Áudio acompanham o aviso; colar = um passo no histórico; os arquivos de todo o histórico; as instruções geradas do §9 (iguais ao arquivo, os exemplos colam e cabem no tamanho prometido, só por `import()`, nada busca o docs, nada de `.ts`, banco, bucket, jsonb, `z.` ou `§`, e o script para com um trecho sem marcador); todo modelo do Personalizado vira um Livre válido sem dica; o mapeamento (mídia e esmaecer, vídeo e capa, títulos, quebras, botões e brilho, segundo botão, Espaço, links, imagem no fundo com a cor clareada, degradê de outra cor, Sobre a mídia, X que precisa contrastar, sem imagem, imagem sem medidas, 4 títulos e 1.200 letras); toda combinação do Personalizado (modelo × largura × formato × posição × subir × respiro × mídia × degradê) passa no schema e na conta do tamanho com o texto no mesmo y (até 1 px), e cada subir de 0 a 60 com o respiro até 200 e a margem até 400; o corte das 1.200 letras com um emoji na fronteira (texto e botão); o card ("Usar o design Personalizado", o "Saiba mais"); o modelo novo; a conta do tamanho no celular e quando a dica aparece (texto longo, parte, selo solto, botão cortado, linha de botões, links); Celular (L3): colar com `devices` (o id que não existe e o igual ao computador saem, copiar de novo dá o mesmo, o erro diz o elemento: `“Título grande”, no celular: …`), as instruções com a 9.10 e o item 9 do guia, a dica "texto no celular" medida com os valores do celular (e a chave do celular); a lista das partes do §13.1 e a abertura do §9 iguais às do script; L4b: colar um design com o principal e 3 "Abrir um link" vale num passo, e as instruções sem o limite de um link |
| Integração | `tests/integration/pop-ups-livre-dados.test.mjs` (23) | salvar e ler na forma canônica sem endereço, o maior Livre aceito passa no check de 32 KB, Livre inválido some da lista e abre como Padrão, lista no ar e plano, notificação sem design, trocar para Padrão, aba antiga, sem chave mantém, duas chaves recusadas, duplicar, publicar e aprovar conferem fontes, fonte em uso, auditoria; Celular (L3): salvar e ler com `devices` na forma canônica (o aluno recebe os valores do celular; outro modo recusado em `draft.freeDesign.devices.mobile.nodes.<id>.place.mode`), um Livre sem `devices` igual byte a byte ao ler e salvar de novo, o maior Livre com `devices` passa no check de 32 KB sem migração; L4b: o Botão principal e 3 "Abrir um link" salvos e lidos na forma canônica (a aluna recebe os 3), o maior Livre com 3 links no check de 32 KB e o 4º botão 400 no elemento, um link só no computador e outro só no celular salvando "Quando o aluno clica no botão" (os dois escondidos no celular, 400), o Livre gravado antes com o Botão principal escondido no computador (nos dois aparelhos, ou visível só no celular) abrindo, publicando e sendo aprovado como "Só quando o pop-up terminar", com `popup_stop_on` `never` na linha depois de publicar e de aprovar (salvar de novo com o clique, 400) e a Forma com largura e altura na sequência, no computador e no celular, salva e lida igual |
| Integração | `tests/integration/pop-ups-livre-envios.test.mjs` (8) | `uploadPopupFreeImage` (WebP com alfa, caminho e medidas do servidor), recusas, 403, imagem nova inexistente, medidas trocadas pelas do servidor, caminho de outro lugar, vídeo não conferido recusado (o objeto fica, `docs/28` D16), vídeo do Personalizado reusado não apagado |
| Ponta a ponta | `tests/e2e/pop-up-livre-aluno.spec.ts` (10) | nome do diálogo, texto selecionável, selo sobre o vídeo que some, vídeo mudo tocando, X de 28 px com 44 px de toque, Tab nas Camadas e o X por último, `Esc`, clique conta, menos movimento sem vídeo, 375 px com 343 px e proporção, forma por cima do botão não impede o clique, `dismiss: false`, Padrão e Personalizado iguais; Celular (L3): publicar guarda `devices`, a 375 px a Mídia e a fonte do Título seguem o celular e a Forma escondida no celular some, a 1440 px vale o computador; L6a (um teste): "Não mostrar de novo" sem linha parado, sublinhado com o mouse em cima e sem linha de novo ao sair; no botão principal do modelo, que tem sombra própria, a transição calculada é `filter, translate` e, no Tab, o foco fica nele e o `box-shadow` calculado é só o anel de 4 px por dentro |
| Ponta a ponta | `tests/e2e/aluno-ve-pop-up.spec.ts` (4; L6a, um teste novo e passos num que já existia) | a janela de todo pop-up: ao abrir, a transição calculada é `opacity, scale` e o navegador anima as duas (um coletor de `transitionrun` posto antes da página); ao fechar, a escala anima de novo; com menos movimento, a transição é `none` e nada anima ao abrir nem ao fechar pelo X |
| Ponta a ponta | `tests/e2e/produtor-monta-pop-up-livre.spec.ts` (4) | num aviso novo: Livre, modelo, vídeo, duas linhas com cores pelo "Outro estilo na seleção", fonte enviada, Botão principal, Selo solto arrastado e com setas, Alinhar ao centro, respiro por lado, Imagem enviada arrastada até a borda (guia) e redimensionada com Shift, esconder e desfazer/refazer pelas Camadas, largura G, Computador e Celular, **Salvar rascunho com o editor aberto** (endereço de aviso novo, Ctrl + Z ainda desfaz), **Concluir** (endereço do aviso), recarregar igual, prévia, publicar, o gravado; a aluna a 1440 (texto real, cores, fonte, clique contado) e a 375 (343 px, proporção, nada abaixo de 12 px, X fecha); com o pop-up no ar, o editor Livre diz **Salvar alterações** e a frase do pop-up no ar, sem aplicar o "Mostrar de novo" ligado, que o salvar do aviso aplica depois (L16) |
| Ponta a ponta | `tests/e2e/pop-up-livre-editor-teclado.spec.ts` (3) | só teclado: abrir (foco nas Camadas), Tab passa pela lista uma vez, Título pelo Elementos, Forma movida com setas (posição falada), Alt + ↑, E, T, Ctrl + D, Delete, Ctrl + Z, o foco nunca cai no vazio nem sai do editor, linha vazia → Revisar → foco na área de texto, erro fora do editor → **Fechar o editor e revisar** → foco em **Abrir editor Livre**; **Trocar de modelo** confirma e Ctrl + Z volta ao design de antes; L4b (um terceiro teste, com rascunho próprio): Shift + ↓ e Ctrl + Enter nas Camadas, Delete nos dois com o foco na linha que ficou e Ctrl + Z, Ctrl + A no palco, **Escolher só Título** no painel Vários levando o foco ao palco, Ctrl + A no painel de um elemento levando o foco ao título do Vários e o `Esc` nele levando ao palco (C11), Ctrl + = e −, o **Duplicar** do painel Vários pelo Enter com o Ctrl + Z levando o foco ao palco e o Ctrl + Shift + Z refazendo sem escolher as cópias, **Voltar ao elemento** no Revisar levando o foco ao título do Vários ou ao palco, e o duplo clique no Título solto abrindo a área de texto, que com Alt ou Shift não abre (C18) |
| Ponta a ponta | `tests/e2e/produtor-copia-e-cola-livre.spec.ts` (1) | L1.1: num rascunho com o Personalizado "Só texto", Livre › **Usar o design Personalizado** (o editor abre com o título, o selo e o botão dele); **Copiar o design** (o JSON canônico na área de transferência, sem endereço); mudar o título e **Colar o design…** pela área de transferência (volta, num passo só: Ctrl + Z e Ctrl + Shift + Z); texto que não é JSON (a frase, o foco no campo); um design com a imagem de outro pop-up (a Imagem vazia e o Revisar pedindo a imagem; Ctrl + Z volta); **Copiar as instruções para a IA**; salvar e o gravado |
| Ponta a ponta | `tests/e2e/pop-up-livre-botao-sem-destino.spec.ts` (1) | num aviso novo sem botão, o modelo cria o "Saiba mais" sem destino: o salvar do aviso recusa e o foco vai para o `1 problema para revisar` do card, que abre o **Revisar** com o mesmo item (Botão principal, `Escolha para onde o botão leva.`); o item leva o foco ao "Para onde leva" no Conteúdo; o salvar de dentro do editor abre o Revisar com o item, que continua depois de mudar o texto do botão; escolhida a página, o item some, salva e o card fica sem problema |
| Ponta a ponta | `tests/e2e/produtor-ajusta-pop-up-livre-no-celular.spec.ts` (1) | L3: num rascunho Livre, a Forma selecionada com o Computador e a aba **Celular** ligando o **Ver como: Celular** (`Editando o Celular.`), arrastar o Selo (só o celular muda: o X do computador fica, a etiqueta `Celular` aparece), a aba **Celular** do Título (Tamanho 24 px com **Igual ao computador** desligada) e da Forma (escondida só no celular), **Salvar rascunho** com o editor aberto, recarregar (as etiquetas nas Camadas, a Forma some só no Celular) e publicar; o gravado tem `devices.mobile` com esses valores e o computador como estava |
| Ponta a ponta | `tests/e2e/produtor-arrasta-camadas-do-livre.spec.ts` (1) | L4a, nas Camadas de [Título, Texto, Caixa em coluna [Selo, Botão principal], Links]: um clique que treme 6 px na linha do Texto seleciona o Texto; o Texto no meio da linha da Caixa entra no fim dela (o contorno antes de soltar, a frase, o foco na linha e o Texto selecionado); Ctrl + Z e Ctrl + Shift + Z, um passo; o Selo no quarto de cima do Título sai da caixa e fica primeiro; a Caixa na linha do Botão de dentro dela (a recusa aparece, nada muda, sem passo vazio); `Esc` no meio (nada muda, a seleção e o foco ficam nas Camadas); abaixo da última linha, o fim do pop-up; a própria linha 6 px para baixo (nada aparece, a linha fica selecionada); com uma linha em Renomear, arrastar outra ainda move e o nome fica; Ver como Celular (a etiqueta e a frase); Shift + F10 › Tirar da caixa e › Colocar dentro da caixa com o foco na linha do Texto; Salvar rascunho e o gravado (a ordem, o nome e `devices` como foi semeado) |
| Ponta a ponta | `tests/e2e/produtor-arrasta-fundo-do-livre.spec.ts` (1) | L4a, o Fundo de um Selo com três camadas e da prancheta com duas: mudar a cor da Camada 1 e logo arrastar a ficha 3 para cima (o azul por cima); Ctrl + Z volta só a ordem e outro Ctrl + Z, a cor; Alt + ↑ duas vezes na ficha (o foco junto, a frase, as Camadas iguais); Subir num cartão leva o foco ao Subir do lugar novo; `Esc` no meio (nada muda, o Selo continua selecionado, o foco fica no Estilo); na prancheta, **+ Camada** cria a terceira (o foco na ficha nova) e arrastar a ficha 2 para cima é um passo; soltar longe da faixa não muda nada nem deixa passo vazio; Ver como Celular desenha a mesma ordem; Salvar rascunho e o gravado (o Selo e a prancheta na ordem certa, nada próprio do celular) |
| Ponta a ponta | `tests/e2e/produtor-arrasta-no-desenho-do-livre.spec.ts` (1) | L4a, no desenho de [Título, Texto, Caixa em coluna com respiro [Selo, Botão principal], uma caixa cheia de 20, Links], com a Caixa em linha só no celular: com os Links em Renomear, o Título desce um lugar (o nome fica; Ctrl + Z e Ctrl + Shift + Z, um passo); o Texto entra no fim da Caixa (a linha e a caixa de destino antes de soltar, o foco no palco) e sai pela faixa da borda de baixo; a Caixa vai para o topo pela alça; em cima da caixa cheia aparece o motivo e o `Esc` cancela (o foco no palco); soltar fora da prancheta não muda nada; Ver como Celular: o Selo à direita do Botão (a etiqueta e a frase) e o Computador com a mesma ordem; Salvar rascunho e o gravado (`children` com a ordem nova, `devices` como foi semeado) |
| Ponta a ponta | `tests/e2e/produtor-arrasta-elementos-para-o-livre.spec.ts` (1) | L4a, do painel Elementos para o desenho de [Título, Caixa em linha [Ícone, Ícone], Fechar, Links]: a dica de 12 px; o Texto até o vão entre o Título e a Caixa (a linha e a ficha antes de soltar; entra em segundo, selecionado, o foco na área de texto, um passo no Ctrl + Z); outro Texto entre os dois Ícones entra na Caixa, pelo x; a Forma com o centro onde soltou (X e Y do Avançado); soltar fora da prancheta e no próprio painel e `Esc` no meio não acrescentam (a seleção e o foco ficam); um clique no Selo logo depois acrescenta um só; Salvar rascunho e o gravado, sem nenhum elemento a mais |
| Ponta a ponta | `tests/e2e/produtor-seleciona-varios-no-livre.spec.ts` (1) | L4b, num rascunho com [Título, três Formas soltas, uma Forma travada por cima da terceira, Caixa [Selo], Links]: Shift + clique e Ctrl + clique nas três Formas (o clique na terceira passa pela travada), os três contornos, a caixa do grupo com `3 elementos` e o painel Vários; as setas movem as três juntas (`Seleção em X, Y.` e um Ctrl + Z volta tudo); arrastar uma leva as três num passo; o `Esc` no meio de outro arrastar não muda nada; o clique sem arrastar num escolhido deixa só ele; Ctrl + D (as cópias escolhidas), Delete e Ctrl + Z; nas Camadas, Shift + ↓, Ctrl + clique, Ctrl + Enter e T travando as três, com `aria-current` só no principal e `Na seleção`; com o Celular, as setas mudam só `devices.mobile`; o gravado |
| Ponta a ponta | `tests/e2e/produtor-alinha-e-distribui-no-livre.spec.ts` (1) | L4b, num rascunho com quatro Formas soltas de larguras diferentes, uma Forma travada, duas Formas empilhadas com outra travada por cima e um Selo girado 90°: as Formas escolhidas pelas Camadas (clique e Shift + clique); **Espaços iguais na horizontal** (a travada parada e a frase de quantos ficaram; Ctrl + Z e Ctrl + Shift + Z, um passo; o gravado com no máximo 1 px de diferença, num **Salvar rascunho** com o editor aberto); com o Celular, **Espaços iguais na vertical** muda só o celular; **Alinhar em cima entre si** e **Alinhar ao centro no pop-up** (cada um no meio da prancheta, medida por dentro da borda); o Selo girado com **Alinhar à esquerda** e a borda que se vê em x 0; o `Alt + clique` nas empilhadas pega a de baixo (nunca a travada) com `2 de 2` e o segundo volta à de cima; uma Forma solta pelo `⋯` › **Colocar dentro da caixa** continua desenhada, com largura e altura no gravado |
| Ponta a ponta | `tests/e2e/produtor-usa-zoom-no-livre.spec.ts` (1) | L4b, numa tela de 1280 × 800 e num rascunho alto: o + da barra de **Ajustar à tela** a 75, 100 e 150 % (a prancheta com 1,5 vez a largura); arrastar a Forma 30 px de tela a 150 % muda o X em 20; Ctrl + = no meio de um arrastar não muda o zoom; Ctrl + − e Ctrl + = no palco com a frase; Ctrl + roda com o ponto sob o ponteiro (2 px de folga); a 200 %, `O zoom já está no maior.` com o + desligado, a moldura que não corta a esquerda e a rolagem sozinha na borda de baixo (o Y gravado cresce); o menu pelo teclado volta a 150 % com o foco no gatilho, e o **Ajustar à tela** diz a escala; **Salvar rascunho** mantém o zoom e o gravado não tem zoom |
| Ponta a ponta | `tests/e2e/produtor-poe-tres-links-no-livre.spec.ts` (1) | L4b, num rascunho com o Botão principal, um "Abrir um link" e dois Fechar, o principal e o link escondidos só no celular: **Quando o aluno clica no botão** desligada (o celular não tem botão que conta); pelo teclado, os dois Fechar viram "Abrir um link" (a pílula nunca desliga) com destino e texto; o Elementos › Botão desligado com `Use até 3 botões além do principal.`; **Salvar rascunho** grava os 3 links; a opção liga e o pop-up é publicado; a aluna, a 1440 px, clica no 2º link (o destino, o clique gravado e o `message_clicked` com `metadata.button` `link:<id>`) e depois no Botão principal (`cta`) |

Amostras em `tests/fixtures/popup-livre/` (imagem WebP com alfa, imagem larga demais, PNG que não é WebP, a capa de teste, o HTML de antes do Padrão e do Personalizado e o HTML do Livre de antes do Celular, `antes-celular-livre.html`, gerado no commit-base 55a8cc0 e gerado de novo uma vez no L6a, só com as trocas dos consertos: 19 `text-decoration-line: none` a menos nos Links, 26 classes do anel de foco e 6 da transição do aperto; travado daí em diante, §13.11.1). Ajudas: `tests/e2e/popup-livre-fixtures.ts` (`prepararMidiaDoLivre`, `designVideoNoTopo`, `publicarPopUpLivre`); `tests/e2e/popup-livre-editor-fixtures.ts` (L4a, o editor na tela do produtor: `gravarRascunhoLivre` e `designDoRascunhoLivre`, o rascunho semeado sobre o modelo Em branco, conferido no schema e com o botão do aviso só quando há Botão principal; `abrirEditorLivre`, `caixaParada`, `arrastar` com o mouse sempre dentro da janela e a conferência antes de soltar, `linhasDasCamadas`, `falado`, `focoDentro`, `pontoNaPrancheta` e `daPrancheta` e `lerDesignDoAviso`; do L4b, `escolhidos`, os ids desenhados como escolhidos no palco, `cliqueCom`, o clique e o duplo clique com Shift, Ctrl ou Alt seguros depois da hidratação e com o mouse dentro da janela, `menuDoZoom`, `zoomMostrado` e `rolagemDaArea`); `zerarComunicacao` (em `tests/e2e/fixtures.ts`) também apaga as imagens de `communications/free/` que nenhum aviso que ficou usa.

## 12. Roteiro de conferência no ambiente de teste

1. Nenhuma migração: só o deploy do app. Um pop-up Padrão e um Personalizado que já existiam abrem iguais para o aluno e no editor.
2. Novo pop-up › Design › **Livre** › **Vídeo no topo com degradê**: o editor abre em tela cheia. Selecionar **Vídeo do topo** › Conteúdo › **Enviar vídeo**: aparece `Vídeo enviado.` e a capa.
3. Título › Conteúdo: trocar as duas linhas; selecionar uma palavra › **Outro estilo na seleção** › outra cor: a palavra muda no desenho.
4. Pop-up (clicar no vazio) › Fontes › **Enviar fonte**; Título › Estilo › Fonte: a fonte enviada.
5. Elementos › **Selo** › **Soltar** › arrastar e usar as setas › Avançado › **Alinhar ao centro**; Elementos › **Imagem** › enviar uma imagem com fundo transparente › soltar e mudar o tamanho pelas alças (a guia rosa aparece perto das bordas e do centro).
6. **Desfazer** e **Refazer**; Camadas › **Esconder** e **Travar**; **Ver como** Celular (o cartão fica com 343 px).
7. **Salvar rascunho**: `Rascunho salvo.` e o editor continua aberto; **Concluir**: o endereço passa a ser o do aviso; recarregar: tudo igual.
8. **Publicar pop-up**; entrar como aluno no computador e no celular: o mesmo desenho, menor no celular, o texto selecionável, o X fecha e o clique no botão conta no relatório.
9. Fechar a aba com mudança não salva no editor: o navegador pergunta; reabrir o editor oferece **Recuperar**.

**L6a** (§13.11.1), num computador com mouse e teclado. Só o deploy do app; nenhuma migração e nada muda no editor.

10. Abrir como aluno um pop-up Livre do modelo **Vídeo no topo com degradê** (o botão principal tem a borda de baixo, que é uma sombra): a janela cresce de leve ao aparecer. Fechar pelo X: ela encolhe ao sair. Um pop-up Padrão e um Personalizado abrem e fecham do mesmo jeito.
11. Passar o mouse sobre "Não mostrar de novo" (e "Lembrar depois", quando aparece): o link sublinha; tirar o mouse: a linha some. Num Livre com os Links em degradê (Links › Estilo › Texto › **Cor do texto** em degradê), a linha aparece na primeira cor do degradê.
12. Apertar Tab até o botão principal: o contorno branco e o anel escuro aparecem por dentro, no lugar das sombras do botão (a borda de baixo e o brilho de cima); sair dele com Tab: as sombras voltam. Clicar e segurar o botão: ele desce 1 px de forma suave.
13. No sistema, ligar **Reduzir movimento** (no Mac, Acessibilidade › Tela; no Windows, Acessibilidade › Efeitos visuais › Efeitos de animação desligados) e abrir o pop-up de novo: a janela aparece e some sem animação, e o botão não desce ao apertar.

## 13. Acabamento do Livre (L1.1)

Data: 23/10/2026. Os cortes marcados L1.1 na spec (§1.5): **Copiar e colar** o design com **Copiar as instruções para a IA** (pergunta 2 do produtor: usar o Claude ou o ChatGPT dele antes do "Criar com IA"), o ponto de partida **Usar o design Personalizado**, o quarto modelo **Imagem recortada com selo** e a dica "texto no celular" mais quieta. Sem migração e sem mudança no cartão do aluno. A dica do peso das imagens e a capa tirada de um vídeo que já está no Storage ficaram para depois (§10).

### 13.1 Copiar e colar o design

- Na barra de cima do editor, **Copiar e colar** (o ícone da área de transferência; o nome aparece a partir de 1.536 px) abre três ações e a frase `Para pedir a um Claude ou ChatGPT seu: copie as instruções e o design, cole lá, peça a mudança e traga o JSON de volta em Colar o design.`
- **Copiar o design**: a forma canônica em JSON com 2 espaços (`freeDesignClipboardText`, a mesma que o servidor grava: só caminhos, nunca endereço) vai para a área de transferência (`Design copiado.`). Quando o navegador não deixa copiar, abre **Copiar o texto** com o texto selecionado para o Ctrl + C.
- **Colar o design…**: um diálogo com o campo **Design em JSON** (colar com Ctrl + V) e **Colar da área de transferência** (sem permissão do navegador: `O navegador não deixou ler a área de transferência. Cole no campo com Ctrl + V.`). **Usar este design** passa por `parseFreeDesignPaste` (`popup-free-paste.ts`, puro):
  1. aceita a resposta da IA com uma frase ou com ```json em volta (vale do primeiro `{` ao último `}`); até 200.000 letras (`O texto colado é grande demais para um design.`);
  2. só o Livre (`"mode": "free"`); um Personalizado ou outra coisa: `Isso não é um design Livre. Copie pelo botão “Copiar o design” ou peça à IA o JSON com "mode": "free".`; JSON quebrado: `Não deu para ler o texto colado. Copie o design inteiro, do primeiro { ao último }.`;
  3. **arquivos**: ficam só os que este pop-up já conhece (mesmo tipo e mesmo caminho, no design aberto ou em qualquer passo do histórico do editor), com as medidas daqui (as do servidor); os outros saem, a Imagem ou o Vídeo que os usava fica com `asset: null` (o Revisar pede `Escolha a imagem deste elemento.`), a pintura de imagem de fora sai (e o fundo vazio junto) e a capa de fora sai (L19);
  4. **fontes** enviadas que não estão na biblioteca viram Inter;
  5. o mesmo zod do salvar (`popupFreeDesignSchema`) e a forma canônica; os erros ficam no diálogo (nunca em toast), em frases curtas com o nome do elemento (`O design colado tem algo que não vale:` e depois `“Título grande”: Escreva algo nesta linha.`), até 5 e `E mais N.`;
  6. coerente com o aviso, como nos modelos (L21): com áudio entra o Áudio, sem áudio ele sai; com botão entra o Botão principal que faltava; o Botão principal colado num aviso sem botão cria o `Saiba mais` com o destino vazio.
- Aplicar é **um passo só** no histórico (design e `cta` juntos): `Design colado. Ctrl + Z desfaz.`, mais os avisos que couberem (`1 arquivo não é deste pop-up e ficou de fora: envie de novo onde o elemento ficou vazio.`, `2 fontes não estão na biblioteca e viraram Inter.`, `O botão principal ganhou o texto “Saiba mais”. Escolha para onde ele leva.`). Com um arquivo subindo, espera (`Espere o arquivo terminar de enviar.`). Sem permissão de mudar, só copiar.
- **Copiar as instruções para a IA**: o texto de `free-ai-instructions.ts`, gerado deste documento por `npm run livre:instrucoes` (`scripts/livre-instrucoes-ia.mjs`): um começo curto (responder só com o JSON, seguir o contrato à risca, mudar só o que foi pedido num design mandado junto, Imagem e Vídeo novos sempre com `"asset": null` e os `assets` de um design mandado junto devolvidos como vieram, nunca endereço ou caminho de arquivo) e as partes 9.2, 9.3, 9.4, 9.5, 9.6, 9.8, 9.9 e 9.10 (sem a 9.1 e a 9.7, que são do banco e do editor), sem os trechos marcados com `<!-- ia:fora -->` (nomes de arquivo e de função, banco, buckets, caminhos); o script para se sobrar algum desses termos (L26). O arquivo vai no pacote do editor e só é baixado no clique (abrir o menu já começa); nada busca o docs na hora (L20). `Instruções copiadas. Cole na conversa com a IA junto com o design.` Um teste confere que o arquivo bate com o §9: mudou o §9, rode o script.

### 13.2 "Usar o design Personalizado"

- No card Design, em **Começar de um modelo** do Livre, quando o aviso tem um Personalizado (o do rascunho ou o guardado ao trocar de modo), o primeiro item é **Seu design Personalizado** · `Começa com o vídeo, a imagem, as fontes e os textos dele. Fica parecido; o resto você ajusta no editor.`, com a miniatura e **Usar o design Personalizado**. Com um Livre montado, pede a confirmação do **Trocar de modelo** e abre o editor com o Livre de antes um passo atrás (Ctrl + Z). A imagem do aviso e a do fundo do cartão são medidas no navegador ao usar (o servidor confere ao salvar).
- `freeFromCustomDesign` (puro, em `popup-free-starters.ts`; spec §5.3) faz um Livre parecido, não idêntico (L22):

| Personalizado | Livre |
|---|---|
| Cartão P, M, G | `artboard.width` 360, 440, 520 |
| Fundo em cor ou degradê | uma camada (`solid`, ou `linear` com as duas cores no mesmo ângulo) |
| Imagem no fundo do cartão | `[escuro (#000000 com o alfa do escuro), a imagem cabendo na largura presa em cima, no meio ou embaixo, a cor de apoio]`; a cor de apoio vai clareada (cada canal ÷ (1 − escuro)) para, debaixo do escuro, ficar a de antes; sem medidas, só a cor de apoio |
| Borda, cantos, sombra (Nenhuma, Suave, Forte), respiro | borda, `radius`, `shadows` com os valores do CSS do preset, `padding` |
| Mídia (vídeo, ou a imagem do aviso), formato, parte que aparece | Vídeo ou Imagem solto em (0, 0, W, W × proporção), `focus` em cima, no meio ou embaixo; o vídeo do nosso bucket com a imagem do aviso de capa; imagem sem medidas entra vazia; aviso sem imagem com a mídia Imagem: sem mídia (como o Personalizado mostra) |
| Degradê "Igual ao fundo do cartão" | `box.fade` embaixo, de (fim − comprimento) a fim |
| Degradê de outra cor | uma Forma "Degradê" do tamanho da mídia, por cima dela, com as mesmas paradas suavizadas |
| Abaixo da mídia, subindo N % | o texto começa em altura exata da mídia (W × proporção) × (1 − N %) + respiro: respiro de cima até 200 e o resto como margem de cima do primeiro elemento na sequência (L24) |
| Sobre a mídia, em cima, no meio ou embaixo | `minHeight` = altura da mídia, `justify` start, center ou end, a mídia (e o degradê) na camada −1 |
| Alinhamento do grupo e espaço entre blocos | `artboard.align` e `gap` |
| Selo | Selo com o fundo, a borda, os cantos e o respiro 5 × 12; o alinhamento próprio vira `place.align` |
| Título (linhas com cor e tamanho próprios) | Título com uma linha por linha e a cor ou o tamanho na parte; do 5º título em diante, Texto |
| Texto (com quebras) | Texto com uma linha por quebra (as vazias saem; até 12) |
| Botão principal e segundo botão (P, M, G; Ocupa a linha; brilho) | Botão com o respiro que dá a mesma altura, a fonte do tamanho, `width: "fill"` e o brilho como sombra; o segundo com Fechar, Lembrar depois ou o link |
| Áudio, Espaço | Áudio, Espaço |
| X | o mesmo; se não passa na regra do X do Livre (§9.6), o X escuro de sempre |
| Links | a cor e o alinhamento; "Não mostrar de novo" escondido = `dismiss: false`; a mesma distância do último bloco |
| Primeiro bloco com o texto no topo | a margem para o canto do X (56 − respiro), como no Personalizado |
| Fontes enviadas e textos | as mesmas fontes (`fonts` recalculado); até 1.200 letras somadas (o teto do Livre), contadas e cortadas por letra, nunca no meio de um emoji (L25) |

### 13.3 Modelo "Imagem recortada com selo"

`Uma imagem sem fundo ao lado do texto, um selo inclinado por cima e dois botões.` O JSON está na §9.9 (o rascunho da spec adaptado ao schema de agora, com texto neutro): prancheta de 480 px em degradê escuro, a Imagem recortada solta à direita (começa vazia: a equipe envia uma imagem com fundo transparente), uma mancha de luz atrás dela, o selo "Aula bônus" inclinado por cima, título de duas linhas (a segunda em degradê), texto, o Botão principal e "Agora não" lado a lado (passam para baixo quando o texto do botão é longo) e os Links. O selo tem 128 px e a coluna 256 px para nada mudar de linha no celular (L23).

### 13.4 Dica "texto no celular"

- No celular o pop-up inteiro encolhe na proporção min(W, 343) ÷ W, mas a fonte nunca fica abaixo de 12 px (nem acima do próprio tamanho): `freePhoneEquivalentSize` dá o tamanho que o texto tem no celular em px da prancheta (12 px numa prancheta de 440 = 15,39; 16 px fica 16, o piso não mexe).
- `freePhoneTextHints` (em `popup-free-checks.ts`): para cada elemento visível com algum tamanho que o piso aumenta (o do elemento ou o de uma parte), estima a largura das letras (≈ 0,5 em; mais peso, mais larga; maiúsculas + 22 %; Condensada mais estreita; Monoespaçada 0,6; mais o espaço entre letras) na largura que ele tem (solto: a largura dele; na sequência: a largura fixa ou a da caixa de fora, menos margens, respiro e borda) e compara o desenho com o celular. A dica aparece quando:
  - um **Título**, **Texto** ou **Selo** passa a ocupar mais linhas (`No celular, este texto ocupa mais linhas que no desenho (o texto não fica abaixo de 12 px). Use letra maior ou dê mais largura.`);
  - o texto de um **Botão** (uma linha só, com reticências) deixa de caber (`No celular, o texto deste botão fica cortado (...)`);
  - os **Links** passam a quebrar ("Lembrar depois" só conta quando o aviso deixa adiar e não há botão Lembrar depois);
  - os filhos de uma **Caixa em linha** (largura fixa, Espaço, Ícone e os textos de uma linha) deixam de caber lado a lado (`No celular, os elementos desta linha não cabem lado a lado (...)`), no primeiro texto que o piso aumenta.
- Um texto curto que só cresce um pouco (o selo e os links dos modelos, os textos da conversão do Personalizado) não gera dica. Uma dica por elemento, com a chave do tamanho (do elemento ou da parte), e o texto do Botão principal vem do `cta` do aviso. É uma estimativa: a fonte de verdade pode quebrar um pouco antes ou depois, e por isso fica como dica (L18).

### 13.5 Por dentro

- Novos: `src/server/communications/popup-free-paste.ts` (copiar e colar), `src/components/admin/v2/communication/popup-free/free-copy-paste.tsx` (o menu e os dois diálogos), `src/components/admin/v2/communication/popup-free/free-ai-instructions.ts` (gerado) e `scripts/livre-instrucoes-ia.mjs`.
- Mudaram: `popup-free-starters.ts` (o quarto modelo e `freeFromCustomDesign`), `popup-free-checks.ts` (a dica nova; `popupFreeHints` recebe `content` com o texto do Botão principal e o adiar), `free-editor.tsx` (o menu e o colar num passo), `free-editor-model.ts` (as frases e `freeKnownAssets`), `popup-design-field.tsx` e `popup-design-editor-model.ts` (o item **Usar o design Personalizado**).
- Desempenho: nada muda no aluno (nenhum arquivo do cartão foi tocado). No admin, o editor ganha o menu e o colar (o zod já estava no editor); as instruções (~27 KB de texto) ficam num pedaço próprio, baixado ao abrir o menu.

### 13.6 Roteiro de conferência

1. Num pop-up com o design Personalizado, **Livre**: o primeiro item é **Seu design Personalizado**; **Usar o design Personalizado** abre o editor com o vídeo (ou a imagem), as fontes, os textos e os botões dele, parecido.
2. **Copiar e colar** › **Copiar o design**; num bloco de notas, colar: o JSON, sem endereço de arquivo.
3. Mudar o título; **Copiar e colar** › **Colar o design…** › **Colar da área de transferência** › **Usar este design**: o título volta. Ctrl + Z: a mudança volta; Ctrl + Shift + Z: o colado volta.
4. **Colar o design…** com um texto qualquer: a frase aparece no diálogo. Colar o design de outro pop-up com imagem: a Imagem fica vazia e o **Revisar** pede a imagem.
5. **Copiar as instruções para a IA** e **Copiar o design**; colar os dois no Claude ou no ChatGPT e pedir uma mudança ("deixe o botão roxo"); colar a resposta em **Colar o design…**: a mudança aparece.
6. **Trocar de modelo** › **Imagem recortada com selo**: a imagem começa vazia; enviar uma imagem com fundo transparente pela Imagem recortada.
7. **Revisar** nos quatro modelos: nenhuma dica "texto no celular". Mudar o Texto para 12 px numa largura GG: a dica aparece no Texto.

### 13.7 L1.2: "Lembrar depois" em Links › Conteúdo e as etiquetas das Camadas

Data: 24/10/2026. Duas pendências pequenas do Livre; sem migração e sem mudança no cartão do aluno, no Padrão ou no Personalizado (`docs/26` D34).

- **"Lembrar depois" se tira de dentro do editor.** Antes, Links › Conteúdo tinha só a chave do "Não mostrar de novo" e a nota `“Lembrar depois” aparece sozinho quando o pop-up deixa adiar.`; para tirar o link era preciso fechar o editor e ir ao card "Quantas vezes e como fecha". Agora a aba tem a chave **Permitir “Lembrar depois”** (o mesmo nome do card), que é **a mesma regra** (`campaigns.allow_snooze`, nenhuma coluna nova): `FreeEditorContent` ganhou `onAllowSnoozeChange` (o card Design manda `onChange({ allowSnooze })`, o mesmo caminho do `cta`) e `snoozeMinutes` (só para a frase ligada, `Volta em {1 dia}, até 2 vezes.`, a do card; desligada: `Sem “Lembrar depois”, o pop-up volta só pela regra de “Quantas vezes”.`). A prévia do editor perde o link na hora (o `freePreviewPopupItem` já lia o `allowSnooze`) e o Revisar reconfere o botão "Lembrar depois" (erro `M.snooze`). Fora do histórico do Livre (é uma regra do pop-up, como o Áudio), mas a cópia de recuperação do navegador leva o `allowSnooze` ao lado do `cta` (copias de antes, sem a chave, continuam valendo). O Links continua **não excluível** (o contrato pede exatamente um, §9.6): a frase do Excluir passou a `Os links ficam no desenho, mas cada um se tira em Conteúdo: desligue “Permitir Lembrar depois” ou “Mostrar Não mostrar de novo”.`
- **A chave conta como mudança desde o salvar.** O `dirtySinceSave` do Livre (que decide se o Concluir troca de endereço, §4.13) compara a assinatura de `{ cta, design }` **e** o `allowSnooze` com o que foi gravado no último salvar (`freeDirtySinceSave`); sem isso, "Salvar rascunho" → desligar a chave → Concluir trocava de endereço, remontava o editor do aviso a partir do banco e a chave voltava ligada em silêncio. Por garantia, o editor do aviso só troca de endereço quando o `dirty` dele também está limpo. Na **página do modelo de Design** (`docs/28` §1.7) a chave não existe: o modelo não guarda a regra, então o card Design passa `allowSnoozeEditable: false` e Links › Conteúdo mostra a nota `“Lembrar depois” é regra do pop-up, não do modelo de design: define-se no aviso.` no lugar dela.
- **Etiquetas das Camadas a 12 px.** `Solta`, `Escondida` e `Travada` estavam a 10 px; agora 12 px (`docs/17`: nada abaixo de 12 px). A linha das etiquetas já quebra (`flex-wrap`), então as três cabem numa ou em duas linhas no painel de 248 px.
- Testes: `tests/popup-livre-painel-modelo.test.mjs` (as frases da chave, `freeLinksSnoozeDescription` e Links › Conteúdo desenhado com e sem `allowSnoozeEditable`), `tests/popup-livre-editor-modelo.test.mjs` (a frase do Excluir, o `allowSnooze` na cópia de recuperação, `freeDirtySinceSave`, `allowSnoozeToRestore` e a guarda dos 12 px) e o passo "Links › Conteúdo" em `tests/e2e/produtor-monta-pop-up-livre.spec.ts` (desliga no editor, a prévia perde o link, "Salvar rascunho" de novo grava `allow_snooze = false` sem trocar de endereço, depois do Concluir a chave do card está desligada e continua depois de recarregar).

### 13.8 L3: Celular

Data: 25/10/2026. Os valores próprios do celular por elemento (`devices.mobile`, o contrato na §9.10) chegam ao editor Livre. Sem migração e sem mudar `version`. Valem quando a tela do aluno tem até 767 px (`matchMedia("(max-width: 767px)")`); as prévias de 375 px do admin são o celular. O que não tem valor próprio encolhe como antes, com o texto nunca abaixo de 12 px.

- **Aba Celular** (a quarta do painel do elemento, depois de **Avançado**): só os campos que têm versão do celular para o tipo, em grupos: **Mostrar** (`Esconder no celular`), **Posição** (solto: X, Y, Largura e a Altura quando o computador tem uma, o elemento não tem texto ou o celular já tem uma própria, como a que as alças de cima e de baixo criam no **Ver como: Celular**; na sequência: Largura, Altura, Alinhar nesta caixa e Margem; o modo é sempre o do computador), **Texto** (Título, Texto, Selo, Botão e Links: Tamanho, Altura da linha, Espaço entre letras, Alinhamento; com a dica "texto no celular" do elemento), **Conteúdo** (Espaço e Ícone: o tamanho; Links: o espaço entre eles; Caixa: direção, espaço, alinhar, distribuir e quebrar linha) e **Respiro e cantos**. Cores, textos, pinturas, sombras, camada e girar não aparecem: são os mesmos nos dois.
- Cada campo tem a chave **Igual ao computador** (ligada por padrão; o nome falado diz o campo: `Tamanho: igual ao computador`). Ligada, o campo mostra o valor do computador, desligado. Desligar cria o valor próprio começando do computador (as alturas automáticas partem do retângulo medido) e liga o campo; ligar de novo tira o valor. Um valor igual ao do computador fica enquanto o editor está aberto (a chave continua desligada) e a forma canônica tira ao salvar. No topo, a frase `O que não mudar aqui encolhe como no computador (texto nunca abaixo de 12 px).` e **Voltar tudo ao do computador** (tira a entrada do elemento, um passo no histórico, `Tudo deste elemento voltou ao do computador.`; desligado quando não há nada). Erro de um campo do celular aparece no campo; o de fora dos campos (o modo trocado num design colado) aparece no topo.
- **Entrar na aba liga o Ver como: Celular**; a aba fica ao trocar de elemento (de qualquer tipo). Trocar o aparelho diz `Editando o Celular.` ou `Editando o Computador.` (região `aria-live`); a aba entra pelo teclado como as outras (setas entre as abas).
- **Ver como: Celular**: o palco desenha `resolveFreeForDevice(design, "mobile")`; arrastar um solto, as 8 alças, as setas (Shift = 10) e **Alinhar no pop-up** gravam em `devices.mobile.nodes.<id>.place` (criando a entrada) e não no computador; o que volta ao lugar do computador sai sozinho (a chave volta a "Igual ao computador"). Cada gesto é um passo no histórico, como antes; as setas seguidas juntam num passo, à parte das do computador (`<id>:mobile.place`). **Soltar**, **Seguir a sequência** e **Colocar dentro da caixa** mudam o modo nos dois aparelhos e tiram a posição do celular (o resto do celular fica; desde o L4b, a Forma e a Caixa com largura ou altura próprias no celular ficam com elas na sequência do celular, L48); com o Celular, o lugar do **Soltar** sai do retângulo medido no desenho do celular, então o melhor é soltar no Computador. A ordem é uma só (L29): arrastar um elemento da sequência (no desenho e nas Camadas, desde o L4a, §13.9) muda a ordem dos dois aparelhos, com a etiqueta `Muda também no computador` no indicador; subir, descer, colocar dentro e tirar da caixa também, e toda mudança de ordem com o Celular termina a frase com `A ordem muda também no computador.`; **Soltar** e **Seguir a sequência** terminam com ela sempre, mesmo sem mudar a ordem, porque mudam o modo nos dois aparelhos. Numa caixa em linha só no celular, à direita no celular é abaixo no computador; soltar entre dois visíveis com um escondido só no celular no meio põe o elemento logo antes do de depois. Duplicar, excluir, camada e esconder pelas Camadas continuam do computador.
- **Etiqueta `Celular`** (12 px) nas Camadas, ao lado de `Solta`, e no selecionado do desenho, para todo elemento com valores próprios do celular.
- **Aumentar a altura** (a dica "cortado" do Revisar) com o Celular grava a Altura mínima do celular (`devices.mobile.artboard.minHeight`), comparando com a prancheta do celular; o computador fica como estava.
- **Alinhamento do botão**: o Botão sem alinhamento escolhido é desenhado no centro; no Celular, **Igual ao computador** mostra o centro e um `Esquerda` só do celular fica ao salvar.
- **Quando o aluno clica no botão** (D9) olha os dois aparelhos (L27): cada um precisa de um botão visível que conta como o clique, o Botão principal ou qualquer um dos até 3 "Abrir um link" (desde o L4b, L45 e L46), e os botões podem ser outros em cada aparelho. O "Abrir um link" escondido num aparelho não conta nele, e desde o L4b o Botão principal escondido no computador (ou nos dois) também não: escondido num aparelho, ele pede um "Abrir um link" visível ali. Sem isso, `Este pop-up não tem botão: escolha quando ele para de aparecer.` (no salvar) e a opção desligada no card; quando o botão existe e só está escondido num aparelho, o card diz `O botão que conta o clique está escondido no computador ou no celular. Mostre o botão nos dois aparelhos no Design ou escolha outra opção.` (`clickStopHiddenOnDevice`). Um aviso já salvo antes do L4b com o Botão principal escondido no computador abre com "Só quando o pop-up terminar", e publicar e aprovar gravam essa regra na linha (§2.1).
- Tirar o áudio ou o botão do aviso tira o Áudio ou o Botão principal **e** os valores do celular deles: ao voltar, os ids (`audio`, `principal`) se repetem e nascem sem nada do celular.
- O nome do diálogo do aluno acompanha a tela: a janela ouve o mesmo aparelho do cartão (`popup-free-device.ts`), então girar o celular com o pop-up aberto troca o desenho e o nome juntos (um Título escondido só no celular não dá nome lá: vale o "Nome do pop-up").
- **No celular** no painel **Pop-up** (nada selecionado): Respiro interno, Espaço entre os elementos e Altura mínima em px, cada um com **Igual ao computador** (`devices.mobile.artboard`).
- **Revisar**: o erro de um campo do celular (`devices.mobile.nodes.<id>…`) leva à aba Celular do elemento, no campo, e liga o Celular; o da prancheta (`devices.mobile.artboard.<campo>`) leva ao **No celular**. A dica "texto no celular" mede o design do celular (§13.4, com os valores próprios) e oferece **Ajustar no Celular**, que abre a aba Celular no Tamanho do texto.
- Por dentro: `free-inspector-mobile.tsx` (a aba e a chave), `free-inspector-model.ts` (`freeMobileFieldsOf`, `freeMobileFieldValue`, `withFreeMobileField`, `withoutFreeMobileValues`, o grupo da prancheta e o mapa das chaves do celular para a aba), `free-editor-model.ts` (`setFreeMobileRect`, `freeMobileFreePlace`, `nudgeFreeNode`/`setFreeNodeRect`/`alignFreeNode` com o aparelho, `freeArrowCoalesceKey`, a etiqueta das Camadas, o item **Ajustar no Celular**), `free-editor.tsx` (o aparelho em cada gesto, o aviso falado, o Revisar), `free-canvas.tsx` (a etiqueta), `free-layers-panel.tsx`, `free-artboard-settings.tsx` e `free-review-panel.tsx`.
- Testes: `tests/popup-livre-editor-modelo.test.mjs`, `tests/popup-livre-painel-modelo.test.mjs`, `tests/popup-livre-desenho.test.mjs` e `tests/popup-design-editor-modelo.test.mjs` (§11) e o ponta a ponta `tests/e2e/produtor-ajusta-pop-up-livre-no-celular.spec.ts`.

Roteiro de conferência:

1. Num pop-up Livre, **Ver como: Celular**: o palco fica com 343 px. Arrastar um elemento solto: no Avançado o X continua o do computador; na aba **Celular**, o X está com **Igual ao computador** desligada e o valor novo; a etiqueta `Celular` aparece no desenho e nas Camadas.
2. **Computador**: o elemento está no lugar de antes. **Celular** de novo: no lugar novo.
3. Título › **Celular** › Tamanho: desligar **Igual ao computador** e pôr um tamanho menor; só o celular muda. Uma Imagem ou Forma › **Celular** › **Esconder no celular**: some só no Celular.
4. **Voltar tudo ao do computador** num elemento: a etiqueta some e o celular volta a encolher o computador.
5. Nada selecionado › **No celular** › Respiro interno menor: só o celular muda.
6. Salvar, abrir o pop-up publicado num celular (ou numa janela de até 767 px) e num computador: cada um com os seus valores.

### 13.9 L4a: arrastar

Data: 25/10/2026. A primeira parte do PR L4 (§10): arrastar para mudar a ordem em quatro frentes do editor Livre, as Camadas, as camadas de fundo, os elementos da sequência no desenho e o painel Elementos. Sem migração e sem mudança no contrato do JSON (§9) nem no cartão do aluno: o arrastar só muda a ordem em `children` e a ordem do fundo, que já existiam. O que ficou de fora vai para o L4b (lista no fim).

**O que muda para a equipe**

- **Camadas**: a linha se arrasta pelo nome (o botão que seleciona), com o mouse, a partir de 4 px; antes disso é clique. O lugar sai da altura do ponteiro na linha:
  - numa caixa, o quarto de cima põe antes, o quarto de baixo põe depois e o meio põe dentro, no fim; numa caixa com filhos, o "depois" vira dentro, no começo (a linha de baixo é o primeiro filho);
  - numa linha que não é caixa, a metade de cima põe antes e a de baixo, depois;
  - num vão entre linhas, antes da de baixo; acima da primeira linha, antes dela; abaixo da última, no fim do pop-up.

  A posição na horizontal não conta: todo lugar válido sai de alguma zona (o fim de uma caixa de dentro sai do "dentro" da caixa de fora; um teste confere). Uma linha de 2 px recuada no nível de destino mostra onde entra; no "dentro", o contorno da linha da caixa. A linha arrastada fica esmaecida e o cursor é a mão fechada. Num lugar recusado, o cursor de proibido e uma etiqueta com o motivo (`Uma caixa não entra dentro dela mesma.`, `Use até 20 elementos dentro de uma caixa.` ou `Uma caixa pode ter outra dentro, mas não mais que isso.`), logo abaixo da linha, à direita; perto do fim da lista, ela sobe. Fora do painel das Camadas não há lugar. Soltar leva o elemento, seleciona e deixa o foco no nome da linha dele, com a frase `Movido. Posição 3 de 3, dentro de Caixa em coluna.` (ou `no pop-up`; quando um solto entrou numa caixa, mais `Agora segue a sequência.`). A própria linha, em qualquer zona, e um vão que não muda nada são o mesmo lugar: nada aparece, e soltar só seleciona a linha, como o clique que tremeu. Travados e escondidos também se arrastam.
- **Desenho**: um elemento da sequência que não está travado se arrasta pelo próprio corpo ou pela alça de pontinhos no começo da barrinha (`Arraste para mudar o lugar`), que é o jeito de pegar uma caixa coberta pelos filhos. O gesto começa a 6 px, então o clique de selecionar e o duplo clique de editar texto continuam iguais. Durante o gesto aparecem a linha de onde entra (2 px, na cor do foco, diferente do rosa das guias), o contorno tracejado da caixa de destino, um tracejado fino em cada caixa vazia que aceita, o lugar de antes escurecido e, quando uma caixa recusa, o motivo. A barrinha fica invisível, o contorno de passar o mouse some e o cursor é a mão fechada. O lugar sai dos retângulos medidos, nunca do elemento sob o ponteiro: o lugar que está por cima no ponto (L31), o índice pelo meio dos itens no eixo da caixa (na caixa em linha com quebra, pela linha do ponto) e, perto da borda de uma caixa da sequência (8 px de tela, ou ¼ do lado), antes ou depois da própria caixa. Uma caixa vazia nasce sem altura: a zona dela cresce até 24 px de tela. Uma caixa cheia ou funda demais recusa e o lugar sobe para a de fora: soltar ali põe o elemento ao lado da caixa, na linha mostrada. Um solto continua mudando X e Y pelo desenho e não entra em caixa por lá (isso se faz pelas Camadas).
- **Elementos**: clicar ou Enter acrescenta como antes. Arrastar um botão até o desenho, com o mouse, a partir de 4 px, põe o elemento onde foi solto. Uma ficha com o ícone e o nome segue o ponteiro (12 px abaixo e à direita dele), o botão arrastado fica marcado e o desenho mostra o lugar: a linha de onde entra (os mesmos lugares do arrastar da sequência, com as caixas vazias tracejadas) ou, na Forma e no Degradê, o retângulo tracejado do solto novo. A Forma entra com o centro no ponto; o Degradê, com a largura da prancheta e o meio na altura do ponto; os dois ficam dentro dos limites de X e Y de um solto. O resto entra no vão, com as regras de 20 por caixa e da profundidade. Depois é o caminho do clique: o elemento selecionado, o foco no painel da direita (Imagem e Vídeo: o botão de enviar) e a frase do clique (`Texto adicionado.`). Soltar fora da prancheta visível ou no próprio painel e `Esc` não acrescentam. O botão desligado nunca arrasta. A dica `Clique para acrescentar ou arraste até o lugar no desenho.` (12 px) fica no topo do painel. Com **Ver como: Celular**, o lugar sai do desenho do celular, e o elemento novo entra nos dois aparelhos, sem a etiqueta e sem a frase do Celular (não muda a ordem de nada que já existia).
- **Fundo**: no Estilo de cada elemento e no painel Pop-up, com 2 ou 3 camadas, a faixa **Ordem** fica no topo do Fundo: a lista `Ordem das camadas de fundo`, com uma ficha por camada (a alça, a amostra da pintura ou o ícone da imagem, e `Camada 1: Cor`). O nome falado de cada ficha é `Mover Camada 1: Cor. Arraste ou use Alt e as setas.`. Parada, a ficha tem a mão aberta. Arrastar a ficha (mouse ou caneta, a partir de 4 px) mostra uma linha onde ela entra e deixa a ficha esmaecida, com a mão fechada; soltar a mais de 32 px fora da faixa ou no mesmo lugar não muda nada. Alt + ↑/↓ na ficha anda uma posição; com o foco na ficha, o atalho não chega ao editor (que moveria o elemento). Depois de mover, o foco fica na ficha e a região de status fala `Camada de fundo movida. Agora é a Camada 1: Cor.`. Os cartões continuam com Subir, Descer e Tirar, agora com o foco junto: o Subir que chega ao topo leva ao Descer, o Descer que chega ao fim leva ao Subir, o Tirar leva ao Tirar que ficou no lugar (ou ao **+ Camada**), e o **+ Camada** que cria a terceira camada (e por isso desliga) leva à ficha da nova. A camada de cima continua sendo a primeira.

**Teclado** (as alternativas que já existiam, L34)

- Camadas e desenho: Alt + ↑/↓ e a barrinha (Subir e Descer); o `⋯` (Shift + F10) › **Colocar dentro da caixa…** e **Tirar da caixa**. Juntos, alcançam qualquer lugar válido em mais de um passo. O **Tirar da caixa** fica desligado com `Use até 20 elementos dentro de uma caixa.` quando a caixa de fora está cheia (antes ela ficava com 21 e o design não valia); a frase fica embaixo do item. Depois de Subir, Descer, Colocar dentro ou Tirar pelo `⋯`, o foco volta ao nome da linha movida.
- Fundo: Alt + ↑/↓ na ficha; Subir e Descer nos cartões.
- Elementos: selecionar onde o elemento deve entrar (uma caixa: no fim dela; um elemento da sequência: logo depois dele) e apertar Enter no botão.
- Durante qualquer arrastar, `Esc` cancela; a linha do Esc nos **Atalhos** passou a `Esc: selecionar a caixa de fora (ou nada); arrastando, cancela` (eram 12 linhas; o L4b acrescentou 5 no fim e são 17, §13.10). As outras teclas são engolidas, menos Shift, Alt, Control e Meta: Ctrl + Z, Delete ou colar no meio deixariam velho o lugar calculado. Um `Esc` antes dos 4 ou 6 px (ainda é clique) segue para o editor como sempre, e o arrastar não começa mais.

**Celular** (L29)

- Com **Ver como: Celular**, o arrastar da sequência no desenho acha o lugar no desenho do celular (a direção, a quebra e os escondidos do celular); nas Camadas, a lista é a mesma nos dois aparelhos. Nas duas frentes, só a ordem em `children` é gravada, e ela vale para o computador e para o celular. `devices` não muda; só o solto que entra numa caixa pelas Camadas perde a posição do celular, como no **Colocar dentro da caixa**.
- O indicador do desenho e o das Camadas mostram a etiqueta `Muda também no computador` (12 px) quando o soltar muda a ordem; no mesmo lugar, fora ou recusado, não. Toda mudança de ordem com o Celular termina a frase com `A ordem muda também no computador.`: arrastar, Subir, Descer, Colocar dentro e Tirar (por exemplo `Movido. Posição 2 de 2, dentro de Caixa em coluna. A ordem muda também no computador.`). **Soltar** e **Seguir a sequência** terminam com ela sempre, mesmo quando a ordem em `children` fica igual (um Título de primeiro nível solto continua no mesmo lugar da lista): o modo é um só nos dois aparelhos, então o computador muda também (o modo e a posição, tirada do desenho do celular).
- Numa caixa em linha só no celular, à direita no celular é abaixo no computador. Subir e Descer trocam com o vizinho em `children`, contando escondidos e soltos; o arrastar escolhe pelos que o celular desenha. Com um escondido só no celular ao lado, um Subir pode parecer não mudar nada no Celular.
- Arrastar um solto, as alças, as setas e **Alinhar no pop-up** continuam gravando só no celular (§13.8). O Fundo é igual nos dois aparelhos e não tem frase do Celular.

**Um gesto, um passo; o que não grava**

- O design só muda ao soltar, num passo do histórico que não junta com o anterior: Ctrl + Z desfaz o arrastar inteiro e Ctrl + Shift + Z refaz. Durante o gesto só o indicador muda. O elemento novo do painel também é um passo (desfazer tira o elemento e devolve o botão do aviso, como no clique).
- No Fundo, mudar a ordem, Tirar e **+ Camada** são um passo próprio, sem chave, montado pelo design mais novo (L33): uma cor trocada logo antes fica num passo à parte, e uma mudança feita em outro elemento durante o gesto (um envio que termina) continua lá.
- Não gravam nada nem deixam passo vazio: soltar no mesmo lugar (a própria linha; o vão entre o item de antes e o de depois, mesmo com soltos, escondidos ou elementos sem retângulo no meio; a ficha no mesmo lugar); soltar fora (fora do painel das Camadas, fora da prancheta visível, no painel Elementos, a mais de 32 px da faixa Ordem); o `Esc`; o blur da janela; o `pointercancel`; o botão solto fora da janela; nas Camadas, no desenho e no Elementos, um design que mudou entre o começo do gesto e o soltar (no Fundo, o passo é montado pelo design mais novo e só deixa de gravar quando as próprias camadas de fundo mudaram, L33); e, no Fundo, a imagem que termina de subir depois de a sua camada sumir. Antes de gravar, o editor ainda confere o lugar no design de agora (`freeMoveProblem`); com um motivo, só fala a frase.

**Detalhes**

- **Ordem de pintura** (L31): entre os filhos da prancheta sob o ponteiro vence quem está por cima (a maior camada; no empate, o último na ordem), porque a camada só vira `zIndex` quando é diferente de 0. Um elemento da sequência por cima de uma caixa solta de fundo tapa a caixa; num vão entre itens que fica em cima dela, o elemento entra nela, porque é ela que está desenhada ali.
- **O mesmo vão**: o lugar de hoje vem na foto do começo (`home`, no contêiner do pai). Qualquer vão entre o item de antes e o de depois do arrastado, inclusive pela faixa da borda de uma caixa vizinha, vira o lugar de hoje e não grava.
- **Caixas vazias**: `freeFlowEmptyRects` dá as zonas tracejadas das caixas vazias que aceitam, já crescidas até 24 px de tela; o painel Elementos mostra as mesmas.
- **Caixa solta girada** (L32): a subárvore inteira fica fora dos lugares, e quem está dentro dela não arrasta pelo desenho. `freeFlowDraggable` diz quando o gesto pode começar, e a alça só aparece nesse caso (calculada uma vez por seleção).
- **Travado** (L30): não arrasta pelo desenho. Um travado dentro de uma caixa não recebe o ponteiro, então o clique e o arrastar pegam a caixa de fora, como a seleção. Nas Camadas, travados e escondidos arrastam, e a caixa travada recebe.
- **Quem fica por cima e o que o aluno lê**: reordenar soltos com a mesma camada muda quem fica por cima (o último na ordem). Mudar a ordem muda também a ordem de leitura e de Tab do aluno, o nome e a descrição do diálogo (o primeiro Título e o primeiro Texto visíveis) e as dicas do Revisar que dependem dela.
- **Fundo da prancheta**: a camada de baixo é a cor de base das contas de contraste (o X e as dicas). Reordenar pode criar ou tirar o erro do X.
- **Links e Áudio** (L34): se arrastam e entram em caixas; o painel acrescenta onde soltou, inclusive depois dos Links.
- **Forma levada para uma caixa** pelas Camadas: no L4a, virava sequência sem largura nem altura e podia sumir de vista, como já acontecia pelo `⋯`; desde o L4b, a Forma e a Caixa guardam a largura e a altura nos três caminhos (L48, §13.10).
- **O click depois do gesto**: quando um gesto começado termina, o click seguinte é engolido (o painel Elementos nunca acrescenta duas vezes). Ele sai no primeiro click, no próximo `pointerdown` ou 350 ms depois do botão solto. Cancelado com o botão ainda apertado (`Esc` ou blur), os 350 ms contam do botão solto: o `pointerup`, o `pointercancel` ou um `pointermove` com `buttons` 0 (no WebKit, o botão solto fora da janela). Depois do blur, se o botão for solto em outro app, ele sai em 1 s. Um Enter nesses 350 ms também é engolido, o que é aceitável.
- **Mouse e caneta**: a caneta só arrasta onde o alvo tem `touch-action: none` (o cartão do desenho e a ficha do Fundo); nas Camadas e no Elementos, só o mouse, senão a caneta rolaria o painel e o navegador cancelaria o gesto. O toque continua só tocando, menos no desenho desde o L4b: o solto e as alças também se arrastam com o dedo (decisão 5 do produtor, L39); o resto, só tocando.
- **Um ponteiro por vez**: com o gesto começado nas Camadas, no desenho ou no Fundo, o `pointerdown` de outro ponteiro (um toque na tela com o mouse apertado, ou a caneta) é ignorado: o gesto segue até soltar ou `Esc`, e no desenho o toque não muda a seleção. No Elementos, ele cancela o gesto de antes sem acrescentar nada. Nos dois casos nada fica preso (o indicador, a linha esmaecida, a barrinha invisível ou o cursor).
- **O arrastar do navegador** (o `dragstart` de um texto selecionado ou de um link) fica barrado enquanto o gesto é seguido, para não roubar o gesto.
- **Blur só da janela**: ouvido sem captura, o blur de um campo (o Renomear que termina no `pointerdown`) não cancela o gesto; só o blur da janela cancela.
- **A foto do começo** (o design, os lugares e o lugar de antes) é tirada quando o gesto passa do limiar, não no `pointerdown`: com uma linha em Renomear, arrastar outra linha ou um elemento no desenho grava o nome e move. O lugar é recalculado com o ponto do soltar e quando a lista das Camadas ou a área de desenho rolam (a roda do mouse não manda `pointermove`).
- **12 px**: os nomes dos grupos e dos botões do Elementos e o nome do selecionado no desenho passaram de 11 para 12 px (`docs/17`: nada abaixo de 12 px no admin; uma guarda nova confere). Tudo o que é novo tem 12 px ou mais.
- **Foco**: nas Camadas, no nome da linha movida (pelo arrastar e pelo `⋯`; sem mover, o `⋯` só devolve o foco a ele quando o foco ainda está no menu ou se perdeu, para não tirar o foco do campo do Renomear); no Fundo, na ficha ou no botão do lugar novo; no Elementos, o do clique; no desenho, o soltar não mexe no foco (fica no palco, que o clique focou). Depois do `Esc`, nenhuma tela mexe no foco: ele fica no mesmo painel (no desenho, no palco), nunca no vazio (no Chromium, no botão onde o mouse apertou; no WebKit, que não dá foco a botão pelo clique, no próprio painel).
- **Enquanto uma imagem sobe** (L33): no Fundo, a faixa, Subir, Descer, Tirar, **+ Camada** e o tipo da camada nova ficam desligados; no cartão que espera a imagem, também o Tipo, o Como preenche e o ponto de foco; e os seletores de imagem das outras camadas da lista (um envio por vez). A imagem acha a sua camada pela própria camada. Se ela sumiu durante o envio (um Ctrl + Z, por exemplo), ou já tem esse arquivo, nada muda: o arquivo não entra no design e o editor não ganha um passo vazio, então o Refazer continua. O mesmo vale para o **+ Camada** de imagem que chega com a lista já cheia.

**Por dentro**

- `free-pointer-drag.ts` (novo): `followFreePointer`, o ajudante das quatro frentes; `FREE_POINTER_MOUSE` e `FREE_POINTER_MOUSE_AND_PEN` (os tipos aceitos vêm de cada chamada), `FREE_POINTER_CLICK_GUARD_MS` (350) e `FREE_POINTER_BLUR_GUARD_MS` (1.000). Os ouvintes em captura usam sempre `{ capture: true }` (o `EventTarget` do Node só tira o de captura assim). Sem JSX, sem HTML ou CSS em texto e sem tocar na janela ao carregar: a janela vem do documento do alvo. A função devolvida desliga o gesto sem chamar nada e deixa o bloqueador do click já ligado; cada tela a chama ao desmontar (e o desenho, quando o gesto não pode começar). Com um gesto começado, o `pointerdown` de outro ponteiro volta antes de chamá-la; no Elementos, o `stop` do gesto a chama e também termina o gesto.
- `free-editor-geometry.ts`: os limiares `FREE_FLOW_DRAG_START_PX` (6) e `FREE_LIST_DRAG_START_PX` (4), `FREE_DROP_EDGE_SCREEN_PX` (8) e `FREE_DROP_EMPTY_SCREEN_PX` (24), os tipos (`FreeMoveTarget`, `FreeFlowContainer` com `home` e `layers`, `FreeFlowDrop`, `FreeLayerOver`, `FreeCanvasDropSpec` e `FreeCanvasDrop`), `freeArtboardPoint`, `freeFlowDropAt`, `freeFlowEmptyRects` e `freeLayerDropAt`.
- `free-editor-model.ts`: a regra única de mover, `freeMoveProblem` e `moveFreeNodeTo` (o índice é o vão na lista de hoje, contando o próprio elemento; `moveFreeNodeIntoBox` e `moveFreeNodeOutOfBox` passam por ela, o que conserta as 21), `freeOutOfBoxTarget` e `freeOutOfBoxProblem`, `freeMoveAnnouncement`, `freeLayerDropTarget`, `freeFlowContainers`, `freeFlowDraggable`, `freeNewNodeDropSpec`, `addFreeElement` com `at`, e os textos (`drag`, `toolbar.drag`, `elements.hint` e a linha do Esc).
- `popup-free-starters.ts`: `newFreeNode` põe o Degradê na altura do centro e a Forma e o Degradê dentro dos limites de X e Y.
- `free-editor.tsx`: `moveTo` (confere no design de agora, grava um passo sem chave, seleciona e fala), `orderPhrase` (o final do Celular), o ramo `move` das Camadas, `add(kind, drop)` e `onElementDragMove` e `onElementDragEnd`, pelo `previewDrop` do desenho.
- `free-canvas.tsx`: `previewDrop` na `FreeCanvasApi` (usado pelo painel), `artboardPointAt`, o indicador na camada de seleção (`data-free-drop-line`, `data-free-drop-target`, `data-free-drop-new`, `data-free-drop-empty`, `data-free-flow-origin`, `data-free-drop-hint` e `data-free-drop-both`), `beginFlowDrag`, `startFlow`, `updateFlow`, `endFlow` e a alça `data-free-flow-grip`.
- `free-layers-panel.tsx`: `beginLayerDrag`, `layerDropAt` e `layerDropView` (`data-free-layer-line`, `data-free-layer-box`, `data-free-layer-list`, `data-free-layer-dragging`, `data-free-layer-drop`, `data-free-layer-drop-inside`, `data-free-layer-drop-hint` e `data-free-layer-drop-both`), o `run` que lê o editor de agora, `runFromMenu` e `menuFinalFocus` (o `finalFocus` do `⋯`).
- `free-elements-panel.tsx`: o gesto, a ficha por portal no `[data-free-editor]` (`data-free-element-chip`), `data-free-element-dragging` e a dica (`data-free-elements-hint`). O `cursor-grabbing!` leva o `!` porque a regra `button { cursor: pointer }` do `globals.css` fica fora das camadas do Tailwind e venceria o utilitário. Pelo mesmo motivo, a lista das Camadas usa `**:cursor-grabbing!` e `**:cursor-not-allowed!` (os botões da linha, inclusive o que tem a captura do ponteiro durante o arrastar) e a ficha do Fundo, `cursor-grab!` e `cursor-grabbing!`; os specs conferem o cursor calculado.
- `free-fields.tsx` (`FreeFillLayersField`: a faixa, `data-free-fill-grip`, `data-free-fill-drop`, `data-free-fill-dragging`, a região `data-free-fill-status`, o foco e o ocupado), `free-inspector-model.ts` (`moveFreeFillLayerTo`, `freeFillDropIndex`, `freeFillDropAt` com `FREE_FILL_DROP_SLACK_PX`, `freeFillReorder`, `freeFillFocusAfter`, `freeFillFocusId`, `withFreeFillLayerAsset`, `freeFillSwatch` e os textos `order`, `orderLabel`, `handle` e `moved`), `free-inspector-style.tsx` e `free-artboard-settings.tsx` (o passo com `step` vai sem chave e montado por `latest()`).
- Não mudam: o cartão do aluno, `popup-free-model.ts`, `popup-free-render.ts`, `popup-free-schema.ts`, `free-editor-history.ts` e o banco; nenhuma migração (o L4a não mexe em `supabase/`; a guarda `popup-livre.guard` confere as migrações antigas e que nenhuma mexe no `popup_design`).
- Risco pequeno conhecido: o `latest()` do painel da direita é atualizado depois do desenho, num efeito. Um soltar do Fundo no mesmo quadro em que outro elemento acabou de mudar montaria o passo pelo design de um instante antes; o envio de imagem já tinha o mesmo risco.

**Testes**: unitários novos `tests/popup-livre-ponteiro.test.mjs` (13) e `tests/popup-livre-arrastar-modelo.test.mjs` (25); `popup-livre-painel-modelo` passou de 33 para 39 (o Fundo) e `popup-livre-editor-modelo`, de 33 para 34 (a guarda dos 12 px). Ponta a ponta novos, um teste cada × 2 navegadores, com `test.setTimeout(180_000)`, como a maioria dos do Livre: `produtor-arrasta-camadas-do-livre`, `produtor-arrasta-fundo-do-livre`, `produtor-arrasta-no-desenho-do-livre` e `produtor-arrasta-elementos-para-o-livre` (§11), com as ajudas de `tests/e2e/popup-livre-editor-fixtures.ts`. Cada um semeia o rascunho no banco, diz qual botão entra (o Botão principal com o botão do aviso, ou um Fechar), salva e lê o gravado. Os quatro precisam do Supabase local: a primeira vez com o banco e no WebKit é no CI; na entrega, cópias dos passos rodaram no Chromium contra uma página de conferência, sem banco.

**O que ficou para depois** (§10): o L4b (§13.10) entregou a rolagem sozinha perto da borda (nas Camadas, no desenho e no Elementos), o solto e as alças pelo dedo e a Forma e a Caixa levadas para a sequência guardando a largura e a altura, junto com o resto do L4 (seleção de vários, distribuir, `Alt + clique`, zoom com passos, até 3 botões "Abrir um link"). Foram para o L4c: levar a qualquer vão num passo só pelo teclado nas Camadas, solto entrando em caixa pelo desenho, arrastar pelo toque nas Camadas e no Elementos e reordenar sombras e linhas de texto. As paradas do degradê não se reordenam (fora, L49).

Pendências pequenas:

- A etiqueta do motivo nas Camadas, que é longa, cobre a linha de baixo enquanto o arrastar dura (some ao soltar). Se o produtor preferir outro lugar, o ajuste fica em `layerDropView`.
- O `cursor-not-allowed` dos botões desligados do Elementos perde para o `button { cursor: pointer }` do `globals.css` (já era assim antes do L4a); para valer, precisa do `!`, como o `cursor-grabbing`.
- WebKit, no passo do Renomear do spec das Camadas: se o clique num botão não tirar o foco do campo, o nome é gravado logo depois do mover, como um segundo passo; as conferências do spec continuam valendo.
- A caixa travada que recebe (L30) espera a confirmação do produtor.

Roteiro de conferência:

1. Num pop-up Livre com uma Caixa em coluna com dois elementos dentro, abrir o editor. Camadas: arrastar a linha de um Texto até o meio da linha da Caixa: o contorno aparece; ao soltar, o Texto fica no fim da Caixa, selecionado, e a frase diz a posição. Ctrl + Z volta; Ctrl + Shift + Z refaz.
2. Arrastar a linha da Caixa até a linha de um elemento de dentro dela: aparece `Uma caixa não entra dentro dela mesma.` e nada muda. Apertar `Esc` no meio de outro arrastar: nada muda.
3. Desenho: arrastar o Título para baixo de outro elemento: a linha mostra onde ele entra; soltar. Selecionar a Caixa e arrastar pela alça do começo da barrinha até o topo.
4. Elementos: arrastar **Texto** até o vão entre dois elementos (a ficha segue o ponteiro e a linha aparece): o Texto entra ali. Arrastar **Forma** até um ponto: o centro fica ali. Soltar fora do pop-up: nada entra.
5. Num elemento com 2 ou 3 camadas de fundo (ou com nada selecionado, no Fundo do Pop-up): na faixa **Ordem**, arrastar a ficha de baixo para cima: o fundo muda e o foco fica na ficha. Alt + ↑/↓ na ficha também move. Ctrl + Z volta só a ordem.
6. **Ver como: Celular**: arrastar um elemento da sequência: aparece `Muda também no computador` e a frase termina com `A ordem muda também no computador.`. **Computador**: a mesma ordem.
7. **Salvar rascunho**, recarregar a página e abrir o editor: tudo como ficou. Publicar e abrir o pop-up como aluno no computador e no celular: a mesma ordem nos dois.

### 13.10 L4b: vários, alinhar e distribuir, `Alt + clique`, zoom em passos e até 3 links

Data: 25/10/2026. A segunda parte do PR L4 (§10), com as respostas do produtor às sete perguntas do plano: (1) **Alinhar no pop-up** com vários leva cada um à prancheta (o bloco que mantém as distâncias fica para o L4c); (2) alinhar e distribuir contam pela caixa que se vê de um girado; (3) o Botão principal escondido no computador deixa de contar para "Quando o aluno clica no botão", e um aviso já salvo assim abre com "Só quando o pop-up terminar"; (4) o histórico do aluno guarda qual botão do Livre foi clicado, sem migração; (5) o solto e as alças continuam se arrastando com o dedo; (6) Ctrl ou ⌘ + = e − dão zoom no desenho; (7) o retângulo de seleção fica para o L4c. Decisões L35 a L49 (§8). Sem migração e sem chave nova no JSON (`version: 1`, a mesma forma canônica e o mesmo JSON Schema); o HTML do aluno não muda (§7). A seleção e o zoom ficam fora do design, do histórico e da cópia de recuperação.

**O que muda para a equipe**

- **Escolher vários.** No desenho, Shift, Ctrl ou ⌘ + clique põe ou tira um elemento, sem arrastar; clicar no vazio sem tecla limpa, e com tecla não muda nada. Nas Camadas, Ctrl ou ⌘ + clique põe ou tira, Shift + clique pega o intervalo entre irmãos desde a âncora, Shift + ↑/↓ estende pelo teclado e Ctrl ou ⌘ + Enter põe ou tira. Ctrl ou ⌘ + A (fora de campo de texto) escolhe os do mesmo nível do principal (sem principal, os de primeiro nível), sem os travados nem os escondidos no aparelho do Ver como. O `Esc` vai à caixa de fora comum, ou a nada. Uma caixa e algo dentro dela nunca ficam juntos: fica o escolhido por último. As frases: `Forma entrou na seleção. 3 elementos.`, `Forma saiu da seleção. 2 elementos.` e `5 elementos escolhidos.`.
- **O desenho com vários**: um contorno em cada um e a caixa tracejada do grupo com a etiqueta `3 elementos` (12 px), sem alças nem barrinha; o palco diz `Selecionados: 3 elementos (Título, Forma, Texto).` (até 5 nomes e depois `e mais N`). Com um elemento, tudo como antes.
- **As Camadas com vários**: as outras linhas escolhidas ganham a etiqueta `Na seleção` (12 px); o `aria-current` e o Tab ficam no principal (o último escolhido). E, T, Delete e Ctrl + D numa linha da seleção agem em todos; o olho, o cadeado e o `⋯` agem só na linha.
- **Mover junto**: arrastar um dos escolhidos leva todos os soltos não travados, num passo; um clique sem arrastar num escolhido deixa só ele. As setas movem o grupo (1 px; Shift, 10 px) e, quando param, dizem `Seleção em X 24, Y 120.` (o menor X e o menor Y do grupo). O grupo para inteiro na borda: quem chega antes ao limite segura os outros.
- **Painel Vários** (à direita, com 2 ou mais): o título `3 elementos selecionados` e a dica `Para mudar textos, cores e tamanhos, escolha um elemento só.`; **Duplicar** e **Excluir** no topo; **Alinhar entre si** e **Alinhar no pop-up** (6 botões cada, com nomes como `Alinhar à esquerda entre si` e `Alinhar ao centro no pop-up`); **Distribuir os espaços** (**Espaços iguais na horizontal** e **Espaços iguais na vertical**); **Camada** (**Trazer para frente** e **Enviar para trás**); **Mostrar e travar** (**Esconder** ou **Mostrar**, **Travar** ou **Destravar**); e a lista **Na seleção**, com **Escolher só {nome}** em cada um. Um grupo que não dá fica desligado, com o motivo escrito embaixo: `Para alinhar entre si, escolha 2 ou mais elementos soltos.`, `Para alinhar no pop-up, escolha um elemento solto.`, `Para distribuir os espaços, escolha 3 ou mais elementos soltos.`, `Na sequência, quem alinha e distribui é a caixa.` ou `Elementos travados não mudam de lugar.`. Com **Ver como: Celular**, a nota `Com Ver como: Celular, alinhar e distribuir mudam só o celular.`.
- **Alinhar e distribuir** (L41): só os soltos não travados e desenhados no aparelho andam; os outros ficam e a frase conta (`Alinhados entre si. 1 ficou no lugar (travado, na sequência ou escondido).`). **Alinhar no pop-up** leva cada um à prancheta: Título, Texto e Botão com **Alinhar ao centro no pop-up** ficam todos centrados. **Espaços iguais** deixa o primeiro e o último no lugar e os espaços iguais, com até 1 px de diferença. O girado conta pela caixa que se vê, também no **Alinhar no pop-up** de um elemento só: um Selo girado 90° com **Alinhar à esquerda** encosta a borda visível em x 0.
- **Duplicar e excluir vários** (L38): duplicar é um passo inteiro ou nada (um limite estourado recusa tudo com o motivo dele); Links, Áudio e o que contém Vídeo ficam de fora (`2 elementos duplicados. Os links, o áudio e o vídeo não se duplicam.`) e as cópias ficam escolhidas. Excluir deixa os Links e o Áudio (`2 elementos excluídos. Os links e o áudio ficam. Ctrl + Z desfaz.`).
- **Esconder, travar e a camada**: se algum ainda não está escondido (ou travado), todos ficam; senão, todos voltam (`3 elementos escondidos.`, `3 elementos mostrados.`, `3 elementos travados.`, `3 elementos destravados.`). `[` e `]` mudam a camada de cada um, de −10 a 10 (`Trazidos para frente.` e `Enviados para trás.`).
- **`Alt + clique`** (L42): escolhe o elemento de baixo no ponto do clique, e os seguintes andam em ciclo pela pilha do ponto (`Selecionado: Forma (2 de 3 neste ponto).`); travados e escondidos não entram. Alt + Shift (ou Ctrl, ou ⌘) + clique põe o de baixo na seleção. Alt + arrastar continua levando o elemento de cima, sem guias.
- **Zoom em passos** (L43): na barra, `[Diminuir o zoom] [62 %] [Aumentar o zoom]`; o menu tem **Ajustar à tela**, 50, 75, 100, 150 e 200 %. Ctrl ou ⌘ + = e Ctrl ou ⌘ + − (fora de campo de texto) dão zoom no desenho, não na página; Ctrl ou ⌘ + roda sobre a área de desenho dá zoom no ponto do ponteiro. Nas pontas, o botão fica desligado e o teclado diz `O zoom já está no maior.` ou `O zoom já está no menor.`. O zoom fica no **Salvar rascunho** e volta a **Ajustar à tela** quando o editor abre de novo.
- **A área que rola** (L44): quando o palco não cabe (150 ou 200 %, ou um pop-up alto), arrastar perto da borda da área de desenho (ou da lista das Camadas) faz ela rolar sozinha, e o elemento segue o ponteiro. A moldura do palco não corta mais a esquerda: com zoom alto, rolar até o começo mostra a borda esquerda da prancheta. Escolher pelas Camadas, pelo Revisar ou pelo **Escolher só**, e mover pelas setas, levam o escolhido para a vista.
- **Até 3 "Abrir um link"** (L45): os 3 botões além do principal podem ser qualquer mistura de Fechar, Lembrar depois e Abrir um link; a pílula **Abrir um link** nunca desliga; o 4º botão continua recusado com `Use até 3 botões além do principal.`. Cada link conta como o clique do pop-up, e o histórico do aluno guarda qual foi (`cta` ou `link:<id>`, L47).
- **D9 por aparelho** (L46): **Quando o aluno clica no botão** pede, no computador e no celular, um botão visível que conta; o Botão principal escondido no computador deixa de contar ali (§2.1).
- **Forma e Caixa na sequência** (L48): levadas para a sequência pelas Camadas, pelo `⋯` › **Colocar dentro da caixa** ou por **Seguir a sequência**, guardam a largura e a altura (antes, a Forma sumia); entrando numa caixa, uma camada abaixo de 0 vira 0.
- **Atalhos** com 17 linhas (L49); as 5 novas: `Shift + clique: pôr ou tirar da seleção (ou Ctrl, ou ⌘)`, `Ctrl + A: escolher todos do mesmo nível`, `Alt + clique: escolher o elemento de baixo`, `Ctrl + = / Ctrl + −: mais e menos zoom (ou Ctrl + roda)` e `Nas Camadas: Ctrl + clique ou Ctrl + Enter põe ou tira; Shift + clique ou Shift + ↑ / ↓ pega o intervalo`. A tecla `?` do botão Atalhos passou de 11 para 12 px (as linhas da lista já tinham 13 px).

**Teclado**

- Palco (fora de campo de texto): Ctrl ou ⌘ + A escolhe os do mesmo nível; `Esc` vai à caixa de fora comum (ou a nada); Ctrl + D, Delete, `[` e `]` e as setas agem em todos os escolhidos; Alt + ↑/↓ com vários diz `Escolha um elemento só.`; Ctrl ou ⌘ + = e − mudam o zoom (o + e o − do teclado numérico também; o Ctrl + 0 fica com o navegador).
- Camadas: Shift + ↑/↓ e Ctrl ou ⌘ + Enter; E, T, Delete e Ctrl + D numa linha da seleção agem em todos; F2 e Alt + ↑/↓, só na linha.
- Painel Vários: tudo pelo Tab; os botões desligados continuam na ordem do Tab (`aria-disabled`), com o motivo lido pelo `aria-describedby`. **Escolher só {nome}** leva o foco ao palco.
- Foco na troca de painel (C11): com o foco no painel da direita, ir de um elemento (ou nada) para vários leva o foco ao título do painel Vários; ir de vários para um ou nada (**Escolher só**, `Esc`, um Ctrl + clique que deixa um só) leva ao palco, e de um elemento para nada também (o painel do elemento dá lugar ao painel Pop-up). O Ctrl + Z e o Ctrl + Shift + Z seguem a mesma regra quando tiram escolhidos (o Ctrl + Z de um **Duplicar** do painel Vários leva o foco ao palco, e o Ctrl + Shift + Z seguinte refaz); com o Revisar aberto, o painel não troca e o foco fica nele. **Voltar ao elemento** no Revisar leva o foco ao título do painel Vários (com vários) ou ao palco (com um ou nada); antes, com um ou com vários, ele caía no vazio. O painel de um elemento fica montado e escondido enquanto há vários: ao voltar, a aba de antes continua (o Avançado continua no Avançado).
- Menu do zoom: abre e escolhe pelo teclado (é um menu de rádio); ao fechar, o foco volta ao gatilho.

**Celular**

- Com **Ver como: Celular**, mover junto (arrastar e setas), **Alinhar entre si**, **Alinhar no pop-up** e **Espaços iguais** gravam só em `devices.mobile` (a entrada que volta ao valor do computador sai sozinha), contando pelo desenho do celular; as setas do celular juntam num passo à parte das do computador. O Ctrl + A escolhe pelo desenho do celular: o escondido só no celular não entra.
- Duplicar, excluir, esconder, travar e a camada continuam do computador, como com um elemento (§13.8).
- A Forma e a Caixa com largura ou altura próprias no celular, levadas para a sequência, ficam com elas na sequência do celular (L48).

**Um comando, um passo; o que não grava**

- Cada comando de vários é um passo só no histórico: Ctrl + Z volta tudo e Ctrl + Shift + Z refaz. As setas e a camada seguidas juntam num passo (a chave do grupo, à parte por aparelho).
- Não gravam nem falam: alinhar, distribuir e a camada que não mudam nada, e o Ctrl + A sem ninguém para escolher. O `Esc` no meio de um arrastar (do grupo, do solto ou das alças) não grava e deixa a seleção como estava.
- O Ctrl + Z não devolve a seleção (ela fica fora do histórico): depois de desfazer um duplicar, as cópias saem da seleção, e o Ctrl + Shift + Z traz as cópias de volta sem escolhê-las de novo (a seleção guarda só os escolhidos vivos).
- O zoom nunca muda no meio de um arrastar: os botões e as teclas ficam sem efeito e a roda com Ctrl é barrada.

**Detalhes**

- **A pilha do Alt** vem do próprio navegador (`document.elementsFromPoint`), que já respeita a camada, o recorte da prancheta, o giro e quem não recebe o ponteiro; os filhos vêm antes da caixa. O ciclo anda a partir do escolhido de antes do clique. Em alguns gerenciadores de janela do Linux, Alt + clique move a janela; ali, as Camadas alcançam todo elemento.
- **O grupo no arrastar**: a caixa é a dos escolhidos que se veem no aparelho (um escondido anda junto, mas não conta); as guias miram a prancheta e os outros soltos, nunca os escolhidos, e somem com Alt ou com algum girado no grupo; o fim é um deslocamento inteiro.
- **A caixa que se vê**: o girado alinha e distribui pela volta dele (90° troca a largura e a altura no mesmo centro). A prancheta é medida por dentro da borda: no modelo Em branco (440 px com 1 px de borda), o centro de um elemento de largura L fica em X = (438 − L) ÷ 2.
- **Zoom e medidas**: as medidas em px da prancheta, as setas de 1 px, os limiares e as guias em px de tela, as alças e as etiquetas não mudam com o zoom (arrastar 30 px de tela a 150 % muda o X em 20). Do **Ajustar à tela**, o + vai ao passo logo acima da escala mostrada (de 62 %, a 75 %). Na roda, um passo a cada 50 px somados, no máximo um por evento, e um entalhe em linhas ou em páginas vale um passo. O ponto sob o ponteiro fica no lugar quando a área tem rolagem para isso; perto das pontas o navegador limita e o ponto anda o que faltou. A frase do **Ajustar à tela** sai com a escala nova (quando a escala não muda, dois quadros depois).
- **A rolagem sozinha**: 32 px de faixa dentro da borda, de 1 a 20 px por quadro, mais rápida perto da borda. Cada eixo só se arma depois que o ponto passou pelo meio da área naquele eixo: pegar a primeira linha das Camadas ou entrar pela esquerda vindo do Elementos não rola sem querer, e descer em linha reta a partir da faixa da esquerda rola. Contam o ponto onde o gesto começou e todos os pontos entre dois quadros (não só o último): levar a Forma de uma vez até a borda, mais rápido que um quadro, também rola (o WebKit entrega os movimentos assim). O Y gravado para no limite de um solto (2.400).
- **O arrastar do solto mudou de caminho** (L39): passa pelo mesmo ajudante das outras frentes (`followFreePointer`): a captura do ponteiro só vem depois de 3 px, o `Esc` cancela, o `lostpointercapture` não grava e o click de depois do gesto é engolido. O duplo clique para editar o texto de um solto continua (e não abre com Alt, Shift, Ctrl ou ⌘). Um segundo dedo não escolhe nem desliga o gesto do primeiro.
- **Mac**: o Ctrl + clique abre o menu de contexto; no desenho ele é barrado, e nas Camadas o ⌘ vale junto.
- **O botão clicado** (L47): o servidor confere a forma e o design no ar antes de gravar. Um id pode se repetir depois de excluir e recriar um botão, e a série de um botão velho se mistura com a de um novo: por enquanto, é só uma medida para o relatório por botão do L4c.

**Por dentro**

- Novos: `free-editor-selection.ts` (a seleção de vários e os comandos de vários, puros: `freeNormalizeSelection`, `freeToggleInSelection`, `freeSelectionRange`, `freeSelectAllIds`, `freeSelectionEscape`, `freeStackFromPoint`, `freeNextInStack`, `freeMovableIds`, `moveFreeNodesBy`, `alignFreeNodes`, `distributeFreeNodes`, `duplicateFreeNodes`, `removeFreeNodes`, `setFreeNodesFlag`, `shiftFreeNodesLayer`, `freeManyDescription`, `freeManyReasons` e as frases em `FREE_SELECTION_COPY`), `free-inspector-many.tsx` (o painel Vários, `FreeManyCommand` e o título `#livre-varios-titulo`), `free-zoom-control.tsx` (o zoom da barra) e, no servidor, `popup-clicked-button.ts` (`server-only`: `popupClickedButton` e a conferência contra o design).
- `free-editor-geometry.ts`: `freeVisualRect`, `freeBoundsOf`, `freeAlignDelta`, `freeDistributeDeltas`, `freeGroupDelta`, a sessão de vários (`ids`, `snap` e `finishFreeDragDelta`), `freeScrolledPointer`, `FREE_ZOOM_STEPS`, `freeZoomScale`, `freeZoomNext`, `freeZoomWheel`, `freeZoomAnchorScroll` e `freeRevealScroll`.
- `free-pointer-drag.ts`: o `onMove` com `{ altKey, shiftKey }`, a opção `autoScroll` com `freeAutoScrollStep` (armada por eixo) e `FREE_POINTER_MOUSE_PEN_AND_TOUCH` (o dedo só quando a chamada pede).
- `free-editor-model.ts`: `freeLayerKeyAction` com `extend` e `toggleSelect`, os 17 Atalhos, as frases do zoom em `FREE_EDITOR_COPY.bar`, `flowPlaceOf` e `withFreeMobileFlowPlace` (L48) e o `alignFreeNode` pela caixa que se vê; saem o limite de um link e `freeHasLinkButton`.
- `free-canvas.tsx`: as regras do `pointerdown` e do clique (`freeCanvasPress` e `freeCanvasClickSelect`), o solto e as alças pelo `followFreePointer`, o grupo, a pilha do Alt, o zoom (`zoomBy`, `zoomTo`, a roda e a âncora), `reveal`, `viewport`, a moldura `w-max` e a camada de seleção com vários (`data-free-selection-item`, `data-free-selection-group`). `free-layers-panel.tsx`: `selectedIds`, `freeLayerClickHow`, `freeLayerDragAllowed`, `freeLayerKeyCommand` e a etiqueta `Na seleção`. `free-editor.tsx`: a seleção, as regras puras de escolher (`freeEditorSelect`, `freeAddToSelection`, `freePanelFocusAfter` e `freeEditorZoomKey`), os comandos de vários (`runMany`, `onManyCommand` e `onCommitMoves`), o teclado, o zoom e os painéis. `free-elements-panel.tsx`: `autoScrollTarget`. As props novas do desenho e das Camadas (`selectedIds`, `onCommitMoves`, `onScaleChange` e `onZoomChange`) continuam opcionais, com o padrão de antes (sem a lista, só o principal), que os testes conferem; a casca sempre passa todas.
- Cartão do aluno: `FreeDragPreview` com `ids` e o `onCta` com o botão; `member-popup*`, `notifications-client.ts` e a rota de eventos levam o botão só no `clicked`. Servidor: o limite de um link sai do modelo e do schema, `freeHasClickTarget` vale por aparelho e `noticeDraftOfRow` abre o aviso antigo com "Só quando o pop-up terminar".
- Não mudam: o banco (nenhuma migração: o ramo não mexe em `supabase/`; a guarda `popup-livre.guard` confere as migrações antigas byte a byte e que nenhuma depois da `202610230001` mexe no `popup_design`, mas não barra uma migração nova), o JSON Schema, a forma canônica, `free-inspector.tsx` e o histórico do editor.

**Testes**: unitários novos `tests/popup-livre-distribuir-e-zoom-modelo.test.mjs` (21), `popup-livre-selecao-modelo` (19), `popup-livre-desenho-fonte` (14), `popup-livre-camadas-varios` (12), `popup-livre-varios-tela` (9), `popup-livre-zoom-tela` (6) e `popup-livre-editor-varios-fonte` (19); atualizados `popup-livre-ponteiro` (de 13 para 21), `popup-livre-arrastar-modelo` (de 25 para 27), `popup-livre-editor-modelo` (de 34 para 38), `popup-livre-desenho` (de 34 para 37), `popup-livre-modelo` (de 40 para 41), `popup-livre-copiar-colar` (de 20 para 21), `popup-design-editor-modelo` (de 26 para 29), `popup-livre-painel-modelo` (39, um teste trocado), `pop-ups-v3b1-rotas` (de 18 para 26) e `pop-ups-v3b1-memoria` (de 15 para 16). Integração: `pop-ups-livre-dados` (de 18 para 23) e `pop-ups-relatorio` (de 4 para 5). Ponta a ponta novos, um teste cada × 2 navegadores, com `test.setTimeout(180_000)`: `produtor-seleciona-varios-no-livre`, `produtor-alinha-e-distribui-no-livre`, `produtor-usa-zoom-no-livre` e `produtor-poe-tres-links-no-livre`, mais um terceiro teste em `pop-up-livre-editor-teclado` (§11), com as ajudas novas de `tests/e2e/popup-livre-editor-fixtures.ts`. `npm test`: 2.110 testes (2.109 passam, 1 pulado, o do `ssh-keygen`, que já era pulado). Integração e ponta a ponta precisam do Supabase local, que não sobe na máquina da entrega: rodam no CI, no Chromium e no WebKit, junto com os specs do Livre que já existiam (o arrastar do solto mudou de caminho). Na entrega, as partes do editor rodaram no Chromium contra uma página de conferência, sem banco.

**Pendências pequenas**:

- WebKit, Ctrl + roda (spec do zoom): o Playwright manda as teclas na roda do WebKit, mas isso ainda não rodou. Se o CI falhar nesse passo, ele fica só no Chromium (`browserName`) e isso é escrito aqui.
- Um Livre já no ar com "Quando o aluno clica no botão" e o Botão principal escondido no computador continua assim no banco (o aluno não muda), mas o editor e o relatório passam a mostrar "Só quando o pop-up terminar", e salvar ali grava essa regra. Os rascunhos e os pedidos de aprovação assim ganham a regra na linha ao publicar e ao aprovar (§2.1), mesmo sem salvar. Se o produtor quiser, contar os que já estão no ar na nuvem de teste e na produção antes do merge.

Roteiro de conferência:

1. Num pop-up Livre com algumas Formas soltas, abrir o editor. Clicar numa Forma, Shift + clique noutra e Ctrl + clique numa terceira: três contornos, a caixa do grupo com `3 elementos` e, à direita, o painel **Vários**.
2. Setas: as três andam juntas, e a frase diz `Seleção em X …, Y …`. Ctrl + Z volta tudo num passo. Arrastar uma delas: as três vão juntas; `Esc` no meio de outro arrastar não muda nada.
3. No painel Vários, **Espaços iguais na horizontal** e **Alinhar em cima entre si**; depois **Alinhar ao centro no pop-up**: cada uma no meio da prancheta. Uma Forma travada escolhida junto fica parada, e a frase diz quantos ficaram.
4. Ctrl + D: as cópias ficam escolhidas; Delete: elas saem; Ctrl + Z volta.
5. Camadas: clicar numa linha, Shift + clique noutra (o intervalo), Ctrl + clique numa terceira e T numa linha escolhida: todas travam, e as outras escolhidas mostram `Na seleção`.
6. Duas Formas uma por cima da outra: `Alt + clique` no ponto escolhe a de baixo (`2 de 2 neste ponto`); de novo, volta à de cima.
7. Zoom: o + da barra até 200 % (o + desliga), Ctrl + − e Ctrl + = com o foco no palco, Ctrl + roda sobre um ponto; rolar até a esquerda mostra a borda da prancheta. A 200 %, segurar uma Forma na borda de baixo: a área rola sozinha. Menu › **Ajustar à tela**.
8. Num pop-up com o Botão principal e mais três botões (Fechar ou Lembrar depois), Conteúdo › **Abrir um link** em cada um, com um destino: a pílula nunca desliga, e Elementos › Botão fica desligado com `Use até 3 botões além do principal.`.
9. **Ver como: Celular**, escolher duas Formas e usar as setas: só o celular muda (no Computador, elas estão no lugar de antes).
10. Uma Forma solta › `⋯` › **Colocar dentro da caixa**: ela continua desenhada, com a largura e a altura.
11. Salvar, publicar e abrir como aluno: clicar no segundo link leva ao destino, e o clique conta no relatório.

### 13.11 L6: efeitos, contador e texto no desenho

Data: 26/10/2026. O PR L6 (§10) em 7 entregas em série para a `dev`, cada uma testada sozinha pelo produtor no ambiente de teste e levada à produção só com o ok dele (L52): **L6a** consertos e régua do orçamento (§13.11.1); **L6b** contorno e marca-texto; **L6c** cores ao passar o mouse; **L6d** animação de entrada; **L6e** textura e mistura; **L6f** contador e o quinto modelo para começar; **L6g** texto escrito direto no desenho.

Decisões do produtor (26/10/2026): a ordem acima; quando o contador chega a zero com o pop-up aberto, ele mostra um texto (`Encerrado` por padrão, que a equipe troca), e o pop-up nunca fecha sozinho. Padrões adotados sem pergunta (o produtor pode mudar): os três consertos valem em todos os pop-ups, inclusive os que já estão no ar; o contador conta até "O fim do pop-up" (o padrão) ou até "Uma data"; Fechar, Lembrar depois e os links de baixo nunca entram com atraso; escrever direto no desenho, na primeira vez, só no Título e no Texto (Selo e botões continuam pelo painel); o quinto modelo entra junto com o contador, com um nome sem nenhuma palavra proibida da tela (o vocabulário do topo).

Regras das sete entregas (L52): `version: 1` sem migração, só chaves opcionais que a forma canônica tira quando têm o padrão; nada novo em `devices.mobile`; nenhum `url(` novo; o cartão continua sem zod e sem o modelo; a amostra `antes-celular-livre.html` muda só no L6a e fica travada depois; a régua do pedaço do cartão no `npm run verify` e uma cota por entrega (§7, L50); a volta de imagem numa nota só do `docs/20` §9, aberta no L6b.

#### 13.11.1 L6a: consertos e régua do orçamento

Data: 26/10/2026. Três defeitos do que o aluno já via (os links, o anel de foco e a escala da janela), mais o aperto dos botões, que tinha a mesma causa da escala, consertados em todos os pop-ups (inclusive os que estão no ar), e a régua do pedaço do cartão Livre no fim do `npm run verify`. Sem migração, sem chave nova no JSON, sem frase nova na tela e sem mudança no editor. Decisões L50 e L51 (§8); o L6 inteiro, L52.

**O que muda para o aluno**

- **Links que sublinham**: "Lembrar depois" e "Não mostrar de novo" do Livre sublinham quando o mouse passa por cima. A classe que sublinha (`hover:underline`) já estava nos links, mas o estilo em linha deles trazia `text-decoration-line: none`, que vence qualquer classe sem `!important`. Agora, sem linha escolhida, o estilo em linha não traz linha nenhuma; com **Sublinhado** ou **Riscado** em Links › Estilo, a linha escolhida fica sempre, como antes.
- **A linha dos Links em degradê** (crítica C21): o texto em degradê tem a letra transparente, e a linha (a do passar o mouse e a escolhida) usaria essa cor e ficaria invisível. Nos Links em degradê, o estilo em linha leva `textDecorationColor` com a primeira parada (a de menor posição, um hex já validado, a mesma cor dos ícones do Selo e do Botão). A troca fica no `LinksView` (`popup-free-nodes.tsx`), e não na pintura do texto: Título e Texto não mudam.
- **O anel de foco por cima da sombra**: no foco por teclado, os botões, os links e o X mostram o contorno branco e o anel escuro de 4 px por dentro. Num botão com sombra própria (no modelo **Vídeo no topo com degradê**, a borda de baixo e o brilho de cima), a sombra vem no estilo em linha e apagava o anel. Agora o anel é o `box-shadow` inteiro com `!important` (`focus-visible:[box-shadow:inset_0_0_0_4px_#000000b3]!`, em `FREE_FOCUS_CLASS`) e, enquanto o foco dura, toma o lugar da sombra. O clique com o mouse não mostra o anel (só o `focus-visible`).
- **O aperto de 1 px anima**: no Tailwind 4, o deslocamento do aperto muda a propriedade `translate`, separada do `transform`. A transição dos botões (`FREE_PRESS_CLASS`) lista `filter` e `translate`, e o aperto desce suave (antes pulava). Com menos movimento, o botão não desce e nada anima.
- **A janela cresce ao abrir e encolhe ao fechar**: a janela de todo pop-up (`member-popup-dialog.tsx`: Padrão, Personalizado e Livre) entra e sai com fade e escala de 95 %, mas a escala pulava pelo mesmo motivo (a escala é a propriedade `scale` e a transição listava `transform`). Agora a transição é `transition-[opacity,scale]`. E a entrada nem animava: o Base UI só marca o `data-starting-style` quando o `Dialog.Root` já montado passa de fechado para aberto, e o host monta a janela já aberta. Agora o `Root` nasce fechado e abre no quadro seguinte (`entered`, com `requestAnimationFrame`); o host só abre com a aba visível, então o quadro sempre chega. Com menos movimento, a janela aparece e some sem transição nenhuma, nem o fade.

**Na prévia do editor**, os links são texto sem ação e continuam sem linha ao passar o mouse; o resto da prévia não muda.

**A régua** (L50, §7): `scripts/livre-medir-cartao.mjs` e `npm run livre:medir`, no fim do `npm run verify` (depois do build): imprime o pedaço do cartão (com a folga até 12.288 B), a janela e o JS inicial do Início, e sai com 1 acima do teto ou quando não acha um pedaço só do cartão. O método é o das medidas do L3 e do L4b, com a soma do que só o cartão faz baixar (C11). Na mesma pasta, a `dev` de antes dá 10.362 B e o L6a, 10.388 B: +26 B, dentro da cota de +40 B.

**A amostra de antes do Celular**: `tests/fixtures/popup-livre/antes-celular-livre.html` foi gerada de novo uma vez, com os mesmos casos do teste (os modelos para começar e o modelo com vídeo, no aluno e na prévia). A diferença, conferida palavra a palavra e de novo pela troca exata, tem só as três trocas: 19 `text-decoration-line: none` a menos nos Links, as 26 classes do anel de foco e as 6 da transição do aperto. Daí em diante a amostra fica travada: as entregas de efeitos prometem o HTML igual sem chave nova.

**Por dentro**

- `popup-free-nodes.tsx` (`LinksView`): a linha do estilo em linha vem só da linha escolhida, e a cor da linha só com pintura que não é sólida. `popup-free-styles.ts`: `FREE_FOCUS_CLASS` e `FREE_PRESS_CLASS`, com o comentário do porquê. `member-popup-dialog.tsx`: a classe da janela e o comentário do topo.
- `scripts/livre-medir-cartao.mjs` (novo): `FREE_CARD_LIMIT_BYTES` (12.288) e `measureFreeCard(nextDir)`, que devolve o cartão (`file`, `files`, `raw`, `gzip`), a janela (`files`, `gzip`) e o JS inicial (`initialGzip`); a linha de comando recebe a pasta `.next` (padrão: a do projeto). `package.json`: `livre:medir` e o `verify` terminando com ele.
- Não mudam: o schema, o modelo, a forma canônica, o JSON Schema, as instruções para a IA, o editor e o banco. Volta de imagem: nada a fazer (o L6a não muda o schema; a imagem de antes desenha os mesmos designs, só com os três defeitos).

**Testes**: `popup-livre-desenho` passou de 37 para 39 (os links e o aperto; o teste das classes de foco ganhou o anel com `!important` e a sombra própria no estilo em linha; o teste da amostra continua igual, com a amostra nova); `popup-design.guard`, de 7 para 8 (a escala da janela); unitário novo `tests/livre-medir-cartao.test.mjs` (5); guarda nova `tests/tailwind-regras-de-exemplo.guard.test.mjs` (2, abaixo). Ponta a ponta: um teste novo em `pop-up-livre-aluno` (o sublinhado ao passar o mouse, a transição do aperto e o anel no Tab), e em `aluno-ve-pop-up` passos novos no teste da aluna (a escala anima ao abrir e ao fechar) e um teste novo com menos movimento (§11). Cada conserto tem um teste que falhava antes. `npm test`: 2.120 testes (2.119 passam, 1 pulado, o do `ssh-keygen`, que já era pulado). Os ponta a ponta precisam do Supabase local, que não sobe na máquina da entrega: rodam no CI, no Chromium e no WebKit; na entrega, o sublinhado, o anel, o aperto quadro a quadro e a escala da janela foram conferidos no Chromium contra uma página de conferência, sem banco. Essa página abria a janela depois de montada e não pegou a entrada sem animação; o ponta a ponta da aluna pegou no CI (nenhuma transição ao abrir, no Chromium e no WebKit). Com o `Root` nascendo fechado, uma página de conferência que monta a janela como o host (já aberta) mostra `opacity` e `scale` ao abrir e de novo ao fechar, e a guarda da janela em `popup-design.guard` passou a conferir o `open={open && entered}` e o quadro.

**Regras de CSS que vinham de exemplos** (§7): o Tailwind 4 do build lê todo arquivo fora do `.gitignore`, inclusive `tests/` e `docs/`, e gera regra para cada classe que acha escrita, até num comentário. Um comentário e três linhas de exemplo da guarda `popup-design.guard` e dois comentários (em `popup-free-styles.ts` e em `popup-livre-desenho`) tinham posto no CSS global 5 regras que nenhum componente usa (685 B sem gzip), uma delas inválida. O conserto (321b15f) troca os exemplos por classes que o código já usa ou monta o texto aos pedaços, e os comentários descrevem sem escrever a classe. A guarda nova `tests/tailwind-regras-de-exemplo.guard.test.mjs` lê o projeto com o mesmo scanner e o mesmo compilador do `@tailwindcss/postcss` e falha se uma classe vira regra sem estar no código de `src/` (o comentário não conta, nem o do JSX ou o da mesma linha); as 19 regras que já vinham de exemplos antes do L6a (planos antigos em `docs/superpowers`, `docs/12`, `docs/25` e dois testes) ficam numa lista que só encolhe. Falhava com as 5 regras. A mesma regra vale para este documento: classe de exemplo, só as que o código já usa.

**Pendências pequenas**:

- **A linha de uma parte em degradê** (Título ou Texto, pelo "Outro estilo na seleção" com **Linha no texto**): é desenhada no próprio trecho, com a cor transparente do degradê, e fica invisível, pelo mesmo motivo da C21. A linha escolhida no elemento inteiro aparece (vem do `<h2>` ou do `<p>`, que têm a primeira cor). Fica para o L6b, junto da troca das partes (§10).
- **A mesma escala fora do Livre**: o painel do sino e três menus do admin escalam ao abrir, e o ícone do botão de retomar de Minhas compras (`purchases-experience.tsx`) cresce ao passar o mouse, com a transição que lista `transform` (no de Minhas compras, também a cor de fundo) e por isso não animam a escala. Ficam para uma PR de correção à parte (§10, L51), com os 5 lugares; a guarda da escala olha só `src/components/member/notifications`, e a mesma regra passada em todo o `src/` acha esses 5 e nenhum outro.

Roteiro de conferência: §12, passos 10 a 13.
