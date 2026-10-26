// Copiar e colar o design Livre (docs/27 L1.1): o texto que vai para a area de transferencia (a forma canonica em
// JSON) e a leitura do que a equipe cola (o mesmo zod e a mesma forma canonica do salvar). Modulo puro, imports
// relativos (os testes carregam pelo Node); so o editor Livre usa (o cartao do aluno nunca importa este arquivo).
//
// Celular (PR L3): `devices` passa pelo mesmo zod; ids que nao existem no design colado saem na forma canonica, e o
// erro de um valor do celular diz o elemento ("“Título”, no celular: ...").
//
// Arquivos: o design colado so fica com os arquivos que este pop-up ja conhece (mesmo tipo e mesmo caminho); os
// outros (de outro pop-up ou inventados por uma IA) saem, e a Imagem ou o Vídeo que os usava fica vazio para a
// equipe enviar de novo. Assim nenhum caminho de outro aviso entra no salvar: a conferencia do salvar so ve se o
// arquivo existe e vale (um caminho de outro aviso passaria nela), e o design colado nao pode passar a segurar o
// arquivo de outro aviso. (O salvar nunca apaga o recusado, docs/28 D16; o modelo aplicado manda os arquivos dele
// pelo knownAssets.)

import type { NoticeDraft } from "./schemas";
import { canonicalPopupFreeDesign, walkFreeNodes, type FreeAsset, type PopupFreeDesign } from "./popup-free-model";
import { popupFreeDesignSchema } from "./popup-free-schema";
import { FREE_STARTER_CTA, syncFreeDesignWithContent } from "./popup-free-starters";

/** Frases do colar (o editor mostra no dialogo). */
export const POPUP_FREE_PASTE_MESSAGES = {
  cta: "O botão principal ganhou o texto “Saiba mais”. Escolha para onde ele leva.",
  empty: "Cole o design no campo.",
  fonts: (count: number) => (count === 1 ? "1 fonte não está na biblioteca e virou Inter." : `${count} fontes não estão na biblioteca e viraram Inter.`),
  files: (count: number) =>
    count === 1
      ? "1 arquivo não é deste pop-up e ficou de fora: envie de novo onde o elemento ficou vazio."
      : `${count} arquivos não são deste pop-up e ficaram de fora: envie de novo onde os elementos ficaram vazios.`,
  invalid: "O design colado tem algo que não vale:",
  mobile: (label: string, message: string) => `“${label}”, no celular: ${message}`,
  more: (count: number) => `E mais ${count}.`,
  notFree: "Isso não é um design Livre. Copie pelo botão “Copiar o design” ou peça à IA o JSON com \"mode\": \"free\".",
  notJson: "Não deu para ler o texto colado. Copie o design inteiro, do primeiro { ao último }.",
  tooLong: "O texto colado é grande demais para um design."
} as const;

/** Teto do texto colado (bem acima do maior design que cabe no banco; o zod confere o tamanho de verdade). */
export const FREE_PASTE_MAX_CHARS = 200_000;
/** Quantos problemas o dialogo lista (o resto vira "E mais N."). */
const MAX_LISTED = 5;

/** O texto de "Copiar o design": a forma canonica em JSON, com 2 espacos (a mesma que o servidor grava). */
export function freeDesignClipboardText(design: PopupFreeDesign): string {
  return `${JSON.stringify(canonicalPopupFreeDesign(design), null, 2)}\n`;
}

export type FreePasteContext = {
  /** O conteudo do aviso agora: o Botão principal e o Áudio acompanham (como nos modelos). */
  content: { audio: unknown; cta: NoticeDraft["cta"] };
  /** Ids das fontes da biblioteca: fonte enviada fora dela vira Inter. */
  fontIds: readonly string[];
  /** Os arquivos que este pop-up ja conhece (o design aberto e o de quando o editor abriu). */
  knownAssets: readonly FreeAsset[];
};

export type FreePasteResult =
  | { cta: NoticeDraft["cta"]; design: PopupFreeDesign; notes: string[]; ok: true }
  | { errors: string[]; ok: false };

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Do primeiro "{" ao ultimo "}": a resposta da IA costuma vir com ```json em volta ou uma frase antes. */
function jsonPart(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  return start === -1 || end < start ? text : text.slice(start, end + 1);
}

function eachNode(value: unknown, visit: (node: Json) => void) {
  if (!Array.isArray(value)) {
    return;
  }

  for (const node of value) {
    if (isObject(node)) {
      visit(node);
      eachNode(node.children, visit);
    }
  }
}

/** Tira as pinturas de imagem cujo arquivo nao ficou; sem pintura nenhuma, sai o fundo. */
function keepFill(owner: Json | undefined, kept: ReadonlySet<string>) {
  if (!owner || !Array.isArray(owner.fill)) {
    return;
  }

  const fill = owner.fill.filter((paint) => !(isObject(paint) && paint.kind === "image" && !(typeof paint.asset === "string" && kept.has(paint.asset))));

  if (fill.length === 0) {
    delete owner.fill;
  } else {
    owner.fill = fill;
  }
}

/**
 * Arquivos: so ficam os que o pop-up conhece (o mesmo tipo e o mesmo caminho), com as medidas daqui (as do
 * servidor); a Imagem e o Vídeo que usavam um arquivo que saiu (ou um id que nao existe) ficam vazios, a pintura
 * de imagem sai e a capa do video que saiu tambem. Devolve quantos arquivos sairam.
 */
function keepKnownAssets(raw: Json, known: readonly FreeAsset[]): number {
  const kept = new Set<string>();
  const assets: Json[] = [];
  let dropped = 0;

  for (const item of Array.isArray(raw.assets) ? raw.assets : []) {
    if (!isObject(item) || typeof item.id !== "string") {
      dropped += 1;
      continue;
    }

    const match = known.find((asset) => asset.kind === item.kind && asset.path === item.path);

    if (!match) {
      dropped += 1;
      continue;
    }

    kept.add(item.id);
    assets.push(
      match.kind === "image"
        ? { height: match.height, id: item.id, kind: "image", path: match.path, width: match.width }
        : { id: item.id, kind: "video", mimeType: match.mimeType, path: match.path, ...(typeof item.poster === "string" ? { poster: item.poster } : {}) }
    );
  }

  const images = new Set(assets.filter((asset) => asset.kind === "image").map((asset) => asset.id as string));

  for (const asset of assets) {
    if (asset.kind === "video" && typeof asset.poster === "string" && !images.has(asset.poster)) {
      delete asset.poster;
    }
  }

  raw.assets = assets;
  keepFill(isObject(raw.artboard) ? raw.artboard : undefined, kept);
  eachNode(raw.children, (node) => {
    keepFill(isObject(node.box) ? node.box : undefined, kept);

    if ((node.type === "image" || node.type === "video") && node.asset !== null && !(typeof node.asset === "string" && kept.has(node.asset))) {
      node.asset = null;
    }
  });

  return dropped;
}

/** Fonte enviada que nao esta na biblioteca vira Inter (no elemento e nas partes). Devolve quantas fontes trocou. */
function keepLibraryFonts(raw: Json, fontIds: readonly string[]): number {
  const library = new Set(fontIds.map((id) => id.toLowerCase()));
  const missing = new Set<string>();
  const fix = (style: unknown) => {
    if (!isObject(style) || !isObject(style.font) || style.font.kind !== "uploaded") {
      return;
    }

    const id = typeof style.font.id === "string" ? style.font.id.toLowerCase() : "";

    if (!library.has(id)) {
      missing.add(id);
      style.font = { key: "inter", kind: "builtin" };
    }
  };

  eachNode(raw.children, (node) => {
    fix(node.textStyle);

    for (const line of Array.isArray(node.lines) ? node.lines : []) {
      for (const span of Array.isArray(line) ? line : []) {
        if (isObject(span)) {
          fix(span.style);
        }
      }
    }
  });
  delete raw.fonts;

  return missing.size;
}

/** O nome na lista de Camadas (ou o id) de um elemento do design colado. */
function labelOf(node: Json): string | null {
  const name = typeof node.name === "string" && node.name.trim() ? node.name.trim() : null;

  return name ?? (typeof node.id === "string" ? node.id : null);
}

/** O elemento de um valor do celular ("devices.mobile.nodes.<id>...") no design colado, ou null. */
function mobileLabelAt(raw: Json, path: readonly PropertyKey[]): string | null {
  if (path[0] !== "devices" || path[1] !== "mobile" || path[2] !== "nodes" || typeof path[3] !== "string") {
    return null;
  }

  let found: Json | null = null;

  eachNode(raw.children, (node) => {
    found ??= node.id === path[3] ? node : null;
  });

  return found ? labelOf(found) : null;
}

/** O nome do elemento de um caminho do zod ("children.3.children.0.lines...") no design colado, ou null. */
function nodeLabelAt(raw: Json, path: readonly PropertyKey[]): string | null {
  let list: unknown = raw.children;
  let found: Json | null = null;
  let index = 0;

  while (path[index] === "children" && Array.isArray(list) && typeof path[index + 1] === "number") {
    const next: unknown = list[path[index + 1] as number];

    if (!isObject(next)) {
      break;
    }

    found = next;
    list = next.children;
    index += 2;
  }

  return found ? labelOf(found) : null;
}

/**
 * Le o que a equipe colou (da area de transferencia ou do campo): JSON do design Livre, validado pelo mesmo zod e
 * levado a forma canonica; arquivos que o pop-up nao conhece ficam de fora (o elemento fica vazio), fontes fora da
 * biblioteca viram Inter e o design fica coerente com o botao e o audio do aviso (como nos modelos: sem botao no
 * aviso, o Botão principal colado cria o "Saiba mais" com o destino vazio). Erros em frases curtas, com o nome do
 * elemento.
 */
export function parseFreeDesignPaste(text: string, context: FreePasteContext): FreePasteResult {
  const M = POPUP_FREE_PASTE_MESSAGES;
  const trimmed = text.trim();

  if (!trimmed) {
    return { errors: [M.empty], ok: false };
  }

  if (trimmed.length > FREE_PASTE_MAX_CHARS) {
    return { errors: [M.tooLong], ok: false };
  }

  let raw: unknown;

  try {
    raw = JSON.parse(jsonPart(trimmed));
  } catch {
    return { errors: [M.notJson], ok: false };
  }

  if (!isObject(raw) || raw.mode !== "free") {
    return { errors: [M.notFree], ok: false };
  }

  const dropped = keepKnownAssets(raw, context.knownAssets);
  const swappedFonts = keepLibraryFonts(raw, context.fontIds);
  const parsed = popupFreeDesignSchema.safeParse(raw);

  if (!parsed.success) {
    const lines: string[] = [];

    for (const issue of parsed.error.issues) {
      const label = nodeLabelAt(raw, issue.path);
      const mobile = label ? null : mobileLabelAt(raw, issue.path);
      const line = label ? `“${label}”: ${issue.message}` : mobile ? M.mobile(mobile, issue.message) : issue.message;

      if (!lines.includes(line)) {
        lines.push(line);
      }
    }

    const listed = lines.slice(0, MAX_LISTED);

    return { errors: [M.invalid, ...listed, ...(lines.length > MAX_LISTED ? [M.more(lines.length - MAX_LISTED)] : [])], ok: false };
  }

  const notes: string[] = [];
  let cta = context.content.cta;
  let pastedCta = false;

  walkFreeNodes(parsed.data.children, (node) => {
    pastedCta ||= node.type === "button" && node.action.kind === "cta";
  });

  // Sem botao no aviso, o Botão principal colado cria o "Saiba mais" (como nos modelos); com botao, ele entra se faltava.
  if (!cta && pastedCta) {
    cta = { ...FREE_STARTER_CTA };
    notes.push(M.cta);
  }

  if (dropped > 0) {
    notes.push(M.files(dropped));
  }

  if (swappedFonts > 0) {
    notes.push(M.fonts(swappedFonts));
  }

  const design = canonicalPopupFreeDesign(syncFreeDesignWithContent(parsed.data, { hasAudio: Boolean(context.content.audio), hasCta: Boolean(cta) }));

  return { cta, design, notes, ok: true };
}
