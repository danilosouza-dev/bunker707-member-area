// Numeros SIMULADOS da Visao geral, so para conferir o layout no localhost (pedido do produtor em
// 2026-10-11). Liga com ADMIN_DEMO_DATA=on no .env.local; nunca vale em producao (ver
// src/server/admin/demo.ts). Sem a variavel, a tela continua honesta: "—" onde ainda nao ha dado.
//
// Modulo puro: os mesmos numeros para o mesmo periodo e o mesmo produto (gerador com semente), para a
// tela nao mudar a cada recarga.

import { listAdminPeriodBuckets, type ResolvedAdminPeriod } from "../period";

export type TodayDemoKpi = { previousTotal: number; series: number[]; total: number };

export type TodayDemoActivityPoint = {
  completed: number;
  label: string;
  longLabel: string;
  previousWatched: number;
  watched: number;
};

export type TodayDemoProduct = {
  /** Conclusao em 90 dias, em %. */
  completion: number;
  studentsWithAccess: number;
  studying: number;
  /** Variacao de quem estuda contra o periodo anterior, em %. */
  trend: number;
  /** Alunos ativos nas ultimas 8 semanas (mais antiga primeiro). */
  weekly: number[];
};

export type TodayDemoData = {
  activity: TodayDemoActivityPoint[];
  completed: TodayDemoKpi;
  completion90: TodayDemoKpi;
  newAccesses: TodayDemoKpi;
  products: Record<string, TodayDemoProduct>;
  studying: TodayDemoKpi;
};

export const TODAY_DEMO_NOTICE =
  "Números simulados para conferir o layout (ADMIN_DEMO_DATA=on no .env.local). Apague a linha para voltar aos dados reais.";

function seededRandom(seed: string) {
  let state = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10_000) / 10_000;
  };
}

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function buildTodayDemo(resolved: ResolvedAdminPeriod, productIds: readonly string[], productId: string | null): TodayDemoData {
  const random = seededRandom(`${resolved.from}|${resolved.to}|${resolved.granularity}|${productId ?? "todos"}`);
  const buckets = listAdminPeriodBuckets(resolved, "current");
  const hourly = resolved.granularity === "hour";
  // Um produto escolhido mostra uma fatia menor da escola inteira.
  const scale = productId ? 0.35 : 1;
  const base = (hourly ? 6 : 52) * scale;

  const activity = buckets.map((bucket, index) => {
    const wave = 1 + 0.18 * Math.sin((index / Math.max(buckets.length - 1, 1)) * Math.PI * 1.6);
    const growth = 0.85 + 0.3 * (index / Math.max(buckets.length - 1, 1));
    const watched = Math.max(0, Math.round(base * wave * growth + (random() - 0.5) * base * 0.25));
    const completed = Math.max(0, Math.round(watched * (0.55 + random() * 0.2)));
    const previousWatched = Math.max(0, Math.round(watched * (0.82 + random() * 0.14)));

    return { completed, label: bucket.label, longLabel: bucket.longLabel, previousWatched, watched };
  });

  const watchedSeries = activity.map((point) => point.watched);
  const completedSeries = activity.map((point) => point.completed);
  const studyingTotal = Math.round((Math.max(...watchedSeries, 1) * (hourly ? 4 : 3.4)));
  const completedTotal = sum(completedSeries);
  const accessesSeries = activity.map(() => Math.round(random() * (hourly ? 2 : 3) * scale));
  const accessesTotal = Math.max(sum(accessesSeries), productId ? 3 : 12);

  const products: Record<string, TodayDemoProduct> = {};

  for (const id of productIds) {
    const productRandom = seededRandom(`produto|${id}|${resolved.from}|${resolved.to}`);
    const studentsWithAccess = 40 + Math.round(productRandom() * 280);
    const studying = Math.round(studentsWithAccess * (0.08 + productRandom() * 0.3));

    products[id] = {
      completion: 18 + Math.round(productRandom() * 50),
      studentsWithAccess,
      studying,
      trend: Math.round((productRandom() - 0.35) * 30),
      weekly: Array.from({ length: 8 }, () => Math.round(studying * (0.6 + productRandom() * 0.6)))
    };
  }

  return {
    activity,
    completed: { previousTotal: Math.round(completedTotal / 0.97), series: completedSeries, total: completedTotal },
    completion90: { previousTotal: 39, series: activity.map((_, index) => 36 + Math.round((index / Math.max(activity.length, 1)) * 5)), total: 41 },
    newAccesses: { previousTotal: Math.max(1, Math.round(accessesTotal / 1.04)), series: accessesSeries, total: accessesTotal },
    products,
    studying: { previousTotal: Math.round(studyingTotal / 1.12), series: watchedSeries, total: studyingTotal }
  };
}

/** "Com acesso" e "Estudando (7 d)" simulados da lista de Produtos, estaveis por produto. */
export function buildProductListDemo(productId: string) {
  const random = seededRandom(`lista|${productId}`);
  const studentsWithAccess = 40 + Math.round(random() * 280);

  return { studentsWithAccess, studyingLast7d: Math.round(studentsWithAccess * (0.06 + random() * 0.24)) };
}
