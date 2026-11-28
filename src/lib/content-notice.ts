// Liberação "sem data" (docs/17 §1.6.5a): a equipe fecha um produto, um modulo ou uma aula com um aviso no lugar
// de uma data ("Em breve", "Em gravação" ou um texto proprio). E mais uma opcao do campo Liberação, gravada na
// mesma regra de sempre (release_rule: { mode: "no_date", notice }); enquanto ela vale, o aluno nao abre aquele
// item e le o aviso onde leria "Liberação em 08/01". Com ela no produto, o Publicar deixa de exigir aula.
// Modulo puro, sem React e sem "server-only": o servidor, as telas e os testes (direto pelo Node) usam por aqui.

export const CONTENT_NOTICE_KINDS = ["coming_soon", "recording", "custom"] as const;
export type ContentNoticeKind = (typeof CONTENT_NOTICE_KINDS)[number];

/** O que fica gravado. `text` so existe (e e obrigatorio) no tipo "custom". */
export type ContentNotice = { kind: "coming_soon" | "recording" } | { kind: "custom"; text: string };

/** Cabe no selo do card sem passar de duas linhas. */
export const CONTENT_NOTICE_TEXT_MAX = 24;

export const CONTENT_NOTICE_LABELS: Record<Exclude<ContentNoticeKind, "custom">, string> = {
  coming_soon: "Em breve",
  recording: "Em gravação"
};

/** Aviso padrao de uma regra "sem data" gravada sem aviso valido. */
export const DEFAULT_CONTENT_NOTICE: ContentNotice = { kind: "coming_soon" };

function isContentNoticeKind(value: unknown): value is ContentNoticeKind {
  return typeof value === "string" && (CONTENT_NOTICE_KINDS as readonly string[]).includes(value);
}

/**
 * Le o que veio do banco (jsonb) sem confiar na forma: tipo desconhecido, texto proprio vazio ou qualquer outra
 * coisa valem "sem aviso". O texto proprio volta sem espacos nas pontas e cortado no limite.
 */
export function normalizeContentNotice(value: unknown): ContentNotice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const { kind, text } = value as { kind?: unknown; text?: unknown };

  if (!isContentNoticeKind(kind)) {
    return null;
  }

  if (kind !== "custom") {
    return { kind };
  }

  const trimmed = typeof text === "string" ? text.trim().slice(0, CONTENT_NOTICE_TEXT_MAX).trim() : "";

  return trimmed ? { kind, text: trimmed } : null;
}

/** O texto que o aluno le: "Em breve", "Em gravação" ou o texto proprio. */
export function contentNoticeLabel(notice: ContentNotice): string {
  return notice.kind === "custom" ? notice.text : CONTENT_NOTICE_LABELS[notice.kind];
}

/** O texto do aviso de uma regra "sem data"; aviso gravado fora do formato cai em "Em breve". */
export function noDateNoticeLabel(notice: unknown): string {
  return contentNoticeLabel(normalizeContentNotice(notice) ?? DEFAULT_CONTENT_NOTICE);
}

/** A pilula escolhida no campo do admin. */
export type ContentNoticeChoice = ContentNoticeKind;

/** O aviso gravado -> o que o campo do admin mostra. */
export function contentNoticeToField(notice: ContentNotice | null | undefined): { choice: ContentNoticeChoice; text: string } {
  return { choice: notice?.kind ?? "coming_soon", text: notice?.kind === "custom" ? notice.text : "" };
}

/** O campo do admin -> o aviso que vai ao servidor; no texto proprio, vazio o servidor recusa. */
export function contentNoticeFromField(choice: ContentNoticeChoice, text: string): ContentNotice {
  return choice === "custom" ? { kind: "custom", text: text.trim() } : { kind: choice };
}
