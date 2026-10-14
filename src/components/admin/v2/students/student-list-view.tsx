import { Plus, Upload } from "lucide-react";
import {
  STUDENT_SEGMENT_PRESETS,
  describeStudentCount,
  hasStudentListFilters,
  type LifecycleWeek,
  type StudentCohort,
  type StudentListPage,
  type StudentListParams,
  type StudentSavedSegment
} from "@/server/students/model";
import { AdminLinkButton } from "../link-button";
import { PageHeader } from "../page-header";
import { SegmentPicker, type SegmentPickerItem } from "../segment-picker";
import { BulkActionsBar } from "./bulk-actions-bar";
import { ExportButton } from "./export-button";
import { todayInputValue } from "./format";
import { IMPORT_STUDENTS_PATH, hasActiveStudentFilters, newStudentHref, segmentHref, studentListHref, type StudentListFilters } from "./hrefs";
import { LifecycleCard } from "./lifecycle-card";
import type { PickerProduct } from "./product-picker";
import { DeleteSegmentButton, SaveSegmentButton } from "./segment-buttons";
import { StudentListFiltersBar, type StudentFilterProduct } from "./student-list-filters";
import { StudentListPagination, StudentListTable } from "./student-list-table";
import { StudentSelectionProvider } from "./student-selection";

// Lista de alunos (docs/17 §1.7.1): ciclo de vida no topo, segmentos a esquerda, filtros, tabela com
// selecao e barra de acoes em massa, paginacao de 25. A pagina le o banco e passa tudo pronto.

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

function paramsOf(filters: StudentListFilters): StudentListParams {
  const { page, ...params } = filters;
  void page;

  return params;
}

function sameParams(left: StudentListParams, right: StudentListParams) {
  const normalize = (params: StudentListParams) =>
    JSON.stringify(Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== "").sort(([a], [b]) => a.localeCompare(b))));

  return normalize(left) === normalize(right);
}

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
  const params = paramsOf(filters);
  const filtered = hasActiveStudentFilters(filters);
  const countOf = (id: string) => segmentCounts.find((segment) => segment.id === id)?.total ?? null;
  const presetItems: SegmentPickerItem[] = STUDENT_SEGMENT_PRESETS.map((preset) => ({
    active: sameParams(params, preset.params),
    count: countOf(preset.id),
    formula: preset.formula,
    href: segmentHref(preset.params),
    id: preset.id,
    label: preset.label
  }));
  const { group: _group, week: _week, ...reusableParams } = params;
  void _group;
  void _week;
  const canSaveSegment = canAccess && hasStudentListFilters(reusableParams);
  const savedItems: SegmentPickerItem[] = savedSegments.map((segment) => {
    const productMissing = Boolean(segment.params.productId && !products.some((product) => product.id === segment.params.productId));

    return {
      action: canAccess ? <DeleteSegmentButton id={segment.id} name={segment.name} /> : undefined,
      active: sameParams(params, segment.params),
      count: countOf(segment.id),
      formula: productMissing ? "O produto deste segmento foi removido do catálogo." : undefined,
      href: segmentHref(segment.params),
      id: segment.id,
      label: productMissing ? `${segment.name} (produto removido)` : segment.name
    };
  });
  const isPreset = presetItems.some((item) => item.active) || savedItems.some((item) => item.active);
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

      <div className="grid min-w-0 gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SegmentPicker
          ariaLabel="Segmentos de alunos"
          className="self-start"
          items={presetItems}
          saved={savedItems}
          savedEmpty="Aplique um filtro e use “Salvar como segmento”."
        />

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <StudentListFiltersBar cohorts={cohorts} filters={filters} products={products} />
            {canSaveSegment && !isPreset ? <SaveSegmentButton params={reusableParams} /> : null}
          </div>
          <StudentListTable canAdd={canAdd} filtered={filtered} filters={filters} now={now} rows={list.items} selectable={canAccess} />
          {list.total > list.pageSize || filtered ? (
            <StudentListPagination hrefFor={(page) => studentListHref(filters, { page })} page={list.page} pageSize={list.pageSize} total={list.total} />
          ) : null}
        </div>
      </div>

      {canAccess ? <BulkActionsBar canExport={canExport} cohorts={cohorts} labels={labels} products={pickerProducts} today={todayInputValue(now)} /> : null}
    </StudentSelectionProvider>
  );
}
