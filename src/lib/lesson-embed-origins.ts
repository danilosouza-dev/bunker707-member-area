// As origens dos players de fora que a ponte da aula le (docs/29 §4.4, D16) e as regras dela, num modulo
// pequeno e separado: lesson-media-signal.ts (que vai em toda pagina do aluno, com o host do pop-up) so precisa
// saber se o iframe do palco e de um player da lista; o resto da ponte (src/lib/lesson-embed-bridge.ts, que
// reexporta tudo daqui) so baixa na pagina da aula. Puro.

export type EmbedProtocol = "playerjs" | "vimeo";

/** Grupos de origens exatas (D16). Nunca endsWith/includes. A Bunny e um grupo: o src de um aceita os dois. */
export const EMBED_BRIDGE_GROUPS: readonly { origins: readonly string[]; protocol: EmbedProtocol }[] = [
  { origins: ["https://iframe.mediadelivery.net", "https://player.mediadelivery.net"], protocol: "playerjs" },
  { origins: ["https://player.mux.com"], protocol: "playerjs" },
  { origins: ["https://player.vimeo.com"], protocol: "vimeo" }
];

export const EMBED_BRIDGE_RULES = {
  /** Aperto de mao: repete a cada 400 ms, ate 12 vezes (como hero-video.tsx:52-53). Ouvir continua sempre. */
  handshakeEveryMs: 400,
  handshakeTries: 12,
  /** Mensagem em texto maior que isto e ignorada antes do JSON.parse. */
  maxMessageChars: 4_096,
  /** Segundos aceitos em tempo e duracao. */
  maxSeconds: 86_400,
  /** onTime no maximo 1 vez por segundo. */
  minTimeReportMs: 1_000,
  /** "pending" acaba (vira "silent") no fim dos apertos de mao sem resposta, ou 15 s depois de ligar, o que vier antes. */
  pendingMaxMs: 15_000
} as const;

/** A ponte para este src, ou null (origem fora da lista, src que nao le). sendOrigin = a origem do src. */
export function embedBridgeTarget(src: string | null | undefined): { origins: readonly string[]; protocol: EmbedProtocol; sendOrigin: string } | null {
  if (typeof src !== "string" || !src) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  // Com usuario ou senha no endereco, nao e o player de sempre.
  if (url.username || url.password) {
    return null;
  }

  const group = EMBED_BRIDGE_GROUPS.find((candidate) => candidate.origins.includes(url.origin));

  return group ? { origins: group.origins, protocol: group.protocol, sendOrigin: url.origin } : null;
}
