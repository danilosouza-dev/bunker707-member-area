"use client";

import { ArrowRight, Check, RotateCcw, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type ChangeEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  MEMBER_BUTTON_OPTIONS,
  MEMBER_CORNER_OPTIONS,
  MEMBER_COVER_SIZE_OPTIONS,
  MEMBER_MENU_OPTIONS,
  normalizeMemberStyle,
  type MemberStyleConfig
} from "@/lib/member-style";
import { cn } from "@/lib/utils";
import {
  DEFAULT_LOGO_IMAGE,
  brandToDraft,
  buildAppearancePayload,
  isBrandDirty,
  normalizeHero,
  normalizeLogo,
  validateImageLink,
  type BrandDraft,
  type StorefrontBrand
} from "@/server/storefront/model";
import { AdminField, adminInputClass, adminPillClasses, fieldDescribedBy } from "../form";
import { SaveBar } from "../save-bar";
import { SectionCard } from "../settings/kit";
import { adminToast } from "../toast";
import { IMAGE_ACCEPT, ImageFileError, prepareImageUpload } from "./image-file";

// Marca (docs/17 §1.6.8): a logo e o estilo (cantos das capas, botoes, posicao do menu) da area do aluno. Rascunho local ate "Publicar marca", que manda so o
// que mudou pela rota de sempre (PUT /api/admin/appearance). O banner do topo da home saiu daqui e foi
// para Area de membros > Destaque: o rascunho do banner nunca muda nesta tela, entao a rota recebe so
// a logo (e, do seu lado, preserva tudo o que esta gravado no destaque).

type BrandEditorProps = {
  brand: StorefrontBrand;
  canEdit: boolean;
};

const LOGO_LIMITS = { maxHeight: 400, maxWidth: 1200 };

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
  disabled: boolean;
  label: string;
  onFile: (file: File) => void;
};

/** Botao de arquivo com a aparencia do Button secundario (o input fica escondido dentro do label). */
function UploadButton({ disabled, label, onFile }: UploadButtonProps) {
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
        accept={IMAGE_ACCEPT}
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
            label="Thumbnails dos cards"
            name="marca-estilo-capas"
            onChange={(coverSize) => changeStyle({ coverSize })}
            options={MEMBER_COVER_SIZE_OPTIONS}
            value={draft.style.coverSize}
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
        }}
        onSave={() => void save()}
        open={dirty}
        saveLabel="Publicar marca"
        saving={saving}
      />
    </div>
  );
}
