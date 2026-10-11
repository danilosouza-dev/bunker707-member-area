import type { Metadata } from "next";
import { parseAdminProduct } from "@/components/admin/v2/filters";
import { getGreeting } from "@/components/admin/v2/format";
import { buildAdminPeriodHref, readAdminPeriod } from "@/components/admin/v2/period";
import {
  formatTodayDate,
  getActivityMeta,
  getByProductMeta,
  getTodayCreateItems,
  getTodayNumbersHeading,
  type TodayViewData
} from "@/components/admin/v2/today/today-model";
import { buildTodayDemo } from "@/components/admin/v2/today/today-demo";
import { TodayView } from "@/components/admin/v2/today/today-view";
import { isAdminDemoEnabled } from "@/server/admin/demo";
import { readTodayAttention, readTodayByProduct, readTodayNewAccesses } from "@/server/admin/today";
import { requirePageAdmin } from "@/server/auth/guards";
import { canRole } from "@/server/auth/roles";
import { getUserDisplayName } from "@/server/auth/session";

export const metadata: Metadata = {
  title: "Visão geral"
};

type AdminTodayPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Instante da leitura: o mesmo para o periodo, a saudacao e a hora da verificacao. */
function readNow() {
  return new Date();
}

// Hoje (docs/17 §1.5): esta pagina so le (periodo e produto da barra superior, cartoes de atencao, novos
// acessos, por produto) e entrega tudo pronto para TodayView, que so desenha. Cada parte falha sozinha.
export default async function AdminTodayPage({ searchParams }: AdminTodayPageProps) {
  const [{ role, user }, params] = await Promise.all([requirePageAdmin(), searchParams]);
  const now = readNow();
  const resolved = readAdminPeriod(params, now);
  const productId = parseAdminProduct(params.produto);
  const [attention, newAccesses, byProduct] = await Promise.all([
    readTodayAttention(productId, now),
    readTodayNewAccesses(resolved, productId),
    readTodayByProduct(resolved, productId)
  ]);

  const demo = isAdminDemoEnabled()
    ? buildTodayDemo(resolved, byProduct.status === "ready" ? byProduct.rows.map((row) => row.id) : [], productId)
    : undefined;

  const data: TodayViewData = {
    activityMeta: getActivityMeta(resolved),
    attention,
    byProduct,
    byProductMeta: getByProductMeta(resolved),
    comparisonLabel: resolved.comparisonLabel,
    createItems: getTodayCreateItems((action) => canRole(role, action)),
    dateLabel: formatTodayDate(now),
    demo,
    greeting: `${getGreeting(now)}, ${getUserDisplayName(user).name}`,
    newAccesses,
    numbers: getTodayNumbersHeading(resolved),
    periodAccessibleLabel: resolved.accessibleLabel,
    retryHref: buildAdminPeriodHref("/admin", params, resolved.period)
  };

  return (
    // Sem moldura propria: TodayView ja desenha a area util (AdminPage) e o cabecalho.
    <TodayView data={data} />
  );
}
