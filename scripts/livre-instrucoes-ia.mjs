// "Copiar as instruções para a IA" do editor Livre (docs/27 L1.1): gera
// src/components/admin/v2/communication/popup-free/free-ai-instructions.ts a partir do docs/27 §9 ("Contrato do
// JSON"), para o texto ir no pacote do editor (nunca buscado do docs na hora). Rodar depois de mudar o §9:
//
//   npm run livre:instrucoes
//
// tests/popup-livre-copiar-colar.test.mjs confere que o arquivo gerado bate com o docs (os dois nao se separam).
//
// O texto vai para a conversa de um terceiro (o Claude ou o ChatGPT do produtor): o que e so de quem mantem o codigo
// (nomes de arquivo e de funcao, banco, buckets, caminhos) fica no docs entre <!-- ia:fora --> e <!-- /ia:fora -->
// (o Markdown nao mostra os marcadores) e sai aqui; sobrou algum desses termos, o script para (docs/27 L26).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export const LIVRE_DOC_PATH = `${root}docs/27-comunicacao-design-livre.md`;
export const LIVRE_INSTRUCTIONS_PATH = `${root}src/components/admin/v2/communication/popup-free/free-ai-instructions.ts`;

/** As partes do §9 que a IA precisa (sem 9.1, que e onde o banco guarda, e 9.7, as chaves de erro do editor). */
const SECTIONS = ["9.2", "9.3", "9.4", "9.5", "9.6", "9.8", "9.9"];

/** Trecho do docs so para quem mantem o codigo (o marcador pode ficar no meio da linha ou em linhas proprias). */
const INTERNAL = /<!-- ia:fora -->[\s\S]*?<!-- \/ia:fora -->/g;

/**
 * O que nunca vai nas instrucoes: arquivo do codigo, banco, bucket, jsonb, zod, referencia a secao do docs (a IA nao
 * recebe o docs inteiro) e marcador que sobrou.
 */
export const LIVRE_INSTRUCTIONS_FORBIDDEN = [/\.tsx?\b/, /\bbanco\b/i, /bucket/i, /jsonb/i, /\bz\./, /§/, /<!--|-->/, /\bsrc\//, /Storage/];

const PREFACE = `Você vai escrever o design de um pop-up "Livre" da área de membros, em JSON.

Como responder:
- Responda só com o JSON do design (um objeto que começa com { e termina com }), sem texto antes ou depois.
- Siga o contrato abaixo à risca: chave que não está no contrato faz o design ser recusado.
- Se eu mandar um design junto, mude só o que eu pedir e devolva o design inteiro.
- Arquivos: em todo elemento Imagem ou Vídeo novo use sempre "asset": null (a equipe envia o arquivo no editor). Não escreva endereço nem caminho de arquivo e não crie itens em "assets"; se o design que eu mandar já tem "assets", devolva essa lista e os "asset" exatamente como vieram.

# Contrato do JSON do design Livre
`;

/** O texto das instrucoes a partir do docs/27 inteiro. */
export function livreInstructionsText(doc) {
  const start = doc.indexOf("## 9. Contrato do JSON");
  const end = doc.indexOf("\n## 10.", start);

  if (start === -1 || end === -1) {
    throw new Error("docs/27: a secao 9 (Contrato do JSON) nao foi encontrada.");
  }

  const parts = doc
    .slice(start, end)
    .split(/\n(?=### )/)
    .filter((part) => SECTIONS.some((number) => part.startsWith(`### ${number} `)));

  if (parts.length !== SECTIONS.length) {
    throw new Error(`docs/27: esperava as partes ${SECTIONS.join(", ")} da secao 9; vieram ${parts.length}.`);
  }

  const text = `${PREFACE}\n${parts.map((part) => withoutInternal(part).trim()).join("\n\n")}\n`;
  const leak = LIVRE_INSTRUCTIONS_FORBIDDEN.find((pattern) => pattern.test(text));

  if (leak) {
    const at = text.search(leak);

    throw new Error(`docs/27 §9: detalhe de implementacao nas instrucoes para a IA (${leak}): "${text.slice(Math.max(0, at - 60), at + 40)}". Marque com <!-- ia:fora --> ... <!-- /ia:fora --> ou reescreva.`);
  }

  return text;
}

/** A parte sem os trechos marcados, sem espaco sobrando no fim da linha e sem linha em branco dobrada. */
function withoutInternal(part) {
  return part.replace(INTERNAL, "").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n");
}

/** O arquivo TypeScript com o texto (uma constante, sem nada em tempo de execucao). */
export function livreInstructionsSource(doc) {
  return [
    "// Gerado por scripts/livre-instrucoes-ia.mjs a partir do docs/27 §9 (Contrato do JSON). Nao edite a mao:",
    "// mude o docs e rode `npm run livre:instrucoes`. O editor Livre baixa este arquivo so ao copiar as instrucoes.",
    "",
    `export const FREE_AI_INSTRUCTIONS = ${JSON.stringify(livreInstructionsText(doc))};`,
    ""
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(LIVRE_INSTRUCTIONS_PATH, livreInstructionsSource(readFileSync(LIVRE_DOC_PATH, "utf8")));
  console.log(`[livre] instrucoes para a IA gravadas em ${LIVRE_INSTRUCTIONS_PATH}`);
}
