"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { grantStudentAccess, searchStudentOptions } from "@/server/students/actions";
import type { StudentOption } from "@/server/students/model";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "../products/dialog-frame";
import { StatusChip } from "../status-chip";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { StudentAvatar } from "./student-avatar";

// "Liberar acesso" na aba Alunos do produto: busca alunos existentes pelo nome ou e-mail, marca um
// ou varios e libera este produto (com prazo opcional). Aluno novo vem por "Adicionar aluno".

const SEARCH_DEBOUNCE_MS = 250;

type GrantAccessToStudentsDialogProps = {
  onOpenChange: (open: boolean) => void;
  open: boolean;
  productId: string;
  productTitle: string;
  /** Hoje ("AAAA-MM-DD"), calculado no servidor. */
  today: string;
};

export function GrantAccessToStudentsDialog({ onOpenChange, open, productId, productTitle, today }: GrantAccessToStudentsDialogProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [options, setOptions] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StudentOption[]>([]);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void searchStudentOptions({ productId, q: search }).then((result) => {
        if (cancelled) {
          return;
        }

        setLoading(false);

        if (result.ok) {
          setOptions(result.data);
        } else {
          setError(result.error);
        }
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, productId, search]);

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (!next) {
      setSearch("");
      setSelected([]);
      setEndsAt("");
      setError(null);
    }

    onOpenChange(next);
  }

  function toggle(option: StudentOption, checked: boolean) {
    setSelected((current) => (checked ? [...current.filter((item) => item.id !== option.id), option] : current.filter((item) => item.id !== option.id)));
  }

  async function submit() {
    if (selected.length === 0) {
      setError("Marque pelo menos um aluno.");
      return;
    }

    setPending(true);
    setError(null);
    let granted = 0;

    for (const student of selected) {
      const result = await grantStudentAccess({ endsAt: endsAt || null, productIds: [productId], userId: student.id });

      if (!result.ok) {
        setPending(false);
        setError(`${student.fullName}: ${result.error}`);
        router.refresh();
        return;
      }

      granted += result.data.granted;
    }

    setPending(false);
    adminToast.success(granted === 1 ? "Acesso liberado" : `Acesso liberado para ${granted} alunos`);
    handleOpenChange(false);
    router.refresh();
  }

  const selectedIds = new Set(selected.map((item) => item.id));

  return (
    <ProductDialog
      className="max-w-[560px]"
      description={`Quem passa a ver ${productTitle}. Quem já tem acesso recebe o novo prazo.`}
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} onClick={() => void submit()} type="button">
            {pending ? "Liberando…" : selected.length > 1 ? `Liberar para ${selected.length} alunos` : "Liberar acesso"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title="Liberar acesso"
    >
      <div className="flex flex-col gap-4">
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}

        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <label className="sr-only" htmlFor="liberar-aluno-busca">
            Buscar aluno por nome ou e-mail
          </label>
          <Input
            autoComplete="off"
            autoFocus
            className={cn(adminInputClass, "h-9 pl-8")}
            disabled={pending}
            id="liberar-aluno-busca"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou e-mail"
            type="search"
            value={search}
          />
        </div>

        <div aria-busy={loading || undefined} aria-label="Alunos" className={cn(adminCard, "max-h-64 overflow-y-auto")} role="group">
          {options.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
              {loading ? "Buscando…" : search.trim() ? `Nenhum aluno com “${search.trim()}”.` : "Nenhum aluno cadastrado ainda."}
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border-subtle)]">
              {options.map((option) => (
                <li key={option.id}>
                  <label className={cn("flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-[var(--hover-overlay)]", adminTransition)}>
                    <Checkbox
                      checked={selectedIds.has(option.id)}
                      className="border-[var(--border-stronger)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-0)]"
                      disabled={pending}
                      onCheckedChange={(next) => toggle(option, next === true)}
                    />
                    <StudentAvatar avatarUrl={option.avatarUrl} name={option.fullName} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--text-primary)]">{option.fullName}</span>
                      <span className="block truncate text-xs text-[var(--text-tertiary)]">{option.email}</span>
                    </span>
                    {option.hasAccess ? <StatusChip tone="success">Já tem acesso</StatusChip> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        {selected.length > 0 ? (
          <p className="text-[13px] text-[var(--text-secondary)]">
            Marcados: {selected.map((item) => item.fullName).join(", ")}
          </p>
        ) : null}

        <AdminField hint="Em branco, o acesso não vence." id="liberar-alunos-prazo" label="Acesso até" optional>
          <Input
            aria-describedby={fieldDescribedBy("liberar-alunos-prazo", { hint: true })}
            className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")}
            disabled={pending}
            id="liberar-alunos-prazo"
            min={today}
            onChange={(event) => setEndsAt(event.target.value)}
            type="date"
            value={endsAt}
          />
        </AdminField>
      </div>
    </ProductDialog>
  );
}
