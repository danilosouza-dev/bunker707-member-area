"use client";

import { CircleCheck, Download, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { importStudentsBatch } from "@/server/students/actions";
import {
  IMPORT_BATCH_SIZE,
  IMPORT_EMAIL_BATCH_SIZE,
  IMPORT_MAX_FILE_BYTES,
  IMPORT_MAX_ROWS,
  type ImportDeliveryMethod,
  type ImportRowResult,
  type StudentCohort
} from "@/server/students/model";
import {
  IMPORT_FIELDS,
  IMPORT_FIELD_LABELS,
  IMPORT_REQUIRED_FIELDS,
  buildImportPreview,
  detectImportMapping,
  importErrorsCsv,
  importTemplateCsv,
  missingRequiredFields,
  type ImportMapping,
  type ImportPreviewRow,
  type ImportProductOption
} from "@/server/students/import-model";
import { ErrorBanner } from "../error-banner";
import { AdminField, PillGroup, adminInputClass, fieldDescribedBy } from "../form";
import { AdminLinkButton } from "../link-button";
import { adminCard, adminTransition } from "../styles";
import { adminToast } from "../toast";
import { downloadTextFile } from "./export-button";
import { studentListHref } from "./hrefs";

// Importar alunos por CSV (docs/17 §1.7.2): arquivo -> colunas -> prévia com erros por linha ->
// entrega -> importacao em lotes de 25 com progresso e resumo. Tudo e lido no navegador; o servidor
// revalida cada linha. Se a aba fechar no meio, a proxima visita oferece continuar de onde parou.

type Step = "file" | "map" | "preview" | "running" | "done";

type ResumeMarker = {
  batchId: string;
  delivery: ImportDeliveryMethod;
  endsAt: string;
  fileKey: string;
  fileName: string;
  nextRow: number;
  results: ImportRowResult[];
};

const RESUME_KEY = "bunker-admin-import-alunos";
const EMAIL_WARNING_ROWS = 50;

function fileKeyOf(file: File) {
  return `${file.name}:${file.size}`;
}

function readMarker(): ResumeMarker | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);

    return raw ? (JSON.parse(raw) as ResumeMarker) : null;
  } catch {
    return null;
  }
}

function writeMarker(marker: ResumeMarker | null) {
  try {
    if (marker) {
      window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(marker));
    } else {
      window.sessionStorage.removeItem(RESUME_KEY);
    }
  } catch {
    // sessionStorage indisponivel: a importacao segue, so sem retomada.
  }
}

async function readCsvFile(file: File) {
  const buffer = await file.arrayBuffer();

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    // Excel em portugues costuma salvar em windows-1252.
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

type ImportStudentsViewProps = {
  cohorts: readonly StudentCohort[];
  products: readonly ImportProductOption[];
  today: string;
};

export function ImportStudentsView({ cohorts, products, today }: ImportStudentsViewProps) {
  const [step, setStep] = useState<Step>("file");
  const [fileName, setFileName] = useState("");
  const [fileKey, setFileKey] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [truncated, setTruncated] = useState(false);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [delivery, setDelivery] = useState<ImportDeliveryMethod>("none");
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [results, setResults] = useState<ImportRowResult[]>([]);
  const [emailLimitHit, setEmailLimitHit] = useState(false);
  const [resume, setResume] = useState<ResumeMarker | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Depois da hidratacao (sessionStorage so existe no navegador), fora do caminho sincrono do efeito.
    const timer = window.setTimeout(() => setResume(readMarker()), 0);

    return () => window.clearTimeout(timer);
  }, []);

  const preview = useMemo<ImportPreviewRow[]>(
    () => (step === "file" ? [] : buildImportPreview({ cohorts, mapping, products, rows })),
    [cohorts, mapping, products, rows, step]
  );
  const okRows = preview.filter((row): row is Extract<ImportPreviewRow, { ok: true }> => row.ok);
  const badRows = preview.filter((row): row is Extract<ImportPreviewRow, { ok: false }> => !row.ok);
  const missing = missingRequiredFields(mapping);
  const resuming = resume && resume.fileKey === fileKey ? resume : null;
  const startAt = resuming ? resuming.nextRow : 0;
  const pendingRows = okRows.filter((row) => row.index > startAt);

  async function pickFile(file: File | undefined) {
    setError(null);

    if (!file) {
      return;
    }

    if (file.size > IMPORT_MAX_FILE_BYTES) {
      setError("Arquivo acima de 2 MB. Divida a planilha em partes menores.");
      return;
    }

    const text = await readCsvFile(file);
    const parsed = parseCsv(text, { maxRows: IMPORT_MAX_ROWS });

    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setError("Não encontramos linhas no arquivo. A primeira linha precisa ter os títulos das colunas.");
      return;
    }

    const key = fileKeyOf(file);
    const marker = resume && resume.fileKey === key ? resume : null;
    setFileName(file.name);
    setFileKey(key);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setTruncated(parsed.truncated);
    setMapping(detectImportMapping(parsed.headers));
    setResults(marker?.results ?? []);
    setEmailLimitHit(false);
    // Retomada: a rodada continua com a mesma entrega e o mesmo prazo escolhidos antes.
    setDelivery(marker ? marker.delivery : parsed.rows.length > EMAIL_WARNING_ROWS ? "none" : "invite");
    setEndsAt(marker ? marker.endsAt : "");
    setStep("map");
  }

  async function run() {
    if (pendingRows.length === 0) {
      setError("Nenhuma linha válida para importar.");
      return;
    }

    setError(null);
    setStep("running");
    const batchId = resuming?.batchId ?? crypto.randomUUID();
    const previousResults = resuming?.results ?? [];
    const roundDelivery = resuming ? resuming.delivery : delivery;
    const roundEndsAt = resuming ? resuming.endsAt : endsAt;
    const collected: ImportRowResult[] = [...previousResults];
    let limitHit = false;
    setResults(collected);
    setProgress({ done: 0, total: pendingRows.length });
    const batchSize = roundDelivery === "invite" ? IMPORT_EMAIL_BATCH_SIZE : IMPORT_BATCH_SIZE;

    for (let offset = 0; offset < pendingRows.length; offset += batchSize) {
      const batch = pendingRows.slice(offset, offset + batchSize);
      const result = await importStudentsBatch({
        batchId,
        delivery: limitHit ? "none" : roundDelivery,
        endsAt: roundEndsAt || null,
        rows: batch.map((row) => row.row)
      });

      if (!result.ok) {
        setError(result.error);
        setStep("preview");
        writeMarker({ batchId, delivery: roundDelivery, endsAt: roundEndsAt, fileKey, fileName, nextRow: batch[0].index - 1, results: collected });
        setResume({ batchId, delivery: roundDelivery, endsAt: roundEndsAt, fileKey, fileName, nextRow: batch[0].index - 1, results: collected });
        return;
      }

      collected.push(...result.data.rows);
      limitHit = limitHit || result.data.emailLimitHit;
      setResults([...collected]);
      setEmailLimitHit(limitHit);
      setProgress({ done: offset + batch.length, total: pendingRows.length });
      writeMarker({ batchId, delivery: roundDelivery, endsAt: roundEndsAt, fileKey, fileName, nextRow: batch[batch.length - 1].index, results: collected });
    }

    writeMarker(null);
    setResume(null);
    setStep("done");
    adminToast.success("Importação concluída");
  }

  const created = results.filter((row) => row.status === "created").length;
  const existing = results.filter((row) => row.status === "existing").length;
  const failedServer = results.filter((row): row is Extract<ImportRowResult, { status: "failed" }> => row.status === "failed");

  function downloadErrors() {
    const byIndex = new Map(preview.map((row) => [row.index, row] as const));
    const lines = [
      ...badRows.map((row) => ({ email: row.raw.email, errors: row.errors, fullName: row.raw.fullName, index: row.index })),
      ...failedServer.map((row) => {
        const source = byIndex.get(row.index);
        const summary = source?.ok ? source.summary : null;

        return { email: summary?.email ?? "", errors: [row.error], fullName: summary?.fullName ?? "", index: row.index };
      })
    ].sort((left, right) => left.index - right.index);

    downloadTextFile(`erros-importacao.csv`, importErrorsCsv(lines));
  }

  const sectionTitle = "text-[15px] leading-5 font-semibold text-[var(--text-primary)]";
  const fieldOptions = [{ label: "Não importar", value: null as string | null }, ...headers.map((header, index) => ({ label: header || `Coluna ${index + 1}`, value: String(index) }))];

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8">
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}

      {resume && step === "file" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--text-primary)]">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-[var(--warning)]" />
          <span className="min-w-0 flex-1">
            A importação de <strong className="font-semibold">{resume.fileName}</strong> parou na linha {resume.nextRow}. Selecione o mesmo arquivo para
            continuar de onde parou.
          </span>
          <Button
            className="px-3"
            onClick={() => {
              writeMarker(null);
              setResume(null);
            }}
            type="button"
            variant="ghost"
          >
            Descartar
          </Button>
        </div>
      ) : null}

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className={sectionTitle}>1. Arquivo</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              CSV com até {IMPORT_MAX_ROWS.toLocaleString("pt-BR")} linhas e 2 MB. Colunas: Nome, E-mail e, se quiser, Telefone, Produtos e Turma.
            </p>
          </div>
          <Button className="gap-1.5 px-3" onClick={() => downloadTextFile("modelo-alunos.csv", importTemplateCsv())} type="button" variant="ghost">
            <Download aria-hidden="true" className="size-4" />
            Baixar modelo
          </Button>
        </div>
        <label
          className={cn(
            adminCard,
            "flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 border-dashed px-4 py-6 text-center hover:border-[var(--border-strong)]",
            adminTransition
          )}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void pickFile(event.dataTransfer.files?.[0]);
          }}
        >
          <FileSpreadsheet aria-hidden="true" className="size-6 text-[var(--text-tertiary)]" />
          <span className="text-sm text-[var(--text-primary)]">{fileName ? fileName : "Arraste o CSV aqui ou clique para escolher"}</span>
          <span className="text-xs text-[var(--text-tertiary)]">
            {rows.length > 0 ? `${rows.length.toLocaleString("pt-BR")} ${rows.length === 1 ? "linha" : "linhas"}${truncated ? ` (acima de ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")}: o resto ficou de fora)` : ""}` : "Separado por vírgula ou ponto e vírgula"}
          </span>
          <input
            accept=".csv,text/csv"
            className="sr-only"
            disabled={step === "running"}
            onChange={(event) => void pickFile(event.target.files?.[0])}
            ref={fileInput}
            type="file"
          />
        </label>
      </section>

      {step !== "file" ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>2. Colunas</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)]">
              Confira qual coluna do arquivo é cada campo. Produtos podem vir pelo nome (separados por | ou ;) e a turma pelo nome, já criada.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {IMPORT_FIELDS.map((field) => (
              <AdminField id={`importar-${field}`} key={field} label={IMPORT_FIELD_LABELS[field]} optional={!IMPORT_REQUIRED_FIELDS.includes(field)}>
                <Select
                  disabled={step === "running"}
                  items={fieldOptions}
                  onValueChange={(value) =>
                    setMapping((current) => {
                      const next = { ...current };

                      if (value === null || value === undefined) {
                        delete next[field];
                      } else {
                        next[field] = Number(value);
                      }

                      return next;
                    })
                  }
                  value={mapping[field] === undefined ? null : String(mapping[field])}
                >
                  <SelectTrigger className={cn("w-full rounded-lg border-[var(--border-strong)] bg-[var(--surface-2)] pr-2.5 pl-3 text-sm text-[var(--text-primary)] data-[size=default]:h-10", adminTransition)} id={`importar-${field}`}>
                    <SelectValue className="min-w-0 truncate" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 border border-[var(--border-strong)] bg-[var(--surface-3)] text-[var(--text-primary)] ring-0">
                    {fieldOptions.map((option) => (
                      <SelectItem key={option.value ?? "none"} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </AdminField>
            ))}
          </div>
          {missing.length > 0 ? (
            <p className="text-[13px] text-[var(--error)]">Falta escolher a coluna de {missing.map((field) => IMPORT_FIELD_LABELS[field]).join(" e ")}.</p>
          ) : step === "map" ? (
            <div>
              <Button className="px-4" onClick={() => setStep("preview")} type="button">
                Ver prévia
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "preview" || step === "running" || step === "done" ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className={sectionTitle}>3. Prévia</h2>
            <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
              {okRows.length} {okRows.length === 1 ? "linha pronta" : "linhas prontas"}
              {badRows.length > 0 ? ` · ${badRows.length} com erro (ficam de fora)` : ""}
              {resuming ? ` · ${startAt} já importadas antes` : ""}.
            </p>
          </div>
          <div className={cn(adminCard, "max-h-80 overflow-auto")}>
            <table className="w-full text-sm text-[var(--text-secondary)]">
              <caption className="sr-only">Linhas do arquivo</caption>
              <thead>
                <tr className="text-left text-xs text-[var(--text-tertiary)]">
                  <th className="px-3 py-2 font-medium" scope="col">Linha</th>
                  <th className="px-3 py-2 font-medium" scope="col">Nome</th>
                  <th className="px-3 py-2 font-medium" scope="col">E-mail</th>
                  <th className="px-3 py-2 font-medium" scope="col">Produtos</th>
                  <th className="px-3 py-2 font-medium" scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 200).map((row) => (
                  <tr className="border-t border-[var(--border-subtle)]" key={row.index}>
                    <td className="px-3 py-1.5 tabular-nums">{row.index}</td>
                    <td className="max-w-[200px] truncate px-3 py-1.5 text-[var(--text-primary)]">{row.ok ? row.summary.fullName : row.raw.fullName || "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5">{row.ok ? row.summary.email : row.raw.email || "—"}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5">{row.ok ? row.summary.productTitles.join(", ") || "—" : "—"}</td>
                    <td className={cn("px-3 py-1.5", row.ok ? "text-[var(--success)]" : "text-[var(--error)]")}>{row.ok ? (row.index <= startAt ? "já importada" : "pronta") : row.errors.join("; ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 200 ? <p className="px-3 py-2 text-xs text-[var(--text-tertiary)]">Mostrando as 200 primeiras linhas.</p> : null}
          </div>
          {badRows.length > 0 ? (
            <div>
              <Button className="gap-1.5 px-3" onClick={downloadErrors} type="button" variant="ghost">
                <Download aria-hidden="true" className="size-4" />
                Baixar linhas com erro
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {step === "preview" ? (
        <section className="flex flex-col gap-4">
          <h2 className={sectionTitle}>4. Acesso</h2>
          {resuming ? (
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              Continuando a rodada anterior com a mesma entrega e o mesmo prazo.
            </p>
          ) : null}
          <PillGroup
            ariaLabel="Como entregar o acesso"
            disabled={Boolean(resuming)}
            name="importar-entrega"
            onChange={setDelivery}
            options={[
              { label: "Convite por e-mail", value: "invite" },
              { label: "Não enviar agora", value: "none" }
            ]}
            value={delivery}
          />
          <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {delivery === "invite"
              ? "Cada aluno novo recebe um e-mail para criar a senha. Quem já tem conta não recebe e-mail. O envio depende do limite de e-mail da plataforma; se ele for atingido, as contas seguem sendo criadas e os e-mails ficam para depois."
              : "As contas ficam prontas sem e-mail. Depois, envie o convite pelo perfil ou em massa pela lista."}
            {pendingRows.length > EMAIL_WARNING_ROWS && delivery === "invite" ? ` São ${pendingRows.length} e-mails: confira o limite antes.` : ""}
          </p>
          <AdminField hint="Vale para os produtos da planilha. Em branco, o acesso não vence." id="importar-prazo" label="Acesso até" optional>
            <Input aria-describedby={fieldDescribedBy("importar-prazo", { hint: true })} className={cn(adminInputClass, "max-w-[220px] [color-scheme:dark]")} disabled={Boolean(resuming)} id="importar-prazo" min={today} onChange={(event) => setEndsAt(event.target.value)} type="date" value={endsAt} />
          </AdminField>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-5">
            <Button className="px-4" disabled={pendingRows.length === 0} onClick={() => void run()} type="button">
              {resuming ? `Continuar: importar ${pendingRows.length} ${pendingRows.length === 1 ? "aluno" : "alunos"}` : `Importar ${pendingRows.length} ${pendingRows.length === 1 ? "aluno" : "alunos"}`}
            </Button>
            <AdminLinkButton href={studentListHref()} variant="ghost">
              Cancelar
            </AdminLinkButton>
          </div>
        </section>
      ) : null}

      {step === "running" ? (
        <section aria-live="polite" className="flex flex-col gap-2">
          <p className="text-sm text-[var(--text-primary)] tabular-nums">
            Importando {progress.done} de {progress.total}… Mantenha esta aba aberta.
          </p>
          <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div className="h-full rounded-full bg-[var(--text-primary)] transition-[width]" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        </section>
      ) : null}

      {step === "done" ? (
        <section className={cn(adminCard, "flex flex-col gap-4 p-5")}>
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success)]">
              <CircleCheck aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg leading-7 font-semibold text-[var(--text-primary)]">Importação concluída</h2>
              <p className="mt-1 text-sm leading-5 text-[var(--text-secondary)] tabular-nums">
                {created} {created === 1 ? "aluno criado" : "alunos criados"} · {existing} já {existing === 1 ? "existia" : "existiam"}
                {failedServer.length > 0 ? ` · ${failedServer.length} com erro` : ""}
                {badRows.length > 0 ? ` · ${badRows.length} ignoradas na prévia` : ""}.
              </p>
              {emailLimitHit ? (
                <p className="mt-2 text-[13px] leading-5 text-[var(--warning)]">
                  O limite de e-mail da plataforma foi atingido: parte dos convites não saiu. Envie depois pela lista, com “Reenviar convite”.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <AdminLinkButton href={studentListHref()}>Ver alunos</AdminLinkButton>
            {failedServer.length > 0 || badRows.length > 0 ? (
              <Button className="gap-1.5 px-3" onClick={downloadErrors} type="button" variant="secondary">
                <Download aria-hidden="true" className="size-4" />
                Baixar erros
              </Button>
            ) : null}
            <Button
              className="px-3"
              onClick={() => {
                setStep("file");
                setFileName("");
                setFileKey("");
                setRows([]);
                setHeaders([]);
                setResults([]);
              }}
              type="button"
              variant="ghost"
            >
              Importar outro arquivo
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
