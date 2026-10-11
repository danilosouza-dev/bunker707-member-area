"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { GENERIC_ACTION_ERROR } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { setHomeModuleRow } from "@/server/member-area/modules-actions";
import {
  buildModuleSettingsHref,
  describeHomeRowChange,
  homeModuleRowTitleSchema,
  type HomeModuleRowState
} from "@/server/member-area/modules-model";
import { SECTION_TITLE_MAX } from "@/server/storefront/model";
import { ErrorBanner } from "../../error-banner";
import { adminInputClass } from "../../form";
import { AdminSwitch } from "../../settings/kit";
import { adminTransition } from "../../styles";
import { adminToast } from "../../toast";

// "Fileira na home": liga/desliga a fileira de modulos do produto na Vitrine e troca o titulo dela.
// Salva na hora (fora da SaveBar), com toast e "Desfazer". Usado na tabela de Area de membros >
// Modulos (celula compacta) e na aba Detalhes do produto (HomeRowControl).

export type RowError = { message: string; reload: boolean };

export type HomeRowDesired = { enabled: boolean; title?: string };

/** Chama a Server Action e traduz o resultado (erro de titulo cai no proprio campo). */
export async function requestHomeRowChange(
  productId: string,
  desired: HomeRowDesired
): Promise<{ ok: true; state: HomeModuleRowState } | { error: RowError; ok: false; titleError?: string }> {
  try {
    const result = await setHomeModuleRow({ enabled: desired.enabled, productId, ...(desired.title ? { title: desired.title } : {}) });

    if (result.ok) {
      return { ok: true, state: result.data };
    }

    return {
      error: { message: result.error, reload: result.status === 409 },
      ok: false,
      titleError: result.fieldErrors?.title?.[0]
    };
  } catch {
    return { error: { message: GENERIC_ACTION_ERROR, reload: false }, ok: false };
  }
}

/** Estado otimista enquanto o servidor responde. */
export function optimisticHomeRow(state: HomeModuleRowState, desired: HomeRowDesired): HomeModuleRowState {
  return { ...state, status: desired.enabled ? "on" : "off", title: desired.title ?? state.title };
}

/** O que desfaz a mudanca (`undefined` = nada para desfazer). */
export function undoHomeRowChange(previous: HomeModuleRowState, next: HomeModuleRowState): HomeRowDesired | undefined {
  const enabled = previous.status === "on";
  const titleChanged = previous.sectionId !== null && previous.title !== next.title;

  if (enabled === (next.status === "on") && !titleChanged) {
    return undefined;
  }

  return titleChanged ? { enabled, title: previous.title } : { enabled };
}

/** Frase do efeito ao lado da chave. */
export function homeRowEffect(state: HomeModuleRowState) {
  if (state.status !== "on") {
    return "Os módulos deste produto não aparecem na home.";
  }

  return state.afterTitle ? `Aparece na home depois de “${state.afterTitle}”.` : "Aparece no topo da home, logo abaixo do destaque.";
}

/* ------------------------------------------------------------------------------------------------
 * Chave compacta (celula da tabela e cartao do celular)
 * ---------------------------------------------------------------------------------------------- */

type RowSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  pending?: boolean;
};

/** Chave com alvo de 44 px no toque (36 px na tabela larga) e aria-label proprio. */
export function RowSwitch({ checked, disabled = false, label, onChange, pending = false }: RowSwitchProps) {
  return (
    <button
      aria-busy={pending || undefined}
      aria-disabled={pending || undefined}
      aria-checked={checked}
      aria-label={label}
      className={cn(
        "group -mx-1 grid h-11 w-12 shrink-0 place-items-center rounded-lg @min-[900px]:h-9",
        "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[var(--focus-ring)]",
        "disabled:cursor-not-allowed"
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full border",
          adminTransition,
          checked ? "border-transparent bg-[var(--text-primary)]" : "border-[var(--border-strong)] bg-[var(--surface-2)]",
          (disabled || pending) && "opacity-60"
        )}
      >
        <span
          className={cn(
            "block size-[18px] rounded-full transition-transform duration-150 ease-[var(--ease-admin)] motion-reduce:transition-none",
            checked ? "translate-x-[19px] bg-[var(--surface-0)]" : "translate-x-[2px] bg-[var(--text-secondary)]"
          )}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Titulo editavel no lugar
 * ---------------------------------------------------------------------------------------------- */

type HomeRowTitleInputProps = {
  /** Salvando: o campo fica so leitura (continua com o foco; disabled jogaria o foco no body). */
  busy?: boolean;
  disabled?: boolean;
  /** Erro do servidor para o titulo (fieldErrors.title). */
  error?: string | null;
  id: string;
  label: string;
  onCommit: (title: string) => void;
  title: string;
};

/** Enter ou sair do campo salva; Esc desfaz. Campo vazio volta ao titulo salvo. */
export function HomeRowTitleInput({ busy = false, disabled = false, error, id, label, onCommit, title }: HomeRowTitleInputProps) {
  const [value, setValue] = useState(title);
  const [localError, setLocalError] = useState<string | null>(null);
  const [source, setSource] = useState(title);
  const shownError = localError ?? error ?? null;

  if (source !== title) {
    setSource(title);
    setValue(title);
    setLocalError(null);
  }

  function commit(fromEnter: boolean) {
    if (busy) {
      return;
    }

    const parsed = homeModuleRowTitleSchema.safeParse(value);

    if (!parsed.success) {
      if (fromEnter) {
        setLocalError(parsed.error.issues[0]?.message ?? "Dê um título à fileira.");
      } else {
        setValue(title);
        setLocalError(null);
      }

      return;
    }

    setLocalError(null);

    if (parsed.data !== title) {
      onCommit(parsed.data);
    } else if (value !== title) {
      setValue(title);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setValue(title);
      setLocalError(null);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <input
        aria-busy={busy || undefined}
        aria-describedby={shownError ? `${id}-error` : undefined}
        aria-invalid={shownError ? true : undefined}
        aria-label={label}
        autoComplete="off"
        className={cn(adminInputClass, "h-11 @min-[900px]:h-9", busy && "opacity-60")}
        disabled={disabled}
        readOnly={busy}
        id={id}
        maxLength={SECTION_TITLE_MAX}
        onBlur={() => commit(false)}
        onChange={(event) => {
          setValue(event.target.value);
          setLocalError(null);
        }}
        onKeyDown={handleKeyDown}
        value={value}
      />
      {shownError ? (
        <p className="text-xs leading-4 text-[var(--error)]" id={`${id}-error`}>
          {shownError}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Aba Detalhes do produto
 * ---------------------------------------------------------------------------------------------- */

type HomeRowControlProps = {
  canWrite: boolean;
  productId: string;
  productTitle: string;
  state: HomeModuleRowState;
};

/**
 * Interruptor "Mostrar os módulos numa fileira da home" da aba Detalhes. O titulo se edita na tela
 * Area de membros › Modulos (link). Salva assim que muda.
 */
export function HomeRowControl({ canWrite, productId, productTitle, state: serverState }: HomeRowControlProps) {
  const router = useRouter();
  const [source, setSource] = useState(serverState);
  const [state, setState] = useState(serverState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<RowError | null>(null);
  const latest = useRef(state);
  const busy = useRef(false);

  useEffect(() => {
    latest.current = state;
  });

  if (source !== serverState && !saving) {
    setSource(serverState);
    setState(serverState);
  }

  async function change(desired: HomeRowDesired, undoing = false) {
    if (busy.current || !canWrite) {
      return;
    }

    const previous = latest.current;
    busy.current = true;
    setSaving(true);
    setError(null);
    setState(optimisticHomeRow(previous, desired));
    const result = await requestHomeRowChange(productId, desired);
    busy.current = false;
    setSaving(false);

    if (!result.ok) {
      setState(previous);
      setError(result.error);
      return;
    }

    setState(result.state);
    const undo = undoHomeRowChange(previous, result.state);

    if (!undoing) {
      adminToast.success(describeHomeRowChange(previous, result.state), undo ? { onUndo: () => void change(undo, true) } : undefined);
    }
  }

  const editHref = buildModuleSettingsHref({}, { q: productTitle });

  if (state.status === "unavailable") {
    return (
      <div className="flex min-w-0 flex-col gap-1.5">
        <p className="text-[13px] leading-5 font-medium text-[var(--text-primary)]">Fileira de módulos na home</p>
        <p className="text-xs leading-5 text-[var(--text-secondary)]">{state.note}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {error ? (
        <ErrorBanner
          action={
            <>
              {error.reload ? (
                <Button className="h-8! px-3" onClick={() => router.refresh()} type="button" variant="secondary">
                  Recarregar
                </Button>
              ) : null}
              <Button className="h-8! px-3 text-[var(--text-secondary)]" onClick={() => setError(null)} type="button" variant="ghost">
                Fechar
              </Button>
            </>
          }
          title="A fileira da home não mudou."
        >
          {error.message}
        </ErrorBanner>
      ) : null}

      <AdminSwitch
        checked={state.status === "on"}
        description={homeRowEffect(state)}
        disabled={!canWrite}
        id="detalhes-fileira-home"
        label="Mostrar os módulos numa fileira da home"
        onCheckedChange={(checked) => void change({ enabled: checked })}
        pending={saving}
      />

      <div className="flex min-w-0 flex-col gap-1 pl-[52px] text-xs leading-5 text-[var(--text-secondary)]">
        {state.sectionId ? (
          <p className="min-w-0 break-words">
            Título da fileira: <span className="font-medium text-[var(--text-primary)]">“{state.title}”</span>
          </p>
        ) : null}
        {state.note ? <p>{state.note}</p> : null}
        <p>
          {saving ? "Salvando…" : "Salva assim que você muda."}{" "}
          <Link className="underline underline-offset-4 hover:text-[var(--text-primary)]" data-navigation-feedback="false" href={editHref}>
            Editar o título em Área de membros › Módulos
          </Link>
        </p>
        {!canWrite ? <p>Só o dono, um administrador ou um editor pode mudar a home.</p> : null}
      </div>
    </div>
  );
}
