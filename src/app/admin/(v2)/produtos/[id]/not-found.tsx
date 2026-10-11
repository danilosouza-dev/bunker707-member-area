import { ProductNotFound } from "@/components/admin/v2/products/product-not-found";

// Aba de um produto que nao existe mais (a pagina chamou notFound()). O cabecalho do layout ja
// cuida do produto inexistente; aqui fica so o corpo.
export default function ProductTabNotFound() {
  return <ProductNotFound />;
}
