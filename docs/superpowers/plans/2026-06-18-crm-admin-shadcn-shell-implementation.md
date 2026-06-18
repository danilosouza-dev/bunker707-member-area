# CRM Admin shadcn Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/admin` CRM shell/sidebar/overview with official shadcn/ui block-based components while preserving the student area and all existing admin modules.

**Architecture:** Install shadcn/ui primitives and adapt the official dashboard/sidebar block pattern into a focused `src/components/admin/` shell. Keep `src/components/admin-dashboard.tsx` as the current stateful admin orchestrator for this stage, but move shell/sidebar/topbar/overview UI into smaller components and keep existing `Alunos`, `Catalogo`, `Estrutura`, and `Personalizacao` views reachable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Radix UI primitives via shadcn, lucide-react, existing Node test runner.

---

## File Structure

Create or modify these files only unless shadcn CLI generates additional UI primitives:

- Create: `components.json`  
  shadcn/ui project configuration.
- Create: `src/lib/utils.ts`  
  `cn()` helper used by shadcn/ui components.
- Create: `src/components/ui/*`  
  Generated shadcn/ui primitives required by `dashboard-01`, `sidebar-07`, cards, buttons, badges, dropdowns, tooltip, avatar, separator, sheet, breadcrumb, table and chart components.
- Modify: `src/app/globals.css`  
  Add shadcn-compatible CSS variables while preserving current Bunker707 student-area variables.
- Create: `src/components/admin/admin-nav.ts`  
  Single source for CRM nav items and icons.
- Create: `src/components/admin/admin-shell.tsx`  
  Client shell that composes `SidebarProvider`, sidebar, topbar and content inset.
- Create: `src/components/admin/admin-sidebar.tsx`  
  shadcn/sidebar-based CRM navigation, collapsed by default, expandable by user, mobile drawer behavior from shadcn.
- Create: `src/components/admin/admin-topbar.tsx`  
  Header with sidebar trigger, current section, search affordance, student-area preview link and primary action.
- Create: `src/components/admin/admin-overview.tsx`  
  shadcn/dashboard-style CRM home using real `AdminDashboardData` slices.
- Create: `src/components/admin/overview/metric-card.tsx`  
  Small card wrapper for overview metrics.
- Create: `src/components/admin/overview/operations-panel.tsx`  
  Safe operational summaries from pipeline/release/webhook data.
- Create: `src/components/admin/overview/recent-operations-table.tsx`  
  Compact table for current admin operational items.
- Modify: `src/components/admin-dashboard.tsx`  
  Import new admin shell and overview, remove old sidebar/topbar usage from the exported `AdminDashboard` root, keep existing internal module views intact.
- Modify: `tests/admin-dashboard.test.mjs`  
  Add source-level tests for new admin shell/sidebar, shadcn primitives and untouched student-area shell.
- Modify: `package.json` and `package-lock.json`  
  Only dependency changes produced by shadcn CLI and required UI components.

Do not edit student-facing components except `globals.css` token additions that are verified not to alter student behavior.

---

## Task 1: Install shadcn/ui Foundation And Official Blocks

**Files:**
- Create: `components.json`
- Create: `src/lib/utils.ts`
- Create: `src/components/ui/*`
- Modify: `src/app/globals.css`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Capture current dependency baseline**

Run:

```bash
npm pkg get dependencies devDependencies
```

Expected: current project dependencies include `class-variance-authority`, `clsx`, `lucide-react`, `tailwind-merge`, `next`, `react`, `react-dom`, but no `components.json` exists yet.

- [ ] **Step 2: Initialize shadcn/ui**

Run from the project root:

```bash
npx shadcn@latest init
```

When prompted, choose values compatible with the current project:

```txt
Style: New York
Base color: Neutral or Zinc
CSS variables: yes
Tailwind config: none/Tailwind v4 compatible default
Global CSS: src/app/globals.css
Components path: src/components
Utils path: src/lib/utils.ts
React Server Components: yes
Import alias: @/*
```

Expected:

- `components.json` is created.
- `src/lib/utils.ts` is created with `cn()`.
- `src/app/globals.css` gains shadcn token support.

- [ ] **Step 3: Add official shadcn dashboard/sidebar blocks**

Run:

```bash
npx shadcn@latest add dashboard-01 sidebar-07
```

Expected:

- shadcn installs required dependencies.
- shadcn creates or updates `src/components/ui/*`.
- shadcn may create demo block files. Keep generated UI primitives, but adapt or remove unrelated demo route files before committing if the CLI creates standalone app pages outside our intended admin module.

- [ ] **Step 4: Add missing UI primitives if the blocks did not include them**

Run:

```bash
npx shadcn@latest add card button badge separator dropdown-menu avatar breadcrumb table tabs tooltip sheet chart
```

Expected:

- `src/components/ui/card.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/separator.tsx`
- `src/components/ui/dropdown-menu.tsx`
- `src/components/ui/avatar.tsx`
- `src/components/ui/breadcrumb.tsx`
- `src/components/ui/table.tsx`
- `src/components/ui/tabs.tsx`
- `src/components/ui/tooltip.tsx`
- `src/components/ui/sheet.tsx`
- `src/components/ui/chart.tsx`
- `src/components/ui/sidebar.tsx`

all exist.

- [ ] **Step 5: Verify generated helper shape**

Check `src/lib/utils.ts` contains:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

If the CLI generated equivalent formatting, keep it.

- [ ] **Step 6: Run install verification**

Run:

```bash
npm run lint
npm test
```

Expected:

- `npm run lint` exits 0.
- `npm test` exits 0.

- [ ] **Step 7: Commit shadcn foundation**

Run:

```bash
git add components.json package.json package-lock.json src/app/globals.css src/lib/utils.ts src/components/ui
git commit -m "feat: add shadcn ui foundation"
```

Expected: commit succeeds. If hook runs tests, they pass.

---

## Task 2: Add Admin Navigation Model

**Files:**
- Create: `src/components/admin/admin-nav.ts`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write the failing navigation test**

Append this test near the existing "admin dashboard exposes the core CMS views" test in `tests/admin-dashboard.test.mjs`:

```js
test("admin shadcn nav keeps the core CRM modules and student preview action", () => {
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
```

Also add the `adminNavSource` read with the other top-level `readFile` calls:

```js
const adminNavSource = await readFile(new URL("../src/components/admin/admin-nav.ts", import.meta.url), "utf8");
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: FAIL because `src/components/admin/admin-nav.ts` does not exist.

- [ ] **Step 3: Create admin nav model**

Create `src/components/admin/admin-nav.ts`:

```ts
import {
  GalleryVerticalEnd,
  Home,
  LayoutDashboard,
  LibraryBig,
  Pencil,
  Users
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AdminView } from "@/lib/platform-types";

export type AdminNavItem = {
  icon: LucideIcon;
  id: AdminView;
  label: string;
};

export type AdminExternalNavItem = {
  href: string;
  icon: LucideIcon;
  label: string;
};

export const adminMainNavItems = [
  { icon: LayoutDashboard, id: "overview", label: "Visao geral" },
  { icon: Users, id: "students", label: "Alunos" },
  { icon: LibraryBig, id: "catalog", label: "Catalogo" },
  { icon: GalleryVerticalEnd, id: "structure", label: "Estrutura" },
  { icon: Pencil, id: "personalization", label: "Personalizacao" }
] satisfies AdminNavItem[];

export const adminOperationNavItems = [
  { href: "/", icon: Home, label: "Ver area do aluno" }
] satisfies AdminExternalNavItem[];
```

- [ ] **Step 4: Run navigation test**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit nav model**

Run:

```bash
git add src/components/admin/admin-nav.ts tests/admin-dashboard.test.mjs
git commit -m "feat: add admin navigation model"
```

Expected: commit succeeds.

---

## Task 3: Build shadcn Admin Sidebar

**Files:**
- Create: `src/components/admin/admin-sidebar.tsx`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write the failing sidebar test**

Append:

```js
test("admin sidebar uses shadcn sidebar primitives and starts collapsed", () => {
  assert.match(adminSidebarSource, /@\/components\/ui\/sidebar/);
  assert.match(adminSidebarSource, /collapsible="icon"/);
  assert.match(adminSidebarSource, /SidebarMenuButton/);
  assert.match(adminSidebarSource, /tooltip=/);
  assert.match(adminSidebarSource, /adminMainNavItems/);
  assert.match(adminSidebarSource, /adminOperationNavItems/);
  assert.match(adminSidebarSource, /onChangeView\(item\.id\)/);
  assert.match(adminSidebarSource, /data-active=\{activeView === item\.id\}/);
});
```

Add top-level read:

```js
const adminSidebarSource = await readFile(new URL("../src/components/admin/admin-sidebar.tsx", import.meta.url), "utf8");
```

- [ ] **Step 2: Run sidebar test to verify it fails**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: FAIL because `admin-sidebar.tsx` does not exist.

- [ ] **Step 3: Create admin sidebar component**

Create `src/components/admin/admin-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail
} from "@/components/ui/sidebar";
import { adminMainNavItems, adminOperationNavItems } from "@/components/admin/admin-nav";
import type { AdminView } from "@/lib/platform-types";

export function AdminSidebar({
  activeView,
  onChangeView
}: {
  activeView: AdminView;
  onChangeView: (view: AdminView) => void;
}) {
  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="CRM Bunker707">
              <span className="grid aspect-square size-8 place-items-center rounded-[8px] bg-[var(--accent)] text-sm font-black text-white">
                B
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-black">Bunker707</span>
                <span className="truncate text-xs text-muted-foreground">CRM Admin</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Principal</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminMainNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      data-active={activeView === item.id}
                      isActive={activeView === item.id}
                      onClick={() => onChangeView(item.id)}
                      tooltip={item.label}
                    >
                      <Icon className="size-4" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Operacao</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminOperationNavItems.map((item) => {
                const Icon = item.icon;

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild tooltip={item.label}>
                      <Link href={item.href}>
                        <Icon className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Ambiente seguro">
              <span className="grid size-7 place-items-center rounded-[8px] border border-border text-xs font-black">
                R
              </span>
              <span className="grid flex-1 text-left text-xs leading-tight">
                <span className="truncate font-bold">RBAC ativo</span>
                <span className="truncate text-muted-foreground">Entitlements preservados</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
```

- [ ] **Step 4: Run sidebar test**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit sidebar**

Run:

```bash
git add src/components/admin/admin-sidebar.tsx tests/admin-dashboard.test.mjs
git commit -m "feat: add shadcn admin sidebar"
```

Expected: commit succeeds.

---

## Task 4: Build Admin Topbar And Shell

**Files:**
- Create: `src/components/admin/admin-topbar.tsx`
- Create: `src/components/admin/admin-shell.tsx`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write failing shell/topbar tests**

Append:

```js
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
```

Add top-level reads:

```js
const adminShellSource = await readFile(new URL("../src/components/admin/admin-shell.tsx", import.meta.url), "utf8");
const adminTopbarSource = await readFile(new URL("../src/components/admin/admin-topbar.tsx", import.meta.url), "utf8");
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: FAIL because shell/topbar files do not exist.

- [ ] **Step 3: Create topbar**

Create `src/components/admin/admin-topbar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { adminMainNavItems } from "@/components/admin/admin-nav";
import type { AdminView } from "@/lib/platform-types";

export function AdminTopbar({
  activeView
}: {
  activeView: AdminView;
}) {
  const activeLabel = adminMainNavItems.find((item) => item.id === activeView)?.label ?? "CRM";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur">
      <SidebarTrigger className="-ml-1" />
      <Separator className="h-5" orientation="vertical" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground">{activeLabel}</p>
      </div>
      <div className="hidden h-9 min-w-64 items-center gap-2 rounded-[8px] border border-border bg-muted/30 px-3 text-sm text-muted-foreground md:flex">
        <Search className="size-4" />
        <span>Buscar no CRM</span>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link href="/">Ver area do aluno</Link>
      </Button>
      <Button size="sm">Novo aluno</Button>
    </header>
  );
}
```

- [ ] **Step 4: Create shell**

Create `src/components/admin/admin-shell.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopbar } from "@/components/admin/admin-topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { AdminView } from "@/lib/platform-types";

export function AdminShell({
  activeView,
  children,
  onChangeView
}: {
  activeView: AdminView;
  children: ReactNode;
  onChangeView: (view: AdminView) => void;
}) {
  return (
    <SidebarProvider defaultOpen={false}>
      <AdminSidebar activeView={activeView} onChangeView={onChangeView} />
      <SidebarInset className="min-h-screen bg-background">
        <AdminTopbar activeView={activeView} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

- [ ] **Step 5: Run shell/topbar tests**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit shell/topbar**

Run:

```bash
git add src/components/admin/admin-shell.tsx src/components/admin/admin-topbar.tsx tests/admin-dashboard.test.mjs
git commit -m "feat: add shadcn admin shell"
```

Expected: commit succeeds.

---

## Task 5: Build shadcn Admin Overview

**Files:**
- Create: `src/components/admin/overview/metric-card.tsx`
- Create: `src/components/admin/overview/operations-panel.tsx`
- Create: `src/components/admin/overview/recent-operations-table.tsx`
- Create: `src/components/admin/admin-overview.tsx`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write failing overview tests**

Append:

```js
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
```

Add the four top-level reads with the other `readFile` calls.

- [ ] **Step 2: Run overview test to verify it fails**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: FAIL because overview component files do not exist.

- [ ] **Step 3: Create metric card**

Create `src/components/admin/overview/metric-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminMetric } from "@/lib/platform-types";

const toneClassNames: Record<AdminMetric["tone"], string> = {
  amber: "text-amber-300",
  green: "text-emerald-300",
  neutral: "text-muted-foreground",
  red: "text-[var(--accent)]"
};

export function AdminMetricCard({ metric }: { metric: AdminMetric }) {
  return (
    <Card className="rounded-[8px] border-border bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold text-muted-foreground">
          {metric.label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-black text-foreground">{metric.value}</div>
        <p className={`mt-2 text-xs font-bold ${toneClassNames[metric.tone]}`}>
          {metric.delta}
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create operations panel**

Create `src/components/admin/overview/operations-panel.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminPipelineItem, AdminReleaseRule, AdminWebhookEvent } from "@/lib/platform-types";

export function OperationsPanel({
  pipeline,
  releaseRules,
  webhookEvents
}: {
  pipeline: AdminPipelineItem[];
  releaseRules: AdminReleaseRule[];
  webhookEvents: AdminWebhookEvent[];
}) {
  const failedWebhooks = webhookEvents.filter((event) => event.status === "failed").length;
  const pendingWebhooks = webhookEvents.filter((event) => event.status === "pending").length;
  const activeRules = releaseRules.filter((rule) => rule.status === "Ativa").length;

  return (
    <Card className="rounded-[8px] border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-black">Saude operacional</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-[8px] border border-border bg-muted/20 p-3">
          <span className="text-sm font-semibold">Entitlements internos</span>
          <Badge variant="secondary">Fonte de verdade</Badge>
        </div>
        <div className="flex items-center justify-between rounded-[8px] border border-border bg-muted/20 p-3">
          <span className="text-sm font-semibold">Regras ativas</span>
          <Badge variant="outline">{activeRules}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-[8px] border border-border bg-muted/20 p-3">
          <span className="text-sm font-semibold">Webhooks pendentes</span>
          <Badge variant={pendingWebhooks > 0 ? "outline" : "secondary"}>{pendingWebhooks}</Badge>
        </div>
        <div className="flex items-center justify-between rounded-[8px] border border-border bg-muted/20 p-3">
          <span className="text-sm font-semibold">Webhooks com falha</span>
          <Badge variant={failedWebhooks > 0 ? "destructive" : "secondary"}>{failedWebhooks}</Badge>
        </div>
        {pipeline.slice(0, 3).map((item) => (
          <div className="flex items-center justify-between text-sm text-muted-foreground" key={item.label}>
            <span>{item.label}</span>
            <span className="font-bold text-foreground">{item.count}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Create recent operations table**

Create `src/components/admin/overview/recent-operations-table.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import type { AdminReleaseRule, AdminWebhookEvent } from "@/lib/platform-types";

type OperationRow = {
  area: string;
  label: string;
  status: string;
};

export function RecentOperationsTable({
  releaseRules,
  webhookEvents
}: {
  releaseRules: AdminReleaseRule[];
  webhookEvents: AdminWebhookEvent[];
}) {
  const rows: OperationRow[] = [
    ...webhookEvents.slice(0, 3).map((event) => ({
      area: event.provider,
      label: event.type,
      status: event.status
    })),
    ...releaseRules.slice(0, 3).map((rule) => ({
      area: rule.scope,
      label: rule.title,
      status: rule.status
    }))
  ].slice(0, 5);

  return (
    <Card className="rounded-[8px] border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base font-black">Operacao recente</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Evento</TableHead>
              <TableHead>Area</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.area}-${row.label}`}>
                <TableCell className="font-semibold">{row.label}</TableCell>
                <TableCell className="text-muted-foreground">{row.area}</TableCell>
                <TableCell className="text-right">
                  <Badge variant="outline">{row.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 6: Create admin overview**

Create `src/components/admin/admin-overview.tsx`:

```tsx
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { AdminMetricCard } from "@/components/admin/overview/metric-card";
import { OperationsPanel } from "@/components/admin/overview/operations-panel";
import { RecentOperationsTable } from "@/components/admin/overview/recent-operations-table";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminDashboardData } from "@/lib/platform-types";

export function AdminOverview({
  data
}: {
  data: AdminDashboardData;
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold text-[var(--accent)]">CRM Bunker707</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-foreground">Visao geral</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Controle alunos, conteudos, acessos e pontos sensiveis da operacao sem misturar dados de pagamento com autorizacao real.
          </p>
        </div>
        <Button asChild>
          <Link href="/">
            Ver area do aluno
            <ArrowUpRight className="ml-2 size-4" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {data.metrics.map((metric) => (
          <AdminMetricCard key={metric.label} metric={metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="rounded-[8px] border-border bg-card">
          <CardHeader>
            <CardTitle className="text-base font-black">Acesso e conteudo</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[8px] border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-muted-foreground">Produtos</p>
              <p className="mt-2 text-2xl font-black">{data.contentRecords.length}</p>
            </div>
            <div className="rounded-[8px] border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-muted-foreground">Alunos</p>
              <p className="mt-2 text-2xl font-black">{data.students.length}</p>
            </div>
            <div className="rounded-[8px] border border-border bg-muted/20 p-4">
              <p className="text-sm font-semibold text-muted-foreground">Entitlements</p>
              <p className="mt-2 text-2xl font-black">{data.entitlements.length}</p>
            </div>
          </CardContent>
        </Card>
        <OperationsPanel
          pipeline={data.pipeline}
          releaseRules={data.releaseRules}
          webhookEvents={data.webhookEvents}
        />
      </div>

      <RecentOperationsTable
        releaseRules={data.releaseRules}
        webhookEvents={data.webhookEvents}
      />
    </div>
  );
}
```

- [ ] **Step 7: Run overview tests**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit overview**

Run:

```bash
git add src/components/admin/admin-overview.tsx src/components/admin/overview tests/admin-dashboard.test.mjs
git commit -m "feat: add shadcn admin overview"
```

Expected: commit succeeds.

---

## Task 6: Wire New Shell And Overview Into AdminDashboard

**Files:**
- Modify: `src/components/admin-dashboard.tsx`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write failing integration test**

Append:

```js
test("admin dashboard delegates shell and overview to shadcn admin components", () => {
  assert.match(adminDashboardSource, /AdminShell/);
  assert.match(adminDashboardSource, /AdminOverview/);
  assert.match(adminDashboardSource, /<AdminShell/);
  assert.match(adminDashboardSource, /<AdminOverview data=\{dashboardData\} \/>/);
  assert.doesNotMatch(adminDashboardSource, /<AdminSidebar[\s\S]*isOpen=\{sidebarOpen\}/);
  assert.doesNotMatch(adminDashboardSource, /<AdminTopbar[\s\S]*sidebarOpen=\{sidebarOpen\}/);
});
```

- [ ] **Step 2: Run integration test to verify it fails**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: FAIL because `AdminDashboard` still uses old local `AdminSidebar`, `AdminTopbar`, and `OverviewView`.

- [ ] **Step 3: Add imports**

At the top of `src/components/admin-dashboard.tsx`, add:

```ts
import { AdminOverview } from "@/components/admin/admin-overview";
import { AdminShell } from "@/components/admin/admin-shell";
```

- [ ] **Step 4: Replace exported AdminDashboard shell**

In `src/components/admin-dashboard.tsx`, replace only the `return (...)` block inside `export function AdminDashboard` with:

```tsx
  return (
    <div className="min-h-screen bg-background text-foreground">
      <AdminShell activeView={activeView} onChangeView={handleChangeView}>
        {activeView === "overview" ? <AdminOverview data={dashboardData} /> : null}
        {activeView === "students" ? (
          <StudentsView
            cohorts={dashboardData.cohorts}
            onChangeStudents={persistStudents}
            onSelectStudent={setSelectedStudentId}
            persistenceProvider={dashboardData.persistenceProvider}
            selectedStudentId={selectedStudentId}
            sellableProducts={dashboardData.sellableProducts}
            students={dashboardData.students}
          />
        ) : null}
        {activeView === "catalog" ? (
          <CatalogView
            courseModules={dashboardData.courseModules}
            onDashboardDataChange={updateDashboardData}
            records={dashboardData.contentRecords}
            selectedRecord={selectedRecord}
            setSelectedRecord={(record) => setSelectedRecordId(record.content.id)}
          />
        ) : null}
        {activeView === "structure" ? (
          <StructureView
            cohorts={dashboardData.cohorts}
            courseModules={dashboardData.courseModules}
            onDashboardDataChange={updateDashboardData}
            selectedRecord={selectedRecord}
          />
        ) : null}
        {activeView === "personalization" ? (
          <PersonalizationView
            courseModules={dashboardData.courseModules}
            formationCourses={dashboardData.formationCourses}
            hero={dashboardData.hero}
            homeRows={dashboardData.homeRows}
            homeSections={dashboardData.homeSections}
            records={dashboardData.contentRecords}
          />
        ) : null}
      </AdminShell>

      <div className="pointer-events-none fixed bottom-4 right-4 hidden rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur md:block">
        {dashboardData.persistenceProvider === "supabase" ? "Supabase persistido" : "Fallback local"}
      </div>
    </div>
  );
```

Keep all existing internal view functions in the file for this stage. Remove the `sidebarOpen` state only after the replacement compiles:

```ts
const [sidebarOpen, setSidebarOpen] = useState(false);
```

should be deleted because shadcn `SidebarProvider` now owns sidebar state.

- [ ] **Step 5: Remove old local shell usage only after compile**

Do not delete old local `AdminSidebar`, `AdminTopbar`, or `OverviewView` definitions in this task unless TypeScript reports unused local declarations that lint treats as errors. If lint flags unused local functions, remove only the unused local shell/overview definitions and their now-unused helper imports. Keep student, catalog, structure and personalization functions untouched.

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm run lint
npm test -- tests/admin-dashboard.test.mjs
```

Expected: both pass.

- [ ] **Step 7: Commit integration**

Run:

```bash
git add src/components/admin-dashboard.tsx tests/admin-dashboard.test.mjs
git commit -m "feat: wire shadcn admin shell"
```

Expected: commit succeeds.

---

## Task 7: Align Admin Theme Tokens Without Breaking Student Area

**Files:**
- Modify: `src/app/globals.css`
- Modify: `docs/12-design-system-bunker707.md`
- Modify: `tests/admin-dashboard.test.mjs`

- [ ] **Step 1: Write token test**

Append:

```js
test("shadcn tokens coexist with Bunker707 student area tokens", () => {
  for (const token of ["--background", "--foreground", "--panel", "--border", "--accent"]) {
    assert.match(globalsCssSource, new RegExp(token));
  }

  for (const token of ["--card", "--card-foreground", "--sidebar", "--sidebar-foreground", "--primary"]) {
    assert.match(globalsCssSource, new RegExp(token));
  }

  assert.match(designSystemSource, /shadcn\/ui/);
  assert.match(designSystemSource, /CRM admin/);
});
```

Add top-level reads:

```js
const globalsCssSource = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const designSystemSource = await readFile(new URL("../docs/12-design-system-bunker707.md", import.meta.url), "utf8");
```

- [ ] **Step 2: Run token test to verify current state**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: may fail until docs/tokens are aligned.

- [ ] **Step 3: Align globals tokens**

Ensure `src/app/globals.css` keeps existing tokens and includes shadcn tokens in `:root`.

The final `:root` must include at least:

```css
:root {
  color-scheme: dark;
  --background: #141414;
  --foreground: #f7f7f4;
  --muted: #a8a8a2;
  --panel: #171717;
  --panel-strong: #202020;
  --border: rgba(255, 255, 255, 0.1);
  --accent: #e50914;
  --accent-warm: #ff7a1a;
  --card: #171717;
  --card-foreground: #f7f7f4;
  --popover: #171717;
  --popover-foreground: #f7f7f4;
  --primary: #e50914;
  --primary-foreground: #ffffff;
  --secondary: #202020;
  --secondary-foreground: #f7f7f4;
  --muted-foreground: #a8a8a2;
  --destructive: #ef4444;
  --destructive-foreground: #ffffff;
  --input: rgba(255, 255, 255, 0.1);
  --ring: rgba(229, 9, 20, 0.55);
  --radius: 0.5rem;
  --sidebar: #0f0f0f;
  --sidebar-foreground: #f7f7f4;
  --sidebar-primary: #e50914;
  --sidebar-primary-foreground: #ffffff;
  --sidebar-accent: #202020;
  --sidebar-accent-foreground: #f7f7f4;
  --sidebar-border: rgba(255, 255, 255, 0.1);
  --sidebar-ring: rgba(229, 9, 20, 0.55);
}
```

If shadcn CLI generated OKLCH tokens, keep them only if the rendered admin and student pages remain visually correct. The Bunker707 dark hex tokens above are the fallback.

- [ ] **Step 4: Document admin shadcn usage**

Append to `docs/12-design-system-bunker707.md`:

```md
## CRM admin with shadcn/ui

The CRM admin in `/admin` uses official shadcn/ui blocks and primitives as its component foundation. The first admin shell is based on the shadcn dashboard/sidebar pattern, with Bunker707 dark premium tokens applied through CSS variables.

The student area keeps its existing streaming-inspired UI. Admin shadcn tokens must be layered so they do not change student-facing cards, carousels, lesson pages or modals.
```

- [ ] **Step 5: Run token/docs tests**

Run:

```bash
npm test -- tests/admin-dashboard.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit tokens/docs**

Run:

```bash
git add src/app/globals.css docs/12-design-system-bunker707.md tests/admin-dashboard.test.mjs
git commit -m "docs: document shadcn admin design tokens"
```

Expected: commit succeeds.

---

## Task 8: Manual Runtime Verification

**Files:**
- No planned source edits unless verification finds a bug.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run verify
```

Expected:

- lint passes;
- typecheck passes;
- tests pass;
- build passes.

- [ ] **Step 2: Start dev server**

Run:

```bash
npm run dev
```

Expected: Next dev server starts, usually on `http://localhost:3000`.

- [ ] **Step 3: Verify admin home**

Open:

```txt
http://localhost:3000/admin
```

Expected:

- admin route still requires admin auth/local dev auth;
- new shadcn admin shell is visible;
- sidebar starts collapsed on desktop;
- sidebar trigger expands and collapses it;
- active nav item remains clear;
- `Visao geral`, `Alunos`, `Catalogo`, `Estrutura`, `Personalizacao` are all reachable;
- `Ver area do aluno` opens `/`.

- [ ] **Step 4: Verify existing admin modules**

In `/admin`, navigate to each module.

Expected:

- `Alunos` still shows current CRM student functionality;
- `Catalogo` still shows current catalog functionality;
- `Estrutura` still shows current structure functionality;
- `Personalizacao` still shows current personalization functionality;
- no current forms or modals lose data;
- no current admin API route is bypassed.

- [ ] **Step 5: Verify student area unchanged**

Open:

```txt
http://localhost:3000/
http://localhost:3000/minhas-compras
http://localhost:3000/favoritos
```

Expected:

- student app shell remains streaming-inspired;
- student sidebar/hamburger is unchanged;
- content cards, hero, rows and footer keep their current style;
- no shadcn admin sidebar appears outside `/admin`.

- [ ] **Step 6: Commit verification fixes if needed**

If verification reveals fixes, commit each focused fix separately:

```bash
git add <changed-files>
git commit -m "fix: polish shadcn admin shell"
```

Expected: only necessary fix files are included.

---

## Self-Review

Spec coverage:

- shadcn official blocks/components: Task 1.
- admin-only shell/sidebar/overview: Tasks 2 through 6.
- collapsed-by-default sidebar with expansion: Tasks 3 and 4.
- existing modules preserved: Task 6 and Task 8.
- student area untouched: Task 7 and Task 8.
- security model preserved: Tasks 5, 6 and manual verification in Task 8.
- verification: Task 8.

Placeholder scan:

- No task contains red-flag filler phrases or vague testing instructions.
- Each code-producing task includes the code to create or the specific command that generates official shadcn code.

Type consistency:

- Admin view type stays `AdminView`.
- Dashboard data type stays `AdminDashboardData`.
- Navigation model uses `AdminNavItem` and `AdminExternalNavItem`.
- Shell props use `activeView` and `onChangeView` consistently.
