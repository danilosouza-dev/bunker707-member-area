// Quem pode ver um Webinario (docs/30 §1.1 "So o que pode" e §8.2): a equipe sempre; o aluno quando passa
// pelo "Quem pode" da equipe: Todos (everyone), Quem tem o produto X (product: acessos ativos, com o coringa
// da plataforma, o alvo 'webinar' ou o produto ligado, como src/server/access/lesson-access.ts), Segmento
// (audience: as regras da Comunicacao sobre os fatos do aluno, lidos agora) ou produto OU segmento (either).
// Fora do acesso a resposta e 404, sem dizer se o webinario existe (WebinarError com status 404), nunca 403.
//
// A lista le os fatos do aluno uma vez (loadStudentAccessFacts) e confere cada webinario em memoria
// (hasWebinarAccess); as rotas conferem um so (requireWebinarAccess).

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { loadAdminAccess } from "../auth/admin-access";
import { resolveAudienceUserIds } from "../communications/audience";
import { loadAudienceFactsFor, type LoadedAudience } from "../communications/audience-facts";
import { collectMessageCampaignIds } from "../communications/audience-model";
import { fetchEntitlements, type EntitlementRow } from "../students/store";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import type { Webinar } from "./model";
import { webinarEntitlementMatches } from "./student-model";

export type WebinarAccessTarget = Pick<Webinar, "accessMode" | "audience" | "id" | "productId">;

export type StudentAccessFacts = {
  entitlements: readonly EntitlementRow[];
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

function usesProduct(webinar: WebinarAccessTarget) {
  return webinar.accessMode === "product" || webinar.accessMode === "either";
}

function usesAudience(webinar: WebinarAccessTarget) {
  return webinar.accessMode === "audience" || webinar.accessMode === "either";
}

/** Le o que o acesso de `webinars` precisa sobre a pessoa: equipe, acessos e (so se algum pede) o segmento. */
export async function loadStudentAccessFacts(
  db: WebinarsDb,
  userId: string,
  webinars: readonly WebinarAccessTarget[],
  now = Date.now()
): Promise<StudentAccessFacts> {
  const staff = await loadAdminAccess(userId, db);
  if (staff) {
    return { entitlements: [], isStaff: true, loaded: null, now, userId };
  }

  const needsEntitlements = webinars.some(usesProduct) || webinars.some(usesAudience);
  const entitlements = needsEntitlements ? await fetchEntitlements(db, { userId }) : [];
  let loaded: LoadedAudience | null = null;

  if (webinars.some(usesAudience)) {
    loaded = await loadAudienceFactsFor(db, [userId], now, {
      entitlements,
      messageCampaignIds: collectMessageCampaignIds(webinars.filter(usesAudience).map((webinar) => webinar.audience)),
      staff: new Set<string>()
    });
  }

  return { entitlements, isStaff: false, loaded, now, userId };
}

function hasProductAccess(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  return facts.entitlements.some((row) => webinarEntitlementMatches(row, webinar, facts.now));
}

function isInAudience(facts: StudentAccessFacts, webinar: WebinarAccessTarget) {
  if (!facts.loaded) {
    return false;
  }
  return resolveAudienceUserIds(webinar.audience, facts.loaded).includes(facts.userId);
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
      return isInAudience(facts, webinar);
    case "either":
      return hasProductAccess(facts, webinar) || isInAudience(facts, webinar);
    default:
      return false;
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
