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

  // Depois de resolver "." e ".." o caminho pode comecar com "//" ("/.//evil.com", "/..//evil.com",
  // "/%2e//evil.com", "/a/..//evil.com/x"): quem montar `new URL(caminho, origem)` ou responder
  // `Location: //evil.com` mandaria a pessoa para outro site. Nunca devolva caminho que comece com "//".
  if (url.pathname.startsWith("//")) {
    return "/";
  }

  if (url.pathname.startsWith("/login") || url.pathname.startsWith("/auth/callback")) {
    return "/";
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Caminho interno do admin (/admin, /admin/..., com busca ou ancora). Quem leva para o admin vindo de
 * fora dele (login, troca de senha, area do aluno) faz um carregamento inteiro da pagina, nunca uma troca
 * de rota do Next: o navegador aplica a Permissions-Policy do documento que carregou ("Gravar agora" dos
 * avisos, docs/22 §4.5). Desde 30/10/2026 a politica e a mesma em todo o app (next.config.ts, docs/30 I10) e
 * o carregamento inteiro ficou sem efeito sobre o microfone; continua como estava.
 */
export function isAdminPath(value: string) {
  let url: URL;

  try {
    url = new URL(value, INTERNAL_ORIGIN);
  } catch {
    return false;
  }

  return url.origin === INTERNAL_ORIGIN && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"));
}
