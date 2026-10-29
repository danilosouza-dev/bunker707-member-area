"use client";

import { Languages } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore, type FormEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { MemberSurface } from "@/components/member/ui/member-surface";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { CHAT_LANGUAGES, type ChatLanguage } from "@/server/webinars/model";
import type { ViewerPrefsReply } from "@/server/webinars/translation-model";
import { loadViewerPrefsOnce, rememberViewerPrefs, subscribeRoomTranslation, viewerPrefsSnapshot } from "./room-translation-cache";
import { getViewerPrefs, putViewerPrefs, WebinarsRequestError } from "./translation-api";

// Perfil › Privacidade › Idioma do chat das lives (docs/30 §1.6, fase 4f): Como foi escrito, Português, English ou
// Español, com o Salvar (PUT /api/webinars/preferences). O idioma vale para o chat e o roteiro de todas as lives; a
// original fica guardada como foi escrita e as legendas do video ficam de fora (a frase diz). Lido uma vez por pagina
// (a mesma memoria da sala: salvar aqui ja vale na sala aberta depois); `initial` pode vir do servidor. Desligado no
// ambiente ou sem a migracao: a frase de desligado no lugar do seletor. Na previa da equipe ("ver como"), desligado e
// sem ler nada. O resultado fica em aria-live.

const ORIGINAL = "original";

type Choice = ChatLanguage | typeof ORIGINAL;

const OPTIONS: readonly Choice[] = [ORIGINAL, ...CHAT_LANGUAGES];

function choiceOf(value: ViewerPrefsReply | null): Choice {
  return value?.chatLanguage ?? ORIGINAL;
}

export function ChatLanguagePreference({ initial = null, readOnly = false }: { initial?: ViewerPrefsReply | null; readOnly?: boolean }) {
  const copy = WEBINAR_COPY.traducao;
  const id = useId();
  const snapshot = useSyncExternalStore(subscribeRoomTranslation, viewerPrefsSnapshot, viewerPrefsSnapshot);
  const loaded = snapshot.status === "ready" ? snapshot.value : initial;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  useEffect(() => {
    if (readOnly) {
      return;
    }
    if (initial && viewerPrefsSnapshot().status === "idle") {
      rememberViewerPrefs(initial);
      return;
    }
    void loadViewerPrefsOnce(() => getViewerPrefs());
  }, [initial, readOnly]);

  const loading = !readOnly && !loaded && snapshot.status !== "error";
  const saved = choiceOf(loaded);
  const current = choice ?? saved;
  const dirty = current !== saved || (snapshot.status === "error" && choice !== null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    try {
      const answer = await putViewerPrefs(current === ORIGINAL ? null : current);
      rememberViewerPrefs(answer);
      setChoice(null);
      setStatus(answer.enabled ? { text: copy.salvo, tone: "ok" } : { text: copy.desligada, tone: "error" });
    } catch (failure) {
      setStatus({ text: failure instanceof WebinarsRequestError && failure.status < 500 ? failure.message : copy.erro, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const label = (option: Choice) => (option === ORIGINAL ? copy.comoFoiEscrito : copy.idiomas[option]);

  return (
    <MemberSurface className="flex flex-col gap-4 sm:flex-row sm:items-start" data-testid="chat-language" padding="md">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-[10px] bg-white/[0.07] text-zinc-200">
        <Languages className="size-5" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] font-bold text-white" id={`${id}-title`}>
          {copy.titulo}
        </h2>
        <p className="mt-1 text-sm leading-6 text-zinc-400">{copy.descricao}</p>
        {loaded?.enabled === false ? (
          <p className="mt-3 text-sm leading-6 text-zinc-400">{copy.desligada}</p>
        ) : (
          <form className="mt-3" onSubmit={(event) => void save(event)}>
            <fieldset aria-describedby={`${id}-note`} aria-labelledby={`${id}-title`} disabled={readOnly || busy || loading}>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                {OPTIONS.map((option) => (
                  <label
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-white/15 px-3 text-sm text-zinc-200 has-[:checked]:border-white/50 has-[:checked]:bg-white/[0.08] has-[:disabled]:cursor-default has-[:disabled]:opacity-60"
                    key={option}
                  >
                    <input checked={current === option} className="accent-white" name={`${id}-language`} onChange={() => setChoice(option)} type="radio" value={option} />
                    <span lang={option === ORIGINAL ? undefined : option}>{label(option)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="mt-2 text-xs leading-5 text-zinc-500" id={`${id}-note`}>
              {copy.legendasDeFora}
            </p>
            <div className="mt-3">
              <MemberButton disabled={readOnly || busy || loading || !dirty} type="submit" variant="secondary">
                {copy.salvar}
              </MemberButton>
              {readOnly ? <p className="mt-2 text-xs text-zinc-500">{WEBINAR_COPY.aluno.previaSemGravar}</p> : null}
              {loading ? <p className="mt-2 text-xs text-zinc-500">{copy.carregando}</p> : null}
            </div>
          </form>
        )}
        <p aria-live="polite" className={`mt-2 min-h-5 text-sm font-medium ${status?.tone === "error" ? "text-red-300" : "text-emerald-300"}`}>
          {status?.text ?? ""}
        </p>
      </div>
    </MemberSurface>
  );
}
