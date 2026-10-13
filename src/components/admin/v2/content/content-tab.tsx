"use client";

import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { Layers, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useOptimistic, useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LessonEditorData, ModuleNode, ProductSituation, ProductThumbnailSize } from "@/server/catalog/types";
import { ErrorBanner } from "../error-banner";
import { AdminLinkButton } from "../link-button";
import { adminCard } from "../styles";
import { BulkBar } from "./bulk-bar";
import { LiveAnnouncer, pluralize } from "./content-ui";
import { isLessonDragData, isModuleDragData, toLessonDropTarget, toModuleDropTarget } from "./dnd";
import { AddModuleInput } from "./inline-creators";
import { ProductThumb } from "../product-thumb";
import { useProductWorkspace } from "../products/product-workspace";
import { LessonPanel } from "./lesson-panel";
import { ModuleBlock } from "./module-block";
import { ModuleCoverSheet } from "./module-cover-sheet";
import { ModuleReleaseSheet } from "./module-release-sheet";
import { MoveLessonsDialog } from "./move-dialog";
import { ContentTreeContext, type ContentTreeActions } from "./tree-context";
import {
  countTree,
  findModule,
  flattenLessonIds,
  lessonPositionLabel,
  locateLesson,
  neighborLessonIds,
  pruneSelection
} from "./tree-model";
import { useContentTree } from "./use-content-tree";

// Aba Conteudo do produto (docs/17 §1.6.3 e §1.6.4, shot 07): resumo, arvore Modulo › Aula com
// arrastar, Alt+setas e "Mover para…", criacao no lugar, selecao multipla e o painel da aula em
// ?aula=<id>. O painel abre na hora (useOptimistic) e o corpo chega com a leitura do servidor.

type ContentTabProps = {
  canWrite: boolean;
  /** Leitura do servidor para ?aula=<id> (null sem aula no endereco ou aula inexistente). */
  editor: LessonEditorData | null;
  initialModules: ModuleNode[];
  productId: string;
  productTitle: string;
  /** Tamanho da thumbnail do curso (Detalhes): recorte da capa propria dos modulos. */
  productThumbnailSize: ProductThumbnailSize;
  requestedLessonId: string | null;
  situation: ProductSituation;
  studentPreviewHref: string;
};

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-1 font-sans text-xs font-medium text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

export function ContentTab({
  canWrite,
  editor,
  initialModules,
  productId,
  productTitle,
  productThumbnailSize,
  requestedLessonId,
  situation,
  studentPreviewHref
}: ContentTabProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, startNavigation] = useTransition();
  const [openLessonId, setOptimisticLessonId] = useOptimistic(requestedLessonId);
  const [lastLessonId, setLastLessonId] = useState(requestedLessonId);
  const [moveTarget, setMoveTarget] = useState<{ lessonIds: string[]; open: boolean } | null>(null);
  const [releaseFor, setReleaseFor] = useState<{ moduleId: string; open: boolean } | null>(null);
  const [coverFor, setCoverFor] = useState<{ moduleId: string; open: boolean } | null>(null);
  // Capa do produto (cabecalho da pagina): o painel da capa do modulo diz se o modulo usa a dela, e os
  // paineis (aula, capa e liberacao do modulo) mostram a capa ao lado do titulo, como no prototipo.
  const productHeader = useProductWorkspace().header;
  const productCoverUrl = productHeader.coverUrl;
  const sheetMedia = (
    <ProductThumb accent={productHeader.accent} coverUrl={productHeader.coverUrl} size="cover" title={productHeader.title} />
  );

  // O painel guarda a ultima aula aberta para a animacao de saida nao piscar sem conteudo.
  if (openLessonId && openLessonId !== lastLessonId) {
    setLastLessonId(openLessonId);
  }

  const navigate = useCallback(
    (lessonId: string | null) => {
      startNavigation(() => {
        setOptimisticLessonId(lessonId);
        router.push(lessonId ? `${pathname}?aula=${encodeURIComponent(lessonId)}` : pathname, { scroll: false });
      });
    },
    [pathname, router, setOptimisticLessonId]
  );

  const { actions, addingLessonIn, addingModule, announcement, banner, saving, selection, tree } = useContentTree({
    initialModules,
    onLessonsGone: (lessonIds) => {
      if (openLessonId && lessonIds.includes(openLessonId)) {
        navigate(null);
      }
    },
    onLessonsStatusChanged: (lessonIds) => {
      // A data de alteracao da aula aberta mudou no servidor: relemos para o proximo "Salvar" nao dar 409.
      if (openLessonId && lessonIds.includes(openLessonId)) {
        router.refresh();
      }
    },
    productId,
    situation
  });

  // Arrastar e soltar: cada linha e cada modulo registram os proprios alvos (lesson-row.tsx,
  // module-block.tsx); aqui o monitor traduz o alvo mais interno em movimento e grava a ordem.
  useEffect(() => {
    if (!canWrite) {
      return;
    }

    return monitorForElements({
      canMonitor: ({ source }) => isLessonDragData(source.data) || isModuleDragData(source.data),
      onDrop: ({ location, source }) => {
        const targets = location.current.dropTargets;

        if (targets.length === 0) {
          return;
        }

        if (isLessonDragData(source.data)) {
          const target = toLessonDropTarget(targets[0].data);

          if (target) {
            actions.dropLesson(source.data.lessonId, target);
          }

          return;
        }

        if (isModuleDragData(source.data)) {
          for (const entry of targets) {
            const target = toModuleDropTarget(entry.data);

            if (target) {
              actions.dropModule(source.data.moduleId, target);

              return;
            }
          }
        }
      }
    });
  }, [actions, canWrite]);

  const treeActions = useMemo<ContentTreeActions>(
    () => ({
      canWrite,
      createLessons: actions.createLessons,
      createModule: actions.createModule,
      deleteLessons: actions.deleteLessons,
      deleteModule: actions.deleteModule,
      lessonHref: (lessonId) => `${pathname}?aula=${encodeURIComponent(lessonId)}`,
      moveLessonsTo: (lessonIds) => setMoveTarget({ lessonIds, open: true }),
      openLesson: (lessonId) => navigate(lessonId),
      openModuleCover: (moduleId) => setCoverFor({ moduleId, open: true }),
      openModuleRelease: (moduleId) => setReleaseFor({ moduleId, open: true }),
      renameModule: actions.renameModule,
      setAddingLessonIn: actions.setAddingLessonIn,
      setLessonsStatus: actions.setLessonsStatus,
      stepLesson: actions.stepLesson,
      stepModule: actions.stepModule,
      toggleSelection: actions.toggleSelection
    }),
    [actions, canWrite, navigate, pathname]
  );

  const counts = countTree(tree);
  const orderedIds = flattenLessonIds(tree);
  const selectedIds = pruneSelection(tree, selection);
  const panelLessonId = openLessonId ?? lastLessonId;
  const found = panelLessonId ? locateLesson(tree, panelLessonId) : null;
  const panelEditor = editor && editor.lesson.id === panelLessonId ? editor : null;
  // Endereco com uma aula que nao existe (excluida, ou de outro produto): avisa e nao abre o painel.
  const lessonMissing = Boolean(requestedLessonId) && !isNavigating && !found && !panelEditor;
  const panelOpen = Boolean(openLessonId) && !lessonMissing;
  const neighbors = panelLessonId && found
    ? neighborLessonIds(tree, panelLessonId)
    : { next: panelEditor?.nextLessonId ?? null, previous: panelEditor?.previousLessonId ?? null };
  const releaseModule = releaseFor ? findModule(tree, releaseFor.moduleId) : null;
  const coverModule = coverFor ? findModule(tree, coverFor.moduleId) : null;

  return (
    <ContentTreeContext value={treeActions}>
      <div className="flex min-w-0 flex-col gap-3" onKeyDown={(event) => {
        if (event.key === "Escape" && selectedIds.length > 0 && event.target instanceof HTMLElement && !event.target.closest("input, textarea")) {
          actions.clearSelection();
        }
      }}>
        {banner ? (
          <ErrorBanner
            action={
              <>
                {banner.reload ? (
                  <Button className="h-8! px-3" onClick={actions.reload} type="button" variant="secondary">
                    Recarregar
                  </Button>
                ) : null}
                <Button className="h-8! px-3 text-[var(--text-secondary)]" onClick={actions.dismissBanner} type="button" variant="ghost">
                  Fechar
                </Button>
              </>
            }
            title={banner.title}
          >
            {banner.message}
          </ErrorBanner>
        ) : null}

        {lessonMissing ? (
          <ErrorBanner
            action={
              <Button className="h-8! px-3" onClick={() => navigate(null)} type="button" variant="secondary">
                Fechar
              </Button>
            }
          >
            Não encontramos esta aula. Ela pode ter sido excluída.
          </ErrorBanner>
        ) : null}

        {tree.length > 0 ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
                {pluralize(counts.modules, "módulo", "módulos")} · {pluralize(counts.lessons, "aula", "aulas")} ·{" "}
                {pluralize(counts.publishedLessons, "publicada", "publicadas")}
              </p>
              <p aria-hidden={!saving} className="text-[13px] leading-5 text-[var(--text-tertiary)]">
                {saving ? "Salvando…" : ""}
              </p>
              {canWrite ? (
                <p className="ml-auto hidden items-center gap-1.5 text-xs leading-5 font-medium text-[var(--text-tertiary)] md:flex">
                  Arraste pela alça ou use <Kbd>Alt</Kbd>
                  <Kbd>↑</Kbd>
                  <Kbd>↓</Kbd> para reordenar
                </p>
              ) : null}
            </div>

            <div className="flex min-w-0 flex-col gap-3">
              {tree.map((module, index) => (
                <ModuleBlock
                  activeLessonId={panelOpen ? openLessonId : null}
                  addingLesson={addingLessonIn !== null && (addingLessonIn === module.id || addingLessonIn === module.clientKey)}
                  firstLessonId={orderedIds[0] ?? null}
                  isFirst={index === 0}
                  isLast={index === tree.length - 1}
                  key={module.clientKey ?? module.id}
                  lastLessonId={orderedIds[orderedIds.length - 1] ?? null}
                  module={module}
                  selection={selection}
                  selectionActive={selectedIds.length > 0}
                />
              ))}
            </div>

            {canWrite ? (
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {addingModule ? (
                  <AddModuleInput onClose={() => actions.setAddingModule(false)} />
                ) : (
                  <Button
                    className="gap-2 px-3 text-[var(--text-secondary)] hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]"
                    onClick={() => actions.setAddingModule(true)}
                    type="button"
                    variant="ghost"
                  >
                    <Plus aria-hidden="true" className="size-4" />
                    Adicionar módulo
                  </Button>
                )}
              </div>
            ) : null}
          </>
        ) : (
          <div className={cn(adminCard, "flex flex-col items-center gap-4 px-6 py-12 text-center md:py-16")}>
            <span
              aria-hidden="true"
              className="mb-1 grid size-11 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
            >
              <Layers className="size-5" />
            </span>
            <div className="flex max-w-md flex-col gap-1">
              <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]">Este produto ainda não tem aulas.</h2>
              <p className="text-sm leading-5 text-[var(--text-secondary)]">
                {canWrite
                  ? "Comece por um módulo. Dentro dele, digite o nome da aula ou cole o link do vídeo."
                  : "Quem edita o catálogo ainda não adicionou módulos e aulas."}
              </p>
            </div>
            {canWrite ? (
              addingModule ? (
                <div className="flex w-full justify-center text-left">
                  <AddModuleInput onClose={() => actions.setAddingModule(false)} />
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button className="gap-2 px-4" onClick={() => actions.setAddingModule(true)} type="button">
                    <Plus aria-hidden="true" className="size-4" />
                    Adicionar módulo
                  </Button>
                  <AdminLinkButton href="/admin/produtos/importar" variant="secondary">
                    Importar
                  </AdminLinkButton>
                </div>
              )
            ) : null}
          </div>
        )}

        <LiveAnnouncer message={announcement} />

        {/* Espaco para a barra da selecao nao cobrir o fim da arvore. */}
        {canWrite && selectedIds.length > 0 ? <div aria-hidden="true" className="h-20 md:h-14" /> : null}

        {canWrite ? (
          <BulkBar
            count={selectedIds.length}
            onClear={actions.clearSelection}
            onDelete={() => actions.deleteLessons(selectedIds)}
            onMove={() => setMoveTarget({ lessonIds: selectedIds, open: true })}
            onPublish={() => actions.setLessonsStatus(selectedIds, "published")}
            onUnpublish={() => actions.setLessonsStatus(selectedIds, "draft")}
          />
        ) : null}

        {moveTarget ? (
          <MoveLessonsDialog
            lessonIds={moveTarget.lessonIds}
            onMove={(moduleId) => actions.moveLessonsTo(moveTarget.lessonIds, moduleId)}
            onOpenChange={(open) => setMoveTarget((current) => (current ? { ...current, open } : current))}
            open={moveTarget.open}
            tree={tree}
          />
        ) : null}

        {releaseFor && releaseModule ? (
          <ModuleReleaseSheet
            key={releaseModule.id}
            media={sheetMedia}
            module={releaseModule}
            onOpenChange={(open) => setReleaseFor((current) => (current ? { ...current, open } : current))}
            onSave={actions.saveModuleRelease}
            open={releaseFor.open}
            productTitle={productTitle}
          />
        ) : null}

        {coverFor && coverModule ? (
          <ModuleCoverSheet
            canWrite={canWrite}
            key={coverModule.clientKey ?? coverModule.id}
            media={sheetMedia}
            module={coverModule}
            onOpenChange={(open) => setCoverFor((current) => (current ? { ...current, open } : current))}
            onSave={actions.saveModuleCover}
            open={coverFor.open}
            productCoverUrl={productCoverUrl}
            productTitle={productTitle}
            thumbnailSize={productThumbnailSize}
          />
        ) : null}

        <LessonPanel
          canWrite={canWrite}
          editor={panelEditor}
          lessonId={panelLessonId}
          media={sheetMedia}
          neighbors={neighbors}
          onClose={() => navigate(null)}
          onNavigate={(lessonId) => navigate(lessonId)}
          onReload={actions.reload}
          open={panelOpen}
          positionLabel={panelLessonId ? lessonPositionLabel(tree, panelLessonId) : null}
          productPublished={situation === "published"}
          productTitle={productTitle}
          saveLesson={actions.saveLesson}
          studentPreviewHref={studentPreviewHref}
          treeLesson={found?.lesson ?? null}
        />
      </div>
    </ContentTreeContext>
  );
}
