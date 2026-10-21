"use client";

import { ArrowRight, Check, RotateCcw, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { MemberAvatar } from "@/components/member/ui/member-avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MEMBER_BUTTON_OPTIONS,
  MEMBER_CORNER_OPTIONS,
  MEMBER_MENU_OPTIONS,
  normalizeMemberStyle,
  type MemberStyleConfig
} from "@/lib/member-style";
import { cn } from "@/lib/utils";
import { SCHOOL_DEFAULT_ICON, isDefaultSchoolIcon } from "@/server/communications/message-meta";
import {
  DEFAULT_LOGO_IMAGE,
  SCHOOL_ICON_RULES,
  brandToDraft,
  buildAppearancePayload,
  isBrandDirty,
  normalizeBrandingSchoolIcon,
  normalizeHero,
  normalizeLogo,
  schoolIconSizeProblem,
  svgSizeOf,
  validateImageLink,
  type BrandDraft,
  type StorefrontBrand
} from "@/server/storefront/model";
import { AdminField, adminInputClass, adminPillClasses, fieldDescribedBy } from "../form";
import { SaveBar } from "../save-bar";
import { SectionCard } from "../settings/kit";
import { adminToast } from "../toast";
import { IMAGE_ACCEPT, ImageFileError, prepareImageUpload } from "./image-file";

// Marca (docs/17 §1.6.8): a logo, o icone da escola (o circulo das notificacoes que a escola envia, docs/23)
// e o estilo (cantos das capas, botoes, posicao do menu) da area do aluno. Rascunho local ate "Publicar
// marca", que manda so o que mudou pela rota de sempre (PUT /api/admin/appearance). O banner do topo da
// home saiu daqui e foi para Area de membros > Destaque: o rascunho do banner nunca muda nesta tela, entao
// a rota recebe so a logo, o icone e o estilo (e, do seu lado, preserva tudo o que esta gravado no destaque).

type BrandEditorProps = {
  brand: StorefrontBrand;
  canEdit: boolean;
};

const LOGO_LIMITS = { maxHeight: 400, maxWidth: 1200 };
const SCHOOL_ICON_LIMITS = { maxHeight: SCHOOL_ICON_RULES.maxSide, maxWidth: SCHOOL_ICON_RULES.maxSide };
const SVG_TYPE = "image/svg+xml";
const SCHOOL_ICON_TYPES = ["image/png", "image/webp", SVG_TYPE];
const SCHOOL_ICON_ACCEPT = SCHOOL_ICON_TYPES.join(",");
/** O mesmo teto do envio da logo (prepareImageUpload). */
const MAX_ICON_FILE_BYTES = 8 * 1024 * 1024;
const OPEN_IMAGE_TIMEOUT_MS = 8000;

/** Abre a imagem no navegador (para medir ou desenhar); null se nao abrir a tempo. */
function openImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new window.Image();
    const timer = window.setTimeout(() => resolve(null), OPEN_IMAGE_TIMEOUT_MS);
    image.addEventListener("load", () => {
      window.clearTimeout(timer);
      resolve(image);
    });
    image.addEventListener("error", () => {
      window.clearTimeout(timer);
      resolve(null);
    });
    image.src = src;
  });
}

/**
 * SVG enviado vira PNG de 512 × 512 desenhado no navegador: o armazenamento so aceita JPG, PNG e WebP,
 * e um SVG nunca sai daqui como arquivo. A medida vai no proprio SVG porque, sem ela, alguns navegadores
 * nao o desenham no canvas.
 */
async function rasterizeSvg(file: File) {
  const parsed = new DOMParser().parseFromString(await file.text(), SVG_TYPE);
  const root = parsed.documentElement;

  if (root.localName !== "svg" || parsed.getElementsByTagName("parsererror").length > 0) {
    throw new ImageFileError("Não foi possível abrir a imagem. Tente outro arquivo.");
  }

  const size = svgSizeOf({ height: root.getAttribute("height"), viewBox: root.getAttribute("viewBox"), width: root.getAttribute("width") });
  const problem = schoolIconSizeProblem({ ...size, vector: true });

  if (problem) {
    throw new ImageFileError(problem);
  }

  const side = SCHOOL_ICON_RULES.maxSide;

  if (!root.getAttribute("viewBox")) {
    root.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
  }

  root.setAttribute("width", String(side));
  root.setAttribute("height", String(side));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(parsed)], { type: SVG_TYPE }));

  try {
    const image = await openImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const context = canvas.getContext("2d");

    if (!image || !context) {
      throw new ImageFileError("Não foi possível abrir a imagem. Tente outro arquivo.");
    }

    context.drawImage(image, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));

    if (!blob) {
      throw new ImageFileError("Não foi possível preparar a imagem. Tente outro arquivo.");
    }

    return new File([blob], "icone-da-escola.png", { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Icone enviado: PNG, WebP ou SVG, quadrado e com 128 px ou mais; sai reduzido a 512 × 512 (WebP). */
async function prepareSchoolIconUpload(file: File) {
  if (!SCHOOL_ICON_TYPES.includes(file.type)) {
    throw new ImageFileError("Formato não aceito. Use PNG, WebP ou SVG.");
  }

  if (file.size > MAX_ICON_FILE_BYTES) {
    throw new ImageFileError("A imagem passa de 8 MB. Escolha um arquivo menor.");
  }

  if (file.type === SVG_TYPE) {
    return prepareImageUpload(await rasterizeSvg(file), SCHOOL_ICON_LIMITS);
  }

  const url = URL.createObjectURL(file);

  try {
    const image = await openImage(url);

    if (!image) {
      throw new ImageFileError("Não foi possível abrir a imagem. Tente outro arquivo.");
    }

    const problem = schoolIconSizeProblem({ height: image.naturalHeight, width: image.naturalWidth });

    if (problem) {
      throw new ImageFileError(problem);
    }
  } finally {
    URL.revokeObjectURL(url);
  }

  return prepareImageUpload(file, SCHOOL_ICON_LIMITS);
}

type SchoolIconCircleProps = {
  large?: boolean;
  src: string;
};

/**
 * O circulo como o sino desenha (40 px) e uma versao de 64 px: o simbolo padrao centralizado, uma imagem
 * enviada preenchendo como foto de perfil. Imagem que nao abre (link quebrado): a inicial da escola.
 */
function SchoolIconCircle({ large = false, src }: SchoolIconCircleProps) {
  const [failed, setFailed] = useState<string | null>(null);

  if (failed === src) {
    return <MemberAvatar className={large ? "size-16" : undefined} name="Bunker707" size={large ? "xl" : "md"} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[#262626] text-white ring-1 ring-white/10",
        large ? "size-16" : "size-10"
      )}
    >
      <Image
        alt=""
        className={isDefaultSchoolIcon(src) ? cn("object-contain", large ? "p-3" : "p-2") : "object-cover"}
        fill
        onError={() => setFailed(src)}
        sizes={large ? "64px" : "40px"}
        src={src}
        unoptimized
      />
    </span>
  );
}

type LinkFieldProps = {
  disabled: boolean;
  id: string;
  label: string;
  onApply: (link: string) => void;
};

/** "Ou cole o link": aplica so com link valido; erro abaixo do campo. */
function LinkField({ disabled, id, label, onApply }: LinkFieldProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function apply() {
    const problem = validateImageLink(value);

    if (problem) {
      setError(problem);
      return;
    }

    onApply(value.trim());
    setValue("");
    setError(null);
  }

  return (
    <AdminField error={error} id={id} label={label} optional>
      <div className="flex min-w-0 gap-2">
        <Input
          aria-describedby={fieldDescribedBy(id, { error })}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          className={adminInputClass}
          disabled={disabled}
          id={id}
          inputMode="url"
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              apply();
            }
          }}
          placeholder="https://"
          spellCheck={false}
          value={value}
        />
        <Button className="shrink-0 px-4" disabled={disabled} onClick={apply} type="button" variant="secondary">
          Aplicar
        </Button>
      </div>
    </AdminField>
  );
}

type StyleChoiceProps<Value extends string> = {
  disabled: boolean;
  label: string;
  name: string;
  onChange: (value: Value) => void;
  options: ReadonlyArray<{ description: string; label: string; value: Value }>;
  value: Value;
};

/** Escolha de estilo em pilulas (radios nativos por baixo); a frase da opcao marcada fica embaixo. */
function StyleChoice<Value extends string>({ disabled, label, name, onChange, options, value }: StyleChoiceProps<Value>) {
  const current = options.find((option) => option.value === value);

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" disabled={disabled}>
      <legend className="text-sm leading-5 font-medium text-[var(--text-primary)]">{label}</legend>
      <div className="flex flex-wrap gap-1.5" role="radiogroup">
        {options.map((option) => {
          const checked = option.value === value;

          return (
            <label
              className={cn(
                adminPillClasses(checked),
                "has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
                disabled && "cursor-not-allowed opacity-60"
              )}
              key={option.value}
            >
              <input checked={checked} className="sr-only" name={name} onChange={() => onChange(option.value)} type="radio" value={option.value} />
              {checked ? <Check aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              {option.label}
            </label>
          );
        })}
      </div>
      {current ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{current.description}</p> : null}
    </fieldset>
  );
}

type UploadButtonProps = {
  accept?: string;
  disabled: boolean;
  label: string;
  onFile: (file: File) => void;
};

/** Botao de arquivo com a aparencia do Button secundario (o input fica escondido dentro do label). */
function UploadButton({ accept = IMAGE_ACCEPT, disabled, label, onFile }: UploadButtonProps) {
  const id = useId();

  return (
    <label
      aria-disabled={disabled || undefined}
      className={cn(
        buttonVariants({ variant: "secondary" }),
        "cursor-pointer border-[var(--border-strong)] px-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-[var(--focus-ring)]",
        disabled && "pointer-events-none opacity-60"
      )}
      data-slot="button"
      htmlFor={id}
    >
      <Upload aria-hidden="true" className="size-4" />
      {label}
      <input
        accept={accept}
        className="sr-only"
        disabled={disabled}
        id={id}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          const file = event.target.files?.[0];
          event.target.value = "";

          if (file) {
            onFile(file);
          }
        }}
        type="file"
      />
    </label>
  );
}

export function BrandEditor({ brand, canEdit }: BrandEditorProps) {
  const router = useRouter();
  const [published, setPublished] = useState<BrandDraft>(() => brandToDraft(brand));
  const [draft, setDraft] = useState<BrandDraft>(published);
  const [busy, setBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [iconBusy, setIconBusy] = useState(false);
  const [iconError, setIconError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = canEdit && isBrandDirty(published, draft);

  useEffect(() => {
    if (!dirty) {
      return;
    }

    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
    }

    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function change(next: Partial<BrandDraft>) {
    setDraft((current) => ({ ...current, ...next }));
    setSaveError(null);
  }

  function changeStyle(next: Partial<MemberStyleConfig>) {
    setDraft((current) => ({ ...current, style: { ...current.style, ...next } }));
    setSaveError(null);
  }

  async function handleLogoFile(file: File) {
    setBusy(true);
    setLogoError(null);

    try {
      change({ logoImage: await prepareImageUpload(file, LOGO_LIMITS) });
    } catch (error) {
      setLogoError(error instanceof ImageFileError ? error.message : "Não foi possível preparar a imagem. Tente outro arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleIconFile(file: File) {
    setIconBusy(true);
    setIconError(null);

    try {
      change({ schoolIcon: await prepareSchoolIconUpload(file) });
    } catch (error) {
      setIconError(error instanceof ImageFileError ? error.message : "Não foi possível preparar a imagem. Tente outro arquivo.");
    } finally {
      setIconBusy(false);
    }
  }

  /**
   * Link colado: confere a proporcao quando a imagem abre aqui. SVG nao e medido (sem largura e altura
   * proprias o navegador inventa uma medida); link que nao abre fica na previa, e o sino cai na logo ou
   * na inicial da escola.
   */
  async function handleIconLink(link: string) {
    setIconBusy(true);
    setIconError(null);

    try {
      const image = /\.svg([?#]|$)/i.test(link) ? null : await openImage(link);
      const problem =
        image && image.naturalWidth > 0 && image.naturalHeight > 0
          ? schoolIconSizeProblem({ height: image.naturalHeight, width: image.naturalWidth })
          : null;

      if (problem) {
        setIconError(problem);
        return;
      }

      change({ schoolIcon: link });
    } finally {
      setIconBusy(false);
    }
  }

  async function save() {
    if (!canEdit || saving) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/admin/appearance", {
        body: JSON.stringify(buildAppearancePayload(published, draft)),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = (await response.json().catch(() => ({}))) as { data?: { branding?: unknown; hero?: unknown }; error?: string };

      if (!response.ok || !payload.data) {
        throw new Error(payload.error || "Não foi possível publicar a marca.");
      }

      const next = brandToDraft({
        hero: normalizeHero(payload.data.hero),
        logoImage: normalizeLogo(payload.data.branding, true),
        schoolIcon: normalizeBrandingSchoolIcon(payload.data.branding),
        style: normalizeMemberStyle(payload.data.branding)
      });
      setPublished(next);
      setDraft(next);
      adminToast.success("Marca publicada. Os alunos já veem o novo visual.");
      router.refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível publicar a marca.");
    } finally {
      setSaving(false);
    }
  }

  const locked = !canEdit || saving;

  return (
    <div className="flex w-full max-w-[720px] min-w-0 flex-col gap-6">
      {!canEdit ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          Só o dono, um administrador ou um editor pode mudar a marca. Você está vendo a versão atual.
        </p>
      ) : null}

      <p className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
        A imagem do topo da home agora fica em Destaque.
        <Link
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
          href="/admin/area-de-membros/destaque"
        >
          Abrir Destaque
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </p>

      <SectionCard description="Aparece no topo, no menu e no rodapé da área do aluno. Prefira PNG ou WebP com fundo transparente." title="Logo">
        <div className="flex flex-col gap-5">
          <div className="flex min-h-24 items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-0)] px-5 py-4">
            {draft.logoImage ? (
              <Image
                alt="Prévia da logo"
                className="h-auto max-h-14 w-auto max-w-[260px] object-contain object-left"
                height={56}
                src={draft.logoImage}
                unoptimized
                width={260}
              />
            ) : (
              <span className="flex flex-col">
                <span className="text-lg leading-7 font-semibold tracking-wide text-[var(--text-primary)] uppercase">Bunker707</span>
                <span className="text-xs leading-5 text-[var(--text-secondary)]">Sem logo, o nome da escola aparece em texto.</span>
              </span>
            )}
          </div>

          {logoError ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
              {logoError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <UploadButton disabled={locked || busy} label={busy ? "Preparando…" : "Enviar logo"} onFile={(file) => void handleLogoFile(file)} />
            <Button
              className="px-3 text-[var(--text-secondary)]"
              disabled={locked || draft.logoImage === DEFAULT_LOGO_IMAGE}
              onClick={() => change({ logoImage: DEFAULT_LOGO_IMAGE })}
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Usar a logo padrão
            </Button>
            <Button
              className="px-3 text-[var(--text-secondary)]"
              disabled={locked || draft.logoImage === null}
              onClick={() => change({ logoImage: null })}
              type="button"
              variant="ghost"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Tirar a logo
            </Button>
          </div>

          <LinkField disabled={locked} id="marca-logo-link" label="Ou cole o link da logo" onApply={(link) => change({ logoImage: link })} />
        </div>
      </SectionCard>

      <SectionCard description="Aparece no círculo das notificações que a escola envia. Use uma imagem quadrada." title="Ícone da escola">
        <div className="flex flex-col gap-5">
          <div
            aria-label="Prévia do ícone da escola"
            className="flex min-h-24 items-center gap-5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-0)] px-5 py-4"
            role="img"
          >
            <SchoolIconCircle src={draft.schoolIcon} />
            <SchoolIconCircle large src={draft.schoolIcon} />
          </div>

          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            A imagem preenche o círculo, como uma foto de perfil. O símbolo padrão fica centralizado.
          </p>

          {iconError ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
              {iconError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <UploadButton
              accept={SCHOOL_ICON_ACCEPT}
              disabled={locked || iconBusy}
              label={iconBusy ? "Preparando…" : "Enviar imagem"}
              onFile={(file) => void handleIconFile(file)}
            />
            <Button
              className="px-3 text-[var(--text-secondary)]"
              disabled={locked || iconBusy || isDefaultSchoolIcon(draft.schoolIcon)}
              onClick={() => {
                change({ schoolIcon: SCHOOL_DEFAULT_ICON });
                setIconError(null);
              }}
              type="button"
              variant="ghost"
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              Usar o símbolo padrão
            </Button>
          </div>

          <LinkField
            disabled={locked || iconBusy}
            id="marca-icone-link"
            label="Ou cole o link do ícone"
            onApply={(link) => void handleIconLink(link)}
          />
        </div>
      </SectionCard>

      <SectionCard description="Vale para toda a área do aluno. Publique para os alunos verem." title="Estilo">
        <div className="flex flex-col gap-6">
          <StyleChoice
            disabled={locked}
            label="Cantos das capas"
            name="marca-estilo-cantos"
            onChange={(corners) => changeStyle({ corners })}
            options={MEMBER_CORNER_OPTIONS}
            value={draft.style.corners}
          />
          <StyleChoice
            disabled={locked}
            label="Botões"
            name="marca-estilo-botoes"
            onChange={(buttons) => changeStyle({ buttons })}
            options={MEMBER_BUTTON_OPTIONS}
            value={draft.style.buttons}
          />
          <StyleChoice
            disabled={locked}
            label="Menu"
            name="marca-estilo-menu"
            onChange={(menu) => changeStyle({ menu })}
            options={MEMBER_MENU_OPTIONS}
            value={draft.style.menu}
          />
        </div>
      </SectionCard>

      <SaveBar
        error={saveError}
        message="Alterações não publicadas"
        onDiscard={() => {
          setDraft(published);
          setSaveError(null);
          setLogoError(null);
          setIconError(null);
        }}
        onSave={() => void save()}
        open={dirty}
        saveLabel="Publicar marca"
        saving={saving}
      />
    </div>
  );
}
