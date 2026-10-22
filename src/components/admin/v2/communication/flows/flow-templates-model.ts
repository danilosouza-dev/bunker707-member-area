// Modelos do construtor de fluxos (docs/23 §2.5): "Para quem não abriu", "Boas-vindas a quem ganhou
// acesso", "Promoção com prazo" e "Começar do zero". Cada um monta um rascunho no navegador (nada e gravado
// ate "Salvar rascunho"); os textos sao editaveis. O produto ("[escolha o produto]") fica vazio: as regras
// com produto e o botao que leva ao produto pedem a escolha antes de gravar (o zod recusa a lista vazia e o
// botao sem destino) e validateFlowTree marca o produto que falta antes de ativar.
//
// Modulo puro (sem React, imports relativos, sem enums): tests/comunicacao-fluxos-tela.test.mjs carrega
// direto pelo Node e confere cada modelo com validateFlowTree.

import { EVERYONE, type AudienceDefinition, type AudienceRule } from "../../../../../server/communications/audience-model";
import type { FlowDraft, FlowNodeDraft, FlowNoticeContent } from "../../../../../server/communications/flow-schemas";
import { NOTICE_ICON_SUGGESTED_COLOR, type NoticeIconId } from "../../../../../server/communications/message-meta";

export type FlowTemplateId = "blank" | "deadline" | "unopened" | "welcome";

export type FlowTemplate = {
  /** Uma frase sobre quando usar. */
  description: string;
  id: FlowTemplateId;
  /** O caminho em poucas palavras, no cartao. */
  steps: string;
  title: string;
};

export const FLOW_TEMPLATES: readonly FlowTemplate[] = [
  {
    description: "Uma notificação com botão e, um dia depois, outra para quem viu no sino e não abriu.",
    id: "unopened",
    steps: "Notificação → Esperar 1 dia → Condição → Notificação",
    title: "Para quem não abriu"
  },
  {
    description: "Quem ganha acesso a um produto recebe as boas-vindas e, se não estudar em 2 dias, um empurrão.",
    id: "welcome",
    steps: "Notificação → Esperar 2 dias → Condição → Notificação",
    title: "Boas-vindas a quem ganhou acesso"
  },
  {
    description: "Uma condição especial com prazo, outra notificação 3 horas antes de acabar e um recado para quem não clicou.",
    id: "deadline",
    steps: "Notificação → Esperar 1 dia → Condição → Notificação",
    title: "Promoção com prazo"
  },
  {
    description: "Só o “Quem entra”. Você monta os passos.",
    id: "blank",
    steps: "Quem entra",
    title: "Começar do zero"
  }
];

/** Nome do fluxo de um modelo (o de "Começar do zero" e trocado pelo produtor). */
export const BLANK_FLOW_NAME = "Novo fluxo";

const DAY_MINUTES = 1_440;

function rules(...items: AudienceRule[]): AudienceDefinition {
  return { kind: "rules", root: { items, match: "all" } };
}

// v3a: toda mensagem de modelo nasce com reacoes e com a lixeira do sino, como a notificacao nova.
function content(title: string, extra: Partial<FlowNoticeContent> = {}): FlowNoticeContent {
  return {
    allowHide: true,
    audio: null,
    body: "",
    cta: null,
    icon: null,
    image: null,
    reactions: true,
    response: null,
    sender: null,
    title,
    validity: { mode: "default" },
    ...extra
  };
}

function icon(id: NoticeIconId): FlowNoticeContent["icon"] {
  return { color: NOTICE_ICON_SUGGESTED_COLOR[id], id };
}

function days(count: number): FlowNoticeContent["validity"] {
  return { minutes: count * DAY_MINUTES, mode: "duration" };
}

/** Botao para o produto ainda nao escolhido ("[escolha o produto]"). */
function productButton(label: string): FlowNoticeContent["cta"] {
  return { href: "", label, target: "same_tab" };
}

type MessageNode = Extract<FlowNodeDraft, { kind: "message" }>;
type ConditionNode = Extract<FlowNodeDraft, { kind: "condition" }>;

function message(id: string, parentId: string, extra: Partial<MessageNode> = {}): MessageNode {
  return { anchor: "previous", anchorNodeId: null, branch: null, filter: null, id, kind: "message", offsetMinutes: 0, parentId, position: 0, ...extra };
}

function condition(id: string, parentId: string, definition: AudienceDefinition, extra: Partial<ConditionNode> = {}): ConditionNode {
  return {
    anchor: "previous",
    anchorNodeId: null,
    branch: null,
    condition: definition,
    id,
    kind: "condition",
    maxWaitMinutes: null,
    offsetMinutes: 0,
    parentId,
    position: 0,
    waitUntilTrue: false,
    ...extra
  };
}

/**
 * Rascunho de um modelo. `newId` gera os ids dos passos (crypto.randomUUID no navegador; nos testes, uma
 * sequencia fixa). Os passos vem em pre-ordem (pai antes do filho), como o construtor grava.
 */
export function buildFlowTemplate(id: FlowTemplateId, newId: () => string): FlowDraft {
  const entryId = newId();
  const entry: FlowNodeDraft = { branch: null, id: entryId, kind: "entry", parentId: null, position: 0 };

  switch (id) {
    case "unopened": {
      const first = newId();
      const check = newId();
      const second = newId();

      return {
        entry: { audience: EVERYONE, mode: "current" },
        goal: null,
        messages: {
          [first]: content("Novidade na área", {
            body: "Tem coisa nova esperando por você na área de membros.",
            cta: productButton("Ver agora"),
            icon: icon("sparkles"),
            validity: days(7)
          }),
          [second]: content("Você viu a novidade?", { body: "Ela continua esperando por você. Leva só um minuto.", icon: icon("sparkles"), validity: days(3) })
        },
        name: "Para quem não abriu",
        nodes: [
          entry,
          message(first, entryId),
          // Quem nem abriu o sino fica de fora: vai ver a primeira quando abrir.
          condition(
            check,
            first,
            rules({ action: "seen", negate: false, ref: { kind: "node", nodeId: first }, type: "message" }, { action: "opened", negate: true, ref: { kind: "node", nodeId: first }, type: "message" }),
            { offsetMinutes: DAY_MINUTES }
          ),
          message(second, check, { branch: "yes" })
        ],
        origin: "builder"
      };
    }
    case "welcome": {
      const first = newId();
      const check = newId();
      const second = newId();

      return {
        entry: { audience: rules({ op: "has", productIds: [], type: "product" }), mode: "new_only" },
        goal: null,
        messages: {
          [first]: content("Boas-vindas!", { body: "Que bom ter você aqui. Comece quando quiser: a primeira aula já está liberada.", icon: icon("sparkles") }),
          [second]: content("Comece pela primeira aula", { body: "Dez minutos hoje já fazem diferença. A primeira aula está esperando por você.", icon: icon("lesson") })
        },
        name: "Boas-vindas a quem ganhou acesso",
        nodes: [
          entry,
          message(first, entryId),
          condition(check, first, rules({ days: 2, op: "within", type: "last_study" }), { offsetMinutes: 2 * DAY_MINUTES }),
          message(second, check, { branch: "no" })
        ],
        origin: "builder"
      };
    }
    case "deadline": {
      const first = newId();
      const check = newId();
      const reminder = newId();
      const other = newId();

      return {
        entry: { audience: rules({ op: "has_not", productIds: [], type: "product" }), mode: "current" },
        goal: rules({ op: "has", productIds: [], type: "product" }),
        messages: {
          [first]: content("Condição especial até sexta", {
            body: "Uma condição especial para você entrar agora. Vale só até sexta.",
            cta: productButton("Ver a condição"),
            icon: icon("promo"),
            validity: days(3)
          }),
          // "Até “Condição especial…” sumir": sai do sino junto com a notificacao da oferta.
          [reminder]: content("Faltam 3 horas", { body: "A condição especial acaba daqui a pouco.", icon: icon("clock"), validity: { mode: "with_anchor" } }),
          [other]: content("Você ainda pode aproveitar", { body: "A condição especial continua valendo até sexta.", icon: icon("promo") })
        },
        name: "Promoção com prazo",
        nodes: [
          entry,
          message(first, entryId),
          condition(check, first, rules({ action: "clicked", negate: false, ref: { kind: "node", nodeId: first }, type: "message" }), { offsetMinutes: DAY_MINUTES }),
          message(reminder, check, { anchor: "expires", anchorNodeId: first, branch: "yes", offsetMinutes: 180 }),
          message(other, check, { branch: "no" })
        ],
        origin: "builder"
      };
    }
    default:
      return { entry: { audience: EVERYONE, mode: "current" }, goal: null, messages: {}, name: BLANK_FLOW_NAME, nodes: [entry], origin: "builder" };
  }
}
