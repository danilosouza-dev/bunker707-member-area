// A chave da traducao guardada (docs/30 §1.6; webinar_text_translations.source_hash, migracao 202610290009): o sha256
// do texto normalizado (NFC, espacos juntados, sem as pontas). A mesma mensagem do roteiro repetida em cada sessao, a
// linha mestre e as mensagens iguais caem na mesma chave e traduzem uma vez so. Modulo puro (node:crypto, sem
// "server-only"): a rota, o after() e os testes usam a mesma conta. Nunca importar em codigo do navegador.

import { createHash } from "node:crypto";

export function normalizeTranslationText(text: string): string {
  return text.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function translationSourceHash(text: string): string {
  return createHash("sha256").update(normalizeTranslationText(text)).digest("hex");
}
