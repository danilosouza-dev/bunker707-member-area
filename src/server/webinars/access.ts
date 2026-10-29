// Quem pode ver um Webinario (docs/30 §1.1 "So o que pode" e §8.2): a equipe sempre; o aluno quando passa
// pelo "Quem pode" da equipe: Todos (everyone), Quem tem o produto X (product: acessos ativos, com o coringa
// da plataforma, o alvo 'webinar' ou o produto ligado, como src/server/access/lesson-access.ts), Segmento
// (audience: as regras da Comunicacao sobre os fatos do aluno, lidos agora), produto OU segmento (either) e
// produto E segmento (both: o segmento so restringe; o produto vem sempre dos acessos).
// Fora do acesso a resposta e 404, sem dizer se o webinario existe (WebinarError com status 404), nunca 403.
//
// O segmento vale na hora (cada pedido le os fatos de novo). A ancora (D41) vale so no Segmento e no "both": quem
// garantiu vaga neste webinario ou ja entrou numa sessao dele continua dentro mesmo se sair do segmento pelo que vence
// com o tempo (o "hoje" passou, por exemplo), desde que ainda tenha o produto e a turma que o segmento pede
// (evaluateAnchoredAudience, sobre os acessos e as turmas de agora: o reembolsado sai). No "both" o produto ligado e
// conferido com os acessos de agora. No "Produto ou segmento" nao ha ancora: vale o produto de agora ou o segmento de
// agora, porque a linha do acesso nao guarda a historia (nao da para saber por qual lado a vaga veio). A propria live
// nao conta para o proprio segmento: "nunca garantiram vaga em nenhuma live" quer dizer "em nenhuma outra" (sem laco ao
// garantir a vaga ou entrar na sala).
//
// A lista le os fatos do aluno uma vez (loadStudentAccessFacts) e confere cada webinario em memoria
// (hasWebinarAccess); as rotas conferem um so (requireWebinarAccess). So o que decide e lido: o segmento so onde ele
// muda a resposta (no "both" so com o produto; no "Produto ou segmento" so sem ele); com regras so de acesso e de lives,
// os fatos saem dos acessos ja lidos (sem perfil, progresso nem turmas); a contagem de comentarios de todos os alunos
// so com regra de comentarios, o indice de aulas so com regra de progresso, ritmo ou turma; as lives da pessoa junto
// com o resto, so com regra de lives; e as vagas e presencas da pessoa, sem essa regra, so quando a ancora decide.

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { loadAdminAccess } from "../auth/admin-access";
import {
  accessFactsOf,
  accessOnlyFacts,
  attachWebinarFacts,
  loadAudienceFactsFor,
  loadWebinarFacts,
  openAccessRows,
  type LoadedAudience,
  type WebinarFactsByUser
} from "../communications/audience-facts";
import {
  audienceFactNeeds,
  audienceHasCohortRule,
  buildCommentRanks,
  collectMessageCampaignIds,
  evaluateAnchoredAudience,
  evaluateAudience,
  type AnchoredAudienceFacts,
  type AudienceDefinition,
  type AudienceStudentFacts
} from "../communications/audience-model";
import { fetchEntitlements, type EntitlementRow } from "../students/store";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { accessModeAnchorsAudience, accessModeUsesAudience, accessModeUsesProduct, type Webinar } from "./model";
import { webinarEntitlementMatches } from "./student-model";

export type WebinarAccessTarget = Pick<Webinar, "accessMode" | "audience" | "id" | "productId">;

/** Os acessos que hasWebinarAccess le: as colunas de webinarEntitlementMatches e dos fatos do segmento. */
export type WebinarAccessEntitlement = Pick<EntitlementRow, "created_at" | "ends_at" | "starts_at" | "status" | "target_id" | "target_type" | "user_id">;

export type StudentAccessFacts = {
  /**
   * Webinarios em que a pessoa tem vaga garantida ou ja entrou numa sessao (a ancora do segmento, que so vale no
   * Segmento e no "both"). Lido so quando a ancora decide (alguem fora do segmento agora que ainda tem o produto e a
   * turma que o segmento pede) ou junto com a regra "Participação em lives"; vazio nos outros casos.
   */
  anchoredWebinarIds: ReadonlySet<string>;
  /** Turmas de agora quando `loaded` e nulo (os avisos de quem tem vaga); com `loaded`, valem as dos fatos. */
  cohortIds?: readonly string[];
  entitlements: readonly WebinarAccessEntitlement[];
  isStaff: boolean;
  /** Fatos do segmento; nulo quando nenhum webinario da leva precisa (ou a pessoa e da equipe). */
  loaded: LoadedAudience | null;
  now: number;
  userId: string;
};

export type WebinarAccessOptions = {
  db?: WebinarsDb;
  /** Fatos ja lidos para esta pessoa (lista): evita reler acessos e segmento por webinario. */
  facts?: StudentAccessFacts;
  now?: number;
};

export const WEBINAR_NOT_AVAILABLE = WEBINAR_COPY.aluno.naoDisponivel;

const NO_ANCHORS: ReadonlySet<string> = new Set<string>();

function usesProduct(webinar: WebinarAccessTarget) {
  return accessModeUsesProduct(webinar.accessMode);
}

function usesAudience(webinar: WebinarAccessTarget) {
  return accessModeUsesAudience(webinar.accessMode);
}

/**
 * A ancora a partir das lives da pessoa (RPC communication_webinar_facts da 202610300001, por loadWebinarFacts): vaga
 * 'registered' ou entrada numa sessao (ao vivo ou na Live gravada; o replay nao conta). null (banco sem a migracao):
 * sem ancora, vale so o segmento, como antes.
 */
function anchorsOf(webinarFacts: WebinarFactsByUser | null, userId: string): ReadonlySet<string> {
  const own = webinarFacts?.get(userId);

  return own ? new Set([...own.registered, ...own.attended]) : NO_ANCHORS;
}

/**
 * O segmento muda a resposta? No "both" so com o produto (sem ele ja e nao); no "Produto ou segmento" so sem o produto
 * (com ele ja e sim); no Segmento, sempre. Fora disso o segmento nem e lido.
 */
function segmentDecides(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  switch (webinar.accessMode) {
    case "audience":
      return true;
    case "either":
      return !hasProductAccess(facts, webinar);
    case "both":
      return hasProductAccess(facts, webinar);
    default:
      return false;
  }
}

/**
 * Fatos do segmento so com os acessos ja lidos (como o lote do motor dos fluxos): nenhuma regra le perfil, progresso,
 * turmas, comentarios nem notificacoes.
 */
function accessOnlyAudience(userIds: readonly string[], entitlements: readonly WebinarAccessEntitlement[], now: number): LoadedAudience {
  // Sempre pelo user_id: os avisos de quem tem vaga passam os acessos do lote inteiro (registrantsInSegmentNow).
  const rowsOf = (userId: string) => entitlements.filter((row) => row.user_id === userId);

  return {
    context: { commentRanks: buildCommentRanks([]), lessonTotals: {}, messageKeys: new Set<string>(), now },
    facts: userIds.map((userId) => accessOnlyFacts(userId, rowsOf(userId), now)),
    people: new Map()
  };
}

/**
 * Os fatos do segmento destas pessoas, so com o que as regras pedem, sobre os acessos ja lidos: com regras so de acesso
 * e de lives, sem perfil, progresso nem turmas; a contagem de comentarios so com essa regra; o indice de aulas so com
 * regra de progresso, ritmo ou turma (`lessonIndex` ja lido evita reler); as lives delas so com regra de lives
 * (`webinarFacts` devolve a leitura, para a ancora; undefined = nao lidas).
 */
async function loadSegmentFacts(
  db: WebinarsDb,
  userIds: readonly string[],
  entitlements: readonly WebinarAccessEntitlement[],
  audiences: readonly AudienceDefinition[],
  now: number,
  lessonIndex?: Map<string, Set<string>> | null
): Promise<{ loaded: LoadedAudience; webinarFacts: WebinarFactsByUser | null | undefined }> {
  const needs = audienceFactNeeds(audiences);
  const messageCampaignIds = collectMessageCampaignIds(audiences);
  const accessOnly = !needs.students && needs.comments === "none" && messageCampaignIds.length === 0;
  const [segment, webinarFacts] = await Promise.all([
    accessOnly
      ? Promise.resolve(accessOnlyAudience(userIds, entitlements, now))
      : loadAudienceFactsFor(db, userIds, now, {
          // Sem regra de comentarios, nada da contagem de todos os alunos; sem regra de progresso, ritmo ou turma, nada
          // do indice de aulas (os fatos dessas regras ficam zerados e ninguem le).
          comments: needs.comments,
          entitlements,
          lessonIndex: needs.lessons ? (lessonIndex ?? undefined) : new Map<string, Set<string>>(),
          messageCampaignIds,
          staff: new Set<string>()
        }),
    needs.webinars ? loadWebinarFacts(db, { userIds }) : Promise.resolve(undefined)
  ]);

  // So as vagas e presencas: as acoes do follow-up nao valem no Quem pode (accessAudienceDefinitionSchema; D49).
  return { loaded: attachWebinarFacts(segment, { presence: webinarFacts ?? null }), webinarFacts };
}

/** Le o que o acesso de `webinars` precisa sobre a pessoa: equipe, acessos, (so se algum pede) o segmento e a ancora. */
export async function loadStudentAccessFacts(
  db: WebinarsDb,
  userId: string,
  webinars: readonly WebinarAccessTarget[],
  now = Date.now()
): Promise<StudentAccessFacts> {
  const staff = await loadAdminAccess(userId, db);
  if (staff) {
    return { anchoredWebinarIds: NO_ANCHORS, entitlements: [], isStaff: true, loaded: null, now, userId };
  }

  const needsEntitlements = webinars.some(usesProduct) || webinars.some(usesAudience);
  const entitlements = needsEntitlements ? await fetchEntitlements(db, { userId }) : [];
  const base: StudentAccessFacts = { anchoredWebinarIds: NO_ANCHORS, entitlements, isStaff: false, loaded: null, now, userId };
  const withAudience = webinars.filter((webinar) => segmentDecides(base, webinar));

  if (withAudience.length === 0) {
    return base;
  }

  // As lives da pessoa (vagas e presencas), junto com o resto: lidas uma vez, para a regra "Participação em lives" e
  // para a ancora. Com regras so de acesso e de lives, os fatos saem dos acessos ja lidos.
  const segment = await loadSegmentFacts(
    db,
    [userId],
    entitlements,
    withAudience.map((webinar) => webinar.audience),
    now
  );
  const facts: StudentAccessFacts = { ...base, loaded: segment.loaded };

  if (segment.webinarFacts !== undefined) {
    // Ja lidas para a regra: a ancora sai da mesma leitura.
    return { ...facts, anchoredWebinarIds: anchorsOf(segment.webinarFacts, userId) };
  }

  // A ancora so decide no Segmento e no "both", para quem esta fora do segmento agora e ainda tem o produto e a turma
  // que o segmento pede (sem eles, a ancora tambem nao abre). Nos outros casos as vagas e presencas nem sao lidas.
  const anchorDecides = withAudience.some(
    (webinar) => accessModeAnchorsAudience(webinar.accessMode) && !isInAudience(facts, webinar) && evaluateAnchoredAudience(webinar.audience, anchoredFactsOf(facts))
  );

  if (!anchorDecides) {
    return facts;
  }

  return { ...facts, anchoredWebinarIds: anchorsOf(await loadWebinarFacts(db, { userIds: [userId] }), userId) };
}

function hasProductAccess(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  return facts.entitlements.some((row) => webinarEntitlementMatches(row, webinar, facts.now));
}

/**
 * O que a ancora le da pessoa: os acessos abertos agora (a mesma conta de buildStudentFacts) e as turmas de agora (dos
 * fatos do segmento quando lidos; senao, as que vieram junto).
 */
function anchoredFactsOf(facts: StudentAccessFacts): AnchoredAudienceFacts {
  const own = facts.loaded?.facts.find((fact) => fact.userId === facts.userId);

  return { accesses: accessFactsOf(openAccessRows(facts.entitlements, facts.now)), cohortIds: own?.cohortIds ?? facts.cohortIds ?? [] };
}

/** Os fatos da pessoa sem a propria live: "qualquer live" no segmento de um webinario quer dizer "outra live". */
function withoutOwnWebinar(fact: AudienceStudentFacts, webinarId: string): AudienceStudentFacts {
  const own = fact.webinars;

  if (!own || (!own.attended.includes(webinarId) && !own.registered.includes(webinarId))) {
    return fact;
  }

  return {
    ...fact,
    webinars: { ...own, attended: own.attended.filter((id) => id !== webinarId), registered: own.registered.filter((id) => id !== webinarId) }
  };
}

function isInAudience(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  const own = facts.loaded?.facts.find((fact) => fact.userId === facts.userId);

  if (!facts.loaded || !own) {
    return false;
  }

  return evaluateAudience(webinar.audience, withoutOwnWebinar(own, webinar.id), facts.loaded.context);
}

/**
 * No segmento agora ou, no Segmento e no "both", ancorado: vaga garantida neste webinario (ou ja entrou numa sessao
 * dele) e ainda com o produto e a turma que o segmento pede, conferidos com os acessos e as turmas de agora
 * (evaluateAnchoredAudience).
 */
function segmentHolds(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  if (isInAudience(facts, webinar)) {
    return true;
  }

  return (
    accessModeAnchorsAudience(webinar.accessMode) &&
    facts.anchoredWebinarIds.has(webinar.id) &&
    evaluateAnchoredAudience(webinar.audience, anchoredFactsOf(facts))
  );
}

/** O "Quem pode" da equipe sobre os fatos ja lidos (sem ir ao banco). */
export function hasWebinarAccess(facts: StudentAccessFacts, webinar: WebinarAccessTarget): boolean {
  if (facts.isStaff) {
    return true;
  }
  switch (webinar.accessMode) {
    case "everyone":
      return true;
    case "product":
      return hasProductAccess(facts, webinar);
    case "audience":
      return segmentHolds(facts, webinar);
    case "either":
      // Sem ancora: o produto de agora ou o segmento de agora.
      return hasProductAccess(facts, webinar) || isInAudience(facts, webinar);
    case "both":
      return hasProductAccess(facts, webinar) && segmentHolds(facts, webinar);
    default:
      return false;
  }
}

/** O que os avisos de quem tem vaga sabem da pessoa: os acessos e as turmas (com regra de Turma). */
export type RegistrantAccessInput = {
  cohortIds?: readonly string[];
  entitlements: readonly WebinarAccessEntitlement[];
  now: number;
  userId: string;
};

/**
 * O "Quem pode" de quem ja tem vaga neste webinario (os avisos da live: lembretes, "Comecou agora", cancelada e
 * remarcada), so com os acessos (e, com regra de Turma, as turmas) dela lidos agora, sem ler perfil, progresso nem
 * lives. No Segmento e no "both" a vaga e a ancora, entao o segmento vale como evaluateAnchoredAudience (que nunca da
 * menos que o segmento de agora) e o produto do "both" e conferido de novo. No "Produto ou segmento" nao ha ancora: aqui
 * so o produto de agora; o segmento de agora de quem nao tem o produto vem de registrantsInSegmentNow.
 */
export function registrantHasWebinarAccess(webinar: WebinarAccessTarget, input: RegistrantAccessInput): boolean {
  const facts: StudentAccessFacts = {
    anchoredWebinarIds: new Set([webinar.id]),
    cohortIds: input.cohortIds ?? [],
    entitlements: input.entitlements,
    isStaff: false,
    loaded: null,
    now: input.now,
    userId: input.userId
  };

  return hasWebinarAccess(facts, webinar);
}

/**
 * Destas pessoas (no "Produto ou segmento", as sem o produto agora), quem esta no segmento do webinario agora, com os
 * fatos lidos como na pagina (so o que as regras pedem; a propria live nao conta) sobre os acessos ja lidos.
 */
export async function registrantsInSegmentNow(
  db: WebinarsDb,
  webinar: WebinarAccessTarget,
  input: { entitlements: readonly WebinarAccessEntitlement[]; lessonIndex?: Map<string, Set<string>> | null; now: number; userIds: readonly string[] }
): Promise<Set<string>> {
  const inside = new Set<string>();

  if (input.userIds.length === 0) {
    return inside;
  }

  const { loaded } = await loadSegmentFacts(db, input.userIds, input.entitlements, [webinar.audience], input.now, input.lessonIndex);

  for (const userId of input.userIds) {
    const facts: StudentAccessFacts = { anchoredWebinarIds: NO_ANCHORS, entitlements: [], isStaff: false, loaded, now: input.now, userId };

    if (isInAudience(facts, webinar)) {
      inside.add(userId);
    }
  }

  return inside;
}

/**
 * O que os avisos de quem tem vaga precisam ler: nada em Todos, nem no Segmento que vale (ancorado) sem acesso nenhum
 * (so regras de entrada ou de lives, por exemplo: toda vaga recebe); os acessos nos outros casos; as turmas so com
 * regra de Turma que decide a ancora; e o indice de aulas (lido uma vez para o lote) com essas turmas ou, no "Produto
 * ou segmento", quando o segmento de agora pede progresso, ritmo ou turma.
 */
export function registrantAccessNeeds(webinar: WebinarAccessTarget): { cohorts: boolean; entitlements: boolean; lessonIndex: boolean } {
  switch (webinar.accessMode) {
    case "everyone":
      return { cohorts: false, entitlements: false, lessonIndex: false };
    case "audience":
    case "both": {
      // O segmento ancorado ja vale sem acesso nem turma nenhuma? (evaluateAnchoredAudience so cresce com eles.)
      const segmentAlone = evaluateAnchoredAudience(webinar.audience, { accesses: [], cohortIds: [] });
      const cohorts = !segmentAlone && audienceHasCohortRule(webinar.audience);

      return { cohorts, entitlements: webinar.accessMode === "both" || !segmentAlone, lessonIndex: cohorts };
    }
    case "either":
      // O produto de agora; o segmento de agora so de quem nao o tem (registrantsInSegmentNow le as turmas dele).
      return { cohorts: false, entitlements: true, lessonIndex: audienceFactNeeds(webinar.audience).lessons };
    default:
      // Quem tem o produto (e um modo que este app nao conhece, que fecha).
      return { cohorts: false, entitlements: true, lessonIndex: false };
  }
}

/** true quando a pessoa pode ver o webinario (listas); le os fatos dela se ainda nao vieram. */
export async function canAccessWebinar(userId: string, webinar: WebinarAccessTarget, options: WebinarAccessOptions = {}): Promise<boolean> {
  const facts = options.facts ?? (await loadStudentAccessFacts(options.db ?? webinarsDb(), userId, [webinar], options.now));
  return hasWebinarAccess(facts, webinar);
}

/** Como canAccessWebinar, mas fora do acesso lanca 404 ("Esta live nao esta disponivel para voce."). */
export async function requireWebinarAccess(userId: string, webinar: WebinarAccessTarget, options: WebinarAccessOptions = {}): Promise<void> {
  if (!(await canAccessWebinar(userId, webinar, options))) {
    throw new WebinarError(WEBINAR_NOT_AVAILABLE, 404);
  }
}
