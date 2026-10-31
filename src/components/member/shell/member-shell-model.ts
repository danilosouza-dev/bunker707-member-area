// Regras puras do topo, da barra lateral e da IA Diretor da area do aluno (sem React e sem icones).
// Imports relativos para os testes (node --test) carregarem o arquivo direto.

import { withAccessPreviewParam, type AccessPreviewMode } from "../../../lib/access-preview";
import { formatMemberCount, formatMemberRelativeTime, getMemberDayDifference } from "../../../lib/member-format";
import {
  MEMBER_NAVIGATION_GROUPS,
  MEMBER_NAVIGATION_ITEMS,
  isMemberNavigationItemActive,
  type MemberNavigationKey
} from "../../../lib/member-navigation";
import { isWebinarRoomPath } from "../../../lib/webinar-paths";

export type MemberShellLink = {
  /** Item da pagina atual (fundo claro, barra vermelha, `aria-current="page"`). */
  active: boolean;
  description: string;
  /** Destino ja com `?accessPreview=` quando o produtor esta em modo de visualizacao. */
  href: string;
  key: MemberNavigationKey;
  label: string;
};

export type MemberSidebarSection = {
  id: string;
  items: MemberShellLink[];
  label: string;
};

function toShellLink(
  item: (typeof MEMBER_NAVIGATION_ITEMS)[number],
  pathname: string | null | undefined,
  accessPreviewMode?: AccessPreviewMode
): MemberShellLink {
  return {
    active: isMemberNavigationItemActive(item.href, pathname),
    description: item.description,
    href: withAccessPreviewParam(item.href, accessPreviewMode),
    key: item.key,
    label: item.label
  };
}

/** Grupos da barra lateral ("Estudar", "Conta e ajuda") a partir da fonte unica de rotas. */
export function getMemberSidebarSections(
  pathname: string | null | undefined,
  accessPreviewMode?: AccessPreviewMode
): MemberSidebarSection[] {
  return MEMBER_NAVIGATION_GROUPS.map((group) => ({
    id: group.id,
    items: group.items.map((item) => toShellLink(item, pathname, accessPreviewMode)),
    label: group.label
  }));
}

/** Atalhos do menu da conta no topo (o "Sair" fica no proprio menu). */
export const MEMBER_ACCOUNT_MENU_KEYS = ["profile", "purchases", "support"] as const satisfies readonly MemberNavigationKey[];

export function getMemberAccountMenuLinks(
  pathname: string | null | undefined,
  accessPreviewMode?: AccessPreviewMode
): MemberShellLink[] {
  return MEMBER_ACCOUNT_MENU_KEYS.flatMap((key) => {
    const item = MEMBER_NAVIGATION_ITEMS.find((navigationItem) => navigationItem.key === key);
    return item ? [toShellLink(item, pathname, accessPreviewMode)] : [];
  });
}

/** Primeiro nome para saudacoes ("Olá, Ana"). Vazio quando nao ha nome. */
export function getMemberFirstName(name: string | null | undefined) {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function getDirectorGreeting(name: string | null | undefined) {
  const firstName = getMemberFirstName(name);
  return firstName ? `Olá, ${firstName}` : "Olá!";
}

/**
 * O botao flutuante da IA Diretor fica em toda pagina da area, menos na sala do Webinario (/webinarios/<slug>/sala):
 * a sala e um dialogo de tela cheia e o botao cobriria o Enviar do chat (docs/30 §1.3). Sem Minimizar (docs/31 V2-2):
 * a IA Diretor volta quando o aluno sai da sala.
 */
export function directorLauncherAllowedOn(pathname: string | null | undefined) {
  return !isWebinarRoomPath(pathname);
}

// --- IA Diretor: historico ----------------------------------------------------------------------

export type DirectorConversationGroup<T> = {
  items: T[];
  label: string;
};

const directorHistoryGroupLabels = ["Hoje", "Ontem", "Últimos 7 dias", "Últimos 30 dias", "Mais antigas"] as const;

function getDirectorHistoryGroupIndex(lastMessageAt: string, now: number) {
  const days = getMemberDayDifference(lastMessageAt, now);

  if (days === null) return 4;
  if (days <= 0) return 0;
  if (days === 1) return 1;
  if (days < 7) return 2;
  if (days < 30) return 3;
  return 4;
}

/**
 * Agrupa as conversas por dia civil em Sao Paulo, mantendo a ordem recebida do servidor
 * (mais recente primeiro). Grupos vazios nao aparecem.
 */
export function groupDirectorConversations<T extends { lastMessageAt: string }>(
  conversations: readonly T[],
  now: number = Date.now()
): DirectorConversationGroup<T>[] {
  const groups = directorHistoryGroupLabels.map((label) => ({ items: [] as T[], label: label as string }));

  for (const conversation of conversations) {
    groups[getDirectorHistoryGroupIndex(conversation.lastMessageAt, now)].items.push(conversation);
  }

  return groups.filter((group) => group.items.length > 0);
}

/** "há 2 horas · 6 mensagens" para cada item do historico. */
export function describeDirectorConversation(
  conversation: { lastMessageAt: string; messageCount: number },
  now: number = Date.now()
) {
  const when = formatMemberRelativeTime(conversation.lastMessageAt, now);
  const count = conversation.messageCount > 0 ? formatMemberCount(conversation.messageCount, "mensagem", "mensagens") : "Sem mensagens";
  return when ? `${when} · ${count}` : count;
}

/** Limite do campo da IA Diretor e a partir de quando o contador aparece. */
export const DIRECTOR_MESSAGE_LIMIT = 4000;
export const DIRECTOR_COUNTER_THRESHOLD = 3600;

export function getDirectorCounterLabel(length: number) {
  if (length < DIRECTOR_COUNTER_THRESHOLD) return "";
  return `${length.toLocaleString("pt-BR")}/${DIRECTOR_MESSAGE_LIMIT.toLocaleString("pt-BR")}`;
}
