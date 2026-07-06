"use client";

import { MessageSquare, Network, ShieldCheck, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export function CommunityPlaceholder() {
  return (
    <section className="space-y-6 text-zinc-100">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-normal text-zinc-500">CRM / Comunidade</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-white">Comunidade</h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
          A comunidade fica visivel na navegacao do CRM, mas sera implementada em uma fase propria com categorias, topicos, mural e conversas.
        </p>
      </div>

      <Card className="overflow-hidden rounded-[8px] border-white/10 bg-[#17181d] py-0 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="border-amber-400/25 bg-amber-500/10 text-amber-200" variant="outline">
                Fase futura
              </Badge>
              <Badge className="border-white/10 bg-white/[0.055] text-zinc-300" variant="outline">
                Item de sidebar ativo
              </Badge>
            </div>
            <h2 className="mt-6 max-w-3xl text-2xl font-semibold leading-tight text-white">
              Base reservada para a comunidade dos alunos Bunker707.
            </h2>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-500">
              Quando entrar no escopo, esta area deve controlar comunidades, categorias, topicos, regras de participacao e integracao com moderacao.
            </p>
          </div>

          <div className="grid gap-3">
            <FutureItem icon={UsersRound} label="Mural de membros" />
            <FutureItem icon={Network} label="Categorias e topicos" />
            <FutureItem icon={MessageSquare} label="Conversas" />
            <FutureItem icon={ShieldCheck} label="Moderacao integrada" />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function FutureItem({
  icon: Icon,
  label
}: {
  icon: typeof MessageSquare | typeof Network | typeof ShieldCheck | typeof UsersRound;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-[8px] bg-white/[0.07] text-white ring-1 ring-white/10">
        <Icon className="size-4" />
      </div>
      <span className="text-sm font-semibold text-zinc-200">{label}</span>
    </div>
  );
}
