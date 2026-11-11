import "server-only";

// Minhas licencas do lado do servidor (docs/32 §2.4 e §11.10): quem ve (o menu e a pagina), o que a pagina mostra e a
// conferencia que toda acao do comprador faz antes de falar com o Emissor.
// - Quem ve: so com as paginas de vendedor ligadas (seller.ts: a API interna configurada, e no modo "enforce" a chave
//   interna da nossa licenca) e so quem tem acesso aberto a um produto marcado como Bunker Members (o curso da
//   instalacao), que ja esta no nosso banco: o Emissor so e consultado quando a pessoa abre a pagina;
// - o dono: a conta da sessao e o areaUserId de todo pedido ao Emissor, nunca um id vindo do navegador; a Licenca de uma
//   acao precisa estar na lista dessa conta (o Emissor tambem confere);
// - os produtos marcados ficam um minuto na memoria do processo: o menu de toda pagina do aluno pergunta.

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { accessStateOf, isAccessOpen } from "@/server/students/model";
import type { CustomerLicenses, InternalEmissorClient, InternalFailure } from "./contract";
import { fetchLicenseProductIds, isLicenseSalesSchemaMissing } from "./requests-store";
import { getSellerFeatures } from "./seller";
import { licensesViewOf, studentLicenseErrorMessage, type LicensesView } from "./student-model";

const PRODUCTS_MEMORY_MS = 60_000;
let productsMemory: { at: number; ids: readonly string[] } | null = null;

/** Esquece a lista dos produtos marcados (a acao do dono que marca ou desmarca, neste processo). */
export function forgetLicenseProductsMemory() {
  productsMemory = null;
}

/** Os produtos marcados como Bunker Members (memoria de um minuto). Sem a migracao, nenhum. */
async function licenseProductIds(): Promise<readonly string[]> {
  if (productsMemory && Date.now() - productsMemory.at < PRODUCTS_MEMORY_MS) {
    return productsMemory.ids;
  }

  try {
    const ids = await fetchLicenseProductIds(getSupabaseAdminClient());
    productsMemory = { at: Date.now(), ids };
    return ids;
  } catch (error) {
    if (!isLicenseSalesSchemaMissing(error)) {
      console.error("[minhas-licencas] produtos marcados:", error instanceof Error ? error.message : error);
    }

    return [];
  }
}

/**
 * O item "Minhas licencas" do menu: com as paginas de vendedor ligadas e acesso aberto a um produto marcado. `hasOpenAccess`
 * olha os acessos que a moldura ja leu (getAppShellData), sem consulta nova. Sem a configuracao, nada e lido.
 */
export async function readLicensesMenuVisible(userId: string | null | undefined, hasOpenAccess: (productIds: readonly string[]) => boolean): Promise<boolean> {
  if (!userId || !(await getSellerFeatures()).enabled) {
    return false;
  }

  const ids = await licenseProductIds();
  return ids.length > 0 && hasOpenAccess(ids);
}

type EntitlementLike = { ends_at: string | null; starts_at: string; status: string; target_id: string };

/** Os produtos marcados a que a conta tem acesso aberto agora, com o titulo (o link da aula de instalacao). */
async function licensedCoursesOf(userId: string): Promise<{ id: string; title: string }[]> {
  const ids = await licenseProductIds();

  if (ids.length === 0) {
    return [];
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db.from("entitlements").select("target_id,status,starts_at,ends_at").eq("user_id", userId).in("target_id", [...ids]);

  if (error) {
    throw new Error(`Acessos do comprador: ${error.message}`);
  }

  const now = Date.now();
  const open = [
    ...new Set(
      ((data ?? []) as EntitlementLike[])
        .filter((row) => isAccessOpen(accessStateOf({ endsAt: row.ends_at, now, startsAt: row.starts_at, status: row.status as "active" })))
        .map((row) => row.target_id)
    )
  ];

  if (open.length === 0) {
    return [];
  }

  const { data: items, error: itemsError } = await db.from("content_items").select("id,title").in("id", open);

  if (itemsError) {
    throw new Error(`Cursos do comprador: ${itemsError.message}`);
  }

  return open.map((id) => ({ id, title: ((items ?? []) as { id: string; title: string | null }[]).find((item) => item.id === id)?.title?.trim() || "Bunker Members" }));
}

/** O comprador: as paginas de vendedor ligadas e acesso aberto a um produto marcado. Senao, null (a pagina responde 404). */
export async function licenseBuyerContext(userId: string): Promise<{ client: InternalEmissorClient; courses: { id: string; title: string }[]; simulator: boolean } | null> {
  const seller = await getSellerFeatures();

  if (!seller.enabled) {
    return null;
  }

  const courses = await licensedCoursesOf(userId);
  return courses.length > 0 ? { client: seller.client, courses, simulator: seller.via === "simulador" } : null;
}

/** O tempo que a pagina espera a lista do Emissor (a pagina mostra o aviso, em vez de ficar presa os 15 s do contrato). */
const PAGE_TIMEOUT_MS = 8_000;

export type MyLicensesPage = {
  courses: { href: string; title: string }[];
  simulator: boolean;
  /** A frase quando o Emissor nao respondeu (os botoes ficam desligados e o link da aula continua). */
  emissorError: string | null;
  view: LicensesView | null;
  /** A lista crua (so para as acoes conferirem o dono; a pagina usa a `view`). */
  data: CustomerLicenses | null;
};

/** O que a pagina mostra para a conta da sessao; null quando a pagina nao existe para ela. */
export async function getMyLicensesPage(userId: string): Promise<MyLicensesPage | null> {
  const buyer = await licenseBuyerContext(userId);

  if (!buyer) {
    return null;
  }

  const courses = buyer.courses.map((course) => ({ href: `/conteudo/${encodeURIComponent(course.id)}`, title: course.title }));
  const listed = await buyer.client.listLicenses(userId, { requestId: crypto.randomUUID(), timeoutMs: PAGE_TIMEOUT_MS });

  if (!listed.ok) {
    return { courses, data: null, emissorError: studentLicenseErrorMessage(listed.error), simulator: buyer.simulator, view: null };
  }

  return { courses, data: listed.data, emissorError: null, simulator: buyer.simulator, view: licensesViewOf(listed.data, new Date()) };
}

/** A falha do Emissor como o comprador le (as frases de student-model.ts). */
export function studentFailureMessage(failure: InternalFailure): string {
  return studentLicenseErrorMessage(failure.error);
}
