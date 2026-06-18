# CRM admin shadcn shell design

Date: 2026-06-18

## Goal

Reformulate the administrative CRM experience in `/admin` without changing the student member area.

This first stage covers only:

- the CRM admin shell;
- the CRM admin sidebar;
- the CRM admin home/overview page;
- the shadcn/ui foundation needed for those surfaces.

The student-facing area, including home, content pages, purchases, lesson player, login, cards, carousels and student sidebar, is out of scope.

## Direction

Use official shadcn/ui blocks and components as the base instead of styling the CRM from scratch.

Primary references:

- shadcn/ui `dashboard-01` block for the admin overview structure;
- shadcn/ui `sidebar-07` block and `Sidebar` component for the collapsible admin navigation;
- shadcn/ui `Card`, `Button`, `Badge`, `Separator`, `DropdownMenu`, `Avatar`, `Breadcrumb`, `Table`, `Tabs`, `Chart`, `Sheet`, `Tooltip` and related primitives as needed.

The final result should feel clean, modern, well structured and premium dark. It should not look like a handmade dashboard assembled with ad hoc Tailwind blocks.

## Product Rules

- Keep `/admin` as a separate CRM/backoffice experience from the student area.
- Keep existing admin modules: `Visao geral`, `Alunos`, `Catalogo`, `Estrutura`, `Personalizacao`.
- Keep the visible shortcut from admin to the student area for preview/checking the final experience.
- Keep entitlements as the source of truth for access.
- Do not introduce checkout, public storefront behavior or student-area redesign in this stage.
- Do not remove any current admin functionality. This stage can move/refactor shell and overview presentation, but existing modules must remain reachable.

## Sidebar Behavior

The admin sidebar should use the shadcn/ui sidebar pattern.

Requirements:

- It starts collapsed by default on desktop.
- The user can expand and collapse it.
- The selected state must be clear in both collapsed and expanded modes.
- Collapsed mode shows icons and tooltips.
- Expanded mode shows icons, labels and grouped navigation.
- The sidebar state should persist per browser/user session, using the shadcn/sidebar cookie or equivalent local UI state.
- On mobile, the sidebar behaves as a drawer/sheet over the admin content.
- This behavior applies only to `/admin`; it must not alter the student sidebar/hamburger.

Proposed navigation groups:

- Main: `Visao geral`, `Alunos`, `Catalogo`, `Estrutura`, `Personalizacao`.
- Operation: `Ver area do aluno`.
- Later/auditing surfaces may be added when the underlying module exists, but the first stage should not invent a new admin module just for visual completeness.

## Admin Home

The `/admin` home should be rebuilt from the shadcn dashboard block pattern and adapted to current `AdminDashboardData`.

The page should include:

- page header with title, short operational subtitle and primary action;
- metric cards using existing admin metrics where possible;
- an activity/operations panel using existing data such as pipeline, release rules, webhook events or student access events where available;
- a content/access health area that reinforces that entitlements and admin permissions are the trusted model;
- a compact table/list section for recent operational items;
- a clear action to open or preview the student area.

The page should avoid:

- oversized marketing hero sections;
- decorative cards around entire page sections;
- fake text that implies data exists when it does not;
- gradients or one-off visuals that do not come from shadcn/theme tokens;
- changing student-facing data behavior.

## Visual System

The admin should use the Bunker707 dark premium direction but through shadcn-compatible tokens.

Baseline:

- dark background;
- dark surfaces with subtle borders;
- restrained red accent from Bunker707;
- neutral text hierarchy;
- compact operational spacing;
- 8px or smaller radii unless the imported shadcn component requires otherwise;
- lucide-react icons via shadcn patterns.

The implementation should add or align shadcn tokens in `globals.css` without breaking the current student UI tokens.

The student area currently relies on existing CSS variables such as `--background`, `--foreground`, `--panel`, `--border`, and `--accent`. Any new shadcn variables must be layered carefully so existing screens keep their current look.

## Architecture

The current `src/components/admin-dashboard.tsx` is too large and mixes shell, overview, CRM students, catalog, structure, personalization, state and mutations in one client component.

Stage 1 should introduce a modular admin structure, for example:

```txt
src/components/admin/
  admin-shell.tsx
  admin-sidebar.tsx
  admin-overview.tsx
  admin-topbar.tsx
  admin-nav.ts
  overview/
    metric-card.tsx
    activity-panel.tsx
    recent-operations-table.tsx
```

The exact file names can follow the shadcn block output and local codebase conventions, but the result must reduce the shell/overview responsibility inside `admin-dashboard.tsx`.

The initial refactor should preserve current admin module components and route behavior. It can wrap existing views in the new shell before deeper module migrations happen in later stages.

## Data Flow

- `/admin/page.tsx` continues to call `requirePageAdmin()`.
- `/admin/page.tsx` continues to load `getAdminDashboardData()`.
- The new admin shell receives `AdminDashboardData` or a narrowed view model derived from it.
- Client-side state is allowed for UI-only sidebar collapse, active admin view and local presentation.
- Admin mutations remain behind `/api/admin/*` routes with `requireApiAdmin()`.
- No service-role data, secrets, raw webhook payloads or temporary passwords should be exposed in client components.

## Security Requirements

- Preserve `requirePageAdmin()` for `/admin`.
- Preserve `requireApiAdmin()` for admin route handlers.
- Keep Supabase service role usage server-only.
- Keep entitlement changes server-side only.
- Do not expose raw webhook payloads or private personal data in overview widgets.
- Do not persist temporary passwords in React state longer than needed for the current access-delivery flow.
- Any future admin audit panel must show safe summaries by default, not raw payloads.
- The new sidebar and overview must not create a client-side authorization shortcut.

## shadcn/ui Setup

The project does not currently have a `components.json` or `src/components/ui` directory.

Stage 1 should:

- initialize shadcn/ui for the current Next.js App Router and Tailwind setup;
- choose the current shadcn style recommended for new blocks;
- install only the dependencies required by the selected blocks/components;
- keep generated UI primitives in `src/components/ui`;
- adapt imported block code to Bunker707 naming and data without vendoring unrelated demo pages.

Expected external commands may include:

```txt
npx shadcn@latest init
npx shadcn@latest add dashboard-01
npx shadcn@latest add sidebar-07
```

The exact commands can change after checking current shadcn CLI behavior.

## Testing And Verification

At minimum:

- run lint/typecheck/tests/build through `npm run verify` before completion;
- add or update focused tests for admin shell/sidebar behavior if the existing test structure allows it;
- manually verify `/admin` on desktop width with collapsed and expanded sidebar;
- manually verify mobile sidebar/drawer behavior;
- verify student area routes still render with the same shell and styling;
- verify no user-created dirty worktree changes are reverted.

## Out Of Scope For Stage 1

- Redesigning student-facing pages.
- Rebuilding the `Alunos` module internals.
- Rebuilding `Catalogo`, `Estrutura` or `Personalizacao` internals.
- Implementing full webhook/audit screens.
- Reworking Supabase schema.
- Introducing new payment provider behavior.
- Creating a public storefront or checkout.

## Later Stages

After the admin shell and overview are stable:

1. Rebuild `Alunos` using shadcn data table, forms, dialogs/sheets and safe access-delivery flows.
2. Rebuild `Catalogo` with shadcn forms, steppers/tabs and content tables.
3. Rebuild `Estrutura` with cleaner module/lesson management.
4. Rebuild `Personalizacao` around shadcn resizable/editor layouts while preserving faithful student-page preview.
