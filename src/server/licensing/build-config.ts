// O modo da licenca e as raizes confiaveis vem do build (docs/32 §11.3 e D9).
//
// next.config.ts passa BUNKER_LICENSING_MODE e BUNKER_LICENSING_ROOTS pela chave `env`, e o Next troca cada
// `process.env.BUNKER_LICENSING_*` abaixo pelo texto na hora de gerar a imagem, no codigo do servidor tambem.
// Por isso a variavel do conteiner nao muda nada depois: o comprador e dono do compose, e nenhuma variavel
// pode afrouxar a licenca. Nos testes, o Node le a variavel na hora.
//
// - "off": a nossa escola hoje, a `dev` e os testes. Tudo ligado, nada barrado: o comportamento de antes.
// - "enforce": a imagem vendida. Sem licenca valida, so a tela de ativacao.
// So o texto exato "enforce" liga a exigencia. O job do CI que gera a imagem vendida confere que ela saiu com
// "enforce" (docs/32 §11.3, as tres conferencias antes da producao).
//
// Os nomes nunca levam NEXT_PUBLIC_: nada disto vai para o navegador (guarda em tests/licenca-sem-emissor.guard.test.mjs).

import type { TrustedRoot } from "./model";

export type LicensingMode = "off" | "enforce";

export function licensingMode(): LicensingMode {
  return process.env.BUNKER_LICENSING_MODE === "enforce" ? "enforce" : "off";
}

const ROOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Le a lista de raizes (JSON: [{"rid": "...", "publicKey": "..."}]). Entrada que nao segue o formato e
 * ignorada: uma lista vazia so faz toda licenca falhar na conferencia, nunca passar.
 */
export function parseTrustedRoots(raw: string | undefined): TrustedRoot[] {
  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const roots: TrustedRoot[] = [];

  for (const item of parsed.slice(0, 4)) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.rid === "string" &&
      typeof item.publicKey === "string" &&
      ROOT_ID_PATTERN.test(item.rid) &&
      PUBLIC_KEY_PATTERN.test(item.publicKey) &&
      !roots.some((root) => root.rid === item.rid)
    ) {
      roots.push({ rid: item.rid, publicKey: item.publicKey });
    }
  }

  return roots;
}

export function trustedRoots(): TrustedRoot[] {
  return parseTrustedRoots(process.env.BUNKER_LICENSING_ROOTS);
}
