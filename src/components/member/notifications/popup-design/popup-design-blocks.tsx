"use client";

import { Fragment, type CSSProperties, type MouseEvent } from "react";
import type { AccessPreviewMode } from "@/lib/access-preview";
import type { PopupItem } from "@/server/communications/notification-model";
import {
  scaledLength,
  type PopupBlock,
  type PopupButton2Block,
  type PopupButtonBlock,
  type PopupDesign,
  type PopupFontFace,
  type PopupHeadingBlock
} from "@/server/communications/popup-design-model";
import { NoticeAudioPlayer } from "../notice-audio-player";
import type { NotificationLink } from "../notifications-model";
import {
  badgeCss,
  badgeTextCss,
  button2Behavior,
  buttonCss,
  headingCss,
  headingLineCss,
  POPUP_BUTTON_LABEL_CSS,
  primaryButtonTarget,
  textBlockCss
} from "./popup-design-styles";

// Blocos do pop-up "Personalizado" (docs/26), na ordem do design: selo, titulo (o primeiro e o <h2> que da nome
// ao dialogo; cada linha um span em bloco, com espaco entre elas para o nome nao colar palavras), texto (o
// primeiro descreve o dialogo), botao principal (o `cta` do aviso, o mesmo clique contado), segundo botao
// (Fechar, Lembrar depois ou link), o player do audio e o espaco. Texto de verdade (selecionavel); na previa
// do admin, links e botoes viram <span> sem acao.

const ACTION_CLASS =
  "cursor-pointer select-none transition-[filter] duration-150 hover:brightness-110 motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

export type PopupDesignBlocksProps = {
  accessPreviewMode?: AccessPreviewMode;
  bodyId?: string;
  cardWidth: number;
  design: PopupDesign;
  faces: readonly PopupFontFace[];
  /** Estilo a mais do primeiro bloco (guarda o canto do X). */
  firstBlockStyle?: CSSProperties | null;
  onClose?: () => void;
  onCta?: (event: MouseEvent<HTMLAnchorElement>, link: NotificationLink) => void;
  onSnooze?: () => void;
  popup: PopupItem;
  preview: boolean;
  titleId?: string;
};

type BlockProps<T extends PopupBlock> = Omit<PopupDesignBlocksProps, "firstBlockStyle"> & { block: T; extra: CSSProperties | null; primary: boolean };

function HeadingView({ block, cardWidth, design, extra, faces, primary, titleId }: BlockProps<PopupHeadingBlock>) {
  const Tag = primary ? "h2" : "h3";

  return (
    <Tag id={primary ? titleId : undefined} style={{ ...headingCss(block, design.text.align, cardWidth, faces), ...extra }}>
      {block.lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? " " : null}
          <span style={headingLineCss(line, block, design.text.align, cardWidth)}>{line.text}</span>
        </Fragment>
      ))}
    </Tag>
  );
}

function PrimaryButtonView({ accessPreviewMode, block, cardWidth, design, extra, faces, onCta, popup, preview }: BlockProps<PopupButtonBlock>) {
  const target = primaryButtonTarget(popup.cta, accessPreviewMode);

  if (!target) {
    return null;
  }

  const style = { ...buttonCss(block.style, design.text.align, cardWidth, faces), ...extra };
  const label = <span style={POPUP_BUTTON_LABEL_CSS}>{target.label}</span>;

  if (preview) {
    return (
      <span data-popup-button="primary" style={style}>
        {label}
      </span>
    );
  }

  const { link } = target;

  return (
    <a
      className={ACTION_CLASS}
      data-popup-button="primary"
      href={link.href}
      onClick={(event) => onCta?.(event, link)}
      style={style}
      {...(link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
    >
      {label}
      {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
    </a>
  );
}

function SecondButtonView({ accessPreviewMode, block, cardWidth, design, extra, faces, onClose, onCta, onSnooze, popup, preview }: BlockProps<PopupButton2Block>) {
  const behavior = button2Behavior(block, { accessPreviewMode, canSnooze: popup.canSnooze });

  if (!behavior) {
    return null;
  }

  const style = { ...buttonCss(block.style, design.text.align, cardWidth, faces), ...extra };
  const label = <span style={POPUP_BUTTON_LABEL_CSS}>{block.label}</span>;

  if (preview) {
    return (
      <span data-popup-button={behavior.kind} style={style}>
        {label}
      </span>
    );
  }

  if (behavior.kind === "link") {
    const { link } = behavior;

    return (
      <a
        className={ACTION_CLASS}
        data-popup-button="link"
        href={link.href}
        onClick={(event) => onCta?.(event, link)}
        style={style}
        {...(link.newTab ? { rel: "noopener noreferrer", target: "_blank" } : {})}
      >
        {label}
        {link.newTab ? <span className="sr-only"> (abre em nova aba)</span> : null}
      </a>
    );
  }

  return (
    <button className={ACTION_CLASS} data-popup-button={behavior.kind} onClick={behavior.kind === "close" ? onClose : onSnooze} style={style} type="button">
      {label}
    </button>
  );
}

function BlockView(props: BlockProps<PopupBlock>) {
  const { bodyId, block, cardWidth, design, extra, faces, popup, preview, primary } = props;

  switch (block.type) {
    case "badge":
      return (
        <span style={{ ...badgeCss(block, design.text.align, cardWidth), ...extra }}>
          <span style={badgeTextCss(block, cardWidth, faces)}>{block.text}</span>
        </span>
      );
    case "heading":
      return <HeadingView {...props} block={block} />;
    case "text":
      return (
        <p id={primary ? bodyId : undefined} style={{ ...textBlockCss(block, design.text.align, cardWidth, faces), ...extra }}>
          {block.text}
        </p>
      );
    case "button":
      return <PrimaryButtonView {...props} block={block} />;
    case "button2":
      return <SecondButtonView {...props} block={block} />;
    case "audio":
      return popup.audio ? (
        <div style={{ alignSelf: "stretch", textAlign: "left", ...extra }}>
          <NoticeAudioPlayer audio={popup.audio} label="Áudio do aviso" preview={preview} />
        </div>
      ) : null;
    case "spacer":
      return <div aria-hidden="true" style={{ flexShrink: 0, height: scaledLength(block.height, cardWidth), ...extra }} />;
  }
}

export function PopupDesignBlocks({ firstBlockStyle = null, ...props }: PopupDesignBlocksProps) {
  const headingId = props.design.blocks.find((block) => block.type === "heading")?.id;
  const textId = props.design.blocks.find((block) => block.type === "text")?.id;

  return props.design.blocks.map((block, index) => (
    <BlockView
      {...props}
      block={block}
      extra={index === 0 ? firstBlockStyle : null}
      key={block.id}
      primary={block.id === headingId || block.id === textId}
    />
  ));
}
