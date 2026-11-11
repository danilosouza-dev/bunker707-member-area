// A configuracao da API interna do Emissor, lida do ambiente do servidor ao rodar (docs/32 §2.4, §11.2 e §11.10).
//
// As paginas e tarefas de vendedor (Minhas licencas, a fila da venda ao Emissor, a marca Bunker Members no produto) so
// existem com esta configuracao. Ela mora so no servidor da nossa escola:
// - EMISSOR_INTERNO_URL: o endereco da API interna (https; com ou sem /interno/v1 no fim; http://127.0.0.1 so nos testes
//   e no ensaio local);
// - EMISSOR_INTERNO_CREDENCIAL: a credencial estreita da nossa area (docs/32 §11.2: so pede, nunca emite, estende nem
//   revoga a mao). De 32 a 512 caracteres, sem espaco. Nunca vai para log, para erro devolvido nem para o navegador;
// - EMISSOR_INTERNO_SIMULADOR=on: o simulador em memoria (simulator.ts) no lugar do Emissor, so fora da producao (o
//   `next dev`, os testes e a previa da Vercel, a `dev`), so no modo "off" da licenca e so sem a configuracao de verdade.
//
// Nenhuma leva NEXT_PUBLIC_: nada disto vai ao navegador. E e de proposito que sao variaveis lidas ao rodar, e nao
// gravadas no build como o modo da licenca: a copia do comprador nunca tem uma credencial valida (so o Emissor emite, e
// so para a nossa escola), entao pôr a variavel la nao liga nada que funcione; e, no modo "enforce", a pagina ainda pede
// a chave interna `seller-pages` na licenca assinada (seller.ts), que so a nossa licenca traz.
//
// Modulo puro: le o objeto de ambiente que recebe (os testes passam o deles).

/** O caminho da API interna no Emissor. */
export const INTERNAL_API_PATH = "/interno/v1";

/** O unico endereco sem https aceito: o Emissor (ou o falso dos testes) na propria maquina. */
const LOCAL_TEST_HOST = "127.0.0.1";

const CREDENTIAL_PATTERN = /^[\x21-\x7e]{32,512}$/;

export type InternalEmissorConfig =
  | { mode: "http"; baseUrl: string; credential: string }
  | { mode: "simulador" }
  | { mode: "desligado"; reason: InternalDisabledReason };

/**
 * Por que esta desligado: sem_configuracao (nenhuma variavel: a copia do comprador, a nossa escola antes do Emissor), ou
 * configuracao_invalida (o endereco ou a credencial fora do formato: vale como ausente, nunca fala com endereco errado).
 */
export type InternalDisabledReason = "sem_configuracao" | "configuracao_invalida";

/**
 * O endereco da API interna, com /interno/v1 no fim: so https (ou http://127.0.0.1), sem usuario, senha, busca nem ancora.
 * Aceita a origem sozinha (https://licencas-api.exemplo) e a origem com o caminho. Fora disso, null.
 */
export function parseInternalBaseUrl(raw: string | undefined): string | null {
  const text = raw?.trim();

  if (!text || text.length > 300 || text.includes("?") || text.includes("#")) {
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

  if ((!secure && !localTest) || url.username || url.password) {
    return null;
  }

  const path = url.pathname.replace(/\/+$/, "");
  const base = path.endsWith(INTERNAL_API_PATH) ? path : `${path}${INTERNAL_API_PATH}`;

  return `${url.origin}${base}`;
}

/** A credencial, sem espacos nas pontas; fora do formato, null (nunca devolve o texto recusado). */
export function parseInternalCredential(raw: string | undefined): string | null {
  const text = raw?.trim();
  return text && CREDENTIAL_PATTERN.test(text) ? text : null;
}

/**
 * O simulador so vale fora da producao: no `next dev` e nos testes (NODE_ENV diferente de production) ou na previa da
 * Vercel (VERCEL_ENV preview ou development). A nossa producao e a copia do comprador rodam com NODE_ENV=production e sem
 * VERCEL_ENV: nunca.
 */
export function simulatorAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.EMISSOR_INTERNO_SIMULADOR?.trim() !== "on") {
    return false;
  }

  if (env.NODE_ENV !== "production") {
    return true;
  }

  const vercel = env.VERCEL_ENV?.trim();
  return vercel === "preview" || vercel === "development";
}

/** A configuracao deste servidor. A de verdade vence o simulador; o simulador nunca liga no modo "enforce". */
export function readInternalEmissorConfig(
  env: Readonly<Record<string, string | undefined>>,
  licensing: { mode: "off" | "enforce" }
): InternalEmissorConfig {
  const rawUrl = env.EMISSOR_INTERNO_URL?.trim();
  const rawCredential = env.EMISSOR_INTERNO_CREDENCIAL?.trim();

  if (rawUrl || rawCredential) {
    const baseUrl = parseInternalBaseUrl(rawUrl);
    const credential = parseInternalCredential(rawCredential);

    return baseUrl && credential ? { baseUrl, credential, mode: "http" } : { mode: "desligado", reason: "configuracao_invalida" };
  }

  if (licensing.mode === "off" && simulatorAllowed(env)) {
    return { mode: "simulador" };
  }

  return { mode: "desligado", reason: "sem_configuracao" };
}
