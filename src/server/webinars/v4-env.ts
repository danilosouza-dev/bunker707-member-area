// O ambiente da fase 4 dos webinarios (docs/30 §6.6 e .env.example): o Assistente de IA (4c) e a traducao (4f) so
// ligam com "on". Sem o env, o editor, o console e a sala escondem a funcao com uma frase (WEBINAR_COPY) e nada quebra.
// Modulo puro (sem "server-only"): os testes passam o ambiente por parametro. Nenhum valor daqui vai para o navegador
// nem leva NEXT_PUBLIC_.

type Env = Record<string, string | undefined>;

function isOn(value: string | undefined) {
  return value?.trim().toLowerCase() === "on";
}

/** WEBINAR_ASSISTANT_ENABLED=on: o Assistente pode responder (ainda depende do webinario e do gateway de IA). */
export function webinarAssistantEnabled(env: Env = process.env): boolean {
  return isOn(env.WEBINAR_ASSISTANT_ENABLED);
}

/** WEBINAR_TRANSLATION_ENABLED=on: a sala pode pedir a traducao (ainda depende do gateway de IA). */
export function webinarTranslationEnabled(env: Env = process.env): boolean {
  return isOn(env.WEBINAR_TRANSLATION_ENABLED);
}
