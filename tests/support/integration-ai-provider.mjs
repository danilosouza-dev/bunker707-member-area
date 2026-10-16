// Provedor de IA falso para os testes de integracao (docs/18 §2.5). Entra no lugar de
// src/server/ai/provider-adapter.ts pelos hooks: o pool de conexoes, os limites, a gravacao das
// mensagens e as citacoes continuam de verdade no banco local; so a chamada HTTP ao provedor
// (Gemini, OpenAI, Claude ou o gateway) e trocada por uma resposta combinada pelo teste.
//
// Uso: `provedorFalso.responder = ({ system, messages, config }) => "texto"` (ou lancar um
// AIProviderError); cada chamada fica em `provedorFalso.chamadas`.

// A classe de erro e redeclarada aqui (mesma forma da original) porque este arquivo e carregado
// antes de os hooks entrarem; quem importa "@/server/ai/provider-adapter" recebe esta.
export class AIProviderError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.scope = options.scope ?? "connection";
  }
}

export const provedorFalso = {
  chamadas: [],
  responder: () => "Resposta de teste.",
  zerar() {
    this.chamadas = [];
    this.responder = () => "Resposta de teste.";
  }
};

export async function generateAIText({ config, messages, system }) {
  provedorFalso.chamadas.push({ config, messages, system });
  const text = await provedorFalso.responder({ config, messages, system });

  if (typeof text !== "string" || !text.trim()) {
    throw new AIProviderError("A conta conectada nao retornou texto para esta solicitacao.", "empty_provider_response", { scope: "provider" });
  }

  return { gatewayRequestId: null, inputTokens: system.length, outputTokens: text.length, text };
}
