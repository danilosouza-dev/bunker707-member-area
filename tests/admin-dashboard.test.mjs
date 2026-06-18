import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const adminPageSource = await readFile(new URL("../src/app/admin/page.tsx", import.meta.url), "utf8");
const adminNavSource = await readFile(new URL("../src/components/admin/admin-nav.ts", import.meta.url), "utf8");
const adminSidebarSource = await readFile(new URL("../src/components/admin/admin-sidebar.tsx", import.meta.url), "utf8");
const adminShellSource = await readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8");
const adminTopbarSource = await readFile(new URL("../src/components/admin/admin-topbar.tsx", import.meta.url), "utf8");
const adminOverviewSource = await readFile(new URL("../src/components/admin/admin-overview.tsx", import.meta.url), "utf8");
const adminMetricCardSource = await readFile(new URL("../src/components/admin/overview/metric-card.tsx", import.meta.url), "utf8");
const adminOperationsPanelSource = await readFile(new URL("../src/components/admin/overview/operations-panel.tsx", import.meta.url), "utf8");
const adminRecentOperationsTableSource = await readFile(new URL("../src/components/admin/overview/recent-operations-table.tsx", import.meta.url), "utf8");
const adminDashboardSource = await readFile(new URL("../src/components/admin-dashboard.tsx", import.meta.url), "utf8");
const adminDataSource = await readFile(new URL("../src/server/db/admin-seed.ts", import.meta.url), "utf8");
const appShellSource = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const favoritesPageSource = await readFile(new URL("../src/app/favoritos/page.tsx", import.meta.url), "utf8");
const favoritesExperienceSource = await readFile(new URL("../src/components/favorites-experience.tsx", import.meta.url), "utf8");
const loginExperienceSource = await readFile(new URL("../src/components/login-experience.tsx", import.meta.url), "utf8");
const loginPageSource = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");
const callbackRouteSource = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
const localAuthSource = await readFile(new URL("../src/lib/auth/local.ts", import.meta.url), "utf8");
const localLoginRouteSource = await readFile(new URL("../src/app/api/auth/local-login/route.ts", import.meta.url), "utf8");
const logoutRouteSource = await readFile(new URL("../src/app/api/auth/logout/route.ts", import.meta.url), "utf8");
const postLoginRouteSource = await readFile(new URL("../src/app/api/auth/post-login/route.ts", import.meta.url), "utf8");
const middlewareSource = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
const authRedirectSource = await readFile(new URL("../src/server/auth/redirect.ts", import.meta.url), "utf8");
const platformStoreSource = await readFile(new URL("../src/server/db/platform-store.ts", import.meta.url), "utf8");
const adminContentRouteSource = await readFile(new URL("../src/app/api/admin/content/route.ts", import.meta.url), "utf8");
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

test("admin route renders the CMS dashboard", () => {
  assert.match(adminPageSource, /import \{ AdminDashboard \} from "@\/components\/admin-dashboard";/);
  assert.match(adminPageSource, /requirePageAdmin/);
  assert.match(adminPageSource, /getAdminDashboardData/);
  assert.match(adminPageSource, /return <AdminDashboard initialData=\{data\} \/>;/);
});

test("admin dashboard exposes the core CMS views", () => {
  for (const label of ["Visao geral", "Alunos", "Catalogo", "Estrutura", "Personalizacao"]) {
    assert.match(adminNavSource, new RegExp(label));
  }
  assert.match(adminDashboardSource, /PersonalizationView/);
  assert.match(adminDashboardSource, /activeView === "personalization"/);
  assert.match(adminDashboardSource, /PersonalizationIndexRow/);
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
  assert.doesNotMatch(adminDashboardSource, /id: "release"/);
  assert.doesNotMatch(adminDashboardSource, /id: "access"/);
});

test("admin shadcn nav keeps the core CRM modules and student preview action", () => {
  assert.match(adminDashboardSource, /import \{ adminMainNavItems \} from "@\/components\/admin\/admin-nav";/);
  assert.doesNotMatch(adminDashboardSource, /const adminNavItems = \[/);

  for (const label of ["Visao geral", "Alunos", "Catalogo", "Estrutura", "Personalizacao"]) {
    assert.match(adminNavSource, new RegExp(`label: "${label}"`));
  }

  assert.match(adminNavSource, /href: "\/"/);
  assert.match(adminNavSource, /id: "overview"/);
  assert.match(adminNavSource, /id: "students"/);
  assert.match(adminNavSource, /id: "catalog"/);
  assert.match(adminNavSource, /id: "structure"/);
  assert.match(adminNavSource, /id: "personalization"/);
});

test("admin sidebar uses shadcn sidebar primitives and shared navigation", () => {
  assert.match(adminSidebarSource, /@\/components\/ui\/sidebar/);
  assert.match(adminSidebarSource, /collapsible="icon"/);
  assert.match(adminSidebarSource, /SidebarMenuButton/);
  assert.match(adminSidebarSource, /tooltip=/);
  assert.match(adminSidebarSource, /adminMainNavItems/);
  assert.match(adminSidebarSource, /adminOperationNavItems/);
  assert.match(adminSidebarSource, /onChangeView\(item\.id\)/);
  assert.match(adminSidebarSource, /isActive=\{activeView === item\.id\}/);
});

test("admin shell uses shadcn sidebar provider without touching the student shell", () => {
  assert.match(adminShellSource, /SidebarProvider/);
  assert.match(adminShellSource, /defaultOpen=\{false\}/);
  assert.match(adminShellSource, /AdminSidebar/);
  assert.match(adminShellSource, /SidebarInset/);
  assert.match(adminTopbarSource, /SidebarTrigger/);
  assert.match(adminTopbarSource, /Ver area do aluno/);
  assert.match(adminTopbarSource, /href="\/"/);
  assert.doesNotMatch(appShellSource, /SidebarProvider/);
});

test("admin overview uses shadcn dashboard components with safe CRM data", () => {
  assert.match(adminOverviewSource, /AdminMetricCard/);
  assert.match(adminOverviewSource, /OperationsPanel/);
  assert.match(adminOverviewSource, /RecentOperationsTable/);
  assert.match(adminMetricCardSource, /@\/components\/ui\/card/);
  assert.match(adminOperationsPanelSource, /@\/components\/ui\/badge/);
  assert.match(adminRecentOperationsTableSource, /@\/components\/ui\/table/);
  assert.match(adminOverviewSource, /Entitlements internos/);
  assert.doesNotMatch(adminOverviewSource, /payload/);
  assert.doesNotMatch(adminOperationsPanelSource, /payload/);
  assert.doesNotMatch(adminRecentOperationsTableSource, /payload/);
});

test("admin dashboard models student CRM lists and course grouping", () => {
  assert.match(adminDashboardSource, /Lista de alunos/);
  assert.match(adminDashboardSource, /Por curso/);
  assert.match(adminDashboardSource, /Produtos comprados/);
  assert.match(adminDashboardSource, /Novo aluno/);
  assert.match(adminDashboardSource, /StudentProfileModal/);
  assert.match(adminDashboardSource, /Reenviar acesso/);
  assert.match(adminDashboardSource, /Enviar convite para criar senha/);
  assert.match(adminDashboardSource, /Gerar senha temporaria automaticamente/);
  assert.match(adminDashboardSource, /Criar senha temporaria manualmente/);
  assert.match(adminDashboardSource, /Senha temporaria criada/);
  assert.match(adminDashboardSource, /accessSetup: persistenceProvider === "supabase" \? "invite" : "none"/);
  assert.match(adminDashboardSource, /const resolvedAccessSetup = persistenceProvider === "supabase" \? formState\.accessSetup : "none";/);
  assert.match(adminDashboardSource, /Ambiente local sem Supabase: o aluno sera salvo no CRM, mas nenhum email real sera enviado\./);
  assert.match(adminDashboardSource, /Enviar convite para criar senha - exige Supabase/);
  assert.match(adminDashboardSource, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(adminDashboardSource, /SUPABASE_SECRET_KEY/);
  assert.match(adminDashboardSource, /Aluno salvo localmente/);
  assert.match(adminDashboardSource, /Cadastro local sem envio/);
  assert.doesNotMatch(adminDashboardSource, /Convite simulado/);
  assert.match(adminDashboardSource, /StudentDeleteConfirmationModal/);
  assert.match(adminDashboardSource, /Confirmacao necessaria/);
  assert.match(adminDashboardSource, /studentPendingDeletion/);
  assert.match(adminDashboardSource, /aria-label=\{`Excluir \$\{student\.fullName\}`\}/);
  assert.doesNotMatch(adminDashboardSource, /Excluir "\$\{studentToRemove\.fullName\}" do CRM/);
  assert.match(adminDashboardSource, /Mudar turma/);
  assert.match(adminDashboardSource, /Bloquear/);
  assert.match(adminDashboardSource, /Primeiro acesso/);
  assert.match(adminDashboardSource, /Ultimo acesso/);
  assert.match(adminDashboardSource, /Dados pessoais e acesso/);
  assert.match(adminDashboardSource, /Origem principal/);
  assert.match(adminDashboardSource, /Ver historico/);
  assert.match(adminDashboardSource, /Engajamento/);
  assert.match(adminDashboardSource, /Altissimo/);
  assert.match(adminDashboardSource, /modal-viewport-scroll/);
  assert.match(adminDashboardSource, /document\.body\.style\.overflow = "hidden"/);
  assert.match(adminDashboardSource, /Turma/);
  assert.match(adminDashboardSource, /Papel/);
  assert.match(adminDashboardSource, /Ver detalhe/);
  assert.match(adminDashboardSource, /Abrir menu do CMS/);
  assert.match(adminDashboardSource, /aria-label="Ir para a home do CRM"/);
  assert.match(adminDashboardSource, /CRM Bunker707/);
  assert.match(adminDashboardSource, /Ver area de membros/);
  assert.match(adminDashboardSource, /onGoHome=\{\(\) => setActiveView\("overview"\)\}/);
  assert.match(adminDashboardSource, /Supabase persistido/);
  assert.match(adminDashboardSource, /Fallback local/);
  assert.doesNotMatch(adminDashboardSource, /admin-mock-data/);
  assert.doesNotMatch(adminDashboardSource, /mock-data/);
  assert.match(adminDataSource, /adminStudents/);
  assert.match(adminDataSource, /AdminStudentCourse/);
  assert.match(adminDataSource, /Kiwify/);
  assert.match(adminDataSource, /image: item\.image/);
});

test("admin dashboard persists content, cohorts, lessons and students through Supabase-backed route handlers", () => {
  assert.match(supabaseClientSource, /@supabase\/supabase-js/);
  assert.match(supabaseClientSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(supabaseClientSource, /SUPABASE_SECRET_KEY/);
  assert.match(platformStoreSource, /hasSupabaseConfig/);
  assert.match(platformStoreSource, /getSupabaseAdminClient/);
  assert.match(platformStoreSource, /bunker707-platform\.json/);
  assert.match(platformStoreSource, /replaceAdminStudents/);
  assert.match(platformStoreSource, /upsertContentItem/);
  assert.match(platformStoreSource, /deleteContentItem/);
  assert.match(platformStoreSource, /upsertCourseModule/);
  assert.match(platformStoreSource, /upsertLesson/);
  assert.match(platformStoreSource, /addCohort/);
  assert.match(platformStoreSource, /replaceCompletedLessons/);
  assert.match(platformStoreSource, /setSavedItem/);
  assert.match(platformStoreSource, /saved_items/);
  assert.match(platformStoreSource, /upsertRows/);
  assert.match(platformStoreSource, /deleteMissingRows/);
  assert.doesNotMatch(platformStoreSource, /deleteAllRows/);
  assert.doesNotMatch(platformStoreSource, /writeSupabaseDatabase\(makeSeedDatabase\(\)\)/);
  assert.match(adminDashboardSource, /\/api\/admin\/students/);
  assert.match(adminDashboardSource, /\/api\/admin\/students\/access/);
  assert.match(adminDashboardSource, /\/api\/admin\/content/);
  assert.match(adminDashboardSource, /method: "DELETE"/);
  assert.match(adminDashboardSource, /Editar conteudo/);
  assert.match(adminDashboardSource, /Excluir conteudo/);
  assert.match(adminDashboardSource, /Nenhum conteudo cadastrado/);
  assert.match(adminDashboardSource, /\/api\/admin\/modules/);
  assert.match(adminDashboardSource, /\/api\/admin\/lessons/);
  assert.match(adminDashboardSource, /\/api\/admin\/cohorts/);
  for (const tableName of [
    "content_items",
    "course_modules",
    "lessons",
    "cohorts",
    "students",
    "student_courses",
    "student_access_logs",
    "lesson_progress"
  ]) {
    assert.match(supabaseMigrationSource, new RegExp(`create table if not exists public\\.${tableName}`));
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
  assert.match(middlewareSource, /createServerClient/);
  assert.match(middlewareSource, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.match(middlewareSource, /protectedPagePrefixes/);
  assert.match(middlewareSource, /\/alterar-senha/);
  assert.match(middlewareSource, /userMustChangePassword/);
  assert.match(middlewareSource, /supabase\.auth\.getUser/);
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
  assert.match(appShellSource, /Ir para o CRM/);
  assert.match(appShellSource, /href="\/admin"/);
  assert.match(appShellSource, /label: "Favoritos", href: "\/favoritos"/);
  assert.match(middlewareSource, /"\/favoritos"/);
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
  assert.match(middlewareSource, /from\("admin_roles"\)/);
  assert.match(loginPageSource, /getPostAuthRedirectPath/);
  assert.match(loginExperienceSource, /must_change_password/);
  assert.match(loginExperienceSource, /signInWithOAuth/);
  assert.match(loginExperienceSource, /resetPasswordForEmail/);
  assert.match(loginExperienceSource, /new URL\("\/auth\/callback", window\.location\.origin\)/);
  assert.match(loginExperienceSource, /Entrar em modo local/);
  assert.doesNotMatch(loginExperienceSource, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(loginExperienceSource, /Login temporariamente indisponivel/);
  assert.match(localAuthSource, /NODE_ENV !== "production"/);
  assert.match(localAuthSource, /localhost/);
  assert.match(localAuthSource, /bunker707_local_session/);
  assert.match(localLoginRouteSource, /Login local indisponivel/);
  assert.match(logoutRouteSource, /localAuthCookieName/);
  assert.match(middlewareSource, /localAuthCookieName/);
  assert.match(appShellSource, /supabase\.auth\.signOut/);
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
  assert.match(adminContentRouteSource, /requireApiAdmin/);
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
