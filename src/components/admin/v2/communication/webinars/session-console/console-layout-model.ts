// O esqueleto do console V2 de quem apresenta (docs/31 V2-13; o estilo do YouTube, docs/31 §10), no molde do
// roomSkeleton da sala (vertical-model.ts): um desenho so, que muda por classe e nunca troca o pai do iframe. O topo
// (64 px a partir de lg, sem fundo nem borda, como o da sala; duas linhas abaixo), o corpo e, na live, a coluna do palco
// (o palco e a barra), o painel em cartao do YouTube e o trilho a direita; sem palco (a gravada e o Replay), so o
// painel numa coluna de ate 720 px no meio, com as abas dentro (sem trilho). A partir de lg a pagina tem a altura da
// janela e cada parte rola por dentro; abaixo de lg tudo empilha e a pagina rola. O nó [data-live-stage] fica sempre
// no mesmo lugar: abrir ou fechar o painel, trocar de tema ou mudar a largura da janela so mudam classes
// (use-jitsi-meet.ts monta o iframe dentro do container na montagem). Modulo puro (so texto):
// tests/webinarios-console-v2-modelo.test.mjs carrega direto.
//
// Cada parte que rola por dentro e `relative`: os rotulos so para o leitor de tela (sr-only, position absolute) tomam
// a parte como referencia e rolam com ela. Sem isso eles tomam a pagina como referencia, esticam o documento por baixo
// da raiz de altura fixa e a pagina inteira rola para fora da tela.
//
// Os cantos do YouTube no console inteiro (docs/31 §10): a raiz redefine --member-button-radius (pilula) e
// --member-cover-radius (12 px, o do cartao do painel) e deixa o botao do admin em pilula, entao os botoes da sala e do
// admin que o console usa (as acoes das abas, as confirmacoes) e os cartoes de dentro ficam no desenho da sala sem
// reescrever cada peca. Dentro do painel, o fundo dos cartoes do admin (--surface-1 e --surface-3) e o do proprio
// cartao (--room-panel): nunca um cartao escuro dentro do cartao, so o contorno.

/** O painel do console (o aria-controls de quem o abre). */
export const CONSOLE_PANEL_ID = "console-panel";
/** As configuracoes de quem apresenta (o aria-controls do botao Configurações). */
export const CONSOLE_SETTINGS_ID = "console-live-settings";
/** O comeco dos ids das abas do painel: `console-tab-{aba}` no painel da aba e `console-tabbtn-{aba}` na aba. */
export const CONSOLE_TAB_ID_PREFIX = "console";
/**
 * O conteudo das abas sem SectionCard (Mãos e Pessoas, docs/31 V2-15): no estilo do YouTube ele fica direto no cartao
 * do painel, sem um cartao proprio (docs/31 §10).
 */
export const CONSOLE_PANE_CARD = "flex min-w-0 flex-col gap-4";

export type ConsoleSkeleton = {
  /** A barra de quem apresenta, embaixo do palco; nula sem palco. */
  bar: string | null;
  body: string;
  /** A faixa dos avisos logo abaixo do topo (o erro e as frases de so leitura). */
  banner: string;
  panel: string;
  /** O trilho a direita, so com palco e so a partir de lg; nulo sem palco (as abas ficam dentro do painel). */
  rail: string | null;
  root: string;
  /** O palco (o pai do iframe); nulo sem palco. */
  stage: string | null;
  /** A coluna do palco e da barra; nula sem palco. */
  stageColumn: string | null;
  top: string;
};

/**
 * As classes de cada parte do console. Com palco (a live): o palco 16:9 abaixo de lg e, a partir de lg, a altura que
 * sobra da coluna, nunca menos de 240 px; o painel no cartao do YouTube, de 320 a 514 px (27,5 % da janela: mais largo
 * que o da sala do aluno, que para em 400 px; a rodada v9 tinha baixado o do console para 400 px tambem, e o produtor
 * pediu de volta o espaco de antes no teste de 12/11/2026, docs/30 D92), e fechado ele some (montado) e o palco toma a largura; o trilho de 48 px depois do painel, a 16 px
 * da borda. Sem palco, o painel nunca fecha e fica no meio, com ate 720 px. A coluna do palco (so o palco e a barra; as
 * Configurações abrem por cima) rola por dentro numa janela baixa demais: o palco guarda o piso e a barra continua ao
 * alcance. A folga de 4 px (-m-1 com p-1) deixa o anel de foco dos botoes da borda inteiro dentro da rolagem. O painel
 * (console-panel.tsx) tem o cabecalho (ou a linha das abas) fixo e o corpo que rola. Os avisos (adminToast) abrem em
 * cima, no meio, logo abaixo do topo (a variavel --console-toast-top da raiz: o topo tem duas linhas abaixo de lg).
 */
/** A largura do painel do console a partir de lg: de 320 a 514 px (a sala do aluno para em 400 px). */
export const CONSOLE_PANEL_WIDTH = "lg:w-[clamp(320px,27.5vw,514px)]";

export function consoleSkeleton(input: { hasStage: boolean; panelOpen: boolean }): ConsoleSkeleton {
  const card = "lg:rounded-[12px] lg:border lg:border-room-panel-border lg:bg-room-panel";
  const panelBase = `relative flex min-w-0 flex-col lg:min-h-0 ${card} [--surface-1:var(--room-panel)] [--surface-3:var(--room-panel)]`;
  return {
    banner: "flex shrink-0 flex-col gap-2 px-4 pb-2",
    bar: input.hasStage ? "min-w-0 shrink-0" : null,
    body: "flex min-w-0 flex-col gap-4 px-4 pb-4 pt-2 lg:min-h-0 lg:flex-1 lg:flex-row lg:pt-0",
    // Fechado, so `hidden` (sem o `flex`, que disputaria o display com ele).
    panel: input.hasStage ? (input.panelOpen ? `${panelBase} ${CONSOLE_PANEL_WIDTH} lg:flex-none` : "hidden") : `${panelBase} mx-auto w-full max-w-[720px]`,
    rail: input.hasStage ? "hidden w-12 shrink-0 flex-col items-center gap-4 lg:ml-2 lg:flex" : null,
    root: "flex min-h-dvh flex-col bg-room-bg text-room-fg [--member-button-radius:9999px] [--member-cover-radius:12px] [&_[data-slot=button]]:rounded-full! [--console-toast-top:7.5rem] lg:h-dvh lg:overflow-hidden lg:[--console-toast-top:5rem]",
    stage: input.hasStage ? "relative aspect-video w-full min-w-0 overflow-hidden rounded-2xl bg-black lg:aspect-auto lg:min-h-60 lg:flex-1" : null,
    stageColumn: input.hasStage ? "relative flex min-w-0 flex-col gap-3 lg:-m-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-1" : null,
    top: "flex shrink-0 flex-col gap-2 px-4 py-2 lg:h-16 lg:flex-row lg:items-center lg:gap-6 lg:py-0 lg:pr-5"
  };
}
