"use client";

import { Camera, LoaderCircle, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from "react";
import {
  cropRect,
  initialCropState,
  maxZoomFor,
  outputSizeFor,
  panCrop,
  zoomCrop,
  type CropRect,
  type CropSpec,
  type CropState
} from "@/components/admin/v2/products/cover-crop";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { MemberButton } from "@/components/member/ui/member-button";
import {
  AVATAR_BACKGROUND_COLOR,
  AVATAR_MAX_DATA_URL_LENGTH,
  AVATAR_MAX_SOURCE_FILE_BYTES,
  AVATAR_MIN_SOURCE_SIZE,
  AVATAR_OUTPUT_SIZE,
  AVATAR_SMALLER_SIZES,
  AVATAR_TARGET_BYTES,
  encodeAvatar,
  type AvatarEncodingResult
} from "@/lib/avatar-image";

// Foto do perfil (Perfil, cabecalho): clicar na foto ou em "Alterar foto" escolhe uma imagem, o aluno
// ajusta o recorte redondo (arrastar e zoom) e salva. O navegador recorta num quadrado de 512 px e
// comprime no formato que consegue gerar (WebP; JPEG no Safari, iPhone e iPad, que nao geram WebP pelo
// canvas; ver encodeAvatar em src/lib/avatar-image.ts); o servidor confere de novo
// (src/server/member-area/student-avatar-model.ts). A geometria do recorte e a mesma do admin
// (cover-crop.ts), com a medida quadrada da foto. Visual pelas pecas da area do aluno (docs/12): dialogo
// no formato do "Editar nome do chat" do Tutor, MemberButton, slider do player (.bunker-player-timeline)
// e botao redondo translucido para a camera.

const AVATAR_CROP_SPEC: CropSpec = {
  label: "foto do perfil",
  maxBytes: AVATAR_TARGET_BYTES,
  maxDataUrlLength: AVATAR_MAX_DATA_URL_LENGTH,
  minHeight: AVATAR_MIN_SOURCE_SIZE,
  minWidth: AVATAR_MIN_SOURCE_SIZE,
  orientation: "portrait",
  outputHeight: AVATAR_OUTPUT_SIZE,
  outputWidth: AVATAR_OUTPUT_SIZE,
  ratioLabel: "1:1"
};

type CropSource = { element: HTMLImageElement; height: number; url: string; width: number };
type Status = { text: string; tone: "error" | "success" } | null;

function cssUrl(url: string) {
  return `url("${url.replace(/["\\\n\r]/g, (character) => encodeURIComponent(character))}")`;
}

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/** Desenha o recorte num canvas quadrado de `size` px sobre o fundo escuro (JPEG nao tem transparencia). */
function drawCrop(image: HTMLImageElement, rect: CropRect, size: number) {
  const canvas = document.createElement("canvas");

  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("canvas");
  }

  context.fillStyle = AVATAR_BACKGROUND_COLOR;
  context.fillRect(0, 0, size, size);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, size, size);

  return canvas;
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("load"));
    image.src = url;
  });
}

const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo para mudar a foto.";

async function readError(response: Response, fallback: string) {
  if (response.status === 401) {
    return SESSION_EXPIRED;
  }

  try {
    const body = (await response.json()) as { error?: unknown };

    return typeof body.error === "string" && body.error ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function AvatarCropDialog({
  onCancel,
  onSave,
  source
}: {
  onCancel: () => void;
  onSave: (dataUrl: string) => Promise<string | null>;
  source: CropSource;
}) {
  const spec = AVATAR_CROP_SPEC;
  const size = { height: source.height, width: source.width };
  const titleId = useId();
  const descriptionId = useId();
  const [state, setState] = useState<CropState>(() => initialCropState(size, spec));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ pointerX: number; pointerY: number; scale: number; start: CropState } | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const maxZoom = maxZoomFor(size, spec);
  const rect = cropRect(size, spec, state);
  const canZoom = maxZoom > 1.001;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    areaRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const previewStyle: CSSProperties = {
    backgroundImage: cssUrl(source.url),
    backgroundPosition: `${source.width > rect.width ? (rect.x / (source.width - rect.width)) * 100 : 0}% ${
      source.height > rect.height ? (rect.y / (source.height - rect.height)) * 100 : 0
    }%`,
    backgroundRepeat: "no-repeat",
    backgroundSize: `${(source.width / rect.width) * 100}% ${(source.height / rect.height) * 100}%`
  };

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerX: event.clientX, pointerY: event.clientY, scale: rect.width / box.width, start: state };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;

    if (!current) {
      return;
    }

    setState(panCrop(size, spec, current.start, -(event.clientX - current.pointerX) * current.scale, -(event.clientY - current.pointerY) * current.scale));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = rect.width * 0.04;
    const moves: Record<string, [number, number]> = { ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step] };

    if (moves[event.key]) {
      event.preventDefault();
      const [deltaX, deltaY] = moves[event.key];
      setState((current) => panCrop(size, spec, current, deltaX, deltaY));
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      setState((current) => zoomCrop(size, spec, current, current.zoom + 0.1));
    } else if (event.key === "-") {
      event.preventDefault();
      setState((current) => zoomCrop(size, spec, current, current.zoom - 0.1));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    await nextFrame();

    try {
      // Medida da saida (ate 512 px, sem ampliar) e, se o arquivo nao couber nem na menor qualidade
      // (so em PNG), medidas menores ate caber.
      const output = outputSizeFor(rect, spec);
      const sizes = [output.width, ...AVATAR_SMALLER_SIZES.filter((size) => size < output.width)];
      let result: AvatarEncodingResult = { error: "too_large", ok: false };

      for (const size of sizes) {
        const canvas = drawCrop(source.element, rect, size);

        result = encodeAvatar((type, quality) => canvas.toDataURL(type, quality));

        if (result.ok || result.error !== "too_large") {
          break;
        }
      }

      if (!result.ok) {
        setError(
          result.error === "unsupported"
            ? "Não conseguimos preparar esta foto. Escolha outra imagem."
            : "A foto ficou grande demais. Aumente o zoom ou escolha outra imagem."
        );
        setSaving(false);
        return;
      }

      const problem = await onSave(result.dataUrl);

      if (problem) {
        setError(problem);
        setSaving(false);
      }
    } catch {
      setError("Não conseguimos preparar esta foto. Escolha outra imagem.");
      setSaving(false);
    }
  }

  const zoomProgress = canZoom ? ((state.zoom - 1) / (maxZoom - 1)) * 100 : 0;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-black/75 px-4 py-6 backdrop-blur-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) {
          event.stopPropagation();
          onCancel();
        }
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) {
          onCancel();
        }
      }}
    >
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="w-full max-w-md overflow-hidden rounded-xl border border-white/10 bg-[#171717] shadow-[0_28px_100px_rgba(0,0,0,0.75)]"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.08] p-5">
          <div className="flex min-w-0 items-start gap-3">
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-white/[0.055] text-zinc-300">
              <Camera className="size-4" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-white" id={titleId}>
                Ajustar foto do perfil
              </h3>
              <p className="mt-1 text-xs leading-5 text-zinc-500" id={descriptionId}>
                Arraste para posicionar e use o zoom. O que ficar dentro do círculo vira a sua foto.
              </p>
            </div>
          </div>
          <button
            aria-label="Fechar ajuste da foto"
            className="grid size-8 shrink-0 place-items-center rounded-full text-zinc-500 transition hover:bg-white/[0.07] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
            disabled={saving}
            onClick={onCancel}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="p-5">
          <div
            aria-label="Área de recorte. Use as setas para mover e + ou - para o zoom."
            className="relative mx-auto aspect-square w-full max-w-[300px] cursor-grab touch-none select-none overflow-hidden rounded-[8px] border border-white/10 bg-black/25 outline-none active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onKeyDown={handleKeyDown}
            onPointerCancel={() => (drag.current = null)}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={() => (drag.current = null)}
            ref={areaRef}
            role="application"
            style={previewStyle}
            tabIndex={0}
          >
            {/* Mascara redonda: fora do circulo escurece, dentro fica a foto. */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] ring-1 ring-white/40" />
          </div>

          <div className="mx-auto mt-4 flex max-w-[300px] items-center gap-3">
            <ZoomOut aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
            <input
              aria-label="Zoom"
              className="bunker-player-timeline min-w-0 flex-1 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canZoom || saving}
              max={maxZoom}
              min={1}
              onChange={(event) => setState((current) => zoomCrop(size, spec, current, Number(event.target.value)))}
              step={0.01}
              style={{ "--player-progress": `${zoomProgress}%` } as CSSProperties}
              type="range"
              value={state.zoom}
            />
            <ZoomIn aria-hidden="true" className="size-4 shrink-0 text-zinc-500" />
          </div>

          {error ? (
            <p className="mt-3 text-xs font-medium text-red-300" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <MemberButton disabled={saving} onClick={onCancel} type="button" variant="secondary">
              Cancelar
            </MemberButton>
            <MemberButton disabled={saving} onClick={() => void handleSave()} type="button" variant="primary">
              {saving ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : null}
              {saving ? "Salvando…" : "Salvar foto"}
            </MemberButton>
          </div>
        </div>
      </section>
    </div>
  );
}

export function ProfileAvatarEditor({
  avatarUrl,
  children,
  name
}: {
  avatarUrl: string | null;
  /** Nome, e-mail e "Aluno desde", ao lado da foto. */
  children: ReactNode;
  name: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [currentUrl, setCurrentUrl] = useState(avatarUrl);
  const [source, setSource] = useState<CropSource | null>(null);
  const [removing, setRemoving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [syncedFrom, setSyncedFrom] = useState(avatarUrl);

  // Valor novo do servidor (router.refresh ou outra aba): segue o servidor.
  if (syncedFrom !== avatarUrl) {
    setSyncedFrom(avatarUrl);
    setCurrentUrl(avatarUrl);
  }

  useEffect(() => {
    return () => {
      if (source) {
        URL.revokeObjectURL(source.url);
      }
    };
  }, [source]);

  function closeDialog() {
    setSource(null);
    // Depois do proximo quadro (o dialogo ja saiu da tela), o foco volta para a foto.
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    event.target.value = "";
    setStatus(null);

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus({ text: "Escolha um arquivo de imagem (JPG, PNG ou WebP).", tone: "error" });
      return;
    }

    if (file.size > AVATAR_MAX_SOURCE_FILE_BYTES) {
      setStatus({ text: "Esta imagem passa de 20 MB. Escolha uma menor.", tone: "error" });
      return;
    }

    const url = URL.createObjectURL(file);

    try {
      const element = await loadImage(url);

      if (element.naturalWidth < AVATAR_MIN_SOURCE_SIZE || element.naturalHeight < AVATAR_MIN_SOURCE_SIZE) {
        URL.revokeObjectURL(url);
        setStatus({ text: `Esta imagem é pequena demais. Use uma a partir de ${AVATAR_MIN_SOURCE_SIZE}×${AVATAR_MIN_SOURCE_SIZE} px.`, tone: "error" });
        return;
      }

      setSource({ element, height: element.naturalHeight, url, width: element.naturalWidth });
    } catch {
      URL.revokeObjectURL(url);
      setStatus({ text: "Não conseguimos abrir esta imagem. Use JPG, PNG ou WebP.", tone: "error" });
    }
  }

  async function save(dataUrl: string): Promise<string | null> {
    try {
      const response = await fetch("/api/profile/avatar", {
        body: JSON.stringify({ image: dataUrl }),
        headers: { "content-type": "application/json" },
        method: "PUT"
      });

      if (!response.ok) {
        return readError(response, "Não foi possível salvar a foto. Tente de novo.");
      }

      const body = (await response.json()) as { data?: { avatarUrl?: string } };

      setCurrentUrl(body.data?.avatarUrl ?? null);
      setStatus({ text: "Foto atualizada.", tone: "success" });
      closeDialog();
      router.refresh();
      return null;
    } catch {
      return "Sem conexão. Confira a internet e tente de novo.";
    }
  }

  async function remove() {
    setRemoving(true);
    setStatus(null);

    try {
      const response = await fetch("/api/profile/avatar", { method: "DELETE" });

      if (!response.ok) {
        setStatus({ text: await readError(response, "Não foi possível remover a foto. Tente de novo."), tone: "error" });
        return;
      }

      setCurrentUrl(null);
      setStatus({ text: "Foto removida.", tone: "success" });
      router.refresh();
    } catch {
      setStatus({ text: "Sem conexão. Confira a internet e tente de novo.", tone: "error" });
    } finally {
      setRemoving(false);
    }
  }

  // Com o recorte aberto a camada do dialogo cobre a pagina; so a remocao em andamento trava os botoes.
  const busy = removing;

  return (
    <div className="flex min-w-0 items-center gap-4 sm:gap-5">
      <button
        aria-label={currentUrl ? "Alterar foto do perfil" : "Adicionar foto do perfil"}
        className="group relative shrink-0 rounded-full outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-not-allowed"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        ref={triggerRef}
        type="button"
      >
        <MemberAvatar className="max-sm:size-16" imageSrc={currentUrl} name={name} size="xl" />
        <span
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center rounded-full bg-black/45 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
        >
          <Camera className="size-5 text-white" strokeWidth={2.2} />
        </span>
        {/* Botao redondo translucido (docs/12, botoes circulares): borda branca discreta, mais forte no hover. */}
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border border-white/20 bg-[#202020] text-white shadow-[0_6px_18px_rgba(0,0,0,0.55)] ring-2 ring-[#141414] transition-colors duration-150 group-hover:border-white/40 group-hover:bg-[#2a2a2a] sm:size-8"
        >
          {removing ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <Camera className="size-3.5 sm:size-4" strokeWidth={2.2} />}
        </span>
      </button>

      <div className="min-w-0">
        {children}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <MemberButton disabled={busy} onClick={() => inputRef.current?.click()} size="sm" type="button" variant="secondary">
            <Camera strokeWidth={2.2} />
            {currentUrl ? "Alterar foto" : "Adicionar foto"}
          </MemberButton>
          {currentUrl ? (
            <MemberButton disabled={busy} onClick={() => void remove()} size="sm" type="button" variant="ghost">
              {removing ? <LoaderCircle className="motion-safe:animate-spin" /> : <Trash2 strokeWidth={2.2} />}
              {removing ? "Removendo…" : "Remover foto"}
            </MemberButton>
          ) : null}
        </div>
        <p aria-live="polite" className={`mt-2 min-h-4 text-xs font-medium ${status?.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
          {status?.text ?? ""}
        </p>
      </div>

      <input accept="image/jpeg,image/png,image/webp,image/*" className="sr-only" onChange={(event) => void handleFile(event)} ref={inputRef} tabIndex={-1} type="file" />

      {source ? <AvatarCropDialog onCancel={closeDialog} onSave={save} source={source} /> : null}
    </div>
  );
}
