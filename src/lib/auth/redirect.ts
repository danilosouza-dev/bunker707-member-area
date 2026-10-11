// Destino depois de entrar (?next=). So caminho interno do proprio site: qualquer coisa que o navegador
// possa ler como outro site vira "/". Navegadores tratam "\" como "/" em endereco http, entao
// "/\evil.com" (ou "/%5Cevil.com") viraria "//evil.com" no cabecalho Location: redirecionamento aberto.
// Por isso o caminho e montado com o parser de URL sobre uma origem fixa e so passa se a origem
// continuar a mesma; o que volta e so caminho, busca e ancora.

const INTERNAL_ORIGIN = "http://bunker707.internal";

/** Barra invertida e caracteres de controle (o parser de URL descarta tab e quebra de linha). */
const UNSAFE_PATH_CHARACTERS = /[\\\u0000-\u001f\u007f]/;

export function getSafeRedirectPath(value?: string | null) {
  if (!value) {
    return "/";
  }

  let decodedValue: string;

  try {
    decodedValue = decodeURIComponent(value);
  } catch {
    return "/";
  }

  if (!decodedValue.startsWith("/") || decodedValue.startsWith("//") || UNSAFE_PATH_CHARACTERS.test(decodedValue)) {
    return "/";
  }

  let url: URL;

  try {
    url = new URL(decodedValue, INTERNAL_ORIGIN);
  } catch {
    return "/";
  }

  if (url.origin !== INTERNAL_ORIGIN) {
    return "/";
  }

  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/auth/callback")) {
    return "/";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}
