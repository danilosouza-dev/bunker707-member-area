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
| **Editor Livre** | tela cheia por cima do editor do aviso: **Elementos** e **Camadas** à esquerda, a área de desenho no meio (selecionar, arrastar, redimensionar pelas alças, guias de alinhamento), **Conteúdo / Estilo / Avançado** à direita (ou **Pop-up**, sem seleção, ou **Revisar**); **Desfazer** / **Refazer** (100 passos), **Ver como** Computador / Celular, zoom **Ajustar à tela** / **100 %**, **Atalhos**, **Salvar rascunho** (o editor continua aberto), **Concluir** | botão **Abrir editor Livre** (só em telas a partir de 1.024 px; abaixo, só a prévia) |
| **Elementos** | Título, Texto, Selo, Botão principal, Botão (Fechar, Lembrar depois ou Abrir um link), Imagem (até 6 arquivos, com transparência), Vídeo (um), Ícone (24 prontos), Forma, Degradê, Linha, Espaço, Caixa em coluna, Caixa em linha; mais o Áudio (entra e sai com o áudio do aviso) e os Links (sempre um) | aba **Elementos** |
| **Na sequência / Solta** | na sequência, os elementos seguem a ordem da caixa (com largura, altura, margem até negativa e alinhamento); soltos têm X, Y, largura, altura, girar e camada, e 6 botões de **Alinhar no pop-up** | aba **Avançado** |
| **Estilo** | fundo com até 3 camadas (cor, degradê, degradê circular, imagem), borda, cantos, até 2 sombras (inclusive por dentro), opacidade, desfoque, desfoque do que está atrás, esmaecer de qualquer lado; texto com fonte (prontas e enviadas), tamanho, peso, itálico, altura da linha, espaço entre letras, maiúsculas, sublinhado ou riscado, alinhamento, cor ou degradê, sombra; **Outro estilo na seleção** dá cor, peso, tamanho ou fonte próprios a palavras escolhidas | aba **Estilo** e a área de texto |
| **Pop-up** | largura no computador (P 360, M 440, G 520, GG 640 ou outra de 280 a 720, com **Ajustar os elementos à nova largura**), altura mínima, fundo, borda, cantos, sombra, respiro, a sequência da prancheta, o X (cor, fundo, borda, tamanho, distância, lado) e as fontes | painel **Pop-up** (nada selecionado) |
| **Revisar** | sempre `Tamanho do design: N % do máximo.`; os erros que impedem salvar (cada um leva ao elemento e ao campo) e as dicas (contraste, texto pequeno, texto que muda de linha no celular (só quando o piso de 12 px muda o encaixe, §13.4), ordem de leitura, texto por cima de botão, cortado, celular alto, fonte que muda, vídeo sem capa) | botão **Revisar** |
| **Copiar e colar** (L1.1) | **Copiar o design** (o JSON na forma canônica), **Colar o design…** (o mesmo zod; arquivos de outro pop-up ficam vazios; um passo no desfazer) e **Copiar as instruções para a IA** (o §9), para a equipe pedir mudanças ao Claude ou ao ChatGPT dela e colar a resposta (§13.1) | barra de cima do editor Livre |
| **Celular** | o pop-up inteiro encolhe na mesma proporção (343 px numa tela de 375); texto nunca abaixo de 12 px e 44 px de toque nos botões, nos links e no X | aluno e prévia |
| **Dados** | o Livre mora em `campaigns.popup_design` com `mode: "free"` (o Personalizado sem a chave); sem migração; o JSON é estrito, esparso e só guarda caminhos dos nossos buckets (§3, §9) | banco |

Vocabulário na tela: **Livre**, **Abrir editor Livre**, **Editor Livre**, **Elementos**, **Camadas**, **Conteúdo**, **Estilo**, **Avançado**, **Pop-up**, **Revisar**, **Na sequência**, **Solta**, **Concluir**, **Salvar rascunho**, **Nome do pop-up**. Nunca "campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "automação", "lembrete", "layout", "template" nem "fluxo" (testes de vocabulário em `popup-livre-*-modelo` e `popup-design-editor-modelo`).

### Resposta curta ao produtor (para colar)

> Pronto: no card **Design** do pop-up agora tem **Livre**, ao lado de Padrão e Personalizado (os pop-ups que já existiam continuam iguais). No Livre você abre um editor de tela cheia, como o Elementor: à esquerda, **Elementos** (título, texto, selo, botões, imagem, vídeo, ícone, formas, degradê, linha, espaço e caixas em coluna ou em linha) e **Camadas** (a lista de tudo, para escolher, subir e descer, esconder e travar); no meio, o pop-up, onde você clica, arrasta e muda o tamanho, com guias para alinhar; à direita, **Conteúdo**, **Estilo** e **Avançado** de cada elemento. Você escreve o texto como num editor e pode dar outra cor, peso ou fonte a palavras escolhidas. Dá para colocar um elemento por cima do outro, soltar onde quiser, centralizar com um clique, girar, usar degradê em qualquer fundo e no texto, várias imagens (com fundo transparente), sombra, brilho, desfoque, esmaecer e preço riscado. Tem desfazer e refazer, a prévia de computador e celular (no celular, o pop-up inteiro fica menor, igual, e o texto nunca fica abaixo de 12 px) e o painel **Revisar**, que avisa o que precisa de ajuste. **Salvar rascunho** dentro do editor salva sem fechar. Comece pelo modelo **Vídeo no topo com degradê**, que é a estrutura do exemplo que você mandou; para ficar idêntico, envie a fonte do título em **Enviar fonte…**. O texto continua de verdade (o aluno seleciona e o leitor de tela lê) e o clique no botão conta como antes. O editor abre em telas a partir de 1.024 px (no celular e no tablet de pé, só a prévia). O botão de copiar e colar o design vem no próximo passo, e o "Criar com IA", com a sua conta do Claude ou do Codex, depois dele.

## 1. O que o aluno vê

- O pop-up Livre abre onde, quando e quantas vezes a equipe escolheu (`docs/25`), na mesma janela de sempre (mesmo véu, foco inicial, `Esc`, "Como fechar", "um de cada vez", nunca com o player tocando). Só o cartão muda.
- **O cartão** (`PopupFreeCard`): a prancheta na largura escolhida (280 a 720 px no computador), com os elementos na ordem das Camadas; os da sequência seguem as caixas (coluna ou linha), os soltos ficam na posição escolhida, um por cima do outro pela camada. O X fica por último, fora da prancheta e por cima de tudo (`zIndex` 60), sempre visível (o schema recusa um X que não contrasta, §9.6 regra 11) e com 44 px de toque. A prancheta corta o que passa dela: nada imita a página fora do cartão.
- **Texto de verdade** em tudo: título, texto, selo, botões e links são texto da página (o aluno seleciona, o leitor de tela lê, o tradutor traduz). O degradê no texto é `background-clip: text` em cada parte, com a cor de seleção legível. Nada vira imagem.
- **Nome do diálogo** = o texto do primeiro Título visível (`<h2>`, as linhas com espaço entre elas); sem Título, o "Nome do pop-up". A descrição é o primeiro Texto visível. Ordem de leitura e de Tab = ordem das Camadas (não a posição na tela); o X vem por último.
- **Celular**: o cartão ocupa a tela menos 1 rem de cada lado e tudo encolhe na mesma proporção (unidades `cqw` do próprio cartão: 375 px de tela → 343 px de cartão → 0,78 num cartão de 440). Duas proteções: o texto nunca fica abaixo de 12 px (um texto pequeno fica um pouco maior que a proporção, e os elementos com texto crescem em vez de vazar) e os botões, os links e o X têm 44 px de toque por um `::before` invisível (o desenho não muda). Nada rola para o lado em 375 px.
- **Valores próprios do celular** (PR L3, §9.10): com a tela do aluno até **767 px** de largura (`matchMedia("(max-width: 767px)")`, a mesma regra em todo lugar), o cartão desenha o design com `devices.mobile` por cima do computador (posição, tamanho do texto, respiro, elementos escondidos só no celular) e o encolher e o piso de 12 px continuam valendo por cima; acima de 767 px, o computador. A largura é lida antes do primeiro desenho (o cartão só aparece no navegador, depois do `POST /show`): o aluno nunca vê o computador piscar antes do celular. Girar o celular ou mudar a largura da janela com o pop-up aberto troca na hora. Um Título ou um Texto escondido só no celular não dá nome nem descrição ao diálogo ali (vale o primeiro visível no aparelho da tela). Sem `devices`, o cartão é exatamente o de antes (HTML comparado com o do commit-base).
- **Mídia**: imagens e o vídeo só dos nossos buckets, com o endereço montado na hora (§4). O vídeo é mudo, em repetição, inline, sem controles e escondido do leitor de tela; com **menos movimento** ou **economia de dados** aparece a capa (ou só o fundo do elemento, sem capa) e o vídeo nem é baixado. Imagens pelo `next/image` com `sizes` pela largura do elemento (o celular baixa a versão pequena).
- **Cliques**: elementos decorativos (forma, linha, espaço, ícone, imagem, vídeo, caixa) não recebem clique, então nada decorativo por cima bloqueia o botão nem o X; título, texto e selo recebem (para selecionar o texto), e o Revisar avisa quando um deles cobre um botão. O **Botão principal** é o botão de sempre (`cta`: mesmo destino, o mesmo clique contado em `message_clicked` e `clicked_at`); o botão **Abrir um link** (no máximo um) também conta como o clique; **Fechar** fecha como o X; **Lembrar depois** adia como o link (some quando o aluno não pode mais adiar).
- **Links**: "Lembrar depois" (quando o pop-up deixa adiar e não há botão Lembrar depois) e "Não mostrar de novo". Os dois se controlam em Links › Conteúdo: o "Lembrar depois" pela chave **Permitir “Lembrar depois”** (a mesma do aviso, `campaigns.allow_snooze`, §13.7) e o "Não mostrar de novo" pela chave **Mostrar “Não mostrar de novo”** (escondido, o aluno continua fechando pelo X, pelo `Esc` e, fora de "Só no X", clicando fora).
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
- **Prévia** do aviso e **relatório**: celular (375 px) e computador lado a lado, pelo mesmo cartão do aluno (o computador do tamanho da largura escolhida). Cada tela passa o seu aparelho ao cartão (`device`): a de 375 px mostra os valores próprios do celular (§9.10) e a do computador, os do computador, qualquer que seja a largura da janela de quem edita. As miniaturas (modelos para começar, "Meus modelos" e a lista de Modelos) desenham sempre o computador. **Quantas vezes → Quando o aluno clica no botão** vale com o Botão principal ou com o botão **Abrir um link** visível do Livre (D9 do `docs/26`).

### 2.2 O editor Livre

- Um `Dialog` do Base UI em tela cheia por cima do editor do aviso. O `Esc` não fecha (serve para "selecionar a caixa de fora"); fecha só em **Concluir**. Ao abrir, o foco vai para a primeira linha das Camadas; ao fechar, volta para **Abrir editor Livre**.
- Trabalha numa **cópia** do design e manda ao rascunho do aviso com atraso (no fim de um arrastar, 300 ms depois da última tecla e ao fechar). O histórico guarda o design e o `cta` juntos (excluir o Botão principal e desfazer devolve os dois).
- Barra de cima: **Concluir** (`Concluir e voltar ao aviso`), `Editor Livre` e o nome do pop-up; **Ver como** Computador | Celular; zoom **Ajustar à tela** | **100 %**; **Desfazer**, **Refazer**, **Revisar** (com o número de erros e dicas), **Copiar e colar** (L1.1, §13.1), **Atalhos** (`?`), **Salvar rascunho**. Três colunas: 280 / desenho / 340 px a partir de 1.280 px; 248 / desenho / 300 de 1.024 a 1.279.
- **Salvar rascunho** chama o salvar do editor do aviso e o editor **continua aberto**, com histórico, seleção e zoom (`Rascunho salvo.`). Com o pop-up no ar ou pausado, o botão é **Salvar alterações** e a frase é a do editor do aviso (por exemplo `Pop-up atualizado. Quem já viu não vê de novo. …`); o "Mostrar de novo para quem já viu" fica para o salvar do aviso (L16). Num aviso novo, o editor do aviso guarda o id e só troca de endereço no **Concluir** sem mudança depois do último salvar (trocar de endereço remontaria a página e levaria o editor junto); com mudança, o próximo salvar, já fora do editor, troca. Erro do design abre o **Revisar** com os itens; erro fora do design (por exemplo, o Nome do pop-up vazio) mostra `Há campos para revisar fora do editor: {nomes}.` com **Fechar o editor e revisar**. Enquanto um arquivo sobe, salvar e concluir esperam (`Espere o arquivo terminar de enviar.`). O Ctrl + Enter do editor do aviso não age com o editor Livre aberto.
- **Trabalho perdido**: com mudança não salva, o editor liga o `beforeunload` e guarda uma cópia de recuperação no navegador (`localStorage["bunker707:livre:<id do aviso ou novo>"]`, com o design, o `cta` e o `allowSnooze` da chave em Links › Conteúdo (§13.7), 1 s depois da última mudança, apagada ao salvar); ao abrir com uma cópia diferente, a faixa `Há um design deste pop-up que não foi salvo ({hora}).` oferece **Recuperar** (um passo no histórico; o `allowSnooze` volta pelo rascunho do aviso, fora do histórico) e **Descartar**. O editor do aviso também liga o `beforeunload` com o Livre mudado e não salvo.
- **Área de desenho**: o mesmo `PopupFreeCard` do aluno em prévia (Computador = palco da largura escolhida; Celular = moldura de 375 px com o cartão de 343 px). Clique seleciona o elemento mais de cima; duplo clique num texto abre a área de texto. Soltos: arrastar (a partir de 3 px), 8 alças (Shift mantém a proporção), setas (1 px; Shift, 10 px), guias que grudam nas bordas e no centro da prancheta e dos outros soltos (Alt desliga). Durante o arrastar o design não muda (só a prévia); no fim, um passo no histórico. Da sequência: barrinha com **Subir**, **Descer**, **Duplicar**, **Soltar** e **Excluir**. O palco é focável e diz o selecionado (`Selecionado: Título, X 24, Y 120.`). Com **Ver como: Celular** (desde o L3, §13.8) o palco desenha o design do celular (`resolveFreeForDevice(design, "mobile")`, o que se vê é o que se edita) e arrastar, as alças, as setas e **Alinhar no pop-up** gravam só no celular (`devices.mobile`, criando a entrada; um passo por gesto); trocar o aparelho diz `Editando o Celular.` ou `Editando o Computador.`; o selecionado com valores próprios do celular ganha a etiqueta `Celular` ao lado do nome.
- **Camadas**: árvore na ordem de leitura, com etiquetas `Solta`, `Escondida`, `Travada`, `Celular` (o elemento tem valores próprios do celular, L3) e o aviso de algo para revisar; em cada linha **Esconder**, **Travar** e o menu `⋯` (Duplicar, Subir, Descer, Colocar dentro da caixa…, Tirar da caixa, Renomear, Excluir). Teclado: ↑/↓, →/←, Enter, Alt + ↑/↓, E, T, Shift + F10, Delete, Ctrl + D, F2; o Tab passa pela lista uma vez só. As etiquetas têm 12 px (nada abaixo disso no admin, `docs/17`) e quebram de linha quando as três não cabem. Links e Áudio não se excluem (`Os links ficam no desenho, mas cada um se tira em Conteúdo: desligue “Permitir Lembrar depois” ou “Mostrar Não mostrar de novo”.`; o contrato pede um Links, §9.6).
- **Painel da direita**: **Conteúdo / Estilo / Avançado / Celular** do elemento (detalhes no `docs/17` §1.8.2 e na spec; a aba **Celular** e o grupo **No celular** do Pop-up na §13.8), ou **Pop-up** sem seleção, ou **Revisar**. Campos de número com arrastar no rótulo, setas (Shift = 10) e a frase do limite; cor como no Personalizado, com a **Opacidade 0–100 %** ao lado da cor (`docs/26` §2.2: 100 % grava os 6 dígitos; o código de 8 dígitos continua valendo; o nome acessível é `{rótulo}: opacidade`, sem rótulo visível, para não se confundir com a Opacidade de Estilo › Efeitos). Em **Links › Conteúdo** (§13.7): a chave **Permitir “Lembrar depois”** (a mesma do card "Quantas vezes e como fecha", `campaigns.allow_snooze`; ligada: `Volta em {1 dia}, até 2 vezes.`; desligada: `Sem “Lembrar depois”, o pop-up volta só pela regra de “Quantas vezes”.`), a chave **Mostrar “Não mostrar de novo”** (`dismiss` do Links; desligada: `O aluno continua fechando pelo X.`) e **Espaço entre os links**; a prévia perde o link na hora.
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
- **Links**: o botão "Abrir um link" segue a regra do botão principal (página da área, produto ou https); no máximo um; `rel="noopener noreferrer"` em nova aba.
- **Contra pop-up que engana**: o X sempre existe, por cima de tudo, sempre visível (alfa do ícone ≥ `cc` e contraste ≥ 3:1 com o fundo dele: erro que impede salvar) e o `Esc` sempre fecha; decorativos não recebem clique; texto por cima de botão gera a dica de cobertura; a prancheta corta o que passa dela. Esconder "Não mostrar de novo" não tira nenhum jeito de fechar.
- **Abuso e peso**: até 32 elementos, 6 imagens de 420 KB, 1 vídeo de 15 MB, desfoque em até 4 elementos, teto de tamanho do JSON; o cartão do aluno não baixa nada antes de abrir.
- **Recuperação no navegador** só na máquina de quem edita, só o design e o `cta`, lida com o mesmo zod e apagada ao salvar. **Auditoria** só com códigos, ids, tamanhos e o tipo do design. **CSP** sem mudança.

## 5. Por dentro

- **Módulos puros** (imports relativos; os testes carregam pelo Node): `popup-free-model.ts` (tipos, limites, forma canônica, árvore, estimativa do jsonb, reescala, item de prévia; **sem zod**), `popup-free-render.ts` (o único módulo de valores que o cartão do aluno importa: padrões, escala, leituras do design, nome do diálogo, origem e endereço dos arquivos), `popup-free-schema.ts` (zod, mensagens, regras com o conteúdo, chaves de erro), `popup-free-json-schema.ts` (o JSON Schema, que nenhuma tela importa, §7), `popup-free-starters.ts` (os 4 modelos, `freeFromCustomDesign`, elementos novos, sincronia com o conteúdo), `popup-free-checks.ts` (as dicas do Revisar, a dica "texto no celular" e o medidor), `popup-free-paste.ts` (L1.1: o texto de "Copiar o design" e a leitura do "Colar o design"), `popup-design-router.ts` (leitura da coluna). Servidor: `popup-free-assets.ts` (`server-only`) e `popup-free-actions.ts` (`uploadPopupFreeImage`).
- **Do banco ao aluno**: a lista no ar lê pelo roteador; o Livre passa por `freeDesignForStudent`; as fontes de todos os pop-ups numa consulta; o plano marca `design: "free"`. O host baixa a janela e o pedaço do cartão Livre **antes** do `POST /show` quando o plano diz Livre (se o `show` trouxer um Livre que o plano não marcou, a janela espera o pedaço).
- **Cartão** (`src/components/member/notifications/popup-free/`): `popup-free-card.tsx`, `popup-free-nodes.tsx` (um `switch` por tipo, `data-free-id` num elemento só), `popup-free-media.tsx`, `popup-free-styles.ts` (todos os objetos de estilo, puro), `popup-free-icons.tsx` (24 ícones), `popup-free-load.ts` (a única porta do pedaço). `MemberPopupCard` despacha `freeDesign` → `PopupFreeCard` por `React.lazy` (o mesmo pedaço próprio do `next/dynamic` da spec, carregável pelo Node nos testes); senão `design` → `PopupDesignCard`; senão o cartão de sempre (HTML do Padrão e do Personalizado comparado com o de antes do Livre).
- **Editor** (`src/components/admin/v2/communication/popup-free/`): casca e palco (`free-editor.tsx`, `free-canvas.tsx`, `free-elements-panel.tsx`, `free-layers-panel.tsx`, `free-review-panel.tsx`, `free-editor-model.ts`, `free-editor-history.ts`, `free-editor-geometry.ts`, `free-editor-recovery.ts`) e painel da direita (`free-inspector*.tsx`, `free-artboard-settings.tsx`, `free-fields.tsx`, `free-assets.ts`, `free-inspector-model.ts`). O card Design (`popup-design/popup-design-field.tsx`) carrega o editor com `next/dynamic` e passa o contrato `FreeDesignEditorProps` (spec §9.6), mais `undoTo` (o design de antes do **Trocar de modelo**). O editor do aviso (`notice-editor.tsx`) guarda o rascunho, passa `onSaveDraft` (o salvar sem os toasts dele, devolvendo os erros) e adia o `openSavedNotice` enquanto o editor Livre está aberto.
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

## 8. Decisões

| # | Decisão | Por quê |
|---|---|---|
| L1 | Livre na mesma coluna, com `mode: "free"`, e a chave `freeDesign` separada de `design` no rascunho e no `PopupItem` | sem migração; o código do Personalizado fica intocado; os pacotes paralelos não brigaram pelos arquivos dele |
| L2 | Regra das duas chaves ao salvar, conferida de novo depois da junção | uma aba antiga do admin (só `design`) troca o Livre gravado em vez de gravá-lo por baixo |
| L3 | O design guarda só caminhos; o endereço sai de `freeAssetUrl` com a origem conferida | nenhum texto do design entra num `url()` (o `img-src` aceita `https:`) |
| L4 | No celular, o pop-up inteiro encolhe (`cqw`), com texto ≥ 12 px e toque de 44 px; valores por aparelho ficam reservados (`devices`, PR L3) | decisão do produtor (pergunta 1 da spec): um desenho só, legível |
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
| `button` (Botão) | `action`: `{ "kind": "cta" }` (o botão principal: texto e destino no `cta` do aviso, sem `label`), `{ "kind": "close" }`, `{ "kind": "snooze" }` (Lembrar depois) ou `{ "kind": "link", "href": "...", "target": "same_tab" | "new_tab" }` (Abrir um link; o clique conta como o clique do pop-up); `label` (1 a 40, obrigatório fora do `cta`); `icon` (`{ "name", "side": "end" | "start" }`); `textStyle` |
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
| Botões | um botão principal (existe se e só se o aviso tem botão); outros até 3, dos quais no máximo 1 "Abrir um link" |
| Links / Áudio | exatamente 1 / no máximo 1 (existe se e só se o aviso tem áudio) |
| Elementos com desfoque | até 4 |
| Camadas de fundo / paradas / sombras | até 3 / 2 a 5 / até 2 |
| Fontes enviadas | até 4 |
| Imagem enviada | WebP, 16 a 1.600 px de cada lado, até 420.000 bytes |
| Tamanho | até 30.000 bytes na conta do editor, que pesa mais que o texto do JSON: fique abaixo de uns 12.000 caracteres de JSON sem espaços (cada modelo da 9.9 tem menos de 2.500)<!-- ia:fora -->; a conta é a estimativa do jsonb (`jsonbBytesUpperBound` da forma canônica) e o check do banco mede o jsonb sem compressão e para em 32.768<!-- /ia:fora --> |

### 9.6 Regras entre partes e com o conteúdo do aviso

Sempre (o schema confere ao colar e ao salvar): ids únicos; profundidade e contagens de 9.5 Limites; solto só na prancheta; `label` obrigatório fora do `cta` e proibido no `cta`; todo `asset` de elemento ou pintura existe em `assets` com o tipo certo; a capa do vídeo é uma imagem de `assets`;<!-- ia:fora --> o caminho casa com o padrão do bucket e o vídeo tem a extensão do tipo;<!-- /ia:fora --> o link do botão segue a regra do botão principal (página da área, produto ou https); cada linha tem pelo menos uma letra que não é espaço; até 4 fontes enviadas; o tamanho; e o **X sempre visível**: o alfa da cor do ícone do X é pelo menos `cc` e o contraste entre o ícone e o fundo do X (o fundo composto sobre a cor de base da prancheta, a camada de baixo do `fill`; com alfa, sobre preto) é pelo menos 3:1.

Com o conteúdo do aviso (no salvar e no publicar): aviso com botão pede o botão principal (`Falta o botão principal no design.`); botão principal sem botão no aviso (`Escreva o texto do botão e escolha para onde ele leva.` em `cta.label`); aviso com áudio pede o Áudio (`Falta o elemento Áudio no design.`); Áudio sem áudio no aviso (`Envie o áudio ou tire o elemento Áudio.` em `audio`); botão Lembrar depois com o adiar desligado; Imagem e Vídeo sem arquivo. "Quantas vezes → Quando o aluno clica no botão" vale com o `cta` ou com o botão "Abrir um link".

<!-- ia:fora -->
No rascunho do aviso, `freeDesign` fica ao lado de `design` (o Personalizado): no máximo um não nulo (`Escolha um design só.`). Ao salvar, o pedido com uma só das chaves (mesmo `null`) zera a outra; com as duas, valem como vieram; sem nenhuma, fica o que está gravado.
<!-- /ia:fora -->

### 9.7 Chaves de erro

O editor recebe: `freeDesign` (o design inteiro), `freeDesign.artboard.<campo>`, `freeDesign.close.<campo>`, `freeDesign.assets.<id do arquivo>`, `freeDesign.fonts`, `freeDesign.size`, `freeDesign.nodes.<id do elemento>[.<caminho do campo>]` (por exemplo `freeDesign.nodes.botao.action.href` ou `freeDesign.nodes.titulo.lines.0.1.text`) e, no celular, `freeDesign.devices.mobile.artboard.<campo>` e `freeDesign.devices.mobile.nodes.<id do elemento>[.<caminho do campo>]` (por exemplo `freeDesign.devices.mobile.nodes.selo.place.x`; já vêm pelo id, sem índice). Os índices que o zod devolve (`freeDesign.children.3.children.0...`) viram ids por `freeErrorKey`/`freeErrorKeys`, estáveis se a ordem mudar; `freeNodeIdOfKey` acha o elemento nos dois formatos.

### 9.8 Guia curto para a IA

1. Escreva só o JSON do design, na forma desta seção. Imagem e Vídeo novos sempre com `"asset": null` (a equipe envia o arquivo no editor); não escreva `assets` nem `fonts` novos e nunca um endereço de arquivo. Se o design que eu mandar já tem `assets`, devolva essa lista e os `asset` exatamente como vieram.
2. Texto sempre na sequência (`place` omitido ou `flow`); solto só para mídia, forma, degradê e adesivo.
3. Um botão principal (`{ "kind": "cta" }`) quando o aviso tem botão; o texto dele vai no `cta` do aviso, fora do design.
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
Por dentro: `resolveFreeForDevice(design, device)` mora em `popup-free-render.ts` (o único módulo de valores que o cartão do aluno importa; `popup-free-model.ts` reexporta): `"desktop"`, ou um design sem `devices.mobile`, devolve o mesmo objeto; `"mobile"` junta a prancheta e, por elemento, `place`, `textStyle`, `box` e `layout` campo a campo (`size`, `gap` e `hidden` trocam). O aluno usa o celular quando `matchMedia("(max-width: 767px)")` casa (a mesma regra em todo lugar); as prévias do admin passam `device` (a de 375 px é o celular). O schema confere o modo da posição, o tipo de cada campo e o limite do Ícone nas regras entre partes (que sabem o tipo do elemento); a estimativa do tamanho conta `devices` (é a da forma canônica). As ajudas do editor mantêm o mapa coerente: duplicar copia a entrada para o id novo (o solto anda 16 px também no celular), excluir tira a entrada do elemento e de tudo dentro dele, **Soltar**, **Seguir a sequência** e **Colocar dentro da caixa** (quando o solto vira sequência) tiram a posição do celular, e **Ajustar os elementos à nova largura** escala os valores do celular junto. Colar deixa `devices` passar (ids que não existem saem na forma canônica). A dica "texto no celular" mede o design do celular (com os valores próprios) e, quando o tamanho do texto é do celular, leva a `devices.mobile.nodes.<id>.textStyle.size`. Sem migração: a coluna e o check de 32 KB já aceitam.
<!-- /ia:fora -->

## 10. Fica de fora

| Fora desta entrega | Onde está |
|---|---|
| Dica do peso das imagens (precisa do tamanho do arquivo, que o design não guarda); capa de vídeo tirada de um vídeo que já está no Storage (precisa de CORS no `canvas`) | ficaram do L1.1 (que entregou o copiar e colar, as instruções para a IA, "Usar o design Personalizado", o quarto modelo e a dica nova, §13); vão para o L5 (Meus modelos e biblioteca de imagens), junto com o tamanho dos arquivos já enviados |
| "Criar com IA" (texto e/ou imagem de referência pela conta conectada no gateway) | PR L2 (§9.8 e spec §5.7) |
| Valores próprios do celular por elemento (`devices.mobile`) | feito no PR L3 (§9.10; no editor, §13.8) |
| Cores, textos, pinturas, sombras, camada e girar diferentes no celular; um terceiro aparelho (tablet) | fora de propósito (L3): um desenho só, com o que muda de tamanho e lugar por aparelho |
| Arrastar nas Camadas e nas camadas de fundo, arrastar elementos da sequência no desenho, arrastar do painel, seleção de vários, distribuir, `Alt + clique`, zoom com passos, mais de um botão "Abrir um link" | PR L4 |
| Salvar como modelo | feito em 25/10/2026 (`docs/28`): "Meus modelos" e "Salvar design como modelo" no card Design e a aba **Modelos** do editor Livre ("Salvar este design como modelo" e "Usar este modelo", um passo só no histórico) |
| Copiar elementos entre pop-ups, biblioteca de imagens, cores salvas, migração para subir o teto de tamanho | PR L5 |
| Animações, cores ao passar o mouse, contador, texto editado direto no desenho, Textura, contorno do texto, mistura de cores, marca-texto | PR L6 |
| Limpeza de imagens, vídeos e fontes sem uso no Storage | feito em 23/10/2026 (`docs/22` §4.6) |
| HTML ou CSS escrito pela equipe; mídia ou fonte de fora; texto em imagem no lugar de texto | nunca |
| Ponta a ponta no WebKit dos arquivos novos (e a foto dos cantos do vídeo com máscara, spec §3.2) | rodados no Chromium; o WebKit roda no CI |

## 11. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/popup-livre-modelo.test.mjs` (40) | schema estrito em todo nível (inclusive `url` e o que não é da §9.10 dentro de `devices`), documento mínimo, limites e frases, ids, profundidade, contagens, botões e links, 1.200 letras, caminhos dos buckets, capa, X visível, link seguro, estimativa do jsonb contra o banco, teto de tamanho, forma canônica, roteador, caminhos gravados, regras com o conteúdo, chaves de erro, reescala, `freeDesignForStudent`, origem e endereço dos arquivos, os 4 modelos, sincronia do Áudio, JSON Schema (e só o módulo próprio chama o `toJSONSchema`, nenhuma tela o importa), os exemplos desta §9, dicas e vocabulário; Celular (L3): o formato de `devices.mobile` vale, chave a mais, camada, girar, cor e campo de outro tipo recusados, limites do computador (o do Ícone também), até 32 entradas, a posição no modo do computador, a forma canônica (id que não existe, objeto vazio e valor igual ao do computador saem; sem nada, `devices` sai), `resolveFreeForDevice` (o computador devolve o mesmo objeto; o celular junta campo a campo; escondido ou mostrado só no celular), a reescala com o celular, duplicar/excluir/Soltar/Seguir a sequência/Colocar dentro da caixa com o mapa coerente, o tamanho contando `devices`, as chaves pelo id e o exemplo da §9.10 |
| Unitário | `tests/popup-livre-desenho.test.mjs` (33) | o desenho do aluno: sequência e solto em `cqw`, prancheta que cresce até os soltos, altura mínima nos textos, piso de 12 px, pinturas, `url()` só da origem conferida (14 origens maliciosas), esmaecer, texto em degradê, links, h2 e descrição, vídeo × capa, cliques, foco visível, `sizes`, quadriculado só na prévia, escondido, ordem do DOM, `dragPreview` e o **HTML do Padrão e do Personalizado igual ao de antes do Livre**; Celular (L3): `device="mobile"` desenha posição, largura, fonte e respiro do celular em `cqw` e não desenha o escondido só no celular; sem `device` (e no servidor) valem os do computador; a tela de até 767 px é o celular e a troca de largura avisa o cartão; o nome e a descrição do diálogo pelo aparelho da tela; as prévias do admin passam o aparelho (a de 375 px desenha o celular, as miniaturas o computador); e o **HTML do Livre no computador igual ao de antes do Celular** |
| Guarda | `tests/popup-livre.guard.test.mjs` (6) | sem HTML/CSS em texto, o cartão sem zod/modelo/dicas, o cartão só por `import()`, `url(` só pelo `freeAssetUrl`, o editor fora do lado do aluno, nenhuma migração nova |
| Unitário | `tests/popup-livre-editor-modelo.test.mjs` (31) | onde o elemento entra, foco no envio, duplicar/excluir/subir/descer/caixas (a frase do Excluir dos Links), soltar e seguir a sequência, setas, redimensionar com Shift, alinhar no pop-up, guias, escala do zoom e do celular, arrastar = um passo, histórico (junta, guarda o `cta`, 100 passos, modelo e recuperar), cópia de recuperação (com o `allowSnooze` ao lado do `cta`), `freeDirtySinceSave` (a regra do "Lembrar depois" conta como mudança desde o salvar; o editor do aviso só troca de endereço com os dois lados limpos) e `allowSnoozeToRestore` (só booleano e diferente), teclado das Camadas, as etiquetas das Camadas a 12 px, o botão e a frase do salvar no pop-up no ar (L16), o Botão principal sem destino no Revisar (a frase do Personalizado, o mesmo erro do salvar e do card, o "Para onde leva", some ao preencher), vocabulário; Celular (L3): com o Celular, arrastar, alças, setas e Alinhar no pop-up gravam em `devices.mobile` e não no computador (a entrada nasce e some sozinha), Soltar e Seguir a sequência tiram a posição do celular, um passo por gesto e as setas do celular juntando à parte, a etiqueta `Celular` nas Camadas e no desenho a 12 px, o **Ajustar no Celular** da dica e as frases faladas |
| Unitário | `tests/popup-livre-painel-modelo.test.mjs` (30) | área de texto (Enter, limites, acentos e emoji), Outro estilo na seleção, editar mantendo estilos (400 edições aleatórias), voltar ao estilo, paradas, camadas de fundo, lados, sombras, chave de erro → aba e campo, Abrir um link único, reescala, pesos, imagem até 1.600 px e 420 KB, Links › Conteúdo desenhado (a chave "Permitir “Lembrar depois”" no aviso; na página do modelo de Design, só a nota), vocabulário; Celular (L3): os campos de cada tipo (nunca cor, camada ou girar), Igual ao computador ligada e desligada (começa do computador), Voltar tudo ao do computador, o No celular da prancheta, chave de erro do celular → aba Celular e campo (e a da prancheta → No celular), a aba e o grupo desenhados (uma chave com nome por campo, o erro no campo e o do modo no topo), frases palavra por palavra |
| Unitário | `tests/popup-design-editor-modelo.test.mjs` (23) | os do Personalizado, mais: os três modos com memória (Livre e Personalizado nunca juntos no rascunho), os modelos do Livre (o "Saiba mais", o vídeo do Personalizado e a imagem do aviso como capa, só caminhos), o rascunho com as duas chaves, a forma canônica com o Livre, a prévia pelo item do Livre, o D9 com o "Abrir um link" do Livre, a sincronia do Livre com o botão e o áudio, a cópia nova do card palavra por palavra |
| Unitário | `tests/popup-livre-copiar-colar.test.mjs` (19) | L1.1: copiar dá a forma canônica e colar devolve o mesmo design (e o mesmo texto); a resposta da IA com ```json em volta; arquivos de fora viram `asset: null`, a pintura e a capa de fora saem e os conhecidos ficam com as medidas daqui; as frases do colar (vazio, JSON quebrado, grande demais, Personalizado, zod com o nome do elemento, até 5 e "E mais N."); fonte fora da biblioteca vira Inter; o Botão principal e o Áudio acompanham o aviso; colar = um passo no histórico; os arquivos de todo o histórico; as instruções geradas do §9 (iguais ao arquivo, os exemplos colam e cabem no tamanho prometido, só por `import()`, nada busca o docs, nada de `.ts`, banco, bucket, jsonb, `z.` ou `§`, e o script para com um trecho sem marcador); todo modelo do Personalizado vira um Livre válido sem dica; o mapeamento (mídia e esmaecer, vídeo e capa, títulos, quebras, botões e brilho, segundo botão, Espaço, links, imagem no fundo com a cor clareada, degradê de outra cor, Sobre a mídia, X que precisa contrastar, sem imagem, imagem sem medidas, 4 títulos e 1.200 letras); toda combinação do Personalizado (modelo × largura × formato × posição × subir × respiro × mídia × degradê) passa no schema e na conta do tamanho com o texto no mesmo y (até 1 px), e cada subir de 0 a 60 com o respiro até 200 e a margem até 400; o corte das 1.200 letras com um emoji na fronteira (texto e botão); o card ("Usar o design Personalizado", o "Saiba mais"); o modelo novo; a conta do tamanho no celular e quando a dica aparece (texto longo, parte, selo solto, botão cortado, linha de botões, links); Celular (L3): colar com `devices` (o id que não existe e o igual ao computador saem, copiar de novo dá o mesmo, o erro diz o elemento: `“Título grande”, no celular: …`), as instruções com a 9.10 e o item 9 do guia, a dica "texto no celular" medida com os valores do celular (e a chave do celular) |
| Integração | `tests/integration/pop-ups-livre-dados.test.mjs` (18) | salvar e ler na forma canônica sem endereço, o maior Livre aceito passa no check de 32 KB, Livre inválido some da lista e abre como Padrão, lista no ar e plano, notificação sem design, trocar para Padrão, aba antiga, sem chave mantém, duas chaves recusadas, duplicar, publicar e aprovar conferem fontes, fonte em uso, auditoria; Celular (L3): salvar e ler com `devices` na forma canônica (o aluno recebe os valores do celular; outro modo recusado em `draft.freeDesign.devices.mobile.nodes.<id>.place.mode`), um Livre sem `devices` igual byte a byte ao ler e salvar de novo, o maior Livre com `devices` passa no check de 32 KB sem migração |
| Integração | `tests/integration/pop-ups-livre-envios.test.mjs` (8) | `uploadPopupFreeImage` (WebP com alfa, caminho e medidas do servidor), recusas, 403, imagem nova inexistente, medidas trocadas pelas do servidor, caminho de outro lugar, vídeo não conferido recusado (o objeto fica, `docs/28` D16), vídeo do Personalizado reusado não apagado |
| Ponta a ponta | `tests/e2e/pop-up-livre-aluno.spec.ts` (9) | nome do diálogo, texto selecionável, selo sobre o vídeo que some, vídeo mudo tocando, X de 28 px com 44 px de toque, Tab nas Camadas e o X por último, `Esc`, clique conta, menos movimento sem vídeo, 375 px com 343 px e proporção, forma por cima do botão não impede o clique, `dismiss: false`, Padrão e Personalizado iguais; Celular (L3): publicar guarda `devices`, a 375 px a Mídia e a fonte do Título seguem o celular e a Forma escondida no celular some, a 1440 px vale o computador |
| Ponta a ponta | `tests/e2e/produtor-monta-pop-up-livre.spec.ts` (4) | num aviso novo: Livre, modelo, vídeo, duas linhas com cores pelo "Outro estilo na seleção", fonte enviada, Botão principal, Selo solto arrastado e com setas, Alinhar ao centro, respiro por lado, Imagem enviada arrastada até a borda (guia) e redimensionada com Shift, esconder e desfazer/refazer pelas Camadas, largura G, Computador e Celular, **Salvar rascunho com o editor aberto** (endereço de aviso novo, Ctrl + Z ainda desfaz), **Concluir** (endereço do aviso), recarregar igual, prévia, publicar, o gravado; a aluna a 1440 (texto real, cores, fonte, clique contado) e a 375 (343 px, proporção, nada abaixo de 12 px, X fecha); com o pop-up no ar, o editor Livre diz **Salvar alterações** e a frase do pop-up no ar, sem aplicar o "Mostrar de novo" ligado, que o salvar do aviso aplica depois (L16) |
| Ponta a ponta | `tests/e2e/pop-up-livre-editor-teclado.spec.ts` (2) | só teclado: abrir (foco nas Camadas), Tab passa pela lista uma vez, Título pelo Elementos, Forma movida com setas (posição falada), Alt + ↑, E, T, Ctrl + D, Delete, Ctrl + Z, o foco nunca cai no vazio nem sai do editor, linha vazia → Revisar → foco na área de texto, erro fora do editor → **Fechar o editor e revisar** → foco em **Abrir editor Livre**; **Trocar de modelo** confirma e Ctrl + Z volta ao design de antes |
| Ponta a ponta | `tests/e2e/produtor-copia-e-cola-livre.spec.ts` (1) | L1.1: num rascunho com o Personalizado "Só texto", Livre › **Usar o design Personalizado** (o editor abre com o título, o selo e o botão dele); **Copiar o design** (o JSON canônico na área de transferência, sem endereço); mudar o título e **Colar o design…** pela área de transferência (volta, num passo só: Ctrl + Z e Ctrl + Shift + Z); texto que não é JSON (a frase, o foco no campo); um design com a imagem de outro pop-up (a Imagem vazia e o Revisar pedindo a imagem; Ctrl + Z volta); **Copiar as instruções para a IA**; salvar e o gravado |
| Ponta a ponta | `tests/e2e/pop-up-livre-botao-sem-destino.spec.ts` (1) | num aviso novo sem botão, o modelo cria o "Saiba mais" sem destino: o salvar do aviso recusa e o foco vai para o `1 problema para revisar` do card, que abre o **Revisar** com o mesmo item (Botão principal, `Escolha para onde o botão leva.`); o item leva o foco ao "Para onde leva" no Conteúdo; o salvar de dentro do editor abre o Revisar com o item, que continua depois de mudar o texto do botão; escolhida a página, o item some, salva e o card fica sem problema |
| Ponta a ponta | `tests/e2e/produtor-ajusta-pop-up-livre-no-celular.spec.ts` (1) | L3: num rascunho Livre, **Ver como: Celular** (`Editando o Celular.`), arrastar o Selo (só o celular muda: o X do computador fica, a etiqueta `Celular` aparece), a aba **Celular** do Título (Tamanho 24 px com **Igual ao computador** desligada) e da Forma (escondida só no celular), **Salvar rascunho** com o editor aberto, recarregar (as etiquetas nas Camadas, a Forma some só no Celular) e publicar; o gravado tem `devices.mobile` com esses valores e o computador como estava |

Amostras em `tests/fixtures/popup-livre/` (imagem WebP com alfa, imagem larga demais, PNG que não é WebP, a capa de teste, o HTML de antes do Padrão e do Personalizado e o HTML do Livre de antes do Celular, `antes-celular-livre.html`, gerado no commit-base 55a8cc0). Ajudas: `tests/e2e/popup-livre-fixtures.ts` (`prepararMidiaDoLivre`, `designVideoNoTopo`, `publicarPopUpLivre`); `zerarComunicacao` (em `tests/e2e/fixtures.ts`) também apaga as imagens de `communications/free/` que nenhum aviso que ficou usa.

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
- **Copiar as instruções para a IA**: o texto de `free-ai-instructions.ts`, gerado deste documento por `npm run livre:instrucoes` (`scripts/livre-instrucoes-ia.mjs`): um começo curto (responder só com o JSON, seguir o contrato à risca, mudar só o que foi pedido num design mandado junto, Imagem e Vídeo novos sempre com `"asset": null` e os `assets` de um design mandado junto devolvidos como vieram, nunca endereço ou caminho de arquivo) e as partes 9.2, 9.3, 9.4, 9.5, 9.6, 9.8 e 9.9 (sem a 9.1 e a 9.7, que são do banco e do editor), sem os trechos marcados com `<!-- ia:fora -->` (nomes de arquivo e de função, banco, buckets, caminhos); o script para se sobrar algum desses termos (L26). O arquivo vai no pacote do editor e só é baixado no clique (abrir o menu já começa); nada busca o docs na hora (L20). `Instruções copiadas. Cole na conversa com a IA junto com o design.` Um teste confere que o arquivo bate com o §9: mudou o §9, rode o script.

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

- **Aba Celular** (a quarta do painel do elemento, depois de **Avançado**): só os campos que têm versão do celular para o tipo, em grupos: **Mostrar** (`Esconder no celular`), **Posição** (solto: X, Y, Largura e a Altura quando o computador tem uma ou o elemento não tem texto; na sequência: Largura, Altura, Alinhar nesta caixa e Margem; o modo é sempre o do computador), **Texto** (Título, Texto, Selo, Botão e Links: Tamanho, Altura da linha, Espaço entre letras, Alinhamento; com a dica "texto no celular" do elemento), **Conteúdo** (Espaço e Ícone: o tamanho; Links: o espaço entre eles; Caixa: direção, espaço, alinhar, distribuir e quebrar linha) e **Respiro e cantos**. Cores, textos, pinturas, sombras, camada e girar não aparecem: são os mesmos nos dois.
- Cada campo tem a chave **Igual ao computador** (ligada por padrão; o nome falado diz o campo: `Tamanho: igual ao computador`). Ligada, o campo mostra o valor do computador, desligado. Desligar cria o valor próprio começando do computador (as alturas automáticas partem do retângulo medido) e liga o campo; ligar de novo tira o valor. Um valor igual ao do computador fica enquanto o editor está aberto (a chave continua desligada) e a forma canônica tira ao salvar. No topo, a frase `O que não mudar aqui encolhe como no computador (texto nunca abaixo de 12 px).` e **Voltar tudo ao do computador** (tira a entrada do elemento, um passo no histórico, `Tudo deste elemento voltou ao do computador.`; desligado quando não há nada). Erro de um campo do celular aparece no campo; o de fora dos campos (o modo trocado num design colado) aparece no topo.
- **Entrar na aba liga o Ver como: Celular**; a aba fica ao trocar de elemento (de qualquer tipo). Trocar o aparelho diz `Editando o Celular.` ou `Editando o Computador.` (região `aria-live`); a aba entra pelo teclado como as outras (setas entre as abas).
- **Ver como: Celular**: o palco desenha `resolveFreeForDevice(design, "mobile")`; arrastar, as 8 alças, as setas (Shift = 10) e **Alinhar no pop-up** gravam em `devices.mobile.nodes.<id>.place` (criando a entrada) e não no computador; o que volta ao lugar do computador sai sozinho (a chave volta a "Igual ao computador"). Cada gesto é um passo no histórico, como antes; as setas seguidas juntam num passo, à parte das do computador (`<id>:mobile.place`). **Soltar**, **Seguir a sequência** e **Colocar dentro da caixa** mudam o modo nos dois aparelhos e tiram a posição do celular (o resto do celular fica); com o Celular, o lugar do **Soltar** sai do retângulo medido no desenho do celular, então o melhor é soltar no Computador. Subir, descer, duplicar, excluir, camada e esconder pelas Camadas continuam do computador.
- **Etiqueta `Celular`** (12 px) nas Camadas, ao lado de `Solta`, e no selecionado do desenho, para todo elemento com valores próprios do celular.
- **No celular** no painel **Pop-up** (nada selecionado): Respiro interno, Espaço entre os elementos e Altura mínima em px, cada um com **Igual ao computador** (`devices.mobile.artboard`).
- **Revisar**: o erro de um campo do celular (`devices.mobile.nodes.<id>…`) leva à aba Celular do elemento, no campo, e liga o Celular; o da prancheta (`devices.mobile.artboard.<campo>`) leva ao **No celular**. A dica "texto no celular" mede o design do celular (§13.4, com os valores próprios) e oferece **Ajustar no Celular**, que abre a aba Celular no Tamanho do texto.
- Por dentro: `free-inspector-mobile.tsx` (a aba e a chave), `free-inspector-model.ts` (`freeMobileFieldsOf`, `freeMobileFieldValue`, `withFreeMobileField`, `withoutFreeMobileValues`, o grupo da prancheta e o mapa das chaves do celular para a aba), `free-editor-model.ts` (`setFreeMobileRect`, `freeMobileFreePlace`, `nudgeFreeNode`/`setFreeNodeRect`/`alignFreeNode` com o aparelho, `freeArrowCoalesceKey`, a etiqueta das Camadas, o item **Ajustar no Celular**), `free-editor.tsx` (o aparelho em cada gesto, o aviso falado, o Revisar), `free-canvas.tsx` (a etiqueta), `free-layers-panel.tsx`, `free-artboard-settings.tsx` e `free-review-panel.tsx`.
- Testes: `tests/popup-livre-editor-modelo.test.mjs` e `tests/popup-livre-painel-modelo.test.mjs` (§11) e o ponta a ponta `tests/e2e/produtor-ajusta-pop-up-livre-no-celular.spec.ts`.

Roteiro de conferência:

1. Num pop-up Livre, **Ver como: Celular**: o palco fica com 343 px. Arrastar um elemento solto: no Avançado o X continua o do computador; na aba **Celular**, o X está com **Igual ao computador** desligada e o valor novo; a etiqueta `Celular` aparece no desenho e nas Camadas.
2. **Computador**: o elemento está no lugar de antes. **Celular** de novo: no lugar novo.
3. Título › **Celular** › Tamanho: desligar **Igual ao computador** e pôr um tamanho menor; só o celular muda. Uma Imagem ou Forma › **Celular** › **Esconder no celular**: some só no Celular.
4. **Voltar tudo ao do computador** num elemento: a etiqueta some e o celular volta a encolher o computador.
5. Nada selecionado › **No celular** › Respiro interno menor: só o celular muda.
6. Salvar, abrir o pop-up publicado num celular (ou numa janela de até 767 px) e num computador: cada um com os seus valores.
