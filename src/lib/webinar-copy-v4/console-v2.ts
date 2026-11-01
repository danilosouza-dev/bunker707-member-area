// Frases do console V2 de quem apresenta (docs/31 §1, V2-12 a V2-15, fase 2 do redesign): o topo, o palco, a barra
// de quem apresenta, o painel com abas e o chat do console. Entram em WEBINAR_COPY.consoleV2 e passam pela
// PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo puro, sem imports. Dono: a fase 2 do redesign V2; cada
// fatia acrescenta aqui as frases que a tela dela usa. As frases que o console ja tinha continuam em
// WEBINAR_COPY.consoleAoVivo e em WEBINAR_ADMIN_COPY.console (editor-model.ts).

export const CONSOLE_V2_COPY = {
  /* O topo (V2-13): o seletor de sessoes, o Atualizar e a faixa dos avisos. */
  /** A situacao gravada de cada sessao dentro do seletor, em minuscula depois do ponto do meio. */
  fases: { cancelled: "cancelada", ended: "encerrada", live: "no ar", scheduled: "agendada", waiting: "na espera" },
  /** "Sessão de 30/10 às 20:00 · no ar". */
  sessaoDe: (quando: string, fase: string) => `Sessão de ${quando} · ${fase}`,
  /** "Replay · 30/10 às 20:00". */
  replayDe: (quando: string) => `Replay · ${quando}`,
  /** O nome do seletor de sessoes, so para o leitor de tela. */
  rotuloSessao: "Sessão",
  atualizar: "Atualizar",
  atualizando: "Atualizando…",
  semResposta: "Sem resposta do servidor; tentando de novo.",
  /** Fecha o aviso de erro da faixa abaixo do topo. */
  fecharAviso: "Fechar",
  /** O esqueleto da tela enquanto o console carrega, so para o leitor de tela. */
  carregando: "Carregando o console da sessão"
} as const;
