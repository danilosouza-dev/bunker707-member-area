"use client";

import { ArrowLeft, Send } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CHAT_LIMITS, type PersonaRole } from "@/server/webinars/model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { PersonaPhotoField } from "../persona-photo-field";

// O "Novo comentário" da entrada Roteiro do console (adendo de 10/11/2026, R8 e R9; na Live ao vivo e na gravada), no
// lugar da lista, com o Voltar: Quem comenta (Nome, Foto (opcional) com a linha do consentimento e o "Usar esta foto em
// todos os comentários de {nome}" ligado por padrao) e Aparece como (Aluno ou Equipe), o Comentário e os botoes
// "Enviar agora" (a mensagem do roteiro entra no chat da sessao na hora, sendScriptedComment; so com a sessao aceitando
// a equipe), "Guardar na lista" (vira um item "Pelo botão da equipe" no fim do roteiro, saveScriptComment) e Cancelar.
// A conferencia do nome e do comentario e a mesma do servidor (scriptCommentSchema), mostrada depois da primeira
// tentativa, junto dos erros que o servidor devolve em cada campo. Enquanto a foto sobe, o "Enviar agora" e o "Guardar na
// lista" esperam (o comentario sairia sem a foto). Nenhuma frase escrita aqui.

const COPY = WEBINAR_COPY.naTela.comentarios;

/** O que o "Enviar agora" e o "Guardar na lista" mandam (sem a sessao, que o console poe). */
export type ScriptCommentFormInput = {
  applyToName: boolean;
  body: string;
  personaAvatarPath: string | null;
  personaName: string;
  personaRole: PersonaRole;
};

export type ScriptCommentFormState = ScriptCommentFormInput;

export const EMPTY_SCRIPT_COMMENT: ScriptCommentFormState = { applyToName: true, body: "", personaAvatarPath: null, personaName: "", personaRole: "student" };

/** Os erros do formulario antes de enviar (o servidor confere de novo): o nome e o comentario. */
export function scriptCommentErrors(state: ScriptCommentFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = state.personaName.trim();
  const body = state.body.trim();
  if (name.length < 1 || name.length > CHAT_LIMITS.personaName) {
    errors.personaName = COPY.erros.nome;
  }
  if (body.length < 1 || body.length > CHAT_LIMITS.body) {
    errors.body = COPY.erros.comentario;
  }
  return errors;
}

/** O que vai para a Server Action: o nome e o comentario sem espacos nas pontas. */
export function scriptCommentInput(state: ScriptCommentFormState): ScriptCommentFormInput {
  return { applyToName: state.applyToName, body: state.body.trim(), personaAvatarPath: state.personaAvatarPath, personaName: state.personaName.trim(), personaRole: state.personaRole };
}

export type ConsoleScriptCommentProps = {
  /** Uma acao da mesa em andamento: os botoes do rodape ficam desligados. */
  busy: boolean;
  /** A sessao aceita a equipe (canTeamActOn): so entao o Enviar agora. */
  canSend: boolean;
  /** O formulario ao abrir (o teste de tela). */
  initialState?: ScriptCommentFormState;
  /** A foto subindo ao abrir (o teste de tela). */
  initialUploading?: boolean;
  onBack: () => void;
  /** "Enviar agora" ou "Guardar na lista"; devolve o resultado (nulo: outra acao em andamento). */
  onSubmit: (input: ScriptCommentFormInput, mode: "save" | "send") => Promise<ActionResult<unknown> | null>;
  onUpload: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
};

export function ConsoleScriptComment({ busy, canSend, initialState = EMPTY_SCRIPT_COMMENT, initialUploading = false, onBack, onSubmit, onUpload }: ConsoleScriptCommentProps) {
  const prefix = `console-script-comment-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<ScriptCommentFormState>(initialState);
  const [uploading, setUploading] = useState(initialUploading);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const localErrors = tried ? scriptCommentErrors(state) : {};
  const errorOf = (field: string) => serverErrors[field] ?? localErrors[field] ?? null;
  const titleId = `${prefix}-titulo`;

  function change(patch: Partial<ScriptCommentFormState>) {
    setState((current) => ({ ...current, ...patch }));
    setServerErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[key];
      }
      return next;
    });
  }

  async function submit(mode: "save" | "send") {
    if (uploading) {
      return;
    }
    setTried(true);
    setFormError(null);
    if (Object.keys(scriptCommentErrors(state)).length > 0) {
      return;
    }
    const result = await onSubmit(scriptCommentInput(state), mode);
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

  const nameId = `${prefix}-nome`;
  const bodyId = `${prefix}-comentario`;
  const nameError = errorOf("personaName");
  const bodyError = errorOf("body");

  return (
    <SectionCard
      actions={
        <Button className="h-8! px-2 text-[13px]" data-console-script-back="" onClick={onBack} type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {COPY.voltar}
        </Button>
      }
      title={COPY.novoComentario}
      titleId={titleId}
    >
      <form className="flex min-w-0 flex-col gap-4" data-console-script-comment="" noValidate onSubmit={(event) => event.preventDefault()}>
        <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-1 text-sm leading-6 font-semibold text-[var(--text-primary)]">{COPY.quemComenta}</legend>
          <AdminField error={nameError} id={nameId} label={COPY.nome}>
            <input
              aria-describedby={fieldDescribedBy(nameId, { error: nameError })}
              aria-invalid={nameError ? true : undefined}
              className={adminInputClass}
              id={nameId}
              maxLength={CHAT_LIMITS.personaName}
              onChange={(event) => change({ personaName: event.target.value })}
              type="text"
              value={state.personaName}
            />
          </AdminField>
          <PersonaPhotoField
            applyToAll={state.applyToName}
            disabled={busy}
            idBase={`${prefix}-foto`}
            name={state.personaName}
            onApplyToAllChange={(applyToName) => change({ applyToName })}
            onChange={(personaAvatarPath) => change({ personaAvatarPath })}
            onUpload={onUpload}
            onUploadingChange={setUploading}
            path={state.personaAvatarPath}
            uploading={uploading}
          />
          {errorOf("personaAvatarPath") ? (
            <p className="text-[13px] leading-5 text-[var(--error)]" role="alert">
              {errorOf("personaAvatarPath")}
            </p>
          ) : null}
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COPY.apareceComo}</span>
            <PillGroup
              ariaLabel={COPY.apareceComo}
              disabled={busy}
              name={`${prefix}-papel`}
              onChange={(personaRole: PersonaRole) => change({ personaRole })}
              options={[
                { label: COPY.papeis.student, value: "student" },
                { label: COPY.papeis.team, value: "team" }
              ]}
              value={state.personaRole}
            />
          </div>
        </fieldset>
        <AdminField error={bodyError} id={bodyId} label={COPY.comentario}>
          <textarea
            aria-describedby={fieldDescribedBy(bodyId, { error: bodyError })}
            aria-invalid={bodyError ? true : undefined}
            className={cn(adminTextareaClass, "min-h-20")}
            id={bodyId}
            maxLength={CHAT_LIMITS.body}
            onChange={(event) => change({ body: event.target.value })}
            rows={3}
            value={state.body}
          />
        </AdminField>
        {formError ? (
          <p className="text-[13px] leading-5 text-[var(--error)]" data-console-script-comment-error="" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {canSend ? (
            <Button className="px-3" data-console-script-send="" disabled={busy || uploading} onClick={() => void submit("send")} type="button">
              <Send aria-hidden="true" className="size-4" />
              {COPY.enviarAgora}
            </Button>
          ) : null}
          <Button className="px-3" data-console-script-save="" disabled={busy || uploading} onClick={() => void submit("save")} type="button" variant="secondary">
            {COPY.guardarNaLista}
          </Button>
          <Button className="px-3 text-[var(--text-secondary)]" onClick={onBack} type="button" variant="ghost">
            {COPY.cancelar}
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
