"use client";

import { ChevronDown, Download, Plus, Search, Trash2, Upload } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { WEBINAR_ADMIN_COPY } from "@/server/webinars/editor-model";
import { CHAT_LIMITS, type PersonaRole, type ScriptItem, type ScriptItemDraft, type ScriptStatus, type ScriptTrigger, type WebinarSession, type WebinarTranscriptFormat } from "@/server/webinars/model";
import type { TranscriptSummary } from "@/server/webinars/queries";
import { deletePersona, savePersona } from "@/server/webinars/persona-actions";
import {
  LIVE_SCRIPT_TRIGGER_LABELS,
  NO_PERSONA_LIST,
  matchesPersonaSearch,
  personaAvatarUrl,
  personaCopyOf,
  personaUsage,
  withPersonaCopy,
  type PersonaDraft,
  type PersonaList as PersonaListData,
  type WebinarPersona
} from "@/server/webinars/persona-model";
import { exportScriptCsv, exportSessionChatCsv, importScriptCsv, resolveScriptPhrases, saveScriptItems, saveTranscript, uploadPersonaPhoto } from "@/server/webinars/script-actions";
import { SCRIPT_TRIGGER_LABELS, formatOffsetText, parseOffsetText, parseScriptCsv, scriptSummary, sortScriptItems, type ScriptCsvResult } from "@/server/webinars/script-model";
import { ErrorBanner } from "../../error-banner";
import { PillGroup, adminInputClass, adminTextareaClass } from "../../form";
import { ConfirmDialog } from "../../settings/kit";
import { StatusChip } from "../../status-chip";
import { adminToast } from "../../toast";
import { NEW_PERSONA_VALUE, PersonaForm, PersonaList, PersonaPicker } from "./persona-list";
import { PersonaPhotoField } from "./persona-photo-field";
import { minuteMarkOf, minuteMarkToMs } from "./simulation/simulation-card-model";

// Card "Roteiro de chat" do editor (docs/30 §2.2, §6.6 D6-b e D6-c; fase 2b): os itens em linhas editaveis (minuto,
// nome, papel, mensagem, Solta em, frase e atraso, situacao), Importar CSV (lido no navegador para a previa com os
// erros por linha, enviado ao servidor para gravar), Exportar CSV, o chat de uma sessao encerrada como CSV, a
// transcricao do video (colada ou enviada) e Resolver frases. O card guarda o proprio estado: o que vem das Server
// Actions e a verdade (os itens gravados, com a situacao decidida no servidor). Adendo de 10/11/2026 (R8 e R9): o card
// tambem no webinario ao vivo (`webinarKind` "live"): os gatilhos "Num minuto da live" (contado do Começar para todos)
// e "Pelo botão da equipe", a frase que diz por que "Quando o apresentador diz" nao existe na live e sem a transcricao;
// e, nos dois tipos, a Foto (opcional) de quem comenta em cada linha (persona-photo-field.tsx), com o "Usar esta foto em
// todos os comentários de {nome}" ligado por padrao (a foto vai para as linhas com o mesmo nome; o Salvar grava).
// Na live, o "Minuto da live" e lido como no card Simulação: o numero sozinho e minuto ("12" = 12 min) e "12:30" e
// minuto e segundo (minuteMarkToMs / minuteMarkOf); o CSV da live tambem (parseScriptCsv com `live`). O Salvar fica
// desligado enquanto uma foto sobe; manda os ids que o card carregou (`loadedIds`: o servidor so apaga desses, nunca um
// item que o console guardou depois) e so a foto que mudou (a que ficou igual nao vai, e a do banco fica: o "Usar esta
// foto em todos" do console nao e desfeito por um Salvar com a pagina velha).
//
// As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D75 a D78): no topo do card, a lista "Pessoas que
// comentam" do webinario (persona-list.tsx: Nova pessoa, Editar e Remover; a mesma do console), e em cada linha o "Quem
// comenta" vira a escolha de uma pessoa da lista (PersonaPicker, com a foto ou as iniciais), com "Criar nova pessoa"
// ali mesmo (o formulario da pessoa abre embaixo da linha e a nova entra na lista e na linha), e o "Tipo" (Comentário
// ou Pergunta: a Pergunta abre a pergunta simulada na aba Perguntas quando entra). A linha ligada a pessoa guarda a
// copia dela; editar a pessoa troca a copia em todas as linhas dela agora e no servidor (o Salvar manda o `personaId`,
// e o servidor grava a copia da pessoa). A linha ligada a ninguem (a pessoa saiu da lista) mostra o nome que guarda,
// "(fora da lista)". A caixa "Usar esta foto em todos" saiu: a pessoa e a unidade. No banco sem a lista (`initialPersonas`
// com `available` falso), o card segue como antes: o Nome, o Aparece como e a Foto em cada linha, e a frase da migracao
// no lugar da lista.
//
// As linhas fechadas (pedido do produtor de 13/11/2026, docs/30 D117: "se a gente criar 30 pessoas com 30 comentarios,
// fica uma lista enorme [...] Fica listando tudo aberto"): cada mensagem e uma linha so (o minuto ou o gatilho, a foto,
// o nome, o Tipo Pergunta, a situacao quando diz algo (rascunho, desligada, frase nao achada ou o minuto da frase; a
// "Pronta" de sempre nao repete em toda linha) e o comeco do texto) e so uma abre por vez, com os campos de sempre. Adicionar
// abre a nova; o Salvar com problema abre a primeira linha com problema. A partir de 9 mensagens, a lista fica numa
// caixa com rolagem propria e ganha a busca pelo nome ou pelo texto (sem acento nem caixa); a lista de pessoas da
// escola fica numa linha que abre para gerenciar (persona-list.tsx, D118).

const copy = WEBINAR_ADMIN_COPY.script;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;
const PESSOAS = WEBINAR_COPY.pessoas;

type Row = {
  body: string;
  id: string | null;
  key: string;
  kind: "message" | "question";
  offsetMs: number | null;
  offsetText: string;
  personaAvatarPath: string | null;
  /** A pessoa da lista (D75); nula sem pessoa (a linha nova ainda sem escolha, ou fora da lista). */
  personaId: string | null;
  personaName: string;
  personaRole: PersonaRole;
  phrase: string;
  phraseDelaySeconds: number;
  resolvedOffsetMs: number | null;
  status: ScriptStatus;
  triggerKind: ScriptTrigger;
};

type Failure = { message: string; status: number };

type ScriptCardProps = {
  disabled: boolean;
  hasRecording: boolean;
  /** O webinario arquivado (docs/30 §2.3): nada se grava; exportar o roteiro e o chat continua. */
  readOnly?: boolean;
  initialItems: readonly ScriptItem[];
  initialTranscript: TranscriptSummary | null;
  /** As sessoes gravadas (as encerradas oferecem o CSV do chat real). */
  sessions: readonly WebinarSession[];
  webinarId: string;
  /** O tipo do webinario: na Live ao vivo, os gatilhos da live e sem a transcricao (R8). */
  webinarKind?: "live" | "simulated";
  /** As linhas (pelo id do item) com a foto subindo ao desenhar (o teste de tela). */
  initialUploading?: readonly string[];
  /** As pessoas que comentam do webinario (D75); ausente ou `available` falso, o banco sem a lista. */
  initialPersonas?: PersonaListData;
  /** A linha (pela chave) com o formulario da pessoa nova aberto ao desenhar (o teste de tela). */
  initialCreatingFor?: string | null;
  /** A linha (pela chave, o id do item) aberta ao desenhar (o teste de tela). */
  initialOpenKey?: string | null;
  /** A busca do roteiro ja escrita ao desenhar (o teste de tela). */
  initialQuery?: string;
  /** A lista de pessoas aberta ao desenhar (o teste de tela). */
  initialPersonasOpen?: boolean;
  /** A origem do nosso Supabase (a foto de quem comenta na linha fechada); sem ela, a do ambiente. */
  origin?: string | null;
};

/** As linhas fechadas do roteiro (D117): a busca a partir de 9 mensagens, e a caixa com rolagem propria tambem. */
export const SCRIPT_COMPACT = { searchFrom: 9 } as const;

const TRIGGER_OPTIONS: readonly { label: string; value: ScriptTrigger }[] = [
  { label: SCRIPT_TRIGGER_LABELS.at_offset, value: "at_offset" },
  { label: SCRIPT_TRIGGER_LABELS.on_phrase, value: "on_phrase" },
  { label: SCRIPT_TRIGGER_LABELS.manual, value: "manual" }
];

/** Na Live ao vivo (R8): "Num minuto da live" e "Pelo botão da equipe" (sem transcricao durante a transmissao). */
const LIVE_TRIGGER_OPTIONS: readonly { label: string; value: ScriptTrigger }[] = [
  { label: LIVE_SCRIPT_TRIGGER_LABELS.at_offset, value: "at_offset" },
  { label: LIVE_SCRIPT_TRIGGER_LABELS.manual, value: "manual" }
];

const STATUS_TONE: Record<ScriptStatus, "muted" | "neutral" | "success" | "warning"> = { disabled: "muted", draft: "neutral", ready: "success", unresolved: "warning" };

let rowCounter = 0;

function rowKey() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

/** O tempo do campo: na live, o minuto da live ("12" ou "12:30"); na gravada, o minuto do video ("02:03"). */
function offsetTextOf(offsetMs: number, live: boolean): string {
  return live ? minuteMarkOf(offsetMs) : formatOffsetText(offsetMs);
}

/** O que foi digitado no campo do tempo, em ms (nulo: nao entendeu); na live, o numero sozinho e minuto. */
export function scriptOffsetInput(text: string, live: boolean): number | null {
  if (!live) {
    return parseOffsetText(text);
  }
  const ms = minuteMarkToMs(text);
  return ms !== null && ms <= CHAT_LIMITS.offsetMaxMs ? ms : null;
}

function rowOf(item: ScriptItem, live: boolean): Row {
  return {
    body: item.body,
    id: item.id,
    key: item.id,
    kind: item.kind,
    offsetMs: item.offsetMs,
    offsetText: item.offsetMs == null ? "" : offsetTextOf(item.offsetMs, live),
    personaAvatarPath: item.personaAvatarPath ?? null,
    personaId: item.personaId ?? null,
    personaName: item.personaName,
    personaRole: item.personaRole,
    phrase: item.phrase ?? "",
    phraseDelaySeconds: Math.round(item.phraseDelayMs / 1000),
    resolvedOffsetMs: item.resolvedOffsetMs,
    status: item.status,
    triggerKind: item.triggerKind
  };
}

function emptyRow(live: boolean): Row {
  return {
    body: "",
    id: null,
    key: rowKey(),
    kind: "message",
    offsetMs: 0,
    offsetText: offsetTextOf(0, live),
    personaAvatarPath: null,
    personaId: null,
    personaName: "",
    personaRole: "student",
    phrase: "",
    phraseDelaySeconds: 0,
    resolvedOffsetMs: null,
    status: "draft",
    triggerKind: "at_offset"
  };
}

/**
 * O que a Server Action recebe (a situacao final e do servidor; "disabled" e a unica escolha da tela). Com a lista
 * (`linked`), a pessoa da linha vai junto (nula: fora da lista), e o servidor grava a copia dela.
 */
function draftOf(row: Row, linked = false): ScriptItemDraft {
  return {
    body: row.body.trim(),
    id: row.id,
    kind: row.kind,
    offsetMs: row.triggerKind === "at_offset" ? row.offsetMs : null,
    personaAvatarPath: row.personaAvatarPath,
    ...(linked ? { personaId: row.personaId } : {}),
    personaName: row.personaName.trim(),
    personaRole: row.personaRole,
    phrase: row.triggerKind === "on_phrase" ? row.phrase.trim() || null : null,
    phraseDelayMs: Math.round(row.phraseDelaySeconds * 1000),
    status: row.status === "disabled" ? "disabled" : "draft",
    triggerKind: row.triggerKind
  };
}

/**
 * O que o Salvar manda (achado 3 da revisao de 11/11/2026): os rascunhos com a foto so quando ela mudou em relacao ao
 * item carregado (a que ficou igual vai ausente e o servidor mantem a do banco, que o console pode ter trocado pelo "Usar
 * esta foto em todos") e os ids carregados, os unicos que o servidor pode apagar.
 */
export function scriptSaveInput(drafts: readonly ScriptItemDraft[], loaded: readonly Pick<ScriptItem, "id" | "personaAvatarPath">[], webinarId: string): { items: ScriptItemDraft[]; loadedIds: string[]; webinarId: string } {
  const loadedPhotos = new Map(loaded.map((item) => [item.id, item.personaAvatarPath ?? null]));
  const items = drafts.map((draft) => {
    const unchanged = draft.id && loadedPhotos.has(draft.id) && loadedPhotos.get(draft.id) === (draft.personaAvatarPath ?? null);
    if (!unchanged) {
      return draft;
    }
    const rest = { ...draft };
    delete rest.personaAvatarPath;
    return rest;
  });
  return { items, loadedIds: loaded.map((item) => item.id), webinarId };
}

/** O Salvar vale: com mudanca, o card livre e nenhuma foto subindo (o envio no meio sairia sem a foto). */
export function scriptCanSave(input: { dirty: boolean; locked: boolean; uploading: number }): boolean {
  return input.dirty && !input.locked && input.uploading === 0;
}

/** Problemas que a tela aponta antes de enviar (o schema do servidor confere de novo). */
function rowProblem(row: Row, linked = false): string | null {
  if (!row.personaName.trim()) {
    return linked ? PESSOAS.erros.escolha : "Sem nome.";
  }
  if (!row.body.trim()) {
    return "Sem mensagem.";
  }
  if (row.kind === "question" && Array.from(row.body.trim()).length > CHAT_LIMITS.question) {
    return PESSOAS.erros.pergunta;
  }
  if (row.triggerKind === "at_offset" && row.offsetMs == null) {
    return "Tempo inválido.";
  }
  if (row.triggerKind === "on_phrase" && row.phrase.trim().length < CHAT_LIMITS.phraseMin) {
    return "Escreva a frase do apresentador.";
  }
  return null;
}

/** O que a linha fechada mostra antes do nome: o minuto (mm:ss), "Frase" ou "Botão". */
function whenLabel(row: Row): string {
  if (row.triggerKind === "manual") {
    return copy.row.manual;
  }
  if (row.triggerKind === "on_phrase") {
    return copy.row.phrase;
  }
  return row.offsetMs == null ? "—" : formatOffsetText(row.offsetMs);
}

function formatOf(fileName: string, text: string): WebinarTranscriptFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".srt")) {
    return "srt";
  }
  if (lower.endsWith(".vtt") || /^﻿?WEBVTT/.test(text)) {
    return "vtt";
  }
  if (/-->/.test(text)) {
    return /^\s*\d+\s*\r?\n\s*\d{1,2}:\d{2}:\d{2},\d{3}/m.test(text) ? "srt" : "vtt";
  }
  return "txt";
}

function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ScriptCard({
  disabled,
  hasRecording,
  initialCreatingFor = null,
  initialItems,
  initialOpenKey = null,
  initialPersonas = NO_PERSONA_LIST,
  initialPersonasOpen = false,
  initialQuery = "",
  initialTranscript,
  initialUploading = [],
  origin,
  readOnly = false,
  sessions,
  webinarId,
  webinarKind = "simulated"
}: ScriptCardProps) {
  const idBase = useId();
  const live = webinarKind === "live";
  const triggerOptions = live ? LIVE_TRIGGER_OPTIONS : TRIGGER_OPTIONS;
  const [rows, setRows] = useState<Row[]>(() => sortScriptItems(initialItems).map((item) => rowOf(item, live)));
  // As linhas com a foto subindo: o Salvar espera (o caminho da foto ainda nao chegou).
  const [uploading, setUploading] = useState<ReadonlySet<string>>(() => new Set(initialUploading));
  const [saved, setSaved] = useState<readonly ScriptItem[]>(initialItems);
  const [transcript, setTranscript] = useState<TranscriptSummary | null>(initialTranscript);
  const [transcriptText, setTranscriptText] = useState("");
  const [transcriptFormat, setTranscriptFormat] = useState<WebinarTranscriptFormat>("vtt");
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState<{ csv: string; fileName: string; preview: ScriptCsvResult; replace: boolean } | null>(null);
  const [chatSession, setChatSession] = useState<string>("");
  const csvInput = useRef<HTMLInputElement>(null);
  const transcriptInput = useRef<HTMLInputElement>(null);
  // As pessoas que comentam (D75): a lista do webinario e a linha com o formulario da pessoa nova aberto.
  const [personas, setPersonas] = useState<readonly WebinarPersona[]>(initialPersonas.personas);
  const [creatingFor, setCreatingFor] = useState<string | null>(initialCreatingFor);
  // As linhas fechadas (D117): a unica aberta, a busca e a linha que pede foco depois de abrir (a nova, a com problema).
  const [openKey, setOpenKey] = useState<string | null>(initialCreatingFor ?? initialOpenKey);
  const [query, setQuery] = useState(initialQuery);
  const focusRow = useRef<string | null>(null);
  const photoOrigin = origin === undefined ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null) : origin;
  const linked = initialPersonas.available;

  const summary = useMemo(() => scriptSummary(saved), [saved]);
  const dirty = useMemo(
    () => JSON.stringify(rows.map((row) => draftOf(row, linked))) !== JSON.stringify(sortScriptItems(saved).map((item) => draftOf(rowOf(item, live), linked))),
    [linked, live, rows, saved]
  );
  const usage = useMemo(() => Object.fromEntries(personas.map((persona) => [persona.id, personaUsage(rows, persona.id)])), [personas, rows]);
  const ended = sessions.filter((session) => session.kind !== "replay" && session.status === "ended");
  const compact = rows.length >= SCRIPT_COMPACT.searchFrom;
  // Abaixo de 9 mensagens a busca some, e nada fica escondido por uma busca que nao aparece.
  const activeQuery = compact ? query.trim() : "";
  const visible = rows.map((row, index) => ({ index, row })).filter(({ row }) => matchesPersonaSearch([row.personaName, row.body], activeQuery));

  // A linha que acabou de abrir (a nova, ou a primeira com problema no Salvar) aparece na caixa e recebe o foco.
  useEffect(() => {
    const key = focusRow.current;
    if (!key || openKey !== key) {
      return;
    }
    focusRow.current = null;
    const item = Array.from(document.querySelectorAll<HTMLElement>("[data-script-row-key]")).find((element) => element.dataset.scriptRowKey === key);
    item?.scrollIntoView({ block: "nearest" });
    item?.querySelector<HTMLElement>("[data-script-row-panel] select, [data-script-row-panel] input, [data-script-row-panel] textarea")?.focus();
  }, [openKey, rows]);
  // As exportacoes so leem: seguem no arquivado (`readOnly`), que tranca o resto do card.
  const reading = disabled || busy !== null;
  const locked = reading || readOnly;

  function applySaved(items: ScriptItem[]) {
    setSaved(items);
    setRows(sortScriptItems(items).map((item) => rowOf(item, live)));
    // A linha aberta continua aberta quando ja era um item gravado (a chave e o id); a nova ganha o id e fecha.
    setOpenKey((current) => (current && items.some((item) => item.id === current) ? current : null));
  }

  /** Abre a linha (e fecha a que estava aberta), ou fecha a aberta. */
  function toggleRow(key: string) {
    setOpenKey((current) => (current === key ? null : key));
  }

  /** Abre a linha e leva o foco ao primeiro campo dela; a busca sai para a linha aparecer. */
  function openAndFocus(key: string) {
    focusRow.current = key;
    setQuery("");
    setOpenKey(key);
  }

  function addRow() {
    const row = emptyRow(live);
    setRows((current) => [...current, row]);
    openAndFocus(row.key);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((item) => item.key !== key));
    setOpenKey((current) => (current === key ? null : current));
    if (creatingFor === key) {
      setCreatingFor(null);
    }
  }

  function setRowUploading(key: string, on: boolean) {
    setUploading((current) => {
      const next = new Set(current);
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function fail(result: { error: string; fieldErrors?: Record<string, string[] | undefined>; status: number }) {
    setFailure({ message: result.error, status: result.status });
    const errors: Record<string, string> = {};
    for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
      if (messages?.[0]) {
        errors[key] = messages[0];
      }
    }
    setFieldErrors(errors);
  }

  function updateRow(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  /** A foto da linha (R9; so no banco sem a lista: com ela, a foto e da pessoa). */
  function setPhoto(key: string, path: string | null) {
    updateRow(key, { personaAvatarPath: path });
  }

  /** O "Quem comenta" da linha (D75): a pessoa da lista (a copia dela vai para a linha) ou "Criar nova pessoa". */
  function pickPersona(key: string, value: string | null) {
    if (value === NEW_PERSONA_VALUE) {
      setCreatingFor(key);
      setOpenKey(key);
      return;
    }
    const persona = value ? (personas.find((item) => item.id === value) ?? null) : null;
    if (persona) {
      updateRow(key, personaCopyOf(persona));
    }
  }

  /** Criar ou editar uma pessoa da lista: a lista e as linhas dela mudam agora (as copias), e o servidor tambem. */
  async function submitPersona(draft: PersonaDraft, rowKeyToLink: string | null = null) {
    setBusy("persona");
    setFailure(null);
    const result = await savePersona({ avatarPath: draft.avatarPath, id: draft.id ?? null, name: draft.name, role: draft.role, webinarId });
    setBusy(null);
    if (!result.ok) {
      return result;
    }
    const persona = result.data.persona;
    setPersonas((current) => [...current.filter((item) => item.id !== persona.id), persona]);
    setRows((current) => {
      const copied = withPersonaCopy(current, persona);
      return rowKeyToLink ? copied.map((row) => (row.key === rowKeyToLink ? { ...row, ...personaCopyOf(persona) } : row)) : copied;
    });
    // O que ja estava gravado com a pessoa tambem tem a copia nova no servidor (o card nao fica "nao salvo" por isso).
    setSaved((current) => withPersonaCopy(current, persona));
    if (rowKeyToLink) {
      setCreatingFor(null);
    }
    adminToast.success(result.data.created ? PESSOAS.avisos.criada(persona.name) : PESSOAS.avisos.salva);
    if (result.data.items > 0) {
      adminToast.info(PESSOAS.avisos.copias(result.data.items));
    }
    return result;
  }

  /** Remover a pessoa da lista: as linhas dela ficam com a copia, fora da lista. */
  async function removePersona(persona: WebinarPersona) {
    setBusy("persona");
    setFailure(null);
    const result = await deletePersona({ id: persona.id, webinarId });
    setBusy(null);
    if (!result.ok) {
      return result;
    }
    const unlink = <T extends { personaId?: string | null }>(items: readonly T[]) => items.map((item) => (item.personaId === persona.id ? { ...item, personaId: null } : item));
    setPersonas((current) => current.filter((item) => item.id !== persona.id));
    setRows((current) => unlink(current));
    setSaved((current) => unlink(current));
    adminToast.success(PESSOAS.avisos.removida(persona.name));
    return result;
  }

  async function save() {
    const problem = rows.map((row, index) => ({ index, problem: rowProblem(row, linked) })).find((entry) => entry.problem);
    if (problem) {
      setFailure({ message: `Mensagem ${problem.index + 1}: ${problem.problem}`, status: 400 });
      // A linha com problema abre (as outras fecham) para a equipe corrigir ali.
      openAndFocus(rows[problem.index].key);
      return;
    }
    if (uploading.size > 0) {
      return;
    }
    setBusy("save");
    setFailure(null);
    setFieldErrors({});
    const result = await saveScriptItems(scriptSaveInput(rows.map((row) => draftOf(row, linked)), saved, webinarId));
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    applySaved(result.data.items);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptSaved);
  }

  async function readCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const csv = await file.text();
    setImporting({ csv, fileName: file.name, preview: parseScriptCsv(csv, { live }), replace: false });
  }

  async function confirmImport() {
    if (!importing) {
      return;
    }
    setBusy("import");
    setFailure(null);
    const result = await importScriptCsv({ csv: importing.csv, replace: importing.replace, webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    setImporting(null);
    applySaved(result.data.items);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptImported(result.data.imported));
  }

  async function exportScript() {
    setBusy("export");
    const result = await exportScriptCsv({ webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    downloadCsv(result.data.csv, result.data.fileName);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.scriptExported);
  }

  async function exportChat() {
    if (!chatSession) {
      return;
    }
    setBusy("export-chat");
    const result = await exportSessionChatCsv({ sessionId: chatSession });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    downloadCsv(result.data.csv, result.data.fileName);
    adminToast.success(WEBINAR_ADMIN_COPY.toasts.chatExported);
  }

  async function readTranscriptFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    const text = await file.text();
    setTranscriptText(text);
    setTranscriptFormat(formatOf(file.name, text));
  }

  async function submitTranscript() {
    if (!transcriptText.trim()) {
      return;
    }
    setBusy("transcript");
    setFailure(null);
    setFieldErrors({});
    const result = await saveTranscript({ format: transcriptFormat, text: transcriptText, webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    setTranscript(result.data.transcript);
    setTranscriptText("");
    applySaved(result.data.items);
    adminToast.success(`${WEBINAR_ADMIN_COPY.toasts.transcriptSaved} ${copy.resolved(result.data.ready, result.data.unresolved)}`);
  }

  async function resolve() {
    setBusy("resolve");
    setFailure(null);
    const result = await resolveScriptPhrases({ webinarId });
    setBusy(null);
    if (!result.ok) {
      fail(result);
      return;
    }
    applySaved(result.data.items);
    adminToast.success(`${WEBINAR_ADMIN_COPY.toasts.phrasesResolved} ${copy.resolved(result.data.ready, result.data.unresolved)}`);
  }

  const working = (label: string, key: string) => (busy === key ? copy.saving : label);

  return (
    <div className="flex min-w-0 flex-col gap-5" data-script-card="">
      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
          title={WEBINAR_ADMIN_COPY.failures.generic}
        >
          {failure.message}
          {Object.keys(fieldErrors).length > 0 ? ` ${Object.values(fieldErrors)[0]}` : ""}
        </ErrorBanner>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" disabled={locked} onClick={() => csvInput.current?.click()} type="button" variant="secondary">
          <Upload aria-hidden="true" className="size-4" />
          {copy.importCsv}
        </Button>
        <input accept=".csv,text/csv" className="sr-only" data-script-csv-input="" onChange={(event) => void readCsv(event)} ref={csvInput} tabIndex={-1} type="file" />
        <Button className="px-3" disabled={reading || saved.length === 0} onClick={() => void exportScript()} type="button" variant="secondary">
          <Download aria-hidden="true" className="size-4" />
          {copy.exportCsv}
        </Button>
        <span className="text-xs leading-5 text-[var(--text-secondary)]" data-script-csv-hint="">
          {live ? COMENTARIOS.csvDicaLive : copy.csvHint}
        </span>
      </div>

      <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]" data-script-summary="">
        {copy.summary(summary)}
        {dirty ? ` · ${copy.unsaved}` : ""}
      </p>

      {/* As pessoas que comentam (D75): a lista do webinario, a mesma do console; no banco sem ela, a frase da migracao. */}
      <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--border-subtle)] pb-4" data-script-personas="">
        <PersonaList
          available={linked}
          busy={busy !== null || disabled}
          initialOpen={initialPersonasOpen}
          onDelete={removePersona}
          onSave={(draft) => submitPersona(draft)}
          onUpload={(image) => uploadPersonaPhoto({ image })}
          origin={photoOrigin}
          personas={personas}
          readOnly={readOnly}
          usage={usage}
        />
      </div>

      {rows.length === 0 ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.empty}</p> : null}
      {live ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-script-live-hint="">
          {COMENTARIOS.semFraseNaLive}
        </p>
      ) : null}

      {compact ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
            {copy.search.label}
            <span className="relative flex min-w-0 items-center">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 size-4 text-[var(--text-tertiary)]" />
              <input className={cn(adminInputClass, "pl-9")} data-script-search="" onChange={(event) => setQuery(event.target.value)} placeholder={copy.search.placeholder} type="search" value={query} />
            </span>
          </label>
          {activeQuery ? (
            <p aria-live="polite" className="text-xs leading-5 text-[var(--text-secondary)]" data-script-search-count="">
              {visible.length === 0 ? copy.search.empty(activeQuery) : copy.search.count(visible.length, rows.length)}
            </p>
          ) : null}
        </div>
      ) : null}

      {visible.length > 0 ? (
        <ol className={cn("flex min-w-0 flex-col gap-2", compact && "max-h-[min(70vh,640px)] overflow-y-auto pr-1")} data-script-rows="">
          {visible.map(({ index, row }) => {
            const base = `${idBase}-${row.key}`;
            const open = openKey === row.key;
            const panelId = `${base}-painel`;
            const statusLabel = copy.statuses[row.status];
            const resolvedLabel = row.triggerKind === "on_phrase" && row.resolvedOffsetMs != null ? ` · ${formatOffsetText(row.resolvedOffsetMs)}` : "";
            const text = row.body.trim();

            return (
              <li
                className={cn("flex min-w-0 flex-col rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]", row.status === "disabled" && !open && "opacity-70")}
                data-script-open={open ? "true" : "false"}
                data-script-row={index}
                data-script-row-key={row.key}
                key={row.key}
              >
                {/* A linha fechada (D117): o minuto ou o gatilho, a foto, o nome, os selos e o comeco do texto. */}
                <div className="flex min-w-0 items-center gap-1 py-1 pr-1 pl-3">
                  <button
                    aria-controls={panelId}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-1.5 text-left focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-solid"
                    data-script-row-toggle=""
                    onClick={() => toggleRow(row.key)}
                    type="button"
                  >
                    <span className="w-12 shrink-0 text-xs leading-5 text-[var(--text-secondary)] tabular-nums" data-script-row-when="">
                      {whenLabel(row)}
                    </span>
                    <RoomCommentAvatar imageSrc={personaAvatarUrl(row.personaAvatarPath, photoOrigin)} kind={row.personaRole === "team" ? "team" : "person"} name={row.personaName} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* No celular os selos descem para baixo do nome; "Pronta" so aparece na frase (com o minuto achado). */}
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="sr-only">{copy.row.label(index + 1)}: </span>
                        <span className="max-w-full truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{row.personaName.trim() || copy.row.noPerson}</span>
                        {row.kind === "question" ? <StatusChip tone="neutral">{PESSOAS.seloPergunta}</StatusChip> : null}
                        {row.status !== "ready" || row.triggerKind === "on_phrase" ? (
                          <StatusChip tone={STATUS_TONE[row.status]}>
                            {statusLabel}
                            {resolvedLabel}
                          </StatusChip>
                        ) : null}
                      </span>
                      <span className={cn("truncate text-[13px] leading-5", text ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)] italic")} data-script-row-text="">
                        {text || copy.row.noText}
                      </span>
                    </span>
                    <ChevronDown aria-hidden="true" className={cn("size-4 shrink-0 text-[var(--text-tertiary)] transition-transform motion-reduce:transition-none", open && "rotate-180")} />
                  </button>
                  <Button aria-label={`${copy.remove} ${index + 1}`} className="px-2 text-[var(--text-secondary)]" disabled={locked} onClick={() => removeRow(row.key)} type="button" variant="ghost">
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>

                {open ? (
                  <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] p-3" data-script-row-panel="" id={panelId}>
                  {linked ? (
                    <>
                      {/* "Quem comenta" (D75): a pessoa da lista, com a foto ou as iniciais, ou "Criar nova pessoa" ali mesmo. */}
                      <PersonaPicker
                        disabled={locked}
                        fallbackName={row.personaId ? null : row.personaName.trim() || null}
                        id={`${base}-pessoa`}
                        onChange={(value) => pickPersona(row.key, value)}
                        personas={personas}
                        value={creatingFor === row.key ? NEW_PERSONA_VALUE : row.personaId}
                      />
                      {creatingFor === row.key ? (
                        <PersonaForm
                          busy={busy !== null}
                          editing={null}
                          onCancel={() => setCreatingFor(null)}
                          onSave={(draft) => submitPersona(draft, row.key)}
                          onUpload={(image) => uploadPersonaPhoto({ image })}
                          personas={personas}
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                          {copy.columns.name}
                          <input className={adminInputClass} disabled={locked} maxLength={CHAT_LIMITS.personaName} onChange={(event) => updateRow(row.key, { personaName: event.target.value })} type="text" value={row.personaName} />
                        </label>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.columns.role}</span>
                          <PillGroup
                            ariaLabel={`${copy.columns.role} da mensagem ${index + 1}`}
                            disabled={locked}
                            name={`${base}-role`}
                            onChange={(personaRole: PersonaRole) => updateRow(row.key, { personaRole })}
                            options={[
                              { label: copy.roles.student, value: "student" },
                              { label: copy.roles.team, value: "team" }
                            ]}
                            value={row.personaRole}
                          />
                        </div>
                      </div>

                      <PersonaPhotoField
                        disabled={locked}
                        idBase={`${base}-persona`}
                        name={row.personaName}
                        onChange={(path) => setPhoto(row.key, path)}
                        onUpload={(image) => uploadPersonaPhoto({ image })}
                        onUploadingChange={(on) => setRowUploading(row.key, on)}
                        path={row.personaAvatarPath}
                        uploading={uploading.has(row.key)}
                      />
                    </>
                  )}

                  {/* O Tipo (D77): o comentario no chat ou a pergunta simulada na aba Perguntas (pede a lista no banco). */}
                  {linked ? (
                    <div className="flex min-w-0 flex-col gap-1.5" data-script-kind="">
                      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{PESSOAS.tipo}</span>
                      <PillGroup
                        ariaLabel={`${PESSOAS.tipo} da mensagem ${index + 1}`}
                        disabled={locked}
                        name={`${base}-tipo`}
                        onChange={(kind: Row["kind"]) => updateRow(row.key, { kind })}
                        options={[
                          { label: PESSOAS.tipos.message, value: "message" },
                          { label: PESSOAS.tipos.question, value: "question" }
                        ]}
                        value={row.kind}
                      />
                    </div>
                  ) : null}

                  <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                    {row.kind === "question" ? PESSOAS.pergunta : copy.columns.body}
                    <textarea
                      className={cn(adminTextareaClass, "min-h-16")}
                      disabled={locked}
                      maxLength={row.kind === "question" ? CHAT_LIMITS.question : CHAT_LIMITS.body}
                      onChange={(event) => updateRow(row.key, { body: event.target.value })}
                      rows={2}
                      value={row.body}
                    />
                  </label>

                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{copy.columns.trigger}</span>
                    <PillGroup ariaLabel={`${copy.columns.trigger} da mensagem ${index + 1}`} disabled={locked} name={`${base}-trigger`} onChange={(triggerKind: ScriptTrigger) => updateRow(row.key, { triggerKind })} options={triggerOptions} value={row.triggerKind} />
                  </div>

                  {row.triggerKind === "at_offset" ? (
                    <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                      {live ? COMENTARIOS.minutoDaLive : copy.columns.time}
                      <input
                        aria-invalid={row.offsetMs == null ? true : undefined}
                        className={cn(adminInputClass, "w-36")}
                        disabled={locked}
                        inputMode="numeric"
                        onBlur={() => updateRow(row.key, { offsetText: row.offsetMs == null ? row.offsetText : offsetTextOf(row.offsetMs, live) })}
                        onChange={(event) => updateRow(row.key, { offsetMs: scriptOffsetInput(event.target.value, live), offsetText: event.target.value })}
                        placeholder={live ? "12:30" : copy.timePlaceholder}
                        type="text"
                        value={row.offsetText}
                      />
                      {live ? <span className="text-xs leading-5 font-normal text-[var(--text-secondary)]">{COMENTARIOS.minutoDaLiveDica}</span> : null}
                    </label>
                  ) : null}

                  {row.triggerKind === "on_phrase" ? (
                    <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,120px)]">
                      <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                        {copy.columns.phrase}
                        <input className={adminInputClass} disabled={locked} maxLength={CHAT_LIMITS.phraseMax} onChange={(event) => updateRow(row.key, { phrase: event.target.value })} type="text" value={row.phrase} />
                      </label>
                      <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
                        {copy.columns.delay}
                        <input
                          className={adminInputClass}
                          disabled={locked}
                          inputMode="numeric"
                          max={CHAT_LIMITS.phraseDelayMaxMs / 1000}
                          min={CHAT_LIMITS.phraseDelayMinMs / 1000}
                          onChange={(event) => updateRow(row.key, { phraseDelaySeconds: Math.trunc(Number(event.target.value)) || 0 })}
                          type="number"
                          value={row.phraseDelaySeconds}
                        />
                      </label>
                      {!transcript ? <p className="text-xs leading-5 text-[var(--text-secondary)] sm:col-span-2">{copy.transcriptNone}</p> : null}
                    </div>
                  ) : null}
                    <div className="flex min-w-0 justify-end">
                      <Button className="px-2 text-[var(--text-secondary)]" disabled={locked} onClick={() => updateRow(row.key, { status: row.status === "disabled" ? "draft" : "disabled" })} type="button" variant="ghost">
                        {row.status === "disabled" ? copy.toggleOn : copy.toggleOff}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" data-script-add="" disabled={locked || rows.length >= CHAT_LIMITS.scriptItemsMax} onClick={addRow} type="button" variant="secondary">
          <Plus aria-hidden="true" className="size-4" />
          {copy.add}
        </Button>
        <Button className="px-4" data-script-save="" disabled={!scriptCanSave({ dirty, locked, uploading: uploading.size })} onClick={() => void save()} type="button">
          {working(copy.save, "save")}
        </Button>
      </div>

      {/* A transcricao e as frases so na gravada: na live ao vivo nao ha transcricao durante a transmissao (R8). */}
      {live ? null : (
        <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
          <span className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{copy.transcriptTitle}</span>
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-transcript-summary="">
            {transcript ? copy.transcriptSummary(transcript.cues, transcript.format, formatSaoPauloDateTime(transcript.updatedAt)) : copy.transcriptNone}
          </p>
          {!hasRecording ? <p className="text-[13px] leading-5 text-[var(--warning)]">{copy.noRecording}</p> : null}
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">
            {copy.transcriptPaste}
            <textarea
              aria-invalid={fieldErrors.text ? true : undefined}
              className={cn(adminTextareaClass, "min-h-24 font-mono text-xs")}
              disabled={locked || !hasRecording}
              onChange={(event) => {
                setTranscriptText(event.target.value);
                setTranscriptFormat(formatOf("", event.target.value));
              }}
              placeholder="WEBVTT…"
              rows={4}
              value={transcriptText}
            />
          </label>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.transcriptHint}</p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button className="px-3" disabled={locked || !hasRecording} onClick={() => transcriptInput.current?.click()} type="button" variant="secondary">
              <Upload aria-hidden="true" className="size-4" />
              {copy.transcriptFile}
            </Button>
            <input accept=".vtt,.srt,.txt,text/vtt,text/plain" className="sr-only" data-transcript-input="" onChange={(event) => void readTranscriptFile(event)} ref={transcriptInput} tabIndex={-1} type="file" />
            <Button className="px-3" disabled={locked || !hasRecording || !transcriptText.trim()} onClick={() => void submitTranscript()} type="button">
              {working(copy.transcriptSave, "transcript")}
            </Button>
            <Button className="px-3" disabled={locked || !transcript} onClick={() => void resolve()} type="button" variant="secondary">
              {working(copy.resolve, "resolve")}
            </Button>
          </div>
        </div>
      )}

      {ended.length > 0 ? (
        <div className="flex min-w-0 flex-col gap-2 border-t border-[var(--border-subtle)] pt-4">
          <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={`${idBase}-chat-session`}>
            {copy.exportChat}
            <select className={cn(adminInputClass, "max-w-sm")} disabled={reading} id={`${idBase}-chat-session`} onChange={(event) => setChatSession(event.target.value)} value={chatSession}>
              <option value="">—</option>
              {ended.map((session) => (
                <option key={session.id} value={session.id}>
                  {WEBINAR_ADMIN_COPY.fields.sessionSaved(formatSaoPauloDateTime(session.scheduledAt))}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{copy.exportChatHint}</p>
          <div>
            <Button className="px-3" disabled={reading || !chatSession} onClick={() => void exportChat()} type="button" variant="secondary">
              <Download aria-hidden="true" className="size-4" />
              {copy.exportCsv}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        busy={busy === "import"}
        confirmLabel={copy.importConfirm}
        onConfirm={() => void confirmImport()}
        onOpenChange={(open) => {
          if (!open) {
            setImporting(null);
          }
        }}
        open={importing !== null}
        title={copy.importTitle}
      >
        {importing ? (
          <div className="flex min-w-0 flex-col gap-3 text-sm leading-5 text-[var(--text-primary)]" data-script-import-preview="">
            <p className="text-[var(--text-secondary)]">{importing.fileName}</p>
            <p>{importing.preview.items.length > 0 ? copy.importPreview(importing.preview.items.length) : copy.importNothing}</p>
            {importing.preview.truncated ? <p className="text-[var(--warning)]">{copy.importTruncated}</p> : null}
            {importing.preview.errors.length > 0 ? (
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-[var(--warning)]">{copy.importErrors(importing.preview.errors.length)}</p>
                <ul className="max-h-40 overflow-y-auto text-[13px] text-[var(--text-secondary)]">
                  {importing.preview.errors.slice(0, 50).map((error) => (
                    <li key={`${error.line}-${error.message}`}>{copy.importLine(error.line, error.message)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PillGroup
              ariaLabel={copy.importTitle}
              name={`${idBase}-import-mode`}
              onChange={(mode: "append" | "replace") => setImporting((current) => (current ? { ...current, replace: mode === "replace" } : current))}
              options={[
                { label: copy.importAppend, value: "append" },
                { label: copy.importReplace, value: "replace" }
              ]}
              value={importing.replace ? "replace" : "append"}
            />
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
