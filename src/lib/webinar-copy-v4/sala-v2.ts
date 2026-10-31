// Frases da sala do aluno V2 (docs/31 §1, V2-1 a V2-19): o tema, o painel, a visao do video, a enquete no palco e os
// selos. Entram em WEBINAR_COPY.salaV2 e passam pela PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo
// puro, sem imports. Dono: a fase 1 do redesign V2. As frases que a sala ja tinha continuam em WEBINAR_COPY.sala.

export const SALA_V2_COPY = {
  /**
   * O cabecalho (V2-3): a linha da data no computador ("Quinta, 30 de outubro · 20:00 · 60 min · com Danilo Souza") e a
   * linha do celular ("com Danilo Souza · 128 assistindo"); os trechos se juntam com " · ".
   */
  cabecalho: {
    com: (nome: string) => `com ${nome}`,
    duracao: (minutos: number) => `${minutos} min`
  },
  /**
   * O chat no estilo do Zoom (V2-9): o leitor de tela ouve quem escreveu antes do texto ("Marina R., Equipe, 20:41: ",
   * so os trechos que existem: o aluno nao tem papel e o Replay nao tem hora); a linha "nome · papel · hora" embaixo do
   * balao e so para quem ve. O menu ⋯ da linha do campo leva o Remover minhas mensagens.
   */
  chat: {
    autor: (partes: readonly string[]) => `${partes.join(", ")}: `,
    maisOpcoes: "Mais opções"
  },
  /**
   * A enquete no meio do palco (V2-10): o rotulo pelo tipo, "Enviar resposta" e "Responder depois", que recolhe para o
   * card do chat ("Enquete aberta · você deixou para depois" com "Responder agora"); o resultado compartilhado no mesmo
   * lugar, com o total de respostas e "Fechar". "Enquete aberta" e o que o leitor de tela ouve quando ela abre sozinha.
   */
  enquete: {
    aberta: "Enquete aberta",
    deixouParaDepois: "Enquete aberta · você deixou para depois",
    enviarResposta: "Enviar resposta",
    fechar: "Fechar",
    respostaMultipla: "Enquete · resposta múltipla",
    respostaUnica: "Enquete · resposta única",
    respostas: (n: number) => (n === 1 ? "1 resposta" : `${n} respostas`),
    responderAgora: "Responder agora",
    responderDepois: "Responder depois",
    resultado: "Enquete · resultado"
  },
  /**
   * O painel do chat (V2-6 a V2-8): o balao da barra diz o que faz ("Esconder o chat" com o painel aberto, "Mostrar o
   * chat" com ele fechado e, com mensagens novas, "Mostrar o chat, 3 mensagens novas", a contagem que vem de
   * WEBINAR_COPY.sala.mensagensNovas), o X do painel fecha e a lista das abas se chama "Painel da sala".
   */
  painel: {
    esconder: "Esconder o chat",
    fechar: "Fechar o painel",
    mostrar: "Mostrar o chat",
    mostrarComNovas: (novas: string) => `Mostrar o chat, ${novas}`,
    rotulo: "Painel da sala"
  },
  /** Os selos do palco (V2-4): quem apresenta, embaixo a esquerda, sobre o video. */
  selos: {
    apresentador: (nome: string) => `${nome} · Apresentador`
  },
  /**
   * O botao de tema do cabecalho diz para onde vai: no escuro, "Tema claro"; no claro, "Tema escuro" (V2-12). Abaixo de
   * sm, na live, o mesmo botao fica na linha "Tema" do painel Configurações (V2-18).
   */
  tema: {
    claro: "Tema claro",
    escuro: "Tema escuro",
    titulo: "Tema"
  },
  /**
   * A visao do video da live (V2-16), no botao da barra a partir de lg: o nome diz o que o video mostra agora ("Visão do
   * vídeo: Palco"), e o menu "Visão do vídeo" tem Palco (o video grande com as miniaturas ao lado) e Grade (todos do
   * mesmo tamanho). Sem as palavras da PROIBIDAS_WEBINARIO.
   */
  visao: {
    atual: (nome: string) => `Visão do vídeo: ${nome}`,
    grade: "Grade",
    palco: "Palco",
    rotulo: "Visão do vídeo"
  }
} as const;
