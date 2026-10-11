import { ProductTabSkeleton } from "@/components/admin/v2/products/skeletons";

export default function ProductDetailsLoading() {
  return <ProductTabSkeleton fields={6} label="Carregando os detalhes" />;
}
