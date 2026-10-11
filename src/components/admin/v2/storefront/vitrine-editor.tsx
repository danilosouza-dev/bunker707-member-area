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
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, GripVertical, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import type { HomeSectionConfig } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import {
  VISIBILITY_LABELS,
  areSectionsEqual,
  canDuplicateSection,
  describeSection,
  draftToSection,
  duplicateSection,
  findSectionProblems,
  makeSectionId,
  moveSection,
  moveSectionTo,
  normalizeSectionOrder,
  normalizeStoredSections,
  type SectionDraft,
  type StorefrontEditorData,
  type StorefrontProduct
} from "@/server/storefront/model";
import { ErrorBanner } from "../error-banner";
import { SaveBar } from "../save-bar";
import { RowMenu } from "../settings/kit";
import { StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { SectionSheet } from "./section-sheet";
import { VitrinePreview } from "./vitrine-preview";

// Vitrine (docs/17 §1.8): a ordem das fileiras da home do aluno. Tudo o que muda aqui fica num
// rascunho local ate "Publicar vitrine", que grava a lista inteira pela rota de sempre
// (PUT /api/admin/home-sections), como o admin antigo, mandando a versao lida (`expectedUpdatedAt`):
// se a tela Modulos ligou uma fileira (ou o admin antigo publicou) no meio, o servidor responde 409 e
// nada e apagado; o rascunho fica ate o produtor clicar em "Recarregar". Arrastar pela alca, Alt+setas
// na alca ou o menu "…" mudam a ordem; clicar na fileira abre o painel de edicao.

type VitrineEditorProps = {
  canEdit: boolean;
  data: StorefrontEditorData;
};

type SheetState = { mode: "create" } | { mode: "edit"; sectionId: string };

type PublishError = { conflict: boolean; message: string };

const VITRINE_CONFLICT_MESSAGE = "A vitrine mudou em outra tela (por exemplo, em Módulos). Recarregue para ver a versão atual.";

type SectionDragData = { kind: "vitrine-section"; sectionId: string };

function isSectionDragData(data: Record<string | symbol, unknown>): data is Record<string | symbol, unknown> & SectionDragData {
  return data.kind === "vitrine-section" && typeof data.sectionId === "string";
}

function focusHandle(sectionId: string) {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-vitrine-handle="${CSS.escape(sectionId)}"]`)?.focus();
  });
}

type SectionRowProps = {
  canEdit: boolean;
  index: number;
  isLast: boolean;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (delta: number) => void;
  onOpen: () => void;
  onToggle: () => void;
  productsById: ReadonlyMap<string, StorefrontProduct>;
  section: HomeSectionConfig;
};

function SectionRow({ canEdit, index, isLast, onDelete, onDuplicate, onMove, onOpen, onToggle, productsById, section }: SectionRowProps) {
  const rowRef = useRef<HTMLLIElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);
  const [edge, setEdge] = useState<Edge | null>(null);
  const sectionId = section.id;

  useEffect(() => {
    const row = rowRef.current;
    const handle = handleRef.current;

    if (!row || !handle || !canEdit) {
      return;
    }

    return combine(
      draggable({
        dragHandle: handle,
        element: row,
        getInitialData: () => ({ kind: "vitrine-section", sectionId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false)
      }),
      dropTargetForElements({
        canDrop: ({ source }) => isSectionDragData(source.data),
        element: row,
        getData: ({ element, input }) =>
          attachClosestEdge({ kind: "vitrine-section", sectionId }, { allowedEdges: ["top", "bottom"], element, input }),
        getIsSticky: () => true,
        onDrag: ({ self, source }) => setEdge(source.data.sectionId === sectionId ? null : extractClosestEdge(self.data)),
        onDragEnter: ({ self, source }) => setEdge(source.data.sectionId === sectionId ? null : extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null)
      })
    );
  }, [canEdit, sectionId]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    event.preventDefault();
    onMove(event.key === "ArrowUp" ? -1 : 1);
  }

  const detail = `${describeSection(section, productsById)} · ${VISIBILITY_LABELS[section.visibility]}`;

  return (
    <li
      className={cn(
        "relative flex min-h-14 items-center gap-1 px-2 py-1.5 md:gap-2",
        dragging && "opacity-40"
      )}
      ref={rowRef}
    >
      {edge ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-[var(--text-primary)]",
            edge === "top" ? "-top-px" : "-bottom-px"
          )}
        />
      ) : null}
      {canEdit ? (
        <button
          aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
          aria-label={`Mover “${section.title}”. Arraste ou use Alt e as setas.`}
          className={cn(
            "grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-[var(--text-tertiary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)] active:cursor-grabbing",
            adminTransition
          )}
          data-vitrine-handle={section.id}
          onKeyDown={handleKeyDown}
          ref={handleRef}
          type="button"
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      ) : (
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center text-xs font-medium text-[var(--text-tertiary)] tabular-nums">
          {index + 1}
        </span>
      )}

      <button
        className={cn("flex min-w-0 flex-1 flex-col rounded-md px-2 py-1 text-left hover:bg-[var(--hover-overlay)]", adminTransition)}
        onClick={onOpen}
        type="button"
      >
        <span
          className={cn(
            "truncate text-sm leading-5 font-medium",
            section.isActive ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
          )}
        >
          {section.title || "Fileira sem título"}
        </span>
        <span className="truncate text-xs leading-5 text-[var(--text-secondary)]">
          {section.isActive ? null : <span className="sm:hidden">Oculta · </span>}
          {detail}
        </span>
      </button>

      <span className="hidden shrink-0 sm:block">
        <StatusChip tone={section.isActive ? "success" : "muted"}>{section.isActive ? "Visível" : "Oculta"}</StatusChip>
      </span>

      {canEdit ? (
        <RowMenu
          actions={[
            { icon: <Pencil className="size-4" />, label: "Editar", onSelect: onOpen },
            { disabled: index === 0, icon: <ArrowUp className="size-4" />, label: "Mover para cima", onSelect: () => onMove(-1) },
            { disabled: isLast, icon: <ArrowDown className="size-4" />, label: "Mover para baixo", onSelect: () => onMove(1) },
            ...(canDuplicateSection(section) ? [{ icon: <Copy className="size-4" />, label: "Duplicar", onSelect: onDuplicate }] : []),
            {
              icon: section.isActive ? <EyeOff className="size-4" /> : <Eye className="size-4" />,
              label: section.isActive ? "Ocultar da home" : "Mostrar na home",
              onSelect: onToggle
            },
            { destructive: true, icon: <Trash2 className="size-4" />, label: "Excluir", onSelect: onDelete, separated: true }
          ]}
          label={`Ações de ${section.title}`}
        />
      ) : null}
    </li>
  );
}

export function VitrineEditor({ canEdit, data }: VitrineEditorProps) {
  const router = useRouter();
  const [source, setSource] = useState(data);
  const [published, setPublished] = useState(() => normalizeSectionOrder(data.sections));
  const [configured, setConfigured] = useState(data.sectionsConfigured);
  // Versao da chave homeSections que esta tela leu (null = vitrine nunca publicada).
  const [version, setVersion] = useState(data.sectionsUpdatedAt);
  const [reloadRequested, setReloadRequested] = useState(false);
  const [drafts, setDrafts] = useState(published);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetSession, setSheetSession] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<PublishError | null>(null);
  const [problems, setProblems] = useState<{ message: string; sectionId: string }[]>([]);
  const productsById = useMemo(() => new Map(data.products.map((product) => [product.id, product])), [data.products]);
  const dirty = canEdit && !areSectionsEqual(drafts, published);
  const editing = sheet?.mode === "edit" ? (drafts.find((section) => section.id === sheet.sectionId) ?? null) : null;
  const visibleCount = drafts.filter((section) => section.isActive).length;

  // Leitura nova do servidor (Recarregar, ou depois de publicar): a versao e o publicado seguem o
  // servidor; o rascunho tambem, se nao havia nada pendente ou se o produtor pediu para recarregar.
  if (source !== data) {
    const next = normalizeSectionOrder(data.sections);

    setSource(data);
    setPublished(next);
    setConfigured(data.sectionsConfigured);
    setVersion(data.sectionsUpdatedAt);

    if (reloadRequested || !dirty) {
      setDrafts(next);
      setProblems([]);
      setError(null);
      setReloadRequested(false);
    }
  }

  useEffect(() => {
    if (!dirty) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Soltura: o alvo mais interno diz a fileira e a borda; a posicao final segue a regra do hitbox.
  useEffect(() => {
    if (!canEdit) {
      return;
    }

    return monitorForElements({
      canMonitor: ({ source }) => isSectionDragData(source.data),
      onDrop: ({ location, source }) => {
        const target = location.current.dropTargets[0];

        if (!target || !isSectionDragData(source.data) || !isSectionDragData(target.data)) {
          return;
        }

        const movedId = source.data.sectionId;
        const targetId = target.data.sectionId;
        const edge = extractClosestEdge(target.data);

        setDrafts((current) => {
          const ordered = normalizeSectionOrder(current);
          const startIndex = ordered.findIndex((section) => section.id === movedId);
          const indexOfTarget = ordered.findIndex((section) => section.id === targetId);

          if (startIndex < 0 || indexOfTarget < 0) {
            return current;
          }

          const destination = getReorderDestinationIndex({ axis: "vertical", closestEdgeOfTarget: edge, indexOfTarget, startIndex });

          return moveSectionTo(ordered, movedId, destination);
        });
        setProblems([]);
        focusHandle(movedId);
      }
    });
  }, [canEdit]);

  function openSheet(next: SheetState) {
    setSheet(next);
    setSheetSession((current) => current + 1);
    setSelectedId(next.mode === "edit" ? next.sectionId : null);
  }

  function closeSheet() {
    setSheet(null);
    setSelectedId(null);
  }

  function changeDrafts(next: HomeSectionConfig[]) {
    setDrafts(next);
    setProblems([]);
    setError((current) => (current?.conflict ? current : null));
  }

  function reload() {
    setReloadRequested(true);
    router.refresh();
  }

  function move(sectionId: string, delta: number) {
    changeDrafts(moveSection(drafts, sectionId, delta));
    focusHandle(sectionId);
  }

  function toggle(sectionId: string) {
    changeDrafts(drafts.map((section) => (section.id === sectionId ? { ...section, isActive: !section.isActive } : section)));
  }

  function duplicate(sectionId: string) {
    const result = duplicateSection(drafts, sectionId);

    if (result.newId) {
      changeDrafts(result.sections);
      adminToast.success("Fileira duplicada");
    }
  }

  function remove(sectionId: string) {
    const ordered = normalizeSectionOrder(drafts);
    const index = ordered.findIndex((section) => section.id === sectionId);
    const removed = ordered[index];

    if (!removed) {
      return;
    }

    changeDrafts(ordered.filter((section) => section.id !== sectionId).map((section, order) => ({ ...section, order })));
    closeSheet();
    adminToast.success(`“${removed.title}” saiu da vitrine`, {
      onUndo: () =>
        setDrafts((current) => {
          if (current.some((section) => section.id === removed.id)) {
            return current;
          }

          const next = normalizeSectionOrder(current);
          next.splice(Math.min(index, next.length), 0, removed);

          return next.map((section, order) => ({ ...section, order }));
        })
    });
  }

  function apply(draft: SectionDraft) {
    if (sheet?.mode === "edit" && editing) {
      const updated = draftToSection(draft, { id: editing.id, isActive: editing.isActive, order: editing.order }, productsById);
      changeDrafts(drafts.map((section) => (section.id === editing.id ? updated : section)));
    } else {
      const ordered = normalizeSectionOrder(drafts);
      const created = draftToSection(draft, { id: makeSectionId(ordered), isActive: true, order: ordered.length }, productsById);
      changeDrafts([...ordered, created]);
      adminToast.success("Fileira adicionada no fim da vitrine");
    }

    closeSheet();
  }

  function discard() {
    setDrafts(published);
    setProblems([]);
    setError((current) => (current?.conflict ? current : null));
  }

  async function publish() {
    if (!canEdit || publishing) {
      return;
    }

    const found = findSectionProblems(drafts, productsById);

    if (found.length > 0) {
      setProblems(found);
      setError({ conflict: false, message: "Corrija as fileiras abaixo antes de publicar." });
      return;
    }

    setPublishing(true);
    setError(null);

    try {
      const response = await fetch("/api/admin/home-sections", {
        body: JSON.stringify({ expectedUpdatedAt: configured ? version : null, sections: normalizeSectionOrder(drafts) }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = (await response.json().catch(() => ({}))) as {
        data?: { homeSectionConfigs?: unknown };
        error?: string;
        sectionsUpdatedAt?: string | null;
      };

      if (response.status === 409) {
        setError({ conflict: true, message: VITRINE_CONFLICT_MESSAGE });
        return;
      }

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "Não foi possível publicar a vitrine.");
      }

      const saved = normalizeStoredSections(payload.data.homeSectionConfigs);
      setPublished(saved);
      setDrafts(saved);
      setConfigured(true);
      setVersion(payload.sectionsUpdatedAt ?? null);
      setProblems([]);
      adminToast.success("Vitrine publicada. Os alunos já veem a nova ordem.");
      router.refresh();
    } catch (publishError) {
      setError({
        conflict: false,
        message: publishError instanceof Error ? publishError.message : "Não foi possível publicar a vitrine."
      });
    } finally {
      setPublishing(false);
    }
  }

  const ordered = normalizeSectionOrder(drafts);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!canEdit ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          Só o dono, um administrador ou um editor pode mudar a vitrine. Você está vendo a ordem atual.
        </p>
      ) : !configured ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          A home ainda segue a ordem padrão. Mude o que quiser e publique para fixar a sua.
        </p>
      ) : null}

      {error?.conflict ? (
        <ErrorBanner
          action={
            <Button className="h-8! px-3" onClick={reload} type="button" variant="secondary">
              Recarregar
            </Button>
          }
          title="A vitrine não foi publicada"
        >
          {error.message} O que você mudou aqui só some quando você recarregar.
        </ErrorBanner>
      ) : null}

      {problems.length > 0 ? (
        <ErrorBanner title="A vitrine não foi publicada">
          <ul className="mt-1 flex flex-col gap-1">
            {problems.map((problem) => (
              <li key={`${problem.sectionId}-${problem.message}`}>
                <button
                  className="text-left underline underline-offset-4 hover:text-[var(--text-primary)]"
                  onClick={() => openSheet({ mode: "edit", sectionId: problem.sectionId })}
                  type="button"
                >
                  {problem.message}
                </button>
              </li>
            ))}
          </ul>
        </ErrorBanner>
      ) : null}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="vitrine-rows-title" className={cn(adminCard, "flex min-w-0 flex-col")}>
          <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-3">
            <div className="min-w-0">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="vitrine-rows-title">
                Fileiras da home
              </h2>
              <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
                {ordered.length === 1 ? "1 fileira" : `${ordered.length} fileiras`} · {visibleCount === 1 ? "1 visível" : `${visibleCount} visíveis`}
              </p>
            </div>
            {canEdit ? (
              <Button className="px-4" onClick={() => openSheet({ mode: "create" })} type="button">
                <Plus aria-hidden="true" className="size-4" />
                Nova fileira
              </Button>
            ) : null}
          </header>

          <div className="flex min-h-14 items-center gap-1 border-t border-[var(--border-subtle)] px-2 py-1.5 md:gap-2">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center text-[var(--text-tertiary)]">
              <ImageIcon className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col px-2">
              <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">Banner</span>
              {/* Sem truncate: no celular a frase quebra em duas linhas e o atalho para o Destaque fica inteiro. */}
              <span className="text-xs leading-5 text-pretty text-[var(--text-secondary)]">
                {data.hero.enabled ? "Sempre no topo da home." : "Desligado: a home começa nas fileiras."}{" "}
                <Link
                  className="whitespace-nowrap underline underline-offset-4 hover:text-[var(--text-primary)]"
                  data-navigation-feedback="false"
                  href="/admin/area-de-membros/destaque"
                >
                  Editar em Destaque
                </Link>
              </span>
            </span>
            <span className="hidden shrink-0 sm:block">
              <StatusChip tone={data.hero.enabled ? "success" : "muted"}>{data.hero.enabled ? "Ligado" : "Desligado"}</StatusChip>
            </span>
            {canEdit ? <span aria-hidden="true" className="size-10 shrink-0" /> : null}
          </div>

          {ordered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 border-t border-[var(--border-subtle)] px-6 py-10 text-center">
              <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">A home ainda não tem fileiras.</p>
              <p className="max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
                Comece por Minhas compras e Produtos à venda; depois monte as fileiras que quiser.
              </p>
              {canEdit ? (
                <Button className="px-4" onClick={() => openSheet({ mode: "create" })} type="button" variant="secondary">
                  <Plus aria-hidden="true" className="size-4" />
                  Nova fileira
                </Button>
              ) : null}
            </div>
          ) : (
            <ol aria-label="Fileiras da home, na ordem em que aparecem" className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]">
              {ordered.map((section, index) => (
                <SectionRow
                  canEdit={canEdit}
                  index={index}
                  isLast={index === ordered.length - 1}
                  key={section.id}
                  onDelete={() => remove(section.id)}
                  onDuplicate={() => duplicate(section.id)}
                  onMove={(delta) => move(section.id, delta)}
                  onOpen={() => openSheet({ mode: "edit", sectionId: section.id })}
                  onToggle={() => toggle(section.id)}
                  productsById={productsById}
                  section={section}
                />
              ))}
            </ol>
          )}
        </section>

        <div className="min-w-0 xl:sticky xl:top-20">
          <VitrinePreview
            hero={data.hero}
            onSelectSection={(sectionId) => openSheet({ mode: "edit", sectionId })}
            products={data.products}
            sections={ordered}
            selectedSectionId={selectedId}
          />
        </div>
      </div>

      <SaveBar
        error={problems.length > 0 || error?.conflict ? null : (error?.message ?? null)}
        message="Alterações não publicadas"
        onDiscard={discard}
        onSave={() => void publish()}
        open={dirty}
        saveLabel="Publicar vitrine"
        saving={publishing}
      />

      <SectionSheet
        canEdit={canEdit}
        editing={editing}
        onApply={apply}
        onDelete={remove}
        onOpenChange={(open) => (open ? undefined : closeSheet())}
        open={sheet !== null && (sheet.mode === "create" || editing !== null)}
        products={data.products}
        sections={drafts}
        sessionKey={sheetSession}
      />
    </div>
  );
}
