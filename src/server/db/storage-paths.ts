// Arquivos do Storage guardados pelo caminho, nunca pelo endereco inteiro (docs/32 §11.5): o banco guarda
// "/storage/v1/object/public/<bucket>/<caminho>" (o caminho publico do Storage, sem a origem) e toda leitura devolve o
// endereco inteiro montado com o endereco do Supabase configurado ao rodar. Assim a Instalacao muda de endereco sem
// migrar dados, e o fundador nunca precisa de uma migracao de dados depois.
//
// Onde acontece: no transporte dos clientes do servidor (getSupabaseAdminClient e createSupabaseServerClient passam
// createStoragePathsFetch como `global.fetch`). So os pedidos ao PostgREST (/rest/v1/) mudam:
// - no que vai ao banco (insert, update, upsert, rpc), todo texto JSON que COMECA com "<base>/storage/v1/object/public/"
//   ou "<base>/storage/v1/render/image/public/" perde a base (<base> = o endereco do Supabase configurado). Endereco
//   de outra origem (YouTube, Vimeo, imagem externa, outro projeto do Supabase), endereco assinado
//   (/object/sign/, temporario) e texto que so CITA um endereco no meio ficam como vieram;
// - no que volta do banco (JSON), todo texto que comeca com "/storage/v1/object/public/" ou
//   "/storage/v1/render/image/public/" ganha a base. O endereco inteiro antigo (de antes desta regra, ou de outra
//   origem) volta como esta: as duas formas valem na leitura, antes, durante e depois da conversao dos dados
//   (supabase/dados/202611120001_midia_pelo_caminho.sql).
// Por isso o resto do app so ve enderecos inteiros, iguais aos de antes: os schemas que exigem https://, o
// otimizador de imagens, a limpeza dos arquivos e o navegador nao mudam. A troca e exata nas duas pontas (a mesma
// base sai e volta), entao nenhum texto se perde. Um filtro com endereco na URL do pedido (.eq("image", url)) nao e
// convertido: compare por id ou pelo caminho.
//
// Fica de fora: o pedido as tabelas de STORAGE_PATHS_SKIPPED_TABLES (links colados pela equipe, com check https://
// no banco), o Auth, o Storage e as funcoes (outros caminhos que nao /rest/v1/) e o cliente do navegador (so login).
// Modulo puro (sem "server-only", sem aliases): o servidor, os testes e os scripts carregam direto pelo Node.

/** Os caminhos publicos do Storage (objeto e imagem transformada) que o banco guarda sem a base. */
export const STORAGE_PUBLIC_ROUTES = ["/storage/v1/object/public/", "/storage/v1/render/image/public/"] as const;

/**
 * Tabelas cujo pedido vai e volta como esta: webinar_offer_variants guarda a imagem e o checkout da Oferta como links
 * colados, com check `^https://` no banco (202610300003); o caminho guardado nao passaria nele.
 */
// webinar_screen_items (Webinarios v7, "Na tela"): a imagem ja e so o caminho no bucket, e link_url e o link de clique
// do banner e do QR Code, com check https:// (um link para um arquivo nosso viraria caminho e seria recusado).
export const STORAGE_PATHS_SKIPPED_TABLES: readonly string[] = ["webinar_offer_variants", "webinar_screen_items"];

const ROUTES_PATTERN = "/storage/v1/(?:object|render/image)/public/";
/** Nome de maquina so com [a-z0-9.-] (ou IPv6 entre colchetes): a base entra no texto JSON e nada pode sair das aspas. */
const SAFE_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$|^\[[0-9a-f:.]+\]$/;
const SAFE_BASE_PATH = /^(?:\/[A-Za-z0-9._~-]+)*\/?$/;
const PUBLIC_ROUTE_IN_JSON = new RegExp(`(?<!\\\\)"(${ROUTES_PATTERN})`, "g");

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * A base do Supabase (origem e, se houver, o caminho, sem barra no fim): http(s), sem usuario, senha, query nem
 * fragmento, nome de maquina so com [a-z0-9.-]. null = nao serve, e nada e convertido. A mesma normalizacao do
 * URL do WHATWG que o supabase-js usa no getPublicUrl (maquina minuscula, sem a porta padrao).
 */
export function storageBaseOf(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text || text.length > 2_048) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.search || url.hash) {
    return null;
  }

  if (!SAFE_HOSTNAME.test(url.hostname) || !SAFE_BASE_PATH.test(url.pathname)) {
    return null;
  }

  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** O valor e o caminho guardado de um arquivo do Storage ("/storage/v1/object/public/..." ou ".../render/image/public/..."). */
export function isStoredStorageUrl(value: unknown): value is string {
  return typeof value === "string" && STORAGE_PUBLIC_ROUTES.some((route) => value.startsWith(route));
}

/** O que o banco guarda: o endereco inteiro do nosso Storage (na base dada) vira o caminho; outro valor volta igual. */
export function toStoredStorageUrl(value: string, base: string | null | undefined): string {
  if (!base || !value.startsWith(base)) {
    return value;
  }

  const rest = value.slice(base.length);

  return STORAGE_PUBLIC_ROUTES.some((route) => rest.startsWith(route)) ? rest : value;
}

/** O que a leitura devolve: o caminho guardado vira o endereco inteiro na base dada; outro valor volta igual. */
export function toPublicStorageUrl(value: string, base: string | null | undefined): string {
  return base && isStoredStorageUrl(value) ? `${base}${value}` : value;
}

/**
 * Texto JSON que vai ao banco: todo texto que comeca com "<base>/storage/v1/(object|render/image)/public/" perde a
 * base. So o comeco de um texto JSON conta (a aspa de abertura, nunca uma aspa escapada dentro de outro texto).
 */
export function storedJsonText(text: string, base: string | null | undefined): string {
  if (!base || !text.includes(`"${base}/storage/v1/`)) {
    return text;
  }

  return text.replace(new RegExp(`(?<!\\\\)"${escapeRegExp(base)}(${ROUTES_PATTERN})`, "g"), (_match, route: string) => `"${route}`);
}

/** Texto JSON que volta do banco: todo texto que comeca com o caminho publico do Storage ganha a base. */
export function publicJsonText(text: string, base: string | null | undefined): string {
  if (!base || !text.includes('"/storage/v1/')) {
    return text;
  }

  return text.replace(PUBLIC_ROUTE_IN_JSON, (_match, route: string) => `"${base}${route}`);
}

/** A tabela (ou "rpc") de um pedido ao PostgREST; null = nao e /rest/v1/ (Auth, Storage, funcoes) ou o alvo e um Request. */
function restTargetOf(input: unknown): string | null {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : null;

  if (!href) {
    return null;
  }

  let pathname: string;

  try {
    pathname = new URL(href).pathname;
  } catch {
    return null;
  }

  const index = pathname.indexOf("/rest/v1/");

  return index === -1 ? null : (pathname.slice(index + "/rest/v1/".length).split("/")[0] ?? "");
}

async function withPublicStorageUrls(response: Response, base: string): Promise<Response> {
  const type = response.headers.get("content-type") ?? "";

  if (!response.body || response.status === 204 || response.status === 205 || response.status === 304 || !/json/i.test(type)) {
    return response;
  }

  const text = await response.text();
  const headers = new Headers(response.headers);

  // O corpo mudou de tamanho e ja chega descomprimido.
  headers.delete("content-length");
  headers.delete("content-encoding");

  return new Response(publicJsonText(text, base), { headers, status: response.status, statusText: response.statusText });
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * O fetch dos clientes do servidor: nos pedidos ao PostgREST, o endereco inteiro do nosso Storage vira o caminho no
 * que vai ao banco, e o caminho vira o endereco inteiro no que volta. `supabaseUrl` e o endereco do Supabase que o app
 * usa (o mesmo do getPublicUrl); sem um endereco valido, nada muda. `baseFetch` e so para os testes (o padrao e o
 * fetch global da hora do pedido, com o que o Next e o Sentry poem nele).
 */
export function createStoragePathsFetch(supabaseUrl: string | null | undefined, baseFetch?: FetchLike): typeof fetch {
  const base = storageBaseOf(supabaseUrl);
  const call: FetchLike = (input, init) => (baseFetch ?? globalThis.fetch)(input, init);

  const storagePathsFetch: FetchLike = async (input, init) => {
    const table = base ? restTargetOf(input) : null;

    if (!base || table === null || STORAGE_PATHS_SKIPPED_TABLES.includes(table)) {
      return call(input, init);
    }

    const body = typeof init?.body === "string" ? storedJsonText(init.body, base) : init?.body;
    const response = await call(input, init && body !== init.body ? { ...init, body } : init);

    return withPublicStorageUrls(response, base);
  };

  return storagePathsFetch as typeof fetch;
}
