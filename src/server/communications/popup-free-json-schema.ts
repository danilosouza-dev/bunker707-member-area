import { z } from "zod";
import { popupFreeDesignInputSchema } from "./popup-free-schema";

// JSON Schema do design Livre para o PR "Criar com IA" (docs/27 §9.8; spec §5.7). Modulo proprio, que nenhuma tela
// importa de proposito: o `z.toJSONSchema` puxa para o pedaco compartilhado do zod (o mesmo que o Inicio do aluno ja
// baixa) os conversores de todos os tipos, e o build nao descarta exportacoes sem uso de um modulo que a tela
// importa. Quem gera o JSON Schema (a rota da IA, os testes) importa daqui.

/** JSON Schema da entrada do Livre (`io: "input"`); o elemento recursivo sai em `$defs`/`$ref`. */
export function popupFreeJsonSchema(): object {
  return z.toJSONSchema(popupFreeDesignInputSchema, { io: "input", reused: "ref" });
}
