// Modelo puro da "Na tela" (docs/30 §2.4 e §4.2; docs/31 §12; especificacao de 10/11/2026): o banner e o QR Code que a
// equipe poe na frente da turma numa sessao, a enquete fixada e o estado que a sala recebe. Sem "server-only", imports
// relativos: o servidor, a sala, o console e os testes (tests/webinarios-na-tela-modelo.test.mjs) usam o mesmo arquivo.
//
// O que fica aqui:
// - as listas e os limites (os mesmos dos checks da 202611100002; a guarda tests/webinarios-v7.guard.test.mjs confere);
// - as regras do item (o QR Code com link de ate 240 caracteres; o banner com imagem ou titulo, botao so com link,
//   imagem sem titulo com a descricao; "No meio" sem poder fechar nunca e Grande), usadas pelo zod ao salvar;
// - o tamanho do QR Code: a versao pela tabela de capacidade do modo byte no nivel M ate a versao 11 (o link de 240
//   caracteres cabe na 11), os modulos com a margem de 4, o lado em px (128 / 176 / 232, nunca menos de 3 px por
//   modulo e nunca mais que a altura livre menos 56 px) e o aviso de codigo denso;
// - o endereco da imagem montado pela origem conferida do nosso Supabase (so o caminho fica no banco);
// - o resumo e os nomes que o console e o relatorio mostram, os tipos da pilula do palco do console e o estado do botao
//   de cada item pronto (screenItemShowState: Mostrar, Mostrar no lugar do atual, Na tela ou Mostrar de novo, pela copia
//   mostrada comparada com o item, sem relogio), que o Mostrar do servidor usa tambem;
// - os tipos do item, da exibicao e do estado que a sala recebe (StudentScreenItem, StudentScreenState) e a conversao
//   da exibicao (com a copia congelada ja conferida pelo zod em screen-rows.ts) no item do aluno;
// - os nomes dos registros das metricas (student_events).

import { NA_TELA_COPY } from "../../lib/webinar-copy-v4/na-tela";
import { linkDomain, safeHttpsUrl } from "../../lib/webinar-links";
import type { StudentChatMessage, WebinarSession } from "./model";
import type { StudentScreenComment } from "./screen-comment-model";

/* ------------------------------------------------------------------------------------------------
 * Listas e limites (os checks da 202611100002)
 * ---------------------------------------------------------------------------------------------- */

/** Os itens prontos de um webinario (webinar_screen_items.kind). */
export const SCREEN_KINDS = ["banner", "qr"] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

/** O que pode estar na tela numa sessao (webinar_screen_displays.kind): um banner, um QR Code e uma enquete fixada. */
export const SCREEN_DISPLAY_KINDS = ["banner", "qr", "poll"] as const;
export type ScreenDisplayKind = (typeof SCREEN_DISPLAY_KINDS)[number];

/** As nove posicoes do palco largo, na ordem da grade 3x3 (linha a linha). */
export const SCREEN_PLACES = ["top_left", "top_center", "top_right", "middle_left", "center", "middle_right", "bottom_left", "bottom_center", "bottom_right"] as const;
export type ScreenPlace = (typeof SCREEN_PLACES)[number];

export const SCREEN_SIZES = ["s", "m", "l"] as const;
export type ScreenSize = (typeof SCREEN_SIZES)[number];

/**
 * O que abre o link do banner (rodada v9, P3; docs/30 D87; webinar_screen_items.link_target, 202611150001): a imagem e
 * o botao (o padrao), so o botao ou so a imagem. "A imagem" e o banner em si (a imagem, o titulo e o texto). Sem texto
 * do botao, o banner inteiro abre o link, qualquer que seja a escolha; no QR Code nao vale nada.
 */
export const SCREEN_LINK_TARGETS = ["both", "button", "image"] as const;
export type ScreenLinkTarget = (typeof SCREEN_LINK_TARGETS)[number];
export const SCREEN_DEFAULT_LINK_TARGET: ScreenLinkTarget = "both";
/** A exibicao de antes da 202611150001 (a copia sem `linkTarget`) e o banco sem a coluna: so o botao, como era. */
export const SCREEN_LEGACY_LINK_TARGET: ScreenLinkTarget = "button";

/** A migracao da rodada v9 (o que abre o link, quem assina a resposta e o comentario na tela), para o aviso do console. */
export const SCREEN_V9_MIGRATION = "202611150001";

/** Por que uma exibicao saiu: a equipe tirou, outro do mesmo tipo entrou, a enquete fixada foi encerrada sem resultado. */
export const SCREEN_HIDDEN_REASONS = ["team", "replaced", "poll_closed"] as const;
export type ScreenHiddenReason = (typeof SCREEN_HIDDEN_REASONS)[number];

/** Onde cada tipo nasce no formulario: o banner embaixo a direita, o QR Code em cima a direita. */
export const SCREEN_DEFAULT_PLACE: Readonly<Record<ScreenKind, ScreenPlace>> = { banner: "bottom_right", qr: "top_right" };
export const SCREEN_DEFAULT_SIZE: ScreenSize = "m";

/**
 * A migracao da Na tela, para o aviso do console no navegador (db.ts e "server-only"): a mesma de
 * db.WEBINARS_SCREEN_MIGRATION (tests/webinarios-na-tela-console-tela.test.mjs confere).
 */
export const SCREEN_MIGRATION = "202611100002";

export const SCREEN_LIMITS = {
  /** O nome que so a equipe ve. */
  name: 60,
  /** O titulo do banner; a legenda do QR Code. */
  title: 80,
  body: 200,
  buttonLabel: 30,
  imageAlt: 120,
  /** O link do banner. */
  link: 500,
  /** O link do QR Code (cabe na versao 11 no nivel M). */
  qrLink: 240,
  imageSideMin: 16,
  imageSideMax: 1280,
  /** 1.000 alunos buscam a imagem nos mesmos ~5 s depois do Mostrar (ate 200 MB nesse intervalo). */
  imageBytes: 200_000,
  /** Itens prontos nao arquivados por webinario. */
  itemsPerWebinar: 20,
  /** O tamanho maximo da copia congelada (pg_column_size do snapshot). */
  snapshotBytes: 4096,
  /** As metricas do navegador: eventos por lote e lotes por minuto por aluno e sessao. */
  eventsPerBatch: 6,
  eventBatchesPerMinute: 12
} as const;

/* ------------------------------------------------------------------------------------------------
 * A imagem do banner: so o caminho no nosso bucket
 * ---------------------------------------------------------------------------------------------- */

export const SCREEN_IMAGE_BUCKET = "content-assets";
/** A pasta do envio (persistImageAsset; fora da limpeza de arquivos da Comunicacao, como webinars/covers). */
export const SCREEN_IMAGE_FOLDER = "webinars/screen";
/** O nome pelo conteudo que persistImageAsset grava: 24 hex do sha256 + .webp. */
export const SCREEN_IMAGE_PATH_PATTERN = /^webinars\/screen\/[a-f0-9]{24}\.webp$/;

const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])$/;
/** Nome de maquina so com letras, numeros, ponto e hifen (ou [::1]): o URL do WHATWG deixa passar aspas e ";". */
const SAFE_HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$|^\[::1\]$/;

/**
 * A origem conferida do nosso Supabase: https (http so na propria maquina, o Supabase local dos testes), maquina so com
 * [a-z0-9.-], sem usuario, senha, caminho, query nem fragmento; senao null. A mesma construcao de
 * communications/popup-free-render.freeStorageOrigin (o teste confere as duas), repetida aqui para a sala nunca
 * importar nada do pop-up da Comunicacao.
 */
export function screenStorageOriginOf(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > 2_048) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  const secure = url.protocol === "https:";
  const loopback = url.protocol === "http:" && LOOPBACK_HOST.test(url.hostname);

  if ((!secure && !loopback) || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    return null;
  }

  return SAFE_HOSTNAME.test(url.hostname) ? url.origin : null;
}

/**
 * O endereco publico da imagem: a origem conferida do nosso Supabase + o caminho publico do bucket, so quando o caminho
 * e um dos nossos. Senao null (nada e desenhado).
 */
export function screenImageUrl(path: string | null | undefined, origin: string | null | undefined): string | null {
  if (typeof path !== "string" || !SCREEN_IMAGE_PATH_PATTERN.test(path)) {
    return null;
  }

  const safeOrigin = screenStorageOriginOf(origin);

  return safeOrigin ? `${safeOrigin}/storage/v1/object/public/${SCREEN_IMAGE_BUCKET}/${path}` : null;
}

/* ------------------------------------------------------------------------------------------------
 * As regras do item
 * ---------------------------------------------------------------------------------------------- */

/** A regra do meio: "No meio" sem o aluno poder fechar cobre parte do video ate a equipe tirar, entao nunca e Grande. */
export function screenCenterBlocked(input: { closable: boolean; place: ScreenPlace; size: ScreenSize }): boolean {
  return input.place === "center" && !input.closable && input.size === "l";
}

/** Os tamanhos que o formulario oferece para a posicao e o "pode fechar" escolhidos. */
export function screenSizesFor(place: ScreenPlace, closable: boolean): readonly ScreenSize[] {
  return SCREEN_SIZES.filter((size) => !screenCenterBlocked({ closable, place, size }));
}

/**
 * O que abre o link, do jeito que e gravado: fora do banner com link vale o padrao; "Só a imagem" tira o texto do botao
 * (um botao que nao abre nada confunde). Pura: o zod do salvar e a Previa do formulario usam a mesma conta.
 */
export function screenLinkTargetOf(input: { buttonLabel: string | null; kind: ScreenKind; linkTarget?: ScreenLinkTarget | null; linkUrl: string | null }): { buttonLabel: string | null; linkTarget: ScreenLinkTarget } {
  if (input.kind !== "banner" || !input.linkUrl) {
    return { buttonLabel: input.buttonLabel, linkTarget: SCREEN_DEFAULT_LINK_TARGET };
  }
  const linkTarget = input.linkTarget ?? SCREEN_DEFAULT_LINK_TARGET;
  return { buttonLabel: linkTarget === "image" ? null : input.buttonLabel, linkTarget };
}

/** O que o formulario manda (os textos ja sem espacos nas pontas; vazio = null). */
export type ScreenItemFields = {
  body: string | null;
  buttonLabel: string | null;
  closable: boolean;
  imageAlt: string | null;
  imagePath: string | null;
  kind: ScreenKind;
  linkUrl: string | null;
  place: ScreenPlace;
  size: ScreenSize;
  title: string | null;
};

export type ScreenItemProblemField = "body" | "buttonLabel" | "imageAlt" | "imagePath" | "linkUrl" | "size" | "title";
export type ScreenItemProblem = { field: ScreenItemProblemField; message: string };

/**
 * As regras entre os campos (os limites de cada campo sao do zod): o QR Code com link https de ate 240 caracteres e sem
 * texto, botao nem imagem; o banner com imagem ou titulo, link so https, botao so com link, imagem sem titulo com a
 * descricao; "No meio" sem fechar nunca Grande. Os checks webinar_screen_items_*_v7 repetem as mesmas regras.
 */
export function screenItemProblems(fields: ScreenItemFields): ScreenItemProblem[] {
  const problems: ScreenItemProblem[] = [];
  const copy = NA_TELA_COPY.erros;

  if (fields.kind === "qr") {
    if (!fields.linkUrl || !safeHttpsUrl(fields.linkUrl, SCREEN_LIMITS.qrLink)) {
      problems.push({ field: "linkUrl", message: fields.linkUrl && safeHttpsUrl(fields.linkUrl) ? copy.qrLink : copy.link });
    }
    if (fields.body !== null) {
      problems.push({ field: "body", message: copy.invalido });
    }
    if (fields.buttonLabel !== null) {
      problems.push({ field: "buttonLabel", message: copy.invalido });
    }
    if (fields.imagePath !== null) {
      problems.push({ field: "imagePath", message: copy.invalido });
    }
  } else {
    if (fields.linkUrl !== null && !safeHttpsUrl(fields.linkUrl, SCREEN_LIMITS.link)) {
      problems.push({ field: "linkUrl", message: copy.link });
    }
    if (fields.imagePath === null && fields.title === null) {
      problems.push({ field: "title", message: copy.imagemOuTitulo });
    }
    if (fields.buttonLabel !== null && fields.linkUrl === null) {
      problems.push({ field: "linkUrl", message: copy.botaoSemLink });
    }
    if (fields.imagePath !== null && !SCREEN_IMAGE_PATH_PATTERN.test(fields.imagePath)) {
      problems.push({ field: "imagePath", message: copy.imagemSumiu });
    }
    if (fields.imagePath !== null && fields.title === null && fields.imageAlt === null) {
      problems.push({ field: "imageAlt", message: copy.descricao });
    }
  }

  if (screenCenterBlocked(fields)) {
    problems.push({ field: "size", message: copy.meioGrande });
  }

  return problems;
}

/**
 * O nome do item quando a equipe nao deu um: o titulo (no QR Code, a legenda) ou o dominio do link, cortado no limite do
 * nome. Sem nenhum dos dois: o nome do tipo ("Banner", "QR Code").
 */
export function screenItemDefaultName(fields: Pick<ScreenItemFields, "kind" | "linkUrl" | "title">): string {
  const base = fields.title?.trim() || linkDomain(fields.linkUrl) || NA_TELA_COPY.tipos[fields.kind];
  return Array.from(base).slice(0, SCREEN_LIMITS.name).join("");
}

/** "Embaixo, à direita · Médio · o aluno pode fechar" (a linha de cada item pronto no console). */
export function screenItemSummary(item: { closable: boolean; place: ScreenPlace; size: ScreenSize }): string {
  return NA_TELA_COPY.resumo(NA_TELA_COPY.lugares[item.place], NA_TELA_COPY.tamanhos[item.size], item.closable ? NA_TELA_COPY.fechar.sim : NA_TELA_COPY.fechar.nao);
}

/** "Banner · {nome}", "QR Code · {nome}" ou "Enquete fixada · {pergunta}" (Na tela agora e o relatorio). */
export function screenDisplayLabel(kind: ScreenDisplayKind, name: string): string {
  return NA_TELA_COPY.exibicao[kind](name);
}

/**
 * Os tipos de cartao que estao na tela agora, o banner antes do QR Code: a pilula neutra "Na tela: Banner · QR Code" do
 * palco do console da Live ao vivo (la os cartoes nao sao desenhados). Vazio sem banner nem QR Code.
 */
export function screenStageKinds(active: readonly { hiddenAt: string | null; kind: ScreenDisplayKind }[]): ScreenKind[] {
  return SCREEN_KINDS.filter((kind) => active.some((display) => display.kind === kind && display.hiddenAt === null));
}

/* ------------------------------------------------------------------------------------------------
 * O QR Code (desenhado no navegador pela qrcode.react, nivel M, margem de 4 modulos)
 * ---------------------------------------------------------------------------------------------- */

/** Quantos bytes cabem no modo byte, nivel M, das versoes 1 a 11 (a tabela da norma; a 11 leva os 240 caracteres). */
export const QR_BYTE_CAPACITY_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251] as const;
/** A margem branca em volta, em modulos, de cada lado. */
export const QR_MARGIN_MODULES = 4;
/** O lado do desenho em px por tamanho (Pequeno, Medio, Grande). */
export const QR_SIDE_PX: Readonly<Record<ScreenSize, number>> = { s: 128, m: 176, l: 232 };
/** Abaixo disso por modulo o celular custa a ler. */
export const QR_MIN_MODULE_PX = 3;
/** O que o QR Code deixa livre da altura do palco (a legenda e o Abrir o link embaixo). */
export const QR_FREE_HEIGHT_RESERVE_PX = 56;

/** A menor versao (1 a 11) em que o link cabe, pelos bytes em UTF-8; null quando nao cabe ou nao ha link. */
export function qrVersion(link: string | null | undefined): number | null {
  if (!link) {
    return null;
  }

  const bytes = new TextEncoder().encode(link).length;
  const index = QR_BYTE_CAPACITY_M.findIndex((capacity) => bytes <= capacity);

  return index === -1 ? null : index + 1;
}

/** Os modulos de cada lado do desenho, com a margem (21 + 4 por versao acima da 1, mais 4 de cada lado); null sem versao. */
export function qrModules(link: string | null | undefined): number | null {
  const version = qrVersion(link);
  return version === null ? null : 17 + 4 * version + 2 * QR_MARGIN_MODULES;
}

/**
 * O lado do QR Code em px: o do tamanho escolhido, subindo ate 3 px por modulo quando o codigo e denso, e nunca maior
 * que a altura livre do palco menos 56 px (quando ela e conhecida).
 */
export function qrSidePx(size: ScreenSize, modules: number | null, freeHeightPx?: number | null): number {
  const base = QR_SIDE_PX[size];
  const wanted = modules ? Math.max(base, modules * QR_MIN_MODULE_PX) : base;

  if (typeof freeHeightPx === "number" && Number.isFinite(freeHeightPx)) {
    return Math.max(0, Math.min(wanted, Math.floor(freeHeightPx - QR_FREE_HEIGHT_RESERVE_PX)));
  }

  return wanted;
}

/** O codigo fica denso para o tamanho escolhido (menos de 3 px por modulo no lado do tamanho): o formulario avisa. */
export function qrIsDense(size: ScreenSize, modules: number | null): boolean {
  return modules !== null && QR_SIDE_PX[size] / modules < QR_MIN_MODULE_PX;
}

/* ------------------------------------------------------------------------------------------------
 * Tipos: o item pronto, a exibicao, o estado da sala
 * ---------------------------------------------------------------------------------------------- */

export type ScreenImage = { alt: string | null; height: number; path: string; width: number };

/** Um banner ou QR Code pronto (webinar_screen_items). No QR Code, `title` e a legenda. */
export type ScreenItem = {
  archivedAt: string | null;
  body: string | null;
  buttonLabel: string | null;
  closable: boolean;
  createdAt: string;
  id: string;
  image: ScreenImage | null;
  kind: ScreenKind;
  /** O que abre o link do banner (D87); no QR Code, sempre "both". */
  linkTarget: ScreenLinkTarget;
  linkUrl: string | null;
  name: string;
  place: ScreenPlace;
  size: ScreenSize;
  title: string | null;
  updatedAt: string;
  webinarId: string;
};

/** A copia congelada do banner ou do QR Code no momento do Mostrar (versao 1). */
export type ScreenSnapshot = {
  body: string | null;
  buttonLabel: string | null;
  closable: boolean;
  image: ScreenImage | null;
  /** O que abre o link (D87). Ausente na copia gravada antes da 202611150001: so o botao, como a turma viu. */
  linkTarget?: ScreenLinkTarget;
  linkUrl: string | null;
  name: string;
  place: ScreenPlace;
  size: ScreenSize;
  title: string | null;
  v: 1;
};

/** A copia da enquete fixada: so a pergunta (o resto a sala le de GET .../polls). */
export type PollPinSnapshot = { name: string; v: 1 };

/**
 * Se a enquete pode ficar fixada (R2): uma copia lancada numa sessao (nunca o modelo), aberta ou encerrada com o
 * resultado compartilhado, que e exatamente o que a turma ve na lista de enquetes (room-rules.studentPollOf). Encerrada
 * sem compartilhar, ela some para a turma, entao nao fixa (e o Encerrar sem compartilhar desafixa).
 */
export function pollPinnable(poll: { resultsSharedAt: string | null; sessionId: string | null; status: string }): boolean {
  return poll.sessionId !== null && (poll.status === "open" || (poll.status === "closed" && poll.resultsSharedAt !== null));
}

/** Uma exibicao numa sessao (webinar_screen_displays). `snapshot` nulo: a copia nao passou no zod (nada e desenhado). */
export type ScreenDisplay = {
  createdAt: string;
  hiddenAt: string | null;
  hiddenBy: string | null;
  hiddenOffsetMs: number | null;
  hiddenReason: ScreenHiddenReason | null;
  id: string;
  itemId: string | null;
  kind: ScreenDisplayKind;
  pollId: string | null;
  sessionId: string;
  shownAt: string;
  shownBy: string | null;
  shownOffsetMs: number | null;
  snapshot: PollPinSnapshot | ScreenSnapshot | null;
};

/** A copia que o Mostrar congela a partir do item (o que a turma ve, mesmo que o item mude depois). */
export function snapshotOfItem(item: ScreenItem): ScreenSnapshot {
  return {
    body: item.body,
    buttonLabel: item.buttonLabel,
    closable: item.closable,
    image: item.image ? { ...item.image } : null,
    // O item lido de antes da 202611150001 (sem a escolha) congela sem a chave: a copia vale "so o botao", como era.
    ...(item.linkTarget ? { linkTarget: item.linkTarget } : {}),
    linkUrl: item.linkUrl,
    name: item.name,
    place: item.place,
    size: item.size,
    title: item.title,
    v: 1
  };
}

/**
 * Se a copia mostrada e a mesma que o item daria agora, no que a turma ve (o nome, que so a equipe ve, fica de fora):
 * igual, o item esta na tela como esta; diferente, ele foi editado depois de mostrado.
 */
export function screenSnapshotMatches(snapshot: ScreenSnapshot | null, item: ScreenItem): boolean {
  if (!snapshot) {
    return false;
  }

  const now = snapshotOfItem(item);
  const sameImage =
    snapshot.image === null || now.image === null
      ? snapshot.image === now.image
      : snapshot.image.path === now.image.path && snapshot.image.alt === now.image.alt && snapshot.image.width === now.image.width && snapshot.image.height === now.image.height;

  return (
    sameImage &&
    snapshot.body === now.body &&
    snapshot.buttonLabel === now.buttonLabel &&
    snapshot.closable === now.closable &&
    (snapshot.linkTarget ?? SCREEN_LEGACY_LINK_TARGET) === (now.linkTarget ?? SCREEN_LEGACY_LINK_TARGET) &&
    snapshot.linkUrl === now.linkUrl &&
    snapshot.place === now.place &&
    snapshot.size === now.size &&
    snapshot.title === now.title
  );
}

/**
 * O botao principal de um item pronto no console (Prontos) e o que o Mostrar faz no servidor: "show" (nada desse tipo na
 * tela: Mostrar), "replace" (outro do mesmo tipo esta: Mostrar no lugar do atual), "on" (e ele, como esta: o selo Na
 * tela e Tirar da tela; o Mostrar nao grava nada) ou "again" (e ele, mas foi editado depois de mostrado: Mostrar de novo,
 * uma exibicao nova).
 */
export type ScreenItemShowState = "again" | "on" | "replace" | "show";

export function screenItemShowState(item: ScreenItem, active: readonly Pick<ScreenDisplay, "hiddenAt" | "itemId" | "kind" | "snapshot">[]): ScreenItemShowState {
  const current = active.find((display) => display.kind === item.kind && display.hiddenAt === null);

  if (!current) {
    return "show";
  }

  if (current.itemId !== item.id) {
    return "replace";
  }

  return current.snapshot && "place" in current.snapshot && screenSnapshotMatches(current.snapshot, item) ? "on" : "again";
}

/** O banner ou o QR Code como a sala recebe: o id da exibicao, os textos, o link e a imagem com o endereco ja montado. */
export type StudentScreenItem = {
  body: string | null;
  buttonLabel: string | null;
  closable: boolean;
  /** O id da exibicao (nao do item): o "fechei" e as metricas sao por exibicao. */
  displayId: string;
  image: { alt: string; height: number; url: string; width: number } | null;
  kind: ScreenKind;
  /** O que abre o link do banner (D87). Ausente no servidor de antes: so o botao. */
  linkTarget?: ScreenLinkTarget;
  linkUrl: string | null;
  place: ScreenPlace;
  shownAt: string;
  size: ScreenSize;
  /** O titulo do banner; a legenda do QR Code. */
  title: string | null;
};

/**
 * O que a turma ve na frente da sessao, pego na consulta de 5 s do chat. `stamp` e o updated_at da linha da sessao (o
 * sinal de mudanca); `pollsKey` resume (id, situacao, resultado compartilhado) das enquetes da sessao, para a sala
 * reler GET .../polls so quando ele muda. `simulationKey` (docs/30 D79, 11/11/2026) resume a decisao da Simulacao (a
 * hora gravada em simulation_decided_at, que toda mudanca dos participantes simulados e todo Salvar do card regravam),
 * para a sala pedir a janela da Simulacao de novo so quando ela muda: o numero novo chega em segundos, nao na janela
 * seguinte (ate 90 s) nem na espera de 5 min sem nada ligado. Opaco e curto; nunca as regras nem a semente.
 */
export type StudentScreenState = {
  /**
   * O comentario ou a pergunta que a equipe trouxe para a tela (rodada v9, docs/30 D89); ausente sem nada na tela (o
   * servidor de antes nunca manda a chave).
   */
  comment?: StudentScreenComment | null;
  items: StudentScreenItem[];
  pinned: StudentChatMessage | null;
  pinnedPollId: string | null;
  pollsKey: string;
  /** Ausente no servidor de antes (a sala trata como sem mudanca). */
  simulationKey?: string;
  stamp: string;
};

/**
 * O resumo da decisao da Simulacao (D79): um FNV-1a de 32 bits em hexadecimal da hora da decisao; vazio sem decisao.
 * Muda a cada mudanca dos participantes simulados e a cada Salvar do card; nada mais o mexe.
 */
export function simulationKeyOf(decidedAt: string | null | undefined): string {
  if (!decidedAt) {
    return "";
  }
  let hash = 0x811c9dc5;
  for (let index = 0; index < decidedAt.length; index += 1) {
    hash ^= decidedAt.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Se a sessao mostra alguma coisa na frente da turma: a Live ao vivo e a gravada, na espera e no ar. No Replay (sem
 * equipe; um banner repetido depois poderia anunciar um prazo vencido) e na sessao encerrada ou cancelada, nada.
 */
export function screenShowsIn(session: Pick<WebinarSession, "kind" | "status">): boolean {
  return session.kind !== "replay" && session.status !== "ended" && session.status !== "cancelled";
}

/**
 * O resumo das enquetes da sessao (id, situacao e resultado compartilhado, na ordem do id): muda quando uma enquete e
 * lancada, encerrada ou tem o resultado compartilhado, e so entao a sala rele GET .../polls. Curto (a quantidade e um
 * FNV-1a de 32 bits em hexadecimal), porque vai em todo estado; vazio sem enquete.
 */
export function pollsKeyOf(polls: readonly { id: string; resultsShared: boolean; status: string }[]): string {
  if (polls.length === 0) {
    return "";
  }

  const text = [...polls]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((poll) => `${poll.id}:${poll.status}:${poll.resultsShared ? 1 : 0}`)
    .join("|");
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${polls.length}-${hash.toString(16).padStart(8, "0")}`;
}

/** O estado vazio (Replay, sessao encerrada ou cancelada, banco sem a migracao): nada na tela. */
export function emptyScreenState(stamp: string): StudentScreenState {
  return { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp };
}

/**
 * A exibicao como a sala recebe: so banner e QR Code ativos com a copia valida; o link so quando passa em safeHttpsUrl
 * (de novo, na leitura); a imagem so com o endereco da nossa origem (sem ela, o banner sem titulo nao tem o que mostrar
 * e sai). O alt e a descricao da equipe; sem ela, o titulo.
 */
export function studentScreenItem(display: ScreenDisplay, origin: string | null | undefined): StudentScreenItem | null {
  if (display.kind === "poll" || display.hiddenAt !== null || !display.snapshot || !("place" in display.snapshot)) {
    return null;
  }

  const snapshot = display.snapshot;
  const limit = display.kind === "qr" ? SCREEN_LIMITS.qrLink : SCREEN_LIMITS.link;
  const linkUrl = snapshot.linkUrl ? safeHttpsUrl(snapshot.linkUrl, limit) : null;
  const url = snapshot.image ? screenImageUrl(snapshot.image.path, origin) : null;
  const alt = snapshot.image?.alt ?? snapshot.title;
  const image = snapshot.image && url && alt ? { alt, height: snapshot.image.height, url, width: snapshot.image.width } : null;

  if (display.kind === "qr" && !linkUrl) {
    return null;
  }

  if (display.kind === "banner" && !image && !snapshot.title) {
    return null;
  }

  return {
    body: display.kind === "qr" ? null : snapshot.body,
    // "Só a imagem" nao desenha o botao (o texto dele so existe com o botao clicavel).
    buttonLabel: display.kind === "qr" || !linkUrl || snapshot.linkTarget === "image" ? null : snapshot.buttonLabel,
    closable: snapshot.closable,
    displayId: display.id,
    image: display.kind === "qr" ? null : image,
    kind: display.kind,
    linkTarget: display.kind === "qr" ? SCREEN_DEFAULT_LINK_TARGET : (snapshot.linkTarget ?? SCREEN_LEGACY_LINK_TARGET),
    linkUrl,
    place: snapshot.place,
    shownAt: display.shownAt,
    size: snapshot.size,
    title: snapshot.title
  };
}

/* ------------------------------------------------------------------------------------------------
 * Metricas (student_events, entity_type 'webinar', entity_id = a sessao)
 * ---------------------------------------------------------------------------------------------- */

export const SCREEN_EVENT_NAMES = ["shown", "clicked", "closed"] as const;
export type ScreenEventName = (typeof SCREEN_EVENT_NAMES)[number];

/** O event_type gravado (o mesmo que webinar_screen_report le). */
export const SCREEN_EVENT_TYPES: Readonly<Record<ScreenEventName, string>> = {
  clicked: "webinar_screen_clicked",
  closed: "webinar_screen_closed",
  shown: "webinar_screen_shown"
};

/** Onde o aluno viu: o cartao no palco largo, a linha da faixa, a linha da doca da sala vertical. */
export const SCREEN_EVENT_FORMS = ["stage", "strip", "vertical"] as const;
export type ScreenEventForm = (typeof SCREEN_EVENT_FORMS)[number];

/** O que foi clicado: o botao do banner, o banner inteiro (sem texto do botao), o Abrir o link do QR Code. */
export const SCREEN_EVENT_TARGETS = ["button", "card", "qr_link"] as const;
export type ScreenEventTarget = (typeof SCREEN_EVENT_TARGETS)[number];
