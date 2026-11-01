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
  /** O selo dos presentes pelo retrato de 5 s, sem o pico (o Replay, antes de comecar). */
  presentes: (n: number) => (n === 1 ? "1 presente" : `${n} presentes`),
  /** "12 presentes · pico 14" (consolePresenceBadge: o pico nunca abaixo dos presentes). */
  presentesComPico: (n: number, pico: number) => `${n === 1 ? "1 presente" : `${n} presentes`} · pico ${pico}`,
  /** Fecha o aviso de erro da faixa abaixo do topo. */
  fecharAviso: "Fechar",
  /** O esqueleto da tela enquanto o console carrega, so para o leitor de tela. */
  carregando: "Carregando o console da sessão",

  /* O palco (V2-4 e V2-13): os selos sobre o video. */
  palco: {
    /** O selo de baixo a esquerda: "Você · Apresentador", "Você · Co-apresentador" ou "Ana · Apresentador". */
    selo: (nome: string, papel: string) => `${nome} · ${papel}`,
    /** O papel do co-apresentador no proprio selo (uma frase so, sem feminino). */
    coApresentador: "Co-apresentador"
  },

  /* A barra de quem apresenta (V2-14), embaixo do palco. */
  barra: {
    /** O nome da barra (o <nav>). */
    rotulo: "Controles de quem apresenta",
    /** O circulo da propria tela (o nome do V2-6). */
    compartilharTela: "Compartilhar tela",
    /** A pilula da esquerda com quem bate na sala de espera: "Sala de espera · 2". */
    salaDeEspera: (n: number) => `Sala de espera · ${n}`
  },
  /** O balao da direita da barra, que abre e fecha o painel do console. */
  painel: {
    esconder: "Esconder o painel",
    mostrar: "Mostrar o painel",
    mostrarComNovas: (novas: string) => `Mostrar o painel, ${novas}`
  },
  /** O "Palco para todos ▾" do Apresentador: o que o video mostra para todos agora (o seguir a visao leva a todos). */
  visao: {
    palcoParaTodos: "Palco para todos",
    gradeParaTodos: "Grade para todos"
  },
  /** O Remover do ⋮ da miniatura do video (V2-A29), quando ele nao passa pelo nosso Remover. */
  pessoas: {
    removidoSemRegistro: "A pessoa saiu da sala, mas pode voltar: ela ainda não aparece na lista da sessão.",
    equipeNaoSai: "Quem é da equipe não é removido da sala.",
    tenteDeNovo: "Ainda não dá para remover esta pessoa. Tente de novo em alguns segundos."
  }
} as const;
