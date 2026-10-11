// Flags de video lidas somente no servidor (variaveis sem prefixo NEXT_PUBLIC_).
//
// Fonte unica da regra de YOUTUBE_UNOFFICIAL_STREAMS: as rotas de streams e
// `fetchYouTubeStreams` (./youtube-streams.ts) importam daqui.
//
// Este modulo nao tem imports de proposito: tests/youtube-unofficial-flag.test.mjs o
// carrega direto pelo Node, que nao resolve imports relativos sem extensao.

export const youTubeUnofficialStreamsEnvName = "YOUTUBE_UNOFFICIAL_STREAMS";

export const youTubeUnofficialStreamsDisabledCode = "youtube_unofficial_streams_disabled";

export type YouTubeUnofficialStreamsMode = "on" | "off";

type FlagEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Regra da flag `YOUTUBE_UNOFFICIAL_STREAMS`:
 * - ausente ou vazia: "on" (padrao da fase 0, preserva o comportamento atual);
 * - "on" / "off", sem diferenciar maiusculas e ignorando espacos;
 * - qualquer outro valor: "off". Um erro de digitacao ao desligar nunca deve manter
 *   a extracao ligada; o pior caso de desligar por engano e o aluno ficar so com a
 *   qualidade automatica do embed oficial.
 */
export function parseYouTubeUnofficialStreamsMode(value: string | undefined): YouTubeUnofficialStreamsMode {
  const normalized = value?.trim().toLowerCase() ?? "";

  return normalized === "" || normalized === "on" ? "on" : "off";
}

export function getYouTubeUnofficialStreamsMode(
  env: FlagEnvironment = process.env
): YouTubeUnofficialStreamsMode {
  return parseYouTubeUnofficialStreamsMode(env[youTubeUnofficialStreamsEnvName]);
}

export function isYouTubeUnofficialStreamsEnabled(env: FlagEnvironment = process.env) {
  return getYouTubeUnofficialStreamsMode(env) === "on";
}
