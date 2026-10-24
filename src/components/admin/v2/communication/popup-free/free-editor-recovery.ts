// Editor Livre do pop-up (docs/27; spec §4.2 e §6): a copia de recuperacao no navegador. Enquanto ha mudanca que
// ainda nao foi salva, o editor guarda `{ allowSnooze, cta, design, savedAt }` em localStorage["bunker707:livre:<id
// do aviso ou novo>"] (com espera de 1 s) e apaga ao salvar com sucesso. So na maquina de quem edita, so o design, o
// botao principal e a regra do "Lembrar depois" (nada do aluno). A leitura passa pelo mesmo zod do servidor: uma
// copia que nao passa e descartada em silencio; `allowSnooze` que nao e booleano (copias de antes) fica de fora. Sem
// armazenamento (janela privada, bloqueado), tudo devolve null/false e o editor funciona igual.
//
// Modulo puro (o armazenamento entra por parametro), imports relativos, tudo em try/catch.

import { canonicalPopupFreeDesign, type PopupFreeDesign } from "../../../../../server/communications/popup-free-model";
import { parsePopupFreeDesign } from "../../../../../server/communications/popup-free-schema";
import type { NoticeDraft } from "../../../../../server/communications/schemas";

export const FREE_RECOVERY_PREFIX = "bunker707:livre:";
/** Espera depois da ultima mudanca antes de gravar a copia. */
export const FREE_RECOVERY_DELAY_MS = 1_000;

export type FreeRecoveryStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
export type FreeRecovery = { allowSnooze?: boolean; cta: NoticeDraft["cta"]; design: PopupFreeDesign; savedAt: string };
type FreeRecoveryEntry = { allowSnooze?: boolean; cta: NoticeDraft["cta"]; design: PopupFreeDesign };

export function freeRecoveryKey(noticeId: string | null | undefined): string {
  return `${FREE_RECOVERY_PREFIX}${noticeId && noticeId.trim() ? noticeId.trim() : "novo"}`;
}

/**
 * A chave da copia de recuperacao do editor Livre num modelo (modo modelo de Pop-up e pagina do modelo de Design,
 * docs/28 §5.9): "bunker707:livre:modelo:<id do modelo ou novo>", que nunca se confunde com a de um aviso.
 */
export function freeTemplateRecoveryKey(id: string | null | undefined): string {
  return `${FREE_RECOVERY_PREFIX}modelo:${id && id.trim() ? id.trim() : "novo"}`;
}

/** O localStorage do navegador, ou null (sem janela, janela privada que recusa, bloqueado). */
export function browserFreeRecoveryStorage(): FreeRecoveryStorage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }

    const storage = window.localStorage;

    return storage ?? null;
  } catch {
    return null;
  }
}

function ctaOf(value: unknown): NoticeDraft["cta"] | undefined {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const cta = value as Record<string, unknown>;

  if (typeof cta.href !== "string" || typeof cta.label !== "string" || (cta.target !== "new_tab" && cta.target !== "same_tab")) {
    return undefined;
  }

  if (cta.href.length > 2_000 || cta.label.length > 200) {
    return undefined;
  }

  const display = cta.display === "button" || cta.display === "button_and_card" || cta.display === "card" ? cta.display : undefined;

  return { ...(display ? { display } : {}), href: cta.href, label: cta.label, target: cta.target };
}

/** Grava a copia. Devolve false quando nao deu (sem armazenamento, cheio, bloqueado). */
export function writeFreeRecovery(storage: FreeRecoveryStorage | null, key: string, entry: FreeRecoveryEntry, now: Date = new Date()): boolean {
  if (!storage) {
    return false;
  }

  try {
    const allowSnooze = typeof entry.allowSnooze === "boolean" ? { allowSnooze: entry.allowSnooze } : {};

    storage.setItem(key, JSON.stringify({ ...allowSnooze, cta: entry.cta, design: entry.design, savedAt: now.toISOString() }));

    return true;
  } catch {
    return false;
  }
}

/** Le a copia pelo mesmo zod; uma copia que nao passa e apagada e devolve null. */
export function readFreeRecovery(storage: FreeRecoveryStorage | null, key: string): FreeRecovery | null {
  if (!storage) {
    return null;
  }

  let raw: string | null;

  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    clearFreeRecovery(storage, key);

    return null;
  }

  const value = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  const design = value ? parsePopupFreeDesign(value.design) : null;
  const cta = value ? ctaOf(value.cta) : undefined;
  const savedAt = value && typeof value.savedAt === "string" && !Number.isNaN(Date.parse(value.savedAt)) ? value.savedAt : null;

  if (!design || cta === undefined || !savedAt) {
    clearFreeRecovery(storage, key);

    return null;
  }

  if (typeof value?.allowSnooze === "boolean") {
    return { allowSnooze: value.allowSnooze, cta, design, savedAt };
  }

  return { cta, design, savedAt };
}

export function clearFreeRecovery(storage: FreeRecoveryStorage | null, key: string): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(key);
  } catch {
    // Sem armazenamento: nada a apagar.
  }
}

/** A forma comparavel de `{ cta, design }` (o design na forma canonica, o botao sem espacos nas pontas). */
export function freeEntrySignature(entry: { cta: NoticeDraft["cta"]; design: PopupFreeDesign }): string {
  let design: unknown = entry.design;

  try {
    design = canonicalPopupFreeDesign(entry.design);
  } catch {
    // Um design no meio da edicao que a forma canonica nao entende: compara como esta.
  }

  const cta = entry.cta ? { href: entry.cta.href.trim(), label: entry.cta.label.trim(), target: entry.cta.target } : null;

  return JSON.stringify({ cta, design });
}

/**
 * A regra do "Lembrar depois" a devolver ao recuperar a copia (docs/27 §13.7): so quando a copia a guardou como
 * booleano e ela e diferente da atual; null = nada a mudar (copia de antes sem a chave, ou igual).
 */
export function allowSnoozeToRestore(recovery: Pick<FreeRecovery, "allowSnooze"> | null, current: boolean): boolean | null {
  if (!recovery || typeof recovery.allowSnooze !== "boolean" || recovery.allowSnooze === current) {
    return null;
  }

  return recovery.allowSnooze;
}

/**
 * Houve mudanca depois do ultimo salvar com sucesso: a assinatura de { cta, design } OU a regra do "Lembrar depois"
 * (que o Livre edita fora do historico, direto no rascunho do aviso; docs/27 §13.7). O Z so troca de endereco no
 * Concluir quando nao houve (§4.13): sem a chave na conta, a troca remontaria o editor e perderia a chave em silencio.
 */
export function freeDirtySinceSave(state: { allowSnooze: boolean; savedAllowSnooze: boolean; savedSignature: string; signature: string }): boolean {
  return state.signature !== state.savedSignature || state.allowSnooze !== state.savedAllowSnooze;
}

/** A copia so aparece quando e diferente do que o editor abriu. */
export function freeRecoveryDiffers(recovery: FreeRecovery | null, current: { cta: NoticeDraft["cta"]; design: PopupFreeDesign }): boolean {
  return Boolean(recovery) && freeEntrySignature(recovery as FreeRecovery) !== freeEntrySignature(current);
}

/** A hora da copia para a faixa ("14:05"). */
export function freeRecoveryTime(savedAt: string, locale = "pt-BR", timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(savedAt));
  } catch {
    return "";
  }
}
