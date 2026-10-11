import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminPageSource = await readFile(new URL("../src/app/admin/legado/page.tsx", import.meta.url), "utf8");
const adminNavSource = await readFile(new URL("../src/components/admin/admin-nav.ts", import.meta.url), "utf8");
const adminSidebarSource = await readFile(new URL("../src/components/admin/admin-sidebar.tsx", import.meta.url), "utf8");
const adminShellSource = await readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8");
const adminTopbarSource = await readFile(new URL("../src/components/admin/admin-topbar.tsx", import.meta.url), "utf8");
const adminOverviewSource = await readFile(new URL("../src/components/admin/admin-overview.tsx", import.meta.url), "utf8");
const adminCatalogCommandCenterSource = await readFile(
  new URL("../src/components/admin/catalog/catalog-command-center.tsx", import.meta.url),
  "utf8"
);
const adminCombosCommandCenterSource = await readFile(
  new URL("../src/components/admin/combos/combos-command-center.tsx", import.meta.url),
  "utf8"
);
const adminCommunityPlaceholderSource = await readFile(
  new URL("../src/components/admin/community/community-placeholder.tsx", import.meta.url),
  "utf8"
);
const adminModerationCommandCenterSource = await readFile(
  new URL("../src/components/admin/moderation/moderation-command-center.tsx", import.meta.url),
  "utf8"
);
const adminAIAgentsCommandCenterSource = await readFile(
  new URL("../src/components/admin/ai-agents/ai-agents-command-center.tsx", import.meta.url),
  "utf8"
);
const adminIntegrationsCommandCenterSource = await readFile(
  new URL("../src/components/admin/settings/integrations-command-center.tsx", import.meta.url),
  "utf8"
);
const adminMetricCardSource = await readFile(new URL("../src/components/admin/overview/metric-card.tsx", import.meta.url), "utf8");
const adminOperationsPanelSource = await readFile(new URL("../src/components/admin/overview/operations-panel.tsx", import.meta.url), "utf8");
const adminPersonalizationCommandCenterSource = await readFile(
  new URL("../src/components/admin/personalization/personalization-command-center.tsx", import.meta.url),
  "utf8"
);
const adminRecentOperationsTableSource = await readFile(new URL("../src/components/admin/overview/recent-operations-table.tsx", import.meta.url), "utf8");
const adminStudentsCommandCenterSource = await readFile(
  new URL("../src/components/admin/students/students-command-center.tsx", import.meta.url),
  "utf8"
);
const adminDashboardSource = await readFile(new URL("../src/components/admin-dashboard.tsx", import.meta.url), "utf8");
const adminDashboardAndStudentSource = `${adminDashboardSource}\n${adminStudentsCommandCenterSource}`;
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const globalsCssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const designSystemSource = await readFile(new URL("../docs/12-design-system-bunker707.md", import.meta.url), "utf8");
const favoritesPageSource = await readFile(new URL("../src/app/favoritos/page.tsx", import.meta.url), "utf8");
const favoritesExperienceSource = await readFile(new URL("../src/components/favorites-experience.tsx", import.meta.url), "utf8");
const loginExperienceSource = await readFile(new URL("../src/components/login-experience.tsx", import.meta.url), "utf8");
const loginPageSource = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const callbackRouteSource = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
const logoutRouteSource = await readFile(new URL("../src/app/api/auth/logout/route.ts", import.meta.url), "utf8");
const postLoginRouteSource = await readFile(new URL("../src/app/api/auth/post-login/route.ts", import.meta.url), "utf8");
const proxySource = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
const authRedirectSource = await readFile(new URL("../src/server/auth/redirect.ts", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const routeErrorsSource = await readFile(new URL("../src/server/http/route-errors.ts", import.meta.url), "utf8");
const adminContentRouteSource = await readFile(new URL("../src/app/api/admin/content/route.ts", import.meta.url), "utf8");
const adminCombosRouteSource = await readFile(new URL("../src/app/api/admin/combos/route.ts", import.meta.url), "utf8");
const adminCollectionsRouteSource = await readFile(new URL("../src/app/api/admin/collections/route.ts", import.meta.url), "utf8");
const contentPageSource = await readFile(new URL("../src/app/conteudo/[id]/page.tsx", import.meta.url), "utf8");
const contentStructureSectionSource = await readFile(
  new URL("../src/components/content-structure-section.tsx", import.meta.url),
  "utf8"
);
const adminStudentAccessRouteSource = await readFile(
  new URL("../src/app/api/admin/students/access/route.ts", import.meta.url),
  "utf8"
);
const progressRouteSource = await readFile(new URL("../src/app/api/progress/lessons/route.ts", import.meta.url), "utf8");
const savedItemsRouteSource = await readFile(new URL("../src/app/api/saved-items/route.ts", import.meta.url), "utf8");
const passwordChangePageSource = await readFile(new URL("../src/app/alterar-senha/page.tsx", import.meta.url), "utf8");
const passwordChangeExperienceSource = await readFile(
  new URL("../src/components/password-change-experience.tsx", import.meta.url),
  "utf8"
);
const supabaseClientSource = await readFile(new URL("../src/server/db/supabase/client.ts", import.meta.url), "utf8");
const supabaseMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150001_bunker707_platform.sql", import.meta.url),
  "utf8"
);
const supabaseReleaseMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150002_content_release_rules.sql", import.meta.url),
  "utf8"
);
const supabaseAuthSecurityMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150003_auth_security.sql", import.meta.url),
  "utf8"
);
const supabaseSavedItemsMigrationSource = await readFile(
  new URL("../supabase/migrations/202606150006_saved_items.sql", import.meta.url),
  "utf8"
);
const supabaseCombosMigrationSource = await readFile(
  new URL("../supabase/migrations/202606190001_product_combos.sql", import.meta.url),
  "utf8"
);

test("admin route renders the CMS dashboard", () => {
  assert.match(adminPageSource, /import \{ AdminDashboard \} from "@\/components\/admin-dashboard";/);
  assert.match(adminPageSource, /requirePageAdmin/);
  assert.match(adminPageSource, /getAdminDashboardData/);
  assert.match(adminPageSource, /return <AdminDashboard initialData=\{data\}/);
  assert.match(adminPageSource, /readLegacyAdminParams\(params\)/);
});

test("admin dashboard exposes the core CMS views", () => {
  for (const label of [
    "Visao geral",
    "Alunos",
    "Produtos",
    "Combos",
    "Estrutura",
    "Comunidade",
    "Moderacao",
    "Agentes de IA",
    "Personalizacao",
    "Configuracoes",
    "Integracoes"
  ]) {
    assert.match(adminNavSource, new RegExp(label));
  }
  assert.match(adminDashboardSource, /PersonalizationView/);
  assert.match(adminDashboardSource, /activeView === "personalization"/);
  assert.match(adminDashboardSource, /PersonalizationCommandCenter/);
  assert.match(adminDashboardSource, /CatalogCommandCenter/);
  assert.match(adminDashboardSource, /CombosCommandCenter/);
  assert.match(adminDashboardSource, /CommunityPlaceholder/);
  assert.match(adminDashboardSource, /ModerationCommandCenter/);
  assert.match(adminDashboardSource, /AIAgentsCommandCenter/);
  assert.match(adminDashboardSource, /IntegrationsCommandCenter/);
  assert.match(adminDashboardSource, /StudentsCommandCenter/);
  assert.match(adminCatalogCommandCenterSource, /Catalogo/);
  assert.match(adminCatalogCommandCenterSource, /Conteudos recentes/);
  assert.match(adminPersonalizationCommandCenterSource, /Central visual da area do aluno/);
  assert.match(adminPersonalizationCommandCenterSource, /Produtos personalizaveis/);
  assert.match(adminDashboardSource, /useState<PersonalizationTarget>\(\{ kind: "index" \}\)/);
  assert.match(adminDashboardSource, /Pagina de produtos/);
  assert.match(adminDashboardSource, /formationCourses=\{dashboardData\.formationCourses\}/);
  assert.match(adminDashboardSource, /ContentRow/);
  assert.match(adminDashboardSource, /CourseModulesHomeSection/);
  assert.match(adminDashboardSource, /ContentStructureSection/);
  assert.match(adminDashboardSource, /showLockedStates=\{false\}/);
  assert.match(contentStructureSectionSource, /showLockedStates = true/);
  assert.match(adminDashboardSource, /HeroSection/);
  assert.match(adminDashboardSource, /LoginExperience/);
  assert.match(adminDashboardSource, /PurchasesExperience/);
  assert.match(platformStoreSource, /homeRows/);
  assert.doesNotMatch(adminDashboardSource, /PersonalizationModeBar/);
  assert.doesNotMatch(adminDashboardSource, /PersonalizationIndexRow/);
  assert.doesNotMatch(adminDashboardSource, /id: "release"/);
  assert.doesNotMatch(adminDashboardSource, /id: "access"/);
});

test("admin catalog creates and edits content inside a modal builder", () => {
  assert.match(adminCatalogCommandCenterSource, /onCreateContent/);
  assert.match(adminCatalogCommandCenterSource, /onEditContent/);
  assert.match(adminDashboardSource, /open=\{contentFormOpen\}/);
  assert.match(adminDashboardSource, /Fechar modal do catalogo/);
  assert.match(adminDashboardSource, /Catalogo<\/span>/);
  assert.match(adminDashboardSource, /h-\[min\(92dvh,900px\)\]/);
  assert.match(adminDashboardSource, /setContentFormStep\("modules"\)/);
  assert.match(adminDashboardSource, /setContentFormStep\(editingModuleId \? "modules" : "lessons"\)/);
  assert.doesNotMatch(adminDashboardSource, /contentFormOpen \? \(/);
  assert.doesNotMatch(adminDashboardSource, /document\.body\.style\.overflow[\s\S]{0,500}\}, \[contentFormOpen\]\);/);
  assert.match(designSystemSource, /Modal de criacao\/edicao no Catalogo/);
});

test("admin dashboard exposes product combos, moderation, integrations and AI agents", () => {
  assert.match(adminDashboardSource, /activeView === "combos"/);
  assert.match(adminDashboardSource, /activeView === "community"/);
  assert.match(adminDashboardSource, /activeView === "moderation"/);
  assert.match(adminDashboardSource, /activeView === "ai-agents"/);
  assert.match(adminDashboardSource, /activeView === "integrations"/);
  assert.match(adminDashboardSource, /\/api\/admin\/collections/);
  assert.match(adminDashboardSource, /\/api\/admin\/combos/);
  assert.match(adminCombosRouteSource, /requireApiRole\("catalog\.write"\)/);
  assert.match(adminCombosRouteSource, /upsertProductCombo/);
  assert.match(adminCombosRouteSource, /deleteProductCombo/);
  assert.match(adminCollectionsRouteSource, /requireApiRole\("settings\.ai"\)/);
  assert.match(adminCollectionsRouteSource, /updateAdminDashboardCollections/);
  assert.match(platformStoreSource, /defaultCohortName = "Turma A"/);
  assert.match(platformStoreSource, /combos/);
  assert.match(platformStoreSource, /product_combos/);
  assert.match(platformStoreSource, /product_combo_items/);
  assert.match(platformStoreSource, /isMissingSupabaseSchemaObjectError/);
  assert.match(platformStoreSource, /deleteComboItemsForCombos/);
  assert.match(platformStoreSource, /"product_combo_items",\s*comboItemRows\(combo\)/);
  assert.match(platformStoreSource, /blockedWordRules/);
  assert.match(platformStoreSource, /integrations/);
  assert.match(platformStoreSource, /aiAgents/);
  assert.match(adminCombosCommandCenterSource, /Produtos incluidos/);
  assert.match(adminCombosCommandCenterSource, /Turma padrao/);
  assert.match(adminCombosCommandCenterSource, /Editar combo/);
  assert.match(adminCombosCommandCenterSource, /Atualizar combo/);
  assert.match(adminModerationCommandCenterSource, /Palavras bloqueadas/);
  assert.match(adminModerationCommandCenterSource, /Aprovados/);
  assert.match(adminIntegrationsCommandCenterSource, /Hotmart/);
  assert.match(adminIntegrationsCommandCenterSource, /Segredos no browser/);
  assert.doesNotMatch(adminIntegrationsCommandCenterSource, /AIProviderSettings/);
  assert.match(adminAIAgentsCommandCenterSource, /Tutor de aula/);
  assert.match(adminAIAgentsCommandCenterSource, /Responder comentarios/);
  assert.match(adminAIAgentsCommandCenterSource, /AIProviderSettings/);
  assert.match(adminAIAgentsCommandCenterSource, /Tutor IA, a IA Diretor/);
  assert.match(adminCommunityPlaceholderSource, /Fase futura/);
});

test("admin shadcn nav keeps the core CRM modules and student preview action", () => {
  assert.match(adminSidebarSource, /adminMainNavItems/);
  assert.match(adminSidebarSource, /adminSettingsNavGroup/);
  assert.match(adminTopbarSource, /getAdminNavLabel/);
  assert.doesNotMatch(adminDashboardSource, /const adminNavItems = \[/);

  for (const label of ["Visao geral", "Alunos", "Produtos", "Combos", "Estrutura", "Comunidade", "Moderacao", "Agentes de IA", "Personalizacao"]) {
    assert.match(adminNavSource, new RegExp(`label: "${label}"`));
  }

  assert.match(adminNavSource, /label: "Configuracoes"/);
  assert.match(adminNavSource, /label: "Integracoes"/);
  assert.match(adminNavSource, /href: "\/"/);
  assert.match(adminNavSource, /id: "overview"/);
  assert.match(adminNavSource, /id: "students"/);
  assert.match(adminNavSource, /id: "catalog"/);
  assert.match(adminNavSource, /id: "combos"/);
  assert.match(adminNavSource, /id: "structure"/);
  assert.match(adminNavSource, /id: "community"/);
  assert.match(adminNavSource, /id: "moderation"/);
  assert.match(adminNavSource, /id: "ai-agents"/);
  assert.match(adminNavSource, /id: "personalization"/);
  assert.match(adminNavSource, /id: "integrations"/);
});

test("admin sidebar uses shadcn sidebar primitives and shared navigation", () => {
  assert.match(adminSidebarSource, /@\/components\/ui\/sidebar/);
  assert.match(adminSidebarSource, /collapsible="icon"/);
  assert.match(adminSidebarSource, /SidebarMenuButton/);
  assert.match(adminSidebarSource, /tooltip=/);
  assert.match(adminSidebarSource, /adminMainNavItems/);
  assert.match(adminSidebarSource, /SidebarMenuSub/);
  assert.match(adminSidebarSource, /adminOperationNavItems/);
  assert.match(adminSidebarSource, /onChangeView\(item\.id\)/);
  assert.match(adminSidebarSource, /isActive=\{activeView === item\.id\}/);
});

test("admin shell uses shadcn sidebar provider without touching the student shell", () => {
  assert.match(adminShellSource, /SidebarProvider/);
  assert.match(adminShellSource, /defaultOpen=\{false\}/);
  assert.match(adminShellSource, /AdminSidebar/);
  assert.match(adminShellSource, /SidebarInset/);
  assert.match(adminShellSource, /w-0 min-w-0/);
  assert.match(adminTopbarSource, /SidebarTrigger/);
  assert.match(adminNavSource, /label: "Area do aluno"/);
  assert.doesNotMatch(adminTopbarSource, /Buscar no CRM/);
  assert.doesNotMatch(adminTopbarSource, /Novo aluno/);
  assert.doesNotMatch(adminOverviewSource, /Ver area do aluno/);
  assert.doesNotMatch(appShellSource, /SidebarProvider/);
});

test("admin overview uses shadcn dashboard components with safe CRM data", () => {
  assert.doesNotMatch(adminOverviewSource, /\|\| (487|612|64|132|9|2)\b/);
  assert.doesNotMatch(adminOverviewSource, /previewStudentRows|previewActivityRows|previewChartPoints|previewPipeline/);
  assert.doesNotMatch(adminOverviewSource, /EmptyChartState|EMPTY_CHART_MESSAGE|Nada aqui é simulado/);
  assert.match(adminOverviewSource, /Sem dados no período/);
  assert.match(adminOverviewSource, /Progresso médio dos alunos/);
  assert.doesNotMatch(adminOverviewSource, /Sinais operacionais/);
  assert.match(adminOverviewSource, /Produtos com mais alunos/);
  assert.match(adminOverviewSource, /Alunos para acompanhar/);
  assert.match(adminOverviewSource, /Painel do produtor/);
  assert.doesNotMatch(adminOverviewSource, /Resumo seguro|Live CRM|Abrir segmentacao|alto sinal de compra/);
  assert.doesNotMatch(adminOverviewSource, /Performance da escola/);
  assert.match(adminMetricCardSource, /@\/components\/ui\/card/);
  assert.match(adminOperationsPanelSource, /@\/components\/ui\/badge/);
  assert.match(adminRecentOperationsTableSource, /@\/components\/ui\/table/);
  assert.doesNotMatch(adminTopbarSource, /Entitlements como fonte de verdade|RBAC ativo/);
  assert.doesNotMatch(adminSidebarSource, /RBAC ativo|CRM Admin/);
  assert.doesNotMatch(adminNavSource, /CRM Admin/);
  assert.match(adminNavSource, /"Admin Bunker707"/);
  assert.doesNotMatch(adminOverviewSource, /payload/);
  assert.doesNotMatch(adminOperationsPanelSource, /payload/);
  assert.doesNotMatch(adminRecentOperationsTableSource, /payload/);
});

test("admin dashboard delegates shell and overview to shadcn admin components", () => {
  assert.match(adminDashboardSource, /AdminShell/);
  assert.match(adminDashboardSource, /AdminOverview/);
  assert.match(adminDashboardSource, /<AdminShell/);
  assert.match(adminDashboardSource, /<AdminOverview data=\{dashboardData\} \/>/);
  assert.doesNotMatch(adminDashboardSource, /<AdminSidebar[\s\S]*isOpen=\{sidebarOpen\}/);
  assert.doesNotMatch(adminDashboardSource, /<AdminTopbar[\s\S]*sidebarOpen=\{sidebarOpen\}/);
});

test("shadcn tokens coexist with Bunker707 student area tokens", () => {
  for (const token of ["--background", "--foreground", "--panel", "--border", "--accent"]) {
    assert.match(globalsCssSource, new RegExp(token));
  }

  for (const token of ["--card", "--card-foreground", "--sidebar", "--sidebar-foreground", "--primary"]) {
    assert.match(globalsCssSource, new RegExp(token));
  }

  assert.match(designSystemSource, /shadcn\/ui/);
  assert.match(designSystemSource, /CRM admin/);
  assert.match(designSystemSource, /CRM de alunos com referencia estrutural operacional/);
  assert.match(designSystemSource, /referencia Hotmart apenas para organizacao/);
});

test("admin dashboard models a simple student CRM list with row actions", () => {
  assert.match(adminStudentsCommandCenterSource, /Alunos/);
  assert.match(adminStudentsCommandCenterSource, /Buscar aluno por nome ou email/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /studentMetricFallbackSeries/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /buildMetricSeries/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /buildMemberSeries/);
  assert.match(adminStudentsCommandCenterSource, /Total de alunos/);
  assert.match(adminStudentsCommandCenterSource, /Progresso médio/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /Engajamento/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /getStudentEngagementScore/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /h-\[8\.25rem\]|EMPTY_CHART_MESSAGE|Nada aqui é simulado/);
  assert.match(adminStudentsCommandCenterSource, /Sem dados no período/);
  assert.match(adminStudentsCommandCenterSource, /Adicionar aluno/);
  assert.doesNotMatch(adminStudentsCommandCenterSource, /Inteligencia da base/);
  assert.doesNotMatch(adminDashboardSource, /CourseStudentGroups/);
  assert.doesNotMatch(adminDashboardSource, /onListModeChange=\{setListMode\}/);
  assert.match(adminDashboardSource, /Nome e email/);
  assert.match(adminDashboardSource, /StudentRowActions/);
  assert.match(adminDashboardSource, /Reenviar acesso/);
  assert.match(adminDashboardSource, /Bloquear acesso a produtos/);
  assert.match(adminDashboardSource, /Mudar turma/);
  assert.match(adminDashboardSource, /Informacoes e dados pessoais/);
  assert.match(adminDashboardSource, /Produtos/);
  assert.match(adminDashboardSource, /Produtos comprados/);
  assert.match(adminDashboardAndStudentSource, /Adicionar aluno/);
  assert.match(adminDashboardSource, /bg-\[linear-gradient\(180deg,#111217_0%,#0d0e11_100%\)\]/);
  assert.match(adminDashboardSource, /bg-red-500\/\[0\.055\]/);
  assert.doesNotMatch(adminDashboardSource, /bg-\[#f4f6f8\]/);
  assert.doesNotMatch(adminDashboardSource, /#4364d8/);
  assert.match(adminDashboardSource, /StudentProfileModal/);
  assert.match(adminDashboardSource, /@\/components\/ui\/badge/);
  assert.match(adminDashboardSource, /@\/components\/ui\/table/);
  assert.match(adminDashboardSource, /@\/components\/ui\/dialog/);
  assert.match(adminDashboardSource, /DialogContent/);
  assert.match(adminDashboardSource, /max-w-\[min\(1240px,calc\(100vw-2rem\)\)\]/);
  assert.doesNotMatch(adminDashboardSource, /SheetContent/);
  assert.doesNotMatch(adminDashboardSource, /TabsList/);
  assert.doesNotMatch(adminDashboardSource, /defaultValue="overview"/);
  assert.match(adminDashboardSource, /TableHeader/);
  assert.match(adminDashboardSource, /Os acessos internos da Bunker707 continuam sendo a fonte de verdade/);
  assert.doesNotMatch(adminDashboardSource, /Depois do entitlement|Entitlements ativos|Curadoria persistida|\["Escopo"|ID do asset|no CRM\./);
  assert.doesNotMatch(adminDashboardSource, /\{(record|selectedRecord)\.access\}<\/StatusPill>/);
  assert.match(adminDashboardSource, /Liberação programada/);
  assert.match(adminDashboardSource, /StudentProductAccessTable/);
  assert.doesNotMatch(adminDashboardSource, /StudentProductAccessCard/);
  assert.match(designSystemSource, /nao como sheet lateral e nao como pagina externa/);
  assert.match(designSystemSource, /Nao usar abas/);
  assert.match(designSystemSource, /Produtos aparecem em tabela simples/);
  assert.match(designSystemSource, /nunca para copia visual/);
  assert.match(adminDashboardSource, /Reenviar acesso/);
  assert.match(adminDashboardSource, /Enviar convite para criar senha/);
  assert.match(adminDashboardSource, /Gerar senha temporaria automaticamente/);
  assert.match(adminDashboardSource, /Criar senha temporaria manualmente/);
  assert.match(adminDashboardSource, /Senha temporaria criada/);
  assert.match(adminDashboardSource, /accessSetup: "invite"/);
  assert.match(adminDashboardSource, /const resolvedAccessSetup = formState\.accessSetup;/);
  assert.doesNotMatch(adminDashboardSource, /Ambiente local sem Supabase/);
  assert.doesNotMatch(adminDashboardSource, /Enviar convite para criar senha - exige Supabase/);
  assert.doesNotMatch(adminDashboardSource, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(adminDashboardSource, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(adminDashboardSource, /Aluno salvo localmente/);
  assert.doesNotMatch(adminDashboardSource, /Cadastro local sem envio/);
  assert.doesNotMatch(adminDashboardSource, /Convite simulado/);
  assert.match(adminDashboardSource, /StudentDeleteConfirmationModal/);
  assert.match(adminDashboardSource, /Confirmacao necessaria/);
  assert.match(adminDashboardSource, /studentPendingDeletion/);
  assert.match(adminDashboardSource, /aria-label=\{`Acoes de \$\{student\.fullName\}`\}/);
  assert.match(adminDashboardSource, /Remover aluno/);
  assert.doesNotMatch(adminDashboardSource, /Excluir "\$\{studentToRemove\.fullName\}" do CRM/);
  assert.match(adminDashboardSource, /Mudar turma/);
  assert.match(adminDashboardSource, /Bloquear/);
  assert.match(adminDashboardSource, /Primeiro acesso/);
  assert.match(adminDashboardSource, /Ultimo acesso/);
  assert.match(adminDashboardSource, /Informacoes e dados pessoais/);
  assert.match(adminDashboardSource, /Acesso geral/);
  assert.doesNotMatch(adminDashboardSource, /Ver historico/);
  assert.match(adminDashboardSource, /Engajamento/);
  assert.match(adminDashboardSource, /Altissimo/);
  assert.match(adminDashboardSource, /Fechar modal do aluno/);
  assert.doesNotMatch(adminDashboardSource, /document\.body\.style\.overflow[\s\S]{0,500}\}, \[modalMode\]\);/);
  assert.match(adminDashboardSource, /Turma/);
  assert.match(adminDashboardSource, /Papel/);
  assert.match(adminDashboardSource, /Detalhes do usuario/);
  assert.match(adminDashboardSource, /StudentProductAccessTable/);
  assert.doesNotMatch(adminDashboardSource, /StudentProductAccessCard/);
  assert.doesNotMatch(adminDashboardSource, /ProductFact/);
  assert.doesNotMatch(adminDashboardSource, /md:grid-cols-2 xl:grid-cols-5/);
  assert.match(adminTopbarSource, /SidebarTrigger/);
  assert.match(adminShellSource, /onChangeView=\{onChangeView\}/);
  assert.match(adminDashboardSource, /Alunos/);
  assert.match(adminNavSource, /Area do aluno/);
  assert.doesNotMatch(adminTopbarSource, /Ver area do aluno/);
  assert.match(adminDashboardSource, /onChangeView=\{handleChangeView\}/);
  assert.doesNotMatch(adminDashboardSource, /Supabase persistido/);
  assert.doesNotMatch(adminDashboardSource, /15 itens por pagina/);
  assert.doesNotMatch(adminDashboardSource, /Fallback local/);
  assert.doesNotMatch(adminDashboardSource, /admin-mock-data/);
  assert.doesNotMatch(adminDashboardSource, /mock-data/);
  assert.doesNotMatch(platformStoreSource, /admin-seed/);
  assert.doesNotMatch(platformStoreSource, /platform-seed/);
});

test("admin dashboard persists content, cohorts, lessons and students through Supabase-backed route handlers", () => {
  assert.match(supabaseClientSource, /@supabase\/supabase-js/);
  assert.match(supabaseClientSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(supabaseClientSource, /SUPABASE_SECRET_KEY/);
  assert.match(platformStoreSource, /getSupabaseAdminClient/);
  assert.match(platformStoreSource, /return readSupabaseDatabase\(\{ includeAdminData: true \}\);/);
  assert.doesNotMatch(platformStoreSource, /writeSupabaseDatabase/);
  assert.match(platformStoreSource, /const readMemberDatabase = cache/);
  assert.doesNotMatch(platformStoreSource, /bunker707-platform\.json/);
  assert.doesNotMatch(platformStoreSource, /shouldUseSupabaseDatabase/);
  assert.match(platformStoreSource, /replaceAdminStudents/);
  assert.match(platformStoreSource, /upsertContentItem/);
  assert.match(platformStoreSource, /deleteContentItem/);
  assert.match(platformStoreSource, /upsertProductCombo/);
  assert.match(platformStoreSource, /deleteProductCombo/);
  assert.match(platformStoreSource, /updateAdminDashboardCollections/);
  assert.match(platformStoreSource, /revokeStaleSupabaseEntitlementsForStudents/);
  assert.match(platformStoreSource, /getAdminStudentEntitlementGrants/);
  assert.match(platformStoreSource, /status: "revoked"/);
  assert.match(adminDashboardSource, /setDashboardData\(previousData\)/);
  assert.match(adminDashboardSource, /Aluno nao cadastrado/);
  assert.match(routeErrorsSource, /jsonRouteError/);
  assert.match(adminContentRouteSource, /jsonRouteError/);
  assert.match(adminCombosRouteSource, /jsonRouteError/);
  assert.match(platformStoreSource, /upsertCourseModule/);
  assert.match(platformStoreSource, /upsertLesson/);
  assert.match(platformStoreSource, /addCohort/);
  assert.match(platformStoreSource, /replaceCompletedLessons/);
  assert.match(platformStoreSource, /setSavedItem/);
  assert.match(platformStoreSource, /saved_items/);
  assert.match(platformStoreSource, /upsertRows/);
  assert.match(platformStoreSource, /deleteMissingRows/);
  assert.match(platformStoreSource, /persistImageAsset/);
  assert.doesNotMatch(platformStoreSource, /deleteAllRows/);
  assert.doesNotMatch(platformStoreSource, /writeSupabaseDatabase\(makeSeedDatabase\(\)\)/);
  assert.match(adminDashboardSource, /\/api\/admin\/students/);
  assert.match(adminDashboardSource, /\/api\/admin\/students\/access/);
  assert.match(adminDashboardSource, /\/api\/admin\/content/);
  assert.match(adminDashboardSource, /\/api\/admin\/collections/);
  assert.match(adminDashboardSource, /\/api\/admin\/combos/);
  assert.match(adminDashboardSource, /method: "DELETE"/);
  assert.match(adminDashboardSource, /Editar conteudo/);
  assert.match(adminDashboardSource, /Excluir conteudo/);
  assert.match(adminDashboardSource, /Nenhum conteudo cadastrado/);
  assert.match(adminDashboardSource, /\/api\/admin\/modules/);
  assert.match(adminDashboardSource, /\/api\/admin\/lessons/);
  assert.match(adminDashboardSource, /\/api\/admin\/cohorts/);
  for (const tableName of [
    "content_items",
    "product_combos",
    "product_combo_items",
    "course_modules",
    "lessons",
    "cohorts",
    "students",
    "student_courses",
    "student_access_logs",
    "lesson_progress"
  ]) {
    const migrationSource = tableName.startsWith("product_combo") ? supabaseCombosMigrationSource : supabaseMigrationSource;
    assert.match(migrationSource, new RegExp(`create table if not exists public\\.${tableName}`));
  }
  assert.match(supabaseMigrationSource, /enable row level security/);
  assert.match(adminStudentAccessRouteSource, /requireApiAdmin/);
  assert.match(adminStudentAccessRouteSource, /inviteUserByEmail/);
  assert.match(adminStudentAccessRouteSource, /resetPasswordForEmail/);
  assert.match(adminStudentAccessRouteSource, /createUser/);
  assert.match(adminStudentAccessRouteSource, /updateUserById/);
  assert.match(adminStudentAccessRouteSource, /must_change_password/);
  assert.match(adminStudentAccessRouteSource, /entitlements/);
});

test("admin dashboard lets producers choose course card flow explicitly", () => {
  assert.match(adminDashboardSource, /Card unico/);
  assert.match(adminDashboardSource, /role="switch"/);
  assert.match(adminDashboardSource, /coursePresentationMode/);
  assert.match(adminDashboardSource, /lesson_playlist/);
  assert.match(adminDashboardSource, /module_cards/);
  assert.match(platformStoreSource, /coursePresentationMode: input\.coursePresentationMode/);
  assert.match(contentPageSource, /coursePresentationMode === "lesson_playlist"/);
  assert.match(contentPageSource, /return "module_cards";/);
});

test("auth and security guard the student area, progress and admin mutations", () => {
  assert.match(proxySource, /createServerClient/);
  assert.match(proxySource, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(proxySource, /protectedPagePrefixes/);
  assert.match(proxySource, /\/alterar-senha/);
  assert.match(proxySource, /userMustChangePassword/);
  assert.match(proxySource, /supabase\.auth\.getUser/);
  assert.match(platformStoreSource, /getAdminRoleForUser/);
  assert.match(platformStoreSource, /canUseAccessPreview: Boolean\(adminRole\)/);
  assert.match(platformStoreSource, /accessEntitlements/);
  assert.match(platformStoreSource, /getUserAccessKeys/);
  assert.match(platformStoreSource, /hasUserEntitlementForItem/);
  assert.match(platformStoreSource, /studentRecord\.email\.toLowerCase\(\) === email/);
  assert.match(appShellSource, /canUseAccessPreview\?: boolean/);
  assert.match(appShellSource, /const showPreviewControl = canUseAccessPreview;/);
  assert.doesNotMatch(appShellSource, /NODE_ENV !== "production" \|\| Boolean\(accessPreviewMode\)/);
  assert.match(appShellSource, /Modo de visualizacao no menu/);
  assert.match(appShellSource, /Aluno com acesso/);
  assert.match(appShellSource, /Aluno sem acesso/);
  assert.match(appShellSource, /Ir para o admin/);
  assert.doesNotMatch(appShellSource, /CRM/);
  assert.match(appShellSource, /href="\/admin"/);
  assert.match(appShellSource, /label: "Favoritos", href: "\/favoritos"/);
  assert.match(proxySource, /"\/favoritos"/);
  assert.match(loginExperienceSource, /signInWithPassword/);
  assert.match(loginExperienceSource, /getPostLoginRedirectPath/);
  assert.match(loginExperienceSource, /\/api\/auth\/post-login\?next=/);
  assert.match(passwordChangeExperienceSource, /\/api\/auth\/post-login\?next=/);
  assert.match(passwordChangeExperienceSource, /passwordChanged=true/);
  assert.match(postLoginRouteSource, /getPostAuthRedirectPath/);
  assert.match(postLoginRouteSource, /skipPasswordChangeCheck/);
  assert.match(authRedirectSource, /getAdminRoleForUser/);
  assert.match(authRedirectSource, /return adminRole \? "\/admin" : safeRedirectPath/);
  assert.match(callbackRouteSource, /getPostAuthRedirectPath/);
  assert.match(proxySource, /from\("admin_roles"\)/);
  assert.match(loginPageSource, /getPostAuthRedirectPath/);
  assert.match(loginExperienceSource, /must_change_password/);
  assert.match(loginExperienceSource, /signInWithOAuth/);
  assert.match(loginExperienceSource, /resetPasswordForEmail/);
  assert.match(loginExperienceSource, /new URL\("\/auth\/callback", window\.location\.origin\)/);
  assert.doesNotMatch(loginExperienceSource, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(loginExperienceSource, /Login temporariamente indispon[ií]vel/);
  assert.doesNotMatch(loginExperienceSource, /Entrar em modo local/);
  assert.doesNotMatch(loginExperienceSource, /\/api\/auth\/local-login/);
  assert.match(logoutRouteSource, /legacyLocalAuthCookieName/);
  assert.doesNotMatch(proxySource, /localAuthCookieName/);
  assert.doesNotMatch(appShellSource, /@\/lib\/supabase\/browser|supabase\.auth/);
  assert.match(logoutRouteSource, /await supabase\.auth\.signOut\(\);/);
  assert.doesNotMatch(appShellSource, /label: "CMS"/);
  assert.match(progressRouteSource, /requireApiUser/);
  assert.match(progressRouteSource, /userId: auth\.user\.id/);
  assert.match(savedItemsRouteSource, /requireApiUser/);
  assert.match(savedItemsRouteSource, /setSavedItem/);
  assert.match(savedItemsRouteSource, /userId: auth\.user\.id/);
  assert.match(favoritesPageSource, /shellData\.canUseAccessPreview \? requestedAccessPreviewMode : undefined/);
  assert.match(favoritesPageSource, /getFavoritesPageData\(accessPreviewMode, user\)/);
  assert.match(favoritesPageSource, /FavoritesExperience/);
  assert.match(favoritesExperienceSource, /Favoritos/);
  assert.match(favoritesExperienceSource, /savedItemChangedEvent/);
  assert.match(adminContentRouteSource, /requireApiRole\("catalog\.(?:write|delete)"\)/);
  assert.match(passwordChangePageSource, /requirePageUser/);
  assert.match(passwordChangeExperienceSource, /updateUser/);
  assert.match(passwordChangeExperienceSource, /password_changed/);
  assert.match(passwordChangeExperienceSource, /must_change_password: false/);
  assert.match(loginPageSource, /code\?: string \| string\[\];/);
  assert.match(loginPageSource, /redirect\(`\/auth\/callback\?\$\{callbackSearchParams\.toString\(\)\}`\)/);
  assert.match(adminStudentAccessRouteSource, /new URL\("\/auth\/callback", requestUrl\.origin\)/);
  assert.match(adminStudentAccessRouteSource, /redirectUrl\.searchParams\.set\("provider", "email"\)/);
  for (const tableName of ["profiles", "admin_roles", "entitlements", "student_events"]) {
    assert.match(supabaseAuthSecurityMigrationSource, new RegExp(`create table if not exists public\\.${tableName}`));
  }
  assert.match(supabaseAuthSecurityMigrationSource, /enable row level security/);
  assert.match(supabaseAuthSecurityMigrationSource, /auth\.uid\(\) = user_id/);
  assert.match(supabaseAuthSecurityMigrationSource, /handle_new_auth_user/);
  assert.match(supabaseSavedItemsMigrationSource, /create table if not exists public\.saved_items/);
  assert.match(supabaseSavedItemsMigrationSource, /enable row level security/);
  assert.match(supabaseSavedItemsMigrationSource, /auth\.uid\(\)::text = user_id/);
});

test("admin CMS models release rules inside content, modules and lessons", () => {
  assert.match(adminDashboardSource, /Depois da compra/);
  assert.match(adminDashboardSource, /horas/);
  assert.match(adminDashboardSource, /dias/);
  assert.match(adminDashboardSource, /Liberacao do modulo/);
  assert.match(adminDashboardSource, /Liberacao da aula/);
  assert.match(platformStoreSource, /releaseRule/);
  assert.match(supabaseMigrationSource, /release_rule jsonb/);
  assert.match(supabaseReleaseMigrationSource, /add column if not exists release_rule jsonb/);
});

test("admin catalog wizard supports editing modules and lessons", () => {
  assert.match(adminDashboardSource, /Editar modulo/);
  assert.match(adminDashboardSource, /Salvar modulo/);
  assert.match(adminDashboardSource, /editWizardModule/);
  assert.match(adminDashboardSource, /moduleToBuilderForm/);
  assert.match(adminDashboardSource, /Editar aula/);
  assert.match(adminDashboardSource, /Salvar aula/);
  assert.match(adminDashboardSource, /editWizardLesson/);
  assert.match(adminDashboardSource, /lessonToBuilderForm/);
  assert.match(platformStoreSource, /existingLesson/);
  assert.match(platformStoreSource, /hasVideoInput/);
  assert.match(platformStoreSource, /module\.lessons\.filter\(\(lesson\) => lesson\.id !== lessonId\)/);
});
