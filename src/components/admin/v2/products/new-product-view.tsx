import { PageHeader } from "../page-header";
import { NewProductForm } from "./new-product-form";

// Novo produto (docs/17 §1.6.2) na disposicao do prototipo aprovado: migalha "Produtos / Novo
// produto" acima do H1, frase de apoio e a coluna de 640 px do formulario. Dentro de uma Formação
// ("Criar curso aqui"), a migalha passa pela formação. Apresentacao pura; a pagina confere permissao.

type NewProductViewProps = {
  /** Pode decidir quem ve, o link de venda e criar Formação ("regras de acesso e venda"). */
  canSetAccess: boolean;
  parentFormation: { id: string; title: string } | null;
};

export function NewProductView({ canSetAccess, parentFormation }: NewProductViewProps) {
  return (
    <>
      <PageHeader
        breadcrumb={[
          { href: "/admin/produtos", label: "Produtos" },
          ...(parentFormation ? [{ href: `/admin/produtos/${parentFormation.id}`, label: parentFormation.title }] : []),
          { label: parentFormation ? "Novo curso" : "Novo produto" }
        ]}
        description={
          parentFormation
            ? "Só o nome é obrigatório. O curso nasce em rascunho, já dentro da formação."
            : "Só o nome é obrigatório. O produto nasce em rascunho e você monta o conteúdo logo em seguida."
        }
        title={parentFormation ? "Novo curso" : "Novo produto"}
      />
      <NewProductForm canSetAccess={canSetAccess} parentFormation={parentFormation} />
    </>
  );
}
