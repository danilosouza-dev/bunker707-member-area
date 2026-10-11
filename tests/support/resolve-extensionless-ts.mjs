import { registerHooks } from "node:module";

// Os arquivos de src/ importam caminhos relativos sem extensao (ex.: "./feature-flags"),
// como o resto do app: tsc e Next resolvem. O Node so remove tipos e exige a extensao.
// Este hook completa ".ts" em imports relativos sem extensao feitos por arquivos .ts de src/.
// Importe este modulo antes e carregue o arquivo de src/ com import() dinamico, porque
// imports estaticos sao resolvidos antes de qualquer modulo ser avaliado.
const sourceRootUrl = new URL("../../src/", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parentUrl = context.parentURL ?? "";

    if (
      parentUrl.startsWith(sourceRootUrl) &&
      parentUrl.endsWith(".ts") &&
      /^\.{1,2}\//.test(specifier) &&
      !/\.[cm]?[jt]sx?$/.test(specifier)
    ) {
      return nextResolve(`${specifier}.ts`, context);
    }

    return nextResolve(specifier, context);
  }
});
