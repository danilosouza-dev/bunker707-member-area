import "server-only";

// Pop-ups do aluno (docs/22 §1.3; v3b-1, docs/25 §4.3 a §4.8): nas paginas, no momento e quantas vezes a
// equipe escolheu, so para quem esta no segmento (linha elegivel em campaign_deliveries, mantida pelo job) e
// nunca de novo depois de "Não mostrar de novo". Sem limite entre pop-ups (decisao do produtor, docs/24
// §10.8): cada um segue a propria frequencia; o navegador mostra um de cada vez. Mapa + plano + show:
// - a lista curta de pop-ups no ar fica em cache (60 s, tag "communications"), com o conteudo e a
//   configuracao de cada um (formacao ja expandida para os cursos); nunca dado de aluno;
// - o resumo do sino leva o mapa grosso das paginas (sem id de produto, sai do cache sem ir ao banco) e, so
//   na pagina coberta, o plano do aluno (ids e horarios, sem conteudo) numa consulta;
// - o show confere tudo de novo, grava a abertura de forma atomica (RPC com o updated_at lido) e so entao
//   devolve o conteudo e quando o pop-up pode voltar.
// A equipe nunca tem linha de entrega: nunca ve pop-up. Os caminhos da v1 (?popup=1 e o evento "impressed")
// continuam para as abas abertas antes do deploy. v2 (docs/23): sem icone, a chave nem vai; v3b-1: `close`
// so vai no "Só no X" (o pop-up padrao fica igual ao da v1).
// Design do pop-up (docs/26): a lista no ar leva o design de cada pop-up (lido pelo schema; invalido = Padrão;
// endereco do video recalculado do caminho) e as fontes enviadas resolvidas numa consulta so. `design` e
// `fonts` so vao no Personalizado (o Padrão continua com a resposta de antes).
// Design Livre (docs/27 §2.1 e §5.1): lido pelo roteador; um Livre invalido no banco sai da lista no ar (com o
// log e o id, nunca o conteudo) em vez de virar Padrão com o nome interno. No Livre, o item leva `freeDesign`
// (sem `locked` e `name`) e as fontes; `title` e `body` vem do design; imagem e icone nulos. O plano marca
// `design: "free"` (o navegador baixa o pedaco do cartao Livre antes do show).
// v3b-2 (docs/29): o mapa e o plano levam os pop-ups que comecam nas proximas 24 h (o plano com `startsAt`: a
// hora marcada ao vivo para quem ja esta na pagina); o show antes da hora responde 409 not_started com o
// Comeca, so para quem esta no segmento; "Ao concluir um curso" confere no banco que o curso esta completo
// antes de gravar a abertura (duas leituras so nesse momento).

import { unstable_cache } from "next/cache";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";
import { COMMUNICATIONS_TAG, LIVE_POPUPS_CACHE_KEY } from "./cache";
import { canSnooze, isPopupLive, popupEventPatch, type PopupEvent } from "./campaign-model";
import { isCourseComplete } from "@/lib/course-completion";
import { assertNoDbError, communicationsDb, CommunicationError, describeError, isMissingCommunicationSchema } from "./db";
import { noticeIconOfColumns } from "./message-meta";
import { normalizePeaks, type PopupItem, type PopupsAnswer } from "./notification-model";
import type { PopupDesign, PopupFontFace } from "./popup-design-model";
import { parseStoredPopupDesign, popupDesignKindOf } from "./popup-design-router";
import { freeDesignForStudent, freeHideEndlessCountdowns, type PopupFreeDesign } from "./popup-free-model";
import { freeFirstHeading, freeFirstText, freeHasCountdown, freeHeadingText } from "./popup-free-render";
import {
  coversPage,
  decideShow,
  expandFormationPatterns,
  pagesCovering,
  planPopups,
  popupAllowsPage,
  popupDayBounds,
  popupSettingsOfRow,
  popupWindowOpen,
  popupWindowSoon,
  showNext,
  type LivePopupRules,
  type PopupCountState,
  type PopupNext,
  type ShowRefusal
} from "./popup-display-model";
import { loadPopupFontFaces, withOwnStorageUrls } from "./popup-fonts";
import {
  fetchCourseCompletionFacts,
  fetchFormationCourses,
  fetchPopupDeliveries,
  fetchPopupDelivery,
  loadLivePopupRows,
  recordPopupImpression,
  type LivePopupRow,
  type PopupDeliveryRow
} from "./popup-store";

export const POPUP_NOT_FOUND = "Pop-up nao encontrado.";
export const POPUP_REFUSED = "Pop-up fora da vez.";
export const SNOOZE_REFUSED = "Não dá para lembrar depois de novo.";

/** Por que o show recusou com 409 (os 404 ficam de fora: nao dizem se o pop-up existe). */
export type PopupRefusalReason = Exclude<ShowRefusal, "not_eligible" | "not_live">;

/**
 * O show recusou (409): a pagina, o momento ou a frequencia nao deixam agora, a linha mudou no meio ou (v3b-2)
 * o pop-up ainda nao comecou (not_started, com nextAt = o Comeca).
 */
export class PopupRefusedError extends CommunicationError {
  /** Hora do servidor (ISO) em que a frequencia (ou o Comeca) deixa de novo; null = nunca mais ou nao se sabe. */
  nextAt: string | null;
  reason: PopupRefusalReason;

  constructor(reason: PopupRefusalReason, nextAt: string | null) {
    super(POPUP_REFUSED, 409);
    this.name = "PopupRefusedError";
    this.nextAt = nextAt;
    this.reason = reason;
  }
}

/**
 * Um pop-up da lista no ar: o conteudo (so sai no show), as regras (paginas, momento, quantas vezes) e o design
 * com as fontes que ele usa (null/[] no Padrão).
 */
type LivePopupEntry = {
  design: PopupDesign | null;
  fonts: PopupFontFace[];
  /** Design Livre (docs/27), ja sem `locked` e `name`; nunca junto com `design`. */
  freeDesign: PopupFreeDesign | null;
  row: LivePopupRow;
  rules: LivePopupRules;
};

/** Resposta do show: o conteudo, quando pode voltar e as vezes no dia (o historico grava ate 100 por dia). */
export type PopupShowResult = { dayImpressions: number; next: PopupNext; popup: PopupItem };

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

function iso(time: number) {
  return new Date(time).toISOString();
}

/** Ordem dos pop-ups: o inicio da janela; sem inicio, quando foi publicado. */
function popupStart(row: Pick<LivePopupRow, "created_at" | "sent_at" | "starts_at">) {
  return timeOf(row.starts_at) ?? timeOf(row.sent_at) ?? timeOf(row.created_at) ?? 0;
}

/** Ids de produto nomeados nas paginas e excecoes (content:<id> / lesson:<id>): candidatos a formacao. */
function namedProductIds(patterns: readonly string[]) {
  const ids = new Set<string>();

  for (const pattern of patterns) {
    const match = /^(?:content|lesson):([A-Za-z0-9_-]{1,240})$/.exec(pattern);

    if (match) {
      ids.add(match[1]);
    }
  }

  return [...ids].sort();
}

/**
 * A lista no ar com a configuracao de cada pop-up. Uma formacao escolhida vale tambem para as paginas dos
 * cursos dela; se a leitura dos cursos falhar, os pop-ups seguem com as paginas sem expandir (nunca caem).
 */
async function loadLivePopupEntries(): Promise<LivePopupEntry[]> {
  const db = communicationsDb();
  // Design (docs/26 e docs/27): pelo roteador. Livre invalido nao aparece (sai da lista); Personalizado
  // invalido = Padrão, como antes.
  const stored = new Map<string, ReturnType<typeof parseStoredPopupDesign>>();
  const rows = (await loadLivePopupRows(db, new Date().toISOString())).filter((row) => {
    const parsed = parseStoredPopupDesign(row.popup_design);

    if (popupDesignKindOf(row.popup_design) === "free" && !parsed.freeDesign) {
      console.error(`[comunicacao] design livre invalido ${row.id}`);

      return false;
    }

    stored.set(row.id, parsed);

    return true;
  });
  const settings = rows.map((row) => popupSettingsOfRow(row));
  const named = namedProductIds(settings.flatMap((item) => [...item.pages, ...item.exclude]));
  let coursesOf = new Map<string, string[]>();

  if (named.length > 0) {
    try {
      coursesOf = await fetchFormationCourses(db, named);
    } catch (error) {
      console.error(`[comunicacao] cursos das formacoes: ${describeError(error)}`);
      coursesOf = new Map();
    }
  }

  // Design do pop-up (docs/26): invalido = Padrão; as fontes numa consulta (falha = sem fonte enviada, o texto
  // cai na pilha do sistema; o pop-up nunca cai).
  const designs = rows.map((row) => withOwnStorageUrls(db, stored.get(row.id)?.design ?? null));
  const freeDesigns = rows.map((row) => {
    const freeDesign = stored.get(row.id)?.freeDesign ?? null;

    // Contador ate o fim do pop-up num pop-up sem fim: escondido no aluno (L6f, C16).
    return freeDesign ? freeHideEndlessCountdowns(freeDesignForStudent(freeDesign), Boolean(row.ends_at)) : null;
  });
  const fontIds = [...designs.flatMap((design) => design?.fonts ?? []), ...freeDesigns.flatMap((design) => design?.fonts ?? [])];
  let faces: PopupFontFace[] = [];

  if (fontIds.length > 0) {
    try {
      faces = await loadPopupFontFaces(db, fontIds);
    } catch (error) {
      console.error(`[comunicacao] fontes dos pop-ups: ${describeError(error)}`);
      faces = [];
    }
  }

  return rows.map((row, index) => {
    const own = settings[index];
    const design = designs[index];
    const freeDesign = freeDesigns[index];
    const usedFonts = design?.fonts ?? freeDesign?.fonts ?? [];

    return {
      design,
      fonts: usedFonts.length > 0 ? faces.filter((face) => usedFonts.includes(face.id)) : [],
      freeDesign,
      row,
      rules: {
        allowSnooze: row.allow_snooze,
        endsAt: timeOf(row.ends_at),
        id: row.id,
        rank: popupStart(row),
        settings: { ...own, exclude: expandFormationPatterns(own.exclude, coursesOf), pages: expandFormationPatterns(own.pages, coursesOf) },
        startsAt: timeOf(row.starts_at)
      }
    };
  });
}

/** Cache de 60 s (tag "communications": toda acao de pop-up invalida). Conteudo e configuracao, nunca aluno. */
const getLivePopups = unstable_cache(loadLivePopupEntries, [...LIVE_POPUPS_CACHE_KEY], {
  revalidate: 60,
  tags: [COMMUNICATIONS_TAG]
});

function toCountState(row: PopupDeliveryRow): PopupCountState {
  return {
    campaignId: row.campaign_id,
    clickedAt: timeOf(row.clicked_at),
    dayImpressions: row.day_impressions ?? 0,
    dismissedAt: timeOf(row.dismissed_at),
    eligible: row.eligible,
    impressions: row.impressions,
    impressionsBeforeReshow: row.impressions_before_reshow ?? 0,
    lastSeenAt: timeOf(row.last_seen_at),
    reshownAt: timeOf(row.reshown_at),
    snoozeCount: row.snooze_count,
    snoozedUntil: timeOf(row.snoozed_until),
    snoozesBeforeReshow: row.snoozes_before_reshow ?? 0
  };
}

function safeMediaUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return isHttpsOrLoopbackUrl(url) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** O Botao principal do aviso: so com texto, jeito de abrir e destino conferido; senao null. */
function popupCtaOf(row: LivePopupRow): PopupItem["cta"] {
  return row.cta_href && row.cta_label && row.cta_target && isSafeHeroCtaHref(row.cta_href)
    ? { href: row.cta_href, label: row.cta_label, target: row.cta_target }
    : null;
}

function toPopupItem(entry: LivePopupEntry, delivery: PopupCountState): PopupItem {
  const { freeDesign, row } = entry;
  const imageUrl = freeDesign ? null : safeMediaUrl(row.image_url);
  const audioUrl = safeMediaUrl(row.audio_url);
  const icon = freeDesign ? null : noticeIconOfColumns(row.icon, row.icon_color);
  // Livre (docs/27): titulo e texto do design (uma aba com o codigo antigo mostra o Padrão com o texto de verdade).
  const heading = freeDesign ? freeFirstHeading(freeDesign) : null;
  const text = freeDesign ? freeFirstText(freeDesign) : null;

  return {
    ...(icon ? { icon } : {}),
    ...(entry.rules.settings.close === "x_only" ? { close: "x_only" as const } : {}),
    // Design do pop-up (docs/26): so no Personalizado (o Padrão continua com o objeto de antes).
    ...(entry.design ? { design: entry.design, fonts: entry.fonts } : {}),
    ...(freeDesign ? { fonts: entry.fonts, freeDesign } : {}),
    // Contador do Livre (L6f): o fim do pop-up vai junto so quando o design tem Contador (a resposta dos outros nao muda).
    ...(freeDesign && freeHasCountdown(freeDesign) ? { endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null } : {}),
    audio:
      audioUrl && row.audio_duration_seconds
        ? { durationSeconds: row.audio_duration_seconds, mimeType: row.audio_mime, peaks: normalizePeaks(row.audio_peaks), url: audioUrl }
        : null,
    body: freeDesign ? (text ? freeHeadingText(text) : "") : (row.body ?? ""),
    canSnooze: canSnooze(delivery, row.allow_snooze),
    cta: popupCtaOf(row),
    id: row.id,
    image: imageUrl ? { alt: row.image_alt ?? "", url: imageUrl } : null,
    title: (heading ? freeHeadingText(heading) : "") || row.title
  };
}

/**
 * Caminho da v1 (GET /api/notifications/summary?popup=1: abas abertas antes do deploy e os testes da v1): o
 * primeiro pop-up do plano que vale no Inicio ao abrir a pagina e ja pode abrir, ou null. Nada e gravado (a
 * aba da v1 grava pelo evento "impressed", que passa pelo show).
 */
export async function getEligiblePopup(userId: string, now = Date.now()): Promise<PopupItem | null> {
  try {
    const live = (await getLivePopups()).filter((entry) => popupWindowOpen(entry.rules, now));

    if (live.length === 0) {
      return null;
    }

    const rows = await fetchPopupDeliveries(communicationsDb(), userId, live.map((entry) => entry.rules.id));
    const states = rows.map(toCountState);
    const chosen = planPopups({ deliveries: states, live: live.map((entry) => entry.rules), now }).find(
      (item) => item.trigger === "page_load" && item.notBefore === null && popupAllowsPage(item, "home")
    );

    if (!chosen) {
      return null;
    }

    const entry = live.find((item) => item.rules.id === chosen.id)!;
    const delivery = states.find((state) => state.campaignId === chosen.id)!;

    return toPopupItem(entry, delivery);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * O pedaco dos pop-ups no resumo do sino (GET /api/notifications/summary?page=). O mapa grosso das paginas sai
 * do cache, sem ir ao banco; o plano do aluno so na pagina coberta, numa consulta pela chave primaria. Sem
 * migracao ou com erro -> null (o numero do sino nunca quebra por causa de um pop-up). v3b-2: o mapa e o plano
 * levam tambem os pop-ups que comecam nas proximas 24 h (horizonte padrao de popupWindowSoon).
 */
export async function getPopupsAnswer(userId: string, pageKey: string, now = Date.now()): Promise<PopupsAnswer | null> {
  try {
    const live = await getLivePopups();
    const rules = live.map((entry) => entry.rules);
    const pages = pagesCovering(rules, now);
    const asOf = iso(now);

    if (!coversPage(pages, pageKey)) {
      return { asOf, pages, plan: null };
    }

    const relevant = rules.filter((rule) => popupWindowSoon(rule, now));

    if (relevant.length === 0) {
      return { asOf, pages, plan: [] };
    }

    const rows = await fetchPopupDeliveries(communicationsDb(), userId, relevant.map((rule) => rule.id));
    const free = new Set(live.filter((entry) => entry.freeDesign).map((entry) => entry.rules.id));
    const plan = planPopups({ deliveries: rows.map(toCountState), live: relevant, now });

    // Livre (docs/27): o plano marca o pop-up Livre (o navegador baixa o pedaco do cartao antes do show).
    return { asOf, pages, plan: free.size > 0 ? plan.map((item) => (free.has(item.id) ? { ...item, design: "free" as const } : item)) : plan };
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      console.error(`[comunicacao] plano de pop-ups: ${describeError(error)}`);
    }

    return null;
  }
}

/**
 * Abre o pop-up agora (POST /api/popups/[id]/show): confere no ar, segmento, pagina, momento e quantas vezes
 * sobre a linha lida e grava a abertura pela RPC com o updated_at dessa leitura (um clique, adiamento,
 * recalculo ou outra aba no meio recusa: 409 "changed"). So depois devolve o conteudo e quando pode voltar.
 * Fora do ar, de outro aluno ou fora do segmento: 404 sem dizer se existe. v3b-2: antes da hora, quem esta no
 * segmento recebe 409 not_started com nextAt = o Comeca; "Ao concluir um curso" so abre com o curso da pagina
 * completo no banco (senao 409 trigger, sem nextAt: o aviso da pagina pode ter sido forjado).
 */
export async function showPopup(userId: string, campaignId: string, input: { page: string; trigger: string }, now = Date.now()): Promise<PopupShowResult> {
  try {
    const entry = (await getLivePopups()).find((item) => item.rules.id === campaignId);

    if (!entry) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    const db = communicationsDb();
    const row = await fetchPopupDelivery(db, userId, campaignId);
    const state = row ? toCountState(row) : null;
    const decision = decideShow({ delivery: state, now, pageKey: input.page, popup: entry.rules, trigger: input.trigger });

    if (!decision.ok) {
      if (decision.reason === "not_live" || decision.reason === "not_eligible") {
        throw new CommunicationError(POPUP_NOT_FOUND, 404);
      }

      throw new PopupRefusedError(decision.reason, decision.nextAt === null ? null : iso(decision.nextAt));
    }

    if (input.trigger === "course_completed") {
      // decideShow ja conferiu que a pagina e uma aula deste pop-up (lesson:<conteudo>).
      const facts = await fetchCourseCompletionFacts(db, userId, input.page.slice("lesson:".length));

      if (!isCourseComplete(facts.publishedLessonIds, facts.completedLessonIds)) {
        throw new PopupRefusedError("trigger", null);
      }
    }

    // O updated_at vai como o PostgREST devolveu (microssegundos): por new Date() a comparacao nunca bateria.
    const counts = await recordPopupImpression(db, {
      campaignId,
      dayStart: iso(popupDayBounds(now).start),
      expectedUpdatedAt: row!.updated_at,
      now: iso(now),
      userId
    });

    if (!counts) {
      throw new PopupRefusedError("changed", null);
    }

    const after: PopupCountState = { ...state!, dayImpressions: counts.day_impressions, impressions: counts.impressions, lastSeenAt: now };

    return {
      dayImpressions: counts.day_impressions,
      next: showNext(entry.rules.settings.frequency, after, now),
      popup: toPopupItem(entry, after)
    };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    throw error;
  }
}

/**
 * O design Livre do pop-up no ar e se o aviso tem Botao principal, da mesma lista em cache do show (nunca dado de
 * aluno; nenhuma consulta nova enquanto o cache vale). Fora da lista ou fora do Livre, null. A rota de eventos confere
 * por aqui o botao clicado (popup-clicked-button.ts, docs/25 §5.1).
 */
export async function livePopupFreeDesign(campaignId: string): Promise<{ freeDesign: PopupFreeDesign; hasCta: boolean } | null> {
  const entry = (await getLivePopups()).find((item) => item.rules.id === campaignId);

  return entry?.freeDesign ? { freeDesign: entry.freeDesign, hasCta: popupCtaOf(entry.row) !== null } : null;
}

/** O que o evento mudou; no "impressed" da v1, as vezes no dia (o historico grava ate 100). */
export type PopupEventResult = { changed: boolean; dayImpressions?: number };

/**
 * Evento do aluno no pop-up (clique, fechar, "Não mostrar de novo", "Lembrar depois"). So vale para pop-up no
 * ar com linha elegivel do proprio aluno; "Lembrar depois" alem do limite e 409 e volta no "Volta em" do
 * pop-up. Fechar nao muda a linha (o jeito de fechar fica so no historico). O "impressed" da v1 (aba aberta
 * antes do deploy) passa pelo show do Inicio: fora da vez e 409 "Pop-up fora da vez.".
 */
export async function recordPopupEvent(userId: string, campaignId: string, event: PopupEvent, now = Date.now()): Promise<PopupEventResult> {
  if (event === "impressed") {
    const shown = await showPopup(userId, campaignId, { page: "home", trigger: "page_load" }, now);

    return { changed: true, dayImpressions: shown.dayImpressions };
  }

  const db = communicationsDb();

  try {
    const [campaignResult, delivery] = await Promise.all([
      db
        .from("campaigns")
        .select("id,kind,status,starts_at,ends_at,allow_snooze,deleted_at,popup_snooze_minutes")
        .eq("id", campaignId)
        .is("deleted_at", null)
        .maybeSingle(),
      fetchPopupDelivery(db, userId, campaignId)
    ]);
    assertNoDbError(campaignResult.error, "Pop-up");

    const campaign = campaignResult.data as
      | {
          allow_snooze: boolean;
          ends_at: string | null;
          id: string;
          kind: string;
          popup_snooze_minutes?: number | null;
          starts_at: string | null;
          status: string;
        }
      | null;

    if (
      !campaign ||
      campaign.kind !== "popup" ||
      !isPopupLive({ endsAt: campaign.ends_at, kind: "popup", sendAt: null, startsAt: campaign.starts_at, status: campaign.status as "active" }, now) ||
      !delivery ||
      !delivery.eligible
    ) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    const state = toCountState(delivery);
    const { snoozeMinutes } = popupSettingsOfRow({ popup_snooze_minutes: campaign.popup_snooze_minutes });
    const patch = popupEventPatch(state, event, { allowSnooze: campaign.allow_snooze, now, snoozeMinutes });

    if (!patch) {
      throw new CommunicationError(SNOOZE_REFUSED, 409);
    }

    if (Object.keys(patch).length === 0) {
      return { changed: false };
    }

    let update = db.from("campaign_deliveries").update(patch).eq("campaign_id", campaignId).eq("user_id", userId);

    // "Lembrar depois" muda so sobre o valor lido (duas abas ao mesmo tempo nao passam do limite).
    if (event === "snoozed") {
      update = update.eq("snooze_count", state.snoozeCount);
    }

    const { data, error } = await update.select("campaign_id");
    assertNoDbError(error, "Pop-up do aluno");

    if (event === "snoozed" && (data ?? []).length !== 1) {
      throw new CommunicationError(SNOOZE_REFUSED, 409);
    }

    return { changed: (data ?? []).length === 1 };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    throw error;
  }
}
