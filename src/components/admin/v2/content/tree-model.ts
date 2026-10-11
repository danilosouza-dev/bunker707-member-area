// Arvore Modulo > Aula da aba Conteudo (docs/17 §1.6.3), sem React: mover por arrastar, por Alt+setas
// e por "Mover para", montar a ordem completa que reorderContent recebe, excluir e desfazer no lugar,
// trocar linhas provisorias pelas criadas no servidor. Modulo puro (so imports de tipo usam "@/"):
// tests/admin-content-tree.test.mjs carrega direto pelo Node.
//
// Toda funcao devolve uma arvore nova (ou null quando nada muda) e renumera as posicoes, para a tela
// nunca mostrar "Aula 3" duas vezes depois de um movimento.

import type { LessonNode, LessonStatus, ModuleNode, ReorderContentInput } from "@/server/catalog/types";

export type TreeLesson = LessonNode & {
  /**
   * Chave estavel da linha na tela: o id provisorio de quando foi criada. A linha nao remonta quando
   * o id definitivo chega (o campo nao perde o foco e a animacao nao pisca).
   */
  clientKey?: string;
  /** Linha criada na tela que ainda espera o servidor (id provisorio). */
  pending?: boolean;
};

export type TreeModule = Omit<ModuleNode, "lessons"> & {
  clientKey?: string;
  lessons: TreeLesson[];
  pending?: boolean;
};

export type ContentTree = readonly TreeModule[];

/* ------------------------------------------------------------------------------------------------
 * Ids provisorios
 * ---------------------------------------------------------------------------------------------- */

export const TEMP_ID_PREFIX = "tmp-";

let tempCounter = 0;

/** Id de uma linha criada na tela antes da resposta do servidor. Nunca vai para o servidor. */
export function makeTempId(kind: "lesson" | "module") {
  tempCounter += 1;

  return `${TEMP_ID_PREFIX}${kind}-${Date.now().toString(36)}-${tempCounter}`;
}

export function isTempId(id: string) {
  return id.startsWith(TEMP_ID_PREFIX);
}

/* ------------------------------------------------------------------------------------------------
 * Leitura
 * ---------------------------------------------------------------------------------------------- */

/** Posicoes 1..n e moduleId coerentes com a ordem do array. Reaproveita objetos que nao mudaram. */
export function renumberTree(modules: readonly TreeModule[]): TreeModule[] {
  return modules.map((module, moduleIndex) => {
    let lessonsChanged = false;
    const lessons = module.lessons.map((lesson, lessonIndex) => {
      if (lesson.position === lessonIndex + 1 && lesson.moduleId === module.id) {
        return lesson;
      }

      lessonsChanged = true;

      return { ...lesson, moduleId: module.id, position: lessonIndex + 1 };
    });

    if (!lessonsChanged && module.position === moduleIndex + 1) {
      return module;
    }

    return { ...module, lessons: lessonsChanged ? lessons : module.lessons, position: moduleIndex + 1 };
  });
}

/** Copia a arvore do servidor para o estado local da tela. */
export function toTree(modules: readonly ModuleNode[]): TreeModule[] {
  return renumberTree(modules.map((module) => ({ ...module, lessons: module.lessons.map((lesson) => ({ ...lesson })) })));
}

export function countTree(tree: ContentTree) {
  let lessons = 0;
  let publishedLessons = 0;

  for (const entry of tree) {
    for (const lesson of entry.lessons) {
      lessons += 1;

      if (lesson.status === "published") {
        publishedLessons += 1;
      }
    }
  }

  return { lessons, modules: tree.length, publishedLessons };
}

export function locateLesson(tree: ContentTree, lessonId: string) {
  for (let moduleIndex = 0; moduleIndex < tree.length; moduleIndex += 1) {
    const lessonIndex = tree[moduleIndex].lessons.findIndex((lesson) => lesson.id === lessonId);

    if (lessonIndex >= 0) {
      return { lesson: tree[moduleIndex].lessons[lessonIndex], lessonIndex, module: tree[moduleIndex], moduleIndex };
    }
  }

  return null;
}

export function findModule(tree: ContentTree, moduleId: string) {
  return tree.find((module) => module.id === moduleId) ?? null;
}

/**
 * Id atual de um modulo a partir do id que a tela guardou: o proprio id ou a chave provisoria de
 * quando foi criado (o campo "+ Adicionar aula" pode ter aberto antes do id definitivo chegar).
 */
export function resolveModuleRef(tree: ContentTree, ref: string) {
  return tree.find((module) => module.id === ref || module.clientKey === ref)?.id ?? null;
}

/** Mesma ordem de modulos e de aulas em cada modulo (ignora titulos, status, datas). */
export function sameStructure(left: ContentTree, right: ContentTree) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((module, index) => {
    const other = right[index];

    return (
      module.id === other.id &&
      module.lessons.length === other.lessons.length &&
      module.lessons.every((lesson, lessonIndex) => lesson.id === other.lessons[lessonIndex].id)
    );
  });
}

/** Ids das aulas na ordem da arvore, sem as provisorias (aula anterior/proxima do painel). */
export function flattenLessonIds(tree: ContentTree) {
  return tree.flatMap((module) => module.lessons.filter((lesson) => !lesson.pending).map((lesson) => lesson.id));
}

export function neighborLessonIds(tree: ContentTree, lessonId: string) {
  const ids = flattenLessonIds(tree);
  const index = ids.indexOf(lessonId);

  if (index < 0) {
    return { next: null, previous: null };
  }

  return { next: ids[index + 1] ?? null, previous: ids[index - 1] ?? null };
}

/** "Módulo 1, aula 1 de 4" (mesma frase de LessonEditorData.positionLabel). */
export function lessonPositionLabel(tree: ContentTree, lessonId: string) {
  const found = locateLesson(tree, lessonId);

  if (!found) {
    return null;
  }

  return `Módulo ${found.module.position}, aula ${found.lessonIndex + 1} de ${found.module.lessons.length}`;
}

/** Frase para leitor de tela depois de mover: "Aula 2 de 4 no Módulo 1". */
export function describeLessonPlace(tree: ContentTree, lessonId: string) {
  const found = locateLesson(tree, lessonId);

  return found
    ? `Aula ${found.lessonIndex + 1} de ${found.module.lessons.length} no Módulo ${found.moduleIndex + 1}`
    : null;
}

/* ------------------------------------------------------------------------------------------------
 * Mover
 * ---------------------------------------------------------------------------------------------- */

/** Onde a aula cai: antes/depois de outra aula, ou no comeco/fim de um modulo (modulo vazio, cabecalho). */
export type LessonDropTarget =
  | { kind: "before" | "after"; lessonId: string }
  | { kind: "start" | "end"; moduleId: string };

export type ModuleDropTarget = { kind: "before" | "after"; moduleId: string };

/** Move uma aula. Devolve null quando o destino e invalido ou a ordem nao muda. */
export function moveLesson(tree: ContentTree, lessonId: string, target: LessonDropTarget): TreeModule[] | null {
  const from = locateLesson(tree, lessonId);

  if (!from || ("lessonId" in target && target.lessonId === lessonId)) {
    return null;
  }

  const without = tree.map((module, index) =>
    index === from.moduleIndex ? { ...module, lessons: module.lessons.filter((lesson) => lesson.id !== lessonId) } : module
  );
  let moduleIndex: number;
  let insertAt: number;

  if ("moduleId" in target) {
    moduleIndex = without.findIndex((module) => module.id === target.moduleId);

    if (moduleIndex < 0) {
      return null;
    }

    insertAt = target.kind === "start" ? 0 : without[moduleIndex].lessons.length;
  } else {
    const to = locateLesson(without, target.lessonId);

    if (!to) {
      return null;
    }

    moduleIndex = to.moduleIndex;
    insertAt = to.lessonIndex + (target.kind === "after" ? 1 : 0);
  }

  const next = without.map((module, index) =>
    index === moduleIndex
      ? { ...module, lessons: [...module.lessons.slice(0, insertAt), from.lesson, ...module.lessons.slice(insertAt)] }
      : module
  );
  const result = renumberTree(next);

  return sameStructure(tree, result) ? null : result;
}

/** Move um modulo inteiro (com as aulas). */
export function moveModule(tree: ContentTree, moduleId: string, target: ModuleDropTarget): TreeModule[] | null {
  const fromIndex = tree.findIndex((module) => module.id === moduleId);

  if (fromIndex < 0 || target.moduleId === moduleId) {
    return null;
  }

  const moving = tree[fromIndex];
  const without = tree.filter((item) => item.id !== moduleId);
  const targetIndex = without.findIndex((item) => item.id === target.moduleId);

  if (targetIndex < 0) {
    return null;
  }

  const insertAt = targetIndex + (target.kind === "after" ? 1 : 0);
  const result = renumberTree([...without.slice(0, insertAt), moving, ...without.slice(insertAt)]);

  return sameStructure(tree, result) ? null : result;
}

/**
 * Alt+↑/↓ numa aula: troca com a vizinha; na ponta do modulo, passa para o fim do modulo anterior ou
 * para o comeco do proximo. Na ponta da arvore, nada muda (null).
 */
export function moveLessonByStep(tree: ContentTree, lessonId: string, direction: -1 | 1): TreeModule[] | null {
  const from = locateLesson(tree, lessonId);

  if (!from) {
    return null;
  }

  const neighbor = from.module.lessons[from.lessonIndex + direction];

  if (neighbor) {
    return moveLesson(tree, lessonId, { kind: direction < 0 ? "before" : "after", lessonId: neighbor.id });
  }

  const neighborModule = tree[from.moduleIndex + direction];

  if (!neighborModule) {
    return null;
  }

  return moveLesson(tree, lessonId, { kind: direction < 0 ? "end" : "start", moduleId: neighborModule.id });
}

/** Alt+↑/↓ num modulo. */
export function moveModuleByStep(tree: ContentTree, moduleId: string, direction: -1 | 1): TreeModule[] | null {
  const index = tree.findIndex((module) => module.id === moduleId);
  const neighbor = index >= 0 ? tree[index + direction] : undefined;

  if (!neighbor) {
    return null;
  }

  return moveModule(tree, moduleId, { kind: direction < 0 ? "before" : "after", moduleId: neighbor.id });
}

/** "Mover para…": as aulas vao para o fim do modulo escolhido, na ordem em que estavam na arvore. */
export function moveLessonsToModule(tree: ContentTree, lessonIds: readonly string[], moduleId: string): TreeModule[] | null {
  const wanted = new Set(lessonIds);
  const target = findModule(tree, moduleId);

  if (!target || wanted.size === 0) {
    return null;
  }

  const moving = tree.flatMap((module) => module.lessons.filter((lesson) => wanted.has(lesson.id)));

  if (moving.length === 0) {
    return null;
  }

  const next = tree.map((module) => {
    const kept = module.lessons.filter((lesson) => !wanted.has(lesson.id));

    return module.id === moduleId ? { ...module, lessons: [...kept, ...moving] } : { ...module, lessons: kept };
  });
  const result = renumberTree(next);

  return sameStructure(tree, result) ? null : result;
}

/**
 * Entrada de reorderContent: a ordem completa de modulos e aulas. `resolveId` troca ids provisorios
 * pelos definitivos (criados antes desta reordenacao) e devolve null para o que nao existe no servidor.
 */
export function buildReorderInput(
  productId: string,
  tree: ContentTree,
  resolveId: (id: string) => string | null = (id) => (isTempId(id) ? null : id)
): ReorderContentInput {
  return {
    modules: tree.flatMap((module) => {
      const id = resolveId(module.id);

      if (!id) {
        return [];
      }

      return [
        {
          id,
          lessonIds: module.lessons.flatMap((lesson) => {
            const lessonId = resolveId(lesson.id);

            return lessonId ? [lessonId] : [];
          })
        }
      ];
    }),
    productId
  };
}

/* ------------------------------------------------------------------------------------------------
 * Excluir e desfazer
 * ---------------------------------------------------------------------------------------------- */

export type RemovedLesson = { index: number; lesson: TreeLesson; moduleId: string };

export function removeLessons(tree: ContentTree, lessonIds: readonly string[]) {
  const wanted = new Set(lessonIds);
  const removed: RemovedLesson[] = [];
  const next = tree.map((module) => {
    if (!module.lessons.some((lesson) => wanted.has(lesson.id))) {
      return module;
    }

    module.lessons.forEach((lesson, index) => {
      if (wanted.has(lesson.id)) {
        removed.push({ index, lesson, moduleId: module.id });
      }
    });

    return { ...module, lessons: module.lessons.filter((lesson) => !wanted.has(lesson.id)) };
  });

  return { removed, tree: removed.length > 0 ? renumberTree(next) : [...tree] };
}

/** Devolve as aulas excluidas aos lugares de antes (modulo que tambem sumiu: a aula fica de fora). */
export function restoreLessons(tree: ContentTree, removed: readonly RemovedLesson[]): TreeModule[] {
  const byModule = new Map<string, RemovedLesson[]>();

  for (const item of removed) {
    const list = byModule.get(item.moduleId) ?? [];
    list.push(item);
    byModule.set(item.moduleId, list);
  }

  const next = tree.map((module) => {
    const items = byModule.get(module.id);

    if (!items) {
      return module;
    }

    const present = new Set(module.lessons.map((lesson) => lesson.id));
    const lessons = [...module.lessons];

    for (const item of [...items].sort((left, right) => left.index - right.index)) {
      if (!present.has(item.lesson.id)) {
        lessons.splice(Math.min(item.index, lessons.length), 0, item.lesson);
      }
    }

    return { ...module, lessons };
  });

  return renumberTree(next);
}

export type RemovedModule = { index: number; module: TreeModule };

export function removeModule(tree: ContentTree, moduleId: string) {
  const index = tree.findIndex((module) => module.id === moduleId);

  if (index < 0) {
    return { removed: null, tree: [...tree] };
  }

  return { removed: { index, module: tree[index] } satisfies RemovedModule, tree: renumberTree(tree.filter((module) => module.id !== moduleId)) };
}

export function restoreModule(tree: ContentTree, removed: RemovedModule): TreeModule[] {
  if (tree.some((module) => module.id === removed.module.id)) {
    return [...tree];
  }

  const insertAt = Math.min(removed.index, tree.length);

  return renumberTree([...tree.slice(0, insertAt), removed.module, ...tree.slice(insertAt)]);
}

/* ------------------------------------------------------------------------------------------------
 * Criar (linhas provisorias) e aplicar respostas do servidor
 * ---------------------------------------------------------------------------------------------- */

export function appendModule(tree: ContentTree, module: TreeModule): TreeModule[] {
  return renumberTree([...tree, module]);
}

export function appendLessons(tree: ContentTree, moduleId: string, lessons: readonly TreeLesson[]): TreeModule[] {
  return renumberTree(
    tree.map((module) => (module.id === moduleId ? { ...module, lessons: [...module.lessons, ...lessons] } : module))
  );
}

/** Troca o modulo provisorio pelo criado, mantendo as aulas que a tela ja tinha posto nele. */
export function resolveTempModule(tree: ContentTree, tempId: string, created: ModuleNode): TreeModule[] {
  return renumberTree(
    tree.map((module) =>
      module.id === tempId
        ? {
            ...module,
            clientKey: module.clientKey ?? tempId,
            // O servidor copia a capa do produto para o modulo novo.
            coverUrl: created.coverUrl ?? null,
            id: created.id,
            pending: false,
            release: created.release,
            releaseLabel: created.releaseLabel,
            title: created.title,
            updatedAt: created.updatedAt
          }
        : module
    )
  );
}

/**
 * Troca as aulas provisorias, na ordem, pelas criadas no servidor. Provisorias sem par (linha que o
 * servidor pulou) saem da arvore; aulas criadas sem par entram logo depois da ultima provisoria.
 */
export function resolveTempLessons(tree: ContentTree, tempIds: readonly string[], created: readonly LessonNode[]): TreeModule[] {
  const replacement = new Map<string, LessonNode | null>();

  tempIds.forEach((tempId, index) => replacement.set(tempId, created[index] ?? null));

  const extra = created.slice(tempIds.length);
  const lastTempId = tempIds[tempIds.length - 1];

  const next = tree.map((module) => {
    if (!module.lessons.some((lesson) => replacement.has(lesson.id))) {
      return module;
    }

    const lessons = module.lessons.flatMap((lesson): TreeLesson[] => {
      if (!replacement.has(lesson.id)) {
        return [lesson];
      }

      const real = replacement.get(lesson.id);
      const resolved: TreeLesson[] = real ? [{ ...real, clientKey: lesson.clientKey ?? lesson.id, pending: false }] : [];

      return lesson.id === lastTempId ? [...resolved, ...extra.map((item) => ({ ...item, pending: false }))] : resolved;
    });

    return { ...module, lessons };
  });

  return renumberTree(next);
}

/** Tira da arvore linhas provisorias cuja criacao falhou (aulas e modulos). */
export function dropTempItems(tree: ContentTree, ids: readonly string[]): TreeModule[] {
  const wanted = new Set(ids);

  return renumberTree(
    tree
      .filter((module) => !wanted.has(module.id))
      .map((module) =>
        module.lessons.some((lesson) => wanted.has(lesson.id))
          ? { ...module, lessons: module.lessons.filter((lesson) => !wanted.has(lesson.id)) }
          : module
      )
  );
}

/** Painel da aula salvou: a linha da arvore muda na hora, sem perder o lugar que a tela mostra. */
export function applyLessonUpdate(tree: ContentTree, lesson: LessonNode): TreeModule[] {
  return tree.map((module) => {
    const index = module.lessons.findIndex((item) => item.id === lesson.id);

    if (index < 0) {
      return module;
    }

    const current = module.lessons[index];
    const lessons = [...module.lessons];
    lessons[index] = {
      ...current,
      ...lesson,
      clientKey: current.clientKey,
      moduleId: current.moduleId,
      pending: false,
      position: current.position
    };

    return { ...module, lessons };
  });
}

export function pickLessonStatuses(tree: ContentTree, lessonIds: readonly string[]) {
  const wanted = new Set(lessonIds);
  const statuses = new Map<string, LessonStatus>();

  for (const entry of tree) {
    for (const lesson of entry.lessons) {
      if (wanted.has(lesson.id)) {
        statuses.set(lesson.id, lesson.status);
      }
    }
  }

  return statuses;
}

/** Publicar/Despublicar em massa (ou desfazer com o mapa devolvido por pickLessonStatuses). */
export function setLessonStatuses(tree: ContentTree, statuses: ReadonlyMap<string, LessonStatus>): TreeModule[] {
  return tree.map((module) => {
    if (!module.lessons.some((lesson) => statuses.has(lesson.id) && statuses.get(lesson.id) !== lesson.status)) {
      return module;
    }

    return {
      ...module,
      lessons: module.lessons.map((lesson) => {
        const status = statuses.get(lesson.id);

        return status && status !== lesson.status ? { ...lesson, status } : lesson;
      })
    };
  });
}

export type ModulePatch = Partial<Pick<TreeModule, "coverUrl" | "release" | "releaseLabel" | "title" | "updatedAt">>;

export function patchModule(tree: ContentTree, moduleId: string, patch: ModulePatch): TreeModule[] {
  return tree.map((module) => (module.id === moduleId ? { ...module, ...patch } : module));
}

/**
 * Depois de reordenar, o servidor devolve a arvore com os updated_at novos. A tela fica com a ordem
 * dela (pode ja ter mudado de novo) e so atualiza as datas, para a proxima edicao nao dar 409 a toa.
 */
export function mergeServerTimestamps(tree: ContentTree, modules: readonly ModuleNode[]): TreeModule[] {
  const moduleDates = new Map(modules.map((module) => [module.id, module.updatedAt]));
  const lessonDates = new Map(modules.flatMap((module) => module.lessons.map((lesson) => [lesson.id, lesson.updatedAt] as const)));

  return tree.map((module) => {
    const moduleDate = moduleDates.get(module.id);
    const lessonsChanged = module.lessons.some((lesson) => {
      const date = lessonDates.get(lesson.id);

      return date !== undefined && date !== lesson.updatedAt;
    });

    if ((moduleDate === undefined || moduleDate === module.updatedAt) && !lessonsChanged) {
      return module;
    }

    return {
      ...module,
      lessons: lessonsChanged
        ? module.lessons.map((lesson) => {
            const date = lessonDates.get(lesson.id);

            return date !== undefined && date !== lesson.updatedAt ? { ...lesson, updatedAt: date } : lesson;
          })
        : module.lessons,
      updatedAt: moduleDate ?? module.updatedAt
    };
  });
}

/** Data mais recente entre duas ISO (o painel usa a maior entre a da leitura e a da arvore). */
export function latestTimestamp(left: string | null | undefined, right: string | null | undefined) {
  if (!left) {
    return right ?? "";
  }

  if (!right) {
    return left;
  }

  return Date.parse(right) > Date.parse(left) ? right : left;
}

/** Selecao que ainda vale: so aulas que existem e ja foram criadas no servidor, na ordem da arvore. */
export function pruneSelection(tree: ContentTree, selection: ReadonlySet<string>) {
  if (selection.size === 0) {
    return [];
  }

  return tree.flatMap((module) => module.lessons.filter((lesson) => !lesson.pending && selection.has(lesson.id)).map((lesson) => lesson.id));
}

/* ------------------------------------------------------------------------------------------------
 * Lista simples ordenavel (cursos de uma Formação)
 * ---------------------------------------------------------------------------------------------- */

export function moveListItem<Item extends { id: string }>(
  items: readonly Item[],
  itemId: string,
  target: { kind: "before" | "after"; id: string }
): Item[] | null {
  const item = items.find((entry) => entry.id === itemId);

  if (!item || target.id === itemId) {
    return null;
  }

  const without = items.filter((entry) => entry.id !== itemId);
  const targetIndex = without.findIndex((entry) => entry.id === target.id);

  if (targetIndex < 0) {
    return null;
  }

  const insertAt = targetIndex + (target.kind === "after" ? 1 : 0);
  const next = [...without.slice(0, insertAt), item, ...without.slice(insertAt)];

  return next.every((entry, index) => entry.id === items[index].id) ? null : next;
}

export function moveListItemByStep<Item extends { id: string }>(items: readonly Item[], itemId: string, direction: -1 | 1) {
  const index = items.findIndex((entry) => entry.id === itemId);
  const neighbor = index >= 0 ? items[index + direction] : undefined;

  return neighbor ? moveListItem(items, itemId, { id: neighbor.id, kind: direction < 0 ? "before" : "after" }) : null;
}

/**
 * Resposta do servidor para a lista de cursos (adicionar, remover, reordenar) sem desfazer a ordem
 * que a tela ja mostra: quem existe nos dois fica na ordem da tela com os dados do servidor; quem so
 * o servidor tem entra no fim; quem o servidor nao tem sai. Posicoes renumeradas.
 */
export function mergeCourseList<Item extends { id: string; position: number }>(local: readonly Item[], server: readonly Item[]): Item[] {
  const byId = new Map(server.map((item) => [item.id, item]));
  const kept = local.flatMap((item) => {
    const fresh = byId.get(item.id);

    return fresh ? [fresh] : [];
  });
  const known = new Set(kept.map((item) => item.id));
  const added = server.filter((item) => !known.has(item.id));

  return renumberList([...kept, ...added]);
}

/** Posicoes 1..n na ordem do array (reaproveita os itens que ja estao certos). */
export function renumberList<Item extends { position: number }>(items: readonly Item[]): Item[] {
  return items.map((item, index) => (item.position === index + 1 ? item : { ...item, position: index + 1 }));
}

/** Lista na ordem pedida (ids que nao existem mais sao ignorados; os que sobram vao para o fim). */
export function orderListLike<Item extends { id: string }>(items: readonly Item[], orderedIds: readonly string[]): Item[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));

  return [...items].sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
}
