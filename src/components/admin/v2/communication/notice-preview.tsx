"use client";

import { Bell, CheckCheck } from "lucide-react";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MemberPopupCard } from "@/components/member/notifications/member-popup";
import { NotificationCard } from "@/components/member/notifications/notification-card";
import { MemberFilterPills } from "@/components/member/ui/member-filters";
import { cn } from "@/lib/utils";
import type { PopupFontFace } from "@/server/communications/popup-design-model";
import { resolveFreeArtboard } from "@/server/communications/popup-free-render";
import { popupCloseCaption } from "@/server/communications/popup-sentences";
import type { NoticeDraft } from "@/server/communications/schemas";
import { PillGroup } from "../form";
import { MEMBER_PREVIEW_VH_VAR, type PreviewDevice } from "../member-area/preview-frame";
import {
  PREVIEW_AGE_MS,
  PREVIEW_LISTEN_OPTIONS,
  PREVIEW_POLL_OPTIONS,
  draftToNotificationItem,
  draftToPopupItem,
  hasPreviewPoll,
  previewSender,
  type NoticeSenderChoice,
  type PreviewContent,
  type PreviewListen,
  type PreviewPoll
} from "./notices-view-model";

// Previa do aviso (docs/22 §2.2): os componentes REAIS do aluno (NotificationCard dentro do painel do
// sino; MemberPopupCard sobre a home escurecida) em modo `preview` (sem rede, audio parado, inert).
//
// Mesmo contrato do PreviewFrame da Area de membros (member-area/preview-frame.tsx: tokens do aluno de
// volta, container query, `inert`), mas a "tela" e o recorte onde o aviso aparece, em tamanho real: no
// computador, o canto do sino (o painel tem 400 px) ou o centro da pagina (o pop-up tem 448 px); no
// celular, a tela de 375 px (v3b-1: a largura de aceite). A tela inteira de 1280 px reduzida deixaria o texto
// ilegivel. A moldura so reduz quando a coluna e mais estreita que o recorte. Nada de exemplo em volta: so o aviso.
// v3b-1 (docs/25 §2.6): embaixo do pop-up, a legenda de como ele fecha ("Fecha só no X (e no Esc).").
//
// v2 (docs/23): o circulo e quem envia (a pessoa da equipe, ou o icone da escola de Marca), o icone vai
// antes do titulo, o "Termina em" aparece como o aluno ve logo depois do envio (chegou ha 30 s) e, com
// audio, as pilulas "Áudio na prévia" trocam o player parado entre "Não ouvido" e "Ouvido".
//
// v3a (docs/24 §2.5): o cartao do sino ja desenha o titulo maior, a linha "Ver …" ou o realce do cartao
// clicavel, o botao de reagir e a lixeira (parados) e a enquete. Com enquete, as pilulas "Enquete na
// prévia" trocam entre "Antes de votar" e "Depois de votar" (a primeira opcao como o voto do proprio
// aluno: 1 voto, 100%, nunca numero inventado); quem monta a enquete do cartao e draftToNotificationItem.
// Ajustes da v3a: com "Permitir que o aluno exclua do sino" desligado, o cartao sai sem o "⋯" de excluir
// (allowHide no item; o NotificationCard decide por canHideNotification).
//
// Design do pop-up (docs/26): no Personalizado, o celular (375 px) e o computador aparecem juntos (lado a lado
// quando cabe, um embaixo do outro na coluna estreita), os dois pelo MemberPopupCard (que desenha o
// PopupDesignCard do aluno) com as fontes enviadas (`fonts`: a biblioteca no editor, as do design no relatorio).
// Livre (docs/27): igual, pelo PopupFreeCard (o pedaco proprio do MemberPopupCard), com o computador do tamanho da
// largura escolhida.
// O computador tem 600 px: o cartao G (520 px) cabe no tamanho real.

/** Tokens de :root que o admin sobrescreve e a area do aluno usa (os mesmos do PreviewFrame). */
const STUDENT_TOKENS: Record<string, string> = {
  "--accent": "#e50914",
  "--accent-foreground": "#ffffff",
  "--accent-warm": "#ff7a1a",
  "--background": "#141414",
  "--border": "rgba(255, 255, 255, 0.1)",
  "--card": "#171717",
  "--card-foreground": "#f7f7f4",
  "--foreground": "#f7f7f4",
  "--input": "rgba(255, 255, 255, 0.15)",
  "--muted": "#a8a8a2",
  "--muted-foreground": "#a8a8a2",
  "--popover": "#202020",
  "--popover-foreground": "#f7f7f4",
  "--primary": "#e50914",
  "--primary-foreground": "#ffffff",
  "--ring": "rgba(229, 9, 20, 0.65)",
  "--secondary": "#202020",
  "--secondary-foreground": "#f7f7f4"
};

type Stage = { caption: string; minHeight: number; width: number };

const STAGES: Record<PreviewDevice, Stage> = {
  desktop: { caption: "Computador · tamanho real", minHeight: 560, width: 520 },
  mobile: { caption: "Celular · 375 px", minHeight: 720, width: 375 }
};

/** Design do pop-up: o computador com espaco para o cartao G (520 px) no tamanho real. */
const DESIGN_DESKTOP_STAGE: Stage = { caption: "Computador · tamanho real", minHeight: 560, width: 600 };

type StageProps = {
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  device: PreviewDevice;
  /** Segunda linha da legenda (pop-up: como fecha). */
  note?: string;
  /** Outra medida de tela (design do pop-up no computador). */
  stage?: Stage;
};

/** Recorte da tela do aluno, reduzido so quando nao cabe na coluna. */
function PreviewStage({ ariaLabel, children, className, device, note, stage: stageOverride }: StageProps) {
  const stage = stageOverride ?? STAGES[device];
  const outer = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ available: number; height: number } | null>(null);

  useEffect(() => {
    const outerElement = outer.current;
    const screenElement = screen.current;

    if (!outerElement || !screenElement) {
      return;
    }

    const measure = () => setSize({ available: outerElement.clientWidth, height: screenElement.offsetHeight });
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(outerElement);
    observer.observe(screenElement);

    return () => observer.disconnect();
  }, []);

  const scale = size ? Math.min(1, size.available / stage.width) : 1;
  const height = Math.max(stage.minHeight, size?.height ?? stage.minHeight);
  const screenStyle: CSSProperties & Record<string, string | number> = {
    ...STUDENT_TOKENS,
    [MEMBER_PREVIEW_VH_VAR]: `${stage.minHeight}px`,
    background: "#141414",
    color: "#f7f7f4",
    minHeight: stage.minHeight,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    width: stage.width
  };

  return (
    <figure aria-label={ariaLabel} className={cn("m-0 flex min-w-0 flex-col items-center gap-2", className)}>
      <div className="flex w-full min-w-0 justify-center [contain:inline-size]" ref={outer}>
        <div
          className="relative max-w-full overflow-hidden rounded-lg border border-[var(--border-strong)] bg-black"
          style={{
            height: Math.round(height * scale),
            visibility: size ? undefined : "hidden",
            width: Math.round(stage.width * scale)
          }}
        >
          <div className="@container absolute top-0 left-0" inert ref={screen} style={screenStyle}>
            {children}
          </div>
        </div>
      </div>
      <figcaption className="text-center text-xs leading-5 text-[var(--text-secondary)]">
        {stage.caption}
        {note ? <span className="block">{note}</span> : null}
      </figcaption>
    </figure>
  );
}

/** Barra do topo da area do aluno, so com o sino (e o 1 do aviso novo). */
function BellBar() {
  return (
    <div className="flex h-14 items-center justify-end px-3">
      <span className="relative grid size-10 place-items-center rounded-full bg-white/10 text-white">
        <Bell className="size-5" />
        <span className="absolute top-1 right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[11px] leading-none font-bold text-white tabular-nums ring-2 ring-[#141414]">
          1
        </span>
      </span>
    </div>
  );
}

type NoticePreviewProps = {
  /** Fim da notificacao de referencia (seguinte "Até a notificação principal sumir"). */
  anchorExpiresAt?: number | null;
  branding: { iconUrl?: string | null; logoUrl: string | null; name: string };
  className?: string;
  device: PreviewDevice;
  /** O aviso inteiro (pop-up usa o "Lembrar depois" e como fecha) ou so o conteudo de uma notificacao. */
  draft: PreviewContent & Partial<Pick<NoticeDraft, "allowSnooze" | "design" | "freeDesign" | "popup" | "sender">>;
  /** Design do pop-up: as fontes enviadas (o editor passa a biblioteca; o relatorio, as do design). */
  fonts?: readonly PopupFontFace[];
  /** Imagem recortada ainda subindo (data URL): a previa mostra antes do envio terminar. */
  imageUrl?: string | null;
  /** Instante de referencia do "agora" no cartao. */
  now: number;
  /** Equipe de "Quem envia" (nome e foto de agora); sem ela, a notificacao sai como a escola. */
  senders?: readonly NoticeSenderChoice[];
};

/** "Enquete na prévia": Antes de votar | Depois de votar (so com enquete). */
function PollPills({ onChange, value }: { onChange: (value: PreviewPoll) => void; value: PreviewPoll }) {
  const name = useId();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Enquete na prévia</span>
      <PillGroup ariaLabel="Enquete na prévia" name={name} onChange={onChange} options={PREVIEW_POLL_OPTIONS} value={value} />
    </div>
  );
}

/** "Áudio na prévia": Não ouvido | Ouvido (so com audio; o pop-up nao guarda o ouvido). */
function ListenPills({ onChange, value }: { onChange: (value: PreviewListen) => void; value: PreviewListen }) {
  // Nome proprio por previa: o editor, a folha da seguinte e o painel do passo podem estar na tela juntos.
  const name = useId();

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Áudio na prévia</span>
      <PillGroup ariaLabel="Áudio na prévia" name={name} onChange={onChange} options={PREVIEW_LISTEN_OPTIONS} value={value} />
    </div>
  );
}

export function NoticePreview({ anchorExpiresAt, branding, className, device, draft, fonts, imageUrl, now, senders = [] }: NoticePreviewProps) {
  const [listen, setListen] = useState<PreviewListen>("not_heard");
  const [pollPreview, setPollPreview] = useState<PreviewPoll>("before");
  const emptyTitle = !draft.title.trim();

  if (draft.kind === "popup" && (draft.design || draft.freeDesign)) {
    const item = draftToPopupItem({ ...draft, allowSnooze: draft.allowSnooze ?? true }, { fonts, imageUrl });
    // Livre (docs/27): o computador com espaco para a largura escolhida (ate 720 px) no tamanho real.
    const desktopStage = draft.freeDesign
      ? { ...DESIGN_DESKTOP_STAGE, width: Math.max(DESIGN_DESKTOP_STAGE.width, resolveFreeArtboard(draft.freeDesign).width + 64) }
      : DESIGN_DESKTOP_STAGE;
    // O botao principal do design aparece na previa assim que tem texto (o destino ainda vazio do "Saiba mais"
    // do modelo nao some com ele; na previa o botao nunca leva a lugar nenhum).
    const label = draft.cta?.label.trim() ?? "";
    const popup = !item.cta && draft.cta && label ? { ...item, cta: { href: "/", label, target: draft.cta.target } } : item;
    const stage = (target: PreviewDevice, note?: string) => (
      <PreviewStage
        ariaLabel={`Prévia do pop-up no ${target === "mobile" ? "celular" : "computador"}`}
        device={target}
        note={note}
        stage={target === "desktop" ? desktopStage : undefined}
      >
        <div className="relative grid place-items-center p-4" style={{ minHeight: (target === "desktop" ? desktopStage : STAGES.mobile).minHeight }}>
          <div aria-hidden="true" className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
          <div className="relative w-full">
            <div className="flex justify-center">
              <MemberPopupCard popup={popup} preview />
            </div>
          </div>
        </div>
      </PreviewStage>
    );

    return (
      <div className={cn("@container min-w-0", className)}>
        <div className="grid min-w-0 items-start gap-4 @[52rem]:grid-cols-[minmax(0,375fr)_minmax(0,600fr)]" data-popup-design={draft.freeDesign ? "free" : "custom"}>
          {stage("mobile")}
          {stage("desktop", popupCloseCaption(draft.popup?.close ?? "any"))}
        </div>
      </div>
    );
  }

  if (draft.kind === "popup") {
    return (
      <PreviewStage
        ariaLabel={`Prévia do pop-up no ${device === "mobile" ? "celular" : "computador"}`}
        className={cn(className, emptyTitle && "[&_h2]:font-semibold [&_h2]:text-white/40")}
        device={device}
        note={popupCloseCaption(draft.popup?.close ?? "any")}
      >
        <div className="relative grid place-items-center p-4" style={{ minHeight: STAGES[device].minHeight }}>
          <div aria-hidden="true" className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" />
          <div className="relative">
            <MemberPopupCard popup={draftToPopupItem({ ...draft, allowSnooze: draft.allowSnooze ?? true }, { imageUrl })} preview />
          </div>
        </div>
      </PreviewStage>
    );
  }

  const item = draftToNotificationItem(draft, {
    anchorExpiresAt,
    createdAt: new Date(now - PREVIEW_AGE_MS).toISOString(),
    imageUrl,
    listen,
    pollPreview,
    sender: previewSender(draft.sender ?? null, senders)
  });
  const showsPoll = hasPreviewPoll(draft);

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {draft.audio ? <ListenPills onChange={setListen} value={listen} /> : null}
      {showsPoll ? <PollPills onChange={setPollPreview} value={pollPreview} /> : null}
      <PreviewStage
        ariaLabel={`Prévia da notificação no sino, no ${device === "mobile" ? "celular" : "computador"}`}
        className={cn(emptyTitle && "[&_article>div>p:first-child]:font-medium [&_article>div>p:first-child]:text-white/40")}
        device={device}
      >
        <div className="pb-6">
          <BellBar />
          <div
            className={cn(
              "overflow-hidden rounded-[14px] border border-white/10 bg-[#1b1b1b] text-white shadow-[0_24px_70px_rgba(0,0,0,0.65)]",
              device === "mobile" ? "mx-3" : "mr-3 ml-auto w-[25rem]"
            )}
          >
            <div className="flex min-h-[3.75rem] items-center justify-between gap-3 px-4 pt-4 pb-3">
              <p className="text-base font-semibold text-white">Notificações</p>
              <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-semibold text-[#d4d4d8]">
                <CheckCheck aria-hidden="true" className="size-4" />
                Marcar todas como lidas
              </span>
            </div>
            <MemberFilterPills
              ariaLabel="Filtrar notificações"
              className="mx-0 px-4 pb-3 sm:mx-0 sm:px-4"
              onChange={() => undefined}
              options={[
                { id: "all", label: "Todas" },
                { count: 1, id: "unread", label: "Não lidas" }
              ]}
              value="all"
            />
            <div className="border-t border-white/[0.06]">
              <p className="px-4 pt-3 pb-1 text-xs font-semibold text-[#71717a]">Hoje</p>
              <NotificationCard
                item={item}
                now={now}
                preview
                schoolIconUrl={branding.iconUrl}
                schoolLogoUrl={branding.logoUrl}
                schoolName={branding.name}
                serverNow={now}
              />
            </div>
          </div>
        </div>
      </PreviewStage>
    </div>
  );
}
