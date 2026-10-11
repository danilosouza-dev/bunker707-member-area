"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { GENERIC_ACTION_ERROR, type ActionFailure, type ActionResult } from "@/lib/action-result";
import { setModuleCover } from "@/server/catalog/module-cover-actions";
import {
  createLessons as createLessonsAction,
  createModule as createModuleAction,
  reorderContent,
  restoreStructure,
  setLessonsStatus as setLessonsStatusAction,
  softDeleteStructure,
  updateLesson,
  updateModule
} from "@/server/catalog/content-actions";
import { describeReleasePhrase, initialLessonStatus } from "@/server/catalog/model";
import type {
  LessonNode,
  LessonStatus,
  ModuleNode,
  ProductSituation,
  ReleasePhrase,
  StructureDeleted,
  UpdateLessonInput
} from "@/server/catalog/types";
import { adminToast } from "../toast";
import { pluralize } from "./content-ui";
import { focusTreeItem, lessonFocusSelector, moduleFocusSelector } from "./dnd";
import { describeCreationResult, provisionalLessonTitle, type LessonInputPlan } from "./lesson-paste";
import {
  appendLessons,
  appendModule,
  applyLessonUpdate,
  buildReorderInput,
  describeLessonPlace,
  dropTempItems,
  findModule,
  isTempId,
  latestTimestamp,
  locateLesson,
  makeTempId,
  mergeServerTimestamps,
  moveLesson,
  moveLessonByStep,
  moveLessonsToModule,
  moveModule,
  moveModuleByStep,
  patchModule,
  pickLessonStatuses,
  removeLessons,
  removeModule,
  resolveModuleRef,
  resolveTempLessons,
  resolveTempModule,
  restoreLessons,
  restoreModule,
  setLessonStatuses,
  toTree,
  type LessonDropTarget,
  type ModuleDropTarget,
  type TreeLesson,
  type TreeModule
} from "./tree-model";
import { createIdMap, createMutationQueue, createValueStore } from "./tree-store";

// Estado e gravacoes da arvore da aba Conteudo (docs/17 §1.6.3). A tela muda na hora (otimista) e as
// gravacoes entram numa fila, uma depois da outra, na mesma ordem das acoes: criar, mover, excluir e
// desfazer nunca se cruzam no servidor. Mover envia a ordem completa (reorderContent) tirada no
// instante do movimento, com os ids provisorios traduzidos na hora de rodar.

export type TreeBanner = {
  message: string;
  /** Mostra "Recarregar": o servidor pode estar diferente da tela (409 ou ordem nao salva). */
  reload: boolean;
  title?: string;
};

type UseContentTreeOptions = {
  initialModules: ModuleNode[];
  /** Aulas que sumiram da arvore (excluidas, ou dentro de um modulo excluido): o painel fecha. */
  onLessonsGone: (lessonIds: string[]) => void;
  /** Situacao das aulas mudou no servidor (o painel aberto precisa reler a data de alteracao). */
  onLessonsStatusChanged: (lessonIds: string[]) => void;
  productId: string;
  situation: ProductSituation;
};

const IMMEDIATE: ReleasePhrase = { mode: "immediate" };

function failureOf(result: ActionResult<unknown> | undefined): ActionFailure {
  if (result && !result.ok) {
    return result;
  }

  return { error: GENERIC_ACTION_ERROR, ok: false, status: 500 };
}

function lessonsLabel(count: number, singular: string, plural: string) {
  return count === 1 ? singular : `${count} ${plural}`;
}

export function useContentTree({ initialModules, onLessonsGone, onLessonsStatusChanged, productId, situation }: UseContentTreeOptions) {
  const router = useRouter();
  const [store] = useState(() => createValueStore<TreeModule[]>(toTree(initialModules)));
  const [queue] = useState(() => createMutationQueue((error) => console.error("[conteudo] gravacao falhou", error)));
  const [ids] = useState(() => createIdMap(isTempId));
  const tree = useSyncExternalStore(store.subscribe, store.get, store.get);
  const saving = useSyncExternalStore(
    queue.subscribe,
    () => !queue.isIdle(),
    () => false
  );
  const [banner, setBanner] = useState<TreeBanner | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [selection, setSelection] = useState<ReadonlySet<string>>(() => new Set());
  const [addingLessonIn, setAddingLessonIn] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);

  // Dados que mudam a cada render, lidos so dentro das acoes (nunca durante o render).
  const latest = useRef({ onLessonsGone, onLessonsStatusChanged, situation });
  const adoptServerTree = useRef(false);

  useEffect(() => {
    latest.current = { onLessonsGone, onLessonsStatusChanged, situation };
  });

  // "Recarregar" pediu uma leitura nova: quando ela chega (e nada esta gravando), a arvore do
  // servidor substitui a da tela. Fora disso a tela e a fonte da verdade (navegar pelo painel
  // ?aula= rele a pagina, mas nao pode desfazer o que ainda esta na fila).
  useEffect(() => {
    if (!adoptServerTree.current || !queue.isIdle()) {
      return;
    }

    adoptServerTree.current = false;
    store.set(toTree(initialModules));
  }, [initialModules, queue, store]);

  // Fechar a aba no meio de uma gravacao perderia a mudanca: o navegador pergunta antes.
  useEffect(() => {
    if (!saving) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);

    return () => window.removeEventListener("beforeunload", warn);
  }, [saving]);

  const actions = useMemo(() => {
    function announce(message: string) {
      setAnnouncement(message);
    }

    function showFailure(result: ActionResult<unknown> | undefined, options: { reload?: boolean; title?: string } = {}) {
      const failure = failureOf(result);

      setBanner({
        message: failure.error,
        reload: options.reload ?? failure.status === 409,
        title: options.title
      });
    }

    function reload() {
      setBanner(null);
      adoptServerTree.current = true;

      if (queue.isIdle()) {
        router.refresh();

        return;
      }

      const stop = queue.onIdle(() => {
        stop();
        router.refresh();
      });
    }

    /** Grava a ordem da arvore como estava no instante do movimento. */
    function saveOrder(snapshot: readonly TreeModule[]) {
      void queue.enqueue(async () => {
        const result = await reorderContent(buildReorderInput(productId, snapshot, ids.resolve));

        if (result.ok) {
          store.update((current) => mergeServerTimestamps(current, result.data.modules));

          return;
        }

        showFailure(result, { reload: true, title: "A nova ordem não foi salva." });
      });
    }

    function applyMove(next: TreeModule[] | null, focus?: { lessonId?: string; moduleId?: string }) {
      if (!next) {
        return false;
      }

      store.set(next);
      saveOrder(next);

      if (focus?.lessonId) {
        focusTreeItem(lessonFocusSelector(focus.lessonId));
        const place = describeLessonPlace(next, focus.lessonId);

        if (place) {
          announce(`Aula movida: ${place}.`);
        }
      } else if (focus?.moduleId) {
        focusTreeItem(moduleFocusSelector(focus.moduleId));
        const moved = findModule(next, focus.moduleId);

        if (moved) {
          announce(`Módulo movido para a posição ${moved.position}.`);
        }
      }

      return true;
    }

    function resolvedIds(list: readonly string[]) {
      return list.flatMap((id) => {
        const real = ids.resolve(id);

        return real ? [real] : [];
      });
    }

    function createModule(title: string) {
      const tempId = makeTempId("module");
      const temp: TreeModule = {
        clientKey: tempId,
        coverUrl: null,
        id: tempId,
        lessons: [],
        pending: true,
        position: 0,
        release: IMMEDIATE,
        releaseLabel: describeReleasePhrase(IMMEDIATE),
        title,
        updatedAt: ""
      };
      const next = store.update((current) => appendModule(current, temp));

      setAddingModule(false);
      setAddingLessonIn(tempId);
      announce(`Módulo ${next.length} criado: ${title}. Digite a primeira aula.`);

      void queue.enqueue(async () => {
        const result = await createModuleAction({ productId, title });

        if (result?.ok) {
          ids.set(tempId, result.data.id);
          store.update((current) => resolveTempModule(current, tempId, result.data));

          return;
        }

        ids.fail(tempId);
        store.update((current) => dropTempItems(current, [tempId]));
        setAddingLessonIn((current) => (current === tempId ? null : current));
        showFailure(result, { title: "O módulo não foi criado." });
      });
    }

    function createLessons(moduleRef: string, plan: LessonInputPlan) {
      const moduleId = resolveModuleRef(store.get(), moduleRef);

      if (!moduleId || plan.items.length === 0) {
        return;
      }

      const status: LessonStatus = initialLessonStatus(latest.current.situation);
      const tempIds = plan.items.map(() => makeTempId("lesson"));
      const temps: TreeLesson[] = plan.items.map((item, index) => ({
        clientKey: tempIds[index],
        durationLabel: null,
        id: tempIds[index],
        moduleId,
        pending: true,
        position: 0,
        release: IMMEDIATE,
        releaseLabel: describeReleasePhrase(IMMEDIATE),
        status,
        title: provisionalLessonTitle(item),
        updatedAt: "",
        video: item.video
      }));

      store.update((current) => appendLessons(current, moduleId, temps));
      announce(lessonsLabel(temps.length, "Aula criada.", "aulas criadas."));

      void queue.enqueue(async () => {
        const currentRef = resolveModuleRef(store.get(), moduleRef) ?? moduleRef;
        const realModuleId = ids.resolve(currentRef);

        if (!realModuleId) {
          tempIds.forEach((id) => ids.fail(id));
          store.update((current) => dropTempItems(current, tempIds));

          return;
        }

        const result = await createLessonsAction({
          items: plan.items.map((item) => ({ title: item.title, videoInput: item.videoInput })),
          moduleId: realModuleId
        });

        if (!result?.ok) {
          tempIds.forEach((id) => ids.fail(id));
          store.update((current) => dropTempItems(current, tempIds));
          showFailure(result, { title: plan.items.length === 1 ? "A aula não foi criada." : "As aulas não foram criadas." });

          return;
        }

        const created = result.data.lessons;

        tempIds.forEach((tempId, index) => {
          const lesson = created[index];

          if (lesson) {
            ids.set(tempId, lesson.id);
          } else {
            ids.fail(tempId);
          }
        });
        store.update((current) => resolveTempLessons(current, tempIds, created));

        if (plan.items.length > 1 || plan.rejected.length > 0 || plan.truncated > 0 || result.data.skipped > 0) {
          adminToast.success(
            describeCreationResult({
              created: created.length,
              rejected: plan.rejected.length,
              skipped: result.data.skipped,
              truncated: plan.truncated
            })
          );
        } else if (plan.items[0]?.video && created[0]) {
          adminToast.success(`Aula criada com o vídeo do ${plan.items[0].video.label} reconhecido`);
        }
      });
    }

    function renameModule(moduleId: string, title: string) {
      const before = findModule(store.get(), moduleId);

      if (!before || before.title === title) {
        return;
      }

      store.update((current) => patchModule(current, moduleId, { title }));

      void queue.enqueue(async () => {
        const realId = ids.resolve(moduleId);

        if (!realId) {
          return;
        }

        const result = await updateModule({ id: realId, title });

        if (result?.ok) {
          store.update((current) =>
            patchModule(current, result.data.id, {
              release: result.data.release,
              releaseLabel: result.data.releaseLabel,
              title: result.data.title,
              updatedAt: result.data.updatedAt
            })
          );
          adminToast.success("Nome do módulo salvo");

          return;
        }

        store.update((current) => patchModule(current, moduleId, { title: before.title }));
        showFailure(result, { title: "O nome do módulo não foi salvo." });
      });
    }

    /** Liberacao do modulo (painel pequeno). Devolve o resultado para o painel mostrar o erro no lugar. */
    async function saveModuleRelease(moduleId: string, release: ReleasePhrase) {
      const result = await queue.enqueue(async () => {
        const realId = ids.resolve(moduleId);

        if (!realId) {
          return undefined;
        }

        const saved = await updateModule({ id: realId, release });

        if (saved.ok) {
          store.update((current) =>
            patchModule(current, saved.data.id, {
              release: saved.data.release,
              releaseLabel: saved.data.releaseLabel,
              updatedAt: saved.data.updatedAt
            })
          );
        }

        return saved;
      });

      if (result?.ok) {
        adminToast.success("Liberação do módulo salva");

        return null;
      }

      return failureOf(result);
    }

    /**
     * Capa do modulo (painel "Capa do módulo"): `image` = WebP recortado, link https ou null (voltar
     * para a capa do produto). Grava na fila e devolve a falha para o painel mostrar no campo.
     * `undo` = como voltar ao estado anterior no "Desfazer" (null = sem volta).
     */
    async function saveModuleCover(
      moduleId: string,
      image: string | null,
      options: { undo?: string | null | undefined; undoing?: boolean } = {}
    ): Promise<ActionFailure | null> {
      const result = await queue.enqueue(async () => {
        const realId = ids.resolve(moduleId);

        if (!realId) {
          return undefined;
        }

        const saved = await setModuleCover({ image, moduleId: realId });

        if (saved.ok) {
          store.update((current) =>
            patchModule(current, saved.data.id, { coverUrl: saved.data.coverUrl, updatedAt: saved.data.updatedAt })
          );
        }

        return saved;
      });

      if (!result?.ok) {
        const failure = failureOf(result);

        if (options.undoing) {
          showFailure(result, { title: "Não conseguimos desfazer a troca de capa." });
        }

        return failure;
      }

      const message = options.undoing
        ? "Capa do módulo restaurada"
        : result.data.usesProductCover
          ? "O módulo voltou a usar a capa do produto"
          : "Capa do módulo salva";
      const undo = options.undo;

      adminToast.success(
        message,
        !options.undoing && undo !== undefined
          ? { onUndo: () => void saveModuleCover(result.data.id, undo, { undoing: true }) }
          : undefined
      );

      return null;
    }

    function deleteLessons(lessonIds: readonly string[]) {
      const current = store.get();
      const wanted = lessonIds.filter((id) => !isTempId(id) && locateLesson(current, id));
      const { removed, tree: next } = removeLessons(current, wanted);

      if (removed.length === 0) {
        return;
      }

      store.set(next);
      setSelection((selected) => {
        if (!wanted.some((id) => selected.has(id))) {
          return selected;
        }

        const kept = new Set(selected);
        wanted.forEach((id) => kept.delete(id));

        return kept;
      });
      latest.current.onLessonsGone(wanted);
      announce(lessonsLabel(removed.length, "Aula excluída.", "aulas excluídas."));

      const deletion = queue.enqueue(async (): Promise<StructureDeleted | null> => {
        const result = await softDeleteStructure({ ids: resolvedIds(wanted), kind: "lesson" });

        if (result?.ok) {
          return result.data;
        }

        store.update((tree) => restoreLessons(tree, removed));
        showFailure(result, { title: removed.length === 1 ? "A aula não foi excluída." : "As aulas não foram excluídas." });

        return null;
      });

      adminToast.success(lessonsLabel(removed.length, "Aula excluída", "aulas excluídas"), {
        onUndo: () => {
          const restored = store.update((tree) => restoreLessons(tree, removed));
          announce(lessonsLabel(removed.length, "Aula restaurada.", "aulas restauradas."));

          void queue.enqueue(async () => {
            const deleted = await deletion;

            if (!deleted) {
              return;
            }

            const result = await restoreStructure({ items: deleted.items, kind: "lesson" });

            if (!result?.ok) {
              store.update((tree) => removeLessons(tree, wanted).tree);
              showFailure(result, { title: "Não conseguimos desfazer a exclusão." });
            }
          });
          // Um movimento feito entre excluir e desfazer reescreveu a ordem sem estas aulas: a ordem da
          // tela volta a valer no servidor.
          saveOrder(restored);
        }
      });
    }

    function deleteModule(moduleId: string) {
      if (isTempId(moduleId)) {
        return;
      }

      const { removed, tree: next } = removeModule(store.get(), moduleId);

      if (!removed) {
        return;
      }

      store.set(next);
      latest.current.onLessonsGone(removed.module.lessons.map((lesson) => lesson.id));
      announce(`Módulo excluído: ${removed.module.title}.`);

      const deletion = queue.enqueue(async (): Promise<StructureDeleted | null> => {
        const result = await softDeleteStructure({ ids: [moduleId], kind: "module" });

        if (result?.ok) {
          return result.data;
        }

        store.update((tree) => restoreModule(tree, removed));
        showFailure(result, { title: "O módulo não foi excluído." });

        return null;
      });

      adminToast.success("Módulo excluído", {
        onUndo: () => {
          const restored = store.update((tree) => restoreModule(tree, removed));
          announce(`Módulo restaurado: ${removed.module.title}.`);

          void queue.enqueue(async () => {
            const deleted = await deletion;

            if (!deleted) {
              return;
            }

            const result = await restoreStructure({ items: deleted.items, kind: "module" });

            if (!result?.ok) {
              store.update((tree) => removeModule(tree, moduleId).tree);
              showFailure(result, { title: "Não conseguimos desfazer a exclusão." });
            }
          });
          saveOrder(restored);
        }
      });
    }

    function setLessonsStatus(lessonIds: readonly string[], status: LessonStatus) {
      const wanted = lessonIds.filter((id) => !isTempId(id));
      const before = pickLessonStatuses(store.get(), wanted);
      const changing = wanted.filter((id) => before.has(id) && before.get(id) !== status);

      if (changing.length === 0) {
        return;
      }

      store.update((current) => setLessonStatuses(current, new Map(changing.map((id) => [id, status]))));

      void queue.enqueue(async () => {
        const result = await setLessonsStatusAction({ ids: resolvedIds(changing), status });

        if (!result?.ok) {
          store.update((current) => setLessonStatuses(current, before));
          showFailure(result, { title: "A situação das aulas não mudou." });

          return;
        }

        adminToast.success(
          status === "published"
            ? lessonsLabel(changing.length, "Aula publicada", "aulas publicadas")
            : lessonsLabel(changing.length, "Aula voltou para rascunho", "aulas voltaram para rascunho")
        );
        latest.current.onLessonsStatusChanged(changing);
      });
    }

    function stepLesson(lessonId: string, direction: -1 | 1) {
      applyMove(moveLessonByStep(store.get(), lessonId, direction), { lessonId });
    }

    function stepModule(moduleId: string, direction: -1 | 1) {
      applyMove(moveModuleByStep(store.get(), moduleId, direction), { moduleId });
    }

    function dropLesson(lessonId: string, target: LessonDropTarget) {
      applyMove(moveLesson(store.get(), lessonId, target), { lessonId });
    }

    function dropModule(moduleId: string, target: ModuleDropTarget) {
      applyMove(moveModule(store.get(), moduleId, target), { moduleId });
    }

    /** "Mover para…" (uma aula pelo menu ou varias pela selecao): vao para o fim do modulo escolhido. */
    function moveLessonsTo(lessonIds: readonly string[], moduleId: string) {
      const next = moveLessonsToModule(store.get(), lessonIds, moduleId);
      const target = next ? findModule(next, moduleId) : null;

      if (!applyMove(next) || !target) {
        return;
      }

      adminToast.success(
        `${lessonsLabel(lessonIds.length, "Aula movida", "aulas movidas")} para o Módulo ${target.position}`
      );
      announce(`${pluralize(lessonIds.length, "aula movida", "aulas movidas")} para o Módulo ${target.position}.`);
    }

    /** Painel da aula: salva na fila (depois de qualquer movimento pendente) com a data mais nova conhecida. */
    async function saveLesson(lessonId: string, knownUpdatedAt: string, build: (expectedUpdatedAt: string) => UpdateLessonInput) {
      const result = await queue.enqueue(async () => {
        const found = locateLesson(store.get(), lessonId);
        const saved = await updateLesson(build(latestTimestamp(knownUpdatedAt, found?.lesson.updatedAt)));

        if (saved.ok) {
          store.update((current) => applyLessonUpdate(current, saved.data));
        }

        return saved;
      });

      return result ?? (failureOf(undefined) as ActionResult<LessonNode>);
    }

    function toggleSelection(lessonId: string, selected: boolean) {
      setSelection((current) => {
        if (current.has(lessonId) === selected) {
          return current;
        }

        const next = new Set(current);

        if (selected) {
          next.add(lessonId);
        } else {
          next.delete(lessonId);
        }

        return next;
      });
    }

    function clearSelection() {
      setSelection((current) => (current.size === 0 ? current : new Set()));
    }

    return {
      announce,
      clearSelection,
      createLessons,
      createModule,
      deleteLessons,
      deleteModule,
      dismissBanner: () => setBanner(null),
      dropLesson,
      dropModule,
      moveLessonsTo,
      reload,
      renameModule,
      saveLesson,
      saveModuleCover,
      saveModuleRelease,
      setAddingLessonIn,
      setAddingModule,
      setLessonsStatus,
      stepLesson,
      stepModule,
      toggleSelection
    };
  }, [ids, productId, queue, router, store]);

  return { actions, addingLessonIn, addingModule, announcement, banner, saving, selection, tree };
}

export type ContentTreeController = ReturnType<typeof useContentTree>;
