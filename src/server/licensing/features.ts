// Os modulos (features) que a licenca liga e desliga, e por onde cada um entra no app (docs/32 §5.1 e §11.8).
//
// Na fase 1 a chave dos Webinarios e a lista dos pontos deles ficam escritas a mao aqui e na guarda de teste
// (tests/licenca-modulos.guard.test.mjs); da fase 3 em diante este arquivo vira o manifesto de modulos (a chave, as
// pastas de paginas e de rotas, os itens de menu, as tarefas de minuto e as regras de segmento de cada um). No codigo a
// palavra e `feature`, nunca `module`, que ja e o modulo de curso (a tabela course_modules).
//
// Modulo puro, sem import e sem efeito colateral (nada de Object.freeze no topo): o proxy, o menu do aluno e o do admin
// (que vao para o navegador) e os testes leem direto, e o navegador so leva o que o menu usa.

/** A chave dos Webinarios na licenca assinada (texto livre na licenca; a versao instalada ignora a que nao conhece). */
export const WEBINARS_FEATURE = "webinars";

export type FeatureKey = typeof WEBINARS_FEATURE;

/** Os modulos que esta versao conhece. */
export const KNOWN_FEATURES: readonly FeatureKey[] = [WEBINARS_FEATURE];

/** Nenhum modulo desligado: o app como sempre foi (o modo "off" e quem chama sem a licenca em maos). */
export const NO_DISABLED_FEATURES: readonly FeatureKey[] = [];

/**
 * Os enderecos das paginas do aluno de cada modulo. No modo "enforce", quem ainda nao entrou e chega a uma delas nao
 * vai para o login pelo src/proxy.ts: a pagina responde 404 sem o modulo, e com o modulo ela mesma manda para o login.
 */
export const FEATURE_STUDENT_PAGE_PREFIXES: Readonly<Record<FeatureKey, readonly string[]>> = {
  webinars: ["/webinarios"]
};

/** O endereco e de uma pagina do aluno que pertence a um modulo? ("/webinarios" e "/webinarios/x", nunca "/webinarios-x".) */
export function isFeatureStudentPage(pathname: string): boolean {
  return KNOWN_FEATURES.some((feature) =>
    FEATURE_STUDENT_PAGE_PREFIXES[feature].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  );
}

/** O item (de menu, de busca, de "Criar") fica a mostra? So some o que pede um modulo desligado. */
export function featureVisible(feature: FeatureKey | undefined, disabledFeatures: readonly FeatureKey[]): boolean {
  return feature === undefined || !disabledFeatures.includes(feature);
}
