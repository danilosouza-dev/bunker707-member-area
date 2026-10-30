// O roteiro de chat da Live gravada, a parte pura (docs/30 §1.6, §2.2 "Roteiro de chat", §6.6 D6): o CSV de
// quatro colunas (Tempo;Nome;Papel;Mensagem), o tempo escrito de varios jeitos, a ordem dos itens e a busca da
// frase do apresentador nas cues da transcricao ("Quando o apresentador diz"). Sem "server-only", imports
// relativos: tests/webinarios-*.test.mjs carregam direto pelo Node.

import { parseCsv, toCsv } from "../../lib/csv";
import { CHAT_LIMITS, type ScriptItem, type ScriptItemDraft, type ScriptTrigger } from "./model";

export const SCRIPT_CSV_HEADERS = ["Tempo", "Nome", "Papel", "Mensagem"] as const;

/** Como a coluna Papel pode vir no CSV (sem acento, sem caixa): aluno ou equipe. */
const PERSONA_WORDS: Record<string, "student" | "team"> = {
  aluno: "student",
  aluna: "student",
  student: "student",
  participante: "student",
  equipe: "team",
  team: "team",
  host: "team",
  apresentador: "team",
  moderador: "team",
  staff: "team"
};

function stripAccents(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * "1:02:03", "02:03", "63", "63s", "1m3s", "1h2m3s", "-0:30", "1:02:03.5"; tambem aceita o tempo relativo da
 * sala de espera (negativo). Devolve ms, ou nulo quando nao entende.
 */
export function parseOffsetText(input: string | number | null | undefined): number | null {
  if (typeof input === "number") {
    return Number.isFinite(input) ? Math.round(input * 1000) : null;
  }
  const raw = (input ?? "").trim().toLowerCase().replace(",", ".");
  if (!raw) {
    return null;
  }
  const negative = raw.startsWith("-");
  const text = negative ? raw.slice(1).trim() : raw;
  let seconds: number | null = null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    seconds = Number(text);
  } else if (/^\d{1,3}(:\d{1,2}){1,2}(\.\d+)?$/.test(text)) {
    const parts = text.split(":").map(Number);
    if (parts.some((part, index) => index > 0 && part >= 60)) {
      return null;
    }
    seconds = parts.reduce((total, part) => total * 60 + part, 0);
  } else {
    const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/.exec(text);
    if (!match || (!match[1] && !match[2] && !match[3])) {
      return null;
    }
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }

  const ms = Math.round(seconds * 1000) * (negative ? -1 : 1);
  return ms >= CHAT_LIMITS.offsetMinMs && ms <= CHAT_LIMITS.offsetMaxMs ? ms : null;
}

/** "1:02:03" ou "02:03" (e "-00:30" na espera), o formato do CSV e da linha do tempo. */
export function formatOffsetText(offsetMs: number): string {
  const negative = offsetMs < 0;
  const total = Math.round(Math.abs(offsetMs) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  const text = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  return negative ? `-${text}` : text;
}

/** O minuto do video em que o item entra (nulo no manual e na frase ainda nao resolvida). */
export function scriptOffsetOf(item: Pick<ScriptItemDraft, "offsetMs" | "triggerKind"> & { resolvedOffsetMs?: number | null }): number | null {
  if (item.triggerKind === "at_offset") {
    return item.offsetMs;
  }
  if (item.triggerKind === "on_phrase") {
    return item.resolvedOffsetMs ?? null;
  }
  return null;
}

/** Pelo minuto (os sem minuto no fim), depois pela posicao. */
export function sortScriptItems<T extends { position: number } & Parameters<typeof scriptOffsetOf>[0]>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    const offsetA = scriptOffsetOf(a);
    const offsetB = scriptOffsetOf(b);
    if (offsetA == null && offsetB == null) {
      return a.position - b.position;
    }
    if (offsetA == null) {
      return 1;
    }
    if (offsetB == null) {
      return -1;
    }
    return offsetA - offsetB || a.position - b.position;
  });
}

export type ScriptCsvError = { line: number; message: string };

export type ScriptCsvResult = { errors: ScriptCsvError[]; items: ScriptItemDraft[]; truncated: boolean };

function headerIndex(headers: readonly string[], wanted: string): number {
  const target = stripAccents(wanted).toLowerCase();
  return headers.findIndex((header) => stripAccents(header).trim().toLowerCase() === target);
}

/**
 * Le o CSV do roteiro (o nosso, o da live real exportado ou o de outra ferramenta): cabecalho obrigatorio com as
 * quatro colunas em qualquer ordem, separador "," ou ";" pelo cabecalho, ate 5 000 linhas e 1 MB. Linha ruim vira
 * erro com o numero dela e nao entra; as boas entram como `at_offset` prontos. O chamador decide se substitui ou
 * acrescenta ao roteiro.
 */
export function parseScriptCsv(text: string): ScriptCsvResult {
  const errors: ScriptCsvError[] = [];
  if (new TextEncoder().encode(text).length > CHAT_LIMITS.scriptCsvBytes) {
    return { errors: [{ line: 0, message: `O arquivo passa de ${Math.round(CHAT_LIMITS.scriptCsvBytes / 1024)} KB.` }], items: [], truncated: false };
  }
  const parsed = parseCsv(text, { maxColumns: 16, maxRows: CHAT_LIMITS.scriptItemsMax });
  const columns = {
    body: headerIndex(parsed.headers, "Mensagem"),
    name: headerIndex(parsed.headers, "Nome"),
    role: headerIndex(parsed.headers, "Papel"),
    time: headerIndex(parsed.headers, "Tempo")
  };
  const missing = SCRIPT_CSV_HEADERS.filter((header) => headerIndex(parsed.headers, header) === -1);
  if (missing.length > 0) {
    return { errors: [{ line: 1, message: `Faltam as colunas: ${missing.join(", ")}.` }], items: [], truncated: parsed.truncated };
  }

  const items: ScriptItemDraft[] = [];
  parsed.rows.forEach((row, index) => {
    const line = index + 2;
    const offsetMs = parseOffsetText(row[columns.time] ?? "");
    const personaName = (row[columns.name] ?? "").trim().slice(0, CHAT_LIMITS.personaName);
    const roleWord = stripAccents((row[columns.role] ?? "").trim().toLowerCase());
    const personaRole = PERSONA_WORDS[roleWord] ?? (roleWord === "" ? "student" : null);
    const body = (row[columns.body] ?? "").trim();

    if (offsetMs == null) {
      errors.push({ line, message: `Tempo inválido: "${row[columns.time] ?? ""}".` });
      return;
    }
    if (!personaName) {
      errors.push({ line, message: "Sem nome." });
      return;
    }
    if (!personaRole) {
      errors.push({ line, message: `Papel inválido: "${row[columns.role]}" (use Aluno ou Equipe).` });
      return;
    }
    if (!body) {
      errors.push({ line, message: "Sem mensagem." });
      return;
    }
    if (body.length > CHAT_LIMITS.body) {
      errors.push({ line, message: `Mensagem com mais de ${CHAT_LIMITS.body} caracteres.` });
      return;
    }
    items.push({ body, kind: "message", offsetMs, personaName, personaRole, phrase: null, phraseDelayMs: 0, status: "ready", triggerKind: "at_offset" });
  });

  return { errors, items, truncated: parsed.truncated };
}

/** O CSV do roteiro (e o do chat de uma live real) no formato que a importacao le de volta. */
export function formatScriptCsv(items: readonly { body: string; offsetMs: number | null; personaName: string; personaRole: "student" | "team" }[]): string {
  const rows = items
    .filter((item) => item.offsetMs != null)
    .map((item) => [formatOffsetText(item.offsetMs ?? 0), item.personaName, item.personaRole === "team" ? "Equipe" : "Aluno", item.body]);
  return toCsv(SCRIPT_CSV_HEADERS, rows, ";");
}

/** Texto sem acento, sem pontuacao, em minusculas e com um espaco so, para comparar frases. */
export function normalizePhrase(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PhraseCue = { startSeconds: number; text: string };

export type PhraseMatch = { cueIndex: number; score: number; startSeconds: number };

/**
 * Acha a frase nas cues da transcricao: primeiro a frase inteira dentro de uma cue (ou de duas vizinhas), depois a
 * cue com mais palavras em comum (pelo menos 60 % delas, e ao menos duas). Devolve o comeco em segundos, ou nulo.
 */
export function resolvePhrase(cues: readonly PhraseCue[], phrase: string): PhraseMatch | null {
  const target = normalizePhrase(phrase);
  if (target.length < CHAT_LIMITS.phraseMin || cues.length === 0) {
    return null;
  }
  const normalized = cues.map((cue) => normalizePhrase(cue.text));

  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index].includes(target)) {
      return { cueIndex: index, score: 1, startSeconds: cues[index].startSeconds };
    }
    if (index + 1 < normalized.length && `${normalized[index]} ${normalized[index + 1]}`.includes(target)) {
      return { cueIndex: index, score: 0.95, startSeconds: cues[index].startSeconds };
    }
  }

  const words = target.split(" ").filter((word) => word.length > 2);
  if (words.length < 2) {
    return null;
  }
  let best: PhraseMatch | null = null;
  normalized.forEach((text, index) => {
    const bag = new Set(text.split(" "));
    const hits = words.filter((word) => bag.has(word)).length;
    const score = hits / words.length;
    if (hits >= 2 && score >= 0.6 && (!best || score > best.score)) {
      best = { cueIndex: index, score, startSeconds: cues[index].startSeconds };
    }
  });
  return best;
}

/** O que a resolucao grava no item: pronto com o minuto (frase + atraso), ou `unresolved` quando nao achou. */
export function resolvedScriptItem<T extends Pick<ScriptItemDraft, "phrase" | "phraseDelayMs" | "status" | "triggerKind">>(
  item: T,
  cues: readonly PhraseCue[]
): { resolvedOffsetMs: number | null; status: ScriptItemDraft["status"] } {
  if (item.triggerKind !== "on_phrase" || item.status === "disabled") {
    return { resolvedOffsetMs: null, status: item.status };
  }
  const match = item.phrase ? resolvePhrase(cues, item.phrase) : null;
  if (!match) {
    return { resolvedOffsetMs: null, status: "unresolved" };
  }
  const offset = Math.round(match.startSeconds * 1000) + item.phraseDelayMs;
  return { resolvedOffsetMs: Math.min(CHAT_LIMITS.offsetMaxMs, Math.max(CHAT_LIMITS.offsetMinMs, offset)), status: "ready" };
}

/** Quantos itens entram sozinhos na sessao (prontos e com minuto) e quantos esperam o botao ou a frase. */
export function scriptSummary(items: readonly Pick<ScriptItem, "offsetMs" | "resolvedOffsetMs" | "status" | "triggerKind">[]): {
  disabled: number;
  manual: number;
  ready: number;
  unresolved: number;
} {
  return items.reduce(
    (summary, item) => {
      if (item.status === "disabled") {
        summary.disabled += 1;
      } else if (item.triggerKind === "manual") {
        summary.manual += 1;
      } else if (item.status === "ready" && scriptOffsetOf(item) != null) {
        summary.ready += 1;
      } else {
        summary.unresolved += 1;
      }
      return summary;
    },
    { disabled: 0, manual: 0, ready: 0, unresolved: 0 }
  );
}

export const SCRIPT_TRIGGER_LABELS: Record<ScriptTrigger, string> = {
  at_offset: "Num minuto do vídeo",
  manual: "Pelo botão da equipe",
  on_phrase: "Quando o apresentador diz"
};
