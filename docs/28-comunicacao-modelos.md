# 28. Comunicação: modelos (notificação, pop-up e design)

Data: 25/10/2026 (decidido com o produtor em 23/10/2026). Pedido do produtor depois do Design Livre (`docs/27`): guardar a configuração de uma notificação ou de um pop-up (quem envia, ícone, tempo no sino, para quem, onde e quando aparece, quantas vezes, como fecha, o design) para começar o próximo aviso pronto, e reusar um design Personalizado ou Livre "com outros vídeos e tudo mais". Continua os docs 22 a 27. Migração `202610250001` (uma tabela nova, `communication_templates`).

Vocabulário na tela: "modelo", "Meus modelos", "Modelos prontos", "segmento", "Para quem". Nunca "template", "público", "audiência", "layout" nem "lembrete" (as guardas de vocabulário que já existem continuam valendo, §10).

---

## Resumo em uma página

1. Na Comunicação aparece uma aba nova, **Modelos**, ao lado de Avisos e pop-ups e de Fluxos.
2. Um modelo guarda a configuração de uma **notificação** ou de um **pop-up**: quem envia, o ícone, quanto tempo fica no sino, para quem vai, onde e quando o pop-up aparece, quantas vezes, como fecha, o "Lembrar depois" e o design. Se a equipe quiser, guarda também o conteúdo (título, texto, imagem, áudio, botão) e as notificações seguintes.
3. Existe também o modelo de **Design**: só o visual do pop-up (Personalizado ou Livre). Ele aparece em **Meus modelos**, dentro do card Design e do editor Livre.
4. Para criar um modelo: no editor do aviso, **Salvar como modelo**; na lista de avisos, ⋯ › **Salvar como modelo**; no card Design, **Salvar design como modelo**; ou, na aba Modelos, **Novo modelo**.
5. Para usar: na aba Modelos, ⋯ › **Usar**; ou **Novo aviso** e escolher um modelo. O editor abre preenchido e nada é salvo até "Salvar rascunho" ou "Publicar".
6. Data e hora de envio nunca vão para o modelo. O fim da janela do pop-up, uma data fixa no sino e o fim marcado da enquete também não. Cada aviso escolhe os seus.
7. Dá para salvar o pop-up como modelo e depois excluir o pop-up: o modelo continua com o vídeo, as imagens, o áudio e as fontes dele.
8. Excluir o modelo manda os arquivos que mais nada usa para a fila da limpeza; eles saem 30 dias depois.
9. Mudar ou excluir um modelo nunca mexe nos avisos que já foram criados com ele.
10. Quem cria avisos cria e edita modelos (`messaging.write`). Os alunos nunca veem um modelo.

---

## 1. O que a equipe vê

### 1.1 Navegação, aba e rotas

| Rota | O que mostra |
|---|---|
| `/admin/comunicacao/modelos` | a lista (§1.2), com esqueleto no formato final |
| `/admin/comunicacao/modelos/novo` | sem `?tipo` (ou com valor desconhecido): a escolha do tipo (§1.5). Com `?tipo=notificacao`, `popup`, `design-personalizado` ou `design-livre`: o editor em modo modelo, vazio |
| `/admin/comunicacao/modelos/[id]` | o editor em modo modelo (§1.6) ou a página do Design (§1.7); modelo que não abre: "Este modelo não pode ser aberto" com "Ver modelos"; inexistente ou excluído: "Modelo não encontrado" / "Ele pode ter sido excluído." |
| `/admin/comunicacao/avisos/novo?modelo=<id>` | o editor do aviso preenchido pelo modelo (D5); com `?modelo`, o `?tipo` é ignorado |
| `/admin/comunicacao/avisos/novo?webinario=<id>&tipo=notificacao\|popup` | o editor do aviso preenchido pelo Webinário salvo, pelos atalhos **Aviso no sino** e **Pop-up** do card **Avisar** (`docs/30` §2.2 e D42), no mesmo caminho do D5 (o `start` lido só na montagem, nada gravado até salvar); o `?modelo=` vence quando os dois vêm; Webinário que não vale mais volta ao editor dele, inexistente volta à lista de Webinários |
| `/admin/comunicacao/avisos/novo?webinario=<id>&tipo=notificacao&seguimento=registered,nao-attended` | o mesmo endereço com `&seguimento=` (o **Avisar quem não veio** do relatório, `docs/30` §3.4): o aviso em branco com as regras **Participação em lives** da live no "Para quem" (todas valendo; `nao-` = negada; até 4 ações, sem repetir), sem ler o Webinário e sem gravar nada (o mesmo `start` do D5, com a nota "O “Para quem” já vem com as regras da live inteira: quem garantiu vaga em qualquer horário e não entrou em nenhum. Confira e escreva o aviso: nada foi salvo ainda."). `?seguimento=` que não vale (id que não é uuid, ação fora da lista, repetida, vazia ou mais de 4) abre o aviso em branco. Os dois botões montam o endereço por `webinarNoticeHref` e a página lê por um parse só (`webinarNoticeRequestOf`, `src/server/webinars/notice-shortcut-model.ts`): sem `?webinario=`, o Novo aviso de sempre; sem `?seguimento=`, o card Avisar; com ele, as regras |

- A aba é uma aba de verdade da Comunicação, na ordem **Avisos e pop-ups · Fluxos · Modelos · Webinários · Promoções**, com a descrição "Configurações prontas de notificações, pop-ups e designs para começar avisos novos. Os modelos de fluxo ficam em Novo fluxo." Não tem números no topo nem Período (D22).
- Menu lateral: o filho "Modelos" depois de Fluxos; o título do celular em `/modelos/novo` é "Novo modelo". O Cmd+K ganhou a ação **Novo modelo** (só para quem tem `messaging.write`); a tela "Modelos" entra sozinha pelo menu.
- Títulos das páginas: "Modelos · Comunicação", "Novo modelo · Comunicação" e "Modelo · Comunicação".
- Toda página chama `requirePageArea("comunicacao")` e manda quem não tem `messaging.write` para a home da Comunicação; a analista nem vê a área.

### 1.2 Aba Modelos: a lista

- Cabeçalho "Comunicação" com **Novo modelo**; as abas; os filtros numa linha que quebra no celular: busca (rótulo para leitor de tela "Buscar modelo pelo nome", placeholder "Buscar pelo nome", `?busca=`, espera de 300 ms, volta à página 1) e as pílulas `?tipo=` **Todos**, **Notificação**, **Pop-up**, **Design Personalizado**, **Design Livre** (`aria-label="Tipo do modelo"`; valor desconhecido = Todos).
- Tabela (cartões no celular, linhas de 64 px; a linha leva a `/modelos/[id]`): **Modelo** (miniatura 36×48, nome e o resumo embaixo; o que não abre leva o chip "Não abre"), **Tipo**, **Atualizado em** (no cartão do celular, "Atualizado", sempre visível), **Criado por** (some no celular; quem saiu da equipe = "Alguém que saiu da equipe") e o ⋯. Paginação de 20 ("modelos"); a linha "{n} de 200 modelos" só a partir de 150.
- Resumo: notificação "Leva conteúdo, segmento e 2 notificações seguintes" (ou "Leva conteúdo", "Só a configuração"); pop-up "Design Personalizado · leva conteúdo e segmento" (ou "Design Padrão · só a configuração"); design "Só o visual do pop-up, montado por seções" / "… montado no editor Livre"; o que não abre "Este modelo não pode ser aberto."
- Miniaturas (decorativas, `aria-hidden`): Personalizado = as barras coloridas (36×48 na lista, 60×84 no seletor); Livre = o cartão do aluno em prévia, reduzido (36×48 ou 120×160), montado só quando aparece na tela e **sem `<video>`** (a prop `still` do `MemberPopupCard` força o poster; o aluno nunca passa `still`); notificação = o círculo com o ícone; pop-up Padrão = um painel.
- ⋯ ("Ações de {nome}"): **Usar** (`/avisos/novo?modelo=<id>`), **Editar** (`/modelos/<id>`), **Renomear** (diálogo "Renomear modelo", campo "Nome do modelo" com "{n}/80", "Cancelar"/"Salvar nome"; toast "Nome salvo."), **Duplicar** (toast "Modelo duplicado."; o nome ganha " (cópia)"), **Excluir** (confirmação "Excluir o modelo?" / "“{nome}” sai da lista de modelos. Os avisos criados com ele não mudam." / "Excluir modelo"; toast "Modelo excluído."). O modelo que não abre mostra só Renomear e Excluir. A lista atualiza com `router.refresh` numa transição.
- Erros num banner acima da tabela: 409 com "Este modelo mudou em outra tela", a frase de "mudou" e **Recarregar**; os outros com "Não foi possível concluir" (422: "Você chegou a 200 modelos. Exclua um que não usa mais para criar outro.").
- Vazia: "Nenhum modelo ainda" / "Um modelo guarda a configuração de uma notificação, de um pop-up ou só de um design, para começar o próximo aviso pronto. Crie aqui ou use “Salvar como modelo” num aviso." com **Novo modelo** e **Ver avisos**. Com busca ou filtro sem resultado: "Nenhum modelo encontrado" / "Tente outro nome ou outro tipo." com **Limpar filtros**.
- Migração pendente: o aviso `202610250001` abaixo das abas.
- Teclado: o ⋯ abre com Enter, Espaço ou seta para baixo e fecha com Esc devolvendo o foco; os diálogos focam o nome com o texto selecionado (Enter salva, Esc fecha); depois de renomear, o foco volta ao ⋯ da linha; depois de excluir, vai para o nome da linha seguinte (ou da anterior; lista vazia: "Novo modelo" do estado vazio).

### 1.3 "Salvar como modelo"

Num diálogo no estilo da confirmação (`max-w-md`), aberto pelo botão **Salvar como modelo** do cabeçalho do editor (antes do ⋯; desabilitado com "Espere o envio terminar." durante um envio) ou pelo ⋯ da lista e do relatório (logo depois de Duplicar, só quando o aviso pode ser duplicado: passo de fluxo nunca vira modelo).

- Título "Salvar como modelo"; descrição na notificação "Um modelo de notificação guarda a configuração para começar outro aviso pronto. Data e hora de envio não vão." e no pop-up "Um modelo de pop-up guarda onde, quando, quantas vezes e o design. Data de início e fim não vão."
- Campo "Nome do modelo" com o título do aviso (cortado em 80) ou "Modelo de notificação" / "Modelo de pop-up", e "{n}/80".
- Chaves, ligadas: **Levar o conteúdo** (notificação: "Título, texto, imagem, áudio, botão e interação."; pop-up Padrão: "Título, texto, imagem, áudio e botão."; pop-up com design: "… Os textos que ficam dentro do design vão sempre com o design."; pop-up pelo ⋯: "… Se o pop-up tiver design, os textos de dentro dele vão sempre com o design."), **Levar o segmento** ("Quem recebe: o que está em “Para quem”.") e, só na notificação com seguintes, **Levar as notificações seguintes ({n})** ("Com quando saem e para quem vai cada uma."; desligada e desabilitada quando as seguintes só abrem no construtor).
- Do editor, as notas do que não vai (por exemplo "“Fica no sino até uma data” não vai para o modelo: ele fica com 90 dias."). Pelo ⋯, as notas chegam no toast.
- O editor usa **o que está na tela**, com as mudanças não salvas, e não grava o aviso (D11); o ⋯ usa a versão gravada. Sucesso: "Modelo salvo em Comunicação › Modelos." (mais as notas). Nada da tela de onde o diálogo abriu é recarregado (D28).
- Erros: o do nome embaixo do campo; outro de campo num banner "Corrija no aviso antes de salvar como modelo: {rótulo}: {mensagem}"; 409 (design ilegível), 422 e 404 com a frase do servidor ("Não foi possível salvar o modelo").

### 1.4 "Novo aviso" com modelos

Sem nenhum modelo, o botão continua o link de sempre para `/avisos/novo`. Com modelos, vira um menu: **Começar em branco**, o rótulo "Meus modelos", os 5 mais recentes (nome e tipo à direita) e **Ver todos os modelos ({total})**. `/avisos/novo` continua abrindo o editor em branco, sem passo extra (D23). Migração pendente ou leitura que falha: o link.

### 1.5 "Novo modelo": escolha do tipo

Breadcrumb "Modelos" › "Novo modelo", título "Novo modelo", "Que tipo de modelo você quer criar?". Quatro cartões (links, uma coluna no celular):

| Cartão | Frase |
|---|---|
| Notificação | Quem envia, ícone, tempo no sino, para quem e, se quiser, o conteúdo e as notificações seguintes. |
| Pop-up | Onde e quando aparece, quantas vezes, como fecha, o design e, se quiser, o conteúdo. |
| Design Personalizado | Só o visual montado por seções. Aparece em “Meus modelos” no card Design. |
| Design Livre | Só o visual montado do zero no editor Livre. Aparece em “Meus modelos” no card Design e no editor Livre. |

### 1.6 Modo modelo do editor (notificação e pop-up)

É o editor do aviso, com estas diferenças:

| Parte | No modo modelo |
|---|---|
| Cabeçalho | breadcrumb Modelos › Editar modelo (ou Novo modelo); título "Modelo: {nome salvo}" (ou "Novo modelo de notificação" / "Novo modelo de pop-up"); descrição "Modelo de notificação" ou "Modelo de pop-up" e " · Atualizado em {data}"; **Usar modelo** (desabilitado com mudança não salva: "Salve o modelo antes de usar."). Sem ⋯ e sem "Salvar como modelo" |
| Card **Modelo** (topo) | "Nome do modelo" (obrigatório, "{n}/80"), "Ao usar, você começa um aviso novo com tudo o que está aqui. Nada é enviado daqui." e as mesmas chaves do §1.3, começando como estão no modelo (parte guardada = ligada; modelo novo = tudo ligado; D31); as notas de leitura (e as de quem envia, quando a pessoa saiu da equipe) logo abaixo. As notas de aplicar o design ("O botão principal ganhou o texto…", "Lembrar depois" ligado, a imagem que falta) são do **Usar**, nunca do modo modelo |
| Chave desligada | os campos continuam na tela (a prévia e o design dependem deles), com a nota "O conteúdo não vai neste modelo. Ligue “Levar o conteúdo” no card Modelo para guardar o que está aqui.", "O segmento não vai neste modelo: o aviso feito com ele começa em “Todos os alunos”." ou "As notificações seguintes não vão neste modelo." |
| Tipo | sem as pílulas: "Modelo de notificação" ou "Modelo de pop-up" e a dica "O tipo do modelo não muda. Para o outro tipo, crie outro modelo." |
| Quando (notificação) | vira **Tempo no sino** ("Quanto tempo a notificação fica no sino de cada aluno."), sem "Até uma data" (também na folha das seguintes) |
| Quando e onde aparece (pop-up) | sem "Começa" e "Termina"; desde a v3b-2 (`docs/29` §2.1), as quatro pílulas de **Quando aparece** (`Ao abrir a página`, `Ao concluir uma aula`, `No primeiro acesso`, `Ao concluir um curso`) e, em `No primeiro acesso`, **Conta como primeiro acesso** com os produtos (até 20). A trava do primeiro acesso só vale no pop-up que já foi ao ar (nunca no modelo nem no aviso novo feito dele) |
| Enquete | sem o fim por data |
| Seguintes | o cartão sem "Enviar teste", sem "Ver como fluxo" e sem "Até uma data" |
| Design (pop-up) | a escolha Padrão/Personalizado/Livre continua; "Meus modelos" e "Salvar design como modelo" também; o editor Livre diz "Salvar modelo" e "Modelo: {nome}", tem a aba Modelos e salva sem fechar ("Modelo salvo."). Com "Levar o conteúdo" desligado, o destino do botão principal some no Personalizado e no Livre ("O destino do botão é escolhido em cada aviso."), como na página do Design: só o texto do botão vai (D3); o salvar manda o destino vazio, para um destino de antes não segurar o salvar. Ligado, o destino aparece e vai com o conteúdo |
| Revisão | "Ao usar este modelo, você começa um aviso novo com esta configuração. Os alunos nunca veem um modelo.", **Salvar modelo** ("Salvando…"), **Descartar mudanças** quando salvo e mudado, e "Ctrl+Enter (⌘+Enter no Mac) salva o modelo." Sem Publicar, Salvar rascunho nem Enviar teste; sem as notas de aprovação, agendado, no ar e enviada |
| Prévia | "Prévia do modelo: os alunos nunca veem um modelo." |
| Validação | o rascunho afrouxado (título e textos podem ficar vazios, D8) mais o nome |
| Salvar | o primeiro salvar de um modelo novo troca o endereço para `/modelos/<id>` (com o Livre aberto, isso fica para o Concluir). Toast "Modelo salvo." Erro: banner "Não foi possível salvar o modelo" (nunca "aviso"), com a frase do erro |
| Parte que não abriu (D29) | o primeiro "Salvar modelo" (botão, Ctrl+Enter ou de dentro do Livre) pergunta "Salvar o modelo assim?" / "Uma parte deste modelo não pôde ser lida e voltou ao padrão. Ao salvar, o padrão fica no lugar dela." |
| 409 | banner "Este modelo mudou em outra tela" com a frase e **Recarregar**: a versão nova chega e o que a equipe não mexeu passa a ser o da versão nova (o resto fica) |

**Modelos aplicados neste editor (`usedTemplateIds`).** Todo editor (aviso novo, gravado e modo modelo) guarda os modelos usados: o do `?modelo=` e cada "Usar este modelo" de "Meus modelos" (sem repetidos, o de início sempre, até 5). A lista vai em `fromTemplates` de todo "Salvar rascunho"/"Publicar" e em `sourceTemplateIds` de todo salvar de modelo; o servidor conta os arquivos desses modelos como já conferidos (D16). O salvar do aviso ou do modelo zera a lista; o "Salvar como modelo" (diálogo) não zera, porque o aviso ainda não foi gravado. O **Desfazer** do toast de "Usar este modelo" (Personalizado, e o Livre em tela estreita) tira o modelo da lista (`undoTemplateUse`): o salvar seguinte não o manda nem grava `template_used` com ele; ficam o de início e o modelo que já estava na lista antes de aplicar. No editor Livre, o Ctrl+Z que volta ao design de antes **não** tira o modelo da lista (o id fica até o salvar).

**Aviso novo de um modelo** (`?modelo=`): o rascunho começa pelo modelo (a tela já conta como mudada); no topo, "Você começou do modelo “{nome}”. Nada foi salvo ainda." e as notas (quem enviava saiu da equipe, o botão ganhou texto…), até o primeiro salvar (também o de dentro do editor Livre, que não troca de endereço). As seguintes chegam com **ids novos** e as regras remapeadas; são gravadas no primeiro salvar. Modelo excluído: "Este modelo não existe mais. Você está começando em branco."; modelo que não abre: "Este modelo não pode ser aberto. Você está começando em branco." O mesmo `start` serve ao aviso que começa de um Webinário (`?webinario=`, `docs/30` D42 e §3.4): sem modelo (`templateId` e `templateName` nulos, nada em `fromTemplates`), a nota do topo vem nas `notes` ("Você começou pelo webinário “{nome}”. Nada foi salvo ainda." e, no pop-up, "Começa e Termina seguem a hora da live. Mude se quiser avisar antes."; com `&seguimento=`, "O “Para quem” já vem com as regras da live inteira: quem garantiu vaga em qualquer horário e não entrou em nenhum. Confira e escreva o aviso: nada foi salvo ainda.") e o "Você começou do modelo…" não aparece (`noticeStartNotes`).

**Cuidado do pop-up sem conteúdo**: o botão principal do design vem com o texto do modelo (ou "Saiba mais") e o destino vazio; o salvar pede "Escolha para onde o botão leva." (no Livre, o destino se escolhe no Botão principal do editor).

### 1.7 Página do modelo de Design

- Cabeçalho como no modo modelo: "Modelo: {nome}" (ou "Novo modelo de design Personalizado" / "Novo modelo de design Livre"), descrição "Design Personalizado" ou "Design Livre", ação **Usar num pop-up novo**.
- À esquerda, o card Modelo (só o nome) e o card Design com o **modo fixo** (sem a escolha Padrão/Personalizado/Livre) e sem "Meus modelos" (o que se edita já é um modelo). No Personalizado, Mídia, Blocos, Cartão, Fontes e Fechar funcionam como no aviso. O destino do botão principal some (Personalizado e Livre): no lugar, "O destino do botão é escolhido em cada aviso."; o texto do botão continua editável.
- À direita, a mesma prévia do aviso: com o design, o celular (375 px) e o computador juntos, sem a escolha (como no editor do aviso com Personalizado ou Livre); num modelo novo, antes de escolher o design, a escolha **Computador | Celular**. Embaixo, Revisão com "Salvar modelo" e Ctrl+Enter. Erro: banner "Não foi possível salvar o modelo" (no 409, "Este modelo mudou em outra tela").
- O editor Livre da página diz "Salvar modelo" e "Modelo: {nome}", **não** tem a aba Modelos e, ao salvar, "Modelo salvo." (nunca "Rascunho salvo."). Em Links › Conteúdo, no lugar da chave "Permitir “Lembrar depois”" (que o modelo de design não guarda; `docs/27` §13.7), a nota `“Lembrar depois” é regra do pop-up, não do modelo de design: define-se no aviso.` (`allowSnoozeEditable: false` no card Design). Parte que não abriu e 409: como no §1.6.

### 1.8 "Meus modelos" e "Salvar design como modelo" no card Design

- Na lista do modo (Personalizado ou Livre), quando ela abre, "Meus modelos" é lido uma vez por card montado: duas linhas de esqueleto ("Carregando seus modelos…"); erro "Não foi possível carregar seus modelos agora." com **Tentar de novo**. Com itens, a seção "Meus modelos" vem antes dos **Modelos prontos**: miniatura, nome, "Atualizado em {dd/mm/aaaa}" e **Usar este modelo** ("Usar este modelo: {nome}"); com mais de 50, "Mostrando os 50 mais recentes." Sem itens, a seção não aparece.
- **Personalizado**: aplica na hora e o toast "Design aplicado." (mais as notas) oferece **Desfazer**, que volta o design, o botão, a imagem e o "Lembrar depois" de antes. A imagem do modelo só preenche o aviso sem imagem (D4).
- **Livre**: com um Livre já no aviso, pergunta "Trocar de modelo?" / "O design Livre atual será trocado pelo modelo. Dá para desfazer no editor." e abre o editor com o Livre de antes um passo atrás (Ctrl+Z); sem Livre antes, abre só com o design aplicado. Em tela estreita (sem editor), toast com Desfazer.
- **Salvar design como modelo** (ao lado de "Trocar de modelo", no Personalizado e no Livre com design): diálogo "Salvar design como modelo" / "Fica em “Meus modelos” do design {Personalizado|Livre} e em Comunicação › Modelos. Os textos do design vão junto; o destino do botão fica em cada aviso.", nome "Design de {título}" (ou "Design Personalizado"/"Design Livre"), "Salvar modelo"; toast "Design salvo em Meus modelos." A lista daquele modo é lida de novo na próxima abertura.

### 1.9 Editor Livre: a aba Modelos

- As abas da esquerda viram **Elementos | Camadas | Modelos** (a terceira no aviso e no modo modelo de Pop-up; nunca na página do Design).
- **Salvar este design como modelo** (largura inteira): o mesmo diálogo do §1.8; grava o design do histórico atual sem salvar o aviso. Ao fechar, o foco volta ao botão, e a lista da aba é lida de novo.
- **Meus modelos**: os designs Livres guardados (miniatura, nome, "Atualizado em…", **Usar este modelo**); vazia: "Seus designs Livres salvos aparecem aqui. Use “Salvar este design como modelo”."; erro com "Tentar de novo".
- Usar aplica dentro do editor, sem pergunta, **num passo só do histórico** (Ctrl+Z desfaz): "Modelo aplicado. Ctrl + Z desfaz." Quando o botão principal é criado agora e o modelo traz o texto dele, a nota é "O botão principal ganhou o texto “{texto}”. Escolha para onde ele leva." (no lugar da nota do colar).

### 1.10 Acessibilidade

Botões de ícone com `aria-label`; toques de 44 px em `pointer-coarse`; foco visível. Diálogos com o foco no primeiro campo, preso dentro e de volta ao gatilho ao fechar; Esc fecha (menos durante o salvar); Enter envia o diálogo. O Ctrl+Enter (⌘+Enter) do editor do aviso e da página do Design só vale com o foco no editor: num diálogo ("Salvar como modelo", "Salvar design como modelo", "Enviar fonte", as confirmações), num painel (a notificação seguinte), na lista de uma escolha ou num menu, não faz nada (D32). Toasts só de sucesso; erro fica em banner (`role="alert"`). Nada abaixo de 12 px; a lista a 375 px vira cartões sem rolagem lateral (conferido no ponta a ponta).

---

## 2. Dados (migração `202610250001`)

### 2.1 A tabela

`communication_templates` (texto completo no arquivo; detalhes em `docs/05`, seção Modelos da Comunicação): `id`, `kind` (`inbox`, `popup`, `design`; não muda), `design_mode` (`custom`, `free`; nulo na notificação e no pop-up Padrão), `name` (1 a 80, não precisa ser único), `payload` (jsonb), `created_by`/`updated_by`/`deleted_by` (`on delete set null`), `created_at`, `updated_at` (versão do editor, pelo gatilho com a função que já existe `public.set_updated_at()`), `deleted_at` (excluir = marcar). Checks: o tipo, o modo, o nome, `communication_templates_design_mode` (notificação sem modo, design com modo) e `communication_templates_payload_v1` (objeto, `version` numérica com `coalesce`, `kind` igual à coluna, `pg_column_size <= 1048576`). Índices da lista e dos seletores (`where deleted_at is null`). RLS ligado e sem política; `revoke all` de `anon`/`authenticated`; só `service_role`. Uma seção só, idempotente, pelo MCP; sem `drop`, `delete` nem função nova; o texto `popup_design` nunca aparece nela.

### 2.2 O payload (versão 1, `src/server/communications/template-model.ts`)

- **Notificação** `{ audience, content, followUps, kind: "inbox", settings: { allowHide, icon, sender, validity }, version: 1 }`. `validity` é `default` ou `{ mode: "duration", minutes }` (nunca uma data).
- **Pop-up** `{ audience, content, design, designSupport, kind: "popup", settings: { allowSnooze, icon, popup }, version: 1 }`. `settings.popup` é um `PopupSettings`: desde a v3b-2 (`docs/29` §2.7, D17), `trigger` pode ser também `first_login` (No primeiro acesso) ou `course_completed` (Ao concluir um curso) e, **só em `first_login`**, `accessProducts` (ids de produto, até 20; lista vazia = "A primeira vez na área"); nos outros momentos a chave não existe (forma canônica), então os modelos de antes continuam byte a byte. Mudança aditiva: a **versão continua 1** e nenhuma função de atualização foi preciso. O "começo do pop-up" do primeiro acesso é sempre o do aviso criado a partir do modelo (a janela nunca vai). Produto citado que não existe mais: o chip `Produto removido` no editor. `design` nulo = Padrão; Personalizado (sem `mode`) ou Livre (`mode: "free"`), na forma gravada no aviso. `designSupport` só quando há design e o conteúdo fica de fora: o texto do botão principal (quando o design tem o botão) e a imagem do Personalizado com mídia imagem ou vídeo (D3, D4); o destino do botão nunca vai.
- **Design** `{ design, designSupport, kind: "design", version: 1 }`.
- `content` (pode estar incompleto, D8): título, texto, imagem, áudio, botão (`href` e `label` podem ser ""), enquete sem fim marcado (`closesAt: null`), reações e resposta. `audience` = "Para quem". `followUps` = `{ entryId, goal, items }` no formato do cartão das seguintes, sem "até uma data". Parte `null` = a chave estava desligada.
- Ordem das chaves alfabética. O Personalizado guarda a URL recalculada pelo servidor; o Livre guarda só caminhos. `design_mode` da linha sai do payload.
- Limites (`TEMPLATE_LIMITS`): 200 modelos, nome 80, payload 768 KB (786.432 bytes) pela estimativa por cima (`jsonbBytesUpperBound`), 50 itens em "Meus modelos", 20 por página, 5 no "Novo aviso", 5 modelos aplicados guardados pelo navegador, 20 aceitos pelo servidor, 29 dias de exclusão que ainda contam como "arquivo já conferido".

### 2.3 Schemas

- **Entrada dos editores** (`templateDraftInputSchema`): as chaves do rascunho, afrouxadas: título, textos do botão, Aceitar/Recusar, pergunta e opções podem ficar vazios; as regras de "um precisa do outro" (design × botão, áudio, imagem, "parar no clique" sem botão) não travam. Formatos, limites, ids, listas, segmento e configuração do pop-up seguem os schemas do rascunho, com as mesmas frases; o pop-up continua recusando enquete, reações, resposta, quem envia e tempo no sino. Chaves de envio (`schedule`, `window`, `repeat`) são aceitas e descartadas. As seguintes seguem o schema estrito de hoje.
- **Payload gravado** (`templatePayloadSchema`): estrito por partes (chave a mais recusa), `version: 1`, os limites do conteúdo por tipo e o teto de tamanho (`tooBig`).
- **Momentos da v3b-2** (`docs/29` D17): os dois momentos novos e `accessProducts` entram sozinhos pelo `popupSettingsSchema` (salvar e ler) e pelo `popupTemplateSettingsSchema` estrito (a chave `popup` é um `z.object`, que apaga chave desconhecida): `accessProducts` com id inválido = `Escolha produtos da lista.`, 21 = `Use até 20 produtos.`, num modelo com outro momento = some na leitura. **App de antes abrindo modelo novo** (uma prévia de PR antiga no mesmo banco): o `trigger` desconhecido reprova a parte `settings` e ela inteira vira o padrão, com a nota `readSettings` (`docs/29` §9.2, R2). Teste em `tests/comunicacao-modelos-modelo.test.mjs` e na integração `pop-ups-v3b2-momentos`.
- **Ações**: `saveTemplateSchema` (do rascunho ou do design; com id exige `expectedUpdatedAt`; design: exatamente um dos dois), `saveTemplateFromNoticeSchema`, `renameTemplateSchema`, `templateIdInputSchema`, `loadDesignTemplatesSchema`. `sourceTemplateIds` aceita até 20 e tira os repetidos.

### 2.4 Construtores e leitura

- `templatePayloadOfDraft`: configuração sempre (na notificação, "até uma data" vira 90 dias com nota); conteúdo se a chave estiver ligada (o fim da enquete vira `null`, com nota); design sempre no pop-up (`freeDesign ?? design ?? null`, com o apoio quando o conteúdo fica de fora); segmento normalizado se ligado; seguintes se ligadas (sem "até uma data", com nota). Nunca grava envio, janela, `repeat`, `reshow` nem ids de aviso ou fluxo.
- `parseTemplatePayload(kind, raw)`: versão inteira de 1 até a atual (menor passa pelas `TEMPLATE_UPGRADES`, vazias na v1; maior ou não inteira = não abre) e `kind` igual à coluna; depois, parte por parte, cada uma no seu schema. A parte que não passa volta ao padrão e ganha uma nota (`readSettings`, `readDesign`, `readContent`, `readAudience`, `readFollowUps`); no tipo Design, design inválido = o modelo não abre. Nunca lança; nunca é usada pela limpeza (que lê o jsonb cru). **Toda troca de versão traz a função de atualização da versão anterior e um teste com um payload gravado nela.**
- `noticeStartOfTemplate`: o que o editor abre. No "Usar", ids novos para a entrada e cada seguinte e as regras remapeadas (`remapNodeRefs`, que mora em `audience-model.ts`); no modo modelo, os ids gravados (D28). Sempre envio "agora", janela nula, enquete sem fim; no pop-up, resposta e quem envia nulos e tempo no sino padrão.
- `applyDesignTemplatePatch`: aplica um design num rascunho (card Design, Usar, página do Design): Personalizado com os blocos sincronizados e a imagem do modelo só no aviso sem imagem; Livre na forma canônica e sincronizado com o conteúdo; sem botão no aviso e com botão principal no design, cria o botão com o texto do modelo (ou "Saiba mais") e destino vazio; com "Lembrar depois" no design, liga o "Lembrar depois". Notas `applyCta`, `applySnooze`, `applyNeedsImage`.

### 2.5 Rótulos e textos

`Notificação`, `Pop-up`, `Design Personalizado`, `Design Livre`. As frases do servidor e das notas (`TEMPLATE_MESSAGES`), todas exatas:

| Chave | Texto |
|---|---|
| `changed` | Este modelo mudou em outra tela há instantes. Recarregue a página para ver a versão atual. |
| `changedTitle` | Este modelo mudou em outra tela |
| `missing` | Este modelo não existe mais. Ele pode ter sido excluído em outra tela. |
| `kindFixed` | O tipo do modelo não muda. |
| `designUnreadable` | O design deste pop-up não pôde ser lido e não iria para o modelo. Abra o pop-up, confira o design e salve antes de guardar como modelo. |
| `limit` | Você chegou a 200 modelos. Exclua um que não usa mais para criar outro. |
| `tooBig` | Este modelo ficou grande demais para guardar. Tire algumas regras de “Para quem” ou notificações seguintes e tente de novo. |
| `unreadable` | Este modelo não pode ser aberto: ele foi guardado num formato que não vale mais. Você pode excluí-lo. |
| `pickDesign` | Escolha um design para guardar. |
| `flowStep` | Este aviso é um passo de fluxo. Ele muda pelo fluxo. |
| `noteUntil` | “Fica no sino até uma data” não vai para o modelo: ele fica com 90 dias. |
| `notePollEnd` | O fim marcado da enquete não vai para o modelo: ela encerra quando a notificação sair do sino. |
| `noteFollowUpUntil` | As notificações seguintes com “até uma data” ficam com 90 dias no modelo. |
| `noteBuilderOnly` | As notificações seguintes deste aviso só abrem no construtor de fluxos e não foram para o modelo. |
| `noteOtherGoal` | O objetivo das notificações seguintes foi mudado no construtor de fluxos e não vai para o modelo. |
| `readSettings` | A configuração guardada neste modelo não pôde ser lida e voltou ao padrão. |
| `readDesign` | O design guardado neste modelo não pôde ser lido e ficou no Padrão. |
| `readContent` | O conteúdo guardado neste modelo não pôde ser lido e ficou de fora. |
| `readAudience` | O segmento guardado neste modelo não pôde ser lido: ficou “Todos os alunos”. |
| `readFollowUps` | As notificações seguintes guardadas neste modelo não puderam ser lidas e ficaram de fora. |
| `startFrom(nome)` | Você começou do modelo “{nome}”. Nada foi salvo ainda. |
| `startMissing` | Este modelo não existe mais. Você está começando em branco. |
| `startUnreadable` | Este modelo não pode ser aberto. Você está começando em branco. |
| `senderGone(nome)` | Quem envia no modelo ({nome}) não está mais na equipe: a notificação vai em nome da escola. Troque em “Quem envia” se quiser. |
| `followUpSenderGone` | Alguém que enviava uma notificação seguinte não está mais na equipe: ela vai em nome da escola. |
| `applyCta(label)` | O botão principal ganhou o texto “{label}”. Escolha para onde ele leva. |
| `applySnooze` | “Lembrar depois” foi ligado: o design tem esse botão. |
| `applyNeedsImage` | Este design usa uma imagem. Envie a imagem na Mídia. |
| `fontInTemplates(n)` | Esta fonte está em 1 modelo. Troque a fonte nesse modelo ou exclua o modelo antes. / Esta fonte está em {n} modelos. Troque a fonte nesses modelos ou exclua os modelos antes. |

### 2.6 O que nunca entra no payload

`schedule` (modo e `sendAt`), `window.startsAt`/`endsAt`, "até uma data" (`validity` em `until`), `poll.closesAt`, `repeat`, `reshow`, `id`, `status`, pedidos e aprovações, contagens e datas de envio, edição, `flow_id`, `flow_node_id`, `source_campaign_id`, o `campaignId` das seguintes, `updated_at`, estatísticas e interações, `followUps.flowId`/`updatedAt`, o destino do botão no `designSupport`, a URL de vídeo do Livre (só o caminho) e nenhum dado de aluno. A guarda unitária monta um rascunho com tudo isso preenchido e confere que o payload não tem nenhuma dessas chaves nem texto ISO de data.

---

## 3. Segurança

- **Banco fechado**: RLS ligado e sem política, `revoke all` de `anon`/`authenticated` (a integração exige `42501` dos dois), só o `service_role`. Nenhuma rota do aluno, nenhuma `/api` e nenhum componente de `src/components/member` importa os módulos de modelo nem cita a tabela (guarda).
- **Permissões**: toda ação por `runAdminAction("messaging.write")` (analista 403, sem sessão 401); páginas com `requirePageArea` e a mesma permissão.
- **Zod** no navegador, na Server Action (o payload final passa no schema estrito antes de gravar) e na leitura (parte por parte); o banco confere objeto, versão, tipo e 1 MB.
- **Arquivos (D16)**: o salvar nunca apaga; só o fim do envio apaga o vídeo recusado novo (menos de 1 hora) que ninguém cita. Arquivo de modelo conta como conferido só se a linha do modelo existe (ou foi excluída há menos de 29 dias). A fonte citada por modelo não sai da biblioteca.
- **Auditoria sem nome**: só ids encontrados no banco, códigos e contagens (§4.6).
- **Quem envia**: quem saiu da equipe vira "a escola" ao usar ou editar, com nota; salvar com quem envia fora da equipe = 400 no campo.
- Detalhes em `docs/06`, seção Modelos da Comunicação.

---

## 4. Por dentro

### 4.1 Módulos

| Arquivo | O que faz |
|---|---|
| `src/server/communications/template-model.ts` | puro (sem `@/`, `server-only`, React ou `components/`): tipos, limites, textos, schemas, construtores, leitura, `noticeStartOfTemplate`, `applyDesignTemplatePatch`, resumo, nomes, mapa de erros, `TEMPLATES_HREF` e o parser único do `?tipo=` |
| `template-store.ts` | a tabela: linhas, colunas, guarda de versão (a mesma de `updateCampaign`: 0 linhas = 404 ou 409) |
| `template-queries.ts` | `listTemplates` (lê os resumos sem payload, filtra por tipo e nome sem acento em memória e só então lê o payload das até 20 linhas da página), `getTemplateDetail`, `listRecentTemplates`, `prepareNoticeStart` (ids novos e quem envia na equipe), `prepareTemplateEditor` (ids gravados) |
| `template-actions.ts` | `"use server"`: `saveTemplate`, `saveTemplateFromNotice`, `renameTemplate`, `duplicateTemplate`, `deleteTemplate`, `loadDesignTemplates`. Nenhuma chama `revalidatePath` (D28) |
| `design-checks.ts` | as conferências de arquivo do design (tiradas de `actions.ts`), com a lista de designs conhecidos e sem apagar; `videoPathInUse` e `mayRemoveRefusedVideo` |
| `team-checks.ts` | quem envia na equipe (`teamMemberIds`, `withSendersOnTeam`, `assertTemplateSenders`) |
| Telas | `src/components/admin/v2/communication/templates/` (lista, filtros, ⋯, diálogos, miniaturas, esqueleto, "Novo aviso"), `template-editor-model.ts`, `template-kind-choice.tsx`, `design-template-editor.tsx`, `popup-free/free-templates-panel.tsx`; rotas em `src/app/admin/(v2)/comunicacao/modelos/` |

Mudaram: `actions.ts` (`withCheckedDesign` com a lista de conhecidos, `fromTemplates`, auditoria `template_used`, `withPopupSettings` por `popupFrequencyToSave`), `schemas.ts` (`fromTemplates`, `withoutInboxPopup` exportado), `flow-schemas.ts` (`addFollowUpTreeIssues` exportado), `popup-media.ts` (`removeRefused`), `popup-free-assets.ts`, `popup-design-actions.ts`, `popup-display-model.ts` (`popupFrequencyToSave`), `audience-model.ts` (`remapNodeRefs`), `media-refs.ts`, `media-cleanup.ts`, `queries.ts` (`loadNoticeFollowUpDrafts`), o editor do aviso, o card Design, o editor Livre, os campos de validade, de janela e da folha das seguintes, o ⋯ dos avisos (`extra`), a lista de avisos (`NewNoticeButton`), o cartão do aluno (`still`, só prévia), a navegação e a busca.

### 4.2 Salvar um modelo (`saveTemplate`), na ordem

1. Com id: lê a linha (404 `missing`), confere a versão (409 `changed`) e o tipo (400 `kindFixed`). Sem id: 200 ou mais = 422 `limit`.
2. Monta o payload (do rascunho ou do design; no Design com id, o modo não muda: 400 `kindFixed`).
3. Quem envia na equipe (principal e seguintes): 400 no campo.
4. Fontes na biblioteca.
5. Arquivos: `checkDesignFiles` com os conhecidos (o design gravado do próprio modelo; o do aviso de origem, não excluído ou excluído há menos de 29 dias; o de cada modelo aplicado). Recalcula URLs e medidas. Nunca apaga.
6. O payload final no schema estrito e no teto (400 com a primeira frase, ou `tooBig`).
7. Grava, com o `design_mode` do payload.
8. Auditoria `communication.template_saved`.

`saveTemplateFromNotice` (⋯): limite, aviso não excluído (404), passo de fluxo (409 `flowStep`), design gravado ilegível (409 `designUnreadable`, D30), rascunho da linha e as seguintes gravadas (`loadNoticeFollowUpDrafts`; árvore só do construtor = `noteBuilderOnly`; objetivo mudado = `noteOtherGoal`) e os passos 3, 4, 6, 7 e 8, sem conferir arquivos (os caminhos vêm da linha gravada). `renameTemplate` nunca mexe no payload. `duplicateTemplate` copia o payload cru relido (partes que não abrem ficam como estão). `deleteTemplate` marca `deleted_at`; nada no Storage. `loadDesignTemplates` devolve os 50 mais recentes do modo, cada um lido parte por parte (o que não abre fica de fora), com as fontes resolvidas. Sem a tabela (migração pendente; a mesma regra estreita de `isMissingTemplatesTable`, na lista ou na contagem), devolve a lista vazia: "Meus modelos" não aparece e o card Design fica como antes; qualquer outro erro dá erro.

### 4.3 Arquivos ao salvar e ao enviar (D16)

- `inspectPopupVideo(db, path, { removeRefused })`: sem a opção (o padrão), o recusado (413/422) **nunca** é apagado; com ela, só quando a função devolve `true`. `createdAt` vem do `info()` do Storage.
- `finishPopupVideoUpload` é o **único** lugar que passa `removeRefused`: `mayRemoveRefusedVideo` = objeto criado há menos de 1 hora **e** nenhum aviso (`popup_design` com o caminho) nem modelo não excluído (`payload.design` com o caminho) o cita. Tabela de modelos ausente = nenhum modelo; outro erro lança (nada é apagado).
- No salvar do aviso, `fromTemplates` (até 20, sem repetidos) lê os modelos não excluídos ou excluídos há menos de 29 dias; os designs deles entram como conhecidos em `withCheckedDesign`. Depois de gravar, `communication.template_used` registra os ids **encontrados** (`{ created, template_ids }`). Fora da janela, o caminho é conferido como novo (sem apagar): arquivo que não existe mais = "Envie o vídeo de novo." no campo.
- Por que protege: o caminho que só o modelo cita nunca é conferido de novo; o caminho novo é conferido e, se falhar, recebe 400 sem ser apagado; o fim do envio só apaga o objeto recém-criado que ninguém cita; o arquivo que ninguém usa sai pela limpeza.

### 4.4 Limpeza (D17)

`templateMediaUse` (`media-refs.ts`) lê o jsonb cru: os campos conhecidos (`content.image`/`audio`, `designSupport.image`, o design, a imagem e o áudio de cada seguinte em qualquer nível) unidos à varredura larga (que tem teto de 5.000 textos); `fontIds` do design. `loadTemplateMediaUse` (`media-cleanup.ts`) lê os modelos não excluídos de 20 em 20 por keyset; só a tabela ausente (`42P01` ou `PGRST205` citando `communication_templates`, `isMissingTemplatesTable`) **na primeira página** devolve `[]` (numa página seguinte, os modelos já lidos seguram arquivos: lança como os outros erros); qualquer outro erro, inclusive coluna que falta, lança e a rodada para sem marcar nem apagar (`docs/22` §4.6). `deletePopupFont` conta os modelos que citam a fonte (409 `fontInTemplates(n)`), com a mesma regra estreita.

### 4.5 O editor lê uma vez só (D28)

`start` e `template` entram só no inicializador do estado: uma página desenhada de novo não muda o rascunho. A exceção é o rebase depois do 409: quando o `updatedAt` que chega é diferente da versão salva que o editor guarda, o rascunho, as seguintes, as chaves e o nome são rebaseados (o que a equipe não mexeu passa a ser o da versão nova). Nenhuma ação de modelo chama `revalidatePath`: a lista atualiza com `router.refresh` numa transição.

### 4.6 Auditoria

| action | entity_type | entity_id | metadata (só ids encontrados, códigos e contagens) |
|---|---|---|---|
| `communication.template_saved` | `communication_template` | modelo | `created`, `kind`, `design_mode`, `origin` (`notice_editor`, `notice_menu`, `design_card`, `free_editor`, `template_editor`), `source_campaign_id`, `source_template_ids`, `with_content`, `with_audience`, `follow_ups` |
| `communication.template_renamed` | idem | modelo | `{}` |
| `communication.template_duplicated` | idem | cópia | `kind`, `source_id` |
| `communication.template_deleted` | idem | modelo | `kind`, `design_mode` |
| `communication.template_used` | `campaign` | aviso | `created`, `template_ids` (nenhum encontrado = sem registro) |

`source_campaign_id` e `source_template_ids` só vêm preenchidos quando o payload tem design (o passo de arquivos só roda com design); no ⋯, `source_campaign_id` é o aviso.

---

## 5. Rotas e ações

| Rota / ação | O que faz |
|---|---|
| `saveTemplate(input)` | cria (sem id) ou atualiza (com id e `expectedUpdatedAt`); `{ designMode, id, kind, name, notes, updatedAt }`; 400 campo/`kindFixed`/`tooBig`/`pickDesign`, 404 `missing`, 409 `changed`, 422 `limit` |
| `saveTemplateFromNotice({ include, name, noticeId })` | sempre cria, da versão gravada; 404 aviso, 409 `flowStep`/`designUnreadable`, 422 `limit` |
| `renameTemplate({ expectedUpdatedAt, id, name })` | 404 `missing`, 409 `changed` |
| `duplicateTemplate({ expectedUpdatedAt?, id })` | " (cópia)", mesmo payload; 404, 409, 422 |
| `deleteTemplate({ expectedUpdatedAt?, id })` | `deleted_at`/`deleted_by`; 404, 409 |
| `loadDesignTemplates({ mode })` | os 50 mais recentes do modo, com as fontes e o total; sem a tabela, a lista vazia |
| `saveNoticeDraft({ …, fromTemplates })` | os arquivos dos modelos contam como conferidos; `template_used` |
| `deletePopupFont({ id })` | 409 `fontInTemplates(n)` quando um modelo não excluído cita a fonte |
| `finishPopupVideoUpload({ path })` | recusado só é apagado se recente e sem uso |

---

## 6. Desempenho

- A lista lê os resumos sem payload (até 500 linhas, em memória) e o payload só das até 20 linhas da página; "Meus modelos" lê no máximo 50 designs (até 32 KB cada) **sob demanda**, quando a lista do modo abre; a limpeza lê 20 por página. O uso real fica em poucos KB por modelo.
- O teto de 768 KB existe para o **pior aviso que o banco aceita** virar modelo: a notificação principal e 20 seguintes, cada uma com um "Para quem" de 16 KB e todos os textos no limite. Medido pelo teste: **621.478 bytes** na estimativa por cima (79 % do teto; abaixo dos 90 % exigidos). O banco confere 1 MB, mais folgado que o app, então nunca recusa o que o app aceitou.
- As miniaturas Livres montam só quando aparecem e nunca baixam vídeo (`still`); o `networkidle` dos testes não fica preso. O aluno não muda: a prop `still` só vale com `preview`, e nenhum módulo de modelo entra no lado do aluno.
- A lista com 20 modelos Livres foi medida no Chromium local (`next start`, 1440 × 1800 px, as 20 miniaturas visíveis, mediana de 5 rodadas), contra 20 Personalizados: as miniaturas Livres ficam prontas em ~880 ms depois de abrir a página (Personalizado: ~450 ms, a diferença é o pedaço do cartão Livre baixado sob demanda), com ~380 ms de script no total (Personalizado: ~250 ms) e ~200 ms a mais de trabalho na tela. O trabalho a mais de desenhar fica abaixo dos 300 ms combinados, então a miniatura de verdade fica; se um dia passar, a saída é uma miniatura estática (barras), como no Personalizado.

---

## 7. Decisões

Origem: **P** = decisão de produto mantida, **P*** = decisão de produto detalhada ou mudada (o motivo está escrito), **E** = decisão de engenharia.

| # | Decisão | Origem | Motivo |
|---|---|---|---|
| D1 | Três tipos: `inbox` (Notificação), `popup` (Pop-up) e `design` (Personalizado ou Livre). O tipo não muda depois de criado; no Design, o modo também não. | P* | Trocar o tipo apagaria metade da configuração; o pop-up não tem quem envia, tempo no sino, enquete nem reações. Para o outro tipo, cria-se outro modelo. |
| D2 | A Interação (reações, pedir resposta, enquete) faz parte do conteúdo e vai com "Levar o conteúdo". Quem envia, ícone, tempo no sino e "Permitir que o aluno exclua do sino" vão sempre. | P* | A Interação fica no card Conteúdo; os outros são o "como" da notificação, e o pedido é o modelo de configuração. |
| D3 | No Pop-up, o design vai sempre (o Padrão = `null`). Com o conteúdo de fora e o design com botão principal ou imagem de mídia, o modelo guarda o apoio: o texto do botão e a imagem do Personalizado. O destino nunca vai. | P* | Sem botão no aviso, a sincronia do design apagaria o botão estilizado; sem a imagem, o Personalizado com mídia ficaria com erro. |
| D4 | O modelo de Design Personalizado leva a imagem do aviso (mídia ou capa do vídeo). Ao aplicar, ela só preenche o aviso sem imagem; a do aviso fica. | E | Sem a imagem, aplicar num aviso sem imagem daria "Envie uma imagem"; trocar a que o aviso tem iria contra reusar o design "com outros vídeos". |
| D5 | "Usar" abre o editor preenchido em `/avisos/novo?modelo=<id>` e não grava nada até salvar, como "Novo aviso" e os modelos de Fluxos. | P* | Modelo pode estar incompleto (o insert falharia), desistir não deixa rascunho vazio, "Novo aviso" vira o mesmo caminho e os arquivos passam pela guarda da D16 no primeiro salvar. |
| D6 | Design no card de um aviso: aplicado no rascunho. Personalizado com toast e Desfazer; Livre com o Livre de antes um passo atrás no editor (sem Livre antes, só o aplicado). Na aba, "Usar" abre um pop-up novo com o design. | P* | O Personalizado não tinha desfazer; o toast com `onUndo` é o padrão do admin; o Livre já desfaz no editor. |
| D7 | Notificações seguintes entram na v1, só na Notificação, com a terceira chave. A árvore fica no formato do cartão; ao usar, todos os ids viram novos e as regras são remapeadas. A árvore só do construtor e o objetivo mudado no construtor ficam fora, com nota. | P* | O formato já existe e é serializável; os ids são chave primária global, por isso trocar é obrigatório. |
| D8 | O modelo pode estar incompleto: textos obrigatórios vazios e as regras de "um precisa do outro" não travam. Formatos, limites, ids, segmento e configuração seguem os schemas do rascunho; as seguintes, o schema estrito. | P* | Ao usar, o editor confere tudo como sempre. |
| D9 | Datas absolutas nunca vão (envio, janela, "até uma data" que vira 90 dias, fim da enquete que vira `null`, "até uma data" das seguintes). Também nunca: situação, aprovação, Mostrar de novo, ids de aviso ou fluxo, números e versão da linha. | P | Pedido do produtor (§2.6). |
| D10 | A chave se chama **Levar o segmento**. | P* | "público" é proibido na tela; o card do editor se chama "Para quem". |
| D11 | "Salvar como modelo" no editor usa o que está na tela, com as mudanças não salvas, e não grava o aviso; no ⋯, a versão gravada. | E | O produtor espera guardar o que vê; salvar o aviso junto mudaria a situação de um agendado. |
| D12 | Tabela nova com exclusão lógica (`deleted_at`). Sem tela de restaurar; a exclusão pede confirmação. | E | Rastro da auditoria e o padrão da Comunicação. |
| D13 | Até 200 modelos na escola (não excluídos); nome de 1 a 80, sem precisar ser único; Duplicar acrescenta " (cópia)". O corte do nome (a cópia e o nome sugerido no diálogo) cabe em 80 unidades do campo (`.length`, como o `maxLength` e o contador) e sempre num caractere inteiro: nunca sobra metade de um emoji. | P* | Duas gravações ao mesmo tempo podem passar de 200 por um; nunca quebra nada. Metade de um emoji o Postgres recusa (o Duplicar falhava); o zod e o `char_length` do banco contam caracteres, nunca mais que `.length`, e aceitam tudo o que cabe no campo. |
| D14 | Teto do payload: 768 KB pela estimativa por cima, conferido no app; o banco confere 1 MB. Acima do teto: 400 `tooBig`. | E | Medido pelo pior aviso que o banco aceita (621.478 bytes, §6). Todo aviso aceito vira modelo, e o check do banco nunca recusa o que o app aceitou. |
| D15 | Versão do payload 1; concorrência otimista por `updated_at` (gatilho com `public.set_updated_at()`), 409 "Este modelo mudou em outra tela…". Versão menor passa pelas funções de atualização; maior ou não inteira não abre. Toda troca de versão traz a função da versão anterior e um teste. | P | Sem isso, um payload v2 deixaria todos os v1 em "Não abre". |
| D16 | Arquivos: o salvar nunca apaga; só o fim do envio apaga o recusado recente que ninguém cita. Contam como conferidos os caminhos da linha gravada, dos modelos de onde o aviso veio, do aviso de onde o modelo veio e dos modelos aplicados (excluídos há menos de 29 dias também). | E | Com modelos, o mesmo vídeo serve a vários avisos; uma conferência que falhasse apagaria o arquivo de todos. 29 dias fica abaixo do prazo da limpeza. |
| D17 | A limpeza lê os modelos pelo jsonb cru; só a tabela ausente vale como "nenhum modelo"; outro erro para a rodada. Excluir o modelo não enfileira nada na hora. | P | Um modelo que deixasse de passar no schema perderia os arquivos; pular uma rodada não custa nada com 30 dias. |
| D18 | Excluir uma fonte citada por modelo não excluído: 409. | E | "Um modelo salvo segura o arquivo dele." |
| D19 | Quem envia fora da equipe vira "a escola" ao usar ou editar, com nota (também nas seguintes). | E | Um 400 no primeiro salvar seria pior; a nota diz quem era e como trocar. |
| D20 | Toda ação e página pede `messaging.write`; o aluno nunca lê a tabela (guarda). | P | RLS ligado e sem política, como as tabelas da Comunicação. |
| D21 | Auditoria `template_saved`, `_renamed`, `_duplicated`, `_deleted` e `_used`; só ids, códigos e contagens, nunca o nome; os ids são só os encontrados no banco. | E | `admin_audit_log` aceita só ids e contagens; o nome é texto digitado. |
| D22 | A aba Modelos é uma aba de verdade, entre Fluxos e Webinários, sem números nem Período. | P* | Uma lista de modelos não tem número de período. |
| D23 | "Novo aviso": sem modelo, o link de sempre; com modelos, o menu. `/avisos/novo` continua sem passo extra. | P* | Um passo extra quebraria as specs que entram direto no editor e acrescentaria um clique a toda criação. |
| D24 | "Meus modelos" carrega sob demanda, até 50 do modo. No Livre, numa terceira aba Modelos (no aviso e no modo modelo de Pop-up; nunca na página do Design). | E | 200 designs de até 32 KB pesariam até 6 MB em toda página do editor; a barra de cima do Livre já está cheia. |
| D25 | Os modelos prontos de Fluxos continuam em "Novo fluxo" e os do card Design como **Modelos prontos**. | P | Não misturar. |
| D26 | Migração `202610250001` nova, numa seção MCP; nenhuma aplicada muda; sem o texto `popup_design`; a coluna é `payload`. | P | A guarda do Livre proíbe o texto. |
| D27 | O "Criar" do Hoje e o "Criar com IA" ficam fora da v1; o Cmd+K ganha "Novo modelo". | E | Não fazem parte do pedido. |
| D28 | O editor lê `start` e `template` uma vez só (montagem); o modo modelo abre com os ids gravados e só o "Usar" troca por novos. Nenhuma ação de modelo chama `revalidatePath`; o 409 rebaseia só quando a versão muda. | E | Numa Server Action, `revalidatePath` redesenha a página atual na mesma resposta; com ids novos a cada leitura, o editor perderia as seguintes. |
| D29 | Modelo com parte que não abriu: o primeiro "Salvar modelo" pede confirmação. Renomear e Duplicar nunca mexem no payload. | E | Um schema estrito por engano num deploy apagaria de vez designs e segmentos salvos nesse meio tempo. |
| D30 | "Salvar como modelo" pelo ⋯ recusa design ilegível (409 `designUnreadable`). | E | O produtor excluiria o pop-up achando que o modelo tem o design e o vídeo. |
| D31 | Editar um modelo respeita as chaves: o modo modelo mostra as chaves do diálogo, cada uma como está no modelo. | P* | Sem isso, mudar só "Quantas vezes" num modelo sem conteúdo gravaria conteúdo vazio e "Todos os alunos". |
| D32 | O Ctrl+Enter (⌘+Enter) do editor do aviso e da página do Design não age com o foco num diálogo, num painel, na lista de uma escolha ou num menu, nem quando outra peça já tratou a tecla (`isEditorSaveShortcut`, `save-shortcut.ts`). Dentro do diálogo, Enter envia o formulário dele. Vale também para a folha da notificação seguinte: o rascunho salva depois de "Concluir". | E | O atalho fica no `window`. Por trás do "Salvar como modelo", ele gravava o que estava na tela (num pop-up no ar ou numa notificação enviada, os alunos viam na hora) e o modelo não era salvo, contra a D11. A lista de uma escolha e o menu abrem num portal próprio, fora do diálogo. |

---

## 8. Riscos e perguntas que ficam

**Riscos (conferidos na entrega):**
1. **O gatilho na migração.** Criado com a função que já existe, dentro de `do $$ if not exists`; a migração foi aplicada duas vezes no banco local (e uma vez numa tabela nova, dentro de uma transação desfeita). Se o MCP da nuvem recusar o bloco `do`, a saída é o app gravar `updated_at = now()` na própria atualização, com a mesma guarda.
2. **Fonte apagada por corrida** entre a leitura e a gravação do modelo: ao usar, "Esta fonte não está mais na biblioteca." no campo. Raro, e a frase diz o que fazer.
3. **Regras que envelhecem**: um segmento do modelo pode citar um aviso, um produto ou uma turma que não existem mais; o editor mostra a regra sem nome, como num rascunho antigo.
4. **Miniaturas Livres na lista**: até 20 por página, montadas só quando aparecem e sem vídeo. Medidas na entrega (§6: ~200 ms a mais de trabalho com 20 Livres visíveis); se passar de 300 ms, trocar por miniatura estática.
5. **Fixtures do ponta a ponta**: `zerarComunicacao` apaga os modelos das contas de teste e `apagarImagensDoLivreSemUso` conta os arquivos dos modelos que sobram; `apagarConta` apaga os modelos da conta antes de apagá-la.
6. **Ordem de deploy**: a migração vai antes do merge na `dev` (§11 passo 1); sem ela, a aba mostra a migração pendente, o card Design segue sem "Meus modelos" e a limpeza segue sem modelos.
7. **Tamanho das leituras**: se a lista ficar lenta por modelos grandes, ler só as partes que a miniatura e o resumo usam (`payload->design`, `payload->settings` e as contagens).

**Perguntas para o produtor** (a v1 segue com a escolha indicada, fácil de trocar):
1. O "Novo aviso" com modelos ficou como **menu no botão**. Está bom assim, ou prefere sempre ver uma tela "Como você quer começar?"?
2. Com "Levar o segmento" desligado, o aviso feito do modelo começa em **"Todos os alunos"**. Prefere que comece sem nada escolhido, obrigando a escolher?
3. Excluir um modelo pede **só confirmação**. Quer também "Desfazer" no toast?

---

## 9. Fica de fora

| Fora desta entrega | Onde está |
|---|---|
| Tela para restaurar um modelo excluído | não planejado (a exclusão pede confirmação; o rastro fica na auditoria) |
| "Criar" do Hoje e "Criar com IA" a partir de um modelo | o "Criar" do Hoje: depois (D27); o "Criar com IA" foi descartado pelo produtor em 28/10/2026 (`docs/27` §10) |
| Modelos de Fluxos na aba Modelos | continuam em "Novo fluxo" (D25) |
| Conferir se as regras de um segmento salvo ainda apontam para algo que existe | não planejado (risco 3) |
| Trocar o tipo ou o modo do design de um modelo | nunca (D1: cria-se outro modelo) |
| Ponta a ponta no WebKit dos três arquivos novos | rodados no Chromium; o WebKit roda no CI |

---

## 10. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/comunicacao-modelos-modelo.test.mjs` (20) | construtores com as chaves ligadas e desligadas, notas de data, pop-up com a frequência canônica, apoio do design, guarda do §2.6, schema afrouxado e estrito, **pior aviso válido abaixo de 90 % do teto** (com o número na mensagem), leitura parte por parte, versões e atualização simulada, ids novos e gravados, aplicar um design, nomes (o corte nunca deixa metade de um emoji e cabe no campo, no zod e no banco), mapa de erros, vocabulário, `templateMediaUse` com seguintes de 2 níveis e mais de 5.000 textos, `?tipo=`, `remapNodeRefs` e o `.max` de `fromTemplates` |
| Unitário | `tests/comunicacao-modelos-acoes.test.mjs` (10) | 403, 400 sem versão, 201º = 422 pelas três criações, `kindFixed` (tipo e modo), auditoria sem o nome e só com ids encontrados, 20 e 21 ids, nenhum `revalidatePath`, `designUnreadable`, `loadDesignTemplates` por modo e até 50 (sem a tabela, na lista ou na contagem, a lista vazia; outro erro dá erro), `mayRemoveRefusedVideo` (2 horas, nulo, citado por aviso, por modelo, sem uso, tabela ausente, outro erro) |
| Guarda | `tests/comunicacao-modelos.guard.test.mjs` (8) | a migração (seção MCP, idempotente, sem `drop`/`delete from`/`create function`/`create policy`/`storage.objects`/`popup_design`, os checks, o gatilho em `if not exists`, RLS, revoke e grant), as migrações antigas byte a byte, `"use server"` e `runAdminAction("messaging.write"` em toda ação, auditoria sem `name`, nenhum `revalidatePath`, `template-model.ts` puro, nada do aluno importando modelos, só `popup-design-actions.ts` passando `removeRefused` |
| Unitário | `tests/comunicacao-modelos-tela.test.mjs` (21) | endereços e filtros, ⋯ com e sem leitura, estados vazios, banner do 409, `NewNoticeButton` (link e menu), `SaveAsTemplateDialog` (chaves, quatro descrições, notas), miniaturas nos dois tamanhos, `MemberPopupCard` com `still` sem `<video>`, vocabulário, `extra` no ⋯ do aviso |
| Unitário | `tests/comunicacao-modelos-editor.test.mjs` (19) | o que some no modo modelo, a chave de recuperação do Livre, os textos com vocabulário, "Modelo salvo.", a nota do colar trocada por `applyCta`, `savedFollowUpsOfDrafts` em 2 níveis, `recentTemplateIds`, o Desfazer do toast que tira o modelo dos aplicados (`undoTemplateUse`), `designTemplatesPickerState`, os campos sem "Até uma data" e sem "Começa"/"Termina"; o título do banner do "Salvar modelo" (nunca "aviso"), o destino do botão escondido e mandado vazio sem o conteúdo, as notas do aviso novo de um modelo até o primeiro salvar, a escolha Computador \| Celular só sem design, os dois contadores do nome iguais e o Ctrl+Enter que nunca age num diálogo, num painel, numa lista ou num menu (D32), com os dois editores usando a mesma regra |
| Unitário | `tests/admin-frames.test.mjs`, `tests/admin-v2-shell.test.mjs`, `tests/admin-search.test.mjs`, `tests/popup-design-editor-modelo.test.mjs`, `tests/popup-media.test.mjs` (8), `tests/comunicacao-limpeza-de-arquivos.test.mjs` (27) e a guarda dela (11) | a aba e as fases, o menu e os títulos, "Novo modelo" só para quem cria avisos, vocabulário do card Design sobre o texto (não sobre os identificadores), `removeRefused`, a leitura dos modelos na limpeza com a tabela ausente (só na primeira página) e os erros que param a rodada, as amostras completas de cada tipo de modelo |
| Integração | `tests/integration/modelos.test.mjs` (18) | permissões, RLS (`42501`), salvar do rascunho, do design e do menu, versão e 409, limite de 200 pelas três criações, check do banco (1,1 MB, sem versão, tipo trocado, notificação com modo; o pior aviso válido passa), leitura parte por parte, usar com arquivos (D16: grava sem conferir com `fromTemplates`, 400 sem ele e o objeto fica, excluído há 10 e há 31 dias, 20 ids com repetidos e um inexistente), arquivos válidos do Livre e de "Meus modelos" num aviso gravado, quem envia fora da equipe, fonte (409), duplicar (também o nome com um emoji na fronteira do corte) e excluir, lista (busca sem acento, filtro, páginas, fontes), preparar o editor e o "Usar"; o modo modelo só com as notas de leitura e de quem envia (a do botão que ganhou texto fica para o "Usar") |
| Integração | `tests/integration/limpeza-de-arquivos.test.mjs` (12), `pop-ups-design-envios.test.mjs` (12), `pop-ups-livre-envios.test.mjs` (8) | o modelo segura os arquivos e o excluído faz o arquivo sair depois de 30 dias simulados; o recusado ao salvar fica no bucket; o fim do envio com um caminho citado por modelo dá 422 e o objeto fica |
| Ponta a ponta | `tests/e2e/produtor-salva-e-usa-modelo.spec.ts` (5) | notificação (título, texto, ícone, 1 dia, regra de produto e uma seguinte) salva como modelo sem gravar o aviso, usada pela aba (nota, campos, regra, seguinte) e gravada com o fluxo em ids novos e `template_used`; pop-up Personalizado com vídeo salvo pelo ⋯ sem conteúdo, excluído, editado no modo modelo (sem envio nem janela, sem a nota do "Usar", o botão principal só com o texto e o destino de volta com "Levar o conteúdo" ligado, o banner de erro "Não foi possível salvar o modelo", só "Quantas vezes"; o conteúdo continua `null`) e usado pelo menu do "Novo aviso" (destino do botão pedido, grava sem conferir o vídeo); duas abas no mesmo modelo: 409, Recarregar com rebase e o salvar seguinte; parte que não abriu (D29): a pergunta no primeiro "Salvar modelo", Cancelar sem gravar, o Padrão gravado e o salvar seguinte sem pergunta; num pop-up no ar com uma mudança sem salvar, Ctrl+Enter e ⌘+Enter no nome do "Salvar como modelo" e do "Salvar design como modelo" não mudam o `updated_at` do pop-up, Enter salva o modelo com o que está na tela (D11 e D32) e, fora dos diálogos, Ctrl+Enter salva o pop-up |
| Ponta a ponta | `tests/e2e/produtor-meus-modelos-de-design.spec.ts` (4) | Personalizado salvo no card e usado em "Meus modelos" antes dos "Modelos prontos", com o botão "Saiba mais" sem destino e Desfazer (o salvar depois do Desfazer não grava `template_used`; usar de novo e salvar grava, `created: false`); Livre salvo pela aba Modelos do editor (foco de volta ao botão), aplicado noutro pop-up com "Trocar de modelo?" e Ctrl + Z / Ctrl + Shift + Z, e num pop-up novo, gravado com os caminhos dos arquivos do modelo e `template_used`; a página do modelo de Design (Salvar modelo, "Modelo: {nome}", sem a aba Modelos, o botão principal só com o texto, "Modelo salvo.", a prévia com o celular e o computador juntos); o modelo novo de Design com a escolha Computador \| Celular antes do design |
| Ponta a ponta | `tests/e2e/produtor-organiza-modelos.spec.ts` (5) | lista vazia e a escolha do tipo com quatro cartões; busca sem acento, filtro "Design Livre" e "Limpar filtros"; só pelo teclado: Renomear (nome selecionado, Enter, foco no ⋯), Duplicar e Excluir (foco na linha seguinte); 375 px em celular de toque (sem rolagem lateral, ⋯ de 44 px, "Atualizado" no cartão, nada abaixo de 12 px); analista sem a Comunicação e levada para fora |

Cuidados do WebKit nos ponta a ponta: nenhum usa a área de transferência nem arrasta; depois de fechar diálogo ou menu, o foco volta antes de teclar; o clique logo depois de abrir a página repete até abrir (o padrão `toPass`).

---

## 11. Roteiro de conferência no ambiente de teste

1. **Antes do merge**, aplicar a `202610250001` no Supabase da nuvem (`docs/21` §9.4): a seção única pelo MCP, numa chamada (`execute_sql` com `set lock_timeout = '5s';` antes do texto do arquivo, ou `apply_migration` com o arquivo inteiro, nome `communication_templates`), e conferir com as consultas do cabeçalho: RLS ligado, 0 políticas, `anon` e `authenticated` sem `select`, 9 constraints, o gatilho `set_communication_templates_updated_at` e 0 linhas. Se foi por `execute_sql`, gravar o histórico em `supabase_migrations.schema_migrations` (o `insert` está no relatório da PR).
2. Comunicação › **Modelos**: "Nenhum modelo ainda", com **Novo modelo** (a escolha dos quatro tipos) e **Ver avisos**. O **Novo aviso** da lista de avisos continua um link.
3. Num aviso novo de notificação, preencher título, texto, ícone, "Fica no sino por 1 dia", uma regra em "Para quem" e uma notificação seguinte; **Salvar como modelo** (o nome é o título, as três chaves ligadas): "Modelo salvo em Comunicação › Modelos." O aviso continua sem salvar.
4. Em Modelos, a linha com o nome, "Notificação" e "Leva conteúdo, segmento e 1 notificação seguinte". ⋯ › **Usar**: o editor abre preenchido com "Você começou do modelo…". **Salvar rascunho** grava o aviso, com a seguinte.
5. O **Novo aviso** virou menu: "Começar em branco", o modelo e "Ver todos os modelos (1)".
6. Num pop-up Personalizado com vídeo, ⋯ › **Salvar como modelo** com "Levar o conteúdo" desligado; excluir o pop-up; em Modelos › **Editar**: título "Modelo: …", sem envio, sem "Começa"/"Termina", a chave do conteúdo desligada; mudar "Quantas vezes" e **Salvar modelo**: "Modelo salvo.".
7. **Usar** o modelo do pop-up: o editor abre com o design e o vídeo; o salvar pede "Escolha para onde o botão leva."; escolher, dar o nome e salvar: grava (o vídeo do modelo não é conferido de novo).
8. No card Design de um pop-up Personalizado, **Salvar design como modelo**; num pop-up novo › Personalizado, "Meus modelos" mostra o modelo antes dos "Modelos prontos"; **Usar este modelo**: "Design aplicado." com **Desfazer**.
9. No editor Livre de um pop-up, aba **Modelos** › **Salvar este design como modelo**; noutro pop-up com Livre, **Trocar de modelo** › o modelo › "Trocar de modelo?": o editor abre com o modelo e Ctrl + Z volta ao Livre de antes.
10. Em Modelos › ⋯ do design Livre › **Editar**: a página do Design, sem a escolha do modo; no editor Livre, "Salvar modelo", "Modelo: {nome}", sem a aba Modelos, e o Botão principal com "O destino do botão é escolhido em cada aviso.".
11. Abrir o mesmo modelo em duas abas, mudar o nome numa e salvar; na outra, mudar "Quantas vezes" e salvar: "Este modelo mudou em outra tela" com **Recarregar**, que traz o nome novo e mantém a mudança; salvar de novo grava.
12. Renomear, Duplicar ("(cópia)") e Excluir pelo ⋯; buscar "lanc" acha "Lançamento"; as pílulas filtram por tipo. No celular (375 px), cartões sem rolagem lateral.
13. Excluir uma fonte usada só por um modelo: recusado com "Esta fonte está em 1 modelo…"; excluir o modelo e depois a fonte: sai da biblioteca.
14. Com a conta da analista, a Comunicação não aparece no menu e o endereço da aba leva para fora dela.
