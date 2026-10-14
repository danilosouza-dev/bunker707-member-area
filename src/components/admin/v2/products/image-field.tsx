"use client";

import { AlertCircle, ImagePlus, LoaderCircle } from "lucide-react";
import { useId, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { imageLinkSchema } from "@/server/catalog/schemas";
import { adminInputClass } from "../form";
import { adminTransition } from "../styles";
import { IMAGE_SPECS, MAX_SOURCE_FILE_BYTES, aspectRatioOf, describeImageRequirement, describeSourceSizeProblem, type ImageSlot } from "./cover-crop";
import { ImageCropDialog, type CropSource } from "./image-crop-dialog";

// Campo de imagem (capa 2:3 e imagem de destaque 8:3 do produto; imagens do login 4:5 e 16:9 na
// Area de membros): arrastar, escolher, colar um arquivo ou um link. Capa vazia na forma do prototipo:
// a area tracejada inteira e o botao, com o campo "ou cole o link de uma imagem" embaixo. Arquivo (e link que permite recorte) abre o recorte; link que o navegador nao
// deixa recortar e usado como esta, com aviso. O valor e um data URL WebP ou um link https.

type ImageFieldProps = {
  /** Mostra so a imagem, sem botoes (papel sem permissao de editar). */
  readOnly?: boolean;
  className?: string;
  /** Erro vindo do servidor (fieldErrors.cover/image). */
  error?: string | null;
  id: string;
  label: string;
  onChange: (value: string | null) => void;
  optional?: boolean;
  /** Salvando no servidor (aba Detalhes). */
  pending?: boolean;
  slot: ImageSlot;
  value: string | null;
};

type Notice = { text: string; tone: "error" | "info" };

function loadImage(url: string, crossOrigin: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    if (crossOrigin) {
      image.crossOrigin = "anonymous";
    }

    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("load"));
    image.src = url;
  });
}

function backgroundFor(url: string): CSSProperties {
  return {
    backgroundImage: `url("${url.replace(/["\\\n\r]/g, (character) => encodeURIComponent(character))}")`,
    backgroundPosition: "center",
    backgroundSize: "cover"
  };
}

export function ImageField({
  className,
  error,
  id,
  label,
  onChange,
  optional = false,
  pending = false,
  readOnly = false,
  slot,
  value
}: ImageFieldProps) {
  const spec = IMAGE_SPECS[slot];
  const portrait = spec.orientation === "portrait";
  const fileInput = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [crop, setCrop] = useState<{ source: CropSource; temporary: boolean } | null>(null);
  const shownError = error ?? (notice?.tone === "error" ? notice.text : null);
  const working = busy || pending;

  function closeCrop() {
    if (crop?.temporary) {
      URL.revokeObjectURL(crop.source.url);
    }

    setCrop(null);
  }

  async function openFile(file: File | undefined) {
    if (!file || readOnly) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setNotice({ text: "Escolha um arquivo de imagem (JPG, PNG, WebP ou AVIF).", tone: "error" });
      return;
    }

    if (file.size > MAX_SOURCE_FILE_BYTES) {
      setNotice({ text: "Use uma imagem de até 20 MB.", tone: "error" });
      return;
    }

    setBusy(true);
    setNotice(null);
    const url = URL.createObjectURL(file);

    try {
      const element = await loadImage(url, false);
      const problem = describeSourceSizeProblem({ height: element.naturalHeight, width: element.naturalWidth }, spec);

      if (problem) {
        URL.revokeObjectURL(url);
        setNotice({ text: problem, tone: "error" });
        return;
      }

      setCrop({ source: { element, height: element.naturalHeight, url, width: element.naturalWidth }, temporary: true });
    } catch {
      URL.revokeObjectURL(url);
      setNotice({ text: "Não conseguimos abrir este arquivo. Tente outra imagem.", tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function openLink(raw: string) {
    if (readOnly || !raw.trim()) {
      return;
    }

    const parsed = imageLinkSchema.safeParse(raw);

    if (!parsed.success) {
      setNotice({ text: parsed.error.issues[0]?.message ?? "Use um link que comece com https://.", tone: "error" });
      return;
    }

    const url = parsed.data;
    setBusy(true);
    setNotice(null);

    try {
      // Com permissao do servidor da imagem, da para recortar aqui mesmo.
      const element = await loadImage(url, true);
      const problem = describeSourceSizeProblem({ height: element.naturalHeight, width: element.naturalWidth }, spec);

      if (problem) {
        setNotice({ text: problem, tone: "error" });
        return;
      }

      setLink("");
      setCrop({ source: { element, height: element.naturalHeight, url, width: element.naturalWidth }, temporary: false });
    } catch {
      try {
        const element = await loadImage(url, false);
        const problem = describeSourceSizeProblem({ height: element.naturalHeight, width: element.naturalWidth }, spec);

        if (problem) {
          setNotice({ text: problem, tone: "error" });
          return;
        }

        setLink("");
        setNotice({ text: "O site dessa imagem não permite recortar aqui. Usamos o link como está; para ajustar o enquadramento, envie o arquivo.", tone: "info" });
        onChange(url);
      } catch {
        setNotice({ text: "Não conseguimos abrir essa imagem. Confira o link ou envie o arquivo.", tone: "error" });
      }
    } finally {
      setBusy(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragOver(false);

    if (readOnly || working) {
      return;
    }

    const file = event.dataTransfer.files?.[0];

    if (file) {
      void openFile(file);
      return;
    }

    const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");

    if (text) {
      void openLink(text.split(/\r?\n/)[0] ?? "");
    }
  }

  const frame = (
    <div
      aria-label={value ? `${label} atual` : undefined}
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border bg-[var(--surface-1)]",
        portrait ? (value ? "w-24" : "w-[72px]") : "w-full",
        value ? "border-[var(--border-subtle)]" : "border-dashed border-[var(--border-strong)]",
        dragOver && "border-[var(--text-secondary)] bg-[var(--surface-2)]"
      )}
      role={value ? "img" : undefined}
      style={{ ...(value ? backgroundFor(value) : {}), aspectRatio: aspectRatioOf(spec) }}
    >
      {!value ? <span className="text-xs font-medium text-[var(--text-tertiary)]">{spec.ratioLabel}</span> : null}
      {working ? (
        <span className="absolute inset-0 grid place-items-center bg-black/50" role="status">
          <LoaderCircle aria-hidden="true" className="size-5 animate-spin text-[var(--text-primary)] motion-reduce:animate-none" />
          <span className="sr-only">Carregando imagem</span>
        </span>
      ) : null}
    </div>
  );

  if (readOnly) {
    return (
      <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{label}</span>
        {frame}
        {!value ? <p className="text-xs leading-5 text-[var(--text-secondary)]">Sem imagem.</p> : null}
      </div>
    );
  }

  const dragHandlers = {
    onDragLeave: () => setDragOver(false),
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (!dragOver) {
        setDragOver(true);
      }
    },
    onDrop: handleDrop
  };

  const linkInput = (
    <>
      <label className="sr-only" htmlFor={linkId}>
        Link da imagem ({spec.label})
      </label>
      <Input
        autoComplete="off"
        className={cn(adminInputClass, !portrait && "max-w-[420px]")}
        disabled={working}
        id={linkId}
        inputMode="url"
        onBlur={() => void openLink(link)}
        onChange={(event) => setLink(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void openLink(link);
          }
        }}
        onPaste={(event) => {
          const file = event.clipboardData.files?.[0];

          if (file) {
            event.preventDefault();
            void openFile(file);
          }
        }}
        placeholder="ou cole o link de uma imagem"
        type="url"
        value={link}
      />
    </>
  );

  const changeButtons = value ? (
    <div className="flex flex-wrap items-center gap-2">
      <Button className="h-8! px-2.5 text-[13px]" disabled={working} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
        <ImagePlus aria-hidden="true" className="size-4" />
        Trocar imagem
      </Button>
      <Button
        className="h-8! px-2.5 text-[13px] text-[var(--text-secondary)]"
        disabled={working}
        onClick={() => {
          setNotice(null);
          onChange(null);
        }}
        type="button"
        variant="ghost"
      >
        Remover
      </Button>
    </div>
  ) : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" id={`${id}-label`}>
        {label}
        {optional ? <span className="font-normal text-[var(--text-tertiary)]"> (opcional)</span> : null}
      </span>

      {portrait && !value ? (
        // Prototipo: a area tracejada inteira e o botao (moldura 9:13 + frase), o link vem embaixo.
        <button
          aria-describedby={`${id}-hint`}
          aria-labelledby={`${id}-label`}
          className={cn(
            "flex w-full min-w-0 items-center gap-4 rounded-lg border border-dashed border-[var(--border-stronger)] bg-[var(--surface-1)] p-3 text-left",
            "hover:border-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:cursor-not-allowed",
            dragOver && "border-[var(--text-secondary)] bg-[var(--surface-2)]",
            adminTransition
          )}
          disabled={working}
          onClick={() => fileInput.current?.click()}
          type="button"
          {...dragHandlers}
        >
          {frame}
          <span className="flex min-w-0 flex-col gap-1">
            <span className="text-sm leading-5 font-medium text-[var(--text-primary)]">Arraste uma imagem ou clique para escolher</span>
            <span className="text-[13px] leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
              {describeImageRequirement(spec)}
            </span>
          </span>
        </button>
      ) : (
        <div className={cn("flex min-w-0 gap-4", portrait ? "flex-row items-start" : "flex-col")} {...dragHandlers}>
          <button
            aria-describedby={`${id}-hint`}
            aria-labelledby={`${id}-label`}
            className={cn("shrink-0 rounded-lg disabled:cursor-not-allowed", !portrait && "w-full", adminTransition)}
            disabled={working}
            onClick={() => fileInput.current?.click()}
            type="button"
          >
            {frame}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">
              {value ? "Clique na imagem ou arraste outra para trocar" : "Arraste uma imagem ou clique para escolher"}
            </p>
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]" id={`${id}-hint`}>
              {describeImageRequirement(spec)}
            </p>
            {changeButtons ? <div className="mt-1.5">{changeButtons}</div> : null}
            {!portrait ? <div className="mt-1.5">{linkInput}</div> : null}
          </div>
        </div>
      )}

      {portrait ? linkInput : null}

      <input
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          void openFile(event.target.files?.[0]);
          event.target.value = "";
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
        aria-hidden="true"
      />

      {shownError ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`} role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {shownError}
        </p>
      ) : null}
      {!shownError && notice?.tone === "info" ? (
        <p className="text-xs leading-5 text-[var(--text-secondary)]" role="status">
          {notice.text}
        </p>
      ) : null}

      {crop ? (
        <ImageCropDialog
          key={crop.source.url}
          onCancel={closeCrop}
          onConfirm={(dataUrl) => {
            closeCrop();
            setNotice(null);
            onChange(dataUrl);
          }}
          open
          slot={slot}
          source={crop.source}
        />
      ) : null}
    </div>
  );
}
