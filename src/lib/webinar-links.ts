// Links da sala e do console dos webinarios (docs/30 §8.3; docs/31 §12; especificacao "Na tela", §8.1): o unico lugar
// que decide se um texto vira link. Vale para o link do banner e do QR Code (ao salvar, com zod, e ao ler a copia
// congelada da exibicao) e para os enderecos dentro de uma mensagem da equipe no chat. Modulo puro (sem imports): o
// servidor, a sala e o console usam o mesmo, e os testes carregam pelo Node.
//
// Regras:
// - so `https://` escrito assim, com `new URL()` aceitando, protocolo exatamente `https:`, sem usuario nem senha, com
//   ponto no nome da maquina e ate 500 caracteres (o QR Code passa o proprio limite, 240). `javascript:`, `data:`,
//   `http:`, endereco relativo e qualquer outra coisa nunca viram `href`;
// - nenhum espaco, controle, aspas, sinais de menor e maior, crase nem barra invertida: o endereco que aparece na tela
//   e o mesmo que o navegador abre (a barra invertida, por exemplo, vira barra para o navegador e mudaria a maquina);
// - devolve o proprio texto (sem espacos nas pontas), nunca a forma normalizada pelo URL: o link mostra exatamente o
//   que abre, e o que a equipe escreveu e o que fica gravado;
// - numa mensagem, so a equipe tem link (a decisao `links` vem do servidor); ate 5 por mensagem; a pontuacao do fim
//   fica de fora; o texto visivel e o proprio endereco (nao da para disfarcar um link com outro texto).

/** Ate quantos caracteres um link pode ter (o banner; o QR Code tem o proprio limite, menor). */
export const WEBINAR_LINK_MAX_LENGTH = 500;
/** Quantos enderecos de uma mensagem viram link; os seguintes ficam como texto. */
export const WEBINAR_LINKS_PER_MESSAGE = 5;

/** Espaco, controle, aspas, < >, crase e barra invertida: nada disso entra num link nosso. */
const UNSAFE_LINK_CHARACTERS = /[\s\u0000-\u001f\u007f-\u009f"<>`\\]/;

/**
 * O link quando ele e um `https://` seguro (as regras do cabecalho), senao null. `maxLength` e o limite do lugar (500 no
 * banner, 240 no QR Code).
 */
export function safeHttpsUrl(value: unknown, maxLength: number = WEBINAR_LINK_MAX_LENGTH): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const text = value.trim();

  if (!text || text.length > Math.min(maxLength, WEBINAR_LINK_MAX_LENGTH) || !text.startsWith("https://") || UNSAFE_LINK_CHARACTERS.test(text)) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    return null;
  }

  const host = url.hostname.replace(/\.$/, "");

  if (!host.includes(".") || host.startsWith(".") || host.includes("..")) {
    return null;
  }

  return text;
}

/** O nome da maquina de um link seguro, sem o "www." (o nome do QR Code para o leitor de tela, o nome padrao do item). */
export function linkDomain(value: unknown): string | null {
  const safe = safeHttpsUrl(value);

  if (!safe) {
    return null;
  }

  return new URL(safe).hostname.replace(/^www\./, "").replace(/\.$/, "");
}

export type LinkSegment = { kind: "text"; text: string } | { href: string; kind: "link"; text: string };

/** Pontuacao que fecha uma frase e nunca faz parte do endereco quando esta no fim dele. */
const TRAILING_PUNCTUATION = /[.,;:!?…'"»”’]$/;
const CLOSERS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

/** Tira do fim do endereco a pontuacao da frase e o fecha-parenteses que nao foi aberto dentro dele. */
function trimTrailing(candidate: string): string {
  let text = candidate;

  for (;;) {
    const last = text.slice(-1);

    if (TRAILING_PUNCTUATION.test(last)) {
      text = text.slice(0, -1);
      continue;
    }

    const opener = CLOSERS[last];

    if (opener && text.split(opener).length - 1 < text.split(last).length - 1) {
      text = text.slice(0, -1);
      continue;
    }

    return text;
  }
}

/** Um `https://` no comeco de um pedaco ou depois de algo que nao e letra, numero nem barra. */
const LINK_START = /(?<![\p{L}\p{N}/])https:\/\/[^\s<>"`\\]+/gu;

/**
 * O texto de uma mensagem em pedacos: o texto como veio e, quando `links` e verdadeiro, ate 5 enderecos `https://`
 * seguros como link, com o proprio endereco como texto visivel e a pontuacao do fim de fora. Juntar os `text` de todos
 * os pedacos devolve a mensagem inteira.
 */
export function linkSegments(text: string, options: { links: boolean }): LinkSegment[] {
  if (!text) {
    return [];
  }

  if (!options.links) {
    return [{ kind: "text", text }];
  }

  const segments: LinkSegment[] = [];
  let cursor = 0;
  let found = 0;

  const pushText = (value: string) => {
    if (!value) {
      return;
    }

    const last = segments.at(-1);

    if (last?.kind === "text") {
      last.text += value;
    } else {
      segments.push({ kind: "text", text: value });
    }
  };

  for (const match of text.matchAll(LINK_START)) {
    if (found >= WEBINAR_LINKS_PER_MESSAGE) {
      break;
    }

    const start = match.index ?? 0;
    const candidate = trimTrailing(match[0]);
    const href = safeHttpsUrl(candidate);

    if (!href || href !== candidate) {
      continue;
    }

    pushText(text.slice(cursor, start));
    segments.push({ href, kind: "link", text: href });
    cursor = start + candidate.length;
    found += 1;
  }

  pushText(text.slice(cursor));

  return segments;
}
