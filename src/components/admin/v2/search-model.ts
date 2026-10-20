// Busca global do admin (Cmd/Ctrl+K, prototipo aprovado): o que e estatico (telas e acoes do menu) e as
// regras de montagem da lista. Modulo puro (sem React nem servidor): o campo da barra superior, a Server
// Action e tests/admin-search.test.mjs usam as mesmas funcoes.
//
// Ordem dos grupos: Produtos · Módulos · Aulas · Telas · Ações, no maximo 5 por grupo. Campo vazio =
// Ações e Telas principais (todas); com 1 letra, so telas e acoes do menu (o banco espera 2 letras). Com texto, a busca tambem oferece "Buscar “x” em alunos", que abre a
// lista de Alunos ja filtrada.

import { canAny, type AdminAccess, type AdminAction } from "../../../server/auth/roles";
import { STUDENT_AREA_HREF, adminNavItems, canSeeAdminArea, visibleAdminNav, type AdminNavItem } from "./nav";
import { newStudentHref, studentSearchHref } from "./students/hrefs";

export const ADMIN_SEARCH_MIN_LENGTH = 2;
export const ADMIN_SEARCH_MAX_LENGTH = 80;
export const ADMIN_SEARCH_DEBOUNCE_MS = 150;
export const ADMIN_SEARCH_GROUP_LIMIT = 5;

export type AdminSearchHit = { href: string; id: string; meta: string; title: string };

/** Resultado do banco (Server Action searchAdmin). */
export type AdminSearchResults = {
  /** meta = "Produto › Módulo"; href = /admin/produtos/{dono}?aula={id}. */
  lessons: AdminSearchHit[];
  /** meta = nome do produto; href = pagina do produto. */
  modules: AdminSearchHit[];
  /** meta = formato ("Curso", "Formação"...); href = pagina do produto. */
  products: AdminSearchHit[];
};

export const EMPTY_ADMIN_SEARCH_RESULTS: AdminSearchResults = { lessons: [], modules: [], products: [] };

export type AdminSearchGroupId = "products" | "modules" | "lessons" | "screens" | "actions";

export const ADMIN_SEARCH_GROUP_LABELS: Record<AdminSearchGroupId, string> = {
  actions: "Ações",
  lessons: "Aulas",
  modules: "Módulos",
  products: "Produtos",
  screens: "Telas"
};

const GROUP_ORDER: readonly AdminSearchGroupId[] = ["products", "modules", "lessons", "screens", "actions"];

export type AdminSearchItem = {
  group: AdminSearchGroupId;
  href: string;
  id: string;
  /** Texto curto a direita: formato, "Produto › Módulo", area do menu, "admin antigo". */
  meta?: string;
  title: string;
};

export type AdminSearchGroup = { id: AdminSearchGroupId; items: AdminSearchItem[]; label: string };

/** Minusculas, sem acento e com espacos simples: "Formação  IA" -> "formacao ia". */
export function normalizeAdminSearchText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

/** Texto que vai para o banco: sem espacos sobrando e com no maximo 80 caracteres. */
export function cleanAdminSearchQuery(value: string | null | undefined) {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, ADMIN_SEARCH_MAX_LENGTH);
}

/** A busca no banco so roda com 2 letras ou mais. */
export function shouldSearchAdminCatalog(value: string | null | undefined) {
  return cleanAdminSearchQuery(value).length >= ADMIN_SEARCH_MIN_LENGTH;
}

export function buildAdminProductHref(productId: string) {
  return `/admin/produtos/${encodeURIComponent(productId)}`;
}

/** Modulo: abre a aba Conteudo do produto dono (a arvore mostra todos os modulos). */
export function buildAdminModuleHref(ownerId: string) {
  return buildAdminProductHref(ownerId);
}

/** Aula: abre o painel da aula na aba Conteudo do produto dono (?aula=). */
export function buildAdminLessonHref(ownerId: string, lessonId: string) {
  return `${buildAdminProductHref(ownerId)}?aula=${encodeURIComponent(lessonId)}`;
}

/** "Formação Agentes de IA › Módulo 1 · Comece por aqui"; sem modulo, so o produto. */
export function formatAdminLessonMeta(productTitle: string | null | undefined, moduleTitle: string | null | undefined) {
  return [productTitle?.trim(), moduleTitle?.trim()].filter(Boolean).join(" › ");
}

type StaticEntry = AdminSearchItem & {
  /** Aparece com o campo vazio. */
  featured?: boolean;
  keywords?: string;
  /** Permissoes que mostram a acao (basta uma). */
  requires?: readonly AdminAction[];
};

/** Telas: cada area do menu e cada subitem, todos com pagina de verdade. */
function buildScreens(items: readonly AdminNavItem[]): StaticEntry[] {
  const screens: StaticEntry[] = [];

  for (const item of items) {
    screens.push({ featured: true, group: "screens", href: item.href, id: `tela:${item.href}`, title: item.label });

    for (const child of item.children ?? []) {
      if (child.href === item.href) {
        continue;
      }

      screens.push({ group: "screens", href: child.href, id: `tela:${child.href}`, meta: item.label, title: child.label });
    }
  }

  return screens;
}

/**
 * Acoes: so destinos que existem. Webinarios e promocoes ainda nao tem tela de criar; Pacotes aparece em
 * Telas (o "Novo pacote" fica dentro da propria tela). "Novo aviso" aparece ao digitar (nao entra nas
 * principais do campo vazio).
 */
const ACTIONS: readonly StaticEntry[] = [
  {
    featured: true,
    group: "actions",
    href: "/admin/produtos/novo",
    id: "acao:novo-produto",
    keywords: "criar curso",
    requires: ["catalog.create"],
    title: "Novo produto"
  },
  {
    featured: true,
    group: "actions",
    href: "/admin/produtos/importar",
    id: "acao:importar-playlist",
    keywords: "youtube importar curso",
    requires: ["catalog.create"],
    title: "Importar playlist do YouTube"
  },
  {
    featured: true,
    group: "actions",
    href: newStudentHref(),
    id: "acao:adicionar-aluno",
    keywords: "aluno liberar acesso",
    requires: ["students.access"],
    title: "Adicionar aluno"
  },
  {
    group: "actions",
    href: "/admin/comunicacao/avisos/novo",
    id: "acao:novo-aviso",
    keywords: "criar notificacao sino pop-up popup comunicar",
    requires: ["messaging.write"],
    title: "Novo aviso"
  },
  { group: "actions", href: STUDENT_AREA_HREF, id: "acao:area-do-aluno", keywords: "ver como aluno", title: "Ver área do aluno" }
];

const SCREENS = buildScreens(adminNavItems);

/**
 * Telas e acoes que a pessoa pode abrir. Sem `access` (testes de montagem), todas. O servidor confere
 * cada tela de novo (requirePageArea); aqui so nao oferecemos o que ia dar em recusa.
 */
function staticEntriesFor(access: AdminAccess | null | undefined) {
  if (access === undefined) {
    return { actions: ACTIONS, screens: SCREENS };
  }

  return {
    actions: ACTIONS.filter((entry) => !entry.requires || canAny(access, entry.requires)),
    screens: buildScreens(visibleAdminNav(access))
  };
}

export function listAdminStaticSearchItems(access?: AdminAccess | null): AdminSearchItem[] {
  const entries = staticEntriesFor(access);

  return [...entries.screens, ...entries.actions].map(stripStatic);
}

function stripStatic(entry: StaticEntry): AdminSearchItem {
  const item: AdminSearchItem = { group: entry.group, href: entry.href, id: entry.id, title: entry.title };

  return entry.meta ? { ...item, meta: entry.meta } : item;
}

function matches(entry: StaticEntry, query: string) {
  const haystack = normalizeAdminSearchText([entry.title, entry.meta, entry.keywords].filter(Boolean).join(" "));

  return query.split(" ").every((word) => haystack.includes(word));
}

/** Telas e acoes que combinam com o texto (vazio = as principais), na ordem do menu. */
export function filterAdminStaticItems(query: string | null | undefined, access?: AdminAccess | null) {
  const normalized = normalizeAdminSearchText(query);
  const entries = staticEntriesFor(access);
  const pick = (list: readonly StaticEntry[]) => list.filter((entry) => (normalized ? matches(entry, normalized) : entry.featured)).map(stripStatic);

  return { actions: pick(entries.actions), screens: pick(entries.screens) };
}

function toItems(group: "products" | "modules" | "lessons", hits: readonly AdminSearchHit[]): AdminSearchItem[] {
  return hits.map((hit) => ({ group, href: hit.href, id: `${group}:${hit.id}`, meta: hit.meta || undefined, title: hit.title }));
}

/**
 * Lista final, agrupada e na ordem Produtos · Módulos · Aulas · Telas · Ações (5 por grupo; grupos
 * vazios somem). Com 2 letras ou mais, entra a acao "Buscar “x” em alunos no admin antigo".
 */
export function buildAdminSearchGroups(
  query: string | null | undefined,
  results: AdminSearchResults = EMPTY_ADMIN_SEARCH_RESULTS,
  access?: AdminAccess | null
): AdminSearchGroup[] {
  const cleaned = cleanAdminSearchQuery(query);
  const searching = cleaned.length >= ADMIN_SEARCH_MIN_LENGTH;
  const staticItems = filterAdminStaticItems(cleaned, access);
  const canSearchStudents = access === undefined || canSeeAdminArea(access, "alunos");
  const actions = searching && canSearchStudents
    ? [
        ...staticItems.actions,
        {
          group: "actions" as const,
          href: studentSearchHref(cleaned),
          id: "acao:buscar-alunos",
          title: `Buscar “${cleaned}” em alunos`
        }
      ]
    : staticItems.actions;

  const byGroup: Record<AdminSearchGroupId, AdminSearchItem[]> = {
    actions,
    lessons: searching ? toItems("lessons", results.lessons) : [],
    modules: searching ? toItems("modules", results.modules) : [],
    products: searching ? toItems("products", results.products) : [],
    screens: staticItems.screens
  };

  // Campo vazio: Acoes antes de Telas, como no prototipo.
  const order = cleaned ? GROUP_ORDER : (["actions", "screens"] as const);

  // Com texto, no maximo 5 por grupo; sem texto, todas as acoes e areas principais (como no prototipo).
  return order
    .map((id) => ({ id, items: cleaned ? byGroup[id].slice(0, ADMIN_SEARCH_GROUP_LIMIT) : byGroup[id], label: ADMIN_SEARCH_GROUP_LABELS[id] }))
    .filter((group) => group.items.length > 0);
}

/** Itens na ordem da lista, para ↑ ↓ e Enter. */
export function flattenAdminSearchGroups(groups: readonly AdminSearchGroup[]) {
  return groups.flatMap((group) => group.items);
}
