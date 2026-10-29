// Mapa do admin (docs/17 §1.4): sete areas de primeiro nivel, subitens so ao abrir o grupo; e o que a
// barra superior mostra em cada tela (prototipo aprovado).
//
// Modulo puro, sem React nem icones: tests/admin-v2-shell.test.mjs carrega este arquivo direto
// pelo Node. Os icones de cada area ficam em admin-shell.tsx, indexados por `AdminNavId`.
//
// Cada area e cada subitem dizem quais permissoes os abrem (`requires`, basta uma). O menu de cada
// pessoa mostra so o que ela pode usar (visibleAdminNav) e cada pagina confere a mesma regra no
// servidor (requirePageArea em src/server/auth/permissions.ts).

import { canAny, catalogScope, type AdminAccess, type AdminAction } from "../../../server/auth/roles";

export type AdminNavId =
  | "hoje"
  | "alunos"
  | "produtos"
  | "membros"
  | "comunicacao"
  | "comunidade"
  | "configuracoes";

export type AdminNavChild = {
  /**
   * true: so fica ativo no endereco exato. Sem a marca, o filho fica ativo tambem nos enderecos
   * abaixo dele, e entre irmaos vence o endereco mais especifico (Pacotes vence Todos os produtos
   * em /admin/produtos/pacotes; Todos os produtos continua ativo na pagina de um produto).
   */
  exact?: boolean;
  href: string;
  label: string;
  /** Permissoes que mostram o subitem (basta uma). Sem a lista, vale para quem ve a area. */
  requires?: readonly AdminAction[];
};

export type AdminNavItem = {
  children?: readonly AdminNavChild[];
  href: string;
  id: AdminNavId;
  label: string;
  /** Permissoes que abrem a area (basta uma). */
  requires: readonly AdminAction[];
  /** Prefixos de endereco que pertencem a esta area. */
  sections: readonly string[];
};

export const ADMIN_HOME_HREF = "/admin";
/** Cookie com a escolha "barra lateral recolhida" (lido no servidor para a pagina ja abrir certa). */
export const ADMIN_SIDEBAR_COOKIE = "bunker-admin-sidebar";
export const STUDENT_AREA_HREF = "/";

export const adminNavItems: readonly AdminNavItem[] = [
  { href: "/admin", id: "hoje", label: "Visão geral", requires: ["reports.read"], sections: [] },
  { href: "/admin/alunos", id: "alunos", label: "Alunos", requires: ["students.read_basic"], sections: ["/admin/alunos"] },
  {
    children: [
      { href: "/admin/produtos", label: "Todos os produtos" },
      { href: "/admin/produtos/pacotes", label: "Pacotes", requires: ["catalog.access"] },
      { href: "/admin/produtos/importar", label: "Importar", requires: ["catalog.create"] }
    ],
    href: "/admin/produtos",
    id: "produtos",
    label: "Produtos",
    requires: ["catalog.content", "catalog.create", "catalog.write", "catalog.access", "catalog.publish", "catalog.delete", "reports.read"],
    sections: ["/admin/produtos"]
  },
  {
    children: [
      { href: "/admin/area-de-membros", label: "Vitrine" },
      { href: "/admin/area-de-membros/destaque", label: "Destaque" },
      { href: "/admin/area-de-membros/modulos", label: "Módulos" },
      { href: "/admin/area-de-membros/login", label: "Login" },
      { href: "/admin/area-de-membros/marca", label: "Marca" }
    ],
    href: "/admin/area-de-membros",
    id: "membros",
    label: "Área de membros",
    requires: ["storefront.write"],
    // Ordem dos filhos: as duas pecas da home juntas (fileiras e banner do topo), o que fica dentro
    // dos cursos, a pagina de entrar (muda pouco) e a logo (muda quase nunca).
    // /admin/home era a "Home do aluno" da fase 0 e hoje redireciona para a Vitrine.
    sections: ["/admin/area-de-membros", "/admin/home"]
  },
  {
    children: [
      { href: "/admin/comunicacao/avisos", label: "Avisos e pop-ups" },
      { href: "/admin/comunicacao/fluxos", label: "Fluxos" },
      { href: "/admin/comunicacao/modelos", label: "Modelos" },
      { href: "/admin/comunicacao/webinarios", label: "Webinários" },
      { href: "/admin/comunicacao/promocoes", label: "Promoções" }
    ],
    href: "/admin/comunicacao",
    id: "comunicacao",
    label: "Comunicação",
    requires: ["messaging.write"],
    sections: ["/admin/comunicacao"]
  },
  {
    href: "/admin/comunidade",
    id: "comunidade",
    label: "Comunidade",
    requires: ["community.reply", "community.moderate"],
    sections: ["/admin/comunidade"]
  },
  {
    children: [
      { exact: true, href: "/admin/configuracoes", label: "Todas as configurações" },
      { href: "/admin/configuracoes/equipe", label: "Equipe", requires: ["settings.team"] },
      { href: "/admin/configuracoes/ia", label: "Tutor IA", requires: ["settings.ai"] },
      { href: "/admin/configuracoes/vendas", label: "Vendas", requires: ["settings.sales"] }
    ],
    href: "/admin/configuracoes",
    id: "configuracoes",
    label: "Configurações",
    requires: ["settings.ai", "settings.sales", "settings.team"],
    sections: ["/admin/configuracoes"]
  }
];

/** A pessoa enxerga a area? (mesma regra do menu e de requirePageArea). */
export function canSeeAdminArea(access: AdminAccess | null | undefined, id: AdminNavId) {
  const item = adminNavItems.find((candidate) => candidate.id === id);

  return Boolean(item && canAny(access, item.requires));
}

/**
 * Menu da pessoa: so as areas e os subitens que as permissoes dela abrem. Quem tem acesso so a alguns
 * cursos (Professor) ve "Meus cursos" no lugar de Produtos, sem subitens.
 */
export function visibleAdminNav(access: AdminAccess | null | undefined): AdminNavItem[] {
  const scoped = Boolean(access && catalogScope(access) !== null);

  return adminNavItems
    .filter((item) => canAny(access, item.requires))
    .map((item) => {
      if (scoped && item.id === "produtos") {
        return { ...item, children: undefined, label: "Meus cursos" };
      }

      return item.children ? { ...item, children: item.children.filter((child) => !child.requires || canAny(access, child.requires)) } : item;
    });
}

/** Primeira tela da pessoa: a primeira area que ela enxerga (Professor cai em Produtos; Suporte, em Alunos). */
export function adminHomeHref(access: AdminAccess | null | undefined) {
  return visibleAdminNav(access)[0]?.href ?? "/";
}

export function normalizeAdminPath(pathname: string | null | undefined) {
  const path = (pathname ?? "").split(/[?#]/)[0].replace(/\/+$/, "");

  return path || "/";
}

export function matchesAdminPath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isAdminNavItemCurrent(pathname: string, item: AdminNavItem) {
  return normalizeAdminPath(pathname) === item.href;
}

export function isAdminNavSectionActive(pathname: string, item: AdminNavItem) {
  const path = normalizeAdminPath(pathname);

  if (item.href === ADMIN_HOME_HREF) {
    return path === ADMIN_HOME_HREF;
  }

  return item.sections.some((section) => matchesAdminPath(path, section));
}

function childMatches(path: string, child: AdminNavChild) {
  return child.exact ? path === child.href : matchesAdminPath(path, child.href);
}

/** Subitem ativo da area: o de endereco mais especifico entre os que combinam com a pagina. */
export function getActiveAdminNavChild(pathname: string | null | undefined, item: AdminNavItem): AdminNavChild | null {
  const path = normalizeAdminPath(pathname);
  let best: AdminNavChild | null = null;

  for (const child of item.children ?? []) {
    if (childMatches(path, child) && (!best || child.href.length > best.href.length)) {
      best = child;
    }
  }

  return best;
}

export function isAdminNavChildActive(pathname: string, child: AdminNavChild, item?: AdminNavItem) {
  if (item) {
    return getActiveAdminNavChild(pathname, item)?.href === child.href;
  }

  return childMatches(normalizeAdminPath(pathname), child);
}

/** Links do admin dispensam o overlay global de navegacao: o shell ja mostra o skeleton. */
export function isAdminV2Href(href: string) {
  return matchesAdminPath(normalizeAdminPath(href), ADMIN_HOME_HREF);
}

/* ------------------------------------------------------------------------------------------------
 * Barra superior (prototipo aprovado, `topbarScope`)
 * ---------------------------------------------------------------------------------------------- */

/** Filtros que a barra superior mostra nesta tela. Cada filtro tem um lugar so. */
export type AdminTopbarScope = { period: boolean; product: boolean };

const NO_TOPBAR_FILTERS: AdminTopbarScope = { period: false, product: false };

/**
 * Periodo e Produto aparecem so nas telas que os usam: Hoje (os dois); Desempenho do produto,
 * Comunicacao e Consumo do Tutor IA (so o Periodo). A aba Modelos da Comunicacao nao tem Periodo (docs/28:
 * uma lista de modelos nao tem numero de periodo). Alunos e Comunidade tem filtros na propria pagina;
 * formularios e Configuracoes nao usam nenhum.
 */
export function getAdminTopbarScope(pathname: string | null | undefined): AdminTopbarScope {
  const path = normalizeAdminPath(pathname);

  if (path === ADMIN_HOME_HREF) {
    return { period: true, product: true };
  }

  if (
    /^\/admin\/produtos\/[^/]+\/desempenho$/.test(path) ||
    /^\/admin\/comunicacao(?:\/(?:avisos|fluxos|webinarios|promocoes))?$/.test(path) ||
    path === "/admin/configuracoes/ia/consumo"
  ) {
    return { period: true, product: false };
  }

  return NO_TOPBAR_FILTERS;
}

/** Telas internas com titulo proprio na barra do celular (as demais mostram o nome da area). */
const mobileTitleOverrides: readonly AdminNavChild[] = [
  { href: "/admin/produtos/novo", label: "Novo produto" },
  { href: "/admin/produtos/importar", label: "Importar" },
  { href: "/admin/produtos/pacotes", label: "Pacotes" },
  { href: "/admin/comunicacao/avisos/novo", label: "Novo aviso" },
  { href: "/admin/comunicacao/fluxos/novo", label: "Novo fluxo" },
  { href: "/admin/comunicacao/modelos/novo", label: "Novo modelo" },
  { href: "/admin/comunicacao/webinarios/novo", label: "Novo webinário" },
  { href: "/admin/configuracoes/equipe", label: "Equipe" },
  { href: "/admin/configuracoes/ia", label: "Tutor IA" },
  { href: "/admin/configuracoes/vendas", label: "Vendas" }
];

/**
 * Titulo da barra superior no celular (no computador o H1 da pagina cumpre esse papel): o nome da area
 * ("Hoje", "Comunicação", "Área de membros") ou da tela interna ("Novo produto", "Tutor IA"). A pagina
 * de um produto troca pelo nome do produto (useAdminTopbarTitle).
 */
export function getAdminMobileTitle(pathname: string | null | undefined): string {
  const path = normalizeAdminPath(pathname);
  const override = mobileTitleOverrides.find((entry) => matchesAdminPath(path, entry.href));

  if (override) {
    return override.label;
  }

  const area = adminNavItems.find((item) => isAdminNavSectionActive(path, item));

  return area?.label ?? "Bunker707";
}

const PERIOD_PARAM_PATTERN = /^[0-9a-z.-]{1,32}$/i;

/**
 * Link do menu que leva o periodo atual (?periodo=) quando a tela de destino usa o Periodo da barra
 * (Hoje, Comunicacao): trocar de tela nao desfaz o filtro. Valor estranho nao e repassado.
 */
export function buildAdminNavHref(href: string, periodParam: string | null | undefined) {
  const value = periodParam?.trim() ?? "";

  if (!value || !PERIOD_PARAM_PATTERN.test(value) || !getAdminTopbarScope(href).period) {
    return href;
  }

  return `${href}?periodo=${encodeURIComponent(value)}`;
}

/** Contadores do menu (ex.: perguntas sem resposta em Comunidade). Zero ou invalido nao aparece. */
export type AdminNavCounts = Partial<Record<AdminNavId, number>>;

export function formatAdminNavCount(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return null;
  }

  return value > 99 ? "99+" : String(Math.floor(value));
}

