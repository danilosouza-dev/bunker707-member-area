// O esqueleto do console V2 de quem apresenta (docs/31 V2-13), no molde do roomSkeleton da sala (vertical-model.ts):
// um desenho so, que muda por classe e nunca troca o pai do iframe. O topo (56 px a partir de lg, duas linhas abaixo),
// o corpo e, na live, a coluna do palco (o palco e a barra) ao lado do painel; sem palco (a gravada e o Replay), so o
// painel numa coluna de ate 720 px no meio. A partir de lg a pagina tem a altura da janela e cada parte rola por
// dentro; abaixo de lg tudo empilha e a pagina rola. O nó [data-live-stage] fica sempre no mesmo lugar: abrir ou
// fechar o painel, trocar de tema ou mudar a largura da janela so mudam classes (use-jitsi-meet.ts monta o iframe
// dentro do container na montagem). Modulo puro (so texto): tests/webinarios-console-v2-modelo.test.mjs carrega direto.
//
// Cada parte que rola por dentro e `relative`: os rotulos so para o leitor de tela (sr-only, position absolute) tomam
// a parte como referencia e rolam com ela. Sem isso eles tomam a pagina como referencia, esticam o documento por baixo
// da raiz de altura fixa e a pagina inteira rola para fora da tela.

/** O painel do console (o aria-controls de quem o abre). */
export const CONSOLE_PANEL_ID = "console-panel";
/** As configuracoes de quem apresenta (o aria-controls do botao Configurações). */
export const CONSOLE_SETTINGS_ID = "console-live-settings";

export type ConsoleSkeleton = {
  /** A barra de quem apresenta, embaixo do palco; nula sem palco. */
  bar: string | null;
  body: string;
  /** A faixa dos avisos logo abaixo do topo (o erro e as frases de so leitura). */
  banner: string;
  panel: string;
  root: string;
  /** O palco (o pai do iframe); nulo sem palco. */
  stage: string | null;
  /** A coluna do palco e da barra; nula sem palco. */
  stageColumn: string | null;
  top: string;
};

/**
 * As classes de cada parte do console. Com palco (a live): o palco 16:9 abaixo de lg e, a partir de lg, a altura que
 * sobra da coluna, nunca menos de 240 px; o painel com 320 px de 1024 a 1279, 360 de 1280 a 1535 e 440 a partir de
 * 1536 (a largura do prototipo), e fechado ele some (montado) e o palco toma a largura. Sem palco, o painel nunca
 * fecha. A coluna do palco rola por dentro quando o que fica nela passa da altura (enquanto o card Configurações e a
 * Sala de espera ainda ficam ali, ate G6 e G7): o palco guarda o piso e a barra continua ao alcance. A folga de 4 px
 * (-m-1 com p-1) deixa o anel de foco dos botoes da borda inteiro dentro da rolagem.
 */
export function consoleSkeleton(input: { hasStage: boolean; panelOpen: boolean }): ConsoleSkeleton {
  const panelBase = "relative flex min-w-0 flex-col gap-4 lg:min-h-0 lg:overflow-y-auto";
  return {
    banner: "flex shrink-0 flex-col gap-2 px-4 pt-4",
    bar: input.hasStage ? "min-w-0 shrink-0" : null,
    body: "flex min-w-0 flex-col gap-4 p-4 lg:min-h-0 lg:flex-1 lg:flex-row",
    // Fechado, so `hidden` (sem o `flex`, que disputaria o display com ele).
    panel: input.hasStage ? (input.panelOpen ? `${panelBase} lg:w-80 lg:flex-none xl:w-[360px] 2xl:w-[440px]` : "hidden") : `${panelBase} mx-auto w-full max-w-[720px]`,
    root: "flex min-h-dvh flex-col bg-room-bg text-room-fg lg:h-dvh lg:overflow-hidden",
    stage: input.hasStage ? "relative aspect-video w-full min-w-0 overflow-hidden rounded-2xl bg-black lg:aspect-auto lg:min-h-60 lg:flex-1" : null,
    stageColumn: input.hasStage ? "relative flex min-w-0 flex-col gap-3 lg:-m-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-1" : null,
    top: "flex shrink-0 flex-col gap-2 border-b border-room-border bg-room-surface px-4 py-2 lg:h-14 lg:flex-row lg:items-center lg:gap-6 lg:py-0"
  };
}
