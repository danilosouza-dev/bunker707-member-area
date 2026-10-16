// Substituto de "next/cache" nos testes de integracao: fora de um request do Next nao existe cache de
// pagina para invalidar, e revalidatePath/revalidateTag lancam "static generation store missing". Aqui
// a invalidacao vira anotacao (para o teste conferir, se quiser) e o cache vira passagem direta.

export const invalidations = (globalThis.__integrationInvalidations ??= []);

export function revalidatePath(path, type) {
  invalidations.push({ kind: "path", path, type });
}

export function revalidateTag(tag) {
  invalidations.push({ kind: "tag", tag });
}

export function updateTag(tag) {
  invalidations.push({ kind: "tag", tag });
}

export function refresh() {
  invalidations.push({ kind: "refresh" });
}

export function unstable_noStore() {}

export function unstable_cache(fn) {
  return fn;
}

export function cacheTag() {}

export function cacheLife() {}
