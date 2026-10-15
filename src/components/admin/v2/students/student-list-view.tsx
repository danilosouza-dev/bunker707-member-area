import { Plus, Upload } from "lucide-react";
import {
  STUDENT_SEGMENT_PRESETS,
  describeStudentCount,
  hasStudentListFilters,
  pickStudentListParams,
  sameStudentListParams,
  splitStudentListParams,
  withoutLifecycle,
  type LifecycleWeek,
  type StudentCohort,
  type StudentListPage,
  type StudentSavedSegment
} from "@/server/students/model";
import { AdminLinkButton } from "../link-button";
import { PageHeader } from "../page-header";
import { SegmentPicker, type SegmentPickerItem } from "../segment-picker";
import { BulkActionsBar } from "./bulk-actions-bar";
import { ExportButton } from "./export-button";
import { todayInputValue } from "./format";
import { IMPORT_STUDENTS_PATH, newStudentHref, segmentHref, studentListHref, type StudentListFilters } from "./hrefs";
import { LifecycleCard } from "./lifecycle-card";
import type { PickerProduct } from "./product-picker";
import { DeleteSegmentButton, SaveSegmentButton } from "./segment-buttons";
import { StudentListFiltersBar, type StudentFilterProduct } from "./student-list-filters";
import { StudentListPagination, StudentListTable } from "./student-list-table";
import { StudentSelectionProvider } from "./student-selection";

// Lista de alunos (docs/17 §1.7.1): ciclo de vida no topo, segmentos em pilulas com contagem (e o menu
// "Mais segmentos" com os demais e os salvos), filtros, tabela com selecao e barra de acoes em massa,
// paginacao de 25. Sem coluna lateral (decisao do produtor em 15/10/2026: repetia as pilulas e tirava
// largura da tabela). A pagina le o banco e passa tudo pronto.

export type StudentSegmentView = { id: string; total: number };

type StudentListViewProps = {
  canAccess: boolean;
  canAdd: boolean;
  canExport: boolean;
  cohorts: readonly StudentCohort[];
  filters: StudentListFilters;
  lifecycle: { approximateUntil: string | null; weeks: readonly LifecycleWeek[] } | null;
  list: StudentListPage;
  now: number;
  pickerProducts: readonly PickerProduct[];
  products: readonly StudentFilterProduct[];
  savedSegments: readonly StudentSavedSegment[];
  segmentCounts: readonly StudentSegmentView[];
};

export function StudentListView({
  canAccess,
  canAdd,
  canExport,
  cohorts,
  filters,
  lifecycle,
  list,
  now,
  pickerProducts,
  products,
  savedSegments,
  segmentCounts
}: StudentListViewProps) {
  const params = pickStudentListParams(filters);
  const { base, segment } = splitStudentListParams(params);
  const filtered = hasStudentListFilters(params);
  const countOf = (id: string) => segmentCounts.find((item) => item.id === id)?.total ?? null;

  // Pilulas e "Mais segmentos": mantem produto, turma e busca; so trocam o segmento.
  const presetItem = (preset: (typeof STUDENT_SEGMENT_PRESETS)[number]): SegmentPickerItem => ({
    active: sameStudentListParams(segment, preset.params),
    count: countOf(preset.id),
    formula: preset.formula,
    href: segmentHref({ ...base, ...preset.params }),
    id: preset.id,
    label: preset.label
  });
  const mainItems = STUDENT_SEGMENT_PRESETS.filter((preset) => preset.placement === "main").map(presetItem);
  const moreItems = STUDENT_SEGMENT_PRESETS.filter((preset) => preset.placement === "more").map(presetItem);

  // Salvos: abrem exatamente os filtros guardados.
  const savedItems: SegmentPickerItem[] = savedSegments.map((saved) => {
    const productMissing = Boolean(saved.params.productId && !products.some((product) => product.id === saved.params.productId));

    return {
      active: sameStudentListParams(params, saved.params),
      count: countOf(saved.id),
      formula: productMissing ? "O produto deste segmento foi removido do catálogo." : undefined,
      href: segmentHref(saved.params),
      id: saved.id,
      label: productMissing ? `${saved.name} (produto removido)` : saved.name
    };
  });
  const activeSaved = savedSegments.find((saved) => sameStudentListParams(params, saved.params)) ?? null;

  // "Salvar como segmento": so quando ha filtro que ainda nao e um segmento pronto nem salvo.
  const reusable = withoutLifecycle(params);
  const isReadyMade = STUDENT_SEGMENT_PRESETS.some((preset) => sameStudentListParams(params, preset.params));
  const canSaveSegment = canAccess && hasStudentListFilters(reusable) && !isReadyMade && !activeSaved;
  const labels = Object.fromEntries(list.items.map((item) => [item.id, item.fullName]));

  return (
    <StudentSelectionProvider>
      <PageHeader
        actions={
          <>
            {canAccess ? (
              <AdminLinkButton className="gap-1.5" href={IMPORT_STUDENTS_PATH} variant="secondary">
                <Upload aria-hidden="true" className="size-4" />
                Importar CSV
              </AdminLinkButton>
            ) : null}
            {canExport ? <ExportButton params={params} /> : null}
            {canAdd ? (
              <AdminLinkButton className="gap-1.5" href={newStudentHref()}>
                <Plus aria-hidden="true" className="size-4" />
                Adicionar aluno
              </AdminLinkButton>
            ) : null}
          </>
        }
        description={
          filtered
            ? `${describeStudentCount(list.total)} com esses filtros. O ritmo usa o último progresso gravado em aula (aproximado).`
            : `${describeStudentCount(list.total)}. O ritmo usa o último progresso gravado em aula (aproximado).`
        }
        title="Alunos"
      />

      {lifecycle ? <LifecycleCard approximateUntil={lifecycle.approximateUntil} weeks={lifecycle.weeks} /> : null}

      <div className="flex min-w-0 flex-col gap-4">
        <SegmentPicker
          ariaLabel="Segmentos de alunos"
          items={mainItems}
          more={moreItems}
          saved={savedItems}
          savedEmpty="Aplique um filtro e use “Salvar como segmento”."
          trailing={activeSaved && canAccess ? <DeleteSegmentButton id={activeSaved.id} name={activeSaved.name} /> : null}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="min-w-0 flex-1">
            <StudentListFiltersBar cohorts={cohorts} filters={filters} products={products} />
          </div>
          {canSaveSegment ? <SaveSegmentButton params={reusable} /> : null}
        </div>
        <StudentListTable canAdd={canAdd} filtered={filtered} filters={filters} now={now} rows={list.items} selectable={canAccess} />
        {list.total > list.pageSize || filtered ? (
          <StudentListPagination hrefFor={(page) => studentListHref(filters, { page })} page={list.page} pageSize={list.pageSize} total={list.total} />
        ) : null}
      </div>

      {canAccess ? <BulkActionsBar canExport={canExport} cohorts={cohorts} labels={labels} products={pickerProducts} today={todayInputValue(now)} /> : null}
    </StudentSelectionProvider>
  );
}
