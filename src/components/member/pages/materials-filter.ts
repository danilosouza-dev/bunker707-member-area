// Filtro e busca da pagina /materiais (puro, roda no navegador e nos testes).
// A busca ignora acentos e maiusculas e procura no material (titulo, descricao, tipo), na aula e no
// curso: buscar o nome da aula mostra todos os materiais dela.

import type { StudentMaterialGroupView } from "../../../server/member-area/student-pages-model";

export const ALL_MATERIALS_FILTER = "all";

export type MaterialsFilter = {
  productId: string;
  query: string;
  type: string;
};

export function normalizeMaterialSearch(text: string) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterMaterialGroups(
  groups: readonly StudentMaterialGroupView[],
  filter: MaterialsFilter
): StudentMaterialGroupView[] {
  const query = normalizeMaterialSearch(filter.query);
  const result: StudentMaterialGroupView[] = [];

  for (const group of groups) {
    if (filter.productId !== ALL_MATERIALS_FILTER && group.id !== filter.productId) {
      continue;
    }

    const groupMatches = Boolean(query) && normalizeMaterialSearch(group.title).includes(query);
    const lessons = group.lessons.flatMap((lesson) => {
      const lessonMatches = groupMatches || (Boolean(query) && normalizeMaterialSearch(`${lesson.title} ${lesson.context}`).includes(query));
      const materials = lesson.materials.filter((material) => (
        (filter.type === ALL_MATERIALS_FILTER || material.fileType === filter.type) &&
        (!query || lessonMatches || normalizeMaterialSearch(`${material.title} ${material.description} ${material.typeLabel}`).includes(query))
      ));

      return materials.length > 0 ? [{ ...lesson, materials }] : [];
    });

    if (lessons.length === 0) {
      continue;
    }

    const materials = lessons.flatMap((lesson) => lesson.materials);
    result.push({
      ...group,
      lessons,
      lockedCount: materials.filter((material) => material.locked).length,
      total: materials.length
    });
  }

  return result;
}
