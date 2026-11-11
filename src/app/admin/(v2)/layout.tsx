import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AdminShellV2 } from "@/components/admin/v2/admin-shell";
import type { AdminFilterProduct } from "@/components/admin/v2/filters";
import { formatAdminRole } from "@/components/admin/v2/format";
import { LicenseBanner } from "@/components/admin/v2/license/license-banner";
import { ADMIN_SIDEBAR_COOKIE, type AdminNavCounts } from "@/components/admin/v2/nav";
import { readTodayAlertSummary } from "@/server/admin/today";
import { requirePageAdmin } from "@/server/auth/guards";
import { catalogScope, communityScope, toAccessSnapshot, type AdminAccess } from "@/server/auth/roles";
import { getUserDisplayName } from "@/server/auth/session";
import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { PRODUCT_ACCENTS } from "@/server/catalog/model";
import { listProductOptions } from "@/server/catalog/queries";
import { countOverdueQuestions } from "@/server/community/counts";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { checkLicenseNow } from "@/server/licensing/actions";
import { isLicenseManager } from "@/server/licensing/admin-access";
import { licenseBannerOf, type LicenseBannerModel } from "@/server/licensing/copy";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import { getDisabledFeatures } from "@/server/licensing/guards";
import { observeAdminRequestHost } from "@/server/licensing/request-host";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: {
    default: "Admin Bunker707",
    template: "%s · Admin Bunker707"
  }
};

// Moldura do admin novo (docs/17 §2.3, prototipo aprovado). Aqui so o que a moldura mostra: os
// contadores do menu (Hoje e Comunidade) e as opcoes do filtro Produto da barra superior. O layout
// persiste entre navegacoes, entao e uma leitura por carregamento completo; qualquer falha deixa a
// moldura sem contador ou sem opcoes, nunca quebrada. O layout nao protege as paginas: layout e pagina
// renderizam em paralelo, entao cada page.tsx chama requirePageAdmin() de novo. Usuario e papel sao
// memoizados por requisicao (React.cache em src/server/auth/session.ts). A faixa da Licenca (docs/32 §2.2) vem antes
// das telas, so no produto vendido (modo "enforce"; no "off" nada aqui le a licenca) e so quando ha o que dizer.
export default async function AdminV2Layout({ children }: { children: ReactNode }) {
  const { access, role, user } = await requirePageAdmin();
  const { fullName } = getUserDisplayName(user);

  // A Licenca confere o endereco por onde o dono e os administradores abrem o admin (docs/32 §2.2): so no modo
  // "enforce", sem gravar nada quando nada mudou, e nunca derruba a moldura.
  if (isLicenseManager(access)) {
    await observeAdminRequestHost();
  }

  // Contadores valem para a escola toda: a Comunidade de quem responde so nos proprios cursos nao conta.
  // Os modulos desligados na licenca (docs/32 §11.8): o menu e a busca escondem as telas deles. No modo "off", nenhum.
  const [allCounts, products, cookieStore, disabledFeatures, licenseBanner] = await Promise.all([
    readNavCounts(),
    readProductFilterOptions(access),
    cookies(),
    getDisabledFeatures(),
    readLicenseBanner()
  ]);
  const counts = communityScope(access) === null ? allCounts : { ...allCounts, comunidade: undefined };
  const sidebarCollapsed = cookieStore.get(ADMIN_SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <AdminShellV2
      access={toAccessSnapshot(access)}
      account={{ email: user.email ?? "", name: fullName, roleLabel: formatAdminRole(role) }}
      counts={counts}
      disabledFeatures={disabledFeatures}
      initialCollapsed={sidebarCollapsed}
      products={products}
    >
      {licenseBanner ? <LicenseBanner banner={licenseBanner} canManage={isLicenseManager(access)} checkNowAction={checkLicenseNow} /> : null}
      {children}
    </AdminShellV2>
  );
}

/**
 * A faixa da Licenca (src/server/licensing/copy.ts, licenseBannerOf): a mesma situacao do pedido que o menu ja leu
 * (readCurrentLicenseState, uma leitura por pedido, que nunca lanca). No modo "off", nenhuma, sem ler nada. Sem
 * leitura, nenhuma faixa (o motivo vai para o log uma vez): a moldura nunca quebra por causa dela.
 */
async function readLicenseBanner(): Promise<LicenseBannerModel | null> {
  const state = await readCurrentLicenseState();
  return state ? licenseBannerOf(state, { configuredHost: getConfiguredSiteOrigin() }) : null;
}

/**
 * Contadores do menu: Hoje = numero de cartoes de "Precisa de atencao hoje"; Comunidade = perguntas de
 * alunos sem resposta ha mais de 24 h. Uma leitura (readTodayAlertSummary, migracao 202610120001); sem
 * ela, a Comunidade cai na contagem da fase 1 (community_overdue_count, 202610110020).
 */
async function readNavCounts(): Promise<AdminNavCounts> {
  const summary = await readTodayAlertSummary();

  if (summary) {
    return { comunidade: summary.overdueQuestions, hoje: summary.attentionCount };
  }

  try {
    return { comunidade: await countOverdueQuestions() };
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error("[admin] Contador da Comunidade:", error instanceof Error ? error.message : error);
    }

    return {};
  }
}

/**
 * Opcoes do filtro Produto (nome e cor). Sem catalogo legivel, o filtro mostra so "Todos os produtos".
 * Quem ve so os proprios cursos (Professor): so os dele.
 */
async function readProductFilterOptions(access: AdminAccess): Promise<AdminFilterProduct[]> {
  try {
    const options = await listProductOptions();
    const allowed = catalogScope(access);

    return options
      .filter((option) => allowed === null || allowed.includes(option.id))
      .map((option) => ({ accent: PRODUCT_ACCENTS[option.accent], id: option.id, label: option.title }));
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error("[admin] Produtos do filtro:", error instanceof Error ? error.message : error);
    }

    return [];
  }
}
