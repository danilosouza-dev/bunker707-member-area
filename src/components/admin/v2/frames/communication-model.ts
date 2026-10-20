// Regras puras de Comunicacao (prototipo aprovado, telas "Avisos e pop-ups", "Webinários" e
// "Promoções"). Sem React: tests/admin-frames.test.mjs carrega este arquivo direto pelo Node.
//
// Avisos e pop-ups ja e a tela de verdade (docs/22): os quatro numeros vem do banco
// (communication_overview). Webinarios e Promocoes ainda nao existem (docs/17 §1.8): a moldura mostra
// o cabecalho, as abas e os quatro numeros em "—", e um aviso honesto no lugar da lista. Nenhum
// numero, webinario ou promocao de exemplo.

import type { KpiValueFormat } from "../format";
import type { ResolvedAdminPeriod } from "../period";

export const COMMUNICATION_TABS = ["avisos", "webinarios", "promocoes"] as const;
export type CommunicationTab = (typeof COMMUNICATION_TABS)[number];

export const COMMUNICATION_TITLE = "Comunicação";

/** Primeira aba: /admin/comunicacao abre nela. */
export const COMMUNICATION_HOME_HREF = "/admin/comunicacao/avisos";

type CommunicationTabMeta = {
  /** Frase de apoio do cabecalho, a mesma do prototipo para a aba. */
  description: string;
  href: string;
  label: string;
  /** Fase do docs/17 em que a aba chega. So vai para data-phase, nunca para o texto. */
  phase: number;
  /** Titulo do aviso no lugar da lista. */
  upcomingTitle: string;
};

export const COMMUNICATION_TAB_META: Record<CommunicationTab, CommunicationTabMeta> = {
  avisos: {
    description: "Notificações no sino e pop-ups na home do aluno, cada um para um segmento.",
    href: "/admin/comunicacao/avisos",
    label: "Avisos e pop-ups",
    phase: 5,
    upcomingTitle: "Os avisos e pop-ups estão a caminho"
  },
  promocoes: {
    description: "Selo, preço e prazo no card bloqueado, com cliques rastreados até o checkout.",
    href: "/admin/comunicacao/promocoes",
    label: "Promoções",
    phase: 6,
    upcomingTitle: "As promoções estão a caminho"
  },
  webinarios: {
    description: "Lives com inscrição, lembretes de 24 h e 1 h e o replay que vira aula.",
    href: "/admin/comunicacao/webinarios",
    label: "Webinários",
    phase: 5,
    upcomingTitle: "Os webinários estão a caminho"
  }
};

export type CommunicationKpi = {
  /** O que o numero conta, na linha de baixo do cartao (so nas abas com numero de verdade). */
  definition?: string;
  /** Versao curta da definicao, para o cartao estreito. */
  definitionShort?: string;
  format: KpiValueFormat;
  label: string;
};

/**
 * Periodo curto para o rotulo de um numero ("Vistos em 30 dias"): o rotulo do cartao tem uma linha so,
 * entao o intervalo do calendario vira "no período" (o periodo inteiro aparece no botao da barra).
 */
export function describeCommunicationPeriod(period: Pick<ResolvedAdminPeriod, "days" | "period">) {
  if (period.period.kind === "range") {
    return "no período";
  }

  switch (period.period.preset) {
    case "hoje":
      return "hoje";
    case "1d":
      return "em 24 horas";
    default:
      return `em ${period.days} dias`;
  }
}

/**
 * Os quatro numeros de cada aba, com os rotulos do prototipo. Sem dado, o cartao mostra "—". Avisos
 * traz a definicao de cada um (docs/22 §2.1): ativos = pop-ups no ar + notificacoes agendadas ou
 * enviando; vistos e cliques no periodo; voltaram a estudar = viram e estudaram em 7 dias.
 */
export function getCommunicationKpis(tab: CommunicationTab, period: Pick<ResolvedAdminPeriod, "days" | "period">): CommunicationKpi[] {
  switch (tab) {
    case "avisos":
      return [
        { definition: "Pop-ups no ar e notificações agendadas", definitionShort: "No ar e agendados", format: "number", label: "Avisos ativos" },
        {
          definition: "No sino e nos pop-ups",
          definitionShort: "Sino e pop-ups",
          format: "number",
          label: `Vistos ${describeCommunicationPeriod(period)}`
        },
        { definition: "Cliques ÷ vistos no período", definitionShort: "Cliques ÷ vistos", format: "percent", label: "Taxa de clique" },
        {
          definition: "Viram e estudaram em até 7 dias",
          definitionShort: "Estudaram em 7 dias",
          format: "number",
          label: "Voltaram a estudar"
        }
      ];
    case "webinarios":
      return [
        { format: "number", label: "Próximos" },
        { format: "number", label: "Inscritos" },
        { format: "percent", label: "Comparecimento" },
        { format: "number", label: "Replays" }
      ];
    case "promocoes":
      return [
        { format: "number", label: "Ativas" },
        { format: "number", label: "Cliques no checkout" },
        { format: "percent", label: "Taxa de clique" },
        { format: "number", label: "Terminam em 7 dias" }
      ];
  }
}
