"use client";

import { TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CREATABLE_PRODUCT_FORMATS,
  PRODUCT_AUDIENCES,
  PRODUCT_AUDIENCE_LABELS,
  PRODUCT_FORMAT_LABELS,
  type CreatableProductFormat,
  type ProductAudience
} from "@/server/catalog/model";
import { createProduct } from "@/server/catalog/product-actions";
import { productTitleSchema, purchaseUrlSchema, shortDescriptionSchema } from "@/server/catalog/schemas";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { adminToast } from "../toast";
import { ImageField } from "./image-field";
import { AUDIENCE_HINTS } from "./product-forms";
import { useWarnBeforeUnload } from "./use-warn-before-unload";

// Novo produto em uma pagina (docs/17 §1.6.2): cinco blocos, so o nome e obrigatorio, nasce em
// Rascunho e cai na aba Conteúdo. Meta: 4 interacoes (digitar o nome, Criar produto).

type FieldName = "cover" | "format" | "purchaseUrl" | "shortDescription" | "title";
type FieldErrors = Partial<Record<FieldName, string>>;

type NewProductFormProps = {
  /**
   * Pode decidir quem ve, o link de venda e criar Formação ("regras de acesso e venda"). Sem isso o
   * produto nasce so para quem tiver acesso (o servidor confere de novo).
   */
  canSetAccess: boolean;
  /** "Criar curso aqui" dentro de uma Formação: o curso nasce incluido nela. */
  parentFormation: { id: string; title: string } | null;
};

const DESCRIPTION_LIMIT = 300;

/** Tecla do atalho, como no prototipo (`.kbd`): 20 px, borda forte, fundo 2. */
const kbdClass =
  "inline-grid h-5 min-w-5 place-items-center rounded border border-[var(--border-strong)] bg-[var(--surface-2)] px-1.5 font-sans text-xs font-medium text-[var(--text-secondary)]";

function firstIssue(result: { error?: { issues: { message: string }[] } }) {
  return result.error?.issues[0]?.message ?? null;
}

export function NewProductForm({ canSetAccess, parentFormation }: NewProductFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [format, setFormat] = useState<CreatableProductFormat>("curso");
  const [cover, setCover] = useState<string | null>(null);
  const [shortDescription, setShortDescription] = useState("");
  const [audience, setAudience] = useState<ProductAudience>("with_access");
  const [purchaseUrl, setPurchaseUrl] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState(false);
  const dirty = !created && Boolean(title.trim() || cover || shortDescription.trim() || purchaseUrl.trim());
  const effectiveFormat: CreatableProductFormat = parentFormation ? "curso" : format;
  const showPurchaseUrl = canSetAccess && audience === "with_access" && !parentFormation;
  const formats = canSetAccess ? CREATABLE_PRODUCT_FORMATS : CREATABLE_PRODUCT_FORMATS.filter((value) => value !== "formacao");

  useWarnBeforeUnload(dirty);

  function setFieldError(field: FieldName, message: string | null) {
    setErrors((current) => {
      const next = { ...current };

      if (message) {
        next[field] = message;
      } else {
        delete next[field];
      }

      return next;
    });
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();

    if (submitting) {
      return;
    }

    const titleCheck = productTitleSchema.safeParse(title);

    if (!titleCheck.success) {
      setFieldError("title", firstIssue(titleCheck));
      document.getElementById("produto-nome")?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    const result = await createProduct({
      audience: canSetAccess ? audience : "with_access",
      cover,
      format: effectiveFormat,
      parentFormationId: parentFormation?.id,
      purchaseUrl: showPurchaseUrl ? purchaseUrl.trim() : null,
      shortDescription: shortDescription.trim(),
      title: titleCheck.data
    });

    if (!result.ok) {
      setSubmitting(false);
      const fieldErrors: FieldErrors = {};

      for (const field of ["cover", "format", "purchaseUrl", "shortDescription", "title"] as const) {
        const message = result.fieldErrors?.[field]?.[0];

        if (message) {
          fieldErrors[field] = message;
        }
      }

      setErrors(fieldErrors);

      if (Object.keys(fieldErrors).length === 0) {
        setFormError(result.error);
      }

      return;
    }

    setCreated(true);
    adminToast.success("Produto criado como rascunho");
    router.push(result.data.href);
  }

  return (
    <form
      className="flex w-full max-w-[640px] flex-col gap-6"
      noValidate
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
      onSubmit={(event) => void submit(event)}
    >
      {formError ? <ErrorBanner>{formError}</ErrorBanner> : null}

      <AdminField error={errors.title} id="produto-nome" label="Nome">
        <Input
          aria-describedby={fieldDescribedBy("produto-nome", { error: errors.title })}
          aria-invalid={errors.title ? true : undefined}
          autoComplete="off"
          autoFocus
          className={adminInputClass}
          id="produto-nome"
          maxLength={80}
          onBlur={() => {
            if (title.trim()) {
              setFieldError("title", firstIssue(productTitleSchema.safeParse(title)));
            }
          }}
          onChange={(event) => {
            setTitle(event.target.value);
            if (errors.title && productTitleSchema.safeParse(event.target.value).success) {
              setFieldError("title", null);
            }
          }}
          placeholder={parentFormation || !canSetAccess ? "Ex.: Fundamentos de agentes" : "Ex.: Formação IA para Negócios"}
          value={title}
        />
      </AdminField>

      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-2 text-[13px] leading-5 font-medium text-[var(--text-primary)]">Formato</legend>
        {parentFormation ? (
          <p className="text-sm leading-5 text-[var(--text-secondary)]">
            Curso, dentro da formação <span className="font-medium text-[var(--text-primary)]">{parentFormation.title}</span>. Quem
            tem acesso à formação assiste a ele.
          </p>
        ) : (
          <>
            <PillGroup
              ariaLabel="Formato"
              name="produto-formato"
              onChange={(value) => {
                setFormat(value);
                setFieldError("format", null);
              }}
              options={formats.map((value) => ({ label: PRODUCT_FORMAT_LABELS[value], value }))}
              value={format}
            />
            {errors.format ? (
              <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
                {errors.format}
              </p>
            ) : (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                Gravação de live entra como aula de um curso ou como Material.
              </p>
            )}
          </>
        )}
      </fieldset>

      <ImageField
        error={errors.cover}
        id="produto-capa"
        label="Capa"
        onChange={(value) => {
          setCover(value);
          setFieldError("cover", null);
        }}
        optional
        slot="cover"
        value={cover}
      />

      <AdminField error={errors.shortDescription} id="produto-descricao" label="Descrição curta" optional>
        <textarea
          aria-describedby={fieldDescribedBy("produto-descricao", { error: errors.shortDescription })}
          aria-invalid={errors.shortDescription ? true : undefined}
          className={cn(adminTextareaClass, "min-h-[88px]")}
          id="produto-descricao"
          maxLength={DESCRIPTION_LIMIT}
          onBlur={() => setFieldError("shortDescription", firstIssue(shortDescriptionSchema.safeParse(shortDescription)))}
          onChange={(event) => setShortDescription(event.target.value)}
          placeholder="O que o aluno consegue fazer ao final. Aparece no card e nos detalhes do produto."
          rows={3}
          value={shortDescription}
        />
        <span
          className={cn(
            "self-end text-xs tabular-nums",
            shortDescription.length >= DESCRIPTION_LIMIT - 30 ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]"
          )}
        >
          {shortDescription.length}/{DESCRIPTION_LIMIT}
        </span>
      </AdminField>

      {parentFormation ? null : canSetAccess ? (
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-2 text-[13px] leading-5 font-medium text-[var(--text-primary)]">Quem pode ver</legend>
          <PillGroup
            ariaLabel="Quem pode ver"
            name="produto-quem-pode-ver"
            onChange={setAudience}
            options={PRODUCT_AUDIENCES.map((value) => ({ label: PRODUCT_AUDIENCE_LABELS[value], value }))}
            value={audience}
          />
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{AUDIENCE_HINTS[audience]}</p>
        </fieldset>
      ) : (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
          {AUDIENCE_HINTS.with_access} Quem pode ver e o link de venda ficam com quem cuida de acesso e venda.
        </p>
      )}

      {showPurchaseUrl ? (
        <AdminField error={errors.purchaseUrl} id="produto-link-compra" label="Link de compra" optional>
          <Input
            aria-describedby={fieldDescribedBy("produto-link-compra", { error: errors.purchaseUrl })}
            aria-invalid={errors.purchaseUrl ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            id="produto-link-compra"
            inputMode="url"
            onBlur={() => setFieldError("purchaseUrl", firstIssue(purchaseUrlSchema.safeParse(purchaseUrl.trim())))}
            onChange={(event) => setPurchaseUrl(event.target.value)}
            placeholder="https://pay.hotmart.com/seu-produto"
            type="url"
            value={purchaseUrl}
          />
          {!purchaseUrl.trim() && !errors.purchaseUrl ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-[var(--warning)]">
              <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
              Sem link, o aluno verá “Em breve”.
            </p>
          ) : null}
        </AdminField>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
        <Button aria-keyshortcuts="Meta+Enter Control+Enter" className="h-10! px-4" disabled={submitting} type="submit">
          {submitting ? "Criando…" : parentFormation ? "Criar curso" : "Criar produto"}
        </Button>
        {parentFormation ? (
          <AdminLinkButton href={`/admin/produtos/${parentFormation.id}`} variant="ghost">
            Cancelar
          </AdminLinkButton>
        ) : (
          <AdminLinkButton href="/admin/produtos/importar" variant="ghost">
            Criar a partir de uma playlist do YouTube
          </AdminLinkButton>
        )}
        <span aria-hidden="true" className="ml-auto hidden items-center gap-1.5 text-xs font-medium text-[var(--text-tertiary)] sm:inline-flex">
          <kbd className={kbdClass}>⌘/Ctrl</kbd>
          <kbd className={kbdClass}>Enter</kbd>
          cria
        </span>
      </div>
    </form>
  );
}
