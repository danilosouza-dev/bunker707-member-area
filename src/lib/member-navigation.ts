// Rotas e menu da area do aluno: fonte unica para a barra lateral (app-shell), o menu da conta no
// topo, o rodape e as paginas novas. Modulo puro (sem React e sem icones): o app-shell associa o
// icone Lucide pela chave `key`.
//
// Toda pagina listada aqui exige sessao (requirePageUser na pagina e o prefixo em proxy.ts).

export const MEMBER_ROUTES = {
  changePassword: "/alterar-senha",
  continueWatching: "/continue-assistindo",
  favorites: "/favoritos",
  home: "/",
  journey: "/minha-jornada",
  materials: "/materiais",
  profile: "/perfil",
  purchases: "/minhas-compras",
  support: "/suporte"
} as const;

export type MemberRouteKey = keyof typeof MEMBER_ROUTES;
export type MemberRouteHref = (typeof MEMBER_ROUTES)[MemberRouteKey];

export type MemberNavigationKey =
  | "home"
  | "journey"
  | "continueWatching"
  | "purchases"
  | "favorites"
  | "materials"
  | "support"
  | "profile";

export type MemberNavigationItem = {
  /** Texto curto para leitores de tela e tooltip quando o menu estiver recolhido. */
  description: string;
  href: MemberRouteHref;
  key: MemberNavigationKey;
  label: string;
};

export type MemberNavigationGroup = {
  id: "estudar" | "conta";
  items: MemberNavigationItem[];
  label: string;
};

export const MEMBER_NAVIGATION_GROUPS: readonly MemberNavigationGroup[] = [
  {
    id: "estudar",
    items: [
      { description: "Página inicial com seus cursos", key: "home", label: "Início", href: "/" },
      { description: "Seu progresso em cada curso", key: "journey", label: "Minha jornada", href: "/minha-jornada" },
      { description: "Aulas que você começou", key: "continueWatching", label: "Continue assistindo", href: "/continue-assistindo" },
      { description: "Tudo que você comprou ou recebeu", key: "purchases", label: "Minhas compras", href: "/minhas-compras" },
      { description: "Cursos, módulos e aulas salvos", key: "favorites", label: "Favoritos", href: "/favoritos" },
      { description: "Arquivos de apoio das suas aulas", key: "materials", label: "Materiais", href: "/materiais" }
    ],
    label: "Estudar"
  },
  {
    id: "conta",
    items: [
      { description: "Fale com a equipe da escola", key: "support", label: "Suporte", href: "/suporte" },
      { description: "Seus dados e acessos", key: "profile", label: "Perfil", href: "/perfil" }
    ],
    label: "Conta e ajuda"
  }
];

export const MEMBER_NAVIGATION_ITEMS: readonly MemberNavigationItem[] = MEMBER_NAVIGATION_GROUPS.flatMap((group) => group.items);

/** Prefixos protegidos pelas paginas novas desta rodada (o proxy.ts mantem a propria lista literal). */
export const MEMBER_NEW_PAGE_PREFIXES = [
  MEMBER_ROUTES.journey,
  MEMBER_ROUTES.continueWatching,
  MEMBER_ROUTES.materials,
  MEMBER_ROUTES.support,
  MEMBER_ROUTES.profile
] as const;

/**
 * Item ativo da barra lateral. "/" so e ativo na propria home; os demais valem para a rota e as
 * subrotas ("/perfil" e "/perfil/acessos"), nunca para um prefixo parcial ("/perfil-x").
 */
export function isMemberNavigationItemActive(href: string, pathname: string | null | undefined) {
  const currentPath = (pathname ?? "").split(/[?#]/)[0] || "/";

  if (href === "/") {
    return currentPath === "/";
  }

  return currentPath === href || currentPath.startsWith(`${href}/`);
}

/** Item ativo para um caminho, ou undefined (pagina de curso ou aula nao marca nenhum item). */
export function getActiveMemberNavigationKey(pathname: string | null | undefined): MemberNavigationKey | undefined {
  return MEMBER_NAVIGATION_ITEMS.find((item) => isMemberNavigationItemActive(item.href, pathname))?.key;
}
