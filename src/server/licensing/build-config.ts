// O modo da licenca, as raizes confiaveis e o endereco do Emissor vem do build (docs/32 §11.3 e D9).
//
// next.config.ts passa BUNKER_LICENSING_MODE, BUNKER_LICENSING_ROOTS e BUNKER_LICENSING_EMISSOR_URL pela chave `env`,
// e o Next troca cada `process.env.BUNKER_LICENSING_*` abaixo pelo texto na hora de gerar a imagem, no codigo do
// servidor tambem.
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

/** O unico endereco sem https aceito: o Emissor de teste ou de ensaio na propria maquina. */
const LOCAL_TEST_HOST = "127.0.0.1";

/**
 * Le o endereco da API publica do Emissor (docs/protocolo.md do bunker-licensing, por exemplo
 * `https://licencas-api.bunker707.com.br`). So https, sem usuario, senha, busca nem ancora; a unica excecao e
 * `http://127.0.0.1` (com porta ou sem), para os testes e o ensaio local. Endereco fora disso vale como ausente: o
 * cliente fica "nao configurado" e nunca fala com um endereco errado. Devolve a origem mais o caminho, sem a barra final.
 */
export function parseEmissorBaseUrl(raw: string | undefined): string | null {
  const text = raw?.trim();

  if (!text || text.length > 300) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const secure = url.protocol === "https:";
  const localTest = url.protocol === "http:" && url.hostname === LOCAL_TEST_HOST;

  if ((!secure && !localTest) || url.username || url.password || url.search || url.hash || text.includes("?") || text.includes("#")) {
    return null;
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** O endereco do Emissor gravado no build; null sem a variavel (a nossa escola hoje, a `dev`, a Vercel e os testes). */
export function emissorBaseUrl(): string | null {
  return parseEmissorBaseUrl(process.env.BUNKER_LICENSING_EMISSOR_URL);
}

// ---- O build (next.config.ts) ------------------------------------------------------------------------

export type LicensingBuildEnv = {
  BUNKER_LICENSING_MODE: LicensingMode;
  BUNKER_LICENSING_ROOTS: string;
  BUNKER_LICENSING_EMISSOR_URL: string;
};

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * 43 caracteres base64url sao 32 bytes canonicos so quando o ultimo nao carrega bits a mais (os 2 bits de baixo zerados).
 * Sem Buffer: este arquivo tambem entra no codigo do instrumentation.ts, que o Next pode gerar para o runtime de borda.
 */
function canonicalKeyText(publicKey: string): boolean {
  return BASE64URL_ALPHABET.indexOf(publicKey.charAt(42)) % 4 === 0;
}

/** As raizes do build, sem perdoar nada: de 1 a 4, todas no formato, sem rid repetido e com 32 bytes canonicos. */
function strictBuildRoots(raw: string): boolean {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 4) {
    return false;
  }

  const roots = parseTrustedRoots(raw);

  return roots.length === parsed.length && roots.every((root) => canonicalKeyText(root.publicKey));
}

/**
 * O que o next.config.ts grava pela chave `env` (docs/32 §11.3). Sem a variavel do modo, ou com ela vazia (o Dockerfile
 * declara as tres vazias quando o build nao as recebe), sai "off" e o resto como veio: a nossa escola, a `dev`, a Vercel e
 * os testes buildam exatamente como antes. O build falha, em vez de sair "off" em silencio (revisao de 11/11/2026):
 * - com o modo em qualquer outro texto que nao "", "off" ou "enforce" (um erro de digitacao gerava a imagem sem licenca);
 * - com "enforce" sem raizes validas (de 1 a 4, nenhuma descartada) ou sem o endereco do Emissor em https (a imagem nunca
 *   ativaria; o http://127.0.0.1 dos testes nao vale no build).
 */
export function licensingBuildEnv(env: Readonly<Record<string, string | undefined>>): LicensingBuildEnv {
  const mode = env.BUNKER_LICENSING_MODE ?? "";
  const roots = env.BUNKER_LICENSING_ROOTS ?? "";
  const emissorUrl = env.BUNKER_LICENSING_EMISSOR_URL ?? "";

  if (mode !== "" && mode !== "off" && mode !== "enforce") {
    throw new Error(
      `Licenca: BUNKER_LICENSING_MODE tem de ser vazio, "off" ou "enforce" (veio ${JSON.stringify(mode.slice(0, 40))}). ` +
        "O build parou para a imagem nao sair sem a exigencia da licenca por engano (docs/32 §11.3)."
    );
  }

  if (mode !== "enforce") {
    return { BUNKER_LICENSING_MODE: "off", BUNKER_LICENSING_ROOTS: roots, BUNKER_LICENSING_EMISSOR_URL: emissorUrl };
  }

  if (!strictBuildRoots(roots)) {
    throw new Error(
      'Licenca: com BUNKER_LICENSING_MODE=enforce, BUNKER_LICENSING_ROOTS tem de trazer de 1 a 4 raizes validas, sem repetir o rid: [{"rid":"raiz-2026","publicKey":"<32 bytes em base64url>"}].'
    );
  }

  const emissor = parseEmissorBaseUrl(emissorUrl);

  if (!emissor || !emissor.startsWith("https://")) {
    throw new Error("Licenca: com BUNKER_LICENSING_MODE=enforce, BUNKER_LICENSING_EMISSOR_URL tem de ser o endereco https da API do Emissor.");
  }

  return { BUNKER_LICENSING_MODE: "enforce", BUNKER_LICENSING_ROOTS: roots, BUNKER_LICENSING_EMISSOR_URL: emissorUrl };
}
