import { Info } from "lucide-react";
import { AdminPage } from "../page-container";
import { PageHeader } from "../page-header";
import { CreateMenu } from "./create-menu";
import { TodayActivityCard } from "./today-activity-card";
import { TodayAttention } from "./today-attention";
import { TodayByProduct } from "./today-by-product";
import { TodayKpis } from "./today-kpis";
import { TODAY_DEMO_NOTICE } from "./today-demo";
import type { TodayViewData } from "./today-model";

/** Faixa honesta acima das secoes enquanto o registro de aulas assistidas nao existe (prototipo: `band`). */
export const TODAY_STUDY_NOTICE =
  "O registro de aulas assistidas ainda está sendo construído. Até lá, os números de estudo ficam em “—”.";

function StudyNotice({ demo }: { demo: boolean }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-3.5 py-2.5 text-[13px] leading-5 text-[var(--text-secondary)]">
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--text-tertiary)]" />
      <p>{demo ? TODAY_DEMO_NOTICE : TODAY_STUDY_NOTICE}</p>
    </div>
  );
}

/**
 * Tela Hoje (docs/17 §1.5) na disposicao do prototipo aprovado, de cima para baixo: cabecalho com
 * saudacao, data e Criar; faixa do registro de aulas; "Precisa de atenção hoje"; numeros do periodo;
 * "Atividade dos alunos"; "Por produto". So desenha: os dados chegam prontos de page.tsx.
 */
export function TodayView({ data }: { data: TodayViewData }) {
  return (
    <AdminPage className="gap-6">
      <PageHeader
        actions={data.createItems.length > 0 ? <CreateMenu items={data.createItems} /> : undefined}
        description={data.dateLabel}
        title={data.greeting}
      />
      <StudyNotice demo={Boolean(data.demo)} />
      <div className="flex min-w-0 flex-col gap-8">
        <TodayAttention retryHref={data.retryHref} state={data.attention} />
        <TodayKpis
          comparisonLabel={data.comparisonLabel}
          demo={data.demo}
          heading={data.numbers}
          newAccesses={data.newAccesses}
          periodLabel={data.periodAccessibleLabel}
        />
        <div className="flex min-w-0 flex-col gap-4">
          <TodayActivityCard meta={data.activityMeta} points={data.demo?.activity} />
          <TodayByProduct demo={data.demo?.products} meta={data.byProductMeta} retryHref={data.retryHref} state={data.byProduct} />
        </div>
      </div>
    </AdminPage>
  );
}
