// Saude do processo, usada pelo HEALTHCHECK do container e pelo monitor externo (docs/20). De
// proposito nao consulta o Supabase: banco fora do ar e incidente para o monitor avisar, nao motivo
// para o Docker reiniciar o app em loop. Resposta publica e sem dado de aluno; `version` e o commit
// gravado na imagem no build (APP_VERSION), para conferir qual versao esta no ar depois de um deploy.
// Response padrao da web (sem next/server) para a rota rodar igual no Node dos testes.
export function GET() {
  return Response.json(
    { ok: true, version: process.env.APP_VERSION || "dev" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
