import { ProductTabSkeleton } from "@/components/admin/v2/products/skeletons";

export default function ProductAccessLoading() {
  return <ProductTabSkeleton fields={5} label="Carregando acesso e venda" />;
}
