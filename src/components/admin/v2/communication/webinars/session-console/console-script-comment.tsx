"use client";

import { ArrowLeft, Send } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CHAT_LIMITS, type PersonaRole } from "@/server/webinars/model";
import { commentBodyMax, commentFormAfterSend, commentFormErrors, commentFormFor, type CommentFormState, type CommentKind, type WebinarPersona } from "@/server/webinars/persona-model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";
import { AdminField, PillGroup, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../../../form";
import { SectionCard } from "../../../settings/kit";
import { NEW_PERSONA_VALUE, PersonaPicker } from "../persona-list";
import { PersonaPhotoField } from "../persona-photo-field";
import { returnConsoleFocus } from "./console-focus";

// O "Novo comentário" da entrada Roteiro do console (adendo de 10/11/2026, R8 e R9; na Live ao vivo e na gravada), no
// lugar da lista, com o Voltar: Quem comenta (Nome, Foto (opcional) com a linha do consentimento e o "Usar esta foto em
// todos os comentários de {nome}" ligado por padrao) e Aparece como (Aluno ou Equipe), o Comentário e os botoes
// "Enviar agora" (a mensagem do roteiro entra no chat da sessao na hora, sendScriptedComment; so com a sessao aceitando
// a equipe), "Guardar na lista" (vira um item "Pelo botão da equipe" no fim do roteiro, saveScriptComment) e Cancelar.
// A conferencia do nome e do comentario e a mesma do servidor (scriptCommentSchema), mostrada depois da primeira
// tentativa, junto dos erros que o servidor devolve em cada campo. Enquanto a foto sobe, o "Enviar agora" e o "Guardar na
// lista" esperam (o comentario sairia sem a foto). Nenhuma frase escrita aqui.
//
// As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D76 a D78): "Quem comenta" escolhe uma pessoa da
// lista do webinario (PersonaPicker, com a foto ou as iniciais) ou "Criar nova pessoa" (o Nome, a Foto e o Aparece como
// de antes; a nova entra na lista ao enviar ou guardar, e o nome repetido volta no campo Nome); a caixa "Usar esta foto
// em todos" saiu (a pessoa e a unidade). O "Tipo": Comentário (o chat) ou Pergunta (a pergunta simulada na aba Perguntas,
// ate 500 caracteres). O repetir (D78): depois do "Enviar agora" o formulario fica aberto com a mesma pessoa (a nova vira
// a da lista) e o mesmo Tipo, o texto limpo, o aviso "Enviado." e o foco no texto, para mandar outro em seguida; o
// "Guardar na lista" e o Voltar voltam para a lista. No banco sem a lista (`listAvailable` falso), so o Nome digitado,
// como antes. A parte pura (o estado, os erros, o repetir) mora em persona-model.ts.

const COPY = WEBINAR_COPY.naTela.comentarios;
const PESSOAS = WEBINAR_COPY.pessoas;

/** O que o "Enviar agora" e o "Guardar na lista" mandam (sem a sessao, que o console poe). */
export type ScriptCommentFormInput = CommentFormState;

export type ScriptCommentFormState = CommentFormState;

export const EMPTY_SCRIPT_COMMENT: ScriptCommentFormState = commentFormFor(null);

/** As frases dos erros do formulario (as mesmas do servidor). */
const ERROR_MESSAGES = { comentario: COPY.erros.comentario, nome: COPY.erros.nome, nomeRepetido: PESSOAS.erros.nomeRepetido, pergunta: PESSOAS.erros.pergunta, sumiu: PESSOAS.erros.sumiu };

/** Os erros do formulario antes de enviar (o servidor confere de novo): a pessoa e o texto pelo Tipo. */
export function scriptCommentErrors(state: ScriptCommentFormState, personas: readonly Pick<WebinarPersona, "id" | "name">[] = [], listAvailable = true): Record<string, string> {
  return commentFormErrors(state, personas, ERROR_MESSAGES, { listAvailable });
}

/** O que vai para a Server Action: o nome e o texto sem espacos nas pontas. */
export function scriptCommentInput(state: ScriptCommentFormState): ScriptCommentFormInput {
  return { ...state, body: state.body.trim(), personaName: state.personaName.trim() };
}

/** O resultado que o formulario le do envio: a pessoa da lista (a nova ganha o id) e se deu certo. */
type CommentSubmitResult = ActionResult<{ persona: WebinarPersona | null }>;

export type ConsoleScriptCommentProps = {
  /** Uma acao da mesa em andamento: os botoes do rodape ficam desligados. */
  busy: boolean;
  /** A sessao aceita a equipe (canTeamActOn): so entao o Enviar agora. */
  canSend: boolean;
  /** O formulario ao abrir (o teste de tela; o "Comentar como {nome}" e a ultima pessoa usada). */
  initialState?: ScriptCommentFormState;
  /** O aviso "Enviado." ao abrir (o teste de tela). */
  initialSent?: boolean;
  /** A foto subindo ao abrir (o teste de tela). */
  initialUploading?: boolean;
  /** O banco tem a lista de pessoas (a 202611140001); sem ela, so o Nome digitado. */
  listAvailable?: boolean;
  onBack: () => void;
  /** "Enviar agora" ou "Guardar na lista"; devolve o resultado (nulo: outra acao em andamento). */
  onSubmit: (input: ScriptCommentFormInput, mode: "save" | "send") => Promise<CommentSubmitResult | null>;
  onUpload: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  /** A origem do nosso Supabase (a foto); sem ela, a do ambiente. */
  origin?: string | null;
  /** As pessoas da lista do webinario. */
  personas?: readonly WebinarPersona[];
};

export function ConsoleScriptComment({
  busy,
  canSend,
  initialSent = false,
  initialState = EMPTY_SCRIPT_COMMENT,
  initialUploading = false,
  listAvailable = false,
  onBack,
  onSubmit,
  onUpload,
  origin,
  personas = []
}: ConsoleScriptCommentProps) {
  const prefix = `console-script-comment-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<ScriptCommentFormState>(initialState);
  const [uploading, setUploading] = useState(initialUploading);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // A pessoa nova que entrou na lista no envio, ate o retrato do console trazer a lista nova.
  const [added, setAdded] = useState<WebinarPersona[]>([]);
  const [sent, setSent] = useState(initialSent);
  const [sends, setSends] = useState(0);
  const body = useRef<HTMLTextAreaElement>(null);
  const known = [...personas, ...added.filter((persona) => !personas.some((item) => item.id === persona.id))];
  const localErrors = tried ? scriptCommentErrors(state, known, listAvailable) : {};
  const errorOf = (field: string) => serverErrors[field] ?? localErrors[field] ?? null;
  const titleId = `${prefix}-titulo`;
  const choosing = listAvailable;
  const newPersona = !state.personaId;

  // Ao abrir no lugar da lista, o foco vai para o titulo do formulario (o botao que abriu saiu da tela).
  useEffect(() => {
    returnConsoleFocus({ heading: titleId, opener: null });
  }, [titleId]);

  // Depois do "Enviar agora", o foco vai para o texto: o proximo comentario sai da mesma pessoa.
  useEffect(() => {
    if (sends > 0) {
      body.current?.focus();
    }
  }, [sends]);

  function change(patch: Partial<ScriptCommentFormState>) {
    setState((current) => ({ ...current, ...patch }));
    setSent(false);
    setServerErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) {
        delete next[key];
      }
      return next;
    });
  }

  /** A escolha do "Quem comenta": a pessoa da lista (com a copia dela) ou "Criar nova pessoa" (os campos vazios). */
  function pick(value: string | null) {
    const persona = value && value !== NEW_PERSONA_VALUE ? (known.find((item) => item.id === value) ?? null) : null;
    if (persona) {
      change({ personaAvatarPath: persona.avatarPath, personaId: persona.id, personaName: persona.name, personaRole: persona.role });
      return;
    }
    change({ personaAvatarPath: null, personaId: null, personaName: "", personaRole: "student" });
  }

  async function submit(mode: "save" | "send") {
    if (uploading) {
      return;
    }
    setTried(true);
    setFormError(null);
    setSent(false);
    if (Object.keys(scriptCommentErrors(state, known, listAvailable)).length > 0) {
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
    if (mode === "save") {
      onBack();
      return;
    }
    // O repetir (D78): a mesma pessoa e o mesmo Tipo, o texto limpo.
    const persona = result.data.persona;
    if (persona && !known.some((item) => item.id === persona.id)) {
      setAdded((current) => [...current, persona]);
    }
    setState((current) => commentFormAfterSend(persona ? { ...current, personaAvatarPath: persona.avatarPath, personaName: persona.name, personaRole: persona.role } : current, persona?.id ?? null));
    setTried(false);
    setSent(true);
    setSends((count) => count + 1);
  }

  const nameId = `${prefix}-nome`;
  const bodyId = `${prefix}-comentario`;
  const pickerId = `${prefix}-pessoa`;
  const nameError = errorOf("personaName");
  const bodyError = errorOf("body");
  const pickerError = errorOf("personaId");
  const question = state.kind === "question";

  return (
    <SectionCard
      actions={
        <Button className="h-8! px-2 text-[13px]" data-console-script-back="" onClick={onBack} type="button" variant="ghost">
          <ArrowLeft aria-hidden="true" className="size-4" />
          {COPY.voltar}
        </Button>
      }
      title={COPY.novoComentario}
      titleFocusable
      titleId={titleId}
    >
      <form className="flex min-w-0 flex-col gap-4" data-console-script-comment="" noValidate onSubmit={(event) => event.preventDefault()}>
        <fieldset className="flex min-w-0 flex-col gap-3 border-0 p-0">
          <legend className="mb-1 text-sm leading-6 font-semibold text-[var(--text-primary)]">{COPY.quemComenta}</legend>
          {choosing ? (
            <PersonaPicker
              disabled={busy}
              error={pickerError}
              id={pickerId}
              label={PESSOAS.escolha}
              onChange={pick}
              origin={origin}
              personas={known}
              value={state.personaId ?? NEW_PERSONA_VALUE}
            />
          ) : null}
          {newPersona ? (
            <>
              <AdminField error={nameError} id={nameId} label={COPY.nome}>
                <input
                  aria-describedby={fieldDescribedBy(nameId, { error: nameError })}
                  aria-invalid={nameError ? true : undefined}
                  className={adminInputClass}
                  data-console-script-name=""
                  id={nameId}
                  maxLength={CHAT_LIMITS.personaName}
                  onChange={(event) => change({ personaName: event.target.value })}
                  type="text"
                  value={state.personaName}
                />
              </AdminField>
              <PersonaPhotoField
                disabled={busy}
                idBase={`${prefix}-foto`}
                name={state.personaName}
                onChange={(personaAvatarPath) => change({ personaAvatarPath })}
                onUpload={onUpload}
                onUploadingChange={setUploading}
                origin={origin}
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
            </>
          ) : null}
        </fieldset>
        <div className="flex min-w-0 flex-col gap-1.5" data-console-script-kind="">
          <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{PESSOAS.tipo}</span>
          <PillGroup
            ariaLabel={PESSOAS.tipo}
            disabled={busy}
            name={`${prefix}-tipo`}
            onChange={(kind: CommentKind) => change({ kind })}
            options={[
              { label: PESSOAS.tipos.message, value: "message" },
              { label: PESSOAS.tipos.question, value: "question" }
            ]}
            value={state.kind}
          />
        </div>
        <AdminField error={bodyError} id={bodyId} label={question ? PESSOAS.pergunta : PESSOAS.comentario}>
          <textarea
            aria-describedby={fieldDescribedBy(bodyId, { error: bodyError })}
            aria-invalid={bodyError ? true : undefined}
            className={cn(adminTextareaClass, "min-h-20")}
            data-console-script-body=""
            id={bodyId}
            maxLength={commentBodyMax(state.kind)}
            onChange={(event) => change({ body: event.target.value })}
            ref={body}
            rows={3}
            value={state.body}
          />
        </AdminField>
        {formError ? (
          <p className="text-[13px] leading-5 text-[var(--error)]" data-console-script-comment-error="" role="alert">
            {formError}
          </p>
        ) : null}
        <p aria-live="polite" className="text-[13px] leading-5 text-[var(--text-secondary)]" data-console-script-sent="" role="status">
          {sent ? PESSOAS.avisos.enviado : ""}
        </p>
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
