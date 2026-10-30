// O formulario do card Assistente por regras puras (docs/30 §1.6, §2.2, §6.6 e D24; fase 4c): o estado da tela a
// partir do que o banco devolveu, acrescentar e tirar perguntas (com chave estavel para a lista), o que vai para a
// Server Action saveAssistant, os erros do zod por campo e o que o card mostra antes do formulario (ambiente
// desligado, sem conexao de IA). Sem React: o teste de tela le daqui.

import { ASSISTANT_LIMITS, type AssistantKnowledgeItem, type AssistantSettings } from "@/server/webinars/model";

export type KnowledgeForm = { answer: string; id: string | null; key: string; question: string };

export type AssistantForm = { enabled: boolean; items: KnowledgeForm[]; replyAllDefault: boolean };

let nextKey = 0;

function newKey() {
  nextKey += 1;
  return `nova-${nextKey}`;
}

export function assistantFormOf(settings: AssistantSettings, items: readonly AssistantKnowledgeItem[]): AssistantForm {
  return {
    enabled: settings.enabled,
    items: items.map((item) => ({ answer: item.answer, id: item.id, key: item.id, question: item.question })),
    replyAllDefault: settings.replyAllDefault
  };
}

export function canAddKnowledge(form: AssistantForm): boolean {
  return form.items.length < ASSISTANT_LIMITS.knowledgeMax;
}

export function addKnowledge(form: AssistantForm): AssistantForm {
  if (!canAddKnowledge(form)) {
    return form;
  }
  return { ...form, items: [...form.items, { answer: "", id: null, key: newKey(), question: "" }] };
}

export function removeKnowledge(form: AssistantForm, key: string): AssistantForm {
  return { ...form, items: form.items.filter((item) => item.key !== key) };
}

export function updateKnowledge(form: AssistantForm, key: string, patch: Partial<Pick<KnowledgeForm, "answer" | "question">>): AssistantForm {
  return { ...form, items: form.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) };
}

/** O que vai para saveAssistant (linhas totalmente vazias ficam de fora). */
export function assistantSaveInput(form: AssistantForm, webinarId: string) {
  return {
    items: form.items
      .filter((item) => item.question.trim() || item.answer.trim())
      .map((item) => ({ answer: item.answer.trim(), id: item.id, question: item.question.trim() })),
    settings: { enabled: form.enabled, replyAllDefault: form.replyAllDefault },
    webinarId
  };
}

/**
 * Os erros do zod ("items.3.question") por linha do formulario: a posicao conta so as linhas que foram (as vazias
 * ficam de fora do salvar).
 */
export function knowledgeErrorsOf(form: AssistantForm, fieldErrors: Record<string, string[] | undefined> | undefined): Record<string, { answer?: string; question?: string }> {
  const errors: Record<string, { answer?: string; question?: string }> = {};
  const sent = form.items.filter((item) => item.question.trim() || item.answer.trim());
  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const match = /^items\.(\d+)\.(question|answer)$/.exec(path);
    const item = match ? sent[Number(match[1])] : null;
    if (match && item && messages?.[0]) {
      errors[item.key] = { ...errors[item.key], [match[2]]: messages[0] };
    }
  }
  return errors;
}

/** O que o card mostra no lugar do formulario: o ambiente desligado, sem conexao de IA, ou nada (o formulario). */
export function assistantCardNotice(data: { aiAvailable: boolean; envEnabled: boolean }): "ai" | "env" | null {
  if (!data.envEnabled) {
    return "env";
  }
  return data.aiAvailable ? null : "ai";
}
