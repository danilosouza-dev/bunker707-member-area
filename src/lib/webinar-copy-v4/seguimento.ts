// Frases do follow-up por segmento (docs/30 §1.6): a regra "Webinário" do construtor de segmentos da Comunicacao. Os
// rotulos evitam as palavras proibidas das guardas da Comunicacao (FORBIDDEN_COPY em
// tests/comunicacao-admin-modelo.test.mjs nao aceita "oferta"; PROIBIDAS de tests/pop-ups-v3b1-frases.test.mjs nao
// aceita "sessão", "lembrete", "evento"...): "card de compra" no lugar. Entram em WEBINAR_COPY.seguimento e sao lidas
// pela Comunicacao onde os rotulos das regras ja ficam (audience-model.ts: a frase do segmento; notices-view-model.ts:
// o seletor do construtor; schemas.ts: os erros). Modulo puro, sem imports. Dono: a frente 4b da conversao e do
// follow-up.
//
// `acoes` e `negadas` sao as opcoes do seletor (no singular: "[compareceu] em [webinário]"); `plural` e
// `pluralNegadas` entram na frase do segmento, depois de "Alunos que".

const WEBINARIO_REMOVIDO = "um webinário removido";

export const SEGUIMENTO_COPY = {
  regra: "Webinário",
  regraDescricao: "O que o aluno fez numa live: vaga, presença, replay e o card de compra.",
  escolhaWebinario: "Escolha o webinário",
  rotuloAcao: "O que o aluno fez no webinário",
  rotuloWebinario: "Webinário",
  semWebinarios: "Nenhum webinário publicado ainda.",
  foraDaLista: "Webinário fora da lista",
  erroWebinario: "Escolha o webinário.",
  erroAcao: "Escolha o que o aluno fez no webinário.",
  soNoSegmento: "A regra do webinário vale só em quem recebe: no “Para quem” de avisos e pop-ups ou no “Quem entra” de um fluxo.",
  acoes: {
    attended: "compareceu",
    clicked_no_purchase: "clicou para comprar e não comprou",
    left_before_offer: "saiu antes do card de compra",
    offer_seen: "viu o card de compra",
    purchased: "comprou pelo card",
    registered: "garantiu vaga",
    watched_replay: "viu o replay"
  },
  negadas: {
    attended: "não compareceu",
    clicked_no_purchase: "comprou ou não clicou para comprar",
    left_before_offer: "não saiu antes do card de compra",
    offer_seen: "não viu o card de compra",
    purchased: "não comprou pelo card",
    registered: "não garantiu vaga",
    watched_replay: "não viu o replay"
  },
  plural: {
    attended: "compareceram",
    clicked_no_purchase: "clicaram para comprar e não compraram",
    left_before_offer: "saíram antes do card de compra",
    offer_seen: "viram o card de compra",
    purchased: "compraram pelo card",
    registered: "garantiram vaga",
    watched_replay: "viram o replay"
  },
  pluralNegadas: {
    attended: "não compareceram",
    clicked_no_purchase: "compraram ou não clicaram para comprar",
    left_before_offer: "não saíram antes do card de compra",
    offer_seen: "não viram o card de compra",
    purchased: "não compraram pelo card",
    registered: "não garantiram vaga",
    watched_replay: "não viram o replay"
  },
  /** "compareceram em “Live de agentes”"; sem o titulo (webinario apagado ou fora da lista), "em um webinário removido". */
  descrever: (acao: string, titulo: string | null) => (titulo ? `${acao} em “${titulo}”` : `${acao} em ${WEBINARIO_REMOVIDO}`),
  webinarioRemovido: WEBINARIO_REMOVIDO,
  notaNegada: "Com “não”, só conta quem garantiu vaga ou passou pelo webinário.",
  /** A nota do topo do aviso novo que veio do relatorio do webinario (o "Avisar quem faltou"). */
  inicioDoAviso: "O “Para quem” já vem com a regra do webinário. Confira e escreva o aviso: nada foi salvo ainda.",
  atraso: "A compra entra pelo webhook de venda em até alguns minutos; o pop-up confere o segmento de novo a cada 15 min."
} as const;
