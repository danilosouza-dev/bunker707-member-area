"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { searchAdmin } from "@/server/admin/search-actions";
import {
  ADMIN_SEARCH_DEBOUNCE_MS,
  EMPTY_ADMIN_SEARCH_RESULTS,
  buildAdminSearchGroups,
  cleanAdminSearchQuery,
  flattenAdminSearchGroups,
  shouldSearchAdminCatalog,
  type AdminSearchItem,
  type AdminSearchResults
} from "./search-model";
import { adminTransition } from "./styles";

// Busca global (prototipo aprovado): campo de 320 px a esquerda da barra superior, "Buscar (Cmd+K)".
// Foco: lista de Ações e Telas. Texto (2 letras ou mais, 150 ms depois de parar de digitar): produtos,
// modulos e aulas do banco (Server Action searchAdmin), telas e acoes do menu e a busca de alunos no
// admin antigo. ↑ ↓ escolhem, Enter abre, Esc fecha; Cmd/Ctrl+K foca de qualquer lugar. O foco fica
// sempre no campo (combobox com aria-activedescendant). No celular vira um icone de 36 px que se abre
// por cima da barra ao receber foco. O foco aparece na borda clara do campo (como no prototipo), sem o
// contorno extra de 2 px dos outros controles.

type RemoteState =
  | { query: string; status: "loading" }
  | { query: string; results: AdminSearchResults; status: "done" }
  | { query: string; status: "error" };

const noopSubscribe = () => () => {};

function getShortcutLabel() {
  return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Cmd" : "Ctrl";
}

export function GlobalSearch() {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const shortcut = useSyncExternalStore(noopSubscribe, getShortcutLabel, () => "Cmd");

  const cleaned = cleanAdminSearchQuery(query);
  const searching = shouldSearchAdminCatalog(cleaned);
  const current = remote && remote.query === cleaned ? remote : null;
  const results = current?.status === "done" ? current.results : EMPTY_ADMIN_SEARCH_RESULTS;
  const groups = buildAdminSearchGroups(cleaned, results);
  const items = flattenAdminSearchGroups(groups);
  const active = items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const loading = searching && (!current || current.status === "loading");
  const failed = searching && current?.status === "error";
  const dbEmpty = current?.status === "done" && results.products.length + results.modules.length + results.lessons.length === 0;
  const onlyStudentAction = items.length === 1 && items[0]?.id === "acao:buscar-alunos";
  const nothingFound = cleaned.length > 0 && ((searching && dbEmpty && onlyStudentAction) || (!searching && items.length === 0));

  // Busca no banco com espera de 150 ms; uma resposta atrasada nunca sobrescreve a do texto atual.
  useEffect(() => {
    if (!searching || (remote && remote.query === cleaned)) {
      return;
    }

    const requestId = ++requestRef.current;
    const timer = window.setTimeout(() => {
      setRemote({ query: cleaned, status: "loading" });
      searchAdmin({ q: cleaned })
        .then((result) => {
          if (requestRef.current === requestId) {
            setRemote(result.ok ? { query: cleaned, results: result.data, status: "done" } : { query: cleaned, status: "error" });
          }
        })
        .catch(() => {
          if (requestRef.current === requestId) {
            setRemote({ query: cleaned, status: "error" });
          }
        });
    }, ADMIN_SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [cleaned, remote, searching]);

  // Cmd/Ctrl+K foca a busca de qualquer lugar do admin.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function close(blur: boolean) {
    setOpen(false);
    setActiveId(null);

    if (blur) {
      inputRef.current?.blur();
    }
  }

  function run(item: AdminSearchItem | null) {
    if (!item) {
      return;
    }

    setQuery("");
    close(true);
    router.push(item.href);
  }

  function move(step: 1 | -1) {
    if (items.length === 0) {
      return;
    }

    const index = active ? items.findIndex((item) => item.id === active.id) : -1;
    const next = items[(index + step + items.length) % items.length];
    setActiveId(next.id);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  }

  function optionId(item: AdminSearchItem) {
    return `${listboxId}-${item.id.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        move(-1);
        break;
      case "Enter":
        if (open && active) {
          event.preventDefault();
          run(active);
        }
        break;
      case "Escape":
        event.preventDefault();

        if (open) {
          close(false);
        } else {
          setQuery("");
          inputRef.current?.blur();
        }
        break;
      case "Tab":
        close(false);
        break;
    }
  }

  const showPopup = open && (items.length > 0 || cleaned.length > 0);

  return (
    <div
      className={cn(
        "group/search relative min-w-[160px] flex-[0_1_320px] max-xl:max-w-[320px] max-xl:min-w-[140px] max-xl:flex-auto max-lg:min-w-[120px]",
        "max-md:w-9 max-md:max-w-none max-md:min-w-0 max-md:flex-none",
        "max-md:focus-within:absolute max-md:focus-within:inset-x-4 max-md:focus-within:inset-y-0 max-md:focus-within:z-[3] max-md:focus-within:flex max-md:focus-within:w-auto max-md:focus-within:items-center max-md:focus-within:bg-[var(--surface-0)]"
      )}
    >
      <Search
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[var(--text-tertiary)]",
          "max-md:left-2 max-md:size-5 max-md:text-[var(--text-secondary)] max-md:group-focus-within/search:left-3 max-md:group-focus-within/search:size-4 max-md:group-focus-within/search:text-[var(--text-tertiary)]"
        )}
        strokeWidth={1.75}
      />
      <input
        aria-activedescendant={showPopup && active ? optionId(active) : undefined}
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={showPopup}
        aria-label="Buscar produtos, módulos, aulas, telas e ações"
        autoComplete="off"
        className={cn(
          "h-9 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] pr-3 pl-9 text-sm text-[var(--text-primary)] outline-none [&::-webkit-search-cancel-button]:appearance-none",
          "placeholder:text-[var(--text-tertiary)] hover:border-[var(--border-strong)] focus:border-[var(--text-secondary)] focus:bg-[var(--surface-2)] focus-visible:outline-none!",
          "max-md:cursor-pointer max-md:border-transparent max-md:bg-transparent max-md:p-0 max-md:text-transparent max-md:placeholder:text-transparent max-md:hover:bg-[var(--press-overlay)]",
          "max-md:focus:cursor-text max-md:focus:border-[var(--text-secondary)] max-md:focus:bg-[var(--surface-1)] max-md:focus:pr-3 max-md:focus:pl-9 max-md:focus:text-[var(--text-primary)] max-md:focus:placeholder:text-[var(--text-tertiary)]",
          adminTransition
        )}
        onBlur={() => close(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveId(null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={`Buscar (${shortcut}+K)`}
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        type="search"
        value={query}
      />

      <div
        aria-label="Resultados da busca"
        className={cn(
          "absolute top-[calc(100%+6px)] right-0 left-0 z-40 max-h-[min(420px,70vh)] min-w-[280px] overflow-y-auto rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 shadow-[0_16px_40px_rgba(0,0,0,0.55)]",
          !showPopup && "hidden"
        )}
        id={listboxId}
        onPointerDown={(event) => event.preventDefault()}
        role="listbox"
      >
        {showPopup && loading && items.length > 0 ? <p className="px-2.5 pt-2 pb-1 text-xs leading-4 font-medium text-[var(--text-tertiary)]">Buscando…</p> : null}
        {showPopup && failed ? <p className="px-2.5 py-3 text-sm leading-5 text-[var(--text-secondary)]">Não foi possível buscar agora.</p> : null}
        {showPopup && nothingFound ? <p className="px-2.5 py-3 text-sm leading-5 text-[var(--text-secondary)]">Nada encontrado para “{cleaned}”.</p> : null}
        {(showPopup ? groups : []).map((group) => (
          <div aria-labelledby={`${listboxId}-${group.id}`} key={group.id} role="group">
            <p className="px-2.5 pt-2 pb-1 text-xs leading-4 font-medium text-[var(--text-tertiary)]" id={`${listboxId}-${group.id}`} role="presentation">
              {group.label}
            </p>
            {group.items.map((item) => {
              const isActive = active?.id === item.id;

              return (
                <div
                  aria-selected={isActive}
                  className={cn(
                    "flex min-h-9 cursor-pointer items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-sm leading-5 text-[var(--text-primary)]",
                    isActive && "bg-[var(--press-overlay)] outline-2 -outline-offset-2 outline-[var(--text-secondary)]"
                  )}
                  id={optionId(item)}
                  key={item.id}
                  onClick={() => run(item)}
                  onPointerMove={() => setActiveId(item.id)}
                  role="option"
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.meta ? (
                    <span className="ml-auto max-w-[55%] shrink-0 truncate text-xs leading-4 text-[var(--text-tertiary)]">{item.meta}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
