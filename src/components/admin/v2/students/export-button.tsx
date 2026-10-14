"use client";

import { Download } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportStudentsCsv } from "@/server/students/actions";
import type { StudentListParams } from "@/server/students/model";
import { adminToast } from "../toast";

// Exportar CSV (docs/17 §1.7.4): o servidor devolve o texto e o navegador baixa. Nenhum filtro vai
// para o endereco. Erro aparece no proprio botao (texto abaixo), nunca em toast.

type ExportButtonProps = {
  className?: string;
  /** Selecao de ate 200 ids; sem ela, exporta o filtro atual. */
  ids?: readonly string[];
  params: StudentListParams;
  variant?: "secondary" | "ghost";
};

export function downloadTextFile(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function ExportButton({ className, ids, params, variant = "secondary" }: ExportButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const result = await exportStudentsCsv({ ids: ids ? Array.from(ids) : undefined, params });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    downloadTextFile(result.data.fileName, result.data.csv);
    adminToast.success(result.data.rows === 1 ? "1 aluno exportado" : `${result.data.rows} alunos exportados`);
  }

  return (
    <span className={className}>
      <Button className="gap-1.5 px-3" disabled={pending} onClick={() => void run()} type="button" variant={variant}>
        <Download aria-hidden="true" className="size-4" />
        {pending ? "Gerando…" : "Exportar CSV"}
      </Button>
      {error ? <span className="mt-1 block text-[13px] text-[var(--error)]">{error}</span> : null}
    </span>
  );
}
