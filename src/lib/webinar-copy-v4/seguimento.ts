// Frases do follow-up por segmento (docs/30 §1.6 e D52): as acoes do follow-up (viu o replay, viu o card de compra,
// saiu antes dele, clicou e nao comprou, comprou pelo card) sao acoes da regra "Participação em lives" do construtor de
// segmentos da Comunicacao, que tem os proprios rotulos (notices-view-model.ts) e frases (audience-model.ts). Aqui
// ficam so as frases do webinario em volta dela: onde as acoes do follow-up valem, quem a acao negada alcanca, quando a
// compra entra no segmento e a nota do aviso que veio do "Avisar quem não veio" do relatorio. Os textos evitam as
// palavras proibidas das guardas da Comunicacao (FORBIDDEN_COPY em tests/comunicacao-admin-modelo.test.mjs nao aceita
// "oferta"; PROIBIDAS de tests/pop-ups-v3b1-frases.test.mjs nao aceita "sessão", "lembrete", "evento"...): "card de
// compra" no lugar. Entram em WEBINAR_COPY.seguimento. Modulo puro, sem imports.

export const SEGUIMENTO_COPY = {
  /** O erro das acoes do follow-up dentro de um fluxo ou no Quem pode da live (schemas.ts). */
  soNoSegmento: "Replay, card de compra e compra valem só no “Para quem” de avisos e pop-ups e no “Quem entra” de um fluxo.",
  /** A nota do topo do aviso novo que veio do relatorio do webinario (o "Avisar quem não veio"). */
  inicioDoAviso: "O “Para quem” já vem com as regras da live inteira: quem garantiu vaga em qualquer horário e não entrou em nenhum. Confira e escreva o aviso: nada foi salvo ainda.",
  /** A nota embaixo de uma acao do follow-up negada: a negacao nunca alcanca a escola inteira (D52). */
  notaNegada: "Com “não”, só conta quem garantiu vaga ou passou pela live (entrou, viu o replay ou clicou no card).",
  /** A nota embaixo da regra nas acoes da compra. */
  atraso: "A compra entra pelo webhook de venda em até alguns minutos; o pop-up confere o segmento de novo a cada 15 min."
} as const;
