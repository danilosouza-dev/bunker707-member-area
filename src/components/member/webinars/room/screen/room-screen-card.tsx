"use client";

import { X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { ReactNode } from "react";
import { linkDomain } from "@/lib/webinar-links";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { QR_MARGIN_MODULES, qrModules, qrSidePx, type ScreenEventForm, type ScreenEventTarget, type ScreenSize, type StudentScreenItem } from "@/server/webinars/screen-model";
import { ROOM_TOUCH_44, roomPillClassName } from "../room-pill";
import { ROOM_FOCUS, RoomIconButton } from "../room-ui";
import { SCREEN_BANNER_WIDTH, screenBannerAction, screenImageSrc, screenLinkOf, screenSectionName } from "./room-screen-model";
import { useScreenShownRef, type ScreenWatch } from "./use-room-screen";

// O banner e o QR Code no palco de 640 px ou mais (Na tela, R3 e R4; especificacao de 10/11/2026, §3.2, §3.5 e §3.7):
// o cartao sobre o video na celula escolhida (a camada room-screen-layer.tsx decide onde), e as pecas que a faixa e a
// doca do vertical (room-screen-strip.tsx) usam tambem: o link da equipe (outra aba, rel "noopener noreferrer
// nofollow", so https conferido de novo aqui; o clique manda o "clicou" sem segurar o link; o botao com pelo menos 96 px de
// largura, para o texto curto nao virar uma bola, pedido do produtor em 12/11/2026), o desenho do QR Code
// (QRCodeSVG, nivel M, modulos pretos no quadro branco com a margem de 4 modulos nos dois temas, role="img" com o nome
// "QR Code do link {domínio}") e o X (alvo de 44 px, fora do link; "Fechar o banner" / "Fechar o QR Code"). Sem poder
// fechar, nada de X: o leitor de tela ouve "Este banner sai quando a equipe tirar.".
// O cartao: a superficie sobre o video da sala (--room-on-video-*, raio 16), a largura do banner pelo tamanho (clamp em
// cqw da camada, nunca mais de 40 % do palco nem mais que a celula), a imagem inteira (object-contain, com width e
// height) e o texto em ate 3 linhas; o botao e uma pilula (roomPillClassName num <a>, com a area de toque de 44 px
// abaixo de lg); sem texto do botao, o banner inteiro e o link; com "Imagem e botão" (docs/30 D86), o banner e o botao
// abrem o link (dois links irmaos, o botao fora do link do banner); sem link, e so um aviso. O QR Code tem o lado do tamanho
// (128 / 176 / 232, nunca menos de 3 px por modulo: qrSidePx) e, abaixo, a legenda e sempre o link de texto "Abrir o
// link" (tambem com a area de 44 px). Altura no maximo a area livre: o resto rola por dentro. Entrada com
// fade de 200 ms (sem animacao com prefers-reduced-motion); nada pisca nem conta tempo. Uma <section> nao modal com nome
// ("Banner da equipe: {título}"), nunca dialogo: sem veu, sem prender nem tirar o foco. So tokens --room-*; nenhuma frase
// escrita aqui (WEBINAR_COPY.naTela.aluno).

/** O que a sala faz com os cartoes e linhas: o X, o clique no link e o registro do "viu". Sem eles (a previa), nada sai. */
export type ScreenItemHandlers = {
  onClick?: (displayId: string, form: ScreenEventForm, target: ScreenEventTarget) => void;
  onClose?: (displayId: string, form: ScreenEventForm) => void;
  watch?: ScreenWatch | null;
};

/** O link da equipe: outra aba, sem passar quem abriu nem o endereco de origem; o clique conta e o link abre normalmente. */
export function RoomScreenLink({ children, className, href, onClick }: { children: ReactNode; className?: string; href: string; onClick?: () => void }) {
  return (
    <a className={className} data-room-screen-link="" href={href} onClick={onClick} rel="noopener noreferrer nofollow" target="_blank">
      {children}
    </a>
  );
}

/**
 * O "Abrir o link" de texto (o QR Code nunca e o unico caminho ate o link): a linha de 20 px com a area de toque de 44 px
 * abaixo de lg (12 px acima e abaixo, 6 px dos lados), sem mudar o desenho do cartao.
 */
export const SCREEN_TEXT_LINK = cn(
  "relative rounded-[4px] text-[13px] font-semibold leading-5 text-room-link underline underline-offset-2 after:absolute after:-inset-x-1.5 after:-inset-y-3 hover:no-underline lg:after:hidden",
  ROOM_FOCUS
);

/** O desenho do QR Code: o quadro branco com os modulos pretos (nos dois temas), nivel M e a margem de 4 modulos; o svg ja e role="img". */
export function RoomScreenQr({ link, side }: { link: string; side: number }) {
  return (
    <QRCodeSVG
      aria-label={WEBINAR_COPY.naTela.aluno.qrNome(linkDomain(link) ?? link)}
      bgColor="#ffffff"
      className="block shrink-0 rounded-[8px]"
      data-room-screen-qr=""
      fgColor="#000000"
      level="M"
      marginSize={QR_MARGIN_MODULES}
      size={side}
      value={link}
    />
  );
}

/** O lado do QR Code de um tamanho, pelo link (3 px por modulo no minimo). */
export function screenQrSide(size: ScreenSize, link: string): number {
  return qrSidePx(size, qrModules(link));
}

/** O X de fechar (fora do link): alvo de 44 px, o nome pelo tipo. */
export function RoomScreenClose({ className, item, onClose, size = 32, tone = "ghost" }: { className?: string; item: Pick<StudentScreenItem, "kind">; onClose: () => void; size?: 32 | 44; tone?: "ghost" | "video" }) {
  const aluno = WEBINAR_COPY.naTela.aluno;
  return (
    <RoomIconButton className={className} data-room-screen-close="" label={item.kind === "qr" ? aluno.fecharQr : aluno.fecharBanner} onClick={onClose} size={size} tone={tone} withTitle={false}>
      <X aria-hidden="true" strokeWidth={2} />
    </RoomIconButton>
  );
}

/** Sem poder fechar, so o leitor de tela ouve que o banner sai quando a equipe tirar. */
export function RoomScreenStays({ item }: { item: Pick<StudentScreenItem, "closable" | "kind"> }) {
  if (item.closable || item.kind !== "banner") {
    return null;
  }
  return <p className="sr-only">{WEBINAR_COPY.naTela.aluno.semFechar}</p>;
}

/** A imagem do banner, inteira, com as medidas guardadas (so do nosso bucket). */
export function RoomScreenImage({ className, image }: { className?: string; image: NonNullable<StudentScreenItem["image"]> }) {
  const src = screenImageSrc(image.url);
  if (!src) {
    return null;
  }
  // eslint-disable-next-line @next/next/no-img-element -- imagem do nosso bucket com as medidas guardadas; sem o otimizador do Next na sala.
  return <img alt={image.alt} className={cn("block h-auto w-full object-contain", className)} data-room-screen-image="" decoding="async" height={image.height} src={src} width={image.width} />;
}

/** O conteudo do banner no cartao: a imagem, o titulo, o texto em ate 3 linhas e o botao; o link no botao, no banner ou nos dois (screenBannerAction). */
function BannerContent({ form, handlers, item }: { form: ScreenEventForm; handlers?: ScreenItemHandlers; item: StudentScreenItem }) {
  const href = screenLinkOf(item);
  const action = screenBannerAction(item);
  const text = item.title || item.body;
  const cardLink = action === "card" || action === "both";
  const buttonLink = action === "button" || action === "both";
  const content = (
    <>
      {item.image ? <RoomScreenImage image={item.image} /> : null}
      {text ? (
        // Sem imagem, o X fica no canto do texto: o titulo deixa o lugar dele.
        <span className={cn("flex flex-col gap-1 px-3 pt-3", buttonLink ? null : "pb-3", item.closable && !item.image ? "pr-10" : null)}>
          {item.title ? <span className="line-clamp-3 text-sm font-semibold leading-5">{item.title}</span> : null}
          {item.body ? <span className="line-clamp-3 text-[13px] leading-[18px]">{item.body}</span> : null}
        </span>
      ) : null}
    </>
  );

  return (
    <>
      {cardLink && href ? (
        <RoomScreenLink className={cn("block min-w-0 rounded-[16px] text-room-on-video-fg hover:opacity-90 focus-visible:-outline-offset-2", ROOM_FOCUS)} href={href} onClick={() => handlers?.onClick?.(item.displayId, form, "card")}>
          {content}
        </RoomScreenLink>
      ) : (
        <div className="min-w-0">{content}</div>
      )}
      {buttonLink && href && item.buttonLabel ? (
        <div className={cn("px-3 pb-3", text ? "pt-2" : "pt-3")}>
          <RoomScreenLink className={roomPillClassName({ className: cn(ROOM_TOUCH_44, "min-w-24 max-w-full"), size: "s", tone: "white" })} href={href} onClick={() => handlers?.onClick?.(item.displayId, form, "button")}>
            <span className="truncate">{item.buttonLabel}</span>
          </RoomScreenLink>
        </div>
      ) : null}
    </>
  );
}

/**
 * O conteudo do QR Code no cartao: o desenho, a legenda, o "Abrir o link" e, embaixo a direita, o X (fora do quadro
 * branco: nada encosta na margem que o celular precisa para ler).
 */
function QrContent({ close, form, handlers, item }: { close: ReactNode; form: ScreenEventForm; handlers?: ScreenItemHandlers; item: StudentScreenItem }) {
  const href = screenLinkOf(item);
  if (!href) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      <RoomScreenQr link={href} side={screenQrSide(item.size, href)} />
      <div className="flex min-w-0 items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          {item.title ? <p className="line-clamp-2 max-w-full text-sm font-semibold leading-5">{item.title}</p> : null}
          <RoomScreenLink className={SCREEN_TEXT_LINK} href={href} onClick={() => handlers?.onClick?.(item.displayId, form, "qr_link")}>
            {WEBINAR_COPY.naTela.aluno.abrirOLink}
          </RoomScreenLink>
        </div>
        {close}
      </div>
    </div>
  );
}

/**
 * O cartao do palco largo (a forma `stage` das metricas). A classe de visibilidade (`hidden @min-[640px]/tela:flex`) e
 * da camada; aqui so o desenho. Com `handlers`, o X fecha para este aluno e o "viu" conta.
 */
export function RoomScreenCard({ className, handlers, item }: { className?: string; handlers?: ScreenItemHandlers; item: StudentScreenItem }) {
  const ref = useScreenShownRef<HTMLElement>(handlers?.watch, item.displayId, "stage");
  const qr = item.kind === "qr";
  const close = item.closable ? (
    <RoomScreenClose className={qr ? "shrink-0" : "absolute right-1.5 top-1.5"} item={item} onClose={() => handlers?.onClose?.(item.displayId, "stage")} tone={qr ? "ghost" : "video"} />
  ) : null;
  return (
    <section
      aria-label={screenSectionName(item)}
      className={cn(
        "pointer-events-auto relative min-h-0 max-w-[min(40cqw,100%)] shrink flex-col overflow-y-auto overscroll-contain rounded-[16px] bg-room-on-video-bg text-room-on-video-fg shadow-[0_8px_24px_rgba(0,0,0,0.35)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200",
        qr ? "w-fit" : SCREEN_BANNER_WIDTH[item.size],
        className
      )}
      data-room-screen-card={item.kind}
      data-room-screen-display={item.displayId}
      ref={ref}
    >
      {qr ? <QrContent close={close} form="stage" handlers={handlers} item={item} /> : <BannerContent form="stage" handlers={handlers} item={item} />}
      {qr ? null : close}
      <RoomScreenStays item={item} />
    </section>
  );
}
