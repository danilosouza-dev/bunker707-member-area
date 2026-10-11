"use client";

import { RotateCcw } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_LOGIN_VISUAL_IMAGE, isSplitLoginTemplate, type LoginPanelTone } from "@/lib/login-config";
import { cn } from "@/lib/utils";
import { uploadMemberAreaImage } from "@/server/member-area/image-actions";
import { saveLoginPage } from "@/server/member-area/login-actions";
import {
  LOGIN_TEXT_LIMITS,
  LOGIN_TONE_OPTIONS,
  applyLoginTemplate,
  defaultLoginPageSettings,
  isLoginSettingsEqual,
  loginFieldErrors,
  loginImageKeyFor,
  loginImageSlotFor,
  loginPageSettingsSchema,
  loginToneHint,
  parseSupportLinkInput,
  rebaseLoginDraft,
  resolveLoginPageConfig,
  supportLinkInputValue,
  type LoginImageSettings,
  type LoginPageSettings
} from "@/server/member-area/login-model";
import type { LoginEditorData } from "@/server/member-area/login-queries";
import { memberAreaImageRefSchema } from "@/server/member-area/schemas";
import { ErrorBanner } from "../../error-banner";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../form";
import { FieldLegend, FormSection } from "../../products/form-section";
import { ImageField } from "../../products/image-field";
import { useWarnBeforeUnload } from "../../products/use-warn-before-unload";
import { SaveBar } from "../../save-bar";
import { AdminSwitch } from "../../settings/kit";
import { adminToast } from "../../toast";
import { LoginPreviewPanel } from "./login-preview";
import { TemplateGallery } from "./template-gallery";

// Area de membros > Login (/admin/area-de-membros/login): escolher um dos 4 modelos prontos, editar so o
// que o modelo usa, ver a previa real (computador e celular) e publicar em platform_settings.loginPage.
// Rascunho local ate "Publicar login"; as imagens sobem ao Storage logo depois do recorte e o rascunho
// guarda so a URL. O /login passa a mostrar o publicado na proxima visita.

type LoginEditorProps = {
  canEdit: boolean;
  data: LoginEditorData;
};

type ImageKey = "backgroundImage" | "sideImage";
type TextKey = "formSubtitle" | "formTitle" | "quote" | "quoteDetail" | "supportLabel" | "supportLinkLabel";
type Failure = { message: string; status: number };
type Published = { settings: LoginPageSettings; updatedAt: string | null };

const PUBLISHED_TOAST = "Login publicado. Quem abrir a página de entrar já vê o novo visual.";
const UNDO_OUTDATED = "Não foi possível desfazer: já existe uma publicação mais nova do login.";
const SUPPORT_LINK_HINT =
  "Um endereço que comece com https:// (WhatsApp, central de ajuda) ou um e-mail. Sem link, essa linha não aparece no login.";

function issuesToErrors(issues: readonly { message: string; path: readonly PropertyKey[] }[]) {
  const result: Record<string, string> = {};

  for (const issue of issues) {
    const key = issue.path.map(String).join(".");

    if (key && !result[key]) {
      result[key] = issue.message;
    }
  }

  return result;
}

/** "sideImage.url" e "backgroundImage.url" vao para o campo de imagem; o resto fica por campo. */
function splitImageErrors(errors: Record<string, string>) {
  const fields: Record<string, string> = {};
  const images: Partial<Record<ImageKey, string>> = {};

  for (const [key, message] of Object.entries(errors)) {
    const image = /^(sideImage|backgroundImage)\.url$/.exec(key)?.[1] as ImageKey | undefined;

    if (image) {
      images[image] = message;
    } else {
      fields[key] = message;
    }
  }

  return { fields, images };
}

function CharCount({ max, value }: { max: number; value: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("self-end text-xs tabular-nums", value.length >= max - Math.ceil(max * 0.1) ? "text-[var(--warning)]" : "text-[var(--text-tertiary)]")}
    >
      {value.length}/{max}
    </span>
  );
}

type TextFieldProps = {
  disabled: boolean;
  error?: string;
  hint?: ReactNode;
  id: string;
  label: string;
  max: number;
  multiline?: boolean;
  onBlur?: () => void;
  onChange: (value: string) => void;
  optional?: boolean;
  placeholder?: string;
  value: string;
};

function TextField({ disabled, error, hint, id, label, max, multiline = false, onBlur, onChange, optional = true, placeholder, value }: TextFieldProps) {
  const describedBy = fieldDescribedBy(id, { error, hint });
  const shared = {
    "aria-describedby": describedBy,
    "aria-invalid": error ? true : undefined,
    disabled,
    id,
    maxLength: max,
    onBlur,
    placeholder,
    value
  };

  return (
    <AdminField error={error} hint={hint} id={id} label={label} optional={optional}>
      {multiline ? (
        <textarea {...shared} className={cn(adminTextareaClass, "min-h-[72px]")} onChange={(event) => onChange(event.target.value)} rows={2} />
      ) : (
        <Input {...shared} autoComplete="off" className={adminInputClass} onChange={(event) => onChange(event.target.value)} />
      )}
      <CharCount max={max} value={value} />
    </AdminField>
  );
}

export function LoginEditor({ canEdit, data }: LoginEditorProps) {
  const router = useRouter();
  const [source, setSource] = useState(data);
  const [published, setPublished] = useState<Published>({ settings: data.settings, updatedAt: data.updatedAt });
  const [draft, setDraft] = useState<LoginPageSettings>(data.settings);
  const [linkText, setLinkText] = useState(() => supportLinkInputValue(data.settings.supportHref));
  const [storedInvalid, setStoredInvalid] = useState(data.storedWasInvalid);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageErrors, setImageErrors] = useState<Partial<Record<ImageKey, string>>>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<ImageKey | null>(null);
  const latest = useRef({ draft, linkText });
  // Toast com "Desfazer" da ultima publicacao: some quando ha uma publicacao mais nova.
  const undoToast = useRef<string | number | null>(null);
  const linkParse = parseSupportLinkInput(linkText);
  const effective: LoginPageSettings = linkParse.ok ? { ...draft, supportHref: linkParse.href } : draft;
  // So o que o produtor mudou abre a barra. Configuracao salva invalida tem aviso e botao proprios.
  const dirty = canEdit && (!linkParse.ok || !isLoginSettingsEqual(published.settings, effective));
  const locked = !canEdit || saving;
  const split = isSplitLoginTemplate(draft.template);
  const imageKey = loginImageKeyFor(draft.template);
  const imageSlot = loginImageSlotFor(draft.template);
  const image = draft[imageKey];
  const previewConfig = resolveLoginPageConfig(effective, { logoImage: data.logoImage });
  const hasFieldErrors = Object.keys(errors).length > 0 || Object.values(imageErrors).some(Boolean);

  // Versao nova do servidor (Recarregar depois de um conflito): segue o servidor sem perder o que mudou.
  if (source !== data) {
    const nextDraft = rebaseLoginDraft(published.settings, effective, data.settings);

    setSource(data);
    setPublished({ settings: data.settings, updatedAt: data.updatedAt });
    setDraft(nextDraft);
    setStoredInvalid(data.storedWasInvalid);
    setFailure(null);

    if (linkParse.ok) {
      setLinkText(supportLinkInputValue(nextDraft.supportHref));
    }
  }

  useEffect(() => {
    latest.current = { draft, linkText };
  });

  useWarnBeforeUnload(dirty);

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function clearSoftFailure() {
    setFailure((current) => (current && current.status !== 409 ? null : current));
  }

  function update<Key extends keyof LoginPageSettings>(key: Key, value: LoginPageSettings[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearError(key);
    clearSoftFailure();
  }

  function updateImage(key: ImageKey, patch: Partial<LoginImageSettings>) {
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
    clearError(`${key}.alt`);
    clearSoftFailure();
  }

  function replaceDraft(next: LoginPageSettings) {
    setDraft(next);
    setLinkText(supportLinkInputValue(next.supportHref));
    setErrors({});
    setImageErrors({});
    clearSoftFailure();
  }

  function checkText(key: TextKey) {
    const result = loginPageSettingsSchema.shape[key].safeParse(draft[key]);

    if (!result.success) {
      setErrors((current) => ({ ...current, [key]: result.error.issues[0]?.message ?? "Valor inválido." }));
    }
  }

  function checkLink() {
    if (!linkParse.ok) {
      setErrors((current) => ({ ...current, supportHref: linkParse.message }));
    }
  }

  async function changeImage(key: ImageKey, value: string | null) {
    setImageErrors((current) => ({ ...current, [key]: undefined }));

    if (value === null) {
      updateImage(key, { url: null });
      return;
    }

    if (value.startsWith("data:")) {
      setUploading(key);
      const result = await uploadMemberAreaImage({ image: value, slot: key === "sideImage" ? "loginSide" : "loginBackground" });
      setUploading(null);

      if (!result.ok) {
        setImageErrors((current) => ({ ...current, [key]: result.fieldErrors?.image?.[0] ?? result.error }));
        return;
      }

      updateImage(key, { url: result.data.url });
      return;
    }

    // Link colado que o navegador nao deixou recortar: vale como esta, se for https.
    const link = memberAreaImageRefSchema.safeParse(value);

    if (!link.success) {
      setImageErrors((current) => ({ ...current, [key]: link.error.issues[0]?.message ?? "Use um link que comece com https://." }));
      return;
    }

    updateImage(key, { url: link.data });
  }

  function applyFailure(result: { error: string; fieldErrors?: Record<string, string[]>; status: number }) {
    const { fields, images } = splitImageErrors(loginFieldErrors(result.fieldErrors));

    if (Object.keys(fields).length > 0 || Object.keys(images).length > 0) {
      setErrors(fields);
      setImageErrors(images);
      setFailure(null);
      return;
    }

    setFailure({ message: result.error, status: result.status });
  }

  async function undoPublish(previous: LoginPageSettings, version: string, justPublished: LoginPageSettings) {
    setSaving(true);
    setFailure(null);
    const result = await saveLoginPage({ expectedUpdatedAt: version, settings: previous });
    setSaving(false);

    if (!result.ok) {
      if (result.status === 409) {
        // Toast velho (alguem publicou depois): nao e conflito da tela, so nao ha mais o que desfazer.
        setFailure({ message: UNDO_OUTDATED, status: 0 });
        return;
      }

      applyFailure(result);
      return;
    }

    setPublished({ settings: result.data.settings, updatedAt: result.data.updatedAt });

    // Se o produtor nao mexeu em nada depois de publicar, o rascunho volta junto.
    const current = latest.current;
    const currentLink = parseSupportLinkInput(current.linkText);
    const currentEffective = currentLink.ok ? { ...current.draft, supportHref: currentLink.href } : current.draft;

    if (isLoginSettingsEqual(currentEffective, justPublished)) {
      replaceDraft(result.data.settings);
    }

    adminToast.success("Login voltou para a versão anterior.");
    // Atualiza o cache do roteador: voltar para esta aba mostra a versao que esta no ar.
    router.refresh();
  }

  async function publish() {
    if (!canEdit || saving) {
      return;
    }

    if (uploading) {
      setFailure({ message: "Espere a imagem terminar de enviar e publique de novo.", status: 400 });
      return;
    }

    if (!linkParse.ok) {
      setErrors((current) => ({ ...current, supportHref: linkParse.message }));
      setFailure(null);
      return;
    }

    const parsed = loginPageSettingsSchema.safeParse(effective);

    if (!parsed.success) {
      const { fields, images } = splitImageErrors(issuesToErrors(parsed.error.issues));
      setErrors(fields);
      setImageErrors(images);
      setFailure(null);
      return;
    }

    const previous = published;
    setSaving(true);
    setFailure(null);
    const result = await saveLoginPage({ expectedUpdatedAt: previous.updatedAt, settings: parsed.data });
    setSaving(false);

    if (!result.ok) {
      applyFailure(result);
      return;
    }

    const saved = result.data;
    setPublished({ settings: saved.settings, updatedAt: saved.updatedAt });
    setStoredInvalid(false);
    replaceDraft(saved.settings);

    if (undoToast.current !== null) {
      adminToast.dismiss(undoToast.current);
    }

    undoToast.current = adminToast.success(PUBLISHED_TOAST, {
      onUndo: () => void undoPublish(previous.settings, saved.updatedAt, saved.settings)
    });
    // Atualiza o cache do roteador: voltar para esta aba (botao Voltar) mostra o que acabou de ser
    // publicado, e nao a versao de antes (que daria 409 no proximo Publicar).
    router.refresh();
  }

  const saveBarError =
    failure?.status === 409
      ? "Recarregue a página para publicar."
      : failure?.message ?? (hasFieldErrors ? "Revise os campos destacados." : null);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {!canEdit ? (
        <p className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3 text-sm leading-5 text-[var(--text-secondary)]">
          Só o dono, um administrador ou um editor pode mudar o login. Você está vendo a versão atual.
        </p>
      ) : null}

      {canEdit && storedInvalid ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] px-4 py-3"
          role="status"
        >
          <p className="min-w-0 flex-1 text-sm leading-5 text-[var(--text-secondary)]">
            A configuração salva estava incompleta; mostramos o padrão. Publique para corrigir.
          </p>
          {!dirty ? (
            <Button className="px-3" disabled={uploading !== null} onClick={() => void publish()} type="button" variant="secondary">
              {saving ? "Publicando…" : "Publicar o padrão"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {failure && failure.status !== 409 && !dirty ? (
        <ErrorBanner title="O login não mudou">{failure.message}</ErrorBanner>
      ) : null}

      {failure?.status === 409 ? (
        <ErrorBanner
          action={
            <Button className="px-3" onClick={() => router.refresh()} type="button" variant="secondary">
              Recarregar
            </Button>
          }
          title="O login mudou em outra tela"
        >
          {failure.message} O que você mudou aqui continua no rascunho.
        </ErrorBanner>
      ) : null}

      <div className="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <section aria-labelledby="login-modelo-titulo" className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
          <header className="min-w-0">
            <h2 className="text-base leading-6 font-semibold text-[var(--text-primary)]" id="login-modelo-titulo">
              Modelo
            </h2>
            <p className="mt-0.5 text-[13px] leading-5 text-[var(--text-secondary)]">
              Escolha como a página de entrar fica organizada. Os textos e as imagens que você editar valem para o modelo escolhido.
            </p>
          </header>
          <TemplateGallery
            disabled={locked}
            draft={effective}
            labelledBy="login-modelo-titulo"
            logoImage={data.logoImage}
            onChange={(template) => {
              setDraft((current) => applyLoginTemplate(current, template));
              clearSoftFailure();
            }}
            publishedTemplate={published.settings.template}
          />
        </section>

        <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch">
          <LoginPreviewPanel className="lg:sticky lg:top-[72px]" config={previewConfig} />
        </div>

        <div className="flex min-w-0 flex-col gap-8 lg:col-start-1 lg:row-start-2">
          <FormSection
            className="first:border-t first:pt-6"
            description={
              split
                ? "Aparece ao lado do formulário no computador e escurecida atrás dele no celular."
                : "Ocupa a tela toda, atrás do formulário translúcido."
            }
            title="Imagem"
          >
            <ImageField
              error={imageErrors[imageKey]}
              id={`login-${imageSlot}`}
              key={imageKey}
              label={split ? "Imagem lateral" : "Imagem de fundo"}
              onChange={(value) => void changeImage(imageKey, value)}
              optional
              pending={uploading === imageKey}
              readOnly={!canEdit}
              slot={imageSlot}
              value={image.url}
            />
            {image.url ? (
              canEdit ? (
                <div>
                  <Button
                    className="px-3 text-[var(--text-secondary)]"
                    disabled={locked || uploading !== null}
                    onClick={() => {
                      setImageErrors((current) => ({ ...current, [imageKey]: undefined }));
                      updateImage(imageKey, { url: null });
                    }}
                    type="button"
                    variant="ghost"
                  >
                    <RotateCcw aria-hidden="true" className="size-4" />
                    Usar a imagem padrão
                  </Button>
                </div>
              ) : null
            ) : (
              <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-2 pr-3">
                <Image
                  alt=""
                  className="h-10 w-15 shrink-0 rounded-md object-cover"
                  height={40}
                  sizes="60px"
                  src={DEFAULT_LOGIN_VISUAL_IMAGE}
                  width={60}
                />
                <p className="min-w-0 text-[13px] leading-5 text-[var(--text-secondary)]">
                  Usando a imagem padrão (o astronauta). {canEdit ? "Envie outra para trocar." : null}
                </p>
              </div>
            )}
            <TextField
              disabled={locked}
              error={errors[`${imageKey}.alt`]}
              hint="Uma frase curta sobre o que aparece na imagem. Leitores de tela leem esse texto."
              id="login-imagem-descricao"
              label="Descrição da imagem (para leitores de tela)"
              max={LOGIN_TEXT_LIMITS.imageAlt}
              onChange={(value) => updateImage(imageKey, { alt: value })}
              placeholder={image.url ? "Ex.: Mesa com notebook e luz vermelha" : "Astronauta em ambiente escuro com circuitos de IA em vermelho"}
              value={image.alt}
            />
          </FormSection>

          {split ? (
            <FormSection description="Fica sobre a imagem, no canto de baixo. Só aparece no computador." title="Frase da imagem">
              <TextField
                disabled={locked}
                error={errors.quote}
                hint="Deixe vazio para mostrar só a imagem."
                id="login-frase"
                label="Frase"
                max={LOGIN_TEXT_LIMITS.quote}
                multiline
                onBlur={() => checkText("quote")}
                onChange={(value) => update("quote", value)}
                value={draft.quote}
              />
              <TextField
                disabled={locked}
                error={errors.quoteDetail}
                id="login-frase-apoio"
                label="Texto de apoio"
                max={LOGIN_TEXT_LIMITS.quoteDetail}
                multiline
                onBlur={() => checkText("quoteDetail")}
                onChange={(value) => update("quoteDetail", value)}
                value={draft.quoteDetail}
              />
            </FormSection>
          ) : null}

          <FormSection description="O cartão com os campos de e-mail e senha." title="Formulário">
            <fieldset className="flex min-w-0 flex-col gap-1.5">
              <FieldLegend>Tom do painel</FieldLegend>
              <PillGroup
                ariaLabel="Tom do painel"
                disabled={locked}
                name="login-tom"
                onChange={(value: LoginPanelTone) => update("panelTone", value)}
                options={LOGIN_TONE_OPTIONS}
                value={draft.panelTone}
              />
              <p className="text-xs leading-5 text-[var(--text-secondary)]">{loginToneHint(draft.panelTone, draft.template)}</p>
            </fieldset>
            <TextField
              disabled={locked}
              error={errors.formTitle}
              hint="Aparece abaixo da logo. Deixe vazio para mostrar só a logo."
              id="login-titulo"
              label="Título"
              max={LOGIN_TEXT_LIMITS.formTitle}
              onBlur={() => checkText("formTitle")}
              onChange={(value) => update("formTitle", value)}
              placeholder="Ex.: Bem-vindo de volta"
              value={draft.formTitle}
            />
            <TextField
              disabled={locked}
              error={errors.formSubtitle}
              id="login-subtitulo"
              label="Texto abaixo do título"
              max={LOGIN_TEXT_LIMITS.formSubtitle}
              multiline
              onBlur={() => checkText("formSubtitle")}
              onChange={(value) => update("formSubtitle", value)}
              placeholder="Ex.: Entre com o e-mail que você usou na compra."
              value={draft.formSubtitle}
            />
          </FormSection>

          <FormSection title="Entrar com Google">
            <AdminSwitch
              checked={draft.googleEnabled}
              description={
                draft.googleEnabled
                  ? "O botão aparece abaixo de Entrar. Quem tem conta Google com o mesmo e-mail entra com um clique."
                  : "O aluno entra só com e-mail e senha."
              }
              disabled={locked}
              id="login-google"
              label="Mostrar o botão Entrar com Google"
              onCheckedChange={(checked) => update("googleEnabled", checked)}
            />
          </FormSection>

          <FormSection description="A linha de ajuda no fim do formulário, para quem ainda não consegue entrar." title="Ajuda">
            <TextField
              disabled={locked}
              error={errors.supportLabel}
              id="login-ajuda-pergunta"
              label="Pergunta"
              max={LOGIN_TEXT_LIMITS.supportLabel}
              onBlur={() => checkText("supportLabel")}
              onChange={(value) => update("supportLabel", value)}
              placeholder="Ainda não tem acesso?"
              value={draft.supportLabel}
            />
            <TextField
              disabled={locked}
              error={errors.supportLinkLabel}
              id="login-ajuda-texto"
              label="Texto do link"
              max={LOGIN_TEXT_LIMITS.supportLinkLabel}
              onBlur={() => checkText("supportLinkLabel")}
              onChange={(value) => update("supportLinkLabel", value)}
              optional={false}
              placeholder="Fale com o suporte"
              value={draft.supportLinkLabel}
            />
            <AdminField error={errors.supportHref} hint={SUPPORT_LINK_HINT} id="login-ajuda-link" label="Link" optional>
              <Input
                aria-describedby={fieldDescribedBy("login-ajuda-link", { error: errors.supportHref, hint: SUPPORT_LINK_HINT })}
                aria-invalid={errors.supportHref ? true : undefined}
                autoCapitalize="none"
                autoComplete="off"
                className={adminInputClass}
                disabled={locked}
                id="login-ajuda-link"
                onBlur={checkLink}
                onChange={(event) => {
                  setLinkText(event.target.value);
                  clearError("supportHref");
                  clearSoftFailure();
                }}
                placeholder="https://wa.me/55… ou suporte@suaescola.com"
                spellCheck={false}
                value={linkText}
              />
            </AdminField>
          </FormSection>

          {canEdit ? (
            <div className="flex min-w-0 flex-col items-start gap-1 border-t border-[var(--border-subtle)] pt-6">
              <Button
                className="px-3 text-[var(--text-secondary)]"
                disabled={locked || uploading !== null}
                onClick={() => replaceDraft(defaultLoginPageSettings())}
                type="button"
                variant="ghost"
              >
                <RotateCcw aria-hidden="true" className="size-4" />
                Restaurar padrão
              </Button>
              <p className="text-xs leading-5 text-[var(--text-secondary)]">
                Volta o modelo, as imagens e os textos ao login original. Nada muda para o aluno até você publicar.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <SaveBar
        error={saveBarError}
        message="Alterações não publicadas"
        onDiscard={() => {
          replaceDraft(published.settings);
          setFailure(null);
        }}
        onSave={() => void publish()}
        open={dirty}
        saveLabel="Publicar login"
        saving={saving}
      />
    </div>
  );
}
