/**
 * Valor de `background-image` para um endereco de imagem vindo do banco (capa de produto, capa de
 * modulo). Sempre entre aspas, com aspas, barra invertida e quebras de linha escapadas: um endereco com
 * `)` ou `;` nao fecha o url() nem injeta CSS na pagina do aluno, e um endereco legitimo com
 * parenteses ou espacos continua funcionando. Sem endereco = sem imagem (nunca `url(undefined)`).
 */
export function cssImageUrl(url: string | null | undefined) {
  const value = url?.trim();

  if (!value) {
    return "none";
  }

  return `url("${value.replace(/["\\\n\r\f]/g, (character) => encodeURIComponent(character))}")`;
}
