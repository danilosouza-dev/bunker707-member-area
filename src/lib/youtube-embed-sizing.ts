// Geometria do iframe oficial do YouTube no player da aula.
//
// O player embutido escolhe a qualidade automatica pelo tamanho do proprio viewport em pixels
// CSS (verificado em 2026-10-14: com 540 px de altura e devicePixelRatio 2 ele ficou em 720p,
// entao o fator de pixels fisicos nao entra na conta). Com um palco de ~500 px de altura ele
// fica em 720p. Para o "Automático" chegar a Full HD, o iframe e renderizado com pelo menos
// 1080 px CSS de altura e reduzido com `transform: scale()` ate caber no palco: o documento de
// dentro nao enxerga a transformacao e continua acreditando no tamanho grande.
//
// A largura segue a regra que ja existia (3x a largura do palco, centralizada) para manter os
// cantos do player do YouTube fora da area visivel.

export const youTubeEmbedTargetHeight = 1080;
export const youTubeEmbedWidthMultiplier = 3;

export type YouTubeEmbedFrameGeometry = {
  /** Altura interna do iframe, em pixels CSS. */
  height: number;
  /** Fator aplicado em `transform: scale()`; 1 quando o palco ja e grande o bastante. */
  scale: number;
  /** Largura interna do iframe, em pixels CSS. */
  width: number;
};

export type YouTubeEmbedFrameStyle = {
  height: string;
  transform: string;
  transformOrigin: "top center";
  width: string;
};

export function getYouTubeEmbedFrameGeometry({
  saveData = false,
  stageHeight,
  stageWidth,
  targetHeight = youTubeEmbedTargetHeight
}: {
  /** `navigator.connection.saveData`: o aluno pediu economia de dados, entao nao forcamos resolucao. */
  saveData?: boolean;
  stageHeight: number;
  stageWidth: number;
  targetHeight?: number;
}): YouTubeEmbedFrameGeometry | null {
  if (
    !Number.isFinite(stageHeight) ||
    !Number.isFinite(stageWidth) ||
    stageHeight <= 0 ||
    stageWidth <= 0
  ) {
    return null;
  }

  const minimumHeight = saveData ? 0 : Math.ceil(targetHeight);
  const height = Math.max(Math.round(stageHeight), minimumHeight);
  const scale = stageHeight / height;
  const width = Math.round((stageWidth * youTubeEmbedWidthMultiplier) / scale);

  return { height, scale, width };
}

export function getYouTubeEmbedFrameStyle(geometry: YouTubeEmbedFrameGeometry): YouTubeEmbedFrameStyle {
  return {
    height: `${geometry.height}px`,
    transform: `translateX(-50%) scale(${geometry.scale.toFixed(6)})`,
    transformOrigin: "top center",
    width: `${geometry.width}px`
  };
}
