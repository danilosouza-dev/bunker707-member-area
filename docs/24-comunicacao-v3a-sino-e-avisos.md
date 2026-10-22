# 24. Comunicação v3a: sino e avisos (excluir e editar, lixeira, cartão clicável, reações, enquete e velocidade)

Data: 22/10/2026. Pedido do produtor (21/10/2026), depois de testar a v2 na `dev`: o menu ⋯ dos avisos não tem o CRUD das notificações; o aluno precisa poder tirar uma notificação do próprio sino (um ícone de lixeira); a notificação inteira pode ser clicável, com ou sem botão, desde que o aluno perceba que é clicável; depois de Aceitar ou Recusar, poder voltar atrás; título mais destacado que o texto; reações como no WhatsApp; enquete direto nas mensagens; o sino demora um pouco para abrir a lista ("é normal?"); e, duas vezes, a pergunta sobre o pop-up "Uma vez" que o aluno fechou e que depois vira "Até o aluno clicar".

Este documento registra o que foi construído sobre a v1 (`docs/22`) e a v2 (`docs/23`), as regras fixas, as decisões (T1 a T23) e o que fica de fora. Vale para qualquer trabalho em Comunicação, sino, avisos, reações ou enquetes. A entrega se divide em duas: a **v3a** (este documento) e a **v3b "Pop-ups sob medida"** (páginas e gatilhos do pop-up, frequência, limites globais editáveis, o construtor por blocos, enquete no pop-up e "Como fechar"), que terá documento próprio. Migração `202610220001_communication_v3a.sql` (as `202610200001`, `202610200002` e `202610210001`, já aplicadas na nuvem de teste, não mudam); os ajustes depois do primeiro teste do produtor (lixeira opcional, minutos no tempo do sino, o cartão novo e as correções da revisão) estão na seção 10, com a `202610220002_communication_v3a_ajustes.sql`. Tabelas em `docs/05` (seção Comunicação v3a), segurança em `docs/06` (seção Comunicação v3a), desenho em `docs/12`, decisões em `docs/09` e admin em `docs/17` §1.8. Muda uma regra da v1: **notificação enviada agora muda e pode ser excluída** (`docs/22` §2.2).

> **Atualização (22/10/2026): Comunicação v3b-1** (`docs/25`, migração `202610220003`). A primeira parte da v3b chegou: onde, quando e quantas vezes cada pop-up aparece, o **Volta em** do Lembrar depois e **Como fechar**, sem limite fixo entre pop-ups. Muda o que está aqui: **Mostrar de novo para quem já viu** vale em **qualquer "Quantas vezes"** (seção 2.4 e T6); "Até o aluno clicar" virou **Mais de uma vez** com 1 dia entre uma vez e outra, até clicar (editável); a resposta ao produtor da seção 2.4 foi substituída pela do `docs/25` §1.9; os itens de pop-up da seção 9 foram entregues ou têm lugar marcado no `docs/25` §8.

---

## Resumo em uma página

| Peça | O que faz | Onde |
|---|---|---|
| **Menu ⋯ completo** | Ver relatório, Editar, Duplicar, Excluir e as ações de estado em toda situação em que fazem sentido; **Mostrar de novo para quem já viu** no pop-up "Uma vez" | lista, editor e relatório de `/admin/comunicacao/avisos` |
| **Editar notificação enviada** | título, texto, imagem, ícone, Quem envia, destino e como o aluno chega lá, textos de Aceitar/Recusar e reações; chega a todos os sinos na hora, sem "editada" e sem marcar como nova | `/avisos/[id]?editar=1` |
| **Excluir** | em qualquer situação menos "Enviando"; a enviada sai de todos os sinos e da lista | menu ⋯ |
| **Lixeira do aluno** | **Excluir notificação** no botão do canto do cartão (seção 10.3), com **Desfazer** até o painel fechar; some da lista, do número e das marcações só para ele; a equipe escolhe por notificação se o aluno pode excluir (seção 10.1) | sino; editor, card "Interação" |
| **Cartão clicável** | **Como o aluno chega lá**: Pelo botão · Pelo botão ou tocando na notificação · Só tocando na notificação (sem botão, com o texto ao lado da seta) | sino; editor, card "Para onde leva" |
| **Mudar resposta** | depois de Aceitar/Recusar, `Você aceitou` + **Mudar resposta** | sino |
| **Título** | 15 px em negrito (o texto continua 14 px regular) | sino e prévia |
| **Reações** | 👍 ❤️ 🔥 👏 😂 😮, uma por aluno, trocar ou tirar; o aluno vê só a própria; os números ficam no relatório | sino; editor, card "Interação" |
| **Enquete** | pergunta, 2 a 6 opções, uma ou várias respostas, resultado para quem votar, fim numa data ou quando sai do sino, **Encerrar enquete** | sino; editor, card "Interação"; relatório |
| **Regras** | `reagiu` (qualquer ou um emoji), `votou na enquete` (qualquer ou uma opção), `excluiu do sino`; escolhas rápidas `não votou na enquete` e `não reagiu` | segmentos, notificações seguintes e fluxos |
| **Sino rápido** | a lista numa consulta só, a sessão pelas claims do JWT, a primeira página buscada na intenção e guardada no navegador | `GET /api/notifications`, `notifications-client.ts` |

Vocabulário na tela (T21): **Excluir**, **Ver relatório**, **Mostrar de novo**, **Reações**, **Reagir**, **Enquete**, **Votar**, **Encerrar enquete**, **Mudar resposta**, **Manter resposta**, **Desfazer**, **Para onde leva**, **Como o aluno chega lá**, **Texto ao lado da seta**, **Interação**, **foi para o destino**. Como na v1 e na v2, nunca "campanha", "público", "audiência", "evento", "oferta", "automação", "gatilho" ou "lembrete" (testes de vocabulário em `comunicacao-avisos-crud-tela`, `comunicacao-conteudo-v3` e `comunicacao-segmentos`).

---

## 1. O que o aluno vê

Tudo em `src/components/member/notifications/*`, só com as peças da área do aluno (`MemberAvatar`, `memberButtonClassName`, `MemberChip`, `MemberEmptyState`, `MemberFilterPills`, `MemberSkeletonBlock`). A 375 px o painel tem 351 px e a coluna de texto do cartão cerca de 267 px: tudo abaixo cabe nela.

### 1.1 O cartão, de cima para baixo

| Parte | v3a |
|---|---|
| Círculo (Quem envia) | igual à v2 |
| **Título** | 15 px, negrito, `leading-5`, branco, com o ícone antes (16 px). No "Só tocando na notificação" o título é o link do cartão |
| Texto, linha de baixo, imagem, áudio | iguais (sem "editada": T2) |
| **Enquete** | depois do áudio (seção 1.6) |
| Botão ou o texto ao lado da seta | pelo modo (seção 1.2) |
| Aceitar / Recusar | com **Mudar resposta** (seção 1.5) |
| ~~Linha de ações~~ | saiu nos ajustes (seção 10.3): o **Reagir** fica no fim da linha do botão, da resposta ou de quem envia, e **Excluir notificação** num botão pequeno no canto de cima |
| Bolinha de não lida | igual (nos ajustes, foi para a margem da esquerda: seção 10.3) |

A ordem dos filhos é a ordem de leitura e de Tab: título (link no "Só tocando"), Ver mais, imagem, áudio, opções da enquete, botão, resposta, Reagir, Excluir (nos ajustes, o Reagir vai junto da linha em que fica e o excluir é o último: seção 10.3). As notificações de comentário continuam com a frase (`Ana Souza respondeu seu comentário`), mas deixam de ser um `<a>` grande: o link acessível é a frase e o excluir fica no canto de cima.

### 1.2 Cartão clicável ("Como o aluno chega lá")

| Modo | O aluno vê | Link acessível | Toque no texto, na imagem ou no espaço vazio |
|---|---|---|---|
| **Pelo botão** (padrão, o de antes) | o botão secundário | o botão | abre o cartão (marca aberta, como antes) |
| **Pelo botão ou tocando na notificação** | o botão; o cartão clareia no hover e no toque | o botão | vai para o destino |
| **Só tocando na notificação (sem botão)** | sem botão; no pé, o texto da equipe com a seta (`Ver a aula nova ›`; `ExternalLink` para nova aba) | o título, descrito pelo texto ao lado da seta (`Aula nova, link, Ver a aula nova`) | vai para o destino |

- Um link de verdade por cartão e nada interativo dentro de um link: um link decorativo cobre o cartão por baixo do conteúdo (`aria-hidden`, `tabIndex={-1}`, fora do leitor de tela e do Tab); os dois filhos da grade deixam o toque passar e cada controle dentro (Ver mais, áudio, enquete, reações, resposta, lixeira) volta a receber o toque.
- Sinal de clicável: fundo no hover (`white/[0.06]`) e no toque (`white/[0.08]`), cursor de link, anel de foco no cartão inteiro quando o link tem foco pelo teclado e, no "Só tocando", a linha com a seta.
- Selecionar texto num cartão clicável não funciona (o toque passa para o link). Aceito: o destino é o motivo do cartão.
- Tocar no cartão vale como clicar no botão: marca clicada, aberta e lida, fecha o painel e navega (pelo AppShell nos links internos). As regras dizem **foi para o destino** nos três modos (seção 6).
- A prévia do editor desenha a linha da seta e o hover, nunca um link.

### 1.3 Excluir notificação e Desfazer

- Nos ajustes (seção 10.3) a lixeira foi para o canto de cima do cartão (`Trash2` 16 px num círculo de 32 px, nome `Excluir notificação “{título}”`, exclui na hora) e só aparece quando a equipe deixou o aluno excluir (seção 10.1). Antes ficava na linha de baixo.
- Excluir troca o cartão, no lugar, pela linha `Notificação excluída.` com **Desfazer**; o foco vai para **Desfazer** e o leitor ouve `Notificação excluída.`. A linha fica até o painel fechar, sem prazo (WCAG 2.2.1). A bolinha de não lida que o cartão tinha sai do número na hora.
- **Desfazer** espera o servidor (`Desfazendo...`) e põe o cartão de volta no mesmo lugar, com o foco no excluir dele (`A notificação voltou para o sino.`).
- Erros: `Não foi possível excluir. Tente de novo.` (o cartão volta, com a frase embaixo) e `Não foi possível desfazer. Tente de novo.` (a linha fica).
- Excluída: fora da lista, do número do sino, das não lidas, do "Marcar todas" e do "abriu o sino", também da memória do navegador e depois de recarregar. Continua contando como recebida (relatório e regras). **Enviar teste para mim** traz de volta um teste excluído.

### 1.4 Reações

Só nas notificações em que a equipe deixou **Permitir reações** ligado.

- Sem reação: botão redondo de 32 px com `SmilePlus`, nome `Reagir à notificação “{título}”`. Com reação: pílula com o emoji, nome `Sua reação a “{título}”: Amei. Mudar reação`.
- O botão e a pílula ficam no fim da linha do botão, da resposta ou de quem envia; a pílula tem 28 px (seção 10.3). Tocar abre o seletor **na linha logo abaixo** (o Reagir continua na tela, com `aria-expanded`): `Escolha uma reação`, seis botões de 40 px (`Gostei`, `Amei`, `Incrível`, `Aplausos`, `Haha`, `Uau`, com `aria-pressed`), 260 px nos 267 px da coluna a 375 px. O foco vai para a reação atual (ou Gostei).
- Escolher põe ou troca; escolher a que já está tira. O seletor fecha e o foco volta para o botão ou a pílula (`Você reagiu com Amei.` / `Reação retirada.`). `Esc` fecha só o seletor (o painel continua aberto); tocar fora também fecha; Tab não fecha.
- Otimista: a pílula muda na hora; com erro volta e aparece `Não foi possível reagir. Tente de novo.`. Reagir conta como abrir (a bolinha some, T15). O aluno nunca vê números (T12).

### 1.5 Aceitar / Recusar e Mudar resposta

- Respondido: `Você aceitou` (chip verde) ou `Você recusou` (neutro) e o botão de texto **Mudar resposta**.
- **Mudar resposta** mostra os dois botões de novo, a resposta atual marcada (`aria-pressed`, `Check`) e **Manter resposta**; o foco vai para o primeiro. Tocar na outra envia (`Enviando...`) e o foco vai para a frase nova; tocar na atual ou em **Manter resposta** fecha sem pedido, com o foco em **Mudar resposta**.
- Vale enquanto a notificação está no sino. O relatório conta a resposta atual e quantos mudaram; `responded_at` continua sendo a primeira (T10). A v1 respondia `Você já respondeu.` (409) na segunda: isso saiu.

### 1.6 Enquete

`fieldset` com a pergunta como legenda, depois do áudio e antes do botão.

- Opções em botões de largura toda, com pelo menos 44 px de altura (`Circle`/`CircleCheck` numa resposta, `Square`/`SquareCheck` em várias). Botões, não radios: um grupo de radios que grava a cada seta votaria enquanto o aluno navega.
- Uma resposta: tocar vota, outra troca, a escolhida tira o voto. Várias: cada toque marca ou desmarca e vai o conjunto inteiro (vazio tira o voto). Otimista, no máximo um envio por cartão (o último estado vai quando o anterior volta).
- Resultado (quando a equipe deixou e o aluno votou, ou quando encerrou): barra atrás de cada opção e a porcentagem; o nome acessível vira `Sim, 42%, 54 votos` (`1 voto`). Porcentagem = `round(votos × 100 ÷ quem votou)`; com várias respostas a soma passa de 100 % e o rodapé diz `Cada pessoa pode marcar mais de uma`. Nunca nomes.
- Rodapé (12 px): `Escolha uma opção.` / `Escolha uma ou mais opções.`; depois de votar `Seu voto foi registrado. Toque em outra opção para mudar, ou na sua para tirar o voto.` (várias: `… Toque para marcar ou desmarcar.`), seguido de `128 votos` e `Encerra em 25/10 às 18:00` quando há; encerrada, `Enquete encerrada · 128 votos` (ou `Enquete encerrada.`), opções `aria-disabled`.
- Erros: `Não foi possível registrar seu voto. Tente de novo.`; 409 `A enquete foi encerrada.` (redesenha encerrada); 404 `Esta notificação não está mais disponível.`. Votar conta como abrir.

### 1.7 Carregando, memória e erros

Os estados da v1 continuam (esqueleto, vazio, em dia, erro com **Tentar de novo**, sessão encerrada, código do painel que não baixou). Novos:

- **Página guardada** (seção 4.4): reabrir o sino mostra a lista na hora, da memória do navegador; com mais de 5 s ela é atualizada por trás (lista com `aria-busy`, nada muda até a nova chegar; o que chegou entra no topo).
- A atualização falhou: `Não foi possível atualizar. Estas são as notificações de antes.` com **Tentar de novo** (caixa vermelha compacta, `role="alert"`). 401 na atualização: a página guardada é esquecida e aparece a sessão encerrada.
- Muitas escritas seguidas (seção 4.3): o controle volta ao estado anterior com `Muitas tentativas. Espere um pouco.`.

### 1.8 O que é registrado (invisível para o aluno)

Na própria linha do sino do aluno: excluída (`hidden_at`), reação (`reaction`, `reacted_at`), mudanças de resposta (`response_changes`, `response_changed_at`), voto (`poll_choice`, `poll_voted_at`, `poll_changes`) e o contador de escritas (`interaction_writes`). Eventos em `student_events`, só ids (seção 5.3). Mesma retenção da linha (24 meses); conta excluída leva tudo.

---

## 2. O que a equipe faz (`/admin/comunicacao/avisos`)

### 2.1 O menu ⋯ (lista, editor e relatório)

`availableNoticeActions(timing, now, permissions, { popupRepeat, recipients })` (pura, `campaign-model.ts`; o servidor confere de novo), na ordem do menu:

| Situação | Ações (permissão quando é mais que `messaging.write`) |
|---|---|
| Rascunho | Editar · Enviar teste para mim (notificação) · Duplicar · Excluir |
| Aguardando aprovação | Editar · Aprovar e publicar (`publish_large`) · Recusar pedido (`publish_large`) · Enviar teste para mim · Duplicar · Excluir |
| Agendado (notificação) | Editar · Enviar teste para mim · Duplicar · Cancelar agendamento (`publish`) · Excluir (`publish`) |
| Enviando | Ver relatório · Duplicar |
| Enviado | Ver relatório · Editar (`publish`; acima de 500 que receberam, `publish_large`, senão não aparece) · Duplicar · Retirar do sino (`publish`) · Excluir (`publish`) |
| Cancelado | Ver relatório · Duplicar · Excluir |
| Ativo (pop-up no ar) | Ver relatório · Editar (`publish`) · Pausar (`publish`) · Mostrar de novo para quem já viu (`publish`, só em "Uma vez") · Duplicar · Encerrar (`publish`) · Excluir (`publish`) |
| Agendado (pop-up publicado, janela por começar) | Ver relatório · Editar · Pausar · Duplicar · Encerrar · Excluir (todas `publish`) |
| Pausado | Ver relatório · Editar · Retomar · Mostrar de novo para quem já viu (só "Uma vez") · Duplicar · Encerrar · Excluir (todas `publish`) |
| Encerrado | Ver relatório · Duplicar · Excluir |

- Ícones: `Ver relatório` (`ChartColumn`), `Mostrar de novo para quem já viu` (`RotateCcw`); separador antes do primeiro de Encerrar, Retirar e Excluir. O relatório tira do menu o que mostra como botão (Editar, Pausar, Retomar) e o próprio Ver relatório; o editor tira Editar e Ver relatório (na enviada, Ver relatório vira link no topo).
- Confirmações (`ConfirmDialog`, nunca `window.confirm`), pela situação:

| Ação · situação | Descrição | Confirmar |
|---|---|---|
| Excluir · rascunho, aguardando, cancelado, encerrado | `O aviso sai desta lista. Não dá para desfazer.` | `Excluir aviso` |
| Excluir · agendado | `O envio agendado é cancelado e o aviso sai desta lista. Não dá para desfazer.` | `Excluir aviso` |
| Excluir · enviado | `A notificação some do sino dos 318 alunos que receberam e o aviso sai desta lista, com o relatório. Não dá para desfazer. Para tirar do sino e manter o relatório, use Retirar do sino.` (com 1: `do 1 aluno que recebeu`) + `As notificações seguintes deixam de sair.` + a frase das regras que citam | `Excluir notificação` |
| Excluir · pop-up no ar agora | `O pop-up sai da home de todos os alunos agora e o aviso sai desta lista, com o relatório. Não dá para desfazer.` | `Excluir pop-up` |
| Excluir · pop-up pausado ou por começar | `O pop-up não volta para a home e o aviso sai desta lista, com o relatório. Não dá para desfazer.` | `Excluir pop-up` |
| Mostrar de novo | `O pop-up volta a aparecer para quem já viu e não clicou. Quem escolheu “Não mostrar de novo” ou clicou no botão continua sem ver.` | `Mostrar de novo` |

- Na enviada com seguintes que já saíram, a caixa `Excluir também as notificações seguintes que já saíram (n)` vem marcada toda vez.
- **Regras que citam a notificação** (T23): Excluir e Retirar do sino de uma notificação enviada que outros avisos ou fluxos usam nas regras avisam `Atenção: 2 avisos e 1 fluxo usam esta notificação nas regras. Depois de excluir, para eles ninguém recebeu esta notificação.` (`1 aviso usa …, para ele …`; `Depois de retirar` no Retirar). Não impede.
- Toasts: `Aviso excluído.`; `Notificação excluída do sino de 318 alunos.` (0: `Notificação excluída.`); `Pop-up excluído. Ele saiu da home.`; `Pop-up excluído.`; `O pop-up volta a aparecer para 120 alunos.` (0: `Ninguém precisava ver de novo: quem viu já clicou, escolheu “Não mostrar de novo” ou ainda vai ver.`).

### 2.2 Editar uma notificação enviada

Pelo ⋯ **Editar** ou pelo botão **Editar** do relatório: `/avisos/[id]?editar=1` (sem `Editar` nas ações, o endereço abre o relatório). Salvou: volta ao relatório com `Notificação atualizada no sino de 318 alunos.`.

| Campo | Depois do envio | Motivo embaixo do campo |
|---|---|---|
| Título, texto, imagem, ícone e cor | muda | — |
| Quem envia | muda (a pessoa nova recebe o e-mail `sent_as` uma vez) | — |
| Para onde leva: destino, texto, aba, como o aluno chega lá; tirar o destino | muda, a não ser que uma seguinte precise do destino | — |
| Textos de Aceitar e Recusar | muda | — |
| Permitir reações | muda (desligar esconde o Reagir; as reações dadas ficam no relatório) | — |
| Permitir que o aluno exclua do sino (seção 10.1) | muda (desligar tira o excluir do cartão; quem já excluiu continua sem ela) | — |
| Pedir uma resposta (ligar/desligar) | não | `Pedir uma resposta não muda depois do envio. Os textos dos botões podem mudar.` |
| Enquete | não; **Encerrar enquete** no relatório | `A enquete não muda depois do envio. Para parar a votação, use Encerrar enquete no relatório.` |
| Áudio | não | `O áudio não muda depois do envio: quem já ouviu ficaria marcado como tendo ouvido o novo. Para trocar, duplique a notificação.` |
| Tipo | não | `O tipo não muda depois de publicado. Para trocar, duplique o aviso.` |
| Para quem | não (só leitura) | `Já enviada para 318 alunos. O segmento não muda depois do envio.` |
| Quando e Fica no sino por | não (só leitura) | `Enviada em 21/10/2026 às 14:30 · fica 3 dias no sino. Não muda depois do envio.` |
| Depois desta notificação | no relatório | `As notificações seguintes mudam no relatório.` com `Ir para o relatório` |

- Topo `Editar notificação enviada`, chip `Enviado`, link **Ver relatório**; banner `Esta notificação já está no sino de 318 alunos. O que você salvar aparece para todos na hora, sem avisar de novo e sem marcar como nova. Para avisar de novo, envie uma notificação nova.`; revisão `Notificação enviada para 318 alunos em 21/10/2026 às 14:30. Salvar muda o que eles veem agora.` com **Salvar alterações** e **Descartar mudanças**; Ctrl+Enter (⌘+Enter) salva. Prévia: `Mudanças não salvas: os alunos ainda veem a versão anterior.` / `Assim os alunos veem agora.`.
- Destino trocado com seguintes que olham "a página para onde a notificação leva": `As notificações seguintes que usam “visitou a página para onde a notificação leva” passam a olhar a página nova, contando a partir de agora.`
- Conta como publicar (T4): sem `messaging.publish`, 403 `Só quem pode publicar muda uma notificação enviada. Duplique para criar outra.`; acima de 500 que receberam sem `publish_large`, 403 `Para mudar uma notificação que já chegou a mais de 500 alunos, peça a um dono ou administrador.`. Quem levaria o 403 nem vê **Editar**; a última linha do relatório explica (`Só quem pode publicar muda uma notificação enviada. Para mandar de novo, use Duplicar no menu.` ou `Esta notificação chegou a mais de 500 alunos: só um dono ou administrador muda depois do envio. …`). Nunca vira pedido de aprovação.
- O relatório ganha `Editado · Ana Souza · 21/10/2026 às 14:30` (última edição depois do envio ou de um pop-up no ar). Auditoria `communication.edited_after_send` com os nomes dos campos (nunca o texto).

### 2.3 Excluir

| Situação | Quem | O que acontece |
|---|---|---|
| Rascunho, aguardando aprovação, cancelado, encerrado | `messaging.write` | como antes: exclusão lógica; o fluxo das seguintes sai junto (`source_deleted`) |
| Agendado (notificação) | `messaging.publish` | exclusão lógica (o tick só pega o que não foi excluído); o fluxo sai |
| Enviando | — | 409 `A notificação ainda está sendo enviada. Espere terminar para excluir.` (o menu nem oferece) |
| Enviado | `messaging.publish` | os passos do Retirar do sino (situação Cancelado, fluxo encerrado, com a caixa as seguintes saem, as linhas dos alunos saem), depois a exclusão lógica do aviso e do fluxo |
| Pop-up no ar, agendado pela janela ou pausado | `messaging.publish` | encerra (como Encerrar, cache dos pop-ups renovado) e exclui |

Sem a permissão: 403 `Só quem pode publicar exclui um aviso que os alunos veem ou que está agendado.`. A regra dos 500 não vale (tirar nunca alcança mais alunos). Auditoria `communication.deleted` com `{ kind, status, removed, follow_ups_removed, cited_by_notices, cited_by_flows }`.

### 2.4 Pop-up: "Mostrar de novo para quem já viu"

> **Desde a v3b-1** (`docs/25`): o **Mostrar de novo para quem já viu** vale em **qualquer "Quantas vezes"** (no editor do pop-up no ar ou pausado e no menu ⋯), e nos pop-ups que só param quando terminam zera também quem clicou. A resposta ao produtor abaixo vale para a v3a; a atual, para colar, está no `docs/25` §1.9. O texto desta seção fica como registro do que a v3a entregou.

Resposta ao produtor da v3a (T7, substituída pelo `docs/25` §1.9):

> Hoje funciona assim: se o pop-up estava em **Uma vez** e você muda para **Até o aluno clicar**, quem só fechou (no X, no Esc ou clicando fora) **volta a ver**, 24 horas depois de ter visto este pop-up (até os ajustes da seção 10.8 contava também outro pop-up, pelo limite de 1 por sessão e 1 a cada 24 horas, que saiu). Quem clicou no botão ou escolheu **Não mostrar de novo** nunca mais vê esse pop-up, mesmo editado. E se você mantém **Uma vez**, quem já viu não vê de novo.
>
> Com a v3a, um pop-up em **Uma vez** ganha a opção **Mostrar de novo para quem já viu** (ao editar e no menu ⋯): ele volta a contar como novo para quem viu e não clicou. Assim você mantém **Uma vez** e mesmo assim mostra a versão nova para quem já tinha visto. Se você mudar para **Até o aluno clicar**, não precisa dessa opção: quem só fechou já volta a ver 24 horas depois de ter visto este pop-up, até clicar. Nos dois casos, quem escolheu **Não mostrar de novo** continua sem ver (foi um pedido do aluno), e quem clicou também, porque já fez o que o pop-up pedia. Para mostrar a todo mundo, use **Duplicar** e publique o novo.

- Por que só em **Uma vez**: o limite global de 24 h conta a última vez que o aluno viu qualquer pop-up, este incluído, então em **Até o aluno clicar** o próprio limite já decide quando quem fechou volta; um "mostrar de novo" não mudaria nem quem vê nem quando. Em **Uma vez** a regra é "impressões > Lembrar depois", e é isso que o reinício muda.
- O reinício vale para quem **ainda está no segmento**, viu, não voltaria a ver em **Uma vez** e não clicou nem escolheu **Não mostrar de novo**; o "Lembrar depois" volta a contar do zero (os números do relatório não mudam). Sem limite entre pop-ups desde os ajustes (seção 10.8).
- No editor do pop-up no ar ou pausado, card "Quando", depois de "Quantas vezes", **só enquanto aparece Uma vez**: a chave **Mostrar de novo para quem já viu**, desligada ao abrir, depois de salvar e a cada troca de "Quantas vezes", com `Para os 120 alunos que já viram e não clicaram. Quem clicou no botão ou escolheu “Não mostrar de novo” continua sem ver.` (com 0, desligada e `Ninguém precisa ver de novo agora: …`). Dicas quando a escolha muda do salvo: para Até o aluno clicar, `Quem só fechou volta a ver 24 horas depois de ter visto este pop-up, até clicar. Quem clicou ou escolheu “Não mostrar de novo” não vê mais.`; para Uma vez, `Quem já viu não vê de novo, a não ser que você ligue “Mostrar de novo para quem já viu”.`
- Toasts ao salvar o pop-up no ar (trocam o antigo `Pop-up atualizado. Quem já fechou não vê de novo.`, que estava errado para Até o aluno clicar): `Pop-up atualizado. Ele volta a aparecer para 120 alunos que já tinham visto.`; `Pop-up atualizado. Quem já viu não vê de novo.`; `Pop-up atualizado. Quem fechou sem clicar volta a ver 24 horas depois de ter visto este pop-up.`; pausado, `Pop-up salvo. Ele continua pausado.` (+ ` Ao retomar, volta a aparecer para quem já tinha visto.`). Banner do pop-up no ar: `Este pop-up está no ar. As mudanças valem assim que você salvar.`
- `messaging.publish`; acima de 500 reiniciados, `publish_large` (403 `Para mostrar de novo a mais de 500 alunos, peça a um dono ou administrador.`); "Quantas vezes" mudou em outra tela, 409 `Mostrar de novo vale para pop-ups em “Uma vez”. Em “Até o aluno clicar”, quem fechou já volta a ver 24 horas depois.`. Auditoria `communication.popup_reshown` `{ count, via }`.

### 2.5 Editor: Para onde leva, Interação e enquete

O conteúdo continua num componente só (`NoticeContentFields`): editor de avisos, folha da notificação seguinte e painel do construtor de fluxos.

- **"Botão" vira "Para onde leva"** (`opcional`, `Um produto, uma página da área ou um site.`): chave `Levar o aluno a algum lugar` (era `Mostrar um botão`); na notificação, primeiro `Como o aluno chega lá` com as pílulas `Pelo botão` · `Pelo botão ou tocando na notificação` · `Só tocando na notificação` (quebram a 375 px; 44 px no toque) e a descrição de cada uma; o texto é `Texto do botão` (`Ex.: Assistir agora`) ou, sem botão, `Texto ao lado da seta` (`Ex.: Ver a aula nova`, `Aparece no pé da notificação, com uma seta: o aluno vê que pode tocar.`; erro `Escreva o texto.`). Acima das pílulas do destino o rótulo é `Destino` (o grupo continua `Para onde o botão leva`, ou `Para onde a notificação leva` sem botão). Pop-up: o destino abre sempre pelo botão.
- **"Resposta" vira "Interação"** (só notificação; `O que o aluno pode fazer direto no sino.`):
  1. **Permitir reações** (ligada em toda notificação, seguinte e passo de fluxo novos; desligada em tudo o que já existia e num rascunho antigo sem a chave): `O aluno pode reagir com 👍 ❤️ 🔥 👏 😂 😮. Ele vê só a própria reação; os números ficam no relatório.` Logo depois, desde os ajustes, **Permitir que o aluno exclua do sino** (ligada por padrão; seção 10.1).
  2. **Pedir uma resposta (Aceitar ou Recusar)**, desligada enquanto há enquete (`Desligue a enquete para pedir uma resposta.`).
  3. **Fazer uma enquete**, desligada enquanto há resposta (`Desligue “Pedir uma resposta” para fazer uma enquete.`): `Pergunta` (até 120), `Opção 1` a `Opção 6` (até 60; começa com duas; **Remover** a partir da terceira, **Adicionar opção** até 6, depois `Até 6 opções.`), **Permitir marcar mais de uma**, **Mostrar o resultado para quem votar** (ligada) e `Encerra`: `Quando sair do sino` (padrão) ou `Numa data e hora` (`Depois disso ninguém mais vota.`). Na seguinte e no passo de fluxo não há data: `A enquete fica aberta enquanto a notificação estiver no sino.` (o envio é relativo, uma data fixa poderia cair antes dele). Erros: `Escreva a pergunta.`, `Use até 120 caracteres.`, `Escreva a opção.`, `Use até 60 caracteres.`, `Use pelo menos 2 opções.`, `Use no máximo 6 opções.`, `As opções precisam ser diferentes.`, `Escolha data e hora.`, e ao publicar `Escolha um fim no futuro.` / `A enquete encerraria antes de a notificação sair.`. Resposta e enquete juntas: `Use a resposta ou a enquete, não as duas.`
- **Prévia**: título de 15 px, a linha da seta ou o hover, o Reagir e o excluir parados (sem o excluir quando o aluno não pode excluir) e a enquete; com enquete, as pílulas `Enquete na prévia` · `Antes de votar` / `Depois de votar` ("depois" marca a primeira opção como o voto da própria pessoa, `1 voto` e `100%`, nunca números inventados).
- Pop-up: o card Interação não aparece na v3a (enquete no pop-up é da v3b); o servidor recusa `A enquete vale só para notificações por enquanto.`, `Reações valem só para notificações.` e `No pop-up, o destino abre pelo botão.`.

### 2.6 Relatório

- **Respostas** ganha **Mudaram de resposta** (`{x}% de quem respondeu`); aceitaram e recusaram são as respostas atuais.
- **Reações** (quando a notificação permite ou tem alguma): **Reagiram** (`{x}% de quem viu`) e um número por emoji com pelo menos uma (`👍 Gostei`, `{x}% das reações`), na ordem do seletor; sem nenhuma, `Ninguém reagiu ainda.`
- **Enquete**: a pergunta, cada opção com a barra e `42% · 54 votos`, `Votaram 128 · 40% de quem viu`, `Mudaram o voto 6`, a nota das várias respostas e a situação (`Encerra em 25/10/2026 às 18:00`, `Encerra quando a notificação sair do sino.`, `Encerrada em …`, ou `Encerrada: a notificação saiu do sino.` na retirada); para `messaging.publish` e enquete aberta, **Encerrar enquete** (`Encerrar a enquete?` / `Ninguém mais vota. O resultado fica como está agora.`, toast `Enquete encerrada.`). Só em avisos: a enquete de uma seguinte ou de um passo de fluxo encerra quando a notificação sai do sino.
- **Excluíram do sino** ao lado de "Voltaram a estudar" quando passa de 0 (`{x}% de quem recebeu`). Rodapé do funil: `Reagir e votar também contam como abrir.`
- Relatório do fluxo e a seção das seguintes: `Reagiram` e `Votaram` por passo (parte de `Abriram`) e as opções da enquete do passo (`Opção removida` para um id que saiu da versão atual).

### 2.7 Regras no construtor de segmentos e nas seguintes

- A regra **O que fez com uma notificação** ganha, depois das da v2: `reagiu` (só se a notificação permite reações), `votou na enquete` (só com enquete) e `excluiu do sino` (sempre). Com `reagiu`, `com qualquer reação` ou `com 👍 Gostei` … `com 😮 Uau`; com `votou na enquete`, `em qualquer opção` ou `em “Sim”`…
- Escolhas rápidas das seguintes: `não votou na enquete` (anterior com enquete) e `não reagiu` (anterior com reações).
- **Quem excluiu a notificação de cima do sino não recebe as escolhas de "não fez"**: `não abriu`, `viu no sino, mas não abriu`, `não foi para o destino`, `abriu, mas não foi para o destino`, `não respondeu`, `não votou na enquete`, `não reagiu`, `não começou a ouvir` e `não ouviu o áudio até o fim` ganham a regra `não excluiu do sino`, com a linha `Quem excluiu a notificação de cima do sino não recebe esta.`. Ficam de fora `nem viu no sino` (excluída já é vista), `todos que receberam`, as positivas e as de página e produto. **Seguinte salva pela v2**: continua abrindo na mesma escolha rápida e continua enviando pelas regras antigas (sem `não excluiu do sino`) até ser salva de novo; o salvar seguinte grava o formato da v3a.
- Textos que diziam "botão" (verdade só no modo Pelo botão) agora valem nos três modos: `foi para o destino`, `foram para o destino da notificação “X”`, `a página para onde a notificação leva…`, `não foi para o destino`, `abriu, mas não foi para o destino`, `não visitou a página para onde a notificação leva`, `Foram para o destino` e `Visitaram a página do destino` nos relatórios, e `A notificação escolhida não leva a lugar nenhum. Escolha outra regra.` na validação. Ficam com "botão" só as frases do pop-up (que tem botão).

### 2.8 Permissões e a regra dos 500

| Ação | `messaging.write` | `messaging.publish` | `messaging.publish_large` |
|---|---|---|---|
| Ver relatório, duplicar, excluir rascunho / aguardando / cancelado / encerrado | sim | — | — |
| Editar notificação enviada | — | até 500 que receberam | acima de 500 |
| Editar pop-up no ar (igual) | — | até 500 | acima de 500 |
| Mostrar de novo para quem já viu | — | até 500 reiniciados | acima de 500 |
| Encerrar enquete | — | sim | — |
| Excluir agendado, enviado, pop-up no ar ou pausado | — | sim | — |

Nada disso vira pedido de aprovação (C13). Tudo na auditoria, só ids e contagens: `communication.edited_after_send` `{ kind, fields, recipients }`, `communication.popup_reshown` `{ count, via: "editor" | "menu" }`, `communication.poll_closed`, `communication.deleted` (acima).

---

## 3. Dados (migração `202610220001`)

Colunas, índices e RPCs em `docs/05` (seção Comunicação v3a). Em resumo:

- `campaigns` ganha `cta_display` (`button` padrão, `button_and_card`, `card`; os dois últimos só na notificação com destino), `allow_reactions` (padrão `false`: tudo o que já existe fica sem reações; o app manda `true` nas notificações novas), `poll` (jsonb da enquete, com formato conferido pelo banco e `closesAt` em ISO UTC canônico; não convive com Aceitar/Recusar; sem trava de tipo, para a v3b pôr no pop-up) e `edited_at`/`edited_by`.
- `notifications` ganha `hidden_at`, `reaction`/`reacted_at`, `response_changed_at`/`response_changes`, `poll_choice`/`poll_voted_at`/`poll_changes` e `interaction_writes`, mais o índice parcial `notifications_poll_tally_idx (campaign_id) where poll_choice is not null and not is_test`.
- `campaign_deliveries` ganha `reshown_at`, `impressions_before_reshow` e `snoozes_before_reshow` (com zero, a regra do pop-up é exatamente a da v1).
- RPCs novas (só `service_role`, `security invoker`): `communication_visible_notifications` (a regra de "aparece no sino", num lugar só), `communication_poll_tally`, `communication_inbox_page`, `communication_inbox_counts`, `communication_respond_notification`, `communication_vote_notification_poll`, `communication_reshow_popup`, `communication_message_interactions` e `communication_notice_citations`; a 7.9 `communication_flow_batch_facts` (mesma assinatura) passa a trazer reação, voto e excluída.
- Nada de `drop` nem de `delete`: tudo pelo MCP do Supabase, seção por seção (seção 12). `communication_campaign_stats`, `communication_overview`, as estatísticas dos fluxos e `prune_communication_history` não mudam; excluída continua contando como recebida e vista.
- O app da v2 continua funcionando com a 0003 aplicada (colunas novas com padrão; o código da v2 não lê `hidden_at`, e nenhuma linha fica escondida antes das rotas novas). Sem ela, o app da v3a responde o sino vazio e as escritas novas 404 (`isMissingCommunicationSchema`): por isso ela vai **antes** do merge.

---

## 4. Por dentro

### 4.1 Leitura do sino (`inbox.ts`)

- A lista é **uma** chamada (`communication_inbox_page`): a página com o cursor `limit + 1`, quem envia (perfil e se ainda está na equipe), o autor do comentário, os dois números e, numa enquete, a contagem **só** para quem votou ou quando ela encerrou pela data (os únicos casos em que o app mostra resultado; o `auto_explain` confirma: a página de quem não votou não lê o índice da contagem). Os números do resumo e depois de cada escrita são outra chamada (`communication_inbox_counts`).
- A regra de "aparece no sino" existe uma vez, em SQL (`communication_visible_notifications`): do aluno, dos últimos 90 dias, antes do fim, não excluída por ele; aviso enviado e não excluído (o teste da equipe aparece); comentário aprovado e o respondido também. A lista, os números, "Marcar todas", "abriu o sino" e toda conferência de uma linha (clique, resposta, áudio, reação, voto, lixeira) usam a mesma função. A conferência de uma linha também recusa linha com mais de 90 dias ou excluída (antes olhava só o fim e o aviso).
- Mapeamento: `cta.display` desconhecido vira `button`; `reactions` nulo quando a equipe não permitiu; resultado da enquete só com `showResults` e (votou ou encerrou); comentário com `reactions` e `poll` nulos.

### 4.2 Escritas do aluno

- **Lixeira** (`setNotificationHidden`): excluir grava `hidden_at` e `seen_at` (se faltava); excluir de novo uma já excluída é sucesso sem gravar (mesmo vencida ou com o aviso excluído); desfazer limpa `hidden_at`. Devolve os números.
- **Reação** (`reactToNotification`): 409 `Esta notificação não aceita reações.` quando a equipe não permitiu; a mesma reação não grava; reagir grava visto, lido e aberto.
- **Resposta** (`communication_respond_notification`): a primeira grava `responded_at`; a troca grava `response_changed_at` e soma `response_changes`; a mesma não grava.
- **Voto** (`communication_vote_notification_poll`): encerrada 409 antes de conferir as opções; id que não é da enquete 400 `Voto invalido.`; `[]` tira o voto; troca soma `poll_changes`; a contagem volta só depois de um voto com resultado visível.
- Contadores param em 1.000; `interaction_writes` soma toda escrita que mudou a linha.

### 4.3 Limites (T22)

- **30 escritas por minuto por aluno** somando reação, voto, lixeira e resposta (`takeStudentWrite`, `student-write-limit.ts`, janela fixa de 1 minuto por processo): a 31ª é 429 `Muitas tentativas. Espere um pouco.` com `Retry-After: 60`, conferida logo depois da sessão (um id inválido também conta). Por processo: na Hetzner é a produção inteira; na Vercel (teste) é por instância, melhor esforço.
- **20 eventos por linha**: os eventos dessas escritas param quando `interaction_writes` antes da escrita chega a 20 (`shouldRecordInteraction`); a linha sempre guarda o estado final, e os relatórios leem a linha.
- `interaction_writes` na lixeira e na reação é lido e gravado pelo app: duas escritas ao mesmo tempo podem perder uma soma (só deixa passar uns eventos a mais; o limite de 30 cobre).
- Corpos: reação, voto e lixeira até 1.000 bytes; resposta 8.000 (igual).

### 4.4 Memória do navegador (`notifications-client.ts`, `notifications-model.ts`)

| Constante | Valor | Para quê |
|---|---|---|
| `INBOX_REUSE_MS` | 5 s | página mais nova que isso: abre sem pedir de novo |
| `INBOX_KEEP_MS` | 10 min | até isso: mostra na hora e atualiza por trás; depois, esqueleto |
| `INBOX_PREFETCH_DWELL_MS` | 120 ms | mouse parado no sino (ou foco pelo Tab) antes de buscar |
| `INBOX_INTENT_STALE_MS` | 60 s | mouse e foco só buscam sem página guardada ou com ela mais velha que isso |
| `INBOX_CLOSE_QUIET_MS` | 1 s | depois de fechar o painel, foco e mouse no sino não são intenção |

- **Intenção** (`member-notifications-menu.tsx`): mouse parado 120 ms ou foco pelo teclado (`:focus-visible`) baixam o código do painel na hora e a lista depois dos 120 ms (no máximo uma vez por minuto); dedo, clique ou Enter/Espaço no sino fechado buscam na hora (página com mais de 5 s). Nunca com o painel aberto nem no segundo depois de fechar (fechar devolve o foco ao sino). Uma página buscada também atualiza o número do sino; buscar nunca marca nada como visto.
- **Abertura**: página com menos de 5 s abre como está; até 10 min abre na hora e atualiza por trás (a falha deixa a de antes com o aviso); senão, esqueleto e busca (juntando-se a uma busca em andamento). No máximo um pedido por abertura, nenhum ao fechar, nada em intervalo (C11 continua).
- **"Abriu o sino" e "Marcar todas"**: o "abriu" sai uma vez por abertura, com o `asOf` da página que fica na tela (na hora, ou depois da atualização, ou com o da guardada se ela falhou); "Marcar todas" usa o `asOf` da lista na tela. As regras de `asOf` e `shown` da v1 e da v2 não mudam (os testes delas passam sem mudança).
- Mudanças locais (aberta, lida, resposta, reação, voto, excluídas) voltam para a memória a cada mudança, sem as excluídas; uma página mais velha nunca substitui uma mais nova; "Carregar mais" vai junto; o filtro "Não lidas" nunca é guardado. A memória é da aba e some numa navegação completa (sair da conta já faz `window.location.replace`).
- Atualização com o painel aberto **junta** em vez de trocar: o que o aluno mexeu nesta abertura fica como está na tela, e as linhas do Desfazer ficam no lugar.

### 4.5 Editar, excluir, mostrar de novo e encerrar enquete (`actions.ts`)

- **Editar a enviada** é um caminho próprio do `saveNoticeDraft`: confere a versão primeiro (409 antes de qualquer campo travado), depois o tipo, o conteúdo (zod), os campos travados (`sentNoticeLockedProblems`, comparando datas pelo instante), as permissões, quem envia e as seguintes (`checkNoticeFollowUps`: uma seguinte que perde o destino que usa dá 422 `… Mude a notificação seguinte no relatório antes de salvar.`); grava só as colunas editáveis (`SENT_EDITABLE_COLUMNS`) com `edited_at`; atualiza as páginas acompanhadas das seguintes quando o destino muda. **Nunca** roda `publishProblems` (o envio está no passado), nunca mexe no fluxo das seguintes (ele continua no ar e as pendentes saem) e nunca recalcula pop-ups.
- **Excluir** reaproveita o Retirar do sino (`withdrawSentNotice`) na enviada; no pop-up no ar encerra antes de excluir.
- **Citações** (`communication_notice_citations`): conta os avisos que ainda contam o segmento (rascunho, aguardando, agendado, pop-up no ar ou pausado) e os fluxos não encerrados que citam a notificação em qualquer regra, fora o próprio fluxo das seguintes dela. A lista e o detalhe trazem o número; Excluir e Retirar gravam na auditoria; nada é recusado por isso.
- **Mostrar de novo** (`communication_reshow_popup`): conta antes (sem gravar), confere os 500 e então grava `impressions_before_reshow = impressions`, `snooze_count` e `snoozes_before_reshow` = `least(snooze_count, 1)` (o "Lembrar depois" do relatório não muda), `snoozed_until = null`, `reshown_at = agora`. Não muda a linha do aviso, então o cache dos pop-ups no ar continua valendo e `pickPopup` lê a linha do aluno fresca.
- **Encerrar enquete** (`closeNoticePoll`): grava `poll.closesAt = agora` (ISO canônico) e `edited_at`. Duplicar copia enquete, reações e o modo, e zera um fim que já passou (ou em menos de 1 hora).

---

## 5. Rotas e ações

### 5.1 Rotas do aluno

Todas com `Cache-Control: private, no-store` e `Vary: Cookie`, corpo por `readBoundedJson` (aceita `text/plain`) e sessão pelas **claims do JWT** (`requireApiSessionUser`, T17): com `AUTH_SESSION_STRATEGY=claims` (produção) não há ida ao Auth; sem ela, o mesmo `getUser()` de antes. Uma sessão revogada pode mexer no próprio sino até o JWT vencer (1 h), a troca que o `docs/06` já aceitou nas páginas de conteúdo. Vale também para o beacon dos pop-ups.

| Rota | Novo / mudou | Corpo | Respostas |
|---|---|---|---|
| `GET /api/notifications` | uma RPC | — | itens com `cta.display`, `reactions` e `poll` (nulos no comentário) |
| `GET /api/notifications/summary` | RPC dos números | — | igual |
| `POST /api/notifications/read`, `/[id]/click` | sessão | igual | igual |
| `POST /api/notifications/[id]/response` | troca permitida; limite | `{ response }` | 200 `{ data: { changed, response } }`; 400 `Resposta invalida.` (também JSON malformado); 404; 429 (o 409 saiu) |
| `POST /api/notifications/[id]/reaction` | novo; limite | `{ reaction: id \| null }` | 200 `{ data: { reaction } }`; 400 `Reacao invalida.`; 401; 404; 409 `Esta notificação não aceita reações.`; 413; 429 |
| `POST /api/notifications/[id]/poll` | novo; limite | `{ optionIds: string[] }` (0 a 6) | 200 `{ data: { poll } }`; 400 `Voto invalido.`; 401; 404; 409 `A enquete foi encerrada.`; 413; 429 |
| `POST /api/notifications/[id]/hide` | novo; limite | `{ hidden: boolean }` | 200 `{ data: { unread, unseen } }`; 400 `Pedido invalido.`; 401; 403 `Esta notificação não pode ser excluída.` (excluir com a opção desligada, seção 10.1; o Desfazer vale sempre); 404; 413; 429 |
| `POST /api/popups/[id]/events` | sessão | igual | igual |

### 5.2 Server Actions (`actions.ts`)

| Ação | Permissão | Saída | Erros |
|---|---|---|---|
| `saveNoticeDraft` (mudou) | `messaging.write` (+ as da seção 2.8) | `SavedNotice` + `reshown?` | 400 campo travado, 403 ×2, 409 versão, 422 seguinte; no pop-up, 400 `reshow` fora de "Uma vez" e 403 acima de 500 |
| `deleteNotice` (mudou) | `messaging.write`; `publish` na seção 2.3 | `{ id, removed }` | 403, 409 enviando, 409 versão |
| `reshowPopup` (nova) | `messaging.publish` | `{ reshown, updatedAt }` | 403 acima de 500, 404, 409 (fora do ar, fora de "Uma vez", versão), 422 (não é pop-up) |
| `closeNoticePoll` (nova) | `messaging.publish` | `NoticeStateChange` | 409 sem enquete / já encerrada, 404 |
| `duplicateNotice` | igual | | copia enquete, reações e modo; fim passado vira nulo |
| `withdrawNotice` | igual | | pelo `withdrawSentNotice`; auditoria com as citações |

### 5.3 Eventos (`student_events`, só ids)

| Evento | Quando | `metadata` |
|---|---|---|
| `notification_reacted` | pôs, trocou ou tirou | `{ campaign_id, reaction }` (`null` = tirou) |
| `notification_voted` | votou, trocou ou tirou | `{ campaign_id, option_ids }` (`[]` = tirou) |
| `notification_hidden` | excluiu ou desfez | `{ campaign_id, hidden }` (`campaign_id` nulo no comentário) |
| `notification_responded` | primeira resposta ou troca | `{ campaign_id, response, changed }` |

No máximo 20 por linha (seção 4.3); falha de evento vira log e não muda a resposta.

---

## 6. Regras

`audience-model.ts` continua sendo o único avaliador; a regra `message` ganha três ações (no fim da lista da v2) e o `choice` opcional:

| Ação | Opções | Frase (`Alunos que …`) |
|---|---|---|
| `reacted` | qualquer reação ou um emoji (`choice` = id do catálogo) | `reagiram à notificação “Aula nova”` / `reagiram com ❤️ à notificação “Aula nova”` |
| `voted` | qualquer opção ou uma (`choice` = id da opção) | `votaram na enquete da notificação “Horário da live”` / `votaram em “Sábado” na enquete da notificação “Horário da live”` (opção que saiu: `uma opção removida`) |
| `hidden` | — | `excluíram do sino a notificação “Oferta especial!”` |

- Negação implica "recebeu" (igual); `interagiu` também vale com reação ou voto. `choice` fica só em `reacted` (id do catálogo) e `voted` (id de opção); qualquer outro é descartado na normalização.
- Valem em segmentos (qualquer notificação enviada) e em fluxos (Condição, "Só para quem…", Objetivo, "Para quem" da seguinte). A prévia, a publicação, o envio agendado pelo tick, o recálculo do pop-up e a entrada de um fluxo dão a mesma contagem (`segmento-por-notificacao`).
- Validação do fluxo: `A notificação escolhida não aceita reações. Escolha outra regra.`, `A notificação escolhida não tem enquete. Escolha outra regra.`, `Esta opção não existe mais na enquete. Escolha outra.`
- Fatos: `audience-facts.ts` lê `reaction`, `poll_choice` e `hidden_at` das linhas citadas; o motor recebe os mesmos campos pela 7.9; o conteúdo de um passo compara também `allow_reactions`, `cta_display` e `poll` (mudar um deles num fluxo no ar cria versão nova). O tick não muda (nenhum job, fase ou orçamento novo).

---

## 7. Desempenho

Antes, abrir o sino fazia: o Auth (`getUser()`) e de 3 a 6 consultas ao banco em sequência (lista, comentários, até 5 voltas quando linhas escondidas enchiam a janela, perfis, equipe e as duas contagens); no celular, o código do painel e a lista baixavam um depois do outro; reabrir sempre esperava a rede. Depois: 0 ida ao Auth com `AUTH_SESSION_STRATEGY=claims`, **1** consulta, e a lista sai junto com o código (ou nem sai, se a página guardada tem menos de 5 s).

Medido pelo pacote A (supabase local, aquecido, 3 rodadas de aquecimento e 20 medidas, duas rodadas; ms). Um aluno com 33 avisos enviados (2 por uma pessoa da equipe, 1 com enquete) e 10 respostas de comentário; primeira página de 20. **Medido no processo** (as rotas chamadas como funções contra o PostgREST local), não com `next build && next start` + `curl`: as regras de trabalho em paralelo não deixavam buildar. Fica de fora a sobrecarga do Next e o Auth (medido à parte).

| Medida | Antes p50 / p95 | Depois p50 / p95 | Pedidos ao PostgREST, antes → depois |
|---|---|---|---|
| `GET /api/notifications` | 30,3 / 38,3; 28,8 / 34,2 | **11,2 / 14,6; 9,4 / 11,1** | 8 em sequência → **1** |
| `GET /api/notifications?filter=unread` | 28,5 / 35,7; 26,5 / 31,6 | 10,9 / 14,2; 9,0 / 13,7 | 8 → 1 |
| `GET /api/notifications/summary` (fora da home) | 9,2 / 10,5; 8,2 / 11,7 | 5,9 / 7,6; 5,1 / 6,2 | 2 → 1 |
| Auth `getUser(jwt)` (antes, em todo pedido) | 4,2 / 4,7; 4,1 / 4,8 | não chamado (claims) | — |
| Enquete para 5.000 alunos (2.500 votos em 3 opções + 50 testes): página de quem não votou | — | 11,2 / 14,9; 9,6 / 12,3 | 1 |
| a mesma, página de quem votou (com a contagem) | — | 11,4 / 15,5; 10,8 / 12,6 | 1 |
| `POST /api/notifications/[id]/poll` (resultado visível, alternando opções) | — | 22,3 / 28,1; 19,4 / 21,7 | 2 |

- Metas (spec §7.4): lista p50 ≤ 35 e p95 ≤ 80; página de quem votou p50 ≤ 45; voto p50 ≤ 40 e p95 ≤ 90: **cumpridas**. A página de quem não votou não lê o índice da contagem; a de quem votou faz um `Index Scan using notifications_poll_tally_idx` (2.501 linhas, 0,6 ms); o voto respondeu `voters: 2501` (testes da equipe fora).
- Localmente uma ida ao PostgREST custa cerca de 3 ms, então a queda de 8 para 1 vale uns 20 ms aqui. No ambiente de teste (Vercel `gru1` → Supabase `sa-east-1`, 10 a 30 ms por ida e 30 a 80 ms para o Auth) é algo como 8 × 10–30 ms + Auth → 1 × 10–30 ms. O "acordar" da função na Vercel (300 a 1.500 ms depois de um tempo parado) continua lá; na Hetzner (servidor sempre ligado, banco na mesma máquina) não existe. Meta da produção: tempo de servidor ≤ 20 ms, na rodada do `carga` (`docs/20` §12.1) depois do deploy.
- No navegador (`sino-rapido.spec.ts`): passar o mouse e abrir = 1 pedido e nada de esqueleto; fechar e abrir em menos de 5 s = nenhum; abrir, esperar 6 s e fechar (Esc ou clique fora) = nenhum; mouse no sino duas vezes num minuto = no máximo 1; reabrir com a página de 6 s e a rede 2 s atrasada mostra a de antes em até 200 ms e a nova entra no topo; no toque, o pedido da lista sai antes de o código do painel (atrasado 500 ms) terminar de chegar.
- Script da medida: `measure-bell.mjs` do pacote A (fora do repositório; cria contas `medicao.sino.*@bunker707.test` e apaga tudo o que criou). Para repetir com o app buildado, rodar sob a trava do banco.

Resposta ao produtor (para colar):

> Não é o ideal, e dá para melhorar. Hoje, ao tocar no sino, o painel primeiro baixa o próprio código e só depois pede a lista; o servidor confere a sessão e faz de 3 a 6 consultas, uma depois da outra; e no ambiente de teste (Vercel) a primeira chamada depois de um tempo parado ainda "acorda" o servidor. Na v3a a lista começa a ser buscada quando o mouse ou o dedo chega no sino, junto com o código; o servidor responde com uma consulta só; e abrir o sino de novo mostra a lista na hora, atualizando por trás. Em produção (servidor próprio, sempre ligado) não existe o "acordar".

---

## 8. Decisões tomadas

| # | Decisão | Por quê |
|---|---|---|
| T1 | O ⋯ tem o CRUD completo em toda situação em que faz sentido (Ver relatório, Editar, Duplicar, Excluir e as ações de estado), mais **Mostrar de novo** no pop-up; continua vindo de `availableNoticeActions` (pura, testada) e o servidor confere | "Não tem opção de CRUD das notificações nos 3 pontinhos" |
| T2 | **Notificação enviada pode ser editada**, só o conteúdo; chega a todos os sinos na hora; silenciosa (sem "editada", sem número novo, leitura mantida) | a linha do sino aponta para o aviso (C3), então editar é uma atualização; corrigir um erro de digitação não deve chamar atenção; mensagem nova é notificação nova |
| T3 | **Travado depois do envio**: tipo, segmento, envio, "Fica no sino por", áudio, ligar/desligar Aceitar/Recusar e a enquete (menos **Encerrar enquete**) | mudam quem recebe e quando, ou o sentido do que os alunos já fizeram |
| T4 | Editar a enviada **vale como publicar** (`publish`; acima de 500, `publish_large`; senão 403, nunca pedido); quem levaria o 403 não vê **Editar**; auditoria só com os nomes dos campos; `Editado · …` no relatório | uma regra só para o que os alunos veem agora |
| T5 | **Excluir em qualquer situação menos "Enviando"**; agendado, enviado e pop-up no ar ou pausado pedem `publish`; a enviada sai de todos os sinos (com as seguintes que já saíram, caixa marcada) | "delete (any status)"; tirar nunca é mais arriscado que mostrar, então sem regra dos 500 |
| T6 | **Mostrar de novo** no editor e no menu; na v3a só em "Uma vez", **desde a v3b-1 em qualquer "Quantas vezes"** (`docs/25` P11); reinicia quem ainda está no segmento, viu mais vezes do que adiou e não escolheu Não mostrar de novo (quem clicou fica de fora, menos nos pop-ups que só param quando terminam); sem limite entre pop-ups desde os ajustes (seção 10.8) | com a frequência escolhida por pop-up, o reinício importa em todo modo; "Não mostrar de novo" é pedido do aluno |
| T7 | A resposta ao produtor sobre o pop-up (seção 2.4) | perguntado duas vezes |
| T8 | **Lixeira do aluno** em todo cartão, com Desfazer no lugar até o painel fechar; excluída sai de tudo e continua "recebeu"; **Excluíram do sino** no relatório | o pedido; sem prazo no Desfazer (WCAG 2.2.1) |
| T9 | **Cartão clicável** em três modos; um link acessível por cartão mais um link decorativo por baixo; todo controle dentro continua clicável; sinal visual (hover, toque, cursor, anel de foco, a linha com a seta) | "toda a mensagem pode ser clicável … feedback visual", sem interativo dentro de link |
| T10 | **Mudar resposta** enquanto a notificação está no sino; relatórios com a resposta atual; `responded_at` = a primeira; `response_changes` conta | "a opção de voltar atrás" |
| T11 | **Título 15 px em negrito**; texto 14 px regular zinc 300; só no aviso (o comentário fica com a frase) | um passo maior e um peso acima dão contraste a 375 px sem quebrar o ritmo |
| T12 | **Reações** com 6 emoji fixos, uma por aluno, o aluno vê só a própria; ligadas em toda notificação, seguinte e passo novos, desligadas no que já existia; nem no pop-up nem no comentário | números num aviso da escola expõem baixo engajamento e custam uma soma por cartão; a própria é privada e vem na linha |
| T13 | **Enquete** em notificações, seguintes e passos (o formulário é o mesmo): 2 a 6 opções, uma ou várias, resultado para quem votar, fim por data ou quando sai do sino (seguintes e passos só "quando sai"); exclusiva com Aceitar/Recusar; travada depois do envio menos **Encerrar enquete**; o modelo (`interactions-model.ts`) é puro e é o que a v3b reaproveita | "responder uma enquete diretamente nessa parte de mensagens ou em forma de popup" |
| T14 | **Regras** `reagiu`, `votou na enquete`, `excluiu do sino`; escolhas rápidas `não votou na enquete` e `não reagiu`; toda escolha de "não fez" pula quem excluiu; seguinte da v2 mantém as regras até ser salva; "foi para o destino" no lugar de "clicou no botão" | "reagiu à notificação X", "votou na opção X"; quem jogou fora não recebe cobrança |
| T15 | Reagir e votar contam como abrir; a enquete conta como "algo para abrir", a reação não; excluir só marca vista | "não abriu" continua querendo dizer "não abriu" (V7) |
| T16 | **Servidor do sino**: uma RPC para a página (com as pessoas e os números), uma para os números; a regra de visibilidade num lugar só, em SQL; contagem da enquete só para quem votou ou quando encerrou | de 3 a 7 idas em sequência para 1 |
| T17 | **Sessão pelas claims do JWT** em toda rota do sino e no beacon do pop-up | o Auth era 40 % de 1 vCPU no teste de carga (`docs/20` §12.1); as rotas só mexem no sino do próprio aluno |
| T18 | **Navegador**: a primeira página sai na intenção, junto com o código, e fica guardada (5 s reabre como está, 10 min mostra e atualiza); nada no fechar nem em intervalo; as regras de `asOf`/`shown` ficam | no celular código e lista baixavam em sequência; reabrir sempre esperava |
| T19 | Eventos novos `notification_reacted`, `notification_voted`, `notification_hidden`; `notification_responded` ganha `changed` | acompanhar o comportamento desde o começo (AGENTS.md) |
| T20 | Uma migração aditiva, sem `drop` nem `delete`, toda pelo MCP, aplicada antes do deploy; o app da v2 funciona sobre ela | o MCP trava em comando destrutivo |
| T21 | Vocabulário da tela (topo deste documento) | `docs/17` §1.3, `docs/23` V19 |
| T22 | **30 escritas por minuto por aluno** nas quatro rotas de escrita (429) e **20 eventos por linha** | alternar sempre muda algo; com sessão por claims nada mais segura um script, e cada voto trava uma linha |
| T23 | Excluir ou retirar uma enviada citada nas regras de outros avisos ou fluxos **avisa** com o número, sem impedir | depois de sair, para essas regras ninguém recebeu; bloquear obrigaria a editar outros avisos antes |

### 8.1 Escolhas da entrega

O que a implementação decidiu onde o desenho era omisso ou não batia com o código (descrito acima onde muda o comportamento; aqui para não se perder):

- **Sino (servidor)**: o limite de escrita é conferido logo depois da sessão (um id inválido conta); JSON malformado na resposta vira `400 Resposta invalida.` (era `JSON invalido.`); excluir de novo uma já excluída é sucesso mesmo vencida ou com o aviso excluído, e desfazer não confere o resto da visibilidade; a conferência de uma linha também recusa mais de 90 dias e excluída; aviso sem a linha do aviso sai da página (o cursor continua vindo da linha `limit + 1`); a frase e o `Retry-After` do 429 ficam em `student-write-limit.ts`.
- **Sino (tela)**: o `Esc` do seletor é ouvido no próprio elemento (o React e o popover escutam no `document`); tocar fora fecha o seletor sem mexer no foco; o código do painel continua baixando na hora no mouse e no foco (só a lista espera os 120 ms); **Desfazer** não é otimista (`Desfazendo...`); atualização com o painel aberto junta em vez de trocar; rodapé da enquete com a frase primeiro e os números depois (`… 128 votos · Encerra em 25/10 às 18:00 · Cada pessoa pode marcar mais de uma`, a nota só com resultado); no "Pelo botão ou tocando" o anel de foco é só o do cartão; o número de não lidas volta se a exclusão não vale. Na entrega final, os efeitos de foco que rodam depois de uma resposta do servidor (o foco na lixeira depois do Desfazer, na frase depois de responder ou mudar a resposta, no título depois de "Marcar todas" e no rodapé depois do último "Carregar mais") passaram para o commit do React (`useLayoutEffect`): com um efeito comum, a restauração do popover do Base UI devolvia o foco ao painel no quadro seguinte (o teste de ponta a ponta pegou).
- **Conferência visual da entrega** (1440 e 375 px): o item do menu ⋯ passou a ter altura mínima (`min-h-9`) em vez de fixa, porque `Mostrar de novo para quem já viu` quebra em duas linhas e passava por cima do vizinho; o `KpiTile` estreito (as duas colunas a 375 px) deixa rótulo e definição quebrarem em até duas linhas em vez de cortar (`Mudaram de resposta` saía `Mudaram de respo…`); o rodapé da enquete usa `text-pretty` (o `2 votos` não se parte nem fica sozinho no fim da linha).
- **Avisos**: `syncNoticeWatchedPages` recebe o resultado da conferência; fluxo de seguintes encerrado nunca bloqueia editar a enviada; só um erro de campo das seguintes vira o 422 da seção 4.5; a situação do diálogo de Excluir no editor usa a janela **salva** e o `now` do servidor; singulares (`do 1 aluno que recebeu`, `Para 1 aluno que já viu e não clicou.`, `… para 1 aluno que já tinha visto.`, `para ele ninguém recebeu`) e, sem o número, `quem recebeu`; `reshowPopup` também responde 409 `Este pop-up não está no ar.` para um pop-up ativo com a janela já terminada; `closeNoticePoll` confere a enquete antes da versão; `interactions` vem sempre (vazio no pop-up); `citations` vem em toda enviada (zeros sem citação) e nulo no resto; a auditoria do editar também grava a contagem, e a do retirar ganha as citações; no editor da enviada Para quem e Quando são texto e a contagem ao vivo não é pedida.
- **Conteúdo**: acima das pílulas do destino o rótulo é `Destino` (o grupo acessível continua `Para onde o botão leva`); `Escreva o texto.` é só da tela (o zod continua `Escreva o texto do botão.`); retirada mostra `Encerrada: a notificação saiu do sino.`; números por emoji na ordem do seletor; o diálogo de Encerrar enquete é destrutivo e uma falha de rede mostra `Não foi possível encerrar a enquete. Tente de novo.`; `Numa data e hora` começa 7 dias depois do envio às 23:59; ids de opção com 8 caracteres hexadecimais (com reserva quando `randomUUID` não existe) e sempre únicos na enquete.
- **Regras**: as duas frases do pop-up mantêm "clicou no botão" (o teste de vocabulário as tira antes de procurar); a linha `Quem excluiu a notificação de cima do sino não recebe esta.` fica no cartão da seguinte; uma regra `não votou` montada à mão continua `escolher por regras`; reação desconhecida no `choice` é "qualquer reação"; trocar a ação tira o `choice`; trocar a notificação mantém a reação e só mantém a opção se a enquete nova tem o mesmo id; as linhas `Reagiram`/`Votaram` do cartão da seguinte não têm porcentagem; o rótulo `Clicaram` do topo do relatório do fluxo ficou.
- **Contratos (para quem mexe no código)**: `availableNoticeActions` devolve na ordem do menu; o conteúdo de um passo de fluxo carrega `poll` e `reactions` (sem isso, salvar de novo criaria versão sem a enquete); os campos opcionais `MessageFact.hiddenAt/pollChoice/reaction`, `NotificationItem.reactions/poll` e `NotificationCta.display` ficam opcionais de propósito (ausente = sem; os literais antigos compilam); `FlowMessageMeta` tem os três campos obrigatórios; `normalizePollChoice` tira ids repetidos e ordena como a RPC.

---

## 9. Fica de fora

| Fora da v3a | Por quê / onde vai |
|---|---|
| Páginas e exclusões do pop-up, gatilhos (depois de uma aula, primeiro login, horário para todos, atraso), frequência (a cada N minutos/horas/dias, no máximo N vezes, por sessão), limites globais editáveis | **Entregue na v3b-1** (`docs/25`): páginas, exceções, ao abrir a página com atraso, ao concluir uma aula e a frequência por pop-up; sem limites globais (decisão do produtor); primeiro login e horário ao vivo na v3b-2, por sessão nunca (`docs/25` §8) |
| Construtor avançado do pop-up (blocos, layouts, vários botões, contagem regressiva, vídeo) e a pergunta do "construtor de HTML" | v3b-3, com blocos estruturados desenhados pelos componentes do app, nunca HTML cru (XSS guardado em página de aluno e a CSP com nonce de `src/proxy.ts`) |
| Enquete no pop-up e o relatório dela | v3b-3; o modelo puro e `campaigns.poll` (sem trava de tipo) estão prontos; os votos vão na linha do pop-up por aluno |
| "Como fechar" (só no X / no X ou fora) | **Entregue na v3b-1** (`docs/25` §1.6) |
| Números de reação para o aluno | privacidade e uma soma por cartão a cada abertura; a equipe vê no relatório |
| "Editada" para o aluno ou avisar de novo ao editar | aviso da escola não é mensagem de conversa; mensagem nova é notificação nova (T2) |
| Mudar áudio, segmento, envio, tempo no sino, resposta ligada ou a enquete depois do envio | muda quem recebe ou o sentido do que os alunos já fizeram (T3); Retirar e Duplicar cobrem |
| Reações no pop-up e no comentário | o pop-up some depois de fechado; reagir a uma resposta pediria avisar quem respondeu (Comunidade) |
| Resposta livre, mais de uma enquete por notificação, mais de 6 opções, lista de quem votou em quê | fora do escopo do sino; nomes pediriam `students.read_basic` e uma tela nova |
| Emoji próprio por notificação | o catálogo fixo mantém regras, relatórios e nomes acessíveis estáveis |
| Desfazer depois de fechar o painel, "Limpar tudo" | a linha do Desfazer basta enquanto o aluno está lá; apagar em lote pode vir com `/perfil/notificacoes` (`docs/22` §6) |
| Excluir enquanto envia | o envio segura a linha por segundos ou minutos; 409 com a frase |
| Tempo real e polling | C11 continua |
| Limite de pedidos nas rotas de leitura do sino (lista, resumo, leitura, clique, áudio) | linhas próprias, idempotentes, corpos pequenos; vêm com o limitador do `POST /api/events` (`docs/17` §2.3); as escritas que alternam têm limite (T22) |
| Impedir excluir uma notificação citada | o aviso com o número basta (T23) |

**Ajustes conhecidos, para depois**:

- o limite de 30 escritas é por processo (na Vercel, por instância);
- `interaction_writes` da lixeira e da reação pode perder uma soma em duas escritas simultâneas (seção 4.3);
- rodada do `carga` (`docs/20` §12.1) com o sino novo depois do deploy na Hetzner, e a medida com `next start` + `curl` se o produtor quiser o número do app inteiro;
- ponta a ponta no WebKit dos três arquivos novos (rodados no Chromium; o WebKit roda no CI);
- duas seguintes que vencem juntas para o mesmo aluno saem com 1 hora entre elas e a ordem entre as duas não é fixa (um teste novo com duas seguintes simultâneas deve aceitar as duas ordens).

---

## 10. Ajustes depois do primeiro teste

Data: 22/10/2026. O produtor testou a v3a na `dev` e pediu: minutos no "Fica no sino por"; escolher se o aluno pode excluir a notificação ("todas têm a lixeira"); perguntou se o lugar das reações e da lixeira era o melhor; e por que o diálogo demorava a confirmar e fechar ao excluir uma notificação no painel. Entram também quatro correções da revisão (enquete de um passo que já chegou a alguém, contagem da enquete por passo, o sino por aluno no navegador e duas do salvar da enviada). As perguntas sobre pop-ups do mesmo teste (frequência escolhida pela equipe, construtor avançado, páginas onde aparece ou não e o pop-up que não apareceu logo depois de criado) não fazem parte destes ajustes: as três primeiras são da v3b (seção 9); o pop-up que não apareceu era o limite fixo entre pop-ups, que saiu (seção 10.8).

Migração `202610220002_communication_v3a_ajustes.sql` (a `202610220001` já está na nuvem e não muda): `campaigns.allow_hide`, o mínimo do tempo no sino em 5 minutos (`campaigns_validity_v3`), a contagem da enquete por passo e `allow_hide` na página do sino. Seções 1 a 4 pelo MCP; a 5 (a única que tira alguma coisa: o check antigo `campaigns_validity_v2`, de 60 minutos) vai sozinha, depois (seção 12).

### 10.1 "Permitir que o aluno exclua do sino"

- Card **Interação**, logo depois de **Permitir reações**, no editor de avisos, na folha da notificação seguinte e no passo do construtor. **Ligada** em toda notificação, seguinte e passo novos e em tudo o que já existia (`campaigns.allow_hide`, padrão `true`; conteúdo salvo sem a chave conta como ligado). Descrição ligada: `Mostra a opção de excluir na notificação. O aluno exclui só do sino dele; nos relatórios continua como recebida.`; desligada: `Sem essa opção, a notificação fica no sino do aluno até o tempo dela acabar.`
- **Muda depois do envio** (não é campo travado: entra em `SENT_EDITABLE_COLUMNS`); num passo de fluxo no ar, mudar só ela cria versão nova (`CONTENT_COMPARE_FIELDS`). Duplicar copia (aviso, seguintes e fluxo). O pop-up grava sempre `true` (não tem sino).
- No sino, desligada: o cartão não tem o botão de excluir (seção 10.3). O servidor confere: excluir um aviso com ela desligada é 403 `Esta notificação não pode ser excluída.`, sem gravar nada nem registrar evento; o **Desfazer** vale sempre (também quando a equipe desligou depois de o aluno excluir). Se o 403 chega com o cartão na tela (a equipe desligou depois que a lista chegou), o excluir some e a frase aparece no cartão. As notificações de comentário sempre podem ser excluídas.
- Prévia: sem o excluir quando desligada.

### 10.2 "Fica no sino por" em minutos

- **Outro** → **Por um tempo**: `minutos` · `horas` · `dias`, de **5 minutos a 90 dias** (check `campaigns_validity_v3`; `VALIDITY_LIMITS.minMinutes` e o zod seguem o banco). Erros: `No mínimo 5 minutos.`, `No máximo 90 dias.` e `Use de 5 minutos a 90 dias.` (número quebrado ou vazio). Vale no editor, na folha da seguinte e no passo do construtor.
- Um tempo salvo reabre na maior unidade exata: 1440 = `1 dia`, 120 = `2 horas`, 90 = `90 minutos` (antes, 90 minutos reabria como 2 horas).
- **Até uma data** continua pedindo o fim pelo menos 1 hora depois do envio, e o **Enviar teste para mim** continua ficando pelo menos 1 hora. Com menos de 1 hora no sino o aluno vê `Termina em 4 min` (a regra do `Termina em` não mudou). O "Quando" das notificações seguintes (`2 horas depois do envio`) já tinha minutos.

### 10.3 O cartão: Reagir no fim da linha e excluir no canto

| Parte | Antes (seção 1.1) | Agora |
|---|---|---|
| Linha de ações | Reagir à esquerda, lixeira à direita, sempre presente | **saiu** |
| **Reagir** | na linha de ações | no fim da linha do botão (Acessar), ou da linha Aceitar/Recusar (perguntando, respondida ou trocando), ou, sem nenhuma das duas, no fim da linha de quem envia (que passa a ter 32 px só quando leva o Reagir). Mesmo nome, `Reagir à notificação “{título}”` |
| Reação escolhida | pílula na linha de ações | **pílula pequena** com o emoji (28 px, área de toque de 40 px) no mesmo lugar do Reagir; `Sua reação a “{título}”: Amei. Mudar reação` |
| Seletor | no lugar da linha de ações (a lixeira sumia) | na linha logo abaixo da do Reagir, que continua na tela (`aria-expanded`); teclado igual (foco na atual ou em Gostei, `Esc` fecha só o seletor, tocar fora fecha) |
| **Excluir** | lixeira de 32 px na linha de baixo | **botão de excluir** no canto de cima, à direita (`Trash2`, 32 px, área de toque de 40 px), nome `Excluir notificação “{título}”`, que exclui na hora (o **Desfazer** traz de volta); sem ele quando a equipe desligou a opção (seção 10.1). No computador aparece com o mouse sobre o cartão ou com o foco dentro dele (só a opacidade muda: continua no Tab); no toque fica sempre à mostra. O título reserva 32 px à direita |
| Bolinha de não lida | canto de cima, à direita | margem da esquerda, na altura do meio do círculo (o canto direito é do excluir) |

- Ordem de Tab: título (link no "Só tocando"), Ver mais, áudio, enquete, botão e o Reagir ao lado, resposta e o Reagir ao lado; num aviso sem linha de botões o Reagir vem logo depois do texto; o excluir é o último controle do cartão.
- **Por que um botão e não um "⋯" com menu**: a primeira versão dos ajustes usava um "⋯" que abria um menu com um item só (**Excluir notificação**). Era um toque a mais, e o menu dentro do popover do sino perdia o foco no Safari: o clique não foca o botão no WebKit, o menu abria com o foco no body e o `Esc` fechava o painel inteiro (o ponta a ponta do Safari pegou, e na CI o do Chrome também passou a falhar). Um botão direto, com o **Desfazer** que já existia, resolve os dois. Se um dia o cartão ganhar mais ações, o "⋯" volta.
- **Excluir** troca o cartão pela linha do Desfazer com o foco no **Desfazer** (como antes); depois do **Desfazer**, o foco vai para o excluir do cartão de volta. Pelo teclado: Tab até o excluir e Enter.
- Conferido a 1440 e a 375 px: o excluir nunca cobre o título, nada quebra a linha nem cria rolagem lateral, e o Reagir e o excluir têm pelo menos 32 px. A conferência pegou o botão do canto fora do lugar: o `relative` da classe do botão ganhava do `absolute` do canto (o `twMerge` fica com o último) e o botão caía numa linha nova da grade, na coluna do círculo, deixando um vão no pé do cartão; o ponta a ponta agora mede o canto.

Resposta ao produtor (para colar):

> Não era. A lixeira ocupava uma linha inteira só com ela e o Reagir, no pé de toda notificação, e ficava fácil de tocar sem querer. Agora o Reagir fica no fim da linha que já existe (ao lado do botão, de Aceitar/Recusar ou, sem eles, de quem envia), a reação escolhida aparece ali como uma pílula pequena, e excluir foi para um botão pequeno de lixeira no canto de cima: no computador ele aparece quando o mouse passa pela notificação, no celular fica sempre à mostra, e se o aluno tocar sem querer tem o **Desfazer**. E agora você escolhe, em cada notificação, se o aluno pode excluir: card **Interação**, **Permitir que o aluno exclua do sino** (ligada por padrão; pode mudar depois do envio). Desligada, a notificação fica sem a lixeira e só sai do sino quando o tempo dela acabar.

### 10.4 Enquete de um passo que já chegou a alguém

- Num fluxo no ar ou pausado (as notificações seguintes também são um fluxo), a enquete de um passo que já chegou a algum aluno (fora os testes da equipe) **não muda**: o construtor e a folha da seguinte travam o campo com `A enquete não muda depois que esta notificação chegou a alguém: os votos já dados ficariam com outro texto. Para outra enquete, crie uma notificação seguinte nova.`, e o servidor recusa com 422 e a mesma frase antes de gravar qualquer coisa (renomear opção, mudar a pergunta, tirar ou pôr enquete). Passo novo, não salvo ou duplicado continua livre; mudar o título continua criando versão nova.
- Por quê: o id da opção renomeada fica, então os votos antigos contariam para o texto novo no relatório e na regra `votou em “X”`.
- **A contagem soma as versões do passo**: num passo de fluxo, `communication_poll_tally` soma os votos de todas as versões do passo (como o relatório), então quem recebeu a versão 1 e quem recebeu a 2 veem a mesma porcentagem. Fora de fluxo, a do aviso. Mesma assinatura: o sino e o voto não mudam.

### 10.5 Excluir mais rápido no painel

- **Por que demorava**: excluir uma notificação enviada com seguintes fazia cerca de 11 idas ao banco, uma depois da outra (conferir o aviso, as citações, cancelar, ler e encerrar o fluxo, cancelar e tirar as seguintes, tirar as linhas dos alunos, a exclusão lógica, ler o fluxo de novo, tirar o fluxo, a auditoria), e depois `revalidatePath` fazia o servidor desenhar a página inteira de novo na mesma resposta; no relatório, era a página de um aviso que já não existia. O diálogo só fechava no fim de tudo.
- **Agora**: as leituras saem junto com a primeira escrita e os passos independentes em paralelo (cerca de 5 idas em sequência na enviada com seguintes; 2 ou 3 nas outras situações; o pop-up no ar encerra e exclui numa escrita só). Excluir e Retirar do sino não chamam mais `revalidatePath`: o toast aparece e o diálogo fecha assim que a ação volta, e a lista se atualiza logo depois por trás (`router.refresh()` numa transição; no relatório e no editor, Excluir volta para a lista, que chega nova).
- **O diálogo fecha na hora**: em Excluir e Retirar do sino o diálogo fecha assim que a equipe confirma; o toast aparece quando o servidor termina e um erro vai para o banner da tela, como nas outras ações.
- **O que sobra**: excluir um pop-up no ar ou uma notificação com seguintes ainda limpa o cache dos pop-ups (`updateTag` em `cache.ts`), e o Next manda a página redesenhada na resposta (o diálogo já fechou). Pop-up fora do ar (rascunho, agendado, encerrado) não limpa nada: o cache só tem os no ar.

Resposta ao produtor (para colar):

> Sei. Excluir uma notificação já enviada fazia umas 11 consultas ao banco, uma depois da outra, e depois o servidor desenhava a página inteira de novo antes de responder; o diálogo só fechava no fim de tudo. Agora as consultas que não dependem uma da outra saem juntas (umas 5 em sequência no pior caso), o diálogo fecha e a confirmação aparece assim que o servidor termina de excluir, e a lista se atualiza logo depois, sem segurar o diálogo.

### 10.6 Sino por aluno no navegador e outras correções

- **Memória com dono**: o número do sino e a página guardada (seção 4.4) passam a ser do aluno da sessão (`getAppShellData` manda `student.id`, o AppShell passa ao menu e ao painel). Com outra conta no mesmo navegador, nada da anterior aparece, nem a resposta atrasada de um pedido dela; o número da conta anterior não aparece nem por um quadro. Quem não sabe o id (o pop-up da home) não muda nada.
- **Filtro "Não lidas"**: excluir, desfazer, abrir, reagir, votar, responder ou "Marcar todas" com o filtro ligado descarta a página guardada do "Todas" (e um pedido do "Todas" que já tinha saído não guarda a resposta). A próxima abertura mostra o esqueleto e busca antes de mostrar: uma notificação excluída nunca reaparece.
- **Reagir e votar** só marcam o cartão como aberto (e tiram a bolinha) depois que o servidor aceita; numa falha (429, 409, rede) ele fica como estava.
- **Quem envia uma seguinte saiu da equipe**: não impede mais salvar a enviada (corrigir um erro de digitação); a conferência continua ao salvar as seguintes e ao publicar ou aprovar.
- **Páginas acompanhadas das seguintes** (`watched_page_keys`): a escrita só vale se o fluxo não mudou no meio (`updated_at`); se mudou, relê e recalcula uma vez (antes, salvar a enviada ao mesmo tempo que uma regra nova podia perder a página da regra). Salvar a enviada devolve a versão nova do fluxo quando as páginas mudam.

### 10.8 Sem limite fixo entre pop-ups (decisão do produtor)

- O produtor criou um pop-up, entrou como aluno e ele não apareceu: o aluno de teste já tinha visto outro pop-up naquele dia, e a regra da v1 era **no máximo 1 pop-up por sessão e 1 a cada 24 h** (docs/22 C6, docs/17 §1.8.1 e D12). Decisão do produtor: `Não quero esse limite fixo de segurança [...] Eu que tenho que definir isso manualmente.`
- **Saiu** o limite entre pop-ups: nem 1 por sessão (`sessionStorage`) nem 1 a cada 24 h contando qualquer pop-up (a leitura do último visto saiu do servidor, uma ida ao banco a menos). Cada pop-up segue só a sua regra: **Uma vez** aparece uma vez (o **Mostrar de novo** zera e ele volta na hora); **Até o aluno clicar** volta 24 horas depois de o aluno ter visto **este** pop-up. Continua: só na home, nunca numa aula, 3 s depois de abrir, **um de cada vez** (um por visita à home; na visita seguinte o servidor escolhe de novo).
- A frequência escolhida pela equipe em cada pop-up (N vezes por dia, a cada X minutos, horas ou dias, no máximo N vezes, até clicar ou só quando terminar) e as páginas chegaram na v3b-1, sem limite global fixo (`docs/25`); os modelos de configuração vêm na v3b-2.
- Textos que mudaram: a dica do card Quando do pop-up (`Por enquanto o pop-up aparece só na home, nunca durante uma aula, e um de cada vez.`), o diálogo e a chave do **Mostrar de novo** (sem `respeitando o limite de 1 pop-up por dia` e sem `Vale o limite de 1 pop-up por dia.`), o toast e a dica de **Até o aluno clicar** (`... 24 horas depois de ter visto este pop-up ...`).

### 10.7 Testes dos ajustes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/sino-ajustes-v3a.test.mjs` (11) | `allowHide` (mapeamento, comentário sempre), 403 tirando o excluir, nome do excluir, reagir e votar abrindo só depois do sucesso, memória por dono (página, resposta atrasada, número, pop-up sem id), descarte com o filtro "Não lidas" |
| Unitário | `tests/comunicacao-ajustes-v3a-equipe.test.mjs` (7) | `allowHide` no rascunho, no conteúdo, nas seguintes e no fluxo (padrão, falso, pop-up), não travada depois do envio, colunas e comparação do passo; 5 minutos aceitos, 4 recusados, teto, número quebrado; a frase da enquete travada igual na tela e no servidor |
| Unitário | `tests/comunicacao-ajustes-v3a-telas.test.mjs` (12) | ordem das unidades; a maior unidade exata ao reabrir; `No mínimo 5 minutos.` no aviso, na seguinte e no passo; a chave nova (padrões, prévia sem o excluir, textos, vocabulário); `livePollLockedFields` |
| Guarda | `tests/comunicacao-v3a-ajustes.guard.test.mjs` (6) | a 202610220001 sem mudança (hash); a 0002 sem `delete` nem gatilho, coluna e constraint com `if not exists`; o único `drop` é o check antigo, última instrução, sozinho na seção 5; as duas funções com a assinatura da 0001 e só para `service_role`; `allow_hide` na página e a soma por passo; o mínimo do banco igual ao do app |
| Integração | `tests/integration/comunicacao-ajustes-v3a.test.mjs` (7) | `allow_hide` gravado, lido, duplicado e mudado depois do envio; 5 minutos no servidor e no banco (4 recusado pelos dois); enquete travada no passo que chegou a alguém (422, sem versão nova); contagem somando duas versões; quem envia fora da equipe; a corrida das páginas acompanhadas com uma transação de verdade; Excluir e Retirar sem `revalidatePath` |
| Integração | `tests/integration/sino-lixeira-por-aviso.test.mjs` (3) | `allowHide` na página do sino; 403 sem escrita nem evento; o Desfazer sempre |
| Ponta a ponta | `tests/e2e/aluno-interage-no-sino.spec.ts` (7) | excluir pelo botão do canto (Enter pelo teclado e clique), foco no Desfazer e depois no excluir; o aviso sem lixeira sem o excluir e o 403 pelo endereço; o Reagir no fim da linha certa em cada tipo de cartão, a pílula de 28 px no mesmo lugar, o seletor logo abaixo; a 1280 e a 375 px o excluir com 32 px sem cobrir o título, dentro da tela e do cartão |
| Ponta a ponta | `tests/e2e/produtor-desliga-lixeira-e-usa-minutos.spec.ts` (2) | desligar a chave tira o excluir da prévia; `minutos` antes de horas e dias; 4 minutos param o envio com `No mínimo 5 minutos.`; 5 minutos enviam; no banco `allow_hide = false` e `validity_minutes = 5`; a aluna sem o excluir e a linha vencendo 5 minutos depois de chegar |

Ajuda nova em `tests/e2e/fixtures.ts`: `enviarNotificacao({ podeExcluir })` e `avisoNoBanco(título)`; `linhaDoSino` traz também `created_at` e `expires_at`.

---

## 11. Testes

| Tipo | Arquivo | O que prova |
|---|---|---|
| Unitário | `tests/comunicacao-v3-interacoes.test.mjs` (25) | catálogo das reações; `pollSchema` (todas as mensagens, limites, opções repetidas, ids, `closesAt` canônico); `parsePoll`; `isPollClosed`; `normalizePollChoice`; a matriz do resultado; `pollPercent`; as recusas do rascunho; `publishProblems` da enquete; `sentNoticeLockedProblems` (cada campo travado, datas pelo instante); ida e volta das colunas; rascunho da v2 sem as chaves; `shouldRecordInteraction`; `reactions: true` nos conteúdos vazios e nos modelos; a prévia antes e depois do voto |
| Unitário | `tests/comunicacao-avisos-modelo.test.mjs` (32), `tests/comunicacao-admin-modelo.test.mjs` (27) | todas as linhas do menu da seção 2.1 por permissão, com e sem o quarto parâmetro; `noticeRecipients`; `isLiveNoticeStatus`; `pickPopup` com o reinício (Uma vez 25 h, depois do reinício, 2 h, Até o aluno clicar sem reinício, Lembrar depois do zero, linhas da v1 iguais); `reshowSkipped`; `canSnooze`; trava de tipo, rascunho por tipo, prévia, toast e banner do pop-up no ar |
| Unitário | `tests/sino-servidor-v3.test.mjs` (21) | uma RPC por página e nenhum `from()`; mapeamento (quem envia, `Equipe Bunker707`, autor do comentário, modo desconhecido, reações, resultado só quando pode); números numa RPC; matriz de `fetchOwnVisible`; lixeira idempotente; mesma reação/resposta sem escrita; voto 409/400; eventos com 19 e 20 escritas; `takeStudentWrite`; 429 com `Retry-After` nas quatro rotas |
| Unitário | `tests/sino-do-aluno-modelo.test.mjs` (30), `tests/sino-do-aluno-memoria.test.mjs` (9) | `cardLinkOf` por modo, `cardActionLabels`, `nextReaction`, rodapés e nomes da enquete, estados de Mudar resposta, `openingPlan`, `mergeRefreshedPage`, fila de escritas; memória: duas intenções um pedido, abrir junta, 5 s, 30 s / 70 s, 10 min, 401 esquece, excluídas fora, página velha não troca a nova; `shouldPrefetchOnIntent`; guarda do Esc |
| Unitário | `tests/comunicacao-avisos-crud-tela.test.mjs` (13), `tests/comunicacao-conteudo-v3.test.mjs` (26) | ordem do menu, diálogos de Excluir por situação, frase das citações, singular `do 1 aluno que recebeu`, toasts, `opensNoticeEditor`, editor da enviada, dicas e chave do Mostrar de novo, última linha do relatório, vocabulário; prévia, textos de Para onde leva, campos da enquete, números do relatório |
| Unitário | `tests/comunicacao-segmentos.test.mjs` (56), `tests/comunicacao-fluxos-modelo.test.mjs` (37), `tests/comunicacao-seguintes-tela.test.mjs` (31), `tests/comunicacao-fluxos-tela.test.mjs` (31) | `reacted`, `voted`, `hidden` com e sem `choice`, negação, frases, textos do destino e o grep de "clicou no botão"; `impossibleActionProblem`; escolhas rápidas novas, a forma da v3a e a da v2, `não excluiu do sino` só nas de "não fez", a linha da dica; `Reagiram`, `Votaram`, `Foram para o destino` |
| Guarda | `tests/comunicacao-v3.guard.test.mjs` (7) | 0001, 0002 e 202610210001 sem mudança (hash); 202610220001 sem `drop`, `delete from` nem `create trigger`, checks em `if not exists`, permissões com a assinatura exata; toda rota do sino com `requireApiSessionUser` e as quatro de escrita com `takeStudentWrite`; o link decorativo com `aria-hidden` e `tabIndex={-1}` |
| Integração | `tests/integration/sino-v3.test.mjs` (7) | a mesma regra de visibilidade em lista, números, "Marcar todas", leitura e cada rota de uma linha (12 tipos de linha); paginação com excluídas no meio; lixeira; reações; mudar resposta (primeira `responded_at`, estatística com a atual); enquete (uma, várias, tirar, 400, 409 pela data, contagem sem testes, sem resultado, página de quem não votou sem contagem); 21 mudanças = 20 eventos |
| Integração | `tests/integration/avisos-crud.test.mjs` (16) | editar a enviada (título novo no sino, leitura mantida, enviada "agora", com enquete encerrada, com fim fixo, versão velha 409 antes do campo travado, fluxo das seguintes no ar); campos travados 400; 403 e os 500; auditoria; `sent_as`; destino que a seguinte usa 422; excluir em cada situação; citações; mostrar de novo (quem conta, quem não, depois do reinício, 2 h, Lembrar depois de novo, 500, menu e editor, Até o aluno clicar 409); encerrar enquete; duplicar |
| Integração | `segmento-por-notificacao` (10), `fluxos` (36), `notificacoes-seguintes` (26), `avisos-e-notificacoes` (36), `pop-ups` (11, sem mudança) | a mesma contagem com as regras novas em toda parte; Condição `votou em “Sábado”`; seguinte `não reagiu`; "viu no sino, mas não abriu" pula quem excluiu; seguinte da v2 com as regras antigas; a segunda resposta agora 200 `{ changed: true }`; a enviada excluída sai do sino |
| Ponta a ponta | `tests/e2e/aluno-interage-no-sino.spec.ts` (7) | reagir, trocar e tirar; votar (`100%`, `1 voto`) e mudar; aceitar, Mudar resposta (atual marcada, foco), recusar; tocar no texto do "Só tocando" (descrição `Ver a aula nova`) e do "Pelo botão ou tocando" e chegar à página (`clicked_at` gravado); excluir pelo botão do canto, Desfazer (foco no excluir), excluir de novo, reabrir e recarregar; o aviso sem lixeira (seção 10.7); a 1280 e a 375 px sem rolagem lateral, o Reagir no fim da linha, o excluir sem cobrir o título, seis emoji numa linha dentro da coluna, opções com 44 px, título 15 px / 700; teclado (Tab, Enter, Esc só no seletor) |
| Ponta a ponta | `tests/e2e/produtor-edita-e-exclui-aviso.spec.ts` (11) | ⋯ da enviada exatamente `Ver relatório · Editar · Duplicar · Retirar do sino · Excluir`; Editar → título novo → `Notificação atualizada no sino de 1 aluno.`; a aluna vê o novo sem a bolinha; Excluir com o texto do diálogo e o toast; pop-up "Uma vez" fechado 25 h atrás não volta; ⋯ Mostrar de novo → `para 1 aluno` → volta; quem escolheu Não mostrar de novo não; em Até o aluno clicar a chave some, a dica aparece e o ⋯ não oferece Mostrar de novo |
| Ponta a ponta | `tests/e2e/sino-rapido.spec.ts` (5) | os números de pedidos da seção 7 |
| Ponta a ponta | os da v1 e da v2 | passam; a chave `Mostrar um botão` virou `Levar o aluno a algum lugar` em `produtor-envia-notificacao` e `produtor-cria-notificacao-seguinte` |

Ajudas novas em `tests/e2e/fixtures.ts`: `enviarNotificacao({ titulo, texto, para, reactions, poll, response, destino, display, minutosAtras })` grava uma notificação já enviada pelo produtor de teste (o aviso "Enviado" e uma linha no sino de cada conta), `envelhecerPopup(campaignId, userId, horas)` volta no tempo o que o aluno viu de um pop-up, `contarPedidos(page, padrão, método)` conta os pedidos do navegador por caminho, `linhaDoSino(título, conta)` lê a linha do sino no banco, `contaDeTeste(chave)` e `idDoAviso(título)`; `estadoDoPopUpDaAluna` aceita outra conta. `limparComunicacao` não muda (as mesmas tabelas). As escritas da aluna num arquivo ficam abaixo de 30 por minuto (o limite vale também nos testes).

---

## 12. Roteiro de conferência no ambiente de teste

1. **Aplicar a `202610220001` no Supabase da nuvem antes do merge da PR na `dev`** (a Vercel publica a `dev` sozinha; o app da v3a sem a migração mostra o sino vazio e as escritas novas respondem 404; a migração sozinha não atrapalha o app da v2):
   - seções 1 a 6 pelo MCP (`apply_migration`, nome `communication_v3a`), de uma vez ou uma seção por chamada, **na ordem do arquivo** (a 4.2 `communication_poll_tally` existe antes da 4.3 e da 5.2, que a chamam). Não há `drop` nem `delete`: nenhuma parte precisa do SQL Editor. O índice parcial novo nasce vazio (ninguém votou ainda);
   - conferir com as consultas do cabeçalho da migração, `select count(*) from pg_proc where proname = 'communication_inbox_page'` (1), `select pg_get_constraintdef(oid) from pg_constraint where conname = 'notifications_poll_v3'` e `list_migrations` com `202610220001`. Se partes foram pelo SQL Editor e a versão não aparece: `insert into supabase_migrations.schema_migrations (version, name) values ('202610220001', 'communication_v3a') on conflict do nothing;` (`docs/21` §9.2).
2. `/admin/comunicacao/avisos` → **Novo aviso** → notificação com **Permitir reações**, uma **enquete** (2 opções, resultado ligado) e **Para onde leva** em **Só tocando na notificação**; enviar para um segmento só com alunos de teste.
3. Com a aluna A: reagir, trocar e tirar a reação; votar e mudar o voto; tocar no texto (vai para a página); **Excluir notificação** → **Desfazer**; excluir de novo e recarregar (não volta).
4. Outra notificação com **Aceitar/Recusar**: aceitar, **Mudar resposta**, recusar. No relatório: Recusaram 1, Mudaram de resposta 1, Reagiram, a enquete com as porcentagens, Excluíram do sino 1.
5. ⋯ da notificação enviada → **Editar** → trocar o título → **Salvar alterações**: a aluna vê o título novo, sem bolinha nova. Um pop-up com a regra "recebeu a notificação X" → ⋯ da X → **Excluir**: o diálogo avisa `Atenção: 1 aviso usa esta notificação nas regras…`; confirmar: some do sino dela.
6. Pop-up no ar em **Uma vez**, a aluna fecha no X. (a) Mudar para **Até o aluno clicar** e salvar: o editor não mostra **Mostrar de novo**; 24 h depois do último pop-up que ela viu (ou voltando `last_seen_at` no banco de teste) ela vê de novo. (b) Noutro pop-up em **Uma vez**, 24 h depois ela não vê; ⋯ → **Mostrar de novo para quem já viu** → ela vê. Nos dois, outra que escolheu **Não mostrar de novo** não vê.
7. Velocidade: passar o mouse no sino e abrir (a lista aparece sem esqueleto); fechar e abrir de novo (na hora). No celular, tocar no sino.

**Ajustes (seção 10)**:

8. **Aplicar a `202610220002` no Supabase da nuvem antes do merge da PR na `dev`** (o app novo lê `allow_hide` na página do sino e grava `validity_minutes` abaixo de 60):
   - seções 1 a 4 pelo MCP (`apply_migration`, nome `communication_v3a_ajustes`), na ordem do arquivo; tudo idempotente;
   - a seção 5 (`alter table public.campaigns drop constraint if exists campaigns_validity_v2;`) sozinha, pelo MCP ou pelo SQL Editor (é a única que tira alguma coisa). Antes dela o check antigo continua valendo e o banco recusa menos de 60 minutos;
   - conferir: `select pg_get_constraintdef(oid) from pg_constraint where conname in ('campaigns_validity_v2', 'campaigns_validity_v3')` (só a v3, com `between 5 and 129600`), `select column_default from information_schema.columns where table_name = 'campaigns' and column_name = 'allow_hide'` (`true`) e `list_migrations` com `202610220002`.
9. Nova notificação com **Permitir que o aluno exclua do sino** desligada e **Fica no sino por** → **Outro** → **Por um tempo** → `5` `minutos`: a prévia fica sem a lixeira; com `4`, o envio para em `No mínimo 5 minutos.`. Enviar com 5: a aluna vê sem a lixeira, com `Termina em … min`, e a notificação some do sino depois de 5 minutos.
10. Numa notificação com botão e outra só com texto: o Reagir fica no fim da linha do botão e no fim da linha de quem envia; reagir vira a pílula pequena no mesmo lugar. No computador, a lixeira do canto aparece ao passar o mouse; no celular, fica à mostra. Lixeira → a notificação sai na hora → **Desfazer**.
11. No painel, ⋯ de uma notificação enviada com seguintes → **Excluir**: o diálogo fecha e o toast aparece logo, e a linha some da lista em seguida.
12. Num fluxo no ar com um passo com enquete que já chegou a alguém: o campo da enquete fica travado com a frase da seção 10.4.
