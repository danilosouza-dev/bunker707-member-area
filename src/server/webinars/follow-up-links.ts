// O caminho do relatorio do webinario para um aviso da Comunicacao ja com a regra "Webinário" (docs/30 §3.4, bloco
// Vagas: "lista de faltosos para virar regra da Comunicação"; §1.6 "Follow-up por segmento", 4b). O link abre
// /admin/comunicacao/avisos/novo?webinario=<id>&seguimento=registered,nao-attended e o editor comeca com o "Para quem"
// montado (as regras "webinar_follow_up" no grupo principal, todas valendo: garantiu vaga E nao compareceu), sem gravar nada: e o
// mesmo caminho do "Usar" de um modelo (o editor no modo "start"). Pedido invalido (id que nao e uuid, acao fora da
// lista, repetida ou mais de 4) volta ao aviso em branco. Modulo puro, imports relativos: os testes carregam direto pelo
// Node e a pagina de Novo aviso le com a mesma conta.

import type { AudienceDefinition } from "../communications/audience-model";
import { WEBINAR_FOLLOW_UP_ACTIONS, type WebinarFollowUpAction } from "./model";

/** Os parametros do endereco (em portugues, como ?modelo= e ?tipo= da mesma pagina). */
export const WEBINAR_FOLLOW_UP_PARAMS = { actions: "seguimento", webinar: "webinario" } as const;

/** O prefixo da acao negada no endereco ("nao-attended" = nao compareceu). */
const NEGATED_PREFIX = "nao-";
const MAX_ACTIONS = 4;

export type WebinarFollowUpStep = { action: WebinarFollowUpAction; negate: boolean };

/** "Avisar quem nao veio": garantiu vaga e nao compareceu. */
export const WEBINAR_ABSENTEES: readonly WebinarFollowUpStep[] = [
  { action: "registered", negate: false },
  { action: "attended", negate: true }
];

const NEW_NOTICE_HREF = "/admin/comunicacao/avisos/novo";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ParamValue = string | string[] | undefined;

function single(value: ParamValue): string {
  return typeof value === "string" ? value.trim() : "";
}

/** O aviso novo com estas regras do webinario (todas valendo) no "Para quem". */
export function webinarFollowUpNoticeHref(input: { steps: readonly WebinarFollowUpStep[]; webinarId: string }): string {
  const query = new URLSearchParams({
    [WEBINAR_FOLLOW_UP_PARAMS.webinar]: input.webinarId,
    [WEBINAR_FOLLOW_UP_PARAMS.actions]: input.steps.map((step) => `${step.negate ? NEGATED_PREFIX : ""}${step.action}`).join(",")
  });
  return `${NEW_NOTICE_HREF}?${query.toString()}`;
}

/** O "Para quem" que o endereco pede (as regras do webinario no grupo principal, todas valendo), ou nulo. */
export function webinarFollowUpAudienceOf(params: Record<string, ParamValue>): AudienceDefinition | null {
  const webinarId = single(params[WEBINAR_FOLLOW_UP_PARAMS.webinar]).toLowerCase();
  const parts = single(params[WEBINAR_FOLLOW_UP_PARAMS.actions]).split(",").map((part) => part.trim());

  if (!UUID_PATTERN.test(webinarId) || parts.length === 0 || parts.length > MAX_ACTIONS) {
    return null;
  }

  const steps: WebinarFollowUpStep[] = [];
  for (const part of parts) {
    const negate = part.startsWith(NEGATED_PREFIX);
    const action = negate ? part.slice(NEGATED_PREFIX.length) : part;
    if (!(WEBINAR_FOLLOW_UP_ACTIONS as readonly string[]).includes(action) || steps.some((step) => step.action === action)) {
      return null;
    }
    steps.push({ action: action as WebinarFollowUpAction, negate });
  }

  return { kind: "rules", root: { items: steps.map((step) => ({ action: step.action, negate: step.negate, type: "webinar_follow_up" as const, webinarId })), match: "all" } };
}
