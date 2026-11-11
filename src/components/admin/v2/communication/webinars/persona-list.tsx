"use client";

import { MessageSquarePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState, type RefObject } from "react";
import { RoomCommentAvatar } from "@/components/member/webinars/room/room-comment";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { CHAT_LIMITS, type PersonaRole } from "@/server/webinars/model";
import { PERSONAS_MIGRATION_ID, personaAvatarUrl, personaDraftErrors, sortPersonas, type PersonaDraft, type WebinarPersona } from "@/server/webinars/persona-model";
import type { UploadedPersonaPhoto } from "@/server/webinars/script-actions";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../../form";
import { ConfirmDialog } from "../../settings/kit";
import { PersonaPhotoField } from "./persona-photo-field";

// As pessoas que comentam (pedido do produtor de 11/11/2026; docs/30 D75 a D78; docs/31 §13.1), as pecas que o card
// Roteiro do editor e a entrada Roteiro do console dividem:
// - PersonaForm: a pessoa (Nome, Foto (opcional) e Aparece como), para criar ou editar; o nome repetido na lista volta
//   no campo Nome antes de enviar (personaDraftErrors) e de novo pelo servidor; enquanto a foto sobe, o salvar espera;
// - PersonaList: a lista "Pessoas que comentam" do webinario, cada pessoa com a foto ou as iniciais, o nome, o Aparece
//   como, quantos comentarios do roteiro a usam, e os botoes Editar e Remover (no console, tambem "Comentar como
//   {nome}", que repete a pessoa no Novo comentário); "Nova pessoa" abre o formulario no fim; Remover pede confirmacao
//   dizendo quantos comentarios do roteiro usam a pessoa (eles ficam com a copia, fora da lista). No banco sem a lista,
//   so a frase da migracao;
// - PersonaPicker: o "Quem comenta" de um comentario: a escolha de uma pessoa da lista (o seletor nativo, com a foto ou
//   as iniciais da escolhida ao lado), a opcao "Criar nova pessoa" e, no item ligado a ninguem, o nome que ele guarda
//   "(fora da lista)". Nenhuma frase escrita aqui (WEBINAR_COPY.pessoas e WEBINAR_COPY.naTela.comentarios).

const PESSOAS = WEBINAR_COPY.pessoas;
const COMENTARIOS = WEBINAR_COPY.naTela.comentarios;

/** O valor do seletor que cria uma pessoa nova ali mesmo. */
export const NEW_PERSONA_VALUE = "__nova__";

export type SavePersonaResult = ActionResult<{ created: boolean; items: number; persona: WebinarPersona }>;
export type DeletePersonaResult = ActionResult<{ id: string; items: number }>;

/** A origem do nosso Supabase para a foto (a do ambiente quando nao vem). */
function photoOrigin(origin: string | null | undefined): string | null {
  return origin === undefined ? (process.env.NEXT_PUBLIC_SUPABASE_URL ?? null) : origin;
}

/** A foto ou as iniciais de uma pessoa (o avatar de 24 px da sala). */
export function PersonaAvatar({ origin, persona }: { origin?: string | null; persona: Pick<WebinarPersona, "avatarPath" | "name"> }) {
  return <RoomCommentAvatar imageSrc={personaAvatarUrl(persona.avatarPath, photoOrigin(origin))} kind="person" name={persona.name} />;
}

type PersonaFormProps = {
  busy?: boolean;
  /** A pessoa editada (nula: a nova). */
  editing: WebinarPersona | null;
  /** O formulario ao abrir (o teste de tela). */
  initial?: PersonaDraft;
  onCancel: () => void;
  onSave: (draft: PersonaDraft) => Promise<SavePersonaResult | null>;
  onUpload: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  origin?: string | null;
  personas: readonly WebinarPersona[];
};

/** O formulario da pessoa: Nome, Foto (opcional), Aparece como; Adicionar à lista (nova) ou Salvar pessoa (edicao). */
export function PersonaForm({ busy = false, editing, initial, onCancel, onSave, onUpload, origin, personas }: PersonaFormProps) {
  const prefix = `persona-form-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [draft, setDraft] = useState<PersonaDraft>(() => initial ?? (editing ? { avatarPath: editing.avatarPath, id: editing.id, name: editing.name, role: editing.role } : { avatarPath: null, id: null, name: "", role: "student" }));
  const [uploading, setUploading] = useState(false);
  const [tried, setTried] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const local = tried ? personaDraftErrors(draft, personas, PESSOAS.erros) : {};
  const nameError = serverErrors.name ?? local.name ?? null;
  const nameId = `${prefix}-nome`;

  function change(patch: Partial<PersonaDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setServerErrors({});
    setFormError(null);
  }

  async function submit() {
    if (uploading) {
      return;
    }
    setTried(true);
    if (Object.keys(personaDraftErrors(draft, personas, PESSOAS.erros)).length > 0) {
      return;
    }
    const result = await onSave(draft);
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
      setFormError(fields.name ? null : result.error);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-subtle)] p-3" data-persona-form={editing ? editing.id : "nova"}>
      <p className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{editing ? PESSOAS.editarPessoa : PESSOAS.novaPessoa}</p>
      {editing ? <p className="text-xs leading-5 text-[var(--text-secondary)]">{PESSOAS.editarDica}</p> : null}
      <AdminField error={nameError} id={nameId} label={COMENTARIOS.nome}>
        <input
          aria-describedby={fieldDescribedBy(nameId, { error: nameError })}
          aria-invalid={nameError ? true : undefined}
          className={adminInputClass}
          data-persona-form-name=""
          disabled={busy}
          id={nameId}
          maxLength={CHAT_LIMITS.personaName}
          onChange={(event) => change({ name: event.target.value })}
          type="text"
          value={draft.name}
        />
      </AdminField>
      <PersonaPhotoField
        disabled={busy}
        idBase={`${prefix}-foto`}
        name={draft.name}
        onChange={(avatarPath) => change({ avatarPath })}
        onUpload={onUpload}
        onUploadingChange={setUploading}
        origin={origin}
        path={draft.avatarPath}
        uploading={uploading}
      />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">{COMENTARIOS.apareceComo}</span>
        <PillGroup
          ariaLabel={COMENTARIOS.apareceComo}
          disabled={busy}
          name={`${prefix}-papel`}
          onChange={(role: PersonaRole) => change({ role })}
          options={[
            { label: COMENTARIOS.papeis.student, value: "student" },
            { label: COMENTARIOS.papeis.team, value: "team" }
          ]}
          value={draft.role}
        />
      </div>
      {formError ? (
        <p className="text-[13px] leading-5 text-[var(--error)]" data-persona-form-error="" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button className="px-3" data-persona-form-save="" disabled={busy || uploading} onClick={() => void submit()} type="button">
          {editing ? PESSOAS.salvarPessoa : PESSOAS.adicionarPessoa}
        </Button>
        <Button className="px-3 text-[var(--text-secondary)]" disabled={busy} onClick={onCancel} type="button" variant="ghost">
          {PESSOAS.cancelar}
        </Button>
      </div>
    </div>
  );
}

export type PersonaListProps = {
  /** Uma acao em andamento: os botoes ficam desligados. */
  busy?: boolean;
  /** O portal do console para a confirmacao (o dialogo fica dentro do console em tela cheia). */
  container?: RefObject<HTMLElement | null> | null;
  /** O formulario aberto ao desenhar ("nova" ou o id da pessoa; o teste de tela). */
  initialForm?: string | null;
  /** A pessoa com a confirmacao do Remover aberta ao desenhar (o teste de tela). */
  initialRemoving?: string | null;
  /** O banco tem a lista (a 202611110001); sem ela, so a frase da migracao. */
  available: boolean;
  /** "Comentar como {nome}" (so no console): abre o Novo comentário com a pessoa. */
  onCommentAs?: (persona: WebinarPersona) => void;
  onDelete: (persona: WebinarPersona) => Promise<DeletePersonaResult | null>;
  onSave: (draft: PersonaDraft) => Promise<SavePersonaResult | null>;
  onUpload: (image: string) => Promise<ActionResult<UploadedPersonaPhoto>>;
  origin?: string | null;
  personas: readonly WebinarPersona[];
  /** O webinario arquivado: a lista so para ler. */
  readOnly?: boolean;
  /** O titulo "Pessoas que comentam" (o console ja o tem no cartao). */
  showTitle?: boolean;
  /** Quantos comentarios do roteiro usam cada pessoa (pelo id). */
  usage: Readonly<Record<string, number>>;
};

/** A lista "Pessoas que comentam" do webinario (o editor e o console). */
export function PersonaList({
  available,
  busy = false,
  container = null,
  initialForm = null,
  initialRemoving = null,
  onCommentAs,
  onDelete,
  onSave,
  onUpload,
  origin,
  personas,
  readOnly = false,
  showTitle = true,
  usage
}: PersonaListProps) {
  const [form, setForm] = useState<string | null>(initialForm);
  const [removing, setRemoving] = useState<WebinarPersona | null>(() => personas.find((persona) => persona.id === initialRemoving) ?? null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const sorted = sortPersonas(personas);
  const locked = busy || readOnly;

  if (!available) {
    return (
      <p className="text-[13px] leading-5 text-[var(--warning)]" data-persona-list-pending="">
        {PESSOAS.erros.migracao(PERSONAS_MIGRATION_ID)}
      </p>
    );
  }

  async function save(draft: PersonaDraft) {
    const result = await onSave(draft);
    if (result?.ok) {
      setForm(null);
    }
    return result;
  }

  return (
    <div className="flex min-w-0 flex-col gap-3" data-persona-list="">
      <div className="flex min-w-0 flex-col gap-0.5">
        {showTitle ? <p className="text-sm leading-6 font-semibold text-[var(--text-primary)]">{PESSOAS.titulo}</p> : null}
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{PESSOAS.descricao}</p>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[13px] leading-5 text-[var(--text-secondary)]" data-persona-list-empty="">
          {PESSOAS.vazia}
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {sorted.map((persona) =>
            form === persona.id ? (
              <li key={persona.id}>
                <PersonaForm busy={busy} editing={persona} onCancel={() => setForm(null)} onSave={save} onUpload={onUpload} origin={origin} personas={personas} />
              </li>
            ) : (
              <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--border-subtle)] px-3 py-2" data-persona={persona.id} key={persona.id}>
                <PersonaAvatar origin={origin} persona={persona} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm leading-5 font-medium text-[var(--text-primary)]">{persona.name}</span>
                  <span className="text-xs leading-5 text-[var(--text-secondary)]">
                    {COMENTARIOS.apareceComo} {COMENTARIOS.papeis[persona.role]} · {PESSOAS.usos(usage[persona.id] ?? 0)}
                  </span>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  {onCommentAs ? (
                    <Button className="h-8! px-2 text-[13px]" data-persona-comment-as="" disabled={busy} onClick={() => onCommentAs(persona)} type="button" variant="secondary">
                      <MessageSquarePlus aria-hidden="true" className="size-4" />
                      {PESSOAS.comentarComo(persona.name)}
                    </Button>
                  ) : null}
                  {readOnly ? null : (
                    <>
                      <Button aria-label={PESSOAS.editarDe(persona.name)} className="h-8! px-2 text-[13px]" data-persona-edit="" disabled={locked} onClick={() => setForm(persona.id)} type="button" variant="ghost">
                        <Pencil aria-hidden="true" className="size-4" />
                        {PESSOAS.editar}
                      </Button>
                      <Button
                        aria-label={PESSOAS.removerDe(persona.name)}
                        className="h-8! px-2 text-[13px] text-[var(--text-secondary)]"
                        data-persona-remove=""
                        disabled={locked}
                        onClick={() => {
                          setRemoveError(null);
                          setRemoving(persona);
                        }}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                        {PESSOAS.remover}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            )
          )}
        </ul>
      )}
      {form === "nova" ? (
        <PersonaForm busy={busy} editing={null} onCancel={() => setForm(null)} onSave={save} onUpload={onUpload} origin={origin} personas={personas} />
      ) : readOnly ? null : (
        <div>
          <Button className={cn("h-8! px-2 text-[13px]")} data-persona-new="" disabled={locked || form !== null} onClick={() => setForm("nova")} type="button" variant="secondary">
            <Plus aria-hidden="true" className="size-4" />
            {PESSOAS.novaPessoa}
          </Button>
        </div>
      )}

      <ConfirmDialog
        busy={busy}
        cancelLabel={PESSOAS.cancelar}
        confirmLabel={PESSOAS.confirmarRemover.botao}
        container={container ?? undefined}
        description={removing ? `${PESSOAS.confirmarRemover.texto(usage[removing.id] ?? 0)} ${PESSOAS.confirmarRemover.visto}` : undefined}
        destructive
        onConfirm={() => {
          const target = removing;
          if (!target) {
            return;
          }
          setRemoveError(null);
          void onDelete(target).then((result) => {
            if (!result) {
              return;
            }
            if (result.ok) {
              setRemoving(null);
            } else {
              setRemoveError(result.error);
            }
          });
        }}
        onOpenChange={(open) => {
          if (!open) {
            setRemoving(null);
            setRemoveError(null);
          }
        }}
        open={removing !== null}
        title={removing ? PESSOAS.confirmarRemover.titulo(removing.name) : PESSOAS.remover}
      >
        {removeError ? (
          <p className="text-[13px] leading-5 text-[var(--error)]" data-persona-remove-error="" role="alert">
            {removeError}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export type PersonaPickerProps = {
  disabled?: boolean;
  /** O nome que o item guarda quando nao esta ligado a ninguem da lista ("{nome} (fora da lista)"). */
  fallbackName?: string | null;
  id: string;
  label?: string;
  /** A escolha: o id da pessoa, NEW_PERSONA_VALUE (criar ali) ou nulo (fora da lista). */
  onChange: (value: string | null) => void;
  origin?: string | null;
  personas: readonly WebinarPersona[];
  /** O id da pessoa escolhida, NEW_PERSONA_VALUE ou nulo. */
  value: string | null;
  error?: string | null;
};

/** "Quem comenta": a pessoa da lista (com a foto ou as iniciais ao lado) ou "Criar nova pessoa". */
export function PersonaPicker({ disabled = false, error = null, fallbackName = null, id, label = PESSOAS.quemComenta, onChange, origin, personas, value }: PersonaPickerProps) {
  const sorted = sortPersonas(personas);
  const chosen = value && value !== NEW_PERSONA_VALUE ? (personas.find((persona) => persona.id === value) ?? null) : null;
  const outside = !value && fallbackName ? fallbackName : null;

  return (
    <AdminField error={error} id={id} label={label}>
      <div className="flex min-w-0 items-center gap-2" data-persona-picker="">
        {chosen ? <PersonaAvatar origin={origin} persona={chosen} /> : outside ? <RoomCommentAvatar kind="person" name={outside} /> : null}
        <select
          aria-describedby={fieldDescribedBy(id, { error })}
          aria-invalid={error ? true : undefined}
          className={cn(adminInputClass, "min-w-0 flex-1")}
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.value ? event.target.value : null)}
          value={value ?? ""}
        >
          {outside ? <option value="">{PESSOAS.foraDaLista(outside)}</option> : !value ? <option value="">{PESSOAS.escolha}</option> : null}
          {sorted.map((persona) => (
            <option key={persona.id} value={persona.id}>
              {persona.name} · {COMENTARIOS.papeis[persona.role]}
            </option>
          ))}
          <option value={NEW_PERSONA_VALUE}>{PESSOAS.criarNova}</option>
        </select>
      </div>
    </AdminField>
  );
}
