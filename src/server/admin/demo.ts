import "server-only";

// Modo "dados simulados" do admin: so no localhost, para o produtor conferir graficos e tabelas antes de
// existir dado real. Liga com ADMIN_DEMO_DATA=on no .env.local e nunca vale em producao.
export function isAdminDemoEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_DEMO_DATA === "on";
}
