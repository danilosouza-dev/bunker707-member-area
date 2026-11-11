"use client";

import { ArrowLeft, ChevronDown, ImageUp, LoaderCircle, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import { RoomScreenLayer } from "@/components/member/webinars/room/screen/room-screen-layer";
import { screenPlacement } from "@/components/member/webinars/room/screen/room-screen-model";
import { RoomScreenStrip } from "@/components/member/webinars/room/screen/room-screen-strip";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { linkDomain, safeHttpsUrl } from "@/lib/webinar-links";
import { cn } from "@/lib/utils";
import type { FreeImageLimits } from "@/server/communications/popup-free-model";
import { webinarHref } from "@/server/webinars/model";
import type { SavedScreenItem, UploadedScreenImage, saveScreenItem } from "@/server/webinars/screen-actions";
import {
  QR_MARGIN_MODULES,
  SCREEN_DEFAULT_PLACE,
  SCREEN_DEFAULT_SIZE,
  SCREEN_LIMITS,
  SCREEN_PLACES,
  SCREEN_SIZES,
  qrIsDense,
  qrModules,
  screenImageUrl,
  screenSizesFor,
  type ScreenItem,
  type ScreenKind,
  type ScreenPlace,
  type ScreenSize,
  type StudentScreenItem
} from "@/server/webinars/screen-model";
import { screenItemInputSchema } from "@/server/webinars/screen-schemas";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../../form";
import { PreviewFrame } from "../../../member-area/preview-frame";
import { AdminSwitch, SectionCard } from "../../../settings/kit";
import { adminMenuItem, adminMenuPopup } from "../../../styles";
import { returnConsoleFocus } from "./console-focus";
import { useConsolePortal } from "./console-shell";

// Os formularios "Novo banner" e "Novo QR Code" da entrada Na tela do console (docs/30 §2.4; especificacao de
// 10/11/2026, R3, R4 e §6.1), no lugar da lista, com o Voltar. O banner: Nome (so a equipe ve), Imagem (Enviar imagem /
// Trocar / Remover: o navegador reduz a 1.280 px e ate 200.000 bytes em WebP pelo prepareFreeImage do Livre, com os
// limites da Na tela, e envia pelo uploadScreenImage, que devolve so o caminho e as medidas), Descricao da imagem,
// Titulo, Texto, Texto do botao, Link, Onde aparece (a miniatura 16:9 com os nove pontos, um grupo de radios), Tamanho
// (Grande fica de fora no meio sem fechar, screenSizesFor), O aluno pode fechar e os avisos fixos (o celular em pe, o
// prazo de verdade, a Oferta, e o do meio sem fechar). O QR Code: Link (ate 240), Usar um link pronto (a pagina deste
// webinario e os links dos banners salvos), Legenda, Onde aparece, Tamanho, O aluno pode fechar e Nome, com o codigo
// desenhado ao lado pela qrcode.react (nivel M, margem de 4 modulos, preto no branco) e o aviso de codigo denso. Os dois:
// a Previa com Computador e Celular e os botoes Mostrar agora (salva e mostra, so com a sessao aceitando a equipe),
// Salvar para depois e Cancelar. A conferencia do formulario e o mesmo zod do servidor (screenItemInputSchema), mostrada
// depois da primeira tentativa, junto dos erros que o servidor devolve em cada campo.
// A Previa (ScreenPreview) e desenhada pelos componentes do aluno (src/components/member/webinars/room/screen; a fatia S9),
// dentro da moldura de previa da Area de membros (PreviewFrame: a "tela" de largura fixa reduzida para caber na coluna,
// com o conteudo inert, fora do Tab e do clique, entao nenhum link abre e nenhum X fecha): no Computador, a camada do
// palco de verdade (RoomScreenLayer, o proprio recipiente @container/tela) sobre um palco 16:9 de 1280 x 720, com o
// cartao na posicao e no tamanho escolhidos pela mesma screenPlacement da sala; no Celular, a 390 px, o video 16:9 e a
// faixa logo abaixo (RoomScreenStrip, a linha de 56 px). Sem handlers: nada e medido nem enviado (nem viu, nem clicou,
// nem fechou). Nenhuma frase escrita aqui.

const copy = WEBINAR_COPY.naTela;
const form = copy.formulario;
const ERROS = copy.erros;

/** O que o Salvar manda (a entrada de saveScreenItem). */
export type ScreenItemSaveInput = Parameters<typeof saveScreenItem>[0];

/** Os limites da imagem do banner no navegador (o mesmo preparo do Livre, com o lado, o peso e as frases da Na tela). */
export const SCREEN_IMAGE_PREP: FreeImageLimits = {
  bytes: SCREEN_LIMITS.imageBytes,
  messages: { sides: ERROS.imagemLado, tooLarge: ERROS.imagemPesada },
  side: { max: SCREEN_LIMITS.imageSideMax, min: SCREEN_LIMITS.imageSideMin }
};

/* ------------------------------------------------------------------------------------------------
 * O estado do formulario (puro)
 * ---------------------------------------------------------------------------------------------- */

export type ScreenFormState = {
  body: string;
  buttonLabel: string;
  closable: boolean;
  id: string | null;
  image: { height: number; path: string; width: number } | null;
  imageAlt: string;
  kind: ScreenKind;
  linkUrl: string;
  name: string;
  place: ScreenPlace;
  size: ScreenSize;
  title: string;
};

/** O formulario novo (o banner embaixo a direita, o QR Code em cima a direita, Medio, o aluno pode fechar) ou o de um item. */
export function screenFormStart(kind: ScreenKind, item: ScreenItem | null = null): ScreenFormState {
  if (item) {
    return {
      body: item.body ?? "",
      buttonLabel: item.buttonLabel ?? "",
      closable: item.closable,
      id: item.id,
      image: item.image ? { height: item.image.height, path: item.image.path, width: item.image.width } : null,
      imageAlt: item.image?.alt ?? "",
      kind: item.kind,
      linkUrl: item.linkUrl ?? "",
      name: item.name,
      place: item.place,
      size: item.size,
      title: item.title ?? ""
    };
  }

  return { body: "", buttonLabel: "", closable: true, id: null, image: null, imageAlt: "", kind, linkUrl: "", name: "", place: SCREEN_DEFAULT_PLACE[kind], size: SCREEN_DEFAULT_SIZE, title: "" };
}

/** Uma mudanca no formulario: com a posicao e o "pode fechar" novos, o tamanho que deixou de valer (Grande no meio sem fechar) vira Medio. */
export function screenFormWith(state: ScreenFormState, patch: Partial<ScreenFormState>): ScreenFormState {
  const next = { ...state, ...patch };
  return screenSizesFor(next.place, next.closable).includes(next.size) ? next : { ...next, size: "m" };
}

/** O que o Salvar manda: os textos sem espacos nas pontas (vazio = null); o QR Code sem texto, botao nem imagem. */
export function screenFormInput(state: ScreenFormState, webinarId: string): ScreenItemSaveInput {
  const text = (value: string) => value.trim() || null;
  const qr = state.kind === "qr";

  return {
    body: qr ? null : text(state.body),
    buttonLabel: qr ? null : text(state.buttonLabel),
    closable: state.closable,
    id: state.id,
    imageAlt: qr || !state.image ? null : text(state.imageAlt),
    imagePath: qr ? null : (state.image?.path ?? null),
    kind: state.kind,
    linkUrl: text(state.linkUrl),
    name: text(state.name),
    place: state.place,
    size: state.size,
    title: text(state.title),
    webinarId
  };
}

/** Os erros do formulario pelo mesmo zod do servidor, o primeiro de cada campo. */
export function screenFormErrors(state: ScreenFormState, webinarId: string): Record<string, string> {
  const parsed = screenItemInputSchema.safeParse(screenFormInput(state, webinarId));
  const errors: Record<string, string> = {};

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      errors[key] ??= issue.message;
    }
  }

  return errors;
}

/** A pagina do webinario na area de membros, so quando o endereco e https (no computador local, http, fica de fora). */
export function screenPageLink(slug: string, origin: string | null | undefined): string | null {
  if (!origin) {
    return null;
  }

  let base: string;

  try {
    base = new URL(origin).origin;
  } catch {
    return null;
  }

  return safeHttpsUrl(`${base}${webinarHref(slug)}`, SCREEN_LIMITS.qrLink);
}

/** Os links prontos do QR Code: a pagina deste webinario e os links dos banners salvos (sem repetir), na ordem. */
export function screenReadyLinks(items: readonly ScreenItem[], pageUrl: string | null): { label: string; url: string }[] {
  const links: { label: string; url: string }[] = pageUrl ? [{ label: form.linkPaginaDoWebinario, url: pageUrl }] : [];

  for (const item of items) {
    const url = item.kind === "banner" ? safeHttpsUrl(item.linkUrl, SCREEN_LIMITS.qrLink) : null;

    if (url && !links.some((link) => link.url === url)) {
      links.push({ label: item.name, url });
    }
  }

  return links;
}

/** O que a Previa desenha: o item como a sala recebe, sem o id da exibicao (o endereco da imagem pela nossa origem). */
export type ScreenPreviewItem = Omit<StudentScreenItem, "displayId" | "shownAt">;

/** A Previa do formulario: o link so quando passa em safeHttpsUrl; a imagem pelo endereco da nossa origem. */
export function screenFormPreview(state: ScreenFormState, origin: string | null | undefined): ScreenPreviewItem {
  const qr = state.kind === "qr";
  const linkUrl = safeHttpsUrl(state.linkUrl, qr ? SCREEN_LIMITS.qrLink : SCREEN_LIMITS.link);
  const url = !qr && state.image ? screenImageUrl(state.image.path, origin) : null;
  const title = state.title.trim() || null;

  return {
    body: qr ? null : state.body.trim() || null,
    buttonLabel: qr || !linkUrl ? null : state.buttonLabel.trim() || null,
    closable: state.closable,
    image: url && state.image ? { alt: state.imageAlt.trim() || title || "", height: state.image.height, url, width: state.image.width } : null,
    kind: state.kind,
    linkUrl,
    place: state.place,
    size: state.size,
    title
  };
}

/** A Previa de um item pronto (a mesma copia que o Mostrar congela). */
export function screenItemPreview(item: ScreenItem, origin: string | null | undefined): ScreenPreviewItem {
  return screenFormPreview(screenFormStart(item.kind, item), origin);
}

/* ------------------------------------------------------------------------------------------------
 * A Previa (Computador e Celular)
 * ---------------------------------------------------------------------------------------------- */

export type ScreenPreviewDevice = "desktop" | "mobile";

/** O codigo ao lado do Link do formulario do QR Code: o quadro preto no branco, nivel M, margem de 4 modulos, nos dois temas. */
function QrTile({ className, link, side }: { className?: string; link: string; side: number }) {
  const domain = linkDomain(link) ?? link;

  return (
    <QRCodeSVG
      aria-label={copy.aluno.qrNome(domain)}
      bgColor="#ffffff"
      className={cn("block h-auto w-full", className)}
      fgColor="#000000"
      level="M"
      marginSize={QR_MARGIN_MODULES}
      role="img"
      size={side}
      value={link}
    />
  );
}

/** O id da exibicao na Previa: nenhuma exibicao de verdade (sem handlers, nada e medido nem guardado por ele). */
export const SCREEN_PREVIEW_DISPLAY_ID = "previa";

/** O item da Previa como a sala o recebe (o componente do aluno pede o id da exibicao e a hora; a Previa nao tem). */
export function screenPreviewStudentItem(item: ScreenPreviewItem): StudentScreenItem {
  return { ...item, displayId: SCREEN_PREVIEW_DISPLAY_ID, shownAt: "" };
}

/** O palco do Computador na Previa: 1280 x 720 (16:9; os cartoes do palco largo, 640 px ou mais), reduzido para a coluna. */
const PREVIEW_STAGE_HEIGHT = 720;
/** O Celular a 390 px: o video 16:9 (220 px) e a faixa com uma linha de 56 px logo abaixo. */
const PREVIEW_PHONE_HEIGHT = 280;

/**
 * A Previa do banner ou do QR Code, desenhada pelo componente do aluno: no Computador, o cartao sobre o palco 16:9 na
 * posicao e no tamanho escolhidos; no Celular, o video e a linha da faixa logo abaixo (a posicao e o tamanho nao valem
 * no palco estreito). Sem handlers e dentro da moldura inert: nada abre, nada fecha, nada e enviado.
 */
export function ScreenPreview({ device, item }: { device: ScreenPreviewDevice; item: ScreenPreviewItem }) {
  const student = screenPreviewStudentItem(item);

  if (device === "mobile") {
    return (
      <PreviewFrame ariaLabel={`${form.previa}: ${form.previaCelular}`} className="[&_figcaption]:hidden" device="mobile" maxWidth={240} screenHeight={PREVIEW_PHONE_HEIGHT}>
        <div className="flex size-full flex-col bg-room-bg" data-screen-preview="mobile">
          <div aria-hidden="true" className="aspect-video w-full shrink-0 bg-black" />
          <RoomScreenStrip forced={false} items={[student]} pinned={null} />
        </div>
      </PreviewFrame>
    );
  }

  return (
    <PreviewFrame ariaLabel={`${form.previa}: ${form.previaComputador}`} className="[&_figcaption]:hidden" device="desktop" maxWidth={480} screenHeight={PREVIEW_STAGE_HEIGHT}>
      <div className="relative size-full bg-black" data-screen-preview="desktop" data-screen-preview-place={item.place} data-screen-preview-size={item.size}>
        <RoomScreenLayer forced={false} fullscreen={false} items={[student]} pinned={null} placement={screenPlacement({ items: [student], offerShown: false, pinnedPills: false })} />
      </div>
    </PreviewFrame>
  );
}

/* ------------------------------------------------------------------------------------------------
 * O formulario
 * ---------------------------------------------------------------------------------------------- */

/** Os nove pontos de "Onde aparece", na grade 3x3 da miniatura 16:9 (radios nativos: as setas e o leitor de tela funcionam). */
function PlacePicker({ idPrefix, onChange, value }: { idPrefix: string; onChange: (place: ScreenPlace) => void; value: ScreenPlace }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" data-console-screen-place="">
      <legend className="mb-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]">{form.ondeAparece}</legend>
      <div className="grid aspect-video w-full max-w-[240px] grid-cols-3 grid-rows-3 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface-2)] p-1">
        {SCREEN_PLACES.map((place) => {
          const checked = place === value;
          return (
            <label className="grid cursor-pointer place-items-center rounded-[4px] has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-[var(--focus-ring)]" key={place}>
              <input checked={checked} className="sr-only" id={`${idPrefix}-place-${place}`} name={`${idPrefix}-place`} onChange={() => onChange(place)} type="radio" value={place} />
              <span aria-hidden="true" className={cn("block size-3 rounded-full border", checked ? "border-[var(--text-primary)] bg-[var(--text-primary)]" : "border-[var(--text-tertiary)]")} />
              <span className="sr-only">{copy.lugares[place]}</span>
            </label>
          );
        })}
      </div>
      <p className="text-xs leading-5 text-[var(--text-secondary)]" data-console-screen-place-name="">
        {copy.lugares[value]}
      </p>
    </fieldset>
  );
}

type ConsoleScreenFormProps = {
  /** Uma acao da mesa em andamento: os botoes do rodape ficam desligados. */
  busy: boolean;
  /** A sessao aceita a equipe (canTeamActOn): so entao o Mostrar agora. */
  canShow: boolean;
  /** O item em edicao; nulo, um novo. */
  item: ScreenItem | null;
  /** Os itens prontos do webinario (os links dos banners salvos para o QR Code). */
  items: readonly ScreenItem[];
  kind: ScreenKind;
  onBack: () => void;
  /** Salva (e, com `show`, mostra na sessao); devolve o resultado do salvar (nulo: outra acao em andamento). */
  onSave: (input: ScreenItemSaveInput, show: boolean) => Promise<ActionResult<SavedScreenItem> | null>;
  /** Envia o WebP preparado no navegador (uploadScreenImage). */
  onUpload: (image: string) => Promise<ActionResult<UploadedScreenImage>>;
  /** A Previa ao abrir (o teste de tela; o formulario comeca no Computador). */
  initialDevice?: ScreenPreviewDevice;
  webinarId: string;
  webinarSlug: string;
};

export function ConsoleScreenForm({ busy, canShow, initialDevice = "desktop", item, items, kind, onBack, onSave, onUpload, webinarId, webinarSlug }: ConsoleScreenFormProps) {
  const portal = useConsolePortal();
  const prefix = `console-screen-${kind}-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<ScreenFormState>(() => screenFormStart(kind, item));
  const [device, setDevice] = useState<ScreenPreviewDevice>(initialDevice);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const qr = kind === "qr";
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const preview = screenFormPreview(state, origin);
  const localErrors = tried ? screenFormErrors(state, webinarId) : {};
  const errorOf = (field: string) => serverErrors[field] ?? localErrors[field] ?? null;
  const modules = qr ? qrModules(preview.linkUrl) : null;
  const dense = qr && qrIsDense(state.size, modules);
  const centerWarning = !qr && state.place === "center" && !state.closable;
  const sizes = screenSizesFor(state.place, state.closable);
  const title = item ? (qr ? copy.console.editarQr : copy.console.editarBanner) : qr ? copy.console.novoQr : copy.console.novoBanner;
  const titleId = `${prefix}-titulo`;

  // Ao abrir no lugar da lista, o foco vai para o titulo do formulario (o botao que abriu saiu da tela).
  useEffect(() => {
    returnConsoleFocus({ heading: titleId, opener: null });
  }, [titleId]);

  function change(patch: Partial<ScreenFormState>) {
    setState((current) => screenFormWith(current, patch));
    // O erro do servidor de um campo sai quando o campo muda.
    setServerErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[key === "image" ? "imagePath" : key];
      }
      return next;
    });
  }

  async function pickImage(file: File | undefined) {
    if (!file) {
      return;
    }
    setUploading(true);
    setImageError(null);
    try {
      // O preparo do Livre so carrega quando a equipe escolhe uma imagem.
      const { prepareFreeImage } = await import("@/components/admin/v2/communication/popup-free/free-image-prepare");
      const result = await onUpload(await prepareFreeImage(file, SCREEN_IMAGE_PREP));
      if (!result.ok) {
        setImageError(result.fieldErrors?.image?.[0] ?? result.error);
        return;
      }
      change({ image: { height: result.data.height, path: result.data.path, width: result.data.width } });
    } catch (failure) {
      setImageError(failure instanceof Error && failure.message ? failure.message : ERROS.imagemFormato);
    } finally {
      setUploading(false);
    }
  }

  async function submit(show: boolean) {
    setTried(true);
    setFormError(null);
    if (Object.keys(screenFormErrors(state, webinarId)).length > 0) {
      return;
    }
    const result = await onSave(screenFormInput(state, webinarId), show);
    if (!result) {
      return;
    }
    if (!result.ok) {
      const fields: Record<string, string> = {};
      for (const [key, messages] of Object.entries(result.fieldErrors ?? {})) {
        if (messages?.[0]) {
          fields[key] = messages[0];
        }
      }
      setServerErrors(fields);
      setFormError(Object.keys(fields).length > 0 ? null : result.error);
      return;
    }
    onBack();
  }

  const text = (field: "body" | "buttonLabel" | "imageAlt" | "linkUrl" | "name" | "title", label: string, max: number, hint?: string, multiline = false) => {
    const id = `${prefix}-${field}`;
    const error = errorOf(field);
    const props = {
      "aria-describedby": fieldDescribedBy(id, { error, hint }),
      "aria-invalid": error ? true : undefined,
      id,
      maxLength: max,
      onChange: (event: { target: { value: string } }) => change({ [field]: event.target.value } as Partial<ScreenFormState>),
      value: state[field]
    };
    return (
      <AdminField error={error} hint={hint} id={id} label={label}>
        {multiline ? <textarea className={cn(adminTextareaClass, "min-h-20")} rows={3} {...props} /> : <input className={adminInputClass} type={field === "linkUrl" ? "url" : "text"} {...props} />}
      </AdminField>
    );
  };

  const readyLinks = qr ? screenReadyLinks(items, null) : [];

  return (
    <SectionCard
      actions={
        <Button className="h-8! px-2 text-[13px]" data-console-screen-back="" onClick={onBack} type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {copy.console.voltar}
        </Button>
      }
      title={title}
      titleFocusable
      titleId={titleId}
    >
      <form className="flex min-w-0 flex-col gap-4" data-console-screen-form={kind} noValidate onSubmit={(event) => event.preventDefault()}>
        {qr ? (
          <>
            {text("linkUrl", form.link, SCREEN_LIMITS.qrLink, form.qrLinkDica)}
            <DropdownMenu>
              <DropdownMenuTrigger
                data-console-screen-ready-links=""
                render={<Button className="h-8! self-start px-2 text-[13px]" type="button" variant="secondary" />}
              >
                {form.linkPronto}
                <ChevronDown aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className={cn(adminMenuPopup, "w-64 bg-room-menu text-room-fg")} container={portal}>
                <DropdownMenuItem
                  className={adminMenuItem}
                  data-console-screen-ready-link="page"
                  onClick={() => {
                    const site = process.env.NEXT_PUBLIC_SITE_URL || (typeof window === "undefined" ? null : window.location.origin);
                    change({ linkUrl: screenPageLink(webinarSlug, site) ?? `${site ?? ""}${webinarHref(webinarSlug)}` });
                  }}
                >
                  {form.linkPaginaDoWebinario}
                </DropdownMenuItem>
                {readyLinks.map((link) => (
                  <DropdownMenuItem className={adminMenuItem} data-console-screen-ready-link={link.url} key={link.url} onClick={() => change({ linkUrl: link.url })}>
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{link.label}</span>
                      <span className="truncate text-xs text-[var(--text-tertiary)]">{link.url}</span>
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="flex min-w-0 items-start gap-3" data-console-screen-qr="">
              <div className="w-32 shrink-0 rounded-[8px] bg-white p-1">
                {preview.linkUrl ? <QrTile link={preview.linkUrl} side={128} /> : <QrCode aria-hidden="true" className="m-auto size-28 text-black/20" />}
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs leading-5 text-[var(--text-secondary)]">{form.qrGerado}</p>
                {dense ? (
                  <p className="text-xs leading-5 font-medium text-[var(--warning)]" data-console-screen-qr-dense="">
                    {form.qrDenso}
                  </p>
                ) : null}
              </div>
            </div>
            {text("title", form.legenda, SCREEN_LIMITS.title)}
          </>
        ) : (
          <>
            {text("name", form.nome, SCREEN_LIMITS.name)}
            <div className="flex min-w-0 flex-col gap-1.5" data-console-screen-image="">
              <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${prefix}-imagem`}>
                {form.imagem}
              </span>
              {preview.image ? (
                // eslint-disable-next-line @next/next/no-img-element -- a imagem enviada, no nosso bucket, pequena e sem otimizacao.
                <img alt="" className="h-auto max-h-32 w-auto max-w-full self-start rounded-[8px] border border-[var(--border-subtle)] object-contain" height={preview.image.height} src={preview.image.url} width={preview.image.width} />
              ) : null}
              <div aria-labelledby={`${prefix}-imagem`} className="flex min-w-0 flex-wrap items-center gap-2" role="group">
                <Button className="h-8! px-2 text-[13px]" data-console-screen-image-send="" disabled={uploading} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
                  {uploading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" /> : <ImageUp aria-hidden="true" className="size-4" />}
                  {uploading ? form.enviandoImagem : state.image ? form.trocarImagem : form.enviarImagem}
                </Button>
                {state.image ? (
                  <Button className="h-8! px-2 text-[13px]" data-console-screen-image-remove="" disabled={uploading} onClick={() => change({ image: null, imageAlt: "" })} type="button" variant="ghost">
                    {form.removerImagem}
                  </Button>
                ) : null}
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={form.enviarImagem}
                  className="sr-only"
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void pickImage(file);
                  }}
                  ref={fileInput}
                  tabIndex={-1}
                  type="file"
                />
              </div>
              {uploading ? (
                <p aria-live="polite" className="sr-only" role="status">
                  {form.enviandoImagem}
                </p>
              ) : null}
              {imageError || errorOf("imagePath") ? (
                <p className="text-[13px] leading-5 text-[var(--error)]" data-console-screen-image-error="" role="alert">
                  {imageError ?? errorOf("imagePath")}
                </p>
              ) : (
                <p className="text-xs leading-5 text-[var(--text-secondary)]">{form.imagemDica}</p>
              )}
            </div>
            {state.image ? text("imageAlt", form.descricao, SCREEN_LIMITS.imageAlt) : null}
            {text("title", form.titulo, SCREEN_LIMITS.title)}
            {text("body", form.texto, SCREEN_LIMITS.body, undefined, true)}
            {text("buttonLabel", form.textoDoBotao, SCREEN_LIMITS.buttonLabel, form.textoDoBotaoDica)}
            {text("linkUrl", form.link, SCREEN_LIMITS.link)}
          </>
        )}

        <PlacePicker idPrefix={prefix} onChange={(place) => change({ place })} value={state.place} />

        <div className="flex min-w-0 flex-col gap-1.5" data-console-screen-size="">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${prefix}-tamanho`}>
            {form.tamanho}
          </span>
          <PillGroup
            ariaLabel={form.tamanho}
            disabledValues={SCREEN_SIZES.filter((size) => !sizes.includes(size))}
            name={`${prefix}-size`}
            onChange={(size: ScreenSize) => change({ size })}
            options={SCREEN_SIZES.map((size) => ({ label: copy.tamanhos[size], value: size }))}
            value={state.size}
          />
          {errorOf("size") ? <p className="text-[13px] leading-5 text-[var(--error)]">{errorOf("size")}</p> : null}
        </div>

        <AdminSwitch
          checked={state.closable}
          description={!qr && !state.closable ? form.semFecharDica : undefined}
          id={`${prefix}-closable`}
          label={form.podeFechar}
          onCheckedChange={(closable) => change({ closable })}
        />

        {qr ? text("name", form.nome, SCREEN_LIMITS.name) : null}

        {!qr ? (
          <ul className="flex min-w-0 list-disc flex-col gap-1 pl-5 text-xs leading-5 text-[var(--text-secondary)]" data-console-screen-notices="">
            <li>{form.avisoCelular}</li>
            <li>{form.avisoPrazo}</li>
            <li>{form.avisoOferta}</li>
            {centerWarning ? (
              <li className="font-medium text-[var(--warning)]" data-console-screen-center-warning="">
                {form.avisoMeio}
              </li>
            ) : null}
          </ul>
        ) : null}

        <section aria-labelledby={`${prefix}-previa`} className="flex min-w-0 flex-col gap-2" data-console-screen-preview-block="">
          <h3 className="text-[13px] leading-5 font-semibold text-[var(--text-primary)]" id={`${prefix}-previa`}>
            {form.previa}
          </h3>
          <PillGroup
            ariaLabel={form.previa}
            name={`${prefix}-device`}
            onChange={(value: ScreenPreviewDevice) => setDevice(value)}
            options={[
              { label: form.previaComputador, value: "desktop" },
              { label: form.previaCelular, value: "mobile" }
            ]}
            value={device}
          />
          <ScreenPreview device={device} item={preview} />
        </section>

        {formError ? (
          <p className="text-[13px] leading-5 text-[var(--error)]" data-console-screen-form-error="" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="flex min-w-0 flex-wrap items-center gap-2" data-console-screen-form-actions="">
          {canShow ? (
            <Button data-console-screen-submit="show" disabled={busy || uploading} onClick={() => void submit(true)} type="button">
              {form.mostrarAgora}
            </Button>
          ) : null}
          <Button data-console-screen-submit="save" disabled={busy || uploading} onClick={() => void submit(false)} type="button" variant="secondary">
            {form.salvarParaDepois}
          </Button>
          <Button className="text-[var(--text-secondary)]" onClick={onBack} type="button" variant="ghost">
            {form.cancelar}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
