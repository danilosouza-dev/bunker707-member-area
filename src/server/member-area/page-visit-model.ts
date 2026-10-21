// Visitas das paginas da area do aluno (Comunicacao v2, docs/23): a chave normalizada de cada pagina que
// um fluxo pode acompanhar ("visitou a pagina do produto", "clicou em Comprar"). Modulo puro: sem
// "server-only" e com imports relativos, para tests/visitas-de-pagina-modelo.test.mjs carregar direto
// pelo Node; as paginas do aluno, o beacon, as regras do segmento e o motor usam as mesmas chaves.
//
// A chave nunca carrega query nem hash: /conteudo/x/aulas/y?lessonId=z conta como visita ao produto x.
// O mesmo formato e conferido no banco (member_page_visits.page_key, migracao 202610200002).

/** Formato aceito no banco (mesma expressao do check de member_page_visits.page_key). */
export const PAGE_KEY_PATTERN =
  /^(home|purchases|saved|materials|journey|continue|profile|support|content:[A-Za-z0-9_-]{1,240}|checkout:[A-Za-z0-9_-]{1,240})$/;

/** Chaves que o navegador pode mandar pelo beacon (abrir os detalhes do produto e clicar em Comprar). */
export const BEACON_PAGE_KEY_PATTERN = /^(content|checkout):[A-Za-z0-9_-]{1,240}$/;

/** Paginas fixas da area do aluno, na ordem do menu. */
export const FIXED_PAGE_KEYS = ["home", "purchases", "saved", "materials", "journey", "continue", "profile", "support"] as const;
export type FixedPageKey = (typeof FIXED_PAGE_KEYS)[number];

export const FIXED_PAGE_LABELS: Record<FixedPageKey, string> = {
  continue: "Continue assistindo",
  home: "Início",
  journey: "Minha jornada",
  materials: "Materiais",
  profile: "Perfil",
  purchases: "Minhas compras",
  saved: "Favoritos",
  support: "Suporte"
};

/** Endereco de cada pagina fixa. */
export const FIXED_PAGE_PATHS: Record<FixedPageKey, string> = {
  continue: "/continue-assistindo",
  home: "/",
  journey: "/minha-jornada",
  materials: "/materiais",
  profile: "/perfil",
  purchases: "/minhas-compras",
  saved: "/favoritos",
  support: "/suporte"
};

const PRODUCT_ID = /^[A-Za-z0-9_-]{1,240}$/;
// /conteudo/{id} e /conteudo/{id}/aulas/{moduleId} (a aula conta como visita ao produto).
const CONTENT_ROUTE = /^\/conteudo\/([A-Za-z0-9_-]{1,240})(?:\/aulas\/[^/]+)?$/;
const FIXED_BY_PATH = new Map<string, FixedPageKey>(FIXED_PAGE_KEYS.map((key) => [FIXED_PAGE_PATHS[key], key]));

export function isPageKey(value: unknown): value is string {
  return typeof value === "string" && PAGE_KEY_PATTERN.test(value);
}

/** "content:<id>" (pagina do produto); id fora do formato -> null. */
export function contentPageKey(productId: string) {
  return PRODUCT_ID.test(productId) ? `content:${productId}` : null;
}

/** "checkout:<id>" (clique em Comprar do produto); id fora do formato -> null. */
export function checkoutPageKey(productId: string) {
  return PRODUCT_ID.test(productId) ? `checkout:${productId}` : null;
}

/** Chave de uma pagina escolhida numa regra (a "pagina do botao" se resolve pelo passo, fora daqui). */
export function pageKeyOfTarget(
  target: { key: FixedPageKey; kind: "fixed" } | { kind: "checkout" | "content"; productId: string }
): string | null {
  if (target.kind === "fixed") {
    return FIXED_PAGE_KEYS.includes(target.key) ? target.key : null;
  }

  return target.kind === "content" ? contentPageKey(target.productId) : checkoutPageKey(target.productId);
}

/**
 * Chave da rota da area do aluno ("/", "/conteudo/x", "/conteudo/x/aulas/y", "/minhas-compras"...).
 * Recebe o caminho, sem query nem hash; barra no fim nao importa. Rota que nao e acompanhada -> null.
 */
export function pageKeyOfRoute(pathname: string): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return null;
  }

  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  const fixed = FIXED_BY_PATH.get(path);

  if (fixed) {
    return fixed;
  }

  const content = CONTENT_ROUTE.exec(path);

  return content ? `content:${content[1]}` : null;
}

/**
 * Chave da pagina para onde o botao de uma notificacao leva: tira query e hash e usa a rota. Qualquer
 * outro caminho interno (o servidor aceita qualquer um, nao so as escolhas do editor) e todo link
 * externo -> null: nao da para acompanhar, so "clicou no botao".
 */
export function pageKeyOfHref(href: string | null | undefined): string | null {
  if (typeof href !== "string") {
    return null;
  }

  const value = href.trim();

  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || /\s/.test(value)) {
    return null;
  }

  const path = value.split(/[?#]/, 1)[0] ?? "";

  return pageKeyOfRoute(path);
}
