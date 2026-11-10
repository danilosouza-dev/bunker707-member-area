// A "Na tela" na sala do aluno (docs/30 §5.1; especificacao de 10/11/2026, §3.5 e §5.2), a parte pura: qual estado a
// sala adota (o da leitura da sessao sempre; o da consulta de 5 s do chat so quando o carimbo e outro), o que o aluno
// fechou (por exibicao, no sessionStorage: recarregar nao traz de volta, um novo Mostrar e outra exibicao) e o que fica
// na tela depois disso. Sem "use client" e com imports relativos: os testes carregam pelo Node. Nada aqui le o
// navegador: quem le e escreve o sessionStorage e use-room-screen.ts.

import type { StudentScreenItem, StudentScreenState } from "../../../../../server/webinars/screen-model";

/** De onde o estado chegou: a leitura da sessao (a pagina, a releitura de 60 s, a volta para a aba) ou o chat de 5 s. */
export type ScreenOrigin = "chat" | "session";

/**
 * O estado que a sala passa a ter. O da sessao sempre entra; o do chat entra quando o carimbo e diferente do que a sala
 * tem (igualdade, sem ordem: o carimbo e o updated_at da sessao, e o servidor so manda quando mudou). Sem estado novo,
 * fica o atual.
 */
export function adoptScreen(current: StudentScreenState | null, incoming: StudentScreenState | null | undefined, origin: ScreenOrigin): StudentScreenState | null {
  if (!incoming) {
    return current;
  }
  if (origin === "session") {
    return incoming;
  }
  return current && current.stamp === incoming.stamp ? current : incoming;
}

/** A chave do sessionStorage com as exibicoes que o aluno fechou nesta sessao. */
export function screenClosedKey(sessionId: string): string {
  return `bunker707:webinar-sala-tela-fechados:${sessionId}`;
}

/** No maximo quantos ids guardados (uma sessao tem poucas exibicoes; o resto e lixo de um valor estragado). */
const CLOSED_MAX = 200;

/** Os ids guardados: uma lista de textos; o que falta ou vem estragado e vazio. */
export function storedClosedIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 64).slice(-CLOSED_MAX) : [];
  } catch {
    return [];
  }
}

/** O valor que vai para o sessionStorage depois de fechar `displayId` (sem repetir; os mais antigos saem do teto). */
export function closedIdsValue(current: readonly string[], displayId: string): string {
  const next = current.includes(displayId) ? [...current] : [...current, displayId];
  return JSON.stringify(next.slice(-CLOSED_MAX));
}

/** O banner e o QR Code que continuam na tela para este aluno: o que ele fechou some, so o que pode ser fechado. */
export function visibleScreenItems(items: readonly StudentScreenItem[], closedIds: readonly string[]): StudentScreenItem[] {
  const closed = new Set(closedIds);
  return items.filter((item) => !(item.closable && closed.has(item.displayId)));
}
