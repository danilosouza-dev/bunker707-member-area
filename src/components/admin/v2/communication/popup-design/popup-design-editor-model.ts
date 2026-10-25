// Editor do "Design do pop-up" (docs/26; contrato em scratchpad v3/design/spec.md §7): as pecas puras do card
// "Design" do editor do pop-up. Padrão | Personalizado | Livre (docs/27) com memoria entre os tres, modelos para
// comecar (os do Personalizado e os do Livre), blocos (acrescentar,
// tirar, subir, descer), o botao principal ligado ao `cta` do aviso, o bloco Áudio ligado ao audio, os pesos de
// cada fonte, o resumo de cada bloco, a conferencia do video antes de enviar e o foco de cada erro do design.
// Tudo aqui e texto do produtor em portugues, sem palavra fora do vocabulario (testado).
//
// Modulo puro, com imports relativos (tests/popup-design-editor-modelo.test.mjs carrega direto pelo Node). Os
// tipos do design e os modelos moram em popup-design-model.ts (P0); aqui so a logica da tela.

import { isoToSaoPauloLocal } from "../../../../../server/communications/campaign-model";
import type { NoticeDraft } from "../../../../../server/communications/schemas";
import { freeNodeCount, type PopupFreeDesign } from "../../../../../server/communications/popup-free-model";
import { resolveFreeArtboard } from "../../../../../server/communications/popup-free-render";
import {
  FREE_DESIGN_STARTERS,
  applyFreeStarter,
  freeFromCustomDesign,
  syncFreeDesignWithContent,
  type FreeMeasuredImage,
  type FreeStarterId
} from "../../../../../server/communications/popup-free-starters";
import {
  POPUP_BUILTIN_FONTS,
  POPUP_CARD_IMAGE_DEFAULTS,
  POPUP_DESIGN_LIMITS,
  POPUP_DESIGN_STARTERS,
  POPUP_FONT_LIMITS,
  POPUP_FONT_WEIGHTS,
  POPUP_VIDEO_LIMITS,
  POPUP_VIDEO_MIME_TYPES,
  canonicalPopupDesign,
  newPopupBlock,
  nextPopupBlockId,
  paintBaseColor,
  popupStarterDesign,
  syncPopupDesignBlocks,
  uploadedFontIdsOf,
  type PopupAlign,
  type PopupBlock,
  type PopupBlockType,
  type PopupButton2ActionKind,
  type PopupButtonSize,
  type HexColor,
  type PopupButtonWidth,
  type PopupCardBackground,
  type PopupCardImage,
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
  type PopupPaint,
  type PopupTextAlign,
  type PopupTextPlacement,
  type PopupVideoMimeType,
  alphaPercentOf,
  withAlphaPercent
} from "../../../../../server/communications/popup-design-model";

type Option<Value extends string> = { label: string; value: Value };

/* ------------------------------------------------------------------------------------------------
 * Textos da tela (spec §7.2, palavra por palavra)
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_DESIGN_COPY = {
  card: {
    description: "Escolha o visual do pop-up. O Padrão é o de sempre; no Personalizado você monta por seções; no Livre você monta do zero, elemento por elemento.",
    title: "Design"
  },
  modes: {
    custom: { description: "Monte o seu: vídeo ou imagem com degradê, textos com fontes e cores, botões do seu jeito.", label: "Personalizado" },
    default: { description: "Imagem em cima, título, texto e botão, com as cores da área de membros.", label: "Padrão" },
    free: {
      description: "Monte do zero, como num editor de páginas: coloque cada elemento onde quiser, um por cima do outro, com o estilo que quiser.",
      label: "Livre"
    },
    groupLabel: "Design do pop-up"
  },
  /** Livre (docs/27; spec §4.1): os modelos para comecar, o resumo do design montado e o botao do editor. */
  free: {
    audioDescription: "Um áudio curto. No design, o player fica onde estiver o elemento Áudio.",
    change: "Trocar de modelo",
    confirm: {
      cancel: "Cancelar",
      confirm: "Trocar",
      description: "O design Livre atual será trocado pelo modelo. Dá para desfazer no editor.",
      title: "Trocar de modelo?"
    },
    open: "Abrir editor Livre",
    /** "Usar o design Personalizado" (L1.1): o Personalizado de agora (ou o guardado) vira o ponto de partida. */
    fromCustom: {
      description: "Começa com o vídeo, a imagem, as fontes e os textos dele. Fica parecido; o resto você ajusta no editor.",
      label: "Seu design Personalizado",
      use: "Usar o design Personalizado"
    },
    preparing: "Preparando o modelo…",
    smallScreen: "O editor Livre precisa de uma tela maior (a partir de 1.024 px de largura). Aqui você vê a prévia.",
    starters: {
      close: "Cancelar",
      hint: "Escolha um ponto de partida. No editor, tudo pode ser mudado.",
      title: "Começar de um modelo",
      use: "Usar este modelo"
    },
    thumbLabel: "Miniatura do design Livre"
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
    fadeAutoHint: "A mídia some e aparece o fundo do cartão (cor, degradê ou imagem).",
    fadeColor: "Cor do degradê",
    fadeEnd: "Fica totalmente escuro em",
    fadeHint: "0 % é o topo da mídia e 100 %, o fim dela. Suba o escuro para o texto ficar na parte escura.",
    fadeStart: "Começa a escurecer em",
    groupLabel: "Mídia do pop-up",
    image: "Imagem",
    imageAlt: "Descrição da imagem (opcional)",
    imageAltHint: "Ajuda quem usa leitor de tela. Ex.: Professora apresentando a aula nova.",
    imageHint: "Também é a capa do vídeo.",
    position: "Parte da mídia que aparece",
    positionHint: "Muda só o enquadramento do vídeo ou da imagem, não o degradê."
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
    backgroundImage: "Imagem do fundo",
    backgroundImageBusy: "Espere a imagem do fundo terminar de enviar.",
    backgroundImageColor: "Cor de apoio",
    backgroundImageColorHint: "Preenche o resto do cartão e aparece enquanto a imagem carrega.",
    backgroundImageDim: "Escurecer a imagem",
    backgroundImageDimHint: "Uma camada escura por cima da imagem deixa o texto mais fácil de ler.",
    backgroundImageFailed: "Não foi possível enviar a imagem. Tente de novo.",
    backgroundImageHint: "Fica atrás da mídia e do texto, na largura do cartão. A borda some na cor de apoio.",
    backgroundImageMissing: "Envie a imagem do fundo ou escolha Cor ou Degradê.",
    backgroundImageNotOurs: "Envie o arquivo da imagem (link de outro site não vale aqui).",
    backgroundImagePosition: "Onde a imagem fica",
    backgroundImagePositionHint: "Embaixo, com o degradê “Igual ao fundo do cartão”, o vídeo passa para a imagem.",
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
    links: "Cor dos links (Lembrar depois e Não mostrar de novo)",
    showDismiss: "Mostrar o link “Não mostrar de novo”",
    /** So com a chave desligada: o custo de tirar o link, escrito para o produtor decidir. */
    showDismissOff: "Sem o link, o aluno só fecha no X. Num pop-up que repete sem parar, ele não tem como deixar de vê-lo."
  },
  color: {
    angle: "Ângulo",
    from: "De",
    invalid: "Use uma cor no formato #RRGGBB.",
    /** Nome acessivel do numero ao lado da cor ("{rotulo}: opacidade"); sem rotulo visivel, para nao se confundir com a Opacidade do Livre. */
    opacity: "opacidade",
    picker: "seletor de cor",
    placeholder: "#RRGGBB",
    to: "Para"
  },
  content: {
    audioDescription: "Um áudio curto. No design, o player fica onde estiver o bloco Áudio.",
    audioTitle: "Áudio",
    titleHint: "Aparece nas listas e nos relatórios. Para o aluno, vale o título do design.",
    titleLabel: "Nome do pop-up"
  },
  /**
   * "Meus modelos" e "Salvar design como modelo" (docs/28 §5.8): os designs que a equipe guardou, na lista do modo,
   * antes dos modelos prontos. Os textos do card moram so aqui.
   */
  mine: {
    applied: "Design aplicado.",
    capped: "Mostrando os 50 mais recentes.",
    ctaDestination: "O destino do botão é escolhido em cada aviso.",
    error: "Não foi possível carregar seus modelos agora.",
    loading: "Carregando seus modelos…",
    readyTitle: "Modelos prontos",
    retry: "Tentar de novo",
    save: "Salvar design como modelo",
    saveConfirm: "Salvar modelo",
    saveDescription: (mode: "custom" | "free") =>
      `Fica em “Meus modelos” do design ${mode === "free" ? "Livre" : "Personalizado"} e em Comunicação › Modelos. Os textos do design vão junto; o destino do botão fica em cada aviso.`,
    saved: "Design salvo em Meus modelos.",
    title: "Meus modelos",
    updated: (date: string) => `Atualizado em ${date}`,
    use: "Usar este modelo",
    useLabel: (name: string) => `Usar este modelo: ${name}`,
    waitUpload: "Espere o envio terminar."
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * Escolhas (pilulas e listas)
 * ---------------------------------------------------------------------------------------------- */

export type PopupDesignMode = "custom" | "default" | "free";

export const DESIGN_MODE_OPTIONS: readonly (Option<PopupDesignMode> & { description: string })[] = [
  { description: POPUP_DESIGN_COPY.modes.default.description, label: POPUP_DESIGN_COPY.modes.default.label, value: "default" },
  { description: POPUP_DESIGN_COPY.modes.custom.description, label: POPUP_DESIGN_COPY.modes.custom.label, value: "custom" },
  { description: POPUP_DESIGN_COPY.modes.free.description, label: POPUP_DESIGN_COPY.modes.free.label, value: "free" }
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

export type CardBackgroundKind = "gradient" | "image" | "solid";

/** Fundo do cartão: "Cor" | "Degradê" | "Imagem". */
export const CARD_BACKGROUND_KIND_OPTIONS: readonly Option<CardBackgroundKind>[] = [...PAINT_KIND_OPTIONS, { label: "Imagem", value: "image" }];

/** A pintura nova ao trocar "Cor" <-> "Degradê" (a cor de agora vira a primeira do degradê e vice-versa). */
export function paintOfKind(kind: PaintKind, base: HexColor): PopupPaint {
  return kind === "solid" ? { color: base, kind: "solid" } : { angle: 90, from: base, kind: "gradient", to: "#a78bfa" };
}

/**
 * O fundo do cartão ao trocar "Cor" | "Degradê" | "Imagem": a cor de agora segue (vira a cor, a primeira do
 * degradê ou a cor de apoio da imagem). Imagem: a ultima imagem escolhida volta (`remembered`); sem ela, a
 * imagem ainda vazia (o salvar pede para enviar), embaixo e com 40 % de escuro.
 */
export function cardBackgroundOfKind(kind: CardBackgroundKind, current: PopupCardBackground, remembered: PopupCardImage | null): PopupCardBackground {
  if (kind === current.kind) {
    return current;
  }

  const base = paintBaseColor(current);

  if (kind === "image") {
    return remembered
      ? { ...remembered, color: base }
      : { color: base, dim: POPUP_CARD_IMAGE_DEFAULTS.dim, kind: "image", position: POPUP_CARD_IMAGE_DEFAULTS.position, url: "" };
  }

  return paintOfKind(kind, base);
}

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
 * Padrão | Personalizado | Livre e modelos
 * ---------------------------------------------------------------------------------------------- */

type DesignContent = Pick<NoticeDraft, "audio" | "cta"> & { design?: PopupDesign | null; freeDesign?: PopupFreeDesign | null };
type DesignPatch = Partial<Pick<NoticeDraft, "cta" | "design" | "freeDesign">>;

/** O ultimo design de cada modo que saiu (volta sem perguntar ao escolher o modo de novo). */
export type RememberedDesigns = { custom: PopupDesign | null; free: PopupFreeDesign | null };

export const NO_REMEMBERED_DESIGNS: RememberedDesigns = { custom: null, free: null };

/** O botao que o modelo cria quando o pop-up ainda nao tem (o produtor escolhe para onde leva). */
export const STARTER_CTA = { href: "", label: "Saiba mais", target: "same_tab" } as const;

export const DESIGN_STARTER_OPTIONS = POPUP_DESIGN_STARTERS;

/** Os modelos para comecar o Livre (docs/27 §4.1; nomes e descricoes de popup-free-starters.ts). */
export const FREE_STARTER_OPTIONS = FREE_DESIGN_STARTERS;

/** O modo do rascunho: o Livre ganha do Personalizado (o schema recusa os dois juntos). */
export function popupDesignModeOf(content: Pick<DesignContent, "design" | "freeDesign">): PopupDesignMode {
  return content.freeDesign ? "free" : content.design ? "custom" : "default";
}

/**
 * Escolher um modelo: o design do modelo (com o bloco Áudio quando ha audio e o video que ja estava no design) e,
 * sem botao no pop-up, o botao "Saiba mais" com o destino vazio. O Livre sai do rascunho (um design so).
 */
export function applyStarter(content: DesignContent, starter: PopupDesignStarterId, previous: PopupDesign | null | undefined): DesignPatch {
  const design = popupStarterDesign(starter, { hasAudio: Boolean(content.audio), video: previous?.media.video ?? null });
  const patch: DesignPatch = content.cta ? { design } : { cta: { ...STARTER_CTA }, design };

  return content.freeDesign ? { ...patch, freeDesign: null } : patch;
}

/**
 * Escolher um modelo do Livre (spec §4.1): o design do modelo coerente com o conteudo (Áudio se ha audio; o Botão
 * principal sempre, criando o `cta` "Saiba mais" quando o aviso nao tem botao), com o video do Personalizado
 * atual ou guardado como arquivo do Vídeo e a imagem do aviso (do nosso bucket, com as medidas lidas no navegador)
 * como capa. O Personalizado sai do rascunho (fica na memoria da tela).
 */
export function applyFreeStarterPatch(
  content: DesignContent,
  starter: FreeStarterId,
  media: { poster?: { height: number; path: string; width: number } | null; video?: PopupDesign["media"]["video"] | null } = {}
): DesignPatch & { freeDesign: PopupFreeDesign } {
  const video = media.video ? { mimeType: media.video.mimeType, path: media.video.path } : null;
  const result = applyFreeStarter(starter, { audio: content.audio, cta: content.cta, poster: media.poster ?? null, video });

  return content.cta ? { design: null, freeDesign: result.design } : { cta: result.cta, design: null, freeDesign: result.design };
}

/** O Personalizado que vira ponto de partida do Livre (L1.1): o do rascunho ou o guardado na memoria. */
export function freeCustomSourceOf(content: Pick<DesignContent, "design">, remembered: RememberedDesigns): PopupDesign | null {
  return content.design ?? remembered.custom ?? null;
}

/**
 * "Usar o design Personalizado" (docs/27 L1.1; spec §5.3): o Livre parecido com o Personalizado (freeFromCustomDesign),
 * com a imagem do aviso e a do fundo do cartao (do nosso bucket, com as medidas lidas no navegador). Como nos
 * modelos: sem botao no aviso, cria o "Saiba mais"; o Personalizado sai do rascunho (fica na memoria da tela).
 */
export function applyFreeFromCustomPatch(
  content: DesignContent,
  custom: PopupDesign,
  media: { cardImage?: FreeMeasuredImage | null; hasImage?: boolean; image?: FreeMeasuredImage | null } = {}
): DesignPatch & { freeDesign: PopupFreeDesign } {
  const result = freeFromCustomDesign(custom, { audio: content.audio, cardImage: media.cardImage ?? null, cta: content.cta, hasImage: media.hasImage, image: media.image ?? null });

  return content.cta ? { design: null, freeDesign: result.design } : { cta: result.cta, design: null, freeDesign: result.design };
}

/** O video que um modelo do Livre reaproveita: o do Personalizado no rascunho ou o guardado na memoria. */
export function freeStarterVideoOf(content: Pick<DesignContent, "design">, remembered: RememberedDesigns): PopupDesign["media"]["video"] | null {
  return content.design?.media.video ?? remembered.custom?.media.video ?? null;
}

/** "{n} elementos · {largura} px" (o resumo do Livre montado no card Design). */
export function freeDesignSummary(design: PopupFreeDesign): string {
  const count = freeNodeCount(design);

  return `${count} ${count === 1 ? "elemento" : "elementos"} · ${resolveFreeArtboard(design).width} px`;
}

/** "{n} problemas para revisar" (abre o editor no Revisar). */
export function freeProblemsLabel(count: number): string {
  return count === 1 ? "1 problema para revisar" : `${count} problemas para revisar`;
}

/** As chaves de erro que sao do Livre: o design e, no Livre, o Botão principal (o "Para onde leva" fica no editor). */
export function isFreeProblemKey(key: string): boolean {
  return key === "freeDesign" || key.startsWith("freeDesign.") || key === "cta" || key.startsWith("cta.");
}

/**
 * Trocar Padrão, Personalizado e Livre. O design do modo que sai vai para a memoria; voltar devolve o da memoria
 * (coerente com o botao e o audio de agora), sem perguntar; sem memoria, o rascunho fica sem design ate escolher
 * um modelo (a tela mostra os modelos). Sempre um design so no rascunho. `remembered` e o que a tela guarda depois.
 */
export function switchDesignMode(
  content: DesignContent,
  mode: PopupDesignMode,
  remembered: RememberedDesigns
): { patch: DesignPatch | null; remembered: RememberedDesigns } {
  const current = popupDesignModeOf(content);

  if (mode === current) {
    return { patch: null, remembered };
  }

  const kept: RememberedDesigns = {
    custom: current === "custom" ? (content.design ?? null) : remembered.custom,
    free: current === "free" ? (content.freeDesign ?? null) : remembered.free
  };
  const sync = { hasAudio: Boolean(content.audio), hasCta: Boolean(content.cta) };
  const none: DesignPatch | null = current === "default" ? null : { design: null, freeDesign: null };

  if (mode === "custom" && kept.custom) {
    return { patch: { design: syncPopupDesignBlocks(kept.custom, sync), freeDesign: null }, remembered: kept };
  }

  if (mode === "free" && kept.free) {
    return { patch: { design: null, freeDesign: syncFreeDesignWithContent(kept.free, sync) }, remembered: kept };
  }

  return { patch: none, remembered: kept };
}

/**
 * O rascunho depois de uma mudanca: com Personalizado ou Livre, mudar o botao ou o audio deixa o design coerente
 * (o botao principal existe se e so se ha botao; o Áudio se e so se ha audio).
 */
export function withSyncedDesign<Draft extends DesignContent & { kind: NoticeDraft["kind"] }>(current: Draft, patch: Partial<Draft>): Draft {
  const next = { ...current, ...patch };

  if (next.kind !== "popup" || !(next.design || next.freeDesign) || !("audio" in patch || "cta" in patch)) {
    return next;
  }

  const sync = { hasAudio: Boolean(next.audio), hasCta: Boolean(next.cta) };

  return next.freeDesign ? { ...next, freeDesign: syncFreeDesignWithContent(next.freeDesign, sync) } : { ...next, design: syncPopupDesignBlocks(next.design as PopupDesign, sync) };
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

  // Do mais fino ao mais largo (o primeiro prefixo que casa vence).
  const sections: readonly [string, string][] = [
    ["design.blocks", "#popup-design-blocos"],
    ["design.media.video", "#popup-design-video"],
    ["design.media.position", "[name='popup-design-midia-recorte']"],
    ["design.media.fade.end", "#popup-design-degrade-fim"],
    ["design.media.fade.height", "#popup-design-degrade-inicio"],
    ["design.media.fade.color", "#popup-design-degrade-cor"],
    ["design.media.fade", "#popup-design-degrade"],
    ["design.media", "[name='popup-design-midia']"],
    ["design.card.background.url", "[aria-labelledby='popup-design-cartao-imagem-label']"],
    ["design.card.background.position", "[name='popup-design-cartao-imagem-parte']"],
    ["design.card.background.dim", "#popup-design-cartao-imagem-escurecer"],
    ["design.card.background.color", "#popup-design-cartao-fundo-cor"],
    ["design.card.background.from", "#popup-design-cartao-fundo-de"],
    ["design.card.background.to", "#popup-design-cartao-fundo-para"],
    ["design.card.background.angle", "#popup-design-cartao-fundo-angulo"],
    ["design.card.background", "[name='popup-design-cartao-fundo-tipo']"],
    ["design.text", "[name='popup-design-posicao']"],
    ["design.card", "#popup-design-cartao"],
    ["design.close", "#popup-design-fechar"],
    ["design.links.showDismiss", "#popup-design-links-nao-mostrar"],
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

export const OPACITY_BOUNDS = { integer: true, max: 100, min: 0 } as const;

/**
 * Ao sair do numero da opacidade do campo de cor (docs/26 §2.2): fora de 0 a 100 encosta no limite; vazio ou sem
 * numero volta ao que a cor vale. `changed` so quando a cor fica diferente (no Livre, cada mudanca e um passo do
 * historico: sair do campo sem mexer nao pode criar um passo vazio).
 */
export function opacityAfterBlur(text: string, current: HexColor): { changed: boolean; hex: HexColor; text: string } {
  const trimmed = text.trim();
  const parsed = Number(trimmed);

  if (trimmed === "" || !Number.isFinite(parsed)) {
    return { changed: false, hex: current, text: String(alphaPercentOf(current)) };
  }

  const percent = clampNumber(Math.round(parsed), OPACITY_BOUNDS.min, OPACITY_BOUNDS.max);
  const hex = withAlphaPercent(current, percent);

  return { changed: hex !== current, hex, text: String(percent) };
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
 * Degradê da mídia: "Começa a escurecer em" e "Fica totalmente escuro em"
 * ---------------------------------------------------------------------------------------------- */

/** "Começa a escurecer em" (% da altura da mídia, do topo). */
export const FADE_START_LIMITS = { max: 90, min: 0 } as const;
/** "Fica totalmente escuro em" (= `fade.end`). */
export const FADE_END_LIMITS = { max: POPUP_DESIGN_LIMITS.fadeEnd.max, min: POPUP_DESIGN_LIMITS.fadeEnd.min } as const;
/** A passagem mais curta (= o minimo de `fade.height`). */
const FADE_MIN_PASSAGE = POPUP_DESIGN_LIMITS.fadeHeight.min;

export type FadeRange = { end: number; start: number };
type FadeSpan = { end: number; height: number };

/** O que a tela mostra a partir do design: o escuro comeca em `end - height` e fica total em `end`. */
export function fadeRangeOf(fade: FadeSpan): FadeRange {
  const end = clampNumber(Math.round(fade.end), FADE_END_LIMITS.min, FADE_END_LIMITS.max);
  const start = clampNumber(end - Math.round(fade.height), FADE_START_LIMITS.min, Math.min(FADE_START_LIMITS.max, end - FADE_MIN_PASSAGE));

  return { end, start };
}

/** O que vai para o design a partir da tela: `{ end, height = end - start }`, com a passagem de pelo menos 10 %. */
export function fadeFromRange(range: FadeRange): FadeSpan {
  const end = clampNumber(Math.round(range.end), FADE_END_LIMITS.min, FADE_END_LIMITS.max);
  const start = clampNumber(Math.round(range.start), FADE_START_LIMITS.min, Math.min(FADE_START_LIMITS.max, end - FADE_MIN_PASSAGE));

  return { end, height: clampNumber(end - start, FADE_MIN_PASSAGE, POPUP_DESIGN_LIMITS.fadeHeight.max) };
}

/** Mudar o comeco: o fim fica, a nao ser que o comeco passe dele (o fim desce junto, 10 % abaixo). */
export function withFadeStart<Fade extends FadeSpan>(fade: Fade, start: number): Fade {
  const nextStart = clampNumber(Math.round(start), FADE_START_LIMITS.min, FADE_START_LIMITS.max);
  const end = Math.max(fadeRangeOf(fade).end, nextStart + FADE_MIN_PASSAGE);

  return { ...fade, ...fadeFromRange({ end, start: nextStart }) };
}

/** Mudar o fim: o comeco fica, a nao ser que o fim suba acima dele (o comeco sobe junto, 10 % acima). */
export function withFadeEnd<Fade extends FadeSpan>(fade: Fade, end: number): Fade {
  const nextEnd = clampNumber(Math.round(end), FADE_END_LIMITS.min, FADE_END_LIMITS.max);
  const start = Math.min(fadeRangeOf(fade).start, nextEnd - FADE_MIN_PASSAGE);

  return { ...fade, ...fadeFromRange({ end: nextEnd, start }) };
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

/* ------------------------------------------------------------------------------------------------
 * "Meus modelos" (docs/28 §5.8): o estado da lista carregada sob demanda e o que a tela mostra
 * ---------------------------------------------------------------------------------------------- */

/** O que "Meus modelos" sabe: nada pedido ainda, carregando, erro ou os itens (com o total do modo). */
export type DesignTemplatesLoad<Item> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { items: readonly Item[]; status: "ready"; total: number };

export type DesignTemplatesEvent<Item> =
  | { kind: "failed" }
  | { items: readonly Item[]; kind: "loaded"; total: number }
  | { kind: "open" }
  | { kind: "reset" }
  | { kind: "retry" };

/**
 * A lista muda assim: abrir a lista pela primeira vez (idle) ou "Tentar de novo" (erro) -> carregando; a leitura
 * volta com os itens ou com erro; "Salvar design como modelo" descarta o que foi carregado (reset -> idle), para
 * recarregar na proxima abertura. Abrir de novo com a lista ja carregada nao pede outra vez.
 */
export function nextDesignTemplatesLoad<Item>(load: DesignTemplatesLoad<Item>, event: DesignTemplatesEvent<Item>): DesignTemplatesLoad<Item> {
  switch (event.kind) {
    case "open":
      return load.status === "idle" ? { status: "loading" } : load;
    case "retry":
      return load.status === "error" ? { status: "loading" } : load;
    case "loaded":
      return { items: event.items, status: "ready", total: event.total };
    case "failed":
      return { status: "error" };
    case "reset":
      return { status: "idle" };
  }
}

/** "23/10/2026" no fuso de Sao Paulo (invalido -> ""). */
function saoPauloDate(iso: string): string {
  const local = isoToSaoPauloLocal(iso);

  if (!local) {
    return "";
  }

  const [year, month, day] = local.date.split("-");

  return `${day}/${month}/${year}`;
}

/** Os textos da lista de "Meus modelos" (o card Design usa POPUP_DESIGN_COPY.mine; a aba Modelos do Livre, os dela). */
export type DesignTemplatesCopy = {
  capped: string;
  error: string;
  loading: string;
  readyTitle?: string;
  retry: string;
  title: string;
  updated: (date: string) => string;
  useLabel: (name: string) => string;
};

export type DesignTemplatesPickerView<Item> = {
  /** Erro da leitura, com o botao que pede de novo. */
  error: { message: string; retry: string } | null;
  /** Carregando: duas linhas de esqueleto e o texto para leitor de tela. */
  loading: { label: string } | null;
  /** O titulo dos modelos prontos (no card Design, sempre que a lista tem "Meus modelos"). */
  readyTitle: string | null;
  /** A secao "Meus modelos" (so com 1 ou mais itens). */
  section: {
    items: { item: Item; name: string; updated: string; useLabel: string }[];
    /** Mais de 50 no modo: "Mostrando os 50 mais recentes.". */
    note: string | null;
    title: string;
  } | null;
};

/** O que a lista do modo mostra de "Meus modelos" em cada estado (spec §5.8 e §5.9). */
export function designTemplatesPickerState<Item extends { name: string; updatedAt: string }>(
  load: DesignTemplatesLoad<Item>,
  options: { copy?: DesignTemplatesCopy; limit?: number } = {}
): DesignTemplatesPickerView<Item> {
  const copy = options.copy ?? POPUP_DESIGN_COPY.mine;
  const limit = options.limit ?? 50;
  const base = { error: null, loading: null, readyTitle: copy.readyTitle ?? null, section: null };

  if (load.status === "loading" || load.status === "idle") {
    return { ...base, loading: { label: copy.loading } };
  }

  if (load.status === "error") {
    return { ...base, error: { message: copy.error, retry: copy.retry } };
  }

  if (load.items.length === 0) {
    return base;
  }

  return {
    ...base,
    section: {
      items: load.items.map((item) => ({ item, name: item.name, updated: copy.updated(saoPauloDate(item.updatedAt)), useLabel: copy.useLabel(item.name) })),
      note: load.total > limit ? copy.capped : null,
      title: copy.title
    }
  };
}
