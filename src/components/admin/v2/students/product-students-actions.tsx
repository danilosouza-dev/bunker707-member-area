"use client";

import { Plus, UserRoundPlus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AdminLinkButton } from "../link-button";
import { GrantAccessToStudentsDialog } from "./grant-access-to-students-dialog";
import { newStudentHref } from "./hrefs";

// Acoes da aba Alunos do produto: liberar para alunos que ja existem ou adicionar um aluno novo
// (ja com este produto marcado).

type ProductStudentsActionsProps = {
  productId: string;
  productTitle: string;
  today: string;
};

export function ProductStudentsActions({ productId, productTitle, today }: ProductStudentsActionsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <AdminLinkButton className="gap-1.5" href={newStudentHref(productId)} variant="secondary">
        <UserRoundPlus aria-hidden="true" className="size-4" />
        Adicionar aluno
      </AdminLinkButton>
      <Button className="gap-1.5 px-4" onClick={() => setOpen(true)} type="button">
        <Plus aria-hidden="true" className="size-4" />
        Liberar acesso
      </Button>
      <GrantAccessToStudentsDialog onOpenChange={setOpen} open={open} productId={productId} productTitle={productTitle} today={today} />
    </div>
  );
}
