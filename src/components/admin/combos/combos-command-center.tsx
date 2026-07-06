"use client";

import * as React from "react";
import { Boxes, CheckCircle2, PackagePlus, PauseCircle, Pencil, Search, Trash2, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  AdminProductCombo,
  AdminProductComboStatus,
  AdminSellableProduct
} from "@/lib/platform-types";

type CombosCommandCenterProps = {
  cohorts: string[];
  combos: AdminProductCombo[];
  onDeleteCombo: (comboId: string) => Promise<void> | void;
  onUpsertCombo: (combo: AdminProductCombo) => Promise<void> | void;
  products: AdminSellableProduct[];
};

const statusLabels: Record<AdminProductComboStatus, string> = {
  active: "Ativo",
  draft: "Rascunho",
  paused: "Pausado"
};

function makeId(prefix: string, value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${prefix}-${slug || Date.now().toString(36)}`;
}

function getStatusClassName(status: AdminProductComboStatus) {
  if (status === "active") {
    return "border-emerald-400/25 bg-emerald-500/10 text-emerald-200";
  }

  if (status === "paused") {
    return "border-amber-400/25 bg-amber-500/10 text-amber-200";
  }

  return "border-white/10 bg-white/[0.055] text-zinc-300";
}

export function CombosCommandCenter({
  cohorts,
  combos,
  onDeleteCombo,
  onUpsertCombo,
  products
}: CombosCommandCenterProps) {
  const defaultCohort = cohorts[0] ?? "Turma A";
  const [query, setQuery] = React.useState("");
  const [editingComboId, setEditingComboId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [cohortName, setCohortName] = React.useState(defaultCohort);
  const [selectedProductIds, setSelectedProductIds] = React.useState<string[]>([]);
  const normalizedQuery = query.trim().toLowerCase();
  const productMap = React.useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const filteredCombos = React.useMemo(() => (
    combos.filter((combo) => {
      if (!normalizedQuery) {
        return true;
      }

      return [
        combo.name,
        combo.description,
        combo.cohortName,
        ...combo.productIds.map((productId) => productMap.get(productId)?.title ?? "")
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    })
  ), [combos, normalizedQuery, productMap]);
  const activeCombos = combos.filter((combo) => combo.status === "active").length;
  const totalTargets = combos.reduce((total, combo) => total + combo.productIds.length, 0);
  const editingCombo = editingComboId ? combos.find((combo) => combo.id === editingComboId) : undefined;

  function resetForm() {
    setEditingComboId(null);
    setName("");
    setDescription("");
    setSelectedProductIds([]);
    setCohortName(defaultCohort);
  }

  function editCombo(combo: AdminProductCombo) {
    setEditingComboId(combo.id);
    setName(combo.name);
    setDescription(combo.description);
    setSelectedProductIds(combo.productIds);
    setCohortName(combo.cohortName || defaultCohort);
  }

  async function handleCreateCombo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();

    if (!trimmedName || selectedProductIds.length === 0) {
      return;
    }

    const nextCombo: AdminProductCombo = {
      cohortName: cohortName.trim() || defaultCohort,
      createdAt: editingCombo?.createdAt ?? new Date().toISOString(),
      description: description.trim(),
      id: editingCombo?.id ?? makeId("combo", trimmedName),
      name: trimmedName,
      productIds: selectedProductIds,
      status: editingCombo?.status ?? "active",
      studentsCount: editingCombo?.studentsCount ?? 0,
      updatedAt: new Date().toISOString()
    };

    await onUpsertCombo(nextCombo);
    resetForm();
  }

  async function updateComboStatus(comboId: string, status: AdminProductComboStatus) {
    const combo = combos.find((item) => item.id === comboId);

    if (!combo) {
      return;
    }

    await onUpsertCombo({ ...combo, status, updatedAt: new Date().toISOString() });
  }

  async function removeCombo(comboId: string) {
    await onDeleteCombo(comboId);

    if (editingComboId === comboId) {
      resetForm();
    }
  }

  function toggleProduct(productId: string) {
    setSelectedProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  }

  return (
    <section className="space-y-6 text-zinc-100">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">CRM / Produtos</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Combos</h1>
          <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
            Monte pacotes internos com produtos existentes. A compra externa do combo deve gerar entitlement para todos os produtos incluidos.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard detail={`${combos.length} cadastrados`} icon={Boxes} label="Combos ativos" value={activeCombos.toString()} />
        <MetricCard detail="Produtos incluidos em combos" icon={PackagePlus} label="Acessos agregados" value={totalTargets.toString()} />
        <MetricCard detail="Fallback automatico quando nada for criado" icon={CheckCircle2} label="Turma padrao" value={defaultCohort} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base font-semibold text-white">Combos cadastrados</CardTitle>
              <label className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <span className="sr-only">Buscar combo</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] pr-10 pl-3 text-sm font-semibold text-white placeholder:text-zinc-600 focus-visible:border-white/30 focus-visible:ring-white/10"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por nome, turma ou produto"
                  type="search"
                  value={query}
                />
              </label>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {filteredCombos.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-lg font-semibold text-white">Nenhum combo encontrado.</p>
                <p className="mt-2 text-sm font-medium text-zinc-500">
                  Crie um combo para agrupar cursos, mentorias, formacoes e bootcamps em um unico pacote de acesso.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/10">
                {filteredCombos.map((combo) => (
                  <article className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]" key={combo.id}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-base font-semibold text-white">{combo.name}</h2>
                        <Badge className={getStatusClassName(combo.status)} variant="outline">
                          {statusLabels[combo.status]}
                        </Badge>
                        <Badge className="border-white/10 bg-white/[0.055] text-zinc-300" variant="outline">
                          {combo.cohortName || defaultCohort}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm font-medium leading-6 text-zinc-500">
                        {combo.description || "Combo sem descricao cadastrada."}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {combo.productIds.map((productId) => (
                          <span
                            className="rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-zinc-300"
                            key={productId}
                          >
                            {productMap.get(productId)?.title ?? "Produto removido"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <Select
                        onValueChange={(value) => {
                          if (typeof value === "string") {
                            void updateComboStatus(combo.id, value as AdminProductComboStatus);
                          }
                        }}
                        value={combo.status}
                      >
                        <SelectTrigger className="h-9 w-36 rounded-[8px] border-[#2a2d35] bg-[#111217] text-xs font-semibold text-zinc-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100">
                          <SelectItem value="active">Ativo</SelectItem>
                          <SelectItem value="draft">Rascunho</SelectItem>
                          <SelectItem value="paused">Pausado</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        aria-label={`Editar combo ${combo.name}`}
                        className="size-9 rounded-[8px] border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-white/10 hover:text-white"
                        onClick={() => editCombo(combo)}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        aria-label={`Excluir combo ${combo.name}`}
                        className="size-9 rounded-[8px] border-white/10 bg-white/[0.04] text-zinc-400 hover:bg-red-500/10 hover:text-red-200"
                        onClick={() => removeCombo(combo.id)}
                        size="icon-sm"
                        type="button"
                        variant="outline"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardHeader className="border-b border-white/10 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-white">
                <PackagePlus className="size-4 text-zinc-400" />
                {editingCombo ? "Editar combo" : "Criar combo"}
              </CardTitle>
              {editingCombo ? (
                <Button
                  aria-label="Cancelar edicao do combo"
                  className="size-8 rounded-[8px] text-zinc-500 hover:bg-white/10 hover:text-white"
                  onClick={resetForm}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <X className="size-4" />
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-5">
            <form className="space-y-4" onSubmit={handleCreateCombo}>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Nome</span>
                <Input
                  className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-white placeholder:text-zinc-600"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Combo Formacao + Mentoria"
                  value={name}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Descricao interna</span>
                <textarea
                  className="min-h-24 resize-none rounded-[8px] border border-[#2a2d35] bg-[#111217] px-3 py-2 text-sm font-medium leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-white/30 focus:ring-3 focus:ring-white/10"
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Explique o que esse combo libera."
                  value={description}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold text-zinc-500">Turma</span>
                <Select
                  onValueChange={(value) => {
                    if (typeof value === "string") {
                      setCohortName(value);
                    }
                  }}
                  value={cohortName}
                >
                  <SelectTrigger className="h-10 rounded-[8px] border-[#2a2d35] bg-[#111217] text-sm font-semibold text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="rounded-[8px] border-[#2a2d35] bg-[#17181d] text-zinc-100">
                    {cohorts.map((cohort) => (
                      <SelectItem key={cohort} value={cohort}>
                        {cohort}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <div className="grid gap-2">
                <span className="text-xs font-semibold text-zinc-500">Produtos incluidos</span>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-[8px] border border-white/10 bg-black/20 p-2">
                  {products.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm font-medium text-zinc-500">
                      Cadastre produtos antes de montar combos.
                    </p>
                  ) : products.map((product) => {
                    const checked = selectedProductIds.includes(product.id);

                    return (
                      <button
                        className={cn(
                          "flex w-full items-center gap-3 rounded-[8px] border px-3 py-2 text-left transition",
                          checked
                            ? "border-emerald-400/25 bg-emerald-500/10"
                            : "border-white/10 bg-white/[0.035] hover:bg-white/[0.07]"
                        )}
                        key={product.id}
                        onClick={() => toggleProduct(product.id)}
                        type="button"
                      >
                        <Checkbox checked={checked} className="pointer-events-none" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-white">{product.title}</span>
                          <span className="text-xs font-medium text-zinc-500">{product.kind}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                className="h-10 w-full rounded-[8px] bg-white text-sm font-semibold text-black hover:bg-zinc-200"
                disabled={!name.trim() || selectedProductIds.length === 0}
                type="submit"
              >
                <Boxes className="size-4" />
                {editingCombo ? "Atualizar combo" : "Salvar combo"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function MetricCard({
  detail,
  icon: Icon,
  label,
  value
}: {
  detail: string;
  icon: typeof Boxes | typeof CheckCircle2 | typeof PackagePlus | typeof PauseCircle;
  label: string;
  value: string;
}) {
  return (
    <Card className="rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
      <CardContent className="flex items-center gap-4 p-5">
        <div className="grid size-11 shrink-0 place-items-center rounded-[8px] bg-white/[0.07] text-white ring-1 ring-white/10">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-zinc-500">{label}</p>
          <p className="mt-1 truncate text-2xl font-semibold text-white">{value}</p>
          <p className="mt-1 truncate text-xs font-medium text-zinc-600">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}
