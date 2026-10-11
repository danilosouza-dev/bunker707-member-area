"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements
} from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { ArrowDown, ArrowUp, BookOpen, ExternalLink, GripVertical, MoreHorizontal, Plus, Unlink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { GENERIC_ACTION_ERROR, type ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import {
  addCourseToFormation,
  removeCourseFromFormation,
  reorderFormationCourses
} from "@/server/catalog/formation-actions";
import type { FormationCourseItem, ProductOption } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { AdminLinkButton } from "../link-button";
import { ProductThumb } from "../product-thumb";
import { StatusChip, situationTone } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { AddCourseDialog } from "./add-course-dialog";
import {
  LiveAnnouncer,
  pluralize,
  rowIconButtonClass,
  rowMenuContentClass,
  rowMenuDangerItemClass,
  rowMenuItemClass
} from "./content-ui";
import { courseFocusSelector, focusTreeItem, isCourseDragData, toCourseDropTarget } from "./dnd";
import { DropLine } from "./lesson-row";
import { mergeCourseList, moveListItem, moveListItemByStep, orderListLike, renumberList } from "./tree-model";
import { createMutationQueue, createValueStore } from "./tree-store";

// Aba Conteudo de uma Formação (docs/17 §1.6.9): no lugar de modulos, "Cursos desta formação", com
// arrastar (e Alt+setas) para ordenar, "Remover da formação" com Desfazer, "Adicionar curso
// existente" e "Criar curso aqui". As gravacoes entram numa fila, como na arvore de aulas.

type FormationCoursesProps = {
  canWrite: boolean;
  courses: FormationCourseItem[];
  formationId: string;
  /** Cursos que podem entrar (formato Curso, fora de outra formacao), lidos no servidor. */
  options: ProductOption[];
};

type CourseActions = {
  canWrite: boolean;
  remove: (courseId: string) => void;
  step: (courseId: string, direction: -1 | 1) => void;
};

const courseRowGrid = cn(
  "grid-cols-[24px_32px_minmax(0,1fr)_44px]",
  "md:grid-cols-[20px_24px_32px_minmax(0,1fr)_112px_168px_32px]"
);

function failureMessage(result: ActionResult<unknown> | undefined) {
  return result && !result.ok ? result : { error: GENERIC_ACTION_ERROR, status: 500 as const };
}

const CourseRow = memo(function CourseRow({
  actions,
  course,
  isFirst,
  isLast
}: {
  actions: CourseActions;
  course: FormationCourseItem;
  isFirst: boolean;
  isLast: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const gripRef = useRef<HTMLSpanElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const courseId = course.id;
  const href = `/admin/produtos/${encodeURIComponent(courseId)}`;

  useEffect(() => {
    const row = rowRef.current;
    const grip = gripRef.current;

    if (!row || !grip || !actions.canWrite) {
      return;
    }

    return combine(
      draggable({
        dragHandle: grip,
        element: row,
        getInitialData: () => ({ courseId, kind: "formation-course" }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false)
      }),
      dropTargetForElements({
        canDrop: ({ source }) => isCourseDragData(source.data),
        element: row,
        getData: ({ element, input }) =>
          attachClosestEdge({ courseId, kind: "formation-course" }, { allowedEdges: ["top", "bottom"], element, input }),
        getIsSticky: () => true,
        onDrag: ({ self, source }) => setEdge(source.data.courseId === courseId ? null : extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null)
      })
    );
  }, [actions.canWrite, courseId]);

  function handleKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (!actions.canWrite || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    event.preventDefault();
    actions.step(courseId, event.key === "ArrowUp" ? -1 : 1);
  }

  const lessonsLabel = course.lessonsTotal > 0
    ? `${course.lessonsPublished} de ${pluralize(course.lessonsTotal, "aula publicada", "aulas publicadas")}`
    : "Sem aulas ainda";

  return (
    <li
      className={cn(
        "group/course relative grid min-h-14 items-center gap-x-3 border-b border-[var(--border-subtle)] py-2 pr-1 pl-3 last:border-b-0 hover:bg-[var(--hover-overlay)] md:pr-2 md:pl-2",
        courseRowGrid,
        dragging && "opacity-40",
        adminTransition
      )}
      ref={rowRef}
    >
      {edge ? <DropLine edge={edge} /> : null}
      <span
        aria-hidden="true"
        className={cn(
          "hidden h-7 w-5 place-items-center rounded text-[var(--text-tertiary)] md:grid",
          actions.canWrite ? "cursor-grab hover:text-[var(--text-primary)] active:cursor-grabbing" : "invisible"
        )}
        ref={gripRef}
        title={actions.canWrite ? "Arraste para mudar a ordem" : undefined}
      >
        <GripVertical className="size-3.5" />
      </span>
      <span className="text-right text-[13px] leading-5 text-[var(--text-tertiary)] tabular-nums">{course.position}</span>
      <ProductThumb accent={course.accent} coverUrl={course.coverUrl} title={course.title} />
      <span className="flex min-w-0 flex-col">
        <Link
          aria-keyshortcuts={actions.canWrite ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          className="min-w-0 truncate rounded-sm text-sm leading-5 font-medium text-[var(--text-primary)] hover:underline hover:decoration-[var(--border-strong)] hover:underline-offset-4"
          data-course-focus={courseId}
          data-navigation-feedback="false"
          href={href}
          onKeyDown={handleKeyDown}
        >
          {course.title}
        </Link>
        <span className="truncate text-xs leading-4 text-[var(--text-secondary)] tabular-nums md:hidden">
          {course.situationLabel} · {lessonsLabel}
        </span>
      </span>
      <span className="hidden md:flex">
        <StatusChip tone={situationTone(course.situation)}>{course.situationLabel}</StatusChip>
      </span>
      <span className="hidden truncate text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums md:block">{lessonsLabel}</span>
      <span className="flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger aria-label={`Ações do curso ${course.title}`} className={rowIconButtonClass}>
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={rowMenuContentClass}>
            <DropdownMenuItem className={rowMenuItemClass} render={<Link data-navigation-feedback="false" href={href} />}>
              <ExternalLink aria-hidden="true" />
              Abrir curso
            </DropdownMenuItem>
            {actions.canWrite ? (
              <>
                <DropdownMenuItem className={rowMenuItemClass} disabled={isFirst} onClick={() => actions.step(courseId, -1)}>
                  <ArrowUp aria-hidden="true" />
                  Subir
                </DropdownMenuItem>
                <DropdownMenuItem className={rowMenuItemClass} disabled={isLast} onClick={() => actions.step(courseId, 1)}>
                  <ArrowDown aria-hidden="true" />
                  Descer
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                <DropdownMenuItem className={rowMenuDangerItemClass} onClick={() => actions.remove(courseId)}>
                  <Unlink aria-hidden="true" />
                  Remover da formação
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </li>
  );
});

export function FormationCourses({ canWrite, courses, formationId, options }: FormationCoursesProps) {
  const router = useRouter();
  const [store] = useState(() => createValueStore<FormationCourseItem[]>(courses));
  const [queue] = useState(() => createMutationQueue((error) => console.error("[formacao] gravacao falhou", error)));
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  const saving = useSyncExternalStore(queue.subscribe, () => !queue.isIdle(), () => false);
  const [banner, setBanner] = useState<{ message: string; reload: boolean; title?: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const adoptServerList = useRef(false);

  useEffect(() => {
    if (!adoptServerList.current || !queue.isIdle()) {
      return;
    }

    adoptServerList.current = false;
    store.set(courses);
  }, [courses, queue, store]);

  const actions = useMemo(() => {
    function fail(result: ActionResult<unknown> | undefined, title: string, reload = false) {
      const failure = failureMessage(result);
      setBanner({ message: failure.error, reload: reload || failure.status === 409, title });
    }

    function saveOrder(snapshot: readonly FormationCourseItem[]) {
      void queue.enqueue(async () => {
        const result = await reorderFormationCourses({ formationId, orderedCourseIds: snapshot.map((course) => course.id) });

        if (result.ok) {
          store.update((current) => mergeCourseList(current, result.data));

          return;
        }

        fail(result, "A nova ordem não foi salva.", true);
      });
    }

    function applyMove(next: FormationCourseItem[] | null, courseId: string) {
      if (!next) {
        return;
      }

      const renumbered = renumberList(next);
      store.set(renumbered);
      saveOrder(renumbered);
      focusTreeItem(courseFocusSelector(courseId));
      const moved = renumbered.find((course) => course.id === courseId);

      if (moved) {
        setAnnouncement(`Curso movido para a posição ${moved.position} de ${renumbered.length}.`);
      }
    }

    function step(courseId: string, direction: -1 | 1) {
      applyMove(moveListItemByStep(store.get(), courseId, direction), courseId);
    }

    function drop(courseId: string, target: { id: string; kind: "before" | "after" }) {
      applyMove(moveListItem(store.get(), courseId, target), courseId);
    }

    function add(courseId: string) {
      void queue.enqueue(async () => {
        const result = await addCourseToFormation({ courseId, formationId });

        if (!result.ok) {
          fail(result, "O curso não entrou na formação.");

          return;
        }

        store.update((current) => mergeCourseList(current, result.data));
        adminToast.success("Curso adicionado à formação");
      });
    }

    function remove(courseId: string) {
      const before = store.get();
      const removed = before.find((course) => course.id === courseId);

      if (!removed) {
        return;
      }

      store.set(renumberList(before.filter((course) => course.id !== courseId)));
      setAnnouncement(`Curso removido da formação: ${removed.title}.`);

      const removal = queue.enqueue(async () => {
        const result = await removeCourseFromFormation({ courseId, formationId });

        if (!result.ok) {
          store.set(before);
          fail(result, "O curso não saiu da formação.");

          return false;
        }

        store.update((current) => mergeCourseList(current, result.data));

        return true;
      });

      adminToast.success("Curso removido da formação. Ele virou um curso avulso em rascunho.", {
        onUndo: () => {
          void queue.enqueue(async () => {
            if (!(await removal)) {
              return;
            }

            const added = await addCourseToFormation({ courseId, formationId });

            if (!added.ok) {
              fail(added, "Não conseguimos desfazer.");

              return;
            }

            // Volta para o lugar de antes (adicionar poe no fim).
            const ordered = orderListLike(added.data, before.map((course) => course.id));
            const reordered = await reorderFormationCourses({ formationId, orderedCourseIds: ordered.map((course) => course.id) });
            store.set(mergeCourseList(ordered, reordered.ok ? reordered.data : added.data));
            setAnnouncement(`Curso devolvido à formação: ${removed.title}.`);
          });
        }
      });
    }

    return { add, canWrite, drop, remove, step };
  }, [canWrite, formationId, queue, store]);

  useEffect(() => {
    if (!canWrite) {
      return;
    }

    return monitorForElements({
      canMonitor: ({ source }) => isCourseDragData(source.data),
      onDrop: ({ location, source }) => {
        const target = location.current.dropTargets[0];

        if (!target || !isCourseDragData(source.data)) {
          return;
        }

        const drop = toCourseDropTarget(target.data);

        if (drop) {
          actions.drop(source.data.courseId, drop);
        }
      }
    });
  }, [actions, canWrite]);

  function reload() {
    setBanner(null);
    adoptServerList.current = true;
    router.refresh();
  }

  const published = list.reduce((total, course) => total + course.lessonsPublished, 0);
  const total = list.reduce((total, course) => total + course.lessonsTotal, 0);
  const createHref = `/admin/produtos/novo?formacao=${encodeURIComponent(formationId)}`;
  const included = new Set(list.map((course) => course.id));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {banner ? (
        <ErrorBanner
          action={
            <>
              {banner.reload ? (
                <Button className="h-8! px-3" onClick={reload} type="button" variant="secondary">
                  Recarregar
                </Button>
              ) : null}
              <Button className="h-8! px-3 text-[var(--text-secondary)]" onClick={() => setBanner(null)} type="button" variant="ghost">
                Fechar
              </Button>
            </>
          }
          title={banner.title}
        >
          {banner.message}
        </ErrorBanner>
      ) : null}

      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">Cursos desta formação</h2>
          <p className="text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
            {pluralize(list.length, "curso", "cursos")} · {published} de {pluralize(total, "aula publicada", "aulas publicadas")}
            {saving ? <span className="text-[var(--text-tertiary)]"> · Salvando…</span> : null}
          </p>
        </div>
        {canWrite && list.length > 0 ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button className="border-[var(--border-strong)] px-4" onClick={() => setAddOpen(true)} type="button" variant="secondary">
              Adicionar curso existente
            </Button>
            <AdminLinkButton className="gap-2" href={createHref}>
              <Plus aria-hidden="true" className="size-4" />
              Criar curso aqui
            </AdminLinkButton>
          </div>
        ) : null}
      </div>

      {list.length > 0 ? (
        <>
          <ol aria-label="Cursos desta formação" className={cn(adminCard, "flex min-w-0 flex-col overflow-hidden")}>
            {list.map((course, index) => (
              <CourseRow actions={actions} course={course} isFirst={index === 0} isLast={index === list.length - 1} key={course.id} />
            ))}
          </ol>
          <p className="text-[13px] leading-5 text-[var(--text-tertiary)]">
            Quem ganha acesso à formação ganha todos os cursos daqui, inclusive os que entrarem depois.
            {canWrite ? " Arraste pela alça ou use Alt + setas no nome para mudar a ordem." : ""}
          </p>
        </>
      ) : (
        <div className={cn(adminCard, "flex flex-col items-center gap-4 px-6 py-12 text-center md:py-16")}>
          <span
            aria-hidden="true"
            className="mb-1 grid size-11 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
          >
            <BookOpen className="size-5" />
          </span>
          <div className="flex max-w-md flex-col gap-1">
            <h3 className="text-base leading-6 font-semibold text-[var(--text-primary)]">Esta formação ainda não tem cursos.</h3>
            <p className="text-sm leading-5 text-[var(--text-secondary)]">
              {canWrite
                ? "Crie um curso aqui dentro ou traga um curso que já existe."
                : "Quem edita o catálogo ainda não adicionou cursos a esta formação."}
            </p>
          </div>
          {canWrite ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <AdminLinkButton className="gap-2" href={createHref}>
                <Plus aria-hidden="true" className="size-4" />
                Criar curso aqui
              </AdminLinkButton>
              <Button className="border-[var(--border-strong)] px-4" onClick={() => setAddOpen(true)} type="button" variant="secondary">
                Adicionar curso existente
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <LiveAnnouncer message={announcement} />

      {canWrite ? (
        <AddCourseDialog
          excludedIds={included}
          onAdd={actions.add}
          onOpenChange={setAddOpen}
          open={addOpen}
          options={options}
        />
      ) : null}
    </div>
  );
}
