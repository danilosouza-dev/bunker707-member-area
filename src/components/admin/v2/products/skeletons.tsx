import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AdminPage } from "../page-container";
import { adminCard, adminDelayedReveal } from "../styles";

// Skeletons de Produtos com a forma final de cada tela (docs/17 §2.7), nas medidas do prototipo
// aprovado: aparecem depois de 300 ms.

const bar = "bg-[var(--surface-2)] motion-reduce:animate-none";

function LoadingStatus({ label }: { label: string }) {
  return (
    <span aria-live="polite" className="sr-only" role="status">
      {label}
    </span>
  );
}

function HeaderBlock({ actions = 2, breadcrumb = false }: { actions?: number; breadcrumb?: boolean }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-wrap items-end justify-between gap-4", adminDelayedReveal)}>
      <div className="flex flex-col gap-1">
        {breadcrumb ? <Skeleton className={cn("mb-2 h-4 w-40", bar)} /> : null}
        <Skeleton className={cn("h-[30px] w-48 max-w-full", bar)} />
        <Skeleton className={cn("h-5 w-28", bar)} />
      </div>
      {actions > 0 ? (
        <div className="flex gap-2">
          {Array.from({ length: actions }, (_, index) => (
            <Skeleton className={cn("h-9 w-36 rounded-lg", bar)} key={index} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Lista de produtos: cabecalho, filtros (pilulas, Formato, busca) e a tabela de 36 + 48 px. */
export function ProductListSkeleton() {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label="Carregando produtos" />
      <HeaderBlock />
      <div className="flex flex-col gap-3">
        <div aria-hidden="true" className={cn("flex flex-wrap items-center gap-2", adminDelayedReveal)}>
          {/* Larguras repetem (92), entao a chave e a posicao: a lista e fixa e nunca reordena. */}
          {[90, 92, 92, 94].map((width, index) => (
            <Skeleton className={cn("h-[34px] rounded-full", bar)} key={index} style={{ width }} />
          ))}
          <Skeleton className={cn("ml-1 hidden h-9 w-[160px] rounded-lg md:block", bar)} />
          <Skeleton className={cn("h-9 w-[280px] max-w-full rounded-lg md:ml-auto", bar)} />
        </div>
        <div aria-hidden="true" className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          {Array.from({ length: 8 }, (_, index) => (
            <div className="flex h-12 items-center gap-3 border-b border-[var(--border-subtle)] px-4 last:border-b-0" key={index}>
              <div className={cn("flex flex-1 items-center gap-2.5", adminDelayedReveal)}>
                <Skeleton className={cn("size-7 rounded-md", bar)} />
                <Skeleton className={cn("h-4 w-48 max-w-[40%]", bar)} />
                <Skeleton className={cn("ml-auto h-[22px] w-20 rounded-md", bar)} />
                <Skeleton className={cn("hidden h-4 w-28 md:block", bar)} />
                <Skeleton className={cn("hidden h-4 w-10 md:block", bar)} />
                <Skeleton className={cn("hidden h-4 w-10 md:block", bar)} />
                <Skeleton className={cn("hidden h-4 w-20 lg:block", bar)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </AdminPage>
  );
}

/** Campos de formulario em coluna de 640 px (Novo produto, Detalhes, Acesso e venda, Importar). */
export function ProductFieldsSkeleton({ fields = 5 }: { fields?: number }) {
  return (
    <div aria-hidden="true" className="flex w-full max-w-[640px] flex-col gap-6">
      {Array.from({ length: fields }, (_, index) => (
        <div className={cn("flex flex-col gap-2", adminDelayedReveal)} key={index}>
          <Skeleton className={cn("h-4 w-28", bar)} />
          <Skeleton className={cn("h-10 w-full rounded-lg", bar)} />
        </div>
      ))}
    </div>
  );
}

/** Pagina de formulario com migalha e cabecalho (Novo produto, Importar). */
export function ProductFormPageSkeleton({ label }: { label: string }) {
  return (
    <AdminPage className="gap-6">
      <LoadingStatus label={label} />
      <HeaderBlock actions={0} breadcrumb />
      <ProductFieldsSkeleton />
    </AdminPage>
  );
}

/** Cabecalho do produto: migalha, capa de 28 px, nome, Situação, Ver como aluno, "…" e as abas de 40 px. */
export function ProductHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="-mx-[clamp(16px,3vw,32px)] -mt-2 px-[clamp(16px,3vw,32px)] pt-4 md:-mt-6">
      <div className={adminDelayedReveal}>
        <Skeleton className={cn("h-5 w-56", bar)} />
        <div className="mt-2 mb-3 flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-[1_1_280px] items-center gap-3">
            <Skeleton className={cn("size-7 rounded-md", bar)} />
            <Skeleton className={cn("h-[30px] w-72 max-w-[70%]", bar)} />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className={cn("h-8 w-28 rounded-md", bar)} />
            <Skeleton className={cn("h-9 w-36 rounded-lg", bar)} />
            <Skeleton className={cn("size-8 rounded-lg", bar)} />
          </div>
        </div>
      </div>
      <div className="flex h-10 items-center gap-6 border-b border-[var(--border-subtle)] px-3">
        <div className={cn("flex items-center gap-6", adminDelayedReveal)}>
          {[64, 60, 100, 48, 84].map((width, index) => (
            <Skeleton className={cn("h-4", bar)} key={index} style={{ width }} />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Corpo de uma aba do produto enquanto carrega (o cabecalho fica). */
export function ProductTabSkeleton({ label, fields = 5 }: { fields?: number; label: string }) {
  return (
    <>
      <LoadingStatus label={label} />
      <ProductFieldsSkeleton fields={fields} />
    </>
  );
}

/** Pagina do produto inteira (enquanto o cabecalho carrega). */
export function ProductWorkspaceSkeleton() {
  return (
    <>
      <LoadingStatus label="Carregando o produto" />
      <ProductHeaderSkeleton />
      <ProductFieldsSkeleton fields={4} />
    </>
  );
}

/** Aba Alunos: a linha "N alunos com acesso" + acao e o cartao da tabela. */
export function ProductStudentsSkeleton() {
  return (
    <>
      <LoadingStatus label="Carregando os alunos" />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className={cn("flex min-h-9 items-center justify-between gap-3", adminDelayedReveal)}>
          <Skeleton className={cn("h-5 w-40", bar)} />
          <Skeleton className={cn("h-9 w-56 rounded-lg", bar)} />
        </div>
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className="h-9 border-b border-[var(--border-subtle)]" />
          <div className={cn("flex flex-col items-center gap-3 px-6 py-8", adminDelayedReveal)}>
            <Skeleton className={cn("h-6 w-72 max-w-full", bar)} />
            <Skeleton className={cn("h-5 w-96 max-w-full", bar)} />
          </div>
        </div>
      </div>
    </>
  );
}

/** Aba Desempenho: a faixa e os tres cartoes (funil, progresso, por aula). */
export function ProductPerformanceSkeleton() {
  return (
    <>
      <LoadingStatus label="Carregando o desempenho" />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className={cn(adminCard, "h-[42px]")} />
        {[3, 4].map((rows, cardIndex) => (
          <div className={cn(adminCard, "flex flex-col gap-2 p-4")} key={cardIndex}>
            <div className={cn("flex flex-col gap-3", adminDelayedReveal)}>
              <Skeleton className={cn("h-6 w-48", bar)} />
              {Array.from({ length: rows }, (_, index) => (
                <div className="flex h-8 items-center gap-4" key={index}>
                  <Skeleton className={cn("h-4 w-40 shrink-0", bar)} />
                  <Skeleton className={cn("h-2 flex-1 rounded-[4px]", bar)} />
                  <Skeleton className={cn("hidden h-4 w-48 shrink-0 md:block", bar)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className={cn(adminCard, "overflow-hidden")}>
          <div className={cn("px-4 pt-4 pb-2", adminDelayedReveal)}>
            <Skeleton className={cn("h-6 w-24", bar)} />
          </div>
          <div className="h-12 border-b border-[var(--border-subtle)]" />
          {Array.from({ length: 5 }, (_, index) => (
            <div className="flex h-12 items-center gap-4 border-b border-[var(--border-subtle)] px-4 last:border-b-0" key={index}>
              <Skeleton className={cn("h-4 w-56 max-w-[50%]", bar, adminDelayedReveal)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
