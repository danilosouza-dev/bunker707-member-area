// Frases da Sala Live vertical 9:16 (docs/30 §1.6, §6.6 e §9): o celular em pe, video em tela cheia, selo e contador
// no topo, chat por cima, o card de compra como pilula e a gaveta com o chat inteiro, as perguntas e as enquetes.
// Entram em WEBINAR_COPY.vertical. Modulo puro, sem imports. Dono: a frente 4d da sala vertical. As frases que a sala
// normal ja tem (Sair, Reagir, Enviar, os selos, o aceite) vem de WEBINAR_COPY.sala: o aluno le o mesmo.

export const VERTICAL_COPY = {
  /** O nome do grupo de controles por cima do video (o leitor de tela). */
  rotulo: "Sala no celular em pé",
  abrirChat: "Abrir o chat",
  fecharChat: "Fechar o chat",
  /** O texto de dentro do campo compacto (o nome do campo continua "Escreva uma mensagem"). */
  escreva: "Comente…",
  maisMensagens: "Ver mais mensagens",
  /** No replay (a barra do player fica inteira com o celular deitado) e no rodape da gaveta. */
  girar: "Gire o celular para ver a sala completa.",
  /** O botao que abre a gaveta. */
  gaveta: "Perguntas e enquetes",
  /** O nome da gaveta aberta (o chat inteiro tambem fica nela). */
  gavetaRotulo: "Chat, perguntas e enquetes",
  /** Fecha a gaveta (e o Esc faz o mesmo). */
  voltarAoVideo: "Voltar para o vídeo"
} as const;
