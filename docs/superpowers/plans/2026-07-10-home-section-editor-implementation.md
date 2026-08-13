# Home Section Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar na porta 3000 um editor de Home com tres paineis, CRUD, reordenacao, publicacao persistida e layouts estrutural compacto/imersivo.

**Architecture:** `HomeSectionConfig` sera a configuracao canonica compartilhada. O servidor resolve configuracoes em `HomeRow`, aplica entitlement/visibilidade e persiste a versao publicada no Supabase. O editor mantem um rascunho local, renderiza o mesmo conjunto de componentes da Home e publica a lista inteira por uma API administrativa.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS 4, Supabase, Node test runner.

## Global Constraints

- Preservar alteracoes nao relacionadas no worktree atual.
- Manter entitlements como fonte de verdade; configuracao visual nunca concede acesso.
- `main` e o trunk documentado, mas o workspace atual esta em `dev`; nao trocar de branch durante a implementacao.
- Usar `platform_settings.homeSections` como fallback funcional enquanto a migration remota estiver bloqueada por privilegio 403.
- Nao adicionar dependencia de drag-and-drop; usar eventos HTML e botoes mover como alternativa acessivel.
- Executar `npm run verify` e validar `http://localhost:3000/admin` antes de concluir.

---

### Task 1: Modelo canonico e testes de contrato

**Files:**
- Modify: `src/lib/platform-types.ts`
- Create: `tests/home-section-editor.test.mjs`

**Interfaces:**
- Produces: `HomeSectionConfig`, `HomeSectionType`, `HomeSectionContentSource`, `HomeSectionLayout` e `HomeSectionItem`.
- Produces: `HomeRow.sectionId`, `HomeRow.layout`, `HomeRow.structureItems` e `AdminDashboardData.homeSectionConfigs`.

- [ ] **Step 1: Escrever o teste de contrato que falha**

```js
assert.match(typesSource, /export type HomeSectionConfig/);
assert.match(typesSource, /sectionType: HomeSectionType/);
assert.match(typesSource, /contentSource: HomeSectionContentSource/);
assert.match(typesSource, /layout: HomeSectionLayout/);
assert.match(typesSource, /homeSectionConfigs: HomeSectionConfig\[\]/);
```

- [ ] **Step 2: Rodar o teste e confirmar falha**

Run: `node --test tests/home-section-editor.test.mjs`
Expected: FAIL porque os tipos ainda nao existem.

- [ ] **Step 3: Implementar os tipos minimos**

```ts
export type HomeSectionType = "continue_watching" | "content_carousel" | "content_structure";
export type HomeSectionContentSource =
  | "recent_lessons"
  | "entitlement_products"
  | "sellable_products"
  | "upcoming_products"
  | "manual"
  | "selected_content_structure";
export type HomeSectionLayout = "continue" | "vertical" | "compact" | "immersive";

export type HomeSectionConfig = {
  contentSource: HomeSectionContentSource;
  id: string;
  isActive: boolean;
  itemIds: string[];
  layout: HomeSectionLayout;
  order: number;
  sectionType: HomeSectionType;
  sourceContentId?: string;
  subtitle?: string;
  title: string;
  visibility: RowVisibility;
};
```

- [ ] **Step 4: Rodar o teste focado**

Run: `node --test tests/home-section-editor.test.mjs`
Expected: PASS.

### Task 2: Persistencia e resolucao server-side

**Files:**
- Modify: `src/server/db/platform-store.ts`
- Create: `src/app/api/admin/home-sections/route.ts`
- Create: `supabase/migrations/202607100003_home_sections.sql`
- Modify: `tests/home-section-editor.test.mjs`

**Interfaces:**
- Consumes: `HomeSectionConfig`.
- Produces: `publishHomeSections(configs: HomeSectionConfig[]): Promise<AdminDashboardData>`.
- Produces: `resolveHomeRows(database, configs, accessPreviewMode, user): HomeRow[]`.

- [ ] **Step 1: Adicionar testes falhos da persistencia**

```js
assert.match(storeSource, /function getDefaultHomeSectionConfigs/);
assert.match(storeSource, /function resolveConfiguredHomeRows/);
assert.match(storeSource, /export async function publishHomeSections/);
assert.match(routeSource, /requireApiAdmin/);
assert.match(routeSource, /publishHomeSections/);
assert.match(migrationSource, /create table if not exists public\.home_sections/);
assert.match(migrationSource, /create table if not exists public\.home_section_items/);
```

- [ ] **Step 2: Confirmar a falha**

Run: `node --test tests/home-section-editor.test.mjs`
Expected: FAIL nos contratos de store, rota e migration.

- [ ] **Step 3: Criar migration relacional**

```sql
create table if not exists public.home_sections (
  id text primary key,
  title text not null,
  subtitle text,
  order_index integer not null,
  section_type text not null,
  content_source text not null,
  source_content_id text references public.content_items(id) on delete set null,
  layout text not null,
  visibility text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.home_section_items (
  section_id text not null references public.home_sections(id) on delete cascade,
  content_id text not null references public.content_items(id) on delete cascade,
  order_index integer not null,
  primary key (section_id, content_id)
);
```

- [ ] **Step 4: Implementar default, validacao e resolucao**

```ts
function getDefaultHomeSectionConfigs(database: PlatformDatabase): HomeSectionConfig[] {
  const structural = getSellableItems(database)
    .filter((item) => database.contentPageSettings[item.id]?.homeModuleSection?.enabled)
    .map((item, index) => ({
      contentSource: "selected_content_structure" as const,
      id: `content-structure-${item.id}`,
      isActive: true,
      itemIds: [],
      layout: "compact" as const,
      order: index + 2,
      sectionType: "content_structure" as const,
      sourceContentId: item.id,
      title: item.title,
      visibility: "all" as const
    }));
  return normalizeHomeSectionOrder([
    { contentSource: "recent_lessons", id: "continue-watching", isActive: true, itemIds: [], layout: "continue", order: 0, sectionType: "continue_watching", subtitle: "Retome exatamente de onde parou.", title: "Continue assistindo", visibility: "students" },
    { contentSource: "entitlement_products", id: "my-purchases", isActive: true, itemIds: [], layout: "vertical", order: 1, sectionType: "content_carousel", subtitle: "Todos os produtos que voce ja tem acesso.", title: "Minhas compras", visibility: "students" },
    ...structural,
    { contentSource: "sellable_products", id: "showcase", isActive: true, itemIds: [], layout: "vertical", order: structural.length + 2, sectionType: "content_carousel", subtitle: "Produtos disponiveis e destaques configurados pela Bunker707.", title: "Produtos a venda", visibility: "all" },
    { contentSource: "upcoming_products", id: "upcoming", isActive: true, itemIds: [], layout: "vertical", order: structural.length + 3, sectionType: "content_carousel", subtitle: "Proximos cursos, formacoes e turmas para entrar no radar.", title: "Em breve na Bunker707", visibility: "all" }
  ]);
}

function validateHomeSectionConfigs(configs: HomeSectionConfig[], database: PlatformDatabase) {
  const contentIds = new Set(getAllContentItems(database).map((item) => item.id));
  const ids = new Set<string>();
  for (const section of configs) {
    if (!section.id.trim() || ids.has(section.id)) throw new Error("Cada secao precisa ter um ID unico.");
    if (!section.title.trim()) throw new Error("O titulo da secao e obrigatorio.");
    if (section.itemIds.some((itemId) => !contentIds.has(itemId))) throw new Error("A secao possui conteudo inexistente.");
    if (section.sectionType === "content_structure" && (!section.sourceContentId || !contentIds.has(section.sourceContentId))) throw new Error("Escolha um conteudo valido para a secao estrutural.");
    ids.add(section.id);
  }
  return normalizeHomeSectionOrder(configs);
}

function resolveConfiguredHomeRows(
  database: PlatformDatabase,
  configs: HomeSectionConfig[],
  accessPreviewMode?: AccessPreviewMode,
  user?: AuthenticatedUser | string
): HomeRow[] {
  return normalizeHomeSectionOrder(configs)
    .filter((section) => section.isActive)
    .flatMap((section) => resolveHomeSection(database, section, accessPreviewMode, user));
}
```

- [ ] **Step 5: Implementar publicacao com fallback**

```ts
export async function publishHomeSections(configs: HomeSectionConfig[]) {
  const database = await readAdminDatabase();
  const normalized = validateHomeSectionConfigs(configs, database);
  await persistHomeSectionsWithRelationalFallback(normalized);
  return toHydratedAdminDashboardData({ ...database, homeSectionConfigs: normalized });
}
```

O fallback grava `{ key: "homeSections", value: normalized }` em `platform_settings` somente quando `home_sections` nao existir. Outros erros continuam sendo propagados.

- [ ] **Step 6: Implementar a API PUT**

```ts
export async function PUT(request: Request) {
  const auth = await requireApiAdmin();
  if (auth.response) return auth.response;
  const payload = await request.json() as { sections?: HomeSectionConfig[] };
  if (!Array.isArray(payload.sections)) {
    return NextResponse.json({ error: "Secoes invalidas." }, { status: 400 });
  }
  try {
    return NextResponse.json({ data: await publishHomeSections(payload.sections) });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel publicar a Home.");
  }
}
```

- [ ] **Step 7: Rodar testes focados**

Run: `node --test tests/home-section-editor.test.mjs tests/admin-dashboard.test.mjs`
Expected: PASS.

### Task 3: Editor de tres paineis

**Files:**
- Create: `src/components/admin/personalization/home-showcase-editor.tsx`
- Modify: `src/components/admin-dashboard.tsx`
- Modify: `tests/home-section-editor.test.mjs`

**Interfaces:**
- Consumes: `hero`, `homeRows`, `homeSectionConfigs`, `records`, `courseModules`, `formationCourses`.
- Consumes: `onPublished(data: AdminDashboardData): void`.
- Produces: `HomeShowcaseEditor` com rascunho, create dialog, reordenacao, inspetor e publicacao.

- [ ] **Step 1: Escrever testes de UI que falham**

```js
for (const contract of [
  "Estrutura da Home",
  "Arraste para ordenar",
  "Criar secao",
  "Alteracoes nao publicadas",
  "Salvar alteracoes",
  "Selecao manual",
  "Layout imersivo"
]) assert.match(editorSource, new RegExp(contract));
assert.match(editorSource, /onDragStart/);
assert.match(editorSource, /onDrop/);
assert.match(editorSource, /moveSection/);
assert.match(editorSource, /\/api\/admin\/home-sections/);
```

- [ ] **Step 2: Confirmar a falha**

Run: `node --test tests/home-section-editor.test.mjs`
Expected: FAIL porque o componente nao existe.

- [ ] **Step 3: Implementar o estado de rascunho e ordenacao**

```ts
const [drafts, setDrafts] = useState(() => normalizeSectionOrder(homeSectionConfigs));
const [published, setPublished] = useState(() => normalizeSectionOrder(homeSectionConfigs));
const dirty = JSON.stringify(drafts) !== JSON.stringify(published);

function moveSection(sectionId: string, direction: -1 | 1) {
  setDrafts((current) => reorderSection(current, sectionId, direction));
}
```

- [ ] **Step 4: Implementar os tres paineis**

Usar grid `xl:grid-cols-[17rem_minmax(0,1fr)_20rem]`: lista com alcas à esquerda, preview central e formulario do item selecionado à direita. Em telas menores o inspetor usa `Dialog`/drawer existente.

- [ ] **Step 5: Implementar criacao e selecao manual**

```ts
const newSection: HomeSectionConfig = {
  contentSource: createMode === "manual" ? "manual" : automaticSource,
  id: crypto.randomUUID(),
  isActive: true,
  itemIds: selectedItemIds,
  layout: createMode === "structure" ? "compact" : "vertical",
  order: drafts.length,
  sectionType: createMode === "structure" ? "content_structure" : "content_carousel",
  sourceContentId: selectedContentId || undefined,
  subtitle: subtitle.trim() || undefined,
  title: title.trim(),
  visibility: "all"
};
```

- [ ] **Step 6: Implementar publicar e descartar**

```ts
async function publish() {
  const response = await fetch("/api/admin/home-sections", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sections: normalizeSectionOrder(drafts) })
  });
  const payload = await response.json() as { data?: AdminDashboardData; error?: string };
  if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel publicar a Home.");
  setPublished(payload.data.homeSectionConfigs);
  setDrafts(payload.data.homeSectionConfigs);
  onPublished(payload.data);
}
```

- [ ] **Step 7: Integrar no dashboard**

Substituir `renderShowcasePersonalization()` por `HomeShowcaseEditor` e passar `onPublished={updateDashboardData}` a partir de `AdminDashboard`.

- [ ] **Step 8: Rodar testes focados**

Run: `node --test tests/home-section-editor.test.mjs tests/admin-dashboard.test.mjs`
Expected: PASS.

### Task 4: Layout imersivo e Home publicada

**Files:**
- Create: `src/components/featured-structure-home-section.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/admin/personalization/home-showcase-editor.tsx`
- Modify: `src/server/db/platform-store.ts`
- Modify: `tests/home-section-editor.test.mjs`

**Interfaces:**
- Consumes: `HomeRow` estrutural com `course`, `modules`, `structureItems`, `layout` e `backgroundImage`.
- Produces: `FeaturedStructureHomeSection` compartilhado pelo preview e Home real.

- [ ] **Step 1: Adicionar teste falho do layout imersivo**

```js
assert.match(featureSource, /layout === "immersive"/);
assert.match(featureSource, /backgroundImage/);
assert.match(featureSource, /Compacta/);
assert.match(pageSource, /FeaturedStructureHomeSection/);
```

- [ ] **Step 2: Confirmar a falha**

Run: `node --test tests/home-section-editor.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implementar o componente compartilhado**

```tsx
export function FeaturedStructureHomeSection(props: FeaturedStructureHomeSectionProps) {
  if (props.layout === "compact") {
    return <CourseModulesHomeSection {...props} />;
  }
  return (
    <section className="relative mx-5 overflow-hidden rounded-[12px] sm:mx-8 lg:mx-12">
      <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${props.backgroundImage})` }} />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,.94),rgba(0,0,0,.54)_45%,rgba(0,0,0,.28)),linear-gradient(0deg,rgba(0,0,0,.82),transparent_55%)]" />
      <div className="relative grid min-h-[34rem] items-end gap-8 p-6 lg:grid-cols-[minmax(16rem,.7fr)_minmax(0,1.3fr)] lg:p-10">
        <div><p>{props.subtitle}</p><h2>{props.title}</h2><button type="button">{props.actionLabel}</button></div>
        <div>{props.children}</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Integrar na Home e no preview**

Trocar o branch de `course_modules` por `content_structure`/linha estrutural e renderizar `FeaturedStructureHomeSection` nos dois lugares.

- [ ] **Step 5: Rodar testes focados**

Run: `node --test tests/home-section-editor.test.mjs tests/home-card-hover-layout.test.mjs`
Expected: PASS.

### Task 5: Documentacao, verificacao e navegador

**Files:**
- Modify: `docs/02-area-aluno-ux.md`
- Modify: `docs/04-arquitetura-tecnica.md`
- Modify: `docs/05-modelo-dados.md`
- Modify: `docs/12-design-system-bunker707.md`
- Modify: `tests/home-section-editor.test.mjs`

**Interfaces:**
- Consumes: editor e Home implementados.
- Produces: documentacao alinhada, suite verde e validacao visual.

- [ ] **Step 1: Atualizar documentos**

Registrar o editor de tres paineis, os modos automatico/manual, publicacao global, tabelas/fallback e os layouts compacto/imersivo.

- [ ] **Step 2: Rodar verificacao focada**

Run: `node --test tests/home-section-editor.test.mjs tests/admin-dashboard.test.mjs tests/home-card-hover-layout.test.mjs`
Expected: PASS.

- [ ] **Step 3: Rodar gate completo**

Run: `npm run verify`
Expected: lint, typecheck, todos os testes e build de producao com exit code 0.

- [ ] **Step 4: Validar no navegador**

Abrir `http://localhost:3000/admin`, entrar em `Personalizacao > Vitrine` e confirmar: tres paineis visiveis; criar secao; editar propriedades; mover por arraste e setas; descartar; publicar; recarregar e preservar ordem; conferir a Home real.
