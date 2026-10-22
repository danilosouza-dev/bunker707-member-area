// Editor do "Design do pop-up" (docs/26; contrato em scratchpad v3/design/spec.md §7): as pecas puras do card
// "Design" do editor do pop-up. Padrão | Personalizado com memoria, modelos para comecar, blocos (acrescentar,
// tirar, subir, descer), o botao principal ligado ao `cta` do aviso, o bloco Áudio ligado ao audio, os pesos de
// cada fonte, o resumo de cada bloco, a conferencia do video antes de enviar e o foco de cada erro do design.
// Tudo aqui e texto do produtor em portugues, sem palavra fora do vocabulario (testado).
//
// Modulo puro, com imports relativos (tests/popup-design-editor-modelo.test.mjs carrega direto pelo Node). Os
// tipos do design e os modelos moram em popup-design-model.ts (P0); aqui so a logica da tela.

import type { NoticeDraft } from "../../../../../server/communications/schemas";
import {
  POPUP_BUILTIN_FONTS,
  POPUP_DESIGN_LIMITS,
  POPUP_DESIGN_STARTERS,
  POPUP_FONT_LIMITS,
  POPUP_FONT_WEIGHTS,
  POPUP_VIDEO_LIMITS,
  POPUP_VIDEO_MIME_TYPES,
  canonicalPopupDesign,
  newPopupBlock,
  nextPopupBlockId,
  popupStarterDesign,
  syncPopupDesignBlocks,
  uploadedFontIdsOf,
  type PopupAlign,
  type PopupBlock,
  type PopupBlockType,
  type PopupButton2ActionKind,
  type PopupButtonSize,
  type PopupButtonWidth,
  type PopupCardShadow,
  type PopupCardWidth,
  type PopupDesign,
  type PopupDesignStarterId,
  type PopupFontOption,
  type PopupFontRef,
  type PopupFontStyle,
  type PopupFontWeight,
  type PopupMediaAspect,
  type PopupMediaKind,
  type PopupMediaPosition,
  type PopupTextAlign,
  type PopupTextPlacement,
  type PopupVideoMimeType
} from "../../../../../server/communications/popup-design-model";

type Option<Value extends string> = { label: string; value: Value };

/* ------------------------------------------------------------------------------------------------
 * Textos da tela (spec §7.2, palavra por palavra)
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_DESIGN_COPY = {
  card: {
    description: "Escolha o visual do pop-up. O Padrão é o de sempre; no Personalizado você monta mídia, textos, botões e cores.",
    title: "Design"
  },
  modes: {
    custom: { description: "Monte o seu: vídeo ou imagem com degradê, textos com fontes e cores, botões do seu jeito.", label: "Personalizado" },
    default: { description: "Imagem em cima, título, texto e botão, com as cores da área de membros.", label: "Padrão" },
    groupLabel: "Design do pop-up"
  },
  starters: {
    change: "Trocar de modelo",
    close: "Cancelar",
    confirm: {
      cancel: "Cancelar",
      confirm: "Trocar",
      description: "Os textos e as cores do design atual serão trocados pelos do modelo.",
      title: "Trocar de modelo?"
    },
    hint: "Escolha um modelo para começar. Depois, tudo pode ser mudado.",
    title: "Começar de um modelo",
    use: "Usar este modelo"
  },
  sections: {
    blocks: "Blocos",
    card: "Cartão",
    close: "Fechar e links",
    fonts: "Fontes",
    media: "Mídia",
    text: "Texto e posição"
  },
  media: {
    aspect: "Formato da mídia",
    fade: "Degradê para o fundo",
    fadeAuto: "Igual ao fundo do cartão",
    fadeColor: "Cor do degradê",
    fadeHeight: "Altura do degradê",
    groupLabel: "Mídia do pop-up",
    image: "Imagem",
    imageAlt: "Descrição da imagem (opcional)",
    imageAltHint: "Ajuda quem usa leitor de tela. Ex.: Professora apresentando a aula nova.",
    imageHint: "Também é a capa do vídeo.",
    position: "Recorte"
  },
  video: {
    busy: "Espere o vídeo terminar de enviar.",
    cannotPlay: "Este vídeo não abre no navegador. Use MP4 (H.264) ou WEBM.",
    done: "Vídeo enviado",
    failed: "Não foi possível enviar o vídeo. Tente de novo.",
    format: "Use um vídeo MP4 (H.264) ou WEBM.",
    hint: "MP4 (H.264) ou WEBM, até 15 MB. Toca sem som, em repetição. Quem prefere menos movimento vê só a imagem.",
    label: "Vídeo",
    long: "Vídeos curtos (até 15 segundos) ficam mais leves e combinam com a repetição.",
    remove: "Tirar vídeo",
    replace: "Trocar vídeo",
    send: "Enviar vídeo",
    size: "O vídeo deve ter no máximo 15 MB."
  },
  text: {
    align: "Alinhamento",
    gap: "Espaço entre os blocos",
    overlap: "Subir sobre a mídia",
    overlapHint: "Quanto o texto sobe por cima da mídia.",
    placement: "Onde fica o texto"
  },
  blocks: {
    add: "Adicionar bloco",
    audioFixed: "O bloco Áudio sai junto com o áudio.",
    edit: "Editar",
    limit: `Use até ${POPUP_DESIGN_LIMITS.blocks} blocos.`,
    moveDown: "Descer",
    moveUp: "Subir",
    remove: "Tirar"
  },
  badge: { background: "Fundo do selo", border: "Borda", pill: "Pílula", radius: "Cantos", text: "Texto do selo" },
  heading: {
    addLine: "Adicionar linha",
    linePaint: "Cor da linha",
    lineSize: "Tamanho da linha",
    lineSizeOther: "Outro tamanho",
    removeLine: "Tirar linha"
  },
  textBlock: { text: "Texto" },
  style: {
    align: "Alinhamento",
    color: "Cor",
    font: "Fonte",
    fontBuiltin: "Prontas",
    fontGone: "Fonte que saiu da biblioteca",
    fontUpload: "Enviar fonte…",
    fontUploaded: "Suas fontes",
    letterSpacing: "Espaço entre letras",
    lineHeight: "Altura da linha",
    size: "Tamanho",
    uppercase: "Tudo em maiúsculas",
    weight: "Peso"
  },
  button: {
    background: "Fundo",
    border: "Borda",
    destination: "Para onde leva",
    glow: "Brilho",
    glowColor: "Cor do brilho",
    label: "Texto do botão",
    pill: "Pílula",
    radius: "Cantos",
    size: "Tamanho",
    textColor: "Cor do texto",
    width: "Largura"
  },
  button2: { action: "O que faz", label: "Texto do botão", link: "Link", page: "Página", product: "Produto", target: "Onde abre" },
  spacer: { height: "Altura" },
  audio: { note: "O player do áudio aparece aqui. Para trocar o áudio, use o campo Áudio." },
  cardSection: {
    background: "Fundo",
    border: "Borda",
    borderColor: "Cor da borda",
    borderWidth: "Espessura da borda",
    padding: "Respiro interno",
    radius: "Cantos",
    shadow: "Sombra",
    width: "Largura no computador",
    widthHint: "No celular, o cartão ocupa a tela e tudo encolhe junto."
  },
  fonts: {
    cancel: "Cancelar",
    delete: "Excluir",
    deleteConfirm: {
      cancel: "Cancelar",
      confirm: "Excluir",
      description: "Pop-ups que usam esta fonte não deixam excluir.",
      title: "Excluir a fonte?"
    },
    deleted: "Fonte excluída.",
    empty: "Nenhuma fonte enviada ainda. As prontas (Inter, Exo 2 e as do sistema) já estão na lista.",
    hint: "Quer uma fonte do Google Fonts? Baixe o arquivo no site e envie aqui. Nada é carregado do Google na hora.",
    newName: "Nome novo",
    rename: "Renomear",
    renamed: "Fonte renomeada.",
    save: "Salvar",
    upload: "Enviar fonte",
    uploaded: "Fonte enviada."
  },
  fontDialog: {
    cancel: "Cancelar",
    chooseFile: "Escolher arquivo",
    description: "Use arquivos WOFF2, WOFF, TTF ou OTF de até 2 MB. Confira se a licença da fonte permite usar no site.",
    failed: "Não foi possível enviar a fonte. Tente de novo.",
    file: "Arquivo",
    fileMissing: "Escolha um arquivo de fonte.",
    format: "Use uma fonte WOFF2, WOFF, TTF ou OTF.",
    name: "Nome",
    sending: "Enviando…",
    size: "A fonte deve ter no máximo 2 MB.",
    style: "Estilo",
    submit: "Enviar",
    title: "Enviar fonte",
    weight: "Peso"
  },
  close: {
    background: "Fundo do X",
    color: "Cor do X",
    links: "Cor dos links (Lembrar depois e Não mostrar de novo)"
  },
  color: {
    angle: "Ângulo",
    from: "De",
    invalid: "Use uma cor no formato #RRGGBB.",
    picker: "seletor de cor",
    placeholder: "#RRGGBB",
    to: "Para"
  },
  content: {
    audioDescription: "Um áudio curto. No design, o player fica onde estiver o bloco Áudio.",
    audioTitle: "Áudio",
    titleHint: "Aparece nas listas e nos relatórios. Para o aluno, vale o título do design.",
    titleLabel: "Nome do pop-up"
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * Escolhas (pilulas e listas)
 * ---------------------------------------------------------------------------------------------- */

export type PopupDesignMode = "custom" | "default";

export const DESIGN_MODE_OPTIONS: readonly (Option<PopupDesignMode> & { description: string })[] = [
  { description: POPUP_DESIGN_COPY.modes.default.description, label: POPUP_DESIGN_COPY.modes.default.label, value: "default" },
  { description: POPUP_DESIGN_COPY.modes.custom.description, label: POPUP_DESIGN_COPY.modes.custom.label, value: "custom" }
];

export const MEDIA_KIND_OPTIONS: readonly Option<PopupMediaKind>[] = [
  { label: "Sem mídia", value: "none" },
  { label: "Imagem", value: "image" },
  { label: "Vídeo", value: "video" }
];

export const MEDIA_ASPECT_OPTIONS: readonly Option<PopupMediaAspect>[] = [
  { label: "16:9", value: "16:9" },
  { label: "4:3", value: "4:3" },
  { label: "1:1", value: "1:1" }
];

export const MEDIA_POSITION_OPTIONS: readonly Option<PopupMediaPosition>[] = [
  { label: "Em cima", value: "top" },
  { label: "No meio", value: "center" },
  { label: "Embaixo", value: "bottom" }
];

export const TEXT_PLACEMENT_OPTIONS: readonly Option<PopupTextPlacement>[] = [
  { label: "Abaixo da mídia", value: "below" },
  { label: "Sobre a mídia, em cima", value: "over-top" },
  { label: "Sobre a mídia, no meio", value: "over-middle" },
  { label: "Sobre a mídia, embaixo", value: "over-bottom" }
];

export const ALIGN_OPTIONS: readonly Option<PopupAlign>[] = [
  { label: "Esquerda", value: "left" },
  { label: "Centro", value: "center" },
  { label: "Direita", value: "right" }
];

export const TEXT_ALIGN_OPTIONS: readonly Option<PopupTextAlign>[] = [{ label: "Como o grupo", value: "inherit" }, ...ALIGN_OPTIONS];

export const CARD_WIDTH_OPTIONS: readonly Option<PopupCardWidth>[] = [
  { label: "P (360 px)", value: "S" },
  { label: "M (440 px)", value: "M" },
  { label: "G (520 px)", value: "L" }
];

export const CARD_SHADOW_OPTIONS: readonly Option<PopupCardShadow>[] = [
  { label: "Sem", value: "none" },
  { label: "Suave", value: "soft" },
  { label: "Forte", value: "strong" }
];

export const BUTTON_SIZE_OPTIONS: readonly Option<PopupButtonSize>[] = [
  { label: "P", value: "S" },
  { label: "M", value: "M" },
  { label: "G", value: "L" }
];

export const BUTTON_WIDTH_OPTIONS: readonly Option<PopupButtonWidth>[] = [
  { label: "Ocupa a linha", value: "full" },
  { label: "Do tamanho do texto", value: "fit" }
];

export const BUTTON2_ACTION_OPTIONS: readonly Option<PopupButton2ActionKind>[] = [
  { label: "Fechar", value: "close" },
  { label: "Lembrar depois", value: "snooze" },
  { label: "Abrir um link", value: "link" }
];

export const LINK_TARGET_OPTIONS: readonly Option<"new_tab" | "same_tab">[] = [
  { label: "Na mesma aba", value: "same_tab" },
  { label: "Em nova aba", value: "new_tab" }
];

export const FONT_STYLE_OPTIONS: readonly Option<PopupFontStyle>[] = [
  { label: "Normal", value: "normal" },
  { label: "Itálico", value: "italic" }
];

export type PaintKind = "gradient" | "solid";

export const PAINT_KIND_OPTIONS: readonly Option<PaintKind>[] = [
  { label: "Cor", value: "solid" },
  { label: "Degradê", value: "gradient" }
];

export type LinePaintChoice = "gradient" | "inherit" | "solid";

export const LINE_PAINT_OPTIONS: readonly Option<LinePaintChoice>[] = [
  { label: "Igual ao título", value: "inherit" },
  { label: "Cor", value: "solid" },
  { label: "Degradê", value: "gradient" }
];

export type LineSizeChoice = "inherit" | "other";

export const LINE_SIZE_OPTIONS: readonly Option<LineSizeChoice>[] = [
  { label: "Igual ao título", value: "inherit" },
  { label: POPUP_DESIGN_COPY.heading.lineSizeOther, value: "other" }
];

export const BLOCK_TYPE_LABELS: Record<PopupBlockType, string> = {
  audio: "Áudio",
  badge: "Selo",
  button: "Botão principal",
  button2: "Segundo botão",
  heading: "Título",
  spacer: "Espaço",
  text: "Texto"
};

/** Ordem dos botoes de "Adicionar bloco" (o Áudio entra e sai sozinho com o audio). */
export const ADDABLE_BLOCK_TYPES = ["badge", "heading", "text", "button2", "spacer", "button"] as const satisfies readonly PopupBlockType[];
export type AddableBlockType = (typeof ADDABLE_BLOCK_TYPES)[number];

export const FONT_WEIGHT_LABELS: Record<PopupFontWeight, string> = {
  100: "Fina (100)",
  200: "Extra leve (200)",
  300: "Leve (300)",
  400: "Normal (400)",
  500: "Média (500)",
  600: "Seminegrito (600)",
  700: "Negrito (700)",
  800: "Extra negrito (800)",
  900: "Black (900)"
};

/* ------------------------------------------------------------------------------------------------
 * Fontes: rotulo, pesos de cada uma e a troca de fonte
 * ---------------------------------------------------------------------------------------------- */

/** Nome da fonte no seletor (a pronta pelo rotulo; a enviada pelo nome da biblioteca). */
export function popupFontLabel(font: PopupFontRef, library: readonly Pick<PopupFontOption, "id" | "name">[]): string {
  if (font.kind === "builtin") {
    return POPUP_BUILTIN_FONTS[font.key]?.label ?? POPUP_BUILTIN_FONTS.inter.label;
  }

  return library.find((item) => item.id === font.id)?.name ?? POPUP_DESIGN_COPY.style.fontGone;
}

/** Pesos que a fonte tem de verdade (Exo 2 so 500 a 700; a enviada vale para todos: FontFace "100 900"). */
export function weightsFor(font: PopupFontRef): readonly PopupFontWeight[] {
  return font.kind === "builtin" ? (POPUP_BUILTIN_FONTS[font.key]?.weights ?? POPUP_FONT_WEIGHTS) : POPUP_FONT_WEIGHTS;
}

export function weightOptionsFor(font: PopupFontRef): Option<`${PopupFontWeight}`>[] {
  return weightsFor(font).map((weight) => ({ label: FONT_WEIGHT_LABELS[weight], value: `${weight}` }));
}

function nearestWeight(weights: readonly PopupFontWeight[], weight: number): PopupFontWeight {
  return weights.reduce((best, item) => (Math.abs(item - weight) < Math.abs(best - weight) ? item : best), weights[0]);
}

/**
 * Peso depois de trocar a fonte: a fonte enviada comeca no peso dela (o informado ao enviar); a pronta fica com
 * o peso de antes quando ele existe nela, senao o mais proximo (Exo 2: 500 a 700).
 */
export function weightAfterFontChange(font: PopupFontRef, current: PopupFontWeight, library: readonly Pick<PopupFontOption, "id" | "weight">[]): PopupFontWeight {
  if (font.kind === "uploaded") {
    const weight = library.find((item) => item.id === font.id)?.weight;
    return weight !== undefined && (POPUP_FONT_WEIGHTS as readonly number[]).includes(weight) ? (weight as PopupFontWeight) : current;
  }

  const weights = weightsFor(font);
  return weights.includes(current) ? current : nearestWeight(weights, current);
}

/** Valor do seletor de fonte ("builtin:inter", "uploaded:<id>"). */
export function fontRefValue(font: PopupFontRef): string {
  return font.kind === "builtin" ? `builtin:${font.key}` : `uploaded:${font.id}`;
}

export function fontRefFromValue(value: string): PopupFontRef | null {
  const [kind, key] = [value.slice(0, value.indexOf(":")), value.slice(value.indexOf(":") + 1)];

  if (kind === "builtin" && key in POPUP_BUILTIN_FONTS) {
    return { key: key as keyof typeof POPUP_BUILTIN_FONTS, kind: "builtin" };
  }

  return kind === "uploaded" && key ? { id: key, kind: "uploaded" } : null;
}

/** Biblioteca em ordem de nome, sem repetir (depois de enviar, renomear ou excluir). */
export function sortedFontLibrary(fonts: readonly PopupFontOption[]): PopupFontOption[] {
  const byId = new Map(fonts.map((font) => [font.id, font]));
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** "Normal (400) · Itálico · 52 KB" */
export function describeFontOption(font: Pick<PopupFontOption, "sizeBytes" | "style" | "weight">): string {
  const weight = FONT_WEIGHT_LABELS[font.weight as PopupFontWeight] ?? `${font.weight}`;
  return [weight, font.style === "italic" ? "Itálico" : "Normal", formatKb(font.sizeBytes)].join(" · ");
}

export function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("pt-BR")} KB`;
}

/* ------------------------------------------------------------------------------------------------
 * Padrão | Personalizado e modelos
 * ---------------------------------------------------------------------------------------------- */

type DesignContent = Pick<NoticeDraft, "audio" | "cta"> & { design?: PopupDesign | null };
type DesignPatch = Partial<Pick<NoticeDraft, "cta" | "design">>;

/** O botao que o modelo cria quando o pop-up ainda nao tem (o produtor escolhe para onde leva). */
export const STARTER_CTA = { href: "", label: "Saiba mais", target: "same_tab" } as const;

export const DESIGN_STARTER_OPTIONS = POPUP_DESIGN_STARTERS;

/**
 * Escolher um modelo: o design do modelo (com o bloco Áudio quando ha audio e o video que ja estava no design) e,
 * sem botao no pop-up, o botao "Saiba mais" com o destino vazio.
 */
export function applyStarter(content: DesignContent, starter: PopupDesignStarterId, previous: PopupDesign | null | undefined): DesignPatch {
  const design = popupStarterDesign(starter, { hasAudio: Boolean(content.audio), video: previous?.media.video ?? null });

  return content.cta ? { design } : { cta: { ...STARTER_CTA }, design };
}

/**
 * Trocar Padrão <-> Personalizado. Padrão: design null e o atual vai para a memoria. Personalizado: volta o da
 * memoria (coerente com o botao e o audio de agora), sem perguntar; sem memoria, nada muda ainda (a tela mostra
 * os modelos). `remembered` e o que a tela guarda depois da troca.
 */
export function switchDesignMode(
  content: DesignContent,
  mode: PopupDesignMode,
  remembered: PopupDesign | null
): { patch: DesignPatch | null; remembered: PopupDesign | null } {
  const current = content.design ?? null;

  if (mode === "default") {
    return current ? { patch: { design: null }, remembered: current } : { patch: null, remembered };
  }

  if (current) {
    return { patch: null, remembered };
  }

  if (!remembered) {
    return { patch: null, remembered: null };
  }

  return { patch: { design: syncPopupDesignBlocks(remembered, { hasAudio: Boolean(content.audio), hasCta: Boolean(content.cta) }) }, remembered };
}

/**
 * O rascunho depois de uma mudanca: com Personalizado, mudar o botao ou o audio deixa os blocos coerentes
 * (o bloco do botao principal existe se e so se ha botao; o bloco Áudio se e so se ha audio).
 */
export function withSyncedDesign<Draft extends DesignContent & { kind: NoticeDraft["kind"] }>(current: Draft, patch: Partial<Draft>): Draft {
  const next = { ...current, ...patch };

  if (next.kind !== "popup" || !next.design || !("audio" in patch || "cta" in patch)) {
    return next;
  }

  return { ...next, design: syncPopupDesignBlocks(next.design, { hasAudio: Boolean(next.audio), hasCta: Boolean(next.cta) }) };
}

/* ------------------------------------------------------------------------------------------------
 * Blocos
 * ---------------------------------------------------------------------------------------------- */

function withBlocks(design: PopupDesign, blocks: PopupBlock[]): PopupDesign {
  return { ...design, blocks, fonts: uploadedFontIdsOf(blocks) };
}

const BUTTON_TYPES: readonly PopupBlockType[] = ["button", "button2"];

/** Tipos que "Adicionar bloco" oferece agora (os de uma vez so somem quando ja existem). */
export function addableBlockTypes(design: PopupDesign): AddableBlockType[] {
  return ADDABLE_BLOCK_TYPES.filter((type) => !(type === "button" || type === "button2") || !design.blocks.some((block) => block.type === type));
}

export function canAddBlock(design: PopupDesign) {
  return design.blocks.length < POPUP_DESIGN_LIMITS.blocks;
}

/**
 * Acrescenta um bloco: selo, titulo, texto e espaco entram antes do primeiro botao (o botao continua no fim);
 * os botoes entram no fim. "Botão principal" cria tambem o `cta` ("Saiba mais", destino a escolher).
 * Com 12 blocos ou tipo de uma vez so repetido, nada muda (null).
 */
export function addBlock(content: DesignContent & { design: PopupDesign }, type: AddableBlockType): (DesignPatch & { design: PopupDesign; index: number }) | null {
  const design = content.design;

  if (!canAddBlock(design) || !addableBlockTypes(design).includes(type)) {
    return null;
  }

  const block = newPopupBlock(type, nextPopupBlockId(design.blocks), design);
  const firstButton = design.blocks.findIndex((item) => BUTTON_TYPES.includes(item.type));
  const index = BUTTON_TYPES.includes(type) || firstButton === -1 ? design.blocks.length : firstButton;
  const blocks = [...design.blocks.slice(0, index), block, ...design.blocks.slice(index)];
  const next = withBlocks(design, blocks);

  return type === "button" && !content.cta ? { cta: { ...STARTER_CTA }, design: next, index } : { design: next, index };
}

/** O bloco pode sair? O Áudio sai so com o audio; o design nunca fica sem bloco. */
export function canRemoveBlock(design: PopupDesign, index: number) {
  const block = design.blocks[index];
  return Boolean(block) && block.type !== "audio" && design.blocks.length > 1;
}

/** Tira o bloco; tirar o botao principal tira o botao do aviso (`cta: null`). */
export function removeBlock(design: PopupDesign, index: number): DesignPatch | null {
  if (!canRemoveBlock(design, index)) {
    return null;
  }

  const block = design.blocks[index];
  const next = withBlocks(design, design.blocks.filter((_, position) => position !== index));

  return block.type === "button" ? { cta: null, design: next } : { design: next };
}

/** Sobe (-1) ou desce (+1) um bloco; no limite, o mesmo design. */
export function moveBlock(design: PopupDesign, index: number, delta: -1 | 1): PopupDesign {
  const target = index + delta;

  if (index < 0 || index >= design.blocks.length || target < 0 || target >= design.blocks.length) {
    return design;
  }

  const blocks = [...design.blocks];
  [blocks[index], blocks[target]] = [blocks[target], blocks[index]];

  return withBlocks(design, blocks);
}

/** Troca um bloco (edicao); `fonts` recalculado. */
export function replaceBlock(design: PopupDesign, index: number, block: PopupBlock): PopupDesign {
  return withBlocks(
    design,
    design.blocks.map((item, position) => (position === index ? block : item))
  );
}

/** Nome do bloco na lista e nos rotulos de leitor de tela ("Texto", "Texto 2" quando ha mais de um). */
export function blockName(design: Pick<PopupDesign, "blocks">, index: number): string {
  const block = design.blocks[index];

  if (!block) {
    return "";
  }

  const same = design.blocks.filter((item) => item.type === block.type);
  const label = BLOCK_TYPE_LABELS[block.type];

  return same.length > 1 ? `${label} ${same.indexOf(block) + 1}` : label;
}

function shorten(text: string, max = 60) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Resumo do bloco na lista (o texto, o botao, o que o segundo botao faz). */
export function blockSummary(block: PopupBlock, cta: NoticeDraft["cta"]): string {
  switch (block.type) {
    case "badge":
      return shorten(block.text) || "Sem texto";
    case "heading":
      return shorten(block.lines.map((line) => line.text.trim()).filter(Boolean).join(" / ")) || "Sem texto";
    case "text":
      return shorten(block.text) || "Sem texto";
    case "button":
      return shorten(cta?.label ?? "") || "Sem texto";
    case "button2": {
      const action = BUTTON2_ACTION_OPTIONS.find((option) => option.value === block.action.kind)?.label ?? "";
      return `${shorten(block.label, 30) || "Sem texto"} · ${action}`;
    }
    case "audio":
      return "Player do áudio";
    case "spacer":
      return `${block.height} px`;
  }
}

/**
 * Chaves de erro de um bloco (para abrir a edicao dele quando ha erro): as do design e, no botao principal, as
 * do `cta` (o texto e o destino ficam no bloco).
 */
export function blockErrorKeys(block: PopupBlock, index: number): string[] {
  const base = `design.blocks.${index}`;
  const keys = [base, `${base}.id`, `${base}.style`];

  switch (block.type) {
    case "badge":
      return [...keys, `${base}.text`, `${base}.radius`, `${base}.background`, `${base}.border`];
    case "heading":
      return [...keys, `${base}.lines`, ...block.lines.flatMap((_, line) => [`${base}.lines.${line}`, `${base}.lines.${line}.text`, `${base}.lines.${line}.size`, `${base}.lines.${line}.paint`])];
    case "text":
      return [...keys, `${base}.text`];
    case "button":
      return [...keys, "cta", "cta.label", "cta.href", "cta.target"];
    case "button2":
      return [...keys, `${base}.label`, `${base}.action`, `${base}.action.href`, `${base}.action.target`];
    case "spacer":
      return [...keys, `${base}.height`];
    case "audio":
      return keys;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Foco de cada erro do design (spec §7.2)
 * ---------------------------------------------------------------------------------------------- */

/** Seletor que recebe o foco para um erro do design ("design.blocks.2.lines.0.text"...); null = nao e do design. */
export function popupDesignFocusSelector(key: string): string | null {
  if (key !== "design" && !key.startsWith("design.")) {
    return null;
  }

  const block = /^design\.blocks\.(\d+)(?:\.(.*))?$/.exec(key);

  if (block) {
    const [, index, rest = ""] = block;
    const container = `#popup-design-bloco-${index}`;
    const line = /^lines\.(\d+)(?:\.|$)/.exec(rest);

    if (line) {
      return `${container}-linha-${line[1]}`;
    }

    if (rest === "text") {
      return `${container}-texto`;
    }

    if (rest === "label") {
      return `${container}-rotulo`;
    }

    if (rest === "action" || rest.startsWith("action.")) {
      return `${container}-link, ${container} [name$='-acao']`;
    }

    return container;
  }

  const sections: readonly [string, string][] = [
    ["design.blocks", "#popup-design-blocos"],
    ["design.media.video", "#popup-design-video"],
    ["design.media", "[name='popup-design-midia']"],
    ["design.text", "[name='popup-design-posicao']"],
    ["design.card", "#popup-design-cartao"],
    ["design.close", "#popup-design-fechar"],
    ["design.links", "#popup-design-fechar"],
    ["design.fonts", "#popup-design-fontes"]
  ];

  for (const [prefix, selector] of sections) {
    if (key === prefix || key.startsWith(`${prefix}.`)) {
      return selector;
    }
  }

  return "[name='popup-design']";
}

/* ------------------------------------------------------------------------------------------------
 * Video e fonte: conferencia no navegador antes de enviar (o servidor confere de novo)
 * ---------------------------------------------------------------------------------------------- */

export function videoFileProblem(file: { size: number; type: string }): string | null {
  if (!(POPUP_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    return POPUP_DESIGN_COPY.video.format;
  }

  if (file.size <= 0 || file.size > POPUP_VIDEO_LIMITS.maxBytes) {
    return POPUP_DESIGN_COPY.video.size;
  }

  return null;
}

export function videoMimeTypeOf(file: { type: string }): PopupVideoMimeType | null {
  return (POPUP_VIDEO_MIME_TYPES as readonly string[]).includes(file.type) ? (file.type as PopupVideoMimeType) : null;
}

/** Dica (nao impede) para video longo. */
export function videoDurationHint(seconds: number): string | null {
  return Number.isFinite(seconds) && seconds > 15 ? POPUP_DESIGN_COPY.video.long : null;
}

const FONT_EXTENSIONS = [".woff2", ".woff", ".ttf", ".otf"] as const;

export function fontFileProblem(file: { name: string; size: number } | null): string | null {
  if (!file) {
    return POPUP_DESIGN_COPY.fontDialog.fileMissing;
  }

  const name = file.name.toLowerCase();

  if (!FONT_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return POPUP_DESIGN_COPY.fontDialog.format;
  }

  if (file.size <= 0 || file.size > POPUP_FONT_LIMITS.maxBytes) {
    return POPUP_DESIGN_COPY.fontDialog.size;
  }

  return null;
}

/** Nome sugerido para a fonte: o do arquivo, sem extensao, "_" e "-" viram espaco, ate 60. */
export function fontNameFromFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
  return base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, POPUP_FONT_LIMITS.name);
}

/* ------------------------------------------------------------------------------------------------
 * Numeros com limite
 * ---------------------------------------------------------------------------------------------- */

/** "Use de 0,8 a 2." (a mesma frase do zod). */
export function rangeMessage(min: number, max: number): string {
  return `Use de ${String(min).replace(".", ",")} a ${String(max).replace(".", ",")}.`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** O texto digitado vira numero valido do campo ou null (fora do limite, vazio, inteiro pedido). */
export function parseBoundedNumber(text: string, bounds: { integer?: boolean; max: number; min: number }): number | null {
  const normalized = text.trim().replace(",", ".");

  if (!normalized || !/^-?\d*(?:\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);

  if (!Number.isFinite(value) || value < bounds.min || value > bounds.max || (bounds.integer && !Number.isInteger(value))) {
    return null;
  }

  return value;
}

/* ------------------------------------------------------------------------------------------------
 * Comparacao (o editor so grava mudanca de verdade)
 * ---------------------------------------------------------------------------------------------- */

export function sameDesign(left: PopupDesign | null | undefined, right: PopupDesign | null | undefined) {
  if (!left || !right) {
    return !left && !right;
  }

  return JSON.stringify(canonicalPopupDesign(left)) === JSON.stringify(canonicalPopupDesign(right));
}
